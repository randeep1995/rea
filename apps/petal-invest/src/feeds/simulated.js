// Offline feed: seeded random-walk prices ticking once a second. Useful
// without a network or outside market hours.
import { ok } from "../domain/result.js";
import { TIMEFRAMES, applyTrade, barStart } from "../domain/candles.js";
import { seededRandom } from "../domain/market.js";

const SYMBOLS = [
  { symbol: "SIM-TECH", name: "Simulated tech stock", price: 180, vol: 0.0003 },
  {
    symbol: "SIM-INDEX",
    name: "Simulated index fund",
    price: 420,
    vol: 0.00015,
  },
  { symbol: "SIM-COIN", name: "Simulated coin", price: 62_000, vol: 0.0005 },
];
const BARS = 400;
const TICK_MS = 1000;

export function createSimulatedFeed({ onStatus, seed = 7 } = {}) {
  const rand = seededRandom(seed);
  const prices = new Map(SYMBOLS.map((s) => [s.symbol, s.price]));
  const opens = new Map(prices);
  const listeners = new Set();
  let timer;

  function start() {
    if (timer) return;
    onStatus?.("live");
    timer = setInterval(() => {
      const timeSec = Math.floor(Date.now() / 1000);
      for (const s of SYMBOLS) {
        const next = prices.get(s.symbol) * (1 + (rand() - 0.5) * 2 * s.vol);
        prices.set(s.symbol, next);
        const size = rand() * 10;
        for (const fn of listeners)
          fn(s.symbol, { price: next, size, timeSec });
      }
    }, TICK_MS);
  }

  function listen(fn) {
    listeners.add(fn);
    start();
    return () => {
      listeners.delete(fn);
      if (listeners.size === 0) {
        clearInterval(timer);
        timer = undefined;
      }
    };
  }

  return {
    id: "simulated",
    label: "Simulated (offline)",
    quote: "USD",
    symbols: SYMBOLS,

    async history(symbol, tf) {
      const spec = SYMBOLS.find((s) => s.symbol === symbol);
      const tfSec = TIMEFRAMES[tf];
      const r = seededRandom(seed ^ symbol.length ^ tfSec);
      const scale = spec.vol * Math.sqrt(tfSec);
      const now = barStart(Math.floor(Date.now() / 1000), tfSec);
      // Walk backwards from the live price so history meets the stream.
      let close = prices.get(symbol);
      const bars = [];
      for (let i = 0; i < BARS; i++) {
        const open = close / (1 + (r() - 0.5) * 2 * scale);
        const high = Math.max(open, close) * (1 + r() * scale * 0.5);
        const low = Math.min(open, close) * (1 - r() * scale * 0.5);
        bars.unshift({
          time: now - i * tfSec,
          open,
          high,
          low,
          close,
          volume: r() * 1000,
        });
        close = open;
      }
      return ok({ bars });
    },

    streamBars({ symbol, tf, bars, onBar }) {
      return listen((s, trade) => {
        if (s !== symbol) return;
        const bar = applyTrade(bars, trade, TIMEFRAMES[tf]);
        if (bar) onBar(bar);
      });
    },

    streamTickers(symbols, onTicker) {
      return listen((symbol, { price }) => {
        if (!symbols.includes(symbol)) return;
        const open = opens.get(symbol);
        onTicker({ symbol, price, changePct: (price - open) / open });
      });
    },
  };
}

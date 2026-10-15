// US stocks from Finnhub. Needs a free API key from finnhub.io. Live
// trades arrive over one shared WebSocket and are folded into candles here.
// Historical candles are a paid Finnhub feature; without them the chart
// starts from the current quote and fills in from live trades.
import { ok, err } from "../domain/result.js";
import {
  TIMEFRAMES,
  applyTrade,
  barStart,
  resample,
} from "../domain/candles.js";
import { reconnectingSocket } from "./socket.js";

const REST = "https://finnhub.io/api/v1";
const WS = "wss://ws.finnhub.io";
const RESOLUTION = {
  "1m": "1",
  "5m": "5",
  "15m": "15",
  "1h": "60",
  "4h": "60",
  "1D": "D",
};
const LOOKBACK_SEC = {
  "1m": 86_400,
  "5m": 432_000,
  "15m": 864_000,
  "1h": 2_592_000,
  "4h": 7_776_000,
  "1D": 31_536_000,
};

const SYMBOLS = [
  { symbol: "AAPL", name: "Apple" },
  { symbol: "MSFT", name: "Microsoft" },
  { symbol: "NVDA", name: "Nvidia" },
  { symbol: "TSLA", name: "Tesla" },
  { symbol: "AMZN", name: "Amazon" },
  { symbol: "GOOGL", name: "Alphabet" },
  { symbol: "META", name: "Meta" },
  { symbol: "SPY", name: "S&P 500 ETF" },
  { symbol: "QQQ", name: "Nasdaq 100 ETF" },
];

const NO_HISTORY_NOTE =
  "Your Finnhub plan has no historical candles, so the chart builds from live trades.";

async function finnhubGet(apiKey, path) {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(
    `${REST}${path}${sep}token=${encodeURIComponent(apiKey)}`,
  );
  if (!res.ok) {
    const invalidKey = res.status === 401;
    return err(
      invalidKey ? "InvalidKey" : "HttpError",
      invalidKey
        ? "Finnhub rejected the API key"
        : `Finnhub answered ${res.status}`,
      { status: res.status },
    );
  }
  return ok(await res.json());
}

export function parseCandles(c, tf) {
  const bars = c.t.map((t, i) => ({
    time: t,
    open: c.o[i],
    high: c.h[i],
    low: c.l[i],
    close: c.c[i],
    volume: c.v[i],
  }));
  return tf === "4h" ? resample(bars, TIMEFRAMES["4h"]) : bars;
}

export function quoteBar({ c, o, h, l, t }, tf, nowSec) {
  return {
    time: barStart(t || nowSec, TIMEFRAMES[tf]),
    open: o || c,
    high: h || c,
    low: l || c,
    close: c,
    volume: 0,
  };
}

// One WebSocket shared by every chart and watchlist subscription.
function createTradeHub(apiKey, onStatus) {
  const listeners = new Map(); // symbol -> Set<(trade) => void>
  let socket;

  function ensureSocket() {
    if (socket) return;
    socket = reconnectingSocket(`${WS}?token=${encodeURIComponent(apiKey)}`, {
      onStatus,
      onOpen() {
        for (const symbol of listeners.keys()) {
          socket.send({ type: "subscribe", symbol });
        }
      },
      onMessage(msg) {
        if (msg.type !== "trade") return;
        for (const t of msg.data) {
          const trade = {
            price: t.p,
            size: t.v,
            timeSec: Math.floor(t.t / 1000),
          };
          for (const fn of listeners.get(t.s) ?? []) fn(trade);
        }
      },
    });
  }

  return {
    listen(symbol, fn) {
      ensureSocket();
      if (!listeners.has(symbol)) {
        listeners.set(symbol, new Set());
        socket.send({ type: "subscribe", symbol });
      }
      listeners.get(symbol).add(fn);
      return () => {
        const set = listeners.get(symbol);
        set?.delete(fn);
        if (set && set.size === 0) {
          listeners.delete(symbol);
          socket.send({ type: "unsubscribe", symbol });
        }
      };
    },
    close() {
      socket?.close();
      socket = undefined;
      listeners.clear();
    },
  };
}

export function createFinnhubFeed({ apiKey, onStatus }) {
  const hub = createTradeHub(apiKey, onStatus);
  const prevClose = new Map();
  const get = (path) => finnhubGet(apiKey, path);

  async function quote(symbol) {
    const q = await get(`/quote?symbol=${encodeURIComponent(symbol)}`);
    if (q.ok && q.value.pc) prevClose.set(symbol, q.value.pc);
    return q;
  }

  async function history(symbol, tf) {
    const to = Math.floor(Date.now() / 1000);
    const from = to - LOOKBACK_SEC[tf];
    const candles = await get(
      `/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=${RESOLUTION[tf]}&from=${from}&to=${to}`,
    );
    if (candles.ok && candles.value.s === "ok") {
      return ok({ bars: parseCandles(candles.value, tf) });
    }
    if (!candles.ok && candles.error.tag === "InvalidKey") return candles;
    // No candle access on this plan: start from the latest quote.
    const q = await quote(symbol);
    if (!q.ok) return q;
    if (!q.value.c) return err("NoData", `Finnhub has no quote for ${symbol}`);
    return ok({ bars: [quoteBar(q.value, tf, to)], note: NO_HISTORY_NOTE });
  }

  return {
    id: "finnhub",
    label: "US stocks · Finnhub (key)",
    quote: "USD",
    symbols: SYMBOLS,

    async history(symbol, tf) {
      try {
        return await history(symbol, tf);
      } catch (e) {
        return err("NetworkError", `Couldn't reach Finnhub: ${e.message}`);
      }
    },

    streamBars({ symbol, tf, bars, onBar }) {
      return hub.listen(symbol, (trade) => {
        const bar = applyTrade(bars, trade, TIMEFRAMES[tf]);
        if (bar) onBar(bar);
      });
    },

    streamTickers(symbols, onTicker) {
      const stops = symbols.map((symbol) => {
        if (!prevClose.has(symbol)) {
          quote(symbol).then((q) => {
            if (q.ok && q.value.c) {
              onTicker({
                symbol,
                price: q.value.c,
                changePct: q.value.dp / 100,
              });
            }
          });
        }
        return hub.listen(symbol, ({ price }) => {
          const pc = prevClose.get(symbol);
          onTicker({
            symbol,
            price,
            changePct: pc ? (price - pc) / pc : undefined,
          });
        });
      });
      return () => stops.forEach((s) => s());
    },

    close: () => hub.close(),
  };
}

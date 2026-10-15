// Market data for the server: routes each symbol to a feed, keeps the
// latest price per symbol and streams updates for symbols in use.
import { ok, err } from "../src/domain/result.js";
import { TIMEFRAMES } from "../src/domain/candles.js";
import { sma, ema, bollinger, rsi } from "../src/domain/indicators.js";
import { createFeed, FEEDS } from "../src/feeds/index.js";

export const INDICATORS = {
  sma20: (bars) => sma(bars, 20),
  ema50: (bars) => ema(bars, 50),
  rsi14: (bars) => rsi(bars, 14),
  bb20: (bars) => bollinger(bars, 20, 2),
};

// Keys come from the environment so they never reach the agent's context.
export function keysFromEnv(env) {
  const keys = {};
  if (env.ALPACA_KEY_ID && env.ALPACA_SECRET_KEY) {
    keys.alpaca = { keyId: env.ALPACA_KEY_ID, secret: env.ALPACA_SECRET_KEY };
  }
  if (env.FINNHUB_API_KEY) keys.finnhub = env.FINNHUB_API_KEY;
  return keys;
}

export function createMarketData({ keys = {}, log = () => {}, onPrice }) {
  const prices = new Map(); // symbol -> { price, time }
  const watchers = new Map(); // symbol -> stop()
  const feeds = new Map();
  const available = FEEDS.filter((f) => !f.hasKey || f.hasKey(keys));
  const stockFeed = available.find(
    (f) => f.id === "alpaca" || f.id === "finnhub",
  );

  function feed(id) {
    if (!feeds.has(id)) {
      const onStatus = (s, detail) => log(`${id}: ${detail ?? s}`);
      feeds.set(id, createFeed(id, { keys, onStatus }));
    }
    return feeds.get(id);
  }

  // Symbols route to a feed by shape: SIM-* simulated, *USDT crypto,
  // anything else US stocks (needs an Alpaca or Finnhub key).
  function feedFor(symbol) {
    if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol)) {
      return err("InvalidSymbol", `"${symbol}" is not a valid symbol`);
    }
    if (symbol.startsWith("SIM-")) return ok(feed("simulated"));
    if (symbol.endsWith("USDT")) return ok(feed("binance"));
    if (!stockFeed) {
      return err(
        "NoStockFeed",
        "US stocks need ALPACA_KEY_ID and ALPACA_SECRET_KEY (or FINNHUB_API_KEY) in the server's environment",
      );
    }
    return ok(feed(stockFeed.id));
  }

  function record(symbol, price) {
    prices.set(symbol, { price, time: Date.now() });
    onPrice(symbol, price);
  }

  async function history(symbol, timeframe) {
    if (!TIMEFRAMES[timeframe]) {
      return err(
        "InvalidTimeframe",
        `timeframe must be one of ${Object.keys(TIMEFRAMES).join(", ")}`,
      );
    }
    const f = feedFor(symbol);
    if (!f.ok) return f;
    const res = await f.value.history(symbol, timeframe);
    if (!res.ok) return res;
    if (!watchers.has(symbol)) {
      const stop = f.value.streamTickers([symbol], (t) =>
        record(t.symbol, t.price),
      );
      watchers.set(symbol, stop);
    }
    const last = res.value.bars.at(-1);
    if (last && !prices.has(symbol)) record(symbol, last.close);
    return res;
  }

  return {
    history,
    lastPrices: () =>
      Object.fromEntries([...prices].map(([s, p]) => [s, p.price])),

    async price(symbol) {
      if (!prices.has(symbol)) {
        const res = await history(symbol, "1m");
        if (!res.ok) return res;
      }
      return prices.has(symbol)
        ? ok(prices.get(symbol))
        : err("NoPrice", `No price for ${symbol} yet`);
    },

    feeds: () =>
      available.map((f) => ({
        id: f.id,
        label: f.label,
        symbols: createFeed(f.id, { keys }).symbols.map((s) => s.symbol),
      })),

    close() {
      for (const stop of watchers.values()) stop();
      watchers.clear();
      for (const f of feeds.values()) f.close?.();
      feeds.clear();
    },
  };
}

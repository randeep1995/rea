// US stocks from Alpaca's market data API. A free Alpaca account (key ID
// and secret) includes IEX real-time trades and historical bars. The free
// plan allows one streaming connection, so every chart and watchlist
// subscription shares one WebSocket.
import { ok, err } from "../domain/result.js";
import { TIMEFRAMES, applyTrade } from "../domain/candles.js";
import { reconnectingSocket } from "./socket.js";

const REST = "https://data.alpaca.markets/v2";
const WS = "wss://stream.data.alpaca.markets/v2/iex";
const TIMEFRAME = {
  "1m": "1Min",
  "5m": "5Min",
  "15m": "15Min",
  "1h": "1Hour",
  "4h": "4Hour",
  "1D": "1Day",
};
const BAR_LIMIT = 500;

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

// Alpaca timestamps are RFC 3339 with up to nanosecond precision, which
// Date.parse does not accept everywhere. Keep milliseconds only.
export function parseTime(iso) {
  const trimmed = iso.replace(/(\.\d{3})\d+/, "$1");
  return Math.floor(Date.parse(trimmed) / 1000);
}

export function parseBar(b) {
  return {
    time: parseTime(b.t),
    open: b.o,
    high: b.h,
    low: b.l,
    close: b.c,
    volume: b.v,
  };
}

// Daily change from a snapshot: latest trade against the previous close.
export function snapshotTicker(symbol, snap) {
  const price = snap?.latestTrade?.p ?? snap?.dailyBar?.c;
  const prev = snap?.prevDailyBar?.c;
  if (!price) return undefined;
  return { symbol, price, changePct: prev ? (price - prev) / prev : undefined };
}

async function alpacaGet(keys, path) {
  const res = await fetch(`${REST}${path}`, {
    headers: {
      "APCA-API-KEY-ID": keys.keyId,
      "APCA-API-SECRET-KEY": keys.secret,
    },
  });
  if (!res.ok) {
    const invalidKey = res.status === 401 || res.status === 403;
    return err(
      invalidKey ? "InvalidKey" : "HttpError",
      invalidKey
        ? "Alpaca rejected the key ID or secret"
        : `Alpaca answered ${res.status}`,
      { status: res.status },
    );
  }
  return ok(await res.json());
}

// One authenticated stream; subscriptions are reference-counted per symbol.
function createTradeHub(keys, onStatus) {
  const listeners = new Map(); // symbol -> Set<(trade) => void>
  let socket;
  let authed = false;

  const subscribe = (symbols) =>
    symbols.length && socket.send({ action: "subscribe", trades: symbols });

  function handle(msg) {
    if (msg.T === "success" && msg.msg === "connected") {
      socket.send({ action: "auth", key: keys.keyId, secret: keys.secret });
    } else if (msg.T === "success" && msg.msg === "authenticated") {
      authed = true;
      subscribe([...listeners.keys()]);
    } else if (msg.T === "error") {
      onStatus?.("error", `Alpaca: ${msg.msg}`);
    } else if (msg.T === "t") {
      const trade = { price: msg.p, size: msg.s, timeSec: parseTime(msg.t) };
      for (const fn of listeners.get(msg.S) ?? []) fn(trade);
    }
  }

  function ensureSocket() {
    if (socket) return;
    socket = reconnectingSocket(WS, {
      onStatus(s) {
        if (s !== "live") authed = false;
        onStatus?.(s);
      },
      onMessage(batch) {
        for (const msg of Array.isArray(batch) ? batch : [batch]) handle(msg);
      },
    });
  }

  return {
    listen(symbol, fn) {
      ensureSocket();
      if (!listeners.has(symbol)) {
        listeners.set(symbol, new Set());
        if (authed) subscribe([symbol]);
      }
      listeners.get(symbol).add(fn);
      return () => {
        const set = listeners.get(symbol);
        set?.delete(fn);
        if (set && set.size === 0) {
          listeners.delete(symbol);
          if (authed) socket.send({ action: "unsubscribe", trades: [symbol] });
        }
      };
    },
    close() {
      socket?.close();
      socket = undefined;
      authed = false;
      listeners.clear();
    },
  };
}

export function createAlpacaFeed({ keys, onStatus }) {
  const hub = createTradeHub(keys, onStatus);
  const get = (path) => alpacaGet(keys, path);

  async function history(symbol, tf) {
    // Newest bars first, then reversed, so the chart always ends at now.
    const res = await get(
      `/stocks/${encodeURIComponent(symbol)}/bars?timeframe=${TIMEFRAME[tf]}&limit=${BAR_LIMIT}&sort=desc&feed=iex&adjustment=split&start=2000-01-01T00:00:00Z`,
    );
    if (!res.ok) return res;
    const bars = (res.value.bars ?? []).map(parseBar).reverse();
    if (bars.length === 0) {
      return err("NoData", `Alpaca has no ${tf} bars for ${symbol}`);
    }
    return ok({ bars });
  }

  return {
    id: "alpaca",
    label: "US stocks · Alpaca (key)",
    quote: "USD",
    symbols: SYMBOLS,

    async history(symbol, tf) {
      try {
        return await history(symbol, tf);
      } catch (e) {
        return err(
          "NetworkError",
          `Couldn't reach Alpaca: ${e.message}. If the browser blocked the request, see the README.`,
        );
      }
    },

    streamBars({ symbol, tf, bars, onBar }) {
      return hub.listen(symbol, (trade) => {
        const bar = applyTrade(bars, trade, TIMEFRAMES[tf]);
        if (bar) onBar(bar);
      });
    },

    streamTickers(symbols, onTicker) {
      const prevClose = new Map();
      get(`/stocks/snapshots?symbols=${symbols.join(",")}&feed=iex`)
        .then((res) => {
          if (!res.ok) return;
          for (const symbol of symbols) {
            const snap = res.value[symbol];
            if (snap?.prevDailyBar?.c)
              prevClose.set(symbol, snap.prevDailyBar.c);
            const t = snapshotTicker(symbol, snap);
            if (t) onTicker(t);
          }
        })
        .catch(() => {});
      const stops = symbols.map((symbol) =>
        hub.listen(symbol, ({ price }) => {
          const pc = prevClose.get(symbol);
          onTicker({
            symbol,
            price,
            changePct: pc ? (price - pc) / pc : undefined,
          });
        }),
      );
      return () => stops.forEach((s) => s());
    },

    close: () => hub.close(),
  };
}

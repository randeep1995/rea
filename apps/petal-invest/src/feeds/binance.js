// Crypto market data from Binance's public market-data endpoints. No API
// key; real-time klines and 24h tickers over WebSocket.
import { ok, err } from "../domain/result.js";
import { upsertBar } from "../domain/candles.js";
import { reconnectingSocket } from "./socket.js";

const REST = "https://data-api.binance.vision/api/v3";
const WS = "wss://data-stream.binance.vision";
const INTERVALS = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "1h": "1h",
  "4h": "4h",
  "1D": "1d",
};

const SYMBOLS = [
  { symbol: "BTCUSDT", name: "Bitcoin" },
  { symbol: "ETHUSDT", name: "Ethereum" },
  { symbol: "SOLUSDT", name: "Solana" },
  { symbol: "BNBUSDT", name: "BNB" },
  { symbol: "XRPUSDT", name: "XRP" },
  { symbol: "DOGEUSDT", name: "Dogecoin" },
  { symbol: "ADAUSDT", name: "Cardano" },
  { symbol: "LINKUSDT", name: "Chainlink" },
];

export function parseKline(row) {
  return {
    time: Math.floor(row[0] / 1000),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
  };
}

export function parseStreamKline(k) {
  return {
    time: Math.floor(k.t / 1000),
    open: Number(k.o),
    high: Number(k.h),
    low: Number(k.l),
    close: Number(k.c),
    volume: Number(k.v),
  };
}

export function createBinanceFeed({ onStatus } = {}) {
  return {
    id: "binance",
    label: "Crypto · Binance (live)",
    quote: "USDT",
    symbols: SYMBOLS,

    async history(symbol, tf) {
      const url = `${REST}/klines?symbol=${encodeURIComponent(symbol)}&interval=${INTERVALS[tf]}&limit=500`;
      try {
        const res = await fetch(url);
        if (!res.ok) {
          return err("HttpError", `Binance answered ${res.status}`, {
            status: res.status,
          });
        }
        const rows = await res.json();
        return ok({ bars: rows.map(parseKline) });
      } catch (e) {
        return err("NetworkError", `Couldn't reach Binance: ${e.message}`);
      }
    },

    streamBars({ symbol, tf, bars, onBar }) {
      const stream = `${symbol.toLowerCase()}@kline_${INTERVALS[tf]}`;
      const socket = reconnectingSocket(`${WS}/ws/${stream}`, {
        onStatus,
        onMessage(msg) {
          if (msg.e !== "kline") return;
          const bar = upsertBar(bars, parseStreamKline(msg.k));
          if (bar) onBar(bar);
        },
      });
      return () => socket.close();
    },

    streamTickers(symbols, onTicker) {
      const streams = symbols
        .map((s) => `${s.toLowerCase()}@miniTicker`)
        .join("/");
      const socket = reconnectingSocket(`${WS}/stream?streams=${streams}`, {
        onMessage(msg) {
          const d = msg.data;
          if (d?.e !== "24hrMiniTicker") return;
          const price = Number(d.c);
          const open = Number(d.o);
          onTicker({ symbol: d.s, price, changePct: (price - open) / open });
        },
      });
      return () => socket.close();
    },
  };
}

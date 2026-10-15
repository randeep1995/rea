// Trading engine for agents: market data from the same feeds the terminal
// uses, plus one persistent paper account. Runs in Node (fetch and
// WebSocket are built in from Node 22).
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { ok, err } from "../src/domain/result.js";
import {
  createAccount,
  placeOrder,
  cancelOrder,
  onPrice,
  equity,
} from "../src/domain/paper.js";
import { createMarketData, INDICATORS } from "./market.js";

export { keysFromEnv } from "./market.js";
export const INDICATOR_NAMES = Object.keys(INDICATORS);
const MAX_BARS = 500;

function loadAccount(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (parsed && typeof parsed.cash === "number") return parsed;
  } catch {
    // Missing or unreadable: start a fresh account.
  }
  return createAccount();
}

function saveAccount(path, account) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(account, null, 2));
  renameSync(tmp, path);
}

const round = (n, d) => Math.round(n * 10 ** d) / 10 ** d;
// Seven significant digits keeps both 65123.45 and 0.123456 exact enough
// while trimming float noise from the agent's context.
const sig = (n) => (Number.isFinite(n) ? Number(n.toPrecision(7)) : null);

function latestIndicators(bars, names) {
  const out = {};
  for (const name of names) {
    const v = INDICATORS[name](bars);
    out[name] = Array.isArray(v)
      ? sig(v.at(-1)?.value)
      : {
          upper: sig(v.upper.at(-1)?.value),
          middle: sig(v.middle.at(-1)?.value),
          lower: sig(v.lower.at(-1)?.value),
        };
  }
  return out;
}

function summarize(account, last) {
  const e = equity(account, last);
  return {
    summary: {
      equity: round(e.equity, 2),
      cash: round(e.cash, 2),
      buyingPower: round(e.buyingPower, 2),
      unrealizedPnl: round(e.unrealized, 2),
      realizedPnl: round(e.realized, 2),
    },
    positions: Object.entries(account.positions).map(([symbol, p]) => ({
      symbol,
      qty: round(p.qty, 8),
      avgPrice: sig(p.avgPrice),
      last: last[symbol] === undefined ? null : sig(last[symbol]),
      unrealizedPnl:
        last[symbol] === undefined
          ? null
          : round((last[symbol] - p.avgPrice) * p.qty, 2),
    })),
    openOrders: account.orders.filter((o) => o.status === "open"),
  };
}

// Compact bars for agents: [time, open, high, low, close, volume] rows
// plus the latest value of each requested indicator.
async function agentBars(
  market,
  { symbol, timeframe = "1h", limit = 100, indicators = [] },
) {
  const unknown = indicators.filter((i) => !INDICATORS[i]);
  if (unknown.length) {
    return err(
      "InvalidIndicator",
      `Unknown indicator ${unknown.join(", ")}; use ${INDICATOR_NAMES.join(", ")}`,
    );
  }
  const res = await market.history(symbol, timeframe);
  if (!res.ok) return res;
  const all = res.value.bars;
  const n = Math.max(1, Math.min(MAX_BARS, Math.floor(limit) || 100));
  return ok({
    symbol,
    timeframe,
    columns: ["time", "open", "high", "low", "close", "volume"],
    bars: all
      .slice(-n)
      .map((b) => [
        b.time,
        sig(b.open),
        sig(b.high),
        sig(b.low),
        sig(b.close),
        sig(b.volume),
      ]),
    indicators: latestIndicators(all, indicators),
    ...(res.value.note && { note: res.value.note }),
  });
}

export function createEngine({ keys = {}, accountPath, log = () => {} }) {
  let account = accountPath ? loadAccount(accountPath) : createAccount();
  const listeners = new Set();
  const snapshot = () => ({
    ...summarize(account, market.lastPrices()),
    account,
  });

  function commit(next) {
    account = next;
    if (accountPath) saveAccount(accountPath, account);
    for (const fn of listeners) fn(snapshot());
  }

  const market = createMarketData({
    keys,
    log,
    onPrice(symbol, price) {
      const next = onPrice(account, symbol, price);
      if (next !== account) commit(next);
    },
  });

  return {
    feeds: () => market.feeds(),

    async quote(symbol) {
      const p = await market.price(symbol);
      if (!p.ok) return p;
      return ok({
        symbol,
        price: sig(p.value.price),
        asOf: new Date(p.value.time).toISOString(),
      });
    },

    bars: (args) => agentBars(market, args),

    account: () => ok(summarize(account, market.lastPrices())),
    // Full state, used by the terminal to mirror the account.
    rawAccount: () => ok(snapshot()),

    orders({ status = "all", limit = 50 } = {}) {
      const list = account.orders.filter(
        (o) => status === "all" || o.status === status,
      );
      return ok(
        list.slice(0, Math.max(1, Math.min(500, Math.floor(limit) || 50))),
      );
    },

    async placeOrder(order) {
      const symbol = String(order.symbol ?? "").toUpperCase();
      const p = await market.price(symbol);
      if (!p.ok) return p;
      const res = placeOrder(
        account,
        {
          symbol,
          side: order.side,
          type: order.type ?? "market",
          qty: Number(order.qty),
          limitPrice:
            order.limitPrice === undefined
              ? undefined
              : Number(order.limitPrice),
        },
        p.value.price,
      );
      if (!res.ok) return res;
      commit(res.value);
      return ok(res.value.orders[0]);
    },

    cancelOrder(id) {
      const res = cancelOrder(account, Number(id));
      if (!res.ok) return res;
      commit(res.value);
      return ok(res.value.orders.find((o) => o.id === Number(id)));
    },

    reset(cash) {
      const amount = cash === undefined ? undefined : Number(cash);
      if (amount !== undefined && !(amount > 0)) {
        return err("InvalidAmount", "Starting cash must be above 0");
      }
      commit(createAccount(amount));
      return ok(summarize(account, market.lastPrices()).summary);
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    close: () => market.close(),
  };
}

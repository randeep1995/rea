import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TIMEFRAMES,
  applyTrade,
  upsertBar,
  resample,
} from "../src/domain/candles.js";
import { sma, ema, bollinger, rsi } from "../src/domain/indicators.js";
import {
  createAccount,
  placeOrder,
  cancelOrder,
  onPrice,
  equity,
} from "../src/domain/paper.js";
import { parseKline, parseStreamKline } from "../src/feeds/binance.js";

const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const series = (closes, step = 60) =>
  closes.map((c, i) => ({
    time: i * step,
    open: c,
    high: c,
    low: c,
    close: c,
    volume: 1,
  }));

test("trades fold into the current bar and roll into a new one", () => {
  const bars = [];
  applyTrade(bars, { price: 10, size: 1, timeSec: 61 }, 60);
  applyTrade(bars, { price: 12, size: 2, timeSec: 90 }, 60);
  applyTrade(bars, { price: 9, size: 1, timeSec: 119 }, 60);
  assert.deepEqual(bars, [
    { time: 60, open: 10, high: 12, low: 9, close: 9, volume: 4 },
  ]);
  applyTrade(bars, { price: 11, size: 1, timeSec: 120 }, 60);
  assert.equal(bars.length, 2);
  assert.equal(bars[1].open, 11);
  // A late trade for a closed bar does not rewrite it.
  assert.equal(applyTrade(bars, { price: 1, timeSec: 70 }, 60), undefined);
  assert.equal(bars[0].low, 9);
});

test("streamed bars replace the latest bar or append newer ones", () => {
  const bars = series([1, 2]);
  upsertBar(bars, { ...bars[1], close: 3 });
  assert.equal(bars.length, 2);
  assert.equal(bars[1].close, 3);
  upsertBar(bars, { ...bars[1], time: 120 });
  assert.equal(bars.length, 3);
  assert.equal(upsertBar(bars, { ...bars[0] }), undefined);
});

test("resample merges hourly bars into 4h bars", () => {
  const hourly = [1, 2, 3, 4, 5].map((c, i) => ({
    time: i * 3600,
    open: c,
    high: c + 1,
    low: c - 1,
    close: c,
    volume: 1,
  }));
  const out = resample(hourly, TIMEFRAMES["4h"]);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], {
    time: 0,
    open: 1,
    high: 5,
    low: 0,
    close: 4,
    volume: 4,
  });
});

test("SMA and EMA match hand-computed values", () => {
  const bars = series([1, 2, 3, 4, 5]);
  assert.deepEqual(
    sma(bars, 3).map((p) => p.value),
    [2, 3, 4],
  );
  const e = ema(bars, 3);
  assert.equal(e[0].value, 2);
  assert.ok(close(e[1].value, 3));
  assert.equal(e[0].time, 120);
});

test("Bollinger bands collapse on a flat series and widen on noise", () => {
  const flat = bollinger(series(Array(20).fill(5)), 20, 2);
  assert.equal(flat.upper[0].value, 5);
  assert.equal(flat.lower[0].value, 5);
  const noisy = bollinger(series([...Array(10).fill(4), ...Array(10).fill(6)]));
  assert.ok(close(noisy.middle[0].value, 5));
  assert.ok(close(noisy.upper[0].value, 7));
});

test("RSI is 100 on a pure uptrend and 50 on alternating moves", () => {
  const up = rsi(series(Array.from({ length: 20 }, (_, i) => i)), 14);
  assert.equal(up.at(-1).value, 100);
  const alt = rsi(
    series(Array.from({ length: 30 }, (_, i) => (i % 2 ? 11 : 10))),
    14,
  );
  assert.ok(Math.abs(alt.at(-1).value - 50) < 5);
});

test("Binance klines parse from REST rows and stream payloads", () => {
  const row = [1_700_000_000_000, "1.5", "2", "1", "1.75", "100"];
  assert.deepEqual(parseKline(row), {
    time: 1_700_000_000,
    open: 1.5,
    high: 2,
    low: 1,
    close: 1.75,
    volume: 100,
  });
  assert.deepEqual(
    parseStreamKline({ t: 60_000, o: "1", h: "2", l: "0.5", c: "1.5", v: "3" }),
    { time: 60, open: 1, high: 2, low: 0.5, close: 1.5, volume: 3 },
  );
});

test("market orders fill at the last price and track average cost", () => {
  let a = createAccount(1000);
  a = placeOrder(
    a,
    { symbol: "X", side: "buy", type: "market", qty: 2 },
    100,
  ).value;
  a = placeOrder(
    a,
    { symbol: "X", side: "buy", type: "market", qty: 2 },
    200,
  ).value;
  assert.equal(a.cash, 400);
  assert.deepEqual(a.positions.X, { qty: 4, avgPrice: 150 });
  a = placeOrder(
    a,
    { symbol: "X", side: "sell", type: "market", qty: 1 },
    250,
  ).value;
  assert.equal(a.realized, 100);
  assert.equal(a.positions.X.qty, 3);
  const e = equity(a, { X: 250 });
  assert.equal(e.unrealized, 300);
  assert.equal(e.equity, a.cash + 750);
});

test("limit orders rest, reserve buying power, then fill when crossed", () => {
  let a = createAccount(1000);
  const placed = placeOrder(
    a,
    { symbol: "X", side: "buy", type: "limit", qty: 5, limitPrice: 90 },
    100,
  );
  assert.ok(placed.ok);
  a = placed.value;
  assert.equal(a.orders[0].status, "open");
  assert.equal(equity(a, {}).buyingPower, 550);
  const tooBig = placeOrder(
    a,
    { symbol: "Y", side: "buy", type: "market", qty: 6 },
    100,
  );
  assert.equal(tooBig.error.tag, "InsufficientCash");
  assert.equal(onPrice(a, "X", 95), a, "no fill above the limit");
  a = onPrice(a, "X", 89);
  assert.equal(a.orders[0].status, "filled");
  assert.equal(a.orders[0].fillPrice, 90);
  assert.equal(a.cash, 550);
});

test("marketable limits fill immediately at the better last price", () => {
  const a = placeOrder(
    createAccount(1000),
    { symbol: "X", side: "buy", type: "limit", qty: 1, limitPrice: 120 },
    100,
  ).value;
  assert.equal(a.orders[0].fillPrice, 100);
});

test("sells cannot exceed holdings net of open sell orders", () => {
  let a = createAccount(1000);
  a = placeOrder(
    a,
    { symbol: "X", side: "buy", type: "market", qty: 2 },
    100,
  ).value;
  a = placeOrder(
    a,
    { symbol: "X", side: "sell", type: "limit", qty: 1.5, limitPrice: 150 },
    100,
  ).value;
  const over = placeOrder(
    a,
    { symbol: "X", side: "sell", type: "market", qty: 1 },
    100,
  );
  assert.equal(over.error.tag, "InsufficientPosition");
  const id = a.orders[0].id;
  a = cancelOrder(a, id).value;
  assert.equal(a.orders[0].status, "cancelled");
  assert.equal(cancelOrder(a, id).error.tag, "NotOpen");
});

test("orders are validated before touching the account", () => {
  const a = createAccount(1000);
  const bad = (o, px = 100) =>
    placeOrder(
      a,
      { symbol: "X", side: "buy", type: "market", qty: 1, ...o },
      px,
    ).error.tag;
  assert.equal(bad({ qty: 0 }), "InvalidQuantity");
  assert.equal(bad({ side: "short" }), "InvalidSide");
  assert.equal(bad({ type: "stop" }), "InvalidType");
  assert.equal(bad({ type: "limit", limitPrice: -1 }), "InvalidPrice");
  assert.equal(bad({}, 0), "NoPrice");
  assert.deepEqual(a, createAccount(1000));
});

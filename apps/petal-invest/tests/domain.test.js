import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createMarket,
  generateHistory,
  ASSETS,
  HISTORY_DAYS,
} from "../src/domain/market.js";
import {
  createPortfolio,
  buy,
  sell,
  buyPlaylist,
  summarize,
  valueHistory,
} from "../src/domain/portfolio.js";
import { PLAYLISTS, getPlaylist } from "../src/domain/playlists.js";
import { QUESTIONS, scoreProfile } from "../src/domain/profile.js";
import { respond } from "../src/domain/advisor.js";

const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test("history is deterministic and ends at the reference price", () => {
  const a = generateHistory(ASSETS[0], 42);
  const b = generateHistory(ASSETS[0], 42);
  assert.deepEqual(a, b);
  assert.equal(a.length, HISTORY_DAYS);
  assert.equal(a.at(-1), ASSETS[0].price);
  assert.notDeepEqual(a, generateHistory(ASSETS[0], 43));
});

test("every playlist references known assets and weights sum to 1", () => {
  const market = createMarket({ seed: 1 });
  for (const p of PLAYLISTS) {
    const total = Object.values(p.holdings).reduce((s, w) => s + w, 0);
    assert.ok(close(total, 1), `${p.id} weights sum to ${total}`);
    for (const sym of Object.keys(p.holdings)) assert.ok(market.get(sym), sym);
  }
});

test("buy spends cash and records fractional shares", () => {
  const market = createMarket({ seed: 1 });
  const r = buy(createPortfolio(1000), market, {
    symbol: "COST",
    dollars: 100,
  });
  assert.ok(r.ok);
  assert.equal(r.value.cash, 900);
  assert.ok(close(r.value.holdings.COST.shares, 100 / market.price("COST")));
  assert.equal(r.value.activity[0].side, "buy");
});

test("buy rejects bad input without mutating the portfolio", () => {
  const market = createMarket({ seed: 1 });
  const p = createPortfolio(50);
  assert.equal(
    buy(p, market, { symbol: "AAPL", dollars: 100 }).error.tag,
    "InsufficientCash",
  );
  assert.equal(
    buy(p, market, { symbol: "AAPL", dollars: 0 }).error.tag,
    "InvalidAmount",
  );
  assert.equal(
    buy(p, market, { symbol: "AAPL", dollars: Number.NaN }).error.tag,
    "InvalidAmount",
  );
  assert.equal(
    buy(p, market, { symbol: "NOPE", dollars: 10 }).error.tag,
    "UnknownSymbol",
  );
  assert.equal(p.cash, 50);
  assert.deepEqual(p.holdings, {});
});

test("partial sell keeps proportional cost; full sell closes the position", () => {
  const market = createMarket({ seed: 1 });
  const bought = buy(createPortfolio(1000), market, {
    symbol: "KO",
    dollars: 200,
  }).value;
  const half = sell(bought, market, { symbol: "KO", dollars: 100 });
  assert.ok(half.ok);
  assert.ok(close(half.value.holdings.KO.cost, 100));
  assert.equal(half.value.cash, 900);
  const value = half.value.holdings.KO.shares * market.price("KO");
  const all = sell(half.value, market, { symbol: "KO", dollars: value });
  assert.ok(all.ok);
  assert.equal(all.value.holdings.KO, undefined);
  assert.equal(all.value.cash, 1000);
});

test("sell rejects more than owned and unowned symbols", () => {
  const market = createMarket({ seed: 1 });
  const bought = buy(createPortfolio(1000), market, {
    symbol: "KO",
    dollars: 50,
  }).value;
  assert.equal(
    sell(bought, market, { symbol: "KO", dollars: 51 }).error.tag,
    "InsufficientShares",
  );
  assert.equal(
    sell(bought, market, { symbol: "PG", dollars: 1 }).error.tag,
    "NoPosition",
  );
});

test("playlist buy splits by weight and is all-or-nothing on cash", () => {
  const market = createMarket({ seed: 1 });
  const p = getPlaylist("starter");
  const r = buyPlaylist(createPortfolio(1000), market, p, 1000);
  assert.ok(r.ok);
  assert.ok(close(r.value.cash, 0, 0.01));
  assert.ok(close(r.value.holdings.VTI.cost, 600));
  assert.ok(r.value.activity.every((a) => a.playlist === "starter"));
  assert.equal(
    buyPlaylist(createPortfolio(10), market, p, 20).error.tag,
    "InsufficientCash",
  );
});

test("summary totals match cash plus position values", () => {
  const market = createMarket({ seed: 3 });
  const p = buyPlaylist(
    createPortfolio(),
    market,
    getPlaylist("glow"),
    2500,
  ).value;
  const s = summarize(p, market);
  assert.ok(close(s.total, 10_000, 0.01));
  assert.ok(close(s.invested + s.cash, s.total));
  const series = valueHistory(p, market, 21);
  assert.equal(series.length, 21);
  assert.ok(close(series.at(-1), s.total));
});

test("risk profile requires every answer and spans all levels", () => {
  assert.equal(scoreProfile({}), undefined);
  const all = (i) => Object.fromEntries(QUESTIONS.map((q) => [q.id, i]));
  assert.equal(scoreProfile(all(0)), "steady");
  assert.equal(scoreProfile(all(1)), "balanced");
  assert.equal(scoreProfile(all(2)), "bold");
  assert.equal(scoreProfile(all(9)), undefined);
});

test("coach answers from portfolio facts", () => {
  const market = createMarket({ seed: 1 });
  const empty = createPortfolio();
  const ctx = { portfolio: empty, market, risk: "steady" };
  assert.match(respond("How am I doing?", ctx).text, /nothing invested/);
  const rec = respond("What should I invest in?", ctx);
  assert.match(rec.action.route, /^#\/playlist\//);
  assert.match(respond("What's an ETF?", ctx).text, /exchange-traded fund/);
  const tech = buy(empty, market, { symbol: "NVDA", dollars: 1000 }).value;
  assert.match(
    respond("Am I diversified?", { ...ctx, portfolio: tech }).text,
    /concentrated/,
  );
  assert.match(respond("tell me about spotify", ctx).action.route, /SPOT/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine, keysFromEnv } from "../server/engine.js";
import { handleMessage, TOOLS } from "../server/mcp.js";
import { startHttp } from "../server/http.js";

const tempAccount = () =>
  join(mkdtempSync(join(tmpdir(), "petal-")), "account.json");

test("engine trades simulated symbols and persists the account", async (t) => {
  const path = tempAccount();
  const engine = createEngine({ accountPath: path });
  t.after(() => engine.close());

  const bars = await engine.bars({
    symbol: "SIM-TECH",
    timeframe: "15m",
    limit: 3,
    indicators: ["rsi14", "bb20"],
  });
  assert.ok(bars.ok);
  assert.equal(bars.value.bars.length, 3);
  assert.equal(bars.value.bars[0].length, 6);
  assert.equal(typeof bars.value.indicators.rsi14, "number");
  assert.ok(
    bars.value.indicators.bb20.upper >= bars.value.indicators.bb20.lower,
  );

  const order = await engine.placeOrder({
    symbol: "sim-tech",
    side: "buy",
    qty: 2,
  });
  assert.ok(order.ok);
  assert.equal(order.value.status, "filled");
  const saved = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(saved.positions["SIM-TECH"].qty, 2);

  const reopened = createEngine({ accountPath: path });
  t.after(() => reopened.close());
  assert.equal(reopened.account().value.positions[0].symbol, "SIM-TECH");
});

test("engine reports unusable requests as tagged errors", async (t) => {
  const engine = createEngine({});
  t.after(() => engine.close());
  const tag = async (p) => (await p).error.tag;
  assert.equal(await tag(engine.quote("AAPL")), "NoStockFeed");
  assert.equal(await tag(engine.quote("bad symbol")), "InvalidSymbol");
  assert.equal(
    await tag(engine.bars({ symbol: "SIM-TECH", timeframe: "2m" })),
    "InvalidTimeframe",
  );
  assert.equal(
    await tag(engine.bars({ symbol: "SIM-TECH", indicators: ["macd"] })),
    "InvalidIndicator",
  );
  assert.equal(
    await tag(engine.placeOrder({ symbol: "SIM-TECH", side: "sell", qty: 1 })),
    "InsufficientPosition",
  );
  assert.equal(engine.reset(-5).error.tag, "InvalidAmount");
});

test("keys are read only from complete environment variables", () => {
  assert.deepEqual(keysFromEnv({ ALPACA_KEY_ID: "id" }), {});
  assert.deepEqual(
    keysFromEnv({
      ALPACA_KEY_ID: "id",
      ALPACA_SECRET_KEY: "s",
      FINNHUB_API_KEY: "f",
    }),
    { alpaca: { keyId: "id", secret: "s" }, finnhub: "f" },
  );
});

test("MCP: initialize, list tools and trade through tools/call", async (t) => {
  const engine = createEngine({});
  t.after(() => engine.close());
  const call = (id, method, params) =>
    handleMessage(
      engine,
      { jsonrpc: "2.0", id, method, params },
      { version: "t" },
    );

  const init = await call(1, "initialize", { protocolVersion: "2025-03-26" });
  assert.equal(init.result.protocolVersion, "2025-03-26");
  assert.deepEqual(init.result.capabilities, { tools: {} });
  assert.equal(
    await handleMessage(
      engine,
      { jsonrpc: "2.0", method: "notifications/initialized" },
      {},
    ),
    undefined,
  );

  const list = await call(2, "tools/list");
  assert.deepEqual(
    list.result.tools.map((x) => x.name),
    TOOLS.map((x) => x.name),
  );
  for (const tool of list.result.tools) {
    assert.equal(tool.inputSchema.type, "object");
    assert.equal(tool.run, undefined);
  }

  const placed = await call(3, "tools/call", {
    name: "place_order",
    arguments: { symbol: "SIM-COIN", side: "buy", qty: 0.1 },
  });
  assert.equal(placed.result.structuredContent.status, "filled");
  const acct = await call(4, "tools/call", {
    name: "get_account",
    arguments: {},
  });
  assert.equal(acct.result.structuredContent.positions[0].symbol, "SIM-COIN");

  const bad = await call(5, "tools/call", {
    name: "place_order",
    arguments: { symbol: "SIM-COIN", side: "sell", qty: 5 },
  });
  assert.equal(bad.result.isError, true);
  assert.match(bad.result.content[0].text, /^InsufficientPosition/);
  assert.equal(
    (await call(6, "tools/call", { name: "nope" })).error.code,
    -32602,
  );
  assert.equal((await call(7, "bogus")).error.code, -32601);
});

test("HTTP API trades, rejects bad input and serves only the app files", async (t) => {
  const engine = createEngine({});
  const root = join(import.meta.dirname, "..");
  const server = await startHttp({ engine, root, port: 0 });
  t.after(() => {
    server.close();
    engine.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body) =>
    fetch(base + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  const order = await post("/api/orders", {
    symbol: "SIM-INDEX",
    side: "buy",
    type: "limit",
    qty: 1,
    limitPrice: 1,
  });
  assert.equal(order.status, 200);
  const { id, status } = await order.json();
  assert.equal(status, "open");
  const cancelled = await fetch(`${base}/api/orders/${id}`, {
    method: "DELETE",
  });
  assert.equal((await cancelled.json()).status, "cancelled");
  const again = await fetch(`${base}/api/orders/${id}`, { method: "DELETE" });
  assert.equal(again.status, 409);

  assert.equal((await fetch(`${base}/api/quote?symbol=AAPL`)).status, 501);
  assert.equal(
    (await post("/api/orders", { symbol: "SIM-INDEX", side: "x", qty: 1 }))
      .status,
    400,
  );
  const big = await post("/api/reset", { pad: "x".repeat(20_000) });
  assert.equal(big.status, 400);

  assert.equal((await fetch(`${base}/terminal.html`)).status, 200);
  assert.equal((await fetch(`${base}/server/engine.js`)).status, 404);
  assert.equal((await fetch(`${base}/src/../server/engine.js`)).status, 404);
  assert.equal((await fetch(`${base}/.data/account.json`)).status, 404);
});

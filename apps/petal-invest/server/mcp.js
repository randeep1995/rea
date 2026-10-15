// Minimal MCP server over stdio (newline-delimited JSON-RPC 2.0). Exposes
// the paper trading engine as tools so an AI agent can read market data
// and trade. Everything written to stdout is protocol; logs go to stderr.
import { createInterface } from "node:readline";
import { TIMEFRAMES } from "../src/domain/candles.js";
import { INDICATOR_NAMES } from "./engine.js";

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const SYMBOL = {
  type: "string",
  description:
    "BTCUSDT-style for crypto, AAPL-style for US stocks, SIM-TECH for simulated",
};

export const TOOLS = [
  {
    name: "list_markets",
    description:
      "List the market data feeds this server can use and their symbols.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    run: async (e) => ({ ok: true, value: await e.feeds() }),
  },
  {
    name: "get_quote",
    description: "Latest price for one symbol.",
    inputSchema: {
      type: "object",
      properties: { symbol: SYMBOL },
      required: ["symbol"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    run: (e, a) => e.quote(String(a.symbol).toUpperCase()),
  },
  {
    name: "get_bars",
    description:
      "OHLCV candles as [time, open, high, low, close, volume] rows (time in UTC seconds), oldest first, plus the latest value of each requested indicator.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: SYMBOL,
        timeframe: {
          type: "string",
          enum: Object.keys(TIMEFRAMES),
          default: "1h",
        },
        limit: { type: "integer", minimum: 1, maximum: 500, default: 100 },
        indicators: {
          type: "array",
          items: { type: "string", enum: INDICATOR_NAMES },
          default: [],
        },
      },
      required: ["symbol"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    run: (e, a) =>
      e.bars({
        symbol: String(a.symbol).toUpperCase(),
        timeframe: a.timeframe,
        limit: a.limit,
        indicators: a.indicators ?? [],
      }),
  },
  {
    name: "get_account",
    description:
      "Paper account summary, open positions with unrealized P&L, and working orders.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    run: (e) => e.account(),
  },
  {
    name: "list_orders",
    description: "Orders, newest first.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["all", "open", "filled", "cancelled"],
          default: "all",
        },
        limit: { type: "integer", minimum: 1, maximum: 500, default: 50 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    run: (e, a) => e.orders({ status: a.status, limit: a.limit }),
  },
  {
    name: "place_order",
    description:
      "Place a paper order (long only). Market orders fill at the latest price; limit orders rest until the live price crosses the limit. No real money is involved.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: SYMBOL,
        side: { type: "string", enum: ["buy", "sell"] },
        type: { type: "string", enum: ["market", "limit"], default: "market" },
        qty: {
          type: "number",
          exclusiveMinimum: 0,
          description: "Units; fractions allowed",
        },
        limit_price: {
          type: "number",
          exclusiveMinimum: 0,
          description: "Required for limit orders",
        },
      },
      required: ["symbol", "side", "qty"],
      additionalProperties: false,
    },
    run: (e, a) =>
      e.placeOrder({
        symbol: a.symbol,
        side: a.side,
        type: a.type ?? "market",
        qty: a.qty,
        limitPrice: a.limit_price,
      }),
  },
  {
    name: "cancel_order",
    description: "Cancel a working limit order.",
    inputSchema: {
      type: "object",
      properties: { order_id: { type: "integer" } },
      required: ["order_id"],
      additionalProperties: false,
    },
    run: (e, a) => e.cancelOrder(a.order_id),
  },
  {
    name: "reset_account",
    description:
      "Wipe the paper account (positions, orders, P&L) and start again with the given cash.",
    inputSchema: {
      type: "object",
      properties: {
        cash: { type: "number", exclusiveMinimum: 0, default: 100000 },
      },
      additionalProperties: false,
    },
    annotations: { destructiveHint: true },
    run: (e, a) => e.reset(a.cash),
  },
];

export async function handleMessage(engine, msg, { version }) {
  const { id, method, params } = msg;
  const result = (value) => ({ jsonrpc: "2.0", id, result: value });
  const error = (code, message) => ({
    jsonrpc: "2.0",
    id,
    error: { code, message },
  });
  if (id === undefined) return undefined; // notification
  switch (method) {
    case "initialize": {
      const asked = params?.protocolVersion;
      return result({
        protocolVersion: PROTOCOL_VERSIONS.includes(asked)
          ? asked
          : PROTOCOL_VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: { name: "petal-invest", version },
        instructions:
          "Paper trading sandbox with live market data. Use get_bars and get_quote to analyse, place_order to trade, get_account to check results. No real money.",
      });
    }
    case "ping":
      return result({});
    case "tools/list":
      return result({
        tools: TOOLS.map(({ run: _run, ...tool }) => tool),
      });
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === params?.name);
      if (!tool) return error(-32602, `Unknown tool ${params?.name}`);
      const out = await tool.run(engine, params.arguments ?? {});
      if (!out.ok) {
        return result({
          content: [
            { type: "text", text: `${out.error.tag}: ${out.error.message}` },
          ],
          isError: true,
        });
      }
      const structured =
        Array.isArray(out.value) || out.value === undefined
          ? { items: out.value ?? [] }
          : out.value;
      return result({
        content: [{ type: "text", text: JSON.stringify(out.value) }],
        structuredContent: structured,
      });
    }
    default:
      return error(-32601, `Method not found: ${method}`);
  }
}

export function runStdio(
  engine,
  { version = "0.1.0", input = process.stdin, output = process.stdout } = {},
) {
  const rl = createInterface({ input });
  rl.on("line", async (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      output.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })}\n`,
      );
      return;
    }
    const reply = await handleMessage(engine, msg, { version }).catch((e) => ({
      jsonrpc: "2.0",
      id: msg.id,
      error: { code: -32603, message: e.message },
    }));
    if (reply) output.write(`${JSON.stringify(reply)}\n`);
  });
  return rl;
}

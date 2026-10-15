#!/usr/bin/env node
// Petal server.
//   node server/index.js           web app + JSON API on http://127.0.0.1:8765
//   node server/index.js --mcp     the same, plus an MCP server on stdio
// With --mcp, if a Petal server is already running on the port, the MCP
// server uses it so the agent and the browser share one account.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createEngine, keysFromEnv } from "./engine.js";
import { startHttp } from "./http.js";
import { createRemoteEngine, isPetalServer } from "./remote.js";
import { runStdio } from "./mcp.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const { values } = parseArgs({
  options: {
    mcp: { type: "boolean", default: false },
    port: { type: "string", default: process.env.PETAL_PORT ?? "8765" },
    data: {
      type: "string",
      default: process.env.PETAL_DATA ?? join(root, ".data", "account.json"),
    },
  },
});
const port = Number(values.port);
const log = (m) => process.stderr.write(`[petal] ${m}\n`);

const engine = createEngine({
  keys: keysFromEnv(process.env),
  accountPath: values.data,
  log,
});
let active = engine;
try {
  await startHttp({ engine, root, port });
  log(`web app and API on http://127.0.0.1:${port} (account: ${values.data})`);
} catch (e) {
  const url = `http://127.0.0.1:${port}`;
  if (e.code === "EADDRINUSE" && values.mcp && (await isPetalServer(url))) {
    engine.close();
    active = createRemoteEngine(url);
    log(`using the Petal server already running on ${url}`);
  } else {
    log(`could not listen on port ${port}: ${e.message}`);
    process.exit(1);
  }
}

if (values.mcp) {
  runStdio(active).on("close", () => process.exit(0));
}

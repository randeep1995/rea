// Local HTTP server: serves Petal Invest and Petal Terminal, and exposes the
// engine as a JSON API for agents in any language. Binds to loopback only;
// there is no authentication.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};
const STATIC =
  /^\/(index\.html|terminal\.html|styles\.css|terminal\.css|src\/.+\.js)?$/;
const MAX_BODY = 16 * 1024;

const STATUS = {
  NotFound: 404,
  NotOpen: 409,
  NoPrice: 503,
  NetworkError: 502,
  HttpError: 502,
  InvalidKey: 502,
  NoStockFeed: 501,
};

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function reply(res, result) {
  if (result.ok) return send(res, 200, result.value);
  send(res, STATUS[result.error.tag] ?? 400, { error: result.error });
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error("Request body too large");
    chunks.push(chunk);
  }
  return chunks.length
    ? JSON.parse(Buffer.concat(chunks).toString("utf8"))
    : {};
}

async function serveStatic(root, path, res) {
  const rel = path === "/" ? "index.html" : path.slice(1);
  const file = normalize(join(root, rel));
  if (!file.startsWith(root + sep))
    return send(res, 404, { error: "Not found" });
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
    });
    res.end(body);
  } catch {
    send(res, 404, { error: "Not found" });
  }
}

function events(engine, req, res) {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  const push = (snap) => res.write(`data: ${JSON.stringify(snap)}\n\n`);
  push(engine.rawAccount().value);
  const stop = engine.subscribe(push);
  const keepAlive = setInterval(() => res.write(": ping\n\n"), 15_000);
  req.on("close", () => {
    stop();
    clearInterval(keepAlive);
  });
}

const sym = (q) => String(q.get("symbol") ?? "").toUpperCase();
const num = (q, k) => (q.has(k) ? Number(q.get(k)) : undefined);

const ROUTES = {
  "GET /api/health": () => ({
    ok: true,
    value: { ok: true, app: "petal-invest" },
  }),
  "GET /api/feeds": (e) => ({ ok: true, value: e.feeds() }),
  "GET /api/quote": (e, q) => e.quote(sym(q)),
  "GET /api/bars": (e, q) =>
    e.bars({
      symbol: sym(q),
      timeframe: q.get("timeframe") ?? undefined,
      limit: num(q, "limit"),
      indicators: q.get("indicators")?.split(",").filter(Boolean) ?? [],
    }),
  "GET /api/account": (e, q) => (q.get("raw") ? e.rawAccount() : e.account()),
  "GET /api/orders": (e, q) =>
    e.orders({ status: q.get("status") ?? undefined, limit: num(q, "limit") }),
  "POST /api/orders": async (e, _q, req) => e.placeOrder(await readJson(req)),
  "POST /api/reset": async (e, _q, req) => e.reset((await readJson(req)).cash),
};

async function api(engine, req, res, url) {
  const route = `${req.method} ${url.pathname}`;
  if (route === "GET /api/events") return events(engine, req, res);
  if (ROUTES[route]) {
    return reply(res, await ROUTES[route](engine, url.searchParams, req));
  }
  const cancel = url.pathname.match(/^\/api\/orders\/(\d+)$/);
  if (req.method === "DELETE" && cancel) {
    return reply(res, engine.cancelOrder(cancel[1]));
  }
  send(res, 404, { error: { tag: "NotFound", message: `No route ${route}` } });
}

export function startHttp({ engine, root, port, host = "127.0.0.1" }) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${host}`);
    try {
      if (url.pathname.startsWith("/api/"))
        return await api(engine, req, res, url);
      if (req.method === "GET" && STATIC.test(url.pathname)) {
        return await serveStatic(root, url.pathname, res);
      }
      send(res, 404, { error: "Not found" });
    } catch (e) {
      send(res, 400, { error: { tag: "BadRequest", message: e.message } });
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve(server));
  });
}

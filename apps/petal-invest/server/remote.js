// Engine client for a Petal server that is already running, so a second
// process (for example the MCP server) shares its account instead of
// keeping its own.
import { ok, err } from "../src/domain/result.js";

export function createRemoteEngine(baseUrl) {
  async function call(method, path, body) {
    try {
      const init = { method };
      if (body) {
        init.headers = { "content-type": "application/json" };
        init.body = JSON.stringify(body);
      }
      const res = await fetch(`${baseUrl}${path}`, init);
      const data = await res.json();
      return res.ok
        ? ok(data)
        : err(
            data.error?.tag ?? "HttpError",
            data.error?.message ?? `HTTP ${res.status}`,
          );
    } catch (e) {
      return err(
        "NetworkError",
        `Petal server unreachable at ${baseUrl}: ${e.message}`,
      );
    }
  }
  const qs = (params) =>
    new URLSearchParams(
      Object.entries(params)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)]),
    ).toString();

  return {
    feeds: async () => (await call("GET", "/api/feeds")).value ?? [],
    quote: (symbol) => call("GET", `/api/quote?${qs({ symbol })}`),
    bars: ({ symbol, timeframe, limit, indicators = [] }) =>
      call(
        "GET",
        `/api/bars?${qs({ symbol, timeframe, limit, indicators: indicators.join(",") || undefined })}`,
      ),
    account: () => call("GET", "/api/account"),
    orders: ({ status, limit } = {}) =>
      call("GET", `/api/orders?${qs({ status, limit })}`),
    placeOrder: (order) => call("POST", "/api/orders", order),
    cancelOrder: (id) => call("DELETE", `/api/orders/${Number(id)}`),
    reset: (cash) => call("POST", "/api/reset", { cash }),
    close() {},
  };
}

export async function isPetalServer(baseUrl) {
  try {
    const res = await fetch(`${baseUrl}/api/health`);
    return res.ok && (await res.json()).app === "petal-invest";
  } catch {
    return false;
  }
}

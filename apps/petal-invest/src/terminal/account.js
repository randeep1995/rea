// Where the paper account lives. Opened as a static page, the account is
// kept in this browser. Served by the Petal server, the terminal mirrors
// the server's account, which an AI agent may be trading at the same time.
import { ok, err } from "../domain/result.js";
import {
  placeOrder,
  cancelOrder,
  onPrice,
  createAccount,
} from "../domain/paper.js";

async function isPetalServer() {
  try {
    const res = await fetch("/api/health");
    return res.ok && (await res.json()).app === "petal-invest";
  } catch {
    return false;
  }
}

function localAccount(state, persist, onChange) {
  const apply = (result) => {
    if (!result.ok) return result;
    state.account = result.value;
    persist();
    onChange();
    return ok(state.account.orders[0]);
  };
  return {
    shared: false,
    place: async (order, lastPrice) =>
      apply(placeOrder(state.account, order, lastPrice)),
    cancel: async (id) => {
      const r = apply(cancelOrder(state.account, id));
      return r.ok ? ok(state.account.orders.find((o) => o.id === id)) : r;
    },
    reset: async () => apply(ok(createAccount())),
    onPrice(symbol, price) {
      const next = onPrice(state.account, symbol, price);
      if (next === state.account) return;
      state.account = next;
      persist();
      onChange();
    },
  };
}

function serverAccount(state, onChange) {
  async function call(method, path, body) {
    try {
      const init = { method };
      if (body) {
        init.headers = { "content-type": "application/json" };
        init.body = JSON.stringify(body);
      }
      const res = await fetch(path, init);
      const data = await res.json();
      return res.ok ? ok(data) : err(data.error?.tag, data.error?.message);
    } catch (e) {
      return err("NetworkError", `Petal server unreachable: ${e.message}`);
    }
  }
  // The server pushes the whole account after every change, including
  // fills it makes from its own price feed and the agent's orders.
  const events = new EventSource("/api/events");
  events.addEventListener("message", (e) => {
    state.account = JSON.parse(e.data).account;
    onChange();
  });
  return {
    shared: true,
    place: (order) => call("POST", "/api/orders", order),
    cancel: (id) => call("DELETE", `/api/orders/${id}`),
    reset: () => call("POST", "/api/reset", {}),
    onPrice() {},
  };
}

export async function connectAccount({ state, persist, onChange }) {
  if (await isPetalServer()) {
    const res = await fetch("/api/account?raw=1");
    state.account = (await res.json()).account;
    return serverAccount(state, onChange);
  }
  return localAccount(state, persist, onChange);
}

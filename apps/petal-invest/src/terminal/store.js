// Terminal settings and the paper account, kept in this browser only.
import { createAccount } from "../domain/paper.js";

const KEY = "petal-terminal:v1";

export function defaults() {
  return {
    feed: "binance",
    symbol: {},
    tf: "15m",
    indicators: { sma: true, ema: false, bb: false, rsi: true, volume: true },
    keys: {},
    account: createAccount(),
  };
}

export function loadTerminal() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!parsed?.account) return defaults();
    const d = defaults();
    return {
      ...d,
      ...parsed,
      indicators: { ...d.indicators, ...parsed.indicators },
    };
  } catch {
    return defaults();
  }
}

// keepStoredAccount: the terminal is mirroring the server's account, so
// keep this browser's own paper account as it was.
export function saveTerminal(state, { keepStoredAccount = false } = {}) {
  try {
    let toSave = state;
    if (keepStoredAccount) {
      const stored = JSON.parse(localStorage.getItem(KEY) ?? "null");
      toSave = { ...state, account: stored?.account ?? createAccount() };
    }
    localStorage.setItem(KEY, JSON.stringify(toSave));
  } catch {
    // Storage unavailable; the session still works.
  }
}

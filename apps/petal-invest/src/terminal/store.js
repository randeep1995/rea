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

export function saveTerminal(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable; the session still works.
  }
}

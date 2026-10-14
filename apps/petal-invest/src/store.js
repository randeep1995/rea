// Persists the simulated account in this browser only.
import { createPortfolio } from "./domain/portfolio.js";

const KEY = "petal-invest:v1";

export function freshState() {
  return {
    seed: Math.floor(Math.random() * 1e6) + 1,
    answers: {},
    risk: undefined,
    portfolio: createPortfolio(),
    chat: [],
  };
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return freshState();
    const parsed = JSON.parse(raw);
    if (!parsed?.portfolio || typeof parsed.seed !== "number") {
      return freshState();
    }
    return { ...freshState(), ...parsed };
  } catch {
    return freshState();
  }
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Storage can be unavailable (private mode); the session still works.
  }
}

export function clear() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

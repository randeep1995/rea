import { createBinanceFeed } from "./binance.js";
import { createFinnhubFeed } from "./finnhub.js";
import { createSimulatedFeed } from "./simulated.js";

export const FEEDS = [
  { id: "binance", label: "Crypto · Binance (live, no key)", needsKey: false },
  {
    id: "finnhub",
    label: "US stocks · Finnhub (live, free key)",
    needsKey: true,
  },
  { id: "simulated", label: "Simulated (offline)", needsKey: false },
];

export function createFeed(id, { keys = {}, onStatus } = {}) {
  if (id === "finnhub")
    return createFinnhubFeed({ apiKey: keys.finnhub, onStatus });
  if (id === "simulated") return createSimulatedFeed({ onStatus });
  return createBinanceFeed({ onStatus });
}

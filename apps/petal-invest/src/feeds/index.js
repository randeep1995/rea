import { createAlpacaFeed } from "./alpaca.js";
import { createBinanceFeed } from "./binance.js";
import { createFinnhubFeed } from "./finnhub.js";
import { createSimulatedFeed } from "./simulated.js";

// hasKey reads the keys saved under API keys; feeds without it need none.
export const FEEDS = [
  { id: "binance", label: "Crypto · Binance (live, no key)" },
  {
    id: "alpaca",
    label: "US stocks · Alpaca (live + history, free key)",
    hasKey: (keys) => Boolean(keys.alpaca?.keyId && keys.alpaca?.secret),
    keyHint: "This feed needs a free Alpaca key ID and secret.",
  },
  {
    id: "finnhub",
    label: "US stocks · Finnhub (live only, free key)",
    hasKey: (keys) => Boolean(keys.finnhub),
    keyHint: "This feed needs a free Finnhub API key.",
  },
  { id: "simulated", label: "Simulated (offline)" },
];

export function createFeed(id, { keys = {}, onStatus } = {}) {
  if (id === "alpaca") return createAlpacaFeed({ keys: keys.alpaca, onStatus });
  if (id === "finnhub") {
    return createFinnhubFeed({ apiKey: keys.finnhub, onStatus });
  }
  if (id === "simulated") return createSimulatedFeed({ onStatus });
  return createBinanceFeed({ onStatus });
}

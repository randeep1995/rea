// Simulated market. Every price here is generated locally from a seeded
// random walk; nothing is fetched from a real exchange.

export const ASSETS = [
  { symbol: "AAPL", name: "Apple", sector: "Tech", price: 228, vol: 0.016 },
  { symbol: "MSFT", name: "Microsoft", sector: "Tech", price: 421, vol: 0.015 },
  { symbol: "NVDA", name: "Nvidia", sector: "Tech", price: 132, vol: 0.03 },
  { symbol: "GOOGL", name: "Alphabet", sector: "Tech", price: 168, vol: 0.018 },
  { symbol: "AMZN", name: "Amazon", sector: "Retail", price: 186, vol: 0.019 },
  { symbol: "COST", name: "Costco", sector: "Retail", price: 905, vol: 0.011 },
  { symbol: "NKE", name: "Nike", sector: "Retail", price: 82, vol: 0.02 },
  {
    symbol: "LULU",
    name: "Lululemon",
    sector: "Retail",
    price: 268,
    vol: 0.024,
  },
  {
    symbol: "ELF",
    name: "e.l.f. Beauty",
    sector: "Beauty",
    price: 118,
    vol: 0.032,
  },
  {
    symbol: "ULTA",
    name: "Ulta Beauty",
    sector: "Beauty",
    price: 384,
    vol: 0.019,
  },
  {
    symbol: "EL",
    name: "Estée Lauder",
    sector: "Beauty",
    price: 92,
    vol: 0.022,
  },
  { symbol: "SPOT", name: "Spotify", sector: "Media", price: 372, vol: 0.025 },
  { symbol: "NFLX", name: "Netflix", sector: "Media", price: 705, vol: 0.021 },
  { symbol: "DIS", name: "Disney", sector: "Media", price: 94, vol: 0.016 },
  { symbol: "TSLA", name: "Tesla", sector: "Mobility", price: 238, vol: 0.035 },
  { symbol: "ENPH", name: "Enphase", sector: "Energy", price: 111, vol: 0.033 },
  {
    symbol: "NEE",
    name: "NextEra Energy",
    sector: "Energy",
    price: 82,
    vol: 0.013,
  },
  {
    symbol: "FSLR",
    name: "First Solar",
    sector: "Energy",
    price: 245,
    vol: 0.03,
  },
  {
    symbol: "JNJ",
    name: "Johnson & Johnson",
    sector: "Health",
    price: 161,
    vol: 0.01,
  },
  {
    symbol: "PG",
    name: "Procter & Gamble",
    sector: "Staples",
    price: 170,
    vol: 0.009,
  },
  { symbol: "KO", name: "Coca-Cola", sector: "Staples", price: 70, vol: 0.008 },
  {
    symbol: "VTI",
    name: "Total US Market ETF",
    sector: "Index",
    price: 285,
    vol: 0.009,
  },
  {
    symbol: "VXUS",
    name: "International ETF",
    sector: "Index",
    price: 64,
    vol: 0.009,
  },
  {
    symbol: "BND",
    name: "Total Bond ETF",
    sector: "Bonds",
    price: 73,
    vol: 0.003,
  },
];

export const HISTORY_DAYS = 180;

// mulberry32: small, fast, deterministic PRNG.
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSymbol(symbol) {
  let h = 2166136261;
  for (const ch of symbol) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

const round2 = (n) => Math.round(n * 100) / 100;

// Daily closes ending at the asset's reference price, so the "current"
// price is stable across reloads for the same seed.
export function generateHistory(asset, seed = 1, days = HISTORY_DAYS) {
  const rand = seededRandom(hashSymbol(asset.symbol) ^ seed);
  const steps = [];
  for (let i = 0; i < days - 1; i++) {
    steps.push((rand() - 0.48) * asset.vol * 2);
  }
  const closes = [asset.price];
  for (let i = steps.length - 1; i >= 0; i--) {
    closes.unshift(closes[0] / (1 + steps[i]));
  }
  return closes.map(round2);
}

export function createMarket({ seed = 1 } = {}) {
  const rand = seededRandom(seed * 7919);
  const quotes = new Map(
    ASSETS.map((a) => {
      const history = generateHistory(a, seed);
      return [a.symbol, { ...a, history, price: history.at(-1) }];
    }),
  );
  return {
    list: () => [...quotes.values()],
    get: (symbol) => quotes.get(symbol),
    price: (symbol) => quotes.get(symbol)?.price,
    // One intraday tick: small move proportional to the asset's volatility.
    tick() {
      for (const q of quotes.values()) {
        const move = (rand() - 0.5) * q.vol * 0.25;
        q.price = round2(Math.max(0.01, q.price * (1 + move)));
      }
    },
  };
}

export function dayChange(quote) {
  const prev = quote.history.at(-2) ?? quote.price;
  return { abs: quote.price - prev, pct: (quote.price - prev) / prev };
}

export function changeOver(quote, days) {
  const start = quote.history.at(-days) ?? quote.history[0];
  return (quote.price - start) / start;
}

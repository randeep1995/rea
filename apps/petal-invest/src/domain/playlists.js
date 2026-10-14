// Curated themed baskets ("playlists"). Weights sum to 1.
export const PLAYLISTS = [
  {
    id: "starter",
    title: "First Paycheck",
    emoji: "🌱",
    tagline: "Broad, low-cost index funds to start with.",
    risk: "steady",
    holdings: { VTI: 0.6, VXUS: 0.25, BND: 0.15 },
  },
  {
    id: "glow",
    title: "Glow Up",
    emoji: "💄",
    tagline: "Beauty brands you already buy from.",
    risk: "bold",
    holdings: { ELF: 0.35, ULTA: 0.35, EL: 0.3 },
  },
  {
    id: "main-character",
    title: "Main Character Tech",
    emoji: "✨",
    tagline: "The companies behind your phone, feed and AI.",
    risk: "bold",
    holdings: { AAPL: 0.25, MSFT: 0.25, NVDA: 0.3, GOOGL: 0.2 },
  },
  {
    id: "on-repeat",
    title: "On Repeat",
    emoji: "🎧",
    tagline: "Streaming and entertainment you can't stop watching.",
    risk: "balanced",
    holdings: { SPOT: 0.4, NFLX: 0.4, DIS: 0.2 },
  },
  {
    id: "clean-energy",
    title: "Sunny Days",
    emoji: "☀️",
    tagline: "Clean energy and the grid of the future.",
    risk: "bold",
    holdings: { ENPH: 0.3, FSLR: 0.35, NEE: 0.35 },
  },
  {
    id: "everyday",
    title: "Everyday Essentials",
    emoji: "🛒",
    tagline: "Steady brands people buy in any economy.",
    risk: "steady",
    holdings: { COST: 0.3, PG: 0.25, KO: 0.25, JNJ: 0.2 },
  },
  {
    id: "athleisure",
    title: "Athleisure Era",
    emoji: "👟",
    tagline: "Leggings, sneakers and the shops that sell them.",
    risk: "balanced",
    holdings: { LULU: 0.4, NKE: 0.35, AMZN: 0.25 },
  },
];

export function getPlaylist(id) {
  return PLAYLISTS.find((p) => p.id === id);
}

// Value-weighted return of the basket over the last `days` sessions.
export function playlistReturn(playlist, market, days) {
  let total = 0;
  for (const [symbol, weight] of Object.entries(playlist.holdings)) {
    const q = market.get(symbol);
    const start = q.history.at(-days) ?? q.history[0];
    total += weight * ((q.price - start) / start);
  }
  return total;
}

export function playlistsForRisk(risk) {
  const order = { steady: 0, balanced: 1, bold: 2 };
  return [...PLAYLISTS].sort(
    (a, b) =>
      Math.abs(order[a.risk] - order[risk]) -
      Math.abs(order[b.risk] - order[risk]),
  );
}

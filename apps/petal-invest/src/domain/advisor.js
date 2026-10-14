// "Petal Coach": a local, rule-based assistant that answers from the
// user's simulated portfolio. It is not an LLM and gives no real advice.
import { summarize, sectorBreakdown } from "./portfolio.js";
import { PLAYLISTS, playlistsForRisk, playlistReturn } from "./playlists.js";
import { PROFILES } from "./profile.js";
import { changeOver } from "./market.js";

const usd = (n) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const pct = (n) => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)}%`;

export const SUGGESTED_PROMPTS = [
  "How am I doing?",
  "What should I invest in?",
  "Am I diversified?",
  "What's an ETF?",
];

const GLOSSARY = {
  etf: "An ETF (exchange-traded fund) is a basket of many investments you can buy as one. VTI, for example, holds thousands of US companies, so one purchase spreads your money widely.",
  "index fund":
    "An index fund tracks a whole market index instead of picking winners. They're cheap and diversified, which is why they anchor most long-term portfolios.",
  bond: "A bond is a loan to a government or company that pays interest. Bonds usually move less than stocks, so they steady a portfolio.",
  dividend:
    "A dividend is a share of profits a company pays to shareholders, usually every quarter.",
  diversif:
    "Diversification means not putting all your eggs in one basket. Owning many companies across sectors means one bad day for a single stock hurts less.",
  fractional:
    "Fractional shares let you buy a slice of a share with any dollar amount, so a $900 stock is open to you with $5.",
};

export function respond(question, { portfolio, market, risk }) {
  const q = question.toLowerCase();
  const s = summarize(portfolio, market);

  for (const [term, answer] of Object.entries(GLOSSARY)) {
    if (q.includes(term) && /what|explain|mean|define/.test(q)) {
      return { text: answer };
    }
  }

  if (/how am i|doing|performance|gain|return/.test(q)) {
    if (s.positions.length === 0) {
      return {
        text: `You have ${usd(s.cash)} in cash and nothing invested yet. A playlist is an easy first step.`,
        action: { label: "Browse playlists", route: "#/discover" },
      };
    }
    const best = [...s.positions].sort(
      (a, b) => b.gain / b.cost - a.gain / a.cost,
    )[0];
    return {
      text: `Your portfolio is worth ${usd(s.total)}. Your investments are ${pct(s.gainPct)} overall (${usd(s.gain)}), and today you're ${s.dayGain >= 0 ? "up" : "down"} ${usd(Math.abs(s.dayGain))}. Your best performer is ${best.name} at ${pct(best.gain / best.cost)}.`,
    };
  }

  if (/divers|spread|concentrat|balance/.test(q)) {
    const sectors = sectorBreakdown(portfolio, market);
    const entries = Object.entries(sectors).sort((a, b) => b[1] - a[1]);
    if (entries.length === 0) {
      return {
        text: "You're all cash right now, so there's nothing to diversify yet.",
      };
    }
    const [topSector, topValue] = entries[0];
    const share = topValue / s.invested;
    if (share > 0.5) {
      return {
        text: `${Math.round(share * 100)}% of your invested money is in ${topSector}. That's concentrated: a rough week for that sector would hit you hard. Adding a broad fund like the First Paycheck playlist would spread it out.`,
        action: { label: "See First Paycheck", route: "#/playlist/starter" },
      };
    }
    return {
      text: `You're spread across ${entries.length} sectors, the largest being ${topSector} at ${Math.round(share * 100)}%. That's reasonably diversified.`,
    };
  }

  if (/invest in|buy|should i|recommend|suggest|start/.test(q)) {
    const pick = playlistsForRisk(risk ?? "balanced")[0];
    const profile = PROFILES[risk ?? "balanced"];
    return {
      text: `For a ${profile.label} investor, ${pick.emoji} ${pick.title} fits well: ${pick.tagline.toLowerCase()} It's ${pct(playlistReturn(pick, market, 90))} over the last 90 days in this simulation.`,
      action: { label: `Open ${pick.title}`, route: `#/playlist/${pick.id}` },
    };
  }

  if (/trend|hot|popular|best/.test(q)) {
    const top = [...PLAYLISTS]
      .map((p) => ({ p, r: playlistReturn(p, market, 30) }))
      .sort((a, b) => b.r - a.r)[0];
    return {
      text: `The strongest playlist this month is ${top.p.emoji} ${top.p.title} at ${pct(top.r)}. Past moves don't predict future ones, though.`,
      action: { label: "Take a look", route: `#/playlist/${top.p.id}` },
    };
  }

  // Tickers match whole words only ("tell" must not match EL).
  const words = new Set(q.split(/[^a-z.]+/));
  const symbol = market
    .list()
    .find(
      (a) =>
        words.has(a.symbol.toLowerCase()) || q.includes(a.name.toLowerCase()),
    );
  if (symbol) {
    return {
      text: `${symbol.name} (${symbol.symbol}) is ${usd(symbol.price)}, ${pct(changeOver(symbol, 30))} over 30 days. It's in the ${symbol.sector} sector.`,
      action: {
        label: `View ${symbol.symbol}`,
        route: `#/stock/${symbol.symbol}`,
      },
    };
  }

  return {
    text: "I can tell you how your portfolio is doing, check your diversification, suggest a playlist, or explain terms like ETF, bond or dividend. Try one of the suggestions below.",
  };
}

import { ok, err } from "./result.js";

export const STARTING_CASH = 10_000;
const EPS = 1e-9;
const round2 = (n) => Math.round(n * 100) / 100;

export function createPortfolio(cash = STARTING_CASH) {
  return { cash, holdings: {}, activity: [] };
}

// Market order for a dollar amount (fractional shares). Returns a new
// portfolio; the input is never mutated.
// order: { symbol, dollars, playlist? }
export function buy(portfolio, market, { symbol, dollars, playlist }) {
  const price = market.price(symbol);
  if (price === undefined) return err("UnknownSymbol", `No asset ${symbol}`);
  if (!(dollars > 0)) return err("InvalidAmount", "Enter an amount above $0");
  if (dollars > portfolio.cash + EPS) {
    return err("InsufficientCash", "Not enough cash for this order", {
      available: portfolio.cash,
    });
  }
  const shares = dollars / price;
  const prev = portfolio.holdings[symbol] ?? { shares: 0, cost: 0 };
  return ok({
    cash: round2(portfolio.cash - dollars),
    holdings: {
      ...portfolio.holdings,
      [symbol]: { shares: prev.shares + shares, cost: prev.cost + dollars },
    },
    activity: [
      { side: "buy", symbol, dollars, shares, price, at: Date.now(), playlist },
      ...portfolio.activity,
    ],
  });
}

export function sell(portfolio, market, { symbol, dollars }) {
  const price = market.price(symbol);
  if (price === undefined) return err("UnknownSymbol", `No asset ${symbol}`);
  const held = portfolio.holdings[symbol];
  if (!held) return err("NoPosition", `You don't own ${symbol}`);
  if (!(dollars > 0)) return err("InvalidAmount", "Enter an amount above $0");
  const value = held.shares * price;
  if (dollars > value + 0.005) {
    return err("InsufficientShares", "That's more than you own", {
      available: value,
    });
  }
  // Selling within a cent of the full value closes the position.
  const closing = dollars >= value - 0.005;
  const shares = closing ? held.shares : dollars / price;
  const proceeds = closing ? value : dollars;
  const holdings = { ...portfolio.holdings };
  if (closing) delete holdings[symbol];
  else {
    const fraction = shares / held.shares;
    holdings[symbol] = {
      shares: held.shares - shares,
      cost: held.cost * (1 - fraction),
    };
  }
  return ok({
    cash: round2(portfolio.cash + proceeds),
    holdings,
    activity: [
      {
        side: "sell",
        symbol,
        dollars: proceeds,
        shares,
        price,
        at: Date.now(),
      },
      ...portfolio.activity,
    ],
  });
}

// Split one deposit across a playlist's weights as one all-or-nothing order.
export function buyPlaylist(portfolio, market, playlist, dollars) {
  if (!(dollars > 0)) return err("InvalidAmount", "Enter an amount above $0");
  if (dollars > portfolio.cash + EPS) {
    return err("InsufficientCash", "Not enough cash for this order", {
      available: portfolio.cash,
    });
  }
  let next = portfolio;
  for (const [symbol, weight] of Object.entries(playlist.holdings)) {
    const result = buy(next, market, {
      symbol,
      dollars: dollars * weight,
      playlist: playlist.id,
    });
    if (!result.ok) return result;
    next = result.value;
  }
  return ok(next);
}

export function summarize(portfolio, market) {
  const positions = Object.entries(portfolio.holdings).map(([symbol, h]) => {
    const quote = market.get(symbol);
    const value = h.shares * quote.price;
    const prevClose = quote.history.at(-2) ?? quote.price;
    return {
      symbol,
      name: quote.name,
      shares: h.shares,
      cost: h.cost,
      value,
      gain: value - h.cost,
      dayGain: h.shares * (quote.price - prevClose),
    };
  });
  positions.sort((a, b) => b.value - a.value);
  const invested = positions.reduce((s, p) => s + p.value, 0);
  const cost = positions.reduce((s, p) => s + p.cost, 0);
  const dayGain = positions.reduce((s, p) => s + p.dayGain, 0);
  return {
    positions,
    cash: portfolio.cash,
    invested,
    total: invested + portfolio.cash,
    gain: invested - cost,
    gainPct: cost > 0 ? (invested - cost) / cost : 0,
    dayGain,
  };
}

// Portfolio value per day using today's share counts against history.
export function valueHistory(portfolio, market, days) {
  const out = [];
  for (let i = days; i >= 1; i--) {
    let v = portfolio.cash;
    for (const [symbol, h] of Object.entries(portfolio.holdings)) {
      const q = market.get(symbol);
      v += h.shares * (i === 1 ? q.price : (q.history.at(-i) ?? q.price));
    }
    out.push(v);
  }
  return out;
}

export function sectorBreakdown(portfolio, market) {
  const totals = {};
  for (const [symbol, h] of Object.entries(portfolio.holdings)) {
    const q = market.get(symbol);
    totals[q.sector] = (totals[q.sector] ?? 0) + h.shares * q.price;
  }
  return totals;
}

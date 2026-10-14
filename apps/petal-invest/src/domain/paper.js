// Paper trading account: quantity-based market and limit orders, long only.
// Prices come from whichever feed is active; no order leaves the browser.
import { ok, err } from "./result.js";

export const PAPER_STARTING_CASH = 100_000;
const EPS = 1e-9;

export function createAccount(cash = PAPER_STARTING_CASH) {
  return { cash, positions: {}, orders: [], realized: 0, nextId: 1 };
}

const clone = (a) => ({
  ...a,
  positions: { ...a.positions },
  orders: [...a.orders],
});

// Cash held back by open buy limits, and quantity held back by open sells.
function reservedCash(account) {
  return account.orders
    .filter((o) => o.status === "open" && o.side === "buy")
    .reduce((s, o) => s + o.qty * o.limitPrice, 0);
}

function reservedQty(account, symbol) {
  return account.orders
    .filter(
      (o) => o.status === "open" && o.side === "sell" && o.symbol === symbol,
    )
    .reduce((s, o) => s + o.qty, 0);
}

function fill(account, order, price, at) {
  const pos = account.positions[order.symbol] ?? { qty: 0, avgPrice: 0 };
  if (order.side === "buy") {
    const qty = pos.qty + order.qty;
    account.positions[order.symbol] = {
      qty,
      avgPrice: (pos.qty * pos.avgPrice + order.qty * price) / qty,
    };
    account.cash -= order.qty * price;
  } else {
    account.realized += (price - pos.avgPrice) * order.qty;
    account.cash += order.qty * price;
    const qty = pos.qty - order.qty;
    if (qty <= EPS) delete account.positions[order.symbol];
    else account.positions[order.symbol] = { ...pos, qty };
  }
  return { ...order, status: "filled", fillPrice: price, filledAt: at };
}

function validateOrder({ symbol, side, type, qty, limitPrice }, lastPrice) {
  if (side !== "buy" && side !== "sell") {
    return err("InvalidSide", "Pick buy or sell");
  }
  if (type !== "market" && type !== "limit") {
    return err("InvalidType", "Pick market or limit");
  }
  if (!(qty > 0)) return err("InvalidQuantity", "Enter a quantity above 0");
  if (!(lastPrice > 0)) {
    return err("NoPrice", `No live price for ${symbol} yet`);
  }
  if (type === "limit" && !(limitPrice > 0)) {
    return err("InvalidPrice", "Enter a limit price above 0");
  }
  return ok();
}

function checkFunds(account, { symbol, side, qty }, price) {
  if (side === "buy") {
    const available = account.cash - reservedCash(account);
    if (qty * price > available + EPS) {
      return err("InsufficientCash", "Not enough buying power", { available });
    }
    return ok();
  }
  const held = account.positions[symbol]?.qty ?? 0;
  const available = held - reservedQty(account, symbol);
  if (qty > available + EPS) {
    return err("InsufficientPosition", "You can't sell more than you hold", {
      available,
    });
  }
  return ok();
}

// order: { symbol, side: "buy"|"sell", type: "market"|"limit", qty, limitPrice? }
export function placeOrder(account, order, lastPrice, at = Date.now()) {
  const valid = validateOrder(order, lastPrice);
  if (!valid.ok) return valid;
  const { symbol, side, type, qty } = order;
  const limitPrice = type === "limit" ? order.limitPrice : undefined;
  const marketable =
    type === "market" ||
    (side === "buy" ? lastPrice <= limitPrice : lastPrice >= limitPrice);
  // A resting limit reserves funds at its limit; anything else fills at last.
  const execPrice = marketable ? lastPrice : limitPrice;
  const funds = checkFunds(account, order, execPrice);
  if (!funds.ok) return funds;

  const next = clone(account);
  const placed = {
    id: next.nextId++,
    symbol,
    side,
    type,
    qty,
    limitPrice,
    status: "open",
    createdAt: at,
  };
  next.orders.unshift(marketable ? fill(next, placed, execPrice, at) : placed);
  return ok(next);
}

export function cancelOrder(account, id) {
  const index = account.orders.findIndex((o) => o.id === id);
  if (index === -1 || account.orders[index].status !== "open") {
    return err("NotOpen", "That order is no longer open");
  }
  const next = clone(account);
  next.orders[index] = { ...next.orders[index], status: "cancelled" };
  return ok(next);
}

// Fill open limits that the new price crosses. Fills at the limit price.
// Returns the same account object when nothing fills.
export function onPrice(account, symbol, price, at = Date.now()) {
  const crosses = (o) =>
    o.status === "open" &&
    o.symbol === symbol &&
    (o.side === "buy" ? price <= o.limitPrice : price >= o.limitPrice);
  if (!account.orders.some(crosses)) return account;
  const next = clone(account);
  next.orders = next.orders.map((o) =>
    crosses(o) ? fill(next, o, o.limitPrice, at) : o,
  );
  return next;
}

export function equity(account, prices) {
  let positionsValue = 0;
  let unrealized = 0;
  for (const [symbol, p] of Object.entries(account.positions)) {
    const price = prices[symbol] ?? p.avgPrice;
    positionsValue += p.qty * price;
    unrealized += p.qty * (price - p.avgPrice);
  }
  return {
    cash: account.cash,
    buyingPower: account.cash - reservedCash(account),
    positionsValue,
    unrealized,
    realized: account.realized,
    equity: account.cash + positionsValue,
  };
}

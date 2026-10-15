import { TIMEFRAMES, barStart } from "../domain/candles.js";
import { equity } from "../domain/paper.js";
import { FEEDS, createFeed } from "../feeds/index.js";
import { escapeHtml as h } from "../ui/format.js";
import { createPriceChart } from "./chart.js";
import { loadTerminal, saveTerminal } from "./store.js";
import { connectAccount } from "./account.js";

const INDICATORS = [
  { id: "volume", label: "Vol" },
  { id: "sma", label: "SMA 20" },
  { id: "ema", label: "EMA 50" },
  { id: "bb", label: "BB 20" },
  { id: "rsi", label: "RSI 14" },
];

const $ = (id) => document.getElementById(id);
const state = loadTerminal();
const prices = {}; // last known price per symbol, from any feed
let feed;
let symbol;
let bars = [];
let stopBars = () => {};
let stopTickers = () => {};
let loadToken = 0;
let side = "buy";
let blotterTab = "positions";

let sharedAccount = false;
const persist = () => saveTerminal(state, { keepStoredAccount: sharedAccount });

// ---------- formatting ----------

function precisionFor(price) {
  if (!(price > 0)) return 2;
  if (price < 1) return 5;
  if (price < 10) return 4;
  return 2;
}
const fmt = (n, p = precisionFor(n)) =>
  n === undefined || Number.isNaN(n)
    ? "–"
    : n.toLocaleString("en-US", {
        minimumFractionDigits: p,
        maximumFractionDigits: p,
      });
const money = (n) => `$${fmt(n, 2)}`;
const signed = (n) => `${n >= 0 ? "+" : "−"}${money(Math.abs(n))}`;
const pctText = (n) =>
  n === undefined
    ? ""
    : `${n >= 0 ? "+" : "−"}${Math.abs(n * 100).toFixed(2)}%`;
const qtyText = (n) => n.toLocaleString("en-US", { maximumFractionDigits: 6 });
const tone = (n) => (n >= 0 ? "up" : "down");

// ---------- status ----------

const STATUS_TEXT = {
  connecting: "Connecting…",
  live: "Live",
  reconnecting: "Reconnecting…",
  error: "Offline",
  idle: "Not connected",
};
function setStatus(s, detail) {
  const el = $("status");
  el.className = `status ${s}`;
  el.textContent = detail ?? STATUS_TEXT[s] ?? s;
}

function banner(html) {
  const el = $("banner");
  el.hidden = !html;
  el.innerHTML = html ?? "";
}

// ---------- feed lifecycle ----------

function startFeed() {
  stopBars();
  stopTickers();
  feed?.close?.();
  const meta = FEEDS.find((f) => f.id === state.feed) ?? FEEDS[0];
  $("feed").value = meta.id;
  if (meta.hasKey && !meta.hasKey(state.keys)) {
    feed = undefined;
    setStatus("idle");
    banner(
      `${h(meta.keyHint)} <button class="ghost small" data-open-keys>Add key</button>`,
    );
    renderWatchlist([]);
    bars = [];
    chart.setBars(bars, { precision: 2 });
    showChartMessage("Add a key under API keys to load this feed.");
    return;
  }
  banner(null);
  feed = createFeed(meta.id, { keys: state.keys, onStatus: setStatus });
  symbol = state.symbol[feed.id] ?? feed.symbols[0].symbol;
  renderWatchlist(feed.symbols);
  stopTickers = feed.streamTickers(
    feed.symbols.map((s) => s.symbol),
    onTicker,
  );
  loadChart();
}

async function loadChart() {
  const token = ++loadToken;
  stopBars();
  stopBars = () => {};
  $("sym").textContent = symbol;
  highlightWatchlist();
  showChartMessage("Loading…");
  const result = await feed.history(symbol, state.tf);
  if (token !== loadToken) return;
  if (!result.ok) {
    setStatus("error");
    showChartMessage(result.error.message);
    banner(h(result.error.message));
    return;
  }
  hideChartMessage();
  if (result.value.note) banner(h(result.value.note));
  bars = result.value.bars;
  const last = bars.at(-1)?.close;
  if (last) recordPrice(symbol, last);
  chart.setBars(bars, { precision: precisionFor(last) });
  drawFills();
  stopBars = feed.streamBars({
    symbol,
    tf: state.tf,
    bars,
    onBar(bar) {
      if (token !== loadToken) return;
      chart.updateBar(bar, bars);
      recordPrice(symbol, bar.close);
    },
  });
}

function onTicker({ symbol: s, price, changePct }) {
  recordPrice(s, price);
  const row = document.querySelector(`[data-symbol="${CSS.escape(s)}"]`);
  if (!row) return;
  const px = row.querySelector(".px");
  const prev = Number(px.dataset.v);
  px.textContent = fmt(price);
  px.dataset.v = price;
  if (prev && prev !== price) {
    px.classList.remove("flash-up", "flash-down");
    void px.offsetWidth;
    px.classList.add(price > prev ? "flash-up" : "flash-down");
  }
  if (changePct !== undefined) {
    const chg = row.querySelector(".chg");
    chg.textContent = pctText(changePct);
    chg.className = `chg ${tone(changePct)}`;
  }
}

// ---------- prices and paper fills ----------

let accountDirty = false;
function recordPrice(s, price) {
  prices[s] = price;
  accounts.onPrice(s, price);
  if (!accountDirty) {
    accountDirty = true;
    requestAnimationFrame(() => {
      accountDirty = false;
      renderTicketNumbers();
      renderAccount();
      renderBlotter();
    });
  }
}

function drawFills() {
  const tfSec = TIMEFRAMES[state.tf];
  const first = bars[0]?.time ?? Infinity;
  const fills = state.account.orders
    .filter((o) => o.status === "filled" && o.symbol === symbol)
    .map((o) => ({
      ...o,
      barTime: barStart(Math.floor(o.filledAt / 1000), tfSec),
    }))
    .filter((o) => o.barTime >= first)
    .sort((a, b) => a.barTime - b.barTime);
  chart.setFills(fills);
}

// ---------- chart ----------

const chart = createPriceChart($("chart"), {
  onCrosshair(bar) {
    if (!bar) {
      $("ohlc").innerHTML = "";
      return;
    }
    const change = bar.close - bar.open;
    $("ohlc").innerHTML = ["O", "H", "L", "C"]
      .map(
        (k, i) =>
          `${k} <b>${fmt([bar.open, bar.high, bar.low, bar.close][i])}</b>`,
      )
      .join("")
      .concat(
        `<span class="${tone(change)}">${change >= 0 ? "+" : ""}${fmt(change)} (${pctText(change / bar.open)})</span>`,
      );
  },
});

function showChartMessage(text) {
  let el = $("chart-empty-msg");
  if (!el) {
    el = document.createElement("div");
    el.id = "chart-empty-msg";
    el.className = "chart-empty";
    $("chart").append(el);
  }
  el.textContent = text;
}
function hideChartMessage() {
  $("chart-empty-msg")?.remove();
}

function renderToolbar() {
  $("tfs").innerHTML = Object.keys(TIMEFRAMES)
    .map(
      (tf) =>
        `<button type="button" data-tf="${tf}" aria-pressed="${tf === state.tf}">${tf}</button>`,
    )
    .join("");
  $("inds").innerHTML = INDICATORS.map(
    (i) =>
      `<button type="button" data-ind="${i.id}" aria-pressed="${Boolean(state.indicators[i.id])}">${i.label}</button>`,
  ).join("");
  chart.setIndicators(state.indicators);
}

// ---------- watchlist ----------

function renderWatchlist(symbols) {
  $("watchlist").innerHTML = symbols
    .map(
      (s) => `<li><button type="button" data-symbol="${h(s.symbol)}">
        <strong>${h(s.symbol)}</strong><span class="px" data-v="">${fmt(prices[s.symbol])}</span>
        <span class="name">${h(s.name)}</span><span class="chg"></span>
      </button></li>`,
    )
    .join("");
  highlightWatchlist();
}

function highlightWatchlist() {
  for (const b of document.querySelectorAll("#watchlist button")) {
    b.classList.toggle("active", b.dataset.symbol === symbol);
  }
}

// ---------- order ticket ----------

const form = $("order-form");

function readOrder() {
  const type = form.elements.type.value;
  return {
    symbol,
    side,
    type,
    qty: Number(form.elements.qty.value),
    limitPrice:
      type === "limit" ? Number(form.elements.limitPrice.value) : undefined,
  };
}

function renderTicketNumbers() {
  const last = prices[symbol];
  const order = readOrder();
  const px = order.type === "limit" ? order.limitPrice : last;
  const e = equity(state.account, prices);
  $("last").textContent = fmt(last);
  $("est").textContent = order.qty > 0 && px > 0 ? money(order.qty * px) : "–";
  const held = state.account.positions[symbol]?.qty ?? 0;
  $("avail").textContent =
    side === "buy" ? money(e.buyingPower) : `${qtyText(held)} ${symbol}`;
  $("submit").disabled = !feed;
}

function setSide(next) {
  side = next;
  for (const b of document.querySelectorAll(".side-tabs button")) {
    const active = b.dataset.side === side;
    b.classList.toggle("active", active);
    b.setAttribute("aria-selected", String(active));
  }
  $("submit").className = `submit ${side}`;
  $("submit").textContent =
    `${side === "buy" ? "Buy" : "Sell"} ${symbol ?? ""}`;
  $("order-error").textContent = "";
  renderTicketNumbers();
}

form.addEventListener("input", (e) => {
  if (e.target.name === "type") {
    $("limit-field").hidden = e.target.value !== "limit";
    if (
      e.target.value === "limit" &&
      !form.elements.limitPrice.value &&
      prices[symbol]
    ) {
      form.elements.limitPrice.value = fmt(prices[symbol]).replace(/,/g, "");
    }
  }
  $("order-error").textContent = "";
  renderTicketNumbers();
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const result = await accounts.place(readOrder(), prices[symbol]);
  if (!result.ok) {
    $("order-error").textContent = result.error.message;
    return;
  }
  form.elements.qty.value = "";
  $("order-error").textContent = "";
  blotterTab = result.value.status === "open" ? "open" : "positions";
  renderBlotter();
});

document.querySelector(".pct-row").addEventListener("click", (e) => {
  const pct = Number(e.target.dataset.pct);
  if (!pct) return;
  const order = readOrder();
  const px = order.type === "limit" ? order.limitPrice : prices[symbol];
  let qty = 0;
  if (side === "buy" && px > 0)
    qty = (equity(state.account, prices).buyingPower * pct) / px;
  if (side === "sell") qty = (state.account.positions[symbol]?.qty ?? 0) * pct;
  form.elements.qty.value = qty > 0 ? String(Math.floor(qty * 1e6) / 1e6) : "";
  renderTicketNumbers();
});

// ---------- account and blotter ----------

function renderAccount() {
  const e = equity(state.account, prices);
  $("account").innerHTML = `
    <div><dt>Equity</dt><dd>${money(e.equity)}</dd></div>
    <div><dt>Cash</dt><dd>${money(e.cash)}</dd></div>
    <div><dt>Buying power</dt><dd>${money(e.buyingPower)}</dd></div>
    <div><dt>Unrealized P&amp;L</dt><dd class="${tone(e.unrealized)}">${signed(e.unrealized)}</dd></div>
    <div><dt>Realized P&amp;L</dt><dd class="${tone(e.realized)}">${signed(e.realized)}</dd></div>`;
}

function renderBlotter() {
  for (const b of document.querySelectorAll(".blotter-tabs button")) {
    const active = b.dataset.tab === blotterTab;
    b.classList.toggle("active", active);
    b.setAttribute("aria-selected", String(active));
  }
  const orders = state.account.orders;
  let html;
  if (blotterTab === "positions") {
    const rows = Object.entries(state.account.positions).map(([s, p]) => {
      const last = prices[s];
      const pnl = last ? (last - p.avgPrice) * p.qty : undefined;
      return `<tr><td>${h(s)}</td><td>${qtyText(p.qty)}</td><td>${fmt(p.avgPrice)}</td><td>${fmt(last)}</td>
        <td>${last ? money(last * p.qty) : "–"}</td>
        <td class="${tone(pnl ?? 0)}">${pnl === undefined ? "–" : `${signed(pnl)} (${pctText(last / p.avgPrice - 1)})`}</td></tr>`;
    });
    html = rows.length
      ? `<table><thead><tr><th>Symbol</th><th>Qty</th><th>Avg price</th><th>Last</th><th>Value</th><th>Unrealized P&amp;L</th></tr></thead><tbody>${rows.join("")}</tbody></table>`
      : `<p class="empty">No open positions.</p>`;
  } else {
    const list = orders.filter((o) =>
      blotterTab === "open" ? o.status === "open" : o.status !== "open",
    );
    const rows = list.map(
      (
        o,
      ) => `<tr><td>${h(o.symbol)}</td><td class="${o.side === "buy" ? "up" : "down"}">${o.side}</td><td>${o.type}</td>
        <td>${qtyText(o.qty)}</td><td>${o.limitPrice ? fmt(o.limitPrice) : "–"}</td>
        <td>${o.fillPrice ? fmt(o.fillPrice) : "–"}</td><td>${o.status}</td>
        <td>${new Date(o.filledAt ?? o.createdAt).toLocaleTimeString()}</td>
        <td>${o.status === "open" ? `<button type="button" data-cancel="${o.id}">Cancel</button>` : ""}</td></tr>`,
    );
    html = rows.length
      ? `<table><thead><tr><th>Symbol</th><th>Side</th><th>Type</th><th>Qty</th><th>Limit</th><th>Fill</th><th>Status</th><th>Time</th><th></th></tr></thead><tbody>${rows.join("")}</tbody></table>`
      : `<p class="empty">${blotterTab === "open" ? "No working orders." : "No orders yet."}</p>`;
  }
  $("blotter").innerHTML = html;
}

function renderAll() {
  setSide(side);
  renderAccount();
  renderBlotter();
}

// ---------- events ----------

document.addEventListener("click", (e) => {
  const t = e.target.closest("button");
  if (!t) return;
  if (t.dataset.symbol && feed) {
    symbol = t.dataset.symbol;
    state.symbol[feed.id] = symbol;
    persist();
    setSide(side);
    form.elements.limitPrice.value = "";
    loadChart();
  } else if (t.dataset.tf) {
    state.tf = t.dataset.tf;
    persist();
    renderToolbar();
    if (feed) loadChart();
  } else if (t.dataset.ind) {
    state.indicators[t.dataset.ind] = !state.indicators[t.dataset.ind];
    persist();
    renderToolbar();
  } else if (t.dataset.side) {
    setSide(t.dataset.side);
  } else if (t.dataset.tab) {
    blotterTab = t.dataset.tab;
    renderBlotter();
  } else if (t.dataset.cancel) {
    accounts.cancel(Number(t.dataset.cancel));
  } else if (t.id === "key-btn" || t.hasAttribute("data-open-keys")) {
    const f = $("keys-form").elements;
    f.finnhub.value = state.keys.finnhub ?? "";
    f.alpacaKeyId.value = state.keys.alpaca?.keyId ?? "";
    f.alpacaSecret.value = state.keys.alpaca?.secret ?? "";
    $("keys").showModal();
  } else if (t.id === "reset") {
    if (
      confirm("Reset the paper account? Positions, orders and P&L are cleared.")
    ) {
      accounts.reset();
    }
  }
});

$("keys").addEventListener("close", () => {
  if ($("keys").returnValue !== "save") return;
  const f = $("keys-form").elements;
  const finnhub = f.finnhub.value.trim();
  const keyId = f.alpacaKeyId.value.trim();
  const secret = f.alpacaSecret.value.trim();
  state.keys = {
    ...(finnhub && { finnhub }),
    ...(keyId && secret && { alpaca: { keyId, secret } }),
  };
  persist();
  if (state.feed !== "binance" && state.feed !== "simulated") startFeed();
});

$("feed").innerHTML = FEEDS.map(
  (f) => `<option value="${f.id}">${h(f.label)}</option>`,
).join("");
$("feed").addEventListener("change", (e) => {
  state.feed = e.target.value;
  persist();
  startFeed();
});

const accounts = await connectAccount({
  state,
  persist,
  onChange() {
    drawFills();
    renderAll();
  },
});
if (accounts.shared) {
  sharedAccount = true;
  const badge = document.querySelector(".paper-badge");
  badge.textContent = "Paper trading · shared with agent";
  badge.title = "This account lives on the Petal server; agents trade it too";
}

renderToolbar();
renderAll();
startFeed();

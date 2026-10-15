import { createMarket } from "../domain/market.js";
import { getPlaylist } from "../domain/playlists.js";
import { QUESTIONS } from "../domain/profile.js";
import {
  buy,
  sell,
  buyPlaylist,
  createPortfolio,
} from "../domain/portfolio.js";
import { respond } from "../domain/advisor.js";
import { save, clear, freshState } from "../store.js";
import { usd, shares, escapeHtml as h } from "./format.js";
import { ctx } from "./context.js";
import { SCREENS, quoteRow } from "./screens.js";

const TICK_MS = 4000;

let sheet = null; // open trade sheet: { kind, target, side, step, amount, error }

const $view = document.getElementById("view");
const $sheet = document.getElementById("sheet");
const $tabs = document.getElementById("tabs");

function commit(next) {
  ctx.state = { ...ctx.state, ...next };
  save(ctx.state);
}

// ---------- routing ----------

function parseRoute() {
  const [name = "", arg] = location.hash.replace(/^#\/?/, "").split("/");
  return { name, arg: arg && decodeURIComponent(arg) };
}

function go(route) {
  if (location.hash === route) render();
  else location.hash = route;
}

function render({ keepScroll = false } = {}) {
  let { name, arg } = parseRoute();
  const onboarded = ctx.state.risk !== undefined;
  const onboarding = ["welcome", "quiz", "result"].includes(name);
  if (!onboarded && !onboarding) name = "welcome";
  if (!SCREENS[name]) name = onboarded ? "home" : "welcome";
  const scroll = keepScroll ? $view.scrollTop : 0;
  $view.innerHTML = SCREENS[name](arg);
  $view.scrollTop = scroll;
  $tabs.hidden = onboarding || !onboarded;
  for (const a of $tabs.querySelectorAll("a")) {
    const active =
      a.dataset.tab === name ||
      (a.dataset.tab === "discover" && ["playlist", "stock"].includes(name));
    a.classList.toggle("active", active);
    a.setAttribute("aria-current", active ? "page" : "false");
  }
  if (name === "coach") {
    const log = document.getElementById("chat-log");
    if (log) log.scrollTop = log.scrollHeight;
  }
}

// ---------- trade sheet ----------

function openTrade(kind, target, side) {
  sheet = { kind, target, side, step: "amount", amount: "", error: null };
  renderSheet();
}

function closeSheet() {
  sheet = null;
  renderSheet();
  render({ keepScroll: true });
}

function sheetTitle() {
  if (sheet.kind === "playlist") return getPlaylist(sheet.target).title;
  return ctx.market.get(sheet.target).name;
}

function maxAmount() {
  if (sheet.side === "buy") return ctx.state.portfolio.cash;
  const held = ctx.state.portfolio.holdings[sheet.target];
  return held ? held.shares * ctx.market.price(sheet.target) : 0;
}

function renderSheet() {
  $sheet.hidden = !sheet;
  document.body.classList.toggle("sheet-open", Boolean(sheet));
  if (!sheet) {
    $sheet.innerHTML = "";
    return;
  }
  const verb = sheet.side === "buy" ? "Buy" : "Sell";
  const amount = Number(sheet.amount) || 0;
  let body;
  if (sheet.step === "amount") {
    const max = maxAmount();
    body = `<p class="muted center">${sheet.side === "buy" ? `${usd(ctx.state.portfolio.cash)} cash available` : `${usd(max)} available to sell`}</p>
      <label class="amount"><span>$</span><input id="amount" inputmode="decimal" placeholder="0" value="${h(sheet.amount)}" aria-label="Amount in dollars" data-action="amount"></label>
      <div class="chips center">
        ${[25, 100, 500]
          .map(
            (v) =>
              `<button class="chip" data-action="quick" data-v="${v}">$${v}</button>`,
          )
          .join("")}
        <button class="chip" data-action="quick" data-v="max">Max</button>
      </div>
      ${sheet.error ? `<p class="error" role="alert">${h(sheet.error)}</p>` : ""}
      <button class="btn primary block" data-action="review" ${amount > 0 ? "" : "disabled"}>Review</button>`;
  } else if (sheet.step === "review") {
    const lines =
      sheet.kind === "playlist"
        ? Object.entries(getPlaylist(sheet.target).holdings)
            .map(
              ([s, w]) =>
                `<li><span>${s}</span><span>${usd(amount * w)} ≈ ${shares((amount * w) / ctx.market.price(s))} sh</span></li>`,
            )
            .join("")
        : `<li><span>Market price</span><span>${usd(ctx.market.price(sheet.target))}</span></li>
           <li><span>Est. shares</span><span>${shares(amount / ctx.market.price(sheet.target))}</span></li>`;
    body = `<div class="big-number center">${usd(amount)}</div>
      <ul class="receipt">${lines}<li><span>Fees</span><span>${usd(0)}</span></li></ul>
      <p class="muted tiny center">Simulated market order. Fills instantly at the current mock price.</p>
      ${sheet.error ? `<p class="error" role="alert">${h(sheet.error)}</p>` : ""}
      <div class="two">
        <button class="btn ghost" data-action="edit">Edit</button>
        <button class="btn primary" data-action="confirm">${verb} now</button>
      </div>`;
  } else {
    body = `<div class="success" aria-hidden="true">🎉</div>
      <h3 class="center">Order filled</h3>
      <p class="center muted">You ${sheet.side === "buy" ? "invested" : "sold"} ${usd(amount)} ${sheet.side === "buy" ? "in" : "of"} ${h(sheetTitle())}.</p>
      <button class="btn primary block" data-action="done">Done</button>`;
  }
  $sheet.innerHTML = `<div class="scrim" data-action="close"></div>
    <div class="panel" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      <div class="grabber"></div>
      <h2 id="sheet-title">${sheet.step === "done" ? "" : `${verb} ${h(sheetTitle())}`}</h2>
      ${body}
    </div>`;
  document.getElementById("amount")?.focus();
}

function confirmTrade() {
  const amount = Number(sheet.amount);
  let result;
  if (sheet.kind === "playlist") {
    result = buyPlaylist(
      ctx.state.portfolio,
      ctx.market,
      getPlaylist(sheet.target),
      amount,
    );
  } else if (sheet.side === "buy") {
    result = buy(ctx.state.portfolio, ctx.market, {
      symbol: sheet.target,
      dollars: amount,
    });
  } else {
    result = sell(ctx.state.portfolio, ctx.market, {
      symbol: sheet.target,
      dollars: amount,
    });
  }
  if (!result.ok) {
    sheet.error = result.error.message;
    sheet.step = "amount";
  } else {
    commit({ portfolio: result.value });
    sheet.step = "done";
  }
  renderSheet();
}

// ---------- coach ----------

function ask(text) {
  const q = text.trim();
  if (!q) return;
  const reply = respond(q, {
    portfolio: ctx.state.portfolio,
    market: ctx.market,
    risk: ctx.state.risk,
  });
  const chat = [
    ...ctx.state.chat,
    { from: "me", text: q },
    { from: "coach", ...reply },
  ].slice(-40);
  commit({ chat });
  render();
}

// ---------- events ----------

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el || el.tagName === "FORM" || el.tagName === "INPUT") return;
  const a = el.dataset.action;
  if (a === "answer") {
    const answers = {
      ...ctx.state.answers,
      [el.dataset.q]: Number(el.dataset.opt),
    };
    commit({ answers });
    const next = Number(el.dataset.i) + 1;
    go(next < QUESTIONS.length ? `#/quiz/${next}` : "#/result");
  } else if (a === "finish-onboarding") {
    commit({ risk: el.dataset.risk });
    go("#/home");
  } else if (a === "range") {
    ctx.range = el.dataset.range;
    render({ keepScroll: true });
  } else if (a === "open-trade") {
    openTrade(el.dataset.kind, el.dataset.target, el.dataset.side);
  } else if (a === "close" || a === "done") {
    closeSheet();
  } else if (a === "quick") {
    const v = el.dataset.v === "max" ? maxAmount() : Number(el.dataset.v);
    sheet.amount = (Math.floor(v * 100) / 100).toString();
    sheet.error = null;
    renderSheet();
  } else if (a === "review") {
    sheet.step = "review";
    sheet.error = null;
    renderSheet();
  } else if (a === "edit") {
    sheet.step = "amount";
    renderSheet();
  } else if (a === "confirm") {
    confirmTrade();
  } else if (a === "ask") {
    ask(el.dataset.q);
  } else if (a === "reset") {
    if (
      confirm(
        "Reset your practice account? Holdings and history will be cleared.",
      )
    ) {
      clear();
      const fresh = freshState();
      ctx.state = {
        ...fresh,
        risk: ctx.state.risk,
        answers: ctx.state.answers,
        portfolio: createPortfolio(),
      };
      ctx.market = createMarket({ seed: ctx.state.seed });
      save(ctx.state);
      go("#/home");
    }
  }
});

document.addEventListener("input", (e) => {
  const a = e.target.dataset?.action;
  if (a === "amount") {
    const cleaned = e.target.value
      .replace(/[^0-9.]/g, "")
      .replace(/(\..*)\./g, "$1");
    e.target.value = cleaned;
    sheet.amount = cleaned;
    sheet.error = null;
    $sheet
      .querySelector('[data-action="review"]')
      ?.toggleAttribute("disabled", !(Number(cleaned) > 0));
  } else if (a === "filter") {
    ctx.filter = e.target.value;
    const needle = ctx.filter.toLowerCase();
    document.getElementById("stock-list").innerHTML =
      ctx.market
        .list()
        .filter(
          (q) =>
            !needle ||
            q.symbol.toLowerCase().includes(needle) ||
            q.name.toLowerCase().includes(needle) ||
            q.sector.toLowerCase().includes(needle),
        )
        .map(quoteRow)
        .join("") || `<li class="empty">No matches.</li>`;
  }
});

document.addEventListener("submit", (e) => {
  if (e.target.dataset.action !== "chat") return;
  e.preventDefault();
  const input = e.target.elements.q;
  ask(input.value);
  document.querySelector(".composer input")?.focus();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && sheet) closeSheet();
});

window.addEventListener("hashchange", () => render());

// Live mock ticks. Skip re-rendering while the user is typing or trading.
setInterval(() => {
  ctx.market.tick();
  const typing = document.activeElement?.tagName === "INPUT";
  const { name } = parseRoute();
  if (
    !sheet &&
    !typing &&
    ["home", "stock", "discover", "playlist"].includes(name)
  ) {
    render({ keepScroll: true });
  }
}, TICK_MS);

render();

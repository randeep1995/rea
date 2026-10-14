// Screen renderers. Each returns an HTML string for the current ctx.
import { dayChange, changeOver } from "../domain/market.js";
import {
  PLAYLISTS,
  getPlaylist,
  playlistReturn,
  playlistsForRisk,
} from "../domain/playlists.js";
import { QUESTIONS, PROFILES, scoreProfile } from "../domain/profile.js";
import { summarize, valueHistory } from "../domain/portfolio.js";
import { SUGGESTED_PROMPTS } from "../domain/advisor.js";
import { lineChart, sparkline } from "./chart.js";
import {
  usd,
  signedUsd,
  pct,
  shares,
  tone,
  escapeHtml as h,
} from "./format.js";
import { ctx, RANGES } from "./context.js";

// ---------- onboarding ----------

function welcomeScreen() {
  return `<section class="screen welcome">
    <div class="blob" aria-hidden="true">🌸</div>
    <h1>Investing that grows with you</h1>
    <p class="lede">Answer four quick questions and we'll suggest playlists of companies that match your goals.</p>
    <div class="notice">Practice mode: you get ${usd(10000, 0)} in simulated cash. Prices are generated, not real.</div>
    <a class="btn primary block" href="#/quiz/0">Get started</a>
  </section>`;
}

function quizScreen(arg) {
  const i = Math.max(0, Math.min(QUESTIONS.length - 1, Number(arg) || 0));
  const q = QUESTIONS[i];
  const chosen = ctx.state.answers[q.id];
  return `<section class="screen quiz">
    <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${QUESTIONS.length}" aria-valuenow="${i + 1}">
      <span style="width:${((i + 1) / QUESTIONS.length) * 100}%"></span>
    </div>
    <p class="eyebrow">Question ${i + 1} of ${QUESTIONS.length}</p>
    <h1>${h(q.prompt)}</h1>
    <div class="choices">
      ${q.options
        .map(
          (o, j) =>
            `<button class="choice ${chosen === j ? "selected" : ""}" data-action="answer" data-q="${q.id}" data-i="${i}" data-opt="${j}">${h(o.label)}</button>`,
        )
        .join("")}
    </div>
    ${i > 0 ? `<a class="btn ghost" href="#/quiz/${i - 1}">Back</a>` : ""}
  </section>`;
}

function resultScreen() {
  const risk = scoreProfile(ctx.state.answers);
  if (!risk) return quizScreen(0);
  const profile = PROFILES[risk];
  const picks = playlistsForRisk(risk).slice(0, 3);
  return `<section class="screen result">
    <p class="eyebrow">Your investor style</p>
    <h1 class="profile-name">${profile.label}</h1>
    <p class="lede">${h(profile.blurb)}</p>
    <h2>Playlists picked for you</h2>
    <div class="stack">${picks.map(playlistCard).join("")}</div>
    <button class="btn primary block" data-action="finish-onboarding" data-risk="${risk}">Start investing</button>
  </section>`;
}

// ---------- main screens ----------

function header(title, back) {
  return `<header class="bar">
    ${back ? `<a class="icon-btn" href="${back}" aria-label="Back">‹</a>` : ""}
    <h1>${h(title)}</h1>
  </header>`;
}

function homeScreen() {
  const s = summarize(ctx.state.portfolio, ctx.market);
  const days = RANGES[ctx.range];
  const series = valueHistory(ctx.state.portfolio, ctx.market, days);
  const rangeChange = series.at(-1) - series[0];
  const picks = playlistsForRisk(ctx.state.risk).slice(0, 3);
  return `<section class="screen home">
    <p class="eyebrow">Portfolio value</p>
    <div class="big-number" data-testid="total">${usd(s.total)}</div>
    <p class="delta ${tone(rangeChange)}">${signedUsd(rangeChange)} (${pct(rangeChange / series[0])}) <span class="muted">past ${ctx.range}</span></p>
    ${lineChart(series, { up: rangeChange >= 0 })}
    <div class="segmented" role="tablist">
      ${Object.keys(RANGES)
        .map(
          (r) =>
            `<button role="tab" aria-selected="${r === ctx.range}" data-action="range" data-range="${r}">${r}</button>`,
        )
        .join("")}
    </div>
    <div class="stats">
      <div><span class="muted">Invested</span><strong>${usd(s.invested)}</strong></div>
      <div><span class="muted">Cash</span><strong>${usd(s.cash)}</strong></div>
      <div><span class="muted">All-time</span><strong class="${tone(s.gain)}">${pct(s.gainPct)}</strong></div>
    </div>
    <h2>Your holdings</h2>
    ${
      s.positions.length
        ? `<ul class="list">${s.positions.map(positionRow).join("")}</ul>`
        : `<div class="empty">Nothing here yet. Pick a playlist below to make your first investment.</div>`
    }
    <h2>For you <span class="muted small">${PROFILES[ctx.state.risk].label}</span></h2>
    <div class="carousel">${picks.map(playlistCard).join("")}</div>
  </section>`;
}

function positionRow(p) {
  const q = ctx.market.get(p.symbol);
  return `<li><a class="row" href="#/stock/${p.symbol}">
    <span class="logo">${p.symbol.slice(0, 2)}</span>
    <span class="grow"><strong>${h(p.name)}</strong><span class="muted small">${shares(p.shares)} shares</span></span>
    ${sparkline(q.history.slice(-21).concat(q.price), p.gain >= 0)}
    <span class="right"><strong>${usd(p.value)}</strong><span class="small ${tone(p.gain)}">${signedUsd(p.gain)}</span></span>
  </a></li>`;
}

function playlistCard(p) {
  const r = playlistReturn(p, ctx.market, 63);
  return `<a class="card playlist-card risk-${p.risk}" href="#/playlist/${p.id}">
    <span class="emoji" aria-hidden="true">${p.emoji}</span>
    <strong>${h(p.title)}</strong>
    <span class="small">${h(p.tagline)}</span>
    <span class="pill ${tone(r)}">${pct(r)} 3M</span>
  </a>`;
}

function discoverScreen() {
  const needle = ctx.filter.toLowerCase();
  const stocks = ctx.market
    .list()
    .filter(
      (q) =>
        !needle ||
        q.symbol.toLowerCase().includes(needle) ||
        q.name.toLowerCase().includes(needle) ||
        q.sector.toLowerCase().includes(needle),
    );
  return `<section class="screen discover">
    ${header("Discover")}
    <h2>Playlists</h2>
    <div class="grid">${PLAYLISTS.map(playlistCard).join("")}</div>
    <h2>All stocks &amp; funds</h2>
    <input class="search" type="search" placeholder="Search name, ticker or sector" value="${h(ctx.filter)}" data-action="filter" aria-label="Search stocks">
    <ul class="list" id="stock-list">${stocks.map(quoteRow).join("") || `<li class="empty">No matches.</li>`}</ul>
  </section>`;
}

export function quoteRow(q) {
  const d = dayChange(q);
  return `<li><a class="row" href="#/stock/${q.symbol}">
    <span class="logo">${q.symbol.slice(0, 2)}</span>
    <span class="grow"><strong>${h(q.name)}</strong><span class="muted small">${q.symbol} · ${q.sector}</span></span>
    <span class="right"><strong>${usd(q.price)}</strong><span class="small ${tone(d.pct)}">${pct(d.pct)}</span></span>
  </a></li>`;
}

function playlistScreen(id) {
  const p = getPlaylist(id);
  if (!p)
    return `${header("Not found", "#/discover")}<div class="empty">That playlist doesn't exist.</div>`;
  const days = RANGES[ctx.range];
  // Basket index, normalised to 100 at the start of the range.
  const series = Array.from({ length: days }, (_, k) => {
    const back = days - k;
    let v = 0;
    for (const [sym, w] of Object.entries(p.holdings)) {
      const q = ctx.market.get(sym);
      const start = q.history.at(-days) ?? q.history[0];
      const at = back === 1 ? q.price : (q.history.at(-back) ?? q.price);
      v += w * (at / start) * 100;
    }
    return v;
  });
  const r = playlistReturn(p, ctx.market, days);
  const owned = ctx.state.portfolio.activity.some((a) => a.playlist === p.id);
  return `<section class="screen playlist">
    ${header("", "#/discover")}
    <div class="hero risk-${p.risk}">
      <span class="emoji big" aria-hidden="true">${p.emoji}</span>
      <h1>${h(p.title)}</h1>
      <p>${h(p.tagline)}</p>
      <span class="pill">${PROFILES[p.risk].label} risk</span>
    </div>
    <p class="delta ${tone(r)}">${pct(r)} <span class="muted">past ${ctx.range}</span></p>
    ${lineChart(series, { up: r >= 0 })}
    <div class="segmented" role="tablist">
      ${Object.keys(RANGES)
        .map(
          (k) =>
            `<button role="tab" aria-selected="${k === ctx.range}" data-action="range" data-range="${k}">${k}</button>`,
        )
        .join("")}
    </div>
    <h2>What's inside</h2>
    <ul class="list">
      ${Object.entries(p.holdings)
        .map(([sym, w]) => {
          const q = ctx.market.get(sym);
          return `<li><a class="row" href="#/stock/${sym}">
            <span class="logo">${sym.slice(0, 2)}</span>
            <span class="grow"><strong>${h(q.name)}</strong><span class="muted small">${sym}</span></span>
            <span class="weight"><span style="width:${w * 100}%"></span></span>
            <span class="right"><strong>${Math.round(w * 100)}%</strong></span>
          </a></li>`;
        })
        .join("")}
    </ul>
    ${owned ? `<p class="muted small center">You've invested in this playlist before.</p>` : ""}
    <div class="sticky-cta"><button class="btn primary block" data-action="open-trade" data-kind="playlist" data-target="${p.id}" data-side="buy">Invest in ${h(p.title)}</button></div>
  </section>`;
}

function stockScreen(symbol) {
  const q = ctx.market.get(symbol);
  if (!q)
    return `${header("Not found", "#/discover")}<div class="empty">Unknown ticker.</div>`;
  const days = RANGES[ctx.range];
  const series = q.history.slice(-days, -1).concat(q.price);
  const r = changeOver(q, days);
  const held = ctx.state.portfolio.holdings[symbol];
  const value = held ? held.shares * q.price : 0;
  const inPlaylists = PLAYLISTS.filter((p) => p.holdings[symbol]);
  return `<section class="screen stock">
    ${header(q.symbol, "#/discover")}
    <p class="muted">${h(q.name)} · ${q.sector}</p>
    <div class="big-number">${usd(q.price)}</div>
    <p class="delta ${tone(r)}">${pct(r)} <span class="muted">past ${ctx.range}</span></p>
    ${lineChart(series, { up: r >= 0 })}
    <div class="segmented" role="tablist">
      ${Object.keys(RANGES)
        .map(
          (k) =>
            `<button role="tab" aria-selected="${k === ctx.range}" data-action="range" data-range="${k}">${k}</button>`,
        )
        .join("")}
    </div>
    ${
      held
        ? `<div class="card position">
            <div><span class="muted small">Your position</span><strong>${usd(value)}</strong></div>
            <div><span class="muted small">Shares</span><strong>${shares(held.shares)}</strong></div>
            <div><span class="muted small">Return</span><strong class="${tone(value - held.cost)}">${signedUsd(value - held.cost)}</strong></div>
          </div>`
        : ""
    }
    ${
      inPlaylists.length
        ? `<h2>Featured in</h2><div class="carousel">${inPlaylists.map(playlistCard).join("")}</div>`
        : ""
    }
    <div class="sticky-cta two">
      ${held ? `<button class="btn ghost" data-action="open-trade" data-kind="stock" data-target="${symbol}" data-side="sell">Sell</button>` : ""}
      <button class="btn primary" data-action="open-trade" data-kind="stock" data-target="${symbol}" data-side="buy">Buy</button>
    </div>
  </section>`;
}

function coachScreen() {
  const messages = ctx.state.chat.length
    ? ctx.state.chat
    : [
        {
          from: "coach",
          text: "Hi! I'm Petal Coach. Ask me about your portfolio, a company, or an investing term.",
        },
      ];
  return `<section class="screen coach">
    ${header("Coach")}
    <div class="chat-log" id="chat-log" aria-live="polite">
      ${messages
        .map(
          (m) =>
            `<div class="bubble ${m.from}">${h(m.text)}${
              m.action
                ? `<a class="btn small" href="${h(m.action.route)}">${h(m.action.label)}</a>`
                : ""
            }</div>`,
        )
        .join("")}
    </div>
    <div class="chips">${SUGGESTED_PROMPTS.map((p) => `<button class="chip" data-action="ask" data-q="${h(p)}">${h(p)}</button>`).join("")}</div>
    <form class="composer" data-action="chat">
      <input name="q" autocomplete="off" placeholder="Ask anything about investing" aria-label="Message">
      <button class="btn primary" type="submit">Send</button>
    </form>
    <p class="muted tiny center">Rule-based demo assistant using simulated data. Not financial advice.</p>
  </section>`;
}

function activityScreen() {
  const items = ctx.state.portfolio.activity;
  return `<section class="screen activity">
    ${header("Activity")}
    ${
      items.length
        ? `<ul class="list">${items
            .map(
              (a) => `<li class="row">
          <span class="logo ${a.side}">${a.side === "buy" ? "↓" : "↑"}</span>
          <span class="grow"><strong>${a.side === "buy" ? "Bought" : "Sold"} ${a.symbol}</strong>
            <span class="muted small">${shares(a.shares)} sh @ ${usd(a.price)}${a.playlist ? ` · ${h(getPlaylist(a.playlist)?.title ?? "")}` : ""} · ${new Date(a.at).toLocaleString()}</span></span>
          <span class="right"><strong>${a.side === "buy" ? "−" : "+"}${usd(a.dollars)}</strong></span>
        </li>`,
            )
            .join("")}</ul>`
        : `<div class="empty">No trades yet.</div>`
    }
    <h2>Pro tools</h2>
    <a class="card terminal-link" href="terminal.html">
      <strong>📈 Petal Terminal</strong>
      <span class="muted small">Live crypto and stock charts, indicators and paper trading.</span>
    </a>
    <h2>Practice account</h2>
    <div class="card settings">
      <p>Investor style: <strong>${PROFILES[ctx.state.risk].label}</strong></p>
      <a class="btn ghost block" href="#/quiz/0">Retake the quiz</a>
      <button class="btn danger block" data-action="reset">Reset practice account</button>
    </div>
  </section>`;
}

export const SCREENS = {
  welcome: welcomeScreen,
  quiz: quizScreen,
  result: resultScreen,
  home: homeScreen,
  discover: discoverScreen,
  playlist: playlistScreen,
  stock: stockScreen,
  coach: coachScreen,
  activity: activityScreen,
};

# Petal Invest (prototype)

A mobile-first practice investing app inspired by the feature set of
consumer apps such as Alinea Invest. It is an original implementation:
no code, branding or assets come from Alinea.

Everything is simulated. Prices come from a seeded random walk in
`src/domain/market.js`, the account starts with $10,000 of practice cash,
and nothing talks to a brokerage, exchange or AI service.

## Features

- **Onboarding quiz** that scores four answers into a Steady, Balanced or
  Bold investor style and recommends matching playlists.
- **Portfolio home** with total value, range chart (1W to 6M), invested
  vs cash, all-time return and per-holding sparklines.
- **Playlists**: curated themed baskets (index funds, beauty, tech,
  streaming, clean energy, staples, athleisure) with weights, history and
  one-tap investing that splits a deposit across the basket.
- **Stock pages** with charts, your position and the playlists that hold it.
- **Trade flow**: amount entry with quick amounts, review receipt, fill
  confirmation; fractional buys and partial or full sells.
- **Coach**: a local rule-based assistant that answers from your simulated
  portfolio (performance, diversification, suggestions, glossary terms).
  It is not an LLM and gives no financial advice.
- **Activity** log, quiz retake and account reset. State persists in
  `localStorage` for this browser only.

## Run it

It is a dependency-free static site using ES modules, so any static server
works:

```sh
cd apps/petal-invest
python3 -m http.server 8765
# open http://localhost:8765
```

## Test it

```sh
node --test 'apps/petal-invest/tests/*.test.js'
```

The tests cover the domain layer: deterministic market history, playlist
weights, buy/sell validation and cost basis, all-or-nothing playlist
orders, portfolio summaries, risk scoring and coach answers.

## Layout

```
src/domain/   market, portfolio, playlists, risk profile, coach (pure, testable)
src/ui/       router and events (app.js), screens, trade sheet, chart, formatting
src/store.js  localStorage persistence
```

Intraday ticks are not persisted, so prices return to the seeded daily
close after a reload.

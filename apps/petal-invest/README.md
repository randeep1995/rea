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

## Petal Terminal

`terminal.html` is a TradingView-style trading screen for the same app. It
streams real market data into a paper trading account.

- **Charts** from TradingView's open-source
  [Lightweight Charts](https://github.com/tradingview/lightweight-charts)
  (Apache-2.0, pinned to 5.0.9 and loaded from jsDelivr): candles, volume,
  1m to 1D timeframes, crosshair OHLC readout and buy/sell fill markers.
- **Indicators**: SMA 20, EMA 50, Bollinger Bands 20/2 and RSI 14 in its
  own pane. They're computed in `src/domain/indicators.js`.
- **Watchlist** with live prices and daily change.
- **Order ticket** for market and limit orders, buying power, and quick
  25%/50%/max sizing. Limit orders rest and fill when the live price
  crosses them. Long only.
- **Blotter** with positions, unrealized and realized P&L, working orders
  that can be cancelled, and order history.

### Market data

| Feed | Data | Key |
| --- | --- | --- |
| Crypto · Binance | Real-time klines and tickers from Binance's public market-data endpoints (`data-api.binance.vision`) | None |
| US stocks · Finnhub | Real-time trades over WebSocket, folded into candles in the browser | Free key from [finnhub.io](https://finnhub.io/register), entered under **API keys** |
| Simulated | Seeded random walk | None, works offline |

Finnhub's free plan has no historical candles. The chart then starts from
the day's quote and builds from live trades, so it is sparse until trades
arrive and empty outside US market hours. Keys stay in this browser's
`localStorage` and are sent only to finnhub.io.

The paper account starts with $100,000 and is separate from the Petal
Invest practice account. No order leaves the browser.

## Run it

It is a dependency-free static site using ES modules, so any static server
works:

```sh
cd apps/petal-invest
python3 -m http.server 8765
# open http://localhost:8765            (Petal Invest)
# open http://localhost:8765/terminal.html (Petal Terminal)
```

## Test it

```sh
node --test 'apps/petal-invest/tests/*.test.js'
```

The tests cover the domain layer: deterministic market history, playlist
weights, buy/sell validation and cost basis, all-or-nothing playlist
orders, portfolio summaries, risk scoring and coach answers, plus the
terminal's candle building, indicators, Binance parsing and paper order
matching.

## Layout

```
src/domain/   market, portfolio, playlists, risk profile, coach, candles,
              indicators, paper trading (pure, testable)
src/ui/       router and events (app.js), screens, trade sheet, chart, formatting
src/feeds/    market data: Binance, Finnhub, simulated
src/terminal/ terminal UI, chart wrapper, settings store
src/store.js  localStorage persistence
```

Intraday ticks are not persisted, so prices return to the seeded daily
close after a reload.

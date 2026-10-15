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

| Feed                | Data                                                                                                 | Key                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Crypto · Binance    | Real-time klines and tickers from Binance's public market-data endpoints (`data-api.binance.vision`) | None                                                                 |
| US stocks · Alpaca  | Up to 500 historical bars per timeframe plus real-time IEX trades over one shared WebSocket          | Free key ID and secret from [alpaca.markets](https://alpaca.markets) |
| US stocks · Finnhub | Real-time trades only, folded into candles in the browser                                            | Free key from [finnhub.io](https://finnhub.io/register)              |
| Simulated           | Seeded random walk                                                                                   | None, works offline                                                  |

Enter keys under **API keys**. They stay in this browser's `localStorage`
and are sent only to the provider they belong to.

Alpaca's free plan streams the IEX exchange only, so prices and volume can
differ slightly from the consolidated tape, and it allows one streaming
connection at a time (opening the terminal in two tabs disconnects one).
Finnhub's free plan has no historical candles, so its charts start from the
day's quote, build from live trades, and stay empty outside US market hours.

Browser (CORS) access to these providers has not been exercised live. If a
provider refuses requests from the page, the banner shows the error, and
serving the terminal through a small same-origin proxy is the fix.

The paper account starts with $100,000 and is separate from the Petal
Invest practice account. No order leaves the browser, and when the terminal
is served by the agent server below, no order leaves your machine.

## Test an AI agent on it

`server/index.js` runs the same feeds and paper engine in Node 22+, with
no dependencies, and gives agents two ways in:

- an MCP server over stdio, for Claude Code, Claude Desktop or any MCP client;
- a local HTTP JSON API on `127.0.0.1`, for agents written in any language.

Both use one paper account saved to `.data/account.json`. Open the terminal
from the same server and it mirrors that account live, so you can watch the
agent's orders and fills on the chart (the badge reads "shared with agent").

### Start the server

```sh
# Optional: stock data (crypto via Binance and SIM-* symbols need no key)
export ALPACA_KEY_ID=... ALPACA_SECRET_KEY=...   # or FINNHUB_API_KEY=...
node apps/petal-invest/server/index.js
# open http://127.0.0.1:8765/terminal.html
```

Options: `--port` (or `PETAL_PORT`, default 8765) and `--data` (or
`PETAL_DATA`) for the account file. Symbols route by shape: `BTCUSDT` goes
to Binance, `SIM-*` to the simulated feed, anything else to Alpaca or
Finnhub.

### Connect Claude

Claude Code, from your agent's project:

```sh
claude mcp add petal \
  -e ALPACA_KEY_ID=... -e ALPACA_SECRET_KEY=... \
  -- node /path/to/rea/apps/petal-invest/server/index.js --mcp
```

Or commit a project `.mcp.json`:

```json
{
  "mcpServers": {
    "petal": {
      "command": "node",
      "args": ["/path/to/rea/apps/petal-invest/server/index.js", "--mcp"],
      "env": { "ALPACA_KEY_ID": "...", "ALPACA_SECRET_KEY": "..." }
    }
  }
}
```

Claude Desktop takes the same `mcpServers` block in
`claude_desktop_config.json`. With `--mcp`, the process also serves the
terminal on the port; if a Petal server is already running there, the MCP
process trades through it so the browser and agent share one account.

Tools: `list_markets`, `get_quote`, `get_bars` (compact OHLCV rows plus
latest `sma20`, `ema50`, `rsi14`, `bb20`), `get_account`, `list_orders`,
`place_order` (market or limit, long only), `cancel_order` and
`reset_account`. Failures come back as tool errors such as
`InsufficientFunds: ...`, so the agent can read and recover.

### HTTP API

| Method and path                                                           | Purpose                              |
| ------------------------------------------------------------------------- | ------------------------------------ |
| `GET /api/health`                                                         | Liveness                             |
| `GET /api/feeds`                                                          | Available feeds and symbols          |
| `GET /api/quote?symbol=BTCUSDT`                                           | Latest price                         |
| `GET /api/bars?symbol=AAPL&timeframe=1h&limit=100&indicators=rsi14,sma20` | Bars and indicators                  |
| `GET /api/account`                                                        | Equity, cash, positions, open orders |
| `GET /api/orders?status=open&limit=50`                                    | Order history                        |
| `POST /api/orders` `{symbol, side, type, qty, limitPrice}`                | Place a paper order                  |
| `DELETE /api/orders/:id`                                                  | Cancel an open order                 |
| `POST /api/reset` `{cash}`                                                | Start a fresh account                |
| `GET /api/events`                                                         | Server-sent account updates          |

```sh
curl -s -X POST localhost:8765/api/orders \
  -H 'content-type: application/json' \
  -d '{"symbol":"BTCUSDT","side":"buy","type":"market","qty":0.01}'
```

Errors return JSON `{"error":{"tag","message"}}` with a matching status
(400 invalid order, 404 unknown order, 409 not open, 501 no stock feed
configured, 502 provider failure, 503 no price yet).

The server binds to `127.0.0.1` only and has no authentication; do not
expose the port. Live provider connections from Node have not been
exercised from this repository's test environment.

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
orders, portfolio summaries, risk scoring and coach answers, the
terminal's candle building, indicators, Binance parsing and paper order
matching, plus the agent server's engine persistence, MCP protocol and
HTTP API.

## Layout

```
src/domain/   market, portfolio, playlists, risk profile, coach, candles,
              indicators, paper trading (pure, testable)
src/ui/       router and events (app.js), screens, trade sheet, chart, formatting
src/feeds/    market data: Binance, Alpaca, Finnhub, simulated
src/terminal/ terminal UI, chart wrapper, settings store, shared account
server/       agent server: engine, MCP (stdio), HTTP API, market routing
src/store.js  localStorage persistence
```

Intraday ticks are not persisted, so prices return to the seeded daily
close after a reload.

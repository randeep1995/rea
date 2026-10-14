// OHLCV candles keyed by bar open time in UTC seconds.

export const TIMEFRAMES = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "4h": 14_400,
  "1D": 86_400,
};

export function barStart(timeSec, tfSec) {
  return Math.floor(timeSec / tfSec) * tfSec;
}

// Fold one trade into the latest bar or open a new one. Returns the bar
// that changed. Trades older than the latest bar are ignored, since a
// streamed bar that has closed is final.
export function applyTrade(bars, { price, size = 0, timeSec }, tfSec) {
  const time = barStart(timeSec, tfSec);
  const last = bars.at(-1);
  if (last && time < last.time) return undefined;
  if (last && time === last.time) {
    last.high = Math.max(last.high, price);
    last.low = Math.min(last.low, price);
    last.close = price;
    last.volume += size;
    return last;
  }
  const bar = {
    time,
    open: price,
    high: price,
    low: price,
    close: price,
    volume: size,
  };
  bars.push(bar);
  return bar;
}

// Replace the latest bar when a feed sends an updated copy of it, or append
// a newer one. Bars older than the latest are ignored.
export function upsertBar(bars, bar) {
  const last = bars.at(-1);
  if (last && bar.time < last.time) return undefined;
  if (last && bar.time === last.time) bars[bars.length - 1] = bar;
  else bars.push(bar);
  return bar;
}

// Merge finer bars into a coarser timeframe (for example 1h into 4h).
export function resample(bars, tfSec) {
  const out = [];
  for (const b of bars) {
    const time = barStart(b.time, tfSec);
    const last = out.at(-1);
    if (last && last.time === time) {
      last.high = Math.max(last.high, b.high);
      last.low = Math.min(last.low, b.low);
      last.close = b.close;
      last.volume += b.volume;
    } else {
      out.push({ ...b, time });
    }
  }
  return out;
}

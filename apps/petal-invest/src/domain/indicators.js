// Technical indicators over candle closes. Each returns
// [{ time, value }] aligned to the input, skipping the warm-up period.

const closes = (bars) => bars.map((b) => b.close);

export function sma(bars, period) {
  const out = [];
  let sum = 0;
  const c = closes(bars);
  for (let i = 0; i < c.length; i++) {
    sum += c[i];
    if (i >= period) sum -= c[i - period];
    if (i >= period - 1) out.push({ time: bars[i].time, value: sum / period });
  }
  return out;
}

export function ema(bars, period) {
  const out = [];
  const c = closes(bars);
  if (c.length < period) return out;
  const k = 2 / (period + 1);
  let prev = c.slice(0, period).reduce((s, v) => s + v, 0) / period;
  out.push({ time: bars[period - 1].time, value: prev });
  for (let i = period; i < c.length; i++) {
    prev = c[i] * k + prev * (1 - k);
    out.push({ time: bars[i].time, value: prev });
  }
  return out;
}

export function bollinger(bars, period = 20, mult = 2) {
  const c = closes(bars);
  const upper = [];
  const lower = [];
  const middle = [];
  for (let i = period - 1; i < c.length; i++) {
    const window = c.slice(i - period + 1, i + 1);
    const mean = window.reduce((s, v) => s + v, 0) / period;
    const variance = window.reduce((s, v) => s + (v - mean) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    const time = bars[i].time;
    middle.push({ time, value: mean });
    upper.push({ time, value: mean + mult * sd });
    lower.push({ time, value: mean - mult * sd });
  }
  return { upper, middle, lower };
}

// Wilder's RSI.
export function rsi(bars, period = 14) {
  const c = closes(bars);
  const out = [];
  if (c.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = c[i] - c[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  const value = () => (loss === 0 ? 100 : 100 - 100 / (1 + gain / loss));
  out.push({ time: bars[period].time, value: value() });
  for (let i = period + 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
    out.push({ time: bars[i].time, value: value() });
  }
  return out;
}

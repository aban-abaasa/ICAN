// Series maths for the icaneracoin trading chart: turn the stored 5-minute candles into the ascending,
// de-duplicated series a charting library wants, roll them up into bigger timeframes, and derive the
// moving-average / RSI overlays. Pure functions, no DOM.

export const TIMEFRAMES = [
  { id: '5m', label: '5m', seconds: 300 },
  { id: '15m', label: '15m', seconds: 900 },
  { id: '1h', label: '1H', seconds: 3600 },
  { id: '4h', label: '4H', seconds: 14400 },
  { id: '1d', label: '1D', seconds: 86400 },
];

// Raw candle rows (open_time / *_price / trading_volume, any order) -> [{ time (unix s), open, high, low, close,
// volume }] ascending by time, one per time, with unusable rows dropped.
export const toSeries = (rows) => {
  const byTime = new Map();
  for (const row of rows || []) {
    const time = Math.floor(new Date(row.open_time).getTime() / 1000);
    const open = parseFloat(row.open_price ?? row.open);
    const high = parseFloat(row.high_price ?? row.high);
    const low = parseFloat(row.low_price ?? row.low);
    const close = parseFloat(row.close_price ?? row.close);
    if (![time, open, high, low, close].every(Number.isFinite)) continue;
    const volume = parseFloat(row.trading_volume ?? row.volume ?? 0) || 0;
    byTime.set(time, { time, open, high: Math.max(high, open, close), low: Math.min(low, open, close), close, volume });
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
};

// Roll a series up into `seconds`-wide candles: open of the first, close of the last, extremes of all, volume summed.
export const aggregateSeries = (series, seconds) => {
  if (!series.length || !seconds) return [];
  const out = [];
  for (const c of series) {
    const bucket = Math.floor(c.time / seconds) * seconds;
    const last = out[out.length - 1];
    if (last && last.time === bucket) {
      last.high = Math.max(last.high, c.high);
      last.low = Math.min(last.low, c.low);
      last.close = c.close;
      last.volume += c.volume;
    } else {
      out.push({ ...c, time: bucket });
    }
  }
  return out;
};

// Simple moving average of the closes; points exist only once `period` candles are available.
export const smaSeries = (series, period) => {
  const out = [];
  let sum = 0;
  for (let i = 0; i < series.length; i++) {
    sum += series[i].close;
    if (i >= period) sum -= series[i - period].close;
    if (i >= period - 1) out.push({ time: series[i].time, value: sum / period });
  }
  return out;
};

// Wilder's RSI. A window with no losses is 100 if the price rose and 50 if it never moved, matching
// calculateIndicators so the chart and the analysis cards never disagree.
export const rsiSeries = (series, period = 14) => {
  if (series.length <= period) return [];
  const rsiFrom = (gain, loss) => (loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss));
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const change = series[i].close - series[i - 1].close;
    if (change > 0) gain += change; else loss -= change;
  }
  gain /= period;
  loss /= period;
  const out = [{ time: series[period].time, value: rsiFrom(gain, loss) }];
  for (let i = period + 1; i < series.length; i++) {
    const change = series[i].close - series[i - 1].close;
    gain = (gain * (period - 1) + Math.max(change, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-change, 0)) / period;
    out.push({ time: series[i].time, value: rsiFrom(gain, loss) });
  }
  return out;
};

// The dashed Resistance / Support channel: a least-squares line through the last `lookback` closes, shifted up
// until it touches the highest high and down until it touches the lowest low, so every candle sits inside it
// (the "trend channel" traders draw by hand). Lines are expressed against the candle index, so
// valueAt(i) = intercept + slope * i + offset. A quiet market gets a minimum half-width of 0.2% of price so the
// two lines never collapse onto each other. Returns null with fewer than 3 candles.
export const trendChannel = (series, lookback = 120, minHalfWidthPct = 0.002) => {
  const n = series.length;
  if (n < 3) return null;
  const start = Math.max(0, n - lookback);
  const count = n - start;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = start; i < n; i++) {
    sx += i; sy += series[i].close; sxx += i * i; sxy += i * series[i].close;
  }
  const denom = count * sxx - sx * sx;
  const slope = denom === 0 ? 0 : (count * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / count;

  let up = 0;
  let down = 0;
  for (let i = start; i < n; i++) {
    const fit = intercept + slope * i;
    up = Math.max(up, series[i].high - fit);
    down = Math.min(down, series[i].low - fit);
  }
  const floor = Math.abs(intercept + slope * (n - 1)) * minHalfWidthPct;
  return {
    start,
    end: n - 1,
    slope,
    intercept,
    upperOffset: Math.max(up, floor),
    lowerOffset: Math.min(down, -floor),
  };
};

export const channelValue = (channel, index, side) =>
  channel.intercept + channel.slope * index + (side === 'upper' ? channel.upperOffset : channel.lowerOffset);

// The stored candles only exist for 5-minute windows in which something ticked the price, so a quiet market leaves
// holes -- hours long -- that a chart would squash into single bar slots. This restores a steady time grid the way an
// exchange draws a thin market: every empty window becomes a flat candle at the last known price (open = high = low
// = close = the previous close, no volume), and the series runs on to the current window. Windows older than
// `maxBuckets` are dropped so a very long gap cannot balloon the chart. `series` is ascending and aligned to `step`.
export const fillGaps = (series, step = 300, untilSec = Math.floor(Date.now() / 1000), maxBuckets = 4000) => {
  if (!series.length) return [];
  const flat = (time, price) => ({ time, open: price, high: price, low: price, close: price, volume: 0 });
  let out = [];
  let prev = null;
  for (const c of series) {
    if (prev) {
      const missing = Math.floor((c.time - prev.time) / step) - 1;
      if (missing > maxBuckets) out = []; // a gap this long: start again after it rather than draw it all
      else for (let t = prev.time + step; t < c.time; t += step) out.push(flat(t, prev.close));
    }
    out.push(c);
    prev = c;
  }
  const lastBucket = Math.floor(untilSec / step) * step;
  const trailing = Math.floor((lastBucket - prev.time) / step);
  if (trailing > maxBuckets) out = [flat(lastBucket, prev.close)];
  else for (let t = prev.time + step; t <= lastBucket; t += step) out.push(flat(t, prev.close));
  return out.length > maxBuckets ? out.slice(out.length - maxBuckets) : out;
};

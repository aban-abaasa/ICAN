import test from 'node:test';
import assert from 'node:assert/strict';
import { toSeries, aggregateSeries, smaSeries, rsiSeries, trendChannel, channelValue, fillGaps, TIMEFRAMES } from '../src/utils/candleSeries.js';

const row = (iso, o, h, l, c, v = 0) => ({ open_time: iso, open_price: o, high_price: h, low_price: l, close_price: c, trading_volume: v });

test('toSeries sorts ascending, de-duplicates by time and drops unusable rows', () => {
  const s = toSeries([
    row('2026-10-10T10:05:00Z', '5010', '5020', '5000', '5015', '2'),
    row('2026-10-10T10:00:00Z', '5000', '5012', '4990', '5010'),
    row('2026-10-10T10:05:00Z', '5010', '5030', '5000', '5025', '3'), // later duplicate wins
    row('garbage', 'x', 'y', 'z', 'w'),
  ]);
  assert.equal(s.length, 2);
  assert.ok(s[0].time < s[1].time);
  assert.equal(s[1].close, 5025);
  assert.equal(s[1].volume, 3);
});

test('toSeries widens a wick that does not cover the body', () => {
  const [c] = toSeries([row('2026-10-10T10:00:00Z', 5000, 5005, 5003, 5020)]);
  assert.equal(c.high, 5020);
  assert.equal(c.low, 5000);
});

test('aggregateSeries rolls 5m candles into one hourly candle', () => {
  const base = Date.parse('2026-10-10T10:00:00Z');
  const rows = Array.from({ length: 12 }, (_, i) => row(new Date(base + i * 300000).toISOString(), 5000 + i, 5005 + i, 4995 + i, 5001 + i, 1));
  const hourly = aggregateSeries(toSeries(rows), 3600);
  assert.equal(hourly.length, 1);
  assert.equal(hourly[0].open, 5000);
  assert.equal(hourly[0].close, 5012);
  assert.equal(hourly[0].high, 5016);
  assert.equal(hourly[0].low, 4995);
  assert.equal(hourly[0].volume, 12);
  assert.equal(hourly[0].time % 3600, 0);
});

test('aggregateSeries splits across bucket boundaries', () => {
  const rows = [row('2026-10-10T10:55:00Z', 1, 1, 1, 1), row('2026-10-10T11:00:00Z', 2, 2, 2, 2)];
  assert.equal(aggregateSeries(toSeries(rows), 3600).length, 2);
  assert.deepEqual(aggregateSeries([], 3600), []);
});

test('smaSeries starts once a full window exists', () => {
  const s = toSeries(Array.from({ length: 5 }, (_, i) => row(new Date(Date.UTC(2026, 9, 10, 10, i * 5)).toISOString(), 10 + i, 10 + i, 10 + i, 10 + i)));
  const sma = smaSeries(s, 3);
  assert.equal(sma.length, 3);
  assert.equal(sma[0].value, 11);
  assert.equal(sma[2].value, 13);
});

test('rsiSeries: flat is 50, only-rising is 100, only-falling is 0', () => {
  const mk = (closes) => toSeries(closes.map((c, i) => row(new Date(Date.UTC(2026, 9, 10, 10, i * 5)).toISOString(), c, c, c, c)));
  const up = Array.from({ length: 20 }, (_, i) => 5000 + i);
  assert.equal(rsiSeries(mk(Array(20).fill(5000)), 14).at(-1).value, 50);
  assert.equal(rsiSeries(mk(up), 14).at(-1).value, 100);
  assert.equal(rsiSeries(mk([...up].reverse()), 14).at(-1).value, 0);
  assert.deepEqual(rsiSeries(mk([1, 2, 3]), 14), []);
});

test('timeframes are ascending multiples of five minutes', () => {
  for (const tf of TIMEFRAMES) assert.equal(tf.seconds % 300, 0);
  assert.deepEqual(TIMEFRAMES.map((t) => t.seconds), [...TIMEFRAMES.map((t) => t.seconds)].sort((a, b) => a - b));
});

const barsFrom = (closes, spread = 5) => toSeries(closes.map((c, i) => row(new Date(Date.UTC(2026, 9, 10, 10, i * 5)).toISOString(), c, c + spread, c - spread, c)));

test('trendChannel slopes up on a rising market and encloses every candle', () => {
  const s = barsFrom(Array.from({ length: 40 }, (_, i) => 5000 + i * 3 + (i % 4) * 2));
  const ch = trendChannel(s, 40);
  assert.ok(ch.slope > 0);
  s.forEach((c, i) => {
    assert.ok(c.high <= channelValue(ch, i, 'upper') + 1e-9, `high ${i} inside resistance`);
    assert.ok(c.low >= channelValue(ch, i, 'lower') - 1e-9, `low ${i} inside support`);
  });
  assert.ok(channelValue(ch, 39, 'upper') > channelValue(ch, 39, 'lower'));
});

test('trendChannel slopes down on a falling market', () => {
  assert.ok(trendChannel(barsFrom(Array.from({ length: 30 }, (_, i) => 6000 - i * 4)), 30).slope < 0);
});

test('a perfectly flat market still gets a visible channel', () => {
  const ch = trendChannel(barsFrom(Array(30).fill(5000), 0), 30);
  assert.equal(ch.slope, 0);
  const width = channelValue(ch, 29, 'upper') - channelValue(ch, 29, 'lower');
  assert.ok(width >= 5000 * 0.004 - 1e-9);
});

test('trendChannel needs three candles and honours the lookback window', () => {
  assert.equal(trendChannel(barsFrom([1, 2]), 10), null);
  assert.equal(trendChannel(barsFrom(Array.from({ length: 50 }, (_, i) => 100 + i)), 20).start, 30);
});

const at = (iso, o, h, l, c, v = 1) => ({ time: Math.floor(Date.parse(iso) / 1000), open: o, high: h, low: l, close: c, volume: v });

test('fillGaps turns every empty 5-minute window into a flat candle at the last close', () => {
  const series = [at('2026-10-10T10:00:00Z', 5000, 5010, 4990, 5005), at('2026-10-10T10:20:00Z', 5005, 5030, 5000, 5020)];
  const out = fillGaps(series, 300, series[1].time);
  assert.equal(out.length, 5); // 10:00, 10:05, 10:10, 10:15, 10:20
  for (const f of out.slice(1, 4)) {
    assert.deepEqual([f.open, f.high, f.low, f.close, f.volume], [5005, 5005, 5005, 5005, 0]);
  }
  assert.deepEqual(out.map((c) => c.time - out[0].time), [0, 300, 600, 900, 1200]);
  assert.equal(out[4].close, 5020);
});

test('fillGaps leaves a contiguous series alone and does not invent volume', () => {
  const series = [at('2026-10-10T10:00:00Z', 1, 1, 1, 1), at('2026-10-10T10:05:00Z', 1, 2, 1, 2)];
  assert.deepEqual(fillGaps(series, 300, series[1].time), series);
});

test('fillGaps runs on to the current window, but never past it', () => {
  const series = [at('2026-10-10T10:00:00Z', 5000, 5000, 5000, 5000)];
  const now = Math.floor(Date.parse('2026-10-10T10:17:30Z') / 1000);
  const out = fillGaps(series, 300, now);
  assert.equal(out.length, 4); // 10:00, 10:05, 10:10, 10:15
  assert.equal(out[3].time, Math.floor(Date.parse('2026-10-10T10:15:00Z') / 1000));
  assert.equal(fillGaps(series, 300, series[0].time).length, 1);
});

test('fillGaps handles empty input and caps a very long history', () => {
  assert.deepEqual(fillGaps([]), []);
  const series = [at('2026-10-10T10:00:00Z', 1, 1, 1, 1), at('2026-10-20T10:00:00Z', 2, 2, 2, 2)];
  const out = fillGaps(series, 300, series[1].time, 100);
  assert.ok(out.length <= 100);
  assert.equal(out[out.length - 1].close, 2); // newest candle survives
  const huge = fillGaps([at('2020-01-01T00:00:00Z', 7, 7, 7, 7)], 300, Math.floor(Date.parse('2026-10-10T10:00:00Z') / 1000), 50);
  assert.equal(huge.length, 1);
  assert.equal(huge[0].close, 7);
});

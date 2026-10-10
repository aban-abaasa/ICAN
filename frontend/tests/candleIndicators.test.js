import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateIndicators, describeRsi, summarizeAnalysis, describeCandleWindow } from '../src/utils/candleIndicators.js';

const candle = (close, open = close, high = close, low = close) => ({ open, high, low, close });

test('calculateIndicators needs at least two candles', () => {
  assert.equal(calculateIndicators([]), null);
  assert.equal(calculateIndicators([candle(5000)]), null);
  assert.equal(calculateIndicators(null), null);
});

test('a rising series is bullish with RSI 100 and positive momentum', () => {
  const a = calculateIndicators([candle(5000), candle(5010), candle(5020), candle(5030)]);
  assert.match(a.trend, /^Bullish/);
  assert.equal(a.rsi, '100.00');
  assert.equal(a.momentum, '0.60');
  assert.equal(a.currentPrice, '5030.00000000');
});

test('a falling series is bearish with RSI 0', () => {
  const a = calculateIndicators([candle(5030), candle(5020), candle(5010), candle(5000)]);
  assert.match(a.trend, /^Bearish/);
  assert.equal(a.rsi, '0.00');
  assert.ok(Number(a.momentum) < 0);
});

test('a flat series is neutral', () => {
  const a = calculateIndicators([candle(5000), candle(5000), candle(5000)]);
  assert.equal(a.trend, 'Neutral');
  assert.equal(a.momentum, '0.00');
  assert.equal(a.rsi, '50.00'); // a market that never moved is not "overbought"
});

test('support and resistance bracket the current price', () => {
  const a = calculateIndicators([candle(5000, 5000, 5100, 4900), candle(5050, 5000, 5120, 4980)]);
  assert.ok(Number(a.support) <= Number(a.currentPrice));
  assert.ok(Number(a.resistance) >= Number(a.currentPrice));
});

test('moving averages use the last 20 / 50 closes once there are enough candles', () => {
  const series = Array.from({ length: 50 }, (_, i) => candle(5000 + i));
  const a = calculateIndicators(series);
  const last20 = series.slice(-20).reduce((s, c) => s + c.close, 0) / 20;
  const all50 = series.reduce((s, c) => s + c.close, 0) / 50;
  assert.equal(Number(a.ma20), last20);
  assert.equal(Number(a.ma50), all50);
});

test('describeRsi uses the 70 / 30 bands', () => {
  assert.equal(describeRsi('75').label, 'Overbought');
  assert.equal(describeRsi('25').label, 'Oversold');
  assert.equal(describeRsi('50').label, 'Neutral');
  assert.equal(describeRsi('nope').label, 'n/a');
});

test('summarizeAnalysis is honest when there is nothing to analyse', () => {
  assert.match(summarizeAnalysis(null), /not enough candles/i);
  const a = calculateIndicators([candle(5000), candle(5010), candle(5020)]);
  const text = summarizeAnalysis(a, { windowLabel: 'the last 10 minutes', candleCount: 3 });
  assert.match(text, /risen/);
  assert.match(text, /3 candles/);
});

test('describeCandleWindow phrases the span in minutes, hours or days', () => {
  const at = (iso) => ({ open_time: iso, close_time: iso });
  assert.equal(describeCandleWindow([]), 'the loaded period');
  assert.equal(describeCandleWindow([at('2026-10-10T10:00:00Z'), at('2026-10-10T10:40:00Z')]), 'the last 40 minutes');
  assert.equal(describeCandleWindow([at('2026-10-10T00:00:00Z'), at('2026-10-10T08:00:00Z')]), 'the last 8 hours');
  assert.equal(describeCandleWindow([at('2026-10-01T00:00:00Z'), at('2026-10-05T00:00:00Z')]), 'the last 4 days');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bucketFor, bucketName, rollingRange, yearRange, monthRange, rangeFromKey, yearsAvailable, monthEnabled, DAY,
} from '../src/utils/chartRanges.js';

const NOW = new Date(2026, 9, 16, 12, 0, 0).getTime(); // 16 Oct 2026, local time

test('bucketFor picks the smallest candle that fits the bar budget', () => {
  assert.equal(bucketFor(7 * DAY, 400), 3600);
  assert.equal(bucketFor(7 * DAY, 160), 14400); // a phone gets fewer, wider candles
  assert.equal(bucketFor(365 * DAY, 400), 86400);
  assert.equal(bucketFor(365 * DAY, 160), 604800);
  assert.equal(bucketFor(3650 * DAY, 160), 604800); // never larger than a week
});

test('bucketFor never goes below the minimum candle', () => {
  assert.equal(bucketFor(600, 400, 300), 300);
  assert.equal(bucketFor(600, 400, 3600), 3600);
});

test('bucketName labels candle sizes', () => {
  assert.equal(bucketName(3600), '1H');
  assert.equal(bucketName(86400), '1D');
  assert.equal(bucketName(604800), '1W');
});

test('rollingRange ends now and spans the days asked', () => {
  const r = rollingRange('1y', NOW, false);
  assert.equal(r.to.getTime(), NOW);
  assert.equal(Math.round((r.to - r.from) / (DAY * 1000)), 365);
  assert.equal(r.rolling, true);
  assert.equal(r.bucket, 86400);
  assert.equal(rollingRange('nope', NOW), null);
});

test('yearRange: a past year is the whole calendar year and is not rolling', () => {
  const r = yearRange(2025, NOW, false);
  assert.equal(r.key, 'y2025');
  assert.equal(r.from.getFullYear(), 2025);
  assert.equal(r.to.getFullYear(), 2026);
  assert.equal(r.to.getMonth(), 0);
  assert.equal(r.rolling, false);
});

test('yearRange: the current year runs to now and keeps refreshing', () => {
  const r = yearRange(2026, NOW, true);
  assert.equal(r.to.getTime(), NOW);
  assert.equal(r.rolling, true);
});

test('monthRange: one calendar month, 4-hour candles on a wide screen', () => {
  const r = monthRange(2026, 2, NOW, false);
  assert.equal(r.key, 'm2026-03');
  assert.equal(r.from.getMonth(), 2);
  assert.equal(r.to.getMonth(), 3);
  assert.equal(r.bucket, 14400); // 744 hourly candles would be too many
  assert.equal(r.label, 'Mar 2026');
});

test('rangeFromKey rebuilds each kind of choice and treats live as no range', () => {
  assert.equal(rangeFromKey('live'), null);
  assert.equal(rangeFromKey(null), null);
  assert.equal(rangeFromKey('y2024', NOW).key, 'y2024');
  assert.equal(rangeFromKey('m2025-12', NOW).from.getMonth(), 11);
  assert.equal(rangeFromKey('3m', NOW).key, '3m');
});

test('yearsAvailable lists newest first from the first year with data', () => {
  assert.deepEqual(yearsAvailable('2024-05-01T00:00:00Z', NOW), [2026, 2025, 2024]);
  assert.deepEqual(yearsAvailable(null, NOW), [2026, 2025]);
  assert.deepEqual(yearsAvailable('2030-01-01T00:00:00Z', NOW), [2026]);
  assert.ok(yearsAvailable('1900-01-01T00:00:00Z', NOW).length <= 31);
});

test('monthEnabled rules out the future and months before the first data', () => {
  assert.equal(monthEnabled(2026, 11, null, NOW), false); // December 2026 has not started
  assert.equal(monthEnabled(2026, 9, null, NOW), true);   // this month
  const first = new Date(2025, 5, 10).toISOString();
  assert.equal(monthEnabled(2025, 4, first, NOW), false); // May 2025 is before the first candle
  assert.equal(monthEnabled(2025, 5, first, NOW), true);
});

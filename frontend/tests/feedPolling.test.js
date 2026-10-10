import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pollDelay, needsFullRefresh, mergeCandles, feedStatus, isMissingFunction, isDrawableCandle,
  BASE_POLL_MS, MAX_BACKOFF_MS, FULL_REFRESH_EVERY, LIVE_WITHIN_MS, DELAYED_WITHIN_MS,
} from '../src/utils/feedPolling.js';

const candle = (iso, close, volume = 0) => ({ timestamp: iso, open: close, high: close, low: close, close, volume });

test('pollDelay: a healthy feed polls at the base rate, jittered by at most 20%', () => {
  assert.equal(pollDelay({ failures: 0, rand: () => 0.5 }), BASE_POLL_MS);
  assert.equal(pollDelay({ failures: 0, rand: () => 0 }), Math.round(BASE_POLL_MS * 0.8));
  assert.equal(pollDelay({ failures: 0, rand: () => 1 }), Math.round(BASE_POLL_MS * 1.2));
});

test('pollDelay: every failure doubles the wait, and it never exceeds a minute (plus jitter)', () => {
  const waits = [1, 2, 3, 4, 5, 6, 7, 20].map((failures) => pollDelay({ failures, rand: () => 0.5 }));
  assert.deepEqual(waits.slice(0, 3), [BASE_POLL_MS * 2, BASE_POLL_MS * 4, BASE_POLL_MS * 8]);
  for (let i = 1; i < waits.length; i++) assert.ok(waits[i] >= waits[i - 1]);
  assert.ok(Math.max(...waits) <= MAX_BACKOFF_MS);
  assert.equal(waits[waits.length - 1], MAX_BACKOFF_MS);
});

test('pollDelay: jitter keeps charts that started together from staying in lockstep', () => {
  const seen = new Set(Array.from({ length: 50 }, () => pollDelay({ failures: 0 })));
  assert.ok(seen.size > 5);
});

test('needsFullRefresh: first load, every Nth poll and a stale window ask for everything', () => {
  assert.equal(needsFullRefresh({ haveCandles: false }), true);
  assert.equal(needsFullRefresh({ haveCandles: true, pollsSinceFull: 1, lastFullAt: 1000, now: 2000 }), false);
  assert.equal(needsFullRefresh({ haveCandles: true, pollsSinceFull: FULL_REFRESH_EVERY, lastFullAt: 1000, now: 2000 }), true);
  assert.equal(needsFullRefresh({ haveCandles: true, pollsSinceFull: 1, lastFullAt: 0, now: 11 * 60_000 }), true);
});

test('mergeCandles: a re-sent candle replaces the held one (the live window updating)', () => {
  const held = [candle('2026-10-10T10:00:00Z', 100, 1), candle('2026-10-10T10:05:00Z', 101, 2)];
  const out = mergeCandles(held, [candle('2026-10-10T10:05:00Z', 105, 9), candle('2026-10-10T10:10:00Z', 106, 1)]);
  assert.equal(out.length, 3);
  assert.equal(out[1].close, 105);
  assert.equal(out[1].volume, 9);
  assert.equal(out[2].close, 106);
});

test('mergeCandles: output is oldest first whatever order it arrives in, and the input is not mutated', () => {
  const held = [candle('2026-10-10T10:05:00Z', 101)];
  const copy = JSON.stringify(held);
  const out = mergeCandles(held, [candle('2026-10-10T10:10:00Z', 3), candle('2026-10-10T10:00:00Z', 1)]);
  assert.deepEqual(out.map((c) => c.close), [1, 101, 3]);
  assert.equal(JSON.stringify(held), copy);
});

test('mergeCandles: caps to the newest `limit` and ignores empty or malformed entries', () => {
  const many = Array.from({ length: 10 }, (_, i) => candle(new Date(Date.UTC(2026, 9, 10, 10, i * 5)).toISOString(), i));
  const out = mergeCandles(many, [null, undefined, {}], 4);
  assert.equal(out.length, 4);
  assert.equal(out[3].close, 9);
  assert.deepEqual(mergeCandles(undefined, undefined), []);
});

test('feedStatus: connecting, live, delayed, offline by the age of the last good answer', () => {
  const now = 1_000_000;
  assert.equal(feedStatus({ lastOkAt: null, now }), 'connecting');
  assert.equal(feedStatus({ lastOkAt: now - 1000, now }), 'live');
  assert.equal(feedStatus({ lastOkAt: now - LIVE_WITHIN_MS, now }), 'live');
  assert.equal(feedStatus({ lastOkAt: now - LIVE_WITHIN_MS - 1, now }), 'delayed');
  assert.equal(feedStatus({ lastOkAt: now - DELAYED_WITHIN_MS, now }), 'delayed');
  assert.equal(feedStatus({ lastOkAt: now - DELAYED_WITHIN_MS - 1, now }), 'offline');
  assert.equal(feedStatus({ lastOkAt: now + 5000, now }), 'live'); // a clock set backwards is not "negative age"
});

test('isMissingFunction: recognises "the SQL migration has not been run" but not other errors', () => {
  assert.equal(isMissingFunction({ code: 'PGRST202', message: 'Could not find the function public.x in the schema cache' }), true);
  assert.equal(isMissingFunction({ code: '42883', message: 'function public.x(integer) does not exist' }), true);
  assert.equal(isMissingFunction({ message: 'Could not find the function public.ican_get_public_feed(p_limit) in the schema cache' }), true);
  assert.equal(isMissingFunction({ code: '42501', message: 'permission denied for function x' }), false);
  assert.equal(isMissingFunction({ code: '57014', message: 'canceling statement due to statement timeout' }), false);
  assert.equal(isMissingFunction(null), false);
});

test('isDrawableCandle: rejects non-finite, zero, negative and inverted candles', () => {
  const ok = { open: 5000, high: 5010, low: 4990, close: 5005 };
  assert.equal(isDrawableCandle(ok), true);
  assert.equal(isDrawableCandle({ ...ok, close: NaN }), false);
  assert.equal(isDrawableCandle({ ...ok, open: 0 }), false);
  assert.equal(isDrawableCandle({ ...ok, low: -1 }), false);
  assert.equal(isDrawableCandle({ ...ok, high: 4000, low: 4990 }), false);
  assert.equal(isDrawableCandle(null), false);
});

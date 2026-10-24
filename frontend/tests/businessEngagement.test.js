import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EMPTY_STATS, normalizeStats, formatRating, formatFollowers, filledStars } from '../src/utils/businessEngagement.js';

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const migration = readFileSync(path.join(repo, 'supabase', 'migrations', '20261118100000_business_ratings_subscriptions_ranking.sql'), 'utf8');
const service = readFileSync(path.join(repo, 'frontend', 'src', 'services', 'businessEngagementService.js'), 'utf8');

test('stats from the database become safe numbers', () => {
  const s = normalizeStats({ rating_avg: 4.8, rating_count: 20, distribution: { 4: 4, 5: 16 }, subscriber_count: 10, my_rating: 5, my_comment: 'Great', subscribed: true, is_owner: false });
  assert.deepEqual(s.distribution, { 1: 0, 2: 0, 3: 0, 4: 4, 5: 16 });
  assert.equal(s.ratingAvg, 4.8);
  assert.equal(s.ratingCount, 20);
  assert.equal(s.subscriberCount, 10);
  assert.equal(s.myRating, 5);
  assert.equal(s.myComment, 'Great');
  assert.equal(s.subscribed, true);
});

test('a business nobody has rated has no average, and missing or odd data never throws', () => {
  assert.equal(normalizeStats({ rating_avg: null, rating_count: 0 }).ratingAvg, null);
  assert.deepEqual(normalizeStats(null), EMPTY_STATS);
  assert.deepEqual(normalizeStats('nope'), EMPTY_STATS);
  const odd = normalizeStats({ rating_count: -3, subscriber_count: 'x', my_rating: 9, distribution: { 7: 2, 5: 'many' } });
  assert.equal(odd.ratingCount, 0);
  assert.equal(odd.subscriberCount, 0);
  assert.equal(odd.myRating, null);
  assert.deepEqual(odd.distribution, { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
});

test('normalizing never hands out the shared empty object to be mutated', () => {
  const a = normalizeStats(null);
  a.distribution[5] = 99;
  assert.equal(normalizeStats(null).distribution[5], 0);
  assert.equal(EMPTY_STATS.distribution[5], 0);
});

test('badges read naturally', () => {
  assert.equal(formatRating(4.8), '4.8');
  assert.equal(formatRating(5), '5.0');
  assert.equal(formatRating(null), '');
  assert.equal(formatFollowers(1), '1 follower');
  assert.equal(formatFollowers(0), '0 followers');
  assert.equal(formatFollowers(999), '999 followers');
  assert.equal(formatFollowers(1200), '1.2K followers');
  assert.equal(formatFollowers(3000), '3K followers');
  assert.equal(formatFollowers(2_500_000), '2.5M followers');
  assert.equal(filledStars(4.4), 4);
  assert.equal(filledStars(4.5), 5);
  assert.equal(filledStars(null), 0);
});

test('the website only calls database functions the migration defines', () => {
  const called = [...service.matchAll(/'(fn_[a-z_]+)'/g)].map((m) => m[1]);
  assert.ok(called.length >= 6, 'expected the service to call the rating / subscription functions');
  for (const fn of new Set(called)) {
    assert.match(migration, new RegExp(`FUNCTION public\\.${fn}\\(`), `${fn} is called by the website but not defined`);
  }
});

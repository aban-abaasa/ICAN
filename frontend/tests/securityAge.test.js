import test from 'node:test';
import assert from 'node:assert/strict';
import { describeAge } from '../src/utils/securityHelpers.js';

const NOW = Date.UTC(2026, 9, 23, 12, 0, 0);
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString();

test('an age reads at a glance: today, yesterday, days, months, a year', () => {
  assert.equal(describeAge(daysAgo(0), NOW), 'today');
  assert.equal(describeAge(daysAgo(1), NOW), 'yesterday');
  assert.equal(describeAge(daysAgo(12), NOW), '12 days ago');
  assert.equal(describeAge(daysAgo(29), NOW), '29 days ago');
  assert.equal(describeAge(daysAgo(30), NOW), '1 month ago');
  assert.equal(describeAge(daysAgo(90), NOW), '3 months ago');
  assert.equal(describeAge(daysAgo(364), NOW), '12 months ago');
  assert.equal(describeAge(daysAgo(400), NOW), 'over a year ago');
  assert.equal(describeAge(daysAgo(800), NOW), '2 years ago');
});

test('a missing or unreadable date gives nothing to say rather than a wrong age', () => {
  assert.equal(describeAge(null, NOW), '');
  assert.equal(describeAge(undefined, NOW), '');
  assert.equal(describeAge('not a date', NOW), '');
});

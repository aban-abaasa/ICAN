import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  badgesAt, autoPlaceBadges, formatBadgePrice, formatClock, daysLeft, canRenew, badgeStatus, publishLabel, badgeShopHref,
  badgeFormToArgs, statusBadgeFormToArgs, badgeFormProblem, POSITIONS, POSITION_CLASSES, BADGE_MAX_PER_VIDEO, BADGE_MAX_PER_STATUS,
} from '../src/utils/pitchBadges.js';

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const migration = readFileSync(path.join(repo, 'supabase', 'migrations', '20261119100000_video_product_badges.sql'), 'utf8');
const read = (...p) => readFileSync(path.join(repo, 'frontend', 'src', ...p), 'utf8');

const DAY = 86400000;

test('a badge shows from its start second until its duration is up, and not before or after', () => {
  const badges = [{ id: 'a', starts_at_sec: 5, duration_sec: 6 }, { id: 'b', starts_at_sec: 8, duration_sec: 4 }];
  assert.deepEqual(badgesAt(badges, 4.9), []);
  assert.deepEqual(badgesAt(badges, 5).map((b) => b.id), ['a']);
  assert.deepEqual(badgesAt(badges, 9).map((b) => b.id), ['a', 'b']);
  assert.deepEqual(badgesAt(badges, 11).map((b) => b.id), ['b']);
  assert.deepEqual(badgesAt(badges, 12), []);
  assert.deepEqual(badgesAt(null, 5), []);
  assert.deepEqual(badgesAt(badges, NaN), []);
  assert.deepEqual(badgesAt(badges, -1), []);
});

test('a photo or text status has no timeline: its badges stay on screen throughout', () => {
  const badges = [{ id: 'a', starts_at_sec: 0, duration_sec: 60 }, { id: 'b', starts_at_sec: 0, duration_sec: 60 }];
  assert.deepEqual(badgesAt(badges, 0, true).map((b) => b.id), ['a', 'b']);
  assert.deepEqual(badgesAt(badges, 9999, true).map((b) => b.id), ['a', 'b']);
  assert.deepEqual(badgesAt(badges, NaN, true).map((b) => b.id), ['a', 'b'], 'no clock needed');
  assert.deepEqual(badgesAt(null, 0, true), []);
});

test('auto-placement spreads badges evenly, never overlaps, and stays inside the video', () => {
  for (const [count, length] of [[1, 60], [3, 60], [5, 30], [12, 60], [4, 8], [2, 0], [3, undefined]]) {
    const placed = autoPlaceBadges(count, length);
    const total = length > 0 ? length : 60;
    assert.equal(placed.length, count);
    placed.forEach((p, i) => {
      assert.ok(p.starts_at_sec >= 0 && p.starts_at_sec < total, `start inside the video (${count} in ${length})`);
      assert.ok(p.duration_sec >= 2 && p.duration_sec <= 6, 'a sensible time on screen');
      if (i > 0 && total / (count + 1) >= 8) assert.ok(p.starts_at_sec >= placed[i - 1].starts_at_sec + placed[i - 1].duration_sec, 'no overlap when there is room');
    });
    assert.deepEqual(placed.map((p) => p.starts_at_sec), [...placed.map((p) => p.starts_at_sec)].sort((a, b) => a - b), 'in video order');
  }
  assert.deepEqual(autoPlaceBadges(0, 60), []);
  assert.deepEqual(autoPlaceBadges(3, 60).map((p) => p.starts_at_sec), [12, 27, 42]);
});

test('prices read naturally in the shop\'s own currency', () => {
  assert.equal(formatBadgePrice(4500, 'UGX'), 'UGX 4,500');
  assert.equal(formatBadgePrice(900.5, 'kes'), 'KES 900.50');
  assert.equal(formatBadgePrice('12', 'USD'), 'USD 12.00');
  assert.equal(formatBadgePrice(0, 'UGX'), 'UGX 0');
  assert.equal(formatBadgePrice('x', 'UGX'), '');
  assert.equal(formatClock(65), '1:05');
  assert.equal(formatClock(-4), '0:00');
});

test('how long a badge has left, and when it can be renewed (the database allows the last 7 days)', () => {
  const now = Date.UTC(2026, 10, 1);
  const live = (days) => ({ status: 'live', live_until: new Date(now + days * DAY).toISOString() });
  assert.equal(daysLeft(live(10).live_until, now), 10);
  assert.equal(daysLeft(new Date(now + 3600000).toISOString(), now), 1);
  assert.equal(daysLeft(new Date(now - DAY).toISOString(), now), 0);
  assert.equal(daysLeft(null, now), 0);
  assert.equal(canRenew(live(20), now), false);
  assert.equal(canRenew(live(7), now), true);
  assert.equal(canRenew(live(2), now), true);
  assert.equal(canRenew(live(-1), now), true);
  assert.equal(canRenew({ status: 'draft' }, now), false);
});

test('the status line says what a person needs to know', () => {
  const now = Date.UTC(2026, 10, 1);
  const until = (d) => new Date(now + d * DAY).toISOString();
  assert.equal(badgeStatus({ status: 'draft' }, now).tone, 'draft');
  assert.deepEqual(badgeStatus({ status: 'live', live_until: until(12) }, now), { tone: 'live', text: 'Live · 12 days left' });
  assert.equal(badgeStatus({ status: 'live', live_until: until(1) }, now).text, 'Live · 1 day left');
  assert.equal(badgeStatus({ status: 'live', live_until: until(-2) }, now).tone, 'ended');
  const sold = badgeStatus({ status: 'live', live_until: until(5), problem: 'sold_out' }, now);
  assert.equal(sold.tone, 'warn');
  assert.match(sold.text, /sold out/);
  assert.match(badgeStatus({ status: 'live', live_until: until(5), problem: 'product_unavailable' }, now).text, /no longer for sale/);
});

test('a status badge counts in hours, because it lasts a day at most', () => {
  const now = Date.UTC(2026, 10, 1);
  const status = (hours) => ({ status: 'live', status_id: 's1', live_until: new Date(now + hours * 3600000).toISOString() });
  assert.deepEqual(badgeStatus(status(20), now), { tone: 'live', text: 'Live · 20h left' });
  assert.equal(badgeStatus(status(0.2), now).text, 'Live · 1h left');
  assert.equal(badgeStatus(status(-1), now).text, 'Ended with the status');
  assert.equal(badgeStatus({ ...status(5), problem: 'sold_out' }, now).tone, 'warn');
  assert.equal(canRenew(status(2), now), true, 'the pitch rule; the status screen never offers renew');
});

test('the button shows the real price, and free means free', () => {
  assert.equal(publishLabel({ status: 'draft' }, { price_ic: 0, charged: false }), 'Publish for 30 days · Free');
  assert.equal(publishLabel({ status: 'draft' }, { price_ic: 5, charged: true }), 'Publish for 30 days · 5 IC');
  assert.equal(publishLabel({ status: 'live' }, { price_ic: 2.5 }), 'Renew for 30 days · 2.5 IC');
  assert.equal(publishLabel({ status: 'draft' }, null), 'Publish for 30 days · Free');
  assert.equal(publishLabel({ status: 'draft' }, { price_ic: 0 }, true), 'Publish on this status · Free');
  assert.equal(publishLabel({ status: 'draft' }, { price_ic: 2 }, true), 'Publish on this status · 2 IC');
});

test('tapping a badge opens the business Market, or nothing without a website', () => {
  assert.equal(badgeShopHref('abc'), '/notices/abc?tab=market');
  assert.equal(badgeShopHref(null), null);
});

test('the form maps to the database arguments for a store product and for a typed badge', () => {
  const linked = badgeFormToArgs('p1', { productId: 'prod', label: '', startsAt: '12', duration: '6', position: 'top-right' }, 'b1');
  assert.deepEqual(linked, { p_pitch_id: 'p1', p_badge_id: 'b1', p_product_id: 'prod', p_label: null, p_price: null, p_currency: null, p_image_url: null, p_starts_at_sec: 12, p_duration_sec: 6, p_position: 'top-right' });
  assert.equal(badgeFormToArgs('p1', { productId: 'prod', label: 'left over from "Type it"', startsAt: 0, duration: 6 }).p_label, null, 'a store product never freezes a typed name');
  const typed = badgeFormToArgs('p1', { productId: '', label: ' Gift box ', price: '25000', currency: 'ugx', imageUrl: ' https://x.test/a.jpg ', startsAt: 3, duration: 8 });
  assert.equal(typed.p_label, 'Gift box'); assert.equal(typed.p_price, 25000); assert.equal(typed.p_currency, 'UGX');
  assert.equal(typed.p_image_url, 'https://x.test/a.jpg'); assert.equal(typed.p_position, 'bottom-left'); assert.equal(typed.p_badge_id, null);
});

test('a status badge form maps to fn_save_status_badge, business first and no pitch', () => {
  const args = statusBadgeFormToArgs('st1', 'biz1', { productId: 'prod', label: '', startsAt: 0, duration: 5, position: 'top-left' }, 'b9');
  assert.deepEqual(args, { p_status_id: 'st1', p_business_profile_id: 'biz1', p_badge_id: 'b9', p_product_id: 'prod', p_label: null, p_price: null, p_currency: null, p_image_url: null, p_starts_at_sec: 0, p_duration_sec: 5, p_position: 'top-left' });
  assert.ok(!('p_pitch_id' in args));
  const typed = statusBadgeFormToArgs('st1', 'biz1', { productId: '', label: 'Gift', price: '5000', currency: 'ugx', startsAt: 0, duration: 5 });
  assert.equal(typed.p_badge_id, null); assert.equal(typed.p_price, 5000); assert.equal(typed.p_currency, 'UGX');
});

test('a photo status skips the timing checks, a video status keeps them', () => {
  const photo = { productId: 'prod', startsAt: '', duration: '' };
  assert.equal(badgeFormProblem(photo, 0, { timed: false }), '');
  assert.match(badgeFormProblem(photo, 0, { timed: true }), /negative|2 to 60/);
  assert.match(badgeFormProblem({ productId: '', label: '', price: '', startsAt: 0, duration: 5 }, 0, { timed: false }), /Pick a product/, 'a product or a name is still needed');
});

test('a form is checked the way the database will check it', () => {
  const ok = { productId: 'prod', startsAt: 5, duration: 6 };
  assert.equal(badgeFormProblem(ok, 60), '');
  assert.match(badgeFormProblem({ productId: '', label: '', price: '5', startsAt: 0, duration: 6 }, 60), /Pick a product/);
  assert.match(badgeFormProblem({ productId: '', label: 'Gift', price: '', startsAt: 0, duration: 6 }, 60), /price/);
  assert.match(badgeFormProblem({ productId: '', label: 'Gift', price: '-3', startsAt: 0, duration: 6 }, 60), /price/);
  assert.equal(badgeFormProblem({ productId: '', label: 'Gift', price: '0', startsAt: 0, duration: 6 }, 60), '');
  assert.match(badgeFormProblem({ ...ok, startsAt: -1 }, 60), /negative/);
  assert.match(badgeFormProblem({ ...ok, duration: 1 }, 60), /2 to 60/);
  assert.match(badgeFormProblem({ ...ok, duration: 61 }, 60), /2 to 60/);
  assert.match(badgeFormProblem({ ...ok, startsAt: 60 }, 60), /1:00 long/);
  assert.equal(badgeFormProblem({ ...ok, startsAt: 500 }, 0), '', 'an unknown length is not guessed');
});

test('the front end and the database agree on the numbers and the corners', () => {
  assert.equal(BADGE_MAX_PER_VIDEO, 12);
  assert.equal(BADGE_MAX_PER_STATUS, 3);
  assert.match(migration, /p_position, 12\);/);
  assert.match(migration, /p_position, 3\);/);
  assert.match(migration, /make_interval\(days => v_days\)/);
  assert.match(migration, /v_days\s+INTEGER := 30;/);
  assert.match(migration, /duration_sec\s+INTEGER NOT NULL DEFAULT 6 CHECK \(duration_sec BETWEEN 2 AND 60\)/);
  const corners = migration.match(/position IN \(([^)]+)\)/)[1].match(/'([a-z-]+)'/g).map((s) => s.replace(/'/g, ''));
  assert.deepEqual(POSITIONS.map((p) => p.id).sort(), corners.sort());
  assert.deepEqual(Object.keys(POSITION_CLASSES).sort(), corners.sort());
});

test('the website only calls database functions the migration defines', () => {
  const calls = [...read('services', 'pitchBadgeService.js').matchAll(/'((?:fn|ican)_[a-z_]+)'/g)].map((m) => m[1]);
  assert.ok(calls.length >= 8);
  for (const fn of new Set(calls)) assert.match(migration, new RegExp(`FUNCTION public\\.${fn}\\(`), `${fn} is called but not defined`);
});

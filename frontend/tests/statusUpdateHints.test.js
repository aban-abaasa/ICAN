import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  hintFor, announce, markOpened, nextHint, pruneSeen, formatEndsIn, MIN_NEW_VIEWS, ENDING_SOON_MS, HINT_VISIBLE_MS,
} from '../src/utils/statusUpdateHints.js';

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const migration = readFileSync(path.join(repo, 'supabase', 'migrations', '20261119100000_video_product_badges.sql'), 'utf8');
const service = readFileSync(path.join(repo, 'frontend', 'src', 'services', 'statusUpdatesService.js'), 'utf8');

const NOW = Date.UTC(2026, 10, 1, 12, 0, 0);
const HOUR = 3600000;
const update = (over = {}) => ({ status_id: 's1', view_count: 0, comment_count: 0, expires_at: new Date(NOW + 10 * HOUR).toISOString(), badges: [], ...over });

test('nothing new means no hint at all', () => {
  assert.equal(hintFor(update(), {}, NOW), null);
  assert.equal(hintFor(update({ comment_count: 4, view_count: 40 }), { s1: { comments: 4, views: 40 } }, NOW), null);
  assert.equal(hintFor(null, {}, NOW), null);
  assert.equal(hintFor({}, {}, NOW), null);
});

test('new comments are announced with the right wording', () => {
  assert.deepEqual(hintFor(update({ comment_count: 1 }), {}, NOW), { statusId: 's1', kind: 'comments', text: '1 new comment', open: 'comments' });
  assert.equal(hintFor(update({ comment_count: 5 }), { s1: { comments: 2 } }, NOW).text, '3 new comments');
  assert.equal(hintFor(update({ comment_count: 2 }), { s1: { comments: 5 } }, NOW), null, 'a comment that was deleted is not news');
});

test('a hidden product badge says why, and opens the badge manager', () => {
  const sold = update({ badges: [{ id: 'b1', name: 'Fresh Milk 1L', problem: 'sold_out' }] });
  assert.deepEqual(hintFor(sold, {}, NOW), { statusId: 's1', kind: 'badge', text: 'Fresh Milk 1L sold out · its badge is hidden', open: 'badges' });
  const gone = update({ badges: [{ id: 'b1', name: 'Brown Bread', problem: 'product_unavailable' }] });
  assert.match(hintFor(gone, {}, NOW).text, /Brown Bread is no longer for sale/);
  assert.equal(hintFor(update({ badges: [{ id: 'b1', name: 'Milk', problem: null }] }), {}, NOW), null, 'a badge that is fine is not news');
  const again = announce({}, sold, hintFor(sold, {}, NOW));
  assert.equal(hintFor(sold, again, NOW), null, 'announced once, never again for the same problem');
  const back = update({ badges: [{ id: 'b1', name: 'Fresh Milk 1L', problem: null }] });
  const soldAgain = update({ badges: [{ id: 'b1', name: 'Fresh Milk 1L', problem: 'sold_out' }] });
  assert.equal(hintFor(soldAgain, again, NOW), null, 'the same problem again is not news');
  assert.equal(hintFor(back, again, NOW), null);
  const switchedOff = update({ badges: [{ id: 'b1', name: 'Fresh Milk 1L', problem: 'product_unavailable' }] });
  assert.equal(hintFor(switchedOff, again, NOW)?.kind, 'badge', 'a different problem on that badge is news');
});

test('a single extra view is not news; a few are', () => {
  assert.equal(hintFor(update({ view_count: MIN_NEW_VIEWS - 1 }), {}, NOW), null);
  assert.deepEqual(hintFor(update({ view_count: 12 }), { s1: { views: 9 } }, NOW), { statusId: 's1', kind: 'views', text: '3 new views', open: 'status' });
});

test('ending soon is only mentioned while a live product badge is riding on the status', () => {
  const soon = (badges) => update({ expires_at: new Date(NOW + 80 * 60000).toISOString(), badges });
  const live = [{ id: 'b1', name: 'Milk', problem: null }];
  assert.deepEqual(hintFor(soon(live), {}, NOW), { statusId: 's1', kind: 'ending', text: 'Ends in 1h 20m · your product badge goes with it', open: 'status' });
  assert.equal(hintFor(soon([]), {}, NOW), null, 'no badge: ending is not worth interrupting for');
  assert.equal(hintFor(update({ badges: live }), {}, NOW), null, 'ten hours left: not soon');
  assert.equal(hintFor(update({ expires_at: new Date(NOW - 1).toISOString(), badges: live }), {}, NOW), null, 'already over');
  assert.equal(hintFor(update({ expires_at: new Date(NOW + ENDING_SOON_MS).toISOString(), badges: live }), {}, NOW)?.kind, 'ending', 'right at two hours');
  const done = announce({}, soon(live), hintFor(soon(live), {}, NOW));
  assert.equal(hintFor(soon(live), done, NOW), null, 'said once');
});

test('the most useful news comes first: comments, then a hidden badge, then views, then ending', () => {
  const all = update({ comment_count: 2, view_count: 20, expires_at: new Date(NOW + HOUR).toISOString(), badges: [{ id: 'b1', name: 'Milk', problem: 'sold_out' }] });
  assert.equal(hintFor(all, {}, NOW).kind, 'comments');
  let seen = announce({}, all, hintFor(all, {}, NOW));
  assert.equal(hintFor(all, seen, NOW).kind, 'badge');
  seen = announce(seen, all, hintFor(all, seen, NOW));
  assert.equal(hintFor(all, seen, NOW).kind, 'views');
  seen = announce(seen, all, hintFor(all, seen, NOW));
  assert.equal(hintFor(all, seen, NOW), null, 'a badge with a problem is not "live", so no ending note');
});

test('announcing moves only what was announced; opening catches everything up', () => {
  const u = update({ comment_count: 3, view_count: 10, badges: [{ id: 'b1', name: 'Milk', problem: 'sold_out' }] });
  const afterComment = announce({}, u, hintFor(u, {}, NOW));
  assert.equal(afterComment.s1.comments, 3);
  assert.equal(afterComment.s1.views, undefined);
  const opened = markOpened({}, u);
  assert.deepEqual(opened.s1, { comments: 3, views: 10, problems: ['b1:sold_out'] });
  assert.equal(hintFor(u, opened, NOW), null);
  const later = update({ comment_count: 4, view_count: 10, badges: u.badges });
  assert.equal(hintFor(later, opened, NOW).text, '1 new comment', 'only what came after');
  assert.equal(nextHint(new Map([['s1', u]]), ['s1'], opened, NOW), null);
});

test('with several cards, the first one in the order shown that has news wins', () => {
  const map = new Map([['a', update({ status_id: 'a' })], ['b', update({ status_id: 'b', comment_count: 1 })], ['c', update({ status_id: 'c', comment_count: 9 })]]);
  assert.equal(nextHint(map, ['a', 'b', 'c'], {}, NOW).statusId, 'b');
  assert.equal(nextHint(map, ['c', 'b'], {}, NOW).statusId, 'c');
  assert.equal(nextHint(map, ['a'], {}, NOW), null);
  assert.equal(nextHint(map, ['zzz'], {}, NOW), null, 'a card with no data yet is skipped');
});

test('time left reads naturally, and the remembered state stays small', () => {
  assert.equal(formatEndsIn(80 * 60000), '1h 20m');
  assert.equal(formatEndsIn(45 * 60000), '45m');
  assert.equal(formatEndsIn(2 * HOUR), '2h');
  assert.equal(formatEndsIn(1000), '1m');
  assert.deepEqual(Object.keys(pruneSeen({ a: {}, b: {}, c: {} }, ['b'])), ['b']);
});

test('a hint stays long enough to read and tap but is not permanent', () => {
  assert.ok(HINT_VISIBLE_MS >= 6000 && HINT_VISIBLE_MS <= 12000);
});

test('the screen only asks for a function the migration defines, and the numbers it uses are returned', () => {
  assert.match(service, /'fn_my_status_updates'/);
  assert.match(migration, /FUNCTION public\.fn_my_status_updates\(\)/);
  for (const field of ['status_id', 'view_count', 'expires_at', 'comment_count', 'badges', 'problem']) assert.match(migration, new RegExp(`'${field}'`), `${field} is returned`);
  assert.match(migration, /m\.sender_id <> s\.user_id/, 'your own replies are not counted as news');
});

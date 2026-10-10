import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OTHER_BUSINESS,
  businessBreakdown,
  businessKeyOf,
  businessNameOf,
  filterByAccount,
  filterByDirection,
  groupByDay,
  sortNewestFirst,
  summarize,
} from '../src/utils/dashboardLedger.js';

const KAMPALA = 'b-kampala';
const ENTEBBE = 'b-entebbe';
const two = new Map([[KAMPALA, 'Kampala Hardware Ltd'], [ENTEBBE, 'Entebbe Fresh Foods']]);
const one = new Map([[KAMPALA, 'Kampala Hardware Ltd']]);

const tx = (id, over = {}) => ({
  id, amount: 1000, transaction_type: 'expense', description: id,
  created_at: '2026-10-10T09:00:00.000Z', metadata: {}, ...over,
});
const biz = (id, businessId, over = {}) =>
  tx(id, { record_category: 'business', business_profile_id: businessId, ...over });

test('a business record gets the exact name of its own business when the user has several', () => {
  assert.equal(businessNameOf(biz('a', KAMPALA), two), 'Kampala Hardware Ltd');
  assert.equal(businessNameOf(biz('b', ENTEBBE), two), 'Entebbe Fresh Foods');
});

test('the business id may sit in metadata instead of on the row', () => {
  const row = tx('m', { record_category: 'business', metadata: { business_profile_id: ENTEBBE } });
  assert.equal(businessNameOf(row, two), 'Entebbe Fresh Foods');
});

test('an untagged business record is only attributed when there is exactly one business', () => {
  const untagged = tx('u', { record_category: 'business' });
  assert.equal(businessNameOf(untagged, one), 'Kampala Hardware Ltd');
  assert.equal(businessNameOf(untagged, two), null);
  assert.equal(businessKeyOf(untagged, two), OTHER_BUSINESS);
});

test('a personal record with no business tag is never given a business name', () => {
  assert.equal(businessNameOf(tx('p'), one), null);
});

test('a business the user cannot open falls into the "other business" bucket, not a wrong name', () => {
  const stranger = biz('s', 'b-unknown');
  assert.equal(businessNameOf(stranger, two), null);
  assert.equal(businessKeyOf(stranger, two), OTHER_BUSINESS);
});

test('summarize counts everything that is not income as money out', () => {
  const rows = [tx('i', { transaction_type: 'income', amount: 5000 }), tx('e', { amount: 1200 }), tx('t', { transaction_type: 'transfer', amount: 300 })];
  assert.deepEqual(summarize(rows), { income: 5000, expense: 1500, net: 3500, count: 3 });
});

test('breakdown lists each business by exact name, busiest first', () => {
  const rows = [biz('1', ENTEBBE), biz('2', KAMPALA), biz('3', KAMPALA, { amount: 4000 }), tx('personal')];
  const groups = businessBreakdown(rows, two);
  assert.deepEqual(groups.map((g) => [g.name, g.count, g.amount]), [['Kampala Hardware Ltd', 2, 5000], ['Entebbe Fresh Foods', 1, 1000]]);
});

test('filtering by account and by one business', () => {
  const rows = [biz('1', KAMPALA), biz('2', ENTEBBE), tx('3')];
  assert.deepEqual(filterByAccount(rows, 'all', '', two).map((r) => r.id), ['1', '2', '3']);
  assert.deepEqual(filterByAccount(rows, 'personal', '', two).map((r) => r.id), ['3']);
  assert.deepEqual(filterByAccount(rows, 'business', '', two).map((r) => r.id), ['1', '2']);
  assert.deepEqual(filterByAccount(rows, 'business', ENTEBBE, two).map((r) => r.id), ['2']);
});

test('filtering by direction', () => {
  const rows = [tx('in', { transaction_type: 'income' }), tx('out'), tx('move', { transaction_type: 'transfer' })];
  assert.deepEqual(filterByDirection(rows, 'in').map((r) => r.id), ['in']);
  assert.deepEqual(filterByDirection(rows, 'out').map((r) => r.id), ['out', 'move']);
  assert.equal(filterByDirection(rows, 'all').length, 3);
});

test('records are grouped by day, newest first, with each day\'s true net', () => {
  const now = new Date(2026, 9, 10, 15, 0);
  const at = (day, hour) => new Date(2026, 9, day, hour, 0).toISOString();
  const rows = sortNewestFirst([
    tx('old', { created_at: at(7, 10), amount: 700 }),
    tx('y-in', { created_at: at(9, 8), amount: 5000, transaction_type: 'income' }),
    tx('t-out', { created_at: at(10, 9), amount: 2000 }),
    tx('y-out', { created_at: at(9, 18), amount: 1500 }),
  ]);
  const groups = groupByDay(rows, rows.length, now);
  assert.deepEqual(groups.map((g) => g.label), ['Today', 'Yesterday', new Date(2026, 9, 7).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' })]);
  assert.deepEqual(groups.map((g) => g.net), [-2000, 3500, -700]);
  assert.deepEqual(groups[1].rows.map((r) => r.id), ['y-out', 'y-in']);
});

test('a day cut off by paging still reports the net of the whole day', () => {
  const now = new Date(2026, 9, 10, 15, 0);
  const rows = sortNewestFirst([
    tx('a', { created_at: new Date(2026, 9, 10, 12).toISOString(), amount: 100 }),
    tx('b', { created_at: new Date(2026, 9, 10, 11).toISOString(), amount: 200 }),
  ]);
  const [today] = groupByDay(rows, 1, now);
  assert.equal(today.rows.length, 1);
  assert.equal(today.net, -300);
});

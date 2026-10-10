import test from 'node:test';
import assert from 'node:assert/strict';
import { newRequestId, makeRequestIdStore, tradeFailure, mapTradeResult, isTransientNetworkError } from '../src/utils/tradeResult.js';

const SERVER_ID = /^[A-Za-z0-9:_.-]{8,100}$/;

test('newRequestId: always satisfies the server rule, and is unique', () => {
  const ids = Array.from({ length: 200 }, () => newRequestId('buy'));
  for (const id of ids) assert.match(id, SERVER_ID);
  assert.equal(new Set(ids).size, ids.length);
  assert.match(newRequestId('order fill/#1 <script>'), SERVER_ID); // hostile prefix is cleaned, never rejected
  assert.match(newRequestId(''), SERVER_ID);
  assert.ok(newRequestId('x'.repeat(500)).length <= 100);
});

test('makeRequestIdStore: a retry or double tap of the same action reuses the id; a different action gets a new one', () => {
  const store = makeRequestIdStore('buy');
  const a = store.idFor('buy|1000|UGX');
  assert.equal(store.idFor('buy|1000|UGX'), a);
  assert.equal(store.idFor('buy|1000|UGX'), a);
  const b = store.idFor('buy|2000|UGX');
  assert.notEqual(b, a);
  store.clear();
  assert.notEqual(store.idFor('buy|2000|UGX'), b); // success ended the action
});

test('mapTradeResult: a success keeps the shape every screen already reads', () => {
  const r = mapTradeResult({
    success: true, side: 'buy', ican_amount: '1.5', local_amount: '9000', currency: 'UGX', price_per_coin: '6000',
    total_ugx: 9000, new_ican_balance: 3.25, new_local_balance: 91000, transaction_id: 'tx-1', request_id: 'req-12345678', duplicate: false,
  });
  assert.equal(r.success, true);
  assert.equal(r.icanAmount, 1.5);
  assert.equal(r.localAmount, 9000);
  assert.equal(r.pricePerCoin, 6000);
  assert.equal(r.totalValue, 9000);
  assert.equal(r.newIcanBalance, 3.25);
  assert.equal(r.newWalletBalance, 91000);
  assert.equal(r.transaction.id, 'tx-1');
  assert.equal(r.duplicate, false);
});

test('mapTradeResult: a retry is reported as a duplicate, not as a second trade', () => {
  assert.equal(mapTradeResult({ success: true, ican_amount: 1, duplicate: true, transaction_id: 't' }).duplicate, true);
});

test('mapTradeResult: a refusal becomes a failure with the server sentence and code', () => {
  const r = mapTradeResult({ success: false, code: 'insufficient_funds', error: 'Insufficient balance. You have 5 UGX, need 100' });
  assert.deepEqual([r.success, r.code, r.error], [false, 'insufficient_funds', 'Insufficient balance. You have 5 UGX, need 100']);
  const moved = mapTradeResult({ success: false, code: 'price_moved', price_ugx: '6123.5', error: 'The price moved' });
  assert.equal(moved.priceUgx, 6123.5);
});

test('mapTradeResult / tradeFailure: nothing usable still yields a failure, never a crash or a fake success', () => {
  assert.equal(mapTradeResult(null).success, false);
  assert.equal(mapTradeResult(undefined).error, 'Trade failed');
  assert.equal(mapTradeResult({ success: 'yes' }).success, false);
  assert.equal(tradeFailure({}, 'Nope').error, 'Nope');
});

test('isTransientNetworkError: a dropped connection is retryable, a server answer is not', () => {
  assert.equal(isTransientNetworkError({ message: 'TypeError: Failed to fetch', code: '' }), true);
  assert.equal(isTransientNetworkError({ message: 'NetworkError when attempting to fetch resource.' }), true);
  assert.equal(isTransientNetworkError({ message: 'Load failed' }), true);
  assert.equal(isTransientNetworkError({ code: '42501', message: 'permission denied for function' }), false);
  assert.equal(isTransientNetworkError({ code: 'PGRST202', message: 'Could not find the function' }), false);
  assert.equal(isTransientNetworkError({ code: '57014', message: 'canceling statement due to statement timeout' }), false);
  assert.equal(isTransientNetworkError(null), false);
});

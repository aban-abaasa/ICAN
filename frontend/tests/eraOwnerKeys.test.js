import test from 'node:test';
import assert from 'node:assert/strict';
import { validateKeyRequest, keyStatus, eraOwnerApi, KEY_SCOPES } from '../src/services/eraOwnerKeys.js';

const base = { businessId: 'b1', label: '  POS sync ', scopes: ['inventory:read'], expiresDays: 90 };

test('a key request needs a business, at least one known scope and a listed expiry', () => {
  assert.equal(validateKeyRequest({ ...base, businessId: '' }).ok, false);
  assert.equal(validateKeyRequest({ ...base, scopes: [] }).ok, false);
  assert.equal(validateKeyRequest({ ...base, scopes: ['admin:everything'] }).ok, false, 'unknown scopes are dropped, leaving none');
  assert.equal(validateKeyRequest({ ...base, expiresDays: 9999 }).ok, false);
  const ok = validateKeyRequest(base);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.args, { p_business_id: 'b1', p_label: 'POS sync', p_scopes: ['inventory:read'], p_expires_days: 90, p_test: false, p_max_amount_ugx: null, p_daily_cap_ugx: null });
});

test('scopes are de-duplicated and unknown ones are never sent', () => {
  const r = validateKeyRequest({ ...base, scopes: ['inventory:read', 'inventory:read', 'nope', 'cmms:read'] });
  assert.deepEqual(r.args.p_scopes, ['inventory:read', 'cmms:read']);
});

test('caps only travel with a payments:request key, and are bounded', () => {
  assert.equal(validateKeyRequest({ ...base, maxAmount: '5000', dailyCap: '9000' }).args.p_max_amount_ugx, null, 'ignored without the payments scope');
  const pay = { ...base, scopes: ['payments:request'] };
  assert.equal(validateKeyRequest({ ...pay, maxAmount: '250000', dailyCap: '1000000' }).args.p_max_amount_ugx, 250000);
  assert.equal(validateKeyRequest({ ...pay, maxAmount: '0' }).ok, false);
  assert.equal(validateKeyRequest({ ...pay, maxAmount: '10000001' }).ok, false);
  assert.equal(validateKeyRequest({ ...pay, dailyCap: '50000001' }).ok, false);
  assert.equal(validateKeyRequest({ ...pay, maxAmount: '500', dailyCap: '100' }).ok, false);
  assert.equal(validateKeyRequest(pay).ok, true, 'caps are optional: the database applies small defaults');
});

test('the test flag is passed through, and only the six real scopes exist', () => {
  assert.equal(validateKeyRequest({ ...base, test: true }).args.p_test, true);
  assert.deepEqual(KEY_SCOPES.map((s) => s.id).sort(), ['bookings:read', 'bookings:request', 'cmms:read', 'inventory:read', 'payments:read', 'payments:request']);
});

test('keyStatus: revoked beats expired beats active', () => {
  assert.equal(keyStatus({ revoked_at: '2026-01-01', expired: true }), 'revoked');
  assert.equal(keyStatus({ expired: true }), 'expired');
  assert.equal(keyStatus({ expires_at: '2000-01-01T00:00:00Z' }), 'expired');
  assert.equal(keyStatus({ expires_at: '2999-01-01T00:00:00Z' }), 'active');
});

test('the RPC wrapper calls the right functions with the right argument names and surfaces database messages', async () => {
  const calls = [];
  const sb = { rpc: async (fn, args) => { calls.push([fn, args]); return fn === 'era_api_owner_revoke_key' ? { data: null, error: { message: 'No such key.' } } : { data: { ok: 1 }, error: null }; } };
  const api = eraOwnerApi(sb);
  await api.listKeys('b1'); await api.activity('b1', 10); await api.createKey({ p_business_id: 'b1' });
  assert.deepEqual(calls.map((c) => c[0]), ['era_api_owner_list_keys', 'era_api_owner_activity', 'era_api_owner_create_key']);
  assert.deepEqual(calls[1][1], { p_business_id: 'b1', p_limit: 10 });
  await assert.rejects(() => api.revokeKey('k1'), /No such key/);
});

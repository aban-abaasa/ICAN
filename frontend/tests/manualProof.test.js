import test from 'node:test';
import assert from 'node:assert/strict';
import { getProofRequirement, getReceiptLines, getTransactionChannel, isTwoParty, walletTxToReceiptTx } from '../src/utils/transactionReceipt.js';

const manual = (metadata = {}, extra = {}) => ({
  id: '00000000-0000-0000-0000-000000000001', amount: 50000, currency: 'UGX', transaction_type: 'expense',
  description: 'Paid supplier', created_at: '2026-09-10T08:00:00.000Z', metadata, ...extra,
});

test('a manual entry with a second party needs photo and receipt number', () => {
  const need = getProofRequirement(manual({ recipient_name: 'Mukasa Hardware' }));
  assert.equal(need.required, true);
  assert.deepEqual(need.missing, ['Receipt photo', 'Receipt number']);
  assert.equal(need.complete, false);
});

test('photo alone or number alone is not 100%', () => {
  assert.deepEqual(getProofRequirement(manual({ payer_name: 'Ann', receipt_url: 'r2://a' })).missing, ['Receipt number']);
  assert.deepEqual(getProofRequirement(manual({ payer_name: 'Ann', receipt_ref: 'R-1' })).missing, ['Receipt photo']);
  assert.deepEqual(getProofRequirement(manual({ payer_name: 'Ann', receipt_ref: '  ' })).missing, ['Receipt photo', 'Receipt number']);
});

test('photo and number together complete the proof', () => {
  const need = getProofRequirement(manual({ merchant_name: 'Shop', receipt_url: 'r2://a', receipt_ref: 'R-1' }));
  assert.equal(need.complete, true);
  assert.deepEqual(need.missing, []);
});

test('digital and one-sided entries are not asked for manual proof', () => {
  assert.equal(getProofRequirement(manual({ recipient_name: 'X', paymentMethod: 'MTN MoMo' })).required, false);
  assert.equal(getProofRequirement(manual({ source_app: 'mybodaguy', payer_name: 'X' })).required, false);
  assert.equal(getProofRequirement(manual({})).required, false);
  assert.equal(isTwoParty(manual({ recipient_type: 'church' })), false); // tithe receipts stay one-sided
});

test('wallet rows keep their channel when converted for the receipt', () => {
  const shared = walletTxToReceiptTx({ id: 'shared-abc', amount: -2, ican_amount: 2, created_at: '2026-09-10T08:00:00Z', merchant_name: 'Shop' });
  assert.equal(getTransactionChannel(shared), 'digital');
  assert.equal(getProofRequirement(shared).required, false);
  const legacy = walletTxToReceiptTx({ id: 'legacy-abc', user_id: 'u1', amount: 5000, created_at: '2026-09-10T08:00:00Z', merchant_name: 'Shop' });
  assert.equal(getProofRequirement(legacy).required, true);
});

test('the receipt states whether manual proof is complete', () => {
  const lines = (m) => Object.fromEntries(getReceiptLines(manual(m)));
  assert.match(lines({ payer_name: 'A' })['Manual proof'], /^Incomplete — missing receipt photo & receipt number$/);
  assert.match(lines({ payer_name: 'A', receipt_url: 'r2://a', receipt_ref: 'R1' })['Manual proof'], /^100%/);
  assert.equal(lines({})['Manual proof'], undefined);
});

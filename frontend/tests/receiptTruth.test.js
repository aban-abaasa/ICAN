import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256 } from 'js-sha256';
import {
  analyzeReceiptTruth, buildReceiptTruth, computeSealRoot, formatFlags, getEvidenceGrade,
  getTruthStatement, isPlatformRecorded, sealReceipt, shortSeal, toReceiptStamp, verifySealRoot,
} from '../src/utils/receiptTruth.js';

let counter = 0;
const tx = (overrides = {}, metadata = {}) => {
  counter += 1;
  return {
    id: `00000000-0000-0000-0000-${String(counter).padStart(12, '0')}`,
    amount: 10000,
    currency: 'UGX',
    transaction_type: 'expense',
    description: `Entry ${counter}`,
    created_at: '2026-09-10T08:00:00.000Z',
    metadata: { ...metadata },
    ...overrides,
  };
};
const withPhoto = (key = 'r2://transaction-receipts/a.jpg') => ({ receipt_url: key });
const withNumber = (ref = 'SHOP-1001') => ({ receipt_ref: ref });

test('grades follow the proof the person supplied', () => {
  assert.equal(getEvidenceGrade(tx({}, { ...withPhoto(), ...withNumber() })), 'gold');
  assert.equal(getEvidenceGrade(tx({}, withPhoto())), 'silver');
  assert.equal(getEvidenceGrade(tx({}, withNumber())), 'silver');
  assert.equal(getEvidenceGrade(tx()), 'bronze');
  assert.equal(getEvidenceGrade(tx({}, { receipt_ref: '   ' })), 'bronze'); // blank number is no proof
});

test('coverage is counted by entries and by money', () => {
  const { summary } = analyzeReceiptTruth([
    tx({ amount: 90000 }, withPhoto('r2://a')),
    tx({ amount: 10000 }),
    tx({ amount: 0 }, withNumber('NUM-1')),
    tx({ amount: 0 }),
  ]);
  assert.equal(summary.total, 4);
  assert.equal(summary.backedCount, 2);
  assert.equal(summary.unbackedCount, 2);
  assert.equal(summary.coverageByCount, 50);
  assert.equal(summary.coverageByValue, 90); // 90k of 100k is backed
  assert.equal(summary.backedAmount, 90000);
  assert.equal(summary.unbackedAmount, 10000);
  assert.equal(summary.photoCount, 1);
  assert.equal(summary.numberCount, 1);
});

test('income and expense both count by absolute value', () => {
  const { summary } = analyzeReceiptTruth([
    tx({ amount: -4000, transaction_type: 'expense' }, withPhoto('r2://a')),
    tx({ amount: 6000, transaction_type: 'income' }),
  ]);
  assert.equal(summary.totalAmount, 10000);
  assert.equal(summary.coverageByValue, 40);
});

test('an empty set has no rating and says so', () => {
  const { summary, rows } = analyzeReceiptTruth([]);
  assert.deepEqual(rows, []);
  assert.equal(summary.total, 0);
  assert.equal(summary.rating, null);
  assert.equal(summary.sealRoot, '');
  assert.equal(getTruthStatement(summary), 'No entries in this report.');
  assert.equal(analyzeReceiptTruth(undefined).summary.total, 0);
  assert.equal(analyzeReceiptTruth([null, undefined]).summary.total, 0);
});

test('rating bands: A needs 90%+ and no warnings, otherwise B/C/D by coverage', () => {
  const rate = (backed, unbacked) => buildReceiptTruth([
    ...Array.from({ length: backed }, (_, i) => tx({}, withPhoto(`r2://p${counter}-${i}`))),
    ...Array.from({ length: unbacked }, () => tx()),
  ]).rating;
  assert.equal(rate(10, 0), 'A');
  assert.equal(rate(9, 1), 'A');
  assert.equal(rate(7, 3), 'B');
  assert.equal(rate(4, 6), 'C');
  assert.equal(rate(1, 9), 'D');
});

test('full coverage does not earn an A while a receipt is reused', () => {
  const a = tx({}, withNumber('SHOP-77'));
  const b = tx({}, withNumber('SHOP-77'));
  const { summary } = analyzeReceiptTruth([a, b]);
  assert.equal(summary.coverageByValue, 100);
  assert.equal(summary.attentionCount, 2);
  assert.equal(summary.rating, 'B');
});

test('the same receipt number on several entries is flagged, ignoring case and punctuation', () => {
  const rows = analyzeReceiptTruth([
    tx({}, withNumber('RCT 5521')),
    tx({}, withNumber('rct-5521')),
    tx({}, withNumber('RCT-9999')),
  ]).rows;
  assert.deepEqual(rows[0].flags.map((f) => f.key), ['reused_proof']);
  assert.deepEqual(rows[1].flags.map((f) => f.key), ['reused_proof']);
  assert.deepEqual(rows[2].flags, []);
  assert.match(rows[0].flags[0].detail, /receipt number used on 2 entries/);
});

test('the same receipt photo on several entries is flagged', () => {
  const rows = analyzeReceiptTruth([
    tx({}, withPhoto('r2://transaction-receipts/same.jpg')),
    tx({}, withPhoto('r2://transaction-receipts/same.jpg')),
    tx({}, withPhoto('r2://transaction-receipts/other.jpg')),
  ]).rows;
  assert.equal(rows[0].flags[0].key, 'reused_proof');
  assert.match(rows[0].flags[0].detail, /receipt photo used on 2 entries/);
  assert.equal(rows[2].flags.length, 0);
});

test('generic receipt numbers and the same entry listed twice are not called reuse', () => {
  const dup = tx({}, withNumber('SHOP-5'));
  const rows = analyzeReceiptTruth([
    tx({}, withNumber('1')),
    tx({}, withNumber('1')),
    tx({}, withNumber('n/a')),
    tx({}, withNumber('N/A')),
    dup,
    dup, // same ledger row arriving twice from two feeds
  ]).rows;
  assert.equal(rows.every((row) => row.flags.length === 0), true);
});

test('a large entry with no receipt is flagged; smaller, receipted, foreign-currency and platform entries are not', () => {
  const { rows, summary } = analyzeReceiptTruth([
    tx({ amount: 500000 }),                                  // at the threshold -> flagged
    tx({ amount: 499999 }),                                  // just under
    tx({ amount: 900000 }, withNumber('BIG-1')),             // has proof
    tx({ amount: 900000, currency: 'USD' }),                 // threshold is in UGX
    tx({ amount: 900000, lock_reason: 'wallet' }),           // platform ledger
    tx({ amount: 900000 }, { source: 'ican wallet' }),       // platform ledger via source
    tx({ amount: -750000, transaction_type: 'income' }),     // large income, no receipt -> flagged
  ]);
  assert.deepEqual(rows.map((row) => row.flags.map((f) => f.key)), [
    ['large_unbacked'], [], [], [], [], [], ['large_unbacked'],
  ]);
  assert.equal(summary.flagCounts.large_unbacked, 2);
  assert.equal(summary.attentionCount, 2);
  assert.equal(summary.flaggedReceipts.length, 2);
});

test('the large-entry threshold can be changed', () => {
  const rows = analyzeReceiptTruth([tx({ amount: 20000 })], { largeAmount: 10000 }).rows;
  assert.equal(rows[0].flags[0].key, 'large_unbacked');
});

test('proof added long after the entry date is context, not a warning', () => {
  const late = tx({ created_at: '2026-08-01T08:00:00.000Z' }, { ...withPhoto('r2://late'), receipt_attached_at: '2026-08-20T08:00:00.000Z' });
  const onTime = tx({ created_at: '2026-08-01T08:00:00.000Z' }, { ...withPhoto('r2://ontime'), receipt_attached_at: '2026-08-04T08:00:00.000Z' });
  const noStamp = tx({ created_at: '2026-08-01T08:00:00.000Z' }, withPhoto('r2://nostamp'));
  const { rows, summary } = analyzeReceiptTruth([late, onTime, noStamp]);
  assert.equal(rows[0].flags[0].key, 'late_proof');
  assert.equal(rows[0].flags[0].detail, 'Proof added 19 days after the entry date');
  assert.equal(rows[1].flags.length, 0);
  assert.equal(rows[2].flags.length, 0);
  assert.equal(summary.flagCounts.late_proof, 1);
  assert.equal(summary.attentionCount, 0); // info only
  assert.equal(summary.rating, 'A');
});

test('proof added exactly a week after is fine; a day more is noted', () => {
  const at = (days) => tx({ created_at: '2026-08-01T08:00:00.000Z' }, {
    ...withPhoto(`r2://day${days}`),
    receipt_attached_at: new Date(Date.UTC(2026, 7, 1 + days, 8)).toISOString(),
  });
  const { rows } = analyzeReceiptTruth([at(7), at(8)]);
  assert.equal(rows[0].flags.length, 0);
  assert.equal(rows[1].flags[0].key, 'late_proof');
});

test('platform-recorded entries are recognised by lock reason or source', () => {
  assert.equal(isPlatformRecorded(tx({ lock_reason: 'cmms' })), true);
  assert.equal(isPlatformRecorded(tx({}, { source: 'ICAN Wallet' })), true);
  assert.equal(isPlatformRecorded(tx({ lock_reason: 'helper' }, { source: 'smart_entry' })), false);
});

test('a seal is stable, 64 hex chars, and moves with anything on the receipt', () => {
  const base = tx({ id: 'aaaaaaaa-0000-0000-0000-000000000001' }, withPhoto('r2://one'));
  const seal = sealReceipt(base);
  assert.match(seal, /^[0-9a-f]{64}$/);
  assert.equal(sealReceipt({ ...base }), seal);
  assert.equal(sealReceipt({ ...base, metadata: { ...base.metadata, unrelated: 'x' } }), seal); // unrelated metadata is not sealed
  assert.notEqual(sealReceipt({ ...base, amount: 10001 }), seal);
  assert.notEqual(sealReceipt({ ...base, description: 'Something else' }), seal);
  assert.notEqual(sealReceipt({ ...base, created_at: '2026-09-11T08:00:00.000Z' }), seal);
  assert.notEqual(sealReceipt({ ...base, transaction_type: 'income' }), seal);
  assert.notEqual(sealReceipt({ ...base, metadata: { receipt_url: 'r2://swapped' } }), seal);
  assert.notEqual(sealReceipt({ ...base, metadata: { ...base.metadata, receipt_ref: 'NEW-1' } }), seal);
});

test('amounts that arrive as strings or negatives seal the same as numbers', () => {
  const a = tx({ id: 'bbbbbbbb-0000-0000-0000-000000000001', amount: 1500 });
  assert.equal(sealReceipt({ ...a, amount: '1500.00' }), sealReceipt(a));
  assert.equal(sealReceipt({ ...a, amount: -1500 }), sealReceipt(a));
});

test('the report seal ignores row order and catches edits, additions and removals', () => {
  const entries = [tx({}, withPhoto('r2://x')), tx(), tx({}, withNumber('N-100'))];
  const root = buildReceiptTruth(entries).sealRoot;
  assert.match(root, /^[0-9a-f]{64}$/);
  assert.equal(buildReceiptTruth([...entries].reverse()).sealRoot, root);
  assert.equal(verifySealRoot(entries, root), true);
  assert.equal(verifySealRoot([...entries].reverse(), root), true);

  assert.equal(verifySealRoot([{ ...entries[0], amount: 10001 }, entries[1], entries[2]], root), false); // edited amount
  assert.equal(verifySealRoot(entries.slice(1), root), false);                                          // dropped row
  assert.equal(verifySealRoot([...entries, tx()], root), false);                                         // added row
  assert.equal(verifySealRoot(entries, ''), false);
});

test('duplicate seals still change the root, so a repeated row cannot be hidden', () => {
  const seals = ['aa', 'bb', 'cc'];
  assert.notEqual(computeSealRoot(seals), computeSealRoot([...seals, 'cc']));
  assert.equal(computeSealRoot([]), '');
});

test('the report seal is a plain sha256 over the sorted seals, so an auditor can recompute it', () => {
  const root = computeSealRoot(['b', 'a', 'c']);
  assert.equal(root, sha256('a\nb\nc'));
});

test('rows stay aligned with the input and carry a compact stamp', () => {
  const first = tx({}, { ...withPhoto('r2://s'), ...withNumber('STAMP-1') });
  const second = tx();
  const { rows } = analyzeReceiptTruth([first, second]);
  assert.equal(rows[0].tx, first);
  assert.equal(rows[1].tx, second);
  const stamp = toReceiptStamp(rows[0]);
  assert.deepEqual(Object.keys(stamp), ['number', 'evidence', 'flags', 'seal']);
  assert.equal(stamp.evidence, 'gold');
  assert.match(stamp.number, /^RCT-20260910-/);
});

test('flags read as one cell and the statement tells the truth in a sentence', () => {
  const entries = [
    tx({ amount: 600000 }),
    tx({ amount: 100000 }, withNumber('SHOP-8')),
    tx({ amount: 100000 }, withNumber('SHOP-8')),
  ];
  const { rows, summary } = analyzeReceiptTruth(entries);
  assert.equal(formatFlags(rows[0].flags), 'Large, no receipt');
  assert.equal(formatFlags(rows[1].flags), 'Receipt reused');
  assert.equal(formatFlags([]), '');
  assert.equal(
    getTruthStatement(summary),
    `2 of 3 entries (67%) carry a receipt photo or number, covering UGX 200,000 of UGX 800,000 (25%). 3 entries need a closer look. Report seal ${shortSeal(summary.sealRoot)}.`,
  );
  assert.equal(shortSeal('abcdef0123456789abcdef'), 'ABCDEF012345');
});

test('the stored summary is plain data that survives a JSON round trip', () => {
  const { summary } = analyzeReceiptTruth([tx({ amount: 900000 }), tx({}, withPhoto('r2://j'))]);
  assert.deepEqual(JSON.parse(JSON.stringify(summary)), summary);
  const arrays = Object.entries(summary).filter(([, v]) => Array.isArray(v)).map(([k]) => k);
  assert.deepEqual(arrays, ['flaggedReceipts']); // only a list of receipt numbers
});

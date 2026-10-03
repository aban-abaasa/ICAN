/**
 * Receipt truth: what the receipts say about a set of transactions.
 *
 * Every transaction already has a receipt (see transactionReceipt.js) -- a photo,
 * a receipt number, or just the system receipt generated from the ledger row.
 * This module turns that into something a report can state plainly:
 *
 *  - Evidence grade per entry: gold (photo + number), silver (photo or number),
 *    bronze (system receipt only).
 *  - Truth flags that a careful bookkeeper would want pointed out: the same
 *    receipt reused on several entries, a large entry with no receipt, proof
 *    added long after the entry date.
 *  - A seal per entry and one for the whole report. The report seal is a SHA-256
 *    over the sorted entry seals, so it covers the set of entries and their
 *    receipts: change an amount, swap a photo or drop a row and it no longer
 *    matches. It is tamper-EVIDENT against a copy of the seal kept elsewhere
 *    (the saved report, an emailed copy), not proof a receipt is genuine.
 *
 * Pure and synchronous -- no network, no WebCrypto -- so it runs the same in the
 * browser, in report generation and in tests.
 */

import { sha256 } from 'js-sha256';
import { getReceiptImageRef, getReceiptNumber, getReceiptRef } from './transactionReceipt.js';

export const TRUTH_VERSION = 1;

export const EVIDENCE_GRADES = {
  gold: { key: 'gold', label: 'Gold', medal: '🥇', blurb: 'Receipt photo and receipt number' },
  silver: { key: 'silver', label: 'Silver', medal: '🥈', blurb: 'Receipt photo or receipt number' },
  bronze: { key: 'bronze', label: 'Bronze', medal: '🥉', blurb: 'System receipt only' },
};

/** 'warn' flags need a closer look and count toward `attentionCount`; 'info' flags are context only. */
export const TRUTH_FLAGS = {
  reused_proof: { key: 'reused_proof', label: 'Receipt reused', severity: 'warn' },
  large_unbacked: { key: 'large_unbacked', label: 'Large, no receipt', severity: 'warn' },
  late_proof: { key: 'late_proof', label: 'Proof added late', severity: 'info' },
};

export const TRUTH_RATINGS = {
  A: 'Fully evidenced',
  B: 'Well evidenced',
  C: 'Partly evidenced',
  D: 'Thinly evidenced',
};

export const DEFAULT_TRUTH_OPTIONS = {
  /** Entries at or above this (in UGX) with no receipt evidence are flagged. */
  largeAmount: 500000,
  /** Proof attached more than this many days after the entry date is noted. */
  lateProofDays: 7,
};

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_REF_LENGTH = 3; // "1", "n/a", "-" are too generic to call a reuse
const MAX_LISTED_RECEIPTS = 25;

const amountOf = (tx) => Math.abs(Number(tx?.amount) || 0);
const asDate = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
};
const normalizeRef = (ref) => String(ref || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const percent = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** 'gold' | 'silver' | 'bronze' -- consistent with getProofStatus: bronze is the "system" status. */
export const getEvidenceGrade = (tx) => {
  const hasPhoto = Boolean(getReceiptImageRef(tx));
  const hasNumber = Boolean(getReceiptRef(tx));
  if (hasPhoto && hasNumber) return 'gold';
  return hasPhoto || hasNumber ? 'silver' : 'bronze';
};

export const getEvidenceLabel = (grade) => (EVIDENCE_GRADES[grade] || EVIDENCE_GRADES.bronze).label;

/**
 * Entries the platform itself recorded (wallet movements, CMMS postings) have
 * their own two-sided ledger record and no place to attach a photo, so a missing
 * photo isn't a reason to call them out as large and unbacked.
 */
export const isPlatformRecorded = (tx) =>
  ['wallet', 'cmms'].includes(tx?.lock_reason) || /wallet|cmms/i.test(String(tx?.metadata?.source || tx?.metadata?.source_app || ''));

/** Locale-independent text a receipt seal is computed over. Bump TRUTH_VERSION if this changes. */
export const getReceiptCanonical = (tx) => {
  const created = asDate(tx?.created_at);
  return JSON.stringify([
    TRUTH_VERSION,
    getReceiptNumber(tx),
    created ? created.toISOString() : '',
    tx?.transaction_type === 'income' ? 'income' : 'expense',
    amountOf(tx),
    tx?.currency || 'UGX',
    String(tx?.description || '').trim(),
    getEvidenceGrade(tx),
    getReceiptRef(tx) || '',
    getReceiptImageRef(tx) || '',
  ]);
};

/** SHA-256 seal (64 hex chars) for one entry and its receipt. */
export const sealReceipt = (tx) => sha256(getReceiptCanonical(tx));

/**
 * One seal for the whole set: SHA-256 over the entry seals sorted and joined
 * with newlines, so row order in a file never matters. Anyone holding the
 * entry seals can recompute it (`sha256sum` over the same text works too).
 */
export const computeSealRoot = (seals = []) => {
  if (!seals.length) return '';
  return sha256([...seals].sort().join('\n'));
};

/** True when `transactions` still produce `expectedRoot` -- i.e. nothing was edited, added or dropped. */
export const verifySealRoot = (transactions, expectedRoot) =>
  Boolean(expectedRoot) && computeSealRoot((transactions || []).filter(Boolean).map(sealReceipt)) === expectedRoot;

// Flags per entry, aligned to `list`. Reuse is counted per distinct entry (by id when it has one).
const detectFlags = (list, { largeAmount, lateProofDays }) => {
  const flags = list.map(() => []);

  const byNumber = new Map();
  const byPhoto = new Map();
  const note = (map, key, index) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, new Map());
    map.get(key).set(list[index].id || `#${index}`, index);
  };
  list.forEach((tx, index) => {
    const ref = normalizeRef(getReceiptRef(tx));
    note(byNumber, ref.length >= MIN_REF_LENGTH ? ref : '', index);
    note(byPhoto, getReceiptImageRef(tx), index);
  });
  const reuse = list.map(() => []);
  [[byNumber, 'number'], [byPhoto, 'photo']].forEach(([map, what]) => {
    map.forEach((entries) => {
      if (entries.size < 2) return;
      entries.forEach((index) => reuse[index].push(`Same receipt ${what} used on ${entries.size} entries`));
    });
  });

  list.forEach((tx, index) => {
    if (reuse[index].length) flags[index].push({ ...TRUTH_FLAGS.reused_proof, detail: reuse[index].join('; ') });

    const grade = getEvidenceGrade(tx);
    const inUgx = !tx?.currency || tx.currency === 'UGX';
    if (grade === 'bronze' && inUgx && !isPlatformRecorded(tx) && amountOf(tx) >= largeAmount) {
      flags[index].push({ ...TRUTH_FLAGS.large_unbacked, detail: `${amountOf(tx).toLocaleString('en-US')} UGX with no receipt photo or number` });
    }

    const created = asDate(tx?.created_at);
    const attached = asDate(tx?.metadata?.receipt_attached_at);
    if (grade !== 'bronze' && created && attached) {
      const days = Math.floor((attached - created) / DAY_MS);
      if (days > lateProofDays) flags[index].push({ ...TRUTH_FLAGS.late_proof, detail: `Proof added ${plural(days, 'day', 'days')} after the entry date` });
    }
  });

  return flags;
};

const ratingFor = (coverageByValue, attentionCount, total) => {
  if (!total) return null;
  let rating = coverageByValue >= 90 ? 'A' : coverageByValue >= 70 ? 'B' : coverageByValue >= 40 ? 'C' : 'D';
  if (rating === 'A' && attentionCount > 0) rating = 'B'; // full coverage doesn't earn an A while receipts are reused
  return rating;
};

/**
 * Grade, flags and seal for every entry, plus a summary that is safe to store
 * on a saved report (plain numbers and strings -- it flattens cleanly into
 * CSV/Excel). `rows` stay aligned with the input order.
 */
export const analyzeReceiptTruth = (transactions = [], options = {}) => {
  const opts = { ...DEFAULT_TRUTH_OPTIONS, ...options };
  const list = (Array.isArray(transactions) ? transactions : []).filter(Boolean);
  const flags = detectFlags(list, opts);

  const rows = list.map((tx, index) => ({
    tx,
    receiptNumber: getReceiptNumber(tx),
    grade: getEvidenceGrade(tx),
    flags: flags[index],
    seal: sealReceipt(tx),
  }));

  const grades = { gold: { count: 0, amount: 0 }, silver: { count: 0, amount: 0 }, bronze: { count: 0, amount: 0 } };
  const flagCounts = { reused_proof: 0, large_unbacked: 0, late_proof: 0 };
  let photoCount = 0;
  let numberCount = 0;
  let totalAmount = 0;
  let attentionCount = 0;
  const flaggedReceipts = [];

  rows.forEach(({ tx, grade, flags: rowFlags, receiptNumber }) => {
    const amount = amountOf(tx);
    grades[grade].count += 1;
    grades[grade].amount += amount;
    totalAmount += amount;
    if (getReceiptImageRef(tx)) photoCount += 1;
    if (getReceiptRef(tx)) numberCount += 1;
    rowFlags.forEach((flag) => { flagCounts[flag.key] += 1; });
    if (rowFlags.some((flag) => flag.severity === 'warn')) {
      attentionCount += 1;
      if (flaggedReceipts.length < MAX_LISTED_RECEIPTS) flaggedReceipts.push(receiptNumber);
    }
  });

  const total = rows.length;
  const backedCount = grades.gold.count + grades.silver.count;
  const backedAmount = grades.gold.amount + grades.silver.amount;
  const coverageByCount = percent(backedCount, total);
  const coverageByValue = totalAmount > 0 ? percent(backedAmount, totalAmount) : coverageByCount;
  const rating = ratingFor(coverageByValue, attentionCount, total);

  const summary = {
    version: TRUTH_VERSION,
    total,
    totalAmount,
    grades,
    backedCount,
    unbackedCount: grades.bronze.count,
    backedAmount,
    unbackedAmount: grades.bronze.amount,
    photoCount,
    numberCount,
    coverageByCount,
    coverageByValue,
    attentionCount,
    flagCounts,
    flaggedReceipts,
    rating,
    ratingLabel: rating ? TRUTH_RATINGS[rating] : 'No entries',
    sealRoot: computeSealRoot(rows.map((row) => row.seal)),
  };

  return { rows, summary };
};

/** Just the storable summary, for report builders that don't need per-entry rows. */
export const buildReceiptTruth = (transactions, options) => analyzeReceiptTruth(transactions, options).summary;

/** Compact receipt facts to carry on each archived/exported entry. */
export const toReceiptStamp = (row) => ({
  number: row.receiptNumber,
  evidence: row.grade,
  flags: row.flags.map((flag) => flag.key),
  seal: row.seal,
});

/** "Receipt reused; Large, no receipt" -- for a single table cell. */
export const formatFlags = (flags = []) => flags.map((flag) => flag.label).join('; ');

/** First characters of a seal, uppercased, for page footers and chips. */
export const shortSeal = (seal, length = 12) => String(seal || '').slice(0, length).toUpperCase();

/** One plain-English paragraph stating what the receipts back, for report headers, emails and WhatsApp. */
export const getTruthStatement = (summary, { currency = 'UGX' } = {}) => {
  if (!summary || !summary.total) return 'No entries in this report.';
  const money = (n) => `${currency} ${Math.round(n).toLocaleString('en-US')}`;
  const parts = [
    `${summary.backedCount} of ${plural(summary.total, 'entry', 'entries')} (${summary.coverageByCount}%) carry a receipt photo or number, covering ${money(summary.backedAmount)} of ${money(summary.totalAmount)} (${summary.coverageByValue}%).`,
  ];
  if (summary.attentionCount) {
    parts.push(`${plural(summary.attentionCount, 'entry needs', 'entries need')} a closer look.`);
  }
  if (summary.sealRoot) parts.push(`Report seal ${shortSeal(summary.sealRoot)}.`);
  return parts.join(' ');
};

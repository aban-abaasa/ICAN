/**
 * "Receipt truth" block for a generated report: what the receipts behind the
 * report's transactions actually say. Reads the summary a report builder stored
 * on `report.receiptTruth` (see utils/receiptTruth.js) -- nothing is recomputed
 * here, so a saved report shows what was true when it was made.
 */

import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { EVIDENCE_GRADES, getTruthStatement, shortSeal } from '../../utils/receiptTruth';

const TIERS = [
  { ...EVIDENCE_GRADES.gold, hint: 'photo + receipt no.', bar: 'bg-amber-400' },
  { ...EVIDENCE_GRADES.silver, hint: 'photo or receipt no.', bar: 'bg-gray-400' },
  { ...EVIDENCE_GRADES.bronze, hint: 'system receipt only', bar: 'bg-orange-700' },
];

const RATING_STYLE = {
  A: 'bg-green-100 text-green-800 border-green-300',
  B: 'bg-blue-100 text-blue-800 border-blue-300',
  C: 'bg-amber-100 text-amber-800 border-amber-300',
  D: 'bg-red-100 text-red-800 border-red-300',
};

const ReceiptTruthPanel = ({ report }) => {
  const truth = report?.receiptTruth;
  if (!truth || !truth.total) return null;

  const currency = report.currency || 'UGX';
  const money = (n) => `${currency} ${Math.round(n || 0).toLocaleString()}`;
  const flags = [
    truth.flagCounts?.reused_proof > 0 && `${truth.flagCounts.reused_proof} with a reused receipt`,
    truth.flagCounts?.large_unbacked > 0 && `${truth.flagCounts.large_unbacked} large with no receipt`,
  ].filter(Boolean);
  const lateProofs = truth.flagCounts?.late_proof || 0;
  const deductions = report.deductionsSection;
  const hasDeductionEvidence = deductions && (deductions.receiptBackedAmount > 0 || deductions.receiptMissingAmount > 0);

  return (
    <div className="rounded-lg border border-amber-300 bg-gradient-to-br from-amber-50 to-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-bold text-gray-800">
          <ShieldCheck className="h-5 w-5 text-amber-600" />
          Receipt truth
        </h3>
        <span className={`rounded-full border px-3 py-1 text-xs font-bold ${RATING_STYLE[truth.rating] || ''}`}>
          {truth.rating} · {truth.ratingLabel}
        </span>
      </div>

      <p className="mt-3 text-sm text-gray-700">{getTruthStatement(truth, { currency })}</p>

      <div
        className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-gray-200"
        role="img"
        aria-label={TIERS.map((tier) => `${truth.grades[tier.key].count} ${tier.label.toLowerCase()}`).join(', ')}
      >
        {TIERS.map((tier) => (
          <div key={tier.key} className={tier.bar} style={{ width: `${(truth.grades[tier.key].count / truth.total) * 100}%` }} />
        ))}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        {TIERS.map((tier) => (
          <div key={tier.key} className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-2">
            <p className="text-sm font-bold text-gray-800">{tier.medal} {truth.grades[tier.key].count}</p>
            <p className="text-[11px] font-semibold text-gray-600">{tier.label}</p>
            <p className="text-[10px] text-gray-600">{tier.hint}</p>
            <p className="mt-0.5 text-[10px] text-gray-600">{money(truth.grades[tier.key].amount)}</p>
          </div>
        ))}
      </div>

      {hasDeductionEvidence && (
        <p className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
          Claimed deductions with a receipt: <strong>{money(deductions.receiptBackedAmount)}</strong>
          {deductions.receiptMissingAmount > 0 && <> · without one: <strong>{money(deductions.receiptMissingAmount)}</strong> — attach receipts before filing.</>}
        </p>
      )}

      {flags.length > 0 && (
        <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
          ⚠️ {truth.attentionCount} {truth.attentionCount === 1 ? 'entry needs' : 'entries need'} a closer look: {flags.join(' · ')}.
          {truth.flaggedReceipts?.length > 0 && (
            <span className="mt-1 block break-words font-mono text-[10px] font-normal text-amber-800">{truth.flaggedReceipts.join(', ')}</span>
          )}
        </p>
      )}
      {lateProofs > 0 && (
        <p className="mt-2 text-[11px] text-gray-600">
          {lateProofs} {lateProofs === 1 ? 'receipt was' : 'receipts were'} added more than a week after the entry date.
        </p>
      )}

      <div className="mt-3 border-t border-amber-200 pt-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-600">Report seal · SHA-256</p>
        <p className="mt-1 select-all break-all font-mono text-[11px] text-gray-700" title={truth.sealRoot}>
          {shortSeal(truth.sealRoot, 64)}
        </p>
        <p className="mt-1 text-[10px] text-gray-600">
          The seal covers every entry and its receipt. If any amount, photo or entry is changed afterwards, it no longer matches this one.
          It shows the records are unchanged — it does not prove a receipt is genuine.
        </p>
      </div>
    </div>
  );
};

export default ReceiptTruthPanel;

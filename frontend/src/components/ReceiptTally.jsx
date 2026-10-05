import React, { useMemo } from 'react';
import {
  EVIDENCE_GRADES,
  analyzeReceiptTruth,
  getEvidenceGrade,
  shortSeal,
} from '../utils/receiptTruth';

const TIER = {
  gold: { chip: 'bg-amber-400/20 text-amber-200 border border-amber-400/40', bar: 'bg-amber-400' },
  silver: { chip: 'bg-slate-300/15 text-slate-200 border border-slate-300/30', bar: 'bg-slate-300' },
  bronze: { chip: '', bar: 'bg-orange-700' },
};

const RATING_STYLE = {
  A: 'border-emerald-400/50 bg-emerald-400/15 text-emerald-200',
  B: 'border-sky-400/50 bg-sky-400/15 text-sky-200',
  C: 'border-amber-400/50 bg-amber-400/15 text-amber-200',
  D: 'border-rose-400/50 bg-rose-400/15 text-rose-200',
};

/**
 * Small per-entry marker for a transaction row: 🧾 + Gold/Silver when the entry
 * has a receipt photo/number, and a ⚠️ when the truth check flagged it. Pass the
 * analysed `row` (grade + flags) when you have one; with just `tx` it shows the
 * grade only. Bronze entries with nothing flagged show nothing.
 */
export function TruthBadge({ row, tx, className = '' }) {
  const grade = row?.grade || getEvidenceGrade(tx);
  const flags = row?.flags || [];
  const needsLook = flags.some((flag) => flag.severity === 'warn');
  if (grade === 'bronze' && flags.length === 0) return null;
  const title = [
    `${EVIDENCE_GRADES[grade].label} receipt — ${EVIDENCE_GRADES[grade].blurb}`,
    ...flags.map((flag) => `${flag.label}: ${flag.detail}`),
  ].join('\n');
  return (
    <span title={title} className={`inline-flex items-center gap-1 ${className}`}>
      {grade !== 'bronze' && (
        <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${TIER[grade].chip}`}>🧾 {EVIDENCE_GRADES[grade].label}</span>
      )}
      {needsLook && <span className="text-[11px]" role="img" aria-label="Needs a closer look">⚠️</span>}
    </span>
  );
}

const flagLine = (flagCounts) => [
  flagCounts.reused_proof && `${flagCounts.reused_proof} reused ${flagCounts.reused_proof === 1 ? 'receipt' : 'receipts'}`,
  flagCounts.large_unbacked && `${flagCounts.large_unbacked} large with no receipt`,
].filter(Boolean).join(' · ');

/**
 * One-glance receipt truth for a list of transactions: how many are backed by a
 * photo or receipt number (gold/silver/bronze), what needs a closer look, the
 * report seal, and a toggle to show just the ones still missing proof.
 */
export default function ReceiptTally({ transactions, truth, formatCurrency, onlyMissing, onToggleMissing }) {
  const analysis = useMemo(() => truth || analyzeReceiptTruth(transactions), [truth, transactions]);
  const s = analysis.summary;
  if (s.total === 0) return null;
  const share = (grade) => (s.grades[grade].count / s.total) * 100;
  const issues = flagLine(s.flagCounts);

  return (
    <div className="mb-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-bold text-emerald-300">🧾 Receipt truth</p>
        <span
          className={`flex-shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${RATING_STYLE[s.rating] || ''}`}
          title={`${s.ratingLabel} — ${s.coverageByValue}% of the money is backed by a receipt photo or number`}
        >
          {s.rating} · {s.ratingLabel}
        </span>
      </div>

      <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-slate-700/60" role="img" aria-label={`${s.grades.gold.count} gold, ${s.grades.silver.count} silver, ${s.grades.bronze.count} bronze`}>
        {['gold', 'silver', 'bronze'].map((grade) => (
          <div key={grade} className={`h-full transition-all ${TIER[grade].bar}`} style={{ width: `${share(grade)}%` }} />
        ))}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <p className="min-w-0 text-[11px] font-semibold text-slate-200">
          {s.backedCount} of {s.total} backed ({s.coverageByCount}%)
        </p>
        {s.unbackedCount > 0 && (
          <button
            type="button"
            onClick={onToggleMissing}
            className={`flex-shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${onlyMissing ? 'border-amber-400 bg-amber-400/20 text-amber-200' : 'border-slate-600 text-slate-300'}`}
          >
            {onlyMissing ? 'Show all' : `Show ${s.unbackedCount} without`}
          </button>
        )}
      </div>
      <p className="mt-1 text-[10px] text-slate-300">
        {['gold', 'silver', 'bronze'].map((grade) => `${EVIDENCE_GRADES[grade].medal} ${s.grades[grade].count}`).join('  ·  ')}
        <span className="text-slate-500">{'  '}(photo + no. · photo or no. · system only)</span>
      </p>
      <p className="mt-0.5 text-[10px] text-slate-400">
        {formatCurrency(s.backedAmount)} backed by photo/number · {formatCurrency(s.unbackedAmount)} system receipt only
      </p>

      {issues && (
        <p className="mt-1.5 rounded-lg border border-amber-400/30 bg-amber-400/10 px-2 py-1 text-[10px] font-semibold text-amber-200">
          ⚠️ {s.attentionCount} {s.attentionCount === 1 ? 'entry needs' : 'entries need'} a closer look — {issues}
        </p>
      )}
      <p className="mt-1 break-all font-mono text-[9px] text-slate-500" title={`Report seal (SHA-256): ${s.sealRoot}`}>
        🔐 Seal {shortSeal(s.sealRoot)}
      </p>
    </div>
  );
}

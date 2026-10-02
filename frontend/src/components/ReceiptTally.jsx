import React from 'react';
import { getReceiptTally } from '../utils/transactionReceipt';

/**
 * One-glance receipt tally for a list of transactions: how many are backed by
 * a photo or receipt number, and a toggle to show just the ones still missing proof.
 */
export default function ReceiptTally({ transactions, formatCurrency, onlyMissing, onToggleMissing }) {
  const t = getReceiptTally(transactions);
  if (t.total === 0) return null;
  return (
    <div className="mb-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-bold text-emerald-300">🧾 Receipt tally · {t.backed} of {t.total} backed ({t.percent}%)</p>
        {t.unbacked > 0 && (
          <button
            type="button"
            onClick={onToggleMissing}
            className={`flex-shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${onlyMissing ? 'border-amber-400 bg-amber-400/20 text-amber-200' : 'border-slate-600 text-slate-300'}`}
          >
            {onlyMissing ? 'Show all' : `Show ${t.unbacked} without`}
          </button>
        )}
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-700/60">
        <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${t.percent}%` }} />
      </div>
      <p className="mt-1 text-[10px] text-slate-400">
        {formatCurrency(t.backedAmount)} backed by photo/number · {formatCurrency(t.unbackedAmount)} system receipt only
      </p>
    </div>
  );
}

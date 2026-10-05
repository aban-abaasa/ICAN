import React, { useCallback, useEffect, useState } from 'react';
import { GitBranch, Loader } from 'lucide-react';
import { formatMoney, getInventoryReport, getMyBusinessGroup, setGroupFxRate } from '../../services/cmmsAssetLedgerService';

const YEAR = new Date().getFullYear();

// One business, many branches. Each branch runs its own CMMS; the ownership tree
// kept in the Pitchin business profile decides which of them feed this view and
// how much each one shares (totals only, or full register and ledger).
export default function BranchNetworkPanel({ companyId, currentBranchLabel, onGroupLoaded }) {
  const [group, setGroup] = useState(null);
  const [report, setReport] = useState(null);
  const [year, setYear] = useState(YEAR);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fx, setFx] = useState({ currency: '', rate: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError('');
    const { data: groupData, error: groupError } = await getMyBusinessGroup(companyId);
    setGroup(groupData);
    onGroupLoaded?.(groupData);
    if (groupError) setError(groupError.message);
    if (groupData?.group && groupData.branches.length > 0) {
      const { data: reportData, error: reportError } = await getInventoryReport(companyId, year, 'group');
      setReport(reportData);
      if (reportError) setError(reportError.message);
    } else {
      setReport(null);
    }
    setLoading(false);
  }, [companyId, year, onGroupLoaded]);

  useEffect(() => { load(); }, [load]);

  const saveRate = async (event) => {
    event.preventDefault();
    setSaving(true);
    const { error: rateError } = await setGroupFxRate(group.group.id, fx.currency.trim().toUpperCase(), Number(fx.rate));
    setSaving(false);
    if (rateError) { setError(rateError.message); return; }
    setFx({ currency: '', rate: '' });
    load();
  };

  if (loading) return <p className="flex items-center gap-2 text-sm text-gray-400"><Loader className="h-4 w-4 animate-spin" /> Loading branches…</p>;

  if (!group?.group) {
    return (
      <div className="space-y-2 text-sm text-gray-300">
        <p>{currentBranchLabel || 'This business'} is not part of a branch network yet.</p>
        <p className="text-xs text-gray-400">
          Add branches from the Pitchin business profile: <strong>Business Administration → Branches &amp; ownership</strong>.
          Every branch that runs its own CMMS then feeds this view, limited to what it agrees to share.
        </p>
        {error && <p className="text-xs text-red-300">{error}</p>}
      </div>
    );
  }

  const base = report?.base_currency || group.group.base_currency;
  const foreign = [...new Set(group.branches.map((branch) => branch.currency).filter((currency) => currency && currency !== base))];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="flex items-center gap-2 text-sm font-semibold text-white"><GitBranch className="h-4 w-4 text-amber-300" /> {group.group.name}
          <span className="text-xs font-normal text-gray-400">· reported in {base}</span></p>
        <select value={year} onChange={(event) => setYear(Number(event.target.value))} aria-label="Year"
          className="ml-auto rounded border border-white border-opacity-20 bg-white bg-opacity-10 px-2 py-1.5 text-xs text-white">
          {Array.from({ length: 8 }, (_, index) => YEAR - index).map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </div>

      {error && <p className="rounded border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-200">{error}</p>}

      {report && (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {[['Assets at cost', report.totals.assets_cost_base], ['Assets net book', report.totals.assets_nbv_base],
              ['Consumable stock', report.totals.consumables_value_base], [`${year} purchases`, report.totals.purchases_base]].map(([name, amount]) => (
              <div key={name} className="rounded-lg border border-white border-opacity-10 bg-white bg-opacity-5 px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-gray-400">{name}</p>
                <p className="text-sm font-bold text-white">{formatMoney(amount, base)}</p>
              </div>
            ))}
          </div>

          <ul className="divide-y divide-white divide-opacity-10">
            {report.branches.map((branch) => (
              <li key={branch.company_id} className="py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-white">{branch.branch_name}</span>
                  {branch.is_headquarters && <span className="rounded bg-amber-500/20 px-1.5 text-[10px] uppercase text-amber-200">Head office</span>}
                  <span className="text-xs text-gray-400">{[branch.country, branch.branch_code].filter(Boolean).join(' · ')}</span>
                  <span className={`ml-auto rounded px-1.5 text-[10px] uppercase ${branch.access === 'full' ? 'bg-emerald-500/20 text-emerald-200' : 'bg-white bg-opacity-10 text-gray-300'}`}>
                    {branch.access === 'full' ? 'full access' : 'totals only'}
                  </span>
                </div>
                <p className="mt-1 text-xs text-gray-300">
                  Assets {formatMoney(branch.assets.net_book_value, branch.currency)} net
                  {' · '}Stock {formatMoney(branch.consumables.value, branch.currency)}
                  {branch.consumables.low_stock > 0 && <span className="text-orange-300"> · {branch.consumables.low_stock} low</span>}
                  {branch.currency !== base && <span className="text-gray-500"> · {branch.currency}, rate {Number(branch.fx_rate_to_base)}{branch.fx_source === 'missing' ? ' (not set)' : ''}</span>}
                </p>
              </li>
            ))}
          </ul>
          {report.branches_not_shared > 0 && (
            <p className="text-xs text-gray-400">{report.branches_not_shared} branch{report.branches_not_shared === 1 ? ' does' : 'es do'} not share its CMMS with you.</p>
          )}
        </>
      )}

      {group.is_hq_admin && foreign.length > 0 && (
        <form onSubmit={saveRate} className="space-y-2 rounded-lg border border-white border-opacity-10 bg-white bg-opacity-5 p-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-300">Exchange rates to {base}</p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-gray-300">Currency
              <select value={fx.currency} onChange={(event) => setFx((previous) => ({ ...previous, currency: event.target.value }))}
                className="mt-1 block rounded border border-white border-opacity-20 bg-white bg-opacity-10 px-2 py-1.5 text-sm text-white">
                <option value="">Choose…</option>{foreign.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
              </select>
            </label>
            <label className="text-xs text-gray-300">1 unit = {base}
              <input type="number" min="0" step="any" value={fx.rate} onChange={(event) => setFx((previous) => ({ ...previous, rate: event.target.value }))}
                className="mt-1 block w-32 rounded border border-white border-opacity-20 bg-white bg-opacity-10 px-2 py-1.5 text-sm text-white" />
            </label>
            <button disabled={saving || !fx.currency || !fx.rate} className="cmms-classic-btn-primary px-3 py-2 text-xs disabled:opacity-40">{saving ? 'Saving…' : 'Set today’s rate'}</button>
          </div>
          {group.fx_rates?.length > 0 && (
            <p className="text-[11px] text-gray-400">
              Current: {Object.values(group.fx_rates.reduce((latest, rate) => (latest[rate.currency] ? latest : { ...latest, [rate.currency]: rate }), {}))
                .map((rate) => `${rate.currency} ${Number(rate.rate_to_base)} (from ${rate.effective_from})`).join(' · ')}
            </p>
          )}
          <p className="text-[11px] text-gray-500">Each ledger entry keeps the rate in force when it was written. Setting a new rate never rewrites history.</p>
        </form>
      )}
    </div>
  );
}

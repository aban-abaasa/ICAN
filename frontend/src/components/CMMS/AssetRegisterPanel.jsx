import React, { useCallback, useEffect, useState } from 'react';
import { Download, Loader } from 'lucide-react';
import { disposeAsset, formatMoney, getAssetRegister, postAssetDepreciation } from '../../services/cmmsAssetLedgerService';
import { downloadCsv } from './csv';

const YEAR = new Date().getFullYear();

// Fixed-asset register: what is owned, what it cost, what it is worth today.
// Net book value uses the year picked here, so last year's balance sheet can be reproduced.
export default function AssetRegisterPanel({ companyId, canEdit, currency = 'UGX', refreshKey = 0, onChanged }) {
  const [year, setYear] = useState(YEAR);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [disposing, setDisposing] = useState(null);
  const [disposal, setDisposal] = useState({ quantity: 1, proceeds: 0, reason: '' });

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    const { data, error: loadError } = await getAssetRegister(companyId, year);
    setRows(data || []);
    setError(loadError?.message || '');
    setLoading(false);
  }, [companyId, year]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const totals = rows.reduce((sum, row) => ({
    cost: sum.cost + Number(row.total_cost || 0),
    acc: sum.acc + Number(row.accumulated_depreciation || 0),
    nbv: sum.nbv + Number(row.net_book_value || 0),
    dep: sum.dep + Number(row.depreciation_this_year || 0)
  }), { cost: 0, acc: 0, nbv: 0, dep: 0 });

  const postDepreciation = async () => {
    if (!window.confirm(`Post ${year} depreciation to the ledger for every asset? It can be posted once per asset per year and cannot be edited afterwards.`)) return;
    setBusy(true); setError(''); setNotice('');
    const { data, error: postError } = await postAssetDepreciation(companyId, year);
    setBusy(false);
    if (postError) { setError(postError.message); return; }
    setNotice(data?.items_posted
      ? `Posted ${formatMoney(data.total_depreciation, currency)} of ${year} depreciation on ${data.items_posted} asset${data.items_posted === 1 ? '' : 's'}.`
      : `Nothing new to post for ${year}.`);
    onChanged?.();
    load();
  };

  const submitDisposal = async () => {
    setBusy(true); setError('');
    const { data, error: disposeError } = await disposeAsset(disposing.id, {
      quantity: Number(disposal.quantity), proceeds: Number(disposal.proceeds) || 0, reason: disposal.reason || null
    });
    setBusy(false);
    if (disposeError) { setError(disposeError.message); return; }
    setNotice(`Disposed. Net book value removed ${formatMoney(data.nbv_removed, currency)}; ${Number(data.gain_loss) >= 0 ? 'gain' : 'loss'} ${formatMoney(Math.abs(data.gain_loss), currency)}.`);
    setDisposing(null);
    onChanged?.();
    load();
  };

  const exportCsv = () => downloadCsv(`asset-register-${year}.csv`, rows.map((row) => ({
    Code: row.item_code, Asset: row.item_name, Category: row.category, Tag: row.asset_tag, Serial: row.serial_number,
    'Year acquired': row.acquisition_year, 'Year manufactured': row.manufacture_year, Quantity: row.quantity,
    'Unit cost': row.unit_cost, 'Total cost': row.total_cost, 'Useful life': row.useful_life_years, Method: row.depreciation_method,
    'Accumulated depreciation': row.accumulated_depreciation, 'Net book value': row.net_book_value,
    [`Depreciation ${year}`]: row.depreciation_this_year, Condition: row.asset_condition, Status: row.asset_status, Currency: row.currency
  })));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-gray-300">As at end of
          <select value={year} onChange={(event) => setYear(Number(event.target.value))}
            className="mt-1 block rounded border border-white border-opacity-20 bg-white bg-opacity-10 px-3 py-2 text-sm text-white">
            {Array.from({ length: 12 }, (_, index) => YEAR - index).map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={exportCsv} disabled={!rows.length} className="inv-act-tag flex items-center gap-1 disabled:opacity-40"><Download className="h-3 w-3" /> CSV</button>
          {canEdit && year <= YEAR && (
            <button type="button" onClick={postDepreciation} disabled={busy || !rows.length} className="cmms-classic-btn-primary px-3 py-1.5 text-xs disabled:opacity-40">
              {busy ? 'Posting…' : `Post ${year} depreciation`}
            </button>
          )}
        </div>
      </div>

      {error && <p className="rounded border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-200">{error}</p>}
      {notice && <p className="rounded border border-emerald-500/40 bg-emerald-500/10 p-2 text-xs text-emerald-200">{notice}</p>}

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-gray-400"><Loader className="h-4 w-4 animate-spin" /> Loading register…</p>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-400">No assets yet. Add equipment, vehicles or tools as an asset above.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {[['Cost', totals.cost], ['Depreciated', totals.acc], ['Net book value', totals.nbv], [`${year} charge`, totals.dep]].map(([name, amount]) => (
              <div key={name} className="rounded-lg border border-white border-opacity-10 bg-white bg-opacity-5 px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-gray-400">{name}</p>
                <p className="text-sm font-bold text-white">{formatMoney(amount, currency)}</p>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-gray-400">
                <tr><th className="py-2 pr-3">Asset</th><th className="pr-3">Acquired</th><th className="pr-3 text-right">Cost</th><th className="pr-3 text-right">Depreciated</th><th className="pr-3 text-right">Net book</th>{canEdit && <th />}</tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-white border-opacity-10 align-top">
                    <td className="py-2 pr-3">
                      <span className="block font-semibold text-white">{row.item_name}{Number(row.quantity) > 1 ? ` ×${Number(row.quantity)}` : ''}</span>
                      <span className="block text-[11px] text-gray-400">
                        {[row.asset_tag, row.serial_number && `S/N ${row.serial_number}`, row.asset_status !== 'in_service' && row.asset_status?.replace('_', ' ')].filter(Boolean).join(' · ') || row.item_code}
                      </span>
                    </td>
                    <td className="pr-3 text-gray-200">
                      {row.acquisition_year || '—'}
                      <span className="block text-[11px] text-gray-500">{row.age_years != null ? `${row.age_years} yr${row.age_years === 1 ? '' : 's'} old` : ''}{row.manufacture_year ? ` · made ${row.manufacture_year}` : ''}</span>
                    </td>
                    <td className="pr-3 text-right text-gray-200">{formatMoney(row.total_cost, currency)}</td>
                    <td className="pr-3 text-right text-gray-200">{formatMoney(row.accumulated_depreciation, currency)}</td>
                    <td className="pr-3 text-right font-semibold text-green-300">
                      {formatMoney(row.net_book_value, currency)}
                      {row.fully_depreciated && <span className="block text-[11px] font-normal text-gray-500">fully depreciated</span>}
                    </td>
                    {canEdit && (
                      <td className="text-right">
                        <button type="button" onClick={() => { setDisposing(row); setDisposal({ quantity: Number(row.quantity), proceeds: 0, reason: '' }); }} className="text-xs text-red-300 hover:text-red-200">Dispose</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {disposing && (
        <div className="space-y-3 rounded-lg border border-red-500/40 bg-red-500/5 p-3">
          <p className="text-sm font-semibold text-white">Dispose of {disposing.item_name}</p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <label className="text-xs text-gray-300">Units
              <input type="number" min="1" max={disposing.quantity} value={disposal.quantity} onChange={(event) => setDisposal((previous) => ({ ...previous, quantity: event.target.value }))}
                className="mt-1 w-full rounded border border-white border-opacity-20 bg-white bg-opacity-10 px-3 py-2 text-sm text-white" />
            </label>
            <label className="text-xs text-gray-300">Sale proceeds ({currency})
              <input type="number" min="0" value={disposal.proceeds} onChange={(event) => setDisposal((previous) => ({ ...previous, proceeds: event.target.value }))}
                className="mt-1 w-full rounded border border-white border-opacity-20 bg-white bg-opacity-10 px-3 py-2 text-sm text-white" />
            </label>
            <label className="text-xs text-gray-300">Reason
              <input type="text" value={disposal.reason} placeholder="Sold, scrapped, stolen…" onChange={(event) => setDisposal((previous) => ({ ...previous, reason: event.target.value }))}
                className="mt-1 w-full rounded border border-white border-opacity-20 bg-white bg-opacity-10 px-3 py-2 text-sm text-white" />
            </label>
          </div>
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={submitDisposal} className="cmms-classic-btn-danger px-3 py-2 text-xs disabled:opacity-50">{busy ? 'Saving…' : 'Record disposal'}</button>
            <button type="button" onClick={() => setDisposing(null)} className="cmms-classic-btn-secondary px-3 py-2 text-xs">Cancel</button>
          </div>
          <p className="text-[11px] text-gray-400">The disposal is written to the ledger at net book value with the proceeds and gain or loss on the record. Proceeds are not added to the wallet automatically.</p>
        </div>
      )}
    </div>
  );
}

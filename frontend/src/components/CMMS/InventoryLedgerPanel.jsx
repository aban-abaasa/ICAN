import React, { useCallback, useEffect, useState } from 'react';
import { Download, Loader } from 'lucide-react';
import {
  TXN_TYPES,
  formatMoney,
  getInventoryReconciliation,
  getInventoryTransactions,
  getUnpostedMoneyEntries,
  postMissingMoneyEntries
} from '../../services/cmmsAssetLedgerService';
import { downloadCsv } from './csv';

const PAGE = 50;
const YEAR = new Date().getFullYear();
const toneClass = { in: 'text-green-300', out: 'text-orange-300', neutral: 'text-gray-300' };
const select = 'rounded border border-white border-opacity-20 bg-white bg-opacity-10 px-2 py-1.5 text-xs text-white';

// The single source of truth: every stock movement and depreciation entry, as
// written by the database. Nothing here can be edited or deleted.
export default function InventoryLedgerPanel({ companyId, branchCompanyIds = [], baseCurrency = 'UGX', refreshKey = 0, canEdit = false }) {
  const [kind, setKind] = useState('');
  const [type, setType] = useState('');
  const [year, setYear] = useState('');
  const [scope, setScope] = useState('branch');
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [variances, setVariances] = useState(null);
  const [unposted, setUnposted] = useState(null);
  const [reposting, setReposting] = useState(false);

  const filters = useCallback((offset = 0) => ({
    kind: kind || undefined, type: type || undefined, year: year ? Number(year) : undefined,
    companyIds: scope === 'group' && branchCompanyIds.length ? branchCompanyIds : undefined, limit: PAGE, offset
  }), [kind, type, year, scope, branchCompanyIds]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    const result = await getInventoryTransactions(companyId, filters(0));
    setRows(result.data);
    setCount(result.count);
    setError(result.error?.message || '');
    setLoading(false);
  }, [companyId, filters]);

  useEffect(() => { load(); }, [load, refreshKey]);

  useEffect(() => {
    if (!companyId) return;
    getInventoryReconciliation(companyId).then(({ data }) => setVariances(data || []));
    getUnpostedMoneyEntries(companyId).then(({ data }) => setUnposted(data || []));
  }, [companyId, refreshKey]);

  const repost = async () => {
    setReposting(true);
    await postMissingMoneyEntries(companyId);
    const { data } = await getUnpostedMoneyEntries(companyId);
    setUnposted(data || []);
    setReposting(false);
    load();
  };

  const loadMore = async () => {
    const result = await getInventoryTransactions(companyId, filters(rows.length));
    setRows((previous) => [...previous, ...result.data]);
  };

  const exportCsv = () => downloadCsv(`inventory-ledger${year ? `-${year}` : ''}.csv`, rows.map((row) => ({
    Date: new Date(row.txn_date).toISOString().slice(0, 10), Branch: row.branch_name, Kind: row.item_kind,
    Type: TXN_TYPES[row.txn_type]?.label || row.txn_type, Item: row.item_name, Code: row.item_code,
    Quantity: row.quantity, 'Unit cost': row.unit_cost, Amount: row.amount, Currency: row.currency,
    'FX to base': row.fx_rate_to_base, 'Amount (base)': row.amount_base, Reference: row.reference_no || row.reference_type,
    Counterparty: row.counterparty, 'Money ledger linked': row.ican_transaction_id ? 'yes' : '', Notes: row.notes, By: row.actor_email
  })));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select value={kind} onChange={(event) => setKind(event.target.value)} className={select} aria-label="Kind">
          <option value="">All items</option><option value="asset">Assets</option><option value="consumable">Consumables</option>
        </select>
        <select value={type} onChange={(event) => setType(event.target.value)} className={select} aria-label="Type">
          <option value="">All movements</option>
          {Object.entries(TXN_TYPES).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}
        </select>
        <select value={year} onChange={(event) => setYear(event.target.value)} className={select} aria-label="Year">
          <option value="">All years</option>
          {Array.from({ length: 12 }, (_, index) => YEAR - index).map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
        {branchCompanyIds.length > 1 && (
          <select value={scope} onChange={(event) => setScope(event.target.value)} className={select} aria-label="Scope">
            <option value="branch">This branch</option><option value="group">All branches I can read</option>
          </select>
        )}
        <button type="button" onClick={exportCsv} disabled={!rows.length} className="inv-act-tag ml-auto flex items-center gap-1 disabled:opacity-40"><Download className="h-3 w-3" /> CSV</button>
      </div>

      <p className={`text-xs ${variances && variances.length ? 'text-orange-300' : 'text-gray-400'}`}>
        {variances === null ? 'Checking the books…'
          : variances.length === 0 ? '✓ Ledger agrees with the stock on the shelf.'
          : `⚠ ${variances.length} item${variances.length === 1 ? '' : 's'} where the shelf and the ledger disagree: ${variances.slice(0, 3).map((item) => item.item_name).join(', ')}${variances.length > 3 ? '…' : ''}`}
      </p>

      <p className={`text-xs ${unposted && unposted.length ? 'text-orange-300' : 'text-gray-400'}`}>
        {unposted === null ? 'Checking the transaction record…'
          : unposted.length === 0 ? '✓ Every purchase, depreciation and disposal is in the business transaction record.'
          : `⚠ ${unposted.length} money transaction${unposted.length === 1 ? ' is' : 's are'} not in the business transaction record (${unposted.slice(0, 2).map((entry) => `${entry.item_name}: ${entry.reason}`).join('; ')}${unposted.length > 2 ? '…' : ''}).`}
        {unposted && unposted.some((entry) => entry.reason === 'not booked yet') && canEdit && (
          <button type="button" onClick={repost} disabled={reposting} className="ml-2 text-amber-300 underline hover:text-amber-200 disabled:opacity-50">{reposting ? 'Posting…' : 'Post them now'}</button>
        )}
      </p>

      {error && <p className="rounded border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-200">{error}</p>}

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-gray-400"><Loader className="h-4 w-4 animate-spin" /> Loading ledger…</p>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-400">No transactions match.</p>
      ) : (
        <>
          <ul className="divide-y divide-white divide-opacity-10">
            {rows.map((row) => {
              const meta = TXN_TYPES[row.txn_type] || { label: row.txn_type, tone: 'neutral' };
              return (
                <li key={row.id} className="flex items-start justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-white">
                      <span className={`font-semibold ${toneClass[meta.tone]}`}>{meta.label}</span>
                      <span className="text-gray-300"> · {row.item_name || 'Removed item'}</span>
                      <span className="ml-1 rounded bg-white bg-opacity-10 px-1 text-[10px] uppercase text-gray-300">{row.item_kind}</span>
                    </p>
                    <p className="text-[11px] text-gray-400">
                      {new Date(row.txn_date).toLocaleDateString()}
                      {branchCompanyIds.length > 1 && scope === 'group' ? ` · ${row.branch_name}` : ''}
                      {Number(row.quantity) !== 0 ? ` · ${Number(row.quantity) > 0 ? '+' : ''}${Number(row.quantity)}` : ''}
                      {row.reference_type ? ` · ${row.reference_type.replace(/_/g, ' ')}` : ''}
                      {row.counterparty ? ` · ${row.counterparty}` : ''}
                      {row.ican_transaction_id ? ' · in money ledger' : ''}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold text-white">{formatMoney(row.amount, row.currency)}</p>
                    {row.currency !== baseCurrency && Number(row.fx_rate_to_base) !== 1 && (
                      <p className="text-[11px] text-gray-500">≈ {formatMoney(row.amount_base, baseCurrency)}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>Showing {rows.length} of {count}</span>
            {rows.length < count && <button type="button" onClick={loadMore} className="text-amber-300 hover:text-amber-200">Load more</button>}
          </div>
        </>
      )}
    </div>
  );
}

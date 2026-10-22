import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { devSaleFees } from '../services/saleFeeService';
import { SALE_FEES, percentToRate, rateToPercent, describeFee, describeChange } from '../utils/saleFees';

/**
 * "Sale fees" tab of the ICAN dev panel: what ICANera takes when a business makes a sale. Dropship (default 2%) comes out of the
 * reseller's markup; a Digital City Era store sale paid from an IcanEra wallet (default 1%) comes out of what the store receives. The
 * customer never pays it. A change applies from the next sale. Talks to ican_dev_get_sale_fees / ican_dev_set_sale_fee
 * (supabase/migrations/20261109100000_sale_fees_dev_panel.sql): the panel's dev token AND the signed-in operator account are required.
 */

const card = { background: 'var(--dp-card)', borderColor: 'var(--dp-card-bd)' };
const field = { background: 'var(--dp-inner)', borderColor: 'var(--dp-inner-bd)', color: 'var(--dp-txt)' };

const titleOf = (key) => SALE_FEES.find((f) => f.key === key)?.title || key;

export default function ICANFeesDevTab({ devToken }) {
  const [data, setData] = useState(null);
  const [missing, setMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const [drafts, setDrafts] = useState({}); // key -> text in the box; absent = untouched

  const say = (m) => { setFlash(m); setTimeout(() => setFlash(''), 3500); };

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await devSaleFees.get(devToken);
      if (res.missing) { setMissing(true); return; }
      setData(res.data);
    } catch (e) {
      setError(/unauthorized/i.test(e?.message || '')
        ? 'Not allowed. Fees can only be read and changed from the allowlisted developer account, not from a support link.'
        : (e?.message || 'Could not load.'));
    } finally {
      setLoading(false);
    }
  }, [devToken]);
  useEffect(() => { load(); }, [load]);

  const save = async (fee, current) => {
    const parsed = percentToRate(drafts[fee.key]);
    if (!parsed.ok) { setError(parsed.error); return; }
    const change = describeChange(fee, current, parsed.rate);
    if (!change.changed) { setDrafts((d) => { const n = { ...d }; delete n[fee.key]; return n; }); return; }
    if (!window.confirm(change.message)) return;
    if (change.big && !window.confirm(`Please confirm once more: ${fee.title} at ${describeFee(parsed.rate)}.`)) return;
    setBusyKey(fee.key); setError('');
    try {
      const res = await devSaleFees.set(devToken, fee.key, parsed.rate);
      if (res.missing) { setMissing(true); return; }
      if (!res.data?.success) { setError(res.data?.error || 'That did not work.'); return; }
      setDrafts((d) => { const n = { ...d }; delete n[fee.key]; return n; });
      say(`${fee.title}: ${describeFee(res.data.old_rate ?? current)} → ${describeFee(res.data.rate)}. Applies from the next sale.`);
      await load();
    } catch (e) {
      setError(/unauthorized/i.test(e?.message || '')
        ? 'Not allowed. Fees can only be changed from the allowlisted developer account, not from a support link.'
        : (e?.message || 'That did not work.'));
    } finally {
      setBusyKey('');
    }
  };

  if (loading) return <p className="text-sm" style={{ color: 'var(--dp-muted)' }}>Loading…</p>;
  if (missing) return <p className="text-sm" style={{ color: 'var(--dp-muted)' }}>The sale fees are not installed yet. Run SALE_PLATFORM_FEES_PASTE_INTO_SUPABASE.sql, then SALE_FEES_DEV_PANEL_PASTE_INTO_SUPABASE.sql.</p>;
  if (!data) return <p className="text-sm text-red-400">{error || 'Nothing to show.'}</p>;

  const byKey = Object.fromEntries((data.fees || []).map((f) => [f.key, f]));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold" style={{ color: 'var(--dp-txt)' }}>Sale fees</h2>
        <button type="button" onClick={load} className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border" style={field}><RefreshCw className="w-3.5 h-3.5" />Refresh</button>
      </div>
      <p className="text-sm" style={{ color: 'var(--dp-muted)' }}>
        What ICANera takes when a business makes a sale. It comes out of the business&apos;s side; the customer pays the same price either way.
        A change applies from the next sale.
      </p>
      {error && <p className="text-sm text-red-400" role="alert">{error}</p>}
      {flash && <p className="text-sm text-emerald-400" role="status">{flash}</p>}

      <div className="grid gap-4 md:grid-cols-2">
        {SALE_FEES.map((fee) => {
          const row = byKey[fee.key];
          const current = row ? Number(row.rate) : fee.defaultRate;
          const text = drafts[fee.key] ?? rateToPercent(current);
          const parsed = percentToRate(text);
          const dirty = drafts[fee.key] !== undefined && parsed.ok && parsed.rate !== current;
          return (
            <div key={fee.key} className="rounded-xl border p-4 space-y-3" style={card}>
              <div>
                <p className="font-semibold" style={{ color: 'var(--dp-txt)' }}>{fee.title}</p>
                <p className="text-xs" style={{ color: 'var(--dp-muted)' }}>Paid by {fee.paidBy}.</p>
              </div>
              <p className="text-3xl font-bold" style={{ color: 'var(--dp-txt)' }}>{describeFee(current)}
                <span className="ml-2 text-xs font-normal" style={{ color: 'var(--dp-muted)' }}>charged now{current === fee.defaultRate ? ' (the default)' : ` · default ${describeFee(fee.defaultRate)}`}</span>
              </p>
              {row && !row.in_table && <p className="text-xs text-amber-400">The row was deleted from the fee table, so the default is being charged. Saving puts it back.</p>}
              <label className="block text-xs" style={{ color: 'var(--dp-muted)' }}>New fee (% of the sale)
                <div className="mt-1 flex gap-2">
                  <input value={text} inputMode="decimal" onChange={(e) => { setError(''); setDrafts((d) => ({ ...d, [fee.key]: e.target.value.replace(/[^0-9.%]/g, '') })); }}
                    className="w-32 rounded-lg border px-3 py-2 text-sm" style={field} aria-label={`${fee.title} fee in percent`} />
                  <button type="button" disabled={!dirty || busyKey === fee.key} onClick={() => save(fee, current)}
                    className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-sky-600 hover:bg-sky-500 disabled:opacity-40">{busyKey === fee.key ? 'Saving…' : 'Save'}</button>
                </div>
                {drafts[fee.key] !== undefined && !parsed.ok && <span className="block mt-1 text-[11px] text-red-400">{parsed.error}</span>}
                <span className="block mt-1 text-[11px] opacity-80">0 switches it off. Up to four decimals, for example 1.25.</span>
              </label>
              {row?.updated_at && <p className="text-[11px]" style={{ color: 'var(--dp-muted)' }}>Last changed {new Date(row.updated_at).toLocaleString()}</p>}
            </div>
          );
        })}
      </div>

      <div className="rounded-xl border p-4 space-y-2" style={card}>
        <p className="font-semibold" style={{ color: 'var(--dp-txt)' }}>Recent changes</p>
        {(data.changes || []).length === 0
          ? <p className="text-sm" style={{ color: 'var(--dp-muted)' }}>No change has been made from this panel yet.</p>
          : (
            <ul className="text-sm space-y-1">
              {data.changes.map((c, i) => (
                <li key={`${c.changed_at}-${i}`} style={{ color: 'var(--dp-txt)' }}>
                  {titleOf(c.key)}: {describeFee(c.old_rate)} → <strong>{describeFee(c.new_rate)}</strong>
                  <span className="ml-2 text-xs" style={{ color: 'var(--dp-muted)' }}>{new Date(c.changed_at).toLocaleString()} · {c.changed_by || 'unknown'}</span>
                </li>
              ))}
            </ul>
          )}
      </div>
    </div>
  );
}

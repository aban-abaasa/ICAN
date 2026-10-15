import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, ShieldCheck, AlertTriangle } from 'lucide-react';
import { devStable } from '../services/stableUnitService';
import { trim } from '../utils/stableUnitRules';

/**
 * ICEC-S tab of the ICAN dev panel: the switch, the live value (dollar rate and inflation floor), the vault, the settings and a
 * reconcile that recomputes the books from the immutable ledgers. Talks to ican_stable_dev_*
 * (supabase/migrations/20261024100000_icec_stable_in_system.sql) with the panel's dev token, like every other tab.
 *
 * Trading ships OFF. Fund the vault first (UGX): a buy is refused unless the vault covers every ICEC-S in circulation plus the
 * stress margin, which is what makes the dollar promise a backed one.
 */

const card = { background: 'var(--dp-card)', borderColor: 'var(--dp-card-bd)' };
const field = { background: 'var(--dp-inner)', borderColor: 'var(--dp-inner-bd)', color: 'var(--dp-txt)' };

const SETTING_FIELDS = [
  ['fee_bps', 'Fee (basis points)', '50 = 0.5% on each buy and each sell, paid to the vault'],
  ['stress_pct', 'Vault stress margin (%)', 'A buy needs vault >= what holders are owed x (1 + this)'],
  ['max_trade_ugx', 'Largest swap (UGX)', 'Per swap, on the UGX value'],
  ['max_position_ugx', 'Largest holding (UGX)', 'Per user, on cost'],
  ['max_trades_per_minute', 'Swaps per minute', 'Per user'],
  ['rates_max_age_s', 'Rates must be fresher than (seconds)', 'The currency feed runs hourly; older than this and swaps pause'],
];

export default function ICANStableDevTab({ devToken }) {
  const [ov, setOv] = useState(null);
  const [missing, setMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({});
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [recon, setRecon] = useState(null);

  const say = (m) => { setFlash(m); setTimeout(() => setFlash(''), 3000); };
  const load = useCallback(async () => {
    setError('');
    try {
      const res = await devStable.overview(devToken);
      if (res.missing) { setMissing(true); return; }
      setOv(res.data);
      setForm((f) => (Object.keys(f).length ? f : Object.fromEntries(SETTING_FIELDS.map(([k]) => [k, String(res.data.settings[k] ?? '')]))));
    } catch (e) {
      setError(e.message || 'Could not load.');
    } finally {
      setLoading(false);
    }
  }, [devToken]);
  useEffect(() => { load(); }, [load]);

  const act = async (fn, okMsg) => {
    setBusy(true); setError('');
    try {
      const res = await fn();
      if (res?.missing) setMissing(true); else { say(okMsg); await load(); }
    } catch (e) {
      setError(e.message || 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  const changed = useMemo(() => {
    if (!ov) return {};
    const out = {};
    for (const [k] of SETTING_FIELDS) if (String(form[k] ?? '') !== String(ov.settings[k] ?? '') && form[k] !== '') out[k] = Number(form[k]);
    return out;
  }, [form, ov]);

  if (loading) return <p className="text-sm" style={{ color: 'var(--dp-muted)' }}>Loading…</p>;
  if (missing) return <p className="text-sm" style={{ color: 'var(--dp-muted)' }}>ICEC-S is not installed yet. Run supabase/migrations/20261024100000_icec_stable_in_system.sql (or ICEC_S_IN_SYSTEM_PASTE_INTO_SUPABASE.sql).</p>;
  if (!ov) return <p className="text-sm text-red-400">{error || 'Nothing to show.'}</p>;

  const s = ov.settings;
  const enabled = !!s.trading_enabled;
  const vault = ov.vault;
  const val = ov.value || {};
  const thin = vault.cover_ratio != null && vault.cover_ratio < vault.required_ratio;
  const unfunded = !(Number(vault.balance_ugx) > 0);

  const toggle = () => {
    if (!enabled && !window.confirm('Turn ICEC-S swaps ON?\n\nUsers can buy and sell with their real wallet balances as soon as this is on. Is the vault funded, and have you checked the fee and limits?')) return;
    act(() => devStable.setSettings(devToken, { trading_enabled: !enabled }), enabled ? 'ICEC-S swaps are OFF.' : 'ICEC-S swaps are ON.');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold" style={{ color: 'var(--dp-txt)' }}>ICEC-S · stable form</h2>
        <button type="button" onClick={load} className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border" style={field}><RefreshCw className="w-3.5 h-3.5" />Refresh</button>
      </div>
      {error && <p className="text-sm text-red-400" role="alert">{error}</p>}
      {flash && <p className="text-sm text-emerald-400" role="status">{flash}</p>}

      <div className="rounded-xl border p-4 flex flex-wrap items-center justify-between gap-3" style={card}>
        <div>
          <p className="font-semibold" style={{ color: 'var(--dp-txt)' }}>Swaps are {enabled ? 'ON' : 'OFF'}</p>
          <p className="text-xs" style={{ color: 'var(--dp-muted)' }}>
            {enabled ? 'Users can buy and sell ICEC-S. Turning it off pauses every swap at once.' : unfunded ? 'Nobody can swap. Fund the vault first, then turn this on.' : 'Nobody can swap. The vault is funded: you can turn it on.'}
          </p>
        </div>
        <button type="button" disabled={busy} onClick={toggle}
          className={`px-4 py-2 rounded-lg text-sm font-bold text-white ${enabled ? 'bg-red-600 hover:bg-red-500' : 'bg-emerald-600 hover:bg-emerald-500'} disabled:opacity-50`}>{enabled ? 'Turn OFF' : 'Turn ON'}</button>
      </div>

      <div className="rounded-xl border p-4 space-y-2" style={card}>
        <p className="font-semibold" style={{ color: 'var(--dp-txt)' }}>What one ICEC-S is worth (from the live currency feed)</p>
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div><dt className="text-xs" style={{ color: 'var(--dp-muted)' }}>Value (UGX)</dt><dd style={{ color: 'var(--dp-txt)' }}>{trim(val.unit_ugx, 2)}</dd></div>
          <div><dt className="text-xs" style={{ color: 'var(--dp-muted)' }}>Live dollar rate</dt><dd style={{ color: 'var(--dp-txt)' }}>{trim(val.fx_ugx, 2)}</dd></div>
          <div><dt className="text-xs" style={{ color: 'var(--dp-muted)' }}>Inflation floor</dt><dd className={val.protected ? 'text-emerald-400' : ''} style={val.protected ? undefined : { color: 'var(--dp-txt)' }}>{trim(val.floor_ugx, 2)}{val.protected ? ' (holding)' : ''}</dd></div>
          <div><dt className="text-xs" style={{ color: 'var(--dp-muted)' }}>Rates updated</dt><dd style={{ color: 'var(--dp-txt)' }}>{val.rates_updated_at ? new Date(val.rates_updated_at).toLocaleString() : '—'}</dd></div>
        </dl>
        <p className="text-xs" style={{ color: 'var(--dp-muted)' }}>Value = the larger of the live dollar rate and the start value grown by Uganda's inflation ({val.inflation_pct}% a year), exactly as icaneracoin's own floor works.</p>
      </div>

      <div className="rounded-xl border p-4 space-y-3" style={card}>
        <div className="flex items-center gap-2">
          {thin || unfunded ? <AlertTriangle className="w-4 h-4 text-amber-400" /> : <ShieldCheck className="w-4 h-4 text-emerald-400" />}
          <p className="font-semibold" style={{ color: 'var(--dp-txt)' }}>Vault (UGX)</p>
        </div>
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div><dt className="text-xs" style={{ color: 'var(--dp-muted)' }}>Balance</dt><dd style={{ color: 'var(--dp-txt)' }}>{trim(vault.balance_ugx, 2)}</dd></div>
          <div><dt className="text-xs" style={{ color: 'var(--dp-muted)' }}>ICEC-S in circulation</dt><dd style={{ color: 'var(--dp-txt)' }}>{trim(vault.units_outstanding, 8)}</dd></div>
          <div><dt className="text-xs" style={{ color: 'var(--dp-muted)' }}>Cover</dt><dd className={thin ? 'text-amber-400' : ''} style={thin ? undefined : { color: 'var(--dp-txt)' }}>{vault.cover_ratio == null ? 'nothing owed' : `${vault.cover_ratio}x`}</dd></div>
          <div><dt className="text-xs" style={{ color: 'var(--dp-muted)' }}>Needed for new buys</dt><dd style={{ color: 'var(--dp-txt)' }}>{vault.required_ratio}x</dd></div>
        </dl>
        <div className="flex flex-wrap gap-2">
          <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.-]/g, ''))} placeholder="UGX (negative to withdraw)" inputMode="decimal" className="w-48 rounded-lg border px-3 py-2 text-sm" style={field} />
          <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Reason (kept forever)" className="flex-1 min-w-[10rem] rounded-lg border px-3 py-2 text-sm" style={field} />
          <button type="button" disabled={busy || !Number(amount) || memo.trim().length < 3}
            onClick={() => act(async () => { const r = await devStable.adjustVault(devToken, Number(amount), memo.trim()); setAmount(''); setMemo(''); return r; }, 'Vault updated.')}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-sky-600 hover:bg-sky-500 disabled:opacity-40">Record</button>
        </div>
        <p className="text-xs" style={{ color: 'var(--dp-muted)' }}>Record only UGX you really hold in reserve. Every movement is a permanent ledger entry. A withdrawal that would leave the vault below what holders are owed plus the margin is refused.</p>
      </div>

      <div className="rounded-xl border p-4 space-y-3" style={card}>
        <p className="font-semibold" style={{ color: 'var(--dp-txt)' }}>Settings</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {SETTING_FIELDS.map(([k, label, hint]) => (
            <label key={k} className="block text-xs" style={{ color: 'var(--dp-muted)' }}>{label}
              <input value={form[k] ?? ''} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value.replace(/[^0-9.]/g, '') }))} inputMode="decimal" className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" style={field} />
              <span className="block mt-0.5 text-[11px] opacity-80">{hint}</span>
            </label>
          ))}
        </div>
        <button type="button" disabled={busy || !Object.keys(changed).length} onClick={() => act(() => devStable.setSettings(devToken, changed), 'Settings saved.')}
          className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-sky-600 hover:bg-sky-500 disabled:opacity-40">Save {Object.keys(changed).length ? `(${Object.keys(changed).length})` : ''}</button>
      </div>

      <div className="rounded-xl border p-4 space-y-2" style={card}>
        <p className="font-semibold" style={{ color: 'var(--dp-txt)' }}>Activity and books</p>
        <p className="text-sm" style={{ color: 'var(--dp-txt)' }}>
          {ov.holders} holder{ov.holders === 1 ? '' : 's'} · {ov.activity_24h.swaps} swaps in 24 h · volume UGX {trim(ov.activity_24h.volume_ugx, 0)} · fees UGX {trim(ov.activity_24h.fees_ugx, 2)}
        </p>
        <div className="flex items-center gap-3">
          <button type="button" disabled={busy} onClick={async () => { setBusy(true); try { const r = await devStable.reconcile(devToken); setRecon(r.data); } catch (e) { setError(e.message); } finally { setBusy(false); } }}
            className="px-4 py-2 rounded-lg text-sm font-semibold border" style={field}>Reconcile the books</button>
          {recon && <span className={`text-sm ${recon.ok ? 'text-emerald-400' : 'text-red-400'}`} role="status">{recon.ok ? 'Everything balances.' : `Problem found: ${JSON.stringify(recon)}`}</span>}
        </div>
      </div>
    </div>
  );
}

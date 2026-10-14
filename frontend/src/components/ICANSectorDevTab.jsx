import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, ShieldCheck, AlertTriangle } from 'lucide-react';
import { devSector } from '../services/sectorMarketService';
import { formatLevel, formatPrice, trim } from '../utils/sectorTradeRules';

/**
 * Sector Markets tab of the ICAN dev panel: the kill switch, the vault, each sector's state, the settings, the
 * business-category -> sector map, and a reconcile that recomputes the books from the immutable ledgers.
 * Talks to ican_sector_dev_* (supabase/migrations/20261019130000_sector_trading_execute.sql) with the panel's dev
 * token, like every other tab.
 *
 * Trading ships OFF. Before turning it on: the data-clause wording has been reviewed by a lawyer, the regulator
 * position for a house-counterparty index product is settled, each sector you want open has reached its minimum
 * number of contributing businesses, and the vault is funded (see SECTOR_TRADING_DEPLOY.md, "Before you turn it on").
 */

const card = { background: 'var(--dp-card)', borderColor: 'var(--dp-card-bd)' };
const field = { background: 'var(--dp-inner)', borderColor: 'var(--dp-inner-bd)', color: 'var(--dp-txt)' };

// setting key -> [label, hint]
const SETTING_FIELDS = [
  ['fee_bps', 'Fee (basis points)', '100 = 1% on each buy and each sell, paid to the vault'],
  ['max_trade_icec', 'Largest trade (ICEC)', 'Per trade, on the ICEC value'],
  ['max_position_icec', 'Largest position (ICEC)', 'Per user per sector, on cost'],
  ['max_trades_per_minute', 'Trades per minute', 'Per user'],
  ['stress_pct', 'Vault stress margin (%)', 'A buy needs vault >= what users hold x (1 + this)'],
  ['k_min', 'Businesses needed to open a sector', 'Below this nothing is published or tradable (minimum 3)'],
  ['window_hours', 'Revenue window (hours)', 'Trailing window the index measures'],
  ['contributor_cap_multiple', 'One business counts at most (x median)', 'Stops any single business moving a sector'],
  ['ema_minutes', 'Smoothing (minutes)', 'Time constant of the smoothing'],
  ['max_move_pct_per_hour', 'Circuit breaker (% per hour)', 'The level cannot move faster than this'],
  ['stale_s', 'Index must be fresher than (seconds)', 'Older than this and trading pauses'],
];

export default function ICANSectorDevTab({ devToken }) {
  const [ov, setOv] = useState(null);
  const [missing, setMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({});
  const [vaultAmount, setVaultAmount] = useState('');
  const [vaultMemo, setVaultMemo] = useState('');
  const [mapIndustry, setMapIndustry] = useState('');
  const [mapTicker, setMapTicker] = useState('');
  const [recon, setRecon] = useState(null);

  const say = (msg) => { setFlash(msg); setTimeout(() => setFlash(''), 3000); };

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await devSector.overview(devToken);
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
  if (missing) return <p className="text-sm" style={{ color: 'var(--dp-muted)' }}>Sector Markets is not installed yet. Run the four sector SQL files (see SECTOR_TRADING_DEPLOY.md).</p>;
  if (!ov) return <p className="text-sm text-red-400">{error || 'Nothing to show.'}</p>;

  const s = ov.settings;
  const enabled = !!s.trading_enabled;
  const vault = ov.vault;
  const thin = vault.cover_ratio != null && vault.cover_ratio < vault.required_ratio;

  const toggleTrading = () => {
    if (!enabled && !window.confirm('Turn sector trading ON?\n\nBefore you do: has the data-clause wording been reviewed by a lawyer, is the regulator position settled, are the sectors you want open past their business minimum, and is the vault funded? Users can buy and sell as soon as this is on.')) return;
    act(() => devSector.setSettings(devToken, { trading_enabled: !enabled }), enabled ? 'Trading is OFF.' : 'Trading is ON.');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold" style={{ color: 'var(--dp-txt)' }}>Sector Markets</h2>
        <button type="button" onClick={load} className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border" style={field}><RefreshCw className="w-3.5 h-3.5" />Refresh</button>
      </div>
      {error && <p className="text-sm text-red-400" role="alert">{error}</p>}
      {flash && <p className="text-sm text-emerald-400" role="status">{flash}</p>}

      {/* kill switch */}
      <div className="rounded-xl border p-4 flex flex-wrap items-center justify-between gap-3" style={card}>
        <div>
          <p className="font-semibold" style={{ color: 'var(--dp-txt)' }}>Trading is {enabled ? 'ON' : 'OFF'}</p>
          <p className="text-xs" style={{ color: 'var(--dp-muted)' }}>{enabled ? 'Users can buy and sell open sectors. Turning it off pauses every buy and sell at once.' : 'Nobody can buy or sell. Sectors still collect revenue and compute their indices.'}</p>
        </div>
        <button type="button" disabled={busy} onClick={toggleTrading}
          className={`px-4 py-2 rounded-lg text-sm font-bold text-white ${enabled ? 'bg-red-600 hover:bg-red-500' : 'bg-emerald-600 hover:bg-emerald-500'} disabled:opacity-50`}>
          {enabled ? 'Turn OFF' : 'Turn ON'}
        </button>
      </div>

      {/* vault */}
      <div className="rounded-xl border p-4 space-y-3" style={card}>
        <div className="flex items-center gap-2">
          {thin ? <AlertTriangle className="w-4 h-4 text-amber-400" /> : <ShieldCheck className="w-4 h-4 text-emerald-400" />}
          <p className="font-semibold" style={{ color: 'var(--dp-txt)' }}>Vault</p>
        </div>
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div><dt className="text-xs" style={{ color: 'var(--dp-muted)' }}>Balance (ICEC)</dt><dd style={{ color: 'var(--dp-txt)' }}>{trim(vault.balance_icec, 6)}</dd></div>
          <div><dt className="text-xs" style={{ color: 'var(--dp-muted)' }}>Owed to users (ICEC)</dt><dd style={{ color: 'var(--dp-txt)' }}>{trim(vault.exposure_icec, 6)}</dd></div>
          <div><dt className="text-xs" style={{ color: 'var(--dp-muted)' }}>Cover</dt><dd className={thin ? 'text-amber-400' : ''} style={thin ? undefined : { color: 'var(--dp-txt)' }}>{vault.cover_ratio == null ? 'nothing owed' : `${vault.cover_ratio}x`}</dd></div>
          <div><dt className="text-xs" style={{ color: 'var(--dp-muted)' }}>Needed for new buys</dt><dd style={{ color: 'var(--dp-txt)' }}>{vault.required_ratio}x</dd></div>
        </dl>
        <div className="flex flex-wrap gap-2">
          <input value={vaultAmount} onChange={(e) => setVaultAmount(e.target.value.replace(/[^0-9.-]/g, ''))} placeholder="ICEC (negative to withdraw)" inputMode="decimal"
            className="w-48 rounded-lg border px-3 py-2 text-sm" style={field} />
          <input value={vaultMemo} onChange={(e) => setVaultMemo(e.target.value)} placeholder="Reason (kept forever)" className="flex-1 min-w-[10rem] rounded-lg border px-3 py-2 text-sm" style={field} />
          <button type="button" disabled={busy || !Number(vaultAmount) || vaultMemo.trim().length < 3}
            onClick={() => act(async () => { const r = await devSector.adjustVault(devToken, Number(vaultAmount), vaultMemo.trim()); setVaultAmount(''); setVaultMemo(''); return r; }, 'Vault updated.')}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-sky-600 hover:bg-sky-500 disabled:opacity-40">Record</button>
        </div>
        <p className="text-xs" style={{ color: 'var(--dp-muted)' }}>Every movement is a permanent ledger entry. A withdrawal that would leave the vault below what users hold plus the stress margin is refused.</p>
      </div>

      {/* sectors */}
      <div className="rounded-xl border overflow-x-auto" style={card}>
        <table className="w-full text-sm">
          <thead><tr className="text-xs" style={{ color: 'var(--dp-muted)' }}>
            <th className="text-left px-3 py-2">Sector</th><th className="text-left px-2">Status</th><th className="text-right px-2">Businesses</th>
            <th className="text-right px-2">Level</th><th className="text-right px-2">Price</th><th className="text-right px-2">Units held</th><th />
          </tr></thead>
          <tbody>
            {ov.sectors.map((x) => (
              <tr key={x.ticker} className="border-t" style={{ borderColor: 'var(--dp-sep)', color: 'var(--dp-txt)', opacity: x.enabled ? 1 : 0.5 }}>
                <td className="px-3 py-2"><span className="font-mono font-bold">{x.ticker}</span> <span className="text-xs" style={{ color: 'var(--dp-muted)' }}>{x.name}</span></td>
                <td className="px-2">{x.admin_halted ? 'halted' : x.status}</td>
                <td className="text-right px-2">{x.contributors}{x.status === 'warming_up' ? ` / ${s.k_min}` : ''}</td>
                <td className="text-right px-2">{formatLevel(x.level)}</td>
                <td className="text-right px-2">{formatPrice(x.price_icec)}</td>
                <td className="text-right px-2">{trim(x.units_held, 8)}</td>
                <td className="text-right px-3 whitespace-nowrap">
                  <button type="button" disabled={busy} onClick={() => act(() => devSector.setSector(devToken, x.ticker, { halted: !x.admin_halted }), x.admin_halted ? `${x.ticker} resumed.` : `${x.ticker} halted.`)} className="text-xs underline mr-3">{x.admin_halted ? 'Resume' : 'Halt'}</button>
                  <button type="button" disabled={busy} onClick={() => act(() => devSector.setSector(devToken, x.ticker, { enabled: !x.enabled }), x.enabled ? `${x.ticker} hidden.` : `${x.ticker} shown.`)} className="text-xs underline">{x.enabled ? 'Hide' : 'Show'}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* settings */}
      <div className="rounded-xl border p-4 space-y-3" style={card}>
        <p className="font-semibold" style={{ color: 'var(--dp-txt)' }}>Settings</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {SETTING_FIELDS.map(([k, label, hint]) => (
            <label key={k} className="block text-xs" style={{ color: 'var(--dp-muted)' }}>{label}
              <input value={form[k] ?? ''} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value.replace(/[^0-9.]/g, '') }))} inputMode="decimal"
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" style={field} />
              <span className="block mt-0.5 text-[11px] opacity-80">{hint}</span>
            </label>
          ))}
        </div>
        <button type="button" disabled={busy || !Object.keys(changed).length} onClick={() => act(() => devSector.setSettings(devToken, changed), 'Settings saved.')}
          className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-sky-600 hover:bg-sky-500 disabled:opacity-40">Save {Object.keys(changed).length ? `(${Object.keys(changed).length})` : ''}</button>
      </div>

      {/* which business categories feed which sector */}
      <div className="rounded-xl border p-4 space-y-3" style={card}>
        <p className="font-semibold" style={{ color: 'var(--dp-txt)' }}>Business category → sector</p>
        <div className="flex flex-wrap gap-1.5">
          {ov.industry_map.map((m) => (
            <span key={m.industry} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs" style={field}>
              {m.industry} → <b>{m.ticker}</b>
              <button type="button" aria-label={`Remove ${m.industry}`} disabled={busy} onClick={() => act(() => devSector.mapIndustry(devToken, m.industry, null), 'Removed.')} className="opacity-60 hover:opacity-100">×</button>
            </span>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <input value={mapIndustry} onChange={(e) => setMapIndustry(e.target.value)} placeholder="category key, e.g. pharmacy" className="flex-1 min-w-[10rem] rounded-lg border px-3 py-2 text-sm" style={field} />
          <select value={mapTicker} onChange={(e) => setMapTicker(e.target.value)} className="rounded-lg border px-3 py-2 text-sm" style={field}>
            <option value="">sector…</option>
            {ov.sectors.map((x) => <option key={x.ticker} value={x.ticker}>{x.ticker}</option>)}
          </select>
          <button type="button" disabled={busy || !mapIndustry.trim() || !mapTicker}
            onClick={() => act(async () => { const r = await devSector.mapIndustry(devToken, mapIndustry, mapTicker); setMapIndustry(''); return r; }, 'Mapped.')}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-sky-600 hover:bg-sky-500 disabled:opacity-40">Add</button>
        </div>
        <p className="text-xs" style={{ color: 'var(--dp-muted)' }}>A business whose category is not listed contributes nothing. Churches go to iSOCL by the same rule the tithe feature uses.</p>
      </div>

      {/* feed + books */}
      <div className="rounded-xl border p-4 space-y-2" style={card}>
        <p className="font-semibold" style={{ color: 'var(--dp-txt)' }}>Revenue feed and activity</p>
        <p className="text-sm" style={{ color: 'var(--dp-txt)' }}>
          {ov.outbox.businesses_accepted} business{ov.outbox.businesses_accepted === 1 ? '' : 'es'} have accepted the data terms · {ov.outbox.events_24h} sales counted in 24 h · {ov.outbox.unfolded} waiting to be counted<br />
          {ov.activity_24h.trades} trades in 24 h · volume {trim(ov.activity_24h.volume_icec, 6)} ICEC · fees {trim(ov.activity_24h.fees_icec, 6)} ICEC
        </p>
        <div className="flex items-center gap-3">
          <button type="button" disabled={busy} onClick={async () => { setBusy(true); try { const r = await devSector.reconcile(devToken); setRecon(r.data); } catch (e) { setError(e.message); } finally { setBusy(false); } }}
            className="px-4 py-2 rounded-lg text-sm font-semibold border" style={field}>Reconcile the books</button>
          {recon && <span className={`text-sm ${recon.ok ? 'text-emerald-400' : 'text-red-400'}`} role="status">{recon.ok ? 'Everything balances.' : `Problem found: ${JSON.stringify(recon)}`}</span>}
        </div>
      </div>
    </div>
  );
}

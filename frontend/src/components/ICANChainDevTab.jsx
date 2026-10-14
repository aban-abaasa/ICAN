import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, ShieldCheck, AlertTriangle } from 'lucide-react';
import { devChain } from '../services/chainService';
import { extractAddress } from '../utils/chainMath';

/**
 * On-chain tab of the ICAN dev panel: the bridge switch, where the contracts are, the limits, the queue, anomalies, the
 * supply cross-check, the books, and the exchange-rate feed's health. Talks to ican_chain_dev_*
 * (supabase/migrations/20261020110000_chain_bridge.sql, ..120000_chain_fx_oracle.sql) with the panel's dev token.
 *
 * The bridge ships OFF. Before turning it on (see CHAIN_TOKENS_DEPLOY.md, "Launch gates"): the contracts have been
 * independently audited, a lawyer has advised on issuing tokens and on the bridge, the operator key is in a secret store
 * with a small daily cap, and the guardian and owner are multisigs. An unknown or mismatched mint, or an on-chain supply
 * that differs from the ledger, halts the bridge by itself; it stays halted until a person resolves the anomaly here.
 */

const card = { background: 'var(--dp-card)', borderColor: 'var(--dp-card-bd)' };
const field = { background: 'var(--dp-inner)', borderColor: 'var(--dp-inner-bd)', color: 'var(--dp-txt)' };
const muted = { color: 'var(--dp-muted)' };
const txt = { color: 'var(--dp-txt)' };

const SETTING_FIELDS = [
  ['confirmations', 'Confirmations before an event is believed', 'Blocks the relayer waits. Higher is safer against reorganisations.'],
  ['min_withdrawal_icec', 'Smallest withdrawal (ICEC)', ''],
  ['max_withdrawal_icec', 'Largest withdrawal (ICEC)', 'Per withdrawal'],
  ['max_daily_withdrawal_icec', 'Largest per user per day (ICEC)', 'Keep it well under the contract\'s daily mint cap'],
  ['max_withdrawals_per_hour', 'Withdrawals per hour', 'Per user, cancelled ones included'],
  ['max_addresses_per_user', 'Wallet addresses per user', ''],
  ['fx_max_jump_pct', 'Exchange-rate jump limit (%)', 'A bigger jump is held back until three observations agree'],
  ['fx_stale_s', 'Exchange rate is stale after (seconds)', ''],
];
// The only two things the chain cannot tell us. Everything else about the contracts is detected: the chain id from the network the
// relayer is on, and the ICEC-S token, the reserve coin and its symbol from the vault.
const CONTRACT_FIELDS = [['icec_community_address', 'ICEC-C contract'], ['stable_vault_address', 'ICEC-S vault']];
const ago = (iso) => {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 90 ? `${s} s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
};

export default function ICANChainDevTab({ devToken }) {
  const [ov, setOv] = useState(null);
  const [fx, setFx] = useState(null);
  const [missing, setMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({});
  const [contracts, setContracts] = useState({});
  const [recon, setRecon] = useState(null);
  const [note, setNote] = useState('');

  const say = (m) => { setFlash(m); setTimeout(() => setFlash(''), 3500); };

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await devChain.overview(devToken);
      if (res.missing) { setMissing(true); return; }
      setOv(res.data);
      setForm((f) => (Object.keys(f).length ? f : Object.fromEntries(SETTING_FIELDS.map(([k]) => [k, String(res.data.settings[k] ?? '')]))));
      setContracts((c) => (Object.keys(c).length ? c : { ...Object.fromEntries(CONTRACT_FIELDS.map(([k]) => [k, String(res.data.settings[k] ?? '')])), chain_id: '' }));
      const f = await devChain.fxOverview(devToken).catch(() => null);
      if (f && !f.missing) setFx(f.data);
    } catch (e) { setError(e.message || 'Could not load.'); } finally { setLoading(false); }
  }, [devToken]);
  useEffect(() => { load(); }, [load]);

  const act = async (fn, okMsg) => {
    setBusy(true); setError('');
    try { const res = await fn(); if (res?.missing) setMissing(true); else { say(okMsg); await load(); } }
    catch (e) { setError(e.message || 'That did not work.'); } finally { setBusy(false); }
  };

  const changed = useMemo(() => {
    if (!ov) return {};
    const out = {};
    for (const [k] of SETTING_FIELDS) if (String(form[k] ?? '') !== String(ov.settings[k] ?? '') && form[k] !== '') out[k] = Number(form[k]);
    return out;
  }, [form, ov]);
  const changedContracts = useMemo(() => {
    if (!ov) return {};
    const out = {};
    for (const [k] of CONTRACT_FIELDS) {
      const raw = String(contracts[k] ?? '').trim();
      const v = extractAddress(raw) || raw;                 // pasted links, quotes, capitals and a missing 0x are all fine; anything else goes to the database to explain
      if (v && v !== String(ov.settings[k] ?? '')) out[k] = v;
    }
    const chain = String(contracts.chain_id ?? '').trim();
    if (chain && chain !== String(ov.settings.chain_id ?? '')) out.chain_id = chain;
    return out;
  }, [contracts, ov]);

  if (loading) return <p className="text-sm" style={muted}>Loading…</p>;
  if (missing) return <p className="text-sm" style={muted}>The on-chain bridge is not installed yet. Run the three chain SQL files (see CHAIN_TOKENS_DEPLOY.md).</p>;
  if (!ov) return <p className="text-sm text-red-400">{error || 'Nothing to show.'}</p>;

  const s = ov.settings;
  const enabled = !!s.bridge_enabled;
  const anomalies = ov.open_anomalies || [];
  const toggleBridge = () => {
    if (!enabled && !window.confirm('Turn the ICEC bridge ON?\n\nUsers will be able to lock ledger ICEC and receive ICEC-C on the chain. Before you do: have the contracts been independently audited, has a lawyer advised on the bridge and the tokens, is the operator key in a secret store with a small daily cap, and are the owner and guardian multisigs?')) return;
    act(() => devChain.setSettings(devToken, { bridge_enabled: !enabled }), enabled ? 'Bridge is OFF.' : 'Bridge is ON.');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold" style={txt}>On-chain tokens</h2>
        <button type="button" onClick={load} className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border" style={field}><RefreshCw className="w-3.5 h-3.5" />Refresh</button>
      </div>
      {error && <p className="text-sm text-red-400" role="alert">{error}</p>}
      {flash && <p className="text-sm text-emerald-400" role="status">{flash}</p>}

      {anomalies.length > 0 && (
        <div className="rounded-xl border border-red-500/50 bg-red-500/10 p-4 space-y-2" role="alert">
          <p className="font-semibold text-red-300 flex items-center gap-2"><AlertTriangle className="w-4 h-4" />{anomalies.length} open anomal{anomalies.length === 1 ? 'y' : 'ies'}. The bridge halts itself on these and stays halted until you resolve them.</p>
          {anomalies.map((a) => (
            <div key={a.id} className="text-xs" style={txt}>
              <b>#{a.id} {a.kind}</b> · {new Date(a.created_at).toLocaleString()}
              <pre className="mt-1 whitespace-pre-wrap break-all rounded p-2" style={field}>{JSON.stringify(a.details, null, 1)}</pre>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you found and what you did (10+ characters)" className="flex-1 min-w-[12rem] rounded-lg border px-3 py-2 text-sm" style={field} />
            <button type="button" disabled={busy || note.trim().length < 10} onClick={() => act(async () => { for (const a of anomalies) await devChain.resolveAnomaly(devToken, a.id, note.trim()); setNote(''); return {}; }, 'Anomalies closed. The bridge stays off until you turn it on.')} className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-sky-600 hover:bg-sky-500 disabled:opacity-40">Close all</button>
          </div>
          <p className="text-[11px]" style={muted}>A mint the database never asked for, or an on-chain supply that differs from the ledger, usually means the operator key was exposed. Rotate the operator on the contract (setOperator) and pause minting before you resume; an unknown mint cannot be undone, so the safe path is a new contract.</p>
        </div>
      )}

      <div className="rounded-xl border p-4 flex flex-wrap items-center justify-between gap-3" style={card}>
        <div>
          <p className="font-semibold" style={txt}>Bridge is {enabled ? 'ON' : 'OFF'}{s.is_testnet ? ' · test network' : ''}</p>
          <p className="text-xs" style={muted}>{enabled ? 'Users can move ICEC onto the chain. Turning it off stops new withdrawals; burn-backs are still credited.' : 'No new withdrawals. Burn-backs of ICEC-C already out are still credited.'}</p>
        </div>
        <button type="button" disabled={busy} onClick={toggleBridge} className={`px-4 py-2 rounded-lg text-sm font-bold text-white ${enabled ? 'bg-red-600 hover:bg-red-500' : 'bg-emerald-600 hover:bg-emerald-500'} disabled:opacity-50`}>{enabled ? 'Turn OFF' : 'Turn ON'}</button>
      </div>

      <div className="rounded-xl border p-4 space-y-3" style={card}>
        <p className="font-semibold" style={txt}>The queue</p>
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          {['pending', 'submitted', 'minted', 'cancelled'].map((k) => (
            <div key={k}><dt className="text-xs capitalize" style={muted}>{k}</dt><dd style={txt}>{ov.withdrawals?.[k]?.count ?? 0} · {ov.withdrawals?.[k]?.icec ?? 0} ICEC</dd></div>
          ))}
          <div><dt className="text-xs" style={muted}>Locked in the ledger</dt><dd style={txt}>{ov.locked_icec} ICEC</dd></div>
          <div><dt className="text-xs" style={muted}>Unclaimed burns</dt><dd className={ov.unclaimed_burns?.count ? 'text-amber-400' : ''} style={ov.unclaimed_burns?.count ? undefined : txt}>{ov.unclaimed_burns?.count ?? 0} · {ov.unclaimed_burns?.icec ?? 0} ICEC</dd></div>
          <div><dt className="text-xs" style={muted}>Oldest waiting</dt><dd style={txt}>{ov.oldest_pending_s == null ? '—' : `${Math.round(ov.oldest_pending_s / 60)} min`}</dd></div>
          <div><dt className="text-xs" style={muted}>Linked wallets</dt><dd style={txt}>{ov.linked_addresses}</dd></div>
        </dl>
        {(ov.sync || []).map((x) => <p key={x.name} className="text-xs" style={muted}>{x.name}: block {x.last_block}{x.updated_at ? ` · ${new Date(x.updated_at).toLocaleString()}` : ''}</p>)}
        {ov.last_supply_check && (
          <p className="text-xs flex items-center gap-1.5" style={muted}>
            {ov.last_supply_check.ok ? <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> : <AlertTriangle className="w-3.5 h-3.5 text-red-400" />}
            Last supply check at block {ov.last_supply_check.block_number}: chain {ov.last_supply_check.onchain_units} vs ledger {ov.last_supply_check.expected_units} (base units) · {ov.last_supply_check.ok ? 'matches' : 'DIFFERS'}
          </p>
        )}
      </div>

      <div className="rounded-xl border p-4 space-y-3" style={card}>
        <p className="font-semibold" style={txt}>Contracts</p>
        <p className="text-[11px]" style={muted}>Paste the two contract addresses (a link from the block explorer works too). Everything else is read from the chain.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {CONTRACT_FIELDS.map(([k, label]) => (
            <label key={k} className="block text-xs" style={muted}>{label}
              <input value={contracts[k] ?? ''} onChange={(e) => setContracts((c) => ({ ...c, [k]: e.target.value }))} placeholder="0x…" className="mt-1 w-full rounded-lg border px-3 py-2 text-sm font-mono" style={field} />
            </label>
          ))}
        </div>
        <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2" style={muted} data-testid="detected-contracts">
          <dt>Chain</dt><dd className="font-mono" style={txt}>{s.chain_id ? `${s.chain_id}${s.chain_name ? ` · ${s.chain_name}` : ''}` : 'detected on the relayer\'s first run'}</dd>
          <dt>ICEC-S token</dt><dd className="font-mono break-all" style={txt}>{s.stable_token_address || (s.stable_vault_address ? 'read from the vault on the next run' : '—')}</dd>
          <dt>Reserve coin</dt><dd className="font-mono break-all" style={txt}>{s.reserve_token_address ? `${s.reserve_token_symbol || ''} ${s.reserve_token_address}`.trim() : (s.stable_vault_address ? 'read from the vault on the next run' : '—')}</dd>
          <dt>Last checked against the chain</dt><dd style={txt}>{s.contracts_checked_at ? ago(s.contracts_checked_at) : '—'}</dd>
        </dl>
        {s.contracts_note && <p className="text-[11px]" style={muted}>{s.contracts_note}</p>}
        <details className="text-[11px]" style={muted}>
          <summary className="cursor-pointer">Set the chain id by hand (normally not needed)</summary>
          <label className="block mt-2">Chain id, for example 11155111
            <input value={contracts.chain_id ?? ''} onChange={(e) => setContracts((c) => ({ ...c, chain_id: e.target.value }))} placeholder={s.chain_id ? String(s.chain_id) : 'detected automatically'} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm font-mono" style={field} />
          </label>
        </details>
        <p className="text-[11px]" style={muted}>The chain and the ICEC-C contract cannot be changed once withdrawals exist: moving the bridge to another contract is a migration, not a setting. A new vault replaces the token and reserve at once.</p>
        <button type="button" disabled={busy || !Object.keys(changedContracts).length} onClick={() => act(() => devChain.setContracts(devToken, changedContracts), 'Contracts saved.')} className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-sky-600 hover:bg-sky-500 disabled:opacity-40">Save</button>
      </div>

      <div className="rounded-xl border p-4 space-y-3" style={card}>
        <p className="font-semibold" style={txt}>Limits and settings</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {SETTING_FIELDS.map(([k, label, hint]) => (
            <label key={k} className="block text-xs" style={muted}>{label}
              <input value={form[k] ?? ''} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value.replace(/[^0-9.]/g, '') }))} inputMode="decimal" className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" style={field} />
              {hint && <span className="block mt-0.5 text-[11px] opacity-80">{hint}</span>}
            </label>
          ))}
        </div>
        <button type="button" disabled={busy || !Object.keys(changed).length} onClick={() => act(() => devChain.setSettings(devToken, changed), 'Settings saved.')} className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-sky-600 hover:bg-sky-500 disabled:opacity-40">Save {Object.keys(changed).length ? `(${Object.keys(changed).length})` : ''}</button>
      </div>

      <div className="rounded-xl border p-4 space-y-2" style={card}>
        <p className="font-semibold" style={txt}>Exchange-rate feed (display only)</p>
        {(fx?.pairs || []).filter((p) => p.available).map((p) => (
          <p key={p.pair} className="text-xs" style={p.stale ? { color: '#fbbf24' } : muted}>{p.pair} {Number(p.rate).toLocaleString(undefined, { maximumFractionDigits: 4 })} · {Math.round(p.age_s)} s old{p.stale ? ' · STALE' : ''} · {p.source}</p>
        ))}
        {fx?.last_hour && <p className="text-[11px]" style={muted}>Last hour: {Object.entries(fx.last_hour).map(([k, n]) => `${n} ${k}`).join(', ') || 'nothing yet'}</p>}
        {!(fx?.pairs || []).length && <p className="text-xs" style={muted}>No observations yet. Schedule /api/fx-oracle (see CHAIN_TOKENS_DEPLOY.md).</p>}
      </div>

      <div className="rounded-xl border p-4 space-y-2" style={card}>
        <div className="flex items-center justify-between">
          <p className="font-semibold" style={txt}>Reconcile the books</p>
          <button type="button" disabled={busy} onClick={async () => { setBusy(true); try { const r = await devChain.reconcile(devToken); setRecon(r.data); } catch (e) { setError(e.message); } finally { setBusy(false); } }} className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-sky-600 hover:bg-sky-500 disabled:opacity-40">Run</button>
        </div>
        {recon && (
          <>
            <p className={`text-sm font-semibold ${recon.ok ? 'text-emerald-400' : 'text-red-400'}`}>{recon.ok ? 'The books balance.' : 'Something does not add up.'}</p>
            <pre className="whitespace-pre-wrap break-all rounded p-2 text-[11px]" style={field}>{JSON.stringify(recon, null, 1)}</pre>
          </>
        )}
        <p className="text-[11px]" style={muted}>Recomputed from the immutable ledgers: locked ICEC against every live withdrawal less every credited burn, one lock and at most one release per withdrawal, no address paid back more than was minted to it, no open anomaly, and the last supply check.</p>
      </div>
    </div>
  );
}

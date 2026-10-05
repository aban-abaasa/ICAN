import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Copy, KeyRound, Loader, ShieldCheck, Trash2 } from 'lucide-react';
import { getSupabaseClient } from '../lib/supabase/client';
import { EXPIRY_CHOICES, KEY_SCOPES, eraOwnerApi, keyStatus, validateKeyRequest } from '../services/eraOwnerKeys';

/**
 * "Developer API" tab of Business Administration. The owner mints keys for their own software (POS, website, ERP):
 * one business, only the scopes ticked, an expiry, optional spending caps, revocable at once. The key is shown once.
 * Everything is enforced by the database (supabase/migrations/20261006100000_era_api_business.sql).
 */
const field = 'mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white';
const fmtDate = (v) => (v ? new Date(v).toLocaleDateString() : 'never');

export default function BusinessApiKeysPanel({ profile }) {
  const api = useMemo(() => { const sb = getSupabaseClient(); return sb ? eraOwnerApi(sb) : null; }, []);
  const [keys, setKeys] = useState([]);
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fresh, setFresh] = useState(null);
  const [copied, setCopied] = useState(false);
  const [form, setForm] = useState({ label: '', scopes: ['inventory:read'], expiresDays: 90, test: false, maxAmount: '', dailyCap: '' });

  const load = useCallback(async () => {
    if (!api) { setError('Not connected.'); setLoading(false); return; }
    setLoading(true);
    try {
      const [k, a] = await Promise.all([api.listKeys(profile.id), api.activity(profile.id, 15)]);
      setKeys(k || []); setActivity(a || []); setError('');
    } catch (e) {
      setError(/not installed|does not exist|Could not find/i.test(e.message) ? 'The Era API has not been switched on for this project yet.' : e.message);
    }
    setLoading(false);
  }, [api, profile.id]);

  useEffect(() => { load(); }, [load]);

  const toggleScope = (id) => setForm((f) => ({ ...f, scopes: f.scopes.includes(id) ? f.scopes.filter((s) => s !== id) : [...f.scopes, id] }));
  const wantsPayments = form.scopes.includes('payments:request');

  const create = async (event) => {
    event.preventDefault();
    const v = validateKeyRequest({ businessId: profile.id, ...form });
    if (!v.ok) { setError(v.error); return; }
    setBusy(true); setError(''); setFresh(null);
    try {
      setFresh(await api.createKey(v.args));
      setForm((f) => ({ ...f, label: '' }));
      await load();
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const revoke = async (k) => {
    if (!window.confirm(`Revoke ${k.label || k.prefix}? Software using it stops working immediately.`)) return;
    try { await api.revokeKey(k.id); await load(); } catch (e) { setError(e.message); }
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(fresh.key); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* the key is selectable on screen */ }
  };

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-sm text-slate-300">
        <div className="mb-1 flex items-center gap-2 font-semibold text-white"><ShieldCheck size={16} className="text-emerald-400" /> Give your own software safe access</div>
        Keys are bound to <b>{profile.business_name}</b> only, can only do what you tick, expire, and can be revoked in one tap. They can
        <i> ask</i> a customer to pay or book, but can never move money: the customer approves in their own app.
        {' '}<a href="/developers/#business" target="_blank" rel="noopener noreferrer" className="text-amber-300 underline">API guide</a>
      </div>

      {error && <p className="rounded-lg border border-red-800/50 bg-red-900/20 p-2 text-sm text-red-300" role="alert">{error}</p>}

      {fresh && (
        <div className="rounded-xl border border-emerald-700/60 bg-emerald-900/20 p-3" role="status">
          <p className="text-sm font-semibold text-emerald-300">{fresh.test ? 'Test key created' : 'Key created'}. Copy it now: it is never shown again.</p>
          <code className="mt-2 block break-all rounded-lg bg-slate-950 p-2 text-xs text-white select-all">{fresh.key}</code>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-400">
            <button type="button" onClick={copy} className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 font-semibold text-white hover:bg-emerald-500">{copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy key'}</button>
            <span>Expires {fmtDate(fresh.expires_at)}</span>
            {fresh.max_amount_ugx != null && <span>Max per request UGX {Number(fresh.max_amount_ugx).toLocaleString()}</span>}
            <button type="button" onClick={() => setFresh(null)} className="underline">Hide</button>
          </div>
        </div>
      )}

      <form onSubmit={create} className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3">
        <p className="text-xs font-semibold text-slate-500">NEW KEY</p>
        <label className="block text-sm text-slate-300">Name it
          <input value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} maxLength={60} placeholder="e.g. Shop till sync" className={field} />
        </label>
        <fieldset className="space-y-1.5">
          <legend className="mb-1 text-sm text-slate-300">What may it do?</legend>
          {KEY_SCOPES.map((s) => (
            <label key={s.id} className="flex items-start gap-2 text-sm text-slate-300">
              <input type="checkbox" className="mt-1" checked={form.scopes.includes(s.id)} onChange={() => toggleScope(s.id)} />
              <span><span className="font-medium text-white">{s.label}</span> <code className="text-[11px] text-slate-500">{s.id}</code><span className="block text-xs text-slate-500">{s.help}</span></span>
            </label>
          ))}
        </fieldset>
        {wantsPayments && (
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm text-slate-300">Max per request (UGX)<input type="number" min="1" max="10000000" value={form.maxAmount} onChange={(e) => setForm((f) => ({ ...f, maxAmount: e.target.value }))} placeholder="1,000,000" className={field} /></label>
            <label className="text-sm text-slate-300">Max per day (UGX)<input type="number" min="1" max="50000000" value={form.dailyCap} onChange={(e) => setForm((f) => ({ ...f, dailyCap: e.target.value }))} placeholder="5,000,000" className={field} /></label>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm text-slate-300">Lasts
            <select value={form.expiresDays} onChange={(e) => setForm((f) => ({ ...f, expiresDays: Number(e.target.value) }))} className={field}>
              {EXPIRY_CHOICES.map((d) => <option key={d} value={d}>{d} days</option>)}
            </select>
          </label>
          <label className="mt-6 flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={form.test} onChange={(e) => setForm((f) => ({ ...f, test: e.target.checked }))} /> Test key (sample data, creates nothing real)</label>
        </div>
        <button disabled={busy || !api} className="flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-500 disabled:opacity-50">
          {busy ? <Loader size={15} className="animate-spin" /> : <KeyRound size={15} />} Create key
        </button>
      </form>

      <div className="space-y-2">
        <p className="text-xs font-semibold text-slate-500">YOUR KEYS</p>
        {loading ? <div className="flex items-center gap-2 text-sm text-slate-400"><Loader className="animate-spin" size={16} /> Loading…</div>
          : keys.length === 0 ? <p className="text-sm text-slate-500">No keys yet.</p>
          : keys.map((k) => {
            const st = keyStatus(k);
            return (
              <div key={k.id} className="flex items-center justify-between gap-3 rounded-lg bg-slate-900/60 px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm text-white">{k.label || 'Unnamed key'} <code className="text-[11px] text-slate-500">{k.prefix}…</code> {k.test && <span className="ml-1 rounded bg-slate-700 px-1.5 text-[10px] text-slate-200">test</span>}</div>
                  <div className="truncate text-xs text-slate-500">{(k.scopes || []).join(', ')} · {k.calls_24h} calls today · last used {fmtDate(k.last_used_at)} · expires {fmtDate(k.expires_at)}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`text-xs ${st === 'active' ? 'text-emerald-400' : 'text-slate-500'}`}>{st}</span>
                  {st === 'active' && <button type="button" onClick={() => revoke(k)} className="text-red-400 hover:text-red-300" title="Revoke now"><Trash2 size={16} /></button>}
                </div>
              </div>
            );
          })}
      </div>

      {activity.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-semibold text-slate-500">RECENT CALLS</p>
          {activity.map((a, i) => <div key={i} className="flex justify-between rounded bg-slate-900/40 px-3 py-1 text-xs text-slate-400"><span><code>{a.prefix}…</code> {a.endpoint}</span><span className={a.status >= 400 ? 'text-amber-400' : 'text-emerald-400'}>{a.status} · {a.ms} ms · {new Date(a.at).toLocaleTimeString()}</span></div>)}
        </div>
      )}
    </div>
  );
}

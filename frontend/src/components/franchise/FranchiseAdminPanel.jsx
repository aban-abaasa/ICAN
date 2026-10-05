import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, Lock, LogIn, RefreshCw, WifiOff } from 'lucide-react';
import { adminOverview, getPublicOverview, isHqAdmin, signInAsAdmin } from '../../services/franchiseService';
import { fmtIcan } from '../../utils/franchise';
import { Badge, Btn, Field, Input, Section, Tile, card, idleStyle, selectedStyle } from './adminUi';
import AdminRequests from './AdminRequests';
import AdminPartners from './AdminPartners';
import AdminSetup from './AdminSetup';
import { AdminHealth, AdminPayouts } from './AdminMoney';

const TABS = [
  { id: 'requests', label: 'Requests', badgeKey: 'enquiries_new', tone: 'amber' },
  { id: 'partners', label: 'Partners', badgeKey: 'companies_to_verify', tone: 'amber', badgeTitle: 'companies waiting for a registry check' },
  { id: 'setup', label: 'Countries & rates' },
  { id: 'payouts', label: 'Payouts' },
  { id: 'health', label: 'Health', badgeKey: 'open_errors', tone: 'red' },
];

/**
 * Franchise administration for the developer panel.
 *
 * The panel's own login is a token that ships in the public JavaScript, so it cannot guard
 * approvals, rates or payouts. This tab therefore needs a REAL signed-in account that is a
 * developer or on the franchise admin allowlist, and asks for one if the browser has none.
 */
export default function FranchiseAdminPanel() {
  const [gate, setGate] = useState('checking'); // checking | locked | missing | ok
  const [overview, setOverview] = useState(null);
  const [tab, setTab] = useState('requests');
  const [msg, setMsg] = useState(null);
  const timer = useRef(null);

  const flash = useCallback((text, isError = false) => {
    setMsg({ text, isError });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), isError ? 7000 : 2800);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);

  const loadOverview = useCallback(async () => {
    try { setOverview(await adminOverview()); } catch (e) { flash(e.message, true); }
  }, [flash]);

  const check = useCallback(async () => {
    setGate('checking');
    if (await isHqAdmin()) { setGate('ok'); loadOverview(); return; }
    // Not an admin: is the feature installed at all? (the public overview answers without an account)
    setGate((await getPublicOverview()) ? 'locked' : 'missing');
  }, [loadOverview]);
  useEffect(() => { check(); }, [check]);

  if (gate === 'checking') return <div className="rounded-2xl border p-8 text-center text-xs" style={{ ...card, color: 'var(--dp-muted)' }}>Checking access...</div>;
  if (gate === 'missing') return <Missing onRetry={check} />;
  if (gate === 'locked') return <Locked onSignedIn={check} />;

  const o = overview || {};
  const p = o.partners || {};
  const liab = o.liability || {};
  const owed = Number(liab.accrued_ican || 0) + Number(liab.statemented_ican || 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-black" style={{ color: 'var(--dp-txt)' }}>Franchise</p>
          <p className="text-[11px]" style={{ color: 'var(--dp-muted)' }}>Country masters, agencies and referral partners across IcanEra, SupermarketEra and BodaGoEra. Partners must be registered companies.</p>
        </div>
        <Btn onClick={loadOverview}><RefreshCw size={11} /> Refresh</Btn>
      </div>

      {msg && (
        <div role={msg.isError ? 'alert' : 'status'} className={`rounded-2xl border p-3 text-xs ${msg.isError ? 'border-red-500/20 bg-red-500/10 text-red-500' : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-500'}`}>{msg.text}</div>
      )}
      {o.settings && !o.settings.enabled && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs font-semibold text-amber-500">The franchise program is switched OFF: no new revenue is being shared. Turn it on under Countries & rates.</div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Live partners" value={String(p.active ?? 0)} sub={`${p.masters ?? 0} masters · ${p.agencies ?? 0} agencies · ${p.referrals ?? 0} referral`} />
        <Tile label="Customers served" value={String(o.assigned_accounts ?? 0)} sub={`${p.applied ?? 0} application(s) waiting`} color={p.applied > 0 ? '#f59e0b' : undefined} />
        <Tile label="Owed to partners" value={`${fmtIcan(owed)} ICAN`} sub={`${fmtIcan(liab.statemented_ican)} on statements`} color={owed > 0 ? '#f59e0b' : undefined} />
        <Tile label="Paid to partners" value={`${fmtIcan(liab.paid_ican)} ICAN`} color="#10b981" />
      </div>

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Franchise sections">
        {TABS.map((t) => {
          const n = t.badgeKey ? Number(o[t.badgeKey] || 0) : 0;
          return (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
              className="inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-bold transition"
              style={tab === t.id ? selectedStyle : idleStyle}>
              {t.label}
              {n > 0 && <span title={t.badgeTitle} className={`rounded-full px-1.5 py-px text-[10px] font-black ${t.tone === 'red' ? 'bg-red-500 text-white' : 'bg-amber-400 text-slate-900'}`}>{n}</span>}
            </button>
          );
        })}
      </div>

      {tab === 'requests' && <AdminRequests flash={flash} onChanged={loadOverview} goToPartners={() => setTab('partners')} />}
      {tab === 'partners' && <AdminPartners flash={flash} onChanged={loadOverview} />}
      {tab === 'setup' && <AdminSetup settings={o.settings} flash={flash} onChanged={loadOverview} />}
      {tab === 'payouts' && <AdminPayouts flash={flash} onChanged={loadOverview} />}
      {tab === 'health' && <AdminHealth overview={o} flash={flash} onChanged={loadOverview} />}
    </div>
  );
}

function Missing({ onRetry }) {
  return (
    <Section title="Franchise">
      <div className="flex items-start gap-3">
        <WifiOff size={20} style={{ color: 'var(--dp-muted)' }} />
        <div className="text-xs" style={{ color: 'var(--dp-sub)' }}>
          <p className="font-bold" style={{ color: 'var(--dp-txt)' }}>Franchises are not switched on for this server yet.</p>
          <p className="mt-1">Run <span className="font-mono">supabase/migrations/20261004100000_franchise_layer.sql</span> in the Supabase SQL editor, then refresh. (This can also appear if you are offline.)</p>
          <div className="mt-3"><Btn kind="primary" onClick={onRetry}><RefreshCw size={11} /> Check again</Btn></div>
        </div>
      </div>
    </Section>
  );
}

function Locked({ onSignedIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notAdmin, setNotAdmin] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(''); setNotAdmin(false);
    try {
      await signInAsAdmin(email, password);
      if (await isHqAdmin()) { setPassword(''); onSignedIn(); return; }
      setNotAdmin(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const sql = `INSERT INTO public.ican_franchise_admins (user_id, note)\nSELECT id, 'founder' FROM auth.users WHERE lower(email) = lower('${(email || 'YOUR-EMAIL').replace(/'/g, '')}');`;

  return (
    <Section title="Franchise administration">
      <div className="grid gap-5 md:grid-cols-2">
        <div className="text-xs" style={{ color: 'var(--dp-sub)' }}>
          <p className="flex items-center gap-2 text-sm font-black" style={{ color: 'var(--dp-txt)' }}><Lock size={16} /> Sign in with your own account</p>
          <p className="mt-2">This tab approves partners, edits the rate card and records payouts. The panel's PIN is built into the public app, so it cannot protect that. Use the account of a platform developer, or one added as a franchise admin.</p>
          <p className="mt-2">Signing in here signs this browser in as that account.</p>
        </div>
        <form onSubmit={submit} className="space-y-3" aria-label="Franchise admin sign in">
          <Field label="Email"><Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
          <Field label="Password"><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
          {error && <p role="alert" className="text-xs font-semibold text-red-500">{error}</p>}
          <Btn kind="primary" busy={busy} type="submit"><LogIn size={12} /> Sign in</Btn>
        </form>
      </div>

      {notAdmin && (
        <div role="alert" className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs" style={{ color: 'var(--dp-txt)' }}>
          <p className="font-bold text-amber-500">That account is signed in but is not a franchise admin <Badge tone="amber">no access</Badge></p>
          <p className="mt-1" style={{ color: 'var(--dp-sub)' }}>Add it once in the Supabase SQL editor (as the project owner), then sign in again:</p>
          <pre className="mt-2 overflow-x-auto rounded-lg border p-2 font-mono text-[11px]" style={{ background: 'var(--dp-inner)', borderColor: 'var(--dp-inner-bd)' }}>{sql}</pre>
          <div className="mt-2"><Btn onClick={() => { try { navigator.clipboard?.writeText(sql); } catch { /* clipboard blocked */ } }}><Copy size={11} /> Copy</Btn></div>
        </div>
      )}
    </Section>
  );
}

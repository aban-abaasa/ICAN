import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { RefreshCw, CheckCircle, XCircle, Save, Zap } from 'lucide-react';
import { getSupabaseClient } from '../lib/supabase/client';
import { formatICAN } from '../services/icanWalletService';

/**
 * Referrals tab of the ICAN dev panel: program settings + every referral
 * reward, with approve / reject. Talks to ican_referral_dev_* (see
 * backend/ADD_REFERRAL_SYSTEM.sql) with the panel's dev token, like every
 * other tab. This is the ONE place referrals are managed for BOTH ICANera and
 * BodaGoEra (same database, shared settings) — BodaGoEra has no management UI
 * of its own; use the app filter below to see one app at a time.
 */

const STATUS_LABEL = {
  awaiting_deposit: 'Awaiting deposit',
  pending_approval: 'Pending approval',
  paid: 'Paid',
  rejected: 'Rejected',
  failed: 'Payout failed',
};
const STATUS_CLS = {
  awaiting_deposit: 'border-slate-500/20 bg-slate-500/10 text-slate-400',
  pending_approval: 'border-amber-500/20 bg-amber-500/10 text-amber-500',
  paid: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-500',
  rejected: 'border-red-500/20 bg-red-500/10 text-red-500',
  failed: 'border-rose-500/20 bg-rose-500/10 text-rose-500',
};

// UGX figures come from the server: each referral stores what its deposit and reward were
// worth at the LIVE coin price when it happened, so nothing here multiplies by a fixed rate.
const ugx = (n) => `UGX ${Math.round(Number(n) || 0).toLocaleString()}`;
const card = { background: 'var(--dp-card)', borderColor: 'var(--dp-card-bd)' };
const field = { background: 'var(--dp-inner)', borderColor: 'var(--dp-inner-bd)', color: 'var(--dp-txt)' };

export default function ICANReferralsDevTab({ devToken }) {
  const supabase = getSupabaseClient();
  const [overview, setOverview] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [appFilter, setAppFilter] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');
  const [form, setForm] = useState({ enabled: true, auto_pay: true, reward_percent: '5', max_reward_ican: '', min_deposit_ican: '0' });
  const [seeded, setSeeded] = useState(false);
  const [saving, setSaving] = useState(false);

  const toForm = (s) => ({
    enabled: s.enabled,
    auto_pay: s.auto_pay,
    reward_percent: String(s.reward_percent),
    max_reward_ican: s.max_reward_ican == null ? '' : String(s.max_reward_ican),
    min_deposit_ican: String(s.min_deposit_ican),
  });

  const say = (msg) => { setFlash(msg); setTimeout(() => setFlash(''), 2500); };

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const [o, list] = await Promise.all([
      supabase.rpc('ican_referral_dev_overview', { p_dev_token: devToken }),
      supabase.rpc('ican_referral_dev_list', {
        p_status: statusFilter || null, p_source_app: appFilter || null, p_limit: 200, p_dev_token: devToken,
      }),
    ]);
    if (o.error || list.error) {
      const msg = (o.error || list.error).message;
      console.warn('[Dev] referrals:', msg);
      setError(/does not exist|schema cache/i.test(msg)
        ? 'Referral system not installed yet — run ICAN/backend/ADD_REFERRAL_SYSTEM.sql in the Supabase SQL editor, then refresh.'
        : msg);
    } else {
      setOverview(o.data);
      setRows(list.data || []);
      if (!seeded) { setForm(toForm(o.data.settings)); setSeeded(true); } // never clobber unsaved edits on refresh
    }
    setLoading(false);
  }, [supabase, devToken, statusFilter, appFilter, seeded]);

  useEffect(() => { load(); }, [load]);

  const dirty = useMemo(() => {
    if (!overview) return false;
    const s = overview.settings;
    return form.enabled !== s.enabled || form.auto_pay !== s.auto_pay
      || Number(form.reward_percent) !== Number(s.reward_percent)
      || (form.max_reward_ican === '' ? null : Number(form.max_reward_ican)) !== s.max_reward_ican
      || Number(form.min_deposit_ican) !== Number(s.min_deposit_ican);
  }, [form, overview]);

  const save = async () => {
    const pct = Number(form.reward_percent);
    if (!Number.isFinite(pct) || pct < 0 || pct > 25) return setError('Reward % must be between 0 and 25');
    const cap = form.max_reward_ican.trim() === '' ? null : Number(form.max_reward_ican);
    if (cap !== null && (!Number.isFinite(cap) || cap <= 0)) return setError('Cap must be greater than 0, or left empty for no cap');
    const min = Number(form.min_deposit_ican || 0);
    if (!Number.isFinite(min) || min < 0) return setError('Minimum deposit cannot be negative');

    setSaving(true);
    setError('');
    const { data, error: err } = await supabase.rpc('ican_referral_dev_update_settings', {
      p_patch: { enabled: form.enabled, auto_pay: form.auto_pay, reward_percent: pct, max_reward_ican: cap, min_deposit_ican: min },
      p_dev_token: devToken,
    });
    setSaving(false);
    if (err || !data?.success) return setError(err?.message || data?.error || 'Save failed');
    setOverview((prev) => (prev ? { ...prev, settings: data.settings } : prev));
    setForm(toForm(data.settings));
    say('Settings saved');
  };

  const decide = async (row, action) => {
    let note = null;
    if (action === 'reject') {
      const answer = window.prompt(`Reject ${row.referrer_name || 'this'} referral of ${row.referred_name || 'friend'}? Optional reason:`, '');
      if (answer === null) return;
      note = answer.trim() || null;
    } else if (!window.confirm(`Pay ${formatICAN(row.reward_ican || 0)} ICAN (${ugx(row.reward_ugx)}, priced at ${ugx(row.ican_price_ugx)} per ICAN) to ${row.referrer_name || row.referrer_email}?`)) {
      return;
    }
    setBusyId(row.id);
    setError('');
    const { data, error: err } = await supabase.rpc('ican_referral_dev_decide', {
      p_referral_id: row.id, p_action: action, p_note: note, p_dev_token: devToken,
    });
    setBusyId(null);
    if (err || !data?.success) return setError(err?.message || data?.error || `${action} failed`);
    say(action === 'approve' ? 'Reward paid' : 'Referral rejected');
    load();
  };

  const approveAll = async () => {
    const n = overview?.totals?.pending_approval;
    if (!n || !window.confirm(`Pay all ${n} pending rewards now?`)) return;
    const { data, error: err } = await supabase.rpc('ican_referral_dev_approve_all', { p_dev_token: devToken });
    if (err) return setError(err.message);
    say(`Paid ${data?.paid ?? 0}${data?.failed ? `, ${data.failed} failed` : ''}`);
    load();
  };

  // Worked example at TODAY's coin price, so the effect of rate/cap/min is obvious before saving.
  const example = useMemo(() => {
    const price = Number(overview?.live_price_ugx) || 5000;
    const depositUgx = 20000;
    const depositIcan = depositUgx / price;
    const pct = Number(form.reward_percent) || 0;
    const cap = form.max_reward_ican.trim() === '' ? null : Number(form.max_reward_ican);
    const min = Number(form.min_deposit_ican) || 0;
    let reward = (depositUgx * pct) / 100 / price;
    if (cap !== null && Number.isFinite(cap)) reward = Math.min(reward, cap);
    return { depositUgx, depositIcan, reward, rewardUgx: reward * price, belowMin: depositIcan < min };
  }, [form, overview]);

  const t = overview?.totals;

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-black" style={{ color: 'var(--dp-txt)' }}>Referral rewards</p>
          <p className="text-xs" style={{ color: 'var(--dp-sub)' }}>
            Referrers earn a % of their friend's first deposit, valued at the live coin price — ICANera and BodaGoEra share these settings.
          </p>
          {overview?.live_price_ugx > 0 && (
            <p className="mt-0.5 text-[11px] font-bold" style={{ color: '#84cc16' }}>
              Live coin value now: 1 ICAN = {ugx(overview.live_price_ugx)}
            </p>
          )}
        </div>
        <button onClick={load} className="flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold transition" style={{ ...card, color: 'var(--dp-sub)' }}>
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {error && <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-500">{error}</div>}
      {flash && <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-500">{flash}</div>}

      {t && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Tile label="Friends joined" value={String(t.joined)} sub={`${t.awaiting_deposit} awaiting deposit`} />
          <Tile label="Paid out" value={`${formatICAN(t.paid_ican)} ICAN`} sub={`${ugx(t.paid_ugx)} · ${t.paid} rewards`} color="#10b981" />
          <Tile label="Pending approval" value={`${formatICAN(t.pending_ican)} ICAN`} sub={`${ugx(t.pending_ugx)} · ${t.pending_approval} pending${t.failed ? ` · ${t.failed} failed` : ''}`} color={t.pending_approval + t.failed > 0 ? '#f59e0b' : undefined} />
          <Tile label="Friends' deposits" value={`${formatICAN(t.deposits_ican)} ICAN`} sub={ugx(t.deposits_ugx)} />
          <Tile label="Cost vs deposits" value={t.deposits_ugx > 0 ? `${((t.paid_ugx / t.deposits_ugx) * 100).toFixed(1)}%` : '—'} sub="paid rewards ÷ referred deposits (UGX value)" />
        </div>
      )}

      {overview && (
        <div className="rounded-2xl border p-5" style={card}>
          <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: 'var(--dp-muted)' }}>Program settings</p>
          <div className="grid gap-x-8 gap-y-4 md:grid-cols-2">
            <Toggle label="Program enabled" hint="Off = codes can't be redeemed and no new rewards accrue. Existing referrals keep waiting."
              checked={form.enabled} onChange={(v) => setForm((f) => ({ ...f, enabled: v }))} />
            <Toggle label="Auto-pay rewards" hint="On = paid the instant the friend's first deposit lands. Off = each reward waits here for your approval."
              checked={form.auto_pay} onChange={(v) => setForm((f) => ({ ...f, auto_pay: v }))} />
            <Field label="Reward % of first deposit" hint="0–25. Paid on top of the deposit — never deducted from the friend.">
              <input type="number" step="0.5" min="0" max="25" value={form.reward_percent}
                onChange={(e) => setForm((f) => ({ ...f, reward_percent: e.target.value }))}
                className="w-full rounded-xl border px-3 py-2 text-sm outline-none" style={field} />
            </Field>
            <Field label="Max reward per friend (ICAN)" hint="Empty = no cap. Protects you from one huge first deposit.">
              <input type="number" step="any" min="0" placeholder="No cap" value={form.max_reward_ican}
                onChange={(e) => setForm((f) => ({ ...f, max_reward_ican: e.target.value }))}
                className="w-full rounded-xl border px-3 py-2 text-sm outline-none" style={field} />
            </Field>
            <Field label="Minimum qualifying deposit (ICAN)" hint="Smaller deposits don't count as the 'first deposit'. 0 = any deposit counts.">
              <input type="number" step="any" min="0" value={form.min_deposit_ican}
                onChange={(e) => setForm((f) => ({ ...f, min_deposit_ican: e.target.value }))}
                className="w-full rounded-xl border px-3 py-2 text-sm outline-none" style={field} />
            </Field>
            <div className="self-start rounded-xl border p-3 text-xs" style={{ background: 'var(--dp-inner)', borderColor: 'var(--dp-inner-bd)', color: 'var(--dp-sub)' }}>
              <p className="mb-1 flex items-center gap-1 font-bold" style={{ color: 'var(--dp-txt)' }}><Zap size={12} className="text-amber-500" /> Example</p>
              A friend's first deposit of <b>{ugx(example.depositUgx)}</b> ({formatICAN(example.depositIcan)} ICAN at today's price){' '}
              {example.belowMin
                ? <>is <b>below the minimum</b> — no reward yet.</>
                : <>pays the referrer <b>{formatICAN(example.reward)} ICAN</b> ({ugx(example.rewardUgx)}).</>}
            </div>
          </div>
          <div className="mt-5 flex items-center justify-between">
            <p className="text-[10px]" style={{ color: 'var(--dp-muted)' }}>
              {overview.settings.updated_by ? `Last changed by ${overview.settings.updated_by}, ${new Date(overview.settings.updated_at).toLocaleString()}` : ''}
            </p>
            <button onClick={save} disabled={!dirty || saving}
              className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-black text-white transition disabled:opacity-30"
              style={{ background: 'linear-gradient(135deg,#06b6d4,#0284c7)' }}>
              <Save size={12} /> {saving ? 'Saving…' : 'Save settings'}
            </button>
          </div>
          <p className="mt-3 text-[10px]" style={{ color: 'var(--dp-muted)' }}>
            Counts ICAN coin purchases and completed wallet top-ups (UGX, or other currencies that have a rate in ican_currency_rates); agent cash-in is not counted.
            A reward is worth the set % of the deposit in UGX, turned into coins at the LIVE coin price at the moment of the deposit — that price is stored on each row, so a reward waiting for approval keeps the coins it was worth when earned.
            Rewards are credited straight to the referrer's ICAN wallet with no tithe and are new ICAN issued by the platform (like cashback) — "Paid out" above is their total cost.
            Changes apply to deposits made from now on; rewards already computed keep the rate and price they were computed at.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-xl border px-3 py-2 text-xs outline-none" style={field}>
          <option value="">All statuses</option>
          {Object.keys(STATUS_LABEL).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <select value={appFilter} onChange={(e) => setAppFilter(e.target.value)} className="rounded-xl border px-3 py-2 text-xs outline-none" style={field}>
          <option value="">Both apps</option>
          <option value="ican">ICANera</option>
          <option value="mybodaguy">BodaGoEra</option>
        </select>
        {!!t?.pending_approval && (
          <button onClick={approveAll} className="ml-auto flex items-center gap-1.5 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-500 transition hover:opacity-90">
            <CheckCircle size={12} /> Approve all pending ({t.pending_approval})
          </button>
        )}
      </div>

      {rows.length === 0 && (
        <div className="rounded-2xl border p-8 text-center text-xs" style={{ ...card, color: 'var(--dp-muted)' }}>
          {loading ? 'Loading…' : 'No referrals yet'}
        </div>
      )}

      {rows.map((r) => (
        <div key={r.id} className="rounded-2xl border p-4" style={card}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <p className="text-xs" style={{ color: 'var(--dp-sub)' }}>
                <b style={{ color: 'var(--dp-txt)' }}>{r.referrer_name}</b> <span style={{ color: 'var(--dp-muted)' }}>({r.referrer_email} · {r.referral_code})</span>
                {' '}referred{' '}
                <b style={{ color: 'var(--dp-txt)' }}>{r.referred_name}</b> <span style={{ color: 'var(--dp-muted)' }}>({r.referred_email})</span>
              </p>
              <p className="text-[10px]" style={{ color: 'var(--dp-muted)' }}>
                {r.source_app === 'ican' ? 'ICANera' : 'BodaGoEra'} · joined {new Date(r.created_at).toLocaleDateString()}
                {r.deposit_ican != null && <> · first deposit {r.deposit_ugx != null ? `${ugx(r.deposit_ugx)} = ` : ''}{formatICAN(r.deposit_ican)} ICAN{r.ican_price_ugx != null && <> @ {ugx(r.ican_price_ugx)}</>}</>}
                {r.decided_by && <> · {r.decided_by}</>}
              </p>
              {r.decision_note && <p className="text-[10px]" style={{ color: 'var(--dp-muted)' }}>{r.decision_note}</p>}
            </div>
            <div className="flex flex-shrink-0 flex-col items-end gap-1.5">
              <span className={`rounded-lg border px-2 py-0.5 text-[10px] font-bold ${STATUS_CLS[r.status]}`}>{STATUS_LABEL[r.status]}</span>
              {r.reward_ican != null && (
                <p className="text-sm font-black" style={{ color: 'var(--dp-txt)' }}>
                  {formatICAN(r.reward_ican)} ICAN <span className="text-[10px] font-normal" style={{ color: 'var(--dp-muted)' }}>{r.reward_percent}% · {ugx(r.reward_ugx)}</span>
                </p>
              )}
              <div className="flex gap-1.5">
                {(r.status === 'pending_approval' || r.status === 'failed') && (
                  <button disabled={busyId === r.id} onClick={() => decide(r, 'approve')}
                    className="flex items-center gap-1 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold text-emerald-500 disabled:opacity-40">
                    <CheckCircle size={10} /> {r.status === 'failed' ? 'Retry' : 'Approve'}
                  </button>
                )}
                {['awaiting_deposit', 'pending_approval', 'failed'].includes(r.status) && (
                  <button disabled={busyId === r.id} onClick={() => decide(r, 'reject')}
                    className="flex items-center gap-1 rounded-lg border border-red-500/20 bg-red-500/10 px-2.5 py-1 text-[10px] font-bold text-red-500 disabled:opacity-40">
                    <XCircle size={10} /> Reject
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

function Tile({ label, value, sub, color }) {
  return (
    <div className="rounded-2xl border p-3" style={card}>
      <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--dp-muted)' }}>{label}</p>
      <p className="mt-1 text-lg font-black" style={{ color: color || 'var(--dp-txt)' }}>{value}</p>
      {sub && <p className="text-[10px]" style={{ color: 'var(--dp-sub)' }}>{sub}</p>}
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold" style={{ color: 'var(--dp-txt)' }}>{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[10px]" style={{ color: 'var(--dp-muted)' }}>{hint}</span>}
    </label>
  );
}

function Toggle({ label, hint, checked, onChange }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-xs font-bold" style={{ color: 'var(--dp-txt)' }}>{label}</p>
        {hint && <p className="mt-0.5 text-[10px]" style={{ color: 'var(--dp-muted)' }}>{hint}</p>}
      </div>
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className="relative h-6 w-11 flex-shrink-0 rounded-full transition-colors"
        style={{ background: checked ? '#10b981' : 'var(--dp-inner-bd)' }}>
        <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform" style={{ transform: checked ? 'translateX(20px)' : 'none' }} />
      </button>
    </div>
  );
}

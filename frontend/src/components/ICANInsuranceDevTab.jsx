import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, CheckCircle, XCircle, Save, PauseCircle, RotateCcw } from 'lucide-react';
import { insuranceService, isNotInstalled } from '../services/insuranceService';
import { formatIcan, fmtDate, coverTypeLabel } from '../utils/insuranceCatalog';
import { APPLICATION_STATUS } from '../utils/insurerApplication';

/**
 * Insurance tab of the ICAN dev panel: verify the licence of every insurance company, see the
 * programme's numbers, and set the commission, points rate and grace days. This is the ONE place
 * insurance is managed for both IcanEra and BodaGoEra (same database, same settings). The
 * commission is added silently on top of each insurer's premium and credited to the platform
 * business (see ADD_INSURANCE_PLATFORM.sql); the insurer always takes home exactly what it set.
 * It also holds the queue of applications from the landing site (20261010100000_insurer_applications.sql):
 * support approves or rejects each one, and an approved company is verified the moment it registers.
 */

const STATUS = {
  pending: { label: 'Awaiting verification', cls: 'border-amber-500/20 bg-amber-500/10 text-amber-500' },
  verified: { label: 'Verified', cls: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-500' },
  suspended: { label: 'Suspended', cls: 'border-red-500/20 bg-red-500/10 text-red-500' },
  rejected: { label: 'Not approved', cls: 'border-slate-500/20 bg-slate-500/10 text-slate-400' },
};

const card = { background: 'var(--dp-card)', borderColor: 'var(--dp-card-bd)' };
const field = { background: 'var(--dp-inner)', borderColor: 'var(--dp-inner-bd)', color: 'var(--dp-txt)' };

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

const toForm = (s) => ({
  enabled: s.enabled,
  platform_fee_pct: String(s.platform_fee_pct),
  points_per_ican: String(s.points_per_ican),
  grace_days: String(s.grace_days),
  group_min_members: String(s.group_min_members),
  max_data_discount_pct: String(s.max_data_discount_pct),
});

export default function ICANInsuranceDevTab({ devToken }) {
  const [overview, setOverview] = useState(null);
  const [insurers, setInsurers] = useState([]);
  const [apps, setApps] = useState([]);
  const [appsMissing, setAppsMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  const say = (msg) => { setFlash(msg); setTimeout(() => setFlash(''), 2500); };

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [o, list] = await Promise.all([
        insuranceService.devOverview(devToken),
        insuranceService.devListInsurers(statusFilter, devToken),
      ]);
      setOverview(o);
      setInsurers(list || []);
      // The applications queue ships in its own migration: an older database keeps the rest of the tab working.
      try {
        setApps(await insuranceService.devListApplications(null, devToken) || []);
        setAppsMissing(false);
      } catch (e) {
        setApps([]);
        setAppsMissing(isNotInstalled(e));
      }
      setForm((cur) => cur || toForm(o.settings)); // never clobber unsaved edits on refresh
    } catch (e) {
      setError(isNotInstalled(e)
        ? 'Insurance is not installed yet. Run ICAN/backend/ADD_INSURANCE_PLATFORM.sql in the Supabase SQL editor, then refresh.'
        : e.message);
    }
    setLoading(false);
  }, [devToken, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const dirty = useMemo(() => {
    if (!overview || !form) return false;
    const s = overview.settings;
    return form.enabled !== s.enabled
      || Number(form.platform_fee_pct) !== Number(s.platform_fee_pct)
      || Number(form.points_per_ican) !== Number(s.points_per_ican)
      || Number(form.grace_days) !== Number(s.grace_days)
      || Number(form.group_min_members) !== Number(s.group_min_members)
      || Number(form.max_data_discount_pct) !== Number(s.max_data_discount_pct);
  }, [form, overview]);

  const save = async () => {
    const fee = Number(form.platform_fee_pct);
    if (!Number.isFinite(fee) || fee < 0 || fee > 25) return setError('Commission must be between 0 and 25 percent');
    const ppi = Number(form.points_per_ican);
    if (!Number.isFinite(ppi) || ppi <= 0) return setError('Points per ICAN must be more than 0');
    setSaving(true);
    setError('');
    const res = await insuranceService.devUpdateSettings({
      enabled: form.enabled, platform_fee_pct: fee, points_per_ican: ppi,
      grace_days: Number(form.grace_days), group_min_members: Number(form.group_min_members),
      max_data_discount_pct: Number(form.max_data_discount_pct),
    }, devToken);
    setSaving(false);
    if (!res.success) return setError(res.error);
    setOverview((prev) => (prev ? { ...prev, settings: res.settings } : prev));
    setForm(toForm(res.settings));
    say('Settings saved');
  };

  const review = async (insurer, decision) => {
    let note = null;
    if (decision === 'suspend' || decision === 'reject') {
      const answer = window.prompt(`${decision === 'suspend' ? 'Suspend' : 'Reject'} ${insurer.display_name}? Give a reason (the insurer will see it):`, '');
      if (answer === null) return;
      note = answer.trim();
      if (!note) return setError('A reason is required');
    } else if (decision === 'verify' && !window.confirm(`Confirm you have checked licence ${insurer.licence_number} (${insurer.regulator}) for ${insurer.display_name}?`)) {
      return;
    }
    setBusyId(insurer.insurer_id);
    setError('');
    const res = await insuranceService.devReviewInsurer(insurer.insurer_id, decision, note, devToken);
    setBusyId(null);
    if (!res.success) return setError(res.error);
    say({ verify: 'Insurer verified', reinstate: 'Insurer reinstated', suspend: 'Insurer suspended', reject: 'Application rejected' }[decision]);
    load();
  };

  const toggleListing = async (insurer) => {
    const hiding = !insurer.hidden_by_support;
    let note = null;
    if (hiding) {
      const answer = window.prompt(`Hide ${insurer.display_name} from the public directory? Give a reason (the insurer will see it):`, '');
      if (answer === null) return;
      note = answer.trim();
      if (!note) return setError('A reason is required');
    } else if (!window.confirm(`Show ${insurer.display_name} in the public directory again?`)) {
      return;
    }
    setBusyId(insurer.insurer_id);
    setError('');
    const res = await insuranceService.devSetListing(insurer.insurer_id, hiding, note, devToken);
    setBusyId(null);
    if (!res.success) return setError(res.error);
    say(hiding ? 'Hidden from the directory' : 'Shown in the directory again');
    load();
  };

  const reviewApp = async (app, decision) => {
    let note = null;
    if (decision === 'reject') {
      const answer = window.prompt(`Reject ${app.company_name}? Give a reason (the applicant will see it):`, '');
      if (answer === null) return;
      note = answer.trim();
      if (!note) return setError('A reason is required');
    } else if (!window.confirm(`Confirm you have checked licence ${app.licence_number} (${app.regulator}, ${app.country_code}) for ${app.company_name}?`)) {
      return;
    }
    setBusyId(app.id);
    setError('');
    const res = await insuranceService.devReviewApplication(app.id, decision, note, devToken);
    setBusyId(null);
    if (!res.success) return setError(res.error);
    say(decision === 'approve' ? 'Application approved. They are verified when they register.' : 'Application rejected');
    load();
  };

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const o = overview;
  const queue = apps.filter((a) => a.status !== 'onboarded');

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-black" style={{ color: 'var(--dp-txt)' }}>Insurance</p>
          <p className="text-xs" style={{ color: 'var(--dp-sub)' }}>
            Verify insurance companies, then they sell to people, riders and businesses in IcanEra and BodaGoEra. Customers see one price; the commission is added silently on top.
          </p>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold transition" style={{ ...card, color: 'var(--dp-sub)' }}>
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {error && <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-500">{error}</div>}
      {flash && <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-500">{flash}</div>}

      {o && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile label="Insurers" value={`${o.insurers.verified} verified`} sub={`${o.insurers.pending} awaiting · ${o.insurers.suspended} suspended`} color={o.insurers.pending > 0 ? '#f59e0b' : undefined} />
          <Tile label="Plans on sale" value={String(o.plans_live)} sub={`${o.policies_active} active policies · ${o.policies_total} ever`} />
          <Tile label="Premiums, 30 days" value={`${formatIcan(o.premiums_30d_ican)} ICAN`} sub={`${formatIcan(o.paid_with_points_30d)} points paid`} color="#10b981" />
          <Tile label="Commission earned" value={`${formatIcan(o.commission_total_ican)} ICAN`} sub={`${formatIcan(o.commission_30d_ican)} in 30 days`} color="#06b6d4" />
          <Tile label="Claims open" value={String(o.claims_open)} sub={`${formatIcan(o.claims_paid_ican)} ICAN paid out`} color={o.claims_open > 0 ? '#f59e0b' : undefined} />
        </div>
      )}

      {o && form && (
        <div className="rounded-2xl border p-5" style={card}>
          <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: 'var(--dp-muted)' }}>Programme settings</p>
          <div className="grid gap-x-8 gap-y-4 md:grid-cols-2">
            <Toggle label="Insurance enabled" hint="Off = no new cover and no renewals anywhere. Existing policies keep their dates."
              checked={form.enabled} onChange={(v) => set({ enabled: v })} />
            <Field label="Commission % on top of each premium" hint="0–25. Added silently to the customer's price and credited to the platform business. The insurer always takes home exactly what it set.">
              <input type="number" step="0.5" min="0" max="25" value={form.platform_fee_pct} onChange={(e) => set({ platform_fee_pct: e.target.value })}
                className="w-full rounded-xl border px-3 py-2 text-sm outline-none" style={field} />
            </Field>
            <Field label="Reward points per 1 ICAN" hint="How many points pay 1 ICAN of cover. Keep it equal to the rewards programme's redeem rate (100).">
              <input type="number" step="any" min="0" value={form.points_per_ican} onChange={(e) => set({ points_per_ican: e.target.value })}
                className="w-full rounded-xl border px-3 py-2 text-sm outline-none" style={field} />
            </Field>
            <Field label="Grace days after cover ends" hint="0–30. During these days cover shows 'Renew now' on the card.">
              <input type="number" step="1" min="0" max="30" value={form.grace_days} onChange={(e) => set({ grace_days: e.target.value })}
                className="w-full rounded-xl border px-3 py-2 text-sm outline-none" style={field} />
            </Field>
            <Field label="Group discount starts at (drivers)" hint="A company insuring this many people or more gets the plan's group discount.">
              <input type="number" step="1" min="2" value={form.group_min_members} onChange={(e) => set({ group_min_members: e.target.value })}
                className="w-full rounded-xl border px-3 py-2 text-sm outline-none" style={field} />
            </Field>
            <Field label="Highest data-sharing discount an insurer may offer (%)" hint="0–50. Caps what a plan can give people who share their record.">
              <input type="number" step="1" min="0" max="50" value={form.max_data_discount_pct} onChange={(e) => set({ max_data_discount_pct: e.target.value })}
                className="w-full rounded-xl border px-3 py-2 text-sm outline-none" style={field} />
            </Field>
          </div>
          <div className="mt-5 flex items-center justify-end">
            <button onClick={save} disabled={!dirty || saving}
              className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-black text-white transition disabled:opacity-30"
              style={{ background: 'linear-gradient(135deg,#14b8a6,#0f766e)' }}>
              <Save size={12} /> {saving ? 'Saving…' : 'Save settings'}
            </button>
          </div>
          <p className="mt-3 text-[10px]" style={{ color: 'var(--dp-muted)' }}>
            Points-paid premiums credit the insurer the same ICAN as a wallet payment, at the points rate above (the rate the rewards programme already redeems at).
            Prices and the cover limit are in ICAN, so they keep their value; customers see them in their own currency at the live ICAN price.
            Changes apply to payments from now on.
          </p>
        </div>
      )}

      {appsMissing && (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-500">
          Insurer applications are not installed yet. Run supabase/migrations/20261010100000_insurer_applications.sql and then 20261010200000_insurer_applications_public.sql, then refresh.
        </div>
      )}

      {queue.length > 0 && (
        <div className="space-y-3">
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--dp-muted)' }}>
            Applications from the landing site · {apps.filter((a) => a.status === 'new').length} waiting
          </p>
          {queue.map((a) => (
            <div key={a.id} className="rounded-2xl border p-4" style={card}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-black" style={{ color: 'var(--dp-txt)' }}>{a.company_name}</p>
                  <p className="text-xs" style={{ color: 'var(--dp-sub)' }}>
                    {a.contact_name} · {a.email}{a.phone ? ` · ${a.phone}` : ''} · {a.country_code}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--dp-sub)' }}>
                    Licence <b style={{ color: 'var(--dp-txt)' }}>{a.licence_number}</b> ({a.regulator}) · expires{' '}
                    <b style={{ color: a.licence_expired ? '#ef4444' : 'var(--dp-txt)' }}>{fmtDate(a.licence_expiry)}{a.licence_expired ? ' (expired)' : ''}</b>
                  </p>
                  <p className="text-[11px]" style={{ color: a.has_account ? '#10b981' : '#f59e0b' }}>
                    {a.has_account ? 'Has an IcanEra account with this email.' : 'No IcanEra account with this email yet. They need one to be set up after approval.'}
                  </p>
                  <p className="text-[11px]" style={{ color: 'var(--dp-muted)' }}>Covers: {(a.cover_types || []).map(coverTypeLabel).join(', ')}</p>
                  {a.description && <p className="text-[11px]" style={{ color: 'var(--dp-muted)' }}>{a.description}</p>}
                  {a.licence_clash && <p className="text-[11px] font-bold text-red-500">This licence number is already used by another application or insurer. Check it carefully before approving.</p>}
                  {a.review_note && <p className="text-[11px] italic" style={{ color: 'var(--dp-muted)' }}>Note: {a.review_note}</p>}
                  <p className="text-[10px]" style={{ color: 'var(--dp-muted)' }}>{a.reference} · sent {fmtDate(a.created_at)}</p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className="rounded-full border px-2.5 py-0.5 text-[10px] font-bold" style={{ borderColor: 'var(--dp-inner-bd)', color: 'var(--dp-sub)' }}>{(APPLICATION_STATUS[a.status] || APPLICATION_STATUS.new).label}</span>
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {(a.status === 'new' || a.status === 'rejected') && (
                      <button disabled={busyId === a.id || a.licence_expired} onClick={() => reviewApp(a, 'approve')}
                        className="flex items-center gap-1 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold text-emerald-500 disabled:opacity-40">
                        <CheckCircle size={10} /> Approve
                      </button>
                    )}
                    {(a.status === 'new' || a.status === 'approved') && (
                      <button disabled={busyId === a.id} onClick={() => reviewApp(a, 'reject')}
                        className="flex items-center gap-1 rounded-lg border border-red-500/20 bg-red-500/10 px-2.5 py-1 text-[10px] font-bold text-red-500 disabled:opacity-40">
                        <XCircle size={10} /> Reject
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-xl border px-3 py-2 text-xs outline-none" style={field}>
          <option value="">All insurers</option>
          {Object.keys(STATUS).map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
        </select>
      </div>

      {insurers.length === 0 && (
        <div className="rounded-2xl border p-8 text-center text-xs" style={{ ...card, color: 'var(--dp-muted)' }}>
          {loading ? 'Loading…' : 'No insurance companies yet. They apply from the landing page or under Insurance > Sell cover.'}
        </div>
      )}

      {insurers.map((i) => (
        <div key={i.insurer_id} className="rounded-2xl border p-4" style={card}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-black" style={{ color: 'var(--dp-txt)' }}>{i.display_name}</p>
              <p className="text-xs" style={{ color: 'var(--dp-sub)' }}>
                {i.business_name} · {i.owner_email || 'no owner email'} · {i.country_code}
              </p>
              <p className="text-xs" style={{ color: 'var(--dp-sub)' }}>
                Licence <b style={{ color: 'var(--dp-txt)' }}>{i.licence_number}</b> ({i.regulator}) · expires{' '}
                <b style={{ color: i.licence_expired ? '#ef4444' : 'var(--dp-txt)' }}>{fmtDate(i.licence_expiry)}{i.licence_expired ? ' (expired)' : ''}</b>
              </p>
              {(i.contact_email || i.contact_phone) && <p className="text-[11px]" style={{ color: 'var(--dp-muted)' }}>{[i.contact_email, i.contact_phone].filter(Boolean).join(' · ')}</p>}
              {i.description && <p className="text-[11px]" style={{ color: 'var(--dp-muted)' }}>{i.description}</p>}
              {i.review_note && <p className="text-[11px] italic" style={{ color: 'var(--dp-muted)' }}>Note: {i.review_note}</p>}
              {(i.tagline || i.website) && <p className="text-[11px]" style={{ color: 'var(--dp-muted)' }}>{[i.tagline, i.website].filter(Boolean).join(' · ')}</p>}
              {i.hidden_by_support && <p className="text-[11px] font-bold text-red-500">Hidden from the directory{i.hidden_note ? `: ${i.hidden_note}` : ''}</p>}
              {!i.hidden_by_support && i.listed === false && <p className="text-[11px]" style={{ color: 'var(--dp-muted)' }}>The insurer has switched its public listing off.</p>}
              <p className="text-[10px]" style={{ color: 'var(--dp-muted)' }}>
                {i.plans} plan{i.plans === 1 ? '' : 's'} on sale · {i.policies} active {i.policies === 1 ? 'policy' : 'policies'} · {i.claims_open} open claim{i.claims_open === 1 ? '' : 's'} · registered {fmtDate(i.created_at)}
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${STATUS[i.status].cls}`}>{STATUS[i.status].label}</span>
              <div className="flex flex-wrap justify-end gap-1.5">
                {(i.status === 'pending' || i.status === 'rejected') && (
                  <button disabled={busyId === i.insurer_id || i.licence_expired} onClick={() => review(i, 'verify')}
                    className="flex items-center gap-1 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold text-emerald-500 disabled:opacity-40">
                    <CheckCircle size={10} /> Verify
                  </button>
                )}
                {i.status === 'suspended' && (
                  <button disabled={busyId === i.insurer_id || i.licence_expired} onClick={() => review(i, 'reinstate')}
                    className="flex items-center gap-1 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold text-emerald-500 disabled:opacity-40">
                    <RotateCcw size={10} /> Reinstate
                  </button>
                )}
                {i.status === 'verified' && (
                  <button disabled={busyId === i.insurer_id} onClick={() => review(i, 'suspend')}
                    className="flex items-center gap-1 rounded-lg border border-red-500/20 bg-red-500/10 px-2.5 py-1 text-[10px] font-bold text-red-500 disabled:opacity-40">
                    <PauseCircle size={10} /> Suspend
                  </button>
                )}
                <button disabled={busyId === i.insurer_id} onClick={() => toggleListing(i)}
                  className="flex items-center gap-1 rounded-lg border border-slate-500/20 bg-slate-500/10 px-2.5 py-1 text-[10px] font-bold disabled:opacity-40" style={{ color: 'var(--dp-sub)' }}>
                  {i.hidden_by_support ? 'Show in directory' : 'Hide from directory'}
                </button>
                {i.status === 'pending' && (
                  <button disabled={busyId === i.insurer_id} onClick={() => review(i, 'reject')}
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

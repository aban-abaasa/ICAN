import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle, Loader2, ShieldCheck, WifiOff } from 'lucide-react';
import { getSupabaseClient } from '../../lib/supabase/client';
import { insuranceService, isNotInstalled } from '../../services/insuranceService';
import { COVER_TYPES, COVER_TYPE_IDS, fmtDate } from '../../utils/insuranceCatalog';
import { COUNTRIES } from '../../utils/franchise';
import { APPLICATION_STATUS, emptyApplication, regulatorFor, validateApplication } from '../../utils/insurerApplication';

/**
 * "Apply to sell cover": an insurance company applies with its licence and ICAN support approves it
 * (Dev panel > Insurance). The company needs an IcanEra account, so this only renders for a signed-in
 * user; the landing page and the Compliance > Insurance desk both mount it. Everything goes through
 * ins_submit_application / ins_my_applications (supabase/migrations/20261010100000_insurer_applications.sql).
 */
export default function InsurerApplication({ dark = false }) {
  const [apps, setApps] = useState(undefined); // undefined = loading, null = backend not installed
  const [form, setForm] = useState(emptyApplication);
  const [errors, setErrors] = useState({});
  const [state, setState] = useState('idle'); // idle | sending
  const [formError, setFormError] = useState('');
  const [sent, setSent] = useState(null);     // { reference, duplicate }
  const [accountEmail, setAccountEmail] = useState('');

  const load = useCallback(async () => {
    try {
      setApps(await insuranceService.myApplications());
    } catch (e) {
      setApps(isNotInstalled(e) ? null : []);
    }
  }, []);

  useEffect(() => {
    load();
    getSupabaseClient()?.auth.getUser().then(({ data }) => {
      const u = data?.user;
      if (!u) return;
      setAccountEmail(u.email || '');
      setForm((f) => ({ ...f, contact_name: f.contact_name || u.user_metadata?.full_name || u.user_metadata?.name || '' }));
    }).catch(() => {});
  }, [load]);

  const set = (k) => (e) => {
    const v = e?.target ? e.target.value : e;
    setForm((f) => ({ ...f, [k]: v }));
    if (errors[k]) setErrors((x) => ({ ...x, [k]: undefined }));
  };
  const pickCountry = (e) => {
    const code = e.target.value;
    setForm((f) => ({ ...f, country_code: code, regulator: !f.regulator || f.regulator === regulatorFor(f.country_code) ? regulatorFor(code) : f.regulator }));
    if (errors.country_code) setErrors((x) => ({ ...x, country_code: undefined }));
  };
  const toggleCover = (t) => {
    setForm((f) => ({ ...f, cover_types: f.cover_types.includes(t) ? f.cover_types.filter((x) => x !== t) : [...f.cover_types, t] }));
    if (errors.cover_types) setErrors((x) => ({ ...x, cover_types: undefined }));
  };

  const submit = async (e) => {
    e.preventDefault();
    setFormError('');
    const v = validateApplication(form);
    setErrors(v.errors);
    if (!v.ok) return;
    setState('sending');
    const res = await insuranceService.submitApplication(form);
    setState('idle');
    if (!res.success) return setFormError(res.error);
    setSent({ reference: res.reference || null, duplicate: Boolean(res.duplicate) });
    setForm(emptyApplication());
    load();
  };

  // ---- styling (matches the landing sections; also fine inside the app) ----
  const title = dark ? 'text-white' : 'text-slate-900';
  const body = dark ? 'text-slate-400' : 'text-slate-600';
  const input = `w-full rounded-lg border px-3 py-2.5 text-sm outline-none transition focus:ring-2 ${dark
    ? 'border-slate-600 bg-slate-950 text-white placeholder-slate-500 focus:ring-teal-300/50'
    : 'border-slate-300 bg-white text-slate-900 placeholder-slate-400 focus:ring-teal-600/40'}`;
  const label = `mb-1 block text-xs font-bold uppercase tracking-wider ${dark ? 'text-slate-300' : 'text-slate-600'}`;
  const tone = { warn: dark ? 'border-amber-400/40 bg-amber-900/20 text-amber-100' : 'border-amber-300 bg-amber-50 text-amber-900',
    ok: dark ? 'border-emerald-400/40 bg-emerald-900/20 text-emerald-100' : 'border-emerald-300 bg-emerald-50 text-emerald-900',
    bad: dark ? 'border-red-400/40 bg-red-900/20 text-red-100' : 'border-red-300 bg-red-50 text-red-900' };
  const err = (k) => (errors[k] ? <p id={`ia-${k}-err`} role="alert" className="mt-1 text-xs font-semibold text-red-500">{errors[k]}</p> : null);
  const a11y = (k) => ({ 'aria-invalid': Boolean(errors[k]), 'aria-describedby': errors[k] ? `ia-${k}-err` : undefined });

  if (apps === undefined) return <div className={`h-24 rounded-xl animate-pulse ${dark ? 'bg-slate-800' : 'bg-slate-100'}`} />;
  if (apps === null) {
    return (
      <div className="py-8 text-center">
        <WifiOff className={`mx-auto h-8 w-8 ${body}`} />
        <h3 className={`mt-3 text-lg font-black ${title}`}>Insurer applications open soon</h3>
        <p className={`mx-auto mt-1 max-w-sm text-sm ${body}`}>Insurance is not switched on for this server yet. Please check back shortly.</p>
      </div>
    );
  }

  const open = apps.some((a) => a.status === 'new' || a.status === 'approved');

  return (
    <div>
      {apps.length > 0 && (
        <ul className="mb-5 space-y-3" aria-label="Your applications">
          {apps.map((a) => {
            const st = APPLICATION_STATUS[a.status] || APPLICATION_STATUS.new;
            return (
              <li key={a.id} className={`rounded-xl border p-4 ${tone[st.tone]}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-black">{a.company_name}</p>
                  <span className="rounded-full border border-current px-2.5 py-0.5 text-[11px] font-bold">{st.label}</span>
                </div>
                <p className="mt-1 text-xs opacity-90">Reference {a.reference} · licence {a.licence_number} · sent {fmtDate(a.created_at)}</p>
                <p className="mt-2 text-sm">{st.help}</p>
                {a.status === 'rejected' && a.review_note && <p className="mt-1 text-sm font-semibold">Support said: {a.review_note}</p>}
              </li>
            );
          })}
        </ul>
      )}

      {sent && (
        <div className="mb-5 py-3 text-center" role="status">
          <CheckCircle className="mx-auto h-10 w-10 text-emerald-500" />
          <h3 className={`mt-2 text-lg font-black ${title}`}>{sent.duplicate ? 'We already have this application' : 'Application received'}</h3>
          <p className={`mx-auto mt-1 max-w-md text-sm ${body}`}>
            Support will check your licence with the regulator. The decision shows here and on your account{sent.reference ? <>. Your reference is <strong>{sent.reference}</strong></> : ''}.
          </p>
        </div>
      )}

      {open ? (
        <p className={`text-sm ${body}`}>You have an application in progress, so a new one is not needed.</p>
      ) : (
        <form onSubmit={submit} noValidate aria-label="Apply to sell insurance on IcanEra">
          <h3 className={`text-lg font-black ${title}`}>Apply to sell cover</h3>
          <p className={`mt-1 mb-4 text-sm ${body}`}>
            Applying as <strong>{accountEmail || 'your account'}</strong>. Support checks your licence, usually within a few working days.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="ia-contact_name" className={label}>Your name *</label>
              <input id="ia-contact_name" className={input} value={form.contact_name} onChange={set('contact_name')} autoComplete="name" maxLength={120} {...a11y('contact_name')} />
              {err('contact_name')}
            </div>
            <div>
              <label htmlFor="ia-phone" className={label}>Phone / WhatsApp</label>
              <input id="ia-phone" type="tel" className={input} value={form.phone} onChange={set('phone')} autoComplete="tel" maxLength={40} {...a11y('phone')} />
              {err('phone')}
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="ia-company_name" className={label}>Registered insurance company name *</label>
              <input id="ia-company_name" className={input} value={form.company_name} onChange={set('company_name')} autoComplete="organization" maxLength={160} {...a11y('company_name')} />
              {err('company_name')}
            </div>
            <div>
              <label htmlFor="ia-country_code" className={label}>Licensed in *</label>
              <select id="ia-country_code" className={input} value={form.country_code} onChange={pickCountry} {...a11y('country_code')}>
                <option value="">Choose a country</option>
                {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
              </select>
              {err('country_code')}
            </div>
            <div>
              <label htmlFor="ia-regulator" className={label}>Regulator *</label>
              <input id="ia-regulator" className={input} value={form.regulator} onChange={set('regulator')} maxLength={60} placeholder="e.g. IRA Uganda" {...a11y('regulator')} />
              {err('regulator')}
            </div>
            <div>
              <label htmlFor="ia-licence_number" className={label}>Licence number *</label>
              <input id="ia-licence_number" className={input} value={form.licence_number} onChange={set('licence_number')} maxLength={60} placeholder="As on your licence" {...a11y('licence_number')} />
              {err('licence_number')}
            </div>
            <div>
              <label htmlFor="ia-licence_expiry" className={label}>Licence expires *</label>
              <input id="ia-licence_expiry" type="date" className={input} value={form.licence_expiry} onChange={set('licence_expiry')} {...a11y('licence_expiry')} />
              {err('licence_expiry')}
            </div>
          </div>

          <div className="mt-5">
            <span className={label}>Cover you offer *</span>
            <div className="flex flex-wrap gap-2">
              {COVER_TYPE_IDS.map((t) => (
                <button key={t} type="button" aria-pressed={form.cover_types.includes(t)} onClick={() => toggleCover(t)} title={COVER_TYPES[t].blurb}
                  className={`rounded-full border px-3.5 py-1.5 text-xs font-bold transition ${form.cover_types.includes(t)
                    ? (dark ? 'border-teal-300 bg-teal-300 text-slate-950' : 'border-teal-800 bg-teal-800 text-white')
                    : (dark ? 'border-slate-600 text-slate-300' : 'border-slate-300 text-slate-700')}`}>
                  {COVER_TYPES[t].label}
                </button>
              ))}
            </div>
            {err('cover_types')}
          </div>

          <div className="mt-5">
            <label htmlFor="ia-description" className={label}>About your company</label>
            <textarea id="ia-description" rows={3} className={input} value={form.description} onChange={set('description')} maxLength={1000} {...a11y('description')} />
            {err('description')}
          </div>

          {/* Honeypot: invisible to people, tempting to bots. */}
          <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, overflow: 'hidden' }}>
            <label>Website<input type="text" tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')} /></label>
          </div>

          {formError && <p role="alert" className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-500">{formError}</p>}

          <button type="submit" disabled={state === 'sending'}
            className={`mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg px-5 py-3 text-sm font-bold transition disabled:opacity-60 ${dark ? 'bg-teal-300 text-slate-950 hover:bg-teal-200' : 'bg-teal-800 text-white hover:bg-teal-700'}`}>
            {state === 'sending' ? <><Loader2 className="h-4 w-4 animate-spin" /> Sending...</> : <><ShieldCheck className="h-4 w-4" /> Send my application</>}
          </button>
          <p className={`mt-2 text-center text-xs ${body}`}>Only an approved insurer with an unexpired licence can sell cover. Customers always see your licence and regulator.</p>
        </form>
      )}
    </div>
  );
}

import React, { useEffect, useMemo, useState } from 'react';
import { BadgeCheck, Building2, Globe, Network, Store, Bike, CheckCircle, Loader2, ShieldCheck, WifiOff, FileCheck2 } from 'lucide-react';
import { useTheme, isDarkFamilyTheme } from '../../context/ThemeContext';
import { getSupabaseClient } from '../../lib/supabase/client';
import { getPublicOverview, submitEnquiry } from '../../services/franchiseService';
import { COUNTRIES, PARTNER_TYPES, PRODUCTS, captureAgencyRef, countryName, validateEnquiry, fmtPct, friendlyError } from '../../utils/franchise';

const PRODUCT_ICON = { icanera: Building2, supermarketera: Store, bodagoera: Bike };
const TYPE_ICON = { country_master: Globe, agency: Network, referral: BadgeCheck };

const emptyForm = () => ({
  full_name: '', email: '', phone: '', country: '', company_name: '', company_reg_number: '', company_reg_country: '',
  partner_type: 'agency', products: ['icanera'], clients_estimate: '', message: '', confirm_registered: false, website: '',
});

/**
 * Landing page "Franchise" tab. Visitors need no account: the form writes through
 * ican_franchise_submit_enquiry (validated, rate limited, honeypot). Only registered companies may ask.
 */
const FranchiseSection = ({ onGetStarted }) => {
  const { actualTheme } = useTheme();
  const dark = isDarkFamilyTheme(actualTheme);
  const [overview, setOverview] = useState(undefined); // undefined = loading, null = unavailable
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState({});
  const [state, setState] = useState('idle');           // idle | sending | sent
  const [formError, setFormError] = useState('');
  const [signedInEmail, setSignedInEmail] = useState('');
  const [duplicate, setDuplicate] = useState(false);

  const load = () => { setOverview(undefined); getPublicOverview().then(setOverview); };
  useEffect(() => {
    load();
    // An agency link (?agency=CODE) is remembered so the visitor can pick that agency after signing up.
    captureAgencyRef(typeof window !== 'undefined' ? window.location.search : '');
    const sb = getSupabaseClient();
    sb?.auth.getUser().then(({ data }) => {
      const u = data?.user;
      if (!u) return;
      setSignedInEmail(u.email || '');
      setForm((f) => ({
        ...f,
        email: f.email || u.email || '',
        full_name: f.full_name || u.user_metadata?.full_name || u.user_metadata?.name || '',
      }));
    }).catch(() => {});
  }, []);

  const live = overview?.live || [];
  const reserved = overview?.reserved || [];
  const countriesOpen = Number(overview?.countries_open || 0);
  const masterSeatTaken = form.partner_type === 'country_master' && (overview?.exclusive_masters || []).includes(form.country);
  const maxShare = Number(overview?.max_agency_share_pct || 0);
  const set = (k) => (e) => {
    const v = e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e;
    setForm((f) => ({ ...f, [k]: v }));
    if (errors[k]) setErrors((x) => ({ ...x, [k]: undefined }));
  };
  const toggleProduct = (p) => setForm((f) => ({
    ...f, products: f.products.includes(p) ? f.products.filter((x) => x !== p) : [...f.products, p],
  }));

  const submit = async (e) => {
    e.preventDefault();
    setFormError('');
    const v = validateEnquiry(form);
    setErrors(v.errors);
    if (!v.ok) return;
    setState('sending');
    try {
      const res = await submitEnquiry(form);
      setDuplicate(Boolean(res?.duplicate));
      setState('sent');
    } catch (err) {
      setFormError(friendlyError(err));
      setState('idle');
    }
  };

  // ---- styling helpers (match the other landing sections) ----
  const title = dark ? 'text-white' : 'text-slate-900';
  const body = dark ? 'text-slate-400' : 'text-slate-600';
  const card = dark ? 'border-slate-700/40 bg-slate-900/60' : 'border-slate-200 bg-white';
  const input = `w-full rounded-lg border px-3 py-2.5 text-sm outline-none transition focus:ring-2 ${dark
    ? 'border-slate-600 bg-slate-950 text-white placeholder-slate-500 focus:ring-amber-300/50'
    : 'border-slate-300 bg-white text-slate-900 placeholder-slate-400 focus:ring-emerald-600/40'}`;
  const label = `mb-1 block text-xs font-bold uppercase tracking-wider ${dark ? 'text-slate-300' : 'text-slate-600'}`;
  const accent = dark ? 'text-amber-300' : 'text-emerald-800';
  const err = (k) => (errors[k] ? <p id={`fr-${k}-err`} role="alert" className="mt-1 text-xs font-semibold text-red-500">{errors[k]}</p> : null);
  const a11y = (k) => ({ 'aria-invalid': Boolean(errors[k]), 'aria-describedby': errors[k] ? `fr-${k}-err` : undefined });

  const steps = useMemo(() => ([
    ['Send your request', 'Tell us about your registered company and the country you want to serve.'],
    ['We verify your company', 'We check your registration and your team. Only verified companies go live.'],
    ['Agree and train', 'Sign the partner agreement and get certified on the product.'],
    ['Serve customers, get paid', 'Earn your share of every subscription, settled to you with a clear statement.'],
  ]), []);

  return (
    <section id="franchise" className="relative scroll-mt-24 py-10 md:py-16 lg:py-20 2xl:py-24 px-4 sm:px-6 lg:px-8 2xl:px-16">
      <div className="max-w-6xl 2xl:max-w-[1400px] mx-auto">
        <div className="text-center mb-8 md:mb-12">
          <div className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full border text-xs md:text-sm font-bold mb-4 ${dark ? 'border-amber-300/40 bg-amber-900/25 text-amber-200' : 'border-emerald-500/40 bg-emerald-100 text-emerald-900'}`}>
            <Network className="w-4 h-4" /> Franchise
          </div>
          <h2 className={`text-2xl md:text-4xl lg:text-5xl font-black leading-tight ${title}`}>Bring IcanEra to your country</h2>
          <p className={`mt-3 max-w-2xl mx-auto text-sm md:text-base leading-relaxed ${body}`}>
            Become an authorised partner and earn a recurring share of the businesses you bring onto IcanEra, SupermarketEra and BodaGoEra.
            {maxShare > 0 && <> Agencies earn <strong className={accent}>up to {fmtPct(maxShare)}</strong> of every subscription, for as long as the customer stays.</>}
          </p>
          <div className={`mt-4 inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-xs md:text-sm font-semibold ${dark ? 'border-sky-400/30 bg-sky-900/20 text-sky-200' : 'border-sky-300 bg-sky-50 text-sky-900'}`}>
            <FileCheck2 className="w-4 h-4 shrink-0" />
            Franchises are for registered companies. We verify your registration before you go live.
          </div>
          <div className="mt-5">
            <button type="button" onClick={() => document.getElementById('franchise-request')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              className={`inline-flex items-center justify-center rounded-lg px-6 py-3 text-sm font-bold transition ${dark ? 'bg-amber-300 text-slate-950 hover:bg-amber-200' : 'bg-emerald-900 text-white hover:bg-emerald-800'}`}>
              Request a franchise
            </button>
          </div>
        </div>

        {/* What you can become */}
        <div className="grid gap-4 md:grid-cols-3">
          {PARTNER_TYPES.map((t) => {
            const Icon = TYPE_ICON[t.value];
            return (
              <div key={t.value} className={`rounded-2xl border p-5 ${card}`}>
                <div className={`mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl ${dark ? 'bg-amber-300/15 text-amber-300' : 'bg-emerald-100 text-emerald-800'}`}><Icon className="h-5 w-5" /></div>
                <h3 className={`text-base font-bold ${title}`}>{t.label}</h3>
                <p className={`mt-0.5 text-xs font-semibold ${accent}`}>{t.short}</p>
                <p className={`mt-2 text-sm leading-relaxed ${body}`}>{t.blurb}</p>
              </div>
            );
          })}
        </div>

        {/* Products + where */}
        <div className="mt-8 grid gap-6 lg:grid-cols-5">
          <div className="lg:col-span-2 space-y-6">
            <div className={`rounded-2xl border p-5 ${card}`}>
              <h3 className={`text-sm font-black uppercase tracking-wider ${title}`}>Three products, one partnership</h3>
              <ul className="mt-3 space-y-3">
                {PRODUCTS.map((p) => {
                  const Icon = PRODUCT_ICON[p.value];
                  return (
                    <li key={p.value} className="flex items-start gap-3">
                      <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${accent}`} />
                      <div><p className={`text-sm font-bold ${title}`}>{p.label}</p><p className={`text-xs ${body}`}>{p.blurb}</p></div>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className={`rounded-2xl border p-5 ${card}`}>
              <h3 className={`text-sm font-black uppercase tracking-wider ${title}`}>Open in every country</h3>
              {overview === undefined && <div className={`mt-3 h-8 rounded animate-pulse ${dark ? 'bg-slate-800' : 'bg-slate-100'}`} />}
              {overview === null && <p className={`mt-3 text-sm ${body}`}>Franchise details will appear here soon.</p>}
              {overview && (
                <>
                  <p className={`mt-3 text-sm leading-relaxed ${body}`}>
                    Any registered company can ask, in any of the {countriesOpen || COUNTRIES.length} countries IcanEra supports at sign-up. There is no waiting list to join.
                  </p>
                  {(live.length > 0 || reserved.length > 0) && (
                    <div className="mt-3 flex flex-wrap gap-2" aria-label="Countries with partners">
                      {live.map((t) => (
                        <span key={t.country_code} className={`rounded-full border px-3 py-1 text-xs font-semibold ${dark ? 'border-emerald-400/40 text-emerald-300' : 'border-emerald-600/40 text-emerald-800'}`}>{t.country_name} <span className="opacity-70">live</span></span>
                      ))}
                      {reserved.map((t) => (
                        <span key={t.country_code} className={`rounded-full border px-3 py-1 text-xs font-semibold ${dark ? 'border-amber-400/40 text-amber-300' : 'border-amber-600/40 text-amber-800'}`}>{t.country_name} <span className="opacity-70">reserved</span></span>
                      ))}
                    </div>
                  )}
                  <p className={`mt-3 text-xs ${body}`}>If a country already has a partner we will tell you, and there are usually other ways to work together.</p>
                </>
              )}
            </div>

            <div className={`rounded-2xl border p-5 ${card}`}>
              <h3 className={`text-sm font-black uppercase tracking-wider ${title}`}>How it works</h3>
              <ol className="mt-3 space-y-3">
                {steps.map(([h, t], i) => (
                  <li key={h} className="flex items-start gap-3">
                    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-black ${dark ? 'bg-amber-300 text-slate-950' : 'bg-emerald-900 text-white'}`}>{i + 1}</span>
                    <div><p className={`text-sm font-bold ${title}`}>{h}</p><p className={`text-xs ${body}`}>{t}</p></div>
                  </li>
                ))}
              </ol>
            </div>
          </div>

          {/* The request */}
          <div id="franchise-request" className={`lg:col-span-3 scroll-mt-24 rounded-2xl border p-5 md:p-7 ${card}`}>
            {state === 'sent' ? (
              <div className="py-6 text-center" role="status">
                <CheckCircle className="mx-auto h-12 w-12 text-emerald-500" />
                <h3 className={`mt-3 text-xl font-black ${title}`}>{duplicate ? 'We already have your request' : 'Request received'}</h3>
                <p className={`mx-auto mt-2 max-w-md text-sm leading-relaxed ${body}`}>
                  Thank you, {form.full_name.split(' ')[0]}. We will check your company registration and contact you at <strong>{form.email}</strong> about {countryName(form.country)}.
                </p>
                {!signedInEmail && (
                  <div className={`mx-auto mt-4 max-w-md rounded-lg border p-3 text-sm ${dark ? 'border-amber-300/30 bg-amber-900/15 text-amber-100' : 'border-emerald-300 bg-emerald-50 text-emerald-900'}`}>
                    To be set up as a partner you will need an IcanEra account with this same email.
                    <button type="button" onClick={() => onGetStarted?.('signup')} className={`mt-2 block w-full rounded-md px-4 py-2 text-sm font-bold ${dark ? 'bg-amber-300 text-slate-950 hover:bg-amber-200' : 'bg-emerald-900 text-white hover:bg-emerald-800'}`}>
                      Create my account
                    </button>
                  </div>
                )}
                <button type="button" onClick={() => { setForm(emptyForm()); setState('idle'); setDuplicate(false); }} className={`mt-4 text-xs font-bold underline decoration-dotted ${body}`}>Send another request</button>
              </div>
            ) : overview === null ? (
              <div className="py-10 text-center">
                <WifiOff className={`mx-auto h-9 w-9 ${body}`} />
                <h3 className={`mt-3 text-lg font-black ${title}`}>Franchise requests open soon</h3>
                <p className={`mx-auto mt-1 max-w-sm text-sm ${body}`}>This part of IcanEra is not switched on yet, or you are offline. Please check back shortly.</p>
                <button type="button" onClick={load} className={`mt-4 rounded-md border px-4 py-2 text-sm font-bold ${dark ? 'border-slate-600 text-slate-100 hover:bg-slate-800' : 'border-slate-300 text-slate-800 hover:bg-slate-100'}`}>Try again</button>
              </div>
            ) : (
              <form onSubmit={submit} noValidate aria-label="Request a franchise">
                <h3 className={`text-lg font-black ${title}`}>Request a franchise</h3>
                <p className={`mt-1 mb-4 text-sm ${body}`}>It takes two minutes. No account needed to ask.</p>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="fr-full_name" className={label}>Your name *</label>
                    <input id="fr-full_name" className={input} value={form.full_name} onChange={set('full_name')} autoComplete="name" maxLength={120} {...a11y('full_name')} />
                    {err('full_name')}
                  </div>
                  <div>
                    <label htmlFor="fr-email" className={label}>Email *</label>
                    <input id="fr-email" type="email" className={input} value={form.email} onChange={set('email')} autoComplete="email" maxLength={254} {...a11y('email')} />
                    {err('email')}
                  </div>
                  <div>
                    <label htmlFor="fr-phone" className={label}>Phone / WhatsApp</label>
                    <input id="fr-phone" type="tel" className={input} value={form.phone} onChange={set('phone')} autoComplete="tel" maxLength={40} {...a11y('phone')} />
                    {err('phone')}
                  </div>
                  <div>
                    <label htmlFor="fr-country" className={label}>Country you want to serve *</label>
                    <select id="fr-country" className={input} value={form.country} onChange={set('country')} autoComplete="country" {...a11y('country')}>
                      <option value="">Choose a country</option>
                      {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                    </select>
                    {err('country')}
                  </div>
                </div>

                <fieldset className={`mt-5 rounded-xl border p-4 ${dark ? 'border-sky-400/25 bg-sky-900/10' : 'border-sky-200 bg-sky-50/60'}`}>
                  <legend className={`flex items-center gap-1.5 px-2 text-xs font-black uppercase tracking-wider ${dark ? 'text-sky-200' : 'text-sky-900'}`}><ShieldCheck className="h-4 w-4" /> Your registered company</legend>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <label htmlFor="fr-company_name" className={label}>Registered company name *</label>
                      <input id="fr-company_name" className={input} value={form.company_name} onChange={set('company_name')} autoComplete="organization" maxLength={160} {...a11y('company_name')} />
                      {err('company_name')}
                    </div>
                    <div>
                      <label htmlFor="fr-company_reg_number" className={label}>Registration number *</label>
                      <input id="fr-company_reg_number" className={input} value={form.company_reg_number} onChange={set('company_reg_number')} maxLength={60} placeholder="As on your certificate" {...a11y('company_reg_number')} />
                      {err('company_reg_number')}
                    </div>
                    <div>
                      <label htmlFor="fr-company_reg_country" className={label}>Registered in (if different)</label>
                      <select id="fr-company_reg_country" className={input} value={form.company_reg_country} onChange={set('company_reg_country')} {...a11y('company_reg_country')}>
                        <option value="">Same as the country above</option>
                        {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                      </select>
                      {err('company_reg_country')}
                    </div>
                  </div>
                  <label className="mt-3 flex items-start gap-2 text-sm">
                    <input type="checkbox" className="mt-1 h-4 w-4" checked={form.confirm_registered} onChange={set('confirm_registered')} {...a11y('confirm_registered')} />
                    <span className={body}>We are a registered company and can show our registration certificate. *</span>
                  </label>
                  {err('confirm_registered')}
                </fieldset>

                <div className="mt-5">
                  <span className={label}>I want to become *</span>
                  <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Partner type">
                    {PARTNER_TYPES.map((t) => (
                      <button key={t.value} type="button" role="radio" aria-checked={form.partner_type === t.value} onClick={() => set('partner_type')(t.value)}
                        className={`rounded-lg border px-3 py-2.5 text-left text-sm transition ${form.partner_type === t.value
                          ? (dark ? 'border-amber-300 bg-amber-300/10 text-white' : 'border-emerald-700 bg-emerald-50 text-emerald-950')
                          : (dark ? 'border-slate-600 text-slate-300 hover:border-slate-400' : 'border-slate-300 text-slate-700 hover:border-slate-400')}`}>
                        <span className="block font-bold">{t.label}</span>
                        <span className={`block text-xs ${body}`}>{t.short}</span>
                      </button>
                    ))}
                  </div>
                  {err('partner_type')}
                  {masterSeatTaken && (
                    <p role="note" className={`mt-2 rounded-lg border px-3 py-2 text-xs ${dark ? 'border-amber-300/30 bg-amber-900/15 text-amber-100' : 'border-amber-400 bg-amber-50 text-amber-900'}`}>
                      {countryName(form.country)} already has an exclusive Country Master. You can still send your request, or ask to become an Authorized Agency there.
                    </p>
                  )}
                </div>

                <div className="mt-5">
                  <span className={label}>Products *</span>
                  <div className="flex flex-wrap gap-2">
                    {PRODUCTS.map((p) => (
                      <button key={p.value} type="button" aria-pressed={form.products.includes(p.value)} onClick={() => toggleProduct(p.value)}
                        className={`rounded-full border px-3.5 py-1.5 text-xs font-bold transition ${form.products.includes(p.value)
                          ? (dark ? 'border-amber-300 bg-amber-300 text-slate-950' : 'border-emerald-800 bg-emerald-800 text-white')
                          : (dark ? 'border-slate-600 text-slate-300' : 'border-slate-300 text-slate-700')}`}>
                        {p.label}
                      </button>
                    ))}
                  </div>
                  {err('products')}
                </div>

                <div className="mt-5 grid gap-4 sm:grid-cols-3">
                  <div>
                    <label htmlFor="fr-clients" className={label}>Businesses you serve today</label>
                    <input id="fr-clients" inputMode="numeric" className={input} value={form.clients_estimate} onChange={set('clients_estimate')} placeholder="e.g. 80" {...a11y('clients_estimate')} />
                    {err('clients_estimate')}
                  </div>
                  <div className="sm:col-span-2">
                    <label htmlFor="fr-message" className={label}>Anything we should know?</label>
                    <textarea id="fr-message" rows={3} className={input} value={form.message} onChange={set('message')} maxLength={2000} {...a11y('message')} />
                    {err('message')}
                  </div>
                </div>

                {/* Honeypot: invisible to people, tempting to bots. */}
                <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, overflow: 'hidden' }}>
                  <label>Website<input type="text" tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')} /></label>
                </div>

                {formError && <p role="alert" className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-500">{formError}</p>}

                <button type="submit" disabled={state === 'sending'}
                  className={`mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg px-5 py-3 text-sm font-bold transition disabled:opacity-60 ${dark ? 'bg-amber-300 text-slate-950 hover:bg-amber-200' : 'bg-emerald-900 text-white hover:bg-emerald-800'}`}>
                  {state === 'sending' ? <><Loader2 className="h-4 w-4 animate-spin" /> Sending...</> : 'Send my request'}
                </button>
                <p className={`mt-2 text-center text-xs ${body}`}>We only use your details to reply to this request.</p>
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};

export default FranchiseSection;

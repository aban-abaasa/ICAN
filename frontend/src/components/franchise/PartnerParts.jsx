import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle, FileCheck2, Info, Link2, Users, Wallet } from 'lucide-react';
import {
  applyForSeat, claimAgency, getMyAgency, getMyCustomers, getMyEarnings, listMyBusinesses, listMyStatements,
  listTerritories, releaseAgency,
} from '../../services/franchiseService';
import {
  COUNTRIES, PARTNER_TYPES, PRODUCTS, STREAM_LABEL, clearStoredAgencyRef, fmtIcan, friendlyError, getStoredAgencyRef,
  isAgencyCode, validateApplication,
} from '../../utils/franchise';
import { Field, Segmented } from '../profile/growth/parts';

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '-');
const monthLabel = (d) => new Date(d).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

const Alert = ({ kind = 'warn', children }) => (
  <div className={`gr-alert gr-alert--${kind}`} role={kind === 'err' ? 'alert' : 'status'}>
    {kind === 'err' ? <AlertTriangle aria-hidden="true" /> : kind === 'ok' ? <CheckCircle aria-hidden="true" /> : <Info aria-hidden="true" />}
    <div>{children}</div>
  </div>
);

// ------------------------------------------------------------------ earnings
export function EarningsTab({ partnerId }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    setRows(null);
    getMyEarnings(partnerId, 12).then((r) => live && setRows(r)).catch((e) => live && (setError(friendlyError(e)), setRows([])));
    return () => { live = false; };
  }, [partnerId]);

  const months = useMemo(() => {
    const m = new Map();
    (rows || []).forEach((r) => {
      const k = String(r.month);
      if (!m.has(k)) m.set(k, { month: r.month, total: 0, lines: [] });
      const g = m.get(k);
      g.total += Number(r.amount_ican);
      g.lines.push(r);
    });
    return [...m.values()];
  }, [rows]);

  if (rows === null) return <p className="gr-small" role="status">Loading your earnings...</p>;
  return (
    <div className="gr-form">
      {error && <Alert kind="err">{error}</Alert>}
      {months.length === 0 && !error && (
        <div className="gr-card gr-empty"><Wallet aria-hidden="true" /><p className="gr-title">No earnings yet</p><p className="gr-sub">Your share appears here as soon as your customers' fees come in.</p></div>
      )}
      {months.map((g) => (
        <article key={g.month} className="gr-card">
          <div className="gr-kv" style={{ borderBottom: 0, paddingTop: 0 }}>
            <dt><b>{monthLabel(g.month)}</b></dt><dd>{fmtIcan(g.total)} ICAN</dd>
          </div>
          <dl style={{ margin: 0 }}>
            {g.lines.map((l) => (
              <div className="gr-kv" key={`${l.stream}${l.role}`}>
                <dt>{STREAM_LABEL[l.stream] || l.stream} <span className="gr-chip">{l.role === 'master' ? 'master share' : 'your share'}</span> <span className="gr-small">{Number(l.events)} fee(s)</span></dt>
                <dd>{fmtIcan(l.amount_ican)}</dd>
              </div>
            ))}
          </dl>
        </article>
      ))}
      <p className="gr-hint">Amounts are in ICAN. Earnings become payable on a statement from HQ, and a refunded fee is deducted from a later statement.</p>
    </div>
  );
}

// ------------------------------------------------------------------ customers
export function CustomersTab({ partner }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    setRows(null);
    getMyCustomers(partner.id).then((r) => live && setRows(r)).catch((e) => live && (setError(friendlyError(e)), setRows([])));
    return () => { live = false; };
  }, [partner.id]);

  if (rows === null) return <p className="gr-small" role="status">Loading your customers...</p>;
  return (
    <div className="gr-form">
      {error && <Alert kind="err">{error}</Alert>}
      {rows.length === 0 && !error && (
        <div className="gr-card gr-empty"><Users aria-hidden="true" /><p className="gr-title">No customers yet</p>
          <p className="gr-sub">Share your link or code from the Overview. A business joins you when its owner enters your code, so the choice is always theirs.</p></div>
      )}
      {rows.map((c) => (
        <article key={c.assignment_id} className="gr-card">
          <div className="gr-kv" style={{ paddingTop: 0 }}><dt><b>{c.business_name || 'A business'}</b></dt><dd>{fmtIcan(c.earned_30d_ican)} ICAN <span className="gr-small">30 days</span></dd></div>
          <p className="gr-small">
            With you since {fmtDate(c.assigned_at)}
            {c.last_revenue_at ? <> · last fee {fmtDate(c.last_revenue_at)}</> : <> · no fees yet</>}
            {c.serving_partner_id !== partner.id && c.serving_partner_name && <> · served by {c.serving_partner_name}</>}
          </p>
        </article>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ statements
const STATEMENT_CHIP = { draft: 'gr-chip', approved: 'gr-chip gr-chip--warn', paid: 'gr-chip gr-chip--ok' };
const STATEMENT_TEXT = { draft: 'Being prepared', approved: 'Approved, payment due', paid: 'Paid' };

export function StatementsTab({ partnerId }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    setRows(null);
    listMyStatements(partnerId).then((r) => live && setRows(r)).catch((e) => live && (setError(friendlyError(e)), setRows([])));
    return () => { live = false; };
  }, [partnerId]);

  if (rows === null) return <p className="gr-small" role="status">Loading your statements...</p>;
  return (
    <div className="gr-form">
      {error && <Alert kind="err">{error}</Alert>}
      {rows.length === 0 && !error && (
        <div className="gr-card gr-empty"><FileCheck2 aria-hidden="true" /><p className="gr-title">No statements yet</p><p className="gr-sub">HQ issues a statement for each period. It lists what you are owed and, once paid, the payment reference.</p></div>
      )}
      {rows.map((s) => (
        <article key={s.id} className="gr-card">
          <div className="gr-kv" style={{ paddingTop: 0 }}><dt><b>{fmtDate(s.period_start)} to {fmtDate(s.period_end)}</b></dt><dd>{fmtIcan(s.total_ican)} ICAN</dd></div>
          <p className="gr-small">
            <span className={STATEMENT_CHIP[s.status] || 'gr-chip'}>{STATEMENT_TEXT[s.status] || s.status}</span>
            {' '}{s.line_count} line(s)
            {s.status === 'paid' && <> · paid {fmtDate(s.paid_at)} · reference <span className="gr-code">{s.payment_reference}</span></>}
          </p>
        </article>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ apply (registered companies only)
const emptyApplication = () => ({
  partner_type: 'agency', country: '', company_name: '', company_reg_number: '', company_reg_country: '',
  company_document_url: '', trading_name: '', region: '', products: ['icanera'], notes: '', confirm_registered: false,
});

export function ApplyTab({ onApplied, hasSeats }) {
  const [form, setForm] = useState(emptyApplication);
  const [paused, setPaused] = useState(() => new Set());
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState(null);

  // Every country in the app's list is open; the only ones to hide are those HQ has paused.
  useEffect(() => {
    listTerritories().then((open) => {
      if (open.length) { const ok = new Set(open.map((t) => t.country_code)); setPaused(new Set(COUNTRIES.filter((c) => !ok.has(c.code)).map((c) => c.code))); }
    }).catch(() => {});
  }, []);
  const set = (k) => (e) => {
    const v = e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e;
    setForm((f) => ({ ...f, [k]: v }));
    if (errors[k]) setErrors((x) => ({ ...x, [k]: undefined }));
  };
  const toggleProduct = (p) => setForm((f) => ({ ...f, products: f.products.includes(p) ? f.products.filter((x) => x !== p) : [...f.products, p] }));

  const submit = async (e) => {
    e.preventDefault();
    setBanner(null);
    const payload = { ...form, company_reg_country: form.company_reg_country || form.country };
    const v = validateApplication(payload);
    setErrors(v.errors);
    if (!v.ok) return;
    setBusy(true);
    try {
      const res = await applyForSeat(payload);
      setBanner({ kind: 'ok', text: `Application sent. Your partner code is ${res.partner_code}. We will verify your company registration, then you can go live.` });
      setForm(emptyApplication());
      onApplied?.();
    } catch (err) {
      setBanner({ kind: 'err', text: friendlyError(err) });
    } finally {
      setBusy(false);
    }
  };
  const err = (k) => (errors[k] ? <p className="gr-hint" role="alert" style={{ color: 'var(--gr-err)' }}>{errors[k]}</p> : null);
  const countryOptions = COUNTRIES.filter((c) => !paused.has(c.code)).map((c) => ({ country_code: c.code, country_name: c.name }));

  return (
    <form className="gr-form" onSubmit={submit} noValidate aria-label="Apply to become a partner">
      <ol className="fr-how gr-card" aria-label="How it works">
        <li><span className="fr-how__n" aria-hidden="true">1</span><span><b>Apply</b>Tell us about your registered company.</span></li>
        <li><span className="fr-how__n" aria-hidden="true">2</span><span><b>We verify</b>We check the registration and the owners.</span></li>
        <li><span className="fr-how__n" aria-hidden="true">3</span><span><b>Go live</b>Serve businesses and earn your share.</span></li>
      </ol>
      <Alert kind="warn"><b>Franchise partners must be registered companies.</b> We check your registration (and the people behind it) before you can go live. {hasSeats && 'You can hold one seat per type and country.'}</Alert>
      {banner && <Alert kind={banner.kind}>{banner.text}</Alert>}

      <Segmented label="I want to become" value={form.partner_type} onChange={set('partner_type')} options={PARTNER_TYPES.map((t) => ({ value: t.value, label: t.label }))} />
      <p className="gr-small">{PARTNER_TYPES.find((t) => t.value === form.partner_type)?.blurb}</p>

      <div className="gr-grid2">
        <Field label="Country you will operate in" htmlFor="fp-country">
          <select id="fp-country" className="gr-select" value={form.country} onChange={set('country')}>
            <option value="">Choose a country</option>
            {countryOptions.map((t) => <option key={t.country_code} value={t.country_code}>{t.country_name}</option>)}
          </select>
          {err('country')}
        </Field>
        <Field label="Region or city (optional)" htmlFor="fp-region"><input id="fp-region" className="gr-input" value={form.region} onChange={set('region')} /></Field>
      </div>

      <div className="gr-card gr-form">
        <p className="gr-eyebrow">Your registered company</p>
        <Field label="Registered company name" htmlFor="fp-company"><input id="fp-company" className="gr-input" value={form.company_name} onChange={set('company_name')} maxLength={160} autoComplete="organization" />{err('company_name')}</Field>
        <div className="gr-grid2">
          <Field label="Registration number" htmlFor="fp-reg"><input id="fp-reg" className="gr-input" value={form.company_reg_number} onChange={set('company_reg_number')} maxLength={60} />{err('company_reg_number')}</Field>
          <Field label="Registered in" htmlFor="fp-regc" hint="Leave as the same country unless the company is registered elsewhere.">
            <select id="fp-regc" className="gr-select" value={form.company_reg_country || form.country} onChange={set('company_reg_country')}>
              {countryOptions.map((t) => <option key={t.country_code} value={t.country_code}>{t.country_name}</option>)}
            </select>
            {err('company_reg_country')}
          </Field>
        </div>
        <Field label="Link to your certificate (optional, https)" htmlFor="fp-doc" hint="A Google Drive or other share link that lets us view your certificate of incorporation.">
          <input id="fp-doc" className="gr-input" inputMode="url" placeholder="https://" value={form.company_document_url} onChange={set('company_document_url')} />{err('company_document_url')}
        </Field>
        <Field label="Trading name (optional)" htmlFor="fp-trade"><input id="fp-trade" className="gr-input" value={form.trading_name} onChange={set('trading_name')} maxLength={120} /></Field>
        <label className="gr-check" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <input type="checkbox" checked={form.confirm_registered} onChange={set('confirm_registered')} style={{ marginTop: 4 }} />
          <span className="gr-sub">We are a registered company and can show our registration certificate.</span>
        </label>
        {err('confirm_registered')}
      </div>

      <div className="gr-field">
        <span className="gr-label">Products</span>
        <div className="gr-block__actions" style={{ gap: 8 }}>
          {PRODUCTS.map((p) => (
            <button key={p.value} type="button" className={`gr-btn gr-btn--sm ${form.products.includes(p.value) ? 'gr-btn--primary' : 'gr-btn--ghost'}`} aria-pressed={form.products.includes(p.value)} onClick={() => toggleProduct(p.value)}>{p.label}</button>
          ))}
        </div>
        {err('products')}
      </div>

      <Field label="Anything we should know? (optional)" htmlFor="fp-notes"><textarea id="fp-notes" className="gr-textarea" rows={3} style={{ padding: '.6rem .8rem', minHeight: 80 }} value={form.notes} onChange={set('notes')} maxLength={1000} /></Field>
      <button type="submit" className="gr-btn gr-btn--primary gr-btn--block" disabled={busy}>{busy ? 'Sending...' : 'Send application'}</button>
    </form>
  );
}

// ------------------------------------------------------------------ my agency (customer side)
export function MyAgencyTab() {
  const [businesses, setBusinesses] = useState(null);
  const [agencies, setAgencies] = useState({});
  const [codes, setCodes] = useState({});
  const [busy, setBusy] = useState('');
  const [banner, setBanner] = useState(null);
  const remembered = useMemo(() => getStoredAgencyRef(), []);

  const load = useCallback(async () => {
    try {
      const list = await listMyBusinesses();
      setBusinesses(list);
      const entries = await Promise.all(list.map(async (b) => [b.id, await getMyAgency(b.id).catch(() => null)]));
      setAgencies(Object.fromEntries(entries));
    } catch (e) {
      setBanner({ kind: 'err', text: friendlyError(e) });
      setBusinesses([]);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const claim = async (b) => {
    const code = String(codes[b.id] ?? remembered ?? '').trim().toUpperCase();
    if (!isAgencyCode(code)) return setBanner({ kind: 'err', text: 'That does not look like an agency code. It looks like UG-AG-K7M2X.' });
    setBusy(b.id); setBanner(null);
    try {
      const r = await claimAgency(code, b.id);
      clearStoredAgencyRef();
      setBanner({ kind: 'ok', text: `${b.business_name} is now served by ${r.agency}.` });
      await load();
    } catch (e) { setBanner({ kind: 'err', text: friendlyError(e) }); } finally { setBusy(''); }
  };
  const release = async (b) => {
    if (!window.confirm(`Stop being served by this agency for ${b.business_name}? Your data stays with you.`)) return;
    setBusy(b.id); setBanner(null);
    try { await releaseAgency(b.id); setBanner({ kind: 'ok', text: 'Agency removed.' }); await load(); }
    catch (e) { setBanner({ kind: 'err', text: friendlyError(e) }); } finally { setBusy(''); }
  };

  if (businesses === null) return <p className="gr-small" role="status">Loading your businesses...</p>;
  return (
    <div className="gr-form">
      <p className="gr-sub">An authorised IcanEra agency can help you set up and support your business. You choose whether to work with one, and you can leave at any time. Your data always stays yours.</p>
      {banner && <Alert kind={banner.kind}>{banner.text}</Alert>}
      {businesses.length === 0 && <div className="gr-card gr-empty"><Link2 aria-hidden="true" /><p className="gr-title">No business yet</p><p className="gr-sub">Create a business profile first, then you can pick an agency for it.</p></div>}
      {businesses.map((b) => {
        const a = agencies[b.id];
        return (
          <article key={b.id} className="gr-card gr-form">
            <div className="gr-kv" style={{ paddingTop: 0, borderBottom: 0 }}><dt><b>{b.business_name}</b></dt><dd>{b.country || ''}</dd></div>
            {a ? (
              <>
                <Alert kind="ok">Served by <b>{a.display_name}</b> <span className="gr-code">{a.partner_code}</span> since {fmtDate(a.assigned_at)}.</Alert>
                <button type="button" className="gr-btn gr-btn--ghost gr-btn--sm" disabled={busy === b.id} onClick={() => release(b)}>Stop using this agency</button>
              </>
            ) : (
              <>
                <Field label="Agency code" htmlFor={`ag-${b.id}`} hint={remembered ? 'Filled in from the link you opened.' : 'Ask your agency for its code.'}>
                  <input id={`ag-${b.id}`} className="gr-input" placeholder="UG-AG-K7M2X" value={codes[b.id] ?? remembered ?? ''} onChange={(e) => setCodes((c) => ({ ...c, [b.id]: e.target.value }))} autoCapitalize="characters" />
                </Field>
                <button type="button" className="gr-btn gr-btn--primary" disabled={busy === b.id} onClick={() => claim(b)}>{busy === b.id ? 'Joining...' : 'Join this agency'}</button>
              </>
            )}
          </article>
        );
      })}
    </div>
  );
}

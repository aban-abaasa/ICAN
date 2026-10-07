import React, { useEffect, useMemo, useState } from 'react';
import { BarChart3, Building2, FileCheck2, ListChecks, ShieldCheck, Users } from 'lucide-react';
import { useTheme, isDarkFamilyTheme } from '../../context/ThemeContext';
import { insuranceService } from '../../services/insuranceService';
import { INSURER_STATUS, fmtDate, formatIcan } from '../../utils/insuranceCatalog';
import { Alert, Chip, Money } from './common';
import InsurerApplication from './InsurerApplication';
import InsurerClaims from './InsurerClaims';
import InsurerPlans from './InsurerPlans';
import { BusinessClients, Policyholders } from './InsurerPolicies';

const COUNTRIES = [
  { code: 'UG', label: 'Uganda', regulator: 'Insurance Regulatory Authority (IRA Uganda)' },
  { code: 'KE', label: 'Kenya', regulator: 'Insurance Regulatory Authority (IRA Kenya)' },
  { code: 'TZ', label: 'Tanzania', regulator: 'Tanzania Insurance Regulatory Authority (TIRA)' },
  { code: 'RW', label: 'Rwanda', regulator: 'National Bank of Rwanda (BNR)' },
];

// ── Becoming an insurer ──────────────────────────────────────────────────────
function Register({ businesses, insurers, onDone }) {
  const free = businesses.filter((b) => !insurers.some((i) => i.business_id === b.id));
  const [f, setF] = useState({
    businessId: free[0]?.id || '', displayName: free[0]?.business_name || '', licenceNumber: '', licenceExpiry: '',
    countryCode: 'UG', regulator: COUNTRIES[0].regulator, contactEmail: '', contactPhone: '', claimsPhone: '', description: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [approved, setApproved] = useState(null);
  const set = (patch) => setF((cur) => ({ ...cur, ...patch }));

  // Support already approved this company's application: fill the form from it. Registering with the same
  // licence verifies the insurer immediately (the database applies the approval), so nothing is checked twice.
  useEffect(() => {
    let cancelled = false;
    insuranceService.myApplications().then((list) => {
      const a = (list || []).find((x) => x.status === 'approved');
      if (cancelled || !a) return;
      setApproved(a);
      setF((cur) => ({
        ...cur,
        displayName: cur.displayName || a.company_name, licenceNumber: a.licence_number, licenceExpiry: a.licence_expiry,
        countryCode: a.country_code, regulator: a.regulator, contactEmail: a.contact_email || cur.contactEmail,
        contactPhone: a.contact_phone || cur.contactPhone, description: a.description || cur.description,
      }));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (free.length === 0) {
    return <Alert tone="warn">{businesses.length === 0
      ? 'You need a business profile first. Create one in Business Administration, then register it as an insurer here.'
      : 'Every business you own is already registered as an insurer.'}</Alert>;
  }

  const submit = async () => {
    setBusy(true); setError('');
    const res = await insuranceService.registerInsurer({ ...f });
    setBusy(false);
    if (res.success) onDone(); else setError(res.error);
  };

  return (
    <section className="gr-card gr-form">
      <div>
        <p className="gr-eyebrow">Insurance company integration</p>
        <h3 className="gr-title gr-h">Sell cover on IcanEra</h3>
        <p className="gr-sub" style={{ marginTop: 6 }}>
          Register your licensed insurance business. After ICANera checks your licence you can publish plans, be paid in ICAN straight into your business wallet,
          message policyholders, handle claims and read the data customers choose to share with you.
        </p>
      </div>
      {approved && <Alert tone="ok">Support approved your application {approved.reference}. Pick your business and submit: you will be verified straight away. Keep the licence number as approved.</Alert>}
      <div className="gr-field"><label className="gr-label" htmlFor="rg-biz">Business</label>
        <select id="rg-biz" className="gr-select" value={f.businessId} onChange={(e) => { const b = free.find((x) => x.id === e.target.value); set({ businessId: e.target.value, displayName: b?.business_name || f.displayName }); }}>
          {free.map((b) => <option key={b.id} value={b.id}>{b.business_name}</option>)}
        </select></div>
      <div className="gr-field"><label className="gr-label" htmlFor="rg-name">Company name customers see</label>
        <input id="rg-name" className="gr-input" maxLength={80} value={f.displayName} onChange={(e) => set({ displayName: e.target.value })} /></div>
      <div className="gr-grid2">
        <div className="gr-field"><label className="gr-label" htmlFor="rg-country">Country</label>
          <select id="rg-country" className="gr-select" value={f.countryCode} onChange={(e) => set({ countryCode: e.target.value, regulator: COUNTRIES.find((c) => c.code === e.target.value)?.regulator || f.regulator })}>
            {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
          </select></div>
        <div className="gr-field"><label className="gr-label" htmlFor="rg-reg">Regulator</label>
          <input id="rg-reg" className="gr-input" maxLength={60} value={f.regulator} onChange={(e) => set({ regulator: e.target.value })} /></div>
      </div>
      <div className="gr-grid2">
        <div className="gr-field"><label className="gr-label" htmlFor="rg-lic">Licence number</label>
          <input id="rg-lic" className="gr-input" maxLength={60} value={f.licenceNumber} onChange={(e) => set({ licenceNumber: e.target.value })} /></div>
        <div className="gr-field"><label className="gr-label" htmlFor="rg-exp">Licence expires</label>
          <input id="rg-exp" type="date" className="gr-input" value={f.licenceExpiry} onChange={(e) => set({ licenceExpiry: e.target.value })} /></div>
      </div>
      <div className="gr-grid2">
        <div className="gr-field"><label className="gr-label" htmlFor="rg-mail">Contact email</label>
          <input id="rg-mail" type="email" className="gr-input" maxLength={120} value={f.contactEmail} onChange={(e) => set({ contactEmail: e.target.value })} /></div>
        <div className="gr-field"><label className="gr-label" htmlFor="rg-phone">Contact phone</label>
          <input id="rg-phone" type="tel" className="gr-input" maxLength={30} value={f.contactPhone} onChange={(e) => set({ contactPhone: e.target.value })} /></div>
      </div>
      <div className="gr-field"><label className="gr-label" htmlFor="rg-claims">Claims phone (shown to policyholders)</label>
        <input id="rg-claims" type="tel" className="gr-input" maxLength={30} value={f.claimsPhone} onChange={(e) => set({ claimsPhone: e.target.value })} /></div>
      <div className="gr-field"><label className="gr-label" htmlFor="rg-desc">About your company</label>
        <textarea id="rg-desc" className="gr-textarea" rows={3} maxLength={500} value={f.description} onChange={(e) => set({ description: e.target.value })} /></div>
      {error && <Alert tone="bad">{error}</Alert>}
      <button type="button" className="gr-btn gr-btn--primary gr-btn--block" disabled={busy || !f.displayName.trim() || !f.licenceNumber.trim() || !f.licenceExpiry} onClick={submit}>
        {busy ? 'Submitting…' : 'Submit for licence verification'}
      </button>
      <p className="gr-hint">Only a verified insurer with an unexpired licence can sell. Customers always see the licence and the regulator.</p>
    </section>
  );
}

// ── Overview + compliance ────────────────────────────────────────────────────
function Overview({ insurer, rate, onSaved }) {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');
  const [f, setF] = useState({
    display_name: insurer.display_name, regulator: insurer.regulator, licence_number: insurer.licence_number,
    licence_expiry: insurer.licence_expiry, contact_email: insurer.contact_email || '', contact_phone: insurer.contact_phone || '',
    claims_phone: insurer.claims_phone || '', description: insurer.description || '',
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ tone: '', text: '' });

  useEffect(() => {
    let cancelled = false;
    insuranceService.insurerStats(insurer.insurer_id).then((s) => { if (!cancelled) setStats(s); }).catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [insurer.insurer_id]);

  const save = async () => {
    setBusy(true); setMsg({ tone: '', text: '' });
    const res = await insuranceService.updateInsurer(insurer.insurer_id, f);
    setBusy(false);
    if (res.success) { setMsg({ tone: 'ok', text: 'Saved.' }); onSaved(); } else setMsg({ tone: 'bad', text: res.error });
  };
  const set = (patch) => setF((cur) => ({ ...cur, ...patch }));
  const licenceChanged = f.licence_number.trim() !== insurer.licence_number;

  if (error) return <Alert tone="bad">{error}</Alert>;
  if (!stats) return <div className="gr-skel" />;

  const licenceTone = stats.licence_state === 'valid' ? 'ok' : stats.licence_state === 'expiring_soon' ? 'warn' : 'bad';

  return (
    <div className="gr-form">
      <div className="ins-stats">
        <div className="ins-stat"><b>{stats.policies_active}</b><span>Active policies</span></div>
        <div className={`ins-stat ${stats.expiring_30d ? 'is-warn' : ''}`}><b>{stats.expiring_30d}</b><span>Expiring in 30 days</span></div>
        <div className="ins-stat"><b>{formatIcan(stats.premiums_30d_ican)}</b><span>ICAN premiums, 30 days</span></div>
        <div className="ins-stat"><b>{formatIcan(stats.premiums_total_ican)}</b><span>ICAN premiums, all time</span></div>
        <div className={`ins-stat ${stats.claims_open ? 'is-warn' : ''}`}><b>{stats.claims_open}</b><span>Open claims</span></div>
        <div className={`ins-stat ${stats.claims_waiting_14d ? 'is-bad' : ''}`}><b>{stats.claims_waiting_14d}</b><span>Waiting over 14 days</span></div>
        <div className="ins-stat"><b>{stats.avg_decision_days ?? '—'}</b><span>Average days to decide</span></div>
        <div className={`ins-stat ${stats.unread_messages ? 'is-warn' : ''}`}><b>{stats.unread_messages}</b><span>Unread messages</span></div>
      </div>
      {stats.premiums_total_ican > 0 && <p className="gr-small">Premiums are credited in full to your business wallet, the moment they are paid. Paid claims: <Money ican={stats.claims_paid_ican} rate={rate} />.</p>}

      <section className="gr-card gr-form">
        <p className="gr-eyebrow"><FileCheck2 aria-hidden="true" style={{ width: 12, height: 12, display: 'inline', marginRight: 4 }} />Compliance</p>
        <div className="gr-kv"><span>Licence {insurer.licence_number}</span><Chip tone={licenceTone}>{stats.licence_state === 'valid' ? 'Valid' : stats.licence_state === 'expiring_soon' ? 'Expiring soon' : 'Expired'}</Chip></div>
        <div className="gr-kv"><span>Licence expires</span><b>{fmtDate(stats.licence_expiry)} ({stats.licence_days_left} days)</b></div>
        <div className="gr-kv"><span>Regulator</span><b>{insurer.regulator}</b></div>
        <div className="gr-kv"><span>Times your team read shared data, 30 days</span><b>{stats.data_views_30d}</b></div>
        {stats.licence_state !== 'valid' && <Alert tone={stats.licence_state === 'expired' ? 'bad' : 'warn'}>{stats.licence_state === 'expired'
          ? 'Your licence has expired, so your plans are hidden and nobody can buy or renew. Update the licence below.'
          : `Your licence expires in ${stats.licence_days_left} days. Update it below once renewed so customers can keep renewing.`}</Alert>}
        {stats.claims_waiting_14d > 0 && <Alert tone="warn">{stats.claims_waiting_14d} claim{stats.claims_waiting_14d === 1 ? ' has' : 's have'} waited more than 14 days for a decision.</Alert>}
      </section>

      {insurer.is_admin && (
        <details className="gr-card ins-fold">
          <summary className="gr-sectionhead"><span className="gr-eyebrow">Company details</span><span className="gr-link">Edit</span></summary>
          <div className="gr-form" style={{ marginTop: 12 }}>
            <div className="gr-field"><label className="gr-label" htmlFor="cd-name">Company name</label><input id="cd-name" className="gr-input" maxLength={80} value={f.display_name} onChange={(e) => set({ display_name: e.target.value })} /></div>
            <div className="gr-grid2">
              <div className="gr-field"><label className="gr-label" htmlFor="cd-lic">Licence number</label><input id="cd-lic" className="gr-input" maxLength={60} value={f.licence_number} onChange={(e) => set({ licence_number: e.target.value })} /></div>
              <div className="gr-field"><label className="gr-label" htmlFor="cd-exp">Licence expires</label><input id="cd-exp" type="date" className="gr-input" value={f.licence_expiry} onChange={(e) => set({ licence_expiry: e.target.value })} /></div>
            </div>
            {licenceChanged && insurer.status === 'verified' && <Alert tone="warn">A different licence number is checked again by ICANera. Your plans are paused for new sales until it is verified.</Alert>}
            <div className="gr-field"><label className="gr-label" htmlFor="cd-reg">Regulator</label><input id="cd-reg" className="gr-input" maxLength={60} value={f.regulator} onChange={(e) => set({ regulator: e.target.value })} /></div>
            <div className="gr-grid2">
              <div className="gr-field"><label className="gr-label" htmlFor="cd-mail">Contact email</label><input id="cd-mail" type="email" className="gr-input" maxLength={120} value={f.contact_email} onChange={(e) => set({ contact_email: e.target.value })} /></div>
              <div className="gr-field"><label className="gr-label" htmlFor="cd-ph">Contact phone</label><input id="cd-ph" type="tel" className="gr-input" maxLength={30} value={f.contact_phone} onChange={(e) => set({ contact_phone: e.target.value })} /></div>
            </div>
            <div className="gr-field"><label className="gr-label" htmlFor="cd-cl">Claims phone</label><input id="cd-cl" type="tel" className="gr-input" maxLength={30} value={f.claims_phone} onChange={(e) => set({ claims_phone: e.target.value })} /></div>
            <div className="gr-field"><label className="gr-label" htmlFor="cd-desc">About</label><textarea id="cd-desc" className="gr-textarea" rows={3} maxLength={500} value={f.description} onChange={(e) => set({ description: e.target.value })} /></div>
            {msg.text && <Alert tone={msg.tone}>{msg.text}</Alert>}
            <button type="button" className="gr-btn gr-btn--primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save company details'}</button>
          </div>
        </details>
      )}
    </div>
  );
}

// ── The desk ────────────────────────────────────────────────────────────────
export default function InsurerDesk({ businesses, insurers, rate, onReload }) {
  const [insurerId, setInsurerId] = useState(insurers[0]?.insurer_id || '');
  const [tab, setTab] = useState('overview');
  const insurer = useMemo(() => insurers.find((i) => i.insurer_id === insurerId) || insurers[0], [insurers, insurerId]);

  const { actualTheme } = useTheme();

  if (!insurer) {
    return (
      <div className="gr-form">
        <section className="gr-card gr-form">
          <p className="gr-eyebrow">Step 1</p>
          <h3 className="gr-title gr-h">Apply to sell cover</h3>
          <p className="gr-sub" style={{ marginTop: 6 }}>
            Send your licence to ICAN support for approval. Once approved, register your business below and you are verified straight away.
          </p>
          <InsurerApplication dark={isDarkFamilyTheme(actualTheme)} />
        </section>
        <Register businesses={businesses} insurers={insurers} onDone={onReload} />
      </div>
    );
  }

  const status = INSURER_STATUS[insurer.status] || INSURER_STATUS.pending;
  const tabs = [
    { id: 'overview', label: 'Overview', Icon: BarChart3 },
    { id: 'plans', label: 'Plans', Icon: ListChecks },
    { id: 'holders', label: 'Policyholders', Icon: Users },
    { id: 'clients', label: 'Business clients', Icon: Building2 },
    { id: 'claims', label: 'Claims', Icon: ShieldCheck },
  ];

  return (
    <div className="gr-form">
      <section className="gr-card gr-form">
        <div className="ins-row__top" style={{ alignItems: 'center' }}>
          <div style={{ minWidth: 0 }}>
            <p className="gr-eyebrow">Insurer desk</p>
            <h3 className="gr-title gr-h">{insurer.display_name}</h3>
            <p className="gr-small">{insurer.business_name} · licence {insurer.licence_number}</p>
          </div>
          <Chip tone={status.tone}>{status.label}</Chip>
        </div>
        {insurers.length > 1 && (
          <select className="gr-select" value={insurer.insurer_id} onChange={(e) => setInsurerId(e.target.value)} aria-label="Insurance company">
            {insurers.map((i) => <option key={i.insurer_id} value={i.insurer_id}>{i.display_name}</option>)}
          </select>
        )}
        {insurer.status === 'pending' && <Alert tone="warn">ICANera is checking your licence. You can prepare plans meanwhile; they go on sale once you are verified.</Alert>}
        {insurer.status === 'suspended' && <Alert tone="bad">Your insurer account is suspended{insurer.review_note ? `: ${insurer.review_note}` : '.'} Customers cannot buy or renew. Contact ICANera support.</Alert>}
        {insurer.status === 'rejected' && <Alert tone="bad">Your application was not approved{insurer.review_note ? `: ${insurer.review_note}` : '.'} Correct the details and register again.</Alert>}
      </section>

      <div className="ins-nav" role="tablist" aria-label="Insurer desk">
        {tabs.map(({ id, label, Icon }) => <button key={id} type="button" role="tab" aria-pressed={tab === id} onClick={() => setTab(id)}><Icon aria-hidden="true" />{label}</button>)}
      </div>

      {tab === 'overview' && <Overview key={insurer.insurer_id} insurer={insurer} rate={rate} onSaved={onReload} />}
      {tab === 'plans' && <InsurerPlans key={insurer.insurer_id} insurer={insurer} rate={rate} />}
      {tab === 'holders' && <Policyholders key={insurer.insurer_id} insurer={insurer} />}
      {tab === 'clients' && <BusinessClients key={insurer.insurer_id} insurer={insurer} />}
      {tab === 'claims' && <InsurerClaims key={insurer.insurer_id} insurer={insurer} rate={rate} />}

      {insurer.status === 'rejected' && <Register businesses={businesses} insurers={insurers.filter((i) => i.insurer_id !== insurer.insurer_id)} onDone={onReload} />}
    </div>
  );
}

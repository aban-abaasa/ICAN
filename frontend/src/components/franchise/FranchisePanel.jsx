import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BadgeCheck, Copy, Info, Network, Share2 } from 'lucide-react';
import { getMySummary, isFranchiseBackendMissing } from '../../services/franchiseService';
import { PARTNER_TYPES, PRODUCTS, STATUS_LABEL, buildAgencyLink, fmtIcan, friendlyError } from '../../utils/franchise';
import { Segmented } from '../profile/growth/parts';
import { ApplyTab, CustomersTab, EarningsTab, MyAgencyTab, StatementsTab } from './PartnerParts';
import '../profile/growth/growth.css';

const typeLabel = (v) => PARTNER_TYPES.find((t) => t.value === v)?.label || v;
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '-');

const Alert = ({ kind = 'warn', children }) => (
  <div className={`gr-alert gr-alert--${kind}`} role={kind === 'err' ? 'alert' : 'status'}>
    {kind === 'err' ? <AlertTriangle aria-hidden="true" /> : <Info aria-hidden="true" />}
    <div>{children}</div>
  </div>
);

/** What is still standing between this partner and going live, in plain words. */
function pendingNotice(p) {
  if (p.status === 'active') return null;
  if (p.status === 'terminated') return { kind: 'warn', text: 'This partnership has ended. Your statements and history stay available.' };
  if (p.status === 'suspended') return { kind: 'warn', text: 'Your account is suspended, so no new earnings accrue. Please contact HQ.' };
  const todo = [];
  if (p.company_status === 'rejected') todo.push('your company registration was not accepted, please contact HQ');
  else if (p.company_status !== 'verified') todo.push('we are verifying your company registration');
  if (p.kyc_status === 'rejected') todo.push('the identity check on the company\'s owners was not accepted');
  else if (p.kyc_status !== 'verified') todo.push('we still need to check the company\'s owners');
  if (p.status === 'applied') todo.unshift('HQ is reviewing your application');
  return { kind: 'warn', text: `Not live yet: ${todo.join('; ')}. You start earning once you are live.` };
}

function Meter({ pct, label }) {
  const v = Math.max(0, Math.min(100, Math.round(pct)));
  return <div className="gr-progress" role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100} aria-label={label}><i style={{ width: `${v}%` }} /></div>;
}

function Overview({ p }) {
  const [copied, setCopied] = useState(false);
  const link = useMemo(() => buildAgencyLink(p.partner_code, typeof window !== 'undefined' ? window.location.origin : ''), [p.partner_code]);
  const owed = Number(p.accrued_ican || 0) + Number(p.statemented_ican || 0);
  const notice = pendingNotice(p);
  const canShare = p.status === 'active' && p.partner_type !== 'country_master';

  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { window.prompt('Copy this link', link); }
  };
  const share = async () => {
    if (navigator.share) { try { await navigator.share({ title: 'IcanEra', text: `Run your business on IcanEra with ${p.display_name}.`, url: link }); } catch { /* cancelled */ } } else copy();
  };

  return (
    <div className="gr-form">
      {notice && <Alert kind={notice.kind}>{notice.text}</Alert>}

      <div className="gr-grid2">
        <article className="gr-card"><p className="gr-label">Owed to you</p><p className="gr-title">{fmtIcan(owed)} <small>ICAN</small></p><p className="gr-small">{fmtIcan(p.statemented_ican)} already on a statement</p></article>
        <article className="gr-card"><p className="gr-label">Paid to you</p><p className="gr-title">{fmtIcan(p.paid_ican)} <small>ICAN</small></p><p className="gr-small">all time</p></article>
        <article className="gr-card"><p className="gr-label">Earned, 12 months</p><p className="gr-title">{fmtIcan(p.earned_12m_ican)} <small>ICAN</small></p></article>
        <article className="gr-card"><p className="gr-label">Customers</p><p className="gr-title">{p.assigned_accounts}</p><p className="gr-small">{p.partner_type === 'agency' ? `${p.active_accounts} paying lately` : 'with you'}</p></article>
      </div>

      {p.partner_type === 'agency' && p.status === 'active' && (
        <article className="gr-card gr-form">
          <div className="gr-kv" style={{ paddingTop: 0, borderBottom: 0 }}>
            <dt><b>Your tier</b></dt><dd><span className="gr-chip gr-chip--ok" style={{ textTransform: 'capitalize' }}>{p.tier}</span></dd>
          </div>
          {p.next_tier ? (
            <>
              <Meter pct={p.next_tier_min_accounts ? (p.active_accounts / p.next_tier_min_accounts) * 100 : 0} label={`Progress to ${p.next_tier}`} />
              <p className="gr-small"><b>{p.accounts_to_next_tier}</b> more paying customer(s) to reach <b style={{ textTransform: 'capitalize' }}>{p.next_tier}</b>, where your share of each subscription grows.</p>
            </>
          ) : <p className="gr-small">You are at the top tier.</p>}
          {Number(p.share_adjust_pts) !== 0 && <p className="gr-small">Quality adjustment on your share: {Number(p.share_adjust_pts) > 0 ? '+' : ''}{p.share_adjust_pts} points.</p>}
        </article>
      )}

      {p.partner_type === 'country_master' && (
        <article className="gr-card gr-form">
          <dl style={{ margin: 0 }}>
            <div className="gr-kv"><dt>Agencies under you</dt><dd>{p.agencies}</dd></div>
            <div className="gr-kv"><dt>Customers across your network</dt><dd>{p.downline_accounts}</dd></div>
            <div className="gr-kv"><dt>Royalty to HQ, last 12 months</dt><dd>{fmtIcan(p.hq_royalty_12m_ican)} ICAN</dd></div>
          </dl>
          {Number(p.min_annual_royalty_ican) > 0 && (
            <>
              <Meter pct={(Number(p.hq_royalty_12m_ican) / Number(p.min_annual_royalty_ican)) * 100} label="Progress to the minimum annual royalty" />
              <p className="gr-small">
                {Number(p.mar_shortfall_ican) > 0
                  ? <>Your licence sets a minimum annual royalty of <b>{fmtIcan(p.min_annual_royalty_ican)} ICAN</b>. <b>{fmtIcan(p.mar_shortfall_ican)} ICAN</b> to go.</>
                  : 'You have met your minimum annual royalty.'}
              </p>
            </>
          )}
        </article>
      )}

      {canShare && (
        <article className="gr-card gr-form">
          <p className="gr-eyebrow">Your link and code</p>
          <p className="gr-sub">Businesses that open your link, or enter your code, can choose you as their agency. They always keep the choice.</p>
          <div className="gr-kv" style={{ borderBottom: 0 }}><dt>Code</dt><dd><span className="gr-code">{p.partner_code}</span></dd></div>
          <input className="gr-input" readOnly value={link} aria-label="Your agency link" onFocus={(e) => e.target.select()} />
          <div className="gr-block__actions" style={{ gap: 8 }}>
            <button type="button" className="gr-btn gr-btn--primary gr-btn--sm" onClick={copy}><Copy aria-hidden="true" />{copied ? 'Copied' : 'Copy link'}</button>
            <button type="button" className="gr-btn gr-btn--ghost gr-btn--sm" onClick={share}><Share2 aria-hidden="true" />Share</button>
          </div>
        </article>
      )}

      <article className="gr-card">
        <dl style={{ margin: 0 }}>
          <div className="gr-kv"><dt>Registered company</dt><dd>{p.company_name}</dd></div>
          <div className="gr-kv"><dt>Registration number</dt><dd>{p.company_reg_number} ({p.company_reg_country})</dd></div>
          <div className="gr-kv"><dt>Products you are licensed for</dt><dd>{(p.products || []).map((id) => PRODUCTS.find((x) => x.value === id)?.label || id).join(', ')}</dd></div>
          <div className="gr-kv"><dt>Exclusive</dt><dd>{p.exclusive ? 'Yes' : 'No'}</dd></div>
          {p.contract_start && <div className="gr-kv"><dt>Contract</dt><dd>{fmtDate(p.contract_start)}{p.contract_end ? ` to ${fmtDate(p.contract_end)}` : ''}</dd></div>}
        </dl>
      </article>
    </div>
  );
}

/**
 * Franchise console for signed-in people: your partner seats with balances and tier progress,
 * your earnings, customers and statements, applying (registered companies only), and, for any
 * business owner, choosing or leaving an agency. Reads through the franchise RPCs, never tables.
 */
export default function FranchisePanel() {
  const [summary, setSummary] = useState(null);
  const [backendReady, setBackendReady] = useState(true);
  const [banner, setBanner] = useState('');
  const [section, setSection] = useState('partner');   // partner | apply | agency
  const [view, setView] = useState('overview');        // overview | earnings | customers | statements
  const [selectedId, setSelectedId] = useState(null);

  const load = useCallback(async () => {
    try {
      const rows = await getMySummary();
      setSummary(rows);
      setSelectedId((id) => (rows.some((r) => r.id === id) ? id : rows[0]?.id || null));
      if (rows.length === 0) setSection((s) => (s === 'partner' ? 'apply' : s));
    } catch (e) {
      if (isFranchiseBackendMissing(e)) setBackendReady(false); else setBanner(friendlyError(e));
      setSummary([]);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const seat = summary?.find((s) => s.id === selectedId) || null;
  const sections = [
    ...(summary?.length ? [{ value: 'partner', label: 'My partnership' }] : []),
    { value: 'apply', label: summary?.length ? 'Add a seat' : 'Apply' },
    { value: 'agency', label: 'My agency' },
  ];

  return (
    <section className="gr" aria-label="Franchise">
      <header className="gr-card gr-hero">
        <div className="gr-hero__top">
          <div className="gr-hero__copy">
            <p className="gr-eyebrow">IcanEra partners</p>
            <h2 className="gr-title"><Network aria-hidden="true" style={{ width: 20, height: 20, display: 'inline', marginRight: 8 }} />Franchise</h2>
            <p className="gr-sub">Run IcanEra for businesses in your country or city, and earn a share of what they pay. For registered companies.</p>
          </div>
        </div>
        {summary && <Segmented label="Franchise sections" value={section} onChange={setSection} options={sections} />}
      </header>

      {!backendReady && <Alert kind="warn">Franchises are not switched on for this server yet. An administrator needs to apply the franchise migration.</Alert>}
      {banner && <Alert kind="err">{banner}</Alert>}
      {summary === null && backendReady && <p className="gr-small" role="status">Loading...</p>}

      {backendReady && summary && section === 'partner' && seat && (
        <div className="gr-form">
          <article className="gr-card gr-form">
            {summary.length > 1 && (
              <select className="gr-select" value={selectedId || ''} onChange={(e) => setSelectedId(e.target.value)} aria-label="Choose a partner seat">
                {summary.map((s) => <option key={s.id} value={s.id}>{s.display_name} ({typeLabel(s.partner_type)}, {s.country_code})</option>)}
              </select>
            )}
            <div>
              <p className="gr-eyebrow">{typeLabel(seat.partner_type)} · {seat.country_code}{seat.region ? ` · ${seat.region}` : ''}</p>
              <h3 className="gr-h">{seat.display_name}</h3>
              <div className="gr-block__meta" style={{ marginTop: 6, gap: 6 }}>
                <span className={`gr-chip ${seat.status === 'active' ? 'gr-chip--ok' : 'gr-chip--warn'}`}>{STATUS_LABEL[seat.status]}</span>
                <span className={`gr-chip ${seat.company_status === 'verified' ? 'gr-chip--ok' : 'gr-chip--warn'}`}>{seat.company_status === 'verified' ? <><BadgeCheck aria-hidden="true" />Company verified</> : `Company ${seat.company_status}`}</span>
                <span className={`gr-chip ${seat.kyc_status === 'verified' ? 'gr-chip--ok' : 'gr-chip--warn'}`}>{seat.kyc_status === 'verified' ? 'Owners verified' : `Owners ${seat.kyc_status}`}</span>
                <span className="gr-chip">{(seat.products || []).length} product(s)</span>
              </div>
            </div>
            <Segmented label="Partnership views" value={view} onChange={setView}
              options={[{ value: 'overview', label: 'Overview' }, { value: 'earnings', label: 'Earnings' }, { value: 'customers', label: 'Customers' }, { value: 'statements', label: 'Statements' }]} />
          </article>
          {view === 'overview' && <Overview p={seat} />}
          {view === 'earnings' && <EarningsTab partnerId={seat.id} />}
          {view === 'customers' && <CustomersTab partner={seat} />}
          {view === 'statements' && <StatementsTab partnerId={seat.id} />}
        </div>
      )}

      {backendReady && summary && section === 'apply' && <ApplyTab hasSeats={summary.length > 0} onApplied={() => { load().then(() => setSection('partner')); }} />}
      {backendReady && summary && section === 'agency' && <MyAgencyTab />}

      <p className="gr-hint" style={{ textAlign: 'center' }}>Shares are set by the IcanEra franchise agreement and can change for future fees. Past earnings keep the terms they were earned under.</p>
    </section>
  );
}

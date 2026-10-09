import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Building2, RefreshCw, Shield, ShoppingBag, Store, User } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { usePinPrompt } from '../PinPromptDialog';
import {
  insuranceService, isNotInstalled, listMyBusinesses,
} from '../../services/insuranceService';
import { formatIcan, friendlyPayError, isLiveState, renewWindowDays } from '../../utils/insuranceCatalog';
import { Alert, Money, useLocalRate } from './common';
import BusinessCheckout from './BusinessCheckout';
import InsuranceCompliance from './InsuranceCompliance';
import InsurerDesk from './InsurerDesk';
import PlanMarket from './PlanMarket';
import PolicyPanel from './PolicyPanel';

// "Renew what is due" for a company: every driver and asset that has lapsed or ends within a week,
// renewed one after another with a single business-wallet PIN.
function BulkRenew({ due, onDone }) {
  const { askPin, pinDialog } = usePinPrompt();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState({ tone: '', text: '' });
  const total = due.reduce((sum, p) => sum + Number(p.renewal_price_ican || 0), 0);

  const run = async () => {
    const pin = await askPin({ title: 'Business-wallet PIN', message: `Renew ${due.length} ${due.length === 1 ? 'policy' : 'policies'} for ${formatIcan(total)} ICAN.` });
    if (pin === null) return;
    setBusy(true); setNote({ tone: '', text: '' });
    let done = 0;
    for (const p of due) {
      const res = await insuranceService.renew(p.policy_id, { pin });
      if (!res.success) { setNote({ tone: 'bad', text: `${p.insured_label || p.policy_number}: ${friendlyPayError(res.error)}` }); break; }
      done += 1;
    }
    setBusy(false);
    if (done > 0) { setNote((n) => (n.tone === 'bad' ? n : { tone: 'ok', text: `${done} of ${due.length} renewed.` })); onDone(); }
  };

  return (
    <div className="gr-form">
      <button type="button" className="gr-btn gr-btn--ghost" disabled={busy} onClick={run}><RefreshCw aria-hidden="true" />{busy ? 'Renewing…' : `Renew what is due (${due.length})`}</button>
      {note.text && <Alert tone={note.tone}>{note.text}</Alert>}
      {pinDialog}
    </div>
  );
}

/**
 * The Insurance tab of Compliance: the insurance requirements for your country and situation,
 * your cover (personal or through a business you own), the plans on sale, and the insurer's desk.
 * `items` are the readiness items that name the cover they need; `covers` and `onCoversChanged`
 * are shared with the checklist so a purchase ticks it off straight away.
 */
export default function InsuranceHub({ items, covers, coversLoading, onCoversChanged }) {
  const { user } = useAuth();
  const userId = user?.id;
  const rate = useLocalRate(userId);
  const topRef = useRef(null);

  const [businesses, setBusinesses] = useState([]);
  const [actingAs, setActingAs] = useState('me'); // 'me' | business id
  const [nav, setNav] = useState('cover');        // cover | find | desk
  const [coverFilter, setCoverFilter] = useState('');
  const [policies, setPolicies] = useState(null);
  const [insurers, setInsurers] = useState([]);
  const [error, setError] = useState('');
  const [installed, setInstalled] = useState(true);
  const [flash, setFlash] = useState('');
  const [buying, setBuying] = useState(null); // plan being bought for a business
  const [showPast, setShowPast] = useState(false);

  const business = useMemo(() => {
    const b = businesses.find((x) => x.id === actingAs);
    return b ? { id: b.id, name: b.business_name } : null;
  }, [businesses, actingAs]);

  useEffect(() => { if (userId) listMyBusinesses(userId).then(setBusinesses).catch(() => setBusinesses([])); }, [userId]);

  const loadInsurers = useCallback(async () => {
    try { setInsurers(await insuranceService.myInsurers()); } catch (e) { if (isNotInstalled(e)) setInstalled(false); }
  }, []);
  useEffect(() => { loadInsurers(); }, [loadInsurers]);

  const loadPolicies = useCallback(async () => {
    try {
      const list = business ? await insuranceService.businessPolicies(business.id) : await insuranceService.myPolicies();
      setPolicies(list || []);
      setError('');
    } catch (e) {
      if (isNotInstalled(e)) setInstalled(false); else setError(e.message);
      setPolicies([]);
    }
  }, [business]);
  useEffect(() => { setPolicies(null); loadPolicies(); }, [loadPolicies]);

  const changed = useCallback((message) => {
    if (typeof message === 'string') setFlash(message);
    loadPolicies();
    onCoversChanged?.();
  }, [loadPolicies, onCoversChanged]);

  const getCover = (type) => {
    setCoverFilter(type || '');
    setNav('find');
    setActingAs('me');
    requestAnimationFrame(() => topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const live = (policies || []).filter((p) => isLiveState(p.state));
  const past = (policies || []).filter((p) => !isLiveState(p.state));
  const due = useMemo(
    () => (business ? live.filter((p) => p.plan.active && (p.state === 'grace' || p.days_left <= Math.min(7, renewWindowDays(p.plan.period_days)))).concat(past.filter((p) => p.state === 'expired' && p.plan.active)) : []),
    [business, live, past],
  );

  if (!installed) {
    return (
      <div className="gr-card gr-empty">
        <Shield aria-hidden="true" />
        <p className="gr-sub">Insurance is not switched on for this server yet. An administrator needs to run the insurance migration (ADD_INSURANCE_PLATFORM.sql).</p>
      </div>
    );
  }

  const navItems = [
    { id: 'cover', label: 'My cover', Icon: Shield },
    { id: 'find', label: 'Find cover', Icon: ShoppingBag },
    { id: 'desk', label: insurers.length ? 'Insurer desk' : 'Sell cover', Icon: Store },
  ];

  return (
    <div className="gr-form" ref={topRef}>
      <InsuranceCompliance items={items} covers={covers} loading={coversLoading} onGetCover={getCover} />

      <section className="gr-card gr-form">
        <div className="gr-sectionhead">
          <div>
            <p className="gr-eyebrow">IcanEra Cover</p>
            <h3 className="gr-title gr-h">Insurance from licensed companies</h3>
          </div>
          {businesses.length > 0 && nav !== 'desk' && (
            <div className="gr-field" style={{ minWidth: '12rem' }}>
              <label className="gr-label" htmlFor="ins-acting">Acting as</label>
              <select id="ins-acting" className="gr-select" value={actingAs} onChange={(e) => { setActingAs(e.target.value); setCoverFilter(''); }}>
                <option value="me">Me, personally</option>
                {businesses.map((b) => <option key={b.id} value={b.id}>{b.business_name}</option>)}
              </select>
            </div>
          )}
        </div>
        <p className="gr-sub">
          Pay with your ICAN wallet or reward points. Share only what you choose, talk to your insurer, and file claims here. Riders&apos; cover shows on their live rider card.
        </p>
        <div className="ins-nav" role="tablist" aria-label="Insurance">
          {navItems.map(({ id, label, Icon }) => <button key={id} type="button" role="tab" aria-pressed={nav === id} onClick={() => setNav(id)}><Icon aria-hidden="true" />{label}</button>)}
        </div>
      </section>

      {flash && <Alert tone="ok">{flash}</Alert>}
      {error && <Alert tone="bad">{error}</Alert>}

      {nav === 'cover' && (
        <div className="gr-form">
          {business && <p className="gr-small"><Building2 aria-hidden="true" style={{ width: 12, height: 12, display: 'inline', marginRight: 4 }} />Cover {business.name} pays for: the company, its drivers and its fleet.</p>}
          {policies === null ? <div className="gr-skel" /> : (
            <>
              {live.length === 0 && past.length === 0 && (
                <div className="gr-card gr-empty">
                  <User aria-hidden="true" />
                  <p className="gr-sub">{business ? `${business.name} has no insurance cover yet.` : 'You do not have any insurance cover yet.'}</p>
                  <button type="button" className="gr-btn gr-btn--primary" onClick={() => setNav('find')}>Find cover</button>
                </div>
              )}
              {due.length > 0 && <BulkRenew due={due} onDone={() => changed()} />}
              {live.map((p) => <PolicyPanel key={p.policy_id} policy={p} userId={userId} rate={rate} mode={business ? 'business' : 'holder'} onChanged={changed} />)}
              {past.length > 0 && (
                <>
                  <button type="button" className="gr-link" onClick={() => setShowPast((s) => !s)}>{showPast ? 'Hide past cover' : `Past cover (${past.length})`}</button>
                  {showPast && past.map((p) => <PolicyPanel key={p.policy_id} policy={p} userId={userId} rate={rate} mode={business ? 'business' : 'holder'} onChanged={changed} />)}
                </>
              )}
              {live.length > 0 && <p className="gr-hint">Total renewal cost of what is live: <Money ican={live.reduce((s, p) => s + Number(p.renewal_price_ican || 0), 0)} rate={rate} /></p>}
            </>
          )}
        </div>
      )}

      {nav === 'find' && userId && (
        <PlanMarket
          userId={userId} rate={rate}
          audiences={business ? ['business', 'rider'] : ['person', 'rider']}
          initialCoverType={coverFilter}
          actingBusiness={business}
          onBusinessBuy={setBuying}
          onChanged={changed}
        />
      )}

      {nav === 'desk' && (
        <InsurerDesk businesses={businesses} insurers={insurers} rate={rate} onReload={loadInsurers} />
      )}

      {buying && business && (
        <BusinessCheckout
          plan={buying} business={business} rate={rate}
          onClose={() => setBuying(null)}
          onDone={(message) => { setBuying(null); setNav('cover'); changed(message); }}
        />
      )}
    </div>
  );
}

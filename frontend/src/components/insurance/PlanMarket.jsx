import React, { useEffect, useMemo, useState } from 'react';
import { Gift, Percent, ShieldCheck, Users, Wallet } from 'lucide-react';
import { getSupabaseClient } from '../../lib/supabase/client';
import walletAccountService from '../../services/walletAccountService';
import { usePinPrompt } from '../PinPromptDialog';
import {
  getRewardPoints, getWalletBalances, insuranceService,
} from '../../services/insuranceService';
import {
  SHARE_SCOPES, coverTypeLabel, fmtDate, formatIcan, friendlyPayError, periodLabel, scopeShort,
} from '../../utils/insuranceCatalog';
import { Segmented, Switch } from '../profile/growth/parts';
import { Alert, Chip, Modal, Money, ScopeSwitch } from './common';

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
const regLabel = (r) => `${cap(r.vehicle_type)}${r.plate_number && r.plate_number !== 'PENDING' ? ` · ${String(r.plate_number).toUpperCase()}` : ''}`;

const PAY_MODES = [
  { value: 'wallet', label: 'ICAN wallet' },
  { value: 'points_first', label: 'Points + wallet' },
  { value: 'points_only', label: 'Points only' },
];

/** The riders a person has registered in BodaGoEra (same account, same database). Empty when that app is not installed. */
async function loadMyRiders(userId) {
  try {
    const { data, error } = await getSupabaseClient().from('mbg_riders').select('id, vehicle_type, plate_number, status').eq('user_id', userId);
    return error ? [] : (data || []);
  } catch {
    return [];
  }
}

// ── Buying cover for yourself (or one of your vehicles) ──────────────────────
function PersonalCheckout({ plan, userId, riders, rate, onClose, onDone }) {
  const { askPin, pinDialog } = usePinPrompt();
  const forRider = plan.audience.includes('rider');
  const forPerson = plan.audience.includes('person');
  const eligible = useMemo(
    () => (forRider ? riders.filter((r) => !plan.vehicle_types || plan.vehicle_types.includes(r.vehicle_type)) : []),
    [forRider, riders, plan.vehicle_types],
  );
  const [target, setTarget] = useState(eligible[0]?.id || 'self');
  const [scopes, setScopes] = useState([]);
  const [pay, setPay] = useState('wallet');
  const [autoRenew, setAutoRenew] = useState(false);
  const [quote, setQuote] = useState(null);
  const [balance, setBalance] = useState(null);
  const [points, setPoints] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const canBuy = eligible.length > 0 || forPerson;

  useEffect(() => {
    let cancelled = false;
    getWalletBalances(userId).then((b) => { if (!cancelled) setBalance(b.personal); }).catch(() => { if (!cancelled) setBalance(0); });
    getRewardPoints(userId).then((p) => { if (!cancelled) setPoints(p); });
    return () => { cancelled = true; };
  }, [userId]);

  // The exact price for the data the person agrees to share (the insurer may reward sharing).
  useEffect(() => {
    let cancelled = false;
    insuranceService.quote(plan.plan_id, 1, scopes).then((q) => { if (!cancelled && q?.success) setQuote(q); }).catch(() => {});
    return () => { cancelled = true; };
  }, [plan.plan_id, scopes]);

  const price = Number(quote?.per_member_ican ?? plan.price_ican);
  const pointsCost = plan.points_enabled ? Number(quote?.points_cost ?? plan.points_cost ?? 0) : 0;
  const perIcan = pointsCost > 0 && price > 0 ? pointsCost / price : 0;
  const pts = Math.floor(points || 0);
  const canPointsOnly = pointsCost > 0 && pts >= pointsCost;
  const pointsUsed = pay !== 'wallet' && plan.points_enabled ? Math.min(pts, pointsCost) : 0;
  const walletPart = pay === 'points_only' ? 0 : Math.max(0, price - (perIcan > 0 ? pointsUsed / perIcan : 0));
  const short = balance !== null && walletPart > 0 && balance + 1e-9 < walletPart;
  const blocked = (pay === 'points_only' && !canPointsOnly) || short || !canBuy;
  const discountOn = plan.data_discount_pct > 0 && plan.data_discount_scopes.every((s) => scopes.includes(s));
  const discountNames = plan.data_discount_scopes.map((s) => scopeShort(s)).join(' and ');

  const toggleScope = (id, on) => setScopes((cur) => (on ? Array.from(new Set([...cur, id])) : cur.filter((s) => s !== id)));

  const submit = async () => {
    setError('');
    const pin = await askPin({ title: 'Confirm payment', message: `Pay for ${plan.name} with your transaction PIN.` });
    if (pin === null) return;
    setBusy(true);
    try {
      const check = await walletAccountService.verifyUserPIN(userId, pin);
      if (!check?.success) { setError(check?.error || 'Incorrect transaction PIN.'); return; }
      const res = await insuranceService.subscribePersonal({
        planId: plan.plan_id, riderId: target === 'self' ? null : target, usePoints: pay !== 'wallet',
        pointsOnly: pay === 'points_only', shareScopes: scopes, autoRenew, renewWith: pay,
      });
      if (res.success) onDone(res); else setError(friendlyPayError(res.error));
    } catch (e) {
      setError(e?.message || "We couldn't complete the payment. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={plan.name} eyebrow="Get this cover" onClose={onClose}>
      <p className="gr-sub">
        {plan.insurer.name} · {coverTypeLabel(plan.cover_type)}. Licensed by {plan.insurer.regulator}, no. {plan.insurer.licence_number}, valid to {fmtDate(plan.insurer.licence_expiry)}.
      </p>

      <dl className="ins-facts">
        <div className="ins-fact"><dt>Price</dt><dd><Money ican={price} rate={rate} suffix={`/ ${periodLabel(plan.period_days)}`} /></dd></div>
        <div className="ins-fact"><dt>Covers up to</dt><dd><Money ican={plan.cover_limit_ican} rate={rate} /></dd></div>
        <div className="ins-fact"><dt>Starts</dt><dd>{plan.waiting_days === 0 ? 'Today' : `After ${plan.waiting_days} days`}</dd></div>
      </dl>

      {plan.benefits.length > 0 && <ul className="ins-list">{plan.benefits.map((b) => <li key={b}>{b}</li>)}</ul>}
      {!canBuy && <Alert tone="warn">This plan is for riders. You need an approved rider registration with a matching vehicle{plan.vehicle_types ? ` (${plan.vehicle_types.join(', ')})` : ''}.</Alert>}

      {eligible.length > 0 && (forPerson || eligible.length > 1) && (
        <div className="gr-field">
          <label className="gr-label" htmlFor="ins-target">Who is covered</label>
          <select id="ins-target" className="gr-select" value={target} onChange={(e) => setTarget(e.target.value)}>
            {eligible.map((r) => <option key={r.id} value={r.id}>{regLabel(r)}</option>)}
            {forPerson && <option value="self">Me, as a person</option>}
          </select>
        </div>
      )}

      <div className="gr-field">
        <span className="gr-label">How to pay</span>
        <Segmented label="How to pay" value={pay} onChange={setPay} options={PAY_MODES.filter((m) => m.value === 'wallet' || plan.points_enabled)} />
        {plan.points_enabled ? (
          <p className="gr-hint"><Gift aria-hidden="true" style={{ width: 12, height: 12, display: 'inline', marginRight: 4 }} />
            You have {points === null ? '…' : pts.toLocaleString()} reward points; this cover is {pointsCost.toLocaleString()} points.
            {pay === 'points_only' && !canPointsOnly && ` You need ${Math.max(0, pointsCost - pts).toLocaleString()} more to pay with points only.`}
          </p>
        ) : <p className="gr-hint">This insurer does not take reward points on this plan.</p>}
      </div>

      <div className="gr-field">
        <span className="gr-label">Share with {plan.insurer.name} (optional)</span>
        {plan.data_discount_pct > 0 && (
          <Alert tone={discountOn ? 'ok' : 'warn'}>
            {discountOn ? `Discount on: you save ${plan.data_discount_pct}% by sharing ${discountNames}.` : `Share ${discountNames} and save ${plan.data_discount_pct}%.`}
          </Alert>
        )}
        {SHARE_SCOPES.map((s) => (
          <ScopeSwitch key={s.id} label={s.label} help={s.help} checked={scopes.includes(s.id)} onChange={(on) => toggleScope(s.id, on)} />
        ))}
        <p className="gr-hint">The insurer sees only what you switch on. Change it any time, and see every time they look.</p>
      </div>

      <Switch checked={autoRenew} onChange={setAutoRenew}>Renew automatically, one day before it ends the same way you chose to pay</Switch>
      {plan.terms_url && <a className="gr-link" href={plan.terms_url} target="_blank" rel="noopener noreferrer">Read the policy terms</a>}

      <div className="gr-alert">
        <Wallet aria-hidden="true" style={{ width: 16, height: 16, flex: 'none', marginTop: 2 }} />
        <span>
          <b>You pay: </b>
          {pointsUsed > 0 && `${pointsUsed.toLocaleString()} points`}{pointsUsed > 0 && walletPart > 0 && ' + '}
          {(walletPart > 0 || pointsUsed === 0) && <Money ican={walletPart > 0 ? walletPart : price} rate={rate} />}
        </span>
      </div>
      {short && <Alert tone="warn">Your wallet has {formatIcan(balance)} ICAN and this needs {formatIcan(walletPart)}. Add some, or pay with reward points.</Alert>}
      {error && <Alert tone="bad">{error}</Alert>}

      <button type="button" className="gr-btn gr-btn--primary gr-btn--block" disabled={busy || blocked} onClick={submit}>
        {busy ? 'Paying…' : pay === 'points_only' ? 'Pay with points' : 'Pay and get covered'}
      </button>
      {pinDialog}
    </Modal>
  );
}

// ── The plans on sale ────────────────────────────────────────────────────────
/**
 * Props: userId, rate, audiences (['person','rider'] or ['business','rider']), initialCoverType,
 * onBuyForBusiness(plan) when acting as a business, covered (Set of "kind:cover_type" already held), onChanged.
 */
export default function PlanMarket({ userId, rate, audiences, initialCoverType = '', actingBusiness = null, onBusinessBuy, onChanged }) {
  const [plans, setPlans] = useState(null);
  const [riders, setRiders] = useState([]);
  const [error, setError] = useState('');
  const [type, setType] = useState(initialCoverType || 'all');
  const [picked, setPicked] = useState(null);

  useEffect(() => { setType(initialCoverType || 'all'); }, [initialCoverType]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const lists = await Promise.all(audiences.map((a) => insuranceService.listPlans({ audience: a })));
        const byId = new Map();
        lists.flat().forEach((p) => byId.set(p.plan_id, p));
        if (!cancelled) setPlans(Array.from(byId.values()));
        if (!actingBusiness) {
          const r = await loadMyRiders(userId);
          if (!cancelled) setRiders(r);
        }
      } catch (e) {
        if (!cancelled) { setError(e.message); setPlans([]); }
      }
    })();
    return () => { cancelled = true; };
  }, [audiences.join('|'), userId, actingBusiness]); // eslint-disable-line react-hooks/exhaustive-deps

  const types = useMemo(() => Array.from(new Set((plans || []).map((p) => p.cover_type))), [plans]);
  const visible = (plans || []).filter((p) => type === 'all' || p.cover_type === type);

  if (plans === null) return <div className="gr-skel" />;
  if (error) return <Alert tone="bad">{error}</Alert>;

  return (
    <div className="gr-form">
      {types.length > 1 && (
        <div className="ins-nav" role="group" aria-label="Kind of cover">
          {['all', ...types].map((t) => (
            <button key={t} type="button" aria-pressed={type === t} onClick={() => setType(t)}>{t === 'all' ? 'All cover' : coverTypeLabel(t)}</button>
          ))}
        </div>
      )}

      {visible.length === 0 ? (
        <div className="gr-card gr-empty">
          <ShieldCheck aria-hidden="true" />
          <p className="gr-sub">{plans.length === 0 ? 'No insurance plans are on sale for you yet. Insurance companies are being verified; check back soon.' : `No ${coverTypeLabel(type).toLowerCase()} plans are on sale yet.`}</p>
        </div>
      ) : (
        <div className="ins-plans">
          {visible.map((p) => (
            <article key={p.plan_id} className="gr-card ins-plan">
              <div className="ins-plan__top">
                <div style={{ minWidth: 0 }}>
                  <h4 className="ins-plan__name">{p.name}</h4>
                  <p className="ins-plan__by">{p.insurer.name} · {coverTypeLabel(p.cover_type)}</p>
                  <p className="ins-plan__lic">Licensed by {p.insurer.regulator} · valid to {fmtDate(p.insurer.licence_expiry)}</p>
                </div>
                <div className="ins-price">
                  <b>{formatIcan(p.price_ican)}</b>
                  <span>ICAN / {periodLabel(p.period_days)}</span>
                  {rate && <small>≈ {rate.currency} {Math.round(p.price_ican * rate.priceLocal).toLocaleString()}</small>}
                </div>
              </div>
              {p.summary && <p className="gr-sub">{p.summary}</p>}
              <div className="ins-perks">
                {p.points_enabled && p.points_cost != null && <Chip tone="warn"><Gift aria-hidden="true" />Pay with points · {Number(p.points_cost).toLocaleString()}</Chip>}
                {p.data_discount_pct > 0 && <Chip tone="ok"><Percent aria-hidden="true" />Save {p.data_discount_pct}% when you share your record</Chip>}
                {p.group_discount_pct > 0 && p.audience.includes('rider') && <Chip><Users aria-hidden="true" />{p.group_discount_pct}% off for {p.group_min_members}+ drivers</Chip>}
                {p.audience.map((a) => <Chip key={a}>{a === 'person' ? 'People' : a === 'rider' ? 'Riders' : 'Businesses'}</Chip>)}
              </div>
              {p.benefits.length > 0 && (
                <ul className="ins-list">
                  {p.benefits.slice(0, 3).map((b) => <li key={b}>{b}</li>)}
                  {p.benefits.length > 3 && <li style={{ color: 'var(--gr-faint)' }}>+ {p.benefits.length - 3} more</li>}
                </ul>
              )}
              <div className="ins-foot">
                <p className="gr-small">
                  Covers up to <Money ican={p.cover_limit_ican} rate={rate} />{p.waiting_days > 0 && ` · ${p.waiting_days}-day wait`}
                </p>
                <button type="button" className="gr-btn gr-btn--primary gr-btn--sm" onClick={() => (actingBusiness ? onBusinessBuy(p) : setPicked(p))}>
                  {actingBusiness ? 'Buy for the business' : 'Get this cover'}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {picked && (
        <PersonalCheckout
          plan={picked} userId={userId} riders={riders} rate={rate}
          onClose={() => setPicked(null)}
          onDone={() => { setPicked(null); onChanged?.('Cover bought. You are covered.'); }}
        />
      )}
    </div>
  );
}

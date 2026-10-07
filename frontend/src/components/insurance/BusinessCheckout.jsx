import React, { useEffect, useMemo, useState } from 'react';
import { Building2, Users } from 'lucide-react';
import { getSupabaseClient } from '../../lib/supabase/client';
import { usePinPrompt } from '../PinPromptDialog';
import { getBusinessBalance, insuranceService } from '../../services/insuranceService';
import { coverTypeLabel, formatIcan, friendlyPayError, periodLabel } from '../../utils/insuranceCatalog';
import { Segmented } from '../profile/growth/parts';
import { Alert, Modal, Money } from './common';

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
const vehicle = (d) => `${cap(d.vehicle_type)}${d.plate_number && d.plate_number !== 'PENDING' ? ` · ${String(d.plate_number).toUpperCase()}` : ''}`;
const hasLiveCover = (c) => c && ['active', 'waiting', 'grace'].includes(c.state);

/**
 * A company buys cover for itself, or for some of its BodaGoEra drivers, from the business wallet.
 * The business-wallet PIN is checked by the database (5 tries, then a 15-minute lock), and a payment
 * above the wallet's approval limit is refused rather than slipped past the shareholders.
 */
export default function BusinessCheckout({ plan, business, rate, onClose, onDone }) {
  const { askPin, pinDialog } = usePinPrompt();
  const canCompany = plan.audience.includes('business');
  const canDrivers = plan.audience.includes('rider');
  const [kind, setKind] = useState(canCompany ? 'business' : 'rider');
  const [drivers, setDrivers] = useState([]);
  const [cover, setCover] = useState(new Map());
  const [picked, setPicked] = useState(new Set());
  const [quote, setQuote] = useState(null);
  const [balance, setBalance] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    getBusinessBalance(business.id).then((b) => { if (!cancelled) setBalance(b); }).catch(() => {});
    if (canDrivers) {
      Promise.all([
        getSupabaseClient().rpc('mbg_business_list_drivers', { p_business_profile_id: business.id }),
        insuranceService.driverCoverSafe(business.id),
      ]).then(([drv, cov]) => {
        if (cancelled) return;
        setDrivers(drv.error ? [] : (drv.data || []));
        setCover(new Map((cov || []).map((c) => [c.rider_id, c.insurance])));
      }).catch(() => {});
    }
    return () => { cancelled = true; };
  }, [business.id, canDrivers]);

  const eligible = useMemo(
    () => drivers.filter((d) => !plan.vehicle_types || plan.vehicle_types.includes(d.vehicle_type)),
    [drivers, plan.vehicle_types],
  );

  // Start with every eligible driver who has no live cover; the owner can tick or untick.
  useEffect(() => {
    if (kind !== 'rider') return;
    setPicked(new Set(eligible.filter((d) => !hasLiveCover(cover.get(d.id))).map((d) => d.id)));
  }, [kind, eligible, cover]);

  const count = kind === 'business' ? 1 : picked.size;

  useEffect(() => {
    if (count < 1) { setQuote(null); return undefined; }
    let cancelled = false;
    insuranceService.quote(plan.plan_id, count, []).then((q) => { if (!cancelled && q?.success) setQuote(q); }).catch(() => {});
    return () => { cancelled = true; };
  }, [plan.plan_id, count]);

  const short = quote && balance !== null && balance + 1e-9 < Number(quote.total_ican);
  const toggle = (id) => setPicked((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const submit = async () => {
    setError('');
    const pin = await askPin({ title: 'Business-wallet PIN', message: `Pay ${formatIcan(quote?.total_ican)} ICAN from ${business.name}.` });
    if (pin === null) return;
    setBusy(true);
    const res = await insuranceService.subscribeBusiness({ planId: plan.plan_id, businessId: business.id, kind, riderIds: Array.from(picked), pin });
    setBusy(false);
    if (res.success) {
      onDone(kind === 'business'
        ? `${business.name} is covered.`
        : `${res.insured} driver${Number(res.insured) === 1 ? '' : 's'} covered${Number(res.skipped) ? ` (${res.skipped} already had it)` : ''}.`);
    } else setError(friendlyPayError(res.error));
  };

  return (
    <Modal title={plan.name} eyebrow={`For ${business.name}`} onClose={onClose}>
      <p className="gr-sub">{plan.insurer.name} · {coverTypeLabel(plan.cover_type)} · covers up to <Money ican={plan.cover_limit_ican} rate={rate} /> each, {formatIcan(plan.price_ican)} ICAN per {periodLabel(plan.period_days)}.</p>

      {canCompany && canDrivers && (
        <Segmented label="Who is covered" value={kind} onChange={setKind}
          options={[{ value: 'business', label: 'The company' }, { value: 'rider', label: 'Drivers' }]} />
      )}

      {kind === 'rider' && (
        <div className="gr-field">
          <span className="gr-label">Drivers ({picked.size} chosen)</span>
          {drivers.length === 0 ? (
            <p className="gr-hint">This business has no BodaGoEra drivers yet. Add them under Manage Your Business in BodaGoEra.</p>
          ) : (
            <>
              <div className="gr-block__actions"><button type="button" className="gr-link" onClick={() => setPicked(new Set(eligible.map((d) => d.id)))}>Choose all</button></div>
              <div className="ins-rows" style={{ maxHeight: '15rem', overflowY: 'auto' }}>
                {drivers.map((d) => {
                  const ok = eligible.some((e) => e.id === d.id);
                  return (
                    <label key={d.id} className="ins-row" style={{ opacity: ok ? 1 : 0.45, cursor: ok ? 'pointer' : 'default', gridTemplateColumns: 'auto minmax(0,1fr) auto', alignItems: 'center' }}>
                      <input type="checkbox" disabled={!ok} checked={picked.has(d.id)} onChange={() => toggle(d.id)} />
                      <span><span className="ins-row__t">{d.full_name}</span><span className="ins-row__m" style={{ display: 'block' }}>{vehicle(d)}{!ok ? ' · not covered by this plan' : ''}</span></span>
                      {hasLiveCover(cover.get(d.id)) && <span className="gr-chip gr-chip--ok">Has cover</span>}
                    </label>
                  );
                })}
              </div>
              <p className="gr-hint">A driver who already has this cover is skipped and not charged. Each insured driver&apos;s cover shows on their live rider card.</p>
            </>
          )}
        </div>
      )}

      {quote && (
        <div className="gr-alert">
          {kind === 'business' ? <Building2 aria-hidden="true" style={{ width: 16, height: 16, flex: 'none' }} /> : <Users aria-hidden="true" style={{ width: 16, height: 16, flex: 'none' }} />}
          <span>
            <b>The business pays: </b><Money ican={quote.total_ican} rate={rate} /><br />
            <span className="gr-small">{formatIcan(quote.per_member_ican)} ICAN × {count}{quote.group_discount_applied ? ' · group discount applied' : ''}. Business wallet: {formatIcan(balance)} ICAN.</span>
          </span>
        </div>
      )}
      {short && <Alert tone="warn">The business wallet does not have enough IcanEra for this. Top it up, or insure fewer drivers.</Alert>}
      {error && <Alert tone="bad">{error}</Alert>}

      <button type="button" className="gr-btn gr-btn--primary gr-btn--block" disabled={busy || count < 1 || !!short} onClick={submit}>
        {busy ? 'Paying…' : 'Pay from the business wallet'}
      </button>
      <p className="gr-hint">Only an owner or administrator can pay from the business wallet.</p>
      {pinDialog}
    </Modal>
  );
}

import React, { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { insuranceService } from '../../services/insuranceService';
import {
  AUDIENCES, COVER_TYPES, PERIODS, SHARE_SCOPES, VEHICLE_TYPES, coverTypeLabel, formatIcan, periodLabel, scopeShort,
} from '../../utils/insuranceCatalog';
import { Switch } from '../profile/growth/parts';
import { Alert, Chip, Modal, Money } from './common';

const EMPTY = {
  name: '', summary: '', benefits: '', cover_type: 'accident', audience: ['person'], vehicle_types: [], period_days: 30,
  premium_ican: '', cover_limit_ican: '', waiting_days: 0, points_enabled: true, data_discount_pct: 0,
  data_discount_scopes: ['activity', 'compliance'], group_discount_pct: 0, terms_url: '', active: true,
};

const fromPlan = (p) => ({
  name: p.name, summary: p.summary || '', benefits: (p.benefits || []).join('\n'), cover_type: p.cover_type,
  audience: p.audience, vehicle_types: p.vehicle_types || [], period_days: p.period_days,
  premium_ican: String(p.premium_ican), cover_limit_ican: String(p.cover_limit_ican), waiting_days: p.waiting_days,
  points_enabled: p.points_enabled, data_discount_pct: Number(p.data_discount_pct), data_discount_scopes: p.data_discount_scopes,
  group_discount_pct: Number(p.group_discount_pct), terms_url: p.terms_url || '', active: p.active,
});

function PlanForm({ insurer, plan, maxDataDiscount, onClose, onSaved }) {
  const [f, setF] = useState(plan ? fromPlan(plan) : EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (patch) => setF((cur) => ({ ...cur, ...patch }));
  const toggle = (key, value, on) => set({ [key]: on ? Array.from(new Set([...f[key], value])) : f[key].filter((x) => x !== value) });

  const save = async () => {
    setBusy(true); setError('');
    const res = await insuranceService.savePlan(insurer.insurer_id, plan?.plan_id || null, {
      name: f.name, summary: f.summary, benefits: f.benefits.split('\n').map((b) => b.trim()).filter(Boolean),
      cover_type: f.cover_type, audience: f.audience, vehicle_types: f.audience.includes('rider') ? f.vehicle_types : [],
      period_days: Number(f.period_days), premium_ican: Number(f.premium_ican), cover_limit_ican: Number(f.cover_limit_ican),
      waiting_days: Number(f.waiting_days), points_enabled: f.points_enabled, data_discount_pct: Number(f.data_discount_pct),
      data_discount_scopes: f.data_discount_scopes, group_discount_pct: Number(f.group_discount_pct), terms_url: f.terms_url, active: f.active,
    });
    setBusy(false);
    if (res.success) onSaved(plan ? 'Plan saved. A new price applies from each customer’s next renewal.' : 'Plan created.'); else setError(res.error);
  };

  return (
    <Modal title={plan ? 'Edit plan' : 'New plan'} eyebrow={insurer.display_name} onClose={onClose}>
      <div className="gr-field"><label className="gr-label" htmlFor="pl-name">Plan name</label>
        <input id="pl-name" className="gr-input" maxLength={80} value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Boda Accident Shield" /></div>
      <div className="gr-field"><label className="gr-label" htmlFor="pl-sum">One-line summary</label>
        <input id="pl-sum" className="gr-input" maxLength={300} value={f.summary} onChange={(e) => set({ summary: e.target.value })} placeholder="What it protects, in plain words" /></div>
      <div className="gr-field"><label className="gr-label" htmlFor="pl-ben">What is included (one per line, up to 8)</label>
        <textarea id="pl-ben" className="gr-textarea" rows={4} value={f.benefits} onChange={(e) => set({ benefits: e.target.value })} placeholder={'Hospital bills up to the limit\nDeath benefit\nFree towing'} /></div>

      <div className="gr-grid2">
        <div className="gr-field"><label className="gr-label" htmlFor="pl-type">Kind of cover</label>
          <select id="pl-type" className="gr-select" value={f.cover_type} onChange={(e) => set({ cover_type: e.target.value })}>
            {Object.entries(COVER_TYPES).map(([id, t]) => <option key={id} value={id}>{t.label}</option>)}
          </select></div>
        <div className="gr-field"><label className="gr-label" htmlFor="pl-period">Cover period</label>
          <select id="pl-period" className="gr-select" value={f.period_days} onChange={(e) => set({ period_days: e.target.value })}>
            {PERIODS.map((p) => <option key={p.days} value={p.days}>{p.label}</option>)}
          </select></div>
      </div>

      <div className="gr-field">
        <span className="gr-label">Who can buy it</span>
        {Object.entries(AUDIENCES).map(([id, a]) => (
          <Switch key={id} checked={f.audience.includes(id)} onChange={(on) => toggle('audience', id, on)}>{a.label}: {a.blurb}</Switch>
        ))}
      </div>
      {f.audience.includes('rider') && (
        <div className="gr-field">
          <span className="gr-label">Vehicles covered (none ticked means every vehicle)</span>
          <div className="gr-block__actions" style={{ gap: 6 }}>
            {VEHICLE_TYPES.map((v) => (
              <button key={v} type="button" className="gr-chip" aria-pressed={f.vehicle_types.includes(v)}
                onClick={() => toggle('vehicle_types', v, !f.vehicle_types.includes(v))}>{v}</button>
            ))}
          </div>
        </div>
      )}

      <div className="gr-grid2">
        <div className="gr-field"><label className="gr-label" htmlFor="pl-prem">You take home per person, per period (ICAN)</label>
          <input id="pl-prem" className="gr-input" type="number" inputMode="decimal" min="0" step="any" value={f.premium_ican} onChange={(e) => set({ premium_ican: e.target.value })} placeholder="e.g. 0.5" />
          <p className="gr-hint">This is exactly what is credited to your business wallet. Nothing is taken off it later.</p></div>
        <div className="gr-field"><label className="gr-label" htmlFor="pl-lim">Cover limit (ICAN)</label>
          <input id="pl-lim" className="gr-input" type="number" inputMode="decimal" min="0" step="any" value={f.cover_limit_ican} onChange={(e) => set({ cover_limit_ican: e.target.value })} placeholder="e.g. 50" />
          <p className="gr-hint">Priced in ICAN so it keeps its value. Customers see it in their own currency.</p></div>
      </div>
      <div className="gr-field"><label className="gr-label" htmlFor="pl-wait">Waiting period (days before cover starts)</label>
        <input id="pl-wait" className="gr-input" type="number" inputMode="numeric" min="0" max="90" value={f.waiting_days} onChange={(e) => set({ waiting_days: e.target.value })} /></div>

      <Switch checked={f.points_enabled} onChange={(on) => set({ points_enabled: on })}>Accept reward points. Customers can pay in points; you are credited the same ICAN.</Switch>

      <div className="gr-card gr-form">
        <div className="gr-field"><label className="gr-label" htmlFor="pl-disc">Discount for sharing data (up to {maxDataDiscount}%)</label>
          <input id="pl-disc" className="gr-input" type="number" inputMode="decimal" min="0" max={maxDataDiscount} step="any" value={f.data_discount_pct} onChange={(e) => set({ data_discount_pct: e.target.value })} />
          <p className="gr-hint">Reward customers who let you see their record. They stay in control and can stop any time.</p></div>
        {Number(f.data_discount_pct) > 0 && (
          <div className="gr-field"><span className="gr-label">The discount applies when they share</span>
            {SHARE_SCOPES.map((s) => <Switch key={s.id} checked={f.data_discount_scopes.includes(s.id)} onChange={(on) => toggle('data_discount_scopes', s.id, on)}>{s.label}</Switch>)}</div>
        )}
      </div>
      {f.audience.includes('rider') && (
        <div className="gr-field"><label className="gr-label" htmlFor="pl-grp">Group discount for companies insuring several drivers (%)</label>
          <input id="pl-grp" className="gr-input" type="number" inputMode="decimal" min="0" max="50" step="any" value={f.group_discount_pct} onChange={(e) => set({ group_discount_pct: e.target.value })} /></div>
      )}
      <div className="gr-field"><label className="gr-label" htmlFor="pl-url">Policy terms link (https, optional)</label>
        <input id="pl-url" className="gr-input" type="url" maxLength={300} value={f.terms_url} onChange={(e) => set({ terms_url: e.target.value })} placeholder="https://…" /></div>
      <Switch checked={f.active} onChange={(on) => set({ active: on })}>On sale. Switch off to stop new sales and renewals.</Switch>

      {error && <Alert tone="bad">{error}</Alert>}
      <button type="button" className="gr-btn gr-btn--primary gr-btn--block" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save plan'}</button>
    </Modal>
  );
}

export default function InsurerPlans({ insurer, rate }) {
  const [plans, setPlans] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // null | 'new' | plan
  const [flash, setFlash] = useState('');

  const load = useCallback(async () => {
    try { setPlans(await insuranceService.insurerPlans(insurer.insurer_id)); setError(''); } catch (e) { setError(e.message); setPlans([]); }
  }, [insurer.insurer_id]);
  useEffect(() => { load(); }, [load]);

  const maxDisc = plans?.[0]?.max_data_discount_pct ?? 30;
  const canEdit = insurer.is_admin && insurer.status !== 'suspended' && insurer.status !== 'rejected';

  const toggleActive = async (p) => {
    const res = await insuranceService.savePlan(insurer.insurer_id, p.plan_id, { ...p, active: !p.active, benefits: p.benefits, terms_url: p.terms_url || '' });
    if (res.success) load(); else setError(res.error);
  };

  return (
    <div className="gr-form">
      <div className="gr-sectionhead">
        <p className="gr-sub">The plans you sell. You set what you take home; customers see one price.</p>
        {canEdit && <button type="button" className="gr-btn gr-btn--primary gr-btn--sm" onClick={() => setEditing('new')}><Plus aria-hidden="true" />New plan</button>}
      </div>
      {insurer.status !== 'verified' && <Alert tone="warn">Customers can buy your plans only once ICANera has verified your licence. You can prepare plans now.</Alert>}
      {flash && <Alert tone="ok">{flash}</Alert>}
      {error && <Alert tone="bad">{error}</Alert>}

      {plans === null ? <div className="gr-skel" /> : plans.length === 0 ? (
        <div className="gr-card gr-empty"><p className="gr-sub">No plans yet. Create your first plan to start selling cover.</p></div>
      ) : (
        <div className="ins-plans">
          {plans.map((p) => (
            <article key={p.plan_id} className="gr-card ins-plan" style={p.active ? undefined : { opacity: 0.7 }}>
              <div className="ins-plan__top">
                <div style={{ minWidth: 0 }}>
                  <h4 className="ins-plan__name">{p.name}</h4>
                  <p className="ins-plan__by">{coverTypeLabel(p.cover_type)} · per {periodLabel(p.period_days)} · {p.audience.map((a) => AUDIENCES[a]?.label).join(', ')}</p>
                </div>
                <div className="ins-price">
                  <b>{formatIcan(p.premium_ican)}</b>
                  <span>you take home</span>
                  <small>customers see {formatIcan(p.customer_price_ican)}</small>
                </div>
              </div>
              <div className="ins-perks">
                <Chip tone={p.active ? 'ok' : 'muted'}>{p.active ? 'On sale' : 'Off sale'}</Chip>
                <Chip>{p.active_policies} active {p.active_policies === 1 ? 'policy' : 'policies'}</Chip>
                {p.points_enabled && <Chip tone="warn">Takes points</Chip>}
                {p.data_discount_pct > 0 && <Chip tone="ok">{p.data_discount_pct}% for sharing {p.data_discount_scopes.map((s) => scopeShort(s)).join(' + ')}</Chip>}
                {p.group_discount_pct > 0 && <Chip>{p.group_discount_pct}% group</Chip>}
              </div>
              <div className="ins-foot">
                <p className="gr-small">Cover limit <Money ican={p.cover_limit_ican} rate={rate} />{p.waiting_days > 0 && ` · ${p.waiting_days}-day wait`}</p>
                {canEdit && (
                  <div className="gr-block__actions" style={{ gap: 8 }}>
                    <button type="button" className="gr-btn gr-btn--ghost gr-btn--sm" onClick={() => setEditing(p)}><Pencil aria-hidden="true" />Edit</button>
                    <button type="button" className="gr-btn gr-btn--ghost gr-btn--sm" onClick={() => toggleActive(p)}>{p.active ? 'Take off sale' : 'Put on sale'}</button>
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      {editing && (
        <PlanForm
          insurer={insurer} plan={editing === 'new' ? null : editing} maxDataDiscount={maxDisc}
          onClose={() => setEditing(null)}
          onSaved={(msg) => { setEditing(null); setFlash(msg); load(); }}
        />
      )}
    </div>
  );
}

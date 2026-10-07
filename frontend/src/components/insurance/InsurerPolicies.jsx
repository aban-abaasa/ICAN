import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Eye, MessageSquare, Search } from 'lucide-react';
import { insuranceService } from '../../services/insuranceService';
import {
  coverTypeLabel, downloadCsv, fmtDate, formatIcan, scopeLabel, scopeShort, toCsv,
} from '../../utils/insuranceCatalog';
import { Alert, Chip, Modal, StatePill } from './common';
import { Messages } from './PolicyPanel';

const STATE_FILTERS = [
  { id: '', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'grace', label: 'Renew now' },
  { id: 'expired', label: 'Expired' },
];

const kindLabel = (k) => (k === 'rider' ? 'Rider' : k === 'business' ? 'Business' : 'Person');

// ── What the holder chose to share, read in one place ────────────────────────
function Kv({ rows }) {
  return <>{rows.filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => <div key={k} className="gr-kv"><span>{k}</span><b>{String(v)}</b></div>)}</>;
}
function MonthTable({ rows }) {
  if (!rows?.length) return <p className="gr-small">No activity in the last six months.</p>;
  return (
    <table>
      <thead><tr><th>Month</th><th>In (ICAN)</th><th>Out (ICAN)</th><th>Count</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.month}><td>{r.month}</td><td>{formatIcan(r.in_ican)}</td><td>{formatIcan(r.out_ican)}</td><td>{r.transactions}</td></tr>)}</tbody>
    </table>
  );
}

function DataRoom({ policy }) {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    let cancelled = false;
    insuranceService.policyData(policy.policy_id).then((res) => { if (!cancelled) setState({ loading: false, res }); });
    return () => { cancelled = true; };
  }, [policy.policy_id]);

  if (state.loading) return <div className="gr-skel" />;
  if (!state.res.success) return <Alert tone="bad">{state.res.error}</Alert>;
  const { data, shared_scopes: shared, holder_scopes: holderScopes, business_scopes: businessScopes } = state.res;
  const allScopes = ['identity', 'activity', 'compliance', 'finances', ...(policy.payer_business_id ? ['business_activity', 'business_finances'] : [])];
  const a = data.activity || {}; const c = data.compliance || {}; const id = data.identity || {}; const ba = data.business_activity || {};

  return (
    <div className="ins-data">
      <Alert>
        This view is recorded. {policy.insured_name} can see that you looked and at what. You only see what they chose to share:
        {' '}{shared.length ? shared.map((s) => scopeShort(s)).join(', ') : 'nothing beyond the policy itself'}.
      </Alert>
      <div className="gr-card"><Kv rows={[['Policy', state.res.policy.policy_number], ['Plan', state.res.policy.plan], ['Cover', coverTypeLabel(state.res.policy.cover_type)],
        ['Insured', state.res.policy.insured_name], ['Vehicle / label', state.res.policy.insured_label], ['Cover ends', fmtDate(state.res.policy.ends_at)]]} /></div>

      {data.identity && <section className="gr-card"><p className="gr-eyebrow">Who they are</p><Kv rows={[['Email', id.email], ['Vehicle', id.vehicle_type], ['Plate', id.plate_number], ['Model', id.model], ['Colour', id.colour], ['Licence', id.licence_masked]]} /></section>}
      {data.activity && <section className="gr-card"><p className="gr-eyebrow">Ride record</p>
        {Object.keys(a).length === 0 ? <p className="gr-small">No ride record yet.</p> : <Kv rows={[
          ['Rides finished, 30 days', a.rides_completed_30d], ['Rides finished, 90 days', a.rides_completed_90d], ['Rides finished, ever', a.rides_completed_total],
          ['Rides cancelled, 90 days', a.rides_cancelled_90d], ['Rating', a.rating], ['Riding since', a.member_since ? fmtDate(a.member_since) : null],
          ['Rides as a passenger, 90 days', a.rides_as_passenger_90d], ['Rides as a passenger, ever', a.rides_as_passenger_total]]} />}</section>}
      {data.compliance && <section className="gr-card"><p className="gr-eyebrow">Standing</p>
        {Object.keys(c).length === 0 ? <p className="gr-small">Not a rider, so there is no permit or card to show.</p> : <Kv rows={[
          ['Driving permit', c.permit_status ? String(c.permit_status).replace('_', ' ') : null], ['Permit expires', c.permit_expiry ? fmtDate(c.permit_expiry) : null],
          ['Rider account', c.rider_status], ['ID card', c.id_card ? String(c.id_card).replace('_', ' ') : 'none'], ['Commission owed (UGX)', c.commission_owed_ugx]]} />}</section>}
      {data.finances && <section className="gr-card"><p className="gr-eyebrow">Money, monthly totals</p><MonthTable rows={data.finances} /></section>}
      {data.business_activity && <section className="gr-card"><p className="gr-eyebrow">Fleet activity</p><Kv rows={[
        ['Drivers', ba.drivers], ['Drivers active', ba.drivers_active], ['Rides finished, 90 days', ba.rides_completed_90d], ['Rides cancelled, 90 days', ba.rides_cancelled_90d]]} /></section>}
      {data.business_finances && <section className="gr-card"><p className="gr-eyebrow">Business wallet, monthly totals</p><MonthTable rows={data.business_finances} /></section>}

      {allScopes.filter((s) => !shared.includes(s)).length > 0 && (
        <p className="gr-hint">Not shared: {allScopes.filter((s) => !shared.includes(s)).map((s) => scopeShort(s)).join(', ')}.
          {(holderScopes.length + businessScopes.length === 0) && ' Ask them in Messages if they would share more.'}</p>
      )}
    </div>
  );
}

function HolderModal({ policy, insurer, onClose, onChanged }) {
  const [tab, setTab] = useState('messages');
  return (
    <Modal title={policy.insured_name || policy.policy_number} eyebrow={`${policy.policy_number} · ${policy.plan}`} onClose={onClose}>
      <div className="ins-nav" role="tablist">
        <button type="button" role="tab" aria-pressed={tab === 'messages'} onClick={() => setTab('messages')}><MessageSquare aria-hidden="true" />Messages</button>
        <button type="button" role="tab" aria-pressed={tab === 'data'} onClick={() => setTab('data')}><Eye aria-hidden="true" />Shared data</button>
      </div>
      {tab === 'messages' && (
        <Messages
          policy={{ policy_id: policy.policy_id, insurer: { name: policy.insured_name || 'the policyholder' } }}
          intro={`Private between ${insurer.display_name} and ${policy.insured_name || 'the policyholder'}.`}
          emptyText="No messages yet. Write to the policyholder about renewals, claims or anything on the policy."
          onRead={onChanged}
        />
      )}
      {tab === 'data' && <DataRoom policy={policy} />}
    </Modal>
  );
}

// ── Policyholders ────────────────────────────────────────────────────────────
export function Policyholders({ insurer }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [state, setState] = useState('');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(null);

  const load = useCallback(async () => {
    try { setRows(await insuranceService.insurerPolicies(insurer.insurer_id, state || null)); setError(''); } catch (e) { setError(e.message); setRows([]); }
  }, [insurer.insurer_id, state]);
  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rows || []).filter((r) => !q || [r.insured_name, r.insured_label, r.policy_number, r.plan, r.payer_name, r.email].some((v) => v && String(v).toLowerCase().includes(q)));
  }, [rows, query]);

  const exportCsv = () => downloadCsv(`policyholders-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(visible, [
    { label: 'Policy', value: 'policy_number' }, { label: 'Status', value: 'state' }, { label: 'Insured', value: 'insured_name' },
    { label: 'Vehicle / label', value: 'insured_label' }, { label: 'Kind', value: (r) => kindLabel(r.insured_kind) }, { label: 'Plan', value: 'plan' },
    { label: 'Cover type', value: (r) => coverTypeLabel(r.cover_type) }, { label: 'Paid by', value: 'payer_name' },
    { label: 'Started', value: (r) => fmtDate(r.started_at) }, { label: 'Ends', value: (r) => fmtDate(r.ends_at) },
    { label: 'Auto renew', value: (r) => (r.auto_renew ? 'yes' : 'no') }, { label: 'Open claims', value: 'open_claims' },
    { label: 'Email (if shared)', value: 'email' }, { label: 'Data shared', value: (r) => r.shared_scopes.map(scopeLabel).join('; ') },
  ]));

  return (
    <div className="gr-form">
      <div className="gr-sectionhead">
        <p className="gr-sub">Everyone insured with {insurer.display_name}. Contact details and records appear only where the holder shared them.</p>
        <button type="button" className="gr-btn gr-btn--ghost gr-btn--sm" disabled={visible.length === 0} onClick={exportCsv}><Download aria-hidden="true" />Export</button>
      </div>
      <div className="gr-field">
        <label className="gr-sr" htmlFor="ph-q">Search policyholders</label>
        <div style={{ position: 'relative' }}>
          <Search aria-hidden="true" style={{ position: 'absolute', left: 12, top: 14, width: 16, height: 16, color: 'var(--gr-faint)' }} />
          <input id="ph-q" className="gr-input" style={{ paddingLeft: 36 }} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, plate, policy or business" />
        </div>
      </div>
      <div className="ins-nav" role="group" aria-label="Filter by status">
        {STATE_FILTERS.map((f) => <button key={f.id} type="button" aria-pressed={state === f.id} onClick={() => setState(f.id)}>{f.label}</button>)}
      </div>
      {error && <Alert tone="bad">{error}</Alert>}

      {rows === null ? <div className="gr-skel" /> : visible.length === 0 ? (
        <div className="gr-card gr-empty"><p className="gr-sub">{rows.length === 0 ? 'No policyholders yet.' : 'No policyholders match.'}</p></div>
      ) : (
        <div className="ins-rows">
          {visible.map((r) => (
            <div key={r.policy_id} className="ins-row">
              <div className="ins-row__top">
                <div style={{ minWidth: 0 }}>
                  <p className="ins-row__t">{r.insured_name}{r.insured_label && r.insured_kind !== 'person' ? ` · ${r.insured_label}` : ''}</p>
                  <p className="ins-row__m">{r.policy_number} · {r.plan} · {kindLabel(r.insured_kind)}{r.payer_kind === 'business' ? ` · paid by ${r.payer_name}` : ''}</p>
                </div>
                <StatePill state={r.state} />
              </div>
              <p className="ins-row__m">Ends {fmtDate(r.ends_at)}{r.auto_renew ? ' · renews automatically' : ''}{r.email ? ` · ${r.email}` : ''}</p>
              <div className="ins-perks">
                {r.shared_scopes.length > 0 ? <Chip tone="ok">Shares {r.shared_scopes.map((s) => scopeShort(s)).join(', ')}</Chip> : <Chip>Shares nothing</Chip>}
                {r.unread_from_holder > 0 && <Chip tone="warn">{r.unread_from_holder} new message{r.unread_from_holder === 1 ? '' : 's'}</Chip>}
                {r.open_claims > 0 && <Chip tone="warn">{r.open_claims} open claim{r.open_claims === 1 ? '' : 's'}</Chip>}
              </div>
              <div className="ins-row__acts"><button type="button" className="gr-btn gr-btn--ghost gr-btn--sm" onClick={() => setOpen(r)}>Open</button></div>
            </div>
          ))}
        </div>
      )}
      {open && <HolderModal policy={open} insurer={insurer} onClose={() => setOpen(null)} onChanged={load} />}
    </div>
  );
}

// ── Business clients ─────────────────────────────────────────────────────────
export function BusinessClients({ insurer }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    insuranceService.insurerClients(insurer.insurer_id).then((r) => { if (!cancelled) setRows(r); }).catch((e) => { if (!cancelled) { setError(e.message); setRows([]); } });
    return () => { cancelled = true; };
  }, [insurer.insurer_id]);

  const exportCsv = () => downloadCsv(`business-clients-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows || [], [
    { label: 'Business', value: 'business_name' }, { label: 'Policies', value: 'policies' }, { label: 'Active', value: 'active' },
    { label: 'Expiring in 30 days', value: 'expiring_30d' }, { label: 'Next renewal', value: (r) => (r.next_renewal ? fmtDate(r.next_renewal) : '') },
    { label: 'Open claims', value: 'open_claims' }, { label: 'Shares business data', value: (r) => (r.shared_business_data ? 'yes' : 'no') },
  ]));

  return (
    <div className="gr-form">
      <div className="gr-sectionhead">
        <p className="gr-sub">Companies that pay for cover with you: their drivers, their fleets, themselves.</p>
        <button type="button" className="gr-btn gr-btn--ghost gr-btn--sm" disabled={!rows?.length} onClick={exportCsv}><Download aria-hidden="true" />Export</button>
      </div>
      {error && <Alert tone="bad">{error}</Alert>}
      {rows === null ? <div className="gr-skel" /> : rows.length === 0 ? (
        <div className="gr-card gr-empty"><p className="gr-sub">No business clients yet. Plans for businesses and for drivers are what companies buy.</p></div>
      ) : (
        <div className="ins-rows">
          {rows.map((r) => (
            <div key={r.business_id} className="ins-row">
              <div className="ins-row__top"><p className="ins-row__t">{r.business_name}</p>{r.shared_business_data ? <Chip tone="ok">Shares business data</Chip> : <Chip>No business data shared</Chip>}</div>
              <div className="ins-stats">
                <div className="ins-stat"><b>{r.policies}</b><span>Policies</span></div>
                <div className="ins-stat"><b>{r.active}</b><span>Active</span></div>
                <div className={`ins-stat ${r.expiring_30d ? 'is-warn' : ''}`}><b>{r.expiring_30d}</b><span>Expiring in 30 days</span></div>
                <div className={`ins-stat ${r.open_claims ? 'is-warn' : ''}`}><b>{r.open_claims}</b><span>Open claims</span></div>
              </div>
              <p className="ins-row__m">{r.next_renewal ? `Next renewal ${fmtDate(r.next_renewal)}` : 'Nothing renewing soon'}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

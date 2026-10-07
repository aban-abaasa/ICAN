import React, { useCallback, useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { usePinPrompt } from '../PinPromptDialog';
import { insuranceService } from '../../services/insuranceService';
import {
  CLAIM_OPEN, CLAIM_STATUS, downloadCsv, fmtDate, formatIcan, friendlyPayError, toCsv,
} from '../../utils/insuranceCatalog';
import { Alert, Chip, Modal, Money } from './common';

const FILTERS = [{ id: 'open', label: 'Open' }, { id: 'all', label: 'All' }, { id: 'paid', label: 'Paid' }, { id: 'rejected', label: 'Rejected' }];

// One decision on one claim: ask for information, approve with an amount, reject with a reason, or pay it.
function ActionModal({ claim, action, isAdmin, rate, onClose, onDone }) {
  const { askPin, pinDialog } = usePinPrompt();
  const [note, setNote] = useState('');
  const [amount, setAmount] = useState(claim.amount_claimed_ican ? String(Math.min(claim.amount_claimed_ican, claim.cover_limit_ican)) : '');
  const [method, setMethod] = useState('wallet');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const titles = { review: 'Start review', info: 'Ask for information', approve: 'Approve claim', reject: 'Reject claim', pay: 'Pay claim', close: 'Close claim' };

  const submit = async () => {
    setError(''); setBusy(true);
    let res;
    if (action === 'pay') {
      if (method === 'wallet') {
        const pin = await askPin({ title: 'Business-wallet PIN', message: `Pay ${formatIcan(claim.approved_amount_ican)} ICAN for ${claim.claim_number}.` });
        if (pin === null) { setBusy(false); return; }
        res = await insuranceService.payClaim(claim.claim_id, { pin });
      } else {
        res = await insuranceService.payClaim(claim.claim_id, { offlineReference: reference });
      }
    } else {
      const status = { review: 'in_review', info: 'info_needed', approve: 'approved', reject: 'rejected', close: 'closed' }[action];
      res = await insuranceService.updateClaim(claim.claim_id, status, note || null, action === 'approve' ? Number(amount) : null);
    }
    setBusy(false);
    if (res.success) onDone(`${claim.claim_number}: ${titles[action].toLowerCase()} done.`); else setError(friendlyPayError(res.error));
  };

  const needsNote = action === 'info' || action === 'reject';
  const disabled = busy || (needsNote && note.trim().length < 5) || (action === 'approve' && !(Number(amount) > 0))
    || (action === 'pay' && method === 'offline' && reference.trim().length < 3);

  return (
    <Modal title={titles[action]} eyebrow={`${claim.claim_number} · ${claim.insured_name}`} onClose={onClose}>
      <p className="gr-sub">{claim.description}</p>
      <p className="gr-small">Happened {fmtDate(claim.incident_date)}{claim.amount_claimed_ican != null && <> · claimed <Money ican={claim.amount_claimed_ican} rate={rate} /></>} · cover limit <Money ican={claim.cover_limit_ican} rate={rate} /></p>

      {action === 'approve' && (
        <div className="gr-field"><label className="gr-label" htmlFor="ca-amt">Approved amount (ICAN, up to the cover limit)</label>
          <input id="ca-amt" className="gr-input" type="number" inputMode="decimal" min="0" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
      )}
      {action === 'pay' && (
        <>
          <Alert tone="ok">Approved: <Money ican={claim.approved_amount_ican} rate={rate} />. It goes straight to the policyholder&apos;s wallet, with no deduction.</Alert>
          <div className="gr-seg" role="radiogroup" aria-label="How to pay">
            <button type="button" role="radio" aria-checked={method === 'wallet'} onClick={() => setMethod('wallet')}>From the business wallet</button>
            <button type="button" role="radio" aria-checked={method === 'offline'} onClick={() => setMethod('offline')}>Paid another way</button>
          </div>
          {method === 'offline' && (
            <div className="gr-field"><label className="gr-label" htmlFor="ca-ref">Payment reference (bank or mobile-money receipt)</label>
              <input id="ca-ref" className="gr-input" maxLength={120} value={reference} onChange={(e) => setReference(e.target.value)} />
              <p className="gr-hint">Use this for payouts above your business-wallet approval limit.</p></div>
          )}
        </>
      )}
      {action !== 'pay' && (
        <div className="gr-field"><label className="gr-label" htmlFor="ca-note">{needsNote ? (action === 'reject' ? 'Reason (the policyholder sees this)' : 'What you need from them') : 'Note for the policyholder (optional)'}</label>
          <textarea id="ca-note" className="gr-textarea" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></div>
      )}
      {!isAdmin && (action === 'approve' || action === 'reject' || action === 'pay') && <Alert tone="warn">Only an owner or administrator can do this.</Alert>}
      {error && <Alert tone="bad">{error}</Alert>}
      <button type="button" className="gr-btn gr-btn--primary gr-btn--block" disabled={disabled || (!isAdmin && ['approve', 'reject', 'pay'].includes(action))} onClick={submit}>
        {busy ? 'Working…' : titles[action]}
      </button>
      {pinDialog}
    </Modal>
  );
}

export default function InsurerClaims({ insurer, rate }) {
  const [claims, setClaims] = useState(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('open');
  const [action, setAction] = useState(null);
  const [flash, setFlash] = useState('');

  const load = useCallback(async () => {
    try { setClaims(await insuranceService.insurerClaims(insurer.insurer_id)); setError(''); } catch (e) { setError(e.message); setClaims([]); }
  }, [insurer.insurer_id]);
  useEffect(() => { load(); }, [load]);

  const visible = (claims || []).filter((c) => (filter === 'all' ? true : filter === 'open' ? CLAIM_OPEN.includes(c.status) : c.status === filter));

  const exportCsv = () => downloadCsv(`claims-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(visible, [
    { label: 'Claim', value: 'claim_number' }, { label: 'Policy', value: 'policy_number' }, { label: 'Insured', value: 'insured_name' },
    { label: 'Plan', value: 'plan' }, { label: 'Happened', value: (c) => fmtDate(c.incident_date) }, { label: 'Filed', value: (c) => fmtDate(c.created_at) },
    { label: 'Status', value: (c) => CLAIM_STATUS[c.status]?.label }, { label: 'Claimed (ICAN)', value: 'amount_claimed_ican' },
    { label: 'Approved (ICAN)', value: 'approved_amount_ican' }, { label: 'Days open', value: 'age_days' },
  ]));

  return (
    <div className="gr-form">
      <div className="gr-sectionhead">
        <p className="gr-sub">Claims on your policies. Staff can review and ask for information; owners and administrators approve, reject and pay.</p>
        <button type="button" className="gr-btn gr-btn--ghost gr-btn--sm" disabled={visible.length === 0} onClick={exportCsv}><Download aria-hidden="true" />Export</button>
      </div>
      <div className="ins-nav" role="group" aria-label="Filter claims">
        {FILTERS.map((f) => <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>{f.label}</button>)}
      </div>
      {flash && <Alert tone="ok">{flash}</Alert>}
      {error && <Alert tone="bad">{error}</Alert>}

      {claims === null ? <div className="gr-skel" /> : visible.length === 0 ? (
        <div className="gr-card gr-empty"><p className="gr-sub">No claims here.</p></div>
      ) : (
        <div className="ins-rows">
          {visible.map((c) => {
            const meta = CLAIM_STATUS[c.status];
            const open = CLAIM_OPEN.includes(c.status);
            return (
              <div key={c.claim_id} className="ins-row">
                <div className="ins-row__top">
                  <div style={{ minWidth: 0 }}>
                    <p className="ins-row__t">{c.claim_number} · {c.insured_name}{c.insured_label ? ` · ${c.insured_label}` : ''}</p>
                    <p className="ins-row__m">{c.policy_number} · {c.plan} · happened {fmtDate(c.incident_date)} · filed {fmtDate(c.created_at)}{open ? ` · ${c.age_days} day${c.age_days === 1 ? '' : 's'} open` : ''}</p>
                  </div>
                  <Chip tone={meta.tone}>{meta.label}</Chip>
                </div>
                <p className="ins-row__m">{c.description}</p>
                <p className="ins-row__m">
                  {c.amount_claimed_ican != null && <>Claimed <Money ican={c.amount_claimed_ican} rate={rate} /> · </>}
                  limit <Money ican={c.cover_limit_ican} rate={rate} />
                  {c.approved_amount_ican != null && <> · approved <Money ican={c.approved_amount_ican} rate={rate} /></>}
                </p>
                {c.evidence_urls.length > 0 && (
                  <p className="ins-row__m">Evidence: {c.evidence_urls.map((u, i) => (/^https:\/\//i.test(u) ? <a key={u} className="gr-link" href={u} target="_blank" rel="noopener noreferrer">link {i + 1}</a> : null))}</p>
                )}
                {c.insurer_note && <p className="ins-row__m"><i>Your note: {c.insurer_note}</i></p>}
                {open && (
                  <div className="ins-row__acts">
                    {c.status === 'submitted' && <button type="button" className="gr-btn gr-btn--ghost gr-btn--sm" onClick={() => setAction({ claim: c, action: 'review' })}>Start review</button>}
                    {(c.status === 'submitted' || c.status === 'in_review') && <button type="button" className="gr-btn gr-btn--ghost gr-btn--sm" onClick={() => setAction({ claim: c, action: 'info' })}>Ask for information</button>}
                    {c.status !== 'approved' && <button type="button" className="gr-btn gr-btn--primary gr-btn--sm" onClick={() => setAction({ claim: c, action: 'approve' })}>Approve</button>}
                    {c.status !== 'approved' && <button type="button" className="gr-btn gr-btn--danger gr-btn--sm" onClick={() => setAction({ claim: c, action: 'reject' })}>Reject</button>}
                    {c.status === 'approved' && <button type="button" className="gr-btn gr-btn--primary gr-btn--sm" onClick={() => setAction({ claim: c, action: 'pay' })}>Pay</button>}
                    <button type="button" className="gr-btn gr-btn--ghost gr-btn--sm" onClick={() => setAction({ claim: c, action: 'close' })}>Close</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {action && (
        <ActionModal
          claim={action.claim} action={action.action} isAdmin={insurer.is_admin} rate={rate}
          onClose={() => setAction(null)}
          onDone={(msg) => { setAction(null); setFlash(msg); load(); }}
        />
      )}
    </div>
  );
}

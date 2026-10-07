import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronDown, FilePlus2, FileText, MessageSquare, Phone, RefreshCw, Send, Share2, ShieldAlert, ShieldCheck, Eye,
} from 'lucide-react';
import walletAccountService from '../../services/walletAccountService';
import { usePinPrompt } from '../PinPromptDialog';
import { getRewardPoints, insuranceService } from '../../services/insuranceService';
import {
  BUSINESS_SHARE_SCOPES, CLAIM_STATUS, SHARE_SCOPES, coverTypeLabel, fmtDate, fmtDateTime, formatIcan,
  friendlyPayError, periodLabel, renewWindowDays, scopeShort,
} from '../../utils/insuranceCatalog';
import { Alert, Chip, Modal, Money, ScopeSwitch, StatePill } from './common';
import { Switch } from '../profile/growth/parts';

const PAY_LABEL = {
  wallet: 'My ICAN wallet',
  points_first: 'Reward points first, then wallet',
  points_only: 'Reward points only',
};

// ── Messages ────────────────────────────────────────────────────────────────
// `intro` and `emptyText` let the insurer's desk reuse this thread with its own wording.
export function Messages({ policy, onRead, intro, emptyText }) {
  const [messages, setMessages] = useState(null);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);

  const load = useCallback(async () => {
    try {
      setMessages(await insuranceService.messages(policy.policy_id));
      setError('');
      onRead?.();
    } catch (e) { setError(e.message); }
  }, [policy.policy_id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }); }, [messages]);

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    const res = await insuranceService.postMessage(policy.policy_id, body);
    setBusy(false);
    if (res.success) { setText(''); load(); } else setError(res.error);
  };

  return (
    <div className="gr-form">
      <div className="gr-sectionhead">
        <p className="gr-small">{intro || `Private between you and ${policy.insurer.name}.`}</p>
        <button type="button" className="gr-link" onClick={load}>Refresh</button>
      </div>
      {error && <Alert tone="bad">{error}</Alert>}
      <div className="ins-thread" aria-live="polite">
        {messages === null ? <p className="gr-small">Loading…</p>
          : messages.length === 0 ? <p className="gr-small" style={{ textAlign: 'center' }}>{emptyText || `No messages yet. Ask ${policy.insurer.name} anything about your cover.`}</p>
            : messages.map((m) => (m.side === 'system'
              ? <p key={m.id} className="ins-msg ins-msg--system">{m.body}</p>
              : (
                <div key={m.id} className={`ins-msg ${m.mine ? 'is-mine' : ''}`}>
                  {!m.mine && <span className="ins-msg__who">{m.sender_name}</span>}
                  <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{m.body}</span>
                  <small>{fmtDateTime(m.created_at)}</small>
                </div>
              )))}
        <div ref={endRef} />
      </div>
      <form className="ins-compose" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea className="gr-textarea" rows={2} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a message" aria-label="Message" />
        <button type="submit" className="gr-btn gr-btn--primary" disabled={busy || !text.trim()} aria-label="Send"><Send aria-hidden="true" /></button>
      </form>
    </div>
  );
}

// ── Claims ──────────────────────────────────────────────────────────────────
const today = () => new Date().toISOString().slice(0, 10);

function Claims({ policy, rate, onChanged }) {
  const [claims, setClaims] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(today());
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [links, setLinks] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');

  const load = useCallback(async () => {
    try { setClaims(await insuranceService.myClaims(policy.policy_id)); setError(''); } catch (e) { setError(e.message); }
  }, [policy.policy_id]);
  useEffect(() => { load(); }, [load]);

  const canClaim = ['active', 'grace', 'expired'].includes(policy.state);

  const submit = async () => {
    const amountNum = amount.trim() === '' ? null : Number(amount);
    if (amountNum !== null && (!Number.isFinite(amountNum) || amountNum <= 0)) { setError('Enter the amount in ICAN, or leave it empty'); return; }
    setBusy(true); setError(''); setDone('');
    const res = await insuranceService.fileClaim({
      policyId: policy.policy_id, incidentDate: date, description, amount: amountNum,
      evidenceUrls: links.split('\n').map((l) => l.trim()).filter(Boolean),
    });
    setBusy(false);
    if (res.success) {
      setDone(`Claim ${res.claim_number} sent to ${policy.insurer.name}.`);
      setOpen(false); setDescription(''); setAmount(''); setLinks('');
      load(); onChanged?.();
    } else setError(res.error);
  };

  return (
    <div className="gr-form">
      {policy.insurer.claims_phone && (
        <a className="gr-alert" href={`tel:${policy.insurer.claims_phone.replace(/[^\d+]/g, '')}`}>
          <Phone aria-hidden="true" style={{ width: 16, height: 16, flex: 'none', marginTop: 2 }} />
          <span>Claims line: <b>{policy.insurer.claims_phone}</b></span>
        </a>
      )}
      {error && <Alert tone="bad">{error}</Alert>}
      {done && <Alert tone="ok">{done}</Alert>}

      {!open ? (
        <button type="button" className="gr-btn gr-btn--ghost" disabled={!canClaim} onClick={() => setOpen(true)}><FilePlus2 aria-hidden="true" />File a claim</button>
      ) : (
        <div className="gr-card gr-form">
          <div className="gr-field"><label className="gr-label" htmlFor="cl-date">When did it happen</label>
            <input id="cl-date" type="date" className="gr-input" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="gr-field"><label className="gr-label" htmlFor="cl-desc">What happened</label>
            <textarea id="cl-desc" className="gr-textarea" rows={3} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Tell it as it happened: where, who was involved, what was damaged or lost." /></div>
          <div className="gr-field"><label className="gr-label" htmlFor="cl-amt">Amount you are claiming (ICAN, optional)</label>
            <input id="cl-amt" type="number" inputMode="decimal" min="0" step="any" className="gr-input" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={`Up to ${formatIcan(policy.plan.cover_limit_ican)}`} />
            <p className="gr-hint">Your cover limit is <Money ican={policy.plan.cover_limit_ican} rate={rate} />.</p></div>
          <div className="gr-field"><label className="gr-label" htmlFor="cl-links">Photos or documents (links, one per line, optional)</label>
            <textarea id="cl-links" className="gr-textarea" rows={2} value={links} onChange={(e) => setLinks(e.target.value)} placeholder="https://…" /></div>
          <div className="gr-block__actions" style={{ gap: 8 }}>
            <button type="button" className="gr-btn gr-btn--ghost" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
            <button type="button" className="gr-btn gr-btn--primary" disabled={busy || description.trim().length < 10} onClick={submit}>{busy ? 'Sending…' : 'Send claim'}</button>
          </div>
        </div>
      )}

      {claims === null ? <p className="gr-small">Loading…</p> : claims.length === 0 ? <p className="gr-small" style={{ textAlign: 'center' }}>No claims on this policy.</p> : (
        <div className="ins-rows">
          {claims.map((c) => {
            const meta = CLAIM_STATUS[c.status];
            return (
              <div key={c.claim_id} className="ins-row">
                <div className="ins-row__top">
                  <div><p className="ins-row__t">{c.claim_number}</p><p className="ins-row__m">Happened {fmtDate(c.incident_date)} · sent {fmtDate(c.created_at)}</p></div>
                  <Chip tone={meta.tone}>{meta.label}</Chip>
                </div>
                <p className="ins-row__m">{c.description}</p>
                {c.amount_claimed_ican != null && <p className="ins-row__m">Claimed <Money ican={c.amount_claimed_ican} rate={rate} /></p>}
                {c.approved_amount_ican != null && <p className="ins-row__m" style={{ color: 'var(--gr-ok)' }}>Approved <Money ican={c.approved_amount_ican} rate={rate} /></p>}
                {c.insurer_note && <p className="ins-row__m"><i>{policy.insurer.name}: {c.insurer_note}</i></p>}
                {c.status === 'info_needed' && <p className="ins-row__m" style={{ color: 'var(--gr-warn)' }}>{policy.insurer.name} needs more information. Answer in Messages.</p>}
                {c.status === 'paid' && <p className="ins-row__m" style={{ color: 'var(--gr-ok)' }}>Paid {fmtDate(c.paid_at)}. See your wallet history.</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── What is shared, and who looked ──────────────────────────────────────────
function Sharing({ policy, mode, onChanged }) {
  const business = mode === 'business';
  const options = business ? BUSINESS_SHARE_SCOPES : SHARE_SCOPES;
  const saved = business ? policy.business_scopes : policy.holder_scopes;
  const [scopes, setScopes] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ tone: '', text: '' });
  const [log, setLog] = useState(null);

  useEffect(() => { setScopes(saved); }, [saved.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let cancelled = false;
    insuranceService.accessLog(policy.policy_id).then((l) => { if (!cancelled) setLog(l); }).catch(() => { if (!cancelled) setLog([]); });
    return () => { cancelled = true; };
  }, [policy.policy_id]);

  const dirty = [...scopes].sort().join('|') !== [...saved].sort().join('|');
  const toggle = (id, on) => setScopes((cur) => (on ? Array.from(new Set([...cur, id])) : cur.filter((s) => s !== id)));
  const discountScopes = policy.plan.data_discount_scopes;
  const discountOn = !business && policy.plan.data_discount_pct > 0 && discountScopes.every((s) => scopes.includes(s));
  const discountNames = discountScopes.map((s) => scopeShort(s)).join(' and ');

  const save = async () => {
    setBusy(true);
    const res = business ? await insuranceService.setBusinessConsent(policy.policy_id, scopes) : await insuranceService.setConsent(policy.policy_id, scopes);
    setBusy(false);
    if (res.success) { setMsg({ tone: 'ok', text: 'Saved.' }); onChanged?.(); } else setMsg({ tone: 'bad', text: res.error });
  };

  return (
    <div className="gr-form">
      <p className="gr-sub">
        {business ? `Choose what ${policy.insurer.name} can see about the business.` : `Choose what ${policy.insurer.name} can see about you.`}
        {' '}Nothing is shared unless you switch it on, and you can stop at any time.
      </p>
      {!business && policy.plan.data_discount_pct > 0 && (
        <Alert tone={discountOn ? 'ok' : 'warn'}>
          {discountOn ? `Sharing ${discountNames} saves you ${policy.plan.data_discount_pct}% when this cover renews.` : `Share ${discountNames} and pay ${policy.plan.data_discount_pct}% less when this cover renews.`}
        </Alert>
      )}
      {options.map((s) => <ScopeSwitch key={s.id} label={s.label} help={s.help} checked={scopes.includes(s.id)} onChange={(on) => toggle(s.id, on)} />)}
      {msg.text && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <button type="button" className="gr-btn gr-btn--primary" disabled={busy || !dirty} onClick={save}>{busy ? 'Saving…' : 'Save what I share'}</button>

      <div className="gr-field">
        <span className="gr-label"><Eye aria-hidden="true" style={{ width: 12, height: 12, display: 'inline', marginRight: 4 }} />Who looked</span>
        {log === null ? <p className="gr-small">Loading…</p> : log.length === 0 ? <p className="gr-small">{policy.insurer.name} has not looked at your shared data.</p> : (
          <div className="ins-rows">
            {log.map((e) => (
              <div key={`${e.at}-${e.insurer}`} className="ins-row">
                <div className="ins-row__top"><span className="ins-row__t">{e.insurer}</span><span className="gr-small">{fmtDateTime(e.at)}</span></div>
                <p className="ins-row__m">Looked at {e.scopes.map((s) => scopeShort(s)).join(', ')}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Renewing ────────────────────────────────────────────────────────────────
function RenewModal({ policy, userId, mode, rate, onClose, onDone }) {
  const { askPin, pinDialog } = usePinPrompt();
  const business = mode === 'business' || policy.payer_kind === 'business';
  const [pay, setPay] = useState('wallet');
  const [points, setPoints] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (business || !policy.plan.points_enabled) return;
    getRewardPoints(userId).then(setPoints);
  }, [business, policy.plan.points_enabled, userId]);

  const submit = async () => {
    setError('');
    const pin = await askPin({
      title: business ? 'Business-wallet PIN' : 'Confirm payment',
      message: `Renew ${policy.plan.name} for ${formatIcan(policy.renewal_price_ican)} ICAN.`,
    });
    if (pin === null) return;
    setBusy(true);
    try {
      if (!business) {
        const check = await walletAccountService.verifyUserPIN(userId, pin);
        if (!check?.success) { setError(check?.error || 'Incorrect transaction PIN.'); return; }
      }
      const res = await insuranceService.renew(policy.policy_id, business ? { pin } : { usePoints: pay !== 'wallet', pointsOnly: pay === 'points_only' });
      if (res.success) onDone(); else setError(friendlyPayError(res.error));
    } finally { setBusy(false); }
  };

  return (
    <Modal title="Renew cover" eyebrow={policy.plan.name} onClose={onClose}>
      <p className="gr-sub">{policy.insurer.name}. New cover starts when the current one ends{policy.state === 'active' || policy.state === 'waiting' ? ` (${fmtDate(policy.ends_at)})` : ''}.</p>
      <div className="gr-alert"><span>Price for {periodLabel(policy.plan.period_days)}: <Money ican={policy.renewal_price_ican} rate={rate} /></span></div>
      {!business && policy.plan.points_enabled && (
        <div className="gr-field">
          <label className="gr-label" htmlFor="rn-pay">Pay with</label>
          <select id="rn-pay" className="gr-select" value={pay} onChange={(e) => setPay(e.target.value)}>
            {Object.keys(PAY_LABEL).map((k) => <option key={k} value={k}>{PAY_LABEL[k]}</option>)}
          </select>
          <p className="gr-hint">You have {points === null ? '…' : points.toLocaleString()} points; this renewal is {Number(policy.renewal_points_cost || 0).toLocaleString()} points.</p>
        </div>
      )}
      {business && <p className="gr-hint">Paid from the business wallet.</p>}
      {error && <Alert tone="bad">{error}</Alert>}
      <button type="button" className="gr-btn gr-btn--primary gr-btn--block" disabled={busy} onClick={submit}>{busy ? 'Paying…' : 'Renew now'}</button>
      {pinDialog}
    </Modal>
  );
}

// ── One policy ──────────────────────────────────────────────────────────────
/** mode 'holder': the insured or paying person. mode 'business': a company managing cover it pays for. */
export default function PolicyPanel({ policy, userId, rate, mode = 'holder', onChanged, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const [tab, setTab] = useState('overview');
  const [renewing, setRenewing] = useState(false);
  const [payments, setPayments] = useState(null);
  const [auto, setAuto] = useState(policy.auto_renew);
  const [autoWith, setAutoWith] = useState(policy.renew_with);
  const [savingAuto, setSavingAuto] = useState(false);
  const [note, setNote] = useState({ tone: '', text: '' });

  const businessMode = mode === 'business';
  const isPayer = businessMode || policy.role === 'payer' || policy.role === 'both';
  const personalPayer = isPayer && policy.payer_kind === 'user';
  const lapsed = policy.state === 'expired' || policy.state === 'grace';
  const canRenew = isPayer && policy.state !== 'cancelled' && policy.plan.active && policy.days_left <= renewWindowDays(policy.plan.period_days);
  const sharingAllowed = businessMode || policy.role === 'insured' || policy.role === 'both';

  useEffect(() => { setAuto(policy.auto_renew); setAutoWith(policy.renew_with); }, [policy.auto_renew, policy.renew_with]);
  useEffect(() => {
    if (!open || tab !== 'overview' || !isPayer || payments !== null) return;
    insuranceService.payments(policy.policy_id).then(setPayments).catch(() => setPayments([]));
  }, [open, tab, isPayer, payments, policy.policy_id]);

  const saveAuto = async () => {
    setSavingAuto(true);
    const res = await insuranceService.setAutoRenew(policy.policy_id, auto, autoWith);
    setSavingAuto(false);
    setNote(res.success ? { tone: 'ok', text: auto ? 'Automatic renewal is on.' : 'Automatic renewal is off.' } : { tone: 'bad', text: res.error });
    if (res.success) onChanged();
  };
  const stopRenewing = async () => {
    if (!window.confirm(`Stop renewing this cover? It keeps protecting you until ${fmtDate(policy.ends_at)}.`)) return;
    const res = await insuranceService.stopRenewing(policy.policy_id);
    setNote(res.success ? { tone: 'ok', text: `Renewal stopped. Your cover runs until ${fmtDate(policy.ends_at)}.` } : { tone: 'bad', text: res.error });
    if (res.success) onChanged();
  };

  const tabs = [
    { id: 'overview', label: 'Cover', Icon: FileText },
    { id: 'messages', label: 'Messages', Icon: MessageSquare, badge: policy.unread_from_insurer },
    { id: 'claims', label: 'Claims', Icon: ShieldAlert, badge: policy.open_claims },
    { id: 'sharing', label: 'Sharing', Icon: Share2 },
  ];

  return (
    <article className="gr-card gr-form">
      <button type="button" className="gr-link" style={{ display: 'block', width: '100%', textAlign: 'left', textDecoration: 'none' }} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="ins-row__top" style={{ alignItems: 'center' }}>
          <span style={{ display: 'flex', gap: 12, alignItems: 'center', minWidth: 0 }}>
            <span className="gr-device__icon" style={{ color: lapsed ? 'var(--gr-warn)' : 'var(--gr-ok)' }}>{lapsed ? <ShieldAlert aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}</span>
            <span style={{ minWidth: 0 }}>
              <span className="ins-plan__name" style={{ display: 'block' }}>{policy.plan.name}</span>
              <span className="ins-row__m" style={{ display: 'block' }}>{policy.insurer.name} · {coverTypeLabel(policy.cover_type)}{policy.insured_label ? ` · ${policy.insured_label}` : ''}</span>
              <span className="ins-perks" style={{ marginTop: 6 }}>
                <StatePill state={policy.state} />
                <span className="gr-small">
                  {policy.state === 'waiting' ? `Starts ${fmtDate(policy.cover_starts_at)}`
                    : policy.state === 'expired' ? `Ended ${fmtDate(policy.ends_at)}`
                      : `Until ${fmtDate(policy.ends_at)}${policy.days_left <= 30 ? ` · ${policy.days_left} day${policy.days_left === 1 ? '' : 's'} left` : ''}`}
                </span>
                {policy.unread_from_insurer > 0 && <Chip tone="warn">{policy.unread_from_insurer} new</Chip>}
              </span>
            </span>
          </span>
          <ChevronDown aria-hidden="true" style={{ width: 18, height: 18, flex: 'none', color: 'var(--gr-gold-hi)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
        </span>
      </button>

      {open && (
        <>
          <div className="ins-nav" role="tablist">
            {tabs.map(({ id, label, Icon, badge }) => (
              <button key={id} type="button" role="tab" aria-pressed={tab === id} onClick={() => setTab(id)}>
                <Icon aria-hidden="true" />{label}{badge ? <span className="gr-badge">{badge}</span> : null}
              </button>
            ))}
          </div>

          {tab === 'overview' && (
            <div className="gr-form">
              {(businessMode || policy.payer_kind === 'business') && <p className="gr-small">Paid by <b>{policy.payer_name}</b>{policy.group_size > 1 ? ` as part of a group of ${policy.group_size}` : ''}.</p>}
              <dl className="ins-facts">
                <div className="ins-fact"><dt>Policy number</dt><dd style={{ fontFamily: 'monospace' }}>{policy.policy_number}</dd></div>
                <div className="ins-fact"><dt>Covers up to</dt><dd><Money ican={policy.plan.cover_limit_ican} rate={rate} /></dd></div>
                <div className="ins-fact"><dt>Cover began</dt><dd>{fmtDate(policy.cover_starts_at)}</dd></div>
                <div className="ins-fact"><dt>Ends</dt><dd>{fmtDate(policy.ends_at)}</dd></div>
                {policy.insured_label && <div className="ins-fact"><dt>Insured</dt><dd>{policy.insured_name} · {policy.insured_label}</dd></div>}
              </dl>
              {policy.plan.benefits.length > 0 && <ul className="ins-list">{policy.plan.benefits.map((b) => <li key={b}>{b}</li>)}</ul>}
              {policy.plan.terms_url && <a className="gr-link" href={policy.plan.terms_url} target="_blank" rel="noopener noreferrer">Read the policy terms</a>}
              {policy.last_renewal_error && personalPayer && <Alert tone="warn">Your last automatic renewal did not go through: {policy.last_renewal_error}</Alert>}
              {note.text && <Alert tone={note.tone}>{note.text}</Alert>}

              {canRenew && <button type="button" className={`gr-btn ${lapsed ? 'gr-btn--primary' : 'gr-btn--ghost'}`} onClick={() => setRenewing(true)}><RefreshCw aria-hidden="true" />Renew for {formatIcan(policy.renewal_price_ican)} ICAN</button>}
              {isPayer && !policy.plan.active && policy.state !== 'cancelled' && <Alert tone="warn">This plan is no longer on sale, so it cannot be renewed. Your cover runs until {fmtDate(policy.ends_at)}.</Alert>}

              {personalPayer && policy.state !== 'cancelled' && (
                <div className="gr-card gr-form">
                  <Switch checked={auto} onChange={setAuto}>Renew automatically, one day before it ends. Nothing is charged if the money or points are short.</Switch>
                  {auto && (
                    <select className="gr-select" value={autoWith} onChange={(e) => setAutoWith(e.target.value)} aria-label="Renew with">
                      {Object.keys(PAY_LABEL).filter((k) => k === 'wallet' || policy.plan.points_enabled).map((k) => <option key={k} value={k}>{PAY_LABEL[k]}</option>)}
                    </select>
                  )}
                  <div className="gr-block__actions" style={{ gap: 10 }}>
                    <button type="button" className="gr-btn gr-btn--ghost gr-btn--sm" disabled={savingAuto || (auto === policy.auto_renew && autoWith === policy.renew_with)} onClick={saveAuto}>{savingAuto ? 'Saving…' : 'Save'}</button>
                    {policy.auto_renew && <button type="button" className="gr-link" onClick={stopRenewing}>Stop renewing</button>}
                  </div>
                </div>
              )}
              {businessMode && policy.state !== 'cancelled' && <p className="gr-hint">A company renews with its business-wallet PIN each time, so nothing is ever charged without an administrator.</p>}

              {isPayer && payments && payments.length > 0 && (
                <div className="gr-field">
                  <span className="gr-label">Payments</span>
                  {payments.map((p) => (
                    <div key={p.at} className="gr-kv"><span>{fmtDate(p.at)} · {p.kind === 'purchase' ? 'Bought' : 'Renewed'}</span><b>{formatIcan(p.total_ican)} ICAN{p.points_used > 0 ? ` · ${Number(p.points_used).toLocaleString()} pts` : ''}</b></div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'messages' && <Messages policy={policy} onRead={onChanged} />}
          {tab === 'claims' && <Claims policy={policy} rate={rate} onChanged={onChanged} />}
          {tab === 'sharing' && (sharingAllowed
            ? <Sharing policy={policy} mode={businessMode ? 'business' : 'holder'} onChanged={onChanged} />
            : <Alert>{policy.insured_name} decides what of their own is shared with {policy.insurer.name}.</Alert>)}
        </>
      )}

      {renewing && <RenewModal policy={policy} userId={userId} mode={mode} rate={rate} onClose={() => setRenewing(false)} onDone={() => { setRenewing(false); setPayments(null); onChanged(); }} />}
    </article>
  );
}


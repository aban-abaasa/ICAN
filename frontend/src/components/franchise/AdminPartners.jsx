import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BadgeCheck, ChevronDown, ChevronUp, Copy, ExternalLink, MessageSquare, Plus, Save, Search, ShieldAlert, ShieldCheck } from 'lucide-react';
import {
  adminListPartners, adminMessagePartner, adminSavePartner, adminSendCode, adminSendPendingCodes, adminSetStatus, adminTerminate,
} from '../../services/franchiseService';
import { fetchLatestSupportConversation, fetchMessages, subscribeToMessages } from '../../services/chatService';
import { PARTNER_TYPES, PRODUCTS, STATUS_LABEL, buildAgencyLink, fmtIcan, isValidRegNumber, isSecureUrl } from '../../utils/franchise';
import { Badge, Btn, Empty, Field, Input, Section, Select, Textarea, Toggle, card, fmtDate, fmtDateTime, idleStyle, selectedStyle, toDateInput, useAction } from './adminUi';

const STATUS_TONE = { applied: 'amber', approved: 'blue', active: 'green', suspended: 'red', terminated: 'slate' };
const VERIFY_TONE = { pending: 'amber', verified: 'green', rejected: 'red' };
const typeLabel = (v) => PARTNER_TYPES.find((t) => t.value === v)?.label || v;

// The editable terms of a partner, as strings/booleans the form can hold.
const toDraft = (p) => ({
  display_name: p.display_name || '', company_name: p.company_name || '', company_reg_number: p.company_reg_number || '',
  company_reg_country: p.company_reg_country || '', company_document_url: p.company_document_url || '',
  company_status: p.company_status, kyc_status: p.kyc_status, region: p.region || '',
  products: p.products || [], exclusive: !!p.exclusive, parent_partner_id: p.parent_partner_id || '',
  share_adjust_pts: String(p.share_adjust_pts ?? 0), upfront_fee_ican: String(p.upfront_fee_ican ?? 0), fee_paid: !!p.upfront_fee_paid_at,
  min_annual_royalty_ican: String(p.min_annual_royalty_ican ?? 0), contract_start: toDateInput(p.contract_start), contract_end: toDateInput(p.contract_end),
  referral_window_months: String(p.referral_window_months ?? 12), notes: p.notes || '', owner_email: '',
});

/** Only what changed, shaped for ican_franchise_admin_save_partner. */
export function buildPatch(p, d) {
  const o = toDraft(p);
  const patch = {};
  const same = (k) => JSON.stringify(o[k]) === JSON.stringify(d[k]);
  ['display_name', 'company_name', 'company_reg_number', 'company_reg_country', 'company_status', 'kyc_status', 'region', 'notes', 'owner_email']
    .forEach((k) => { if (!same(k)) patch[k] = d[k]; });
  if (!same('company_document_url')) patch.company_document_url = d.company_document_url;
  if (!same('products')) patch.products = d.products;
  if (!same('exclusive')) patch.exclusive = d.exclusive;
  if (!same('parent_partner_id')) patch.parent_partner_id = d.parent_partner_id || '';
  if (!same('share_adjust_pts')) patch.share_adjust_pts = Number(d.share_adjust_pts);
  if (!same('upfront_fee_ican')) patch.upfront_fee_ican = Number(d.upfront_fee_ican);
  if (!same('fee_paid')) patch.upfront_fee_paid_at = d.fee_paid ? new Date().toISOString() : '';
  if (!same('min_annual_royalty_ican')) patch.min_annual_royalty_ican = Number(d.min_annual_royalty_ican);
  if (!same('contract_start')) patch.contract_start = d.contract_start || '';
  if (!same('contract_end')) patch.contract_end = d.contract_end || '';
  if (!same('referral_window_months')) patch.referral_window_months = Number(d.referral_window_months);
  return patch;
}

// The public address the share link points at (the same one the chat message carries).
const SHARE_ORIGIN = 'https://icanera.space';

function CopyBtn({ text, label, flash }) {
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); flash(`${label} copied`); }
    catch { flash('Copy is blocked by this browser. Select the text and copy it by hand.', true); }
  };
  return <button type="button" onClick={copy} aria-label={`Copy ${label}`} title={`Copy ${label}`} className="inline-flex items-center rounded-lg border p-1" style={{ borderColor: 'var(--dp-pill-bd)', color: 'var(--dp-sub)' }}><Copy size={11} /></button>;
}

/** The partner's Support chat thread, read live, with a box for support to write to them. */
function PartnerThread({ p, flash }) {
  const [conv, setConv] = useState(undefined);   // undefined = loading, null = no thread yet
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState('');
  const [busy, run] = useAction(flash);

  const load = useCallback(async () => {
    const c = await fetchLatestSupportConversation(p.owner_user_id).catch(() => null);
    setConv(c);
    setMsgs(c ? (await fetchMessages(c.id)).slice(-12) : []);
    return c;
  }, [p.owner_user_id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!conv?.id) return undefined;
    return subscribeToMessages(conv.id, (m) => setMsgs((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m].slice(-12))));
  }, [conv?.id]);

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    const res = await run('msg', () => adminMessagePartner(p.id, body), `Sent to ${p.owner_email || 'the partner'}'s Support chat, with a notification.`);
    if (res.ok) { setText(''); await load(); }
  };

  return (
    <div className="rounded-xl border p-3" style={{ background: 'var(--dp-inner)', borderColor: 'var(--dp-inner-bd)' }}>
      <p className="mb-2 text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--dp-muted)' }}>Message this partner</p>
      <div className="mb-2 max-h-52 space-y-1.5 overflow-y-auto">
        {conv === undefined && <p className="text-xs" style={{ color: 'var(--dp-muted)' }}>Loading the conversation...</p>}
        {conv === null && <p className="text-xs" style={{ color: 'var(--dp-muted)' }}>No conversation yet. Your first message starts it in their Support chat.</p>}
        {msgs.map((m) => {
          const fromTeam = m.sender_role === 'dev';
          return (
            <div key={m.id} className={`flex ${fromTeam ? 'justify-end' : 'justify-start'}`}>
              <div className="max-w-[85%] rounded-xl border px-2.5 py-1.5 text-xs" style={fromTeam ? { backgroundImage: 'linear-gradient(rgba(2,132,199,0.14), rgba(2,132,199,0.14))', borderColor: 'rgba(2,132,199,0.35)', color: 'var(--dp-txt)' } : { borderColor: 'var(--dp-inner-bd)', color: 'var(--dp-txt)' }}>
                <p className="whitespace-pre-wrap break-words">{m.body}</p>
                <p className="mt-0.5 text-[10px]" style={{ color: 'var(--dp-muted)' }}>{fromTeam ? (m.sender_name || 'Team') : (m.sender_name || 'Partner')} · {fmtDateTime(m.created_at)}</p>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <Textarea rows={2} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Write to the partner (they are notified, and their reply shows here and in the Messages inbox)" aria-label="Message to the partner" />
        </div>
        <Btn kind="primary" busy={busy === 'msg'} disabled={!text.trim()} onClick={send}><MessageSquare size={12} /> Send message</Btn>
      </div>
    </div>
  );
}

function PartnerCard({ p, all, open, onToggle, flash, onChanged }) {
  const [d, setD] = useState(() => toDraft(p));
  const [busy, run] = useAction(flash);
  const [terminating, setTerminating] = useState(false);
  const [successor, setSuccessor] = useState('');
  const [reason, setReason] = useState('');
  const [codeNote, setCodeNote] = useState('');
  useEffect(() => { setD(toDraft(p)); }, [p]);

  const patch = useMemo(() => buildPatch(p, d), [p, d]);
  const dirty = Object.keys(patch).length > 0;
  const set = (k) => (e) => setD((x) => ({ ...x, [k]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e }));
  const toggleProduct = (v) => setD((x) => ({ ...x, products: x.products.includes(v) ? x.products.filter((y) => y !== v) : [...x.products, v] }));

  const masters = all.filter((m) => m.partner_type === 'country_master' && m.country_code === p.country_code && m.status !== 'terminated' && m.id !== p.id);
  const successors = all.filter((m) => m.partner_type !== 'country_master' && m.country_code === p.country_code && m.status === 'active' && m.id !== p.id);

  const save = async () => {
    if (d.company_reg_number && !isValidRegNumber(d.company_reg_number)) return flash('That company registration number does not look right.', true);
    if (d.company_document_url && !isSecureUrl(d.company_document_url)) return flash('The certificate link must start with https://', true);
    const res = await run('save', () => adminSavePartner(p.id, patch), 'Saved');
    if (res.ok) onChanged();
  };
  const setStatus = async (status, msg) => {
    const res = await run(`st:${status}`, () => adminSetStatus(p.id, status), msg);
    if (res.ok) onChanged();
  };
  const quickVerify = async (field, value) => {
    const res = await run(`v:${field}`, () => adminSavePartner(p.id, { [field]: value }), value === 'verified' ? 'Marked verified' : `Marked ${value}`);
    if (res.ok) onChanged();
  };
  const sendCode = async () => {
    const res = await run('code', () => adminSendCode(p.id, codeNote.trim() || null),
      () => `Code ${p.partner_code} sent to ${p.owner_email || 'the owner'}'s Support chat, with a notification.`);
    if (res.ok) { setCodeNote(''); onChanged(); }
  };
  const terminate = async () => {
    const res = await run('term', () => adminTerminate(p.id, successor || null, reason || null), (r) => `Terminated. ${r?.customers_moved || 0} customer(s) moved${successor ? '' : ' to the country master / HQ'}.`);
    if (res.ok) { setTerminating(false); onChanged(); }
  };

  const companyOk = p.company_status === 'verified';
  const kycOk = p.kyc_status === 'verified';
  const canSendCode = ['applied', 'approved', 'active'].includes(p.status) && !!p.owner_email;
  const codeUnsent = ['approved', 'active'].includes(p.status) && !!p.owner_email && !p.code_sent_at;

  return (
    <div className="rounded-2xl border" style={card}>
      <button type="button" onClick={onToggle} className="flex w-full flex-wrap items-center gap-2 p-4 text-left" aria-expanded={open}>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-black" style={{ color: 'var(--dp-txt)' }}>
            {p.company_name}
            <Badge tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status]}</Badge>
            <Badge tone="violet">{typeLabel(p.partner_type)}</Badge>
            <Badge tone="slate">{p.country_code}</Badge>
            {p.partner_type === 'agency' && <Badge tone="blue">{p.tier}</Badge>}
            {p.status !== 'terminated' && !companyOk && <Badge tone={VERIFY_TONE[p.company_status]} title="Company registration not verified">Company: {p.company_status}</Badge>}
            {codeUnsent && <Badge tone="amber" title="The partner has not been sent their franchise code yet">Code not sent</Badge>}
            {p.status !== 'terminated' && !kycOk && <Badge tone={VERIFY_TONE[p.kyc_status]} title="KYC not verified">KYC: {p.kyc_status}</Badge>}
          </p>
          <p className="mt-0.5 text-[11px]" style={{ color: 'var(--dp-sub)' }}>
            <span className="font-mono">{p.partner_code}</span> · {p.owner_email || 'no owner account'}
            {p.parent_name && <> · under {p.parent_name}</>}
            {' '}· {p.assigned_accounts} customer(s){p.active_accounts != null && <> ({p.active_accounts} paying)</>}
            {' '}· owed {fmtIcan(p.accrued_ican)} ICAN
          </p>
        </div>
        {open ? <ChevronUp size={16} style={{ color: 'var(--dp-muted)' }} /> : <ChevronDown size={16} style={{ color: 'var(--dp-muted)' }} />}
      </button>

      {open && (
        <div className="space-y-5 border-t p-4" style={{ borderColor: 'var(--dp-card-bd)' }}>
          {/* Verification checklist: both must be green before a partner can go live. */}
          <div className="rounded-xl border p-3" style={{ background: 'var(--dp-inner)', borderColor: 'var(--dp-inner-bd)' }}>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--dp-muted)' }}>Before this partner can go live</p>
            <div className="grid gap-2 md:grid-cols-2">
              <div className="flex items-center justify-between gap-2 rounded-lg border p-2.5" style={{ borderColor: 'var(--dp-inner-bd)' }}>
                <div className="text-xs" style={{ color: 'var(--dp-txt)' }}>
                  <p className="flex items-center gap-1.5 font-bold">{companyOk ? <ShieldCheck size={14} className="text-emerald-500" /> : <ShieldAlert size={14} className="text-amber-500" />} Registered company</p>
                  <p style={{ color: 'var(--dp-sub)' }}>{p.company_name} · <span className="font-mono">{p.company_reg_number}</span> · {p.company_reg_country}</p>
                  {p.company_document_url
                    ? <a href={p.company_document_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sky-500 underline decoration-dotted">View certificate <ExternalLink size={10} /></a>
                    : <span style={{ color: 'var(--dp-muted)' }}>No certificate link supplied. Check the registry yourself.</span>}
                  {p.company_verified_at && <p style={{ color: 'var(--dp-muted)' }}>Verified {fmtDate(p.company_verified_at)}</p>}
                </div>
                <div className="flex flex-col gap-1">
                  {!companyOk && <Btn kind="green" busy={busy === 'v:company_status'} onClick={() => quickVerify('company_status', 'verified')}>Verify</Btn>}
                  {p.company_status !== 'rejected' && <Btn kind="danger" busy={busy === 'v:company_status'} onClick={() => quickVerify('company_status', 'rejected')}>Reject</Btn>}
                </div>
              </div>
              <div className="flex items-center justify-between gap-2 rounded-lg border p-2.5" style={{ borderColor: 'var(--dp-inner-bd)' }}>
                <div className="text-xs" style={{ color: 'var(--dp-txt)' }}>
                  <p className="flex items-center gap-1.5 font-bold">{kycOk ? <ShieldCheck size={14} className="text-emerald-500" /> : <ShieldAlert size={14} className="text-amber-500" />} Owners and directors checked (KYC)</p>
                  <p style={{ color: 'var(--dp-sub)' }}>Status: {p.kyc_status}</p>
                </div>
                {!kycOk && <Btn kind="green" busy={busy === 'v:kyc_status'} onClick={() => quickVerify('kyc_status', 'verified')}>Verify</Btn>}
              </div>
            </div>
          </div>

          {/* Franchise code: goes to the partner's Support chat automatically on approval; this sends it by hand. */}
          {p.status !== 'terminated' && (
            <div className="rounded-xl border p-3" style={{ background: 'var(--dp-inner)', borderColor: 'var(--dp-inner-bd)' }}>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--dp-muted)' }}>Franchise code</p>
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-0 flex-1 text-xs" style={{ color: 'var(--dp-txt)' }}>
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-base font-black tracking-wide">{p.partner_code}</span>
                    <CopyBtn text={p.partner_code} label="franchise code" flash={flash} />
                    {p.code_sent_at ? <Badge tone="green">Sent</Badge> : <Badge tone="amber">Not sent</Badge>}
                  </p>
                  {p.partner_type !== 'country_master' && (
                    <p className="mt-1 flex flex-wrap items-center gap-1.5">
                      <span style={{ color: 'var(--dp-muted)' }}>Share link</span>
                      <span className="break-all font-mono">{buildAgencyLink(p.partner_code, SHARE_ORIGIN)}</span>
                      <CopyBtn text={buildAgencyLink(p.partner_code, SHARE_ORIGIN)} label="share link" flash={flash} />
                    </p>
                  )}
                  {p.follow_up_code && (
                    <p className="mt-1 flex flex-wrap items-center gap-1.5">
                      <span style={{ color: 'var(--dp-muted)' }}>Follow-up code</span>
                      <span className="font-mono font-bold">{p.follow_up_code}</span>
                      <CopyBtn text={p.follow_up_code} label="follow-up code" flash={flash} />
                    </p>
                  )}
                  <p className="mt-1" style={{ color: 'var(--dp-sub)' }}>
                    {!p.owner_email
                      ? 'No owner account yet. Add the owner account email below, and the code is sent automatically once the partner is approved.'
                      : p.code_sent_at
                        ? `Sent to ${p.owner_email}'s Support chat ${p.code_sent_mode === 'auto' ? 'automatically' : 'by HQ'} on ${fmtDateTime(p.code_sent_at)}${p.code_sent_count > 1 ? ` (${p.code_sent_count} times)` : ''}.`
                        : p.status === 'applied'
                          ? 'Goes to their Support chat automatically when you approve the application. You can also send it now.'
                          : 'Not sent yet. Send it now.'}
                  </p>
                </div>
                {canSendCode && (
                  <div className="flex min-w-[16rem] flex-1 flex-wrap items-end gap-2">
                    <div className="min-w-0 flex-1">
                      <Input value={codeNote} maxLength={500} onChange={(e) => setCodeNote(e.target.value)} placeholder="Optional note to the partner" aria-label="Optional note to the partner" />
                    </div>
                    <Btn kind="primary" busy={busy === 'code'} onClick={sendCode}><MessageSquare size={12} /> {p.code_sent_at ? 'Send again' : 'Send code'}</Btn>
                  </div>
                )}
              </div>
            </div>
          )}

          {p.status !== 'terminated' && p.owner_user_id && <PartnerThread p={p} flash={flash} />}

          {/* Lifecycle */}
          <div className="flex flex-wrap items-center gap-2">
            {p.status === 'applied' && <Btn kind="primary" busy={busy === 'st:approved'} onClick={() => setStatus('approved', 'Approved')}><BadgeCheck size={12} /> Approve application</Btn>}
            {p.status === 'approved' && <Btn kind="green" busy={busy === 'st:active'} onClick={() => setStatus('active', 'Partner is live')}>Go live</Btn>}
            {p.status === 'active' && <Btn kind="danger" busy={busy === 'st:suspended'} onClick={() => setStatus('suspended', 'Suspended: no new revenue share accrues')}>Suspend</Btn>}
            {p.status === 'suspended' && <Btn kind="green" busy={busy === 'st:active'} onClick={() => setStatus('active', 'Resumed')}>Resume</Btn>}
            {p.status !== 'terminated' && <Btn kind="danger" onClick={() => setTerminating((v) => !v)}>Terminate...</Btn>}
            {(p.status === 'applied' || p.status === 'approved') && <span className="text-[11px]" style={{ color: 'var(--dp-muted)' }}>Going live needs both checks above.</span>}
          </div>

          {terminating && (
            <div className="space-y-3 rounded-xl border border-red-500/30 bg-red-500/5 p-3">
              <p className="text-xs font-bold text-red-500">Terminating ends this partner's earnings for good. Their customers are never orphaned.</p>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Move their customers to" hint="Or leave empty: fees then go to the country master / HQ.">
                  <Select value={successor} onChange={(e) => setSuccessor(e.target.value)} className="w-full">
                    <option value="">No successor (country master / HQ)</option>
                    {successors.map((s) => <option key={s.id} value={s.id}>{s.company_name} ({typeLabel(s.partner_type)})</option>)}
                  </Select>
                </Field>
                <Field label="Reason (kept in the audit log)"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
              </div>
              <div className="flex gap-2">
                <Btn kind="danger" busy={busy === 'term'} onClick={terminate}>Confirm termination</Btn>
                <Btn onClick={() => setTerminating(false)}>Cancel</Btn>
              </div>
            </div>
          )}

          {/* Company & contact */}
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Registered company name"><Input value={d.company_name} onChange={set('company_name')} /></Field>
            <Field label="Registration number"><Input value={d.company_reg_number} onChange={set('company_reg_number')} /></Field>
            <Field label="Registered in (ISO code)"><Input value={d.company_reg_country} maxLength={2} onChange={(e) => set('company_reg_country')(e.target.value.toUpperCase())} /></Field>
            <Field label="Trading / display name"><Input value={d.display_name} onChange={set('display_name')} /></Field>
            <Field label="Certificate link (https)"><Input value={d.company_document_url} onChange={set('company_document_url')} placeholder="https://..." /></Field>
            <Field label="Region / city"><Input value={d.region} onChange={set('region')} /></Field>
            <Field label="Company check"><Select value={d.company_status} onChange={set('company_status')} className="w-full"><option value="pending">Pending</option><option value="verified">Verified</option><option value="rejected">Rejected</option></Select></Field>
            <Field label="KYC"><Select value={d.kyc_status} onChange={set('kyc_status')} className="w-full"><option value="pending">Pending</option><option value="verified">Verified</option><option value="rejected">Rejected</option></Select></Field>
            <Field label="Owner account email" hint={p.owner_email ? `Currently ${p.owner_email}` : 'Needed so they can open their console'}><Input type="email" value={d.owner_email} onChange={set('owner_email')} placeholder={p.owner_email || 'person@company.com'} /></Field>
          </div>

          {/* Terms */}
          <Section title="Licence and terms">
            <div className="mb-4 flex flex-wrap gap-2">
              {PRODUCTS.map((pr) => (
                <button key={pr.value} type="button" aria-pressed={d.products.includes(pr.value)} onClick={() => toggleProduct(pr.value)}
                  className="rounded-full border px-3 py-1 text-xs font-bold transition"
                  style={d.products.includes(pr.value) ? selectedStyle : idleStyle}>
                  {pr.label}
                </button>
              ))}
              <span className="self-center text-[11px]" style={{ color: 'var(--dp-muted)' }}>A partner only earns on products it is licensed for.</span>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {p.partner_type !== 'country_master' && (
                <Field label="Parent country master" hint="Empty = serves directly under HQ">
                  <Select value={d.parent_partner_id} onChange={set('parent_partner_id')} className="w-full">
                    <option value="">None (under HQ)</option>
                    {masters.map((m) => <option key={m.id} value={m.id}>{m.company_name}</option>)}
                  </Select>
                </Field>
              )}
              {p.partner_type === 'agency' && (
                <Field label="Quality adjustment (points)" hint="+ rewards, - penalises. Bounded in Settings.">
                  <Input type="number" step="0.5" value={d.share_adjust_pts} onChange={set('share_adjust_pts')} />
                </Field>
              )}
              {p.partner_type === 'referral' && (
                <Field label="Referral window (months)"><Input type="number" min="1" max="60" value={d.referral_window_months} onChange={set('referral_window_months')} /></Field>
              )}
              <Field label="Upfront fee (ICAN)"><Input type="number" step="any" min="0" value={d.upfront_fee_ican} onChange={set('upfront_fee_ican')} /></Field>
              {p.partner_type === 'country_master' && (
                <Field label="Minimum annual royalty (ICAN)" hint={`HQ royalty, last 12 months: ${fmtIcan(p.hq_royalty_12m_ican)}`}>
                  <Input type="number" step="any" min="0" value={d.min_annual_royalty_ican} onChange={set('min_annual_royalty_ican')} />
                </Field>
              )}
              <Field label="Contract start"><Input type="date" value={d.contract_start} onChange={set('contract_start')} /></Field>
              <Field label="Contract end"><Input type="date" value={d.contract_end} onChange={set('contract_end')} /></Field>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Toggle label="Upfront fee received" hint="Tick once the fee has actually been paid." checked={d.fee_paid} onChange={(v) => setD((x) => ({ ...x, fee_paid: v }))} />
              {p.partner_type === 'country_master' && <Toggle label="Exclusive for this country" hint="No other country master can be approved here while this is on." checked={d.exclusive} onChange={(v) => setD((x) => ({ ...x, exclusive: v }))} />}
            </div>
            <Field label="Internal notes" className="mt-4"><Textarea rows={2} value={d.notes} onChange={set('notes')} /></Field>
            <div className="mt-4 flex items-center justify-end gap-2">
              {dirty && <span className="text-[11px]" style={{ color: 'var(--dp-muted)' }}>Unsaved changes</span>}
              <Btn kind="primary" disabled={!dirty} busy={busy === 'save'} onClick={save}><Save size={12} /> Save changes</Btn>
            </div>
          </Section>
        </div>
      )}
    </div>
  );
}

function AddPartner({ flash, onCreated }) {
  const [open, setOpen] = useState(false);
  const blank = { partner_type: 'agency', country_code: 'UG', company_name: '', company_reg_number: '', company_reg_country: '', owner_email: '' };
  const [f, setF] = useState(blank);
  const [busy, run] = useAction(flash);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const create = async () => {
    if (f.company_name.trim().length < 2) return flash('Enter the registered company name.', true);
    if (!isValidRegNumber(f.company_reg_number)) return flash('Enter a valid company registration number.', true);
    const res = await run('add', () => adminSavePartner(null, { ...f, country_code: f.country_code.toUpperCase(), company_reg_country: (f.company_reg_country || f.country_code).toUpperCase() }), 'Partner created (approved, not yet live)');
    if (res.ok) { setF(blank); setOpen(false); onCreated(); }
  };
  if (!open) return <Btn kind="primary" onClick={() => setOpen(true)}><Plus size={12} /> Add a partner</Btn>;
  return (
    <Section title="Add a partner you have already signed" hint="They must still be a registered company. They start as Approved; verify them, then go live.">
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Type"><Select value={f.partner_type} onChange={set('partner_type')} className="w-full">{PARTNER_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</Select></Field>
        <Field label="Country (ISO code)"><Input value={f.country_code} maxLength={2} onChange={(e) => setF((x) => ({ ...x, country_code: e.target.value.toUpperCase() }))} /></Field>
        <Field label="Owner account email"><Input type="email" value={f.owner_email} onChange={set('owner_email')} /></Field>
        <Field label="Registered company name"><Input value={f.company_name} onChange={set('company_name')} /></Field>
        <Field label="Registration number"><Input value={f.company_reg_number} onChange={set('company_reg_number')} /></Field>
        <Field label="Registered in (blank = same)"><Input value={f.company_reg_country} maxLength={2} onChange={(e) => setF((x) => ({ ...x, company_reg_country: e.target.value.toUpperCase() }))} /></Field>
      </div>
      <div className="mt-4 flex gap-2"><Btn kind="primary" busy={busy === 'add'} onClick={create}>Create partner</Btn><Btn onClick={() => setOpen(false)}>Cancel</Btn></div>
    </Section>
  );
}

/** Partners: verify the company, approve, go live, edit terms, terminate. */
export default function AdminPartners({ flash, onChanged, focusStatus }) {
  const [rows, setRows] = useState(null);
  const [status, setStatusF] = useState(focusStatus || '');
  const [type, setType] = useState('');
  const [country, setCountry] = useState('');
  const [openId, setOpenId] = useState(null);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    try { setRows(await adminListPartners({ status: status || null, type: type || null, country: country || null })); }
    catch (e) { flash(e.message, true); setRows([]); }
  }, [status, type, country, flash]);
  useEffect(() => { load(); }, [load]);
  const changed = () => { load(); onChanged?.(); };
  const [bulkBusy, runBulk] = useAction(flash);
  const unsent = (rows || []).filter((r) => ['approved', 'active'].includes(r.status) && r.owner_email && !r.code_sent_at).length;
  const sendPending = async () => {
    const res = await runBulk('bulk', adminSendPendingCodes, (r) =>
      `Codes sent to ${r?.sent || 0} partner(s)${r?.failed ? `, ${r.failed} could not be delivered` : ''}${r?.no_owner_account ? `, ${r.no_owner_account} have no owner account yet` : ''}.`);
    if (res.ok) changed();
  };
  const countries = useMemo(() => [...new Set((rows || []).map((r) => r.country_code))].sort(), [rows]);
  // Find a partner by what they quote to support: follow-up code, franchise code, company, owner email.
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return (rows || []).filter((r) => [r.follow_up_code, r.partner_code, r.company_name, r.display_name, r.owner_email]
      .some((v) => String(v || '').toLowerCase().includes(q)));
  }, [rows, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem]">
          <Search size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--dp-muted)' }} />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Follow-up code, franchise code, company, email" aria-label="Find a partner" className="!py-1.5 !pl-7 !text-xs" />
        </div>
        <Select value={status} onChange={(e) => setStatusF(e.target.value)}>
          <option value="">All statuses</option>
          {Object.keys(STATUS_LABEL).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </Select>
        <Select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All types</option>
          {PARTNER_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </Select>
        <Select value={country} onChange={(e) => setCountry(e.target.value)}>
          <option value="">All countries</option>
          {countries.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {unsent > 0 && <Btn busy={bulkBusy === 'bulk'} onClick={sendPending}><MessageSquare size={12} /> Send codes to {unsent} partner{unsent === 1 ? '' : 's'} who {unsent === 1 ? 'has' : 'have'} none</Btn>}
          <AddPartner flash={flash} onCreated={changed} />
        </div>
      </div>

      {rows === null && <Empty>Loading...</Empty>}
      {rows?.length === 0 && <Empty>No partners match. Convert a request, or add one you have signed.</Empty>}
      {rows?.length > 0 && shown?.length === 0 && <Empty>Nobody matches "{search}".</Empty>}
      {shown?.map((p) => (
        <PartnerCard key={p.id} p={p} all={rows} open={openId === p.id} onToggle={() => setOpenId(openId === p.id ? null : p.id)} flash={flash} onChanged={changed} />
      ))}
    </div>
  );
}

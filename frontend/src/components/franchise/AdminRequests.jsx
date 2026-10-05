import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle, XCircle, UserCheck, Ban, Building2, Phone, Mail, Copy } from 'lucide-react';
import { adminListEnquiries, adminSetEnquiryStatus, adminConvertEnquiry } from '../../services/franchiseService';
import { PARTNER_TYPES, PRODUCTS } from '../../utils/franchise';
import { Badge, Btn, Empty, Input, Select, fmtDateTime, useAction } from './adminUi';
import { card, idleStyle, selectedStyle } from './adminUi';

const FILTERS = [['new', 'New'], ['contacted', 'Contacted'], ['converted', 'Converted'], ['declined', 'Declined'], ['spam', 'Spam'], ['', 'All']];
const STATUS_TONE = { new: 'amber', contacted: 'blue', converted: 'green', declined: 'slate', spam: 'red' };
const typeLabel = (v) => PARTNER_TYPES.find((t) => t.value === v)?.label || v;
const productLabel = (v) => PRODUCTS.find((p) => p.value === v)?.label || v;

/** Inbox of landing-page franchise requests. Convert turns one into a partner application. */
export default function AdminRequests({ flash, onChanged, goToPartners }) {
  const [filter, setFilter] = useState('new');
  const [rows, setRows] = useState(null);
  const [notes, setNotes] = useState({});
  const [busy, run] = useAction(flash);

  const load = useCallback(async () => {
    try { setRows(await adminListEnquiries(filter || null)); }
    catch (e) { flash(e.message, true); setRows([]); }
  }, [filter, flash]);
  useEffect(() => { load(); }, [load]);

  const setStatus = async (r, status) => {
    const res = await run(`${r.id}:${status}`, () => adminSetEnquiryStatus(r.id, status, notes[r.id] || null), `Marked ${status}`);
    if (res.ok) { load(); onChanged?.(); }
  };
  const convert = async (r) => {
    const res = await run(`${r.id}:convert`, () => adminConvertEnquiry(r.id), 'Converted: now an application under Partners');
    if (res.ok) { load(); onChanged?.(); goToPartners?.(); }
  };
  const copy = (text) => { try { navigator.clipboard?.writeText(text); flash('Copied'); } catch { /* clipboard blocked */ } };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map(([v, l]) => (
          <button key={l} onClick={() => setFilter(v)} className="rounded-full border px-3 py-1 text-xs font-bold transition"
            style={filter === v ? selectedStyle : idleStyle} aria-pressed={filter === v}>
            {l}
          </button>
        ))}
      </div>

      {rows === null && <Empty>Loading...</Empty>}
      {rows?.length === 0 && <Empty>No {filter || ''} requests.</Empty>}

      {rows?.map((r) => (
        <div key={r.id} className="rounded-2xl border p-4" style={card}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-sm font-black" style={{ color: 'var(--dp-txt)' }}>
                <Building2 size={14} /> {r.company_name}
                <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
                {r.has_account ? <Badge tone="green">Has account</Badge> : <Badge tone="amber" title="They must sign up with this email before you can convert">No account yet</Badge>}
                {r.territory_status ? <Badge tone={r.territory_status === 'paused' ? 'red' : 'blue'}>{r.country_code}: {r.territory_status}</Badge> : <Badge tone="red" title="Open this country under Countries & rates">{r.country_code}: not opened</Badge>}
              </p>
              <p className="mt-1 text-xs" style={{ color: 'var(--dp-sub)' }}>
                Reg. no. <button className="font-mono underline decoration-dotted" onClick={() => copy(r.company_reg_number)} title="Copy">{r.company_reg_number}</button>
                {r.company_reg_country !== r.country_code && <> (registered in {r.company_reg_country})</>}
                {' '}· wants to be <b>{typeLabel(r.partner_type)}</b> for {(r.products || []).map(productLabel).join(', ')}
                {r.clients_estimate != null && <> · serves ~{r.clients_estimate} businesses</>}
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" style={{ color: 'var(--dp-sub)' }}>
                <span>{r.full_name}</span>
                <a href={`mailto:${r.email}`} className="inline-flex items-center gap-1 underline decoration-dotted"><Mail size={11} />{r.email}</a>
                {r.phone && <a href={`tel:${r.phone}`} className="inline-flex items-center gap-1 underline decoration-dotted"><Phone size={11} />{r.phone}</a>}
                <button className="inline-flex items-center gap-1" onClick={() => copy(r.email)} title="Copy email"><Copy size={11} /></button>
                <span>{fmtDateTime(r.created_at)}</span>
              </p>
              {r.message && <p className="mt-2 whitespace-pre-wrap rounded-xl border p-2.5 text-xs" style={{ background: 'var(--dp-inner)', borderColor: 'var(--dp-inner-bd)', color: 'var(--dp-txt)' }}>{r.message}</p>}
              {r.admin_note && <p className="mt-1 text-[11px] italic" style={{ color: 'var(--dp-muted)' }}>Note: {r.admin_note}</p>}
            </div>
          </div>

          {r.status !== 'converted' && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Input placeholder="Optional note" value={notes[r.id] || ''} onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))} className="!w-56 !py-1.5 !text-xs" />
              <Btn kind="quiet" busy={busy === `${r.id}:contacted`} onClick={() => setStatus(r, 'contacted')}><UserCheck size={12} /> Contacted</Btn>
              <Btn kind="green" busy={busy === `${r.id}:convert`} onClick={() => convert(r)} title={r.has_account ? '' : 'They need an IcanEra account with this email first'}><CheckCircle size={12} /> Convert to application</Btn>
              <Btn kind="danger" busy={busy === `${r.id}:declined`} onClick={() => setStatus(r, 'declined')}><XCircle size={12} /> Decline</Btn>
              <Btn kind="quiet" busy={busy === `${r.id}:spam`} onClick={() => setStatus(r, 'spam')}><Ban size={12} /> Spam</Btn>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

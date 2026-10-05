import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle, FileText, RefreshCw } from 'lucide-react';
import {
  adminApproveStatement, adminBackfill, adminGenerateStatements, adminListStatements, adminMarkStatementPaid,
  adminRetryErrors, adminVoidEvent, adminVoidStatement,
} from '../../services/franchiseService';
import { STREAM_LABEL, fmtIcan } from '../../utils/franchise';
import { Badge, Btn, Empty, Field, Input, Section, Select, Tile, fmtDate, fmtDateTime, useAction, ymd } from './adminUi';
import { card } from './adminUi';

const STATUS_TONE = { draft: 'amber', approved: 'blue', paid: 'green', void: 'slate' };

function lastMonth() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  return [ymd(start), ymd(end)];
}

/** Statements: generate for a period, approve, record the transfer reference, void. Moves no money itself. */
export function AdminPayouts({ flash, onChanged }) {
  const [[from, to], setRange] = useState(lastMonth);
  const [filter, setFilter] = useState('');
  const [rows, setRows] = useState(null);
  const [refs, setRefs] = useState({});
  const [busy, run] = useAction(flash);

  const load = useCallback(async () => { try { setRows(await adminListStatements(filter || null)); } catch (e) { flash(e.message, true); setRows([]); } }, [filter, flash]);
  useEffect(() => { load(); }, [load]);
  const after = (res) => { if (res.ok) { load(); onChanged?.(); } };

  const generate = async () => after(await run('gen', () => adminGenerateStatements(from, to),
    (r) => (r?.statements ? `${r.statements} statement(s) created, ${fmtIcan(r.total_ican)} ICAN in total` : 'Nothing new to put on a statement for that period')));
  const approve = async (s) => after(await run(`a:${s.id}`, () => adminApproveStatement(s.id), 'Approved'));
  const pay = async (s) => {
    const ref = (refs[s.id] || '').trim();
    if (ref.length < 4) return flash('Enter the transfer reference first (at least 4 characters).', true);
    if (!window.confirm(`Record ${fmtIcan(s.total_ican)} ICAN as PAID to ${s.partner_name} with reference ${ref}? Only do this after the money has actually been sent.`)) return;
    after(await run(`p:${s.id}`, () => adminMarkStatementPaid(s.id, ref), 'Recorded as paid'));
  };
  const voidIt = async (s) => { if (window.confirm('Void this statement? Its amounts return to the partner\'s unpaid balance.')) after(await run(`v:${s.id}`, () => adminVoidStatement(s.id), 'Voided')); };

  return (
    <div className="space-y-4">
      <Section title="Create statements" hint="Gathers each partner's unpaid earnings in the period into one statement. Nothing is paid by creating one.">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="From"><Input type="date" value={from} onChange={(e) => setRange([e.target.value, to])} /></Field>
          <Field label="To"><Input type="date" value={to} onChange={(e) => setRange([from, e.target.value])} /></Field>
          <Btn kind="primary" busy={busy === 'gen'} onClick={generate} disabled={!from || !to || to < from}><FileText size={12} /> Create statements</Btn>
        </div>
        <p className="mt-3 text-[11px]" style={{ color: 'var(--dp-muted)' }}>
          A partner whose net total is zero or negative (a refund after they were paid) is skipped and carried into a later statement.
          Pay each approved statement from the HQ platform-fee wallet or your bank, then record the transfer reference here. A reference can be used once.
        </p>
      </Section>

      <div className="flex items-center gap-2">
        <Select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="">All statements</option><option value="draft">Draft</option><option value="approved">Approved, to pay</option><option value="paid">Paid</option><option value="void">Void</option></Select>
        <Btn onClick={load}><RefreshCw size={11} /> Refresh</Btn>
      </div>

      {rows === null && <Empty>Loading...</Empty>}
      {rows?.length === 0 && <Empty>No statements yet.</Empty>}
      {rows?.map((s) => (
        <div key={s.id} className="rounded-2xl border p-4" style={card}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="flex flex-wrap items-center gap-2 text-sm font-black" style={{ color: 'var(--dp-txt)' }}>
                {s.partner_name} <Badge tone="slate">{s.country_code}</Badge> <Badge tone={STATUS_TONE[s.status]}>{s.status}</Badge>
              </p>
              <p className="text-[11px]" style={{ color: 'var(--dp-sub)' }}>
                <span className="font-mono">{s.partner_code}</span> · {fmtDate(s.period_start)} to {fmtDate(s.period_end)} · {s.line_count} line(s)
                {s.payment_reference && <> · ref <span className="font-mono">{s.payment_reference}</span> on {fmtDateTime(s.paid_at)}</>}
              </p>
            </div>
            <p className="text-lg font-black" style={{ color: 'var(--dp-txt)' }}>{fmtIcan(s.total_ican)} <span className="text-xs font-bold" style={{ color: 'var(--dp-muted)' }}>ICAN</span></p>
          </div>
          {(s.status === 'draft' || s.status === 'approved') && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {s.status === 'draft' && <Btn kind="primary" busy={busy === `a:${s.id}`} onClick={() => approve(s)}><CheckCircle size={12} /> Approve</Btn>}
              {s.status === 'approved' && (
                <>
                  <Input placeholder="Transfer reference (after sending the money)" value={refs[s.id] || ''} onChange={(e) => setRefs((r) => ({ ...r, [s.id]: e.target.value }))} className="!w-72 !py-1.5 !text-xs" />
                  <Btn kind="green" busy={busy === `p:${s.id}`} onClick={() => pay(s)}>Mark as paid</Btn>
                </>
              )}
              <Btn kind="danger" busy={busy === `v:${s.id}`} onClick={() => voidIt(s)}>Void</Btn>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** Health: what the engine could not allocate, where fees are earned with no partner, and revenue by country. */
export function AdminHealth({ overview, flash, onChanged }) {
  const [busy, run] = useAction(flash);
  const [days, setDays] = useState('30');
  const [ev, setEv] = useState({ id: '', reason: '' });
  const o = overview || {};
  const l = o.last_30d || {};
  const gaps = o.demand_gaps || [];
  const byCountry = o.by_country_30d || [];
  const byStream = o.by_stream_30d || [];

  const retry = async () => { const r = await run('retry', () => adminRetryErrors(), (x) => `${x?.resolved || 0} resolved, ${x?.still_failing || 0} still failing`); if (r.ok) onChanged(); };
  const backfill = async () => {
    const since = new Date(Date.now() - Math.max(1, Number(days) || 30) * 86400000).toISOString();
    const r = await run('bf', () => adminBackfill(since), (x) => `${x?.scanned || 0} fee(s) scanned, ${x?.allocated || 0} newly shared`);
    if (r.ok) onChanged();
  };
  const voidEvent = async () => {
    if (!ev.id.trim() || ev.reason.trim().length < 3) return flash('Enter the event id and a reason.', true);
    const r = await run('ve', () => adminVoidEvent(ev.id.trim(), ev.reason.trim()), 'Allocation voided');
    if (r.ok) { setEv({ id: '', reason: '' }); onChanged(); }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Fees shared, 30 days" value={`${fmtIcan(l.gross_ican)} ICAN`} sub={`${l.events || 0} fee event(s)`} />
        <Tile label="HQ kept" value={`${fmtIcan(l.hq_ican)} ICAN`} color="#10b981" />
        <Tile label="Country masters" value={`${fmtIcan(l.master_ican)} ICAN`} />
        <Tile label="Agencies and referrals" value={`${fmtIcan(l.agency_ican)} ICAN`} />
      </div>

      <Section title="Needs attention" hint="A fee is always credited to HQ first. If sharing it failed, it is parked here and can be retried safely.">
        <div className="flex flex-wrap items-center gap-3">
          {o.open_errors > 0
            ? <Badge tone="red"><AlertTriangle size={10} /> {o.open_errors} allocation(s) failed</Badge>
            : <Badge tone="green"><CheckCircle size={10} /> Nothing failed</Badge>}
          <Btn kind="primary" disabled={!o.open_errors} busy={busy === 'retry'} onClick={retry}><RefreshCw size={11} /> Retry failed</Btn>
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <Field label="Pick up fees from the last (days)" hint="For fees credited before the franchise layer was on, or while it was off. Safe to repeat."><Input type="number" min="1" max="365" value={days} onChange={(e) => setDays(e.target.value)} className="!w-28" /></Field>
          <Btn busy={busy === 'bf'} onClick={backfill}>Share missed fees</Btn>
        </div>
      </Section>

      <Section title="Where fees arrive with no partner" hint="Last 3 months. Recruit here next: the platform already earns in these places.">
        {gaps.length === 0 ? <p className="text-xs" style={{ color: 'var(--dp-muted)' }}>Every fee is currently covered by a partner, or none have arrived.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs" style={{ color: 'var(--dp-txt)' }}>
              <thead><tr style={{ color: 'var(--dp-muted)' }}><th className="py-1 text-left">Country</th><th className="text-left">Stream</th><th className="text-right">Fees</th><th className="text-right">ICAN</th></tr></thead>
              <tbody>{gaps.map((g) => (
                <tr key={`${g.country_code}${g.stream}`} className="border-t" style={{ borderColor: 'var(--dp-sep)' }}>
                  <td className="py-1.5 font-bold">{g.country_code}</td><td>{STREAM_LABEL[g.stream] || g.stream}</td><td className="text-right">{g.events}</td><td className="text-right">{fmtIcan(g.gross_ican)}</td>
                </tr>))}</tbody>
            </table>
          </div>
        )}
      </Section>

      <div className="grid gap-4 md:grid-cols-2">
        <Section title="By country, 30 days">
          {byCountry.length === 0 ? <p className="text-xs" style={{ color: 'var(--dp-muted)' }}>No shared fees yet.</p> : byCountry.map((c) => (
            <div key={c.country_code} className="flex justify-between border-t py-1.5 text-xs first:border-0" style={{ borderColor: 'var(--dp-sep)', color: 'var(--dp-txt)' }}>
              <span className="font-bold">{c.country_code}</span><span>{fmtIcan(c.gross_ican)} ICAN · HQ {fmtIcan(c.hq_ican)} · partners {fmtIcan(c.partners_ican)}</span>
            </div>
          ))}
        </Section>
        <Section title="By stream, 30 days">
          {byStream.length === 0 ? <p className="text-xs" style={{ color: 'var(--dp-muted)' }}>No shared fees yet.</p> : byStream.map((c) => (
            <div key={c.stream} className="flex justify-between border-t py-1.5 text-xs first:border-0" style={{ borderColor: 'var(--dp-sep)', color: 'var(--dp-txt)' }}>
              <span className="font-bold">{STREAM_LABEL[c.stream] || c.stream}</span><span>{fmtIcan(c.gross_ican)} ICAN · {c.events} fee(s)</span>
            </div>
          ))}
        </Section>
      </div>

      <Section title="Void one allocation" hint="For a fee refunded outside the normal reversal path. Unpaid amounts are cancelled; amounts already paid become a deduction on the next statement.">
        <div className="grid items-end gap-3 md:grid-cols-[1.4fr_1.6fr_auto]">
          <Field label="Revenue event id"><Input value={ev.id} onChange={(e) => setEv((x) => ({ ...x, id: e.target.value }))} placeholder="uuid" /></Field>
          <Field label="Reason"><Input value={ev.reason} onChange={(e) => setEv((x) => ({ ...x, reason: e.target.value }))} /></Field>
          <Btn kind="danger" busy={busy === 've'} onClick={voidEvent}>Void</Btn>
        </div>
      </Section>
    </div>
  );
}

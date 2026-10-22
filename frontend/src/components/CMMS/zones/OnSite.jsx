import React, { useCallback, useEffect, useState } from 'react';
import { Download, Loader, RefreshCw } from 'lucide-react';
import { cmmsZoneAccessService } from '../../../services/cmmsZoneAccessService';
import { downloadCsv } from '../csv';
import { duration, ugx, vehicleLabel, when } from './zoneLabels';

// Who is inside right now, the gate log, and what the zone earned. Read-only: anyone with a Transport action can see it.
const STATUS_TEXT = { inside: 'Inside', exited: 'Left', denied: 'Refused', cancelled: 'No payment', awaiting_payment: 'Waiting to pay' };
const BASIS_TEXT = { member: 'Approved', paid: 'Paid', day_pass: 'Day pass', open: 'Free class', ride_pass: 'Ride pass' };

export default function OnSite({ zone, businessProfileId, canEdit, refreshKey = 0 }) {
  const [view, setView] = useState('inside');
  const [visits, setVisits] = useState([]);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [settling, setSettling] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [list, summary] = await Promise.all([
      cmmsZoneAccessService.visits(zone.id, view === 'inside' ? 'inside' : 'log', view === 'inside' ? 200 : 300),
      cmmsZoneAccessService.report(zone.id, 30),
    ]);
    setError(list.error || '');
    setVisits(list.data?.visits || []);
    setReport(summary.data || null);
    setLoading(false);
  }, [zone.id, view]);

  useEffect(() => { load(); }, [load, refreshKey]);

  // The "inside" list is a live board: keep it fresh while it is open.
  useEffect(() => {
    if (view !== 'inside') return undefined;
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, [view, load]);

  const settle = async () => {
    setSettling(true); setMessage(''); setError('');
    const { data, error: settleError } = await cmmsZoneAccessService.settleOwed(businessProfileId);
    setSettling(false);
    if (settleError) { setError(settleError); return; }
    setMessage(data.still_owed > 0
      ? `Settled ${data.settled}. ${data.still_owed} still owed: top up the business wallet and try again.`
      : data.settled > 0 ? `Settled ${data.settled} cash fee${data.settled === 1 ? '' : 's'} with IcanEra.` : 'Nothing was owed.');
    load();
  };

  const exportLog = () => downloadCsv(`${zone.name.replace(/\W+/g, '-')}-gate-log.csv`, visits.map((v) => ({
    Time: v.entered_at || v.requested_at, Status: STATUS_TEXT[v.status] || v.status, Plate: v.plate_number || '', Vehicle: v.vehicle_type || '',
    Rider: v.rider_name || '', Card: v.card_number || '', Access: BASIS_TEXT[v.access_basis] || '', Fee_due_UGX: v.fee_due_ugx, Fee_paid_UGX: v.fee_paid_ugx,
    Paid_by: v.payment_method || '', Charged_to: v.ride_id && v.fee_due_ugx > 0 ? (v.passed_on_at || v.payer === 'customer' ? 'customer' : 'rider (customer owes)') : (v.fee_due_ugx > 0 ? 'rider' : ''),
    IcanEra_fee_UGX: v.platform_fee_ugx, Gate_in: v.gate_in || '', Gate_out: v.gate_out || '',
    Left: v.exited_at || '', Note: v.reason || '',
  })));

  const stat = (label, value, sub) => (
    <div className="rounded-xl border p-3" style={{ borderColor: 'var(--color-border)' }}>
      <p className="text-xs cmms-classic-muted">{label}</p>
      <p className="text-lg font-bold cmms-classic-heading">{value}</p>
      {sub && <p className="text-xs cmms-classic-muted">{sub}</p>}
    </div>
  );

  return (
    <div className="space-y-4">
      {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm cmms-tone-bad">{error}</p>}
      {message && <p className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm cmms-tone-ok">{message}</p>}

      {report && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {stat('Entries, 30 days', report.entries, `${report.member_entries} approved · ${report.paid_entries} paid`)}
          {stat('Refused', report.refused)}
          {stat('Collected', ugx(report.collected_ugx), `wallet ${ugx(report.wallet_ugx)} · cash ${ugx(report.cash_ugx)}`)}
          {stat('You receive', ugx(report.net_to_business_ugx), `IcanEra ${ugx(report.platform_fee_ugx)}`)}
        </div>
      )}
      {report?.platform_fee_owed_ugx > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm cmms-tone-warn">
          <span>{ugx(report.platform_fee_owed_ugx)} of IcanEra's share on cash fees is still owed. It is taken from the business wallet when it has the balance.</span>
          {canEdit && <button type="button" disabled={settling} onClick={settle} className="cmms-classic-btn-primary flex items-center gap-1.5 px-3 py-1.5 text-xs">{settling && <Loader size={13} className="animate-spin" />} Settle now</button>}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1.5">
          {[{ id: 'inside', label: 'Inside now' }, { id: 'log', label: 'Gate log' }].map((t) => (
            <button key={t.id} type="button" onClick={() => setView(t.id)} aria-pressed={view === t.id}
              className={`${view === t.id ? 'cmms-classic-btn-primary' : 'cmms-classic-btn-secondary'} px-3 py-1.5 text-xs`}>{t.label}</button>
          ))}
        </div>
        <div className="flex gap-1.5">
          {view === 'log' && visits.length > 0 && <button type="button" onClick={exportLog} className="cmms-classic-btn-secondary flex items-center gap-1.5 px-3 py-1.5 text-xs"><Download size={13} /> CSV</button>}
          <button type="button" onClick={load} className="cmms-info-btn" title="Refresh" aria-label="Refresh"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
        </div>
      </div>

      {loading && visits.length === 0 ? (
        <p className="flex items-center gap-2 text-sm cmms-classic-muted"><Loader size={15} className="animate-spin" /> Loading…</p>
      ) : visits.length === 0 ? (
        <p className="text-sm cmms-classic-muted">{view === 'inside' ? 'No vehicle is inside right now.' : 'Nothing has been scanned at this zone yet.'}</p>
      ) : (
        <ul className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
          {visits.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5" style={{ borderColor: 'var(--color-border)' }}>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-bold cmms-classic-heading !font-mono">{v.plate_number || (v.card_number ? `Card ${v.card_number}` : 'Unknown card')}</span>
                  <span className="cmms-classic-chip">{STATUS_TEXT[v.status] || v.status}</span>
                  {v.access_basis && <span className="cmms-classic-chip">{BASIS_TEXT[v.access_basis]}</span>}
                  {v.ride_id && v.fee_due_ugx > 0 && <span className="cmms-classic-chip">{v.passed_on_at || v.payer === 'customer' ? 'Customer paid' : 'On a ride'}</span>}
                  {v.overstaying && <span className="cmms-classic-chip" style={{ color: '#b91c1c' }}>Over the time limit</span>}
                </p>
                <p className="truncate text-xs cmms-classic-muted">
                  {[v.rider_name, v.vehicle_type && vehicleLabel(v.vehicle_type)].filter(Boolean).join(' · ')}
                  {v.status === 'inside' ? ` · in ${when(v.entered_at)} · ${duration(v.minutes_inside)}` : v.exited_at ? ` · ${when(v.entered_at)} → ${when(v.exited_at)}` : ` · ${when(v.requested_at || v.entered_at)}`}
                  {v.gate_in ? ` · ${v.gate_in}` : ''}
                </p>
                {(v.status === 'denied' || v.status === 'cancelled') && v.reason && <p className="text-xs cmms-tone-bad">{v.reason}</p>}
              </div>
              <div className="text-right text-xs cmms-classic-muted">
                {v.fee_due_ugx > 0 && <p className="font-semibold cmms-classic-heading">{ugx(v.fee_paid_ugx)} / {ugx(v.fee_due_ugx)}</p>}
                {v.payment_method && <p>{v.payment_method === 'cash' ? 'Cash' : 'IcanEra wallet'}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

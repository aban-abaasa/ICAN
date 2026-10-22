import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Ban, CheckCircle2, Info, Loader, XCircle, ScanLine, ShieldCheck, Wallet, X } from 'lucide-react';
import { cmmsZoneAccessService } from '../../../services/cmmsZoneAccessService';
import { clock, duration, ugx, vehicleLabel } from './zoneLabels';

// The gate desk: scan a rider ID card and the answer is on screen at once.
//   in    -> approved vehicle: "Access granted" and it pays nothing.  Not approved: the entry fee is asked of the rider,
//            who approves it in BodaGoEra (or the gate takes cash); only then is the vehicle in.
//   out   -> the vehicle must have checked in and must have cleared everything; otherwise it is held.
//   auto  -> a vehicle that is inside is checked OUT, any other IN (one gate, one button: just scan).
// The card is checked live by the database each time, so a cancelled, unpaid or expired card never gets through.

// Tint and border are fixed; the text colour comes from the app's tone classes, which have a lighter variant on dark themes.
const TONES = {
  ok: { background: 'rgba(16,185,129,0.14)', border: '#10b981', cls: 'cmms-tone-ok' },
  warn: { background: 'rgba(245,158,11,0.16)', border: '#f59e0b', cls: 'cmms-tone-warn' },
  bad: { background: 'rgba(239,68,68,0.14)', border: '#ef4444', cls: 'cmms-tone-bad' },
  info: { background: 'rgba(59,130,246,0.13)', border: '#3b82f6', cls: 'cmms-classic-heading !font-sans' },
};

const VERDICTS = {
  granted: { tone: 'ok', title: 'ACCESS GRANTED', Icon: CheckCircle2 },
  cleared: { tone: 'ok', title: 'CLEARED TO LEAVE', Icon: ShieldCheck },
  pay_required: { tone: 'warn', title: 'ENTRY FEE REQUIRED', Icon: Wallet },
  balance_due: { tone: 'warn', title: 'NOT CLEARED - BALANCE DUE', Icon: AlertTriangle },
  already_inside: { tone: 'info', title: 'ALREADY INSIDE', Icon: Info },
  not_checked_in: { tone: 'bad', title: 'NO ENTRY RECORD', Icon: XCircle },
  denied: { tone: 'bad', title: 'ENTRY REFUSED', Icon: Ban },
};

const MODES = [
  { id: 'auto', label: 'Auto' },
  { id: 'in', label: 'Check in' },
  { id: 'out', label: 'Check out' },
];

const remember = (key, value) => { try { localStorage.setItem(key, value); } catch { /* private window: fine */ } };
const recall = (key, fallback) => { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } };

export default function GateDesk({ zone, onChanged }) {
  const [mode, setMode] = useState(() => recall('cmms-zone-mode', 'auto'));
  const [gate, setGate] = useState(() => recall('cmms-zone-gate', ''));
  const [code, setCode] = useState('');
  const [plate, setPlate] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [notice, setNotice] = useState('');
  const busyRef = useRef(false);
  const inputRef = useRef(null);

  const runScan = useCallback(async (text, direction) => {
    const scanned = String(text || '').trim();
    if (!scanned || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setNotice('');
    const { data, error } = await cmmsZoneAccessService.scan(zone.id, scanned, direction || mode, gate.trim(), plate.trim());
    busyRef.current = false;
    setBusy(false);
    if (error || !data) {
      setResult(null);
      setNotice(error || 'No answer from the server');
      return;
    }
    setResult({ ...data, scannedCode: scanned, seq: Date.now() });
    setCode('');
    onChanged?.();
    inputRef.current?.focus();
  }, [zone.id, mode, gate, plate, onChanged]);

  // A new zone is a clean desk.
  useEffect(() => { setResult(null); setNotice(''); }, [zone.id]);

  // While a fee is outstanding, watch the visit: the moment the rider pays in BodaGoEra the screen turns green
  // (entry), or the exit is completed (balance).
  const visitId = result?.visit?.id;
  const verdict = result?.verdict;
  const waiting = (verdict === 'pay_required' || verdict === 'balance_due') && !!visitId;
  useEffect(() => {
    if (!waiting) return undefined;
    let stopped = false;
    const scannedCode = result.scannedCode;
    const tick = async () => {
      const { data } = await cmmsZoneAccessService.visitStatus(visitId);
      const visit = data?.visit;
      if (stopped || !visit) return;
      if (verdict === 'pay_required') {
        if (visit.status === 'inside') {
          setResult((r) => (r?.visit?.id === visitId ? { ...r, verdict: 'granted', basis: 'paid', visit, message: 'Fee paid - access granted.' } : r));
          onChanged?.();
        } else if (visit.status === 'cancelled') {
          setResult((r) => (r?.visit?.id === visitId ? { ...r, verdict: 'denied', reason: 'not_paid', visit, message: visit.reason || 'The request ended without payment.' } : r));
          onChanged?.();
        }
      } else if (visit.status === 'inside' && Number(visit.balance_ugx) <= 0) {
        stopped = true;
        runScan(scannedCode, 'out');
      }
    };
    const timer = setInterval(tick, 3000);
    return () => { stopped = true; clearInterval(timer); };
  }, [waiting, visitId, verdict]);   // eslint-disable-line react-hooks/exhaustive-deps

  const collectCash = async () => {
    setBusy(true);
    const { data, error } = await cmmsZoneAccessService.collectCash(visitId);
    setBusy(false);
    if (error) { setNotice(error); return; }
    if (verdict === 'balance_due') { runScan(result.scannedCode, 'out'); return; }
    setResult((r) => ({ ...r, verdict: 'granted', basis: 'paid', visit: data.visit, message: 'Cash collected - access granted.' }));
    onChanged?.();
  };

  const withdraw = async () => {
    setBusy(true);
    const { error } = await cmmsZoneAccessService.cancelRequest(visitId);
    setBusy(false);
    if (error) { setNotice(error); return; }
    setResult(null);
    setNotice('Request withdrawn. The vehicle did not enter.');
    onChanged?.();
  };

  const submitManual = (event) => { event.preventDefault(); runScan(code); };
  // A scanner types the link and presses Enter (the form handles that); a paste of a card link is checked straight away.
  const onPaste = (event) => {
    const text = event.clipboardData?.getData('text') || '';
    if (/rider-card\/[A-Za-z0-9]{16,64}|^\s*[A-Za-z0-9]{16,64}\s*$/.test(text)) {
      event.preventDefault();
      runScan(text);
    }
  };
  const chooseMode = (id) => { setMode(id); remember('cmms-zone-mode', id); };

  const view = result ? VERDICTS[result.verdict] || VERDICTS.denied : null;
  const tone = view ? TONES[view.tone] : null;
  const rider = result?.rider;
  const visit = result?.visit;
  const input = 'mt-1 w-full rounded-lg border border-slate-400 border-opacity-50 bg-white bg-opacity-10 px-3 py-2 text-white';
  const closed = zone.status !== 'active';

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="space-y-3">
        {closed && (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm cmms-tone-warn">
            This zone is {zone.status}. Every scan will be refused until it is set back to active.
          </p>
        )}

        <div className="flex flex-wrap gap-1.5" role="group" aria-label="What a scan does">
          {MODES.map((m) => (
            <button key={m.id} type="button" onClick={() => chooseMode(m.id)} aria-pressed={mode === m.id}
              className={`${mode === m.id ? 'cmms-classic-btn-primary' : 'cmms-classic-btn-secondary'} px-3 py-1.5 text-xs`}>
              {m.label}
            </button>
          ))}
        </div>
        <p className="text-xs cmms-classic-muted">
          {mode === 'auto' && 'Auto: a vehicle that is inside is checked out; any other is checked in. Best for a single gate.'}
          {mode === 'in' && 'Every scan is an entry. Use this on an entry lane.'}
          {mode === 'out' && 'Every scan is an exit. The vehicle must have checked in and paid everything.'}
        </p>

        <label className="block text-sm text-slate-300">Gate or lane (optional)
          <input value={gate} maxLength={40} onChange={(e) => { setGate(e.target.value); remember('cmms-zone-gate', e.target.value); }}
            placeholder="Main gate" className={input} />
        </label>

        <form onSubmit={submitManual} className="space-y-2">
          <label className="block text-sm text-slate-300">Rider card QR
            <input ref={inputRef} autoFocus value={code} onChange={(e) => setCode(e.target.value)} onPaste={onPaste} autoComplete="off" spellCheck={false}
              placeholder="Scan it here, or paste the link" className={`${input} font-mono`} />
          </label>
          <p className="text-xs cmms-classic-muted">
            The card's QR is public: read it with a USB or Bluetooth scanner pointed at this box, or with any phone's camera, then paste the link here.
            A scanner or a paste checks the card at once. Keep the cursor in this box between vehicles.
          </p>
          <label className="block text-sm text-slate-300">Plate you see on the vehicle (optional)
            <input value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} placeholder="UAB 123X" className={`${input} font-mono`} />
          </label>
          <button type="submit" disabled={busy || !code.trim()} className="cmms-classic-btn-primary flex w-full items-center justify-center gap-2 px-4 py-2">
            {busy ? <Loader size={15} className="animate-spin" /> : <ScanLine size={15} />} {mode === 'out' ? 'Check out' : mode === 'in' ? 'Check in' : 'Scan'}
          </button>
        </form>

        {notice && <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm cmms-tone-warn" role="status">{notice}</p>}
      </div>

      <div aria-live="polite">
        {!result && !busy && (
          <div className="flex h-full min-h-[14rem] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed p-6 text-center cmms-classic-muted" style={{ borderColor: 'var(--color-border)' }}>
            <ScanLine className="h-10 w-10 opacity-60" aria-hidden="true" />
            <p className="text-sm">Waiting for a card. Scan the rider's ID card QR into the box on the left.</p>
          </div>
        )}
        {busy && !result && (
          <div className="flex min-h-[14rem] items-center justify-center gap-2 text-sm cmms-classic-muted"><Loader size={16} className="animate-spin" /> Checking the card…</div>
        )}

        {result && view && (
          <div key={result.seq} className="overflow-hidden rounded-2xl border-2" style={{ borderColor: tone.border }}>
            <div className={`flex items-start gap-3 p-4 ${tone.cls}`} style={{ background: tone.background }}>
              <view.Icon className="mt-0.5 h-9 w-9 flex-shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-xl font-extrabold leading-tight tracking-wide">{view.title}</p>
                <p className="mt-1 text-sm font-medium">{result.message}</p>
                {result.direction && <p className="mt-1 text-xs opacity-80">{result.direction === 'out' ? 'Exit scan' : 'Entry scan'}{gate.trim() ? ` · ${gate.trim()}` : ''}</p>}
              </div>
            </div>

            <div className="space-y-3 p-4">
              {rider ? (
                <div className="flex items-center gap-3">
                  {rider.avatar_url
                    ? <img src={rider.avatar_url} alt="" className="h-14 w-14 flex-shrink-0 rounded-full object-cover" />
                    : <span className="grid h-14 w-14 flex-shrink-0 place-items-center rounded-full bg-slate-200 text-lg font-bold text-slate-600">{(rider.full_name || '?').charAt(0)}</span>}
                  <div className="min-w-0">
                    <p className="truncate font-semibold cmms-classic-heading">{rider.full_name || 'Rider'}</p>
                    <p className="font-mono text-2xl font-extrabold tracking-wider cmms-classic-heading !font-mono">{rider.plate_number || '—'}</p>
                    <p className="text-xs cmms-classic-muted">
                      {[vehicleLabel(rider.vehicle_type), rider.vehicle_model, rider.vehicle_color].filter(Boolean).join(' · ')}
                      {rider.card_number ? ` · Card ${rider.card_number}` : ''}
                    </p>
                    {rider.stage && <p className="text-xs cmms-classic-muted">{rider.stage}{rider.division ? ` · ${rider.division}` : ''}</p>}
                  </div>
                </div>
              ) : result.card_number ? (
                <p className="text-sm cmms-classic-muted">Card <span className="font-mono">{result.card_number}</span>. Nothing about the rider is shown for a card that is not valid.</p>
              ) : null}

              {result.member && (
                <p className="text-sm"><span className="cmms-classic-chip">Approved {result.member.kind}</span>
                  {result.member.valid_until ? <span className="ml-2 text-xs cmms-classic-muted">until {new Date(result.member.valid_until).toLocaleDateString()}</span> : null}
                  {result.member.note ? <span className="ml-2 text-xs cmms-classic-muted">{result.member.note}</span> : null}</p>
              )}

              {verdict === 'pay_required' && visit && (
                <div className="rounded-xl border p-3" style={{ borderColor: 'var(--color-border)' }}>
                  <p className="text-2xl font-extrabold cmms-classic-heading">{ugx(visit.fee_due_ugx)}</p>
                  {visit.payer === 'customer' ? (
                    <p className="mt-1 text-sm font-semibold cmms-tone-warn">Customer on board: the CUSTOMER pays this, not the rider. Take the cash from the passenger.</p>
                  ) : result.recover_from_customer ? (
                    <>
                      <p className="mt-1 flex items-center gap-2 text-sm cmms-classic-muted"><Loader size={14} className="animate-spin" /> Waiting for the rider to approve it in BodaGoEra{visit.pay_by ? ` (until ${clock(visit.pay_by)})` : ''}.</p>
                      <p className="mt-1 text-xs cmms-tone-ok">A customer is on this ride: once the rider has paid, the fee is passed on to the customer.</p>
                    </>
                  ) : (
                    <p className="mt-1 flex items-center gap-2 text-sm cmms-classic-muted"><Loader size={14} className="animate-spin" /> Waiting for the rider to approve it in BodaGoEra{visit.pay_by ? ` (until ${clock(visit.pay_by)})` : ''}.</p>
                  )}
                </div>
              )}
              {verdict === 'balance_due' && visit && (
                <div className="rounded-xl border p-3" style={{ borderColor: 'var(--color-border)' }}>
                  <p className="text-2xl font-extrabold cmms-classic-heading">{ugx(result.balance_ugx)}</p>
                  <p className="text-sm cmms-classic-muted">Entry {ugx(visit.entry_fee_ugx)} · overstay {ugx(visit.overstay_ugx)} · paid {ugx(visit.fee_paid_ugx)} · inside {duration(result.stay_minutes)}</p>
                  <p className="mt-1 flex items-center gap-2 text-sm cmms-classic-muted"><Loader size={14} className="animate-spin" /> The rider can pay it in BodaGoEra; the exit completes by itself.</p>
                </div>
              )}
              {verdict === 'cleared' && visit && (
                <p className="text-sm cmms-classic-muted">
                  Inside {duration(result.stay_minutes)} · paid {ugx(visit.fee_paid_ugx)}{visit.access_basis === 'member' ? ' (approved vehicle: no fee)' : ''}
                </p>
              )}
              {verdict === 'granted' && visit && visit.fee_paid_ugx > 0 && (
                <p className="text-sm cmms-classic-muted">
                  Paid {ugx(visit.fee_paid_ugx)} by {visit.payment_method === 'cash' ? 'cash' : 'IcanEra wallet'}
                  {visit.payer === 'customer' ? ' — by the customer on board, not the rider.' : '.'}
                </p>
              )}

              {result.warnings?.length > 0 && (
                <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                  <p className="flex items-center gap-1.5 font-semibold"><AlertTriangle size={14} /> Check before you let it through</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5">{result.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
                </div>
              )}

              {waiting && (
                <div className="flex flex-wrap gap-2">
                  {result.can_collect_cash && (
                    <button type="button" disabled={busy} onClick={collectCash} className="cmms-classic-btn-primary flex items-center gap-2 px-4 py-2 text-sm">
                      {busy ? <Loader size={14} className="animate-spin" /> : <Wallet size={14} />} Cash collected
                    </button>
                  )}
                  {verdict === 'pay_required' && (
                    <button type="button" disabled={busy} onClick={withdraw} className="cmms-classic-btn-secondary flex items-center gap-2 px-4 py-2 text-sm"><X size={14} /> Withdraw request</button>
                  )}
                  {verdict === 'balance_due' && (
                    <button type="button" disabled={busy} onClick={() => runScan(result.scannedCode, 'out')} className="cmms-classic-btn-secondary flex items-center gap-2 px-4 py-2 text-sm"><ScanLine size={14} /> Check again</button>
                  )}
                </div>
              )}
              {!waiting && (
                <button type="button" onClick={() => { setResult(null); setNotice(''); inputRef.current?.focus(); }} className="cmms-classic-btn-secondary px-4 py-2 text-sm">Next vehicle</button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

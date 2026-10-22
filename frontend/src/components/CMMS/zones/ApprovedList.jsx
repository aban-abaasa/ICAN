import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader, Plus, Search, ShieldAlert, UserCheck, UserX } from 'lucide-react';
import { cmmsZoneAccessService } from '../../../services/cmmsZoneAccessService';
import { CARD_STATE_TEXT, MEMBER_KINDS, MEMBER_STATE_TEXT, memberKindLabel, vehicleLabel, when } from './zoneLabels';

// The zone's approved vehicles. An approved vehicle is let in by its BodaGoEra rider ID card and never pays
// anything. Anyone not on the list must pay (or is refused, if the zone sells no entry). Works for every kind of
// vehicle that holds a rider card: bodas, tuk-tuks, cars, vans, trucks, bicycles.
const blankLimits = { kind: 'staff', validUntil: '', dailyStart: '', dailyEnd: '', note: '' };

export default function ApprovedList({ zone, businessProfileId, canAssign, onChanged }) {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [query, setQuery] = useState('');
  const [found, setFound] = useState(null);       // null = not searched yet
  const [searching, setSearching] = useState(false);
  const [limits, setLimits] = useState(blankLimits);
  const [showLimits, setShowLimits] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const searchSeq = useRef(0);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: loadError } = await cmmsZoneAccessService.members(zone.id);
    setError(loadError || '');
    setMembers(data?.members || []);
    setLoading(false);
  }, [zone.id]);

  useEffect(() => { load(); setFound(null); setQuery(''); setMessage(''); }, [load]);

  const search = useCallback(async (text) => {
    const q = text.trim();
    if (q.length < 3) { setFound(null); return; }
    const seq = ++searchSeq.current;
    setSearching(true);
    const { data, error: searchError } = await cmmsZoneAccessService.searchRiders(businessProfileId, zone.id, q);
    if (seq !== searchSeq.current) return;
    setSearching(false);
    if (searchError) { setError(searchError); setFound([]); return; }
    setError('');
    setFound(data?.riders || []);
  }, [businessProfileId, zone.id]);

  useEffect(() => {
    if (!canAssign) return undefined;
    const timer = setTimeout(() => search(query), 350);
    return () => clearTimeout(timer);
  }, [query, canAssign, search]);

  const approve = async (rider) => {
    setBusyId(rider.rider_id);
    setError(''); setMessage('');
    const { error: addError } = await cmmsZoneAccessService.addMember(zone.id, rider.rider_id, limits);
    setBusyId(null);
    if (addError) { setError(addError); return; }
    setMessage(`${rider.plate_number} approved as ${memberKindLabel(limits.kind).toLowerCase()}. It now enters free.`);
    setQuery(''); setFound(null); setLimits(blankLimits); setShowLimits(false);
    await load();
    onChanged?.();
  };

  const setStatus = async (member, status) => {
    setBusyId(member.id);
    setError(''); setMessage('');
    const { error: statusError } = await cmmsZoneAccessService.setMemberStatus(member.id, status);
    setBusyId(null);
    if (statusError) { setError(statusError); return; }
    await load();
    onChanged?.();
  };

  const input = 'mt-1 w-full rounded-lg border border-slate-400 border-opacity-50 bg-white bg-opacity-10 px-3 py-2 text-white';
  const live = members.filter((m) => m.status !== 'revoked');

  return (
    <div className="space-y-4">
      {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm cmms-tone-bad">{error}</p>}
      {message && <p className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm cmms-tone-ok">{message}</p>}

      {canAssign && (
        <div className="space-y-3 rounded-xl border p-3" style={{ borderColor: 'var(--color-border)' }}>
          <p className="text-sm font-medium cmms-classic-heading">Approve a vehicle</p>
          <div className="flex gap-2">
            <label className="relative flex-1">
              <span className="sr-only">Plate number, card number or card code</span>
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Plate number, card number, or scan / paste the card link"
                className="w-full rounded-lg border border-slate-400 border-opacity-50 bg-white bg-opacity-10 py-2 pl-9 pr-3 text-white" />
            </label>
          </div>
          <p className="text-xs cmms-classic-muted">The rider's card QR is public: scan it into this box and the link finds the vehicle.</p>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-slate-300">Approve as
              <select value={limits.kind} onChange={(e) => setLimits({ ...limits, kind: e.target.value })} className={input}>
                {MEMBER_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
              </select>
            </label>
            <div className="flex items-end">
              <button type="button" onClick={() => setShowLimits((v) => !v)} className="text-xs cmms-tone-warn underline decoration-dotted">
                {showLimits ? 'Hide limits' : 'Limit by date or hours'}
              </button>
            </div>
            {showLimits && (
              <>
                <label className="text-sm text-slate-300">Access ends on (optional)
                  <input type="date" value={limits.validUntil} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setLimits({ ...limits, validUntil: e.target.value })} className={input} />
                </label>
                <label className="text-sm text-slate-300">Note (optional)
                  <input value={limits.note} maxLength={120} onChange={(e) => setLimits({ ...limits, note: e.target.value })} placeholder="Night security, deliveries…" className={input} />
                </label>
                <label className="text-sm text-slate-300">Allowed from
                  <input type="time" value={limits.dailyStart} onChange={(e) => setLimits({ ...limits, dailyStart: e.target.value })} className={input} />
                </label>
                <label className="text-sm text-slate-300">Allowed until
                  <input type="time" value={limits.dailyEnd} onChange={(e) => setLimits({ ...limits, dailyEnd: e.target.value })} className={input} />
                </label>
                <p className="text-xs cmms-classic-muted sm:col-span-2">Outside these dates or hours the vehicle is treated like any vehicle that is not approved: it pays, or is refused if this zone sells no entry.</p>
              </>
            )}
          </div>

          {searching && <p className="flex items-center gap-2 text-sm cmms-classic-muted"><Loader size={14} className="animate-spin" /> Searching…</p>}
          {found && !searching && found.length === 0 && <p className="text-sm cmms-classic-muted">No rider card matches. The rider needs a BodaGoEra rider ID card first.</p>}
          {found && found.length > 0 && (
            <ul className="space-y-2">
              {found.map((rider) => (
                <li key={rider.rider_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2.5" style={{ borderColor: 'var(--color-border)' }}>
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-bold">{rider.plate_number}</p>
                    <p className="truncate text-xs cmms-classic-muted">{rider.full_name} · {vehicleLabel(rider.vehicle_type)}{rider.vehicle_model ? ` · ${rider.vehicle_model}` : ''} · {rider.card_number}</p>
                    {rider.card_status === 'pending_payment' && <p className="text-xs cmms-tone-warn">Card not activated yet: the gate will refuse it until the rider pays for the card.</p>}
                  </div>
                  {rider.already_member
                    ? <span className="cmms-classic-chip">Already approved</span>
                    : <button type="button" disabled={busyId === rider.rider_id} onClick={() => approve(rider)} className="cmms-classic-btn-primary flex items-center gap-1.5 px-3 py-1.5 text-xs">
                        {busyId === rider.rider_id ? <Loader size={13} className="animate-spin" /> : <Plus size={13} />} Approve
                      </button>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {loading ? (
        <p className="flex items-center gap-2 text-sm cmms-classic-muted"><Loader size={15} className="animate-spin" /> Loading the list…</p>
      ) : live.length === 0 ? (
        <p className="text-sm cmms-classic-muted">No approved vehicles yet. Everyone who comes to {zone.name} {zone.entry_mode === 'paid_entry' ? 'must pay the entry fee' : 'is refused'}.</p>
      ) : (
        <ul className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
          {live.map((m) => {
            const cardOk = m.card_state === 'valid';
            return (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5" style={{ borderColor: 'var(--color-border)' }}>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-bold cmms-classic-heading !font-mono">{m.plate_number}</span>
                    <span className="cmms-classic-chip">{memberKindLabel(m.member_kind)}</span>
                    {m.state !== 'ok' && <span className="cmms-classic-chip" style={{ color: '#b45309' }}>{MEMBER_STATE_TEXT[m.state] || m.state}</span>}
                    {!cardOk && <span className="inline-flex items-center gap-1 text-xs cmms-tone-bad"><ShieldAlert size={12} /> {CARD_STATE_TEXT[m.card_state] || m.card_state}</span>}
                    {m.inside && <span className="cmms-classic-chip" style={{ color: '#047857' }}>Inside now</span>}
                  </p>
                  <p className="truncate text-xs cmms-classic-muted">
                    {m.full_name} · {vehicleLabel(m.vehicle_type)}{m.card_number ? ` · ${m.card_number}` : ''}
                    {m.valid_until ? ` · until ${when(m.valid_until).split(',')[0]}` : ''}
                    {m.daily_start_time ? ` · ${m.daily_start_time.slice(0, 5)}–${m.daily_end_time.slice(0, 5)}` : ''}
                    {m.note ? ` · ${m.note}` : ''}
                  </p>
                </div>
                {canAssign && (
                  <div className="flex gap-1.5">
                    {m.status === 'active'
                      ? <button type="button" disabled={busyId === m.id} onClick={() => setStatus(m, 'suspended')} className="cmms-classic-btn-secondary flex items-center gap-1 px-2.5 py-1.5 text-xs"><UserX size={13} /> Suspend</button>
                      : <button type="button" disabled={busyId === m.id} onClick={() => setStatus(m, 'active')} className="cmms-classic-btn-secondary flex items-center gap-1 px-2.5 py-1.5 text-xs"><UserCheck size={13} /> Restore</button>}
                    <button type="button" disabled={busyId === m.id}
                      onClick={() => { if (window.confirm(`Remove ${m.plate_number} from ${zone.name}? It will have to pay like any other vehicle.`)) setStatus(m, 'revoked'); }}
                      className="flex items-center gap-1 rounded-lg border border-red-500/50 px-2.5 py-1.5 text-xs cmms-tone-bad">Remove</button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

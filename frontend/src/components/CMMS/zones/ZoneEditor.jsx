import React, { useState } from 'react';
import { Check, Loader, Plus } from 'lucide-react';
import { cmmsZoneAccessService } from '../../../services/cmmsZoneAccessService';
import { VEHICLE_TYPES, ZONE_KINDS, ugx } from './zoneLabels';

// Create or change a restricted zone: who may enter free (the approved list), what everybody else pays, and the rules.
const blankZone = {
  id: null, name: '', kind: 'estate', location: '', status: 'active', entry_mode: 'paid_entry', fee_basis: 'per_entry',
  accept_cash: false, require_valid_permit: false, max_stay_minutes: '', overstay_fee_ugx_per_hour: '', payment_window_minutes: 10,
  timezone: 'Africa/Kampala', fees: { motorcycle: 2000, car: 5000 },
};

const fromZone = (zone) => ({
  ...blankZone, ...zone,
  location: zone.location || '',
  max_stay_minutes: zone.max_stay_minutes ?? '',
  overstay_fee_ugx_per_hour: Number(zone.overstay_fee_ugx_per_hour) > 0 ? Number(zone.overstay_fee_ugx_per_hour) : '',
  fees: Object.fromEntries(Object.entries(zone.fees || {}).map(([k, v]) => [k, Number(v)])),
});

export default function ZoneEditor({ businessProfileId, zone, platformFeeRate = 0.03, canEdit, onSaved, onCancel }) {
  const [form, setForm] = useState(() => (zone ? fromZone(zone) : blankZone));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const setFee = (type, value) => setForm((f) => {
    const fees = { ...f.fees };
    if (value === null) delete fees[type]; else fees[type] = value;
    return { ...f, fees };
  });

  const pct = `${+(platformFeeRate * 100).toFixed(2)}%`;
  const example = Object.values(form.fees).find((v) => v > 0);

  const submit = async (event) => {
    event.preventDefault();
    if (!canEdit) { setError('Your role cannot change restricted zones.'); return; }
    setSaving(true); setError('');
    const { data, error: saveError } = await cmmsZoneAccessService.saveZone(businessProfileId, form);
    setSaving(false);
    if (saveError) { setError(saveError); return; }
    onSaved?.(data.zone_id);
  };

  const input = 'mt-1 w-full rounded-lg border border-slate-400 border-opacity-50 bg-white bg-opacity-10 px-3 py-2 text-white';
  const paid = form.entry_mode === 'paid_entry';

  return (
    <form onSubmit={submit} className="grid gap-3 md:grid-cols-2">
      {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm cmms-tone-bad md:col-span-2">{error}</p>}

      <label className="text-sm text-slate-300 md:col-span-2">Name of the area
        <input required value={form.name} maxLength={120} onChange={(e) => set({ name: e.target.value })} placeholder="Kololo Heights Estate" className={input} />
      </label>
      <label className="text-sm text-slate-300">Type of area
        <select value={form.kind} onChange={(e) => set({ kind: e.target.value })} className={input}>
          {ZONE_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
        </select>
      </label>
      <label className="text-sm text-slate-300">Where it is
        <input value={form.location} onChange={(e) => set({ location: e.target.value })} placeholder="Plot 12, Kololo" className={input} />
      </label>

      <fieldset className="md:col-span-2">
        <legend className="text-sm text-slate-300">Vehicles that are not on the approved list</legend>
        <div className="mt-1 grid gap-2 sm:grid-cols-2">
          {[
            { id: 'paid_entry', title: 'Must pay to enter', text: 'Approved vehicles are free. Everyone else pays the fee for their vehicle type, then gets in.' },
            { id: 'members_only', title: 'Refused', text: 'Only approved vehicles get in. No fee can buy entry.' },
          ].map((o) => (
            <label key={o.id} className={`cursor-pointer rounded-lg border p-3 text-sm ${form.entry_mode === o.id ? 'border-orange-500 bg-orange-500/10' : ''}`} style={form.entry_mode !== o.id ? { borderColor: 'var(--color-border)' } : undefined}>
              <input type="radio" name="entry_mode" value={o.id} checked={form.entry_mode === o.id} onChange={() => set({ entry_mode: o.id })} className="mr-2" />
              <span className="font-medium cmms-classic-heading">{o.title}</span>
              <span className="mt-1 block text-xs cmms-classic-muted">{o.text}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {paid && (
        <div className="space-y-2 rounded-xl border p-3 md:col-span-2" style={{ borderColor: 'var(--color-border)' }}>
          <p className="text-sm font-medium cmms-classic-heading">Entry fee by vehicle type</p>
          <p className="text-xs cmms-classic-muted">Tick the vehicle types that may buy entry. 0 lets that type in free. A type left unticked is refused.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {VEHICLE_TYPES.map((v) => {
              const on = form.fees[v.id] !== undefined;
              return (
                <div key={v.id} className="flex items-center gap-2">
                  <input id={`fee-${v.id}`} type="checkbox" checked={on} onChange={(e) => setFee(v.id, e.target.checked ? 0 : null)} />
                  <label htmlFor={`fee-${v.id}`} className="w-36 text-sm text-slate-300">{v.label}</label>
                  <input type="number" min="0" step="100" disabled={!on} value={on ? form.fees[v.id] : ''} placeholder="UGX"
                    onChange={(e) => setFee(v.id, e.target.value === '' ? 0 : Number(e.target.value))}
                    className="w-28 rounded-lg border border-slate-400 border-opacity-50 bg-white bg-opacity-10 px-2 py-1.5 text-white disabled:opacity-40" aria-label={`${v.label} fee in UGX`} />
                </div>
              );
            })}
          </div>
          <label className="block text-sm text-slate-300">How the fee works
            <select value={form.fee_basis} onChange={(e) => set({ fee_basis: e.target.value })} className={input}>
              <option value="per_entry">Pay every time the vehicle enters</option>
              <option value="day_pass">Pay once: re-entry is free for 24 hours</option>
            </select>
          </label>
          <label className="flex items-start gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={form.accept_cash} onChange={(e) => set({ accept_cash: e.target.checked })} className="mt-1" />
            <span>The gate may take cash<span className="block text-xs cmms-classic-muted">Otherwise the rider pays from their IcanEra wallet in the BodaGoEra app.</span></span>
          </label>
          <p className="rounded-lg border p-2.5 text-xs cmms-classic-muted">
            Riders pay exactly the fee you set. IcanEra keeps {pct} of every fee and you receive the rest
            {example ? ` (on ${ugx(example)}: you receive ${ugx(example * (1 - platformFeeRate))}, IcanEra ${ugx(example * platformFeeRate)})` : ''}.
          </p>
        </div>
      )}

      <label className="text-sm text-slate-300">Longest stay (minutes, optional)
        <input type="number" min="1" value={form.max_stay_minutes} onChange={(e) => set({ max_stay_minutes: e.target.value })} placeholder="No limit" className={input} />
      </label>
      <label className="text-sm text-slate-300">Overstay fee per started hour (UGX)
        <input type="number" min="0" step="100" value={form.overstay_fee_ugx_per_hour} onChange={(e) => set({ overstay_fee_ugx_per_hour: e.target.value })} placeholder="None" className={input} />
      </label>
      <p className="text-xs cmms-classic-muted md:col-span-2">An overstay fee applies to vehicles that paid to come in. Approved vehicles never pay an entry or an overstay fee. A vehicle that owes an overstay fee is held at the exit until it is paid.</p>

      <label className="text-sm text-slate-300">Time the rider has to approve a fee (minutes)
        <input type="number" min="1" max="120" value={form.payment_window_minutes} onChange={(e) => set({ payment_window_minutes: e.target.value })} className={input} />
      </label>
      <label className="text-sm text-slate-300">Status
        <select value={form.status} onChange={(e) => set({ status: e.target.value })} className={input}>
          <option value="active">Active</option>
          <option value="paused">Paused: every scan is refused</option>
          <option value="closed">Closed</option>
        </select>
      </label>
      <label className="flex items-start gap-2 text-sm text-slate-300 md:col-span-2">
        <input type="checkbox" checked={form.require_valid_permit} onChange={(e) => set({ require_valid_permit: e.target.checked })} className="mt-1" />
        <span>Refuse riders whose driving permit has expired<span className="block text-xs cmms-classic-muted">Otherwise it is only a warning on the gate desk.</span></span>
      </label>

      <div className="flex gap-2 md:col-span-2">
        <button disabled={saving || !canEdit} className="cmms-classic-btn-primary flex flex-1 items-center justify-center gap-2 px-4 py-2">
          {saving ? <Loader size={15} className="animate-spin" /> : form.id ? <Check size={15} /> : <Plus size={15} />} {form.id ? 'Save changes' : 'Create zone'}
        </button>
        {onCancel && <button type="button" onClick={onCancel} className="cmms-classic-btn-secondary px-4 py-2 text-sm">Cancel</button>}
      </div>
    </form>
  );
}

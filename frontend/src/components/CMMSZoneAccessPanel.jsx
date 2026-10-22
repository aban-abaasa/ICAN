import React, { useCallback, useEffect, useState } from 'react';
import { Loader, MapPinned, Pencil, Plus, RefreshCw, ScanLine, Users, History, ShieldCheck } from 'lucide-react';
import CmmsPageShell from './CmmsPageShell.jsx';
import CmmsFold from './CmmsFold.jsx';
import GateDesk from './CMMS/zones/GateDesk.jsx';
import ApprovedList from './CMMS/zones/ApprovedList.jsx';
import ZoneEditor from './CMMS/zones/ZoneEditor.jsx';
import OnSite from './CMMS/zones/OnSite.jsx';
import { cmmsZoneAccessService } from '../services/cmmsZoneAccessService';
import { ZONE_KINDS, vehicleLabel, ugx } from './CMMS/zones/zoneLabels';

// CMMS > Transport > Restricted zones.
// An organisation that controls an area (estate, campus, hospital, market, port…) approves the vehicles it trusts, sells
// entry to everyone else, and clears vehicles on the way out -- all by scanning the BodaGoEra rider ID card.
// The database decides what each person may do from their CMMS role (Transport: edit / assign / gate / view); this screen
// only hides what the database would refuse.
export default function CMMSZoneAccessPanel({ companyProfile }) {
  const businessProfileId = companyProfile?.pichin_business_profile_id;
  const [zones, setZones] = useState([]);
  const [caps, setCaps] = useState({});
  const [platformRate, setPlatformRate] = useState(0.03);
  const [zoneId, setZoneId] = useState(null);
  const [editing, setEditing] = useState(null);   // null | 'new' | zone
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async (keepSelection = true) => {
    if (!businessProfileId) { setLoading(false); return; }
    setLoading(true);
    const { data, error: loadError } = await cmmsZoneAccessService.list(businessProfileId);
    setError(loadError || '');
    const list = data?.zones || [];
    setZones(list);
    setCaps(data?.caps || {});
    if (data?.platform_fee_rate != null) setPlatformRate(Number(data.platform_fee_rate));
    setZoneId((current) => (keepSelection && list.some((z) => z.id === current) ? current : list[0]?.id || null));
    setLoading(false);
  }, [businessProfileId]);

  useEffect(() => { load(false); }, [load]);

  const zone = zones.find((z) => z.id === zoneId) || null;
  const bump = () => { setRefreshKey((n) => n + 1); load(true); };
  const canAny = caps.view || caps.edit || caps.assign || caps.gate;

  const chips = [
    `${zones.length} zone${zones.length === 1 ? '' : 's'}`,
    zone && `${zone.inside_count} inside`,
    zone?.awaiting_count > 0 && `${zone.awaiting_count} waiting to pay`,
  ];

  return (
    <CmmsPageShell
      title="Restricted zones"
      subtitle={zone ? `${zone.name} · ${zone.entry_mode === 'paid_entry' ? 'others pay to enter' : 'approved vehicles only'}` : 'Control which vehicles may enter your area'}
      icon={<MapPinned className="h-4 w-4" aria-hidden="true" />}
      chips={chips}
      info={(
        <>
          <p>Approve the bodas, tuk-tuks, cars, vans and trucks that may enter your area. At the gate, scan the BodaGoEra rider ID card: the card is checked live, an approved vehicle is let in free, and any other vehicle must pay the entry fee you set (the rider approves it in the BodaGoEra app, or the gate takes cash).</p>
          <p>On the way out, scan the card again: the vehicle must have checked in and cleared everything, or it is held. IcanEra keeps {+(platformRate * 100).toFixed(2)}% of every fee you set.</p>
        </>
      )}
      actions={<button type="button" onClick={() => load(true)} className="cmms-info-btn" title="Refresh" aria-label="Refresh"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>}
    >
      {!businessProfileId && <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm cmms-tone-warn">Link the Pichin business profile before using restricted zones.</p>}
      {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm cmms-tone-bad">{error}</p>}
      {loading && zones.length === 0 && !error && <div className="flex gap-2 text-sm cmms-classic-muted"><Loader size={15} className="animate-spin" /> Loading zones…</div>}

      {businessProfileId && !error && !loading && !canAny && (
        <p className="text-sm cmms-classic-muted">Your role has no restricted-zone actions. Ask an administrator for Transport: view, gate, assign or edit.</p>
      )}

      {canAny && zones.length > 1 && (
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Zones">
          {zones.map((z) => (
            <button key={z.id} type="button" role="tab" aria-selected={z.id === zoneId} onClick={() => { setZoneId(z.id); setEditing(null); }}
              className={`${z.id === zoneId ? 'cmms-classic-btn-primary' : 'cmms-classic-btn-secondary'} px-3 py-1.5 text-xs`}>
              {z.name}{z.status !== 'active' ? ` (${z.status})` : ''}
            </button>
          ))}
        </div>
      )}

      {canAny && zones.length === 0 && !loading && !editing && (
        <div className="rounded-xl border border-dashed p-5 text-center" style={{ borderColor: 'var(--color-border)' }}>
          <p className="text-sm cmms-classic-muted">No restricted zone yet.</p>
          {caps.edit && <button type="button" onClick={() => setEditing('new')} className="cmms-classic-btn-primary mt-3 inline-flex items-center gap-2 px-4 py-2 text-sm"><Plus size={14} /> Create your first zone</button>}
        </div>
      )}

      {editing && (
        <CmmsFold title={editing === 'new' ? 'New restricted zone' : `Edit ${editing.name}`} icon={<Pencil className="h-4 w-4" aria-hidden="true" />} accent="gold" defaultOpen>
          <ZoneEditor
            key={editing === 'new' ? 'new' : editing.id}
            businessProfileId={businessProfileId}
            zone={editing === 'new' ? null : editing}
            platformFeeRate={platformRate}
            canEdit={caps.edit}
            onCancel={() => setEditing(null)}
            onSaved={async (savedId) => { setEditing(null); await load(false); setZoneId(savedId); }}
          />
        </CmmsFold>
      )}

      {zone && !editing && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs cmms-classic-muted">
            <span>
              {ZONE_KINDS.find((k) => k.id === zone.kind)?.label}{zone.location ? ` · ${zone.location}` : ''}
              {zone.status !== 'active' ? ` · ${zone.status.toUpperCase()}` : ''}
            </span>
            <span className="flex items-center gap-1.5">
              {caps.edit && <button type="button" onClick={() => setEditing(zone)} className="cmms-classic-btn-secondary flex items-center gap-1 px-2.5 py-1 text-xs"><Pencil size={12} /> Edit zone</button>}
              {caps.edit && <button type="button" onClick={() => setEditing('new')} className="cmms-classic-btn-secondary flex items-center gap-1 px-2.5 py-1 text-xs"><Plus size={12} /> New zone</button>}
            </span>
          </div>

          {zone.entry_mode === 'paid_entry' && (
            <p className="rounded-lg border p-2.5 text-xs cmms-classic-muted" style={{ borderColor: 'var(--color-border)' }}>
              Not approved → pays:{' '}
              {Object.entries(zone.fees).length === 0 ? 'no fee set' : Object.entries(zone.fees).map(([type, fee]) => `${vehicleLabel(type)} ${Number(fee) === 0 ? 'free' : ugx(fee)}`).join(' · ')}
              {zone.fee_basis === 'day_pass' ? ' · one payment covers 24 hours' : ''}
              {zone.accept_cash ? ' · cash accepted' : ''}
            </p>
          )}

          {zone.entry_mode === 'paid_entry' && zone.latitude == null && caps.edit && (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs cmms-tone-warn">
              This zone is not on the map yet. Customers who book a trip here are not told about the entry fee, so riders would pay it alone.{' '}
              <button type="button" onClick={() => setEditing(zone)} className="underline decoration-dotted">Add its location</button>
            </p>
          )}

          {caps.gate && (
            <CmmsFold title="Gate desk" icon={<ScanLine className="h-4 w-4" aria-hidden="true" />} accent="emerald" defaultOpen
              info="Scan a rider ID card to check a vehicle in or out. Approved vehicles pass free; others pay the entry fee; a vehicle leaves only when everything is cleared.">
              <GateDesk zone={zone} onChanged={bump} />
            </CmmsFold>
          )}

          <CmmsFold title="Approved vehicles" icon={<Users className="h-4 w-4" aria-hidden="true" />} accent="navy" hint={`${zone.members_count} approved`}
            info="Vehicles on this list are let in by their rider ID card and never pay. Each vehicle needs its own card, so a rider with a boda and a car approves each one.">
            <ApprovedList key={zone.id} zone={zone} businessProfileId={businessProfileId} canAssign={!!caps.assign} onChanged={bump} />
          </CmmsFold>

          <CmmsFold title="Inside now & gate log" icon={<History className="h-4 w-4" aria-hidden="true" />} accent="plum" hint={`${zone.inside_count} inside`}>
            <OnSite zone={zone} businessProfileId={businessProfileId} canEdit={!!caps.edit} refreshKey={refreshKey} />
          </CmmsFold>

          <p className="flex items-center gap-1.5 text-xs cmms-classic-muted"><ShieldCheck size={13} aria-hidden="true" /> Cards are checked live: a cancelled, unpaid or expired card is refused even for an approved vehicle.</p>
        </>
      )}
    </CmmsPageShell>
  );
}

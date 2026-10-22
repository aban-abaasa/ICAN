import React, { useEffect, useRef, useState } from 'react';
import { Loader, LocateFixed, MapPin, RefreshCw } from 'lucide-react';
import { findBusinessLocation } from '../../../services/zoneLocationService';
import { reverseGeocode } from '../../../services/geocodeService';
import { locateDevice } from '../../../utils/geolocation';
import { LOCATION_SOURCE_LABELS } from '../../../utils/zoneLocation';

// Where the zone is. Nobody types coordinates: the place comes from the business's Pitchin profile, or from its website when
// the profile has none. Standing at the gate and pressing "Use my location" is the way to be exact.
const DEVICE_FAILURES = {
  denied: 'Location is blocked for this site. Allow it from the lock icon in the address bar, then try again.',
  insecure: 'Phones only share their location on a secure (https) page.',
  unsupported: 'This device cannot share its location.',
  timeout: 'No location fix in time (indoors or weak signal?). Try again.',
};

const hasPoint = (form) => form.latitude !== '' && form.latitude != null && form.longitude !== '' && form.longitude != null;

export default function ZoneLocation({ businessProfileId, companyProfile, form, set, inputClass }) {
  const [phase, setPhase] = useState(hasPoint(form) ? 'ready' : 'looking'); // looking | ready | missing
  const [source, setSource] = useState(hasPoint(form) ? 'saved' : null);
  const [approximate, setApproximate] = useState(false);
  const [locating, setLocating] = useState(false);
  const [note, setNote] = useState('');
  const latest = useRef({ form, set });
  latest.current = { form, set };
  const request = useRef(0); // a newer lookup, or leaving the page, makes an older answer irrelevant

  const lookUp = async ({ fresh = false, replaceText = false } = {}) => {
    const id = ++request.current;
    setPhase('looking');
    setNote('');
    const where = await findBusinessLocation({ businessProfileId, companyProfile }, { fresh });
    if (id !== request.current) return;
    const { form: current, set: update } = latest.current;
    if (where.latitude != null) {
      update({
        latitude: where.latitude,
        longitude: where.longitude,
        location: replaceText || !current.location ? (where.address || current.location) : current.location,
      });
      setSource(where.source);
      setApproximate(!!where.approximate);
      setPhase('ready');
      return;
    }
    if (where.address && !current.location) update({ location: where.address });
    if (hasPoint(current)) {
      setNote('Nothing on your Pitchin business profile or website could be placed on the map, so this zone keeps its current point.');
      setPhase('ready');
    } else {
      setPhase('missing');
    }
  };

  useEffect(() => {
    if (!hasPoint(latest.current.form)) lookUp();
    return () => { request.current += 1; };
    // Once, when the page opens: later changes to the form must not start another lookup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const useDevice = async () => {
    const id = ++request.current;
    setLocating(true);
    setNote('');
    const result = await locateDevice();
    if (id !== request.current) return;
    if (!result.ok) {
      setLocating(false);
      setNote(DEVICE_FAILURES[result.failure] || 'Your location is not available right now.');
      setPhase(hasPoint(latest.current.form) ? 'ready' : 'missing');
      return;
    }
    const latitude = +result.fix.lat.toFixed(6);
    const longitude = +result.fix.lng.toFixed(6);
    const place = await reverseGeocode(latitude, longitude);
    if (id !== request.current) return;
    latest.current.set({ latitude, longitude, location: place?.address || latest.current.form.location });
    setSource('device');
    setApproximate(false);
    setPhase('ready');
    setLocating(false);
  };

  const radius = form.radius_m || 200;
  const label = LOCATION_SOURCE_LABELS[source] || '';
  const where = form.location || (hasPoint(form) ? `${form.latitude}, ${form.longitude}` : '');
  const small = 'cmms-classic-btn-secondary flex items-center gap-1.5 px-3 py-1.5 text-xs';

  return (
    <div className="min-w-0 space-y-2 rounded-xl border p-3 md:col-span-2" style={{ borderColor: 'var(--color-border)' }}>
      <p className="flex items-center gap-1.5 text-sm font-medium cmms-classic-heading"><MapPin size={14} aria-hidden="true" /> Where it is</p>

      {phase === 'looking' && (
        <p className="flex items-center gap-2 text-sm cmms-classic-muted"><Loader size={14} className="animate-spin" /> Finding your business location…</p>
      )}

      {phase === 'ready' && (
        <>
          <p className="break-words text-sm text-slate-200">{where}</p>
          {label && <p className="text-xs cmms-classic-muted">{label}{approximate ? ': approximate, so stand at the gate and press "Use my location" for the exact point.' : '.'}</p>}
          <label className="block text-sm text-slate-300">Radius (m)
            <input type="number" min="20" max="5000" value={form.radius_m} onChange={(e) => set({ radius_m: e.target.value })} className={`${inputClass} sm:w-40`} />
          </label>
          <p className="text-xs cmms-tone-ok">
            On the map: trips to or from within {radius} m of this point are covered. Customers are told about the entry fee before they book,
            and when a rider arrives with a customer the fee is charged to the customer, not the rider.
          </p>
        </>
      )}

      {phase === 'missing' && (
        <>
          <p className="text-xs cmms-tone-warn">
            No location found on your Pitchin business profile or your business website. Add your address to the profile and it is picked up here
            automatically, or use this device's location now. Until the zone is on the map, customers are not warned about the fee, so riders would pay it alone.
          </p>
          <label className="block text-sm text-slate-300">Where it is (optional)
            <input value={form.location} onChange={(e) => set({ location: e.target.value })} placeholder="Plot 12, Kololo" className={inputClass} />
          </label>
        </>
      )}

      {note && <p className="text-xs cmms-tone-warn" role="status">{note}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={useDevice} disabled={locating} className={small}>
          {locating ? <Loader size={13} className="animate-spin" /> : <LocateFixed size={13} />} Use my location
        </button>
        {phase !== 'looking' && (
          <button type="button" onClick={() => lookUp({ fresh: true, replaceText: true })} className={small}>
            <RefreshCw size={13} /> Use my business profile
          </button>
        )}
      </div>
    </div>
  );
}

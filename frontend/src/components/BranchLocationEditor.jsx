import React, { useRef, useState } from 'react';
import { Check, ExternalLink, Loader, MapPin, X } from 'lucide-react';
import BranchLocationMap from './BranchLocationMap';
import { setBusinessLocation } from '../services/businessOwnershipService';
import { directionsUrl, reverseGeocode } from '../services/geocodeService';

const field = 'mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-500';
const DIRECTIONS_MAX = 600;

const validCoord = (value, limit) => {
  const number = Number(value);
  return value !== '' && value != null && Number.isFinite(number) && Math.abs(number) <= limit;
};

/**
 * Set where one branch (or the business itself, or a linked store) is.
 * `branch` is a row from fn_business_branch_locations (business_id, business_name,
 * depth, latitude, longitude, location_address, location_directions); every branch
 * in the tree gets its own pin. `save` replaces the default business save - the
 * store panel passes setSupermarketLocation - and `subtitle` the header line.
 *
 * The pin, its address and free-text directions are saved together. The
 * directions matter: a rider whose phone has no map data can still follow
 * "behind the Shell station, blue gate".
 */
export default function BranchLocationEditor({ branch, fallbackCenter, onClose, onSaved, save: saveLocation, subtitle }) {
  const [lat, setLat] = useState(branch.latitude != null ? Number(branch.latitude) : null);
  const [lng, setLng] = useState(branch.longitude != null ? Number(branch.longitude) : null);
  const [address, setAddress] = useState(branch.location_address || '');
  const [country, setCountry] = useState(null);
  const [directions, setDirections] = useState(branch.location_directions || '');
  const [typedLat, setTypedLat] = useState(branch.latitude != null ? String(Number(branch.latitude)) : '');
  const [typedLng, setTypedLng] = useState(branch.longitude != null ? String(Number(branch.longitude)) : '');
  const [resolving, setResolving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // Keep a hand-edited address when the pin moves a little, instead of overwriting it.
  const addressEdited = useRef(false);
  const lookupToken = useRef(0);

  const place = async (nextLat, nextLng, details = {}) => {
    const rounded = [Number(nextLat.toFixed(6)), Number(nextLng.toFixed(6))];
    setLat(rounded[0]);
    setLng(rounded[1]);
    setTypedLat(String(rounded[0]));
    setTypedLng(String(rounded[1]));
    setError('');
    if (details.address) {
      // A search result already names the place.
      if (!addressEdited.current) setAddress(details.address);
      setCountry(details.country || null);
      return;
    }
    const token = ++lookupToken.current;
    setResolving(true);
    const found = await reverseGeocode(rounded[0], rounded[1]);
    if (token !== lookupToken.current) return; // a newer placement superseded this lookup
    setResolving(false);
    if (found) {
      if (!addressEdited.current) setAddress(found.address);
      setCountry(found.country);
    }
  };

  const applyTyped = () => {
    if (!validCoord(typedLat, 90) || !validCoord(typedLng, 180)) {
      setError('Enter latitude between -90 and 90 and longitude between -180 and 180.');
      return;
    }
    place(Number(typedLat), Number(typedLng));
  };

  const save = async () => {
    if (lat == null || lng == null) { setError('Search for the place, tap the map, or enter coordinates first.'); return; }
    setSaving(true);
    setError('');
    const persist = saveLocation || ((payload) => setBusinessLocation(branch.business_id, payload));
    const { data, error: saveError } = await persist({
      latitude: lat,
      longitude: lng,
      address: address.trim() || null,
      directions: directions.trim() || null,
      country
    });
    setSaving(false);
    if (saveError) { setError(saveError.message || 'Could not save the location.'); return; }
    onSaved({ ...branch, latitude: lat, longitude: lng, location_address: address.trim() || null, location_directions: directions.trim() || null }, data);
  };

  const hasPin = lat != null && lng != null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-3">
      <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-950 p-4 shadow-2xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 font-bold text-white"><MapPin size={18} className="text-amber-400" /> Location</h3>
            <p className="truncate text-xs text-slate-400">{branch.business_name}{subtitle ?? (branch.depth > 0 ? ' - branch' : ' - head office')}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white" aria-label="Close"><X size={20} /></button>
        </div>

        <BranchLocationMap lat={lat} lng={lng} onChange={place} fallbackCenter={fallbackCenter} />

        <div className="mt-3 space-y-3">
          <label className="block text-xs text-slate-300">
            <span className="flex items-center gap-2">Address {resolving && <Loader size={12} className="animate-spin text-slate-500" />}</span>
            <input value={address} onChange={(event) => { addressEdited.current = true; setAddress(event.target.value); }}
              placeholder="Filled in from the pin - edit it if it is wrong" className={field} />
          </label>

          <label className="block text-xs text-slate-300">
            Directions for riders and visitors <span className="text-slate-500">(optional, works even with no map)</span>
            <textarea value={directions} onChange={(event) => setDirections(event.target.value.slice(0, DIRECTIONS_MAX))} rows={2}
              placeholder="e.g. Behind the Shell station on Jinja Road, blue gate, ask for the cashier" className={field} />
            <span className="block text-right text-[11px] text-slate-500">{directions.length}/{DIRECTIONS_MAX}</span>
          </label>

          <details className="rounded-lg border border-slate-800 bg-slate-900/50 p-2 text-xs text-slate-300">
            <summary className="cursor-pointer select-none text-slate-400">Enter coordinates yourself</summary>
            <div className="mt-2 grid grid-cols-[1fr_1fr_auto] items-end gap-2">
              <label>Latitude<input value={typedLat} onChange={(event) => setTypedLat(event.target.value)} inputMode="decimal" placeholder="0.3476" className={field} /></label>
              <label>Longitude<input value={typedLng} onChange={(event) => setTypedLng(event.target.value)} inputMode="decimal" placeholder="32.5825" className={field} /></label>
              <button type="button" onClick={applyTyped} className="mb-0 rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800">Place</button>
            </div>
          </details>

          {hasPin && (
            <a href={directionsUrl(lat, lng)} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-amber-300 hover:text-amber-200">
              <ExternalLink size={12} /> Check this pin in a separate map
            </a>
          )}

          {error && <p className="rounded-lg border border-red-800/50 bg-red-900/20 p-2 text-xs text-red-300">{error}</p>}

          <div className="flex gap-2">
            <button onClick={save} disabled={saving || !hasPin}
              className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-500 disabled:opacity-50">
              {saving ? <Loader size={14} className="animate-spin" /> : <Check size={14} />} Save location
            </button>
            <button onClick={onClose} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

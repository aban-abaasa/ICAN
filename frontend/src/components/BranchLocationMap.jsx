import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Loader, Locate, MapPin, Search } from 'lucide-react';
import { searchPlaces } from '../services/geocodeService';
import { describeGeoFailure, locateDevice } from '../utils/geolocation';

// Kampala - only where the map opens when nothing better is known.
const DEFAULT_CENTER = [0.3157, 32.5756];
const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
// Past this a network fix is a starting point to nudge, not the exact spot.
const APPROXIMATE_FIX_METERS = 1000;

// Self-contained pin, so there are no marker image files to bundle or fetch.
const pinIcon = () => L.divIcon({
  html: `<svg width="30" height="42" viewBox="0 0 30 42" xmlns="http://www.w3.org/2000/svg">
    <path d="M15 0C6.7 0 0 6.7 0 15c0 10.5 15 27 15 27s15-16.5 15-27C30 6.7 23.3 0 15 0z" fill="#f59e0b"/>
    <circle cx="15" cy="15" r="6" fill="white"/></svg>`,
  className: '',
  iconSize: [30, 42],
  iconAnchor: [15, 42]
});

/**
 * One draggable pin on a real map. The admin can search for a specific place
 * (and choose from the matches), tap anywhere, drag the pin, or use the
 * device location. Works from a phone with no GPS permission: search and tap
 * need none.
 *
 * Props:
 *   lat, lng      current pin (null/null when unset)
 *   onChange(lat, lng, { label })  fired for every placement; label is the place
 *                 name when it came from a search result
 *   fallbackCenter [lat, lng] where to open when there is no pin (e.g. head office)
 *   countryCode   ISO2 to keep search inside one country (optional)
 */
export default function BranchLocationMap({ lat, lng, onChange, fallbackCenter, countryCode, height = 300 }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const tileErrors = useRef(0);

  const [mapReady, setMapReady] = useState(false);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState(null);
  const [locating, setLocating] = useState(false);
  const [message, setMessage] = useState(null); // { tone: 'error' | 'info', text }
  const [tilesFailing, setTilesFailing] = useState(false);

  const hasPin = lat != null && lng != null && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return undefined;
    const center = hasPin ? [Number(lat), Number(lng)] : (fallbackCenter || DEFAULT_CENTER);
    const map = L.map(containerRef.current, { zoomControl: true }).setView(center, hasPin ? 16 : fallbackCenter ? 13 : 12);
    const tiles = L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map);
    tiles.on('tileerror', () => {
      tileErrors.current += 1;
      if (tileErrors.current >= 4) setTilesFailing(true);
    });
    tiles.on('tileload', () => {
      tileErrors.current = 0;
      setTilesFailing(false);
    });
    map.on('click', (event) => onChangeRef.current(event.latlng.lat, event.latlng.lng, {}));
    mapRef.current = map;
    setMapReady(true);
    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The pin follows the parent's value however it was set: tap, drag, search,
  // GPS, or typed coordinates.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !hasPin) return;
    const position = [Number(lat), Number(lng)];
    if (!markerRef.current) {
      const marker = L.marker(position, { icon: pinIcon(), draggable: true, title: 'Branch location' }).addTo(map);
      marker.on('dragend', () => {
        const at = marker.getLatLng();
        onChangeRef.current(at.lat, at.lng, {});
      });
      markerRef.current = marker;
    } else {
      markerRef.current.setLatLng(position);
    }
    // Recentre only when the pin has left the view, so dragging never makes the map jump under the finger.
    if (!map.getBounds().contains(position)) map.setView(position, Math.max(map.getZoom(), 16));
  }, [mapReady, lat, lng, hasPin]);

  const runSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    setMessage(null);
    setResults(null);
    const found = await searchPlaces(query, { countryCode });
    setSearching(false);
    if (found.length === 0) {
      setMessage({ tone: 'error', text: 'No place found. Try the shop or street name with the town, a landmark, or tap the map.' });
      return;
    }
    setResults(found);
  };

  const choose = (place) => {
    setResults(null);
    setQuery(place.name);
    onChangeRef.current(place.lat, place.lng, { label: place.name, address: place.displayName, country: place.country });
    mapRef.current?.setView([place.lat, place.lng], 17);
  };

  const useMyLocation = async () => {
    setLocating(true);
    setMessage(null);
    const result = await locateDevice();
    setLocating(false);
    if (!result.ok) {
      setMessage({ tone: 'error', text: describeGeoFailure(result.failure) });
      return;
    }
    const { fix } = result;
    onChangeRef.current(fix.lat, fix.lng, {});
    mapRef.current?.setView([fix.lat, fix.lng], fix.accuracy > APPROXIMATE_FIX_METERS ? 14 : 17);
    if (fix.accuracy > APPROXIMATE_FIX_METERS) {
      setMessage({ tone: 'info', text: 'This is an approximate location - drag the pin to the exact spot.' });
    }
  };

  return (
    <div className="space-y-2">
      <div className="relative">
        <div className="flex gap-2">
          <div className="flex flex-1 items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2">
            <Search size={16} className="shrink-0 text-slate-500" />
            <input
              value={query}
              onChange={(event) => { setQuery(event.target.value); setResults(null); }}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); runSearch(); } }}
              placeholder="Search a specific place: shop, street, landmark, town"
              className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
            />
          </div>
          <button type="button" onClick={runSearch} disabled={searching || query.trim().length < 2}
            className="flex items-center rounded-lg bg-amber-600 px-3 text-white hover:bg-amber-500 disabled:bg-slate-700 disabled:text-slate-500">
            {searching ? <Loader size={16} className="animate-spin" /> : <Search size={16} />}
          </button>
        </div>

        {results && (
          <ul className="absolute z-[1000] mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 shadow-xl">
            {results.map((place, index) => (
              <li key={`${place.lat}-${place.lng}-${index}`}>
                <button type="button" onClick={() => choose(place)} className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-slate-800">
                  <MapPin size={14} className="mt-0.5 shrink-0 text-amber-400" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-white">{place.name}</span>
                    <span className="block truncate text-xs text-slate-400">{place.displayName}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="relative overflow-hidden rounded-lg border border-slate-700" style={{ height, width: '100%' }}>
        <div ref={containerRef} style={{ height: '100%', width: '100%' }} />
        {!mapReady && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 bg-slate-900 text-sm text-slate-400">
            <Loader size={16} className="animate-spin" /> Loading map...
          </div>
        )}
      </div>

      {tilesFailing && (
        <p className="rounded-lg border border-amber-700/50 bg-amber-900/20 p-2 text-xs text-amber-200">
          The map pictures are not loading (weak connection?). You can still search for the place or type the coordinates below.
        </p>
      )}
      {message && (
        <p className={`rounded-lg p-2 text-xs ${message.tone === 'error' ? 'border border-red-800/50 bg-red-900/20 text-red-300' : 'border border-amber-700/50 bg-amber-900/20 text-amber-200'}`}>
          {message.text}
        </p>
      )}

      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={useMyLocation} disabled={locating}
          className="flex items-center gap-1.5 text-xs font-medium text-amber-300 hover:text-amber-200 disabled:opacity-50">
          <Locate size={14} className={locating ? 'animate-spin' : ''} /> {locating ? 'Finding you...' : 'Use my current location'}
        </button>
        <span className="text-[11px] text-slate-500">Tap the map or drag the pin to fine-tune</span>
      </div>
    </div>
  );
}

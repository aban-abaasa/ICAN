/**
 * Place search and reverse lookup for the branch location map.
 *
 * Free OpenStreetMap Nominatim, no API key. Its usage policy allows one
 * request a second, so every call goes through one queue; without it a fast
 * typist silently gets rate-limited and sees "no results" with no error.
 *
 * Every function resolves (never throws): search returns [] and reverse
 * returns null when the lookup fails, so the map keeps working by tap/drag.
 */

const NOMINATIM = 'https://nominatim.openstreetmap.org';
const MIN_INTERVAL_MS = 1100;

let lastRequestAt = 0;
let queue = Promise.resolve();

function throttledFetch(url) {
  const run = async () => {
    const wait = Math.max(0, lastRequestAt + MIN_INTERVAL_MS - Date.now());
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequestAt = Date.now();
    return fetch(url, { headers: { Accept: 'application/json' } });
  };
  const result = queue.then(run);
  // One failed request must not jam the queue for every request after it.
  queue = result.then(() => undefined, () => undefined);
  return result;
}

/**
 * Real places matching a typed query - several, so the admin can choose the
 * exact one (a bare "Shell" matches hundreds).
 * countryCode is an optional ISO2 code (e.g. "ug") that restricts results to a country.
 * Resolves to [{ name, displayName, lat, lng, country }].
 */
export async function searchPlaces(query, { countryCode, limit = 6 } = {}) {
  const q = (query || '').trim();
  if (q.length < 2) return [];
  const params = new URLSearchParams({ format: 'json', limit: String(limit), q, addressdetails: '1', 'accept-language': 'en' });
  if (countryCode) params.set('countrycodes', countryCode.toLowerCase());
  try {
    const res = await throttledFetch(`${NOMINATIM}/search?${params.toString()}`);
    if (!res.ok) return [];
    const rows = await res.json();
    return (rows || [])
      .map((row) => ({
        name: row.name || row.display_name?.split(',')[0] || q,
        displayName: row.display_name,
        lat: Number(row.lat),
        lng: Number(row.lon),
        country: row.address?.country || null
      }))
      .filter((place) => Number.isFinite(place.lat) && Number.isFinite(place.lng));
  } catch {
    return [];
  }
}

/** The address and country a map pin sits on, or null when the lookup fails. */
export async function reverseGeocode(lat, lng) {
  const params = new URLSearchParams({ format: 'json', lat: String(lat), lon: String(lng), addressdetails: '1', 'accept-language': 'en' });
  try {
    const res = await throttledFetch(`${NOMINATIM}/reverse?${params.toString()}`);
    if (!res.ok) return null;
    const row = await res.json();
    if (!row?.display_name) return null;
    return { address: row.display_name, country: row.address?.country || null };
  } catch {
    return null;
  }
}

/** A link that opens turn-by-turn directions to the pin in any browser - nothing to install. */
export function directionsUrl(lat, lng) {
  return `https://www.openstreetmap.org/directions?to=${lat}%2C${lng}#map=17/${lat}/${lng}`;
}

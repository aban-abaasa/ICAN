// Where a restricted zone is, worked out from what the business has already told us, so nobody types coordinates.
// Pure functions: no network. The lookups that need the database or a geocoder live in services/zoneLocationService.js.
//
// Order of trust (most exact first):
//   1. the pin on the Pitchin business profile (business_profiles.latitude / longitude)
//   2. the pin inside the Google Maps link on the business website (cmms_company_profiles.google_maps_url)
//   3. the Pitchin business address, looked up on a map
//   4. the location written on the business website, looked up on a map
// 3 and 4 are only as good as the address text, so they are marked approximate.

export const LOCATION_SOURCE_LABELS = {
  pitchin: 'From your Pitchin business profile',
  'website-map': 'From the map link on your business website',
  'pitchin-address': 'Found from your Pitchin business address',
  'website-address': 'Found from the location on your business website',
  device: "From this device's location",
  saved: 'Saved for this zone',
};

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

const toNumber = (value) => {
  if (value === '' || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

// 0,0 is what an empty location column usually turns into, never a real business.
export const isUsablePin = (latitude, longitude) =>
  latitude != null && longitude != null && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 && !(latitude === 0 && longitude === 0);

const MAPS_PIN_PATTERNS = [
  /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/,                                          // the marker itself
  /[?&](?:q|query|ll|destination|daddr)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/,       // an explicit target
  /@(-?\d+\.\d+),(-?\d+\.\d+)/,                                              // the map's centre: close enough when no marker is given
];

/** The coordinates inside a pasted Google Maps link, or null (short links and ?cid= links carry none). */
export function parseGoogleMapsPin(url) {
  let text = clean(url);
  if (!text) return null;
  try { text = decodeURIComponent(text); } catch { /* keep the text as it was typed */ }
  for (const pattern of MAPS_PIN_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;
    const latitude = Number(match[1]);
    const longitude = Number(match[2]);
    if (isUsablePin(latitude, longitude)) return { latitude, longitude };
  }
  return null;
}

/**
 * What to search for to find an address on a map: the address as written, then the same without its first part
 * ("Plot 12, Kololo, Kampala" -> "Kololo, Kampala"), because plot numbers and house names are what maps do not know.
 */
export function addressQueries(text) {
  const full = clean(text);
  if (full.length < 2) return [];
  const parts = full.split(',').map((part) => part.trim()).filter(Boolean);
  return parts.length >= 3 ? [full, parts.slice(1).join(', ')] : [full];
}

/**
 * Decide where a business is from its Pitchin profile row and its CMMS company (website) row.
 * Returns { pin, searches, countryCode, address }:
 *   pin        an exact point already on record, { latitude, longitude, address, source, approximate: false }, or null
 *   searches   addresses to look up on a map when there is no pin, best first: [{ query, address, source }]
 *   countryCode  the business's ISO2 country, to keep a search inside it, or null
 *   address    the best address text we have, so the zone can be labelled even when it cannot be placed
 */
export function planBusinessLocation({ pitchin, website } = {}) {
  const pitchinAddress = clean(pitchin?.location_address) || clean(pitchin?.business_address);
  const websiteAddress = clean(website?.location);
  const address = pitchinAddress || websiteAddress;
  const countryCode = /^[A-Za-z]{2}$/.test(clean(pitchin?.country)) ? clean(pitchin.country).toLowerCase() : null;

  const latitude = toNumber(pitchin?.latitude);
  const longitude = toNumber(pitchin?.longitude);
  if (isUsablePin(latitude, longitude)) {
    return { pin: { latitude, longitude, address, source: 'pitchin', approximate: false }, searches: [], countryCode, address };
  }

  const mapPin = parseGoogleMapsPin(website?.google_maps_url);
  if (mapPin) {
    return { pin: { ...mapPin, address: websiteAddress || pitchinAddress, source: 'website-map', approximate: false }, searches: [], countryCode, address };
  }

  const searches = [];
  const seen = new Set();
  const consider = (text, source) => {
    for (const query of addressQueries(text)) {
      const key = query.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      searches.push({ query, address: clean(text), source });
    }
  };
  consider(pitchin?.location_address, 'pitchin-address');
  consider(pitchin?.business_address, 'pitchin-address');
  consider(website?.location, 'website-address');
  return { pin: null, searches, countryCode, address };
}

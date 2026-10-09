/**
 * Forgiving device-location lookup (same approach as BodaGoEra's map picker).
 *
 * A single high-accuracy getCurrentPosition call reports "denied or
 * unavailable" for very different things: the user said no, the page is on
 * plain HTTP, a laptop has no GPS chip, or a phone indoors found no satellite
 * in time. Only a refusal is final - otherwise the network (Wi-Fi / cell)
 * position is tried next. The result says WHY it failed so the UI can help.
 *
 * Resolves to { ok: true, fix: { lat, lng, accuracy, source } }
 *           or { ok: false, failure: 'unsupported'|'insecure'|'denied'|'unavailable'|'timeout' }.
 * Never throws.
 */

const getPosition = (options) => new Promise((resolve) => {
  navigator.geolocation.getCurrentPosition(resolve, resolve, options);
});

const isPosition = (value) => value && 'coords' in value;

export async function locateDevice() {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return { ok: false, failure: 'unsupported' };
  if (typeof window !== 'undefined' && window.isSecureContext === false) return { ok: false, failure: 'insecure' };

  const accurate = await getPosition({ enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 });
  if (isPosition(accurate)) {
    return { ok: true, fix: { lat: accurate.coords.latitude, lng: accurate.coords.longitude, accuracy: accurate.coords.accuracy, source: 'gps' } };
  }
  if (accurate.code === 1) return { ok: false, failure: 'denied' };

  const coarse = await getPosition({ enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 });
  if (isPosition(coarse)) {
    return { ok: true, fix: { lat: coarse.coords.latitude, lng: coarse.coords.longitude, accuracy: coarse.coords.accuracy, source: 'network' } };
  }
  return { ok: false, failure: coarse.code === 3 ? 'timeout' : 'unavailable' };
}

export function describeGeoFailure(failure) {
  switch (failure) {
    case 'denied':
      return 'Location is blocked for this site. Allow it from the lock icon in the address bar - or just search for the place or tap the map.';
    case 'insecure':
      return 'Phones only share their location on a secure (https) page. Search for the place or tap the map instead.';
    case 'unsupported':
      return 'This device cannot share its location. Search for the place or tap the map instead.';
    case 'timeout':
      return 'No location fix in time (indoors or weak signal?). Try again, or search for the place or tap the map.';
    default:
      return 'Your location is not available right now. Search for the place or tap the map instead.';
  }
}

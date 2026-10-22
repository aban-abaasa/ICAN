import { supabase } from '../lib/supabase/client';
import { searchPlaces } from './geocodeService';
import { planBusinessLocation } from '../utils/zoneLocation';

// Finds where a restricted zone is from the business itself: its Pitchin profile and its website (the CMMS company row the
// caller already has). Never throws: a miss resolves to { latitude: null, longitude: null }, and the editor then asks the
// person to use their device instead.

// The pin columns only exist once BUSINESS_BRANCH_LOCATIONS.sql has run, so the first read asks for them and the second
// does not. A person who cannot read the profile (it is owner-readable) gets null here and falls back to the website.
const PITCHIN_WITH_PIN = 'business_name, business_address, country, website, latitude, longitude, location_address';
const PITCHIN_BASIC = 'business_name, business_address, country, website';

async function readPitchinProfile(businessProfileId) {
  for (const columns of [PITCHIN_WITH_PIN, PITCHIN_BASIC]) {
    try {
      const { data, error } = await supabase.from('business_profiles').select(columns).eq('id', businessProfileId).maybeSingle();
      if (!error) return data || null;
    } catch { /* try the next set of columns */ }
  }
  return null;
}

const round6 = (value) => Number(Number(value).toFixed(6));

async function locate({ businessProfileId, companyProfile }) {
  const pitchin = businessProfileId ? await readPitchinProfile(businessProfileId) : null;
  const plan = planBusinessLocation({ pitchin, website: companyProfile });
  if (plan.pin) return { ...plan.pin, latitude: round6(plan.pin.latitude), longitude: round6(plan.pin.longitude) };

  for (const search of plan.searches) {
    const [place] = await searchPlaces(search.query, { countryCode: plan.countryCode, limit: 1 });
    if (place) return { latitude: round6(place.lat), longitude: round6(place.lng), address: search.address, source: search.source, approximate: true };
  }
  return { latitude: null, longitude: null, address: plan.address, source: null, approximate: false };
}

// Opening the editor twice in a row (or React running an effect twice) should not look the same business up twice.
const found = new Map();

/**
 * Where this business is. { latitude, longitude, address, source, approximate }: latitude and longitude are null when
 * nothing on the profile or the website could be placed on a map; address is then the best text there is, or ''.
 * Pass { fresh: true } to look again after the profile was changed.
 */
export async function findBusinessLocation({ businessProfileId, companyProfile }, { fresh = false } = {}) {
  const key = String(businessProfileId || companyProfile?.id || '');
  if (!fresh && found.has(key)) return found.get(key);
  const pending = locate({ businessProfileId, companyProfile }).catch(() => ({ latitude: null, longitude: null, address: '', source: null, approximate: false }));
  found.set(key, pending);
  const result = await pending;
  if (result.latitude == null && found.get(key) === pending) found.delete(key); // a miss is not remembered
  return result;
}

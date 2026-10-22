import test from 'node:test';
import assert from 'node:assert/strict';
import { addressQueries, isUsablePin, parseGoogleMapsPin, planBusinessLocation } from '../src/utils/zoneLocation.js';

// Restricted zones: where a zone is, taken from the business's Pitchin profile and website instead of typed in.

test('a Google Maps link gives its coordinates: the marker, an explicit target, or the map centre', () => {
  assert.deepEqual(parseGoogleMapsPin('https://www.google.com/maps/place/Kololo/data=!3d0.3340!4d32.5900'), { latitude: 0.334, longitude: 32.59 });
  assert.deepEqual(parseGoogleMapsPin('https://www.google.com/maps?q=0.3476,32.5825'), { latitude: 0.3476, longitude: 32.5825 });
  assert.deepEqual(parseGoogleMapsPin('https://www.google.com/maps/dir/?api=1&destination=0.3476%2C32.5825'), { latitude: 0.3476, longitude: 32.5825 });
  assert.deepEqual(parseGoogleMapsPin('https://www.google.com/maps/@0.3476,32.5825,15z'), { latitude: 0.3476, longitude: 32.5825 });
  assert.deepEqual(parseGoogleMapsPin('https://www.google.com/maps/place/X/@-1.2921,36.8219,17z/data=!3d-1.2900!4d36.8200'), { latitude: -1.29, longitude: 36.82 });
});

test('a link with no coordinates in it gives nothing', () => {
  for (const url of ['https://maps.app.goo.gl/AbCdEf123', 'https://www.google.com/maps?cid=12345678901234567', 'https://www.google.com/maps?q=Kololo+Heights', 'not a link', '', null, undefined]) {
    assert.equal(parseGoogleMapsPin(url), null, String(url));
  }
});

test('0,0 and out-of-range points are not a place', () => {
  assert.equal(isUsablePin(0, 0), false);
  assert.equal(isUsablePin(91, 10), false);
  assert.equal(isUsablePin(10, 181), false);
  assert.equal(isUsablePin(null, 10), false);
  assert.equal(isUsablePin(0.3476, 32.5825), true);
  assert.equal(isUsablePin(0, 32.5825), true); // on the equator is a real place; Uganda crosses it
  assert.equal(parseGoogleMapsPin('https://www.google.com/maps?q=0.0,0.0'), null);
});

test('an address is searched as written, then without its plot number', () => {
  assert.deepEqual(addressQueries('Plot 12, Kololo, Kampala'), ['Plot 12, Kololo, Kampala', 'Kololo, Kampala']);
  assert.deepEqual(addressQueries('  Kololo ,   Kampala '), ['Kololo , Kampala']);
  assert.deepEqual(addressQueries('Kampala'), ['Kampala']);
  assert.deepEqual(addressQueries(''), []);
  assert.deepEqual(addressQueries(null), []);
});

test('the Pitchin pin wins over everything else', () => {
  const plan = planBusinessLocation({
    pitchin: { latitude: '0.3300', longitude: 32.59, location_address: 'Kololo, Kampala', business_address: 'P.O. Box 1', country: 'UG' },
    website: { location: 'Ntinda', google_maps_url: 'https://www.google.com/maps/@0.35,32.6,15z' },
  });
  assert.deepEqual(plan.pin, { latitude: 0.33, longitude: 32.59, address: 'Kololo, Kampala', source: 'pitchin', approximate: false });
  assert.deepEqual(plan.searches, []);
});

test('an empty Pitchin pin (null or 0,0) falls through to the website map link', () => {
  for (const pitchin of [{ latitude: null, longitude: null }, { latitude: 0, longitude: 0 }, { latitude: '', longitude: '' }, {}]) {
    const plan = planBusinessLocation({
      pitchin: { ...pitchin, business_address: 'Plot 12, Kololo' },
      website: { location: 'Kololo, Kampala', google_maps_url: 'https://www.google.com/maps/place/X/data=!3d0.334!4d32.59' },
    });
    assert.deepEqual(plan.pin, { latitude: 0.334, longitude: 32.59, address: 'Kololo, Kampala', source: 'website-map', approximate: false });
  }
});

test('with no pin anywhere, the addresses are searched: Pitchin first, then the website, each once', () => {
  const plan = planBusinessLocation({
    pitchin: { business_address: 'Plot 12, Kololo, Kampala', country: 'ug' },
    website: { location: 'plot 12, kololo, kampala', google_maps_url: 'https://maps.app.goo.gl/short' },
  });
  assert.equal(plan.pin, null);
  assert.equal(plan.countryCode, 'ug');
  assert.deepEqual(plan.searches.map((s) => [s.query, s.source]), [
    ['Plot 12, Kololo, Kampala', 'pitchin-address'],
    ['Kololo, Kampala', 'pitchin-address'],
  ]);
  assert.equal(plan.address, 'Plot 12, Kololo, Kampala');
});

test('a profile address that is only a location on the website still gets searched', () => {
  const plan = planBusinessLocation({ pitchin: { country: 'Uganda' }, website: { location: 'Ntinda' } });
  assert.deepEqual(plan.searches, [{ query: 'Ntinda', address: 'Ntinda', source: 'website-address' }]);
  assert.equal(plan.countryCode, null); // a country name is not an ISO2 code, so it cannot restrict the search
});

test('a business with no location anywhere gets an empty plan, not an error', () => {
  for (const input of [undefined, {}, { pitchin: null, website: null }, { pitchin: { business_address: '  ' }, website: { location: '' } }]) {
    const plan = planBusinessLocation(input);
    assert.equal(plan.pin, null);
    assert.deepEqual(plan.searches, []);
    assert.equal(plan.address, '');
  }
});

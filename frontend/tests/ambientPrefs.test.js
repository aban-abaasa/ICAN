import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AMBIENT_INTENSITIES, AMBIENT_STYLES, defaultAmbientPrefs, sanitizeAmbientPrefs,
} from '../src/lib/ambientPrefs.js';

test('defaults: on, chain style, balanced, animated', () => {
  assert.deepEqual(defaultAmbientPrefs(), { enabled: true, style: 'chain', intensity: 'balanced', motion: true });
});

test('defaults: a device that asks for calm (reduced motion / save-data) starts still, but still on', () => {
  const calm = defaultAmbientPrefs({ calm: true });
  assert.equal(calm.motion, false);
  assert.equal(calm.enabled, true);
});

test('nothing stored (or junk) gives the defaults', () => {
  for (const raw of [null, undefined, 'x', 7, [], {}]) {
    assert.deepEqual(sanitizeAmbientPrefs(raw), defaultAmbientPrefs());
  }
});

test('a saved choice is kept, including turning it off', () => {
  const saved = { enabled: false, style: 'lattice', intensity: 'vivid', motion: false };
  assert.deepEqual(sanitizeAmbientPrefs(saved), saved);
});

test('bad values fall back one field at a time and never throw', () => {
  const out = sanitizeAmbientPrefs({ enabled: 'yes', style: 'sparkles', intensity: 11, motion: false });
  assert.equal(out.enabled, true);
  assert.equal(out.style, 'chain');
  assert.equal(out.intensity, 'balanced');
  assert.equal(out.motion, false);
});

test('every offered style and strength is accepted as-is', () => {
  for (const style of AMBIENT_STYLES) assert.equal(sanitizeAmbientPrefs({ style }).style, style);
  for (const intensity of AMBIENT_INTENSITIES) assert.equal(sanitizeAmbientPrefs({ intensity }).intensity, intensity);
});

test('fallback uses the supplied defaults (so a calm device stays still when only other fields are saved)', () => {
  const out = sanitizeAmbientPrefs({ style: 'lattice' }, defaultAmbientPrefs({ calm: true }));
  assert.equal(out.style, 'lattice');
  assert.equal(out.motion, false);
});

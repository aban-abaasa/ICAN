import { useCallback, useSyncExternalStore } from 'react';

/**
 * The "Blockchain background" setting (Settings > Appearance): a faint ambient
 * layer of interlocking diamonds over every signed-in page, which the user can
 * switch off or tune. Kept per device in localStorage -- like the theme -- and
 * shared live between the Settings card, the backdrop and other open tabs.
 *
 *   enabled    on / off
 *   style      'lattice' (calm woven diamonds) | 'chain' (the lattice plus
 *              chains of blocks lighting up with data packets running)
 *   intensity  'subtle' | 'balanced' | 'vivid'
 *   motion     animated (true) or still (false)
 */

export const AMBIENT_KEY = 'icanera-ambient';
export const AMBIENT_STYLES = ['lattice', 'chain'];
export const AMBIENT_INTENSITIES = ['subtle', 'balanced', 'vivid'];

export const defaultAmbientPrefs = ({ calm = false } = {}) => ({
  enabled: true,
  style: 'chain',
  intensity: 'balanced',
  // People who asked their device for less motion, or for less data, start with a still background.
  motion: !calm,
});

/** Whatever is in storage -> a complete, valid set of prefs. Unknown / bad values fall back to the defaults. */
export const sanitizeAmbientPrefs = (raw, defaults = defaultAmbientPrefs()) => {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : defaults.enabled,
    style: AMBIENT_STYLES.includes(r.style) ? r.style : defaults.style,
    intensity: AMBIENT_INTENSITIES.includes(r.intensity) ? r.intensity : defaults.intensity,
    motion: typeof r.motion === 'boolean' ? r.motion : defaults.motion,
  };
};

const wantsCalm = () => {
  try {
    return Boolean(
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || navigator.connection?.saveData,
    );
  } catch {
    return false;
  }
};

const readStored = () => {
  const defaults = defaultAmbientPrefs({ calm: wantsCalm() });
  try {
    const raw = localStorage.getItem(AMBIENT_KEY);
    return sanitizeAmbientPrefs(raw ? JSON.parse(raw) : null, defaults);
  } catch {
    return defaults;
  }
};

let current = null;
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());

export const getAmbientPrefs = () => {
  if (!current) current = readStored();
  return current;
};

export const setAmbientPrefs = (patch) => {
  current = sanitizeAmbientPrefs({ ...getAmbientPrefs(), ...patch }, getAmbientPrefs());
  try { localStorage.setItem(AMBIENT_KEY, JSON.stringify(current)); } catch { /* private mode: keep it for this visit */ }
  emit();
};

const subscribe = (fn) => {
  listeners.add(fn);
  const onStorage = (e) => {
    if (e.key !== AMBIENT_KEY && e.key !== null) return;
    current = readStored();
    fn();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener('storage', onStorage);
  };
};

/** [prefs, update] -- `update({ enabled: false })` merges, saves and re-renders every user of the setting. */
export const useAmbientPrefs = () => {
  const prefs = useSyncExternalStore(subscribe, getAmbientPrefs, () => defaultAmbientPrefs());
  const update = useCallback((patch) => setAmbientPrefs(patch), []);
  return [prefs, update];
};

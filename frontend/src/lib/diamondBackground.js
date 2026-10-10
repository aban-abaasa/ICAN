import { useSyncExternalStore } from 'react';

// The "diamond background" preference: a faint blockchain-diamond watermark behind every ICAN page, switched
// on/off (and between two strengths) in Settings > Appearance. Stored on this device only -- it is a look, not
// account data -- and shared live between the settings panel and the backdrop through a small store, so
// flipping the switch changes the page underneath straight away.

export const DIAMOND_LEVELS = ['off', 'subtle', 'rich'];
export const DEFAULT_DIAMOND_LEVEL = 'subtle';
const KEY = 'ican_diamond_bg';

const listeners = new Set();
let current = null;

const read = () => {
  try {
    const saved = localStorage.getItem(KEY);
    if (DIAMOND_LEVELS.includes(saved)) return saved;
  } catch { /* storage blocked: use the default */ }
  return DEFAULT_DIAMOND_LEVEL;
};

export const getDiamondLevel = () => {
  if (current === null) current = read();
  return current;
};

export const setDiamondLevel = (level) => {
  if (!DIAMOND_LEVELS.includes(level)) return;
  current = level;
  try { localStorage.setItem(KEY, level); } catch { /* the choice just won't be remembered */ }
  listeners.forEach((fn) => fn());
};

const subscribe = (fn) => {
  listeners.add(fn);
  // Another tab changed it.
  const onStorage = (e) => {
    if (e.key === KEY) { current = read(); fn(); }
  };
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(fn); window.removeEventListener('storage', onStorage); };
};

export const useDiamondLevel = () => useSyncExternalStore(subscribe, getDiamondLevel, () => DEFAULT_DIAMOND_LEVEL);

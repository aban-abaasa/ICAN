import { useCallback, useEffect, useRef, useState } from 'react';
import { getMyStatusUpdates } from '../services/statusUpdatesService';
import {
  HINT_FIRST_DELAY_MS, HINT_GAP_MS, nextHint, announce, markOpened, pruneSeen, loadSeen, saveSeen,
} from '../utils/statusUpdateHints';

/**
 * Decides which gentle hint, if any, to show on the signed-in user's own status cards, one at a time (rules in utils/statusUpdateHints.js).
 *
 *   userId       whose device memory to use (what was already announced)
 *   statusIds    the ids of the cards on screen, in the order shown
 *   enabled      false while the cards are hidden or a status is open: nothing is shown and nothing is used up
 *
 * Returns { active, done(hint), opened(statusId) }:
 *   active   the hint to show now ({ statusId, kind, text, open }) or null
 *   done     call when a hint has been shown and slid away (or was dismissed): it will not be announced again
 *   opened   call when the person opens one of their statuses: everything on it counts as seen
 * It looks for news when the cards appear, every minute while the page is in view, and when the person comes back to the tab.
 */
export default function useStatusUpdateHints({ userId, statusIds, enabled = true, firstDelayMs = HINT_FIRST_DELAY_MS, gapMs = HINT_GAP_MS, pollMs = 60000 }) {
  const [updates, setUpdates] = useState(() => new Map());
  const [seen, setSeen] = useState(() => (userId ? loadSeen(userId) : {}));
  const [active, setActive] = useState(null);
  const updatesRef = useRef(updates);
  updatesRef.current = updates;
  const shownBefore = useRef(false);
  const idsKey = statusIds.join(',');

  // another person signed in on this device: their own memory
  useEffect(() => { setSeen(userId ? loadSeen(userId) : {}); setActive(null); }, [userId]);

  // look for news
  useEffect(() => {
    if (!userId || !enabled || statusIds.length === 0) return undefined;
    let cancelled = false;
    const load = async () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const map = await getMyStatusUpdates();
      if (cancelled) return;
      setUpdates(map);
      setSeen((current) => {
        const pruned = pruneSeen(current, [...map.keys()]);
        if (Object.keys(pruned).length === Object.keys(current).length) return current;
        saveSeen(userId, pruned);
        return pruned;
      });
    };
    load();
    const timer = setInterval(load, pollMs);
    window.addEventListener('focus', load);
    return () => { cancelled = true; clearInterval(timer); window.removeEventListener('focus', load); };
  }, [userId, enabled, idsKey, pollMs]);

  // pick the next hint once nothing is showing (a quiet beat first, so it never lands the instant the page does)
  useEffect(() => {
    if (!enabled || active) return undefined;
    const hint = nextHint(updates, statusIds, seen);
    if (!hint) return undefined;
    const timer = setTimeout(() => { shownBefore.current = true; setActive(hint); }, shownBefore.current ? gapMs : firstDelayMs);
    return () => clearTimeout(timer);
  }, [enabled, active, updates, seen, idsKey, firstDelayMs, gapMs]);

  // the cards went away while a hint was up: drop it without using it up, so it comes back when they return
  useEffect(() => { if (!enabled && active) setActive(null); }, [enabled, active]);

  const done = useCallback((hint) => {
    const update = updatesRef.current.get(hint.statusId);
    setSeen((current) => {
      const next = update ? announce(current, update, hint) : current;
      if (userId) saveSeen(userId, next);
      return next;
    });
    setActive((current) => (current && current.statusId === hint.statusId ? null : current));
  }, [userId]);

  const opened = useCallback((statusId) => {
    const update = updatesRef.current.get(statusId);
    setSeen((current) => {
      const next = update ? markOpened(current, update) : current;
      if (userId) saveSeen(userId, next);
      return next;
    });
    setActive((current) => (current && current.statusId === statusId ? null : current));
  }, [userId]);

  return { active, done, opened };
}

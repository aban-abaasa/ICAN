import React from 'react';

// A stale service-worker/browser cache can leave a phone holding an
// index.html that points at a JS chunk hash the last deploy removed from the
// server — the chunk 404s, the dynamic import() rejects, and with no retry
// the Suspense fallback is the last thing that ever renders: a silent blank
// screen with no error visible to the user or to us.
//
// Two layers of recovery, because a weak mobile connection also makes a
// perfectly valid chunk fail once:
//   1. retry the import in place (cheap, fixes a dropped request);
//   2. if it still fails while online, wipe the service worker + caches and
//      reload once so the fresh index.html/chunks are fetched.
const RELOADED_KEY = 'ican-chunk-reload-attempted';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const importWithRetry = async (importer) => {
  try {
    return await importer();
  } catch (firstError) {
    // Offline the file simply is not cached; retrying is pointless and the
    // caller decides what to show.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw firstError;
    await sleep(700);
    return importer();
  }
};

export const lazyWithRetry = (importer) => React.lazy(() =>
  importWithRetry(importer).catch(async (error) => {
    // Offline, wiping the service worker and caches would destroy the one
    // thing still letting the app open offline at all. Surface it as a normal
    // render error and leave the cache alone.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw error;
    }
    let alreadyRetried = false;
    try {
      alreadyRetried = !!sessionStorage.getItem(RELOADED_KEY);
      if (!alreadyRetried) sessionStorage.setItem(RELOADED_KEY, '1');
    } catch (_) { /* storage blocked: fall through to one reload attempt */ }
    if (alreadyRetried) {
      throw error; // Already retried once this session — a real error, not a stale cache.
    }
    console.warn('[App] Chunk load failed, clearing caches and reloading once:', error);
    try {
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));
      }
      if ('caches' in window) {
        const names = await caches.keys();
        await Promise.all(names.map((name) => caches.delete(name)));
      }
    } catch (cleanupError) {
      console.warn('[App] Cache cleanup before reload failed:', cleanupError);
    }
    window.location.reload();
    return new Promise(() => {}); // Hang here; the reload is already in flight.
  })
);

// Fetch a chunk in the background once the phone is idle, so the screen is
// already on the device by the time the user taps into it. Failures are
// ignored on purpose: the real import() on tap will retry and report.
export const prefetchWhenIdle = (importers, delayMs = 2500) => {
  if (typeof window === 'undefined') return () => {};
  // Do not spend a metered / slow connection on speculative downloads.
  const connection = navigator.connection;
  if (connection && (connection.saveData || /(^|-)2g$/.test(connection.effectiveType || ''))) return () => {};
  let cancelled = false;
  const run = () => {
    if (cancelled) return;
    importers.reduce((chain, importer) => chain.then(() => (cancelled ? null : importer())).catch(() => {}), Promise.resolve());
  };
  const start = () => {
    if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 4000 });
    else setTimeout(run, 0);
  };
  const timer = setTimeout(start, delayMs);
  return () => { cancelled = true; clearTimeout(timer); };
};

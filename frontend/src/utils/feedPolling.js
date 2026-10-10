// Pure helpers for the live icaneracoin feed: how long to wait between polls, how to merge a "newest candles only"
// answer into the chart, and how fresh the chart can honestly claim to be. No network, no React, no clock of their
// own (the caller passes `now` and `rand`), so every rule here is testable.

export const BASE_POLL_MS = 4_000; // one cheap, usually "unchanged", request every few seconds while the tab is visible
export const MAX_BACKOFF_MS = 60_000;
export const PUSH_THROTTLE_MS = 1_500; // a server "something changed" ping triggers at most one refetch per this long
export const FULL_REFRESH_EVERY = 20; // every Nth successful poll re-reads the whole window instead of only the newest candles
export const LIVE_WITHIN_MS = 15_000;
export const DELAYED_WITHIN_MS = 60_000;

// Wait before the next poll. A healthy feed polls every `base` ms; each consecutive failure doubles the wait (up to a
// minute) so a struggling server is not hammered by every open chart at once, and every wait is jittered by +-20% so
// thousands of charts opened in the same second do not stay in lockstep forever.
export const pollDelay = ({ failures = 0, base = BASE_POLL_MS, rand = Math.random } = {}) => {
  const wait = failures > 0 ? Math.min(MAX_BACKOFF_MS, base * 2 ** Math.min(failures, 6)) : base;
  return Math.round(wait * (0.8 + rand() * 0.4));
};

// Whether the next request should ask for everything (no version, no "after") rather than a delta.
export const needsFullRefresh = ({ pollsSinceFull = 0, haveCandles = false, lastFullAt = 0, now = Date.now() } = {}) =>
  !haveCandles || pollsSinceFull >= FULL_REFRESH_EVERY || now - lastFullAt > 10 * 60_000;

// Merge candles that arrived (any order) into those already held (oldest first), keyed by open_time. A candle that
// arrives again replaces the held one -- that is how the current window's last price and volume update. Result is
// oldest first, capped to the newest `limit`.
export const mergeCandles = (held, incoming, limit = 500) => {
  const byTime = new Map();
  for (const c of held || []) byTime.set(c.timestamp, c);
  for (const c of incoming || []) if (c && c.timestamp) byTime.set(c.timestamp, c);
  const merged = [...byTime.values()].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  return merged.length > limit ? merged.slice(merged.length - limit) : merged;
};

// How the chart describes itself: 'connecting' before the first answer, 'live' while answers are recent, 'delayed' for
// up to a minute without one, 'offline' beyond that (it keeps drawing the last data it has, labelled as such).
export const feedStatus = ({ lastOkAt = null, now = Date.now() } = {}) => {
  if (lastOkAt == null) return 'connecting';
  const age = Math.max(0, now - lastOkAt);
  if (age <= LIVE_WITHIN_MS) return 'live';
  if (age <= DELAYED_WITHIN_MS) return 'delayed';
  return 'offline';
};

// True when a Supabase/PostgREST error means "this database function is not installed yet" (the SQL migration has not
// been run), so the caller can fall back to the older way instead of showing an error.
export const isMissingFunction = (error) => {
  if (!error) return false;
  const code = String(error.code || '');
  const text = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`;
  return code === 'PGRST202' || code === '42883' || /could not find the function|function .* does not exist/i.test(text);
};

// A feed candle the chart can safely draw: finite, positive prices with the wick covering the body. Anything else is
// dropped rather than letting one bad row blow up the price scale.
export const isDrawableCandle = (c) => {
  if (!c) return false;
  const { open, high, low, close } = c;
  return [open, high, low, close].every((n) => Number.isFinite(n) && n > 0) && high >= low;
};

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase/client';
import { getSectorFeed } from '../services/sectorMarketService';
import { toSectorCandles } from '../utils/sectorTradeRules';
import { PUSH_THROTTLE_MS, pollDelay, feedStatus } from '../utils/feedPolling';

// The live sector indices for the Sector Markets screen.
//
// It asks ONE function (ican_get_sector_feed) for every sector's level plus the selected sector's candles, and says which
// version it already holds, so a quiet market answers "unchanged" in a few bytes. It polls only while the tab is visible,
// waits longer after each failure (jittered, so open screens do not retry in lockstep) and never overlaps two requests.
// Changing the selected sector asks for everything again, because the candles belong to the sector.
// `available` is false when the database functions have not been installed yet (the screen then hides itself).
// `status` is 'connecting' | 'live' | 'delayed' | 'offline'.
// `enabled: false` (a section scrolled out of view on a public page) loads once, so the caller learns whether the feature
// exists, then stops asking until it is enabled again.

// Optional push: the database pings "something changed" (a version number, never levels) so the screen can refresh within
// about a second. OFF by default, like the icaneracoin chart's: every open screen would hold a Realtime connection.
const PUSH_ENABLED = (() => { try { return import.meta.env.VITE_SECTOR_PUSH === 'true'; } catch { return false; } })();
let pushChannel = null;
const pushListeners = new Set();
const subscribePush = (listener) => {
  if (!PUSH_ENABLED) return () => {};
  pushListeners.add(listener);
  if (!pushChannel) {
    try {
      pushChannel = supabase
        .channel('icanera-sectors')
        .on('broadcast', { event: 'tick' }, () => pushListeners.forEach((fn) => { try { fn(); } catch { /* one listener must not stop the others */ } }))
        .subscribe();
    } catch {
      pushChannel = null;
    }
  }
  return () => {
    pushListeners.delete(listener);
    if (pushListeners.size === 0 && pushChannel) {
      try { supabase.removeChannel(pushChannel); } catch { /* already gone */ }
      pushChannel = null;
    }
  };
};

export const useSectorMarkets = (selected = null, { enabled = true } = {}) => {
  const [available, setAvailable] = useState(true);
  const [sectors, setSectors] = useState([]);
  const [candles, setCandles] = useState([]);
  const [meta, setMeta] = useState({ tradingEnabled: false, feeBps: 0, maxTradeIcec: null, version: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [status, setStatus] = useState('connecting');

  const run = useRef({ version: null, sector: undefined, failures: 0, inFlight: false, timer: null, lastOkAt: null, lastPushAt: 0, alive: false, selected, kick: null, enabled });
  run.current.selected = selected;
  run.current.enabled = enabled;

  const poll = useCallback(async () => {
    const r = run.current;
    if (r.inFlight) return;
    r.inFlight = true;
    try {
      const want = r.selected || null;
      const sectorChanged = r.sector !== want;
      const data = await getSectorFeed({ sinceVersion: sectorChanged ? null : r.version, sector: want });
      if (data.missing) { setAvailable(false); r.alive = false; return; }
      if (data.version != null) r.version = Number(data.version);
      if (data.trading_enabled != null) setMeta((m) => (m.tradingEnabled === !!data.trading_enabled ? m : { ...m, tradingEnabled: !!data.trading_enabled }));
      if (!data.unchanged) {
        r.sector = want;
        setSectors(Array.isArray(data.sectors) ? data.sectors : []);
        setCandles(toSectorCandles(data.candles));
        setMeta({ tradingEnabled: !!data.trading_enabled, feeBps: Number(data.fee_bps) || 0, maxTradeIcec: data.max_trade_icec != null ? Number(data.max_trade_icec) : null, version: r.version });
      }
      setUpdatedAt(new Date());
      r.failures = 0;
      r.lastOkAt = Date.now();
      setError(false);
    } catch {
      r.failures += 1;
      setError(true);
    } finally {
      r.inFlight = false;
      setLoading(false);
      if (r.alive) setStatus(feedStatus({ lastOkAt: r.lastOkAt }));
    }
  }, []);

  useEffect(() => {
    const r = run.current;
    r.alive = true;
    const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';
    const schedule = (delay) => { clearTimeout(r.timer); r.timer = setTimeout(tick, delay); }; // eslint-disable-line no-use-before-define
    const tick = async () => {
      if (!r.alive) return;
      if (hidden()) { r.timer = null; return; } // paused: the visibility handler restarts it
      await poll();
      if (r.alive && !hidden() && r.enabled) schedule(pollDelay({ failures: r.failures }));
    };
    const soon = (delay = 0) => { if (r.alive && !hidden()) schedule(delay); };

    r.kick = () => soon(0); // lets the effect below ask for an immediate poll WITHOUT breaking the loop
    soon(0);
    const onVisible = () => { if (!hidden()) { if (r.enabled) soon(0); } else clearTimeout(r.timer); };
    const onOnline = () => { if (r.enabled) soon(0); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    const unsubscribePush = subscribePush(() => {
      const now = Date.now();
      if (hidden() || !r.enabled || now - r.lastPushAt < PUSH_THROTTLE_MS) return;
      r.lastPushAt = now;
      soon(0);
    });
    const ager = setInterval(() => { if (r.alive && !hidden()) setStatus(feedStatus({ lastOkAt: r.lastOkAt })); }, 5000);

    return () => {
      r.alive = false;
      r.kick = null;
      clearTimeout(r.timer);
      clearInterval(ager);
      unsubscribePush();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    };
  }, [poll]);

  // turned back on (scrolled into view): catch up now and keep polling
  useEffect(() => {
    const r = run.current;
    if (enabled && r.alive) r.kick?.();
  }, [enabled]);

  // a different sector was picked: fetch its candles now, not at the next poll (through the loop, so it keeps running)
  useEffect(() => {
    const r = run.current;
    if (r.alive && r.sector !== (selected || null)) r.kick?.();
  }, [selected]);

  const refresh = useCallback(() => { run.current.version = null; return poll(); }, [poll]);

  return {
    available, sectors, candles, status, loading, updatedAt, refresh,
    error: error && sectors.length === 0,
    tradingEnabled: meta.tradingEnabled, feeBps: meta.feeBps, maxTradeIcec: meta.maxTradeIcec, version: meta.version,
  };
};

export default useSectorMarkets;

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '../lib/supabase/client';
import { calculateIndicators } from '../utils/candleIndicators';
import { toSeries, fillGaps, trendChannel, channelValue } from '../utils/candleSeries';
import {
  BASE_POLL_MS, PUSH_THROTTLE_MS, pollDelay, needsFullRefresh, mergeCandles, feedStatus, isMissingFunction, isDrawableCandle,
} from '../utils/feedPolling';

// A raw ican_get_public_candles row -> the shape CandlestickChart expects (same as the wallet's Trade > Chart).
export const formatPublicCandle = (candle) => ({
  id: candle.id,
  timestamp: candle.open_time,
  time: new Date(candle.open_time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  open: parseFloat(candle.open_price || 0),
  high: parseFloat(candle.high_price || 0),
  low: parseFloat(candle.low_price || 0),
  close: parseFloat(candle.close_price || 0),
  volume: parseFloat(candle.trading_volume || 0),
  open_price: candle.open_price,
  high_price: candle.high_price,
  low_price: candle.low_price,
  close_price: candle.close_price,
  trading_volume: candle.trading_volume,
  open_time: candle.open_time,
  close_time: candle.close_time,
});

// Rows from the server, newest first -> drawable candles, oldest first. A malformed row is dropped, not drawn.
const toCandles = (rows) => [...(rows || [])].reverse().map(formatPublicCandle).filter(isDrawableCandle);

// ---- optional push: the database pings "something changed" (a version number, never prices) so a chart can refresh
// within about a second instead of waiting for its next poll. One shared channel for every chart on the page; if
// Realtime is unavailable nothing here throws and polling simply carries on.
// OFF by default: every open chart would hold a Realtime connection, which counts against the project's connection
// quota on a busy public page. Set VITE_ICANERACOIN_PUSH=true once the plan's quota is known to cover the audience.
const PUSH_ENABLED = (() => { try { return import.meta.env.VITE_ICANERACOIN_PUSH === 'true'; } catch { return false; } })();
let pushChannel = null;
const pushListeners = new Set();
const subscribePush = (listener) => {
  if (!PUSH_ENABLED) return () => {};
  pushListeners.add(listener);
  if (!pushChannel) {
    try {
      pushChannel = supabase
        .channel('icaneracoin-price')
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

// Live icaneracoin candles for signed-out visitors: the public landing chart and the /icaneracoin page.
//
// It asks ONE function (ican_get_public_feed) for candles and the headline price together, and says which version it
// already holds, so on a quiet market the answer is a few bytes ("unchanged") and on a busy one only the newest
// candles come back. A burst of thousands of transactions is folded into one update on the server, so the chart
// never redraws faster than this poll no matter how many people trade.
//
// Careful with a crowd, too: it polls only while the tab is visible, waits longer after each failure (with jitter,
// so open charts do not retry in lockstep), never overlaps two requests, and re-reads everything every so often so a
// missed delta cannot persist. If the feed function is not installed yet it falls back to the three older calls.
// `status` is 'connecting' | 'live' | 'delayed' | 'offline'; `error` is true only when no candle has ever loaded,
// so a brief network blip after a successful load keeps showing the last chart.
export const usePublicIcanCandles = (limit = 200) => {
  const [candles, setCandles] = useState([]);
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [status, setStatus] = useState('connecting');

  const run = useRef({
    candles: [], version: null, failures: 0, pollsSinceFull: 0, lastFullAt: 0,
    inFlight: false, timer: null, lastOkAt: null, lastPushAt: 0, feedMissing: false, alive: false,
  });

  const apply = useCallback((nextCandles, nextSnapshot) => {
    const r = run.current;
    r.candles = nextCandles;
    setCandles(nextCandles);
    if (nextSnapshot) setSnapshot(nextSnapshot);
    setUpdatedAt(new Date());
  }, []);

  // The older way: three calls. Used only until the feed migration has been run.
  const loadLegacy = useCallback(async () => {
    try { await supabase.rpc('ican_ensure_current_candle'); } catch { /* chart still shows stored candles */ }
    const [candleRes, snapshotRes] = await Promise.all([
      supabase.rpc('ican_get_public_candles', { p_limit: limit }),
      supabase.rpc('ican_get_market_snapshot'),
    ]);
    if (candleRes.error || !Array.isArray(candleRes.data)) throw candleRes.error || new Error('no candles');
    apply(toCandles(candleRes.data), !snapshotRes.error && snapshotRes.data?.[0] ? snapshotRes.data[0] : null);
  }, [limit, apply]);

  const loadFeed = useCallback(async () => {
    const r = run.current;
    const full = needsFullRefresh({ pollsSinceFull: r.pollsSinceFull, haveCandles: r.candles.length > 0, lastFullAt: r.lastFullAt });
    const newest = r.candles.length ? r.candles[r.candles.length - 1].open_time : null;
    const { data, error: rpcError } = await supabase.rpc('ican_get_public_feed', {
      p_limit: limit,
      p_since_version: full ? null : r.version,
      p_after: full ? null : newest,
    });
    if (rpcError) {
      if (isMissingFunction(rpcError)) { r.feedMissing = true; return loadLegacy(); }
      throw rpcError;
    }
    if (!data || typeof data !== 'object') throw new Error('empty feed');
    if (data.version != null) r.version = Number(data.version);
    if (data.unchanged) { r.pollsSinceFull += 1; return undefined; }
    const incoming = toCandles(data.candles);
    if (data.delta && r.candles.length) {
      r.pollsSinceFull += 1;
      apply(mergeCandles(r.candles, incoming, limit), data.snapshot || null);
    } else {
      r.pollsSinceFull = 0;
      r.lastFullAt = Date.now();
      apply(incoming, data.snapshot || null);
    }
    return undefined;
  }, [limit, apply, loadLegacy]);

  const poll = useCallback(async () => {
    const r = run.current;
    if (r.inFlight) return;
    r.inFlight = true;
    try {
      if (r.feedMissing) await loadLegacy(); else await loadFeed();
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
  }, [loadFeed, loadLegacy]);

  useEffect(() => {
    const r = run.current;
    r.alive = true;
    const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

    const schedule = (delay) => {
      clearTimeout(r.timer);
      r.timer = setTimeout(tick, delay); // eslint-disable-line no-use-before-define
    };
    const tick = async () => {
      if (!r.alive) return;
      if (hidden()) { r.timer = null; return; } // paused: the visibility handler restarts it
      await poll();
      if (r.alive && !hidden()) schedule(pollDelay({ failures: r.failures }));
    };
    const soon = (delay = 0) => { if (r.alive && !hidden()) schedule(delay); };

    soon(0);
    const onVisible = () => { if (!hidden()) soon(0); else clearTimeout(r.timer); };
    const onOnline = () => soon(0);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);

    const unsubscribePush = subscribePush(() => {
      const now = Date.now();
      if (hidden() || now - r.lastPushAt < PUSH_THROTTLE_MS) return;
      r.lastPushAt = now;
      soon(0);
    });
    // 'live' decays to 'delayed' / 'offline' on its own if answers stop arriving
    // (not while the tab is hidden: polling is paused on purpose then, and it must not come back labelled "offline")
    const ager = setInterval(() => { if (r.alive && !hidden()) setStatus(feedStatus({ lastOkAt: r.lastOkAt })); }, 5000);

    return () => {
      r.alive = false;
      clearTimeout(r.timer);
      clearInterval(ager);
      unsubscribePush();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    };
  }, [poll]);

  const refresh = useCallback(() => {
    run.current.pollsSinceFull = Number.MAX_SAFE_INTEGER; // re-read the whole window
    run.current.version = null;
    return poll();
  }, [poll]);

  // Support / resistance as the chart draws them (the dashed channel at the latest candle), so the analysis
  // cards and the lines on the chart always quote the same prices.
  const analysis = useMemo(() => {
    if (!candles.length) return null;
    // The same steady 5-minute series the chart draws (quiet windows as flat candles), so the cards and the chart agree.
    const series = fillGaps(toSeries(candles));
    const base = calculateIndicators(series);
    if (!base) return base;
    const channel = trendChannel(series, 120);
    if (!channel) return base;
    return {
      ...base,
      support: channelValue(channel, channel.end, 'lower').toFixed(8),
      resistance: channelValue(channel, channel.end, 'upper').toFixed(8),
    };
  }, [candles]);

  return { candles, snapshot, analysis, loading, error: error && candles.length === 0, updatedAt, status, refresh };
};

export { BASE_POLL_MS };
export default usePublicIcanCandles;

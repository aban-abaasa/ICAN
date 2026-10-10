import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase/client';
import { calculateIndicators } from '../utils/candleIndicators';
import { toSeries, trendChannel, channelValue } from '../utils/candleSeries';

const REFRESH_MS = 20_000;

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

// Live icaneracoin candles for signed-out visitors: the public landing chart and the /icaneracoin page.
// Everything goes through functions granted to `anon` (ican_get_public_candles, ican_ensure_current_candle,
// ican_get_market_snapshot), so no account is needed. Polls instead of subscribing to Realtime because the
// candle table itself is not readable by anon. `error` is true only when no candle has ever loaded, so a
// brief network blip after a successful load keeps showing the last chart.
export const usePublicIcanCandles = (limit = 200) => {
  const [candles, setCandles] = useState([]);
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(null);

  const load = useCallback(async () => {
    try {
      try { await supabase.rpc('ican_ensure_current_candle'); } catch { /* chart still shows stored candles */ }

      const [candleRes, snapshotRes] = await Promise.all([
        supabase.rpc('ican_get_public_candles', { p_limit: limit }),
        supabase.rpc('ican_get_market_snapshot'),
      ]);

      if (!candleRes.error && Array.isArray(candleRes.data)) {
        // The RPC returns newest first; the chart wants oldest first.
        setCandles([...candleRes.data].reverse().map(formatPublicCandle));
        setError(false);
        setUpdatedAt(new Date());
      } else {
        setError(true);
      }
      if (!snapshotRes.error && snapshotRes.data?.[0]) setSnapshot(snapshotRes.data[0]);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  // Support / resistance as the chart draws them (the dashed channel at the latest candle), so the analysis
  // cards and the lines on the chart always quote the same prices.
  const analysis = useMemo(() => {
    if (!candles.length) return null;
    const base = calculateIndicators(candles);
    if (!base) return base;
    const series = toSeries(candles);
    const channel = trendChannel(series, 120);
    if (!channel) return base;
    return {
      ...base,
      support: channelValue(channel, channel.end, 'lower').toFixed(8),
      resistance: channelValue(channel, channel.end, 'upper').toFixed(8),
    };
  }, [candles]);
  return { candles, snapshot, analysis, loading, error: error && candles.length === 0, updatedAt, refresh: load };
};

export default usePublicIcanCandles;

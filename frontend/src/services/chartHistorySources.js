/**
 * Where the trading chart's History buttons (1W / 1M / 3M / 1Y / All) and its year / month picker read from.
 *
 * A source is { minBucket, load({ from, to, bucket }), bounds() }:
 *   - load    candle rows for a window, already rolled into `bucket`-second candles (open_time / *_price / trading_volume)
 *   - bounds  { first, last } ISO times of the oldest and newest data, or null when unknown (the year list then offers only
 *             this year and the last)
 *
 * Each one asks the new range function first. If that migration is not installed yet, a window that ends now falls back to the
 * older look-back function (coin) or to the 24-hour feed rolled up here (ICEC-S), so the buttons still work before the
 * migration is run; only an older year needs the new function.
 */
import { supabase } from '../lib/supabase/client';
import { isMissingFunction } from '../utils/feedPolling';
import { toSeries, aggregateSeries } from '../utils/candleSeries';
import { historyToRows } from '../utils/stableUnitRules';
import { getHistory } from './stableUnitService';

const endsNow = (to) => Math.abs(Date.now() - to.getTime()) < 15 * 60 * 1000;
const isoRange = ({ from, to, bucket }) => ({ p_from: from.toISOString(), p_to: to.toISOString(), p_bucket_seconds: bucket });

const boundsFrom = (data) => {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || !row.first_time) return null;
  return { first: row.first_time, last: row.last_time || null };
};

export const coinHistory = {
  key: 'coin',
  minBucket: 300,
  async load(range) {
    const { data, error } = await supabase.rpc('ican_get_public_candle_range', isoRange(range));
    if (!error && Array.isArray(data)) return data;
    if (error && isMissingFunction(error) && endsNow(range.to)) {
      const days = Math.max(1, Math.ceil((Date.now() - range.from.getTime()) / 86400000));
      const old = await supabase.rpc('ican_get_public_candle_history', { p_days: days, p_bucket_seconds: range.bucket });
      if (!old.error && Array.isArray(old.data)) return old.data;
      throw old.error || new Error('no history');
    }
    throw error || new Error('no history');
  },
  async bounds() {
    const { data, error } = await supabase.rpc('ican_get_public_candle_bounds');
    return error ? null : boundsFrom(data);
  },
};

// The unit's value points (every minute for 24 h, hourly before) rolled into candles in the browser.
const stableFallback = async ({ from, to, bucket }) => {
  const series = toSeries(historyToRows(await getHistory(2000)));
  const f = from.getTime() / 1000;
  const t = to.getTime() / 1000;
  return aggregateSeries(series.filter((c) => c.time >= f && c.time < t), bucket).map((c) => ({
    open_time: new Date(c.time * 1000).toISOString(),
    open_price: c.open, high_price: c.high, low_price: c.low, close_price: c.close, trading_volume: 0,
  }));
};

export const stableHistory = {
  key: 'stable',
  minBucket: 300,
  async load(range) {
    const { data, error } = await supabase.rpc('ican_stable_history_range', isoRange(range));
    if (!error && Array.isArray(data)) return data;
    if (error && isMissingFunction(error) && endsNow(range.to)) return stableFallback(range);
    throw error || new Error('no history');
  },
  async bounds() {
    const { data, error } = await supabase.rpc('ican_stable_history_bounds');
    return error ? null : boundsFrom(data);
  },
};

export default { coinHistory, stableHistory };

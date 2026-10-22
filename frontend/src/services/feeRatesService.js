/**
 * Reads the fee rates (public.ican_fee_rates) so the wallet can show what a transfer or withdrawal costs BEFORE you pay.
 * The server charges from the same table, so this only ever reads - it never sets a price.
 *
 * Cached for a minute and shared by every caller. Also keeps the coin cash-out rate used by the conversion maths
 * (COIN_PAYOUT_FEE_RATE in utils/walletRouting.js) in step with the table.
 */

import { supabase } from '../lib/supabase/client';
import { FEE_KEYS, UNLOADED_FEE_RATES, normalizeFeeRates, rateFor } from '../utils/feeRates';
import { setCoinPayoutFeeRate } from '../utils/walletRouting';

const TTL_MS = 60 * 1000;
let cached = null;
let cachedAt = 0;
let inflight = null;

/**
 * @returns {Promise<{rates: Record<string, number>, deployed: boolean, loaded: boolean}>}
 *   deployed: false = the table does not exist yet (nothing to charge); loaded: false = the read failed (show the default)
 */
export async function getFeeRates({ force = false } = {}) {
  if (!force && cached && Date.now() - cachedAt < TTL_MS) return cached;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const { data, error } = await supabase.from('ican_fee_rates').select('key, rate');
      if (error) {
        // PGRST205 = PostgREST cannot find the table, 42P01 = undefined_table
        const notThereYet = error.code === 'PGRST205' || error.code === '42P01';
        return notThereYet ? { rates: {}, deployed: false, loaded: true } : { ...UNLOADED_FEE_RATES };
      }
      return { rates: normalizeFeeRates(data), deployed: true, loaded: true };
    } catch {
      return { ...UNLOADED_FEE_RATES };
    }
  })().then((state) => {
    inflight = null;
    if (state.loaded) {
      cached = state;
      cachedAt = Date.now();
      setCoinPayoutFeeRate(rateFor(state, FEE_KEYS.COIN_CASH_OUT));
    }
    return state;
  });
  return inflight;
}

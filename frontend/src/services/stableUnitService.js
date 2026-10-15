/**
 * ICEC-S service (in the system, no blockchain): the only place the app talks to the ican_stable_* database functions.
 *
 *  - getQuote     public: the value of one ICEC-S (the live dollar rate with an inflation floor), in every currency
 *  - getHistory   public: its value for the chart (every minute for the last 24 hours, hourly before that)
 *  - swapStable   one buy or sell, a single atomic step on the server (ican_stable_swap); `requestId` makes a retry harmless
 *  - getMyPosition / getMyFills / getMyWallets / getHomeCurrency   the signed-in user's own rows and the currency of the country they picked
 *
 * A function that is not installed yet is reported as { missing: true } instead of throwing, so the screen can say so.
 */
import { supabase } from '../lib/supabase/client';
import { isMissingFunction } from './../utils/feedPolling';
import { isTransientNetworkError } from '../utils/tradeResult';
import { mapSwapResult } from '../utils/stableUnitRules';

const rpc = async (name, args) => {
  const { data, error } = await supabase.rpc(name, args);
  if (error) {
    if (isMissingFunction(error)) return { missing: true };
    throw error;
  }
  return { data };
};

export const getQuote = async () => {
  const res = await rpc('ican_stable_quote', {});
  if (res.missing) return { missing: true };
  return res.data || { available: false };
};

export const getHistory = async (limit = 500) => {
  const res = await rpc('ican_stable_history', { p_limit: limit });
  return res.missing ? [] : (Array.isArray(res.data) ? res.data : []);
};

export const getMyPosition = async () => {
  const res = await rpc('ican_stable_my_position', {});
  return res.missing || !res.data?.success ? { units: 0, cost_ugx: 0, value_ugx: null } : res.data;
};

export const getMyFills = async (limit = 10) => {
  const res = await rpc('ican_stable_my_fills', { p_limit: limit });
  return res.missing ? [] : (Array.isArray(res.data) ? res.data : []);
};

// The wallets the user can pay from / be paid into: [{ currency, balance }]
export const getMyWallets = async (userId) => {
  if (!userId) return [];
  const { data } = await supabase.from('wallet_accounts').select('currency, balance').eq('user_id', userId).eq('status', 'active');
  return (data || []).map((w) => ({ currency: String(w.currency).toUpperCase(), balance: parseFloat(w.balance) || 0 }));
};

// The currency of the country the person picked at sign-up (the platform's own country -> currency map); null if unknown.
export const getHomeCurrency = async (userId) => {
  if (!userId) return null;
  try {
    const res = await rpc('ican_user_currency', { p_user_id: userId });
    const c = res.missing ? null : String(res.data || '').toUpperCase();
    return /^[A-Z]{3}$/.test(c || '') ? c : null;
  } catch {
    return null;
  }
};

/** { side: 'buy'|'sell', amount, currency, requestId, expectedUnitUgx, maxSlippagePct } -> { success, ... } | { success:false, code, error } */
export const swapStable = async ({ side, amount, currency = 'UGX', requestId, expectedUnitUgx = null, maxSlippagePct = 1 }) => {
  const args = { p_side: side, p_amount: amount, p_pay_currency: currency, p_request_id: requestId, p_expected_price_ugx: expectedUnitUgx, p_max_slippage_pct: maxSlippagePct };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await rpc('ican_stable_swap', args);
      if (res.missing) return { success: false, error: 'ICEC-S is not installed yet.' };
      return mapSwapResult(res.data);
    } catch (e) {
      // a dropped connection is retried with the SAME request id (the server answers "already done" if it went through)
      if (attempt < 2 && isTransientNetworkError(e)) continue;
      return { success: false, error: e?.message || 'The swap failed. Please try again.' };
    }
  }
  return { success: false, error: 'The swap failed. Please try again.' };
};

export const devStable = {
  overview: (token) => rpc('ican_stable_dev_overview', { dev_token: token }),
  setSettings: (token, changes) => rpc('ican_stable_dev_set_settings', { dev_token: token, p_changes: changes }),
  adjustVault: (token, amount, memo) => rpc('ican_stable_dev_vault_adjust', { dev_token: token, p_amount: amount, p_memo: memo }),
  reconcile: (token) => rpc('ican_stable_dev_reconcile', { dev_token: token }),
};

export default { getQuote, getHistory, getMyPosition, getMyFills, getMyWallets, getHomeCurrency, swapStable, devStable };

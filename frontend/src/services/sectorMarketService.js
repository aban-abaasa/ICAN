/**
 * Sector Markets service: the only place the app talks to the sector-trading database functions.
 *
 *  - getSectorFeed        public, aggregates only (ican_get_sector_feed): every sector's level and status in one call,
 *                         plus one sector's candles; "unchanged" when nothing moved since the version the caller holds
 *  - tradeSector          one buy or sell, executed by the database as a single atomic step (ican_sector_trade).
 *                         Who is trading is the signed-in session; the price and any currency conversion are the
 *                         server's. `requestId` makes a retry harmless: the same id returns the original result.
 *  - getMyHoldings/Fills  the signed-in user's own position and trades
 *  - data terms           the wording a business agrees to when it creates an account, and recording that it did
 *
 * Every function reports "the database function is not installed yet" as { missing: true } instead of throwing, so the
 * screen can hide itself until the SQL migrations have been run.
 */

import { supabase } from '../lib/supabase/client';
import { isMissingFunction } from '../utils/feedPolling';
import { newRequestId, isTransientNetworkError } from '../utils/tradeResult';
import { mapSectorTradeResult, ICEC } from '../utils/sectorTradeRules';

const rpc = async (name, args) => {
  const { data, error } = await supabase.rpc(name, args);
  if (error) {
    if (isMissingFunction(error)) return { missing: true };
    throw error;
  }
  return { data };
};

// ---- reading ---------------------------------------------------------------------------------------------------------

// { version, server_time, trading_enabled, fee_bps, sectors: [...], candles_for, candles: [...] } or { unchanged: true, ... }
export const getSectorFeed = async ({ sinceVersion = null, sector = null, after = null } = {}) => {
  const res = await rpc('ican_get_sector_feed', { p_since_version: sinceVersion, p_sector: sector, p_after: after });
  if (res.missing) return { missing: true };
  if (!res.data || typeof res.data !== 'object') throw new Error('empty sector feed');
  return res.data;
};

export const getMyHoldings = async () => {
  const res = await rpc('ican_sector_my_holdings', {});
  if (res.missing) return { missing: true, holdings: [] };
  return { holdings: res.data?.success ? res.data.holdings || [] : [] };
};

export const getMyFills = async (limit = 20) => {
  const res = await rpc('ican_sector_my_fills', { p_limit: limit });
  if (res.missing) return { missing: true, fills: [] };
  return { fills: res.data?.success ? res.data.fills || [] : [] };
};

// ---- trading ---------------------------------------------------------------------------------------------------------

/**
 * options: { sector, side: 'buy'|'sell', amount, currency = 'ICEC', requestId, expectedPrice, maxSlippagePct = 1 }
 *   buy : amount is money to spend, in `currency` (ICEC or the ISO code of a wallet the user holds)
 *   sell: amount is index units to sell; the proceeds go to `currency`
 * Resolves to { success:true, ... } or { success:false, code, error } (see mapSectorTradeResult). A dropped
 * connection is retried with the SAME request id; a server answer is never retried.
 */
export const tradeSector = async ({ sector, side, amount, currency = ICEC, requestId, expectedPrice = null, maxSlippagePct = 1 }) => {
  const id = requestId || newRequestId('sector');
  const args = {
    p_sector: sector,
    p_side: side,
    p_amount: amount,
    p_pay_currency: currency,
    p_request_id: id,
    p_expected_price_icec: expectedPrice,
    p_max_slippage_pct: maxSlippagePct,
  };
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 300 * attempt * attempt));
    const { data, error } = await supabase.rpc('ican_sector_trade', args);
    if (!error) return mapSectorTradeResult(data);
    if (isMissingFunction(error)) return { success: false, code: 'unavailable', error: 'Sector markets are not available yet.' };
    if (!isTransientNetworkError(error)) return { success: false, error: error.message || 'Trade failed' };
    lastError = error;
  }
  return {
    success: false,
    code: 'network',
    error: `Could not reach the server (${lastError?.message || 'network error'}). Check your holdings before trying again: if they changed, the trade went through.`,
  };
};

// ---- the data clause businesses agree to ---------------------------------------------------------------------------------

// { version, title, body } -- readable signed out, so the sign-up form can show it.
export const getDataTerms = async () => {
  const res = await rpc('ican_sector_data_terms', {});
  if (res.missing || !res.data) return null;
  return res.data;
};

// { accepted, current_version } for a business the user manages; null when the feature is not installed.
export const getDataConsentStatus = async (businessId) => {
  if (!businessId) return null;
  const res = await rpc('ican_sector_data_consent_status', { p_business_id: businessId });
  if (res.missing || !res.data?.success) return null;
  return res.data;
};

// Record that a business accepted the wording. Returns { success } -- a failure is reported, never swallowed, so the
// caller can tell the person instead of pretending they agreed.
export const acceptDataTerms = async (businessId, version) => {
  const res = await rpc('ican_sector_accept_data_terms', { p_business_id: businessId, p_version: version });
  if (res.missing) return { success: true, missing: true }; // nothing to record until the feature is installed
  return res.data || { success: false, error: 'No answer from the server.' };
};

// ---- operators (developer panel) -----------------------------------------------------------------------------------------

export const devSector = {
  overview: (token) => rpc('ican_sector_dev_overview', { dev_token: token }),
  setSettings: (token, changes) => rpc('ican_sector_dev_set_settings', { dev_token: token, p_changes: changes }),
  setSector: (token, ticker, { enabled = null, halted = null } = {}) =>
    rpc('ican_sector_dev_set_sector', { dev_token: token, p_ticker: ticker, p_enabled: enabled, p_halted: halted }),
  mapIndustry: (token, industry, ticker = null) => rpc('ican_sector_dev_map_industry', { dev_token: token, p_industry: industry, p_ticker: ticker }),
  adjustVault: (token, amount, memo) => rpc('ican_sector_dev_vault_adjust', { dev_token: token, p_amount: amount, p_memo: memo }),
  reconcile: (token) => rpc('ican_sector_dev_reconcile', { dev_token: token }),
};

export default { getSectorFeed, getMyHoldings, getMyFills, tradeSector, getDataTerms, getDataConsentStatus, acceptDataTerms, devSector };

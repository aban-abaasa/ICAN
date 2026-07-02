import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase/client';
import { useAuth } from '../context/AuthContext';

const REFRESH_MS = 60_000; // refresh every 60 seconds

/**
 * useIcanPrice — live price of 1 ICAN in any specific currency
 *
 * @param {string} currencyCode  e.g. 'KES', 'USD', 'NGN', 'UGX'
 * @returns {{ price, loading, refresh }}
 *
 * price fields:
 *   price_local      — fair price per ICAN in local currency
 *   price_usd        — fair price per ICAN in USD
 *   floor_local      — original 5,000 UGX floor converted to local
 *   fx_floor_local   — FX-adjusted floor in local currency
 *   fx_lift          — extra local units added because UGX weakened
 *   appreciation_pct — % above original floor
 *   currency_code, currency_name, country_name, rate_to_ugx
 */
export const useIcanPrice = (currencyCode = 'UGX') => {
  const [price,   setPrice]   = useState(null);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!currencyCode) return;
    try {
      const { data, error } = await supabase.rpc('ican_get_price_in_currency', {
        p_currency_code: currencyCode.toUpperCase(),
      });
      if (!error && data?.[0]) setPrice(data[0]);
    } catch (_) {}
    setLoading(false);
  }, [currencyCode]);

  useEffect(() => {
    setLoading(true);
    fetch();
    const id = setInterval(fetch, REFRESH_MS);
    return () => clearInterval(id);
  }, [fetch]);

  return { price, loading, refresh: fetch };
};


/**
 * useUserIcanPrice — live wallet display for the logged-in user
 * Auto-detects their country from user_accounts and returns local currency price
 *
 * @returns {{ wallet, loading, refresh }}
 *
 * wallet fields:
 *   ican_balance     — raw ICAN balance
 *   currency_code    — user's local currency
 *   currency_name
 *   country_name
 *   price_local      — price of 1 ICAN in user's local currency
 *   price_usd        — price of 1 ICAN in USD
 *   floor_local      — original floor in local currency
 *   fx_floor_local   — FX-adjusted floor
 *   balance_local    — total wallet value in local currency
 *   balance_usd      — total wallet value in USD
 *   appreciation_pct
 *   fx_lift          — FX protection amount in local units
 */
export const useUserIcanPrice = () => {
  const { user }  = useAuth();
  const [wallet,  setWallet]  = useState(null);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!user?.id) { setLoading(false); return; }
    try {
      // ican_get_user_wallet_display reads country_code from user_accounts
      // (set at sign-up) and returns price in the user's real local currency.
      const { data, error } = await supabase.rpc('ican_get_user_wallet_display', {
        p_user_id: user.id,
      });
      if (!error && data?.[0]) setWallet(data[0]);
    } catch (_) {}
    setLoading(false);
  }, [user?.id]);

  useEffect(() => {
    setLoading(true);
    fetch();
    const id = setInterval(fetch, REFRESH_MS);
    return () => clearInterval(id);
  }, [fetch]);

  return { wallet, loading, refresh: fetch };
};


/**
 * useIcanPriceByCountry — price for any given sign-up country code
 * Uses ican_get_price_by_country() which resolves country → real currency
 *
 * @param {string} countryCode  ISO-2 e.g. 'KE', 'NG', 'IN', 'US'
 */
export const useIcanPriceByCountry = (countryCode) => {
  const [price,   setPrice]   = useState(null);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!countryCode) return;
    try {
      const { data, error } = await supabase.rpc('ican_get_price_by_country', {
        p_country_code: countryCode.toUpperCase(),
      });
      if (!error && data?.[0]) setPrice(data[0]);
    } catch (_) {}
    setLoading(false);
  }, [countryCode]);

  useEffect(() => {
    setLoading(true);
    fetch();
    const id = setInterval(fetch, REFRESH_MS);
    return () => clearInterval(id);
  }, [fetch]);

  return { price, loading, refresh: fetch };
};


/**
 * useMarketSnapshot — lightweight ticker for the whole network
 * Safe to use on public pages (no auth required)
 *
 * @returns {{ snapshot, loading, refresh }}
 *
 * snapshot fields:
 *   price_ugx, price_usd, floor_ugx, fx_adjusted_ugx,
 *   appreciation_pct, ugx_depr_pct, active_holders, tx_count
 */
export const useMarketSnapshot = () => {
  const [snapshot, setSnap]    = useState(null);
  const [loading,  setLoading] = useState(true);

  const fetch = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc('ican_get_market_snapshot');
      if (!error && data?.[0]) setSnap(data[0]);
    } catch (_) {}
    setLoading(false);
  }, []);

  useEffect(() => {
    fetch();
    const id = setInterval(fetch, REFRESH_MS);
    return () => clearInterval(id);
  }, [fetch]);

  return { snapshot, loading, refresh: fetch };
};

export default useUserIcanPrice;

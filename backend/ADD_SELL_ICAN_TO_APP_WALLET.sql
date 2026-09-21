-- ============================================================================
-- Fix: selling ICAN debited the coin and paid IWOS its fee, but never
-- credited the seller with anything — the net UGX just vanished.
-- ============================================================================
-- sell_ican_coins() (ROUTE_PLATFORM_FEES_TO_IWOS_BUSINESS.sql) computes
-- v_ugx_net and returns it in the response as `ugx_payout`, but that number
-- was purely informational — the function only ever touches
-- ican_user_wallets (debit) and, via fn_credit_platform_fee_to_business,
-- IWOS's business wallet (fee). No step anywhere credits the seller. Every
-- caller across mybodaguy/digital-city-era/ican that calls sell_ican_coins()
-- directly (as opposed to request_ican_payout(), which sends the net amount
-- out for real via Flutterwave) has therefore always just destroyed the
-- seller's ICAN for nothing.
--
-- "Sell" is meant to be a same-app operation: ICAN -> the user's own
-- in-app ICANera Wallet balance (wallet_accounts.balance — the same UGX
-- balance PayMoneyModal/sendFiatToMobileMoney already draw from), instant,
-- fee only. It is NOT the external cash-out — that's request_ican_payout()/
-- Flutterwave, a separate, already-working path, unaffected by this file.
--
-- Every signed-up user already has exactly one wallet_accounts row
-- (create_wallet_for_user() trigger on auth.users, create_wallet_accounts_
-- table.sql), so this can credit unconditionally the same way
-- adjust_wallet_account_balance() (FIX_WALLET_ACCOUNTS_ATOMIC_BALANCE.sql)
-- already does — a single row-locked UPDATE, not a read-then-write from the
-- client (that exact race was the bug FIX_WALLET_ACCOUNTS_ATOMIC_BALANCE.sql
-- fixed elsewhere). Wraps sell_ican_coins() rather than duplicating its
-- logic, and rolls back the whole operation (ICAN debit, IWOS fee credit,
-- everything) if the wallet credit somehow fails, instead of leaving a
-- half-done sell.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sell_ican_coins_to_wallet(
  p_user_id     UUID,
  p_ican_amount DECIMAL,
  p_source_app  TEXT    DEFAULT 'ican',
  p_reference   TEXT    DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_sell_result JSONB;
  v_ugx_payout  DECIMAL;
  v_new_balance DECIMAL;
BEGIN
  v_sell_result := public.sell_ican_coins(p_user_id, p_ican_amount, p_source_app, p_reference);
  IF NOT COALESCE((v_sell_result->>'success')::boolean, false) THEN
    RETURN v_sell_result;
  END IF;

  v_ugx_payout := (v_sell_result->>'ugx_payout')::DECIMAL;

  UPDATE public.wallet_accounts
  SET balance = balance + v_ugx_payout, updated_at = now()
  WHERE user_id = p_user_id
  RETURNING balance INTO v_new_balance;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'In-app wallet not found for user %', p_user_id;
  END IF;

  RETURN v_sell_result || jsonb_build_object('wallet_balance', v_new_balance);
END;
$$;

REVOKE ALL ON FUNCTION public.sell_ican_coins_to_wallet(UUID, DECIMAL, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sell_ican_coins_to_wallet(UUID, DECIMAL, TEXT, TEXT) TO authenticated;

DO $$
BEGIN
  RAISE NOTICE '✅ sell_ican_coins_to_wallet ready — sell_ican_coins() itself is unchanged (still used as-is inside request_ican_payout() for the real external cash-out), this new function is for the in-app "Sell" action only.';
END $$;

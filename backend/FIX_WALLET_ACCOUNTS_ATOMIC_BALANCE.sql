-- =============================================================================
-- FIX_WALLET_ACCOUNTS_ATOMIC_BALANCE.sql
--
-- Run this ONCE in Supabase SQL Editor.
--
-- Root cause: handleSendViaMOMO() in ICANWallet.jsx (the "Send via Mobile
-- Money" path, local-currency wallet_accounts.balance — NOT the ICAN coin
-- balance, which already goes through the atomic transfer_ican() RPC) reads
-- the sender's balance with a plain SELECT, computes the new balance in
-- JavaScript, then writes it back with a plain UPDATE. Between that SELECT
-- and UPDATE there is no row lock, so two concurrent sends (or a send
-- overlapping any other balance-changing action) can both read the same
-- starting balance and the second UPDATE silently clobbers the first
-- instead of stacking on top of it — a lost-update race that can let a
-- balance go negative or "refund" the wrong amount. The MOMO-failure
-- refund path makes this worse: it resets balance to the pre-deduction
-- snapshot rather than adding the amount back, which can also undo
-- unrelated balance changes that happened in between.
--
-- Fix: a single atomic, row-locked UPDATE done server-side, keyed off
-- auth.uid() (never a client-supplied user id), with an insufficient-funds
-- guard baked into the WHERE clause so the debit and the check happen in
-- the same statement. One function handles both debit (negative p_delta)
-- and credit/refund (positive p_delta).
--
-- Safe to run multiple times.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.adjust_wallet_account_balance(
  p_delta DECIMAL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_id     UUID := auth.uid();
  v_new_balance DECIMAL;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;
  IF p_delta IS NULL OR p_delta = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount must be non-zero');
  END IF;

  UPDATE public.wallet_accounts
  SET balance = balance + p_delta
  WHERE user_id = v_user_id
    AND (p_delta > 0 OR balance >= -p_delta)
  RETURNING balance INTO v_new_balance;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient balance or wallet not found');
  END IF;

  RETURN jsonb_build_object('success', true, 'balance', v_new_balance);
END;
$$;

REVOKE ALL ON FUNCTION public.adjust_wallet_account_balance(DECIMAL) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.adjust_wallet_account_balance(DECIMAL) TO authenticated;

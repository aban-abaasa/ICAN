-- ============================================================================
-- FIX_AND_BACKFILL_PLATFORM_FEE_ROUTING.sql
-- ============================================================================
-- Purpose:
--   Two things, both extending ROUTE_PLATFORM_FEES_TO_IWOS_BUSINESS.sql:
--
--   1. FIX a correctness gap in that migration. sell_ican_coins() credits the
--      3% fee to the platform-fee business the instant a sale happens — but
--      when that sale is the debit leg of a mobile-money/bank payout
--      (request_ican_payout -> sell_ican_coins), and the Flutterwave
--      transfer later fails, resolve_ican_payout() (in
--      ICAN_FLUTTERWAVE_PAYOUT_MIGRATION.sql) refunds the seller's ICAN in
--      full — the sale is completely unwound. Without this fix, the fee
--      credit made at sale time was never reversed, so the business would
--      keep a fee for a sale that no longer happened. This migration:
--        a. Adds fn_reverse_platform_fee_to_business(), the mirror image of
--           fn_credit_platform_fee_to_business() — reverses a specific
--           credit by its original source_reference, idempotent, and never
--           raises (a reversal failure must not block refunding the user).
--        b. Re-defines resolve_ican_payout() to call it on failure (for both
--           the base 3% sell fee AND any extra payout fee), and to call
--           fn_credit_platform_fee_to_business() again on success as a
--           no-op-if-already-credited safety net (see point 2c below).
--
--   2. BACKFILL every historical fee the platform has ever actually realized
--      (i.e. deducted AND kept — not later refunded/reversed), crediting it
--      to the same platform-fee business via the same idempotent helper and
--      the same source_reference keys the prospective code now uses, so
--      running this can never double-credit anything the live triggers in
--      ROUTE_PLATFORM_FEES_TO_IWOS_BUSINESS.sql already covered:
--        a. sell_ican_coins() 3% fee — every ican_coin_transactions row with
--           transaction_type = 'sell' AND status = 'completed'. Rows with
--           status = 'failed' were fully refunded by resolve_ican_payout()
--           (the sale was unwound, no fee was ever really earned) and are
--           correctly excluded. Rows with status = 'pending' are payouts
--           still awaiting a Flutterwave outcome — left alone; they'll be
--           credited or excluded automatically once resolve_ican_payout()
--           runs for them (see 1b).
--        b. request_ican_payout()'s extra p_fee_ugx (default 0, historically
--           unused by any caller per ICAN_FEE_STRUCTURE_UPDATE.sql's own
--           comment, but computed defensively rather than assumed absent) —
--           for ican_payout_requests rows with status = 'completed', the
--           amount over the base 3% (fee_ugx - 3% of ugx_gross).
--        c. Corporate subscription charges — every
--           ican_corporate_subscription_charges row with outcome = 'charged'
--           (these have no separate resolve/reversal step; a charge is
--           final the moment it's recorded).
--
-- Run after: ROUTE_PLATFORM_FEES_TO_IWOS_BUSINESS.sql,
--            ICAN_FLUTTERWAVE_PAYOUT_MIGRATION.sql
-- Safe to re-run: every credit/reversal below is idempotent on
-- (source_app, source_reference) via ican_business_wallet_settlements'
-- existing UNIQUE constraint.
-- ============================================================================

-- ------------------------------------------------------------
-- 1a. Reversal helper — mirror image of fn_credit_platform_fee_to_business()
-- ------------------------------------------------------------
ALTER TABLE public.ican_business_wallet_settlements
  DROP CONSTRAINT IF EXISTS ican_business_wallet_settlements_settlement_type_check;
ALTER TABLE public.ican_business_wallet_settlements
  ADD CONSTRAINT ican_business_wallet_settlements_settlement_type_check
  CHECK (settlement_type IN ('pos_sale', 'investment', 'refund', 'other_income',
                              'platform_fee', 'platform_fee_reversal'));

CREATE OR REPLACE FUNCTION public.fn_reverse_platform_fee_to_business(
  p_source_app                TEXT,
  p_original_source_reference TEXT,   -- the source_reference the original credit used
  p_actor_user_id             UUID,
  p_reason                    TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_original      public.ican_business_wallet_settlements;
  v_reversal_ref  TEXT;
  v_settlement_id UUID;
  v_wallet        public.ican_business_wallets;
BEGIN
  SELECT * INTO v_original
  FROM public.ican_business_wallet_settlements
  WHERE source_app = trim(p_source_app)
    AND source_reference = p_original_source_reference
    AND settlement_type = 'platform_fee';

  IF v_original.id IS NULL THEN
    -- Nothing to reverse — the fee was never credited (e.g. the recipient
    -- business wasn't configured yet when the original sale happened, or
    -- there was no extra payout fee to begin with).
    RETURN jsonb_build_object('success', true, 'reversed', false, 'status', 'nothing_to_reverse');
  END IF;

  v_reversal_ref := 'reversal:' || p_original_source_reference;

  BEGIN
    INSERT INTO public.ican_business_wallet_settlements
      (business_profile_id, source_app, source_reference, amount_ican,
       settlement_type, note, metadata, settled_by)
    VALUES
      (v_original.business_profile_id, trim(p_source_app), v_reversal_ref, v_original.amount_ican,
       'platform_fee_reversal', COALESCE(p_reason, ''),
       jsonb_build_object('reverses', p_original_source_reference), p_actor_user_id)
    ON CONFLICT (source_app, source_reference) DO NOTHING
    RETURNING id INTO v_settlement_id;

    IF v_settlement_id IS NULL THEN
      RETURN jsonb_build_object('success', true, 'reversed', false, 'status', 'already_reversed');
    END IF;

    UPDATE public.ican_business_wallets
       SET ican_balance = ican_balance - v_original.amount_ican,
           total_spent  = total_spent + v_original.amount_ican,
           updated_at   = now()
     WHERE business_profile_id = v_original.business_profile_id
     RETURNING * INTO v_wallet;

    INSERT INTO public.ican_business_wallet_transactions
      (business_profile_id, initiated_by, amount_ican, note, reference_id,
       status, executed_at, direction, source_app, operation_type, metadata)
    VALUES
      (v_original.business_profile_id, p_actor_user_id, v_original.amount_ican, COALESCE(p_reason, ''),
       v_reversal_ref, 'completed', now(), 'out', trim(p_source_app), 'platform_fee_reversal',
       jsonb_build_object('reverses', p_original_source_reference));

    RETURN jsonb_build_object('success', true, 'reversed', true, 'balance', v_wallet.ican_balance);
  EXCEPTION WHEN OTHERS THEN
    -- Must never block refunding the user just because the business wallet
    -- can't take the debit back (e.g. it already spent the fee elsewhere).
    RETURN jsonb_build_object('success', false, 'reversed', false, 'error', SQLERRM);
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_reverse_platform_fee_to_business(TEXT, TEXT, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_reverse_platform_fee_to_business(TEXT, TEXT, UUID, TEXT) TO service_role;

-- ------------------------------------------------------------
-- 1b. resolve_ican_payout() — same body as ICAN_FLUTTERWAVE_PAYOUT_MIGRATION.sql,
--     plus: credit the base fee on success (idempotent safety net for any
--     payout that was still 'pending' when ROUTE_PLATFORM_FEES_TO_IWOS_BUSINESS.sql
--     was applied, so its sell never got credited at sale time), and reverse
--     both the base fee and any extra payout fee on failure.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION resolve_ican_payout(
  p_reference               TEXT,
  p_success                 BOOLEAN,
  p_flutterwave_transfer_id TEXT DEFAULT NULL,
  p_failure_reason          TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_request ican_payout_requests;
BEGIN
  SELECT * INTO v_request
  FROM ican_payout_requests
  WHERE flutterwave_reference = p_reference
    AND status IN ('pending', 'processing')
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Payout request not found or already resolved');
  END IF;

  IF p_success THEN
    UPDATE ican_payout_requests
    SET status = 'completed',
        flutterwave_transfer_id = COALESCE(p_flutterwave_transfer_id, flutterwave_transfer_id)
    WHERE id = v_request.id;

    UPDATE ican_coin_transactions
    SET status = 'completed'
    WHERE id = v_request.sell_tx_id;

    -- Safety net: no-ops (already_settled) if sell_ican_coins() already
    -- credited this at sale time, which is the normal case going forward.
    -- Only actually credits for a payout that was still 'pending' when the
    -- fee-routing migration was applied.
    PERFORM public.fn_credit_platform_fee_to_business(
      p_amount_ican      => ROUND(v_request.ican_amount * 0.03, 8),
      p_source_app       => v_request.source_app,
      p_source_reference => 'sell-fee:' || v_request.sell_tx_id::text,
      p_fee_type         => 'sell_fee',
      p_actor_user_id    => v_request.user_id,
      p_note             => format('3%% platform fee on sale of %s ICAN (sell tx %s, payout %s)',
                                    v_request.ican_amount::TEXT, v_request.sell_tx_id, v_request.id),
      p_metadata         => jsonb_build_object('sell_tx_id', v_request.sell_tx_id, 'payout_request_id', v_request.id)
    );

    RETURN jsonb_build_object('success', true, 'request_id', v_request.id, 'status', 'completed');
  ELSE
    UPDATE ican_payout_requests
    SET status = 'failed',
        failure_reason = p_failure_reason
    WHERE id = v_request.id;

    UPDATE ican_coin_transactions
    SET status = 'failed'
    WHERE id = v_request.sell_tx_id;

    -- Refund the debited ICAN in full — this reverses sell_ican_coins(), so
    -- it must not go through credit_ican_earning() (which would apply a 10%
    -- tithe on money the user never actually received).
    PERFORM get_or_create_ican_wallet(v_request.user_id);

    UPDATE ican_user_wallets
    SET ican_balance = ican_balance + v_request.ican_amount,
        total_spent  = total_spent  - v_request.ican_amount
    WHERE user_id = v_request.user_id;

    INSERT INTO ican_coin_transactions
      (recipient_user_id, ican_amount, transaction_type, source_app,
       reference_id, note, status)
    VALUES
      (v_request.user_id, v_request.ican_amount, 'refund', v_request.source_app,
       p_reference, format('Payout failed, refunded: %s', coalesce(p_failure_reason, 'unknown error')),
       'completed');

    -- The sale that produced these fees no longer happened — claw both back.
    -- Each is a safe no-op ('nothing_to_reverse') if it was never credited.
    PERFORM public.fn_reverse_platform_fee_to_business(
      v_request.source_app,
      'sell-fee:' || v_request.sell_tx_id::text,
      v_request.user_id,
      format('Payout failed, sell reversed: %s', coalesce(p_failure_reason, 'unknown error'))
    );
    PERFORM public.fn_reverse_platform_fee_to_business(
      v_request.source_app,
      'payout-fee:' || v_request.id::text,
      v_request.user_id,
      format('Payout failed: %s', coalesce(p_failure_reason, 'unknown error'))
    );

    RETURN jsonb_build_object('success', true, 'request_id', v_request.id, 'status', 'failed', 'refunded', true);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION resolve_ican_payout FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_ican_payout TO service_role;

-- ------------------------------------------------------------
-- 2a. Backfill: historical sell fees (3% of every finalized 'sell')
-- ------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
  v_result JSONB;
  v_count  INTEGER := 0;
BEGIN
  FOR r IN
    SELECT id, sender_user_id, ican_amount, source_app
    FROM public.ican_coin_transactions
    WHERE transaction_type = 'sell'
      AND status = 'completed'
      AND sender_user_id IS NOT NULL
  LOOP
    v_result := public.fn_credit_platform_fee_to_business(
      p_amount_ican      => ROUND(r.ican_amount * 0.03, 8),
      p_source_app       => r.source_app,
      p_source_reference => 'sell-fee:' || r.id::text,
      p_fee_type         => 'sell_fee',
      p_actor_user_id    => r.sender_user_id,
      p_note             => format('[backfill] 3%% platform fee on sale of %s ICAN (sell tx %s)', r.ican_amount::TEXT, r.id),
      p_metadata         => jsonb_build_object('sell_tx_id', r.id, 'ican_sold', r.ican_amount, 'backfill', true)
    );
    IF (v_result->>'credited')::boolean THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'Backfilled % historical sell fees', v_count;
END $$;

-- ------------------------------------------------------------
-- 2b. Backfill: historical extra payout fees (fee_ugx beyond the base 3%)
-- ------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
  v_extra  NUMERIC;
  v_result JSONB;
  v_count  INTEGER := 0;
BEGIN
  FOR r IN
    SELECT id, user_id, source_app, fee_ugx, ugx_gross
    FROM public.ican_payout_requests
    WHERE status = 'completed'
  LOOP
    v_extra := ROUND(r.fee_ugx - ROUND(r.ugx_gross * 0.03, 2), 2);
    IF v_extra > 0 THEN
      v_result := public.fn_credit_platform_fee_to_business(
        p_amount_ican      => ROUND(v_extra / 5000, 8),
        p_source_app       => r.source_app,
        p_source_reference => 'payout-fee:' || r.id::text,
        p_fee_type         => 'payout_fee',
        p_actor_user_id    => r.user_id,
        p_note             => format('[backfill] Flat payout fee UGX %s (%s ICAN) on payout request %s',
                                      v_extra::TEXT, ROUND(v_extra / 5000, 8)::TEXT, r.id),
        p_metadata         => jsonb_build_object('payout_request_id', r.id, 'fee_ugx', v_extra, 'backfill', true)
      );
      IF (v_result->>'credited')::boolean THEN
        v_count := v_count + 1;
      END IF;
    END IF;
  END LOOP;
  RAISE NOTICE 'Backfilled % historical extra payout fees', v_count;
END $$;

-- ------------------------------------------------------------
-- 2c. Backfill: historical corporate subscription charges
-- ------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
  v_result JSONB;
  v_count  INTEGER := 0;
BEGIN
  FOR r IN
    SELECT c.id, c.subscription_id, c.business_profile_id, c.amount_ic, bp.user_id AS owner_user_id
    FROM public.ican_corporate_subscription_charges c
    JOIN public.business_profiles bp ON bp.id = c.business_profile_id
    WHERE c.outcome = 'charged'
  LOOP
    v_result := public.fn_credit_platform_fee_to_business(
      p_amount_ican      => r.amount_ic,
      p_source_app       => 'ican',
      p_source_reference => 'corp-sub-charge:' || r.id::text,
      p_fee_type         => 'corporate_subscription',
      p_actor_user_id    => r.owner_user_id,
      p_note             => format('[backfill] Corporate subscription charge %s IC (subscription %s)', r.amount_ic::TEXT, r.subscription_id),
      p_metadata         => jsonb_build_object('subscription_id', r.subscription_id, 'charge_id', r.id, 'backfill', true)
    );
    IF (v_result->>'credited')::boolean THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'Backfilled % historical corporate subscription charges', v_count;
END $$;

-- ============================================================================
-- VERIFY
-- ============================================================================
-- 1. Overall totals credited to the platform-fee business so far (backfill + live):
-- SELECT settlement_type, count(*) AS rows, sum(amount_ican) AS total_ican
--   FROM ican_business_wallet_settlements
--  WHERE business_profile_id = fn_get_platform_fee_business_id()
--  GROUP BY settlement_type;
--
-- 2. Just the backfilled rows:
-- SELECT * FROM ican_business_wallet_settlements
--  WHERE business_profile_id = fn_get_platform_fee_business_id()
--    AND metadata->>'backfill' = 'true'
--  ORDER BY settled_at DESC;
--
-- 3. Current wallet balance:
-- SELECT ican_balance, total_earned FROM ican_business_wallets
--  WHERE business_profile_id = fn_get_platform_fee_business_id();
--
-- 4. Sanity check the exclusions were right — these should be the ONLY sell
--    rows NOT reflected in the backfill, and each should have a real reason:
-- SELECT status, count(*) FROM ican_coin_transactions
--  WHERE transaction_type = 'sell' GROUP BY status;
-- ============================================================================
-- END
-- ============================================================================

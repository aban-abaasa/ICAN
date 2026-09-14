-- ============================================================================
-- ROUTE_PLATFORM_FEES_TO_IWOS_BUSINESS.sql
-- ============================================================================
-- Purpose:
--   Every fee the platform currently takes gets computed, deducted, and then
--   discarded — never credited anywhere, so it's implicit, untracked
--   platform revenue sitting outside the ledger:
--     1. sell_ican_coins()               — flat 3% fee on ICAN -> UGX cash-out
--     2. request_ican_payout()           — optional extra flat p_fee_ugx charge
--     3. _fn_charge_corporate_subscription_row() — monthly_price_ic corporate
--        subscription charge, debited from a business wallet, credited nowhere
--
--   This migration routes all three into a single designated business's ICAN
--   wallet — configured once via ican_platform_fee_recipient, not hardcoded
--   in each fee function, so the recipient can be changed later without
--   touching sell_ican_coins/request_ican_payout/corporate billing again.
--
--   Bootstrapped to IWOS ORGANIZATION LIMITED, the business owned by the
--   account icancoin9@gmail.com.
--
--   OUT OF SCOPE: the 10% tithe system (TITHE_MANAGEMENT_SYSTEM.sql,
--   settle_tithe_to_treasury()) is a separate religious-giving mechanism with
--   its own clearing flow — not touched here. Dropship delivery/commission
--   fees are already credited to a store or rider wallet (real income, not a
--   discarded fee) — not touched either.
--
-- Run after: PITCHIN_BUSINESS_PROFILE_ICAN_WALLET.sql,
--            UNIFIED_BUSINESS_WALLET_OPERATIONS.sql,
--            ICAN_FEE_STRUCTURE_UPDATE.sql,
--            CORPORATE_SUBSCRIPTION_TRIAL_AND_ICAN_BILLING.sql
-- Safe to re-run. Additive only.
-- ============================================================================

-- ------------------------------------------------------------
-- 1. Fee-recipient business — configured once, looked up everywhere else
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ican_platform_fee_recipient (
  id                  boolean PRIMARY KEY DEFAULT true CHECK (id),
  business_profile_id UUID REFERENCES public.business_profiles(id) ON DELETE SET NULL,
  note                TEXT,
  updated_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Bootstrap to IWOS ORGANIZATION LIMITED (icancoin9@gmail.com). Only ever
-- sets this once — ON CONFLICT DO NOTHING means re-running this file never
-- clobbers a later manual reconfiguration. To point fees at a different
-- business afterwards, just:
--   UPDATE ican_platform_fee_recipient SET business_profile_id = '<id>', updated_at = now() WHERE id = true;
INSERT INTO public.ican_platform_fee_recipient (id, business_profile_id, note)
SELECT true, bp.id, 'IWOS ORGANIZATION LIMITED — icancoin9@gmail.com'
FROM public.business_profiles bp
JOIN public.profiles p ON p.id = bp.user_id
WHERE lower(p.email) = lower('icancoin9@gmail.com')
ORDER BY bp.created_at ASC
LIMIT 1
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.fn_get_platform_fee_business_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT business_profile_id FROM public.ican_platform_fee_recipient WHERE id = true;
$$;

REVOKE ALL ON FUNCTION public.fn_get_platform_fee_business_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_get_platform_fee_business_id() TO service_role;

-- ------------------------------------------------------------
-- 2. Business-wallet credit helper for fee revenue.
--
--    Reuses the settlement/idempotency table from
--    UNIFIED_BUSINESS_WALLET_OPERATIONS.sql (ican_business_wallet_settlements,
--    unique on (source_app, source_reference)) rather than inventing a new
--    one. Can't reuse that file's ican_settle_business_wallet_income()
--    directly: it hardcodes initiated_by = auth.uid(), and
--    ican_business_wallet_transactions.initiated_by is NOT NULL —
--    fn_run_corporate_billing_cycle() runs under cron/system privileges with
--    no JWT, so auth.uid() would be NULL there and the insert would fail.
--    This takes an explicit actor id instead.
-- ------------------------------------------------------------
ALTER TABLE public.ican_business_wallet_settlements
  DROP CONSTRAINT IF EXISTS ican_business_wallet_settlements_settlement_type_check;
ALTER TABLE public.ican_business_wallet_settlements
  ADD CONSTRAINT ican_business_wallet_settlements_settlement_type_check
  CHECK (settlement_type IN ('pos_sale', 'investment', 'refund', 'other_income', 'platform_fee'));

CREATE OR REPLACE FUNCTION public.fn_credit_platform_fee_to_business(
  p_amount_ican      NUMERIC,
  p_source_app       TEXT,
  p_source_reference TEXT,   -- unique per fee event, e.g. 'sell-fee:<tx_id>'
  p_fee_type         TEXT,   -- 'sell_fee' | 'payout_fee' | 'corporate_subscription'
  p_actor_user_id    UUID,   -- the user/business owner whose action produced the fee — never auth.uid()
  p_note             TEXT DEFAULT '',
  p_metadata         JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_business_id   UUID;
  v_settlement_id UUID;
  v_wallet        public.ican_business_wallets;
BEGIN
  IF p_amount_ican IS NULL OR p_amount_ican <= 0 THEN
    RETURN jsonb_build_object('success', false, 'credited', false, 'error', 'Amount must be positive');
  END IF;

  v_business_id := public.fn_get_platform_fee_business_id();
  IF v_business_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'credited', false,
      'error', 'Platform fee recipient business not configured');
  END IF;

  BEGIN
    INSERT INTO public.ican_business_wallet_settlements
      (business_profile_id, source_app, source_reference, amount_ican,
       settlement_type, note, metadata, settled_by)
    VALUES
      (v_business_id, trim(p_source_app), p_source_reference, p_amount_ican,
       'platform_fee', COALESCE(p_note, ''),
       COALESCE(p_metadata, '{}'::JSONB) || jsonb_build_object('fee_type', p_fee_type), p_actor_user_id)
    ON CONFLICT (source_app, source_reference) DO NOTHING
    RETURNING id INTO v_settlement_id;

    IF v_settlement_id IS NULL THEN
      RETURN jsonb_build_object('success', true, 'credited', false, 'status', 'already_settled',
        'business_profile_id', v_business_id);
    END IF;

    INSERT INTO public.ican_business_wallets (business_profile_id, created_by)
    SELECT id, user_id FROM public.business_profiles WHERE id = v_business_id
    ON CONFLICT (business_profile_id) DO NOTHING;

    UPDATE public.ican_business_wallets
       SET ican_balance = ican_balance + p_amount_ican,
           total_earned = total_earned + p_amount_ican,
           updated_at   = now()
     WHERE business_profile_id = v_business_id
     RETURNING * INTO v_wallet;

    INSERT INTO public.ican_business_wallet_transactions
      (business_profile_id, initiated_by, amount_ican, note, reference_id,
       status, executed_at, direction, source_app, operation_type, metadata)
    VALUES
      (v_business_id, p_actor_user_id, p_amount_ican, COALESCE(p_note, ''), p_source_reference,
       'completed', now(), 'in', trim(p_source_app), 'platform_fee',
       COALESCE(p_metadata, '{}'::JSONB) || jsonb_build_object('fee_type', p_fee_type));

    RETURN jsonb_build_object('success', true, 'credited', true,
      'business_profile_id', v_business_id, 'balance', v_wallet.ican_balance);
  EXCEPTION WHEN OTHERS THEN
    -- A fee-crediting failure must never break the user-facing sell/payout/
    -- billing operation that triggered it. Swallow, report, let the caller's
    -- PERFORM discard it — the fee stays exactly as untracked as it is today.
    RETURN jsonb_build_object('success', false, 'credited', false, 'error', SQLERRM);
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_credit_platform_fee_to_business(NUMERIC, TEXT, TEXT, TEXT, UUID, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_credit_platform_fee_to_business(NUMERIC, TEXT, TEXT, TEXT, UUID, TEXT, JSONB) TO service_role;

-- ------------------------------------------------------------
-- 3. sell_ican_coins() — credit the 3% base fee, in ICAN coin directly
--    (p_ican_amount * 0.03), not the UGX v_fee converted back through
--    /5000. The fee is "3% of what's being sold"; crediting the ICAN amount
--    directly is the single-rounding source of truth, versus v_fee which is
--    already the product of two roundings in UGX space
--    (ROUND(ROUND(p_ican_amount*5000,2)*0.03,2)). Also keeps this path
--    independent of the UGX conversion rate entirely.
--
--    Lives inside sell_ican_coins() itself (not duplicated in
--    request_ican_payout(), which always calls this function internally) so
--    the base fee is credited exactly once per sell or payout.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION sell_ican_coins(
  p_user_id     UUID,
  p_ican_amount DECIMAL,
  p_source_app  TEXT    DEFAULT 'ican',
  p_reference   TEXT    DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_current_bal DECIMAL;
  v_ugx_gross   DECIMAL;
  v_fee         DECIMAL;
  v_ugx_net     DECIMAL;
  v_actor_role  TEXT;
  v_tx_id       UUID;
BEGIN
  IF p_ican_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount must be positive');
  END IF;

  IF p_source_app NOT IN ('ican','digital-city-era','farm-agent','mybodaguy') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid source_app');
  END IF;

  SELECT ican_balance INTO v_current_bal
  FROM ican_user_wallets WHERE user_id = p_user_id FOR UPDATE;

  IF v_current_bal IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Wallet not found');
  END IF;

  IF v_current_bal < p_ican_amount THEN
    RETURN jsonb_build_object('success', false, 'error',
      format('Insufficient ICAN. Have: %s, Need: %s', v_current_bal, p_ican_amount));
  END IF;

  v_ugx_gross  := ROUND(p_ican_amount * 5000, 2);
  v_fee        := ROUND(v_ugx_gross * 0.03, 2);
  v_ugx_net    := v_ugx_gross - v_fee;
  v_actor_role := ican_resolve_caller_role();

  -- Debit the sold ICAN
  UPDATE ican_user_wallets
  SET ican_balance = ican_balance - p_ican_amount,
      total_spent  = total_spent  + p_ican_amount
  WHERE user_id = p_user_id;

  -- Record the sell transaction (sender = seller)
  INSERT INTO ican_coin_transactions
    (sender_user_id, ican_amount, transaction_type,
     source_app, reference_id, note, actor_role)
  VALUES
    (p_user_id, p_ican_amount, 'sell',
     p_source_app,
     p_reference,
     format('Sold %s ICAN for UGX %s net of 3%% fee (gross UGX %s, fee UGX %s, ref: %s)',
            p_ican_amount::TEXT, v_ugx_net::TEXT, v_ugx_gross::TEXT, v_fee::TEXT, coalesce(p_reference, '-')),
     v_actor_role)
  RETURNING id INTO v_tx_id;

  PERFORM public.fn_credit_platform_fee_to_business(
    p_amount_ican      => ROUND(p_ican_amount * 0.03, 8),
    p_source_app       => p_source_app,
    p_source_reference => 'sell-fee:' || v_tx_id::text,
    p_fee_type         => 'sell_fee',
    p_actor_user_id    => p_user_id,
    p_note             => format('3%% platform fee on sale of %s ICAN (sell tx %s)', p_ican_amount::TEXT, v_tx_id),
    p_metadata         => jsonb_build_object('sell_tx_id', v_tx_id, 'ican_sold', p_ican_amount)
  );

  RETURN jsonb_build_object(
    'success',    true,
    'tx_id',      v_tx_id,
    'ican_sold',  p_ican_amount,
    'ugx_gross',  v_ugx_gross,
    'fee_ugx',    v_fee,
    'ugx_payout', v_ugx_net,
    'actor_role', v_actor_role
  );
END;
$$;

-- ------------------------------------------------------------
-- 4. request_ican_payout() — credit its own extra p_fee_ugx (default 0,
--    unused by any caller today, but supported). This is the one genuinely
--    UGX-denominated fee (money that would've gone to mobile money/bank), so
--    the /5000 conversion is used only here, not in sell_ican_coins(). The
--    3% base fee is already credited by sell_ican_coins() above — not
--    repeated here, to avoid double-crediting.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION request_ican_payout(
  p_user_id       UUID,
  p_ican_amount   DECIMAL,
  p_channel       TEXT,
  p_destination   JSONB,
  p_source_app    TEXT,
  p_fee_ugx       DECIMAL DEFAULT 0
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_sell_result JSONB;
  v_sell_tx_id  UUID;
  v_ugx_gross   DECIMAL;
  v_sell_fee    DECIMAL;
  v_ugx_net     DECIMAL;
  v_reference   TEXT;
  v_request_id  UUID;
BEGIN
  IF p_channel NOT IN ('mobilemoneyuganda', 'bank') THEN
    RETURN jsonb_build_object('success', false, 'error', 'channel must be mobilemoneyuganda or bank');
  END IF;

  IF p_destination IS NULL OR p_destination = '{}'::jsonb THEN
    RETURN jsonb_build_object('success', false, 'error', 'destination is required');
  END IF;

  v_reference := 'PAYOUT-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-' ||
                 upper(substr(md5(gen_random_uuid()::text), 1, 8));

  -- sell_ican_coins() now bakes in the 3% platform fee itself, and credits
  -- it to the platform fee business as part of that call.
  v_sell_result := sell_ican_coins(p_user_id, p_ican_amount, p_source_app, v_reference);

  IF NOT (v_sell_result->>'success')::boolean THEN
    RETURN v_sell_result;
  END IF;

  v_sell_tx_id := (v_sell_result->>'tx_id')::UUID;
  v_ugx_gross  := (v_sell_result->>'ugx_gross')::DECIMAL;
  v_sell_fee   := (v_sell_result->>'fee_ugx')::DECIMAL;
  v_ugx_net    := (v_sell_result->>'ugx_payout')::DECIMAL - COALESCE(p_fee_ugx, 0);

  UPDATE ican_coin_transactions SET status = 'pending' WHERE id = v_sell_tx_id;

  IF v_ugx_net <= 0 THEN
    -- Refund directly (no tithe) — this reverses the debit sell_ican_coins()
    -- just made, so it must not go through credit_ican_earning().
    PERFORM get_or_create_ican_wallet(p_user_id);
    UPDATE ican_user_wallets
    SET ican_balance = ican_balance + p_ican_amount,
        total_spent  = total_spent  - p_ican_amount
    WHERE user_id = p_user_id;
    UPDATE ican_coin_transactions SET status = 'failed' WHERE id = v_sell_tx_id;
    INSERT INTO ican_coin_transactions
      (recipient_user_id, ican_amount, transaction_type, source_app, reference_id, note, status)
    VALUES
      (p_user_id, p_ican_amount, 'refund', p_source_app, v_reference,
       'Refund: fee exceeded payout amount', 'completed');
    RETURN jsonb_build_object('success', false, 'error', 'Fee exceeds payout amount');
  END IF;

  INSERT INTO ican_payout_requests
    (user_id, sell_tx_id, ican_amount, ugx_gross, fee_ugx, ugx_net,
     channel, destination, source_app, status, flutterwave_reference)
  VALUES
    (p_user_id, v_sell_tx_id, p_ican_amount, v_ugx_gross, v_sell_fee + COALESCE(p_fee_ugx, 0), v_ugx_net,
     p_channel, p_destination, p_source_app, 'pending', v_reference)
  RETURNING id INTO v_request_id;

  IF COALESCE(p_fee_ugx, 0) > 0 THEN
    PERFORM public.fn_credit_platform_fee_to_business(
      p_amount_ican      => ROUND(p_fee_ugx / 5000, 8),
      p_source_app       => p_source_app,
      p_source_reference => 'payout-fee:' || v_request_id::text,
      p_fee_type         => 'payout_fee',
      p_actor_user_id    => p_user_id,
      p_note             => format('Flat payout fee UGX %s (%s ICAN) on payout request %s',
                                    p_fee_ugx::TEXT, ROUND(p_fee_ugx / 5000, 8)::TEXT, v_request_id),
      p_metadata         => jsonb_build_object('payout_request_id', v_request_id, 'fee_ugx', p_fee_ugx)
    );
  END IF;

  RETURN jsonb_build_object(
    'success',    true,
    'request_id', v_request_id,
    'sell_tx_id', v_sell_tx_id,
    'reference',  v_reference,
    'ugx_gross',  v_ugx_gross,
    'fee_ugx',    v_sell_fee + COALESCE(p_fee_ugx, 0),
    'ugx_net',    v_ugx_net
  );
END;
$$;

REVOKE ALL ON FUNCTION request_ican_payout FROM PUBLIC;
GRANT EXECUTE ON FUNCTION request_ican_payout TO service_role;

-- ------------------------------------------------------------
-- 5. Corporate subscription billing — credit monthly_price_ic on every
--    successful charge. No currency conversion needed (already ICAN-
--    denominated). p_actor_user_id is looked up from business_profiles.user_id
--    rather than auth.uid(), because this function is invoked by
--    fn_run_corporate_billing_cycle() running under cron/system privileges
--    with no JWT — ican_business_wallet_transactions.initiated_by is NOT
--    NULL, so auth.uid() (NULL here) would violate that constraint.
--
--    Edge case: if IWOS itself is ever on a corporate subscription, its
--    charge debits its own wallet by v_charge and this credit immediately
--    re-credits the same wallet by v_charge — net zero balance change, two
--    ledger rows, functionally harmless.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._fn_charge_corporate_subscription_row(
  p_subscription public.ican_corporate_subscriptions
)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_charge   NUMERIC(18,8);
  v_wallet_id UUID;
  v_balance  NUMERIC(18,8);
  v_new_balance NUMERIC(18,8);
  v_charge_id UUID;
GRACE_DAYS CONSTANT INTEGER := 5;
BEGIN
  -- Flat tier price — NOT multiplied by employee_count.
  v_charge := p_subscription.monthly_price_ic;

  -- Auto-create the business wallet if it somehow doesn't exist yet (should
  -- already, from Pitchin onboarding) — mirrors get_or_create_pitchin_business_wallet
  -- but skips its auth.uid()-based access check, which has no meaning here.
  INSERT INTO public.ican_business_wallets (business_profile_id, created_by)
  VALUES (p_subscription.business_profile_id,
          (SELECT user_id FROM public.business_profiles WHERE id = p_subscription.business_profile_id))
  ON CONFLICT (business_profile_id) DO NOTHING;

  SELECT id, ican_balance INTO v_wallet_id, v_balance
  FROM public.ican_business_wallets
  WHERE business_profile_id = p_subscription.business_profile_id
  FOR UPDATE;

  IF v_balance >= v_charge THEN
    v_new_balance := v_balance - v_charge;

    UPDATE public.ican_business_wallets
       SET ican_balance = v_new_balance, total_spent = total_spent + v_charge, updated_at = now()
     WHERE id = v_wallet_id;

    UPDATE public.ican_corporate_subscriptions
       SET status = 'active',
           next_billing_at = p_subscription.next_billing_at + INTERVAL '1 month',
           past_due_since = NULL,
           updated_at = now()
     WHERE id = p_subscription.id;

    INSERT INTO public.ican_corporate_subscription_charges
      (subscription_id, business_profile_id, amount_ic, outcome, wallet_balance_after)
    VALUES (p_subscription.id, p_subscription.business_profile_id, v_charge, 'charged', v_new_balance)
    RETURNING id INTO v_charge_id;

    PERFORM public.fn_credit_platform_fee_to_business(
      p_amount_ican      => v_charge,
      p_source_app       => 'ican',
      p_source_reference => 'corp-sub-charge:' || v_charge_id::text,
      p_fee_type         => 'corporate_subscription',
      p_actor_user_id    => (SELECT user_id FROM public.business_profiles WHERE id = p_subscription.business_profile_id),
      p_note             => format('Corporate subscription charge %s IC (subscription %s)', v_charge::TEXT, p_subscription.id),
      p_metadata         => jsonb_build_object('subscription_id', p_subscription.id, 'charge_id', v_charge_id)
    );

    RETURN 'charged';
  END IF;

  -- Insufficient balance: never cut access immediately. Start (or continue)
  -- a grace window; Pitchin/CMS access stays on for GRACE_DAYS.
  IF p_subscription.past_due_since IS NOT NULL
     AND p_subscription.past_due_since <= now() - (GRACE_DAYS || ' days')::INTERVAL THEN
    UPDATE public.ican_corporate_subscriptions
       SET status = 'canceled', canceled_at = now(),
           cancel_reason = 'Wallet balance still insufficient after ' || GRACE_DAYS || '-day grace period',
           updated_at = now()
     WHERE id = p_subscription.id;

    INSERT INTO public.ican_corporate_subscription_charges
      (subscription_id, business_profile_id, amount_ic, outcome, wallet_balance_after)
    VALUES (p_subscription.id, p_subscription.business_profile_id, v_charge, 'insufficient_funds', v_balance);

    RETURN 'canceled_after_grace';
  END IF;

  UPDATE public.ican_corporate_subscriptions
     SET status = 'past_due',
         past_due_since = COALESCE(past_due_since, now()),
         updated_at = now()
   WHERE id = p_subscription.id;

  INSERT INTO public.ican_corporate_subscription_charges
    (subscription_id, business_profile_id, amount_ic, outcome, wallet_balance_after)
  VALUES (p_subscription.id, p_subscription.business_profile_id, v_charge, 'insufficient_funds', v_balance);

  RETURN 'past_due';
END;
$$;

-- ============================================================================
-- VERIFY
-- ============================================================================
-- 1. Confirm the IWOS business resolves correctly BEFORE relying on anything
--    else below:
-- SELECT bp.id AS business_profile_id, bp.business_name, bp.business_type, p.email
--   FROM business_profiles bp JOIN profiles p ON p.id = bp.user_id
--  WHERE lower(p.email) = lower('icancoin9@gmail.com')
--  ORDER BY bp.created_at ASC;
--
-- 2. Confirm the settings row picked it up:
-- SELECT * FROM ican_platform_fee_recipient;
-- SELECT fn_get_platform_fee_business_id();
--
-- 3. After a real sell / payout / billing cycle runs, confirm fees landed:
-- SELECT * FROM ican_business_wallet_settlements WHERE settlement_type = 'platform_fee' ORDER BY settled_at DESC LIMIT 20;
-- SELECT * FROM ican_business_wallet_transactions WHERE operation_type = 'platform_fee' ORDER BY created_at DESC LIMIT 20;
-- SELECT ican_balance, total_earned FROM ican_business_wallets WHERE business_profile_id = fn_get_platform_fee_business_id();
-- ============================================================================
-- END
-- ============================================================================

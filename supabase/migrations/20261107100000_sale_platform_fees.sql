-- ============================================================================
-- Sale fees: what ICANera takes from a BUSINESS when it makes a sale
--
-- WHAT IS CHARGED (defaults; both are rows in public.ican_fee_rates)
--   dropship_sale   2%   every IcanEra dropship sale - however the customer pays (wallet, mobile money, installments)
--   store_sale      1%   every Digital City Era store sale paid from an IcanEra wallet (the shop's self-checkout)
--
-- WHO PAYS: THE BUSINESS. The customer pays exactly the price on the shelf / the quote they were shown - nothing is added.
--   * Dropship: 2% of the goods sold (the store's price + tax + the reseller's markup; the delivery fare is the rider's and
--     is not part of it). It is taken from the RESELLER's markup, after any delivery subsidy, and never more than what is
--     left of that markup - a reseller is never charged more than the sale earned them (a sale with no markup left pays no
--     fee). The store's wholesale money and the rider's fare are untouched. It is queued as one more settlement leg next
--     to the store's and the reseller's, so ICANera is paid at the same moment they are: when the seal scan proves the
--     order left the store.
--   * Store sale: 1% of the order total, taken out of what the store receives. Before this the shop added an 8% surcharge
--     ON TOP of the customer's total (the shared commission.icanera_platform_fee_percentage knob, which rides still use).
--     That surcharge is gone for shop orders: the customer's total is now the shelf price, the store receives 99% of it.
--
-- HOW A DEVELOPER CHANGES A RATE (no redeploy, takes effect on the next sale)
--     UPDATE public.ican_fee_rates SET rate = 0.025 WHERE key = 'dropship_sale';   -- 2.5%
--     UPDATE public.ican_fee_rates SET rate = 0     WHERE key = 'store_sale';      -- free
--   A rate is a fraction from 0 up to (not including) 1. Anything else is refused by the table.
--
-- WHAT THIS MIGRATION DOES
--   1. two rows in ican_fee_rates, and ican_fee_rate() learns their fallbacks (a deleted row falls back to the default,
--      never silently to "free")
--   2. public.ican_sale_fee(key, base, cap, places): the one place the fee arithmetic lives
--   3. dropship_orders.platform_fee_amount / platform_fee_rate: what each sale paid, for reports
--   4. dropship_checkout (the 11-argument one every dropship path ends in) and customer_self_checkout are PATCHED IN PLACE
--      from whatever version is deployed (the way FIX_SELF_CHECKOUT_POINTS_AND_ADMIN_HISTORY.sql already does). Every
--      piece of text it replaces must be found exactly once in each function; if not, the migration stops with a message
--      and NOTHING is changed - it never overwrites a version it was not written for. Pricing, tax, stock, the delivery
--      fare, the rider's pay and the store's wholesale money are not touched.
--
-- NOT COVERED (separate money flows that say "no fee" in their own code and tests): cash/card/mobile-money tenders rung
-- up at a shop till, and the IcanEra digital card paid at a till (imc_pay_with_card).
--
-- Run after: FEE_RATES_PASTE_INTO_SUPABASE.sql (ican_fee_rates), ROUTE_PLATFORM_FEES_TO_IWOS_BUSINESS.sql (the fee-recipient
-- business), ADD_DROPSHIP_SMART_TRANSPORT.sql, DCE_CUSTOMER_SELFCHECKOUT.sql. Safe to run twice; it never overwrites a rate
-- a developer has changed. Roll back with supabase/rollback/20261107_rollback_sale_platform_fees.sql.
-- ============================================================================


-- ─── 0. Make sure everything this builds on is there ─────────────────────────

DO $guard$
BEGIN
  IF to_regclass('public.ican_fee_rates') IS NULL OR to_regprocedure('public.ican_fee_rate(text)') IS NULL THEN
    RAISE EXCEPTION 'Run FEE_RATES_PASTE_INTO_SUPABASE.sql first - it creates public.ican_fee_rates.';
  END IF;
  IF to_regprocedure('public.fn_get_platform_fee_business_id()') IS NULL THEN
    RAISE EXCEPTION 'Run ROUTE_PLATFORM_FEES_TO_IWOS_BUSINESS.sql first - it sets up the business that receives ICANera''s fees.';
  END IF;
  IF to_regclass('public.dropship_orders') IS NULL
     OR to_regprocedure('public.dropship_checkout(uuid,jsonb,text,text,text,text,numeric,numeric,numeric,uuid,text[])') IS NULL THEN
    RAISE EXCEPTION 'Run ADD_DROPSHIP_SMART_TRANSPORT.sql first - this patches its 11-argument dropship_checkout.';
  END IF;
  IF to_regprocedure('public.customer_self_checkout(jsonb,text,boolean,text)') IS NULL THEN
    RAISE EXCEPTION 'Run DCE_CUSTOMER_SELFCHECKOUT.sql first - this patches customer_self_checkout.';
  END IF;
END $guard$;


-- ─── 1. The rates ────────────────────────────────────────────────────────────

-- DO NOTHING on conflict: running this again must never undo a rate the developer has already changed.
INSERT INTO public.ican_fee_rates (key, rate, label) VALUES
  ('dropship_sale', 0.02, 'ICANera''s cut of every dropship sale - paid by the business, never added to the customer''s total'),
  ('store_sale',    0.01, 'ICANera''s cut of every Digital City Era store sale paid from an IcanEra wallet - paid by the store, never added to the customer''s total')
ON CONFLICT (key) DO NOTHING;

-- Same function as before, plus the two new fallbacks: a row someone deleted must not turn a charge into "free".
CREATE OR REPLACE FUNCTION public.ican_fee_rate(p_key TEXT) RETURNS NUMERIC
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT r.rate FROM public.ican_fee_rates r WHERE r.key = p_key),
    -- a deleted row must not turn a charge into "free" by accident
    CASE p_key
      WHEN 'send_mobile_money' THEN 0.03
      WHEN 'send_bank'         THEN 0.03
      WHEN 'withdraw_wallet'   THEN 0.03
      WHEN 'coin_cash_out'     THEN 0.03
      WHEN 'dropship_sale'     THEN 0.02
      WHEN 'store_sale'        THEN 0.01
      ELSE 0
    END)
$$;


-- ─── 2. The one place the fee arithmetic lives ───────────────────────────────

-- fee = base x rate(key), rounded to p_places, never below 0 and never above p_cap (when given) or the base itself.
CREATE OR REPLACE FUNCTION public.ican_sale_fee(
  p_key    TEXT,
  p_base   NUMERIC,
  p_cap    NUMERIC DEFAULT NULL,
  p_places INTEGER DEFAULT 2
) RETURNS NUMERIC
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN COALESCE(p_base, 0) <= 0 THEN 0
    ELSE GREATEST(0, LEAST(ROUND(p_base * public.ican_fee_rate(p_key), p_places), COALESCE(p_cap, p_base)))
  END
$$;

-- Only the checkout functions (which run as their owner) call this. Supabase grants new functions straight to the API roles,
-- and REVOKE ... FROM PUBLIC does not remove those, so they are revoked by name.
REVOKE ALL ON FUNCTION public.ican_sale_fee(TEXT, NUMERIC, NUMERIC, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ican_sale_fee(TEXT, NUMERIC, NUMERIC, INTEGER) TO service_role;


-- ─── 3. What each dropship sale paid ─────────────────────────────────────────

-- get_reseller_dropship_sales / get_store_dropship_sales return SETOF dropship_orders (SELECT *), so these columns reach
-- the reseller's "Sales" tab without touching those functions.
ALTER TABLE public.dropship_orders
  ADD COLUMN IF NOT EXISTS platform_fee_amount NUMERIC NOT NULL DEFAULT 0 CHECK (platform_fee_amount >= 0),
  ADD COLUMN IF NOT EXISTS platform_fee_rate   NUMERIC NOT NULL DEFAULT 0 CHECK (platform_fee_rate >= 0 AND platform_fee_rate < 1);


-- ─── 4. Patch the two checkouts in place ─────────────────────────────────────

-- Replace text that must occur exactly once (a soft patch only polishes wording: if it does not match it is skipped).
CREATE OR REPLACE FUNCTION pg_temp.ican_patch_lit(d TEXT, anchor TEXT, repl TEXT, what TEXT, soft BOOLEAN DEFAULT FALSE)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  n INTEGER := (length(d) - length(replace(d, anchor, ''))) / length(anchor);
BEGIN
  IF n = 1 THEN RETURN replace(d, anchor, repl); END IF;
  IF soft THEN
    RAISE NOTICE '% left as it is (wording only; found % times)', what, n;
    RETURN d;
  END IF;
  RAISE EXCEPTION '%: expected to find exactly one "%" but found % - this is not the version of the function this migration was written for, so NOTHING was changed', what, anchor, n;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.ican_patch_rx(d TEXT, pat TEXT, repl TEXT, what TEXT, soft BOOLEAN DEFAULT FALSE)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  n INTEGER := (SELECT count(*) FROM regexp_matches(d, pat, 'g'));
BEGIN
  IF n = 1 THEN RETURN regexp_replace(d, pat, repl); END IF;
  IF soft THEN
    RAISE NOTICE '% left as it is (wording only; found % times)', what, n;
    RETURN d;
  END IF;
  RAISE EXCEPTION '%: expected to find exactly one match for /%/ but found % - this is not the version of the function this migration was written for, so NOTHING was changed', what, pat, n;
END $$;

DO $patch$
DECLARE
  v_drop  TEXT := replace(pg_get_functiondef(to_regprocedure('public.dropship_checkout(uuid,jsonb,text,text,text,text,numeric,numeric,numeric,uuid,text[])')), E'\r\n', E'\n');
  v_store TEXT := replace(pg_get_functiondef(to_regprocedure('public.customer_self_checkout(jsonb,text,boolean,text)')), E'\r\n', E'\n');
  v_drop_done  BOOLEAN := position('ican_sale_fee(''dropship_sale''' IN v_drop) > 0;
  v_store_done BOOLEAN := position('ican_fee_rate(''store_sale'')' IN v_store) > 0;
BEGIN
  -- ── dropship_checkout: 2% of the goods, out of the reseller's markup ──────────────────────────────────────────────
  IF NOT v_drop_done THEN
    v_drop := pg_temp.ican_patch_lit(v_drop, 'v_delivery_fee NUMERIC := 0;',
$r$v_delivery_fee NUMERIC := 0;
  v_sale_goods_total NUMERIC := 0;
  v_platform_fee NUMERIC := 0;
  v_platform_fee_rate NUMERIC := 0;
  v_platform_business_id UUID;$r$,
      'dropship_checkout: declarations');

    -- the goods the customer bought (store price + tax + markup), before the delivery fare is added to their total
    v_drop := pg_temp.ican_patch_lit(v_drop, 'v_customer_total := v_customer_total + v_delivery_fee;',
$r$v_sale_goods_total := v_customer_total;
  v_customer_total := v_customer_total + v_delivery_fee;$r$,
      'dropship_checkout: goods total');

    -- the fee leg goes right after the delivery-subsidy block and before the reseller's markup leg, which then pays out
    -- whatever markup is left (the subsidy is cut from the markup the same way)
    v_drop := pg_temp.ican_patch_rx(v_drop,
      $r$(v_margin_total\s*:=\s*v_margin_total\s*-\s*v_subsidy_amount\s*;\s*END IF;)$r$,
$r$\1

  -- ── ICANera's dropship fee - paid by the business, never added to what the customer pays ──────────────────────────
  -- A percentage (ican_fee_rates.dropship_sale, default 2%) of the goods the customer bought: the store's price, the tax
  -- and the reseller's markup, but not the delivery fare, which belongs to the rider. It comes out of the reseller's
  -- markup AFTER any delivery subsidy and is capped at what is left of it, so a reseller is never charged more than the
  -- sale earned them and the customer's total is exactly what they were quoted. It is queued as one more settlement leg,
  -- so ICANera is paid at the same moment as the store and the reseller: when the seal scan proves the order left the
  -- store. With no fee-recipient business configured nothing is taken (a fee with nowhere to go is not charged).
  v_platform_fee_rate := public.ican_fee_rate('dropship_sale');
  v_platform_business_id := public.fn_get_platform_fee_business_id();
  IF v_platform_business_id IS NOT NULL THEN
    v_platform_fee := public.ican_sale_fee('dropship_sale', v_sale_goods_total, GREATEST(v_margin_total, 0), 2);
  END IF;

  IF v_platform_fee > 0 THEN
    v_leg_ican_amount := GREATEST(ROUND(v_platform_fee / 5000, 8), 0.00000001);

    SELECT ican_balance INTO v_debit_balance
      FROM public.ican_user_wallets WHERE user_id = v_auth_id FOR UPDATE;
    IF v_debit_balance < v_leg_ican_amount THEN
      RAISE EXCEPTION 'Insufficient ICAN balance for this purchase';
    END IF;

    UPDATE public.ican_user_wallets
       SET ican_balance = ican_balance - v_leg_ican_amount, total_spent = total_spent + v_leg_ican_amount
     WHERE user_id = v_auth_id;

    INSERT INTO public.ican_coin_transactions
      (sender_user_id, ican_amount, type, transaction_type, status, local_amount, local_currency,
       merchant_name, counterparty_type, expense_classification, source_app, reference_id, note, business_profile_id)
    VALUES
      (v_auth_id, v_leg_ican_amount, 'transfer_out', 'transfer_out', 'completed',
       v_platform_fee, 'UGX', 'ICANera', 'business', 'business_expense',
       'digital-city-era', v_tx_record_id || '_ICANERA_FEE',
       format('ICANera dropship fee (%s%%), paid by %s out of its markup | receipt %s (held until dispatch is confirmed)',
              trim_scale(round(v_platform_fee_rate * 100, 4))::TEXT, COALESCE(v_reseller_name, 'the reseller'), v_customer_receipt_no),
       v_platform_business_id);

    v_settlement_legs := v_settlement_legs || jsonb_build_array(jsonb_build_object(
      'payee_type', 'business', 'payee_id', v_platform_business_id,
      'ican_amount', v_leg_ican_amount, 'ugx_amount', v_platform_fee,
      'note', format('ICANera dropship fee | receipt %s', v_customer_receipt_no)
    ));

    -- what is left is the reseller's real profit, and is what the order records as its margin
    v_margin_total := v_margin_total - v_platform_fee;
  END IF;$r$,
      'dropship_checkout: fee leg');

    v_drop := pg_temp.ican_patch_lit(v_drop, ') RETURNING id INTO v_dropship_order_id;',
$r$) RETURNING id INTO v_dropship_order_id;

  UPDATE public.dropship_orders
     SET platform_fee_amount = v_platform_fee,
         platform_fee_rate   = CASE WHEN v_platform_fee > 0 THEN v_platform_fee_rate ELSE 0 END
   WHERE id = v_dropship_order_id;$r$,
      'dropship_checkout: order record');

    v_drop := pg_temp.ican_patch_lit(v_drop, '''reseller_margin_total'', v_margin_total,',
$r$'reseller_margin_total', v_margin_total,
    'platform_fee', v_platform_fee,
    'platform_fee_rate', v_platform_fee_rate,$r$,
      'dropship_checkout: result');

    IF position('ican_sale_fee(''dropship_sale''' IN v_drop) = 0 THEN
      RAISE EXCEPTION 'dropship_checkout: the patch did not take - NOTHING was changed';
    END IF;
  END IF;

  -- ── customer_self_checkout: 1% out of what the store receives, instead of an 8% surcharge on the customer ─────────
  IF NOT v_store_done THEN
    v_store := pg_temp.ican_patch_lit(v_store,
      $r$public.mbg_get_setting_numeric('commission.icanera_platform_fee_percentage', 8)$r$,
      $r$public.ican_fee_rate('store_sale') * 100$r$,
      'customer_self_checkout: rate');

    -- the customer is charged the shelf price, not the shelf price plus a surcharge...
    v_store := pg_temp.ican_patch_rx(v_store,
      $r$v_customer_charge_ican\s*:=\s*ROUND\(\s*v_store_ican\s*\*\s*\(\s*1\s*\+\s*v_platform_fee_pct\s*/\s*100\s*\)\s*,\s*8\s*\)\s*;$r$,
      $r$v_customer_charge_ican := v_store_ican;$r$,
      'customer_self_checkout: customer charge');

    -- ...and the fee is a share of it that the store does not receive
    v_store := pg_temp.ican_patch_rx(v_store,
      $r$v_platform_fee_ican\s*:=\s*v_customer_charge_ican\s*-\s*v_store_ican\s*;$r$,
      $r$v_platform_fee_ican := public.ican_sale_fee('store_sale', v_store_ican, NULL, 8);$r$,
      'customer_self_checkout: fee');

    v_store := pg_temp.ican_patch_rx(v_store,
      $r$(transfer_ican\(\s*v_auth_id,\s*v_store_owner_id,\s*)v_store_ican(\s*,)$r$,
      $r$\1v_store_ican - v_platform_fee_ican\2$r$,
      'customer_self_checkout: amount the store receives');

    -- the same amount in shillings for the wallet history: the newer checkout converts at v_price_per_ican and passes
    -- v_currency, the one deployed before it hard-codes 5000 and 'UGX' - both are handled
    v_store := pg_temp.ican_patch_rx(v_store,
      $r$(v_tx_record_id,\s*)v_net_total(\s*,\s*(?:v_currency|'UGX')\s*,)$r$,
      $r$\1ROUND((v_store_ican - v_platform_fee_ican) * $r$
        || CASE WHEN position('v_price_per_ican' IN v_store) > 0 THEN 'v_price_per_ican' ELSE '5000' END
        || $r$, 2)\2$r$,
      'customer_self_checkout: local amount the store receives');

    -- wording only: say in the store's wallet and the customer's history why it is 1% less / what the fee row is
    v_store := pg_temp.ican_patch_lit(v_store,
      $r$format('Supermarket self-checkout | receipt %s', v_receipt_no)$r$,
      $r$format('Supermarket self-checkout | receipt %s | after the %s%% ICANera store fee', v_receipt_no, trim_scale(v_platform_fee_pct)::TEXT)$r$,
      'customer_self_checkout: store wallet note', TRUE);
    v_store := pg_temp.ican_patch_lit(v_store,
      $r$format('ICANera platform fee on supermarket order | receipt %s', v_receipt_no)$r$,
      $r$format('ICANera %s%% store fee, paid by the store and already inside your total | receipt %s', trim_scale(v_platform_fee_pct)::TEXT, v_receipt_no)$r$,
      'customer_self_checkout: fee row note', TRUE);

    IF position('ican_fee_rate(''store_sale'')' IN v_store) = 0
       OR position('commission.icanera_platform_fee_percentage' IN v_store) > 0 THEN
      RAISE EXCEPTION 'customer_self_checkout: the patch did not take - NOTHING was changed';
    END IF;
  END IF;

  -- every piece of text in BOTH functions was found exactly once before either function is touched
  IF NOT v_drop_done  THEN EXECUTE v_drop;  ELSE RAISE NOTICE 'dropship_checkout already charges the dropship fee - left as it is'; END IF;
  IF NOT v_store_done THEN EXECUTE v_store; ELSE RAISE NOTICE 'customer_self_checkout already charges the store fee - left as it is'; END IF;
END $patch$;

NOTIFY pgrst, 'reload schema';

DO $done$
BEGIN
  RAISE NOTICE 'ICANera now takes % of every dropship sale and % of every Digital City Era store sale paid from an IcanEra wallet - from the BUSINESS, never added to the customer''s total.',
    trim_scale(round(public.ican_fee_rate('dropship_sale') * 100, 4))::TEXT || '%', trim_scale(round(public.ican_fee_rate('store_sale') * 100, 4))::TEXT || '%';
END $done$;

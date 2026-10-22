-- Rolls back 20261107100000_sale_platform_fees.sql
--
--   * dropship_checkout stops taking the dropship fee: the reseller is paid the full markup again
--   * customer_self_checkout goes back to the 8% surcharge ADDED TO THE CUSTOMER'S TOTAL (the shared
--     commission.icanera_platform_fee_percentage setting) and the store receives the full order total
--   * the two rates, ican_sale_fee() and the new fallbacks in ican_fee_rate() are removed
--
-- It deliberately KEEPS dropship_orders.platform_fee_amount / platform_fee_rate: orders that already paid a fee keep a
-- record of it (new orders just record 0). Fees already released to ICANera stay in its wallet.
-- Only the functions this migration patched are touched, and only the pieces it added; anything else in them stays.
-- Safe to run twice.

DO $unpatch$
DECLARE
  v_drop_oid  OID := to_regprocedure('public.dropship_checkout(uuid,jsonb,text,text,text,text,numeric,numeric,numeric,uuid,text[])');
  v_store_oid OID := to_regprocedure('public.customer_self_checkout(jsonb,text,boolean,text)');
  v_def TEXT;
BEGIN
  IF v_drop_oid IS NOT NULL THEN
    v_def := replace(pg_get_functiondef(v_drop_oid), E'\r\n', E'\n');
    IF position('ican_sale_fee(''dropship_sale''' IN v_def) > 0 THEN
      -- the fee leg
      v_def := regexp_replace(v_def,
        $r$\s*-- [^\n]*ICANera's dropship fee.*?v_margin_total\s*:=\s*v_margin_total\s*-\s*v_platform_fee\s*;\s*END IF;$r$, '');
      v_def := replace(v_def, $r$
  v_sale_goods_total NUMERIC := 0;
  v_platform_fee NUMERIC := 0;
  v_platform_fee_rate NUMERIC := 0;
  v_platform_business_id UUID;$r$, '');
      v_def := replace(v_def, $r$v_sale_goods_total := v_customer_total;
  v_customer_total := v_customer_total + v_delivery_fee;$r$, 'v_customer_total := v_customer_total + v_delivery_fee;');
      v_def := replace(v_def, $r$

  UPDATE public.dropship_orders
     SET platform_fee_amount = v_platform_fee,
         platform_fee_rate   = CASE WHEN v_platform_fee > 0 THEN v_platform_fee_rate ELSE 0 END
   WHERE id = v_dropship_order_id;$r$, '');
      v_def := replace(v_def, $r$
    'platform_fee', v_platform_fee,
    'platform_fee_rate', v_platform_fee_rate,$r$, '');
      IF position('ican_sale_fee' IN v_def) > 0 OR position('v_platform_fee' IN v_def) > 0
         OR position('v_sale_goods_total' IN v_def) > 0 OR position('v_platform_business_id' IN v_def) > 0 THEN
        RAISE EXCEPTION 'dropship_checkout was changed after the migration and can no longer be unpatched automatically - NOTHING was changed';
      END IF;
      EXECUTE v_def;
    END IF;
  END IF;

  IF v_store_oid IS NOT NULL THEN
    v_def := replace(pg_get_functiondef(v_store_oid), E'\r\n', E'\n');
    IF position('ican_fee_rate(''store_sale'')' IN v_def) > 0 THEN
      v_def := replace(v_def, $r$public.ican_fee_rate('store_sale') * 100$r$,
                              $r$public.mbg_get_setting_numeric('commission.icanera_platform_fee_percentage', 8)$r$);
      v_def := replace(v_def, $r$v_customer_charge_ican := v_store_ican;$r$,
                              $r$v_customer_charge_ican := ROUND(v_store_ican * (1 + v_platform_fee_pct / 100), 8);$r$);
      v_def := replace(v_def, $r$v_platform_fee_ican := public.ican_sale_fee('store_sale', v_store_ican, NULL, 8);$r$,
                              $r$v_platform_fee_ican    := v_customer_charge_ican - v_store_ican;$r$);
      v_def := regexp_replace(v_def,
        $r$(transfer_ican\(\s*v_auth_id,\s*v_store_owner_id,\s*)v_store_ican\s*-\s*v_platform_fee_ican(\s*,)$r$, $r$\1v_store_ican\2$r$);
      v_def := replace(v_def, $r$ROUND((v_store_ican - v_platform_fee_ican) * v_price_per_ican, 2)$r$, 'v_net_total');
      v_def := replace(v_def, $r$ROUND((v_store_ican - v_platform_fee_ican) * 5000, 2)$r$, 'v_net_total');
      v_def := replace(v_def,
        $r$format('Supermarket self-checkout | receipt %s | after the %s%% ICANera store fee', v_receipt_no, trim_scale(v_platform_fee_pct)::TEXT)$r$,
        $r$format('Supermarket self-checkout | receipt %s', v_receipt_no)$r$);
      v_def := replace(v_def,
        $r$format('ICANera %s%% store fee, paid by the store and already inside your total | receipt %s', trim_scale(v_platform_fee_pct)::TEXT, v_receipt_no)$r$,
        $r$format('ICANera platform fee on supermarket order | receipt %s', v_receipt_no)$r$);
      IF position('ican_fee_rate(''store_sale'')' IN v_def) > 0 OR position('ican_sale_fee' IN v_def) > 0 THEN
        RAISE EXCEPTION 'customer_self_checkout was changed after the migration and can no longer be unpatched automatically - NOTHING was changed';
      END IF;
      EXECUTE v_def;
    END IF;
  END IF;
END $unpatch$;

DROP FUNCTION IF EXISTS public.ican_sale_fee(TEXT, NUMERIC, NUMERIC, INTEGER);

DELETE FROM public.ican_fee_rates WHERE key IN ('dropship_sale', 'store_sale');

-- back to the function exactly as 20261106100000_fee_rates.sql defined it
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
      ELSE 0
    END)
$$;

NOTIFY pgrst, 'reload schema';

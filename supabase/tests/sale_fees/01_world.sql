\set ON_ERROR_STOP on
-- The shop, the reseller, the platform-fee business and a rider, plus helpers that run ONE sale and report what moved.
--
--   dropship product  UGX 10,000 shelf price, 18% VAT, 1,000,000 in stock;  shop product  UGX 10,000, no tax
--   store        t.u(100), owner t.u(101), business wallet t.u(110)
--   reseller     business t.u(120), owner t.u(121)
--   ICANera      business t.u(130) = the fee recipient
--   rider        t.u(140) (rider row t.u(141)); the delivery fare comes out at UGX 6,000 (1,000 + 5 km x 1,000)
--   customers    t.u(1000 + n)
--   1 ICAN = UGX 5,000, the fixed rate both checkouts use for UGX shops

INSERT INTO public.business_profiles (id, user_id, business_name) VALUES
  (t.u(110), t.u(101), 'Store Business'), (t.u(120), t.u(121), 'Reseller Business'), (t.u(130), t.u(131), 'ICANera');
INSERT INTO public.ican_platform_fee_recipient (id, business_profile_id) VALUES (true, t.u(130));
INSERT INTO public.supermarkets (id, owner_user_id, name, address, pichin_business_profile_id, latitude, longitude)
  VALUES (t.u(100), t.u(101), 'Test Supermarket', 'Plot 1', t.u(110), 0.31, 32.58);
INSERT INTO public.products (id, supermarket_id, name, sku, barcode, selling_price, tax_rate)
  VALUES (t.u(201), t.u(100), 'Rice 5kg', 'RICE5', '123', 10000, 18);
INSERT INTO public.inventory (product_id, supermarket_id, current_stock) VALUES (t.u(201), t.u(100), 1000000);
-- the shop sales use a product with NO tax, so a shop sale totals UGX 10,000 x qty whichever way the deployed checkout prices
-- tax (inside the shelf price, as the repo's copy does, or on top of it, as the older deployed one does) - tax is not what is tested
INSERT INTO public.products (id, supermarket_id, name, sku, barcode, selling_price, tax_rate)
  VALUES (t.u(202), t.u(100), 'Sugar 1kg', 'SUGAR1', '456', 10000, 0);
INSERT INTO public.inventory (product_id, supermarket_id, current_stock) VALUES (t.u(202), t.u(100), 1000000);
INSERT INTO public.mbg_riders (id, user_id, status, is_available) VALUES (t.u(141), t.u(140), 'active', true);
INSERT INTO public.mbg_stages (is_active, location_lat, location_lng) VALUES (true, 0.3, 32.5);
INSERT INTO public.ican_user_wallets (user_id, ican_balance) VALUES (t.u(101), 0), (t.u(121), 0), (t.u(140), 0);

-- a wallet balance, 0 when the wallet does not exist yet (a business wallet is created by its first credit)
CREATE FUNCTION t.bizbal(p_business UUID) RETURNS NUMERIC LANGUAGE sql AS $$
  SELECT COALESCE((SELECT ican_balance FROM public.ican_business_wallets WHERE business_profile_id = p_business), 0) $$;
CREATE FUNCTION t.userbal(p_user UUID) RETURNS NUMERIC LANGUAGE sql AS $$
  SELECT COALESCE((SELECT ican_balance FROM public.ican_user_wallets WHERE user_id = p_user), 0) $$;

-- ── the sum of ican_amount in a list of settlement legs (optionally only those for one payee) ───────────────────────
CREATE FUNCTION t.legs_total(p_legs JSONB, p_payee UUID DEFAULT NULL) RETURNS NUMERIC LANGUAGE sql AS $$
  SELECT COALESCE(sum((l->>'ican_amount')::NUMERIC), 0)
    FROM jsonb_array_elements(COALESCE(p_legs, '[]'::JSONB)) l
   WHERE p_payee IS NULL OR (l->>'payee_id')::UUID = p_payee $$;
CREATE FUNCTION t.legs_for(p_legs JSONB, p_payee UUID) RETURNS INTEGER LANGUAGE sql AS $$
  SELECT count(*)::INT FROM jsonb_array_elements(COALESCE(p_legs, '[]'::JSONB)) l WHERE (l->>'payee_id')::UUID = p_payee $$;

-- ── ONE dropship sale: the reseller lists the product at p_listed, customer n buys p_qty ────────────────────────────
-- Returns { ok, res, order, legs, debit } or { ok: false, error }; an error rolls the sale back, as a real one would.
CREATE FUNCTION t.dropship(
  p_n INT, p_listed NUMERIC, p_qty INT DEFAULT 2, p_free BOOLEAN DEFAULT FALSE, p_subsidy NUMERIC DEFAULT 0, p_fund NUMERIC DEFAULT 1000
) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  v_res JSONB; v_order public.dropship_orders; v_legs JSONB; v_bal NUMERIC;
BEGIN
  -- set-up that must survive a refused sale
  INSERT INTO public.dropship_listings (reseller_business_profile_id, product_id, supermarket_id, listed_price, free_delivery, max_delivery_subsidy)
    VALUES (t.u(120), t.u(201), t.u(100), p_listed, p_free, p_subsidy)
    ON CONFLICT (reseller_business_profile_id, product_id) DO UPDATE
      SET listed_price = EXCLUDED.listed_price, free_delivery = EXCLUDED.free_delivery, max_delivery_subsidy = EXCLUDED.max_delivery_subsidy;
  UPDATE public.mbg_rides SET status = 'completed';   -- the one rider is free again
  INSERT INTO public.ican_user_wallets (user_id, ican_balance) VALUES (t.u(1000 + p_n), p_fund)
    ON CONFLICT (user_id) DO UPDATE SET ican_balance = EXCLUDED.ican_balance, total_spent = 0;
  PERFORM t.login(1000 + p_n);
  BEGIN   -- the sale itself: if it raises, everything inside is rolled back, as a real checkout would be
    v_res := public.dropship_checkout(t.u(120), jsonb_build_array(jsonb_build_object('product_id', t.u(201), 'quantity', p_qty)),
                                      'Cust', '0700', 'Addr', 'Loc', 0.35, 32.58, 24, NULL, NULL);
    SELECT * INTO v_order FROM public.dropship_orders WHERE id = (v_res ->> 'dropship_order_id')::UUID;
    SELECT settlement_legs INTO v_legs FROM public.stub_delivery_receipts WHERE reference_id = v_order.id;
    SELECT ican_balance INTO v_bal FROM public.ican_user_wallets WHERE user_id = t.u(1000 + p_n);
    RETURN jsonb_build_object('ok', true, 'res', v_res, 'order', to_jsonb(v_order), 'legs', v_legs, 'debit', p_fund - v_bal);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
  END;
END $$;

-- The seal scan releases every leg. This is the loop in icanera_confirm_pickup (RESTRICT_DELIVERY_RECEIPT_APPROVAL_TO_STORE_MEMBERS.sql),
-- which this migration does not change: a business payee is credited by ican_settle_business_wallet_income, a personal one
-- (the rider) by mbg_credit_ride_earning.
CREATE FUNCTION t.release(p_order UUID) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_legs JSONB; v_leg JSONB; v_i INT := 0;
BEGIN
  SELECT settlement_legs INTO v_legs FROM public.stub_delivery_receipts WHERE reference_id = p_order;
  FOR v_leg IN SELECT * FROM jsonb_array_elements(v_legs) LOOP
    v_i := v_i + 1;
    IF COALESCE(v_leg ->> 'payee_type', 'business') = 'personal' THEN
      PERFORM public.mbg_credit_ride_earning((v_leg ->> 'payee_id')::UUID, (v_leg ->> 'ican_amount')::NUMERIC, 'digital-city-era', 'LEG' || v_i, COALESCE(v_leg ->> 'note', ''));
    ELSE
      PERFORM public.ican_settle_business_wallet_income((v_leg ->> 'payee_id')::UUID, (v_leg ->> 'ican_amount')::NUMERIC, 'digital-city-era', 'LEG' || v_i, 'pos_sale', COALESCE(v_leg ->> 'note', ''), '{}'::JSONB);
    END IF;
  END LOOP;
END $$;

-- ── ONE shop sale paid from an IcanEra wallet (or not): customer n buys p_qty at UGX 10,000 ─────────────────────────
CREATE FUNCTION t.store_sale(p_n INT, p_qty INT DEFAULT 3, p_fund NUMERIC DEFAULT 1000, p_ican BOOLEAN DEFAULT TRUE) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  v_res JSONB; v_bal NUMERIC; v_store_before NUMERIC; v_plat_before NUMERIC;
BEGIN
  INSERT INTO public.ican_user_wallets (user_id, ican_balance) VALUES (t.u(1000 + p_n), p_fund)
    ON CONFLICT (user_id) DO UPDATE SET ican_balance = EXCLUDED.ican_balance, total_spent = 0;
  PERFORM t.login(1000 + p_n);
  v_store_before := t.userbal(t.u(101));
  v_plat_before := t.bizbal(t.u(130));
  BEGIN   -- the sale itself: if it raises, everything inside is rolled back, as a real checkout would be
    v_res := public.customer_self_checkout(jsonb_build_array(jsonb_build_object('product_id', t.u(202), 'quantity', p_qty)),
                                           CASE WHEN p_ican THEN 'ican' ELSE 'cash' END, p_ican, 'Main');
    v_bal := t.userbal(t.u(1000 + p_n));
    RETURN jsonb_build_object('ok', true, 'res', v_res, 'debit', p_fund - v_bal,
                              'store_got', t.userbal(t.u(101)) - v_store_before, 'platform_got', t.bizbal(t.u(130)) - v_plat_before);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
  END;
END $$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA t TO PUBLIC;

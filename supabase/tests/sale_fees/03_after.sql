\set ON_ERROR_STOP on
SET client_min_messages = info;
-- AFTER the migration. Same sales as before; now ICANera takes its cut from the BUSINESS and the customer pays what they were quoted.

DO $t$
DECLARE d JSONB; s JSONB; n INT := 100; plat0 NUMERIC; plat1 NUMERIC; res0 NUMERIC; res1 NUMERIC; store0 NUMERIC; store1 NUMERIC; rider0 NUMERIC; rider1 NUMERIC;
BEGIN
  -- ── 1. the rates ─────────────────────────────────────────────────────────────────
  PERFORM t.check('1.1 the two new rates are 2% (dropship) and 1% (store); the four old ones are untouched',
    (SELECT count(*) FROM public.ican_fee_rates) = 6
    AND (SELECT rate FROM public.ican_fee_rates WHERE key = 'dropship_sale') = 0.02
    AND (SELECT rate FROM public.ican_fee_rates WHERE key = 'store_sale') = 0.01
    AND (SELECT bool_and(rate = 0.03) FROM public.ican_fee_rates WHERE key NOT IN ('dropship_sale', 'store_sale')));
  PERFORM t.check('1.2 anyone can read the rates, nobody but the SQL editor can change them',
    has_table_privilege('anon', 'public.ican_fee_rates', 'SELECT') AND NOT has_table_privilege('authenticated', 'public.ican_fee_rates', 'UPDATE'));

  -- ── 2. the arithmetic ────────────────────────────────────────────────────────────
  PERFORM t.check('2.1 2% of UGX 29,500 is 590', public.ican_sale_fee('dropship_sale', 29500, NULL, 2) = 590);
  PERFORM t.check('2.2 the cap wins: UGX 20 of markup left means a UGX 20 fee, 0 means none',
    public.ican_sale_fee('dropship_sale', 29500, 20, 2) = 20 AND public.ican_sale_fee('dropship_sale', 29500, 0, 2) = 0);
  PERFORM t.check('2.3 rounded to the places asked for', public.ican_sale_fee('dropship_sale', 12345, NULL, 2) = 246.90
    AND public.ican_sale_fee('store_sale', 6, NULL, 8) = 0.06 AND public.ican_sale_fee('store_sale', 1.23456789, NULL, 8) = 0.01234568);
  PERFORM t.check('2.4 no base, a negative base or an unknown key is no fee, never a negative one',
    public.ican_sale_fee('dropship_sale', 0) = 0 AND public.ican_sale_fee('dropship_sale', NULL) = 0
    AND public.ican_sale_fee('dropship_sale', -500) = 0 AND public.ican_sale_fee('nonsense', 1000) = 0);
  CREATE TEMP TABLE saved_rates AS SELECT * FROM public.ican_fee_rates;
  DELETE FROM public.ican_fee_rates WHERE key IN ('dropship_sale', 'store_sale');
  PERFORM t.check('2.5 a deleted rate falls back to its default, never to free',
    public.ican_fee_rate('dropship_sale') = 0.02 AND public.ican_fee_rate('store_sale') = 0.01 AND public.ican_fee_rate('send_bank') = 0.03);
  DELETE FROM public.ican_fee_rates; INSERT INTO public.ican_fee_rates SELECT * FROM saved_rates;

  -- ── 3. a dropship sale: 10,000 x 2 listed at 12,500 ───────────────────────────────
  d := t.dropship(10, 12500);
  PERFORM t.check('3.1 the sale goes through', (d ->> 'ok')::BOOLEAN AND (d -> 'res' ->> 'success')::BOOLEAN, d::TEXT);
  PERFORM t.check('3.2 the customer pays EXACTLY what they paid before (7.1 ICAN) - the fee is not added to anything',
    (d ->> 'debit')::NUMERIC = 7.1 AND (d ->> 'debit')::NUMERIC = (SELECT v::NUMERIC FROM t.keep WHERE k = 'b_dropship_debit'), d ->> 'debit');
  PERFORM t.check('3.3 ICANera gets 2% of the goods (UGX 29,500 -> 590 = 0.118 ICAN), the delivery fare is not part of it',
    (d -> 'order' ->> 'platform_fee_amount')::NUMERIC = 590 AND t.legs_total(d -> 'legs', t.u(130)) = 0.118, (d -> 'order')::TEXT);
  PERFORM t.check('3.4 it comes out of the reseller: markup 5,000 -> 4,410 (0.882 ICAN)',
    t.legs_total(d -> 'legs', t.u(120)) = 0.882 AND (d -> 'order' ->> 'reseller_margin_amount')::NUMERIC = 4410, (d -> 'legs')::TEXT);
  PERFORM t.check('3.5 the store and the rider are untouched: 4.9 and 1.2 ICAN',
    t.legs_total(d -> 'legs', t.u(110)) = 4.9 AND t.legs_total(d -> 'legs', t.u(140)) = 1.2);
  PERFORM t.check('3.6 every coin the customer paid lands somewhere: the legs add up to the debit', t.legs_total(d -> 'legs') = (d ->> 'debit')::NUMERIC);
  PERFORM t.check('3.7 the order adds up in shillings: paid 35,500 = store 24,500 + reseller 4,410 + ICANera 590 + rider fare 6,000',
    (d -> 'order' ->> 'customer_paid_amount')::NUMERIC = 35500
    AND (d -> 'order' ->> 'wholesale_amount')::NUMERIC + (d -> 'order' ->> 'reseller_margin_amount')::NUMERIC
        + (d -> 'order' ->> 'platform_fee_amount')::NUMERIC + (d -> 'order' ->> 'real_transport_fare')::NUMERIC = 35500, (d -> 'order')::TEXT);
  PERFORM t.check('3.8 the order records the rate it was charged at, and the answer carries the fee',
    (d -> 'order' ->> 'platform_fee_rate')::NUMERIC = 0.02 AND (d -> 'res' ->> 'platform_fee')::NUMERIC = 590 AND (d -> 'res' ->> 'reseller_margin_total')::NUMERIC = 4410);
  PERFORM t.check('3.9 the customer''s wallet history shows the fee as its own line, paid to the ICANera business',
    EXISTS (SELECT 1 FROM public.ican_coin_transactions WHERE sender_user_id = t.u(1010) AND reference_id LIKE '%\_ICANERA\_FEE' AND local_amount = 590
            AND business_profile_id = t.u(130) AND position('ICANera dropship fee (2%), paid by Reseller Business out of its markup' IN note) = 1));
  plat0 := t.bizbal(t.u(130)); res0 := t.bizbal(t.u(120)); store0 := t.bizbal(t.u(110)); rider0 := t.userbal(t.u(140));
  PERFORM t.release((d -> 'order' ->> 'id')::UUID);   -- the seal scan
  plat1 := t.bizbal(t.u(130)); res1 := t.bizbal(t.u(120)); store1 := t.bizbal(t.u(110)); rider1 := t.userbal(t.u(140));
  PERFORM t.check('3.10 when the order is released: ICANera 0.118, reseller 0.882, store 4.9, rider 1.2 - the whole 7.1',
    plat1 - plat0 = 0.118 AND res1 - res0 = 0.882 AND store1 - store0 = 4.9 AND rider1 - rider0 = 1.2
    AND (plat1 - plat0) + (res1 - res0) + (store1 - store0) + (rider1 - rider0) = 7.1);

  -- ── 4. where the fee stops ───────────────────────────────────────────────────────
  d := t.dropship(11, 10010);   -- markup of only UGX 20 on the order
  PERFORM t.check('4.1 thin markup: the fee is capped at the markup (UGX 20, not 2% of the sale), the reseller keeps nothing and is never out of pocket',
    (d ->> 'ok')::BOOLEAN AND (d -> 'order' ->> 'platform_fee_amount')::NUMERIC = 20 AND (d -> 'order' ->> 'reseller_margin_amount')::NUMERIC = 0
    AND t.legs_for(d -> 'legs', t.u(120)) = 0 AND t.legs_total(d -> 'legs', t.u(130)) = 0.004 AND t.legs_total(d -> 'legs') = (d ->> 'debit')::NUMERIC, d::TEXT);
  d := t.dropship(12, 10000);   -- sold at the store's own price: no markup at all
  PERFORM t.check('4.2 no markup, no fee: the reseller is not charged for a sale that earned them nothing',
    (d ->> 'ok')::BOOLEAN AND (d -> 'order' ->> 'platform_fee_amount')::NUMERIC = 0 AND t.legs_for(d -> 'legs', t.u(130)) = 0 AND t.legs_for(d -> 'legs', t.u(120)) = 0, d::TEXT);
  d := t.dropship(13, 12500, 2, TRUE, 100000);   -- free delivery: the reseller pays the whole fare out of the markup
  PERFORM t.check('4.3 free delivery that uses up the whole markup leaves nothing for a fee (and the customer still pays only 6.1 ICAN)',
    (d ->> 'ok')::BOOLEAN AND (d -> 'order' ->> 'platform_fee_amount')::NUMERIC = 0 AND (d ->> 'debit')::NUMERIC = 6.1 AND t.legs_for(d -> 'legs', t.u(130)) = 0, d::TEXT);
  d := t.dropship(14, 14000, 2, FALSE, 3000);   -- markup 8,000, the reseller covers 3,000 of the fare
  PERFORM t.check('4.4 a delivery subsidy is cut first, the fee comes out of what is left: 2% of 33,040 = 660.80, reseller keeps 4,339.20',
    (d ->> 'ok')::BOOLEAN AND (d -> 'order' ->> 'platform_fee_amount')::NUMERIC = 660.80 AND (d -> 'order' ->> 'reseller_margin_amount')::NUMERIC = 4339.20
    AND t.legs_total(d -> 'legs') = (d ->> 'debit')::NUMERIC AND (d ->> 'debit')::NUMERIC = 7.208, d::TEXT);

  -- ── 5. a developer changes the rate ──────────────────────────────────────────────
  UPDATE public.ican_fee_rates SET rate = 0.025 WHERE key = 'dropship_sale';
  d := t.dropship(15, 12500);
  PERFORM t.check('5.1 2.5%: ICANera 737.50, reseller 4,262.50, customer still 7.1 ICAN',
    (d -> 'order' ->> 'platform_fee_amount')::NUMERIC = 737.50 AND (d -> 'order' ->> 'reseller_margin_amount')::NUMERIC = 4262.50 AND (d ->> 'debit')::NUMERIC = 7.1, d::TEXT);
  UPDATE public.ican_fee_rates SET rate = 0 WHERE key = 'dropship_sale';
  d := t.dropship(16, 12500);
  PERFORM t.check('5.2 0%: no fee leg at all, the sale is exactly the one from before the migration',
    (d ->> 'debit')::NUMERIC = 7.1 AND t.legs_for(d -> 'legs', t.u(130)) = 0 AND t.legs_total(d -> 'legs', t.u(120)) = 1.0
    AND (d -> 'order' ->> 'platform_fee_amount')::NUMERIC = 0 AND (d -> 'order' ->> 'platform_fee_rate')::NUMERIC = 0, d::TEXT);
  UPDATE public.ican_fee_rates SET rate = 0.02 WHERE key = 'dropship_sale';
  UPDATE public.ican_platform_fee_recipient SET business_profile_id = NULL;
  d := t.dropship(17, 12500);
  PERFORM t.check('5.3 no fee-recipient business configured: nothing is taken (a fee with nowhere to go is not charged)',
    (d ->> 'ok')::BOOLEAN AND t.legs_for(d -> 'legs', t.u(130)) = 0 AND t.legs_total(d -> 'legs', t.u(120)) = 1.0 AND (d -> 'order' ->> 'platform_fee_amount')::NUMERIC = 0, d::TEXT);
  UPDATE public.ican_platform_fee_recipient SET business_profile_id = t.u(130);

  -- ── 6. money checks ──────────────────────────────────────────────────────────────
  d := t.dropship(18, 12500, 2, FALSE, 0, 7.1);
  PERFORM t.check('6.1 a customer holding exactly the price (7.1 ICAN) can still buy - no fee is asked of them on top',
    (d ->> 'ok')::BOOLEAN AND (d -> 'res' ->> 'success')::BOOLEAN AND (SELECT ican_balance FROM public.ican_user_wallets WHERE user_id = t.u(1018)) = 0, d::TEXT);
  d := t.dropship(19, 12500, 2, FALSE, 0, 7.0);
  PERFORM t.check('6.2 a customer short of the price is refused, and nothing is left half-done',
    NOT (d ->> 'ok')::BOOLEAN AND (SELECT ican_balance FROM public.ican_user_wallets WHERE user_id = t.u(1019)) = 7.0
    AND NOT EXISTS (SELECT 1 FROM public.ican_coin_transactions WHERE sender_user_id = t.u(1019)), d::TEXT);

  -- ── 7. a Digital City Era store sale paid from an IcanEra wallet: 10,000 x 3 = 30,000 = 6 ICAN ──────
  s := t.store_sale(20);
  PERFORM t.check('7.1 the sale goes through and the receipt total is still UGX 30,000',
    (s ->> 'ok')::BOOLEAN AND (s -> 'res' ->> 'success')::BOOLEAN AND (s -> 'res' ->> 'total_ugx')::NUMERIC = 30000
    AND (s -> 'res' ->> 'total_ugx') = (SELECT v FROM t.keep WHERE k = 'b_store_total_ugx'), s::TEXT);
  PERFORM t.check('7.2 the customer pays the shelf price and not a coin more: 6 ICAN, no 8% surcharge', (s ->> 'debit')::NUMERIC = 6, s ->> 'debit');
  PERFORM t.check('7.3 the store receives 99% (5.94) and ICANera gets 1% (0.06) - paid by the store',
    (s ->> 'store_got')::NUMERIC = 5.94 AND (s ->> 'platform_got')::NUMERIC = 0.06, s::TEXT);
  PERFORM t.check('7.4 every coin lands somewhere: store + ICANera = what the customer paid', (s ->> 'store_got')::NUMERIC + (s ->> 'platform_got')::NUMERIC = (s ->> 'debit')::NUMERIC);
  PERFORM t.check('7.5 the fee is booked as a platform fee in the same ledger every other platform fee uses',
    EXISTS (SELECT 1 FROM public.platform_fee_log WHERE fee_type = 'supermarket_order_fee' AND reference LIKE 'checkout-platform-fee:SCO\_%' AND amount_ican = 0.06));
  PERFORM t.check('7.6 the history says what happened: the store''s credit notes the 1% fee, the fee row says the store paid it',
    EXISTS (SELECT 1 FROM public.ican_coin_transactions WHERE sender_user_id = t.u(1020) AND receiver_user_id = t.u(101)
            AND ican_amount = 5.94 AND local_amount = 29700 AND position('after the 1% ICANera store fee' IN note) > 0)
    AND EXISTS (SELECT 1 FROM public.ican_coin_transactions WHERE sender_user_id = t.u(1020) AND reference_id LIKE '%\_FEE'
                AND ican_amount = 0.06 AND local_amount = 300 AND position('ICANera 1% store fee, paid by the store and already inside your total' IN note) = 1));
  s := t.store_sale(21, 3, 6.0);
  PERFORM t.check('7.7 a customer holding exactly the shelf price (6 ICAN) can now pay', (s ->> 'ok')::BOOLEAN AND (s -> 'res' ->> 'success')::BOOLEAN AND (s ->> 'debit')::NUMERIC = 6, s::TEXT);
  s := t.store_sale(22, 3, 5.99);
  PERFORM t.check('7.8 a customer short of the shelf price is refused and keeps every coin',
    NOT (s ->> 'ok')::BOOLEAN AND (SELECT ican_balance FROM public.ican_user_wallets WHERE user_id = t.u(1022)) = 5.99, s::TEXT);
  INSERT INTO public.mbg_platform_settings VALUES ('commission.icanera_platform_fee_percentage', 20);
  s := t.store_sale(23);
  PERFORM t.check('7.9 the shop no longer follows the ride commission setting: with that at 20% the shop still takes 1%',
    (s ->> 'platform_got')::NUMERIC = 0.06 AND (s ->> 'debit')::NUMERIC = 6, s::TEXT);
  DELETE FROM public.mbg_platform_settings;
  UPDATE public.ican_fee_rates SET rate = 0.025 WHERE key = 'store_sale';
  s := t.store_sale(24);
  PERFORM t.check('7.10 a developer sets the store rate to 2.5%: the store gets 5.85, ICANera 0.15, the customer still 6',
    (s ->> 'store_got')::NUMERIC = 5.85 AND (s ->> 'platform_got')::NUMERIC = 0.15 AND (s ->> 'debit')::NUMERIC = 6, s::TEXT);
  UPDATE public.ican_fee_rates SET rate = 0 WHERE key = 'store_sale';
  s := t.store_sale(25);
  PERFORM t.check('7.11 0%: the store gets everything and there is no fee row',
    (s ->> 'store_got')::NUMERIC = 6 AND (s ->> 'platform_got')::NUMERIC = 0 AND (s ->> 'debit')::NUMERIC = 6
    AND NOT EXISTS (SELECT 1 FROM public.ican_coin_transactions WHERE sender_user_id = t.u(1025) AND reference_id LIKE '%\_FEE'), s::TEXT);
  UPDATE public.ican_fee_rates SET rate = 0.01 WHERE key = 'store_sale';
  s := t.store_sale(26, 3, 1000, FALSE);
  PERFORM t.check('7.12 a sale not paid from a wallet (cash at the till) moves no wallet money, as before',
    (s ->> 'ok')::BOOLEAN AND (s ->> 'debit')::NUMERIC = 0 AND (s ->> 'store_got')::NUMERIC = 0 AND (s ->> 'platform_got')::NUMERIC = 0, s::TEXT);

  -- ── 8. what the migration did not touch ──────────────────────────────────────────
  PERFORM t.check('8.1 both checkouts keep SECURITY DEFINER and dropship_checkout its fixed search_path',
    (SELECT bool_and(prosecdef) FROM pg_proc WHERE proname IN ('dropship_checkout', 'customer_self_checkout'))
    AND (SELECT proconfig::TEXT FROM pg_proc WHERE proname = 'dropship_checkout') LIKE '%search_path=public%');
  PERFORM t.check('8.2 who may call them did not change: customers still cannot call dropship_checkout directly, still can call the shop checkout',
    NOT has_function_privilege('authenticated', 'public.dropship_checkout(uuid,jsonb,text,text,text,text,numeric,numeric,numeric,uuid,text[])', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.customer_self_checkout(jsonb,text,boolean,text)', 'EXECUTE'));
  PERFORM t.check('8.3 the fee maths helper is not callable from the API; reading a rate still is',
    NOT has_function_privilege('anon', 'public.ican_sale_fee(text,numeric,numeric,integer)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.ican_sale_fee(text,numeric,numeric,integer)', 'EXECUTE')
    AND has_function_privilege('anon', 'public.ican_fee_rate(text)', 'EXECUTE'));
  PERFORM t.check('8.4 no leftover of the old 8% surcharge in the shop checkout, and no second copy of either function',
    position('commission.icanera_platform_fee_percentage' IN pg_get_functiondef('public.customer_self_checkout(jsonb,text,boolean,text)'::regprocedure)) = 0
    AND (SELECT count(*) FROM pg_proc WHERE proname = 'dropship_checkout') = 1 AND (SELECT count(*) FROM pg_proc WHERE proname = 'customer_self_checkout') = 1);
END $t$;

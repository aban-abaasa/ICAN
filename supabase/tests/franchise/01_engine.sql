\set ON_ERROR_STOP on
-- Franchise engine: split math, rounding, idempotency, licences, kicker/penalty/floor, tiers, referral windows,
-- reversals and clawbacks, statements, termination, immutability, RLS, grants, error swallowing.
-- Every scenario goes through the REAL fn_credit_platform_fee_to_business / fn_reverse_platform_fee_to_business
-- so the trigger is exercised exactly as production will.

TRUNCATE t.results;
CREATE OR REPLACE FUNCTION t.u(n INT) RETURNS UUID LANGUAGE sql IMMUTABLE AS $$ SELECT ('00000000-0000-0000-0000-' || lpad(n::TEXT, 12, '0'))::UUID $$;
CREATE OR REPLACE FUNCTION t.b(n INT) RETURNS UUID LANGUAGE sql IMMUTABLE AS $$ SELECT ('bbbbbbbb-0000-0000-0000-' || lpad(n::TEXT, 12, '0'))::UUID $$;
CREATE OR REPLACE FUNCTION t.apply(p_type TEXT, p_country TEXT, p_n INT, p_name TEXT DEFAULT NULL, p_products TEXT[] DEFAULT ARRAY['icanera']) RETURNS JSONB LANGUAGE sql AS
  $$ SELECT public.ican_franchise_apply(p_type, p_country, COALESCE(p_name, 'Company ' || p_n || ' Ltd'), 'REG-' || lpad(p_n::TEXT, 6, '0'),
        p_country, NULL, NULL, NULL, p_products) $$;
CREATE OR REPLACE FUNCTION t.pid(p_owner INT) RETURNS UUID LANGUAGE sql AS
  $$ SELECT id FROM public.ican_franchise_partners WHERE owner_user_id = t.u(p_owner) AND status <> 'terminated' ORDER BY created_at DESC LIMIT 1 $$;
CREATE OR REPLACE FUNCTION t.fee(p_app TEXT, p_ref TEXT, p_type TEXT, p_actor INT, p_amt NUMERIC, p_meta JSONB DEFAULT '{}') RETURNS JSONB LANGUAGE sql AS
  $$ SELECT public.fn_credit_platform_fee_to_business(p_amt, p_app, p_ref, p_type, t.u(p_actor), 'test', p_meta) $$;
CREATE OR REPLACE FUNCTION t.hqbal() RETURNS NUMERIC LANGUAGE sql AS
  $$ SELECT ican_balance FROM public.ican_business_wallets WHERE business_profile_id = '00000000-0000-0000-0000-0000000000b1' $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA t TO PUBLIC;

-- ---------------------------------------------------------------- fixtures
INSERT INTO auth.users (id, email) SELECT t.u(n), 'u' || n || '@test.dev' FROM unnest(ARRAY[900,1,2,3,4,5,6,11,12,13,14,20,30,31]) n;
INSERT INTO public.mbg_users (id, email, role_type) VALUES
  (t.u(900), 'dev@test.dev', 'developer'), (t.u(30), 'rider@test.dev', 'rider'), (t.u(31), 'shopper@test.dev', 'customer');
INSERT INTO public.mbg_user_profiles (user_id, country) VALUES (t.u(30), 'Uganda'), (t.u(31), 'Uganda');
INSERT INTO public.business_profiles (id, user_id, business_name, country) VALUES
  (t.b(11), t.u(11), 'Kampala Mart',  'UG'), (t.b(12), t.u(12), 'Entebbe Foods', 'UG'),
  (t.b(13), t.u(13), 'Nairobi Shop',  'KE'), (t.b(14), t.u(14), 'Jinja Traders', 'UG');

-- ================================================================ 1. Baseline: no partners => HQ keeps everything, behaviour unchanged
DO $t$
DECLARE r JSONB; v_before NUMERIC;
BEGIN
  v_before := COALESCE(t.hqbal(), 0);
  r := t.fee('ican', 'base-1', 'corporate_subscription', 11, 100);
  PERFORM t.check('1.1 fee credited to HQ wallet as before', (r->>'credited')::BOOLEAN AND t.hqbal() = v_before + 100, r::TEXT);
  PERFORM t.check('1.2 no partner => no revenue event', (SELECT COUNT(*) FROM public.ican_franchise_revenue_events) = 0);
  PERFORM t.check('1.3 demand signal recorded for the uncovered country',
    (SELECT gross_ican FROM public.ican_franchise_demand_signals WHERE country_code = 'UG' AND stream = 'subscription') = 100);
END $t$;

-- ================================================================ 2. Partner lifecycle, hierarchy, exclusivity, role gating
DO $t$
DECLARE r JSONB; e TEXT; v_master UUID; v_agency UUID;
BEGIN
  PERFORM t.as_user(t.u(1));
  r := public.ican_franchise_apply('country_master', 'UG', 'Kampala Master Ltd', 'REG-000001', 'UG', NULL, 'Kampala Master', 'Kampala', ARRAY['icanera'], NULL, 'test');
  PERFORM t.check('2.1 apply creates an application with a code', r->>'status' = 'applied' AND r->>'partner_code' ~ '^UG-MS-[A-Z0-9]{5}$', r::TEXT);
  e := t.err($$SELECT public.ican_franchise_apply('country_master','UG','Again Ltd','REG-999999')$$);
  PERFORM t.check('2.2 duplicate seat refused', e LIKE '%already have%', e);
  e := t.err($$SELECT public.ican_franchise_apply('agency','XX','Nowhere Ltd','REG-888888')$$);
  PERFORM t.check('2.3 unknown country refused', e LIKE '%not open%', e);
  e := t.err($$SELECT public.ican_franchise_admin_set_status(NULL,'active')$$);
  PERFORM t.check('2.4 non-admin cannot run admin RPCs', e LIKE '%restricted%', e);
  PERFORM t.as_user(t.u(2));
  r := public.ican_franchise_apply('agency', 'UG', 'Kampala Digital Agency Ltd', 'REG-000002', 'UG', NULL, 'Kampala Digital Agency', 'Kampala', ARRAY['icanera'], NULL, NULL);
  PERFORM t.check('2.5 agency applies', r->>'partner_code' ~ '^UG-AG-', r::TEXT);
  PERFORM t.reset();

  v_master := t.pid(1); v_agency := t.pid(2);
  PERFORM t.as_user(t.u(900));
  e := t.err(format($$SELECT public.ican_franchise_admin_set_status(%L,'active')$$, v_master));
  PERFORM t.check('2.6 cannot go active before KYC is verified', e LIKE '%KYC%', e);
  PERFORM public.ican_franchise_admin_save_partner(v_master, '{"kyc_status":"verified"}');
  e := t.err(format($$SELECT public.ican_franchise_admin_set_status(%L,'active')$$, v_master));
  PERFORM t.check('2.6b KYC alone is not enough: the company registration must be verified too', e LIKE '%company registration must be verified%', e);
  PERFORM t.check('2.6c a pending company shows up in the verification queue',
    (public.ican_franchise_admin_overview() ->> 'companies_to_verify')::INT >= 2);
  PERFORM public.ican_franchise_admin_save_partner(v_master,
    '{"kyc_status":"verified","company_status":"verified","exclusive":true,"min_annual_royalty_ican":1000,"products":["icanera","supermarketera","bodagoera"]}');
  PERFORM public.ican_franchise_admin_set_status(v_master, 'active');
  PERFORM public.ican_franchise_admin_save_partner(v_agency, jsonb_build_object('kyc_status','verified','company_status','verified','parent_partner_id', v_master));
  PERFORM public.ican_franchise_admin_set_status(v_agency, 'active');
  PERFORM t.reset();
  PERFORM t.check('2.7 master and agency active, agency under master',
    (SELECT status FROM public.ican_franchise_partners WHERE id = v_master) = 'active'
    AND (SELECT parent_partner_id FROM public.ican_franchise_partners WHERE id = v_agency) = v_master);

  -- a second master cannot share an exclusive territory
  PERFORM t.as_user(t.u(3));
  PERFORM t.apply('country_master', 'UG', 3, 'Rival Master Ltd');
  PERFORM t.reset();
  PERFORM t.as_user(t.u(900));
  PERFORM public.ican_franchise_admin_save_partner(t.pid(3), '{"kyc_status":"verified","company_status":"verified"}');
  e := t.err(format($$SELECT public.ican_franchise_admin_set_status(%L,'approved')$$, t.pid(3)));
  PERFORM t.check('2.8 exclusive territory blocks a second master', e LIKE '%already has an approved country master%' OR e LIKE '%exclusive%', e);
  PERFORM t.reset();
  e := t.err(format($$UPDATE public.ican_franchise_partners SET parent_partner_id = %L WHERE id = %L$$, v_agency, v_master));
  PERFORM t.check('2.9 a master cannot have a parent', e LIKE '%cannot have a parent%', e);
  e := t.err(format($$UPDATE public.ican_franchise_partners SET parent_partner_id = %L WHERE id = %L$$, v_agency, v_agency));
  PERFORM t.check('2.10 an agency can only sit under a country master', e LIKE '%can only sit under a country master%', e);
END $t$;

-- ================================================================ 3. Customer claims, consent and release
DO $t$
DECLARE r JSONB; e TEXT; v_code TEXT := (SELECT partner_code FROM public.ican_franchise_partners WHERE id = t.pid(2));
BEGIN
  PERFORM t.as_user(t.u(20));  -- outsider who does not own business 11
  e := t.err(format($$SELECT public.ican_franchise_claim_agency(%L, %L)$$, v_code, t.b(11)));
  PERFORM t.check('3.1 only the business owner can claim', e LIKE '%does not belong to you%', e);
  PERFORM t.as_user(t.u(13));
  e := t.err(format($$SELECT public.ican_franchise_claim_agency(%L, %L)$$, v_code, t.b(13)));
  PERFORM t.check('3.2 cross-country claim refused (KE business, UG agency)', e LIKE '%serves UG%', e);
  PERFORM t.as_user(t.u(11));
  e := t.err(format($$SELECT public.ican_franchise_claim_agency(%L, %L)$$, 'UG-AG-NOPE0', t.b(11)));
  PERFORM t.check('3.3 unknown code refused', e LIKE '%No active agency%', e);
  r := public.ican_franchise_claim_agency(v_code, t.b(11));
  PERFORM t.check('3.4 owner claims their agency', r->>'agency' = 'Kampala Digital Agency', r::TEXT);
  e := t.err(format($$SELECT public.ican_franchise_claim_agency(%L, %L)$$, v_code, t.b(11)));
  PERFORM t.check('3.5 a second claim is refused until released', e LIKE '%already has an agency%', e);
  PERFORM t.check('3.6 my_agency shows the agency', public.ican_franchise_my_agency(t.b(11)) ->> 'partner_code' = v_code);
  PERFORM t.check('3.7 release works', public.ican_franchise_release_agency(t.b(11)) = TRUE);
  PERFORM t.check('3.8 release is a no-op the second time', public.ican_franchise_release_agency(t.b(11)) = FALSE);
  PERFORM public.ican_franchise_claim_agency(v_code, t.b(11));
  PERFORM t.as_user(t.u(12));
  PERFORM public.ican_franchise_claim_agency(v_code, t.b(12));
  PERFORM t.as_user(t.u(14));
  PERFORM public.ican_franchise_claim_agency(v_code, t.b(14));
  PERFORM t.reset();
  PERFORM t.check('3.9 three UG customers assigned to the agency',
    (SELECT COUNT(*) FROM public.ican_franchise_customer_assignments WHERE partner_id = t.pid(2) AND status = 'active') = 3);
END $t$;

-- ================================================================ 4. Split math, idempotency, wallet-fee safeguard
DO $t$
DECLARE r JSONB; ev public.ican_franchise_revenue_events; v_hq0 NUMERIC; n_events INT;
BEGIN
  v_hq0 := t.hqbal();
  r := t.fee('ican', 'sub-1', 'corporate_subscription', 11, 100);
  SELECT * INTO ev FROM public.ican_franchise_revenue_events WHERE source_reference = 'sub-1';
  PERFORM t.check('4.1 with_master / silver => 40/20/40',
    ev.structure = 'with_master' AND ev.agency_tier = 'silver' AND ev.hq_ican = 40 AND ev.master_ican = 20 AND ev.agency_ican = 40
    AND ev.stream = 'subscription' AND ev.product = 'icanera' AND ev.country_code = 'UG', to_jsonb(ev)::TEXT);
  PERFORM t.check('4.2 two payable lines, to the right partners',
    (SELECT amount_ican FROM public.ican_franchise_payable_lines WHERE event_id = ev.id AND role = 'agency' AND partner_id = t.pid(2)) = 40
    AND (SELECT amount_ican FROM public.ican_franchise_payable_lines WHERE event_id = ev.id AND role = 'master' AND partner_id = t.pid(1)) = 20);
  PERFORM t.check('4.3 HQ wallet still receives the FULL fee (shares are liabilities, not transfers)', t.hqbal() = v_hq0 + 100);

  SELECT COUNT(*) INTO n_events FROM public.ican_franchise_revenue_events;
  PERFORM t.fee('ican', 'sub-1', 'corporate_subscription', 11, 100);  -- same reference again
  PERFORM t.check('4.4 replayed fee reference creates nothing', (SELECT COUNT(*) FROM public.ican_franchise_revenue_events) = n_events AND t.hqbal() = v_hq0 + 100);
  PERFORM t.check('4.5 direct re-allocation is idempotent',
    public.ican_franchise_allocate('ican', 'sub-1', 100, 'corporate_subscription', t.u(11)) ->> 'reason' = 'already_allocated');

  r := t.fee('ican', 'sell-1', 'sell_fee', 11, 50);
  PERFORM t.check('4.6 wallet/sell fees are never shared by default',
    (r->>'credited')::BOOLEAN AND NOT EXISTS (SELECT 1 FROM public.ican_franchise_revenue_events WHERE source_reference = 'sell-1'));
  PERFORM t.check('4.7 engine reports why',
    public.ican_franchise_allocate('ican', 'sell-probe', 50, 'payout_fee', t.u(11)) ->> 'reason' = 'wallet_fees_not_shared');

  -- rounding: shares round to 8dp and HQ takes the remainder so the event always adds up
  PERFORM t.fee('ican', 'round-1', 'corporate_subscription', 11, 0.33333333);
  SELECT * INTO ev FROM public.ican_franchise_revenue_events WHERE source_reference = 'round-1';
  PERFORM t.check('4.8 rounding: parts sum exactly to the fee',
    ev.hq_ican + ev.master_ican + ev.agency_ican = 0.33333333 AND ev.agency_ican = 0.13333333 AND ev.master_ican = 0.06666667, to_jsonb(ev)::TEXT);
  PERFORM t.check('4.9 tiny fee that rounds a share to zero creates no zero line',
    public.ican_franchise_allocate('ican', 'tiny-1', 0.00000001, 'corporate_subscription', t.u(11)) ->> 'allocated' = 'true'
    AND NOT EXISTS (SELECT 1 FROM public.ican_franchise_payable_lines l JOIN public.ican_franchise_revenue_events e ON e.id = l.event_id
                     WHERE e.source_reference = 'tiny-1' AND l.amount_ican = 0));
END $t$;

-- ================================================================ 5. Licence scope: BodaGoEra rides and SupermarketEra orders
DO $t$
DECLARE ev public.ican_franchise_revenue_events;
BEGIN
  -- BodaGoEra: the rider's country is the NAME 'Uganda' in mbg_user_profiles; master is licensed for bodagoera.
  PERFORM t.fee('mybodaguy', 'ride-1', 'icanera_platform_fee', 30, 20);
  SELECT * INTO ev FROM public.ican_franchise_revenue_events WHERE source_reference = 'ride-1';
  PERFORM t.check('5.1 ride fee: country resolved from a country NAME, operator gets 70%',
    ev.stream = 'ride_commission' AND ev.product = 'bodagoera' AND ev.country_code = 'UG'
    AND ev.structure = 'master_direct' AND ev.master_ican = 14 AND ev.hq_ican = 6 AND ev.agency_partner_id IS NULL, to_jsonb(ev)::TEXT);

  -- SupermarketEra: customer 11 is served by an agency that is NOT licensed for supermarketera, so the master serves directly.
  PERFORM t.fee('digital-city-era', 'sm-1', 'supermarket_order_fee', 11, 10);
  SELECT * INTO ev FROM public.ican_franchise_revenue_events WHERE source_reference = 'sm-1';
  PERFORM t.check('5.2 unlicensed agency is skipped; master serves directly 30/70',
    ev.stream = 'marketplace_fee' AND ev.product = 'supermarketera' AND ev.structure = 'master_direct' AND ev.master_ican = 7 AND ev.hq_ican = 3, to_jsonb(ev)::TEXT);

  -- Take bodagoera away from the master: the next ride earns nothing for partners.
  UPDATE public.ican_franchise_partners SET products = ARRAY['icanera','supermarketera'] WHERE id = t.pid(1);
  PERFORM t.fee('mybodaguy', 'ride-2', 'icanera_platform_fee', 30, 20);
  PERFORM t.check('5.3 master without the bodagoera licence earns no ride share',
    NOT EXISTS (SELECT 1 FROM public.ican_franchise_revenue_events WHERE source_reference = 'ride-2'));
  UPDATE public.ican_franchise_partners SET products = ARRAY['icanera','supermarketera','bodagoera'] WHERE id = t.pid(1);

  -- Ride fee from a user who is assigned to an agency: agencies earn nothing on rides (no rule) => falls through to the operator.
  INSERT INTO public.ican_franchise_customer_assignments (user_id, partner_id, country_code, source)
    VALUES (t.u(31), t.pid(2), 'UG', 'import');
  PERFORM t.fee('mybodaguy', 'ride-3', 'icanera_platform_fee', 31, 10);
  SELECT * INTO ev FROM public.ican_franchise_revenue_events WHERE source_reference = 'ride-3';
  PERFORM t.check('5.4 agency has no ride rule => operator takes the 70% instead',
    ev.structure = 'master_direct' AND ev.agency_partner_id IS NULL AND ev.master_ican = 7, to_jsonb(ev)::TEXT);
END $t$;

-- ================================================================ 6. Quality kicker, penalty and the HQ floor
DO $t$
DECLARE ev public.ican_franchise_revenue_events; v_agency UUID := t.pid(2);
BEGIN
  UPDATE public.ican_franchise_partners SET share_adjust_pts = 3 WHERE id = v_agency;
  PERFORM t.fee('ican', 'adj-1', 'corporate_subscription', 11, 100);
  SELECT * INTO ev FROM public.ican_franchise_revenue_events WHERE source_reference = 'adj-1';
  PERFORM t.check('6.1 +3 kicker: agency 43, HQ 37, master untouched', ev.agency_ican = 43 AND ev.hq_ican = 37 AND ev.master_ican = 20, to_jsonb(ev)::TEXT);

  UPDATE public.ican_franchise_partners SET share_adjust_pts = 10 WHERE id = v_agency;
  PERFORM t.fee('ican', 'adj-2', 'corporate_subscription', 11, 100);
  PERFORM t.check('6.2 kicker is clamped to max_kicker_pts (3)', (SELECT agency_ican FROM public.ican_franchise_revenue_events WHERE source_reference = 'adj-2') = 43);

  UPDATE public.ican_franchise_partners SET share_adjust_pts = -10 WHERE id = v_agency;
  PERFORM t.fee('ican', 'adj-3', 'corporate_subscription', 11, 100);
  SELECT * INTO ev FROM public.ican_franchise_revenue_events WHERE source_reference = 'adj-3';
  PERFORM t.check('6.3 penalty clamped to -5: agency 35, HQ 45', ev.agency_ican = 35 AND ev.hq_ican = 45, to_jsonb(ev)::TEXT);

  UPDATE public.ican_franchise_settings SET hq_share_floor_pct = 39 WHERE id;
  UPDATE public.ican_franchise_partners SET share_adjust_pts = 3 WHERE id = v_agency;
  PERFORM t.fee('ican', 'adj-4', 'corporate_subscription', 11, 100);
  SELECT * INTO ev FROM public.ican_franchise_revenue_events WHERE source_reference = 'adj-4';
  PERFORM t.check('6.4 HQ floor 39% limits the kicker to 1 point: agency 41, HQ 39', ev.agency_ican = 41 AND ev.hq_ican = 39, to_jsonb(ev)::TEXT);

  UPDATE public.ican_franchise_settings SET hq_share_floor_pct = 37 WHERE id;
  UPDATE public.ican_franchise_partners SET share_adjust_pts = 0 WHERE id = v_agency;
END $t$;

-- ================================================================ 7. Tiers follow active accounts
DO $t$
DECLARE r JSONB; ev public.ican_franchise_revenue_events;
BEGIN
  PERFORM t.as_user(t.u(900));
  PERFORM public.ican_franchise_admin_save_settings('{"gold_min_accounts":3,"platinum_min_accounts":5}');
  PERFORM t.reset();
  PERFORM t.check('7.1 agency is silver with 1 active account', public.ican_franchise_active_accounts(t.pid(2)) = 1);
  PERFORM t.fee('ican', 'tier-2', 'corporate_subscription', 12, 100);
  PERFORM t.fee('ican', 'tier-3', 'corporate_subscription', 14, 100);
  PERFORM t.check('7.2 three distinct paying accounts', public.ican_franchise_active_accounts(t.pid(2)) = 3);
  PERFORM t.as_user(t.u(900));
  r := public.ican_franchise_refresh_tiers();
  PERFORM t.reset();
  PERFORM t.check('7.3 refresh promotes the agency to gold', (SELECT tier FROM public.ican_franchise_partners WHERE id = t.pid(2)) = 'gold' AND (r->>'changed')::INT = 1, r::TEXT);
  PERFORM t.fee('ican', 'tier-4', 'corporate_subscription', 11, 100);
  SELECT * INTO ev FROM public.ican_franchise_revenue_events WHERE source_reference = 'tier-4';
  PERFORM t.check('7.4 gold earns 40/15/45', ev.agency_tier = 'gold' AND ev.hq_ican = 40 AND ev.master_ican = 15 AND ev.agency_ican = 45, to_jsonb(ev)::TEXT);
  -- a revenue event older than the window stops counting
  ALTER TABLE public.ican_franchise_revenue_events DISABLE TRIGGER trg_ican_franchise_events_immutable;  -- test-only: age the event
  UPDATE public.ican_franchise_revenue_events SET created_at = now() - INTERVAL '90 days'
   WHERE customer_business_id = t.b(14);
  ALTER TABLE public.ican_franchise_revenue_events ENABLE TRIGGER trg_ican_franchise_events_immutable;
  PERFORM t.check('7.5 an account that stopped paying drops out of the active count', public.ican_franchise_active_accounts(t.pid(2)) = 2);
  PERFORM t.as_user(t.u(900));
  PERFORM public.ican_franchise_refresh_tiers();
  PERFORM t.reset();
  PERFORM t.check('7.6 and the tier follows it back down', (SELECT tier FROM public.ican_franchise_partners WHERE id = t.pid(2)) = 'silver');
  ALTER TABLE public.ican_franchise_revenue_events DISABLE TRIGGER trg_ican_franchise_events_immutable;
  UPDATE public.ican_franchise_revenue_events SET created_at = now() WHERE customer_business_id = t.b(14);
  ALTER TABLE public.ican_franchise_revenue_events ENABLE TRIGGER trg_ican_franchise_events_immutable;
END $t$;

-- ================================================================ 8. Referral partners and the HQ-direct structure
DO $t$
DECLARE ev public.ican_franchise_revenue_events;
BEGIN
  PERFORM t.as_user(t.u(4));
  PERFORM t.apply('referral', 'UG', 4, 'Campus Connector Ltd');
  PERFORM t.as_user(t.u(5));
  PERFORM t.apply('agency', 'UG', 5, 'Independent Agency Ltd');
  PERFORM t.as_user(t.u(900));
  PERFORM public.ican_franchise_admin_save_partner(t.pid(4), '{"kyc_status":"verified","company_status":"verified"}');
  PERFORM public.ican_franchise_admin_set_status(t.pid(4), 'active');
  PERFORM public.ican_franchise_admin_save_partner(t.pid(5), '{"kyc_status":"verified","company_status":"verified"}');
  PERFORM public.ican_franchise_admin_set_status(t.pid(5), 'active');
  -- hand business 12 to the referral partner and business 14 to the master-less agency
  PERFORM public.ican_franchise_admin_assign_customer(t.b(12), t.pid(4));
  PERFORM public.ican_franchise_admin_assign_customer(t.b(14), t.pid(5));
  PERFORM t.reset();

  PERFORM t.fee('ican', 'ref-1', 'corporate_subscription', 12, 100);
  SELECT * INTO ev FROM public.ican_franchise_revenue_events WHERE source_reference = 'ref-1';
  PERFORM t.check('8.1 referral partner: 80/0/20', ev.structure = 'referral' AND ev.hq_ican = 80 AND ev.master_ican = 0 AND ev.agency_ican = 20 AND ev.master_partner_id IS NULL, to_jsonb(ev)::TEXT);

  PERFORM t.fee('ican', 'hqd-1', 'corporate_subscription', 14, 100);
  SELECT * INTO ev FROM public.ican_franchise_revenue_events WHERE source_reference = 'hqd-1';
  PERFORM t.check('8.2 agency with no master: hq_direct 60/0/40', ev.structure = 'hq_direct' AND ev.hq_ican = 60 AND ev.master_ican = 0 AND ev.agency_ican = 40, to_jsonb(ev)::TEXT);

  -- referral window lapses => the master serves directly (40/60)
  UPDATE public.ican_franchise_customer_assignments SET assigned_at = now() - INTERVAL '13 months' WHERE business_profile_id = t.b(12) AND status = 'active';
  PERFORM t.fee('ican', 'ref-2', 'corporate_subscription', 12, 100);
  SELECT * INTO ev FROM public.ican_franchise_revenue_events WHERE source_reference = 'ref-2';
  PERFORM t.check('8.3 expired referral window falls back to the master directly (40/60)', ev.structure = 'master_direct' AND ev.hq_ican = 40 AND ev.master_ican = 60, to_jsonb(ev)::TEXT);
END $t$;

-- ================================================================ 9. Territory pause, program switch, rule changes, wallet-fee opt-in
DO $t$
DECLARE r JSONB;
BEGIN
  PERFORM t.as_user(t.u(900));
  PERFORM public.ican_franchise_admin_save_territory('UG', NULL, NULL, 'paused');
  PERFORM t.reset();
  PERFORM t.fee('ican', 'pause-1', 'corporate_subscription', 11, 100);
  PERFORM t.check('9.1 paused territory allocates nothing', NOT EXISTS (SELECT 1 FROM public.ican_franchise_revenue_events WHERE source_reference = 'pause-1'));
  PERFORM t.as_user(t.u(900));
  PERFORM public.ican_franchise_admin_save_territory('UG', NULL, NULL, 'active');
  PERFORM public.ican_franchise_admin_save_settings('{"enabled": false}');
  PERFORM t.reset();
  PERFORM t.fee('ican', 'off-1', 'corporate_subscription', 11, 100);
  PERFORM t.check('9.2 program switch off allocates nothing, fee still credited',
    NOT EXISTS (SELECT 1 FROM public.ican_franchise_revenue_events WHERE source_reference = 'off-1')
    AND EXISTS (SELECT 1 FROM public.ican_business_wallet_settlements WHERE source_reference = 'off-1'));
  PERFORM t.as_user(t.u(900));
  PERFORM public.ican_franchise_admin_save_settings('{"enabled": true}');
  r := public.ican_franchise_admin_backfill(now() - INTERVAL '1 day');
  PERFORM t.reset();
  PERFORM t.check('9.3 backfill allocates fees made while paused/off, exactly once',
    EXISTS (SELECT 1 FROM public.ican_franchise_revenue_events WHERE source_reference = 'pause-1')
    AND EXISTS (SELECT 1 FROM public.ican_franchise_revenue_events WHERE source_reference = 'off-1')
    AND (r->>'allocated')::INT >= 2, r::TEXT);
  PERFORM t.as_user(t.u(900));
  PERFORM t.check('9.4 backfill is idempotent', (public.ican_franchise_admin_backfill(now() - INTERVAL '1 day') ->> 'allocated')::INT = 0);
  PERFORM t.reset();

  -- rules: must sum to 100; edits take effect on the next fee
  PERFORM t.as_user(t.u(900));
  PERFORM t.check('9.5 a rule that does not add to 100 is refused',
    t.err($$SELECT public.ican_franchise_admin_save_rule('subscription','master_direct','any',40,50,0)$$) LIKE '%add up to exactly 100%');
  PERFORM public.ican_franchise_admin_save_rule('subscription', 'referral', 'any', 70, 0, 30);
  PERFORM t.reset();
  UPDATE public.ican_franchise_customer_assignments SET assigned_at = now() WHERE business_profile_id = t.b(12) AND status = 'active';
  PERFORM t.fee('ican', 'rule-1', 'corporate_subscription', 12, 100);
  PERFORM t.check('9.6 edited rule applies to new fees (referral now 70/0/30)',
    (SELECT agency_ican FROM public.ican_franchise_revenue_events WHERE source_reference = 'rule-1') = 30);
  PERFORM t.as_user(t.u(900));
  PERFORM public.ican_franchise_admin_save_rule('subscription', 'referral', 'any', 80, 0, 20);
  -- wallet fees: a rule alone is not enough, HQ must opt in
  PERFORM public.ican_franchise_admin_save_rule('wallet_fee', 'master_direct', 'any', 50, 50, 0);
  PERFORM t.reset();
  PERFORM t.fee('ican', 'wf-1', 'sell_fee', 20, 10, jsonb_build_object('country_code', 'UG'));
  PERFORM t.check('9.7 a wallet_fee rule is ignored while share_wallet_fees is off',
    NOT EXISTS (SELECT 1 FROM public.ican_franchise_revenue_events WHERE source_reference = 'wf-1'));
  PERFORM t.as_user(t.u(900));
  PERFORM public.ican_franchise_admin_save_settings('{"share_wallet_fees": true}');
  PERFORM t.reset();
  PERFORM t.fee('ican', 'wf-2', 'sell_fee', 20, 10, jsonb_build_object('country_code', 'UG'));
  PERFORM t.check('9.8 with the opt-in on, the rule applies (master 50%)',
    (SELECT master_ican FROM public.ican_franchise_revenue_events WHERE source_reference = 'wf-2') = 5);
  PERFORM t.as_user(t.u(900));
  PERFORM public.ican_franchise_admin_save_settings('{"share_wallet_fees": false}');
  PERFORM public.ican_franchise_admin_save_rule('wallet_fee', 'master_direct', 'any', 100, 0, 0, FALSE);
  PERFORM t.reset();
END $t$;

-- ================================================================ 10. Reversals and clawbacks
DO $t$
DECLARE r JSONB; v_ev UUID; n_lines INT;
BEGIN
  PERFORM t.fee('ican', 'rev-1', 'corporate_subscription', 11, 100);
  v_ev := (SELECT id FROM public.ican_franchise_revenue_events WHERE source_reference = 'rev-1');
  r := public.fn_reverse_platform_fee_to_business('ican', 'rev-1', t.u(11), 'customer refunded');
  PERFORM t.check('10.1 reversal voids the event and its accrued lines',
    (SELECT voided_at FROM public.ican_franchise_revenue_events WHERE id = v_ev) IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.ican_franchise_payable_lines WHERE event_id = v_ev AND status <> 'void'), r::TEXT);
  r := public.fn_reverse_platform_fee_to_business('ican', 'rev-1', t.u(11), 'again');
  PERFORM t.check('10.2 reversing twice changes nothing', (SELECT COUNT(*) FROM public.ican_franchise_payable_lines WHERE event_id = v_ev) = 2);
  PERFORM t.check('10.3 voided events no longer count as active accounts or earnings',
    COALESCE((SELECT SUM(amount_ican) FROM public.ican_franchise_payable_lines WHERE event_id = v_ev AND status <> 'void'), 0) = 0);
END $t$;

-- ================================================================ 11. Statements: generate, approve, pay, void, carry-forward and clawback
DO $t$
DECLARE r JSONB; st RECORD; v_agency_acc NUMERIC; v_stmt UUID; e TEXT; n INT;
BEGIN
  PERFORM t.as_user(t.u(900));
  r := public.ican_franchise_admin_generate_statements(CURRENT_DATE - 1, CURRENT_DATE);
  PERFORM t.reset();
  PERFORM t.check('11.1 statements generated for every partner with accrued money', (r->>'statements')::INT >= 3, r::TEXT);
  PERFORM t.check('11.2 each statement total equals its lines',
    NOT EXISTS (SELECT 1 FROM public.ican_franchise_statements s
                 WHERE s.total_ican <> (SELECT SUM(amount_ican) FROM public.ican_franchise_payable_lines l WHERE l.statement_id = s.id)));
  PERFORM t.check('11.3 lines moved to statemented, none left accrued in the period',
    NOT EXISTS (SELECT 1 FROM public.ican_franchise_payable_lines WHERE status = 'accrued'));
  PERFORM t.as_user(t.u(900));
  PERFORM t.check('11.4 re-running creates no duplicate statement', (public.ican_franchise_admin_generate_statements(CURRENT_DATE - 1, CURRENT_DATE) ->> 'statements')::INT = 0);

  SELECT id INTO v_stmt FROM public.ican_franchise_statements WHERE partner_id = t.pid(2) AND status = 'draft';
  PERFORM t.check('11.5 paying a draft is refused', t.err(format($$SELECT public.ican_franchise_admin_mark_statement_paid(%L,'TXN-0001')$$, v_stmt)) LIKE '%approved%');
  PERFORM public.ican_franchise_admin_approve_statement(v_stmt);
  PERFORM t.check('11.6 approving twice is refused', t.err(format($$SELECT public.ican_franchise_admin_approve_statement(%L)$$, v_stmt)) LIKE '%draft%');
  PERFORM t.check('11.7 a payment needs a real reference', t.err(format($$SELECT public.ican_franchise_admin_mark_statement_paid(%L,'x')$$, v_stmt)) LIKE '%reference%');
  PERFORM public.ican_franchise_admin_mark_statement_paid(v_stmt, 'TXN-0001');
  PERFORM t.check('11.8 paid: statement paid and lines paid',
    (SELECT status FROM public.ican_franchise_statements WHERE id = v_stmt) = 'paid'
    AND NOT EXISTS (SELECT 1 FROM public.ican_franchise_payable_lines WHERE statement_id = v_stmt AND status <> 'paid'));
  PERFORM t.check('11.9 a paid statement cannot be voided', t.err(format($$SELECT public.ican_franchise_admin_void_statement(%L)$$, v_stmt)) LIKE '%cannot%');

  -- another statement: the same transfer reference cannot be reused
  SELECT id INTO v_stmt FROM public.ican_franchise_statements WHERE partner_id = t.pid(1) AND status = 'draft';
  PERFORM public.ican_franchise_admin_approve_statement(v_stmt);
  e := t.err(format($$SELECT public.ican_franchise_admin_mark_statement_paid(%L,'TXN-0001')$$, v_stmt));
  PERFORM t.check('11.10 a transfer reference is single-use', e LIKE '%duplicate key%' OR e LIKE '%uq_ican_franchise_statement_payref%', e);
  -- void an approved one: its lines return to accrued
  PERFORM public.ican_franchise_admin_void_statement(v_stmt);
  PERFORM t.check('11.11 voiding returns lines to accrued', EXISTS (SELECT 1 FROM public.ican_franchise_payable_lines WHERE partner_id = t.pid(1) AND status = 'accrued'));
  PERFORM t.reset();

  -- fee reversed AFTER its line was paid => a negative (clawback) line, never a silent loss
  PERFORM t.fee('ican', 'claw-1', 'corporate_subscription', 12, 100);   -- customer 12 now served by the (expired) referral => master 60
  PERFORM t.as_user(t.u(900));
  PERFORM public.ican_franchise_admin_generate_statements(CURRENT_DATE - 1, CURRENT_DATE);
  SELECT id INTO v_stmt FROM public.ican_franchise_statements WHERE partner_id = t.pid(1) AND status = 'draft' ORDER BY created_at DESC LIMIT 1;
  PERFORM public.ican_franchise_admin_approve_statement(v_stmt);
  PERFORM public.ican_franchise_admin_mark_statement_paid(v_stmt, 'TXN-0002');
  PERFORM t.reset();
  PERFORM public.fn_reverse_platform_fee_to_business('ican', 'claw-1', t.u(12), 'chargeback after payout');
  SELECT COUNT(*) INTO n FROM public.ican_franchise_payable_lines l JOIN public.ican_franchise_revenue_events e ON e.id = l.event_id
   WHERE e.source_reference = 'claw-1' AND l.amount_ican < 0 AND l.status = 'accrued' AND l.reverses_line_id IS NOT NULL;
  PERFORM t.check('11.12 reversal after payment writes a negative clawback line', n >= 1, n::TEXT);
  PERFORM public.fn_reverse_platform_fee_to_business('ican', 'claw-1', t.u(12), 'again');
  PERFORM t.check('11.13 and only once', (SELECT COUNT(*) FROM public.ican_franchise_payable_lines l JOIN public.ican_franchise_revenue_events e ON e.id = l.event_id
                                          WHERE e.source_reference = 'claw-1' AND l.amount_ican < 0) = n);
  PERFORM t.as_user(t.u(900));
  r := public.ican_franchise_admin_generate_statements(CURRENT_DATE - 1, CURRENT_DATE);
  PERFORM t.reset();
  PERFORM t.check('11.14 a net-negative balance is carried forward, not issued as a negative statement',
    NOT EXISTS (SELECT 1 FROM public.ican_franchise_statements WHERE total_ican <= 0));
END $t$;

-- ================================================================ 12. Termination: customers are never orphaned
DO $t$
DECLARE r JSONB; ev public.ican_franchise_revenue_events; v_old UUID := t.pid(2); v_new UUID;
BEGIN
  -- a second master-less agency to receive the customers
  PERFORM t.as_user(t.u(3));
  PERFORM t.apply('agency', 'UG', 33, 'Successor Agency Ltd');
  PERFORM t.as_user(t.u(900));
  PERFORM public.ican_franchise_admin_save_partner(t.pid(3), jsonb_build_object('kyc_status','verified','company_status','verified','parent_partner_id', t.pid(1)));
  PERFORM public.ican_franchise_admin_set_status(t.pid(3), 'active');
  v_new := t.pid(3);
  PERFORM t.check('12.1 terminating via set_status is refused (must reassign customers)',
    t.err(format($$SELECT public.ican_franchise_admin_set_status(%L,'terminated')$$, v_old)) LIKE '%terminate_partner%');
  PERFORM t.check('12.2 reassign target must be an active agency in the same country',
    t.err(format($$SELECT public.ican_franchise_admin_terminate_partner(%L,%L)$$, v_old, t.pid(1))) LIKE '%Reassign target%');
  r := public.ican_franchise_admin_terminate_partner(v_old, v_new, 'contract breach');
  PERFORM t.reset();
  PERFORM t.check('12.3 customers moved to the successor', (r->>'customers_moved')::INT >= 1 AND (r->>'terminated')::BOOLEAN, r::TEXT);
  PERFORM t.check('12.4 old assignments ended, new ones active and flagged reassigned',
    NOT EXISTS (SELECT 1 FROM public.ican_franchise_customer_assignments WHERE partner_id = v_old AND status = 'active')
    AND EXISTS (SELECT 1 FROM public.ican_franchise_customer_assignments WHERE partner_id = v_new AND status = 'active' AND source = 'reassigned'));
  PERFORM t.fee('ican', 'term-1', 'corporate_subscription', 11, 100);
  SELECT * INTO ev FROM public.ican_franchise_revenue_events WHERE source_reference = 'term-1';
  PERFORM t.check('12.5 next fee flows to the successor', ev.agency_partner_id = v_new AND ev.structure = 'with_master', to_jsonb(ev)::TEXT);
  PERFORM t.check('12.6 a terminated partner cannot be reinstated',
    t.err(format($$UPDATE public.ican_franchise_partners SET status = 'active' WHERE id = %L$$, v_old)) LIKE '%cannot be reinstated%');
  PERFORM t.check('12.7 the terminated partner keeps its history (events restrict deletion)',
    t.err(format($$DELETE FROM public.ican_franchise_partners WHERE id = %L$$, v_old)) LIKE '%violates foreign key%');

  -- terminate with no successor: customers fall back to the master directly
  PERFORM t.as_user(t.u(900));
  r := public.ican_franchise_admin_terminate_partner(v_new, NULL, 'exit');
  PERFORM t.reset();
  PERFORM t.fee('ican', 'term-2', 'corporate_subscription', 11, 100);
  SELECT * INTO ev FROM public.ican_franchise_revenue_events WHERE source_reference = 'term-2';
  PERFORM t.check('12.8 no successor => the country master serves directly (40/60)', ev.structure = 'master_direct' AND ev.master_ican = 60, to_jsonb(ev)::TEXT);
END $t$;

-- ================================================================ 13. Ledger immutability
DO $t$
DECLARE v_ev UUID := (SELECT id FROM public.ican_franchise_revenue_events WHERE source_reference = 'sub-1');
BEGIN
  PERFORM t.check('13.1 an event amount cannot be edited', t.err(format($$UPDATE public.ican_franchise_revenue_events SET gross_ican = 1 WHERE id = %L$$, v_ev)) LIKE '%append-only%');
  PERFORM t.check('13.2 an event cannot be deleted', t.err(format($$DELETE FROM public.ican_franchise_revenue_events WHERE id = %L$$, v_ev)) LIKE '%append-only%');
  PERFORM t.check('13.3 a line amount cannot be edited', t.err(format($$UPDATE public.ican_franchise_payable_lines SET amount_ican = 999 WHERE event_id = %L$$, v_ev)) LIKE '%immutable%');
  PERFORM t.check('13.4 a line cannot be deleted', t.err(format($$DELETE FROM public.ican_franchise_payable_lines WHERE event_id = %L$$, v_ev)) LIKE '%cannot be deleted%');
  PERFORM t.check('13.5 an event that does not add up is impossible',
    t.err($$INSERT INTO public.ican_franchise_revenue_events (source_app,source_reference,stream,product,structure,gross_ican,hq_pct,master_pct,agency_pct,hq_ican,master_ican,agency_ican)
            VALUES ('x','bad','subscription','icanera','master_direct',100,40,60,0,40,50,0)$$) LIKE '%ican_franchise_event_sums%');
END $t$;

-- ================================================================ 14. The trigger can never break a fee credit
DO $t$
DECLARE r JSONB; v_before NUMERIC := t.hqbal(); n INT;
BEGIN
  r := t.fee('ican', 'boom-1', 'corporate_subscription', 11, 100, '{"business_profile_id": "not-a-uuid"}');
  PERFORM t.check('14.1 a poisoned allocation does not stop the fee being credited', (r->>'credited')::BOOLEAN AND t.hqbal() = v_before + 100, r::TEXT);
  SELECT COUNT(*) INTO n FROM public.ican_franchise_allocation_errors WHERE source_reference = 'boom-1' AND NOT resolved;
  PERFORM t.check('14.2 the failure is parked for HQ in allocation_errors', n = 1, n::TEXT);
  PERFORM t.check('14.3 and no half-written event exists', NOT EXISTS (SELECT 1 FROM public.ican_franchise_revenue_events WHERE source_reference = 'boom-1'));
  PERFORM t.as_user(t.u(900));
  r := public.ican_franchise_admin_retry_errors();
  PERFORM t.reset();
  PERFORM t.check('14.4 retry reports the still-poisoned one honestly', (r->>'still_failing')::INT = 1, r::TEXT);
END $t$;

-- ================================================================ 15. Row-level security and grants
DO $t$
DECLARE n INT; e TEXT;
BEGIN
  -- anonymous visitors: nothing at all
  PERFORM t.as_anon();
  PERFORM t.check('15.1 anon cannot read partners', t.err($$SELECT * FROM public.ican_franchise_partners$$) LIKE '%permission denied%');
  PERFORM t.check('15.2 anon cannot call a partner RPC', t.err($$SELECT public.ican_franchise_my_summary()$$) LIKE '%permission denied%');
  PERFORM t.check('15.3 anon cannot call an admin RPC', t.err($$SELECT public.ican_franchise_admin_overview()$$) LIKE '%permission denied%');
  PERFORM t.check('15.4 anon cannot call the engine', t.err($$SELECT public.ican_franchise_allocate('a','b',1,'c',NULL)$$) LIKE '%permission denied%');

  -- a signed-in stranger: sees the open reference data and none of the money
  PERFORM t.as_user(t.u(20));
  PERFORM t.check('15.5 outsider sees the territory list and the rate card',
    (SELECT COUNT(*) FROM public.ican_franchise_territories) >= 8 AND (SELECT COUNT(*) FROM public.ican_franchise_split_rules) >= 13);
  PERFORM t.check('15.6 outsider sees no partners, events, lines or statements',
    (SELECT COUNT(*) FROM public.ican_franchise_partners) = 0 AND (SELECT COUNT(*) FROM public.ican_franchise_revenue_events) = 0
    AND (SELECT COUNT(*) FROM public.ican_franchise_payable_lines) = 0 AND (SELECT COUNT(*) FROM public.ican_franchise_statements) = 0);
  PERFORM t.check('15.7 nobody can read the singleton settings table directly', t.err($$SELECT * FROM public.ican_franchise_settings$$) LIKE '%permission denied%');
  PERFORM t.check('15.8 nobody can read the audit log, errors or demand',
    (SELECT COUNT(*) FROM public.ican_franchise_audit_log) = 0 AND (SELECT COUNT(*) FROM public.ican_franchise_allocation_errors) = 0
    AND (SELECT COUNT(*) FROM public.ican_franchise_demand_signals) = 0);
  PERFORM t.check('15.9 outsider cannot read another partner earnings',
    t.err(format($$SELECT * FROM public.ican_franchise_my_earnings(%L)$$, t.pid(1))) LIKE '%Not your partner account%');
  PERFORM t.check('15.10 outsider cannot list another partner customers',
    t.err(format($$SELECT * FROM public.ican_franchise_my_customers(%L)$$, t.pid(1))) LIKE '%Not your partner account%');

  -- the browser can never write to the money tables
  PERFORM t.as_user(t.u(1));
  PERFORM t.check('15.11 no direct INSERT into partners', t.err($$INSERT INTO public.ican_franchise_partners (partner_code,partner_type,country_code,display_name) VALUES ('X','agency','UG','Evil')$$) LIKE '%permission denied%');
  PERFORM t.check('15.12 no direct UPDATE of a line', t.err($$UPDATE public.ican_franchise_payable_lines SET status = 'paid'$$) LIKE '%permission denied%');
  PERFORM t.check('15.13 no direct UPDATE of the rate card', t.err($$UPDATE public.ican_franchise_split_rules SET hq_pct = 0, master_pct = 100$$) LIKE '%permission denied%');
  PERFORM t.check('15.14 no direct DELETE of events', t.err($$DELETE FROM public.ican_franchise_revenue_events$$) LIKE '%permission denied%');
  PERFORM t.check('15.15 the engine is not callable by a signed-in user', t.err($$SELECT public.ican_franchise_allocate('a','b',1,'c',NULL)$$) LIKE '%permission denied%');

  -- the master sees itself and its downline, but only its own money
  PERFORM t.check('15.16 master sees its own seat and its agencies (not strangers)',
    (SELECT COUNT(*) FROM public.ican_franchise_partners) >= 2
    AND NOT EXISTS (SELECT 1 FROM public.ican_franchise_partners WHERE id <> t.pid(1) AND COALESCE(parent_partner_id, '00000000-0000-0000-0000-000000000000') <> t.pid(1)));
  PERFORM t.check('15.17 master lines are only the master own',
    (SELECT COUNT(*) FROM public.ican_franchise_payable_lines) > 0 AND NOT EXISTS (SELECT 1 FROM public.ican_franchise_payable_lines WHERE partner_id <> t.pid(1)));

  -- an agency sees only itself
  PERFORM t.as_user(t.u(5));
  PERFORM t.check('15.18 an independent agency sees only its own seat',
    (SELECT COUNT(*) FROM public.ican_franchise_partners) = 1 AND (SELECT id FROM public.ican_franchise_partners) = t.pid(5));
  PERFORM t.check('15.19 and only its own lines', NOT EXISTS (SELECT 1 FROM public.ican_franchise_payable_lines WHERE partner_id <> t.pid(5)));

  -- a customer sees their own assignment, not the neighbour
  PERFORM t.as_user(t.u(12));
  PERFORM t.check('15.20 a customer sees only their own assignment rows', NOT EXISTS (SELECT 1 FROM public.ican_franchise_customer_assignments WHERE business_profile_id <> t.b(12)));

  -- the developer is the only HQ admin
  PERFORM t.as_user(t.u(900));
  PERFORM t.check('15.21 a developer sees every partner', (SELECT COUNT(*) FROM public.ican_franchise_partners) >= 5);
  PERFORM t.check('15.22 and the audit log is full of their actions', (SELECT COUNT(*) FROM public.ican_franchise_audit_log) > 10);
  PERFORM t.check('15.23 the overview works for a developer', public.ican_franchise_admin_overview() ? 'liability');
  PERFORM t.as_service();
  PERFORM t.check('15.24 the service role counts as HQ admin', public.ican_franchise_admin_overview() ? 'partners');
  PERFORM t.reset();
  PERFORM t.as_user(t.u(1));
  PERFORM t.check('15.25 an inactive/non-developer account is not HQ admin', NOT public.ican_franchise_is_hq_admin());
  PERFORM t.reset();
  UPDATE public.mbg_users SET is_active = false WHERE id = t.u(900);
  PERFORM t.as_user(t.u(900));
  PERFORM t.check('15.26 a deactivated developer loses admin', NOT public.ican_franchise_is_hq_admin());
  PERFORM t.reset();
  UPDATE public.mbg_users SET is_active = true WHERE id = t.u(900);
END $t$;

-- ================================================================ 16. Partner-facing numbers
DO $t$
DECLARE s JSONB; m JSONB; c INT;
BEGIN
  PERFORM t.as_user(t.u(5));
  s := public.ican_franchise_my_summary() -> 0;
  PERFORM t.check('16.1 agency summary carries code, tier, balances and tier progress',
    s->>'partner_type' = 'agency' AND s ? 'accrued_ican' AND (s->>'earned_12m_ican')::NUMERIC > 0 AND s ? 'accounts_to_next_tier' AND s->>'next_tier' = 'gold', s::TEXT);
  SELECT COUNT(*) INTO c FROM public.ican_franchise_my_customers(t.pid(5));
  PERFORM t.check('16.2 agency lists its customer', c = 1, c::TEXT);
  PERFORM t.check('16.3 earnings series returns months and streams',
    (SELECT COUNT(*) FROM public.ican_franchise_my_earnings(t.pid(5), 6)) >= 1);

  PERFORM t.reset();
  PERFORM t.as_user(t.u(6));
  PERFORM t.apply('agency', 'UG', 6, 'Downline Agency Ltd');
  PERFORM t.as_user(t.u(900));
  PERFORM public.ican_franchise_admin_save_partner(t.pid(6), jsonb_build_object('kyc_status','verified','company_status','verified','parent_partner_id', t.pid(1)));
  PERFORM public.ican_franchise_admin_set_status(t.pid(6), 'active');
  PERFORM public.ican_franchise_admin_assign_customer(t.b(11), t.pid(6));
  PERFORM t.reset();
  PERFORM t.fee('ican', 'dl-1', 'corporate_subscription', 11, 100);

  PERFORM t.as_user(t.u(1));
  m := public.ican_franchise_my_summary() -> 0;
  PERFORM t.check('16.4 master summary carries downline, royalty and MAR shortfall',
    m->>'partner_type' = 'country_master' AND (m->>'agencies')::INT >= 1 AND m ? 'hq_royalty_12m_ican'
    AND (m->>'mar_shortfall_ican')::NUMERIC = GREATEST((m->>'min_annual_royalty_ican')::NUMERIC - (m->>'hq_royalty_12m_ican')::NUMERIC, 0), m::TEXT);
  SELECT COUNT(*) INTO c FROM public.ican_franchise_my_customers(t.pid(1));
  PERFORM t.check('16.5 master sees downline customers', c >= 1, c::TEXT);
  PERFORM t.reset();

  PERFORM t.as_user(t.u(900));
  PERFORM t.check('16.6 overview exposes the recruiting signal (demand gaps) and open errors',
    jsonb_array_length(public.ican_franchise_admin_overview() -> 'demand_gaps') >= 1
    AND (public.ican_franchise_admin_overview() ->> 'open_errors')::INT >= 1);
  PERFORM t.check('16.7 overview by_country includes Uganda', public.ican_franchise_admin_overview() -> 'by_country_30d' @> '[{"country_code":"UG"}]');
  PERFORM t.check('16.8 admin list filters by type', jsonb_array_length(public.ican_franchise_admin_list_partners(NULL, 'country_master', NULL)) >= 1);
  PERFORM t.check('16.9 admin statement list returns rows', jsonb_array_length(public.ican_franchise_admin_list_statements(NULL, 50)) >= 1);
  PERFORM t.reset();
END $t$;

-- ================================================================ 17. Manual void and audit trail
DO $t$
DECLARE v_ev UUID; r JSONB;
BEGIN
  PERFORM t.fee('ican', 'mv-1', 'corporate_subscription', 11, 100);
  v_ev := (SELECT id FROM public.ican_franchise_revenue_events WHERE source_reference = 'mv-1');
  PERFORM t.as_user(t.u(900));
  PERFORM t.check('17.1 a void needs a reason', t.err(format($$SELECT public.ican_franchise_admin_void_event(%L,'')$$, v_ev)) LIKE '%reason%');
  r := public.ican_franchise_admin_void_event(v_ev, 'duplicate order');
  PERFORM t.reset();
  PERFORM t.check('17.2 manual void works and is audited',
    (r->>'reversed')::BOOLEAN AND EXISTS (SELECT 1 FROM public.ican_franchise_audit_log WHERE action = 'event_voided' AND entity_id = v_ev::TEXT), r::TEXT);
END $t$;

-- ================================================================ report
SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, name, CASE WHEN ok THEN '' ELSE COALESCE(left(info, 300), '') END AS detail
  FROM t.results WHERE NOT ok ORDER BY n;
SELECT COUNT(*) FILTER (WHERE ok) AS passed, COUNT(*) FILTER (WHERE NOT ok) AS failed, COUNT(*) AS total FROM t.results;

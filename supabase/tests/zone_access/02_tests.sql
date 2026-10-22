\set ON_ERROR_STOP on

-- small helpers so the scenarios read as scenarios
CREATE FUNCTION t.zone(p_zone UUID, p_name TEXT, p_mode TEXT, p_basis TEXT, p_cash BOOLEAN, p_permit BOOLEAN,
                       p_stay INT, p_over NUMERIC, p_fees JSONB) RETURNS JSONB LANGUAGE sql AS $$
  SELECT public.mbg_zone_upsert(t.u(100), p_zone, p_name, 'estate', 'Kololo', 'active', p_mode, p_basis, p_cash, p_permit,
                                p_stay, p_over, 10, 'Africa/Kampala', p_fees) $$;
CREATE FUNCTION t.zid(p_key TEXT) RETURNS UUID LANGUAGE sql AS $$ SELECT v::UUID FROM t.keep WHERE k = p_key $$;
CREATE FUNCTION t.vid(p JSONB) RETURNS UUID LANGUAGE sql AS $$ SELECT (p #>> '{visit,id}')::UUID $$;
CREATE FUNCTION t.bal(p_user INT) RETURNS NUMERIC LANGUAGE sql AS $$ SELECT ican_balance FROM public.ican_user_wallets WHERE user_id = t.u(p_user) $$;
CREATE FUNCTION t.biz_bal(p_biz INT) RETURNS NUMERIC LANGUAGE sql AS $$ SELECT COALESCE((SELECT ican_balance FROM public.ican_business_wallets WHERE business_profile_id = t.u(p_biz)), 0) $$;
CREATE FUNCTION t.num(p_key TEXT) RETURNS NUMERIC LANGUAGE sql AS $$ SELECT v::NUMERIC FROM t.keep WHERE k = p_key $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA t TO PUBLIC;

-- ═══ 1. the rate, and the tables are closed to the API ═══════════════════════
DO $$ BEGIN
  PERFORM t.check('IcanEra''s cut of a zone fee defaults to 3%', public.ican_fee_rate('zone_access_fee') = 0.03);
  PERFORM t.check('the other fee fallbacks are still there',
    public.ican_fee_rate('send_bank') = 0.03 AND public.ican_fee_rate('dropship_sale') = 0.02 AND public.ican_fee_rate('store_sale') = 0.01);
  PERFORM t.check('the rate row is in the fee table', EXISTS (SELECT 1 FROM public.ican_fee_rates WHERE key = 'zone_access_fee' AND rate = 0.03));
END $$;

SELECT t.login(5);
DO $$ BEGIN
  PERFORM t.check('the API cannot read visits directly', t.raises('SELECT * FROM public.mbg_access_visits'));
  PERFORM t.check('the API cannot read zones directly',  t.raises('SELECT * FROM public.mbg_access_zones'));
  PERFORM t.check('the API cannot call an internal helper', t.raises('SELECT public.mbg_zone_staff_can(t.u(100), ''gate'')'));
  PERFORM t.check('the API cannot settle platform fees by hand', t.raises('SELECT public.mbg_zone_settle_platform_fee(t.u(1))'));
END $$;
SELECT t.as_anon();
DO $$ BEGIN
  PERFORM t.check('signed-out callers cannot use the staff API', t.raises('SELECT public.mbg_zone_list(t.u(100))'));
  PERFORM t.check('signed-out callers cannot pay a rider fee', t.raises('SELECT public.mbg_rider_pay_gate_fee(t.u(1))'));
END $$;

-- ═══ 2. who may do what ══════════════════════════════════════════════════════
SELECT t.login(5);
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_list(t.u(100));
  PERFORM t.check('a stranger cannot list zones', r ->> 'success' = 'false');
  r := t.zone(NULL, 'Hack', 'members_only', 'per_entry', false, false, NULL, 0, NULL);
  PERFORM t.check('a stranger cannot create a zone', r ->> 'success' = 'false');
END $$;

-- the gate guard (role: transport.gate only)
SELECT t.login(2, 'guard@x.test');
DO $$ DECLARE r JSONB; BEGIN
  r := t.zone(NULL, 'Guard zone', 'members_only', 'per_entry', false, false, NULL, 0, NULL);
  PERFORM t.check('a gate role cannot create zones', r ->> 'success' = 'false');
  r := public.mbg_zone_list(t.u(100));
  PERFORM t.check('a gate role can list zones', r ->> 'success' = 'true');
  PERFORM t.check('...and sees it may only run the gate',
    (r #>> '{caps,gate}') = 'true' AND (r #>> '{caps,edit}') = 'false' AND (r #>> '{caps,assign}') = 'false');
END $$;

-- the viewer (role: transport.view only)
SELECT t.login(3, 'viewer@x.test');
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_list(t.u(100));
  PERFORM t.check('a view role can list zones', r ->> 'success' = 'true' AND (r #>> '{caps,view}') = 'true' AND (r #>> '{caps,gate}') = 'false');
END $$;

-- the manager (edit + assign) and the owner
SELECT t.login(1);
DO $$ DECLARE r JSONB; BEGIN
  -- a zone that sells entry must say what each class pays
  r := t.zone(NULL, 'Estate', 'paid_entry', 'per_entry', false, false, NULL, 0, NULL);
  PERFORM t.check('paid entry without fees is refused', r ->> 'success' = 'false');
  r := t.zone(NULL, 'Estate', 'paid_entry', 'per_entry', false, false, NULL, 0, '{"spaceship": 100}');
  PERFORM t.check('an unknown vehicle class is refused', r ->> 'success' = 'false');
  r := t.zone(NULL, 'Estate', 'paid_entry', 'per_entry', false, false, NULL, 0, '{"car": -5}');
  PERFORM t.check('a negative fee is refused', r ->> 'success' = 'false');

  r := t.zone(NULL, 'Estate', 'paid_entry', 'per_entry', false, false, NULL, 0, '{"motorcycle": 2000, "car": 5000, "truck": 0}');
  PERFORM t.check('the owner creates a paid-entry zone', r ->> 'success' = 'true');
  INSERT INTO t.keep VALUES ('estate', r ->> 'zone_id');
  r := t.zone(NULL, 'estate', 'members_only', 'per_entry', false, false, NULL, 0, NULL);
  PERFORM t.check('zone names are unique per business (any case)', r ->> 'success' = 'false');

  r := t.zone(NULL, 'Staff yard', 'members_only', 'per_entry', false, false, NULL, 0, NULL);
  PERFORM t.check('a members-only zone needs no fees', r ->> 'success' = 'true');
  INSERT INTO t.keep VALUES ('yard', r ->> 'zone_id');
  r := t.zone(NULL, 'Day market', 'paid_entry', 'day_pass', false, false, NULL, 0, '{"motorcycle": 2000}');
  INSERT INTO t.keep VALUES ('market', r ->> 'zone_id');
  r := t.zone(NULL, 'Cash car park', 'paid_entry', 'per_entry', true, false, NULL, 0, '{"motorcycle": 2000}');
  INSERT INTO t.keep VALUES ('cash', r ->> 'zone_id');
  r := t.zone(NULL, 'Hospital', 'paid_entry', 'per_entry', false, true, NULL, 0, '{"motorcycle": 2000}');
  INSERT INTO t.keep VALUES ('hospital', r ->> 'zone_id');
  r := t.zone(NULL, 'Port', 'paid_entry', 'per_entry', false, false, 60, 1000, '{"motorcycle": 2000}');
  INSERT INTO t.keep VALUES ('port', r ->> 'zone_id');
  r := public.mbg_zone_list(t.u(100));
  PERFORM t.check('the list carries fees, rules and the platform rate',
    jsonb_array_length(r -> 'zones') = 6 AND (r ->> 'platform_fee_rate')::NUMERIC = 0.03
    AND (SELECT (z ->> 'fees')::JSONB ->> 'car' FROM jsonb_array_elements(r -> 'zones') z WHERE z ->> 'name' = 'Estate') = '5000.00');
END $$;

SELECT t.login(4, 'manager@x.test');
DO $$ DECLARE r JSONB; BEGIN
  r := t.zone(t.zid('estate'), 'Estate', 'paid_entry', 'per_entry', false, false, NULL, 0, '{"motorcycle": 2000, "car": 5000, "truck": 0}');
  PERFORM t.check('a manager with edit can change a zone', r ->> 'success' = 'true');
  r := public.mbg_zone_gate_check_in(t.zid('estate'), t.code(11));
  PERFORM t.check('a manager without the gate action cannot scan', r ->> 'success' = 'false');
END $$;

-- the admin passes everything
SELECT t.login(6, 'admin@x.test');
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_list(t.u(100));
  PERFORM t.check('a CMMS admin has every power',
    (r #>> '{caps,view}') = 'true' AND (r #>> '{caps,edit}') = 'true' AND (r #>> '{caps,assign}') = 'true' AND (r #>> '{caps,gate}') = 'true');
END $$;

-- ═══ 3. the approved list ════════════════════════════════════════════════════
SELECT t.login(4, 'manager@x.test');
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_search_riders(t.u(100), t.zid('estate'), 'UAB');
  PERFORM t.check('search finds a vehicle by plate (spaces and case ignored)',
    jsonb_array_length(r -> 'riders') = 1 AND r #>> '{riders,0,plate_number}' = 'UAB 123X');
  r := public.mbg_zone_search_riders(t.u(100), t.zid('estate'), 'uab123x');
  PERFORM t.check('...however it is typed', jsonb_array_length(r -> 'riders') = 1);
  r := public.mbg_zone_search_riders(t.u(100), t.zid('estate'), 'https://bodagoera.icanera.space/rider-card/' || t.code(12));
  PERFORM t.check('search takes the whole link from a QR scan', r #>> '{riders,0,plate_number}' = 'UBC 456Y');
  r := public.mbg_zone_search_riders(t.u(100), t.zid('estate'), 'ICN-13');
  PERFORM t.check('search finds a card by its number', r #>> '{riders,0,plate_number}' = 'UCD 789Z');
  PERFORM t.check('search never returns contact details',
    NOT (public.mbg_zone_search_riders(t.u(100), t.zid('estate'), 'UAB') ::TEXT ~* '(phone|email|license)'));
  r := public.mbg_zone_search_riders(t.u(100), t.zid('estate'), 'ab');
  PERFORM t.check('a two-letter search returns nothing', jsonb_array_length(r -> 'riders') = 0);

  r := public.mbg_zone_member_add(t.zid('estate'), t.u(1011), 'staff', NULL, NULL, NULL, 'Security supervisor');
  PERFORM t.check('approve a motorcycle', r ->> 'success' = 'true');
  r := public.mbg_zone_member_add(t.zid('estate'), t.u(1012), 'staff', NULL, NULL, NULL, NULL);
  PERFORM t.check('approve a car', r ->> 'success' = 'true');
  r := public.mbg_zone_member_add(t.zid('estate'), t.u(1013), 'supplier', NULL, '08:00', NULL, NULL);
  PERFORM t.check('hours need both a start and an end', r ->> 'success' = 'false');
  r := public.mbg_zone_member_add(t.zid('estate'), t.u(1013), 'supplier', now() - INTERVAL '1 day', NULL, NULL, NULL);
  PERFORM t.check('an end date in the past is refused', r ->> 'success' = 'false');
  r := public.mbg_zone_member_add(t.zid('yard'), t.u(1011), 'staff', NULL, NULL, NULL, NULL);
  PERFORM t.check('approve for the members-only yard too', r ->> 'success' = 'true');
  r := public.mbg_zone_member_add(t.zid('estate'), t.u(1017), 'staff', NULL, NULL, NULL, NULL);
  PERFORM t.check('a rider whose card is only unpaid can still be listed (the gate re-checks the card)', r ->> 'success' = 'true');
  r := public.mbg_zone_members(t.zid('estate'));
  PERFORM t.check('the list shows each vehicle with its live card state',
    jsonb_array_length(r -> 'members') = 3
    AND (SELECT m ->> 'card_state' FROM jsonb_array_elements(r -> 'members') m WHERE m ->> 'plate_number' = 'UJK 333C') = 'unpaid');
END $$;
SELECT t.login(2, 'guard@x.test');
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_member_add(t.zid('estate'), t.u(1014), 'staff', NULL, NULL, NULL, NULL);
  PERFORM t.check('the gate cannot change the approved list', r ->> 'success' = 'false');
  r := public.mbg_zone_search_riders(t.u(100), t.zid('estate'), 'UAB');
  PERFORM t.check('the gate cannot search riders', r ->> 'success' = 'false');
END $$;
SELECT t.login(5);
DO $$ BEGIN
  PERFORM t.check('a stranger cannot read the approved list', public.mbg_zone_members(t.zid('estate')) ->> 'success' = 'false');
END $$;

-- ═══ 4. approved vehicles: in free, out cleared ══════════════════════════════
SELECT t.login(5);
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_gate_check_in(t.zid('estate'), t.code(11));
  PERFORM t.check('a stranger cannot check anyone in', r ->> 'success' = 'false');
END $$;

SELECT t.login(2, 'guard@x.test');
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_gate_check_in(t.zid('estate'), t.code(11), 'Main gate', 'uab 123x');
  PERFORM t.check('an approved motorcycle is granted entry', r ->> 'verdict' = 'granted' AND r ->> 'basis' = 'member', r::TEXT);
  PERFORM t.check('...it pays nothing', (r #>> '{visit,fee_due_ugx}')::NUMERIC = 0 AND r #>> '{visit,status}' = 'inside');
  PERFORM t.check('...the gate sees who it is', r #>> '{rider,plate_number}' = 'UAB 123X' AND r #>> '{rider,card_number}' = 'ICN-11');
  PERFORM t.check('...and never her contact details', NOT (r::TEXT ~* '(phone|email)'));
  PERFORM t.check('...a plate typed with different spacing is not a mismatch', jsonb_array_length(r -> 'warnings') = 0, r::TEXT);

  r := public.mbg_zone_gate_check_in(t.zid('estate'), t.code(11));
  PERFORM t.check('scanning it again does not check it in twice', r ->> 'verdict' = 'already_inside');
  r := public.mbg_zone_gate_check_in(t.zid('estate'), 'https://bodagoera.icanera.space/rider-card/' || t.code(11) || '?x=1');
  PERFORM t.check('the whole QR link works as well as the bare code', r ->> 'verdict' = 'already_inside');

  r := public.mbg_zone_gate_check_out(t.zid('estate'), t.code(11), 'Main gate');
  PERFORM t.check('on the way out it is cleared', r ->> 'verdict' = 'cleared' AND r #>> '{visit,status}' = 'exited', r::TEXT);
  r := public.mbg_zone_gate_check_out(t.zid('estate'), t.code(11));
  PERFORM t.check('a second exit scan finds no entry', r ->> 'verdict' = 'not_checked_in');

  -- a plate that is not the one on the card is flagged, not blocked
  r := public.mbg_zone_gate_check_in(t.zid('estate'), t.code(11), NULL, 'UXX 999Z');
  PERFORM t.check('a plate mismatch is a warning, not a refusal', r ->> 'verdict' = 'granted' AND r #>> '{warnings,0}' LIKE '%does not match%', r::TEXT);
  PERFORM public.mbg_zone_gate_check_out(t.zid('estate'), t.code(11));

  -- one scan, three modes
  r := public.mbg_zone_gate_scan(t.zid('estate'), t.code(11), 'auto');
  PERFORM t.check('auto: a vehicle that is not inside is checked IN', r ->> 'direction' = 'in' AND r ->> 'verdict' = 'granted', r::TEXT);
  r := public.mbg_zone_gate_scan(t.zid('estate'), t.code(11), 'auto');
  PERFORM t.check('auto: the same card again is checked OUT', r ->> 'direction' = 'out' AND r ->> 'verdict' = 'cleared', r::TEXT);
  r := public.mbg_zone_gate_scan(t.zid('estate'), t.code(11), 'in');
  PERFORM public.mbg_zone_gate_scan(t.zid('estate'), t.code(11), 'out');
  PERFORM t.check('explicit in / out do what they say', r ->> 'direction' = 'in');
  r := public.mbg_zone_gate_scan(t.zid('estate'), t.code(11), 'sideways');
  PERFORM t.check('an unknown direction is refused', r ->> 'success' = 'false');
END $$;

-- ═══ 5. not approved: must pay ═══════════════════════════════════════════════
SELECT t.login(2, 'guard@x.test');
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_gate_check_in(t.zid('estate'), t.code(15), 'Main gate');
  PERFORM t.check('an unapproved motorcycle must pay', r ->> 'verdict' = 'pay_required' AND (r ->> 'fee_ugx')::NUMERIC = 2000, r::TEXT);
  PERFORM t.check('...2000 UGX is 0.4 ICAN', (r ->> 'fee_ican')::NUMERIC = 0.4);
  PERFORM t.check('...it is NOT inside yet', r #>> '{visit,status}' = 'awaiting_payment' AND r #>> '{visit,entered_at}' IS NULL);
  INSERT INTO t.keep VALUES ('v15', r #>> '{visit,id}');
  r := public.mbg_zone_gate_check_in(t.zid('estate'), t.code(15));
  PERFORM t.check('scanning again returns the same request, not a second one', r ->> 'verdict' = 'pay_required' AND r #>> '{visit,id}' = t.zid('v15')::TEXT);
  r := public.mbg_zone_gate_check_out(t.zid('estate'), t.code(15));
  PERFORM t.check('it cannot leave: it never got in', r ->> 'verdict' = 'not_checked_in');
  r := public.mbg_zone_gate_collect_cash(t.vid(jsonb_build_object('visit', jsonb_build_object('id', t.zid('v15')::TEXT))));
  PERFORM t.check('this zone does not take cash', r ->> 'success' = 'false');
END $$;
SELECT t.as_admin();
DO $$ BEGIN
  PERFORM t.check('the rider got a phone alert', EXISTS (SELECT 1 FROM public.push_log WHERE user_id = t.u(15) AND source = 'bodagoera_gate' AND message LIKE '%2,000%'));
  PERFORM t.check('nothing has been charged yet', t.bal(15) = 10 AND t.biz_bal(100) = 0);
END $$;

-- the rider sees the request and pays
SELECT t.login(15);
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_my_gate_passes();
  PERFORM t.check('the rider''s screen lists the request', jsonb_array_length(r -> 'requests') = 1 AND r #>> '{requests,0,kind}' = 'entry'
                  AND (r #>> '{requests,0,fee_ican}')::NUMERIC = 0.4, r::TEXT);
END $$;
SELECT t.login(16);
DO $$ BEGIN
  PERFORM t.check('another rider cannot pay someone else''s request',
    public.mbg_rider_pay_gate_fee(t.zid('v15')) ->> 'success' = 'false');
END $$;
SELECT t.login(15);
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_rider_pay_gate_fee(t.zid('v15'));
  PERFORM t.check('the rider pays', r ->> 'success' = 'true' AND r #>> '{visit,status}' = 'inside', r::TEXT);
  r := public.mbg_rider_pay_gate_fee(t.zid('v15'));
  PERFORM t.check('paying twice is harmless', r ->> 'success' = 'true' AND r ->> 'already_paid' = 'true');
END $$;
SELECT t.as_admin();
DO $$ DECLARE r RECORD; BEGIN
  PERFORM t.check('the rider paid exactly 0.4 ICAN, once', t.bal(15) = 9.6, t.bal(15)::TEXT);
  PERFORM t.check('the business got 97% = 0.388 ICAN', t.biz_bal(100) = 0.388, t.biz_bal(100)::TEXT);
  PERFORM t.check('IcanEra got 3% = 0.012 ICAN', t.biz_bal(900) = 0.012 AND (SELECT amount_ican FROM public.platform_fee_log LIMIT 1) = 0.012);
  PERFORM t.check('nothing was lost: 0.388 + 0.012 = 0.4', t.biz_bal(100) + t.biz_bal(900) = 0.4);
  SELECT * INTO r FROM public.mbg_access_visits WHERE id = t.zid('v15');
  PERFORM t.check('the visit records the split in UGX', r.fee_paid_ugx = 2000 AND r.platform_fee_ugx = 60 AND r.platform_fee_settled_ugx = 60 AND r.payment_method = 'wallet');
  PERFORM t.check('the business wallet has a statement line for the net', EXISTS (
    SELECT 1 FROM public.ican_business_wallet_transactions WHERE business_profile_id = t.u(100) AND direction = 'in' AND amount_ican = 0.388 AND operation_type = 'zone_access_fee'));
END $$;
SELECT t.login(2, 'guard@x.test');
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_gate_check_out(t.zid('estate'), t.code(15));
  PERFORM t.check('having paid, it leaves cleared', r ->> 'verdict' = 'cleared', r::TEXT);
  r := public.mbg_zone_gate_check_in(t.zid('estate'), t.code(15));
  PERFORM t.check('per-entry zone: coming back means paying again', r ->> 'verdict' = 'pay_required');
  INSERT INTO t.keep VALUES ('vwithdrawn', t.vid(r)::TEXT);
  PERFORM t.check('the gate can withdraw a request', public.mbg_zone_gate_cancel(t.vid(r)) ->> 'success' = 'true');
END $$;
SELECT t.as_admin();
DO $$ BEGIN PERFORM t.check('...and it is cancelled', (SELECT status FROM public.mbg_access_visits WHERE id = t.zid('vwithdrawn')) = 'cancelled'); END $$;

-- ═══ 6. class rules ══════════════════════════════════════════════════════════
SELECT t.login(2, 'guard@x.test');
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_gate_check_in(t.zid('estate'), t.code(13));
  PERFORM t.check('approved-or-not, a truck with fee 0 walks in free ("open")', r ->> 'verdict' = 'granted' AND r ->> 'basis' = 'open', r::TEXT);
  PERFORM public.mbg_zone_gate_check_out(t.zid('estate'), t.code(13));
  r := public.mbg_zone_gate_check_in(t.zid('estate'), t.code(14));
  PERFORM t.check('a bicycle has no fee row, so this zone refuses it', r ->> 'verdict' = 'denied' AND r ->> 'reason' = 'vehicle_not_allowed', r::TEXT);
  r := public.mbg_zone_gate_check_in(t.zid('yard'), t.code(15));
  PERFORM t.check('a members-only zone refuses anyone not approved', r ->> 'verdict' = 'denied' AND r ->> 'reason' = 'not_on_list');
  r := public.mbg_zone_gate_check_in(t.zid('yard'), t.code(11));
  PERFORM t.check('...and lets the approved one in', r ->> 'verdict' = 'granted');
  PERFORM public.mbg_zone_gate_check_out(t.zid('yard'), t.code(11));
END $$;

-- an approved vehicle that is suspended / expired / outside its hours is "not approved"
SELECT t.login(4, 'manager@x.test');
DO $$ DECLARE m UUID; BEGIN
  m := (public.mbg_zone_member_add(t.zid('yard'), t.u(1012), 'contractor', NULL, NULL, NULL, NULL) ->> 'member_id')::UUID;
  PERFORM t.check('the manager suspends a vehicle', public.mbg_zone_member_set_status(m, 'suspended') ->> 'success' = 'true');
  PERFORM t.check('an unknown status is refused', public.mbg_zone_member_set_status(m, 'banished') ->> 'success' = 'false');
  INSERT INTO t.keep VALUES ('m12yard', m::TEXT);
END $$;
SELECT t.login(2, 'guard@x.test');
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_gate_check_in(t.zid('yard'), t.code(12));
  PERFORM t.check('a suspended vehicle is refused on a members-only zone', r ->> 'verdict' = 'denied' AND r ->> 'reason' = 'member_suspended', r::TEXT);
  PERFORM t.check('the gate cannot reinstate it', public.mbg_zone_member_set_status(
    t.zid('m12yard'), 'active') ->> 'success' = 'false');
END $$;
SELECT t.as_admin();
UPDATE public.mbg_access_zone_members SET status = 'suspended' WHERE zone_id = t.zid('estate') AND rider_id = t.u(1012);
SELECT t.login(2, 'guard@x.test');
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_gate_check_in(t.zid('estate'), t.code(12));
  PERFORM t.check('a suspended vehicle on a paying zone must pay like anyone else', r ->> 'verdict' = 'pay_required' AND (r ->> 'fee_ugx')::NUMERIC = 5000, r::TEXT);
  PERFORM public.mbg_zone_gate_cancel(t.vid(r));
END $$;
SELECT t.as_admin();
UPDATE public.mbg_access_zone_members SET status = 'active', daily_start_time = '00:00', daily_end_time = '00:01'
 WHERE zone_id = t.zid('estate') AND rider_id = t.u(1012);   -- one minute a day: outside it unless it is midnight right now
SELECT t.login(2, 'guard@x.test');
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_gate_check_in(t.zid('estate'), t.code(12));
  IF (now() AT TIME ZONE 'Africa/Kampala')::TIME BETWEEN '00:00' AND '00:01' THEN
    PERFORM t.check('(midnight in Kampala: the one-minute window is open)', r ->> 'verdict' = 'granted');
  ELSE
    PERFORM t.check('outside its approved hours a vehicle pays like anyone else', r ->> 'verdict' = 'pay_required', r::TEXT);
    PERFORM public.mbg_zone_gate_cancel(t.vid(r));
  END IF;
END $$;
SELECT t.as_admin();
UPDATE public.mbg_access_zone_members SET daily_start_time = NULL, daily_end_time = NULL, valid_until = now() - INTERVAL '1 minute'
 WHERE zone_id = t.zid('estate') AND rider_id = t.u(1012);
SELECT t.login(2, 'guard@x.test');
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_gate_check_in(t.zid('estate'), t.code(12));
  PERFORM t.check('an expired approval means paying', r ->> 'verdict' = 'pay_required');
  PERFORM public.mbg_zone_gate_cancel(t.vid(r));
END $$;
SELECT t.as_admin();
UPDATE public.mbg_access_zone_members SET valid_until = NULL WHERE zone_id = t.zid('estate') AND rider_id = t.u(1012);

-- ═══ 7. the card decides first ═══════════════════════════════════════════════
SELECT t.login(2, 'guard@x.test');
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_gate_check_in(t.zid('estate'), 'NOTAREALCODE0000000000');
  PERFORM t.check('an unknown code is refused', r ->> 'verdict' = 'denied' AND r ->> 'reason' = 'unknown_card');
  r := public.mbg_zone_gate_check_in(t.zid('estate'), 'short');
  PERFORM t.check('garbage is refused, not an error', r ->> 'verdict' = 'denied' AND r ->> 'reason' = 'unknown_card');
  r := public.mbg_zone_gate_check_in(t.zid('estate'), t.code(17));
  PERFORM t.check('an unpaid card is refused even for an approved vehicle', r ->> 'verdict' = 'denied' AND r ->> 'reason' = 'card_unpaid', r::TEXT);
  PERFORM t.check('...and says nothing about the rider', r ->> 'card_number' = 'ICN-17' AND NOT (r::TEXT ~* '(UJK|Rider|motorcycle)'), r::TEXT);
  r := public.mbg_zone_gate_check_in(t.zid('estate'), t.code(18));
  PERFORM t.check('an expired card is refused', r ->> 'reason' = 'card_expired');
  r := public.mbg_zone_gate_check_in(t.zid('estate'), t.code(19));
  PERFORM t.check('a suspended rider is refused', r ->> 'reason' = 'rider_suspended');
  r := public.mbg_zone_gate_check_in(t.zid('estate'), t.code(20));
  PERFORM t.check('a cancelled card is refused', r ->> 'reason' = 'card_cancelled');
END $$;
SELECT t.as_admin();
DO $$ BEGIN
  PERFORM t.check('refused scans are logged', (SELECT count(*) FROM public.mbg_access_visits WHERE status = 'denied' AND zone_id = t.zid('estate')) >= 4);
  PERFORM t.check('...without naming the rider when the card was the problem',
    (SELECT count(*) FROM public.mbg_access_visits WHERE status = 'denied' AND rider_name IS NOT NULL AND card_number IN ('ICN-17','ICN-18','ICN-19','ICN-20')) = 0);
END $$;

-- permit rule
SELECT t.login(2, 'guard@x.test');
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_gate_check_in(t.zid('hospital'), t.code(21));
  PERFORM t.check('a zone that requires a valid permit refuses an expired one', r ->> 'reason' = 'permit_expired', r::TEXT);
  r := public.mbg_zone_gate_check_in(t.zid('estate'), t.code(21));
  PERFORM t.check('elsewhere it is only a warning on the pay request', r ->> 'verdict' = 'pay_required' AND r #>> '{warnings,0}' LIKE '%permit%', r::TEXT);
  PERFORM public.mbg_zone_gate_cancel(t.vid(r));
END $$;

-- ═══ 8. money failures change nothing ════════════════════════════════════════
SELECT t.login(2, 'guard@x.test');
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_gate_check_in(t.zid('estate'), t.code(16));
  INSERT INTO t.keep VALUES ('v16', r #>> '{visit,id}');
END $$;
SELECT t.as_admin();
DO $$ BEGIN INSERT INTO t.keep VALUES ('biz_before', t.biz_bal(100)::TEXT), ('plat_before', t.biz_bal(900)::TEXT); END $$;
SELECT t.login(16);
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_rider_pay_gate_fee(t.zid('v16'));
  PERFORM t.check('a rider with too little ICAN is told so', r ->> 'success' = 'false' AND r ->> 'error' LIKE 'Insufficient ICAN%', r::TEXT);
END $$;
SELECT t.as_admin();
DO $$ BEGIN
  PERFORM t.check('...and nothing moved', t.bal(16) = 0.1 AND t.biz_bal(100) = t.num('biz_before')
                  AND t.biz_bal(900) = t.num('plat_before'));
  PERFORM t.check('...the request is still waiting', (SELECT status FROM public.mbg_access_visits WHERE id = t.zid('v16')) = 'awaiting_payment');
END $$;
SELECT t.login(16);
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_rider_decline_gate_fee(t.zid('v16'));
  PERFORM t.check('the rider can say no', r ->> 'success' = 'true');
  r := public.mbg_rider_pay_gate_fee(t.zid('v16'));
  PERFORM t.check('a declined request cannot be paid', r ->> 'success' = 'false');
  r := public.mbg_rider_decline_gate_fee(t.zid('v16'));
  PERFORM t.check('...or declined twice', r ->> 'success' = 'false');
END $$;

-- a request not paid in time lapses by itself
SELECT t.login(2, 'guard@x.test');
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_gate_check_in(t.zid('estate'), t.code(15));
  INSERT INTO t.keep VALUES ('v15b', r #>> '{visit,id}');
END $$;
SELECT t.as_admin();
UPDATE public.mbg_access_visits SET pay_by = now() - INTERVAL '1 minute' WHERE id = t.zid('v15b');
SELECT t.login(15);
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_my_gate_passes();
  PERFORM t.check('a lapsed request disappears from the rider''s screen', jsonb_array_length(r -> 'requests') = 0);
  r := public.mbg_rider_pay_gate_fee(t.zid('v15b'));
  PERFORM t.check('...and cannot be paid', r ->> 'success' = 'false' AND r ->> 'error' LIKE '%expired%', r::TEXT);
END $$;
SELECT t.as_admin();
DO $$ BEGIN PERFORM t.check('...the visit is cancelled, with a reason', (SELECT status || '|' || reason FROM public.mbg_access_visits WHERE id = t.zid('v15b')) = 'cancelled|The entry fee was not paid in time'); END $$;

-- ═══ 9. day pass ═════════════════════════════════════════════════════════════
SELECT t.login(2, 'guard@x.test');
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_gate_check_in(t.zid('market'), t.code(15));
  INSERT INTO t.keep VALUES ('vm', r #>> '{visit,id}');
END $$;
SELECT t.login(15);
DO $$ BEGIN PERFORM public.mbg_rider_pay_gate_fee(t.zid('vm')); END $$;
SELECT t.login(2, 'guard@x.test');
DO $$ DECLARE r JSONB; BEGIN
  PERFORM public.mbg_zone_gate_check_out(t.zid('market'), t.code(15));
  r := public.mbg_zone_gate_check_in(t.zid('market'), t.code(15));
  PERFORM t.check('a day pass covers the second entry', r ->> 'verdict' = 'granted' AND r ->> 'basis' = 'day_pass', r::TEXT);
  PERFORM t.check('...at no charge', (r #>> '{visit,fee_due_ugx}')::NUMERIC = 0);
  r := public.mbg_zone_gate_check_out(t.zid('market'), t.code(15));
  PERFORM t.check('...and leaves cleared', r ->> 'verdict' = 'cleared');
END $$;
SELECT t.as_admin();
UPDATE public.mbg_access_visits SET entered_at = now() - INTERVAL '25 hours' WHERE zone_id = t.zid('market') AND access_basis = 'paid';
SELECT t.login(2, 'guard@x.test');
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_gate_check_in(t.zid('market'), t.code(15));
  PERFORM t.check('a day pass lasts 24 hours', r ->> 'verdict' = 'pay_required');
  PERFORM public.mbg_zone_gate_cancel(t.vid(r));
END $$;

-- ═══ 10. cash, and IcanEra''s cut of it ═══════════════════════════════════════
SELECT t.login(2, 'guard@x.test');
DO $$ DECLARE r JSONB; BEFORE NUMERIC; BEGIN
  r := public.mbg_zone_gate_check_in(t.zid('cash'), t.code(15));
  PERFORM t.check('a cash zone offers cash', r ->> 'verdict' = 'pay_required' AND r ->> 'can_collect_cash' = 'true');
  INSERT INTO t.keep VALUES ('vc', r #>> '{visit,id}');
END $$;
SELECT t.as_admin();
DO $$ BEGIN INSERT INTO t.keep VALUES ('biz_pre_cash', t.biz_bal(100)::TEXT), ('plat_pre_cash', t.biz_bal(900)::TEXT); END $$;
SELECT t.login(2, 'guard@x.test');
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_gate_collect_cash(t.zid('vc'));
  PERFORM t.check('the gate collects cash', r ->> 'success' = 'true' AND r #>> '{visit,status}' = 'inside' AND r #>> '{visit,payment_method}' = 'cash', r::TEXT);
  PERFORM t.check('...IcanEra''s 60 UGX cut was settled from the business wallet', r ->> 'platform_fee_settled' = 'true' AND (r #>> '{visit,platform_fee_owed_ugx}')::NUMERIC = 0);
END $$;
SELECT t.as_admin();
DO $$ BEGIN
  PERFORM t.check('...the business wallet paid 0.012 ICAN', t.biz_bal(100) = t.num('biz_pre_cash') - 0.012);
  PERFORM t.check('...and IcanEra received it', t.biz_bal(900) = t.num('plat_pre_cash') + 0.012);
END $$;
SELECT t.login(2, 'guard@x.test');
DO $$ DECLARE r JSONB; BEGIN
  PERFORM t.check('a second cash tap collects nothing', public.mbg_zone_gate_collect_cash(t.zid('vc')) ->> 'success' = 'false');
  PERFORM public.mbg_zone_gate_check_out(t.zid('cash'), t.code(15));
END $$;

-- a business wallet that cannot cover IcanEra''s cut: it stays owed, nothing breaks
SELECT t.as_admin();
UPDATE public.ican_business_wallets SET ican_balance = 0 WHERE business_profile_id = t.u(100);
SELECT t.login(2, 'guard@x.test');
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_gate_check_in(t.zid('cash'), t.code(15));
  r := public.mbg_zone_gate_collect_cash(t.vid(r));
  PERFORM t.check('cash is still collected when the wallet is empty', r ->> 'success' = 'true' AND r #>> '{visit,status}' = 'inside', r::TEXT);
  PERFORM t.check('...IcanEra''s cut is kept as owed', r ->> 'platform_fee_settled' = 'false' AND (r #>> '{visit,platform_fee_owed_ugx}')::NUMERIC = 60);
  PERFORM public.mbg_zone_gate_check_out(t.zid('cash'), t.code(15));
END $$;
SELECT t.login(2, 'guard@x.test');
DO $$ BEGIN PERFORM t.check('the gate cannot settle fees', public.mbg_zone_settle_owed(t.u(100)) ->> 'success' = 'false'); END $$;
SELECT t.as_admin();
UPDATE public.ican_business_wallets SET ican_balance = 1 WHERE business_profile_id = t.u(100);
SELECT t.login(1);
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_settle_owed(t.u(100));
  PERFORM t.check('once the wallet is topped up the owner settles what is owed', r ->> 'settled' = '1' AND r ->> 'still_owed' = '0', r::TEXT);
  r := public.mbg_zone_settle_owed(t.u(100));
  PERFORM t.check('...and a second run finds nothing', r ->> 'settled' = '0');
END $$;
SELECT t.as_admin();
DO $$ BEGIN PERFORM t.check('the business paid 0.012 for it', t.biz_bal(100) = 0.988); END $$;

-- ═══ 11. leaving: overstay ═══════════════════════════════════════════════════
SELECT t.login(4, 'manager@x.test');
DO $$ BEGIN PERFORM public.mbg_zone_member_add(t.zid('port'), t.u(1011), 'staff', NULL, NULL, NULL, NULL); END $$;
SELECT t.login(2, 'guard@x.test');
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_gate_check_in(t.zid('port'), t.code(11));
  PERFORM t.check('approved vehicle enters the port', r ->> 'basis' = 'member');
  r := public.mbg_zone_gate_check_in(t.zid('port'), t.code(15));
  INSERT INTO t.keep VALUES ('vp', r #>> '{visit,id}');
END $$;
SELECT t.login(15);
DO $$ BEGIN PERFORM public.mbg_rider_pay_gate_fee(t.zid('vp')); END $$;
SELECT t.as_admin();
UPDATE public.mbg_access_visits SET entered_at = now() - INTERVAL '5 hours' WHERE zone_id = t.zid('port') AND status = 'inside' AND access_basis = 'member';
UPDATE public.mbg_access_visits SET entered_at = now() - INTERVAL '150 minutes' WHERE zone_id = t.zid('port') AND status = 'inside' AND access_basis = 'paid';
SELECT t.login(2, 'guard@x.test');
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_gate_check_out(t.zid('port'), t.code(11));
  PERFORM t.check('an approved vehicle owes no overstay however long it stayed', r ->> 'verdict' = 'cleared', r::TEXT);
  r := public.mbg_zone_gate_check_out(t.zid('port'), t.code(15));
  PERFORM t.check('a paying vehicle 90 minutes over a 60 minute limit owes 2 started hours', r ->> 'verdict' = 'balance_due' AND (r ->> 'balance_ugx')::NUMERIC = 2000, r::TEXT);
  PERFORM t.check('...it is NOT cleared and still inside', public.mbg_zone_visit_status(t.vid(r)) #>> '{visit,status}' = 'inside');
END $$;
SELECT t.login(15);
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_my_gate_passes();
  PERFORM t.check('the rider sees the exit balance as a request', r #>> '{requests,0,kind}' = 'balance' AND (r #>> '{requests,0,fee_ican}')::NUMERIC = 0.4, r::TEXT);
  PERFORM t.check('...and where she is inside', jsonb_array_length(r -> 'inside') = 1);
  r := public.mbg_rider_pay_gate_fee(t.zid('vp'));
  PERFORM t.check('she pays the exit balance', r ->> 'success' = 'true' AND (r ->> 'paid_ugx')::NUMERIC = 2000, r::TEXT);
END $$;
SELECT t.login(2, 'guard@x.test');
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_gate_check_out(t.zid('port'), t.code(15));
  PERFORM t.check('now she is cleared to leave', r ->> 'verdict' = 'cleared', r::TEXT);
  PERFORM t.check('the visit shows entry + overstay, all paid', (r #>> '{visit,entry_fee_ugx}')::NUMERIC = 2000 AND (r #>> '{visit,overstay_ugx}')::NUMERIC = 2000
                  AND (r #>> '{visit,fee_paid_ugx}')::NUMERIC = 4000);
END $$;
SELECT t.as_admin();
DO $$ BEGIN PERFORM t.check('IcanEra took 3% of the entry fee and of the overstay fee', (SELECT platform_fee_ugx FROM public.mbg_access_visits WHERE id = t.zid('vp')) = 120); END $$;

-- ═══ 12. the log and the numbers ═════════════════════════════════════════════
SELECT t.login(3, 'viewer@x.test');
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_visits(t.zid('estate'), 'log', 100);
  PERFORM t.check('a view role reads the log', r ->> 'success' = 'true' AND jsonb_array_length(r -> 'visits') > 5);
  r := public.mbg_zone_report(t.zid('port'), 30);
  PERFORM t.check('...and the report: 2 entries, 1 paid, 4000 UGX collected, 120 to IcanEra, 3880 net',
    (r ->> 'entries')::INT = 2 AND (r ->> 'paid_entries')::INT = 1 AND (r ->> 'collected_ugx')::NUMERIC = 4000
    AND (r ->> 'platform_fee_ugx')::NUMERIC = 120 AND (r ->> 'net_to_business_ugx')::NUMERIC = 3880, r::TEXT);
  PERFORM t.check('a view role cannot scan', public.mbg_zone_gate_check_in(t.zid('port'), t.code(11)) ->> 'success' = 'false');
END $$;
SELECT t.login(5);
DO $$ BEGIN
  PERFORM t.check('a stranger cannot read a log', public.mbg_zone_visits(t.zid('estate'), 'log') ->> 'success' = 'false');
  PERFORM t.check('...or a report', public.mbg_zone_report(t.zid('estate'), 30) ->> 'success' = 'false');
END $$;
SELECT t.login(11);
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_my_gate_passes();
  PERFORM t.check('a rider''s screen lists the zones that approved her vehicle', jsonb_array_length(r -> 'passes') = 3
                  AND (SELECT bool_and(p ->> 'plate_number' = 'UAB 123X') FROM jsonb_array_elements(r -> 'passes') p), r::TEXT);
  PERFORM t.check('...and shows only her own', NOT (r::TEXT ~ 'UEF 111A'));
END $$;

-- ═══ 13. IcanEra''s side is missing: the rider is not blocked, nothing is lost ═
SELECT t.as_admin();
DELETE FROM public.ican_platform_fee_recipient;
DO $$ BEGIN INSERT INTO t.keep VALUES ('biz_np', t.biz_bal(100)::TEXT); END $$;
SELECT t.login(2, 'guard@x.test');
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_gate_check_in(t.zid('estate'), t.code(15));
  INSERT INTO t.keep VALUES ('vnp', r #>> '{visit,id}');
END $$;
SELECT t.login(15);
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_rider_pay_gate_fee(t.zid('vnp'));
  PERFORM t.check('the rider can still pay when the platform business is not configured', r ->> 'success' = 'true', r::TEXT);
  PERFORM t.check('...the cut is owed', (r #>> '{visit,platform_fee_owed_ugx}')::NUMERIC = 60);
END $$;
SELECT t.as_admin();
DO $$ BEGIN PERFORM t.check('...and the business holds the whole 0.4 for now (no money vanished)', t.biz_bal(100) = t.num('biz_np') + 0.4); END $$;
INSERT INTO public.ican_platform_fee_recipient VALUES (true, t.u(900));
SELECT t.login(1);
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_settle_owed(t.u(100));
  PERFORM t.check('once IcanEra''s business is set up the owner settles it', r ->> 'settled' = '1', r::TEXT);
END $$;
SELECT t.as_admin();
DO $$ BEGIN PERFORM t.check('the business paid back 0.012', t.biz_bal(100) = t.num('biz_np') + 0.388); END $$;

-- a rate change takes effect on the next request, not on the one already shown
UPDATE public.ican_fee_rates SET rate = 0.05 WHERE key = 'zone_access_fee';
SELECT t.login(2, 'guard@x.test');
DO $$ DECLARE r JSONB; BEGIN
  PERFORM public.mbg_zone_gate_check_out(t.zid('estate'), t.code(15));
  r := public.mbg_zone_gate_check_in(t.zid('estate'), t.code(15));
  INSERT INTO t.keep VALUES ('v5pct', r #>> '{visit,id}');
END $$;
SELECT t.login(15);
DO $$ BEGIN PERFORM public.mbg_rider_pay_gate_fee(t.zid('v5pct')); END $$;
SELECT t.as_admin();
DO $$ BEGIN
  PERFORM t.check('a developer can change IcanEra''s rate (5%: 100 UGX of 2000)', (SELECT platform_fee_ugx FROM public.mbg_access_visits WHERE id = t.zid('v5pct')) = 100);
END $$;
UPDATE public.ican_fee_rates SET rate = 0.03 WHERE key = 'zone_access_fee';

-- ═══ 14. nothing is ever double counted ══════════════════════════════════════
DO $$ BEGIN
  PERFORM t.check('no visit ever has more paid than due',
    NOT EXISTS (SELECT 1 FROM public.mbg_access_visits WHERE status NOT IN ('denied', 'cancelled') AND fee_paid_ugx > fee_due_ugx));
  PERFORM t.check('no vehicle is inside one zone twice',
    NOT EXISTS (SELECT 1 FROM public.mbg_access_visits WHERE status IN ('inside', 'awaiting_payment') GROUP BY zone_id, rider_id HAVING count(*) > 1));
  PERFORM t.check('IcanEra''s ledger matches its wallet', (SELECT sum(amount_ican) FROM public.platform_fee_log) = t.biz_bal(900));
END $$;

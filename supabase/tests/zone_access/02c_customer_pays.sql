\set ON_ERROR_STOP on
-- A customer on the ride pays the entry fee, never the rider alone. Runs after 02_tests.sql, on the same data.
-- The estate sits at (0.3300, 32.5900), 300 m round. "here" is inside it, "else" is nowhere near any zone.

CREATE FUNCTION t.zone_here(p_fee INT DEFAULT 2000, p_cash BOOLEAN DEFAULT false) RETURNS JSONB LANGUAGE sql AS $$
  SELECT public.mbg_zone_upsert(t.u(100), t.zid('estate'), 'Estate', 'estate', 'Kololo', 'active', 'paid_entry', 'per_entry', p_cash, false, NULL, 0, 10,
    'Africa/Kampala', jsonb_build_object('motorcycle', p_fee, 'car', 5000, 'truck', 0), 0.33, 32.59, 300) $$;
GRANT EXECUTE ON FUNCTION t.zone_here(INT, BOOLEAN) TO PUBLIC;

SELECT t.as_admin();
DO $$ BEGIN INSERT INTO t.keep VALUES ('here_lat', '0.3309'), ('here_lng', '32.5900'), ('else_lat', '0.4000'), ('else_lng', '32.6500'); END $$;

-- rider 15 may still be inside from the rate-change test: out first
SELECT t.login(2, 'guard@x.test');
DO $$ BEGIN PERFORM public.mbg_zone_gate_check_out(t.zid('estate'), t.code(15)); END $$;

-- ═══ the zone is put on the map ═════════════════════════════════════════════
SELECT t.login(1);
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_upsert(t.u(100), t.zid('estate'), 'Estate', 'estate', 'Kololo', 'active', 'paid_entry', 'per_entry', false, false, NULL, 0, 10,
                              'Africa/Kampala', '{"motorcycle": 2000}'::JSONB, 0.33, NULL, 300);
  PERFORM t.check('a half-given map position is refused', r ->> 'success' = 'false', r::TEXT);
  r := public.mbg_zone_upsert(t.u(100), t.zid('estate'), 'Estate', 'estate', 'Kololo', 'active', 'paid_entry', 'per_entry', false, false, NULL, 0, 10,
                              'Africa/Kampala', '{"motorcycle": 2000}'::JSONB, 0.33, 32.59, 10);
  PERFORM t.check('a radius under 20 m is refused', r ->> 'success' = 'false');
  r := public.mbg_zone_upsert(t.u(100), t.zid('estate'), 'Estate', 'estate', 'Kololo', 'active', 'paid_entry', 'per_entry', false, false, NULL, 0, 10,
                              'Africa/Kampala', '{"motorcycle": 2000}'::JSONB, 95, 32.59, 300);
  PERFORM t.check('a latitude off the map is refused', r ->> 'success' = 'false');
  r := t.zone_here();
  PERFORM t.check('a valid position is saved', r ->> 'success' = 'true', r::TEXT);
  PERFORM t.check('...and listed with the zone', (SELECT (z ->> 'radius_m')::INT FROM jsonb_array_elements(public.mbg_zone_list(t.u(100)) -> 'zones') z
                                                    WHERE z ->> 'name' = 'Estate') = 300);
END $$;

-- ═══ the warning shown while booking ═════════════════════════════════════════
SELECT t.login(31);
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_charges_for_trip(t.num('else_lat'), t.num('else_lng'), t.num('here_lat'), t.num('here_lng'), 'motorcycle');
  PERFORM t.check('a trip ending in a zone is warned about its fee, for the chosen vehicle', jsonb_array_length(r -> 'charges') = 1
                  AND r #>> '{charges,0,applies_at}' = 'dropoff' AND (r #>> '{charges,0,fee_ugx}')::NUMERIC = 2000 AND (r ->> 'total_ugx')::NUMERIC = 2000, r::TEXT);
  PERFORM t.check('...naming the zone, the organisation and whether the gate takes cash',
    r #>> '{charges,0,zone_name}' = 'Estate' AND r #>> '{charges,0,organisation}' = 'Kololo Heights Estate' AND r #>> '{charges,0,accepts_cash}' = 'false');
  r := public.mbg_zone_charges_for_trip(t.num('here_lat'), t.num('here_lng'), t.num('else_lat'), t.num('else_lng'), 'motorcycle');
  PERFORM t.check('a trip starting in a zone is warned too', r #>> '{charges,0,applies_at}' = 'pickup');
  r := public.mbg_zone_charges_for_trip(t.num('here_lat'), t.num('here_lng'), t.num('here_lat'), t.num('here_lng'), 'motorcycle');
  PERFORM t.check('a trip inside one zone is warned once', jsonb_array_length(r -> 'charges') = 1 AND r #>> '{charges,0,applies_at}' = 'both');
  r := public.mbg_zone_charges_for_trip(t.num('else_lat'), t.num('else_lng'), t.num('else_lat'), t.num('else_lng') + 0.01, 'motorcycle');
  PERFORM t.check('a trip nowhere near a zone has nothing to warn about', jsonb_array_length(r -> 'charges') = 0 AND (r ->> 'total_ugx')::NUMERIC = 0);
  r := public.mbg_zone_charges_for_trip(t.num('else_lat'), t.num('else_lng'), t.num('here_lat'), t.num('here_lng'), 'car');
  PERFORM t.check('a car is warned of the car fee', (r #>> '{charges,0,fee_ugx}')::NUMERIC = 5000);
  r := public.mbg_zone_charges_for_trip(t.num('else_lat'), t.num('else_lng'), t.num('here_lat'), t.num('here_lng'), 'truck');
  PERFORM t.check('a vehicle type that gets in free is not warned about', jsonb_array_length(r -> 'charges') = 0);
  r := public.mbg_zone_charges_for_trip(t.num('else_lat'), t.num('else_lng'), t.num('here_lat'), t.num('here_lng'), 'bicycle');
  PERFORM t.check('nor one the zone refuses', jsonb_array_length(r -> 'charges') = 0);
  r := public.mbg_zone_charges_for_trip(t.num('else_lat'), t.num('else_lng'), t.num('here_lat'), t.num('here_lng'), 'any');
  PERFORM t.check('with the vehicle not chosen yet: a range, and the most it could be', r #>> '{charges,0,fee_ugx}' IS NULL
                  AND (r #>> '{charges,0,fee_max_ugx}')::NUMERIC = 5000 AND (r ->> 'total_max_ugx')::NUMERIC = 5000, r::TEXT);
  r := public.mbg_zone_charges_for_trip(t.num('else_lat'), t.num('else_lng'), t.num('here_lat'), t.num('here_lng'), 'motorcycle', t.u(1011));
  PERFORM t.check('an approved rider is waived: the customer pays nothing', (r #>> '{charges,0,waived}') = 'true' AND (r ->> 'total_ugx')::NUMERIC = 0, r::TEXT);
END $$;
SELECT t.as_anon();
DO $$ BEGIN PERFORM t.check('signed-out callers cannot ask', t.raises('SELECT public.mbg_zone_charges_for_trip(0.33, 32.59, 0.33, 32.59)')); END $$;
SELECT t.as_admin();
DO $$ BEGIN
  PERFORM t.check('only the estate is on the map: the other zones never match a trip',
    jsonb_array_length(public.mbg_zone_trip_charges(0.33, 32.59, 0.33, 32.59, 'motorcycle', NULL)) = 1);
END $$;

-- ═══ the ride is booked: the warning is recorded against it ═════════════════
DO $$ DECLARE rd UUID; BEGIN
  rd := t.ride(31, 15, t.num('else_lat'), t.num('else_lng'), t.num('here_lat'), t.num('here_lng'), 'in_progress', 'wallet');
  INSERT INTO t.keep VALUES ('ride1', rd::TEXT);
  rd := t.ride(31, 15, t.num('else_lat'), t.num('else_lng'), t.num('else_lat'), t.num('else_lng') + 0.01, 'in_progress', 'wallet');
  INSERT INTO t.keep VALUES ('ride_far', rd::TEXT);
END $$;
SELECT t.login(32);
DO $$ BEGIN PERFORM t.check('another customer cannot record warnings on someone else''s ride',
  public.mbg_ack_ride_zone_charges(t.zid('ride1'), 'motorcycle') ->> 'success' = 'false'); END $$;
SELECT t.login(31);
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_ack_ride_zone_charges(t.zid('ride1'), 'motorcycle');
  PERFORM t.check('the customer''s booking records the warning', r ->> 'success' = 'true' AND jsonb_array_length(r -> 'charges') = 1);
  r := public.mbg_ack_ride_zone_charges(t.zid('ride1'), 'motorcycle');
  PERFORM t.check('recording it twice is harmless', r ->> 'success' = 'true');
  r := public.mbg_ack_ride_zone_charges(t.zid('ride_far'), 'motorcycle');
  PERFORM t.check('a ride that never meets a zone records nothing', jsonb_array_length(r -> 'charges') = 0);
  r := public.mbg_ride_zone_charges(t.zid('ride1'));
  PERFORM t.check('the customer''s ride screen lists the warning (up to UGX 2,000)', r ->> 'role' = 'customer' AND jsonb_array_length(r -> 'charges') = 0
                  AND (r #>> '{warnings,0,max_fee_ugx}')::NUMERIC = 2000, r::TEXT);
END $$;
SELECT t.as_admin();
DO $$ BEGIN
  PERFORM t.check('only the zone that applies was recorded', (SELECT count(*) FROM public.mbg_ride_zone_notices) = 1);
  INSERT INTO t.keep VALUES ('c31_before', t.bal(31)::TEXT), ('r15_before', t.bal(15)::TEXT), ('biz_b4', t.biz_bal(100)::TEXT), ('plat_b4', t.biz_bal(900)::TEXT);
END $$;

-- ═══ at the gate: the rider has a customer, so the customer's wallet pays ═══
SELECT t.login(2, 'guard@x.test');
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_gate_check_in(t.zid('estate'), t.code(15), 'Main gate');
  PERFORM t.check('a rider with a customer is let in at once', r ->> 'verdict' = 'granted' AND r ->> 'payer' = 'customer' AND r #>> '{visit,status}' = 'inside', r::TEXT);
  PERFORM t.check('...the gate is told the customer''s wallet paid and the rider pays nothing', r ->> 'message' LIKE '%customer''s wallet%' AND r ->> 'message' LIKE '%rider pays nothing%');
  PERFORM t.check('...the visit is tied to the ride and says who paid', r #>> '{visit,ride_id}' = t.zid('ride1')::TEXT AND r #>> '{visit,payer}' = 'customer'
                  AND (r #>> '{visit,fee_paid_ugx}')::NUMERIC = 2000);
END $$;
SELECT t.as_admin();
DO $$ BEGIN
  PERFORM t.check('the CUSTOMER paid exactly 0.4 ICAN', t.bal(31) = t.num('c31_before') - 0.4, t.bal(31)::TEXT);
  PERFORM t.check('the RIDER paid nothing', t.bal(15) = t.num('r15_before'));
  PERFORM t.check('the business got 97%', t.biz_bal(100) = t.num('biz_b4') + 0.388);
  PERFORM t.check('IcanEra got 3%', t.biz_bal(900) = t.num('plat_b4') + 0.012);
  PERFORM t.check('the wallet statement says the customer paid',
    EXISTS (SELECT 1 FROM public.ican_business_wallet_transactions WHERE metadata ->> 'paid_by' = 'customer' AND (metadata ->> 'gross_ugx')::NUMERIC = 2000));
  PERFORM t.check('the customer was told by phone', EXISTS (SELECT 1 FROM public.push_log WHERE user_id = t.u(31) AND title = 'Entry fee added to your ride'));
END $$;
SELECT t.login(15);
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_my_gate_passes();
  PERFORM t.check('the rider is asked for nothing and sees she is inside', jsonb_array_length(r -> 'requests') = 0 AND jsonb_array_length(r -> 'inside') = 1
                  AND r #>> '{inside,0,payer}' = 'customer', r::TEXT);
  r := public.mbg_ride_zone_charges(t.zid('ride1'));
  PERFORM t.check('her ride screen shows the fee, paid by the customer, nothing to recover', r ->> 'role' = 'rider' AND r #>> '{charges,0,payer}' = 'customer'
                  AND r #>> '{charges,0,recover_from_customer}' = 'false' AND jsonb_array_length(r -> 'warnings') = 0, r::TEXT);
END $$;
SELECT t.login(31);
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_ride_zone_charges(t.zid('ride1'));
  PERFORM t.check('the customer''s ride screen now shows the charge added to the ride', r ->> 'role' = 'customer' AND (r #>> '{charges,0,fee_ugx}')::NUMERIC = 2000
                  AND r #>> '{charges,0,zone_name}' = 'Estate' AND jsonb_array_length(r -> 'warnings') = 0, r::TEXT);
END $$;
SELECT t.login(5);
DO $$ BEGIN PERFORM t.check('strangers cannot see a ride''s charges', public.mbg_ride_zone_charges(t.zid('ride1')) ->> 'success' = 'false'); END $$;
SELECT t.login(2, 'guard@x.test');
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_gate_check_out(t.zid('estate'), t.code(15));
  PERFORM t.check('leaving: cleared, the fee is already paid', r ->> 'verdict' = 'cleared', r::TEXT);
  r := public.mbg_zone_gate_check_in(t.zid('estate'), t.code(15));
  PERFORM t.check('coming back in on the same ride is free (a "ride pass")', r ->> 'verdict' = 'granted' AND r ->> 'basis' = 'ride_pass', r::TEXT);
  PERFORM public.mbg_zone_gate_check_out(t.zid('estate'), t.code(15));
END $$;
SELECT t.as_admin();
DO $$ BEGIN
  PERFORM t.check('...and nothing more was charged', t.bal(31) = t.num('c31_before') - 0.4);
  UPDATE public.mbg_rides SET status = 'completed' WHERE id = t.zid('ride1');
END $$;

-- ═══ the rider alone pays ═══════════════════════════════════════════════════
SELECT t.login(2, 'guard@x.test');
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_gate_check_in(t.zid('estate'), t.code(15));
  PERFORM t.check('the same rider with the ride over is alone, so she pays', r ->> 'verdict' = 'pay_required' AND r #>> '{visit,payer}' = 'rider'
                  AND r #>> '{visit,ride_id}' IS NULL, r::TEXT);
  PERFORM public.mbg_zone_gate_cancel(t.vid(r));
END $$;

-- ═══ a pickup inside the zone: the rider enters to fetch the customer ═══════
SELECT t.as_admin();
DO $$ DECLARE rd UUID; BEGIN
  rd := t.ride(31, 15, t.num('here_lat'), t.num('here_lng'), t.num('else_lat'), t.num('else_lng'), 'accepted', 'wallet');
  INSERT INTO t.keep VALUES ('ride_pick', rd::TEXT);
END $$;
SELECT t.login(31);
DO $$ BEGIN PERFORM public.mbg_ack_ride_zone_charges(t.zid('ride_pick'), 'motorcycle'); END $$;
SELECT t.login(2, 'guard@x.test');
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_gate_check_in(t.zid('estate'), t.code(15));
  PERFORM t.check('a rider on her way to a pickup inside the zone: the customer pays', r ->> 'verdict' = 'granted' AND r ->> 'payer' = 'customer', r::TEXT);
  PERFORM public.mbg_zone_gate_check_out(t.zid('estate'), t.code(15));
END $$;
SELECT t.as_admin();
DO $$ BEGIN UPDATE public.mbg_rides SET status = 'cancelled' WHERE id = t.zid('ride_pick'); END $$;

-- ═══ a customer who was NOT warned: the rider pays at the gate, the customer is billed in full straight after ═══
SELECT t.as_admin();
DO $$ DECLARE rd UUID; BEGIN
  rd := t.ride(34, 15, t.num('else_lat'), t.num('else_lng'), t.num('here_lat'), t.num('here_lng'), 'in_progress', 'wallet');
  INSERT INTO t.keep VALUES ('ride_noack', rd::TEXT), ('c34_b4', t.bal(34)::TEXT), ('r15_b6', t.bal(15)::TEXT), ('biz_b6', t.biz_bal(100)::TEXT);
END $$;
SELECT t.login(2, 'guard@x.test');
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_gate_check_in(t.zid('estate'), t.code(15));
  PERFORM t.check('no warning was recorded: the rider pays at the gate, so nothing is held up', r ->> 'verdict' = 'pay_required' AND r ->> 'payer' = 'rider'
                  AND r ->> 'recover_from_customer' = 'true' AND r #>> '{visit,payer}' = 'rider', r::TEXT);
  PERFORM t.check('...the visit is tied to the ride, so it can be passed on', r #>> '{visit,ride_id}' = t.zid('ride_noack')::TEXT);
  PERFORM t.check('...the gate is told it is passed on to the customer', r ->> 'message' LIKE '%passed on to the customer%');
  INSERT INTO t.keep VALUES ('v_noack', r #>> '{visit,id}');
END $$;
SELECT t.as_admin();
DO $$ BEGIN PERFORM t.check('nothing is charged until the rider pays', t.bal(34) = t.num('c34_b4') AND t.bal(15) = t.num('r15_b6')); END $$;
SELECT t.login(15);
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_my_gate_passes();
  PERFORM t.check('the rider is told she will be paid back', r #>> '{requests,0,recover_from_customer}' = 'true', r::TEXT);
  r := public.mbg_rider_pay_gate_fee(t.zid('v_noack'));
  PERFORM t.check('the rider pays', r ->> 'success' = 'true' AND r #>> '{visit,status}' = 'inside', r::TEXT);
  PERFORM t.check('...and it is passed on to the customer at once', r ->> 'passed_on' = 'true', r::TEXT);
END $$;
SELECT t.as_admin();
DO $$ BEGIN
  PERFORM t.check('the CUSTOMER bore the whole fee: 0.4 ICAN', t.bal(34) = t.num('c34_b4') - 0.4, t.bal(34)::TEXT);
  PERFORM t.check('the RIDER is back where she started (paid 0.4, got 0.4 back)', t.bal(15) = t.num('r15_b6'), t.bal(15)::TEXT);
  PERFORM t.check('the business still got 97%', t.biz_bal(100) = t.num('biz_b6') + 0.388);
  PERFORM t.check('the visit records what was passed on', (SELECT passed_on_ugx FROM public.mbg_access_visits WHERE id = t.zid('v_noack')) = 2000
                  AND (SELECT passed_on_at FROM public.mbg_access_visits WHERE id = t.zid('v_noack')) IS NOT NULL);
  PERFORM t.check('the customer was told', EXISTS (SELECT 1 FROM public.push_log WHERE user_id = t.u(34) AND title = 'Entry fee added to your ride'));
END $$;
SELECT t.login(34);
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_ride_zone_charges(t.zid('ride_noack'));
  PERFORM t.check('the customer''s ride screen shows the fee, the rider paid it, nothing left to recover', r #>> '{charges,0,payer}' = 'rider'
                  AND (r #>> '{charges,0,passed_on_ugx}')::NUMERIC = 2000 AND r #>> '{charges,0,recover_from_customer}' = 'false', r::TEXT);
END $$;
SELECT t.login(15);
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_ride_zone_charges(t.zid('ride_noack'));
  PERFORM t.check('the rider''s ride screen agrees: nothing to collect', r #>> '{charges,0,recover_from_customer}' = 'false', r::TEXT);
  r := public.mbg_rider_pay_gate_fee(t.zid('v_noack'));
  PERFORM t.check('paying twice is harmless and passes on nothing more', r ->> 'already_paid' = 'true');
END $$;
SELECT t.login(2, 'guard@x.test');
DO $$ BEGIN PERFORM public.mbg_zone_gate_check_out(t.zid('estate'), t.code(15)); END $$;
SELECT t.as_admin();
DO $$ BEGIN
  PERFORM t.check('...the customer was billed once', t.bal(34) = t.num('c34_b4') - 0.4);
  UPDATE public.mbg_rides SET status = 'cancelled' WHERE id = t.zid('ride_noack');
END $$;

-- ═══ the same, on a cash ride: nothing to take from a wallet, the rider collects it from the customer ═══
DO $$ DECLARE rd UUID; BEGIN
  rd := t.ride(34, 15, t.num('else_lat'), t.num('else_lng'), t.num('here_lat'), t.num('here_lng'), 'in_progress', 'cash');
  INSERT INTO t.keep VALUES ('ride_noack_cash', rd::TEXT), ('c34_b7', t.bal(34)::TEXT), ('r15_b7', t.bal(15)::TEXT);
END $$;
SELECT t.login(2, 'guard@x.test');
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_gate_check_in(t.zid('estate'), t.code(15));
  INSERT INTO t.keep VALUES ('v_noack_cash', r #>> '{visit,id}');
END $$;
SELECT t.login(15);
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_rider_pay_gate_fee(t.zid('v_noack_cash'));
  PERFORM t.check('cash ride, customer not warned: the rider pays', r ->> 'success' = 'true', r::TEXT);
  PERFORM t.check('...it is NOT passed on to a wallet (the customer pays cash)', r ->> 'passed_on' = 'false' AND r ->> 'recover_from_customer' = 'true', r::TEXT);
  r := public.mbg_ride_zone_charges(t.zid('ride_noack_cash'));
  PERFORM t.check('...her ride screen says to collect it from the customer', r #>> '{charges,0,recover_from_customer}' = 'true', r::TEXT);
END $$;
SELECT t.login(34);
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_ride_zone_charges(t.zid('ride_noack_cash'));
  PERFORM t.check('the customer''s ride screen says the rider paid and to pay them back', r #>> '{charges,0,payer}' = 'rider' AND r #>> '{charges,0,recover_from_customer}' = 'true', r::TEXT);
END $$;
SELECT t.as_admin();
DO $$ BEGIN
  PERFORM t.check('no wallet moved for the cash ride (the customer pays the rider in cash)', t.bal(34) = t.num('c34_b7'));
  PERFORM t.check('...except the rider''s own 0.4 ICAN for the gate, which she gets back in cash from the customer', t.bal(15) = t.num('r15_b7') - 0.4);
  PERFORM t.check('the customer was told to pay the rider back', EXISTS (SELECT 1 FROM public.push_log WHERE user_id = t.u(34) AND title = 'Entry fee on your ride'));
END $$;
SELECT t.login(2, 'guard@x.test');
DO $$ BEGIN PERFORM public.mbg_zone_gate_check_out(t.zid('estate'), t.code(15)); END $$;
SELECT t.as_admin();
DO $$ BEGIN UPDATE public.mbg_rides SET status = 'cancelled' WHERE id = t.zid('ride_noack_cash'); END $$;

-- ═══ the fee rose after the warning: the rider pays, the customer is billed the full new fee ═══
DO $$ DECLARE rd UUID; BEGIN
  rd := t.ride(35, 15, t.num('else_lat'), t.num('else_lng'), t.num('here_lat'), t.num('here_lng'), 'in_progress', 'wallet');
  INSERT INTO t.keep VALUES ('ride_raise', rd::TEXT), ('c35_b4', t.bal(35)::TEXT), ('r15_b8', t.bal(15)::TEXT);
END $$;
SELECT t.login(35);
DO $$ BEGIN PERFORM public.mbg_ack_ride_zone_charges(t.zid('ride_raise'), 'motorcycle'); END $$;
SELECT t.login(1);
DO $$ BEGIN PERFORM t.zone_here(3000); END $$;
SELECT t.login(2, 'guard@x.test');
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_gate_check_in(t.zid('estate'), t.code(15));
  PERFORM t.check('2,000 shown, 3,000 now: the rider pays at the gate (not the customer''s wallet directly)', r ->> 'verdict' = 'pay_required'
                  AND r #>> '{visit,payer}' = 'rider' AND (r ->> 'fee_ugx')::NUMERIC = 3000, r::TEXT);
  INSERT INTO t.keep VALUES ('v_raise', r #>> '{visit,id}');
END $$;
SELECT t.login(15);
DO $$ BEGIN PERFORM public.mbg_rider_pay_gate_fee(t.zid('v_raise')); END $$;
SELECT t.as_admin();
DO $$ BEGIN
  PERFORM t.check('...and the customer is billed the whole 3,000 straight after (0.6 ICAN)', t.bal(35) = t.num('c35_b4') - 0.6, t.bal(35)::TEXT);
  PERFORM t.check('...the rider is whole again', t.bal(15) = t.num('r15_b8'));
END $$;
SELECT t.login(2, 'guard@x.test');
DO $$ BEGIN PERFORM public.mbg_zone_gate_check_out(t.zid('estate'), t.code(15)); END $$;
SELECT t.login(1);
DO $$ BEGIN PERFORM t.zone_here(2000); END $$;
SELECT t.as_admin();
DO $$ BEGIN UPDATE public.mbg_rides SET status = 'cancelled' WHERE id = t.zid('ride_raise'); END $$;

-- ═══ an approved rider with a customer: free for everyone ═══════════════════
DO $$ DECLARE rd UUID; BEGIN
  rd := t.ride(31, 11, t.num('else_lat'), t.num('else_lng'), t.num('here_lat'), t.num('here_lng'), 'in_progress', 'wallet');
  INSERT INTO t.keep VALUES ('ride_member', rd::TEXT), ('c31_b5', t.bal(31)::TEXT);
END $$;
SELECT t.login(31);
DO $$ BEGIN PERFORM public.mbg_ack_ride_zone_charges(t.zid('ride_member'), 'motorcycle'); END $$;
SELECT t.login(2, 'guard@x.test');
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_gate_check_in(t.zid('estate'), t.code(11));
  PERFORM t.check('an approved rider walks in free, with or without a customer', r ->> 'verdict' = 'granted' AND r ->> 'basis' = 'member', r::TEXT);
  PERFORM public.mbg_zone_gate_check_out(t.zid('estate'), t.code(11));
END $$;
SELECT t.as_admin();
DO $$ BEGIN
  PERFORM t.check('...and the customer pays nothing', t.bal(31) = t.num('c31_b5'));
  UPDATE public.mbg_rides SET status = 'completed' WHERE id = t.zid('ride_member');
END $$;

-- ═══ a cash ride, and this zone takes no cash: the rider fronts it and is told to recover it ═══
DO $$ DECLARE rd UUID; BEGIN
  rd := t.ride(32, 16, t.num('else_lat'), t.num('else_lng'), t.num('here_lat'), t.num('here_lng'), 'in_progress', 'cash');
  INSERT INTO t.keep VALUES ('ride_cash', rd::TEXT);
END $$;
SELECT t.login(32);
DO $$ BEGIN PERFORM public.mbg_ack_ride_zone_charges(t.zid('ride_cash'), 'motorcycle'); END $$;
SELECT t.login(2, 'guard@x.test');
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_gate_check_in(t.zid('estate'), t.code(16));
  PERFORM t.check('cash ride at a zone without cash: the rider fronts it', r ->> 'verdict' = 'pay_required' AND r ->> 'payer' = 'rider'
                  AND r ->> 'recover_from_customer' = 'true' AND r #>> '{visit,payer}' = 'rider', r::TEXT);
  INSERT INTO t.keep VALUES ('v16_cash', r #>> '{visit,id}');
END $$;
SELECT t.login(16);
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_my_gate_passes();
  PERFORM t.check('the rider is shown the request, flagged to collect it from the customer', jsonb_array_length(r -> 'requests') = 1
                  AND r #>> '{requests,0,recover_from_customer}' = 'true', r::TEXT);
  r := public.mbg_ride_zone_charges(t.zid('ride_cash'));
  PERFORM t.check('her ride screen says the same', r #>> '{charges,0,recover_from_customer}' = 'true', r::TEXT);
END $$;
SELECT t.login(2, 'guard@x.test');
DO $$ BEGIN PERFORM public.mbg_zone_gate_cancel(t.zid('v16_cash')); END $$;

-- ═══ the same cash ride at a zone that takes cash: the customer pays the gate ═══
SELECT t.login(1);
DO $$ BEGIN PERFORM t.zone_here(2000, true); END $$;
SELECT t.login(2, 'guard@x.test');
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_gate_check_in(t.zid('estate'), t.code(16));
  PERFORM t.check('cash ride at a cash zone: the CUSTOMER pays the gate, not the rider', r ->> 'verdict' = 'pay_required' AND r ->> 'payer' = 'customer'
                  AND r ->> 'can_collect_cash' = 'true' AND r ->> 'message' LIKE '%CUSTOMER pays%', r::TEXT);
  INSERT INTO t.keep VALUES ('v16_cust', r #>> '{visit,id}');
END $$;
SELECT t.login(16);
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_my_gate_passes();
  PERFORM t.check('the rider is not asked to pay it', jsonb_array_length(r -> 'requests') = 0 AND jsonb_array_length(r -> 'customer_pays') = 1, r::TEXT);
  r := public.mbg_rider_pay_gate_fee(t.zid('v16_cust'));
  PERFORM t.check('...and cannot pay it by mistake', r ->> 'success' = 'false' AND r ->> 'error' LIKE '%customer pays%', r::TEXT);
END $$;
SELECT t.login(2, 'guard@x.test');
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_gate_collect_cash(t.zid('v16_cust'));
  PERFORM t.check('the gate takes the passenger''s cash', r ->> 'success' = 'true' AND r #>> '{visit,status}' = 'inside' AND r #>> '{visit,payer}' = 'customer'
                  AND r #>> '{visit,payment_method}' = 'cash', r::TEXT);
  PERFORM public.mbg_zone_gate_check_out(t.zid('estate'), t.code(16));
END $$;
SELECT t.as_admin();
DO $$ BEGIN PERFORM t.check('nobody''s wallet moved for the cash fee', t.bal(16) = 0.1 AND t.bal(32) = 10);
  UPDATE public.mbg_rides SET status = 'completed' WHERE id = t.zid('ride_cash'); END $$;

-- ═══ a wallet ride whose customer cannot cover it: nothing moves, the customer pays cash ═══
DO $$ DECLARE rd UUID; BEGIN
  rd := t.ride(33, 21, t.num('else_lat'), t.num('else_lng'), t.num('here_lat'), t.num('here_lng'), 'in_progress', 'wallet');
  INSERT INTO t.keep VALUES ('ride_short', rd::TEXT), ('r21_b4', t.bal(21)::TEXT);
END $$;
SELECT t.login(33);
DO $$ BEGIN PERFORM public.mbg_ack_ride_zone_charges(t.zid('ride_short'), 'motorcycle'); END $$;
SELECT t.login(2, 'guard@x.test');
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_gate_check_in(t.zid('estate'), t.code(21));
  PERFORM t.check('a customer whose wallet is short pays the gate in cash instead', r ->> 'verdict' = 'pay_required' AND r ->> 'payer' = 'customer'
                  AND r ->> 'can_collect_cash' = 'true', r::TEXT);
  PERFORM public.mbg_zone_gate_cancel(t.vid(r));
END $$;
SELECT t.as_admin();
DO $$ BEGIN
  PERFORM t.check('...the wallets are as they were', t.bal(33) = 0.1 AND t.bal(21) = t.num('r21_b4'));
  UPDATE public.mbg_rides SET status = 'cancelled' WHERE id = t.zid('ride_short');
END $$;
SELECT t.login(1);
DO $$ BEGIN PERFORM t.zone_here(2000, false); END $$;

-- ═══ still true after all of this ═══════════════════════════════════════════
SELECT t.as_admin();
DO $$ BEGIN
  PERFORM t.check('no visit ever has more paid than due',
    NOT EXISTS (SELECT 1 FROM public.mbg_access_visits WHERE status NOT IN ('denied', 'cancelled') AND fee_paid_ugx > fee_due_ugx));
  PERFORM t.check('no vehicle is inside one zone twice',
    NOT EXISTS (SELECT 1 FROM public.mbg_access_visits WHERE status IN ('inside', 'awaiting_payment') GROUP BY zone_id, rider_id HAVING count(*) > 1));
  PERFORM t.check('IcanEra''s ledger still matches its wallet', (SELECT sum(amount_ican) FROM public.platform_fee_log) = t.biz_bal(900));
  PERFORM t.check('a visit carrying a ride fee always names its ride', NOT EXISTS (SELECT 1 FROM public.mbg_access_visits WHERE payer = 'customer' AND ride_id IS NULL));
END $$;

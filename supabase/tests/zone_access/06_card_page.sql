\set ON_ERROR_STOP on
-- The rider's public card page runs the gate: 20261111100000_zone_gate_from_card_page.sql.
-- Runs after 02c_customer_pays.sql on the same data, in a zone of its own ("Peek lab") so nothing earlier is in the way.
-- The point of most checks here: the preview (mbg_zone_gate_peek) must say what the real scan then does, every time.

CREATE FUNCTION t.visits(p_zone UUID) RETURNS INT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT count(*)::INT FROM public.mbg_access_visits WHERE zone_id = p_zone $$;
GRANT EXECUTE ON FUNCTION t.visits(UUID) TO PUBLIC;

-- preview, check it changed nothing, then scan for real and compare. p_verdicts lists the scan results that are right for that preview.
CREATE FUNCTION t.agree(p_label TEXT, p_zone UUID, p_rider INT, p_outcome TEXT, p_verdicts TEXT[]) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v_before INT; v_peek JSONB; v_scan JSONB;
BEGIN
  v_before := t.visits(p_zone);
  v_peek := public.mbg_zone_gate_peek(p_zone, t.code(p_rider));
  PERFORM t.check(p_label || ': the preview says ' || p_outcome, v_peek ->> 'outcome' = p_outcome, v_peek::TEXT);
  PERFORM t.check(p_label || ': the preview wrote nothing', t.visits(p_zone) = v_before);
  v_scan := public.mbg_zone_gate_scan(p_zone, t.code(p_rider), 'auto');
  PERFORM t.check(p_label || ': the real scan agrees (' || (v_scan ->> 'verdict') || ')', v_scan ->> 'verdict' = ANY (p_verdicts), v_scan::TEXT);
  RETURN v_peek || jsonb_build_object('scan', v_scan);
END $$;
GRANT EXECUTE ON FUNCTION t.agree(TEXT, UUID, INT, TEXT, TEXT[]) TO PUBLIC;

-- ═══ the lab: a paying zone on the map that takes cash ═══════════════════════
SELECT t.login(1);
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_upsert(t.u(100), NULL, 'Peek lab', 'estate', 'Plot 9, Kololo', 'active', 'paid_entry', 'per_entry', true, false, NULL, 0, 10,
                              'Africa/Kampala', '{"motorcycle": 2000, "car": 5000, "truck": 0}'::JSONB, 0.50, 32.70, 300);
  PERFORM t.check('the lab zone is created', r ->> 'success' = 'true', r::TEXT);
  INSERT INTO t.keep VALUES ('lab', r ->> 'zone_id'), ('lab_lat', '0.5009'), ('lab_lng', '32.7000');
  -- rider 11 is approved staff here; rider 21 was approved and then suspended
  r := public.mbg_zone_member_add(t.zid('lab'), t.u(1011), 'staff', NULL, NULL, NULL, 'Security supervisor');
  PERFORM t.check('rider 11 is approved at the lab', r ->> 'success' = 'true', r::TEXT);
  r := public.mbg_zone_member_add(t.zid('lab'), t.u(1021), 'contractor', NULL, NULL, NULL, NULL);
  PERFORM public.mbg_zone_member_set_status((r ->> 'member_id')::UUID, 'suspended');
END $$;

-- ═══ which zones may this person run the gate for? ══════════════════════════
SELECT t.login(2, 'guard@x.test');
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_my_gate_zones();
  PERFORM t.check('the guard is offered the business''s zones', r ->> 'success' = 'true' AND jsonb_array_length(r -> 'zones') >= 6, r::TEXT);
  PERFORM t.check('...including the lab, with the business name, fees and cash',
    EXISTS (SELECT 1 FROM jsonb_array_elements(r -> 'zones') z
             WHERE z ->> 'name' = 'Peek lab' AND z ->> 'business_name' = 'Kololo Heights Estate' AND z ->> 'accept_cash' = 'true'
               AND (z #>> '{fees,motorcycle}')::NUMERIC = 2000), r::TEXT);
END $$;
SELECT t.login(6, 'admin@x.test');
DO $$ BEGIN PERFORM t.check('a CMMS administrator is offered them too', jsonb_array_length(public.mbg_my_gate_zones() -> 'zones') >= 6); END $$;
SELECT t.login(1);
DO $$ BEGIN PERFORM t.check('so is the business owner', jsonb_array_length(public.mbg_my_gate_zones() -> 'zones') >= 6); END $$;
SELECT t.login(3, 'viewer@x.test');
DO $$ BEGIN PERFORM t.check('a role that can only view is offered none', jsonb_array_length(public.mbg_my_gate_zones() -> 'zones') = 0); END $$;
SELECT t.login(4, 'manager@x.test');
DO $$ BEGIN PERFORM t.check('nor a role that edits and assigns but does not run the gate', jsonb_array_length(public.mbg_my_gate_zones() -> 'zones') = 0); END $$;
SELECT t.login(5);
DO $$ BEGIN PERFORM t.check('a stranger is offered none', jsonb_array_length(public.mbg_my_gate_zones() -> 'zones') = 0); END $$;
SELECT t.as_anon();
DO $$ BEGIN
  PERFORM t.check('the signed-out visitor of the public card page cannot list zones', t.raises('SELECT public.mbg_my_gate_zones()'));
  PERFORM t.check('...or preview a scan', t.raises('SELECT public.mbg_zone_gate_peek(t.zid(''lab''), t.code(11))'));
END $$;

-- who may preview
SELECT t.login(3, 'viewer@x.test');
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_gate_peek(t.zid('lab'), t.code(11));
  PERFORM t.check('a view-only role cannot preview a scan', r ->> 'success' = 'false' AND r ->> 'error' LIKE '%cannot run the gate%', r::TEXT);
END $$;
SELECT t.login(5);
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_gate_peek(t.zid('lab'), t.code(11));
  PERFORM t.check('nor can a stranger', r ->> 'success' = 'false', r::TEXT);
END $$;

-- ═══ every preview against the real scan ════════════════════════════════════
SELECT t.login(2, 'guard@x.test');
DO $$ DECLARE r JSONB; z UUID := t.zid('lab'); BEGIN
  -- approved: free
  r := t.agree('approved vehicle', z, 11, 'free', ARRAY['granted']);
  PERFORM t.check('...basis member, with who approved it', r ->> 'basis' = 'member' AND r #>> '{member,kind}' = 'staff' AND r ->> 'action' = 'in', r::TEXT);
  PERFORM t.check('...and the rider''s public details for the gate', r #>> '{rider,plate_number}' = 'UAB 123X' AND r #>> '{rider,vehicle_type}' = 'motorcycle', r::TEXT);

  -- inside now: the next scan is check-out, and it clears
  r := t.agree('the same vehicle again', z, 11, 'inside', ARRAY['cleared']);
  PERFORM t.check('...the action is out', r ->> 'action' = 'out');

  -- not approved: pays, by class
  r := public.mbg_zone_gate_peek(z, t.code(15));
  PERFORM t.check('not approved: must pay UGX 2,000 and the rider is alone, so the rider pays', r ->> 'outcome' = 'pay' AND (r ->> 'fee_ugx')::NUMERIC = 2000
                  AND r ->> 'payer' = 'rider' AND r ->> 'action' = 'in' AND (r ->> 'fee_ican')::NUMERIC = 0.4 AND r ->> 'can_collect_cash' = 'true', r::TEXT);
  r := t.agree('not approved boda', z, 15, 'pay', ARRAY['pay_required']);
  INSERT INTO t.keep VALUES ('lab_v15', r #>> '{scan,visit,id}');

  -- a request is out: the preview says to wait, and the scan says so too
  r := t.agree('a fee already asked for', z, 15, 'awaiting', ARRAY['pay_required']);
  PERFORM t.check('...the action is wait, with the amount and the visit to follow', r ->> 'action' = 'wait' AND (r ->> 'fee_ugx')::NUMERIC = 2000
                  AND r #>> '{visit,status}' = 'awaiting_payment', r::TEXT);
  PERFORM public.mbg_zone_gate_cancel(t.zid('lab_v15'));

  r := t.agree('a car', z, 12, 'pay', ARRAY['pay_required']);
  PERFORM t.check('...pays the car rate', (r ->> 'fee_ugx')::NUMERIC = 5000, r::TEXT);
  PERFORM public.mbg_zone_gate_cancel(t.vid(r -> 'scan'));
  r := t.agree('a truck (no fee set)', z, 13, 'free', ARRAY['granted']);
  PERFORM t.check('...enters free, basis open', r ->> 'basis' = 'open', r::TEXT);
  PERFORM t.agree('the truck leaving', z, 13, 'inside', ARRAY['cleared']);
  r := t.agree('a bicycle (the zone does not accept it)', z, 14, 'refused', ARRAY['denied']);
  PERFORM t.check('...and says why', r ->> 'reason' = 'vehicle_not_allowed' AND r ->> 'action' = 'none', r::TEXT);

  -- approved once, suspended since: treated as not approved, and the gate is told why
  r := t.agree('an approved vehicle that was suspended', z, 21, 'pay', ARRAY['pay_required']);
  PERFORM t.check('...pays like anyone else, and the gate is told it was suspended', r ->> 'note' LIKE '%suspended%' AND (r ->> 'fee_ugx')::NUMERIC = 2000, r::TEXT);
  PERFORM t.check('...and the expired driving permit is a warning, not a refusal', r -> 'warnings' @> '["The driving permit has expired."]'::JSONB, r::TEXT);
  PERFORM public.mbg_zone_gate_cancel(t.vid(r -> 'scan'));

  -- a card that is no good
  r := t.agree('an unactivated card', z, 17, 'refused', ARRAY['denied']);
  PERFORM t.check('...says why', r ->> 'reason' = 'card_unpaid', r::TEXT);
  r := t.agree('an expired card', z, 18, 'refused', ARRAY['denied']);
  PERFORM t.check('...says why', r ->> 'reason' = 'card_expired', r::TEXT);
  r := t.agree('a suspended rider', z, 19, 'refused', ARRAY['denied']);
  PERFORM t.check('...says why', r ->> 'reason' = 'rider_suspended', r::TEXT);
  r := t.agree('a cancelled card', z, 20, 'refused', ARRAY['denied']);
  PERFORM t.check('...says why', r ->> 'reason' = 'card_cancelled', r::TEXT);
  PERFORM t.check('a cancelled card shows nothing about the rider (the same rule as the QR page)', public.mbg_zone_gate_peek(z, t.code(20)) -> 'rider' IS NULL
                  AND public.mbg_zone_gate_peek(z, t.code(20)) ->> 'card_number' = 'ICN-20');

  -- a code that is not a card at all
  r := public.mbg_zone_gate_peek(z, 'NOTACARD0000');
  PERFORM t.check('an unknown code is refused', r ->> 'outcome' = 'refused' AND r ->> 'reason' = 'unknown_card' AND (r ->> 'found') = 'false', r::TEXT);
  r := public.mbg_zone_gate_peek(z, 'https://bodagoera.icanera.space/rider-card/' || t.code(11));
  PERFORM t.check('the whole link works as well as the bare code', r ->> 'found' = 'true' AND r #>> '{rider,plate_number}' = 'UAB 123X', r::TEXT);
END $$;

-- ═══ a customer on the ride ═════════════════════════════════════════════════
SELECT t.as_admin();
DO $$ DECLARE rd UUID; BEGIN
  -- rider 12 (car) with customer 31, warned at booking; rider 16 with customer 32, never warned
  rd := t.ride(31, 12, t.num('else_lat'), t.num('else_lng'), t.num('lab_lat'), t.num('lab_lng'), 'in_progress', 'wallet');
  INSERT INTO t.keep VALUES ('lab_ride_warned', rd::TEXT);
  rd := t.ride(32, 16, t.num('else_lat'), t.num('else_lng'), t.num('lab_lat'), t.num('lab_lng'), 'in_progress', 'wallet');
  INSERT INTO t.keep VALUES ('lab_ride_unwarned', rd::TEXT);
END $$;
SELECT t.login(31);
DO $$ BEGIN PERFORM public.mbg_ack_ride_zone_charges(t.zid('lab_ride_warned'), 'car'); END $$;
SELECT t.login(2, 'guard@x.test');
DO $$ DECLARE r JSONB; z UUID := t.zid('lab'); BEGIN
  r := public.mbg_zone_gate_peek(z, t.code(12));
  PERFORM t.check('a customer who was warned pays, not the rider', r ->> 'outcome' = 'pay' AND r ->> 'payer' = 'customer' AND (r ->> 'fee_ugx')::NUMERIC = 5000
                  AND r ->> 'message' LIKE '%CUSTOMER pays%', r::TEXT);
  r := public.mbg_zone_gate_peek(z, t.code(16));
  PERFORM t.check('a customer who was not warned: the rider pays now and it is passed on', r ->> 'outcome' = 'pay' AND r ->> 'payer' = 'rider_then_customer'
                  AND (r ->> 'fee_ugx')::NUMERIC = 2000 AND r ->> 'message' LIKE '%passed on%', r::TEXT);
  -- and the real scans do exactly that
  r := public.mbg_zone_gate_scan(z, t.code(12), 'auto');
  PERFORM t.check('the real scan charges the customer''s wallet as part of the ride', r ->> 'verdict' = 'granted' AND r ->> 'payer' = 'customer', r::TEXT);
  r := public.mbg_zone_gate_scan(z, t.code(16), 'auto');
  PERFORM t.check('the real scan asks the rider and says it is passed on', r ->> 'verdict' = 'pay_required' AND r ->> 'payer' = 'rider'
                  AND r ->> 'recover_from_customer' = 'true', r::TEXT);
  PERFORM public.mbg_zone_gate_cancel(t.vid(r));
  -- one entry per ride per zone: the car leaves, comes back on the same ride: free
  PERFORM t.agree('the car leaving', z, 12, 'inside', ARRAY['cleared']);
  r := t.agree('the car coming back on the same ride', z, 12, 'free', ARRAY['granted']);
  PERFORM t.check('...the ride''s fee was already paid', r ->> 'basis' = 'ride_pass', r::TEXT);
  PERFORM t.agree('the car leaving again', z, 12, 'inside', ARRAY['cleared']);
END $$;
SELECT t.as_admin();
DO $$ BEGIN UPDATE public.mbg_rides SET status = 'completed' WHERE id IN (t.zid('lab_ride_warned'), t.zid('lab_ride_unwarned')); END $$;

-- ═══ money owed on the way out, and a zone that closed with a vehicle inside ═
SELECT t.login(1);
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_upsert(t.u(100), t.zid('lab'), 'Peek lab', 'estate', 'Plot 9, Kololo', 'active', 'paid_entry', 'per_entry', true, false, 60, 1000, 10,
                              'Africa/Kampala', '{"motorcycle": 2000, "car": 5000, "truck": 0}'::JSONB, 0.50, 32.70, 300);
  PERFORM t.check('the lab now has a one-hour limit and an overstay fee', r ->> 'success' = 'true', r::TEXT);
END $$;
SELECT t.login(2, 'guard@x.test');
DO $$ DECLARE r JSONB; v UUID; BEGIN
  r := public.mbg_zone_gate_scan(t.zid('lab'), t.code(15), 'in');
  v := t.vid(r);
  PERFORM public.mbg_zone_gate_collect_cash(v);
  PERFORM t.check('rider 15 pays the gate in cash and is inside', (public.mbg_zone_visit_status(v) #>> '{visit,status}') = 'inside');
  INSERT INTO t.keep VALUES ('lab_v15b', v::TEXT);
END $$;
SELECT t.as_admin();
UPDATE public.mbg_access_visits SET entered_at = now() - INTERVAL '3 hours 10 minutes' WHERE id = t.zid('lab_v15b');
SELECT t.login(2, 'guard@x.test');
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_gate_peek(t.zid('lab'), t.code(15));
  PERFORM t.check('overstayed: the preview says the vehicle is inside and what is still due',
    r ->> 'outcome' = 'inside' AND r ->> 'action' = 'out' AND (r #>> '{visit,balance_ugx}')::NUMERIC > 0 AND r ->> 'message' LIKE '%still due%', r::TEXT);
  r := public.mbg_zone_gate_scan(t.zid('lab'), t.code(15), 'auto');
  PERFORM t.check('...and the real scan holds it', r ->> 'verdict' = 'balance_due' AND (r ->> 'balance_ugx')::NUMERIC > 0, r::TEXT);
  PERFORM public.mbg_zone_gate_collect_cash(t.vid(r));
  r := t.agree('after paying the overstay', t.zid('lab'), 15, 'inside', ARRAY['cleared']);
  PERFORM t.check('...nothing is owed', r ->> 'message' LIKE '%Nothing is owed%', r::TEXT);
END $$;

-- a vehicle is inside when the zone is closed: it can still leave, and nothing new gets in
SELECT t.login(2, 'guard@x.test');
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_gate_scan(t.zid('lab'), t.code(13), 'in');
  PERFORM t.check('the truck gets in before the zone closes', r ->> 'verdict' = 'granted', r::TEXT);
END $$;
SELECT t.login(1);
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_upsert(t.u(100), t.zid('lab'), 'Peek lab', 'estate', 'Plot 9, Kololo', 'closed', 'paid_entry', 'per_entry', true, false, 60, 1000, 10,
                              'Africa/Kampala', '{"motorcycle": 2000, "car": 5000, "truck": 0}'::JSONB, 0.50, 32.70, 300);
  PERFORM t.check('the zone is closed', r ->> 'success' = 'true', r::TEXT);
END $$;
SELECT t.login(2, 'guard@x.test');
DO $$ BEGIN
  PERFORM t.check('a closed zone is still offered, marked closed', (SELECT z ->> 'status' FROM jsonb_array_elements(public.mbg_my_gate_zones() -> 'zones') z
                                                                     WHERE z ->> 'name' = 'Peek lab') = 'closed');
  PERFORM t.check('...and every closed zone is listed after every open one', NOT EXISTS (
    WITH e AS (SELECT z ->> 'status' AS status, n FROM jsonb_array_elements(public.mbg_my_gate_zones() -> 'zones') WITH ORDINALITY AS x(z, n))
    SELECT 1 FROM e a, e b WHERE a.status = 'active' AND b.status <> 'active' AND a.n > b.n));
END $$;
DO $$ DECLARE r JSONB; BEGIN
  r := t.agree('a vehicle arriving at the closed zone', t.zid('lab'), 14, 'refused', ARRAY['denied']);
  PERFORM t.check('...is refused, and the reason is that the zone is closed', r ->> 'reason' = 'zone_closed', r::TEXT);
  r := public.mbg_zone_gate_peek(t.zid('lab'), t.code(15));
  PERFORM t.check('a vehicle that is not approved is refused too', r ->> 'outcome' = 'refused' AND r ->> 'reason' = 'zone_closed' AND r ->> 'action' = 'none', r::TEXT);
  r := t.agree('the truck that was already inside', t.zid('lab'), 13, 'inside', ARRAY['cleared']);
  PERFORM t.check('...can still leave', r ->> 'action' = 'out', r::TEXT);
END $$;

-- ═══ the real scans of all this are in the log, and the books balance ═══════
SELECT t.as_admin();
DO $$ BEGIN
  PERFORM t.check('no visit ever has more paid than due',
    NOT EXISTS (SELECT 1 FROM public.mbg_access_visits WHERE status NOT IN ('denied', 'cancelled') AND fee_paid_ugx > fee_due_ugx));
  PERFORM t.check('no vehicle is inside one zone twice',
    NOT EXISTS (SELECT 1 FROM public.mbg_access_visits WHERE status IN ('inside', 'awaiting_payment') GROUP BY zone_id, rider_id HAVING count(*) > 1));
  PERFORM t.check('IcanEra''s ledger still matches its wallet', (SELECT sum(amount_ican) FROM public.platform_fee_log) = t.biz_bal(900));
END $$;

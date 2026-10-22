-- ============================================================================
-- Restricted zones: run the gate from the rider's public card page
--
-- THE IDEA
--   The QR on a rider's ID card opens https://bodagoera.icanera.space/rider-card/<code>, a public page that anyone may
--   open to see that the card is genuine. Until now it knew nothing about restricted zones: the gate had to paste the code
--   into the gate desk in ICAN CMMS. Now the staff member who scans the card with an ordinary phone camera lands on that
--   page, signs in, and the page itself runs the gate:
--
--     approved vehicle ... "Approved staff - free", one tap to check in
--     not approved ....... "Entry fee UGX 2,000", one tap asks the rider (or the customer on the ride) to pay
--     already inside ..... "Check out", which only clears when everything is paid
--
--   Nobody else sees any of it. The page is still public, and still shows exactly what it showed before; the gate panel
--   appears only for a signed-in person whose CMMS role has Transport > gate (or who owns / administers the business).
--
-- WHAT THIS ADDS (two functions; nothing is created or changed in any table)
--   mbg_my_gate_zones()              the zones the signed-in person may run the gate for, across every business they work
--                                    for - the page needs this because, unlike the gate desk in CMMS, it is not opened from
--                                    inside one company
--   mbg_zone_gate_peek(zone, code)   a READ-ONLY preview of what scanning this card at this zone would do: who the rider is,
--                                    approved or not, what it would cost and who would pay, or that it is inside and leaving.
--                                    It mirrors mbg_zone_gate_check_in / _check_out decision by decision and writes nothing
--                                    (a test runs every preview against the real scan to keep them from drifting apart).
--   The page then calls the functions that already exist: mbg_zone_gate_scan, mbg_zone_visit_status,
--   mbg_zone_gate_collect_cash, mbg_zone_gate_cancel.
--
-- Needs 20261110100000_restricted_zone_access.sql (RESTRICTED_ZONE_ACCESS_PASTE_INTO_SUPABASE.sql). Safe to run twice.
-- Roll back with supabase/rollback/20261111_rollback_zone_gate_from_card_page.sql.
-- ============================================================================

DO $guard$
BEGIN
  IF to_regprocedure('public.mbg_zone_gate_scan(uuid,text,text,text,text)') IS NULL
     OR to_regprocedure('public.mbg_zone_read_card(text)') IS NULL
     OR to_regprocedure('public.mbg_zone_staff_can(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'Run RESTRICTED_ZONE_ACCESS_PASTE_INTO_SUPABASE.sql (20261110100000_restricted_zone_access.sql) first: the restricted-zone functions are not installed yet.';
  END IF;
END
$guard$;


-- ─── 1. Which zones may this person run the gate for? ───────────────────────

-- Every zone (closed ones included: a vehicle already inside a closed zone must still be checked out) of every business the
-- caller may run the gate for. Closed zones are listed last and say so.
CREATE OR REPLACE FUNCTION public.mbg_my_gate_zones() RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Please sign in'); END IF;
  RETURN jsonb_build_object('success', true, 'zones', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'id', z.id, 'name', z.name, 'kind', z.kind, 'location', z.location, 'status', z.status,
             'business_profile_id', z.business_profile_id, 'business_name', bp.business_name,
             'entry_mode', z.entry_mode, 'fee_basis', z.fee_basis, 'accept_cash', z.accept_cash,
             'fees', COALESCE((SELECT jsonb_object_agg(f.vehicle_type, f.fee_ugx) FROM public.mbg_access_zone_fees f WHERE f.zone_id = z.id), '{}'::JSONB),
             'inside_count', (SELECT count(*) FROM public.mbg_access_visits v WHERE v.zone_id = z.id AND v.status = 'inside'))
           ORDER BY (z.status <> 'active'), bp.business_name, z.name)
      FROM public.mbg_access_zones z
      JOIN public.business_profiles bp ON bp.id = z.business_profile_id
     WHERE public.mbg_zone_staff_can(z.business_profile_id, 'gate')), '[]'::JSONB));
END;
$$;


-- ─── 2. What would scanning this card here do? ──────────────────────────────

-- Needs 'gate' for the zone. Never writes a visit, never asks anyone for money, never sends an alert.
--   outcome  inside     the vehicle is in: the next scan is Check out                       (action 'out')
--            awaiting   a fee has been asked for and not paid yet                           (action 'wait')
--            free       it gets in without paying; 'basis' says why (member, open, day_pass, ride_pass)  (action 'in')
--            pay        it must pay first; 'fee_ugx' and 'payer' say how much and who      (action 'in')
--            refused    it will not be let in; 'reason' says why                           (action 'none')
--   payer    rider                alone: the rider pays
--            customer             a customer is on the ride and was warned: the customer pays
--            rider_then_customer  a customer is on the ride but was not warned: the rider pays now, it is passed on to them
CREATE OR REPLACE FUNCTION public.mbg_zone_gate_peek(p_zone_id UUID, p_code TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_zone   public.mbg_access_zones;
  v_card   JSONB;
  v_p      JSONB;
  v_rider  JSONB;
  v_warn   JSONB;
  v_open   public.mbg_access_visits;
  v_has_open BOOLEAN;
  v_member public.mbg_access_zone_members;
  v_mstate TEXT;
  v_type   TEXT;
  v_reason TEXT;
  v_fee    NUMERIC;
  v_ride   RECORD;
  v_out    JSONB;
  v_note   TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Please sign in'); END IF;
  SELECT * INTO v_zone FROM public.mbg_access_zones WHERE id = p_zone_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Zone not found'); END IF;
  IF NOT public.mbg_zone_staff_can(v_zone.business_profile_id, 'gate') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Your role cannot run the gate for this zone');
  END IF;
  PERFORM public.mbg_zone_expire_stale();

  v_card := public.mbg_zone_read_card(p_code);
  IF NOT COALESCE((v_card ->> 'found')::BOOLEAN, false) THEN
    RETURN jsonb_build_object('success', true, 'found', false, 'outcome', 'refused', 'action', 'none', 'reason', 'unknown_card',
                              'message', public.mbg_zone_deny_message('unknown_card', NULL));
  END IF;
  v_p     := v_card -> 'payload';
  v_type  := v_p ->> 'vehicle_type';
  v_rider := public.mbg_zone_rider_view(v_p);
  v_warn  := public.mbg_zone_warnings(v_p, NULL);
  -- Nothing about the rider is shown until the card is known to be good (the same rule as the public QR page and the check-in);
  -- a vehicle that is already inside is the one exception, as it is for the check-out.
  v_out   := jsonb_build_object('success', true, 'found', true, 'card_state', v_card ->> 'state', 'card_number', v_card ->> 'card_number',
                                'zone', jsonb_build_object('id', v_zone.id, 'name', v_zone.name, 'status', v_zone.status,
                                                           'accept_cash', v_zone.accept_cash, 'entry_mode', v_zone.entry_mode));

  -- already inside: leaving needs no valid card (same as the check-out), only the visit
  SELECT * INTO v_open FROM public.mbg_access_visits
   WHERE zone_id = v_zone.id AND rider_id = (v_card ->> 'rider_id')::UUID AND status IN ('awaiting_payment', 'inside');
  v_has_open := FOUND;
  IF v_has_open AND v_open.status = 'inside' THEN
    v_open := public.mbg_zone_refresh_balance(v_open.id);
    RETURN v_out || jsonb_build_object('outcome', 'inside', 'action', 'out', 'rider', v_rider, 'warnings', v_warn, 'visit', public.mbg_zone_visit_json(v_open),
      'message', 'Inside since ' || to_char(v_open.entered_at AT TIME ZONE v_zone.timezone, 'HH24:MI')
                 || CASE WHEN GREATEST(v_open.fee_due_ugx - v_open.fee_paid_ugx, 0) > 0
                         THEN '. UGX ' || to_char(GREATEST(v_open.fee_due_ugx - v_open.fee_paid_ugx, 0), 'FM999,999,999') || ' is still due before it can leave.'
                         ELSE '. Nothing is owed: it can leave.' END);
  END IF;

  -- the card must be a good card
  v_reason := CASE v_card ->> 'state'
    WHEN 'cancelled' THEN 'card_cancelled' WHEN 'unpaid' THEN 'card_unpaid'
    WHEN 'expired' THEN 'card_expired' WHEN 'suspended' THEN 'rider_suspended' ELSE NULL END;
  IF v_reason IS NOT NULL THEN
    RETURN v_out || jsonb_build_object('outcome', 'refused', 'action', 'none', 'reason', v_reason, 'message', public.mbg_zone_deny_message(v_reason, NULL));
  END IF;

  v_out := v_out || jsonb_build_object('rider', v_rider, 'warnings', v_warn);

  -- rules of the zone that refuse even a good card
  IF v_zone.status <> 'active' THEN v_reason := 'zone_closed'; END IF;
  IF v_reason IS NULL AND v_zone.require_valid_permit AND v_p ->> 'permit_status' = 'expired' THEN v_reason := 'permit_expired'; END IF;

  IF v_has_open AND v_reason IS NULL THEN   -- v_open is an awaiting_payment visit here
    RETURN v_out || jsonb_build_object('outcome', 'awaiting', 'action', 'wait', 'visit', public.mbg_zone_visit_json(v_open),
      'fee_ugx', v_open.fee_due_ugx, 'can_collect_cash', v_zone.accept_cash,
      'message', 'A fee of UGX ' || to_char(v_open.fee_due_ugx, 'FM999,999,999') || ' has been asked for and is not paid yet.');
  END IF;

  SELECT * INTO v_member FROM public.mbg_access_zone_members WHERE zone_id = v_zone.id AND rider_id = (v_card ->> 'rider_id')::UUID;
  v_mstate := public.mbg_zone_member_state(v_member, v_zone.timezone);
  -- an approved entry that is suspended, expired or outside its hours: the vehicle is treated as not approved, and the gate is told why
  v_note := CASE WHEN v_mstate IN ('ok', 'not_on_list') THEN NULL ELSE public.mbg_zone_deny_message(v_mstate, v_type) END;
  IF v_note IS NOT NULL THEN v_out := v_out || jsonb_build_object('note', v_note); END IF;

  -- 1. approved: in, free
  IF v_reason IS NULL AND v_mstate = 'ok' THEN
    RETURN v_out || jsonb_build_object('outcome', 'free', 'action', 'in', 'basis', 'member',
      'member', jsonb_build_object('kind', v_member.member_kind, 'valid_until', v_member.valid_until, 'note', v_member.note),
      'message', 'Approved ' || v_member.member_kind || ' - enters free.');
  END IF;

  -- 2. not approved: may it buy its way in?
  IF v_reason IS NULL AND v_zone.entry_mode = 'paid_entry' THEN
    SELECT f.fee_ugx INTO v_fee FROM public.mbg_access_zone_fees f WHERE f.zone_id = v_zone.id AND f.vehicle_type = v_type;
    IF NOT FOUND THEN
      v_reason := 'vehicle_not_allowed';
    ELSIF v_fee <= 0 THEN
      RETURN v_out || jsonb_build_object('outcome', 'free', 'action', 'in', 'basis', 'open', 'message', 'No fee for this type of vehicle.');
    ELSE
      IF v_zone.fee_basis = 'day_pass' AND EXISTS (
           SELECT 1 FROM public.mbg_access_visits pv
            WHERE pv.zone_id = v_zone.id AND pv.rider_id = (v_card ->> 'rider_id')::UUID
              AND pv.entry_fee_ugx > 0 AND pv.fee_paid_ugx >= pv.entry_fee_ugx AND pv.entered_at > now() - INTERVAL '24 hours') THEN
        RETURN v_out || jsonb_build_object('outcome', 'free', 'action', 'in', 'basis', 'day_pass', 'message', 'Today''s pass is already paid.');
      END IF;

      SELECT r.id AS ride_id, COALESCE(n.max_fee_ugx >= v_fee, false) AS warned INTO v_ride
        FROM public.mbg_rides r
        LEFT JOIN public.mbg_ride_zone_notices n ON n.ride_id = r.id AND n.zone_id = v_zone.id
       WHERE r.rider_id = (v_card ->> 'rider_id')::UUID
         AND r.status::TEXT IN ('accepted', 'in_progress')
         AND (public.mbg_zone_touches(v_zone, r.pickup_lat, r.pickup_lng) OR public.mbg_zone_touches(v_zone, r.dropoff_lat, r.dropoff_lng))
       ORDER BY COALESCE(n.max_fee_ugx >= v_fee, false) DESC, (r.status::TEXT = 'in_progress') DESC, r.requested_at DESC
       LIMIT 1;

      IF FOUND AND v_ride.warned IS NOT TRUE THEN
        RETURN v_out || jsonb_build_object('outcome', 'pay', 'action', 'in', 'payer', 'rider_then_customer',
          'fee_ugx', v_fee, 'fee_ican', ROUND(v_fee / public.mbg_zone_ugx_per_ican(), 8), 'can_collect_cash', v_zone.accept_cash,
          'message', 'Not on the approved list. A customer is on this ride but was not told about the fee: the rider pays UGX '
                     || to_char(v_fee, 'FM999,999,999') || ' now and it is passed on to the customer straight after.');
      END IF;
      IF FOUND THEN
        IF EXISTS (SELECT 1 FROM public.mbg_access_visits pv
                    WHERE pv.zone_id = v_zone.id AND pv.ride_id = v_ride.ride_id
                      AND pv.entry_fee_ugx > 0 AND pv.fee_paid_ugx >= pv.entry_fee_ugx) THEN
          RETURN v_out || jsonb_build_object('outcome', 'free', 'action', 'in', 'basis', 'ride_pass',
            'message', 'The entry fee for this ride was already paid.');
        END IF;
        RETURN v_out || jsonb_build_object('outcome', 'pay', 'action', 'in', 'payer', 'customer',
          'fee_ugx', v_fee, 'fee_ican', ROUND(v_fee / public.mbg_zone_ugx_per_ican(), 8), 'can_collect_cash', v_zone.accept_cash,
          'message', 'Not on the approved list. A customer is on this ride and was told about the fee, so the CUSTOMER pays UGX '
                     || to_char(v_fee, 'FM999,999,999') || ' as part of the ride. The rider pays nothing.');
      END IF;

      RETURN v_out || jsonb_build_object('outcome', 'pay', 'action', 'in', 'payer', 'rider',
        'fee_ugx', v_fee, 'fee_ican', ROUND(v_fee / public.mbg_zone_ugx_per_ican(), 8), 'can_collect_cash', v_zone.accept_cash,
        'message', 'Not on the approved list. Entry fee UGX ' || to_char(v_fee, 'FM999,999,999') || ' - the rider is asked to approve it.');
    END IF;
  END IF;

  -- 3. refused
  v_reason := COALESCE(v_reason, CASE WHEN v_mstate = 'ok' THEN 'not_on_list' ELSE v_mstate END);
  RETURN v_out || jsonb_build_object('outcome', 'refused', 'action', 'none', 'reason', v_reason,
                                     'message', public.mbg_zone_deny_message(v_reason, v_type));
END;
$$;


-- ─── 3. Who may call them ───────────────────────────────────────────────────
-- Signed-in people only (the database then checks their CMMS role). Never the public page's anonymous visitor.

REVOKE ALL ON FUNCTION public.mbg_my_gate_zones()                    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mbg_zone_gate_peek(UUID, TEXT)         FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mbg_my_gate_zones()                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_zone_gate_peek(UUID, TEXT)      TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $done$
BEGIN
  RAISE NOTICE 'The rider card page can now run the gate: staff scan the card with a phone camera, sign in, and check the vehicle in or out.';
END
$done$;

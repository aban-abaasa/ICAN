-- ============================================================================
-- Restricted zones: a rider who goes in by force keeps it on his record, publicly
--
-- THE IDEA
--   A restricted area can only ask. A vehicle that drives past the gate without checking in, or that is let in and then leaves
--   without paying what it owes, cannot be stopped by software: so it is put on the record instead, where everyone who checks
--   that rider's card can see it - the next gate, a customer, a chairperson.
--
--   The gate (any role with Transport > gate, the business owner or a CMMS administrator) reports it from the rider's card page:
--     forced_entry           the vehicle went in without checking in or paying (it ignored the gate, or refused and drove on)
--     left_without_clearing  the vehicle was inside and left without checking out while it still owed money; the visit is closed
--                            at once, so the vehicle is not "inside" for ever and can be checked in again
--   Each report is a permanent line on the rider's public gate record: the date, the area and the organisation, what happened, and
--   whether it was settled. It shows on the public rider-card page for everybody, and as a warning at every gate that scans the
--   card, in every zone. The rider is told the moment it is recorded.
--
-- FAIRNESS (a public record about a person must be hard to abuse and possible to correct)
--   * Only signed-in staff with the gate permission can report; who reported it, and the private note, are kept for the business.
--     Neither is public: the public sees what happened, where and when, never who wrote it or what the note says.
--   * A vehicle that is on the approved list cannot be reported for forced entry (it was allowed in), nor one that is checked in.
--     A vehicle that left owing nothing cannot be reported for leaving without paying.
--   * The same report twice within 30 minutes (a double tap, two guards) is one line, not two.
--   * "Settled" (the gate collected what was owed) stays on the record, marked settled: paying makes it right, it does not make it
--     disappear. Only a manager (Transport > assign, the owner or an administrator) can WITHDRAW a line that was recorded in error,
--     which removes it from the public record; the row is kept for the business's audit trail.
--
-- WHAT THIS ADDS
--   table      mbg_access_incidents  (closed to the API like the other zone tables)
--   staff      mbg_zone_report_incident(zone, code, kind, note)   gate
--              mbg_zone_incident_resolve(incident, 'settled' | 'withdrawn', note)   settled: gate; withdrawn: assign
--              mbg_zone_rider_incidents(code)                      the lines staff may act on, with the private details
--   public     mbg_rider_gate_record(code)                         anon + signed in: the public-safe record, for the card page
--   changed    mbg_zone_warnings(payload, plate)                   now also warns the gate about a record (so the CMMS gate desk
--                                                                  and the card page both show it with no other change)
--
-- Needs 20261110100000_restricted_zone_access.sql. Safe to run twice.
-- Roll back with supabase/rollback/20261112_rollback_zone_forced_entry_record.sql (the records are kept).
-- ============================================================================

DO $guard$
BEGIN
  IF to_regprocedure('public.mbg_zone_read_card(text)') IS NULL
     OR to_regprocedure('public.mbg_zone_staff_can(uuid,text)') IS NULL
     OR to_regprocedure('public.mbg_zone_warnings(jsonb,text)') IS NULL
     OR to_regclass('public.mbg_access_visits') IS NULL THEN
    RAISE EXCEPTION 'Run RESTRICTED_ZONE_ACCESS_PASTE_INTO_SUPABASE.sql (20261110100000_restricted_zone_access.sql) first: the restricted-zone functions are not installed yet.';
  END IF;
END
$guard$;


-- ─── 1. The record ──────────────────────────────────────────────────────────

-- What the zone and the vehicle were called at the time is copied in, so the record survives a renamed zone or a changed plate.
CREATE TABLE IF NOT EXISTS public.mbg_access_incidents (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id             UUID REFERENCES public.mbg_access_zones(id) ON DELETE SET NULL,
  business_profile_id UUID REFERENCES public.business_profiles(id) ON DELETE SET NULL,
  zone_name           TEXT NOT NULL,
  organisation        TEXT,
  rider_id            UUID REFERENCES public.mbg_riders(id) ON DELETE SET NULL,
  rider_user_id       UUID,
  card_id             UUID REFERENCES public.mbg_rider_cards(id) ON DELETE SET NULL,
  card_number         TEXT,
  plate_number        TEXT,
  vehicle_type        TEXT,
  kind                TEXT NOT NULL CHECK (kind IN ('forced_entry', 'left_without_clearing')),
  status              TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'settled', 'withdrawn')),
  -- the fee the vehicle avoided (for the business: never shown publicly)
  owed_ugx            NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (owed_ugx >= 0),
  -- private to the business
  note                TEXT,
  visit_id            UUID REFERENCES public.mbg_access_visits(id) ON DELETE SET NULL,
  reported_by         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reported_by_email   TEXT,
  reported_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_by         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at         TIMESTAMPTZ,
  resolution_note     TEXT
);
CREATE INDEX IF NOT EXISTS mbg_access_incidents_rider_idx ON public.mbg_access_incidents (rider_id, reported_at DESC);
CREATE INDEX IF NOT EXISTS mbg_access_incidents_zone_idx  ON public.mbg_access_incidents (zone_id, reported_at DESC);

-- Closed to the API like the other zone tables: it is reached only through the functions below, which decide who sees what.
ALTER TABLE public.mbg_access_incidents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mbg_access_incidents FROM PUBLIC, anon, authenticated;


-- ─── 2. The gate is warned about a record ───────────────────────────────────

-- Same as before, plus one line when the rider has a record (anything not withdrawn). Used by the check-in, the check-out and the
-- preview, so every gate sees it whichever screen it works from. It reads a table now, so it is STABLE instead of IMMUTABLE.
CREATE OR REPLACE FUNCTION public.mbg_zone_warnings(p_payload JSONB, p_plate_seen TEXT) RETURNS JSONB
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_w      JSONB := '[]'::JSONB;
  v_rider  UUID  := NULLIF(p_payload ->> 'rider_id', '')::UUID;
  v_total  INTEGER;
  v_open   INTEGER;
  v_last   RECORD;
BEGIN
  IF p_payload ->> 'permit_status' = 'expired' THEN v_w := v_w || to_jsonb('The driving permit has expired.'::TEXT); END IF;
  IF p_payload ->> 'permit_status' = 'expiring_soon' THEN v_w := v_w || to_jsonb('The driving permit expires soon.'::TEXT); END IF;
  IF COALESCE((p_payload ->> 'commission_owed_ugx')::NUMERIC, 0) > 0 THEN
    v_w := v_w || to_jsonb('Ride commission is still owed to the chairpersons.'::TEXT);
  END IF;
  IF p_payload #>> '{insurance,state}' = 'expired' THEN v_w := v_w || to_jsonb('The insurance cover has expired.'::TEXT); END IF;
  IF p_payload #>> '{insurance,state}' = 'grace' THEN v_w := v_w || to_jsonb('The insurance cover has ended and is in its grace days.'::TEXT); END IF;
  IF NULLIF(public.mbg_zone_norm_plate(p_plate_seen), '') IS NOT NULL
     AND public.mbg_zone_norm_plate(p_plate_seen) <> public.mbg_zone_norm_plate(p_payload ->> 'plate_number') THEN
    v_w := v_w || to_jsonb(('The plate you entered (' || public.mbg_zone_norm_plate(p_plate_seen) || ') does not match the card ('
                            || COALESCE(p_payload ->> 'plate_number', '?') || ').')::TEXT);
  END IF;

  IF v_rider IS NOT NULL THEN
    SELECT count(*)::INTEGER, (count(*) FILTER (WHERE status = 'open'))::INTEGER INTO v_total, v_open
      FROM public.mbg_access_incidents WHERE rider_id = v_rider AND status <> 'withdrawn';
    IF v_total > 0 THEN
      SELECT i.zone_name, i.reported_at INTO v_last FROM public.mbg_access_incidents i
       WHERE i.rider_id = v_rider AND i.status <> 'withdrawn' ORDER BY i.reported_at DESC LIMIT 1;
      v_w := v_w || to_jsonb(('On record for going in by force or leaving without paying: ' || v_total || CASE WHEN v_total = 1 THEN ' time' ELSE ' times' END
                              || CASE WHEN v_open > 0 THEN ' (' || v_open || ' not settled)' ELSE ' (all settled)' END
                              || '. Latest: ' || v_last.zone_name || ', ' || to_char(v_last.reported_at AT TIME ZONE 'Africa/Kampala', 'DD Mon YYYY') || '.')::TEXT);
    END IF;
  END IF;
  RETURN v_w;
END;
$$;
REVOKE ALL ON FUNCTION public.mbg_zone_warnings(JSONB, TEXT) FROM PUBLIC, anon, authenticated;


-- ─── 3. Staff: report, settle, withdraw ─────────────────────────────────────

-- The line as the staff of the business see it.
CREATE OR REPLACE FUNCTION public.mbg_zone_incident_json(p_incident public.mbg_access_incidents) RETURNS JSONB
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id', p_incident.id, 'kind', p_incident.kind, 'status', p_incident.status, 'zone_name', p_incident.zone_name,
    'organisation', p_incident.organisation, 'owed_ugx', p_incident.owed_ugx, 'note', p_incident.note,
    'reported_at', p_incident.reported_at, 'reported_by', p_incident.reported_by_email, 'resolved_at', p_incident.resolved_at,
    'resolution_note', p_incident.resolution_note,
    'can_settle',   p_incident.status = 'open' AND public.mbg_zone_staff_can(p_incident.business_profile_id, 'gate'),
    'can_withdraw', p_incident.status <> 'withdrawn' AND public.mbg_zone_staff_can(p_incident.business_profile_id, 'assign'))
$$;
REVOKE ALL ON FUNCTION public.mbg_zone_incident_json(public.mbg_access_incidents) FROM PUBLIC, anon, authenticated;

-- Needs 'gate' for the zone. The card must be a real BodaGoEra rider card (whatever its state: a cancelled card can still be the
-- one that was driven through the gate).
CREATE OR REPLACE FUNCTION public.mbg_zone_report_incident(p_zone_id UUID, p_code TEXT, p_kind TEXT, p_note TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_zone    public.mbg_access_zones;
  v_card    JSONB;
  v_p       JSONB;
  v_rider   UUID;
  v_type    TEXT;
  v_biz     TEXT;
  v_open    public.mbg_access_visits;
  v_visit   public.mbg_access_visits;
  v_member  public.mbg_access_zone_members;
  v_inc     public.mbg_access_incidents;
  v_owed    NUMERIC := 0;
  v_note    TEXT := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_what    TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Please sign in'); END IF;
  IF p_kind NOT IN ('forced_entry', 'left_without_clearing') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unknown kind of report');
  END IF;
  IF v_note IS NOT NULL AND length(v_note) > 300 THEN
    RETURN jsonb_build_object('success', false, 'error', 'The note can be at most 300 characters');
  END IF;
  SELECT * INTO v_zone FROM public.mbg_access_zones WHERE id = p_zone_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Zone not found'); END IF;
  IF NOT public.mbg_zone_staff_can(v_zone.business_profile_id, 'gate') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Your role cannot run the gate for this zone');
  END IF;
  PERFORM public.mbg_zone_expire_stale();

  v_card := public.mbg_zone_read_card(p_code);
  IF NOT COALESCE((v_card ->> 'found')::BOOLEAN, false) THEN
    RETURN jsonb_build_object('success', false, 'error', 'This is not a BodaGoEra rider card, so nothing can be recorded against it');
  END IF;
  v_p     := v_card -> 'payload';
  v_rider := (v_card ->> 'rider_id')::UUID;
  v_type  := v_p ->> 'vehicle_type';
  SELECT bp.business_name INTO v_biz FROM public.business_profiles bp WHERE bp.id = v_zone.business_profile_id;

  -- the same report again within 30 minutes is the same line (a double tap, or two guards at the same gate)
  SELECT * INTO v_inc FROM public.mbg_access_incidents
   WHERE rider_id = v_rider AND zone_id = v_zone.id AND kind = p_kind AND status <> 'withdrawn' AND reported_at > now() - INTERVAL '30 minutes'
   ORDER BY reported_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('success', true, 'already_recorded', true, 'incident', public.mbg_zone_incident_json(v_inc));
  END IF;

  SELECT * INTO v_open FROM public.mbg_access_visits
   WHERE zone_id = v_zone.id AND rider_id = v_rider AND status IN ('awaiting_payment', 'inside') FOR UPDATE;

  IF p_kind = 'forced_entry' THEN
    IF FOUND AND v_open.status = 'inside' THEN
      RETURN jsonb_build_object('success', false, 'error', 'This vehicle is checked in, so it did not force its way in. If it left owing money, report that instead.');
    END IF;
    SELECT * INTO v_member FROM public.mbg_access_zone_members WHERE zone_id = v_zone.id AND rider_id = v_rider;
    IF public.mbg_zone_member_state(v_member, v_zone.timezone) = 'ok' THEN
      RETURN jsonb_build_object('success', false, 'error', 'This vehicle is on the zone''s approved list, so it was allowed in free.');
    END IF;
    -- what it avoided paying: the request that was waiting, or the fee for its class
    v_owed := COALESCE(CASE WHEN v_open.id IS NOT NULL THEN v_open.fee_due_ugx END,
                       (SELECT f.fee_ugx FROM public.mbg_access_zone_fees f WHERE f.zone_id = v_zone.id AND f.vehicle_type = v_type
                          AND v_zone.entry_mode = 'paid_entry'), 0);
    IF v_open.id IS NOT NULL THEN
      UPDATE public.mbg_access_visits SET status = 'cancelled', reason = 'Went in by force (reported by the gate)' WHERE id = v_open.id;
      v_visit := v_open;
    ELSE
      INSERT INTO public.mbg_access_visits
        (zone_id, business_profile_id, rider_id, rider_user_id, card_id, card_number, rider_name, plate_number, vehicle_type,
         status, reason, checked_in_by)
      VALUES
        (v_zone.id, v_zone.business_profile_id, v_rider, (v_card ->> 'rider_user_id')::UUID, (v_card ->> 'card_id')::UUID,
         v_card ->> 'card_number', v_p ->> 'full_name', v_p ->> 'plate_number', v_type,
         'denied', 'Went in by force (reported by the gate)', auth.uid())
      RETURNING * INTO v_visit;
    END IF;
    v_what := 'went in without paying';
  ELSE
    IF NOT FOUND OR v_open.status <> 'inside' THEN
      RETURN jsonb_build_object('success', false, 'error', 'This vehicle is not checked in here, so it cannot have left without clearing. Use Check in first, or report that it went in by force.');
    END IF;
    v_visit := public.mbg_zone_refresh_balance(v_open.id);
    v_owed  := GREATEST(v_visit.fee_due_ugx - v_visit.fee_paid_ugx, 0);
    IF v_owed <= 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'Nothing is owed on this visit, so use Check out: the vehicle is cleared to leave.');
    END IF;
    -- the vehicle is gone: close the visit so it is not "inside" for ever and can be checked in again
    UPDATE public.mbg_access_visits
       SET status = 'exited', exited_at = now(), gate_out = 'Left without clearing', checked_out_by = auth.uid(),
           reason = 'Left without clearing: UGX ' || to_char(v_owed, 'FM999,999,999') || ' still unpaid'
     WHERE id = v_visit.id
     RETURNING * INTO v_visit;
    v_what := 'left owing UGX ' || to_char(v_owed, 'FM999,999,999');
  END IF;

  INSERT INTO public.mbg_access_incidents
    (zone_id, business_profile_id, zone_name, organisation, rider_id, rider_user_id, card_id, card_number, plate_number, vehicle_type,
     kind, owed_ugx, note, visit_id, reported_by, reported_by_email)
  VALUES
    (v_zone.id, v_zone.business_profile_id, v_zone.name, v_biz, v_rider, (v_card ->> 'rider_user_id')::UUID, (v_card ->> 'card_id')::UUID,
     v_card ->> 'card_number', v_p ->> 'plate_number', v_type, p_kind, v_owed, v_note, v_visit.id, auth.uid(), auth.jwt() ->> 'email')
  RETURNING * INTO v_inc;

  PERFORM public.mbg_zone_notify_rider((v_card ->> 'rider_user_id')::UUID, 'Recorded at ' || v_zone.name,
    'The gate at ' || v_zone.name || ' recorded that your vehicle ' || v_what || '. It shows on your public rider card. If this is wrong, ask '
    || COALESCE(v_biz, 'the organisation') || ' to withdraw it.', v_visit.id);

  RETURN jsonb_build_object('success', true, 'incident', public.mbg_zone_incident_json(v_inc),
    'recorded', (SELECT count(*) FROM public.mbg_access_incidents WHERE rider_id = v_rider AND status <> 'withdrawn'));
END;
$$;

-- 'settled': the gate collected what was owed (needs 'gate'); the line stays on the record, marked settled.
-- 'withdrawn': it should not have been recorded (needs 'assign': a manager, the owner or an administrator); it leaves the public record.
CREATE OR REPLACE FUNCTION public.mbg_zone_incident_resolve(p_incident_id UUID, p_action TEXT, p_note TEXT DEFAULT NULL) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inc  public.mbg_access_incidents;
  v_note TEXT := NULLIF(btrim(COALESCE(p_note, '')), '');
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Please sign in'); END IF;
  IF p_action NOT IN ('settled', 'withdrawn') THEN RETURN jsonb_build_object('success', false, 'error', 'Unknown action'); END IF;
  IF v_note IS NOT NULL AND length(v_note) > 300 THEN
    RETURN jsonb_build_object('success', false, 'error', 'The note can be at most 300 characters');
  END IF;
  SELECT * INTO v_inc FROM public.mbg_access_incidents WHERE id = p_incident_id FOR UPDATE;
  IF NOT FOUND OR NOT public.mbg_zone_staff_can(v_inc.business_profile_id, 'any') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Record not found');
  END IF;

  IF p_action = 'settled' THEN
    IF NOT public.mbg_zone_staff_can(v_inc.business_profile_id, 'gate') THEN
      RETURN jsonb_build_object('success', false, 'error', 'Your role cannot settle a record');
    END IF;
    IF v_inc.status <> 'open' THEN RETURN jsonb_build_object('success', false, 'error', 'This record is already ' || v_inc.status); END IF;
  ELSE
    IF NOT public.mbg_zone_staff_can(v_inc.business_profile_id, 'assign') THEN
      RETURN jsonb_build_object('success', false, 'error', 'Only a manager can withdraw a record');
    END IF;
    IF v_inc.status = 'withdrawn' THEN RETURN jsonb_build_object('success', false, 'error', 'This record is already withdrawn'); END IF;
  END IF;

  UPDATE public.mbg_access_incidents
     SET status = p_action, resolved_by = auth.uid(), resolved_at = now(), resolution_note = v_note
   WHERE id = v_inc.id
   RETURNING * INTO v_inc;

  PERFORM public.mbg_zone_notify_rider(v_inc.rider_user_id,
    CASE p_action WHEN 'settled' THEN 'Settled at ' ELSE 'Withdrawn at ' END || v_inc.zone_name,
    CASE p_action WHEN 'settled' THEN 'Thank you: the record at ' || v_inc.zone_name || ' is marked settled. It stays on your rider card as settled.'
                  ELSE 'The record at ' || v_inc.zone_name || ' was withdrawn and no longer shows on your rider card.' END,
    v_inc.visit_id);
  RETURN jsonb_build_object('success', true, 'incident', public.mbg_zone_incident_json(v_inc));
END;
$$;

-- The lines on this card that the caller's business(es) may act on, with the private details (note, who reported it).
-- Empty for anyone who does not work for a business that has a record on this rider.
CREATE OR REPLACE FUNCTION public.mbg_zone_rider_incidents(p_code TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rider UUID;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Please sign in'); END IF;
  SELECT c.rider_id INTO v_rider FROM public.mbg_rider_cards c WHERE c.verify_code = public.mbg_zone_card_code(p_code);
  IF NOT FOUND THEN RETURN jsonb_build_object('success', true, 'incidents', '[]'::JSONB); END IF;
  RETURN jsonb_build_object('success', true, 'incidents', COALESCE((
    SELECT jsonb_agg(public.mbg_zone_incident_json(i) ORDER BY i.reported_at DESC)
      FROM public.mbg_access_incidents i
     WHERE i.rider_id = v_rider AND i.status <> 'withdrawn' AND public.mbg_zone_staff_can(i.business_profile_id, 'any')), '[]'::JSONB));
END;
$$;


-- ─── 4. Everybody: the public record ────────────────────────────────────────

-- What the public rider-card page shows, from the code on the card (the same code the QR carries). Only what happened, where and
-- when: never who reported it, the private note, the amount, or anything about the rider beyond the card the page already shows.
-- Withdrawn lines are not shown. Newest first, at most the latest 20 lines, with the true totals.
CREATE OR REPLACE FUNCTION public.mbg_rider_gate_record(p_code TEXT) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rider UUID;
BEGIN
  SELECT c.rider_id INTO v_rider FROM public.mbg_rider_cards c WHERE c.verify_code = public.mbg_zone_card_code(p_code);
  IF NOT FOUND OR v_rider IS NULL THEN RETURN jsonb_build_object('found', false); END IF;
  RETURN jsonb_build_object(
    'found', true,
    'forced_entries',        (SELECT count(*) FROM public.mbg_access_incidents WHERE rider_id = v_rider AND status <> 'withdrawn' AND kind = 'forced_entry'),
    'left_without_clearing', (SELECT count(*) FROM public.mbg_access_incidents WHERE rider_id = v_rider AND status <> 'withdrawn' AND kind = 'left_without_clearing'),
    'open',                  (SELECT count(*) FROM public.mbg_access_incidents WHERE rider_id = v_rider AND status = 'open'),
    'incidents', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'kind', x.kind, 'zone_name', x.zone_name, 'organisation', x.organisation, 'status', x.status,
               'date', to_char(x.reported_at AT TIME ZONE 'Africa/Kampala', 'YYYY-MM-DD')) ORDER BY x.reported_at DESC)
        FROM (SELECT i.kind, i.zone_name, i.organisation, i.status, i.reported_at
                FROM public.mbg_access_incidents i
               WHERE i.rider_id = v_rider AND i.status <> 'withdrawn'
               ORDER BY i.reported_at DESC LIMIT 20) x), '[]'::JSONB));
END;
$$;


-- ─── 5. Who may call them ───────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.mbg_zone_report_incident(UUID, TEXT, TEXT, TEXT)   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mbg_zone_incident_resolve(UUID, TEXT, TEXT)        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mbg_zone_rider_incidents(TEXT)                     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mbg_rider_gate_record(TEXT)                        FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mbg_zone_report_incident(UUID, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_zone_incident_resolve(UUID, TEXT, TEXT)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_zone_rider_incidents(TEXT)                   TO authenticated;
-- the public page is opened by anyone with a phone camera
GRANT EXECUTE ON FUNCTION public.mbg_rider_gate_record(TEXT)                      TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

DO $done$
BEGIN
  RAISE NOTICE 'Gate records ready: a vehicle that goes in by force or leaves without paying is recorded on its public rider card.';
END
$done$;

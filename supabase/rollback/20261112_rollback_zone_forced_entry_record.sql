-- Rolls back 20261112100000_zone_forced_entry_record.sql
--
--   * the report / settle / withdraw functions and the public record function are dropped, so nothing more can be recorded and the
--     public rider-card page shows no gate record (it hides the section when the function is missing)
--   * mbg_zone_warnings() goes back to the version without the "on record" line
--
-- It deliberately KEEPS the table mbg_access_incidents: it is the record of who forced a gate, and running the migration again
-- brings it all back exactly as it was. It is closed to the API (no policies, no grants), so keeping it is harmless. To delete it as
-- well, run the DROP TABLE line at the bottom (this cannot be undone). Safe to run twice.

DROP FUNCTION IF EXISTS public.mbg_zone_report_incident(UUID, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.mbg_zone_incident_resolve(UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.mbg_zone_rider_incidents(TEXT);
DROP FUNCTION IF EXISTS public.mbg_rider_gate_record(TEXT);
DROP FUNCTION IF EXISTS public.mbg_zone_incident_json(public.mbg_access_incidents);

-- mbg_zone_warnings() as 20261110100000_restricted_zone_access.sql left it
CREATE OR REPLACE FUNCTION public.mbg_zone_warnings(p_payload JSONB, p_plate_seen TEXT) RETURNS JSONB
LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  v_w JSONB := '[]'::JSONB;
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
  RETURN v_w;
END;
$$;
REVOKE ALL ON FUNCTION public.mbg_zone_warnings(JSONB, TEXT) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- Only if you also want the records gone (this cannot be undone):
-- DROP TABLE IF EXISTS public.mbg_access_incidents;

\set ON_ERROR_STOP on
SELECT t.login(1);
DO $$ DECLARE r JSONB; BEGIN
  PERFORM t.check('after a round trip the rate is back at 3%', public.ican_fee_rate('zone_access_fee') = 0.03);
  r := public.mbg_zone_list(t.u(100));
  PERFORM t.check('...and the zones are back, with their approved lists', jsonb_array_length(r -> 'zones') = 8
                  AND (SELECT (z ->> 'members_count')::INT FROM jsonb_array_elements(r -> 'zones') z WHERE z ->> 'name' = 'Estate') >= 2);
END $$;
SELECT t.as_admin();
-- the incident records survive a full rollback and come back with the migrations
DO $$ DECLARE r JSONB; BEGIN
  PERFORM t.as_anon();
  r := public.mbg_rider_gate_record(t.code(16));
  PERFORM t.check('after a round trip the public record is back, as it was', r ->> 'found' = 'true' AND (r ->> 'left_without_clearing')::INT = 1, r::TEXT);
  r := public.mbg_rider_gate_record(t.code(12));
  PERFORM t.check('...withdrawn lines still do not show', (r ->> 'forced_entries')::INT = 2, r::TEXT);
END $$;
SELECT t.as_admin();

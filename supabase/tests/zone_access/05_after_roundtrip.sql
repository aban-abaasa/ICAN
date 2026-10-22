\set ON_ERROR_STOP on
SELECT t.login(1);
DO $$ DECLARE r JSONB; BEGIN
  PERFORM t.check('after a round trip the rate is back at 3%', public.ican_fee_rate('zone_access_fee') = 0.03);
  r := public.mbg_zone_list(t.u(100));
  PERFORM t.check('...and the zones are back, with their approved lists', jsonb_array_length(r -> 'zones') = 6
                  AND (SELECT (z ->> 'members_count')::INT FROM jsonb_array_elements(r -> 'zones') z WHERE z ->> 'name' = 'Estate') >= 2);
END $$;
SELECT t.as_admin();

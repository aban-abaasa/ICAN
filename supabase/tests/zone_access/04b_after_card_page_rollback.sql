\set ON_ERROR_STOP on
DO $$ BEGIN
  PERFORM t.check('card page rolled back: the two functions are gone',
    to_regprocedure('public.mbg_my_gate_zones()') IS NULL AND to_regprocedure('public.mbg_zone_gate_peek(uuid,text)') IS NULL);
  PERFORM t.check('...and nothing else is: the gate desk still scans and the rider can still pay',
    to_regprocedure('public.mbg_zone_gate_scan(uuid,text,text,text,text)') IS NOT NULL AND to_regprocedure('public.mbg_rider_pay_gate_fee(uuid)') IS NOT NULL
    AND to_regprocedure('public.mbg_zone_gate_check_in(uuid,text,text,text)') IS NOT NULL);
  PERFORM t.check('...and the history is kept', (SELECT count(*) FROM public.mbg_access_zones) = 7 AND (SELECT count(*) FROM public.mbg_access_visits) > 20);
END $$;
SELECT t.login(2, 'guard@x.test');
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_gate_scan(t.zid('estate'), t.code(15), 'auto');
  PERFORM t.check('...the gate desk still works with the card page rolled back', r ->> 'success' = 'true' AND r ->> 'verdict' IN ('pay_required', 'granted', 'cleared', 'denied'), r::TEXT);
END $$;
SELECT t.as_admin();

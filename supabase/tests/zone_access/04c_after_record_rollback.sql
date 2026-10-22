\set ON_ERROR_STOP on
DO $$ BEGIN
  PERFORM t.check('record rolled back: the report, resolve, list and public functions are gone',
    to_regprocedure('public.mbg_zone_report_incident(uuid,text,text,text)') IS NULL AND to_regprocedure('public.mbg_zone_incident_resolve(uuid,text,text)') IS NULL
    AND to_regprocedure('public.mbg_zone_rider_incidents(text)') IS NULL AND to_regprocedure('public.mbg_rider_gate_record(text)') IS NULL);
  PERFORM t.check('...and nothing else is: the gate desk, the card page preview and the rider''s side still work',
    to_regprocedure('public.mbg_zone_gate_scan(uuid,text,text,text,text)') IS NOT NULL AND to_regprocedure('public.mbg_zone_gate_peek(uuid,text)') IS NOT NULL
    AND to_regprocedure('public.mbg_rider_pay_gate_fee(uuid)') IS NOT NULL);
  PERFORM t.check('...the records themselves are kept', (SELECT count(*) FROM public.mbg_access_incidents) = 5 AND (SELECT count(*) FROM public.mbg_access_incidents WHERE status = 'withdrawn') = 2);
  PERFORM t.check('...and the warning is back to the plain one (immutable again)', (SELECT provolatile FROM pg_proc WHERE oid = 'public.mbg_zone_warnings(jsonb,text)'::regprocedure) = 'i');
END $$;
SELECT t.login(2, 'guard@x.test');
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_gate_peek(t.zid('gl'), t.code(15));
  PERFORM t.check('...the preview works and no longer mentions a record', r ->> 'success' = 'true'
                  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(r -> 'warnings') w WHERE w LIKE 'On record%'), r::TEXT);
END $$;
SELECT t.as_admin();

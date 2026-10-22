\set ON_ERROR_STOP on
DO $$ BEGIN
  PERFORM t.check('rolled back: the gate functions are gone', to_regprocedure('public.mbg_zone_gate_check_in(uuid,text,text,text)') IS NULL
                  AND to_regprocedure('public.mbg_rider_pay_gate_fee(uuid)') IS NULL AND to_regprocedure('public.mbg_my_gate_passes()') IS NULL);
  PERFORM t.check('rolled back: no zone function is left behind', NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                                                                                 WHERE n.nspname = 'public' AND p.proname LIKE 'mbg\_zone\_%'));
  PERFORM t.check('rolled back: the rate row is gone', NOT EXISTS (SELECT 1 FROM public.ican_fee_rates WHERE key = 'zone_access_fee'));
  PERFORM t.check('rolled back: an unknown zone rate is free again, the others are untouched',
    public.ican_fee_rate('zone_access_fee') = 0 AND public.ican_fee_rate('send_bank') = 0.03 AND public.ican_fee_rate('dropship_sale') = 0.02);
  PERFORM t.check('rolled back: the money history is kept', (SELECT count(*) FROM public.mbg_access_visits) > 20 AND (SELECT count(*) FROM public.mbg_access_zones) = 7);
END $$;

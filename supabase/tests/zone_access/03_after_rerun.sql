\set ON_ERROR_STOP on
DO $$ BEGIN
  PERFORM t.check('a second run keeps the rate a developer set', public.ican_fee_rate('zone_access_fee') = 0.02);
  PERFORM t.check('a second run keeps every zone and visit', (SELECT count(*) FROM public.mbg_access_zones) = 6 AND (SELECT count(*) FROM public.mbg_access_visits) > 20);
END $$;
UPDATE public.ican_fee_rates SET rate = 0.03 WHERE key = 'zone_access_fee';

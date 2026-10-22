\set ON_ERROR_STOP on
-- a developer changes the rate before the migration is run a second time
UPDATE public.ican_fee_rates SET rate = 0.02 WHERE key = 'zone_access_fee';

-- AFTER the rollback: gone, and nothing else disturbed.
\set ON_ERROR_STOP on
DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND (p.proname LIKE '%site_delivery%' OR p.proname IN ('site_checkout_with_pin', 'site_guest_checkout_start', 'site_find_delivery_riders'));
  PERFORM t.check('rollback: every function the feature added is gone', n = 0, n::TEXT);
  PERFORM t.check('rollback: the switch table is gone', to_regclass('public.cmms_site_delivery') IS NULL);
  PERFORM t.check('rollback: the marker column is gone', NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'dropship_listings' AND column_name = 'site_managed'));
  PERFORM t.check('rollback: guest_checkout_fulfil is back to EXACTLY the text it had before the migration',
    md5(pg_get_functiondef('public.guest_checkout_fulfil(text,text,numeric)'::regprocedure)) = (SELECT v FROM t.keep WHERE k = 'fulfil_md5'));
  PERFORM t.check('rollback: the hand-made listing, products and stores are untouched',
    (SELECT count(*) FROM public.dropship_listings) = 1 AND (SELECT listed_price FROM public.dropship_listings) = 6500
    AND (SELECT count(*) FROM public.products) = 9 AND (SELECT count(*) FROM public.supermarkets) = 5);
END $$;

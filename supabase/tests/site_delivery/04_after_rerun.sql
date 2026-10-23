-- AFTER running the migration a second time: nothing doubled, nothing lost.
\set ON_ERROR_STOP on
DO $$
DECLARE d TEXT := pg_get_functiondef('public.guest_checkout_fulfil(text,text,numeric)'::regprocedure);
BEGIN
  PERFORM t.check('re-run: the patch is not applied twice',
    (length(d) - length(replace(d, '_site_delivery_lend', ''))) / length('_site_delivery_lend') = 1
    AND (length(d) - length(replace(d, '_site_delivery_return', ''))) / length('_site_delivery_return') = 1);
  PERFORM t.check('re-run: the owner''s switch is kept', (SELECT enabled FROM public.cmms_site_delivery WHERE business_profile_id = t.u(101)));
  PERFORM t.check('re-run: still no listing beyond the hand-made one', (SELECT count(*) FROM public.dropship_listings) = 1);
END $$;
SELECT t.as_anon();
SELECT t.check('re-run: the storefront still works', (public.get_site_delivery_storefront(t.u(101)) ->> 'guest_ok')::BOOLEAN);
SELECT t.as_admin();

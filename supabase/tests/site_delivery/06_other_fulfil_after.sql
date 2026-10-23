\set ON_ERROR_STOP on
DO $$
BEGIN
  PERFORM t.check('other fulfil: left exactly as it was', md5(pg_get_functiondef('public.guest_checkout_fulfil(text,text,numeric)'::regprocedure)) = (SELECT v FROM t.keep WHERE k = 'other_fulfil_md5'));
END $$;
SELECT t.as_anon();
SELECT t.check('other fulfil: wallet delivery still works, guest payment is NOT offered',
  (public.get_site_delivery_storefront(t.u(101)) ->> 'enabled')::BOOLEAN AND NOT (public.get_site_delivery_storefront(t.u(101)) ->> 'guest_ok')::BOOLEAN);
SELECT t.as_admin();

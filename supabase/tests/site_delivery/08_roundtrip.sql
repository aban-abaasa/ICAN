-- Migration -> rollback -> migration again: back in business (the switch starts off again).
\set ON_ERROR_STOP on
SELECT t.as_anon();
SELECT t.check('round trip: off after a fresh install', public.get_site_delivery_storefront(t.u(101)) = jsonb_build_object('enabled', FALSE));
SELECT t.login(1);
SELECT t.check('round trip: can be switched on again', (public.fn_set_cmms_site_delivery(t.u(301), TRUE) ->> 'enabled')::BOOLEAN);
SELECT t.as_admin();
SELECT t.check('round trip: fulfil lends again', position('_site_delivery_lend' IN pg_get_functiondef('public.guest_checkout_fulfil(text,text,numeric)'::regprocedure)) > 0);

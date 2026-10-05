\set ON_ERROR_STOP on
-- Landing-page requests: public form, abuse controls, developer inbox, conversion.
-- (Runs after 02_tests.sql, reusing its fixtures and helpers.)

-- ================================================================ 18. Public overview (anonymous)
DO $t$
DECLARE o JSONB;
BEGIN
  PERFORM t.as_anon();
  o := public.ican_franchise_public_overview();
  PERFORM t.reset();
  PERFORM t.check('18.1 anon can read the public overview: every country is open, Uganda is live',
    (o->>'countries_open')::INT >= 189 AND o->'live' @> '[{"country_code":"UG"}]', left(o::TEXT, 200));
  PERFORM t.check('18.2 headline share comes from the live rate card (50)', (o->>'max_agency_share_pct')::NUMERIC = 50, o->>'max_agency_share_pct');
  PERFORM t.check('18.3 the overview never leaks HQ/master percentages or money',
    o::TEXT NOT LIKE '%hq_pct%' AND o::TEXT NOT LIKE '%master_pct%' AND o::TEXT NOT LIKE '%ican_balance%' AND NOT (o ? 'liability'));
  UPDATE public.ican_franchise_territories SET status = 'paused' WHERE country_code = 'ZM';
  PERFORM t.as_anon();
  PERFORM t.check('18.4 a paused country drops out of the open count',
    (public.ican_franchise_public_overview() ->> 'countries_open')::INT = (o->>'countries_open')::INT - 1);
  PERFORM t.reset();
  UPDATE public.ican_franchise_territories SET status = 'open' WHERE country_code = 'ZM';
END $t$;

-- ================================================================ 19. The request form
DO $t$
DECLARE r JSONB; e TEXT; n INT;
BEGIN
  PERFORM t.as_anon();
  r := public.ican_franchise_submit_enquiry('Amina Okello', 'Amina.Okello@Example.com', 'Kenya', 'Okello & Co Accountants Ltd', 'PVT-AB12CD',
         'Kenya', 'agency', ARRAY['icanera','supermarketera'], '+254700000001', 80, 'We serve 80 SMEs in Nairobi.');
  PERFORM t.reset();
  PERFORM t.check('19.1 an anonymous visitor can request a franchise', (r->>'ok')::BOOLEAN AND r ? 'id', r::TEXT);
  PERFORM t.check('19.2 country NAME resolved to its code, email normalised, nothing attached to a user',
    (SELECT country_code = 'KE' AND email = 'amina.okello@example.com' AND user_id IS NULL AND status = 'new'
       FROM public.ican_franchise_enquiries WHERE id = (r->>'id')::UUID));

  PERFORM t.as_anon();
  r := public.ican_franchise_submit_enquiry('Amina Okello', 'amina.okello@example.com', 'KE', 'Okello & Co Accountants Ltd', 'PVT-AB12CD', NULL, 'agency');
  PERFORM t.reset();
  PERFORM t.check('19.3 the same request again is acknowledged, not duplicated',
    (r->>'duplicate')::BOOLEAN AND (SELECT COUNT(*) FROM public.ican_franchise_enquiries WHERE email = 'amina.okello@example.com') = 1, r::TEXT);

  -- honeypot: a bot that fills the hidden field looks successful and stores nothing
  PERFORM t.as_anon();
  r := public.ican_franchise_submit_enquiry('Bot Name', 'bot@spam.test', 'UG', 'Bot Co', 'REG-BOT01', NULL, 'agency', ARRAY['icanera'], NULL, NULL, NULL, 'http://spam.example');
  PERFORM t.reset();
  PERFORM t.check('19.4 honeypot: looks fine to the bot, stores nothing',
    (r->>'ok')::BOOLEAN AND NOT EXISTS (SELECT 1 FROM public.ican_franchise_enquiries WHERE email = 'bot@spam.test'));

  -- validation
  PERFORM t.as_anon();
  PERFORM t.check('19.5 bad email refused', t.err($$SELECT public.ican_franchise_submit_enquiry('Jo Doe','not-an-email','UG','Jo Ltd','REG-0001')$$) LIKE '%valid email%');
  PERFORM t.check('19.6 missing name refused', t.err($$SELECT public.ican_franchise_submit_enquiry('J','jo@example.com','UG','Jo Ltd','REG-0001')$$) LIKE '%name%');
  PERFORM t.check('19.7 unknown country refused', t.err($$SELECT public.ican_franchise_submit_enquiry('Jo Doe','jo@example.com','Atlantis','Jo Ltd','REG-0001')$$) LIKE '%country%');
  PERFORM t.check('19.8 unknown partner type refused', t.err($$SELECT public.ican_franchise_submit_enquiry('Jo Doe','jo@example.com','UG','Jo Ltd','REG-0001',NULL,'emperor')$$) LIKE '%what you would like%');
  PERFORM t.check('19.9 unknown product refused', t.err($$SELECT public.ican_franchise_submit_enquiry('Jo Doe','jo@example.com','UG','Jo Ltd','REG-0001',NULL,'agency',ARRAY['bitcoin'])$$) LIKE '%product%');
  PERFORM t.check('19.10 oversized message refused', t.err(format($$SELECT public.ican_franchise_submit_enquiry('Jo Doe','jo@example.com','UG','Jo Ltd','REG-0001',NULL,'agency',ARRAY['icanera'],NULL,NULL,%L)$$, repeat('x', 2001))) LIKE '%too long%');
  PERFORM t.check('19.11 absurd client count refused', t.err($$SELECT public.ican_franchise_submit_enquiry('Jo Doe','jo@example.com','UG','Jo Ltd','REG-0001',NULL,'agency',ARRAY['icanera'],NULL,99999999)$$) LIKE '%sensible%');
  PERFORM t.reset();

  -- per-person daily cap (3 different asks), then refused
  PERFORM t.as_anon();
  PERFORM public.ican_franchise_submit_enquiry('Eve Many', 'eve@example.com', 'UG', 'Eve Ltd', 'REG-EVE01', NULL, 'agency');
  PERFORM public.ican_franchise_submit_enquiry('Eve Many', 'eve@example.com', 'UG', 'Eve Ltd', 'REG-EVE01', NULL, 'referral');
  PERFORM public.ican_franchise_submit_enquiry('Eve Many', 'eve@example.com', 'KE', 'Eve Ltd', 'REG-EVE01', NULL, 'agency');
  e := t.err($$SELECT public.ican_franchise_submit_enquiry('Eve Many','eve@example.com','GH','Eve Ltd','REG-EVE01',NULL,'agency')$$);
  PERFORM t.reset();
  PERFORM t.check('19.12 a fourth different request in a day is refused', e LIKE '%already sent a few%', e);

  -- global flood ceiling: 100 requests an hour
  INSERT INTO public.ican_franchise_enquiries (full_name, email, company_name, company_reg_number, company_reg_country, country_code)
    SELECT 'Flood ' || g, 'flood' || g || '@example.com', 'Flood Co ' || g, 'FLD-' || g || '00', 'UG', 'UG' FROM generate_series(1, 100) g;
  PERFORM t.as_anon();
  e := t.err($$SELECT public.ican_franchise_submit_enquiry('Late Comer','late@example.com','UG','Late Ltd','REG-LATE1')$$);
  PERFORM t.reset();
  PERFORM t.check('19.13 the hourly global ceiling stops a flood', e LIKE '%lot of requests%', e);
  DELETE FROM public.ican_franchise_enquiries WHERE email LIKE 'flood%@example.com';

  -- a signed-in requester is linked to their account
  PERFORM t.as_user(t.u(20));
  r := public.ican_franchise_submit_enquiry('Outsider Person', 'u20@test.dev', 'UG', 'Outsider Holdings Ltd', 'REG-OUT01', NULL, 'referral');
  PERFORM t.reset();
  PERFORM t.check('19.14 a signed-in requester is linked to their account',
    (SELECT user_id FROM public.ican_franchise_enquiries WHERE id = (r->>'id')::UUID) = t.u(20));
END $t$;

-- ================================================================ 20. Who can see requests
DO $t$
DECLARE n INT;
BEGIN
  PERFORM t.as_anon();
  PERFORM t.check('20.1 anon cannot read the requests table', t.err($$SELECT * FROM public.ican_franchise_enquiries$$) LIKE '%permission denied%');
  PERFORM t.check('20.2 anon cannot write the requests table directly',
    t.err($$INSERT INTO public.ican_franchise_enquiries (full_name,email,country_code) VALUES ('Sneaky','s@example.com','UG')$$) LIKE '%permission denied%');
  PERFORM t.check('20.3 anon cannot call the admin inbox', t.err($$SELECT public.ican_franchise_admin_list_enquiries()$$) LIKE '%permission denied%');
  PERFORM t.as_user(t.u(1));
  SELECT COUNT(*) INTO n FROM public.ican_franchise_enquiries;
  PERFORM t.check('20.4 a signed-in stranger sees no one else''s requests', n = 0, n::TEXT);
  PERFORM t.check('20.5 and cannot call the admin inbox', t.err($$SELECT public.ican_franchise_admin_list_enquiries()$$) LIKE '%restricted%');
  PERFORM t.as_user(t.u(20));
  SELECT COUNT(*) INTO n FROM public.ican_franchise_enquiries;
  PERFORM t.check('20.6 a requester sees only their own', n = 1 AND NOT EXISTS (SELECT 1 FROM public.ican_franchise_enquiries WHERE user_id IS DISTINCT FROM t.u(20)));
  PERFORM t.reset();
END $t$;

-- ================================================================ 21. The developer inbox
DO $t$
DECLARE r JSONB; v_amina UUID; v_outsider UUID; l JSONB; pid UUID;
BEGIN
  SELECT id INTO v_amina FROM public.ican_franchise_enquiries WHERE email = 'amina.okello@example.com';
  SELECT id INTO v_outsider FROM public.ican_franchise_enquiries WHERE email = 'u20@test.dev';
  PERFORM t.as_user(t.u(900));
  l := public.ican_franchise_admin_list_enquiries('new');
  PERFORM t.check('21.1 the developer sees new requests with account and territory flags',
    jsonb_array_length(l) >= 2
    AND (SELECT (x->>'has_account')::BOOLEAN FROM jsonb_array_elements(l) x WHERE x->>'email' = 'u20@test.dev') = TRUE
    AND (SELECT (x->>'has_account')::BOOLEAN FROM jsonb_array_elements(l) x WHERE x->>'email' = 'amina.okello@example.com') = FALSE, left(l::TEXT, 200));
  PERFORM t.check('21.2 overview counts the unread requests', (public.ican_franchise_admin_overview()->>'enquiries_new')::INT >= 2);

  -- Amina has no IcanEra account yet: conversion explains what to do instead of failing mysteriously
  PERFORM t.check('21.3 converting a requester with no account explains the next step',
    t.err(format($$SELECT public.ican_franchise_admin_convert_enquiry(%L)$$, v_amina)) LIKE '%sign up with that email%');
  r := public.ican_franchise_admin_set_enquiry_status(v_amina, 'contacted', 'Called, sending term sheet');
  PERFORM t.check('21.4 can mark contacted with a note', r->>'status' = 'contacted' AND r->>'admin_note' LIKE 'Called%');
  PERFORM t.check('21.5 cannot set converted by hand', t.err(format($$SELECT public.ican_franchise_admin_set_enquiry_status(%L,'converted')$$, v_amina)) LIKE '%convert%');

  -- the outsider has an account: conversion creates a real application owned by them
  r := public.ican_franchise_admin_convert_enquiry(v_outsider);
  pid := (r->>'partner_id')::UUID;
  PERFORM t.check('21.6 conversion creates an application owned by the requester account',
    (SELECT status = 'applied' AND owner_user_id = t.u(20) AND partner_type = 'referral' AND country_code = 'UG'
       AND company_name = 'Outsider Holdings Ltd' AND company_reg_number = 'REG-OUT01' AND company_status = 'pending'
       FROM public.ican_franchise_partners WHERE id = pid));
  PERFORM t.check('21.7 the request is linked to the new partner and closed',
    (SELECT status = 'converted' AND converted_partner_id = pid FROM public.ican_franchise_enquiries WHERE id = v_outsider));
  PERFORM t.check('21.8 converting twice is refused', t.err(format($$SELECT public.ican_franchise_admin_convert_enquiry(%L)$$, v_outsider)) LIKE '%already been converted%');
  PERFORM t.check('21.9 a converted request is closed for status edits',
    t.err(format($$SELECT public.ican_franchise_admin_set_enquiry_status(%L,'declined')$$, v_outsider)) LIKE '%already converted%');

  -- a country HQ has not opened yet: asks HQ to open it first
  PERFORM t.reset();
  INSERT INTO public.ican_franchise_enquiries (full_name, email, company_name, company_reg_number, company_reg_country, country_code, partner_type)
    VALUES ('Zed Zambia', 'u20@test.dev', 'Zed Zambia Ltd', 'ZM-0001', 'ZM', 'ZM', 'agency') RETURNING id INTO v_amina;
  PERFORM t.as_user(t.u(900));
  PERFORM t.reset();
  UPDATE public.ican_franchise_territories SET status = 'paused' WHERE country_code = 'ZM';
  PERFORM t.as_user(t.u(900));
  PERFORM t.check('21.10 converting for a PAUSED country is refused with a way forward',
    t.err(format($$SELECT public.ican_franchise_admin_convert_enquiry(%L)$$, v_amina)) LIKE '%paused for franchises%');
  PERFORM t.reset();
  UPDATE public.ican_franchise_territories SET status = 'open' WHERE country_code = 'ZM';
  PERFORM t.as_user(t.u(900));
  PERFORM t.check('21.11 un-paused, the same request converts (no one had to open Zambia first)',
    (public.ican_franchise_admin_convert_enquiry(v_amina) ->> 'partner_id') IS NOT NULL);
  PERFORM t.reset();
END $t$;

SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, name, CASE WHEN ok THEN '' ELSE COALESCE(left(info, 300), '') END AS detail
  FROM t.results WHERE NOT ok ORDER BY n;
SELECT COUNT(*) FILTER (WHERE ok) AS passed, COUNT(*) FILTER (WHERE NOT ok) AS failed, COUNT(*) AS total FROM t.results;

\set ON_ERROR_STOP on
-- Business site addresses (icanera.space/<business-name>): naming, uniqueness, reserved words, stability, retired addresses, access.
CREATE SCHEMA t;
GRANT USAGE ON SCHEMA t TO PUBLIC;
CREATE FUNCTION t.u(n INT) RETURNS UUID LANGUAGE sql IMMUTABLE AS $$ SELECT ('00000000-0000-0000-0000-' || lpad(n::TEXT, 12, '0'))::UUID $$;
CREATE FUNCTION t.as_user(n INT) RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN
  PERFORM set_config('request.jwt.claim.sub', t.u(n)::TEXT, false); EXECUTE 'SET ROLE authenticated'; END $$;
CREATE FUNCTION t.as_anon() RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', false); EXECUTE 'SET ROLE anon'; END $$;
-- the SQL editor / service role: no signed-in user
CREATE FUNCTION t.as_admin() RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', false); EXECUTE 'RESET ROLE'; END $$;
CREATE FUNCTION t.check(p_name TEXT, p_ok BOOLEAN, p_detail TEXT DEFAULT '') RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN
  IF p_ok IS TRUE THEN RAISE INFO 'PASS %', p_name; ELSE RAISE EXCEPTION 'FAIL % %', p_name, p_detail; END IF; END $$;
-- true when the statement raises an error
CREATE FUNCTION t.raises(p_sql TEXT) RETURNS BOOLEAN LANGUAGE plpgsql AS $$ BEGIN EXECUTE p_sql; RETURN false; EXCEPTION WHEN OTHERS THEN RETURN true; END $$;
-- the SQLSTATE a statement raises, or '' when it succeeds
CREATE FUNCTION t.sqlstate_of(p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$ BEGIN EXECUTE p_sql; RETURN ''; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $$;
CREATE FUNCTION t.slug_of(p_id TEXT) RETURNS TEXT LANGUAGE sql STABLE AS $$ SELECT site_slug FROM public.cmms_company_profiles WHERE id = p_id::UUID $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA t TO PUBLIC;
SET client_min_messages = info;

-- ============ 1. Turning a name into an address
DO $t$
BEGIN
  PERFORM t.check('1.1 plain name', public.fn_site_slugify('Supermart Kera') = 'supermart-kera');
  PERFORM t.check('1.2 brackets, dots and case', public.fn_site_slugify('GODMINDERA ORGANISATION (U) LTD') = 'godmindera-organisation-u-ltd');
  PERFORM t.check('1.3 accents and & become plain letters', public.fn_site_slugify('Café Déjà Vu & Sons') = 'cafe-deja-vu-and-sons', public.fn_site_slugify('Café Déjà Vu & Sons'));
  PERFORM t.check('1.4 symbols and doubled spaces collapse to one hyphen', public.fn_site_slugify('  B$A   --  Co.  ') = 'b-a-co');
  PERFORM t.check('1.5 nothing usable gives an empty string (the allocator then falls back)', public.fn_site_slugify('!!! ???') = '');
  PERFORM t.check('1.6 the accent table is balanced',
    length('àáâãäåāăąçćčďđèéêëēėęěğìíîïīįıłńňñòóôõöøōőŕřśšşșťţțùúûüūůűųýÿźżž') = length('aaaaaaaaaccc' || 'dd' || 'eeeeeeee' || 'g' || 'iiiiiii' || 'l' || 'nnn' || 'oooooooo' || 'rr' || 'ssss' || 'ttt' || 'uuuuuuuu' || 'yy' || 'zzz'));
  PERFORM t.check('1.7 reserved words are recognised whatever the case', public.fn_site_slug_is_reserved('Pricing') AND public.fn_site_slug_is_reserved('notices') AND NOT public.fn_site_slug_is_reserved('kampala-mart'));
END $t$;

-- ============ 2. The backfill of businesses that already existed
DO $t$
BEGIN
  PERFORM t.check('2.1 every existing business got an address', (SELECT count(*) FROM public.cmms_company_profiles WHERE site_slug IS NULL) = 0);
  PERFORM t.check('2.2 the oldest of two same-named businesses keeps the plain name; the next gets -2',
    t.slug_of('00000000-0000-0000-0000-00000000a001') = 'easy-laundry-shop' AND t.slug_of('00000000-0000-0000-0000-00000000a002') = 'easy-laundry-shop-2');
  PERFORM t.check('2.3 accents and & are folded', t.slug_of('00000000-0000-0000-0000-00000000a003') = 'cafe-deja-vu-and-sons', t.slug_of('00000000-0000-0000-0000-00000000a003'));
  PERFORM t.check('2.4 B$A is usable', t.slug_of('00000000-0000-0000-0000-00000000a004') = 'b-a');
  PERFORM t.check('2.5 a business called "Shop" does not take the /shop page', t.slug_of('00000000-0000-0000-0000-00000000a005') = 'shop-business');
  PERFORM t.check('2.6 a business called "IcanEra" cannot pose as the platform', t.slug_of('00000000-0000-0000-0000-00000000a006') = 'icanera-business');
  PERFORM t.check('2.7 a name with nothing usable still gets an address', t.slug_of('00000000-0000-0000-0000-00000000a007') = 'business');
  PERFORM t.check('2.8 one-letter names are padded to the 3-character minimum', t.slug_of('00000000-0000-0000-0000-00000000a008') = 'x-business');
  PERFORM t.check('2.9 GODMINDERA (the platform fee business) gets the plain name even though an older look-alike exists',
    t.slug_of('00000000-0000-0000-0000-00000000a00a') = 'godmindera-organisation-u-ltd' AND t.slug_of('00000000-0000-0000-0000-00000000a009') = 'godmindera-organisation-u-ltd-2',
    t.slug_of('00000000-0000-0000-0000-00000000a00a') || ' / ' || t.slug_of('00000000-0000-0000-0000-00000000a009'));
  PERFORM t.check('2.10 very long names are cut at 60 characters', length(t.slug_of('00000000-0000-0000-0000-00000000a00b')) <= 60 AND t.slug_of('00000000-0000-0000-0000-00000000a00b') !~ '-$');
  PERFORM t.check('2.11 every address is well formed', NOT EXISTS (SELECT 1 FROM public.cmms_company_profiles
    WHERE site_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' OR length(site_slug) NOT BETWEEN 3 AND 60 OR public.fn_site_slug_is_reserved(site_slug)));
  PERFORM t.check('2.12 no two businesses share an address, whatever the case',
    (SELECT count(*) FROM public.cmms_company_profiles) = (SELECT count(DISTINCT lower(site_slug)) FROM public.cmms_company_profiles));
END $t$;

-- ============ 3. New businesses
DO $t$
BEGIN
  INSERT INTO public.cmms_company_profiles (id, company_name, email) VALUES
    (t.u(101), 'Kampala Mart', 'k1@t.dev'), (t.u(102), 'Kampala Mart', 'k2@t.dev'), (t.u(103), 'KAMPALA MART', 'k3@t.dev');
  PERFORM t.check('3.1 a new business gets its address on insert', t.slug_of(t.u(101)::TEXT) = 'kampala-mart');
  PERFORM t.check('3.2 the next same-named business gets -2, then -3',
    t.slug_of(t.u(102)::TEXT) = 'kampala-mart-2' AND t.slug_of(t.u(103)::TEXT) = 'kampala-mart-3');

  INSERT INTO public.cmms_company_profiles (id, company_name, email, site_slug) VALUES (t.u(104), 'Whatever Ltd', 'k4@t.dev', '  Choose-Me  ');
  PERFORM t.check('3.3 an address chosen at sign-up is cleaned (trim + lower case) and kept', t.slug_of(t.u(104)::TEXT) = 'choose-me');
  PERFORM t.check('3.4 a chosen address that is reserved is refused', t.raises($q$INSERT INTO public.cmms_company_profiles (company_name, email, site_slug) VALUES ('A', 'k5@t.dev', 'pricing')$q$));
  PERFORM t.check('3.5 a chosen address that is taken is refused with a unique-violation code',
    t.sqlstate_of($q$INSERT INTO public.cmms_company_profiles (company_name, email, site_slug) VALUES ('A', 'k6@t.dev', 'KAMPALA-MART')$q$) = '23505');
END $t$;

-- ============ 4. An address stays put
DO $t$
BEGIN
  UPDATE public.cmms_company_profiles SET company_name = 'Kampala Mart Uganda' WHERE id = t.u(101);
  PERFORM t.check('4.1 renaming a business does NOT move its address (printed links stay true)', t.slug_of(t.u(101)::TEXT) = 'kampala-mart');
  UPDATE public.cmms_company_profiles SET site_slug = NULL WHERE id = t.u(101);
  PERFORM t.check('4.2 clearing the field keeps the address', t.slug_of(t.u(101)::TEXT) = 'kampala-mart');
  UPDATE public.cmms_company_profiles SET site_slug = '' WHERE id = t.u(101);
  PERFORM t.check('4.3 a blank field keeps the address', t.slug_of(t.u(101)::TEXT) = 'kampala-mart');
  UPDATE public.cmms_company_profiles SET site_slug = 'kampala-mart' WHERE id = t.u(101);
  PERFORM t.check('4.4 saving the same address again is a no-op (no history row)', NOT EXISTS (SELECT 1 FROM public.cmms_company_site_slug_history WHERE slug = 'kampala-mart'));
END $t$;

-- ============ 5. Choosing another address
DO $t$
BEGIN
  UPDATE public.cmms_company_profiles SET site_slug = 'Kampala-Mart-Uganda' WHERE id = t.u(101);
  PERFORM t.check('5.1 a company can choose its own address (cleaned)', t.slug_of(t.u(101)::TEXT) = 'kampala-mart-uganda');
  PERFORM t.check('5.2 the old address is kept in history', EXISTS (SELECT 1 FROM public.cmms_company_site_slug_history WHERE slug = 'kampala-mart' AND company_id = t.u(101)));
  PERFORM t.check('5.3 a retired address is NOT free for someone else', t.raises($q$UPDATE public.cmms_company_profiles SET site_slug = 'kampala-mart' WHERE id = '00000000-0000-0000-0000-000000000102'$q$));
  PERFORM t.check('5.4 reserved words are refused', t.raises($q$UPDATE public.cmms_company_profiles SET site_slug = 'notices' WHERE id = '00000000-0000-0000-0000-000000000101'$q$));
  PERFORM t.check('5.5 an address in use is refused (unique-violation code)', t.sqlstate_of($q$UPDATE public.cmms_company_profiles SET site_slug = 'godmindera-organisation-u-ltd' WHERE id = '00000000-0000-0000-0000-000000000101'$q$) = '23505');
  PERFORM t.check('5.6 too short / too long / spaces / symbols / edge hyphens are refused',
    t.raises($q$UPDATE public.cmms_company_profiles SET site_slug = 'ab' WHERE id = '00000000-0000-0000-0000-000000000101'$q$)
    AND t.raises($q$UPDATE public.cmms_company_profiles SET site_slug = repeat('a', 61) WHERE id = '00000000-0000-0000-0000-000000000101'$q$)
    AND t.raises($q$UPDATE public.cmms_company_profiles SET site_slug = 'my shop' WHERE id = '00000000-0000-0000-0000-000000000101'$q$)
    AND t.raises($q$UPDATE public.cmms_company_profiles SET site_slug = 'my_shop!' WHERE id = '00000000-0000-0000-0000-000000000101'$q$)
    AND t.raises($q$UPDATE public.cmms_company_profiles SET site_slug = '-myshop' WHERE id = '00000000-0000-0000-0000-000000000101'$q$)
    AND t.raises($q$UPDATE public.cmms_company_profiles SET site_slug = 'my--shop' WHERE id = '00000000-0000-0000-0000-000000000101'$q$));
  PERFORM t.check('5.7 after refusals the address is unchanged', t.slug_of(t.u(101)::TEXT) = 'kampala-mart-uganda');
  UPDATE public.cmms_company_profiles SET site_slug = 'kampala-mart' WHERE id = t.u(101);
  PERFORM t.check('5.8 a company can take back an address that was once its own', t.slug_of(t.u(101)::TEXT) = 'kampala-mart');
  PERFORM t.check('5.9 ... and it is current again, not retired', NOT EXISTS (SELECT 1 FROM public.cmms_company_site_slug_history WHERE slug = 'kampala-mart'));
  UPDATE public.cmms_company_profiles SET site_slug = 'kampala-mart-uganda' WHERE id = t.u(101);   -- leave it retired for the next section
END $t$;

-- ============ 6. Public lookups (anonymous visitors)
DO $t$
DECLARE r RECORD; n INT;
BEGIN
  PERFORM t.as_anon();
  SELECT * INTO r FROM public.fn_resolve_public_site_slug('godmindera-organisation-u-ltd');
  PERFORM t.check('6.1 a visitor opens a site by its address', r.company_id = '00000000-0000-0000-0000-00000000a00a' AND r.is_current, r::TEXT);
  SELECT * INTO r FROM public.fn_resolve_public_site_slug('  GODMINDERA-Organisation-U-LTD ');
  PERFORM t.check('6.2 capital letters and stray spaces do not matter', r.company_id = '00000000-0000-0000-0000-00000000a00a');
  SELECT * INTO r FROM public.fn_resolve_public_site_slug('kampala-mart');
  PERFORM t.check('6.3 a RETIRED address still opens the same business and points at its current address',
    r.company_id = t.u(101) AND r.site_slug = 'kampala-mart-uganda' AND NOT r.is_current, r::TEXT);
  SELECT count(*) INTO n FROM public.fn_resolve_public_site_slug('no-such-business');
  PERFORM t.check('6.4 an unknown address opens nothing', n = 0);
  SELECT count(*) INTO n FROM public.fn_resolve_public_site_slug('');
  PERFORM t.check('6.5 an empty address opens nothing', n = 0);
  SELECT count(*) INTO n FROM public.fn_get_public_site_slugs(ARRAY[t.u(101), '00000000-0000-0000-0000-00000000a00a', gen_random_uuid()]);
  PERFORM t.check('6.6 several ids are turned into addresses in one call; unknown ids are left out', n = 2);
  PERFORM t.check('6.7 visitors cannot read the company table or the history',
    (SELECT count(*) FROM public.cmms_company_profiles) = 0 AND t.raises('SELECT * FROM public.cmms_company_site_slug_history'));
  PERFORM t.check('6.8 visitors cannot reach the internal helpers',
    t.raises($q$SELECT public.fn_allocate_company_site_slug('x')$q$) AND t.raises($q$SELECT public.fn_site_slug_taken('x')$q$) AND t.raises($q$SELECT public.fn_site_slug_problem('x')$q$));
  PERFORM t.as_admin();
END $t$;

-- ============ 7. "Choose your address" check
DO $t$
DECLARE j JSONB;
BEGIN
  PERFORM t.as_anon();
  j := public.fn_check_site_slug('free-name-here');
  PERFORM t.check('7.1 signed-out visitors cannot use the checker', (j->>'available')::BOOLEAN IS FALSE);
  PERFORM t.as_user(1);
  j := public.fn_check_site_slug('free-name-here', t.u(101));
  PERFORM t.check('7.2 a free address is available', (j->>'available')::BOOLEAN AND j->>'reason' IS NULL, j::TEXT);
  j := public.fn_check_site_slug('pricing', t.u(101));
  PERFORM t.check('7.3 a reserved address says so', NOT (j->>'available')::BOOLEAN AND j->>'reason' ILIKE '%reserved%', j::TEXT);
  j := public.fn_check_site_slug('godmindera-organisation-u-ltd', t.u(101));
  PERFORM t.check('7.4 a used address says so', NOT (j->>'available')::BOOLEAN AND j->>'reason' ILIKE '%already used%', j::TEXT);
  j := public.fn_check_site_slug('kampala-mart-uganda', t.u(101));
  PERFORM t.check('7.5 your own current address counts as available to you', (j->>'available')::BOOLEAN, j::TEXT);
  j := public.fn_check_site_slug('My Shop', t.u(101));
  PERFORM t.check('7.6 a badly formed address explains the rule', NOT (j->>'available')::BOOLEAN AND j->>'reason' ILIKE '%letters, numbers%', j::TEXT);
  PERFORM t.as_admin();
END $t$;

-- ============ 7b. Brand names: the platform operator may assign them, customers never
DO $t$
DECLARE j JSONB;
BEGIN
  PERFORM t.as_user(1);
  j := public.fn_check_site_slug('icanera', t.u(106));
  PERFORM t.check('7b.1 a customer cannot take a brand name', NOT (j->>'available')::BOOLEAN AND j->>'reason' ILIKE '%reserved%', j::TEXT);
  PERFORM t.as_admin();
  -- the operator (no signed-in user) gives the IcanEra company the brand address
  UPDATE public.cmms_company_profiles SET site_slug = 'icanera' WHERE id = '00000000-0000-0000-0000-00000000a006';
  PERFORM t.check('7b.2 the platform operator can assign a brand name', t.slug_of('00000000-0000-0000-0000-00000000a006') = 'icanera');
  PERFORM t.check('7b.3 ... but not an app route such as /pricing',
    t.raises($q$UPDATE public.cmms_company_profiles SET site_slug = 'pricing' WHERE id = '00000000-0000-0000-0000-00000000a006'$q$));
  PERFORM t.check('7b.4 ... and the name still cannot be handed to another business',
    t.raises($q$UPDATE public.cmms_company_profiles SET site_slug = 'icanera' WHERE id = '00000000-0000-0000-0000-00000000a005'$q$));
  PERFORM t.check('7b.5 the old address of that company keeps opening it',
    (SELECT company_id FROM public.fn_resolve_public_site_slug('icanera-business')) = '00000000-0000-0000-0000-00000000a006');
END $t$;

-- ============ 8. Deleting a business
DO $t$
BEGIN
  DELETE FROM public.cmms_company_profiles WHERE id = t.u(101);
  PERFORM t.check('8.1 deleting a business removes its retired addresses too', NOT EXISTS (SELECT 1 FROM public.cmms_company_site_slug_history WHERE company_id = t.u(101)));
  PERFORM t.check('8.2 ... and frees the address for a newcomer', public.fn_allocate_company_site_slug('Kampala Mart Uganda') = 'kampala-mart-uganda');
END $t$;

\set ON_ERROR_STOP on
-- Registered-company gate + HQ admin allowlist + security invariants. Runs after 02 and 03.

-- ================================================================ 22. Only registered companies
DO $t$
DECLARE e TEXT; r JSONB; v_p UUID; v_dev UUID := t.u(900);
BEGIN
  PERFORM t.as_user(t.u(20));
  e := t.err($$SELECT public.ican_franchise_apply('agency','UG','','REG-777777')$$);
  PERFORM t.check('22.1 an application without a company name is refused', e LIKE '%registered company%', e);
  e := t.err($$SELECT public.ican_franchise_apply('agency','UG','Some Ltd','x')$$);
  PERFORM t.check('22.2 an application without a real registration number is refused', e LIKE '%registration number%', e);
  e := t.err($$SELECT public.ican_franchise_apply('agency','UG','Some Ltd','REG 777 777', 'UG', 'http://insecure.example/cert.pdf')$$);
  PERFORM t.check('22.3 an insecure certificate link is refused', e LIKE '%https%', e);
  e := t.err($$SELECT public.ican_franchise_apply('agency','UG','Another Ltd','reg.000005')$$);
  PERFORM t.check('22.4 the same registration as a LIVE partner (case/punctuation ignored) cannot take a second seat', e LIKE '%already holds%', e);
  r := public.ican_franchise_apply('agency', 'UG', 'Real Registered Ltd', '80020001234567', 'UG', 'https://drive.google.com/file/d/abc/view', 'Real Trading', 'Gulu');
  PERFORM t.check('22.5 a registered company applies (certificate link kept, company check pending)',
    r->>'company_status' = 'pending' AND (SELECT company_document_url FROM public.ican_franchise_partners WHERE id = (r->>'id')::UUID) = 'https://drive.google.com/file/d/abc/view'
    AND (SELECT display_name FROM public.ican_franchise_partners WHERE id = (r->>'id')::UUID) = 'Real Trading', r::TEXT);
  v_p := (r->>'id')::UUID;
  PERFORM t.check('22.6 the applicant sees their company verification status',
    (SELECT x->>'company_status' FROM jsonb_array_elements(public.ican_franchise_my_summary()) x WHERE x->>'id' = v_p::TEXT) = 'pending');
  PERFORM t.reset();

  PERFORM t.as_user(v_dev);
  PERFORM t.check('22.7 HQ cannot create a partner without company details',
    t.err($$SELECT public.ican_franchise_admin_save_partner(NULL, '{"partner_type":"agency","country_code":"UG","display_name":"No Co"}')$$) LIKE '%registered company%');
  PERFORM public.ican_franchise_admin_save_partner(v_p, '{"kyc_status":"verified","company_status":"rejected"}');
  PERFORM t.check('22.8 a rejected company cannot go active',
    t.err(format($$SELECT public.ican_franchise_admin_set_status(%L,'active')$$, v_p)) LIKE '%company registration must be verified%');
  PERFORM public.ican_franchise_admin_save_partner(v_p, '{"company_status":"verified"}');
  PERFORM t.check('22.9 verifying stamps who and when',
    (SELECT company_verified_by = v_dev AND company_verified_at IS NOT NULL FROM public.ican_franchise_partners WHERE id = v_p));
  PERFORM public.ican_franchise_admin_save_partner(v_p, '{"company_status":"pending"}');
  PERFORM t.check('22.10 un-verifying clears the stamp',
    (SELECT company_verified_by IS NULL AND company_verified_at IS NULL FROM public.ican_franchise_partners WHERE id = v_p));
  PERFORM public.ican_franchise_admin_save_partner(v_p, '{"company_status":"verified"}');
  PERFORM public.ican_franchise_admin_set_status(v_p, 'active');
  PERFORM t.check('22.11 once KYC and the registration are both verified the partner goes active',
    (SELECT status FROM public.ican_franchise_partners WHERE id = v_p) = 'active');
  PERFORM t.reset();
  PERFORM t.check('22.12 invariant: no active partner has an unverified company',
    NOT EXISTS (SELECT 1 FROM public.ican_franchise_partners WHERE status = 'active' AND company_status <> 'verified'));
  PERFORM t.check('22.13 a partner row cannot exist without company details (schema level)',
    t.err($$INSERT INTO public.ican_franchise_partners (partner_code,partner_type,country_code,display_name) VALUES ('Z','agency','UG','Sneaky Ltd')$$) LIKE '%null value%');
END $t$;

-- ================================================================ 23. HQ admin allowlist (a real account, never a static token)
DO $t$
DECLARE r JSONB; l JSONB;
BEGIN
  PERFORM t.as_user(t.u(1));
  PERFORM t.check('23.1 an ordinary account is not HQ admin', NOT public.ican_franchise_is_hq_admin());
  PERFORM t.check('23.2 and cannot grant admin', t.err($$SELECT public.ican_franchise_admin_grant_admin('u20@test.dev')$$) LIKE '%restricted%');
  PERFORM t.as_user(t.u(900));
  PERFORM t.check('23.3 an unknown email cannot be made admin', t.err($$SELECT public.ican_franchise_admin_grant_admin('nobody@nowhere.test')$$) LIKE '%No account%');
  r := public.ican_franchise_admin_grant_admin('u20@test.dev', 'founder');
  l := public.ican_franchise_admin_list_admins();
  PERFORM t.check('23.4 a developer can add a founder to the allowlist and see the list',
    r ? 'user_id' AND jsonb_array_length(l) = 1 AND l->0->>'email' = 'u20@test.dev', l::TEXT);
  PERFORM t.as_user(t.u(20));
  PERFORM t.check('23.5 an allowlisted account (not a developer) is HQ admin', public.ican_franchise_is_hq_admin());
  PERFORM t.check('23.6 and can administer (save a territory, read the overview)',
    public.ican_franchise_admin_save_territory('TZ', NULL, 2, 'reserved') ->> 'status' = 'reserved'
    AND public.ican_franchise_admin_overview() ? 'liability');
  PERFORM t.check('23.7 but cannot revoke itself (no lock-out by accident)',
    t.err(format($$SELECT public.ican_franchise_admin_revoke_admin(%L)$$, t.u(20))) LIKE '%own admin access%');
  PERFORM t.check('23.8 the allowlist table is not directly readable', t.err($$SELECT * FROM public.ican_franchise_admins$$) LIKE '%permission denied%');
  PERFORM t.as_user(t.u(900));
  PERFORM t.check('23.9 a developer revokes it', public.ican_franchise_admin_revoke_admin(t.u(20)) = TRUE);
  PERFORM t.as_user(t.u(20));
  PERFORM t.check('23.10 and access is gone immediately', NOT public.ican_franchise_is_hq_admin());
  PERFORM t.as_anon();
  PERFORM t.check('23.11 anon cannot grant admin', t.err($$SELECT public.ican_franchise_admin_grant_admin('u20@test.dev')$$) LIKE '%permission denied%');
  PERFORM t.reset();
END $t$;

-- ================================================================ 24. Security invariants over the whole surface
DO $t$
DECLARE v_anon TEXT; v_tok INT; v_def_nosp INT; v_tables TEXT;
BEGIN
  SELECT COUNT(*) INTO v_tok FROM pg_proc WHERE proname LIKE 'ican_franchise_%' AND pg_get_function_arguments(oid) ILIKE '%token%';
  PERFORM t.check('24.1 no franchise function accepts a static dev token', v_tok = 0, v_tok::TEXT);

  SELECT string_agg(proname, ', ' ORDER BY proname) INTO v_anon FROM pg_proc
   WHERE proname LIKE 'ican_franchise_%' AND has_function_privilege('anon', oid, 'EXECUTE');
  PERFORM t.check('24.2 anonymous visitors can run exactly two functions (overview + request form)',
    v_anon = 'ican_franchise_public_overview, ican_franchise_submit_enquiry', v_anon);

  SELECT COUNT(*) INTO v_def_nosp FROM pg_proc p
   WHERE proname LIKE 'ican_franchise_%' AND prosecdef AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(proconfig, '{}')) c WHERE c LIKE 'search_path=%');
  PERFORM t.check('24.3 every SECURITY DEFINER function pins its search_path', v_def_nosp = 0, v_def_nosp::TEXT);

  SELECT string_agg(c.relname, ', ') INTO v_tables FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname LIKE 'ican_franchise_%' AND c.relkind = 'r' AND NOT c.relrowsecurity;
  PERFORM t.check('24.4 every franchise table has row level security on', v_tables IS NULL, v_tables);

  PERFORM t.check('24.5 no franchise table is writable by the browser roles',
    NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants
                 WHERE table_name LIKE 'ican_franchise_%' AND grantee IN ('anon', 'authenticated')
                   AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')));
  PERFORM t.check('24.6 anon has no table access at all',
    NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_name LIKE 'ican_franchise_%' AND grantee = 'anon'));
END $t$;

-- ================================================================ 25. Every country is open from day one
DO $t$
DECLARE r JSONB; e TEXT; n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM public.ican_franchise_territories;
  PERFORM t.check('25.1 every country the app supports at sign-up is a territory (189+)', n >= 189, n::TEXT);
  PERFORM t.check('25.2 including ones nobody has mentioned yet',
    (SELECT COUNT(*) FROM public.ican_franchise_territories WHERE country_code IN ('BR', 'JP', 'NZ', 'IS', 'CL', 'ZM', 'VN', 'PE') AND status = 'open') = 8);
  PERFORM t.check('25.3 the original tiers and Uganda being live are kept',
    (SELECT tier FROM public.ican_franchise_territories WHERE country_code = 'NG') = 1
    AND (SELECT tier FROM public.ican_franchise_territories WHERE country_code = 'BR') = 2
    AND (SELECT status FROM public.ican_franchise_territories WHERE country_code = 'UG') = 'active');

  -- a registered company applies in a country HQ has never touched: no one opens it first
  PERFORM t.as_user(t.u(1));
  r := public.ican_franchise_apply('agency', 'BR', 'Sao Paulo Digital Ltda', 'BR-CNPJ-123456', 'BR');
  PERFORM t.reset();
  PERFORM t.check('25.4 a company in Brazil can apply immediately', r->>'status' = 'applied' AND r->>'partner_code' LIKE 'BR-AG-%', r::TEXT);

  -- visitors: by name or by code, in any case; junk refused
  PERFORM t.as_anon();
  r := public.ican_franchise_submit_enquiry('Hiro Tanaka', 'hiro@example.jp', 'Japan', 'Tanaka KK', 'JP-1234567890', NULL, 'agency');
  PERFORM t.reset();
  PERFORM t.check('25.5 a request naming Japan resolves to JP', (SELECT country_code FROM public.ican_franchise_enquiries WHERE id = (r->>'id')::UUID) = 'JP', r::TEXT);
  PERFORM t.as_anon();
  r := public.ican_franchise_submit_enquiry('Ana Lima', 'ana@example.pt', 'br', 'Lima Ltda', 'BR-LIMA-0001', 'PT', 'referral');
  PERFORM t.reset();
  PERFORM t.check('25.6 a lower-case code works, and a different registration country is kept',
    (SELECT country_code || '/' || company_reg_country FROM public.ican_franchise_enquiries WHERE id = (r->>'id')::UUID) = 'BR/PT', r::TEXT);
  PERFORM t.as_anon();
  e := t.err($$SELECT public.ican_franchise_submit_enquiry('Zed Zed', 'zz@example.com', 'ZZ', 'Zed Ltd', 'ZED-0001')$$);
  PERFORM t.check('25.7 a made-up country code is refused', e LIKE '%choose your country%', e);
  e := t.err($$SELECT public.ican_franchise_submit_enquiry('Zed Zed', 'zz@example.com', 'BR', 'Zed Ltd', 'ZED-0001', 'QQ')$$);
  PERFORM t.check('25.8 a made-up registration country is refused', e LIKE '%registered%', e);
  PERFORM t.reset();

  -- pausing one country stops requests and applications there, and only there
  UPDATE public.ican_franchise_territories SET status = 'paused' WHERE country_code = 'IS';
  PERFORM t.as_anon();
  e := t.err($$SELECT public.ican_franchise_submit_enquiry('Ola Nord', 'ola@example.is', 'Iceland', 'Nord ehf', 'IS-0001')$$);
  PERFORM t.check('25.9 a paused country takes no requests', e LIKE '%not taking franchise requests%', e);
  PERFORM t.as_user(t.u(1));
  e := t.err($$SELECT public.ican_franchise_apply('agency', 'IS', 'Nord ehf', 'IS-0001')$$);
  PERFORM t.check('25.10 or applications', e LIKE '%not open for partners%', e);
  PERFORM t.reset();
  UPDATE public.ican_franchise_territories SET status = 'open' WHERE country_code = 'IS';

  PERFORM t.as_anon();
  r := public.ican_franchise_public_overview();
  PERFORM t.reset();
  PERFORM t.check('25.11 the landing page is told where an exclusive Country Master seat is already taken', r->'exclusive_masters' @> '["UG"]', r::TEXT);
END $t$;

-- ================================================================ 26. Optional columns that may not exist can never stop a fee being shared
DO $t$
DECLARE r JSONB; ev public.ican_franchise_revenue_events;
BEGIN
  -- Customer 11 owns business b(11) in UG, served by no one: the master (t.u(1), products incl. icanera) serves directly.
  ALTER TABLE public.business_profiles RENAME COLUMN country TO country_gone;       -- as if that migration was never run
  ALTER TABLE public.user_accounts RENAME COLUMN country_code TO country_code_gone;
  PERFORM t.check('26.1 with both optional columns missing the lookup returns nothing instead of failing',
    public.ican_franchise_country_of(t.u(11), t.b(11)) IS NULL);
  PERFORM t.fee('ican', 'nocol-1', 'corporate_subscription', 11, 100, '{"country_code": "UG"}');
  SELECT * INTO ev FROM public.ican_franchise_revenue_events WHERE source_reference = 'nocol-1';
  PERFORM t.check('26.2 and a fee that names its country is still shared', ev.id IS NOT NULL, 'no event created');
  PERFORM t.check('26.3 nothing was parked as an error', NOT EXISTS (SELECT 1 FROM public.ican_franchise_allocation_errors WHERE source_reference = 'nocol-1'));
  ALTER TABLE public.business_profiles RENAME COLUMN country_gone TO country;
  ALTER TABLE public.user_accounts RENAME COLUMN country_code_gone TO country_code;
  PERFORM t.check('26.4 with the columns back, the business country is used again', public.ican_franchise_country_of(t.u(11), t.b(11)) = 'UG');
END $t$;

SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, name, CASE WHEN ok THEN '' ELSE COALESCE(left(info, 400), '') END AS detail
  FROM t.results WHERE NOT ok ORDER BY n;
SELECT COUNT(*) FILTER (WHERE ok) AS passed, COUNT(*) FILTER (WHERE NOT ok) AS failed, COUNT(*) AS total FROM t.results;

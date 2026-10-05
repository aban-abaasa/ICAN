\set ON_ERROR_STOP on
-- Era API core: keys, sandbox vs live, scopes, limits, the sign-up and claim flow, administration, grants, abuse cases.

TRUNCATE t.results;

-- Fixtures reused below. psql variables hold keys between blocks.
CREATE TABLE t.vars (k TEXT PRIMARY KEY, v TEXT);
GRANT ALL ON t.vars TO PUBLIC;
CREATE FUNCTION t.v(p_k TEXT) RETURNS TEXT LANGUAGE sql AS $$ SELECT v FROM t.vars WHERE k = p_k $$;
CREATE FUNCTION t.setv(p_k TEXT, p_v TEXT) RETURNS VOID LANGUAGE sql AS $$ INSERT INTO t.vars VALUES (p_k, p_v) ON CONFLICT (k) DO UPDATE SET v = p_v $$;
GRANT EXECUTE ON FUNCTION t.v(TEXT), t.setv(TEXT, TEXT) TO PUBLIC;

INSERT INTO public.ican_coin_market_prices (price_usd, price_ugx, price_eur, price_gbp, price_jpy, percentage_change_24h, percentage_change_7d)
VALUES (1.38151, 5508.42, 1.228, 1.044, 217.9, 0.15, 0);
INSERT INTO public.ican_currency_rates (currency_code, currency_name, country_code, region, rate_to_ugx, local_inflation_pct) VALUES
  ('KES', 'Kenyan Shilling', 'KE', 'Africa', 30.8, 5.1), ('USD', 'US Dollar', 'US', 'Americas', 3987, 3.1);

-- ================================================================ 1. Tables are sealed from the browser
DO $t$
DECLARE tbl TEXT; e TEXT; bad TEXT := '';
BEGIN
  PERFORM t.as_anon();
  FOREACH tbl IN ARRAY ARRAY['era_api_keys','era_api_clients','era_api_usage','era_api_log','era_api_audit','era_api_admins','era_api_settings','era_api_endpoints'] LOOP
    e := t.err(format('SELECT 1 FROM public.%I LIMIT 1', tbl));
    IF e IS NULL OR e NOT LIKE '%permission denied%' THEN bad := bad || tbl || ' '; END IF;
  END LOOP;
  PERFORM t.reset();
  PERFORM t.check('1.1 anon cannot read any era_api table', bad = '', bad);

  PERFORM t.as_user('00000000-0000-0000-0000-000000000002');
  bad := '';
  FOREACH tbl IN ARRAY ARRAY['era_api_keys','era_api_clients','era_api_usage','era_api_log','era_api_audit','era_api_admins','era_api_settings','era_api_endpoints'] LOOP
    e := t.err(format('SELECT 1 FROM public.%I LIMIT 1', tbl));
    IF e IS NULL OR e NOT LIKE '%permission denied%' THEN bad := bad || tbl || ' '; END IF;
    e := t.err(format('INSERT INTO public.%I DEFAULT VALUES', tbl));
    IF e IS NULL OR e NOT LIKE '%permission denied%' THEN bad := bad || tbl || '(w) '; END IF;
  END LOOP;
  PERFORM t.reset();
  PERFORM t.check('1.2 a signed-in user cannot read or write any era_api table', bad = '', bad);
END $t$;

-- ================================================================ 2. Public information and the catalogue
DO $t$
DECLARE i JSONB; c JSONB;
BEGIN
  PERFORM t.as_anon();
  i := public.era_api_public_info(); c := public.era_api_catalog();
  PERFORM t.reset();
  PERFORM t.check('2.1 public info says enabled and counts endpoints', (i->>'enabled')::BOOLEAN AND (i->>'endpoints')::INT = 20, i::TEXT);
  PERFORM t.check('2.2 catalogue lists every endpoint, never a handler name',
    jsonb_array_length(c->'endpoints') = 20 AND c::TEXT NOT LIKE '%era_h_%' AND jsonb_array_length(c->'apps') = 5, jsonb_array_length(c->'endpoints')::TEXT);
END $t$;

-- ================================================================ 3. Getting a key (no account)
DO $t$
DECLARE r JSONB; e TEXT; v_before INT; v_ip TEXT := 'iphash-a';
BEGIN
  PERFORM t.as_anon();
  e := t.err($$SELECT public.era_api_request_access('x', NULL, 'a@b.dev', NULL, NULL, ARRAY['icanera'])$$);
  PERFORM t.check('3.1 a one-letter app name is refused', e LIKE '%name%', e);
  e := t.err($$SELECT public.era_api_request_access('My app', NULL, 'not-an-email', NULL, NULL, ARRAY['icanera'])$$);
  PERFORM t.check('3.2 a bad email is refused', e LIKE '%email%', e);
  e := t.err($$SELECT public.era_api_request_access('My app', NULL, 'a@b.dev', 'javascript:alert(1)', NULL, ARRAY['icanera'])$$);
  PERFORM t.check('3.3 a non-http website is refused', e LIKE '%http%', e);
  e := t.err($$SELECT public.era_api_request_access('My app', NULL, 'a@b.dev', NULL, NULL, ARRAY['nonsense'])$$);
  PERFORM t.check('3.4 unknown apps are refused', e LIKE '%at least one%', e);
  PERFORM t.reset();

  SELECT COUNT(*) INTO v_before FROM public.era_api_clients;
  PERFORM t.as_anon();
  r := public.era_api_request_access('Honey', NULL, 'bot@b.dev', NULL, NULL, ARRAY['icanera'], v_ip, 'http://spam');
  PERFORM t.reset();
  PERFORM t.check('3.5 honeypot: believable answer, nothing stored',
    r->>'ticket' LIKE 'era_tk_%' AND (SELECT COUNT(*) FROM public.era_api_clients) = v_before);

  PERFORM t.as_anon();
  r := public.era_api_request_access('  Farm Dash  ', 'Ada', 'Ada@Example.COM', 'https://farmdash.dev', 'A dashboard', ARRAY['farmagentera','icanera','icanera'], v_ip);
  PERFORM t.reset();
  PERFORM t.check('3.6 request returns a ticket and a sandbox key, pending',
    r->>'status' = 'pending' AND r->>'ticket' ~ '^era_tk_[0-9a-f]{40}$' AND r#>>'{sandbox_key,key}' ~ '^era_test_[0-9a-f]{40}$', r::TEXT);
  PERFORM t.check('3.7 name trimmed, email lower-cased, apps de-duplicated',
    (SELECT app_name = 'Farm Dash' AND contact_email = 'ada@example.com' AND requested_apps = ARRAY['farmagentera','icanera'] FROM public.era_api_clients WHERE id = (r->>'client_id')::UUID));
  PERFORM t.check('3.8 neither ticket nor key is stored in plaintext',
    NOT EXISTS (SELECT 1 FROM public.era_api_clients WHERE ticket_hash = r->>'ticket')
    AND NOT EXISTS (SELECT 1 FROM public.era_api_keys WHERE key_hash = r#>>'{sandbox_key,key}')
    AND EXISTS (SELECT 1 FROM public.era_api_keys WHERE key_hash = encode(sha256(convert_to(r#>>'{sandbox_key,key}', 'UTF8')), 'hex')));
  PERFORM t.setv('ticket', r->>'ticket'); PERFORM t.setv('sandbox', r#>>'{sandbox_key,key}'); PERFORM t.setv('client', r->>'client_id');

  -- per-email limit: 3 a day
  PERFORM t.as_anon();
  PERFORM public.era_api_request_access('Second', NULL, 'ada@example.com', NULL, NULL, ARRAY['icanera']);
  PERFORM public.era_api_request_access('Third', NULL, 'ada@example.com', NULL, NULL, ARRAY['icanera']);
  e := t.err($$SELECT public.era_api_request_access('Fourth', NULL, 'ada@example.com', NULL, NULL, ARRAY['icanera'])$$);
  PERFORM t.reset();
  PERFORM t.check('3.9 a fourth sign-up from one email in a day is refused', e LIKE '%Too many%', e);
END $t$;

-- ================================================================ 4. The sandbox key works at once; live waits for approval
DO $t$
DECLARE r JSONB; sk TEXT := t.v('sandbox'); tk TEXT := t.v('ticket'); e TEXT; s JSONB;
BEGIN
  r := t.call(sk, '/icanera/coin/price', '{"currency":"UGX"}');
  PERFORM t.check('4.1 sandbox key returns 200 with fixture data', r->>'status' = '200' AND r#>>'{body,meta,mode}' = 'sandbox' AND r#>>'{body,data,source}' = 'sandbox-fixture', r::TEXT);
  PERFORM t.check('4.2 rate-limit headers are present', r#>>'{headers,x-ratelimit-limit}' = '30' AND (r#>>'{headers,x-ratelimit-remaining}')::INT = 29 AND r#>>'{headers,x-era-mode}' = 'sandbox', r->>'headers');

  -- a sandbox key reaches every app, but only fixtures
  r := t.call(sk, '/bodagoera/stages');
  PERFORM t.check('4.3 sandbox key reaches all four apps', r->>'status' = '200' AND jsonb_array_length(r#>'{body,data}') = 2, r::TEXT);

  PERFORM t.as_anon(); s := public.era_api_ticket_status(tk); PERFORM t.reset();
  PERFORM t.check('4.4 ticket status: pending, cannot issue live, never shows a key',
    s->>'status' = 'pending' AND (s->>'can_issue_live')::BOOLEAN = FALSE AND s::TEXT !~ 'era_(test|live)_[0-9a-f]{40}' AND s::TEXT NOT LIKE '%key_hash%', s::TEXT);
  PERFORM t.as_anon();
  e := t.err(format('SELECT public.era_api_issue_key(%L, %L)', tk, 'live'));
  PERFORM t.reset();
  PERFORM t.check('4.5 live key cannot be issued before approval', e LIKE '%not been approved%', e);
  PERFORM t.as_anon();
  e := t.err($$SELECT public.era_api_ticket_status('era_tk_00000000000000000000000000000000000000ff')$$);
  PERFORM t.reset();
  PERFORM t.check('4.6 an unknown ticket is refused', e LIKE '%not valid%', e);
END $t$;

-- ================================================================ 5. Bad keys
DO $t$
DECLARE r JSONB; sk TEXT := t.v('sandbox'); i INT; last_status INT;
BEGIN
  PERFORM t.check('5.1 no key -> 401 missing_key', t.call(NULL, '/whoami')#>>'{body,error,code}' = 'missing_key');
  PERFORM t.check('5.2 malformed key -> 401 invalid_key', t.call('hello', '/whoami')#>>'{body,error,code}' = 'invalid_key');
  PERFORM t.check('5.3 well-formed but unknown key -> 401', t.call('era_live_' || repeat('a', 40), '/whoami')->>'status' = '401');
  PERFORM t.check('5.4 error bodies never contain SQL or a key',
    t.call('era_live_' || repeat('a', 40), '/whoami')::TEXT !~* '(select|public\.|sqlstate)');
  -- guessing is throttled per caller
  FOR i IN 1..45 LOOP
    last_status := (t.call('era_live_' || repeat('b', 40), '/whoami', '{}', 'guesser'))->>'status';
  END LOOP;
  PERFORM t.check('5.5 a caller guessing keys is throttled (429)', last_status = 429, last_status::TEXT);
  PERFORM t.check('5.6 ...but another caller is not', t.call(sk, '/whoami', '{}', 'honest')->>'status' = '200');
  PERFORM t.check('5.7 POST is refused: v1 is read-only', t.call(sk, '/whoami', '{}', NULL, 'POST')->>'status' = '405');
  PERFORM t.check('5.8 unknown endpoint -> 404', t.call(sk, '/nope/nothing')#>>'{body,error,code}' = 'unknown_endpoint');
END $t$;

-- ================================================================ 6. Approval, live key, scopes, rotation
DO $t$
DECLARE r JSONB; tk TEXT := t.v('ticket'); cid UUID := t.v('client')::UUID; e TEXT; k JSONB; lk TEXT; old TEXT;
BEGIN
  -- only a real admin can review
  PERFORM t.as_anon();
  e := t.err(format('SELECT public.era_api_admin_review(%L, %L)', cid, 'approve'));
  PERFORM t.reset();
  PERFORM t.check('6.1 anon cannot review (no execute)', e LIKE '%permission denied%', e);
  PERFORM t.as_user('00000000-0000-0000-0000-000000000002');
  e := t.err(format('SELECT public.era_api_admin_review(%L, %L)', cid, 'approve'));
  PERFORM t.reset();
  PERFORM t.check('6.2 a signed-in non-admin cannot review', e LIKE '%restricted%', e);

  PERFORM t.as_user('00000000-0000-0000-0000-000000000001');   -- a platform developer
  r := public.era_api_admin_review(cid, 'approve', ARRAY['icanera'], 3, 5, 'looks fine');
  PERFORM t.reset();
  PERFORM t.check('6.3 a developer approves with a narrower scope and tight limits', r->>'status' = 'approved', r::TEXT);

  PERFORM t.as_anon(); k := public.era_api_issue_key(tk, 'live'); PERFORM t.reset();
  lk := k->>'key';
  PERFORM t.check('6.4 live key issued once approved', lk ~ '^era_live_[0-9a-f]{40}$', k::TEXT);
  PERFORM t.setv('live', lk);

  r := t.call(lk, '/icanera/coin/price', '{"currency":"UGX"}');
  PERFORM t.check('6.5 live key reads real rows', r->>'status' = '200' AND r#>>'{body,meta,mode}' = 'live' AND (r#>>'{body,data,price}')::NUMERIC = 5508.42, r::TEXT);
  r := t.call(lk, '/bodagoera/stages');
  PERFORM t.check('6.6 live key is limited to the approved app (403 scope_missing)', r->>'status' = '403' AND r#>>'{body,error,code}' = 'scope_missing', r::TEXT);
  r := t.call(lk, '/whoami');
  PERFORM t.check('6.7 whoami reports mode, apps and limits', r#>>'{body,data,mode}' = 'live' AND r#>>'{body,data,apps}' = '["icanera"]' AND r#>>'{body,data,limits,per_minute}' = '3', r::TEXT);

  -- the limit is 3 per minute: whoami above was call 3 (coin price, bodagoera, whoami), so the next one is refused
  r := t.call(lk, '/whoami');
  PERFORM t.check('6.8 per-minute limit: 4th call is 429 with retry-after', r->>'status' = '429' AND r#>>'{body,error,code}' = 'rate_limited' AND (r#>>'{headers,retry-after}')::INT BETWEEN 1 AND 60, r::TEXT);
  PERFORM t.check('6.9 the 429 still carries the limit headers', r#>>'{headers,x-ratelimit-remaining}' = '0', r->>'headers');

  -- rotation: the old live key stops working at once
  old := lk;
  PERFORM t.as_anon(); k := public.era_api_issue_key(tk, 'live'); PERFORM t.reset();
  PERFORM t.check('6.10 rotating yields a different key', k->>'key' <> old);
  -- reset the minute counter so only the revocation is under test
  DELETE FROM public.era_api_usage WHERE period = 'm';
  PERFORM t.check('6.11 the old live key is revoked', t.call(old, '/whoami')#>>'{body,error,code}' = 'key_revoked');
  PERFORM t.check('6.12 the new one works', t.call(k->>'key', '/whoami')->>'status' = '200');
  PERFORM t.setv('live', k->>'key');
  PERFORM t.check('6.13 plaintext keys never reach the audit log',
    NOT EXISTS (SELECT 1 FROM public.era_api_audit WHERE detail::TEXT LIKE '%' || (k->>'key') || '%'));
END $t$;

-- ================================================================ 7. Daily quota
DO $t$
DECLARE r JSONB; lk TEXT := t.v('live'); i INT;
BEGIN
  DELETE FROM public.era_api_usage WHERE period = 'm';
  PERFORM public.era_api_admin_review(t.v('client')::UUID, 'approve', NULL, 100, 4, NULL);   -- as superuser: is_service is false, so this must fail
EXCEPTION WHEN OTHERS THEN
  PERFORM t.check('7.0 review without an admin identity is refused even for the table owner', SQLERRM LIKE '%restricted%', SQLERRM);
END $t$;
DO $t$
DECLARE r JSONB; lk TEXT := t.v('live'); i INT;
BEGIN
  PERFORM t.as_service();
  PERFORM public.era_api_admin_review(t.v('client')::UUID, 'approve', NULL, 100, 4, NULL);
  PERFORM t.reset();
  DELETE FROM public.era_api_usage WHERE period IN ('m', 'd');
  FOR i IN 1..4 LOOP r := t.call(lk, '/whoami'); END LOOP;
  PERFORM t.check('7.1 four calls fit the daily quota of 4', r->>'status' = '200' AND r#>>'{headers,x-quota-remaining}' = '0', r->>'headers');
  r := t.call(lk, '/whoami');
  PERFORM t.check('7.2 the fifth is refused as quota_exceeded', r->>'status' = '429' AND r#>>'{body,error,code}' = 'quota_exceeded' AND (r#>>'{headers,retry-after}')::INT > 0, r::TEXT);
  DELETE FROM public.era_api_usage;
END $t$;

-- ================================================================ 8. Suspension, kill switches
DO $t$
DECLARE r JSONB; lk TEXT := t.v('live'); sk TEXT := t.v('sandbox'); cid UUID := t.v('client')::UUID; e TEXT;
BEGIN
  PERFORM t.as_user('00000000-0000-0000-0000-000000000003');
  e := t.err($$SELECT public.era_api_admin_overview()$$);
  PERFORM t.reset();
  PERFORM t.check('8.0 an unlisted user is not an admin', e LIKE '%restricted%', e);

  INSERT INTO public.era_api_admins (user_id, note) VALUES ('00000000-0000-0000-0000-000000000003', 'test');
  PERFORM t.as_user('00000000-0000-0000-0000-000000000003');
  PERFORM public.era_api_admin_review(cid, 'suspend', NULL, NULL, NULL, 'abuse');
  PERFORM t.reset();
  PERFORM t.check('8.1 an API-admin-list account can suspend', (SELECT status FROM public.era_api_clients WHERE id = cid) = 'suspended');
  PERFORM t.check('8.2 a suspended app is blocked on live AND sandbox keys',
    t.call(lk, '/whoami')#>>'{body,error,code}' = 'app_suspended' AND t.call(sk, '/whoami')#>>'{body,error,code}' = 'app_suspended');
  PERFORM t.as_user('00000000-0000-0000-0000-000000000004');   -- a franchise admin counts too
  PERFORM public.era_api_admin_review(cid, 'reinstate', NULL, NULL, NULL, NULL);
  PERFORM t.reset();
  PERFORM t.check('8.3 a franchise admin can reinstate; it returns to approved', (SELECT status FROM public.era_api_clients WHERE id = cid) = 'approved');

  PERFORM t.as_user('00000000-0000-0000-0000-000000000001');
  PERFORM public.era_api_admin_set_endpoint('icanera.coin_price', FALSE, NULL);
  PERFORM t.reset();
  r := t.call(sk, '/icanera/coin/price');
  PERFORM t.check('8.4 a disabled endpoint answers 503 endpoint_disabled', r->>'status' = '503' AND r#>>'{body,error,code}' = 'endpoint_disabled', r::TEXT);
  PERFORM t.check('8.5 disabled endpoints leave the public catalogue',
    NOT (public.era_api_catalog()::TEXT LIKE '%icanera.coin_price%'));
  PERFORM t.as_user('00000000-0000-0000-0000-000000000001');
  PERFORM public.era_api_admin_set_endpoint('icanera.coin_price', TRUE, 45);
  PERFORM t.reset();
  PERFORM t.check('8.6 and re-enabling restores it, with the new cache time',
    t.call(sk, '/icanera/coin/price')#>>'{headers,cache-control}' = 'private, max-age=45');

  PERFORM t.as_user('00000000-0000-0000-0000-000000000001');
  PERFORM public.era_api_admin_save_settings('{"sandbox_enabled": false}');
  PERFORM t.reset();
  PERFORM t.check('8.7 sandbox kill switch', t.call(sk, '/whoami')#>>'{body,error,code}' = 'sandbox_disabled');
  PERFORM t.as_user('00000000-0000-0000-0000-000000000001');
  PERFORM public.era_api_admin_save_settings('{"sandbox_enabled": true, "enabled": false}');
  PERFORM t.reset();
  PERFORM t.check('8.8 master kill switch answers 503 for everyone', t.call(sk, '/whoami')#>>'{body,error,code}' = 'api_disabled' AND t.call(lk, '/whoami')->>'status' = '503');
  PERFORM t.as_anon();
  e := t.err($$SELECT public.era_api_request_access('Paused', NULL, 'pause@x.dev', NULL, NULL, ARRAY['icanera'])$$);
  PERFORM t.reset();
  PERFORM t.check('8.9 sign-ups refuse while the API is off', e LIKE '%paused%', e);
  PERFORM t.as_user('00000000-0000-0000-0000-000000000001');
  PERFORM public.era_api_admin_save_settings('{"enabled": true, "signups_open": false}');
  PERFORM t.reset();
  PERFORM t.as_anon();
  e := t.err($$SELECT public.era_api_request_access('Paused', NULL, 'pause@x.dev', NULL, NULL, ARRAY['icanera'])$$);
  PERFORM t.reset();
  PERFORM t.check('8.10 the sign-up switch alone pauses the form', e LIKE '%paused%', e);
  PERFORM t.check('8.11 ...while keys keep working', t.call(sk, '/whoami')->>'status' = '200');
  PERFORM t.as_user('00000000-0000-0000-0000-000000000001');
  PERFORM public.era_api_admin_save_settings('{"signups_open": true}');
  PERFORM t.reset();
END $t$;

-- ================================================================ 9. The public playground key
DO $t$
DECLARE pk TEXT := 'era_test_9a8d0e2b7f4c1a63d5e8b0f2c47a91d3e6b85f0c'; r JSONB; i INT;
BEGIN
  r := t.call(pk, '/icanera/coin/price', '{"currency":"USD"}', 'visitor-1');
  PERFORM t.check('9.1 the published playground key works and is sandbox', r->>'status' = '200' AND r#>>'{body,meta,mode}' = 'sandbox', r::TEXT);
  FOR i IN 1..25 LOOP r := t.call(pk, '/whoami', '{}', 'visitor-1'); END LOOP;
  PERFORM t.check('9.2 one visitor hitting it hard is limited (20 a minute)', r->>'status' = '429', r->>'status');
  PERFORM t.check('9.3 ...without starving another visitor', t.call(pk, '/whoami', '{}', 'visitor-2')->>'status' = '200');
  PERFORM t.as_user('00000000-0000-0000-0000-000000000001');
  PERFORM t.check('9.4 the playground client cannot be reviewed even by an admin',
    t.err($q$SELECT public.era_api_admin_review('00000000-0000-4000-8000-00000000e7a1', 'suspend')$q$) LIKE '%built-in%');
  PERFORM t.reset();
END $t$;

-- ================================================================ 10. Parameters can't be forged; handlers can't leak
DO $t$
DECLARE r JSONB; sk TEXT := t.v('sandbox'); lk TEXT := t.v('live');
BEGIN
  DELETE FROM public.era_api_usage;
  r := t.call(lk, '/whoami', '{"_mode":"sandbox","_apps":"[\"bodagoera\",\"farmagentera\"]","_client_id":"00000000-0000-4000-8000-00000000e7a1"}');
  PERFORM t.check('10.1 underscore parameters from a caller are ignored (no scope or identity forging)',
    r#>>'{body,data,mode}' = 'live' AND r#>>'{body,data,apps}' = '["icanera"]' AND r#>>'{body,data,app_name}' = 'Farm Dash', r::TEXT);
  r := t.call(sk, '/icanera/fx/rates', '{"currency":"KES''; DROP TABLE public.era_api_keys; --"}');
  PERFORM t.check('10.2 hostile text is just a value', r->>'status' = '200' AND to_regclass('public.era_api_keys') IS NOT NULL, r->>'status');

  -- a handler that blows up: caller gets a generic 500; the real error is logged privately
  CREATE FUNCTION public.era_h_test_boom(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'secret table xyz exploded'; END $f$;
  INSERT INTO public.era_api_endpoints (id, app, path, summary, handler) VALUES ('platform.boom', 'platform', '/boom', 'x', 'public.era_h_test_boom');
  r := t.call(sk, '/boom');
  PERFORM t.check('10.3 an internal error is a generic 500 that leaks nothing', r->>'status' = '500' AND r::TEXT NOT LIKE '%secret%' AND r::TEXT NOT LIKE '%xyz%', r::TEXT);
  PERFORM t.check('10.4 ...but it is logged for administrators', EXISTS (SELECT 1 FROM public.era_api_log WHERE endpoint = 'platform.boom' AND status = 500 AND error LIKE '%xyz exploded%'));
  PERFORM t.check('10.5 the registry refuses a handler that is not an era_h_ function',
    t.err($$INSERT INTO public.era_api_endpoints (id, app, path, summary, handler) VALUES ('platform.evil', 'platform', '/evil', 'x', 'pg_sleep(100)')$$) LIKE '%violates check%'
    AND t.err($$INSERT INTO public.era_api_endpoints (id, app, path, summary, handler) VALUES ('platform.evil2', 'platform', '/evil2', 'x', 'public.era_h_a; drop table x')$$) LIKE '%violates check%');
  PERFORM t.check('10.6 the registry refuses non-GET methods',
    t.err($$INSERT INTO public.era_api_endpoints (id, app, method, path, summary, handler) VALUES ('platform.post', 'platform', 'POST', '/post', 'x', 'public.era_h_a')$$) LIKE '%violates check%');
  DELETE FROM public.era_api_endpoints WHERE id = 'platform.boom';
  DROP FUNCTION public.era_h_test_boom(JSONB, BOOLEAN);
END $t$;

-- ================================================================ 11. Handlers and helpers are not callable from the browser
DO $t$
DECLARE e1 TEXT; e2 TEXT; e3 TEXT; e4 TEXT;
BEGIN
  PERFORM t.as_anon();
  e1 := t.err($$SELECT public.era_h_icanera_coin_price('{}'::jsonb, true)$$);
  e2 := t.err($$SELECT public.era__hash('x')$$);
  e3 := t.err($$SELECT public.era_api_admin_overview()$$);
  e4 := t.err($$SELECT public.era_api_is_admin()$$);
  PERFORM t.reset();
  PERFORM t.check('11.1 anon cannot call a handler, a helper, an admin function or the admin check',
    e1 LIKE '%permission denied%' AND e2 LIKE '%permission denied%' AND e3 LIKE '%permission denied%' AND e4 LIKE '%permission denied%', concat_ws(' | ', e1, e2, e3, e4));
  PERFORM t.as_user('00000000-0000-0000-0000-000000000002');
  PERFORM t.check('11.2 a signed-in non-admin gets false from the admin check', public.era_api_is_admin() = FALSE);
  PERFORM t.reset();
  PERFORM t.as_user('00000000-0000-0000-0000-000000000001');
  PERFORM t.check('11.3 a developer gets true', public.era_api_is_admin() = TRUE);
  PERFORM t.reset();
END $t$;

-- ================================================================ 12. Admin read side
DO $t$
DECLARE o JSONB; l JSONB; ep JSONB; calls JSONB; s JSONB; v_kid UUID;
BEGIN
  v_kid := (SELECT id FROM public.era_api_keys WHERE key_hash = public.era__hash(t.v('sandbox')));
  PERFORM t.as_user('00000000-0000-0000-0000-000000000001');
  o := public.era_api_admin_overview(); l := public.era_api_admin_list_clients(NULL, 50);
  ep := public.era_api_admin_list_endpoints(); calls := public.era_api_admin_recent_calls(NULL, 20);
  s := public.era_api_admin_save_settings('{"sandbox_rate_per_min": 45}');
  PERFORM t.reset();
  PERFORM t.check('12.1 overview shape', (o#>>'{clients,total}')::INT >= 3 AND jsonb_array_length(o->'hourly') = 24 AND o ? 'top_endpoints' AND o#>>'{endpoints,total}' = '20', o::TEXT);
  PERFORM t.check('12.2 client list never exposes a ticket hash or a key hash', l::TEXT NOT LIKE '%ticket_hash%' AND l::TEXT NOT LIKE '%key_hash%');
  PERFORM t.check('12.3 pending applications sort first', l->0->>'status' = 'pending', l->0->>'status');
  PERFORM t.check('12.4 endpoint list carries 24h usage', jsonb_array_length(ep) = 20 AND (SELECT SUM((e->>'calls_24h')::INT) FROM jsonb_array_elements(ep) e) > 0);
  PERFORM t.check('12.5 recent calls available', jsonb_array_length(calls) > 0);
  PERFORM t.check('12.6 settings patch applies', (s->>'sandbox_rate_per_min')::INT = 45);
  PERFORM t.check('12.7 every admin write left an audit row', (SELECT COUNT(*) FROM public.era_api_audit WHERE action IN ('review_approve','review_suspend','review_reinstate','endpoint_changed','settings_changed','key_issued')) >= 8);
  PERFORM t.as_user('00000000-0000-0000-0000-000000000001');
  PERFORM t.check('12.8 revoking a key blocks it', (public.era_api_admin_revoke_key(v_kid, 'test')->>'revoked')::BOOLEAN);
  PERFORM t.reset();
  DELETE FROM public.era_api_usage;
  PERFORM t.check('12.9 ...and the caller sees key_revoked', t.call(t.v('sandbox'), '/whoami')#>>'{body,error,code}' = 'key_revoked');
END $t$;

-- ================================================================ 13. Path matching
DO $t$
BEGIN
  PERFORM t.check('13.1 literal match', public.era__match('/icanera/coin/price', 'icanera/coin/price/') = '{}'::JSONB);
  PERFORM t.check('13.2 literals are case-insensitive', public.era__match('/icanera/coin/price', '/ICANERA/Coin/Price') = '{}'::JSONB);
  PERFORM t.check('13.3 path params keep their case', public.era__match('/icanera/tax/{country}', '/icanera/tax/Ug') = '{"country":"Ug"}'::JSONB);
  PERFORM t.check('13.4 different length does not match', public.era__match('/icanera/tax/{country}', '/icanera/tax') IS NULL AND public.era__match('/a', '/a/b') IS NULL);
  PERFORM t.check('13.5 empty param does not match', public.era__match('/a/{x}', '/a//') IS NULL);
  PERFORM t.check('13.6 empty path does not match', public.era__match('/a', '') IS NULL AND public.era__match('/a', '/') IS NULL);
END $t$;

-- ================================================================ 14. The admin check must not depend on optional tables existing
DO $t$
DECLARE r1 BOOLEAN; r2 BOOLEAN; r3 BOOLEAN; e TEXT;
BEGIN
  ALTER TABLE public.ican_franchise_admins RENAME TO ican_franchise_admins_off;
  ALTER TABLE public.mbg_users RENAME TO mbg_users_off;
  PERFORM t.as_user('00000000-0000-0000-0000-000000000002');
  e := t.err('SELECT public.era_api_is_admin()');
  r1 := public.era_api_is_admin();
  PERFORM t.reset();
  PERFORM t.check('14.1 no franchise or mbg tables: a normal user is simply not an admin (no error)', e IS NULL AND r1 = FALSE, e);
  PERFORM t.as_user('00000000-0000-0000-0000-000000000003');   -- listed in era_api_admins by an earlier block
  r2 := public.era_api_is_admin();
  PERFORM t.reset();
  PERFORM t.check('14.2 ...and the API-admin list still works on its own', r2 = TRUE);
  ALTER TABLE public.ican_franchise_admins_off RENAME TO ican_franchise_admins;
  PERFORM t.as_user('00000000-0000-0000-0000-000000000004');
  r3 := public.era_api_is_admin();
  PERFORM t.reset();
  PERFORM t.check('14.3 with only the franchise table present, a franchise admin is an admin', r3 = TRUE);
  ALTER TABLE public.mbg_users_off RENAME TO mbg_users;
END $t$;

\set ON_ERROR_STOP on
-- Era API developer accounts: sign in (Google), country (existing lookup, detected, chosen), apps owned by a user,
-- instant sandbox keys, live keys only after approval, and nobody ever touching someone else's app.

TRUNCATE t.results;
CREATE TABLE IF NOT EXISTS t.vars (k TEXT PRIMARY KEY, v TEXT);
GRANT ALL ON t.vars TO PUBLIC;
CREATE OR REPLACE FUNCTION t.v(p_k TEXT) RETURNS TEXT LANGUAGE sql AS $$ SELECT v FROM t.vars WHERE k = p_k $$;
CREATE OR REPLACE FUNCTION t.setv(p_k TEXT, p_v TEXT) RETURNS VOID LANGUAGE sql AS $$ INSERT INTO t.vars VALUES (p_k, p_v) ON CONFLICT (k) DO UPDATE SET v = p_v $$;
GRANT EXECUTE ON FUNCTION t.v(TEXT), t.setv(TEXT, TEXT) TO PUBLIC;

-- people: Ada signs in with Google; Ben has an ICAN account that already knows his country; Cleo has no email at all
INSERT INTO auth.users (id, email, raw_user_meta_data, raw_app_meta_data) VALUES
  ('d0000000-0000-0000-0000-00000000000a', 'Ada@Example.COM', '{"full_name":"Ada Lovelace","picture":"https://lh3.example/ada.png"}', '{"provider":"google"}'),
  ('d0000000-0000-0000-0000-00000000000b', 'ben@example.com',  '{"name":"Ben"}', '{"provider":"google"}'),
  ('d0000000-0000-0000-0000-00000000000c', NULL, '{}', '{"provider":"phone"}');
INSERT INTO public.user_accounts (user_id, country_code) VALUES ('d0000000-0000-0000-0000-00000000000b', 'ke');

-- ================================================================ 1. Sealed from the browser; anonymous visitors have no account
DO $t$
DECLARE e TEXT; bad TEXT := ''; f TEXT;
BEGIN
  PERFORM t.as_user('d0000000-0000-0000-0000-00000000000a');
  e := t.err('SELECT 1 FROM public.era_api_developers LIMIT 1');
  PERFORM t.reset();
  PERFORM t.check('1.1 a signed-in user cannot read the developer table directly', e LIKE '%permission denied%', e);
  PERFORM t.as_anon();
  FOREACH f IN ARRAY ARRAY['public.era_api_dev_account()', $$public.era_api_dev_set_country('UG')$$,
      $$public.era_api_dev_create_app('x app', NULL, NULL, ARRAY['icanera'], 'UG')$$,
      $$public.era_api_dev_issue_key('d0000000-0000-0000-0000-00000000000a', 'sandbox')$$,
      'public.era__dev_profile()', $$public.era__country('UG')$$] LOOP
    e := t.err('SELECT ' || f);
    IF e IS NULL OR e NOT LIKE '%permission denied%' THEN bad := bad || f || ' ; '; END IF;
  END LOOP;
  PERFORM t.reset();
  PERFORM t.check('1.2 anon cannot call any developer-account function or helper', bad = '', bad);
  PERFORM t.as_user('d0000000-0000-0000-0000-00000000000c');
  e := t.err('SELECT public.era_api_dev_account()');
  PERFORM t.reset();
  PERFORM t.check('1.3 an account with no email address cannot open a developer account', e LIKE '%no email%', e);
END $t$;

-- ================================================================ 2. First sign-in creates the profile from the Google account
DO $t$
DECLARE a JSONB;
BEGIN
  PERFORM t.as_user('d0000000-0000-0000-0000-00000000000a');
  a := public.era_api_dev_account();
  PERFORM t.reset();
  PERFORM t.check('2.1 profile comes from Google: lower-cased email, name, picture, provider',
    a#>>'{profile,email}' = 'ada@example.com' AND a#>>'{profile,full_name}' = 'Ada Lovelace' AND a#>>'{profile,avatar_url}' = 'https://lh3.example/ada.png' AND a#>>'{profile,provider}' = 'google', a::TEXT);
  PERFORM t.check('2.2 a new account has no apps and no country', jsonb_array_length(a->'apps') = 0 AND a#>>'{profile,country_code}' IS NULL);
  PERFORM t.check('2.3 sandbox testing is on and sign-ups are open', (a#>>'{settings,sandbox_enabled}')::BOOLEAN AND (a#>>'{settings,signups_open}')::BOOLEAN);
  PERFORM t.as_user('d0000000-0000-0000-0000-00000000000a'); PERFORM public.era_api_dev_account(); PERFORM public.era_api_dev_account(); PERFORM t.reset();
  PERFORM t.check('2.4 opening the account again does not duplicate it', (SELECT COUNT(*) FROM public.era_api_developers WHERE user_id = 'd0000000-0000-0000-0000-00000000000a') = 1);
END $t$;

-- ================================================================ 3. Country: existing lookup, detected, chosen
DO $t$
DECLARE a JSONB; e TEXT; r JSONB;
BEGIN
  PERFORM t.as_user('d0000000-0000-0000-0000-00000000000b');
  a := public.era_api_dev_account();
  PERFORM t.reset();
  PERFORM t.check('3.1 someone with an ICAN account gets the country the platform already knows (existing lookup)',
    a#>>'{profile,country_code}' = 'KE' AND a#>>'{profile,country_source}' = 'account', a#>>'{profile}');
  PERFORM t.as_user('d0000000-0000-0000-0000-00000000000b');
  r := public.era_api_dev_set_country('ug', 'detected');
  PERFORM t.reset();
  PERFORM t.check('3.2 a guess from the connection never overwrites the country from their ICAN account', r->>'country_code' = 'KE', r::TEXT);

  PERFORM t.as_user('d0000000-0000-0000-0000-00000000000a');
  r := public.era_api_dev_set_country('ug', 'detected');
  PERFORM t.check('3.3 with no other source, a detected country is kept (and upper-cased)', r->>'country_code' = 'UG' AND r->>'country_source' = 'detected', r::TEXT);
  r := public.era_api_dev_set_country('TZ', 'chosen');
  PERFORM t.check('3.4 a chosen country replaces a guess', r->>'country_code' = 'TZ' AND r->>'country_source' = 'chosen', r::TEXT);
  r := public.era_api_dev_set_country('RW', 'detected');
  PERFORM t.check('3.5 ...and a later guess never replaces a chosen one', r->>'country_code' = 'TZ', r::TEXT);
  e := t.err($$SELECT public.era_api_dev_set_country('UGA')$$);
  PERFORM t.check('3.6 a 3-letter code is refused', e LIKE '%country%', e);
  e := t.err($$SELECT public.era_api_dev_set_country('U1')$$);
  PERFORM t.check('3.7 a code with a digit is refused', e LIKE '%country%', e);
  e := t.err($$SELECT public.era_api_dev_set_country('')$$);
  PERFORM t.check('3.8 an empty country is refused', e LIKE '%country%', e);
  e := t.err($$SELECT public.era_api_dev_set_country('UG', 'robot')$$);
  PERFORM t.check('3.9 an unknown source is refused', e LIKE '%Source%', e);
  PERFORM t.reset();
  PERFORM t.check('3.10 the profile row holds what was chosen',
    (SELECT country_code || country_source FROM public.era_api_developers WHERE user_id = 'd0000000-0000-0000-0000-00000000000a') = 'TZchosen');
END $t$;

-- ================================================================ 4. Registering an app
DO $t$
DECLARE r JSONB; e TEXT; a JSONB; c public.era_api_clients;
BEGIN
  -- Ben has a country from his account; Ada chose TZ. A brand-new user with neither must be asked.
  INSERT INTO auth.users (id, email, raw_user_meta_data, raw_app_meta_data) VALUES ('d0000000-0000-0000-0000-00000000000d', 'dee@example.com', '{}', '{"provider":"google"}');
  PERFORM t.as_user('d0000000-0000-0000-0000-00000000000d');
  e := t.err($$SELECT public.era_api_dev_create_app('Farm Dash', NULL, NULL, ARRAY['farmagentera'])$$);
  PERFORM t.check('4.1 an app cannot be registered until the country is known', e LIKE '%country%', e);
  PERFORM t.reset();

  PERFORM t.as_user('d0000000-0000-0000-0000-00000000000a');
  e := t.err($$SELECT public.era_api_dev_create_app('x', NULL, NULL, ARRAY['icanera'])$$);
  PERFORM t.check('4.2 a one-letter name is refused', e LIKE '%name%', e);
  e := t.err($$SELECT public.era_api_dev_create_app('Farm Dash', 'javascript:alert(1)', NULL, ARRAY['icanera'])$$);
  PERFORM t.check('4.3 a non-http website is refused', e LIKE '%http%', e);
  e := t.err($$SELECT public.era_api_dev_create_app('Farm Dash', NULL, NULL, ARRAY['nonsense'])$$);
  PERFORM t.check('4.4 unknown apps are refused', e LIKE '%at least one%', e);
  e := t.err($$SELECT public.era_api_dev_create_app('Farm Dash', NULL, NULL, ARRAY['icanera'], 'Uganda')$$);
  PERFORM t.check('4.5 a country name instead of a code is refused', e LIKE '%country%', e);

  r := public.era_api_dev_create_app('  Farm Dash  ', 'https://farmdash.dev', 'prices for farmers', ARRAY['farmagentera','icanera','icanera']);
  PERFORM t.reset();
  PERFORM t.check('4.6 an app is created pending, with an instant sandbox key',
    r->>'status' = 'pending' AND r#>>'{sandbox_key,key}' ~ '^era_test_[0-9a-f]{40}$' AND r->>'country_code' = 'TZ', r::TEXT);
  SELECT * INTO c FROM public.era_api_clients WHERE id = (r->>'client_id')::UUID;
  PERFORM t.check('4.7 it belongs to the user, uses the account email and name, the country, and is a developer app',
    c.owner_user_id = 'd0000000-0000-0000-0000-00000000000a' AND c.kind = 'developer' AND c.contact_email = 'ada@example.com' AND c.contact_name = 'Ada Lovelace'
    AND c.country_code = 'TZ' AND c.app_name = 'Farm Dash' AND c.requested_apps = ARRAY['farmagentera','icanera'] AND c.status = 'pending');
  PERFORM t.check('4.8 the key is stored only as a hash',
    NOT EXISTS (SELECT 1 FROM public.era_api_keys WHERE key_hash = r#>>'{sandbox_key,key}')
    AND EXISTS (SELECT 1 FROM public.era_api_keys WHERE key_hash = public.era__hash(r#>>'{sandbox_key,key}')));
  PERFORM t.setv('client', r->>'client_id'); PERFORM t.setv('sandbox', r#>>'{sandbox_key,key}');

  PERFORM t.check('4.9 SANDBOX TESTING: the new key answers real calls at once, with no approval',
    t.call(t.v('sandbox'), '/whoami')#>>'{status}' = '200' AND t.call(t.v('sandbox'), '/icanera/coin/price', '{"currency":"UGX"}')#>>'{status}' = '200');

  PERFORM t.as_user('d0000000-0000-0000-0000-00000000000a');
  a := public.era_api_dev_account();
  PERFORM t.reset();
  PERFORM t.check('4.10 the account lists the app with key prefixes only (never a key, a hash or a ticket)',
    jsonb_array_length(a->'apps') = 1 AND a::TEXT NOT LIKE '%key_hash%' AND a::TEXT NOT LIKE '%era_tk_%' AND a::TEXT NOT LIKE '%' || t.v('sandbox') || '%'
    AND a#>>'{apps,0,keys,0,mode}' = 'sandbox', a::TEXT);
  PERFORM t.check('4.11 the audit log records who created it', EXISTS (SELECT 1 FROM public.era_api_audit WHERE action = 'app_created' AND actor = 'd0000000-0000-0000-0000-00000000000a'));

  -- Ben's country came from his ICAN account: he can register without being asked again
  PERFORM t.as_user('d0000000-0000-0000-0000-00000000000b');
  r := public.era_api_dev_create_app('Ben Boda', NULL, NULL, ARRAY['bodagoera']);
  PERFORM t.reset();
  PERFORM t.check('4.12 an app registered by someone with an ICAN account carries the country the platform already had',
    (SELECT country_code FROM public.era_api_clients WHERE id = (r->>'client_id')::UUID) = 'KE');
  PERFORM t.setv('ben_client', r->>'client_id');
END $t$;

-- ================================================================ 5. Keys: sandbox always, live only when approved, only for my own apps
DO $t$
DECLARE r JSONB; e TEXT; v_client UUID := t.v('client')::UUID; v_old TEXT := t.v('sandbox');
BEGIN
  PERFORM t.as_user('d0000000-0000-0000-0000-00000000000a');
  r := public.era_api_dev_issue_key(v_client, 'sandbox');
  PERFORM t.check('5.1 rotating the sandbox key gives a new one', r->>'key' ~ '^era_test_' AND r->>'key' <> v_old);
  PERFORM t.reset();
  PERFORM t.check('5.2 ...and the old one stops working at once', t.call(v_old, '/whoami')#>>'{status}' = '401' AND t.call(r->>'key', '/whoami')#>>'{status}' = '200');
  PERFORM t.setv('sandbox', r->>'key');

  PERFORM t.as_user('d0000000-0000-0000-0000-00000000000a');
  e := t.err(format($q$SELECT public.era_api_dev_issue_key(%L, 'live')$q$, v_client));
  PERFORM t.check('5.3 a live key waits for approval', e LIKE '%not been approved%', e);
  e := t.err(format($q$SELECT public.era_api_dev_issue_key(%L, 'admin')$q$, v_client));
  PERFORM t.check('5.4 only sandbox or live exist', e LIKE '%sandbox or live%', e);
  PERFORM t.reset();

  PERFORM t.as_user('d0000000-0000-0000-0000-00000000000b');
  e := t.err(format($q$SELECT public.era_api_dev_issue_key(%L, 'sandbox')$q$, v_client));
  PERFORM t.check('5.5 ISOLATION: another developer cannot issue a key for my app', e LIKE '%No such app%', e);
  PERFORM t.check('5.6 ISOLATION: another developer''s account does not list my app', NOT (public.era_api_dev_account()::TEXT LIKE '%Farm Dash%'));
  PERFORM t.reset();

  -- an administrator approves; now the developer can reveal a live key
  PERFORM t.as_user('00000000-0000-0000-0000-000000000001');
  PERFORM public.era_api_admin_review(v_client, 'approve', ARRAY['farmagentera','icanera'], 60, 5000, 'welcome');
  PERFORM t.reset();
  PERFORM t.as_user('d0000000-0000-0000-0000-00000000000a');
  r := public.era_api_dev_issue_key(v_client, 'live');
  PERFORM t.reset();
  PERFORM t.check('5.7 once approved, the developer reveals a live key', r->>'key' ~ '^era_live_[0-9a-f]{40}$');
  PERFORM t.check('5.8 the live key works for the approved apps', t.call(r->>'key', '/farmagentera/price-board')#>>'{status}' = '200');

  PERFORM t.as_user('00000000-0000-0000-0000-000000000001');
  PERFORM public.era_api_admin_review(v_client, 'suspend', NULL, NULL, NULL, 'paused');
  PERFORM t.reset();
  PERFORM t.as_user('d0000000-0000-0000-0000-00000000000a');
  e := t.err(format($q$SELECT public.era_api_dev_issue_key(%L, 'sandbox')$q$, v_client));
  PERFORM t.reset();
  PERFORM t.check('5.9 a suspended app cannot get new keys', e LIKE '%suspended%', e);
END $t$;

-- ================================================================ 6. Limits and switches
DO $t$
DECLARE e TEXT; i INT;
BEGIN
  -- 3 new apps a day (Ada already made one)
  PERFORM t.as_user('d0000000-0000-0000-0000-00000000000a');
  PERFORM public.era_api_dev_create_app('Second', NULL, NULL, ARRAY['icanera']);
  PERFORM public.era_api_dev_create_app('Third',  NULL, NULL, ARRAY['icanera']);
  e := t.err($$SELECT public.era_api_dev_create_app('Fourth', NULL, NULL, ARRAY['icanera'])$$);
  PERFORM t.reset();
  PERFORM t.check('6.1 a fourth app in one day is refused', e LIKE '%Too many%', e);

  -- 5 apps in total: age the first four, then the fifth is allowed and the sixth is not
  UPDATE public.era_api_clients SET created_at = now() - INTERVAL '3 days' WHERE owner_user_id = 'd0000000-0000-0000-0000-00000000000a';
  PERFORM t.as_user('d0000000-0000-0000-0000-00000000000a');
  PERFORM public.era_api_dev_create_app('Fourth', NULL, NULL, ARRAY['icanera']);
  PERFORM public.era_api_dev_create_app('Fifth',  NULL, NULL, ARRAY['icanera']);
  e := t.err($$SELECT public.era_api_dev_create_app('Sixth', NULL, NULL, ARRAY['icanera'])$$);
  PERFORM t.reset();
  PERFORM t.check('6.2 a developer can hold at most 5 apps', e LIKE '%5 apps%', e);

  -- the sign-up switch
  PERFORM t.as_user('00000000-0000-0000-0000-000000000001'); PERFORM public.era_api_admin_save_settings('{"signups_open": false}'); PERFORM t.reset();
  PERFORM t.as_user('d0000000-0000-0000-0000-00000000000b');
  e := t.err($$SELECT public.era_api_dev_create_app('Ben Two', NULL, NULL, ARRAY['bodagoera'])$$);
  PERFORM t.reset();
  PERFORM t.check('6.3 with sign-ups paused no app can be registered from an account either', e LIKE '%paused%', e);
  PERFORM t.as_user('00000000-0000-0000-0000-000000000001'); PERFORM public.era_api_admin_save_settings('{"signups_open": true}'); PERFORM t.reset();
END $t$;

-- ================================================================ 7. What administrators see
DO $t$
DECLARE l JSONB; row_ JSONB; o JSONB;
BEGIN
  PERFORM t.as_user('00000000-0000-0000-0000-000000000001');
  l := public.era_api_admin_list_clients(NULL, 200); o := public.era_api_admin_overview();
  PERFORM t.reset();
  SELECT x INTO row_ FROM jsonb_array_elements(l) x WHERE x->>'id' = t.v('client');
  PERFORM t.check('7.1 the client list shows the country and that the app has an account', row_->>'country_code' = 'TZ' AND (row_->>'has_account')::BOOLEAN, row_::TEXT);
  PERFORM t.check('7.2 account apps count with the developer applications', (o#>>'{clients,total}')::INT = (SELECT COUNT(*) FROM public.era_api_clients WHERE NOT is_system AND kind = 'developer'));
  PERFORM t.check('7.3 the list never contains a key hash or a ticket', l::TEXT NOT LIKE '%key_hash%' AND l::TEXT NOT LIKE '%ticket%');
END $t$;

-- ================================================================ 8. The ticket flow is untouched
DO $t$
DECLARE r JSONB;
BEGIN
  PERFORM t.as_anon();
  r := public.era_api_request_access('Ticket App', NULL, 'tix@example.com', NULL, NULL, ARRAY['icanera']);
  PERFORM t.check('8.1 the no-account flow still returns a ticket and a sandbox key', r->>'ticket' LIKE 'era_tk_%' AND r#>>'{sandbox_key,key}' LIKE 'era_test_%');
  PERFORM t.check('8.2 ...and the ticket still shows status', public.era_api_ticket_status(r->>'ticket')->>'status' = 'pending');
  PERFORM t.reset();
  PERFORM t.check('8.3 ...with no country and no owner', (SELECT country_code IS NULL AND owner_user_id IS NULL FROM public.era_api_clients WHERE id = (r->>'client_id')::UUID));
  PERFORM t.as_user('00000000-0000-0000-0000-000000000001');
  PERFORM t.check('8.4 an administrator sees it listed as an app without an account',
    EXISTS (SELECT 1 FROM jsonb_array_elements(public.era_api_admin_list_clients(NULL, 500)) x WHERE x->>'id' = r->>'client_id' AND (x->>'has_account')::BOOLEAN = FALSE AND x->>'country_code' IS NULL));
  PERFORM t.reset();
END $t$;

-- ================================================================ 9. Deleting the user removes the profile
DO $t$
BEGIN
  DELETE FROM auth.users WHERE id = 'd0000000-0000-0000-0000-00000000000d';
  PERFORM t.check('9.1 deleting a user deletes their developer profile', NOT EXISTS (SELECT 1 FROM public.era_api_developers WHERE user_id = 'd0000000-0000-0000-0000-00000000000d'));
END $t$;

\set ON_ERROR_STOP on
-- Isolation, consent, and the revenue feed: nothing in icanera_trading is reachable over the API, only businesses
-- that accepted the current wording contribute, only customer sales count, the business is never named, and
-- whatever goes wrong in the feed can never reach the sale.

TRUNCATE public.ican_coin_transactions, public.ican_price_ohlc, public.ican_price_ticks;
DELETE FROM public.ican_price_cache;
SELECT public.ican_flush_price_ticks(TRUE, TRUE);

INSERT INTO auth.users (id, email) SELECT t.u(n), 'u' || n || '@test.dev' FROM generate_series(1, 9) n ON CONFLICT DO NOTHING;

-- Businesses (ids are fixed so the tests can name them). Owners: user 1 owns 1..4, user 2 owns the church and the inactive one.
CREATE FUNCTION t.biz(n INT) RETURNS UUID LANGUAGE sql IMMUTABLE AS $$ SELECT ('b0000000-0000-0000-0000-' || lpad(n::TEXT, 12, '0'))::UUID $$;
GRANT EXECUTE ON FUNCTION t.biz(INT) TO PUBLIC;
INSERT INTO public.business_profiles (id, user_id, business_name, business_type, status, metadata) VALUES
  (t.biz(1), t.u(1), 'Kampala Fresh Mart', 'Sole Proprietorship', 'active',   '{"category_key":"retail"}'),
  (t.biz(2), t.u(1), 'Never Agreed Ltd',   'LLC',                  'active',   '{"category_key":"retail"}'),
  (t.biz(3), t.u(2), 'Grace Chapel',       'Non-profit',           'active',   '{}'),
  (t.biz(4), t.u(1), 'Town Council',       'LLC',                  'active',   '{"category_key":"government"}'),
  (t.biz(5), t.u(1), 'Nile Riders',        'LLC',                  'active',   '{"category_key":"transport"}'),
  (t.biz(6), t.u(2), 'Closed Pharmacy',    'LLC',                  'inactive', '{"category_key":"pharmacy"}'),
  (t.biz(7), t.u(2), 'Plain Type Shop',    'wholesale',            'active',   '{}');
INSERT INTO public.business_co_owners (business_profile_id, user_id, role, ownership_share, status) VALUES
  (t.biz(1), t.u(3), 'shareholder', 25, 'active'),
  (t.biz(1), t.u(4), 'viewer', 0, 'active'),
  (t.biz(1), t.u(5), 'administrator', 0, 'removed');

CREATE FUNCTION t.accept(n INT, who INT, ver INT DEFAULT 1) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE r JSONB;
BEGIN PERFORM t.as_user(t.u(who)); r := public.ican_sector_accept_data_terms(t.biz(n), ver); PERFORM t.reset(); RETURN r; END; $$;
CREATE FUNCTION t.sale(ref TEXT, n INT, ican NUMERIC DEFAULT 2, typ TEXT DEFAULT 'pos_sale') RETURNS VOID LANGUAGE sql AS $$
  INSERT INTO public.ican_business_wallet_settlements (business_profile_id, source_app, source_reference, amount_ican, settlement_type)
  VALUES (t.biz(n), 'ican', ref, ican, typ) $$;
CREATE FUNCTION t.events(ref TEXT) RETURNS SETOF icanera_trading.telemetry_events LANGUAGE sql AS $$
  SELECT e.* FROM icanera_trading.telemetry_events e JOIN public.ican_business_wallet_settlements s ON e.source_ref = s.id::TEXT WHERE s.source_reference = ref $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA t TO PUBLIC;

-- ================================================================ 1. Nobody reaches the trading schema over the API
DO $t$
DECLARE e TEXT; tbl TEXT;
BEGIN
  PERFORM t.check('1.1 anon has no access to the schema', NOT has_schema_privilege('anon', 'icanera_trading', 'USAGE'));
  PERFORM t.check('1.2 signed-in users have no access to the schema', NOT has_schema_privilege('authenticated', 'icanera_trading', 'USAGE'));
  FOREACH tbl IN ARRAY ARRAY['telemetry_events','vault_entries','sector_fills','sector_holdings','sector_settings','contributor_secret','data_terms_acceptance','trade_requests'] LOOP
    PERFORM t.as_user(t.u(1));
    e := t.err(format('SELECT count(*) FROM icanera_trading.%I', tbl));
    PERFORM t.reset();
    PERFORM t.check('1.3 a signed-in user cannot read icanera_trading.' || tbl, e LIKE 'permission denied%', e);
    PERFORM t.as_user(t.u(1));
    e := t.err(format('DELETE FROM icanera_trading.%I', tbl));
    PERFORM t.reset();
    PERFORM t.check('1.4 ...or change it: ' || tbl, e LIKE 'permission denied%', e);
  END LOOP;
  PERFORM t.check('1.5 the internal capture function is closed to the API roles',
    NOT has_function_privilege('authenticated', 'icanera_trading.capture_revenue(text,text,uuid,numeric,text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'icanera_trading.capture_revenue(text,text,uuid,numeric,text)', 'EXECUTE'));
  PERFORM t.check('1.6 so is the pseudonym function',
    NOT has_function_privilege('authenticated', 'icanera_trading.contributor_key(uuid)', 'EXECUTE'));
  PERFORM t.check('1.7 trading starts switched OFF', NOT (SELECT trading_enabled FROM icanera_trading.sector_settings));
  PERFORM t.check('1.8 the ten sectors are in place', (SELECT count(*) FROM icanera_trading.sector_catalog) = 10);
END $t$;

-- Generic guards, so a function added later by mistake is caught here rather than in production.
DO $t$
DECLARE bad TEXT; open_anon TEXT; unpinned TEXT;
BEGIN
  SELECT string_agg(p.oid::regprocedure::TEXT, ', ') INTO bad
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'icanera_trading'
     AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
          OR has_function_privilege('public', p.oid, 'EXECUTE'));
  PERFORM t.check('1.12 NO function in the trading schema is executable by anon, signed-in users or PUBLIC', bad IS NULL, bad);

  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO open_anon
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname ~ '^ican_(get_)?sector' AND has_function_privilege('anon', p.oid, 'EXECUTE');
  PERFORM t.check('1.13 the only sector functions a signed-out visitor can call are the public feed and the wording',
    open_anon = 'ican_get_sector_feed, ican_sector_data_terms', open_anon);

  SELECT string_agg(p.proname, ', ') INTO unpinned
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname ~ '^ican_(get_)?sector' AND p.prosecdef
     AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(p.proconfig, ARRAY[]::TEXT[])) c WHERE c LIKE 'search_path=%');
  PERFORM t.check('1.14 every public sector function that runs with owner rights pins its search_path', unpinned IS NULL, unpinned);

  SELECT string_agg(p.proname, ', ') INTO unpinned
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'icanera_trading' AND p.prosecdef
     AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(p.proconfig, ARRAY[]::TEXT[])) c WHERE c LIKE 'search_path=%');
  PERFORM t.check('1.15 ...and so does every owner-rights function in the trading schema', unpinned IS NULL, unpinned);

  PERFORM t.check('1.16 every table in the trading schema has row level security on and no API grants',
    NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'icanera_trading' AND c.relkind = 'r'
                   AND (NOT c.relrowsecurity OR has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
                        OR has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE'))));
END $t$;

-- ledgers are append-only: prove it with real rows
INSERT INTO icanera_trading.vault_entries (kind, amount, memo) VALUES ('funding', 100, 'test');
DO $t$
DECLARE e TEXT;
BEGIN
  e := t.err($$UPDATE icanera_trading.vault_entries SET amount = 1$$);
  PERFORM t.check('1.10 a vault entry cannot be changed', e LIKE '%append-only%', e);
  e := t.err($$DELETE FROM icanera_trading.vault_entries$$);
  PERFORM t.check('1.11 ...or deleted', e LIKE '%append-only%', e);
END $t$;
TRUNCATE icanera_trading.vault_entries;

-- ================================================================ 2. Consent
DO $t$
DECLARE r JSONB;
BEGIN
  PERFORM t.as_anon();
  r := public.ican_sector_data_terms();
  PERFORM t.reset();
  PERFORM t.check('2.1 a signed-out visitor can read the wording (the sign-up form needs it)',
    (r ->> 'version')::INT = 1 AND length(r ->> 'body') > 100 AND r ->> 'title' = 'Anonymous sector statistics', r::TEXT);

  r := t.accept(1, 2);                                   -- user 2 has nothing to do with business 1
  PERFORM t.check('2.2 a stranger cannot accept for someone else''s business', r ->> 'code' = 'not_allowed', r::TEXT);
  r := t.accept(1, 4);                                   -- a co-owner with no share and a viewer role
  PERFORM t.check('2.3 a co-owner with no share and no senior role cannot', r ->> 'code' = 'not_allowed', r::TEXT);
  r := t.accept(1, 5);                                   -- an administrator whose membership was removed
  PERFORM t.check('2.4 a removed co-owner cannot', r ->> 'code' = 'not_allowed', r::TEXT);
  PERFORM t.as_anon();
  PERFORM t.check('2.5 a signed-out visitor cannot accept', NOT has_function_privilege('anon', 'public.ican_sector_accept_data_terms(uuid,int)', 'EXECUTE'));
  PERFORM t.reset();

  PERFORM t.as_user(t.u(1));
  r := public.ican_sector_data_consent_status(t.biz(1));
  PERFORM t.reset();
  PERFORM t.check('2.6 before accepting, the status says not accepted', (r ->> 'success')::BOOLEAN AND NOT (r ->> 'accepted')::BOOLEAN, r::TEXT);

  r := t.accept(1, 1, 7);
  PERFORM t.check('2.7 accepting a version that is not current is refused', r ->> 'code' = 'terms_version_outdated' AND (r ->> 'current_version')::INT = 1, r::TEXT);
  r := t.accept(1, 1);
  PERFORM t.check('2.8 the owner can accept the current wording', (r ->> 'success')::BOOLEAN, r::TEXT);
  r := t.accept(1, 3);
  PERFORM t.check('2.9 accepting twice (here by a shareholder) is harmless', (r ->> 'success')::BOOLEAN
    AND (SELECT count(*) FROM icanera_trading.data_terms_acceptance WHERE business_id = t.biz(1)) = 1, r::TEXT);
  PERFORM t.check('2.10 the first acceptance keeps who gave it', (SELECT accepted_by FROM icanera_trading.data_terms_acceptance WHERE business_id = t.biz(1)) = t.u(1));

  PERFORM t.as_user(t.u(3));
  r := public.ican_sector_data_consent_status(t.biz(1));
  PERFORM t.reset();
  PERFORM t.check('2.11 the status now says accepted', (r ->> 'accepted')::BOOLEAN, r::TEXT);
  PERFORM t.as_user(t.u(2));
  r := public.ican_sector_data_consent_status(t.biz(1));
  PERFORM t.reset();
  PERFORM t.check('2.12 and only a manager can ask', r ->> 'code' = 'not_allowed', r::TEXT);

  -- the others who will be needed below
  PERFORM t.accept(3, 2); PERFORM t.accept(4, 1); PERFORM t.accept(5, 1); PERFORM t.accept(6, 2); PERFORM t.accept(7, 2);
  -- business 2 never accepts
END $t$;

-- ================================================================ 3. What gets captured
DO $t$
DECLARE price NUMERIC; ev icanera_trading.telemetry_events; n INT;
BEGIN
  SELECT price_ugx INTO price FROM public.ican_price_cache WHERE id;
  PERFORM t.check('3.0 the price cache is warm for the tests', price > 0, price::TEXT);

  PERFORM t.sale('s1', 1); PERFORM t.sale('s2', 2); PERFORM t.sale('s3', 3); PERFORM t.sale('s4', 4);
  PERFORM t.sale('s5', 5); PERFORM t.sale('s6', 6); PERFORM t.sale('s7', 7);

  SELECT * INTO ev FROM t.events('s1');
  PERFORM t.check('3.1 a consented retail business''s sale is captured in iRETL', ev.sector = 'iRETL' AND ev.kind = 'sale', ev::TEXT);
  PERFORM t.check('3.2 ...in UGX at the cached coin price', ev.amount_ugx = round(2 * price, 4), format('%s vs %s', ev.amount_ugx, round(2 * price, 4)));
  PERFORM t.check('3.3 a business that never accepted is not captured', NOT EXISTS (SELECT 1 FROM t.events('s2')));
  SELECT * INTO ev FROM t.events('s3');
  PERFORM t.check('3.4 a church goes to iSOCL (recognised by the tithe feature''s own rule)', ev.sector = 'iSOCL', ev::TEXT);
  PERFORM t.check('3.5 a category with no sector (government) contributes nothing', NOT EXISTS (SELECT 1 FROM t.events('s4')));
  SELECT * INTO ev FROM t.events('s5');
  PERFORM t.check('3.6 transport goes to iTRNS', ev.sector = 'iTRNS', ev::TEXT);
  PERFORM t.check('3.7 an inactive business contributes nothing', NOT EXISTS (SELECT 1 FROM t.events('s6')));
  SELECT * INTO ev FROM t.events('s7');
  PERFORM t.check('3.8 with no category_key, business_type is the fallback (wholesale -> iRETL)', ev.sector = 'iRETL', ev::TEXT);

  PERFORM t.sale('i1', 1, 2, 'investment'); PERFORM t.sale('i2', 1, 2, 'refund'); PERFORM t.sale('i3', 1, 2, 'other_income');
  PERFORM t.check('3.9 investments, refunds and other income are not revenue',
    NOT EXISTS (SELECT 1 FROM t.events('i1')) AND NOT EXISTS (SELECT 1 FROM t.events('i2')) AND NOT EXISTS (SELECT 1 FROM t.events('i3')));

  -- the business is never named
  PERFORM t.check('3.10 the outbox holds no business id anywhere in its rows',
    NOT EXISTS (SELECT 1 FROM icanera_trading.telemetry_events e WHERE e::TEXT ILIKE '%b0000000-0000-0000-0000%'));
  PERFORM t.check('3.11 contributors are a 64-character keyed hash', (SELECT bool_and(contributor_key ~ '^[0-9a-f]{64}$') FROM icanera_trading.telemetry_events));
  PERFORM t.check('3.12 the same business always maps to the same key, different ones to different keys',
    icanera_trading.contributor_key(t.biz(1)) = icanera_trading.contributor_key(t.biz(1))
    AND icanera_trading.contributor_key(t.biz(1)) <> icanera_trading.contributor_key(t.biz(7)));

  -- exactly once
  PERFORM icanera_trading.capture_revenue('settlement', (SELECT e.source_ref FROM t.events('s1') e), t.biz(1), 999, 'sale');
  SELECT count(*) INTO n FROM t.events('s1');
  PERFORM t.check('3.13 capturing the same sale again changes nothing (exactly once)', n = 1 AND (SELECT amount_ugx FROM t.events('s1')) = round(2 * price, 4));

  -- voids
  PERFORM icanera_trading.capture_revenue('settlement', (SELECT e.source_ref FROM t.events('s1') e LIMIT 1), t.biz(1), NULL, 'void');
  PERFORM icanera_trading.capture_revenue('settlement', (SELECT e.source_ref FROM t.events('s1') e LIMIT 1), t.biz(1), NULL, 'void');
  PERFORM t.check('3.14 a refund is a compensating row, once',
    (SELECT count(*) FROM icanera_trading.telemetry_events WHERE kind = 'void') = 1
    AND (SELECT amount_ugx FROM icanera_trading.telemetry_events WHERE kind = 'void') = -round(2 * price, 4));
  PERFORM icanera_trading.capture_revenue('settlement', gen_random_uuid()::TEXT, t.biz(1), NULL, 'void');
  PERFORM t.check('3.15 a refund of something never captured is ignored', (SELECT count(*) FROM icanera_trading.telemetry_events WHERE kind = 'void') = 1);
  PERFORM icanera_trading.capture_revenue('x', 'bad-1', t.biz(1), -5, 'sale');
  PERFORM icanera_trading.capture_revenue('x', 'bad-2', t.biz(1), 0, 'sale');
  PERFORM icanera_trading.capture_revenue('x', 'bad-3', t.biz(1), 'NaN'::NUMERIC, 'sale');
  PERFORM icanera_trading.capture_revenue('x', 'bad-4', NULL, 10, 'sale');
  PERFORM icanera_trading.capture_revenue('x', 'bad-5', t.biz(1), 10, 'weird');
  PERFORM t.check('3.16 negative, zero, NaN, anonymous and unknown-kind inputs record nothing',
    NOT EXISTS (SELECT 1 FROM icanera_trading.telemetry_events WHERE source = 'x'));
END $t$;

-- ================================================================ 4. The sale is never held up
DO $t$
DECLARE e TEXT; n INT; price NUMERIC;
BEGIN
  -- the sale can be recorded by an ordinary signed-in role (the trigger writes as its owner)
  PERFORM t.as_user(t.u(1));
  e := t.err($$SELECT t.sale('r1', 1)$$);
  PERFORM t.reset();
  PERFORM t.check('4.1 a sale recorded by a signed-in role still gets captured', e IS NULL AND EXISTS (SELECT 1 FROM t.events('r1')), e);

  -- break the outbox on purpose: every new event row is rejected
  ALTER TABLE icanera_trading.telemetry_events ADD CONSTRAINT zz_always_fail CHECK (FALSE) NOT VALID;
  e := t.err($$SELECT t.sale('f1', 1)$$);
  PERFORM t.check('4.2 with the outbox broken, the sale still goes through', e IS NULL AND EXISTS (SELECT 1 FROM public.ican_business_wallet_settlements WHERE source_reference = 'f1'), e);
  PERFORM t.check('4.3 ...and nothing was captured for it', NOT EXISTS (SELECT 1 FROM t.events('f1')));
  ALTER TABLE icanera_trading.telemetry_events DROP CONSTRAINT zz_always_fail;

  -- no coin price yet (cache empty): the sale still goes through
  SELECT price_ugx INTO price FROM public.ican_price_cache WHERE id;
  DELETE FROM public.ican_price_cache;
  e := t.err($$SELECT t.sale('p1', 1)$$);
  PERFORM t.check('4.4 with no cached coin price, the sale still goes through and records nothing',
    e IS NULL AND EXISTS (SELECT 1 FROM public.ican_business_wallet_settlements WHERE source_reference = 'p1') AND NOT EXISTS (SELECT 1 FROM t.events('p1')), e);
  PERFORM public.ican_flush_price_ticks(TRUE, TRUE);

  -- the secret goes missing: still no harm to the sale
  DELETE FROM icanera_trading.contributor_secret;
  e := t.err($$SELECT t.sale('k1', 1)$$);
  PERFORM t.check('4.5 with the pseudonym secret gone, the sale still goes through and records nothing',
    e IS NULL AND NOT EXISTS (SELECT 1 FROM t.events('k1')), e);
  INSERT INTO icanera_trading.contributor_secret (id, secret) VALUES (TRUE, replace(gen_random_uuid()::TEXT || gen_random_uuid()::TEXT, '-', ''));
  -- NB: a new secret re-keys every business, which is why the real secret is never touched after install.

  PERFORM t.check('4.6 the settlement rows themselves are untouched by all this',
    (SELECT count(*) FROM public.ican_business_wallet_settlements) = 7 + 3 + 4);
END $t$;

-- ================================================================ 5. New wording means a new yes
DO $t$
DECLARE r JSONB;
BEGIN
  INSERT INTO icanera_trading.data_terms_text (version, title, body) VALUES (2, 'Anonymous sector statistics', 'Version two of the wording, with more detail about retention.')
    ON CONFLICT (version) DO UPDATE SET body = EXCLUDED.body;   -- 20261024100000_sector_fixed_assets.sql ships a draft v2
  UPDATE icanera_trading.sector_settings SET current_terms_version = 2;
  PERFORM t.sale('v2a', 1);
  PERFORM t.check('5.1 after the wording changes, a business that accepted v1 stops contributing', NOT EXISTS (SELECT 1 FROM t.events('v2a')));
  PERFORM t.as_anon();
  r := public.ican_sector_data_terms();
  PERFORM t.reset();
  PERFORM t.check('5.2 the sign-up form now shows v2', (r ->> 'version')::INT = 2, r::TEXT);
  r := t.accept(1, 1, 1);
  PERFORM t.check('5.3 accepting the old version no longer works', r ->> 'code' = 'terms_version_outdated', r::TEXT);
  r := t.accept(1, 1, 2);
  PERFORM t.check('5.4 accepting v2 does', (r ->> 'success')::BOOLEAN, r::TEXT);
  PERFORM t.sale('v2b', 1);
  PERFORM t.check('5.5 and contribution resumes (the missed sale is not back-filled)', EXISTS (SELECT 1 FROM t.events('v2b')) AND NOT EXISTS (SELECT 1 FROM t.events('v2a')));
  UPDATE icanera_trading.sector_settings SET current_terms_version = 1;
  DELETE FROM icanera_trading.data_terms_text WHERE version = 2;
  DELETE FROM icanera_trading.data_terms_acceptance WHERE terms_version = 2;
END $t$;

-- ================================================================ 6. Disabled sectors
DO $t$
BEGIN
  UPDATE icanera_trading.sector_catalog SET enabled = FALSE WHERE ticker = 'iTRNS';
  PERFORM t.sale('d1', 5);
  PERFORM t.check('6.1 a switched-off sector takes no new revenue', NOT EXISTS (SELECT 1 FROM t.events('d1')));
  UPDATE icanera_trading.sector_catalog SET enabled = TRUE WHERE ticker = 'iTRNS';
  PERFORM t.sale('d2', 5);
  PERFORM t.check('6.2 and takes it again when switched back on', EXISTS (SELECT 1 FROM t.events('d2')));
END $t$;

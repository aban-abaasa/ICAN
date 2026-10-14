\set ON_ERROR_STOP on
-- The informational FX oracle: what it accepts, what it refuses, the time-weighted average, staleness, and that it is
-- display-only (it never touches a balance or the existing currency table).

TRUNCATE icanera_chain.fx_observations RESTART IDENTITY;
SELECT t.set('{"fx_max_jump_pct": 5, "fx_stale_s": 900, "fx_twap_s": 60}');

CREATE FUNCTION t.fx(p_pair TEXT, p_rate NUMERIC, p_secs_ago NUMERIC, p_src TEXT DEFAULT 'test-feed') RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE r JSONB;
BEGIN
  PERFORM t.as_service();
  r := public.ican_chain_operator_fx_observe(p_pair, p_rate, p_src, now() - make_interval(secs => p_secs_ago));
  PERFORM t.reset();
  RETURN r;
END; $$;
CREATE FUNCTION t.rate(p_pair TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE r JSONB;
BEGIN
  PERFORM t.as_anon();
  r := public.ican_fx_rate(p_pair);
  PERFORM t.reset();
  RETURN r;
END; $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA t TO PUBLIC;

-- ================================================================ 1. Who may do what
DO $t$
DECLARE r JSONB; e TEXT;
BEGIN
  r := t.rate('USD/UGX');
  PERFORM t.check('1.1 anyone can read the rate; before any observation it says it is unavailable', NOT (r ->> 'available')::BOOLEAN, r::TEXT);
  PERFORM t.as_anon();
  e := t.err($$SELECT public.ican_chain_operator_fx_observe('USD/UGX', 3700, 'x-feed', now())$$);
  PERFORM t.reset();
  PERFORM t.check('1.2 a signed-out visitor cannot feed the oracle', e LIKE 'permission denied%', e);
  PERFORM t.as_user(t.u(1));
  e := t.err($$SELECT public.ican_chain_operator_fx_observe('USD/UGX', 3700, 'x-feed', now())$$);
  PERFORM t.reset();
  PERFORM t.check('1.3 neither can a signed-in user', e LIKE 'permission denied%', e);
  PERFORM t.as_user(t.u(1));
  e := t.err($$SELECT * FROM icanera_chain.fx_observations$$);
  PERFORM t.reset();
  PERFORM t.check('1.4 and the raw observations are not readable by users', e LIKE 'permission denied%', e);
END $t$;

-- ================================================================ 2. What is accepted
DO $t$
DECLARE r JSONB; q JSONB;
BEGIN
  r := t.fx('USD/UGX', 3700.5, 100);
  PERFORM t.check('2.1 a first observation is accepted', (r ->> 'accepted')::BOOLEAN, r::TEXT);
  q := t.rate('USD/UGX');
  PERFORM t.check('2.2 and shows as the rate, from its source, not stale',
    (q ->> 'available')::BOOLEAN AND (q ->> 'rate')::NUMERIC = 3700.5 AND (q ->> 'spot')::NUMERIC = 3700.5 AND q ->> 'source' = 'test-feed' AND NOT (q ->> 'stale')::BOOLEAN, q::TEXT);
  r := t.fx('USD/UGX', 3705, 100);
  PERFORM t.check('2.3 an observation with the same timestamp is not newer, so it is ignored', NOT (r ->> 'accepted')::BOOLEAN AND r ->> 'reason' = 'not_newer', r::TEXT);
  r := t.fx('USD/UGX', 3705, 150);
  PERFORM t.check('2.4 an older timestamp is ignored', NOT (r ->> 'accepted')::BOOLEAN AND r ->> 'reason' = 'not_newer', r::TEXT);
  r := t.fx('USD/UGX', 3705, -300);
  PERFORM t.check('2.5 a timestamp in the future is ignored', NOT (r ->> 'accepted')::BOOLEAN AND r ->> 'reason' = 'from_the_future', r::TEXT);
  r := t.fx('USD/KES', 129, 3600);
  PERFORM t.check('2.6 an hour-old observation is ignored', NOT (r ->> 'accepted')::BOOLEAN AND r ->> 'reason' = 'too_old', r::TEXT);
  PERFORM t.check('2.7 every refusal is kept, with its reason, but is not used',
    (SELECT count(*) FROM icanera_chain.fx_observations WHERE NOT accepted AND reject_reason IS NOT NULL) = 4
    AND (t.rate('USD/UGX') ->> 'spot')::NUMERIC = 3700.5);
  r := t.fx('USD/UGX', 3720, 90);
  PERFORM t.check('2.8 a normal move (+0.5 %) is accepted', (r ->> 'accepted')::BOOLEAN, r::TEXT);
  PERFORM t.check('2.9 pairs are independent', t.rate('USD/KES') ->> 'available' = 'false');
END $t$;

-- ================================================================ 3. Jumps
DO $t$
DECLARE r JSONB; q JSONB;
BEGIN
  r := t.fx('USD/UGX', 4000, 80);                   -- +7.5 % from 3720
  PERFORM t.check('3.1 a jump past 5 % is stored but not used', NOT (r ->> 'accepted')::BOOLEAN AND r ->> 'reason' = 'jump', r::TEXT);
  PERFORM t.check('3.2 the rate shown is still the last good one', (t.rate('USD/UGX') ->> 'spot')::NUMERIC = 3720);
  r := t.fx('USD/UGX', 3780, 70);                   -- +1.6 %: back to normal
  PERFORM t.check('3.3 a normal observation after a rejected spike is accepted straight away', (r ->> 'accepted')::BOOLEAN, r::TEXT);
  PERFORM t.check('3.4 a single outlier never became the rate', (SELECT count(*) FROM icanera_chain.fx_observations WHERE accepted AND rate = 4000) = 0);

  -- a real move is believed once three observations in a row agree with each other
  r := t.fx('USD/UGX', 4400, 60);                   -- +16 %
  PERFORM t.check('3.5 a +16 % observation: not believed yet (first)', r ->> 'reason' = 'jump', r::TEXT);
  r := t.fx('USD/UGX', 4410, 50);
  PERFORM t.check('3.6 ...nor the second', r ->> 'reason' = 'jump', r::TEXT);
  r := t.fx('USD/UGX', 4405, 40);
  PERFORM t.check('3.7 ...the third, agreeing with the two before it within 1 %, is accepted as a real move', (r ->> 'accepted')::BOOLEAN, r::TEXT);
  PERFORM t.check('3.8 and the new level is now the reference', (t.rate('USD/UGX') ->> 'spot')::NUMERIC = 4405);

  -- three that disagree with each other are not
  r := t.fx('USD/UGX', 5000, 30);
  r := t.fx('USD/UGX', 3900, 25);
  r := t.fx('USD/UGX', 5300, 20);
  PERFORM t.check('3.9 three wild observations that disagree with each other are never accepted', NOT (r ->> 'accepted')::BOOLEAN AND (t.rate('USD/UGX') ->> 'spot')::NUMERIC = 4405, r::TEXT);
END $t$;

-- ================================================================ 4. Bad input
DO $t$
BEGIN
  PERFORM t.as_service();
  PERFORM t.check('4.1 a zero rate raises', t.err($$SELECT public.ican_chain_operator_fx_observe('USD/UGX', 0, 'feed', now())$$) = 'bad observation');
  PERFORM t.check('4.2 a negative rate raises', t.err($$SELECT public.ican_chain_operator_fx_observe('USD/UGX', -5, 'feed', now())$$) = 'bad observation');
  PERFORM t.check('4.3 NaN raises', t.err($$SELECT public.ican_chain_operator_fx_observe('USD/UGX', 'NaN', 'feed', now())$$) = 'bad observation');
  PERFORM t.check('4.4 an absurd rate raises', t.err($$SELECT public.ican_chain_operator_fx_observe('USD/UGX', 1e16, 'feed', now())$$) = 'bad observation');
  PERFORM t.check('4.5 a malformed pair raises', t.err($$SELECT public.ican_chain_operator_fx_observe('USDUGX', 3700, 'feed', now())$$) = 'bad observation');
  PERFORM t.check('4.6 a missing source raises', t.err($$SELECT public.ican_chain_operator_fx_observe('USD/UGX', 3700, NULL, now())$$) = 'bad observation');
  PERFORM t.check('4.7 a missing time raises', t.err($$SELECT public.ican_chain_operator_fx_observe('USD/UGX', 3700, 'feed', NULL)$$) = 'bad observation');
  PERFORM t.reset();
  PERFORM t.check('4.8 a lower-case pair is normalised', (t.fx('usd/tzs', 2500, 10) ->> 'accepted')::BOOLEAN AND (t.rate('USD/TZS') ->> 'available')::BOOLEAN);
END $t$;

-- ================================================================ 5. The one-minute time-weighted average (exact, by construction)
TRUNCATE icanera_chain.fx_observations RESTART IDENTITY;
DO $t$
DECLARE q JSONB; tw NUMERIC;
BEGIN
  -- rate 100 from two minutes ago, then 200 from 30 s ago: over the last 60 s that is 30 s at 100 and 30 s at 200
  INSERT INTO icanera_chain.fx_observations (pair, rate, source, observed_at, accepted) VALUES
    ('USD/KES', 100, 'direct', now() - INTERVAL '120 seconds', TRUE), ('USD/KES', 200, 'direct', now() - INTERVAL '30 seconds', TRUE);
  q := t.rate('USD/KES');
  PERFORM t.check('5.1 the average is time-weighted: 30 s at 100 and 30 s at 200 is 150', abs((q ->> 'rate')::NUMERIC - 150) < 0.000001, q::TEXT);
  PERFORM t.check('5.2 the spot is the latest', (q ->> 'spot')::NUMERIC = 200 AND (q ->> 'window_s')::INT = 60, q::TEXT);
  INSERT INTO icanera_chain.fx_observations (pair, rate, source, observed_at, accepted) VALUES ('USD/KES', 300, 'direct', now() - INTERVAL '10 seconds', TRUE);
  q := t.rate('USD/KES');
  PERFORM t.check('5.3 30 s at 100, 20 s at 200, 10 s at 300 is 166.67', abs((q ->> 'rate')::NUMERIC - 166.666667) < 0.0001, q::TEXT);
  PERFORM t.check('5.4 one spike inside the minute is diluted by the time it lasted', (SELECT icanera_chain.fx_twap('USD/KES', 60)) < 200);

  INSERT INTO icanera_chain.fx_observations (pair, rate, source, observed_at, accepted) VALUES ('USD/TZS', 123.456, 'direct', now() - INTERVAL '200 seconds', TRUE);
  q := t.rate('USD/TZS');
  PERFORM t.check('5.5 a single old observation carries across the whole window', abs((q ->> 'rate')::NUMERIC - 123.456) < 0.000001, q::TEXT);
  INSERT INTO icanera_chain.fx_observations (pair, rate, source, observed_at, accepted, reject_reason) VALUES ('USD/TZS', 999, 'direct', now() - INTERVAL '5 seconds', FALSE, 'jump');
  q := t.rate('USD/TZS');
  PERFORM t.check('5.6 a rejected observation never enters the average', abs((q ->> 'rate')::NUMERIC - 123.456) < 0.000001, q::TEXT);
  PERFORM t.check('5.7 an unknown pair has no average', icanera_chain.fx_twap('USD/XXX', 60) IS NULL);
END $t$;

-- ================================================================ 6. Staleness
DO $t$
DECLARE q JSONB;
BEGIN
  INSERT INTO icanera_chain.fx_observations (pair, rate, source, observed_at, accepted) VALUES ('USD/RWF', 1300, 'direct', now() - INTERVAL '2000 seconds', TRUE);
  q := t.rate('USD/RWF');
  PERFORM t.check('6.1 a rate older than the staleness limit (900 s) is flagged stale, with its age', (q ->> 'stale')::BOOLEAN AND (q ->> 'age_s')::INT BETWEEN 1999 AND 2001 AND (q ->> 'available')::BOOLEAN, q::TEXT);
  q := t.rate('USD/KES');
  PERFORM t.check('6.2 a fresh one is not', NOT (q ->> 'stale')::BOOLEAN, q::TEXT);
  PERFORM t.set('{"fx_stale_s": 5}');
  PERFORM t.check('6.3 the limit is a setting', (t.rate('USD/KES') ->> 'stale')::BOOLEAN);
  PERFORM t.set('{"fx_stale_s": 900}');
END $t$;

-- ================================================================ 7. Tamper-proofing
DO $t$
DECLARE e TEXT;
BEGIN
  e := t.err($q$UPDATE icanera_chain.fx_observations SET rate = 1$q$);
  PERFORM t.check('7.1 observations cannot be edited', e LIKE 'fx_observations rows are not edited%', e);
  e := t.err($q$DELETE FROM icanera_chain.fx_observations$q$);
  PERFORM t.check('7.2 or deleted in their first week', e LIKE 'fx_observations rows are not edited%', e);
  INSERT INTO icanera_chain.fx_observations (pair, rate, source, observed_at, accepted, created_at) VALUES ('USD/OLD', 1, 'direct', now() - INTERVAL '40 days', TRUE, now() - INTERVAL '40 days');
  e := t.err($q$DELETE FROM icanera_chain.fx_observations WHERE pair = 'USD/OLD'$q$);
  PERFORM t.check('7.3 old ones can be pruned', e IS NULL, e);
END $t$;

-- ================================================================ 8. It is display-only
DO $t$
DECLARE w0 NUMERIC; l0 NUMERIC; c0 TEXT; c1 TEXT; r JSONB;
BEGIN
  SELECT COALESCE(SUM(ican_balance), 0) INTO w0 FROM public.ican_user_wallets;
  l0 := icanera_chain.locked_total();
  SELECT md5(string_agg(currency_code || rate_to_ugx::TEXT, ',' ORDER BY currency_code)) INTO c0 FROM public.ican_currency_rates;
  r := t.fx('USD/UGX', 4000, 5);
  r := t.fx('USD/UGX', 4001, 4);
  r := t.fx('USD/UGX', 9999, 3);
  SELECT md5(string_agg(currency_code || rate_to_ugx::TEXT, ',' ORDER BY currency_code)) INTO c1 FROM public.ican_currency_rates;
  PERFORM t.check('8.1 feeding the oracle changes no wallet and no locked ICEC',
    (SELECT COALESCE(SUM(ican_balance), 0) FROM public.ican_user_wallets) = w0 AND icanera_chain.locked_total() = l0);
  PERFORM t.check('8.2 and does not touch the existing currency-rate table', c0 = c1);
  PERFORM t.as_user(t.u(1));
  r := public.ican_chain_dev_fx_overview('dev_test_secret');
  PERFORM t.reset();
  PERFORM t.check('8.3 the admin overview shows each pair''s health and the last hour''s accept/reject counts',
    jsonb_array_length(r -> 'pairs') >= 3 AND (r -> 'last_hour' ->> 'accepted')::INT >= 1 AND (r -> 'last_hour' ? 'jump'), r::TEXT);
END $t$;

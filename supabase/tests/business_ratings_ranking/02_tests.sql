\set ON_ERROR_STOP on
-- Business ratings, subscriptions and the ranked product page.
CREATE SCHEMA t;
GRANT USAGE ON SCHEMA t TO PUBLIC;
CREATE FUNCTION t.u(n INT) RETURNS UUID LANGUAGE sql IMMUTABLE AS $$ SELECT ('00000000-0000-0000-0000-' || lpad(n::TEXT, 12, '0'))::UUID $$;
CREATE FUNCTION t.as_user(n INT) RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN
  PERFORM set_config('request.jwt.claim.sub', t.u(n)::TEXT, false); EXECUTE 'SET ROLE authenticated'; END $$;
CREATE FUNCTION t.as_anon() RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', false); EXECUTE 'SET ROLE anon'; END $$;
CREATE FUNCTION t.as_admin() RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', false); EXECUTE 'RESET ROLE'; END $$;
CREATE FUNCTION t.check(p_name TEXT, p_ok BOOLEAN, p_detail TEXT DEFAULT '') RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN
  IF p_ok IS TRUE THEN RAISE INFO 'PASS %', p_name; ELSE RAISE EXCEPTION 'FAIL % %', p_name, p_detail; END IF; END $$;
CREATE FUNCTION t.raises(p_sql TEXT) RETURNS BOOLEAN LANGUAGE plpgsql AS $$ BEGIN EXECUTE p_sql; RETURN false; EXCEPTION WHEN OTHERS THEN RETURN true; END $$;
-- short store letter ('a'..'d') of a store id, for readable orderings
CREATE FUNCTION t.letter(p_store UUID) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$ SELECT right(p_store::TEXT, 1) $$;
-- the store letters of a page, in display order, e.g. 'abdc...'
CREATE FUNCTION t.order_of(p_offset INT, p_limit INT, p_store UUID DEFAULT NULL, p_exclude UUID[] DEFAULT NULL, p_search TEXT DEFAULT NULL, p_category TEXT DEFAULT NULL)
RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT COALESCE(string_agg(t.letter(supermarket_id), '' ORDER BY ord), '')
  FROM (SELECT supermarket_id, row_number() OVER () AS ord
        FROM public.fn_ranked_products_page(p_store, p_exclude, p_search, p_category, p_offset, p_limit)) x $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA t TO PUBLIC;
SET client_min_messages = info;

-- ============ 1. Rating a business
SELECT t.as_user(5);
DO $t$
DECLARE r JSONB;
BEGIN
  r := public.fn_rate_business('b0000000-0000-0000-0000-00000000000a', 4, '  Good shop  ');
  PERFORM t.check('1.1 a signed-in customer can rate', (r->>'my_rating')::INT = 4 AND r->>'my_comment' = 'Good shop', r::TEXT);
  r := public.fn_rate_business('b0000000-0000-0000-0000-00000000000a', 5, NULL);
  PERFORM t.check('1.2 rating again replaces the first rating (one per customer)', (r->>'rating_count')::INT = 1 AND (r->>'my_rating')::INT = 5 AND r->'my_comment' = 'null'::JSONB, r::TEXT);
  PERFORM t.check('1.3 0 and 6 stars are refused',
    t.raises($$SELECT public.fn_rate_business('b0000000-0000-0000-0000-00000000000a', 0, NULL)$$)
    AND t.raises($$SELECT public.fn_rate_business('b0000000-0000-0000-0000-00000000000a', 6, NULL)$$));
  PERFORM t.check('1.4 an unknown business is refused', t.raises($$SELECT public.fn_rate_business(gen_random_uuid(), 5, NULL)$$));
  PERFORM t.check('1.5 an over-long comment is cut to 500 characters',
    length((SELECT public.fn_rate_business('b0000000-0000-0000-0000-00000000000a', 5, repeat('x', 900)))->>'my_comment') = 500);
  r := public.fn_clear_business_rating('b0000000-0000-0000-0000-00000000000a');
  PERFORM t.check('1.6 a customer can withdraw their rating', (r->>'rating_count')::INT = 0 AND r->'my_rating' = 'null'::JSONB, r::TEXT);
END $t$;

SELECT t.as_user(1);
DO $t$
BEGIN
  PERFORM t.check('1.7 the owner cannot rate their own business', t.raises($$SELECT public.fn_rate_business('b0000000-0000-0000-0000-00000000000a', 5, NULL)$$));
  PERFORM t.check('1.8 the owner cannot subscribe to their own business', t.raises($$SELECT public.fn_subscribe_business('b0000000-0000-0000-0000-00000000000a')$$));
  PERFORM t.check('1.9 the owner is told they are the owner', (public.fn_business_site_stats('b0000000-0000-0000-0000-00000000000a')->>'is_owner')::BOOLEAN);
END $t$;

SELECT t.as_anon();
DO $t$
BEGIN
  PERFORM t.check('1.10 an anonymous visitor cannot rate', t.raises($$SELECT public.fn_rate_business('b0000000-0000-0000-0000-00000000000a', 5, NULL)$$));
  PERFORM t.check('1.11 an anonymous visitor cannot subscribe', t.raises($$SELECT public.fn_subscribe_business('b0000000-0000-0000-0000-00000000000a')$$));
  PERFORM t.check('1.12 the tables cannot be read directly',
    t.raises('SELECT * FROM public.business_site_ratings') AND t.raises('SELECT * FROM public.business_site_subscriptions'));
END $t$;
SELECT t.as_user(5);
DO $t$
BEGIN
  PERFORM t.check('1.13 a signed-in customer cannot read the tables directly either',
    t.raises('SELECT * FROM public.business_site_ratings') AND t.raises('INSERT INTO public.business_site_ratings (business_profile_id, user_id, rating) VALUES (gen_random_uuid(), gen_random_uuid(), 5)'));
END $t$;

-- ============ 2. Build the scenario
-- Alpha: users 5-20 give 5 stars, 21-24 give 4 (average 4.8); users 5-14 follow.  Charlie: users 25-27 give 1 star.
-- Delta: user 28 gives a single 5-star.  Bravo: nobody.
DO $t$
DECLARE n INT;
BEGIN
  FOR n IN 5..24 LOOP
    PERFORM t.as_user(n);
    PERFORM public.fn_rate_business('b0000000-0000-0000-0000-00000000000a', CASE WHEN n <= 20 THEN 5 ELSE 4 END, CASE WHEN n = 6 THEN 'Fresh and cheap' WHEN n = 7 THEN 'Fast delivery' END);
    IF n <= 14 THEN PERFORM public.fn_subscribe_business('b0000000-0000-0000-0000-00000000000a'); END IF;
  END LOOP;
  FOR n IN 25..27 LOOP
    PERFORM t.as_user(n);
    PERFORM public.fn_rate_business('b0000000-0000-0000-0000-00000000000c', 1, NULL);
  END LOOP;
  PERFORM t.as_user(28);
  PERFORM public.fn_rate_business('b0000000-0000-0000-0000-00000000000d', 5, NULL);
END $t$;

SELECT t.as_anon();
DO $t$
DECLARE s JSONB; a NUMERIC; b NUMERIC; c NUMERIC; d NUMERIC; reviews INT;
BEGIN
  s := public.fn_business_site_stats('b0000000-0000-0000-0000-00000000000a');
  PERFORM t.check('2.1 stats: count, average and followers', (s->>'rating_count')::INT = 20 AND (s->>'rating_avg')::NUMERIC = 4.80 AND (s->>'subscriber_count')::INT = 10, s::TEXT);
  PERFORM t.check('2.2 stats: star distribution', s->'distribution' = '{"4": 4, "5": 16}'::JSONB, (s->'distribution')::TEXT);
  PERFORM t.check('2.3 an anonymous visitor sees no personal fields', s->'my_rating' = 'null'::JSONB AND (s->>'subscribed')::BOOLEAN IS FALSE AND (s->>'is_owner')::BOOLEAN IS FALSE);
  SELECT count(*) INTO reviews FROM public.fn_business_site_reviews('b0000000-0000-0000-0000-00000000000a', 10);
  PERFORM t.check('2.4 only written reviews are listed, and without names', reviews = 2
    AND pg_get_function_result('public.fn_business_site_reviews(uuid,integer)'::regprocedure) = 'TABLE(rating smallint, comment text, created_at timestamp with time zone)');

  SELECT score INTO a FROM public.fn_store_rating_badges(ARRAY['a0000000-0000-0000-0000-00000000000a'::UUID]);
  SELECT score INTO b FROM public.fn_store_rating_badges(ARRAY['a0000000-0000-0000-0000-00000000000b'::UUID]);
  SELECT score INTO c FROM public.fn_store_rating_badges(ARRAY['a0000000-0000-0000-0000-00000000000c'::UUID]);
  SELECT score INTO d FROM public.fn_store_rating_badges(ARRAY['a0000000-0000-0000-0000-00000000000d'::UUID]);
  PERFORM t.check('2.5 score order: well rated + followed > one lone 5-star > unrated > badly rated', a > d AND d > b AND b > c, format('a=%s d=%s b=%s c=%s', a, d, b, c));
  PERFORM t.check('2.6 a lone 5-star is pulled toward the average (Bayesian), so it does not outrank a proven store', d < a - 0.2, format('a=%s d=%s', a, d));
  PERFORM t.check('2.7 an unrated store is neutral, not last', b > c);
  PERFORM t.check('2.8 badges carry the plain numbers',
    (SELECT rating_avg = 1.00 AND rating_count = 3 AND subscriber_count = 0 FROM public.fn_store_rating_badges(ARRAY['a0000000-0000-0000-0000-00000000000c'::UUID])));
  PERFORM t.check('2.9 a store linked from the business side (Delta) is scored too', (SELECT rating_count FROM public.fn_store_rating_badges(ARRAY['a0000000-0000-0000-0000-00000000000d'::UUID])) = 1);
  PERFORM t.check('2.10 an anonymous visitor cannot ask for someone else''s followed stores', t.raises('SELECT * FROM public.fn_my_subscribed_stores()'));
END $t$;

-- ============ 3. The ranked page for everyone
DO $t$
DECLARE first_page TEXT; everything TEXT;
BEGIN
  first_page := t.order_of(0, 12);
  everything := t.order_of(0, 100);
  PERFORM t.check('3.1 the best-rated, most-followed store leads', left(first_page, 1) = 'a', first_page);
  PERFORM t.check('3.2 every open store appears on the first page (nobody is buried)', first_page ~ 'a' AND first_page ~ 'b' AND first_page ~ 'c' AND first_page ~ 'd', first_page);
  PERFORM t.check('3.3 the leading store gets more of the first page than the worst one',
    (length(first_page) - length(replace(first_page, 'a', ''))) > (length(first_page) - length(replace(first_page, 'c', ''))), first_page);
  PERFORM t.check('3.4 all 24 products of the open stores are listed once, the closed store is not', length(everything) = 24 AND everything !~ 'f', everything);
  PERFORM t.check('3.5 out-of-stock products come last',
    (SELECT bool_and(NOT in_stock) FROM (
        SELECT p.id, (COALESCE(i.current_stock, 0) > 0) AS in_stock, row_number() OVER () AS rn
        FROM public.fn_ranked_products_page(NULL, NULL, NULL, NULL, 0, 100) r
        JOIN public.products p ON p.id = r.product_id LEFT JOIN public.inventory i ON i.product_id = p.id) x WHERE rn > 22));
  PERFORM t.check('3.6 pages join up exactly: 5 per page gives the same order, no repeats, no gaps',
    t.order_of(0, 5) || t.order_of(5, 5) || t.order_of(10, 5) || t.order_of(15, 5) || t.order_of(20, 5) = everything);
  PERFORM t.check('3.7 the same product never shows twice',
    (SELECT count(DISTINCT product_id) = count(*) FROM public.fn_ranked_products_page(NULL, NULL, NULL, NULL, 0, 100)));
  PERFORM t.check('3.8 the page rows carry the store''s stars and followers',
    (SELECT rating_avg = 4.80 AND rating_count = 20 AND subscriber_count = 10 AND is_subscribed IS FALSE
       FROM public.fn_ranked_products_page('a0000000-0000-0000-0000-00000000000a', NULL, NULL, NULL, 0, 1)));
END $t$;

-- ============ 4. Same filters the apps already had
DO $t$
BEGIN
  PERFORM t.check('4.1 one store: only its products', t.order_of(0, 100, 'a0000000-0000-0000-0000-00000000000b') = 'bbbbbb');
  PERFORM t.check('4.2 a closed store is hidden from the all-stores view but still opens on its own',
    t.order_of(0, 100, 'a0000000-0000-0000-0000-0000000000ff') = 'f');
  PERFORM t.check('4.3 stores can be excluded from the all-stores view', t.order_of(0, 100, NULL, ARRAY['a0000000-0000-0000-0000-00000000000a'::UUID]) !~ 'a'
    AND length(t.order_of(0, 100, NULL, ARRAY['a0000000-0000-0000-0000-00000000000a'::UUID])) = 18);
  PERFORM t.check('4.4 ...but exclusion is ignored when one store is asked for', t.order_of(0, 100, 'a0000000-0000-0000-0000-00000000000a', ARRAY['a0000000-0000-0000-0000-00000000000a'::UUID]) = 'aaaaaa');
  PERFORM t.check('4.5 search matches the name', length(t.order_of(0, 100, NULL, NULL, 'Charlie store item 2')) = 1);
  PERFORM t.check('4.6 search matches the description', length(t.order_of(0, 100, NULL, NULL, 'pure')) = 4);
  PERFORM t.check('4.7 a % in the search is taken literally, not as a wildcard', length(t.order_of(0, 100, NULL, NULL, '100%')) = 4 AND length(t.order_of(0, 100, NULL, NULL, '%')) = 4);
  PERFORM t.check('4.8 a _ in the search is taken literally, not as a wildcard', length(t.order_of(0, 100, NULL, NULL, '_')) = 4 AND length(t.order_of(0, 100, NULL, NULL, 'pure_j')) = 4);
  PERFORM t.check('4.9 category by name', length(t.order_of(0, 100, NULL, NULL, NULL, 'Drinks')) = 8 AND length(t.order_of(0, 100, NULL, NULL, NULL, 'Snacks')) = 8);
  PERFORM t.check('4.10 "Other" is the uncategorised products', length(t.order_of(0, 100, NULL, NULL, NULL, 'Other')) = 8);
  PERFORM t.check('4.11 a limit above 100 is capped and a negative offset is treated as 0',
    length(t.order_of(-5, 5000)) = 24 AND t.order_of(-5, 3) = t.order_of(0, 3));
END $t$;

-- ============ 5. A subscriber sees their shops first
SELECT t.as_user(30);
DO $t$
DECLARE s JSONB; before_order TEXT; after_order TEXT;
BEGIN
  before_order := t.order_of(0, 100);
  PERFORM public.fn_subscribe_business('b0000000-0000-0000-0000-00000000000c');
  PERFORM public.fn_subscribe_business('b0000000-0000-0000-0000-00000000000c');
  s := public.fn_business_site_stats('b0000000-0000-0000-0000-00000000000c');
  PERFORM t.check('5.1 subscribing twice counts once', (s->>'subscriber_count')::INT = 1 AND (s->>'subscribed')::BOOLEAN, s::TEXT);
  after_order := t.order_of(0, 100);
  PERFORM t.check('5.2 the in-stock products of a followed store come first, whatever its score', left(after_order, 5) = 'ccccc', after_order);
  PERFORM t.check('5.3 the rest keep the normal order', replace(after_order, 'c', '') = replace(before_order, 'c', ''), before_order || ' -> ' || after_order);
  PERFORM t.check('5.4 the same list still holds all 24 products', length(after_order) = 24);
  PERFORM t.check('5.5 my followed stores are listed', (SELECT count(*) = 1 AND bool_and(supermarket_id = 'a0000000-0000-0000-0000-00000000000c') FROM public.fn_my_subscribed_stores()));
  PERFORM t.check('5.6 rows say which are mine', (SELECT bool_and(is_subscribed) FROM public.fn_ranked_products_page('a0000000-0000-0000-0000-00000000000c', NULL, NULL, NULL, 0, 10)));
END $t$;
SELECT t.as_anon();
DO $t$
BEGIN
  PERFORM t.check('5.7 other visitors are unaffected by that customer''s follow', left(t.order_of(0, 100), 1) = 'a');
END $t$;
SELECT t.as_user(30);
DO $t$
DECLARE s JSONB;
BEGIN
  s := public.fn_unsubscribe_business('b0000000-0000-0000-0000-00000000000c');
  PERFORM t.check('5.8 unsubscribing puts the order back', (s->>'subscriber_count')::INT = 0 AND left(t.order_of(0, 100), 1) = 'a', t.order_of(0, 100));
END $t$;

-- ============ 6. Changing a rating moves the ranking
SELECT t.as_admin();
DO $t$ DECLARE n INT;
BEGIN
  -- Charlie's three 1-star customers change their minds
  FOR n IN 25..27 LOOP
    PERFORM t.as_user(n);
    PERFORM public.fn_rate_business('b0000000-0000-0000-0000-00000000000c', 5, 'Much better now');
  END LOOP;
END $t$;
SELECT t.as_anon();
DO $t$
DECLARE c NUMERIC; b NUMERIC;
BEGIN
  SELECT score INTO c FROM public.fn_store_rating_badges(ARRAY['a0000000-0000-0000-0000-00000000000c'::UUID]);
  SELECT score INTO b FROM public.fn_store_rating_badges(ARRAY['a0000000-0000-0000-0000-00000000000b'::UUID]);
  PERFORM t.check('6.1 better ratings lift a store above the unrated one', c > b, format('c=%s b=%s', c, b));
END $t$;

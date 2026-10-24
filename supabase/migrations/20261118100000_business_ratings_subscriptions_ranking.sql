-- ============================================================
-- Business website: ratings, subscriptions, and a smart product ranking
-- ============================================================
-- Customers can now RATE a business (1-5 stars, optional comment) and SUBSCRIBE to it from the
-- business website (icanera.space/notices/<company>). Those two signals decide which store's
-- products are shown first in every app on this shared Supabase project: IcanEra's own shop,
-- SupermarketEra (digital-city-era) and BodaGoEra (mybodaguy).
--
--   business_site_ratings          one row per (business, customer): 1-5 stars + optional comment
--   business_site_subscriptions    one row per (business, customer): the customer follows the business
--
-- The ranking (fn_ranked_products_page) is one function every app calls instead of ordering by
-- "newest first". It is deliberately not "highest score wins everything":
--
--   quality     Bayesian average of the star ratings, pulled toward the platform-wide mean until a
--               business has ~3 ratings. One 5-star review does not beat 200 reviews averaging 4.6, and
--               a business with no ratings yet starts neutral, not last.
--   popularity  log-scaled subscriber count relative to the most-followed business (log, so a giant
--               cannot bury every small shop).
--   score       0.65 * quality + 0.35 * popularity, between 0 and 1.
--
-- Products are then laid out fairly rather than store-by-store: each store's products are numbered
-- 1, 2, 3 ... (in stock first, newest first) and sorted by  position / (0.5 + 1.5 * score).  A top-scoring
-- store gets its Nth product onto the page about twice as early as a neutral one, but every store still
-- appears on page one, so a 1000-product store cannot push everyone else off the first screens.
-- Out-of-stock products always come after in-stock ones.
--
-- For a signed-in customer the stores they SUBSCRIBED to come first, ahead of the score ordering ("my
-- shops first"); everyone else sees the score ordering. Owners cannot rate or subscribe to their own
-- business, and a customer has one rating and one subscription per business (editing replaces it), so the
-- numbers cannot be farmed from a single account.
--
-- Apps that have not been updated keep working: this only ADDS tables and functions. Nothing here touches
-- wallets, payments, orders or stock. Safe to run more than once.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Tables
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.business_site_ratings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating              SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment             TEXT CHECK (comment IS NULL OR char_length(comment) <= 500),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_profile_id, user_id)
);
CREATE INDEX IF NOT EXISTS business_site_ratings_business_idx
  ON public.business_site_ratings (business_profile_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.business_site_subscriptions (
  business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (business_profile_id, user_id)
);
CREATE INDEX IF NOT EXISTS business_site_subscriptions_user_idx
  ON public.business_site_subscriptions (user_id);

-- Everything goes through the SECURITY DEFINER functions below; the tables are not readable directly
-- (a customer must never be able to list who else rated or followed a business).
ALTER TABLE public.business_site_ratings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_site_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.business_site_ratings       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.business_site_subscriptions FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 2. Scores: one row per store
-- ------------------------------------------------------------
-- A business owns a store when supermarkets.pichin_business_profile_id points at it or business_profiles.supermarket_id
-- points at the store (the same rule the business website uses).
-- Internal: the ranking function and the public stats call it. rating_avg is the plain average (what a
-- customer sees as "4.6"); quality uses the Bayesian one.
CREATE OR REPLACE FUNCTION public._store_rank_scores()
RETURNS TABLE (
  supermarket_id   UUID,
  business_profile_id UUID,
  rating_avg       NUMERIC,
  rating_count     INTEGER,
  subscriber_count INTEGER,
  score            NUMERIC
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH store_biz AS (
    SELECT s.id AS supermarket_id,
           COALESCE(s.pichin_business_profile_id,
                    (SELECT bp.id FROM public.business_profiles bp WHERE bp.supermarket_id = s.id ORDER BY bp.id LIMIT 1)) AS business_profile_id
    FROM public.supermarkets s
  ),
  r AS (
    SELECT business_profile_id, count(*)::int AS n, sum(rating)::numeric AS total
    FROM public.business_site_ratings GROUP BY business_profile_id
  ),
  sub AS (
    SELECT business_profile_id, count(*)::int AS n
    FROM public.business_site_subscriptions GROUP BY business_profile_id
  ),
  g AS (SELECT COALESCE(avg(rating), 3.5)::numeric AS mean FROM public.business_site_ratings),
  mx AS (SELECT COALESCE(max(n), 0)::numeric AS most FROM sub)
  SELECT sb.supermarket_id,
         sb.business_profile_id,
         CASE WHEN COALESCE(r.n, 0) > 0 THEN round(r.total / r.n, 2) END AS rating_avg,
         COALESCE(r.n, 0) AS rating_count,
         COALESCE(sub.n, 0) AS subscriber_count,
         round((
           0.65 * ((((g.mean * 3) + COALESCE(r.total, 0)) / (3 + COALESCE(r.n, 0))) - 1) / 4
           + 0.35 * CASE WHEN mx.most > 0 THEN ln((1 + COALESCE(sub.n, 0))::numeric) / ln(1 + mx.most) ELSE 0 END
         )::numeric, 4) AS score
  FROM store_biz sb
  CROSS JOIN g CROSS JOIN mx
  LEFT JOIN r   ON r.business_profile_id   = sb.business_profile_id
  LEFT JOIN sub ON sub.business_profile_id = sb.business_profile_id;
$$;
REVOKE ALL ON FUNCTION public._store_rank_scores() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 3. Rate / subscribe (signed-in customers)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._business_site_check(p_business_profile_id UUID, p_action TEXT)
RETURNS UUID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.business_profiles WHERE id = p_business_profile_id) THEN
    RAISE EXCEPTION 'Business not found';
  END IF;
  IF EXISTS (SELECT 1 FROM public.business_profiles WHERE id = p_business_profile_id AND user_id = v_uid) THEN
    RAISE EXCEPTION 'You cannot % your own business', p_action;
  END IF;
  RETURN v_uid;
END;
$$;
REVOKE ALL ON FUNCTION public._business_site_check(UUID, TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_rate_business(
  p_business_profile_id UUID,
  p_rating INTEGER,
  p_comment TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID;
  v_comment TEXT := NULLIF(left(btrim(COALESCE(p_comment, '')), 500), '');
BEGIN
  v_uid := public._business_site_check(p_business_profile_id, 'rate');
  IF p_rating IS NULL OR p_rating NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'Choose 1 to 5 stars';
  END IF;

  INSERT INTO public.business_site_ratings (business_profile_id, user_id, rating, comment)
  VALUES (p_business_profile_id, v_uid, p_rating::SMALLINT, v_comment)
  ON CONFLICT (business_profile_id, user_id)
  DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment, updated_at = now();

  RETURN public.fn_business_site_stats(p_business_profile_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_clear_business_rating(p_business_profile_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  DELETE FROM public.business_site_ratings
  WHERE business_profile_id = p_business_profile_id AND user_id = auth.uid();
  RETURN public.fn_business_site_stats(p_business_profile_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_subscribe_business(p_business_profile_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID;
BEGIN
  v_uid := public._business_site_check(p_business_profile_id, 'subscribe to');
  INSERT INTO public.business_site_subscriptions (business_profile_id, user_id)
  VALUES (p_business_profile_id, v_uid)
  ON CONFLICT DO NOTHING;
  RETURN public.fn_business_site_stats(p_business_profile_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_unsubscribe_business(p_business_profile_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  DELETE FROM public.business_site_subscriptions
  WHERE business_profile_id = p_business_profile_id AND user_id = auth.uid();
  RETURN public.fn_business_site_stats(p_business_profile_id);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_rate_business(UUID, INTEGER, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_clear_business_rating(UUID)         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_subscribe_business(UUID)            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_unsubscribe_business(UUID)          FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_rate_business(UUID, INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_clear_business_rating(UUID)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_subscribe_business(UUID)            TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_unsubscribe_business(UUID)          TO authenticated;

-- ------------------------------------------------------------
-- 4. What the business website shows (anyone; "mine" fields only when signed in)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_business_site_stats(p_business_profile_id UUID)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'rating_avg',       (SELECT round(avg(rating)::numeric, 2) FROM public.business_site_ratings WHERE business_profile_id = p_business_profile_id),
    'rating_count',     (SELECT count(*) FROM public.business_site_ratings WHERE business_profile_id = p_business_profile_id),
    'distribution',     COALESCE((
                          SELECT jsonb_object_agg(rating::text, n)
                          FROM (SELECT rating, count(*) AS n FROM public.business_site_ratings
                                WHERE business_profile_id = p_business_profile_id GROUP BY rating) d
                        ), '{}'::jsonb),
    'subscriber_count', (SELECT count(*) FROM public.business_site_subscriptions WHERE business_profile_id = p_business_profile_id),
    'my_rating',        (SELECT rating  FROM public.business_site_ratings WHERE business_profile_id = p_business_profile_id AND user_id = auth.uid()),
    'my_comment',       (SELECT comment FROM public.business_site_ratings WHERE business_profile_id = p_business_profile_id AND user_id = auth.uid()),
    'subscribed',       EXISTS (SELECT 1 FROM public.business_site_subscriptions WHERE business_profile_id = p_business_profile_id AND user_id = auth.uid()),
    'is_owner',         EXISTS (SELECT 1 FROM public.business_profiles WHERE id = p_business_profile_id AND user_id = auth.uid())
  );
$$;
REVOKE ALL ON FUNCTION public.fn_business_site_stats(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_business_site_stats(UUID) TO anon, authenticated;

-- Recent written reviews. Reviewers are not named: the website shows the stars, the words and the date.
CREATE OR REPLACE FUNCTION public.fn_business_site_reviews(p_business_profile_id UUID, p_limit INTEGER DEFAULT 10)
RETURNS TABLE (rating SMALLINT, comment TEXT, created_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.rating, r.comment, r.updated_at
  FROM public.business_site_ratings r
  WHERE r.business_profile_id = p_business_profile_id AND r.comment IS NOT NULL
  ORDER BY r.updated_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 10), 1), 50);
$$;
REVOKE ALL ON FUNCTION public.fn_business_site_reviews(UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_business_site_reviews(UUID, INTEGER) TO anon, authenticated;

-- The stores the signed-in customer follows (their "my shops").
CREATE OR REPLACE FUNCTION public.fn_my_subscribed_stores()
RETURNS TABLE (supermarket_id UUID, business_profile_id UUID)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT sc.supermarket_id, sc.business_profile_id
  FROM public._store_rank_scores() sc
  WHERE auth.uid() IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.business_site_subscriptions bs
                WHERE bs.business_profile_id = sc.business_profile_id AND bs.user_id = auth.uid());
$$;
REVOKE ALL ON FUNCTION public.fn_my_subscribed_stores() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_my_subscribed_stores() TO authenticated;

-- ------------------------------------------------------------
-- 5. The ranked product page every app uses
-- ------------------------------------------------------------
-- Same filters the apps already apply (active products; for the all-stores view only active stores;
-- optional store, excluded stores, search text, category name where 'Other' = uncategorised). Returns the
-- product ids for ONE page in display order, plus the store's numbers so the app can show "4.6 ★ (12)".
-- The app then loads those products exactly as it did before and keeps this order.
CREATE OR REPLACE FUNCTION public.fn_ranked_products_page(
  p_supermarket_id    UUID    DEFAULT NULL,
  p_exclude_store_ids UUID[]  DEFAULT NULL,
  p_search            TEXT    DEFAULT NULL,
  p_category          TEXT    DEFAULT NULL,
  p_offset            INTEGER DEFAULT 0,
  p_limit             INTEGER DEFAULT 25
)
RETURNS TABLE (
  product_id       UUID,
  supermarket_id   UUID,
  store_score      NUMERIC,
  rating_avg       NUMERIC,
  rating_count     INTEGER,
  subscriber_count INTEGER,
  is_subscribed    BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH scores AS (SELECT * FROM public._store_rank_scores()),
  mine AS (
    SELECT sc.supermarket_id FROM scores sc
    WHERE auth.uid() IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.business_site_subscriptions bs
                  WHERE bs.business_profile_id = sc.business_profile_id AND bs.user_id = auth.uid())
  ),
  base AS (
    SELECT p.id, p.supermarket_id, p.created_at, (COALESCE(stock.qty, 0) > 0) AS in_stock
    FROM public.products p
    JOIN public.supermarkets s ON s.id = p.supermarket_id
    LEFT JOIN public.categories c ON c.id = p.category_id
    LEFT JOIN LATERAL (
      SELECT GREATEST(COALESCE(SUM(i.current_stock - COALESCE(i.reserved_stock, 0)), 0), 0) AS qty
      FROM public.inventory i WHERE i.product_id = p.id
    ) stock ON TRUE
    WHERE p.is_active IS TRUE
      AND (p_supermarket_id IS NULL OR p.supermarket_id = p_supermarket_id)
      AND (p_supermarket_id IS NOT NULL OR COALESCE(s.is_active, TRUE))
      AND (p_exclude_store_ids IS NULL OR p_supermarket_id IS NOT NULL OR NOT (p.supermarket_id = ANY (p_exclude_store_ids)))
      AND (p_category IS NULL OR btrim(p_category) = ''
           OR (p_category = 'Other' AND p.category_id IS NULL)
           OR (p_category <> 'Other' AND c.name = p_category))
      AND (p_search IS NULL OR btrim(p_search) = ''
           OR p.name ILIKE '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%'
           OR p.description ILIKE '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%')
  ),
  numbered AS (
    SELECT b.id, b.supermarket_id, b.created_at, b.in_stock,
           COALESCE(sc.score, 0.4)            AS score,
           sc.rating_avg,
           COALESCE(sc.rating_count, 0)       AS rating_count,
           COALESCE(sc.subscriber_count, 0)   AS subscriber_count,
           (mine.supermarket_id IS NOT NULL)  AS is_subscribed,
           row_number() OVER (PARTITION BY b.supermarket_id ORDER BY b.in_stock DESC, b.created_at DESC, b.id) AS pos
    FROM base b
    LEFT JOIN scores sc   ON sc.supermarket_id   = b.supermarket_id
    LEFT JOIN mine        ON mine.supermarket_id = b.supermarket_id
  )
  SELECT n.id, n.supermarket_id, n.score, n.rating_avg, n.rating_count, n.subscriber_count, n.is_subscribed
  FROM numbered n
  ORDER BY (NOT n.in_stock),
           (NOT n.is_subscribed),
           n.pos / (0.5 + 1.5 * n.score),
           n.score DESC,
           n.created_at DESC,
           n.id
  OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
$$;
REVOKE ALL ON FUNCTION public.fn_ranked_products_page(UUID, UUID[], TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_ranked_products_page(UUID, UUID[], TEXT, TEXT, INTEGER, INTEGER) TO anon, authenticated;

-- Stars + followers for a few stores at once (store lists, store pickers).
CREATE OR REPLACE FUNCTION public.fn_store_rating_badges(p_store_ids UUID[])
RETURNS TABLE (supermarket_id UUID, rating_avg NUMERIC, rating_count INTEGER, subscriber_count INTEGER, score NUMERIC)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT sc.supermarket_id, sc.rating_avg, sc.rating_count, sc.subscriber_count, sc.score
  FROM public._store_rank_scores() sc
  WHERE p_store_ids IS NOT NULL AND sc.supermarket_id = ANY (p_store_ids);
$$;
REVOKE ALL ON FUNCTION public.fn_store_rating_badges(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_store_rating_badges(UUID[]) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'Business ratings, subscriptions and smart product ranking ready' AS status;

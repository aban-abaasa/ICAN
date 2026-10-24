-- Removes business ratings, subscriptions and the ranked product page.
-- WARNING: deletes every rating and subscription customers have given. Products, stores, wallets and orders are never touched.
-- Apps fall back to "newest first" on their own when fn_ranked_products_page is gone.
DROP FUNCTION IF EXISTS public.fn_ranked_products_page(UUID, UUID[], TEXT, TEXT, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS public.fn_store_rating_badges(UUID[]);
DROP FUNCTION IF EXISTS public.fn_my_subscribed_stores();
DROP FUNCTION IF EXISTS public.fn_business_site_reviews(UUID, INTEGER);
DROP FUNCTION IF EXISTS public.fn_rate_business(UUID, INTEGER, TEXT);
DROP FUNCTION IF EXISTS public.fn_clear_business_rating(UUID);
DROP FUNCTION IF EXISTS public.fn_subscribe_business(UUID);
DROP FUNCTION IF EXISTS public.fn_unsubscribe_business(UUID);
DROP FUNCTION IF EXISTS public.fn_business_site_stats(UUID);
DROP FUNCTION IF EXISTS public._business_site_check(UUID, TEXT);
DROP FUNCTION IF EXISTS public._store_rank_scores();
DROP TABLE IF EXISTS public.business_site_subscriptions;
DROP TABLE IF EXISTS public.business_site_ratings;
NOTIFY pgrst, 'reload schema';

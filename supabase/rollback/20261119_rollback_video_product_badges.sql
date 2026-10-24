-- Removes product badges (PitchIn videos and status updates) and the service-price switches.
-- WARNING: deletes every badge, the record of what badges cost, and the price the developer set. Pitches, wallets and stores are untouched.
-- Coin already paid for badges is not refunded.
DROP FUNCTION IF EXISTS public.fn_publish_video_badge(UUID);
DROP FUNCTION IF EXISTS public.fn_save_status_badge(UUID, UUID, UUID, UUID, TEXT, NUMERIC, TEXT, TEXT, INTEGER, INTEGER, TEXT);
DROP FUNCTION IF EXISTS public.fn_list_status_badges_manage(UUID);
DROP FUNCTION IF EXISTS public.fn_get_status_badges(UUID);
DROP FUNCTION IF EXISTS public.fn_status_badge_price();
DROP FUNCTION IF EXISTS public._video_badge_upsert(UUID, UUID, UUID, UUID, UUID, TEXT, NUMERIC, TEXT, TEXT, INTEGER, INTEGER, TEXT, INTEGER);
DROP FUNCTION IF EXISTS public._video_badge_can_manage(public.video_product_badges);
DROP FUNCTION IF EXISTS public.fn_delete_video_badge(UUID);
DROP FUNCTION IF EXISTS public.fn_save_pitch_badge(UUID, UUID, UUID, TEXT, NUMERIC, TEXT, TEXT, INTEGER, INTEGER, TEXT);
DROP FUNCTION IF EXISTS public.fn_pitch_badge_products(UUID);
DROP FUNCTION IF EXISTS public.fn_list_pitch_badges_manage(UUID);
DROP FUNCTION IF EXISTS public.fn_get_pitch_badges(UUID);
DROP FUNCTION IF EXISTS public._pitch_badge_json(public.video_product_badges, BOOLEAN);
DROP FUNCTION IF EXISTS public._pitch_badge_owns_product(UUID, UUID);
DROP FUNCTION IF EXISTS public._pitch_badge_can_manage(UUID);
DROP FUNCTION IF EXISTS public.ican_dev_set_service_price(TEXT, TEXT, NUMERIC, BOOLEAN);
DROP FUNCTION IF EXISTS public.ican_dev_get_service_prices(TEXT);
DROP FUNCTION IF EXISTS public.fn_pitch_badge_price();
DROP FUNCTION IF EXISTS public.ican_service_price(TEXT);
DROP TABLE IF EXISTS public.video_badge_charges;
DROP TABLE IF EXISTS public.video_product_badges;
DROP TABLE IF EXISTS public.ican_service_price_changes;
DROP TABLE IF EXISTS public.ican_service_prices;
NOTIFY pgrst, 'reload schema';

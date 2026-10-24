\set ON_ERROR_STOP on
-- users: 1 owns business B1 (store S1), 2 is CMMS staff of B1, 3 is a stranger, 4 owns business B2 (store S2)
CREATE FUNCTION public.tu(n INT) RETURNS UUID LANGUAGE sql IMMUTABLE AS $$ SELECT ('00000000-0000-0000-0000-' || lpad(n::TEXT, 12, '0'))::UUID $$;

INSERT INTO public.business_profiles (id, user_id, business_name, supermarket_id) VALUES
  ('b0000000-0000-0000-0000-000000000001', public.tu(1), 'Alpha Mart', NULL),
  ('b0000000-0000-0000-0000-000000000002', public.tu(4), 'Bravo Shop', NULL);
INSERT INTO public.supermarkets (id, name, pichin_business_profile_id, price_currency) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'Alpha store', 'b0000000-0000-0000-0000-000000000001', 'UGX'),
  ('a0000000-0000-0000-0000-000000000002', 'Bravo store', 'b0000000-0000-0000-0000-000000000002', 'KES');
INSERT INTO public.products (id, supermarket_id, name, selling_price, images) VALUES
  ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Fresh Milk 1L', 4500, '["https://img.example/milk.jpg"]'),
  ('c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'Brown Bread', 3000, '[]'),
  ('c0000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000002', 'Bravo Rice 5kg', 900, '[]');
INSERT INTO public.inventory (product_id, supermarket_id, current_stock, reserved_stock) VALUES
  ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 10, 2),
  ('c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 5, 0),
  ('c0000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000002', 5, 0);

INSERT INTO public.pitches (id, business_profile_id, title, visibility, video_duration_seconds) VALUES
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'Alpha public pitch', 'public', 60),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'Alpha private pitch', 'private', 60),
  ('d0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000002', 'Bravo pitch', 'public', 60);

INSERT INTO public.cmms_company_profiles (id, business_profile_id) VALUES ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001');
INSERT INTO public.cmms_grants VALUES ('e0000000-0000-0000-0000-000000000001', public.tu(2), 'announcements', 'edit');

-- a third business, also owned by user 1, with its own store and product (to prove one status cannot mix businesses)
INSERT INTO public.business_profiles (id, user_id, business_name) VALUES ('b0000000-0000-0000-0000-000000000003', public.tu(1), 'Alpha Cafe');
INSERT INTO public.supermarkets (id, name, pichin_business_profile_id, price_currency) VALUES ('a0000000-0000-0000-0000-000000000003', 'Cafe store', 'b0000000-0000-0000-0000-000000000003', 'UGX');
INSERT INTO public.products (id, supermarket_id, name, selling_price, images) VALUES ('c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000003', 'Coffee', 2000, '[]');
INSERT INTO public.inventory (product_id, supermarket_id, current_stock) VALUES ('c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000003', 50);

-- status updates: 1 is user 1's video, 2 is user 1's photo, 3 is user 4's video, 4 is user 1's video that has ended, 5 is user 1's private video
INSERT INTO public.ican_statuses (id, user_id, media_type, visibility, expires_at) VALUES
  ('f0000000-0000-0000-0000-000000000001', public.tu(1), 'video', 'public',  now() + INTERVAL '20 hours'),
  ('f0000000-0000-0000-0000-000000000002', public.tu(1), 'image', 'public',  now() + INTERVAL '20 hours'),
  ('f0000000-0000-0000-0000-000000000003', public.tu(4), 'video', 'public',  now() + INTERVAL '20 hours'),
  ('f0000000-0000-0000-0000-000000000004', public.tu(1), 'video', 'public',  now() - INTERVAL '1 hour'),
  ('f0000000-0000-0000-0000-000000000005', public.tu(1), 'video', 'private', now() + INTERVAL '20 hours');

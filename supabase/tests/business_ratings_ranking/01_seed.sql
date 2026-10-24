\set ON_ERROR_STOP on
-- Users 1..40. User 1 owns business A, user 2 owns B, user 3 owns C, user 4 owns D.
INSERT INTO auth.users SELECT ('00000000-0000-0000-0000-' || lpad(n::TEXT, 12, '0'))::UUID FROM generate_series(1, 40) n;

-- Four businesses, each with one store (stores A/B/C are linked from the store side, D from the business side).
--   A "Alpha Mart"   many good ratings + many followers
--   B "Bravo Shop"   no ratings, no followers (neutral)
--   C "Charlie Co"   badly rated
--   D "Delta Stores" one single 5-star rating, nobody follows
INSERT INTO public.business_profiles (id, user_id, business_name) VALUES
  ('b0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001', 'Alpha Mart'),
  ('b0000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000002', 'Bravo Shop'),
  ('b0000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000003', 'Charlie Co'),
  ('b0000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-000000000004', 'Delta Stores');
INSERT INTO public.supermarkets (id, name, pichin_business_profile_id) VALUES
  ('a0000000-0000-0000-0000-00000000000a', 'Alpha store',   'b0000000-0000-0000-0000-00000000000a'),
  ('a0000000-0000-0000-0000-00000000000b', 'Bravo store',   'b0000000-0000-0000-0000-00000000000b'),
  ('a0000000-0000-0000-0000-00000000000c', 'Charlie store', 'b0000000-0000-0000-0000-00000000000c'),
  ('a0000000-0000-0000-0000-00000000000d', 'Delta store',   NULL);
UPDATE public.business_profiles SET supermarket_id = 'a0000000-0000-0000-0000-00000000000d' WHERE business_name = 'Delta Stores';
-- a closed store whose products must never be listed in the all-stores view
INSERT INTO public.supermarkets (id, name, is_active) VALUES ('a0000000-0000-0000-0000-0000000000ff', 'Closed store', FALSE);

INSERT INTO public.categories (id, name) VALUES ('c0000000-0000-0000-0000-000000000001', 'Drinks'), ('c0000000-0000-0000-0000-000000000002', 'Snacks');

-- 6 products per open store, p1 newest ... p6 oldest; the newest of Charlie is out of stock; Alpha p6 is out of stock.
DO $$
DECLARE s RECORD; i INT; pid UUID; stock NUMERIC;
BEGIN
  FOR s IN SELECT id, name FROM public.supermarkets WHERE is_active LOOP
    FOR i IN 1..6 LOOP
      INSERT INTO public.products (supermarket_id, category_id, name, description, created_at)
      VALUES (s.id, CASE WHEN i <= 2 THEN 'c0000000-0000-0000-0000-000000000001'::UUID WHEN i <= 4 THEN 'c0000000-0000-0000-0000-000000000002'::UUID END,
              s.name || ' item ' || i, CASE WHEN i = 3 THEN '100% pure_juice' END, now() - (i || ' hours')::INTERVAL)
      RETURNING id INTO pid;
      stock := CASE WHEN (s.name = 'Charlie store' AND i = 1) OR (s.name = 'Alpha store' AND i = 6) THEN 0 ELSE 10 END;
      INSERT INTO public.inventory (product_id, current_stock, reserved_stock) VALUES (pid, stock, 0);
    END LOOP;
  END LOOP;
  INSERT INTO public.products (supermarket_id, name) SELECT id, 'Closed item' FROM public.supermarkets WHERE NOT is_active;
END $$;

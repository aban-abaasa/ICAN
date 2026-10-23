-- The world the delivery tests run in. Users: 1 owns every business and has edit rights on the website tool; 2 has nothing;
-- 3 has edit rights but belongs to no business; 4 is a customer; 5 owns a different shop.
\set ON_ERROR_STOP on

INSERT INTO public.business_profiles (id, user_id, business_name, supermarket_id) VALUES
  (t.u(101), t.u(1), 'Kampala Mart',      t.u(201)),   -- ready: store, location, wallet, UGX
  (t.u(102), t.u(1), 'No Pin Store',      t.u(202)),   -- store without a location on the map
  (t.u(103), t.u(1), 'No Wallet Store',   t.u(203)),   -- store without a business wallet
  (t.u(104), t.u(1), 'Dollar Store',      t.u(204)),   -- store that sells in USD
  (t.u(105), t.u(1), 'Storeless Co',      NULL),       -- no store at all
  (t.u(109), t.u(5), 'Other Shop',        t.u(209));

INSERT INTO public.supermarkets (id, name, address, latitude, longitude, owner_user_id, pichin_business_profile_id, price_currency) VALUES
  (t.u(201), 'Kampala Mart Ntinda', 'Ntinda, Kampala', 0.3476, 32.6169, t.u(1), t.u(101), NULL),
  (t.u(202), 'No Pin Store',        'Somewhere',       NULL,   NULL,    t.u(1), t.u(102), 'UGX'),
  (t.u(203), 'No Wallet Store',     'Somewhere',       0.31,   32.58,   t.u(1), NULL,     'UGX'),
  (t.u(204), 'Dollar Store',        'Somewhere',       0.31,   32.58,   t.u(1), t.u(104), 'usd'),
  (t.u(209), 'Other Shop',          'Jinja',           0.44,   33.20,   t.u(5), t.u(109), 'UGX');

INSERT INTO public.cmms_company_profiles (id, company_name, business_profile_id) VALUES
  (t.u(301), 'Kampala Mart', t.u(101)), (t.u(302), 'No Pin Store', t.u(102)), (t.u(303), 'No Wallet Store', t.u(103)),
  (t.u(304), 'Dollar Store', t.u(104)), (t.u(305), 'Storeless Co', t.u(105)), (t.u(306), 'Unlinked', NULL);

INSERT INTO t.perm (company, uid)
SELECT c, u FROM unnest(ARRAY[t.u(301), t.u(302), t.u(303), t.u(304), t.u(305), t.u(306)]) c, unnest(ARRAY[t.u(1), t.u(3)]) u;

-- products of Kampala Mart Ntinda
INSERT INTO public.products (id, supermarket_id, name, selling_price, tax_rate, is_active, is_dropship_excluded, is_service, images) VALUES
  (t.u(401), t.u(201), 'Rice 5kg',         10000, 18,   TRUE,  FALSE, FALSE, '["https://img.test/rice.jpg"]'),
  (t.u(402), t.u(201), 'Sugar 1kg',         4000,  0,   TRUE,  FALSE, FALSE, NULL),
  (t.u(403), t.u(201), 'No tax rate set',   5000, NULL, TRUE,  FALSE, FALSE, NULL),
  (t.u(404), t.u(201), 'Excluded',          5000, 18,   TRUE,  TRUE,  FALSE, NULL),
  (t.u(405), t.u(201), 'Haircut',           8000, 18,   TRUE,  FALSE, TRUE,  NULL),
  (t.u(406), t.u(201), 'No price',             0, 18,   TRUE,  FALSE, FALSE, NULL),
  (t.u(407), t.u(201), 'Inactive',          3000, 18,   FALSE, FALSE, FALSE, NULL),
  (t.u(408), t.u(201), 'Flour 2kg',         6000, 18,   TRUE,  FALSE, FALSE, NULL),
  (t.u(409), t.u(209), 'Other shop item',   2000, 18,   TRUE,  FALSE, FALSE, NULL);
INSERT INTO public.inventory (product_id, supermarket_id, current_stock, reserved_stock) VALUES
  (t.u(401), t.u(201), 25, 5), (t.u(402), t.u(201), 0, 0), (t.u(408), t.u(201), 10, 0), (t.u(409), t.u(209), 9, 0);

-- Flour was listed BY HAND in the Dropship dashboard, with a markup: delivery must leave it exactly as it is
INSERT INTO public.dropship_listings (reseller_business_profile_id, product_id, supermarket_id, listed_price, free_delivery)
VALUES (t.u(101), t.u(408), t.u(201), 6500, TRUE);

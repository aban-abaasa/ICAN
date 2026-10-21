\set ON_ERROR_STOP on
-- Businesses that exist BEFORE the migration runs (so the backfill has real work: duplicates, accents, symbols, reserved words).
-- The impostor with GODMINDERA's name is older than the real one; the platform business must still get the plain address.
INSERT INTO public.cmms_company_profiles (id, company_name, email, created_at, business_profile_id) VALUES
  ('00000000-0000-0000-0000-00000000a001', 'Easy Laundry Shop',                     'a1@t.dev', '2026-01-01', NULL),
  ('00000000-0000-0000-0000-00000000a002', 'easy laundry shop',                     'a2@t.dev', '2026-02-01', NULL),
  ('00000000-0000-0000-0000-00000000a003', 'Café Déjà Vu & Sons',                   'a3@t.dev', '2026-03-01', NULL),
  ('00000000-0000-0000-0000-00000000a004', 'B$A',                                   'a4@t.dev', '2026-03-02', NULL),
  ('00000000-0000-0000-0000-00000000a005', 'Shop',                                  'a5@t.dev', '2026-03-03', NULL),
  ('00000000-0000-0000-0000-00000000a006', 'IcanEra',                               'a6@t.dev', '2026-03-04', NULL),
  ('00000000-0000-0000-0000-00000000a007', '!!!',                                   'a7@t.dev', '2026-03-05', NULL),
  ('00000000-0000-0000-0000-00000000a008', 'X',                                     'a8@t.dev', '2026-03-06', NULL),
  ('00000000-0000-0000-0000-00000000a009', 'Godmindera Organisation (U) Ltd',       'a9@t.dev', '2026-01-01', NULL),
  ('00000000-0000-0000-0000-00000000a00a', 'GODMINDERA ORGANISATION (U) LTD',       'aa@t.dev', '2026-09-01', 'e9dd3c93-65b0-469e-91e9-3aa10ca7a03c'),
  ('00000000-0000-0000-0000-00000000a00b', repeat('Very Long Business Name ', 6),   'ab@t.dev', '2026-03-07', NULL);

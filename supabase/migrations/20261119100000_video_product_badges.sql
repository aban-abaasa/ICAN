-- ============================================================
-- Product badges on PitchIn videos and on status updates (a paid service that starts free)
-- ============================================================
-- A business can advertise its products inside a PitchIn video or a status update: at the seconds it chooses, a small badge slides in
-- over the video with the product's name, photo and price, and tapping it opens the business's Market. The same tool is in PitchIn (for
-- the pitch's owner), in CMMS > Announcements > Video badges (for staff who may edit the business's public board), and on the owner's own
-- status updates. A status that is a photo or plain text shows its badge for as long as the status lasts instead of at a moment in a video.
--
-- SMART
--   * A badge linked to one of the business's STORE products reads its name, photo, price and stock LIVE: change the price in the
--     store and every video shows the new price; when the product sells out or is switched off its badge quietly disappears.
--     Only products of the business's own stores can be linked (checked here, not in the app). A badge can also be typed by hand
--     (name + price) for something not in a store.
--   * The app can place the badges for you (spread evenly across the video's length); the times stay editable.
--
-- CHARGED, STARTING FREE
--   A badge on a PitchIn video runs for 30 days once it is published, then stops showing. Publishing (and renewing, in the last 7 days)
--   costs the current price of the service 'pitch_product_badge'. A badge on a STATUS lasts as long as the status does (24 hours) and costs
--   the current price of its own service, 'status_product_badge' (up to 3 per status, all from the same business). Both are in IcanEra
--   coin (IC), taken from the BUSINESS wallet and credited to the
--   platform-fee business, the same way corporate subscriptions are billed. The price starts at FREE. A developer changes it from
--   the developer panel (Sale fees tab > Services), with a Free / Charged switch that remembers the price, so the service can be
--   alternated between free and charged at any time. Changes apply to the next publish or renewal; badges already running keep
--   running. Only the business OWNER can pay for a badge; staff can prepare drafts and publish while it is free.
--
--   ican_service_prices            the prices and the Free / Charged switches (no direct access)
--   ican_service_price_changes     who changed what, when (nobody can edit it)
--   video_product_badges           the badges (each on one pitch OR one status)
--   video_badge_charges            what each publish / renewal cost (including free ones)
--
-- Nothing here changes pitches, wallets or stores. Charging needs fn_credit_platform_fee_to_business
-- (ROUTE_PLATFORM_FEES_TO_IWOS_BUSINESS.sql); while a service is free it is never called. Run after
-- 20261009100000_secure_dev_access.sql (the developer allowlist). Safe to run more than once; it never overwrites a price a developer
-- has set. Roll back with supabase/rollback/20261119_rollback_video_product_badges.sql.
-- ============================================================

DO $guard$
BEGIN
  IF to_regclass('public.pitches') IS NULL OR to_regclass('public.business_profiles') IS NULL THEN
    RAISE EXCEPTION 'PitchIn tables (pitches, business_profiles) are not installed.';
  END IF;
  IF to_regclass('public.ican_statuses') IS NULL THEN
    RAISE EXCEPTION 'Run backend/CREATE_STATUS_FEATURES.sql first - it creates the status updates (ican_statuses) that badges can sit on.';
  END IF;
  IF to_regprocedure('public.ican_dev_secret()') IS NULL OR to_regprocedure('public.ican_is_dev_operator()') IS NULL THEN
    RAISE EXCEPTION 'Run supabase/migrations/20261009100000_secure_dev_access.sql first - it sets up the developer allowlist.';
  END IF;
END $guard$;

-- ------------------------------------------------------------
-- 1. The price of the service, and the Free / Charged switch
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ican_service_prices (
  key        TEXT PRIMARY KEY,
  price_ic   NUMERIC(18, 8) NOT NULL DEFAULT 0 CHECK (price_ic >= 0 AND price_ic <= 1000000),
  charged    BOOLEAN NOT NULL DEFAULT FALSE,
  label      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- ON CONFLICT DO NOTHING: running this again never undoes a price a developer has set.
INSERT INTO public.ican_service_prices (key, price_ic, charged, label) VALUES
  ('pitch_product_badge',  0, FALSE, 'PitchIn product badge: one badge on a pitch video for 30 days'),
  ('status_product_badge', 0, FALSE, 'Status product badge: one badge on a status update, for as long as the status lasts (24 hours)')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.ican_service_price_changes (
  id          BIGSERIAL PRIMARY KEY,
  key         TEXT NOT NULL,
  old_price   NUMERIC NOT NULL,
  new_price   NUMERIC NOT NULL,
  old_charged BOOLEAN NOT NULL,
  new_charged BOOLEAN NOT NULL,
  changed_by  TEXT,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.ican_service_prices        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ican_service_price_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ican_service_prices        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ican_service_price_changes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.ican_service_price_changes_id_seq FROM PUBLIC, anon, authenticated;

-- What a business pays RIGHT NOW: the price when the switch is on, otherwise nothing. A deleted row means free, never a surprise charge.
CREATE OR REPLACE FUNCTION public.ican_service_price(p_key TEXT) RETURNS NUMERIC
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT CASE WHEN charged THEN price_ic ELSE 0 END FROM public.ican_service_prices WHERE key = p_key), 0)
$$;
REVOKE ALL ON FUNCTION public.ican_service_price(TEXT) FROM PUBLIC, anon, authenticated;

-- What the apps show next to the "Publish" button.
CREATE OR REPLACE FUNCTION public.fn_pitch_badge_price() RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'price_ic', public.ican_service_price('pitch_product_badge'),
    'charged',  public.ican_service_price('pitch_product_badge') > 0,
    'days',     30
  )
$$;
CREATE OR REPLACE FUNCTION public.fn_status_badge_price() RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'price_ic', public.ican_service_price('status_product_badge'),
    'charged',  public.ican_service_price('status_product_badge') > 0,
    'days',     1
  )
$$;
REVOKE ALL ON FUNCTION public.fn_pitch_badge_price()  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_status_badge_price() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_pitch_badge_price()  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_status_badge_price() TO anon, authenticated;

-- ------------------------------------------------------------
-- 2. Developer panel: read and change the price (token + signed-in operator, like every other money setting)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ican_dev_get_service_prices(dev_token TEXT) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF dev_token IS DISTINCT FROM public.ican_dev_secret() OR NOT public.ican_is_dev_operator() THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  RETURN jsonb_build_object(
    'services', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('key', s.key, 'label', s.label, 'price_ic', s.price_ic, 'charged', s.charged,
                                          'effective_ic', CASE WHEN s.charged THEN s.price_ic ELSE 0 END, 'updated_at', s.updated_at)
                       ORDER BY s.key)
        FROM public.ican_service_prices s), '[]'::JSONB),
    'changes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('key', c.key, 'old_price', c.old_price, 'new_price', c.new_price,
                                          'old_charged', c.old_charged, 'new_charged', c.new_charged,
                                          'changed_by', c.changed_by, 'changed_at', c.changed_at) ORDER BY c.id DESC)
        FROM (SELECT * FROM public.ican_service_price_changes ORDER BY id DESC LIMIT 10) c), '[]'::JSONB),
    'badges_live', (SELECT count(*) FROM public.video_product_badges WHERE status = 'live' AND live_until > now())
  );
END $$;

CREATE OR REPLACE FUNCTION public.ican_dev_set_service_price(dev_token TEXT, p_key TEXT, p_price_ic NUMERIC, p_charged BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old public.ican_service_prices;
  v_price NUMERIC;
BEGIN
  IF dev_token IS DISTINCT FROM public.ican_dev_secret() OR NOT public.ican_is_dev_operator() THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  IF p_key IS NULL OR p_key NOT IN ('pitch_product_badge', 'status_product_badge') THEN
    RETURN jsonb_build_object('success', false, 'error', 'That service cannot be priced here');
  END IF;
  IF p_price_ic IS NULL OR p_price_ic < 0 OR p_price_ic > 1000000 THEN
    RETURN jsonb_build_object('success', false, 'error', 'The price is an amount of IC from 0 to 1,000,000');
  END IF;
  v_price := ROUND(p_price_ic, 8);
  IF COALESCE(p_charged, FALSE) AND v_price = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Set a price above 0 to charge for this service, or leave it free');
  END IF;

  SELECT * INTO v_old FROM public.ican_service_prices WHERE key = p_key FOR UPDATE;
  IF FOUND AND v_old.price_ic = v_price AND v_old.charged = COALESCE(p_charged, FALSE) THEN
    RETURN jsonb_build_object('success', true, 'changed', false, 'key', p_key, 'price_ic', v_price, 'charged', v_old.charged);
  END IF;

  INSERT INTO public.ican_service_prices (key, price_ic, charged, label)
  VALUES (p_key, v_price, COALESCE(p_charged, FALSE),
          CASE p_key WHEN 'pitch_product_badge' THEN 'PitchIn product badge: one badge on a pitch video for 30 days'
                     ELSE 'Status product badge: one badge on a status update, for as long as the status lasts (24 hours)' END)
  ON CONFLICT (key) DO UPDATE SET price_ic = EXCLUDED.price_ic, charged = EXCLUDED.charged, updated_at = now();
  INSERT INTO public.ican_service_price_changes (key, old_price, new_price, old_charged, new_charged, changed_by)
  VALUES (p_key, COALESCE(v_old.price_ic, 0), v_price, COALESCE(v_old.charged, FALSE), COALESCE(p_charged, FALSE),
          COALESCE(auth.jwt() ->> 'email', 'unknown'));

  RETURN jsonb_build_object('success', true, 'changed', true, 'key', p_key, 'price_ic', v_price, 'charged', COALESCE(p_charged, FALSE));
END $$;

REVOKE ALL ON FUNCTION public.ican_dev_get_service_prices(TEXT)                      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ican_dev_set_service_price(TEXT, TEXT, NUMERIC, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ican_dev_get_service_prices(TEXT)                      TO authenticated;
GRANT EXECUTE ON FUNCTION public.ican_dev_set_service_price(TEXT, TEXT, NUMERIC, BOOLEAN) TO authenticated;

-- ------------------------------------------------------------
-- 3. The badges
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.video_product_badges (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- a badge sits on exactly one pitch video OR one status update
  pitch_id            UUID REFERENCES public.pitches(id) ON DELETE CASCADE,
  status_id           UUID REFERENCES public.ican_statuses(id) ON DELETE CASCADE,
  business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  -- a product of the business's own store (its name, photo, price and stock are read live), or NULL for a hand-typed badge
  product_id          UUID,
  label               TEXT CHECK (label IS NULL OR char_length(btrim(label)) BETWEEN 1 AND 80),
  price               NUMERIC(14, 2) CHECK (price IS NULL OR price >= 0),
  currency            TEXT NOT NULL DEFAULT 'UGX' CHECK (currency ~ '^[A-Z]{3}$'),
  image_url           TEXT CHECK (image_url IS NULL OR (char_length(image_url) <= 1000 AND image_url ~* '^https?://[^\s]+$')),
  starts_at_sec       INTEGER NOT NULL DEFAULT 0 CHECK (starts_at_sec BETWEEN 0 AND 86400),
  duration_sec        INTEGER NOT NULL DEFAULT 6 CHECK (duration_sec BETWEEN 2 AND 60),
  position            TEXT NOT NULL DEFAULT 'bottom-left' CHECK (position IN ('bottom-left', 'bottom-right', 'top-left', 'top-right')),
  status              TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'live')),
  live_until          TIMESTAMPTZ,
  created_by          UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT video_product_badges_shape_chk CHECK (product_id IS NOT NULL OR (label IS NOT NULL AND price IS NOT NULL)),
  CONSTRAINT video_product_badges_target_chk CHECK (num_nonnulls(pitch_id, status_id) = 1)
);
CREATE INDEX IF NOT EXISTS video_product_badges_status_idx ON public.video_product_badges (status_id, starts_at_sec) WHERE status_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS video_product_badges_pitch_idx ON public.video_product_badges (pitch_id, starts_at_sec);
CREATE INDEX IF NOT EXISTS video_product_badges_business_idx ON public.video_product_badges (business_profile_id);

CREATE TABLE IF NOT EXISTS public.video_badge_charges (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  badge_id            UUID REFERENCES public.video_product_badges(id) ON DELETE SET NULL,
  business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  amount_ic           NUMERIC(18, 8) NOT NULL CHECK (amount_ic >= 0),
  kind                TEXT NOT NULL CHECK (kind IN ('publish', 'renew')),
  days                INTEGER NOT NULL,
  paid_by             UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS video_badge_charges_business_idx ON public.video_badge_charges (business_profile_id, created_at DESC);

-- Everything goes through the functions below.
ALTER TABLE public.video_product_badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_badge_charges  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.video_product_badges FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.video_badge_charges  FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 4. Who may manage a business's badges
-- ------------------------------------------------------------
-- The business owner, or CMMS staff who may edit the announcements (public board) of a company linked to that business.
CREATE OR REPLACE FUNCTION public._pitch_badge_can_manage(p_business_profile_id UUID) RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR p_business_profile_id IS NULL THEN RETURN FALSE; END IF;
  IF EXISTS (SELECT 1 FROM public.business_profiles bp WHERE bp.id = p_business_profile_id AND bp.user_id = auth.uid()) THEN
    RETURN TRUE;
  END IF;
  IF to_regclass('public.cmms_company_profiles') IS NOT NULL
     AND to_regprocedure('public.cmms_has_tool_action(uuid,text,text)') IS NOT NULL THEN
    RETURN EXISTS (
      SELECT 1 FROM public.cmms_company_profiles cp
      WHERE (cp.business_profile_id = p_business_profile_id OR cp.pichin_business_profile_id = p_business_profile_id)
        AND public.cmms_has_tool_action(cp.id, 'announcements', 'edit'));
  END IF;
  RETURN FALSE;
END $$;
REVOKE ALL ON FUNCTION public._pitch_badge_can_manage(UUID) FROM PUBLIC, anon, authenticated;

-- Is this product sold by one of the business's own stores? (the same rule the business website uses)
CREATE OR REPLACE FUNCTION public._pitch_badge_owns_product(p_business_profile_id UUID, p_product_id UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.business_profiles bp
    JOIN public.supermarkets s ON s.id = bp.supermarket_id OR s.pichin_business_profile_id = bp.id
    JOIN public.products p ON p.supermarket_id = s.id
    WHERE bp.id = p_business_profile_id AND p.id = p_product_id);
$$;
REVOKE ALL ON FUNCTION public._pitch_badge_owns_product(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- One badge as the apps see it. Linked products are read live: NULL when the product is gone, switched off, its store closed, or sold out
-- (a service is never "sold out"). p_for_manager keeps hidden badges so the owner can see why one is not showing.
CREATE OR REPLACE FUNCTION public._pitch_badge_json(b public.video_product_badges, p_for_manager BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_name     TEXT := b.label;
  v_price    NUMERIC := b.price;
  v_currency TEXT := b.currency;
  v_image    TEXT := b.image_url;
  v_in_stock BOOLEAN := TRUE;
  v_found    BOOLEAN := TRUE;
  v_linked   BOOLEAN := b.product_id IS NOT NULL;
  r          RECORD;
BEGIN
  IF v_linked THEN
    SELECT p.name AS name,
           COALESCE(NULLIF(p.selling_price, 0), NULLIF(p.price, 0)) AS price,
           upper(COALESCE(NULLIF(btrim(s.price_currency), ''), 'UGX')) AS currency,
           CASE WHEN jsonb_typeof(p.images) = 'array' AND jsonb_array_length(p.images) > 0 THEN p.images ->> 0
                ELSE NULLIF(btrim(p.image_url), '') END AS image,
           (COALESCE(p.is_service, FALSE) OR stock.qty > 0) AS in_stock,
           (COALESCE(p.is_active, TRUE) AND COALESCE(s.is_active, TRUE)) AS active
      INTO r
      FROM public.products p
      JOIN public.supermarkets s ON s.id = p.supermarket_id
      LEFT JOIN LATERAL (
        SELECT GREATEST(COALESCE(SUM(i.current_stock - COALESCE(i.reserved_stock, 0)), 0), 0) AS qty
        FROM public.inventory i WHERE i.product_id = p.id) stock ON TRUE
     WHERE p.id = b.product_id;
    IF NOT FOUND OR NOT r.active OR r.price IS NULL THEN
      v_found := FALSE;
    ELSE
      v_name     := COALESCE(NULLIF(btrim(b.label), ''), r.name);
      v_price    := r.price;
      v_currency := r.currency;
      v_image    := COALESCE(b.image_url, r.image);
      v_in_stock := r.in_stock;
    END IF;
  END IF;

  IF NOT p_for_manager AND (NOT v_found OR NOT v_in_stock) THEN RETURN NULL; END IF;

  RETURN jsonb_build_object(
    'id', b.id, 'pitch_id', b.pitch_id, 'status_id', b.status_id, 'product_id', b.product_id, 'linked', v_linked,
    'name', v_name, 'price', v_price, 'currency', v_currency, 'image_url', v_image,
    'starts_at_sec', b.starts_at_sec, 'duration_sec', b.duration_sec, 'position', b.position,
    'status', b.status, 'live_until', b.live_until,
    'is_live', (b.status = 'live' AND b.live_until > now()),
    'shows', (b.status = 'live' AND b.live_until > now() AND v_found AND v_in_stock),
    'problem', CASE WHEN NOT v_found THEN 'product_unavailable' WHEN NOT v_in_stock THEN 'sold_out' END
  );
END $$;
REVOKE ALL ON FUNCTION public._pitch_badge_json(public.video_product_badges, BOOLEAN) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 5. What viewers see (anyone): the live badges of a public pitch
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_get_pitch_badges(p_pitch_id UUID) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pitch  public.pitches;
  v_site   UUID;
  v_items  JSONB;
BEGIN
  SELECT * INTO v_pitch FROM public.pitches WHERE id = p_pitch_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('badges', '[]'::JSONB, 'site_company_id', NULL); END IF;
  -- a private pitch's badges are for the people who manage it
  IF COALESCE(v_pitch.visibility, 'public') <> 'public' AND NOT public._pitch_badge_can_manage(v_pitch.business_profile_id) THEN
    RETURN jsonb_build_object('badges', '[]'::JSONB, 'site_company_id', NULL);
  END IF;

  SELECT COALESCE(jsonb_agg(j ORDER BY (j ->> 'starts_at_sec')::INT, j ->> 'id'), '[]'::JSONB) INTO v_items
    FROM (SELECT public._pitch_badge_json(b, FALSE) AS j
            FROM public.video_product_badges b
           WHERE b.pitch_id = p_pitch_id AND b.status = 'live' AND b.live_until > now()) x
   WHERE j IS NOT NULL;

  IF jsonb_array_length(v_items) > 0 AND to_regprocedure('public.get_store_public_website(uuid,uuid)') IS NOT NULL THEN
    EXECUTE 'SELECT public.get_store_public_website(NULL, $1)' INTO v_site USING v_pitch.business_profile_id;
  END IF;
  RETURN jsonb_build_object('badges', v_items, 'site_company_id', v_site);
END $$;
REVOKE ALL ON FUNCTION public.fn_get_pitch_badges(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_get_pitch_badges(UUID) TO anon, authenticated;

-- The live badges of a status update. A status that is a photo or plain text has no timeline, so its badges are on screen the whole time
-- (always_on); a video status follows its badges' seconds like a pitch. Gone with the status after 24 hours; a private status shows only to its owner.
CREATE OR REPLACE FUNCTION public.fn_get_status_badges(p_status_id UUID) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_st     public.ican_statuses;
  v_site   UUID;
  v_items  JSONB;
  v_biz    UUID;
BEGIN
  SELECT * INTO v_st FROM public.ican_statuses WHERE id = p_status_id;
  IF NOT FOUND OR v_st.expires_at <= now() OR (v_st.visibility = 'private' AND v_st.user_id IS DISTINCT FROM auth.uid()) THEN
    RETURN jsonb_build_object('badges', '[]'::JSONB, 'site_company_id', NULL, 'always_on', FALSE);
  END IF;

  SELECT COALESCE(jsonb_agg(j ORDER BY (j ->> 'starts_at_sec')::INT, j ->> 'id'), '[]'::JSONB) INTO v_items
    FROM (SELECT public._pitch_badge_json(b, FALSE) AS j
            FROM public.video_product_badges b
           WHERE b.status_id = p_status_id AND b.status = 'live' AND b.live_until > now()) x
   WHERE j IS NOT NULL;

  IF jsonb_array_length(v_items) > 0 AND to_regprocedure('public.get_store_public_website(uuid,uuid)') IS NOT NULL THEN
    SELECT b.business_profile_id INTO v_biz FROM public.video_product_badges b WHERE b.status_id = p_status_id LIMIT 1;
    EXECUTE 'SELECT public.get_store_public_website(NULL, $1)' INTO v_site USING v_biz;
  END IF;
  RETURN jsonb_build_object('badges', v_items, 'site_company_id', v_site, 'always_on', v_st.media_type <> 'video');
END $$;
REVOKE ALL ON FUNCTION public.fn_get_status_badges(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_get_status_badges(UUID) TO anon, authenticated;

-- ------------------------------------------------------------
-- 6. What the business manages
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_list_pitch_badges_manage(p_pitch_id UUID) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pitch public.pitches;
BEGIN
  SELECT * INTO v_pitch FROM public.pitches WHERE id = p_pitch_id;
  IF NOT FOUND OR NOT public._pitch_badge_can_manage(v_pitch.business_profile_id) THEN
    RAISE EXCEPTION 'You cannot manage badges for this pitch';
  END IF;
  RETURN jsonb_build_object(
    'video_duration_seconds', v_pitch.video_duration_seconds,
    'can_pay', EXISTS (SELECT 1 FROM public.business_profiles bp WHERE bp.id = v_pitch.business_profile_id AND bp.user_id = auth.uid()),
    'price', public.fn_pitch_badge_price(),
    'badges', COALESCE((SELECT jsonb_agg(public._pitch_badge_json(b, TRUE) ORDER BY b.starts_at_sec, b.created_at)
                          FROM public.video_product_badges b WHERE b.pitch_id = p_pitch_id), '[]'::JSONB));
END $$;
REVOKE ALL ON FUNCTION public.fn_list_pitch_badges_manage(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_list_pitch_badges_manage(UUID) TO authenticated;

-- The business's store products, to pick from.
CREATE OR REPLACE FUNCTION public.fn_pitch_badge_products(p_business_profile_id UUID) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._pitch_badge_can_manage(p_business_profile_id) THEN
    RAISE EXCEPTION 'You cannot manage badges for this business';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(item ORDER BY item ->> 'name') FROM (
      SELECT jsonb_build_object(
        'product_id', p.id, 'name', p.name,
        'price', COALESCE(NULLIF(p.selling_price, 0), NULLIF(p.price, 0)),
        'currency', upper(COALESCE(NULLIF(btrim(s.price_currency), ''), 'UGX')),
        'image_url', CASE WHEN jsonb_typeof(p.images) = 'array' AND jsonb_array_length(p.images) > 0 THEN p.images ->> 0
                          ELSE NULLIF(btrim(p.image_url), '') END) AS item
      FROM public.business_profiles bp
      JOIN public.supermarkets s ON s.id = bp.supermarket_id OR s.pichin_business_profile_id = bp.id
      JOIN public.products p ON p.supermarket_id = s.id
      WHERE bp.id = p_business_profile_id AND COALESCE(s.is_active, TRUE) AND COALESCE(p.is_active, TRUE)
        AND COALESCE(NULLIF(p.selling_price, 0), NULLIF(p.price, 0)) IS NOT NULL
      ORDER BY p.name LIMIT 300) q), '[]'::JSONB);
END $$;
REVOKE ALL ON FUNCTION public.fn_pitch_badge_products(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pitch_badge_products(UUID) TO authenticated;

-- The status owner's view: which of their businesses can be advertised, and the badges so far.
CREATE OR REPLACE FUNCTION public.fn_list_status_badges_manage(p_status_id UUID) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_st public.ican_statuses;
BEGIN
  SELECT * INTO v_st FROM public.ican_statuses WHERE id = p_status_id;
  IF NOT FOUND OR v_st.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'You can only add badges to your own status';
  END IF;
  RETURN jsonb_build_object(
    'media_type', v_st.media_type,
    'always_on', v_st.media_type <> 'video',
    'expires_at', v_st.expires_at,
    'ended', v_st.expires_at <= now(),
    'price', public.fn_status_badge_price(),
    'can_pay', EXISTS (SELECT 1 FROM public.business_profiles bp WHERE bp.user_id = auth.uid()),
    'businesses', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', bp.id, 'name', bp.business_name) ORDER BY bp.business_name)
                              FROM public.business_profiles bp WHERE bp.user_id = auth.uid()), '[]'::JSONB),
    'business_profile_id', (SELECT b.business_profile_id FROM public.video_product_badges b WHERE b.status_id = p_status_id LIMIT 1),
    'badges', COALESCE((SELECT jsonb_agg(public._pitch_badge_json(b, TRUE) ORDER BY b.starts_at_sec, b.created_at)
                          FROM public.video_product_badges b WHERE b.status_id = p_status_id), '[]'::JSONB));
END $$;
REVOKE ALL ON FUNCTION public.fn_list_status_badges_manage(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_list_status_badges_manage(UUID) TO authenticated;

-- ------------------------------------------------------------
-- Creating and editing: one validator for both kinds of video
-- ------------------------------------------------------------
-- Everything about a badge that does not depend on where it sits. The two public functions below find the pitch or status, decide who may
-- touch it, and call this. Editing a running badge keeps it running; only publishing / renewing costs anything.
CREATE OR REPLACE FUNCTION public._video_badge_upsert(
  p_pitch_id UUID, p_status_id UUID, p_business_profile_id UUID, p_badge_id UUID,
  p_product_id UUID, p_label TEXT, p_price NUMERIC, p_currency TEXT, p_image_url TEXT,
  p_starts_at_sec INTEGER, p_duration_sec INTEGER, p_position TEXT, p_max INTEGER
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_label TEXT := NULLIF(btrim(COALESCE(p_label, '')), '');
  v_cur   TEXT := upper(COALESCE(NULLIF(btrim(p_currency), ''), 'UGX'));
  v_img   TEXT := NULLIF(btrim(COALESCE(p_image_url, '')), '');
  v_start INTEGER := COALESCE(p_starts_at_sec, 0);
  v_dur   INTEGER := COALESCE(p_duration_sec, 6);
  v_id    UUID;
BEGIN
  IF p_product_id IS NOT NULL AND NOT public._pitch_badge_owns_product(p_business_profile_id, p_product_id) THEN
    RAISE EXCEPTION 'That product is not sold by this business';
  END IF;
  IF p_product_id IS NULL AND (v_label IS NULL OR p_price IS NULL OR p_price < 0) THEN
    RAISE EXCEPTION 'Choose a product, or type a name and a price';
  END IF;
  IF v_start < 0 OR v_dur < 2 OR v_dur > 60 THEN
    RAISE EXCEPTION 'A badge shows for 2 to 60 seconds, starting at 0 seconds or later';
  END IF;
  IF p_position NOT IN ('bottom-left', 'bottom-right', 'top-left', 'top-right') THEN
    RAISE EXCEPTION 'Choose where the badge sits';
  END IF;

  IF p_badge_id IS NULL THEN
    IF (SELECT count(*) FROM public.video_product_badges
         WHERE pitch_id IS NOT DISTINCT FROM p_pitch_id AND status_id IS NOT DISTINCT FROM p_status_id) >= p_max THEN
      RAISE EXCEPTION 'This % can carry up to % badges', CASE WHEN p_status_id IS NULL THEN 'video' ELSE 'status' END, p_max;
    END IF;
    INSERT INTO public.video_product_badges
      (pitch_id, status_id, business_profile_id, product_id, label, price, currency, image_url, starts_at_sec, duration_sec, position, created_by)
    VALUES
      (p_pitch_id, p_status_id, p_business_profile_id, p_product_id, v_label,
       CASE WHEN p_product_id IS NULL THEN ROUND(p_price, 2) END, v_cur, v_img, v_start, v_dur, p_position, auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.video_product_badges SET
      product_id = p_product_id, label = v_label, price = CASE WHEN p_product_id IS NULL THEN ROUND(p_price, 2) END,
      currency = v_cur, image_url = v_img, starts_at_sec = v_start, duration_sec = v_dur, position = p_position, updated_at = now()
    WHERE id = p_badge_id AND pitch_id IS NOT DISTINCT FROM p_pitch_id AND status_id IS NOT DISTINCT FROM p_status_id
      AND business_profile_id = p_business_profile_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Badge not found'; END IF;
  END IF;

  RETURN (SELECT public._pitch_badge_json(b, TRUE) FROM public.video_product_badges b WHERE b.id = v_id);
END $$;
REVOKE ALL ON FUNCTION public._video_badge_upsert(UUID, UUID, UUID, UUID, UUID, TEXT, NUMERIC, TEXT, TEXT, INTEGER, INTEGER, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;

-- A badge on a PitchIn video (up to 12). p_badge_id NULL creates one.
CREATE OR REPLACE FUNCTION public.fn_save_pitch_badge(
  p_pitch_id      UUID,
  p_badge_id      UUID    DEFAULT NULL,
  p_product_id    UUID    DEFAULT NULL,
  p_label         TEXT    DEFAULT NULL,
  p_price         NUMERIC DEFAULT NULL,
  p_currency      TEXT    DEFAULT NULL,
  p_image_url     TEXT    DEFAULT NULL,
  p_starts_at_sec INTEGER DEFAULT 0,
  p_duration_sec  INTEGER DEFAULT 6,
  p_position      TEXT    DEFAULT 'bottom-left'
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pitch public.pitches;
BEGIN
  SELECT * INTO v_pitch FROM public.pitches WHERE id = p_pitch_id;
  IF NOT FOUND OR NOT public._pitch_badge_can_manage(v_pitch.business_profile_id) THEN
    RAISE EXCEPTION 'You cannot manage badges for this pitch';
  END IF;
  IF COALESCE(v_pitch.video_duration_seconds, 0) > 0 AND COALESCE(p_starts_at_sec, 0) >= v_pitch.video_duration_seconds THEN
    RAISE EXCEPTION 'That is after the end of the video (% seconds long)', v_pitch.video_duration_seconds;
  END IF;
  RETURN public._video_badge_upsert(p_pitch_id, NULL, v_pitch.business_profile_id, p_badge_id, p_product_id, p_label, p_price,
                                    p_currency, p_image_url, p_starts_at_sec, p_duration_sec, p_position, 12);
END $$;
REVOKE ALL ON FUNCTION public.fn_save_pitch_badge(UUID, UUID, UUID, TEXT, NUMERIC, TEXT, TEXT, INTEGER, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_save_pitch_badge(UUID, UUID, UUID, TEXT, NUMERIC, TEXT, TEXT, INTEGER, INTEGER, TEXT) TO authenticated;

-- A badge on the signed-in user's OWN status (up to 3, all from one business that they own). A photo or text status has no timeline, so its
-- badges always sit at second 0 and stay on screen the whole time.
CREATE OR REPLACE FUNCTION public.fn_save_status_badge(
  p_status_id           UUID,
  p_business_profile_id UUID,
  p_badge_id            UUID    DEFAULT NULL,
  p_product_id          UUID    DEFAULT NULL,
  p_label               TEXT    DEFAULT NULL,
  p_price               NUMERIC DEFAULT NULL,
  p_currency            TEXT    DEFAULT NULL,
  p_image_url           TEXT    DEFAULT NULL,
  p_starts_at_sec       INTEGER DEFAULT 0,
  p_duration_sec        INTEGER DEFAULT 6,
  p_position            TEXT    DEFAULT 'bottom-left'
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_st    public.ican_statuses;
  v_start INTEGER := p_starts_at_sec;
  v_dur   INTEGER := p_duration_sec;
BEGIN
  SELECT * INTO v_st FROM public.ican_statuses WHERE id = p_status_id;
  IF NOT FOUND OR v_st.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'You can only add badges to your own status';
  END IF;
  IF v_st.expires_at <= now() THEN RAISE EXCEPTION 'This status has ended'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.business_profiles bp WHERE bp.id = p_business_profile_id AND bp.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Choose one of your own businesses to advertise';
  END IF;
  IF EXISTS (SELECT 1 FROM public.video_product_badges WHERE status_id = p_status_id AND business_profile_id <> p_business_profile_id) THEN
    RAISE EXCEPTION 'All the badges on one status must be from the same business';
  END IF;
  IF v_st.media_type <> 'video' THEN v_start := 0; v_dur := 60; END IF;
  RETURN public._video_badge_upsert(NULL, p_status_id, p_business_profile_id, p_badge_id, p_product_id, p_label, p_price,
                                    p_currency, p_image_url, v_start, v_dur, p_position, 3);
END $$;
REVOKE ALL ON FUNCTION public.fn_save_status_badge(UUID, UUID, UUID, UUID, TEXT, NUMERIC, TEXT, TEXT, INTEGER, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_save_status_badge(UUID, UUID, UUID, UUID, TEXT, NUMERIC, TEXT, TEXT, INTEGER, INTEGER, TEXT) TO authenticated;

-- May the signed-in user change or pay for THIS badge? A pitch badge: whoever manages the business. A status badge: the status owner, who
-- must also own the business.
CREATE OR REPLACE FUNCTION public._video_badge_can_manage(b public.video_product_badges) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN b.status_id IS NOT NULL
    THEN auth.uid() IS NOT NULL
         AND EXISTS (SELECT 1 FROM public.ican_statuses s WHERE s.id = b.status_id AND s.user_id = auth.uid())
         AND EXISTS (SELECT 1 FROM public.business_profiles bp WHERE bp.id = b.business_profile_id AND bp.user_id = auth.uid())
    ELSE public._pitch_badge_can_manage(b.business_profile_id)
  END
$$;
REVOKE ALL ON FUNCTION public._video_badge_can_manage(public.video_product_badges) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_delete_video_badge(p_badge_id UUID) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b public.video_product_badges;
BEGIN
  SELECT * INTO b FROM public.video_product_badges WHERE id = p_badge_id;
  IF NOT FOUND OR NOT public._video_badge_can_manage(b) THEN
    RAISE EXCEPTION 'You cannot manage this badge';
  END IF;
  DELETE FROM public.video_product_badges WHERE id = p_badge_id;
  RETURN TRUE;
END $$;
REVOKE ALL ON FUNCTION public.fn_delete_video_badge(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_delete_video_badge(UUID) TO authenticated;

-- ------------------------------------------------------------
-- 7. Publish / renew: the one place money moves
-- ------------------------------------------------------------
-- Costs the current price of the badge's service (free to start). The coin leaves the BUSINESS wallet and goes to the platform-fee business
-- in the same transaction: if either side fails nothing is taken and the badge is not published.
--   * pitch badge: live for 30 days; renewable in its last 7 days (so a double tap is harmless)
--   * status badge: live until its status ends (24 hours after it was posted); nothing to renew
CREATE OR REPLACE FUNCTION public.fn_publish_video_badge(p_badge_id UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b          public.video_product_badges;
  v_status   public.ican_statuses;
  v_service  TEXT;
  v_price    NUMERIC;
  v_owner    UUID;
  v_wallet   UUID;
  v_balance  NUMERIC;
  v_kind     TEXT;
  v_charge   UUID;
  v_credit   JSONB;
  v_days     INTEGER := 30;
  v_until    TIMESTAMPTZ;
BEGIN
  SELECT * INTO b FROM public.video_product_badges WHERE id = p_badge_id FOR UPDATE;
  IF NOT FOUND OR NOT public._video_badge_can_manage(b) THEN
    RAISE EXCEPTION 'You cannot manage this badge';
  END IF;

  IF b.status_id IS NOT NULL THEN
    v_service := 'status_product_badge';
    SELECT * INTO v_status FROM public.ican_statuses WHERE id = b.status_id;
    IF NOT FOUND OR v_status.expires_at <= now() THEN
      RETURN jsonb_build_object('success', false, 'error', 'This status has ended, so the badge can no longer be published.');
    END IF;
    IF b.status = 'live' THEN
      RETURN jsonb_build_object('success', false, 'error', 'This badge is already showing on your status.');
    END IF;
    v_kind := 'publish'; v_days := 1; v_until := v_status.expires_at;
  ELSE
    v_service := 'pitch_product_badge';
    IF b.status = 'live' AND b.live_until > now() + INTERVAL '7 days' THEN
      RETURN jsonb_build_object('success', false, 'error', 'This badge is already running until ' || to_char(b.live_until, 'YYYY-MM-DD') || '. You can renew it in its last 7 days.');
    END IF;
    v_kind := CASE WHEN b.status = 'live' AND b.live_until IS NOT NULL THEN 'renew' ELSE 'publish' END;
    v_until := GREATEST(now(), COALESCE(b.live_until, now())) + make_interval(days => v_days);
  END IF;
  v_price := public.ican_service_price(v_service);

  IF v_price > 0 THEN
    SELECT bp.user_id INTO v_owner FROM public.business_profiles bp WHERE bp.id = b.business_profile_id;
    IF v_owner IS DISTINCT FROM auth.uid() THEN
      RETURN jsonb_build_object('success', false, 'error', 'Only the business owner can pay for a badge. Ask them to publish it.');
    END IF;
    IF to_regprocedure('public.fn_credit_platform_fee_to_business(numeric,text,text,text,uuid,text,jsonb)') IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Billing is not set up yet, so paid badges cannot be published');
    END IF;

    INSERT INTO public.ican_business_wallets (business_profile_id, created_by)
    VALUES (b.business_profile_id, v_owner) ON CONFLICT (business_profile_id) DO NOTHING;
    SELECT id, ican_balance INTO v_wallet, v_balance FROM public.ican_business_wallets
     WHERE business_profile_id = b.business_profile_id FOR UPDATE;
    IF v_balance < v_price THEN
      RETURN jsonb_build_object('success', false, 'error', 'Not enough IcanEra coin in the business wallet',
                                'price_ic', v_price, 'balance_ic', v_balance);
    END IF;
    UPDATE public.ican_business_wallets
       SET ican_balance = ican_balance - v_price, total_spent = total_spent + v_price, updated_at = now()
     WHERE id = v_wallet;
  END IF;

  INSERT INTO public.video_badge_charges (badge_id, business_profile_id, amount_ic, kind, days, paid_by)
  VALUES (b.id, b.business_profile_id, v_price, v_kind, v_days, auth.uid())
  RETURNING id INTO v_charge;

  IF v_price > 0 THEN
    v_credit := public.fn_credit_platform_fee_to_business(
      p_amount_ican => v_price, p_source_app => 'ican', p_source_reference => 'video-badge:' || v_charge::TEXT,
      p_fee_type => v_service, p_actor_user_id => v_owner,
      p_note => format('Product badge %s IC (badge %s)', v_price::TEXT, b.id),
      p_metadata => jsonb_build_object('badge_id', b.id, 'pitch_id', b.pitch_id, 'status_id', b.status_id, 'charge_id', v_charge));
    IF NOT COALESCE((v_credit ->> 'success')::BOOLEAN, FALSE) THEN
      -- undo the whole payment: the business is not charged for a badge that did not go live
      RAISE EXCEPTION 'The payment could not be completed: %', COALESCE(v_credit ->> 'error', 'platform account unavailable');
    END IF;
  END IF;

  UPDATE public.video_product_badges SET status = 'live', live_until = v_until, updated_at = now()
   WHERE id = b.id
   RETURNING * INTO b;

  RETURN jsonb_build_object('success', true, 'kind', v_kind, 'paid_ic', v_price, 'live_until', b.live_until,
                            'badge', public._pitch_badge_json(b, TRUE));
END $$;
REVOKE ALL ON FUNCTION public.fn_publish_video_badge(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_publish_video_badge(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'Product badges ready for PitchIn videos and statuses (pitch: ' || public.ican_service_price('pitch_product_badge')::TEXT
       || ' IC, status: ' || public.ican_service_price('status_product_badge')::TEXT || ' IC; 0 = free)' AS status;

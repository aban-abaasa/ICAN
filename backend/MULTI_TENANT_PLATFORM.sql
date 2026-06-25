-- =============================================================================
-- MULTI_TENANT_PLATFORM.sql
--
-- Transforms digital-city-era into a SaaS platform where any supermarket can
-- onboard, assign managers/cashiers, receive supplier applications, and request
-- mybodaguy deliveries.  ICAN coin is wired throughout.
--
-- Run AFTER:
--   1. FIX_MISSING_COLUMNS.sql
--   2. ICAN_CROSS_APP_WALLET_MIGRATION.sql
--   3. DCE_CUSTOMER_SELFCHECKOUT.sql
-- =============================================================================

SET check_function_bodies = off;


-- =============================================================================
-- SECTION 1 — SUPERMARKETS  (tenant registry)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.supermarkets (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id     UUID        NOT NULL,          -- auth.uid() of onboarding user
  name              TEXT        NOT NULL,
  slug              TEXT        UNIQUE,             -- url-friendly name
  description       TEXT,
  logo_url          TEXT,
  phone             TEXT,
  email             TEXT,
  address           TEXT,
  city              TEXT,
  country           TEXT        NOT NULL DEFAULT 'Uganda',
  subscription_plan TEXT        NOT NULL DEFAULT 'free'
                    CHECK (subscription_plan IN ('free','basic','pro','enterprise')),
  status            TEXT        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','active','suspended','closed')),
  ican_wallet_id    UUID,                           -- FK to ican_user_wallets
  onboarding_token  TEXT        UNIQUE DEFAULT      -- staff invite link token
                    upper(substr(md5(gen_random_uuid()::text), 1, 12)),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.supermarkets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "supermarket_owner_all"   ON public.supermarkets;
DROP POLICY IF EXISTS "supermarket_public_read" ON public.supermarkets;

-- Owner can do everything on their supermarket row
CREATE POLICY "supermarket_owner_all" ON public.supermarkets
  FOR ALL TO authenticated
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

-- Staff can read the supermarket they belong to (needed for dashboard)
CREATE POLICY "supermarket_staff_read" ON public.supermarkets
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.supermarket_staff ss
      WHERE ss.supermarket_id = id
        AND ss.user_id = auth.uid()
        AND ss.status = 'active'
    )
  );

-- Anyone can read active supermarkets (marketplace discovery)
CREATE POLICY "supermarket_public_read" ON public.supermarkets
  FOR SELECT TO authenticated USING (status = 'active');


-- =============================================================================
-- SECTION 2 — SUPERMARKET STAFF  (manager / cashier roles)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.supermarket_staff (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  supermarket_id  UUID        NOT NULL REFERENCES public.supermarkets(id) ON DELETE CASCADE,
  user_id         UUID,                             -- set when invite is accepted
  invited_email   TEXT        NOT NULL,
  role            TEXT        NOT NULL CHECK (role IN ('manager','cashier')),
  status          TEXT        NOT NULL DEFAULT 'invited'
                  CHECK (status IN ('invited','active','inactive','removed')),
  invited_by      UUID        NOT NULL,             -- manager who sent invite
  joined_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (supermarket_id, invited_email)
);

ALTER TABLE public.supermarket_staff ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff_manager_manage" ON public.supermarket_staff;
DROP POLICY IF EXISTS "staff_self_read"      ON public.supermarket_staff;

-- Owner and active managers of the supermarket can manage staff
CREATE POLICY "staff_manager_manage" ON public.supermarket_staff
  FOR ALL TO authenticated
  USING (
    -- Is the owner
    EXISTS (
      SELECT 1 FROM public.supermarkets sm
      WHERE sm.id = supermarket_id AND sm.owner_user_id = auth.uid()
    )
    OR
    -- Is an active manager of this supermarket
    EXISTS (
      SELECT 1 FROM public.supermarket_staff ms
      WHERE ms.supermarket_id = supermarket_id
        AND ms.user_id = auth.uid()
        AND ms.role = 'manager'
        AND ms.status = 'active'
    )
  );

-- Staff can read their own row
CREATE POLICY "staff_self_read" ON public.supermarket_staff
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR invited_email = (
    SELECT email FROM auth.users WHERE id = auth.uid()
  ));


-- =============================================================================
-- SECTION 3 — SUPPLIER APPLICATIONS
-- Suppliers (from mybodaguy or direct) apply to supply a specific supermarket.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.supplier_applications (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  supermarket_id   UUID        NOT NULL REFERENCES public.supermarkets(id) ON DELETE CASCADE,
  supplier_user_id UUID        NOT NULL,            -- auth.uid() of the supplier
  business_name    TEXT        NOT NULL,
  contact_name     TEXT        NOT NULL,
  contact_phone    TEXT        NOT NULL,
  contact_email    TEXT        NOT NULL,
  product_categories TEXT[]    NOT NULL DEFAULT '{}',
  supply_description TEXT,
  monthly_capacity TEXT,
  message          TEXT,
  status           TEXT        NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','approved','rejected','withdrawn')),
  reviewed_by      UUID,
  reviewed_at      TIMESTAMPTZ,
  rejection_reason TEXT,
  ican_onboarding_credited BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.supplier_applications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "supplier_own_apps"     ON public.supplier_applications;
DROP POLICY IF EXISTS "supermarket_see_apps"  ON public.supplier_applications;

-- Supplier can read/create/withdraw their own applications
CREATE POLICY "supplier_own_apps" ON public.supplier_applications
  FOR ALL TO authenticated
  USING (supplier_user_id = auth.uid())
  WITH CHECK (supplier_user_id = auth.uid());

-- Supermarket owner/managers can see and review applications for their store
CREATE POLICY "supermarket_see_apps" ON public.supplier_applications
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.supermarkets sm
      WHERE sm.id = supermarket_id AND sm.owner_user_id = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM public.supermarket_staff ss
      WHERE ss.supermarket_id = supermarket_id
        AND ss.user_id = auth.uid()
        AND ss.role = 'manager'
        AND ss.status = 'active'
    )
  );


-- =============================================================================
-- SECTION 4 — MYBODAGUY DELIVERY REQUESTS
-- Supermarket triggers a delivery; mybodaguy rider picks it up.
-- Shared Supabase instance means riders can query this table from their app.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.mybodaguy_delivery_requests (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  supermarket_id    UUID        NOT NULL REFERENCES public.supermarkets(id) ON DELETE CASCADE,
  transaction_id    UUID,                           -- FK to transactions.id
  supermarket_name  TEXT        NOT NULL,
  pickup_address    TEXT        NOT NULL,
  customer_name     TEXT        NOT NULL,
  customer_phone    TEXT        NOT NULL,
  delivery_address  TEXT        NOT NULL,
  delivery_notes    TEXT,
  items_summary     TEXT,
  total_ugx         DECIMAL(18,2) NOT NULL DEFAULT 0,
  delivery_fee_ugx  DECIMAL(18,2) NOT NULL DEFAULT 5000,
  delivery_fee_ican DECIMAL(18,8) GENERATED ALWAYS AS
                    (delivery_fee_ugx / 5000) STORED,
  rider_id          UUID,                           -- assigned rider's auth.uid()
  rider_name        TEXT,
  status            TEXT        NOT NULL DEFAULT 'pending'
                    CHECK (status IN (
                      'pending','assigned','picked_up','in_transit',
                      'delivered','cancelled','failed'
                    )),
  ican_paid_to_rider   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.mybodaguy_delivery_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "supermarket_manage_deliveries" ON public.mybodaguy_delivery_requests;
DROP POLICY IF EXISTS "rider_see_pending_deliveries"  ON public.mybodaguy_delivery_requests;

-- Supermarket owner/managers can create and manage deliveries
CREATE POLICY "supermarket_manage_deliveries" ON public.mybodaguy_delivery_requests
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.supermarkets sm
      WHERE sm.id = supermarket_id AND sm.owner_user_id = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM public.supermarket_staff ss
      WHERE ss.supermarket_id = supermarket_id
        AND ss.user_id = auth.uid()
        AND ss.role IN ('manager', 'cashier')
        AND ss.status = 'active'
    )
  );

-- mybodaguy riders can see pending deliveries and update their own assignments
CREATE POLICY "rider_see_pending_deliveries" ON public.mybodaguy_delivery_requests
  FOR SELECT TO authenticated
  USING (status = 'pending' OR rider_id = auth.uid());

CREATE POLICY "rider_update_own_delivery" ON public.mybodaguy_delivery_requests
  FOR UPDATE TO authenticated
  USING (rider_id = auth.uid())
  WITH CHECK (rider_id = auth.uid());


-- =============================================================================
-- SECTION 5 — WIRE SUPERMARKET_ID INTO EXISTING POS TABLES
-- =============================================================================

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='transactions') THEN
    ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS supermarket_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='products') THEN
    ALTER TABLE public.products ADD COLUMN IF NOT EXISTS supermarket_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='inventory') THEN
    ALTER TABLE public.inventory ADD COLUMN IF NOT EXISTS supermarket_id UUID;
  END IF;
END $$;


-- =============================================================================
-- SECTION 6 — ONBOARD SUPERMARKET FUNCTION
-- Called when a new supermarket registers on the platform.
-- Creates the record + ICAN wallet + credits platform onboarding bonus.
-- =============================================================================

CREATE OR REPLACE FUNCTION onboard_supermarket(
  p_name          TEXT,
  p_description   TEXT    DEFAULT NULL,
  p_phone         TEXT    DEFAULT NULL,
  p_email         TEXT    DEFAULT NULL,
  p_address       TEXT    DEFAULT NULL,
  p_city          TEXT    DEFAULT NULL,
  p_country       TEXT    DEFAULT 'Uganda',
  p_logo_url      TEXT    DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_owner_id      UUID := auth.uid();
  v_slug          TEXT;
  v_supermarket   RECORD;
  v_wallet        JSONB;
  v_ican_result   JSONB;
BEGIN
  IF v_owner_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- Build a URL-safe slug
  v_slug := lower(regexp_replace(p_name, '[^a-zA-Z0-9]+', '-', 'g'))
            || '-' || substr(md5(gen_random_uuid()::text), 1, 6);

  INSERT INTO public.supermarkets (
    owner_user_id, name, slug, description, phone, email,
    address, city, country, logo_url, status
  ) VALUES (
    v_owner_id, p_name, v_slug, p_description, p_phone, p_email,
    p_address, p_city, p_country, p_logo_url, 'active'
  )
  RETURNING * INTO v_supermarket;

  -- Create ICAN wallet for this supermarket owner (shared wallet)
  v_wallet := get_or_create_ican_wallet(v_owner_id);

  -- Update supermarket with wallet reference
  UPDATE public.supermarkets
  SET ican_wallet_id = (v_wallet->>'wallet_id')::UUID
  WHERE id = v_supermarket.id;

  -- Credit onboarding bonus: 10 ICAN for joining the platform
  BEGIN
    v_ican_result := credit_ican_earning(
      v_owner_id,
      10.0,
      'digital-city-era',
      format('Supermarket onboarding bonus: %s', p_name),
      v_supermarket.id::TEXT
    );
  EXCEPTION WHEN OTHERS THEN
    v_ican_result := jsonb_build_object('success', false, 'note', SQLERRM);
  END;

  RETURN jsonb_build_object(
    'success',          true,
    'supermarket_id',   v_supermarket.id,
    'slug',             v_slug,
    'onboarding_token', v_supermarket.onboarding_token,
    'ican_bonus',       v_ican_result
  );
END;
$$;


-- =============================================================================
-- SECTION 7 — INVITE STAFF FUNCTION
-- Manager/owner invites a cashier or manager by email.
-- =============================================================================

CREATE OR REPLACE FUNCTION invite_supermarket_staff(
  p_supermarket_id UUID,
  p_email          TEXT,
  p_role           TEXT  -- 'manager' or 'cashier'
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_is_authorized BOOLEAN := FALSE;
BEGIN
  IF p_role NOT IN ('manager', 'cashier') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Role must be manager or cashier');
  END IF;

  -- Check caller is owner or active manager
  SELECT TRUE INTO v_is_authorized
  FROM public.supermarkets sm
  WHERE sm.id = p_supermarket_id AND sm.owner_user_id = v_caller;

  IF NOT v_is_authorized THEN
    SELECT TRUE INTO v_is_authorized
    FROM public.supermarket_staff ss
    WHERE ss.supermarket_id = p_supermarket_id
      AND ss.user_id = v_caller
      AND ss.role = 'manager'
      AND ss.status = 'active';
  END IF;

  IF NOT FOUND OR NOT v_is_authorized THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized to invite staff');
  END IF;

  INSERT INTO public.supermarket_staff (
    supermarket_id, invited_email, role, status, invited_by
  ) VALUES (
    p_supermarket_id, lower(trim(p_email)), p_role, 'invited', v_caller
  )
  ON CONFLICT (supermarket_id, invited_email)
  DO UPDATE SET role = EXCLUDED.role, status = 'invited', updated_at = now();

  RETURN jsonb_build_object(
    'success', true,
    'message', format('%s invited as %s', p_email, p_role)
  );
END;
$$;


-- =============================================================================
-- SECTION 8 — ACCEPT STAFF INVITE FUNCTION
-- Called when invited person logs in and accepts their invitation.
-- =============================================================================

CREATE OR REPLACE FUNCTION accept_staff_invite(p_supermarket_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_id   UUID := auth.uid();
  v_email     TEXT;
  v_staff_id  UUID;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = v_user_id;

  UPDATE public.supermarket_staff
  SET user_id   = v_user_id,
      status    = 'active',
      joined_at = now(),
      updated_at = now()
  WHERE supermarket_id = p_supermarket_id
    AND lower(invited_email) = lower(v_email)
    AND status = 'invited'
  RETURNING id INTO v_staff_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false,
      'error', 'No pending invite found for your email at this supermarket');
  END IF;

  RETURN jsonb_build_object('success', true, 'staff_id', v_staff_id);
END;
$$;


-- =============================================================================
-- SECTION 9 — APPROVE SUPPLIER APPLICATION + CREDIT ICAN
-- =============================================================================

CREATE OR REPLACE FUNCTION approve_supplier_application(
  p_application_id UUID,
  p_approve        BOOLEAN,
  p_reason         TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_app    RECORD;
  v_ican   JSONB;
BEGIN
  SELECT * INTO v_app
  FROM public.supplier_applications
  WHERE id = p_application_id AND status = 'pending';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Application not found or already reviewed');
  END IF;

  -- Verify caller is owner or manager of the supermarket
  IF NOT EXISTS (
    SELECT 1 FROM public.supermarkets sm
    WHERE sm.id = v_app.supermarket_id AND sm.owner_user_id = v_caller
  ) AND NOT EXISTS (
    SELECT 1 FROM public.supermarket_staff ss
    WHERE ss.supermarket_id = v_app.supermarket_id
      AND ss.user_id = v_caller AND ss.role = 'manager' AND ss.status = 'active'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  UPDATE public.supplier_applications
  SET status           = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
      reviewed_by      = v_caller,
      reviewed_at      = now(),
      rejection_reason = CASE WHEN NOT p_approve THEN p_reason ELSE NULL END,
      updated_at       = now()
  WHERE id = p_application_id;

  -- Credit supplier 5 ICAN when approved
  IF p_approve THEN
    BEGIN
      v_ican := credit_ican_earning(
        v_app.supplier_user_id,
        5.0,
        'digital-city-era',
        format('Supplier approved by supermarket | %s', v_app.business_name),
        p_application_id::TEXT
      );
    EXCEPTION WHEN OTHERS THEN
      v_ican := jsonb_build_object('error', SQLERRM);
    END;
  END IF;

  RETURN jsonb_build_object(
    'success',  true,
    'status',   CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
    'ican',     v_ican
  );
END;
$$;


-- =============================================================================
-- SECTION 10 — REQUEST MYBODAGUY DELIVERY
-- Called by cashier/manager after a customer sale.
-- =============================================================================

CREATE OR REPLACE FUNCTION request_mbg_delivery(
  p_supermarket_id   UUID,
  p_transaction_id   UUID,
  p_customer_name    TEXT,
  p_customer_phone   TEXT,
  p_delivery_address TEXT,
  p_delivery_notes   TEXT  DEFAULT NULL,
  p_items_summary    TEXT  DEFAULT NULL,
  p_total_ugx        DECIMAL DEFAULT 0,
  p_delivery_fee_ugx DECIMAL DEFAULT 5000
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_sm     RECORD;
  v_del_id UUID;
BEGIN
  SELECT name, address INTO v_sm
  FROM public.supermarkets WHERE id = p_supermarket_id AND status = 'active';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Supermarket not found or inactive');
  END IF;

  INSERT INTO public.mybodaguy_delivery_requests (
    supermarket_id, transaction_id, supermarket_name, pickup_address,
    customer_name, customer_phone, delivery_address, delivery_notes,
    items_summary, total_ugx, delivery_fee_ugx, status
  ) VALUES (
    p_supermarket_id, p_transaction_id, v_sm.name,
    COALESCE(v_sm.address, 'Supermarket address on record'),
    p_customer_name, p_customer_phone, p_delivery_address, p_delivery_notes,
    p_items_summary, p_total_ugx, p_delivery_fee_ugx, 'pending'
  )
  RETURNING id INTO v_del_id;

  RETURN jsonb_build_object('success', true, 'delivery_id', v_del_id);
END;
$$;


-- =============================================================================
-- SECTION 11 — COMPLETE DELIVERY + PAY RIDER IN ICAN
-- Called by rider when delivery is done.
-- =============================================================================

CREATE OR REPLACE FUNCTION complete_mbg_delivery(p_delivery_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_rider_id UUID := auth.uid();
  v_del      RECORD;
  v_ican     JSONB;
BEGIN
  SELECT * INTO v_del
  FROM public.mybodaguy_delivery_requests
  WHERE id = p_delivery_id AND rider_id = v_rider_id AND status = 'in_transit';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Delivery not found or not yours');
  END IF;

  UPDATE public.mybodaguy_delivery_requests
  SET status = 'delivered', updated_at = now()
  WHERE id = p_delivery_id;

  -- Pay rider in ICAN
  BEGIN
    v_ican := credit_ican_earning(
      v_rider_id,
      v_del.delivery_fee_ican,
      'mybodaguy',
      format('Delivery completed for %s | %s', v_del.supermarket_name, v_del.customer_name),
      p_delivery_id::TEXT
    );
    UPDATE public.mybodaguy_delivery_requests
    SET ican_paid_to_rider = TRUE WHERE id = p_delivery_id;
  EXCEPTION WHEN OTHERS THEN
    v_ican := jsonb_build_object('error', SQLERRM);
  END;

  RETURN jsonb_build_object('success', true, 'ican_earned', v_ican);
END;
$$;


-- =============================================================================
-- SECTION 12 — TRIGGERS
-- =============================================================================

CREATE OR REPLACE FUNCTION _set_updated_at_trigger()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS supermarkets_updated_at ON public.supermarkets;
CREATE TRIGGER supermarkets_updated_at
  BEFORE UPDATE ON public.supermarkets
  FOR EACH ROW EXECUTE FUNCTION _set_updated_at_trigger();

DROP TRIGGER IF EXISTS supermarket_staff_updated_at ON public.supermarket_staff;
CREATE TRIGGER supermarket_staff_updated_at
  BEFORE UPDATE ON public.supermarket_staff
  FOR EACH ROW EXECUTE FUNCTION _set_updated_at_trigger();

DROP TRIGGER IF EXISTS supplier_applications_updated_at ON public.supplier_applications;
CREATE TRIGGER supplier_applications_updated_at
  BEFORE UPDATE ON public.supplier_applications
  FOR EACH ROW EXECUTE FUNCTION _set_updated_at_trigger();

DROP TRIGGER IF EXISTS mbg_deliveries_updated_at ON public.mybodaguy_delivery_requests;
CREATE TRIGGER mbg_deliveries_updated_at
  BEFORE UPDATE ON public.mybodaguy_delivery_requests
  FOR EACH ROW EXECUTE FUNCTION _set_updated_at_trigger();


-- =============================================================================
-- SECTION 13 — SUPPLIER CATALOG ITEMS
-- What a supplier deals in — their product/service menu shown to supermarkets.
-- Separate from the POS products table; this is the supplier's offering profile.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.supplier_catalog_items (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_user_id UUID        NOT NULL,
  name             TEXT        NOT NULL,
  category         TEXT        NOT NULL,
  description      TEXT,
  unit             TEXT        DEFAULT 'kg',        -- kg / piece / litre / box / etc
  min_order_qty    DECIMAL     DEFAULT 1,
  price_per_unit   DECIMAL(18,2),
  currency         TEXT        DEFAULT 'UGX',
  image_url        TEXT,
  is_available     BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.supplier_catalog_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "supplier_own_catalog" ON public.supplier_catalog_items;
DROP POLICY IF EXISTS "catalog_public_read"  ON public.supplier_catalog_items;

CREATE POLICY "supplier_own_catalog" ON public.supplier_catalog_items
  FOR ALL TO authenticated
  USING (supplier_user_id = auth.uid())
  WITH CHECK (supplier_user_id = auth.uid());

-- Supermarket managers/owners can browse all supplier catalogs
CREATE POLICY "catalog_public_read" ON public.supplier_catalog_items
  FOR SELECT TO authenticated USING (is_available = TRUE);

DROP TRIGGER IF EXISTS supplier_catalog_updated_at ON public.supplier_catalog_items;
CREATE TRIGGER supplier_catalog_updated_at
  BEFORE UPDATE ON public.supplier_catalog_items
  FOR EACH ROW EXECUTE FUNCTION _set_updated_at_trigger();


-- =============================================================================
-- SECTION 14 — ADMIN STAFF ASSIGNMENT FUNCTION
-- Admin assigns a user (by email) as manager or cashier to a supermarket.
-- The user gets their portal scoped to that supermarket on next login.
-- =============================================================================

CREATE OR REPLACE FUNCTION admin_assign_staff(
  p_supermarket_id UUID,
  p_email          TEXT,
  p_role           TEXT   -- 'manager' or 'cashier'
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_target_user RECORD;
  v_staff_id    UUID;
BEGIN
  IF p_role NOT IN ('manager','cashier') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Role must be manager or cashier');
  END IF;

  -- Find user in auth (may not have a users row yet)
  SELECT au.id, au.email INTO v_target_user
  FROM auth.users au WHERE lower(au.email) = lower(trim(p_email));

  IF NOT FOUND THEN
    -- Pre-create invite record (they join when they sign up)
    INSERT INTO public.supermarket_staff (
      supermarket_id, invited_email, role, status, invited_by
    ) VALUES (
      p_supermarket_id, lower(trim(p_email)), p_role, 'invited', auth.uid()
    )
    ON CONFLICT (supermarket_id, invited_email)
    DO UPDATE SET role = EXCLUDED.role, status = 'invited', invited_by = EXCLUDED.invited_by, updated_at = now()
    RETURNING id INTO v_staff_id;

    RETURN jsonb_build_object('success', true, 'status', 'invited',
      'message', p_email || ' pre-invited — they will be activated on first login');
  END IF;

  -- User exists — assign directly as active
  INSERT INTO public.supermarket_staff (
    supermarket_id, user_id, invited_email, role, status, invited_by, joined_at
  ) VALUES (
    p_supermarket_id, v_target_user.id, lower(v_target_user.email),
    p_role, 'active', auth.uid(), now()
  )
  ON CONFLICT (supermarket_id, invited_email)
  DO UPDATE SET user_id = EXCLUDED.user_id, role = EXCLUDED.role,
               status = 'active', joined_at = COALESCE(supermarket_staff.joined_at, now()),
               updated_at = now()
  RETURNING id INTO v_staff_id;

  -- Also update users table role column if it exists
  UPDATE public.users SET role = p_role, updated_at = now()
  WHERE id = v_target_user.id OR auth_id = v_target_user.id;

  RETURN jsonb_build_object('success', true, 'status', 'active',
    'staff_id', v_staff_id,
    'message', v_target_user.email || ' assigned as ' || p_role);
END;
$$;


-- =============================================================================
-- SECTION 15 — RIDER ACCEPT DELIVERY (mybodaguy)
-- Rider claims a pending delivery from any supermarket.
-- =============================================================================

CREATE OR REPLACE FUNCTION rider_accept_delivery(p_delivery_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_rider_id   UUID := auth.uid();
  v_rider_name TEXT;
  v_del_id     UUID;
BEGIN
  -- Get rider name
  SELECT COALESCE(full_name, email) INTO v_rider_name
  FROM public.mbg_user_profiles WHERE user_id = v_rider_id LIMIT 1;

  UPDATE public.mybodaguy_delivery_requests
  SET rider_id    = v_rider_id,
      rider_name  = COALESCE(v_rider_name, 'Rider'),
      status      = 'assigned',
      updated_at  = now()
  WHERE id = p_delivery_id AND status = 'pending'
  RETURNING id INTO v_del_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Delivery no longer available');
  END IF;

  RETURN jsonb_build_object('success', true, 'delivery_id', v_del_id);
END;
$$;


-- =============================================================================
SELECT 'Multi-tenant supermarket platform migration complete' AS status, now() AS run_at;

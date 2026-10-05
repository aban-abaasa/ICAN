-- ============================================================================
-- ERA API v2, part 1: business keys, scoped access, safe writes, owner tools.
-- Needs 20261005100000_era_api.sql and 20261005100100_era_api_endpoints.sql first. Additive; safe to run twice.
--
-- v1 gave outsiders PUBLIC, read-only data. v2 lets a BUSINESS OWNER hand a developer access to that ONE business:
--
--   * Business keys (era_biz_..., plus a fixture-only twin era_bzt_...) are minted by the owner inside ICAN, never by us.
--     Each is bound to one business, carries explicit scopes, expires (max 365 days), and can be revoked at once.
--   * A key can only ever read its own business: the business id comes from the key, never from the request.
--   * Writes exist for exactly two things, and neither can spend anything by itself:
--       payments:request  creates a PAYMENT REQUEST. The payer approves it in the ICAN app with their own PIN.
--       bookings:request  creates a BOOKING INTENT. The customer books it in BodaGoEra with their own session.
--     Both need an Idempotency-Key (a retry never double-creates), have hard caps, and a velocity brake.
--   * Everything an owner key does is in an activity log the owner can read.
--
-- Rollback: supabase/rollback/20261006_rollback_era_api_business.sql
-- ============================================================================

DO $$ BEGIN
  IF to_regclass('public.era_api_keys') IS NULL OR to_regclass('public.era_api_endpoints') IS NULL THEN
    RAISE EXCEPTION 'Apply supabase/migrations/20261005100000_era_api.sql and 20261005100100_era_api_endpoints.sql first.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------- schema changes

ALTER TABLE public.era_api_settings
  ADD COLUMN IF NOT EXISTS require_verified_for_payments BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.era_api_clients
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'developer',
  ADD COLUMN IF NOT EXISTS owner_user_id UUID,
  ADD COLUMN IF NOT EXISTS business_profile_id UUID;
DO $$ BEGIN
  ALTER TABLE public.era_api_clients ADD CONSTRAINT era_api_clients_kind_check CHECK (kind IN ('developer', 'owner'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS era_api_clients_biz_idx ON public.era_api_clients (business_profile_id) WHERE business_profile_id IS NOT NULL;

-- key modes: sandbox | live (developer keys) and business (owner-issued; `test` = fixtures only)
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'public.era_api_keys'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%mode%' LOOP
    EXECUTE format('ALTER TABLE public.era_api_keys DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE public.era_api_keys ADD CONSTRAINT era_api_keys_mode_check CHECK (mode IN ('sandbox', 'live', 'business'));
ALTER TABLE public.era_api_keys
  ADD COLUMN IF NOT EXISTS scopes TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS business_profile_id UUID,
  ADD COLUMN IF NOT EXISTS created_by UUID,
  ADD COLUMN IF NOT EXISTS test BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS max_amount_ugx NUMERIC,
  ADD COLUMN IF NOT EXISTS daily_cap_ugx NUMERIC;
CREATE INDEX IF NOT EXISTS era_api_keys_biz_idx ON public.era_api_keys (business_profile_id, created_at DESC) WHERE business_profile_id IS NOT NULL;

-- endpoints: which scope a business endpoint needs, and POST support
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'public.era_api_endpoints'::regclass AND contype = 'c'
              AND (pg_get_constraintdef(oid) ILIKE '%method%' OR pg_get_constraintdef(oid) ILIKE '%platform%') LOOP
    EXECUTE format('ALTER TABLE public.era_api_endpoints DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE public.era_api_endpoints
  ADD COLUMN IF NOT EXISTS access TEXT NOT NULL DEFAULT 'app',
  ADD COLUMN IF NOT EXISTS scope TEXT,
  ADD COLUMN IF NOT EXISTS body JSONB NOT NULL DEFAULT '[]'::JSONB;
ALTER TABLE public.era_api_endpoints ADD CONSTRAINT era_api_endpoints_method_check CHECK (method IN ('GET', 'POST'));
ALTER TABLE public.era_api_endpoints ADD CONSTRAINT era_api_endpoints_app_check
  CHECK (app IN ('platform', 'icanera', 'bodagoera', 'supermarketera', 'farmagentera', 'business'));
DO $$ BEGIN
  ALTER TABLE public.era_api_endpoints ADD CONSTRAINT era_api_endpoints_access_check CHECK (access IN ('app', 'business'));
  ALTER TABLE public.era_api_endpoints ADD CONSTRAINT era_api_endpoints_scope_check
    CHECK ((access = 'business') = (scope IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------- new tables (sealed from the browser)

CREATE TABLE IF NOT EXISTS public.era_api_idempotency (
  key_id       UUID NOT NULL,
  idem_key     TEXT NOT NULL CHECK (idem_key ~ '^[A-Za-z0-9_-]{8,64}$'),
  request_hash TEXT NOT NULL,
  status       INTEGER NOT NULL,
  response     JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (key_id, idem_key)
);

CREATE TABLE IF NOT EXISTS public.era_api_payment_links (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_id              UUID NOT NULL,
  business_profile_id UUID NOT NULL,
  payment_request_id  BIGINT NOT NULL,
  payment_code        TEXT NOT NULL UNIQUE,
  amount_ugx          NUMERIC NOT NULL CHECK (amount_ugx > 0),
  external_ref        TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS era_api_payment_links_biz_idx ON public.era_api_payment_links (business_profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS era_api_payment_links_key_idx ON public.era_api_payment_links (key_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.era_api_booking_intents (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                TEXT NOT NULL UNIQUE CHECK (code ~ '^BK[0-9A-F]{20}$'),
  key_id              UUID NOT NULL,
  business_profile_id UUID NOT NULL,
  kind                TEXT NOT NULL CHECK (kind IN ('ride', 'delivery')),
  status              TEXT NOT NULL DEFAULT 'awaiting_confirmation'
                        CHECK (status IN ('awaiting_confirmation', 'booked', 'cancelled', 'expired')),
  pickup_label        TEXT, pickup_lat NUMERIC NOT NULL, pickup_lng NUMERIC NOT NULL,
  dropoff_label       TEXT, dropoff_lat NUMERIC NOT NULL, dropoff_lng NUMERIC NOT NULL,
  notes               TEXT,
  external_ref        TEXT,
  quote               JSONB NOT NULL,
  ride_id             UUID,
  expires_at          TIMESTAMPTZ NOT NULL,
  booked_at           TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS era_api_booking_intents_biz_idx ON public.era_api_booking_intents (business_profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS era_api_booking_intents_key_idx ON public.era_api_booking_intents (key_id, status, created_at DESC);

-- Network fee inputs. An administrator sets the gas price and the native coin's USD price (we do not call out to a node),
-- and every estimate says how old they are.
CREATE TABLE IF NOT EXISTS public.era_api_chain_config (
  network        TEXT PRIMARY KEY CHECK (network ~ '^[a-z0-9_-]{2,30}$'),
  native_symbol  TEXT NOT NULL DEFAULT 'ETH',
  gas_price_gwei NUMERIC CHECK (gas_price_gwei IS NULL OR gas_price_gwei BETWEEN 0 AND 100000),
  native_usd     NUMERIC CHECK (native_usd IS NULL OR native_usd > 0),
  source         TEXT,
  updated_by     UUID,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.era_api_chain_config (network, native_symbol) VALUES ('ethereum', 'ETH') ON CONFLICT (network) DO NOTHING;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['era_api_idempotency','era_api_payment_links','era_api_booking_intents','era_api_chain_config'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------- helpers

-- The scopes an owner may put on a key.
CREATE OR REPLACE FUNCTION public.era__valid_scopes() RETURNS TEXT[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['payments:request', 'payments:read', 'inventory:read', 'cmms:read', 'bookings:request', 'bookings:read']
$$;

-- May the signed-in account issue keys for this business? Its owner, or an active member whose role is Owner.
CREATE OR REPLACE FUNCTION public.era__owner_can(p_business UUID) RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL OR p_business IS NULL THEN RETURN FALSE; END IF;
  RETURN EXISTS (SELECT 1 FROM public.business_profiles bp WHERE bp.id = p_business AND bp.user_id = v_uid)
      OR EXISTS (SELECT 1 FROM public.business_profile_members m
                  WHERE m.business_profile_id = p_business AND m.user_id = v_uid
                    AND lower(m.status) = 'active' AND lower(m.role) = 'owner');
END;
$$;

-- Business keys carry a business id; these resolve it to the stores / CMMS companies that business actually owns.
CREATE OR REPLACE FUNCTION public.era__biz_supermarkets(p_business UUID) RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id FROM public.supermarkets s WHERE s.pichin_business_profile_id = p_business
  UNION
  SELECT bp.supermarket_id FROM public.business_profiles bp WHERE bp.id = p_business AND bp.supermarket_id IS NOT NULL
  UNION
  SELECT l.source_entity_id FROM public.business_app_links l
   WHERE l.business_profile_id = p_business AND l.status = 'active'
     AND l.app_key IN ('supermarketa', 'supermarketera', 'supermarket') AND l.source_entity_id IS NOT NULL
$$;

CREATE OR REPLACE FUNCTION public.era__biz_cmms(p_business UUID) RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id FROM public.cmms_company_profiles c
   WHERE c.business_profile_id = p_business OR c.pichin_business_profile_id = p_business
  UNION
  SELECT l.source_entity_id FROM public.business_app_links l
   WHERE l.business_profile_id = p_business AND l.status = 'active' AND l.app_key = 'cmms' AND l.source_entity_id IS NOT NULL
$$;

-- ---------------------------------------------------------------------------- the owner's own tools (signed-in accounts only)

CREATE OR REPLACE FUNCTION public.era_api_owner_businesses() RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in first.' USING ERRCODE = '42501'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'id', bp.id, 'name', bp.business_name, 'country', bp.country, 'verification', bp.verification_status,
             'stores', (SELECT COUNT(*) FROM public.era__biz_supermarkets(bp.id)),
             'cmms_companies', (SELECT COUNT(*) FROM public.era__biz_cmms(bp.id)),
             'active_keys', (SELECT COUNT(*) FROM public.era_api_keys k
                              WHERE k.business_profile_id = bp.id AND k.revoked_at IS NULL
                                AND (k.expires_at IS NULL OR k.expires_at > now()))) ORDER BY bp.business_name)
      FROM public.business_profiles bp WHERE public.era__owner_can(bp.id)), '[]'::JSONB);
END;
$$;

CREATE OR REPLACE FUNCTION public.era_api_owner_create_key(
  p_business_id UUID, p_label TEXT, p_scopes TEXT[], p_expires_days INTEGER DEFAULT 90, p_test BOOLEAN DEFAULT FALSE,
  p_max_amount_ugx NUMERIC DEFAULT NULL, p_daily_cap_ugx NUMERIC DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s public.era_api_settings;
  bp public.business_profiles;
  v_scopes TEXT[];
  v_days INTEGER := COALESCE(p_expires_days, 90);
  v_client UUID;
  v_key TEXT;
  v_max NUMERIC; v_daily NUMERIC;
  v_label TEXT := NULLIF(left(btrim(COALESCE(p_label, '')), 60), '');
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in first.' USING ERRCODE = '42501'; END IF;
  IF NOT public.era__owner_can(p_business_id) THEN
    RAISE EXCEPTION 'Only the owner of this business can issue API keys for it.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO s FROM public.era_api_settings WHERE id;
  IF NOT COALESCE(s.enabled, FALSE) THEN RAISE EXCEPTION 'The API is switched off right now.' USING ERRCODE = 'ERA29'; END IF;
  SELECT * INTO bp FROM public.business_profiles WHERE id = p_business_id;

  SELECT COALESCE(array_agg(DISTINCT x ORDER BY x), '{}') INTO v_scopes FROM unnest(COALESCE(p_scopes, '{}')) x;
  IF array_length(v_scopes, 1) IS NULL THEN RAISE EXCEPTION 'Pick at least one scope.' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_scopes) x WHERE x <> ALL (public.era__valid_scopes())) THEN
    RAISE EXCEPTION 'Unknown scope. Allowed: %.', array_to_string(public.era__valid_scopes(), ', ') USING ERRCODE = '22023';
  END IF;
  IF v_days < 1 OR v_days > 365 THEN RAISE EXCEPTION 'A key must expire within 1 to 365 days.' USING ERRCODE = '22023'; END IF;

  -- Money guard rails. A key that can create payment requests must have caps; defaults are small, the ceiling is hard.
  IF 'payments:request' = ANY (v_scopes) THEN
    v_max := COALESCE(p_max_amount_ugx, 1000000);
    v_daily := COALESCE(p_daily_cap_ugx, 5000000);
    IF v_max <= 0 OR v_max > 10000000 THEN
      RAISE EXCEPTION 'The per-request cap must be between 1 and 10,000,000 UGX.' USING ERRCODE = '22023';
    END IF;
    IF v_daily < v_max OR v_daily > 50000000 THEN
      RAISE EXCEPTION 'The daily cap must be at least the per-request cap and at most 50,000,000 UGX.' USING ERRCODE = '22023';
    END IF;
    IF NOT COALESCE(p_test, FALSE) AND s.require_verified_for_payments
       AND lower(COALESCE(bp.verification_status, '')) NOT IN ('verified', 'approved') THEN
      RAISE EXCEPTION 'This business must be verified before it can issue a key that creates payment requests.' USING ERRCODE = 'ERA22';
    END IF;
  END IF;

  IF (SELECT COUNT(*) FROM public.era_api_keys WHERE business_profile_id = p_business_id AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > now())) >= 10 THEN
    RAISE EXCEPTION 'This business already has 10 active keys. Revoke one first.' USING ERRCODE = 'ERA29';
  END IF;
  IF (SELECT COUNT(*) FROM public.era_api_keys WHERE business_profile_id = p_business_id AND created_at > now() - INTERVAL '1 hour') >= 5 THEN
    RAISE EXCEPTION 'You have created several keys in the last hour. Wait a little.' USING ERRCODE = 'ERA29';
  END IF;

  -- One internal "owner" client per business carries the keys (and the limits).
  SELECT id INTO v_client FROM public.era_api_clients WHERE kind = 'owner' AND business_profile_id = p_business_id LIMIT 1;
  IF v_client IS NULL THEN
    INSERT INTO public.era_api_clients (app_name, contact_email, status, kind, owner_user_id, business_profile_id, ticket_hash,
                                        granted_apps, requested_apps, review_note)
    VALUES (left(COALESCE(bp.business_name, 'Business'), 80), 'owner@era-api.invalid', 'approved', 'owner', bp.user_id, p_business_id,
            public.era__hash('owner-' || gen_random_uuid()::TEXT),
            ARRAY['icanera','bodagoera','supermarketera','farmagentera'], '{}', 'Business owner keys')
    RETURNING id INTO v_client;
  END IF;

  v_key := CASE WHEN COALESCE(p_test, FALSE) THEN 'era_bzt_' ELSE 'era_biz_' END || public.era__rand(40);
  INSERT INTO public.era_api_keys (client_id, mode, prefix, key_hash, label, scopes, expires_at, business_profile_id, created_by,
                                   test, max_amount_ugx, daily_cap_ugx)
  VALUES (v_client, 'business', left(v_key, 17), public.era__hash(v_key), v_label, v_scopes, now() + make_interval(days => v_days),
          p_business_id, auth.uid(), COALESCE(p_test, FALSE), v_max, v_daily);

  INSERT INTO public.era_api_audit (actor, action, client_id, detail)
  VALUES (auth.uid(), 'owner_key_created', v_client,
          jsonb_build_object('business', p_business_id, 'prefix', left(v_key, 17), 'scopes', v_scopes, 'test', COALESCE(p_test, FALSE),
                             'expires_days', v_days, 'max_amount_ugx', v_max, 'daily_cap_ugx', v_daily));

  RETURN jsonb_build_object('key', v_key, 'prefix', left(v_key, 17), 'scopes', to_jsonb(v_scopes), 'test', COALESCE(p_test, FALSE),
    'expires_at', now() + make_interval(days => v_days), 'max_amount_ugx', v_max, 'daily_cap_ugx', v_daily,
    'note', 'Copy it now. For your safety it is never shown again, and you can revoke it any time.');
END;
$$;

CREATE OR REPLACE FUNCTION public.era_api_owner_list_keys(p_business_id UUID) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.era__owner_can(p_business_id) THEN
    RAISE EXCEPTION 'Only the owner of this business can see its API keys.' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', k.id, 'prefix', k.prefix, 'label', k.label, 'scopes', to_jsonb(k.scopes), 'test', k.test,
      'created_at', k.created_at, 'expires_at', k.expires_at, 'last_used_at', k.last_used_at, 'revoked_at', k.revoked_at,
      'expired', k.expires_at IS NOT NULL AND k.expires_at <= now(),
      'max_amount_ugx', k.max_amount_ugx, 'daily_cap_ugx', k.daily_cap_ugx,
      'calls_24h', (SELECT COUNT(*) FROM public.era_api_log l WHERE l.key_id = k.id AND l.at > now() - INTERVAL '24 hours')
    ) ORDER BY k.created_at DESC)
    FROM public.era_api_keys k WHERE k.business_profile_id = p_business_id), '[]'::JSONB);
END;
$$;

CREATE OR REPLACE FUNCTION public.era_api_owner_revoke_key(p_key_id UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE k public.era_api_keys;
BEGIN
  SELECT * INTO k FROM public.era_api_keys WHERE id = p_key_id AND business_profile_id IS NOT NULL;
  IF NOT FOUND OR NOT public.era__owner_can(k.business_profile_id) THEN
    RAISE EXCEPTION 'No such key.' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.era_api_keys SET revoked_at = COALESCE(revoked_at, now()), revoked_reason = COALESCE(revoked_reason, 'revoked by the owner')
   WHERE id = p_key_id;
  INSERT INTO public.era_api_audit (actor, action, client_id, detail)
  VALUES (auth.uid(), 'owner_key_revoked', k.client_id, jsonb_build_object('business', k.business_profile_id, 'prefix', k.prefix));
  RETURN jsonb_build_object('revoked', TRUE);
END;
$$;

-- What a business's keys have been doing. No IPs, no error text, nothing about other businesses.
CREATE OR REPLACE FUNCTION public.era_api_owner_activity(p_business_id UUID, p_limit INTEGER DEFAULT 50) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.era__owner_can(p_business_id) THEN
    RAISE EXCEPTION 'Only the owner of this business can see this.' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((SELECT jsonb_agg(row_to_json(x)::JSONB) FROM (
    SELECT l.at, k.prefix, l.endpoint, l.status, l.ms
      FROM public.era_api_log l JOIN public.era_api_keys k ON k.id = l.key_id
     WHERE k.business_profile_id = p_business_id
     ORDER BY l.at DESC LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)) x), '[]'::JSONB);
END;
$$;

-- ---------------------------------------------------------------------------- booking intents: the customer's side (signed in)

CREATE OR REPLACE FUNCTION public.era_api_booking_intent_get(p_code TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE i public.era_api_booking_intents; v_name TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in first.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO i FROM public.era_api_booking_intents WHERE code = upper(COALESCE(p_code, ''));
  IF NOT FOUND THEN RAISE EXCEPTION 'That booking link is not valid.' USING ERRCODE = 'P0002'; END IF;
  IF i.status = 'awaiting_confirmation' AND i.expires_at <= now() THEN
    UPDATE public.era_api_booking_intents SET status = 'expired' WHERE id = i.id; i.status := 'expired';
  END IF;
  SELECT business_name INTO v_name FROM public.business_profiles WHERE id = i.business_profile_id;
  RETURN jsonb_build_object('code', i.code, 'status', i.status, 'kind', i.kind, 'requested_by', v_name,
    'pickup', jsonb_build_object('label', i.pickup_label, 'lat', i.pickup_lat, 'lng', i.pickup_lng),
    'dropoff', jsonb_build_object('label', i.dropoff_label, 'lat', i.dropoff_lat, 'lng', i.dropoff_lng),
    'notes', i.notes, 'quote', i.quote, 'expires_at', i.expires_at, 'ride_id', i.ride_id);
END;
$$;

-- Called by the BodaGoEra app after the customer has booked the ride themselves (their own session, wallet and PIN).
CREATE OR REPLACE FUNCTION public.era_api_booking_intent_link(p_code TEXT, p_ride_id UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE i public.era_api_booking_intents;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in first.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO i FROM public.era_api_booking_intents WHERE code = upper(COALESCE(p_code, '')) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That booking link is not valid.' USING ERRCODE = 'P0002'; END IF;
  IF i.status <> 'awaiting_confirmation' OR i.expires_at <= now() THEN
    RAISE EXCEPTION 'This booking link is no longer open.' USING ERRCODE = 'ERA22';
  END IF;
  -- the ride must be the caller's own, and created after the link was
  IF NOT EXISTS (SELECT 1 FROM public.mbg_rides r JOIN public.mbg_customers c ON c.id = r.customer_id
                  WHERE r.id = p_ride_id AND c.user_id = auth.uid() AND r.created_at >= i.created_at) THEN
    RAISE EXCEPTION 'That ride is not yours, or it is older than this booking link.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.era_api_booking_intents SET status = 'booked', ride_id = p_ride_id, booked_at = now() WHERE id = i.id;
  INSERT INTO public.era_api_audit (actor, action, detail)
  VALUES (auth.uid(), 'booking_intent_booked', jsonb_build_object('code', i.code, 'business', i.business_profile_id));
  RETURN jsonb_build_object('code', i.code, 'status', 'booked', 'ride_id', p_ride_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.era_api_booking_intent_cancel(p_code TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in first.' USING ERRCODE = '42501'; END IF;
  UPDATE public.era_api_booking_intents SET status = 'cancelled'
   WHERE code = upper(COALESCE(p_code, '')) AND status = 'awaiting_confirmation';
  IF NOT FOUND THEN RAISE EXCEPTION 'That booking link is not open.' USING ERRCODE = 'P0002'; END IF;
  RETURN jsonb_build_object('status', 'cancelled');
END;
$$;

-- ---------------------------------------------------------------------------- administration additions

CREATE OR REPLACE FUNCTION public.era_api_admin_get_chain() RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.era__require_admin();
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(c) - 'updated_by' ORDER BY c.network) FROM public.era_api_chain_config c), '[]'::JSONB);
END;
$$;

CREATE OR REPLACE FUNCTION public.era_api_admin_save_chain(
  p_network TEXT, p_gas_price_gwei NUMERIC, p_native_usd NUMERIC, p_source TEXT DEFAULT NULL) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.era__require_admin();
  IF p_gas_price_gwei IS NOT NULL AND (p_gas_price_gwei < 0 OR p_gas_price_gwei > 100000) THEN
    RAISE EXCEPTION 'Gas price must be between 0 and 100000 gwei.' USING ERRCODE = '22023';
  END IF;
  IF p_native_usd IS NOT NULL AND p_native_usd <= 0 THEN
    RAISE EXCEPTION 'The coin price must be above zero.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.era_api_chain_config
     SET gas_price_gwei = p_gas_price_gwei, native_usd = p_native_usd, source = NULLIF(left(btrim(COALESCE(p_source, '')), 80), ''),
         updated_by = auth.uid(), updated_at = now()
   WHERE network = lower(COALESCE(p_network, ''));
  IF NOT FOUND THEN RAISE EXCEPTION 'No such network.' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO public.era_api_audit (actor, action, detail)
  VALUES (auth.uid(), 'chain_config_changed', jsonb_build_object('network', p_network, 'gas_gwei', p_gas_price_gwei, 'native_usd', p_native_usd));
  RETURN public.era_api_admin_get_chain();
END;
$$;

-- settings: adds require_verified_for_payments
CREATE OR REPLACE FUNCTION public.era_api_admin_save_settings(p_patch JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.era_api_settings;
BEGIN
  PERFORM public.era__require_admin();
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'Nothing to save.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.era_api_settings SET
      enabled = COALESCE((p_patch ->> 'enabled')::BOOLEAN, enabled),
      sandbox_enabled = COALESCE((p_patch ->> 'sandbox_enabled')::BOOLEAN, sandbox_enabled),
      signups_open = COALESCE((p_patch ->> 'signups_open')::BOOLEAN, signups_open),
      require_verified_for_payments = COALESCE((p_patch ->> 'require_verified_for_payments')::BOOLEAN, require_verified_for_payments),
      sandbox_rate_per_min = COALESCE((p_patch ->> 'sandbox_rate_per_min')::INTEGER, sandbox_rate_per_min),
      sandbox_daily_quota = COALESCE((p_patch ->> 'sandbox_daily_quota')::INTEGER, sandbox_daily_quota),
      updated_by = auth.uid(), updated_at = now()
   WHERE id RETURNING * INTO s;
  INSERT INTO public.era_api_audit (actor, action, detail) VALUES (auth.uid(), 'settings_changed', p_patch);
  RETURN to_jsonb(s) - 'updated_by';
END;
$$;

-- overview: developer apps and owner keys counted separately
CREATE OR REPLACE FUNCTION public.era_api_admin_overview() RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.era_api_settings;
BEGIN
  PERFORM public.era__require_admin();
  SELECT * INTO s FROM public.era_api_settings WHERE id;
  RETURN jsonb_build_object(
    'settings', to_jsonb(s) - 'updated_by',
    'clients', jsonb_build_object(
      'pending',   (SELECT COUNT(*) FROM public.era_api_clients WHERE status = 'pending'   AND NOT is_system AND kind = 'developer'),
      'approved',  (SELECT COUNT(*) FROM public.era_api_clients WHERE status = 'approved'  AND NOT is_system AND kind = 'developer'),
      'suspended', (SELECT COUNT(*) FROM public.era_api_clients WHERE status = 'suspended' AND NOT is_system AND kind = 'developer'),
      'rejected',  (SELECT COUNT(*) FROM public.era_api_clients WHERE status = 'rejected'  AND NOT is_system AND kind = 'developer'),
      'total',     (SELECT COUNT(*) FROM public.era_api_clients WHERE NOT is_system AND kind = 'developer')),
    'keys_active', (SELECT COUNT(*) FROM public.era_api_keys k JOIN public.era_api_clients c ON c.id = k.client_id
                     WHERE k.revoked_at IS NULL AND NOT c.is_system AND c.kind = 'developer'),
    'business_keys_active', (SELECT COUNT(*) FROM public.era_api_keys k
                              WHERE k.revoked_at IS NULL AND k.mode = 'business' AND (k.expires_at IS NULL OR k.expires_at > now())
                                AND NOT EXISTS (SELECT 1 FROM public.era_api_clients c WHERE c.id = k.client_id AND c.is_system)),
    'payment_requests_24h', (SELECT COUNT(*) FROM public.era_api_payment_links WHERE created_at > now() - INTERVAL '24 hours'),
    'booking_requests_24h', (SELECT COUNT(*) FROM public.era_api_booking_intents WHERE created_at > now() - INTERVAL '24 hours'),
    'calls_24h',   (SELECT COUNT(*) FROM public.era_api_log WHERE at > now() - INTERVAL '24 hours'),
    'errors_24h',  (SELECT COUNT(*) FROM public.era_api_log WHERE at > now() - INTERVAL '24 hours' AND status >= 500),
    'limited_24h', (SELECT COUNT(*) FROM public.era_api_log WHERE at > now() - INTERVAL '24 hours' AND status = 429),
    'endpoints', jsonb_build_object('enabled', (SELECT COUNT(*) FROM public.era_api_endpoints WHERE enabled),
                                    'total', (SELECT COUNT(*) FROM public.era_api_endpoints)),
    'top_endpoints', COALESCE((SELECT jsonb_agg(t) FROM (
        SELECT endpoint, COUNT(*) AS calls FROM public.era_api_log
         WHERE at > now() - INTERVAL '24 hours' AND endpoint IS NOT NULL
         GROUP BY endpoint ORDER BY COUNT(*) DESC LIMIT 6) t), '[]'::JSONB),
    'hourly', (SELECT jsonb_agg(COALESCE(x.n, 0) ORDER BY g.h) FROM
                 generate_series(date_trunc('hour', now()) - INTERVAL '23 hours', date_trunc('hour', now()), INTERVAL '1 hour') AS g(h)
                 LEFT JOIN (SELECT date_trunc('hour', at) AS h, COUNT(*) AS n FROM public.era_api_log
                             WHERE at > now() - INTERVAL '25 hours' GROUP BY 1) x ON x.h = g.h));
END;
$$;

-- the client list: show which are developer apps and which are business owners' keys
CREATE OR REPLACE FUNCTION public.era_api_admin_list_clients(p_status TEXT DEFAULT NULL, p_limit INTEGER DEFAULT 100)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.era__require_admin();
  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(x)::JSONB ORDER BY x.sort_pending DESC, x.created_at DESC) FROM (
      SELECT c.id, c.app_name, c.contact_name, c.contact_email, c.website, c.description, c.requested_apps, c.granted_apps,
             c.status, c.live_rate_per_min, c.live_daily_quota, c.review_note, c.reviewed_at, c.live_key_claimed_at,
             c.is_system, c.kind, c.business_profile_id, c.created_at,
             (c.status = 'pending') AS sort_pending,
             (SELECT COUNT(*) FROM public.era_api_log l WHERE l.client_id = c.id AND l.at > now() - INTERVAL '24 hours') AS calls_24h,
             COALESCE((SELECT jsonb_agg(jsonb_build_object('id', k.id, 'mode', k.mode, 'prefix', k.prefix, 'scopes', to_jsonb(k.scopes),
                         'test', k.test, 'expires_at', k.expires_at,
                         'created_at', k.created_at, 'last_used_at', k.last_used_at, 'revoked_at', k.revoked_at,
                         'revoked_reason', k.revoked_reason) ORDER BY k.created_at DESC)
                        FROM public.era_api_keys k WHERE k.client_id = c.id), '[]'::JSONB) AS keys
        FROM public.era_api_clients c
       WHERE (p_status IS NULL OR c.status = p_status)
       ORDER BY (c.status = 'pending') DESC, c.created_at DESC
       LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500)) x), '[]'::JSONB);
END;
$$;

-- owner clients are managed by their owners; an administrator can pause or reinstate them, not "approve" or "reject"
CREATE OR REPLACE FUNCTION public.era_api_admin_review(
  p_client_id UUID, p_decision TEXT, p_granted_apps TEXT[] DEFAULT NULL,
  p_rate_per_min INTEGER DEFAULT NULL, p_daily_quota INTEGER DEFAULT NULL, p_note TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c public.era_api_clients;
  v_apps TEXT[];
  v_status TEXT;
BEGIN
  PERFORM public.era__require_admin();
  SELECT * INTO c FROM public.era_api_clients WHERE id = p_client_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No such app.' USING ERRCODE = 'P0002'; END IF;
  IF c.is_system THEN RAISE EXCEPTION 'The built-in playground client cannot be changed.' USING ERRCODE = '42501'; END IF;
  IF c.kind = 'owner' AND p_decision IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'Business owner keys are issued by their owners. You can suspend or reinstate them.' USING ERRCODE = '22023';
  END IF;

  IF p_decision = 'approve' THEN
    SELECT COALESCE(array_agg(DISTINCT a ORDER BY a), '{}') INTO v_apps
      FROM unnest(COALESCE(p_granted_apps, NULLIF(c.granted_apps, '{}'), c.requested_apps)) a
     WHERE a IN ('icanera', 'bodagoera', 'supermarketera', 'farmagentera');
    IF array_length(v_apps, 1) IS NULL THEN RAISE EXCEPTION 'Approve at least one app.' USING ERRCODE = '22023'; END IF;
    UPDATE public.era_api_clients
       SET status = 'approved', granted_apps = v_apps,
           live_rate_per_min = COALESCE(p_rate_per_min, live_rate_per_min),
           live_daily_quota = COALESCE(p_daily_quota, live_daily_quota),
           review_note = NULLIF(btrim(COALESCE(p_note, '')), ''), reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
     WHERE id = c.id;
    v_status := 'approved';
  ELSIF p_decision = 'reject' THEN
    UPDATE public.era_api_clients
       SET status = 'rejected', review_note = NULLIF(btrim(COALESCE(p_note, '')), ''), reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
     WHERE id = c.id;
    UPDATE public.era_api_keys SET revoked_at = now(), revoked_reason = 'application rejected' WHERE client_id = c.id AND revoked_at IS NULL;
    v_status := 'rejected';
  ELSIF p_decision = 'suspend' THEN
    UPDATE public.era_api_clients
       SET status = 'suspended', review_note = COALESCE(NULLIF(btrim(COALESCE(p_note, '')), ''), review_note),
           reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
     WHERE id = c.id;
    v_status := 'suspended';
  ELSIF p_decision = 'reinstate' THEN
    v_status := CASE WHEN cardinality(c.granted_apps) > 0 THEN 'approved' ELSE 'pending' END;
    UPDATE public.era_api_clients
       SET status = v_status, review_note = COALESCE(NULLIF(btrim(COALESCE(p_note, '')), ''), review_note),
           reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
     WHERE id = c.id;
  ELSE
    RAISE EXCEPTION 'Decision must be approve, reject, suspend or reinstate.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.era_api_audit (actor, action, client_id, detail)
  VALUES (auth.uid(), 'review_' || p_decision, c.id,
          jsonb_build_object('granted_apps', v_apps, 'rate', p_rate_per_min, 'quota', p_daily_quota, 'note', p_note));
  RETURN jsonb_build_object('client_id', c.id, 'status', v_status);
END;
$$;

-- ---------------------------------------------------------------------------- public catalogue: now with business endpoints
CREATE OR REPLACE FUNCTION public.era_api_catalog() RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN jsonb_build_object(
    'version', 'v1',
    'apps', jsonb_build_array(
      jsonb_build_object('id', 'platform',       'name', 'Platform',       'tagline', 'Who you are, how much you have left, and one call that sees the whole family.'),
      jsonb_build_object('id', 'icanera',        'name', 'ICANERA',        'tagline', 'Coin price, valuation, supply, FX, tax rules, chain fees and the public business directory.'),
      jsonb_build_object('id', 'bodagoera',      'name', 'BodaGoEra',      'tagline', 'Stages, ports, journey and delivery quotes, and rider-card checks.'),
      jsonb_build_object('id', 'supermarketera', 'name', 'SupermarketEra', 'tagline', 'Stores, a product catalogue across every category, clearance deals and barcode lookups.'),
      jsonb_build_object('id', 'farmagentera',   'name', 'FarmAgentEra',   'tagline', 'Marketplace listings, a produce price board and crop knowledge.'),
      jsonb_build_object('id', 'business',       'name', 'Your business',  'tagline', 'Private, owner-issued: payment requests, inventory with expiry tracking, CMMS and booking requests.')),
    'scopes', to_jsonb(public.era__valid_scopes()),
    'endpoints', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', e.id, 'app', e.app, 'method', e.method, 'path', e.path, 'summary', e.summary,
               'description', e.description, 'params', e.params, 'body', e.body, 'example_path', e.example_path,
               'access', e.access, 'scope', e.scope, 'cache_seconds', e.cache_seconds) ORDER BY e.sort, e.path)
        FROM public.era_api_endpoints e WHERE e.enabled), '[]'::JSONB));
END;
$$;

-- ---------------------------------------------------------------------------- the gateway entry point, v2
-- Adds: business keys and scopes, key expiry, POST with an idempotency key, per-status error mapping.
-- The v1 signature is dropped first: the new one accepts the same five arguments (the last two have defaults), so a
-- gateway that has not been updated yet keeps working.
DROP FUNCTION IF EXISTS public.era_api_call(TEXT, TEXT, TEXT, JSONB, TEXT);

CREATE OR REPLACE FUNCTION public.era_api_call(
  p_key TEXT, p_method TEXT, p_path TEXT, p_query JSONB DEFAULT '{}'::JSONB, p_ip_hash TEXT DEFAULT NULL,
  p_body JSONB DEFAULT NULL, p_idem TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_t0 TIMESTAMPTZ := clock_timestamp();
  s public.era_api_settings;
  k public.era_api_keys;
  c public.era_api_clients;
  ep public.era_api_endpoints;
  v_hash TEXT;
  v_method TEXT := upper(COALESCE(p_method, 'GET'));
  v_ip TEXT := NULLIF(left(COALESCE(p_ip_hash, ''), 128), '');
  v_counter UUID;
  v_fail INTEGER;
  v_limit INTEGER; v_quota INTEGER;
  v_m INTEGER; v_d INTEGER;
  v_secs_min INTEGER; v_secs_day INTEGER;
  v_apps TEXT[];
  v_sandbox BOOLEAN;
  v_modename TEXT;
  v_params JSONB := '{}'::JSONB;
  v_path_params JSONB;
  v_data JSONB;
  v_status INTEGER := 200;
  v_err_code TEXT; v_err_msg TEXT; v_private_err TEXT;
  r RECORD;
  v_ms INTEGER;
  v_rid TEXT := public.era__rand(16);
  v_headers JSONB;
  v_found BOOLEAN := FALSE;
  v_other_method BOOLEAN := FALSE;
  v_reqhash TEXT;
  v_idem RECORD;
  v_body JSONB;
  v_resp JSONB;
BEGIN
  SELECT * INTO s FROM public.era_api_settings WHERE id;
  IF NOT COALESCE(s.enabled, FALSE) THEN
    RETURN public.era__err(503, 'api_disabled', 'The ICANERA API is switched off right now.');
  END IF;

  IF v_ip IS NOT NULL THEN
    SELECT COALESCE(SUM(calls), 0) INTO v_fail FROM public.era_api_usage
     WHERE key_id = md5('f:' || v_ip)::UUID AND period = 'f' AND bucket = public.era__bucket(60);
    IF v_fail >= 40 THEN
      RETURN public.era__err(429, 'too_many_bad_keys', 'Too many requests with an invalid key. Slow down.', jsonb_build_object('retry-after', 60));
    END IF;
  END IF;

  IF p_key IS NULL OR btrim(p_key) = '' THEN
    RETURN public.era__err(401, 'missing_key', 'Send your key as "Authorization: Bearer <key>" or in the X-API-Key header. Get one free at /developers.');
  END IF;
  IF p_key !~ '^era_(live|test|biz|bzt)_[0-9a-f]{40}$' THEN
    IF v_ip IS NOT NULL THEN
      INSERT INTO public.era_api_usage (key_id, period, bucket, calls) VALUES (md5('f:' || v_ip)::UUID, 'f', public.era__bucket(60), 1)
      ON CONFLICT (key_id, period, bucket) DO UPDATE SET calls = public.era_api_usage.calls + 1;
    END IF;
    RETURN public.era__err(401, 'invalid_key', 'That key is not valid.');
  END IF;

  v_hash := public.era__hash(p_key);
  SELECT * INTO k FROM public.era_api_keys WHERE key_hash = v_hash;
  IF NOT FOUND THEN
    IF v_ip IS NOT NULL THEN
      INSERT INTO public.era_api_usage (key_id, period, bucket, calls) VALUES (md5('f:' || v_ip)::UUID, 'f', public.era__bucket(60), 1)
      ON CONFLICT (key_id, period, bucket) DO UPDATE SET calls = public.era_api_usage.calls + 1;
    END IF;
    RETURN public.era__err(401, 'invalid_key', 'That key is not valid.');
  END IF;
  IF k.revoked_at IS NOT NULL THEN
    RETURN public.era__err(401, 'key_revoked', 'That key was revoked' || COALESCE(' (' || k.revoked_reason || ')', '') || '. Issue a new one.');
  END IF;
  IF k.expires_at IS NOT NULL AND k.expires_at <= now() THEN
    RETURN public.era__err(401, 'key_expired', 'That key has expired. Ask the business owner for a new one.');
  END IF;
  SELECT * INTO c FROM public.era_api_clients WHERE id = k.client_id;
  IF c.status IN ('rejected', 'suspended') THEN
    RETURN public.era__err(403, 'app_' || c.status, 'This app is ' || c.status || '. Contact the platform team.');
  END IF;
  IF k.mode = 'live' AND c.status <> 'approved' THEN
    RETURN public.era__err(403, 'live_not_approved', 'This app is not approved for live access.');
  END IF;
  v_sandbox := (k.mode = 'sandbox') OR (k.mode = 'business' AND k.test);
  v_modename := CASE WHEN k.mode = 'business' AND k.test THEN 'business-test' ELSE k.mode END;
  IF v_sandbox AND NOT s.sandbox_enabled THEN
    RETURN public.era__err(503, 'sandbox_disabled', 'The sandbox is switched off right now.');
  END IF;

  v_limit := COALESCE(k.rate_per_min, CASE WHEN v_sandbox THEN s.sandbox_rate_per_min ELSE c.live_rate_per_min END);
  v_quota := COALESCE(k.daily_quota,  CASE WHEN v_sandbox THEN s.sandbox_daily_quota  ELSE c.live_daily_quota  END);
  v_counter := CASE WHEN k.per_ip AND v_ip IS NOT NULL THEN md5(k.id::TEXT || ':' || v_ip)::UUID ELSE k.id END;

  INSERT INTO public.era_api_usage (key_id, period, bucket, calls) VALUES (v_counter, 'm', public.era__bucket(60), 1)
  ON CONFLICT (key_id, period, bucket) DO UPDATE SET calls = public.era_api_usage.calls + 1 RETURNING calls INTO v_m;
  INSERT INTO public.era_api_usage (key_id, period, bucket, calls) VALUES (v_counter, 'd', public.era__bucket(86400), 1)
  ON CONFLICT (key_id, period, bucket) DO UPDATE SET calls = public.era_api_usage.calls + 1 RETURNING calls INTO v_d;

  v_secs_min := GREATEST(1, CEIL(60 - (extract(epoch FROM now()) - extract(epoch FROM public.era__bucket(60))))::INTEGER);
  v_secs_day := GREATEST(1, CEIL(86400 - (extract(epoch FROM now()) - extract(epoch FROM public.era__bucket(86400))))::INTEGER);
  v_headers := jsonb_build_object(
    'x-ratelimit-limit', v_limit, 'x-ratelimit-remaining', GREATEST(v_limit - v_m, 0), 'x-ratelimit-reset', v_secs_min,
    'x-quota-limit', v_quota, 'x-quota-remaining', GREATEST(v_quota - v_d, 0),
    'x-era-mode', v_modename, 'x-request-id', v_rid);

  IF v_m > v_limit THEN
    INSERT INTO public.era_api_log (key_id, client_id, mode, endpoint, status, ms) VALUES (k.id, c.id, v_modename, NULL, 429, 0);
    RETURN public.era__err(429, 'rate_limited', format('Rate limit of %s requests per minute reached. Retry in %s s.', v_limit, v_secs_min),
                           v_headers || jsonb_build_object('retry-after', v_secs_min));
  END IF;
  IF v_d > v_quota THEN
    INSERT INTO public.era_api_log (key_id, client_id, mode, endpoint, status, ms) VALUES (k.id, c.id, v_modename, NULL, 429, 0);
    RETURN public.era__err(429, 'quota_exceeded', format('Daily quota of %s requests reached. It resets at 00:00 UTC.', v_quota),
                           v_headers || jsonb_build_object('retry-after', v_secs_day));
  END IF;

  IF v_method NOT IN ('GET', 'POST') THEN
    RETURN public.era__err(405, 'method_not_allowed', 'Use GET to read, or POST where an endpoint says so.', v_headers || jsonb_build_object('allow', 'GET, POST'));
  END IF;

  -- Route: same path, the right method.
  FOR ep IN SELECT * FROM public.era_api_endpoints ORDER BY sort, path LOOP
    v_path_params := public.era__match(ep.path, p_path);
    IF v_path_params IS NOT NULL THEN
      IF ep.method = v_method THEN v_found := TRUE; EXIT; END IF;
      v_other_method := TRUE;
    END IF;
  END LOOP;
  IF NOT v_found THEN
    INSERT INTO public.era_api_log (key_id, client_id, mode, endpoint, status, ms) VALUES (k.id, c.id, v_modename, NULL, CASE WHEN v_other_method THEN 405 ELSE 404 END, 0);
    IF v_other_method THEN
      RETURN public.era__err(405, 'method_not_allowed', 'That endpoint does not accept ' || v_method || '.', v_headers);
    END IF;
    RETURN public.era__err(404, 'unknown_endpoint', 'No such endpoint. See /api/v1/catalog for the list.', v_headers);
  END IF;
  IF NOT ep.enabled THEN
    RETURN public.era__err(503, 'endpoint_disabled', 'This endpoint is switched off for now.', v_headers);
  END IF;

  -- Access. Developer keys: the approved apps. Business keys: public data, plus exactly the scopes the owner ticked.
  IF ep.access = 'business' THEN
    IF k.mode <> 'business' THEN
      RETURN public.era__err(403, 'business_key_required',
        'This endpoint is private. It needs a business key issued by the business owner inside ICAN.', v_headers);
    END IF;
    IF NOT (ep.scope = ANY (k.scopes)) THEN
      RETURN public.era__err(403, 'scope_missing', format('This key does not have the "%s" scope.', ep.scope), v_headers);
    END IF;
    IF NOT v_sandbox AND k.business_profile_id IS NULL THEN
      RETURN public.era__err(403, 'key_not_bound', 'This key is not bound to a business.', v_headers);
    END IF;
  ELSIF ep.app <> 'platform' AND k.mode <> 'business' THEN
    v_apps := CASE WHEN k.mode = 'live' THEN c.granted_apps ELSE ARRAY['icanera','bodagoera','supermarketera','farmagentera'] END;
    IF NOT (ep.app = ANY (v_apps)) THEN
      RETURN public.era__err(403, 'scope_missing', format('Your key is not approved for %s. Ask for it at /developers.', ep.app), v_headers);
    END IF;
  END IF;
  v_apps := CASE WHEN k.mode = 'live' THEN c.granted_apps ELSE ARRAY['icanera','bodagoera','supermarketera','farmagentera'] END;

  -- POST: a small JSON object and an Idempotency-Key, so a retry can never create twice.
  IF ep.method = 'POST' THEN
    IF p_idem IS NULL OR p_idem !~ '^[A-Za-z0-9_-]{8,64}$' THEN
      RETURN public.era__err(400, 'idempotency_key_required',
        'Send an Idempotency-Key header (8 to 64 letters, digits, - or _). Reuse it when you retry the same request.', v_headers);
    END IF;
    v_body := CASE WHEN p_body IS NULL THEN '{}'::JSONB ELSE p_body END;
    IF jsonb_typeof(v_body) <> 'object' OR octet_length(v_body::TEXT) > 8192 THEN
      RETURN public.era__err(400, 'bad_body', 'Send a JSON object of at most 8 KB.', v_headers);
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(k.id::TEXT || ':' || p_idem, 0));
    v_reqhash := public.era__hash(ep.id || ':' || v_body::TEXT || ':' || v_path_params::TEXT);
    SELECT * INTO v_idem FROM public.era_api_idempotency WHERE key_id = k.id AND idem_key = p_idem;
    IF FOUND THEN
      IF v_idem.request_hash <> v_reqhash THEN
        RETURN public.era__err(422, 'idempotency_conflict', 'That Idempotency-Key was already used for a different request.', v_headers);
      END IF;
      RETURN public.era__resp(v_idem.status, v_idem.response, v_headers || jsonb_build_object('x-idempotent-replay', 'true'));
    END IF;
  END IF;

  -- Parameters: lower-case names, short values, no leading underscore (those are ours), path params win.
  IF jsonb_typeof(COALESCE(p_query, '{}'::JSONB)) = 'object' THEN
    FOR r IN SELECT key, value FROM jsonb_each_text(p_query) LIMIT 20 LOOP
      IF r.key ~ '^[a-z][a-z0-9_]{0,39}$' THEN
        v_params := v_params || jsonb_build_object(r.key, left(COALESCE(r.value, ''), 200));
      END IF;
    END LOOP;
  END IF;
  v_params := v_params || v_path_params || jsonb_build_object(
    '_mode', v_modename, '_apps', to_jsonb(v_apps), '_key_id', k.id, '_client_id', c.id, '_rate', v_limit, '_quota', v_quota,
    '_business_id', k.business_profile_id, '_owner_user_id', c.owner_user_id, '_scopes', to_jsonb(k.scopes),
    '_expires_at', k.expires_at, '_max_amount_ugx', k.max_amount_ugx, '_daily_cap_ugx', k.daily_cap_ugx,
    '_body', COALESCE(v_body, '{}'::JSONB));

  BEGIN
    EXECUTE format('SELECT %s($1, $2)', ep.handler) INTO v_data USING v_params, v_sandbox;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '22023' THEN v_status := 400; v_err_code := 'bad_request'; v_err_msg := SQLERRM;
    ELSIF SQLSTATE = 'P0002' THEN v_status := 404; v_err_code := 'not_found'; v_err_msg := SQLERRM;
    ELSIF SQLSTATE = 'ERA29' THEN v_status := 429; v_err_code := 'limit_reached'; v_err_msg := SQLERRM;
    ELSIF SQLSTATE = 'ERA22' THEN v_status := 422; v_err_code := 'not_allowed'; v_err_msg := SQLERRM;
    ELSIF SQLSTATE = '42501' THEN v_status := 403; v_err_code := 'forbidden'; v_err_msg := SQLERRM;
    ELSE
      v_status := 500; v_err_code := 'handler_error'; v_err_msg := 'Something went wrong on our side. It has been logged.';
      v_private_err := left(SQLSTATE || ': ' || SQLERRM, 300);
    END IF;
  END;

  v_ms := round(extract(epoch FROM clock_timestamp() - v_t0) * 1000)::INTEGER;
  IF NOT k.per_ip OR v_status >= 500 THEN
    INSERT INTO public.era_api_log (key_id, client_id, mode, endpoint, status, ms, error)
    VALUES (k.id, c.id, v_modename, ep.id, CASE WHEN v_status = 200 AND ep.method = 'POST' THEN 201 ELSE v_status END, v_ms, v_private_err);
  END IF;
  IF k.last_used_at IS NULL OR k.last_used_at < now() - INTERVAL '1 minute' THEN
    UPDATE public.era_api_keys SET last_used_at = now() WHERE id = k.id;
  END IF;
  IF random() < 0.004 THEN
    DELETE FROM public.era_api_log WHERE at < now() - INTERVAL '30 days';
    DELETE FROM public.era_api_usage
     WHERE (period IN ('m', 'f') AND bucket < now() - INTERVAL '3 hours') OR (period = 'd' AND bucket < now() - INTERVAL '40 days');
    DELETE FROM public.era_api_idempotency WHERE created_at < now() - INTERVAL '24 hours';
  END IF;

  IF v_status <> 200 THEN
    RETURN public.era__err(v_status, v_err_code, v_err_msg, v_headers);
  END IF;
  IF ep.cache_seconds > 0 AND ep.method = 'GET' THEN
    v_headers := v_headers || jsonb_build_object('cache-control', format('private, max-age=%s', ep.cache_seconds));
  END IF;
  v_resp := jsonb_build_object(
    'data', COALESCE(v_data, 'null'::JSONB),
    'meta', jsonb_build_object('app', ep.app, 'endpoint', ep.id, 'mode', v_modename, 'request_id', v_rid, 'ms', v_ms,
                               'count', CASE WHEN jsonb_typeof(v_data) = 'array' THEN jsonb_array_length(v_data) END));
  IF ep.method = 'POST' THEN
    INSERT INTO public.era_api_idempotency (key_id, idem_key, request_hash, status, response)
    VALUES (k.id, p_idem, v_reqhash, 201, v_resp);
    INSERT INTO public.era_api_audit (actor, action, client_id, detail)
    VALUES (NULL, 'api_write', c.id, jsonb_build_object('endpoint', ep.id, 'key', k.prefix, 'business', k.business_profile_id, 'request_id', v_rid));
    RETURN public.era__resp(201, v_resp, v_headers);
  END IF;
  RETURN public.era__resp(200, v_resp, v_headers);
END;
$$;

-- ---------------------------------------------------------------------------- a published BUSINESS sandbox key
-- Like the developer playground key: public on the developer page, fixtures only, limited per visitor. It lets anyone try the
-- private endpoints (payment requests, inventory, CMMS, bookings) with realistic sample data and no real business behind it.
INSERT INTO public.era_api_clients (id, app_name, contact_email, status, kind, granted_apps, requested_apps, ticket_hash, is_system, review_note)
VALUES ('00000000-0000-4000-8000-00000000e7a2', 'Public business playground', 'playground@era-api.invalid', 'approved', 'owner',
        ARRAY['icanera','bodagoera','supermarketera','farmagentera'], '{}',
        public.era__hash('system-business-playground-' || gen_random_uuid()::TEXT), TRUE,
        'Built in. Fixtures only: its key is public on the developer page.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.era_api_keys (client_id, mode, prefix, key_hash, label, rate_per_min, daily_quota, per_ip, scopes, test, max_amount_ugx, daily_cap_ugx)
VALUES ('00000000-0000-4000-8000-00000000e7a2', 'business', 'era_bzt_5c1e7a90b',
        public.era__hash('era_bzt_5c1e7a90b3d24f68a1e0c7d95b2f4a86d3e1c0b7'), 'public business playground key', 20, 300, TRUE,
        public.era__valid_scopes(), TRUE, 1000000, 5000000)
ON CONFLICT (key_hash) DO NOTHING;

-- ---------------------------------------------------------------------------- grants
DO $$
DECLARE f RECORD;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND (p.proname LIKE 'era\_api\_%' OR p.proname LIKE 'era\_\_%' OR p.proname LIKE 'era\_h\_%' OR p.proname LIKE 'era\_p\_%') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
  END LOOP;
END $$;

-- anyone: the catalogue and the gateway entry point (the gateway may also call these as the service role)
GRANT EXECUTE ON FUNCTION public.era_api_public_info()                                                          TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.era_api_catalog()                                                              TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.era_api_request_access(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], TEXT, TEXT)      TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.era_api_ticket_status(TEXT)                                                    TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.era_api_issue_key(TEXT, TEXT)                                                  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.era_api_call(TEXT, TEXT, TEXT, JSONB, TEXT, JSONB, TEXT)                      TO anon, authenticated, service_role;

-- signed-in accounts: business owners manage their own keys; customers open and confirm booking links
GRANT EXECUTE ON FUNCTION public.era_api_owner_businesses()                                                     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.era_api_owner_create_key(UUID, TEXT, TEXT[], INTEGER, BOOLEAN, NUMERIC, NUMERIC) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.era_api_owner_list_keys(UUID)                                                  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.era_api_owner_revoke_key(UUID)                                                 TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.era_api_owner_activity(UUID, INTEGER)                                          TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.era_api_booking_intent_get(TEXT)                                               TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.era_api_booking_intent_link(TEXT, UUID)                                        TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.era_api_booking_intent_cancel(TEXT)                                            TO authenticated, service_role;

-- administrators (the functions re-check the account)
GRANT EXECUTE ON FUNCTION public.era_api_is_admin()                                                             TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.era_api_admin_overview()                                                       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.era_api_admin_list_clients(TEXT, INTEGER)                                      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.era_api_admin_review(UUID, TEXT, TEXT[], INTEGER, INTEGER, TEXT)              TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.era_api_admin_revoke_key(UUID, TEXT)                                           TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.era_api_admin_list_endpoints()                                                 TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.era_api_admin_set_endpoint(TEXT, BOOLEAN, INTEGER)                             TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.era_api_admin_save_settings(JSONB)                                             TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.era_api_admin_recent_calls(UUID, INTEGER)                                      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.era_api_admin_get_chain()                                                      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.era_api_admin_save_chain(TEXT, NUMERIC, NUMERIC, TEXT)                         TO authenticated, service_role;

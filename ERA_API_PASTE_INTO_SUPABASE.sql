-- ============================================================================
-- ERA API: paste this WHOLE file into the Supabase SQL editor and press Run. Once.
--
-- It is the 4 migrations in the right order:
--   1. 20261005100000_era_api.sql
--        core: tables, keys, limits, sandbox, sign-up, admin
--   2. 20261005100100_era_api_endpoints.sql
--        the public endpoints (coins, FX, tax, boda, stores, farms)
--   3. 20261006100000_era_api_business.sql
--        business layer: owner keys and scopes, payment and booking requests, gas, idempotency
--   4. 20261006100100_era_api_business_endpoints.sql
--        valuation, supply, gas, journey quotes, product catalogue, and the business endpoints (inventory with expiry, CMMS, payments, bookings)
--
-- Safe to run twice. Changes nothing that exists today: it only ADDS era_api_* tables and era_* functions
-- (and a few nullable columns on those tables). It never touches wallets, payments, rides or stock.
-- Already ran an earlier version of this file? Run this one anyway: parts 1 and 2 are no-ops and 3 and 4 add the new layer.
-- To undo everything: supabase/rollback/20261005_rollback_era_api.sql
--
-- After it runs:
--   * open https://icanera.space/developers/ and press Send
--   * business owners mint their own keys in ICAN: Business > Administration > Developer API
--   * make yourself an API admin ONLY if you are not already a platform developer or franchise admin:
--       INSERT INTO public.era_api_admins (user_id, note)
--       SELECT id, 'founder' FROM auth.users WHERE lower(email) = lower('YOUR-EMAIL');
-- ============================================================================

-- ################################ PART 1 of 4: 20261005100000_era_api.sql ################################
-- ============================================================================
-- ERA API: one public, key-based, read-only API across the whole ICANERA family
-- (ICANERA, BodaGoEra, SupermarketEra, FarmAgentEra). They share this Supabase project, so one key,
-- one registry and one set of limits serve all four.
--
--   outsider  -->  /api/v1/...  (Vercel function in every app)  -->  era_api_call()  -->  endpoint handler
--
-- Everything that matters lives here, in the database, so it is testable without a server:
--   * keys are stored only as SHA-256 hashes; a key is shown once, when it is issued
--   * every key has a mode: SANDBOX (fixture data, never touches real rows, instant) or LIVE (needs approval)
--   * per-key rate limit (per minute) and daily quota, counted atomically
--   * an endpoint registry (the docs, the OpenAPI file and the kill switches all read it)
--   * the browser can never read or write these tables: only the functions below, which check who is asking
--
-- Companion file: 20261005100100_era_api_endpoints.sql (the endpoint handlers and their registry rows).
-- Merging the code is safe on its own: until this migration is applied the developer page says the API is
-- "not switched on yet" and the dev panel tab says the same. Additive and safe to run twice.
-- Rollback: supabase/rollback/20261005_rollback_era_api.sql
-- ============================================================================

-- ---------------------------------------------------------------------------- tables

CREATE TABLE IF NOT EXISTS public.era_api_settings (
  id                     BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  enabled                BOOLEAN NOT NULL DEFAULT TRUE,    -- master kill switch: off => every call answers 503
  sandbox_enabled        BOOLEAN NOT NULL DEFAULT TRUE,
  signups_open           BOOLEAN NOT NULL DEFAULT TRUE,    -- the public "get a key" form
  sandbox_rate_per_min   INTEGER NOT NULL DEFAULT 30  CHECK (sandbox_rate_per_min BETWEEN 1 AND 6000),
  sandbox_daily_quota    INTEGER NOT NULL DEFAULT 1000 CHECK (sandbox_daily_quota BETWEEN 1 AND 1000000),
  updated_by             UUID,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.era_api_settings (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.era_api_admins (
  user_id   UUID PRIMARY KEY,
  note      TEXT,
  added_by  UUID,
  added_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.era_api_clients (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_name            TEXT NOT NULL CHECK (char_length(app_name) BETWEEN 2 AND 80),
  contact_name        TEXT CHECK (char_length(contact_name) <= 80),
  contact_email       TEXT NOT NULL CHECK (char_length(contact_email) <= 254),
  website             TEXT CHECK (char_length(website) <= 200),
  description         TEXT CHECK (char_length(description) <= 600),
  requested_apps      TEXT[] NOT NULL DEFAULT '{}',
  granted_apps        TEXT[] NOT NULL DEFAULT '{}',
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'suspended')),
  live_rate_per_min   INTEGER NOT NULL DEFAULT 60    CHECK (live_rate_per_min BETWEEN 1 AND 6000),
  live_daily_quota    INTEGER NOT NULL DEFAULT 5000  CHECK (live_daily_quota BETWEEN 1 AND 1000000),
  ticket_hash         TEXT NOT NULL UNIQUE,           -- the developer's "ticket": their only credential for status and keys
  ip_hash             TEXT,
  is_system           BOOLEAN NOT NULL DEFAULT FALSE, -- built-in clients (the public playground)
  review_note         TEXT,
  reviewed_by         UUID,
  reviewed_at         TIMESTAMPTZ,
  live_key_claimed_at TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS era_api_clients_status_idx ON public.era_api_clients (status, created_at DESC);
CREATE INDEX IF NOT EXISTS era_api_clients_email_idx  ON public.era_api_clients (lower(contact_email), created_at DESC);
CREATE INDEX IF NOT EXISTS era_api_clients_ip_idx     ON public.era_api_clients (ip_hash, created_at DESC) WHERE ip_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.era_api_keys (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      UUID NOT NULL REFERENCES public.era_api_clients(id) ON DELETE CASCADE,
  mode           TEXT NOT NULL CHECK (mode IN ('sandbox', 'live')),
  prefix         TEXT NOT NULL,                       -- first characters, so a person can tell keys apart
  key_hash       TEXT NOT NULL UNIQUE,                -- sha256 hex of the whole key; the key itself is never stored
  label          TEXT,
  rate_per_min   INTEGER CHECK (rate_per_min BETWEEN 1 AND 6000),    -- overrides the client / settings value
  daily_quota    INTEGER CHECK (daily_quota BETWEEN 1 AND 1000000),
  per_ip         BOOLEAN NOT NULL DEFAULT FALSE,      -- count limits per caller (used by the public playground key)
  revoked_at     TIMESTAMPTZ,
  revoked_reason TEXT,
  last_used_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS era_api_keys_client_idx ON public.era_api_keys (client_id, created_at DESC);

-- The endpoint registry. The docs page, the OpenAPI file and the per-endpoint kill switches all read this.
CREATE TABLE IF NOT EXISTS public.era_api_endpoints (
  id            TEXT PRIMARY KEY CHECK (id ~ '^[a-z]+\.[a-z0-9_]+$'),
  app           TEXT NOT NULL CHECK (app IN ('platform', 'icanera', 'bodagoera', 'supermarketera', 'farmagentera')),
  method        TEXT NOT NULL DEFAULT 'GET' CHECK (method = 'GET'),   -- v1 is read-only on purpose
  path          TEXT NOT NULL CHECK (path ~ '^/[a-z0-9_/{}-]+$'),
  summary       TEXT NOT NULL,
  description   TEXT,
  params        JSONB NOT NULL DEFAULT '[]'::JSONB,
  example_path  TEXT,
  handler       TEXT NOT NULL CHECK (handler ~ '^public\.era_h_[a-z0-9_]+$'),  -- also what keeps dispatch injection-proof
  enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  cache_seconds INTEGER NOT NULL DEFAULT 30 CHECK (cache_seconds BETWEEN 0 AND 3600),
  sort          INTEGER NOT NULL DEFAULT 100,
  UNIQUE (method, path)
);

-- Counters: 'm' = per minute, 'd' = per UTC day, 'f' = failed-key attempts per minute (per caller).
CREATE TABLE IF NOT EXISTS public.era_api_usage (
  key_id  UUID NOT NULL,
  period  TEXT NOT NULL CHECK (period IN ('m', 'd', 'f')),
  bucket  TIMESTAMPTZ NOT NULL,
  calls   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key_id, period, bucket)
);
CREATE INDEX IF NOT EXISTS era_api_usage_bucket_idx ON public.era_api_usage (bucket);

CREATE TABLE IF NOT EXISTS public.era_api_log (
  id        BIGSERIAL PRIMARY KEY,
  at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  key_id    UUID,
  client_id UUID,
  mode      TEXT,
  endpoint  TEXT,
  status    INTEGER NOT NULL,
  ms        INTEGER,
  error     TEXT                                      -- only ever shown to administrators
);
CREATE INDEX IF NOT EXISTS era_api_log_at_idx     ON public.era_api_log (at DESC);
CREATE INDEX IF NOT EXISTS era_api_log_client_idx ON public.era_api_log (client_id, at DESC);

CREATE TABLE IF NOT EXISTS public.era_api_audit (
  id        BIGSERIAL PRIMARY KEY,
  at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor     UUID,
  action    TEXT NOT NULL,
  client_id UUID,
  detail    JSONB NOT NULL DEFAULT '{}'::JSONB
);

-- Nothing here is readable or writable from the browser. Only the SECURITY DEFINER functions below touch these.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['era_api_settings','era_api_admins','era_api_clients','era_api_keys','era_api_endpoints',
                           'era_api_usage','era_api_log','era_api_audit'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', t);
  END LOOP;
END $$;
REVOKE ALL ON SEQUENCE public.era_api_log_id_seq, public.era_api_audit_id_seq FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------- small helpers (internal)

CREATE OR REPLACE FUNCTION public.era__hash(p_text TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$ SELECT encode(sha256(convert_to(COALESCE(p_text, ''), 'UTF8')), 'hex') $$;

-- n random hex characters (gen_random_uuid is a CSPRNG; two of them give 64 hex characters)
CREATE OR REPLACE FUNCTION public.era__rand(p_len INTEGER) RETURNS TEXT
LANGUAGE sql VOLATILE AS $$
  SELECT left(replace(gen_random_uuid()::TEXT || gen_random_uuid()::TEXT, '-', ''), LEAST(GREATEST(p_len, 1), 64))
$$;

CREATE OR REPLACE FUNCTION public.era__resp(p_status INTEGER, p_body JSONB, p_headers JSONB DEFAULT '{}'::JSONB)
RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('status', p_status, 'body', p_body, 'headers', COALESCE(p_headers, '{}'::JSONB))
$$;

CREATE OR REPLACE FUNCTION public.era__err(p_status INTEGER, p_code TEXT, p_msg TEXT, p_headers JSONB DEFAULT '{}'::JSONB)
RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
  SELECT public.era__resp(p_status,
    jsonb_build_object('error', jsonb_build_object('code', p_code, 'message', p_msg, 'status', p_status)), p_headers)
$$;

-- Does a request path fit a registry pattern like /icanera/tax/{country}? Returns the path params, or NULL.
CREATE OR REPLACE FUNCTION public.era__match(p_pattern TEXT, p_path TEXT) RETURNS JSONB
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  a TEXT[] := string_to_array(btrim(COALESCE(p_pattern, ''), '/'), '/');
  b TEXT[] := string_to_array(btrim(COALESCE(p_path, ''), '/'), '/');
  i INTEGER;
  out JSONB := '{}'::JSONB;
BEGIN
  IF a IS NULL OR b IS NULL OR array_length(a, 1) IS NULL OR array_length(b, 1) IS NULL THEN RETURN NULL; END IF;
  IF array_length(a, 1) <> array_length(b, 1) THEN RETURN NULL; END IF;
  FOR i IN 1..array_length(a, 1) LOOP
    IF a[i] ~ '^\{[a-z_]+\}$' THEN
      IF b[i] = '' THEN RETURN NULL; END IF;
      out := out || jsonb_build_object(substr(a[i], 2, length(a[i]) - 2), left(b[i], 120));
    ELSIF lower(a[i]) <> lower(b[i]) THEN
      RETURN NULL;
    END IF;
  END LOOP;
  RETURN out;
END;
$$;

-- Unix-time bucket starts (independent of any session time zone)
CREATE OR REPLACE FUNCTION public.era__bucket(p_seconds INTEGER) RETURNS TIMESTAMPTZ
LANGUAGE sql STABLE AS $$ SELECT to_timestamp(floor(extract(epoch FROM now()) / p_seconds) * p_seconds) $$;

-- ---------------------------------------------------------------------------- who is an administrator

CREATE OR REPLACE FUNCTION public.era__is_service() RETURNS BOOLEAN
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE(
           NULLIF(current_setting('request.jwt.claim.role', true), ''),
           NULLIF(current_setting('request.jwt.claims', true), '')::JSONB ->> 'role',
           '') = 'service_role';
$$;

-- A REAL signed-in account that is an API admin, a franchise admin, or a platform developer.
-- (The developer panel's PIN ships inside the public app, so it is never accepted for this.)
CREATE OR REPLACE FUNCTION public.era_api_is_admin() RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_ok BOOLEAN := FALSE;
BEGIN
  IF public.era__is_service() THEN RETURN TRUE; END IF;
  IF v_uid IS NULL THEN RETURN FALSE; END IF;
  IF EXISTS (SELECT 1 FROM public.era_api_admins a WHERE a.user_id = v_uid) THEN RETURN TRUE; END IF;
  -- The two optional sources are queried dynamically: Postgres resolves every table named in a static statement when it
  -- plans it, so a database without one of them (a project that never ran the franchise migration, say) would otherwise
  -- fail here even though the guard is false.
  IF to_regclass('public.ican_franchise_admins') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.ican_franchise_admins WHERE user_id = $1)' INTO v_ok USING v_uid;
    IF v_ok THEN RETURN TRUE; END IF;
  END IF;
  IF to_regclass('public.mbg_users') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.mbg_users mu WHERE mu.id = $1 AND mu.role_type::TEXT = ''developer'' AND mu.is_active = TRUE)'
      INTO v_ok USING v_uid;
    RETURN COALESCE(v_ok, FALSE);
  END IF;
  RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION public.era__require_admin() RETURNS VOID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.era_api_is_admin() THEN
    RAISE EXCEPTION 'API administration is restricted to the platform developers' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------- built-in client: the public playground
-- A sandbox-only key that is PUBLISHED on the developer page, so anyone can try the API with zero sign-up.
-- It only ever returns fixture data, and it is rate limited per caller (per_ip), so it exposes nothing and one
-- visitor cannot starve another.
INSERT INTO public.era_api_clients (id, app_name, contact_email, status, granted_apps, requested_apps, ticket_hash, is_system, review_note)
VALUES ('00000000-0000-4000-8000-00000000e7a1', 'Public playground', 'playground@era-api.invalid', 'approved',
        ARRAY['icanera','bodagoera','supermarketera','farmagentera'], ARRAY['icanera','bodagoera','supermarketera','farmagentera'],
        public.era__hash('system-playground-' || gen_random_uuid()::TEXT), TRUE,
        'Built in. Sandbox only: its key is public on the developer page.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.era_api_keys (client_id, mode, prefix, key_hash, label, rate_per_min, daily_quota, per_ip)
VALUES ('00000000-0000-4000-8000-00000000e7a1', 'sandbox', 'era_test_9a8d0e2b',
        public.era__hash('era_test_9a8d0e2b7f4c1a63d5e8b0f2c47a91d3e6b85f0c'), 'public playground key', 20, 300, TRUE)
ON CONFLICT (key_hash) DO NOTHING;

-- ---------------------------------------------------------------------------- public: info, catalog

CREATE OR REPLACE FUNCTION public.era_api_public_info() RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.era_api_settings;
BEGIN
  SELECT * INTO s FROM public.era_api_settings WHERE id;
  RETURN jsonb_build_object(
    'api', 'era', 'version', 'v1',
    'enabled', COALESCE(s.enabled, FALSE),
    'sandbox_enabled', COALESCE(s.sandbox_enabled, FALSE),
    'signups_open', COALESCE(s.signups_open, FALSE),
    'endpoints', (SELECT COUNT(*) FROM public.era_api_endpoints WHERE enabled),
    'sandbox_limits', jsonb_build_object('per_minute', s.sandbox_rate_per_min, 'per_day', s.sandbox_daily_quota),
    'server_time', now());
END;
$$;

CREATE OR REPLACE FUNCTION public.era_api_catalog() RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN jsonb_build_object(
    'version', 'v1',
    'apps', jsonb_build_array(
      jsonb_build_object('id', 'platform',       'name', 'Platform',       'tagline', 'Who you are, how much you have left, and one call that sees the whole family.'),
      jsonb_build_object('id', 'icanera',        'name', 'ICANERA',        'tagline', 'Coin price, candles, FX, tax rules and the public business directory.'),
      jsonb_build_object('id', 'bodagoera',      'name', 'BodaGoEra',      'tagline', 'Stages, districts, ports, fare estimates and rider-card checks.'),
      jsonb_build_object('id', 'supermarketera', 'name', 'SupermarketEra', 'tagline', 'Stores, a product catalogue and barcode lookups.'),
      jsonb_build_object('id', 'farmagentera',   'name', 'FarmAgentEra',   'tagline', 'Marketplace listings, a produce price board and crop knowledge.')),
    'endpoints', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', e.id, 'app', e.app, 'method', e.method, 'path', e.path, 'summary', e.summary,
               'description', e.description, 'params', e.params, 'example_path', e.example_path,
               'cache_seconds', e.cache_seconds) ORDER BY e.sort, e.path)
        FROM public.era_api_endpoints e WHERE e.enabled), '[]'::JSONB));
END;
$$;

-- ---------------------------------------------------------------------------- public: get a key

-- Open to anyone, no account. Creates the app in "pending", and hands back (shown ONCE):
--   * a ticket: the developer's only credential for checking status and for issuing or rotating keys
--   * an instant sandbox key
-- Live access then waits for a person to approve it in the developer panel.
CREATE OR REPLACE FUNCTION public.era_api_request_access(
  p_app_name TEXT, p_contact_name TEXT, p_contact_email TEXT, p_website TEXT, p_description TEXT,
  p_apps TEXT[], p_ip_hash TEXT DEFAULT NULL, p_hp TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s public.era_api_settings;
  v_name TEXT := btrim(COALESCE(p_app_name, ''));
  v_email TEXT := lower(btrim(COALESCE(p_contact_email, '')));
  v_site TEXT := NULLIF(btrim(COALESCE(p_website, '')), '');
  v_desc TEXT := NULLIF(btrim(COALESCE(p_description, '')), '');
  v_contact TEXT := NULLIF(btrim(COALESCE(p_contact_name, '')), '');
  v_apps TEXT[];
  v_ticket TEXT;
  v_key TEXT;
  v_client UUID;
  v_ip TEXT := NULLIF(left(COALESCE(p_ip_hash, ''), 128), '');
BEGIN
  -- A bot that fills the hidden field gets a believable answer and nothing is stored.
  IF NULLIF(btrim(COALESCE(p_hp, '')), '') IS NOT NULL THEN
    RETURN jsonb_build_object('client_id', gen_random_uuid(), 'status', 'pending',
      'ticket', 'era_tk_' || public.era__rand(40),
      'sandbox_key', jsonb_build_object('key', 'era_test_' || public.era__rand(40), 'prefix', 'era_test_xxxxxxxx'),
      'apps', to_jsonb(ARRAY[]::TEXT[]));
  END IF;

  SELECT * INTO s FROM public.era_api_settings WHERE id;
  IF NOT COALESCE(s.enabled, FALSE) OR NOT COALESCE(s.signups_open, FALSE) THEN
    RAISE EXCEPTION 'New developer sign-ups are paused right now. Try again later.' USING ERRCODE = 'ERA29';
  END IF;

  IF char_length(v_name) < 2 OR char_length(v_name) > 80 THEN
    RAISE EXCEPTION 'Give your app a name (2 to 80 characters).' USING ERRCODE = '22023';
  END IF;
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' OR char_length(v_email) > 254 THEN
    RAISE EXCEPTION 'That email address does not look right.' USING ERRCODE = '22023';
  END IF;
  IF v_site IS NOT NULL AND (v_site !~* '^https?://[^\s]+$' OR char_length(v_site) > 200) THEN
    RAISE EXCEPTION 'The website must start with http:// or https://' USING ERRCODE = '22023';
  END IF;
  IF v_desc IS NOT NULL AND char_length(v_desc) > 600 THEN
    RAISE EXCEPTION 'Keep the description under 600 characters.' USING ERRCODE = '22023';
  END IF;
  IF v_contact IS NOT NULL AND char_length(v_contact) > 80 THEN
    RAISE EXCEPTION 'That name is too long.' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT a ORDER BY a), '{}') INTO v_apps
    FROM unnest(COALESCE(p_apps, '{}')) a
   WHERE a IN ('icanera', 'bodagoera', 'supermarketera', 'farmagentera');
  IF array_length(v_apps, 1) IS NULL THEN
    RAISE EXCEPTION 'Pick at least one of the four apps.' USING ERRCODE = '22023';
  END IF;

  -- Abuse limits: 3 per email per day, 8 per caller per day, 100 per hour overall.
  IF (SELECT COUNT(*) FROM public.era_api_clients WHERE lower(contact_email) = v_email AND created_at > now() - INTERVAL '1 day' AND NOT is_system) >= 3
     OR (v_ip IS NOT NULL AND (SELECT COUNT(*) FROM public.era_api_clients WHERE ip_hash = v_ip AND created_at > now() - INTERVAL '1 day') >= 8)
     OR (SELECT COUNT(*) FROM public.era_api_clients WHERE created_at > now() - INTERVAL '1 hour' AND NOT is_system) >= 100 THEN
    RAISE EXCEPTION 'Too many sign-ups from here. Please try again tomorrow.' USING ERRCODE = 'ERA29';
  END IF;

  v_ticket := 'era_tk_' || public.era__rand(40);
  v_key := 'era_test_' || public.era__rand(40);

  INSERT INTO public.era_api_clients (app_name, contact_name, contact_email, website, description, requested_apps, ticket_hash, ip_hash)
  VALUES (v_name, v_contact, v_email, v_site, v_desc, v_apps, public.era__hash(v_ticket), v_ip)
  RETURNING id INTO v_client;

  INSERT INTO public.era_api_keys (client_id, mode, prefix, key_hash, label)
  VALUES (v_client, 'sandbox', left(v_key, 17), public.era__hash(v_key), 'first sandbox key');

  RETURN jsonb_build_object(
    'client_id', v_client, 'status', 'pending', 'apps', to_jsonb(v_apps),
    'ticket', v_ticket,
    'sandbox_key', jsonb_build_object('key', v_key, 'prefix', left(v_key, 17)));
END;
$$;

-- Everything a developer may see about their own app, found by ticket. Never returns a key.
CREATE OR REPLACE FUNCTION public.era_api_ticket_status(p_ticket TEXT) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.era_api_clients;
BEGIN
  IF p_ticket IS NULL OR p_ticket !~ '^era_tk_[0-9a-f]{40}$' THEN
    RAISE EXCEPTION 'That ticket is not valid.' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO c FROM public.era_api_clients WHERE ticket_hash = public.era__hash(p_ticket) AND NOT is_system;
  IF NOT FOUND THEN RAISE EXCEPTION 'That ticket is not valid.' USING ERRCODE = 'P0002'; END IF;
  RETURN jsonb_build_object(
    'client_id', c.id, 'app_name', c.app_name, 'status', c.status,
    'requested_apps', to_jsonb(c.requested_apps), 'granted_apps', to_jsonb(c.granted_apps),
    'review_note', CASE WHEN c.status IN ('rejected', 'approved') THEN c.review_note END,
    'can_issue_live', c.status = 'approved',
    'live_key_claimed', c.live_key_claimed_at IS NOT NULL,
    'limits', jsonb_build_object('live_per_minute', c.live_rate_per_min, 'live_per_day', c.live_daily_quota),
    'created_at', c.created_at,
    'keys', COALESCE((SELECT jsonb_agg(jsonb_build_object(
              'prefix', k.prefix, 'mode', k.mode, 'created_at', k.created_at, 'last_used_at', k.last_used_at,
              'revoked', k.revoked_at IS NOT NULL) ORDER BY k.created_at DESC)
             FROM public.era_api_keys k WHERE k.client_id = c.id), '[]'::JSONB),
    'calls_24h', (SELECT COUNT(*) FROM public.era_api_log l WHERE l.client_id = c.id AND l.at > now() - INTERVAL '24 hours'));
END;
$$;

-- Issue (or rotate) a key. The plaintext is returned here and is never recoverable afterwards.
--   sandbox: always available, replaces the previous sandbox key
--   live:    only once an administrator has approved the app, replaces the previous live key
CREATE OR REPLACE FUNCTION public.era_api_issue_key(p_ticket TEXT, p_mode TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c public.era_api_clients;
  v_key TEXT;
BEGIN
  IF p_mode NOT IN ('sandbox', 'live') THEN
    RAISE EXCEPTION 'Mode must be sandbox or live.' USING ERRCODE = '22023';
  END IF;
  IF p_ticket IS NULL OR p_ticket !~ '^era_tk_[0-9a-f]{40}$' THEN
    RAISE EXCEPTION 'That ticket is not valid.' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO c FROM public.era_api_clients WHERE ticket_hash = public.era__hash(p_ticket) AND NOT is_system FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That ticket is not valid.' USING ERRCODE = 'P0002'; END IF;

  IF c.status IN ('rejected', 'suspended') THEN
    RAISE EXCEPTION 'This app is %; keys cannot be issued.', c.status USING ERRCODE = '42501';
  END IF;
  IF p_mode = 'live' AND c.status <> 'approved' THEN
    RAISE EXCEPTION 'Live access has not been approved yet. Your sandbox key works in the meantime.' USING ERRCODE = '42501';
  END IF;
  IF (SELECT COUNT(*) FROM public.era_api_keys WHERE client_id = c.id AND created_at > now() - INTERVAL '1 hour') >= 6 THEN
    RAISE EXCEPTION 'You have rotated keys a lot in the last hour. Wait a little.' USING ERRCODE = 'ERA29';
  END IF;

  UPDATE public.era_api_keys SET revoked_at = now(), revoked_reason = 'rotated'
   WHERE client_id = c.id AND mode = p_mode AND revoked_at IS NULL;

  v_key := CASE p_mode WHEN 'live' THEN 'era_live_' ELSE 'era_test_' END || public.era__rand(40);
  INSERT INTO public.era_api_keys (client_id, mode, prefix, key_hash, label)
  VALUES (c.id, p_mode, left(v_key, 17), public.era__hash(v_key), p_mode || ' key');

  IF p_mode = 'live' AND c.live_key_claimed_at IS NULL THEN
    UPDATE public.era_api_clients SET live_key_claimed_at = now(), updated_at = now() WHERE id = c.id;
  END IF;
  INSERT INTO public.era_api_audit (actor, action, client_id, detail)
  VALUES (NULL, 'key_issued', c.id, jsonb_build_object('mode', p_mode, 'prefix', left(v_key, 17)));

  RETURN jsonb_build_object('mode', p_mode, 'key', v_key, 'prefix', left(v_key, 17),
                            'note', 'Copy it now. For your safety it is never shown again.');
END;
$$;

-- ---------------------------------------------------------------------------- the gateway entry point

-- One call per API request. The Vercel function passes the key it was sent (never logged), the path and the query.
-- Returns {status, headers, body}; the function just relays it. Errors never leak SQL text.
CREATE OR REPLACE FUNCTION public.era_api_call(
  p_key TEXT, p_method TEXT, p_path TEXT, p_query JSONB DEFAULT '{}'::JSONB, p_ip_hash TEXT DEFAULT NULL)
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
BEGIN
  SELECT * INTO s FROM public.era_api_settings WHERE id;
  IF NOT COALESCE(s.enabled, FALSE) THEN
    RETURN public.era__err(503, 'api_disabled', 'The ICANERA API is switched off right now.');
  END IF;

  -- Throttle callers that keep sending bad keys (guessing).
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
  IF p_key !~ '^era_(live|test)_[0-9a-f]{40}$' THEN
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
    RETURN public.era__err(401, 'key_revoked', 'That key was revoked' || COALESCE(' (' || k.revoked_reason || ')', '') || '. Issue a new one at /developers.');
  END IF;
  SELECT * INTO c FROM public.era_api_clients WHERE id = k.client_id;
  IF c.status IN ('rejected', 'suspended') THEN
    RETURN public.era__err(403, 'app_' || c.status, 'This app is ' || c.status || '. Contact the platform team.');
  END IF;
  IF k.mode = 'live' AND c.status <> 'approved' THEN
    RETURN public.era__err(403, 'live_not_approved', 'This app is not approved for live access.');
  END IF;
  IF k.mode = 'sandbox' AND NOT s.sandbox_enabled THEN
    RETURN public.era__err(503, 'sandbox_disabled', 'The sandbox is switched off right now.');
  END IF;

  -- Rate limit and daily quota, counted atomically. Counted BEFORE routing so scanning for paths costs quota too.
  v_limit := COALESCE(k.rate_per_min, CASE k.mode WHEN 'live' THEN c.live_rate_per_min ELSE s.sandbox_rate_per_min END);
  v_quota := COALESCE(k.daily_quota,  CASE k.mode WHEN 'live' THEN c.live_daily_quota  ELSE s.sandbox_daily_quota  END);
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
    'x-era-mode', k.mode, 'x-request-id', v_rid);

  IF v_m > v_limit THEN
    INSERT INTO public.era_api_log (key_id, client_id, mode, endpoint, status, ms) VALUES (k.id, c.id, k.mode, NULL, 429, 0);
    RETURN public.era__err(429, 'rate_limited', format('Rate limit of %s requests per minute reached. Retry in %s s.', v_limit, v_secs_min),
                           v_headers || jsonb_build_object('retry-after', v_secs_min));
  END IF;
  IF v_d > v_quota THEN
    INSERT INTO public.era_api_log (key_id, client_id, mode, endpoint, status, ms) VALUES (k.id, c.id, k.mode, NULL, 429, 0);
    RETURN public.era__err(429, 'quota_exceeded', format('Daily quota of %s requests reached. It resets at 00:00 UTC.', v_quota),
                           v_headers || jsonb_build_object('retry-after', v_secs_day));
  END IF;

  -- Route.
  IF v_method <> 'GET' THEN
    RETURN public.era__err(405, 'method_not_allowed', 'v1 is read-only: use GET.', v_headers || jsonb_build_object('allow', 'GET'));
  END IF;
  FOR ep IN SELECT * FROM public.era_api_endpoints WHERE method = 'GET' ORDER BY sort, path LOOP
    v_path_params := public.era__match(ep.path, p_path);
    IF v_path_params IS NOT NULL THEN v_found := TRUE; EXIT; END IF;
  END LOOP;
  IF NOT v_found THEN
    INSERT INTO public.era_api_log (key_id, client_id, mode, endpoint, status, ms) VALUES (k.id, c.id, k.mode, NULL, 404, 0);
    RETURN public.era__err(404, 'unknown_endpoint', 'No such endpoint. See /api/v1/catalog for the list.', v_headers);
  END IF;
  IF NOT ep.enabled THEN
    RETURN public.era__err(503, 'endpoint_disabled', 'This endpoint is switched off for now.', v_headers);
  END IF;

  -- Scope: a live key sees only the apps the administrator approved. Sandbox sees all (fixtures only).
  v_apps := CASE WHEN k.mode = 'live' THEN c.granted_apps ELSE ARRAY['icanera','bodagoera','supermarketera','farmagentera'] END;
  IF ep.app <> 'platform' AND NOT (ep.app = ANY (v_apps)) THEN
    RETURN public.era__err(403, 'scope_missing',
      format('Your key is not approved for %s. Ask for it at /developers.', ep.app), v_headers);
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
    '_mode', k.mode, '_apps', to_jsonb(v_apps), '_key_id', k.id, '_client_id', c.id, '_rate', v_limit, '_quota', v_quota);

  BEGIN
    EXECUTE format('SELECT %s($1, $2)', ep.handler) INTO v_data USING v_params, (k.mode = 'sandbox');
  EXCEPTION
    WHEN invalid_parameter_value THEN v_status := 400; v_err_code := 'bad_request'; v_err_msg := SQLERRM;
    WHEN no_data_found THEN v_status := 404; v_err_code := 'not_found'; v_err_msg := SQLERRM;
    WHEN OTHERS THEN
      v_status := 500; v_err_code := 'handler_error'; v_err_msg := 'Something went wrong on our side. It has been logged.';
      v_private_err := left(SQLSTATE || ': ' || SQLERRM, 300);
  END;

  v_ms := round(extract(epoch FROM clock_timestamp() - v_t0) * 1000)::INTEGER;
  -- The public playground key is not logged call by call (its counters are enough); everything else is.
  IF NOT k.per_ip OR v_status >= 500 THEN
    INSERT INTO public.era_api_log (key_id, client_id, mode, endpoint, status, ms, error)
    VALUES (k.id, c.id, k.mode, ep.id, v_status, v_ms, v_private_err);
  END IF;
  IF k.last_used_at IS NULL OR k.last_used_at < now() - INTERVAL '1 minute' THEN
    UPDATE public.era_api_keys SET last_used_at = now() WHERE id = k.id;
  END IF;
  -- Housekeeping, rarely and cheaply.
  IF random() < 0.004 THEN
    DELETE FROM public.era_api_log WHERE at < now() - INTERVAL '30 days';
    DELETE FROM public.era_api_usage
     WHERE (period IN ('m', 'f') AND bucket < now() - INTERVAL '3 hours') OR (period = 'd' AND bucket < now() - INTERVAL '40 days');
  END IF;

  IF v_status <> 200 THEN
    RETURN public.era__err(v_status, v_err_code, v_err_msg, v_headers);
  END IF;
  IF ep.cache_seconds > 0 THEN
    v_headers := v_headers || jsonb_build_object('cache-control', format('private, max-age=%s', ep.cache_seconds));
  END IF;
  RETURN public.era__resp(200, jsonb_build_object(
    'data', COALESCE(v_data, 'null'::JSONB),
    'meta', jsonb_build_object('app', ep.app, 'endpoint', ep.id, 'mode', k.mode, 'request_id', v_rid, 'ms', v_ms,
                               'count', CASE WHEN jsonb_typeof(v_data) = 'array' THEN jsonb_array_length(v_data) END)), v_headers);
END;
$$;

-- ---------------------------------------------------------------------------- administration (a real signed-in admin only)

CREATE OR REPLACE FUNCTION public.era_api_admin_overview() RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.era_api_settings;
BEGIN
  PERFORM public.era__require_admin();
  SELECT * INTO s FROM public.era_api_settings WHERE id;
  RETURN jsonb_build_object(
    'settings', to_jsonb(s) - 'updated_by',
    'clients', jsonb_build_object(
      'pending',   (SELECT COUNT(*) FROM public.era_api_clients WHERE status = 'pending'   AND NOT is_system),
      'approved',  (SELECT COUNT(*) FROM public.era_api_clients WHERE status = 'approved'  AND NOT is_system),
      'suspended', (SELECT COUNT(*) FROM public.era_api_clients WHERE status = 'suspended' AND NOT is_system),
      'rejected',  (SELECT COUNT(*) FROM public.era_api_clients WHERE status = 'rejected'  AND NOT is_system),
      'total',     (SELECT COUNT(*) FROM public.era_api_clients WHERE NOT is_system)),
    'keys_active', (SELECT COUNT(*) FROM public.era_api_keys k JOIN public.era_api_clients c ON c.id = k.client_id
                     WHERE k.revoked_at IS NULL AND NOT c.is_system),
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

CREATE OR REPLACE FUNCTION public.era_api_admin_list_clients(p_status TEXT DEFAULT NULL, p_limit INTEGER DEFAULT 100)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.era__require_admin();
  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(x)::JSONB ORDER BY x.sort_pending DESC, x.created_at DESC) FROM (
      SELECT c.id, c.app_name, c.contact_name, c.contact_email, c.website, c.description, c.requested_apps, c.granted_apps,
             c.status, c.live_rate_per_min, c.live_daily_quota, c.review_note, c.reviewed_at, c.live_key_claimed_at,
             c.is_system, c.created_at,
             (c.status = 'pending') AS sort_pending,
             (SELECT COUNT(*) FROM public.era_api_log l WHERE l.client_id = c.id AND l.at > now() - INTERVAL '24 hours') AS calls_24h,
             COALESCE((SELECT jsonb_agg(jsonb_build_object('id', k.id, 'mode', k.mode, 'prefix', k.prefix,
                         'created_at', k.created_at, 'last_used_at', k.last_used_at, 'revoked_at', k.revoked_at,
                         'revoked_reason', k.revoked_reason) ORDER BY k.created_at DESC)
                        FROM public.era_api_keys k WHERE k.client_id = c.id), '[]'::JSONB) AS keys
        FROM public.era_api_clients c
       WHERE (p_status IS NULL OR c.status = p_status)
       ORDER BY (c.status = 'pending') DESC, c.created_at DESC
       LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500)) x), '[]'::JSONB);
END;
$$;

-- approve | reject | suspend | reinstate
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

CREATE OR REPLACE FUNCTION public.era_api_admin_revoke_key(p_key_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_client UUID;
BEGIN
  PERFORM public.era__require_admin();
  UPDATE public.era_api_keys k SET revoked_at = COALESCE(k.revoked_at, now()),
         revoked_reason = COALESCE(k.revoked_reason, NULLIF(btrim(COALESCE(p_reason, '')), ''), 'revoked by an administrator')
   WHERE k.id = p_key_id AND NOT EXISTS (SELECT 1 FROM public.era_api_clients c WHERE c.id = k.client_id AND c.is_system)
  RETURNING k.client_id INTO v_client;
  IF NOT FOUND THEN RAISE EXCEPTION 'No such key.' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO public.era_api_audit (actor, action, client_id, detail)
  VALUES (auth.uid(), 'key_revoked', v_client, jsonb_build_object('key_id', p_key_id, 'reason', p_reason));
  RETURN jsonb_build_object('revoked', TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION public.era_api_admin_list_endpoints() RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.era__require_admin();
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', e.id, 'app', e.app, 'path', e.path, 'summary', e.summary, 'enabled', e.enabled, 'cache_seconds', e.cache_seconds,
      'calls_24h', COALESCE(u.calls, 0), 'errors_24h', COALESCE(u.errors, 0)) ORDER BY e.sort, e.path)
    FROM public.era_api_endpoints e
    LEFT JOIN (SELECT endpoint, COUNT(*) AS calls, COUNT(*) FILTER (WHERE status >= 500) AS errors
                 FROM public.era_api_log WHERE at > now() - INTERVAL '24 hours' GROUP BY endpoint) u ON u.endpoint = e.id), '[]'::JSONB);
END;
$$;

CREATE OR REPLACE FUNCTION public.era_api_admin_set_endpoint(p_id TEXT, p_enabled BOOLEAN DEFAULT NULL, p_cache_seconds INTEGER DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.era__require_admin();
  IF p_cache_seconds IS NOT NULL AND (p_cache_seconds < 0 OR p_cache_seconds > 3600) THEN
    RAISE EXCEPTION 'Cache time must be between 0 and 3600 seconds.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.era_api_endpoints SET enabled = COALESCE(p_enabled, enabled), cache_seconds = COALESCE(p_cache_seconds, cache_seconds)
   WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'No such endpoint.' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO public.era_api_audit (actor, action, detail)
  VALUES (auth.uid(), 'endpoint_changed', jsonb_build_object('id', p_id, 'enabled', p_enabled, 'cache_seconds', p_cache_seconds));
  RETURN jsonb_build_object('id', p_id, 'enabled', (SELECT enabled FROM public.era_api_endpoints WHERE id = p_id));
END;
$$;

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
      sandbox_rate_per_min = COALESCE((p_patch ->> 'sandbox_rate_per_min')::INTEGER, sandbox_rate_per_min),
      sandbox_daily_quota = COALESCE((p_patch ->> 'sandbox_daily_quota')::INTEGER, sandbox_daily_quota),
      updated_by = auth.uid(), updated_at = now()
   WHERE id RETURNING * INTO s;
  INSERT INTO public.era_api_audit (actor, action, detail) VALUES (auth.uid(), 'settings_changed', p_patch);
  RETURN to_jsonb(s) - 'updated_by';
END;
$$;

CREATE OR REPLACE FUNCTION public.era_api_admin_recent_calls(p_client_id UUID DEFAULT NULL, p_limit INTEGER DEFAULT 50)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.era__require_admin();
  RETURN COALESCE((SELECT jsonb_agg(row_to_json(x)::JSONB) FROM (
    SELECT l.at, l.mode, l.endpoint, l.status, l.ms, l.error, c.app_name
      FROM public.era_api_log l LEFT JOIN public.era_api_clients c ON c.id = l.client_id
     WHERE p_client_id IS NULL OR l.client_id = p_client_id
     ORDER BY l.at DESC LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)) x), '[]'::JSONB);
END;
$$;

-- ---------------------------------------------------------------------------- grants
-- Supabase opens new functions to the API roles by default. Close everything, then open exactly what is meant.
DO $$
DECLARE f RECORD;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND (p.proname LIKE 'era\_api\_%' OR p.proname LIKE 'era\_\_%' OR p.proname LIKE 'era\_h\_%' OR p.proname LIKE 'era\_p\_%') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
  END LOOP;
END $$;

-- anyone (no account): information, the catalogue, getting a key, checking status, rotating a key, making a call
GRANT EXECUTE ON FUNCTION public.era_api_public_info()                                                          TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.era_api_catalog()                                                              TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.era_api_request_access(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], TEXT, TEXT)      TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.era_api_ticket_status(TEXT)                                                    TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.era_api_issue_key(TEXT, TEXT)                                                  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.era_api_call(TEXT, TEXT, TEXT, JSONB, TEXT)                                    TO anon, authenticated, service_role;

-- administrators (the functions re-check the account): signed-in users only
GRANT EXECUTE ON FUNCTION public.era_api_is_admin()                                                             TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.era_api_admin_overview()                                                       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.era_api_admin_list_clients(TEXT, INTEGER)                                      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.era_api_admin_review(UUID, TEXT, TEXT[], INTEGER, INTEGER, TEXT)              TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.era_api_admin_revoke_key(UUID, TEXT)                                           TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.era_api_admin_list_endpoints()                                                 TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.era_api_admin_set_endpoint(TEXT, BOOLEAN, INTEGER)                             TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.era_api_admin_save_settings(JSONB)                                             TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.era_api_admin_recent_calls(UUID, INTEGER)                                      TO authenticated, service_role;

-- ################################ PART 2 of 4: 20261005100100_era_api_endpoints.sql ################################
-- ============================================================================
-- ERA API v1: the endpoint handlers and their registry rows. Needs 20261005100000_era_api.sql first.
--
-- Rules every handler follows (they are the privacy promise of this API):
--   * read-only, and only fields that are already public in the apps, or aggregates
--   * never anything about a person's money, wallet, messages, contact details or identity documents
--   * `p_sandbox = TRUE` returns fixture data and never touches a real table
--   * bad input raises SQLSTATE 22023 (-> HTTP 400), a missing thing raises P0002 (-> 404); other errors are logged
--     privately and the caller only sees a generic 500
--
-- Each endpoint can be switched off on its own in the developer panel's API tab (the kill switch).
-- Re-running this file refreshes the descriptions but keeps whatever an administrator toggled.
-- ============================================================================

DO $$ BEGIN
  IF to_regclass('public.era_api_endpoints') IS NULL THEN
    RAISE EXCEPTION 'Apply supabase/migrations/20261005100000_era_api.sql first.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------- parameter helpers
CREATE OR REPLACE FUNCTION public.era_p_text(p JSONB, k TEXT, p_max INTEGER DEFAULT 80) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$ SELECT NULLIF(left(btrim(p ->> k), p_max), '') $$;

CREATE OR REPLACE FUNCTION public.era_p_int(p JSONB, k TEXT, p_default INTEGER, p_min INTEGER, p_max INTEGER)
RETURNS INTEGER LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v TEXT := NULLIF(btrim(p ->> k), '');
BEGIN
  IF v IS NULL THEN RETURN p_default; END IF;
  IF v !~ '^-?[0-9]{1,9}$' THEN
    RAISE EXCEPTION '% must be a whole number', k USING ERRCODE = '22023';
  END IF;
  RETURN LEAST(GREATEST(v::INTEGER, p_min), p_max);
END;
$$;

CREATE OR REPLACE FUNCTION public.era_p_num(p JSONB, k TEXT, p_min NUMERIC, p_max NUMERIC, p_required BOOLEAN DEFAULT FALSE)
RETURNS NUMERIC LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v TEXT := NULLIF(btrim(p ->> k), '');
BEGIN
  IF v IS NULL THEN
    IF p_required THEN RAISE EXCEPTION '% is required', k USING ERRCODE = '22023'; END IF;
    RETURN NULL;
  END IF;
  IF v !~ '^-?[0-9]{1,9}(\.[0-9]{1,6})?$' THEN
    RAISE EXCEPTION '% must be a number', k USING ERRCODE = '22023';
  END IF;
  IF v::NUMERIC < p_min OR v::NUMERIC > p_max THEN
    RAISE EXCEPTION '% must be between % and %', k, p_min, p_max USING ERRCODE = '22023';
  END IF;
  RETURN v::NUMERIC;
END;
$$;

-- a LIKE pattern from user text: wildcards neutralised
CREATE OR REPLACE FUNCTION public.era_p_like(p_text TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$ SELECT '%' || replace(replace(replace(p_text, '\', '\\'), '%', '\%'), '_', '\_') || '%' $$;

-- ============================================================================ PLATFORM

-- Who am I, and how much is left?
CREATE OR REPLACE FUNCTION public.era_h_platform_whoami(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c public.era_api_clients;
  v_key UUID := NULLIF(p ->> '_key_id', '')::UUID;
  v_used INTEGER;
BEGIN
  SELECT * INTO c FROM public.era_api_clients WHERE id = (p ->> '_client_id')::UUID;
  SELECT COALESCE(SUM(calls), 0) INTO v_used FROM public.era_api_usage
   WHERE key_id = v_key AND period = 'd' AND bucket = public.era__bucket(86400);
  RETURN jsonb_build_object(
    'app_name', c.app_name,
    'mode', p ->> '_mode',
    'status', c.status,
    'apps', p -> '_apps',
    'limits', jsonb_build_object('per_minute', (p ->> '_rate')::INTEGER, 'per_day', (p ->> '_quota')::INTEGER),
    'used_today', v_used,
    'hint', CASE WHEN p ->> '_mode' = 'sandbox'
                 THEN 'Sandbox key: responses are realistic fixtures. Ask for live access at /developers.'
                 ELSE 'Live key: responses are real.' END);
END;
$$;

-- One call that sees the whole family (only the apps your key is approved for).
CREATE OR REPLACE FUNCTION public.era_h_platform_pulse(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_apps JSONB := COALESCE(p -> '_apps', '[]'::JSONB);
  v_out JSONB := '{}'::JSONB;
  c RECORD;
BEGIN
  IF v_apps ? 'icanera' THEN
    IF p_sandbox THEN
      v_out := v_out || jsonb_build_object('icanera', jsonb_build_object('ican_usd', 1.3815, 'ican_ugx', 5508.42, 'change_24h_pct', 0.15));
    ELSE
      SELECT price_usd, price_ugx, percentage_change_24h INTO c
        FROM public.ican_coin_market_prices ORDER BY timestamp DESC LIMIT 1;
      v_out := v_out || jsonb_build_object('icanera', jsonb_build_object(
        'ican_usd', c.price_usd, 'ican_ugx', c.price_ugx, 'change_24h_pct', c.percentage_change_24h));
    END IF;
  END IF;
  IF v_apps ? 'bodagoera' THEN
    IF p_sandbox THEN
      v_out := v_out || jsonb_build_object('bodagoera', jsonb_build_object('districts', 4, 'stages', 37));
    ELSE
      v_out := v_out || jsonb_build_object('bodagoera', jsonb_build_object(
        'districts', (SELECT COUNT(*) FROM public.mbg_districts WHERE is_active),
        'stages', (SELECT COUNT(*) FROM public.mbg_stages WHERE is_active)));
    END IF;
  END IF;
  IF v_apps ? 'supermarketera' THEN
    IF p_sandbox THEN
      v_out := v_out || jsonb_build_object('supermarketera', jsonb_build_object('stores', 7, 'catalog_items', 638));
    ELSE
      v_out := v_out || jsonb_build_object('supermarketera', jsonb_build_object(
        'stores', (SELECT COUNT(*) FROM public.supermarkets
                    WHERE is_active IS NOT FALSE AND COALESCE(status, 'active') NOT IN ('suspended', 'rejected', 'pending')),
        'catalog_items', (SELECT COUNT(*) FROM public.supplier_catalog_items WHERE is_available)));
    END IF;
  END IF;
  IF v_apps ? 'farmagentera' THEN
    IF p_sandbox THEN
      v_out := v_out || jsonb_build_object('farmagentera', jsonb_build_object('active_listings', 21, 'produce_listings', 14));
    ELSE
      v_out := v_out || jsonb_build_object('farmagentera', jsonb_build_object(
        'active_listings', (SELECT COUNT(*) FROM public.marketplace_listings
                             WHERE status = 'active' AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)),
        'produce_listings', (SELECT COUNT(*) FROM public.marketplace_listings
                              WHERE status = 'active' AND type = 'produce' AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE))));
    END IF;
  END IF;
  RETURN v_out || jsonb_build_object('as_of', now());
END;
$$;

-- ============================================================================ ICANERA

-- Price of 1 ICAN in a currency. USD, UGX, EUR, GBP and JPY are stored; every other currency is derived from the UGX
-- price and the stored FX table (UGX per unit of that currency), so any of ~170 currencies works.
CREATE OR REPLACE FUNCTION public.era_h_icanera_coin_price(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cur TEXT := upper(COALESCE(public.era_p_text(p, 'currency', 12), 'USD'));
  c RECORD; v_rate NUMERIC; v_price NUMERIC; v_src TEXT := 'stored';
  v_fx JSONB := '{"USD":3987.0,"EUR":4485.0,"GBP":5275.0,"KES":30.8,"UGX":1,"NGN":2.6,"ZAR":218.0,"JPY":25.3}';
BEGIN
  IF v_cur !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'currency must be a 3-letter code such as USD or UGX' USING ERRCODE = '22023'; END IF;

  IF p_sandbox THEN
    IF NOT (v_fx ? v_cur) THEN RAISE EXCEPTION 'No ICAN price for %. Sandbox knows USD, EUR, GBP, KES, UGX, NGN, ZAR, JPY.', v_cur USING ERRCODE = 'P0002'; END IF;
    RETURN jsonb_build_object('asset', 'ICAN', 'currency', v_cur, 'price', round(5508.42 / (v_fx ->> v_cur)::NUMERIC, 6),
      'change_24h_pct', 0.15, 'change_7d_pct', 0, 'updated_at', now(), 'source', 'sandbox-fixture');
  END IF;

  SELECT price_usd, price_ugx, price_eur, price_gbp, price_jpy, percentage_change_24h AS ch24, percentage_change_7d AS ch7, last_updated INTO c
    FROM public.ican_coin_market_prices ORDER BY timestamp DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'The ICAN price is not available right now.' USING ERRCODE = 'P0002'; END IF;

  v_price := CASE v_cur WHEN 'USD' THEN c.price_usd WHEN 'UGX' THEN c.price_ugx WHEN 'EUR' THEN c.price_eur
                        WHEN 'GBP' THEN c.price_gbp WHEN 'JPY' THEN c.price_jpy END;
  IF v_price IS NULL THEN
    SELECT rate_to_ugx INTO v_rate FROM public.ican_currency_rates WHERE currency_code = v_cur AND rate_to_ugx > 0 LIMIT 1;
    IF v_rate IS NULL THEN RAISE EXCEPTION 'No ICAN price for currency %.', v_cur USING ERRCODE = 'P0002'; END IF;
    v_price := c.price_ugx / v_rate; v_src := 'derived-from-fx';
  END IF;
  RETURN jsonb_build_object('asset', 'ICAN', 'currency', v_cur, 'price', round(v_price, 6),
    'change_24h_pct', c.ch24, 'change_7d_pct', c.ch7, 'updated_at', c.last_updated, 'source', v_src);
END;
$$;

-- OHLC candles in UGX, re-binned from the stored 5-minute candles.
CREATE OR REPLACE FUNCTION public.era_h_icanera_coin_candles(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tf TEXT := COALESCE(public.era_p_text(p, 'interval', 12), '1h');
  v_limit INTEGER := public.era_p_int(p, 'limit', 48, 1, 288);
  v_bin INTERVAL;
BEGIN
  v_bin := CASE v_tf WHEN '5m' THEN '5 minutes' WHEN '15m' THEN '15 minutes' WHEN '1h' THEN '1 hour'
                     WHEN '4h' THEN '4 hours' WHEN '1d' THEN '1 day' END;
  IF v_bin IS NULL THEN RAISE EXCEPTION 'interval must be one of 5m, 15m, 1h, 4h, 1d' USING ERRCODE = '22023'; END IF;

  IF p_sandbox THEN
    RETURN COALESCE((SELECT jsonb_agg(row ORDER BY (row ->> 'open_time')) FROM (
      SELECT jsonb_build_object('open_time', t, 'open', round((5500 + 20 * sin(n / 3.0))::NUMERIC, 2),
               'high', round((5500 + 20 * sin(n / 3.0) + 6)::NUMERIC, 2), 'low', round((5500 + 20 * sin(n / 3.0) - 6)::NUMERIC, 2),
               'close', round((5500 + 20 * sin((n + 1) / 3.0))::NUMERIC, 2), 'volume', 100 + n * 7) AS row
        FROM (SELECT g AS n, date_trunc('hour', now()) - (g * v_bin) AS t FROM generate_series(0, v_limit - 1) g) s) x), '[]'::JSONB);
  END IF;

  RETURN COALESCE((SELECT jsonb_agg(row ORDER BY (row ->> 'open_time')) FROM (
    SELECT jsonb_build_object('open_time', b.bin, 'open', b.o, 'high', b.h, 'low', b.l, 'close', b.c, 'volume', b.v) AS row
      FROM (SELECT date_bin(v_bin, open_time, TIMESTAMPTZ '2000-01-01') AS bin,
                   (array_agg(open_price ORDER BY open_time ASC))[1]   AS o,
                   MAX(high_price) AS h, MIN(low_price) AS l,
                   (array_agg(close_price ORDER BY open_time DESC))[1] AS c,
                   SUM(trading_volume) AS v
              FROM public.ican_price_ohlc WHERE timeframe = '5m'
             GROUP BY 1 ORDER BY 1 DESC LIMIT v_limit) b) x), '[]'::JSONB);
END;
$$;

CREATE OR REPLACE FUNCTION public.era_h_icanera_fx_rates(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cur TEXT := upper(public.era_p_text(p, 'currency', 12));
  v_country TEXT := upper(public.era_p_text(p, 'country', 12));
  v_region TEXT := public.era_p_text(p, 'region', 40);
  v_limit INTEGER := public.era_p_int(p, 'limit', 50, 1, 250);
  v_offset INTEGER := public.era_p_int(p, 'offset', 0, 0, 100000);
BEGIN
  IF p_sandbox THEN
    RETURN COALESCE((SELECT jsonb_agg(x) FROM (
      SELECT * FROM jsonb_to_recordset('[
        {"currency_code":"USD","currency_name":"US Dollar","country_code":"US","region":"Americas","rate_to_ugx":3987.0,"local_inflation_pct":3.1},
        {"currency_code":"EUR","currency_name":"Euro","country_code":"DE","region":"Europe","rate_to_ugx":4485.0,"local_inflation_pct":2.4},
        {"currency_code":"GBP","currency_name":"Pound Sterling","country_code":"GB","region":"Europe","rate_to_ugx":5275.0,"local_inflation_pct":3.4},
        {"currency_code":"KES","currency_name":"Kenyan Shilling","country_code":"KE","region":"Africa","rate_to_ugx":30.8,"local_inflation_pct":5.1},
        {"currency_code":"NGN","currency_name":"Nigerian Naira","country_code":"NG","region":"Africa","rate_to_ugx":2.6,"local_inflation_pct":22.0},
        {"currency_code":"ZAR","currency_name":"South African Rand","country_code":"ZA","region":"Africa","rate_to_ugx":218.0,"local_inflation_pct":4.6}]'::JSONB)
        AS t(currency_code TEXT, currency_name TEXT, country_code TEXT, region TEXT, rate_to_ugx NUMERIC, local_inflation_pct NUMERIC)
       WHERE (v_cur IS NULL OR currency_code = v_cur) AND (v_country IS NULL OR country_code = v_country)
         AND (v_region IS NULL OR region ILIKE v_region)) x), '[]'::JSONB);
  END IF;
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (
    SELECT currency_code, currency_name, country_code, region, round(rate_to_ugx, 6) AS rate_to_ugx,
           local_inflation_pct, updated_at
      FROM public.ican_currency_rates
     WHERE (v_cur IS NULL OR currency_code = v_cur) AND (v_country IS NULL OR country_code = v_country)
       AND (v_region IS NULL OR region ILIKE v_region)
     ORDER BY currency_code, country_code LIMIT v_limit OFFSET v_offset) x), '[]'::JSONB);
END;
$$;

CREATE OR REPLACE FUNCTION public.era_h_icanera_countries(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cur TEXT := upper(public.era_p_text(p, 'currency', 12));
BEGIN
  IF p_sandbox THEN
    RETURN COALESCE((SELECT jsonb_agg(x) FROM (
      SELECT * FROM jsonb_to_recordset('[{"country_code":"UG","currency_code":"UGX"},{"country_code":"KE","currency_code":"KES"},
        {"country_code":"TZ","currency_code":"TZS"},{"country_code":"RW","currency_code":"RWF"},{"country_code":"NG","currency_code":"NGN"},
        {"country_code":"ZA","currency_code":"ZAR"}]'::JSONB) AS t(country_code TEXT, currency_code TEXT)
       WHERE v_cur IS NULL OR currency_code = v_cur) x), '[]'::JSONB);
  END IF;
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (
    SELECT country_code, currency_code FROM public.ican_country_currency_map
     WHERE v_cur IS NULL OR currency_code = v_cur ORDER BY country_code) x), '[]'::JSONB);
END;
$$;

CREATE OR REPLACE FUNCTION public.era_h_icanera_tax_rules(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cc TEXT := upper(public.era_p_text(p, 'country', 12)); r RECORD;
BEGIN
  IF v_cc IS NULL OR v_cc !~ '^[A-Z]{2}$' THEN RAISE EXCEPTION 'country must be a 2-letter ISO code such as UG' USING ERRCODE = '22023'; END IF;
  IF p_sandbox THEN
    IF v_cc <> 'UG' THEN RAISE EXCEPTION 'Sandbox only has Uganda (UG).' USING ERRCODE = 'P0002'; END IF;
    RETURN jsonb_build_object('country_code', 'UG', 'country_name', 'Uganda', 'currency', 'UGX',
      'personal_tax_period', 'annual', 'corporate_tax_rate', 30, 'vat_rate', 18, 'capital_gains_rate', 30,
      'regulatory_body', 'Uganda Revenue Authority', 'filing_date', '30 June',
      'personal_tax_brackets', '[{"up_to":2820000,"rate":0},{"up_to":4020000,"rate":10},{"up_to":4920000,"rate":20},{"up_to":null,"rate":30}]'::JSONB,
      'informational_only', TRUE);
  END IF;
  SELECT country_code, country_name, currency, personal_tax_period, corporate_tax_rate, vat_rate, capital_gains_rate,
         regulatory_body, filing_date, personal_tax_brackets, last_verified_at, source INTO r
    FROM public.country_tax_rules WHERE upper(country_code) = v_cc LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'No tax rules on file for %.', v_cc USING ERRCODE = 'P0002'; END IF;
  RETURN to_jsonb(r) || jsonb_build_object('informational_only', TRUE);
END;
$$;

-- The public business directory (the same list the landing page search shows).
CREATE OR REPLACE FUNCTION public.era_h_icanera_businesses(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_q TEXT := public.era_p_text(p, 'q', 60);
  v_limit INTEGER := public.era_p_int(p, 'limit', 20, 1, 50);
  v_offset INTEGER := public.era_p_int(p, 'offset', 0, 0, 10000);
BEGIN
  IF p_sandbox THEN
    RETURN COALESCE((SELECT jsonb_agg(x) FROM (
      SELECT * FROM jsonb_to_recordset('[
        {"id":"7d1c0000-0000-4000-8000-000000000001","name":"Kampala Fresh Mart","industry":"Retail","location":"Kampala, Uganda","tagline":"Fresh every morning","website":"https://example.com","open_jobs":2,"notices":5},
        {"id":"7d1c0000-0000-4000-8000-000000000002","name":"Nile Logistics","industry":"Transport","location":"Jinja, Uganda","tagline":"Moving East Africa","website":"https://example.org","open_jobs":0,"notices":1},
        {"id":"7d1c0000-0000-4000-8000-000000000003","name":"Savanna Agro Supplies","industry":"Agriculture","location":"Mbarara, Uganda","tagline":"Seeds, tools, advice","website":null,"open_jobs":1,"notices":3}]'::JSONB)
        AS t(id UUID, name TEXT, industry TEXT, location TEXT, tagline TEXT, website TEXT, open_jobs INTEGER, notices INTEGER)
       WHERE v_q IS NULL OR name ILIKE public.era_p_like(v_q) OR industry ILIKE public.era_p_like(v_q)) x), '[]'::JSONB);
  END IF;
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (
    SELECT id, company_name AS name, industry, location, tagline, website, logo_url, open_jobs, notices
      FROM public.fn_search_public_cmms_businesses(v_q, v_limit, v_offset)) x), '[]'::JSONB);
END;
$$;

-- ============================================================================ BODAGOERA

CREATE OR REPLACE FUNCTION public.era_h_bodagoera_stages(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_q TEXT := public.era_p_text(p, 'q', 60);
  v_limit INTEGER := public.era_p_int(p, 'limit', 50, 1, 200);
  v_offset INTEGER := public.era_p_int(p, 'offset', 0, 0, 10000);
BEGIN
  IF p_sandbox THEN
    RETURN COALESCE((SELECT jsonb_agg(x) FROM (
      SELECT * FROM jsonb_to_recordset('[
        {"id":"5a6e0000-0000-4000-8000-000000000001","name":"Wandegeya Stage","location_name":"Wandegeya Market, Kampala","latitude":0.3318,"longitude":32.5728,"description":"Busy student stage"},
        {"id":"5a6e0000-0000-4000-8000-000000000002","name":"Jinja Road Stage","location_name":"Jinja Road, Kampala","latitude":0.3173,"longitude":32.6020,"description":"Opposite the roundabout"}]'::JSONB)
        AS t(id UUID, name TEXT, location_name TEXT, latitude NUMERIC, longitude NUMERIC, description TEXT)
       WHERE v_q IS NULL OR name ILIKE public.era_p_like(v_q) OR location_name ILIKE public.era_p_like(v_q)) x), '[]'::JSONB);
  END IF;
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (
    SELECT id, name, location_name, location_lat AS latitude, location_lng AS longitude, description
      FROM public.mbg_stages
     WHERE is_active AND (v_q IS NULL OR name ILIKE public.era_p_like(v_q) OR location_name ILIKE public.era_p_like(v_q))
     ORDER BY name LIMIT v_limit OFFSET v_offset) x), '[]'::JSONB);
END;
$$;

CREATE OR REPLACE FUNCTION public.era_h_bodagoera_districts(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_sandbox THEN
    RETURN '[{"name":"Kampala","code":"KLA","description":"Capital city"},{"name":"Wakiso","code":"WAK","description":"Greater Kampala"},
             {"name":"Jinja","code":"JJA","description":"Source of the Nile"}]'::JSONB;
  END IF;
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (
    SELECT name, code, description FROM public.mbg_districts WHERE is_active ORDER BY name) x), '[]'::JSONB);
END;
$$;

CREATE OR REPLACE FUNCTION public.era_h_bodagoera_ports(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_country TEXT := public.era_p_text(p, 'country', 60);
BEGIN
  IF p_sandbox THEN
    RETURN COALESCE((SELECT jsonb_agg(x) FROM (
      SELECT * FROM jsonb_to_recordset('[
        {"country":"Kenya","city":"Mombasa","port_name":"Port of Mombasa","latitude":-4.0435,"longitude":39.6682,"un_locode":"KEMBA"},
        {"country":"Tanzania","city":"Dar es Salaam","port_name":"Port of Dar es Salaam","latitude":-6.8235,"longitude":39.2695,"un_locode":"TZDAR"}]'::JSONB)
        AS t(country TEXT, city TEXT, port_name TEXT, latitude NUMERIC, longitude NUMERIC, un_locode TEXT)
       WHERE v_country IS NULL OR country ILIKE v_country) x), '[]'::JSONB);
  END IF;
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (
    SELECT country, city, port_name, latitude, longitude, un_locode FROM public.mbg_ports
     WHERE is_active AND (v_country IS NULL OR country ILIKE v_country) ORDER BY country, city) x), '[]'::JSONB);
END;
$$;

-- A fare ESTIMATE from the platform's public price settings: max(minimum, base + per_km x distance).
CREATE OR REPLACE FUNCTION public.era_h_bodagoera_fare_estimate(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_km NUMERIC := public.era_p_num(p, 'km', 0.1, 500, TRUE);
  v_kind TEXT := lower(COALESCE(public.era_p_text(p, 'kind', 12), 'ride'));
  v_base NUMERIC; v_per NUMERIC; v_min NUMERIC; v_fare NUMERIC;
BEGIN
  IF v_kind NOT IN ('ride', 'cargo') THEN RAISE EXCEPTION 'kind must be ride or cargo' USING ERRCODE = '22023'; END IF;
  IF p_sandbox THEN
    v_base := CASE v_kind WHEN 'ride' THEN 1000 ELSE 5000 END; v_per := CASE v_kind WHEN 'ride' THEN 1000 ELSE 2000 END;
    v_min := CASE v_kind WHEN 'ride' THEN 2000 ELSE 0 END;
  ELSE
    SELECT MAX(value::NUMERIC) FILTER (WHERE key = v_kind || '.base_fare'),
           MAX(value::NUMERIC) FILTER (WHERE key = v_kind || '.per_km_rate'),
           MAX(value::NUMERIC) FILTER (WHERE key = v_kind || '.minimum_fare')
      INTO v_base, v_per, v_min
      FROM public.mbg_platform_settings
     WHERE is_public AND key IN (v_kind || '.base_fare', v_kind || '.per_km_rate', v_kind || '.minimum_fare')
       AND value ~ '^[0-9]+(\.[0-9]+)?$';
    IF v_base IS NULL OR v_per IS NULL THEN RAISE EXCEPTION 'Fares are not published for %.', v_kind USING ERRCODE = 'P0002'; END IF;
  END IF;
  v_fare := GREATEST(COALESCE(v_min, 0), v_base + v_per * v_km);
  RETURN jsonb_build_object('kind', v_kind, 'distance_km', v_km, 'currency', 'UGX', 'estimated_fare', round(v_fare),
    'breakdown', jsonb_build_object('base_fare', v_base, 'per_km_rate', v_per, 'minimum_fare', v_min),
    'note', 'An estimate from the published rates. The final fare is set by the ride.');
END;
$$;

-- Is this rider card genuine? Wraps the public verifier and returns only what a passenger needs to know.
CREATE OR REPLACE FUNCTION public.era_h_bodagoera_verify_rider(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_code TEXT := public.era_p_text(p, 'code', 64); v JSONB;
BEGIN
  IF v_code IS NULL OR v_code !~ '^[A-Za-z0-9]{4,64}$' THEN
    RAISE EXCEPTION 'code must be the 16 to 64 letter-or-digit code printed on the rider card QR' USING ERRCODE = '22023';
  END IF;
  IF p_sandbox THEN
    IF lower(v_code) LIKE '%valid' THEN
      RETURN '{"is_valid":true,"state":"valid","card_number":"BGE-0001","full_name":"Sample Rider","vehicle_type":"motorcycle",
               "vehicle_model":"Bajaj Boxer","vehicle_color":"Red","plate_number":"UAA 123B","rating":4.8,"completed_rides":412,
               "stage":"Wandegeya Stage","district":"Kampala","permit_status":"valid"}'::JSONB;
    END IF;
    RETURN '{"is_valid":false}'::JSONB;
  END IF;
  v := public.mbg_verify_rider_card(v_code);
  -- minimal: no phone numbers, no licence details, no money
  RETURN jsonb_strip_nulls(jsonb_build_object(
    'is_valid', COALESCE((v ->> 'is_valid')::BOOLEAN, FALSE), 'state', v ->> 'state', 'card_number', v ->> 'card_number',
    'full_name', v ->> 'full_name', 'vehicle_type', v ->> 'vehicle_type', 'vehicle_model', v ->> 'vehicle_model',
    'vehicle_color', v ->> 'vehicle_color', 'plate_number', v ->> 'plate_number', 'rating', v -> 'rating',
    'completed_rides', v -> 'completed_rides', 'stage', v ->> 'stage', 'district', v ->> 'district',
    'permit_status', v ->> 'permit_status'));
END;
$$;

-- ============================================================================ SUPERMARKETERA

CREATE OR REPLACE FUNCTION public.era_h_supermarketera_stores(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_q TEXT := public.era_p_text(p, 'q', 60);
  v_city TEXT := public.era_p_text(p, 'city', 60);
  v_country TEXT := public.era_p_text(p, 'country', 60);
  v_limit INTEGER := public.era_p_int(p, 'limit', 25, 1, 100);
  v_offset INTEGER := public.era_p_int(p, 'offset', 0, 0, 10000);
BEGIN
  IF p_sandbox THEN
    RETURN COALESCE((SELECT jsonb_agg(x) FROM (
      SELECT * FROM jsonb_to_recordset('[
        {"id":"3c4f0000-0000-4000-8000-000000000001","name":"Kampala Fresh Mart","slug":"kampala-fresh-mart","city":"Kampala","country":"Uganda","business_type":"supermarket","latitude":0.3476,"longitude":32.5825,"offers_products":true,"offers_services":false},
        {"id":"3c4f0000-0000-4000-8000-000000000002","name":"Entebbe Corner Shop","slug":"entebbe-corner-shop","city":"Entebbe","country":"Uganda","business_type":"minimart","latitude":0.0512,"longitude":32.4637,"offers_products":true,"offers_services":true}]'::JSONB)
        AS t(id UUID, name TEXT, slug TEXT, city TEXT, country TEXT, business_type TEXT, latitude NUMERIC, longitude NUMERIC, offers_products BOOLEAN, offers_services BOOLEAN)
       WHERE (v_q IS NULL OR name ILIKE public.era_p_like(v_q)) AND (v_city IS NULL OR city ILIKE v_city)
         AND (v_country IS NULL OR country ILIKE v_country)) x), '[]'::JSONB);
  END IF;
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (
    SELECT id, name, slug, city, country, location, description, logo_url, business_type, latitude, longitude,
           offers_products, offers_services, price_currency
      FROM public.supermarkets
     WHERE is_active IS NOT FALSE AND COALESCE(status, 'active') NOT IN ('suspended', 'rejected', 'pending')
       AND (v_q IS NULL OR name ILIKE public.era_p_like(v_q))
       AND (v_city IS NULL OR city ILIKE v_city) AND (v_country IS NULL OR country ILIKE v_country)
     ORDER BY name LIMIT v_limit OFFSET v_offset) x), '[]'::JSONB);
END;
$$;

-- Supplier catalogue. Never returns cost prices, stock levels or who the supplier is.
CREATE OR REPLACE FUNCTION public.era_h_supermarketera_catalog(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_q TEXT := public.era_p_text(p, 'q', 60);
  v_cat TEXT := public.era_p_text(p, 'category', 60);
  v_brand TEXT := public.era_p_text(p, 'brand', 60);
  v_limit INTEGER := public.era_p_int(p, 'limit', 25, 1, 100);
  v_offset INTEGER := public.era_p_int(p, 'offset', 0, 0, 100000);
BEGIN
  IF p_sandbox THEN
    RETURN COALESCE((SELECT jsonb_agg(x) FROM (
      SELECT * FROM jsonb_to_recordset('[
        {"id":"9b2a0000-0000-4000-8000-000000000001","name":"Sliced Bread 600g","category":"Bakery","brand":"Daily Loaf","unit":"loaf","price_per_unit":4500,"currency":"UGX","sku":"BRD-600","barcode":"6001234567890","min_order_qty":12},
        {"id":"9b2a0000-0000-4000-8000-000000000002","name":"Bath Soap 200g","category":"Personal Care","brand":"Pure","unit":"bar","price_per_unit":2800,"currency":"UGX","sku":"SOP-200","barcode":"6009876543210","min_order_qty":24}]'::JSONB)
        AS t(id UUID, name TEXT, category TEXT, brand TEXT, unit TEXT, price_per_unit NUMERIC, currency TEXT, sku TEXT, barcode TEXT, min_order_qty NUMERIC)
       WHERE (v_q IS NULL OR name ILIKE public.era_p_like(v_q) OR brand ILIKE public.era_p_like(v_q))
         AND (v_cat IS NULL OR category ILIKE v_cat) AND (v_brand IS NULL OR brand ILIKE v_brand)) x), '[]'::JSONB);
  END IF;
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (
    SELECT id, name, category, brand, description, unit, min_order_qty, price_per_unit, currency, image_url, sku, barcode
      FROM public.supplier_catalog_items
     WHERE is_available AND (v_q IS NULL OR name ILIKE public.era_p_like(v_q) OR brand ILIKE public.era_p_like(v_q))
       AND (v_cat IS NULL OR category ILIKE v_cat) AND (v_brand IS NULL OR brand ILIKE v_brand)
     ORDER BY name LIMIT v_limit OFFSET v_offset) x), '[]'::JSONB);
END;
$$;

CREATE OR REPLACE FUNCTION public.era_h_supermarketera_barcode(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_code TEXT := public.era_p_text(p, 'code', 32); r RECORD;
BEGIN
  IF v_code IS NULL OR v_code !~ '^[A-Za-z0-9-]{3,32}$' THEN
    RAISE EXCEPTION 'code must be a barcode or SKU (3 to 32 letters, digits or dashes)' USING ERRCODE = '22023';
  END IF;
  IF p_sandbox THEN
    IF v_code IN ('6001234567890', 'BRD-600') THEN
      RETURN '{"id":"9b2a0000-0000-4000-8000-000000000001","name":"Sliced Bread 600g","category":"Bakery","brand":"Daily Loaf","unit":"loaf","price_per_unit":4500,"currency":"UGX","sku":"BRD-600","barcode":"6001234567890"}'::JSONB;
    END IF;
    RAISE EXCEPTION 'No product with code %. In the sandbox try 6001234567890.', v_code USING ERRCODE = 'P0002';
  END IF;
  SELECT id, name, category, brand, description, unit, min_order_qty, price_per_unit, currency, image_url, sku, barcode INTO r
    FROM public.supplier_catalog_items WHERE is_available AND (barcode = v_code OR upper(sku) = upper(v_code)) LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'No product with code %.', v_code USING ERRCODE = 'P0002'; END IF;
  RETURN to_jsonb(r);
END;
$$;

CREATE OR REPLACE FUNCTION public.era_h_supermarketera_categories(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_sandbox THEN
    RETURN '[{"category":"Bakery","items":42},{"category":"Personal Care","items":88},{"category":"Grains","items":120}]'::JSONB;
  END IF;
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (
    SELECT category, COUNT(*) AS items FROM public.supplier_catalog_items
     WHERE is_available AND category IS NOT NULL GROUP BY category ORDER BY COUNT(*) DESC, category) x), '[]'::JSONB);
END;
$$;

-- ============================================================================ FARMAGENTERA

-- Marketplace listings. No seller identity, no phone, email or WhatsApp, no exact coordinates.
CREATE OR REPLACE FUNCTION public.era_h_farmagentera_listings(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_type TEXT := lower(COALESCE(public.era_p_text(p, 'type', 12), 'all'));
  v_q TEXT := public.era_p_text(p, 'q', 60);
  v_district TEXT := public.era_p_text(p, 'district', 60);
  v_limit INTEGER := public.era_p_int(p, 'limit', 25, 1, 100);
  v_offset INTEGER := public.era_p_int(p, 'offset', 0, 0, 10000);
BEGIN
  IF v_type NOT IN ('all', 'produce', 'land', 'service') THEN
    RAISE EXCEPTION 'type must be all, produce, land or service' USING ERRCODE = '22023';
  END IF;
  IF p_sandbox THEN
    RETURN COALESCE((SELECT jsonb_agg(x) FROM (
      SELECT * FROM jsonb_to_recordset('[
        {"id":101,"type":"produce","title":"Fresh matooke, 40 bunches","price":180000,"is_negotiable":true,"district":"Mbarara","location":"Kakoba","featured":true,
         "details":{"crop_name":"Matooke","quantity":40,"unit":"bunches","is_organic":true,"availability":"available"}},
        {"id":102,"type":"land","title":"5 acres, road access, near water","price":25000000,"is_negotiable":true,"district":"Wakiso","location":"Kasanje","featured":false,
         "details":{"size_acres":5,"land_type":"agricultural","is_for_sale":true,"has_road_access":true,"water_source":"borehole"}},
        {"id":103,"type":"service","title":"Tractor ploughing, per acre","price":120000,"is_negotiable":false,"district":"Masaka","location":"Nyendo","featured":false,
         "details":{"service_type":"equipment rental","price_unit":"per acre","experience_years":8}}]'::JSONB)
        AS t(id INTEGER, type TEXT, title TEXT, price NUMERIC, is_negotiable BOOLEAN, district TEXT, location TEXT, featured BOOLEAN, details JSONB)
       WHERE (v_type = 'all' OR type = v_type) AND (v_q IS NULL OR title ILIKE public.era_p_like(v_q))
         AND (v_district IS NULL OR district ILIKE v_district)) x), '[]'::JSONB);
  END IF;
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (
    SELECT m.id, m.type, m.title, m.description, m.price, m.is_negotiable, m.location, m.district, m.thumbnail, m.images,
           m.featured, m.created_at,
           CASE m.type
             WHEN 'produce' THEN (SELECT jsonb_build_object('crop_name', pl.crop_name, 'produce_type', pl.produce_type, 'quantity', pl.quantity,
                    'unit', pl.unit, 'harvest_date', pl.harvest_date, 'is_organic', pl.is_organic, 'availability', pl.availability,
                    'min_order_quantity', pl.min_order_quantity) FROM public.produce_listings pl WHERE pl.listing_id = m.id LIMIT 1)
             WHEN 'land' THEN (SELECT jsonb_build_object('size_acres', ll.size_acres, 'land_type', ll.land_type, 'ownership_type', ll.ownership_type,
                    'is_for_sale', ll.is_for_sale, 'lease_term', ll.lease_term, 'soil_type', ll.soil_type, 'water_source', ll.water_source,
                    'has_road_access', ll.has_road_access, 'has_electricity', ll.has_electricity) FROM public.land_listings ll WHERE ll.listing_id = m.id LIMIT 1)
             WHEN 'service' THEN (SELECT jsonb_build_object('service_type', sl.service_type, 'price_unit', sl.price_unit,
                    'experience_years', sl.experience_years, 'skills', sl.skills, 'equipment', sl.equipment, 'service_area', sl.service_area)
                    FROM public.service_listings sl WHERE sl.listing_id = m.id LIMIT 1)
           END AS details
      FROM public.marketplace_listings m
     WHERE m.status = 'active' AND (m.expiry_date IS NULL OR m.expiry_date >= CURRENT_DATE)
       AND (v_type = 'all' OR m.type = v_type)
       AND (v_q IS NULL OR m.title ILIKE public.era_p_like(v_q) OR m.description ILIKE public.era_p_like(v_q))
       AND (v_district IS NULL OR m.district ILIKE v_district)
     ORDER BY m.featured DESC, m.created_at DESC LIMIT v_limit OFFSET v_offset) x), '[]'::JSONB);
END;
$$;

-- A live produce price board: what each crop is asking right now, from the marketplace.
CREATE OR REPLACE FUNCTION public.era_h_farmagentera_price_board(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_district TEXT := public.era_p_text(p, 'district', 60);
  v_limit INTEGER := public.era_p_int(p, 'limit', 30, 1, 100);
BEGIN
  IF p_sandbox THEN
    RETURN COALESCE((SELECT jsonb_agg(x) FROM (
      SELECT * FROM jsonb_to_recordset('[
        {"crop_name":"Matooke","listings":9,"min_price":120000,"avg_price":165000,"max_price":210000,"total_quantity":310,"unit":"bunches"},
        {"crop_name":"Maize","listings":6,"min_price":900000,"avg_price":1050000,"max_price":1200000,"total_quantity":48,"unit":"bags"},
        {"crop_name":"Beans","listings":4,"min_price":300000,"avg_price":340000,"max_price":380000,"total_quantity":22,"unit":"bags"}]'::JSONB)
        AS t(crop_name TEXT, listings INTEGER, min_price NUMERIC, avg_price NUMERIC, max_price NUMERIC, total_quantity NUMERIC, unit TEXT)) x), '[]'::JSONB);
  END IF;
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (
    SELECT initcap(btrim(pl.crop_name)) AS crop_name, COUNT(*) AS listings,
           MIN(m.price) AS min_price, round(AVG(m.price), 2) AS avg_price, MAX(m.price) AS max_price,
           SUM(pl.quantity) AS total_quantity, MIN(pl.unit) AS unit
      FROM public.marketplace_listings m JOIN public.produce_listings pl ON pl.listing_id = m.id
     WHERE m.status = 'active' AND m.type = 'produce' AND m.price IS NOT NULL AND pl.crop_name IS NOT NULL
       AND (m.expiry_date IS NULL OR m.expiry_date >= CURRENT_DATE) AND (v_district IS NULL OR m.district ILIKE v_district)
     GROUP BY initcap(btrim(pl.crop_name)) ORDER BY COUNT(*) DESC, 1 LIMIT v_limit) x), '[]'::JSONB);
END;
$$;

CREATE OR REPLACE FUNCTION public.era_h_farmagentera_crops(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_q TEXT := public.era_p_text(p, 'q', 60);
  v_season TEXT := public.era_p_text(p, 'season', 30);
  v_type TEXT := public.era_p_text(p, 'type', 40);
  v_limit INTEGER := public.era_p_int(p, 'limit', 25, 1, 100);
  v_offset INTEGER := public.era_p_int(p, 'offset', 0, 0, 10000);
BEGIN
  IF p_sandbox THEN
    RETURN COALESCE((SELECT jsonb_agg(x) FROM (
      SELECT * FROM jsonb_to_recordset('[
        {"name":"Maize (Longe 5)","scientific_name":"Zea mays","crop_type":"cereal","season":"first rains","maturity_days":110,"expected_yield_per_hectare":5.2,"soil_ph_min":5.8,"soil_ph_max":7.0,"water_requirements":"medium"},
        {"name":"Climbing beans (NABE 4)","scientific_name":"Phaseolus vulgaris","crop_type":"legume","season":"second rains","maturity_days":75,"expected_yield_per_hectare":2.1,"soil_ph_min":6.0,"soil_ph_max":7.5,"water_requirements":"medium"}]'::JSONB)
        AS t(name TEXT, scientific_name TEXT, crop_type TEXT, season TEXT, maturity_days INTEGER, expected_yield_per_hectare NUMERIC, soil_ph_min NUMERIC, soil_ph_max NUMERIC, water_requirements TEXT)
       WHERE (v_q IS NULL OR name ILIKE public.era_p_like(v_q)) AND (v_season IS NULL OR season ILIKE v_season)
         AND (v_type IS NULL OR crop_type ILIKE v_type)) x), '[]'::JSONB);
  END IF;
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (
    SELECT name, scientific_name, crop_type, season, maturity_days, expected_yield_per_hectare, soil_ph_min, soil_ph_max,
           water_requirements, description
      FROM public.crop_varieties
     WHERE (v_q IS NULL OR name ILIKE public.era_p_like(v_q) OR scientific_name ILIKE public.era_p_like(v_q))
       AND (v_season IS NULL OR season ILIKE v_season) AND (v_type IS NULL OR crop_type ILIKE v_type)
     ORDER BY name LIMIT v_limit OFFSET v_offset) x), '[]'::JSONB);
END;
$$;

-- ============================================================================ the registry
-- (Re-running refreshes the text and handlers but keeps `enabled` and `cache_seconds` as an administrator left them.)
INSERT INTO public.era_api_endpoints (id, app, path, summary, description, params, example_path, handler, cache_seconds, sort) VALUES
 ('platform.whoami', 'platform', '/whoami', 'Who am I?',
  'Your app, key mode, approved apps, limits and how much of today''s quota is used. The first call to make.',
  '[]', '/whoami', 'public.era_h_platform_whoami', 0, 10),
 ('platform.pulse', 'platform', '/pulse', 'The whole family in one call',
  'A snapshot across every app your key is approved for: the ICAN price, BodaGoEra stages, SupermarketEra stores and FarmAgentEra listings.',
  '[]', '/pulse', 'public.era_h_platform_pulse', 30, 11),

 ('icanera.coin_price', 'icanera', '/icanera/coin/price', 'ICAN coin price',
  'The live price of 1 ICAN in any of ~170 currencies, with 24h and 7d change.',
  '[{"name":"currency","in":"query","type":"string","required":false,"default":"USD","example":"UGX","description":"3-letter currency code."}]',
  '/icanera/coin/price?currency=UGX', 'public.era_h_icanera_coin_price', 30, 20),
 ('icanera.coin_candles', 'icanera', '/icanera/coin/candles', 'ICAN price candles',
  'OHLC candles in UGX, newest bins last, ready for a chart.',
  '[{"name":"interval","in":"query","type":"string","required":false,"default":"1h","example":"15m","description":"One of 5m, 15m, 1h, 4h, 1d."},
    {"name":"limit","in":"query","type":"integer","required":false,"default":48,"example":24,"description":"How many candles (1 to 288)."}]',
  '/icanera/coin/candles?interval=1h&limit=24', 'public.era_h_icanera_coin_candles', 60, 21),
 ('icanera.fx_rates', 'icanera', '/icanera/fx/rates', 'FX rates and inflation',
  'Exchange rates against the Ugandan shilling, with each country''s latest inflation.',
  '[{"name":"currency","in":"query","type":"string","required":false,"example":"KES","description":"Filter by currency code."},
    {"name":"country","in":"query","type":"string","required":false,"example":"KE","description":"Filter by 2-letter country code."},
    {"name":"region","in":"query","type":"string","required":false,"example":"Africa","description":"Filter by region."},
    {"name":"limit","in":"query","type":"integer","required":false,"default":50,"description":"1 to 250."},
    {"name":"offset","in":"query","type":"integer","required":false,"default":0,"description":"For paging."}]',
  '/icanera/fx/rates?region=Africa&limit=10', 'public.era_h_icanera_fx_rates', 300, 22),
 ('icanera.countries', 'icanera', '/icanera/countries', 'Countries and currencies',
  'Which currency each supported country uses.',
  '[{"name":"currency","in":"query","type":"string","required":false,"example":"UGX","description":"Only countries using this currency."}]',
  '/icanera/countries', 'public.era_h_icanera_countries', 3600, 23),
 ('icanera.tax_rules', 'icanera', '/icanera/tax/{country}', 'Tax rules by country',
  'Published tax brackets and rates for a country. Informational, never tax advice.',
  '[{"name":"country","in":"path","type":"string","required":true,"example":"UG","description":"2-letter ISO country code."}]',
  '/icanera/tax/UG', 'public.era_h_icanera_tax_rules', 3600, 24),
 ('icanera.businesses', 'icanera', '/icanera/businesses', 'Public business directory',
  'Businesses that chose to be listed publicly, with open jobs and notices counts.',
  '[{"name":"q","in":"query","type":"string","required":false,"example":"agro","description":"Search by name or industry."},
    {"name":"limit","in":"query","type":"integer","required":false,"default":20,"description":"1 to 50."},
    {"name":"offset","in":"query","type":"integer","required":false,"default":0,"description":"For paging."}]',
  '/icanera/businesses?q=agro', 'public.era_h_icanera_businesses', 120, 25),

 ('bodagoera.stages', 'bodagoera', '/bodagoera/stages', 'Boda stages',
  'Where riders gather: names, areas and coordinates.',
  '[{"name":"q","in":"query","type":"string","required":false,"example":"wandegeya","description":"Search by stage or area."},
    {"name":"limit","in":"query","type":"integer","required":false,"default":50,"description":"1 to 200."},
    {"name":"offset","in":"query","type":"integer","required":false,"default":0,"description":"For paging."}]',
  '/bodagoera/stages', 'public.era_h_bodagoera_stages', 120, 30),
 ('bodagoera.districts', 'bodagoera', '/bodagoera/districts', 'Districts served',
  'The districts BodaGoEra operates in.', '[]', '/bodagoera/districts', 'public.era_h_bodagoera_districts', 600, 31),
 ('bodagoera.ports', 'bodagoera', '/bodagoera/ports', 'Ports',
  'Sea ports used for cross-border journeys, with UN/LOCODE.',
  '[{"name":"country","in":"query","type":"string","required":false,"example":"Kenya","description":"Filter by country name."}]',
  '/bodagoera/ports?country=Kenya', 'public.era_h_bodagoera_ports', 600, 32),
 ('bodagoera.fare_estimate', 'bodagoera', '/bodagoera/fare/estimate', 'Fare estimate',
  'Estimate a ride or cargo fare from the published rates: max(minimum, base + per-km x distance).',
  '[{"name":"km","in":"query","type":"number","required":true,"example":7.5,"description":"Distance in kilometres (0.1 to 500)."},
    {"name":"kind","in":"query","type":"string","required":false,"default":"ride","example":"cargo","description":"ride or cargo."}]',
  '/bodagoera/fare/estimate?km=7.5', 'public.era_h_bodagoera_fare_estimate', 60, 33),
 ('bodagoera.verify_rider', 'bodagoera', '/bodagoera/riders/verify', 'Verify a rider card',
  'Is this the rider the card says? Pass the code from the card''s QR. Returns only what a passenger needs.',
  '[{"name":"code","in":"query","type":"string","required":true,"example":"SAMPLE0000000000valid","description":"The verification code on the rider card. In the sandbox, any code ending in ''valid'' passes."}]',
  '/bodagoera/riders/verify?code=SAMPLE0000000000valid', 'public.era_h_bodagoera_verify_rider', 0, 34),

 ('supermarketera.stores', 'supermarketera', '/supermarketera/stores', 'Stores',
  'Stores on SupermarketEra with their city and what they offer.',
  '[{"name":"q","in":"query","type":"string","required":false,"example":"fresh","description":"Search by store name."},
    {"name":"city","in":"query","type":"string","required":false,"example":"Kampala","description":"Filter by city."},
    {"name":"country","in":"query","type":"string","required":false,"example":"Uganda","description":"Filter by country."},
    {"name":"limit","in":"query","type":"integer","required":false,"default":25,"description":"1 to 100."},
    {"name":"offset","in":"query","type":"integer","required":false,"default":0,"description":"For paging."}]',
  '/supermarketera/stores?city=Kampala', 'public.era_h_supermarketera_stores', 120, 40),
 ('supermarketera.catalog', 'supermarketera', '/supermarketera/catalog', 'Product catalogue',
  'Wholesale catalogue items: names, brands, units and prices. No stock levels, cost prices or supplier identities.',
  '[{"name":"q","in":"query","type":"string","required":false,"example":"soap","description":"Search by name or brand."},
    {"name":"category","in":"query","type":"string","required":false,"example":"Bakery","description":"Filter by category."},
    {"name":"brand","in":"query","type":"string","required":false,"description":"Filter by brand."},
    {"name":"limit","in":"query","type":"integer","required":false,"default":25,"description":"1 to 100."},
    {"name":"offset","in":"query","type":"integer","required":false,"default":0,"description":"For paging."}]',
  '/supermarketera/catalog?q=bread', 'public.era_h_supermarketera_catalog', 60, 41),
 ('supermarketera.barcode', 'supermarketera', '/supermarketera/barcode/{code}', 'Look up a barcode',
  'Find a catalogue item by barcode or SKU.',
  '[{"name":"code","in":"path","type":"string","required":true,"example":"6001234567890","description":"Barcode or SKU. In the sandbox try 6001234567890."}]',
  '/supermarketera/barcode/6001234567890', 'public.era_h_supermarketera_barcode', 300, 42),
 ('supermarketera.categories', 'supermarketera', '/supermarketera/categories', 'Catalogue categories',
  'Every category with how many items it holds.', '[]', '/supermarketera/categories', 'public.era_h_supermarketera_categories', 300, 43),

 ('farmagentera.listings', 'farmagentera', '/farmagentera/listings', 'Marketplace listings',
  'Produce, land and services for sale or hire. No seller identity or contact details: people connect inside the app.',
  '[{"name":"type","in":"query","type":"string","required":false,"default":"all","example":"produce","description":"all, produce, land or service."},
    {"name":"q","in":"query","type":"string","required":false,"example":"matooke","description":"Search titles and descriptions."},
    {"name":"district","in":"query","type":"string","required":false,"example":"Mbarara","description":"Filter by district."},
    {"name":"limit","in":"query","type":"integer","required":false,"default":25,"description":"1 to 100."},
    {"name":"offset","in":"query","type":"integer","required":false,"default":0,"description":"For paging."}]',
  '/farmagentera/listings?type=produce', 'public.era_h_farmagentera_listings', 60, 50),
 ('farmagentera.price_board', 'farmagentera', '/farmagentera/price-board', 'Produce price board',
  'What each crop is asking right now: listing count, lowest, average and highest price, total quantity.',
  '[{"name":"district","in":"query","type":"string","required":false,"example":"Masaka","description":"Only listings in this district."},
    {"name":"limit","in":"query","type":"integer","required":false,"default":30,"description":"1 to 100."}]',
  '/farmagentera/price-board', 'public.era_h_farmagentera_price_board', 120, 51),
 ('farmagentera.crops', 'farmagentera', '/farmagentera/crops', 'Crop varieties',
  'Reference data: season, maturity days, expected yield, soil pH and water needs.',
  '[{"name":"q","in":"query","type":"string","required":false,"example":"maize","description":"Search by name."},
    {"name":"season","in":"query","type":"string","required":false,"description":"Filter by season."},
    {"name":"type","in":"query","type":"string","required":false,"example":"cereal","description":"Filter by crop type."},
    {"name":"limit","in":"query","type":"integer","required":false,"default":25,"description":"1 to 100."},
    {"name":"offset","in":"query","type":"integer","required":false,"default":0,"description":"For paging."}]',
  '/farmagentera/crops?q=maize', 'public.era_h_farmagentera_crops', 3600, 52)
ON CONFLICT (id) DO UPDATE SET
  app = EXCLUDED.app, path = EXCLUDED.path, summary = EXCLUDED.summary, description = EXCLUDED.description,
  params = EXCLUDED.params, example_path = EXCLUDED.example_path, handler = EXCLUDED.handler, sort = EXCLUDED.sort;

-- Handlers and helpers are internal: only era_api_call (SECURITY DEFINER) reaches them.
DO $$
DECLARE f RECORD;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND (p.proname LIKE 'era\_h\_%' OR p.proname LIKE 'era\_p\_%') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
  END LOOP;
END $$;

-- ################################ PART 3 of 4: 20261006100000_era_api_business.sql ################################
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

-- ################################ PART 4 of 4: 20261006100100_era_api_business_endpoints.sql ################################
-- ============================================================================
-- ERA API v2, part 2: the new endpoints. Needs 20261006100000_era_api_business.sql first.
--
--   Public (any key)        coin valuation / supply / convert, network fee estimate, integrity-chain proofs,
--                           journey and delivery quotes (BodaGoEra's real fare formula), product catalogue, clearance deals
--   Private (business keys) payment requests, inventory with expiry tracking, CMMS, booking requests
--
-- Every handler follows the v1 rules (see 20261005100100): sandbox = fixtures, bad input = 22023, missing = P0002.
-- Business handlers add three more, and the tests prove them:
--   1. the business comes from the KEY (params._business_id), never from anything the caller sends
--   2. nothing about people: no staff, riders, customers, payers
--   3. nothing here moves money or dispatches anyone. A payment request waits for its payer's own PIN; a booking
--      intent waits for the customer's own booking.
-- Re-running refreshes descriptions but keeps whatever an administrator switched.
-- ============================================================================

DO $$ BEGIN
  IF to_regclass('public.era_api_booking_intents') IS NULL THEN
    RAISE EXCEPTION 'Apply supabase/migrations/20261006100000_era_api_business.sql first.';
  END IF;
END $$;

-- ============================================================================ helpers

-- BodaGoEra's time-of-day multiplier (mirrors mbg_current_time_multiplier, but at any moment so a quote can be for later).
CREATE OR REPLACE FUNCTION public.era__time_multiplier(p_at TIMESTAMPTZ) RETURNS NUMERIC
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN EXTRACT(HOUR FROM (p_at AT TIME ZONE 'Africa/Kampala')) IN (7, 8, 17, 18, 19) THEN 1.3
              WHEN EXTRACT(HOUR FROM (p_at AT TIME ZONE 'Africa/Kampala')) >= 22 OR EXTRACT(HOUR FROM (p_at AT TIME ZONE 'Africa/Kampala')) < 5 THEN 1.2
              ELSE 1.0 END
$$;

CREATE OR REPLACE FUNCTION public.era__multiplier_reason(p_at TIMESTAMPTZ) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN EXTRACT(HOUR FROM (p_at AT TIME ZONE 'Africa/Kampala')) IN (7, 8) THEN 'morning peak'
              WHEN EXTRACT(HOUR FROM (p_at AT TIME ZONE 'Africa/Kampala')) IN (17, 18, 19) THEN 'evening peak'
              WHEN EXTRACT(HOUR FROM (p_at AT TIME ZONE 'Africa/Kampala')) >= 22 OR EXTRACT(HOUR FROM (p_at AT TIME ZONE 'Africa/Kampala')) < 5 THEN 'late night'
              ELSE 'standard' END
$$;

CREATE OR REPLACE FUNCTION public.era__haversine_km(lat1 NUMERIC, lng1 NUMERIC, lat2 NUMERIC, lng2 NUMERIC) RETURNS NUMERIC
LANGUAGE sql IMMUTABLE AS $$
  SELECT 2 * 6371 * asin(sqrt(
           power(sin(radians((lat2 - lat1)::DOUBLE PRECISION) / 2), 2)
         + cos(radians(lat1::DOUBLE PRECISION)) * cos(radians(lat2::DOUBLE PRECISION))
         * power(sin(radians((lng2 - lng1)::DOUBLE PRECISION) / 2), 2)))::NUMERIC
$$;

-- UGX per one unit of a currency (UGX itself is 1). NULL when the platform has no rate.
CREATE OR REPLACE FUNCTION public.era__ugx_per(p_cur TEXT) RETURNS NUMERIC
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v NUMERIC;
BEGIN
  IF upper(p_cur) = 'UGX' THEN RETURN 1; END IF;
  SELECT rate_to_ugx INTO v FROM public.ican_currency_rates WHERE currency_code = upper(p_cur) AND rate_to_ugx > 0 LIMIT 1;
  RETURN v;
END;
$$;

-- UGX price of 1 ICAN (latest stored), NULL if unavailable.
CREATE OR REPLACE FUNCTION public.era__ican_price_ugx() RETURNS NUMERIC
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT price_ugx FROM public.ican_coin_market_prices ORDER BY timestamp DESC LIMIT 1
$$;

-- "0.3476,32.5825" -> [lat, lng], validated.
CREATE OR REPLACE FUNCTION public.era__point(p_txt TEXT, p_name TEXT) RETURNS NUMERIC[]
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE m TEXT[]; la NUMERIC; ln NUMERIC;
BEGIN
  m := regexp_match(btrim(COALESCE(p_txt, '')), '^(-?[0-9]{1,3}(?:\.[0-9]{1,7})?)\s*[,;]\s*(-?[0-9]{1,3}(?:\.[0-9]{1,7})?)$');
  IF m IS NULL THEN
    RAISE EXCEPTION '% must look like "0.3476,32.5825" (latitude,longitude)', p_name USING ERRCODE = '22023';
  END IF;
  la := m[1]::NUMERIC; ln := m[2]::NUMERIC;
  IF la < -90 OR la > 90 OR ln < -180 OR ln > 180 THEN
    RAISE EXCEPTION '% is outside the valid latitude/longitude range', p_name USING ERRCODE = '22023';
  END IF;
  RETURN ARRAY[la, ln];
END;
$$;

-- A priced multi-leg ground journey. p_points is a JSON array of [lat, lng] pairs (2 to 5). Each leg is priced exactly the
-- way BodaGoEra's booking engine prices a ride: max(minimum, base + per-km x straight-line km) x time-of-day multiplier,
-- rounded to the nearest 100 UGX.
CREATE OR REPLACE FUNCTION public.era__quote(p_points JSONB, p_kind TEXT, p_at TIMESTAMPTZ) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_n INTEGER := jsonb_array_length(p_points);
  v_pre TEXT := CASE WHEN p_kind = 'cargo' THEN 'cargo' ELSE 'ride' END;
  v_base NUMERIC; v_per NUMERIC; v_min NUMERIC;
  v_mult NUMERIC := public.era__time_multiplier(p_at);
  i INTEGER; v_km NUMERIC; v_fare NUMERIC; v_min_leg NUMERIC;
  v_legs JSONB := '[]'::JSONB; v_total NUMERIC := 0; v_dist NUMERIC := 0; v_dur INTEGER := 0;
  v_ican NUMERIC := public.era__ican_price_ugx();
BEGIN
  SELECT MAX(value::NUMERIC) FILTER (WHERE key = v_pre || '.base_fare'),
         MAX(value::NUMERIC) FILTER (WHERE key = v_pre || '.per_km_rate'),
         MAX(value::NUMERIC) FILTER (WHERE key = v_pre || '.minimum_fare')
    INTO v_base, v_per, v_min
    FROM public.mbg_platform_settings
   WHERE key IN (v_pre || '.base_fare', v_pre || '.per_km_rate', v_pre || '.minimum_fare') AND value ~ '^[0-9]+(\.[0-9]+)?$';
  -- the same defaults the booking engine falls back to
  v_base := COALESCE(v_base, CASE WHEN v_pre = 'cargo' THEN 5000 ELSE 1000 END);
  v_per  := COALESCE(v_per,  CASE WHEN v_pre = 'cargo' THEN 2000 ELSE 1000 END);
  v_min  := COALESCE(v_min,  CASE WHEN v_pre = 'cargo' THEN 0 ELSE 2000 END);

  FOR i IN 0..v_n - 2 LOOP
    v_km := public.era__haversine_km((p_points -> i ->> 0)::NUMERIC, (p_points -> i ->> 1)::NUMERIC,
                                     (p_points -> (i + 1) ->> 0)::NUMERIC, (p_points -> (i + 1) ->> 1)::NUMERIC);
    IF v_km > 300 THEN RAISE EXCEPTION 'Leg % is % km. A single ground leg can be at most 300 km.', i + 1, round(v_km) USING ERRCODE = '22023'; END IF;
    v_min_leg := v_min;
    v_fare := round(GREATEST(v_min_leg, v_base + v_km * v_per) * v_mult / 100) * 100;
    v_total := v_total + v_fare; v_dist := v_dist + v_km;
    v_legs := v_legs || jsonb_build_object(
      'leg', i + 1,
      'from', jsonb_build_object('lat', (p_points -> i ->> 0)::NUMERIC, 'lng', (p_points -> i ->> 1)::NUMERIC),
      'to', jsonb_build_object('lat', (p_points -> (i + 1) ->> 0)::NUMERIC, 'lng', (p_points -> (i + 1) ->> 1)::NUMERIC),
      'distance_km', round(v_km, 2), 'duration_min', GREATEST(2, round(v_km / 25 * 60)), 'fare_ugx', v_fare);
    v_dur := v_dur + GREATEST(2, round(v_km / 25 * 60))::INTEGER;
  END LOOP;

  RETURN jsonb_build_object(
    'kind', p_kind, 'currency', 'UGX', 'priced_for', p_at,
    'time_multiplier', v_mult, 'multiplier_reason', public.era__multiplier_reason(p_at),
    'legs', v_legs, 'distance_km', round(v_dist, 2), 'duration_min', v_dur,
    'total_ugx', v_total, 'total_ican', CASE WHEN v_ican > 0 THEN round(v_total / v_ican, 4) END, 'ican_price_ugx', v_ican,
    'valid_for_minutes', 15,
    'notes', jsonb_build_array(
      'Distances are straight-line, the same way the booking engine measures them.',
      'The final fare is set when a rider is chosen: VIP, discount and return-trip riders adjust it.',
      'Ground legs only. Flights and ship cargo are quoted inside the BodaGoEra app.'));
END;
$$;

-- Expiry bands and the clearance ladder.
CREATE OR REPLACE FUNCTION public.era__expiry_band(p_days INTEGER) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_days IS NULL THEN 'no_expiry' WHEN p_days < 0 THEN 'expired' WHEN p_days <= 7 THEN 'critical'
              WHEN p_days <= 30 THEN 'soon' ELSE 'ok' END
$$;

CREATE OR REPLACE FUNCTION public.era__clearance_pct(p_days INTEGER) RETURNS INTEGER
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_days IS NULL THEN 0 WHEN p_days < 0 THEN 100 WHEN p_days <= 3 THEN 50 WHEN p_days <= 7 THEN 30
              WHEN p_days <= 14 THEN 20 WHEN p_days <= 30 THEN 10 ELSE 0 END
$$;

-- Today in Kampala (expiry dates are calendar dates).
CREATE OR REPLACE FUNCTION public.era__today() RETURNS DATE
LANGUAGE sql STABLE AS $$ SELECT (now() AT TIME ZONE 'Africa/Kampala')::DATE $$;

-- Straight-line or declining-balance book value of an asset.
CREATE OR REPLACE FUNCTION public.era__book_value(p_cost NUMERIC, p_salvage NUMERIC, p_life INTEGER, p_acquired DATE, p_method TEXT)
RETURNS NUMERIC LANGUAGE plpgsql STABLE AS $$
DECLARE v_age NUMERIC; v_salv NUMERIC := COALESCE(p_salvage, 0);
BEGIN
  IF p_cost IS NULL THEN RETURN NULL; END IF;
  IF p_life IS NULL OR p_life <= 0 OR p_acquired IS NULL THEN RETURN p_cost; END IF;
  v_age := GREATEST((public.era__today() - p_acquired) / 365.25, 0);
  IF lower(COALESCE(p_method, '')) LIKE '%declin%' THEN
    RETURN round(GREATEST(v_salv, p_cost * power(1 - LEAST(2.0 / p_life, 1), v_age)), 2);
  END IF;
  RETURN round(GREATEST(v_salv, p_cost - (p_cost - v_salv) * LEAST(v_age / p_life, 1)), 2);
END;
$$;

-- Products of the business's stores with stock and expiry worked out. All the inventory endpoints read this.
CREATE OR REPLACE FUNCTION public.era__biz_stock(p_business UUID)
RETURNS TABLE (product_id UUID, name TEXT, sku TEXT, barcode TEXT, category TEXT, unit TEXT, stock NUMERIC, reserved NUMERIC,
               available NUMERIC, reorder_at NUMERIC, low_stock BOOLEAN, out_of_stock BOOLEAN, expiry_date DATE,
               days_to_expiry INTEGER, expiry_status TEXT, selling_price NUMERIC, cost_price NUMERIC,
               stock_value_at_cost NUMERIC, batches INTEGER)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH sm AS (SELECT s AS id FROM public.era__biz_supermarkets(p_business) s),
  batch AS (
    SELECT b.product_id AS pid,
           MIN(b.expiry_date) FILTER (WHERE b.current_stock > 0 AND COALESCE(b.status, 'active') NOT IN ('withdrawn', 'disposed')) AS next_expiry,
           SUM(b.current_stock) FILTER (WHERE COALESCE(b.status, 'active') NOT IN ('withdrawn', 'disposed')) AS batch_stock,
           COUNT(*) FILTER (WHERE b.current_stock > 0 AND COALESCE(b.status, 'active') NOT IN ('withdrawn', 'disposed')) AS live_batches
      FROM public.product_inventory_batches b WHERE b.supermarket_id IN (SELECT id FROM sm) GROUP BY b.product_id),
  base AS (
    SELECT p.id AS pid, p.name AS pname, p.sku::TEXT AS psku, p.barcode AS pbarcode, p.category AS pcat, p.unit AS punit,
           COALESCE(inv.cs, bt.batch_stock, 0) AS stk, COALESCE(inv.rs, 0) AS rsv,
           COALESCE(inv.rp, inv.ms, p.reorder_level) AS rorder,
           COALESCE(bt.next_expiry, p.expiry_date) AS exp, COALESCE(bt.live_batches, 0)::INTEGER AS nb,
           p.selling_price AS sp, p.cost_price AS cp
      FROM public.products p
      LEFT JOIN LATERAL (SELECT SUM(COALESCE(i.current_stock, i.quantity)) AS cs, SUM(i.reserved_stock) AS rs,
                                MAX(i.reorder_point) AS rp, MAX(i.minimum_stock) AS ms
                           FROM public.inventory i WHERE i.product_id = p.id AND i.supermarket_id = p.supermarket_id) inv ON TRUE
      LEFT JOIN batch bt ON bt.pid = p.id
     WHERE p.supermarket_id IN (SELECT id FROM sm) AND p.is_active IS NOT FALSE
       AND COALESCE(p.is_service, FALSE) = FALSE AND COALESCE(p.track_inventory, TRUE))
  SELECT pid, pname, psku, pbarcode, pcat, punit, stk, rsv, GREATEST(stk - rsv, 0),
         rorder, (rorder IS NOT NULL AND GREATEST(stk - rsv, 0) <= rorder AND stk > 0), (stk <= 0),
         exp, CASE WHEN exp IS NULL THEN NULL ELSE (exp - public.era__today()) END,
         public.era__expiry_band(CASE WHEN exp IS NULL THEN NULL ELSE (exp - public.era__today()) END),
         sp, cp, round(COALESCE(stk, 0) * COALESCE(cp, 0), 2), nb
    FROM base
$$;

-- Batch- and product-level lines that carry an expiry date, with clearance advice. FEFO order is the caller's ORDER BY.
CREATE OR REPLACE FUNCTION public.era__biz_expiring(p_business UUID)
RETURNS TABLE (product_id UUID, name TEXT, sku TEXT, category TEXT, unit TEXT, batch_number TEXT, expiry_date DATE, days_left INTEGER,
               expiry_status TEXT, stock NUMERIC, unit_cost NUMERIC, selling_price NUMERIC, value_at_risk NUMERIC,
               discount_pct INTEGER, suggested_price NUMERIC, action TEXT, clearance_published BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH sm AS (SELECT s AS id FROM public.era__biz_supermarkets(p_business) s),
  lines AS (
    SELECT p.id AS pid, p.name AS pname, p.sku::TEXT AS psku, p.category AS pcat, p.unit AS punit, b.batch_number AS bn,
           b.expiry_date AS ex, b.current_stock AS stk, COALESCE(b.purchase_price, p.cost_price) AS uc,
           COALESCE(b.selling_price, p.selling_price) AS sp, (p.clearance_published_at IS NOT NULL) AS pub
      FROM public.product_inventory_batches b JOIN public.products p ON p.id = b.product_id
     WHERE b.supermarket_id IN (SELECT id FROM sm) AND b.current_stock > 0 AND b.expiry_date IS NOT NULL
       AND COALESCE(b.status, 'active') NOT IN ('withdrawn', 'disposed') AND p.is_active IS NOT FALSE
    UNION ALL
    SELECT p.id, p.name, p.sku::TEXT, p.category, p.unit, NULL, p.expiry_date,
           COALESCE(inv.cs, 0), p.cost_price, p.selling_price, (p.clearance_published_at IS NOT NULL)
      FROM public.products p
      LEFT JOIN LATERAL (SELECT SUM(COALESCE(i.current_stock, i.quantity)) AS cs FROM public.inventory i
                          WHERE i.product_id = p.id AND i.supermarket_id = p.supermarket_id) inv ON TRUE
     WHERE p.supermarket_id IN (SELECT id FROM sm) AND p.expiry_date IS NOT NULL AND p.is_active IS NOT FALSE
       AND COALESCE(inv.cs, 0) > 0
       AND NOT EXISTS (SELECT 1 FROM public.product_inventory_batches b2
                        WHERE b2.product_id = p.id AND b2.current_stock > 0 AND b2.expiry_date IS NOT NULL
                          AND COALESCE(b2.status, 'active') NOT IN ('withdrawn', 'disposed'))),
  calc AS (SELECT l.*, (l.ex - public.era__today()) AS dl FROM lines l)
  SELECT pid, pname, psku, pcat, punit, bn, ex, dl, public.era__expiry_band(dl), stk, uc, sp,
         round(stk * COALESCE(uc, 0), 2), public.era__clearance_pct(dl),
         CASE WHEN public.era__clearance_pct(dl) IN (0, 100) OR sp IS NULL THEN NULL
              ELSE GREATEST(COALESCE(uc, 0),
                            CASE WHEN sp >= 1000 THEN round(sp * (1 - public.era__clearance_pct(dl) / 100.0) / 100) * 100
                                 ELSE round(sp * (1 - public.era__clearance_pct(dl) / 100.0), 2) END) END,
         CASE WHEN dl < 0 THEN 'withdraw' WHEN public.era__clearance_pct(dl) > 0 THEN 'discount' ELSE 'monitor' END,
         pub
    FROM calc
$$;

-- ============================================================================ ICANERA: coin creation and valuation, chain

-- How the ICAN price is made, step by step. The same formula the platform's price engine uses, with its inputs shown.
CREATE OR REPLACE FUNCTION public.era_h_icanera_coin_valuation(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_floor NUMERIC := 5000;
  v_init NUMERIC := 3700; v_curr NUMERIC := 3700; v_usd_cpi NUMERIC := 0; v_ugx_cpi NUMERIC := 0;
  v_anchor TIMESTAMPTZ := '2026-01-01T00:00:00Z';
  v_years NUMERIC; v_base_usd NUMERIC; v_fx_floor NUMERIC; v_usd_leg NUMERIC; v_ugx_leg NUMERIC; v_fair NUMERIC;
  v_tx BIGINT := 0; v_vol NUMERIC := 0; v_holders BIGINT := 0;
  m RECORD;
BEGIN
  IF p_sandbox THEN
    RETURN jsonb_build_object(
      'asset', 'ICAN', 'method', 'floor + FX protection + inflation, whichever protects holders more',
      'floor_ugx', 5000, 'floor_usd_value', 1.351351, 'ugx_per_usd_at_launch', 3700, 'ugx_per_usd_now', 3987,
      'fx_adjusted_floor_ugx', 5387.84, 'usd_inflation_pct', 3.1, 'ugx_inflation_pct', 4.9, 'years_since_anchor', 0.76,
      'usd_leg_ugx', 5516.2, 'ugx_leg_ugx', 5185.9, 'fair_price_ugx', 5516.2, 'fair_price_usd', 1.3835,
      'market_price_ugx', 5508.42, 'market_vs_fair_pct', -0.14,
      'activity', jsonb_build_object('completed_transactions', 272, 'volume_ican', 1840.5, 'holders', 37),
      'as_of', now(), 'source', 'sandbox-fixture');
  END IF;

  SELECT COALESCE(initial_rate_to_ugx, rate_to_ugx, 3700) AS i, COALESCE(rate_to_ugx, 3700) AS c,
         GREATEST(COALESCE(local_inflation_pct, 0), 0) AS cpi, COALESCE(stability_anchor_at, v_anchor) AS a INTO m
    FROM public.ican_currency_rates WHERE currency_code = 'USD' LIMIT 1;
  IF FOUND THEN v_init := m.i; v_curr := m.c; v_usd_cpi := m.cpi; v_anchor := m.a; END IF;
  IF v_init <= 0 THEN v_init := 3700; END IF;
  IF v_curr <= 0 THEN v_curr := v_init; END IF;
  SELECT GREATEST(COALESCE(local_inflation_pct, 0), 0) INTO v_ugx_cpi FROM public.ican_currency_rates WHERE currency_code = 'UGX' LIMIT 1;

  v_years := GREATEST(0, extract(epoch FROM (now() - v_anchor)) / 31557600.0);
  v_base_usd := v_floor / v_init;
  v_fx_floor := v_base_usd * v_curr;
  v_usd_leg := v_fx_floor * power(1 + COALESCE(v_usd_cpi, 0) / 100.0, v_years);
  v_ugx_leg := v_floor * power(1 + COALESCE(v_ugx_cpi, 0) / 100.0, v_years);
  v_fair := GREATEST(v_usd_leg, v_ugx_leg);

  SELECT COUNT(*), COALESCE(SUM(ican_amount), 0) INTO v_tx, v_vol FROM public.ican_coin_transactions WHERE status IN ('completed', 'confirmed', 'success');
  SELECT COUNT(*) INTO v_holders FROM public.user_accounts WHERE COALESCE(ican_coin_balance, 0) > 0;

  RETURN jsonb_build_object(
    'asset', 'ICAN', 'method', 'floor + FX protection + inflation, whichever protects holders more',
    'floor_ugx', v_floor, 'floor_usd_value', round(v_base_usd, 6), 'ugx_per_usd_at_launch', round(v_init, 2), 'ugx_per_usd_now', round(v_curr, 2),
    'fx_adjusted_floor_ugx', round(v_fx_floor, 2), 'usd_inflation_pct', v_usd_cpi, 'ugx_inflation_pct', COALESCE(v_ugx_cpi, 0),
    'years_since_anchor', round(v_years, 4), 'usd_leg_ugx', round(v_usd_leg, 2), 'ugx_leg_ugx', round(v_ugx_leg, 2),
    'fair_price_ugx', round(v_fair, 2), 'fair_price_usd', round(v_fair / v_curr, 6),
    'market_price_ugx', public.era__ican_price_ugx(),
    'market_vs_fair_pct', CASE WHEN public.era__ican_price_ugx() IS NOT NULL THEN round((public.era__ican_price_ugx() - v_fair) / v_fair * 100, 3) END,
    'activity', jsonb_build_object('completed_transactions', v_tx, 'volume_ican', v_vol, 'holders', v_holders),
    'as_of', now(), 'source', 'derived');
END;
$$;

-- Aggregate supply: nothing per person.
CREATE OR REPLACE FUNCTION public.era_h_icanera_coin_supply(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r RECORD;
BEGIN
  IF p_sandbox THEN
    RETURN jsonb_build_object('held_in_wallets', 4521.8, 'holders', 37, 'total_purchased', 5210.3, 'total_sold', 688.5,
      'net_issued_through_platform', 4521.8, 'transactions_30d', jsonb_build_object('purchase', 19, 'transfer', 9, 'sale', 1), 'as_of', now(), 'source', 'sandbox-fixture');
  END IF;
  SELECT COALESCE(SUM(ican_coin_balance), 0) AS held, COUNT(*) FILTER (WHERE COALESCE(ican_coin_balance, 0) > 0) AS holders,
         COALESCE(SUM(ican_coin_total_purchased), 0) AS bought, COALESCE(SUM(ican_coin_total_sold), 0) AS sold INTO r
    FROM public.user_accounts;
  RETURN jsonb_build_object(
    'held_in_wallets', r.held, 'holders', r.holders, 'total_purchased', r.bought, 'total_sold', r.sold,
    'net_issued_through_platform', r.bought - r.sold,
    'transactions_30d', COALESCE((SELECT jsonb_object_agg(t, n) FROM (
        SELECT COALESCE(type, transaction_type, 'other') AS t, COUNT(*) AS n FROM public.ican_coin_transactions
         WHERE status IN ('completed', 'confirmed', 'success') AND COALESCE(timestamp, created_at) > now() - INTERVAL '30 days' GROUP BY 1) x), '{}'::JSONB),
    'as_of', now(), 'source', 'derived');
END;
$$;

-- Convert between ICAN and a currency at the live price. Indicative: the platform's fee or spread applies when buying or selling.
CREATE OR REPLACE FUNCTION public.era_h_icanera_coin_convert(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_from TEXT := upper(COALESCE(public.era_p_text(p, 'from', 12), ''));
  v_to TEXT := upper(COALESCE(public.era_p_text(p, 'to', 12), ''));
  v_amt NUMERIC := public.era_p_num(p, 'amount', 0.00000001, 1000000000, TRUE);
  v_cur TEXT; v_ugx_per NUMERIC; v_price_cur NUMERIC; v_ican_ugx NUMERIC; v_out NUMERIC;
  v_fx JSONB := '{"USD":3987.0,"EUR":4485.0,"GBP":5275.0,"KES":30.8,"UGX":1,"NGN":2.6,"ZAR":218.0,"JPY":25.3}';
BEGIN
  IF (v_from = 'ICAN') = (v_to = 'ICAN') THEN
    RAISE EXCEPTION 'Exactly one of from / to must be ICAN, and the other a 3-letter currency such as UGX.' USING ERRCODE = '22023';
  END IF;
  v_cur := CASE WHEN v_from = 'ICAN' THEN v_to ELSE v_from END;
  IF v_cur !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'The currency must be a 3-letter code such as UGX or USD.' USING ERRCODE = '22023'; END IF;

  IF p_sandbox THEN
    IF NOT (v_fx ? v_cur) THEN RAISE EXCEPTION 'No ICAN price for %. Sandbox knows USD, EUR, GBP, KES, UGX, NGN, ZAR, JPY.', v_cur USING ERRCODE = 'P0002'; END IF;
    v_ican_ugx := 5508.42; v_ugx_per := (v_fx ->> v_cur)::NUMERIC;
  ELSE
    v_ican_ugx := public.era__ican_price_ugx();
    v_ugx_per := public.era__ugx_per(v_cur);
    IF v_ican_ugx IS NULL OR v_ugx_per IS NULL THEN RAISE EXCEPTION 'No ICAN price for currency %.', v_cur USING ERRCODE = 'P0002'; END IF;
  END IF;
  v_price_cur := v_ican_ugx / v_ugx_per;
  v_out := CASE WHEN v_from = 'ICAN' THEN v_amt * v_price_cur ELSE v_amt / v_price_cur END;
  RETURN jsonb_build_object('from', v_from, 'to', v_to, 'amount', v_amt, 'result', round(v_out, 8),
    'price', jsonb_build_object('currency', v_cur, 'per_ican', round(v_price_cur, 6)), 'as_of', now(),
    'note', 'Indicative. A fee or spread applies when you actually buy or sell ICAN.');
END;
$$;

-- Network fee estimate. Honest by construction: gas UNITS are typical figures, the gas price and coin price are what an
-- administrator last entered (shown with their age). ICAN-to-ICAN transfers inside the platform do not pay gas.
CREATE OR REPLACE FUNCTION public.era_h_icanera_chain_gas(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_net TEXT := lower(COALESCE(public.era_p_text(p, 'network', 30), 'ethereum'));
  v_op TEXT := lower(public.era_p_text(p, 'operation', 30));
  v_ops JSONB; v_out JSONB := '[]'::JSONB; o RECORD; v_sym TEXT := 'ETH'; v_updated TIMESTAMPTZ;
  v_gwei NUMERIC; v_usd NUMERIC; v_ican_usd NUMERIC; v_native NUMERIC; v_fee_usd NUMERIC; v_state TEXT; v_age NUMERIC;
BEGIN
  v_ops := '[{"operation":"native_transfer","units":21000,"what":"Send the native coin (e.g. ETH)"},
             {"operation":"token_transfer","units":65000,"what":"Send an ERC-20 token such as ICAN"},
             {"operation":"token_approve","units":46000,"what":"Approve a contract to spend a token"},
             {"operation":"contract_call","units":120000,"what":"A typical contract interaction"},
             {"operation":"contract_deploy","units":1500000,"what":"Deploy a small contract"}]'::JSONB;
  IF v_op IS NOT NULL AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_ops) e WHERE e ->> 'operation' = v_op) THEN
    RAISE EXCEPTION 'operation must be one of native_transfer, token_transfer, token_approve, contract_call, contract_deploy' USING ERRCODE = '22023';
  END IF;

  IF p_sandbox THEN
    v_gwei := 18; v_usd := 3100; v_ican_usd := 1.3815; v_state := 'configured'; v_age := 2.5;
  ELSE
    SELECT native_symbol, gas_price_gwei, native_usd, updated_at INTO v_sym, v_gwei, v_usd, v_updated
      FROM public.era_api_chain_config WHERE network = v_net;
    IF NOT FOUND THEN RAISE EXCEPTION 'No fee data for network %.', v_net USING ERRCODE = 'P0002'; END IF;
    v_age := round(extract(epoch FROM (now() - v_updated)) / 3600, 1);
    v_state := CASE WHEN v_gwei IS NULL OR v_usd IS NULL THEN 'unconfigured' WHEN v_age > 24 THEN 'stale' ELSE 'configured' END;
    SELECT price_usd INTO v_ican_usd FROM public.ican_coin_market_prices ORDER BY timestamp DESC LIMIT 1;
  END IF;

  FOR o IN SELECT e ->> 'operation' AS op, (e ->> 'units')::BIGINT AS units, e ->> 'what' AS what FROM jsonb_array_elements(v_ops) e
            WHERE v_op IS NULL OR e ->> 'operation' = v_op LOOP
    v_native := CASE WHEN v_gwei IS NULL THEN NULL ELSE o.units * v_gwei / 1e9 END;
    v_fee_usd := CASE WHEN v_native IS NULL OR v_usd IS NULL THEN NULL ELSE v_native * v_usd END;
    v_out := v_out || jsonb_build_object('operation', o.op, 'what', o.what, 'gas_units', o.units,
      'fee_native', CASE WHEN v_native IS NULL THEN NULL ELSE round(v_native, 8) END,
      'fee_usd', CASE WHEN v_fee_usd IS NULL THEN NULL ELSE round(v_fee_usd, 4) END,
      'fee_ican', CASE WHEN v_fee_usd IS NULL OR v_ican_usd IS NULL OR v_ican_usd <= 0 THEN NULL ELSE round(v_fee_usd / v_ican_usd, 6) END);
  END LOOP;

  RETURN jsonb_build_object('network', v_net, 'native_symbol', v_sym, 'state', v_state,
    'gas_price_gwei', v_gwei, 'native_usd', v_usd, 'inputs_age_hours', v_age, 'estimates', v_out,
    'confidence', 'estimate',
    'notes', jsonb_build_array(
      'An estimate: real gas depends on the network at the moment you send.',
      'ICAN-to-ICAN transfers inside the platform are ledger entries anchored in the integrity chain and pay no gas.',
      CASE WHEN v_state = 'unconfigured' THEN 'The platform team has not entered a gas price yet, so only the gas units are shown.'
           WHEN v_state = 'stale' THEN 'The gas price is more than 24 hours old.' ELSE 'Gas price entered by the platform team.' END));
END;
$$;

-- The integrity chain: every recorded ICAN event is hash-linked to the one before it, so tampering is detectable.
CREATE OR REPLACE FUNCTION public.era_h_icanera_chain_head(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r RECORD;
BEGIN
  IF p_sandbox THEN
    RETURN jsonb_build_object('seq', 1358, 'chain_hash', repeat('ab', 32), 'events', 1239, 'created_at', now(), 'source', 'sandbox-fixture');
  END IF;
  SELECT seq, chain_hash, created_at INTO r FROM public.icaneracoin_integrity_chain ORDER BY seq DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'The integrity chain is empty.' USING ERRCODE = 'P0002'; END IF;
  RETURN jsonb_build_object('seq', r.seq, 'chain_hash', r.chain_hash, 'events', (SELECT COUNT(*) FROM public.icaneracoin_integrity_chain), 'created_at', r.created_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.era_h_icanera_chain_proof(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_seq BIGINT; r RECORD; v_prev RECORD;
BEGIN
  IF COALESCE(p ->> 'seq', '') !~ '^[0-9]{1,12}$' THEN RAISE EXCEPTION 'seq must be a whole number' USING ERRCODE = '22023'; END IF;
  v_seq := (p ->> 'seq')::BIGINT;
  IF p_sandbox THEN
    RETURN jsonb_build_object('seq', v_seq, 'event_type', 'transfer', 'created_at', now(), 'previous_seq', v_seq - 1,
      'previous_hash', repeat('cd', 32), 'chain_hash', repeat('ef', 32), 'links_to_previous', TRUE, 'source', 'sandbox-fixture');
  END IF;
  SELECT seq, event_type, created_at, previous_hash, chain_hash INTO r FROM public.icaneracoin_integrity_chain WHERE seq = v_seq;
  IF NOT FOUND THEN RAISE EXCEPTION 'No event with seq %.', v_seq USING ERRCODE = 'P0002'; END IF;
  SELECT seq, chain_hash INTO v_prev FROM public.icaneracoin_integrity_chain WHERE seq < v_seq ORDER BY seq DESC LIMIT 1;
  -- only the hashes and the event type are shown: never the underlying record
  RETURN jsonb_build_object('seq', r.seq, 'event_type', r.event_type, 'created_at', r.created_at,
    'previous_seq', v_prev.seq, 'previous_hash', r.previous_hash, 'chain_hash', r.chain_hash,
    'links_to_previous', v_prev.seq IS NULL OR v_prev.chain_hash = r.previous_hash);
END;
$$;

-- ============================================================================ BODAGOERA: journey and delivery quotes

-- Replaces the v1 fare estimate with the real formula (time-of-day multiplier, rounded to 100).
CREATE OR REPLACE FUNCTION public.era_h_bodagoera_fare_estimate(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_km NUMERIC := public.era_p_num(p, 'km', 0.1, 300, TRUE);
  v_kind TEXT := lower(COALESCE(public.era_p_text(p, 'kind', 12), 'ride'));
  v_at TIMESTAMPTZ := now();
  v_pre TEXT; v_base NUMERIC; v_per NUMERIC; v_min NUMERIC; v_mult NUMERIC; v_fare NUMERIC;
BEGIN
  IF v_kind NOT IN ('ride', 'cargo') THEN RAISE EXCEPTION 'kind must be ride or cargo' USING ERRCODE = '22023'; END IF;
  IF COALESCE(p ->> 'at', '') <> '' THEN
    BEGIN v_at := (p ->> 'at')::TIMESTAMPTZ; EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'at must be an ISO date-time such as 2026-10-06T08:30:00+03:00' USING ERRCODE = '22023'; END;
  END IF;
  v_pre := v_kind;
  IF p_sandbox THEN
    v_base := CASE v_kind WHEN 'ride' THEN 1000 ELSE 5000 END; v_per := CASE v_kind WHEN 'ride' THEN 1000 ELSE 2000 END;
    v_min := CASE v_kind WHEN 'ride' THEN 2000 ELSE 0 END;
  ELSE
    SELECT MAX(value::NUMERIC) FILTER (WHERE key = v_pre || '.base_fare'), MAX(value::NUMERIC) FILTER (WHERE key = v_pre || '.per_km_rate'),
           MAX(value::NUMERIC) FILTER (WHERE key = v_pre || '.minimum_fare')
      INTO v_base, v_per, v_min FROM public.mbg_platform_settings
     WHERE key IN (v_pre || '.base_fare', v_pre || '.per_km_rate', v_pre || '.minimum_fare') AND value ~ '^[0-9]+(\.[0-9]+)?$';
    v_base := COALESCE(v_base, CASE WHEN v_kind = 'cargo' THEN 5000 ELSE 1000 END);
    v_per := COALESCE(v_per, CASE WHEN v_kind = 'cargo' THEN 2000 ELSE 1000 END);
    v_min := COALESCE(v_min, CASE WHEN v_kind = 'cargo' THEN 0 ELSE 2000 END);
  END IF;
  v_mult := public.era__time_multiplier(v_at);
  v_fare := round(GREATEST(COALESCE(v_min, 0), v_base + v_per * v_km) * v_mult / 100) * 100;
  RETURN jsonb_build_object('kind', v_kind, 'distance_km', v_km, 'currency', 'UGX', 'estimated_fare', v_fare,
    'priced_for', v_at, 'time_multiplier', v_mult, 'multiplier_reason', public.era__multiplier_reason(v_at),
    'breakdown', jsonb_build_object('base_fare', v_base, 'per_km_rate', v_per, 'minimum_fare', v_min),
    'note', 'The booking engine''s own formula. VIP, discount and return-trip riders adjust the final fare.');
END;
$$;

-- A priced journey or delivery between two or more points.
CREATE OR REPLACE FUNCTION public.era_h_bodagoera_journey_quote(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_kind TEXT := lower(COALESCE(public.era_p_text(p, 'kind', 12), 'ride'));
  v_pts JSONB := '[]'::JSONB; v_at TIMESTAMPTZ := now(); s TEXT; pt NUMERIC[];
BEGIN
  IF v_kind NOT IN ('ride', 'delivery', 'cargo') THEN RAISE EXCEPTION 'kind must be ride, delivery or cargo' USING ERRCODE = '22023'; END IF;
  pt := public.era__point(p ->> 'from', 'from'); v_pts := v_pts || jsonb_build_array(jsonb_build_array(pt[1], pt[2]));
  IF COALESCE(p ->> 'stops', '') <> '' THEN
    IF array_length(string_to_array(p ->> 'stops', '|'), 1) > 3 THEN RAISE EXCEPTION 'At most 3 stops are allowed.' USING ERRCODE = '22023'; END IF;
    FOREACH s IN ARRAY string_to_array(p ->> 'stops', '|') LOOP
      pt := public.era__point(s, 'stops'); v_pts := v_pts || jsonb_build_array(jsonb_build_array(pt[1], pt[2]));
    END LOOP;
  END IF;
  pt := public.era__point(p ->> 'to', 'to'); v_pts := v_pts || jsonb_build_array(jsonb_build_array(pt[1], pt[2]));
  IF COALESCE(p ->> 'at', '') <> '' THEN
    BEGIN v_at := (p ->> 'at')::TIMESTAMPTZ; EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'at must be an ISO date-time such as 2026-10-06T08:30:00+03:00' USING ERRCODE = '22023'; END;
    IF v_at < now() - INTERVAL '1 hour' OR v_at > now() + INTERVAL '14 days' THEN
      RAISE EXCEPTION 'at must be within the next 14 days.' USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN public.era__quote(v_pts, v_kind, v_at);
END;
$$;

-- ============================================================================ SUPERMARKETERA: products across every category

CREATE OR REPLACE FUNCTION public.era_h_supermarketera_products(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_q TEXT := public.era_p_text(p, 'q', 60); v_cat TEXT := public.era_p_text(p, 'category', 60);
  v_store TEXT := public.era_p_text(p, 'store', 60);
  v_limit INTEGER := public.era_p_int(p, 'limit', 25, 1, 100); v_offset INTEGER := public.era_p_int(p, 'offset', 0, 0, 100000);
BEGIN
  IF p_sandbox THEN
    RETURN COALESCE((SELECT jsonb_agg(x) FROM (
      SELECT * FROM jsonb_to_recordset('[
        {"id":"8e1d0000-0000-4000-8000-000000000001","name":"Sliced Bread 600g","category":"Bakery","brand":"Daily Loaf","unit":"loaf","price":4800,"currency":"UGX","barcode":"6001234567890","store":"Kampala Fresh Mart","city":"Kampala","expiry_date":null,"clearance":null},
        {"id":"8e1d0000-0000-4000-8000-000000000002","name":"Fresh Milk 1L","category":"Dairy","brand":"Farm Gold","unit":"litre","price":3200,"currency":"UGX","barcode":"6009988776655","store":"Kampala Fresh Mart","city":"Kampala","expiry_date":"2026-10-12","clearance":{"original_price":4000}},
        {"id":"8e1d0000-0000-4000-8000-000000000003","name":"Cooking Gas 6kg refill","category":"Household","brand":"SafeGas","unit":"cylinder","price":68000,"currency":"UGX","barcode":null,"store":"Entebbe Corner Shop","city":"Entebbe","expiry_date":null,"clearance":null}]'::JSONB)
        AS t(id UUID, name TEXT, category TEXT, brand TEXT, unit TEXT, price NUMERIC, currency TEXT, barcode TEXT, store TEXT, city TEXT, expiry_date DATE, clearance JSONB)
       WHERE (v_q IS NULL OR name ILIKE public.era_p_like(v_q)) AND (v_cat IS NULL OR category ILIKE v_cat) AND (v_store IS NULL OR store ILIKE public.era_p_like(v_store))) x), '[]'::JSONB);
  END IF;
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (
    SELECT pr.id, pr.name, pr.category, pr.brand, pr.unit, pr.selling_price AS price, COALESCE(s.price_currency, 'UGX') AS currency,
           pr.barcode, pr.image_url, pr.expiry_date, s.name AS store, s.city,
           CASE WHEN pr.clearance_published_at IS NOT NULL THEN jsonb_build_object('original_price', pr.clearance_original_price, 'published_at', pr.clearance_published_at) END AS clearance
      FROM public.products pr JOIN public.supermarkets s ON s.id = pr.supermarket_id
     WHERE pr.is_active IS NOT FALSE AND COALESCE(pr.is_service, FALSE) = FALSE AND pr.selling_price IS NOT NULL
       AND s.is_active IS NOT FALSE AND COALESCE(s.status, 'active') NOT IN ('suspended', 'rejected', 'pending')
       AND (pr.expiry_date IS NULL OR pr.expiry_date >= public.era__today())
       AND (v_q IS NULL OR pr.name ILIKE public.era_p_like(v_q) OR pr.brand ILIKE public.era_p_like(v_q))
       AND (v_cat IS NULL OR pr.category ILIKE v_cat) AND (v_store IS NULL OR s.name ILIKE public.era_p_like(v_store))
     ORDER BY pr.name LIMIT v_limit OFFSET v_offset) x), '[]'::JSONB);
END;
$$;

-- Deals the stores have published: reduced prices on stock approaching its expiry date.
CREATE OR REPLACE FUNCTION public.era_h_supermarketera_clearance(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_city TEXT := public.era_p_text(p, 'city', 60); v_cat TEXT := public.era_p_text(p, 'category', 60);
  v_limit INTEGER := public.era_p_int(p, 'limit', 25, 1, 100); v_offset INTEGER := public.era_p_int(p, 'offset', 0, 0, 100000);
BEGIN
  IF p_sandbox THEN
    RETURN COALESCE((SELECT jsonb_agg(x) FROM (
      SELECT * FROM jsonb_to_recordset('[
        {"name":"Fresh Milk 1L","category":"Dairy","store":"Kampala Fresh Mart","city":"Kampala","price":3200,"original_price":4000,"discount_pct":20,"expiry_date":"2026-10-12","days_to_expiry":6,"currency":"UGX"},
        {"name":"Yoghurt 500ml","category":"Dairy","store":"Entebbe Corner Shop","city":"Entebbe","price":1800,"original_price":2500,"discount_pct":28,"expiry_date":"2026-10-09","days_to_expiry":3,"currency":"UGX"}]'::JSONB)
        AS t(name TEXT, category TEXT, store TEXT, city TEXT, price NUMERIC, original_price NUMERIC, discount_pct INTEGER, expiry_date DATE, days_to_expiry INTEGER, currency TEXT)
       WHERE (v_city IS NULL OR city ILIKE v_city) AND (v_cat IS NULL OR category ILIKE v_cat)) x), '[]'::JSONB);
  END IF;
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (
    SELECT pr.name, pr.category, s.name AS store, s.city, pr.selling_price AS price, pr.clearance_original_price AS original_price,
           CASE WHEN pr.clearance_original_price > 0 THEN round((1 - pr.selling_price / pr.clearance_original_price) * 100)::INTEGER END AS discount_pct,
           pr.expiry_date, CASE WHEN pr.expiry_date IS NOT NULL THEN pr.expiry_date - public.era__today() END AS days_to_expiry,
           COALESCE(s.price_currency, 'UGX') AS currency
      FROM public.products pr JOIN public.supermarkets s ON s.id = pr.supermarket_id
     WHERE pr.clearance_published_at IS NOT NULL AND pr.is_active IS NOT FALSE AND pr.selling_price IS NOT NULL
       AND s.is_active IS NOT FALSE AND COALESCE(s.status, 'active') NOT IN ('suspended', 'rejected', 'pending')
       AND (pr.expiry_date IS NULL OR pr.expiry_date >= public.era__today())
       AND (v_city IS NULL OR s.city ILIKE v_city) AND (v_cat IS NULL OR pr.category ILIKE v_cat)
     ORDER BY pr.expiry_date NULLS LAST, pr.name LIMIT v_limit OFFSET v_offset) x), '[]'::JSONB);
END;
$$;

-- Every category on the platform, wholesale catalogue and storefront shelves together.
CREATE OR REPLACE FUNCTION public.era_h_supermarketera_categories(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_sandbox THEN
    RETURN '[{"category":"Bakery","catalogue_items":42,"shelf_products":18},{"category":"Dairy","catalogue_items":31,"shelf_products":26},
             {"category":"Household","catalogue_items":64,"shelf_products":40},{"category":"Personal Care","catalogue_items":88,"shelf_products":35}]'::JSONB;
  END IF;
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.catalogue_items + x.shelf_products DESC, x.category) FROM (
    SELECT COALESCE(c.category, s.category) AS category, COALESCE(c.n, 0) AS catalogue_items, COALESCE(s.n, 0) AS shelf_products
      FROM (SELECT initcap(btrim(category)) AS category, COUNT(*) AS n FROM public.supplier_catalog_items
             WHERE is_available AND category IS NOT NULL GROUP BY 1) c
      FULL JOIN (SELECT initcap(btrim(category)) AS category, COUNT(*) AS n FROM public.products
                  WHERE is_active IS NOT FALSE AND category IS NOT NULL GROUP BY 1) s ON s.category = c.category) x), '[]'::JSONB);
END;
$$;

-- ============================================================================ BUSINESS (private): helper to read the key's business

CREATE OR REPLACE FUNCTION public.era__biz(p JSONB, p_sandbox BOOLEAN) RETURNS UUID
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v UUID;
BEGIN
  IF p_sandbox THEN RETURN NULL; END IF;
  v := NULLIF(p ->> '_business_id', '')::UUID;
  IF v IS NULL THEN RAISE EXCEPTION 'This key is not bound to a business.' USING ERRCODE = '42501'; END IF;
  RETURN v;
END;
$$;

-- ============================================================================ BUSINESS: payment requests

-- Creates a PAYMENT REQUEST (a QR / code). It does not move money: the payer scans it in the ICAN app and approves with their own PIN.
CREATE OR REPLACE FUNCTION public.era_h_business_payment_create(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b JSONB := COALESCE(p -> '_body', '{}'::JSONB);
  v_amount NUMERIC := public.era_p_num(b, 'amount', 0.01, 1000000000, TRUE);
  v_cur TEXT := upper(COALESCE(public.era_p_text(b, 'currency', 8), 'UGX'));
  v_desc TEXT := public.era_p_text(b, 'description', 140);
  v_class TEXT := lower(COALESCE(public.era_p_text(b, 'classification', 12), 'business'));
  v_mins INTEGER := public.era_p_int(b, 'expires_in_minutes', 60, 5, 1440);
  v_ref TEXT := public.era_p_text(b, 'external_ref', 64);
  v_max NUMERIC := NULLIF(p ->> '_max_amount_ugx', '')::NUMERIC;
  v_daily NUMERIC := NULLIF(p ->> '_daily_cap_ugx', '')::NUMERIC;
  v_key UUID := NULLIF(p ->> '_key_id', '')::UUID;
  v_biz UUID; v_owner UUID; v_name TEXT; v_rate NUMERIC; v_ugx NUMERIC; v_code TEXT; v_id BIGINT; v_exp TIMESTAMPTZ;
BEGIN
  IF v_cur NOT IN ('UGX', 'USD', 'KES', 'TZS', 'RWF') THEN RAISE EXCEPTION 'currency must be UGX, USD, KES, TZS or RWF' USING ERRCODE = '22023'; END IF;
  IF v_class NOT IN ('business', 'personal') THEN RAISE EXCEPTION 'classification must be business or personal' USING ERRCODE = '22023'; END IF;
  IF v_ref IS NOT NULL AND v_ref !~ '^[A-Za-z0-9._:-]{1,64}$' THEN RAISE EXCEPTION 'external_ref may only contain letters, digits and . _ : -' USING ERRCODE = '22023'; END IF;
  v_exp := now() + make_interval(mins => v_mins);

  IF p_sandbox THEN
    v_code := 'PAY_SANDBOX' || upper(public.era__rand(8));
    RETURN jsonb_build_object('payment_code', v_code, 'qr_payload', 'ICANPAY:' || v_code, 'amount', v_amount, 'currency', v_cur,
      'status', 'pending', 'expires_at', v_exp, 'description', v_desc, 'external_ref', v_ref, 'recipient', jsonb_build_object('business_name', 'Sample Business Ltd'),
      'sandbox', TRUE, 'next', 'Sandbox request: nothing was created. In live mode the payer scans the QR in the ICAN app and approves with their own PIN.');
  END IF;

  v_biz := public.era__biz(p, FALSE);
  v_owner := NULLIF(p ->> '_owner_user_id', '')::UUID;
  SELECT business_name INTO v_name FROM public.business_profiles WHERE id = v_biz AND user_id = v_owner;
  IF v_name IS NULL THEN RAISE EXCEPTION 'This key is not bound to a valid business.' USING ERRCODE = '42501'; END IF;

  v_rate := public.era__ugx_per(v_cur);
  IF v_rate IS NULL THEN RAISE EXCEPTION 'No exchange rate is available for %, so the cap cannot be checked.', v_cur USING ERRCODE = '22023'; END IF;
  v_ugx := round(v_amount * v_rate, 2);
  IF v_max IS NULL OR v_daily IS NULL THEN RAISE EXCEPTION 'This key has no payment caps and cannot create payment requests.' USING ERRCODE = '42501'; END IF;
  IF v_ugx > v_max THEN
    RAISE EXCEPTION 'That is about % UGX, above this key''s per-request cap of % UGX.', round(v_ugx), round(v_max) USING ERRCODE = 'ERA22';
  END IF;
  IF COALESCE((SELECT SUM(amount_ugx) FROM public.era_api_payment_links WHERE key_id = v_key AND created_at > now() - INTERVAL '24 hours'), 0) + v_ugx > v_daily THEN
    RAISE EXCEPTION 'This key''s daily cap of % UGX would be exceeded.', round(v_daily) USING ERRCODE = 'ERA29';
  END IF;
  -- velocity brake: a leaked key cannot flood a business with requests
  IF (SELECT COUNT(*) FROM public.era_api_payment_links WHERE key_id = v_key AND created_at > now() - INTERVAL '10 minutes') >= 20 THEN
    RAISE EXCEPTION 'Too many payment requests in the last 10 minutes. Wait a little.' USING ERRCODE = 'ERA29';
  END IF;
  IF (SELECT COUNT(*) FROM public.era_api_payment_links l JOIN public.payment_requests r ON r.id = l.payment_request_id
       WHERE l.business_profile_id = v_biz AND r.status = 'pending' AND r.expires_at > now()) >= 100 THEN
    RAISE EXCEPTION 'This business already has 100 open payment requests.' USING ERRCODE = 'ERA29';
  END IF;

  v_code := 'PAY_' || upper(public.era__rand(16));
  INSERT INTO public.payment_requests (user_id, payment_code, amount, currency, description, status, expires_at, payment_method,
                                       recipient_classification, recipient_business_profile_id, recipient_name)
  VALUES (v_owner, v_code, v_amount, v_cur, v_desc, 'pending', v_exp, 'ican', v_class, v_biz, v_name)
  RETURNING id INTO v_id;
  INSERT INTO public.era_api_payment_links (key_id, business_profile_id, payment_request_id, payment_code, amount_ugx, external_ref)
  VALUES (v_key, v_biz, v_id, v_code, v_ugx, v_ref);

  RETURN jsonb_build_object('payment_code', v_code, 'qr_payload', 'ICANPAY:' || v_code, 'amount', v_amount, 'currency', v_cur,
    'status', 'pending', 'expires_at', v_exp, 'description', v_desc, 'external_ref', v_ref,
    'recipient', jsonb_build_object('business_name', v_name),
    'next', 'Show the QR (or the code) to the payer. They scan it in the ICAN app and approve with their own PIN. Nothing moves until they do.');
END;
$$;

CREATE OR REPLACE FUNCTION public.era__payment_row(p_request_id BIGINT, p_ref TEXT) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('payment_code', r.payment_code, 'amount', r.amount, 'currency', r.currency, 'description', r.description,
           'status', CASE WHEN r.status = 'pending' AND r.expires_at <= now() THEN 'expired' ELSE r.status END,
           'created_at', r.created_at, 'expires_at', r.expires_at, 'paid_at', r.completed_at, 'external_ref', p_ref)
    FROM public.payment_requests r WHERE r.id = p_request_id
$$;

CREATE OR REPLACE FUNCTION public.era_h_business_payments(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status TEXT := lower(COALESCE(public.era_p_text(p, 'status', 12), 'all'));
  v_limit INTEGER := public.era_p_int(p, 'limit', 25, 1, 100); v_offset INTEGER := public.era_p_int(p, 'offset', 0, 0, 100000);
  v_biz UUID;
BEGIN
  IF v_status NOT IN ('all', 'pending', 'completed', 'expired') THEN RAISE EXCEPTION 'status must be all, pending, completed or expired' USING ERRCODE = '22023'; END IF;
  IF p_sandbox THEN
    RETURN COALESCE((SELECT jsonb_agg(x) FROM (
      SELECT * FROM jsonb_to_recordset('[
        {"payment_code":"PAY_SANDBOX0000A1","amount":45000,"currency":"UGX","description":"Order #1042","status":"completed","external_ref":"order-1042"},
        {"payment_code":"PAY_SANDBOX0000B2","amount":120000,"currency":"UGX","description":"Invoice 77","status":"pending","external_ref":"inv-77"},
        {"payment_code":"PAY_SANDBOX0000C3","amount":9000,"currency":"UGX","description":"Order #1039","status":"expired","external_ref":"order-1039"}]'::JSONB)
        AS t(payment_code TEXT, amount NUMERIC, currency TEXT, description TEXT, status TEXT, external_ref TEXT)
       WHERE v_status = 'all' OR status = v_status) x), '[]'::JSONB);
  END IF;
  v_biz := public.era__biz(p, FALSE);
  RETURN COALESCE((SELECT jsonb_agg(public.era__payment_row(l.payment_request_id, l.external_ref) ORDER BY l.created_at DESC) FROM (
    SELECT l2.* FROM public.era_api_payment_links l2 JOIN public.payment_requests r ON r.id = l2.payment_request_id
     WHERE l2.business_profile_id = v_biz
       AND (v_status = 'all'
            OR (v_status = 'pending' AND r.status = 'pending' AND r.expires_at > now())
            OR (v_status = 'expired' AND (r.status = 'expired' OR (r.status = 'pending' AND r.expires_at <= now())))
            OR (v_status = 'completed' AND r.status = 'completed'))
     ORDER BY l2.created_at DESC LIMIT v_limit OFFSET v_offset) l), '[]'::JSONB);
END;
$$;

CREATE OR REPLACE FUNCTION public.era_h_business_payment_get(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_code TEXT := upper(COALESCE(public.era_p_text(p, 'code', 60), '')); v_biz UUID; l public.era_api_payment_links;
BEGIN
  IF v_code !~ '^PAY_[A-Z0-9_]{4,48}$' THEN RAISE EXCEPTION 'code must look like PAY_ABC123...' USING ERRCODE = '22023'; END IF;
  IF p_sandbox THEN
    RETURN jsonb_build_object('payment_code', v_code, 'amount', 120000, 'currency', 'UGX', 'description', 'Invoice 77', 'status', 'pending', 'external_ref', 'inv-77');
  END IF;
  v_biz := public.era__biz(p, FALSE);
  SELECT * INTO l FROM public.era_api_payment_links WHERE payment_code = v_code AND business_profile_id = v_biz;
  IF NOT FOUND THEN RAISE EXCEPTION 'No payment request % for this business.', v_code USING ERRCODE = 'P0002'; END IF;
  RETURN public.era__payment_row(l.payment_request_id, l.external_ref);
END;
$$;

CREATE OR REPLACE FUNCTION public.era_h_business_payment_cancel(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_code TEXT := upper(COALESCE(public.era_p_text(p, 'code', 60), '')); v_biz UUID; l public.era_api_payment_links; n INTEGER;
BEGIN
  IF v_code !~ '^PAY_[A-Z0-9_]{4,48}$' THEN RAISE EXCEPTION 'code must look like PAY_ABC123...' USING ERRCODE = '22023'; END IF;
  IF p_sandbox THEN RETURN jsonb_build_object('payment_code', v_code, 'status', 'expired', 'cancelled', TRUE, 'sandbox', TRUE); END IF;
  v_biz := public.era__biz(p, FALSE);
  SELECT * INTO l FROM public.era_api_payment_links WHERE payment_code = v_code AND business_profile_id = v_biz;
  IF NOT FOUND THEN RAISE EXCEPTION 'No payment request % for this business.', v_code USING ERRCODE = 'P0002'; END IF;
  UPDATE public.payment_requests SET status = 'expired', updated_at = now() WHERE id = l.payment_request_id AND status = 'pending';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RAISE EXCEPTION 'Only a pending request can be cancelled. It is already paid or expired.' USING ERRCODE = 'ERA22'; END IF;
  RETURN jsonb_build_object('payment_code', v_code, 'status', 'expired', 'cancelled', TRUE);
END;
$$;

-- ============================================================================ BUSINESS: inventory with expiry tracking

CREATE OR REPLACE FUNCTION public.era_h_business_inventory(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_q TEXT := public.era_p_text(p, 'q', 60); v_cat TEXT := public.era_p_text(p, 'category', 60);
  v_status TEXT := lower(COALESCE(public.era_p_text(p, 'status', 12), 'all'));
  v_limit INTEGER := public.era_p_int(p, 'limit', 50, 1, 200); v_offset INTEGER := public.era_p_int(p, 'offset', 0, 0, 100000);
  v_biz UUID;
BEGIN
  IF v_status NOT IN ('all', 'low', 'out', 'expiring', 'expired', 'ok') THEN
    RAISE EXCEPTION 'status must be all, low, out, expiring, expired or ok' USING ERRCODE = '22023';
  END IF;
  IF p_sandbox THEN
    RETURN COALESCE((SELECT jsonb_agg(x) FROM (
      SELECT * FROM jsonb_to_recordset('[
        {"name":"Fresh Milk 1L","sku":"MLK-1L","category":"Dairy","unit":"litre","stock":48,"available":44,"reorder_at":20,"low_stock":false,"out_of_stock":false,"expiry_date":"2026-10-12","days_to_expiry":6,"expiry_status":"critical","selling_price":4000,"cost_price":2900,"stock_value_at_cost":139200},
        {"name":"Paracetamol 500mg","sku":"PCM-500","category":"Pharmacy","unit":"strip","stock":12,"available":12,"reorder_at":15,"low_stock":true,"out_of_stock":false,"expiry_date":"2027-03-01","days_to_expiry":146,"expiry_status":"ok","selling_price":1500,"cost_price":900,"stock_value_at_cost":10800},
        {"name":"Yoghurt 500ml","sku":"YGT-500","category":"Dairy","unit":"cup","stock":30,"available":30,"reorder_at":10,"low_stock":false,"out_of_stock":false,"expiry_date":"2026-10-02","days_to_expiry":-4,"expiry_status":"expired","selling_price":2500,"cost_price":1700,"stock_value_at_cost":51000}]'::JSONB)
        AS t(name TEXT, sku TEXT, category TEXT, unit TEXT, stock NUMERIC, available NUMERIC, reorder_at NUMERIC, low_stock BOOLEAN, out_of_stock BOOLEAN,
             expiry_date DATE, days_to_expiry INTEGER, expiry_status TEXT, selling_price NUMERIC, cost_price NUMERIC, stock_value_at_cost NUMERIC)
       WHERE (v_q IS NULL OR name ILIKE public.era_p_like(v_q)) AND (v_cat IS NULL OR category ILIKE v_cat)
         AND (v_status = 'all' OR (v_status = 'low' AND low_stock) OR (v_status = 'out' AND out_of_stock)
              OR (v_status = 'expiring' AND expiry_status IN ('critical', 'soon')) OR (v_status = 'expired' AND expiry_status = 'expired')
              OR (v_status = 'ok' AND expiry_status IN ('ok', 'no_expiry')))) x), '[]'::JSONB);
  END IF;
  v_biz := public.era__biz(p, FALSE);
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (
    SELECT s.* FROM public.era__biz_stock(v_biz) s
     WHERE (v_q IS NULL OR s.name ILIKE public.era_p_like(v_q) OR s.sku ILIKE public.era_p_like(v_q)) AND (v_cat IS NULL OR s.category ILIKE v_cat)
       AND (v_status = 'all' OR (v_status = 'low' AND s.low_stock) OR (v_status = 'out' AND s.out_of_stock)
            OR (v_status = 'expiring' AND s.expiry_status IN ('critical', 'soon')) OR (v_status = 'expired' AND s.expiry_status = 'expired')
            OR (v_status = 'ok' AND s.expiry_status IN ('ok', 'no_expiry')))
     ORDER BY CASE s.expiry_status WHEN 'expired' THEN 0 WHEN 'critical' THEN 1 WHEN 'soon' THEN 2 ELSE 3 END, s.expiry_date NULLS LAST, s.name
     LIMIT v_limit OFFSET v_offset) x), '[]'::JSONB);
END;
$$;

-- First-expired-first-out: what to sell, discount or pull, with a suggested clearance price that never goes below cost.
CREATE OR REPLACE FUNCTION public.era_h_business_inventory_expiring(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_days INTEGER := public.era_p_int(p, 'days', 30, 1, 365);
  v_expired BOOLEAN := lower(COALESCE(public.era_p_text(p, 'include_expired', 6), 'true')) NOT IN ('false', '0', 'no');
  v_limit INTEGER := public.era_p_int(p, 'limit', 50, 1, 200); v_biz UUID;
BEGIN
  IF p_sandbox THEN
    RETURN COALESCE((SELECT jsonb_agg(x) FROM (
      SELECT * FROM jsonb_to_recordset('[
        {"name":"Yoghurt 500ml","batch_number":"YG-2210","expiry_date":"2026-10-02","days_left":-4,"expiry_status":"expired","stock":30,"unit_cost":1700,"selling_price":2500,"value_at_risk":51000,"discount_pct":100,"suggested_price":null,"action":"withdraw","clearance_published":false},
        {"name":"Fresh Milk 1L","batch_number":"ML-0931","expiry_date":"2026-10-09","days_left":3,"expiry_status":"critical","stock":48,"unit_cost":2900,"selling_price":4000,"value_at_risk":139200,"discount_pct":50,"suggested_price":2900,"action":"discount","clearance_published":false},
        {"name":"Bread 600g","batch_number":"BR-554","expiry_date":"2026-10-20","days_left":14,"expiry_status":"soon","stock":60,"unit_cost":3100,"selling_price":4800,"value_at_risk":186000,"discount_pct":20,"suggested_price":3800,"action":"discount","clearance_published":true}]'::JSONB)
        AS t(name TEXT, batch_number TEXT, expiry_date DATE, days_left INTEGER, expiry_status TEXT, stock NUMERIC, unit_cost NUMERIC, selling_price NUMERIC,
             value_at_risk NUMERIC, discount_pct INTEGER, suggested_price NUMERIC, action TEXT, clearance_published BOOLEAN)
       WHERE days_left <= v_days AND (v_expired OR days_left >= 0)) x), '[]'::JSONB);
  END IF;
  v_biz := public.era__biz(p, FALSE);
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (
    SELECT e.* FROM public.era__biz_expiring(v_biz) e
     WHERE e.days_left <= v_days AND (v_expired OR e.days_left >= 0)
     ORDER BY e.expiry_date, e.name LIMIT v_limit) x), '[]'::JSONB);
END;
$$;

CREATE OR REPLACE FUNCTION public.era_h_business_inventory_summary(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_biz UUID; r RECORD; v_risk NUMERIC;
BEGIN
  IF p_sandbox THEN
    RETURN jsonb_build_object('products', 124, 'in_stock', 117, 'out_of_stock', 7, 'low_stock', 11, 'stock_value_at_cost', 8420500,
      'expiry', jsonb_build_object('expired', 3, 'critical', 9, 'soon', 14, 'ok', 78, 'no_expiry', 20), 'value_at_risk', 612400,
      'next_to_expire', jsonb_build_array(jsonb_build_object('name', 'Yoghurt 500ml', 'expiry_date', '2026-10-02', 'days_left', -4)), 'as_of', now(), 'source', 'sandbox-fixture');
  END IF;
  v_biz := public.era__biz(p, FALSE);
  SELECT COUNT(*) AS products, COUNT(*) FILTER (WHERE NOT out_of_stock) AS in_stock, COUNT(*) FILTER (WHERE out_of_stock) AS oos,
         COUNT(*) FILTER (WHERE low_stock) AS low, COALESCE(SUM(stock_value_at_cost), 0) AS val,
         COUNT(*) FILTER (WHERE expiry_status = 'expired') AS ex, COUNT(*) FILTER (WHERE expiry_status = 'critical') AS cr,
         COUNT(*) FILTER (WHERE expiry_status = 'soon') AS so, COUNT(*) FILTER (WHERE expiry_status = 'ok') AS ok,
         COUNT(*) FILTER (WHERE expiry_status = 'no_expiry') AS ne INTO r
    FROM public.era__biz_stock(v_biz);
  SELECT COALESCE(SUM(value_at_risk), 0) INTO v_risk FROM public.era__biz_expiring(v_biz) WHERE days_left <= 30;
  RETURN jsonb_build_object('products', r.products, 'in_stock', r.in_stock, 'out_of_stock', r.oos, 'low_stock', r.low, 'stock_value_at_cost', r.val,
    'expiry', jsonb_build_object('expired', r.ex, 'critical', r.cr, 'soon', r.so, 'ok', r.ok, 'no_expiry', r.ne), 'value_at_risk', v_risk,
    'next_to_expire', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', n.name, 'expiry_date', n.expiry_date, 'days_left', n.days_left))
                                  FROM (SELECT name, expiry_date, days_left FROM public.era__biz_expiring(v_biz) ORDER BY expiry_date LIMIT 3) n), '[]'::JSONB),
    'as_of', now());
END;
$$;

-- ============================================================================ BUSINESS: CMMS (assets, stock, requisitions, work)

CREATE OR REPLACE FUNCTION public.era_h_business_cmms_overview(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_biz UUID; v_co UUID[]; a RECORD; st RECORD; rq RECORD; wk RECORD; d RECORD;
BEGIN
  IF p_sandbox THEN
    RETURN jsonb_build_object('companies', 2,
      'assets', jsonb_build_object('total', 48, 'by_status', jsonb_build_object('in_service', 41, 'under_repair', 5, 'retired', 2), 'warranty_expiring_60d', 4, 'warranty_expired', 9,
                                  'total_acquisition_cost', 182400000, 'total_book_value', 121300000),
      'stock', jsonb_build_object('consumables', 63, 'below_reorder', 6),
      'requisitions', jsonb_build_object('open', 5, 'by_status', jsonb_build_object('pending_finance', 3, 'approved', 2, 'completed', 41), 'open_estimated_cost', 3820000),
      'work', jsonb_build_object('open', 12, 'overdue', 2, 'by_status', jsonb_build_object('accepted', 3, 'in_progress', 9, 'completed', 88)),
      'departments', jsonb_build_object('count', 7, 'annual_budget', 96000000, 'budget_used', 41200000), 'as_of', now(), 'source', 'sandbox-fixture');
  END IF;
  v_biz := public.era__biz(p, FALSE);
  SELECT COALESCE(array_agg(c), '{}') INTO v_co FROM public.era__biz_cmms(v_biz) c;
  SELECT COUNT(*) AS n, COALESCE(jsonb_object_agg(COALESCE(s, 'unknown'), c) FILTER (WHERE TRUE), '{}'::JSONB) AS by_status,
         COALESCE(SUM(cost), 0) AS cost,
         COALESCE(SUM(public.era__book_value(cost, salv, life, acq, meth)), 0) AS book,
         COUNT(*) FILTER (WHERE wexp IS NOT NULL AND wexp >= public.era__today() AND wexp <= public.era__today() + 60) AS w60,
         COUNT(*) FILTER (WHERE wexp IS NOT NULL AND wexp < public.era__today()) AS wexp INTO a
    FROM (SELECT asset_status AS s, COUNT(*) OVER (PARTITION BY asset_status) AS c, acquisition_cost AS cost, salvage_value AS salv,
                 useful_life_years AS life, acquisition_date AS acq, depreciation_method AS meth, warranty_expiry AS wexp
            FROM public.cmms_inventory_items WHERE cmms_company_id = ANY (v_co) AND item_kind = 'asset' AND is_active IS NOT FALSE AND disposed_at IS NULL) q;
  SELECT COUNT(*) AS n, COUNT(*) FILTER (WHERE quantity_in_stock <= reorder_level) AS low INTO st
    FROM public.cmms_inventory_items WHERE cmms_company_id = ANY (v_co) AND item_kind = 'consumable' AND is_active IS NOT FALSE;
  SELECT COALESCE(SUM(n) FILTER (WHERE status NOT IN ('completed', 'closed') AND status NOT LIKE 'rejected%'), 0) AS open,
         COALESCE(SUM(total_estimated_cost) FILTER (WHERE status NOT IN ('completed', 'closed') AND status NOT LIKE 'rejected%'), 0) AS cost,
         COALESCE(jsonb_object_agg(status, n), '{}'::JSONB) AS by_status INTO rq
    FROM (SELECT status, COUNT(*) AS n, SUM(total_estimated_cost) AS total_estimated_cost FROM public.cmms_requisitions WHERE cmms_company_id = ANY (v_co) GROUP BY status) q;
  SELECT COUNT(*) FILTER (WHERE assignment_status <> 'completed') AS open,
         COUNT(*) FILTER (WHERE assignment_status <> 'completed' AND due_date < public.era__today()) AS overdue,
         COALESCE(jsonb_object_agg(assignment_status, n), '{}'::JSONB) AS by_status INTO wk
    FROM (SELECT assignment_status, due_date, COUNT(*) OVER (PARTITION BY assignment_status) AS n FROM public.cmms_job_assignments WHERE company_id = ANY (v_co)) q;
  SELECT COUNT(*) AS n, COALESCE(SUM(annual_budget), 0) AS b, COALESCE(SUM(budget_used), 0) AS u INTO d
    FROM public.cmms_departments WHERE cmms_company_id = ANY (v_co) AND is_active IS NOT FALSE;
  RETURN jsonb_build_object('companies', COALESCE(array_length(v_co, 1), 0),
    'assets', jsonb_build_object('total', a.n, 'by_status', a.by_status, 'warranty_expiring_60d', a.w60, 'warranty_expired', a.wexp,
                                 'total_acquisition_cost', a.cost, 'total_book_value', round(a.book, 2)),
    'stock', jsonb_build_object('consumables', st.n, 'below_reorder', st.low),
    'requisitions', jsonb_build_object('open', rq.open, 'by_status', rq.by_status, 'open_estimated_cost', rq.cost),
    'work', jsonb_build_object('open', wk.open, 'overdue', wk.overdue, 'by_status', wk.by_status),
    'departments', jsonb_build_object('count', d.n, 'annual_budget', d.b, 'budget_used', d.u), 'as_of', now());
END;
$$;

CREATE OR REPLACE FUNCTION public.era_h_business_cmms_assets(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_q TEXT := public.era_p_text(p, 'q', 60); v_status TEXT := public.era_p_text(p, 'status', 30); v_cond TEXT := public.era_p_text(p, 'condition', 30);
  v_limit INTEGER := public.era_p_int(p, 'limit', 50, 1, 200); v_offset INTEGER := public.era_p_int(p, 'offset', 0, 0, 100000);
  v_biz UUID;
BEGIN
  IF p_sandbox THEN
    RETURN COALESCE((SELECT jsonb_agg(x) FROM (
      SELECT * FROM jsonb_to_recordset('[
        {"asset_tag":"GEN-001","name":"Diesel generator 20kVA","category":"Power","manufacturer":"Perkins","model":"20P","condition":"good","status":"in_service","acquisition_date":"2023-02-10","acquisition_cost":18500000,"useful_life_years":10,"book_value":14700000,"warranty_expiry":"2026-11-20","warranty_days_left":45},
        {"asset_tag":"CMP-014","name":"Air compressor","category":"Workshop","manufacturer":"Atlas Copco","model":"GX5","condition":"fair","status":"under_repair","acquisition_date":"2021-06-01","acquisition_cost":6400000,"useful_life_years":8,"book_value":3300000,"warranty_expiry":"2023-06-01","warranty_days_left":-1222}]'::JSONB)
        AS t(asset_tag TEXT, name TEXT, category TEXT, manufacturer TEXT, model TEXT, condition TEXT, status TEXT, acquisition_date DATE, acquisition_cost NUMERIC,
             useful_life_years INTEGER, book_value NUMERIC, warranty_expiry DATE, warranty_days_left INTEGER)
       WHERE (v_q IS NULL OR name ILIKE public.era_p_like(v_q) OR asset_tag ILIKE public.era_p_like(v_q)) AND (v_status IS NULL OR status ILIKE v_status)
         AND (v_cond IS NULL OR condition ILIKE v_cond)) x), '[]'::JSONB);
  END IF;
  v_biz := public.era__biz(p, FALSE);
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (
    SELECT i.asset_tag, i.item_name AS name, i.category, i.manufacturer, i.model, i.asset_condition AS condition,
           i.asset_status AS status, c.branch_name AS branch, i.acquisition_date, i.acquisition_cost, i.useful_life_years,
           public.era__book_value(i.acquisition_cost, i.salvage_value, i.useful_life_years, i.acquisition_date, i.depreciation_method) AS book_value,
           i.warranty_expiry, CASE WHEN i.warranty_expiry IS NOT NULL THEN i.warranty_expiry - public.era__today() END AS warranty_days_left
      FROM public.cmms_inventory_items i LEFT JOIN public.cmms_company_profiles c ON c.id = i.cmms_company_id
     WHERE i.cmms_company_id IN (SELECT public.era__biz_cmms(v_biz)) AND i.item_kind = 'asset' AND i.is_active IS NOT FALSE AND i.disposed_at IS NULL
       AND (v_q IS NULL OR i.item_name ILIKE public.era_p_like(v_q) OR i.asset_tag ILIKE public.era_p_like(v_q))
       AND (v_status IS NULL OR i.asset_status ILIKE v_status) AND (v_cond IS NULL OR i.asset_condition ILIKE v_cond)
     ORDER BY i.item_name LIMIT v_limit OFFSET v_offset) x), '[]'::JSONB);
END;
$$;

-- Consumables at or under their reorder level, with days of cover from the last 30 days of use and when to reorder by.
CREATE OR REPLACE FUNCTION public.era_h_business_cmms_stock_alerts(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_biz UUID; v_limit INTEGER := public.era_p_int(p, 'limit', 50, 1, 200);
BEGIN
  IF p_sandbox THEN
    RETURN '[{"item_code":"OIL-15W40","name":"Engine oil 15W-40 (20L)","category":"Lubricants","quantity_in_stock":3,"reorder_level":5,"unit":"drum","daily_use":0.4,"days_of_cover":7.5,"lead_time_days":5,"reorder_by":"2026-10-08","suggested_reorder_qty":10,"supplier":"Kampala Lubes"},
             {"item_code":"FLT-A22","name":"Air filter A22","category":"Spares","quantity_in_stock":1,"reorder_level":4,"unit":"pc","daily_use":null,"days_of_cover":null,"lead_time_days":14,"reorder_by":null,"suggested_reorder_qty":7,"supplier":"AutoParts Ltd"}]'::JSONB;
  END IF;
  v_biz := public.era__biz(p, FALSE);
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (
    SELECT i.item_code, i.item_name AS name, i.category, i.quantity_in_stock, i.reorder_level, i.unit_of_measure AS unit,
           round(u.daily, 3) AS daily_use,
           CASE WHEN u.daily > 0 THEN round(i.quantity_in_stock / u.daily, 1) END AS days_of_cover, i.lead_time_days,
           CASE WHEN u.daily > 0 THEN public.era__today() + GREATEST(floor(i.quantity_in_stock / u.daily - COALESCE(i.lead_time_days, 0))::INTEGER, 0) END AS reorder_by,
           COALESCE(i.reorder_quantity, GREATEST(i.reorder_level * 2 - i.quantity_in_stock, 1)) AS suggested_reorder_qty,
           i.supplier_name AS supplier
      FROM public.cmms_inventory_items i
      LEFT JOIN LATERAL (SELECT SUM(abs(t.quantity)) / 30.0 AS daily FROM public.cmms_inventory_transactions t
                          WHERE t.item_id = i.id AND t.txn_date > now() - INTERVAL '30 days'
                            AND (t.quantity < 0 OR t.txn_type ~* '(issue|consum|usage|out)')) u ON TRUE
     WHERE i.cmms_company_id IN (SELECT public.era__biz_cmms(v_biz)) AND i.item_kind = 'consumable' AND i.is_active IS NOT FALSE
       AND i.reorder_level IS NOT NULL AND i.quantity_in_stock <= i.reorder_level
     ORDER BY (i.quantity_in_stock / NULLIF(i.reorder_level, 0)), i.item_name LIMIT v_limit) x), '[]'::JSONB);
END;
$$;

CREATE OR REPLACE FUNCTION public.era_h_business_cmms_requisitions(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_status TEXT := public.era_p_text(p, 'status', 40); v_limit INTEGER := public.era_p_int(p, 'limit', 50, 1, 200);
        v_offset INTEGER := public.era_p_int(p, 'offset', 0, 0, 100000); v_biz UUID;
BEGIN
  IF p_sandbox THEN
    RETURN COALESCE((SELECT jsonb_agg(x) FROM (
      SELECT * FROM jsonb_to_recordset('[
        {"requisition_number":"REQ-2026-0112","requisition_date":"2026-10-01","department":"Workshop","purpose":"Replace compressor seals","urgency_level":"high","status":"pending_finance","total_estimated_cost":850000,"budget_sufficient":true,"required_by_date":"2026-10-10"},
        {"requisition_number":"REQ-2026-0107","requisition_date":"2026-09-24","department":"Facilities","purpose":"Generator service kit","urgency_level":"normal","status":"completed","total_estimated_cost":420000,"budget_sufficient":true,"required_by_date":"2026-10-01"}]'::JSONB)
        AS t(requisition_number TEXT, requisition_date DATE, department TEXT, purpose TEXT, urgency_level TEXT, status TEXT, total_estimated_cost NUMERIC, budget_sufficient BOOLEAN, required_by_date DATE)
       WHERE v_status IS NULL OR status ILIKE v_status) x), '[]'::JSONB);
  END IF;
  v_biz := public.era__biz(p, FALSE);
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (
    SELECT r.requisition_number, r.requisition_date::DATE AS requisition_date, d.department_name AS department, r.purpose, r.urgency_level, r.status,
           r.total_estimated_cost, r.budget_sufficient, r.required_by_date, r.expected_delivery_date::DATE AS expected_delivery_date,
           r.actual_delivery_date::DATE AS actual_delivery_date
      FROM public.cmms_requisitions r LEFT JOIN public.cmms_departments d ON d.id = r.department_id
     WHERE r.cmms_company_id IN (SELECT public.era__biz_cmms(v_biz)) AND (v_status IS NULL OR r.status ILIKE v_status)
     ORDER BY r.requisition_date DESC LIMIT v_limit OFFSET v_offset) x), '[]'::JSONB);
END;
$$;

CREATE OR REPLACE FUNCTION public.era_h_business_cmms_work(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_status TEXT := public.era_p_text(p, 'status', 30); v_limit INTEGER := public.era_p_int(p, 'limit', 50, 1, 200);
        v_offset INTEGER := public.era_p_int(p, 'offset', 0, 0, 100000); v_biz UUID;
BEGIN
  IF p_sandbox THEN
    RETURN COALESCE((SELECT jsonb_agg(x) FROM (
      SELECT * FROM jsonb_to_recordset('[
        {"job_title":"Service generator GEN-001","assignment_status":"in_progress","priority":"high","due_date":"2026-10-09","progress_percentage":60,"overdue":false},
        {"job_title":"Inspect compressor CMP-014","assignment_status":"accepted","priority":"normal","due_date":"2026-10-03","progress_percentage":0,"overdue":true}]'::JSONB)
        AS t(job_title TEXT, assignment_status TEXT, priority TEXT, due_date DATE, progress_percentage INTEGER, overdue BOOLEAN)
       WHERE v_status IS NULL OR assignment_status ILIKE v_status) x), '[]'::JSONB);
  END IF;
  v_biz := public.era__biz(p, FALSE);
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (
    SELECT j.job_title, j.job_description, j.assignment_status, j.priority, j.due_date, j.progress_percentage,
           (j.assignment_status <> 'completed' AND j.due_date IS NOT NULL AND j.due_date < public.era__today()) AS overdue, j.last_progress_update
      FROM public.cmms_job_assignments j
     WHERE j.company_id IN (SELECT public.era__biz_cmms(v_biz)) AND (v_status IS NULL OR j.assignment_status ILIKE v_status)
     ORDER BY (j.assignment_status = 'completed'), j.due_date NULLS LAST LIMIT v_limit OFFSET v_offset) x), '[]'::JSONB);
END;
$$;

-- ============================================================================ BUSINESS: booking requests (journeys and deliveries)

-- Creates a BOOKING INTENT, never a booking. The price is worked out here (a client-supplied fare is ignored); a rider is
-- not dispatched and no wallet is charged. The customer opens the confirm link in BodaGoEra and books it with their own session.
CREATE OR REPLACE FUNCTION public.era_h_business_booking_create(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b JSONB := COALESCE(p -> '_body', '{}'::JSONB);
  v_kind TEXT := lower(COALESCE(public.era_p_text(b, 'kind', 12), 'ride'));
  v_notes TEXT := public.era_p_text(b, 'notes', 200);
  v_ref TEXT := public.era_p_text(b, 'external_ref', 64);
  v_pts JSONB := '[]'::JSONB; v_at TIMESTAMPTZ := now(); pt NUMERIC[]; s JSONB; v_quote JSONB;
  v_biz UUID; v_key UUID := NULLIF(p ->> '_key_id', '')::UUID; v_code TEXT;
  v_exp TIMESTAMPTZ := now() + INTERVAL '30 minutes';
  v_name TEXT; v_from NUMERIC[]; v_to NUMERIC[];
BEGIN
  IF v_kind NOT IN ('ride', 'delivery') THEN RAISE EXCEPTION 'kind must be ride or delivery' USING ERRCODE = '22023'; END IF;
  IF v_ref IS NOT NULL AND v_ref !~ '^[A-Za-z0-9._:-]{1,64}$' THEN RAISE EXCEPTION 'external_ref may only contain letters, digits and . _ : -' USING ERRCODE = '22023'; END IF;
  IF jsonb_typeof(b -> 'from') IS DISTINCT FROM 'object' OR jsonb_typeof(b -> 'to') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'from and to must be objects like {"lat":0.3476,"lng":32.5825,"label":"Wandegeya"}' USING ERRCODE = '22023';
  END IF;
  v_from := public.era__point((b -> 'from' ->> 'lat') || ',' || (b -> 'from' ->> 'lng'), 'from');
  v_to := public.era__point((b -> 'to' ->> 'lat') || ',' || (b -> 'to' ->> 'lng'), 'to');
  v_pts := jsonb_build_array(jsonb_build_array(v_from[1], v_from[2]));
  IF jsonb_typeof(COALESCE(b -> 'stops', '[]'::JSONB)) <> 'array' OR jsonb_array_length(COALESCE(b -> 'stops', '[]'::JSONB)) > 3 THEN
    RAISE EXCEPTION 'stops must be a list of at most 3 points' USING ERRCODE = '22023';
  END IF;
  FOR s IN SELECT * FROM jsonb_array_elements(COALESCE(b -> 'stops', '[]'::JSONB)) LOOP
    pt := public.era__point((s ->> 'lat') || ',' || (s ->> 'lng'), 'stops');
    v_pts := v_pts || jsonb_build_array(jsonb_build_array(pt[1], pt[2]));
  END LOOP;
  v_pts := v_pts || jsonb_build_array(jsonb_build_array(v_to[1], v_to[2]));
  IF COALESCE(b ->> 'at', '') <> '' THEN
    BEGIN v_at := (b ->> 'at')::TIMESTAMPTZ; EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'at must be an ISO date-time such as 2026-10-06T08:30:00+03:00' USING ERRCODE = '22023'; END;
    IF v_at < now() - INTERVAL '1 hour' OR v_at > now() + INTERVAL '14 days' THEN RAISE EXCEPTION 'at must be within the next 14 days.' USING ERRCODE = '22023'; END IF;
  END IF;
  v_quote := public.era__quote(v_pts, v_kind, v_at);   -- the price is ours; any "fare" in the body is ignored
  v_code := 'BK' || upper(public.era__rand(20));

  IF p_sandbox THEN
    RETURN jsonb_build_object('code', v_code, 'status', 'awaiting_confirmation', 'kind', v_kind, 'quote', v_quote, 'expires_at', v_exp,
      'confirm_path', '/book/' || v_code, 'external_ref', v_ref, 'requested_by', 'Sample Business Ltd', 'sandbox', TRUE,
      'next', 'Sandbox intent: nothing was stored. In live mode send the customer the confirm link; they book it in BodaGoEra with their own session.');
  END IF;

  v_biz := public.era__biz(p, FALSE);
  SELECT business_name INTO v_name FROM public.business_profiles WHERE id = v_biz;
  IF (SELECT COUNT(*) FROM public.era_api_booking_intents WHERE key_id = v_key AND status = 'awaiting_confirmation' AND expires_at > now()) >= 30 THEN
    RAISE EXCEPTION 'This key already has 30 booking links waiting for a customer.' USING ERRCODE = 'ERA29';
  END IF;
  INSERT INTO public.era_api_booking_intents (code, key_id, business_profile_id, kind, pickup_label, pickup_lat, pickup_lng,
                                              dropoff_label, dropoff_lat, dropoff_lng, notes, external_ref, quote, expires_at)
  VALUES (v_code, v_key, v_biz, v_kind, public.era_p_text(b -> 'from', 'label', 120), v_from[1], v_from[2],
          public.era_p_text(b -> 'to', 'label', 120), v_to[1], v_to[2], v_notes, v_ref, v_quote, v_exp);
  RETURN jsonb_build_object('code', v_code, 'status', 'awaiting_confirmation', 'kind', v_kind, 'quote', v_quote, 'expires_at', v_exp,
    'confirm_path', '/book/' || v_code, 'external_ref', v_ref, 'requested_by', v_name,
    'next', 'Send the customer the confirm link. They open it in BodaGoEra, pick a rider and book with their own session and PIN. You cannot book or charge on their behalf.');
END;
$$;

CREATE OR REPLACE FUNCTION public.era__booking_row(p_id UUID) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('code', i.code, 'kind', i.kind,
           'status', CASE WHEN i.status = 'awaiting_confirmation' AND i.expires_at <= now() THEN 'expired' ELSE i.status END,
           'pickup', i.pickup_label, 'dropoff', i.dropoff_label, 'total_ugx', i.quote -> 'total_ugx', 'total_ican', i.quote -> 'total_ican',
           'external_ref', i.external_ref, 'created_at', i.created_at, 'expires_at', i.expires_at, 'booked_at', i.booked_at,
           -- only the ride's state: never who the customer or the rider is
           'ride', (SELECT jsonb_build_object('status', r.status::TEXT, 'fare_ugx', r.fare, 'distance_km', r.distance_km, 'requested_at', r.requested_at,
                                              'accepted_at', r.accepted_at, 'started_at', r.started_at, 'completed_at', r.completed_at, 'cancelled_at', r.cancelled_at)
                      FROM public.mbg_rides r WHERE r.id = i.ride_id))
    FROM public.era_api_booking_intents i WHERE i.id = p_id
$$;

CREATE OR REPLACE FUNCTION public.era_h_business_bookings(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_status TEXT := lower(COALESCE(public.era_p_text(p, 'status', 24), 'all')); v_limit INTEGER := public.era_p_int(p, 'limit', 25, 1, 100);
        v_offset INTEGER := public.era_p_int(p, 'offset', 0, 0, 100000); v_biz UUID;
BEGIN
  IF v_status NOT IN ('all', 'awaiting_confirmation', 'booked', 'cancelled', 'expired') THEN
    RAISE EXCEPTION 'status must be all, awaiting_confirmation, booked, cancelled or expired' USING ERRCODE = '22023';
  END IF;
  IF p_sandbox THEN
    RETURN COALESCE((SELECT jsonb_agg(x) FROM (
      SELECT * FROM jsonb_to_recordset('[
        {"code":"BKFADE0000000000000001","kind":"delivery","status":"booked","pickup":"Kampala Fresh Mart","dropoff":"Ntinda, Plot 12","total_ugx":6500,"external_ref":"order-1042","ride":{"status":"completed","fare_ugx":6500}},
        {"code":"BKFADE0000000000000002","kind":"ride","status":"awaiting_confirmation","pickup":"Wandegeya","dropoff":"Makerere Hill","total_ugx":3000,"external_ref":"order-1043","ride":null}]'::JSONB)
        AS t(code TEXT, kind TEXT, status TEXT, pickup TEXT, dropoff TEXT, total_ugx NUMERIC, external_ref TEXT, ride JSONB)
       WHERE v_status = 'all' OR status = v_status) x), '[]'::JSONB);
  END IF;
  v_biz := public.era__biz(p, FALSE);
  RETURN COALESCE((SELECT jsonb_agg(public.era__booking_row(i.id) ORDER BY i.created_at DESC) FROM (
    SELECT * FROM public.era_api_booking_intents WHERE business_profile_id = v_biz
       AND (v_status = 'all' OR (v_status = 'expired' AND (status = 'expired' OR (status = 'awaiting_confirmation' AND expires_at <= now())))
            OR (v_status = 'awaiting_confirmation' AND status = 'awaiting_confirmation' AND expires_at > now())
            OR (v_status IN ('booked', 'cancelled') AND status = v_status))
     ORDER BY created_at DESC LIMIT v_limit OFFSET v_offset) i), '[]'::JSONB);
END;
$$;

CREATE OR REPLACE FUNCTION public.era_h_business_booking_get(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_code TEXT := upper(COALESCE(public.era_p_text(p, 'code', 40), '')); v_biz UUID; i public.era_api_booking_intents;
BEGIN
  IF v_code !~ '^BK[0-9A-F]{20}$' THEN RAISE EXCEPTION 'code must look like BK followed by 20 letters/digits' USING ERRCODE = '22023'; END IF;
  IF p_sandbox THEN
    RETURN jsonb_build_object('code', v_code, 'kind', 'delivery', 'status', 'booked', 'pickup', 'Kampala Fresh Mart', 'dropoff', 'Ntinda, Plot 12', 'total_ugx', 6500,
      'ride', jsonb_build_object('status', 'completed', 'fare_ugx', 6500, 'distance_km', 2.4));
  END IF;
  v_biz := public.era__biz(p, FALSE);
  SELECT * INTO i FROM public.era_api_booking_intents WHERE code = v_code AND business_profile_id = v_biz;
  IF NOT FOUND THEN RAISE EXCEPTION 'No booking request % for this business.', v_code USING ERRCODE = 'P0002'; END IF;
  RETURN public.era__booking_row(i.id);
END;
$$;

-- ============================================================================ PLATFORM: who am I (now aware of business keys)
CREATE OR REPLACE FUNCTION public.era_h_platform_whoami(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c public.era_api_clients;
  v_key UUID := NULLIF(p ->> '_key_id', '')::UUID;
  v_biz UUID := NULLIF(p ->> '_business_id', '')::UUID;
  v_used INTEGER; v_bname TEXT;
BEGIN
  SELECT * INTO c FROM public.era_api_clients WHERE id = (p ->> '_client_id')::UUID;
  SELECT COALESCE(SUM(calls), 0) INTO v_used FROM public.era_api_usage
   WHERE key_id = v_key AND period = 'd' AND bucket = public.era__bucket(86400);
  IF v_biz IS NOT NULL THEN SELECT business_name INTO v_bname FROM public.business_profiles WHERE id = v_biz; END IF;
  RETURN jsonb_strip_nulls(jsonb_build_object(
    'app_name', c.app_name,
    'mode', p ->> '_mode',
    'status', c.status,
    'apps', p -> '_apps',
    'limits', jsonb_build_object('per_minute', (p ->> '_rate')::INTEGER, 'per_day', (p ->> '_quota')::INTEGER),
    'used_today', v_used,
    'business', CASE WHEN p ->> '_mode' IN ('business', 'business-test') THEN jsonb_build_object(
        'name', COALESCE(v_bname, 'Sample Business Ltd'), 'scopes', p -> '_scopes', 'expires_at', p -> '_expires_at',
        'max_amount_ugx', NULLIF(p ->> '_max_amount_ugx', '')::NUMERIC, 'daily_cap_ugx', NULLIF(p ->> '_daily_cap_ugx', '')::NUMERIC) END,
    'hint', CASE WHEN p ->> '_mode' = 'sandbox' THEN 'Sandbox key: responses are realistic fixtures. Ask for live access at /developers.'
                 WHEN p ->> '_mode' = 'business-test' THEN 'Business test key: private endpoints answer with fixtures and nothing is created.'
                 WHEN p ->> '_mode' = 'business' THEN 'Business key: you can read and write only this business, within the scopes its owner chose.'
                 ELSE 'Live key: responses are real.' END));
END;
$$;

-- ============================================================================ the registry
INSERT INTO public.era_api_endpoints (id, app, method, path, summary, description, params, body, example_path, handler, access, scope, cache_seconds, sort) VALUES
 -- ICANERA
 ('icanera.coin_valuation', 'icanera', 'GET', '/icanera/coin/valuation', 'How the ICAN price is made',
  'The valuation step by step: the 5,000 UGX floor, FX protection, the USD and UGX inflation legs, the fair price, and how the market price compares. Plus aggregate activity.',
  '[]', '[]', '/icanera/coin/valuation', 'public.era_h_icanera_coin_valuation', 'app', NULL, 60, 26),
 ('icanera.coin_supply', 'icanera', 'GET', '/icanera/coin/supply', 'ICAN supply',
  'Coins held in wallets, holders, coins bought and sold through the platform, and 30-day activity by type. Aggregates only, nothing per person.',
  '[]', '[]', '/icanera/coin/supply', 'public.era_h_icanera_coin_supply', 'app', NULL, 120, 27),
 ('icanera.coin_convert', 'icanera', 'GET', '/icanera/coin/convert', 'Convert ICAN and a currency',
  'At the live price, either way. Indicative: a fee or spread applies when you actually buy or sell.',
  '[{"name":"from","in":"query","type":"string","required":true,"example":"UGX","description":"ICAN or a 3-letter currency code."},
    {"name":"to","in":"query","type":"string","required":true,"example":"ICAN","description":"ICAN or a 3-letter currency code. Exactly one side is ICAN."},
    {"name":"amount","in":"query","type":"number","required":true,"example":100000,"description":"The amount to convert."}]',
  '[]', '/icanera/coin/convert?from=UGX&to=ICAN&amount=100000', 'public.era_h_icanera_coin_convert', 'app', NULL, 30, 28),
 ('icanera.chain_gas', 'icanera', 'GET', '/icanera/chain/gas', 'Blockchain network fee estimate',
  'What a transaction would cost in gas, in the network coin, in USD and in ICAN. An estimate from typical gas units and the gas price the platform team last entered (its age is shown).',
  '[{"name":"network","in":"query","type":"string","required":false,"default":"ethereum","description":"The network."},
    {"name":"operation","in":"query","type":"string","required":false,"example":"token_transfer","description":"native_transfer, token_transfer, token_approve, contract_call or contract_deploy. Omit for all."}]',
  '[]', '/icanera/chain/gas?operation=token_transfer', 'public.era_h_icanera_chain_gas', 'app', NULL, 60, 29),
 ('icanera.chain_head', 'icanera', 'GET', '/icanera/chain/head', 'Integrity chain: latest block',
  'The latest sequence number and chain hash of the hash-linked record of ICAN events.',
  '[]', '[]', '/icanera/chain/head', 'public.era_h_icanera_chain_head', 'app', NULL, 15, 29),
 ('icanera.chain_proof', 'icanera', 'GET', '/icanera/chain/proof/{seq}', 'Integrity chain: proof for one event',
  'The event type, its hash and the previous hash, so you can check it links to the event before it. Never the underlying record.',
  '[{"name":"seq","in":"path","type":"integer","required":true,"example":1358,"description":"The sequence number."}]',
  '[]', '/icanera/chain/proof/1358', 'public.era_h_icanera_chain_proof', 'app', NULL, 600, 29),
 -- BodaGoEra
 ('bodagoera.journey_quote', 'bodagoera', 'GET', '/bodagoera/journeys/quote', 'Quote a journey or delivery',
  'Prices a ride, a delivery or cargo between two points, with up to 3 stops. Uses the booking engine''s own formula, including the time-of-day multiplier, and can price for a later time.',
  '[{"name":"from","in":"query","type":"string","required":true,"example":"0.3318,32.5728","description":"Pickup as latitude,longitude."},
    {"name":"to","in":"query","type":"string","required":true,"example":"0.3476,32.6025","description":"Drop-off as latitude,longitude."},
    {"name":"stops","in":"query","type":"string","required":false,"example":"0.3400,32.5900","description":"Up to 3 stops, separated by |."},
    {"name":"kind","in":"query","type":"string","required":false,"default":"ride","example":"delivery","description":"ride, delivery or cargo."},
    {"name":"at","in":"query","type":"string","required":false,"description":"Price for this ISO date-time (next 14 days). Default: now."}]',
  '[]', '/bodagoera/journeys/quote?from=0.3318,32.5728&to=0.3476,32.6025&kind=delivery', 'public.era_h_bodagoera_journey_quote', 'app', NULL, 0, 35),
 -- SupermarketEra
 ('supermarketera.products', 'supermarketera', 'GET', '/supermarketera/products', 'Products on store shelves',
  'Products across every category and store: price, brand, barcode, expiry date and any published clearance price. No cost prices, no stock levels.',
  '[{"name":"q","in":"query","type":"string","required":false,"example":"milk","description":"Search name or brand."},
    {"name":"category","in":"query","type":"string","required":false,"example":"Dairy","description":"Filter by category."},
    {"name":"store","in":"query","type":"string","required":false,"description":"Search by store name."},
    {"name":"limit","in":"query","type":"integer","required":false,"default":25,"description":"1 to 100."},
    {"name":"offset","in":"query","type":"integer","required":false,"default":0,"description":"For paging."}]',
  '[]', '/supermarketera/products?category=Dairy', 'public.era_h_supermarketera_products', 'app', NULL, 60, 44),
 ('supermarketera.clearance', 'supermarketera', 'GET', '/supermarketera/clearance', 'Clearance deals',
  'Reduced prices that stores published on stock nearing its expiry date: original price, price now, discount and days left.',
  '[{"name":"city","in":"query","type":"string","required":false,"example":"Kampala","description":"Only this city."},
    {"name":"category","in":"query","type":"string","required":false,"description":"Only this category."},
    {"name":"limit","in":"query","type":"integer","required":false,"default":25,"description":"1 to 100."},
    {"name":"offset","in":"query","type":"integer","required":false,"default":0,"description":"For paging."}]',
  '[]', '/supermarketera/clearance', 'public.era_h_supermarketera_clearance', 'app', NULL, 60, 45),
 -- BUSINESS: payments
 ('business.payment_create', 'business', 'POST', '/business/payments', 'Create a payment request',
  'Creates a payment request (a QR code). It does NOT move money: the payer scans it in the ICAN app and approves with their own PIN. Capped per request and per day by the key; needs an Idempotency-Key.',
  '[]',
  '[{"name":"amount","type":"number","required":true,"example":45000,"description":"Amount to collect."},
    {"name":"currency","type":"string","required":false,"example":"UGX","description":"UGX (default), USD, KES, TZS or RWF."},
    {"name":"description","type":"string","required":false,"example":"Order #1042","description":"Shown to the payer. Up to 140 characters."},
    {"name":"expires_in_minutes","type":"integer","required":false,"example":60,"description":"5 to 1440. Default 60."},
    {"name":"classification","type":"string","required":false,"example":"business","description":"business (default) or personal."},
    {"name":"external_ref","type":"string","required":false,"example":"order-1042","description":"Your own reference, returned on every read."}]',
  NULL, 'public.era_h_business_payment_create', 'business', 'payments:request', 0, 60),
 ('business.payments', 'business', 'GET', '/business/payments', 'List payment requests',
  'The payment requests this business created through the API, with status (pending, completed, expired) and when each was paid. Never who paid.',
  '[{"name":"status","in":"query","type":"string","required":false,"default":"all","example":"pending","description":"all, pending, completed or expired."},
    {"name":"limit","in":"query","type":"integer","required":false,"default":25,"description":"1 to 100."},
    {"name":"offset","in":"query","type":"integer","required":false,"default":0,"description":"For paging."}]',
  '[]', '/business/payments?status=pending', 'public.era_h_business_payments', 'business', 'payments:read', 0, 61),
 ('business.payment_get', 'business', 'GET', '/business/payments/{code}', 'Check one payment request',
  'Status of one payment request: poll this until it says completed.',
  '[{"name":"code","in":"path","type":"string","required":true,"example":"PAY_SANDBOX0000B2","description":"The payment code."}]',
  '[]', '/business/payments/PAY_SANDBOX0000B2', 'public.era_h_business_payment_get', 'business', 'payments:read', 0, 62),
 ('business.payment_cancel', 'business', 'POST', '/business/payments/{code}/cancel', 'Cancel a pending payment request',
  'Expires a payment request that has not been paid. A paid request cannot be cancelled here.',
  '[{"name":"code","in":"path","type":"string","required":true,"example":"PAY_SANDBOX0000B2","description":"The payment code."}]',
  '[]', NULL, 'public.era_h_business_payment_cancel', 'business', 'payments:request', 0, 63),
 -- BUSINESS: inventory
 ('business.inventory', 'business', 'GET', '/business/inventory', 'Inventory with expiry tracking',
  'Every tracked product in your stores: stock, reorder level, nearest expiry date, days left and an expiry status (expired, critical within 7 days, soon within 30, ok).',
  '[{"name":"status","in":"query","type":"string","required":false,"default":"all","example":"expiring","description":"all, low, out, expiring, expired or ok."},
    {"name":"q","in":"query","type":"string","required":false,"description":"Search name or SKU."},
    {"name":"category","in":"query","type":"string","required":false,"description":"Filter by category."},
    {"name":"limit","in":"query","type":"integer","required":false,"default":50,"description":"1 to 200."},
    {"name":"offset","in":"query","type":"integer","required":false,"default":0,"description":"For paging."}]',
  '[]', '/business/inventory?status=expiring', 'public.era_h_business_inventory', 'business', 'inventory:read', 0, 64),
 ('business.inventory_expiring', 'business', 'GET', '/business/inventory/expiring', 'What to sell, discount or pull',
  'Batches and products by expiry date, first-expired-first-out, with the value at risk, a suggested clearance discount and a price that never falls below cost, and whether you already published it.',
  '[{"name":"days","in":"query","type":"integer","required":false,"default":30,"example":14,"description":"Look ahead this many days (1 to 365)."},
    {"name":"include_expired","in":"query","type":"string","required":false,"default":"true","description":"false to hide already-expired stock."},
    {"name":"limit","in":"query","type":"integer","required":false,"default":50,"description":"1 to 200."}]',
  '[]', '/business/inventory/expiring?days=14', 'public.era_h_business_inventory_expiring', 'business', 'inventory:read', 0, 65),
 ('business.inventory_summary', 'business', 'GET', '/business/inventory/summary', 'Inventory at a glance',
  'Product counts, low and out-of-stock, stock value at cost, how much sits in each expiry band, the value at risk and the next three to expire.',
  '[]', '[]', '/business/inventory/summary', 'public.era_h_business_inventory_summary', 'business', 'inventory:read', 0, 66),
 -- BUSINESS: CMMS
 ('business.cmms_overview', 'business', 'GET', '/business/cmms/overview', 'CMMS overview',
  'Assets (by status, warranties expiring, cost and book value), consumables below reorder, open requisitions, open and overdue work, department budgets.',
  '[]', '[]', '/business/cmms/overview', 'public.era_h_business_cmms_overview', 'business', 'cmms:read', 0, 67),
 ('business.cmms_assets', 'business', 'GET', '/business/cmms/assets', 'CMMS assets',
  'Equipment with condition, status, acquisition cost, a computed book value (straight-line or declining balance) and warranty days left.',
  '[{"name":"q","in":"query","type":"string","required":false,"description":"Search name or asset tag."},
    {"name":"status","in":"query","type":"string","required":false,"example":"in_service","description":"Filter by status."},
    {"name":"condition","in":"query","type":"string","required":false,"example":"good","description":"Filter by condition."},
    {"name":"limit","in":"query","type":"integer","required":false,"default":50,"description":"1 to 200."},
    {"name":"offset","in":"query","type":"integer","required":false,"default":0,"description":"For paging."}]',
  '[]', '/business/cmms/assets', 'public.era_h_business_cmms_assets', 'business', 'cmms:read', 0, 68),
 ('business.cmms_stock_alerts', 'business', 'GET', '/business/cmms/stock-alerts', 'CMMS reorder alerts',
  'Consumables at or below their reorder level, with days of cover from the last 30 days of use, the date to reorder by (allowing for lead time) and a suggested quantity.',
  '[{"name":"limit","in":"query","type":"integer","required":false,"default":50,"description":"1 to 200."}]',
  '[]', '/business/cmms/stock-alerts', 'public.era_h_business_cmms_stock_alerts', 'business', 'cmms:read', 0, 69),
 ('business.cmms_requisitions', 'business', 'GET', '/business/cmms/requisitions', 'CMMS requisitions',
  'Requisitions with purpose, urgency, status, estimated cost and delivery dates. No names of requesters.',
  '[{"name":"status","in":"query","type":"string","required":false,"description":"Filter by status."},
    {"name":"limit","in":"query","type":"integer","required":false,"default":50,"description":"1 to 200."},
    {"name":"offset","in":"query","type":"integer","required":false,"default":0,"description":"For paging."}]',
  '[]', '/business/cmms/requisitions', 'public.era_h_business_cmms_requisitions', 'business', 'cmms:read', 0, 70),
 ('business.cmms_work', 'business', 'GET', '/business/cmms/work', 'CMMS work assignments',
  'Jobs with status, priority, due date, progress and an overdue flag. Nobody''s name or contact is returned.',
  '[{"name":"status","in":"query","type":"string","required":false,"example":"in_progress","description":"Filter by status."},
    {"name":"limit","in":"query","type":"integer","required":false,"default":50,"description":"1 to 200."},
    {"name":"offset","in":"query","type":"integer","required":false,"default":0,"description":"For paging."}]',
  '[]', '/business/cmms/work', 'public.era_h_business_cmms_work', 'business', 'cmms:read', 0, 71),
 -- BUSINESS: bookings
 ('business.booking_create', 'business', 'POST', '/business/bookings', 'Request a ride or delivery',
  'Prices a journey or delivery and creates a booking REQUEST with a confirm link. It does not book, dispatch or charge: the customer opens the link in BodaGoEra, picks a rider and books with their own session and PIN.',
  '[]',
  '[{"name":"kind","type":"string","required":false,"example":"delivery","description":"ride (default) or delivery."},
    {"name":"from","type":"object","required":true,"example":{"lat":0.3318,"lng":32.5728,"label":"Kampala Fresh Mart"},"description":"Pickup: lat, lng and an optional label."},
    {"name":"to","type":"object","required":true,"example":{"lat":0.3476,"lng":32.6025,"label":"Ntinda, Plot 12"},"description":"Drop-off: lat, lng and an optional label."},
    {"name":"stops","type":"array","required":false,"description":"Up to 3 intermediate points, each {lat, lng}."},
    {"name":"at","type":"string","required":false,"description":"Price for this ISO date-time (next 14 days)."},
    {"name":"notes","type":"string","required":false,"description":"Up to 200 characters for the rider."},
    {"name":"external_ref","type":"string","required":false,"example":"order-1042","description":"Your own reference."}]',
  NULL, 'public.era_h_business_booking_create', 'business', 'bookings:request', 0, 72),
 ('business.bookings', 'business', 'GET', '/business/bookings', 'List booking requests',
  'The booking requests this business created, with status (awaiting_confirmation, booked, cancelled, expired) and, once booked, the ride''s state.',
  '[{"name":"status","in":"query","type":"string","required":false,"default":"all","example":"booked","description":"all, awaiting_confirmation, booked, cancelled or expired."},
    {"name":"limit","in":"query","type":"integer","required":false,"default":25,"description":"1 to 100."},
    {"name":"offset","in":"query","type":"integer","required":false,"default":0,"description":"For paging."}]',
  '[]', '/business/bookings', 'public.era_h_business_bookings', 'business', 'bookings:read', 0, 73),
 ('business.booking_get', 'business', 'GET', '/business/bookings/{code}', 'Track one booking request',
  'Status of one booking request and, once booked, the ride: accepted, started, completed. Never the rider''s or customer''s identity.',
  '[{"name":"code","in":"path","type":"string","required":true,"example":"BKFADE0000000000000001","description":"The booking code."}]',
  '[]', '/business/bookings/BKFADE0000000000000001', 'public.era_h_business_booking_get', 'business', 'bookings:read', 0, 74)
ON CONFLICT (id) DO UPDATE SET
  app = EXCLUDED.app, method = EXCLUDED.method, path = EXCLUDED.path, summary = EXCLUDED.summary, description = EXCLUDED.description,
  params = EXCLUDED.params, body = EXCLUDED.body, example_path = EXCLUDED.example_path, handler = EXCLUDED.handler,
  access = EXCLUDED.access, scope = EXCLUDED.scope, sort = EXCLUDED.sort;

-- v1 endpoints that changed meaning keep their registry rows; refresh the descriptions that moved
UPDATE public.era_api_endpoints SET
  summary = 'Fare estimate',
  description = 'Estimate a ride or cargo fare with the booking engine''s own formula: max(minimum, base + per-km x distance) x the time-of-day multiplier, rounded to 100 UGX. Can price for a later time.',
  params = '[{"name":"km","in":"query","type":"number","required":true,"example":7.5,"description":"Distance in kilometres (0.1 to 300)."},
    {"name":"kind","in":"query","type":"string","required":false,"default":"ride","example":"cargo","description":"ride or cargo."},
    {"name":"at","in":"query","type":"string","required":false,"description":"Price for this ISO date-time. Default: now."}]'::JSONB
 WHERE id = 'bodagoera.fare_estimate';
UPDATE public.era_api_endpoints SET
  description = 'Every category on the platform: how many wholesale catalogue items and how many shelf products each holds.'
 WHERE id = 'supermarketera.categories';

-- Handlers and helpers are internal: only era_api_call (SECURITY DEFINER) reaches them.
DO $$
DECLARE f RECORD;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND (p.proname LIKE 'era\_h\_%' OR p.proname LIKE 'era\_p\_%' OR p.proname LIKE 'era\_\_%') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
  END LOOP;
END $$;

-- ============================================================================
-- ERA API: paste this WHOLE file into the Supabase SQL editor and press Run. Once.
--
-- It is the two migrations in the right order:
--   1. supabase/migrations/20261005100000_era_api.sql            (tables, keys, limits, sandbox, sign-up, admin)
--   2. supabase/migrations/20261005100100_era_api_endpoints.sql  (the 20 read-only endpoints)
--
-- Safe to run twice. Changes nothing that exists today: it only ADDS era_api_* tables and era_* functions.
-- To undo: supabase/rollback/20261005_rollback_era_api.sql
-- After it runs, open  https://icanera.space/developers/  and press Send.
-- Then make yourself an API admin ONLY if you are not already a platform developer or franchise admin:
--     INSERT INTO public.era_api_admins (user_id, note)
--     SELECT id, 'founder' FROM auth.users WHERE lower(email) = lower('YOUR-EMAIL');
-- ============================================================================

-- ################################ PART 1 of 2: core ################################
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

-- ################################ PART 2 of 2: endpoints ################################
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

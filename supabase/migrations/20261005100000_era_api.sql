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

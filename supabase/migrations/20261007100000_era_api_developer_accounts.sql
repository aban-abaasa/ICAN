-- ============================================================================
-- ERA API: developer ACCOUNTS. Sign in with Google (the same Supabase sign-in the apps already use), tell us your
-- country, and test in the sandbox straight away.
--
--   * era_api_developers      one row per signed-in developer: name, email, avatar, country
--                             (country comes from, in this order: what they chose, their existing ICAN account -
--                              the platform's own ican_franchise_country_of() lookup - or where they connect from)
--   * era_api_clients.country_code    the country an app was registered from (shown to administrators)
--   * era_api_dev_account()           open the account (creates the profile on first sign-in) and list my apps
--   * era_api_dev_set_country()       remember my country
--   * era_api_dev_create_app()        register an app -> pending for live access + an INSTANT sandbox key
--   * era_api_dev_issue_key()         issue or rotate a sandbox key at once; a live key once an administrator approves
--
-- The ticket flow (no account) keeps working exactly as before. An app made here simply belongs to a user
-- (era_api_clients.owner_user_id) instead of being found by a ticket, so the developer can come back from any device.
--
-- Safe to run twice. Companion of 20261005100000_era_api.sql (it needs that file and the business one first).
-- Rollback: supabase/rollback/20261005_rollback_era_api.sql removes it with the rest.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.era_api_developers (
  user_id        UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email          TEXT NOT NULL CHECK (char_length(email) <= 254),
  full_name      TEXT CHECK (char_length(full_name) <= 80),
  avatar_url     TEXT CHECK (char_length(avatar_url) <= 400),
  provider       TEXT,
  country_code   TEXT CHECK (country_code ~ '^[A-Z]{2}$'),
  country_source TEXT CHECK (country_source IN ('account', 'detected', 'chosen')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.era_api_developers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.era_api_developers FROM PUBLIC, anon, authenticated;

ALTER TABLE public.era_api_clients ADD COLUMN IF NOT EXISTS country_code TEXT;
DO $$ BEGIN
  ALTER TABLE public.era_api_clients ADD CONSTRAINT era_api_clients_country_check CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS era_api_clients_owner_idx ON public.era_api_clients (owner_user_id, created_at DESC)
  WHERE owner_user_id IS NOT NULL AND kind = 'developer';

-- ---------------------------------------------------------------------------- internal helpers

-- The signed-in caller's developer profile, created or refreshed from their Google account on every visit.
CREATE OR REPLACE FUNCTION public.era__dev_profile() RETURNS public.era_api_developers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  u RECORD;
  d public.era_api_developers;
  v_cc TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign in first.' USING ERRCODE = '42501'; END IF;
  SELECT lower(btrim(email)) AS email, raw_user_meta_data AS m, raw_app_meta_data AS a INTO u FROM auth.users WHERE id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sign in first.' USING ERRCODE = '42501'; END IF;
  IF u.email IS NULL OR u.email = '' THEN
    RAISE EXCEPTION 'Your account has no email address. Sign in with Google to create a developer account.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.era_api_developers (user_id, email, full_name, avatar_url, provider)
  VALUES (v_uid, left(u.email, 254),
          NULLIF(left(btrim(COALESCE(u.m ->> 'full_name', u.m ->> 'name', '')), 80), ''),
          NULLIF(left(COALESCE(u.m ->> 'avatar_url', u.m ->> 'picture', ''), 400), ''),
          COALESCE(u.a ->> 'provider', 'email'))
  ON CONFLICT (user_id) DO UPDATE
     SET email = EXCLUDED.email,
         full_name = COALESCE(EXCLUDED.full_name, public.era_api_developers.full_name),
         avatar_url = COALESCE(EXCLUDED.avatar_url, public.era_api_developers.avatar_url),
         provider = EXCLUDED.provider, last_seen_at = now()
  RETURNING * INTO d;

  -- No country yet? Reuse the platform's existing lookup (user_accounts, then the business profile) so someone who
  -- already has an ICAN account is never asked twice. If that lookup is missing or finds nothing, we simply ask.
  IF d.country_code IS NULL AND to_regprocedure('public.ican_franchise_country_of(uuid,uuid)') IS NOT NULL THEN
    BEGIN
      EXECUTE 'SELECT upper(btrim(public.ican_franchise_country_of($1, NULL)::TEXT))' INTO v_cc USING v_uid;
    EXCEPTION WHEN OTHERS THEN v_cc := NULL;
    END;
    IF v_cc ~ '^[A-Z]{2}$' THEN
      UPDATE public.era_api_developers SET country_code = v_cc, country_source = 'account', updated_at = now()
       WHERE user_id = v_uid RETURNING * INTO d;
    END IF;
  END IF;
  RETURN d;
END;
$$;

-- A 2-letter ISO 3166 code, upper-cased; NULL for "none". Anything else is an error, never silently dropped.
CREATE OR REPLACE FUNCTION public.era__country(p_code TEXT) RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v TEXT := upper(btrim(COALESCE(p_code, '')));
BEGIN
  IF v = '' THEN RETURN NULL; END IF;
  IF v !~ '^[A-Z]{2}$' THEN RAISE EXCEPTION 'Pick your country from the list (a 2-letter code such as UG).' USING ERRCODE = '22023'; END IF;
  RETURN v;
END;
$$;

-- ---------------------------------------------------------------------------- the account

-- Everything the developer page needs after sign-in, in one call. Never returns a key or a ticket.
CREATE OR REPLACE FUNCTION public.era_api_dev_account() RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d public.era_api_developers := public.era__dev_profile();
  s public.era_api_settings;
BEGIN
  SELECT * INTO s FROM public.era_api_settings WHERE id;
  RETURN jsonb_build_object(
    'profile', jsonb_build_object('email', d.email, 'full_name', d.full_name, 'avatar_url', d.avatar_url, 'provider', d.provider,
                                  'country_code', d.country_code, 'country_source', d.country_source, 'created_at', d.created_at),
    'settings', jsonb_build_object('enabled', COALESCE(s.enabled, FALSE), 'sandbox_enabled', COALESCE(s.sandbox_enabled, FALSE),
                                   'signups_open', COALESCE(s.signups_open, FALSE),
                                   'sandbox_per_minute', s.sandbox_rate_per_min, 'sandbox_per_day', s.sandbox_daily_quota),
    'max_apps', 5,
    'apps', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', c.id, 'app_name', c.app_name, 'website', c.website, 'description', c.description, 'country_code', c.country_code,
        'status', c.status, 'requested_apps', to_jsonb(c.requested_apps), 'granted_apps', to_jsonb(c.granted_apps),
        'review_note', CASE WHEN c.status IN ('rejected', 'approved') THEN c.review_note END,
        'can_issue_live', c.status = 'approved', 'live_key_claimed', c.live_key_claimed_at IS NOT NULL,
        'limits', jsonb_build_object('live_per_minute', c.live_rate_per_min, 'live_per_day', c.live_daily_quota),
        'created_at', c.created_at,
        'keys', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                  'prefix', k.prefix, 'mode', k.mode, 'created_at', k.created_at, 'last_used_at', k.last_used_at,
                  'revoked', k.revoked_at IS NOT NULL) ORDER BY k.created_at DESC)
                 FROM public.era_api_keys k WHERE k.client_id = c.id), '[]'::JSONB),
        'calls_24h', (SELECT COUNT(*) FROM public.era_api_log l WHERE l.client_id = c.id AND l.at > now() - INTERVAL '24 hours')
      ) ORDER BY c.created_at DESC)
      FROM public.era_api_clients c WHERE c.owner_user_id = d.user_id AND c.kind = 'developer' AND NOT c.is_system), '[]'::JSONB));
END;
$$;

-- Remember the developer's country. 'detected' = we guessed it from where they connect from, 'chosen' = they picked it.
-- A guess never overwrites a country the developer chose or one that came from their ICAN account.
CREATE OR REPLACE FUNCTION public.era_api_dev_set_country(p_country TEXT, p_source TEXT DEFAULT 'chosen') RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d public.era_api_developers := public.era__dev_profile();
  v_cc TEXT := public.era__country(p_country);
  v_src TEXT := COALESCE(p_source, 'chosen');
BEGIN
  IF v_src NOT IN ('detected', 'chosen') THEN RAISE EXCEPTION 'Source must be detected or chosen.' USING ERRCODE = '22023'; END IF;
  IF v_cc IS NULL THEN RAISE EXCEPTION 'Pick your country.' USING ERRCODE = '22023'; END IF;
  IF v_src = 'detected' AND d.country_code IS NOT NULL AND d.country_source IN ('chosen', 'account') THEN
    RETURN jsonb_build_object('country_code', d.country_code, 'country_source', d.country_source);
  END IF;
  UPDATE public.era_api_developers SET country_code = v_cc, country_source = v_src, updated_at = now() WHERE user_id = d.user_id;
  RETURN jsonb_build_object('country_code', v_cc, 'country_source', v_src);
END;
$$;

-- Register an app from the account. Pending for live access (a person reviews it); the sandbox key works at once.
CREATE OR REPLACE FUNCTION public.era_api_dev_create_app(
  p_app_name TEXT, p_website TEXT, p_description TEXT, p_apps TEXT[], p_country TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d public.era_api_developers := public.era__dev_profile();
  s public.era_api_settings;
  v_name TEXT := btrim(COALESCE(p_app_name, ''));
  v_site TEXT := NULLIF(btrim(COALESCE(p_website, '')), '');
  v_desc TEXT := NULLIF(btrim(COALESCE(p_description, '')), '');
  v_cc TEXT := public.era__country(p_country);
  v_apps TEXT[];
  v_ticket TEXT := 'era_tk_' || public.era__rand(40);
  v_key TEXT := 'era_test_' || public.era__rand(40);
  v_client UUID;
BEGIN
  SELECT * INTO s FROM public.era_api_settings WHERE id;
  IF NOT COALESCE(s.enabled, FALSE) OR NOT COALESCE(s.signups_open, FALSE) THEN
    RAISE EXCEPTION 'New developer sign-ups are paused right now. Try again later.' USING ERRCODE = 'ERA29';
  END IF;
  IF char_length(v_name) < 2 OR char_length(v_name) > 80 THEN
    RAISE EXCEPTION 'Give your app a name (2 to 80 characters).' USING ERRCODE = '22023';
  END IF;
  IF v_site IS NOT NULL AND (v_site !~* '^https?://[^\s]+$' OR char_length(v_site) > 200) THEN
    RAISE EXCEPTION 'The website must start with http:// or https://' USING ERRCODE = '22023';
  END IF;
  IF v_desc IS NOT NULL AND char_length(v_desc) > 600 THEN
    RAISE EXCEPTION 'Keep the description under 600 characters.' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(array_agg(DISTINCT a ORDER BY a), '{}') INTO v_apps
    FROM unnest(COALESCE(p_apps, '{}')) a WHERE a IN ('icanera', 'bodagoera', 'supermarketera', 'farmagentera');
  IF array_length(v_apps, 1) IS NULL THEN
    RAISE EXCEPTION 'Pick at least one of the four apps.' USING ERRCODE = '22023';
  END IF;

  -- the country: the one given now, else the one on the account. Either way it is remembered on the account.
  v_cc := COALESCE(v_cc, d.country_code);
  IF v_cc IS NULL THEN RAISE EXCEPTION 'Choose your country first.' USING ERRCODE = '22023'; END IF;
  IF p_country IS NOT NULL AND btrim(p_country) <> '' THEN
    UPDATE public.era_api_developers SET country_code = v_cc, country_source = 'chosen', updated_at = now() WHERE user_id = d.user_id;
  END IF;

  -- Abuse limits: 5 apps per developer, 3 new apps a day, and the same 100-an-hour ceiling as the ticket flow.
  IF (SELECT COUNT(*) FROM public.era_api_clients WHERE owner_user_id = d.user_id AND kind = 'developer' AND NOT is_system) >= 5 THEN
    RAISE EXCEPTION 'You already have 5 apps. Reuse one of them, or ask the platform team for more.' USING ERRCODE = 'ERA29';
  END IF;
  IF (SELECT COUNT(*) FROM public.era_api_clients WHERE owner_user_id = d.user_id AND kind = 'developer' AND created_at > now() - INTERVAL '1 day') >= 3
     OR (SELECT COUNT(*) FROM public.era_api_clients WHERE created_at > now() - INTERVAL '1 hour' AND NOT is_system) >= 100 THEN
    RAISE EXCEPTION 'Too many sign-ups from here. Please try again tomorrow.' USING ERRCODE = 'ERA29';
  END IF;

  INSERT INTO public.era_api_clients (app_name, contact_name, contact_email, website, description, requested_apps, ticket_hash,
                                      kind, owner_user_id, country_code)
  VALUES (v_name, d.full_name, d.email, v_site, v_desc, v_apps, public.era__hash(v_ticket), 'developer', d.user_id, v_cc)
  RETURNING id INTO v_client;

  INSERT INTO public.era_api_keys (client_id, mode, prefix, key_hash, label)
  VALUES (v_client, 'sandbox', left(v_key, 17), public.era__hash(v_key), 'first sandbox key');
  INSERT INTO public.era_api_audit (actor, action, client_id, detail)
  VALUES (d.user_id, 'app_created', v_client, jsonb_build_object('country', v_cc, 'apps', to_jsonb(v_apps)));

  RETURN jsonb_build_object('client_id', v_client, 'status', 'pending', 'apps', to_jsonb(v_apps), 'country_code', v_cc,
                            'sandbox_key', jsonb_build_object('key', v_key, 'prefix', left(v_key, 17)));
END;
$$;

-- Issue (or rotate) a key for one of MY apps. Same rules as the ticket flow:
--   sandbox: always available, replaces the previous sandbox key
--   live:    only once an administrator has approved the app, replaces the previous live key
CREATE OR REPLACE FUNCTION public.era_api_dev_issue_key(p_client_id UUID, p_mode TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d public.era_api_developers := public.era__dev_profile();
  c public.era_api_clients;
  v_key TEXT;
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN ('sandbox', 'live') THEN
    RAISE EXCEPTION 'Mode must be sandbox or live.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO c FROM public.era_api_clients
   WHERE id = p_client_id AND owner_user_id = d.user_id AND kind = 'developer' AND NOT is_system FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No such app on your account.' USING ERRCODE = 'P0002'; END IF;

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
  VALUES (d.user_id, 'key_issued', c.id, jsonb_build_object('mode', p_mode, 'prefix', left(v_key, 17)));

  RETURN jsonb_build_object('mode', p_mode, 'key', v_key, 'prefix', left(v_key, 17),
                            'note', 'Copy it now. For your safety it is never shown again.');
END;
$$;

-- ---------------------------------------------------------------------------- administrators see where an app came from
-- Same function as the business file's, plus country_code and has_account on each row.
CREATE OR REPLACE FUNCTION public.era_api_admin_list_clients(p_status TEXT DEFAULT NULL, p_limit INTEGER DEFAULT 100)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.era__require_admin();
  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(x)::JSONB ORDER BY x.sort_pending DESC, x.created_at DESC) FROM (
      SELECT c.id, c.app_name, c.contact_name, c.contact_email, c.website, c.description, c.requested_apps, c.granted_apps,
             c.status, c.live_rate_per_min, c.live_daily_quota, c.review_note, c.reviewed_at, c.live_key_claimed_at,
             c.is_system, c.kind, c.business_profile_id, c.created_at,
             c.country_code, (c.kind = 'developer' AND c.owner_user_id IS NOT NULL) AS has_account,
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

-- ---------------------------------------------------------------------------- grants
-- Same rule as the other files: close every era_* function, then open exactly the ones that are meant to be called.
DO $$
DECLARE f RECORD;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND (p.proname LIKE 'era\_api\_dev\_%' OR p.proname IN ('era__dev_profile', 'era__country', 'era_api_admin_list_clients')) LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
  END LOOP;
END $$;

-- a signed-in user (no admin rights needed) manages their own developer account
GRANT EXECUTE ON FUNCTION public.era_api_dev_account()                               TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.era_api_dev_set_country(TEXT, TEXT)                 TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.era_api_dev_create_app(TEXT, TEXT, TEXT, TEXT[], TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.era_api_dev_issue_key(UUID, TEXT)                   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.era_api_admin_list_clients(TEXT, INTEGER)           TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.era__dev_profile(), public.era__country(TEXT)       TO service_role;

-- ============================================================
-- ICANERA WALLET — national ID required, one per country rules
-- ============================================================
-- Every personal wallet must have a national ID on file (Uganda: NIN,
-- Kenya: National ID, Nigeria: NIN, ...). What the database keeps:
--
--   * a keyed hash (HMAC-SHA256 with a secret "pepper" that lives in a
--     schema clients cannot reach) — so the SAME ID cannot back two
--     wallets, yet the ID can never be read back, not even by an admin
--     or from a leaked copy of the table;
--   * the last 4 characters, for display ("ID ending 4F2A").
--
-- The ID is checked against a per-country format kept in
-- public.national_id_rules (an ordinary table: change a country's format
-- or add a country with an UPDATE/INSERT, no redeploy). Countries with no
-- row fall back to the 'ZZ' rule (5–20 letters/digits).
--
-- NOTE: this validates FORMAT and UNIQUENESS only. It does not prove the
-- ID is real or belongs to the person — that needs a lookup against the
-- issuing authority (e.g. NIRA in Uganda), which is a separate integration.
-- That is why user_accounts.kyc_verified is NOT touched here.
--
-- ENFORCEMENT IS OFF WHEN THIS RUNS. Nothing is blocked until you switch it on:
--     UPDATE public.national_id_enforcement SET enforced = true, enforced_from = now();
-- and it can be switched off again the same way (enforced = false).
-- When on, a database trigger refuses:
--   1. finishing a new personal wallet (setting its first PIN) with no ID, and
--   2. any DEBIT (balance going down) on a wallet whose owner has no ID —
--      this is the one place every transfer / withdrawal / sale function
--      passes through, so none of them needs editing.
-- Receiving money is never blocked. Accounts that must keep moving money
-- without a person behind them (treasury, fee accounts) go in
-- public.national_id_exemptions.
--
-- BACK UP the pepper (app_private.secrets, name = 'national_id_pepper')
-- with the rest of your secrets. If it is ever lost or regenerated, stored
-- hashes can no longer be matched and duplicate detection stops working.
--
-- Safe to run more than once. Run order: any time after CREATE_USER_ACCOUNTS_TABLE.sql.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ------------------------------------------------------------
-- 1. Private schema: the pepper and attempt log. Never exposed to the API.
-- ------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC;

CREATE TABLE IF NOT EXISTS app_private.secrets (
  name       TEXT PRIMARY KEY,
  value      BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
REVOKE ALL ON app_private.secrets FROM PUBLIC;

INSERT INTO app_private.secrets (name, value)
VALUES ('national_id_pepper', extensions.gen_random_bytes(32))
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS app_private.national_id_attempts (
  id           BIGSERIAL PRIMARY KEY,
  user_id      UUID NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  success      BOOLEAN NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_national_id_attempts_user
  ON app_private.national_id_attempts (user_id, attempted_at DESC);
REVOKE ALL ON app_private.national_id_attempts FROM PUBLIC;

-- ------------------------------------------------------------
-- 2. Per-country rules (editable)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.national_id_rules (
  country_code VARCHAR(2) PRIMARY KEY,           -- ISO 3166-1 alpha-2; 'ZZ' = fallback for every other country
  id_type      TEXT NOT NULL,                    -- short code stored with the ID, e.g. 'NIN'
  label        TEXT NOT NULL,                    -- what the form calls it
  pattern      TEXT NOT NULL,                    -- POSIX regex, matched against the NORMALIZED value (upper-case, no spaces . -)
  example      TEXT,
  hint         TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.national_id_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS national_id_rules_read ON public.national_id_rules;
CREATE POLICY national_id_rules_read ON public.national_id_rules
  FOR SELECT TO anon, authenticated USING (is_active);
REVOKE ALL ON public.national_id_rules FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.national_id_rules TO anon, authenticated;

-- Starting set. ON CONFLICT DO NOTHING: edits you make later are never overwritten by a re-run.
-- Please confirm each format with your compliance contact before relying on it.
INSERT INTO public.national_id_rules (country_code, id_type, label, pattern, example, hint) VALUES
  ('UG', 'NIN',          'National Identification Number (NIN)', '^C[MF][0-9A-Z]{12}$', 'CM1234567890AB', '14 characters, starting with CM or CF'),
  ('KE', 'NATIONAL_ID',  'National ID number',                   '^[0-9]{7,8}$',         '12345678',       '7 or 8 digits'),
  ('TZ', 'NIDA',         'NIDA number',                          '^[0-9]{20}$',          '19900101123450000123', '20 digits'),
  ('RW', 'NATIONAL_ID',  'National ID number',                   '^[0-9]{16}$',          '1199080012345678', '16 digits'),
  ('NG', 'NIN',          'National Identification Number (NIN)', '^[0-9]{11}$',          '12345678901',    '11 digits'),
  ('GH', 'GHANA_CARD',   'Ghana Card number',                    '^GHA[0-9]{10}$',       'GHA-123456789-0', 'GHA followed by 10 digits'),
  ('ZA', 'ID_NUMBER',    'South African ID number',              '^[0-9]{13}$',          '8001015009087',  '13 digits'),
  ('AL', 'NID',          'Albanian ID (NID)',                    '^[A-Z][0-9]{8}[A-Z]$', 'I90101001A',     'Letter, 8 digits, letter'),
  ('BE', 'NATIONAL_REGISTER', 'Belgian national register number', '^[0-9]{11}$',        '85073003328',    '11 digits'),
  ('PT', 'CITIZEN_CARD', 'Citizen Card / NIF number',            '^[0-9]{8,9}$',         '12345678',       '8 or 9 digits'),
  ('UY', 'CEDULA',       'Cédula de Identidad',                  '^[0-9]{6,8}$',         '1234567',        '6 to 8 digits'),
  ('ZZ', 'NATIONAL_ID',  'National ID / ID number',              '^[A-Z0-9]{5,20}$',     NULL,             '5 to 20 letters or digits')
ON CONFLICT (country_code) DO NOTHING;

-- ------------------------------------------------------------
-- 3. The IDs themselves
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_national_ids (
  user_id      UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  country_code VARCHAR(2) NOT NULL,
  id_type      TEXT NOT NULL,
  id_hash      TEXT NOT NULL UNIQUE,             -- HMAC of country + normalized ID. One wallet per ID.
  id_last4     TEXT NOT NULL,
  verified     BOOLEAN NOT NULL DEFAULT false,   -- reserved for a future issuer lookup (e.g. NIRA)
  verified_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_national_ids ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_national_ids_own_read ON public.user_national_ids;
CREATE POLICY user_national_ids_own_read ON public.user_national_ids
  FOR SELECT TO authenticated USING (user_id = auth.uid());
REVOKE ALL ON public.user_national_ids FROM PUBLIC, anon, authenticated;
-- Column-level grant: the hash itself is never selectable through the API.
GRANT SELECT (user_id, country_code, id_type, id_last4, verified, verified_at, created_at)
  ON public.user_national_ids TO authenticated;

-- ------------------------------------------------------------
-- 4. Rollout switch + exemptions
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.national_id_enforcement (
  singleton     BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
  enforced      BOOLEAN NOT NULL DEFAULT false,
  enforced_from TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.national_id_enforcement (singleton, enforced) VALUES (true, false)
ON CONFLICT (singleton) DO NOTHING;
ALTER TABLE public.national_id_enforcement ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.national_id_enforcement FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.national_id_exemptions (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  reason     TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.national_id_exemptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.national_id_exemptions FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 5. Helpers
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_national_id(p_value TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT upper(regexp_replace(COALESCE(p_value, ''), '[\s.\-]', '', 'g'));
$$;

CREATE OR REPLACE FUNCTION app_private.national_id_hash(p_country TEXT, p_normalized TEXT)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
  SELECT encode(
    extensions.hmac(
      convert_to(upper(p_country) || ':' || p_normalized, 'UTF8'),
      (SELECT value FROM app_private.secrets WHERE name = 'national_id_pepper'),
      'sha256'),
    'hex');
$$;
REVOKE ALL ON FUNCTION app_private.national_id_hash(TEXT, TEXT) FROM PUBLIC;

-- The rule the form should show for a country (falls back to 'ZZ').
CREATE OR REPLACE FUNCTION public.get_national_id_rule(p_country TEXT)
RETURNS TABLE (country_code TEXT, id_type TEXT, label TEXT, pattern TEXT, example TEXT, hint TEXT, is_fallback BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(r.country_code, f.country_code)::TEXT, COALESCE(r.id_type, f.id_type),
         COALESCE(r.label, f.label), COALESCE(r.pattern, f.pattern),
         COALESCE(r.example, f.example), COALESCE(r.hint, f.hint),
         (r.country_code IS NULL)
    FROM (SELECT 1) one
    LEFT JOIN public.national_id_rules r
           ON r.country_code = upper(trim(p_country)) AND r.is_active
    LEFT JOIN public.national_id_rules f
           ON f.country_code = 'ZZ' AND f.is_active
   LIMIT 1;
$$;

-- What the app needs to decide whether to show the ID step / blocking screen.
CREATE OR REPLACE FUNCTION public.get_my_national_id_status()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_id  public.user_national_ids;
  v_enforced BOOLEAN;
  v_account_country TEXT;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('authenticated', false); END IF;
  SELECT enforced INTO v_enforced FROM public.national_id_enforcement LIMIT 1;
  SELECT * INTO v_id FROM public.user_national_ids WHERE user_id = v_uid;
  SELECT country_code INTO v_account_country
    FROM public.user_accounts WHERE user_id = v_uid AND account_type = 'personal'
   ORDER BY created_at LIMIT 1;
  RETURN jsonb_build_object(
    'authenticated', true,
    'enforced', COALESCE(v_enforced, false),
    'exempt', EXISTS (SELECT 1 FROM public.national_id_exemptions WHERE user_id = v_uid),
    'hasId', v_id.user_id IS NOT NULL,
    'countryCode', v_id.country_code,
    'idType', v_id.id_type,
    'last4', v_id.id_last4,
    'accountCountry', v_account_country
  );
END; $$;

-- Save the caller's national ID. One-way: once set it cannot be changed from the app.
-- Errors come back as { success: false, error } (not exceptions) so failed attempts are still counted.
CREATE OR REPLACE FUNCTION public.set_my_national_id(p_country TEXT, p_id TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_country TEXT := upper(trim(COALESCE(p_country, '')));
  v_norm    TEXT := public.normalize_national_id(p_id);
  v_rule    RECORD;
  v_account_country TEXT;
  v_hash    TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;

  IF v_country !~ '^[A-Z]{2}$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Choose your country first.');
  END IF;

  -- Slows anyone using the "already linked" answer to probe for other people's IDs.
  IF (SELECT count(*) FROM app_private.national_id_attempts
       WHERE user_id = v_uid AND NOT success AND attempted_at > now() - interval '1 hour') >= 5 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Too many attempts. Please try again in an hour.');
  END IF;

  IF EXISTS (SELECT 1 FROM public.user_national_ids WHERE user_id = v_uid) THEN
    RETURN jsonb_build_object('success', false, 'error', 'A national ID is already on file for this wallet. Contact support to change it.');
  END IF;

  SELECT * INTO v_rule FROM public.get_national_id_rule(v_country);
  IF v_rule.pattern IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'National ID rules are not set up yet. Please try again later.');
  END IF;

  IF v_norm !~ v_rule.pattern THEN
    INSERT INTO app_private.national_id_attempts (user_id, success) VALUES (v_uid, false);
    RETURN jsonb_build_object('success', false,
      'error', format('That does not look like a valid %s%s.', v_rule.label,
                      CASE WHEN v_rule.hint IS NOT NULL THEN ' (' || v_rule.hint || ')' ELSE '' END));
  END IF;

  SELECT country_code INTO v_account_country
    FROM public.user_accounts WHERE user_id = v_uid AND account_type = 'personal'
   ORDER BY created_at LIMIT 1;
  IF v_account_country IS NOT NULL AND upper(v_account_country) <> v_country THEN
    RETURN jsonb_build_object('success', false,
      'error', format('Your wallet is registered in %s, so the ID must be from %s.', v_account_country, v_account_country));
  END IF;

  v_hash := app_private.national_id_hash(v_country, v_norm);

  BEGIN
    INSERT INTO public.user_national_ids (user_id, country_code, id_type, id_hash, id_last4)
    VALUES (v_uid, v_country, v_rule.id_type, v_hash, right(v_norm, 4));
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO app_private.national_id_attempts (user_id, success) VALUES (v_uid, false);
    RETURN jsonb_build_object('success', false,
      'error', 'This ID is already linked to another wallet. If it is yours, contact support.');
  END;

  UPDATE public.user_accounts SET country_code = v_country
   WHERE user_id = v_uid AND account_type = 'personal' AND country_code IS NULL;

  INSERT INTO app_private.national_id_attempts (user_id, success) VALUES (v_uid, true);
  RETURN jsonb_build_object('success', true, 'countryCode', v_country, 'idType', v_rule.id_type, 'last4', right(v_norm, 4));
END; $$;

-- ------------------------------------------------------------
-- 6. Enforcement trigger (does nothing while enforced = false)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._national_id_enforce()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID;
  v_blocked BOOLEAN := false;
  v_what TEXT;
BEGIN
  IF NOT COALESCE((SELECT enforced FROM public.national_id_enforcement LIMIT 1), false) THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'user_accounts' THEN
    IF NEW.account_type IS DISTINCT FROM 'personal' THEN RETURN NEW; END IF;
    v_uid := NEW.user_id;
    IF OLD.pin_hash IS NULL AND NEW.pin_hash IS NOT NULL THEN
      v_blocked := true; v_what := 'create your wallet';
    ELSIF COALESCE(NEW.usd_balance, 0)       < COALESCE(OLD.usd_balance, 0)
       OR COALESCE(NEW.ugx_balance, 0)       < COALESCE(OLD.ugx_balance, 0)
       OR COALESCE(NEW.kes_balance, 0)       < COALESCE(OLD.kes_balance, 0)
       OR COALESCE(NEW.ican_coin_balance, 0) < COALESCE(OLD.ican_coin_balance, 0) THEN
      v_blocked := true; v_what := 'send or withdraw money';
    END IF;
  ELSIF TG_TABLE_NAME = 'ican_user_wallets' THEN
    v_uid := NEW.user_id;
    IF COALESCE(NEW.ican_balance, 0) < COALESCE(OLD.ican_balance, 0) THEN
      v_blocked := true; v_what := 'send or withdraw money';
    END IF;
  ELSE  -- user_wallets, wallet_accounts
    v_uid := NEW.user_id;
    IF COALESCE(NEW.balance, 0) < COALESCE(OLD.balance, 0) THEN
      v_blocked := true; v_what := 'send or withdraw money';
    END IF;
  END IF;

  IF NOT v_blocked OR v_uid IS NULL THEN RETURN NEW; END IF;

  IF EXISTS (SELECT 1 FROM public.user_national_ids WHERE user_id = v_uid)
     OR EXISTS (SELECT 1 FROM public.national_id_exemptions WHERE user_id = v_uid) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'NATIONAL_ID_REQUIRED: add your national ID to your wallet before you % .', v_what
    USING ERRCODE = 'P0001', HINT = 'national_id_required';
END; $$;
REVOKE ALL ON FUNCTION public._national_id_enforce() FROM PUBLIC;

-- Attach to each balance table that exists (the list matches the live schema; tables
-- or columns that do not exist in a given database are skipped, not errors).
DO $attach$
BEGIN
  IF to_regclass('public.user_accounts') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_national_id_enforce ON public.user_accounts;
    CREATE TRIGGER trg_national_id_enforce
      BEFORE UPDATE OF pin_hash, usd_balance, ugx_balance, kes_balance, ican_coin_balance
      ON public.user_accounts FOR EACH ROW EXECUTE FUNCTION public._national_id_enforce();
  END IF;
  IF to_regclass('public.ican_user_wallets') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_national_id_enforce ON public.ican_user_wallets;
    CREATE TRIGGER trg_national_id_enforce
      BEFORE UPDATE OF ican_balance
      ON public.ican_user_wallets FOR EACH ROW EXECUTE FUNCTION public._national_id_enforce();
  END IF;
  IF to_regclass('public.user_wallets') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_national_id_enforce ON public.user_wallets;
    CREATE TRIGGER trg_national_id_enforce
      BEFORE UPDATE OF balance
      ON public.user_wallets FOR EACH ROW EXECUTE FUNCTION public._national_id_enforce();
  END IF;
  IF to_regclass('public.wallet_accounts') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_national_id_enforce ON public.wallet_accounts;
    CREATE TRIGGER trg_national_id_enforce
      BEFORE UPDATE OF balance
      ON public.wallet_accounts FOR EACH ROW EXECUTE FUNCTION public._national_id_enforce();
  END IF;
END
$attach$;

-- ------------------------------------------------------------
-- 7. Grants
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.set_my_national_id(TEXT, TEXT)      FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_national_id_status()         FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_national_id_rule(TEXT)          FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_my_national_id(TEXT, TEXT)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_national_id_status()      TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_national_id_rule(TEXT)       TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_national_id(TEXT)      TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'National ID per country installed. Enforcement is OFF — see header to switch it on.' AS status;

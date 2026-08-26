-- ================================================================
-- 1) Account numbers become pure digits (no "ICAN-" prefix)
-- 2) PIN reset (both the self-service email flow and the dev-panel
--    developer-review flow) becomes scoped to a chosen account type
--    (personal vs business) instead of always resetting every
--    user_accounts row a user owns.
--
-- PREREQUISITES — run once in the Supabase SQL Editor, in this order:
--   1. PIN_RECOVERY_AND_ACCOUNT_UNLOCK.sql (creates account_unlock_requests)
--   2. PIN_RESET_EMAIL_SELFSERVICE.sql (creates pin_reset_tokens)
--   3. this file (alters both, adds account_type scoping to both)
-- ================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- redeem_pin_reset_token() below uses digest()

-- ----------------------------------------------------------------
-- Part 1: auto-signup trigger — align with walletAccountService.js's
-- generateAccountNumber(): 16 raw digits, leading digit 1 = personal
-- (this trigger only ever creates the personal account on signup, so
-- it's always '1'). Supersedes the account_number expression in
-- AUTO_CREATE_USER_ACCOUNTS.sql / FIX_AUTO_SIGNUP_TRIGGER_NAMESPACE_ICAN.sql
-- (both left as historical record, not re-run here) — those produced
-- 'ICAN-<timestamp>-<uuid prefix>', which ICANWallet.jsx's recipient
-- lookup can no longer match now that lookup detects account numbers
-- by a 16-digit numeric pattern instead of an "ICAN-" prefix.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_accounts (
    user_id,
    email,
    account_number,
    account_type,
    country_code,
    status,
    created_at,
    updated_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    '1' || TO_CHAR(NOW(), 'YYYYMMDDHH24MISS') ||
      (ABS(('x' || SUBSTRING(MD5(NEW.id::text), 1, 8))::bit(32)::int) % 10)::text,
    'personal',
    COALESCE((NEW.raw_user_meta_data->>'country_code')::VARCHAR(2), NULL),
    'active',
    NOW(),
    NOW()
  )
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ----------------------------------------------------------------
-- Part 2a: self-service email reset (PIN_RESET_EMAIL_SELFSERVICE.sql)
-- gains an account_type column so a link is scoped to the account type
-- the requester chose (Personal/ICAN vs Business) in PINRecoveryModal.jsx,
-- instead of resetting every user_accounts row for that user_id.
-- ----------------------------------------------------------------
ALTER TABLE public.pin_reset_tokens
  ADD COLUMN IF NOT EXISTS account_type text NOT NULL DEFAULT 'personal'
    CHECK (account_type IN ('personal', 'business'));

DROP FUNCTION IF EXISTS public.redeem_pin_reset_token(text, text);

CREATE OR REPLACE FUNCTION public.redeem_pin_reset_token(
  p_token text,
  p_new_pin_hash text
)
RETURNS TABLE (success boolean, message text)
-- extensions is needed on the search_path because Supabase installs
-- pgcrypto into the `extensions` schema by default, not `public` — a
-- SECURITY DEFINER function only sees the schemas listed here, so an
-- unqualified digest() call below would otherwise fail with
-- "function digest(text, unknown) does not exist".
SECURITY DEFINER SET search_path = public, extensions LANGUAGE plpgsql AS $$
DECLARE
  v_token_hash text;
  v_row record;
BEGIN
  IF p_token IS NULL OR length(p_token) < 32 OR p_new_pin_hash IS NULL OR p_new_pin_hash = '' THEN
    RETURN QUERY SELECT false, 'Invalid request.'::text;
    RETURN;
  END IF;

  v_token_hash := encode(digest(p_token, 'sha256'), 'hex');

  SELECT * INTO v_row
  FROM public.pin_reset_tokens
  WHERE token_hash = v_token_hash
    AND used_at IS NULL
    AND expires_at > now()
  LIMIT 1;

  IF v_row IS NULL THEN
    RETURN QUERY SELECT false, 'This reset link is invalid or has expired. Request a new one.'::text;
    RETURN;
  END IF;

  -- Scoped to the account type the requester chose — a user can own both a
  -- personal and a business user_accounts row; only the chosen one resets.
  UPDATE public.user_accounts
  SET pin_hash = p_new_pin_hash,
      pin_attempts = 0,
      pin_locked_until = NULL,
      failed_pin_attempts = 0,
      updated_at = now()
  WHERE user_id = v_row.user_id
    AND account_type = v_row.account_type;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, ('No ' || v_row.account_type || ' account found for this link.')::text;
    RETURN;
  END IF;

  UPDATE public.pin_reset_tokens
  SET used_at = now()
  WHERE id = v_row.id;

  UPDATE public.pin_reset_tokens
  SET used_at = now()
  WHERE user_id = v_row.user_id AND account_type = v_row.account_type AND used_at IS NULL;

  RETURN QUERY SELECT true, 'PIN reset — sign in with your new PIN.'::text;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, 'Error: ' || SQLERRM;
END;
$$;

GRANT EXECUTE ON FUNCTION public.redeem_pin_reset_token(text, text) TO anon, authenticated;

-- ----------------------------------------------------------------
-- Part 2b: dev-review flow (PIN_RECOVERY_AND_ACCOUNT_UNLOCK.sql) gains
-- the same account_type scoping — the requester now states up front
-- (PINRecoveryModal.jsx) whether the request is about their Personal or
-- Business account, and the dev panel resolves only that row.
-- account_type is nullable+defaulted so requests submitted before this
-- migration (no chosen type recorded) keep the old "reset every row the
-- user owns" behavior — same as before, not a behavior change for them.
-- ----------------------------------------------------------------
ALTER TABLE public.account_unlock_requests
  ADD COLUMN IF NOT EXISTS account_type text
    CHECK (account_type IN ('personal', 'business'));

DROP FUNCTION IF EXISTS public.request_account_unlock(uuid, text, text, uuid);

CREATE OR REPLACE FUNCTION public.request_account_unlock(
  p_user_id uuid,
  p_request_type text,   -- 'pin_reset' or 'account_unlock'
  p_reason text DEFAULT NULL,
  p_group_id uuid DEFAULT NULL,
  p_account_type text DEFAULT NULL  -- 'personal' or 'business', NULL = both (legacy behavior)
)
RETURNS TABLE (success boolean, message text, request_id uuid)
SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
DECLARE
  v_request_id uuid;
BEGIN
  IF p_request_type NOT IN ('pin_reset', 'account_unlock') THEN
    RETURN QUERY SELECT false, 'Invalid request type'::text, NULL::uuid;
    RETURN;
  END IF;

  IF p_account_type IS NOT NULL AND p_account_type NOT IN ('personal', 'business') THEN
    RETURN QUERY SELECT false, 'Invalid account type'::text, NULL::uuid;
    RETURN;
  END IF;

  IF auth.uid() IS NULL OR auth.uid() != p_user_id THEN
    RETURN QUERY SELECT false, 'Not authorized to request recovery for this account'::text, NULL::uuid;
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.user_accounts WHERE user_id = p_user_id) THEN
    RETURN QUERY SELECT false, 'User not found'::text, NULL::uuid;
    RETURN;
  END IF;

  IF p_group_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.group_accounts WHERE group_id = p_group_id
  ) THEN
    RETURN QUERY SELECT false, 'Group wallet not found'::text, NULL::uuid;
    RETURN;
  END IF;

  SELECT id INTO v_request_id
  FROM public.account_unlock_requests
  WHERE user_id = p_user_id
    AND request_type = p_request_type
    AND status = 'pending'
    AND group_id IS NOT DISTINCT FROM p_group_id
    AND account_type IS NOT DISTINCT FROM p_account_type
  LIMIT 1;

  IF v_request_id IS NOT NULL THEN
    RETURN QUERY SELECT true, 'You already have a pending request — a developer will review it shortly.'::text, v_request_id;
    RETURN;
  END IF;

  v_request_id := gen_random_uuid();
  INSERT INTO public.account_unlock_requests (id, user_id, group_id, request_type, reason, status, account_type)
  VALUES (v_request_id, p_user_id, p_group_id, p_request_type, p_reason, 'pending', p_account_type);

  RETURN QUERY SELECT true, 'Request submitted — a developer will review it shortly.'::text, v_request_id;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, 'Error: ' || SQLERRM, NULL::uuid;
END;
$$;
GRANT EXECUTE ON FUNCTION public.request_account_unlock(uuid, text, text, uuid, text) TO authenticated;

-- Dev panel listing: surface account_type and match the account row shown
-- to the chosen type when one was recorded (falls back to the old
-- personal-first pick when account_type is NULL, same as before).
DROP FUNCTION IF EXISTS public.ican_dev_get_recovery_requests(text);

CREATE OR REPLACE FUNCTION public.ican_dev_get_recovery_requests(dev_token TEXT)
RETURNS TABLE (
  request_id          UUID,
  user_id             UUID,
  group_id            UUID,
  group_name          TEXT,
  request_type        TEXT,
  account_type        TEXT,
  reason              TEXT,
  status              TEXT,
  created_at          TIMESTAMPTZ,
  account_holder_name TEXT,
  account_number      TEXT,
  email               TEXT,
  phone_number        TEXT,
  pin_attempts        INTEGER,
  pin_locked_until    TIMESTAMPTZ,
  failed_pin_attempts INTEGER
)
SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
BEGIN
  IF dev_token != 'dev_ICAN_Pr0_KV25' THEN RAISE EXCEPTION 'unauthorized'; END IF;
  RETURN QUERY
    SELECT sub.id::uuid, sub.user_id::uuid, sub.group_id::uuid, sub.group_name::text,
           sub.request_type::text, sub.account_type::text, sub.reason::text, sub.status::text, sub.created_at::timestamptz,
           sub.account_holder_name::text, sub.account_number::text, sub.email::text, sub.phone_number::text,
           sub.pin_attempts::integer, sub.pin_locked_until::timestamptz, sub.failed_pin_attempts::integer
    FROM (
      SELECT DISTINCT ON (r.id)
             r.id, r.user_id, r.group_id, tg.name AS group_name,
             r.request_type, r.account_type, r.reason, r.status, r.created_at,
             ua.account_holder_name, ua.account_number, ua.email, ua.phone_number,
             ua.pin_attempts, ua.pin_locked_until, ua.failed_pin_attempts
      FROM public.account_unlock_requests r
      JOIN public.user_accounts ua ON ua.user_id = r.user_id
      LEFT JOIN public.trust_groups tg ON tg.id = r.group_id
      ORDER BY r.id,
        -- Prefer the row matching the requester's chosen account_type; if
        -- none was chosen (legacy request), prefer personal first as before.
        (ua.account_type = COALESCE(r.account_type, 'personal')) DESC,
        ua.created_at ASC
    ) sub
    ORDER BY (sub.status = 'pending') DESC, sub.created_at DESC
    LIMIT 200;
EXCEPTION WHEN undefined_table THEN
  RETURN QUERY
    SELECT sub.id::uuid, sub.user_id::uuid, sub.group_id::uuid, NULL::text,
           sub.request_type::text, sub.account_type::text, sub.reason::text, sub.status::text, sub.created_at::timestamptz,
           sub.account_holder_name::text, sub.account_number::text, sub.email::text, sub.phone_number::text,
           sub.pin_attempts::integer, sub.pin_locked_until::timestamptz, sub.failed_pin_attempts::integer
    FROM (
      SELECT DISTINCT ON (r.id)
             r.id, r.user_id, r.group_id,
             r.request_type, r.account_type, r.reason, r.status, r.created_at,
             ua.account_holder_name, ua.account_number, ua.email, ua.phone_number,
             ua.pin_attempts, ua.pin_locked_until, ua.failed_pin_attempts
      FROM public.account_unlock_requests r
      JOIN public.user_accounts ua ON ua.user_id = r.user_id
      ORDER BY r.id, (ua.account_type = COALESCE(r.account_type, 'personal')) DESC, ua.created_at ASC
    ) sub
    ORDER BY (sub.status = 'pending') DESC, sub.created_at DESC
    LIMIT 200;
END; $$;
GRANT EXECUTE ON FUNCTION public.ican_dev_get_recovery_requests(TEXT) TO anon, authenticated;

-- Dev panel resolution: scope the unlock/PIN-reset UPDATE to the chosen
-- account_type when the request recorded one; NULL (legacy requests) keeps
-- resetting every user_accounts row for that user, exactly as before.
DROP FUNCTION IF EXISTS public.ican_dev_resolve_recovery_request(text, uuid, text, text, text, text);

CREATE OR REPLACE FUNCTION public.ican_dev_resolve_recovery_request(
  dev_token TEXT,
  p_request_id UUID,
  p_action TEXT,             -- 'unlock' or 'reject'
  p_new_pin_hash TEXT DEFAULT NULL,
  p_admin_note TEXT DEFAULT NULL,
  p_new_pin_plain TEXT DEFAULT NULL
)
RETURNS TABLE (success boolean, message text)
SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
DECLARE
  v_user_id UUID;
  v_group_id UUID;
  v_account_type TEXT;
BEGIN
  IF dev_token != 'dev_ICAN_Pr0_KV25' THEN RAISE EXCEPTION 'unauthorized'; END IF;

  IF p_action NOT IN ('unlock', 'reject') THEN
    RETURN QUERY SELECT false, 'Invalid action'::text;
    RETURN;
  END IF;

  SELECT user_id, group_id, account_type INTO v_user_id, v_group_id, v_account_type
  FROM public.account_unlock_requests
  WHERE id = p_request_id AND status = 'pending';

  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT false, 'Request not found or already resolved'::text;
    RETURN;
  END IF;

  IF p_action = 'reject' THEN
    UPDATE public.account_unlock_requests
    SET status = 'rejected', admin_note = p_admin_note, updated_at = now()
    WHERE id = p_request_id;
    RETURN QUERY SELECT true, 'Request rejected'::text;
    RETURN;
  END IF;

  IF v_group_id IS NOT NULL THEN
    UPDATE public.group_accounts
    SET pin_attempts = 0,
        pin_locked_until = NULL,
        pin_hash = COALESCE(p_new_pin_hash, pin_hash)
    WHERE group_id = v_group_id;
  ELSE
    UPDATE public.user_accounts
    SET pin_attempts = 0,
        pin_locked_until = NULL,
        failed_pin_attempts = 0,
        pin_hash = COALESCE(p_new_pin_hash, pin_hash),
        updated_at = now()
    WHERE user_id = v_user_id
      AND (v_account_type IS NULL OR account_type = v_account_type);
  END IF;

  UPDATE public.account_unlock_requests
  SET status = 'completed', admin_note = p_admin_note,
      resolved_pin_plain = p_new_pin_plain,
      approved_at = now(), completed_at = now(), updated_at = now()
  WHERE id = p_request_id;

  RETURN QUERY SELECT true, 'Account unlocked'::text;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, 'Error: ' || SQLERRM;
END;
$$;
GRANT EXECUTE ON FUNCTION public.ican_dev_resolve_recovery_request(TEXT, UUID, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

SELECT 'Account numbers are numeric-only; both reset flows are now account_type-scoped.' AS status;

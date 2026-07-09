-- ============================================================
-- PIN RECOVERY & ACCOUNT UNLOCK — developer-approved flow
-- Run once in Supabase SQL editor (safe to re-run)
--
-- The original version of this file (superseded by this one) had two
-- real problems, found while wiring the wallet's "Forgot PIN /
-- Account Locked?" flow to the dev panel:
--
--  1. reset_pin_with_token() and admin_unlock_account() referenced a
--     column, failed_pin_attempts, that doesn't exist on
--     user_accounts — the real columns are pin_attempts /
--     pin_locked_until (see CREATE_USER_ACCOUNTS_TABLE.sql). Both
--     functions would error if actually invoked.
--
--  2. request_account_unlock() handed the unlock_token straight back
--     to the requesting client, which then called
--     reset_pin_with_token() itself — a pure self-service bypass with
--     no developer ever involved, despite the UI implying "an admin
--     will review this." admin_unlock_account() also had no caller
--     verification at all — any authenticated user could unlock any
--     other account by passing its user_id.
--
-- This version removes the client-side bypass entirely: submitting a
-- request only ever creates a pending row. Resolving it (unlock,
-- reset PIN, or reject) can only be done through
-- ican_dev_resolve_recovery_request(), gated by the same dev_token
-- pattern as every other function in DEV_PANEL_ACCESS.sql — that's
-- the "direct connect to the developer panel."
--
-- Also supports group wallet PINs (group_accounts, same pin_attempts
-- / pin_locked_until / pin_hash columns), not just personal/business
-- user_accounts — pass p_group_id when the request is about a shared
-- group wallet rather than the caller's own account.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.account_unlock_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  group_id uuid,
  request_type text NOT NULL CHECK (request_type IN ('pin_reset', 'account_unlock')),
  reason text,
  admin_note text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'completed')),
  unlock_token text,
  token_expires_at timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.account_unlock_requests ADD COLUMN IF NOT EXISTS group_id uuid;
ALTER TABLE public.account_unlock_requests ADD COLUMN IF NOT EXISTS admin_note text;
-- Set only when a developer picks a new PIN while resolving — lets the
-- requester's own polling UI learn the PIN that was just set for them,
-- since there's no email/SMS channel in this dev-panel-only flow.
-- resolved_pin_hash is unused (kept for backward compat) — the real PIN
-- hash used for verification (agentService.js's hashPIN, a salted hash,
-- NOT plain base64) isn't reversible, so the plaintext PIN travels
-- separately in resolved_pin_plain purely for this one-time display.
ALTER TABLE public.account_unlock_requests ADD COLUMN IF NOT EXISTS resolved_pin_hash text;
ALTER TABLE public.account_unlock_requests ADD COLUMN IF NOT EXISTS resolved_pin_plain text;

CREATE INDEX IF NOT EXISTS idx_unlock_requests_user    ON public.account_unlock_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_unlock_requests_status  ON public.account_unlock_requests(status);
CREATE INDEX IF NOT EXISTS idx_unlock_requests_created ON public.account_unlock_requests(created_at DESC);

ALTER TABLE public.account_unlock_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own requests" ON public.account_unlock_requests;
CREATE POLICY "Users can view their own requests"
  ON public.account_unlock_requests FOR SELECT
  USING (auth.uid() = user_id);

-- No direct INSERT/UPDATE policy for regular users — every write to this
-- table goes through the SECURITY DEFINER functions below, so a request
-- can never be self-approved from the client.

-- ============================================================
-- 1) A locked-out / forgot-PIN user submits a request
-- ============================================================
DROP FUNCTION IF EXISTS public.request_account_unlock(uuid, text, text);
DROP FUNCTION IF EXISTS public.request_account_unlock(uuid, text, text, uuid);

CREATE OR REPLACE FUNCTION public.request_account_unlock(
  p_user_id uuid,
  p_request_type text,   -- 'pin_reset' or 'account_unlock'
  p_reason text DEFAULT NULL,
  p_group_id uuid DEFAULT NULL
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

  -- Only the account owner can request recovery for themselves — this
  -- also covers group-wallet requests, since the requester is always the
  -- signed-in ICAN user asking on behalf of a group they belong to.
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

  -- Don't pile up duplicate pending requests for the same target/type
  SELECT id INTO v_request_id
  FROM public.account_unlock_requests
  WHERE user_id = p_user_id
    AND request_type = p_request_type
    AND status = 'pending'
    AND group_id IS NOT DISTINCT FROM p_group_id
  LIMIT 1;

  IF v_request_id IS NOT NULL THEN
    RETURN QUERY SELECT true, 'You already have a pending request — a developer will review it shortly.'::text, v_request_id;
    RETURN;
  END IF;

  v_request_id := gen_random_uuid();
  INSERT INTO public.account_unlock_requests (id, user_id, group_id, request_type, reason, status)
  VALUES (v_request_id, p_user_id, p_group_id, p_request_type, p_reason, 'pending');

  RETURN QUERY SELECT true, 'Request submitted — a developer will review it shortly.'::text, v_request_id;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, 'Error: ' || SQLERRM, NULL::uuid;
END;
$$;
GRANT EXECUTE ON FUNCTION public.request_account_unlock(uuid, text, text, uuid) TO authenticated;

-- ============================================================
-- 2) User checks their own request's status (for polling in the UI)
-- ============================================================
DROP FUNCTION IF EXISTS public.get_unlock_request_status(uuid);

CREATE OR REPLACE FUNCTION public.get_unlock_request_status(p_request_id uuid)
RETURNS TABLE (
  request_id uuid, request_type text, status text,
  created_at timestamptz, message text, new_pin text
)
SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
DECLARE v_record record;
BEGIN
  -- Table alias + qualified columns are required here: RETURNS TABLE's OUT
  -- names (request_type, status, created_at) are in scope as PL/pgSQL
  -- variables throughout this function, so bare column names collide with
  -- them ("column reference is ambiguous").
  SELECT aur.id, aur.request_type, aur.status, aur.created_at, aur.user_id, aur.resolved_pin_plain
  INTO v_record
  FROM public.account_unlock_requests aur
  WHERE aur.id = p_request_id;

  IF v_record IS NULL OR v_record.user_id != auth.uid() THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, NULL::text, NULL::timestamptz, 'Request not found'::text, NULL::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT
    v_record.id, v_record.request_type, v_record.status, v_record.created_at,
    CASE
      WHEN v_record.status = 'completed' THEN 'Resolved — try again now.'::text
      WHEN v_record.status = 'rejected'  THEN 'This request was rejected. Reach out to support for more help.'::text
      ELSE 'Pending review by a developer.'::text
    END,
    CASE
      WHEN v_record.status = 'completed' THEN v_record.resolved_pin_plain
      ELSE NULL
    END;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_unlock_request_status(uuid) TO authenticated;

-- ============================================================
-- 3) Dev panel: list recovery requests (dev_token gated, same
--    pattern as every function in DEV_PANEL_ACCESS.sql)
-- ============================================================
DROP FUNCTION IF EXISTS public.ican_dev_get_recovery_requests(text);

CREATE OR REPLACE FUNCTION public.ican_dev_get_recovery_requests(dev_token TEXT)
RETURNS TABLE (
  request_id          UUID,
  user_id             UUID,
  group_id            UUID,
  group_name          TEXT,
  request_type        TEXT,
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
  -- user_accounts.user_id is NOT unique (a user can have a personal AND a
  -- business account row), so joining straight on it can multiply one
  -- request into several rows. DISTINCT ON (r.id) picks a single account
  -- per request, preferring the personal account when there's more than one.
  --
  -- failed_pin_attempts is surfaced too because it — not pin_attempts — is
  -- what process_cashout_with_pin() and friends actually gate on.
  RETURN QUERY
    SELECT sub.id::uuid, sub.user_id::uuid, sub.group_id::uuid, sub.group_name::text,
           sub.request_type::text, sub.reason::text, sub.status::text, sub.created_at::timestamptz,
           sub.account_holder_name::text, sub.account_number::text, sub.email::text, sub.phone_number::text,
           sub.pin_attempts::integer, sub.pin_locked_until::timestamptz, sub.failed_pin_attempts::integer
    FROM (
      SELECT DISTINCT ON (r.id)
             r.id, r.user_id, r.group_id, tg.name AS group_name,
             r.request_type, r.reason, r.status, r.created_at,
             ua.account_holder_name, ua.account_number, ua.email, ua.phone_number,
             ua.pin_attempts, ua.pin_locked_until, ua.failed_pin_attempts
      FROM public.account_unlock_requests r
      JOIN public.user_accounts ua ON ua.user_id = r.user_id
      LEFT JOIN public.trust_groups tg ON tg.id = r.group_id
      ORDER BY r.id, (ua.account_type = 'personal') DESC, ua.created_at ASC
    ) sub
    ORDER BY (sub.status = 'pending') DESC, sub.created_at DESC
    LIMIT 200;
EXCEPTION WHEN undefined_table THEN
  -- trust_groups doesn't exist in this environment — same request list, no group name
  RETURN QUERY
    SELECT sub.id::uuid, sub.user_id::uuid, sub.group_id::uuid, NULL::text,
           sub.request_type::text, sub.reason::text, sub.status::text, sub.created_at::timestamptz,
           sub.account_holder_name::text, sub.account_number::text, sub.email::text, sub.phone_number::text,
           sub.pin_attempts::integer, sub.pin_locked_until::timestamptz, sub.failed_pin_attempts::integer
    FROM (
      SELECT DISTINCT ON (r.id)
             r.id, r.user_id, r.group_id,
             r.request_type, r.reason, r.status, r.created_at,
             ua.account_holder_name, ua.account_number, ua.email, ua.phone_number,
             ua.pin_attempts, ua.pin_locked_until, ua.failed_pin_attempts
      FROM public.account_unlock_requests r
      JOIN public.user_accounts ua ON ua.user_id = r.user_id
      ORDER BY r.id, (ua.account_type = 'personal') DESC, ua.created_at ASC
    ) sub
    ORDER BY (sub.status = 'pending') DESC, sub.created_at DESC
    LIMIT 200;
END; $$;
GRANT EXECUTE ON FUNCTION public.ican_dev_get_recovery_requests(TEXT) TO anon, authenticated;

-- ============================================================
-- 4) Dev panel: resolve a request — unlock, reset PIN, or reject
-- ============================================================
DROP FUNCTION IF EXISTS public.ican_dev_resolve_recovery_request(text, uuid, text, text, text);

CREATE OR REPLACE FUNCTION public.ican_dev_resolve_recovery_request(
  dev_token TEXT,
  p_request_id UUID,
  p_action TEXT,             -- 'unlock' or 'reject'
  p_new_pin_hash TEXT DEFAULT NULL,   -- hashed with agentService.js's hashPIN(), NOT plain base64
  p_admin_note TEXT DEFAULT NULL,
  p_new_pin_plain TEXT DEFAULT NULL   -- same PIN, plaintext, only for one-time display to the requester
)
RETURNS TABLE (success boolean, message text)
SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
DECLARE
  v_user_id UUID;
  v_group_id UUID;
BEGIN
  IF dev_token != 'dev_ICAN_Pr0_KV25' THEN RAISE EXCEPTION 'unauthorized'; END IF;

  IF p_action NOT IN ('unlock', 'reject') THEN
    RETURN QUERY SELECT false, 'Invalid action'::text;
    RETURN;
  END IF;

  SELECT user_id, group_id INTO v_user_id, v_group_id
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

  -- action = 'unlock' — clear the lockout, optionally set a new PIN
  IF v_group_id IS NOT NULL THEN
    UPDATE public.group_accounts
    SET pin_attempts = 0,
        pin_locked_until = NULL,
        pin_hash = COALESCE(p_new_pin_hash, pin_hash)
    WHERE group_id = v_group_id;
  ELSE
    -- user_id isn't unique on user_accounts (personal + business rows can
    -- coexist), so target only one row — same "personal first" tie-break
    -- ican_dev_get_recovery_requests uses — instead of updating every
    -- account that user owns.
    -- process_cashout_with_pin() (and the sibling *_with_pin functions)
    -- actually check/increment failed_pin_attempts, not pin_attempts /
    -- pin_locked_until — reset both column sets so every known lock check
    -- clears, regardless of which one a given RPC happens to read.
    UPDATE public.user_accounts
    SET pin_attempts = 0,
        pin_locked_until = NULL,
        failed_pin_attempts = 0,
        pin_hash = COALESCE(p_new_pin_hash, pin_hash),
        updated_at = now()
    WHERE id = (
      SELECT id FROM public.user_accounts
      WHERE user_id = v_user_id
      ORDER BY (account_type = 'personal') DESC, created_at ASC
      LIMIT 1
    );
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

-- Drop the old ungated/broken functions this file used to define —
-- superseded by the dev_token-gated resolve function above.
DROP FUNCTION IF EXISTS public.reset_pin_with_token(uuid, text, text);
DROP FUNCTION IF EXISTS public.admin_unlock_account(uuid, uuid, text);

SELECT 'PIN recovery system installed — requests now require developer approval via the dev panel Recovery tab.' AS status;

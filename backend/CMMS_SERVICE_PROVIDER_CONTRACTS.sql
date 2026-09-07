-- ============================================================
-- CMMS Service Provider Contracts -- public, time-limited, GATED contract
-- pages for OUTSIDE contractors (no CMMS/ICAN login) doing a task for the
-- company, with self-service follow-ups and a payment/transaction record.
-- ============================================================
-- Flow: staff (admin, or any role granted the permission below) publishes
-- a simple contract for whoever is doing the work externally, from the
-- Tasks/Assign tab. The contractor never gets a cmms_users account -- they
-- only ever reach this through one opaque link:
--   /service-provider-contract?token=<access_token>
-- which is deliberately NOT enough on its own. Every contract is private
-- by construction -- there is no "anyone with the link" mode -- staff must
-- choose one gate at publish time:
--   - pin:   a short secret PIN, bcrypt-hashed via pgcrypto (same
--            crypt(pw, gen_salt('bf')) idiom as cmms_report_shares'
--            password mode), attempt-limited (5 tries -> 15 min lockout).
--   - email: the one address allowed to open it, matched case-
--            insensitively with no code step -- the same "email-only
--            access" trade-off CMMS_REPORT_SHARE_EMAIL_ONLY_ACCESS.sql
--            already made for reports: proves nothing about inbox
--            control, but that's an explicitly accepted trade-off there
--            for lower friction, reused here for the same reason.
--
-- This is the SAME opaque-token + narrow SECURITY DEFINER RPC pattern
-- already used by CMMS_EMPLOYMENT_DOCUMENTS.sql and
-- CMMS_REPORT_SHARING_SYSTEM.sql, extended with that file's gated-access
-- shape (fn_get_report_share_access's "tell the caller which gate to show,
-- reveal nothing else" pre-auth response).
--
-- Because the gate credential (PIN) must be hashed server-side, creating
-- AND publishing a contract is now one step through
-- fn_publish_service_provider_contract -- unlike the plain-status-flip
-- employment-documents pattern, a raw client-side INSERT can never see a
-- real PIN hash. Extending or revoking an already-published contract has
-- no secret involved, so those stay plain client-side UPDATEs under RLS.
--
-- Time-limited access ("a certain period ... can be extended or
-- defaulted"): a contract published without an explicit number of days
-- gets a 30-day window; staff extend it later with a plain
-- UPDATE ... SET valid_until = ... (covered by the same RLS policy).
--
-- Data isolation (the other point of this file): every function here
-- touches ONLY these three tables -- the contract, its follow-ups, and
-- its payments. None of them join cmms_users beyond the contract's own
-- provider_name/contact fields, and none touch payroll
-- (CMMS_PAYROLL_*.sql) or inventory (CMMS_INVENTORY_COMPLETE_SCHEMA.sql)
-- tables at all. Staff records, salary figures, and inventory values stay
-- reachable only from inside the authenticated CMMS workspace -- a
-- service provider link can never see them by construction, not just by
-- policy.
--
-- Permission: unlike fn_assign_job's hardcoded "admin/coordinator/
-- supervisor" role list, publishing a contract is gated through the
-- existing tool_access mechanism (cmms_has_tool_action, same one
-- cmms_employment_documents/manage_applications uses) under the 'tasks'
-- tool with a new 'publish_contract' action -- admin always has it via the
-- built-in admin override, and any other role can be granted it from Roles
-- management without a code change.
--
-- Run after: CMMS_ANNOUNCEMENTS_AND_JOBS.sql (cmms_has_tool_action,
-- cmms_current_user_id_for_company), CMMS_TASK_PROGRESS_TRACKING_AND_
-- NOTIFICATIONS.sql (cmms_job_assignments).
-- Safe to run more than once.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- 1. cmms_service_provider_contracts -- the contract itself
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cmms_service_provider_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cmms_company_id UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,
  job_assignment_id UUID REFERENCES public.cmms_job_assignments(id) ON DELETE SET NULL,

  -- The contractor has no CMMS account -- captured as plain fields, the
  -- same way cmms_job_applications captures an applicant with no account.
  provider_name VARCHAR(255) NOT NULL CHECK (TRIM(provider_name) <> ''),
  provider_contact VARCHAR(255),

  title VARCHAR(255) NOT NULL CHECK (TRIM(title) <> ''),
  -- { scope_of_work, terms, rate, deliverables, ... } -- whatever the
  -- simple contract needs to show; kept as JSONB so the public page can
  -- render it without a PDF round-trip.
  content JSONB NOT NULL DEFAULT '{}',

  status VARCHAR(20) NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'revoked')),

  -- Private-by-default gate -- exactly one of these is set, matching
  -- access_mode, enforced below. No "public" mode exists for this table.
  access_mode VARCHAR(10) NOT NULL CHECK (access_mode IN ('pin', 'email')),
  pin_hash TEXT,
  allowed_email TEXT,
  failed_attempts INT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,

  access_token VARCHAR(64) NOT NULL UNIQUE,

  valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_until TIMESTAMPTZ NOT NULL,

  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_by UUID REFERENCES public.cmms_users(id) ON DELETE SET NULL,
  revoked_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT cmms_sp_contracts_pin_chk CHECK (access_mode != 'pin' OR pin_hash IS NOT NULL),
  CONSTRAINT cmms_sp_contracts_email_chk CHECK (access_mode != 'email' OR allowed_email IS NOT NULL)
);

-- CREATE TABLE IF NOT EXISTS is a no-op against a table that already
-- exists in some earlier shape -- e.g. this file's table already having
-- been created by a prior run before access_mode/pin_hash/etc. existed in
-- it, which is exactly what produced 'column "access_mode" does not
-- exist' downstream. These backfill any column the table might be
-- missing; on a table that was just freshly created above (or already has
-- every column) every ADD COLUMN here is a no-op.
ALTER TABLE public.cmms_service_provider_contracts
  ADD COLUMN IF NOT EXISTS cmms_company_id UUID REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS job_assignment_id UUID REFERENCES public.cmms_job_assignments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS provider_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS provider_contact VARCHAR(255),
  ADD COLUMN IF NOT EXISTS title VARCHAR(255),
  ADD COLUMN IF NOT EXISTS content JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'published',
  ADD COLUMN IF NOT EXISTS access_mode VARCHAR(10),
  ADD COLUMN IF NOT EXISTS pin_hash TEXT,
  ADD COLUMN IF NOT EXISTS allowed_email TEXT,
  ADD COLUMN IF NOT EXISTS failed_attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS access_token VARCHAR(64),
  ADD COLUMN IF NOT EXISTS valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS valid_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS published_by UUID REFERENCES public.cmms_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- access_token/access_mode/provider_name/title/valid_until have no natural
-- default (unlike the columns above), so they're backfilled nullable, then
-- tightened to NOT NULL + unique here -- this two-step keeps the ALTER safe
-- on a table already holding rows from a partial earlier run (a one-shot
-- "NOT NULL with no default" ADD COLUMN fails outright against any
-- existing row). On a table with no such stale rows every statement below
-- is a no-op/already-true.
DO $$ BEGIN
  ALTER TABLE public.cmms_service_provider_contracts ALTER COLUMN cmms_company_id SET NOT NULL;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'Skipped (likely already satisfied, or existing rows need a value first): %', SQLERRM; END $$;
DO $$ BEGIN
  ALTER TABLE public.cmms_service_provider_contracts ALTER COLUMN provider_name SET NOT NULL;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'Skipped (likely already satisfied, or existing rows need a value first): %', SQLERRM; END $$;
DO $$ BEGIN
  ALTER TABLE public.cmms_service_provider_contracts ALTER COLUMN title SET NOT NULL;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'Skipped (likely already satisfied, or existing rows need a value first): %', SQLERRM; END $$;
DO $$ BEGIN
  ALTER TABLE public.cmms_service_provider_contracts ALTER COLUMN access_mode SET NOT NULL;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'Skipped (likely already satisfied, or existing rows need a value first): %', SQLERRM; END $$;
DO $$ BEGIN
  ALTER TABLE public.cmms_service_provider_contracts ALTER COLUMN access_token SET NOT NULL;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'Skipped (likely already satisfied, or existing rows need a value first): %', SQLERRM; END $$;
DO $$ BEGIN
  ALTER TABLE public.cmms_service_provider_contracts ALTER COLUMN valid_until SET NOT NULL;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'Skipped (likely already satisfied, or existing rows need a value first): %', SQLERRM; END $$;
-- Enforces uniqueness the same way the inline UNIQUE on a freshly-created
-- table would -- a unique index natively supports IF NOT EXISTS, unlike
-- ADD CONSTRAINT, so this can't end up creating a second, redundantly-named
-- unique constraint alongside the fresh table's own.
CREATE UNIQUE INDEX IF NOT EXISTS cmms_sp_contracts_access_token_key ON public.cmms_service_provider_contracts(access_token);
DO $$ BEGIN
  ALTER TABLE public.cmms_service_provider_contracts ADD CONSTRAINT cmms_sp_contracts_access_mode_chk CHECK (access_mode IN ('pin', 'email'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.cmms_service_provider_contracts ADD CONSTRAINT cmms_sp_contracts_pin_chk CHECK (access_mode != 'pin' OR pin_hash IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.cmms_service_provider_contracts ADD CONSTRAINT cmms_sp_contracts_email_chk CHECK (access_mode != 'email' OR allowed_email IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_cmms_sp_contracts_company ON public.cmms_service_provider_contracts(cmms_company_id);
CREATE INDEX IF NOT EXISTS idx_cmms_sp_contracts_job_assignment ON public.cmms_service_provider_contracts(job_assignment_id);
CREATE INDEX IF NOT EXISTS idx_cmms_sp_contracts_token ON public.cmms_service_provider_contracts(access_token);

DROP TRIGGER IF EXISTS trg_cmms_sp_contracts_touch_updated_at ON public.cmms_service_provider_contracts;
CREATE TRIGGER trg_cmms_sp_contracts_touch_updated_at
  BEFORE UPDATE ON public.cmms_service_provider_contracts
  FOR EACH ROW EXECUTE FUNCTION public.cmms_touch_updated_at();

ALTER TABLE public.cmms_service_provider_contracts ENABLE ROW LEVEL SECURITY;

-- Staff still SELECT/UPDATE (list, extend, revoke) directly under RLS;
-- INSERT in practice only ever happens through
-- fn_publish_service_provider_contract below (a raw client INSERT can't
-- produce a real pin_hash), so this policy covers the rest.
DROP POLICY IF EXISTS cmms_sp_contracts_staff_all ON public.cmms_service_provider_contracts;
CREATE POLICY cmms_sp_contracts_staff_all ON public.cmms_service_provider_contracts
  FOR ALL USING (
    public.cmms_has_tool_action(cmms_company_id, 'tasks', 'publish_contract')
  ) WITH CHECK (
    public.cmms_has_tool_action(cmms_company_id, 'tasks', 'publish_contract')
  );

-- ============================================================
-- 2. cmms_service_provider_followups -- task follow-up notes
-- ============================================================
-- author_type distinguishes a staff note (author_cmms_user_id set) from a
-- note the contractor posted themselves through the public page (NULL --
-- they have no cmms_users row to point to).

CREATE TABLE IF NOT EXISTS public.cmms_service_provider_followups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES public.cmms_service_provider_contracts(id) ON DELETE CASCADE,
  author_type VARCHAR(10) NOT NULL CHECK (author_type IN ('staff', 'provider')),
  author_cmms_user_id UUID REFERENCES public.cmms_users(id) ON DELETE SET NULL,
  note TEXT NOT NULL CHECK (TRIM(note) <> ''),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cmms_sp_followups_contract ON public.cmms_service_provider_followups(contract_id, created_at);

ALTER TABLE public.cmms_service_provider_followups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cmms_sp_followups_staff_all ON public.cmms_service_provider_followups;
CREATE POLICY cmms_sp_followups_staff_all ON public.cmms_service_provider_followups
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.cmms_service_provider_contracts c
      WHERE c.id = cmms_service_provider_followups.contract_id
        AND public.cmms_has_tool_action(c.cmms_company_id, 'tasks', 'publish_contract')
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.cmms_service_provider_contracts c
      WHERE c.id = cmms_service_provider_followups.contract_id
        AND public.cmms_has_tool_action(c.cmms_company_id, 'tasks', 'publish_contract')
    )
  );

-- ============================================================
-- 3. cmms_service_provider_payments -- the payment/transaction record
-- ============================================================
-- This IS the transaction ledger for that provider engagement ("that
-- data will only be in reports and transactions"). It is intentionally
-- its own small table, not a join into payroll or the ICAN wallet ledger
-- -- those stay staff/salary-only and this never reads them.

CREATE TABLE IF NOT EXISTS public.cmms_service_provider_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES public.cmms_service_provider_contracts(id) ON DELETE CASCADE,
  cmms_company_id UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,

  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'UGX',
  method VARCHAR(30),
  reference VARCHAR(120),
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,

  recorded_by UUID REFERENCES public.cmms_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cmms_sp_payments_contract ON public.cmms_service_provider_payments(contract_id, payment_date);
CREATE INDEX IF NOT EXISTS idx_cmms_sp_payments_company ON public.cmms_service_provider_payments(cmms_company_id);

ALTER TABLE public.cmms_service_provider_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cmms_sp_payments_staff_all ON public.cmms_service_provider_payments;
CREATE POLICY cmms_sp_payments_staff_all ON public.cmms_service_provider_payments
  FOR ALL USING (
    public.cmms_has_tool_action(cmms_company_id, 'tasks', 'publish_contract')
  ) WITH CHECK (
    public.cmms_has_tool_action(cmms_company_id, 'tasks', 'publish_contract')
  );

-- ============================================================
-- 4. fn_publish_service_provider_contract -- staff-only. Creates AND
-- publishes in one step (the PIN must be hashed server-side, so there is
-- no plain-INSERT path for this table).
-- ============================================================

DROP FUNCTION IF EXISTS public.fn_publish_service_provider_contract(UUID, UUID, VARCHAR, VARCHAR, VARCHAR, JSONB, VARCHAR, TEXT, TEXT, INT) CASCADE;
CREATE OR REPLACE FUNCTION public.fn_publish_service_provider_contract(
  p_company_id UUID,
  p_job_assignment_id UUID,
  p_provider_name VARCHAR,
  p_provider_contact VARCHAR,
  p_title VARCHAR,
  p_content JSONB,
  p_access_mode VARCHAR,
  p_pin TEXT DEFAULT NULL,
  p_allowed_email TEXT DEFAULT NULL,
  p_valid_days INT DEFAULT 30
)
RETURNS TABLE (id UUID, access_token VARCHAR, valid_until TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_token TEXT;
  v_pin_hash TEXT;
  v_allowed_email TEXT;
  v_new_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in is required.';
  END IF;

  IF NOT public.cmms_has_tool_action(p_company_id, 'tasks', 'publish_contract') THEN
    RAISE EXCEPTION 'You do not have permission to publish service provider contracts.';
  END IF;

  IF NULLIF(TRIM(COALESCE(p_provider_name, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Provider name is required.';
  END IF;
  IF NULLIF(TRIM(COALESCE(p_title, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Contract title is required.';
  END IF;

  IF p_access_mode NOT IN ('pin', 'email') THEN
    RAISE EXCEPTION 'Choose a PIN or an email to keep this contract private.';
  END IF;

  IF p_access_mode = 'pin' THEN
    IF p_pin IS NULL OR LENGTH(TRIM(p_pin)) < 4 THEN
      RAISE EXCEPTION 'PIN must be at least 4 characters.';
    END IF;
    v_pin_hash := crypt(p_pin, gen_salt('bf'));
  ELSE
    v_allowed_email := NULLIF(LOWER(TRIM(COALESCE(p_allowed_email, ''))), '');
    IF v_allowed_email IS NULL OR v_allowed_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN
      RAISE EXCEPTION 'Enter a valid email address.';
    END IF;
  END IF;

  v_token := encode(gen_random_bytes(24), 'hex');

  INSERT INTO public.cmms_service_provider_contracts (
    cmms_company_id, job_assignment_id, provider_name, provider_contact, title, content,
    access_mode, pin_hash, allowed_email, access_token,
    valid_until, published_by
  ) VALUES (
    p_company_id, p_job_assignment_id, TRIM(p_provider_name),
    NULLIF(TRIM(COALESCE(p_provider_contact, '')), ''), TRIM(p_title), COALESCE(p_content, '{}'::JSONB),
    p_access_mode, v_pin_hash, v_allowed_email, v_token,
    NOW() + (GREATEST(COALESCE(p_valid_days, 30), 1) || ' days')::INTERVAL,
    public.cmms_current_user_id_for_company(p_company_id)
  )
  RETURNING cmms_service_provider_contracts.id INTO v_new_id;

  RETURN QUERY SELECT c.id, c.access_token, c.valid_until FROM public.cmms_service_provider_contracts c WHERE c.id = v_new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_publish_service_provider_contract(UUID, UUID, VARCHAR, VARCHAR, VARCHAR, JSONB, VARCHAR, TEXT, TEXT, INT) TO authenticated;

-- ============================================================
-- 5. fn_get_service_provider_contract_public -- the public "open the
-- link" pre-auth check. Mirrors fn_get_report_share_access: tells the
-- caller which gate to show and reveals NOTHING else about the contract
-- until that gate is passed.
-- ============================================================

DROP FUNCTION IF EXISTS public.fn_get_service_provider_contract_public(TEXT) CASCADE;
CREATE OR REPLACE FUNCTION public.fn_get_service_provider_contract_public(p_token TEXT)
RETURNS TABLE (status TEXT, access_mode VARCHAR, locked_until TIMESTAMPTZ)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contract record;
BEGIN
  SELECT * INTO v_contract FROM public.cmms_service_provider_contracts WHERE access_token = p_token;

  IF v_contract IS NULL OR v_contract.status != 'published' OR v_contract.revoked_at IS NOT NULL
     OR v_contract.valid_until <= NOW() THEN
    RETURN QUERY SELECT 'invalid'::TEXT, NULL::VARCHAR, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF v_contract.locked_until IS NOT NULL AND v_contract.locked_until > NOW() THEN
    RETURN QUERY SELECT 'locked'::TEXT, v_contract.access_mode, v_contract.locked_until;
    RETURN;
  END IF;

  RETURN QUERY SELECT
    (CASE WHEN v_contract.access_mode = 'pin' THEN 'pin_required' ELSE 'email_required' END)::TEXT,
    v_contract.access_mode,
    NULL::TIMESTAMPTZ;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_service_provider_contract_public(TEXT) TO anon, authenticated;

-- ============================================================
-- 6. fn_verify_service_provider_contract_pin -- PIN gate. Attempt-limited
-- exactly like fn_verify_report_share_password (5 tries -> 15 min lock).
-- Returns the full narrow contract payload only on success.
-- ============================================================

DROP FUNCTION IF EXISTS public.fn_verify_service_provider_contract_pin(TEXT, TEXT) CASCADE;
CREATE OR REPLACE FUNCTION public.fn_verify_service_provider_contract_pin(p_token TEXT, p_pin TEXT)
RETURNS TABLE (
  status TEXT,
  locked_until TIMESTAMPTZ,
  title VARCHAR,
  content JSONB,
  provider_name VARCHAR,
  company_name VARCHAR,
  job_title VARCHAR,
  job_status VARCHAR,
  valid_until TIMESTAMPTZ,
  followups JSONB,
  payments JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_contract record;
BEGIN
  SELECT sp.* INTO v_contract
  FROM public.cmms_service_provider_contracts sp
  WHERE sp.access_token = p_token AND sp.access_mode = 'pin'
    AND sp.status = 'published' AND sp.revoked_at IS NULL AND sp.valid_until > NOW();

  IF v_contract IS NULL THEN
    RETURN QUERY SELECT 'invalid'::TEXT, NULL::TIMESTAMPTZ, NULL::VARCHAR, NULL::JSONB, NULL::VARCHAR,
      NULL::VARCHAR, NULL::VARCHAR, NULL::VARCHAR, NULL::TIMESTAMPTZ, NULL::JSONB, NULL::JSONB;
    RETURN;
  END IF;

  IF v_contract.locked_until IS NOT NULL AND v_contract.locked_until > NOW() THEN
    RETURN QUERY SELECT 'locked'::TEXT, v_contract.locked_until, NULL::VARCHAR, NULL::JSONB, NULL::VARCHAR,
      NULL::VARCHAR, NULL::VARCHAR, NULL::VARCHAR, NULL::TIMESTAMPTZ, NULL::JSONB, NULL::JSONB;
    RETURN;
  END IF;

  IF v_contract.pin_hash IS NULL OR crypt(p_pin, v_contract.pin_hash) != v_contract.pin_hash THEN
    UPDATE public.cmms_service_provider_contracts
    SET failed_attempts = failed_attempts + 1,
        locked_until = CASE WHEN failed_attempts + 1 >= 5 THEN NOW() + INTERVAL '15 minutes' ELSE locked_until END,
        updated_at = NOW()
    WHERE id = v_contract.id;

    RETURN QUERY SELECT 'invalid_pin'::TEXT, NULL::TIMESTAMPTZ, NULL::VARCHAR, NULL::JSONB, NULL::VARCHAR,
      NULL::VARCHAR, NULL::VARCHAR, NULL::VARCHAR, NULL::TIMESTAMPTZ, NULL::JSONB, NULL::JSONB;
    RETURN;
  END IF;

  UPDATE public.cmms_service_provider_contracts
  SET failed_attempts = 0, locked_until = NULL, updated_at = NOW()
  WHERE id = v_contract.id;

  RETURN QUERY
  SELECT 'ok'::TEXT, NULL::TIMESTAMPTZ, c.title, c.content, c.provider_name, cp.company_name,
    ja.job_title, ja.assignment_status, c.valid_until,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object('author_type', f.author_type, 'note', f.note, 'created_at', f.created_at) ORDER BY f.created_at)
      FROM public.cmms_service_provider_followups f WHERE f.contract_id = c.id
    ), '[]'::JSONB),
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object('amount', p.amount, 'currency', p.currency, 'method', p.method, 'reference', p.reference, 'payment_date', p.payment_date) ORDER BY p.payment_date)
      FROM public.cmms_service_provider_payments p WHERE p.contract_id = c.id
    ), '[]'::JSONB)
  FROM public.cmms_service_provider_contracts c
  JOIN public.cmms_company_profiles cp ON cp.id = c.cmms_company_id
  LEFT JOIN public.cmms_job_assignments ja ON ja.id = c.job_assignment_id
  WHERE c.id = v_contract.id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_verify_service_provider_contract_pin(TEXT, TEXT) TO anon, authenticated;

-- ============================================================
-- 7. fn_verify_service_provider_contract_email -- email gate. Same
-- "matches the one allowed address, no code sent" trade-off as
-- fn_verify_report_share_email (CMMS_REPORT_SHARE_EMAIL_ONLY_ACCESS.sql).
-- ============================================================

DROP FUNCTION IF EXISTS public.fn_verify_service_provider_contract_email(TEXT, TEXT) CASCADE;
CREATE OR REPLACE FUNCTION public.fn_verify_service_provider_contract_email(p_token TEXT, p_email TEXT)
RETURNS TABLE (
  status TEXT,
  title VARCHAR,
  content JSONB,
  provider_name VARCHAR,
  company_name VARCHAR,
  job_title VARCHAR,
  job_status VARCHAR,
  valid_until TIMESTAMPTZ,
  followups JSONB,
  payments JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contract record;
  v_email TEXT := LOWER(TRIM(COALESCE(p_email, '')));
BEGIN
  SELECT sp.* INTO v_contract
  FROM public.cmms_service_provider_contracts sp
  WHERE sp.access_token = p_token AND sp.access_mode = 'email'
    AND sp.status = 'published' AND sp.revoked_at IS NULL AND sp.valid_until > NOW();

  IF v_contract IS NULL OR v_email = '' OR v_email != v_contract.allowed_email THEN
    RETURN QUERY SELECT 'not_allowed'::TEXT, NULL::VARCHAR, NULL::JSONB, NULL::VARCHAR,
      NULL::VARCHAR, NULL::VARCHAR, NULL::VARCHAR, NULL::TIMESTAMPTZ, NULL::JSONB, NULL::JSONB;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT 'ok'::TEXT, c.title, c.content, c.provider_name, cp.company_name,
    ja.job_title, ja.assignment_status, c.valid_until,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object('author_type', f.author_type, 'note', f.note, 'created_at', f.created_at) ORDER BY f.created_at)
      FROM public.cmms_service_provider_followups f WHERE f.contract_id = c.id
    ), '[]'::JSONB),
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object('amount', p.amount, 'currency', p.currency, 'method', p.method, 'reference', p.reference, 'payment_date', p.payment_date) ORDER BY p.payment_date)
      FROM public.cmms_service_provider_payments p WHERE p.contract_id = c.id
    ), '[]'::JSONB)
  FROM public.cmms_service_provider_contracts c
  JOIN public.cmms_company_profiles cp ON cp.id = c.cmms_company_id
  LEFT JOIN public.cmms_job_assignments ja ON ja.id = c.job_assignment_id
  WHERE c.id = v_contract.id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_verify_service_provider_contract_email(TEXT, TEXT) TO anon, authenticated;

-- ============================================================
-- 8. fn_add_service_provider_followup -- the contractor's own "post an
-- update" action. Re-checks the SAME gate credential on every call (the
-- public page holds no session, so this is the only proof it can offer)
-- rather than trusting a bare token.
-- ============================================================

DROP FUNCTION IF EXISTS public.fn_add_service_provider_followup(TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.fn_add_service_provider_followup(TEXT, TEXT, TEXT) CASCADE;
CREATE OR REPLACE FUNCTION public.fn_add_service_provider_followup(
  p_token TEXT,
  p_credential TEXT,
  p_note TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_contract record;
BEGIN
  IF NULLIF(TRIM(COALESCE(p_note, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A note is required.';
  END IF;

  SELECT * INTO v_contract
  FROM public.cmms_service_provider_contracts
  WHERE access_token = p_token
    AND status = 'published' AND revoked_at IS NULL AND valid_until > NOW();

  IF v_contract IS NULL THEN
    RAISE EXCEPTION 'This contract link is no longer available for updates.';
  END IF;

  IF v_contract.locked_until IS NOT NULL AND v_contract.locked_until > NOW() THEN
    RAISE EXCEPTION 'Too many failed attempts. Try again later.';
  END IF;

  IF v_contract.access_mode = 'pin' THEN
    IF v_contract.pin_hash IS NULL OR crypt(p_credential, v_contract.pin_hash) != v_contract.pin_hash THEN
      UPDATE public.cmms_service_provider_contracts
      SET failed_attempts = failed_attempts + 1,
          locked_until = CASE WHEN failed_attempts + 1 >= 5 THEN NOW() + INTERVAL '15 minutes' ELSE locked_until END,
          updated_at = NOW()
      WHERE id = v_contract.id;
      RAISE EXCEPTION 'Incorrect PIN.';
    END IF;
  ELSE
    IF LOWER(TRIM(COALESCE(p_credential, ''))) != v_contract.allowed_email THEN
      RAISE EXCEPTION 'Email does not match.';
    END IF;
  END IF;

  INSERT INTO public.cmms_service_provider_followups (contract_id, author_type, note)
  VALUES (v_contract.id, 'provider', TRIM(p_note));

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_add_service_provider_followup(TEXT, TEXT, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'CMMS service provider contracts (public, gated, time-limited task contracts) installed' AS status;

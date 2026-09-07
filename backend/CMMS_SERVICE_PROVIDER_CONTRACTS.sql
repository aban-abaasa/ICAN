-- ============================================================
-- CMMS Service Provider Contracts -- public, time-limited contract pages
-- for OUTSIDE contractors (no CMMS/ICAN login) doing a task for the
-- company, with self-service follow-ups and a payment/transaction record.
-- ============================================================
-- Flow: staff (admin, or any role granted the permission below) assigns a
-- task in the existing Tasks/Assign tab (cmms_job_assignments,
-- CMMS_TASK_PROGRESS_TRACKING_AND_NOTIFICATIONS.sql) and, from that same
-- page, "publishes" a simple contract for whoever is doing the work
-- externally. The contractor never gets a cmms_users account -- they only
-- ever reach this through one opaque link:
--   /service-provider-contract?token=<access_token>
-- resolved by the public fn_get_service_provider_contract_public RPC
-- below. This is the SAME opaque-token + narrow SECURITY DEFINER RPC
-- pattern already used by CMMS_EMPLOYMENT_DOCUMENTS.sql (verify_token) and
-- CMMS_REPORT_SHARING_SYSTEM.sql (cmms_report_shares.token), and rows are
-- created/edited by staff via direct table INSERT/UPDATE under RLS exactly
-- like cmms_employment_documents -- no RPC needed for the staff side.
--
-- Time-limited access ("a certain period ... can be extended or
-- defaulted"): mirrors cmms_report_shares.expires_at. A contract published
-- without an explicit valid_until gets a 30-day window automatically
-- (cmms_stamp_service_provider_contract_published trigger below); staff
-- extend it later with a plain UPDATE ... SET valid_until = ... (covered
-- by the same RLS policy, no separate "extend" RPC needed).
--
-- Data isolation (the actual point of this file): the public RPC and the
-- provider's own follow-up RPC touch ONLY these three tables -- the
-- contract, its follow-ups, and its payments. They never join
-- cmms_users beyond the contract's own provider_name/contact fields, and
-- never touch payroll (CMMS_PAYROLL_*.sql) or inventory
-- (CMMS_INVENTORY_COMPLETE_SCHEMA.sql) tables at all. Staff records,
-- salary figures, and inventory values stay reachable only from inside
-- the authenticated CMMS workspace -- a service provider link can never
-- see them by construction, not just by policy.
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
-- cmms_touch_updated_at), CMMS_TASK_PROGRESS_TRACKING_AND_NOTIFICATIONS.sql
-- (cmms_job_assignments).
-- Safe to run more than once.
-- ============================================================

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

  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'completed', 'revoked')),

  access_token VARCHAR(64) NOT NULL UNIQUE,

  valid_from TIMESTAMPTZ,
  valid_until TIMESTAMPTZ,

  published_at TIMESTAMPTZ,
  published_by UUID REFERENCES public.cmms_users(id) ON DELETE SET NULL,
  revoked_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cmms_sp_contracts_company ON public.cmms_service_provider_contracts(cmms_company_id);
CREATE INDEX IF NOT EXISTS idx_cmms_sp_contracts_job_assignment ON public.cmms_service_provider_contracts(job_assignment_id);
CREATE INDEX IF NOT EXISTS idx_cmms_sp_contracts_token ON public.cmms_service_provider_contracts(access_token);

DROP TRIGGER IF EXISTS trg_cmms_sp_contracts_touch_updated_at ON public.cmms_service_provider_contracts;
CREATE TRIGGER trg_cmms_sp_contracts_touch_updated_at
  BEFORE UPDATE ON public.cmms_service_provider_contracts
  FOR EACH ROW EXECUTE FUNCTION public.cmms_touch_updated_at();

-- Default the "certain period" to 30 days whenever a contract goes live
-- without staff picking an explicit window, and stamp published_at once.
DROP FUNCTION IF EXISTS public.cmms_stamp_service_provider_contract_published() CASCADE;
CREATE OR REPLACE FUNCTION public.cmms_stamp_service_provider_contract_published()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'published' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'published') THEN
    IF NEW.published_at IS NULL THEN NEW.published_at = NOW(); END IF;
    IF NEW.valid_from IS NULL THEN NEW.valid_from = NOW(); END IF;
    IF NEW.valid_until IS NULL THEN NEW.valid_until = NEW.valid_from + INTERVAL '30 days'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cmms_sp_contracts_stamp_published ON public.cmms_service_provider_contracts;
CREATE TRIGGER trg_cmms_sp_contracts_stamp_published
  BEFORE INSERT OR UPDATE ON public.cmms_service_provider_contracts
  FOR EACH ROW EXECUTE FUNCTION public.cmms_stamp_service_provider_contract_published();

ALTER TABLE public.cmms_service_provider_contracts ENABLE ROW LEVEL SECURITY;

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
-- 4. fn_get_service_provider_contract_public -- the public "open the link"
-- endpoint. Deliberately narrow, mirroring fn_verify_employment_document's
-- exposure principle: contract + its own follow-ups/payments, nothing else.
-- ============================================================

DROP FUNCTION IF EXISTS public.fn_get_service_provider_contract_public(TEXT);
CREATE OR REPLACE FUNCTION public.fn_get_service_provider_contract_public(p_token TEXT)
RETURNS TABLE (
  is_valid BOOLEAN,
  status VARCHAR,
  title VARCHAR,
  content JSONB,
  provider_name VARCHAR,
  company_name VARCHAR,
  job_title VARCHAR,
  job_status VARCHAR,
  valid_from TIMESTAMPTZ,
  valid_until TIMESTAMPTZ,
  followups JSONB,
  payments JSONB
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.status IN ('published', 'completed')
      AND c.revoked_at IS NULL
      AND (c.valid_until IS NULL OR c.valid_until > NOW()),
    c.status,
    c.title,
    c.content,
    c.provider_name,
    cp.company_name,
    ja.job_title,
    ja.assignment_status,
    c.valid_from,
    c.valid_until,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object('author_type', f.author_type, 'note', f.note, 'created_at', f.created_at) ORDER BY f.created_at)
      FROM public.cmms_service_provider_followups f
      WHERE f.contract_id = c.id
    ), '[]'::JSONB),
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object('amount', p.amount, 'currency', p.currency, 'method', p.method, 'reference', p.reference, 'payment_date', p.payment_date) ORDER BY p.payment_date)
      FROM public.cmms_service_provider_payments p
      WHERE p.contract_id = c.id
    ), '[]'::JSONB)
  FROM public.cmms_service_provider_contracts c
  JOIN public.cmms_company_profiles cp ON cp.id = c.cmms_company_id
  LEFT JOIN public.cmms_job_assignments ja ON ja.id = c.job_assignment_id
  WHERE c.access_token = p_token;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_service_provider_contract_public(TEXT) TO anon, authenticated;

-- ============================================================
-- 5. fn_add_service_provider_followup -- the contractor's own "post an
-- update" action from the public page. Only ever writes a 'provider' note;
-- rejects anything not currently within its valid window.
-- ============================================================

DROP FUNCTION IF EXISTS public.fn_add_service_provider_followup(TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.fn_add_service_provider_followup(
  p_token TEXT,
  p_note TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contract_id UUID;
BEGIN
  IF NULLIF(TRIM(COALESCE(p_note, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A note is required.';
  END IF;

  SELECT c.id INTO v_contract_id
  FROM public.cmms_service_provider_contracts c
  WHERE c.access_token = p_token
    AND c.status IN ('published', 'completed')
    AND c.revoked_at IS NULL
    AND (c.valid_until IS NULL OR c.valid_until > NOW());

  IF v_contract_id IS NULL THEN
    RAISE EXCEPTION 'This contract link is no longer available for updates.';
  END IF;

  INSERT INTO public.cmms_service_provider_followups (contract_id, author_type, note)
  VALUES (v_contract_id, 'provider', TRIM(p_note));

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_add_service_provider_followup(TEXT, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'CMMS service provider contracts (public, time-limited task contracts) installed' AS status;

-- ============================================================
-- CMMS Employment Documents -- appointment letters & contracts, QR-sealed
-- ============================================================
-- Once a candidate is hired, admin issues an appointment letter or
-- employment contract as a PDF (generated client-side, see
-- CMMSEmploymentDocumentsPanel.jsx). Every issued document carries a QR
-- code "seal" (like a company stamp) that encodes a URL to a public
-- verification page (/verify-document?token=<verify_token>) -- anyone
-- holding the paper (or a scan of it) can confirm it is genuine without
-- ever seeing its private terms.
--
-- This follows the SAME opaque-token + SECURITY DEFINER RPC pattern already
-- used by CMMS staff attendance QR check-in (resolve_cmms_attendance_qr)
-- and report sharing (CMMS_REPORT_SHARING_SYSTEM.sql's fn_get_report_share_access)
-- -- NOT the investment-agreement seal pattern (ShareSigningFlow.jsx), which
-- encodes the whole signed payload as raw JSON in the QR with no real
-- server-side verification endpoint behind it.
--
-- Signing: the employee "signs" with their existing IcanEra wallet PIN, the
-- same e-signature convention as investment agreements (CREATE_INVESTMENT_SIGNATURES.sql)
-- -- masked PIN + timestamp stored, never the PIN itself.
--
-- Run after: CMMS_ANNOUNCEMENTS_AND_JOBS.sql, CMMS_ADD_USER_SCHEMA.sql (cmms_users).
-- Safe to run more than once.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cmms_employment_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cmms_company_id UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,
  job_application_id UUID REFERENCES public.cmms_job_applications(id) ON DELETE SET NULL,
  cmms_user_id UUID REFERENCES public.cmms_users(id) ON DELETE SET NULL,

  document_type VARCHAR(30) NOT NULL CHECK (document_type IN ('appointment_letter', 'employment_contract')),
  title VARCHAR(255) NOT NULL,
  -- Structured fields the PDF/preview render from: { position, department,
  -- employment_type, salary, start_date, terms }. Kept alongside (not
  -- instead of) the rendered PDF so a document can be re-previewed/re-issued
  -- without re-parsing a PDF.
  content JSONB NOT NULL DEFAULT '{}',

  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'signed', 'revoked')),

  document_url TEXT,
  document_path TEXT,
  verify_token VARCHAR(64) NOT NULL UNIQUE,

  issued_at TIMESTAMPTZ,
  issued_by UUID REFERENCES public.cmms_users(id) ON DELETE SET NULL,
  signed_at TIMESTAMPTZ,
  signature_method VARCHAR(30),
  pin_masked VARCHAR(20),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cmms_employment_documents_company ON public.cmms_employment_documents(cmms_company_id);
CREATE INDEX IF NOT EXISTS idx_cmms_employment_documents_user ON public.cmms_employment_documents(cmms_user_id);
CREATE INDEX IF NOT EXISTS idx_cmms_employment_documents_verify_token ON public.cmms_employment_documents(verify_token);

DROP TRIGGER IF EXISTS trg_cmms_employment_documents_touch_updated_at ON public.cmms_employment_documents;
CREATE TRIGGER trg_cmms_employment_documents_touch_updated_at
  BEFORE UPDATE ON public.cmms_employment_documents
  FOR EACH ROW EXECUTE FUNCTION public.cmms_touch_updated_at();

ALTER TABLE public.cmms_employment_documents ENABLE ROW LEVEL SECURITY;

-- Staff who can manage applications may create/view/update documents for
-- their own company (same permission as the rest of the hiring pipeline).
DROP POLICY IF EXISTS cmms_employment_documents_staff_all ON public.cmms_employment_documents;
CREATE POLICY cmms_employment_documents_staff_all ON public.cmms_employment_documents
  FOR ALL USING (
    public.cmms_has_tool_action(cmms_company_id, 'announcements', 'manage_applications')
  ) WITH CHECK (
    public.cmms_has_tool_action(cmms_company_id, 'announcements', 'manage_applications')
  );

-- The employee themself may see (not edit) their own issued documents,
-- e.g. to review and sign one.
DROP POLICY IF EXISTS cmms_employment_documents_employee_select ON public.cmms_employment_documents;
CREATE POLICY cmms_employment_documents_employee_select ON public.cmms_employment_documents
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.cmms_users u
      WHERE u.id = cmms_employment_documents.cmms_user_id AND u.ican_user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.cmms_job_applications ja
      WHERE ja.id = cmms_employment_documents.job_application_id AND ja.ican_user_id = auth.uid()
    )
  );

-- fn_sign_employment_document -- the employee's own e-signature action.
-- Wallet-PIN verification itself happens on the caller's side exactly like
-- ShareholderSignatureModal.jsx (this RPC trusts that the caller already
-- confirmed the PIN against the wallet service before calling here, and
-- only ever receives/stores the masked form -- never the real PIN).
DROP FUNCTION IF EXISTS public.fn_sign_employment_document(UUID, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.fn_sign_employment_document(
  p_document_id UUID,
  p_signature_method TEXT,
  p_pin_masked TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owns BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in is required.';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.cmms_employment_documents d
    LEFT JOIN public.cmms_users u ON u.id = d.cmms_user_id
    LEFT JOIN public.cmms_job_applications ja ON ja.id = d.job_application_id
    WHERE d.id = p_document_id
      AND d.status = 'issued'
      AND (u.ican_user_id = auth.uid() OR ja.ican_user_id = auth.uid())
  ) INTO v_owns;

  IF NOT v_owns THEN
    RAISE EXCEPTION 'This document is not awaiting your signature.';
  END IF;

  UPDATE public.cmms_employment_documents
  SET status = 'signed', signed_at = NOW(), signature_method = p_signature_method, pin_masked = p_pin_masked
  WHERE id = p_document_id;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_sign_employment_document(UUID, TEXT, TEXT) TO authenticated;

-- fn_verify_employment_document -- the public "scan the seal" endpoint.
-- Deliberately returns only a narrow confirmation shape, mirroring
-- fn_get_public_cmms_notice's exposure principle -- never content/terms.
DROP FUNCTION IF EXISTS public.fn_verify_employment_document(TEXT);
CREATE OR REPLACE FUNCTION public.fn_verify_employment_document(p_token TEXT)
RETURNS TABLE (
  is_valid BOOLEAN,
  document_type VARCHAR,
  status VARCHAR,
  title VARCHAR,
  employee_name VARCHAR,
  company_name VARCHAR,
  "position" TEXT,
  issued_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    d.status IN ('issued', 'signed'),
    d.document_type,
    d.status,
    d.title,
    COALESCE(
      (SELECT full_name FROM public.cmms_users WHERE id = d.cmms_user_id),
      (SELECT applicant_name FROM public.cmms_job_applications WHERE id = d.job_application_id)
    ),
    cp.company_name,
    d.content ->> 'position',
    d.issued_at
  FROM public.cmms_employment_documents d
  JOIN public.cmms_company_profiles cp ON cp.id = d.cmms_company_id
  WHERE d.verify_token = p_token;
$$;

GRANT EXECUTE ON FUNCTION public.fn_verify_employment_document(TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'CMMS employment documents (QR-sealed appointment letters & contracts) installed' AS status;

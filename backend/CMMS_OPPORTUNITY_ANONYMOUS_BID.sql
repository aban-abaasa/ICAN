-- ============================================================
-- CMMS Business Opportunities -- anonymous bidding, no ICAN account needed
-- ============================================================
-- CMMS_OPPORTUNITY_PUBLIC_PAGE.sql made browsing an opportunity public, but
-- placing a bid still required signing in first -- every bidder identity
-- (CMMS_BUSINESS_OPPORTUNITIES_AND_BIDS.sql) was either an ICAN account
-- (individual) or a CMMS company (business). This file adds a third
-- identity, 'anonymous', tracked by a reference code -- the exact same shape
-- cmms_job_applications already uses for anonymous job applicants
-- (CMMS_ANNOUNCEMENTS_AND_JOBS.sql, CMMS_JOB_APPLICATION_ICAN_LINK.sql,
-- CMMS_APPLICANT_ACCOUNT_RECOMMENDATION.sql):
--
--  - fn_submit_public_opportunity_bid -- SECURITY DEFINER, granted to anon.
--    A signed-out visitor gets bidder_type='anonymous' + a reference code;
--    a visitor who happens to already be signed in gets bidder_type=
--    'individual' immediately (bidder_ican_user_id = auth.uid()) -- same
--    "capture auth.uid() if present" branch fn_submit_public_job_application
--    uses. Either way a reference code is generated and returned, so the
--    submit screen and the tracking flow below don't need to branch on it.
--  - fn_track_public_opportunity_bid -- reference code + the email/phone
--    used to bid, no account needed. Mirrors fn_track_public_job_application.
--  - fn_link_ican_account_to_opportunity_bid -- explicit link once the
--    bidder creates/signs into an ICAN account, proven the same way
--    (reference code + contact). Converts the row from 'anonymous' to
--    'individual' in place -- reuses the existing bidder_ican_user_id
--    column rather than adding a second identity column.
--  - fn_get_my_opportunity_bids -- self-healing list for a signed-in
--    visitor with no code at all: auto-links any of their email's
--    still-anonymous bids, then returns everything tied to their account.
--    Mirrors fn_get_my_job_applications.
--
-- The table's INSERT policy for authenticated bidders (cmms_biz_bids_insert)
-- is untouched -- an anonymous bid never goes through RLS at all, only
-- through the SECURITY DEFINER function above (same reasoning as anonymous
-- job applications: anon has no table grant on cmms_business_opportunity_bids
-- at all, so this doesn't reopen the table itself to anon).
--
-- Run after: CMMS_BUSINESS_OPPORTUNITIES_AND_BIDS.sql,
-- CMMS_OPPORTUNITY_BID_PIPELINE.sql, CMMS_OPPORTUNITY_PUBLIC_PAGE.sql.
-- Safe to run more than once.
-- ============================================================

-- ============================================================
-- 1. Schema -- anonymous bidder contact + reference code
-- ============================================================

ALTER TABLE public.cmms_business_opportunity_bids
  ADD COLUMN IF NOT EXISTS bidder_email VARCHAR(255),
  ADD COLUMN IF NOT EXISTS bidder_phone VARCHAR(50),
  ADD COLUMN IF NOT EXISTS reference_code VARCHAR(20);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cmms_biz_bids_reference_code
  ON public.cmms_business_opportunity_bids(reference_code) WHERE reference_code IS NOT NULL;

-- bidder_type gains a third value. Auto-named by Postgres as
-- "<table>_<column>_check" since it was never explicitly named (same
-- reasoning as the status CHECK widened in CMMS_OPPORTUNITY_BID_PIPELINE.sql).
ALTER TABLE public.cmms_business_opportunity_bids
  DROP CONSTRAINT IF EXISTS cmms_business_opportunity_bids_bidder_type_check;
ALTER TABLE public.cmms_business_opportunity_bids
  ADD CONSTRAINT cmms_business_opportunity_bids_bidder_type_check
  CHECK (bidder_type IN ('individual', 'business', 'anonymous'));

-- The identity CHECK gains the anonymous branch: neither an ICAN account nor
-- a CMMS company, same as bidder_type = 'individual' minus the account.
ALTER TABLE public.cmms_business_opportunity_bids
  DROP CONSTRAINT IF EXISTS cmms_biz_bids_identity_chk;
ALTER TABLE public.cmms_business_opportunity_bids
  ADD CONSTRAINT cmms_biz_bids_identity_chk CHECK (
    (bidder_type = 'individual' AND bidder_ican_user_id IS NOT NULL AND bidder_cmms_company_id IS NULL)
    OR (bidder_type = 'business' AND bidder_cmms_company_id IS NOT NULL AND bidder_ican_user_id IS NULL)
    OR (bidder_type = 'anonymous' AND bidder_ican_user_id IS NULL AND bidder_cmms_company_id IS NULL)
  );

-- ============================================================
-- 2. Submit -- no account needed (but uses one immediately if present)
-- ============================================================

DROP FUNCTION IF EXISTS public.fn_submit_public_opportunity_bid(UUID, TEXT, TEXT, TEXT, NUMERIC, TEXT);
CREATE OR REPLACE FUNCTION public.fn_submit_public_opportunity_bid(
  p_opportunity_id UUID,
  p_bidder_name TEXT,
  p_bidder_email TEXT,
  p_bidder_phone TEXT DEFAULT NULL,
  p_amount NUMERIC DEFAULT NULL,
  p_proposal TEXT DEFAULT NULL
)
RETURNS TABLE (reference_code VARCHAR)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_opportunity public.cmms_business_opportunities;
  v_reference_code VARCHAR(20);
  v_ican_user_id UUID := auth.uid(); -- NULL for a genuinely anonymous bidder
BEGIN
  SELECT * INTO v_opportunity
  FROM public.cmms_business_opportunities
  WHERE id = p_opportunity_id
    AND status = 'open'
    AND (deadline IS NULL OR deadline > NOW())
  FOR UPDATE;

  IF v_opportunity.id IS NULL THEN
    RAISE EXCEPTION 'This opportunity is not open for bids.';
  END IF;

  IF v_ican_user_id IS NOT NULL AND v_opportunity.cmms_company_id IN (
    SELECT cmms_company_id FROM public.cmms_users WHERE ican_user_id = v_ican_user_id AND is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'You cannot bid on your own company''s opportunity.';
  END IF;

  IF NULLIF(TRIM(COALESCE(p_bidder_name, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Your name is required.';
  END IF;
  IF NULLIF(TRIM(COALESCE(p_bidder_email, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Your email is required.';
  END IF;
  IF NULLIF(TRIM(COALESCE(p_proposal, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A proposal is required.';
  END IF;

  v_reference_code := 'BID-' || UPPER(SUBSTR(REPLACE(gen_random_uuid()::text, '-', ''), 1, 8));

  INSERT INTO public.cmms_business_opportunity_bids (
    opportunity_id, bidder_type, bidder_ican_user_id,
    bidder_name, bidder_contact, bidder_email, bidder_phone,
    amount, proposal, status, reference_code
  ) VALUES (
    v_opportunity.id,
    CASE WHEN v_ican_user_id IS NOT NULL THEN 'individual' ELSE 'anonymous' END,
    v_ican_user_id,
    TRIM(p_bidder_name),
    COALESCE(NULLIF(TRIM(COALESCE(p_bidder_phone, '')), ''), LOWER(TRIM(p_bidder_email))),
    LOWER(TRIM(p_bidder_email)),
    NULLIF(TRIM(COALESCE(p_bidder_phone, '')), ''),
    p_amount,
    TRIM(p_proposal),
    'submitted',
    v_reference_code
  );

  RETURN QUERY SELECT v_reference_code;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_submit_public_opportunity_bid(UUID, TEXT, TEXT, TEXT, NUMERIC, TEXT) TO anon, authenticated;

-- ============================================================
-- 3. Track -- reference code + the email or phone used to bid
-- ============================================================

DROP FUNCTION IF EXISTS public.fn_track_public_opportunity_bid(TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.fn_track_public_opportunity_bid(p_reference_code TEXT, p_contact TEXT)
RETURNS TABLE (
  reference_code VARCHAR,
  opportunity_title VARCHAR,
  company_name VARCHAR,
  status VARCHAR,
  status_note TEXT,
  submitted_at TIMESTAMPTZ,
  status_updated_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    b.reference_code, o.title, cp.company_name, b.status, b.status_note,
    b.created_at, b.status_updated_at
  FROM public.cmms_business_opportunity_bids b
  JOIN public.cmms_business_opportunities o ON o.id = b.opportunity_id
  JOIN public.cmms_company_profiles cp ON cp.id = o.cmms_company_id
  WHERE b.reference_code = UPPER(TRIM(p_reference_code))
    AND (
      lower(b.bidder_email) = lower(TRIM(p_contact))
      OR b.bidder_phone = TRIM(p_contact)
    );
$$;

GRANT EXECUTE ON FUNCTION public.fn_track_public_opportunity_bid(TEXT, TEXT) TO anon, authenticated;

-- ============================================================
-- 4. Link an ICAN account -- explicit (right after signup) + self-healing
-- (every later "my bids" lookup), same two-piece design as
-- CMMS_APPLICANT_ACCOUNT_RECOMMENDATION.sql.
-- ============================================================

DROP FUNCTION IF EXISTS public.fn_link_ican_account_to_opportunity_bid(TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.fn_link_ican_account_to_opportunity_bid(
  p_reference_code TEXT,
  p_contact TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in is required.';
  END IF;

  UPDATE public.cmms_business_opportunity_bids b
  SET bidder_type = 'individual', bidder_ican_user_id = auth.uid()
  WHERE b.reference_code = UPPER(TRIM(p_reference_code))
    AND b.bidder_type = 'anonymous'
    AND (
      lower(b.bidder_email) = lower(TRIM(p_contact))
      OR b.bidder_phone = TRIM(p_contact)
    )
    -- Never collide with a bid this same account already placed on the same
    -- opportunity -- uq_cmms_biz_bids_individual would reject the UPDATE
    -- outright otherwise; skipping it here just makes that a no-op.
    AND NOT EXISTS (
      SELECT 1 FROM public.cmms_business_opportunity_bids existing
      WHERE existing.opportunity_id = b.opportunity_id
        AND existing.bidder_ican_user_id = auth.uid()
    );

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_link_ican_account_to_opportunity_bid(TEXT, TEXT) TO authenticated;

-- fn_get_my_opportunity_bids -- every bid tied to the caller's account,
-- across every company, self-healing any still-anonymous bid placed with
-- the same verified email first.
DROP FUNCTION IF EXISTS public.fn_get_my_opportunity_bids();
CREATE OR REPLACE FUNCTION public.fn_get_my_opportunity_bids()
RETURNS TABLE (
  id UUID,
  opportunity_id UUID,
  opportunity_title VARCHAR,
  company_name VARCHAR,
  status VARCHAR,
  status_note TEXT,
  amount NUMERIC,
  proposal TEXT,
  reference_code VARCHAR,
  created_at TIMESTAMPTZ,
  status_updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in is required.';
  END IF;

  SELECT au.email INTO v_email FROM auth.users au WHERE au.id = auth.uid();

  UPDATE public.cmms_business_opportunity_bids b
  SET bidder_type = 'individual', bidder_ican_user_id = auth.uid()
  WHERE b.bidder_type = 'anonymous'
    AND v_email IS NOT NULL
    AND lower(b.bidder_email) = lower(v_email)
    AND NOT EXISTS (
      SELECT 1 FROM public.cmms_business_opportunity_bids existing
      WHERE existing.opportunity_id = b.opportunity_id
        AND existing.bidder_ican_user_id = auth.uid()
    );

  RETURN QUERY
  SELECT b.id, b.opportunity_id, o.title, cp.company_name, b.status, b.status_note,
    b.amount, b.proposal, b.reference_code, b.created_at, b.status_updated_at
  FROM public.cmms_business_opportunity_bids b
  JOIN public.cmms_business_opportunities o ON o.id = b.opportunity_id
  JOIN public.cmms_company_profiles cp ON cp.id = o.cmms_company_id
  WHERE b.bidder_ican_user_id = auth.uid()
  ORDER BY b.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_my_opportunity_bids() TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'CMMS anonymous opportunity bidding (submit/track/link, no account needed) installed' AS status;

-- ============================================================
-- TRUST/SACCO LOAN MANAGEMENT SYSTEM
-- ============================================================
-- What this script does:
-- 1) Creates tables for loan applications and voting
-- 2) Tracks loan approvals by admins and voting by members
-- 3) Enforces voting and admin approval requirements
-- 4) Tracks loan disbursement and repayment
--
-- Run this in Supabase SQL Editor after trust tables are created

-- ============================================================
-- 1) LOAN APPLICATIONS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.trust_loan_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.trust_groups(id) ON DELETE CASCADE,
  applicant_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  applicant_email VARCHAR(255),
  applicant_name VARCHAR(255),
  
  -- Loan Details
  loan_amount NUMERIC(12, 2) NOT NULL,
  loan_purpose TEXT,
  repayment_duration_months INTEGER DEFAULT 12,
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Application Status
  status VARCHAR(50) DEFAULT 'pending_admin', -- pending_admin → admin_approved/rejected → voting_in_progress → approved/rejected
  admin_approval_status VARCHAR(50),
  admin_approved_by UUID REFERENCES auth.users(id),
  admin_approved_at TIMESTAMPTZ,
  admin_approval_notes TEXT,
  
  -- Voting Status
  voting_status VARCHAR(50), -- voting_in_progress → voting_completed
  voting_started_at TIMESTAMPTZ,
  voting_ended_at TIMESTAMPTZ,
  total_votes_for INTEGER DEFAULT 0,
  total_votes_against INTEGER DEFAULT 0,
  total_members_voted INTEGER DEFAULT 0,
  voting_passed BOOLEAN,
  
  -- Loan Tracking
  disbursed_amount NUMERIC(12, 2) DEFAULT 0,
  disbursed_at TIMESTAMPTZ,
  disbursed_by UUID REFERENCES auth.users(id),
  repaid_amount NUMERIC(12, 2) DEFAULT 0,
  repayment_status VARCHAR(50), -- not_started, in_progress, completed, overdue
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trust_loan_applications_group_id ON public.trust_loan_applications(group_id);
CREATE INDEX IF NOT EXISTS idx_trust_loan_applications_applicant_id ON public.trust_loan_applications(applicant_id);
CREATE INDEX IF NOT EXISTS idx_trust_loan_applications_status ON public.trust_loan_applications(status);

-- ============================================================
-- 2) MEMBER VOTING ON LOANS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.trust_loan_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_application_id UUID NOT NULL REFERENCES public.trust_loan_applications(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES public.trust_groups(id) ON DELETE CASCADE,
  voter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  voter_email VARCHAR(255),
  voter_name VARCHAR(255),
  
  -- Vote
  vote_choice VARCHAR(10), -- 'yes', 'no', 'abstain'
  vote_reason TEXT,
  voted_at TIMESTAMPTZ DEFAULT NOW(),
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trust_loan_votes_loan_id ON public.trust_loan_votes(loan_application_id);
CREATE INDEX IF NOT EXISTS idx_trust_loan_votes_group_id ON public.trust_loan_votes(group_id);
CREATE INDEX IF NOT EXISTS idx_trust_loan_votes_voter_id ON public.trust_loan_votes(voter_id);

-- ============================================================
-- 3) LOAN REPAYMENT TRACKING
-- ============================================================
CREATE TABLE IF NOT EXISTS public.trust_loan_repayments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_application_id UUID NOT NULL REFERENCES public.trust_loan_applications(id) ON DELETE CASCADE,
  
  -- Repayment Details
  repayment_amount NUMERIC(12, 2) NOT NULL,
  repayment_date TIMESTAMPTZ NOT NULL,
  due_date TIMESTAMPTZ,
  
  -- Status
  status VARCHAR(50) DEFAULT 'scheduled', -- scheduled, completed, overdue, partial
  completed_at TIMESTAMPTZ,
  notes TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trust_loan_repayments_loan_id ON public.trust_loan_repayments(loan_application_id);

-- ============================================================
-- 4) HELPER FUNCTION: Check if user is group admin
-- ============================================================
CREATE OR REPLACE FUNCTION public.trust_is_group_admin(p_group_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.trust_groups tg
    WHERE tg.id = p_group_id
      AND tg.creator_id = p_user_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.trust_is_group_admin(UUID, UUID) TO authenticated;

-- ============================================================
-- 5) HELPER FUNCTION: Check if user is group member
-- ============================================================
CREATE OR REPLACE FUNCTION public.trust_is_group_member(p_group_id UUID, p_user_email VARCHAR)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Get user_id from email
  SELECT au.id 
  INTO v_user_id 
  FROM auth.users au 
  WHERE lower(au.email) = lower(p_user_email);

  IF v_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.trust_group_members tgm
    WHERE tgm.group_id = p_group_id
      AND tgm.user_id = v_user_id
      AND tgm.joined_at IS NOT NULL
      AND tgm.left_at IS NULL
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.trust_is_group_member(UUID, VARCHAR) TO authenticated;

-- ============================================================
-- 6) FUNCTION: Submit Loan Application
-- ============================================================
CREATE OR REPLACE FUNCTION public.submit_loan_application(
  p_group_id UUID,
  p_loan_amount NUMERIC,
  p_loan_purpose TEXT,
  p_repayment_months INTEGER DEFAULT 12
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id UUID;
  v_user_email VARCHAR(255);
  v_user_name VARCHAR(255);
  v_loan_id UUID;
BEGIN
  -- Get current user
  SELECT au.id, au.email
  INTO v_user_id, v_user_email
  FROM auth.users au
  WHERE au.id = auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User not authenticated';
  END IF;

  -- Verify user is group member
  IF NOT public.trust_is_group_member(p_group_id, v_user_email) THEN
    RAISE EXCEPTION 'User is not a member of this group';
  END IF;

  -- Use email as name (or raw_user_meta_data if available)
  v_user_name := v_user_email;

  -- Create loan application
  INSERT INTO public.trust_loan_applications (
    group_id,
    applicant_id,
    applicant_email,
    applicant_name,
    loan_amount,
    loan_purpose,
    repayment_duration_months,
    status
  ) VALUES (
    p_group_id,
    v_user_id,
    v_user_email,
    v_user_name,
    p_loan_amount,
    p_loan_purpose,
    p_repayment_months,
    'pending_admin'
  )
  RETURNING id INTO v_loan_id;

  RETURN v_loan_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_loan_application(UUID, NUMERIC, TEXT, INTEGER) TO authenticated;

-- ============================================================
-- 7) FUNCTION: Admin Approve/Reject Loan
-- ============================================================
DROP FUNCTION IF EXISTS public.admin_review_loan(UUID, VARCHAR, TEXT);

CREATE OR REPLACE FUNCTION public.admin_review_loan(
  p_loan_id UUID,
  p_status VARCHAR,
  p_notes TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id UUID;
  v_group_id UUID;
BEGIN
  -- Get current user
  SELECT au.id INTO v_user_id FROM auth.users au WHERE au.id = auth.uid();
  
  -- Get group_id from loan
  SELECT group_id INTO v_group_id FROM public.trust_loan_applications WHERE id = p_loan_id;

  IF v_group_id IS NULL THEN
    RAISE EXCEPTION 'Loan application not found';
  END IF;

  -- Verify user is admin of group
  IF NOT public.trust_is_group_admin(v_group_id, v_user_id) THEN
    RAISE EXCEPTION 'Only group admin can approve loans';
  END IF;

  -- Update loan with admin decision
  UPDATE public.trust_loan_applications
  SET 
    status = p_status,
    admin_approval_status = CASE 
      WHEN p_status = 'voting_in_progress' THEN 'approved'
      WHEN p_status = 'rejected' THEN 'rejected'
      ELSE status
    END,
    admin_approved_by = v_user_id,
    admin_approved_at = NOW(),
    admin_approval_notes = p_notes,
    voting_started_at = CASE 
      WHEN p_status = 'voting_in_progress' THEN NOW()
      ELSE voting_started_at
    END,
    updated_at = NOW()
  WHERE id = p_loan_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_review_loan(UUID, VARCHAR, TEXT) TO authenticated;

-- ============================================================
-- 8) FUNCTION: Member Vote on Loan
-- ============================================================
CREATE OR REPLACE FUNCTION public.member_vote_on_loan(
  p_loan_id UUID,
  p_vote_choice VARCHAR,
  p_vote_reason TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id UUID;
  v_user_email VARCHAR(255);
  v_user_name VARCHAR(255);
  v_group_id UUID;
  v_status VARCHAR(50);
BEGIN
  -- Get current user
  SELECT au.id, au.email INTO v_user_id, v_user_email FROM auth.users au WHERE au.id = auth.uid();
  
  -- Get group_id and status from loan
  SELECT group_id, status INTO v_group_id, v_status FROM public.trust_loan_applications WHERE id = p_loan_id;

  IF v_group_id IS NULL THEN
    RAISE EXCEPTION 'Loan application not found';
  END IF;

  -- Verify loan is in voting status
  IF v_status != 'voting_in_progress' THEN
    RAISE EXCEPTION 'Loan is not in voting status';
  END IF;

  -- Verify user is group member
  IF NOT public.trust_is_group_member(v_group_id, v_user_email) THEN
    RAISE EXCEPTION 'User is not a member of this group';
  END IF;

  -- Prevent applicant from voting
  IF EXISTS (
    SELECT 1 FROM public.trust_loan_applications 
    WHERE id = p_loan_id AND applicant_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Loan applicant cannot vote';
  END IF;

  -- Use email as name
  v_user_name := v_user_email;

  -- Delete existing vote if any
  DELETE FROM public.trust_loan_votes
  WHERE loan_application_id = p_loan_id AND voter_id = v_user_id;

  -- Insert new vote
  INSERT INTO public.trust_loan_votes (
    loan_application_id,
    group_id,
    voter_id,
    voter_email,
    voter_name,
    vote_choice,
    vote_reason
  ) VALUES (
    p_loan_id,
    v_group_id,
    v_user_id,
    v_user_email,
    v_user_name,
    p_vote_choice,
    p_vote_reason
  );

  -- Update vote counts
  UPDATE public.trust_loan_applications
  SET
    total_votes_for = (SELECT COUNT(*) FROM public.trust_loan_votes WHERE loan_application_id = p_loan_id AND vote_choice = 'yes'),
    total_votes_against = (SELECT COUNT(*) FROM public.trust_loan_votes WHERE loan_application_id = p_loan_id AND vote_choice = 'no'),
    total_members_voted = (SELECT COUNT(*) FROM public.trust_loan_votes WHERE loan_application_id = p_loan_id),
    updated_at = NOW()
  WHERE id = p_loan_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.member_vote_on_loan(UUID, VARCHAR, TEXT) TO authenticated;

-- ============================================================
-- 9) FUNCTION: Finalize Loan Voting
-- ============================================================
CREATE OR REPLACE FUNCTION public.finalize_loan_voting(p_loan_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id UUID;
  v_group_id UUID;
  v_votes_for INTEGER;
  v_votes_against INTEGER;
  v_total_members INTEGER;
  v_approval_threshold NUMERIC;
BEGIN
  -- Get current user
  SELECT au.id INTO v_user_id FROM auth.users au WHERE au.id = auth.uid();
  
  -- Get group_id from loan
  SELECT group_id INTO v_group_id FROM public.trust_loan_applications WHERE id = p_loan_id;

  -- Verify user is admin of group
  IF NOT public.trust_is_group_admin(v_group_id, v_user_id) THEN
    RAISE EXCEPTION 'Only group admin can finalize voting';
  END IF;

  -- Get vote counts
  SELECT total_votes_for, total_votes_against
  INTO v_votes_for, v_votes_against
  FROM public.trust_loan_applications
  WHERE id = p_loan_id;

  -- Get total active members (using 65% threshold)
  SELECT (
    SELECT COUNT(*)
    FROM public.trust_group_members
    WHERE group_id = v_group_id
      AND joined_at IS NOT NULL
      AND left_at IS NULL
  ) * 0.65
  INTO v_approval_threshold;

  -- Update loan with voting result
  UPDATE public.trust_loan_applications
  SET
    voting_status = 'voting_completed',
    voting_ended_at = NOW(),
    voting_passed = (v_votes_for > v_approval_threshold),
    status = CASE 
      WHEN v_votes_for > v_approval_threshold THEN 'approved'
      ELSE 'rejected_by_vote'
    END,
    updated_at = NOW()
  WHERE id = p_loan_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.finalize_loan_voting(UUID) TO authenticated;

-- ============================================================
-- 10) VIEW: Loan Applications Summary
-- ============================================================
DROP VIEW IF EXISTS public.v_trust_loan_applications;

CREATE VIEW public.v_trust_loan_applications AS
SELECT
  tla.id,
  tla.group_id,
  tg.name AS group_name,
  tla.applicant_id,
  tla.applicant_email,
  tla.applicant_name,
  tla.loan_amount,
  tla.loan_purpose,
  tla.repayment_duration_months,
  tla.status,
  tla.admin_approval_status,
  tla.voting_status,
  tla.total_votes_for,
  tla.total_votes_against,
  tla.total_members_voted,
  tla.voting_passed,
  tla.disbursed_amount,
  tla.repaid_amount,
  tla.repayment_status,
  tla.requested_at,
  tla.admin_approved_at,
  tla.voting_started_at,
  tla.voting_ended_at,
  tla.created_at,
  COALESCE(tla.disbursed_amount, 0) AS remaining_balance,
  CASE 
    WHEN tla.status = 'pending_admin' THEN 'Pending Admin Review'
    WHEN tla.status = 'admin_approved' THEN 'Admin Approved - Awaiting Voting'
    WHEN tla.status = 'voting_in_progress' THEN 'Member Voting In Progress'
    WHEN tla.status = 'approved' THEN 'Approved & Ready for Disbursement'
    WHEN tla.status = 'admin_rejected' THEN 'Rejected by Admin'
    WHEN tla.status = 'rejected_by_vote' THEN 'Rejected by Member Vote'
    ELSE tla.status
  END AS status_display
FROM public.trust_loan_applications tla
JOIN public.trust_groups tg ON tg.id = tla.group_id;

GRANT SELECT ON public.v_trust_loan_applications TO authenticated, anon;

-- ============================================================
-- 11) VERIFICATION
-- ============================================================
SELECT
  tablename
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename LIKE 'trust_loan%'
ORDER BY tablename;

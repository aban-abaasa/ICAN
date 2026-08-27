-- ================================================================
-- Shareholder-only approval + business-structure-aware investment types
-- ================================================================
-- Fixes / adds, all idempotent and safe to re-run:
--
-- 1. investment_agreements.status drift: two earlier migrations
--    (COMPLETE_INVESTMENT_SETUP.sql vs INVESTMENT_APPROVAL_SYSTEM.sql)
--    defined different, incompatible CHECK constraints on this column.
--    The live frontend (ShareSigningFlow.jsx) inserts status='signing',
--    which only one of those two allows. This migration finds whatever
--    CHECK constraint currently exists on the column (by inspecting its
--    definition rather than guessing its name) and replaces it with the
--    superset the app actually uses: pending/signing/sealed/cancelled.
--
-- 2. business_co_owners rows with zero ownership (e.g. a CTO/CFO added
--    with no equity) must not count as shareholders for the 60% approval
--    threshold. Adds ownership_share > 0 to get_total_shareholders() and
--    to the pending_shareholder_approvals view. (The live approval UI is
--    actually a separate, purely client-side path built on
--    shareholder_notifications -- see ShareSigningFlow.jsx and
--    ShareholderPendingSignatures.jsx, fixed separately in the frontend.
--    This keeps the DB-side approval system consistent in case it's ever
--    wired back up.)
--
-- 3. New business_structure value 'limited_by_guarantee' and new
--    investment_type value 'guarantor', so a company limited by
--    guarantee can offer a "become a guarantor" investment option
--    alongside buy/partner/support.
-- ================================================================

-- ----------------------------------------------------------------
-- 1. investment_agreements.status: normalize the CHECK constraint
-- ----------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  IF to_regclass('public.investment_agreements') IS NULL THEN
    RETURN;
  END IF;

  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.investment_agreements'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
      AND pg_get_constraintdef(oid) ILIKE '%pending%'
  LOOP
    EXECUTE format('ALTER TABLE public.investment_agreements DROP CONSTRAINT %I', r.conname);
  END LOOP;

  ALTER TABLE public.investment_agreements
    ADD CONSTRAINT investment_agreements_status_check
    CHECK (status IN ('pending', 'signing', 'sealed', 'cancelled'));
END $$;

-- ----------------------------------------------------------------
-- 2. investment_agreements.investment_type: add 'guarantor'
-- ----------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  IF to_regclass('public.investment_agreements') IS NULL THEN
    RETURN;
  END IF;

  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.investment_agreements'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%investment_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.investment_agreements DROP CONSTRAINT %I', r.conname);
  END LOOP;

  ALTER TABLE public.investment_agreements
    ADD CONSTRAINT investment_agreements_investment_type_check
    CHECK (investment_type IN ('buy', 'partner', 'support', 'guarantor'));
END $$;

-- ----------------------------------------------------------------
-- 3. business_profiles.business_structure: add 'limited_by_guarantee'
-- ----------------------------------------------------------------
ALTER TABLE IF EXISTS public.business_profiles
  ADD COLUMN IF NOT EXISTS business_structure TEXT NOT NULL DEFAULT 'organisation';

DO $$
DECLARE
  r RECORD;
BEGIN
  IF to_regclass('public.business_profiles') IS NULL THEN
    RETURN;
  END IF;

  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.business_profiles'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%business_structure%'
  LOOP
    EXECUTE format('ALTER TABLE public.business_profiles DROP CONSTRAINT %I', r.conname);
  END LOOP;

  ALTER TABLE public.business_profiles
    ADD CONSTRAINT business_profiles_structure_check
    CHECK (business_structure IN ('sole_proprietorship', 'organisation', 'enterprise', 'limited_by_guarantee'));
END $$;

-- ----------------------------------------------------------------
-- 4. get_total_shareholders(): only count real (equity-holding) shareholders
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_total_shareholders(business_id UUID)
RETURNS INTEGER AS $$
DECLARE
  total_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO total_count
  FROM public.business_co_owners
  WHERE business_profile_id = business_id
  AND (status = 'active' OR status IS NULL)
  AND ownership_share > 0;

  RETURN COALESCE(total_count, 0);
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------
-- 5. pending_shareholder_approvals view: same ownership_share > 0 filter
-- ----------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.investment_agreements') IS NOT NULL
     AND to_regclass('public.business_co_owners') IS NOT NULL THEN
    CREATE OR REPLACE VIEW public.pending_shareholder_approvals AS
    SELECT
      ia.id as agreement_id,
      ia.escrow_id,
      ia.investor_id,
      ia.business_profile_id,
      ia.total_investment,
      ia.investment_type,
      ia.shares_amount,
      COUNT(DISTINCT bco.id) as total_shareholders_to_approve,
      COUNT(DISTINCT CASE WHEN isg.signature_status = 'signed' THEN bco.id END) as shareholders_approved,
      ARRAY_AGG(DISTINCT CASE WHEN isg.id IS NULL THEN bco.user_id END) as pending_shareholder_ids
    FROM public.investment_agreements ia
    JOIN public.business_co_owners bco
      ON ia.business_profile_id = bco.business_profile_id
      AND (bco.status = 'active' OR bco.status IS NULL)
      AND bco.ownership_share > 0
    LEFT JOIN public.investment_signatures isg ON ia.id = isg.agreement_id AND bco.user_id = isg.shareholder_id
    WHERE ia.status = 'signing'
    GROUP BY ia.id, ia.escrow_id, ia.investor_id, ia.business_profile_id, ia.total_investment, ia.investment_type, ia.shares_amount;
  END IF;
END $$;

DO $$
BEGIN
  RAISE NOTICE 'Shareholder approval + guarantee structure fix applied successfully.';
END $$;

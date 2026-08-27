-- ================================================================
-- Auto-seal investment_agreements when shareholder approval threshold is met
-- ================================================================
-- Investigated as part of: "investor bought shares, can't get MOU, not
-- added as shareholder / no business profile access".
--
-- Found: ShareSigningFlow.jsx INSERTs investment_agreements with
-- status='signing' and NEVER updates it to 'sealed' anywhere. The 60%
-- "sealed" concept only ever existed as a client-side recompute, and in
-- one place (InvestmentProgressView.jsx, fixed separately in the
-- frontend) that recompute was reading shareholder_notifications
-- read-receipts instead of real investment_signatures rows, so it could
-- stay "awaiting approval" forever even after genuine shareholder
-- sign-off. Meanwhile Pitchin.jsx's resume check
-- (`.in('status', ['signing','sealed'])`) and the reload above both treat
-- investment_agreements.status as the source of truth -- which was never
-- actually being written.
--
-- This trigger makes sealing a real, server-side fact: whenever a
-- shareholder signature is inserted/updated to 'signed', recompute the
-- approval percentage for that agreement using the same source of truth
-- as get_total_shareholders() (business_co_owners with ownership_share > 0)
-- and flip investment_agreements.status to 'sealed' once it crosses 60%.
-- This does NOT touch business_co_owners/equity dilution -- that math
-- depends on a live share valuation only available client-side, so it's
-- left to investorPromotionService.reconcileInvestorShareholderStatus,
-- which runs whenever the investor's progress screen loads and sees
-- status='sealed'.
--
-- Ends with a backfill that re-fires the trigger for every already-signed
-- signature, so any agreement that's ALREADY past 60% (existing stuck
-- investors) gets sealed immediately by running this script, with no
-- need to identify anyone by name.
-- ================================================================

DO $$
BEGIN
  IF to_regclass('public.investment_agreements') IS NULL
     OR to_regclass('public.investment_signatures') IS NULL
     OR to_regclass('public.business_co_owners') IS NULL THEN
    RAISE EXCEPTION 'investment_agreements / investment_signatures / business_co_owners must exist first -- run CREATE_INVESTMENT_AGREEMENTS_CORE_TABLES.sql and the business profile schema.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.check_and_seal_investment_agreement()
RETURNS TRIGGER AS $$
DECLARE
  v_agreement RECORD;
  v_total_shareholders INT;
  v_signed_count INT;
BEGIN
  SELECT * INTO v_agreement
  FROM public.investment_agreements
  WHERE id = NEW.agreement_id;

  IF v_agreement IS NULL OR v_agreement.status <> 'signing' THEN
    RETURN NEW;
  END IF;

  v_total_shareholders := public.get_total_shareholders(v_agreement.business_profile_id);
  IF v_total_shareholders = 0 THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_signed_count
  FROM public.investment_signatures
  WHERE agreement_id = v_agreement.id
    AND signature_status = 'signed';

  IF (v_signed_count::DECIMAL / v_total_shareholders) >= 0.6 THEN
    UPDATE public.investment_agreements
    SET status = 'sealed',
        sealed_at = COALESCE(sealed_at, CURRENT_TIMESTAMP)
    WHERE id = v_agreement.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_check_and_seal_investment_agreement ON public.investment_signatures;
CREATE TRIGGER trg_check_and_seal_investment_agreement
AFTER INSERT OR UPDATE ON public.investment_signatures
FOR EACH ROW
WHEN (NEW.signature_status = 'signed')
EXECUTE FUNCTION public.check_and_seal_investment_agreement();

-- Backfill: re-run the check for every already-signed signature so any
-- agreement that's already past 60% right now gets sealed immediately,
-- instead of waiting for its next signature event (which may never come).
UPDATE public.investment_signatures
SET signature_status = signature_status
WHERE signature_status = 'signed';

DO $$
DECLARE
  v_sealed_count INT;
BEGIN
  SELECT COUNT(*) INTO v_sealed_count
  FROM public.investment_agreements
  WHERE status = 'sealed';
  RAISE NOTICE 'Auto-seal trigger installed. % agreement(s) now sealed.', v_sealed_count;
END $$;

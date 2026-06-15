-- =====================================================
-- CREATE RETROACTIVE INVESTMENT APPROVALS FOR DAb PITCH
-- =====================================================
-- This script creates investment_approvals records for existing investor signatures
-- The investor signed successfully but the approval record wasn't created

-- Get investor info from existing signatures
WITH investor_sig AS (
  SELECT DISTINCT
    sig.investment_id,
    sig.signer_email,
    sig.signer_id,
    p.business_profile_id,
    COUNT(sig.id) as signature_count
  FROM public.investment_signatures sig
  LEFT JOIN public.pitches p ON sig.investment_id = p.id
  WHERE sig.signer_email = 'abana1662@gmail.com'
  AND sig.signer_type = 'investor'
  AND sig.signature_status = 'pin_verified'
  GROUP BY sig.investment_id, sig.signer_email, sig.signer_id, p.business_profile_id
)
-- Insert the approval record if it doesn't exist
INSERT INTO public.investment_approvals (
  investment_id,
  business_profile_id,
  investor_id,
  investor_email,
  investor_signature_status,
  investor_signed_at,
  wallet_account_number,
  transfer_amount,
  transfer_status,
  transfer_completed_at,
  transfer_reference,
  total_shareholders,
  shareholders_signed,
  approval_threshold_percent,
  approval_threshold_met,
  document_status,
  created_at
)
SELECT
  investor_sig.investment_id,
  investor_sig.business_profile_id,
  investor_sig.signer_id,
  investor_sig.signer_email,
  'pin_verified',
  NOW(),
  'AGENT-KAM-5560',
  5000,  -- From the signing flow
  'completed',
  NOW(),
  'REF-' || SUBSTRING(investor_sig.signer_id::text, 1, 8),
  (SELECT COUNT(*) FROM public.business_co_owners WHERE business_profile_id = investor_sig.business_profile_id),
  0,
  60,
  FALSE,
  'pending',
  (SELECT MIN(created_at) FROM public.investment_signatures WHERE investment_id = investor_sig.investment_id)
FROM investor_sig
WHERE investor_sig.business_profile_id IS NOT NULL
ON CONFLICT (investment_id) DO NOTHING;

-- Verify the result
SELECT 
  ia.id,
  ia.investment_id,
  ia.investor_email,
  ia.business_profile_id,
  bp.business_name,
  ia.total_shareholders,
  ia.approval_threshold_percent,
  ia.created_at
FROM public.investment_approvals ia
LEFT JOIN public.business_profiles bp ON ia.business_profile_id = bp.id
ORDER BY ia.created_at DESC
LIMIT 5;

-- =====================================================
-- CHECK ALL INVESTMENT APPROVALS
-- =====================================================

-- Show all investment approvals
SELECT 
  ia.id,
  ia.investment_id,
  ia.investor_email,
  ia.investor_id,
  ia.business_profile_id,
  ia.transfer_amount,
  bp.business_name,
  ia.created_at
FROM public.investment_approvals ia
LEFT JOIN public.business_profiles bp ON ia.business_profile_id = bp.id
ORDER BY ia.created_at DESC
LIMIT 10;

-- Count by profile
SELECT 
  bp.business_name,
  COUNT(ia.id) as approval_count
FROM public.business_profiles bp
LEFT JOIN public.investment_approvals ia ON bp.id = ia.business_profile_id
GROUP BY bp.business_name
ORDER BY approval_count DESC;

-- Show investor signatures to see who signed
SELECT 
  sig.investment_id,
  sig.signer_email,
  sig.signer_type,
  sig.signature_status,
  sig.created_at
FROM public.investment_signatures sig
ORDER BY sig.created_at DESC
LIMIT 10;

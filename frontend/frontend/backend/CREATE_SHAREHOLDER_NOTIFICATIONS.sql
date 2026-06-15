-- =====================================================
-- CREATE NOTIFICATIONS FOR ALL BUSINESS SHAREHOLDERS
-- =====================================================
-- Generate shareholder notifications for all registered businesses
-- with pending investments or newly signed agreements

-- Get all businesses with active investment agreements
WITH all_businesses AS (
  SELECT DISTINCT
    bp.id as business_profile_id,
    bp.business_name,
    ia.investment_id as agreement_id,
    ia.investor_id,
    ia.transfer_amount
  FROM public.business_profiles bp
  INNER JOIN public.investment_approvals ia ON bp.id = ia.business_profile_id
  INNER JOIN public.investment_agreements iag ON ia.investment_id = iag.id
  WHERE ia.transfer_status IN ('pending', 'completed')
    AND ia.approval_threshold_met = FALSE
    AND ia.investment_id IS NOT NULL
),
-- Get shareholders for each business
all_shareholders AS (
  SELECT DISTINCT
    ab.business_profile_id,
    ab.business_name,
    ab.agreement_id,
    ab.investor_id,
    ab.transfer_amount,
    bco.owner_name,
    bco.owner_email,
    bco.user_id,
    bco.ownership_share,
    bco.role
  FROM all_businesses ab
  INNER JOIN public.business_co_owners bco ON ab.business_profile_id = bco.business_profile_id
  WHERE bco.status = 'active'
),
-- Join with auth users to get UUIDs
shareholder_users AS (
  SELECT DISTINCT
    COALESCE(au.id, gen_random_uuid()) as user_id,
    ash.business_profile_id,
    ash.business_name,
    ash.agreement_id,
    ash.investor_id,
    ash.transfer_amount,
    ash.owner_name,
    ash.owner_email,
    ash.ownership_share,
    ash.role
  FROM all_shareholders ash
  LEFT JOIN auth.users au ON ash.owner_email = au.email
)
-- Create notifications for each shareholder of each business
INSERT INTO public.investment_notifications (
  recipient_id,
  sender_id,
  notification_type,
  title,
  message,
  agreement_id,
  business_profile_id,
  priority,
  is_read,
  created_at
)
SELECT
  su.user_id,
  su.investor_id,
  'signature_request',
  '🔐 Signature Request (24hr deadline): ' || COALESCE(su.business_name, 'Investment'),
  COALESCE(su.owner_email, 'shareholder@ican.com') || ' is requesting your signature for an investment in "' || COALESCE(su.business_name, 'Business') || '". Amount: UGX ' || COALESCE(su.transfer_amount::TEXT, '0') || ' ICAN. You have 24 hours to review and sign this agreement.',
  su.agreement_id,
  su.business_profile_id,
  'high',
  false,
  NOW()
FROM shareholder_users su
WHERE su.user_id IS NOT NULL
  AND su.agreement_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Verify notifications were created for all businesses
SELECT 
  COUNT(*) as total_notifications,
  COUNT(DISTINCT recipient_id) as unique_shareholders,
  COUNT(DISTINCT business_profile_id) as businesses_affected
FROM public.investment_notifications
WHERE notification_type = 'signature_request'
  AND created_at >= NOW() - INTERVAL '1 hour';

-- Show the created notifications grouped by business
SELECT 
  bp.business_name,
  COUNT(n.id) as notification_count,
  COUNT(DISTINCT n.recipient_id) as shareholder_count,
  MAX(n.created_at) as latest_notification
FROM public.investment_notifications n
LEFT JOIN public.business_profiles bp ON n.business_profile_id = bp.id
WHERE n.notification_type = 'signature_request'
  AND n.created_at >= NOW() - INTERVAL '1 hour'
GROUP BY bp.business_name
ORDER BY MAX(n.created_at) DESC;

-- Show detailed notification list for all businesses
SELECT 
  bp.business_name,
  u.email as shareholder_email,
  n.title,
  n.message,
  n.is_read,
  n.created_at
FROM public.investment_notifications n
LEFT JOIN public.business_profiles bp ON n.business_profile_id = bp.id
LEFT JOIN auth.users u ON n.recipient_id = u.id
WHERE n.notification_type = 'signature_request'
  AND n.created_at >= NOW() - INTERVAL '1 hour'
ORDER BY bp.business_name, n.created_at DESC;


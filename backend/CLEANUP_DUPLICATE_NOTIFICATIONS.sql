-- =====================================================
-- CLEAN UP DUPLICATE SHAREHOLDER NOTIFICATIONS
-- =====================================================
-- Keep only the MOST RECENT notification per shareholder for each investment
-- Delete all older duplicates

DELETE FROM public.shareholder_notifications
WHERE id NOT IN (
  SELECT DISTINCT ON (investment_id, shareholder_id) id
  FROM public.shareholder_notifications
  WHERE notification_type = 'signature_request'
    AND investment_id IN (
      SELECT id FROM public.investment_approvals
      WHERE investor_email = 'abana1662@gmail.com'
    )
  ORDER BY investment_id, shareholder_id, created_at DESC
);

-- Verify only unique notifications remain
SELECT 
  COUNT(*) as total_notifications,
  COUNT(DISTINCT investment_id) as unique_investments,
  COUNT(DISTINCT shareholder_id) as unique_shareholders
FROM public.shareholder_notifications
WHERE notification_type = 'signature_request'
  AND investment_id IN (
    SELECT id FROM public.investment_approvals
    WHERE investor_email = 'abana1662@gmail.com'
  );

-- Show remaining notifications
SELECT 
  id,
  investment_id,
  shareholder_id,
  shareholder_email,
  notification_type,
  created_at
FROM public.shareholder_notifications
WHERE notification_type = 'signature_request'
  AND investment_id IN (
    SELECT id FROM public.investment_approvals
    WHERE investor_email = 'abana1662@gmail.com'
  )
ORDER BY created_at DESC;

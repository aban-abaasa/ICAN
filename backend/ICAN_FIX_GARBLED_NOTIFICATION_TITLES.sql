-- ============================================================================
-- Repair already-stored notification titles that were saved with mojibake
-- emoji (source: ShareSigningFlow.jsx used to build these titles with a
-- 4-generation-corrupted UTF-8 emoji literal -- fixed in that file directly;
-- this repairs the rows it already wrote to public.investment_notifications
-- before that fix). Safe to run more than once: only rows still carrying the
-- corrupted prefix are touched.
-- ============================================================================

UPDATE public.investment_notifications
   SET title = regexp_replace(title, '^.*New ', '💰 New ')
 WHERE notification_type = 'new_investment'
   AND title LIKE '%New %'
   AND title NOT LIKE '💰%';

UPDATE public.investment_notifications
   SET title = regexp_replace(title, '^.*Investment Approval Needed', '📋 Investment Approval Needed')
 WHERE notification_type = 'shareholder_approval_needed'
   AND title LIKE '%Investment Approval Needed%'
   AND title NOT LIKE '📋%';

SELECT 'Garbled investment_notifications titles repaired' AS status;

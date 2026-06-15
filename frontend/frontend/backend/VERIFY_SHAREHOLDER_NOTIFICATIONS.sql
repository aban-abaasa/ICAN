-- Verify shareholder_notifications table exists and has correct columns

-- Step 1: Check if table exists
SELECT 
  table_name,
  table_schema
FROM information_schema.tables 
WHERE table_name = 'shareholder_notifications'
ORDER BY table_schema;

-- Step 2: List all columns in shareholder_notifications
SELECT 
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns 
WHERE table_name = 'shareholder_notifications'
ORDER BY ordinal_position;

-- Step 3: Check table size
SELECT 
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
FROM pg_tables
WHERE tablename = 'shareholder_notifications';

-- Step 4: Try inserting a test record
INSERT INTO shareholder_notifications (
  business_profile_id,
  shareholder_id,
  shareholder_email,
  shareholder_name,
  notification_type,
  notification_title,
  notification_message,
  investor_name,
  investor_email,
  investment_amount,
  investment_currency,
  investment_shares,
  notification_sent_via
) VALUES (
  '35a1d558-d256-465b-bb16-b023eafb5388'::uuid,
  'test-shareholder-id'::uuid,
  'test@example.com',
  'Test Shareholder',
  'investment_signed',
  'Test Title',
  'Test Message',
  'Test Investor',
  'investor@example.com',
  1000,
  'UGX',
  5,
  'in_app'
);

-- Step 5: Verify insert worked
SELECT COUNT(*) FROM shareholder_notifications;

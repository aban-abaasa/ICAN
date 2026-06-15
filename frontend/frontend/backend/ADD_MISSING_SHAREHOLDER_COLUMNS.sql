-- ADD MISSING COLUMNS TO shareholder_notifications TABLE

-- Step 1: Add missing columns if they don't exist
ALTER TABLE shareholder_notifications
ADD COLUMN IF NOT EXISTS shareholder_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS notification_type VARCHAR(100),
ADD COLUMN IF NOT EXISTS notification_title VARCHAR(255),
ADD COLUMN IF NOT EXISTS notification_message TEXT,
ADD COLUMN IF NOT EXISTS investor_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS investor_email VARCHAR(255),
ADD COLUMN IF NOT EXISTS investment_amount NUMERIC(15, 2),
ADD COLUMN IF NOT EXISTS investment_currency VARCHAR(10),
ADD COLUMN IF NOT EXISTS investment_shares NUMERIC(10, 2),
ADD COLUMN IF NOT EXISTS notification_sent_via VARCHAR(50);

-- Step 2: Verify all columns now exist
SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns 
WHERE table_name = 'shareholder_notifications'
ORDER BY ordinal_position;

-- Step 3: Verify all columns now exist
SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns 
WHERE table_name = 'shareholder_notifications'
ORDER BY ordinal_position;

-- Step 4: Verify data
SELECT COUNT(*) as total_records FROM shareholder_notifications;

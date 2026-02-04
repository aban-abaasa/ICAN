/**
 * 🗄️ Database Migration - Country Selection System
 * Add country_code to existing business_profiles table
 * Run this on Supabase SQL Editor
 */

-- ===================================
-- STEP 1: Add country_code column to business_profiles
-- ===================================
ALTER TABLE public.business_profiles
ADD COLUMN IF NOT EXISTS country_code VARCHAR(2) DEFAULT NULL;

-- Add comment to clarify this is REQUIRED for ICAN features
COMMENT ON COLUMN public.business_profiles.country_code IS 'User''s country code (e.g., UG, KE, US). REQUIRED for ICAN features. NULL means not set.';

-- ===================================
-- STEP 2: Add ICAN coin tracking columns
-- ===================================
ALTER TABLE public.business_profiles
ADD COLUMN IF NOT EXISTS ican_coin_balance DECIMAL(18,8) DEFAULT 0;

ALTER TABLE public.business_profiles
ADD COLUMN IF NOT EXISTS ican_coin_total_purchased DECIMAL(18,8) DEFAULT 0;

ALTER TABLE public.business_profiles
ADD COLUMN IF NOT EXISTS ican_coin_total_sold DECIMAL(18,8) DEFAULT 0;

ALTER TABLE public.business_profiles
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

-- ===================================
-- STEP 3: Create indexes for faster lookups
-- ===================================
CREATE INDEX IF NOT EXISTS idx_business_profiles_country_code 
ON public.business_profiles(country_code);

CREATE INDEX IF NOT EXISTS idx_business_profiles_user_id 
ON public.business_profiles(user_id);

-- ===================================
-- STEP 4: Create a function to check if user has country set
-- ===================================
DROP FUNCTION IF EXISTS has_country_set(UUID) CASCADE;
CREATE OR REPLACE FUNCTION has_country_set(user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.business_profiles
    WHERE user_id = user_id
    AND country_code IS NOT NULL
    AND country_code != ''
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===================================
-- STEP 5: Create a function to enforce country before ICAN operations
-- ===================================
DROP FUNCTION IF EXISTS check_user_has_country() CASCADE;
CREATE OR REPLACE FUNCTION check_user_has_country()
RETURNS TRIGGER AS $$
BEGIN
  -- Check if user has country set in business_profiles
  IF NOT has_country_set(NEW.user_id) THEN
    RAISE EXCEPTION 'User must set country before ICAN operations';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===================================
-- STEP 6: Create ICAN transaction table
-- ===================================
CREATE TABLE IF NOT EXISTS public.ican_coin_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  type VARCHAR(50) NOT NULL,
  ican_amount DECIMAL(18,8) NOT NULL,
  local_amount DECIMAL(18,8),
  country_code VARCHAR(2),
  currency VARCHAR(3),
  price_per_coin DECIMAL(18,8),
  exchange_rate DECIMAL(18,8),
  payment_method VARCHAR(50),
  status VARCHAR(50) DEFAULT 'completed',
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  sender_user_id UUID,
  recipient_user_id UUID,
  from_country VARCHAR(2),
  to_country VARCHAR(2),
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- ===================================
-- STEP 7: Apply trigger to ICAN transaction table
-- ===================================
DROP TRIGGER IF EXISTS check_country_before_ican_tx ON public.ican_coin_transactions;
CREATE TRIGGER check_country_before_ican_tx
BEFORE INSERT ON public.ican_coin_transactions
FOR EACH ROW
WHEN (NEW.type IN ('purchase', 'sale', 'transfer_out', 'staking'))
EXECUTE FUNCTION check_user_has_country();

-- ===================================
-- STEP 8: Create indexes on transactions table
-- ===================================
CREATE INDEX IF NOT EXISTS idx_ican_transactions_user_id 
ON public.ican_coin_transactions(user_id);

CREATE INDEX IF NOT EXISTS idx_ican_transactions_type 
ON public.ican_coin_transactions(type);

CREATE INDEX IF NOT EXISTS idx_ican_transactions_timestamp 
ON public.ican_coin_transactions(timestamp);

-- ===================================
-- STEP 9: Create view for users without country
-- ===================================
DROP VIEW IF EXISTS public.users_without_country;
CREATE VIEW public.users_without_country AS
SELECT user_id, id as business_id, business_name, created_at
FROM public.business_profiles
WHERE country_code IS NULL OR country_code = '';

-- ===================================
-- STEP 10: Enable RLS on ICAN transactions table
-- ===================================
ALTER TABLE public.ican_coin_transactions ENABLE ROW LEVEL SECURITY;

-- ===================================
-- STEP 11: Create RLS policies for transactions
-- ===================================
DROP POLICY IF EXISTS "Users can see own transactions" ON public.ican_coin_transactions;
CREATE POLICY "Users can see own transactions" ON public.ican_coin_transactions
  FOR SELECT USING (
    auth.uid() = user_id OR 
    auth.uid() = sender_user_id OR 
    auth.uid() = recipient_user_id
  );

DROP POLICY IF EXISTS "Users can insert own transactions" ON public.ican_coin_transactions;
CREATE POLICY "Users can insert own transactions" ON public.ican_coin_transactions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ===================================
-- STEP 12: Create function to get user country
-- ===================================
DROP FUNCTION IF EXISTS get_user_country(UUID) CASCADE;
CREATE OR REPLACE FUNCTION get_user_country(user_id UUID)
RETURNS VARCHAR(2) AS $$
DECLARE
  country_code VARCHAR(2);
BEGIN
  SELECT bp.country_code INTO country_code
  FROM public.business_profiles bp
  WHERE bp.user_id = user_id
  LIMIT 1;
  
  RETURN COALESCE(country_code, 'US');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===================================
-- STEP 13: Verify migration
-- ===================================
-- Run these queries to verify everything worked:

-- Check if country_code column exists
-- SELECT column_name FROM information_schema.columns 
-- WHERE table_name = 'business_profiles' AND column_name = 'country_code';

-- Check users without country
-- SELECT * FROM users_without_country;

-- Check if function works
-- SELECT get_user_country('YOUR_USER_ID'::UUID);

-- ===================================
-- SUCCESS MESSAGE
-- ===================================
-- If you see no errors above, the migration was successful!
-- ✅ country_code column added to business_profiles
-- ✅ ICAN coin tracking columns added
-- ✅ Functions and triggers created
-- ✅ RLS policies enabled on transactions table
-- ✅ Indexes created for performance


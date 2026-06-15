-- Add missing columns to ican_user_profiles table
-- These columns are expected by the ProfilePage form

ALTER TABLE public.ican_user_profiles 
ADD COLUMN IF NOT EXISTS income_level VARCHAR(50);

ALTER TABLE public.ican_user_profiles 
ADD COLUMN IF NOT EXISTS financial_goal VARCHAR(255);

ALTER TABLE public.ican_user_profiles 
ADD COLUMN IF NOT EXISTS risk_tolerance VARCHAR(50) DEFAULT 'moderate';

-- Verify the table structure
SELECT column_name, data_type, is_nullable
FROM information_schema.columns 
WHERE table_name = 'ican_user_profiles'
ORDER BY ordinal_position;

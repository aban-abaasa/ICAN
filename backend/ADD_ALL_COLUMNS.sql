-- Comprehensive fix for ican_user_profiles table
-- Add ALL missing columns at once

ALTER TABLE public.ican_user_profiles 
ADD COLUMN IF NOT EXISTS phone VARCHAR(50);

ALTER TABLE public.ican_user_profiles 
ADD COLUMN IF NOT EXISTS avatar_url TEXT;

ALTER TABLE public.ican_user_profiles 
ADD COLUMN IF NOT EXISTS bio TEXT;

ALTER TABLE public.ican_user_profiles 
ADD COLUMN IF NOT EXISTS income_level VARCHAR(50);

ALTER TABLE public.ican_user_profiles 
ADD COLUMN IF NOT EXISTS financial_goal VARCHAR(255);

ALTER TABLE public.ican_user_profiles 
ADD COLUMN IF NOT EXISTS risk_tolerance VARCHAR(50) DEFAULT 'moderate';

ALTER TABLE public.ican_user_profiles 
ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'UGX';

ALTER TABLE public.ican_user_profiles 
ADD COLUMN IF NOT EXISTS language VARCHAR(10) DEFAULT 'en';

ALTER TABLE public.ican_user_profiles 
ADD COLUMN IF NOT EXISTS notifications_enabled BOOLEAN DEFAULT true;

ALTER TABLE public.ican_user_profiles 
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

ALTER TABLE public.ican_user_profiles 
ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT false;

ALTER TABLE public.ican_user_profiles 
ADD COLUMN IF NOT EXISTS blockchain_verified BOOLEAN DEFAULT false;

ALTER TABLE public.ican_user_profiles 
ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP WITH TIME ZONE;

-- Refresh schema cache and verify
SELECT 'ican_user_profiles columns updated successfully!' as status;

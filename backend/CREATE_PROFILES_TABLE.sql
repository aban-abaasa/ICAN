-- ICAN User Profiles Table Migration
-- Copy and paste this entire block into Supabase SQL Editor at:
-- https://supabase.com/dashboard/project/hswxazpxcgtqbxeqcxxw/sql/new

CREATE TABLE IF NOT EXISTS public.ican_user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL UNIQUE,
  full_name VARCHAR(255),
  phone VARCHAR(50),
  avatar_url TEXT,
  bio TEXT,
  income_level VARCHAR(50),
  financial_goal TEXT,
  risk_tolerance VARCHAR(20) DEFAULT 'moderate',
  currency VARCHAR(10) DEFAULT 'USD',
  language VARCHAR(10) DEFAULT 'en',
  notifications_enabled BOOLEAN DEFAULT true,
  is_active BOOLEAN DEFAULT true,
  is_verified BOOLEAN DEFAULT false,
  blockchain_verified BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_login_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_ican_user_profiles_email ON public.ican_user_profiles(email);
CREATE INDEX IF NOT EXISTS idx_ican_user_profiles_created_at ON public.ican_user_profiles(created_at);

ALTER TABLE public.ican_user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile" ON public.ican_user_profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.ican_user_profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON public.ican_user_profiles FOR INSERT WITH CHECK (auth.uid() = id);

CREATE OR REPLACE FUNCTION public.update_ican_user_profiles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_ican_user_profiles_updated_at ON public.ican_user_profiles;
CREATE TRIGGER trigger_update_ican_user_profiles_updated_at
  BEFORE UPDATE ON public.ican_user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_ican_user_profiles_updated_at();

CREATE OR REPLACE FUNCTION public.handle_ican_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.ican_user_profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', ''))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_ican_auth_user_created ON auth.users;
CREATE TRIGGER on_ican_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_ican_new_user();

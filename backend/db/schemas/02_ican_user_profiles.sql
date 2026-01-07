-- ICAN User Profiles Table
-- Stores user profile information for ICAN application

CREATE TABLE IF NOT EXISTS ican_user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL UNIQUE,
  full_name VARCHAR(255),
  phone VARCHAR(50),
  avatar_url TEXT,
  bio TEXT,
  
  -- Financial Profile
  income_level VARCHAR(50),
  financial_goal TEXT,
  risk_tolerance VARCHAR(20) DEFAULT 'moderate',
  
  -- Preferences
  currency VARCHAR(10) DEFAULT 'USD',
  language VARCHAR(10) DEFAULT 'en',
  notifications_enabled BOOLEAN DEFAULT true,
  
  -- Status
  is_active BOOLEAN DEFAULT true,
  is_verified BOOLEAN DEFAULT false,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_login_at TIMESTAMP WITH TIME ZONE
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_ican_user_profiles_email ON ican_user_profiles(email);
CREATE INDEX IF NOT EXISTS idx_ican_user_profiles_created_at ON ican_user_profiles(created_at);

-- Enable Row Level Security
ALTER TABLE ican_user_profiles ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own profile
CREATE POLICY "Users can view own profile"
  ON ican_user_profiles
  FOR SELECT
  USING (auth.uid() = id);

-- Policy: Users can update their own profile
CREATE POLICY "Users can update own profile"
  ON ican_user_profiles
  FOR UPDATE
  USING (auth.uid() = id);

-- Policy: Users can insert their own profile
CREATE POLICY "Users can insert own profile"
  ON ican_user_profiles
  FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_ican_user_profiles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update updated_at on changes
DROP TRIGGER IF EXISTS trigger_update_ican_user_profiles_updated_at ON ican_user_profiles;
CREATE TRIGGER trigger_update_ican_user_profiles_updated_at
  BEFORE UPDATE ON ican_user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_ican_user_profiles_updated_at();

-- Function to handle new user signup
CREATE OR REPLACE FUNCTION handle_ican_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.ican_user_profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to automatically create profile on signup
DROP TRIGGER IF EXISTS on_ican_auth_user_created ON auth.users;
CREATE TRIGGER on_ican_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_ican_new_user();

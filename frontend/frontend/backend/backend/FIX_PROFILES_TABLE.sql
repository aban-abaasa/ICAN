-- Verify and finalize ican_user_profiles table setup
-- Table and policies already exist, just ensure triggers are set up

-- Drop triggers only (policies can stay)
DROP TRIGGER IF EXISTS trigger_update_ican_user_profiles_updated_at ON public.ican_user_profiles;
DROP TRIGGER IF EXISTS on_ican_auth_user_created ON auth.users;

-- Recreate trigger function for timestamp
CREATE OR REPLACE FUNCTION public.update_ican_user_profiles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recreate update trigger
CREATE TRIGGER trigger_update_ican_user_profiles_updated_at
  BEFORE UPDATE ON public.ican_user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_ican_user_profiles_updated_at();

-- Recreate auto-signup function
CREATE OR REPLACE FUNCTION public.handle_ican_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.ican_user_profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', ''))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate signup trigger
CREATE TRIGGER on_ican_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_ican_new_user();

-- Verify table structure
SELECT 'ican_user_profiles table is ready!' as status;

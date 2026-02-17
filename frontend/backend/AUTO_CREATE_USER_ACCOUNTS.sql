-- =====================================================
-- AUTO-CREATE USER_ACCOUNTS ON NEW USER SIGNUP
-- =====================================================
-- When a user signs up via Google (or any auth method),
-- automatically create a user_accounts record

-- First, remove duplicate user_accounts records (keep the oldest by created_at)
DELETE FROM public.user_accounts ua1
WHERE EXISTS (
  SELECT 1 FROM public.user_accounts ua2
  WHERE ua1.user_id = ua2.user_id
  AND ua1.id != ua2.id
  AND (ua2.created_at < ua1.created_at 
       OR (ua2.created_at = ua1.created_at AND ua2.id < ua1.id))
);

-- Then, ensure user_id has a unique constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'user_id_unique'
  ) THEN
    ALTER TABLE public.user_accounts
    ADD CONSTRAINT user_id_unique UNIQUE (user_id);
  END IF;
END $$;

-- Function to create user_accounts record
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_accounts (
    user_id,
    email,
    account_number,  -- Generate unique account number
    country_code,  -- Let user select country first
    status,
    created_at,
    updated_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    'ICAN-' || TO_CHAR(NOW(), 'YYYYMMDDHH24MISS') || '-' || SUBSTRING(NEW.id::text, 1, 8),  -- Unique account number
    NULL,  -- User must select country on first login
    'active',  -- Account is active
    NOW(),
    NOW()
  )
  ON CONFLICT (user_id) DO NOTHING;  -- Skip if already exists
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Create trigger to run when new user is created in auth.users
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Also create records for existing users without user_accounts
-- (allows them to select country on next login)
INSERT INTO public.user_accounts (user_id, email, account_number, country_code, status, created_at, updated_at)
SELECT 
  u.id,
  u.email,
  'ICAN-' || TO_CHAR(NOW(), 'YYYYMMDDHH24MISS') || '-' || SUBSTRING(u.id::text, 1, 8),
  NULL,  -- User will select country on login
  'active',  -- Account is active
  NOW(),
  NOW()
FROM auth.users u
LEFT JOIN user_accounts ua ON u.id = ua.user_id
WHERE ua.user_id IS NULL  -- Only for users without a user_accounts record
ON CONFLICT (user_id) DO NOTHING;

SELECT '✅ Auto-create user_accounts trigger installed' as result;
SELECT 'New users signing up will automatically get a user_accounts record' as info;

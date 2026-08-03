-- Pichin business operating structure and shareholder limits.
ALTER TABLE IF EXISTS public.business_profiles
  ADD COLUMN IF NOT EXISTS business_structure TEXT NOT NULL DEFAULT 'organisation';

DO $$
BEGIN
  IF to_regclass('public.business_profiles') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.business_profiles'::regclass
        AND conname = 'business_profiles_structure_check'
    ) THEN
    ALTER TABLE public.business_profiles
      ADD CONSTRAINT business_profiles_structure_check
      CHECK (business_structure IN ('sole_proprietorship', 'organisation', 'enterprise'));
  END IF;
END $$;

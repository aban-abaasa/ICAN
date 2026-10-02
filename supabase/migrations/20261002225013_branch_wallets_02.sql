CREATE TABLE IF NOT EXISTS public.branch_wallet_allowances (
  child_business_profile_id  UUID PRIMARY KEY REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  parent_business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  enabled           BOOLEAN NOT NULL DEFAULT TRUE,
  mode              TEXT NOT NULL DEFAULT 'top_up' CHECK (mode IN ('top_up', 'fixed')),
  amount_ican       NUMERIC(18, 8) CHECK (amount_ican IS NULL OR amount_ican > 0),   -- fixed mode
  float_target_ican NUMERIC(18, 8) CHECK (float_target_ican IS NULL OR float_target_ican > 0),  -- top_up mode
  period            TEXT NOT NULL DEFAULT 'monthly' CHECK (period IN ('weekly', 'monthly')),
  sweep_above_ican  NUMERIC(18, 8) CHECK (sweep_above_ican IS NULL OR sweep_above_ican > 0),
  next_run_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_run_at       TIMESTAMPTZ,
  created_by        UUID NOT NULL,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((mode = 'fixed' AND amount_ican IS NOT NULL) OR (mode = 'top_up' AND float_target_ican IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS public.branch_wallet_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id UUID NOT NULL,
  event               TEXT NOT NULL,
  actor_id            UUID,
  actor_email         TEXT,
  details             JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bwe_business ON public.branch_wallet_events(business_profile_id, created_at DESC);
CREATE OR REPLACE FUNCTION public._bwe_append_only()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'branch_wallet_events is append-only';
END;
$$;
CREATE TRIGGER trg_bwe_append_only BEFORE UPDATE OR DELETE ON public.branch_wallet_events
  FOR EACH ROW EXECUTE FUNCTION public._bwe_append_only();

CREATE TABLE IF NOT EXISTS public.business_ownership_links (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  child_business_profile_id  UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  relationship               TEXT NOT NULL DEFAULT 'branch'
                             CHECK (relationship IN ('branch', 'subsidiary', 'franchise', 'joint_venture')),
  ownership_percent          NUMERIC(6, 3) NOT NULL DEFAULT 100
                             CHECK (ownership_percent > 0 AND ownership_percent <= 100),
  cmms_access_level          TEXT NOT NULL DEFAULT 'summary'
                             CHECK (cmms_access_level IN ('none', 'summary', 'full')),
  wallet_control             TEXT NOT NULL DEFAULT 'none'
                             CHECK (wallet_control IN ('none', 'view', 'govern')),
  status                     TEXT NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'active', 'declined', 'ended')),
  proposed_by                UUID,
  responded_by               UUID,
  effective_from             DATE,
  ended_at                   TIMESTAMPTZ,
  ended_by                   UUID,
  notes                      TEXT,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (parent_business_profile_id <> child_business_profile_id)
);
ALTER TABLE public.business_ownership_links ADD COLUMN IF NOT EXISTS wallet_control TEXT NOT NULL DEFAULT 'none'
  CHECK (wallet_control IN ('none', 'view', 'govern'));
CREATE UNIQUE INDEX IF NOT EXISTS uq_business_ownership_one_live_parent
  ON public.business_ownership_links(child_business_profile_id) WHERE status IN ('pending', 'active');
CREATE INDEX IF NOT EXISTS idx_business_ownership_parent
  ON public.business_ownership_links(parent_business_profile_id, status);
CREATE TABLE IF NOT EXISTS public.business_ownership_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id     UUID REFERENCES public.business_ownership_links(id) ON DELETE CASCADE,
  parent_business_profile_id UUID,
  child_business_profile_id  UUID,
  event       TEXT NOT NULL,
  actor_id    UUID,
  actor_email TEXT,
  details     JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_business_ownership_events_link ON public.business_ownership_events(link_id, created_at);
CREATE OR REPLACE FUNCTION public._boe_append_only()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN RETURN OLD; END IF;  -- cascade from a deleted business
  RAISE EXCEPTION 'business_ownership_events is append-only';
END;
$$;
CREATE TRIGGER trg_boe_append_only BEFORE UPDATE OR DELETE ON public.business_ownership_events
  FOR EACH ROW EXECUTE FUNCTION public._boe_append_only();

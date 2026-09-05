-- Expands the "My Resume / Portfolio" feature so the public /portfolio/<handle>
-- page can render a full resume (contact line, professional summary, core
-- competencies, technical experience & entrepreneurship, research &
-- innovation, education, presentations & competitions, references) instead
-- of just a headline/summary/skills + one flat timeline.
--
-- Builds on CREATE_USER_PORTFOLIO_SCHEMA.sql, CREATE_PORTFOLIO_RATINGS_VERIFICATION.sql
-- and FIX_PORTFOLIO_PROFILES_TABLE_MISMATCH.sql — run this after those three.
-- Idempotent: safe to run more than once.

-- ── 1. Contact line fields on user_portfolios (opt-in, public only when the
--       portfolio itself is public — separate from the account's private
--       auth email/phone) ───────────────────────────────────────────────────
ALTER TABLE public.user_portfolios
  ADD COLUMN IF NOT EXISTS location VARCHAR(120),
  ADD COLUMN IF NOT EXISTS phone VARCHAR(50),
  ADD COLUMN IF NOT EXISTS contact_email VARCHAR(255);

-- ── 2. New item_type categories for the timeline ────────────────────────────
ALTER TABLE public.user_portfolio_items DROP CONSTRAINT IF EXISTS user_portfolio_items_item_type_check;
ALTER TABLE public.user_portfolio_items
  ADD CONSTRAINT user_portfolio_items_item_type_check
  CHECK (item_type IN ('experience', 'achievement', 'project', 'education', 'entrepreneurship', 'research', 'presentation'));

-- ── 3. References ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.portfolio_references (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  title VARCHAR(200),
  organization VARCHAR(200),
  email VARCHAR(255),
  phone VARCHAR(50),
  display_order INT NOT NULL DEFAULT 0,
  is_public BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_portfolio_references_user_id ON public.portfolio_references(user_id);

CREATE OR REPLACE FUNCTION public.update_portfolio_references_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_portfolio_references_updated_at ON public.portfolio_references;
CREATE TRIGGER trigger_update_portfolio_references_updated_at
  BEFORE UPDATE ON public.portfolio_references
  FOR EACH ROW
  EXECUTE FUNCTION public.update_portfolio_references_updated_at();

ALTER TABLE public.portfolio_references ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "portfolio_references_owner_all" ON public.portfolio_references;
CREATE POLICY "portfolio_references_owner_all" ON public.portfolio_references
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "portfolio_references_public_read" ON public.portfolio_references;
CREATE POLICY "portfolio_references_public_read" ON public.portfolio_references
  FOR SELECT TO anon, authenticated
  USING (is_public = true);

NOTIFY pgrst, 'reload schema';

SELECT 'Portfolio resume fields (contact line, new item types, references) added' AS status;

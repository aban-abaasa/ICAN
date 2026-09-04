-- My Resume / Portfolio feature — schema + RLS.
--
-- Adds a public-facing resume/portfolio per user, backing the new "My Resume"
-- tab in ProfilePage.jsx and the public share page at /portfolio/<handle>.
-- Two sources feed the timeline: 'manual' rows the user types themselves, and
-- 'cmms' rows auto-synced from cmms_user_roles for users who are members of a
-- CMMS company (see portfolioService.syncCmmsPortfolioItems on the frontend).
--
-- Idempotent: safe to run more than once (mirrors the style of
-- CMMS_FIX_LANDING_MESSAGES_REPLY_RLS.sql).

-- ── Public handle for the share URL (icanera app /portfolio/<handle>) ──────
ALTER TABLE public.ican_user_profiles
  ADD COLUMN IF NOT EXISTS handle VARCHAR(60) UNIQUE;

-- ── user_portfolios: one editable resume/portfolio profile per user ────────
CREATE TABLE IF NOT EXISTS public.user_portfolios (
  user_id UUID PRIMARY KEY REFERENCES public.ican_user_profiles(id) ON DELETE CASCADE,
  headline VARCHAR(160),
  summary TEXT,
  skills TEXT[] DEFAULT '{}',
  links JSONB DEFAULT '{}'::jsonb,
  is_public BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.update_user_portfolios_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_user_portfolios_updated_at ON public.user_portfolios;
CREATE TRIGGER trigger_update_user_portfolios_updated_at
  BEFORE UPDATE ON public.user_portfolios
  FOR EACH ROW
  EXECUTE FUNCTION public.update_user_portfolios_updated_at();

-- ── user_portfolio_items: timeline entries (manual or CMMS-synced) ─────────
CREATE TABLE IF NOT EXISTS public.user_portfolio_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.ican_user_profiles(id) ON DELETE CASCADE,
  source VARCHAR(10) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'cmms')),
  item_type VARCHAR(20) NOT NULL DEFAULT 'experience' CHECK (item_type IN ('experience', 'achievement', 'project', 'education')),
  title VARCHAR(200) NOT NULL,
  org_name VARCHAR(200),
  description TEXT,
  start_date DATE,
  end_date DATE,
  metadata JSONB DEFAULT '{}'::jsonb,
  is_public BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_portfolio_items_user_id ON public.user_portfolio_items(user_id);

-- CMMS-synced rows are deduped in application code (portfolioService.js reads
-- existing 'cmms' rows for the user and updates-or-inserts by matching
-- metadata.cmms_company_id/cmms_role_id) rather than via a DB constraint,
-- since Postgres unique indexes can't target jsonb->> expressions through
-- PostgREST's upsert(onConflict:) column-list syntax.

CREATE OR REPLACE FUNCTION public.update_user_portfolio_items_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_user_portfolio_items_updated_at ON public.user_portfolio_items;
CREATE TRIGGER trigger_update_user_portfolio_items_updated_at
  BEFORE UPDATE ON public.user_portfolio_items
  FOR EACH ROW
  EXECUTE FUNCTION public.update_user_portfolio_items_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.user_portfolios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_portfolio_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_portfolios_owner_all" ON public.user_portfolios;
CREATE POLICY "user_portfolios_owner_all" ON public.user_portfolios
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_portfolios_public_read" ON public.user_portfolios;
CREATE POLICY "user_portfolios_public_read" ON public.user_portfolios
  FOR SELECT TO anon, authenticated
  USING (is_public = true);

DROP POLICY IF EXISTS "user_portfolio_items_owner_all" ON public.user_portfolio_items;
CREATE POLICY "user_portfolio_items_owner_all" ON public.user_portfolio_items
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_portfolio_items_public_read" ON public.user_portfolio_items;
CREATE POLICY "user_portfolio_items_public_read" ON public.user_portfolio_items
  FOR SELECT TO anon, authenticated
  USING (is_public = true);

-- A public profile lookup by handle needs to read the handle/name/avatar too.
DROP POLICY IF EXISTS "ican_user_profiles_public_handle_read" ON public.ican_user_profiles;
CREATE POLICY "ican_user_profiles_public_handle_read" ON public.ican_user_profiles
  FOR SELECT TO anon, authenticated
  USING (handle IS NOT NULL);

NOTIFY pgrst, 'reload schema';

SELECT 'user_portfolios / user_portfolio_items created with public-read RLS' AS status;

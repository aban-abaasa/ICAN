-- ============================================================================
-- Readiness (Global Navigator): a real, saved compliance checklist, plus the
-- Google public-data source and Google Forms / Drive links that go with it.
-- ============================================================================
-- Additive only: three new tables. Nothing existing is touched.
--
--   ican_readiness_settings   the user's country + mode (SE salaried / BO business owner),
--                             an optional published Google Sheet that supplies extra public
--                             requirements, and the last computed compliance percentage
--   ican_readiness_progress   one row per checklist item the user has started or finished
--                             (the requirement text itself lives in the app / the Sheet)
--   ican_readiness_links      Google Forms and Drive files the user connects, optionally
--                             attached to a checklist item as evidence
--
-- Links are restricted AT THE DATABASE to Google's own hosts, over https, so a stored
-- link can never point somewhere else, whatever the client sends.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ican_readiness_settings (
  user_id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  country            TEXT        NOT NULL DEFAULT 'Uganda' CHECK (char_length(country) BETWEEN 2 AND 60),
  mode               TEXT        NOT NULL DEFAULT 'SE' CHECK (mode IN ('SE', 'BO')),
  sheet_url          TEXT        CHECK (sheet_url IS NULL OR
                                        (char_length(sheet_url) <= 2048 AND sheet_url ~* '^https://docs\.google\.com/spreadsheets/d/')),
  sheet_synced_at    TIMESTAMPTZ,
  sheet_item_count   INTEGER     CHECK (sheet_item_count IS NULL OR sheet_item_count >= 0),
  compliance_percent NUMERIC(5,2) CHECK (compliance_percent IS NULL OR compliance_percent BETWEEN 0 AND 100),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ican_readiness_progress (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  country    TEXT        NOT NULL CHECK (char_length(country) BETWEEN 2 AND 60),
  mode       TEXT        NOT NULL CHECK (mode IN ('SE', 'BO')),
  item_key   TEXT        NOT NULL CHECK (char_length(item_key) BETWEEN 1 AND 120),
  status     TEXT        NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done')),
  note       TEXT        CHECK (note IS NULL OR char_length(note) <= 500),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, country, mode, item_key)
);

CREATE TABLE IF NOT EXISTS public.ican_readiness_links (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind       TEXT        NOT NULL CHECK (kind IN ('form', 'drive_file', 'drive_folder', 'doc', 'sheet', 'slides')),
  title      TEXT        NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  url        TEXT        NOT NULL CHECK (char_length(url) <= 2048
                                         AND url ~* '^https://(docs\.google\.com|drive\.google\.com|forms\.gle)/'),
  country    TEXT        CHECK (country IS NULL OR char_length(country) BETWEEN 2 AND 60),
  mode       TEXT        CHECK (mode IS NULL OR mode IN ('SE', 'BO')),
  item_key   TEXT        CHECK (item_key IS NULL OR char_length(item_key) BETWEEN 1 AND 120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_readiness_progress_user ON public.ican_readiness_progress (user_id, country, mode);
CREATE INDEX IF NOT EXISTS idx_readiness_links_user    ON public.ican_readiness_links (user_id, created_at DESC);

-- updated_at upkeep ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ican_readiness_touch()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_readiness_settings_touch ON public.ican_readiness_settings;
CREATE TRIGGER trg_readiness_settings_touch BEFORE UPDATE ON public.ican_readiness_settings
  FOR EACH ROW EXECUTE FUNCTION public.ican_readiness_touch();
DROP TRIGGER IF EXISTS trg_readiness_progress_touch ON public.ican_readiness_progress;
CREATE TRIGGER trg_readiness_progress_touch BEFORE UPDATE ON public.ican_readiness_progress
  FOR EACH ROW EXECUTE FUNCTION public.ican_readiness_touch();

-- Row level security: a user sees and changes only their own rows --------------------
ALTER TABLE public.ican_readiness_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ican_readiness_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ican_readiness_links    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS readiness_settings_own ON public.ican_readiness_settings;
CREATE POLICY readiness_settings_own ON public.ican_readiness_settings
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS readiness_progress_own ON public.ican_readiness_progress;
CREATE POLICY readiness_progress_own ON public.ican_readiness_progress
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS readiness_links_own ON public.ican_readiness_links;
CREATE POLICY readiness_links_own ON public.ican_readiness_links
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

REVOKE ALL ON public.ican_readiness_settings FROM anon, authenticated;
REVOKE ALL ON public.ican_readiness_progress FROM anon, authenticated;
REVOKE ALL ON public.ican_readiness_links    FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.ican_readiness_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ican_readiness_progress TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.ican_readiness_links TO authenticated;

NOTIFY pgrst, 'reload schema';

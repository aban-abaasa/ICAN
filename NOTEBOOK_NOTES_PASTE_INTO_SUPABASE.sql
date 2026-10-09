-- ============================================================
-- Notebook (My Resume > Notebook): typed or dictated notes and meeting minutes
--
-- Each note belongs to one signed-in user and only that user can read or change it.
-- The app keeps notes on the device first and syncs them here, so they follow the person to
-- another phone or browser. Deleting a note sets deleted_at (instead of removing the row) so a
-- second device learns the note was deleted.
--
-- Paste into the Supabase SQL editor and run. Safe to run more than once.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.user_notebook_notes (
  id          UUID PRIMARY KEY,                       -- made on the device, so notes can be written offline
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL DEFAULT 'note' CHECK (kind IN ('note', 'minutes')),
  title       TEXT NOT NULL DEFAULT '' CHECK (char_length(title) <= 300),
  body        TEXT NOT NULL DEFAULT '' CHECK (char_length(body) <= 200000),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),     -- the app keeps the newer copy when two devices disagree
  deleted_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS user_notebook_notes_user_idx
  ON public.user_notebook_notes (user_id, updated_at DESC);

ALTER TABLE public.user_notebook_notes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.user_notebook_notes FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_notebook_notes TO authenticated;

DROP POLICY IF EXISTS "notebook_select_own" ON public.user_notebook_notes;
CREATE POLICY "notebook_select_own" ON public.user_notebook_notes
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "notebook_insert_own" ON public.user_notebook_notes;
CREATE POLICY "notebook_insert_own" ON public.user_notebook_notes
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "notebook_update_own" ON public.user_notebook_notes;
CREATE POLICY "notebook_update_own" ON public.user_notebook_notes
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "notebook_delete_own" ON public.user_notebook_notes;
CREATE POLICY "notebook_delete_own" ON public.user_notebook_notes
  FOR DELETE TO authenticated USING (user_id = auth.uid());

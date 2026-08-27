-- ================================================================
-- Fix: PostgREST can't find the pending_edits <-> member_approvals relationship
-- ================================================================
-- Symptom (browser console / memberApprovalService.getPendingEdits):
--   GET .../pending_edits?select=...,member_approvals(...)  -> 400 Bad Request
--   PGRST200: Could not find a relationship between 'pending_edits' and
--   'member_approvals' in the schema cache
--
-- Root cause on this environment: member_approvals doesn't exist at all
-- (confirmed by "relation public.member_approvals does not exist" when
-- trying to add a FK/index on it). pending_edits does exist. This matches
-- NUCLEAR_DELETE_VIEWS_AND_TABLES.sql / NUCLEAR_DELETE_ALL_TABLES.sql,
-- which DROP TABLE member_approvals CASCADE without dropping pending_edits
-- -- so a nuclear-delete run at some point removed member_approvals and
-- nothing recreated it since.
--
-- This script recreates member_approvals (schema matches
-- APPROVAL_SYSTEM_SCHEMA.sql / what memberApprovalService.js selects:
-- id, member_id, member_email, status, comment, responded_at), wires the
-- FK to pending_edits.id so PostgREST can embed it, and reloads
-- PostgREST's schema cache. Safe to re-run.
-- ================================================================

DO $$
BEGIN
  IF to_regclass('public.pending_edits') IS NULL THEN
    RAISE EXCEPTION 'public.pending_edits does not exist -- run APPROVAL_SYSTEM_SCHEMA.sql first.';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.member_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pending_edit_id UUID NOT NULL REFERENCES public.pending_edits(id) ON DELETE CASCADE,

  member_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  member_email VARCHAR(255) NOT NULL,
  member_name VARCHAR(255),

  status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
  comment TEXT,
  responded_at TIMESTAMP WITH TIME ZONE,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- In case the table already existed without the FK (rather than missing
-- entirely), make sure pending_edit_id is actually linked to pending_edits
DO $$
DECLARE
  r RECORD;
  has_fk BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.member_approvals'::regclass
      AND contype = 'f'
      AND confrelid = 'public.pending_edits'::regclass
  ) INTO has_fk;

  IF NOT has_fk THEN
    FOR r IN
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'public.member_approvals'::regclass
        AND contype = 'f'
        AND pg_get_constraintdef(oid) ILIKE '%pending_edit_id%'
    LOOP
      EXECUTE format('ALTER TABLE public.member_approvals DROP CONSTRAINT %I', r.conname);
    END LOOP;

    ALTER TABLE public.member_approvals
      ADD CONSTRAINT member_approvals_pending_edit_id_fkey
      FOREIGN KEY (pending_edit_id) REFERENCES public.pending_edits(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ma_pending_edit_id ON public.member_approvals(pending_edit_id);
CREATE INDEX IF NOT EXISTS idx_ma_member_id ON public.member_approvals(member_id);
CREATE INDEX IF NOT EXISTS idx_ma_status ON public.member_approvals(status);

ALTER TABLE public.member_approvals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ma_all" ON public.member_approvals;
CREATE POLICY "ma_all"
  ON public.member_approvals
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- PostgREST caches the schema (including FK relationships) in memory.
-- Creating the table/constraint above doesn't take effect for the REST
-- API until the cache is reloaded.
NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE 'member_approvals recreated/fixed and PostgREST schema cache reload requested.';
END $$;

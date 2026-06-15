-- =========================================================
-- ICAN Status Features Setup
-- - Text/image/video statuses
-- - Status comments
-- - View tracking
-- - 24-hour expiry
-- - RLS policies for broad status visibility
-- =========================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------
-- 1) Status table
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ican_statuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  media_type TEXT NOT NULL CHECK (media_type IN ('image', 'video', 'text')),
  media_url TEXT,
  caption TEXT,
  background_color VARCHAR(7),
  text_color VARCHAR(7) DEFAULT '#FFFFFF',
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'followers', 'private')),
  view_count INTEGER NOT NULL DEFAULT 0,
  reaction_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  file_hash TEXT,
  blockchain_hash TEXT,
  blockchain_verified BOOLEAN DEFAULT FALSE,
  smart_contract_id TEXT,
  smart_contract_verified BOOLEAN DEFAULT FALSE,
  blockchain_tx_hash TEXT,
  blockchain_chain TEXT DEFAULT 'ethereum',
  verified_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ican_statuses_user_id ON public.ican_statuses(user_id);
CREATE INDEX IF NOT EXISTS idx_ican_statuses_expires_at ON public.ican_statuses(expires_at);
CREATE INDEX IF NOT EXISTS idx_ican_statuses_created_at ON public.ican_statuses(created_at DESC);

ALTER TABLE public.ican_statuses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view public statuses" ON public.ican_statuses;
DROP POLICY IF EXISTS "Users can create their own statuses" ON public.ican_statuses;
DROP POLICY IF EXISTS "Users can update their own statuses" ON public.ican_statuses;
DROP POLICY IF EXISTS "Users can delete their own statuses" ON public.ican_statuses;
DROP POLICY IF EXISTS "status_select_any_user" ON public.ican_statuses;
DROP POLICY IF EXISTS "status_insert_own" ON public.ican_statuses;
DROP POLICY IF EXISTS "status_update_own" ON public.ican_statuses;
DROP POLICY IF EXISTS "status_delete_own" ON public.ican_statuses;

-- Any user can read public/followers statuses; owners can read private own statuses.
CREATE POLICY "status_select_any_user"
ON public.ican_statuses
FOR SELECT
USING (
  visibility IN ('public', 'followers')
  OR user_id = auth.uid()
);

CREATE POLICY "status_insert_own"
ON public.ican_statuses
FOR INSERT
WITH CHECK (user_id = auth.uid());

CREATE POLICY "status_update_own"
ON public.ican_statuses
FOR UPDATE
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "status_delete_own"
ON public.ican_statuses
FOR DELETE
USING (user_id = auth.uid());

GRANT SELECT ON public.ican_statuses TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.ican_statuses TO authenticated;

-- ---------------------------------------------------------
-- 2) Status views table
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ican_status_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status_id UUID NOT NULL REFERENCES public.ican_statuses(id) ON DELETE CASCADE,
  viewed_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(status_id, viewed_by)
);

CREATE INDEX IF NOT EXISTS idx_ican_status_views_status_id ON public.ican_status_views(status_id);
CREATE INDEX IF NOT EXISTS idx_ican_status_views_viewed_by ON public.ican_status_views(viewed_by);

ALTER TABLE public.ican_status_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view status view records for their statuses" ON public.ican_status_views;
DROP POLICY IF EXISTS "Users can insert status view records" ON public.ican_status_views;
DROP POLICY IF EXISTS "status_views_select_owner_or_viewer" ON public.ican_status_views;
DROP POLICY IF EXISTS "status_views_insert_authenticated" ON public.ican_status_views;

CREATE POLICY "status_views_select_owner_or_viewer"
ON public.ican_status_views
FOR SELECT
USING (
  viewed_by = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.ican_statuses s
    WHERE s.id = status_id
      AND s.user_id = auth.uid()
  )
);

CREATE POLICY "status_views_insert_authenticated"
ON public.ican_status_views
FOR INSERT
WITH CHECK (viewed_by = auth.uid());

GRANT SELECT, INSERT ON public.ican_status_views TO authenticated;

CREATE OR REPLACE FUNCTION public.increment_status_view_count()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.ican_statuses
  SET view_count = COALESCE(view_count, 0) + 1
  WHERE id = NEW.status_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_increment_status_views ON public.ican_status_views;
CREATE TRIGGER trigger_increment_status_views
AFTER INSERT ON public.ican_status_views
FOR EACH ROW
EXECUTE FUNCTION public.increment_status_view_count();

-- ---------------------------------------------------------
-- 3) Status comments/messages table
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ican_status_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status_id UUID NOT NULL REFERENCES public.ican_statuses(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ican_status_messages_status_id ON public.ican_status_messages(status_id);
CREATE INDEX IF NOT EXISTS idx_ican_status_messages_sender_id ON public.ican_status_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_ican_status_messages_created_at ON public.ican_status_messages(created_at DESC);

ALTER TABLE public.ican_status_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read status messages" ON public.ican_status_messages;
DROP POLICY IF EXISTS "Allow insert own status messages" ON public.ican_status_messages;
DROP POLICY IF EXISTS "Allow delete own status messages" ON public.ican_status_messages;
DROP POLICY IF EXISTS "Allow update own status messages" ON public.ican_status_messages;
DROP POLICY IF EXISTS "status_messages_select_any" ON public.ican_status_messages;
DROP POLICY IF EXISTS "status_messages_insert_own" ON public.ican_status_messages;
DROP POLICY IF EXISTS "status_messages_update_own" ON public.ican_status_messages;
DROP POLICY IF EXISTS "status_messages_delete_own" ON public.ican_status_messages;

CREATE POLICY "status_messages_select_any"
ON public.ican_status_messages
FOR SELECT
USING (true);

CREATE POLICY "status_messages_insert_own"
ON public.ican_status_messages
FOR INSERT
WITH CHECK (sender_id = auth.uid());

CREATE POLICY "status_messages_update_own"
ON public.ican_status_messages
FOR UPDATE
USING (sender_id = auth.uid())
WITH CHECK (sender_id = auth.uid());

CREATE POLICY "status_messages_delete_own"
ON public.ican_status_messages
FOR DELETE
USING (sender_id = auth.uid());

GRANT SELECT ON public.ican_status_messages TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.ican_status_messages TO authenticated;

CREATE OR REPLACE FUNCTION public.update_ican_status_messages_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_ican_status_messages_updated_at_trigger ON public.ican_status_messages;
CREATE TRIGGER update_ican_status_messages_updated_at_trigger
BEFORE UPDATE ON public.ican_status_messages
FOR EACH ROW
EXECUTE FUNCTION public.update_ican_status_messages_updated_at();

-- ---------------------------------------------------------
-- 4) Expiry cleanup function
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cleanup_expired_statuses()
RETURNS TABLE(deleted_count INTEGER)
LANGUAGE plpgsql
AS $$
DECLARE
  v_deleted INTEGER := 0;
BEGIN
  DELETE FROM public.ican_statuses
  WHERE expires_at <= NOW();

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN QUERY SELECT v_deleted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cleanup_expired_statuses() TO anon, authenticated;

-- Optional: run once now
SELECT * FROM public.cleanup_expired_statuses();


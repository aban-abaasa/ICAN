-- =============================================
-- CREATE GROUP MESSAGES TABLE
-- =============================================

-- Drop and recreate to ensure clean state
DROP TABLE IF EXISTS public.group_messages CASCADE;

CREATE TABLE public.group_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.trust_groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  user_email TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================
-- INDEXES
-- =============================================
CREATE INDEX idx_messages_group_id ON public.group_messages(group_id);
CREATE INDEX idx_messages_user_id ON public.group_messages(user_id);
CREATE INDEX idx_messages_created_at ON public.group_messages(created_at);

-- =============================================
-- ROW LEVEL SECURITY
-- =============================================

-- Enable RLS
ALTER TABLE public.group_messages ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Group members can view messages" ON public.group_messages;
DROP POLICY IF EXISTS "Users can send messages" ON public.group_messages;

-- Messages: Group members can view messages
CREATE POLICY "Group members can view messages" ON public.group_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.trust_group_members tgm
      WHERE tgm.group_id = public.group_messages.group_id
      AND tgm.user_id = auth.uid()
      AND tgm.is_active = true
    )
    OR
    EXISTS (
      SELECT 1 FROM public.trust_groups tg
      WHERE tg.id = public.group_messages.group_id
      AND tg.creator_id = auth.uid()
    )
  );

-- Users can send messages if they're members or admins
CREATE POLICY "Users can send messages" ON public.group_messages
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND (
      EXISTS (
        SELECT 1 FROM public.trust_group_members tgm
        WHERE tgm.group_id = public.group_messages.group_id
        AND tgm.user_id = auth.uid()
        AND tgm.is_active = true
      )
      OR
      EXISTS (
        SELECT 1 FROM public.trust_groups tg
        WHERE tg.id = public.group_messages.group_id
        AND tg.creator_id = auth.uid()
      )
    )
  );

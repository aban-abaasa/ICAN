-- =============================================
-- CREATE LIVE MEETINGS TABLE
-- =============================================

CREATE TABLE IF NOT EXISTS public.live_meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL UNIQUE REFERENCES public.trust_groups(id) ON DELETE CASCADE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  started_by UUID NOT NULL REFERENCES auth.users(id),
  ended_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================
-- INDEXES
-- =============================================
CREATE INDEX IF NOT EXISTS idx_live_meetings_group_id ON public.live_meetings(group_id);
CREATE INDEX IF NOT EXISTS idx_live_meetings_is_active ON public.live_meetings(is_active);

-- =============================================
-- ROW LEVEL SECURITY
-- =============================================
ALTER TABLE public.live_meetings ENABLE ROW LEVEL SECURITY;

-- Group members can view active meetings
DROP POLICY IF EXISTS "Group members can view live meetings" ON public.live_meetings;
CREATE POLICY "Group members can view live meetings" ON public.live_meetings
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.trust_group_members tgm
      WHERE tgm.group_id = public.live_meetings.group_id
      AND tgm.user_id = auth.uid()
      AND tgm.is_active = true
    )
    OR
    EXISTS (
      SELECT 1 FROM public.trust_groups tg
      WHERE tg.id = public.live_meetings.group_id
      AND tg.creator_id = auth.uid()
    )
  );

-- Only group creator can start/manage meetings
DROP POLICY IF EXISTS "Only creators can manage meetings" ON public.live_meetings;
CREATE POLICY "Only creators can manage meetings" ON public.live_meetings
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.trust_groups tg
      WHERE tg.id = public.live_meetings.group_id
      AND tg.creator_id = auth.uid()
    )
  );

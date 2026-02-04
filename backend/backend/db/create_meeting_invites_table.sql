-- =============================================
-- CREATE MEETING INVITES TABLE
-- =============================================

CREATE TABLE IF NOT EXISTS public.meeting_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES public.live_meetings(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES public.trust_groups(id) ON DELETE CASCADE,
  invited_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invited_by UUID NOT NULL REFERENCES auth.users(id),
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
  responded_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(meeting_id, invited_user_id)
);

-- =============================================
-- INDEXES
-- =============================================
CREATE INDEX IF NOT EXISTS idx_invites_meeting_id ON public.meeting_invites(meeting_id);
CREATE INDEX IF NOT EXISTS idx_invites_user_id ON public.meeting_invites(invited_user_id);
CREATE INDEX IF NOT EXISTS idx_invites_status ON public.meeting_invites(status);
CREATE INDEX IF NOT EXISTS idx_invites_group_id ON public.meeting_invites(group_id);

-- =============================================
-- ROW LEVEL SECURITY
-- =============================================
ALTER TABLE public.meeting_invites ENABLE ROW LEVEL SECURITY;

-- Users can view their own invites
DROP POLICY IF EXISTS "Users can view own invites" ON public.meeting_invites;
CREATE POLICY "Users can view own invites" ON public.meeting_invites
  FOR SELECT USING (auth.uid() = invited_user_id);

-- Group creator can view all invites for their group
DROP POLICY IF EXISTS "Creators can view group invites" ON public.meeting_invites;
CREATE POLICY "Creators can view group invites" ON public.meeting_invites
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.trust_groups tg
      WHERE tg.id = public.meeting_invites.group_id
      AND tg.creator_id = auth.uid()
    )
  );

-- Only group creator can send invites
DROP POLICY IF EXISTS "Only creators can send invites" ON public.meeting_invites;
CREATE POLICY "Only creators can send invites" ON public.meeting_invites
  FOR INSERT WITH CHECK (
    auth.uid() = invited_by
    AND EXISTS (
      SELECT 1 FROM public.trust_groups tg
      WHERE tg.id = public.meeting_invites.group_id
      AND tg.creator_id = auth.uid()
    )
  );

-- Users can respond to their own invites
DROP POLICY IF EXISTS "Users can respond to invites" ON public.meeting_invites;
CREATE POLICY "Users can respond to invites" ON public.meeting_invites
  FOR UPDATE USING (auth.uid() = invited_user_id);

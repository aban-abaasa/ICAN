-- =============================================
-- PITCH INTERACTIONS SCHEMA
-- For likes and comments on pitches
-- =============================================

-- =============================================
-- PITCH LIKES TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS public.pitch_likes (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    pitch_id UUID NOT NULL REFERENCES public.pitches(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    user_email VARCHAR(255), -- Store email for anonymous users
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Ensure each user can only like once per pitch
    UNIQUE(pitch_id, user_id),
    UNIQUE(pitch_id, user_email)
);

-- =============================================
-- PITCH COMMENTS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS public.pitch_comments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    pitch_id UUID NOT NULL REFERENCES public.pitches(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    user_name VARCHAR(255) NOT NULL,
    user_email VARCHAR(255),
    comment_text TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- INDEXES
-- =============================================
CREATE INDEX IF NOT EXISTS idx_pitch_likes_pitch ON public.pitch_likes(pitch_id);
CREATE INDEX IF NOT EXISTS idx_pitch_likes_user ON public.pitch_likes(user_id);
CREATE INDEX IF NOT EXISTS idx_pitch_comments_pitch ON public.pitch_comments(pitch_id);
CREATE INDEX IF NOT EXISTS idx_pitch_comments_user ON public.pitch_comments(user_id);
CREATE INDEX IF NOT EXISTS idx_pitch_comments_created ON public.pitch_comments(created_at DESC);

-- =============================================
-- RLS POLICIES
-- =============================================

-- Enable RLS
ALTER TABLE public.pitch_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pitch_comments ENABLE ROW LEVEL SECURITY;

-- Likes Policies
DROP POLICY IF EXISTS "Anyone can view likes" ON public.pitch_likes;
DROP POLICY IF EXISTS "Users can like pitches" ON public.pitch_likes;
DROP POLICY IF EXISTS "Users can unlike pitches" ON public.pitch_likes;

-- Anyone can view likes
CREATE POLICY "Anyone can view likes" 
    ON public.pitch_likes FOR SELECT 
    USING (true);

-- Authenticated users can insert likes
CREATE POLICY "Users can like pitches" 
    ON public.pitch_likes FOR INSERT
    WITH CHECK (auth.uid() IS NOT NULL);

-- Users can delete their own likes
CREATE POLICY "Users can unlike pitches" 
    ON public.pitch_likes FOR DELETE
    USING (user_id = auth.uid());

-- Comments Policies
DROP POLICY IF EXISTS "Anyone can view comments" ON public.pitch_comments;
DROP POLICY IF EXISTS "Authenticated users can comment" ON public.pitch_comments;
DROP POLICY IF EXISTS "Users can edit own comments" ON public.pitch_comments;
DROP POLICY IF EXISTS "Users can delete own comments" ON public.pitch_comments;

-- Anyone can view comments
CREATE POLICY "Anyone can view comments" 
    ON public.pitch_comments FOR SELECT 
    USING (true);

-- Authenticated users can add comments
CREATE POLICY "Authenticated users can comment" 
    ON public.pitch_comments FOR INSERT
    WITH CHECK (auth.uid() IS NOT NULL);

-- Users can edit their own comments
CREATE POLICY "Users can edit own comments" 
    ON public.pitch_comments FOR UPDATE
    USING (user_id = auth.uid());

-- Users can delete their own comments
CREATE POLICY "Users can delete own comments" 
    ON public.pitch_comments FOR DELETE
    USING (user_id = auth.uid());

-- =============================================
-- HELPER FUNCTIONS
-- =============================================

-- Function to get likes count for a pitch
CREATE OR REPLACE FUNCTION public.get_pitch_likes_count(pitch_id UUID)
RETURNS INTEGER AS $$
BEGIN
  RETURN (SELECT COUNT(*) FROM public.pitch_likes WHERE pitch_likes.pitch_id = get_pitch_likes_count.pitch_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get comments count for a pitch
CREATE OR REPLACE FUNCTION public.get_pitch_comments_count(pitch_id UUID)
RETURNS INTEGER AS $$
BEGIN
  RETURN (SELECT COUNT(*) FROM public.pitch_comments WHERE pitch_comments.pitch_id = get_pitch_comments_count.pitch_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================
-- VERIFY
-- =============================================
SELECT '✅ Pitch Interactions Schema Created!' as status;
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' AND (table_name = 'pitch_likes' OR table_name = 'pitch_comments');

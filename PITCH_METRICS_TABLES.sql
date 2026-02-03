-- =============================================
-- PITCH METRICS TABLES FOR SUPABASE
-- Run this in Supabase SQL Editor
-- =============================================

-- 1. PITCH LIKES TABLE (if not exists)
CREATE TABLE IF NOT EXISTS pitch_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pitch_id UUID NOT NULL REFERENCES pitches(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Prevent duplicate likes
  UNIQUE(pitch_id, user_id)
);

-- Enable RLS
ALTER TABLE pitch_likes ENABLE ROW LEVEL SECURITY;

-- Policies for pitch_likes (drop if exists, then create)
DROP POLICY IF EXISTS "Anyone can view likes" ON pitch_likes;
DROP POLICY IF EXISTS "Authenticated users can like" ON pitch_likes;
DROP POLICY IF EXISTS "Users can unlike their own" ON pitch_likes;
CREATE POLICY "Anyone can view likes" ON pitch_likes FOR SELECT USING (true);
CREATE POLICY "Authenticated users can like" ON pitch_likes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can unlike their own" ON pitch_likes FOR DELETE USING (auth.uid() = user_id);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_pitch_likes_pitch_id ON pitch_likes(pitch_id);
CREATE INDEX IF NOT EXISTS idx_pitch_likes_user_id ON pitch_likes(user_id);

-- =============================================

-- 2. PITCH COMMENTS TABLE (if not exists)
CREATE TABLE IF NOT EXISTS pitch_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pitch_id UUID NOT NULL REFERENCES pitches(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_name TEXT,
  user_email TEXT,
  comment_text TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE pitch_comments ENABLE ROW LEVEL SECURITY;

-- Policies for pitch_comments (drop if exists, then create)
DROP POLICY IF EXISTS "Anyone can view comments" ON pitch_comments;
DROP POLICY IF EXISTS "Authenticated users can comment" ON pitch_comments;
DROP POLICY IF EXISTS "Users can edit their own comments" ON pitch_comments;
DROP POLICY IF EXISTS "Users can delete their own comments" ON pitch_comments;
CREATE POLICY "Anyone can view comments" ON pitch_comments FOR SELECT USING (true);
CREATE POLICY "Authenticated users can comment" ON pitch_comments FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can edit their own comments" ON pitch_comments FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own comments" ON pitch_comments FOR DELETE USING (auth.uid() = user_id);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_pitch_comments_pitch_id ON pitch_comments(pitch_id);
CREATE INDEX IF NOT EXISTS idx_pitch_comments_user_id ON pitch_comments(user_id);

-- =============================================

-- 3. PITCH SHARES TABLE (NEW)
CREATE TABLE IF NOT EXISTS pitch_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pitch_id UUID NOT NULL REFERENCES pitches(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL, -- Can be null for anonymous shares
  platform TEXT DEFAULT 'link', -- 'link', 'clipboard', 'native', 'twitter', 'facebook', 'whatsapp'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE pitch_shares ENABLE ROW LEVEL SECURITY;

-- Policies for pitch_shares (drop if exists, then create)
DROP POLICY IF EXISTS "Anyone can view shares" ON pitch_shares;
DROP POLICY IF EXISTS "Anyone can record a share" ON pitch_shares;
CREATE POLICY "Anyone can view shares" ON pitch_shares FOR SELECT USING (true);
CREATE POLICY "Anyone can record a share" ON pitch_shares FOR INSERT WITH CHECK (true);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_pitch_shares_pitch_id ON pitch_shares(pitch_id);

-- =============================================

-- 4. PITCH INVESTMENTS (Interest) TABLE (NEW)
CREATE TABLE IF NOT EXISTS pitch_investments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pitch_id UUID NOT NULL REFERENCES pitches(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount DECIMAL(15, 2), -- Optional: amount interested in investing
  status TEXT DEFAULT 'interested', -- 'interested', 'committed', 'completed', 'withdrawn'
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- One interest record per user per pitch
  UNIQUE(pitch_id, user_id)
);

-- Enable RLS
ALTER TABLE pitch_investments ENABLE ROW LEVEL SECURITY;

-- Policies for pitch_investments (drop if exists, then create)
DROP POLICY IF EXISTS "Anyone can view investment counts" ON pitch_investments;
DROP POLICY IF EXISTS "Authenticated users can show interest" ON pitch_investments;
DROP POLICY IF EXISTS "Users can update their own interest" ON pitch_investments;
DROP POLICY IF EXISTS "Users can withdraw their interest" ON pitch_investments;
CREATE POLICY "Anyone can view investment counts" ON pitch_investments FOR SELECT USING (true);
CREATE POLICY "Authenticated users can show interest" ON pitch_investments FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own interest" ON pitch_investments FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can withdraw their interest" ON pitch_investments FOR DELETE USING (auth.uid() = user_id);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_pitch_investments_pitch_id ON pitch_investments(pitch_id);
CREATE INDEX IF NOT EXISTS idx_pitch_investments_user_id ON pitch_investments(user_id);

-- =============================================

-- 5. ENABLE REALTIME FOR ALL TABLES
-- This allows the frontend to subscribe to live updates

-- Enable realtime for pitch_likes
ALTER PUBLICATION supabase_realtime ADD TABLE pitch_likes;

-- Enable realtime for pitch_comments
ALTER PUBLICATION supabase_realtime ADD TABLE pitch_comments;

-- Enable realtime for pitch_shares
ALTER PUBLICATION supabase_realtime ADD TABLE pitch_shares;

-- Enable realtime for pitch_investments
ALTER PUBLICATION supabase_realtime ADD TABLE pitch_investments;

-- =============================================

-- 6. ADD INVESTS_COUNT TO PITCHES TABLE (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pitches' AND column_name = 'invests_count'
  ) THEN
    ALTER TABLE pitches ADD COLUMN invests_count INTEGER DEFAULT 0;
  END IF;
END $$;

-- =============================================

-- 7. HELPER FUNCTION: Get all metrics for a pitch
CREATE OR REPLACE FUNCTION get_pitch_metrics(pitch_uuid UUID)
RETURNS TABLE (
  likes_count BIGINT,
  comments_count BIGINT,
  shares_count BIGINT,
  invests_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    (SELECT COUNT(*) FROM pitch_likes WHERE pitch_id = pitch_uuid) as likes_count,
    (SELECT COUNT(*) FROM pitch_comments WHERE pitch_id = pitch_uuid) as comments_count,
    (SELECT COUNT(*) FROM pitch_shares WHERE pitch_id = pitch_uuid) as shares_count,
    (SELECT COUNT(*) FROM pitch_investments WHERE pitch_id = pitch_uuid) as invests_count;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- DONE! All tables created with realtime enabled
-- =============================================

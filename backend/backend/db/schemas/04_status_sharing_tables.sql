-- =============================================
-- ICAN Status Sharing (WhatsApp-style)
-- Temporary posts that expire after 24 hours
-- =============================================

CREATE TABLE IF NOT EXISTS public.ican_statuses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    
    -- Status content
    media_type TEXT NOT NULL CHECK (media_type IN ('image', 'video', 'text')),
    media_url TEXT,
    caption TEXT,
    
    -- Display settings
    background_color VARCHAR(7), -- Hex color for text-only statuses
    text_color VARCHAR(7) DEFAULT '#FFFFFF',
    
    -- Visibility
    visibility TEXT DEFAULT 'public' CHECK (visibility IN ('public', 'followers', 'private')),
    viewers UUID[] DEFAULT '{}',
    
    -- Lifecycle
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '24 hours'),
    
    -- Analytics
    view_count INTEGER DEFAULT 0,
    reaction_count INTEGER DEFAULT 0,
    
    -- Blockchain (Immutability & Smart Contract Verification)
    file_hash TEXT, -- SHA-256 hash of uploaded file
    blockchain_hash TEXT, -- Hash stored on blockchain
    blockchain_verified BOOLEAN DEFAULT FALSE,
    smart_contract_id TEXT, -- Smart contract instance ID
    smart_contract_verified BOOLEAN DEFAULT FALSE,
    blockchain_tx_hash TEXT, -- Transaction hash from blockchain
    blockchain_chain TEXT DEFAULT 'ethereum', -- Chain identifier
    verified_at TIMESTAMP WITH TIME ZONE
);

-- Create indexes for query performance
CREATE INDEX IF NOT EXISTS idx_ican_statuses_user ON public.ican_statuses (user_id);
CREATE INDEX IF NOT EXISTS idx_ican_statuses_expires ON public.ican_statuses (expires_at);
CREATE INDEX IF NOT EXISTS idx_ican_statuses_active ON public.ican_statuses (user_id, expires_at DESC);

ALTER TABLE public.ican_statuses ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view public statuses"
    ON public.ican_statuses FOR SELECT
    USING (visibility = 'public' OR user_id = auth.uid() OR auth.uid() = ANY(viewers));

CREATE POLICY "Users can create their own statuses"
    ON public.ican_statuses FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own statuses"
    ON public.ican_statuses FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own statuses"
    ON public.ican_statuses FOR DELETE
    USING (auth.uid() = user_id);

-- Table for tracking status views (who viewed what)
CREATE TABLE IF NOT EXISTS public.ican_status_views (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status_id UUID REFERENCES public.ican_statuses(id) ON DELETE CASCADE NOT NULL,
    viewed_by UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    viewed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(status_id, viewed_by)
);

ALTER TABLE public.ican_status_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view status view records for their statuses"
    ON public.ican_status_views FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.ican_statuses 
            WHERE id = status_id AND user_id = auth.uid()
        )
        OR viewed_by = auth.uid()
    );

CREATE POLICY "Users can insert status view records"
    ON public.ican_status_views FOR INSERT
    WITH CHECK (viewed_by = auth.uid());

-- Trigger to auto-update view count
CREATE OR REPLACE FUNCTION public.increment_status_view_count()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.ican_statuses
    SET view_count = view_count + 1
    WHERE id = NEW.status_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_increment_status_views ON public.ican_status_views;
CREATE TRIGGER trigger_increment_status_views
    AFTER INSERT ON public.ican_status_views
    FOR EACH ROW
    EXECUTE FUNCTION public.increment_status_view_count();

-- Cleanup function: Delete expired statuses
CREATE OR REPLACE FUNCTION public.cleanup_expired_statuses()
RETURNS TABLE(deleted_count INTEGER) AS $$
DECLARE
    count INTEGER;
BEGIN
    DELETE FROM public.ican_statuses
    WHERE expires_at < NOW();
    
    GET DIAGNOSTICS count = ROW_COUNT;
    RETURN QUERY SELECT count;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ican_statuses TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.ican_status_views TO authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_statuses TO authenticated;

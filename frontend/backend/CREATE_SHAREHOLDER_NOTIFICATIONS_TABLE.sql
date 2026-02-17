-- ============================================================================
-- SHAREHOLDER NOTIFICATIONS TABLE
-- ============================================================================
-- PURPOSE: Track investment approval notifications sent to shareholders
--
-- WORKFLOW:
-- 1. Investor signs an investment agreement
-- 2. System creates shareholder_notifications for EACH shareholder
-- 3. Shareholders see "Approve" tab with pending count
-- 4. Shareholder slides to approve (sets read_at = NOW())
-- 5. When 60% approve, funds transfer to business account
--
-- KEY RELATIONSHIPS:
-- - business_profile_id → Links to business_profiles.id (which business)
-- - shareholder_id → Links to business_co_owners.id (who must approve)
-- - read_at: NULL = pending | timestamp = already approved
-- ============================================================================

-- Create shareholder_notifications table for investment approval tracking
CREATE TABLE IF NOT EXISTS public.shareholder_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Foreign Keys (DIRECT LINKING)
  business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,  -- Links to: which business needs approval
  shareholder_id UUID NOT NULL REFERENCES public.business_co_owners(id) ON DELETE CASCADE,      -- Links to: which shareholder (co-owner) must approve
  
  -- Shareholder Information (cached for display)
  shareholder_email VARCHAR(255),       -- Shareholder's email (from business_co_owners.owner_email)
  shareholder_name VARCHAR(255),        -- Shareholder's name (from business_co_owners.owner_name)
  
  -- Notification Details
  notification_type VARCHAR(50) NOT NULL DEFAULT 'approval_request',  -- Types: 'approval_request', 'investment_signed', 'investor_approval_request'
  notification_title VARCHAR(255),      -- Display title for shareholder
  notification_message TEXT,            -- Full message/details for shareholder
  
  -- Investor Information (who is requesting the approval)
  investor_name VARCHAR(255),           -- Investor's full name
  investor_email VARCHAR(255),          -- Investor's email
  
  -- Investment Details (what they're investing)
  investment_amount DECIMAL(15, 2) DEFAULT 0,       -- Amount being invested
  investment_currency VARCHAR(10) DEFAULT 'USD',    -- Currency code (UGX, USD, etc)
  investment_shares DECIMAL(10, 4) DEFAULT 0,       -- Number of shares being purchased
  
  -- Approval Tracking
  read_at TIMESTAMPTZ,  -- NULL = pending approval | timestamp = shareholder approved
  notification_sent_via VARCHAR(50) DEFAULT 'in_app',  -- 'in_app' or 'email'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for optimized queries
CREATE INDEX IF NOT EXISTS idx_shareholder_notifications_business_profile_id 
  ON public.shareholder_notifications(business_profile_id);

CREATE INDEX IF NOT EXISTS idx_shareholder_notifications_shareholder_id 
  ON public.shareholder_notifications(shareholder_id);

CREATE INDEX IF NOT EXISTS idx_shareholder_notifications_read_at 
  ON public.shareholder_notifications(read_at) 
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_shareholder_notifications_created_at 
  ON public.shareholder_notifications(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_shareholder_notifications_notification_type 
  ON public.shareholder_notifications(notification_type);

-- Enable RLS (Row Level Security)
ALTER TABLE public.shareholder_notifications ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for re-running this script)
DROP POLICY IF EXISTS shareholder_notifications_select_policy ON public.shareholder_notifications;
DROP POLICY IF EXISTS shareholder_notifications_insert_policy ON public.shareholder_notifications;
DROP POLICY IF EXISTS shareholder_notifications_update_policy ON public.shareholder_notifications;

-- RLS Policy: Shareholders can see their own notifications + Business owners can see their business's notifications
-- Allow shareholders to see notifications where they are the shareholder (shareholder_id = their user ID)
-- Allow business owners to see notifications for their own business (business_profile_id owner check)
CREATE POLICY shareholder_notifications_select_policy 
  ON public.shareholder_notifications 
  FOR SELECT 
  USING (
    -- Shareholder seeing their own notifications
    shareholder_id = auth.uid() OR 
    -- Business owner seeing notifications for their business
    business_profile_id IN (
      SELECT id FROM public.business_profiles 
      WHERE user_id = auth.uid()
    )
  );

-- RLS Policy: System/API can insert notifications (investor signing → notify shareholders)
CREATE POLICY shareholder_notifications_insert_policy 
  ON public.shareholder_notifications 
  FOR INSERT 
  WITH CHECK (true);

-- RLS Policy: Shareholders can update their own notifications (mark as read/approved)
-- Only a shareholder can approve their own notification
CREATE POLICY shareholder_notifications_update_policy 
  ON public.shareholder_notifications 
  FOR UPDATE 
  USING (shareholder_id = auth.uid())
  WITH CHECK (shareholder_id = auth.uid());

-- Create trigger for updated_at
DROP TRIGGER IF EXISTS shareholder_notifications_updated_at_trigger ON public.shareholder_notifications;
DROP FUNCTION IF EXISTS public.update_shareholder_notifications_updated_at();

CREATE OR REPLACE FUNCTION public.update_shareholder_notifications_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER shareholder_notifications_updated_at_trigger
BEFORE UPDATE ON public.shareholder_notifications
FOR EACH ROW
EXECUTE FUNCTION public.update_shareholder_notifications_updated_at();

-- ============================================
-- CMMS NOTIFICATIONS TABLE
-- ============================================
-- This table stores notifications for CMMS users
-- Triggers when a user is added, assigned a role, or completes tasks

CREATE TABLE IF NOT EXISTS public.cmms_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cmms_user_id UUID NOT NULL,
  cmms_company_id UUID NOT NULL,
  notification_type VARCHAR(50) NOT NULL,
  -- Types: user_added_to_cmms, role_assigned, task_assigned, task_completed, approval_needed, etc.
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  icon VARCHAR(10) DEFAULT '📬',
  action_link VARCHAR(255) DEFAULT NULL, -- Link to related page (e.g., /cmms/users)
  action_label VARCHAR(100) DEFAULT 'View', -- Label for the action button
  action_tab VARCHAR(50) DEFAULT NULL, -- Tab to navigate to (e.g., 'users', 'company', 'inventory')
  is_read BOOLEAN DEFAULT false,
  read_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Foreign keys
  CONSTRAINT fk_user FOREIGN KEY (cmms_user_id) REFERENCES cmms_users(id) ON DELETE CASCADE,
  CONSTRAINT fk_company FOREIGN KEY (cmms_company_id) REFERENCES cmms_company_profiles(id) ON DELETE CASCADE
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_cmms_notifications_user_id ON cmms_notifications(cmms_user_id);
CREATE INDEX IF NOT EXISTS idx_cmms_notifications_company_id ON cmms_notifications(cmms_company_id);
CREATE INDEX IF NOT EXISTS idx_cmms_notifications_is_read ON cmms_notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_cmms_notifications_created_at ON cmms_notifications(created_at DESC);

-- RLS Policies
ALTER TABLE public.cmms_notifications ENABLE ROW LEVEL SECURITY;

-- Users can see their own notifications
CREATE POLICY "Users can view their own notifications"
  ON cmms_notifications FOR SELECT
  USING (cmms_user_id IN (
    SELECT id FROM cmms_users WHERE email = auth.jwt() ->> 'email'
  ));

-- Users can mark their own notifications as read
CREATE POLICY "Users can update their own notifications"
  ON cmms_notifications FOR UPDATE
  USING (cmms_user_id IN (
    SELECT id FROM cmms_users WHERE email = auth.jwt() ->> 'email'
  ));

-- Admins can create notifications
CREATE POLICY "Admins can create notifications"
  ON cmms_notifications FOR INSERT
  WITH CHECK (cmms_company_id IN (
    SELECT cmms_company_id FROM cmms_users 
    WHERE email = auth.jwt() ->> 'email'
  ));

-- Log notification creation
CREATE TABLE IF NOT EXISTS public.cmms_notification_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id UUID NOT NULL REFERENCES cmms_notifications(id) ON DELETE CASCADE,
  action VARCHAR(50) NOT NULL, -- created, read, deleted
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- View: Unread notifications for users
CREATE OR REPLACE VIEW cmms_unread_notifications AS
  SELECT 
    n.id,
    n.cmms_user_id,
    n.cmms_company_id,
    n.notification_type,
    n.title,
    n.message,
    n.icon,
    n.created_at,
    u.full_name,
    u.email,
    cp.company_name
  FROM cmms_notifications n
  JOIN cmms_users u ON n.cmms_user_id = u.id
  JOIN cmms_company_profiles cp ON n.cmms_company_id = cp.id
  WHERE n.is_read = false
  ORDER BY n.created_at DESC;

-- Trigger to update updated_at on modifications
CREATE OR REPLACE FUNCTION update_cmms_notifications_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cmms_notifications_update_updated_at ON cmms_notifications;
CREATE TRIGGER cmms_notifications_update_updated_at
  BEFORE UPDATE ON cmms_notifications
  FOR EACH ROW
  EXECUTE FUNCTION update_cmms_notifications_updated_at();

-- Trigger to log notification actions in audit table
CREATE OR REPLACE FUNCTION log_notification_action()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO cmms_notification_audit (notification_id, action)
    VALUES (NEW.id, 'created');
  ELSIF TG_OP = 'UPDATE' AND NEW.is_read = true AND OLD.is_read = false THEN
    INSERT INTO cmms_notification_audit (notification_id, action)
    VALUES (NEW.id, 'read');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cmms_notification_audit_trigger ON cmms_notifications;
CREATE TRIGGER cmms_notification_audit_trigger
  AFTER INSERT OR UPDATE ON cmms_notifications
  FOR EACH ROW
  EXECUTE FUNCTION log_notification_action();

SELECT 'CMMS Notifications table created successfully!' as status;

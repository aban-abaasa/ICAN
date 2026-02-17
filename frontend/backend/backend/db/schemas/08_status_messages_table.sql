/**
 * Create ican_status_messages table for status message functionality
 * Run this migration in Supabase SQL editor
 */

-- Create status messages table
CREATE TABLE IF NOT EXISTS ican_status_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status_id UUID NOT NULL REFERENCES ican_statuses(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message_text TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_ican_status_messages_status_id 
  ON ican_status_messages(status_id);

CREATE INDEX IF NOT EXISTS idx_ican_status_messages_sender_id 
  ON ican_status_messages(sender_id);

CREATE INDEX IF NOT EXISTS idx_ican_status_messages_created_at 
  ON ican_status_messages(created_at);

-- Enable RLS
ALTER TABLE ican_status_messages ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can read status messages
CREATE POLICY "Allow read status messages" ON ican_status_messages
  FOR SELECT USING (true);

-- Policy: Users can insert their own messages
CREATE POLICY "Allow insert own status messages" ON ican_status_messages
  FOR INSERT WITH CHECK (sender_id = auth.uid());

-- Policy: Users can delete their own messages
CREATE POLICY "Allow delete own status messages" ON ican_status_messages
  FOR DELETE USING (sender_id = auth.uid());

-- Policy: Users can update their own messages
CREATE POLICY "Allow update own status messages" ON ican_status_messages
  FOR UPDATE USING (sender_id = auth.uid());

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_ican_status_messages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_ican_status_messages_updated_at_trigger 
  ON ican_status_messages;

CREATE TRIGGER update_ican_status_messages_updated_at_trigger
AFTER UPDATE ON ican_status_messages
FOR EACH ROW
EXECUTE FUNCTION update_ican_status_messages_updated_at();

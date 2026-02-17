/**
 * Create Blockchain Records Table for Trust (SACCO) Transactions
 * Stores immutable records of:
 * - Member joins
 * - Voting transactions
 * - Contributions
 * - Loan approvals
 * - All with cryptographic verification
 */

-- Create blockchain records table
CREATE TABLE IF NOT EXISTS ican_blockchain_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Reference to Trust/SACCO
  trust_id UUID NOT NULL REFERENCES ican_saccos(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  
  -- Record type (member_join, vote, contribution, loan_approval)
  record_type TEXT NOT NULL CHECK (record_type IN (
    'trust_member_join',
    'trust_vote',
    'trust_contribution',
    'trust_loan_approval'
  )),
  
  -- Transaction data (JSON for flexibility)
  record_data JSONB NOT NULL,
  
  -- Blockchain chain
  record_hash TEXT NOT NULL UNIQUE,
  previous_hash TEXT NOT NULL,
  
  -- Verification
  is_verified BOOLEAN DEFAULT FALSE,
  verification_count INT DEFAULT 0,
  last_verified_at TIMESTAMP WITH TIME ZONE,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_blockchain_trust ON ican_blockchain_records(trust_id);
CREATE INDEX IF NOT EXISTS idx_blockchain_user ON ican_blockchain_records(user_id);
CREATE INDEX IF NOT EXISTS idx_blockchain_type ON ican_blockchain_records(record_type);
CREATE INDEX IF NOT EXISTS idx_blockchain_hash ON ican_blockchain_records(record_hash);
CREATE INDEX IF NOT EXISTS idx_blockchain_verified ON ican_blockchain_records(is_verified);
CREATE INDEX IF NOT EXISTS idx_blockchain_created ON ican_blockchain_records(created_at);

-- Enable RLS
ALTER TABLE ican_blockchain_records ENABLE ROW LEVEL SECURITY;

-- Policy: Members can read blockchain records for their trust
CREATE POLICY "Members read trust blockchain" ON ican_blockchain_records
  FOR SELECT USING (
    trust_id IN (
      SELECT sacco_id FROM ican_sacco_members 
      WHERE user_id = auth.uid() AND status = 'approved'
    )
  );

-- Policy: Admin can read all blockchain records for their trust
CREATE POLICY "Admin reads all blockchain" ON ican_blockchain_records
  FOR SELECT USING (
    trust_id IN (
      SELECT id FROM ican_saccos WHERE admin_id = auth.uid()
    )
  );

-- Policy: Service can insert blockchain records
CREATE POLICY "Service inserts blockchain records" ON ican_blockchain_records
  FOR INSERT WITH CHECK (true);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_ican_blockchain_records_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_ican_blockchain_records_updated_at_trigger 
  ON ican_blockchain_records;

CREATE TRIGGER update_ican_blockchain_records_updated_at_trigger
AFTER UPDATE ON ican_blockchain_records
FOR EACH ROW
EXECUTE FUNCTION update_ican_blockchain_records_updated_at();

-- Create view for blockchain statistics
CREATE OR REPLACE VIEW ican_blockchain_stats AS
SELECT
  trust_id,
  COUNT(*) as total_records,
  COUNT(CASE WHEN is_verified = true THEN 1 END) as verified_records,
  COUNT(CASE WHEN record_type = 'trust_member_join' THEN 1 END) as member_joins,
  COUNT(CASE WHEN record_type = 'trust_vote' THEN 1 END) as votes,
  COUNT(CASE WHEN record_type = 'trust_contribution' THEN 1 END) as contributions,
  COUNT(CASE WHEN record_type = 'trust_loan_approval' THEN 1 END) as loan_approvals,
  MAX(created_at) as last_record_at
FROM ican_blockchain_records
GROUP BY trust_id;

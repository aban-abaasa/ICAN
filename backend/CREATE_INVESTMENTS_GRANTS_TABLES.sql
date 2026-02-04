-- Create Investments Table
CREATE TABLE IF NOT EXISTS investments (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  opportunity_id UUID,
  amount DECIMAL(15, 2) NOT NULL,
  status VARCHAR(50) DEFAULT 'active', -- active, pending, completed, cancelled
  return_rate DECIMAL(5, 2) DEFAULT 0,
  start_date TIMESTAMP DEFAULT NOW(),
  end_date TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  notes TEXT,
  UNIQUE(user_id, opportunity_id)
);

-- Create Grants Table
CREATE TABLE IF NOT EXISTS grants (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  amount DECIMAL(15, 2) NOT NULL,
  deadline TIMESTAMP NOT NULL,
  category VARCHAR(100),
  eligibility_criteria TEXT,
  application_url VARCHAR(500),
  status VARCHAR(50) DEFAULT 'open', -- open, closed, pending
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  organization VARCHAR(255),
  contact_email VARCHAR(255)
);

-- Create Grant Applications Table
CREATE TABLE IF NOT EXISTS grant_applications (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  grant_id UUID NOT NULL REFERENCES grants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status VARCHAR(50) DEFAULT 'pending', -- pending, approved, rejected, withdrawn
  application_date TIMESTAMP DEFAULT NOW(),
  decision_date TIMESTAMP,
  decision_notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(grant_id, user_id)
);

-- Enable RLS
ALTER TABLE investments ENABLE ROW LEVEL SECURITY;
ALTER TABLE grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE grant_applications ENABLE ROW LEVEL SECURITY;

-- RLS Policies for Investments
CREATE POLICY "Users can view their own investments"
  ON investments FOR SELECT
  USING (auth.uid() = user_id OR auth.jwt() ->> 'role' = 'admin');

CREATE POLICY "Users can insert their own investments"
  ON investments FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own investments"
  ON investments FOR UPDATE
  USING (auth.uid() = user_id OR auth.jwt() ->> 'role' = 'admin')
  WITH CHECK (auth.uid() = user_id OR auth.jwt() ->> 'role' = 'admin');

-- RLS Policies for Grants (everyone can view public grants)
CREATE POLICY "Anyone can view grants"
  ON grants FOR SELECT
  USING (true);

CREATE POLICY "Admin can insert grants"
  ON grants FOR INSERT
  WITH CHECK (auth.jwt() ->> 'role' = 'admin');

CREATE POLICY "Admin can update grants"
  ON grants FOR UPDATE
  USING (auth.jwt() ->> 'role' = 'admin')
  WITH CHECK (auth.jwt() ->> 'role' = 'admin');

-- RLS Policies for Grant Applications
CREATE POLICY "Users can view their own grant applications"
  ON grant_applications FOR SELECT
  USING (auth.uid() = user_id OR auth.jwt() ->> 'role' = 'admin');

CREATE POLICY "Users can insert their own grant applications"
  ON grant_applications FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own grant applications"
  ON grant_applications FOR UPDATE
  USING (auth.uid() = user_id OR auth.jwt() ->> 'role' = 'admin')
  WITH CHECK (auth.uid() = user_id OR auth.jwt() ->> 'role' = 'admin');

-- Create indexes for performance
CREATE INDEX idx_investments_user_id ON investments(user_id);
CREATE INDEX idx_investments_opportunity_id ON investments(opportunity_id);
CREATE INDEX idx_investments_status ON investments(status);
CREATE INDEX idx_grant_applications_user_id ON grant_applications(user_id);
CREATE INDEX idx_grant_applications_grant_id ON grant_applications(grant_id);
CREATE INDEX idx_grant_applications_status ON grant_applications(status);
CREATE INDEX idx_grants_status ON grants(status);
CREATE INDEX idx_grants_deadline ON grants(deadline);

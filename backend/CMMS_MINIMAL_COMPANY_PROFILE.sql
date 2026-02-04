-- ============================================
-- MINIMAL CMMS - COMPANY PROFILE ONLY
-- Check if tables exist before creating
-- ============================================

SET client_encoding TO 'UTF8';

-- ============================================
-- STEP 1: CHECK IF TABLES EXIST
-- ============================================

-- Check companies table
SELECT EXISTS (
   SELECT FROM information_schema.tables 
   WHERE table_schema = 'public' 
   AND table_name = 'companies'
) as companies_exists;

-- Check users table
SELECT EXISTS (
   SELECT FROM information_schema.tables 
   WHERE table_schema = 'public' 
   AND table_name = 'users'
) as users_exists;

-- Check roles table
SELECT EXISTS (
   SELECT FROM information_schema.tables 
   WHERE table_schema = 'public' 
   AND table_name = 'roles'
) as roles_exists;

-- Check user_roles table
SELECT EXISTS (
   SELECT FROM information_schema.tables 
   WHERE table_schema = 'public' 
   AND table_name = 'user_roles'
) as user_roles_exists;

-- ============================================
-- STEP 2: CREATE INDUSTRY ENUM TYPE
-- ============================================

DO $$ BEGIN
    CREATE TYPE industry_type AS ENUM ('Manufacturing', 'Healthcare', 'Transportation', 'Energy', 'Telecommunications', 'Food_Processing', 'Mining', 'Construction');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ============================================
-- STEP 3: CREATE ROLES TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS roles (
    id SMALLSERIAL PRIMARY KEY,
    role_name VARCHAR(100) UNIQUE NOT NULL,
    permission_level SMALLINT NOT NULL DEFAULT 0,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_roles_role_name ON roles(role_name);

-- ============================================
-- STEP 4: CREATE COMPANIES TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_name VARCHAR(255) NOT NULL,
    company_registration VARCHAR(100) UNIQUE NOT NULL,
    location VARCHAR(255),
    industry industry_type,
    phone VARCHAR(20),
    email VARCHAR(100) UNIQUE,
    website VARCHAR(255),
    is_active BOOLEAN DEFAULT true,
    created_by UUID,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_companies_email ON companies(email);
CREATE INDEX IF NOT EXISTS idx_companies_registration ON companies(company_registration);

-- ============================================
-- STEP 5: CREATE USERS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID,
    email VARCHAR(100) UNIQUE NOT NULL,
    user_name VARCHAR(100),
    password_hash VARCHAR(255),
    phone VARCHAR(20),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_users_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_company_id ON users(company_id);

-- ============================================
-- STEP 6: CREATE USER_ROLES TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL,
    user_id UUID NOT NULL,
    role_id SMALLINT NOT NULL,
    assigned_by UUID,
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT true,
    UNIQUE(company_id, user_id, role_id),
    CONSTRAINT fk_user_roles_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
    CONSTRAINT fk_user_roles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_user_roles_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
    CONSTRAINT fk_user_roles_assigned_by FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_user_roles_company_id ON user_roles(company_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role_id ON user_roles(role_id);

-- ============================================
-- STEP 7: INSERT PREDEFINED ROLES
-- ============================================

INSERT INTO roles (id, role_name, permission_level, description) VALUES
(1, 'Admin', 7, 'Full system access - can manage everything'),
(2, 'Department_Coordinator', 5, 'Manage department operations and approve requisitions'),
(3, 'Supervisor', 4, 'Supervise technicians and approve work'),
(4, 'Finance_Officer', 4, 'Manage financial approvals and budgets'),
(5, 'Technician', 2, 'Execute maintenance work and create requisitions'),
(6, 'Storeman', 2, 'Manage inventory and spare parts'),
(7, 'Service_Provider', 1, 'External service provider with limited access'),
(8, 'Guest', 0, 'Can only view company profile')
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- STEP 8: CREATE AUTO-UPDATE TRIGGER
-- ============================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_companies_updated_at BEFORE UPDATE ON companies
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- VERIFICATION QUERIES
-- ============================================

-- List all created tables
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('companies', 'users', 'roles', 'user_roles')
ORDER BY table_name;

-- Check companies table structure
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'companies'
ORDER BY ordinal_position;

-- Check users table structure
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'users'
ORDER BY ordinal_position;

-- Check roles count
SELECT COUNT(*) as roles_count FROM roles;

-- Display available roles
SELECT id, role_name, permission_level, description FROM roles ORDER BY id;

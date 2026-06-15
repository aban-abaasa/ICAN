-- ============================================
-- CMMS - CLEAN RESET & RECREATE TABLES
-- ============================================
-- Run this if tables are corrupted or incomplete

SET client_encoding TO 'UTF8';

-- ============================================
-- DROP EXISTING TABLES (if corrupted)
-- ============================================

DROP TABLE IF EXISTS user_roles CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS companies CASCADE;
DROP TABLE IF EXISTS roles CASCADE;

-- ============================================
-- STEP 1: CREATE INDUSTRY ENUM TYPE
-- ============================================

DROP TYPE IF EXISTS industry_type CASCADE;

CREATE TYPE industry_type AS ENUM (
    'Manufacturing', 
    'Healthcare', 
    'Transportation', 
    'Energy', 
    'Telecommunications', 
    'Food_Processing', 
    'Mining', 
    'Construction'
);

-- ============================================
-- STEP 2: CREATE ROLES TABLE
-- ============================================

CREATE TABLE roles (
    id SMALLSERIAL PRIMARY KEY,
    role_name VARCHAR(100) UNIQUE NOT NULL,
    permission_level SMALLINT NOT NULL DEFAULT 0,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_roles_role_name ON roles(role_name);

INSERT INTO roles (id, role_name, permission_level, description) VALUES
(1, 'Admin', 7, 'Full system access - can manage everything'),
(2, 'Department_Coordinator', 5, 'Manage department operations and approve requisitions'),
(3, 'Supervisor', 4, 'Supervise technicians and approve work'),
(4, 'Finance_Officer', 4, 'Manage financial approvals and budgets'),
(5, 'Technician', 2, 'Execute maintenance work and create requisitions'),
(6, 'Storeman', 2, 'Manage inventory and spare parts'),
(7, 'Service_Provider', 1, 'External service provider with limited access'),
(8, 'Guest', 0, 'Can only view company profile');

-- ============================================
-- STEP 3: CREATE COMPANIES TABLE
-- ============================================

CREATE TABLE companies (
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

CREATE INDEX idx_companies_email ON companies(email);
CREATE INDEX idx_companies_registration ON companies(company_registration);

-- ============================================
-- STEP 4: CREATE USERS TABLE
-- ============================================

CREATE TABLE users (
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

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_company_id ON users(company_id);

-- ============================================
-- STEP 5: CREATE USER_ROLES TABLE
-- ============================================

CREATE TABLE user_roles (
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

CREATE INDEX idx_user_roles_company_id ON user_roles(company_id);
CREATE INDEX idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX idx_user_roles_role_id ON user_roles(role_id);

-- ============================================
-- STEP 6: CREATE AUTO-UPDATE TRIGGERS
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
-- VERIFICATION
-- ============================================

-- Check all tables exist
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('companies', 'users', 'roles', 'user_roles')
ORDER BY table_name;

-- Check users table columns
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'users'
ORDER BY ordinal_position;

-- Check companies table columns
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'companies'
ORDER BY ordinal_position;

-- Verify roles
SELECT id, role_name FROM roles ORDER BY id;

-- Test Insert
INSERT INTO companies (company_name, company_registration, location, industry, phone, email, is_active)
VALUES (
    'Test Manufacturing',
    'TEST-2026-001',
    'Test City',
    'Manufacturing',
    '+256-700-123-456',
    'admin@testmfg.com',
    true
)
ON CONFLICT (company_registration) DO NOTHING;

INSERT INTO users (company_id, email, user_name, phone, is_active)
SELECT id, 'testadmin@testmfg.com', 'Test Admin', '+256-700-123-457', true
FROM companies 
WHERE company_registration = 'TEST-2026-001'
ON CONFLICT (email) DO NOTHING;

-- Verify test data
SELECT 'Companies' as table_name, COUNT(*) as count FROM companies
UNION ALL
SELECT 'Users', COUNT(*) FROM users
UNION ALL
SELECT 'Roles', COUNT(*) FROM roles
UNION ALL
SELECT 'User Roles', COUNT(*) FROM user_roles;

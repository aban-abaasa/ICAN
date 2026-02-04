-- ============================================
-- CMMS - COMPANY PROFILE (UNIQUE SCHEMA)
-- Computerized Maintenance Management System
-- Completely Different from Trust & Share
-- ============================================

SET client_encoding TO 'UTF8';

-- ============================================
-- DROP OLD GENERIC COMPANY PROFILE TABLES
-- ============================================

DROP TABLE IF EXISTS cmms_user_roles CASCADE;
DROP TABLE IF EXISTS cmms_users CASCADE;
DROP TABLE IF EXISTS cmms_company_profiles CASCADE;
DROP TABLE IF EXISTS cmms_roles CASCADE;

-- ============================================
-- STEP 1: CREATE CMMS-SPECIFIC ENUMS
-- ============================================

DROP TYPE IF EXISTS cmms_industry_type CASCADE;
DROP TYPE IF EXISTS cmms_equipment_status CASCADE;
DROP TYPE IF EXISTS cmms_maintenance_type CASCADE;

CREATE TYPE cmms_industry_type AS ENUM (
    'Manufacturing',
    'Healthcare',
    'Transportation',
    'Energy',
    'Telecommunications',
    'Food_Processing',
    'Mining',
    'Construction',
    'Hospitality',
    'Retail',
    'Education',
    'Real_Estate',
    'Logistics'
);

CREATE TYPE cmms_equipment_status AS ENUM (
    'OPERATIONAL',
    'MAINTENANCE',
    'FAILED',
    'RETIRED',
    'DISPOSED'
);

CREATE TYPE cmms_maintenance_type AS ENUM (
    'Preventive',
    'Corrective',
    'Predictive',
    'Emergency'
);

-- ============================================
-- STEP 2: CREATE CMMS ROLES TABLE
-- ============================================

CREATE TABLE cmms_roles (
    id SMALLSERIAL PRIMARY KEY,
    role_name VARCHAR(100) UNIQUE NOT NULL,
    permission_level SMALLINT NOT NULL DEFAULT 0,
    description TEXT,
    cmms_specific BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_cmms_roles_name ON cmms_roles(role_name);

INSERT INTO cmms_roles (id, role_name, permission_level, description) VALUES
(1, 'CMMS_Admin', 7, 'Full CMMS system access - manage everything'),
(2, 'CMMS_Coordinator', 5, 'Manage maintenance operations and approvals'),
(3, 'CMMS_Supervisor', 4, 'Supervise technicians and approve work'),
(4, 'CMMS_Finance', 4, 'Manage budgets and financial approvals'),
(5, 'CMMS_Technician', 2, 'Execute maintenance work'),
(6, 'CMMS_Storeman', 2, 'Manage inventory and spare parts'),
(7, 'CMMS_Service_Provider', 1, 'External service provider access'),
(8, 'CMMS_Viewer', 0, 'View-only access');

-- ============================================
-- STEP 3: CREATE CMMS COMPANY PROFILES TABLE
-- UNIQUE TO CMMS - NOT SHARED WITH OTHER TOOLS
-- ============================================

CREATE TABLE cmms_company_profiles (
    -- Core Identity (CMMS-specific)
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cmms_enabled BOOLEAN DEFAULT true,
    
    -- Company Information
    company_name VARCHAR(255) NOT NULL,
    company_registration VARCHAR(100) UNIQUE NOT NULL,
    location VARCHAR(255),
    industry cmms_industry_type DEFAULT 'Manufacturing',
    phone VARCHAR(20),
    email VARCHAR(100) UNIQUE,
    website VARCHAR(255),
    
    -- CMMS-SPECIFIC FIELDS (Not in Trust or Share)
    -- Equipment & Maintenance Management
    total_equipment_count INT DEFAULT 0,
    critical_equipment_count INT DEFAULT 0,
    avg_equipment_age_years DECIMAL(4,1),
    maintenance_budget_annual BIGINT DEFAULT 0,
    maintenance_type cmms_maintenance_type DEFAULT 'Preventive',
    preventive_maintenance_enabled BOOLEAN DEFAULT true,
    predictive_maintenance_enabled BOOLEAN DEFAULT false,
    
    -- Facilities & Locations
    num_facilities INT DEFAULT 0,
    num_departments INT DEFAULT 0,
    num_warehouses INT DEFAULT 0,
    
    -- Inventory Management
    inventory_enabled BOOLEAN DEFAULT true,
    total_inventory_items INT DEFAULT 0,
    reorder_point_alert_enabled BOOLEAN DEFAULT true,
    barcode_scanning_enabled BOOLEAN DEFAULT false,
    
    -- Work Order Tracking
    work_order_enabled BOOLEAN DEFAULT true,
    avg_work_order_completion_days INT DEFAULT 7,
    work_order_numbering_format VARCHAR(50) DEFAULT 'WO-YYYY-MM-NNNNN',
    
    -- Supplier Management
    supplier_management_enabled BOOLEAN DEFAULT true,
    num_suppliers INT DEFAULT 0,
    
    -- Service Provider Management
    service_provider_network_enabled BOOLEAN DEFAULT false,
    num_service_providers INT DEFAULT 0,
    
    -- Blockchain & Audit
    blockchain_enabled BOOLEAN DEFAULT false,
    audit_trail_enabled BOOLEAN DEFAULT true,
    blockchain_network_type VARCHAR(50),
    
    -- Digital Signatures & Compliance
    digital_signature_required BOOLEAN DEFAULT false,
    compliance_standard VARCHAR(100),
    
    -- Analytics & Reporting
    analytics_enabled BOOLEAN DEFAULT true,
    custom_reports_enabled BOOLEAN DEFAULT true,
    automated_reports_enabled BOOLEAN DEFAULT false,
    
    -- Mobile Access
    mobile_app_enabled BOOLEAN DEFAULT true,
    offline_mode_enabled BOOLEAN DEFAULT false,
    
    -- Integration Settings
    erp_integration_enabled BOOLEAN DEFAULT false,
    erp_system_name VARCHAR(100),
    api_access_enabled BOOLEAN DEFAULT false,
    
    -- Settings
    is_active BOOLEAN DEFAULT true,
    created_by UUID,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_active TIMESTAMP,
    
    -- Metadata
    notes TEXT,
    logo_url VARCHAR(500),
    branding_color VARCHAR(7) DEFAULT '#0066cc'
);

CREATE INDEX idx_cmms_company_email ON cmms_company_profiles(email);
CREATE INDEX idx_cmms_company_registration ON cmms_company_profiles(company_registration);
CREATE INDEX idx_cmms_company_active ON cmms_company_profiles(is_active);
CREATE INDEX idx_cmms_company_industry ON cmms_company_profiles(industry);

-- ============================================
-- STEP 4: CREATE CMMS USERS TABLE
-- ============================================

CREATE TABLE cmms_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cmms_company_id UUID NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    user_name VARCHAR(100),
    full_name VARCHAR(255),
    password_hash VARCHAR(255),
    phone VARCHAR(20),
    department VARCHAR(100),
    job_title VARCHAR(100),
    employee_id VARCHAR(50),
    is_active BOOLEAN DEFAULT true,
    last_login TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_cmms_users_company FOREIGN KEY (cmms_company_id) 
        REFERENCES cmms_company_profiles(id) ON DELETE CASCADE
);

CREATE INDEX idx_cmms_users_email ON cmms_users(email);
CREATE INDEX idx_cmms_users_company ON cmms_users(cmms_company_id);
CREATE INDEX idx_cmms_users_active ON cmms_users(is_active);

-- ============================================
-- STEP 5: CREATE CMMS USER ROLES TABLE
-- ============================================

CREATE TABLE cmms_user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cmms_company_id UUID NOT NULL,
    cmms_user_id UUID NOT NULL,
    cmms_role_id SMALLINT NOT NULL,
    assigned_by UUID,
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT true,
    UNIQUE(cmms_company_id, cmms_user_id, cmms_role_id),
    CONSTRAINT fk_cmms_user_roles_company FOREIGN KEY (cmms_company_id) 
        REFERENCES cmms_company_profiles(id) ON DELETE CASCADE,
    CONSTRAINT fk_cmms_user_roles_user FOREIGN KEY (cmms_user_id) 
        REFERENCES cmms_users(id) ON DELETE CASCADE,
    CONSTRAINT fk_cmms_user_roles_role FOREIGN KEY (cmms_role_id) 
        REFERENCES cmms_roles(id) ON DELETE CASCADE,
    CONSTRAINT fk_cmms_user_roles_assigned_by FOREIGN KEY (assigned_by) 
        REFERENCES cmms_users(id) ON DELETE SET NULL
);

CREATE INDEX idx_cmms_user_roles_company ON cmms_user_roles(cmms_company_id);
CREATE INDEX idx_cmms_user_roles_user ON cmms_user_roles(cmms_user_id);
CREATE INDEX idx_cmms_user_roles_role ON cmms_user_roles(cmms_role_id);

-- ============================================
-- STEP 6: CREATE AUTO-UPDATE TRIGGERS
-- ============================================

CREATE OR REPLACE FUNCTION update_cmms_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_cmms_company_profiles_updated_at 
    BEFORE UPDATE ON cmms_company_profiles
    FOR EACH ROW EXECUTE FUNCTION update_cmms_updated_at_column();

CREATE TRIGGER update_cmms_users_updated_at 
    BEFORE UPDATE ON cmms_users
    FOR EACH ROW EXECUTE FUNCTION update_cmms_updated_at_column();

-- ============================================
-- STEP 7: VERIFICATION QUERIES
-- ============================================

-- Check all CMMS tables exist
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name LIKE 'cmms_%'
ORDER BY table_name;

-- Check CMMS company profiles table structure
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'cmms_company_profiles'
ORDER BY ordinal_position;

-- Check CMMS roles
SELECT id, role_name, permission_level, description FROM cmms_roles ORDER BY id;

-- Count test data
SELECT 'CMMS Roles' as table_name, COUNT(*) as count FROM cmms_roles
UNION ALL
SELECT 'CMMS Company Profiles', COUNT(*) FROM cmms_company_profiles
UNION ALL
SELECT 'CMMS Users', COUNT(*) FROM cmms_users
UNION ALL
SELECT 'CMMS User Roles', COUNT(*) FROM cmms_user_roles;

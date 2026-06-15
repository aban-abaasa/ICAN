-- ============================================
-- CMMS - FIX EXISTING TABLES
-- ============================================
-- Drop existing tables and recreate with correct schema

-- Drop views first
DROP VIEW IF EXISTS public.cmms_users_with_roles CASCADE;

-- Drop audit log first (references other tables)
DROP TABLE IF EXISTS public.cmms_user_audit_log CASCADE;

-- Drop user roles
DROP TABLE IF EXISTS public.cmms_user_roles CASCADE;

-- Drop users
DROP TABLE IF EXISTS public.cmms_users CASCADE;

-- Drop roles
DROP TABLE IF EXISTS public.cmms_roles CASCADE;

-- Wait a moment for drops to complete
-- Then verify tables are gone before creating
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'cmms_roles') THEN
    DROP TABLE public.cmms_roles CASCADE;
  END IF;
END $$;

-- =============================================
-- CREATE CMMS ROLES TABLE (FRESH)
-- =============================================
CREATE TABLE public.cmms_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Role Information
    role_name VARCHAR(100) NOT NULL UNIQUE,
    display_name VARCHAR(100) NOT NULL,
    description TEXT,
    icon VARCHAR(50),
    color VARCHAR(50),
    
    -- Permission Flags
    can_view_company BOOLEAN DEFAULT FALSE,
    can_edit_company BOOLEAN DEFAULT FALSE,
    can_manage_users BOOLEAN DEFAULT FALSE,
    can_assign_roles BOOLEAN DEFAULT FALSE,
    can_view_inventory BOOLEAN DEFAULT FALSE,
    can_edit_inventory BOOLEAN DEFAULT FALSE,
    can_delete_users BOOLEAN DEFAULT FALSE,
    can_view_financials BOOLEAN DEFAULT FALSE,
    can_manage_service_providers BOOLEAN DEFAULT FALSE,
    can_create_work_orders BOOLEAN DEFAULT FALSE,
    can_view_all_data BOOLEAN DEFAULT FALSE,
    
    -- Permission Level (0-7)
    permission_level INTEGER DEFAULT 0,
    
    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    CONSTRAINT valid_permission_level CHECK (permission_level >= 0 AND permission_level <= 7)
);

-- Insert roles with correct column names
INSERT INTO public.cmms_roles (role_name, display_name, description, permission_level, 
    can_view_company, can_edit_company, can_manage_users, can_assign_roles, 
    can_view_inventory, can_edit_inventory, can_create_work_orders, can_view_all_data, can_view_financials)
VALUES
    ('admin', 'Admin', 'Administrator with full access', 7, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE),
    ('coordinator', 'Department Coordinator', 'Coordinates department activities', 5, TRUE, FALSE, FALSE, FALSE, TRUE, FALSE, TRUE, FALSE, FALSE),
    ('supervisor', 'Supervisor', 'Supervises maintenance operations', 4, TRUE, FALSE, FALSE, FALSE, TRUE, FALSE, TRUE, FALSE, FALSE),
    ('finance', 'Financial Officer', 'Manages financial operations', 4, TRUE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, TRUE),
    ('technician', 'Technician', 'Performs maintenance work', 2, TRUE, FALSE, FALSE, FALSE, TRUE, FALSE, FALSE, FALSE, FALSE),
    ('storeman', 'Storeman', 'Manages inventory and storage', 2, TRUE, FALSE, FALSE, FALSE, TRUE, TRUE, FALSE, FALSE, FALSE),
    ('service_provider', 'Service Provider', 'External service provider', 1, TRUE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE),
    ('viewer', 'Viewer', 'Read-only access', 0, TRUE, FALSE, FALSE, FALSE, TRUE, FALSE, FALSE, FALSE, FALSE);

-- =============================================
-- CREATE CMMS USERS TABLE (FRESH)
-- =============================================
CREATE TABLE public.cmms_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Company Link
    cmms_company_id UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,
    
    -- User Information (from ICAN)
    email VARCHAR(255) NOT NULL,
    user_name VARCHAR(255) NOT NULL,
    full_name VARCHAR(255),
    phone VARCHAR(20),
    
    -- CMMS-specific Details
    department VARCHAR(100),
    job_title VARCHAR(100),
    employee_id VARCHAR(100),
    
    -- ICAN Integration
    ican_user_id UUID,
    ican_verified BOOLEAN DEFAULT FALSE,
    ican_verified_at TIMESTAMP WITH TIME ZONE,
    
    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    status VARCHAR(50) DEFAULT 'active',
    
    -- Metadata
    added_by UUID,
    added_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_login TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT unique_user_per_company UNIQUE(cmms_company_id, email)
);

-- Create indexes
CREATE INDEX idx_cmms_users_company_id ON public.cmms_users(cmms_company_id);
CREATE INDEX idx_cmms_users_email ON public.cmms_users(email);
CREATE INDEX idx_cmms_users_ican_user_id ON public.cmms_users(ican_user_id);

-- =============================================
-- CREATE CMMS USER ROLES TABLE (FRESH)
-- =============================================
CREATE TABLE public.cmms_user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Links
    cmms_company_id UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,
    cmms_user_id UUID NOT NULL REFERENCES public.cmms_users(id) ON DELETE CASCADE,
    cmms_role_id UUID NOT NULL REFERENCES public.cmms_roles(id) ON DELETE CASCADE,
    
    -- Assignment Details
    assigned_by UUID,
    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    is_active BOOLEAN DEFAULT TRUE,
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT unique_user_role_per_company UNIQUE(cmms_company_id, cmms_user_id, cmms_role_id)
);

-- Create indexes
CREATE INDEX idx_cmms_user_roles_company_id ON public.cmms_user_roles(cmms_company_id);
CREATE INDEX idx_cmms_user_roles_user_id ON public.cmms_user_roles(cmms_user_id);
CREATE INDEX idx_cmms_user_roles_role_id ON public.cmms_user_roles(cmms_role_id);

-- =============================================
-- CREATE AUDIT LOG TABLE (FRESH)
-- =============================================
CREATE TABLE public.cmms_user_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Company & User
    cmms_company_id UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,
    cmms_user_id UUID REFERENCES public.cmms_users(id) ON DELETE SET NULL,
    
    -- Action Details
    action_type VARCHAR(50) NOT NULL,
    action_description TEXT,
    performed_by UUID,
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ip_address VARCHAR(45),
    user_agent TEXT
);

-- Create indexes
CREATE INDEX idx_cmms_audit_company_id ON public.cmms_user_audit_log(cmms_company_id);
CREATE INDEX idx_cmms_audit_user_id ON public.cmms_user_audit_log(cmms_user_id);
CREATE INDEX idx_cmms_audit_created_at ON public.cmms_user_audit_log(created_at);

-- =============================================
-- CREATE OR REPLACE VIEW
-- =============================================
CREATE OR REPLACE VIEW cmms_users_with_roles AS
SELECT 
    u.id,
    u.cmms_company_id,
    u.email,
    u.user_name,
    u.full_name,
    u.phone,
    u.department,
    u.job_title,
    u.is_active,
    u.created_at,
    STRING_AGG(DISTINCT r.role_name, ', ') as roles,
    STRING_AGG(DISTINCT r.display_name, ', ') as role_labels,
    MAX(r.permission_level) as max_permission_level
FROM public.cmms_users u
LEFT JOIN public.cmms_user_roles ur ON u.id = ur.cmms_user_id AND ur.is_active = TRUE
LEFT JOIN public.cmms_roles r ON ur.cmms_role_id = r.id
GROUP BY u.id, u.cmms_company_id, u.email, u.user_name, u.full_name, u.phone, u.department, u.job_title, u.is_active, u.created_at;

-- =============================================
-- VERIFY
-- =============================================
SELECT '✅ Tables recreated successfully!' as status;

SELECT 
    'cmms_roles' as table_name, COUNT(*) as row_count FROM public.cmms_roles
UNION ALL
SELECT 'cmms_users', COUNT(*) FROM public.cmms_users
UNION ALL
SELECT 'cmms_user_roles', COUNT(*) FROM public.cmms_user_roles
UNION ALL
SELECT 'cmms_user_audit_log', COUNT(*) FROM public.cmms_user_audit_log;

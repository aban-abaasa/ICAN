-- ============================================
-- CMMS - ADD USER TO CMMS - DATABASE SCHEMA
-- ============================================
-- Tables for managing users added to CMMS company profiles
-- Supports role-based access control and ICAN integration

-- =============================================
-- CMMS ROLES TABLE
-- =============================================
-- Reference: Role definitions for CMMS
CREATE TABLE IF NOT EXISTS public.cmms_roles (
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

-- Insert CMMS-specific roles if they don't exist
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
    ('viewer', 'Viewer', 'Read-only access', 0, TRUE, FALSE, FALSE, FALSE, TRUE, FALSE, FALSE, FALSE, FALSE)
ON CONFLICT (role_name) DO NOTHING;

-- =============================================
-- CMMS USERS TABLE
-- =============================================
-- Users added to CMMS (with ICAN account verification)
CREATE TABLE IF NOT EXISTS public.cmms_users (
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
    ican_user_id UUID, -- Reference to ICAN users table
    ican_verified BOOLEAN DEFAULT FALSE,
    ican_verified_at TIMESTAMP WITH TIME ZONE,
    
    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    status VARCHAR(50) DEFAULT 'active', -- 'active', 'inactive', 'suspended'
    
    -- Metadata
    added_by UUID, -- User who added this person
    added_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_login TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT unique_user_per_company UNIQUE(cmms_company_id, email)
);

-- Enable RLS on cmms_users
ALTER TABLE public.cmms_users ENABLE ROW LEVEL SECURITY;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_cmms_users_company_id ON public.cmms_users(cmms_company_id);
CREATE INDEX IF NOT EXISTS idx_cmms_users_email ON public.cmms_users(email);
CREATE INDEX IF NOT EXISTS idx_cmms_users_ican_user_id ON public.cmms_users(ican_user_id);

-- =============================================
-- CMMS USER ROLES TABLE
-- =============================================
-- Maps users to roles per company
CREATE TABLE IF NOT EXISTS public.cmms_user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Links
    cmms_company_id UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,
    cmms_user_id UUID NOT NULL REFERENCES public.cmms_users(id) ON DELETE CASCADE,
    cmms_role_id UUID NOT NULL REFERENCES public.cmms_roles(id) ON DELETE CASCADE,
    
    -- Assignment Details
    assigned_by UUID, -- Admin who assigned this role
    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    is_active BOOLEAN DEFAULT TRUE,
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT unique_user_role_per_company UNIQUE(cmms_company_id, cmms_user_id, cmms_role_id)
);

-- Enable RLS on cmms_user_roles
ALTER TABLE public.cmms_user_roles ENABLE ROW LEVEL SECURITY;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_cmms_user_roles_company_id ON public.cmms_user_roles(cmms_company_id);
CREATE INDEX IF NOT EXISTS idx_cmms_user_roles_user_id ON public.cmms_user_roles(cmms_user_id);
CREATE INDEX IF NOT EXISTS idx_cmms_user_roles_role_id ON public.cmms_user_roles(cmms_role_id);

-- =============================================
-- AUTO-UPDATE TIMESTAMP TRIGGERS
-- =============================================
-- Trigger for cmms_roles
DROP TRIGGER IF EXISTS update_cmms_roles_timestamp ON public.cmms_roles;
CREATE TRIGGER update_cmms_roles_timestamp
BEFORE UPDATE ON public.cmms_roles
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

-- Trigger for cmms_users
DROP TRIGGER IF EXISTS update_cmms_users_timestamp ON public.cmms_users;
CREATE TRIGGER update_cmms_users_timestamp
BEFORE UPDATE ON public.cmms_users
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

-- Trigger for cmms_user_roles
DROP TRIGGER IF EXISTS update_cmms_user_roles_timestamp ON public.cmms_user_roles;
CREATE TRIGGER update_cmms_user_roles_timestamp
BEFORE UPDATE ON public.cmms_user_roles
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

-- =============================================
-- AUDIT LOG TABLE
-- =============================================
-- Track all user additions and role assignments
CREATE TABLE IF NOT EXISTS public.cmms_user_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Company & User
    cmms_company_id UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,
    cmms_user_id UUID REFERENCES public.cmms_users(id) ON DELETE SET NULL,
    
    -- Action Details
    action_type VARCHAR(50) NOT NULL, -- 'user_added', 'role_assigned', 'user_deactivated', etc.
    action_description TEXT,
    performed_by UUID,
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ip_address VARCHAR(45),
    user_agent TEXT
);

-- Create index for audit queries
CREATE INDEX IF NOT EXISTS idx_cmms_audit_company_id ON public.cmms_user_audit_log(cmms_company_id);
CREATE INDEX IF NOT EXISTS idx_cmms_audit_user_id ON public.cmms_user_audit_log(cmms_user_id);
CREATE INDEX IF NOT EXISTS idx_cmms_audit_created_at ON public.cmms_user_audit_log(created_at);

-- =============================================
-- HELPER FUNCTIONS
-- =============================================

-- Function to add user to CMMS
CREATE OR REPLACE FUNCTION add_cmms_user(
    p_company_id UUID,
    p_email VARCHAR,
    p_user_name VARCHAR,
    p_full_name VARCHAR,
    p_phone VARCHAR,
    p_department VARCHAR,
    p_job_title VARCHAR,
    p_added_by UUID
)
RETURNS TABLE(success BOOLEAN, user_id UUID, message TEXT) AS $$
DECLARE
    v_user_id UUID;
BEGIN
    -- Check if user already exists
    SELECT id INTO v_user_id FROM public.cmms_users
    WHERE cmms_company_id = p_company_id AND email = p_email;
    
    IF v_user_id IS NOT NULL THEN
        RETURN QUERY SELECT FALSE, v_user_id, 'User already exists in this company'::TEXT;
        RETURN;
    END IF;
    
    -- Insert new user
    INSERT INTO public.cmms_users (
        cmms_company_id, email, user_name, full_name, phone,
        department, job_title, added_by, ican_verified
    ) VALUES (
        p_company_id, p_email, p_user_name, p_full_name, p_phone,
        p_department, p_job_title, p_added_by, TRUE
    )
    RETURNING id INTO v_user_id;
    
    RETURN QUERY SELECT TRUE, v_user_id, 'User added successfully'::TEXT;
END;
$$ LANGUAGE plpgsql;

-- Function to assign role to user
CREATE OR REPLACE FUNCTION assign_cmms_role(
    p_company_id UUID,
    p_user_id UUID,
    p_role_id UUID,
    p_assigned_by UUID
)
RETURNS TABLE(success BOOLEAN, assignment_id UUID, message TEXT) AS $$
DECLARE
    v_assignment_id UUID;
BEGIN
    -- Insert role assignment (will fail if duplicate due to constraint)
    INSERT INTO public.cmms_user_roles (
        cmms_company_id, cmms_user_id, cmms_role_id, assigned_by
    ) VALUES (
        p_company_id, p_user_id, p_role_id, p_assigned_by
    )
    RETURNING id INTO v_assignment_id;
    
    RETURN QUERY SELECT TRUE, v_assignment_id, 'Role assigned successfully'::TEXT;
EXCEPTION WHEN UNIQUE_VIOLATION THEN
    RETURN QUERY SELECT FALSE, NULL, 'User already has this role'::TEXT;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- SAMPLE DATA
-- =============================================
-- Uncomment to test

/*
-- Test: Add a sample user to a company
SELECT * FROM add_cmms_user(
    (SELECT id FROM cmms_company_profiles LIMIT 1),
    'john@example.com',
    'john_doe',
    'John Doe',
    '+256701234567',
    'Maintenance',
    'Senior Technician',
    NULL
);

-- Test: Get all users in a company
SELECT u.id, u.email, u.user_name, u.full_name, u.department, r.role_name
FROM cmms_users u
LEFT JOIN cmms_user_roles ur ON u.id = ur.cmms_user_id
LEFT JOIN cmms_roles r ON ur.cmms_role_id = r.id
WHERE u.cmms_company_id = (SELECT id FROM cmms_company_profiles LIMIT 1);

-- Test: Get user permissions
SELECT r.role_name, r.can_view_company, r.can_manage_users, r.permission_level
FROM cmms_user_roles ur
JOIN cmms_roles r ON ur.cmms_role_id = r.id
WHERE ur.cmms_user_id = (SELECT id FROM cmms_users LIMIT 1);
*/

-- =============================================
-- VIEW: User with Roles
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
-- VERIFY TABLES CREATED
-- =============================================
SELECT 'Tables created successfully' as status;
SELECT 
    'cmms_roles' as table_name, COUNT(*) as row_count FROM public.cmms_roles
UNION ALL
SELECT 'cmms_users', COUNT(*) FROM public.cmms_users
UNION ALL
SELECT 'cmms_user_roles', COUNT(*) FROM public.cmms_user_roles
UNION ALL
SELECT 'cmms_user_audit_log', COUNT(*) FROM public.cmms_user_audit_log;

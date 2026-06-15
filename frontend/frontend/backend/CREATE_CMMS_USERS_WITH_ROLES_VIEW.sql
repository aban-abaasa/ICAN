-- ============================================
-- FIX: CREATE cmms_users_with_roles VIEW
-- ============================================
-- This view was missing and causing errors in CMSSModule.jsx
-- Run this SQL to fix the database

-- First, ensure all required tables exist
CREATE TABLE IF NOT EXISTS public.cmms_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_name VARCHAR(100) NOT NULL UNIQUE,
    display_name VARCHAR(100) NOT NULL,
    description TEXT,
    icon VARCHAR(50),
    color VARCHAR(50),
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
    permission_level INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT valid_permission_level CHECK (permission_level >= 0 AND permission_level <= 7)
);

CREATE TABLE IF NOT EXISTS public.cmms_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cmms_company_id UUID NOT NULL REFERENCES public.cmms_company(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    user_name VARCHAR(100),
    full_name VARCHAR(255),
    phone VARCHAR(20),
    department VARCHAR(100),
    job_title VARCHAR(100),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT unique_company_email UNIQUE(cmms_company_id, email)
);

CREATE TABLE IF NOT EXISTS public.cmms_user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cmms_user_id UUID NOT NULL REFERENCES public.cmms_users(id) ON DELETE CASCADE,
    cmms_role_id UUID NOT NULL REFERENCES public.cmms_roles(id) ON DELETE CASCADE,
    is_active BOOLEAN DEFAULT TRUE,
    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT unique_user_role UNIQUE(cmms_user_id, cmms_role_id)
);

-- Ensure default CMMS roles exist
INSERT INTO public.cmms_roles (role_name, display_name, description, permission_level, 
    can_view_company, can_edit_company, can_manage_users, can_assign_roles, 
    can_view_inventory, can_edit_inventory, can_create_work_orders, can_view_all_data, can_view_financials)
VALUES
    ('admin', 'Admin', 'Administrator with full access', 7, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE),
    ('manager', 'Manager', 'Manager with company editing permissions', 5, TRUE, TRUE, FALSE, FALSE, TRUE, TRUE, TRUE, FALSE, TRUE),
    ('coordinator', 'Coordinator', 'Department coordinator', 4, TRUE, FALSE, FALSE, FALSE, TRUE, TRUE, FALSE, FALSE, FALSE),
    ('supervisor', 'Supervisor', 'Supervisor with inventory access', 3, TRUE, FALSE, FALSE, FALSE, TRUE, TRUE, FALSE, FALSE, FALSE),
    ('technician', 'Technician', 'Field technician', 2, TRUE, FALSE, FALSE, FALSE, TRUE, FALSE, FALSE, FALSE, FALSE),
    ('storeman', 'Storeman', 'Inventory storeman', 2, FALSE, FALSE, FALSE, FALSE, TRUE, TRUE, FALSE, FALSE, FALSE),
    ('viewer', 'Viewer', 'Read-only access', 1, TRUE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE)
ON CONFLICT (role_name) DO NOTHING;

-- Drop existing view if it exists
DROP VIEW IF EXISTS public.cmms_users_with_roles CASCADE;

-- Create the view that combines users with their roles
CREATE OR REPLACE VIEW public.cmms_users_with_roles AS
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

-- Grant access to the view
GRANT SELECT ON public.cmms_users_with_roles TO anon, authenticated;

-- Verify view was created
SELECT 'View cmms_users_with_roles created successfully' as status;

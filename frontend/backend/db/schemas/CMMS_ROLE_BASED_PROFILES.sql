-- =============================================
-- CMMS ROLE-BASED PROFILE SYSTEM
-- Computerized Maintenance Management System
-- Role hierarchy and permission management
-- =============================================

-- =============================================
-- CMMS ROLE DEFINITIONS TABLE
-- Define all available roles with permissions
-- =============================================
CREATE TABLE IF NOT EXISTS public.cmms_role_definitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cmms_company_id UUID NOT NULL REFERENCES public.cmms_companies(id) ON DELETE CASCADE,
    
    -- Role Information
    role_name VARCHAR(100) NOT NULL, -- 'Admin', 'Coordinator', 'Supervisor', 'Technician', 'Storeman', 'Finance', 'Service-Provider', 'Viewer'
    role_label VARCHAR(255) NOT NULL, -- Display label
    description TEXT,
    
    -- Role Level (for hierarchy)
    role_level INTEGER NOT NULL, -- 0-7 (0=guest, 7=admin)
    role_color VARCHAR(50), -- Gradient color for UI: 'from-red-500 to-pink-600'
    role_icon VARCHAR(50), -- Emoji or icon
    
    -- Permissions (stored as JSON for flexibility)
    permissions JSONB DEFAULT '{
      "canViewCompany": false,
      "canEditCompany": false,
      "canManageUsers": false,
      "canAssignRoles": false,
      "canViewInventory": false,
      "canEditInventory": false,
      "canDeleteUsers": false,
      "canViewFinancials": false,
      "canManageServiceProviders": false,
      "canCreateWorkOrders": false,
      "canViewAllData": false,
      "canApproveRequisitions": false,
      "canRejectRequisitions": false,
      "canCompleteWorkOrders": false,
      "canViewReports": false,
      "canExportData": false
    }',
    
    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    is_system_role BOOLEAN DEFAULT FALSE, -- System roles cannot be deleted
    
    -- Metadata
    created_by UUID REFERENCES public.profiles(id),
    updated_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.cmms_role_definitions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Role definitions visible within company" ON public.cmms_role_definitions;
DROP POLICY IF EXISTS "Only admin can manage role definitions" ON public.cmms_role_definitions;

CREATE POLICY "Role definitions visible within company" 
    ON public.cmms_role_definitions FOR SELECT 
    USING (
        EXISTS (
            SELECT 1 FROM public.cmms_users cu
            WHERE cu.cmms_company_id = cmms_role_definitions.cmms_company_id
            AND cu.email = auth.jwt() ->> 'email'
        )
    );

CREATE POLICY "Only admin can manage role definitions"
    ON public.cmms_role_definitions FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.cmms_users cu
            JOIN public.cmms_user_roles cur ON cu.id = cur.cmms_user_id
            JOIN public.cmms_roles cr ON cur.cmms_role_id = cr.id
            WHERE cu.cmms_company_id = cmms_role_definitions.cmms_company_id
            AND cr.role_name = 'Admin'
            AND cu.email = auth.jwt() ->> 'email'
        )
    );

-- =============================================
-- CMMS USER ROLE PROFILES TABLE
-- Define user-specific role profiles with custom permissions
-- =============================================
CREATE TABLE IF NOT EXISTS public.cmms_user_role_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cmms_company_id UUID NOT NULL REFERENCES public.cmms_companies(id) ON DELETE CASCADE,
    cmms_user_id UUID NOT NULL REFERENCES public.cmms_users(id) ON DELETE CASCADE,
    
    -- Profile Information
    profile_name VARCHAR(255) NOT NULL, -- e.g., "Senior Technician", "Finance Manager"
    description TEXT,
    
    -- Role Assignment
    primary_role_id UUID NOT NULL REFERENCES public.cmms_role_definitions(id),
    secondary_roles JSONB DEFAULT '[]', -- Array of additional role IDs
    
    -- Custom Permissions Override
    use_custom_permissions BOOLEAN DEFAULT FALSE,
    custom_permissions JSONB DEFAULT '{}', -- Override specific permissions
    permission_level INTEGER DEFAULT 0, -- 0-10 (0=viewer, 10=super admin)
    
    -- Department Assignment
    assigned_department_id UUID REFERENCES public.cmms_departments(id),
    assigned_service_types JSONB DEFAULT '[]', -- For service providers
    
    -- Delegation & Approval
    can_delegate_permissions BOOLEAN DEFAULT FALSE,
    delegated_to_users JSONB DEFAULT '[]', -- Array of user IDs who can act on behalf
    
    -- Restrictions
    restricted_to_locations JSONB DEFAULT '[]', -- Array of location IDs (null = all)
    restricted_to_departments JSONB DEFAULT '[]', -- Array of department IDs (null = all)
    data_access_level VARCHAR(50) DEFAULT 'company_only', -- 'own_only', 'department_only', 'company_only', 'all'
    
    -- Status & Dates
    status VARCHAR(50) DEFAULT 'active', -- 'active', 'inactive', 'suspended', 'pending'
    is_primary_profile BOOLEAN DEFAULT FALSE,
    activated_at TIMESTAMP WITH TIME ZONE,
    deactivated_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    
    -- Audit
    created_by UUID REFERENCES public.profiles(id),
    updated_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_user_role_profiles_user_id ON public.cmms_user_role_profiles(cmms_user_id);
CREATE INDEX IF NOT EXISTS idx_user_role_profiles_role_id ON public.cmms_user_role_profiles(primary_role_id);
CREATE INDEX IF NOT EXISTS idx_user_role_profiles_company_id ON public.cmms_user_role_profiles(cmms_company_id);
CREATE INDEX IF NOT EXISTS idx_user_role_profiles_status ON public.cmms_user_role_profiles(status);

-- Enable RLS
ALTER TABLE public.cmms_user_role_profiles ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Users can view their own role profiles" ON public.cmms_user_role_profiles;
DROP POLICY IF EXISTS "Admins can manage role profiles" ON public.cmms_user_role_profiles;

CREATE POLICY "Users can view their own role profiles" 
    ON public.cmms_user_role_profiles FOR SELECT 
    USING (
        cmms_user_id = (SELECT id FROM public.cmms_users WHERE email = auth.jwt() ->> 'email' LIMIT 1)
        OR
        EXISTS (
            SELECT 1 FROM public.cmms_users cu
            JOIN public.cmms_user_roles cur ON cu.id = cur.cmms_user_id
            JOIN public.cmms_roles cr ON cur.cmms_role_id = cr.id
            WHERE cu.cmms_company_id = cmms_user_role_profiles.cmms_company_id
            AND cr.role_name = 'Admin'
            AND cu.email = auth.jwt() ->> 'email'
        )
    );

-- =============================================
-- CMMS ROLE PERMISSIONS AUDIT TABLE
-- Track all permission changes and usage
-- =============================================
CREATE TABLE IF NOT EXISTS public.cmms_role_permission_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cmms_company_id UUID NOT NULL REFERENCES public.cmms_companies(id) ON DELETE CASCADE,
    cmms_user_id UUID NOT NULL REFERENCES public.cmms_users(id) ON DELETE CASCADE,
    
    -- Permission Details
    permission_name VARCHAR(255) NOT NULL,
    action VARCHAR(100), -- 'granted', 'revoked', 'used', 'denied', 'expired'
    
    -- Context
    resource_type VARCHAR(100), -- 'inventory', 'work_order', 'requisition', 'report'
    resource_id UUID,
    
    -- Result
    was_successful BOOLEAN DEFAULT TRUE,
    denial_reason TEXT,
    
    -- Location & Device
    ip_address VARCHAR(45),
    user_agent TEXT,
    device_info VARCHAR(255),
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT valid_action CHECK (action IN ('granted', 'revoked', 'used', 'denied', 'expired'))
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_role_permission_audit_user_id ON public.cmms_role_permission_audit(cmms_user_id);
CREATE INDEX IF NOT EXISTS idx_role_permission_audit_company_id ON public.cmms_role_permission_audit(cmms_company_id);
CREATE INDEX IF NOT EXISTS idx_role_permission_audit_created_at ON public.cmms_role_permission_audit(created_at);
CREATE INDEX IF NOT EXISTS idx_role_permission_audit_action ON public.cmms_role_permission_audit(action);

-- Enable RLS
ALTER TABLE public.cmms_role_permission_audit ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Admins can view permission audit" 
    ON public.cmms_role_permission_audit FOR SELECT 
    USING (
        EXISTS (
            SELECT 1 FROM public.cmms_users cu
            JOIN public.cmms_user_roles cur ON cu.id = cur.cmms_user_id
            JOIN public.cmms_roles cr ON cur.cmms_role_id = cr.id
            WHERE cu.cmms_company_id = cmms_role_permission_audit.cmms_company_id
            AND cr.role_name = 'Admin'
            AND cu.email = auth.jwt() ->> 'email'
        )
    );

-- =============================================
-- CMMS ROLE ACTIVITY LOGS TABLE
-- Track what each role/user does in the system
-- =============================================
CREATE TABLE IF NOT EXISTS public.cmms_role_activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cmms_company_id UUID NOT NULL REFERENCES public.cmms_companies(id) ON DELETE CASCADE,
    cmms_user_id UUID NOT NULL REFERENCES public.cmms_users(id) ON DELETE CASCADE,
    cmms_user_role_profile_id UUID REFERENCES public.cmms_user_role_profiles(id),
    
    -- Activity Details
    activity_type VARCHAR(100), -- 'view', 'create', 'update', 'delete', 'export', 'sign', 'approve'
    activity_description TEXT,
    
    -- Target Resource
    resource_type VARCHAR(100),
    resource_id UUID,
    resource_name VARCHAR(255),
    
    -- Changes
    old_value JSONB,
    new_value JSONB,
    
    -- Status
    status VARCHAR(50) DEFAULT 'completed', -- 'completed', 'in_progress', 'failed'
    
    -- Location & Session
    ip_address VARCHAR(45),
    session_id VARCHAR(255),
    device_fingerprint VARCHAR(255),
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id ON public.cmms_role_activity_logs(cmms_user_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_company_id ON public.cmms_role_activity_logs(cmms_company_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_activity_type ON public.cmms_role_activity_logs(activity_type);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON public.cmms_role_activity_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_activity_logs_resource_type_id ON public.cmms_role_activity_logs(resource_type, resource_id);

-- Enable RLS
ALTER TABLE public.cmms_role_activity_logs ENABLE ROW LEVEL SECURITY;

-- =============================================
-- HELPER FUNCTIONS FOR ROLE-BASED ACCESS
-- =============================================

-- Function to check if user has permission
DROP FUNCTION IF EXISTS public.user_has_permission(uuid, VARCHAR);
CREATE FUNCTION public.user_has_permission(p_user_id UUID, p_permission VARCHAR)
RETURNS BOOLEAN AS $$
DECLARE
    v_has_permission BOOLEAN;
    v_role_permissions JSONB;
BEGIN
    SELECT rd.permissions -> p_permission::text INTO v_has_permission
    FROM public.cmms_user_role_profiles urp
    JOIN public.cmms_role_definitions rd ON urp.primary_role_id = rd.id
    WHERE urp.cmms_user_id = p_user_id
    AND urp.is_primary_profile = TRUE
    AND urp.status = 'active'
    LIMIT 1;
    
    RETURN COALESCE(v_has_permission, FALSE);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get user's primary role
DROP FUNCTION IF EXISTS public.get_user_primary_role(uuid);
CREATE FUNCTION public.get_user_primary_role(p_user_id UUID)
RETURNS TABLE(role_name VARCHAR, role_level INTEGER, permissions JSONB) AS $$
BEGIN
    RETURN QUERY
    SELECT rd.role_name, rd.role_level, rd.permissions
    FROM public.cmms_user_role_profiles urp
    JOIN public.cmms_role_definitions rd ON urp.primary_role_id = rd.id
    WHERE urp.cmms_user_id = p_user_id
    AND urp.is_primary_profile = TRUE
    AND urp.status = 'active'
    LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to log permission usage
DROP FUNCTION IF EXISTS public.log_permission_usage(uuid, VARCHAR, VARCHAR, uuid, BOOLEAN, TEXT);
CREATE FUNCTION public.log_permission_usage(
    p_user_id UUID,
    p_permission VARCHAR,
    p_resource_type VARCHAR,
    p_resource_id UUID,
    p_was_successful BOOLEAN,
    p_denial_reason TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_company_id UUID;
    v_audit_id UUID;
BEGIN
    -- Get user's company
    SELECT cmms_company_id INTO v_company_id
    FROM public.cmms_users
    WHERE id = p_user_id
    LIMIT 1;
    
    -- Log the permission usage
    INSERT INTO public.cmms_role_permission_audit (
        cmms_company_id,
        cmms_user_id,
        permission_name,
        action,
        resource_type,
        resource_id,
        was_successful,
        denial_reason
    ) VALUES (
        v_company_id,
        p_user_id,
        p_permission,
        CASE WHEN p_was_successful THEN 'used' ELSE 'denied' END,
        p_resource_type,
        p_resource_id,
        p_was_successful,
        p_denial_reason
    ) RETURNING id INTO v_audit_id;
    
    RETURN v_audit_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================
-- VIEWS FOR EASY ACCESS
-- =============================================

-- View: Complete user role profile with permissions
DROP VIEW IF EXISTS public.vw_user_role_profiles;
CREATE VIEW public.vw_user_role_profiles AS
SELECT
    urp.id,
    urp.cmms_company_id,
    urp.cmms_user_id,
    cu.full_name as user_name,
    cu.email as user_email,
    cu.phone as user_phone,
    urp.profile_name,
    urp.description,
    rd.role_name,
    rd.role_label,
    rd.role_level,
    rd.role_icon,
    rd.role_color,
    rd.permissions,
    urp.use_custom_permissions,
    urp.custom_permissions,
    CASE 
        WHEN urp.use_custom_permissions THEN 
            rd.permissions::jsonb || urp.custom_permissions::jsonb
        ELSE 
            rd.permissions
    END as effective_permissions,
    urp.assigned_department_id,
    cd.department_name,
    urp.data_access_level,
    urp.status,
    urp.is_primary_profile,
    urp.created_at,
    urp.updated_at
FROM public.cmms_user_role_profiles urp
JOIN public.cmms_users cu ON urp.cmms_user_id = cu.id
JOIN public.cmms_role_definitions rd ON urp.primary_role_id = rd.id
LEFT JOIN public.cmms_departments cd ON urp.assigned_department_id = cd.id;

-- View: Role permissions summary
DROP VIEW IF EXISTS public.vw_role_permissions_summary;
CREATE VIEW public.vw_role_permissions_summary AS
SELECT
    rd.id as role_id,
    rd.cmms_company_id,
    rd.role_name,
    rd.role_label,
    rd.role_level,
    COUNT(DISTINCT urp.id) as users_with_role,
    COUNT(DISTINCT CASE WHEN urp.status = 'active' THEN urp.id END) as active_users,
    json_object_keys(rd.permissions) as permission_name,
    rd.permissions -> (json_object_keys(rd.permissions))::text as permission_value
FROM public.cmms_role_definitions rd
LEFT JOIN public.cmms_user_role_profiles urp ON rd.id = urp.primary_role_id
GROUP BY rd.id, rd.cmms_company_id, rd.role_name, rd.role_label, rd.role_level;

-- =============================================
-- DEFAULT SYSTEM ROLES
-- =============================================

-- This will be populated via a separate migration/initialization script
-- to ensure company-specific role definitions

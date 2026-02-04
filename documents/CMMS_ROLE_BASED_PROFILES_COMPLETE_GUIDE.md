# CMMS Role-Based Profile System - Complete Implementation Guide

## Overview

The CMMS Role-Based Profile System extends the proven Business Profile pattern to create sophisticated role-based access control with the following capabilities:

```
Business Profile Pattern → CMMS Role-Based Profiles
├─ 3-step wizard       ├─ 4-step wizard (Role → Permissions → Delegation → Review)
├─ Co-owner management ├─ Permission customization
├─ Ownership shares    ├─ Department assignment
└─ Profile switching   └─ Role delegation & inheritance
```

## System Architecture

### Database Schema (CMMS_ROLE_BASED_PROFILES.sql)

#### 1. **cmms_role_definitions** Table
- **Purpose**: Define all available roles with permissions
- **Key Fields**:
  - `role_name`: 'Admin', 'Coordinator', 'Supervisor', etc.
  - `role_level`: Integer 0-7 (hierarchy)
  - `permissions`: JSONB with permission flags
  - `is_system_role`: Cannot be deleted if TRUE

```javascript
{
  "canViewCompany": true,
  "canEditCompany": true,
  "canManageUsers": true,
  "canAssignRoles": true,
  "canViewInventory": true,
  "canEditInventory": true,
  "canDeleteUsers": true,
  "canViewFinancials": true,
  "canManageServiceProviders": true,
  "canCreateWorkOrders": true,
  "canViewAllData": true,
  "canApproveRequisitions": true,
  "canRejectRequisitions": true,
  "canCompleteWorkOrders": true,
  "canViewReports": true,
  "canExportData": true
}
```

#### 2. **cmms_user_role_profiles** Table
- **Purpose**: User-specific role configuration
- **Key Fields**:
  - `primary_role_id`: Main role assignment
  - `secondary_roles`: Additional roles (JSONB array)
  - `use_custom_permissions`: Override specific permissions
  - `custom_permissions`: Override values
  - `assigned_department_id`: Department restriction
  - `restricted_to_locations`: Location-based access
  - `data_access_level`: own_only → department_only → company_only → all
  - `can_delegate_permissions`: Allow delegation
  - `delegated_to_users`: Who can act on behalf
  - `status`: active, inactive, suspended, pending

#### 3. **cmms_role_permission_audit** Table
- **Purpose**: Track all permission changes and usage
- **Key Fields**:
  - `permission_name`: Which permission
  - `action`: granted, revoked, used, denied, expired
  - `resource_type`: inventory, work_order, requisition, report
  - `was_successful`: TRUE/FALSE
  - `denial_reason`: Why denied (if applicable)
  - IP address, device info for security

#### 4. **cmms_role_activity_logs** Table
- **Purpose**: Audit trail of all user actions
- **Key Fields**:
  - `activity_type`: view, create, update, delete, export, sign, approve
  - `resource_type` & `resource_id`: What was accessed
  - `old_value` & `new_value`: Change tracking
  - Session tracking, IP address, device fingerprint

### Helper Functions

```sql
-- Check if user has specific permission
user_has_permission(user_id UUID, permission VARCHAR) → BOOLEAN

-- Get user's complete role with all permissions
get_user_primary_role(user_id UUID) → TABLE(role_name, role_level, permissions)

-- Log permission usage for audit
log_permission_usage(
  user_id UUID,
  permission VARCHAR,
  resource_type VARCHAR,
  resource_id UUID,
  was_successful BOOLEAN,
  denial_reason TEXT
) → UUID
```

### Views for Easy Access

```sql
-- Complete user role profile with merged permissions
vw_user_role_profiles

-- Role permissions summary with user counts
vw_role_permissions_summary
```

## Frontend Components

### 1. CMSSRoleBasedProfileForm.jsx

**4-Step Wizard Pattern** (exactly like BusinessProfileForm):

#### Step 1: Role Selection
```jsx
// Select primary role from company's defined roles
// Enter custom profile name & description
// Assign to department (optional)
// Choose data access level

→ Output: selectedRole, profileData
```

#### Step 2: Permission Customization
```jsx
// View all permissions from selected role
// Toggle "Use Custom Permissions"
// If enabled: individual permission toggles
// Combine base role + custom overrides

→ Output: customPermissions, useCustomPermissions
```

#### Step 3: Delegation (Optional)
```jsx
// Toggle "Enable Delegation"
// Add users who can act on behalf
// Remove delegates
// Configure delegation scope

→ Output: delegatedUsers, canDelegate
```

#### Step 4: Review & Create
```jsx
// Review all settings
// Visual confirmation of:
//   - Profile name & description
//   - Primary role & level
//   - Effective permissions
//   - Access restrictions
//   - Delegates

→ Output: Create/Update profile in database
```

**Key Features**:
- 3-step form with navigation
- Real-time permission preview
- Department/location filtering
- Delegate management
- Edit existing profiles
- Input validation
- Error handling

### 2. CMSSRoleBasedProfileSelector.jsx

**Profile Management Interface** (like BusinessProfileSelector):

**Display Features**:
- List all user role profiles
- Search by profile/user name
- Filter by role
- Status indicators (Active/Inactive/Suspended/Pending)
- Primary profile badge
- Quick permission preview (top 6 permissions shown)

**Expandable Details**:
```
Profile Card (Collapsed)
├─ Profile name
├─ User name & email
├─ Primary role
└─ Department (if assigned)

↓ (Click to expand)

Profile Card (Expanded)
├─ Description
├─ All permissions (with badge count)
├─ Data access level
├─ Created/Updated dates
└─ Actions: Select, Edit, Delete
```

**Key Features**:
- Real-time search & filtering
- Expandable cards
- Current profile highlighting
- Quick select/edit/delete
- Status color coding
- Permission summary with "more" indicator
- Loading states

## Integration with CMSSModule

### How to Add Role-Based Profiles to CMSSModule:

```jsx
// In CMSSModule.jsx

// 1. Add state for role profiles
const [userRoleProfile, setUserRoleProfile] = useState(null);
const [showRoleProfileForm, setShowRoleProfileForm] = useState(false);
const [showRoleProfileSelector, setShowRoleProfileSelector] = useState(false);

// 2. Load user's primary role profile on mount
useEffect(() => {
  loadUserRoleProfile();
}, [userCompanyId]);

const loadUserRoleProfile = async () => {
  const { data, error } = await supabase
    .from('vw_user_role_profiles')
    .select('*')
    .eq('cmms_user_id', currentUserId)
    .eq('is_primary_profile', true)
    .single();
  
  if (data) setUserRoleProfile(data);
};

// 3. Use in permission checks
const hasPermission = (permission) => {
  return userRoleProfile?.effective_permissions?.[permission] || false;
};

// 4. Show profile selector if multiple profiles exist
{!userRoleProfile && (
  <CMSSRoleBasedProfileSelector
    companyId={userCompanyId}
    onSelect={setUserRoleProfile}
    onEdit={handleEditProfile}
    onDelete={handleDeleteProfile}
  />
)}

// 5. Admin can create new profiles
{hasPermission('canAssignRoles') && (
  <CMSSRoleBasedProfileForm
    companyId={userCompanyId}
    userId={selectedUserId}
    onProfileCreated={handleProfileCreated}
  />
)}
```

## How It Works: Complete Workflow

### Scenario 1: Admin Creating Role Profiles for Team

```
Admin User Login
├─ CMSSModule loads
├─ Checks permissions
└─ Is Admin → Full access

Admin Action: "Manage User Roles"
├─ Opens Role-Based Profile Manager
├─ Sees existing profiles
└─ Clicks "Create New Profile"

Step 1: Role Selection
├─ Searches for user: "Sarah"
├─ Selects from available roles: "Technician"
├─ Enters profile name: "Senior Field Technician"
├─ Assigns to department: "Maintenance"
└─ Sets data access: "company_only"

Step 2: Customize Permissions
├─ Base role permissions shown
├─ Toggles "Use Custom Permissions"
├─ Enables extra: "canApproveRequisitions"
├─ Disables some: "canDeleteUsers"
└─ System merges base + custom

Step 3: Delegation
├─ Enables delegation
├─ Adds "John" as delegate
├─ Adds "Mike" as delegate
└─ These users can act on behalf

Step 4: Review
├─ Shows complete profile summary
├─ Admin verifies all details
└─ Clicks "Create Profile"

Result:
├─ Profile saved to database
├─ Sarah receives notification
├─ Sarah can now log in as "Senior Field Technician"
├─ John & Mike can act on behalf
└─ All actions logged in audit table
```

### Scenario 2: User with Multiple Profiles

```
User: "Alex" has 3 profiles:
1. "Financial Analyst" (Primary) ⭐
   - Role: Finance Officer
   - Permissions: viewFinancials, viewReports
   - Department: Finance

2. "Department Coordinator"
   - Role: Coordinator
   - Permissions: manageUsers, assignRoles
   - Department: Maintenance

3. "Inventory Manager" (Inactive)
   - Role: Storeman
   - Permissions: viewInventory, editInventory
   - Department: Warehouse

When Alex logs in:
├─ Primary profile loaded
├─ Dashboard shows Finance view
├─ Menu shows available options for "Financial Analyst"
└─ Alex can switch to another profile
    ├─ Clicks "Switch Role"
    ├─ Sees "Department Coordinator" option
    ├─ Selects it
    └─ UI updates to Coordinator permissions
```

### Scenario 3: Permission Delegation in Action

```
Normal:
John (Admin) → Can approve requisitions

Delegation:
John delegates "canApproveRequisitions" to Sarah
├─ Sarah now sees "Approve Requisitions" button
├─ Sarah clicks to approve
├─ Action logged: Sarah used permission via delegation
├─ Audit shows: "Delegated from John"
└─ John can revoke anytime

Advanced:
├─ John delegates to Sarah
├─ Sarah delegates to Mike
├─ Mike uses permission (2-level delegation)
└─ Audit trail: Mike ← Sarah ← John
```

## Permission Matrix

### Standard Roles & Their Permissions

```
┌─────────────────┬───────────────────────────────────────────┐
│ Role            │ Key Permissions                           │
├─────────────────┼───────────────────────────────────────────┤
│ Admin (Lvl 7)   │ ✓ All permissions (view, edit, delete)   │
│                 │ ✓ Create roles, manage users              │
│                 │ ✓ View all data, export reports           │
├─────────────────┼───────────────────────────────────────────┤
│ Coordinator     │ ✓ View company info                       │
│ (Lvl 5)         │ ✓ Manage users (no delete)                │
│                 │ ✓ View inventory                          │
│                 │ ✓ Create work orders                      │
│                 │ ✓ View reports                            │
├─────────────────┼───────────────────────────────────────────┤
│ Supervisor      │ ✓ View company & inventory                │
│ (Lvl 3)         │ ✓ Create work orders                      │
│                 │ ✓ Approve requisitions                    │
│                 │ ✗ Manage users, edit company              │
├─────────────────┼───────────────────────────────────────────┤
│ Technician      │ ✓ View company & inventory                │
│ (Lvl 2)         │ ✓ Create work orders                      │
│                 │ ✗ Approve, delete, manage users           │
├─────────────────┼───────────────────────────────────────────┤
│ Storeman        │ ✓ View inventory                          │
│ (Lvl 1)         │ ✓ Edit inventory                          │
│                 │ ✗ Delete, approve, manage users           │
├─────────────────┼───────────────────────────────────────────┤
│ Finance         │ ✓ View financials                         │
│ (Lvl 4)         │ ✓ View reports                            │
│                 │ ✗ Edit inventory, manage users            │
├─────────────────┼───────────────────────────────────────────┤
│ Service Provider│ ✓ View company & inventory                │
│ (Lvl 1)         │ ✓ Create work orders                      │
│                 │ ✗ Manage users, view financials           │
└─────────────────┴───────────────────────────────────────────┘
```

## API & Services

### Service Methods (Backend)

```javascript
// Create role-based profile
createRoleBasedProfile(profileData)
  ├─ Validates: company_id, user_id, primary_role
  ├─ Merges: custom permissions with role permissions
  └─ Returns: created profile with effective_permissions

// Update role-based profile
updateRoleBasedProfile(profileId, updates)
  ├─ Validates: only admin can update
  ├─ Logs: what changed
  └─ Audits: all permission changes

// Get user's active role profile
getUserActiveRoleProfile(userId, companyId)
  ├─ Loads: primary profile with role details
  ├─ Computes: effective permissions
  └─ Returns: complete profile object

// Check permission
checkUserPermission(userId, permission)
  ├─ Loads: user's role profile
  ├─ Checks: base role + custom overrides
  ├─ Validates: not suspended/expired
  └─ Logs: permission check (for audit)

// Get audit trail
getRoleAuditTrail(companyId, userId, days = 30)
  ├─ Returns: all permission usage
  ├─ Filters: by time period
  └─ Includes: denied attempts
```

## Security Considerations

### Row-Level Security (RLS)

```sql
-- Users can only see their own profiles
-- Admins can see all company profiles
-- Suspended profiles hidden from non-admins
-- Deleted profiles permanently archived
```

### Permission Hierarchy

```
User can perform action IF:
├─ Account active AND
├─ Role not suspended AND
├─ Role not expired AND
├─ Has required permission (base OR custom) AND
├─ Data access level allows AND
├─ Location/department matches (if restricted)
└─ All checks logged in audit table
```

### Audit Logging

```
Every action logged:
├─ WHO: user_id, user_name
├─ WHAT: permission_name, action_type
├─ WHEN: exact timestamp
├─ WHERE: IP address, device_fingerprint
├─ WHY: resource_type, resource_id
├─ RESULT: success/failure + reason
└─ HOW: delegation chain if applicable
```

## Testing Checklist

- [ ] Create role definition (admin only)
- [ ] Create user role profile (admin only)
- [ ] Edit profile permissions (admin only)
- [ ] Add/remove delegates
- [ ] Switch between profiles (if multiple)
- [ ] Test permission checks (UI & API)
- [ ] Verify permission denied correctly
- [ ] Check audit trail creation
- [ ] Test delegation usage
- [ ] Verify role expiration
- [ ] Test profile deletion (if allowed)
- [ ] Check RLS policies work
- [ ] Test with suspended profile
- [ ] Verify inactive profile blocks access

## Migration & Setup

### 1. Initialize Database Schema
```bash
psql -f CMMS_ROLE_BASED_PROFILES.sql
```

### 2. Create System Roles (One-time)
```javascript
// Seed system roles for company
const systemRoles = [
  { role_name: 'Admin', role_level: 7, ... },
  { role_name: 'Coordinator', role_level: 5, ... },
  // ... etc
];

// Use insert for each company
```

### 3. Import Components
```javascript
import CMSSRoleBasedProfileForm from './CMSSRoleBasedProfileForm';
import CMSSRoleBasedProfileSelector from './CMSSRoleBasedProfileSelector';
```

### 4. Update CMSSModule
Add role profile management to existing tabs

## Comparison: Business Profile vs CMMS Roles

```
Feature                 │ Business Profile │ CMMS Roles
────────────────────────┼─────────────────┼──────────────────
Primary Purpose         │ Multi-entity    │ Single org hierarchy
Main Entity             │ Business entity │ User role
Co-ownership/Delegates  │ ✓ Co-owners     │ ✓ Delegates
Verification Required   │ ✓ Email verify  │ ✓ ICAN verify
Customization          │ Co-owner shares │ Custom permissions
Inheritance            │ ✓ Via ownership │ ✓ Via delegation
Audit Trail            │ Basic          │ Comprehensive
Location-based Access  │ ✗              │ ✓
Department Assignments │ ✗              │ ✓
Data Access Levels     │ ✗              │ ✓
Time-based Expiry      │ ✗              │ ✓
Suspension/Revocation  │ ✗              │ ✓
```

## Next Steps

1. **Initialize system roles** for your company
2. **Test role creation** with test users
3. **Configure permission matrix** for your workflow
4. **Set up delegation chains** for approval flows
5. **Enable audit logging** for compliance
6. **Train admins** on role management
7. **Monitor audit trail** regularly for security

## Support & Documentation

- Full SQL: `CMMS_ROLE_BASED_PROFILES.sql`
- Frontend Form: `CMSSRoleBasedProfileForm.jsx`
- Frontend Selector: `CMSSRoleBasedProfileSelector.jsx`
- Usage: Integrate into `CMSSModule.jsx`

# CMMS Role-Based Profile System - Quick Reference

## Files Created

### 1. **CMMS_ROLE_BASED_PROFILES.sql** (Database)
- **Location**: `backend/db/schemas/CMMS_ROLE_BASED_PROFILES.sql`
- **Purpose**: Complete database schema with 4 main tables + helper functions + views
- **Tables**:
  - `cmms_role_definitions` - Role setup with permissions
  - `cmms_user_role_profiles` - User-specific role configuration
  - `cmms_role_permission_audit` - Permission change tracking
  - `cmms_role_activity_logs` - User action audit trail
- **Functions**:
  - `user_has_permission()` - Check single permission
  - `get_user_primary_role()` - Get role with permissions
  - `log_permission_usage()` - Log permission attempts
- **Views**:
  - `vw_user_role_profiles` - Complete profile with merged permissions
  - `vw_role_permissions_summary` - Permission statistics

### 2. **CMSSRoleBasedProfileForm.jsx** (Frontend Component)
- **Location**: `frontend/src/components/CMSSRoleBasedProfileForm.jsx`
- **Purpose**: 4-step wizard form for creating/editing role profiles
- **Steps**:
  1. **Role Selection** - Pick primary role, set profile name, assign department
  2. **Permission Customization** - Override specific permissions
  3. **Delegation** - Add users who can act on behalf
  4. **Review** - Confirm all settings before saving
- **Features**:
  - Real-time permission preview
  - Department/location filtering
  - Delegate management
  - Edit existing profiles
  - Input validation & error handling

### 3. **CMSSRoleBasedProfileSelector.jsx** (Frontend Component)
- **Location**: `frontend/src/components/CMSSRoleBasedProfileSelector.jsx`
- **Purpose**: View and manage all user role profiles
- **Features**:
  - Search by profile/user name
  - Filter by role
  - Expandable profile cards
  - Status indicators (Active/Inactive/Suspended/Pending)
  - Primary profile badge
  - Quick permission preview
  - Select/Edit/Delete actions
  - Current profile highlighting

### 4. **cmmsRoleService.js** (Service Layer)
- **Location**: `frontend/src/lib/services/cmmsRoleService.js`
- **Purpose**: All role-based permission functions
- **Key Functions**:
  - `getUserActiveRoleProfile()` - Load active role profile
  - `userHasPermission()` - Check single permission
  - `getUserPermissions()` - Get all user permissions
  - `userHasAllPermissions()` - Check multiple permissions (AND)
  - `checkPermissionWithContext()` - Check with data access rules
  - `logPermissionUsage()` - Log to audit table
  - `logActivity()` - Log user action
  - `getUserAuditTrail()` - Get activity history
  - `getPermissionChangeHistory()` - Get permission changes
  - `getRoleDefinitions()` - List all roles
  - `canUserDelegate()` - Check delegation capability

### 5. **CMMS_ROLE_BASED_PROFILES_COMPLETE_GUIDE.md** (Documentation)
- **Location**: `ICAN/CMMS_ROLE_BASED_PROFILES_COMPLETE_GUIDE.md`
- **Content**:
  - System architecture overview
  - Database schema explanation
  - Component usage guide
  - Workflow scenarios
  - Permission matrix
  - Security considerations
  - Testing checklist
  - Migration & setup steps
  - Comparison with Business Profile

## Implementation Steps

### Step 1: Database Setup
```bash
# Run the SQL schema file
psql -f backend/db/schemas/CMMS_ROLE_BASED_PROFILES.sql
```

### Step 2: Create System Roles
```javascript
// In a seed file or migration
const systemRoles = [
  {
    cmms_company_id: company_id,
    role_name: 'Admin',
    role_label: 'Administrator',
    role_level: 7,
    role_icon: '👑',
    role_color: 'from-red-500 to-pink-600',
    permissions: { /* all true */ },
    is_system_role: true
  },
  // ... more roles
];

await supabase
  .from('cmms_role_definitions')
  .insert(systemRoles);
```

### Step 3: Import Components in CMSSModule
```javascript
import CMSSRoleBasedProfileForm from './CMSSRoleBasedProfileForm';
import CMSSRoleBasedProfileSelector from './CMSSRoleBasedProfileSelector';
import cmmsRoleService from '../lib/services/cmmsRoleService';

// In CMSSModule.jsx
const [userRoleProfile, setUserRoleProfile] = useState(null);
const [showRoleForm, setShowRoleForm] = useState(false);

// Load user's active profile
useEffect(() => {
  const loadProfile = async () => {
    const result = await cmmsRoleService.getUserActiveRoleProfile(userId, companyId);
    if (result.success) {
      setUserRoleProfile(result.data);
    }
  };
  loadProfile();
}, [userId, companyId]);
```

### Step 4: Use in Permission Checks
```javascript
// Check single permission
const canEdit = await cmmsRoleService.userHasPermission(
  userId,
  'canEditInventory',
  companyId
);

// Check multiple permissions (all required)
const canManage = await cmmsRoleService.userHasAllPermissions(
  userId,
  ['canManageUsers', 'canAssignRoles'],
  companyId
);

// Check with context (data access level)
const result = await cmmsRoleService.checkPermissionWithContext(
  userId,
  'canEditInventory',
  'inventory',
  itemId,
  companyId
);

if (result.allowed) {
  // Perform action
  await cmmsRoleService.logActivity(
    userId,
    'update',
    'inventory',
    itemId,
    itemName,
    oldValue,
    newValue,
    companyId
  );
} else {
  alert('Access denied: ' + result.reason);
  await cmmsRoleService.logPermissionUsage(
    userId,
    'canEditInventory',
    'inventory',
    itemId,
    false,
    result.reason,
    companyId
  );
}
```

### Step 5: Show in UI
```javascript
// Show role profile selector for admins
{userRole === 'admin' && (
  <CMSSRoleBasedProfileSelector
    companyId={companyId}
    currentProfileId={userRoleProfile?.id}
    onSelect={setUserRoleProfile}
    onEdit={handleEditProfile}
    onDelete={handleDeleteProfile}
  />
)}

// Show form to create new profile
{showRoleForm && (
  <CMSSRoleBasedProfileForm
    companyId={companyId}
    userId={targetUserId}
    onProfileCreated={handleProfileCreated}
    onCancel={() => setShowRoleForm(false)}
  />
)}
```

## Usage Examples

### Example 1: Check Permission Before Showing UI Element
```javascript
const [canApprove, setCanApprove] = useState(false);

useEffect(() => {
  const checkPermission = async () => {
    const hasIt = await cmmsRoleService.userHasPermission(
      currentUser.id,
      'canApproveRequisitions',
      companyId
    );
    setCanApprove(hasIt);
  };
  checkPermission();
}, [currentUser, companyId]);

// In JSX
{canApprove && (
  <button onClick={approveRequisition}>
    Approve Requisition
  </button>
)}
```

### Example 2: Log Permission Attempt
```javascript
const handleApproveClick = async (requisitionId) => {
  // Check permission
  const allowed = await cmmsRoleService.userHasPermission(
    userId,
    'canApproveRequisitions',
    companyId
  );

  if (allowed) {
    // Perform action
    await approveRequisition(requisitionId);
    
    // Log success
    await cmmsRoleService.logPermissionUsage(
      userId,
      'canApproveRequisitions',
      'requisition',
      requisitionId,
      true
    );
  } else {
    // Log denial
    await cmmsRoleService.logPermissionUsage(
      userId,
      'canApproveRequisitions',
      'requisition',
      requisitionId,
      false,
      'User does not have permission'
    );
    alert('You do not have permission to approve requisitions');
  }
};
```

### Example 3: Audit Trail Query
```javascript
const viewAuditTrail = async (userId) => {
  const { success, data } = await cmmsRoleService.getUserAuditTrail(
    userId,
    companyId,
    30 // last 30 days
  );

  if (success) {
    data.forEach(log => {
      console.log(`${log.activity_type}: ${log.resource_type} at ${log.created_at}`);
    });
  }
};
```

## Quick Comparison Table

| Feature | Business Profile | CMMS Roles |
|---------|------------------|-----------|
| Create Form | 3 steps | 4 steps |
| Main Entity | Business entity | User role |
| Co-ownership | ✓ (Co-owners) | ✓ (Delegates) |
| Customization | Ownership % | Permissions |
| Hierarchy | ✓ (Ownership chain) | ✓ (Delegation chain) |
| Audit | Basic | Comprehensive |
| Expiration | ✗ | ✓ |
| Location-based | ✗ | ✓ |
| Department-based | ✗ | ✓ |

## Permission Reference

### View-Only Permissions
- `canViewCompany`
- `canViewInventory`
- `canViewFinancials`
- `canViewReports`
- `canViewAllData`

### Edit Permissions
- `canEditCompany`
- `canEditInventory`

### Management Permissions
- `canManageUsers`
- `canManageServiceProviders`
- `canAssignRoles`
- `canDeleteUsers`

### Action Permissions
- `canCreateWorkOrders`
- `canApproveRequisitions`
- `canRejectRequisitions`
- `canCompleteWorkOrders`
- `canExportData`

## Security Checklist

- [ ] Verify RLS policies enabled on all tables
- [ ] Test permission denial scenarios
- [ ] Verify audit logs are created
- [ ] Check delegation works correctly
- [ ] Test profile suspension/expiration
- [ ] Verify data access level restrictions
- [ ] Check location/department filtering
- [ ] Monitor permission change history
- [ ] Test permission inheritance
- [ ] Verify activity logs are comprehensive

## Troubleshooting

### Issue: Permission always returns false
**Solution**: 
1. Check user has active role profile
2. Verify profile status is 'active'
3. Check role has permission enabled
4. Check custom permissions override isn't disabling it

### Issue: Audit logs not appearing
**Solution**:
1. Verify table has data
2. Check RLS policies allow insert
3. Ensure function is being called
4. Check for database errors

### Issue: Delegation not working
**Solution**:
1. Verify `can_delegate_permissions = true`
2. Check delegates are in `delegated_to_users` array
3. Verify delegates have active role profile
4. Check permission inheritance in role

## Next Steps

1. Run database schema migration
2. Create system roles for your company
3. Test with sample users
4. Train admins on role management
5. Enable audit logging
6. Monitor permission changes
7. Set up regular access reviews

## Support

- **Full Guide**: `CMMS_ROLE_BASED_PROFILES_COMPLETE_GUIDE.md`
- **Database**: `backend/db/schemas/CMMS_ROLE_BASED_PROFILES.sql`
- **Components**: `CMSSRoleBasedProfileForm.jsx` & `CMSSRoleBasedProfileSelector.jsx`
- **Service**: `cmmsRoleService.js`

/**
 * CMMS Role-Based Integration Example
 * 
 * Shows how to integrate the role-based profile system into CMSSModule
 * Copy/modify these patterns for your implementation
 */

// ============================================
// 1. IMPORTS
// ============================================
import CMSSRoleBasedProfileForm from './CMSSRoleBasedProfileForm';
import CMSSRoleBasedProfileSelector from './CMSSRoleBasedProfileSelector';
import cmmsRoleService from '../lib/services/cmmsRoleService';

// ============================================
// 2. ADD STATE TO CMMSModule
// ============================================

// In the CMMSModule component definition:
const CMMSModule = ({ onDataUpdate, netWorth, currentJourneyStage, user = null }) => {
  // Existing state...
  const [userRole, setUserRole] = useState(null);
  const [userCompanyId, setUserCompanyId] = useState(null);
  
  // NEW: Role-based profile state
  const [userRoleProfile, setUserRoleProfile] = useState(null);
  const [showRoleProfileForm, setShowRoleProfileForm] = useState(false);
  const [showRoleProfileSelector, setShowRoleProfileSelector] = useState(false);
  const [editingRoleProfile, setEditingRoleProfile] = useState(null);
  const [roleProfiles, setRoleProfiles] = useState([]);
  const [loadingRoleProfile, setLoadingRoleProfile] = useState(false);

  // ... rest of existing state

  // ============================================
  // 3. LOAD USER'S ACTIVE ROLE PROFILE
  // ============================================

  useEffect(() => {
    const loadRoleProfile = async () => {
      if (!user?.id || !userCompanyId) return;

      setLoadingRoleProfile(true);
      try {
        console.log('🔐 Loading role profile for user:', user.id);
        const result = await cmmsRoleService.getUserActiveRoleProfile(user.id, userCompanyId);

        if (result.success && result.data) {
          setUserRoleProfile(result.data);
          console.log('✅ Role profile loaded:', result.data.profile_name);
        } else {
          console.log('ℹ️ No active role profile found, showing selector');
          setShowRoleProfileSelector(true);
        }
      } catch (error) {
        console.error('❌ Error loading role profile:', error);
      } finally {
        setLoadingRoleProfile(false);
      }
    };

    loadRoleProfile();
  }, [user?.id, userCompanyId]);

  // ============================================
  // 4. LOAD ALL ROLE PROFILES (for admin view)
  // ============================================

  const loadAllRoleProfiles = async () => {
    if (!userCompanyId) return;

    try {
      console.log('📋 Loading all role profiles for company');
      const { data, error } = await supabase
        .from('vw_user_role_profiles')
        .select('*')
        .eq('cmms_company_id', userCompanyId)
        .order('is_primary_profile', { ascending: false });

      if (error) throw error;
      setRoleProfiles(data || []);
      console.log('✅ Loaded', data?.length || 0, 'role profiles');
    } catch (error) {
      console.error('❌ Error loading profiles:', error);
      alert('Error loading role profiles: ' + error.message);
    }
  };

  // Load profiles when admin opens the role management tab
  useEffect(() => {
    if (activeTab === 'roles' && hasPermission('canAssignRoles')) {
      loadAllRoleProfiles();
    }
  }, [activeTab]);

  // ============================================
  // 5. ENHANCED PERMISSION CHECKS
  // ============================================

  /**
   * Check if user has permission with role profile
   * Now uses both old permission matrix AND new role profiles
   */
  const hasPermission = async (permission) => {
    // Try new role-based system first
    if (userRoleProfile) {
      const result = await cmmsRoleService.userHasPermission(
        user.id,
        permission,
        userCompanyId
      );
      if (result) return true;
    }

    // Fallback to old permission matrix if no role profile
    return rolePermissions[userRole]?.[permission] || false;
  };

  /**
   * Check permission with context (data access level)
   */
  const hasPermissionWithContext = async (permission, resourceType, resourceId) => {
    if (!userRoleProfile) return false;

    const result = await cmmsRoleService.checkPermissionWithContext(
      user.id,
      permission,
      resourceType,
      resourceId,
      userCompanyId
    );

    // Log the check
    if (!result.allowed) {
      await cmmsRoleService.logPermissionUsage(
        user.id,
        permission,
        resourceType,
        resourceId,
        false,
        result.reason,
        userCompanyId
      );
    }

    return result.allowed;
  };

  /**
   * Log user activity
   */
  const logUserActivity = async (activityType, resourceType, resourceId, resourceName, oldVal, newVal) => {
    if (!userRoleProfile) return;

    await cmmsRoleService.logActivity(
      user.id,
      activityType,
      resourceType,
      resourceId,
      resourceName,
      oldVal,
      newVal,
      userCompanyId
    );
  };

  // ============================================
  // 6. HANDLERS FOR ROLE PROFILE MANAGEMENT
  // ============================================

  const handleCreateRoleProfile = async () => {
    setShowRoleProfileForm(true);
    setEditingRoleProfile(null);
  };

  const handleEditRoleProfile = (profile) => {
    setEditingRoleProfile(profile);
    setShowRoleProfileForm(true);
    setShowRoleProfileSelector(false);
  };

  const handleDeleteRoleProfile = async (profileId) => {
    if (!confirm('Delete this role profile? This cannot be undone.')) return;

    try {
      const { error } = await supabase
        .from('cmms_user_role_profiles')
        .delete()
        .eq('id', profileId)
        .eq('cmms_company_id', userCompanyId);

      if (error) throw error;

      console.log('✅ Profile deleted');
      setRoleProfiles(roleProfiles.filter(p => p.id !== profileId));
      alert('Role profile deleted successfully');
    } catch (error) {
      console.error('❌ Error deleting profile:', error);
      alert('Error: ' + error.message);
    }
  };

  const handleSelectRoleProfile = async (profile) => {
    try {
      const { error } = await supabase
        .from('cmms_user_role_profiles')
        .update({ is_primary_profile: true })
        .eq('id', profile.id)
        .eq('cmms_company_id', userCompanyId);

      if (error) throw error;

      setUserRoleProfile(profile);
      setShowRoleProfileSelector(false);
      console.log('✅ Role profile switched to:', profile.profile_name);
      alert(`Switched to: ${profile.profile_name}`);
    } catch (error) {
      console.error('❌ Error switching profile:', error);
      alert('Error: ' + error.message);
    }
  };

  const handleProfileFormSubmit = (profile) => {
    setUserRoleProfile(profile);
    setShowRoleProfileForm(false);
    setEditingRoleProfile(null);
    loadAllRoleProfiles(); // Refresh list
    console.log('✅ Profile form submitted, refreshing list');
  };

  // ============================================
  // 7. ADD ROLE MANAGEMENT TAB
  // ============================================

  // In your tab filter/display logic:
  const getTabs = () => {
    const baseTabs = ['company', 'users', 'inventory', 'requisitions', 'reports'];
    
    // Add roles tab for admins with role-based system
    if (hasPermission('canAssignRoles')) {
      baseTabs.push('roles');
    }

    return baseTabs;
  };

  // ============================================
  // 8. ADD ROLE MANAGEMENT COMPONENT
  // ============================================

  const RoleBasedProfileManager = () => {
    // Check permission
    if (!hasPermission('canAssignRoles')) {
      return (
        <div className="glass-card p-6 bg-orange-500 bg-opacity-10 border-l-4 border-orange-500">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-6 h-6 text-orange-400" />
            <div>
              <p className="text-orange-300 font-semibold">🔒 Access Restricted</p>
              <p className="text-gray-400 text-sm mt-1">Only Administrators can manage role-based profiles.</p>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-6">
        {/* Header with create button */}
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-white">🔐 Role-Based Profiles</h2>
          <button
            onClick={handleCreateRoleProfile}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-semibold flex items-center gap-2 transition"
          >
            <Plus className="w-4 h-4" />
            New Profile
          </button>
        </div>

        {/* Role Profile Form */}
        {showRoleProfileForm ? (
          <CMSSRoleBasedProfileForm
            companyId={userCompanyId}
            userId={user.id}
            editingProfile={editingRoleProfile}
            onProfileCreated={handleProfileFormSubmit}
            onCancel={() => {
              setShowRoleProfileForm(false);
              setEditingRoleProfile(null);
            }}
          />
        ) : (
          <>
            {/* Current Profile Display */}
            {userRoleProfile && (
              <div className="glass-card p-6 bg-blue-900 bg-opacity-30 border border-blue-500 border-opacity-30">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-bold text-white mb-2">Active Profile</h3>
                    <p className="text-gray-300">{userRoleProfile.profile_name}</p>
                    <p className="text-gray-500 text-sm">Role: {userRoleProfile.role_label}</p>
                  </div>
                  <button
                    onClick={() => setShowRoleProfileSelector(true)}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-semibold transition"
                  >
                    Switch Profile
                  </button>
                </div>
              </div>
            )}

            {/* Profile Selector */}
            {showRoleProfileSelector && (
              <CMSSRoleBasedProfileSelector
                companyId={userCompanyId}
                currentProfileId={userRoleProfile?.id}
                onSelect={handleSelectRoleProfile}
                onEdit={handleEditRoleProfile}
                onDelete={handleDeleteRoleProfile}
              />
            )}

            {/* All Profiles List */}
            {roleProfiles.length > 0 && !showRoleProfileSelector && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {roleProfiles.map(profile => (
                  <div
                    key={profile.id}
                    className={`glass-card p-4 border-l-4 ${
                      userRoleProfile?.id === profile.id
                        ? 'border-l-green-500 ring-2 ring-green-500'
                        : 'border-l-blue-500'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h4 className="text-white font-bold">{profile.profile_name}</h4>
                        <p className="text-gray-400 text-sm">{profile.user_name}</p>
                        <p className="text-gray-500 text-xs mt-1">{profile.role_label}</p>
                      </div>
                      {profile.is_primary_profile && (
                        <span className="px-2 py-1 bg-yellow-500 bg-opacity-30 text-yellow-300 text-xs rounded-full">
                          ⭐ Primary
                        </span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleEditRoleProfile(profile)}
                        className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded text-sm transition"
                      >
                        Edit
                      </button>
                      {!profile.is_primary_profile && (
                        <button
                          onClick={() => handleDeleteRoleProfile(profile.id)}
                          className="bg-red-600 hover:bg-red-700 text-white px-3 py-2 rounded text-sm transition"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  // ============================================
  // 9. EXAMPLE: PROTECTED ACTION WITH LOGGING
  // ============================================

  const handleApproveRequisition = async (requisitionId) => {
    try {
      // Check permission with context
      const canApprove = await hasPermissionWithContext(
        'canApproveRequisitions',
        'requisition',
        requisitionId
      );

      if (!canApprove) {
        alert('You do not have permission to approve requisitions');
        return;
      }

      // Get current data before update
      const { data: oldData } = await supabase
        .from('cmms_requisitions')
        .select('*')
        .eq('id', requisitionId)
        .single();

      // Perform the action
      const { error } = await supabase
        .from('cmms_requisitions')
        .update({ status: 'approved', approved_by: user.id, approved_at: new Date() })
        .eq('id', requisitionId);

      if (error) throw error;

      // Log the activity
      await logUserActivity(
        'approve',
        'requisition',
        requisitionId,
        `Requisition ${requisitionId}`,
        oldData,
        { status: 'approved', approved_by: user.id }
      );

      console.log('✅ Requisition approved and activity logged');
      alert('Requisition approved successfully');
    } catch (error) {
      console.error('❌ Error approving requisition:', error);
      alert('Error: ' + error.message);
    }
  };

  // ============================================
  // 10. IN JSX RENDER SECTION
  // ============================================

  // Add to your tab content section:
  return (
    <div className="glass-card p-6">
      {/* Tabs */}
      <div className="flex gap-2 mb-6 border-b border-white border-opacity-10 overflow-x-auto">
        {getTabs().map(tabId => (
          <button
            key={tabId}
            onClick={() => setActiveTab(tabId)}
            className={`px-4 py-3 font-semibold transition-all ${
              activeTab === tabId
                ? 'text-blue-300 border-b-2 border-blue-500'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            {tabId === 'roles' ? '🔐 Role Profiles' : tabId === 'company' ? '🏢 Company' : /* ... */ tabId}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === 'company' && <CompanyProfileManager />}
        {activeTab === 'users' && <UserRoleManager />}
        {activeTab === 'roles' && <RoleBasedProfileManager />}
        {activeTab === 'inventory' && <InventoryManager />}
        {activeTab === 'requisitions' && <RequisitionManager />}
        {activeTab === 'reports' && <ReportsManager />}
      </div>
    </div>
  );
};

export default CMMSModule;

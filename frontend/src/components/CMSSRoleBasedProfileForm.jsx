import React, { useState, useEffect } from 'react';
import {
  Users,
  Plus,
  X,
  Trash2,
  Edit2,
  CheckCircle2,
  AlertCircle,
  Shield,
  Lock,
  Unlock,
  Copy,
  Eye,
  EyeOff
} from 'lucide-react';
import { supabase } from '../lib/supabase/client';

/**
 * CMMS_RoleBasedProfileForm Component
 * 
 * Manages user role profiles with custom permissions
 * Follows Business Profile pattern:
 * - 3-step wizard (Role Selection → Permissions → Review)
 * - Custom permission overrides
 * - Department & location assignments
 * - Delegation capabilities
 * 
 * @props {Function} onProfileCreated - Callback when profile created
 * @props {Function} onCancel - Callback when cancelled
 * @props {String} userId - Current user ID
 * @props {String} companyId - CMMS company ID
 * @props {Object} editingProfile - Profile to edit (optional)
 */
const CMSSRoleBasedProfileForm = ({ onProfileCreated, onCancel, userId, companyId, editingProfile }) => {
  const [step, setStep] = useState('role'); // role, permissions, delegation, review
  const [loading, setLoading] = useState(false);
  const [roles, setRoles] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [users, setUsers] = useState([]);

  // Form state
  const [profileData, setProfileData] = useState({
    profileName: '',
    description: '',
    primaryRoleId: '',
    assignedDepartmentId: '',
    dataAccessLevel: 'company_only', // own_only, department_only, company_only, all
    canDelegate: false,
    status: 'active'
  });

  const [selectedRole, setSelectedRole] = useState(null);
  const [customPermissions, setCustomPermissions] = useState({});
  const [useCustomPermissions, setUseCustomPermissions] = useState(false);
  const [delegatedUsers, setDelegatedUsers] = useState([]);
  const [newDelegateEmail, setNewDelegateEmail] = useState('');
  const [permissionsList, setPermissionsList] = useState([]);

  // Load roles and departments on mount
  useEffect(() => {
    loadRolesAndDepartments();
    if (editingProfile) {
      loadEditingProfile();
    }
  }, []);

  const loadRolesAndDepartments = async () => {
    try {
      // Load roles
      const { data: rolesData, error: rolesError } = await supabase
        .from('cmms_role_definitions')
        .select('*')
        .eq('cmms_company_id', companyId)
        .eq('is_active', true)
        .order('role_level', { ascending: false });

      if (rolesError) throw rolesError;
      setRoles(rolesData || []);

      // Load departments
      const { data: deptData, error: deptError } = await supabase
        .from('cmms_departments')
        .select('*')
        .eq('cmms_company_id', companyId)
        .order('department_name');

      if (deptError) throw deptError;
      setDepartments(deptData || []);

      // Load users for delegation
      const { data: usersData, error: usersError } = await supabase
        .from('cmms_users')
        .select('*')
        .eq('cmms_company_id', companyId)
        .order('full_name');

      if (usersError) throw usersError;
      setUsers(usersData || []);

      console.log('✅ Roles, departments, and users loaded');
    } catch (error) {
      console.error('❌ Error loading data:', error);
      alert('Error loading roles and departments: ' + error.message);
    }
  };

  const loadEditingProfile = async () => {
    try {
      const { data: profile, error } = await supabase
        .from('cmms_user_role_profiles')
        .select('*, cmms_role_definitions(*)')
        .eq('id', editingProfile.id)
        .single();

      if (error) throw error;

      setProfileData({
        profileName: profile.profile_name,
        description: profile.description,
        primaryRoleId: profile.primary_role_id,
        assignedDepartmentId: profile.assigned_department_id,
        dataAccessLevel: profile.data_access_level,
        canDelegate: profile.can_delegate_permissions,
        status: profile.status
      });

      setSelectedRole(profile.cmms_role_definitions);
      setUseCustomPermissions(profile.use_custom_permissions);
      if (profile.use_custom_permissions) {
        setCustomPermissions(profile.custom_permissions || {});
      }

      console.log('✅ Profile loaded for editing');
    } catch (error) {
      console.error('❌ Error loading profile:', error);
      alert('Error loading profile: ' + error.message);
    }
  };

  const handleRoleSelect = (role) => {
    setSelectedRole(role);
    setProfileData(prev => ({
      ...prev,
      primaryRoleId: role.id
    }));

    // Reset custom permissions
    setCustomPermissions({});
    setUseCustomPermissions(false);
    setPermissionsList(Object.keys(role.permissions || {}));
  };

  const handlePermissionToggle = (permission, value) => {
    setCustomPermissions(prev => ({
      ...prev,
      [permission]: value
    }));
    setUseCustomPermissions(true);
  };

  const handleAddDelegate = async () => {
    if (!newDelegateEmail) {
      alert('Please enter delegate email');
      return;
    }

    const delegateUser = users.find(u => u.email === newDelegateEmail);
    if (!delegateUser) {
      alert('User not found');
      return;
    }

    if (delegatedUsers.some(u => u.id === delegateUser.id)) {
      alert('User already added as delegate');
      return;
    }

    setDelegatedUsers([...delegatedUsers, delegateUser]);
    setNewDelegateEmail('');
    console.log('✅ Delegate added:', delegateUser.full_name);
  };

  const removeDelegate = (userId) => {
    setDelegatedUsers(delegatedUsers.filter(u => u.id !== userId));
  };

  const validateProfile = () => {
    if (!profileData.profileName) {
      alert('Please enter profile name');
      return false;
    }

    if (!selectedRole) {
      alert('Please select a primary role');
      return false;
    }

    return true;
  };

  const handleCreateProfile = async () => {
    if (!validateProfile()) return;

    setLoading(true);
    try {
      const profilePayload = {
        cmms_company_id: companyId,
        cmms_user_id: userId,
        profile_name: profileData.profileName,
        description: profileData.description,
        primary_role_id: selectedRole.id,
        assigned_department_id: profileData.assignedDepartmentId || null,
        use_custom_permissions: useCustomPermissions,
        custom_permissions: useCustomPermissions ? customPermissions : {},
        can_delegate_permissions: profileData.canDelegate,
        delegated_to_users: delegatedUsers.map(u => u.id),
        data_access_level: profileData.dataAccessLevel,
        status: profileData.status,
        is_primary_profile: true,
        activated_at: new Date().toISOString()
      };

      let result;

      if (editingProfile?.id) {
        // Update existing profile
        const { data, error } = await supabase
          .from('cmms_user_role_profiles')
          .update(profilePayload)
          .eq('id', editingProfile.id)
          .select()
          .single();

        if (error) throw error;
        result = data;
        console.log('✅ Profile updated successfully');
        alert('✅ Role profile updated successfully!');
      } else {
        // Create new profile
        const { data, error } = await supabase
          .from('cmms_user_role_profiles')
          .insert([profilePayload])
          .select()
          .single();

        if (error) throw error;
        result = data;
        console.log('✅ Profile created successfully');
        alert('✅ Role profile created successfully!');
      }

      onProfileCreated(result);
    } catch (error) {
      console.error('❌ Error saving profile:', error);
      alert('❌ Error: ' + (error.message || 'Failed to save profile'));
    } finally {
      setLoading(false);
    }
  };

  // Step 1: Role Selection
  if (step === 'role') {
    return (
      <div className="glass-card p-8 max-w-2xl">
        <h2 className="text-2xl font-bold text-white mb-2">Step 1: Select Primary Role</h2>
        <p className="text-gray-400 mb-6">Choose the base role for this user profile</p>

        <div className="space-y-3 mb-6">
          {roles.map(role => (
            <button
              key={role.id}
              onClick={() => handleRoleSelect(role)}
              className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
                selectedRole?.id === role.id
                  ? 'border-blue-500 bg-blue-900 bg-opacity-30'
                  : 'border-gray-600 bg-gray-800 bg-opacity-30 hover:border-blue-400'
              }`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-white font-bold flex items-center gap-2">
                    <span className="text-2xl">{role.role_icon}</span>
                    {role.role_label}
                  </div>
                  <p className="text-gray-400 text-sm mt-1">{role.description}</p>
                  <div className="text-xs text-gray-500 mt-2">
                    Level: {role.role_level} • {Object.values(role.permissions || {}).filter(p => p).length} permissions
                  </div>
                </div>
                {selectedRole?.id === role.id && (
                  <CheckCircle2 className="w-6 h-6 text-green-400 flex-shrink-0" />
                )}
              </div>
            </button>
          ))}
        </div>

        {/* Profile Name */}
        <div className="mb-6 space-y-2">
          <label className="text-white font-semibold text-sm">Profile Name *</label>
          <input
            type="text"
            placeholder="e.g., Senior Technician, Finance Manager"
            value={profileData.profileName}
            onChange={(e) => setProfileData(prev => ({ ...prev, profileName: e.target.value }))}
            className="w-full bg-gray-900 bg-opacity-50 border border-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
          />
        </div>

        {/* Description */}
        <div className="mb-6 space-y-2">
          <label className="text-white font-semibold text-sm">Description (Optional)</label>
          <textarea
            placeholder="Describe the purpose of this role profile..."
            value={profileData.description}
            onChange={(e) => setProfileData(prev => ({ ...prev, description: e.target.value }))}
            className="w-full bg-gray-900 bg-opacity-50 border border-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none h-20"
          />
        </div>

        {/* Department Assignment */}
        <div className="mb-6 space-y-2">
          <label className="text-white font-semibold text-sm">Assign to Department (Optional)</label>
          <select
            value={profileData.assignedDepartmentId || ''}
            onChange={(e) => setProfileData(prev => ({ ...prev, assignedDepartmentId: e.target.value }))}
            className="w-full bg-gray-900 bg-opacity-50 border border-gray-700 rounded-lg px-4 py-2 text-white focus:border-blue-500 focus:outline-none"
          >
            <option value="">No Department</option>
            {departments.map(dept => (
              <option key={dept.id} value={dept.id}>{dept.department_name}</option>
            ))}
          </select>
        </div>

        {/* Data Access Level */}
        <div className="mb-6 space-y-2">
          <label className="text-white font-semibold text-sm">Data Access Level</label>
          <div className="grid grid-cols-2 gap-2">
            {['own_only', 'department_only', 'company_only', 'all'].map(level => (
              <button
                key={level}
                onClick={() => setProfileData(prev => ({ ...prev, dataAccessLevel: level }))}
                className={`p-2 rounded text-sm font-semibold transition-all ${
                  profileData.dataAccessLevel === level
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                {level.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
              </button>
            ))}
          </div>
        </div>

        {/* Navigation */}
        <div className="flex gap-2 mt-8">
          <button
            onClick={onCancel}
            className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-3 rounded-lg font-semibold transition"
          >
            Cancel
          </button>
          <button
            onClick={() => setStep('permissions')}
            disabled={!selectedRole}
            className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-500 text-white py-3 rounded-lg font-semibold transition"
          >
            Customize Permissions →
          </button>
        </div>
      </div>
    );
  }

  // Step 2: Permission Customization
  if (step === 'permissions') {
    return (
      <div className="glass-card p-8 max-w-2xl max-h-[80vh] overflow-y-auto">
        <h2 className="text-2xl font-bold text-white mb-2">Step 2: Permissions</h2>
        <p className="text-gray-400 mb-6">Configure permissions for this role profile</p>

        {/* Role Summary */}
        <div className="bg-blue-900 bg-opacity-30 border border-blue-500 border-opacity-30 p-4 rounded-lg mb-6">
          <div className="flex items-center gap-2 mb-2">
            <Shield className="w-5 h-5 text-blue-400" />
            <span className="text-white font-bold">{selectedRole?.role_label}</span>
          </div>
          <p className="text-gray-300 text-sm">{selectedRole?.description}</p>
        </div>

        {/* Custom Permissions Toggle */}
        <div className="mb-6 p-4 bg-gray-900 bg-opacity-30 rounded-lg border border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white font-semibold">Use Custom Permissions</p>
              <p className="text-gray-400 text-sm">Override role permissions for this profile</p>
            </div>
            <button
              onClick={() => setUseCustomPermissions(!useCustomPermissions)}
              className={`w-12 h-6 rounded-full transition-all ${
                useCustomPermissions ? 'bg-green-600' : 'bg-gray-600'
              } relative`}
            >
              <div className={`w-5 h-5 bg-white rounded-full transition-transform absolute top-0.5 ${
                useCustomPermissions ? 'translate-x-6' : 'translate-x-0.5'
              }`} />
            </button>
          </div>
        </div>

        {/* Permissions Grid */}
        {useCustomPermissions && (
          <div className="space-y-3 mb-6">
            <h3 className="text-white font-semibold flex items-center gap-2">
              <Lock className="w-5 h-5" />
              Permissions
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {permissionsList.map(permission => (
                <div
                  key={permission}
                  className="bg-gray-800 bg-opacity-50 p-3 rounded-lg border border-gray-700 flex items-center justify-between"
                >
                  <label className="text-gray-300 text-sm font-semibold cursor-pointer flex-1">
                    {permission.replace(/([A-Z])/g, ' $1').trim()}
                  </label>
                  <input
                    type="checkbox"
                    checked={customPermissions[permission] || selectedRole?.permissions[permission] || false}
                    onChange={(e) => handlePermissionToggle(permission, e.target.checked)}
                    className="w-4 h-4 cursor-pointer"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="flex gap-2 mt-8">
          <button
            onClick={() => setStep('role')}
            className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-3 rounded-lg font-semibold transition"
          >
            ← Back
          </button>
          <button
            onClick={() => setStep('delegation')}
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg font-semibold transition"
          >
            Add Delegation →
          </button>
        </div>
      </div>
    );
  }

  // Step 3: Delegation
  if (step === 'delegation') {
    return (
      <div className="glass-card p-8 max-w-2xl max-h-[80vh] overflow-y-auto">
        <h2 className="text-2xl font-bold text-white mb-2">Step 3: Permission Delegation</h2>
        <p className="text-gray-400 mb-6">Allow other users to act on behalf of this role (optional)</p>

        {/* Delegation Toggle */}
        <div className="mb-6 p-4 bg-gray-900 bg-opacity-30 rounded-lg border border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white font-semibold">Enable Delegation</p>
              <p className="text-gray-400 text-sm">Allow others to use this role temporarily</p>
            </div>
            <button
              onClick={() => setProfileData(prev => ({ ...prev, canDelegate: !prev.canDelegate }))}
              className={`w-12 h-6 rounded-full transition-all ${
                profileData.canDelegate ? 'bg-green-600' : 'bg-gray-600'
              } relative`}
            >
              <div className={`w-5 h-5 bg-white rounded-full transition-transform absolute top-0.5 ${
                profileData.canDelegate ? 'translate-x-6' : 'translate-x-0.5'
              }`} />
            </button>
          </div>
        </div>

        {/* Add Delegates */}
        {profileData.canDelegate && (
          <div className="space-y-4 mb-6">
            <div className="space-y-2">
              <label className="text-white font-semibold text-sm">Add Delegate User</label>
              <div className="flex gap-2">
                <select
                  value={newDelegateEmail}
                  onChange={(e) => setNewDelegateEmail(e.target.value)}
                  className="flex-1 bg-gray-900 bg-opacity-50 border border-gray-700 rounded-lg px-4 py-2 text-white focus:border-blue-500 focus:outline-none"
                >
                  <option value="">Select a user...</option>
                  {users
                    .filter(u => u.id !== userId && !delegatedUsers.find(d => d.id === u.id))
                    .map(user => (
                      <option key={user.id} value={user.email}>{user.full_name} ({user.email})</option>
                    ))}
                </select>
                <button
                  onClick={handleAddDelegate}
                  disabled={!newDelegateEmail}
                  className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-500 text-white px-4 py-2 rounded-lg font-semibold transition flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Add
                </button>
              </div>
            </div>

            {/* Delegates List */}
            {delegatedUsers.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-white font-semibold text-sm">Authorized Delegates:</h3>
                <div className="space-y-2">
                  {delegatedUsers.map(user => (
                    <div
                      key={user.id}
                      className="bg-green-900 bg-opacity-20 border border-green-500 border-opacity-30 p-3 rounded-lg flex items-center justify-between"
                    >
                      <div>
                        <p className="text-white font-semibold text-sm">{user.full_name}</p>
                        <p className="text-gray-400 text-xs">{user.email}</p>
                      </div>
                      <button
                        onClick={() => removeDelegate(user.id)}
                        className="text-red-400 hover:text-red-300 transition"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Navigation */}
        <div className="flex gap-2 mt-8">
          <button
            onClick={() => setStep('permissions')}
            className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-3 rounded-lg font-semibold transition"
          >
            ← Back
          </button>
          <button
            onClick={() => setStep('review')}
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg font-semibold transition"
          >
            Review Profile →
          </button>
        </div>
      </div>
    );
  }

  // Step 4: Review
  if (step === 'review') {
    return (
      <div className="glass-card p-8 max-w-2xl max-h-[80vh] overflow-y-auto">
        <h2 className="text-2xl font-bold text-white mb-6">Review Role Profile</h2>

        {/* Profile Summary */}
        <div className="space-y-6">
          <div className="bg-blue-900 bg-opacity-20 border border-blue-500 border-opacity-30 p-4 rounded-lg">
            <h3 className="text-blue-300 font-semibold text-sm mb-3">PROFILE DETAILS</h3>
            <div className="space-y-2">
              <div>
                <p className="text-gray-400 text-xs">Profile Name</p>
                <p className="text-white font-bold">{profileData.profileName}</p>
              </div>
              {profileData.description && (
                <div>
                  <p className="text-gray-400 text-xs">Description</p>
                  <p className="text-white">{profileData.description}</p>
                </div>
              )}
            </div>
          </div>

          {/* Role Details */}
          <div className="bg-purple-900 bg-opacity-20 border border-purple-500 border-opacity-30 p-4 rounded-lg">
            <h3 className="text-purple-300 font-semibold text-sm mb-3 flex items-center gap-2">
              <Shield className="w-4 h-4" />
              PRIMARY ROLE
            </h3>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-2xl">{selectedRole?.role_icon}</span>
                <div>
                  <p className="text-white font-bold">{selectedRole?.role_label}</p>
                  <p className="text-gray-400 text-xs">Level {selectedRole?.role_level}</p>
                </div>
              </div>
              {selectedRole?.description && (
                <p className="text-gray-300 text-sm mt-2">{selectedRole.description}</p>
              )}
            </div>
          </div>

          {/* Access Settings */}
          <div className="bg-cyan-900 bg-opacity-20 border border-cyan-500 border-opacity-30 p-4 rounded-lg">
            <h3 className="text-cyan-300 font-semibold text-sm mb-3">ACCESS SETTINGS</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Data Access Level:</span>
                <span className="text-white font-semibold">{profileData.dataAccessLevel.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}</span>
              </div>
              {profileData.assignedDepartmentId && (
                <div className="flex justify-between">
                  <span className="text-gray-400">Department:</span>
                  <span className="text-white font-semibold">{departments.find(d => d.id === profileData.assignedDepartmentId)?.department_name}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-400">Can Delegate:</span>
                <span className={`font-semibold ${profileData.canDelegate ? 'text-green-300' : 'text-gray-400'}`}>
                  {profileData.canDelegate ? 'Yes' : 'No'}
                </span>
              </div>
            </div>
          </div>

          {/* Delegates */}
          {delegatedUsers.length > 0 && (
            <div className="bg-green-900 bg-opacity-20 border border-green-500 border-opacity-30 p-4 rounded-lg">
              <h3 className="text-green-300 font-semibold text-sm mb-3">DELEGATES ({delegatedUsers.length})</h3>
              <div className="space-y-2">
                {delegatedUsers.map(user => (
                  <div key={user.id} className="text-sm">
                    <p className="text-white font-semibold">{user.full_name}</p>
                    <p className="text-gray-400">{user.email}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Navigation */}
        <div className="flex gap-2 mt-8">
          <button
            onClick={() => setStep('delegation')}
            className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-3 rounded-lg font-semibold transition"
          >
            ← Back
          </button>
          <button
            onClick={handleCreateProfile}
            disabled={loading}
            className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-gray-500 text-white py-3 rounded-lg font-semibold transition flex items-center justify-center gap-2"
          >
            {loading ? '⏳ Creating...' : '✅ Create Profile'}
          </button>
        </div>
      </div>
    );
  }

  return null;
};

export default CMSSRoleBasedProfileForm;

import React, { useState, useEffect } from 'react';
import {
  Users,
  Shield,
  Edit2,
  Trash2,
  Eye,
  EyeOff,
  Copy,
  CheckCircle2,
  AlertCircle,
  Plus,
  Search,
  Filter
} from 'lucide-react';
import { supabase } from '../lib/supabase/client';

/**
 * CMMS_RoleBasedProfileSelector Component
 * 
 * Display and manage user role profiles
 * Follows Business Profile Selector pattern:
 * - View all profiles
 * - Quick profile info preview
 * - Status indicators
 * - Delete/Edit capabilities
 * 
 * @props {Function} onSelect - Callback when profile selected
 * @props {String} companyId - CMMS company ID
 * @props {Function} onEdit - Callback when edit clicked
 * @props {Function} onDelete - Callback when delete clicked
 */
const CMSSRoleBasedProfileSelector = ({
  onSelect,
  companyId,
  onEdit,
  onDelete,
  currentProfileId
}) => {
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [roles, setRoles] = useState([]);
  const [expandedProfile, setExpandedProfile] = useState(null);

  useEffect(() => {
    loadProfilesAndRoles();
  }, []);

  const loadProfilesAndRoles = async () => {
    try {
      setLoading(true);

      // Load roles
      const { data: rolesData, error: rolesError } = await supabase
        .from('cmms_role_definitions')
        .select('*')
        .eq('cmms_company_id', companyId);

      if (rolesError) throw rolesError;
      setRoles(rolesData || []);

      // Load profiles with role info
      const { data: profilesData, error: profilesError } = await supabase
        .from('vw_user_role_profiles')
        .select('*')
        .eq('cmms_company_id', companyId)
        .order('is_primary_profile', { ascending: false })
        .order('updated_at', { ascending: false });

      if (profilesError) throw profilesError;
      setProfiles(profilesData || []);

      console.log('✅ Profiles and roles loaded');
    } catch (error) {
      console.error('❌ Error loading profiles:', error);
      alert('Error loading profiles: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const filteredProfiles = profiles.filter(profile => {
    const matchesSearch = 
      profile.profile_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      profile.user_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      profile.user_email?.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesRole = !filterRole || profile.role_id === filterRole;
    
    return matchesSearch && matchesRole;
  });

  const getStatusColor = (status) => {
    switch (status) {
      case 'active': return 'bg-green-900 bg-opacity-30 border-green-500 text-green-300';
      case 'inactive': return 'bg-gray-900 bg-opacity-30 border-gray-500 text-gray-300';
      case 'suspended': return 'bg-red-900 bg-opacity-30 border-red-500 text-red-300';
      case 'pending': return 'bg-yellow-900 bg-opacity-30 border-yellow-500 text-yellow-300';
      default: return 'bg-gray-900 bg-opacity-30 border-gray-500 text-gray-300';
    }
  };

  if (loading) {
    return (
      <div className="glass-card p-6 text-center">
        <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-blue-300 rounded-full mx-auto"></div>
        <p className="text-gray-400 mt-4">Loading profiles...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Shield className="w-6 h-6 text-blue-400" />
            Role-Based Profiles ({filteredProfiles.length})
          </h2>
          <p className="text-gray-400 text-sm mt-1">Manage user role profiles and permissions</p>
        </div>
      </div>

      {/* Search and Filter */}
      <div className="glass-card p-4 space-y-4">
        <div className="flex gap-3">
          <div className="flex-1 relative">
            <Search className="w-5 h-5 absolute left-3 top-2.5 text-gray-500" />
            <input
              type="text"
              placeholder="Search by profile name or user..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-gray-900 bg-opacity-50 border border-gray-700 rounded-lg pl-10 pr-4 py-2 text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
            />
          </div>
          <select
            value={filterRole}
            onChange={(e) => setFilterRole(e.target.value)}
            className="bg-gray-900 bg-opacity-50 border border-gray-700 rounded-lg px-4 py-2 text-white focus:border-blue-500 focus:outline-none min-w-[180px]"
          >
            <option value="">All Roles</option>
            {roles.map(role => (
              <option key={role.id} value={role.id}>{role.role_label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Profiles List */}
      {filteredProfiles.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Shield className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400 text-lg">No profiles found</p>
          <p className="text-gray-500 text-sm mt-1">Create a new role-based profile to get started</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredProfiles.map(profile => {
            const role = roles.find(r => r.id === profile.role_id);
            const isExpanded = expandedProfile === profile.id;

            return (
              <div
                key={profile.id}
                className={`glass-card p-4 border-l-4 transition-all cursor-pointer ${
                  currentProfileId === profile.id
                    ? 'border-l-green-500 ring-2 ring-green-500'
                    : 'border-l-blue-500 hover:border-l-blue-400'
                } ${getStatusColor(profile.status)}`}
              >
                {/* Profile Header */}
                <div
                  onClick={() => setExpandedProfile(isExpanded ? null : profile.id)}
                  className="flex items-start justify-between cursor-pointer"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="text-white font-bold">{profile.profile_name}</h3>
                      {profile.is_primary_profile && (
                        <span className="px-2 py-0.5 bg-yellow-500 bg-opacity-30 text-yellow-300 text-xs rounded-full font-semibold">
                          ⭐ Primary
                        </span>
                      )}
                      <span className={`px-2 py-0.5 text-xs rounded-full font-semibold ${getStatusColor(profile.status).split(' ').slice(-2).join(' ')}`}>
                        {profile.status.charAt(0).toUpperCase() + profile.status.slice(1)}
                      </span>
                    </div>
                    
                    <div className="text-sm space-y-1">
                      <p className="text-gray-300">
                        <span className="text-gray-500">User:</span> {profile.user_name}
                      </p>
                      <p className="text-gray-300">
                        <span className="text-gray-500">Role:</span> {role?.role_label}
                      </p>
                      {profile.department_name && (
                        <p className="text-gray-300">
                          <span className="text-gray-500">Department:</span> {profile.department_name}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    {currentProfileId === profile.id && (
                      <CheckCircle2 className="w-6 h-6 text-green-400" />
                    )}
                    {isExpanded ? (
                      <Eye className="w-5 h-5 text-gray-400" />
                    ) : (
                      <EyeOff className="w-5 h-5 text-gray-500" />
                    )}
                  </div>
                </div>

                {/* Expanded Details */}
                {isExpanded && (
                  <div className="mt-4 pt-4 border-t border-white border-opacity-10 space-y-4">
                    {profile.description && (
                      <div>
                        <p className="text-gray-500 text-xs">DESCRIPTION</p>
                        <p className="text-gray-300 text-sm">{profile.description}</p>
                      </div>
                    )}

                    {/* Permissions Summary */}
                    <div>
                      <p className="text-gray-500 text-xs mb-2">PERMISSIONS</p>
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(profile.effective_permissions || {})
                          .filter(([_, value]) => value)
                          .slice(0, 6)
                          .map(([permission, _]) => (
                            <span
                              key={permission}
                              className="px-2 py-1 bg-blue-500 bg-opacity-20 text-blue-300 text-xs rounded border border-blue-500 border-opacity-30"
                            >
                              {permission.replace(/([A-Z])/g, ' $1').trim()}
                            </span>
                          ))}
                        {Object.values(profile.effective_permissions || {}).filter(v => v).length > 6 && (
                          <span className="px-2 py-1 bg-gray-500 bg-opacity-20 text-gray-300 text-xs rounded">
                            +{Object.values(profile.effective_permissions || {}).filter(v => v).length - 6} more
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Data Access Level */}
                    <div>
                      <p className="text-gray-500 text-xs mb-1">DATA ACCESS</p>
                      <p className="text-white text-sm font-semibold">
                        {profile.data_access_level.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                      </p>
                    </div>

                    {/* Created/Updated Info */}
                    <div className="text-xs text-gray-500 space-y-1">
                      <p>Created: {new Date(profile.created_at).toLocaleDateString()}</p>
                      <p>Updated: {new Date(profile.updated_at).toLocaleDateString()}</p>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2 pt-2">
                      <button
                        onClick={() => onSelect?.(profile)}
                        className="flex-1 bg-green-600 hover:bg-green-700 text-white px-3 py-2 rounded font-semibold text-sm transition flex items-center justify-center gap-2"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        Select
                      </button>
                      <button
                        onClick={() => onEdit?.(profile)}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded text-sm transition"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      {!profile.is_primary_profile && (
                        <button
                          onClick={() => onDelete?.(profile.id)}
                          className="bg-red-600 hover:bg-red-700 text-white px-3 py-2 rounded text-sm transition"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default CMSSRoleBasedProfileSelector;

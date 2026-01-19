/**
 * SACCOHub Component - CLEAN & UNIFIED
 * Everyone (users & admins) can:
 * 1. Explore all groups
 * 2. Join groups as members
 * 3. Vote on member applications
 * 4. See groups they joined
 * 5. See applications they submitted
 * 
 * Only creators can:
 * 6. Manage admin panel for their groups
 */

import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  Plus,
  Users,
  Shield,
  X,
  CheckCircle,
  Clock,
  AlertCircle,
  BarChart3,
  Vote,
  Inbox,
  Building2,
  LogOut,
  Menu,
  ChevronRight
} from 'lucide-react';
import {
  getPublicTrustGroups,
  getUserTrustGroups,
  createTrustGroup,
  submitMembershipApplication,
  getUserPendingApplications,
  getGroupVotingStats,
  getVotingApplicationsForMember,
  getPendingApplicationsForAdmin,
  getAllVotingApplications
} from '../services/trustService';
import AdminApplicationPanel from './AdminApplicationPanel';
import VotingInterface from './VotingInterface';
import GroupDetailsModal from './GroupDetailsModal';

const SACCOHub = ({ onClose }) => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('explore');
  
  // Main data
  const [allGroups, setAllGroups] = useState([]);
  const [myJoinedGroups, setMyJoinedGroups] = useState([]);
  const [myCreatedGroups, setMyCreatedGroups] = useState([]);
  const [myApplications, setMyApplications] = useState([]);
  const [votingApplications, setVotingApplications] = useState([]);
  const [groupAdminStats, setGroupAdminStats] = useState({}); // Stats for each group
  
  // UI state
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showApplicationForm, setShowApplicationForm] = useState(false);
  const [selectedGroupForApplication, setSelectedGroupForApplication] = useState(null);
  const [applicationText, setApplicationText] = useState('');
  const [selectedAdminGroup, setSelectedAdminGroup] = useState(null);
  const [selectedGroupDetails, setSelectedGroupDetails] = useState(null); // For group details/contribution view
  
  // Form data
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    monthlyContribution: 100,
    maxMembers: 30
  });

  // Load all data on mount
  useEffect(() => {
    loadAllData();
    const interval = setInterval(loadAllData, 30000); // Refresh every 30s (reduced from 15s to avoid constant flickering)
    return () => clearInterval(interval);
  }, [user?.id]);

  const loadAllData = async (isInitialLoad = true) => {
    if (!user?.id) return;
    if (isInitialLoad) setLoading(true); // Only show loading on initial load, not on background refresh
    try {
      const [publicGroups, userGroups, applications, voting] = await Promise.all([
        getPublicTrustGroups(),
        getUserTrustGroups(user.id),
        getUserPendingApplications(user.id),
        getVotingApplicationsForMember(user.id)
      ]);

      console.log('Loaded voting applications:', voting);
      
      setAllGroups(publicGroups || []);
      setMyApplications(applications || []);
      setVotingApplications(voting || []);

      // Separate joined vs created groups
      const allUserGroups = userGroups || [];
      const created = allUserGroups.filter(g => g.creator_id === user.id);
      const joined = allUserGroups.filter(g => g.creator_id !== user.id);

      setMyCreatedGroups(created);
      setMyJoinedGroups(joined);

      // Load admin stats for created groups
      if (created.length > 0) {
        const statsMap = {};
        for (const group of created) {
          try {
            const [pending, voting] = await Promise.all([
              getPendingApplicationsForAdmin(group.id),
              getAllVotingApplications(group.id)
            ]);
            statsMap[group.id] = {
              pending: pending?.length || 0,
              voting: voting?.length || 0
            };
          } catch (err) {
            console.error(`Error loading stats for group ${group.id}:`, err);
            statsMap[group.id] = { pending: 0, voting: 0 };
          }
        }
        setGroupAdminStats(statsMap);
      }
      
      console.log('Loaded data:', { 
        totalGroups: publicGroups?.length, 
        myGroups: allUserGroups?.length,
        createdGroups: created?.length,
        joinedGroups: joined?.length,
        votingCount: voting?.length
      });
    } catch (error) {
      console.error('Error loading data:', error);
      setMessage({ type: 'error', text: 'Failed to load data' });
    } finally {
      if (isInitialLoad) setLoading(false);
    }
  };

  const handleCreateGroup = async () => {
    if (!formData.name.trim()) {
      setMessage({ type: 'error', text: 'Group name is required' });
      return;
    }
    try {
      await createTrustGroup(
        formData.name,
        formData.description,
        parseFloat(formData.monthlyContribution),
        parseInt(formData.maxMembers),
        user?.id
      );
      setMessage({ type: 'success', text: '✓ Group created successfully!' });
      setShowCreateForm(false);
      setFormData({ name: '', description: '', monthlyContribution: 100, maxMembers: 30 });
      setTimeout(loadAllData, 1000);
    } catch (error) {
      setMessage({ type: 'error', text: error.message });
    }
  };

  const handleSubmitApplication = async () => {
    if (!applicationText.trim() || !selectedGroupForApplication) {
      setMessage({ type: 'error', text: 'Please fill in your application' });
      return;
    }
    try {
      await submitMembershipApplication(
        selectedGroupForApplication.id,
        user?.id,
        user?.email,
        applicationText
      );
      setMessage({ type: 'success', text: '✓ Application submitted! Waiting for admin review.' });
      setShowApplicationForm(false);
      setApplicationText('');
      setSelectedGroupForApplication(null);
      setTimeout(loadAllData, 1000);
    } catch (error) {
      setMessage({ type: 'error', text: error.message });
    }
  };

  // ===== TAB: EXPLORE =====
  const renderExplore = () => {
    const explorableGroups = allGroups.filter(g => !myCreatedGroups.find(c => c.id === g.id));
    
    return (
      <div className="space-y-4">
        {explorableGroups.length === 0 ? (
          <div className="text-center py-12 bg-slate-800/50 rounded-lg border border-slate-700">
            <Users className="w-12 h-12 text-gray-500 mx-auto mb-3" />
            <p className="text-gray-400">No groups available to join</p>
          </div>
        ) : (
          explorableGroups.map(group => (
            <div key={group.id} className="bg-gradient-to-r from-slate-800 to-slate-900 border border-blue-500/30 rounded-lg p-5 hover:border-blue-500/60 transition-all">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h3 className="text-lg font-bold text-white">{group.name}</h3>
                  <p className="text-sm text-gray-400">👤 {group.member_count || 0} members</p>
                </div>
                <span className="px-3 py-1 bg-blue-600 text-white text-xs font-bold rounded-full">
                  💵 ${group.monthly_contribution}
                </span>
              </div>
              <p className="text-sm text-gray-300 mb-4">{group.description}</p>
              <button
                onClick={() => {
                  setSelectedGroupForApplication(group);
                  setShowApplicationForm(true);
                }}
                className="w-full py-2 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white rounded-lg font-semibold transition-all"
              >
                Apply to Join
              </button>
            </div>
          ))
        )}
      </div>
    );
  };

  // ===== TAB: MY GROUPS (Created + Joined) =====
  const renderMyGroups = () => {
    const allMyGroups = [...myCreatedGroups, ...myJoinedGroups];
    
    return (
      <div className="space-y-4">
        {allMyGroups.length === 0 ? (
          <div className="text-center py-12 bg-slate-800/50 rounded-lg border border-slate-700">
            <Building2 className="w-12 h-12 text-gray-500 mx-auto mb-3" />
            <p className="text-gray-400">No groups yet</p>
            <p className="text-sm text-gray-500 mt-2">Create a group or go to Explore to join one</p>
          </div>
        ) : (
          allMyGroups.map(group => (
            <div 
              key={group.id} 
              className="bg-gradient-to-r from-slate-800 to-slate-900 border border-purple-500/30 rounded-lg p-5 hover:border-purple-500/60 transition-all cursor-pointer hover:shadow-lg hover:shadow-purple-500/20"
              onClick={() => setSelectedGroupDetails(group)}
            >
              <div className="flex justify-between items-start mb-2">
                <div>
                  <h3 className="text-lg font-bold text-white">{group.name}</h3>
                  <p className="text-sm text-gray-400">
                    {group.creator_id === user.id ? '👑 Creator' : '✅ Member'} • 👤 {group.member_count || 0} members
                  </p>
                </div>
                <span className="text-green-400 font-bold">📊 Active</span>
              </div>
              <p className="text-sm text-gray-300">{group.description}</p>
              <p className="text-xs text-gray-500 mt-3">💡 Click to view contributions & interest</p>
            </div>
          ))
        )}
      </div>
    );
  };

  // ===== TAB: VOTING =====
  const renderVoting = () => {
    return (
      <div className="space-y-4">
        {votingApplications.length === 0 ? (
          <div className="text-center py-12 bg-slate-800/50 rounded-lg border border-slate-700">
            <Vote className="w-12 h-12 text-gray-500 mx-auto mb-3" />
            <p className="text-gray-400">No applications to vote on</p>
            <p className="text-sm text-gray-500 mt-2">You'll see voting applications here</p>
          </div>
        ) : (
          <VotingInterface applications={votingApplications} onVoteComplete={loadAllData} />
        )}
      </div>
    );
  };

  // ===== TAB: MY APPLICATIONS =====
  const renderMyApplications = () => {
    return (
      <div className="space-y-4">
        {myApplications.length === 0 ? (
          <div className="text-center py-12 bg-slate-800/50 rounded-lg border border-slate-700">
            <Inbox className="w-12 h-12 text-gray-500 mx-auto mb-3" />
            <p className="text-gray-400">No applications submitted</p>
          </div>
        ) : (
          myApplications.map(app => (
            <div key={app.id} className="bg-gradient-to-r from-slate-800 to-slate-900 border border-yellow-500/30 rounded-lg p-5">
              <div className="flex justify-between items-start mb-2">
                <h3 className="text-lg font-bold text-white">{app.group_name || 'Unknown Group'}</h3>
                <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                  app.status === 'pending' ? 'bg-yellow-600 text-yellow-100' :
                  app.status === 'approved_by_admin' ? 'bg-blue-600 text-blue-100' :
                  app.status === 'voting_in_progress' ? 'bg-purple-600 text-purple-100' :
                  app.status === 'approved' ? 'bg-green-600 text-green-100' :
                  'bg-red-600 text-red-100'
                }`}>
                  {app.status === 'pending' && '⏳ Awaiting Review'}
                  {app.status === 'approved_by_admin' && '✅ Admin Approved'}
                  {app.status === 'voting_in_progress' && '🗳️ Member Voting'}
                  {app.status === 'approved' && '🎉 Approved'}
                  {app.status === 'rejected_by_admin' && '❌ Rejected'}
                  {app.status === 'rejected_by_vote' && '❌ Vote Rejected'}
                </span>
              </div>
              <p className="text-sm text-gray-300 italic mb-2">"{app.application_text}"</p>
              <p className="text-xs text-gray-500">Applied {new Date(app.created_at).toLocaleDateString()}</p>
            </div>
          ))
        )}
      </div>
    );
  };

  // ===== TAB: ADMIN PANEL (CREATED GROUPS) =====
  const renderAdminPanel = () => {
    console.log('📊 Admin Panel Render:', {
      createdGroups: myCreatedGroups.length,
      selectedAdminGroup: selectedAdminGroup?.id,
      adminStats: groupAdminStats
    });

    return (
      <div className="space-y-4">
        <div className="bg-gradient-to-r from-slate-800 to-slate-900 border border-emerald-500/50 rounded-lg p-6 mb-6">
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Shield className="w-6 h-6 text-emerald-400" />
            Admin Dashboard
          </h2>
          <p className="text-gray-400 text-sm mt-2">Manage your groups and review member applications</p>
        </div>

        {myCreatedGroups.length === 0 ? (
          <div className="text-center py-12 bg-slate-800/50 rounded-lg border border-slate-700">
            <Shield className="w-12 h-12 text-gray-500 mx-auto mb-3" />
            <p className="text-gray-400 mb-2">No groups created yet</p>
            <p className="text-sm text-gray-500">Create a group to start managing applications</p>
          </div>
        ) : (
          <>
            {selectedAdminGroup ? (
              <div>
                <button
                  onClick={() => {
                    setSelectedAdminGroup(null);
                    loadAllData(false);
                  }}
                  className="mb-4 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg flex items-center gap-2 transition-all"
                >
                  ← Back to Groups
                </button>
                <AdminApplicationPanel
                  groupId={selectedAdminGroup.id}
                  onClose={() => {
                    setSelectedAdminGroup(null);
                    loadAllData(false);
                  }}
                />
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {myCreatedGroups.map(group => (
                  <div 
                    key={group.id} 
                    className="bg-gradient-to-r from-slate-800 to-slate-900 border border-emerald-500/30 rounded-lg p-5 hover:border-emerald-500/60 transition-all cursor-pointer group hover:shadow-lg hover:shadow-emerald-500/20"
                    onClick={() => {
                      console.log('Selecting admin group:', group.id);
                      setSelectedAdminGroup(group);
                    }}
                  >
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex-1">
                        <h3 className="text-lg font-bold text-white group-hover:text-emerald-400 transition-colors">{group.name}</h3>
                        <p className="text-sm text-gray-400">👑 Creator • 👤 {group.member_count || 0} members</p>
                      </div>
                      <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-emerald-400 transition-colors" />
                    </div>
                    <p className="text-sm text-gray-300 mb-4 line-clamp-2">{group.description || 'No description'}</p>
                    
                    <div className="grid grid-cols-2 gap-2 mb-3">
                      <div className={`rounded p-3 text-center transition-all ${
                        (groupAdminStats[group.id]?.pending || 0) > 0 
                          ? 'bg-yellow-500/30 border border-yellow-500/50' 
                          : 'bg-yellow-500/10 border border-yellow-500/20'
                      }`}>
                        <div className="text-xs text-gray-400 font-semibold">⏳ Pending</div>
                        <div className="text-2xl font-bold text-yellow-400">{groupAdminStats[group.id]?.pending || 0}</div>
                      </div>
                      <div className={`rounded p-3 text-center transition-all ${
                        (groupAdminStats[group.id]?.voting || 0) > 0 
                          ? 'bg-purple-500/30 border border-purple-500/50' 
                          : 'bg-purple-500/10 border border-purple-500/20'
                      }`}>
                        <div className="text-xs text-gray-400 font-semibold">🗳️ Voting</div>
                        <div className="text-2xl font-bold text-purple-400">{groupAdminStats[group.id]?.voting || 0}</div>
                      </div>
                    </div>

                    {(groupAdminStats[group.id]?.pending > 0 || groupAdminStats[group.id]?.voting > 0) && (
                      <div className="text-center text-xs font-semibold text-emerald-400 animate-pulse">
                        ⚡ {(groupAdminStats[group.id]?.pending || 0) + (groupAdminStats[group.id]?.voting || 0)} pending action(s)
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  const tabs = [
    { id: 'explore', label: '🔍 Explore', icon: Users },
    { id: 'joined', label: '👥 My Groups', icon: Building2 },
    { id: 'voting', label: '🗳️ Vote', count: votingApplications.length, icon: Vote },
    { id: 'applications', label: '📮 Applications', count: myApplications.length, icon: Inbox },
    ...(myCreatedGroups.length > 0 ? [{ id: 'admin', label: '👑 Admin Panel', icon: Shield }] : [])
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      {/* Header */}
      <div className="bg-slate-900/80 border-b border-slate-800 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-black text-white">🏦 SACCO HUB</h1>
              <p className="text-sm text-gray-400">Cooperative Savings Groups</p>
            </div>
            <div className="flex items-center gap-3">
              {user && (
                <div className="text-right">
                  <p className="text-sm font-semibold text-gray-300">{user.email}</p>
                  <p className="text-xs text-gray-500">Member</p>
                </div>
              )}
              <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-lg transition-colors">
                <X className="w-6 h-6 text-gray-400" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Message Alert */}
      {message.text && (
        <div className={`fixed top-20 left-6 right-6 p-4 rounded-lg z-20 ${
          message.type === 'success' ? 'bg-green-500/20 text-green-300 border border-green-400/50' :
          'bg-red-500/20 text-red-300 border border-red-400/50'
        }`}>
          {message.text}
        </div>
      )}

      {/* Tabs */}
      <div className="bg-slate-800/50 border-b border-slate-700 sticky top-16 z-10">
        <div className="max-w-6xl mx-auto px-6 overflow-x-auto">
          <div className="flex gap-2 py-3">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2 rounded-lg font-semibold whitespace-nowrap transition-all flex items-center gap-2 ${
                  activeTab === tab.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-700 text-gray-300 hover:bg-slate-600'
                }`}
              >
                {tab.label}
                {tab.count > 0 && <span className="ml-1 px-2 py-0.5 bg-red-500 text-white text-xs rounded-full">{tab.count}</span>}
              </button>
            ))}
            <button
              onClick={() => setShowCreateForm(true)}
              className="ml-auto px-4 py-2 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white rounded-lg font-semibold flex items-center gap-2 transition-all"
            >
              <Plus className="w-5 h-5" />
              Create Group
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-6 py-8">
        {loading && (
          <div className="text-center py-12">
            <div className="w-12 h-12 bg-blue-500 rounded-full animate-spin mx-auto"></div>
            <p className="text-gray-400 mt-4">Loading...</p>
          </div>
        )}

        {!loading && activeTab === 'explore' && renderExplore()}
        {!loading && activeTab === 'joined' && renderMyGroups()}
        {!loading && activeTab === 'voting' && renderVoting()}
        {!loading && activeTab === 'applications' && renderMyApplications()}
        {!loading && activeTab === 'admin' && renderAdminPanel()}
      </div>

      {/* Create Group Modal */}
      {showCreateForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 rounded-lg p-6 max-w-md w-full border border-slate-700">
            <h2 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
              <Plus className="w-6 h-6" />
              Create Group
            </h2>
            <div className="space-y-4">
              <input
                type="text"
                placeholder="Group Name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
              />
              <textarea
                placeholder="Description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none h-24 resize-none"
              />
              <input
                type="number"
                placeholder="Monthly Contribution ($)"
                value={formData.monthlyContribution}
                onChange={(e) => setFormData({ ...formData, monthlyContribution: parseFloat(e.target.value) })}
                className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
              />
              <input
                type="number"
                placeholder="Max Members"
                value={formData.maxMembers}
                onChange={(e) => setFormData({ ...formData, maxMembers: parseInt(e.target.value) })}
                className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
              />
              <div className="flex gap-3">
                <button
                  onClick={handleCreateGroup}
                  className="flex-1 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold transition-all"
                >
                  Create
                </button>
                <button
                  onClick={() => setShowCreateForm(false)}
                  className="flex-1 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-semibold transition-all"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Application Form Modal */}
      {showApplicationForm && selectedGroupForApplication && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 rounded-lg p-6 max-w-md w-full border border-slate-700">
            <h2 className="text-2xl font-bold text-white mb-2">{selectedGroupForApplication.name}</h2>
            <p className="text-gray-400 text-sm mb-4">Tell us why you want to join</p>
            <textarea
              placeholder="Write your application..."
              value={applicationText}
              onChange={(e) => setApplicationText(e.target.value)}
              className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none h-32 resize-none mb-4"
            />
            <div className="flex gap-3">
              <button
                onClick={handleSubmitApplication}
                className="flex-1 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold transition-all"
              >
                Submit Application
              </button>
              <button
                onClick={() => {
                  setShowApplicationForm(false);
                  setApplicationText('');
                  setSelectedGroupForApplication(null);
                }}
                className="flex-1 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-semibold transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Group Details Modal */}
      {selectedGroupDetails && (
        <GroupDetailsModal
          group={selectedGroupDetails}
          onClose={() => setSelectedGroupDetails(null)}
        />
      )}
    </div>
  );
};

export default SACCOHub;

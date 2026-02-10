import React, { useState, useEffect } from 'react';
import {
  Users,
  Plus,
  Search,
  DollarSign,
  TrendingUp,
  Shield,
  ChevronRight,
  Wallet,
  CheckCircle,
  AlertCircle,
  Clock,
  User,
  Calendar,
  BarChart3,
  X,
  Eye,
  EyeOff,
  Video,
  Vote,
  Inbox,
  Building2,
  MoreVertical
} from 'lucide-react';
import LiveBoardroom from './LiveBoardroom';
import {
  getPublicTrustGroups,
  getUserTrustGroups,
  createTrustGroup,
  submitMembershipApplication,
  getTrustGroupDetails,
  getGroupStatistics,
  recordTrustTransaction,
  removeMemberFromGroup,
  promoteMemberToAdmin,
  updateGroupSettings,
  approveApplicationByAdmin,
  rejectApplicationByAdmin,
  voteOnMemberApplication,
  getVotingResults,
  getVotingApplicationsForMember,
  getUserPendingApplications
} from '../services/trustService';

const TrustSystem = ({ currentUser }) => {
  const [activeTab, setActiveTab] = useState('explore'); // 'explore', 'mygroups', 'create', 'dashboard', 'voting', 'applications', 'admin'
  const [groups, setGroups] = useState([]);
  const [myGroups, setMyGroups] = useState([]);
  const [votingApplications, setVotingApplications] = useState([]);
  const [myApplications, setMyApplications] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [showContributeModal, setShowContributeModal] = useState(false);
  const [boardroomGroupId, setBoardroomGroupId] = useState(null);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [groupForm, setGroupForm] = useState({
    name: '',
    description: '',
    maxMembers: 30,
    monthlyContribution: 100,
    currency: 'USD'
  });
  const [contributeForm, setContributeForm] = useState({
    amount: '',
    paymentMethod: 'card'
  });
  const [stats, setStats] = useState(null);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [showManageModal, setShowManageModal] = useState(false);
  const [selectedMember, setSelectedMember] = useState(null);
  const [editGroupForm, setEditGroupForm] = useState({
    name: '',
    description: '',
    monthlyContribution: '',
    status: 'active'
  });

  useEffect(() => {
    loadGroups();
    if (activeTab === 'voting') {
      loadVotingApplications();
    }
    if (activeTab === 'applications') {
      loadMyApplications();
    }
  }, [activeTab, currentUser?.id]);

  const loadGroups = async () => {
    setLoading(true);
    try {
      let data;
      if (activeTab === 'explore') {
        data = await getPublicTrustGroups();
        setGroups(data || []);
      } else if (activeTab === 'mygroups' && currentUser?.id) {
        data = await getUserTrustGroups(currentUser.id);
        setGroups(data || []);
        setMyGroups(data || []);
      } else if (activeTab === 'admin' && currentUser?.id) {
        data = await getUserTrustGroups(currentUser.id);
        setMyGroups(data || []);
      }
    } catch (error) {
      console.error('Error loading groups:', error);
      setMessage({ type: 'error', text: 'Failed to load groups' });
    } finally {
      setLoading(false);
    }
  };

  const handleCreateGroup = async (e) => {
    e.preventDefault();
    if (!currentUser?.id) {
      setMessage({ type: 'error', text: 'Please log in first' });
      return;
    }

    setLoading(true);
    try {
      const result = await createTrustGroup({
        ...groupForm,
        creatorId: currentUser.id
      });

      if (result.success) {
        setMessage({ type: 'success', text: '✓ TRUST group created successfully!' });
        setGroupForm({
          name: '',
          description: '',
          maxMembers: 30,
          monthlyContribution: 100,
          currency: 'USD'
        });
        setShowGroupModal(false);
        setActiveTab('mygroups');
        loadGroups();
      } else {
        setMessage({ type: 'error', text: result.error || 'Failed to create group' });
      }
    } catch (error) {
      console.error('Error creating group:', error);
      setMessage({ type: 'error', text: 'Error creating group' });
    } finally {
      setLoading(false);
    }
  };

  const handleJoinGroup = async (groupId) => {
    if (!currentUser?.id) {
      setMessage({ type: 'error', text: 'Please log in first' });
      return;
    }

    setLoading(true);
    try {
      const result = await submitMembershipApplication(groupId, currentUser.id, currentUser.email, 'Join request from user');

      if (result.success) {
        setMessage({ type: 'success', text: '✓ Membership application submitted!' });
        loadGroups();
      } else {
        setMessage({ type: 'error', text: result.error || 'Failed to join group' });
      }
    } catch (error) {
      console.error('Error joining group:', error);
      setMessage({ type: 'error', text: 'Error joining group' });
    } finally {
      setLoading(false);
    }
  };

  const handleViewDetails = async (group) => {
    setLoading(true);
    try {
      const details = await getTrustGroupDetails(group.id);
      const stats = await getGroupStatistics(group.id);
      setSelectedGroup(details);
      setStats(stats);
    } catch (error) {
      console.error('Error loading details:', error);
      setMessage({ type: 'error', text: 'Failed to load group details' });
    } finally {
      setLoading(false);
    }
  };

  const handleContribute = async (e) => {
    e.preventDefault();
    if (!currentUser?.id || !selectedGroup?.id) return;

    setLoading(true);
    try {
      const result = await recordTrustTransaction({
        groupId: selectedGroup.id,
        fromUserId: currentUser.id,
        toUserId: selectedGroup.creator_id,
        amount: parseFloat(contributeForm.amount),
        currency: selectedGroup.currency,
        type: 'contribution',
        description: `Monthly contribution to ${selectedGroup.name}`
      });

      if (result.success) {
        setMessage({ type: 'success', text: '✓ Contribution recorded and verified on blockchain!' });
        setContributeForm({ amount: '', paymentMethod: 'card' });
        setShowContributeModal(false);
        handleViewDetails(selectedGroup);
      } else {
        setMessage({ type: 'error', text: result.error || 'Failed to record contribution' });
      }
    } catch (error) {
      console.error('Error recording contribution:', error);
      setMessage({ type: 'error', text: 'Error processing contribution' });
    } finally {
      setLoading(false);
    }
  };

  const filteredGroups = groups.filter(group =>
    group.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    group.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleManageGroup = (group) => {
    setSelectedGroup(group);
    setEditGroupForm({
      name: group.name,
      description: group.description,
      monthlyContribution: group.monthly_contribution,
      status: group.status
    });
    setShowManageModal(true);
  };

  const handleSaveGroupSettings = async () => {
    if (!selectedGroup?.id) return;

    setLoading(true);
    try {
      const result = await updateGroupSettings(selectedGroup.id, {
        name: editGroupForm.name,
        description: editGroupForm.description,
        monthly_contribution: parseFloat(editGroupForm.monthlyContribution)
      });

      if (result.success) {
        setMessage({ type: 'success', text: '✓ Group settings updated!' });
        setShowManageModal(false);
        loadGroups();
      } else {
        setMessage({ type: 'error', text: result.error || 'Failed to update group' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Error updating group settings' });
    } finally {
      setLoading(false);
    }
  };

  const handleToggleGroupStatus = async (newStatus) => {
    if (!selectedGroup?.id) return;

    setLoading(true);
    try {
      const result = await updateGroupSettings(selectedGroup.id, { status: newStatus });

      if (result.success) {
        setMessage({ type: 'success', text: `✓ Group ${newStatus}!` });
        handleViewDetails(selectedGroup);
      } else {
        setMessage({ type: 'error', text: result.error || 'Failed to update status' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Error updating status' });
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveMember = async (memberId) => {
    if (!selectedGroup?.id || !window.confirm('Remove this member from group?')) return;

    setLoading(true);
    try {
      const result = await removeMemberFromGroup(selectedGroup.id, memberId);

      if (result.success) {
        setMessage({ type: 'success', text: '✓ Member removed' });
        handleViewDetails(selectedGroup);
      } else {
        setMessage({ type: 'error', text: result.error || 'Failed to remove member' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Error removing member' });
    } finally {
      setLoading(false);
    }
  };

  const handlePromoteToAdmin = async (memberId) => {
    if (!selectedGroup?.id) return;

    setLoading(true);
    try {
      const result = await promoteMemberToAdmin(selectedGroup.id, memberId);

      if (result.success) {
        setMessage({ type: 'success', text: '✓ Member promoted to admin' });
        handleViewDetails(selectedGroup);
      } else {
        setMessage({ type: 'error', text: result.error || 'Failed to promote member' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Error promoting member' });
    } finally {
      setLoading(false);
    }
  };

  const handleDemoteFromAdmin = async (memberId) => {
    if (!selectedGroup?.id) return;

    setLoading(true);
    try {
      // Remove admin role by updating group settings
      const result = await updateGroupSettings(selectedGroup.id, { removedAdmin: memberId });

      if (result.success) {
        setMessage({ type: 'success', text: '✓ Member demoted to member' });
        handleViewDetails(selectedGroup);
      } else {
        setMessage({ type: 'error', text: result.error || 'Failed to demote member' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Error demoting member' });
    } finally {
      setLoading(false);
    }
  };

  const handleCloseGroup = async () => {
    if (!selectedGroup?.id || !window.confirm('Close this group? This action cannot be undone.')) return;

    setLoading(true);
    try {
      const result = await updateGroupSettings(selectedGroup.id, { status: 'closed' });

      if (result.success) {
        setMessage({ type: 'success', text: '✓ Group archived' });
        setSelectedGroup(null);
        setShowManageModal(false);
        loadGroups();
      } else {
        setMessage({ type: 'error', text: result.error || 'Failed to close group' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Error closing group' });
    } finally {
      setLoading(false);
    }
  };

  const handleVoteOnApplication = async (applicationId, voteType) => {
    if (!currentUser?.id) return;
    
    setLoading(true);
    try {
      const result = await voteOnMemberApplication(applicationId, currentUser.id, voteType);
      
      if (result.success) {
        setMessage({ type: 'success', text: `✓ Vote recorded: ${voteType}` });
        
        // Immediately remove the voted application from the list (optimistic update)
        setVotingApplications(votingApplications.filter(app => app.id !== applicationId));
        
        // Also refresh from server to ensure consistency
        loadVotingApplications();
      } else {
        setMessage({ type: 'error', text: result.error || 'Failed to record vote' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Error recording vote' });
    } finally {
      setLoading(false);
    }
  };

  const loadVotingApplications = async () => {
    try {
      if (currentUser?.id) {
        const data = await getVotingApplicationsForMember(currentUser.id);
        setVotingApplications(data || []);
      }
    } catch (error) {
      console.error('Error loading voting applications:', error);
      setVotingApplications([]);
    }
  };

  const loadMyApplications = async () => {
    try {
      if (currentUser?.id) {
        const data = await getUserPendingApplications(currentUser.id);
        setMyApplications(data || []);
      }
    } catch (error) {
      console.error('Error loading my applications:', error);
      setMyApplications([]);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 py-4 sm:py-8 px-3 sm:px-4">
      {/* Header */}
      <div className="max-w-7xl mx-auto mb-6 sm:mb-8">
        <div className="flex items-center justify-between mb-4 sm:mb-6 gap-2">
          <div className="flex items-center gap-2 sm:gap-3">
            <Shield className="w-7 h-7 sm:w-10 sm:h-10 text-amber-500 flex-shrink-0" />
            <div className="min-w-0">
              <h1 className="text-lg sm:text-4xl font-bold text-white truncate">🏦 SACCO HUB</h1>
              <p className="text-xs sm:text-base text-amber-300 mt-0 sm:mt-1 truncate">Cooperative Savings Groups</p>
            </div>
          </div>
        </div>

        {/* Message Alert */}
        {message.text && (
          <div className={`p-4 rounded-lg mb-6 flex justify-between items-center ${
            message.type === 'success' 
              ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
              : 'bg-red-500/10 border border-red-500/20 text-red-400'
          }`}>
            <span className="flex items-center gap-2">
              {message.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
              {message.text}
            </span>
            <button onClick={() => setMessage({ type: '', text: '' })} className="hover:opacity-75">
              <X size={18} />
            </button>
          </div>
        )}

        {/* Tabs - Desktop View */}
        <div className="hidden sm:flex gap-4 border-b border-slate-700 py-0">
          <button onClick={() => { setActiveTab('explore'); setShowMobileMenu(false); }} className={`px-6 py-4 font-semibold text-base transition-all flex items-center gap-2 whitespace-nowrap relative ${activeTab === 'explore' ? 'text-amber-500 border-b-2 border-amber-500' : 'text-slate-400 hover:text-slate-300'}`}>🔍 Explore</button>
          <button onClick={() => { setActiveTab('mygroups'); setShowMobileMenu(false); }} className={`px-6 py-4 font-semibold text-base transition-all flex items-center gap-2 whitespace-nowrap relative ${activeTab === 'mygroups' ? 'text-amber-500 border-b-2 border-amber-500' : 'text-slate-400 hover:text-slate-300'}`}>👥 My Trusts</button>
          <button onClick={() => { setActiveTab('voting'); setShowMobileMenu(false); }} className={`px-6 py-4 font-semibold text-base transition-all flex items-center gap-2 whitespace-nowrap relative ${activeTab === 'voting' ? 'text-amber-500 border-b-2 border-amber-500' : 'text-slate-400 hover:text-slate-300'}`}>🗳️ Vote {votingApplications.length > 0 && <span className="ml-1 px-2 py-0.5 bg-red-500 text-white text-xs rounded-full font-bold">{votingApplications.length}</span>}</button>
          <button onClick={() => { setActiveTab('applications'); setShowMobileMenu(false); }} className={`px-6 py-4 font-semibold text-base transition-all flex items-center gap-2 whitespace-nowrap relative ${activeTab === 'applications' ? 'text-amber-500 border-b-2 border-amber-500' : 'text-slate-400 hover:text-slate-300'}`}>📮 Applications {myApplications.length > 0 && <span className="ml-1 px-2 py-0.5 bg-red-500 text-white text-xs rounded-full font-bold">{myApplications.length}</span>}</button>
          <button onClick={() => { setActiveTab('create'); setShowMobileMenu(false); }} className={`px-6 py-4 font-semibold text-base transition-all flex items-center gap-2 whitespace-nowrap relative ${activeTab === 'create' ? 'text-amber-500 border-b-2 border-amber-500' : 'text-slate-400 hover:text-slate-300'}`}>✨ Create</button>
          <button onClick={() => { setActiveTab('admin'); setShowMobileMenu(false); }} className={`px-6 py-4 font-semibold text-base transition-all flex items-center gap-2 whitespace-nowrap relative ${activeTab === 'admin' ? 'text-amber-500 border-b-2 border-amber-500' : 'text-slate-400 hover:text-slate-300'}`}>👑 Admin Panel</button>
        </div>

        {/* Tabs - Mobile View with Dots Menu */}
        <div className="sm:hidden flex items-center justify-between border-b border-slate-700 py-2 px-3 relative">
          <div className="flex gap-2 flex-1">
            <button onClick={() => { setActiveTab('explore'); setShowMobileMenu(false); }} className={`px-2 py-2 font-semibold text-sm transition-all flex items-center gap-1 whitespace-nowrap relative ${activeTab === 'explore' ? 'text-amber-500 border-b-2 border-amber-500' : 'text-slate-400 hover:text-slate-300'}`}>🔍</button>
            <button onClick={() => { setActiveTab('mygroups'); setShowMobileMenu(false); }} className={`px-2 py-2 font-semibold text-sm transition-all flex items-center gap-1 whitespace-nowrap relative ${activeTab === 'mygroups' ? 'text-amber-500 border-b-2 border-amber-500' : 'text-slate-400 hover:text-slate-300'}`}>👥</button>
          </div>
          
          <div className="relative">
            <button onClick={() => setShowMobileMenu(!showMobileMenu)} className="p-2 hover:bg-slate-800/50 rounded-lg transition-colors text-slate-400 hover:text-white"><MoreVertical className="w-5 h-5" /></button>
            {showMobileMenu && (
              <div className="absolute right-0 top-full mt-2 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-50 min-w-max">
                <button onClick={() => { setActiveTab('explore'); setShowMobileMenu(false); }} className={`w-full text-left px-4 py-3 font-medium transition-all flex items-center justify-between gap-3 ${activeTab === 'explore' ? 'bg-amber-600/20 text-amber-400' : 'text-slate-300 hover:bg-slate-700/50'}`}>🔍 Explore</button>
                <button onClick={() => { setActiveTab('mygroups'); setShowMobileMenu(false); }} className={`w-full text-left px-4 py-3 font-medium transition-all flex items-center justify-between gap-3 ${activeTab === 'mygroups' ? 'bg-amber-600/20 text-amber-400' : 'text-slate-300 hover:bg-slate-700/50'}`}>👥 My Trusts</button>
                <button onClick={() => { setActiveTab('voting'); setShowMobileMenu(false); }} className={`w-full text-left px-4 py-3 font-medium transition-all flex items-center justify-between gap-3 ${activeTab === 'voting' ? 'bg-amber-600/20 text-amber-400' : 'text-slate-300 hover:bg-slate-700/50'}`}>🗳️ Vote {votingApplications.length > 0 && <span className="ml-auto px-2 py-1 bg-red-500 text-white text-xs rounded-full font-bold flex-shrink-0">{votingApplications.length}</span>}</button>
                <button onClick={() => { setActiveTab('applications'); setShowMobileMenu(false); }} className={`w-full text-left px-4 py-3 font-medium transition-all flex items-center justify-between gap-3 ${activeTab === 'applications' ? 'bg-amber-600/20 text-amber-400' : 'text-slate-300 hover:bg-slate-700/50'}`}>📮 Applications {myApplications.length > 0 && <span className="ml-auto px-2 py-1 bg-red-500 text-white text-xs rounded-full font-bold flex-shrink-0">{myApplications.length}</span>}</button>
                <button onClick={() => { setActiveTab('create'); setShowMobileMenu(false); }} className={`w-full text-left px-4 py-3 font-medium transition-all flex items-center justify-between gap-3 ${activeTab === 'create' ? 'bg-amber-600/20 text-amber-400' : 'text-slate-300 hover:bg-slate-700/50'}`}>✨ Create</button>
                <button onClick={() => { setActiveTab('admin'); setShowMobileMenu(false); }} className={`w-full text-left px-4 py-3 font-medium transition-all flex items-center justify-between gap-3 ${activeTab === 'admin' ? 'bg-amber-600/20 text-amber-400' : 'text-slate-300 hover:bg-slate-700/50'}`}>👑 Admin Panel</button>
              </div>
            )}
          </div>
        </div>

      </div>

      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
        {/* EXPLORE GROUPS TAB */}
        {activeTab === 'explore' && (
          <div>
            <div className="mb-4 sm:mb-6">
              <div className="relative">
                <Search className="absolute left-3 top-3 text-slate-500 w-4 h-4 sm:w-5 sm:h-5" />
                <input
                  type="text"
                  placeholder="Search groups..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 sm:pl-10 pr-3 sm:pr-4 py-2 sm:py-3 bg-slate-800 border border-slate-700 rounded-lg text-sm sm:text-base text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>

            {loading && (
              <div className="text-center py-12">
                <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-amber-500"></div>
                <p className="text-slate-400 mt-4">Loading groups...</p>
              </div>
            )}

            {!loading && filteredGroups.length === 0 ? (
              <div className="text-center py-12">
                <Shield className="w-16 h-16 text-slate-600 mx-auto mb-4" />
                <p className="text-slate-400 text-lg">No groups found. Create one to get started!</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                {filteredGroups.map(group => (
                  <div key={group.id} className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 sm:p-6 hover:border-amber-500/30 transition-all">
                    <div className="flex justify-between items-start gap-2 mb-3 sm:mb-4">
                      <div className="min-w-0 flex-1">
                        <h3 className="text-lg sm:text-xl font-bold text-white truncate">{group.name}</h3>
                        <p className="text-slate-400 text-xs sm:text-sm mt-1 line-clamp-2">{group.description}</p>
                      </div>
                      <Shield className="w-5 h-5 sm:w-6 sm:h-6 text-amber-500 flex-shrink-0" />
                    </div>

                    <div className="space-y-2 sm:space-y-3 mb-4 sm:mb-6">
                      <div className="flex items-center gap-2 text-slate-300 text-sm">
                        <Users size={14} className="text-amber-500 flex-shrink-0" />
                        <span>{group.member_count || 0}/{group.max_members} Members</span>
                      </div>
                      <div className="flex items-center gap-2 text-slate-300 text-sm">
                        <DollarSign size={14} className="text-emerald-500 flex-shrink-0" />
                        <span>${group.monthly_contribution} Monthly</span>
                      </div>
                      <div className="flex items-center gap-2 text-slate-300 text-sm">
                        <Calendar size={14} className="text-blue-500 flex-shrink-0" />
                        <span>{new Date(group.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>

                    <div className="flex gap-2 flex-col sm:flex-row">
                      <button
                        onClick={() => handleViewDetails(group)}
                        className="hidden sm:flex flex-1 px-3 sm:px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors text-xs sm:text-sm font-medium"
                      >
                        View Details
                      </button>
                      <button
                        onClick={() => handleJoinGroup(group.id)}
                        className="flex-1 px-3 sm:px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg transition-colors text-xs sm:text-sm font-medium"
                      >
                        Join Group
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* MY GROUPS TAB */}
        {activeTab === 'mygroups' && (
          <div>
            {loading && (
              <div className="text-center py-12">
                <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-amber-500"></div>
                <p className="text-slate-400 mt-4">Loading your groups...</p>
              </div>
            )}

            {!loading && groups.length === 0 ? (
              <div className="text-center py-12 bg-slate-800/30 border border-slate-700 rounded-lg">
                <Users className="w-16 h-16 text-slate-600 mx-auto mb-4" />
                <p className="text-slate-400 text-lg mb-4">You haven't joined any TRUST groups yet</p>
                <button
                  onClick={() => setActiveTab('explore')}
                  className="px-6 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg transition-colors font-medium"
                >
                  Explore Available Groups
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {groups.map(group => (
                  <div key={group.id} className="bg-gradient-to-br from-slate-800 to-slate-800/50 border border-slate-700 rounded-lg p-6">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h3 className="text-xl font-bold text-white">{group.name}</h3>
                        <p className="text-slate-400 text-sm mt-1">{group.description}</p>
                      </div>
                      <div className="flex items-center gap-2 px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
                        <CheckCircle size={14} className="text-emerald-400" />
                        <span className="text-emerald-400 text-xs font-semibold">Active</span>
                      </div>
                    </div>

                    <div className="space-y-2 mb-6 text-sm">
                      <p className="text-slate-300">
                        <span className="text-slate-400">Members:</span> {group.member_count || 0}/{group.max_members}
                      </p>
                      <p className="text-slate-300">
                        <span className="text-slate-400">Monthly:</span> ${group.monthly_contribution}
                      </p>
                      <p className="text-slate-300">
                        <span className="text-slate-400">Joined:</span> {new Date(group.created_at).toLocaleDateString()}
                      </p>
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={() => handleViewDetails(group)}
                        className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors text-sm font-medium"
                      >
                        View Details
                      </button>
                      <button
                        onClick={() => {
                          setSelectedGroup(group);
                          setShowContributeModal(true);
                        }}
                        className="flex-1 px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg transition-colors text-sm font-medium"
                      >
                        Contribute
                      </button>
                      <button
                        onClick={() => setBoardroomGroupId(group.id)}
                        className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors text-sm font-medium flex items-center justify-center gap-1"
                      >
                        <Video size={16} />
                        Boardroom
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* CREATE GROUP TAB */}
        {activeTab === 'create' && (
          <div className="max-w-2xl mx-auto">
            <div className="bg-gradient-to-br from-slate-800 to-slate-800/50 border border-slate-700 rounded-lg p-8">
              <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-2">
                <Plus className="text-amber-500" />
                Create a New TRUST Group
              </h2>

              <form onSubmit={handleCreateGroup} className="space-y-6">
                <div>
                  <label className="block text-slate-300 font-semibold mb-2">Group Name *</label>
                  <input
                    type="text"
                    required
                    value={groupForm.name}
                    onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })}
                    placeholder="e.g., Summer Savings Circle"
                    className="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-2">Description</label>
                  <textarea
                    value={groupForm.description}
                    onChange={(e) => setGroupForm({ ...groupForm, description: e.target.value })}
                    placeholder="Describe your TRUST group's purpose and goals..."
                    rows={4}
                    className="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 resize-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-slate-300 font-semibold mb-2">Max Members</label>
                    <select
                      value={groupForm.maxMembers}
                      onChange={(e) => setGroupForm({ ...groupForm, maxMembers: parseInt(e.target.value) })}
                      className="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-amber-500"
                    >
                      {[5, 10, 15, 20, 25, 30].map(num => (
                        <option key={num} value={num}>{num} Members</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-300 font-semibold mb-2">Currency</label>
                    <select
                      value={groupForm.currency}
                      onChange={(e) => setGroupForm({ ...groupForm, currency: e.target.value })}
                      className="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-amber-500"
                    >
                      <option value="USD">USD - US Dollar</option>
                      <option value="EUR">EUR - Euro</option>
                      <option value="GBP">GBP - British Pound</option>
                      <option value="KES">KES - Kenyan Shilling</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-2">Monthly Contribution Amount *</label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-3 text-slate-500" size={20} />
                    <input
                      type="number"
                      required
                      min="1"
                      step="0.01"
                      value={groupForm.monthlyContribution}
                      onChange={(e) => setGroupForm({ ...groupForm, monthlyContribution: parseFloat(e.target.value) })}
                      placeholder="100"
                      className="w-full pl-10 pr-4 py-3 bg-slate-900 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                    />
                  </div>
                  <p className="text-slate-400 text-sm mt-2">Each member contributes this amount monthly</p>
                </div>

                <div className="bg-slate-900/50 border border-amber-500/20 rounded-lg p-4">
                  <p className="text-amber-400 text-sm flex items-start gap-2">
                    <Shield size={16} className="flex-shrink-0 mt-0.5" />
                    <span>All transactions are verified and recorded on the blockchain for transparency and security.</span>
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={loading || !groupForm.name || !groupForm.monthlyContribution}
                  className="w-full px-6 py-3 bg-amber-600 hover:bg-amber-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white rounded-lg transition-colors font-semibold flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                      Creating...
                    </>
                  ) : (
                    <>
                      <Plus size={20} />
                      Create TRUST Group
                    </>
                  )}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* DASHBOARD TAB */}
        {activeTab === 'dashboard' && (
          <div className="max-w-7xl mx-auto">
            <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-2">
              <BarChart3 className="text-amber-500" />
              Trust Network Dashboard
            </h2>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              <div className="bg-gradient-to-br from-slate-800 to-slate-800/50 border border-slate-700 rounded-lg p-6">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-slate-400 text-sm font-semibold">Total Trusts</p>
                  <Users className="w-5 h-5 text-amber-500" />
                </div>
                <p className="text-3xl font-bold text-white">{groups.length}</p>
                <p className="text-slate-500 text-xs mt-2">Active trust groups</p>
              </div>

              <div className="bg-gradient-to-br from-slate-800 to-slate-800/50 border border-slate-700 rounded-lg p-6">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-slate-400 text-sm font-semibold">Total Members</p>
                  <Users className="w-5 h-5 text-blue-500" />
                </div>
                <p className="text-3xl font-bold text-white">
                  {groups.reduce((sum, g) => sum + (g.member_count || 0), 0)}
                </p>
                <p className="text-slate-500 text-xs mt-2">Across all trusts</p>
              </div>

              <div className="bg-gradient-to-br from-slate-800 to-slate-800/50 border border-slate-700 rounded-lg p-6">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-slate-400 text-sm font-semibold">Total Contributed</p>
                  <DollarSign className="w-5 h-5 text-emerald-500" />
                </div>
                <p className="text-3xl font-bold text-emerald-400">
                  ${groups.reduce((sum, g) => sum + (g.total_contributed || 0), 0).toFixed(2)}
                </p>
                <p className="text-slate-500 text-xs mt-2">Network total</p>
              </div>

              <div className="bg-gradient-to-br from-slate-800 to-slate-800/50 border border-slate-700 rounded-lg p-6">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-slate-400 text-sm font-semibold">Verified Transactions</p>
                  <CheckCircle className="w-5 h-5 text-amber-500" />
                </div>
                <p className="text-3xl font-bold text-amber-400">
                  {groups.reduce((sum, g) => sum + (g.verified_transactions || 0), 0)}
                </p>
                <p className="text-slate-500 text-xs mt-2">Blockchain verified</p>
              </div>
            </div>

            {/* Recent Activity */}
            <div className="bg-gradient-to-br from-slate-800 to-slate-800/50 border border-slate-700 rounded-lg p-6">
              <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <TrendingUp className="text-amber-500" />
                Recent Trust Groups
              </h3>

              {groups.length === 0 ? (
                <p className="text-slate-400 text-center py-8">No trust groups yet</p>
              ) : (
                <div className="space-y-3">
                  {groups.slice(0, 5).map(group => (
                    <div key={group.id} className="flex items-center justify-between p-4 bg-slate-900/50 rounded-lg">
                      <div className="flex-1">
                        <p className="text-white font-semibold">{group.name}</p>
                        <p className="text-slate-400 text-sm">{group.member_count || 0} members • ${group.monthly_contribution}/month</p>
                      </div>
                      <div className="text-right">
                        <p className="text-emerald-400 font-semibold">${(group.total_contributed || 0).toFixed(2)}</p>
                        <p className="text-slate-500 text-xs">contributed</p>
                      </div>
                    </div>
                  ))}
                  {groups.length > 5 && (
                    <p className="text-slate-400 text-center py-2">+{groups.length - 5} more groups</p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* VOTING TAB */}
        {activeTab === 'voting' && (
          <div className="py-6 sm:py-8">
            <h2 className="text-2xl font-bold text-white mb-6">�️ Vote on Applications</h2>
            {votingApplications.length === 0 ? (
              <div className="text-center py-12 bg-slate-800/50 rounded-lg border border-slate-700">
                <CheckCircle className="w-12 h-12 text-gray-500 mx-auto mb-3" />
                <p className="text-gray-400">No pending votes</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:gap-6">
                {votingApplications.map(app => (
                  <div key={app.id} className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 sm:p-6">
                    <div className="flex justify-between items-start mb-3 sm:mb-4 gap-2">
                      <div>
                        <h3 className="text-lg sm:text-xl font-bold text-white">{app.applicant_email}</h3>
                        <p className="text-slate-400 text-sm">for {app.group_name}</p>
                      </div>
                      <span className="px-2 sm:px-3 py-1 bg-blue-600 text-white text-xs rounded-full flex-shrink-0">Pending</span>
                    </div>
                    <p className="text-slate-300 text-sm mb-4 sm:mb-6">{app.application_text}</p>
                    <div className="flex gap-2 sm:gap-3">
                      <button
                        onClick={() => handleVoteOnApplication(app.id, 'approve')}
                        className="flex-1 px-3 sm:px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors text-xs sm:text-sm font-medium"
                      >
                        ✓ Approve
                      </button>
                      <button
                        onClick={() => handleVoteOnApplication(app.id, 'reject')}
                        className="flex-1 px-3 sm:px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors text-xs sm:text-sm font-medium"
                      >
                        ✕ Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* APPLICATIONS TAB */}
        {activeTab === 'applications' && (
          <div className="py-6 sm:py-8">
            <h2 className="text-2xl font-bold text-white mb-6">� My Applications</h2>
            {myApplications.length === 0 ? (
              <div className="text-center py-12 bg-slate-800/50 rounded-lg border border-slate-700">
                <AlertCircle className="w-12 h-12 text-gray-500 mx-auto mb-3" />
                <p className="text-gray-400">No applications yet</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:gap-6">
                {myApplications.map(app => (
                  <div key={app.id} className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 sm:p-6">
                    <div className="flex justify-between items-start mb-3 sm:mb-4 gap-2">
                      <div>
                        <h3 className="text-lg sm:text-xl font-bold text-white">{app.group_name}</h3>
                        <p className="text-slate-400 text-sm">{new Date(app.created_at).toLocaleDateString()}</p>
                      </div>
                      <span className={`px-2 sm:px-3 py-1 text-xs rounded-full font-semibold flex-shrink-0 ${
                        app.status === 'pending' ? 'bg-yellow-600 text-white' :
                        app.status === 'approved' ? 'bg-emerald-600 text-white' :
                        'bg-red-600 text-white'
                      }`}>
                        {app.status.charAt(0).toUpperCase() + app.status.slice(1)}
                      </span>
                    </div>
                    <p className="text-slate-300 text-sm">{app.application_text}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ADMIN PANEL TAB */}
        {activeTab === 'admin' && (
          <div className="py-6 sm:py-8">
            <h2 className="text-2xl font-bold text-white mb-6">� Admin Panel</h2>
            {myGroups.filter(g => g.creator_id === currentUser?.id).length === 0 ? (
              <div className="text-center py-12 bg-slate-800/50 rounded-lg border border-slate-700">
                <Shield className="w-12 h-12 text-gray-500 mx-auto mb-3" />
                <p className="text-gray-400">You don't have any groups to manage</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:gap-6">
                {myGroups.filter(g => g.creator_id === currentUser?.id).map(group => (
                  <div key={group.id} className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 sm:p-6">
                    <div className="flex justify-between items-start mb-4 gap-2">
                      <div>
                        <h3 className="text-lg sm:text-xl font-bold text-white">{group.name}</h3>
                        <p className="text-slate-400 text-sm">{group.member_count || 0} members</p>
                      </div>
                      <button
                        onClick={() => {
                          setSelectedGroup(group);
                          setShowManageModal(true);
                        }}
                        className="px-3 sm:px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg transition-colors text-xs sm:text-sm font-medium flex-shrink-0"
                      >
                        ⚙️ Manage
                      </button>
                    </div>
                    <p className="text-slate-300 text-sm">{group.description}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* GROUP DETAILS MODAL */}
      {selectedGroup && !showGroupModal && !showContributeModal && !showManageModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-slate-800 rounded-lg max-w-2xl w-full max-h-96 overflow-y-auto">
            <div className="sticky top-0 bg-slate-800 border-b border-slate-700 p-6 flex justify-between items-start">
              <div>
                <h2 className="text-2xl font-bold text-white">{selectedGroup.name}</h2>
                <p className="text-slate-400 mt-1">{selectedGroup.description}</p>
              </div>
              <button onClick={() => setSelectedGroup(null)} className="text-slate-400 hover:text-white">
                <X size={24} />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Stats */}
              {stats && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
                    <p className="text-slate-400 text-sm">Total Contributed</p>
                    <p className="text-2xl font-bold text-emerald-400">${stats.totalContributed.toFixed(2)}</p>
                  </div>
                  <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
                    <p className="text-slate-400 text-sm">Total Payouts</p>
                    <p className="text-2xl font-bold text-blue-400">${stats.totalPayouts.toFixed(2)}</p>
                  </div>
                  <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
                    <p className="text-slate-400 text-sm">Verified Transactions</p>
                    <p className="text-2xl font-bold text-amber-400">{stats.verifiedTransactions}/{stats.totalTransactions}</p>
                  </div>
                  <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
                    <p className="text-slate-400 text-sm">Group Status</p>
                    <p className="text-lg font-bold text-emerald-400 flex items-center gap-1">
                      <CheckCircle size={16} /> {selectedGroup.status}
                    </p>
                  </div>
                </div>
              )}

              {/* Members List */}
              {selectedGroup.members && selectedGroup.members.length > 0 && (
                <div>
                  <h3 className="font-bold text-white mb-3 flex items-center gap-2">
                    <Users size={18} className="text-amber-500" />
                    Members ({selectedGroup.members.length}/{selectedGroup.max_members})
                  </h3>
                  <div className="space-y-2">
                    {selectedGroup.members.slice(0, 5).map((member, idx) => (
                      <div key={member.id} className="flex justify-between items-center p-3 bg-slate-900/30 rounded border border-slate-700">
                        <div>
                          <p className="text-white font-medium">Member #{member.member_number}</p>
                          <p className="text-slate-400 text-sm">{member.role}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-emerald-400 text-sm">${member.total_contributed || 0}</p>
                          <p className="text-slate-400 text-xs">contributed</p>
                        </div>
                      </div>
                    ))}
                    {selectedGroup.members.length > 5 && (
                      <p className="text-slate-400 text-sm text-center py-2">+{selectedGroup.members.length - 5} more members</p>
                    )}
                  </div>
                </div>
              )}

              {/* Manage Button (only for creator) */}
              {selectedGroup.creator_id === currentUser?.id && (
                <button
                  onClick={() => handleManageGroup(selectedGroup)}
                  className="w-full px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-colors font-medium"
                >
                  ⚙️ Manage Group
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* GROUP MANAGEMENT MODAL */}
      {showManageModal && selectedGroup && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-slate-800 rounded-lg max-w-3xl w-full my-8">
            <div className="sticky top-0 bg-slate-800 border-b border-slate-700 p-6 flex justify-between items-center">
              <h2 className="text-2xl font-bold text-white">Manage: {selectedGroup.name}</h2>
              <button onClick={() => setShowManageModal(false)} className="text-slate-400 hover:text-white">
                <X size={24} />
              </button>
            </div>

            <div className="p-6 space-y-6 max-h-96 overflow-y-auto">
              {/* Edit Group Settings */}
              <div className="space-y-4">
                <h3 className="font-bold text-white text-lg">Group Settings</h3>
                
                <div>
                  <label className="block text-slate-300 font-semibold mb-2">Group Name</label>
                  <input
                    type="text"
                    value={editGroupForm.name}
                    onChange={(e) => setEditGroupForm({ ...editGroupForm, name: e.target.value })}
                    className="w-full px-4 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-2">Description</label>
                  <textarea
                    value={editGroupForm.description}
                    onChange={(e) => setEditGroupForm({ ...editGroupForm, description: e.target.value })}
                    rows={3}
                    className="w-full px-4 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-amber-500 resize-none"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-2">Monthly Contribution</label>
                  <div className="relative">
                    <span className="absolute left-3 top-2 text-slate-400">$</span>
                    <input
                      type="number"
                      step="0.01"
                      value={editGroupForm.monthlyContribution}
                      onChange={(e) => setEditGroupForm({ ...editGroupForm, monthlyContribution: e.target.value })}
                      className="w-full pl-8 pr-4 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-amber-500"
                    />
                  </div>
                </div>

                <button
                  onClick={handleSaveGroupSettings}
                  disabled={loading}
                  className="w-full px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-slate-700 text-white rounded-lg transition-colors font-medium"
                >
                  {loading ? 'Saving...' : '💾 Save Settings'}
                </button>
              </div>

              {/* Group Status */}
              <div className="border-t border-slate-700 pt-6 space-y-4">
                <h3 className="font-bold text-white text-lg">Group Status</h3>
                <p className="text-slate-300">Current Status: <span className="font-semibold text-amber-400">{selectedGroup.status}</span></p>
                
                <div className="flex gap-2 flex-wrap">
                  {selectedGroup.status === 'active' && (
                    <button
                      onClick={() => handleToggleGroupStatus('paused')}
                      disabled={loading}
                      className="px-4 py-2 bg-yellow-600 hover:bg-yellow-500 disabled:bg-slate-700 text-white rounded-lg transition-colors text-sm font-medium"
                    >
                      ⏸️ Pause Group
                    </button>
                  )}
                  {selectedGroup.status === 'paused' && (
                    <button
                      onClick={() => handleToggleGroupStatus('active')}
                      disabled={loading}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 text-white rounded-lg transition-colors text-sm font-medium"
                    >
                      ▶️ Resume Group
                    </button>
                  )}
                  <button
                    onClick={handleCloseGroup}
                    disabled={loading}
                    className="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:bg-slate-700 text-white rounded-lg transition-colors text-sm font-medium"
                  >
                    🔒 Close Group
                  </button>
                </div>
              </div>

              {/* Members Management */}
              <div className="border-t border-slate-700 pt-6 space-y-4">
                <h3 className="font-bold text-white text-lg">Members Management</h3>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {selectedGroup.members && selectedGroup.members.map((member) => (
                    <div key={member.id} className="p-3 bg-slate-900/50 border border-slate-700 rounded-lg flex justify-between items-center">
                      <div className="flex-1">
                        <p className="text-white font-medium">
                          Member #{member.member_number}
                          <span className="ml-2 text-xs px-2 py-1 bg-blue-500/20 text-blue-300 rounded">
                            {member.role}
                          </span>
                        </p>
                        <p className="text-slate-400 text-sm">${member.total_contributed || 0} contributed</p>
                      </div>
                      <div className="flex gap-1">
                        {member.role !== 'creator' && (
                          <>
                            {member.role === 'member' ? (
                              <button
                                onClick={() => handlePromoteToAdmin(member.user_id)}
                                disabled={loading}
                                className="px-2 py-1 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 text-white rounded text-xs font-medium"
                                title="Promote to Admin"
                              >
                                📤
                              </button>
                            ) : (
                              <button
                                onClick={() => handleDemoteFromAdmin(member.user_id)}
                                disabled={loading}
                                className="px-2 py-1 bg-orange-600 hover:bg-orange-500 disabled:bg-slate-700 text-white rounded text-xs font-medium"
                                title="Demote to Member"
                              >
                                📥
                              </button>
                            )}
                            <button
                              onClick={() => handleRemoveMember(member.user_id)}
                              disabled={loading}
                              className="px-2 py-1 bg-red-600 hover:bg-red-500 disabled:bg-slate-700 text-white rounded text-xs font-medium"
                              title="Remove Member"
                            >
                              ✕
                            </button>
                          </>
                        )}
                        {member.role === 'creator' && (
                          <span className="text-amber-400 text-xs font-semibold">👑 Creator</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CONTRIBUTE MODAL */}
      {showContributeModal && selectedGroup && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-slate-800 rounded-lg max-w-md w-full">
            <div className="border-b border-slate-700 p-6 flex justify-between items-center">
              <h2 className="text-xl font-bold text-white">Make a Contribution</h2>
              <button onClick={() => setShowContributeModal(false)} className="text-slate-400 hover:text-white">
                <X size={24} />
              </button>
            </div>

            <form onSubmit={handleContribute} className="p-6 space-y-4">
              <div>
                <label className="block text-slate-300 font-semibold mb-2">Group: {selectedGroup.name}</label>
                <p className="text-slate-400 text-sm">Monthly contribution: ${selectedGroup.monthly_contribution}</p>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-2">Contribution Amount ({selectedGroup.currency})</label>
                <div className="relative">
                  <span className="absolute left-3 top-3 text-slate-400">$</span>
                  <input
                    type="number"
                    required
                    min="1"
                    step="0.01"
                    value={contributeForm.amount}
                    onChange={(e) => setContributeForm({ ...contributeForm, amount: e.target.value })}
                    placeholder={selectedGroup.monthly_contribution}
                    className="w-full pl-8 pr-4 py-3 bg-slate-900 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-2">Payment Method</label>
                <select
                  value={contributeForm.paymentMethod}
                  onChange={(e) => setContributeForm({ ...contributeForm, paymentMethod: e.target.value })}
                  className="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-amber-500"
                >
                  <option value="card">Credit/Debit Card</option>
                  <option value="bank">Bank Transfer</option>
                  <option value="wallet">Crypto Wallet</option>
                </select>
              </div>

              <div className="bg-slate-900/50 border border-amber-500/20 rounded-lg p-4">
                <p className="text-amber-400 text-sm flex items-start gap-2">
                  <Shield size={16} className="flex-shrink-0 mt-0.5" />
                  <span>This contribution will be verified and recorded on the blockchain for transparency.</span>
                </p>
              </div>

              <button
                type="submit"
                disabled={loading || !contributeForm.amount}
                className="w-full px-6 py-3 bg-amber-600 hover:bg-amber-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white rounded-lg transition-colors font-semibold"
              >
                {loading ? 'Processing...' : 'Confirm Contribution'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* LIVE BOARDROOM MODAL */}
      {boardroomGroupId && (
        <div className="fixed inset-0 bg-black/90 z-50 flex flex-col">
          <div className="flex items-center justify-between p-4 bg-slate-900 border-b border-slate-700">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Video className="text-blue-400" />
              {groups.find(g => g.id === boardroomGroupId)?.name} - Live Boardroom
            </h2>
            <button
              onClick={() => setBoardroomGroupId(null)}
              className="p-2 hover:bg-slate-800 rounded-lg transition text-slate-400 hover:text-white"
            >
              <X size={24} />
            </button>
          </div>
          <div className="flex-1 overflow-hidden">
            <LiveBoardroom
              groupId={boardroomGroupId}
              groupName={groups.find(g => g.id === boardroomGroupId)?.name}
              members={selectedGroup?.members || []}
              creatorId={selectedGroup?.creator_id}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default TrustSystem;

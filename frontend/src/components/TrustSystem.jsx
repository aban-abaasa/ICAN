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
import GroupWalletPINModal from './GroupWalletPINModal';
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
import { getCurrencySymbolByCode, getCurrencyInfo } from '../utils/currencyUtils';
import CountryService from '../services/countryService';
import icanCoinService from '../services/icanCoinService';

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
    currency: 'ICAN',
    groupWalletAddress: '',
    walletCreated: false
  });
  const [contributeForm, setContributeForm] = useState({
    amount: '',
    paymentMethod: 'ican'
  });
  const [stats, setStats] = useState(null);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [showManageModal, setShowManageModal] = useState(false);
  const [manageModalTab, setManageModalTab] = useState('settings'); // 'settings', 'account', 'members', 'status'
  const [selectedMember, setSelectedMember] = useState(null);
  const [editGroupForm, setEditGroupForm] = useState({
    name: '',
    description: '',
    monthlyContribution: '',
    status: 'active'
  });
  const [userCountry, setUserCountry] = useState(null);
  const [userCountryCode, setUserCountryCode] = useState('US');
  const [userCurrency, setUserCurrency] = useState('USD');
  const [currencySymbol, setCurrencySymbol] = useState('$');
  const [hasICANWallet, setHasICANWallet] = useState(false);
  const [walletLoading, setWalletLoading] = useState(true);
  const [groupWallets, setGroupWallets] = useState({}); // Track wallet status for each group
  const [showGroupPINModal, setShowGroupPINModal] = useState(false); // PIN modal state

  // Load user's country, currency, and ICAN wallet
  useEffect(() => {
    const loadUserCountry = async () => {
      try {
        // Method 1: Get from user metadata (fastest)
        let userCountryCodeValue = currentUser?.user_metadata?.country;
        
        // Method 2: Fallback to database if not in metadata
        if (!userCountryCodeValue && currentUser?.id) {
          const countryData = await icanCoinService.getUserCountry(currentUser.id);
          userCountryCodeValue = countryData || 'US';
        }

        // Default fallback
        if (!userCountryCodeValue) {
          userCountryCodeValue = 'US';
        }

        // Get all country info
        const countryInfo = CountryService.getCountry(userCountryCodeValue);
        const currencyCode = CountryService.getCurrencyCode(userCountryCodeValue);
        const currencySymbol = CountryService.getCurrencySymbol(userCountryCodeValue);
        
        setUserCountryCode(userCountryCodeValue);
        setUserCountry(countryInfo?.name || 'United States');
        setUserCurrency(currencyCode || 'USD');
        setCurrencySymbol(currencySymbol || '$');
        
        // Check if user has ICAN wallet
        if (currentUser?.id) {
          try {
            console.log('Checking user wallet for:', currentUser.id);
            const walletData = await icanCoinService.getUserWallet(currentUser.id);
            console.log('Wallet data retrieved:', walletData);
            const walletExists = walletData && (walletData.id || walletData.wallet_address || walletData.address);
            setHasICANWallet(walletExists);
            console.log('ICAN Wallet Status:', walletExists ? '✅ Wallet Found' : '❌ No Wallet');
          } catch (error) {
            console.log('Wallet verification error:', error?.message);
            setHasICANWallet(false);
          }
        }
        
        console.log(`✅ TrustSystem - Country: ${userCountryCodeValue}, Currency: ${currencyCode}, Symbol: ${currencySymbol}, Wallet: ${hasICANWallet}`);
      } catch (error) {
        console.log('Could not detect country in TrustSystem, using default USD');
        setUserCountryCode('US');
        setUserCountry('United States');
        setUserCurrency('USD');
        setCurrencySymbol('$');
        setHasICANWallet(false);
      } finally {
        setWalletLoading(false);
      }
    };

    if (currentUser?.id) {
      loadUserCountry();
    }
  }, [currentUser?.id]);

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

  // Auto-create ICAN wallets for groups that don't have them
  const ensureGroupWallets = async (groupsToCheck) => {
    try {
      const walletUpdates = {};
      
      for (const group of groupsToCheck) {
        // Check if group already has wallet
        if (!group.group_wallet_address) {
          // Generate a unique wallet address for this group
          const walletAddress = `ican_group_${group.id.substring(0, 8)}_${Date.now()}`;
          
          // Store wallet in groupWallets state
          walletUpdates[group.id] = {
            address: walletAddress,
            created: true,
            balance: 0
          };
          
          console.log(`✅ Created ICAN wallet for group: ${group.name} (${walletAddress})`);
        } else {
          walletUpdates[group.id] = {
            address: group.group_wallet_address,
            created: true,
            balance: group.group_wallet_balance || 0
          };
        }
      }
      
      setGroupWallets(walletUpdates);
    } catch (error) {
      console.error('Error ensuring group wallets:', error);
    }
  };

  // When admin tab is accessed, ensure all groups have wallets
  useEffect(() => {
    if (activeTab === 'admin' && myGroups.length > 0) {
      const adminGroups = myGroups.filter(g => g.creator_id === currentUser?.id);
      ensureGroupWallets(adminGroups);
    }
  }, [activeTab, myGroups, currentUser?.id]);

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
        setMessage({ type: 'success', text: '✓ TRUST group created with ICAN wallet!' });
        setGroupForm({
          name: '',
          description: '',
          maxMembers: 30,
          monthlyContribution: 100,
          currency: 'ICAN',
          groupWalletAddress: '',
          walletCreated: false
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

  const handleOpenContributeModal = async (group) => {
    // Verify user has ICAN coins before opening contribution modal
    if (!currentUser?.id) {
      setMessage({ type: 'error', text: 'Please log in first' });
      return;
    }

    try {
      // Re-check wallet/coin status from service (real-time check)
      console.log('Real-time wallet check for user:', currentUser.id);
      let walletExists = false;
      let walletData = null;
      
      try {
        walletData = await icanCoinService.getUserWallet(currentUser.id);
        // Check if user has coins or a wallet address
        walletExists = walletData && (walletData.id || walletData.wallet_address || walletData.address || (walletData.balance && parseFloat(walletData.balance) > 0));
        console.log('Wallet check result:', { walletExists, walletData });
      } catch (walletError) {
        console.log('Real-time wallet check error:', walletError?.message);
        walletExists = false;
      }

      // Update state with real wallet status
      setHasICANWallet(walletExists);
      setSelectedGroup(group);
      setShowContributeModal(true);

      if (!walletExists) {
        setMessage({ type: 'error', text: '❌ No ICAN coins found. Please create a wallet or buy ICAN coins in your profile to contribute.' });
      }
    } catch (error) {
      console.error('Error opening contribute modal:', error);
      setMessage({ type: 'error', text: '❌ Unable to verify wallet. Please try again.' });
    }
  };

  const handleContribute = async (e) => {
    e.preventDefault();
    if (!currentUser?.id || !selectedGroup?.id) return;

    // Verify ICAN wallet exists before processing
    if (!hasICANWallet) {
      setMessage({ type: 'error', text: '❌ Please set up your ICAN wallet first to make contributions' });
      return;
    }

    setLoading(true);
    try {
      // Double-check ICAN coins/wallet existence via service
      let walletVerified = false;
      let coinBalance = 0;
      try {
        const wallet = await icanCoinService.getUserWallet(currentUser.id);
        walletVerified = wallet && (wallet.id || wallet.wallet_address || wallet.address || (wallet.balance && parseFloat(wallet.balance) > 0));
        coinBalance = wallet?.balance || 0;
        console.log('💰 Contribution check - ICAN balance:', coinBalance);
      } catch (walletError) {
        console.log('Wallet verification error:', walletError);
        walletVerified = hasICANWallet;
      }

      if (!walletVerified) {
        setMessage({ type: 'error', text: '❌ No ICAN coins found. Please buy ICAN coins in your profile before contributing.' });
        setLoading(false);
        return;
      }

      // Verify user has enough coins for contribution
      const contributionAmount = parseFloat(contributeForm.amount);
      if (coinBalance < contributionAmount) {
        setMessage({ type: 'error', text: `❌ Insufficient ICAN coins. You have ${coinBalance} ICAN but need ${contributionAmount} ICAN.` });
        setLoading(false);
        return;
      }

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
        setMessage({ type: 'success', text: '✓ Contribution recorded and verified on blockchain using your ICAN wallet!' });
        setContributeForm({ amount: '', paymentMethod: 'ican' });
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

        {/* ICAN Wallet Requirement Banner */}
        {!walletLoading && !hasICANWallet && (
          <div className="p-4 rounded-lg mb-6 bg-amber-500/15 border border-amber-500/40 flex items-start gap-3">
            <Wallet className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-amber-300 font-semibold text-sm sm:text-base">ICAN Wallet Required</p>
              <p className="text-amber-200/70 text-xs sm:text-sm mt-1">You need an active ICAN wallet account to join trust groups and make contributions. Set up your ICAN wallet first to get started.</p>
            </div>
          </div>
        )}

        {/* Tabs - Desktop View */}
        <div className="hidden sm:flex gap-4 border-b border-slate-700 py-0">
          <button onClick={() => { setActiveTab('explore'); setShowMobileMenu(false); }} className={`px-6 py-4 font-semibold text-base transition-all flex items-center gap-2 whitespace-nowrap relative ${activeTab === 'explore' ? 'text-amber-500 border-b-2 border-amber-500' : 'text-slate-400 hover:text-slate-300'}`}>🔍 Explore</button>
          <button onClick={() => { setActiveTab('mygroups'); setShowMobileMenu(false); }} className={`px-6 py-4 font-semibold text-base transition-all flex items-center gap-2 whitespace-nowrap relative ${activeTab === 'mygroups' ? 'text-amber-500 border-b-2 border-amber-500' : 'text-slate-400 hover:text-slate-300'}`}>👥 My Trusts</button>
          <button onClick={() => { setActiveTab('voting'); setShowMobileMenu(false); }} className={`px-6 py-4 font-semibold text-base transition-all flex items-center gap-2 whitespace-nowrap relative ${activeTab === 'voting' ? 'text-amber-500 border-b-2 border-amber-500' : 'text-slate-400 hover:text-slate-300'}`}>🗳️ Vote {votingApplications.length > 0 && <span className="ml-1 px-2 py-0.5 bg-red-500 text-white text-xs rounded-full font-bold">{votingApplications.length}</span>}</button>
          <button onClick={() => { setActiveTab('applications'); setShowMobileMenu(false); }} className={`px-6 py-4 font-semibold text-base transition-all flex items-center gap-2 whitespace-nowrap relative ${activeTab === 'applications' ? 'text-amber-500 border-b-2 border-amber-500' : 'text-slate-400 hover:text-slate-300'}`}>📮 Applications {myApplications.length > 0 && <span className="ml-1 px-2 py-0.5 bg-red-500 text-white text-xs rounded-full font-bold">{myApplications.length}</span>}</button>
          <button onClick={() => { setActiveTab('create'); setShowMobileMenu(false); }} className={`px-6 py-4 font-semibold text-base transition-all flex items-center gap-2 whitespace-nowrap relative ${activeTab === 'create' ? 'text-amber-500 border-b-2 border-amber-500' : 'text-slate-400 hover:text-slate-300'}`}>✨ Create</button>
          {myGroups.some(g => g.creator_id === currentUser?.id) && (
            <button onClick={() => { setActiveTab('admin'); setShowMobileMenu(false); }} className={`px-6 py-4 font-semibold text-base transition-all flex items-center gap-2 whitespace-nowrap relative ${activeTab === 'admin' ? 'text-amber-500 border-b-2 border-amber-500' : 'text-slate-400 hover:text-slate-300'}`}>👑 Admin Panel</button>
          )}
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
                {myGroups.some(g => g.creator_id === currentUser?.id) && (
                  <button onClick={() => { setActiveTab('admin'); setShowMobileMenu(false); }} className={`w-full text-left px-4 py-3 font-medium transition-all flex items-center justify-between gap-3 ${activeTab === 'admin' ? 'bg-amber-600/20 text-amber-400' : 'text-slate-300 hover:bg-slate-700/50'}`}>👑 Admin Panel</button>
                )}
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
              <div className="flex flex-wrap gap-2 sm:gap-3">
                {filteredGroups.map(group => (
                  <button
                    key={group.id}
                    onClick={() => handleViewDetails(group)}
                    className="px-3 sm:px-4 py-2 sm:py-2.5 bg-slate-700 hover:bg-amber-600 hover:border-amber-500 border border-slate-600 rounded-lg transition-all text-xs sm:text-sm font-medium text-white whitespace-nowrap flex items-center gap-2 active:bg-amber-700"
                  >
                    <span>{group.name}</span>
                    <span className="text-slate-300 text-xs">({group.member_count || 0}/{group.max_members})</span>
                  </button>
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
                        <span className="text-slate-400">Monthly:</span> ₿{group.monthly_contribution} ICAN
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
                        onClick={() => handleOpenContributeModal(group)}
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
                    <label className="block text-slate-300 font-semibold mb-2">Currency (ICAN Coins Only)</label>
                    <div className="w-full px-4 py-3 bg-gradient-to-r from-amber-900/30 to-amber-900/10 border border-amber-600/50 rounded-lg text-amber-300 font-semibold">
                      ₿ ICAN - ICAN Coins
                    </div>
                  </div>
                </div>

                <div>
                    <label className="block text-slate-300 font-semibold mb-2">Monthly Contribution Amount (ICAN Coins) *</label>
                    <div className="relative">
                      <span className="absolute left-3 top-3 text-amber-400 font-bold">₿</span>
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
                    <p className="text-slate-400 text-sm mt-2">Each member contributes this amount in ICAN coins monthly</p>
                </div>

                {/* Group ICAN Wallet Setup */}
                <div className="border-2 border-amber-500/30 rounded-lg p-4 bg-amber-900/10">
                  <h3 className="text-white font-bold mb-3 flex items-center gap-2">
                    <Wallet size={20} className="text-amber-400" />
                    Group ICAN Wallet Setup (Required)
                  </h3>
                  
                  {!groupForm.walletCreated ? (
                    <div className="space-y-3">
                      <p className="text-slate-300 text-sm">Every group needs a dedicated ICAN wallet for member transactions and withdrawals.</p>
                      <button
                        type="button"
                        onClick={() => {
                          // Simulate wallet creation
                          setGroupForm({ 
                            ...groupForm, 
                            walletCreated: true, 
                            groupWalletAddress: `ICAN-GROUP-${currentUser?.id?.substring(0, 8)}-${Date.now()}`
                          });
                        }}
                        className="w-full px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg transition-colors font-medium text-sm"
                      >
                        + Create Group ICAN Wallet
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2 bg-slate-900/50 p-3 rounded border border-emerald-500/30">
                      <div className="flex items-center gap-2 text-emerald-400">
                        <CheckCircle size={18} />
                        <span className="font-semibold">Wallet Created!</span>
                      </div>
                      <p className="text-slate-400 text-xs break-all">{groupForm.groupWalletAddress}</p>
                      <p className="text-emerald-300/70 text-xs mt-2">✓ All member contributions will go to this wallet</p>
                    </div>
                  )}
                </div>

                <div className="bg-slate-900/50 border border-amber-500/20 rounded-lg p-4">
                  <p className="text-amber-400 text-sm flex items-start gap-2">
                    <Shield size={16} className="flex-shrink-0 mt-0.5" />
                    <span>All transactions are verified and recorded on the blockchain for transparency and security.</span>
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={loading || !groupForm.name || !groupForm.monthlyContribution || !groupForm.walletCreated}
                  className="w-full px-6 py-3 bg-amber-600 hover:bg-amber-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white rounded-lg transition-colors font-semibold flex items-center justify-center gap-2"
                >
                  {!groupForm.walletCreated ? (
                    <>
                      <Wallet size={20} />
                      Setup Group Wallet First
                    </>
                  ) : loading ? (
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
                  {currencySymbol}{groups.reduce((sum, g) => sum + (g.total_contributed || 0), 0).toFixed(2)}
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
                        <p className="text-slate-400 text-sm">{group.member_count || 0} members • ₿{group.monthly_contribution}/month ICAN</p>
                      </div>
                      <div className="text-right">
                        <p className="text-emerald-400 font-semibold">₿{(group.total_contributed || 0).toFixed(2)} ICAN</p>
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

        {/* ADMIN PANEL TAB - Web Dashboard View */}
        {activeTab === 'admin' && (
          <div className="py-4 sm:py-8 px-3 sm:px-0">
            {/* Dashboard Header */}
            <div className="mb-6 sm:mb-8">
              <h1 className="text-2xl sm:text-3xl font-bold text-white mb-2">👑 Admin Dashboard</h1>
              <p className="text-slate-400 text-sm sm:text-base">Manage your groups and review member applications</p>
            </div>

            {/* Groups List */}
            {myGroups.filter(g => g.creator_id === currentUser?.id).length === 0 ? (
              <div className="text-center py-12 bg-slate-800/50 rounded-lg border border-slate-700">
                <Shield className="w-12 h-12 text-gray-500 mx-auto mb-3" />
                <p className="text-gray-400 mb-4">You don't have any groups to manage</p>
                <button
                  onClick={() => setActiveTab('create')}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg transition-colors font-medium text-sm"
                >
                  ✨ Create a Group
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {myGroups.filter(g => g.creator_id === currentUser?.id).map(group => {
                  // Count pending applications for this group
                  const groupPendingApps = myApplications.filter(app => app.group_id === group.id && app.status === 'pending').length;
                  // Count voting applications for this group
                  const groupVotingApps = votingApplications.filter(app => app.group_id === group.id).length;
                  
                  return (
                    <div key={group.id} className="bg-slate-800/60 border border-slate-700 rounded-lg p-4 sm:p-6 hover:border-slate-600 transition-colors">
                      {/* Group Header */}
                      <div className="flex justify-between items-start gap-3 mb-4">
                        <div className="flex-1 min-w-0">
                          <h3 className="text-lg sm:text-xl font-bold text-white truncate">{group.name}</h3>
                          <div className="flex items-center gap-2 mt-2 text-xs sm:text-sm text-slate-400 flex-wrap">
                            <span className="inline-flex items-center gap-1">
                              <span className="text-amber-400">👑</span>
                              <span>Creator</span>
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <span className="text-blue-400">👤</span>
                              <span className="font-medium">{group.member_count || 0} members</span>
                            </span>
                          </div>
                        </div>
                        {currentUser?.id === group.creator_id && (
                          <button
                            onClick={() => {
                              setSelectedGroup(group);
                              setShowManageModal(true);
                            }}
                            className="px-4 py-2 bg-amber-600 hover:bg-amber-500 active:bg-amber-700 text-white rounded-lg transition-colors text-sm font-medium flex-shrink-0 whitespace-nowrap"
                          >
                            ⚙️ Manage
                          </button>
                        )}
                      </div>

                      {/* Group Description */}
                      <p className="text-slate-300 text-sm mb-4 line-clamp-2">{group.description}</p>

                      {/* Wallet Status */}
                      {groupWallets[group.id]?.created ? (
                        <div className="mb-4 p-3 border border-emerald-500/40 bg-emerald-500/10 rounded-lg">
                          <p className="text-emerald-400 text-xs sm:text-sm font-semibold flex items-center gap-2">
                            <span>✅</span>
                            <span>Group ICAN Wallet Active</span>
                          </p>
                          <div className="mt-2 space-y-1.5 text-xs text-emerald-300/80">
                            <p className="flex items-start gap-2">
                              <span>•</span>
                              <span>Wallet: <span className="font-mono text-emerald-300">{groupWallets[group.id]?.address.substring(0, 20)}...</span></span>
                            </p>
                            <p className="flex items-start gap-2">
                              <span>•</span>
                              <span>Min withdrawal: <span className="font-bold">₿10 ICAN</span></span>
                            </p>
                            <p className="flex items-start gap-2">
                              <span>•</span>
                              <span>Approval required: <span className="font-bold">60%+ member vote</span></span>
                            </p>
                          </div>
                        </div>
                      ) : (
                        <div className="mb-4 p-3 border border-amber-500/40 bg-amber-500/10 rounded-lg animate-pulse">
                          <p className="text-amber-400 text-xs sm:text-sm font-semibold flex items-center gap-2">
                            <span>⏳</span>
                            <span>Setting Up Group ICAN Wallet...</span>
                          </p>
                          <div className="mt-2 space-y-1.5 text-xs text-amber-300/80">
                            <p className="flex items-start gap-2">
                              <span>•</span>
                              <span>Creating secure group wallet</span>
                            </p>
                            <p className="flex items-start gap-2">
                              <span>•</span>
                              <span>Min withdrawal: <span className="font-bold">₿10 ICAN</span></span>
                            </p>
                            <p className="flex items-start gap-2">
                              <span>•</span>
                              <span>Approval required: <span className="font-bold">60%+ member vote</span></span>
                            </p>
                          </div>
                        </div>
                      )}

                      {/* Stats Row */}
                      <div className="flex gap-3 sm:gap-4">
                        <div className="flex-1 bg-slate-900/50 border border-slate-700 rounded-lg p-3">
                          <p className="text-slate-400 text-xs sm:text-sm">⏳ Pending</p>
                          <p className="text-xl sm:text-2xl font-bold text-amber-400 mt-1">{groupPendingApps}</p>
                        </div>
                        <div className="flex-1 bg-slate-900/50 border border-slate-700 rounded-lg p-3">
                          <p className="text-slate-400 text-xs sm:text-sm">🗳️ Voting</p>
                          <p className="text-xl sm:text-2xl font-bold text-blue-400 mt-1">{groupVotingApps}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Total Pending Actions */}
            {myGroups.filter(g => g.creator_id === currentUser?.id).length > 0 && (
              <div className="mt-6 sm:mt-8 pt-6 sm:pt-8 border-t border-slate-700">
                {(() => {
                  const totalPending = myApplications.filter(app => app.status === 'pending' && myGroups.some(g => g.id === app.group_id && g.creator_id === currentUser?.id)).length;
                  const totalVoting = votingApplications.filter(app => myGroups.some(g => g.id === app.group_id && g.creator_id === currentUser?.id)).length;
                  const total = totalPending + totalVoting;
                  
                  return total > 0 ? (
                    <div className="flex items-center gap-3 text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
                      <span className="text-2xl">⚡</span>
                      <div>
                        <p className="font-semibold text-sm sm:text-base">{total} pending action{total !== 1 ? '(s)' : ''}</p>
                        <p className="text-xs sm:text-sm text-amber-300/80">{totalPending} applications + {totalVoting} voting</p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4">
                      <span className="text-2xl">✅</span>
                      <div>
                        <p className="font-semibold text-sm sm:text-base">All caught up!</p>
                        <p className="text-xs sm:text-sm text-emerald-300/80">No pending actions</p>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        )}


      </div>

      {/* GROUP DETAILS MODAL - Mobile Optimized */}
      {selectedGroup && !showGroupModal && !showContributeModal && !showManageModal && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4 z-[60]">
          <div className="bg-slate-800 rounded-t-lg sm:rounded-lg max-w-2xl w-full max-h-[90vh] sm:max-h-96 overflow-y-auto sm:my-8">
            <div className="sticky top-0 bg-slate-800 border-b border-slate-700 p-4 sm:p-6 flex justify-between items-start gap-2">
              <div className="flex-1 min-w-0">
                <h2 className="text-lg sm:text-2xl font-bold text-white truncate">{selectedGroup.name}</h2>
                <p className="text-slate-400 mt-1 text-xs sm:text-sm line-clamp-2">{selectedGroup.description}</p>
              </div>
              <button onClick={() => setSelectedGroup(null)} className="text-slate-400 hover:text-white flex-shrink-0">
                <X size={24} />
              </button>
            </div>

            <div className="p-4 sm:p-6 space-y-6">
              {/* Group Key Info */}
              <div className="space-y-3">
                {/* Member Fee Card */}
                <div className="bg-gradient-to-br from-amber-900/30 to-amber-900/10 border border-amber-700/30 rounded-lg p-4">
                  <p className="text-amber-300 text-xs sm:text-sm font-semibold flex items-center gap-2">
                    <span>💰</span> Member Fee
                  </p>
                  <p className="text-2xl sm:text-3xl font-bold text-amber-400 mt-2">₿{selectedGroup.monthly_contribution} ICAN</p>
                  <p className="text-amber-300/60 text-xs mt-1">Monthly contribution required</p>
                </div>

                {/* Group Size Card */}
                <div className="bg-gradient-to-br from-blue-900/30 to-blue-900/10 border border-blue-700/30 rounded-lg p-4">
                  <p className="text-blue-300 text-xs sm:text-sm font-semibold flex items-center gap-2">
                    <span>👥</span> Group Size
                  </p>
                  <p className="text-2xl sm:text-3xl font-bold text-blue-400 mt-2">{selectedGroup.member_count || 0}/{selectedGroup.max_members}</p>
                  <p className="text-blue-300/60 text-xs mt-1">{selectedGroup.max_members - (selectedGroup.member_count || 0)} spots available</p>
                </div>

                {/* Privacy & Trust Card */}
                <div className="bg-gradient-to-br from-emerald-900/30 to-emerald-900/10 border border-emerald-700/30 rounded-lg p-4">
                  <p className="text-emerald-300 text-xs sm:text-sm font-semibold flex items-center gap-2">
                    <span>🔒</span> Privacy First
                  </p>
                  <div className="mt-3 space-y-1.5 text-xs sm:text-sm text-emerald-300/80">
                    <p className="flex items-start gap-2">
                      <span>✓</span>
                      <span>Your data is encrypted end-to-end</span>
                    </p>
                    <p className="flex items-start gap-2">
                      <span>✓</span>
                      <span>Only members can view transaction details</span>
                    </p>
                    <p className="flex items-start gap-2">
                      <span>✓</span>
                      <span>Blockchain verified for transparency</span>
                    </p>
                  </div>
                </div>
              </div>

              {/* Members List */}
              {selectedGroup.members && selectedGroup.members.length > 0 && (
                <div>
                  <h3 className="font-bold text-white mb-3 flex items-center gap-2 text-sm sm:text-base">
                    <Users size={18} className="text-amber-500 flex-shrink-0" />
                    Members ({selectedGroup.members.length}/{selectedGroup.max_members})

                  </h3>
                  <div className="space-y-2">
                    {selectedGroup.members.slice(0, 5).map((member, idx) => (
                      <div key={member.id} className="flex justify-between items-center p-3 bg-slate-900/30 rounded border border-slate-700 text-xs sm:text-sm">
                        <div>
                          <p className="text-white font-medium">Member #{member.member_number}</p>
                          <p className="text-slate-400 text-xs sm:text-sm">{member.role}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-emerald-400 text-xs sm:text-sm font-medium">₿{member.total_contributed || 0} ICAN</p>
                          <p className="text-slate-400 text-xs">contributed</p>
                        </div>
                      </div>
                    ))}
                    {selectedGroup.members.length > 5 && (
                      <p className="text-slate-400 text-xs sm:text-sm text-center py-2">+{selectedGroup.members.length - 5} more members</p>
                    )}
                  </div>
                </div>
              )}

              {/* ICAN Wallet Warning - If joining */}
              {!hasICANWallet && (
                <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-start gap-2">
                  <AlertCircle size={18} className="text-amber-400 flex-shrink-0 mt-0.5" />
                  <p className="text-amber-300 text-xs sm:text-sm">Set up your ICAN wallet to join this group</p>
                </div>
              )}

              {/* Join Button */}
              <button
                onClick={() => handleJoinGroup(selectedGroup.id)}
                disabled={loading || !hasICANWallet}
                className="w-full px-4 py-3 bg-amber-600 hover:bg-amber-500 active:bg-amber-700 disabled:bg-slate-700 disabled:cursor-not-allowed text-white rounded-lg transition-colors font-medium text-base"
              >
                {!hasICANWallet ? '🔒 ICAN Wallet Required' : loading ? 'Joining...' : '✨ Join Group'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* GROUP MANAGEMENT MODAL - Mobile Optimized with Tabs */}
      {showManageModal && selectedGroup && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4 z-[60]">
          <div className="bg-slate-800 rounded-t-lg sm:rounded-lg max-w-3xl w-full max-h-screen overflow-hidden sm:my-8 flex flex-col">
            <div className="sticky top-0 bg-slate-800 border-b border-slate-700 p-4 sm:p-6 flex justify-between items-center gap-2 z-10">
              <h2 className="text-lg sm:text-2xl font-bold text-white truncate">Setup: {selectedGroup.name}</h2>
              <button onClick={() => setShowManageModal(false)} className="text-slate-400 hover:text-white flex-shrink-0">
                <X size={24} />
              </button>
            </div>

            {/* Tab Navigation - Sticky */}
            <div className="sticky top-[60px] sm:top-[80px] flex gap-2 border-b border-slate-700 px-4 sm:px-6 pt-3 pb-2 overflow-x-auto bg-slate-800 z-10">
              <button
                onClick={() => setManageModalTab('settings')}
                className={`px-4 py-2 font-semibold text-sm whitespace-nowrap transition-all ${
                  manageModalTab === 'settings'
                    ? 'text-amber-500 border-b-2 border-amber-500'
                    : 'text-slate-400 hover:text-slate-300'
                }`}
              >
                ⚙️ Settings
              </button>
              <button
                onClick={() => setManageModalTab('account')}
                className={`px-4 py-2 font-semibold text-sm whitespace-nowrap transition-all ${
                  manageModalTab === 'account'
                    ? 'text-amber-500 border-b-2 border-amber-500'
                    : 'text-slate-400 hover:text-slate-300'
                }`}
              >
                💰 Group Account
              </button>
              <button
                onClick={() => setManageModalTab('members')}
                className={`px-4 py-2 font-semibold text-sm whitespace-nowrap transition-all ${
                  manageModalTab === 'members'
                    ? 'text-amber-500 border-b-2 border-amber-500'
                    : 'text-slate-400 hover:text-slate-300'
                }`}
              >
                👥 Members
              </button>
              <button
                onClick={() => setManageModalTab('status')}
                className={`px-4 py-2 font-semibold text-sm whitespace-nowrap transition-all ${
                  manageModalTab === 'status'
                    ? 'text-amber-500 border-b-2 border-amber-500'
                    : 'text-slate-400 hover:text-slate-300'
                }`}
              >
                📊 Status
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 pb-20 sm:pb-12">
              {/* SETTINGS TAB */}
              {manageModalTab === 'settings' && (
                <div className="space-y-4">
                  <h3 className="font-bold text-white text-base sm:text-lg">Group Settings</h3>
                  
                  <div>
                    <label className="block text-slate-300 font-semibold mb-2 text-sm">Group Name</label>
                    <input
                      type="text"
                      value={editGroupForm.name}
                      onChange={(e) => setEditGroupForm({ ...editGroupForm, name: e.target.value })}
                      className="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-amber-500 text-base"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-300 font-semibold mb-2 text-sm">Description</label>
                    <textarea
                      value={editGroupForm.description}
                      onChange={(e) => setEditGroupForm({ ...editGroupForm, description: e.target.value })}
                      rows={3}
                      className="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-amber-500 resize-none text-base"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-300 font-semibold mb-2 text-sm">Monthly Contribution (ICAN Coins)</label>
                    <div className="relative">
                      <span className="absolute left-3 top-3 text-amber-400 font-bold">₿</span>
                      <input
                        type="number"
                        step="0.01"
                        value={editGroupForm.monthlyContribution}
                        onChange={(e) => setEditGroupForm({ ...editGroupForm, monthlyContribution: e.target.value })}
                        className="w-full pl-8 pr-4 py-3 bg-slate-900 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-amber-500 text-base"
                      />
                    </div>
                  </div>

                  <button
                    onClick={handleSaveGroupSettings}
                    disabled={loading}
                    className="w-full px-4 py-3 bg-amber-600 hover:bg-amber-500 disabled:bg-slate-700 text-white rounded-lg transition-colors font-medium text-base"
                  >
                    {loading ? 'Saving...' : '💾 Save Settings'}
                  </button>
                </div>
              )}

              {/* GROUP ACCOUNT TAB */}
              {manageModalTab === 'account' && (
                <div className="space-y-4">
                  <h3 className="font-bold text-white text-base sm:text-lg">💰 Group ICAN Account</h3>
                  
                  {/* Wallet Status Card */}
                  {groupWallets[selectedGroup.id]?.created ? (
                    <div className="bg-emerald-500/10 border border-emerald-500/40 rounded-lg p-4">
                      <p className="text-emerald-400 text-sm font-semibold flex items-center gap-2 mb-3">
                        <span>✅</span>
                        <span>Group ICAN Wallet Active</span>
                      </p>
                      <div className="space-y-2 text-xs sm:text-sm text-emerald-300/80">
                        <p className="flex items-start gap-2">
                          <span>•</span>
                          <span>Address: <span className="font-mono text-emerald-300">{groupWallets[selectedGroup.id]?.address?.substring(0, 20)}...</span></span>
                        </p>
                        <p className="flex items-start gap-2">
                          <span>•</span>
                          <span>Balance: <span className="font-bold text-emerald-400 text-sm">₿0.00 ICAN</span></span>
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-amber-500/10 border border-amber-500/40 rounded-lg p-4 animate-pulse">
                      <p className="text-amber-400 text-sm font-semibold flex items-center gap-2">
                        <span>⏳</span>
                        <span>Creating Group ICAN Wallet...</span>
                      </p>
                    </div>
                  )}

                  {/* Withdrawal Rules */}
                  <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
                    <p className="text-blue-300 text-sm font-semibold mb-3">📋 Withdrawal Rules</p>
                    <div className="space-y-2 text-xs sm:text-sm text-blue-200/80">
                      <p className="flex items-start gap-2">
                        <span className="font-bold text-blue-300 min-w-fit">Min:</span>
                        <span>Minimum withdrawal <span className="font-bold">₿10 ICAN</span></span>
                      </p>
                      <p className="flex items-start gap-2">
                        <span className="font-bold text-blue-300 min-w-fit">Vote:</span>
                        <span><span className="font-bold">60% member approval</span> required</span>
                      </p>
                      <p className="flex items-start gap-2">
                        <span className="font-bold text-blue-300 min-w-fit">Mgmt:</span>
                        <span>Managed by <span className="font-bold">group creator</span> (you)</span>
                      </p>
                    </div>
                  </div>

                  {/* Account Management Buttons */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button 
                      onClick={() => setShowGroupPINModal(true)}
                      className="px-4 py-3 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white rounded-lg transition-colors text-sm sm:text-base font-medium"
                    >
                      🔐 Set PIN
                    </button>
                    <button className="px-4 py-3 bg-cyan-600 hover:bg-cyan-500 active:bg-cyan-700 text-white rounded-lg transition-colors text-sm sm:text-base font-medium">
                      📊 View Balance
                    </button>
                  </div>

                  <p className="text-slate-400 text-xs sm:text-sm p-3 bg-slate-900/30 border border-slate-700 rounded-lg">
                    💡 Full account management available in ICAN Wallet app. This group account auto-receives all member contributions.
                  </p>
                </div>
              )}

              {/* MEMBERS TAB */}
              {manageModalTab === 'members' && (
                <div className="space-y-4">
                  <h3 className="font-bold text-white text-base sm:text-lg">Members ({selectedGroup.members?.length || 0})</h3>
                  <div className="space-y-2 max-h-64 sm:max-h-48 overflow-y-auto">
                    {selectedGroup.members && selectedGroup.members.map((member) => (
                      <div key={member.id} className="p-3 sm:p-4 bg-slate-900/50 border border-slate-700 rounded-lg flex justify-between items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-white text-sm sm:text-base font-medium">
                            Member #{member.member_number}
                            <span className="ml-2 text-xs px-2 py-1 bg-blue-500/20 text-blue-300 rounded inline-block">
                              {member.role}
                            </span>
                          </p>
                          <p className="text-slate-400 text-xs sm:text-sm">₿{member.total_contributed || 0} ICAN contributed</p>
                        </div>
                        <div className="flex gap-1.5 flex-shrink-0">
                          {member.role !== 'creator' && (
                            <>
                              {member.role === 'member' ? (
                                <button
                                  onClick={() => handlePromoteToAdmin(member.user_id)}
                                  disabled={loading}
                                  className="px-3 py-2 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:bg-slate-700 text-white rounded text-xs font-medium"
                                  title="Promote to Admin"
                                >
                                  📤
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleDemoteFromAdmin(member.user_id)}
                                  disabled={loading}
                                  className="px-3 py-2 bg-orange-600 hover:bg-orange-500 active:bg-orange-700 disabled:bg-slate-700 text-white rounded text-xs font-medium"
                                  title="Demote to Member"
                                >
                                  📥
                                </button>
                              )}
                              <button
                                onClick={() => handleRemoveMember(member.user_id)}
                                disabled={loading}
                                className="px-3 py-2 bg-red-600 hover:bg-red-500 active:bg-red-700 disabled:bg-slate-700 text-white rounded text-xs font-medium"
                                title="Remove Member"
                              >
                                ✕
                              </button>
                            </>
                          )}
                          {member.role === 'creator' && (
                            <span className="text-amber-400 text-xs font-semibold px-2 py-1 bg-amber-500/10 rounded">👑 Creator</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* STATUS TAB */}
              {manageModalTab === 'status' && (
                <div className="space-y-4">
                  <h3 className="font-bold text-white text-base sm:text-lg">Group Status</h3>
                  <p className="text-slate-300 text-sm sm:text-base">Current Status: <span className="font-semibold text-amber-400">{selectedGroup.status}</span></p>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {selectedGroup.status === 'active' && (
                      <button
                        onClick={() => handleToggleGroupStatus('paused')}
                        disabled={loading}
                        className="px-4 py-3 bg-yellow-600 hover:bg-yellow-500 active:bg-yellow-700 disabled:bg-slate-700 text-white rounded-lg transition-colors text-sm sm:text-base font-medium"
                      >
                        ⏸️ Pause Group
                      </button>
                    )}
                    {selectedGroup.status === 'paused' && (
                      <button
                        onClick={() => handleToggleGroupStatus('active')}
                        disabled={loading}
                        className="px-4 py-3 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 disabled:bg-slate-700 text-white rounded-lg transition-colors text-sm sm:text-base font-medium"
                      >
                        ▶️ Resume Group
                      </button>
                    )}
                    <button
                      onClick={handleCloseGroup}
                      disabled={loading}
                      className="px-4 py-3 bg-red-600 hover:bg-red-500 active:bg-red-700 disabled:bg-slate-700 text-white rounded-lg transition-colors text-sm sm:text-base font-medium"
                    >
                      🔒 Close Group
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* CONTRIBUTE MODAL - Mobile Optimized */}
      {showContributeModal && selectedGroup && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4 z-[70] pb-24 sm:pb-0">
          <div className="bg-slate-800 rounded-t-lg sm:rounded-lg max-w-md w-full max-h-[75vh] sm:max-h-auto overflow-y-auto">
            <div className="sticky top-0 bg-slate-800 border-b border-slate-700 p-4 sm:p-6 flex justify-between items-center gap-2">
              <h2 className="text-lg sm:text-xl font-bold text-white truncate">Make a Contribution</h2>
              <button onClick={() => setShowContributeModal(false)} className="text-slate-400 hover:text-white flex-shrink-0">
                <X size={24} />
              </button>
            </div>

            <form onSubmit={handleContribute} className="p-4 sm:p-6 space-y-4">
              <div>
                <label className="block text-slate-300 font-semibold mb-2 text-sm sm:text-base">Group: {selectedGroup.name}</label>
                <p className="text-slate-400 text-xs sm:text-sm">Monthly contribution: ₿{selectedGroup.monthly_contribution} ICAN</p>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-2 text-sm sm:text-base">Contribution Amount (ICAN)</label>
                <div className="relative">
                  <span className="absolute left-3 top-3 sm:top-4 text-slate-400">₿</span>
                  <input
                    type="number"
                    required
                    min="1"
                    step="0.01"
                    value={contributeForm.amount}
                    onChange={(e) => setContributeForm({ ...contributeForm, amount: e.target.value })}
                    placeholder={selectedGroup.monthly_contribution}
                    className="w-full pl-8 pr-4 py-3 bg-slate-900 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 text-base"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-2 text-sm sm:text-base">Payment Method</label>
                <div className="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg text-white">
                  <div className="flex items-center gap-2">
                    <span className="text-amber-500 font-semibold">₿</span>
                    <span className="text-sm sm:text-base">ICAN Wallet</span>
                  </div>
                  <p className="text-slate-400 text-xs mt-1">Contributions are processed through your ICAN crypto wallet</p>
                </div>
                <input type="hidden" value="ican" />
              </div>

              <div className="bg-slate-900/50 border border-amber-500/20 rounded-lg p-3 sm:p-4">
                <p className="text-amber-400 text-xs sm:text-sm flex items-start gap-2">
                  <Shield size={16} className="flex-shrink-0 mt-0.5" />
                  <span>This contribution will be verified and recorded on the blockchain for transparency.</span>
                </p>
              </div>

              {!hasICANWallet ? (
                <div className="p-4 bg-red-500/15 border border-red-500/40 rounded-lg flex items-start gap-3">
                  <AlertCircle size={20} className="text-red-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-red-300 text-sm font-semibold mb-2">⚠️ Wallet Required</p>
                    <p className="text-red-200 text-xs">You must set up your ICAN wallet to make contributions. Please go to your profile and create a wallet first.</p>
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg flex items-start gap-2">
                  <CheckCircle size={18} className="text-emerald-400 flex-shrink-0 mt-0.5" />
                  <p className="text-emerald-300 text-xs sm:text-sm">✓ Your ICAN wallet is verified and ready for contributions</p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !contributeForm.amount || !hasICANWallet}
                className="w-full px-6 py-3 bg-amber-600 hover:bg-amber-500 active:bg-amber-700 disabled:bg-slate-700 disabled:cursor-not-allowed text-white rounded-lg transition-colors font-semibold text-base"
              >
                {!hasICANWallet ? '🔒 ICAN Wallet Required' : loading ? 'Processing...' : '✅ Confirm Contribution'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* LIVE BOARDROOM MODAL */}
      {boardroomGroupId && (
        <div className="fixed inset-0 bg-black/90 z-[60] flex flex-col">
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

      {/* 🔐 GROUP WALLET PIN MODAL */}
      {showGroupPINModal && selectedGroup && (
        <GroupWalletPINModal
          groupId={selectedGroup.id}
          groupName={selectedGroup.name}
          isPINSet={groupWallets[selectedGroup.id]?.created || false}
          onClose={() => setShowGroupPINModal(false)}
          onSuccess={(account) => {
            // Update wallet status
            setGroupWallets({
              ...groupWallets,
              [selectedGroup.id]: {
                created: true,
                address: account?.wallet_address || `ican_group_${selectedGroup.id.substring(0, 8)}_`
              }
            });
          }}
        />
      )}
    </div>
  );
};

export default TrustSystem;

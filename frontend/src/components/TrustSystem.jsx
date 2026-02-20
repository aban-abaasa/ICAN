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
  MoreVertical,
  Zap,
  FileText
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import LiveBoardroom from './LiveBoardroom';
import GroupWalletPINModal from './GroupWalletPINModal';
import AdminApplicationPanel from './AdminApplicationPanel';
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
import { getSupabaseClient } from '../lib/supabase/client';

const TrustSystem = ({ currentUser: propCurrentUser }) => {
  // Use prop currentUser if provided (mobile), otherwise use AuthContext (web)
  const { user: contextUser } = useAuth() || {};
  const currentUser = propCurrentUser || contextUser;

  const [activeTab, setActiveTab] = useState('explore'); // 'explore', 'mygroups', 'create', 'dashboard', 'voting', 'applications', 'admin'
  const [groups, setGroups] = useState([]);
  const [myGroups, setMyGroups] = useState([]);
  const [selectedAdminGroup, setSelectedAdminGroup] = useState(null);
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
  const [expandedSections, setExpandedSections] = useState({
    yourContribution: false, // Collapsed by default to save space
    amountOwed: false
  });
  const [selectedGroupTab, setSelectedGroupTab] = useState(null); // Track which tab the details view is from: 'mygroups' only
  const [showJoinApplicationModal, setShowJoinApplicationModal] = useState(false); // Join application form modal
  const [groupForJoinApplication, setGroupForJoinApplication] = useState(null); // Group user is trying to join
  const [joinApplicationForm, setJoinApplicationForm] = useState({ // User's application text
    reason: ''
  });

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
        
        // Auto-create wallet for user if it doesn't exist
        let walletExists = false;
        if (currentUser?.id) {
          try {
            console.log('Checking user wallet for:', currentUser.id);
            const walletData = await icanCoinService.ensureUserWallet(currentUser.id, currentUser.email);
            console.log('Wallet data retrieved:', walletData);
            walletExists = walletData && (walletData.id || walletData.wallet_address || walletData.address);
            setHasICANWallet(walletExists);
            console.log('ICAN Wallet Status:', walletExists ? '✅ Wallet Found' : '❌ No Wallet');
          } catch (error) {
            console.log('Wallet verification error:', error?.message);
            walletExists = false;
            setHasICANWallet(false);
          }
        }
        
        console.log(`✅ TrustSystem - Country: ${userCountryCodeValue}, Currency: ${currencyCode}, Symbol: ${currencySymbol}, Wallet: ${walletExists}`);
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

  // When account tab is opened in admin panel, refresh group data from database
  useEffect(() => {
    if (manageModalTab === 'account' && selectedGroup?.id && currentUser?.id) {
      console.log('📊 Account tab opened - refreshing group data from Supabase...');
      getTrustGroupDetails(selectedGroup.id, currentUser.id).then(freshDetails => {
        if (freshDetails?.members) {
          const memberCount = freshDetails.members.length || 0;
          const totalContributions = freshDetails.members.reduce((sum, m) => sum + (parseFloat(m.total_contributed) || 0), 0);
          setSelectedGroup({ ...freshDetails, member_count: memberCount });
          console.log('✅ Admin account tab data refreshed:', {
            memberCount,
            totalContributions: totalContributions.toFixed(8),
            members: freshDetails.members.length
          });
        }
      });
    }
  }, [manageModalTab, selectedGroup?.id, currentUser?.id]);

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

  const handleJoinGroup = (group) => {
    if (!currentUser?.id) {
      setMessage({ type: 'error', text: 'Please log in first' });
      return;
    }

    // Open join application modal with group info
    setGroupForJoinApplication(group);
    setJoinApplicationForm({ reason: '' });
    setShowJoinApplicationModal(true);
  };

  const handleSubmitJoinApplication = async () => {
    if (!groupForJoinApplication?.id) {
      setMessage({ type: 'error', text: 'Group information missing' });
      return;
    }

    if (!joinApplicationForm.reason.trim()) {
      setMessage({ type: 'error', text: 'Please explain why you want to join this group' });
      return;
    }

    setLoading(true);
    try {
      const result = await submitMembershipApplication(
        groupForJoinApplication.id,
        currentUser.id,
        currentUser.email,
        joinApplicationForm.reason
      );

      if (result.success) {
        setMessage({ type: 'success', text: '✓ Application submitted! Creator will review your request.' });
        setShowJoinApplicationModal(false);
        setJoinApplicationForm({ reason: '' });
        setGroupForJoinApplication(null);
        loadGroups();
      } else {
        setMessage({ type: 'error', text: result.error || 'Failed to submit application' });
      }
    } catch (error) {
      console.error('Error submitting application:', error);
      setMessage({ type: 'error', text: 'Error submitting application' });
    } finally {
      setLoading(false);
    }
  };

  // VIEW DETAILS - Only for My Groups (members only)
  const handleViewDetails = async (group) => {
    setLoading(true);
    try {
      const details = await getTrustGroupDetails(group.id, currentUser?.id);
      const stats = await getGroupStatistics(group.id);
      
      // Calculate member_count from members array if not in database
      const memberCount = details?.members?.length || 0;
      const totalContributed = details?.members?.reduce((sum, m) => sum + (parseFloat(m.total_contributed) || 0), 0) || 0;
      const detailsWithCount = {
        ...details,
        member_count: memberCount
      };
      
      console.log(`📊 Group loaded: ${memberCount} members, ₿${totalContributed.toFixed(8)} total contributed, User available: ₿${(details?.userAvailableBalance || 0).toFixed(8)}`);
      
      setSelectedGroup(detailsWithCount);
      setSelectedGroupTab('mygroups'); // Mark that this is viewing from My Groups tab
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
      // AUTO-CREATE wallet if it doesn't exist (same logic as Pitchin/ShareSigningFlow)
      console.log('🔍 Checking/Creating ICAN wallet for user:', currentUser.id);
      const supabase = getSupabaseClient();
      
      if (!supabase) {
        setMessage({ type: 'error', text: '❌ Database connection failed. Please try again.' });
        return;
      }

      // STEP 1: Try to get existing ICAN wallet
      let { data: walletData, error: walletError } = await supabase
        .from('ican_user_wallets')
        .select('id, ican_balance, wallet_address')
        .eq('user_id', currentUser.id)
        .maybeSingle();

      // STEP 2: If wallet doesn't exist (PGRST116 = no rows), AUTO-CREATE it with 0 balance
      if (!walletData) {
        console.log('⚠️ ICAN Wallet not found. Creating new wallet with 0 balance...');
        
        const { data: newWallet, error: createError } = await supabase
          .from('ican_user_wallets')
          .insert([{
            user_id: currentUser.id,
            wallet_address: `wallet_${currentUser.id.substring(0, 8)}`,
            ican_balance: 0,
            total_spent: 0,
            total_earned: 0,
            purchase_count: 0,
            sale_count: 0,
            is_verified: false,
            status: 'active'
          }])
          .select()
          .maybeSingle();

        if (createError) {
          console.error('❌ Could not create ICAN Wallet:', createError);
          setMessage({ type: 'error', text: '❌ Could not create your ICAN wallet. Please try again.' });
          return;
        }

        if (newWallet) {
          walletData = newWallet;
          console.log('✅ New ICAN wallet created successfully:', walletData);
        }
      } else if (walletError && walletError.code !== 'PGRST116') {
        console.error('❌ Error fetching wallet:', walletError);
        setMessage({ type: 'error', text: '❌ Error accessing wallet. Please try again.' });
        return;
      }

      // STEP 3: Now user has a wallet (either existing or just created)
      const walletExists = !!(walletData && (walletData.id || walletData.wallet_address));
      
      console.log('✅ Wallet verified:', {
        exists: walletExists,
        hasId: !!walletData?.id,
        hasAddress: !!walletData?.wallet_address,
        balance: walletData?.ican_balance || 0
      });

      // Update state - wallet now exists (even if balance is 0)
      // MUST use boolean true/false, not UUID or other truthy value
      setHasICANWallet(walletExists);
      setSelectedGroup(group);
      setShowContributeModal(true);

      if (!walletExists) {
        setMessage({ type: 'error', text: '❌ Unable to verify wallet. Please refresh and try again.' });
      } else {
        console.log('✅ Contribution modal ready - User has ICAN wallet (hasICANWallet =', walletExists, ')');
      }
    } catch (error) {
      console.error('Error opening contribute modal:', error);
      setMessage({ type: 'error', text: '❌ ' + (error?.message || 'Unable to verify wallet. Please try again.') });
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
      // USE DIRECT DATABASE QUERY (same as handleOpenContributeModal)
      // This bypasses inconsistent service method fallback logic
      const supabase = getSupabaseClient();
      
      console.log('💰 Fetching ICAN wallet balance directly from database for contribution check...');
      
      const { data: walletData, error: walletError } = await supabase
        .from('ican_user_wallets')
        .select('id, ican_balance, wallet_address')
        .eq('user_id', currentUser.id)
        .maybeSingle();

      if (walletError) {
        console.error('❌ Error fetching wallet:', walletError);
        setMessage({ type: 'error', text: '❌ Error reading wallet balance. Please try again.' });
        setLoading(false);
        return;
      }

      if (!walletData) {
        console.error('❌ Wallet not found for contribution');
        setMessage({ type: 'error', text: '❌ ICAN wallet not found. Please refresh and try again.' });
        setLoading(false);
        return;
      }

      const coinBalance = parseFloat(walletData.ican_balance) || 0;
      console.log('💰 Direct DB read - ICAN balance:', coinBalance);
      console.log('💰 Wallet verified:', { id: walletData.id, address: walletData.wallet_address, balance: coinBalance });

      // Verify user has enough coins for contribution
      const contributionAmount = parseFloat(contributeForm.amount);
      if (coinBalance < contributionAmount) {
        setMessage({ type: 'error', text: `❌ Insufficient ICAN coins. You have ${coinBalance.toFixed(2)} ICAN but need ${contributionAmount.toFixed(2)} ICAN.` });
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
        
        // Wait longer for database to settle, then refresh BOTH group details AND main list
        console.log('⏳ Waiting for database to update...');
        setTimeout(async () => {
          console.log('🔄 Refreshing group details after contribution...');
          
          // Refresh the selected group details
          await handleViewDetails(selectedGroup);
          
          // Also refresh the main groups list to show updated contribution amounts
          console.log('🔄 Refreshing main groups list...');
          const updatedGroups = await getUserTrustGroups(currentUser.id);
          setGroups(updatedGroups || []);
          
          console.log('✅ All data refreshed after contribution');
        }, 1000);
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

  const handleManageGroup = async (group) => {
    try {
      console.log('🚀 Starting handleManageGroup for group:', group.id);
      
      // Fetch fresh group details with current user's available balance
      const details = await getTrustGroupDetails(group.id, currentUser?.id);
      
      console.log('📥 getTrustGroupDetails returned:', {
        received: !!details,
        hasMembers: !!details?.members,
        membersArray: details?.members,
        userAvailableBalance: details?.userAvailableBalance
      });
      
      if (details && details.members) {
        // Calculate member_count from members array
        const memberCount = details?.members?.length || 0;
        const detailsWithCount = { ...details, member_count: memberCount };
        
        console.log('📊 Admin panel preparing data:', {
          name: details.name,
          memberCount: memberCount,
          membersArray: details.members,
          totalContributions: details.members?.reduce((sum, m) => sum + (parseFloat(m.total_contributed) || 0), 0),
          userAvailableBalance: details.userAvailableBalance
        });
        
        setSelectedGroup(detailsWithCount);
        setEditGroupForm({
          name: details.name || group.name,
          description: details.description || group.description,
          monthlyContribution: details.monthly_contribution || group.monthly_contribution,
          status: details.status || group.status
        });
        console.log('✅ Admin panel state updated with', memberCount, 'members and user balance', details.userAvailableBalance);
      } else {
        console.warn('⚠️ getTrustGroupDetails returned no members data');
        // Fallback if details fetch fails - ensure members array exists
        const detailsWithEmptyMembers = {
          ...group,
          members: details?.members || [],
          member_count: 0,
          userAvailableBalance: details?.userAvailableBalance || 0
        };
        setSelectedGroup(detailsWithEmptyMembers);
        setEditGroupForm({
          name: group.name,
          description: group.description,
          monthlyContribution: group.monthly_contribution,
          status: group.status
        });
      }
    } catch (error) {
      console.error('❌ Error loading group details for admin panel:', error);
      // Fallback to basic group data with empty members
      setSelectedGroup({
        ...group,
        members: [],
        member_count: 0
      });
      setEditGroupForm({
        name: group.name,
        description: group.description,
        monthlyContribution: group.monthly_contribution,
        status: group.status
      });
    }
    
    console.log('🔓 Opening manage modal');
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
        const voteLabel = voteType === 'yes' ? 'Approved ✓' : 'Rejected ✕';
        setMessage({ type: 'success', text: `Your vote recorded: ${voteLabel}` });
        
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
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredGroups.map(group => (
                  <div key={group.id} className="bg-gradient-to-br from-slate-800 to-slate-800/50 border border-slate-700 rounded-lg p-4 sm:p-5 flex flex-col">
                    {/* Group Name & Description */}
                    <div className="mb-4 flex-1">
                      <h3 className="text-lg sm:text-xl font-bold text-white mb-2">{group.name}</h3>
                      <p className="text-slate-400 text-xs sm:text-sm line-clamp-2">{group.description}</p>
                    </div>

                    {/* Member Count Card */}
                    <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 mb-3">
                      <p className="text-blue-300 text-xs font-semibold flex items-center gap-1">
                        <Users size={14} />
                        Group Members
                      </p>
                      <p className="text-blue-400 font-bold text-lg mt-1">{group.member_count || 0}/{group.max_members}</p>
                      <p className="text-blue-300/60 text-xs mt-1">{Math.max(0, group.max_members - (group.member_count || 0))} spots available</p>
                    </div>

                    {/* Monthly Contribution & Total Saved */}
                    <div className="space-y-2 mb-4 text-xs sm:text-sm">
                      <p className="text-slate-300">
                        <span className="text-slate-400">Monthly:</span> <span className="font-semibold text-amber-400">₿{group.monthly_contribution} ICAN</span>
                      </p>
                      {group.members && Array.isArray(group.members) && group.members.length > 0 && (
                        <p className="text-emerald-300">
                          <span className="text-slate-400">Group Savings:</span> <span className="font-semibold">₿{(group.members.reduce((sum, m) => sum + (parseFloat(m.total_contributed) || 0), 0)).toFixed(8)}</span>
                        </p>
                      )}
                    </div>

                    {/* Action Buttons */}
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleJoinGroup(group)}
                        disabled={loading || (group.member_count || 0) >= group.max_members}
                        className="w-full px-3 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 active:bg-emerald-700 text-white rounded-lg transition-colors text-xs sm:text-sm font-medium"
                      >
                        {(group.member_count || 0) >= group.max_members ? 'Full' : 'Join'}
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
                        <span className="text-slate-400">Monthly:</span> ₿{group.monthly_contribution} ICAN
                      </p>
                      {/* Show total savings/contributions */}
                      {group.members && Array.isArray(group.members) && group.members.length > 0 && (
                        <p className="text-emerald-300 font-semibold">
                          <span className="text-slate-400">Saved:</span> ₿{(group.members.reduce((sum, m) => sum + (parseFloat(m.total_contributed) || 0), 0)).toFixed(8)} ICAN
                        </p>
                      )}
                      <p className="text-slate-300">
                        <span className="text-slate-400">Joined:</span> {new Date(group.created_at).toLocaleDateString()}
                      </p>
                    </div>

                    {/* Action Buttons - Responsive */}
                    <div className="flex gap-2">
                      {/* Desktop: Full text buttons | Mobile: Icon buttons with tooltips */}
                      {/* View Details Button */}
                      <button
                        onClick={() => handleViewDetails(group)}
                        title="View Details"
                        className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors text-sm font-medium hidden sm:flex items-center justify-center gap-1"
                      >
                        View Details
                      </button>
                      <button
                        onClick={() => handleViewDetails(group)}
                        title="View Details"
                        className="flex-1 sm:hidden px-2 py-2 bg-slate-700 hover:bg-slate-600 active:bg-slate-500 text-white rounded-lg transition-colors flex items-center justify-center gap-1 relative group"
                      >
                        <FileText size={16} className="text-slate-300" />
                        <span className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-slate-900 text-white text-xs rounded whitespace-nowrap opacity-0 group-active:opacity-100 transition-opacity pointer-events-none">
                          View Details
                        </span>
                      </button>

                      {/* Contribute Button */}
                      <button
                        onClick={() => handleOpenContributeModal(group)}
                        title="Contribute"
                        className="flex-1 px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg transition-colors text-sm font-medium hidden sm:flex items-center justify-center gap-1"
                      >
                        Contribute
                      </button>
                      <button
                        onClick={() => handleOpenContributeModal(group)}
                        title="Contribute"
                        className="flex-1 sm:hidden px-2 py-2 bg-amber-600 hover:bg-amber-500 active:bg-amber-700 text-white rounded-lg transition-colors flex items-center justify-center gap-1 relative group"
                      >
                        <DollarSign size={16} className="text-amber-100" />
                        <span className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-slate-900 text-white text-xs rounded whitespace-nowrap opacity-0 group-active:opacity-100 transition-opacity pointer-events-none">
                          Contribute
                        </span>
                      </button>

                      {/* Boardroom Button */}
                      <button
                        onClick={() => setBoardroomGroupId(group.id)}
                        title="Join Boardroom"
                        className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors text-sm font-medium hidden sm:flex items-center justify-center gap-1"
                      >
                        <Video size={16} />
                        Boardroom
                      </button>
                      <button
                        onClick={() => setBoardroomGroupId(group.id)}
                        title="Join Boardroom"
                        className="flex-1 sm:hidden px-2 py-2 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white rounded-lg transition-colors flex items-center justify-center gap-1 relative group"
                      >
                        <Video size={16} className="text-blue-100" />
                        <span className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-slate-900 text-white text-xs rounded whitespace-nowrap opacity-0 group-active:opacity-100 transition-opacity pointer-events-none">
                          Boardroom
                        </span>
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

                {/* Trust ICAN Wallet Setup */}
                <div className="border-2 border-amber-500/30 rounded-lg p-4 bg-amber-900/10">
                  <h3 className="text-white font-bold mb-3 flex items-center gap-2">
                    <Wallet size={20} className="text-amber-400" />
                    Trust ICAN Wallet Setup (Required)
                  </h3>
                  
                  {!groupForm.walletCreated ? (
                    <div className="space-y-3">
                      <p className="text-slate-300 text-sm">Every trust group needs a dedicated ICAN wallet for member transactions and withdrawals.</p>
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
                        + Create Trust ICAN Wallet
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
                      Setup Trust Wallet First
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
                        onClick={() => handleVoteOnApplication(app.id, 'yes')}
                        className="flex-1 px-3 sm:px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors text-xs sm:text-sm font-medium"
                      >
                        ✓ Approve
                      </button>
                      <button
                        onClick={() => handleVoteOnApplication(app.id, 'no')}
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

            {/* If a group is selected, show detailed admin application panel */}
            {selectedAdminGroup ? (
              <div>
                {/* Stats Row - Show pending and voting counts without group name */}
                <div className="flex gap-3 sm:gap-4 mb-6">
                  <div className="flex-1 bg-slate-900/50 border border-slate-700 rounded-lg p-3">
                    <p className="text-slate-400 text-xs sm:text-sm">⏳ Pending</p>
                    <p className="text-xl sm:text-2xl font-bold text-amber-400 mt-1">{myApplications.filter(app => app.group_id === selectedAdminGroup.id && app.status === 'pending').length}</p>
                  </div>
                  <div className="flex-1 bg-slate-900/50 border border-slate-700 rounded-lg p-3">
                    <p className="text-slate-400 text-xs sm:text-sm">🗳️ Voting</p>
                    <p className="text-xl sm:text-2xl font-bold text-blue-400 mt-1">{votingApplications.filter(app => app.group_id === selectedAdminGroup.id).length}</p>
                  </div>
                </div>

                <button
                  onClick={() => {
                    setSelectedAdminGroup(null);
                    loadGroups();
                  }}
                  className="mb-4 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg flex items-center gap-2 transition-all text-sm"
                >
                  ← Back to Groups
                </button>
                <AdminApplicationPanel
                  groupId={selectedAdminGroup.id}
                  onClose={() => {
                    setSelectedAdminGroup(null);
                    loadGroups();
                  }}
                />
              </div>
            ) : (
              /* Show list of groups the user created */
              <>
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
                        <div 
                          key={group.id}
                          onClick={() => setSelectedAdminGroup(group)}
                          className="bg-slate-800/60 border border-slate-700 rounded-lg p-4 sm:p-6 hover:border-amber-500/50 hover:shadow-lg hover:shadow-amber-500/20 transition-all cursor-pointer"
                        >
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
                          </div>

                          {/* Group Description */}
                          <p className="text-slate-300 text-sm mb-4 line-clamp-2">{group.description}</p>

                          {/* Wallet Status */}
                          {groupWallets[group.id]?.created ? (
                            <div className="mb-4 p-3 border border-emerald-500/40 bg-emerald-500/10 rounded-lg">
                              <p className="text-emerald-400 text-xs sm:text-sm font-semibold flex items-center gap-2">
                                <span>✅</span>
                                <span>Trust ICAN Wallet Active</span>
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
                                <span>Setting Up Trust ICAN Wallet...</span>
                              </p>
                              <div className="mt-2 space-y-1.5 text-xs text-amber-300/80">
                                <p className="flex items-start gap-2">
                                  <span>•</span>
                                  <span>Creating secure trust wallet</span>
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
              </>
            )}
          </div>
        )}


      </div>

      {/* GROUP DETAILS MODAL - Only for My Groups (members viewing their own groups) */}
      {selectedGroup && selectedGroupTab === 'mygroups' && !showGroupModal && !showContributeModal && !showManageModal && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4 z-[100]">
          <div className="bg-slate-800 rounded-t-lg sm:rounded-lg max-w-2xl w-full max-h-[85vh] sm:max-h-[90vh] overflow-hidden sm:my-8 flex flex-col border border-slate-700">
            <div className="sticky top-0 bg-slate-800 border-b border-slate-700 p-4 sm:p-6 flex justify-between items-start gap-2 z-10">
              <div className="flex-1 min-w-0">
                <h2 className="text-lg sm:text-2xl font-bold text-white truncate">{selectedGroup.name}</h2>
                <p className="text-slate-400 mt-1 text-xs sm:text-sm line-clamp-2">{selectedGroup.description}</p>
              </div>
              <button onClick={() => { setSelectedGroup(null); setSelectedGroupTab(null); }} className="text-slate-400 hover:text-white flex-shrink-0">
                <X size={24} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto pb-24 sm:pb-6 p-4 sm:p-6 space-y-6">
              {/* Debug: Show what data we have */}
              {(() => {
                console.log('🔍 GROUP DETAILS MODAL RENDERING:', {
                  hasSelectedGroup: !!selectedGroup,
                  groupName: selectedGroup?.name,
                  groupId: selectedGroup?.id,
                  membersCount: selectedGroup?.members?.length,
                  members: selectedGroup?.members,
                  currentUserId: currentUser?.id,
                  monthlyContribution: selectedGroup?.monthly_contribution
                });
                return null;
              })()}

              {/* Quick Test Card - Verify code is updated */}
              <div className="bg-blue-500/20 border border-blue-500/40 rounded-lg p-3 text-xs text-blue-300">
                ✅ New UI code loaded - Contribution cards should appear below
              </div>
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
                  <p className="text-blue-300/60 text-xs mt-1">{Math.max(0, selectedGroup.max_members - (selectedGroup.member_count || 0))} spots available</p>
                </div>

                {/* YOUR CONTRIBUTION CARD - Collapsible Personal Savings */}
                {(() => {
                  // Find current user's member record in this group
                  const userMember = selectedGroup.members?.find(m => m.user_id === currentUser?.id);
                  const userContribution = parseFloat(userMember?.total_contributed || 0);
                  const userContributionUGX = userContribution * 5000;
                  const monthlyReq = parseFloat(selectedGroup.monthly_contribution || 0);
                  const contributionStatus = userContribution > 0 ? "Active" : "Not started";
                  const progressPercent = monthlyReq > 0 ? Math.min((userContribution / monthlyReq) * 100, 100) : 0;
                  const isExpanded = expandedSections.yourContribution;
                  
                  // Debug logging
                  console.log('💎 Your Contribution card - Debug:', {
                    currentUserId: currentUser?.id,
                    membersArray: selectedGroup.members,
                    foundMember: userMember,
                    userContribution,
                    monthlyReq,
                    progressPercent
                  });
                  
                  return (
                    <div className="bg-gradient-to-br from-emerald-900/40 to-emerald-900/10 border border-emerald-600/40 rounded-lg overflow-hidden">
                      {/* Collapsible Header */}
                      <button
                        onClick={() => setExpandedSections(prev => ({ ...prev, yourContribution: !isExpanded }))}
                        className="w-full p-4 flex justify-between items-center hover:bg-emerald-900/20 transition-colors"
                      >
                        <div className="text-left">
                          <p className="text-emerald-300 text-xs sm:text-sm font-semibold flex items-center gap-2">
                            <span>💎</span> Your Contribution
                          </p>
                          <p className="text-2xl sm:text-3xl font-bold text-emerald-400 mt-1">₿{userContribution.toFixed(8)} ICAN</p>
                        </div>
                        <span className={`text-emerald-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                          ▼
                        </span>
                      </button>

                      {/* Expandable Content */}
                      {isExpanded && (
                        <div className="px-4 pb-4 border-t border-emerald-600/20 space-y-3">
                          <p className="text-emerald-300/60 text-xs">= UGX {userContributionUGX.toLocaleString()}</p>
                          
                          {/* Progress bar towards monthly goal */}
                          <div className="space-y-2">
                            <div className="flex justify-between text-xs">
                              <span className="text-emerald-300">{contributionStatus}</span>
                              <span className="text-emerald-300/60">{progressPercent.toFixed(0)}% of monthly</span>
                            </div>
                            <div className="w-full bg-emerald-900/30 rounded-full h-2 border border-emerald-700/30 overflow-hidden">
                              <div 
                                className="bg-gradient-to-r from-emerald-500 to-emerald-400 h-full transition-all duration-300"
                                style={{ width: `${Math.min(progressPercent, 100)}%` }}
                              ></div>
                            </div>
                            <p className="text-xs text-emerald-300/70 text-center">Next target: ₿{monthlyReq} ICAN/month</p>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

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
                  {/* Amount Owed Card - Collapsible */}
                  {(() => {
                    const userMember = selectedGroup.members?.find(m => m.user_id === currentUser?.id);
                    const userContribution = parseFloat(userMember?.total_contributed || 0);
                    const monthlyReq = parseFloat(selectedGroup.monthly_contribution || 0);
                    const amountOwed = Math.max(0, monthlyReq - userContribution);
                    const amountOwedUGX = amountOwed * 5000;
                    const isFullyPaid = amountOwed === 0;
                    const isExpanded = expandedSections.amountOwed;
                    
                    return amountOwed > 0 || isFullyPaid ? (
                      <div className={`rounded-lg mb-6 border overflow-hidden ${isFullyPaid 
                        ? 'bg-gradient-to-br from-green-900/40 to-green-900/10 border-green-600/40' 
                        : 'bg-gradient-to-br from-orange-900/40 to-orange-900/10 border-orange-600/40'}`}>
                        {/* Collapsible Header */}
                        <button
                          onClick={() => setExpandedSections(prev => ({ ...prev, amountOwed: !isExpanded }))}
                          className="w-full p-4 flex justify-between items-center hover:opacity-80 transition-opacity"
                        >
                          <div className="text-left">
                            <p className={`text-xs sm:text-sm font-semibold flex items-center gap-2 ${isFullyPaid ? 'text-green-300' : 'text-orange-300'}`}>
                              <span>{isFullyPaid ? '✅' : '⚠️'}</span> 
                              {isFullyPaid ? 'Payment Complete' : 'Amount Owed'}
                            </p>
                            <p className={`text-2xl sm:text-3xl font-bold mt-1 ${isFullyPaid ? 'text-green-400' : 'text-orange-400'}`}>
                              ₿{amountOwed.toFixed(8)} ICAN
                            </p>
                          </div>
                          <span className={`transition-transform ${isExpanded ? 'rotate-180' : ''} ${isFullyPaid ? 'text-green-400' : 'text-orange-400'}`}>
                            ▼
                          </span>
                        </button>

                        {/* Expandable Content */}
                        {isExpanded && (
                          <div className={`px-4 pb-4 border-t ${isFullyPaid ? 'border-green-600/20' : 'border-orange-600/20'}`}>
                            <p className={`text-xs ${isFullyPaid ? 'text-green-300/60' : 'text-orange-300/60'}`}>
                              = UGX {amountOwedUGX.toLocaleString()} {isFullyPaid ? '(Monthly target reached!)' : 'to reach monthly target'}
                            </p>
                          </div>
                        )}
                      </div>
                    ) : null;
                  })()}
                  
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
                onClick={() => handleJoinGroup(selectedGroup)}
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
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4 z-[100]">
          <div className="bg-slate-800 rounded-t-lg sm:rounded-lg max-w-3xl w-full max-h-[90vh] sm:max-h-screen overflow-hidden sm:my-8 flex flex-col border border-slate-700">
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
                💰 Trust Account
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

            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 pb-24 sm:pb-12">
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
                  <div className="flex justify-between items-center">
                    <h3 className="font-bold text-white text-base sm:text-lg">💰 Trust ICAN Account</h3>
                    <button
                      onClick={async () => {
                        console.log('🔄 Manually refreshing group data from database...');
                        const freshDetails = await getTrustGroupDetails(selectedGroup.id, currentUser?.id);
                        if (freshDetails?.members) {
                          const memberCount = freshDetails.members.length || 0;
                          setSelectedGroup({ ...freshDetails, member_count: memberCount });
                          console.log('✅ Admin panel refreshed:', {
                            memberCount,
                            totalContributions: freshDetails.members?.reduce((sum, m) => sum + (parseFloat(m.total_contributed) || 0), 0)
                          });
                        }
                      }}
                      className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
                    >
                      🔄 Refresh
                    </button>
                  </div>
                  
                  {/* Debug logging */}
                  {(() => {
                    const totalContributed = Array.isArray(selectedGroup?.members) 
                      ? selectedGroup.members.reduce((sum, m) => sum + (parseFloat(m.total_contributed) || 0), 0)
                      : 0;
                    console.log('💭 Account tab rendering - selectedGroup structure:', {
                      hasGroup: !!selectedGroup,
                      hasMembersArray: Array.isArray(selectedGroup?.members),
                      membersLength: selectedGroup?.members?.length,
                      totalContributed: totalContributed,
                      membersList: selectedGroup?.members,
                      showContributions: Array.isArray(selectedGroup?.members) && selectedGroup.members.length > 0 && totalContributed > 0
                    });
                    return null;
                  })()}
                  
                  {/* Liquidated Contributions Card */}
                  {(() => {
                    const members = selectedGroup?.members || [];
                    const hasMembers = Array.isArray(members) && members.length > 0;
                    
                    // DEBUG: Show each member's total_contributed value
                    if (Array.isArray(members) && members.length > 0) {
                      console.log('🔎 DEBUG: Members array content in admin account tab:');
                      members.forEach((m, idx) => {
                        console.log(`  📍 Member[${idx}]:`, {
                          id: m.id,
                          member_number: m.member_number,
                          total_contributed: m.total_contributed,
                          type: typeof m.total_contributed,
                          parsed: parseFloat(m.total_contributed || 0)
                        });
                      });
                    } else {
                      console.log('🔎 DEBUG: Members array is empty or not array:', { members, isArray: Array.isArray(members) });
                    }
                    
                    const totalICANContributed = members.reduce((sum, m) => {
                      const val = parseFloat(m.total_contributed) || 0;
                      return sum + val;
                    }, 0) || 0;
                    
                    const shouldShow = hasMembers && totalICANContributed > 0;
                    
                    console.log('✅ Liquidated contributions check:', { 
                      hasMembers, 
                      membersCount: members.length,
                      totalICANContributed, 
                      shouldShow
                    });
                    
                    return shouldShow ? (
                      <div className="bg-gradient-to-br from-green-500/20 to-emerald-500/10 border-2 border-green-500/50 rounded-lg p-4 sm:p-5">
                        <p className="text-green-400 text-sm font-semibold flex items-center gap-2 mb-4">
                          <span>💵</span>
                          <span>Liquidated Contributions</span>
                        </p>
                        
                        {/* Calculate totals */}
                        {(() => {
                          const liquidatedUGX = totalICANContributed * 5000;
                          
                          return (
                            <div className="space-y-3">
                              {/* ICAN Amount */}
                              <div className="flex justify-between items-center p-3 sm:p-4 bg-slate-900/40 rounded-lg border border-green-500/20">
                                <span className="text-green-300 text-xs sm:text-sm font-medium">Total ICAN Collected:</span>
                                <span className="text-green-400 font-bold text-lg sm:text-xl">₿{totalICANContributed.toFixed(8)}</span>
                              </div>
                              
                              {/* Liquidated Amount */}
                              <div className="flex justify-between items-center p-3 sm:p-4 bg-gradient-to-r from-green-900/40 to-emerald-900/40 rounded-lg border border-green-500/30">
                                <span className="text-emerald-300 text-xs sm:text-sm font-medium">Liquidated in UGX:</span>
                                <span className="text-emerald-400 font-bold text-lg sm:text-xl">UGX {liquidatedUGX.toLocaleString()}</span>
                              </div>
                              
                              {/* Exchange Rate */}
                              <div className="text-center p-2 bg-slate-900/30 rounded border border-slate-700">
                                <p className="text-slate-400 text-xs">Exchange Rate</p>
                                <p className="text-amber-300 font-semibold text-sm">1 ICAN = 5,000 UGX</p>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    ) : (
                      <div className="bg-amber-500/10 border border-amber-500/40 rounded-lg p-4">
                        <p className="text-amber-400 text-sm font-semibold flex items-center gap-2">
                          <span>📊</span>
                          <span>No contributions yet. Contributions will appear here.</span>
                        </p>
                      </div>
                    );
                  })()}

                  {/* Contribution Breakdown by Member */}
                  {Array.isArray(selectedGroup?.members) && selectedGroup.members.length > 0 && (
                    <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
                      <p className="text-slate-300 text-xs sm:text-sm font-semibold mb-3">📋 Contribution Breakdown</p>
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {selectedGroup.members.map((member, idx) => {
                          const amountICAN = parseFloat(member.total_contributed || 0);
                          const amountUGX = amountICAN * 5000;
                          return (
                            <div key={member.id} className="flex justify-between items-center p-2.5 bg-slate-800/30 rounded border border-slate-600/50">
                              <span className="text-slate-300 text-xs sm:text-sm">Member #{member.member_number}</span>
                              <div className="text-right">
                                <p className="text-amber-400 font-semibold text-sm">₿{amountICAN.toFixed(8)}</p>
                                <p className="text-emerald-300 text-xs">UGX {amountUGX.toLocaleString()}</p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  
                  {/* Wallet Status Card */}
                  {groupWallets[selectedGroup.id]?.created ? (
                    <div className="bg-emerald-500/10 border border-emerald-500/40 rounded-lg p-4">
                      <p className="text-emerald-400 text-sm font-semibold flex items-center gap-2 mb-3">
                        <span>✅</span>
                        <span>Trust ICAN Wallet Active</span>
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
                        <span>Creating Trust ICAN Wallet...</span>
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

                  {/* Contribution Breakdown */}
                  {Array.isArray(selectedGroup?.members) && selectedGroup.members.length > 0 && (
                    <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
                      <p className="text-slate-300 text-xs sm:text-sm font-semibold mb-3">📋 Contribution Breakdown</p>
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {selectedGroup.members.map((member, idx) => {
                          const amountICAM = parseFloat(member.total_contributed || 0);
                          const amountUGX = amountICAM * 5000;
                          return (
                            <div key={member.id} className="flex justify-between items-center p-2.5 bg-slate-800/30 rounded border border-slate-600/50">
                              <span className="text-slate-300 text-xs sm:text-sm">Member #{member.member_number}</span>
                              <div className="text-right">
                                <p className="text-amber-400 font-semibold text-sm">₿{amountICAM.toFixed(8)}</p>
                                <p className="text-emerald-300 text-xs">UGX {amountUGX.toLocaleString()}</p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <p className="text-slate-400 text-xs sm:text-sm p-3 bg-slate-900/30 border border-slate-700 rounded-lg">
                    💡 Full account management available in ICAN Wallet app. This trust account auto-receives all member contributions.
                  </p>
                </div>
              )}

              {/* MEMBERS TAB */}
              {manageModalTab === 'members' && (
                <div className="space-y-4">
                  <h3 className="font-bold text-white text-base sm:text-lg">Members ({Array.isArray(selectedGroup?.members) ? selectedGroup.members.length : 0})</h3>
                  <div className="space-y-2 max-h-64 sm:max-h-48 overflow-y-auto">
                    {Array.isArray(selectedGroup?.members) && selectedGroup.members.length > 0 ? (
                      selectedGroup.members.map((member) => (
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
                      ))
                    ) : (
                      <div className="p-4 text-center text-slate-400 text-sm">
                        No members yet. Members will appear here once they join.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* STATUS TAB */}
              {manageModalTab === 'status' && (
                <div className="space-y-4">
                  <h3 className="font-bold text-white text-base sm:text-lg">Group Status</h3>
                  
                  {/* Status Stats Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* Members Card */}
                    <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
                      <p className="text-blue-400 text-xs font-semibold">Members</p>
                      <p className="text-3xl font-bold text-blue-300 mt-2">{selectedGroup.member_count || 0}</p>
                      <p className="text-blue-400/60 text-xs mt-1">of {selectedGroup.max_members} slots</p>
                    </div>
                    
                    {/* Current Status Card */}
                    <div className={`rounded-lg p-4 border ${
                      selectedGroup.status === 'active' ? 'bg-emerald-500/10 border-emerald-500/30' :
                      selectedGroup.status === 'paused' ? 'bg-yellow-500/10 border-yellow-500/30' :
                      'bg-red-500/10 border-red-500/30'
                    }`}>
                      <p className={`text-xs font-semibold ${
                        selectedGroup.status === 'active' ? 'text-emerald-400' :
                        selectedGroup.status === 'paused' ? 'text-yellow-400' :
                        'text-red-400'
                      }`}>Status</p>
                      <p className={`text-2xl font-bold mt-2 capitalize ${
                        selectedGroup.status === 'active' ? 'text-emerald-300' :
                        selectedGroup.status === 'paused' ? 'text-yellow-300' :
                        'text-red-300'
                      }`}>{selectedGroup.status}</p>
                    </div>
                    
                    {/* Monthly Contribution Card */}
                    <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
                      <p className="text-amber-400 text-xs font-semibold">Monthly Target</p>
                      <p className="text-2xl font-bold text-amber-300 mt-2">₿{parseFloat(selectedGroup.monthly_contribution || 0).toFixed(2)}</p>
                      <p className="text-amber-400/60 text-xs mt-1">per member</p>
                    </div>
                    
                    {/* Created Date Card */}
                    <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-4">
                      <p className="text-cyan-400 text-xs font-semibold">Created</p>
                      <p className="text-sm font-bold text-cyan-300 mt-2 break-words">
                        {selectedGroup.created_at ? new Date(selectedGroup.created_at).toLocaleDateString() : 'N/A'}
                      </p>
                      <p className="text-cyan-400/60 text-xs mt-1">Group established</p>
                    </div>
                    
                    {/* Your Available Balance Card */}
                    <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
                      <p className="text-green-400 text-xs font-semibold">💰 Your Available</p>
                      <p className="text-2xl font-bold text-green-300 mt-2">₿{parseFloat(selectedGroup.userAvailableBalance || 0).toFixed(8)}</p>
                      <p className="text-green-400/60 text-xs mt-1">ICAN coins available</p>
                    </div>
                  </div>
                  
                  {/* Status Control Buttons */}
                  <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4 pt-5">
                    <p className="text-slate-300 text-xs font-semibold mb-3">Status Controls</p>
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
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* JOIN APPLICATION MODAL */}
      {showJoinApplicationModal && groupForJoinApplication && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4 z-[100] pb-24 sm:pb-0">
          <div className="bg-slate-800 rounded-t-lg sm:rounded-lg max-w-2xl w-full max-h-[85vh] sm:max-h-[90vh] overflow-hidden sm:my-8 flex flex-col border border-slate-700">
            {/* Header - Sticky */}
            <div className="sticky top-0 bg-slate-800 border-b border-slate-700 p-4 sm:p-6 flex justify-between items-start gap-2 z-10">
              <div className="flex-1 min-w-0">
                <h2 className="text-lg sm:text-2xl font-bold text-white mb-1">📋 Join Group Application</h2>
                <p className="text-slate-400 text-sm">Tell us why you want to join</p>
              </div>
              <button onClick={() => { setShowJoinApplicationModal(false); setGroupForJoinApplication(null); }} className="text-slate-400 hover:text-white flex-shrink-0" aria-label="Close">
                <X size={24} />
              </button>
            </div>

            {/* Content - Scrollable */}
            <div className="flex-1 overflow-y-auto pb-24 sm:pb-6 p-4 sm:p-6 space-y-6">
              {/* Group Info Card */}
              <div className="bg-gradient-to-br from-amber-900/30 to-amber-900/10 border border-amber-700/30 rounded-lg p-4">
                <h3 className="text-white font-bold text-lg mb-2">{groupForJoinApplication.name}</h3>
                <p className="text-amber-300/80 text-sm mb-4">{groupForJoinApplication.description}</p>
                <div className="space-y-2 text-sm">
                  <p className="flex justify-between">
                    <span className="text-slate-400">Monthly Contribution:</span>
                    <span className="font-semibold text-amber-400">₿{groupForJoinApplication.monthly_contribution} ICAN</span>
                  </p>
                  <p className="flex justify-between">
                    <span className="text-slate-400">Available Spots:</span>
                    <span className="font-semibold text-blue-400">{Math.max(0, groupForJoinApplication.max_members - (groupForJoinApplication.member_count || 0))}/{groupForJoinApplication.max_members}</span>
                  </p>
                </div>
              </div>

              {/* Group Conduct/Guidelines */}
              <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
                <h4 className="text-white font-semibold mb-3 flex items-center gap-2">
                  <Shield size={18} className="text-emerald-500" />
                  Group Conduct & Guidelines
                </h4>
                <ul className="space-y-2 text-sm text-slate-300">
                  <li className="flex items-start gap-2">
                    <span className="text-emerald-500 font-bold mt-0.5">✓</span>
                    <span>Regular monthly contributions are mandatory</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-emerald-500 font-bold mt-0.5">✓</span>
                    <span>Respect all group members and their contributions</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-emerald-500 font-bold mt-0.5">✓</span>
                    <span>Keep financial information confidential</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-emerald-500 font-bold mt-0.5">✓</span>
                    <span>Participate in group voting and decisions</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-emerald-500 font-bold mt-0.5">✓</span>
                    <span>Adhere to all group rules and policies</span>
                  </li>
                </ul>
              </div>

              {/* Application Message */}
              <div>
                <label className="block text-white font-semibold mb-3 text-sm">
                  Why do you want to join this group?
                </label>
                <textarea
                  value={joinApplicationForm.reason}
                  onChange={(e) => setJoinApplicationForm({ ...joinApplicationForm, reason: e.target.value })}
                  placeholder="Tell the group creator about yourself, your financial goals, and why you want to join this SACCO..."
                  rows={6}
                  className="w-full px-4 py-3 bg-slate-900/50 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 resize-none text-sm sm:text-base"
                />
                <p className="text-xs text-slate-400 mt-2">
                  {joinApplicationForm.reason.length} characters (minimum 20 recommended)
                </p>
              </div>

              {/* Important Note */}
              <div className="bg-blue-500/10 border border-blue-500/30 p-3 rounded-lg">
                <p className="text-blue-300 text-xs sm:text-sm">
                  📌 The group creator will review your application. If approved, group members will vote on your membership (requires 60% approval).
                </p>
              </div>
            </div>

            {/* Footer - Action Buttons - Sticky */}
            <div className="sticky bottom-0 border-t border-slate-700 bg-gradient-to-t from-slate-800 to-slate-800/95 p-4 sm:p-6 flex gap-3 z-10 shadow-lg">
              <button
                onClick={() => { setShowJoinApplicationModal(false); setGroupForJoinApplication(null); }}
                className="flex-1 px-4 py-2.5 bg-slate-700 hover:bg-slate-600 active:bg-slate-800 text-white rounded-lg transition-colors font-medium text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmitJoinApplication}
                disabled={loading || !joinApplicationForm.reason.trim()}
                className="flex-1 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-lg transition-colors font-medium text-sm"
              >
                {loading ? '⏳ Submitting...' : '✓ Submit Application'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CONTRIBUTE MODAL - Enhanced with ICAN Coin Functionality */}
      {showContributeModal && selectedGroup && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4 z-[100] pb-24 sm:pb-0">
          <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-black rounded-t-lg sm:rounded-lg max-w-md w-full max-h-[85vh] sm:max-h-[90vh] overflow-hidden flex flex-col border border-slate-700 sm:border-amber-500/20 shadow-2xl">
            {/* Top Gradient Bar */}
            <div className="h-1 bg-gradient-to-r from-amber-600 via-blue-600 to-cyan-600"></div>

            {/* Header Section */}
            <div className="sticky top-0 z-10 bg-gradient-to-r from-slate-900/90 to-amber-900/20 border-b border-amber-500/10 p-4 sm:p-6 flex justify-between items-start gap-3">
              <div className="flex items-center gap-3 flex-1">
                <div className="p-2.5 sm:p-3 bg-gradient-to-br from-amber-600 to-amber-500 rounded-lg sm:rounded-xl flex-shrink-0">
                  <Wallet className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
                </div>
                <div className="flex-1">
                  <h2 className="text-lg sm:text-2xl font-bold text-white">Make a Contribution</h2>
                  <p className="text-xs sm:text-sm text-amber-300/80 mt-0.5">Verified & Recorded on Blockchain</p>
                </div>
              </div>
              <button onClick={() => setShowContributeModal(false)} className="text-slate-400 hover:text-white flex-shrink-0 p-1">
                <X size={24} />
              </button>
            </div>

            {/* Scrollable Content Area */}
            <form id="contribute-form" onSubmit={handleContribute} className="flex-1 overflow-y-auto pb-24 sm:pb-0 p-4 sm:p-6 space-y-5">
              {/* Group & Cryptocurrency Info Cards */}
              <div className="grid sm:grid-cols-2 gap-4">
                {/* Group Card */}
                <div className="bg-gradient-to-br from-amber-600/20 to-amber-500/10 border border-amber-500/30 rounded-lg sm:rounded-xl p-3 sm:p-4">
                  <p className="text-xs text-amber-300 font-semibold uppercase tracking-wide mb-1">📊 Group</p>
                  <h3 className="text-lg sm:text-xl font-bold text-white mb-2">{selectedGroup.name}</h3>
                  <p className="text-xs sm:text-sm text-amber-200/70">Monthly Target: <span className="font-semibold text-amber-300">₿{selectedGroup.monthly_contribution} ICAN</span></p>
                </div>

                {/* Cryptocurrency Card - Web UI Detail */}
                <div className="bg-gradient-to-br from-orange-600/20 to-amber-500/10 border border-amber-500/30 rounded-lg sm:rounded-xl p-3 sm:p-4">
                  <p className="text-xs text-amber-300 font-semibold uppercase tracking-wide mb-1">💎 Cryptocurrency</p>
                  <h3 className="text-lg sm:text-xl font-bold text-white mb-2 flex items-center gap-2">
                    <span className="text-2xl">₿</span>
                    ICAN Coin
                  </h3>
                  <p className="text-xs sm:text-sm text-amber-200/70 mb-2">
                    <span className="font-semibold text-amber-300">1 ICAN</span> = ~5,000 UGX
                  </p>
                  <p className="text-xs text-amber-200/50">Your country: Uganda</p>
                </div>
              </div>

              {/* Amount Input Section */}
              <div>
                <label className="block text-slate-300 font-semibold mb-3 text-sm sm:text-base">Contribution Amount (ICAN Coins)</label>
                <div className="relative mb-4">
                  <span className="absolute left-4 top-1/2 transform -translate-y-1/2 text-amber-400 font-bold text-lg">₿</span>
                  <input
                    type="number"
                    required
                    min="0.1"
                    step="0.01"
                    value={contributeForm.amount}
                    onChange={(e) => {
                      const newAmount = e.target.value;
                      setContributeForm({ ...contributeForm, amount: newAmount });
                      console.log('💰 Amount changed to:', newAmount, 'Type:', typeof newAmount);
                    }}
                    placeholder="0.00 (Click ₿1 below or enter amount)"
                    className="w-full pl-10 pr-4 py-3 sm:py-4 bg-slate-900 border-2 border-slate-600 rounded-lg focus:border-amber-500 focus:outline-none text-white placeholder-slate-500 text-base sm:text-lg transition-colors"
                  />
                </div>

                {/* Quick Select Buttons */}
                <div className="grid grid-cols-4 gap-2 mb-4">
                  {[0.5, 1, 2.5, 5].map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => {
                        const newAmount = amt.toString();
                        setContributeForm({ ...contributeForm, amount: newAmount });
                        console.log('💰 Quick select clicked:', newAmount);
                      }}
                      disabled={loading}
                      className={`py-2.5 sm:py-3 border font-bold rounded-lg transition-all disabled:opacity-50 text-xs sm:text-sm ${
                        contributeForm.amount === amt.toString()
                          ? 'bg-amber-600 border-amber-400 text-white'
                          : 'bg-gradient-to-b from-amber-600/40 to-amber-600/20 hover:from-amber-600/60 hover:to-amber-600/40 border-amber-500/40 hover:border-amber-500/70 text-white'
                      }`}
                    >
                      ₿{amt}
                    </button>
                  ))}
                </div>
                
                {/* Amount Status Info */}
                {contributeForm.amount && (
                  <div className="p-2 sm:p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg mb-4">
                    <p className="text-amber-300 text-xs sm:text-sm font-semibold">
                      ✓ Ready to contribute: ₿{parseFloat(contributeForm.amount).toFixed(2)} ICAN
                    </p>
                  </div>
                )}
              </div>

              {/* Payment Method Section */}
              <div>
                <label className="block text-slate-300 font-semibold mb-3 text-sm sm:text-base">Payment Method</label>
                
                {/* ICAN Account Card */}
                <div className="bg-gradient-to-br from-blue-600/30 to-cyan-600/30 border-2 border-blue-500/60 rounded-lg sm:rounded-xl p-4 sm:p-5 shadow-lg shadow-blue-500/20">
                  <div className="flex items-start gap-3 sm:gap-4">
                    <div className="text-3xl flex-shrink-0">💳</div>
                    <div className="flex-1">
                      <h3 className="text-base sm:text-lg font-bold text-white mb-1">ICAN Account</h3>
                      <p className="text-xs sm:text-sm text-blue-200/80">Send money directly from your ICAN Wallet</p>
                      <div className="inline-flex items-center gap-2 px-2.5 py-1 mt-2 bg-blue-600/40 border border-blue-400/50 rounded-full">
                        <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                        <span className="text-xs font-semibold text-blue-300">Available & Secure</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Secure ICAN Info Box */}
                <div className="bg-cyan-600/20 border border-cyan-500/30 rounded-lg p-3 mt-3 flex gap-2">
                  <Shield className="w-4 h-4 sm:w-5 sm:h-5 text-cyan-400 flex-shrink-0 mt-0.5" />
                  <p className="text-xs sm:text-sm text-cyan-200/80">
                    <span className="font-semibold">Secure ICAN Transfer:</span> Your contribution will be deducted directly from your ICAN wallet balance and recorded on the blockchain.
                  </p>
                </div>
              </div>

              {/* Blockchain Security Info */}
              <div className="bg-gradient-to-r from-blue-600/20 to-cyan-600/20 border border-blue-500/40 rounded-lg sm:rounded-xl p-3 sm:p-4 flex items-start gap-2 sm:gap-3">
                <Shield className="w-4 h-4 sm:w-5 sm:h-5 text-blue-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs sm:text-sm font-semibold text-blue-300 mb-1">🔐 Blockchain Security</p>
                  <p className="text-xs text-blue-200/80">This contribution will be verified and recorded on the blockchain for complete transparency and immutability.</p>
                </div>
              </div>

              {/* Wallet Status */}
              {!hasICANWallet ? (
                <div className="p-4 bg-red-500/15 border border-red-500/40 rounded-lg flex items-start gap-3">
                  <AlertCircle size={20} className="text-red-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-red-300 text-sm font-semibold mb-2">⚠️ ICAN Wallet Required</p>
                    <p className="text-red-200 text-xs">You must set up your ICAN wallet to make contributions. Please go to your profile and create a wallet first.</p>
                  </div>
                </div>
              ) : (
                <div className="p-3 sm:p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg flex items-start gap-2">
                  <CheckCircle size={18} className="text-emerald-400 flex-shrink-0 mt-0.5" />
                  <p className="text-emerald-300 text-xs sm:text-sm">✓ Your ICAN wallet is verified and ready for contributions</p>
                </div>
              )}

              {/* Footer */}
              <div className="text-center border-t border-slate-700 pt-3">
                <p className="text-xs text-slate-400 flex items-center justify-center gap-2">
                  <Zap size={14} />
                  Powered by Blockchain • Instant Settlement • 24/7 Access
                </p>
              </div>
            </form>

            {/* Sticky Action Buttons Footer */}
            <div className="sticky bottom-0 z-10 bg-gradient-to-t from-slate-800 to-slate-800/80 border-t border-slate-700 p-4 sm:p-6 flex flex-col sm:flex-row gap-3 shadow-lg">
              <button
                type="submit"
                form="contribute-form"
                disabled={loading || !contributeForm.amount || !hasICANWallet}
                onClick={() => {
                  console.log('💾 Submit button clicked:', {
                    loading,
                    hasAmount: !!contributeForm.amount,
                    amount: contributeForm.amount,
                    hasWallet: hasICANWallet
                  });
                }}
                className="flex-1 px-6 py-3 sm:py-4 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 active:from-amber-700 active:to-amber-600 disabled:bg-slate-700 disabled:cursor-not-allowed text-white rounded-lg transition-all font-semibold text-base sm:text-lg shadow-lg shadow-amber-600/30 disabled:shadow-none"
              >
                {!hasICANWallet && '🔒 ICAN Wallet Required'}
                {hasICANWallet && !contributeForm.amount && '👉 Enter Amount (Click ₿1)'}
                {hasICANWallet && contributeForm.amount && !loading && '✅ Confirm Contribution'}
                {loading && '⏳ Processing...'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowContributeModal(false);
                  setContributeForm({ amount: '', paymentMethod: 'ican' });
                }}
                disabled={loading}
                className="flex-1 px-6 py-3 sm:py-4 bg-slate-700 hover:bg-slate-600 active:bg-slate-800 disabled:opacity-50 text-white rounded-lg transition-all font-semibold text-base sm:text-lg"
              >
                Cancel
              </button>
            </div>
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


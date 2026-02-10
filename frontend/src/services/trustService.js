/**
 * TRUST System Service
 * Cooperative Savings & Blockchain Verification
 */

import { getSupabase } from './pitchingService';

// =============================================
// DEBUG FUNCTION - Get all trust data for user
// =============================================

/**
 * Debug function to fetch ALL trust data for debugging
 */
export const debugGetAllUserTrustData = async (userId) => {
  try {
    const sb = getSupabase();
    if (!sb || !userId) return null;

    console.log('=== DEBUG: Fetching all trust data for user:', userId);

    // Get all trust groups (no filters)
    const { data: allGroups, error: allGroupsError } = await sb
      .from('trust_groups')
      .select('*');

    console.log('All trust_groups in database:', allGroups?.length, allGroups);

    // Get all trust_group_members
    const { data: allMembers, error: allMembersError } = await sb
      .from('trust_group_members')
      .select('*');

    console.log('All trust_group_members in database:', allMembers?.length, allMembers);

    // Get where creator_id = userId
    const { data: createdByUser, error: createdError } = await sb
      .from('trust_groups')
      .select('*')
      .eq('creator_id', userId);

    console.log('Groups created by user:', createdByUser?.length, createdByUser);

    // Get where user is member
    const { data: userMemberships, error: memberError } = await sb
      .from('trust_group_members')
      .select('*')
      .eq('user_id', userId);

    console.log('User memberships:', userMemberships?.length, userMemberships);

    return {
      allGroups,
      allMembers,
      createdByUser,
      userMemberships
    };
  } catch (error) {
    console.error('Debug error:', error);
    return null;
  }
};

// =============================================
// TRUST GROUPS SERVICE
// =============================================

/**
 * Get all active TRUST groups (public explore)
 */
export const getPublicTrustGroups = async () => {
  try {
    const sb = getSupabase();
    if (!sb) return [];

    const { data, error } = await sb
      .from('trust_groups')
      .select(`
        id,
        name,
        description,
        creator_id,
        max_members,
        monthly_contribution,
        currency,
        status,
        created_at,
        trust_group_members(count)
      `)
      .eq('status', 'active')
      .eq('trust_group_members.is_active', true)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;
    
    // Transform data to add member_count
    return (data || []).map(group => ({
      ...group,
      member_count: group.trust_group_members?.length || 0,
      trust_group_members: undefined
    }));
  } catch (error) {
    console.error('Error fetching public TRUST groups:', {
      message: error?.message,
      name: error?.name,
      status: error?.status,
      statusText: error?.statusText,
      cause: error?.cause,
      fullError: error
    });
    return [];
  }
};

/**
 * Get user's TRUST groups (My Groups) - IMPROVED VERSION
 */
export const getUserTrustGroups = async (userId) => {
  try {
    const sb = getSupabase();
    if (!sb || !userId) {
      console.log('Supabase or userId not available');
      return [];
    }

    console.log('===== getUserTrustGroups START =====');
    console.log('userId:', userId);

    // Step 1: Get groups where user is CREATOR (all statuses, no nested filters)
    console.log('Step 1: Fetching groups where user is creator...');
    const { data: creatorGroups, error: creatorError } = await sb
      .from('trust_groups')
      .select('*')
      .eq('creator_id', userId);

    if (creatorError) {
      console.error('Creator query error:', creatorError);
      throw creatorError;
    }
    console.log('Creator groups found:', creatorGroups?.length || 0, creatorGroups);

    // Step 2: Get groups where user is MEMBER (is_active = true)
    console.log('Step 2: Fetching groups where user is member...');
    const { data: membershipRecords, error: membershipError } = await sb
      .from('trust_group_members')
      .select('group_id, trust_groups!inner(*)')
      .eq('user_id', userId)
      .eq('is_active', true);

    if (membershipError) {
      console.error('Membership query error:', membershipError);
      throw membershipError;
    }
    console.log('Membership records found:', membershipRecords?.length || 0, membershipRecords);

    const memberGroups = membershipRecords?.map(m => m.trust_groups) || [];
    console.log('Member groups extracted:', memberGroups.length, memberGroups);

    // Step 3: Combine and deduplicate
    const allGroups = [...(creatorGroups || []), ...memberGroups];
    console.log('Total combined groups:', allGroups.length);

    const uniqueMap = new Map();
    allGroups.forEach(group => {
      if (group && group.id) {
        uniqueMap.set(group.id, group);
      }
    });

    const uniqueGroups = Array.from(uniqueMap.values());
    console.log('Unique groups after dedup:', uniqueGroups.length);

    // Step 4: Get member counts for each group
    console.log('Step 4: Fetching member counts...');
    const groupsWithCounts = await Promise.all(
      uniqueGroups.map(async (group) => {
        try {
          const { count } = await sb
            .from('trust_group_members')
            .select('*', { count: 'exact', head: true })
            .eq('group_id', group.id)
            .eq('is_active', true);

          return {
            ...group,
            member_count: count || 0
          };
        } catch (error) {
          console.error(`Error getting count for group ${group.id}:`, error);
          return {
            ...group,
            member_count: 0
          };
        }
      })
    );

    const sortedGroups = groupsWithCounts.sort((a, b) => 
      new Date(b.created_at) - new Date(a.created_at)
    );

    console.log('Final result:', sortedGroups.length, sortedGroups);
    console.log('===== getUserTrustGroups END =====');
    return sortedGroups;

  } catch (error) {
    console.error('Error fetching user TRUST groups:', {
      userId,
      message: error?.message,
      name: error?.name,
      status: error?.status,
      fullError: error
    });
    return [];
  }
};

/**
 * Create a new TRUST group
 */
export const createTrustGroup = async (groupData) => {
  try {
    const sb = getSupabase();
    if (!sb) return { success: false, error: 'Database not configured' };

    const { data: group, error: groupError } = await sb
      .from('trust_groups')
      .insert([{
        name: groupData.name,
        description: groupData.description,
        creator_id: groupData.creatorId,
        max_members: groupData.maxMembers || 30,
        monthly_contribution: groupData.monthlyContribution,
        currency: groupData.currency || 'USD',
        start_date: new Date().toISOString()
      }])
      .select();

    if (groupError) throw groupError;
    if (!group || group.length === 0) throw new Error('Failed to create group');

    const groupId = group[0].id;

    // Add creator as first member
    const { error: memberError } = await sb
      .from('trust_group_members')
      .insert([{
        group_id: groupId,
        user_id: groupData.creatorId,
        member_number: 1,
        role: 'creator'
      }]);

    if (memberError) throw memberError;

    return { success: true, data: group[0] };
  } catch (error) {
    console.error('Error creating TRUST group:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Submit membership application
 */
export const submitMembershipApplication = async (groupId, userId, userEmail, applicationText) => {
  try {
    const sb = getSupabase();
    if (!sb) return { success: false, error: 'Database not configured' };

    // Check if user already has pending or approved application
    const { data: existing, error: existingError } = await sb
      .from('membership_applications')
      .select('id, status')
      .eq('group_id', groupId)
      .eq('user_id', userId)
      .in('status', ['pending', 'approved_by_admin', 'voting_in_progress'])
      .single();

    if (!existingError && existing) {
      return { success: false, error: 'You already have a pending application for this group' };
    }

    // Create application
    const { data, error } = await sb
      .from('membership_applications')
      .insert([{
        group_id: groupId,
        user_id: userId,
        user_email: userEmail,
        application_text: applicationText,
        status: 'pending',
        created_at: new Date().toISOString()
      }])
      .select();

    if (error) throw error;
    return { success: true, data: data[0] };
  } catch (error) {
    console.error('Error submitting application:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get pending applications for admin
 */
export const getPendingApplications = async (groupId) => {
  try {
    const sb = getSupabase();
    if (!sb) return [];

    const { data, error } = await sb
      .from('membership_applications')
      .select('*')
      .eq('group_id', groupId)
      .eq('status', 'pending')
      .order('created_at', { ascending: true });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching pending applications:', error);
    return [];
  }
};

/**
 * Admin approves membership application
 */
export const approveApplicationByAdmin = async (applicationId, groupId) => {
  try {
    const sb = getSupabase();
    if (!sb) return { success: false, error: 'Database not configured' };

    // Update application status
    const { data: updated, error: updateError } = await sb
      .from('membership_applications')
      .update({
        status: 'approved_by_admin',
        admin_reviewed_at: new Date().toISOString()
      })
      .eq('id', applicationId)
      .select();

    if (updateError) throw updateError;

    if (updated && updated.length > 0) {
      const application = updated[0];
      
      // Start member voting
      const voteResult = await startMemberVoting(applicationId, groupId, application.user_id);
      if (!voteResult.success) throw new Error(voteResult.error);
    }

    return { success: true, data: updated[0] };
  } catch (error) {
    console.error('Error approving application:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Admin rejects membership application
 */
export const rejectApplicationByAdmin = async (applicationId) => {
  try {
    const sb = getSupabase();
    if (!sb) return { success: false, error: 'Database not configured' };

    const { data, error } = await sb
      .from('membership_applications')
      .update({
        status: 'rejected_by_admin',
        admin_reviewed_at: new Date().toISOString()
      })
      .eq('id', applicationId)
      .select();

    if (error) throw error;
    return { success: true, data: data[0] };
  } catch (error) {
    console.error('Error rejecting application:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Start member voting on application
 */
export const startMemberVoting = async (applicationId, groupId, applicantUserId) => {
  try {
    const sb = getSupabase();
    if (!sb) return { success: false, error: 'Database not configured' };

    // Update application status to voting_in_progress
    const { error: statusError } = await sb
      .from('membership_applications')
      .update({ status: 'voting_in_progress' })
      .eq('id', applicationId);

    if (statusError) throw statusError;

    // Get all current members to send notifications (in real app, queue notifications)
    const { data: members, error: membersError } = await sb
      .from('trust_group_members')
      .select('user_id')
      .eq('group_id', groupId)
      .eq('is_active', true);

    if (membersError) throw membersError;

    return { 
      success: true, 
      message: 'Voting started for ' + (members?.length || 0) + ' members'
    };
  } catch (error) {
    console.error('Error starting member voting:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Member votes on application
 */
export const voteOnMemberApplication = async (applicationId, voterId, vote) => {
  try {
    const sb = getSupabase();
    if (!sb) return { success: false, error: 'Database not configured' };

    // Check if already voted
    const { data: existing, error: existingError } = await sb
      .from('membership_votes')
      .select('id')
      .eq('application_id', applicationId)
      .eq('voter_id', voterId)
      .single();

    if (!existingError && existing) {
      return { success: false, error: 'You have already voted on this application' };
    }

    // Record vote
    const { data, error } = await sb
      .from('membership_votes')
      .insert([{
        application_id: applicationId,
        voter_id: voterId,
        vote: vote, // 'yes' or 'no'
        voted_at: new Date().toISOString()
      }])
      .select();

    if (error) throw error;

    // Check if voting threshold reached
    const result = await checkVotingThreshold(applicationId);
    
    return { success: true, data: data[0], thresholdReached: result };
  } catch (error) {
    console.error('Error recording vote:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Check if voting threshold (60%) is reached
 */
export const checkVotingThreshold = async (applicationId) => {
  try {
    const sb = getSupabase();
    if (!sb) return false;

    // Get application and group info
    const { data: application, error: appError } = await sb
      .from('membership_applications')
      .select(`
        group_id,
        user_id,
        status
      `)
      .eq('id', applicationId)
      .single();

    if (appError || !application) throw new Error('Application not found');

    // Get total active members in group
    const { count: totalMembers, error: countError } = await sb
      .from('trust_group_members')
      .select('id', { count: 'exact', head: true })
      .eq('group_id', application.group_id)
      .eq('is_active', true);

    if (countError) throw countError;

    // Get votes
    const { data: votes, error: votesError } = await sb
      .from('membership_votes')
      .select('vote')
      .eq('application_id', applicationId);

    if (votesError) throw votesError;

    if (!votes || votes.length === 0) return false;

    const yesVotes = votes.filter(v => v.vote === 'yes').length;
    const totalMembers_num = totalMembers || 1;
    const thresholdPercentage = (yesVotes / totalMembers_num) * 100;

    // If 60% threshold reached, auto-approve
    if (thresholdPercentage >= 60) {
      // Approve and add as member
      const approveResult = await finalizeApprovedMember(
        applicationId,
        application.group_id,
        application.user_id
      );
      return approveResult.success;
    }

    return false;
  } catch (error) {
    console.error('Error checking voting threshold:', error);
    return false;
  }
};

/**
 * Get voting results for application
 */
export const getVotingResults = async (applicationId) => {
  try {
    const sb = getSupabase();
    if (!sb) return null;

    const { data: votes, error } = await sb
      .from('membership_votes')
      .select('vote')
      .eq('application_id', applicationId);

    if (error) throw error;

    const yesCount = votes?.filter(v => v.vote === 'yes').length || 0;
    const noCount = votes?.filter(v => v.vote === 'no').length || 0;
    const total = votes?.length || 0;

    return {
      yes: yesCount,
      no: noCount,
      total: total,
      percentage: total > 0 ? ((yesCount / total) * 100).toFixed(1) : 0
    };
  } catch (error) {
    console.error('Error fetching voting results:', error);
    return null;
  }
};

/**
 * Get user's pending applications
 */
export const getUserPendingApplications = async (userId) => {
  try {
    const sb = getSupabase();
    if (!sb) return [];

    // Get applications with group foreign key
    const { data, error } = await sb
      .from('membership_applications')
      .select('*')
      .eq('user_id', userId)
      .in('status', ['pending', 'approved_by_admin', 'voting_in_progress', 'approved', 'rejected_by_admin', 'rejected_by_vote'])
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Get unique group IDs and fetch group names
    const groupIds = [...new Set((data || []).map(app => app.group_id))];
    let groupsMap = {};

    if (groupIds.length > 0) {
      const { data: groups, error: groupError } = await sb
        .from('trust_groups')
        .select('id, name, description')
        .in('id', groupIds);

      if (!groupError && groups) {
        groupsMap = Object.fromEntries(groups.map(g => [g.id, g]));
      }
    }

    // Map applications with group data
    const mappedData = (data || []).map(app => ({
      ...app,
      group_name: groupsMap[app.group_id]?.name || 'Unknown Group',
      trust_groups: groupsMap[app.group_id]
    }));

    console.log(`Fetched ${mappedData.length} applications for user ${userId}`, { groupsMap, apps: mappedData });
    return mappedData;
  } catch (error) {
    console.error('Error fetching user applications:', error);
    return [];
  }
};

/**
 * Get group details with members and transactions
 */
export const getTrustGroupDetails = async (groupId) => {
  try {
    const sb = getSupabase();
    if (!sb) return null;

    const { data: group, error: groupError } = await sb
      .from('trust_groups')
      .select('*')
      .eq('id', groupId)
      .single();

    if (groupError) throw groupError;

    const { data: members, error: membersError } = await sb
      .from('trust_group_members')
      .select(`
        id,
        user_id,
        member_number,
        role,
        total_contributed,
        total_received,
        payment_status,
        joined_at
      `)
      .eq('group_id', groupId)
      .eq('is_active', true)
      .order('member_number');

    if (membersError) throw membersError;

    const { data: transactions, error: transError } = await sb
      .from('trust_transactions')
      .select('*')
      .eq('group_id', groupId)
      .order('created_at', { ascending: false })
      .limit(20);

    // Handle missing trust_transactions table gracefully
    if (transError && transError.code === '42P01') {
      console.warn('Trust transactions table not yet deployed:', transError.message);
      return {
        ...group,
        members: members || [],
        transactions: [],
        _warning: 'Trust system not fully deployed. Run DEPLOY_TRUST_SYSTEM.sql',
        _needsDeployment: true
      };
    }

    if (transError && transError.code === '42P17') {
      console.error('RLS Policy infinite recursion:', transError.message);
      return {
        ...group,
        members: members || [],
        transactions: [],
        _error: 'rls_policy_recursion',
        _message: 'RLS policies need fixing. Run: backend/db/FIX_RLS_INFINITE_RECURSION.sql',
        _needsRLSFix: true
      };
    }

    if (transError) throw transError;

    return {
      ...group,
      members: members || [],
      transactions: transactions || []
    };
  } catch (error) {
    console.error('Error fetching group details:', error);
    // Return partial data instead of null
    if (error?.code === '42P01') {
      return {
        _error: 'trust_system_not_deployed',
        _message: 'Trust system tables not created. Please run: backend/db/DEPLOY_TRUST_SYSTEM.sql',
        _needsDeployment: true
      };
    }
    if (error?.code === '42P17') {
      return {
        _error: 'rls_policy_recursion',
        _message: 'RLS policies need fixing. Run: backend/db/FIX_RLS_INFINITE_RECURSION.sql',
        _needsRLSFix: true
      };
    }
    return null;
  }
};

// =============================================
// BLOCKCHAIN VERIFICATION SERVICE
// =============================================

/**
 * Generate blockchain hash for transaction
 */
export const generateBlockchainHash = (transactionData) => {
  try {
    // Simulate blockchain hash generation
    const data = JSON.stringify({
      ...transactionData,
      timestamp: new Date().toISOString()
    });
    
    // Simple SHA256 simulation (in production, use crypto library)
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    
    return 'TRUST_' + Math.abs(hash).toString(16).padStart(64, '0').substring(0, 64);
  } catch (error) {
    console.error('Error generating blockchain hash:', error);
    return null;
  }
};

/**
 * Record a TRUST transaction
 */
export const recordTrustTransaction = async (transactionData) => {
  try {
    const sb = getSupabase();
    if (!sb) return { success: false, error: 'Database not configured' };

    // Generate blockchain hash
    const blockchainHash = generateBlockchainHash(transactionData);

    const { data, error } = await sb
      .from('trust_transactions')
      .insert([{
        group_id: transactionData.groupId,
        from_user_id: transactionData.fromUserId,
        to_user_id: transactionData.toUserId,
        amount: transactionData.amount,
        currency: transactionData.currency || 'USD',
        transaction_type: transactionData.type,
        description: transactionData.description,
        blockchain_hash: blockchainHash,
        blockchain_status: 'confirmed',
        is_verified: true
      }])
      .select();

    if (error) throw error;

    // Update member totals
    if (data && data[0]) {
      const transaction = data[0];
      if (transaction.transaction_type === 'contribution') {
        await sb
          .from('trust_group_members')
          .update({ total_contributed: `total_contributed + ${transaction.amount}` })
          .eq('user_id', transaction.from_user_id);
      } else if (transaction.transaction_type === 'payout') {
        await sb
          .from('trust_group_members')
          .update({ total_received: `total_received + ${transaction.amount}` })
          .eq('user_id', transaction.to_user_id);
      }
    }

    return { success: true, data: data[0] };
  } catch (error) {
    console.error('Error recording transaction:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get group statistics
 */
export const getGroupStatistics = async (groupId) => {
  try {
    const sb = getSupabase();
    if (!sb) return null;

    const { data, error } = await sb
      .from('trust_transactions')
      .select('amount, transaction_type, is_verified');

    // Handle missing trust_transactions table gracefully
    if (error && error.code === '42P01') {
      console.warn('Trust transactions table not yet deployed');
      return {
        totalContributed: 0,
        totalPayouts: 0,
        verifiedTransactions: 0,
        totalTransactions: 0,
        _warning: 'Trust system not fully deployed',
        _needsDeployment: true
      };
    }

    // Handle RLS policy infinite recursion
    if (error && error.code === '42P17') {
      console.error('RLS policy infinite recursion detected');
      return {
        totalContributed: 0,
        totalPayouts: 0,
        verifiedTransactions: 0,
        totalTransactions: 0,
        _error: 'rls_policy_recursion',
        _message: 'RLS policies need fixing. Run: backend/db/FIX_RLS_INFINITE_RECURSION.sql',
        _needsRLSFix: true
      };
    }

    if (error) throw error;

    const stats = {
      totalContributed: 0,
      totalPayouts: 0,
      verifiedTransactions: 0,
      totalTransactions: data?.length || 0
    };

    data?.forEach(tx => {
      if (tx.transaction_type === 'contribution') {
        stats.totalContributed += tx.amount;
      } else if (tx.transaction_type === 'payout') {
        stats.totalPayouts += tx.amount;
      }
      if (tx.is_verified) {
        stats.verifiedTransactions++;
      }
    });

    return stats;
  } catch (error) {
    console.error('Error fetching statistics:', error);
    if (error?.code === '42P01') {
      return {
        totalContributed: 0,
        totalPayouts: 0,
        verifiedTransactions: 0,
        totalTransactions: 0,
        _error: 'trust_system_not_deployed',
        _needsDeployment: true
      };
    }
    if (error?.code === '42P17') {
      return {
        totalContributed: 0,
        totalPayouts: 0,
        verifiedTransactions: 0,
        totalTransactions: 0,
        _error: 'rls_policy_recursion',
        _needsRLSFix: true
      };
    }
    return null;
  }
};

/**
 * Verify a transaction on blockchain
 */
export const verifyBlockchainTransaction = async (transactionId) => {
  try {
    const sb = getSupabase();
    if (!sb) return { success: false, error: 'Database not configured' };

    const { data, error } = await sb
      .from('trust_transactions')
      .update({
        blockchain_status: 'confirmed',
        is_verified: true,
        verified_at: new Date().toISOString()
      })
      .eq('id', transactionId)
      .select();

    if (error) throw error;
    return { success: true, data: data[0] };
  } catch (error) {
    console.error('Error verifying transaction:', error);
    return { success: false, error: error.message };
  }
};

// =============================================
// GROUP MANAGEMENT SERVICE
// =============================================

/**
 * Update group settings (creator only)
 */
export const updateGroupSettings = async (groupId, updates) => {
  try {
    const sb = getSupabase();
    if (!sb) return { success: false, error: 'Database not configured' };

    const { data, error } = await sb
      .from('trust_groups')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', groupId)
      .select();

    if (error) throw error;
    return { success: true, data: data[0] };
  } catch (error) {
    console.error('Error updating group:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Remove member from group
 */
export const removeMemberFromGroup = async (groupId, memberId) => {
  try {
    const sb = getSupabase();
    if (!sb) return { success: false, error: 'Database not configured' };

    const { error } = await sb
      .from('trust_group_members')
      .update({ is_active: false, left_at: new Date().toISOString() })
      .eq('group_id', groupId)
      .eq('user_id', memberId);

    if (error) throw error;
    return { success: true };
  } catch (error) {
    console.error('Error removing member:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Promote member to admin
 */
export const promoteMemberToAdmin = async (groupId, memberId) => {
  try {
    const sb = getSupabase();
    if (!sb) return { success: false, error: 'Database not configured' };

    const { data, error } = await sb
      .from('trust_group_members')
      .update({ role: 'admin' })
      .eq('group_id', groupId)
      .eq('user_id', memberId)
      .select();

    if (error) throw error;
    return { success: true, data: data[0] };
  } catch (error) {
    console.error('Error promoting member:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Demote admin to member
 */
export const demoteMemberFromAdmin = async (groupId, memberId) => {
  try {
    const sb = getSupabase();
    if (!sb) return { success: false, error: 'Database not configured' };

    const { data, error } = await sb
      .from('trust_group_members')
      .update({ role: 'member' })
      .eq('group_id', groupId)
      .eq('user_id', memberId)
      .select();

    if (error) throw error;
    return { success: true, data: data[0] };
  } catch (error) {
    console.error('Error demoting member:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Pause/Resume group
 */
export const setGroupStatus = async (groupId, status) => {
  try {
    const sb = getSupabase();
    if (!sb) return { success: false, error: 'Database not configured' };

    const { data, error } = await sb
      .from('trust_groups')
      .update({ status })
      .eq('id', groupId)
      .select();

    if (error) throw error;
    return { success: true, data: data[0] };
  } catch (error) {
    console.error('Error updating status:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Close group (archive)
 */
export const closeGroup = async (groupId) => {
  try {
    const sb = getSupabase();
    if (!sb) return { success: false, error: 'Database not configured' };

    const { data, error } = await sb
      .from('trust_groups')
      .update({ 
        status: 'archived',
        end_date: new Date().toISOString()
      })
      .eq('id', groupId)
      .select();

    if (error) throw error;
    return { success: true, data: data[0] };
  } catch (error) {
    console.error('Error closing group:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get member details with transaction history
 */
export const getMemberDetails = async (groupId, userId) => {
  try {
    const sb = getSupabase();
    if (!sb) return null;

    const { data: member, error: memberError } = await sb
      .from('trust_group_members')
      .select('*')
      .eq('group_id', groupId)
      .eq('user_id', userId)
      .single();

    if (memberError) throw memberError;

    const { data: transactions, error: transError } = await sb
      .from('trust_transactions')
      .select('*')
      .eq('group_id', groupId)
      .or(`from_user_id.eq.${userId},to_user_id.eq.${userId}`)
      .order('created_at', { ascending: false })
      .limit(10);

    if (transError) throw transError;

    return {
      ...member,
      transactions: transactions || []
    };
  } catch (error) {
    console.error('Error fetching member details:', error);
    return null;
  }
};

/**
 * Update member payment status
 */
export const updateMemberPaymentStatus = async (groupId, memberId, status) => {
  try {
    const sb = getSupabase();
    if (!sb) return { success: false, error: 'Database not configured' };

    const { data, error } = await sb
      .from('trust_group_members')
      .update({ payment_status: status })
      .eq('group_id', groupId)
      .eq('user_id', memberId)
      .select();

    if (error) throw error;
    return { success: true, data: data[0] };
  } catch (error) {
    console.error('Error updating payment status:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get group members with full details
 */
export const getGroupMembersDetailed = async (groupId) => {
  try {
    const sb = getSupabase();
    if (!sb) return [];

    const { data, error } = await sb
      .from('trust_group_members')
      .select('*')
      .eq('group_id', groupId)
      .eq('is_active', true)
      .order('member_number');

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching members:', error);
    return [];
  }
};

// =============================================
// POLLING & VOTING SYSTEM
// =============================================

/**
 * Get pending applications for group admin to review
 */
export const getPendingApplicationsForAdmin = async (groupId) => {
  try {
    const sb = getSupabase();
    if (!sb) return [];

    const { data, error } = await sb
      .from('membership_applications')
      .select(`
        id,
        user_id,
        user_email,
        application_text,
        status,
        created_at
      `)
      .eq('group_id', groupId)
      .eq('status', 'pending')
      .order('created_at', { ascending: true });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching pending applications:', error);
    return [];
  }
};

/**
 * Get applications in voting phase for group members
 */
/**
 * Get all voting applications for member across all their groups
 * (including groups they created and groups they joined)
 * Also includes applications where they are the applicant
 */
export const getVotingApplicationsForMember = async (userId) => {
  try {
    const sb = getSupabase();
    if (!sb) return [];

    // First get all groups user is a member of or created
    const { data: userGroups, error: groupsError } = await sb
      .from('trust_group_members')
      .select('group_id')
      .eq('user_id', userId);

    if (groupsError) throw groupsError;

    const memberGroupIds = (userGroups || []).map(g => g.group_id);

    // Also get groups they created
    const { data: createdGroups, error: createdError } = await sb
      .from('trust_groups')
      .select('id')
      .eq('creator_id', userId);

    if (createdError) throw createdError;

    const creatorGroupIds = (createdGroups || []).map(g => g.id);
    
    // Combine all group IDs
    const allGroupIds = [...new Set([...memberGroupIds, ...creatorGroupIds])];

    // Get voting applications from all these groups
    let applicationsFromGroups = [];
    if (allGroupIds.length > 0) {
      const { data, error } = await sb
        .from('membership_applications')
        .select(`
          id,
          group_id,
          user_id,
          user_email,
          application_text,
          status,
          created_at,
          trust_groups!inner(name, description),
          membership_votes(count)
        `)
        .in('group_id', allGroupIds)
        .eq('status', 'voting_in_progress')
        .order('created_at', { ascending: false });

      if (error) throw error;
      applicationsFromGroups = data || [];
    }

    // Also get applications where user is the applicant (they can vote on themselves!)
    const { data: ownApplications, error: ownError } = await sb
      .from('membership_applications')
      .select(`
        id,
        group_id,
        user_id,
        user_email,
        application_text,
        status,
        created_at,
        trust_groups!inner(name, description),
        membership_votes(count)
      `)
      .eq('user_id', userId)
      .eq('status', 'voting_in_progress')
      .order('created_at', { ascending: false });

    if (ownError) throw ownError;

    // Combine and deduplicate by ID
    const allApplications = [...applicationsFromGroups, ...(ownApplications || [])];
    const uniqueApps = Array.from(
      new Map(allApplications.map(app => [app.id, app])).values()
    );

    // Filter out applications where the user has already voted
    const { data: userVotes, error: votesError } = await sb
      .from('membership_votes')
      .select('application_id')
      .eq('member_id', userId);

    if (!votesError && userVotes) {
      const votedApplicationIds = new Set(userVotes.map(v => v.application_id));
      const pendingApps = uniqueApps.filter(app => !votedApplicationIds.has(app.id));
      
      console.log(`Fetched ${pendingApps.length} pending voting applications for member ${userId} (${uniqueApps.length} total - ${uniqueApps.length - pendingApps.length} already voted)`);
      return pendingApps;
    }

    console.log(`Fetched ${uniqueApps.length} voting applications for member ${userId} (${applicationsFromGroups.length} from groups + ${ownApplications?.length || 0} own applications)`);
    return uniqueApps;
  } catch (error) {
    console.error('Error fetching voting applications:', error);
    return [];
  }
};

/**
 * Check if user has already voted on application
 */
export const userHasVoted = async (applicationId, userId) => {
  try {
    const sb = getSupabase();
    if (!sb) return false;

    const { data, error } = await sb
      .from('membership_votes')
      .select('id')
      .eq('application_id', applicationId)
      .eq('voter_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows found
    
    return !!data;
  } catch (error) {
    console.error('Error checking user vote:', error);
    return false;
  }
};

/**
 * Get voting details for application (results, progress, etc)
 */
export const getVotingDetails = async (applicationId) => {
  try {
    const sb = getSupabase();
    if (!sb) return null;

    // Get the application to find the group_id
    const { data: app, error: appError } = await sb
      .from('membership_applications')
      .select('group_id')
      .eq('id', applicationId)
      .single();

    if (appError) throw appError;
    if (!app) throw new Error('Application not found');

    const groupId = app.group_id;

    // Get votes
    const { data: votes, error: votesError } = await sb
      .from('membership_votes')
      .select('vote')
      .eq('application_id', applicationId);

    if (votesError) throw votesError;

    // Get total members in group
    const { count: totalMembers, error: countError } = await sb
      .from('trust_group_members')
      .select('id', { count: 'exact', head: true })
      .eq('group_id', groupId)
      .eq('is_active', true);

    if (countError) throw countError;

    const yesVotes = votes?.filter(v => v.vote === 'yes').length || 0;
    const noVotes = votes?.filter(v => v.vote === 'no').length || 0;
    const totalVoted = votes?.length || 0;
    const totalMembers_num = totalMembers || 1;
    const yesPercentage = (yesVotes / totalMembers_num) * 100;
    const thresholdReached = yesPercentage >= 60;

    return {
      yesVotes,
      noVotes,
      totalVoted,
      totalMembers: totalMembers_num,
      yesPercentage: yesPercentage.toFixed(1),
      noPercentage: ((noVotes / totalMembers_num) * 100).toFixed(1),
      thresholdReached,
      remainingVotes: totalMembers_num - totalVoted,
      votesNeeded: Math.ceil((totalMembers_num * 0.6) - yesVotes)
    };
  } catch (error) {
    console.error('Error fetching voting details:', error);
    return null;
  }
};

/**
 * Submit vote on application (admin/member voting)
 */
export const submitVote = async (applicationId, voterId, vote) => {
  try {
    const sb = getSupabase();
    if (!sb) return { success: false, error: 'Database not configured' };

    // Check if already voted
    const hasVoted = await userHasVoted(applicationId, voterId);
    if (hasVoted) {
      return { success: false, error: 'You have already voted on this application' };
    }

    // Record vote
    const { data, error: voteError } = await sb
      .from('membership_votes')
      .insert([{
        application_id: applicationId,
        voter_id: voterId,
        vote: vote // 'yes' or 'no'
      }])
      .select();

    if (voteError) throw voteError;

    // Check if threshold reached
    const applicationData = await sb
      .from('membership_applications')
      .select('group_id')
      .eq('id', applicationId)
      .single();

    if (applicationData.error) throw applicationData.error;
    const groupId = applicationData.data.group_id;

    const details = await getVotingDetails(applicationId, groupId);

    if (details?.thresholdReached) {
      // Auto-approve
      const approveResult = await finalizeApprovedMember(
        applicationId,
        groupId,
        null
      );

      if (approveResult.success) {
        return {
          success: true,
          data: data[0],
          message: '✓ Vote recorded! Threshold reached - applicant automatically approved!',
          thresholdReached: true
        };
      }
    }

    return {
      success: true,
      data: data[0],
      votingDetails: details,
      thresholdReached: false
    };
  } catch (error) {
    console.error('Error submitting vote:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get all voting applications for a group (admin view)
 */
export const getAllVotingApplications = async (groupId) => {
  try {
    const sb = getSupabase();
    if (!sb) return [];

    const { data, error } = await sb
      .from('membership_applications')
      .select(`
        id,
        user_id,
        user_email,
        application_text,
        status,
        created_at,
        admin_reviewed_at
      `)
      .eq('group_id', groupId)
      .in('status', ['voting_in_progress', 'approved', 'rejected_by_vote'])
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Enrich with voting details
    const enriched = await Promise.all(
      (data || []).map(async (app) => ({
        ...app,
        votingDetails: await getVotingDetails(app.id, groupId)
      }))
    );

    return enriched;
  } catch (error) {
    console.error('Error fetching voting applications:', error);
    return [];
  }
};

/**
 * Admin approves application and starts voting
 */
export const adminApproveApplication = async (applicationId, groupId, adminId) => {
  try {
    const sb = getSupabase();
    if (!sb) return { success: false, error: 'Database not configured' };

    console.log('Approving application:', { applicationId, groupId, adminId });

    // First, verify the admin owns this group
    const { data: group, error: groupError } = await sb
      .from('trust_groups')
      .select('id')
      .eq('id', groupId)
      .eq('creator_id', adminId)
      .single();

    if (groupError || !group) {
      return { success: false, error: 'You do not have permission to manage this group' };
    }

    // Update application
    const { data, error } = await sb
      .from('membership_applications')
      .update({
        status: 'voting_in_progress',
        admin_reviewed_at: new Date().toISOString(),
        reviewed_by_user_id: adminId
      })
      .eq('id', applicationId)
      .eq('group_id', groupId)
      .select();

    if (error) {
      console.error('Database error:', error);
      return { success: false, error: `Database error: ${error.message}` };
    }

    if (!data || data.length === 0) {
      return { success: false, error: 'Application not found or already processed' };
    }

    return {
      success: true,
      data: data[0],
      message: '✓ Application approved! Member voting has started.'
    };
  } catch (error) {
    console.error('Error approving application:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Admin rejects application
 */
export const adminRejectApplication = async (applicationId, adminId) => {
  try {
    const sb = getSupabase();
    if (!sb) return { success: false, error: 'Database not configured' };

    console.log('Rejecting application:', { applicationId, adminId });

    // Get the application to verify permission
    const { data: app, error: appError } = await sb
      .from('membership_applications')
      .select('group_id')
      .eq('id', applicationId)
      .single();

    if (appError || !app) {
      return { success: false, error: 'Application not found' };
    }

    // Verify admin owns the group
    const { data: group, error: groupError } = await sb
      .from('trust_groups')
      .select('id')
      .eq('id', app.group_id)
      .eq('creator_id', adminId)
      .single();

    if (groupError || !group) {
      return { success: false, error: 'You do not have permission to manage this application' };
    }

    const { data, error } = await sb
      .from('membership_applications')
      .update({
        status: 'rejected_by_admin',
        admin_reviewed_at: new Date().toISOString(),
        reviewed_by_user_id: adminId
      })
      .eq('id', applicationId)
      .select();

    if (error) {
      console.error('Database error:', error);
      return { success: false, error: `Database error: ${error.message}` };
    }

    return {
      success: true,
      data: data[0],
      message: '✓ Application rejected.'
    };
  } catch (error) {
    console.error('Error rejecting application:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Finalize approved member (when threshold reached)
 */
export const finalizeApprovedMember = async (applicationId, groupId, userId) => {
  try {
    const sb = getSupabase();
    if (!sb) return { success: false, error: 'Database not configured' };

    // Get application to get user_id if not provided
    const { data: app, error: appError } = await sb
      .from('membership_applications')
      .select('user_id')
      .eq('id', applicationId)
      .single();

    if (appError) throw appError;

    const finalUserId = userId || app.user_id;

    // Check if already a member
    const { data: existing } = await sb
      .from('trust_group_members')
      .select('id')
      .eq('group_id', groupId)
      .eq('user_id', finalUserId)
      .single();

    if (existing) {
      return { success: false, error: 'User is already a member' };
    }

    // Get member count
    const { count, error: countError } = await sb
      .from('trust_group_members')
      .select('id', { count: 'exact', head: true })
      .eq('group_id', groupId)
      .eq('is_active', true);

    if (countError) throw countError;
    if ((count || 0) >= 30) {
      return { success: false, error: 'Group is full' };
    }

    // Add member
    const { data: memberData, error: memberError } = await sb
      .from('trust_group_members')
      .insert([{
        group_id: groupId,
        user_id: finalUserId,
        member_number: (count || 0) + 1,
        role: 'member'
      }])
      .select();

    if (memberError) throw memberError;

    // Update application status
    const { error: updateError } = await sb
      .from('membership_applications')
      .update({ status: 'approved' })
      .eq('id', applicationId);

    if (updateError) throw updateError;

    return {
      success: true,
      data: memberData[0],
      message: '✓ Member approved and added to group!'
    };
  } catch (error) {
    console.error('Error finalizing member:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get voting statistics for group admin dashboard
 */
export const getGroupVotingStats = async (groupId) => {
  try {
    const sb = getSupabase();
    if (!sb) return null;

    // Count applications by status
    const { data: stats, error } = await sb
      .from('membership_applications')
      .select('status')
      .eq('group_id', groupId);

    if (error) throw error;

    const counts = {
      pending: stats?.filter(s => s.status === 'pending').length || 0,
      voting: stats?.filter(s => s.status === 'voting_in_progress').length || 0,
      approved: stats?.filter(s => s.status === 'approved').length || 0,
      rejected: stats?.filter(s => s.status === 'rejected_by_admin').length || 0,
      rejectedByVote: stats?.filter(s => s.status === 'rejected_by_vote').length || 0
    };

    return counts;
  } catch (error) {
    console.error('Error fetching voting stats:', error);
    return null;
  }
};

/**
 * Get user's contribution and interest for a specific group
 */
export const getUserGroupContribution = async (groupId, userId) => {
  try {
    const sb = getSupabase();
    if (!sb) return null;

    // Get user's total contributions to this group
    const { data: transactions, error } = await sb
      .from('trust_transactions')
      .select('amount, transaction_type, created_at, from_user_id, to_user_id')
      .eq('group_id', groupId)
      // include transactions where user is sender or recipient
      .or(`from_user_id.eq.${userId},to_user_id.eq.${userId}`);

    if (error) throw error;

    // Calculate totals
    let totalContributed = 0;
    let interestEarned = 0;

    (transactions || []).forEach(tx => {
      const tType = tx.transaction_type;
      // contributions are recorded with from_user_id equal to the contributor
      if (tType === 'contribution' && tx.from_user_id === userId) {
        totalContributed += Number(tx.amount || 0);
      }
      // payouts/refunds can represent money received by the user (treated as interest here)
      else if ((tType === 'payout' || tType === 'refund') && tx.to_user_id === userId) {
        interestEarned += Number(tx.amount || 0);
      }
    });

    const latestTransaction = (transactions || []).reduce((latest, tx) => {
      if (!latest) return tx;
      return new Date(tx.created_at) > new Date(latest.created_at) ? tx : latest;
    }, null);

    return {
      total_contributed: totalContributed,
      interest_earned: interestEarned,
      transaction_count: transactions?.length || 0,
      latest_transaction: latestTransaction?.created_at
    };
  } catch (error) {
    console.error('Error fetching user group contribution:', error);
    return { total_contributed: 0, interest_earned: 0, transaction_count: 0 };
  }
};

/**
 * Get group transaction history for charting
 */
export const getGroupTransactionHistory = async (groupId, userId, days = 30) => {
  try {
    const sb = getSupabase();
    if (!sb) return [];

    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - days);

    let query = sb
      .from('trust_transactions')
      .select('*')
      .eq('group_id', groupId)
      .gte('created_at', sinceDate.toISOString())
      .order('created_at', { ascending: true });

    if (userId) {
      // include transactions where user is sender or recipient
      query = query.or(`from_user_id.eq.${userId},to_user_id.eq.${userId}`);
    }

    const { data, error } = await query;

    if (error) throw error;

    return data || [];
  } catch (error) {
    console.error('Error fetching transaction history:', error);
    return [];
  }
};

/**
 * Record group contribution transaction
 */
export const recordGroupContribution = async (contribution) => {
  try {
    const sb = getSupabase();
    if (!sb) return { success: false, error: 'Supabase not available' };

    const { groupId, userId, userEmail, amount, blockchainHash } = contribution;

    // Insert transaction record (map to DB schema)
    // Try to set recipient to group creator; fall back to userId
    let toUserId = userId;
    try {
      const { data: grp, error: grpErr } = await sb.from('trust_groups').select('creator_id').eq('id', groupId).single();
      if (!grpErr && grp?.creator_id) toUserId = grp.creator_id;
    } catch (e) {
      // ignore - we'll use userId as recipient if we can't determine creator
    }

    const { data, error } = await sb
      .from('trust_transactions')
      .insert([
        {
          group_id: groupId,
          from_user_id: userId,
          to_user_id: toUserId,
          amount: amount,
          transaction_type: 'contribution',
          description: `Contribution of $${amount}`,
          blockchain_hash: blockchainHash,
          is_verified: true
        }
      ])
      .select();

    if (error) throw error;

    console.log('Contribution recorded:', data);
    return { success: true, data: data?.[0] };
  } catch (error) {
    console.error('Error recording contribution:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Create blockchain smart contract transaction
 * In production, this would call an actual smart contract
 */
export const createSmartContractTransaction = async (transaction) => {
  try {
    const { groupId, userId, amount, type } = transaction;

    // Simulate blockchain transaction
    // In production, this would call Web3.js or similar
    const mockHash = `0x${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}`;

    // Log to console (in production, would call actual blockchain)
    console.log('Smart Contract Transaction Created:', {
      groupId,
      userId,
      amount,
      type,
      hash: mockHash,
      timestamp: new Date().toISOString()
    });

    // Return transaction details
    return {
      hash: mockHash,
      groupId,
      userId,
      amount,
      type,
      timestamp: new Date().toISOString(),
      status: 'pending'
    };
  } catch (error) {
    console.error('Error creating blockchain transaction:', error);
    throw error;
  }
};

/**
 * Get all messages for a group chat
 */
export const getGroupMessages = async (groupId) => {
  try {
    const sb = getSupabase();
    if (!sb) return [];

    const { data, error } = await sb
      .from('group_messages')
      .select('*')
      .eq('group_id', groupId)
      .order('created_at', { ascending: true });

    if (error) throw error;

    return data || [];
  } catch (error) {
    // If the table doesn't exist in the deployed DB, return empty list silently
    if (error?.code === '42P01' || (error?.message && error.message.includes('relation "public.group_messages" does not exist'))) {
      return [];
    }
    console.error('Error fetching group messages:', error);
    return [];
  }
};

/**
 * Send message to group chat
 */
export const sendGroupMessage = async (messageData) => {
  try {
    const sb = getSupabase();
    if (!sb) return { success: false };

    const { groupId, userId, userEmail, message } = messageData;

    const { data, error } = await sb
      .from('group_messages')
      .insert([
        {
          group_id: groupId,
          user_id: userId,
          user_email: userEmail,
          message: message
        }
      ])
      .select();

    if (error) throw error;

    console.log('Message sent:', data);
    return { success: true, data: data?.[0] };
  } catch (error) {
    console.error('Error sending message:', error);
    return { success: false, error: error.message };
  }
};

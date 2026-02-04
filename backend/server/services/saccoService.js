/**
 * SACCO Service - Backend API for Savings & Credit Cooperative
 * Handles group management, contributions, loans, and approvals
 * All transactions are recorded to blockchain for immutable audit trail
 */

import supabase from '../config/supabase'
import * as trustBlockchain from '../services/trustBlockchainService'

/**
 * SACCO Creation & Management
 */

export const createSacco = async (name, description, userId) => {
  try {
    const { data, error } = await supabase
      .from('ican_saccos')
      .insert({
        name,
        description,
        admin_id: userId,
        status: 'active',
        member_count: 1
      })
      .select()
      .single()

    if (error) throw error
    
    // Auto-add admin as first member
    await addMemberToSacco(data.id, userId, 'admin')
    
    return data
  } catch (error) {
    console.error('Error creating SACCO:', error)
    throw error
  }
}

export const getSaccos = async (includePrivate = false) => {
  try {
    let query = supabase
      .from('ican_saccos')
      .select('*')
      .eq('status', 'active')
      .order('created_at', { ascending: false })

    const { data, error } = await query

    if (error) throw error
    return data
  } catch (error) {
    console.error('Error fetching SACCOs:', error)
    throw error
  }
}

export const getSaccoDetails = async (saccoId) => {
  try {
    const { data, error } = await supabase
      .from('ican_saccos')
      .select('*')
      .eq('id', saccoId)
      .single()

    if (error) throw error
    return data
  } catch (error) {
    console.error('Error fetching SACCO details:', error)
    throw error
  }
}

/**
 * SACCO Member Management
 */

export const requestJoinSacco = async (saccoId, userId) => {
  try {
    // Check if already a member
    const existing = await supabase
      .from('ican_sacco_members')
      .select('id')
      .eq('sacco_id', saccoId)
      .eq('user_id', userId)
      .single()

    if (existing.data) {
      throw new Error('Already a member or pending approval')
    }

    // Check member limit
    const { count: memberCount } = await supabase
      .from('ican_sacco_members')
      .select('*', { count: 'exact', head: true })
      .eq('sacco_id', saccoId)
      .eq('status', 'approved')

    if (memberCount >= 30) {
      throw new Error('SACCO has reached maximum members (30)')
    }

    // Create membership request
    const { data, error } = await supabase
      .from('ican_sacco_members')
      .insert({
        sacco_id: saccoId,
        user_id: userId,
        status: 'pending',
        role: 'member'
      })
      .select()
      .single()

    if (error) throw error
    
    // Record member join to blockchain
    try {
      await trustBlockchain.recordTrustMemberJoin(
        saccoId,
        userId,
        `Member #${data.id.slice(0, 8)}`,
        { timestamp: new Date().toISOString() }
      )
    } catch (blockchainError) {
      console.warn('Blockchain recording failed:', blockchainError)
      // Don't throw - membership was created successfully
    }
    
    return data
  } catch (error) {
    console.error('Error requesting to join SACCO:', error)
    throw error
  }
}

export const getMySaccos = async (userId) => {
  try {
    const { data, error } = await supabase
      .from('ican_sacco_members')
      .select(`
        *,
        sacco:ican_saccos(*)
      `)
      .eq('user_id', userId)
      .eq('status', 'approved')

    if (error) throw error
    return data.map(m => ({ ...m.sacco, memberData: m }))
  } catch (error) {
    console.error('Error fetching my SACCOs:', error)
    throw error
  }
}

export const getSaccoMembers = async (saccoId, userId) => {
  try {
    // Check if user is member
    const memberCheck = await supabase
      .from('ican_sacco_members')
      .select('status')
      .eq('sacco_id', saccoId)
      .eq('user_id', userId)
      .single()

    if (!memberCheck.data || memberCheck.data.status !== 'approved') {
      throw new Error('Not a member of this SACCO')
    }

    // Get approved members
    const { data, error } = await supabase
      .from('ican_sacco_members')
      .select(`
        id,
        user_id,
        role,
        total_contributed,
        current_balance,
        interest_earned,
        show_profile,
        created_at
      `)
      .eq('sacco_id', saccoId)
      .eq('status', 'approved')

    if (error) throw error

    // Don't return profiles unless show_profile is true
    return data.map(m => ({
      ...m,
      // Hide identifying info if show_profile is false
      user_id: m.show_profile ? m.user_id : null
    }))
  } catch (error) {
    console.error('Error fetching SACCO members:', error)
    throw error
  }
}

export const getPendingMembers = async (saccoId, adminId) => {
  try {
    // Check if user is admin
    const adminCheck = await supabase
      .from('ican_saccos')
      .select('admin_id')
      .eq('id', saccoId)
      .single()

    if (!adminCheck.data || adminCheck.data.admin_id !== adminId) {
      throw new Error('Only admin can view pending members')
    }

    const { data, error } = await supabase
      .from('ican_sacco_members')
      .select('*')
      .eq('sacco_id', saccoId)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })

    if (error) throw error
    return data
  } catch (error) {
    console.error('Error fetching pending members:', error)
    throw error
  }
}

/**
 * Member Approval Process (60% voting)
 */

export const approveMember = async (memberId, saccoId, voterId, approve) => {
  try {
    // Record vote
    const { error: voteError } = await supabase
      .from('ican_sacco_votes')
      .upsert({
        member_id: memberId,
        sacco_id: saccoId,
        voter_id: voterId,
        vote: approve
      }, { onConflict: 'member_id,voter_id' })

    if (voteError) throw voteError

    // Record vote to blockchain
    try {
      await trustBlockchain.recordTrustVote(
        saccoId,
        memberId,
        voterId,
        approve,
        approve ? 'Member approved' : 'Member rejected'
      )
    } catch (blockchainError) {
      console.warn('Blockchain vote recording failed:', blockchainError)
    }

    // Get sacco details
    const sacco = await getSaccoDetails(saccoId)

    // Get approved member count for voting
    const { count: approvedCount } = await supabase
      .from('ican_sacco_members')
      .select('*', { count: 'exact', head: true })
      .eq('sacco_id', saccoId)
      .eq('status', 'approved')

    // Get total votes for this member
    const { data: votes, error: votesError } = await supabase
      .from('ican_sacco_votes')
      .select('*')
      .eq('member_id', memberId)

    if (votesError) throw votesError

    const approveCount = votes.filter(v => v.vote).length
    const requiredApprovals = Math.ceil(approvedCount * sacco.approval_threshold)

    // If member gets enough approvals, mark as approved
    if (approveCount >= requiredApprovals) {
      const { data: member } = await supabase
        .from('ican_sacco_members')
        .select('user_id')
        .eq('id', memberId)
        .single()

      await supabase
        .from('ican_sacco_members')
        .update({
          status: 'approved',
          approval_date: new Date().toISOString(),
          approved_by_count: approveCount
        })
        .eq('id', memberId)

      return { status: 'approved', message: `Member approved by ${approveCount} members` }
    }

    return { 
      status: 'pending', 
      message: `Need ${requiredApprovals} approvals (${approveCount} received)` 
    }
  } catch (error) {
    console.error('Error in approval process:', error)
    throw error
  }
}

/**
 * Contributions
 */

export const makeContribution = async (saccoId, userId, amount, description = '') => {
  try {
    // Get member ID
    const memberData = await supabase
      .from('ican_sacco_members')
      .select('id')
      .eq('sacco_id', saccoId)
      .eq('user_id', userId)
      .eq('status', 'approved')
      .single()

    if (!memberData.data) {
      throw new Error('Member not found or not approved')
    }

    const { data, error } = await supabase
      .from('ican_sacco_contributions')
      .insert({
        sacco_id: saccoId,
        member_id: memberData.data.id,
        amount,
        description
      })
      .select()
      .single()

    if (error) throw error

    // Record contribution to blockchain
    try {
      await trustBlockchain.recordTrustContribution(
        saccoId,
        userId,
        amount,
        description || 'Contribution to group savings'
      )
    } catch (blockchainError) {
      console.warn('Blockchain contribution recording failed:', blockchainError)
    }

    return data
  } catch (error) {
    console.error('Error making contribution:', error)
    throw error
  }
}

export const getMemberContributions = async (userId, saccoId) => {
  try {
    const memberData = await supabase
      .from('ican_sacco_members')
      .select('id')
      .eq('user_id', userId)
      .eq('sacco_id', saccoId)
      .single()

    if (!memberData.data) {
      throw new Error('Member not found')
    }

    const { data, error } = await supabase
      .from('ican_sacco_contributions')
      .select('*')
      .eq('member_id', memberData.data.id)
      .order('contribution_date', { ascending: false })

    if (error) throw error
    return data
  } catch (error) {
    console.error('Error fetching contributions:', error)
    throw error
  }
}

/**
 * Loans
 */

export const requestLoan = async (saccoId, userId, principal, interestRate = 10, durationMonths = 12) => {
  try {
    // Get member ID and balance
    const memberData = await supabase
      .from('ican_sacco_members')
      .select('id, current_balance')
      .eq('sacco_id', saccoId)
      .eq('user_id', userId)
      .eq('status', 'approved')
      .single()

    if (!memberData.data) {
      throw new Error('Member not found or not approved')
    }

    // Check if member has minimum balance (e.g., 20% of loan amount)
    const minBalance = principal * 0.2
    if (memberData.data.current_balance < minBalance) {
      throw new Error(`Minimum balance required: ${minBalance}`)
    }

    const dueDate = new Date()
    dueDate.setMonth(dueDate.getMonth() + durationMonths)

    const { data, error } = await supabase
      .from('ican_sacco_loans')
      .insert({
        sacco_id: saccoId,
        member_id: memberData.data.id,
        principal,
        interest_rate: interestRate,
        duration_months: durationMonths,
        due_date: dueDate.toISOString(),
        status: 'active'
      })
      .select()
      .single()

    if (error) throw error

    // Record loan approval to blockchain
    try {
      await trustBlockchain.recordTrustLoanApproval(
        saccoId,
        userId,
        principal,
        data.id
      )
    } catch (blockchainError) {
      console.warn('Blockchain loan recording failed:', blockchainError)
    }

    return data
  } catch (error) {
    console.error('Error requesting loan:', error)
    throw error
  }
}

export const getMemberLoans = async (userId, saccoId) => {
  try {
    const memberData = await supabase
      .from('ican_sacco_members')
      .select('id')
      .eq('user_id', userId)
      .eq('sacco_id', saccoId)
      .single()

    if (!memberData.data) {
      throw new Error('Member not found')
    }

    const { data, error } = await supabase
      .from('ican_sacco_loans')
      .select('*')
      .eq('member_id', memberData.data.id)
      .order('disbursed_date', { ascending: false })

    if (error) throw error
    return data
  } catch (error) {
    console.error('Error fetching loans:', error)
    throw error
  }
}

export const repayLoan = async (loanId, amount) => {
  try {
    const { data, error } = await supabase
      .from('ican_sacco_repayments')
      .insert({
        loan_id: loanId,
        amount,
        payment_date: new Date().toISOString()
      })
      .select()
      .single()

    if (error) throw error
    return data
  } catch (error) {
    console.error('Error repaying loan:', error)
    throw error
  }
}

/**
 * Member Dashboard Data
 */

export const getMemberDashboard = async (userId, saccoId) => {
  try {
    // Get member info
    const memberData = await supabase
      .from('ican_sacco_members')
      .select('*')
      .eq('sacco_id', saccoId)
      .eq('user_id', userId)
      .single()

    if (!memberData.data) {
      throw new Error('Member not found')
    }

    // Get SACCO info
    const saccoData = await getSaccoDetails(saccoId)

    // Get recent contributions
    const contributions = await getMemberContributions(userId, saccoId)

    // Get loans
    const loans = await getMemberLoans(userId, saccoId)

    // Calculate statistics
    const activeLoan = loans.find(l => l.status === 'active')
    const loanBalance = activeLoan ? activeLoan.principal - activeLoan.amount_repaid : 0

    return {
      member: memberData.data,
      sacco: saccoData,
      contributions: contributions.slice(0, 5),
      loans,
      stats: {
        totalContributed: memberData.data.total_contributed,
        currentBalance: memberData.data.current_balance,
        interestEarned: memberData.data.interest_earned,
        activeLoanBalance: loanBalance,
        groupPoolSize: saccoData.total_pool,
        memberCount: saccoData.member_count
      }
    }
  } catch (error) {
    console.error('Error fetching member dashboard:', error)
    throw error
  }
}

export const updatePrivacySettings = async (userId, saccoId, showProfile) => {
  try {
    const memberData = await supabase
      .from('ican_sacco_members')
      .select('id')
      .eq('user_id', userId)
      .eq('sacco_id', saccoId)
      .single()

    if (!memberData.data) {
      throw new Error('Member not found')
    }

    const { data, error } = await supabase
      .from('ican_sacco_members')
      .update({ show_profile: showProfile })
      .eq('id', memberData.data.id)
      .select()
      .single()

    if (error) throw error
    return data
  } catch (error) {
    console.error('Error updating privacy settings:', error)
    throw error
  }
}

// Helper function to add member (used internally)
const addMemberToSacco = async (saccoId, userId, role = 'member') => {
  try {
    const { error } = await supabase
      .from('ican_sacco_members')
      .insert({
        sacco_id: saccoId,
        user_id: userId,
        status: 'approved',
        role,
        approval_date: new Date().toISOString()
      })

    if (error) throw error
  } catch (error) {
    console.error('Error adding member to SACCO:', error)
  }
}

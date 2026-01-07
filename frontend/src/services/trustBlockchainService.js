/**
 * Blockchain Service - Trust (SACCO) & Transaction Verification
 * Provides immutable record-keeping for:
 * - Trust member joins
 * - Voting transactions
 * - Contribution records
 * - Loan approvals
 */

import supabase from '../config/supabase'

/**
 * ============================================
 * BLOCKCHAIN RECORD STRUCTURES
 * ============================================
 * 
 * All records are stored with:
 * - Cryptographic hash for integrity
 * - Timestamp for immutability
 * - Previous hash (chainable)
 * - Record type (member_join, vote, contribution, loan)
 */

/**
 * Generate SHA256 hash for record
 */
const generateHash = async (data) => {
  const message = JSON.stringify(data)
  const encoder = new TextEncoder()
  const dataBuffer = encoder.encode(message)
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * ============================================
 * TRUST MEMBER JOIN TRANSACTIONS
 * ============================================
 */

export const recordTrustMemberJoin = async (trustId, userId, memberName, verificationData = {}) => {
  try {
    const timestamp = new Date().toISOString()
    
    // Get previous hash for chain
    const { data: lastRecord } = await supabase
      .from('ican_blockchain_records')
      .select('record_hash')
      .eq('record_type', 'trust_member_join')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    const previousHash = lastRecord?.record_hash || '0'

    // Create transaction data
    const transactionData = {
      type: 'trust_member_join',
      trust_id: trustId,
      user_id: userId,
      member_name: memberName,
      verification_status: 'pending',
      verification_data: verificationData,
      timestamp
    }

    // Generate hash
    const recordHash = await generateHash({
      ...transactionData,
      previous_hash: previousHash
    })

    // Store in blockchain records
    const { data, error } = await supabase
      .from('ican_blockchain_records')
      .insert({
        record_type: 'trust_member_join',
        trust_id: trustId,
        user_id: userId,
        record_data: transactionData,
        record_hash: recordHash,
        previous_hash: previousHash,
        is_verified: false,
        verification_count: 0
      })
      .select()
      .single()

    if (error) throw error
    
    console.log('✓ Member join recorded to blockchain:', recordHash)
    return { success: true, blockchainRecord: data, recordHash }
  } catch (error) {
    console.error('Error recording member join:', error)
    throw error
  }
}

/**
 * ============================================
 * TRUST VOTING TRANSACTIONS
 * ============================================
 */

export const recordTrustVote = async (trustId, memberId, voterId, voteValue, reason = '') => {
  try {
    const timestamp = new Date().toISOString()

    // Get previous hash
    const { data: lastRecord } = await supabase
      .from('ican_blockchain_records')
      .select('record_hash')
      .eq('record_type', 'trust_vote')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    const previousHash = lastRecord?.record_hash || '0'

    // Create vote transaction
    const voteData = {
      type: 'trust_vote',
      trust_id: trustId,
      member_id_voting_on: memberId,
      voter_id: voterId,
      vote: voteValue ? 'APPROVE' : 'REJECT',
      reason: reason || '',
      timestamp
    }

    // Generate hash
    const recordHash = await generateHash({
      ...voteData,
      previous_hash: previousHash
    })

    // Store vote
    const { data, error } = await supabase
      .from('ican_blockchain_records')
      .insert({
        record_type: 'trust_vote',
        trust_id: trustId,
        user_id: voterId,
        record_data: voteData,
        record_hash: recordHash,
        previous_hash: previousHash,
        is_verified: true, // Votes are immediately verified
        verification_count: 1
      })
      .select()
      .single()

    if (error) throw error

    console.log('✓ Vote recorded to blockchain:', recordHash)
    return { success: true, blockchainRecord: data, recordHash }
  } catch (error) {
    console.error('Error recording vote:', error)
    throw error
  }
}

/**
 * ============================================
 * CONTRIBUTION TRANSACTIONS
 * ============================================
 */

export const recordTrustContribution = async (trustId, userId, amount, description = '') => {
  try {
    const timestamp = new Date().toISOString()

    // Get previous hash
    const { data: lastRecord } = await supabase
      .from('ican_blockchain_records')
      .select('record_hash')
      .eq('record_type', 'trust_contribution')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    const previousHash = lastRecord?.record_hash || '0'

    // Create contribution transaction
    const contributionData = {
      type: 'trust_contribution',
      trust_id: trustId,
      contributor_id: userId,
      amount: parseFloat(amount),
      currency: 'USD',
      description: description || 'Contribution to trust pool',
      timestamp
    }

    // Generate hash
    const recordHash = await generateHash({
      ...contributionData,
      previous_hash: previousHash
    })

    // Store contribution
    const { data, error } = await supabase
      .from('ican_blockchain_records')
      .insert({
        record_type: 'trust_contribution',
        trust_id: trustId,
        user_id: userId,
        record_data: contributionData,
        record_hash: recordHash,
        previous_hash: previousHash,
        is_verified: true, // Contributions verified by transaction
        verification_count: 1
      })
      .select()
      .single()

    if (error) throw error

    console.log('✓ Contribution recorded to blockchain:', recordHash, `Amount: $${amount}`)
    return { success: true, blockchainRecord: data, recordHash }
  } catch (error) {
    console.error('Error recording contribution:', error)
    throw error
  }
}

/**
 * ============================================
 * LOAN APPROVAL TRANSACTIONS
 * ============================================
 */

export const recordTrustLoanApproval = async (trustId, userId, loanAmount, loanId) => {
  try {
    const timestamp = new Date().toISOString()

    // Get previous hash
    const { data: lastRecord } = await supabase
      .from('ican_blockchain_records')
      .select('record_hash')
      .eq('record_type', 'trust_loan_approval')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    const previousHash = lastRecord?.record_hash || '0'

    // Create loan approval transaction
    const loanData = {
      type: 'trust_loan_approval',
      trust_id: trustId,
      borrower_id: userId,
      loan_id: loanId,
      loan_amount: parseFloat(loanAmount),
      currency: 'USD',
      status: 'APPROVED',
      timestamp
    }

    // Generate hash
    const recordHash = await generateHash({
      ...loanData,
      previous_hash: previousHash
    })

    // Store loan approval
    const { data, error } = await supabase
      .from('ican_blockchain_records')
      .insert({
        record_type: 'trust_loan_approval',
        trust_id: trustId,
        user_id: userId,
        record_data: loanData,
        record_hash: recordHash,
        previous_hash: previousHash,
        is_verified: true,
        verification_count: 1
      })
      .select()
      .single()

    if (error) throw error

    console.log('✓ Loan approval recorded to blockchain:', recordHash, `Amount: $${loanAmount}`)
    return { success: true, blockchainRecord: data, recordHash }
  } catch (error) {
    console.error('Error recording loan approval:', error)
    throw error
  }
}

/**
 * ============================================
 * BLOCKCHAIN VERIFICATION & AUDITING
 * ============================================
 */

/**
 * Verify integrity of blockchain record
 */
export const verifyBlockchainRecord = async (recordId) => {
  try {
    const { data: record, error } = await supabase
      .from('ican_blockchain_records')
      .select('*')
      .eq('id', recordId)
      .single()

    if (error) throw error

    // Get previous record to verify chain
    const { data: previousRecord } = await supabase
      .from('ican_blockchain_records')
      .select('record_hash')
      .eq('id', record.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .offset(1)
      .single()

    // Verify hash chain
    const expectedPreviousHash = previousRecord?.record_hash || '0'
    const chainValid = record.previous_hash === expectedPreviousHash

    // Regenerate hash to verify
    const recalculatedHash = await generateHash({
      ...record.record_data,
      previous_hash: record.previous_hash
    })

    const hashValid = recalculatedHash === record.record_hash

    return {
      recordId,
      isValid: chainValid && hashValid,
      chainValid,
      hashValid,
      verificationDetails: {
        recordHash: record.record_hash,
        previousHash: record.previous_hash,
        expectedPreviousHash,
        recordType: record.record_type
      }
    }
  } catch (error) {
    console.error('Error verifying record:', error)
    throw error
  }
}

/**
 * Get blockchain audit trail for trust
 */
export const getTrustBlockchainAudit = async (trustId) => {
  try {
    const { data, error } = await supabase
      .from('ican_blockchain_records')
      .select('*')
      .eq('trust_id', trustId)
      .order('created_at', { ascending: false })

    if (error) throw error

    // Verify all records
    const auditTrail = await Promise.all(
      data.map(async (record) => {
        const verification = await verifyBlockchainRecord(record.id)
        return {
          ...record,
          verification
        }
      })
    )

    return auditTrail
  } catch (error) {
    console.error('Error getting audit trail:', error)
    throw error
  }
}

/**
 * Get member's blockchain history
 */
export const getMemberBlockchainHistory = async (userId, trustId) => {
  try {
    const { data, error } = await supabase
      .from('ican_blockchain_records')
      .select('*')
      .eq('user_id', userId)
      .eq('trust_id', trustId)
      .order('created_at', { ascending: false })

    if (error) throw error

    return data
  } catch (error) {
    console.error('Error getting member history:', error)
    throw error
  }
}

/**
 * Get verification statistics for trust
 */
export const getTrustVerificationStats = async (trustId) => {
  try {
    const audit = await getTrustBlockchainAudit(trustId)

    const stats = {
      totalRecords: audit.length,
      verifiedRecords: audit.filter(r => r.verification.isValid).length,
      verificationRate: audit.length > 0 
        ? ((audit.filter(r => r.verification.isValid).length / audit.length) * 100).toFixed(2)
        : 0,
      recordsByType: {
        member_joins: audit.filter(r => r.record_type === 'trust_member_join').length,
        votes: audit.filter(r => r.record_type === 'trust_vote').length,
        contributions: audit.filter(r => r.record_type === 'trust_contribution').length,
        loan_approvals: audit.filter(r => r.record_type === 'trust_loan_approval').length
      },
      chainIntegrity: audit.every(r => r.verification.chainValid)
    }

    return stats
  } catch (error) {
    console.error('Error getting verification stats:', error)
    throw error
  }
}

/**
 * ============================================
 * ANALYTICS & REPORTING
 * ============================================
 */

/**
 * Get trust voting analytics
 */
export const getTrustVotingAnalytics = async (trustId) => {
  try {
    const { data, error } = await supabase
      .from('ican_blockchain_records')
      .select('record_data')
      .eq('trust_id', trustId)
      .eq('record_type', 'trust_vote')

    if (error) throw error

    const approvals = data.filter(r => r.record_data.vote === 'APPROVE').length
    const rejections = data.filter(r => r.record_data.vote === 'REJECT').length
    const totalVotes = data.length

    return {
      totalVotes,
      approvals,
      rejections,
      approvalRate: totalVotes > 0 ? ((approvals / totalVotes) * 100).toFixed(2) : 0,
      recentVotes: data.slice(0, 10)
    }
  } catch (error) {
    console.error('Error getting voting analytics:', error)
    throw error
  }
}

/**
 * Get trust financial analytics
 */
export const getTrustFinancialAnalytics = async (trustId) => {
  try {
    const { data, error } = await supabase
      .from('ican_blockchain_records')
      .select('record_data')
      .eq('trust_id', trustId)
      .in('record_type', ['trust_contribution', 'trust_loan_approval'])

    if (error) throw error

    const contributions = data
      .filter(r => r.record_data.type === 'trust_contribution')
      .map(r => r.record_data.amount)

    const loans = data
      .filter(r => r.record_data.type === 'trust_loan_approval')
      .map(r => r.record_data.loan_amount)

    const totalContributed = contributions.reduce((sum, amt) => sum + amt, 0)
    const totalLoaned = loans.reduce((sum, amt) => sum + amt, 0)

    return {
      totalContributed,
      totalLoaned,
      contributionCount: contributions.length,
      loanCount: loans.length,
      averageContribution: contributions.length > 0 
        ? (totalContributed / contributions.length).toFixed(2)
        : 0,
      averageLoan: loans.length > 0 
        ? (totalLoaned / loans.length).toFixed(2)
        : 0
    }
  } catch (error) {
    console.error('Error getting financial analytics:', error)
    throw error
  }
}

export default {
  // Member Management
  recordTrustMemberJoin,
  
  // Voting
  recordTrustVote,
  getTrustVotingAnalytics,
  
  // Contributions
  recordTrustContribution,
  
  // Loans
  recordTrustLoanApproval,
  
  // Verification
  verifyBlockchainRecord,
  getTrustBlockchainAudit,
  getMemberBlockchainHistory,
  getTrustVerificationStats,
  
  // Analytics
  getTrustFinancialAnalytics
}

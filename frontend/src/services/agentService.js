/**
 * 🏪 AGENT SERVICE
 * Handles dual-currency agent operations: Cash-In, Cash-Out, Float Management
 */

import { getSupabaseClient } from '../lib/supabase/client';

// Hash PIN using the same method as walletAccountService & universalTransactionService
const hashPIN = (pin) => {
  let hash = 0;
  const string = `pin-${pin}-salt-ican-hash`;
  
  for (let i = 0; i < string.length; i++) {
    const char = string.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  
  return btoa(`hash-${Math.abs(hash)}-${pin.length}`);
};

class AgentService {
  constructor() {
    this.supabase = null;
    this.userId = null;
    this.agentId = null;
  }

  /**
   * Check if current user is an agent (non-blocking)
   */
  async isUserAgent() {
    this.supabase = getSupabaseClient();
    
    try {
      const { data: { user }, error } = await this.supabase.auth.getUser();
      if (error || !user) {
        return { isAgent: false, agentId: null };
      }
      
      this.userId = user.id;
      
      // Try to find agent record for this user
      const { data: agentData, error: agentError } = await this.supabase
        .from('agents')
        .select('id, agent_code, status')
        .eq('user_id', this.userId)
        .maybeSingle(); // Non-throwing, returns null if not found
      
      if (agentError || !agentData) {
        return { isAgent: false, agentId: null };
      }

      if (agentData.status !== 'active') {
        return { isAgent: false, agentId: agentData.id, reason: `Agent status: ${agentData.status}` };
      }

      this.agentId = agentData.id;
      return { isAgent: true, agentId: agentData.id, agentCode: agentData.agent_code };
    } catch (error) {
      console.error('⚠️ Error checking agent status:', error.message);
      return { isAgent: false, agentId: null };
    }
  }

  /**
   * Initialize Agent Service for current user
   */
  async initialize() {
    const agentStatus = await this.isUserAgent();
    
    if (!agentStatus.isAgent) {
      console.warn('⚠️ User is not an active agent');
      return false;
    }

    this.agentId = agentStatus.agentId;
    this.supabase = getSupabaseClient();
    console.log('✅ Agent Service initialized:', this.agentId);
    return true;
  }

  /**
   * 💰 CASH-IN: Agent receives physical cash and credits user's digital wallet
   * @param {Object} params
   * @param {string} params.userAccountId - Customer account ID
   * @param {number} params.amount - Cash amount received
   * @param {string} params.currency - 'USD' or 'UGX'
   * @param {string} params.description - Transaction note
   */
  async processCashIn(params) {
    const { userAccountId, amount, currency, description } = params;

    try {
      // Validate inputs
      if (!userAccountId || !amount || !currency) {
        throw new Error('Missing required fields');
      }

      if (!['USD', 'UGX', 'KES'].includes(currency)) {
        throw new Error('Currency must be USD, UGX, or KES');
      }

      if (amount <= 0) {
        throw new Error('Amount must be greater than 0');
      }

      // Get the actual user UUID from the account number
      const { data: userAccount, error: lookupError } = await this.supabase
        .from('user_accounts')
        .select('user_id')
        .ilike('account_number', userAccountId)
        .single();

      if (lookupError || !userAccount) {
        throw new Error(`User account ${userAccountId} not found`);
      }

      const userId = userAccount.user_id;

      // ============================================
      // CREATE PENDING CASH-IN REQUEST
      // ============================================
      // Call RPC to create pending request - user will see it in withdraw tab
      
      const { data, error } = await this.supabase.rpc('create_pending_cash_in', {
        p_user_id: userId,
        p_agent_id: this.agentId,
        p_curr: currency,
        p_amount: parseFloat(amount)
      });

      if (error) {
        throw new Error(`Failed to create pending cash-in: ${error.message}`);
      }

      const requestId = data?.[0]?.request_id;

      console.log('✅ Pending cash-in created:', {
        requestId: requestId,
        userAccount: userAccountId,
        amount: amount,
        currency: currency,
        agentId: this.agentId
      });

      return {
        success: true,
        status: 'pending_user_confirmation',
        requestId: requestId,
        userAccount: userAccountId,
        amount: amount,
        currency: currency,
        agentId: this.agentId,
        message: '✅ Pending cash-in created! User will see it and must confirm with their PIN.'
      };

    } catch (error) {
      console.error('❌ Cash-in initiation failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 🔔 APPROVE CASH-IN: User approves the pending request
   * @param {Object} params
   * @param {string} params.requestId - Request ID to approve
   * @param {string} params.userAccountId - User account ID
   * @param {number} params.amount - Amount to transfer
   * @param {string} params.currency - Currency
   */
  async approveCashIn(params) {
    const { requestId, userAccountId, amount, currency } = params;

    try {
      if (!requestId || !userAccountId || !amount || !currency) {
        throw new Error('Missing required fields');
      }

      // Get user UUID
      const { data: userAccount, error: lookupError } = await this.supabase
        .from('user_accounts')
        .select('user_id')
        .ilike('account_number', userAccountId)
        .single();

      if (lookupError || !userAccount) {
        throw new Error(`User account ${userAccountId} not found`);
      }

      const userId = userAccount.user_id;

      // ============================================
      // Step 2: APPROVE & PROCESS (Deduct from wallet, add to agent)
      // ============================================
      console.log('✅ Step 2: Approving and processing cash-in...');
      const { data: approvalData, error: approvalError } = await this.supabase
        .rpc('approve_cash_in', {
          p_request_id: requestId,
          p_user_id: userId,
          p_agent_id: this.agentId,
          p_curr: currency,
          p_amount: parseFloat(amount)
        });

      if (approvalError) {
        console.error('❌ Failed to approve cash-in:', approvalError);
        throw new Error(`Approval failed: ${approvalError.message}`);
      }

      const approval = approvalData && approvalData.length > 0 ? approvalData[0] : null;

      if (!approval || !approval.success) {
        throw new Error(approval?.message || 'Approval failed');
      }

      console.log('✅ Cash-in approved and processed:', {
        userBalance: approval.user_balance,
        agentBalance: approval.agent_balance,
        amount: amount,
        currency: currency
      });

      return {
        success: true,
        requestId: requestId,
        status: 'completed',
        userBalance: approval.user_balance,
        agentBalance: approval.agent_balance,
        amount: amount,
        currency: currency,
        message: `✅ Cash-in completed! User: ${approval.user_balance} ${currency}, Agent: ${approval.agent_balance} ${currency}`
      };

    } catch (error) {
      console.error('❌ Cash-in approval failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 🔐 APPROVE CASH-IN WITH PIN: User approves with PIN verification
   * @param {Object} params
   * @param {string} params.requestId - Request ID to approve
   * @param {string} params.userAccountId - User account ID
   * @param {string} params.pin - User's PIN
   * @param {number} params.amount - Amount to transfer
   * @param {string} params.currency - Currency
   */
  async approveCashInWithPin(params) {
    const { requestId, userAccountId, pin, amount, currency } = params;

    try {
      if (!requestId || !userAccountId || !pin || !amount || !currency) {
        throw new Error('Missing required fields: request ID, account, PIN, amount, currency');
      }

      if (pin.length !== 4 || !/^\d+$/.test(pin)) {
        throw new Error('PIN must be 4 digits');
      }

      // Get user UUID
      const { data: userAccount, error: lookupError } = await this.supabase
        .from('user_accounts')
        .select('user_id')
        .ilike('account_number', userAccountId)
        .single();

      if (lookupError || !userAccount) {
        throw new Error(`User account ${userAccountId} not found`);
      }

      const userId = userAccount.user_id;

      // ============================================
      // Step 2: APPROVE WITH PIN VERIFICATION
      // ============================================
      console.log('🔐 Step 2: Verifying PIN and processing cash-in...');
      const hashedPin = hashPIN(pin); // Hash PIN before sending to backend
      const { data: approvalData, error: approvalError } = await this.supabase
        .rpc('approve_cash_in_with_pin', {
          p_request_id: requestId,
          p_user_id: userId,
          p_agent_id: this.agentId,
          p_pin_attempt: hashedPin,
          p_curr: currency,
          p_amount: parseFloat(amount)
        });

      if (approvalError) {
        console.error('❌ Failed to approve cash-in with PIN:', approvalError);
        throw new Error(`PIN verification failed: ${approvalError.message}`);
      }

      const approval = approvalData && approvalData.length > 0 ? approvalData[0] : null;

      if (!approval || !approval.success) {
        console.warn('⚠️ PIN verification result:', approval?.message);
        return {
          success: false,
          error: approval?.message || 'PIN verification failed',
          pinValid: false
        };
      }

      console.log('✅ PIN verified and cash-in processed:', {
        userBalance: approval.user_balance,
        agentBalance: approval.agent_balance,
        amount: amount,
        currency: currency
      });

      return {
        success: true,
        pinValid: true,
        requestId: requestId,
        status: 'completed',
        userBalance: approval.user_balance,
        agentBalance: approval.agent_balance,
        amount: amount,
        currency: currency,
        message: `✅ PIN verified! Cash-in completed! User: ${approval.user_balance} ${currency}, Agent: ${approval.agent_balance} ${currency}`
      };

    } catch (error) {
      console.error('❌ Cash-in approval with PIN failed:', error);
      return { success: false, pinValid: false, error: error.message };
    }
  }

  /**
   * ❌ REJECT CASH-IN: User rejects the pending request
   * @param {string} requestId - Request ID to reject
   */
  async rejectCashIn(requestId) {
    try {
      if (!requestId) {
        throw new Error('Request ID is required');
      }

      const { data: rejectData, error: rejectError } = await this.supabase
        .rpc('reject_cash_in', {
          p_request_id: requestId
        });

      if (rejectError) {
        throw new Error(`Rejection failed: ${rejectError.message}`);
      }

      console.log('✅ Cash-in request rejected:', requestId);
      return {
        success: true,
        requestId: requestId,
        status: 'rejected',
        message: 'Cash-in request rejected'
      };

    } catch (error) {
      console.error('❌ Cash-in rejection failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 💸 CASH-OUT: Agent gives physical cash and debits user's digital wallet
   * @param {Object} params
   * @param {string} params.userAccountId - Customer account ID
   * @param {number} params.amount - Cash amount to give
   * @param {string} params.currency - 'USD' or 'UGX'
   */
  async processCashOut(params) {
    const { userAccountId, amount, currency } = params;

    try {
      // Validate
      if (!userAccountId || !amount || !currency) {
        throw new Error('Missing required fields: Account Number, amount, currency');
      }

      if (amount <= 0) {
        throw new Error('Amount must be greater than 0');
      }

      // ============================================
      // FIND USER BY ACCOUNT NUMBER
      // ============================================
      const { data: userAccount, error: accountError } = await this.supabase
        .from('user_accounts')
        .select('id, user_id')
        .ilike('account_number', userAccountId)
        .single();

      if (accountError || !userAccount) {
        throw new Error(`Account not found: ${userAccountId}`);
      }

      const userId = userAccount.user_id;

      // ============================================
      // GET USER'S WALLET
      // ============================================
      // CRITICAL: Check authentication BEFORE querying
      const { data: { user: authUser }, error: authError } = await this.supabase.auth.getUser();
      if (authError || !authUser) {
        throw new Error('User not authenticated');
      }

      const { data: userWallet, error: walletError } = await this.supabase
        .from('wallet_accounts')
        .select('*')
        .eq('user_id', userId)
        .eq('currency', currency)
        .single();

      if (walletError || !userWallet) {
        throw new Error(`User wallet not found for ${currency}`);
      }

      // ============================================
      // COMMISSION CALCULATION
      // ============================================
      const { data: agent, error: agentError } = await this.supabase
        .from('agents')
        .select('withdrawal_commission_percentage')
        .eq('id', this.agentId)
        .single();

      if (agentError) throw agentError;

      const commissionPercentage = agent.withdrawal_commission_percentage || 2.5;
      const commissionAmount = (amount * commissionPercentage) / 100;
      const netAmount = amount - commissionAmount;

      // ============================================
      // CHECK AGENT'S FLOAT
      // ============================================
      const { data: agentFloat, error: floatError } = await this.supabase
        .from('agent_floats')
        .select('*')
        .eq('agent_id', this.agentId)
        .eq('currency', currency)
        .single();

      if (floatError || !agentFloat) {
        throw new Error(`Agent float not found for ${currency}`);
      }

      if (agentFloat.current_balance < amount) {
        return {
          success: false,
          error: `Insufficient float. Available: ${agentFloat.current_balance}, Needed: ${amount}`,
          availableBalance: agentFloat.current_balance
        };
      }

      // ============================================
      // TRANSFER: Deduct from agent float, add to user wallet
      // ============================================

      // 1. Reduce agent's float
      const { error: floatUpdateError } = await this.supabase
        .from('agent_floats')
        .update({
          current_balance: agentFloat.current_balance - amount,
          total_withdrawn: (agentFloat.total_withdrawn || 0) + amount,
          updated_at: new Date().toISOString()
        })
        .eq('id', agentFloat.id);

      if (floatUpdateError) throw floatUpdateError;

      // 2. Add to user's wallet
      const { error: walletUpdateError } = await this.supabase
        .from('wallet_accounts')
        .update({
          balance: userWallet.balance + amount,
          updated_at: new Date().toISOString()
        })
        .eq('id', userWallet.id);

      if (walletUpdateError) throw walletUpdateError;

      // 3. Update user's account balance (for quick access)
      const balanceColumn = currency === 'USD' ? 'usd_balance' : currency === 'UGX' ? 'ugx_balance' : 'kes_balance';
      const { data: currentAccount } = await this.supabase
        .from('user_accounts')
        .select(balanceColumn)
        .eq('user_id', userId)
        .single();
      
      if (currentAccount) {
        const currentBalance = parseFloat(currentAccount[balanceColumn]) || 0;
        const newBalance = currentBalance + parseFloat(amount);
        const updateQuery = {};
        updateQuery[balanceColumn] = newBalance;
        updateQuery['updated_at'] = new Date().toISOString();
        
        const { error: accountUpdateError } = await this.supabase
          .from('user_accounts')
          .update(updateQuery)
          .eq('user_id', userId);

        if (accountUpdateError) {
          console.warn('⚠️ Could not update user_accounts balance:', accountUpdateError);
        }
      }

      // 4. Record transaction
      const referenceNumber = `CASH-OUT-${Date.now()}`;
      const { data: transaction, error: txError } = await this.supabase
        .from('agent_transactions')
        .insert([{
          agent_id: this.agentId,
          user_id: userId,
          transaction_type: 'cash_out',
          amount: parseFloat(amount),
          currency: currency,
          commission_amount: parseFloat(commissionAmount),
          net_amount: parseFloat(netAmount),
          user_account_id: userAccountId,
          reference_number: referenceNumber,
          status: 'completed',
          completed_at: new Date().toISOString()
        }])
        .select();

      if (txError) throw txError;

      console.log('✅ Cash-Out processed successfully:', transaction[0]);
      return {
        success: true,
        transactionId: transaction[0].id,
        referenceNumber: referenceNumber,
        amount: amount,
        currency: currency,
        commissionEarned: commissionAmount,
        netAmount: netAmount,
        newAgentBalance: agentFloat.current_balance + netAmount,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error('❌ Cash-Out failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * ⬆️ FLOAT TOP-UP: Agent refills digital liquidity via MOMO
   * @param {Object} params
   * @param {number} params.amount - Top-up amount
   * @param {string} params.currency - 'USD' or 'UGX'
   * @param {string} params.phoneNumber - Agent's MOMO phone
   */
  async processFloatTopUp(params) {
    const { amount, currency, phoneNumber } = params;

    try {
      if (!amount || !currency || !phoneNumber) {
        throw new Error('Missing required fields');
      }

      // Validate currency
      if (!['USD', 'UGX'].includes(currency)) {
        throw new Error('Currency must be USD or UGX');
      }

      // Get agent's float account
      const { data: agentFloat, error: floatError } = await this.supabase
        .from('agent_floats')
        .select('*')
        .eq('agent_id', this.agentId)
        .eq('currency', currency)
        .single();

      if (floatError) {
        // Create new float account if doesn't exist
        const { data: newFloat, error: createError } = await this.supabase
          .from('agent_floats')
          .insert([{
            agent_id: this.agentId,
            currency: currency,
            current_balance: 0
          }])
          .select();

        if (createError) throw createError;
      }

      // Create MOMO Request to Pay
      const referenceNumber = `TOPUP-${Date.now()}`;
      const { data: transaction, error: txError } = await this.supabase
        .from('agent_transactions')
        .insert([{
          agent_id: this.agentId,
          transaction_type: 'float_topup',
          amount: parseFloat(amount),
          currency: currency,
          reference_number: referenceNumber,
          status: 'pending', // Waiting for MOMO confirmation
          metadata: {
            phoneNumber,
            momoRequestCreatedAt: new Date().toISOString()
          }
        }])
        .select();

      if (txError) throw txError;

      console.log('✅ Float top-up initiated:', transaction[0]);
      return {
        success: true,
        transactionId: transaction[0].id,
        referenceNumber: referenceNumber,
        amount: amount,
        currency: currency,
        status: 'pending',
        message: `MOMO Request to Pay sent to ${phoneNumber}. Please enter your PIN.`
      };

    } catch (error) {
      console.error('❌ Float top-up failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Confirm float top-up after MOMO payment
   */
  async confirmFloatTopUp(transactionId) {
    try {
      // Get transaction
      const { data: transaction, error: txError } = await this.supabase
        .from('agent_transactions')
        .select('*')
        .eq('id', transactionId)
        .single();

      if (txError) throw txError;

      // Update agent float
      const { data: agentFloat } = await this.supabase
        .from('agent_floats')
        .select('*')
        .eq('agent_id', this.agentId)
        .eq('currency', transaction.currency)
        .single();

      const { error: updateError } = await this.supabase
        .from('agent_floats')
        .update({
          current_balance: (agentFloat.current_balance || 0) + transaction.amount,
          total_topups: (agentFloat.total_topups || 0) + transaction.amount,
          last_topup_amount: transaction.amount,
          last_topup_at: new Date().toISOString()
        })
        .eq('id', agentFloat.id);

      if (updateError) throw updateError;

      // Mark transaction as completed
      const { error: completeError } = await this.supabase
        .from('agent_transactions')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString()
        })
        .eq('id', transactionId);

      if (completeError) throw completeError;

      console.log('✅ Float top-up confirmed');
      return {
        success: true,
        newBalance: (agentFloat.current_balance || 0) + transaction.amount,
        amount: transaction.amount,
        currency: transaction.currency
      };

    } catch (error) {
      console.error('❌ Float top-up confirmation failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 📊 Get agent's current float balances (USD & UGX)
   */
  async getFloatBalances() {
    try {
      const { data: floats, error } = await this.supabase
        .from('agent_floats')
        .select('*')
        .eq('agent_id', this.agentId);

      if (error) throw error;

      const balances = {
        USD: floats.find(f => f.currency === 'USD') || { current_balance: 0 },
        UGX: floats.find(f => f.currency === 'UGX') || { current_balance: 0 }
      };

      return balances;

    } catch (error) {
      console.error('❌ Failed to get float balances:', error);
      return null;
    }
  }

  /**
   * 📜 Get recent transactions for settlement
   */
  async getRecentTransactions(limit = 50) {
    try {
      const { data: transactions, error } = await this.supabase
        .from('agent_transactions')
        .select('*')
        .eq('agent_id', this.agentId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return transactions || [];

    } catch (error) {
      console.error('❌ Failed to get transactions:', error);
      return [];
    }
  }

  /**
   * ✅ Submit settlement for current shift
   */
  async submitSettlement(params) {
    const { usdClosing, ugxClosing, shiftNumber, notes } = params;

    try {
      // Get current shift's opening balances
      const { data: floats } = await this.supabase
        .from('agent_floats')
        .select('*')
        .eq('agent_id', this.agentId);

      // Calculate totals
      const transactions = await this.getRecentTransactions(1000);
      const today = new Date().toDateString();
      const todayTransactions = transactions.filter(t => 
        new Date(t.created_at).toDateString() === today
      );

      const usdCashIn = todayTransactions
        .filter(t => t.currency === 'USD' && t.transaction_type === 'cash_in')
        .reduce((sum, t) => sum + t.amount, 0);

      const usdCashOut = todayTransactions
        .filter(t => t.currency === 'USD' && t.transaction_type === 'cash_out')
        .reduce((sum, t) => sum + t.amount, 0);

      const ugxCashIn = todayTransactions
        .filter(t => t.currency === 'UGX' && t.transaction_type === 'cash_in')
        .reduce((sum, t) => sum + t.amount, 0);

      const ugxCashOut = todayTransactions
        .filter(t => t.currency === 'UGX' && t.transaction_type === 'cash_out')
        .reduce((sum, t) => sum + t.amount, 0);

      // Submit settlement
      const { data: settlement, error } = await this.supabase
        .from('agent_settlements')
        .insert([{
          agent_id: this.agentId,
          settlement_date: new Date().toISOString().split('T')[0],
          shift_number: shiftNumber || 1,
          usd_cash_in_total: usdCashIn,
          usd_cash_out_total: usdCashOut,
          usd_closing_balance: parseFloat(usdClosing),
          ugx_cash_in_total: ugxCashIn,
          ugx_cash_out_total: ugxCashOut,
          ugx_closing_balance: parseFloat(ugxClosing),
          status: 'submitted',
          submitted_at: new Date().toISOString(),
          notes
        }])
        .select();

      if (error) throw error;

      console.log('✅ Settlement submitted:', settlement[0]);
      return { success: true, settlement: settlement[0] };

    } catch (error) {
      console.error('❌ Settlement failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get agent details
   * @param {string} agentId - Agent ID
   * @returns {Promise<Object>} Agent details
   */
  async getAgentDetails(agentId) {
    try {
      this.supabase = getSupabaseClient();

      const { data, error } = await this.supabase
        .from('agents')
        .select('*')
        .eq('id', agentId)
        .single();

      if (error) {
        console.error('❌ Error fetching agent details:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('❌ Error in getAgentDetails:', error);
      return null;
    }
  }

  /**
   * Update agent profile
   * @param {string} agentId - Agent ID
   * @param {Object} params - Fields to update
   * @returns {Promise<Object>} Updated agent data
   */
  async updateAgentProfile(agentId, params) {
    try {
      this.supabase = getSupabaseClient();

      const updateData = {};

      // Only add provided fields
      if (params.agentName) updateData.agent_name = params.agentName;
      if (params.phoneNumber) updateData.phone_number = params.phoneNumber;
      if (params.locationCity) updateData.location_city = params.locationCity;
      if (params.locationName) updateData.location_name = params.locationName;

      if (Object.keys(updateData).length === 0) {
        return {
          success: false,
          error: 'No fields to update'
        };
      }

      const { data, error } = await this.supabase
        .from('agents')
        .update(updateData)
        .eq('id', agentId)
        .select()
        .single();

      if (error) {
        console.error('❌ Error updating agent profile:', error);
        return {
          success: false,
          error: error.message
        };
      }

      return {
        success: true,
        data: data
      };
    } catch (error) {
      console.error('❌ Error in updateAgentProfile:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 🔐 WITHDRAWAL WITH PIN
   */
  async processWithdrawalWithPin(params) {
    const { userAccountId, pin, amount, currency } = params;

    try {
      if (!userAccountId || !pin || !amount || !currency) {
        throw new Error('Missing required fields');
      }

      const { data: userAccount } = await this.supabase
        .from('user_accounts')
        .select('user_id')
        .ilike('account_number', userAccountId)
        .single();

      if (!userAccount) throw new Error('User account not found');

      const { data: result, error } = await this.supabase.rpc('process_withdrawal_with_pin', {
        p_user_id: userAccount.user_id,
        p_agent_id: this.agentId,
        p_pin_attempt: pin,
        p_curr: currency,
        p_amount: parseFloat(amount)
      });

      if (error) throw new Error(`Withdrawal failed: ${error.message}`);

      const data = result && result.length > 0 ? result[0] : null;
      if (!data?.success) {
        return { success: false, pinValid: false, error: data?.message };
      }

      console.log('✅ Withdrawal with PIN verified:', data);
      return { success: true, pinValid: true, ...data };
    } catch (error) {
      console.error('❌ Withdrawal with PIN failed:', error);
      return { success: false, pinValid: false, error: error.message };
    }
  }

  /**
   * 💳 DEPOSIT WITH PIN
   */
  async processDepositWithPin(params) {
    const { userAccountId, pin, amount, currency } = params;

    try {
      if (!userAccountId || !pin || !amount || !currency) {
        throw new Error('Missing required fields');
      }

      const { data: userAccount } = await this.supabase
        .from('user_accounts')
        .select('user_id')
        .ilike('account_number', userAccountId)
        .single();

      if (!userAccount) throw new Error('User account not found');

      const { data: result, error } = await this.supabase.rpc('process_deposit_with_pin', {
        p_user_id: userAccount.user_id,
        p_agent_id: this.agentId,
        p_pin_attempt: pin,
        p_curr: currency,
        p_amount: parseFloat(amount)
      });

      if (error) throw new Error(`Deposit failed: ${error.message}`);

      const data = result && result.length > 0 ? result[0] : null;
      if (!data?.success) {
        return { success: false, pinValid: false, error: data?.message };
      }

      console.log('✅ Deposit with PIN verified:', data);
      return { success: true, pinValid: true, ...data };
    } catch (error) {
      console.error('❌ Deposit with PIN failed:', error);
      return { success: false, pinValid: false, error: error.message };
    }
  }

  /**
   * 💸 CASH-OUT WITH PIN
   */
  async processCashOutWithPin(params) {
    const { userAccountId, pin, amount, currency } = params;

    try {
      if (!userAccountId || !pin || !amount || !currency) {
        throw new Error('Missing required fields');
      }

      const { data: userAccount } = await this.supabase
        .from('user_accounts')
        .select('user_id')
        .ilike('account_number', userAccountId)
        .single();

      if (!userAccount) throw new Error('User account not found');

      const hashedPin = hashPIN(pin); // Hash PIN before sending to backend
      const { data: result, error } = await this.supabase.rpc('process_cashout_with_pin', {
        p_user_id: userAccount.user_id,
        p_agent_id: this.agentId,
        p_pin_attempt: hashedPin,
        p_curr: currency,
        p_amount: parseFloat(amount)
      });

      if (error) throw new Error(`Cash-out failed: ${error.message}`);

      const data = result && result.length > 0 ? result[0] : null;
      if (!data?.success) {
        return { success: false, pinValid: false, error: data?.message };
      }

      console.log('✅ Cash-out with PIN verified:', data);
      return { success: true, pinValid: true, ...data };
    } catch (error) {
      console.error('❌ Cash-out with PIN failed:', error);
      return { success: false, pinValid: false, error: error.message };
    }
  }

  /**
   * Update agent profile
   * @param {string} agentId - Agent ID
   * @param {Object} params - Fields to update
   * @returns {Promise<Object>} Updated agent data
   */
  async updateAgentProfile(agentId, params) {
    try {
      this.supabase = getSupabaseClient();

      const updateData = {};

      // Only add provided fields
      if (params.agentName) updateData.agent_name = params.agentName;
      if (params.phoneNumber) updateData.phone_number = params.phoneNumber;
      if (params.locationCity) updateData.location_city = params.locationCity;
      if (params.locationName) updateData.location_name = params.locationName;

      if (Object.keys(updateData).length === 0) {
        return {
          success: false,
          error: 'No fields to update'
        };
      }

      const { data, error } = await this.supabase
        .from('agents')
        .update(updateData)
        .eq('id', agentId)
        .select()
        .single();

      if (error) {
        console.error('❌ Error updating agent profile:', error);
        return {
          success: false,
          error: error.message
        };
      }

      console.log('✅ Agent profile updated successfully');
      return {
        success: true,
        agent: data,
        message: 'Agent profile updated successfully'
      };
    } catch (error) {
      console.error('❌ Error in updateAgentProfile:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Update agent commissions
   * @param {string} agentId - Agent ID
   * @param {Object} params - Commission rates
   * @returns {Promise<Object>} Updated agent data
   */
  async updateAgentCommissions(agentId, params) {
    try {
      const { withdrawalCommission, depositCommission, fxMargin } = params;

      if (withdrawalCommission < 0 || depositCommission < 0 || fxMargin < 0) {
        return {
          success: false,
          error: 'Commission rates cannot be negative'
        };
      }

      this.supabase = getSupabaseClient();

      const { data, error } = await this.supabase
        .from('agents')
        .update({
          withdrawal_commission_percentage: withdrawalCommission,
          deposit_commission_percentage: depositCommission,
          fx_margin_percentage: fxMargin
        })
        .eq('id', agentId)
        .select()
        .single();

      if (error) {
        return {
          success: false,
          error: error.message
        };
      }

      console.log('✅ Agent commissions updated');
      return {
        success: true,
        agent: data,
        message: 'Agent commissions updated successfully'
      };
    } catch (error) {
      console.error('❌ Error in updateAgentCommissions:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

export default new AgentService();

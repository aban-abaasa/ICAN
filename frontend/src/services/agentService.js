/**
 * 🏪 AGENT SERVICE
 * Handles dual-currency agent operations: Cash-In, Cash-Out, Float Management
 */

import { getSupabaseClient } from '../lib/supabase/client';

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

      if (!['USD', 'UGX'].includes(currency)) {
        throw new Error('Currency must be USD or UGX');
      }

      if (amount <= 0) {
        throw new Error('Amount must be greater than 0');
      }

      // ============================================
      // LIQUIDITY GUARD: Check agent's float
      // ============================================
      const { data: agentFloat, error: floatError } = await this.supabase
        .from('agent_floats')
        .select('*')
        .eq('agent_id', this.agentId)
        .eq('currency', currency)
        .single();

      if (floatError || !agentFloat) {
        throw new Error(`No ${currency} float account found for agent`);
      }

      if (agentFloat.is_frozen) {
        throw new Error(`${currency} float is frozen: ${agentFloat.frozen_reason}`);
      }

      if (agentFloat.current_balance < amount) {
        return {
          success: false,
          error: `Insufficient ${currency} float. Available: ${agentFloat.current_balance}, Needed: ${amount}`,
          availableBalance: agentFloat.current_balance,
          shortfall: amount - agentFloat.current_balance
        };
      }

      // ============================================
      // DUAL-LEDGER: Deduct from agent, add to user
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
      const { error: walletError } = await this.supabase
        .from('user_wallets')
        .update({
          balance: `balance + ${amount}`,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userAccountId)
        .eq('currency', currency);

      if (walletError) throw walletError;

      // 3. Record transaction
      const referenceNumber = `CASH-IN-${Date.now()}`;
      const { data: transaction, error: txError } = await this.supabase
        .from('agent_transactions')
        .insert([{
          agent_id: this.agentId,
          user_id: userAccountId,
          transaction_type: 'cash_in',
          amount: parseFloat(amount),
          currency: currency,
          commission_amount: 0, // 0% deposit fee
          net_amount: parseFloat(amount),
          user_account_id: userAccountId,
          reference_number: referenceNumber,
          status: 'completed',
          completed_at: new Date().toISOString(),
          metadata: { description }
        }])
        .select();

      if (txError) throw txError;

      console.log('✅ Cash-In processed successfully:', transaction[0]);
      return {
        success: true,
        transactionId: transaction[0].id,
        referenceNumber: referenceNumber,
        amount: amount,
        currency: currency,
        userAccount: userAccountId,
        newAgentBalance: agentFloat.current_balance - amount,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error('❌ Cash-In failed:', error);
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
        throw new Error('Missing required fields');
      }

      if (amount <= 0) {
        throw new Error('Amount must be greater than 0');
      }

      // ============================================
      // ID VERIFICATION: Ensure user exists
      // ============================================
      const { data: userWallet, error: userError } = await this.supabase
        .from('user_wallets')
        .select('*')
        .eq('user_id', userAccountId)
        .eq('currency', currency)
        .single();

      if (userError || !userWallet) {
        throw new Error('User wallet not found');
      }

      if (userWallet.balance < amount) {
        return {
          success: false,
          error: `User has insufficient balance. Available: ${userWallet.balance}, Requested: ${amount}`,
          userBalance: userWallet.balance
        };
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
      // DUAL-LEDGER: Deduct from user, add to agent
      // ============================================

      // 1. Reduce user's wallet
      const { error: userUpdateError } = await this.supabase
        .from('user_wallets')
        .update({
          balance: userWallet.balance - amount,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userAccountId)
        .eq('currency', currency);

      if (userUpdateError) throw userUpdateError;

      // 2. Increase agent's float (they now have more cash)
      const { data: agentFloat, error: floatError } = await this.supabase
        .from('agent_floats')
        .select('*')
        .eq('agent_id', this.agentId)
        .eq('currency', currency)
        .single();

      if (floatError) throw floatError;

      const { error: agentFloatUpdateError } = await this.supabase
        .from('agent_floats')
        .update({
          current_balance: agentFloat.current_balance + netAmount,
          total_deposited: (agentFloat.total_deposited || 0) + amount,
          updated_at: new Date().toISOString()
        })
        .eq('id', agentFloat.id);

      if (agentFloatUpdateError) throw agentFloatUpdateError;

      // 3. Record transaction
      const referenceNumber = `CASH-OUT-${Date.now()}`;
      const { data: transaction, error: txError } = await this.supabase
        .from('agent_transactions')
        .insert([{
          agent_id: this.agentId,
          user_id: userAccountId,
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

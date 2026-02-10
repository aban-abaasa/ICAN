/**
 * 🏦 GROUP WALLET ACCOUNT SERVICE
 * Manages ICAN wallets for Trust Groups
 * PIN management, wallet creation, transaction handling
 */

import { getSupabaseClient } from '../lib/supabase/client';

// PIN hashing function (same as walletAccountService for consistency)
const hashPIN = (pin) => {
  let hash = 0;
  const string = `pin-${pin}-salt-ican-group-hash`;
  
  for (let i = 0; i < string.length; i++) {
    const char = string.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  
  return btoa(`group-hash-${Math.abs(hash)}-${pin.length}`);
};

const verifyPIN = (pin, hash) => {
  return hashPIN(pin) === hash;
};

class GroupWalletAccountService {
  constructor() {
    this.supabase = null;
  }

  /**
   * Generate unique group account number
   * Format: ICAN-GROUP-XXXXXXXXXXXXX
   */
  generateGroupAccountNumber() {
    const digits = Math.floor(Math.random() * 10000000000000000)
      .toString()
      .padStart(16, '0');
    return `ICAN-GROUP-${digits}`;
  }

  /**
   * Validate PIN format (4-6 digits)
   */
  validatePIN(pin) {
    const pinRegex = /^\d{4,6}$/;
    return pinRegex.test(pin);
  }

  /**
   * Check if group already has a wallet
   * @param {string} groupId - Group ID from trust_groups
   * @returns {Promise<Object>} Account data if exists, null if not
   */
  async checkGroupWallet(groupId) {
    try {
      this.supabase = getSupabaseClient();

      const { data, error } = await this.supabase
        .from('group_accounts')
        .select('*')
        .eq('group_id', groupId)
        .eq('status', 'active')
        .limit(1);

      if (error) {
        console.error('❌ Error checking group wallet:', error);
        return null;
      }

      return data && data.length > 0 ? data[0] : null;
    } catch (error) {
      console.error('❌ Error in checkGroupWallet:', error);
      return null;
    }
  }

  /**
   * Create a new wallet for a trust group
   * @param {Object} params - Creation parameters
   */
  async createGroupWallet(params) {
    const {
      groupId,
      creatorId,
      pin,
      approvalThreshold = 60,
      minWithdrawal = 10,
      requiresPin = true
    } = params;

    try {
      // Validate inputs
      if (!groupId || !creatorId || !pin) {
        return {
          success: false,
          error: 'Missing required fields: groupId, creatorId, pin'
        };
      }

      // Validate PIN
      if (!this.validatePIN(pin)) {
        return {
          success: false,
          error: 'PIN must be 4-6 digits'
        };
      }

      this.supabase = getSupabaseClient();

      // Check if group already has a wallet
      const existingWallet = await this.checkGroupWallet(groupId);
      if (existingWallet) {
        return {
          success: false,
          error: 'Group already has an active wallet',
          account: existingWallet
        };
      }

      // Generate unique account number
      const accountNumber = this.generateGroupAccountNumber();
      const pinHash = hashPIN(pin);

      // Create account
      const { data, error } = await this.supabase
        .from('group_accounts')
        .insert([
          {
            group_id: groupId,
            account_number: accountNumber,
            pin_hash: pinHash,
            account_type: 'group',
            status: 'active',
            balance_ican: 0,
            creator_id: creatorId,
            approval_threshold: approvalThreshold,
            min_withdrawal: minWithdrawal,
            requires_mfa: requiresPin
          }
        ])
        .select()
        .single();

      if (error) {
        console.error('❌ Error creating group wallet:', error);
        return {
          success: false,
          error: error.message
        };
      }

      // Create default settings
      await this.createWalletSettings(data.id, groupId);

      console.log('✅ Group wallet created:', data.account_number);
      return {
        success: true,
        account: data
      };
    } catch (error) {
      console.error('❌ Error in createGroupWallet:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Create default settings for group wallet
   */
  async createWalletSettings(groupAccountId, groupId) {
    try {
      this.supabase = getSupabaseClient();

      const { data, error } = await this.supabase
        .from('group_wallet_settings')
        .insert([
          {
            group_account_id: groupAccountId,
            group_id: groupId,
            require_pin_for_deposit: false,
            require_pin_for_withdrawal: true,
            require_pin_for_member_removal: true,
            notify_on_deposit: true,
            notify_on_withdrawal: true,
            notify_on_low_balance: true,
            auto_reconcile: true
          }
        ])
        .select();

      return error ? null : data;
    } catch (error) {
      console.error('❌ Error creating wallet settings:', error);
      return null;
    }
  }

  /**
   * Verify group wallet PIN
   * @param {string} groupId - Group ID
   * @param {string} pin - PIN to verify
   * @returns {Promise<Object>} {success: boolean, error?: string}
   */
  async verifyGroupPIN(groupId, pin) {
    try {
      this.supabase = getSupabaseClient();

      // Get wallet
      const { data: accounts, error: getError } = await this.supabase
        .from('group_accounts')
        .select('*')
        .eq('group_id', groupId)
        .eq('status', 'active')
        .limit(1);

      if (getError || !accounts || accounts.length === 0) {
        return {
          success: false,
          error: 'Group wallet not found'
        };
      }

      const account = accounts[0];

      // Check if account is locked
      if (account.pin_locked_until && new Date(account.pin_locked_until) > new Date()) {
        return {
          success: false,
          error: 'Account is temporarily locked due to too many PIN attempts',
          locked_until: account.pin_locked_until
        };
      }

      // Verify PIN
      const isValid = verifyPIN(pin, account.pin_hash);

      if (!isValid) {
        // Increment failed attempts
        const newAttempts = (account.pin_attempts || 0) + 1;
        const lockUntil = newAttempts >= 3 ? new Date(Date.now() + 15 * 60000) : null; // Lock for 15 mins

        await this.supabase
          .from('group_accounts')
          .update({
            pin_attempts: newAttempts,
            pin_locked_until: lockUntil
          })
          .eq('id', account.id);

        return {
          success: false,
          error: `Invalid PIN. ${3 - newAttempts} attempts remaining`,
          attempts_remaining: 3 - newAttempts
        };
      }

      // Reset failed attempts on success
      await this.supabase
        .from('group_accounts')
        .update({
          pin_attempts: 0,
          pin_locked_until: null
        })
        .eq('id', account.id);

      return {
        success: true,
        account: account
      };
    } catch (error) {
      console.error('❌ Error verifying PIN:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Change group wallet PIN
   * @param {string} groupId - Group ID
   * @param {string} currentPin - Current PIN for verification
   * @param {string} newPin - New PIN to set
   * @param {string} userId - User making the change
   */
  async changeGroupPIN(groupId, currentPin, newPin, userId) {
    try {
      // Validate new PIN
      if (!this.validatePIN(newPin)) {
        return {
          success: false,
          error: 'New PIN must be 4-6 digits'
        };
      }

      // Verify current PIN
      const verification = await this.verifyGroupPIN(groupId, currentPin);
      if (!verification.success) {
        return verification;
      }

      this.supabase = getSupabaseClient();
      const account = verification.account;

      // Hash new PIN
      const newPinHash = hashPIN(newPin);

      // Update PIN
      const { error: updateError } = await this.supabase
        .from('group_accounts')
        .update({
          pin_hash: newPinHash,
          pin_attempts: 0,
          pin_locked_until: null
        })
        .eq('id', account.id);

      if (updateError) {
        return {
          success: false,
          error: updateError.message
        };
      }

      // Record PIN change in audit log
      await this.recordPINChange(account.id, groupId, userId, 'user_request');

      return {
        success: true,
        message: 'PIN changed successfully'
      };
    } catch (error) {
      console.error('❌ Error changing PIN:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Record PIN change in audit trail
   */
  async recordPINChange(groupAccountId, groupId, userId, reason = 'user_request') {
    try {
      this.supabase = getSupabaseClient();

      await this.supabase
        .from('group_pin_changes')
        .insert([
          {
            group_account_id: groupAccountId,
            group_id: groupId,
            changed_by: userId,
            reason: reason,
            status: 'completed'
          }
        ]);
    } catch (error) {
      console.error('❌ Error recording PIN change:', error);
    }
  }

  /**
   * Get group wallet balance
   */
  async getGroupWalletBalance(groupId) {
    try {
      this.supabase = getSupabaseClient();

      const { data, error } = await this.supabase
        .from('group_accounts')
        .select('balance_ican, balance_ican_locked')
        .eq('group_id', groupId)
        .eq('status', 'active')
        .limit(1);

      if (error || !data || data.length === 0) {
        return { balance: 0, locked: 0 };
      }

      return {
        balance: data[0].balance_ican || 0,
        locked: data[0].balance_ican_locked || 0,
        available: (data[0].balance_ican || 0) - (data[0].balance_ican_locked || 0)
      };
    } catch (error) {
      console.error('❌ Error getting wallet balance:', error);
      return { balance: 0, locked: 0, available: 0 };
    }
  }

  /**
   * Get group wallet details
   */
  async getGroupWalletDetails(groupId) {
    try {
      this.supabase = getSupabaseClient();

      const { data, error } = await this.supabase
        .from('group_accounts')
        .select(`
          *,
          group_wallet_settings(*)
        `)
        .eq('group_id', groupId)
        .eq('status', 'active')
        .limit(1);

      if (error || !data || data.length === 0) {
        return null;
      }

      return data[0];
    } catch (error) {
      console.error('❌ Error getting wallet details:', error);
      return null;
    }
  }

  /**
   * Update group wallet settings
   */
  async updateWalletSettings(groupAccountId, settings) {
    try {
      this.supabase = getSupabaseClient();

      const { data, error } = await this.supabase
        .from('group_wallet_settings')
        .update(settings)
        .eq('group_account_id', groupAccountId)
        .select();

      if (error) {
        return {
          success: false,
          error: error.message
        };
      }

      return {
        success: true,
        settings: data[0]
      };
    } catch (error) {
      console.error('❌ Error updating settings:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Log transaction for audit
   */
  async logTransaction(groupId, transactionType, amount, userId, details = {}) {
    try {
      this.supabase = getSupabaseClient();

      // Get group account
      const { data: accounts, error: getError } = await this.supabase
        .from('group_accounts')
        .select('id')
        .eq('group_id', groupId)
        .eq('status', 'active')
        .limit(1);

      if (getError || !accounts || accounts.length === 0) {
        return null;
      }

      // Create transaction record
      const { data, error } = await this.supabase
        .from('group_wallet_transactions')
        .insert([
          {
            group_account_id: accounts[0].id,
            group_id: groupId,
            transaction_type: transactionType,
            amount: amount,
            initiated_by: userId,
            status: 'completed',
            completed_at: new Date(),
            metadata: details
          }
        ])
        .select();

      return error ? null : data[0];
    } catch (error) {
      console.error('❌ Error logging transaction:', error);
      return null;
    }
  }
}

export const groupWalletAccountService = new GroupWalletAccountService();
export default groupWalletAccountService;

/**
 * 🎯 WALLET ACCOUNT SERVICE
 * Manages user wallet account creation, account numbers, PIN, and biometric authentication
 */

import { getSupabaseClient } from '../lib/supabase/client';

// Simple PIN hashing function (browser-compatible)
const hashPIN = (pin) => {
  // For demo: create a simple hash using btoa (base64 encoding)
  // In production, use a proper crypto library
  let hash = 0;
  const string = `pin-${pin}-salt-ican-hash`;
  
  for (let i = 0; i < string.length; i++) {
    const char = string.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  
  return btoa(`hash-${Math.abs(hash)}-${pin.length}`);
};

const verifyPIN = (pin, hash) => {
  return hashPIN(pin) === hash;
};

class WalletAccountService {
  constructor() {
    this.supabase = null;
  }

  /**
   * Generate a unique account number
   * Format: ICAN-XXXXXXXXXXXXX (16 digits total)
   * @returns {string} Unique account number
   */
  generateAccountNumber() {
    // Generate 16 random digits
    const digits = Math.floor(Math.random() * 10000000000000000)
      .toString()
      .padStart(16, '0');
    return `ICAN-${digits}`;
  }

  /**
   * Validate PIN format (4-6 digits)
   * @param {string} pin - PIN to validate
   * @returns {boolean} True if valid
   */
  validatePIN(pin) {
    const pinRegex = /^\d{4,6}$/;
    return pinRegex.test(pin);
  }

  /**
   * Check if user already has a wallet account
   * @param {string} userId - User ID from auth
   * @returns {Promise<Object>} Account data if exists, null if not
   */
  async checkUserAccount(userId) {
    try {
      this.supabase = getSupabaseClient();

      const { data, error } = await this.supabase
        .from('user_accounts')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'active')
        .maybeSingle();

      if (error) {
        console.error('❌ Error checking user account:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('❌ Error in checkUserAccount:', error);
      return null;
    }
  }

  /**
   * Create a new wallet account for user
   * @param {Object} params - Account creation parameters
   * @param {string} params.userId - User ID from auth
   * @param {string} params.accountHolderName - Full name of account holder
   * @param {string} params.phoneNumber - Phone number
   * @param {string} params.email - Email address
   * @param {string} params.pin - 4-6 digit PIN
   * @param {string} params.preferredCurrency - Preferred currency (USD, UGX, KES)
   * @param {Object} params.biometrics - Biometric settings
   * @returns {Promise<Object>} Success/error response with account details
   */
  async createUserAccount(params) {
    const {
      userId,
      accountHolderName,
      phoneNumber,
      email,
      pin,
      preferredCurrency = 'USD',
      biometrics = {}
    } = params;

    try {
      // Validate inputs
      if (!userId || !accountHolderName || !phoneNumber || !email || !pin) {
        return {
          success: false,
          error: 'Missing required fields: userId, accountHolderName, phoneNumber, email, pin'
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

      // Check if user already has an account
      const existingAccount = await this.checkUserAccount(userId);
      if (existingAccount) {
        return {
          success: false,
          error: 'User already has an active wallet account',
          account: existingAccount
        };
      }

      // Generate unique account number
      const accountNumber = this.generateAccountNumber();
      const pinHash = hashPIN(pin);

      // Create account
      const { data, error } = await this.supabase
        .from('user_accounts')
        .insert([
          {
            user_id: userId,
            account_number: accountNumber,
            account_type: 'personal',
            status: 'active',
            account_holder_name: accountHolderName,
            phone_number: phoneNumber,
            email: email,
            pin_hash: pinHash,
            pin_created_at: new Date().toISOString(),
            preferred_currency: preferredCurrency,
            fingerprint_enabled: biometrics.fingerprintEnabled || false,
            phone_pin_enabled: biometrics.phonePhoneEnabled || false,
            biometric_enabled: (biometrics.fingerprintEnabled || biometrics.phonePhoneEnabled) || false,
            kyc_verified: false,
            usd_balance: 0,
            ugx_balance: 0,
            kes_balance: 0,
            daily_limit: 10000,
            monthly_limit: 100000,
            allow_agent_transfers: true,
            metadata: {
              created_via: 'mobile_app',
              device_type: 'mobile'
            }
          }
        ])
        .select()
        .single();

      if (error) {
        console.error('❌ Error creating user account:', error);
        return {
          success: false,
          error: error.message || 'Failed to create wallet account'
        };
      }

      console.log('✅ Wallet account created successfully:', {
        accountNumber: data.account_number,
        userId: data.user_id,
        accountHolder: data.account_holder_name
      });

      return {
        success: true,
        account: data,
        message: 'Wallet account created successfully'
      };
    } catch (error) {
      console.error('❌ Error in createUserAccount:', error);
      return {
        success: false,
        error: error.message || 'An error occurred while creating wallet account'
      };
    }
  }

  /**
   * Get user's account details
   * @param {string} userId - User ID from auth
   * @returns {Promise<Object>} Account details
   */
  async getUserAccount(userId) {
    try {
      this.supabase = getSupabaseClient();

      const { data, error } = await this.supabase
        .from('user_accounts')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) {
        console.error('❌ Error fetching user account:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('❌ Error in getUserAccount:', error);
      return null;
    }
  }

  /**
   * Verify PIN for user
   * @param {string} userId - User ID
   * @param {string} pin - PIN to verify
   * @returns {Promise<Object>} Success/error response
   */
  async verifyUserPIN(userId, pin) {
    try {
      if (!this.validatePIN(pin)) {
        return {
          success: false,
          error: 'Invalid PIN format'
        };
      }

      const account = await this.getUserAccount(userId);
      
      if (!account) {
        return {
          success: false,
          error: 'Account not found'
        };
      }

      // Check if account is locked
      if (account.pin_locked_until && new Date(account.pin_locked_until) > new Date()) {
        return {
          success: false,
          error: 'Account locked due to too many failed PIN attempts. Try again later.'
        };
      }

      // Verify PIN
      if (verifyPIN(pin, account.pin_hash)) {
        // Reset attempts on successful verification
        this.supabase = getSupabaseClient();
        await this.supabase
          .from('user_accounts')
          .update({
            pin_attempts: 0,
            pin_locked_until: null
          })
          .eq('user_id', userId);

        return {
          success: true,
          message: 'PIN verified successfully'
        };
      } else {
        // Increment failed attempts
        const newAttempts = (account.pin_attempts || 0) + 1;
        let lockedUntil = null;

        // Lock account after 3 failed attempts (30 minutes)
        if (newAttempts >= 3) {
          lockedUntil = new Date(Date.now() + 30 * 60 * 1000).toISOString();
        }

        this.supabase = getSupabaseClient();
        await this.supabase
          .from('user_accounts')
          .update({
            pin_attempts: newAttempts,
            pin_locked_until: lockedUntil
          })
          .eq('user_id', userId);

        return {
          success: false,
          error: `Incorrect PIN. Attempts remaining: ${3 - newAttempts}`
        };
      }
    } catch (error) {
      console.error('❌ Error in verifyUserPIN:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Update user PIN
   * @param {string} userId - User ID
   * @param {string} oldPin - Current PIN
   * @param {string} newPin - New PIN
   * @returns {Promise<Object>} Success/error response
   */
  async updateUserPIN(userId, oldPin, newPin) {
    try {
      if (!this.validatePIN(newPin)) {
        return {
          success: false,
          error: 'New PIN must be 4-6 digits'
        };
      }

      // Verify old PIN first
      const verification = await this.verifyUserPIN(userId, oldPin);
      if (!verification.success) {
        return verification;
      }

      // Update to new PIN
      const newPinHash = hashPIN(newPin);
      this.supabase = getSupabaseClient();

      const { error } = await this.supabase
        .from('user_accounts')
        .update({
          pin_hash: newPinHash,
          pin_created_at: new Date().toISOString()
        })
        .eq('user_id', userId);

      if (error) {
        return {
          success: false,
          error: error.message
        };
      }

      return {
        success: true,
        message: 'PIN updated successfully'
      };
    } catch (error) {
      console.error('❌ Error in updateUserPIN:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Enable biometric authentication
   * @param {string} userId - User ID
   * @param {Object} params - Biometric parameters
   * @param {boolean} params.fingerprint - Enable fingerprint
   * @param {boolean} params.phonePIN - Enable phone PIN
   * @returns {Promise<Object>} Success/error response
   */
  async enableBiometrics(userId, params) {
    try {
      this.supabase = getSupabaseClient();

      const { data, error } = await this.supabase
        .from('user_accounts')
        .update({
          fingerprint_enabled: params.fingerprint || false,
          phone_pin_enabled: params.phonePIN || false,
          biometric_enabled: params.fingerprint || params.phonePIN,
          biometric_last_updated: new Date().toISOString()
        })
        .eq('user_id', userId)
        .select()
        .single();

      if (error) {
        return {
          success: false,
          error: error.message
        };
      }

      return {
        success: true,
        account: data,
        message: 'Biometric settings updated'
      };
    } catch (error) {
      console.error('❌ Error in enableBiometrics:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Update account balance (used by transaction services)
   * @param {string} userId - User ID
   * @param {string} currency - Currency code (USD, UGX, KES)
   * @param {number} amount - Amount to add (can be negative for withdrawals)
   * @returns {Promise<Object>} Updated balance
   */
  async updateBalance(userId, currency, amount) {
    try {
      if (!['USD', 'UGX', 'KES'].includes(currency)) {
        return {
          success: false,
          error: `Unsupported currency: ${currency}`
        };
      }

      this.supabase = getSupabaseClient();
      const balanceField = `${currency.toLowerCase()}_balance`;

      const { data, error } = await this.supabase
        .from('user_accounts')
        .update({
          [balanceField]: `${balanceField} + ${amount}`,
          last_transaction_at: new Date().toISOString()
        })
        .eq('user_id', userId)
        .select()
        .single();

      if (error) {
        console.error(`❌ Error updating ${currency} balance:`, error);
        return {
          success: false,
          error: error.message
        };
      }

      console.log(`✅ Balance updated for ${currency}:`, {
        userId,
        amount,
        newBalance: data[balanceField]
      });

      return {
        success: true,
        balance: data[balanceField],
        currency: currency
      };
    } catch (error) {
      console.error('❌ Error in updateBalance:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get user's account summary
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Account summary with all balances
   */
  async getAccountSummary(userId) {
    try {
      const account = await this.getUserAccount(userId);
      
      if (!account) {
        return null;
      }

      return {
        accountNumber: account.account_number,
        accountHolder: account.account_holder_name,
        status: account.status,
        balances: {
          USD: account.usd_balance,
          UGX: account.ugx_balance,
          KES: account.kes_balance
        },
        phoneNumber: account.phone_number,
        email: account.email,
        kycVerified: account.kyc_verified,
        dailyLimit: account.daily_limit,
        monthlyLimit: account.monthly_limit,
        allowAgentTransfers: account.allow_agent_transfers,
        biometricEnabled: account.biometric_enabled,
        fingerprintEnabled: account.fingerprint_enabled,
        phonePhoneEnabled: account.phone_pin_enabled,
        createdAt: account.created_at,
        lastTransaction: account.last_transaction_at
      };
    } catch (error) {
      console.error('❌ Error in getAccountSummary:', error);
      return null;
    }
  }

  /**
   * Verify if account number exists
   * @param {string} accountNumber - Account number to verify
   * @returns {Promise<boolean>} True if account exists and is active
   */
  async verifyAccountNumber(accountNumber) {
    try {
      this.supabase = getSupabaseClient();

      const { data, error } = await this.supabase
        .from('user_accounts')
        .select('id')
        .eq('account_number', accountNumber)
        .eq('status', 'active')
        .maybeSingle();

      if (error || !data) {
        return false;
      }

      return true;
    } catch (error) {
      console.error('❌ Error in verifyAccountNumber:', error);
      return false;
    }
  }

  /**
   * Get account by account number
   * @param {string} accountNumber - Account number
   * @returns {Promise<Object>} Account details
   */
  async getAccountByNumber(accountNumber) {
    try {
      this.supabase = getSupabaseClient();

      const { data, error } = await this.supabase
        .from('user_accounts')
        .select('*')
        .eq('account_number', accountNumber)
        .maybeSingle();

      if (error) {
        console.error('❌ Error fetching account by number:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('❌ Error in getAccountByNumber:', error);
      return null;
    }
  }

  /**
   * Update user account details
   * @param {string} userId - User ID
   * @param {Object} params - Fields to update
   * @returns {Promise<Object>} Updated account
   */
  async updateUserAccount(userId, params) {
    try {
      this.supabase = getSupabaseClient();

      const updateData = {};
      
      // Only add provided fields
      if (params.accountHolderName) updateData.account_holder_name = params.accountHolderName;
      if (params.phoneNumber) updateData.phone_number = params.phoneNumber;
      if (params.email) updateData.email = params.email;
      if (params.preferredCurrency) updateData.preferred_currency = params.preferredCurrency;

      if (Object.keys(updateData).length === 0) {
        return {
          success: false,
          error: 'No fields to update'
        };
      }

      const { data, error } = await this.supabase
        .from('user_accounts')
        .update(updateData)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) {
        console.error('❌ Error updating account:', error);
        return {
          success: false,
          error: error.message
        };
      }

      console.log('✅ Account updated successfully');
      return {
        success: true,
        account: data,
        message: 'Account updated successfully'
      };
    } catch (error) {
      console.error('❌ Error in updateUserAccount:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Change account limits
   * @param {string} userId - User ID
   * @param {number} dailyLimit - New daily limit
   * @param {number} monthlyLimit - New monthly limit
   * @returns {Promise<Object>} Updated account
   */
  async updateAccountLimits(userId, dailyLimit, monthlyLimit) {
    try {
      if (dailyLimit <= 0 || monthlyLimit <= 0) {
        return {
          success: false,
          error: 'Limits must be greater than 0'
        };
      }

      if (dailyLimit > monthlyLimit) {
        return {
          success: false,
          error: 'Daily limit cannot exceed monthly limit'
        };
      }

      this.supabase = getSupabaseClient();

      const { data, error } = await this.supabase
        .from('user_accounts')
        .update({
          daily_limit: dailyLimit,
          monthly_limit: monthlyLimit
        })
        .eq('user_id', userId)
        .select()
        .single();

      if (error) {
        return {
          success: false,
          error: error.message
        };
      }

      return {
        success: true,
        account: data,
        message: 'Account limits updated'
      };
    } catch (error) {
      console.error('❌ Error in updateAccountLimits:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

export const walletAccountService = new WalletAccountService();
export default walletAccountService;

// ICAN Auth Service - Enhanced with FARM-AGENT integration & Blockchain Support
// Unified authentication with wallet connectivity for the Capital Engine

import { supabase } from '../lib/supabase/client';

/**
 * Sign up a new user with blockchain wallet support
 * @param {string} email - User email
 * @param {string} password - User password
 * @param {Object} userData - Additional user data
 * @returns {Promise} - Authentication data with blockchain readiness
 */
export async function signUp(email, password, userData = {}) {
  try {
    console.log('authService.signUp called with:', email);
    
    // Create the user account - EXACTLY like FARM-AGENT
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: userData.fullName || '',
          first_name: userData.firstName || '',
          last_name: userData.lastName || '',
        }
      }
    });
    
    console.log('signUp response:', { authData, authError });
    
    if (authError) throw authError;

    // Check if user already exists (Supabase returns user with identities = [] for existing users)
    if (authData.user && authData.user.identities && authData.user.identities.length === 0) {
      throw new Error('An account with this email already exists. Please sign in instead.');
    }
    
    return { 
      data: authData, 
      error: null,
      needsEmailConfirmation: authData.user && !authData.session
    };
  } catch (error) {
    console.error('Error signing up:', error);
    return { data: null, error };
  }
}

/**
 * Sign in with email and password
 * @param {string} email - User email
 * @param {string} password - User password
 * @returns {Promise} - Authentication data
 */
export async function signIn(email, password) {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });
    
    if (error) throw error;

    // Update last login
    if (data.user?.id) {
      await supabase
        .from('profiles')
        .update({ last_login_at: new Date().toISOString() })
        .eq('id', data.user.id)
        .catch(err => console.warn('Could not update last_login_at:', err));
      
      // Check if user has connected wallets
      const wallets = await getUserWallets(data.user.id);
      data.blockchainReady = wallets?.length > 0;
    }

    return { data, error: null };
  } catch (error) {
    console.error('Error signing in:', error);
    return { data: null, error };
  }
}

/**
 * Sign out the current user
 * @returns {Promise} - Sign out result
 */
export async function signOut() {
  try {
    const { error } = await supabase.auth.signOut();
    
    if (error) throw error;
    return { error: null };
  } catch (error) {
    console.error('Error signing out:', error);
    return { error };
  }
}

/**
 * Get the current user
 * @returns {Promise} - User data
 */
export async function getCurrentUser() {
  try {
    const { data, error } = await supabase.auth.getUser();
    
    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('Error getting current user:', error);
    return { data: null, error };
  }
}

/**
 * Reset password
 * @param {string} email - User email
 * @returns {Promise} - Reset result
 */
export async function resetPassword(email) {
  try {
    const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    
    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('Error resetting password:', error);
    return { data: null, error };
  }
}

/**
 * Update password
 * @param {string} newPassword - New password
 * @returns {Promise} - Update result
 */
export async function updatePassword(newPassword) {
  try {
    const { data, error } = await supabase.auth.updateUser({
      password: newPassword
    });
    
    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('Error updating password:', error);
    return { data: null, error };
  }
}

/**
 * Get user profile with ICAN-specific data
 * @param {string} userId - User ID
 * @returns {Promise} - User profile
 */
export async function getUserProfile(userId) {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();
    
    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('Error getting user profile:', error);
    return { data: null, error };
  }
}

/**
 * Update user profile
 * @param {string} userId - User ID
 * @param {Object} updates - Profile updates
 * @returns {Promise} - Updated profile
 */
export async function updateUserProfile(userId, updates) {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId)
      .select()
      .single();
    
    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('Error updating user profile:', error);
    return { data: null, error };
  }
}

// =====================================================
// BLOCKCHAIN INTEGRATION FUNCTIONS
// =====================================================

/**
 * Create initial wallet for user during signup
 * @param {string} userId - User ID
 * @param {string} walletAddress - Wallet address
 * @returns {Promise}
 */
async function createInitialWallet(userId, walletAddress) {
  try {
    const { data, error } = await supabase
      .from('ican_wallets')
      .insert({
        user_id: userId,
        wallet_address: walletAddress.toLowerCase(),
        wallet_type: detectWalletType(walletAddress),
        is_primary: true,
        is_verified: false,
        label: 'Primary Wallet',
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
      console.warn('Wallet creation during signup:', error);
      return null;
    }
    return data;
  } catch (error) {
    console.warn('Wallet creation error:', error);
    return null;
  }
}

/**
 * Get user's connected wallets
 * @param {string} userId - User ID
 * @returns {Promise}
 */
export async function getUserWallets(userId) {
  try {
    const { data, error } = await supabase
      .from('ican_wallets')
      .select('*')
      .eq('user_id', userId)
      .order('is_primary', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error getting user wallets:', error);
    return [];
  }
}

/**
 * Connect a new wallet to user account
 * @param {string} userId - User ID
 * @param {string} walletAddress - Wallet address
 * @param {string} signature - Signed message for verification
 * @returns {Promise}
 */
export async function connectWallet(userId, walletAddress, signature = null) {
  try {
    // Check if wallet already exists for any user
    const { data: existing } = await supabase
      .from('ican_wallets')
      .select('id, user_id')
      .eq('wallet_address', walletAddress.toLowerCase())
      .single();

    if (existing) {
      if (existing.user_id === userId) {
        return { data: null, error: { message: 'Wallet already connected to your account' } };
      }
      return { data: null, error: { message: 'Wallet is connected to another account' } };
    }

    // Create new wallet connection
    const { data, error } = await supabase
      .from('ican_wallets')
      .insert({
        user_id: userId,
        wallet_address: walletAddress.toLowerCase(),
        wallet_type: detectWalletType(walletAddress),
        is_primary: false,
        is_verified: !!signature,
        verification_signature: signature,
        verified_at: signature ? new Date().toISOString() : null,
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('Error connecting wallet:', error);
    return { data: null, error };
  }
}

/**
 * Verify wallet ownership with signature
 * @param {string} userId - User ID
 * @param {string} walletAddress - Wallet address
 * @param {string} signature - Signed verification message
 * @returns {Promise}
 */
export async function verifyWallet(userId, walletAddress, signature) {
  try {
    const { data, error } = await supabase
      .from('ican_wallets')
      .update({
        is_verified: true,
        verification_signature: signature,
        verified_at: new Date().toISOString()
      })
      .eq('user_id', userId)
      .eq('wallet_address', walletAddress.toLowerCase())
      .select()
      .single();

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('Error verifying wallet:', error);
    return { data: null, error };
  }
}

/**
 * Set primary wallet for user
 * @param {string} userId - User ID
 * @param {string} walletId - Wallet ID to set as primary
 * @returns {Promise}
 */
export async function setPrimaryWallet(userId, walletId) {
  try {
    // First, unset all primary wallets for user
    await supabase
      .from('ican_wallets')
      .update({ is_primary: false })
      .eq('user_id', userId);

    // Set the new primary wallet
    const { data, error } = await supabase
      .from('ican_wallets')
      .update({ is_primary: true })
      .eq('id', walletId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('Error setting primary wallet:', error);
    return { data: null, error };
  }
}

/**
 * Disconnect wallet from user account
 * @param {string} userId - User ID
 * @param {string} walletId - Wallet ID
 * @returns {Promise}
 */
export async function disconnectWallet(userId, walletId) {
  try {
    const { error } = await supabase
      .from('ican_wallets')
      .delete()
      .eq('id', walletId)
      .eq('user_id', userId);

    if (error) throw error;
    return { error: null };
  } catch (error) {
    console.error('Error disconnecting wallet:', error);
    return { error };
  }
}

// =====================================================
// UTILITY FUNCTIONS
// =====================================================

/**
 * Detect wallet type from address format
 * @param {string} address - Wallet address
 * @returns {string} - Wallet type
 */
function detectWalletType(address) {
  if (!address) return 'unknown';
  
  // Ethereum/Polygon/BSC (0x prefix, 40 hex chars)
  if (/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return 'ethereum';
  }
  
  // Solana (Base58, 32-44 chars)
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
    return 'solana';
  }
  
  // Bitcoin (starts with 1, 3, or bc1)
  if (/^(1|3)[a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(address) || 
      /^bc1[a-z0-9]{39,59}$/.test(address)) {
    return 'bitcoin';
  }
  
  return 'unknown';
}

/**
 * Generate a hash of user profile for blockchain verification
 * @param {string} userId - User ID
 * @param {string} email - User email
 * @returns {Promise<string>} - Profile hash
 */
async function generateProfileHash(userId, email) {
  try {
    const data = JSON.stringify({
      userId,
      email,
      timestamp: new Date().toISOString(),
      app: 'ican-capital-engine'
    });
    
    // Use SubtleCrypto for hashing in browser
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    return hashHex;
  } catch (error) {
    console.warn('Profile hash generation error:', error);
    return null;
  }
}

/**
 * Get user's blockchain-ready profile for cross-app integration
 * @param {string} userId - User ID
 * @returns {Promise}
 */
export async function getBlockchainProfile(userId) {
  try {
    const [profile, wallets, transactions] = await Promise.all([
      getUserProfile(userId),
      getUserWallets(userId),
      supabase
        .from('ican_transactions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50)
    ]);

    const txData = transactions.data || [];
    
    return {
      profile: profile.data,
      wallets,
      transactions: txData,
      stats: {
        totalTransactions: txData.length,
        totalValue: txData.reduce((sum, tx) => sum + parseFloat(tx.amount || 0), 0),
        verifiedWallets: wallets.filter(w => w.is_verified).length,
        connectedWallets: wallets.length
      },
      blockchainReady: wallets.some(w => w.is_verified),
      profileHash: await generateProfileHash(userId, profile.data?.email)
    };
  } catch (error) {
    console.error('Error getting blockchain profile:', error);
    return null;
  }
}

// Default export with all functions
export default {
  signUp,
  signIn,
  signOut,
  getCurrentUser,
  resetPassword,
  updatePassword,
  getUserProfile,
  updateUserProfile,
  getUserWallets,
  connectWallet,
  verifyWallet,
  setPrimaryWallet,
  disconnectWallet,
  getBlockchainProfile
};

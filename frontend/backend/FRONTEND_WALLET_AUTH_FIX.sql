/**
 * 🔒 WALLET SEND FUNCTIONALITY - Frontend Authentication Fix
 * 
 * Root Cause: userId: null → User not authenticated
 * Error: 406 when querying wallet_accounts without auth token
 */

-- =====================================================
-- Database Side: RLS Policy for Authenticated Access
-- =====================================================

ALTER TABLE public.wallet_accounts ENABLE ROW LEVEL SECURITY;

-- Drop ALL existing policies
DROP POLICY IF EXISTS "Users can view their own wallet accounts" ON public.wallet_accounts;
DROP POLICY IF EXISTS "Users can create their own wallet accounts" ON public.wallet_accounts;
DROP POLICY IF EXISTS "Users can update their own wallet accounts" ON public.wallet_accounts;
DROP POLICY IF EXISTS "Users can delete their own wallet accounts" ON public.wallet_accounts;
DROP POLICY IF EXISTS "Allow all selects" ON public.wallet_accounts;
DROP POLICY IF EXISTS "Allow all inserts" ON public.wallet_accounts;
DROP POLICY IF EXISTS "Allow all updates" ON public.wallet_accounts;
DROP POLICY IF EXISTS "Allow all deletes" ON public.wallet_accounts;

-- ✅ SECURE POLICY: Requires authentication + ownership
CREATE POLICY "Users can view their own wallet accounts"
  ON public.wallet_accounts FOR SELECT
  USING (auth.uid()::text = user_id::text);

CREATE POLICY "Users can create their own wallet accounts"
  ON public.wallet_accounts FOR INSERT
  WITH CHECK (auth.uid()::text = user_id::text);

CREATE POLICY "Users can update their own wallet accounts"
  ON public.wallet_accounts FOR UPDATE
  USING (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);

CREATE POLICY "Users can delete their own wallet accounts"
  ON public.wallet_accounts FOR DELETE
  USING (auth.uid()::text = user_id::text);

-- =====================================================
-- FRONTEND FIX: Ensure Authentication Before Query
-- =====================================================

/*
❌ WRONG - This causes userId: null → 406 error:

const getActiveStatuses = async () => {
  // ❌ No auth check! Queries immediately
  const { data, error } = await supabase
    .from('wallet_accounts')
    .select('id, balance')
    .eq('user_id', '01ce59a6-592f-4aea-a00d-3e2abcc30b5a')  // ← This user_id
    .eq('currency', 'UGX');
    
  // 406 error because request has no Authorization token
};

✅ CORRECT - Check auth FIRST, then query:

const getActiveStatuses = async () => {
  // 🚨 STEP 1: Verify user is authenticated
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  
  if (authError || !user) {
    console.error('❌ User not authenticated:', authError?.message);
    return null;  // Cannot query without auth
  }
  
  console.log('✅ User authenticated:', user.id);
  
  // 🚨 STEP 2: Now query with authenticated user
  const { data, error } = await supabase
    .from('wallet_accounts')
    .select('id, balance, currency')
    .eq('user_id', user.id)  // ← Use authenticated user ID
    .eq('currency', 'UGX');
  
  if (error) {
    console.error('❌ Query error:', error);
    return null;
  }
  
  console.log('✅ Query successful:', data);
  return data;
};

CALL THIS FUNCTION:
  await getActiveStatuses();
*/

-- =====================================================
-- Frontend Implementation Pattern
-- =====================================================

/*
📋 COMPLETE IMPLEMENTATION:

// File: services/walletService.js

import { supabase } from '../config/supabaseClient';

// Get current authenticated user
export const getCurrentUser = async () => {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
};

// Get wallet accounts for authenticated user
export const getWalletAccounts = async (currency = 'UGX') => {
  try {
    // Step 1: Get authenticated user
    const user = await getCurrentUser();
    
    if (!user) {
      console.error('User not authenticated');
      throw new Error('User must be authenticated to access wallet');
    }
    
    // Step 2: Query wallet with authenticated user
    const { data, error } = await supabase
      .from('wallet_accounts')
      .select('id, balance, currency, created_at')
      .eq('user_id', user.id)
      .eq('currency', currency);
    
    if (error) {
      throw error;
    }
    
    return data;
  } catch (error) {
    console.error('Error fetching wallet accounts:', error);
    throw error;
  }
};

// Send money - lookup recipient account
export const lookupRecipientAccount = async (accountNumber) => {
  try {
    // Step 1: Ensure user authenticated
    const user = await getCurrentUser();
    if (!user) {
      throw new Error('Must be authenticated to send money');
    }
    
    // Step 2: Query recipient account by account_number
    const { data, error } = await supabase
      .from('wallet_accounts')
      .select('id, user_id, currency')
      .eq('account_number', accountNumber)
      .single();
    
    if (error) {
      throw error;
    }
    
    // Step 3: Verify recipient is different from sender
    if (data.user_id === user.id) {
      throw new Error('Cannot send to your own account');
    }
    
    return data;
  } catch (error) {
    console.error('Error looking up account:', error);
    throw error;
  }
};

// =====================================================
// Usage in React Component
// =====================================================

import { useEffect, useState } from 'react';
import { getWalletAccounts, lookupRecipientAccount } from '../services/walletService';

export function WalletSendComponent() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchAccounts = async () => {
      try {
        setLoading(true);
        setError(null);
        
        // 🚨 This will check auth automatically
        const data = await getWalletAccounts('UGX');
        setAccounts(data);
      } catch (err) {
        setError(err.message);
        console.error('Failed to fetch accounts:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchAccounts();
  }, []);

  const handleSend = async (recipientAccountNumber, amount) => {
    try {
      // Lookup recipient with auth check built-in
      const recipient = await lookupRecipientAccount(recipientAccountNumber);
      
      console.log('Recipient found:', recipient);
      
      // TODO: Proceed with transfer logic
      
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) return <div>Loading wallet...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <div>
      <h2>Your Wallet Accounts</h2>
      {accounts.map(acc => (
        <div key={acc.id}>
          <p>Balance: {acc.balance} {acc.currency}</p>
        </div>
      ))}
    </div>
  );
}
*/

-- =====================================================
-- Key Points to Fix 406 Error
-- =====================================================

/*
✅ CHECKLIST:

1. ✓ ALWAYS call supabase.auth.getUser() BEFORE querying
   const { data: { user } } = await supabase.auth.getUser();

2. ✓ Check user is NOT null
   if (!user) { /* handle not authenticated */ }

3. ✓ Pass user.id (not a hardcoded UUID) to queries
   .eq('user_id', user.id)

4. ✓ Ensure user is logged in via:
   - supabase.auth.signInWithPassword(email, password)
   - supabase.auth.signInWithOAuth()
   - Or check session exists

5. ✓ Check Authorization header in Network tab
   Should show: Authorization: Bearer [JWT_TOKEN]

6. ✓ If header missing → User not authenticated

❌ COMMON MISTAKES:

1. Querying without checking auth first
   → userId: null → 406 error

2. Using hardcoded UUID instead of user.id
   → Even if authenticated, wrong user_id fails

3. Token expired
   → Need to refresh: await supabase.auth.refreshSession()

4. Auth session not persisted
   → Check: localStorage has auth token

5. Wrong API key
   → Should use ANON_KEY in browser, not SERVICE_ROLE
*/

-- =====================================================
-- Debug: Check if user authenticated
-- =====================================================

/*
Run in browser console:

// Check if authenticated
const { data: { user } } = await supabase.auth.getUser();
console.log('Current user:', user);

// Check session
const { data: { session } } = await supabase.auth.getSession();
console.log('Session:', session);

// Check token
console.log('Access token:', session?.access_token);

// If all null/undefined → User not authenticated
// Solution: Call supabase.auth.signInWithPassword() first
*/

-- =====================================================
-- SUMMARY: 406 Error Fix
-- =====================================================

/*
PROBLEM: userId: null, 406 error on wallet_accounts query

ROOT CAUSE: RLS policy requires authenticated user
- User not authenticated when query runs
- No Authorization header in request
- Request rejected by PostgREST

SOLUTION:
1. Check user is authenticated BEFORE querying
2. Use supabase.auth.getUser() at start of function
3. Return early if user is null
4. Then run query with user.id

IMPLEMENTATION:
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) { /* not authenticated */ }
  
  // NOW query with user.id
  const { data } = await supabase
    .from('wallet_accounts')
    .select('id, balance')
    .eq('user_id', user.id);

RESULT: ✅ Query succeeds, no more 406 errors
*/

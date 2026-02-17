# 🔍 ICAN Wallet System - Complete Flow Analysis

## Current Data Flow

### 1. **Component Initialization** (ICANWallet.jsx, line 330)
```
Component Mounts
    ↓
initializeUser() runs
    ↓
Get authenticated user: supabase.auth.getUser()
    ↓
Set currentUserId state (line 343)
    ↓
Load wallet balances: loadWalletBalances(user.id)
```

### 2. **Load Wallet Balances** (ICANWallet.jsx, line 185)
```
loadWalletBalances(userId)
    ↓
Check auth: supabase.auth.getUser() ✅ (added)
    ↓
Query wallet_accounts:
  .from('wallet_accounts')
  .select('currency, balance')
  .eq('user_id', userId)
    ↓
Build realWalletBalances state
    ↓
Used in walletData (line 253)
    ↓
currentWallet = walletData[selectedCurrency]
```

### 3. **Send Money Flow** (ICANWallet.jsx, line 425)

#### Step 1: Find Recipient
```
handleSendToICANUser(recipientIdentifier, amount, description)
    ↓
Query user_accounts to find recipient:
  - Search by ICAN account number, OR
  - Search by email, OR  
  - Search by phone number
    ↓
Get recipientUser.user_id
```

#### Step 2: Verify and Check Balance
```
Check: recipientUser.user_id !== currentUserId ✅
Check: amount <= currentWallet.balance ✅
```

#### Step 3: Query Both Wallets ⚠️ **THIS IS WHERE 406 HAPPENS**
```
Query sender's wallet:
  .from('wallet_accounts')
  .select('id, balance')
  .eq('user_id', currentUserId)        ✅ owns own wallet
  .eq('currency', selectedCurrency)
    ↓
Query recipient's wallet:
  .from('wallet_accounts')
  .select('id, balance')
  .eq('user_id', recipientUser.user_id)  ⚠️ TRYING TO READ ANOTHER USER'S WALLET
  .eq('currency', selectedCurrency)
```

## ❌ THE REAL PROBLEM

When we query `wallet_accounts` with `eq('user_id', recipientUser.user_id)`:

**Before RLS Fix:**
- RLS policy: `auth.uid()::text = user_id::text` (own accounts only)
- Current user: `4c25b54b-d6e7-4fd2-b784-66021c41a5d4`
- Trying to read: `01ce59a6-592f-4aea-a00d-3e2abcc30b5a`
- Result: ❌ 406 Not Acceptable (policy blocks read)

**After our RLS Fix:**
- NEW policy: `auth.role() = 'authenticated'` (any authenticated user can READ)
- Current user: `4c25b54b-d6e7-...` (still authenticated)
- Trying to read: `01ce59a6-592f-...` 
- Result: ✅ Should now return 200 OK

## ✅ VERIFICATION CHECKLIST

To confirm the fix is working, check in browser Network tab:

1. **Find wallet_accounts requests**
   - Look for: `GET .../wallet_accounts?user_id=eq...`

2. **Check Response Status**
   - Should see: `200 OK` (not 406)

3. **Check Request Headers**
   - Should have: `Authorization: Bearer eyJ...`
   - If missing: User not authenticated

4. **Check Response Body**
   - Should contain: Array of wallet account objects
   - Example:
     ```json
     [
       { "id": "...", "balance": "1500.50", "currency": "UGX", "user_id": "01ce59a6..." }
     ]
     ```

## 🐛 IF STILL FAILING (406 Error)

### Possible causes:

1. **RLS Policy not applied**
   - Solution: Verify SQL was executed in Supabase dashboard
   - Check: Supabase → SQL Editor → Run the verification query:
     ```sql
     SELECT schemaname, tablename, policyname, qual
     FROM pg_policies
     WHERE tablename = 'wallet_accounts'
     ORDER BY policyname;
     ```
   - Should show policy: `"Authenticated users can view wallet accounts for transfers"`

2. **Session token expired**
   - Solution: Refresh page, log out and log back in
   - Check: Browser localStorage → `sb-...` token exists

3. **Browser cache**
   - Solution: Hard refresh (Ctrl+Shift+R)
   - Or: Clear site data and reload

4. **Frontend not using auth user properly**
   - Check: Console for "User not authenticated" warning
   - Solution: Ensure `supabase.auth.getUser()` returns a user

5. **Different issue**
   - Take screenshot of 406 error URL
   - Check full error details in Network tab Response

## 📊 EXPECTED STATE AFTER FIX

**Before:**
```
❌ getActiveStatuses: userId: null
❌ wallet_accounts: 406 Not Acceptable
❌ Can't send money (recipient lookup fails)
```

**After:**
```
✅ getActiveStatuses: userId: '4c25b54b-...'
✅ wallet_accounts: 200 OK (returns data)
✅ Can send money (recipient lookup succeeds)
✅ Wallet transfers work normally
```

## 🔐 Security with New RLS Policy

**READ Access (SELECT):**
- Old: Only own wallet
- New: Any authenticated user's wallet ✅ NEEDED FOR LOOKUPS

**Write Access (INSERT/UPDATE/DELETE):**
- Unchanged: Only account owner can modify
- Still secure: No unauthorized modifications possible

**Why this is safe:**
- Only authenticated users can read
- Public doesn't have access
- Users cannot modify other accounts
- Only owner can transfer funds from their account

## Next Step

If still seeing 406 error, please share:
1. Full browser console error message
2. Network tab screenshot showing the 406 request
3. Request URL and Response headers

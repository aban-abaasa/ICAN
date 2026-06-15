# 🚀 ICAN Database Deployment Guide

## Critical Issue
Your app is failing because the SQL tables haven't been deployed to Supabase yet. The error logs show:
- **406 Not Acceptable** - `ican_user_wallets` table doesn't exist
- **404 Not Found** - `ican_coin_transactions` table doesn't exist  
- **403 Forbidden** - RLS policies blocking `ican_coin_blockchain_txs`

---

## Deployment Steps

### Step 1: Deploy Tables in This Exact Order

Go to **Supabase Dashboard → SQL Editor → New Query** and run each script:

#### 1️⃣ DEPLOY_ICAN_WALLETS.sql
```
Copy the entire file content and paste into Supabase SQL Editor
```
✅ Creates: `ican_wallets` table with wallet addresses and verification

#### 2️⃣ DEPLOY_USER_BALANCES.sql
```
Copy the entire file content and paste into Supabase SQL Editor
```
✅ Creates: `user_balances` table for multi-currency tracking

#### 3️⃣ DEPLOY_ICAN_TRANSACTIONS.sql
```
Copy the entire file content and paste into Supabase SQL Editor
```
✅ Creates: `ican_transactions` table for general transaction history

#### 4️⃣ DEPLOY_ICAN_COIN_TRANSACTIONS.sql
```
Copy the entire file content and paste into Supabase SQL Editor
```
✅ Creates: `ican_coin_transactions` table for buy/sell/transfer tracking

#### 5️⃣ DEPLOY_ICAN_USER_WALLETS.sql
```
Copy the entire file content and paste into Supabase SQL Editor
```
✅ Creates: `ican_user_wallets` table with financial tracking

#### 6️⃣ CREATE_ICAN_BLOCKCHAIN_TXS_TABLE.sql
```
Copy the entire file content and paste into Supabase SQL Editor
```
✅ Creates: `ican_coin_blockchain_txs` table for blockchain transaction recording

#### 7️⃣ FIX_BLOCKCHAIN_RLS.sql (if you get RLS errors)
```
Run ONLY if you get "403 Forbidden" errors when buying ICAN coins
Copy the entire file content and paste into Supabase SQL Editor
```
✅ Fixes: RLS policies to allow blockchain transaction recording

---

## Key Features of Deployed Tables

| Table | Purpose | Key Columns |
|-------|---------|------------|
| `ican_wallets` | Wallet addresses & verification | user_id, wallet_address, is_verified |
| `user_balances` | Balance by currency | user_id, currency, balance |
| `ican_transactions` | General transaction ledger | user_id, transaction_type, amount |
| `ican_coin_transactions` | Buy/sell/transfer history | user_id, type, ican_amount, price_per_coin |
| `ican_user_wallets` | ICAN-specific wallets | user_id, wallet_address, ican_balance, purchase_count, sale_count |
| `ican_coin_blockchain_txs` | Blockchain transaction records | user_id, tx_type, ican_amount, tx_hash |

---

## Error Resolution Summary

### The Errors You're Seeing

```
❌ 406 Not Acceptable - GET ican_user_wallets
❌ 404 Not Found - POST ican_coin_transactions  
❌ 400 Bad Request - on_conflict=user_id
❌ 403 Forbidden - RLS policy violation
❌ TypeError: Cannot read properties of null (reading 'toFixed')
```

### Root Causes & Solutions

| Error | Cause | Solution |
|-------|-------|----------|
| **406 Not Acceptable** | `ican_user_wallets` table doesn't exist | Deploy DEPLOY_ICAN_USER_WALLETS.sql |
| **404 Not Found** | `ican_coin_transactions` table doesn't exist | Deploy DEPLOY_ICAN_COIN_TRANSACTIONS.sql |
| **400 Bad Request** | Wrong constraint for upsert | Schema now has `user_id UNIQUE` (FIXED) |
| **403 Forbidden** | RLS policy too strict | Run FIX_BLOCKCHAIN_RLS.sql |
| **TypeError: toFixed()** | Null values from missing response fields | Code now has null-safe fallbacks (FIXED) |

### What's Been Fixed in Code

✅ **Fixed: updateCoinBalance() method**
- Now tracks: `total_spent`, `total_earned`, `purchase_count`, `sale_count`
- Generates wallet_address if missing: `wallet_${userId.substring(0, 8)}`
- Has fallback logic if upsert fails

✅ **Fixed: BuyIcan.jsx**
- Added try-catch around blockchain recording (non-blocking)
- Blockchain failure won't break coin purchase
- Safe property access with fallbacks for all transaction fields

✅ **Fixed: Table Schema**
- `user_id UNIQUE` allows correct upsert conflict targeting
- All financial tracking columns included
- Proper RLS policies for security

---

### ✅ updateCoinBalance() Method
- Now generates `wallet_address` if missing: `wallet_${userId.substring(0, 8)}`
- Tracks all financial fields: `total_spent`, `total_earned`, `purchase_count`, `sale_count`
- Has fallback logic if upsert fails
- Uses `user_id` UNIQUE constraint correctly

### ✅ Table Schema
- `user_id UNIQUE` - allows upsert with `onConflict: 'user_id'`
- `wallet_address UNIQUE` - prevents duplicate wallets
- All financial tracking columns included

---

## Testing After Deployment

### Test 1: Buy ICAN Coins
1. Open your app
2. Go to Buy ICAN section
3. Enter amount and purchase
4. Should see success message with updated balance

### Test 2: Check Wallet Verification
1. Open contribute modal
2. Should see green ✓ if user has ICAN coins
3. Should show balance in real-time

### Test 3: Verify Database Records
In Supabase SQL Editor, run:
```sql
-- Check wallet was created
SELECT user_id, wallet_address, ican_balance 
FROM ican_user_wallets 
LIMIT 5;

-- Check transaction was recorded
SELECT user_id, type, ican_amount, created_at 
FROM ican_coin_transactions 
ORDER BY created_at DESC 
LIMIT 5;
```

---

## Common Issues & Solutions

### ❌ "table does not exist" error
→ You haven't run the SQL script yet for that table
→ Go to Supabase SQL Editor and execute the missing script

### ❌ "402: Unauthorized" or RLS policy errors
→ The table exists but RLS is blocking access
→ Ensure you're logged in to Supabase with the correct user
→ RLS policies allow authenticated users to access their own records

### ❌ "on_conflict=user_id not found"
→ This is already fixed in the schema and code
→ Re-deploy DEPLOY_ICAN_USER_WALLETS.sql

---

## Files Modified

- ✅ `frontend/src/services/icanCoinService.js` - Fixed updateCoinBalance()
- ✅ `backend/DEPLOY_ICAN_USER_WALLETS.sql` - Schema with user_id UNIQUE constraint

---

## Next Steps

1. **Deploy all 5 SQL scripts to Supabase** (in order above)
2. **Test coin purchase flow** - Buy ICAN coins and verify balance updates
3. **Test contribution flow** - Contribute to group and verify coins are deducted
4. **Monitor console errors** - Should see ✅ success messages instead of 404/406 errors

---

## Questions?

If you encounter errors during deployment:
1. Check the exact error message in Supabase SQL Editor
2. Ensure you copied the entire file content (all lines)
3. If policy errors occur, the tables likely already exist - delete them first with `DROP TABLE IF EXISTS table_name CASCADE;`

# 🚨 CRITICAL: Deploy Tables NOW to Save Coins

## Current Problem
User is buying ICAN coins but they disappear because tables don't exist:
- ❌ 406 Error: `ican_user_wallets` table missing
- ❌ 400 Error: Can't save coins because constraint is wrong
- ❌ 403 Error: RLS blocking blockchain transactions

## 🔥 Step 1: Deploy Single Script (IMMEDIATE)

**File to deploy:** `backend/FINAL_DEPLOY_ALL_TABLES.sql`

### How to Deploy:
1. Go to **Supabase Dashboard**
2. Click **SQL Editor** → **New Query**
3. Copy **entire content** of `FINAL_DEPLOY_ALL_TABLES.sql`
4. Paste into Supabase SQL Editor
5. Click **Run**

⏱️ **Takes 30 seconds**

### What This Does:
- ✅ Drops broken `ican_user_wallets` table
- ✅ Creates new table with `user_id UNIQUE` constraint (fixes the 400 error)
- ✅ Adds all 3 RLS policies (SELECT, INSERT, UPDATE)
- ✅ Drops broken `ican_coin_blockchain_txs` table
- ✅ Creates new blockchain table with correct RLS
- ✅ Adds all permissions for authenticated users

### Verification:
After running, you should see outputs:
```
✅ ican_user_wallets TABLE CREATED
✅ ican_coin_blockchain_txs TABLE CREATED
✅ ALL TABLES READY!
```

---

## 🔄 Step 2: Test Coin Purchase

After tables are deployed:

1. **Go to Buy ICAN in your app**
2. **Enter amount:** 30,000 UGX (6 ICAN coins)
3. **Click Purchase**
4. **Check browser console** for:
   - ✅ `✅ ICAN balance saved to ican_user_wallets: 6.00000000`
   - ✅ No 406 or 400 errors
5. **Check app** - balance should show: **💎 6.00000000**

---

## ✅ Step 3: Verify in Supabase

Run this query in Supabase SQL Editor:
```sql
SELECT user_id, ican_balance, purchase_count, total_earned
FROM ican_user_wallets
WHERE user_id = '4c25b54b-d6e7-4fd2-b784-66021c41a5d4';
```

Expected result:
```
| user_id                              | ican_balance | purchase_count | total_earned  |
|--------------------------------------|--------------|----------------|---------------|
| 4c25b54b-d6e7-4fd2-b784-66021c41a5d4 |    6.00000000|        1       |   6.00000000  |
```

---

## 🛡️ Code Updates

The code now has **3-tier fallback system**:

1. **Primary:** Save to `ican_user_wallets` (with upsert)
2. **Fallback 1:** Update existing record in `ican_user_wallets`
3. **Fallback 2:** Save to `user_balances` multi-currency table

This means coins **won't be lost** even if one storage method fails.

---

## ❌ If You Get an Error

### Error: "Cannot find column 'x'"
→ The old table has the wrong columns
→ Just run `FINAL_DEPLOY_ALL_TABLES.sql` again - it drops and recreates

### Error: "Relation already exists"
→ The new table was created but something else failed
→ Run: `DROP TABLE IF EXISTS public.ican_user_wallets CASCADE;`
→ Then run `FINAL_DEPLOY_ALL_TABLES.sql` again

### Error: "Permission denied"
→ You may not be logged in to Supabase
→ Check you're in the right Supabase project

---

## ⏰ Timeline
- **Now:** Deploy `FINAL_DEPLOY_ALL_TABLES.sql` (30 seconds)
- **2 minutes:** Test coin purchase
- **Done:** Coins save successfully ✅

---

## Files Ready to Deploy
- ✅ `backend/FINAL_DEPLOY_ALL_TABLES.sql` (USE THIS ONE)
- ✅ `backend/RECREATE_ICAN_USER_WALLETS.sql` (older version)
- ✅ `backend/DEPLOY_ICAN_USER_WALLETS.sql` (even older)

**Only run `FINAL_DEPLOY_ALL_TABLES.sql` - it includes everything!**

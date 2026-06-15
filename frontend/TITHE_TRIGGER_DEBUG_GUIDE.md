# 🔍 Tithe Trigger Not Firing - Step-by-Step Debug

Your transactions are recording but **the trigger isn't clearing tithe**. Let's find out why.

---

## ⚡ Quick Debug (Copy & Run Each Query)

### Query 1: Confirm user has transactions
```sql
SELECT DISTINCT user_id, COUNT(*) as payments
FROM ican_transactions
WHERE transaction_type = 'tithe' AND status = 'completed'
AND created_at > NOW() - INTERVAL '24 hours'
GROUP BY user_id;
```
**⚠️ SAVE the user_id you see** - you'll need it for the next queries

---

### Query 2: Check if tithe tracking record exists for this user
```sql
SELECT 
  user_id,
  personal_tithe_accumulated,
  combined_tithe_accumulated,
  updated_at
FROM user_tithe_tracking
WHERE user_id = 'PASTE_USER_ID_FROM_QUERY_1_HERE';
```

**Possible Results:**
- ❌ NO ROWS = Record doesn't exist (this could be the issue!)
- ✅ ROWS EXIST but amounts still high = Trigger not deducting

---

### Query 3: Is the trigger actually on the table?
```sql
SELECT tgname, tgenabled
FROM pg_trigger 
WHERE tgname = 'trigger_clear_tithe_after_payment';
```

**Expected**: 1 row with tgenabled='O'  
**If no rows**: Trigger missing ❌  
**If empty/false**: Trigger disabled ❌

---

### Query 4: Check RLS isn't blocking updates
```sql
SELECT rowsecurity FROM pg_tables WHERE tablename = 'user_tithe_tracking';
```

**Expected**: false (RLS disabled)  
**If true**: RLS is blocking the UPDATE ❌

---

### Query 5: Verify metadata structure
```sql
SELECT 
  id,
  metadata,
  metadata->>'payment_type' as payment_type
FROM ican_transactions
WHERE transaction_type = 'tithe'
ORDER BY created_at DESC
LIMIT 1;
```

**Check**: Does metadata->>'payment_type' show a value?  
**If NULL**: Trigger can't identify payment type ❌

---

## 🚨 Most Likely Problem

Based on your 5 transactions **all not being cleared**, I suspect:

### Issue #1: user_tithe_tracking record doesn't exist
The trigger tries to INSERT/UPDATE a record, but maybe the record was never created!

**Quick Fix - Run this:**
```sql
-- Get the user_id from Query 1 above, then run:
INSERT INTO user_tithe_tracking (
  user_id, 
  personal_tithe_accumulated, 
  business_tithe_accumulated, 
  combined_tithe_accumulated
)
VALUES ('PASTE_USER_ID_HERE', 10110000, 0, 10110000)
ON CONFLICT (user_id) DO NOTHING;

-- Verify it was created:
SELECT * FROM user_tithe_tracking WHERE user_id = 'PASTE_USER_ID_HERE';
```

---

### Issue #2: Trigger exists but isn't firing
The trigger function might be broken or disabled.

**Test the trigger manually:**
```sql
-- This simulates what the trigger should do
UPDATE user_tithe_tracking
SET 
  personal_tithe_accumulated = GREATEST(0, personal_tithe_accumulated - 10110000),
  combined_tithe_accumulated = GREATEST(0, combined_tithe_accumulated - 10110000),
  updated_at = NOW()
WHERE user_id = 'PASTE_USER_ID_HERE';

-- Check result:
SELECT 
  personal_tithe_accumulated,
  combined_tithe_accumulated
FROM user_tithe_tracking
WHERE user_id = 'PASTE_USER_ID_HERE';
```

If this UPDATE works but the trigger didn't → **The trigger isn't firing**

---

## 🔧 Immediate Workaround (While We Fix)

If diagnostics show the trigger is truly broken, run this to **manually clear tithe**:

```sql
-- Get your user_id from Query 1, then:
UPDATE user_tithe_tracking
SET 
  personal_tithe_accumulated = 0,
  business_tithe_accumulated = 0,
  combined_tithe_accumulated = 0,
  updated_at = NOW()
WHERE user_id = 'PASTE_USER_ID_HERE';

SELECT 'Tithe cleared manually' as status;
```

---

## ⚡ Next Steps

1. **Run Queries 1-5 above**
2. **Share the results** (just copy/paste the tables)
3. **Tell me which query failed** or showed unexpected results
4. I'll know exactly what's wrong and how to fix it!

**Most likely you'll find:**
- ❌ user_tithe_tracking record doesn't exist → Create it
- ❌ RLS enabled → Disable it
- ❌ Trigger disabled → Re-enable it

We'll have this fixed in **10 minutes**! ⚡

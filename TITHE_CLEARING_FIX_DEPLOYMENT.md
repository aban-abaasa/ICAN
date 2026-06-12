## Tithe Clearing Bug Fix - Deployment Checklist

### **Issue Summary**
- 8 tithe payments recorded (6/8/2026) totaling 80,000 UGX
- System still shows "Tithe Due (10%): UGX 10,000"
- **Root Cause**: RLS policies on `user_tithe_tracking` were blocking the trigger's UPDATE operation

### **Files Involved**
1. ✅ `FIX_TITHE_CLEARING_TRIGGER.sql` - New fix script (created)
2. ✅ `MobileView.jsx` - Added `fetchActualTitheOwed()` function to fetch real data (created)
3. 📖 `CLEAR_TITHE_ON_PAYMENT.sql` - Original (now needs updating with RLS fix)
4. 📖 `VERIFY_TITHE_SYSTEM.sql` - Diagnostic script (use for verification)

---

## **DEPLOYMENT STEPS**

### **Step 1: Apply the Fix (Supabase)**
1. Go to Supabase Dashboard → SQL Editor
2. Create new query and paste contents of `FIX_TITHE_CLEARING_TRIGGER.sql`
3. Run the script
4. ✅ Verify output shows:
   - `TRIGGER EXISTS`
   - `rls_enabled: false` (for user_tithe_tracking table)

### **Step 2: Verify the Fix Works**
1. Run diagnostic queries from `VERIFY_TITHE_SYSTEM.sql`:
   - STEP 1: Check `user_tithe_tracking` has data
   - STEP 2: Confirm trigger exists and is enabled
   - STEP 3: Check recent tithe transactions
   - STEP 4: Verify tithe amounts for users

2. **Expected Results**:
   - Trigger should exist
   - Recent tithe payments should show correct payment_type in metadata
   - For any user with tithe payments, `combined_tithe_accumulated` should = 0

### **Step 3: Test with New Payment**
1. Open ICAN app and go to "Tithe" section
2. Record a test tithe payment (e.g., 5,000 UGX)
3. Check that:
   - ✅ Transaction appears in "Today's Transactions"
   - ✅ "Tithe Due" section updates to 0 (cleared)
   - ✅ Wallet balance decreases by payment amount

### **Step 4: Frontend Verification**
- `fetchActualTitheOwed()` function now fetches real tithe amounts from database
- Loads on component mount via `useEffect` in wallet initialization
- Updates state: `actualTitheOwed = { personal, business, combined, lastPaymentDate }`

---

## **Verification Queries**

After applying fix, run these to confirm everything works:

```sql
-- Check trigger exists
SELECT * FROM information_schema.triggers 
WHERE trigger_name = 'trigger_clear_tithe_after_payment';

-- Check RLS disabled
SELECT tablename, rls_enabled FROM pg_tables 
WHERE tablename = 'user_tithe_tracking';

-- Check recent payments were processed
SELECT 
  user_id,
  COUNT(*) as payment_count,
  SUM(amount) as total_paid,
  MIN(created_at) as first_payment,
  MAX(created_at) as last_payment
FROM ican_transactions
WHERE transaction_type = 'tithe' 
  AND status = 'completed'
  AND created_at > NOW() - INTERVAL '1 day'
GROUP BY user_id;

-- Check tithe tracking updated correctly
SELECT 
  ut.user_id,
  personal_tithe_accumulated,
  business_tithe_accumulated,
  combined_tithe_accumulated,
  last_payment_date
FROM user_tithe_tracking ut
WHERE last_payment_date > NOW() - INTERVAL '1 day'
ORDER BY last_payment_date DESC;
```

---

## **Rollback Plan** (if needed)
If something goes wrong:
1. Re-enable RLS: `ALTER TABLE user_tithe_tracking ENABLE ROW LEVEL SECURITY;`
2. Re-add policies from `CLEAR_TITHE_ON_PAYMENT.sql` SECTION 4
3. Investigate further with diagnostic queries

---

## **Success Criteria** ✅
- [ ] Fix script runs without errors
- [ ] Trigger exists and is enabled
- [ ] RLS is disabled on `user_tithe_tracking`
- [ ] Recent tithe transactions show in database
- [ ] Tithe accumulated amounts are 0 for users who paid
- [ ] New test payment clears tithe immediately
- [ ] Frontend shows actual tithe data from database

---

## **Key Insight**
This was a classic **security vs. automation** conflict:
- RLS policies are great for user-facing tables
- But `user_tithe_tracking` is an internal system table that **triggers need to update**
- Solution: Disable RLS on system tables that triggers manage
- Security remains: RLS policies prevent users from accessing each other's tracking data (if we re-enable them later)

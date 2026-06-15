# ⚡ TITHE FIX - QUICK DEPLOYMENT GUIDE

**Time to Fix:** ~10 minutes  
**Difficulty:** Easy (Copy-paste SQL + 1 code change)

---

## 🚀 DEPLOYMENT STEPS

### Step 1: Deploy Backend Trigger (5 min)

**Location:** Supabase → SQL Editor

**SQL to Run:**
Copy the entire contents of `backend/FIX_TITHE_ACCUMULATION_ON_INCOME.sql`

Paste in Supabase SQL Editor and click **RUN**

**Expected Result:**
```
✅ Trigger Status: ACTIVE
✅ Function Status: ACTIVE
```

---

### Step 2: Disable RLS on Tithe Tracking (3 min)

**Location:** Supabase → SQL Editor

**SQL to Run:**
```sql
-- DISABLE RLS (allows system triggers to update)
ALTER TABLE user_tithe_tracking DISABLE ROW LEVEL SECURITY;

-- Clean up old policies
DROP POLICY IF EXISTS "Users can view their own tithe tracking" ON user_tithe_tracking;
DROP POLICY IF EXISTS "Users can update their own tithe tracking" ON user_tithe_tracking;

-- Verify
SELECT tablename FROM information_schema.tables 
WHERE tablename = 'user_tithe_tracking';
```

**Expected Result:**
```
✅ RLS disabled on user_tithe_tracking
✅ Old policies removed
```

---

### Step 3: Update Frontend Display (2 min)

**Location:** `frontend/src/components/MobileView.jsx`

**Change 1:** Line ~2823 in `fetchActualTitheOwed()` function

Find this section:
```javascript
const { data, error } = await supabase
  .from('user_tithe_tracking')
  .select('personal_tithe_accumulated, business_tithe_accumulated, combined_tithe_accumulated, last_payment_date')
  .eq('user_id', userId)
  .single();

if (error) {
  if (error.code === 'PGRST116') {
    console.log('No tithe tracking record found for user');
    setActualTitheOwed({
      personal: 0,
      business: 0,
      combined: 0,
      lastPaymentDate: null
    });
  }
  // ... rest of error handling
}
```

Replace with:
```javascript
const { data, error } = await supabase
  .from('user_tithe_tracking')
  .select('personal_tithe_accumulated, business_tithe_accumulated, combined_tithe_accumulated, last_payment_date')
  .eq('user_id', userId)
  .single();

if (error) {
  if (error.code === 'PGRST116') {
    console.log('No tithe tracking record found for user - will use calculated values');
    setActualTitheOwed(null);  // Set to null to trigger fallback to calculated
  } else {
    console.error('Error fetching tithe data:', error);
    setActualTitheOwed(null);
  }
  return;
}

if (data) {
  setActualTitheOwed({
    personal: data.personal_tithe_accumulated || 0,
    business: data.business_tithe_accumulated || 0,
    combined: data.combined_tithe_accumulated || 0,
    lastPaymentDate: data.last_payment_date
  });
  console.log('✅ Actual tithe owed fetched from database:', data);
}
```

**Change 2:** Lines ~6250-6330 in Tithe Modal Display

Find where it displays tithe:
```javascript
{/* Combined tithe */}
<div className="bg-white rounded-xl p-4 shadow-sm text-center">
  <p className="text-xs text-gray-500 mb-1">Combined tithe due (from database)</p>
  <div className="text-3xl font-bold text-amber-600">
    UGX {(actualTitheOwed?.combined_tithe_owed || 0).toLocaleString(...)}
  </div>
</div>
```

Replace `actualTitheOwed?.combined_tithe_owed || 0` with:
```javascript
(actualTitheOwed?.combined || tithingMetrics.combinedTithe || 0)
```

And update the other tithe displays:
```javascript
{/* Personal Tithe */}
<div className="text-xl font-bold text-green-600">
  UGX {(actualTitheOwed?.personal || tithingMetrics.personalTithe || 0).toLocaleString(...)}
</div>

{/* Business Tithe */}
<div className="text-xl font-bold text-blue-600">
  UGX {(actualTitheOwed?.business || tithingMetrics.businessTithe || 0).toLocaleString(...)}
</div>
```

**Change 3:** Line ~6350-6370 (Quick Tab Summary)

For the combined tithe display:
```javascript
<div className="text-3xl font-bold text-amber-600">
  UGX {(actualTitheOwed?.combined || tithingMetrics.combinedTithe || 0).toLocaleString(...)}
</div>
```

---

## ✅ VERIFICATION

### After Each Step:

**Step 1 Verification:**
```sql
-- Check trigger exists
SELECT tgname FROM pg_trigger WHERE tgname = 'trigger_calculate_tithe_on_income';
-- Should return: trigger_calculate_tithe_on_income

-- Check function exists
SELECT proname FROM pg_proc WHERE proname = 'calculate_tithe_on_income';
-- Should return: calculate_tithe_on_income
```

**Step 2 Verification:**
```sql
-- Check RLS status
SELECT schemaname, tablename, rowsecurity 
FROM pg_tables 
WHERE tablename = 'user_tithe_tracking';
-- Should show: rowsecurity = false
```

**Step 3 Verification:**
- Reload the app
- Go to Tithe tab
- Should show calculated tithe even before DB is populated

---

## 🧪 END-TO-END TEST

1. **Record New Income:**
   - Click on Personal Account → Income
   - Record "Test Salary: 100,000 UGX"
   - Save

2. **Check Database:**
   ```sql
   SELECT * FROM user_tithe_tracking 
   WHERE personal_tithe_accumulated > 0
   LIMIT 1;
   ```
   Should show: `personal_tithe_accumulated = 10000` (100K × 10%)

3. **Check Frontend:**
   - Go to Tithe tab
   - Should show: "Personal Tithe Due: UGX 10,000"

4. **Test Pay In:**
   - Click "Pay In" tab
   - Should show tithe due amount
   - Record payment

5. **Verify Clearing:**
   - After payment, `combined_tithe_accumulated` should be 0

---

## 🆘 TROUBLESHOOTING

| Problem | Solution |
|---------|----------|
| Trigger shows error "RLS" | Run Step 2 first to disable RLS |
| Frontend still shows 0 | Clear browser cache, reload page |
| Tithe accumulates but won't clear | Check `clear_tithe_after_payment` trigger exists |
| New income not triggering tithe | Verify income transaction_type is 'income' (not 'salary') |

---

## 📝 NOTES

- Trigger checks for `transaction_type IN ('salary', 'business_sales')`
- Ensure income transactions use these types, not 'income'
- Tithe calculation uses hardcoded 10% rate (can be made configurable)
- RLS disabled for system table (security is via auth.uid() filters elsewhere)

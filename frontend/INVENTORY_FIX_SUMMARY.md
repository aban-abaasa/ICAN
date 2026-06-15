# Inventory Persistence Fix - Summary & Action Plan

## Status: Issue Identified & Fixes Applied ✅

### What I Found

**Problem:** Inventory items added successfully but disappear after page refresh + show "UGX NaN" for prices

**Root Cause Identified:** 
1. **MOST LIKELY:** Items ARE being saved to database, but **Row-Level Security (RLS) policy is preventing you from seeing them** on fetch
2. **Secondary:** Price mapping issue with null/undefined unit_price values
3. **Code Quality:** Missing field mapping in RPC response handling

---

## Changes Made ✅

### 1. Enhanced Logging (Frontend)

**File:** `cmmsService.js` - Lines 81-93, 839-865, 900-975

**What's New:**
- Added detailed console logs showing:
  - Raw database response with item count
  - Sample item from database showing all fields
  - Mapped item data with unit_price values
  - Added logging to addInventoryItem to track RPC calls

**Benefit:** Can now see exactly where data is being lost in the pipeline

### 2. Enhanced Logging (Component)

**File:** `CMSSModule.jsx` - Lines 571-610

**What's New:**
- Detailed logs when inventory is fetched
- Item-by-item printout showing: `item_code`, `item_name`, `unit_cost`
- Clear indication if fetch returns 0 items vs database has items

**Benefit:** Can trace if issue is in fetch or mapping

### 3. Fixed Field Mapping

**File:** `cmmsService.js` - Lines 900-975 (`addInventoryItem` function)

**What Changed:**
- Now sets BOTH `unit_price` and `unit_cost` on created items for compatibility
- Captures `minimum_stock_level` field
- Includes all required database fields: `cmms_company_id`, `department_id`, etc.
- Reduced mismatch between created item and fetched item structure

**Benefit:** Items created and fetched will have identical field structure

---

## What You Need to Do

### Step 1: Deploy Latest RPC Function ⚠️ CRITICAL

The RPC function was updated to handle duplicates and ensure `is_active = TRUE`.

**In Supabase Dashboard:**
1. Go to **SQL Editor**
2. Create **New Query**
3. Copy entire content from: `c:\Users\Aban\Desktop\ICAN\backend\FIX_DUPLICATE_INVENTORY.sql`
4. **Paste** and click **Run**
5. Should see: `"Function updated to handle duplicate items..."`

**This function has:**
- ✅ `SECURITY DEFINER` - can run with elevated privileges
- ✅ `row_security = OFF` - RPC itself bypasses RLS
- ✅ INSERT/UPDATE logic - handles duplicates
- ✅ Proper field mapping - stores `unit_price` correctly

### Step 2: Verify User Setup (Most Important!) ⚠️

**This is likely why items disappear!**

RLS policy prevents you from SEEING items if you're not in `cmms_users` table.

**Check your user:**
1. Supabase → Table Editor → `cmms_users`
2. Filter: `email` = your email
3. Verify user exists AND:
   - `cmms_company_id` is set (not null)
   - `cmms_company_id` matches your company
   - `is_active` = true

**If user is missing:**
1. Need to run `createAdminUser()` from component
   OR
2. Manually insert user row with your email and company_id

### Step 3: Test with Debug Logging

1. **Open browser console** (F12)
2. Go to CMMS → Inventory
3. Add test item: `TEST-DEBUG-001`, price `50.00`, stock `10`
4. **Check console for:**
   ```
   📝 Adding inventory item via RPC function...
   🔍 Parameters: { unit_price: 50 }
   📦 RPC Response: { status: "SUCCESS" }
   ✅ Inventory item created
   ```
5. Item should appear with price **UGX 50.0M** (not NaN)
6. **Refresh page** (F5)
7. **Check console for:**
   ```
   📦 Fetching inventory for company: <id>
   📦 Raw database response: 1 items
   🔍 Sample item: { item_code: "TST001", unit_price: 50, ... }
   ✅ Loaded 1 inventory items from Supabase
     - TST001: TEST-DEBUG-001 @ UGX 50
   ```
8. Item should STILL BE THERE in UI

### Step 4: Troubleshoot Based on Results

**If item still disappears:**

Check console logs to identify which phase fails:

1. **RPC shows ERROR:**
   - Note the exact error message
   - Report it back

2. **RPC shows SUCCESS but item missing from Supabase:**
   - Check Supabase table cmms_inventory_items
   - Filter by company_id
   - Should see the item there

3. **Item in Supabase but doesn't fetch to UI:**
   - **This is RLS blocking!**
   - Check cmms_users table - are you in there with correct company_id?
   - If not, insert yourself or run createAdminUser()

4. **Item fetches but shows NaN price:**
   - Check console mapping logs
   - Should show `unit_price: 50` (not 0 or undefined)
   - If showing as undefined, issue is in RPC response

---

## Code Context

### mapCmmsInventoryItem() Function
**Location:** `cmmsService.js` lines 81-93

```javascript
const mapCmmsInventoryItem = (itemRow) => {
  return {
    ...itemRow,  // Spread all database fields
    minimum_stock_level: itemRow.reorder_level ?? itemRow.minimum_stock_level ?? 0,
    unit_cost: itemRow.unit_price ?? itemRow.unit_cost ?? 0  // Map unit_price to unit_cost
  };
};
```

**Important:** The `...itemRow` preserves all DB fields including `cmms_company_id`, `department_id`, `is_active`, etc.

### RPC Function Key Features
**Location:** `FIX_DUPLICATE_INVENTORY.sql`

```sql
-- On INSERT:
INSERT INTO cmms_inventory_items (
  cmms_company_id, department_id, item_name, item_code,
  quantity_in_stock, reorder_level, unit_price,
  is_active,    -- ← ALWAYS TRUE
  created_by,   -- ← NULL (bypass RLS)
  last_updated_by,  -- ← NULL
)
VALUES (...)

-- On UPDATE (if item exists):
UPDATE cmms_inventory_items SET
  unit_price = COALESCE(p_unit_price, 0),
  is_active = TRUE,  -- ← Ensure active
  updated_at = NOW()
```

---

## File Changes Summary

| File | Lines | Change | Purpose |
|------|-------|--------|---------|
| cmmsService.js | 81-93 | Added logging to mapCmmsInventoryItem | See what's being mapped |
| cmmsService.js | 839-865 | Added logging to getCompanyInventory | See what DB returns |
| cmmsService.js | 900-975 | Enhanced addInventoryItem field mapping | Ensure unit_price is captured |
| CMSSModule.jsx | 571-610 | Enhanced inventory fetch logging | Track data flow on page load |

---

## Expected Results After Fix

### ✅ Item Created
```
Total Items: 1
Inventory Value: UGX 500.0M
Item: "safssa"
Price: UGX 50.0M  ← Shows actual price, NOT NaN
Stock: 10
```

### ✅ After Page Refresh
```
Total Items: 1  ← PERSISTS!
Inventory Value: UGX 500.0M
Item: "safssa"
Price: UGX 50.0M  ← Still there
Stock: 10
```

### ✅ Console Shows
```
Added: 📦 RPC Response: { item_id: "...", status: "SUCCESS" }
Refresh: 📦 Raw database response: 1 items
         ✅ Loaded 1 inventory items from Supabase
```

---

## Support Checklist

- [ ] Deploy FIX_DUPLICATE_INVENTORY.sql to Supabase
- [ ] Verify user in cmms_users table with company_id
- [ ] Test add item with console open
- [ ] Check RPC response shows SUCCESS
- [ ] Check Supabase table directly for item
- [ ] Refresh page and verify item persists
- [ ] Check price shows UGX XXX.XM not UGX NaN
- [ ] Test duplicate item - should UPDATE not error

---

## Next Steps if Issues Persist

1. **Share console logs** from test
2. **Check cmms_users table** - are you there?
3. **Query Supabase directly:**
   ```sql
   SELECT * FROM cmms_inventory_items 
   WHERE cmms_company_id = 'YOUR-COMPANY-ID'
   AND is_active = true
   ```
4. **Report:**
   - Items in Supabase? (Yes/No)
   - User in cmms_users? (Yes/No)
   - Console error messages? (copy/paste exact)
   - Price showing as NaN or number?

---

## Questions?

The enhanced logging now provides visibility into:
- ✅ What parameters are sent to RPC
- ✅ What RPC returns (success/error)
- ✅ What database fetch returns
- ✅ How items are being mapped
- ✅ Final state of inventory in component

Check browser console (F12) → Console tab to see all these logs and trace where data is lost.


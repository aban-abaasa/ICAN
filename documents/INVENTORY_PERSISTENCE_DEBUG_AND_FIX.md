# Inventory Persistence Debugging & Fix Guide

## Problem Summary
✅ **IDENTIFIED:**
- Inventory items are **added successfully** (no error messages)
- Items **appear temporarily** in UI after adding
- Items **disappear after page refresh**
- Some items show **"UGX NaN"** for price instead of actual price
- Data not persisting from Supabase

**Root Cause:** Items may not be saved to database with is_active=true, OR there's a data mismatch in how unit_price is being stored/retrieved.

---

## Step 1: Deploy Latest RPC Function (CRITICAL)

The RPC function `fn_create_cmms_inventory_item` was just fixed to handle duplicates and ensure `is_active=TRUE`.

### In Supabase Dashboard:
1. Go to **SQL Editor**
2. Click **"New Query"**
3. Copy ALL content from this file:
   ```
   c:\Users\Aban\Desktop\ICAN\backend\FIX_DUPLICATE_INVENTORY.sql
   ```
4. **Paste** into the SQL editor
5. Click **"Run"** (expect confirmation: "Function updated...")
6. Verify in console: 
   ```
   Function updated to handle duplicate items - now UPDATEs instead of INSERT...
   ```

✅ **Expected Result:** RPC function now:
- Handles duplicate items by UPDATE instead of INSERT
- Sets `is_active = TRUE` on all new items
- Properly qualifies columns with table alias to avoid ambiguous errors

---

## Step 2: Enable Browser Console Logging

Enhanced logging has been added to track the data flow:

### Console Logs to Watch For:

**When Adding Item:**
```
📝 Adding inventory item via RPC function...
🔍 Parameters: { company_id: "...", item_name: "...", unit_price: 100 }
📦 RPC Response: { item_id: "...", status: "SUCCESS" }
✅ Inventory item created via RPC: safssa
```

**When Page Loads:**
```
📦 Fetching inventory for company: <company_id>
📦 Raw database response: X items
🔍 Sample item from database: { item_code: "...", unit_price: 100, ... }
✅ Mapped inventory: X items
✅ Loaded X inventory items from Supabase
  - safssa: ... @ UGX 100
```

---

## CRITICAL: Verify User Setup (ROW-LEVEL SECURITY CHECK)

**This is likely the root cause of items disappearing!**

Items are created successfully in the database, BUT the RLS policy prevents you from seeing them.

### Check if You're in cmms_users Table:

1. **Supabase Dashboard** → **Table Editor**
2. Open table: **`cmms_users`**
3. **FILTER** by your email:
   - Add filter: `email` → contains → **[your-email]**
4. **Look for:**
   - ✅ A row with your email
   - ✅ `cmms_company_id` column is NOT null
   - ✅ `is_active` column is TRUE
   - ✅ `cmms_company_id` matches your company UUID

### If You DON'T See Your User:

**This is the problem!** Items exist in database but RLS policy blocks you from seeing them.

**Solution:**
The user needs to be created in `cmms_users` table with the correct `cmms_company_id`.

This happens automatically when you:
1. Create a company via `createCompanyProfile()`
2. Create an admin user via `createAdminUser()`

**Check if this happened:**
- Look in CMSSModule logs for "CMMS Admin user created"
- Or manually create the user:
  1. Supabase Table Editor → cmms_users
  2. Click + to insert
  3. Fill in:
     - `email`: your email
     - `cmms_company_id`: your company UUID
     - `user_name`: your name
     - `is_active`: true
  4. Click Save

---



### Check What's Actually in Database:

1. Go to Supabase **Table Editor**
2. Open table: **`cmms_inventory_items`**
3. **FILTER** the table:
   - Add filter: `cmms_company_id` → equals → **[your-company-id]**
   - Add filter: `is_active` → equals → **true**

4. **Look for these columns:**
   - ✅ `item_code` - should have your item (e.g., "safssa")
   - ✅ `item_name` - should match what you entered
   - ✅ `unit_price` - should show the price you entered (NOT null)
   - ✅ `quantity_in_stock` - should be the stock you entered
   - ✅ `is_active` - should be **true**
   - ✅ `cmms_company_id` - should match your company UUID

**If items aren't there:**
- RPC function failed silently, OR
- Items were saved with wrong company_id

---

## Step 4: Test Inventory Creation Flow (Debug)

### A. Add Test Item:
1. In CMMS module, go to Inventory section
2. Click "Add Inventory Item"
3. Fill in:
   - Item Name: `TEST-DEBUG-001`
   - Item Code: `TST001`
   - Unit Price: `50.00`
   - Stock: `10`
   - Department: (select any)
4. Click **"Add Inventory Item"**
5. **IMMEDIATELY open browser console** (F12)

### B. Check Console Output:
Look for these logs in order:
1. `📝 Adding inventory item via RPC function...`
2. `🔍 Parameters: { ... unit_price: 50 ... }`
3. `📦 RPC Response: { status: "SUCCESS" }`

**If you see ERROR in response:**
- Note the exact error message
- Report back with that error

### C. Verify Item Appears:
- Should appear in inventory list with price **UGX 50.0M**
- Should show in "Total Items" count

### D. Refresh Page (F5):
1. **Before refreshing**, open console (F12)
2. Press **F5** to refresh
3. **Immediately check console** for:
   ```
   📦 Fetching inventory for company: <id>
   📦 Raw database response: X items
   🔍 Sample item from database: { item_code: "TST001", unit_price: 50, ... }
   ✅ Loaded X inventory items from Supabase
     - TST001: TEST-DEBUG-001 @ UGX 50
   ```

4. **Check UI:**
   - Item should still be there
   - Price should show as **UGX 50.0M** (NOT NaN)

---

## Debugging Checklist

| Step | Check | Expected | Status |
|------|-------|----------|--------|
| 1 | Deploy FIX_DUPLICATE_INVENTORY.sql | No errors, function updated | ⬜ |
| 2 | Add test item | Appears in UI with price | ⬜ |
| 3 | Check RPC console logs | `status: "SUCCESS"` | ⬜ |
| 4 | Query Supabase directly | Item exists with unit_price > 0 | ⬜ |
| 5 | Refresh page | Item still visible | ⬜ |
| 6 | Check fetch logs | Raw DB response shows item | ⬜ |
| 7 | Verify mapped item | unit_price is defined | ⬜ |
| 8 | Check UI display | Shows "UGX 50.0M" not "UGX NaN" | ⬜ |

---

## Common Issues & Solutions

### ❌ Issue: "UGX NaN" Shows After Adding Item

**Cause:** `unit_price` not being passed correctly to RPC or mapping function

**Fix Applied:** 
- Enhanced logging now shows unit_price being passed
- `addInventoryItem()` now explicitly sets both `unit_price` and `unit_cost` for compatibility

**Verify:**
1. Check console log during item creation
2. Look for: `unit_price: 50` (not 0, not undefined)
3. If it shows 0 or undefined, item was created with price = 0

---

### ❌ Issue: Item Disappears on Refresh

**Root Cause Analysis:**

Three possible scenarios:

**Scenario 1: Items not saved to database**
- RPC inserted the item but something failed
- Check: Console shows `status: "ERROR"` in RPC response
- Check: Supabase table is empty
- Fix: See RPC error message and report

**Scenario 2: Items saved but with wrong company_id**
- RPC might have bug with company_id parameter
- Check: Query Supabase → cmms_company_id column:
  ```sql
  SELECT item_code, cmms_company_id FROM cmms_inventory_items 
  WHERE item_code = 'safssa'
  ```
- Fix: Company ID must match what's in `CMSSModule` state
- Verify logging in console shows same company_id in RPC params and fetch

**Scenario 3: RLS policy blocking SELECT**
- Item exists in database but RLS prevents fetch
- Check: You get NO console error, just empty fetch response
- Check: Supabase table has items with correct company_id
- **This is the MOST LIKELY issue** if items exist in DB but don't fetch to UI

#### RLS Policy Details:

The table has a SELECT policy that filters items by:
```sql
cmms_company_id IN (
  SELECT cmms_company_id FROM cmms_users WHERE id = auth.uid()
)
```

**This means:**
- User must exist in `cmms_users` table with their company_id set
- If user is not in cmms_users, SELECT returns empty (no error!)
- This is why items seem to "disappear" - they exist but aren't fetched

**Check if user is in cmms_users:**
1. Supabase Dashboard → Table Editor
2. Open table: **cmms_users**
3. Look for your email (filter by email)
4. Verify:
   - ✅ User exists
   - ✅ `cmms_company_id` is set (not null)
   - ✅ `cmms_company_id` matches the company you created items for

**If user is missing from cmms_users:**
- Items are being created but you can't see them due to RLS
- Solution: Create admin user for the company via `createAdminUser()` function

---

### ❌ Issue: Error "duplicate key value violates unique constraint"

**Fixed By:** FIX_DUPLICATE_INVENTORY.sql now deployed
- RPC now checks if item exists
- If exists → UPDATE
- If not exists → INSERT

**Verify:** Try adding same item twice in same department
- First time: Should say "created successfully"
- Second time: Should say "updated successfully" (not error)

---

## What the Enhanced Logging Tells Us

### During Item Creation:
```javascript
📝 Adding inventory item via RPC function...
🔍 Parameters: { 
  company_id: "abc123",
  item_name: "safssa",
  unit_price: 100        // ← THIS MUST BE > 0, NOT 0
}
📦 RPC Response: { 
  item_code: "safssa",
  status: "SUCCESS"      // ← SHOWS IF RPC SUCCEEDED
}
```

### During Page Fetch:
```javascript
📦 Fetching inventory for company: abc123
📦 Raw database response: 1 items    // ← SHOWS ITEMS IN DB
🔍 Sample item from database: {
  item_code: "safssa",
  unit_price: 100                    // ← SHOWS SAVED PRICE
}
🔍 Mapping item safssa: {
  unit_price: 100                    // ← SHOWS IT'S BEING MAPPED
}
✅ Mapped inventory: 1 items
✅ Loaded 1 inventory items from Supabase
  - safssa: ... @ UGX 100            // ← FINAL DISPLAY
```

---

## Next Steps

1. **Deploy** FIX_DUPLICATE_INVENTORY.sql to Supabase
2. **Test** adding an item with detailed console logging
3. **Check** Supabase table directly to verify data exists
4. **Refresh** and verify item persists
5. **Report back** with:
   - Console logs from steps 2-4
   - What you see in Supabase table
   - Whether item persists after refresh

---

## File References

- **Frontend Service**: [c:\Users\Aban\Desktop\ICAN\frontend\src\lib\supabase\services\cmmsService.js](../frontend/src/lib/supabase/services/cmmsService.js)
  - Lines 81-93: `mapCmmsInventoryItem()` function
  - Lines 839-865: `getCompanyInventory()` function
  - Lines 900-975: `addInventoryItem()` function

- **Component**: [c:\Users\Aban\Desktop\ICAN\frontend\src\components\CMSSModule.jsx](../frontend/src/components/CMSSModule.jsx)
  - Lines 571-610: Inventory fetch on component load

- **Backend**: [c:\Users\Aban\Desktop\ICAN\backend\FIX_DUPLICATE_INVENTORY.sql](../backend/FIX_DUPLICATE_INVENTORY.sql)
  - RPC function that needs deployment


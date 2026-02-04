# RLS Policy Fix - Quick Start

## The Error
```
Profile updated but failed to save co-owners: 
new row violates row-level security policy for table "business_co_owners"
```

## The Fix (2 Steps)

### Step 1: Run SQL in Supabase
1. Open **Supabase Dashboard**
2. Go to **SQL Editor** (left sidebar)
3. Copy entire contents from: `backend/db/fix_coowners_rls.sql`
4. Paste into editor
5. Click **RUN** button
6. Wait for success message

### Step 2: Test
1. Go back to frontend
2. Try creating a business profile with co-owners
3. Should work now! ✅

---

## What Was Fixed

**Before**: Can't save co-owners (RLS blocked)
```
User: Add co-owner → Click Create → Error ❌
```

**After**: Co-owners save to database
```
User: Add co-owner → Click Create → Success ✅
```

---

## Why This Happened

The `business_co_owners` table had RLS enabled but was missing the INSERT/UPDATE/DELETE policies. Only SELECT policy existed, which blocked all writes.

**Policies Added**:
- ✅ INSERT - Let users add co-owners
- ✅ UPDATE - Let users modify co-owners  
- ✅ DELETE - Let users remove co-owners
- ✅ SELECT - Let users view co-owners

---

## Verification Checklist

After running the SQL:

- [ ] No errors in Supabase SQL Editor
- [ ] Can see success message
- [ ] Go to Database → business_co_owners → RLS tab
- [ ] See 4 policies listed:
  - [ ] Co-owners visible to profile members (SELECT)
  - [ ] Users can add co-owners to their profiles (INSERT)
  - [ ] Users can update co-owners of their profiles (UPDATE)
  - [ ] Users can delete co-owners from their profiles (DELETE)

---

## Test Flow

1. **Create Profile with Co-Owners**
   - Business Info step → fill in
   - Co-Owners step → add Alice (60%) + Bob (40%)
   - Review → click Create
   - ✅ Should complete successfully
   - ✅ Check console: "✅ Saved 2 co-owners successfully"

2. **Verify in Database**
   - Supabase → business_co_owners table
   - Should show 2 new records with co-owner data

3. **Edit Profile (Optional)**
   - Open existing profile
   - Modify co-owner percentages
   - Save
   - ✅ Should work

---

## If Still Having Issues

1. **Clear cache**: Ctrl+Shift+Delete (all time)
2. **Hard refresh**: Ctrl+F5
3. **Close/reopen**: Close tab, reopen Supabase
4. **Check policies**: Database → business_co_owners → RLS tab (4 policies?)
5. **Check Supabase logs**: Look for any policy errors

---

## Technical Details

The policies allow users to:
- Add co-owners to **their own** profiles
- Modify co-owners of **their own** profiles
- Remove co-owners from **their own** profiles
- View co-owners of **their own** profiles

But prevent users from:
- Adding co-owners to **other users'** profiles
- Modifying other users' co-owner lists
- Accessing co-owners they don't own

**Security** ✓ - RLS ensures data isolation at database level

---

## Files

**Fix SQL**: `backend/db/fix_coowners_rls.sql`
- Ready to run in Supabase SQL Editor
- Includes verification steps
- Includes testing guide

**Full Guide**: `RLS_POLICY_FIX_GUIDE.md`
- Detailed explanation
- Policy analysis
- Troubleshooting guide

**Schema**: `backend/db/schemas/04_business_profiles_blockchain.sql`
- Updated with complete policies
- For future deployments

---

## Summary

✅ **Problem**: RLS blocked co-owner insertion  
✅ **Solution**: Added INSERT/UPDATE/DELETE policies  
✅ **Security**: Maintains user data isolation  
✅ **Status**: Ready to apply and test

**Apply fix now and co-owners will save successfully!**

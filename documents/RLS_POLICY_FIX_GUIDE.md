# Co-Owners RLS Policy Fix

## Problem
**Error**: `Profile updated but failed to save co-owners: new row violates row-level security policy for table "business_co_owners"`

**Cause**: The `business_co_owners` table had RLS enabled but was **missing INSERT, UPDATE, and DELETE policies**. Only a SELECT policy existed, blocking all write operations.

---

## Root Cause Analysis

### What Was Configured (Incomplete)
```sql
ALTER TABLE public.business_co_owners ENABLE ROW LEVEL SECURITY;

-- Only this policy existed:
CREATE POLICY "Co-owners visible to profile members" 
    ON public.business_co_owners FOR SELECT ...  -- SELECT only!
```

**Missing Policies**:
- ❌ No INSERT policy → Can't add co-owners
- ❌ No UPDATE policy → Can't modify co-owners
- ❌ No DELETE policy → Can't remove co-owners

### RLS Logic
```
When RLS is ENABLED on a table:
├─ If INSERT policy exists → Can insert data
├─ If SELECT policy exists → Can read data
├─ If UPDATE policy exists → Can modify data
└─ If DELETE policy exists → Can delete data

If ANY operation has NO policy → DENIED ✗
```

In the broken setup:
```
SELECT co-owners: ✓ Policy exists → ALLOWED
INSERT co-owners: ✗ No policy → DENIED (the error you got)
UPDATE co-owners: ✗ No policy → DENIED
DELETE co-owners: ✗ No policy → DENIED
```

---

## The Fix

### Step 1: Run the Fix SQL Script

**File**: `backend/db/fix_coowners_rls.sql`

This script:
1. ✅ Drops any existing broken policies
2. ✅ Ensures RLS is enabled
3. ✅ Creates proper SELECT policy
4. ✅ Creates INSERT policy (fixes the error!)
5. ✅ Creates UPDATE policy
6. ✅ Creates DELETE policy

### Step 2: Apply in Supabase

1. Go to **Supabase Dashboard** → **SQL Editor**
2. Copy entire contents of `fix_coowners_rls.sql`
3. Paste into SQL Editor
4. Click **RUN**
5. Should see: `Success. No rows returned`

### Step 3: Verify the Fix

1. Go to **Supabase Dashboard** → **Authentication** → **Policies**
2. Or: **Database** → **business_co_owners** → **RLS** tab
3. Should see **4 policies**:
   - ✅ Co-owners visible to profile members (SELECT)
   - ✅ Users can add co-owners to their profiles (INSERT)
   - ✅ Users can update co-owners of their profiles (UPDATE)
   - ✅ Users can delete co-owners from their profiles (DELETE)

---

## How the Policies Work

### Policy Logic
All policies use the same security check:

```sql
EXISTS (
    SELECT 1 FROM public.business_profiles bp
    WHERE bp.id = business_co_owners.business_profile_id
    AND bp.user_id = auth.uid()
)
```

**Translation**:
- Is there a business_profile with this ID?
- Does that profile belong to the current user?
- If YES → Allow operation
- If NO → Block operation

### Example: User adds co-owner

```
User: alice@ican.com (auth.uid() = uuid-alice)
Creating profile for: "Tech Co"
Adding co-owner: Bob

Policy check for INSERT:
├─ business_profile_id = "uuid-techco"
├─ Does "Tech Co" profile exist? → YES ✓
├─ Is user_id = "uuid-alice"? → YES ✓ (she created it)
└─ INSERT ALLOWED → Co-owner saved ✓

Later, user bob tries to modify Bob's co-owner record:
├─ bob_user_id = "uuid-bob"
├─ Is user_id = "uuid-bob"? → NO ✗ (he doesn't own the profile)
└─ UPDATE BLOCKED → Security maintained ✓
```

---

## Security Model

### What This Protects

| Scenario | Before | After |
|----------|--------|-------|
| User adds co-owner to own profile | ❌ BLOCKED | ✅ ALLOWED |
| User modifies co-owner in own profile | ❌ BLOCKED | ✅ ALLOWED |
| User removes co-owner from own profile | ❌ BLOCKED | ✅ ALLOWED |
| User adds co-owner to someone else's profile | N/A | ✅ BLOCKED |
| Unauthorized user modifies co-owners | N/A | ✅ BLOCKED |

### Security Principles

✅ **User Isolation**: Users can only manage their own profiles
✅ **Ownership-Based**: Profile owner controls co-owners
✅ **Non-Transferable**: Can't grant yourself permissions to others' data
✅ **RLS Enforcement**: Database enforces, not just frontend

---

## After Applying the Fix

### What Changes in Frontend

**Before**:
```
Create profile with co-owners
  ↓
Error: "violates row-level security policy"
  ↓
Co-owners NOT saved
```

**After**:
```
Create profile with co-owners
  ↓
Co-owners INSERT → Allowed by RLS ✓
  ↓
✅ "Profile updated successfully!"
  ↓
Co-owners saved in database ✓
```

### Test the Fix

1. **Create New Profile**
   - Fill business info
   - Add Alice (60%) + Bob (40%)
   - Click "Create Business Profile"
   - ✅ Should succeed now
   - ✅ Console shows: "✅ Saved 2 co-owners successfully"

2. **Verify in Database**
   - Open Supabase Dashboard
   - Go to `business_co_owners` table
   - Should see 2 new records:
     ```
     owner_name: Alice, ownership_share: 60
     owner_name: Bob, ownership_share: 40
     ```

3. **Edit Profile**
   - Open existing profile
   - Modify co-owner percentages
   - Click Save
   - ✅ Updates should work now

---

## Files Modified

### 1. Schema File (Going Forward)
**File**: `backend/db/schemas/04_business_profiles_blockchain.sql`
- ✅ Updated with complete RLS policies
- ✅ All 4 policies included
- ✅ Better documentation

### 2. Fix Script (Immediate Use)
**File**: `backend/db/fix_coowners_rls.sql`
- ✅ Complete RLS fix
- ✅ Drops old policies first
- ✅ Creates all 4 policies
- ✅ Includes verification checklist
- ✅ Includes testing guide

---

## Detailed Policy Explanations

### SELECT Policy
```sql
CREATE POLICY "Co-owners visible to profile members"
ON public.business_co_owners FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.business_profiles bp
        WHERE bp.id = business_co_owners.business_profile_id
        AND bp.user_id = auth.uid()
    )
);
```

**Purpose**: Users can see co-owners of profiles they own

**Example**: 
- Alice created profile → can see its co-owners ✓
- Bob didn't create profile → can't see its co-owners ✗

---

### INSERT Policy
```sql
CREATE POLICY "Users can add co-owners to their profiles"
ON public.business_co_owners FOR INSERT
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.business_profiles bp
        WHERE bp.id = business_co_owners.business_profile_id
        AND bp.user_id = auth.uid()
    )
);
```

**Purpose**: Users can only add co-owners to their own profiles

**Example**:
- Alice adds co-owner to her profile → allowed ✓
- Bob adds co-owner to Alice's profile → blocked ✗

---

### UPDATE Policy
```sql
CREATE POLICY "Users can update co-owners of their profiles"
ON public.business_co_owners FOR UPDATE
USING (
    EXISTS (
        SELECT 1 FROM public.business_profiles bp
        WHERE bp.id = business_co_owners.business_profile_id
        AND bp.user_id = auth.uid()
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.business_profiles bp
        WHERE bp.id = business_co_owners.business_profile_id
        AND bp.user_id = auth.uid()
    )
);
```

**Purpose**: Users can only modify co-owners of their own profiles

**Two Conditions**:
- `USING`: Check old record belongs to user
- `WITH CHECK`: Check new record still belongs to user

---

### DELETE Policy
```sql
CREATE POLICY "Users can delete co-owners from their profiles"
ON public.business_co_owners FOR DELETE
USING (
    EXISTS (
        SELECT 1 FROM public.business_profiles bp
        WHERE bp.id = business_co_owners.business_profile_id
        AND bp.user_id = auth.uid()
    )
);
```

**Purpose**: Users can only remove co-owners from their own profiles

**Example**:
- Alice removes co-owner from her profile → allowed ✓
- Bob removes co-owner from Alice's profile → blocked ✗

---

## Why This Error Happened

### Timeline
1. ✅ Table `business_co_owners` created with RLS enabled
2. ✅ SELECT policy was added (for reading co-owners)
3. ❌ INSERT/UPDATE/DELETE policies were forgotten
4. ❌ Frontend tried to INSERT → RLS blocked it
5. ❌ User saw error: "violates row-level security policy"

### Missing Link
When only SELECT policy exists and INSERT is attempted:
```
INSERT INTO business_co_owners (...)
  ↓
RLS checks: Is there an INSERT policy?
  → NO
  ↓
RLS blocks: DEFAULT DENY
  ↓
Error: "violates row-level security policy"
```

---

## Next Steps After Fix

1. ✅ Apply `fix_coowners_rls.sql` to Supabase
2. ✅ Verify 4 policies exist in RLS settings
3. ✅ Test creating profile with co-owners
4. ✅ Check database has co-owner records
5. ✅ Test editing profile co-owners
6. ✅ Confirm data persists on page refresh

---

## Troubleshooting

### Issue: Still Getting RLS Error After Applying Fix

**Solution**:
1. Clear browser cache (Ctrl+Shift+Delete)
2. Hard refresh page (Ctrl+F5)
3. Check Supabase console logs for errors
4. Verify policies exist in RLS tab
5. Try different browser (rule out cache)

### Issue: Policies Show as "DROP IF EXISTS" Failed

**Solution**:
- This is normal if policies don't exist yet
- Script handles this with `DROP POLICY IF EXISTS`
- Continue with RUN - rest will succeed

### Issue: Can't See Policies in RLS Tab

**Solution**:
1. Refresh Supabase page
2. Go to Database → business_co_owners table
3. Click "RLS" tab again
4. Should see 4 policies listed

---

## Summary

**Problem**: Missing RLS policies blocked INSERT operations  
**Solution**: Added 4 complete policies (SELECT, INSERT, UPDATE, DELETE)  
**Security**: Policies ensure users can only manage their own co-owners  
**Result**: Co-owners now save successfully to database  

✅ **Status**: Ready to test!


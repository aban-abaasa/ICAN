# 🔧 FIX: Policy Already Exists Error (42710)

## The Error
```
ERROR: 42710: policy "Users can view cycles" 
for table "trust_cycles" already exists

(or any other policy on trust_groups, trust_group_members, trust_transactions, trust_cycles, or trust_disputes)
```

## Cause
The RLS policies already exist in your database (from a previous run of the deployment or fix scripts). When trying to recreate them, PostgreSQL throws error 42710.

**This happens because:**
- You ran the deployment script multiple times
- Previous deployments partially completed
- Policies exist from old versions of the script

---

## ✅ QUICK FIX (Choose ONE)

### Option A: Run Updated Deployment Script (EASIEST) ← **TRY THIS FIRST**
I've updated all scripts to comprehensively drop ALL existing policies before creating new ones.

**Copy this into Supabase SQL Editor:**
```
backend/db/DEPLOY_TRUST_SYSTEM.sql
```

- Paste entire script
- Click "Run"  
- Should complete without errors ✓
- Refresh browser (Ctrl+F5)

---

### Option B: Nuclear Cleanup Script (STRONGEST) ← **IF OPTION A FAILS**
Use the comprehensive cleanup script that removes all policies from all tables:

**Copy this into Supabase SQL Editor:**
```
backend/db/CLEANUP_ALL_TRUST_POLICIES.sql
```

This script:
1. ✓ Removes ALL policies from all 5 trust tables
2. ✓ Verifies RLS is enabled
3. ✓ Recreates clean policies
4. ✓ Shows verification report

- Paste entire script
- Click "Run"
- Should complete without errors ✓
- Refresh browser (Ctrl+F5)

---

### Option C: Manual Cleanup Step-by-Step

If neither option above works, manually cleanup:

```sql
-- STEP 1: Drop ALL policies from ALL tables

-- From trust_groups (3 policies)
DROP POLICY IF EXISTS "Anyone can view active groups" ON public.trust_groups;
DROP POLICY IF EXISTS "Creators can update their groups" ON public.trust_groups;
DROP POLICY IF EXISTS "Users can create groups" ON public.trust_groups;

-- From trust_group_members (3 policies)
DROP POLICY IF EXISTS "Users can view group members" ON public.trust_group_members;
DROP POLICY IF EXISTS "Users can join groups" ON public.trust_group_members;
DROP POLICY IF EXISTS "Users can update their own membership" ON public.trust_group_members;

-- From trust_transactions (3 policies)
DROP POLICY IF EXISTS "Users can view transactions" ON public.trust_transactions;
DROP POLICY IF EXISTS "Users can create transactions" ON public.trust_transactions;
DROP POLICY IF EXISTS "System can verify transactions" ON public.trust_transactions;

-- From trust_cycles (2 policies) ← Often forgotten, causes error
DROP POLICY IF EXISTS "Users can view cycles" ON public.trust_cycles;
DROP POLICY IF EXISTS "System can manage cycles" ON public.trust_cycles;

-- From trust_disputes (2 policies) ← Often forgotten, causes error
DROP POLICY IF EXISTS "Users can view disputes" ON public.trust_disputes;
DROP POLICY IF EXISTS "Users can create disputes" ON public.trust_disputes;

SELECT 'Step 1: All policies dropped ✓' as status;
```

Then run:
```
backend/db/DEPLOY_TRUST_SYSTEM.sql
```

---

## What Gets Fixed

### Updated Deployment Scripts Now Include:

**For `trust_groups` (3 policies):**
- ✓ Anyone can view active groups
- ✓ Users can create groups
- ✓ Creators can update their groups

**For `trust_group_members` (3 policies):**
- ✓ Users can view group members
- ✓ Users can join groups
- ✓ Users can update their own membership

**For `trust_transactions` (3 policies):**
- ✓ Users can view transactions
- ✓ Users can create transactions
- ✓ System can verify transactions

**For `trust_cycles` (2 policies):** ← **This was missing, now added**
- ✓ Users can view cycles
- ✓ System can manage cycles

**For `trust_disputes` (2 policies):** ← **This was missing, now added**
- ✓ Users can view disputes
- ✓ Users can create disputes

**Total: 13 clean, non-recursive policies**

---

## Verify It Worked

After running any fix, verify:

```sql
-- Check policy count by table
SELECT 
    tablename,
    COUNT(*) as policy_count
FROM pg_policies 
WHERE schemaname = 'public' 
AND tablename LIKE 'trust_%'
GROUP BY tablename
ORDER BY tablename;

-- Expected output:
-- trust_disputes       | 2
-- trust_group_members  | 3
-- trust_groups         | 3
-- trust_transactions   | 3
-- trust_cycles         | 2
```

If all counts match, deployment was successful ✓

---

## Files Reference

| File | Purpose | When to Use |
|------|---------|-------------|
| `DEPLOY_TRUST_SYSTEM.sql` | Main deployment | First try |
| `CLEANUP_ALL_TRUST_POLICIES.sql` | **Nuclear cleanup** | If deployment fails |
| `FIX_RLS_INFINITE_RECURSION.sql` | RLS fixes | For 42P17 errors |

---

## Common Issues & Fixes

### Still Getting Error After Running Script?

**Possible causes:**
1. Browser cache - clear with Ctrl+Shift+Delete
2. Script didn't paste completely - copy again
3. Wrong policy names - use cleanup script
4. Multiple old versions - run cleanup then deploy

### Getting Different Error Codes?

- **42P01** = Table missing → Run `DEPLOY_TRUST_SYSTEM.sql`
- **42P17** = RLS recursion → Run `FIX_RLS_INFINITE_RECURSION.sql`
- **42710** = Policy exists → Run cleanup script above ← **You are here**

---

## Step-by-Step Recovery

| Step | Action | If Fails |
|------|--------|---------|
| 1 | Run `DEPLOY_TRUST_SYSTEM.sql` | → Go to Step 2 |
| 2 | Run `CLEANUP_ALL_TRUST_POLICIES.sql` | → Go to Step 3 |
| 3 | Clear cache (Ctrl+Shift+Delete) | → Go to Step 4 |
| 4 | Hard refresh (Ctrl+F5) | → Try Step 1 again |

---

## Why All These Updates?

The original deployment script was missing DROP statements for `trust_cycles` and `trust_disputes` policies, causing the 42710 error even on fresh deployments.

**Now fixed:**
- ✓ All 5 tables have comprehensive DROP statements
- ✓ All policy name variations covered
- ✓ Cleanup script available as nuclear option
- ✓ Frontend error handling for all cases

---

**Status:** Fixed and ready to deploy  
**Error Code:** 42710  
**Severity:** Policy cleanup required  
**Last Updated:** February 10, 2026

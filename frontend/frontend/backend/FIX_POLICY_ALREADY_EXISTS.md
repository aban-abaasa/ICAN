# 🔧 FIX: Policy Already Exists Error (42710)

## The Error
```
ERROR: 42710: policy "Creators can update their groups" 
for table "trust_groups" already exists
```

## Cause
The RLS policies already exist in your database (from a previous run of the deployment script or the fix script). When trying to recreate them, PostgreSQL complains the policy already exists.

---

## ✅ QUICK FIX (Choose ONE)

### Option A: Run Updated Deployment Script (EASIEST)
I've updated the scripts to comprehensively drop ALL existing policies before creating new ones.

1. **Copy the updated script:**
   ```
   backend/db/DEPLOY_TRUST_SYSTEM.sql  (now has full DROP IF EXISTS)
   ```

2. **In Supabase SQL Editor:**
   - Paste entire script
   - Click "Run"
   - Should complete without errors ✓

---

### Option B: Manual Cleanup + Deploy

If the above doesn't work, manually clean up first:

```sql
-- Copy this into Supabase SQL Editor
-- It comprehensively removes all policies

-- From trust_groups
DROP POLICY IF EXISTS "Users can view groups they created" ON public.trust_groups;
DROP POLICY IF EXISTS "Users can view groups they joined" ON public.trust_groups;
DROP POLICY IF EXISTS "Users can create groups" ON public.trust_groups;
DROP POLICY IF EXISTS "Only creators can update" ON public.trust_groups;
DROP POLICY IF EXISTS "Anyone can view active groups" ON public.trust_groups;
DROP POLICY IF EXISTS "Creators can update their groups" ON public.trust_groups;

-- From trust_group_members
DROP POLICY IF EXISTS "Users can view group members" ON public.trust_group_members;
DROP POLICY IF EXISTS "Users can view their membership" ON public.trust_group_members;
DROP POLICY IF EXISTS "Users can request membership" ON public.trust_group_members;
DROP POLICY IF EXISTS "Users can join groups" ON public.trust_group_members;
DROP POLICY IF EXISTS "Users can update their own membership" ON public.trust_group_members;

-- From trust_transactions
DROP POLICY IF EXISTS "Users can view group transactions" ON public.trust_transactions;
DROP POLICY IF EXISTS "Users can create transactions" ON public.trust_transactions;
DROP POLICY IF EXISTS "Users can view transactions" ON public.trust_transactions;
DROP POLICY IF EXISTS "System can verify transactions" ON public.trust_transactions;

-- Success message
SELECT 'All policies dropped successfully' as status;
```

Then run the deployment script again.

---

### Option C: Nuclear Option (If above doesn't work)

Keep RLS but disable it temporarily, then redeploy:

```sql
-- Temporarily disable RLS
ALTER TABLE public.trust_groups DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.trust_group_members DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.trust_transactions DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.trust_cycles DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.trust_disputes DISABLE ROW LEVEL SECURITY;

SELECT 'RLS disabled - now deploy fresh' as status;
```

Then run `DEPLOY_TRUST_SYSTEM.sql` → This will create everything fresh.

---

## Why This Happens

The deployment script tries to **CREATE** a policy that's already in the database. While the script has `DROP IF EXISTS` statements, it only drops policies with exact name matches. Any variation in policy names can cause this.

**Fix:** Updated scripts now drop ALL known variations of policy names.

---

## Prevention

**For future runs:**
- The updated scripts now comprehensively drop all policies
- If running multiple times, you won't get this error again
- Same fix works for both `DEPLOY_TRUST_SYSTEM.sql` and `FIX_RLS_INFINITE_RECURSION.sql`

---

## Verify It's Fixed

After running the fix:

```sql
-- Check policies are clean and new
SELECT tablename, policyname 
FROM pg_policies 
WHERE schemaname = 'public' 
AND tablename LIKE 'trust_%'
ORDER BY tablename, policyname;

-- You should see exactly these policies:
-- trust_disputes       | (none - will be added in full deployment)
-- trust_group_members  | Users can join groups
--                      | Users can update their own membership
--                      | Users can view group members
-- trust_groups         | Anyone can view active groups
--                      | Creators can update their groups
--                      | Users can create groups
-- trust_transactions   | System can verify transactions
--                      | Users can create transactions
--                      | Users can view transactions
```

---

## Summary

| Step | Action |
|------|--------|
| **1** | Run updated `DEPLOY_TRUST_SYSTEM.sql` |
| **2** | If error persists → Run manual cleanup |
| **3** | Then run deployment script again |
| **4** | Refresh browser (Ctrl+F5) |
| **5** | Test feature ✓ |

**Time to fix:** 2-3 minutes

---

**Status:** Fixed in updated scripts  
**Error Code:** 42710  
**Last Updated:** February 10, 2026

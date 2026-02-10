# 🔧 FIX: Column "raised_by" Does Not Exist (42703)

## The Error
```
ERROR: 42703: column "raised_by" does not exist
HINT: Perhaps you meant to reference the column "trust_disputes.raised_by_id"
```

## Root Cause
The `trust_disputes` table has a column named `raised_by_id` (not `raised_by`), but the deployment script was referencing it as `raised_by` in:
1. The CREATE TABLE statement
2. The RLS policy WITH CHECK clause

## Fix Applied

All scripts have been updated to use the correct column name:

### Changed Files:
1. ✅ `DEPLOY_TRUST_SYSTEM.sql` - Column: `raised_by` → `raised_by_id`
2. ✅ `CLEANUP_ALL_TRUST_POLICIES.sql` - RLS policy: `raised_by` → `raised_by_id`
3. ✅ `FIX_RLS_INFINITE_RECURSION.sql` - RLS policy: `raised_by` → `raised_by_id`

### What Changed:

**Before:**
```sql
CREATE TABLE IF NOT EXISTS public.trust_disputes (
    ...
    raised_by UUID NOT NULL REFERENCES auth.users(id),
    ...
);

CREATE POLICY "Users can create disputes"
    ON public.trust_disputes FOR INSERT
    WITH CHECK (raised_by = auth.uid());  -- ❌ Wrong column name
```

**After:**
```sql
CREATE TABLE IF NOT EXISTS public.trust_disputes (
    ...
    raised_by_id UUID NOT NULL REFERENCES auth.users(id),  -- ✅ Correct
    ...
);

CREATE POLICY "Users can create disputes"
    ON public.trust_disputes FOR INSERT
    WITH CHECK (raised_by_id = auth.uid());  -- ✅ Correct
```

---

## ✅ What to Do Now

### Option 1: Fresh Deployment (RECOMMENDED)
If your database is fresh/clean:

```sql
-- Copy: backend/db/DEPLOY_TRUST_SYSTEM.sql
-- Paste in Supabase SQL Editor
-- Click "Run"
```

This will create tables with correct column names.

---

### Option 2: Fix Existing Tables
If you already have `trust_disputes` table with `raised_by_id`:

```sql
-- 1. Drop the disputes table and recreate
DROP TABLE IF EXISTS public.trust_disputes CASCADE;

-- 2. Recreate with correct column name
CREATE TABLE IF NOT EXISTS public.trust_disputes (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    transaction_id UUID REFERENCES public.trust_transactions(id) ON DELETE CASCADE,
    group_id UUID NOT NULL REFERENCES public.trust_groups(id) ON DELETE CASCADE,
    raised_by_id UUID NOT NULL REFERENCES auth.users(id),  -- ✅ Correct in DB
    reason TEXT NOT NULL,
    resolution TEXT,
    status VARCHAR(50) DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'resolved', 'closed')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    CONSTRAINT dispute_amount CHECK (true)
);

-- 3. Enable RLS
ALTER TABLE public.trust_disputes ENABLE ROW LEVEL SECURITY;

-- 4. Create policies with CORRECT column name
CREATE POLICY "Users can view disputes"
    ON public.trust_disputes FOR SELECT
    USING (true);

CREATE POLICY "Users can create disputes"
    ON public.trust_disputes FOR INSERT
    WITH CHECK (raised_by_id = auth.uid());  -- ✅ Correct
```

---

## Database Schema Summary

### trust_disputes Table
```sql
Column Name          | Type | Notes
---------------------|------|-------
id                   | UUID | Primary key
transaction_id       | UUID | References trust_transactions
group_id             | UUID | References trust_groups
raised_by_id         | UUID | References auth.users ✅ (Not "raised_by")
reason               | TEXT | Dispute reason
resolution           | TEXT | Resolution text
status               | VARCHAR | open/investigating/resolved/closed
created_at           | TIMESTAMPTZ | When created
resolved_at          | TIMESTAMPTZ | When resolved
```

---

## Next Steps

1. **Run the updated deployment script:**
   ```
   backend/db/DEPLOY_TRUST_SYSTEM.sql
   ```

2. **Verify it works:**
   ```sql
   -- Check column exists
   SELECT column_name FROM information_schema.columns 
   WHERE table_name = 'trust_disputes' AND column_name = 'raised_by_id';
   
   -- Should return: raised_by_id
   ```

3. **Refresh browser:**
   ```
   Ctrl+Shift+Delete (clear cache)
   Ctrl+F5 (hard refresh)
   ```

4. **Test the feature:**
   - Navigate to Trust Management
   - Should load without errors ✓

---

## Prevention

All deployment scripts now consistently use `raised_by_id`:
- ✅ CREATE TABLE statements
- ✅ RLS policies
- ✅ Cleanup scripts

No more column name mismatches!

---

**Status:** Fixed  
**Error Code:** 42703  
**Related Codes:** 42P01 (table not found), 42P17 (RLS recursion)  
**Last Updated:** February 10, 2026

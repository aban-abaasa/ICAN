# Trust System Database Deployment Guide

## Error Summary
```
relation "public.trust_transactions" does not exist
```

This error occurs because the `trust_transactions` table and related trust system tables haven't been created in your Supabase database.

## Root Cause
The Trust Management (SACCO) feature requires 5 core tables:
1. `trust_groups` - Savings group definitions
2. `trust_group_members` - Group membership tracking
3. `trust_transactions` - Transaction records (MISSING - causing the error)
4. `trust_cycles` - Contribution cycles
5. `trust_disputes` - Dispute tracking

These tables are referenced in:
- `/frontend/src/services/trustService.js` (lines 657, 778)
- `/frontend/src/components/TrustSystem.jsx`
- `/frontend/src/components/SACCOHub.jsx`

## Solution

### Method 1: Deploy via Supabase SQL Editor (Recommended)

1. **Open Supabase Dashboard**
   - Go to https://app.supabase.com
   - Select your project
   - Navigate to "SQL Editor"

2. **Create New Query**
   - Click "New query"
   - Copy the contents from: `/backend/db/DEPLOY_TRUST_SYSTEM.sql`

3. **Execute the Script**
   - Paste the full SQL script
   - Click "Run"
   - Verify "All successful" message appears

4. **Verify Tables Created**
   - Go to "Database" → "Tables"
   - Check that these tables exist:
     - ✓ `trust_groups`
     - ✓ `trust_group_members`
     - ✓ `trust_transactions`
     - ✓ `trust_cycles`
     - ✓ `trust_disputes`

### Method 2: Deploy via psql Command Line

```bash
# If you have psql installed:
psql -h hswxazpxcgtqbxeqcxxw.supabase.co \
     -U postgres \
     -d postgres \
     -f backend/db/DEPLOY_TRUST_SYSTEM.sql

# You'll be prompted for your database password
```

### Method 3: Check Existing Schema File

If you've already run `/backend/db/trust_system_schema.sql`, the tables should exist. If not:

1. **Check if trust_system_schema.sql was deployed:**
   - In Supabase SQL Editor
   - Copy entire contents of `backend/db/trust_system_schema.sql`
   - Run the script

2. **Then verify in Tables view**

## What Gets Created

### trust_transactions Table Schema
```sql
CREATE TABLE public.trust_transactions (
    id UUID PRIMARY KEY,                    -- Unique transaction ID
    group_id UUID NOT NULL,                 -- Reference to savings group
    from_user_id UUID NOT NULL,             -- Who sent money
    to_user_id UUID NOT NULL,               -- Who received money
    
    amount DECIMAL(15,2) NOT NULL,          -- Transaction amount
    currency VARCHAR(10) DEFAULT 'USD',     -- Currency type
    transaction_type VARCHAR(50),           -- 'contribution', 'payout', 'penalty', 'refund'
    description TEXT,                        -- Transaction notes
    
    blockchain_hash VARCHAR(255),           -- Blockchain verification hash
    blockchain_status VARCHAR(50),          -- 'pending', 'confirmed', 'failed'
    is_verified BOOLEAN DEFAULT FALSE,      -- Blockchain verification status
    
    created_at TIMESTAMPTZ DEFAULT NOW(),   -- When transaction occurred
    verified_at TIMESTAMPTZ                 -- When verified
);
```

## Frontend Impact

After deployment, these services will work:

✓ **getTrustGroupDetails** - Fetch group with transactions
✓ **getGroupStatistics** - Get contribution statistics
✓ **verifyBlockchainTransaction** - Mark transactions as verified
✓ **recordTrustTransaction** - Create new transactions
✓ **MySACCOs Component** - Display user's groups
✓ **TrustSystem Component** - Show trust group details

## Testing After Deployment

1. **Refresh Browser**
   - Clear cache: Ctrl+Shift+Delete
   - Reload the page

2. **Navigate to Trust Management**
   - Click "My Trusts" or "SACCOHub"
   - Should load without 404 errors

3. **Check Browser Console**
   - Open DevTools: F12
   - Go to Console tab
   - Should NOT see errors about "trust_transactions does not exist"

4. **Verify in Supabase SQL Editor**
   ```sql
   -- Count tables
   SELECT COUNT(*) FROM information_schema.tables 
   WHERE table_schema = 'public' 
   AND table_name LIKE 'trust_%';
   
   -- Should return: 5
   ```

## Troubleshooting

### Error: "relation "public.trust_transactions" does not exist"
- ❌ The SQL script didn't run
- ✓ Re-run `DEPLOY_TRUST_SYSTEM.sql` in Supabase

### Error: "permission denied"
- ❌ Your Supabase user doesn't have table creation rights
- ✓ Use your project's owner account or ask your admin

### Tables exist but queries still fail
- ❌ RLS policies might be blocking access
- ✓ Check RLS policies are properly created (script includes these)
- ✓ Verify auth.uid() function is available

### Cannot find Supabase SQL Editor
- ✓ In Supabase dashboard, left sidebar → SQL Editor
- ✓ Or direct URL: `https://app.supabase.com/project/YOUR_PROJECT/sql/new`

## Files Involved

| File | Purpose |
|------|---------|
| `backend/db/DEPLOY_TRUST_SYSTEM.sql` | **Complete deployment script** |
| `backend/db/trust_system_schema.sql` | Original schema definition |
| `frontend/src/services/trustService.js` | Uses these tables |
| `frontend/src/components/TrustSystem.jsx` | Displays trust data |
| `frontend/src/components/SACCOHub.jsx` | Manages groups |

## Next Steps

1. ✅ Run deployment script
2. ✅ Verify tables exist
3. ✅ Clear browser cache & reload
4. ✅ Test Trust Management features
5. ✅ Monitor console for errors

## Support

If issues persist:
1. Check all tables are in "public" schema (not private)
2. Verify RLS policies were created
3. Check user has proper authentication
4. Review Supabase database logs for errors

---
**Last Updated:** February 10, 2026  
**Deployment Method:** Supabase SQL Editor (Recommended)

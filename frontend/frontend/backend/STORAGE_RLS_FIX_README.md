# Fix Status Upload RLS Policy Error

## Error
```
StorageApiError: new row violates row-level security policy
```

## Root Cause
The Supabase storage bucket doesn't have the correct RLS (Row-Level Security) policies for the `user-content` bucket.

## Solution

### Option 1: Run SQL in Supabase (Recommended)

1. Go to your Supabase Dashboard → **SQL Editor**
2. Create a new query
3. Copy and paste the contents of `fix_status_rls_policies.sql`
4. Click **Run**
5. Verify the output shows the new policies

### Option 2: Run via Node.js

```bash
cd ICAN/backend
node fix_status_storage_policies.js
```

Make sure these environment variables are set:
```bash
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

## What Gets Fixed

The script creates these RLS policies for the `user-content` storage bucket:

| Policy | Action | Condition |
|--------|--------|-----------|
| Anyone can view statuses | SELECT | bucket_id = 'user-content' |
| Authenticated users can upload statuses | INSERT | bucket_id = 'user-content' AND authenticated |
| Users can update their own statuses | UPDATE | bucket_id = 'user-content' AND authenticated |
| Users can delete their own statuses | DELETE | bucket_id = 'user-content' AND authenticated |

## After Applying

- Status uploads should work ✅
- File hashing for blockchain verification ✅
- Smart contract registration ready ✅

## Troubleshooting

If you still get RLS errors:

1. **Check bucket exists**: Go to Supabase Storage → verify `user-content` bucket exists
2. **Check RLS is enabled**: Settings → Storage → verify `user-content` has RLS enabled
3. **Check authentication**: Verify you're logged in as an authenticated user
4. **Check policies**: SQL Editor → run:
   ```sql
   SELECT tablename, policyname FROM pg_policies 
   WHERE schemaname = 'storage' AND tablename = 'objects';
   ```

## Files

- `fix_status_rls_policies.sql` - SQL script to run in Supabase
- `fix_status_storage_policies.js` - Node.js script for automated setup

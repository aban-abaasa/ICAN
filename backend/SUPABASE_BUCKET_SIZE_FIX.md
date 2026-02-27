# Fix: Increase Supabase Storage Bucket Size Limit

## Problem
💥 **Error:** "The object exceeded the maximum allowed size"
- Video file: 74.35MB
- Bucket limit: Currently too low (likely 50MB or less)

## Solution
Increase the 'pitches' bucket max file size to **100MB** or higher.

### Option 1: Via Supabase Dashboard (Recommended)
1. Go to **Supabase Dashboard** → https://app.supabase.com
2. Select your project
3. Navigate to **Storage** → **Buckets**
4. Click the **gear icon ⚙️** next to 'pitches' bucket
5. Expand **Advanced Settings**
6. Set **Max file size** to `100` MB
7. Click **Save**

### Option 2: Via SQL Script (if available in future versions)
```sql
-- Update bucket configuration via Supabase API
-- Note: Currently bucket settings are not directly editable via SQL
-- Use the dashboard method above instead
```

### Option 3: Via Supabase CLI
If you have Supabase CLI installed:

```bash
# Update bucket size limit
supabase storage buckets update pitches --max-size 100000000

# Where 100000000 = 100MB in bytes
```

## Bucket Configuration Needed
- **Bucket name:** pitches
- **Max file size:** 100MB (100,000,000 bytes)
- **Allowed MIME types:** 
  - video/mp4
  - video/quicktime
  - video/webm
  - image/jpeg
  - image/png
  - image/webp

## Verify Upload Works
After increasing the limit:
1. **Hard refresh browser:** `Ctrl+Shift+R` (Windows) or `Cmd+Shift+R` (Mac)
2. Try uploading your 74.35MB video again
3. Check console for success message: ✅ Storage upload SUCCESSFUL

## Upload Size Guidelines
After fix, these upload sizes will work:
- ✅ 5-minute video (74.35MB) - **NOW SUPPORTED**
- ✅ 10-minute video (~150MB) - still needs compression
- ❌ Files over 100MB - will still fail

## Troubleshooting
If upload still fails after bucket update:
1. Clear browser cache: `Ctrl+Shift+Delete`
2. Check Supabase dashboard bucket settings are saved
3. Verify file is actually the size shown (not corrupted)
4. Contact Supabase support if limit still enforced

# 🎬 Pitch Video Upload - Storage Configuration Guide

## Problem: "Video unavailable" Error

When users try to watch pitch videos, they see:
```
Video unavailable
The pitch video could not be loaded
```

This happens because:
1. **Missing RLS Policies** - Supabase storage bucket permissions not set up
2. **Authentication Issues** - User not authenticated when uploading
3. **Storage Bucket** - Not configured or not public

---

## Solution: 3-Step Fix

### Step 1: Enable Storage Bucket in Supabase

1. Go to [Supabase Dashboard](https://app.supabase.com)
2. Select your project
3. Navigate to **Storage** → **Buckets**
4. **Create a new bucket** named `pitches`:
   - Name: `pitches`
   - Public/Private: **PUBLIC** (uncheck "Public bucket" checkbox if you want to use policies)
   - File size limit: 500MB (adjust as needed)

### Step 2: Apply Storage Policies

**Option A: Manual (Recommended)**

1. In Supabase Dashboard, go to **SQL Editor**
2. Create a new query
3. Copy the entire content from: `ICAN/backend/db/fix_pitches_storage_policies.sql`
4. Paste it into the SQL Editor
5. Click **Run**
6. You should see: `Query executed successfully`

**Option B: Using Node.js Script**

```bash
cd ICAN/backend
npm install  # if needed
node fix_pitches_storage_policies.js
```

This requires `SUPABASE_SERVICE_ROLE_KEY` in your `.env` file.

---

## What These Policies Do

| Policy | Action | Who | Allows |
|--------|--------|-----|--------|
| Upload pitch videos | INSERT | Authenticated Users | Create new video files |
| View pitch videos | SELECT | Everyone | Download/stream videos |
| Update videos | UPDATE | Authenticated Users | Replace video files |
| Delete videos | DELETE | Authenticated Users | Remove video files |

---

## Verification Checklist

After applying policies, verify everything is working:

✅ **Storage Bucket Exists**
- Supabase Dashboard → Storage → Check `pitches` bucket exists

✅ **Policies Applied**
- Supabase Dashboard → Storage → `pitches` → Policies tab
- Should see 4 policies listed

✅ **User Authentication**
- Must be logged in to upload videos
- Browser console should show: `Fetching current user...` with user data

✅ **Video Upload**
- Browser console shows: `✅ Video uploaded to: pitches/[pitch-id]/...`
- Public URL generated: `https://[supabase-url].supabase.co/storage/v1/object/public/pitches/...`

✅ **Video Playback**
- Video loads without "Video unavailable" error
- Can use video controls (play, pause, mute)

---

## Troubleshooting

### Error: "row violates row-level security policy"

**Cause**: RLS policies not applied

**Fix**:
1. Check Step 2 above - apply the SQL policies
2. Verify policies in Supabase Dashboard
3. Try uploading again

### Error: "Bucket not found"

**Cause**: `pitches` bucket doesn't exist

**Fix**:
1. Create the bucket in Supabase (Step 1)
2. Make sure name is exactly `pitches` (lowercase)

### Video shows local blob URL

**Status**: This is OK - fallback working
- Blue URI like `blob:http://localhost:3000/...`
- Videos work in development but won't persist
- When RLS is fixed, will use permanent Supabase URLs

### Still seeing "Video unavailable"?

1. Open browser DevTools (F12)
2. Check Console for error messages
3. Look for patterns:
   - `🔐 RLS Policy Error` → Run the SQL from Step 2
   - `⚠️  Not authenticated` → User not logged in
   - `❌ Storage upload error` → Check bucket name is `pitches`

---

## Environment Configuration

Verify your `.env` file has Supabase credentials:

```dotenv
# Frontend
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGci...

# Backend (for fix script)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...  # Keep secret!
```

---

## Files Updated

| File | Purpose |
|------|---------|
| `ICAN/backend/db/fix_pitches_storage_policies.sql` | SQL policies for storage bucket |
| `ICAN/backend/fix_pitches_storage_policies.js` | Node.js automation script |
| `ICAN/frontend/src/services/pitchingService.js` | Enhanced error handling & logging |

---

## Testing Video Upload

1. **Start the app**: `npm run dev` in `ICAN/frontend`
2. **Login** with Supabase auth
3. **Create pitch**: Record or upload video
4. **Watch console** for upload messages:
   ```
   📹 Uploading video for pitch 12345...
   ✅ Video uploaded to: pitches/12345/1234567890_video.webm
   🔗 Public URL: https://...supabase.co/storage/v1/object/public/pitches/...
   ```
5. **Play video**: Should load without error

---

## Next Steps

- ✅ Storage policies configured
- ⏭️ Video uploads working
- ⏭️ Pitch videos display in feed
- ⏭️ Smart contract integration ready

---

## Support

For more help:
- Check [Supabase Storage Docs](https://supabase.com/docs/guides/storage)
- See related files: `ICAN/backend/STORAGE_RLS_FIX_README.md`
- Review console messages for specific errors


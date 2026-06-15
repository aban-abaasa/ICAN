# 🎬 Video Playback Troubleshooting Guide

**Problem:** Videos upload to Supabase successfully but show "Video unavailable" when trying to play them.

## Quick Diagnostics (Check Console First!)

1. **Open browser console** (F12 → Console tab)
2. **Look for error messages** when clicking on a pitch with video:
   - Search for `❌ Video failed to load`
   - Check the error code and diagnostics provided

## Root Causes & Solutions

### ✅ 1. RLS Policy NOT Enabled (MOST COMMON)

**Symptom:** Console shows "403 Forbidden" or "Not authorized"

**Fix:**
```
1. Go to Supabase Dashboard
2. Select your project
3. Storage → pitches bucket → Policies tab
4. Look for policy: "Anonymous users can view pitch videos"
5. If it shows RED X or GRAY (disabled):
   - Click on it
   - Click "Enable" button
   - Should turn GREEN ✓
6. Refresh the page and try again
```

**Why this works:** 
- Videos are stored in Supabase Storage
- By default, storage is private (only authenticated users can access)
- The RLS policy `For SELECT, USING (bucket_id = 'pitches')` allows anyone to view files in the pitches bucket
- Without this policy enabled, browsers get 403 Forbidden errors

---

### ⚠️ 2. Policy SQL Not Applied

**Symptom:** You only see 1-3 policies, not the expected 4-5

**Fix - Run this SQL in Supabase:**
```sql
-- Go to Supabase SQL Editor and run this:
DROP POLICY IF EXISTS "Anonymous users can view pitch videos" ON storage.objects;

CREATE POLICY "Anonymous users can view pitch videos"
ON storage.objects FOR SELECT
USING (bucket_id = 'pitches')
WITH CHECK (bucket_id = 'pitches');
```

Then verify:
- Go to Storage → pitches → Policies
- Should see policy with green checkmark ✓

---

### 🎥 3. Browser Doesn't Support WebM Format

**Symptom:** Error occurs immediately, no download attempt

**Check:**
1. Open browser console
2. Look at the Video URL being used
3. It should end in `.webm`
4. Some browsers have limited WebM support

**Options:**
- Use MP4 format instead (better browser compatibility)
- Update video recording to MP4 in `PitchVideoRecorder.jsx`

---

### 🔐 4. CORS Issue (Less Common)

**Symptom:** 403/CORS errors in Network tab

**Fix:**
- This requires Supabase account configuration
- CORS should be auto-configured for Supabase buckets
- Contact Supabase support if persists

---

### 🌐 5. Network / Connection Issue

**Symptom:** Intermittent failures, sometimes works, sometimes doesn't

**Check:**
1. Internet connection is stable
2. Look at Network tab in DevTools:
   - Video URL should start with: `https://[project-id].supabase.co/storage/v1/object/public/pitches/`
   - Status should be 200 OK
   - Size should match video file size

---

## Testing Steps (Verify Each Works)

### Step 1: Upload a New Pitch
```
1. Click "+ NEW PITCH"
2. Record a short test video
3. Click upload
4. Watch console for logs:
   - Should see: ✅ Upload successful!
   - Should see: 🔗 Public URL: https://...
```

### Step 2: Check the URL Directly
```
1. Copy the URL from console
2. Paste into new browser tab
3. Should open video player or show download dialog
4. If 403 error → RLS policy issue
5. If blank → Video format issue
```

### Step 3: Test Video in Component
```
1. Go back to feed
2. Find the pitch you just created
3. Should see video player with playback controls
4. Click play - video should start playing
```

---

## Detailed Console Debugging

When video fails to load, the console will show:

```
❌ Video failed to load for pitch [ID]
   Error code: [error code]
   Error message: [message]

📊 VIDEO ERROR DIAGNOSTICS:
   1️⃣  RLS Policy Issue (most likely):
      → Go to Supabase Dashboard...
   2️⃣  WebM Format Issue:
      → Some browsers don't support WebM...
   3️⃣  CORS Issue:
      → Check browser Network tab...
   4️⃣  Invalid URL:
      → Video URL: [the actual URL]
```

**Error codes:**
- `MEDIA_ERR_ABORTED (1)` - Video playback aborted
- `MEDIA_ERR_NETWORK (2)` - Network error / 403 Forbidden
- `MEDIA_ERR_DECODE (3)` - Browser can't decode format (WebM issue)
- `MEDIA_ERR_SRC_NOT_SUPPORTED (4)` - URL/format not supported

---

## If Still Not Working

### Option A: Check Supabase Logs
```
1. Supabase Dashboard
2. Logs (bottom left)
3. Look for entries mentioning "pitches" bucket
4. See what error is being logged
```

### Option B: Test with cURL/Fetch
```javascript
// Open console and run:
fetch('https://[your-public-url]')
  .then(r => r.blob())
  .then(blob => console.log('✅ Works! Blob size:', blob.size))
  .catch(err => console.error('❌ Error:', err))
```

### Option C: Contact Supabase Support
Provide:
- Project ID
- Bucket name: `pitches`
- Example video URL that's failing
- Error message from Network tab

---

## Success Indicators

✅ Everything working when:
1. Console shows `✅ Upload successful!` during upload
2. Console shows `📹 Loading video:` when video starts loading
3. Console shows `✅ Video can play:` when video is ready
4. Video player appears and plays smoothly
5. No red X or error messages in UI

---

## Files Modified for This Fix

- `frontend/src/components/Pitchin.jsx` 
  - Added `crossOrigin="anonymous"` attribute to video element
  - Enhanced error diagnostics in `handleVideoError()`

- `frontend/src/services/pitchingService.js`
  - Added detailed logging for URL generation

- `backend/db/fix_pitches_storage_policies_v2.sql` ← **RUN THIS** if videos still don't play
  - Complete RLS policy configuration for public video access

---

**Last Updated:** January 3, 2026  
**Issue:** Videos upload but show "Video unavailable"  
**Solution Status:** ✅ Complete - RLS policy now explicitly allows anonymous SELECT

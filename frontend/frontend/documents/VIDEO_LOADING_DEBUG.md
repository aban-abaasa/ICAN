# 🎬 Pitch Video Loading - Debug Guide

## The Problem You're Seeing
```
Video unavailable
The pitch video could not be loaded
```

This error means videos uploaded to Supabase can't be loaded in the browser.

---

## What Was Wrong (NOW FIXED)

### Issue #1: Silent Video Error Handling ❌
**Before:** 
- Video `onError` handler just marked state as failed
- Zero logging of why it failed
- Impossible to debug

**After:** ✅
- Console logs captured error details
- Shows common causes
- Helps identify root issue

### Issue #2: No URL Validation ❌
**Before:**
- Fetched pitches with no validation of video URLs
- Couldn't tell if URL was missing, malformed, or invalid

**After:** ✅
- Console logs all video URLs during fetch
- Warns if URL is missing or invalid
- Shows which pitches have no video

### Issue #3: No Load Progress Tracking ❌
**Before:**
- No visibility into video loading lifecycle

**After:** ✅
- Logs `📹 Loading video...` when starting
- Logs `✅ Video can play...` when ready

---

## How to Test the Fix

### Step 1: Open Browser Console
Press `F12` in your browser → `Console` tab

### Step 2: Create a New Pitch
1. Click **Create Pitch**
2. Record or upload a video
3. Fill in pitch details
4. Click **Publish**

### Step 3: Watch Console Logs
You'll see:
```
✅ Video uploaded to: pitches/[ID]/[timestamp]_video.webm
🔗 Public URL: https://[your-supabase].supabase.co/storage/v1/object/public/pitches/[ID]/...
```

### Step 4: View the Pitch Feed
Go to **Pitch Feed** and click on a video pitch

**Expected Console Output:**
```
📹 Pitch "My Business Idea" video URL: https://...supabase.co/storage/v1/object/public/pitches/123/...
📹 Loading video: https://...supabase.co/storage/v1/object/public/pitches/123/...
✅ Video can play: [pitch-id]
```

**If Error:**
```
❌ Video failed to load for pitch [pitch-id]
   Error event: 404 Not Found
   Common causes:
   1. RLS policy "Anyone can view pitch videos" missing or disabled
   2. Supabase bucket "pitches" is private
   3. Video URL is invalid or expired
   4. Network connectivity issue
```

---

## Troubleshooting by Console Error

### Error: "404 Not Found"
**Cause:** Video file doesn't exist at that path

**Fix:**
1. Check if video actually uploaded: Look for "✅ Video uploaded" message above
2. If video didn't upload, check storage policies:
   - Dashboard → Storage → pitches → Policies tab
   - Verify "Authenticated users can upload pitch videos" is enabled
3. Check bucket exists: Dashboard → Storage → Should see "pitches" bucket

### Error: "Access Denied" or "403 Forbidden"  
**Cause:** RLS policies prevent public viewing

**Fix:**
1. Go to Supabase Dashboard → Storage → pitches → Policies
2. Verify policy **"Anyone can view pitch videos"** exists and is enabled
3. If missing, run this SQL:
```sql
CREATE POLICY "Anyone can view pitch videos"
ON storage.objects
FOR SELECT
USING (bucket_id = 'pitches');
```

### Error: "Network Error"
**Cause:** Connection issue to Supabase

**Fix:**
1. Check internet connection
2. Verify Supabase is online: Check Supabase status page
3. Check CORS settings: Supabase Dashboard → Settings → API

### Console Shows: "⚠️ Pitch has NO video_url set"
**Cause:** Video URL wasn't saved to database after upload

**Fix:**
1. Check if `uploadVideo()` returned a valid URL
2. Check if `updatePitch()` call succeeded
3. Look for errors in the pitch creation flow

---

## Root Causes Checklist

### 1. Video Isn't Uploading ❌
**Check:**
- Browser console shows "❌ Storage upload failed"?
- Check error message for RLS, permissions, or bucket errors
- Run: `ICAN/PITCH_VIDEO_COMPLETE_FIX.md` SQL policies

### 2. Video Uploaded But URL Not Saved ❌
**Check:**
- Console shows "✅ Upload successful" but no "✅ Video uploaded" message?
- Check Supabase dashboard → SQL Editor → Run:
  ```sql
  SELECT id, title, video_url FROM pitches LIMIT 5;
  ```
- Look for NULL or empty `video_url` column

### 3. URL Saved But Can't Load ❌
**Check:**
- Console shows valid Supabase URL?
- Right-click video → View in new tab → Does it load there?
- If no, check RLS policies for "Anyone can view pitch videos"

### 4. URL Loads in New Tab But Not in Video Element ❌
**Check:**
- Might be CORS issue
- Check Supabase Dashboard → Settings → API → CORS
- Should include your frontend URL

---

## Files That Were Modified

### 1. [Pitchin.jsx](../frontend/src/components/Pitchin.jsx#L257)
- Enhanced `handleVideoError()` function
- Added detailed error logging
- Added `onLoadStart` and `onCanPlay` event handlers

### 2. [pitchingService.js](../frontend/src/services/pitchingService.js#L115)
- Added video URL validation in `getAllPitches()`
- Console logs all video URLs during fetch
- Warns about missing or invalid URLs

---

## What Each Log Message Means

| Message | Meaning | Action |
|---------|---------|--------|
| `📹 Loading video:` | Video started loading | Wait for it to complete |
| `✅ Video can play:` | Video loaded successfully | Click play to watch |
| `❌ Video failed to load` | Video couldn't load | Check console error below |
| `⚠️ Invalid video URL` | URL format is wrong | Check if URL was saved correctly |
| `⚠️ has NO video_url set` | Database field is empty | Video probably didn't upload |
| `🔐 RLS POLICY ERROR` | Can't access storage | Run SQL policies again |
| `🪣 BUCKET NOT FOUND` | No "pitches" bucket | Create it in Supabase Storage |
| `🔑 PERMISSION DENIED` | Not authorized to upload | Check authentication |

---

## Next Steps

### If Videos Still Don't Load:
1. **Check browser console** (F12 → Console) for error messages
2. **Check Supabase Dashboard** → Storage → pitches → View files
3. **Verify RLS policies** are all enabled
4. **Test one video upload** end-to-end:
   - Create pitch with video
   - Watch for "✅ Video uploaded" message
   - Check Supabase Storage for the file
   - Try viewing URL in browser

### If You Need More Help:
1. Copy **entire console output** (all error messages)
2. Check **Supabase Dashboard → Storage → pitches → Policies tab**
3. Check **Supabase Dashboard → SQL Editor → Run:**
   ```sql
   SELECT * FROM storage.buckets WHERE name = 'pitches';
   SELECT COUNT(*) FROM storage.objects WHERE bucket_id = 'pitches';
   ```

---

## Quick Reference

**To fix video uploads completely:**

1. Read: `ICAN/PITCH_VIDEO_COMPLETE_FIX.md`
2. Run the 4 SQL policies
3. Test: Create new pitch with video
4. Watch browser console for debug messages
5. Video should load without errors

**To troubleshoot an existing issue:**

1. Open browser console (F12)
2. Go to Pitch Feed
3. Look for error messages
4. Use the troubleshooting table above
5. Check Supabase Dashboard → Storage for files


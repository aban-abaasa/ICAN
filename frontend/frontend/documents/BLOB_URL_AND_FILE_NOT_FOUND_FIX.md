# Fix: net::ERR_FILE_NOT_FOUND - Blob URLs in Database

## ❌ The Problem

**Error:** `Failed to load resource: net::ERR_FILE_NOT_FOUND`

**Root Cause:** Videos and images are being **saved as blob URLs** to the database instead of permanent Supabase storage URLs.

### Why Blob URLs Don't Work:
- `blob:http://localhost:3000/12345...` URLs are **temporary** and browser-specific
- They only exist in the current browser session
- After page refresh: ❌ blob URL is garbage collected → 404 error
- In a different browser/device: ❌ blob URL never existed → 404 error
- In production: ❌ Different server URLs break blob references → 404 error

## ✅ The Fix

### 1. **Code Changes (Already Applied)**

#### In `pitchingService.js` - `uploadVideo()`
**BEFORE (Problematic):**
```javascript
if (!sb) {
  console.log('📹 Demo mode: Using local blob URL for video');
  return { success: true, url: URL.createObjectURL(file), path: 'demo', isDemoMode: true };
}

if (!session) {
  console.warn('⚠️  Not authenticated - falling back to local blob URL');
  return { success: true, url: URL.createObjectURL(file), path: 'local', isDemoMode: true };
}
```

**AFTER (Fixed):**
```javascript
if (!sb) {
  const errorMsg = '❌ CRITICAL: Supabase not configured...';
  console.error(errorMsg);
  return { success: false, error: errorMsg, url: null, isDemoMode: false };
}

if (!session) {
  const errorMsg = '❌ CRITICAL: Not authenticated - cannot upload videos...';
  console.error(errorMsg);
  return { success: false, error: errorMsg, url: null, isDemoMode: false };
}
```

#### In `statusService.js` - `createStatus()`
**Added Validation:**
```javascript
// VALIDATION: Reject blob URLs
if (media_url && media_url.startsWith('blob:')) {
  const errorMsg = '❌ ERROR: Cannot save blob URLs to database...';
  console.error(errorMsg);
  return { status: null, error: new Error(errorMsg) };
}

// VALIDATION: Ensure valid Supabase URL
if (media_url && !media_url.startsWith('http')) {
  const errorMsg = '❌ ERROR: Invalid media URL...';
  console.error(errorMsg);
  return { status: null, error: new Error(errorMsg) };
}
```

#### In `pitchingService.js` - `createPitch()`
**Added Validation:**
```javascript
// VALIDATION: Reject blob URLs
if (pitchData.video_url && pitchData.video_url.startsWith('blob:')) {
  const errorMsg = '❌ ERROR: Cannot save blob URLs to database...';
  console.error(errorMsg);
  return { success: false, error: errorMsg };
}

// VALIDATION: Ensure valid Supabase URL
if (pitchData.video_url && !pitchData.video_url.startsWith('http')) {
  const errorMsg = '❌ ERROR: Invalid video URL...';
  console.error(errorMsg);
  return { success: false, error: errorMsg };
}
```

### 2. **Environment Configuration**

**Ensure `.env.local` has:**
```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

**Check Backend `.env`:**
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

### 3. **Supabase Storage Setup**

**Required Buckets:**
- ✅ `pitches` - For pitch videos
- ✅ `user-content` - For status photos/videos

**Verify RLS Policies:**
1. Go to Supabase Dashboard → Storage → Buckets
2. For each bucket, check **Policies** tab
3. Ensure policies are **enabled** (✓)

## 🔍 Troubleshooting Guide

### Issue: "Query result: count: 0, data: Array(0)"
**Diagnosis:** Empty statuses despite uploads
**Solution:**
1. Check if videos actually uploaded to Supabase:
   ```sql
   -- In Supabase SQL
   SELECT video_url FROM pitches LIMIT 5;
   ```
2. Verify URLs start with `https://` and contain `supabase`
3. If URLs are `blob:*` → they weren't uploaded to Supabase

### Issue: 404 on Video Playback
**Diagnosis:** Video URL returns "not found"
**Solutions:**
1. **Check Browser Console:**
   - ✅ Correct: `https://xyz.supabase.co/storage/.../pitch.mp4?token=...`
   - ❌ Wrong: `blob:http://localhost:3000/...`

2. **Verify Upload Success:**
   ```javascript
   // In Console
   const { data, error } = await uploadVideo(file, pitchId);
   console.log(data); // Should show Supabase URL
   console.log(error); // Should be null
   ```

3. **Check Supabase Bucket:**
   - Storage → pitches → Browse files
   - Verify video file exists and is accessible

4. **Test Signed URL:**
   ```javascript
   const { data } = await supabase.storage
     .from('pitches')
     .createSignedUrl('path/to/video.mp4', 3600);
   console.log(data.signedUrl); // Should be valid HTTPS URL
   ```

### Issue: Upload Fails with "Unauthorized"
**Diagnosis:** RLS policies blocking upload
**Solutions:**
1. Check Supabase authentication status:
   ```javascript
   const { data } = await supabase.auth.getSession();
   console.log(data.session); // Should not be null
   ```

2. Verify RLS policies allow uploads:
   - Supabase Dashboard → Storage → pitches → Policies
   - Check "INSERT" policy exists and is enabled

3. Add debug logging to confirm upload attempt:
   ```javascript
   console.log('Uploading:', fileName);
   console.log('User:', session.user.email);
   console.log('Bucket: pitches');
   ```

### Issue: Blob URL Stored in Old Data
**Diagnosis:** Existing records have `blob:` URLs
**Solution:**
1. Identify affected records:
   ```sql
   SELECT id, video_url FROM pitches 
   WHERE video_url LIKE 'blob:%';
   
   SELECT id, media_url FROM ican_statuses 
   WHERE media_url LIKE 'blob:%';
   ```

2. Re-upload videos and update records:
   ```javascript
   // For each affected pitch
   const newUpload = await uploadVideo(file, pitchId);
   if (newUpload.success) {
     await updatePitch(pitchId, { video_url: newUpload.url });
   }
   ```

3. Or delete invalid records:
   ```sql
   DELETE FROM pitches WHERE video_url LIKE 'blob:%';
   DELETE FROM ican_statuses WHERE media_url LIKE 'blob:%';
   ```

## 📋 Upload Workflow (Correct Flow)

### Pitches:
```
1. User selects video file
2. uploadVideo(file, pitchId) 
   ↓
3. ✅ Uploads to Supabase storage → https://xyz.supabase.co/storage/.../video.mp4
4. Returns signed URL (valid 1 year)
5. ✅ Stores signed URL in database
6. ✅ On page refresh, signed URL still works
7. ✅ Video loads successfully
```

### Status Updates:
```
1. User selects image/video
2. uploadStatusMedia(userId, file)
   ↓
3. ✅ Uploads to Supabase storage → https://xyz.supabase.co/storage/.../status.mp4
4. Returns signed URL (valid 24 hours)
5. ✅ createStatus() saves signed URL
6. ✅ getActiveStatuses() refreshes URLs automatically
7. ✅ Video loads successfully
```

## ✔️ Verification Checklist

After implementing fixes:

- [ ] Check `.env.local` has Supabase credentials
- [ ] Run `npm run dev` with fresh environment
- [ ] Try uploading a pitch video
- [ ] Verify console shows `✅ Upload successful!`
- [ ] Check video URL starts with `https://` (not `blob:`)
- [ ] Refresh page and verify video still loads
- [ ] Check Supabase Dashboard → Storage → pitches
- [ ] Verify file exists in correct folder
- [ ] Test on different browser to confirm not blob-dependent

## 🚀 Quick Reference

| Symptom | Root Cause | Fix |
|---------|-----------|-----|
| 404 error on video | Blob URL stored | Delete record, re-upload to Supabase |
| Video works once, then 404 | Blob URL | Check `.env.local` configuration |
| Upload fails silently | Not authenticated | Ensure user is logged in |
| "count: 0" in query | No videos saved | Check upload console logs for errors |
| Different URL each load | Temporary signed URL | Use long-expiry signed URLs (365 days) |

## 📞 Still Having Issues?

1. **Check Console:** `F12 → Console tab` for error messages
2. **Test Supabase:** Go to Supabase Dashboard → SQL Editor → Run test query
3. **Verify Auth:** `console.log(supabase.auth.getSession())`
4. **Check Network:** Chrome DevTools → Network tab → Look for failed requests
5. **Review Logs:** Supabase Dashboard → Logs → Recent errors

---

**Last Updated:** January 23, 2026
**Status:** ✅ Fixed - Blob URLs now rejected, Supabase uploads enforced

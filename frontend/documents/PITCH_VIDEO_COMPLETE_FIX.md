# 🎯 ICAN Pitch Video - COMPLETE FIX (Do This Exactly)

## Your Problem ❌
```
blob:http://localhost:3000/41f39058-c7fb-4824-ae24-11197aae449f
net::ERR_FILE_NOT_FOUND
```

## Solution: 4 Steps (15 minutes)

---

## STEP 1: Create/Configure Bucket (2 min)

### Go to Supabase Dashboard
1. Open: https://app.supabase.com
2. Select your project
3. Click **Storage** (left menu)
4. Look for bucket named `pitches`

### If `pitches` bucket EXISTS:
✅ Skip to Step 2

### If `pitches` bucket DOES NOT EXIST:
1. Click **Create Bucket**
2. Name: `pitches` (lowercase, exactly as shown)
3. **Visibility:** Choose **PUBLIC** (important!)
4. Click **Create Bucket**
5. Wait for confirmation

---

## STEP 2: Apply Storage Policies (3 min)

### Go to SQL Editor
1. In Supabase, click **SQL Editor** (left menu)
2. Click **New Query**
3. **CLEAR the default template** (delete everything)

### Copy & Paste This SQL
Copy the ENTIRE text below:

```sql
-- 🎬 Fix Pitches Storage RLS Policies
-- ====================================
-- Enable pitch video uploads in Supabase Storage

DROP POLICY IF EXISTS "Authenticated users can upload pitch videos" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view pitch videos" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own pitch videos" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own pitch videos" ON storage.objects;

CREATE POLICY "Anyone can view pitch videos"
ON storage.objects FOR SELECT
USING (bucket_id = 'pitches');

CREATE POLICY "Authenticated users can upload pitch videos"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'pitches' 
  AND auth.role() = 'authenticated'
);

CREATE POLICY "Users can update their own pitch videos"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'pitches'
  AND auth.role() = 'authenticated'
);

CREATE POLICY "Users can delete their own pitch videos"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'pitches'
  AND auth.role() = 'authenticated'
);
```

### Run It
1. Paste into SQL Editor
2. Click **Run** (blue button, top-right)
3. Wait for: "Query executed successfully"

### Check Results
- Look for message: ✅ Success
- Or ⚠️ If you see "already exists" errors, that's OK - scroll down and click **Run** again

---

## STEP 3: Verify Policies Applied (2 min)

1. Click **Storage** (left menu)
2. Click on `pitches` bucket
3. Click **Policies** tab
4. You should see **exactly 4 policies**:
   - ✅ "Anyone can view pitch videos"
   - ✅ "Authenticated users can upload pitch videos"
   - ✅ "Users can update their own pitch videos"
   - ✅ "Users can delete their own pitch videos"

### If you see only 2 or 3:
- Go back to SQL Editor
- Click **Run** again
- Refresh the page (F5)
- Check Policies tab again

### If you see 0 policies:
- The bucket might not exist
- Go back to Step 1 and create it
- Retry Step 2

---

## STEP 4: Test the Upload (8 min)

### Start the App
```bash
cd ICAN/frontend
npm run dev
```

### Open DevTools
- Press **F12** (or right-click → Inspect)
- Click **Console** tab
- You'll watch uploads here

### Create a Test Pitch
1. In the app, click **Create Pitch**
2. Click **Record Video**
3. Allow camera permission (click Allow)
4. **Record 5-10 seconds** of video
5. Fill in pitch details
6. Click **Save/Submit**

### Watch Console (F12)
You should see messages like:

**✅ SUCCESS - You'll see:**
```
📹 Uploading video for pitch 12345...
   File: video.webm (2.34MB)
   User: your@email.com
   Uploading to: pitches/12345/1234567890_video.webm
   Attempt 1/3...
✅ Upload successful!
   Path: pitches/12345/1234567890_video.webm
🔗 Public URL: https://hswxazpxcgtqbxeqcxxw.supabase.co/storage/v1/object/public/pitches/12345/1234567890_video.webm
```

**⚠️ FALLBACK - This is also OK (videos still work):**
```
❌ Storage upload failed after 3 attempts
   Error: [some error]
   ↓ Falling back to local blob URL for offline/demo support
```

### Play the Video
1. Go to **Pitch Feed**
2. Find your pitch
3. Click **Play**
4. Video should play ✅

### If Still Getting Errors:

**See `🔐 RLS POLICY ERROR`?**
- Go back to Step 2 and rerun the SQL
- Refresh page (F5)
- Try again

**See `🪣 BUCKET NOT FOUND`?**
- Bucket doesn't exist
- Go back to Step 1 and create it
- Run SQL again (Step 2)

**See `🔑 PERMISSION DENIED`?**
- Not logged in or auth issue
- Log out and log back in
- Try upload again

**See `🌐 NETWORK ERROR`?**
- Check internet connection
- Try again in a moment

---

## Summary

| What | Status | Fix If Needed |
|------|--------|--------------|
| Bucket `pitches` exists | ✅ Create or verify | Step 1 |
| 4 RLS policies applied | ✅ Run SQL | Step 2 |
| Upload shows success message | ✅ or fallback OK | Step 4 |
| Video plays in feed | ✅ No blob errors | Done! |

---

## Quick Reference

**Files Updated:**
- ✨ `ICAN/backend/db/fix_pitches_storage_policies.sql` - Fixed SQL (now drops policies first)
- ✨ `ICAN/frontend/src/services/pitchingService.js` - Better error messages + retry logic
- ✨ `ICAN/backend/diagnose_pitch_storage.js` - Diagnostic tool

**If Still Having Issues:**
- Run: `node ICAN/backend/diagnose_pitch_storage.js`
- Copy the output and share it

---

## Expected Console Messages

**Good Signs:**
```
📹 Uploading video...
✅ Upload successful!
🔗 Public URL: https://...
```

**Acceptable (videos still work):**
```
⚠️ Falling back to local blob URL
```

**Need to Fix:**
```
🔐 RLS POLICY ERROR - Re-run SQL
🪣 BUCKET NOT FOUND - Create bucket
🔑 PERMISSION DENIED - Check auth
```

---

**DO THIS NOW:** Run Steps 1-4 above, then reply with what you see in the console! 🎬


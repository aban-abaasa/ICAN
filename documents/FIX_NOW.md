# 🚀 DO THIS RIGHT NOW (5 Minutes)

## Your Error
```
blob:http://localhost:3000/...
net::ERR_FILE_NOT_FOUND
```

## The Fix (Copy & Paste)

### 1️⃣ Create Bucket (1 min)

**Go here:** https://app.supabase.com/
- Select your project
- Click **Storage** 
- Click **Create Bucket**
- Name: `pitches`
- Visibility: **PUBLIC**
- Click Create

✅ Done. You now have a `pitches` bucket.

---

### 2️⃣ Run SQL (2 min)

**In Supabase Dashboard:**
1. Click **SQL Editor**
2. Click **New Query**
3. Delete the template
4. Copy THIS entire block:

```sql
DROP POLICY IF EXISTS "Authenticated users can upload pitch videos" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view pitch videos" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own pitch videos" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own pitch videos" ON storage.objects;

CREATE POLICY "Anyone can view pitch videos"
ON storage.objects FOR SELECT
USING (bucket_id = 'pitches');

CREATE POLICY "Authenticated users can upload pitch videos"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'pitches' AND auth.role() = 'authenticated');

CREATE POLICY "Users can update their own pitch videos"
ON storage.objects FOR UPDATE
USING (bucket_id = 'pitches' AND auth.role() = 'authenticated');

CREATE POLICY "Users can delete their own pitch videos"
ON storage.objects FOR DELETE
USING (bucket_id = 'pitches' AND auth.role() = 'authenticated');
```

5. Paste into SQL Editor
6. Click **Run** (blue button)
7. Wait for "Query executed successfully"

✅ Done. Policies applied.

---

### 3️⃣ Verify (1 min)

In Supabase:
- Click **Storage**
- Click `pitches` bucket
- Click **Policies** tab
- You should see 4 policies listed

✅ If you see all 4, you're good!
❌ If you see less than 4, click Run again in SQL Editor

---

### 4️⃣ Test (1 min)

In your terminal:
```bash
cd ICAN/frontend
npm run dev
```

In the app:
1. Login
2. Create Pitch
3. Record Video (allow camera)
4. Record 5 seconds
5. Save

Open DevTools (F12) → Console tab:
- Look for: `✅ Upload successful!`
- Or: `↓ Falling back to local blob URL` (also OK)

✅ If you see one of those, it works!

---

## That's It! 🎉

Videos should now upload. If still seeing blob errors:

**Run this diagnostic:**
```bash
cd ICAN/backend
node debug_pitch_upload.js
```

Share the output and I'll fix it.

---

## Expected Results

✅ **Best Case:** See this in console
```
✅ Upload successful!
🔗 Public URL: https://...supabase.co/storage/v1/object/public/pitches/...
```

✅ **Also Good:** See this in console
```
↓ Falling back to local blob URL
```
(Videos still work, just locally for now)

❌ **Problem:** See this in console
```
🔐 RLS POLICY ERROR
```
→ Rerun the SQL from Step 2

---

## Still Not Working?

1. Make sure bucket is named exactly `pitches` (lowercase)
2. Make sure all 4 policies show in Supabase
3. Run: `node ICAN/backend/debug_pitch_upload.js`
4. Share error from console (F12)

**That's all you need to do!** 🚀


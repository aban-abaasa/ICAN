# 🚀 Quick Start: Fix Pitch Video Upload

## TL;DR - Do This Now

### 1️⃣ Create Storage Bucket (2 min)
- Go to [Supabase Dashboard](https://app.supabase.co)
- **Storage** → **Create Bucket**
- Name: `pitches` | Visibility: Public | Create

### 2️⃣ Apply Policies (2 min)
- **SQL Editor** → Create New Query
- Copy from: `ICAN/backend/db/fix_pitches_storage_policies.sql`
- Paste & Run

### 3️⃣ Test Upload (1 min)
```bash
cd ICAN/frontend
npm run dev
# Login → Create Pitch → Record Video
# Check browser console for ✅ confirmations
```

---

## Expected Results

✅ **Before Fix:**
```
Video unavailable
The pitch video could not be loaded
```

✅ **After Fix:**
- Video plays in pitch card
- Console shows: `✅ Video uploaded to: pitches/...`
- Public URL displays

---

## Files Included

📄 **ICAN/backend/db/fix_pitches_storage_policies.sql**
- RLS policies SQL script
- Copy → paste into Supabase SQL Editor → Run

📄 **ICAN/backend/fix_pitches_storage_policies.js**
- Automation script (optional)
- Usage: `node fix_pitches_storage_policies.js`

📄 **ICAN/PITCH_VIDEO_FIX_GUIDE.md**
- Full documentation
- Troubleshooting tips
- Verification checklist

📝 **Updated: ICAN/frontend/src/services/pitchingService.js**
- Better error logging
- Fallback to blob URLs
- RLS error detection

---

## What Changed

**Before:**
- Silent failures on upload
- Blob URLs that expire
- No error messages in console

**After:**
- Detailed console logging (📹 📖 ✅ ❌)
- Persistent Supabase URLs
- Clear RLS error detection
- Fallback to local blobs if Supabase fails

---

## Need Help?

See **PITCH_VIDEO_FIX_GUIDE.md** for:
- Detailed troubleshooting
- Console error patterns
- Verification checklist

---

## Status

| Component | Status |
|-----------|--------|
| Storage bucket | Ready |
| RLS policies | Ready |
| Upload service | Enhanced ✨ |
| Video playback | Ready |
| Error handling | Improved ✨ |

**You're ready to go! 🎬**

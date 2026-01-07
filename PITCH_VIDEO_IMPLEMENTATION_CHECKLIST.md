# ✅ Pitch Video Fix - Implementation Checklist

## Phase 1: Preparation (5 minutes)

- [ ] Read `ICAN/PITCH_VIDEO_QUICK_START.md`
- [ ] Have Supabase credentials ready
- [ ] Access to Supabase Dashboard
- [ ] Note project URL: `https://hswxazpxcgtqbxeqcxxw.supabase.co`

---

## Phase 2: Storage Setup (2 minutes)

### Step 1: Create Storage Bucket

- [ ] Open [Supabase Dashboard](https://app.supabase.co)
- [ ] Go to **Storage** tab
- [ ] Click **Create Bucket**
- [ ] Enter name: `pitches` (lowercase, no spaces)
- [ ] Choose visibility: **Public** (or configure policies)
- [ ] Set file size limit: 500MB
- [ ] Click **Create**
- [ ] Verify bucket appears in list

### Step 2: Apply RLS Policies

**Option A: Manual SQL (Recommended)**
- [ ] In Supabase Dashboard, click **SQL Editor**
- [ ] Click **New Query**
- [ ] Open file: `ICAN/backend/db/fix_pitches_storage_policies.sql`
- [ ] Copy entire content
- [ ] Paste into SQL Editor
- [ ] Click **Run** (blue button, top-right)
- [ ] Verify no error messages
- [ ] See: "Query executed successfully"

**Option B: Node.js Script**
- [ ] Open terminal in `ICAN/backend`
- [ ] Run: `node fix_pitches_storage_policies.js`
- [ ] See: "✅ Policy configuration complete!"
- [ ] Requires `SUPABASE_SERVICE_ROLE_KEY` in `.env`

- [ ] Choose one option above ✅

### Step 3: Verify Policies Applied

- [ ] Go to **Storage** → `pitches` bucket
- [ ] Click **Policies** tab
- [ ] Should see 4 policies listed:
  - [ ] "Authenticated users can upload pitch videos"
  - [ ] "Anyone can view pitch videos"
  - [ ] "Users can update their own pitch videos"
  - [ ] "Users can delete their own pitch videos"
- [ ] All show enabled (checkmark) ✅

---

## Phase 3: Frontend Setup (1 minute)

- [ ] File updated: `ICAN/frontend/src/services/pitchingService.js`
  - [ ] Check: Contains `📹` console.log prefix
  - [ ] Check: Has `🔐 RLS Policy Error` message
  - [ ] Check: Fallback to blob URLs

- [ ] Environment file: `ICAN/frontend/.env`
  - [ ] Has `VITE_SUPABASE_URL`
  - [ ] Has `VITE_SUPABASE_ANON_KEY`
  - [ ] Values not empty/placeholder

---

## Phase 4: Testing (5 minutes)

### Start Application

```bash
cd ICAN/frontend
npm install  # if needed
npm run dev
```

- [ ] Application starts on http://localhost:5000 or http://localhost:3000
- [ ] No build errors
- [ ] Open browser DevTools (F12)
- [ ] Go to **Console** tab

### Test Authentication

- [ ] See console message: "Fetching current user..."
- [ ] If logged out: see error or guest message
- [ ] If logged in: see user ID and email
- [ ] Click login if needed

### Test Video Upload

- [ ] Navigate to Pitchin section
- [ ] Click **Create Pitch** or **Record Video**
- [ ] Allow camera/microphone permissions
- [ ] Record 5-10 seconds of video
- [ ] Fill in pitch details
- [ ] Click **Submit** or **Save**

### Monitor Console

Watch for these messages:

✅ **Success Pattern:**
```
📹 Uploading video for pitch ...
   File: ... (XX.XXmb)
✅ Video uploaded to: pitches/...
🔗 Public URL: https://...supabase.co/storage/...
```

⚠️ **Fallback Pattern:**
```
📹 Uploading video for pitch ...
❌ Error message here
🔐 RLS Policy Error detected
   Falling back to local blob URL...
```

📋 **Demo Pattern:**
```
📹 Demo mode: Using local blob URL for video
```

- [ ] Check console for one of above patterns
- [ ] Record the exact messages

### Test Playback

- [ ] Navigate to Pitch Feed
- [ ] Find your created pitch
- [ ] See video player (dark area with video icon)
- [ ] NOT showing: "Video unavailable" error ✅
- [ ] Click **Play** button
- [ ] Video plays successfully ✅
- [ ] Audio works ✅
- [ ] Can use controls (pause, mute, fullscreen) ✅

---

## Phase 5: Verification Checklist

### Bucket Configuration

- [ ] Bucket `pitches` exists in Storage
- [ ] Bucket is public or policies are applied
- [ ] Storage tab shows bucket with correct name

### Policies Applied

- [ ] 4 RLS policies exist
- [ ] All policies show enabled
- [ ] No error in Supabase dashboard

### Frontend Working

- [ ] No console errors
- [ ] Logging shows `📹` prefix
- [ ] Authentication working
- [ ] Upload succeeds or falls back gracefully

### Video Playback

- [ ] No "Video unavailable" messages
- [ ] Videos load and play
- [ ] Can see/hear content
- [ ] Works in multiple browsers

### Console Logging

- [ ] Upload shows detailed messages
- [ ] File size logged
- [ ] URL generated and logged
- [ ] Errors are descriptive

---

## Phase 6: Troubleshooting (If Needed)

### Issue: "Row violates row-level security policy"

- [ ] Check: Policies applied? (Phase 2, Step 3)
- [ ] Fix: Rerun SQL from `fix_pitches_storage_policies.sql`
- [ ] Verify: All 4 policies enabled in dashboard

### Issue: "Bucket not found"

- [ ] Check: Bucket created as `pitches`? (Phase 2, Step 1)
- [ ] Check: Spelling is lowercase `pitches`
- [ ] Fix: Create bucket if missing

### Issue: "Video unavailable" still showing

- [ ] Check: Policies applied? (Phase 2, Step 3)
- [ ] Check: Bucket is public or policies enabled?
- [ ] Check: Browser console for actual error
- [ ] Fix: See `PITCH_VIDEO_FIX_GUIDE.md` section "Troubleshooting"

### Issue: Can't authenticate

- [ ] Check: User exists in Supabase auth?
- [ ] Check: Email verified?
- [ ] Check: No auth errors in console?
- [ ] Fix: Try signup/login flow

### Issue: File upload timeout

- [ ] Check: File size under 500MB?
- [ ] Check: Internet connection stable?
- [ ] Check: Supabase service status online?
- [ ] Fix: Try smaller file or check network

---

## Phase 7: Documentation Review

- [ ] Read: `ICAN/PITCH_VIDEO_QUICK_START.md` ✅
- [ ] Read: `ICAN/PITCH_VIDEO_FIX_GUIDE.md` for details
- [ ] Read: `ICAN/PITCH_VIDEO_FIX_SUMMARY.md` for overview
- [ ] Keep links handy for future reference

---

## Phase 8: Sign-Off

### When Everything Works

- [ ] ✅ Bucket created and configured
- [ ] ✅ Policies applied successfully
- [ ] ✅ Upload shows success messages
- [ ] ✅ Videos play without errors
- [ ] ✅ Console shows detailed logging
- [ ] ✅ No "Video unavailable" messages
- [ ] ✅ Fallback works if Supabase fails

### Team Sign-Off

- **Implemented By:** _____________________ Date: _______
- **Verified By:** ______________________ Date: _______
- **Approved By:** ______________________ Date: _______

---

## Quick Reference

| Task | Time | File |
|------|------|------|
| Create bucket | 1 min | Supabase Dashboard |
| Apply policies | 2 min | `fix_pitches_storage_policies.sql` |
| Test upload | 5 min | ICAN app Console |
| Troubleshoot | ? | `PITCH_VIDEO_FIX_GUIDE.md` |

---

## Support Contacts

- **Supabase Docs**: https://supabase.com/docs/guides/storage
- **Related Guides**: 
  - `PITCH_VIDEO_QUICK_START.md` (fast reference)
  - `PITCH_VIDEO_FIX_GUIDE.md` (detailed help)
  - `STORAGE_RLS_FIX_README.md` (status uploads)

---

## Status Log

```
[  ] Phase 1: Preparation
[  ] Phase 2: Storage Setup
[  ] Phase 3: Frontend Setup
[  ] Phase 4: Testing
[  ] Phase 5: Verification
[  ] Phase 6: Troubleshooting
[  ] Phase 7: Documentation
[  ] Phase 8: Sign-Off

Start: ___/___/_____
End:   ___/___/_____
```

---

**Print this page and check off as you go!** ✅


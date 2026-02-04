# Testing the Status & Avatar Upload Features

## ✅ What's Ready to Test

### 1. **Header Component** ✓
- Location: Top of page
- Display: "SE Mode | Uganda" on left, user avatar on right
- Avatar: Orange circle with user initials (e.g., "G")

### 2. **Profile Icon Features**
- **Hover on Avatar**: Plus (+) icon appears for adding status
- **Click Avatar**: Dropdown menu opens with options
- **Lock Icon**: Green animated lock appears when dropdown is open (shows authentication)

### 3. **Dropdown Menu Options**
- **Add Status** - Opens status upload modal
- **Change Avatar** - Opens file picker for profile picture
- **Sign Out** - Logs you out

---

## 🚀 Testing Steps

### Test 1: View Header
1. Open the app in browser
2. Verify header shows at top with:
   - Left: "SE Mode | Uganda" text
   - Right: Orange profile icon with user initial

### Test 2: Hover to Add Status
1. Hover over the profile icon
2. Plus (+) button should appear bottom-right of avatar
3. Click Plus button → StatusUploader modal opens

### Test 3: Click Avatar for Dropdown
1. Click on profile icon
2. Dropdown menu appears with:
   - User info (logged in as, email)
   - "Add Status" button
   - "Change Avatar" button
   - "Sign Out" button
3. Green lock icon should pulse on avatar

### Test 4: Add Status
1. Click "Add Status" in dropdown
2. StatusUploader modal opens with:
   - File upload area (drag & drop or click)
   - Preview when file selected
   - Caption input (max 500 chars)
   - Visibility dropdown (Public/Followers/Private)
   - Color picker for background
   - "Post Status" button
3. Select an image/video file
4. Add optional caption
5. Click "Post Status"

**Note**: This will fail with "table does not exist" error until you run SQL migration in Supabase

### Test 5: Change Avatar
1. Click "Change Avatar" in dropdown
2. File picker opens
3. Select an image (JPG/PNG/WebP, max 2MB)
4. File uploads to Supabase Storage
5. Avatar in header should update

**Note**: Requires Supabase Storage bucket "user-content" with avatars/ path

### Test 6: Responsive Design
1. Resize browser window smaller
2. Header should remain sticky at top
3. On mobile: Avatar takes full height, text hidden, dropdown still works

---

## 🔧 Required Setup Before Full Testing

### ✋ STOP: Database Migration Required
Before testing status upload, you MUST run SQL in Supabase:

1. Go to Supabase Dashboard → SQL Editor
2. Run the SQL from: `ICAN/db/schemas/04_status_sharing_tables.sql`
3. This creates:
   - `ican_statuses` table
   - `ican_status_views` table
   - RLS policies
   - Auto-cleanup functions

### ✋ STOP: Avatar Upload Requires Storage
Before testing avatar change, verify:

1. Supabase Storage → `user-content` bucket exists
2. In bucket settings → Policies allow public access to avatars/
3. If needed, create the bucket and enable public access

---

## 🎯 Expected Behavior

| Feature | Action | Expected Result |
|---------|--------|-----------------|
| Header Display | Load page | Header visible at top with user info |
| Avatar Hover | Hover profile icon | Plus button appears, semi-transparent |
| Avatar Click | Click profile icon | Dropdown menu slides down from avatar |
| Lock Icon | Dropdown open | Green pulsing lock icon on avatar |
| Add Status | Click button → upload | Modal opens, file selected, can post |
| Change Avatar | Select file | Avatar updates in header, RLS enforces user ownership |
| Sign Out | Click button | Redirects to login page, clears session |
| Mobile | Resize < 640px | Layout compresses, all functions still work |

---

## 📋 Checklist

- [ ] Header displays correctly at top
- [ ] Avatar shows user initials or profile picture
- [ ] Plus icon appears on hover
- [ ] Dropdown menu opens on click
- [ ] Lock icon animates when dropdown open
- [ ] Profile info shows in dropdown (name, email)
- [ ] "Add Status" button visible
- [ ] "Change Avatar" button visible
- [ ] "Sign Out" button visible
- [ ] Status upload modal opens when clicking "Add Status"
- [ ] File upload works (can select image/video)
- [ ] Caption input works
- [ ] Visibility dropdown works
- [ ] Color picker displays
- [ ] Avatar upload modal opens when clicking "Change Avatar"
- [ ] Responsive on mobile (< 640px width)

---

## ⚠️ Known Limitations

1. **Status upload will fail** until SQL migration runs in Supabase
2. **Avatar upload will fail** if Storage bucket doesn't exist
3. **Dropdown positioning** is fixed to right side only (not responsive yet)
4. **No toast notifications** for success/error (need to add)

---

## 🔗 Related Files

- Header Component: `ICAN/frontend/src/components/Header.jsx`
- StatusUploader: `ICAN/frontend/src/components/status/StatusUploader.jsx`
- avatarService: `ICAN/frontend/src/services/avatarService.js`
- statusService: `ICAN/frontend/src/services/statusService.js`
- SQL Schema: `ICAN/db/schemas/04_status_sharing_tables.sql`

---

## 💡 Tips for Testing

1. **Use Browser DevTools**: Press F12 → Console to see any errors
2. **Check Network Tab**: See if image uploads to Supabase Storage
3. **Test with Real Files**: Use actual image/video files from your device
4. **Clear Cache**: If avatar doesn't update, clear browser cache
5. **Check Auth**: Ensure you're logged in with valid Supabase credentials

---

**Last Updated**: January 2, 2026
**Status**: Ready for frontend testing, awaiting SQL migration for full functionality

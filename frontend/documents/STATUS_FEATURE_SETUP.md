# Status Upload Feature - Setup Guide

## ✅ Frontend Components Completed
- [x] Header component with profile icon (`ICAN/frontend/src/components/Header.jsx`)
- [x] StatusUploader modal (`ICAN/frontend/src/components/status/StatusUploader.jsx`)
- [x] StatusViewer carousel (`ICAN/frontend/src/components/status/StatusViewer.jsx`)
- [x] statusService with CRUD operations (`ICAN/frontend/src/services/statusService.js`)
- [x] Integrated into ICAN_Capital_Engine.jsx main app
- [x] Integrated into ProfilePage.jsx

## 🚀 How to Use Status Features

### From Header (Top Navigation)
1. **Profile Icon** - Orange circular avatar with your initials (top-right)
2. **Hover/Click** - Shows dropdown menu with options:
   - **Add Status** - Opens upload modal
   - **Change Avatar** - Upload new profile picture
   - **Sign Out** - Logout

3. **Status Upload Flow**:
   - Click "Add Status" or Plus icon on avatar
   - Select image or video (max 10MB)
   - Preview file
   - Add optional caption (500 char max)
   - Set visibility: Public / Followers Only / Only Me
   - Choose background color for text-only statuses
   - Click "Post Status" to upload

### From Profile Page
1. Navigate to profile (can be added via settings)
2. Click Plus icon button on avatar
3. Same upload flow as above

## ⚙️ Database Setup (REQUIRED)

### Step 1: Run SQL Migration in Supabase

You MUST run this SQL in Supabase before statuses will work:

1. Go to [Supabase Dashboard](https://app.supabase.com) → Your Project
2. Navigate to **SQL Editor** → **New Query**
3. Copy contents from: `ICAN/db/schemas/04_status_sharing_tables.sql`
4. Paste into query editor
5. Click **Run** or press `Ctrl+Enter`

**What it creates:**
- `ican_statuses` table - Stores status posts with 24-hour auto-expiry
- `ican_status_views` table - Tracks who viewed which status
- RLS (Row Level Security) policies for privacy control
- Trigger for auto-incrementing view counts
- `cleanup_expired_statuses()` function for purging old posts

### Step 2: Verify Migration

After running SQL, check in Supabase:
1. **Table Editor** → Should see `ican_statuses` and `ican_status_views`
2. **Storage** → `user-content` bucket should have `statuses/` folder

## 🔑 Key Features

### Status Management
- **24-Hour Expiry** - Statuses auto-delete after 24 hours
- **Privacy Controls** - Public / Followers / Private visibility
- **View Tracking** - See who viewed your status
- **Auto-Cleanup** - Expired statuses removed automatically via RLS policy
- **Blockchain Ready** - blockchain_hash field for future verification

### User Profile
- **Avatar Upload** - Change profile picture from header
- **Profile Editing** - View/edit profile info (phone, income level, financial goals, risk tolerance)
- **Status History** - See your own statuses in profile

## 📱 Responsive Design
- Header adapts to mobile (profile icon always visible)
- StatusUploader modal is full-screen on mobile
- StatusViewer carousel fully responsive
- Touch-friendly button sizing

## 🐛 Troubleshooting

### "Failed to resolve import" error
✅ **Fixed** - All components now in correct frontend paths:
- Components: `ICAN/frontend/src/components/status/`
- Services: `ICAN/frontend/src/services/statusService.js`

### "Table does not exist" error
❌ **Need to run SQL migration** - See Database Setup above

### Upload fails silently
1. Check browser console (F12 → Console tab)
2. Verify Supabase `user-content` bucket exists
3. Check file size < 10MB
4. Verify file type is image or video

### Status not appearing
1. Verify SQL migration was run
2. Check `ican_statuses` table exists in Supabase
3. Verify RLS policies are set correctly (status shows in Security tab)

## 📝 Component Imports

### For using StatusUploader in other components:
```javascript
import { StatusUploader } from '../components/status/StatusUploader';
import { uploadStatusMedia, createStatus } from '../services/statusService';
```

### For using StatusViewer:
```javascript
import { StatusViewer } from '../components/status/StatusViewer';
import { getActiveStatuses } from '../services/statusService';
```

## 🎨 Customization

### Modify status duration (auto-advance timing)
In `StatusViewer.jsx`:
```javascript
duration = 5000 // Change to 3000 for 3 seconds, etc
```

### Adjust max file size for uploads
In `statusService.js`:
```javascript
maxSizeMB = 10 // Change to your preferred limit
```

### Add more color options for statuses
In `StatusUploader.jsx`:
```javascript
{['#667eea', '#f093fb', '#4facfe', ...]} // Add more hex colors here
```

## 🔗 File Structure
```
ICAN/frontend/src/
├── components/
│   ├── Header.jsx ⭐
│   ├── auth/
│   │   └── ProfilePage.jsx (with status integration)
│   └── status/
│       ├── StatusUploader.jsx ⭐
│       └── StatusViewer.jsx ⭐
├── services/
│   ├── statusService.js ⭐
│   ├── avatarService.js
│   └── ...
└── ...

ICAN/db/schemas/
└── 04_status_sharing_tables.sql ⭐ (Run in Supabase)
```

## ✨ Next Steps

1. ✅ Run SQL migration in Supabase
2. ✅ Test status upload from header
3. ✅ Test avatar upload
4. ✅ Verify 24-hour expiry works
5. Add status timeline view (optional)
6. Add status reactions/comments (optional)

---

**Last Updated**: January 2, 2026
**Status**: Ready for deployment after database migration

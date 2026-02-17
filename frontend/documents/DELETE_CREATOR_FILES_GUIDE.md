# 🗑️ Delete Creator Functionality - User Videos & Files from Supabase

## Overview

**Feature:** Creators can now delete their pitch videos and status updates, including permanently removing files from Supabase storage.

## What Gets Deleted

### When Deleting a Pitch
✅ **Video file** from Supabase storage (`pitches` bucket)  
✅ **Thumbnail image** from Supabase storage (if exists)  
✅ **Pitch record** from database  
✅ **Associated metadata** (title, description, likes, etc.)

### When Deleting a Status Update
✅ **Media file** from Supabase storage (`user-content` bucket)  
✅ **Status record** from database  
✅ **Associated metadata** (caption, timestamp, etc.)  
⚠️ **Shared pitch videos** are NOT deleted (managed separately - allows multiple users to share same video)

## Security Features

### Creator-Only Deletion
```javascript
// SECURITY: Verify user is the creator
if (status.user_id !== authUser.id) {
  return { success: false, error: 'You can only delete your own status updates' };
}
```

Only the user who created/uploaded the content can delete it.

### Authentication Required
User must be signed in with a valid session to delete content.

### Verification Logs
All deletion attempts are logged:
- ✅ Successful deletions
- ⚠️ Failed storage deletions (continues with DB deletion)
- ❌ Unauthorized deletion attempts (rejected with warning)

## Implementation Details

### File: `pitchingService.js` - `deletePitch()`

**Parameters:**
```javascript
deletePitch(pitchId, userId = null)
```

**What it does:**
1. ✅ Verifies user is authenticated
2. ✅ Fetches pitch and checks creator ownership
3. ✅ Extracts file paths from Supabase URLs
4. ✅ Deletes video from `pitches` bucket
5. ✅ Deletes thumbnail from `pitches` bucket
6. ✅ Deletes pitch record from database
7. ✅ Returns success message with file count

**Example Usage:**
```javascript
import { deletePitch } from '../services/pitchingService';

const { success, error, message } = await deletePitch(pitchId);

if (success) {
  console.log('✅', message); // "Pitch deleted successfully (2 file(s) removed)"
} else {
  console.error('❌', error); // Error message
}
```

**Console Output (Success):**
```
🗑️  Starting deletion process for pitch abc123...
📌 Pitch "My Startup Idea" belongs to creator. Proceeding with deletion...
   🎥 Video file path: pitches/abc123/1705978800000_video.mp4
   ✅ Video file deleted from Supabase storage
   🖼️  Thumbnail file path: pitches/abc123/1705978800000_thumb.jpg
   ✅ Thumbnail deleted from Supabase storage
🗄️  Deleting pitch record from database...
✅ Pitch "My Startup Idea" fully deleted
   - Storage files deleted: 2
   - Database record deleted: ✅
```

**Console Output (Error - Unauthorized):**
```
🗑️  Starting deletion process for pitch abc123...
⚠️  Unauthorized deletion attempt: User user123 tried to delete pitch by otheruser456
❌ You can only delete your own pitches
```

### File: `statusService.js` - `deleteStatus()`

**Parameters:**
```javascript
deleteStatus(statusId, userId = null)
```

**What it does:**
1. ✅ Verifies user is authenticated
2. ✅ Fetches status and checks creator ownership
3. ✅ Identifies if media is user-uploaded or shared pitch
4. ✅ Deletes media from `user-content` bucket (if user-uploaded)
5. ✅ Does NOT delete shared pitch videos (managed by pitch creator)
6. ✅ Deletes status record from database
7. ✅ Returns success message with file count

**Example Usage:**
```javascript
import { deleteStatus } from '../services/statusService';

const { success, error } = await deleteStatus(statusId);

if (success) {
  console.log('✅ Status deleted successfully');
} else {
  console.error('❌', error);
}
```

**Console Output (Success - User Upload):**
```
🗑️  Starting deletion process for status xyz789...
📌 Status belongs to creator. Proceeding with deletion...
   📹 Media file path: statuses/userid/1705978800000_image.jpg
   ✅ Media file deleted from Supabase storage
🗄️  Deleting status record from database...
✅ Status deleted successfully
   - Storage files deleted: 1
   - Database record deleted: ✅
```

**Console Output (Success - Shared Pitch):**
```
🗑️  Starting deletion process for status xyz789...
📌 Status belongs to creator. Proceeding with deletion...
   ℹ️  Media is a shared pitch video (managed separately)
🗄️  Deleting status record from database...
✅ Status deleted successfully
   - Storage files deleted: 0
   - Database record deleted: ✅
```

## File Path Extraction

### Signed URL (With Token)
```
Format: https://xyz.supabase.co/storage/v1/object/sign/pitches/UUID/timestamp_filename?token=xxx

Extracted Path: pitches/UUID/timestamp_filename
```

### Public URL
```
Format: https://xyz.supabase.co/storage/v1/object/public/pitches/UUID/timestamp_filename

Extracted Path: pitches/UUID/timestamp_filename
```

### Both Handled Correctly
```javascript
if (url.includes('?token=')) {
  // Signed URL - remove token first
  const urlWithoutToken = url.split('?')[0];
  filePath = urlWithoutToken.match(/pitches\/(.+)$/)[1];
} else {
  // Public URL
  filePath = url.match(/\/pitches\/(.+)$/)[1];
}
```

## Database Queries

### Find All User's Pitches
```sql
SELECT id, title, video_url FROM pitches 
WHERE user_id = 'user-uuid'
ORDER BY created_at DESC;
```

### Find All User's Status Updates
```sql
SELECT id, caption, media_url FROM ican_statuses 
WHERE user_id = 'user-uuid'
ORDER BY created_at DESC;
```

### Count User's Content
```sql
SELECT 
  (SELECT COUNT(*) FROM pitches WHERE user_id = 'user-uuid') as pitch_count,
  (SELECT COUNT(*) FROM ican_statuses WHERE user_id = 'user-uuid') as status_count;
```

## UI Integration Example

### Delete Pitch Button
```javascript
const handleDeletePitch = async (pitchId) => {
  if (!window.confirm('Delete this pitch permanently? This cannot be undone.')) {
    return;
  }

  try {
    const { success, error, message } = await deletePitch(pitchId);
    
    if (success) {
      alert('✅ ' + message);
      // Refresh pitch list or redirect
      window.location.reload();
    } else {
      alert('❌ ' + error);
    }
  } catch (err) {
    alert('❌ Error deleting pitch: ' + err.message);
  }
};

// In JSX:
<button 
  onClick={() => handleDeletePitch(pitch.id)}
  className="text-red-500 hover:text-red-700"
>
  Delete Pitch
</button>
```

### Delete Status Button
```javascript
const handleDeleteStatus = async (statusId) => {
  if (!window.confirm('Delete this status? This cannot be undone.')) {
    return;
  }

  try {
    const { success, error } = await deleteStatus(statusId);
    
    if (success) {
      alert('✅ Status deleted');
      // Refresh status list
      window.location.reload();
    } else {
      alert('❌ ' + error);
    }
  } catch (err) {
    alert('❌ Error deleting status: ' + err.message);
  }
};
```

## Error Handling

### Common Errors & Solutions

| Error | Cause | Solution |
|-------|-------|----------|
| "Must be signed in" | User not authenticated | Sign in first |
| "You can only delete your own..." | Not the creator | Only creators can delete |
| "Status not found" | Invalid ID | Verify status exists |
| "Could not delete media from storage" | File already deleted/missing | Database deletion continues |
| "Failed to delete pitch" | Database error | Check database connection |

### Graceful Degradation
If storage deletion fails, the database deletion still proceeds:
```javascript
if (storageError) {
  console.warn('Could not delete from storage:', storageError);
  // Continue with database deletion
}
```

## Testing Checklist

### Test Pitch Deletion
- [ ] Sign in as creator
- [ ] Create and upload a pitch
- [ ] View pitch in list
- [ ] Click delete button
- [ ] Confirm deletion
- [ ] ✅ Check console for success messages
- [ ] ✅ Verify pitch removed from list
- [ ] ✅ Check Supabase Storage → pitches bucket (files should be gone)
- [ ] ✅ Check database (record should be gone)

### Test Status Deletion
- [ ] Sign in as creator
- [ ] Create and upload a status
- [ ] View status in feed
- [ ] Click delete button
- [ ] Confirm deletion
- [ ] ✅ Check console for success messages
- [ ] ✅ Verify status removed from feed
- [ ] ✅ Check Supabase Storage → user-content bucket (files should be gone)
- [ ] ✅ Check database (record should be gone)

### Test Security
- [ ] Sign in as User A
- [ ] Try to delete User B's pitch ❌ Should fail
- [ ] Sign in as User B
- [ ] Delete their own pitch ✅ Should succeed
- [ ] Log out
- [ ] Try to delete pitch ❌ Should fail

### Test Shared Pitches
- [ ] Creator uploads pitch
- [ ] User B shares pitch as status
- [ ] User B deletes the status
- [ ] ✅ Status record deleted
- [ ] ✅ Original pitch video still exists (User A can still use it)

## Logging & Monitoring

### What Gets Logged
```
🗑️  Starting deletion process
📌 Ownership verification
🎥 File paths being deleted
✅ Successful deletions
⚠️  Warning messages (non-fatal errors)
🗄️  Database deletion
❌ Critical errors
```

### Check Logs In
1. Browser Console (F12)
2. Supabase Dashboard → Logs
3. Application error tracking (if configured)

## Performance Considerations

### Parallel Deletion
Files are deleted sequentially (video, then thumbnail) to maintain clarity in logs.

### Database Cleanup
- Main deletion: Immediate
- Cascading deletes: Handled by database triggers (if configured)
- Orphaned records: None (deletion is comprehensive)

### Storage Cleanup
- Deletes actual files from Supabase buckets
- Frees up storage space
- Reduces storage costs

## Troubleshooting

### Files Not Deleted from Storage
**Check:**
1. Verify file path extraction works
2. Check Supabase bucket policies allow deletion
3. Verify user has proper permissions
4. Check network requests in DevTools

**Solution:**
```javascript
// Enable debug logging
console.log('Attempting to delete:', filePath);
const { error } = await storage.remove([filePath]);
console.log('Storage error:', error);
```

### Database Record Not Deleted
**Check:**
1. Verify user is the creator
2. Check database connection
3. Verify primary key constraints

**Manual Fix:**
```sql
DELETE FROM pitches WHERE id = 'pitch-id';
DELETE FROM ican_statuses WHERE id = 'status-id';
```

## Related Documentation

- [Supabase Storage API](https://supabase.com/docs/reference/javascript/storage-remove)
- [Database RLS Policies](https://supabase.com/docs/guides/auth/row-level-security)

---

**Status:** ✅ IMPLEMENTED  
**Date:** January 23, 2026  
**Security Level:** HIGH - Creator-only access enforced

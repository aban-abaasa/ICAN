# 📋 Quick Reference: Video Upload System

## The Golden Rule
**NEVER store blob URLs in the database!**

```javascript
❌ WRONG:
const blobUrl = URL.createObjectURL(file);
await createPitch({ video_url: blobUrl }); // Will fail after refresh!

✅ RIGHT:
const { success, url } = await uploadVideo(file, pitchId);
await createPitch({ video_url: url }); // Persists across sessions
```

## Upload Flow Diagram

```
User Selects Video
        ↓
   uploadVideo(file, pitchId)
        ↓
   Upload to Supabase Storage
        ↓
   Generate Signed URL (365-day valid)
        ↓
   Return: { success: true, url: "https://..." }
        ↓
   Store URL in Database
        ↓
   ✅ Video persists forever
```

## Error Messages & Solutions

### Error: "Failed to load resource: net::ERR_FILE_NOT_FOUND"
**Cause:** Blob URL stored in database  
**Solution:** Delete record and re-upload video to Supabase

### Error: "Cannot save blob URLs to database"
**Cause:** Trying to save blob: URL  
**Solution:** Call `uploadVideo()` first to get Supabase URL

### Error: "CRITICAL: Supabase not configured"
**Cause:** `.env.local` missing Supabase credentials  
**Solution:** Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY

### Error: "CRITICAL: Not authenticated"
**Cause:** User not logged in  
**Solution:** User must sign in before uploading videos

## Key Functions

### Upload Video to Supabase
```javascript
import { uploadVideo } from '../services/pitchingService';

const { success, url, error } = await uploadVideo(file, pitchId);

if (success) {
  console.log('✅ Video at:', url); // https://xyz.supabase.co/...
  // Now safe to store in database
} else {
  console.error('❌', error);
}
```

### Create Status with Validation
```javascript
import { createStatus } from '../services/statusService';

const { status, error } = await createStatus(userId, {
  media_type: 'video',
  media_url: url, // Must be https:// URL (not blob:)
  caption: '...'
});

if (error) {
  console.error('❌', error);
}
```

### Create Pitch with Validation
```javascript
import { createPitch } from '../services/pitchingService';

const { success, error } = await createPitch({
  title: '...',
  video_url: url, // Must be https:// URL (not blob:)
  // ... other fields
});

if (!success) {
  console.error('❌', error);
}
```

## Storage Buckets Reference

| Bucket | Purpose | File Path |
|--------|---------|-----------|
| `pitches` | Pitch videos | `{pitchId}/{timestamp}_{filename}` |
| `user-content` | Status photos/videos | `statuses/{userId}/{filename}` |

## Authentication Flow

```javascript
// Always check auth before uploading
const { data: { session } } = await supabase.auth.getSession();

if (!session) {
  alert('Please sign in first');
  return;
}

// Now safe to upload
const { success, url } = await uploadVideo(file, pitchId);
```

## Testing Checklist

Before committing changes:

```javascript
// Test 1: Upload works
✅ Video uploads to Supabase
✅ Console shows "✅ Upload successful!"
✅ URL starts with https://

// Test 2: URL is stored
✅ URL saved in database (not blob:)
✅ Select from DB shows supabase.co URL

// Test 3: Persistence
✅ Refresh page → Video still loads
✅ Check Network tab → URL is https (not blob:)

// Test 4: Error handling
✅ Close .env → Error message shown
✅ Logout user → Error message shown
✅ Try blob: URL → Error message shown
```

## Common Mistakes

### ❌ Mistake 1: Using blob URL directly
```javascript
const blobUrl = URL.createObjectURL(file);
createStatus({ media_url: blobUrl }); // WRONG!
```

**Fix:**
```javascript
const { url } = await uploadStatusMedia(userId, file);
createStatus({ media_url: url }); // RIGHT!
```

### ❌ Mistake 2: Fallback to blob URL
```javascript
if (uploadFails) {
  return URL.createObjectURL(file); // WRONG!
}
```

**Fix:**
```javascript
if (uploadFails) {
  throw new Error('Upload failed. User should try again.');
}
```

### ❌ Mistake 3: Storing URL before upload completes
```javascript
const url = URL.createObjectURL(file); // Temporary!
await createPitch({ video_url: url }); // WRONG!
```

**Fix:**
```javascript
const { url } = await uploadVideo(file, pitchId); // Wait for upload
await createPitch({ video_url: url }); // Then store
```

## Debugging Tips

### Check if URL is valid
```javascript
// Good:
https://xyz.supabase.co/storage/v1/object/sign/pitches/...?token=...

// Bad:
blob:http://localhost:3000/12345-abcd
file:///C:/Users/.../video.mp4
/storage/pitches/video.mp4
```

### Verify upload succeeded
```javascript
const result = await uploadVideo(file, pitchId);
console.log('Success:', result.success);        // Should be true
console.log('URL:', result.url);               // Should be https://
console.log('Error:', result.error);           // Should be null
```

### Check Supabase Dashboard
1. Storage → pitches → Browse files
2. Verify file exists with correct name
3. Verify file size is > 0 bytes
4. Try downloading file directly

### Test Signed URL
```javascript
// Try opening signed URL in new tab
// Should show video, not 404
```

## Environment Variables

```bash
# Frontend (.env.local)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGc...

# Backend (.env)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...
```

## Database Queries

### Find blob URLs (should be empty)
```sql
SELECT COUNT(*) as blob_count FROM pitches 
WHERE video_url LIKE 'blob:%';

SELECT COUNT(*) as blob_count FROM ican_statuses 
WHERE media_url LIKE 'blob:%';
```

### Check real URLs
```sql
SELECT video_url FROM pitches LIMIT 5;
-- Should show: https://xyz.supabase.co/...

SELECT media_url FROM ican_statuses LIMIT 5;
-- Should show: https://xyz.supabase.co/...
```

## Performance Tips

1. **Compression:** Large videos take longer to upload
2. **Signed URL expiry:** Use 365 days for permanent access
3. **Concurrent uploads:** Limit to 3 attempts with exponential backoff
4. **Progress tracking:** Show upload percentage to user

---

**Remember:** If it's temporary, don't save it to the database!

**Last Updated:** January 23, 2026

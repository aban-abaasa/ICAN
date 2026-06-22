# Web Share Target Implementation - Share Directly to Status Updates

## Overview
When users share content from other applications (photos, text, links, PDFs) to the IcanEra PWA, it now connects directly to the "Any Updates / Share a moment with your community" feature (Status Updates).

## How It Works

### 1. **Web Share Target Configuration** (`manifest.json`)
```json
"share_target": {
  "action": "/share",
  "method": "POST",
  "enctype": "multipart/form-data",
  "params": {
    "title": "title",
    "text": "text",
    "url": "url",
    "files": [
      {
        "name": "media",
        "accept": ["image/*", "application/pdf"]
      }
    ]
  }
}
```

### 2. **Service Worker Handler** (`sw.js`)
- **Intercepts POST requests** to `/share`
- **Stores shared content** in IndexedDB:
  - `sharedContent` store: metadata (title, text, url, timestamp)
  - `sharedFiles` store: actual file blobs (images, PDFs)
- **Redirects to app** with `?share=true` parameter

### 3. **Content Retrieval Service** (`sharedContentService.js`)
Provides functions to:
- `getPendingSharedContent()` - Get unconsumed shared items
- `getSharedFiles(sharedId)` - Get files for a shared item
- `markSharedContentAsConsumed(sharedId)` - Mark as used
- `convertSharedFilesToFiles(sharedFiles)` - Convert blobs to File objects
- `cleanupOldSharedContent()` - Remove old items (7+ days)

### 4. **MobileView Integration** 
**Effect that checks for shared content on mount:**
```javascript
useEffect(() => {
  const checkSharedContent = async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const isShareAction = urlParams.get('share') === 'true';
    
    if (isShareAction) {
      const pendingContent = await getPendingSharedContent();
      if (pendingContent && pendingContent.length > 0) {
        const latestShare = pendingContent[0];
        const files = await getSharedFiles(latestShare.id);
        const convertedFiles = await convertSharedFilesToFiles(files);
        
        setSharedContent({
          ...latestShare,
          files: convertedFiles
        });
        
        setShowStatusUploader(true);
        window.history.replaceState({}, '', window.location.pathname);
      }
    }
  };
  
  checkSharedContent();
}, []);
```

### 5. **StatusUploader Component**
**Enhanced to accept and display shared content:**
- Accepts `sharedContent` prop
- Pre-fills caption with: title + text + url
- Loads first shared file as preview
- Switches to appropriate mode (media/text)
- Marks content as consumed after posting

## User Flow

1. **User shares from another app** (e.g., Photos, Chrome, Files)
   - Selects "IcanEra" from share sheet
   
2. **Service worker intercepts**
   - Saves content to IndexedDB
   - Redirects to `/?share=true`
   
3. **App detects share action**
   - Retrieves shared content from IndexedDB
   - Opens Status Uploader modal
   
4. **Status Uploader shows pre-filled content**
   - Caption filled with shared text/url
   - Image/PDF displayed as preview
   - User can edit/add more before posting
   
5. **After posting or closing**
   - Content marked as consumed
   - Removed from pending queue

## Supported Content Types

### Text Content
- Title
- Text/Description
- URLs

### Files
- Images: JPEG, PNG, WebP
- PDFs (displayed as image preview)
- Videos: MP4, MOV, WebM (with auto-compression)

## Error Handling

### Service Worker
- Falls back to redirecting to app root if errors occur
- Logs errors for debugging

### App Layer
- Gracefully handles missing IndexedDB stores
- Continues normal operation if shared content fails to load
- Provides user feedback via StatusUploader error state

## Testing Checklist

### Prerequisites
- [ ] PWA must be installed on device
- [ ] Service worker must be registered and active

### Test Cases

1. **Share Image from Photos App**
   - Open Photos app
   - Select an image
   - Tap share → IcanEra
   - ✅ App opens with Status Uploader showing image

2. **Share Text from Browser**
   - Select text on a webpage
   - Share → IcanEra
   - ✅ App opens with Status Uploader pre-filled with text

3. **Share URL from Browser**
   - Share a webpage
   - ✅ App opens with URL in caption field

4. **Share Multiple Items**
   - Share with both text and image
   - ✅ Both appear in Status Uploader

5. **User Cancels**
   - Open share target but close without posting
   - ✅ Content marked as consumed
   - ✅ Doesn't appear again on next app open

6. **Offline Sharing**
   - Turn off network
   - Share content to app
   - ✅ Content stored locally
   - ✅ Can post when back online

## File Structure

```
frontend/
├── sw.js                                    # Service worker with share handler
├── manifest.json                            # PWA manifest with share_target
├── src/
│   ├── components/
│   │   ├── MobileView.jsx                  # Main mobile UI with share detection
│   │   └── status/
│   │       └── StatusUploader.jsx          # Status composer with shared content support
│   └── services/
│       └── sharedContentService.js          # IndexedDB operations for shared content
```

## Browser Compatibility

- ✅ Chrome/Edge (Android): Full support
- ✅ Safari (iOS 15+): Requires PWA installation
- ❌ Desktop browsers: Limited share target support
- ✅ Firefox (Android): Experimental support

## Security Considerations

1. **Input Validation**
   - File type checking (images, PDFs only)
   - File size limits (10MB images, 2GB videos)
   - URL sanitization

2. **Content Isolation**
   - Each user's shared content stored separately
   - Content tied to authenticated session
   - Auto-cleanup of old content (7 days)

3. **Privacy**
   - Shared content stored locally in IndexedDB
   - Not sent to server until user posts
   - User can cancel without uploading

## Performance Optimizations

1. **Lazy Loading**
   - Shared content service imported on demand
   - Files loaded only when needed

2. **Memory Management**
   - Blob URLs properly released after use
   - Old shared content auto-cleaned

3. **Compression**
   - Large videos auto-compressed before upload
   - Images under 10MB used as-is

## Future Enhancements

- [ ] Support sharing to specific groups/boards
- [ ] Batch share multiple images
- [ ] Share to different modules (Pitchin, Trust, etc.)
- [ ] Rich preview for shared URLs
- [ ] Share history/recent shares
- [ ] Custom share templates

## Troubleshooting

### Share target not appearing
1. Ensure PWA is installed
2. Check service worker registration: DevTools → Application → Service Workers
3. Verify manifest.json is properly linked in index.html
4. Check browser console for errors

### Shared content not loading
1. Open DevTools → Application → IndexedDB
2. Check `IcanEraLocalDB` → `sharedContent` table
3. Verify content exists with `consumed: false`
4. Check browser console for service errors

### Files not previewing
1. Check file type is supported
2. Verify file size is within limits
3. Check browser console for blob URL errors
4. Ensure sufficient storage space

## Related Documentation

- [Web Share Target API](https://web.dev/web-share-target/)
- [Service Workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)
- [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
- [PWA Installation](https://web.dev/install-criteria/)

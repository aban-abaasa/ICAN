# FFmpeg Util Library CDN Loading Fix

## Problem
The VideoClipper component was failing to load the FFmpeg util library from CDN with the error:
```
❌ FFmpeg initialization error: Error: Failed to load FFmpeg util script
```

This caused:
- FFmpeg initialization to fail completely
- Button showing "❌ FFMPEG ERROR" instead of "CLIP & CONTINUE"
- Video clipping feature completely non-functional

## Root Cause
The original implementation had a single CDN URL for each library with no fallback:
- If JSDelivr CDN was slow/down, the entire load would fail
- No retry logic or alternative CDN sources
- No validation that the specific library versions existed on the CDN

## Solution Implemented

### 1. **Multiple CDN Fallbacks**
Added three fallback CDN sources for each library in order of preference:

**FFmpeg Core Library:**
- JSDelivr: `https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.6/dist/ffmpeg.min.js`
- Cloudflare: `https://cdnjs.cloudflare.com/ajax/libs/ffmpeg.js/0.12.6/ffmpeg.min.js`
- Unpkg: `https://unpkg.com/@ffmpeg/ffmpeg@0.12.6/dist/ffmpeg.min.js`

**FFmpeg Util Library:**
- JSDelivr: `https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.0/dist/util.min.js`
- Cloudflare: `https://cdnjs.cloudflare.com/ajax/libs/ffmpeg.js/util.min.js`
- Unpkg: `https://unpkg.com/@ffmpeg/util@0.12.0/dist/util.min.js`

**FFmpeg WASM Core:**
- JSDelivr: `https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/ffmpeg-core.js`
- Unpkg: `https://unpkg.com/@ffmpeg/core@0.12.6/dist/ffmpeg-core.js`

### 2. **Retry Logic**
Each library is loaded with automatic fallback:
```javascript
for (const url of ffmpegUrls) {
  try {
    console.log(`📥 Attempting to load FFmpeg from: ${url}`);
    await loadScript(url, 'ffmpeg');
    ffmpegLoaded = true;
    break;  // Success - exit loop
  } catch (error) {
    console.warn(`⚠️ Failed to load from ${url}, trying next CDN...`);
    continue;  // Try next URL
  }
}
```

### 3. **Enhanced Error Messages**
Console logs now show:
- Which CDN is being tried
- Which CDN failed and why
- When fallback CDNs are being used
- Troubleshooting hints if all CDNs fail

Example output:
```
🎬 Starting FFmpeg initialization...
📥 Attempting to load FFmpeg from: https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.6/dist/ffmpeg.min.js
✅ Script loaded: ffmpeg
📥 Attempting to load FFmpeg util from: https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.0/dist/util.min.js
⚠️ Failed to load util from JSDelivr, trying next CDN...
📥 Attempting to load FFmpeg util from: https://unpkg.com/@ffmpeg/util@0.12.0/dist/util.min.js
✅ Script loaded: util
✅ FFmpeg util library loaded
```

### 4. **Improved Button Feedback**
Button now displays context-sensitive help:

| State | Button Display | Tooltip |
|-------|---|---|
| FFmpeg loading (first time) | 🔄 LOADING FFMPEG... | "Loading FFmpeg... This may take 10-30 seconds on first run..." |
| FFmpeg loaded | ✓ CLIP & CONTINUE | "Ready to clip! Select your trim times..." |
| FFmpeg error | ❌ FFMPEG ERROR | "FFmpeg Error: [error] - Try refreshing..." |
| Invalid clip duration | ❌ FFMPEG ERROR (disabled) | "Clip must be between 1 and 60 seconds" |
| Processing clip | 🔄 PROCESSING... | (spinning animation) |

### 5. **Better Global Variable Checking**
Changed from checking only `window.FFmpeg.FFmpeg` to also checking `window.FFmpeg.fetchFile`:
```javascript
while ((typeof window.FFmpeg === 'undefined' || typeof window.FFmpeg.fetchFile === 'undefined') && attempts < maxAttempts) {
  await new Promise(resolve => setTimeout(resolve, 100));
  attempts++;
}
```

Increased timeout from 100 to 150 attempts (15 seconds max) to accommodate slower connections.

## Files Modified
- **VideoClipper.jsx**: Updated FFmpeg initialization effect and button UI

## Testing Checklist
- [ ] Open Pitchin application and click "Create Pitch" to open VideoClipper
- [ ] Observe "LOADING FFMPEG..." button (first load: 10-30s, subsequent: 1-2s)
- [ ] Console should show CDN loading attempts and success messages
- [ ] If JSDelivr fails, watch console show fallback to Cloudflare/Unpkg
- [ ] Button changes to "CLIP & CONTINUE" when ready
- [ ] Set trim handles and click button
- [ ] Video should be clipped (not full video uploaded)
- [ ] Refresh page and test again (should be faster, ~1-2 seconds)

## Performance Expectations
**First Load:**
- FFmpeg scripts: 2-5 seconds
- WASM core download: 8-25 seconds
- **Total: 10-30 seconds**

**Subsequent Loads (browser cached):**
- Scripts: <100ms (cached)
- WASM: 1-2 seconds (cached)
- **Total: 1-2 seconds**

**Clipping Operation:**
- 10-20 second clip: 3-5 seconds
- 30-60 second clip: 5-10 seconds
- Depends on system CPU and clip length

## Troubleshooting

### "Still seeing FFmpeg error"
1. Check browser Network tab for failed requests
2. Check if all CDNs are accessible in your region
3. Try different browser
4. Hard refresh (Ctrl+Shift+R or Cmd+Shift+R)

### "Loading FFMPEG takes very long"
- Normal on first load! Can take up to 30 seconds
- Subsequent loads should be 1-2 seconds (browser cache)
- If consistently slow, check internet connection speed

### "Button shows ❌ FFMPEG ERROR after 30 seconds"
- All CDN sources failed to load
- Check internet connection
- Check if firewalls/VPN blocking CDN access
- Try refreshing page
- Check console for specific error messages

## Future Improvements
1. Add local fallback (include FFmpeg in build if all CDNs fail)
2. Add progress indication for WASM download (currently silent)
3. Add service worker caching for faster subsequent loads
4. Implement retry queue with exponential backoff for failed loads
5. Add telemetry to track which CDN works best in each region

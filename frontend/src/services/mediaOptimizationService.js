/**
 * Media Optimization Service
 * Compresses and optimizes images and videos like WhatsApp
 * Maintains quality while dramatically reducing file size
 */

/**
 * Compress image like WhatsApp
 * - Max resolution: 2000x2000 (most phones are 1080p)
 * - Quality: 85% JPEG for balance
 * - Metadata: Stripped
 * @param {File} file - Image file
 * @returns {Promise<{blob: Blob, originalSize: number, compressedSize: number}>}
 */
export const compressImage = async (file) => {
  return new Promise((resolve, reject) => {
    try {
      const reader = new FileReader();
      
      reader.onload = (e) => {
        const img = new Image();
        
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let { width, height } = img;
          
          // Resize if larger than WhatsApp limit (2000x2000)
          const maxDimension = 2000;
          if (width > maxDimension || height > maxDimension) {
            const ratio = Math.min(maxDimension / width, maxDimension / height);
            width = Math.round(width * ratio);
            height = Math.round(height * ratio);
          }
          
          canvas.width = width;
          canvas.height = height;
          
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          
          // Convert to JPEG with 85% quality (WhatsApp's sweet spot)
          canvas.toBlob(
            (blob) => {
              const originalSize = file.size;
              const compressedSize = blob.size;
              const compressionRatio = Math.round((1 - compressedSize / originalSize) * 100);
              
              console.log(`📸 Image compressed: ${(originalSize / 1024 / 1024).toFixed(2)}MB → ${(compressedSize / 1024 / 1024).toFixed(2)}MB (${compressionRatio}% reduction)`);
              
              resolve({
                blob,
                originalSize,
                compressedSize,
                compressionRatio,
                dimensions: { width, height }
              });
            },
            'image/jpeg',
            0.85 // Quality: 85%
          );
        };
        
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = e.target.result;
      };
      
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    } catch (error) {
      reject(error);
    }
  });
};

/**
 * Get video compression recommendations like WhatsApp
 * WhatsApp uses: 480p-720p, H.264 codec, ~2500kbps bitrate
 * @param {File} file - Video file
 * @returns {Promise<{recommendations: Object, originalSize: number}>}
 */
export const getVideoCompressionInfo = async (file) => {
  return new Promise((resolve, reject) => {
    try {
      const video = document.createElement('video');
      const reader = new FileReader();
      
      reader.onload = (e) => {
        video.onloadedmetadata = () => {
          const { videoWidth: width, videoHeight: height, duration } = video;
          const bitrate = (file.size * 8) / (duration * 1000); // kbps
          const originalSizeMB = file.size / 1024 / 1024;
          
          // WhatsApp-style recommendation with smart bitrate
          // Target: 1 min video = ~15-20MB, 10 min video = ~50MB
          let targetResolution = '720p';
          let targetBitrate = 2500; // kbps default
          let targetFps = 30;
          
          // Adjust resolution based on input
          if (width <= 720) {
            targetResolution = '720p';
            targetBitrate = 1800;
          } else if (width <= 1080) {
            targetResolution = '720p'; // Scale down
            targetBitrate = 2200;
          } else {
            targetResolution = '480p'; // Scale down significantly
            targetBitrate = 1500;
          }
          
          // Smart bitrate adjustment for very long videos
          // Reduce bitrate for long videos to keep file size reasonable
          if (duration > 600) { // > 10 minutes
            targetBitrate = Math.max(1000, targetBitrate * 0.7);
          } else if (duration > 300) { // > 5 minutes
            targetBitrate = Math.max(1200, targetBitrate * 0.85);
          }
          
          // Estimate compressed size more accurately
          const estimatedCompressedSize = (targetBitrate * duration) / 8 / 1000; // MB
          const estimatedCompressionRatio = Math.round((1 - estimatedCompressedSize / originalSizeMB) * 100);
          
          // Safety checks
          const finalEstimatedSize = Math.max(2, Math.min(estimatedCompressedSize, 500)); // Min 2MB, max 500MB
          
          resolve({
            recommendations: {
              resolution: targetResolution,
              bitrate: Math.round(targetBitrate),
              fps: targetFps,
              codec: 'h.264',
              preset: 'fast', // Balance between speed and compression
              estimatedSize: finalEstimatedSize,
              estimatedCompressionRatio: Math.max(0, estimatedCompressionRatio),
              estimatedTime: duration / 2 // Rough encoding time estimate
            },
            videoInfo: {
              originalSize: originalSizeMB,
              duration,
              currentResolution: `${width}x${height}`,
              currentBitrate: Math.round(bitrate),
              durationFormatted: formatVideoDuration(duration)
            }
          });
        };
        
        video.onerror = () => reject(new Error('Failed to load video'));
        video.src = e.target.result;
      };
      
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    } catch (error) {
      reject(error);
    }
  });
};

/**
 * Create a proxy blob for video (we can't actually compress in browser without FFmpeg)
 * In production, this would use FFmpeg.js or send to server
 * For now, returns metadata for server-side compression
 */
export const prepareVideoForCompression = async (file, recommendations) => {
  // Return metadata that can be used for server-side compression
  return {
    originalBlob: file,
    originalSize: file.size,
    recommendations,
    metadata: {
      filename: file.name,
      type: file.type,
      lastModified: file.lastModified
    }
  };
};

/**
 * Format video duration nicely
 */
export const formatVideoDuration = (seconds) => {
  if (!Number.isFinite(seconds)) return '0:00';
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hours > 0) {
    return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

/**
 * Convert blob to file
 */
export const blobToFile = (blob, filename = 'media.jpg') => {
  return new File([blob], filename, { type: blob.type });
};

/**
 * Format size nicely
 */
export const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
};

/**
 * Check if compression is recommended
 */
export const shouldCompress = (file, maxSizeMB = 50) => {
  return file.size > maxSizeMB * 1024 * 1024;
};

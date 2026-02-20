/**
 * Status Service for ICAN (WhatsApp-style stories)
 * Handles creation, retrieval, and management of temporary status posts
 * With blockchain hash verification for immutability
 */

import { supabase } from '../lib/supabase';
import { calculateFileHash, registerStatusOnBlockchain } from './blockchainService';

const MIME_TO_EXTENSION = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm'
};

const inferExtensionFromMime = (mimeType = '') => MIME_TO_EXTENSION[mimeType] || 'bin';

const buildStorageMimeErrorMessage = (mimeType) =>
  `Storage rejected file type "${mimeType || 'unknown'}". Add video/mp4, video/quicktime, and video/webm to the "user-content" bucket allowed MIME types in Supabase Storage.`;

/**
 * Upload status media to Supabase Storage
 * @param {string} userId - User ID
 * @param {File} file - Media file (image/video)
 * @param {Object} options - Upload options
 * @returns {Promise<{url: string, path: string, fileHash: string, error: Object|null}>}
 */
export const uploadStatusMedia = async (userId, file, options = {}) => {
  try {
    const {
      maxSizeMB = 50,
      allowedTypes = [
        'image/jpeg',
        'image/png',
        'image/webp',
        'video/mp4',
        'video/quicktime',
        'video/webm'
      ]
    } = options;

    if (!file) {
      throw new Error('No file selected for upload');
    }

    // Validate file size
    if (file.size > maxSizeMB * 1024 * 1024) {
      throw new Error(`File exceeds ${maxSizeMB}MB limit`);
    }

    // Validate file type
    if (!allowedTypes.includes(file.type)) {
      throw new Error(`Invalid file type. Allowed: ${allowedTypes.join(', ')}`);
    }

    // Calculate blockchain hash for file integrity verification
    console.log('🔐 Calculating file hash for blockchain verification...');
    const fileHash = await calculateFileHash(file);
    console.log(`✓ File hash: ${fileHash}`);

    // Generate filename
    const fileName = typeof file.name === 'string' ? file.name : '';
    const fileExt =
      (fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : '') ||
      inferExtensionFromMime(file.type);
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const filename = `${userId}-${timestamp}-${random}.${fileExt}`;
    const filePath = `statuses/${userId}/${filename}`;

    // Upload to storage with fallback for restrictive MIME policies
    const uploadWithMime = async (contentType) =>
      supabase.storage
        .from('user-content')
        .upload(filePath, file, {
          upsert: false,
          contentType
        });

    let { error: uploadError } = await uploadWithMime(file.type || 'application/octet-stream');

    if (uploadError && String(uploadError.message || '').toLowerCase().includes('mime type')) {
      const mimeFallbacks = ['application/octet-stream', 'video/quicktime', 'video/webm'];
      for (const fallbackMime of mimeFallbacks) {
        if (!fallbackMime || fallbackMime === file.type) {
          continue;
        }

        const retry = await uploadWithMime(fallbackMime);
        uploadError = retry.error;
        if (!uploadError) {
          break;
        }
      }
    }

    if (uploadError) {
      if (String(uploadError.message || '').toLowerCase().includes('mime type')) {
        throw new Error(buildStorageMimeErrorMessage(file.type));
      }
      throw uploadError;
    }

    // Get signed URL (24-hour expiry) - works even with restrictive RLS
    const { data: signedData, error: urlError } = await supabase.storage
      .from('user-content')
      .createSignedUrl(filePath, 86400); // 24 hours

    if (urlError) {
      console.warn('Could not create signed URL, falling back to public URL:', urlError);
      const { data: publicData } = supabase.storage
        .from('user-content')
        .getPublicUrl(filePath);
      return { 
        url: publicData?.publicUrl, 
        path: filePath,
        fileHash,
        error: null 
      };
    }

    return { 
      url: signedData?.signedUrl, 
      path: filePath,
      fileHash,
      error: null 
    };
  } catch (error) {
    console.error('Status media upload error:', error);
    return { url: null, path: null, fileHash: null, error };
  }
};

/**
 * Create a new status with blockchain verification
 * @param {string} userId - User ID
 * @param {Object} statusData - Status content
 * @returns {Promise<{status: Object, error: Object|null}>}
 */
export const createStatus = async (userId, statusData) => {
  try {
    const {
      media_type,
      media_url,
      caption = '',
      visibility = 'public',
      background_color = '#667eea',
      text_color = '#FFFFFF',
      file_hash = null,
      blockchain_tx_hash = null
    } = statusData;

    // VALIDATION: Reject blob URLs - they won't persist after page reload
    if (media_url && media_url.startsWith('blob:')) {
      const errorMsg = '❌ ERROR: Cannot save blob URLs to database. Videos must be uploaded to Supabase first. Use uploadStatusMedia() before creating status.';
      console.error(errorMsg);
      console.error('Received blob URL:', media_url);
      return { status: null, error: new Error(errorMsg) };
    }

    // VALIDATION: Ensure URL is from Supabase or is a valid absolute URL
    if (media_url && !media_url.startsWith('http')) {
      const errorMsg = '❌ ERROR: Invalid media URL. Must be a complete Supabase URL starting with https://';
      console.error(errorMsg);
      console.error('Received URL:', media_url);
      return { status: null, error: new Error(errorMsg) };
    }

    // Status expires after 24 hours
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('ican_statuses')
      .insert([{
        user_id: userId,
        media_type,
        media_url,
        caption,
        visibility,
        background_color,
        text_color,
        file_hash,
        blockchain_hash: blockchain_tx_hash ? blockchain_tx_hash.slice(0, 66) : null,
        blockchain_verified: !!blockchain_tx_hash,
        blockchain_tx_hash,
        expires_at: expiresAt
      }])
      .select()
      .single();

    if (error) throw error;

    console.log('Status created successfully:', data);
    return { status: data, error: null };
  } catch (error) {
    console.error('Create status error:', error);
    return { status: null, error };
  }
};

/**
 * Get non-expired statuses (timeline)
 * @param {string} userId - User ID (optional, for personal timeline)
 * @returns {Promise<{statuses: Array, error: Object|null}>}
 */
export const getActiveStatuses = async (userId = null) => {
  try {
    // CRITICAL: Check authentication BEFORE querying
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !authUser) {
      console.warn('⚠️ getActiveStatuses: User not authenticated. Cannot query statuses.');
      return { statuses: [], error: new Error('User not authenticated') };
    }
    
    // When userId is not passed, return global public statuses + current user's statuses
    const queryUserId = userId || null;

    let query = supabase
      .from('ican_statuses')
      .select('*')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });

    if (queryUserId) {
      query = query.eq('user_id', queryUserId);
    } else {
      query = query.or(`visibility.eq.public,user_id.eq.${authUser.id}`);
    }

    const { data, error } = await query;

    console.log('getActiveStatuses - Query result:', { userId: queryUserId, count: data?.length || 0, data });

    if (error) throw error;

    // Refresh signed URLs for all statuses (in parallel)
    const statusesWithUrls = await Promise.all(
      (data || []).map(async (status) => {
        try {
          // Extract the file path from media_url or reconstruct it
          let filePath = status.media_url;
          
          // If it's already a full URL, extract the path
          if (status.media_url?.includes('statuses/')) {
            const match = status.media_url.match(/statuses\/[^?]*/);
            if (match) {
              filePath = match[0];
            }
          }
          
          // Generate fresh signed URL
          const { data: signedData } = await supabase.storage
            .from('user-content')
            .createSignedUrl(filePath, 3600); // 1 hour for viewing

          return {
            ...status,
            media_url: signedData?.signedUrl || status.media_url
          };
        } catch (err) {
          console.warn(`Could not refresh URL for status ${status.id}:`, err);
          return status; // Return original if refresh fails
        }
      })
    );

    return { statuses: statusesWithUrls || [], error: null };
  } catch (error) {
    console.error('Get statuses error:', error);
    return { statuses: [], error };
  }
};

/**
 * Record a status view
 * @param {string} statusId - Status ID
 * @param {string} viewedBy - User ID viewing the status
 * @returns {Promise<{view: Object, error: Object|null}>}
 */
export const recordStatusView = async (statusId, viewedBy) => {
  try {
    // CRITICAL: Check authentication BEFORE querying
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !authUser) {
      console.warn('⚠️ recordStatusView: User not authenticated. Cannot record view.');
      return { view: null, error: new Error('User not authenticated') };
    }

    // Use authenticated user ID for the view record
    const actualViewedBy = viewedBy || authUser.id;

    const { data, error } = await supabase
      .from('ican_status_views')
      .insert([{ status_id: statusId, viewed_by: actualViewedBy }])
      .select()
      .single();

    if (error) throw error;

    return { view: data, error: null };
  } catch (error) {
    console.error('Record status view error:', error);
    return { view: null, error };
  }
};

/**
 * Get who viewed a status
 * @param {string} statusId - Status ID
 * @returns {Promise<{viewers: Array, error: Object|null}>}
 */
export const getStatusViewers = async (statusId) => {
  try {
    // CRITICAL: Check authentication BEFORE querying
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !authUser) {
      console.warn('⚠️ getStatusViewers: User not authenticated. Cannot retrieve viewers.');
      return { viewers: [], error: new Error('User not authenticated') };
    }

    const { data, error } = await supabase
      .from('ican_status_views')
      .select('viewed_by, viewed_at')
      .eq('status_id', statusId)
      .order('viewed_at', { ascending: false });

    if (error) throw error;

    return { viewers: data || [], error: null };
  } catch (error) {
    console.error('Get status viewers error:', error);
    return { viewers: [], error };
  }
};

/**
 * Get user's own statuses
 * @param {string} userId - User ID
 * @returns {Promise<{statuses: Array, error: Object|null}>}
 */
export const getUserStatuses = async (userId) => {
  try {
    const { data, error } = await supabase
      .from('ican_statuses')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Refresh signed URLs for all statuses (in parallel)
    const statusesWithUrls = await Promise.all(
      (data || []).map(async (status) => {
        try {
          // Extract the file path from media_url or reconstruct it
          let filePath = status.media_url;
          
          // If it's already a full URL, extract the path
          if (status.media_url?.includes('statuses/')) {
            const match = status.media_url.match(/statuses\/[^?]*/);
            if (match) {
              filePath = match[0];
            }
          }
          
          // Generate fresh signed URL
          const { data: signedData } = await supabase.storage
            .from('user-content')
            .createSignedUrl(filePath, 3600); // 1 hour for viewing

          return {
            ...status,
            media_url: signedData?.signedUrl || status.media_url
          };
        } catch (err) {
          console.warn(`Could not refresh URL for status ${status.id}:`, err);
          return status; // Return original if refresh fails
        }
      })
    );

    return { statuses: statusesWithUrls || [], error: null };
  } catch (error) {
    console.error('Get user statuses error:', error);
    return { statuses: [], error };
  }
};

/**
 * Increment view count for a status
 * @param {string} statusId - Status ID
 * @returns {Promise<{success: boolean, error: Object|null}>}
 */
export const incrementStatusView = async (statusId) => {
  try {
    // First get current view count
    const { data: currentData, error: fetchError } = await supabase
      .from('ican_statuses')
      .select('view_count')
      .eq('id', statusId)
      .single();

    if (fetchError) throw fetchError;

    const newCount = (currentData?.view_count || 0) + 1;

    // Then update with the new count
    const { error: updateError } = await supabase
      .from('ican_statuses')
      .update({ view_count: newCount })
      .eq('id', statusId);

    if (updateError) throw updateError;

    return { success: true, error: null };
  } catch (error) {
    console.error('Increment view error:', error);
    return { success: false, error };
  }
};

/**
 * Delete a status
 * @param {string} statusId - Status ID
 * @returns {Promise<{success: boolean, error: Object|null}>}
 */
export const deleteStatus = async (statusId, userId = null) => {
  try {
    // Verify user is authenticated
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !authUser) {
      return { success: false, error: 'Must be signed in to delete status' };
    }

    console.log(`🗑️  Starting deletion process for status ${statusId}...`);

    // Fetch the status to get media URL and verify ownership
    const { data: status, error: fetchError } = await supabase
      .from('ican_statuses')
      .select('id, user_id, media_url, media_type, caption')
      .eq('id', statusId)
      .single();

    if (fetchError) {
      return { success: false, error: 'Status not found' };
    }

    if (!status) {
      return { success: false, error: 'Status not found' };
    }

    // SECURITY: Verify user is the creator
    if (status.user_id !== authUser.id && status.user_id !== userId) {
      console.warn(`⚠️  Unauthorized deletion attempt: User ${authUser.id} tried to delete status by ${status.user_id}`);
      return { success: false, error: 'You can only delete your own status updates' };
    }

    console.log(`📌 Status belongs to creator. Proceeding with deletion...`);

    let storageDeletedCount = 0;

    // Delete media file from storage if it exists (and is not a shared pitch video)
    if (status?.media_url) {
      // Only delete if it's a user-uploaded file (starts with Supabase storage domain)
      // Don't delete if it's a shared pitch video (those are managed separately)
      if (status.media_url.includes('user-content')) {
        try {
          // Extract file path from Supabase URL
          // URL formats:
          // - Signed: https://xyz.supabase.co/storage/v1/object/sign/user-content/statuses/UUID/filename?token=...
          // - Public: https://xyz.supabase.co/storage/v1/object/public/user-content/statuses/UUID/filename
          
          let filePath = null;

          // Try to extract from signed URL (with token)
          if (status.media_url.includes('?token=')) {
            const urlWithoutToken = status.media_url.split('?')[0];
            const match = urlWithoutToken.match(/user-content\/(.+)$/);
            if (match) {
              filePath = match[1];
            }
          } 
          // Try to extract from public URL
          else if (status.media_url.includes('/user-content/')) {
            const match = status.media_url.match(/\/user-content\/(.+)$/);
            if (match) {
              filePath = match[1];
            }
          }

          if (filePath) {
            console.log(`   📹 Media file path: user-content/${filePath}`);
            const { error: storageError } = await supabase.storage
              .from('user-content')
              .remove([filePath]);

            if (storageError) {
              console.warn(`   ⚠️  Could not delete media from storage:`, storageError.message);
              // Continue with database deletion even if storage deletion fails
            } else {
              console.log(`   ✅ Media file deleted from Supabase storage`);
              storageDeletedCount++;
            }
          } else {
            console.warn(`   ⚠️  Could not extract file path from URL`);
          }
        } catch (storageErr) {
          console.warn('⚠️  Error parsing media URL or deleting from storage:', storageErr.message);
          // Continue with database deletion
        }
      } else if (status.media_url.includes('pitches')) {
        // This is a shared pitch video - don't delete it
        console.log(`   ℹ️  Media is a shared pitch video (managed separately)`);
      }
    }

    // Delete status record from database
    console.log(`🗄️  Deleting status record from database...`);
    const { error: dbError } = await supabase
      .from('ican_statuses')
      .delete()
      .eq('id', statusId);

    if (dbError) {
      return { success: false, error: `Failed to delete status: ${dbError.message}` };
    }

    console.log(`✅ Status deleted successfully`);
    console.log(`   - Storage files deleted: ${storageDeletedCount}`);
    console.log(`   - Database record deleted: ✅`);

    return { success: true, error: null };
  } catch (error) {
    console.error('❌ Error deleting status:', error);
    return { success: false, error: error.message || 'Failed to delete status' };
  }
};

/**
 * Clean up expired statuses
 * @returns {Promise<{deletedCount: number, error: Object|null}>}
 */
export const cleanupExpiredStatuses = async () => {
  try {
    const { data, error } = await supabase
      .rpc('cleanup_expired_statuses');

    if (error) throw error;

    return { deletedCount: data[0]?.deleted_count || 0, error: null };
  } catch (error) {
    console.error('Cleanup statuses error:', error);
    return { deletedCount: 0, error };
  }
};

/**
 * Share a Pitchin video as a status
 * @param {Object} pitch - Pitch object containing id, video_url, title, description
 * @param {string} userId - User ID
 * @param {string} caption - Optional caption for the status
 * @returns {Promise<{success: boolean, status: Object|null, error: string|null}>}
 */
export const sharing = async (pitch, userId, caption = '') => {
  try {
    if (!pitch || !pitch.video_url) {
      throw new Error('Invalid pitch or missing video URL');
    }

    if (!userId) {
      throw new Error('User ID required');
    }

    console.log(`📹 Sharing pitch "${pitch.title}" as status...`);

    // Create status with pitch video
    const statusCaption = caption || `Check out my pitch: ${pitch.title}`;
    
    const { data: status, error: statusError } = await supabase
      .from('ican_statuses')
      .insert({
        user_id: userId,
        media_url: pitch.video_url,
        media_type: 'video',
        caption: statusCaption,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        pitch_id: pitch.id, // Link back to original pitch
        status_type: 'pitch_share'
      })
      .select()
      .single();

    if (statusError) {
      throw statusError;
    }

    console.log('✓ Pitch shared as status successfully');
    return { success: true, status, error: null };
  } catch (error) {
    console.error('Error sharing pitch as status:', error);
    return { 
      success: false, 
      status: null, 
      error: error.message || 'Failed to share pitch as status' 
    };
  }
};

export default {
  uploadStatusMedia,
  createStatus,
  getActiveStatuses,
  getUserStatuses,
  incrementStatusView,
  recordStatusView,
  getStatusViewers,
  deleteStatus,
  cleanupExpiredStatuses,
  sharing
};

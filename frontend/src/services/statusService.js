/**
 * Status Service for ICAN (WhatsApp-style stories)
 * Handles creation, retrieval, and management of temporary status posts
 * With blockchain hash verification for immutability
 */

import { supabase } from '../lib/supabase';
import { calculateFileHash, registerStatusOnBlockchain } from './blockchainService';
import { resolveMediaValues, deleteFromR2, isR2Key, fromR2Value } from './r2StorageService';


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

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      throw new Error('Not authenticated - cannot upload status media');
    }

    // Upload directly to the private 'user-content' Supabase Storage bucket
    const fileExt = (file.name?.split('.').pop() || 'bin').toLowerCase();
    const timestamp = Date.now();
    const random = Math.random().toString(36).slice(2, 8);
    const filePath = `statuses/${userId}/${timestamp}-${random}.${fileExt}`;

    const { error: uploadError } = await supabase.storage
      .from('user-content')
      .upload(filePath, file, { upsert: false, contentType: file.type });

    if (uploadError) throw uploadError;

    // Bucket is private — return a signed URL for immediate use; the viewing
    // path (refreshStatusMediaUrls) re-signs it on every fetch anyway.
    const { data: signedData, error: signError } = await supabase.storage
      .from('user-content')
      .createSignedUrl(filePath, 3600);

    if (signError) throw signError;

    return {
      url: signedData.signedUrl,
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

    if (!['image', 'video', 'text'].includes(media_type)) {
      return { status: null, error: new Error('Invalid status type') };
    }

    if (media_type === 'text') {
      if (!caption?.trim()) {
        return { status: null, error: new Error('Text status requires words') };
      }
    } else if (!media_url) {
      return { status: null, error: new Error('Image/video status requires media') };
    }

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
    // Optional authentication: public statuses should still be readable.
    const {
      data: { user: authUser }
    } = await supabase.auth.getUser();
    
    if (!authUser) {
      console.info('getActiveStatuses: user not authenticated, loading public statuses');
      // Continue and return public/followers statuses.
    }
    
    // When userId is not passed, return everyone except private-only statuses.
    // This keeps status access open without requiring contact/follower relationships.
    const queryUserId = userId || null;

    let query = supabase
      .from('ican_statuses')
      .select('*')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });

    if (queryUserId) {
      query = query.eq('user_id', queryUserId);
    } else if (authUser?.id) {
      query = query.or(
        `visibility.eq.public,visibility.eq.followers,user_id.eq.${authUser.id}`
      );
    } else {
      query = query.or('visibility.eq.public,visibility.eq.followers');
    }

    const { data, error } = await query;

    console.log('getActiveStatuses - Query result:', { userId: queryUserId, count: data?.length || 0, data });

    if (error) throw error;

    // Refresh media URLs for all statuses (in parallel)
    const statusesWithUrls = await refreshStatusMediaUrls(data || []);
    const enrichedStatuses = await enrichStatusesWithPosterProfiles(statusesWithUrls);

    return { statuses: enrichedStatuses || [], error: null };
  } catch (error) {
    console.error('Get statuses error:', error);
    return { statuses: [], error };
  }
};

/**
 * Attach each status's poster real profile photo/name (poster_avatar_url,
 * poster_full_name) so the "Updates" UI can show who actually posted it
 * instead of a generic placeholder. ican_statuses only stores user_id, so
 * this is a separate batched `profiles` lookup rather than a nested select
 * (no declared FK for PostgREST embedding between the two tables).
 */
const enrichStatusesWithPosterProfiles = async (statuses) => {
  if (!statuses || statuses.length === 0) return statuses;
  try {
    const userIds = [...new Set(statuses.map(s => s.user_id).filter(Boolean))];
    if (userIds.length === 0) return statuses;

    // profiles RLS is "auth.uid() = id", so a plain select would only ever
    // return the CALLER's own row -- other posters' photos would never show.
    // fn_get_public_profile_info is SECURITY DEFINER and returns only
    // id/full_name/avatar_url (backend/PITCHIN_PUBLIC_PROFILE_INFO_RPC.sql).
    const { data: profiles, error } = await supabase
      .rpc('fn_get_public_profile_info', { p_user_ids: userIds });
    if (error) throw error;
    // avatar_url can be an r2:// key that needs a live presigned URL.
    const resolvedProfiles = await resolveMediaValues(profiles || [], ['avatar_url']);

    const profileById = new Map(resolvedProfiles.map(p => [p.id, p]));
    return statuses.map(status => {
      const poster = profileById.get(status.user_id);
      return poster
        ? { ...status, poster_full_name: poster.full_name || null, poster_avatar_url: poster.avatar_url || null }
        : status;
    });
  } catch (err) {
    console.warn('Could not enrich statuses with poster profiles:', err?.message);
    return statuses;
  }
};

/**
 * Helper: refresh media_url for a batch of statuses. R2-backed statuses
 * (media_url starting with r2://) get a fresh presigned URL via the backend;
 * legacy Supabase-hosted statuses keep the existing per-row signed-URL refresh
 * (always re-signed, since a previously stored https URL may have expired).
 */
const refreshStatusMediaUrls = async (statuses) => {
  const r2Items = statuses.filter((s) => isR2Key(s?.media_url));
  const resolvedR2 = r2Items.length > 0 ? await resolveMediaValues(r2Items, ['media_url']) : [];
  const resolvedById = new Map(resolvedR2.map((s) => [s.id, s.media_url]));

  return Promise.all(
    statuses.map(async (status) => {
      if (isR2Key(status?.media_url)) {
        return { ...status, media_url: resolvedById.get(status.id) || status.media_url };
      }

      try {
        if (!status?.media_url || status.media_type === 'text') {
          return status;
        }

        // Detect bucket and extract path from media_url
        const { bucketName, filePath } = extractBucketAndPath(status.media_url);

        // Generate fresh signed URL from correct bucket
        const { data: signedData } = await supabase.storage
          .from(bucketName)
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
};

/**
 * Helper: Extract bucket name and file path from media_url
 */
const extractBucketAndPath = (mediaUrl) => {
  let bucketName = 'user-content'; // default for existing statuses
  let filePath = mediaUrl;
  
  if (mediaUrl?.includes('/user-content/')) {
    bucketName = 'user-content';
    const match = mediaUrl.match(/user-content\/([^?]*)/);
    if (match) filePath = match[1];
  } else if (mediaUrl?.includes('/pitches/')) {
    bucketName = 'pitches';
    const match = mediaUrl.match(/pitches\/([^?]*)/);
    if (match) filePath = match[1];
  } else if (mediaUrl?.includes('statuses/')) {
    // Fallback: if just path with statuses/ prefix, use user-content
    const match = mediaUrl.match(/statuses\/[^?]*/);
    if (match) filePath = match[0];
  }
  
  return { bucketName, filePath };
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
 * Fetch a single status by id, for a shared /status/:statusId link.
 * ican_statuses grants SELECT to anon (CREATE_STATUS_FEATURES.sql, USING
 * visibility IN ('public','followers') OR user_id = auth.uid()), so this
 * works with no auth at all -- a shared link opens the update directly for a
 * signed-out visitor. Returns null for a private/other-user's status, or one
 * that has already expired (24h TTL), so the caller can show a clear message
 * instead of silently rendering nothing.
 */
export const getStatusById = async (statusId) => {
  try {
    const { data: { user: authUser } } = await supabase.auth.getUser();

    const { data, error } = await supabase
      .from('ican_statuses')
      .select('*')
      .eq('id', statusId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return { status: null, expired: false, error: null };

    const isExpired = new Date(data.expires_at).getTime() <= Date.now();
    const isOwner = authUser?.id === data.user_id;
    const isVisible = data.visibility === 'public' || data.visibility === 'followers' || isOwner;
    if (!isVisible) return { status: null, expired: false, error: null };
    if (isExpired && !isOwner) return { status: null, expired: true, error: null };

    const [withUrl] = await refreshStatusMediaUrls([data]);
    const [enriched] = await enrichStatusesWithPosterProfiles([withUrl]);
    return { status: enriched, expired: false, error: null };
  } catch (error) {
    console.error('Get status by id error:', error);
    return { status: null, expired: false, error };
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
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Refresh media URLs for all statuses (in parallel)
    const statusesWithUrls = await refreshStatusMediaUrls(data || []);
    const enrichedStatuses = await enrichStatusesWithPosterProfiles(statusesWithUrls);

    return { statuses: enrichedStatuses || [], error: null };
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
      if (isR2Key(status.media_url)) {
        const { data: { session } } = await supabase.auth.getSession();
        const { success, error } = await deleteFromR2({
          key: fromR2Value(status.media_url),
          accessToken: session?.access_token
        });
        if (success) {
          console.log(`   ✅ Media file deleted from R2`);
          storageDeletedCount++;
        } else {
          console.warn(`   ⚠️  Could not delete media from R2:`, error);
        }
      } else if (status.media_url.includes('user-content')) {
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

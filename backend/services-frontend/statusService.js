/**
 * Status Service for ICAN (WhatsApp-style stories)
 * Handles creation, retrieval, and management of temporary status posts
 */

import { supabase } from '../../lib/supabase';

/**
 * Upload status media to Supabase Storage
 * @param {string} userId - User ID
 * @param {File} file - Media file (image/video)
 * @param {Object} options - Upload options
 * @returns {Promise<{url: string, path: string, error: Object|null}>}
 */
export const uploadStatusMedia = async (userId, file, options = {}) => {
  try {
    const {
      maxSizeMB = 10,
      allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime']
    } = options;

    // Validate file size
    if (file.size > maxSizeMB * 1024 * 1024) {
      throw new Error(`File exceeds ${maxSizeMB}MB limit`);
    }

    // Validate file type
    if (!allowedTypes.includes(file.type)) {
      throw new Error(`Invalid file type. Allowed: ${allowedTypes.join(', ')}`);
    }

    // Generate filename
    const fileExt = file.name.split('.').pop().toLowerCase();
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const filename = `${userId}-${timestamp}-${random}.${fileExt}`;
    const filePath = `statuses/${userId}/${filename}`;

    // Upload to storage
    const { data, error: uploadError } = await supabase.storage
      .from('user-content')
      .upload(filePath, file, { upsert: false });

    if (uploadError) throw uploadError;

    // Get public URL
    const { data: publicData } = supabase.storage
      .from('user-content')
      .getPublicUrl(filePath);

    return { 
      url: publicData?.publicUrl, 
      path: filePath,
      error: null 
    };
  } catch (error) {
    console.error('Status media upload error:', error);
    return { url: null, path: null, error };
  }
};

/**
 * Create a new status
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
      text_color = '#FFFFFF'
    } = statusData;

    const { data, error } = await supabase
      .from('ican_statuses')
      .insert([{
        user_id: userId,
        media_type,
        media_url,
        caption,
        visibility,
        background_color,
        text_color
      }])
      .select()
      .single();

    if (error) throw error;

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
    let query = supabase
      .from('ican_statuses')
      .select(`
        *,
        user:auth.users(id, email),
        viewers:ican_status_views(viewed_by)
      `)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });

    if (userId) {
      query = query.eq('user_id', userId);
    }

    const { data, error } = await query;

    if (error) throw error;

    return { statuses: data || [], error: null };
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
    const { data, error } = await supabase
      .from('ican_status_views')
      .insert([{ status_id: statusId, viewed_by: viewedBy }])
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
 * Delete a status
 * @param {string} statusId - Status ID
 * @param {string} userId - User ID (for authorization)
 * @returns {Promise<{success: boolean, error: Object|null}>}
 */
export const deleteStatus = async (statusId, userId) => {
  try {
    const { error } = await supabase
      .from('ican_statuses')
      .delete()
      .eq('id', statusId)
      .eq('user_id', userId);

    if (error) throw error;

    return { success: true, error: null };
  } catch (error) {
    console.error('Delete status error:', error);
    return { success: false, error };
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

export default {
  uploadStatusMedia,
  createStatus,
  getActiveStatuses,
  recordStatusView,
  getStatusViewers,
  deleteStatus,
  cleanupExpiredStatuses
};

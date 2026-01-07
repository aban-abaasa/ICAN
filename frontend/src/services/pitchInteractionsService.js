/**
 * Pitch Interactions Service - Likes and Comments
 * This file extends pitchingService.js with database-backed interactions
 */

import { getSupabase } from './pitchingService';

// =============================================
// LIKES SERVICE
// =============================================

/**
 * Check if user has liked a pitch
 */
export const hasUserLikedPitch = async (pitchId, userId) => {
  try {
    const sb = getSupabase();
    if (!sb || !userId) return false;

    const { data, error } = await sb
      .from('pitch_likes')
      .select('id')
      .eq('pitch_id', pitchId)
      .eq('user_id', userId)
      .single();

    if (error) return false;
    return !!data;
  } catch (error) {
    console.error('Error checking like:', error);
    return false;
  }
};

/**
 * Like a pitch
 */
export const likePitchDb = async (pitchId, userId, userName) => {
  try {
    const sb = getSupabase();
    if (!sb) return { success: false, error: 'Database not configured' };

    // Insert like
    const { error: insertError } = await sb
      .from('pitch_likes')
      .insert([{
        pitch_id: pitchId,
        user_id: userId,
        user_email: userName
      }]);

    if (insertError) {
      if (insertError.code === '23505') {
        // Unique constraint violation - already liked
        return { success: false, error: 'Already liked' };
      }
      throw insertError;
    }

    // Get updated count
    const { count, error: countError } = await sb
      .from('pitch_likes')
      .select('id', { count: 'exact', head: true })
      .eq('pitch_id', pitchId);

    if (countError) throw countError;

    return { success: true, data: { likes_count: count || 0 } };
  } catch (error) {
    console.error('Error liking pitch:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Unlike a pitch
 */
export const unlikePitchDb = async (pitchId, userId) => {
  try {
    const sb = getSupabase();
    if (!sb) return { success: false, error: 'Database not configured' };

    // Delete like
    const { error } = await sb
      .from('pitch_likes')
      .delete()
      .eq('pitch_id', pitchId)
      .eq('user_id', userId);

    if (error) throw error;

    // Get updated count
    const { count, error: countError } = await sb
      .from('pitch_likes')
      .select('id', { count: 'exact', head: true })
      .eq('pitch_id', pitchId);

    if (countError) throw countError;

    return { success: true, data: { likes_count: count || 0 } };
  } catch (error) {
    console.error('Error unliking pitch:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get likes count for a pitch
 */
export const getPitchLikesCount = async (pitchId) => {
  try {
    const sb = getSupabase();
    if (!sb) return 0;

    const { count, error } = await sb
      .from('pitch_likes')
      .select('id', { count: 'exact', head: true })
      .eq('pitch_id', pitchId);

    if (error) throw error;
    return count || 0;
  } catch (error) {
    console.error('Error getting likes count:', error);
    return 0;
  }
};

// =============================================
// COMMENTS SERVICE
// =============================================

/**
 * Get comments for a pitch
 */
export const getPitchComments = async (pitchId) => {
  try {
    const sb = getSupabase();
    if (!sb) return [];

    const { data, error } = await sb
      .from('pitch_comments')
      .select('*')
      .eq('pitch_id', pitchId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching comments:', error);
    return [];
  }
};

/**
 * Add a comment to a pitch
 */
export const addPitchComment = async (pitchId, userId, userName, commentText) => {
  try {
    const sb = getSupabase();
    if (!sb) return { success: false, error: 'Database not configured' };

    const { data, error } = await sb
      .from('pitch_comments')
      .insert([{
        pitch_id: pitchId,
        user_id: userId,
        user_name: userName,
        user_email: userName, // For display purposes
        comment_text: commentText
      }])
      .select();

    if (error) throw error;

    return { success: true, data: data[0] };
  } catch (error) {
    console.error('Error adding comment:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Delete a comment
 */
export const deleteComment = async (commentId) => {
  try {
    const sb = getSupabase();
    if (!sb) return { success: false, error: 'Database not configured' };

    const { error } = await sb
      .from('pitch_comments')
      .delete()
      .eq('id', commentId);

    if (error) throw error;
    return { success: true };
  } catch (error) {
    console.error('Error deleting comment:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Update a comment
 */
export const updateComment = async (commentId, commentText) => {
  try {
    const sb = getSupabase();
    if (!sb) return { success: false, error: 'Database not configured' };

    const { data, error } = await sb
      .from('pitch_comments')
      .update({ comment_text: commentText, updated_at: new Date().toISOString() })
      .eq('id', commentId)
      .select();

    if (error) throw error;
    return { success: true, data: data[0] };
  } catch (error) {
    console.error('Error updating comment:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get comments count for a pitch
 */
export const getPitchCommentsCount = async (pitchId) => {
  try {
    const sb = getSupabase();
    if (!sb) return 0;

    const { count, error } = await sb
      .from('pitch_comments')
      .select('id', { count: 'exact', head: true })
      .eq('pitch_id', pitchId);

    if (error) throw error;
    return count || 0;
  } catch (error) {
    console.error('Error getting comments count:', error);
    return 0;
  }
};

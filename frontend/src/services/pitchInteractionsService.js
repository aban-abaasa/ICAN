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
 * Get all pitch IDs that a user has liked
 */
export const getUserLikedPitches = async (userId) => {
  try {
    const sb = getSupabase();
    if (!sb || !userId) return [];

    const { data, error } = await sb
      .from('pitch_likes')
      .select('pitch_id')
      .eq('user_id', userId);

    if (error) {
      console.warn('Error fetching user likes:', error);
      return [];
    }
    
    return data?.map(item => item.pitch_id) || [];
  } catch (error) {
    console.error('Error getting user liked pitches:', error);
    return [];
  }
};

/**
 * Get all pitch IDs that a user has shown investment interest in
 */
export const getUserInvestedPitches = async (userId) => {
  try {
    const sb = getSupabase();
    if (!sb || !userId) return [];

    const { data, error } = await sb
      .from('pitch_investments')
      .select('pitch_id')
      .eq('user_id', userId);

    if (error) {
      console.warn('Error fetching user investments:', error);
      return [];
    }
    
    return data?.map(item => item.pitch_id) || [];
  } catch (error) {
    console.error('Error getting user invested pitches:', error);
    return [];
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
      // Handle 409 Conflict (duplicate) or 23505 unique constraint violation
      if (insertError.code === '23505' || insertError.message?.includes('duplicate') || insertError.message?.includes('409')) {
        console.log('ℹ️ User already liked this pitch');
        // Get current count anyway
        const { count } = await sb
          .from('pitch_likes')
          .select('id', { count: 'exact', head: true })
          .eq('pitch_id', pitchId);
        return { success: true, data: { likes_count: count || 0 }, alreadyLiked: true };
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

// =============================================
// SHARES SERVICE
// =============================================

/**
 * Record a share action
 */
export const recordShare = async (pitchId, userId, platform = 'link') => {
  try {
    const sb = getSupabase();
    if (!sb) return { success: false, error: 'Database not configured' };

    // Insert share record
    const { error: insertError } = await sb
      .from('pitch_shares')
      .insert([{
        pitch_id: pitchId,
        user_id: userId,
        platform: platform // 'link', 'twitter', 'facebook', 'whatsapp', etc.
      }]);

    if (insertError) {
      console.warn('Share record error:', insertError);
      // Continue anyway - shares are not critical
    }

    // Get updated count
    const { count, error: countError } = await sb
      .from('pitch_shares')
      .select('id', { count: 'exact', head: true })
      .eq('pitch_id', pitchId);

    if (countError) {
      console.warn('Share count error:', countError);
      return { success: true, data: { shares_count: 1 } };
    }

    return { success: true, data: { shares_count: count || 1 } };
  } catch (error) {
    console.error('Error recording share:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get shares count for a pitch
 */
export const getPitchSharesCount = async (pitchId) => {
  try {
    const sb = getSupabase();
    if (!sb) return 0;

    const { count, error } = await sb
      .from('pitch_shares')
      .select('id', { count: 'exact', head: true })
      .eq('pitch_id', pitchId);

    if (error) return 0;
    return count || 0;
  } catch (error) {
    console.error('Error getting shares count:', error);
    return 0;
  }
};

// =============================================
// INVESTMENT INTEREST SERVICE
// =============================================

/**
 * Record investment interest
 */
export const recordInvestmentInterest = async (pitchId, userId, amount = null) => {
  try {
    const sb = getSupabase();
    if (!sb) return { success: false, error: 'Database not configured' };

    // Check if already interested
    const { data: existing } = await sb
      .from('pitch_investments')
      .select('id')
      .eq('pitch_id', pitchId)
      .eq('user_id', userId)
      .single();

    if (existing) {
      // Update existing interest
      const { error } = await sb
        .from('pitch_investments')
        .update({ 
          amount: amount,
          updated_at: new Date().toISOString()
        })
        .eq('id', existing.id);

      if (error) throw error;
    } else {
      // Insert new interest
      const { error } = await sb
        .from('pitch_investments')
        .insert([{
          pitch_id: pitchId,
          user_id: userId,
          amount: amount,
          status: 'interested'
        }]);

      if (error) throw error;
    }

    // Get updated count
    const { count, error: countError } = await sb
      .from('pitch_investments')
      .select('id', { count: 'exact', head: true })
      .eq('pitch_id', pitchId);

    if (countError) throw countError;

    return { success: true, data: { invests_count: count || 0 } };
  } catch (error) {
    console.error('Error recording investment interest:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get investment interest count for a pitch
 */
export const getPitchInvestsCount = async (pitchId) => {
  try {
    const sb = getSupabase();
    if (!sb) return 0;

    const { count, error } = await sb
      .from('pitch_investments')
      .select('id', { count: 'exact', head: true })
      .eq('pitch_id', pitchId);

    if (error) return 0;
    return count || 0;
  } catch (error) {
    console.error('Error getting invests count:', error);
    return 0;
  }
};

/**
 * Check if user has shown investment interest
 */
export const hasUserInvestedInterest = async (pitchId, userId) => {
  try {
    const sb = getSupabase();
    if (!sb || !userId) return false;

    const { data, error } = await sb
      .from('pitch_investments')
      .select('id')
      .eq('pitch_id', pitchId)
      .eq('user_id', userId)
      .single();

    if (error) return false;
    return !!data;
  } catch (error) {
    return false;
  }
};

// =============================================
// REAL-TIME SUBSCRIPTIONS
// =============================================

/**
 * Subscribe to real-time updates for a pitch's metrics
 */
export const subscribeToPitchMetrics = (pitchId, onUpdate) => {
  try {
    const sb = getSupabase();
    if (!sb) return null;

    // Subscribe to likes changes
    const likesSubscription = sb
      .channel(`pitch-likes-${pitchId}`)
      .on('postgres_changes', 
        { event: '*', schema: 'public', table: 'pitch_likes', filter: `pitch_id=eq.${pitchId}` },
        async (payload) => {
          console.log('📊 Likes update:', payload.eventType);
          const count = await getPitchLikesCount(pitchId);
          onUpdate({ type: 'likes', count });
        }
      )
      .subscribe();

    // Subscribe to comments changes
    const commentsSubscription = sb
      .channel(`pitch-comments-${pitchId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'pitch_comments', filter: `pitch_id=eq.${pitchId}` },
        async (payload) => {
          console.log('📊 Comments update:', payload.eventType);
          const count = await getPitchCommentsCount(pitchId);
          onUpdate({ type: 'comments', count, data: payload.new });
        }
      )
      .subscribe();

    // Subscribe to shares changes
    const sharesSubscription = sb
      .channel(`pitch-shares-${pitchId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'pitch_shares', filter: `pitch_id=eq.${pitchId}` },
        async (payload) => {
          console.log('📊 Shares update:', payload.eventType);
          const count = await getPitchSharesCount(pitchId);
          onUpdate({ type: 'shares', count });
        }
      )
      .subscribe();

    // Subscribe to investment interest changes
    const investsSubscription = sb
      .channel(`pitch-invests-${pitchId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'pitch_investments', filter: `pitch_id=eq.${pitchId}` },
        async (payload) => {
          console.log('📊 Invests update:', payload.eventType);
          const count = await getPitchInvestsCount(pitchId);
          onUpdate({ type: 'invests', count });
        }
      )
      .subscribe();

    // Return unsubscribe function
    return () => {
      sb.removeChannel(likesSubscription);
      sb.removeChannel(commentsSubscription);
      sb.removeChannel(sharesSubscription);
      sb.removeChannel(investsSubscription);
    };
  } catch (error) {
    console.error('Error setting up subscriptions:', error);
    return null;
  }
};

/**
 * Subscribe to all pitches metrics (for feed view)
 */
export const subscribeToAllPitchesMetrics = (onUpdate) => {
  try {
    const sb = getSupabase();
    if (!sb) return null;

    // Subscribe to all likes changes
    const likesSubscription = sb
      .channel('all-pitch-likes')
      .on('postgres_changes', 
        { event: '*', schema: 'public', table: 'pitch_likes' },
        async (payload) => {
          const pitchId = payload.new?.pitch_id || payload.old?.pitch_id;
          if (pitchId) {
            const count = await getPitchLikesCount(pitchId);
            onUpdate({ type: 'likes', pitchId, count });
          }
        }
      )
      .subscribe();

    // Subscribe to all comments changes
    const commentsSubscription = sb
      .channel('all-pitch-comments')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'pitch_comments' },
        async (payload) => {
          const pitchId = payload.new?.pitch_id || payload.old?.pitch_id;
          if (pitchId) {
            const count = await getPitchCommentsCount(pitchId);
            onUpdate({ type: 'comments', pitchId, count });
          }
        }
      )
      .subscribe();

    // Subscribe to all shares changes
    const sharesSubscription = sb
      .channel('all-pitch-shares')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'pitch_shares' },
        async (payload) => {
          const pitchId = payload.new?.pitch_id || payload.old?.pitch_id;
          if (pitchId) {
            const count = await getPitchSharesCount(pitchId);
            onUpdate({ type: 'shares', pitchId, count });
          }
        }
      )
      .subscribe();

    // Subscribe to all investment interest changes  
    const investsSubscription = sb
      .channel('all-pitch-invests')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'pitch_investments' },
        async (payload) => {
          const pitchId = payload.new?.pitch_id || payload.old?.pitch_id;
          if (pitchId) {
            const count = await getPitchInvestsCount(pitchId);
            onUpdate({ type: 'invests', pitchId, count });
          }
        }
      )
      .subscribe();

    // Return unsubscribe function
    return () => {
      sb.removeChannel(likesSubscription);
      sb.removeChannel(commentsSubscription);
      sb.removeChannel(sharesSubscription);
      sb.removeChannel(investsSubscription);
    };
  } catch (error) {
    console.error('Error setting up all pitches subscriptions:', error);
    return null;
  }
};

/**
 * Get all metrics for a pitch
 */
export const getPitchMetrics = async (pitchId) => {
  try {
    const [likesCount, commentsCount, sharesCount, investsCount] = await Promise.all([
      getPitchLikesCount(pitchId),
      getPitchCommentsCount(pitchId),
      getPitchSharesCount(pitchId),
      getPitchInvestsCount(pitchId)
    ]);

    return {
      likes_count: likesCount,
      comments_count: commentsCount,
      shares_count: sharesCount,
      invests_count: investsCount
    };
  } catch (error) {
    console.error('Error getting pitch metrics:', error);
    return {
      likes_count: 0,
      comments_count: 0,
      shares_count: 0,
      invests_count: 0
    };
  }
};

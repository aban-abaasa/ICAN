import { supabase } from '../lib/supabase/client';

/**
 * What is happening on the signed-in user's own status cards (fn_my_status_updates in supabase/migrations/20261119100000_video_product_badges.sql).
 * Resolves a Map of statusId -> { status_id, view_count, comment_count, expires_at, badges: [{ id, name, problem }] }. Never throws: if the SQL is
 * not installed or the call fails the cards simply get no hints.
 */
export const getMyStatusUpdates = async () => {
  try {
    const { data, error } = await supabase.rpc('fn_my_status_updates');
    if (error || !Array.isArray(data)) return new Map();
    return new Map(data.filter((u) => u && u.status_id).map((u) => [u.status_id, u]));
  } catch {
    return new Map();
  }
};

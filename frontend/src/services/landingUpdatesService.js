/**
 * 📰 LANDING UPDATES SERVICE
 * Public, read-only announcements feed for the ICANera landing page
 * (public.landing_updates). Content is authored via the Supabase SQL
 * editor / dashboard — there is no in-app authoring UI.
 */

import { getSupabase } from './pitchingService';

export const fetchPublishedUpdates = async (limit = 10) => {
  const sb = getSupabase();
  if (!sb) return [];

  const { data, error } = await sb
    .from('landing_updates')
    .select('id, title, body, category, created_at')
    .eq('published', true)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.error('[landingUpdatesService] failed to fetch updates:', error);
    return [];
  }
  return data || [];
};

export const subscribeToPublishedUpdates = (onInsert) => {
  const sb = getSupabase();
  if (!sb) return () => {};

  const channel = sb
    .channel('landing_updates_public')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'landing_updates', filter: 'published=eq.true' },
      (payload) => onInsert(payload.new)
    )
    .subscribe();
  return () => sb.removeChannel(channel);
};

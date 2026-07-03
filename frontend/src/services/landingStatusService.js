/**
 * 📸 LANDING STATUS SERVICE
 * Anon-safe reader for statusService.js's "Status" (WhatsApp-style 24h
 * stories, public.ican_statuses) for the landing page's public activity
 * strip. Queries the table directly rather than reusing getActiveStatuses()
 * — that helper also re-signs each status's storage URL on every read
 * (createSignedUrl), which needs its own anon storage permission and isn't
 * actually necessary here: media_url is stored at creation time with a
 * ~24h-valid URL (matching the status's own 24h expires_at), so it's safe
 * to use as-is for the story's whole active life.
 *
 * Requires a public SELECT policy on public.ican_statuses — see
 * ICAN/backend/db/allow_public_statuses_anon_select.sql. Without it this
 * silently returns [] (fails closed) rather than erroring in the UI.
 */

import { getSupabase } from './pitchingService';

export const fetchPublicStatusStories = async (limit = 10) => {
  const sb = getSupabase();
  if (!sb) return [];

  try {
    const { data, error } = await sb
      .from('ican_statuses')
      .select('id, user_id, media_type, media_url, caption, visibility, created_at, expires_at')
      .eq('visibility', 'public')
      .in('media_type', ['image', 'video'])
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.warn('[landingStatusService] failed to fetch public stories (likely missing RLS SELECT policy on ican_statuses):', error);
      return [];
    }
    return data || [];
  } catch (err) {
    console.warn('[landingStatusService] failed to fetch public stories:', err);
    return [];
  }
};

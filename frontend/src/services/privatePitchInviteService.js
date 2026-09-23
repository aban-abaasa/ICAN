/**
 * Private, PIN-locked, time-limited pitch invites (backend/PITCHIN_PRIVATE_INVESTOR_INVITES.sql).
 *
 * Thin wrappers around the SECURITY DEFINER RPCs -- the PIN is hashed/
 * checked entirely server-side, this file never sees pin_hash. Investing
 * still goes through the real, existing engine: once an invite is unlocked
 * and materialized, callers use pitchingService.getPitchById and
 * pitchinValuationService.getLiveShareOffer exactly as the public flow does,
 * not anything defined here.
 */
import { supabase } from '../lib/supabase/client';

const PUBLIC_SITE_ORIGIN = 'https://icanera.space';

/** The one shareable URL for a private invite -- deliberately under /invite/,
 * not /pitchin/, so it never reads as just another public pitch link. */
export const buildPrivatePitchInviteLink = (token) => `${PUBLIC_SITE_ORIGIN}/invite/${token}`;

/**
 * Creates a private invite for one investor. Returns { success, data: { id, token }, error }.
 * `expiresAt` must be a Date or ISO string in the future. `pin` is 4-8 digits,
 * plaintext here only for this one call -- the RPC hashes it immediately and
 * never returns or stores it in the clear.
 */
export const createPrivatePitchInvite = async ({
  businessProfileId,
  pin,
  expiresAt,
  investorName = null,
  investorContact = null,
  customMessage = null,
  title = null,
  description = null,
  videoUrl = null,
  thumbnailUrl = null,
  pitchType = null,
  category = null,
  deckUrl = null,
  deckPath = null,
}) => {
  try {
    const { data, error } = await supabase.rpc('fn_create_private_pitch_invite', {
      p_business_profile_id: businessProfileId,
      p_pin: pin,
      p_expires_at: expiresAt instanceof Date ? expiresAt.toISOString() : expiresAt,
      p_investor_name: investorName,
      p_investor_contact: investorContact,
      p_custom_message: customMessage,
      p_title: title,
      p_description: description,
      p_video_url: videoUrl,
      p_thumbnail_url: thumbnailUrl,
      p_pitch_type: pitchType,
      p_category: category,
      p_deck_url: deckUrl,
      p_deck_path: deckPath,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error('No invite was returned');
    return { success: true, data: { id: row.id, token: row.token, link: buildPrivatePitchInviteLink(row.token) } };
  } catch (error) {
    console.error('Error creating private pitch invite:', error);
    return { success: false, error: error.message };
  }
};

/** Owner-facing list for the Manage view -- allowed by the owner/co-owner RLS
 * SELECT policy, no RPC needed. Newest first. */
export const listPrivatePitchInvites = async (businessProfileId) => {
  try {
    const { data, error } = await supabase
      .from('pitch_private_invites')
      .select('id, investor_name, investor_contact, title, expires_at, revoked_at, locked_at, viewed_count, first_viewed_at, created_at, materialized_pitch_id')
      .eq('business_profile_id', businessProfileId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return { success: true, data: data || [] };
  } catch (error) {
    console.error('Error listing private pitch invites:', error);
    return { success: false, error: error.message, data: [] };
  }
};

/** Manual kill switch -- allowed by the same owner/co-owner RLS UPDATE policy. */
export const revokePrivatePitchInvite = async (inviteId) => {
  try {
    const { error } = await supabase
      .from('pitch_private_invites')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', inviteId);
    if (error) throw error;
    return { success: true };
  } catch (error) {
    console.error('Error revoking private pitch invite:', error);
    return { success: false, error: error.message };
  }
};

/** Zero-PIN-attempt status probe, so a dead link can explain itself (expired/
 * revoked/locked) without spending one of the visitor's PIN attempts. */
export const checkPrivatePitchInviteStatus = async (token) => {
  try {
    const { data, error } = await supabase.rpc('fn_check_private_pitch_invite_status', { p_token: token });
    if (error) throw error;
    return { success: true, ...data };
  } catch (error) {
    console.error('Error checking private pitch invite status:', error);
    return { success: false, status: 'error' };
  }
};

/** Verifies the PIN and, on success, returns the real content. On failure,
 * returns { success:false, reason, attemptsLeft? } -- reason is one of
 * 'not_found' | 'revoked' | 'expired' | 'locked' | 'wrong_pin'. */
export const openPrivatePitchInvite = async (token, pin) => {
  try {
    const { data, error } = await supabase.rpc('fn_open_private_pitch_invite', { p_token: token, p_pin: pin });
    if (error) throw error;
    if (!data?.success) {
      return { success: false, reason: data?.reason || 'unknown', attemptsLeft: data?.attempts_left };
    }
    return {
      success: true,
      inviteId: data.invite_id,
      businessProfileId: data.business_profile_id,
      investorName: data.investor_name,
      customMessage: data.custom_message,
      title: data.title,
      description: data.description,
      videoUrl: data.video_url,
      thumbnailUrl: data.thumbnail_url,
      pitchType: data.pitch_type,
      category: data.category,
      deckUrl: data.deck_url,
      expiresAt: data.expires_at,
    };
  } catch (error) {
    console.error('Error opening private pitch invite:', error);
    return { success: false, reason: 'error' };
  }
};

/** Lazily creates (idempotently) the minimal backing `pitches` row this
 * specific invite needs to invest through the real ShareSigningFlow engine
 * (investment_agreements.pitch_id is NOT NULL). Returns the pitch id -- the
 * caller should then fetch it with pitchingService.getPitchById exactly like
 * the public flow does, not build a pitch object by hand. */
export const materializePrivatePitchForInvestment = async (inviteId) => {
  try {
    const { data, error } = await supabase.rpc('fn_materialize_private_pitch_for_investment', { p_invite_id: inviteId });
    if (error) throw error;
    return { success: true, pitchId: data };
  } catch (error) {
    console.error('Error materializing private pitch for investment:', error);
    return { success: false, error: error.message };
  }
};

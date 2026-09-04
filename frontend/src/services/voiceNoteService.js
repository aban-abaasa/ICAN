/**
 * Voice-note audio storage (Supabase Storage, bucket 'voice-notes',
 * folder-per-owner) plus the daily keep/delete retention prompt.
 *
 * Older messages may still carry an `r2://` marker from before this
 * feature moved off Cloudflare R2 — VoiceNotePlayer.jsx resolves those
 * separately via r2StorageService. Everything uploaded from here on uses
 * the `supabase-voice://<path>` marker instead.
 *
 * See ICAN/backend/db/migrations/add_voice_note_retention.sql for the
 * bucket, storage policies, and voice_note_retention table this relies on.
 */

import { supabase } from '../lib/supabase';
import { deleteMessage as deleteChatMessage } from './chatService';
import { deleteGroupMessage } from './trustService';
import { deleteLandingMessage } from './landingMessagesService';
import cmmsMessagingService from './cmmsMessagingService';

const BUCKET = 'voice-notes';
const SUPABASE_VOICE_PREFIX = 'supabase-voice://';

// How to delete the chat message(s) a voice note was sent as, once the note
// itself is deleted — keyed by the message_table value stored in
// voice_note_messages (see linkVoiceNoteMessages).
const MESSAGE_DELETERS = {
  chat_messages: (id) => deleteChatMessage(id),
  group_messages: (id) => deleteGroupMessage(id),
  landing_messages: (id) => deleteLandingMessage(id),
  cmms_report_messages: (id) => cmmsMessagingService.deleteMessage(id),
};

export const isSupabaseVoiceKey = (value) => typeof value === 'string' && value.startsWith(SUPABASE_VOICE_PREFIX);
export const toSupabaseVoiceValue = (path) => `${SUPABASE_VOICE_PREFIX}${path}`;
export const fromSupabaseVoiceValue = (value) => value.slice(SUPABASE_VOICE_PREFIX.length);

const todayStr = () => new Date().toISOString().slice(0, 10); // YYYY-MM-DD, local calendar day is good enough here

/**
 * @param {Blob} blob - recorded audio (audio/webm)
 * @returns {Promise<{success: boolean, url?: string, error?: string}>}
 */
export const uploadVoiceNote = async (blob) => {
  try {
    if (!blob) {
      return { success: false, error: 'No recording to upload' };
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      return { success: false, error: 'Not authenticated - cannot upload voice note' };
    }

    const ownerId = session.user.id;
    const path = `${ownerId}/voice-note-${Date.now()}.webm`;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, blob, {
        cacheControl: '3600',
        upsert: false,
        contentType: blob.type || 'audio/webm',
      });
    if (uploadError) {
      return { success: false, error: uploadError.message || 'Failed to upload voice note' };
    }

    // Retention tracking is best-effort: a failure here shouldn't block
    // sending the note, it just means this note won't get a daily prompt
    // (and won't have its chat message cleaned up on delete).
    const { data: retentionRow, error: retentionError } = await supabase
      .from('voice_note_retention')
      .insert({ storage_path: path, owner_id: ownerId })
      .select('id')
      .single();
    if (retentionError) {
      console.warn('Voice note retention row not created:', retentionError.message);
    }

    return { success: true, url: toSupabaseVoiceValue(path), retentionId: retentionRow?.id || null };
  } catch (error) {
    console.error('Voice note upload error:', error);
    return { success: false, error: error.message || 'Unexpected upload error' };
  }
};

/**
 * Resolve a `supabase-voice://<path>` marker to a playable signed URL.
 * Returns null (rather than throwing) when the note is gone or the
 * caller isn't allowed to read it, so players can show a "removed" state.
 */
export const resolveVoiceNoteUrl = async (value) => {
  if (!isSupabaseVoiceKey(value)) return value;
  const path = fromSupabaseVoiceValue(value);
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (error) {
    console.warn('Could not sign voice note URL:', error.message);
    return null;
  }
  return data?.signedUrl || null;
};

/**
 * Look up this owner's pending voice notes and settle the ones whose
 * daily prompt already went unanswered (deletes the audio + marks the
 * row 'deleted'). Returns the notes that are due for *today's* prompt —
 * the caller is responsible for actually showing it and then calling
 * keepVoiceNote/deleteVoiceNoteNow with the owner's choice.
 * @param {string} ownerId
 * @returns {Promise<Array<{id: string, storage_path: string, created_at: string}>>}
 */
export const sweepVoiceNoteRetention = async (ownerId) => {
  if (!ownerId) return [];
  const today = todayStr();

  const { data: rows, error } = await supabase
    .from('voice_note_retention')
    .select('id, storage_path, created_at, last_prompted_date, last_answered_date')
    .eq('owner_id', ownerId)
    .eq('status', 'pending');
  if (error || !rows) {
    if (error) console.warn('Voice note retention sweep failed:', error.message);
    return [];
  }

  const toPrompt = [];
  for (const row of rows) {
    const createdDate = row.created_at.slice(0, 10);
    if (createdDate >= today) continue; // don't prompt same-day as recording

    if (row.last_prompted_date === today) {
      // Already surfaced today — still waiting on an answer this session.
      toPrompt.push(row);
      continue;
    }

    if (row.last_prompted_date && row.last_prompted_date < today) {
      const answeredThatDay = row.last_answered_date === row.last_prompted_date;
      if (answeredThatDay) {
        toPrompt.push(row); // kept last time it was asked — ask again today
      } else {
        await deleteVoiceNoteNow(row.id, row.storage_path); // shown, never answered -> auto-delete
      }
      continue;
    }

    toPrompt.push(row); // never prompted before
  }

  if (toPrompt.length > 0) {
    await supabase
      .from('voice_note_retention')
      .update({ last_prompted_date: today })
      .in('id', toPrompt.map((row) => row.id));
  }

  return toPrompt;
};

/** Owner chose "keep" for today's prompt — asked again the next day. */
export const keepVoiceNote = async (id) => {
  const { error } = await supabase
    .from('voice_note_retention')
    .update({ last_answered_date: todayStr() })
    .eq('id', id);
  if (error) return { success: false, error: error.message };
  return { success: true };
};

/**
 * Record which chat message(s) a voice note was delivered as, so deleting
 * the note also removes them. One retention row can map to several
 * messages — e.g. a CMMS voice note sent to "everyone" fans out into one
 * row per recipient.
 * @param {string} retentionId
 * @param {Array<{table: 'chat_messages'|'group_messages'|'landing_messages'|'cmms_report_messages', id: string}>} links
 */
export const linkVoiceNoteMessages = async (retentionId, links) => {
  if (!retentionId || !links?.length) return;
  const rows = links
    .filter((link) => link?.id != null)
    .map((link) => ({ retention_id: retentionId, message_table: link.table, message_id: String(link.id) }));
  if (rows.length === 0) return;
  const { error } = await supabase.from('voice_note_messages').insert(rows);
  if (error) console.warn('Voice note message links not recorded:', error.message);
};

/**
 * Owner chose "delete", or the daily prompt went unanswered: remove the
 * audio, delete every chat message it was sent as, and mark the row.
 */
export const deleteVoiceNoteNow = async (id, storagePath) => {
  const { error: storageError } = await supabase.storage.from(BUCKET).remove([storagePath]);
  if (storageError) console.warn('Voice note storage delete failed:', storageError.message);

  const { data: links } = await supabase
    .from('voice_note_messages')
    .select('message_table, message_id')
    .eq('retention_id', id);

  for (const link of links || []) {
    const deleter = MESSAGE_DELETERS[link.message_table];
    if (!deleter) continue;
    try {
      await deleter(link.message_id);
    } catch (err) {
      // Best-effort: if the table's RLS doesn't yet allow the author to
      // delete their own row, the audio is still gone and the player
      // falls back to a "removed" placeholder instead of playing it.
      console.warn(`Could not delete linked ${link.message_table} message ${link.message_id}:`, err.message);
    }
  }

  const { error } = await supabase
    .from('voice_note_retention')
    .update({ status: 'deleted', decided_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return { success: false, error: error.message };
  return { success: true };
};

export default {
  isSupabaseVoiceKey,
  toSupabaseVoiceValue,
  fromSupabaseVoiceValue,
  uploadVoiceNote,
  resolveVoiceNoteUrl,
  sweepVoiceNoteRetention,
  keepVoiceNote,
  linkVoiceNoteMessages,
  deleteVoiceNoteNow,
};

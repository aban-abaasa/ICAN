/**
 * Notebook store — personal notes and meeting minutes.
 *
 * Local first: notes are saved per signed-in user in localStorage and exposed as an external
 * store, so the screen follows the data instead of owning it. That matters for voice: dictation
 * keeps writing into a note through `appendToNote` even while the Notebook screen is not on show.
 *
 * Cloud: changes are synced to `user_notebook_notes` (NOTEBOOK_NOTES_PASTE_INTO_SUPABASE.sql) a
 * moment after they stop, and on opening the Notebook, so notes follow the person across devices.
 * If the person is offline or the table is not installed yet, notes simply stay on the device.
 */
import { supabase } from '../lib/supabase/client';
import { appendDictation } from '../utils/dictationText.js';
import { mergeNotes, withUuidIds, newNoteId, toRow, fromRow } from '../utils/notebookMerge.js';

const PREFIX = 'ican_notebook_v1:';
const TABLE = 'user_notebook_notes';
const PUSH_DELAY_MS = 2500;

const listeners = new Set();
const all = new Map(); // userId -> every note, including deletions waiting to reach the server
const visible = new Map(); // userId -> notes to show (same array reference until they change)
const timers = new Map();
const syncState = new Map(); // userId -> { running, again }
let status = { syncing: false, error: '', lastSyncedAt: null };

const idFor = (userId) => userId || 'guest';
const keyFor = (userId) => `${PREFIX}${idFor(userId)}`;

function readStored(userId) {
  try {
    const parsed = JSON.parse(localStorage.getItem(keyFor(userId)) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function load(userId) {
  const id = idFor(userId);
  if (!all.has(id)) {
    const stored = readStored(userId);
    const fixed = withUuidIds(stored);
    all.set(id, fixed);
    visible.set(id, fixed.filter((n) => !n.deletedAt));
    if (fixed !== stored) persist(userId, fixed);
  }
}

function persist(userId, list) {
  try {
    localStorage.setItem(keyFor(userId), JSON.stringify(list));
  } catch {
    /* storage full or blocked: the notes stay in memory for this session */
  }
}

function setAll(userId, list, { push = true } = {}) {
  const id = idFor(userId);
  all.set(id, list);
  visible.set(id, list.filter((n) => !n.deletedAt));
  persist(userId, list);
  listeners.forEach((fn) => fn());
  if (push) schedulePush(userId);
}

export function getNotes(userId) {
  load(userId);
  return visible.get(idFor(userId));
}

export function subscribeNotes(fn) {
  listeners.add(fn);
  const onStorage = (e) => {
    if (e.key && e.key.startsWith(PREFIX)) { all.clear(); visible.clear(); fn(); }
  };
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(fn); window.removeEventListener('storage', onStorage); };
}

const MINUTES_TEMPLATE = 'Attendees:\n\nAgenda:\n\nDiscussion:\n\nDecisions:\n\nActions:\n';

export function createNote(userId, { kind = 'note', title } = {}) {
  load(userId);
  const now = new Date();
  const note = {
    id: newNoteId(),
    kind,
    title: title || (kind === 'minutes' ? `Minutes ${now.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}` : 'Untitled note'),
    body: kind === 'minutes' ? MINUTES_TEMPLATE : '',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  setAll(userId, [note, ...all.get(idFor(userId))]);
  return note;
}

export function updateNote(userId, noteId, patch) {
  load(userId);
  const now = new Date().toISOString();
  setAll(userId, all.get(idFor(userId)).map((n) => (n.id === noteId ? { ...n, ...patch, updatedAt: now } : n)));
}

/** Marks the note deleted; the server keeps the marker so other devices drop it too. */
export function deleteNote(userId, noteId) {
  load(userId);
  const now = new Date().toISOString();
  setAll(userId, all.get(idFor(userId)).map((n) => (n.id === noteId ? { ...n, body: '', deletedAt: now, updatedAt: now } : n)));
}

/** Adds a heard phrase to the end of a note. Safe to call when the note screen is closed. */
export function appendToNote(userId, noteId, heard) {
  const note = getNotes(userId).find((n) => n.id === noteId);
  if (!note) return;
  updateNote(userId, noteId, { body: appendDictation(note.body, heard) });
}

// ─── Cloud sync ─────────────────────────────────────────────────────────────

function schedulePush(userId) {
  if (!userId) return; // guests have no account to sync to
  clearTimeout(timers.get(userId));
  timers.set(userId, setTimeout(() => syncNotebook(userId), PUSH_DELAY_MS));
}

function setStatus(patch) {
  status = { ...status, ...patch };
  listeners.forEach((fn) => fn());
}

export const getSyncStatus = () => status;

/** Pulls the server's notes, keeps the newer copy of each, and pushes anything newer from this device. */
export async function syncNotebook(userId) {
  if (!userId) return;
  const state = syncState.get(userId) || { running: false, again: false };
  syncState.set(userId, state);
  if (state.running) { state.again = true; return; }
  state.running = true;
  setStatus({ syncing: true });
  try {
    load(userId);
    const { data, error } = await supabase.from(TABLE).select('*').eq('user_id', userId);
    if (error) throw error;

    const { merged, toPush } = mergeNotes(all.get(idFor(userId)), (data || []).map(fromRow));
    if (toPush.length) {
      const { error: pushError } = await supabase.from(TABLE).upsert(toPush.map((n) => toRow(userId, n)), { onConflict: 'id' });
      if (pushError) throw pushError;
    }
    // Edits made while the request was in flight are newer than what was pushed: keep them and push again.
    const { merged: settled, toPush: edited } = mergeNotes(all.get(idFor(userId)), merged);
    setAll(userId, settled, { push: false });
    if (edited.length) state.again = true;
    setStatus({ error: '', lastSyncedAt: new Date().toISOString() });
  } catch (err) {
    const missing = err?.code === '42P01' || err?.code === 'PGRST205';
    setStatus({ error: missing ? 'Cloud backup is not set up yet. Notes are saved on this device.' : 'Could not back up notes right now. They are saved on this device.' });
  } finally {
    state.running = false;
    setStatus({ syncing: false });
    if (state.again) { state.again = false; schedulePush(userId); }
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    for (const userId of all.keys()) if (userId !== 'guest') schedulePush(userId);
  });
}

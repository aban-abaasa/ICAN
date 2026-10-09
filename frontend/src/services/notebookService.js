/**
 * Notebook store — personal notes and meeting minutes, kept on this device.
 *
 * Notes are saved per signed-in user in localStorage and exposed as an external store, so the
 * screen follows the data instead of owning it. That matters for voice: dictation keeps writing
 * into a note through `appendToNote` even while the Notebook screen is not on show.
 */
import { appendDictation } from '../utils/dictationText.js';

const PREFIX = 'ican_notebook_v1:';
const listeners = new Set();
const cache = new Map(); // userId -> notes[] (same array reference until the notes change)

const keyFor = (userId) => `${PREFIX}${userId || 'guest'}`;

function read(userId) {
  try {
    const parsed = JSON.parse(localStorage.getItem(keyFor(userId)) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(userId, notes) {
  cache.set(userId || 'guest', notes);
  try {
    localStorage.setItem(keyFor(userId), JSON.stringify(notes));
  } catch {
    /* storage full or blocked: the notes stay in memory for this session */
  }
  listeners.forEach((fn) => fn());
}

export function getNotes(userId) {
  const id = userId || 'guest';
  if (!cache.has(id)) cache.set(id, read(userId));
  return cache.get(id);
}

export function subscribeNotes(fn) {
  listeners.add(fn);
  const onStorage = (e) => {
    if (e.key && e.key.startsWith(PREFIX)) { cache.clear(); fn(); }
  };
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(fn); window.removeEventListener('storage', onStorage); };
}

const newId = () => `n_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

const MINUTES_TEMPLATE = 'Attendees:\n\nAgenda:\n\nDiscussion:\n\nDecisions:\n\nActions:\n';

export function createNote(userId, { kind = 'note', title } = {}) {
  const now = new Date();
  const note = {
    id: newId(),
    kind,
    title: title || (kind === 'minutes' ? `Minutes ${now.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}` : 'Untitled note'),
    body: kind === 'minutes' ? MINUTES_TEMPLATE : '',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  write(userId, [note, ...getNotes(userId)]);
  return note;
}

export function updateNote(userId, noteId, patch) {
  write(userId, getNotes(userId).map((n) => (n.id === noteId ? { ...n, ...patch, updatedAt: new Date().toISOString() } : n)));
}

export function deleteNote(userId, noteId) {
  write(userId, getNotes(userId).filter((n) => n.id !== noteId));
}

/** Adds a heard phrase to the end of a note. Safe to call when the note screen is closed. */
export function appendToNote(userId, noteId, heard) {
  const note = getNotes(userId).find((n) => n.id === noteId);
  if (!note) return;
  updateNote(userId, noteId, { body: appendDictation(note.body, heard) });
}

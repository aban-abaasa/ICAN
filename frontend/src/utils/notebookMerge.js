// Two-device merge for notebook notes. Pure, so it can be tested without a database.
//
// A note is { id, kind, title, body, createdAt, updatedAt, deletedAt? }. The copy with the later
// updatedAt wins; a deletion is a copy with deletedAt set, so it wins over older edits too.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (id) => UUID.test(String(id || ''));

const time = (iso) => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
};

export function newNoteId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  const hex = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;
}

/** Notes made before sync existed have short ids; the database needs UUIDs. */
export function withUuidIds(notes) {
  let changed = false;
  const fixed = notes.map((n) => {
    if (isUuid(n.id)) return n;
    changed = true;
    return { ...n, id: newNoteId() };
  });
  return changed ? fixed : notes;
}

/**
 * @returns {{ merged: Note[], toPush: Note[] }} merged is what the device should now hold;
 *          toPush is every note whose merged copy is newer than (or missing from) the server.
 */
export function mergeNotes(local, remote) {
  const remoteById = new Map(remote.map((n) => [n.id, n]));
  const merged = new Map();
  const toPush = [];

  remote.forEach((r) => merged.set(r.id, r));
  local.forEach((l) => {
    const r = remoteById.get(l.id);
    if (!r || time(l.updatedAt) > time(r.updatedAt)) {
      merged.set(l.id, l);
      toPush.push(l);
    }
  });

  // A deleted note with nothing live behind it is only worth keeping until the server has it.
  const pushedIds = new Set(toPush.map((n) => n.id));
  const list = [...merged.values()].filter((n) => !(n.deletedAt && !pushedIds.has(n.id) && !local.some((l) => l.id === n.id)));
  list.sort((a, b) => time(b.updatedAt) - time(a.updatedAt));
  return { merged: list, toPush };
}

export const toRow = (userId, n) => ({
  id: n.id,
  user_id: userId,
  kind: n.kind || 'note',
  title: n.title || '',
  body: n.deletedAt ? '' : n.body || '',
  created_at: n.createdAt,
  updated_at: n.updatedAt,
  deleted_at: n.deletedAt || null,
});

export const fromRow = (r) => ({
  id: r.id,
  kind: r.kind,
  title: r.title,
  body: r.body,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  deletedAt: r.deleted_at || null,
});

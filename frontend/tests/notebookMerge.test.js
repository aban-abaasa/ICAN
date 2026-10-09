import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeNotes, withUuidIds, isUuid, toRow, fromRow } from '../src/utils/notebookMerge.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const note = (id, updatedAt, extra = {}) => ({ id, kind: 'note', title: id.slice(0, 1), body: updatedAt, createdAt: '2026-01-01T00:00:00Z', updatedAt, ...extra });

test('a note only on this device is pushed; one only on the server is kept', () => {
  const { merged, toPush } = mergeNotes([note(A, '2026-01-02T00:00:00Z')], [note(B, '2026-01-03T00:00:00Z')]);
  assert.deepEqual(merged.map((n) => n.id), [B, A]);
  assert.deepEqual(toPush.map((n) => n.id), [A]);
});

test('the later edit wins, in both directions', () => {
  const newerLocal = mergeNotes([note(A, '2026-02-01T00:00:00Z')], [note(A, '2026-01-01T00:00:00Z')]);
  assert.equal(newerLocal.merged[0].updatedAt, '2026-02-01T00:00:00Z');
  assert.equal(newerLocal.toPush.length, 1);

  const newerRemote = mergeNotes([note(A, '2026-01-01T00:00:00Z')], [note(A, '2026-02-01T00:00:00Z')]);
  assert.equal(newerRemote.merged[0].updatedAt, '2026-02-01T00:00:00Z');
  assert.equal(newerRemote.toPush.length, 0);
});

test('a deletion on the server removes the older local copy from view and is not pushed back', () => {
  const { merged, toPush } = mergeNotes([note(A, '2026-01-01T00:00:00Z')], [note(A, '2026-02-01T00:00:00Z', { deletedAt: '2026-02-01T00:00:00Z' })]);
  assert.equal(merged[0].deletedAt, '2026-02-01T00:00:00Z');
  assert.equal(toPush.length, 0);
});

test('a local deletion is pushed so other devices learn of it', () => {
  const { toPush } = mergeNotes([note(A, '2026-03-01T00:00:00Z', { deletedAt: '2026-03-01T00:00:00Z' })], [note(A, '2026-01-01T00:00:00Z')]);
  assert.equal(toPush.length, 1);
  assert.ok(toPush[0].deletedAt);
});

test('a server-side deletion for a note this device never had is dropped', () => {
  const { merged } = mergeNotes([], [note(A, '2026-02-01T00:00:00Z', { deletedAt: '2026-02-01T00:00:00Z' })]);
  assert.deepEqual(merged, []);
});

test('old short ids are replaced with UUIDs; UUIDs are untouched', () => {
  const fixed = withUuidIds([note('n_abc123', '2026-01-01T00:00:00Z'), note(A, '2026-01-01T00:00:00Z')]);
  assert.ok(isUuid(fixed[0].id));
  assert.equal(fixed[1].id, A);
  const same = [note(A, '2026-01-01T00:00:00Z')];
  assert.equal(withUuidIds(same), same);
});

test('row conversion round-trips and blanks the body of a deleted note', () => {
  const n = note(A, '2026-01-02T00:00:00Z');
  assert.deepEqual(fromRow(toRow('user-1', n)), { ...n, deletedAt: null });
  assert.equal(toRow('user-1', { ...n, deletedAt: '2026-01-03T00:00:00Z' }).body, '');
});

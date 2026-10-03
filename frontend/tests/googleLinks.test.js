import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyDriveDoc, extractGoogleLink } from '../src/utils/googleLinks.js';

test('extractGoogleLink picks the link out of surrounding words', () => {
  const c = extractGoogleLink('Here is my tax clearance 👉 https://drive.google.com/file/d/1AbCdEfGhIjK/view?usp=sharing. Thanks!');
  assert.equal(c.ok, true);
  assert.equal(c.kind, 'drive_file');
  assert.equal(c.url, 'https://drive.google.com/file/d/1AbCdEfGhIjK/view');
});

test('extractGoogleLink accepts a link pasted without https', () => {
  const c = extractGoogleLink('docs.google.com/document/d/1AbCdEfGhIjK/edit');
  assert.equal(c.ok, true);
  assert.equal(c.kind, 'doc');
});

test('extractGoogleLink skips an unsupported link and finds the next usable one', () => {
  const c = extractGoogleLink('https://docs.google.com/unknown/x then https://forms.gle/AbCdEf123');
  assert.equal(c.ok, true);
  assert.equal(c.kind, 'form');
});

test('extractGoogleLink rejects look-alike hosts', () => {
  for (const text of [
    'https://drive.google.com.evil.example/file/d/1AbCdEfGhIjK/view',
    'https://evildrive.google.com/file/d/1AbCdEfGhIjK/view',
    'https://example.com/?u=notdrive.google.comx/file/d/1AbCdEfGhIjK/view',
    'no link here at all',
    '',
  ]) {
    assert.equal(extractGoogleLink(text).ok, false, text);
  }
});

test('extractGoogleLink refuses plain http', () => {
  assert.equal(extractGoogleLink('http://drive.google.com/file/d/1AbCdEfGhIjK/view').ok, false);
});

test('classifyDriveDoc rebuilds the address from the id and type', () => {
  const folder = classifyDriveDoc({ id: '1AbCdEfGhIjK', mimeType: 'application/vnd.google-apps.folder', url: 'https://evil.example/' });
  assert.equal(folder.url, 'https://drive.google.com/drive/folders/1AbCdEfGhIjK');
  assert.equal(folder.kind, 'drive_folder');

  assert.equal(classifyDriveDoc({ id: '1AbCdEfGhIjK', mimeType: 'application/vnd.google-apps.document' }).kind, 'doc');
  assert.equal(classifyDriveDoc({ id: '1AbCdEfGhIjK', mimeType: 'application/vnd.google-apps.spreadsheet' }).kind, 'sheet');
  assert.equal(classifyDriveDoc({ id: '1AbCdEfGhIjK', mimeType: 'application/vnd.google-apps.presentation' }).kind, 'slides');
  assert.equal(classifyDriveDoc({ id: '1AbCdEfGhIjK', mimeType: 'application/vnd.google-apps.form' }).kind, 'form');
  const pdf = classifyDriveDoc({ id: '1AbCdEfGhIjK', mimeType: 'application/pdf' });
  assert.equal(pdf.url, 'https://drive.google.com/file/d/1AbCdEfGhIjK/view');
});

test('classifyDriveDoc rejects ids that could change the address', () => {
  for (const id of ['', 'a/b/c/d/e/f', '../../x', 'abc', 'x?y=1&z=2zzzz', undefined]) {
    assert.equal(classifyDriveDoc({ id, mimeType: 'application/pdf' }).ok, false, String(id));
  }
});

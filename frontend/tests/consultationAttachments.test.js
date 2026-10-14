import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ATTACHMENT_LABELS, attachmentKind, attachmentLine, attachmentsSummary, cleanAttachments, formatFileSize,
  formatReferenceCode, parseRecordCode, recordAttachments, recordMatchesCode, recordQrPayload, recordReferenceCode,
  validateAttachmentFile
} from '../src/utils/consultationAttachments.js';

const ID = '6f1c2d3e-0a4b-4c5d-8e9f-1a2b3c4d5e6f';

describe('attachment kinds and validation', () => {
  it('tells photos, PDFs and other files apart by type, then by extension', () => {
    assert.equal(attachmentKind({ type: 'image/png', name: 'a' }), 'image');
    assert.equal(attachmentKind({ type: '', name: 'scan.JPG' }), 'image');
    assert.equal(attachmentKind({ type: 'application/pdf', name: 'x' }), 'pdf');
    assert.equal(attachmentKind({ name: 'result.pdf' }), 'pdf');
    assert.equal(attachmentKind({ type: 'application/zip', name: 'a.zip' }), 'file');
    assert.equal(attachmentKind(null), 'file');
  });

  it('accepts photos and PDFs under 10 MB and explains anything else', () => {
    assert.equal(validateAttachmentFile({ type: 'image/jpeg', size: 1024 }), '');
    assert.equal(validateAttachmentFile({ type: 'application/pdf', size: 9 * 1024 * 1024 }), '');
    assert.match(validateAttachmentFile({ type: 'image/jpeg', size: 11 * 1024 * 1024 }), /under 10 MB/);
    assert.match(validateAttachmentFile({ type: 'text/html', size: 10 }), /JPG, PNG, WEBP or GIF/);
    assert.match(validateAttachmentFile({ type: 'application/x-msdownload', size: 10 }), /JPG, PNG/);
    assert.match(validateAttachmentFile(null), /No file/);
  });

  it('formats sizes for humans', () => {
    assert.equal(formatFileSize(0), '');
    assert.equal(formatFileSize(512), '512 B');
    assert.equal(formatFileSize(2048), '2 KB');
    assert.equal(formatFileSize(1.5 * 1024 * 1024), '1.5 MB');
    assert.equal(formatFileSize('nope'), '');
  });
});

describe('saved attachment shape', () => {
  it('keeps only the stored fields and drops UI state', () => {
    const cleaned = cleanAttachments([
      { id: 'att_1', key: 'cmms-consultation-guest/u/1-ab-x.jpg', name: 'x.jpg', type: 'image/jpeg', size: 2048, label: ' X-ray / scan ', caption: '  left knee ', previewUrl: 'blob:1', status: 'done' },
      { id: 'att_2', name: 'no key yet', status: 'uploading' },
      null
    ]);
    assert.deepEqual(cleaned, [{ key: 'cmms-consultation-guest/u/1-ab-x.jpg', name: 'x.jpg', type: 'image/jpeg', size: 2048, label: 'X-ray / scan', caption: 'left knee' }]);
  });

  it('omits empty labels, captions and bad sizes', () => {
    assert.deepEqual(cleanAttachments([{ key: 'k', label: '  ', caption: '', size: -4 }]), [{ key: 'k', name: 'file', type: '' }]);
  });

  it('tolerates records with no attachments at all', () => {
    assert.deepEqual(recordAttachments({}), []);
    assert.deepEqual(recordAttachments({ attachments: null }), []);
    assert.equal(recordAttachments({ attachments: [{ key: 'a' }, { key: 'b' }] }).length, 2);
  });

  it('summarises photos and documents', () => {
    assert.equal(attachmentsSummary([]), '');
    assert.equal(attachmentsSummary([{ type: 'image/png' }]), '1 photo');
    assert.equal(attachmentsSummary([{ type: 'image/png' }, { type: 'image/jpeg' }, { type: 'application/pdf' }]), '2 photos, 1 document');
  });

  it('describes an attachment in one line for places that cannot show it', () => {
    assert.equal(attachmentLine({ label: 'Lab result', name: 'cbc.pdf', size: 2048, caption: 'Monday' }), 'Lab result - (cbc.pdf, 2 KB) - Monday');
    assert.equal(attachmentLine({ name: 'a.png' }), '(a.png)');
  });

  it('ships a default tag list for the owner to start from', () => {
    assert.ok(ATTACHMENT_LABELS.includes('X-ray / scan'));
    assert.ok(ATTACHMENT_LABELS.includes('Other'));
  });
});

describe('record reference code', () => {
  it('is the first 8 hex characters of the id, upper-cased', () => {
    assert.equal(recordReferenceCode(ID), '6F1C2D3E');
    assert.equal(formatReferenceCode('6F1C2D3E'), '6F1C 2D3E');
  });

  it('is empty for a record that has no real id yet (offline placeholder)', () => {
    assert.equal(recordReferenceCode('pending_1759600000000'), '');
    assert.equal(recordReferenceCode(undefined), '');
    assert.equal(recordQrPayload('pending_1759600000000'), '');
  });

  it('round-trips through the QR payload', () => {
    const payload = recordQrPayload(ID);
    assert.equal(payload, 'ICANERA-REC:6F1C2D3E');
    assert.equal(parseRecordCode(payload), '6F1C2D3E');
  });

  it('accepts a typed or pasted code in any common spelling', () => {
    assert.equal(parseRecordCode('6f1c2d3e'), '6F1C2D3E');
    assert.equal(parseRecordCode(' 6F1C 2D3E '), '6F1C2D3E');
    assert.equal(parseRecordCode('6F1C-2D3E'), '6F1C2D3E');
    assert.equal(parseRecordCode('icanera-rec:6f1c2d3e'), '6F1C2D3E');
  });

  it('ignores anything that is not a record code', () => {
    assert.equal(parseRecordCode(''), null);
    assert.equal(parseRecordCode('Jane Doe'), null);
    assert.equal(parseRecordCode('https://example.com/pay?id=1'), null);
    assert.equal(parseRecordCode('6F1C2D3'), null); // 7 characters
    assert.equal(parseRecordCode('6F1C2D3EZ'), null);
  });

  it('matches a record by its code, and only that record', () => {
    assert.equal(recordMatchesCode({ id: ID }, '6F1C2D3E'), true);
    assert.equal(recordMatchesCode({ id: ID }, '6f1c2d3e'), true);
    assert.equal(recordMatchesCode({ id: ID }, 'AAAAAAAA'), false);
    assert.equal(recordMatchesCode({ id: 'pending_1' }, '6F1C2D3E'), false);
    assert.equal(recordMatchesCode({ id: ID }, null), false);
  });
});

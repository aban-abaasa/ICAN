import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ATTACHMENT_LABELS } from '../src/utils/consultationAttachments.js';
import {
  DEFAULT_ATTACHMENT_PROMPT, DEFAULT_FORM_SETTINGS, labelsToText, normalizeFormSettings, resolveAttachmentLabels,
  resolveAttachmentPrompt, settingsEqual, settingsPayload, settingsSummary, textToLabels
} from '../src/utils/consultationFormSettings.js';

describe('form options default to everything on, attachments optional', () => {
  it('an old form with no settings gets the defaults', () => {
    for (const raw of [undefined, null, {}, [], 'junk']) {
      assert.deepEqual(normalizeFormSettings(raw), { ...DEFAULT_FORM_SETTINGS });
    }
    const defaults = normalizeFormSettings({});
    assert.equal(defaults.showLogo, true);
    assert.equal(defaults.showQr, true);
    assert.equal(defaults.allowAttachments, true);
    assert.equal(defaults.attachmentsRequired, false);
    assert.equal(defaults.attachmentMax, 8);
  });

  it('keeps what the owner chose', () => {
    const s = normalizeFormSettings({ showLogo: false, showQr: false, allowAttachments: true, attachmentsRequired: true, attachmentMax: 3, attachmentPrompt: '  Upload your X-ray  ' });
    assert.equal(s.showLogo, false);
    assert.equal(s.showQr, false);
    assert.equal(s.attachmentsRequired, true);
    assert.equal(s.attachmentMax, 3);
    assert.equal(s.attachmentPrompt, 'Upload your X-ray');
  });

  it('ignores values of the wrong type instead of trusting them', () => {
    const s = normalizeFormSettings({ showLogo: 'no', showQr: 0, allowAttachments: null, attachmentMax: 'lots', attachmentPrompt: 5 });
    assert.deepEqual(s, { ...DEFAULT_FORM_SETTINGS });
  });

  it('keeps the file limit between 1 and 12', () => {
    assert.equal(normalizeFormSettings({ attachmentMax: 0 }).attachmentMax, 1);
    assert.equal(normalizeFormSettings({ attachmentMax: 99 }).attachmentMax, 12);
    assert.equal(normalizeFormSettings({ attachmentMax: 4.6 }).attachmentMax, 5);
  });
});

describe('attachment tags', () => {
  it('follow the built-in list until the owner sets their own', () => {
    assert.deepEqual(resolveAttachmentLabels({}), ATTACHMENT_LABELS);
    assert.deepEqual(resolveAttachmentLabels({ attachmentLabels: ['Scan', 'Referral'] }), ['Scan', 'Referral']);
  });

  it('an empty list means "no tags", not "use the defaults"', () => {
    assert.deepEqual(resolveAttachmentLabels({ attachmentLabels: [] }), []);
  });

  it('round-trips through the text box', () => {
    assert.equal(labelsToText(null), ATTACHMENT_LABELS.join(', '));
    assert.deepEqual(textToLabels('Scan,  Referral ,, '), ['Scan', 'Referral']);
    assert.deepEqual(textToLabels(''), []);
    assert.equal(textToLabels(ATTACHMENT_LABELS.join(', ')), null); // typing the defaults back = follow the defaults
  });

  it('caps the list at 12 tags', () => {
    assert.equal(textToLabels(Array.from({ length: 20 }, (_, i) => `t${i}`).join(',')).length, 12);
  });

  it('heading falls back to a friendly default', () => {
    assert.equal(resolveAttachmentPrompt({}), DEFAULT_ATTACHMENT_PROMPT);
    assert.equal(resolveAttachmentPrompt({ attachmentPrompt: 'Attach your referral' }), 'Attach your referral');
  });
});

describe('saving options', () => {
  it('sends every switch explicitly, and tags/heading only when customised', () => {
    assert.deepEqual(settingsPayload({}), { showLogo: true, showQr: true, allowAttachments: true, attachmentsRequired: false, attachmentMax: 8 });
    assert.deepEqual(
      settingsPayload({ showLogo: false, attachmentLabels: ['A'], attachmentPrompt: 'Hi' }),
      { showLogo: false, showQr: true, allowAttachments: true, attachmentsRequired: false, attachmentMax: 8, attachmentLabels: ['A'], attachmentPrompt: 'Hi' }
    );
  });

  it('knows when nothing has changed', () => {
    assert.equal(settingsEqual({}, { showLogo: true }), true);
    assert.equal(settingsEqual({}, { showQr: false }), false);
    assert.equal(settingsEqual({ attachmentLabels: [] }, {}), false);
  });

  it('summarises what is on for the form header', () => {
    assert.deepEqual(settingsSummary({}), ['Logo on', 'QR on', 'Attachments optional (up to 8)']);
    assert.deepEqual(settingsSummary({ showLogo: false, showQr: false, allowAttachments: false }), ['Logo off', 'QR off', 'Attachments off']);
    assert.deepEqual(settingsSummary({ attachmentsRequired: true, attachmentMax: 2 })[2], 'Attachments required (up to 2)');
  });
});

import React, { useState } from 'react';
import { Loader, Paperclip, Plus } from 'lucide-react';
import { addConsultationAttachments, removeConsultationAttachment } from '../services/cmmsConsultationFormService';
import { cleanAttachments, MAX_STAFF_ATTACHMENTS, recordAttachments } from '../utils/consultationAttachments';
import { normalizeFormSettings, resolveAttachmentLabels, resolveAttachmentPrompt } from '../utils/consultationFormSettings';
import ConsultationAttachmentGallery from './ConsultationAttachmentGallery';
import ConsultationAttachmentPicker, { attachmentsToSave, attachmentsUploading } from './ConsultationAttachmentPicker';

// The photos & documents on one saved consultation record, as staff see them
// (per-form submissions list and the Records tab): the gallery, plus
// "Add photos or documents" for something that arrives after the visit - a lab
// result, a follow-up injury photo - and a remove action for a mistaken upload.
// `onRecordUpdated(row)` receives the updated submission row from the server.
// `settings` is the form's raw options: when the owner turned attachments off, nothing
// can be added (what's already there still shows), and the tags and heading follow
// the owner's choices. A record still waiting to sync (offline walk-in) has no server row to attach
// to yet, so it only shows what it already carries.
export default function ConsultationRecordAttachments({ record, settings, onRecordUpdated }) {
  const options = normalizeFormSettings(settings);
  const [adding, setAdding] = useState(false);
  const [items, setItems] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const attachments = recordAttachments(record);
  const canEdit = !record.pendingSync && !String(record.id).startsWith('pending_');
  const canAdd = canEdit && options.allowAttachments;

  const save = async () => {
    const toSave = cleanAttachments(attachmentsToSave(items));
    if (!toSave.length) return;
    setSaving(true);
    setError('');
    const result = await addConsultationAttachments(record.id, toSave);
    setSaving(false);
    if (!result.success) { setError(result.error); return; }
    onRecordUpdated(result.data);
    setItems([]);
    setAdding(false);
  };

  const remove = async (attachment) => {
    if (!window.confirm(`Remove "${attachment.label || attachment.name}" from this record?`)) return;
    const result = await removeConsultationAttachment(record.id, attachment.key);
    if (result.success) onRecordUpdated(result.data); else setError(result.error);
  };

  if (!attachments.length && !canAdd) return null;

  return (
    <div className="space-y-2 rounded-xl border border-white/10 bg-slate-900/40 p-3">
      <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-cyan-300">
        <Paperclip className="h-3.5 w-3.5" /> Photos & documents
      </p>

      <ConsultationAttachmentGallery
        attachments={attachments}
        onRemove={canEdit ? remove : null}
        emptyText="Nothing attached to this record yet."
      />

      {error && <p className="text-xs text-red-300">{error}</p>}

      {canAdd && (adding ? (
        <div className="space-y-2 border-t border-white/10 pt-3">
          <ConsultationAttachmentPicker
            items={items} onItemsChange={setItems} variant="staff" max={Math.max(1, Math.min(MAX_STAFF_ATTACHMENTS, 40 - attachments.length))}
            labels={resolveAttachmentLabels(options)}
            disabled={!navigator.onLine} disabledReason="Reconnect to the internet to attach files." title={`Add to this record - ${resolveAttachmentPrompt(options)}`}
          />
          <div className="flex gap-2">
            <button type="button" onClick={() => { setAdding(false); setItems([]); setError(''); }} className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-slate-300">Cancel</button>
            <button
              type="button" onClick={save} disabled={saving || attachmentsUploading(items) || !attachmentsToSave(items).length}
              className="flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {saving && <Loader className="h-3.5 w-3.5 animate-spin" />} Save to record
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="flex items-center gap-1.5 rounded-lg border border-white/15 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/5">
          <Plus className="h-3.5 w-3.5" /> Add photos or documents
        </button>
      ))}
    </div>
  );
}

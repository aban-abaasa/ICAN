import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Camera, CheckCircle2, FileText, Image as ImageIcon, Loader, Paperclip, RefreshCw, UploadCloud, X } from 'lucide-react';
import { uploadConsultationAttachment, resolveAttachmentUrls } from '../services/cmmsConsultationAttachmentService';
import {
  ACCEPT_ATTR, ATTACHMENT_LABELS, attachmentKind, formatFileSize, validateAttachmentFile
} from '../utils/consultationAttachments';

// "Attach photos & documents" block, on EVERY consultation form: the public
// share-link page (a patient attaching an X-ray, an injury photo, an insurance
// card) and the staff "record a walk-in" form. One component, two looks — it is
// styled entirely from --ap-* custom properties, which `variant` maps either to
// the public page's own light/dark palette (--cf-*) or to the staff app's dark
// slate theme.
//
// Ways in: take a photo with the camera, pick from the gallery, add a PDF /
// document, drag files onto the zone, or paste a screenshot. Each file uploads
// the moment it is added (so Submit is instant), can be tagged (X-ray, injury
// photo, …) and captioned, and shows its own progress / retry.
//
// Controlled: `items` is the list and `onItemsChange` takes a plain value or an
// updater, like a React setState. Only items with status 'done' have a `key`.

const PALETTES = {
  public: {
    '--ap-surface': 'var(--cf-surface-alt)',
    '--ap-border': 'var(--cf-border)',
    '--ap-text': 'var(--cf-text)',
    '--ap-muted': 'var(--cf-text-muted)',
    '--ap-accent': 'var(--cf-green)',
    '--ap-danger': 'var(--cf-maroon)'
  },
  staff: {
    '--ap-surface': 'rgba(255,255,255,0.05)',
    '--ap-border': 'rgba(255,255,255,0.15)',
    '--ap-text': '#f1f5f9',
    '--ap-muted': '#94a3b8',
    '--ap-accent': '#22d3ee',
    '--ap-danger': '#f87171'
  }
};

let idCounter = 0;
const nextId = () => `att_${Date.now()}_${idCounter++}`;

const Thumb = ({ item }) => {
  const [url, setUrl] = useState(item.previewUrl || '');
  useEffect(() => {
    if (item.previewUrl || !item.key || attachmentKind(item) !== 'image') return undefined;
    let cancelled = false;
    resolveAttachmentUrls([item]).then(([resolved]) => { if (!cancelled) setUrl(resolved?.url || ''); });
    return () => { cancelled = true; };
  }, [item.previewUrl, item.key]);

  const kind = attachmentKind(item);
  if (kind === 'image' && url) {
    return <img src={url} alt="" className="h-full w-full object-cover" />;
  }
  return (
    <div className="flex h-full w-full items-center justify-center" style={{ color: 'var(--ap-muted)' }}>
      {kind === 'image' ? <ImageIcon size={22} /> : <FileText size={22} />}
    </div>
  );
};

export default function ConsultationAttachmentPicker({
  items, onItemsChange, variant = 'public', guest = false, max = 8, disabled = false, disabledReason = '',
  title = 'Photos & documents', labels = ATTACHMENT_LABELS, required = false
}) {
  const [dragOver, setDragOver] = useState(false);
  const [notice, setNotice] = useState('');
  const cameraRef = useRef(null);
  const galleryRef = useRef(null);
  const documentRef = useRef(null);
  const filesById = useRef(new Map()); // id -> File, kept so a failed upload can be retried
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // Preview blob URLs live for as long as the picker does.
  useEffect(() => () => {
    itemsRef.current.forEach((it) => { if (it.previewUrl) URL.revokeObjectURL(it.previewUrl); });
  }, []);

  const palette = PALETTES[variant] || PALETTES.public;
  const patch = (id, changes) => onItemsChange((current) => current.map((it) => (it.id === id ? { ...it, ...changes } : it)));

  const upload = async (id, file) => {
    patch(id, { status: 'uploading', error: '' });
    try {
      const saved = await uploadConsultationAttachment(file, { guest });
      patch(id, { ...saved, status: 'done', error: '' });
    } catch (err) {
      patch(id, { status: 'error', error: err.message || 'Upload failed.' });
    }
  };

  const addFiles = (fileList) => {
    if (disabled) return;
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const room = max - itemsRef.current.length;
    if (room <= 0) { setNotice(`You can attach up to ${max} files.`); return; }

    const accepted = [];
    const problems = [];
    files.slice(0, room).forEach((file) => {
      const problem = validateAttachmentFile(file);
      if (problem) problems.push(`${file.name || 'File'}: ${problem}`); else accepted.push(file);
    });
    if (files.length > room) problems.push(`Only ${max} files fit - ${files.length - room} not added.`);
    setNotice(problems.join(' '));
    if (!accepted.length) return;

    const created = accepted.map((file) => {
      const id = nextId();
      filesById.current.set(id, file);
      return {
        id, name: file.name || 'attachment', type: file.type, size: file.size, label: '', caption: '',
        previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : '', status: 'uploading', error: ''
      };
    });
    onItemsChange((current) => [...current, ...created]);
    created.forEach((it) => upload(it.id, filesById.current.get(it.id)));
  };

  const remove = (item) => {
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    filesById.current.delete(item.id);
    onItemsChange((current) => current.filter((it) => it.id !== item.id));
    setNotice('');
  };

  const onPaste = (e) => {
    const pasted = Array.from(e.clipboardData?.files || []);
    if (pasted.length) { e.preventDefault(); addFiles(pasted); }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer?.files);
  };

  const pick = (ref) => () => { if (!disabled) ref.current?.click(); };
  const onInput = (e) => { addFiles(e.target.files); e.target.value = ''; };

  const buttonClass = 'flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold disabled:opacity-50';
  const buttonStyle = { background: 'var(--ap-surface)', border: '1px solid var(--ap-border)', color: 'var(--ap-text)' };
  const uploading = items.some((it) => it.status === 'uploading');

  return (
    <div style={{ ...palette, color: 'var(--ap-text)' }} className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-bold uppercase tracking-wide" style={{ color: 'var(--ap-accent)' }}>
          <Paperclip size={15} /> {title}{required && <span style={{ color: 'var(--ap-danger)' }}> *</span>}
        </p>
        <span className="text-xs" style={{ color: 'var(--ap-muted)' }}>{items.length}/{max}</span>
      </div>

      <div
        tabIndex={disabled ? -1 : 0}
        onPaste={onPaste}
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className="rounded-2xl p-4 text-center outline-none transition"
        style={{
          border: `2px dashed ${dragOver ? 'var(--ap-accent)' : 'var(--ap-border)'}`,
          background: dragOver ? 'color-mix(in srgb, var(--ap-accent) 10%, transparent)' : 'var(--ap-surface)',
          opacity: disabled ? 0.6 : 1
        }}
      >
        <UploadCloud size={26} className="mx-auto mb-1" style={{ color: 'var(--ap-accent)' }} />
        <p className="text-sm font-semibold">{disabled ? disabledReason || 'Attachments are unavailable right now.' : 'Drag files here, or paste a screenshot'}</p>
        <p className="mt-0.5 text-xs" style={{ color: 'var(--ap-muted)' }}>
          X-rays, scans, injury photos, lab results, prescriptions, ID or insurance cards - JPG, PNG, WEBP or PDF, up to 10 MB each.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={disabled} onClick={pick(cameraRef)} className={buttonClass} style={buttonStyle}>
            <Camera size={15} /> Take photo
          </button>
          <button type="button" disabled={disabled} onClick={pick(galleryRef)} className={buttonClass} style={buttonStyle}>
            <ImageIcon size={15} /> Choose photos
          </button>
          <button type="button" disabled={disabled} onClick={pick(documentRef)} className={buttonClass} style={buttonStyle}>
            <FileText size={15} /> Add document
          </button>
        </div>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onInput} />
        <input ref={galleryRef} type="file" accept="image/*" multiple className="hidden" onChange={onInput} />
        <input ref={documentRef} type="file" accept={ACCEPT_ATTR} multiple className="hidden" onChange={onInput} />
      </div>

      {notice && <p className="text-xs" style={{ color: 'var(--ap-danger)' }}>{notice}</p>}

      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id} className="rounded-xl p-2.5" style={{ background: 'var(--ap-surface)', border: '1px solid var(--ap-border)' }}>
              <div className="flex items-center gap-3">
                <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg" style={{ border: '1px solid var(--ap-border)' }}>
                  <Thumb item={item} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.name}</p>
                  <p className="flex items-center gap-1 text-xs" style={{ color: item.status === 'error' ? 'var(--ap-danger)' : 'var(--ap-muted)' }}>
                    {item.status === 'uploading' && <><Loader size={12} className="animate-spin" /> Uploading…</>}
                    {item.status === 'done' && <><CheckCircle2 size={12} style={{ color: 'var(--ap-accent)' }} /> {formatFileSize(item.size) || 'Uploaded'}</>}
                    {item.status === 'error' && <><AlertCircle size={12} /> {item.error}</>}
                  </p>
                </div>
                {item.status === 'error' && filesById.current.has(item.id) && (
                  <button type="button" onClick={() => upload(item.id, filesById.current.get(item.id))} aria-label="Retry upload" className="p-1.5" style={{ color: 'var(--ap-accent)' }}>
                    <RefreshCw size={16} />
                  </button>
                )}
                <button type="button" onClick={() => remove(item)} aria-label={`Remove ${item.name}`} className="p-1.5" style={{ color: 'var(--ap-muted)' }}>
                  <X size={16} />
                </button>
              </div>

              {item.status !== 'error' && (
                <div className="mt-2 space-y-2">
                  {labels.length > 0 && <div className="flex flex-wrap gap-1.5">
                    {labels.map((label) => {
                      const active = item.label === label;
                      return (
                        <button
                          key={label} type="button"
                          onClick={() => patch(item.id, { label: active ? '' : label })}
                          className="rounded-full px-2.5 py-0.5 text-[11px] font-medium"
                          style={active
                            ? { background: 'var(--ap-accent)', color: '#fff', border: '1px solid var(--ap-accent)' }
                            : { border: '1px solid var(--ap-border)', color: 'var(--ap-muted)' }}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>}
                  <input
                    value={item.caption || ''} onChange={(e) => patch(item.id, { caption: e.target.value })} maxLength={300}
                    placeholder="Add a note (optional), e.g. left knee, taken Monday"
                    className="w-full rounded-lg bg-transparent px-3 py-1.5 text-xs outline-none"
                    style={{ border: '1px solid var(--ap-border)', color: 'var(--ap-text)' }}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {uploading && <p className="text-xs" style={{ color: 'var(--ap-muted)' }}>Wait for uploads to finish before submitting.</p>}
    </div>
  );
}

// Parent helpers, so each form decides "can I submit?" and "what do I send?" the same way.
export const attachmentsUploading = (items) => items.some((it) => it.status === 'uploading');
export const attachmentsToSave = (items) => items.filter((it) => it.status === 'done' && it.key);

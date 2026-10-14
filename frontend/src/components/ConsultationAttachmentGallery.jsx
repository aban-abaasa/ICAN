import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, ExternalLink, FileText, Image as ImageIcon, Trash2, X } from 'lucide-react';
import { getAttachmentDownloadUrl, resolveAttachmentUrls } from '../services/cmmsConsultationAttachmentService';
import { attachmentKind, attachmentsSummary, formatFileSize } from '../utils/consultationAttachments';

// A record's photos & documents, for staff: a thumbnail grid (each tile carries
// its tag - X-ray, injury photo, …) that opens a full-screen viewer with
// next / previous (buttons, arrow keys, swipe-friendly big targets), the note
// the patient wrote, and a Download button. PDFs and other documents open
// via their download link. `onRemove`, when given, adds a remove button
// (confirmation is the caller's job).

const triggerDownload = async (attachment) => {
  const url = await getAttachmentDownloadUrl(attachment);
  if (!url) { alert('Could not prepare this file for download. Please try again.'); return; }
  window.open(url, '_blank');
};

function Lightbox({ items, index, onIndex, onClose, onRemove }) {
  const item = items[index];
  const go = useCallback((delta) => {
    onIndex((index + delta + items.length) % items.length);
  }, [index, items.length, onIndex]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' && items.length > 1) go(1);
      else if (e.key === 'ArrowLeft' && items.length > 1) go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, items.length, onClose]);

  if (!item) return null;
  return (
    <div className="fixed inset-0 z-[300] flex flex-col bg-black/90" role="dialog" aria-modal="true" aria-label="Attachment viewer" onClick={onClose}>
      <div className="flex items-center justify-between gap-3 p-3 text-sm text-white" onClick={(e) => e.stopPropagation()}>
        <div className="min-w-0">
          <p className="truncate font-semibold">{item.label || item.name}</p>
          <p className="truncate text-xs text-slate-300">{index + 1} of {items.length} · {item.name}{item.size ? ` · ${formatFileSize(item.size)}` : ''}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" onClick={() => triggerDownload(item)} className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs hover:bg-white/20">
            <Download size={14} /> Download
          </button>
          {onRemove && (
            <button type="button" onClick={() => onRemove(item)} className="flex items-center gap-1.5 rounded-lg bg-red-500/20 px-3 py-1.5 text-xs text-red-200 hover:bg-red-500/30">
              <Trash2 size={14} /> Remove
            </button>
          )}
          <button type="button" onClick={onClose} aria-label="Close viewer" className="rounded-lg bg-white/10 p-1.5 hover:bg-white/20"><X size={18} /></button>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-12" onClick={(e) => e.stopPropagation()}>
        {items.length > 1 && (
          <button type="button" onClick={() => go(-1)} aria-label="Previous" className="absolute left-2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"><ChevronLeft size={22} /></button>
        )}
        <img src={item.url} alt={item.caption || item.name} className="max-h-full max-w-full rounded-lg object-contain" />
        {items.length > 1 && (
          <button type="button" onClick={() => go(1)} aria-label="Next" className="absolute right-2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"><ChevronRight size={22} /></button>
        )}
      </div>

      <div className="min-h-[3rem] p-3 text-center text-sm text-slate-200" onClick={(e) => e.stopPropagation()}>
        {item.caption || ''}
      </div>
    </div>
  );
}

export default function ConsultationAttachmentGallery({ attachments, onRemove, emptyText = '' }) {
  const [resolved, setResolved] = useState([]);
  const [viewing, setViewing] = useState(null); // index into `photos`
  const signature = (attachments || []).map((a) => a.key).join('|');

  useEffect(() => {
    let cancelled = false;
    if (!attachments?.length) { setResolved([]); return undefined; }
    resolveAttachmentUrls(attachments).then((list) => { if (!cancelled) setResolved(list); });
    return () => { cancelled = true; };
  }, [signature]);

  const photos = useMemo(() => resolved.filter((a) => attachmentKind(a) === 'image' && a.url), [resolved]);

  const open = (item) => {
    if (attachmentKind(item) === 'image' && item.url) setViewing(photos.findIndex((p) => p.key === item.key));
    else triggerDownload(item);
  };

  if (!attachments?.length) return emptyText ? <p className="text-xs text-slate-500">{emptyText}</p> : null;

  // Tiles render from the saved metadata straight away; a thumbnail appears as soon as its URL resolves.
  const tiles = attachments.map((a) => resolved.find((r) => r.key === a.key) || { ...a, url: '' });

  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-400">{attachmentsSummary(attachments)}</p>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,140px))] gap-2">
        {tiles.map((item) => {
          const kind = attachmentKind(item);
          return (
            <button
              key={item.key} type="button" onClick={() => open(item)} title={item.caption || item.name}
              className="group relative aspect-square overflow-hidden rounded-xl border border-white/10 bg-slate-900 text-left hover:border-cyan-400/60"
            >
              {kind === 'image' && item.url ? (
                <img src={item.url} alt={item.caption || item.name} loading="lazy" className="h-full w-full object-cover transition group-hover:scale-105" />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-2 text-slate-300">
                  {kind === 'image' ? <ImageIcon size={22} /> : <FileText size={22} />}
                  <span className="line-clamp-2 break-all text-center text-[10px]">{item.name}</span>
                  {kind !== 'image' && <ExternalLink size={11} className="text-slate-500" />}
                </div>
              )}
              {item.label && (
                <span className="absolute inset-x-0 bottom-0 truncate bg-black/65 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-200">{item.label}</span>
              )}
            </button>
          );
        })}
      </div>

      {viewing !== null && photos[viewing] && (
        <Lightbox
          items={photos} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)}
          onRemove={onRemove ? (item) => { setViewing(null); onRemove(item); } : null}
        />
      )}
    </div>
  );
}

import React, { useEffect, useRef } from 'react';
import { ArrowLeft, Pencil } from 'lucide-react';

// The zone form as a page of its own in CMMS > Transport: no card inside a card, the form takes the whole width.
// Same frame as the "open this tab as a full page" views (cmms-fullpage), so it sits below the status bar and above the bottom
// tab bar like they do. Escape and Back close it.
export default function ZoneEditorPage({ title, subtitle, onClose, children }) {
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') close.current(); };
    window.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = previous; };
  }, []);

  return (
    <div className="cmms-fullpage fixed inset-0 z-50 overflow-y-auto overscroll-contain p-4 md:p-8" role="dialog" aria-modal="true" aria-label={title}>
      <div className="mx-auto w-full max-w-4xl space-y-5">
        <div className="cmms-accent-gold flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="cmms-medallion"><Pencil className="h-4 w-4" aria-hidden="true" /></span>
          <div className="min-w-0 flex-1 basis-32">
            <h2 className="cmms-classic-heading text-lg leading-tight">{title}</h2>
            {subtitle && <p className="truncate text-xs cmms-classic-muted">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} className="cmms-classic-btn-secondary inline-flex !h-auto !min-h-0 flex-shrink-0 items-center gap-1.5 !px-3 !py-1.5 text-xs">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Back
          </button>
        </div>
        <div className="cmms-ornament" aria-hidden="true" />
        {children}
      </div>
    </div>
  );
}

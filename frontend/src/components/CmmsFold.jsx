import React, { useRef, useState } from 'react';
import { ChevronDown, Info } from 'lucide-react';

// Shared "slim tab" used across CMMS pages: a classic accent card that is one
// line when closed (icon medallion, title, optional status chip, an (i) for the
// long explanation, chevron) and only shows its content when opened. Keeps
// wordy setup panels short; the long copy lives behind the (i).
// accent: gold | emerald | navy | burgundy | plum | teal (see index.css).
export function InfoTip({ label = 'More information', children, className = '' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open} aria-label={label} title={label} className={`cmms-info-btn ${className}`}>
        <Info className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      {open && <div className="cmms-info cmms-classic-muted basis-full">{children}</div>}
    </>
  );
}

export default function CmmsFold({ title, icon, accent = 'gold', hint, hintTone, info, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  const [infoOpen, setInfoOpen] = useState(false);
  const bodyId = useRef(`cmms-fold-${Math.random().toString(36).slice(2)}`).current;
  const toggle = () => setOpen(o => !o);
  return (
    <section className={`cmms-sec cmms-accent-${accent}`} data-open={open}>
      <div className="flex items-center gap-2">
        <button type="button" onClick={toggle} aria-expanded={open} aria-controls={bodyId}
          className="flex min-w-0 flex-1 items-center gap-3 text-left !bg-transparent"
          style={{ background: 'transparent', border: 0, padding: 0, boxShadow: 'none' }}>
          <span className="cmms-medallion">{icon}</span>
          <span className="cmms-classic-heading cmms-sec-title min-w-0">{title}</span>
        </button>
        {hint && <span className={`flex-shrink-0 text-xs ${hintTone === 'ok' ? 'cmms-tone-ok font-semibold' : hintTone === 'warn' ? 'cmms-tone-warn font-semibold' : 'cmms-classic-muted'}`}>{hint}</span>}
        {info && (
          <button type="button" onClick={() => setInfoOpen(v => !v)} aria-expanded={infoOpen} aria-label={`About ${title}`} title="What is this?" className="cmms-info-btn">
            <Info className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
        <button type="button" onClick={toggle} tabIndex={-1} aria-hidden="true" className="flex-shrink-0 !bg-transparent" style={{ background: 'transparent', border: 0, padding: 0, boxShadow: 'none' }}>
          <ChevronDown className={`h-4 w-4 cmms-classic-muted transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {infoOpen && info && <p className="cmms-info cmms-classic-muted">{info}</p>}
      {open && <div id={bodyId} className="cmms-sec-body mt-4 space-y-3">{children}</div>}
    </section>
  );
}

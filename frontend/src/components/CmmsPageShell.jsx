import React, { useEffect, useState } from 'react';
import { ArrowLeft, Info, Maximize2 } from 'lucide-react';

// Shared Payroll-style page frame for CMMS tabs: classic card that can lift to
// a full-screen page, a slim header (medallion, title, live chips, (i) for the
// long explanation) and optional pill tabs. Mirrors CMMSPayrollPanel's header.
// tabs: [{ id, label, accent? }]; tab changes are the caller's job via onTab.
export default function CmmsPageShell({ title, subtitle, icon, chips = [], info, actions, tabs, tab, onTab, fullPageOnTab = false, compactTabs = false, children }) {
  const [fullPage, setFullPage] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  useEffect(() => {
    if (!fullPage) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setFullPage(false); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [fullPage]);

  const shown = chips.filter(Boolean);
  return (
    <div className={fullPage ? 'cmms-fullpage space-y-5 fixed inset-0 z-50 overflow-y-auto p-4 md:p-8' : 'space-y-5 cmms-classic-card p-4 md:p-6'}>
      <div className="cmms-accent-gold space-y-2.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="cmms-medallion">{icon}</span>
          <div className="min-w-0 flex-1 basis-32">
            <h2 className="cmms-classic-heading text-lg leading-tight">{title}</h2>
            {subtitle && <p className="truncate text-xs cmms-classic-muted">{subtitle}</p>}
          </div>
          {info && (
            <button type="button" onClick={() => setInfoOpen((v) => !v)} aria-expanded={infoOpen} aria-label="About this page" title="What is this page?" className="cmms-info-btn">
              <Info className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
          {actions}
          {fullPage
            ? <button type="button" onClick={() => setFullPage(false)} className="cmms-classic-btn-secondary inline-flex !h-auto !min-h-0 flex-shrink-0 items-center gap-1.5 !px-3 !py-1.5 text-xs"><ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Back</button>
            : <button type="button" onClick={() => setFullPage(true)} className="cmms-info-btn" title="Open this tab as a full page" aria-label="Open full page"><Maximize2 className="h-3.5 w-3.5" aria-hidden="true" /></button>}
        </div>
        {shown.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {shown.map((c, i) => <span key={i} className="cmms-classic-chip" style={{ animation: `cmms-rise .45s ease ${i * 80}ms both` }}>{c}</span>)}
          </div>
        )}
        {infoOpen && info && <div className="cmms-info cmms-classic-muted space-y-1">{typeof info === 'string' ? <p>{info}</p> : info}</div>}
        <div className="cmms-ornament" aria-hidden="true" />
        {tabs && (
          <div className={`-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [&>button]:flex-shrink-0 [&>button]:whitespace-nowrap ${compactTabs ? 'cmms-tabs-compact' : ''}`} role="tablist" style={{ scrollbarWidth: 'none' }}>
            {tabs.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => { onTab(t.id); if (fullPageOnTab) setFullPage(true); }}
                className={`cmms-ptab cmms-accent-${t.accent || 'gold'} ${tab === t.id ? 'is-active' : ''}`}>
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

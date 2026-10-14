import React from 'react';
import { HelpCircle } from 'lucide-react';
import { CHART_PALETTES } from './chartPalettes';

// A public /icaneracoin section whose data is not reachable yet (its SQL is not installed, no contract is configured, or the
// first answer has not arrived). The section and its anchor stay on the page, so the navigation can always load it and a
// visitor learns what is coming, instead of the section silently not existing. The long explanation lives in the Learn
// section; `onLearn` jumps there.
const PublicSectionNotice = ({ id, theme = 'dark', skin: k, kicker, title, children, loading = false, onLearn }) => {
  const c = CHART_PALETTES[theme] || CHART_PALETTES.dark;
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="mt-10 scroll-mt-16" data-testid={`public-${id}-notice`}>
      <p className={`text-xs font-bold uppercase tracking-[0.16em] ${k.kicker}`}>{kicker}</p>
      <h2 id={`${id}-heading`} className={`mt-1 text-xl font-bold sm:text-2xl ${k.title}`}>{title}</h2>
      {children && <p className={`mt-1 max-w-3xl text-sm ${k.soft}`}>{children}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <p className="inline-block rounded-lg px-3 py-2 text-xs" style={{ background: c.field, border: `1px solid ${c.fieldBorder}`, color: c.muted }} role="status">
          {loading ? 'Loading…' : 'Not live yet. Check back soon.'}
        </p>
        {onLearn && (
          <button type="button" onClick={onLearn} className={`inline-flex min-h-[40px] items-center gap-1.5 text-xs font-semibold ${k.kicker}`}>
            <HelpCircle className="h-4 w-4" aria-hidden="true" /> How it works
          </button>
        )}
      </div>
    </section>
  );
};

export default PublicSectionNotice;

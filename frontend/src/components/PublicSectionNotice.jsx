import React from 'react';
import { CHART_PALETTES } from './chartPalettes';

// A public /icaneracoin section whose data is not reachable yet (its SQL is not installed, no contract is configured, or the
// first answer has not arrived). The section and its anchor stay on the page, so the navigation can always load it and a
// visitor learns what is coming, instead of the section silently not existing.
const PublicSectionNotice = ({ id, theme = 'dark', skin: k, kicker, title, children, loading = false }) => {
  const c = CHART_PALETTES[theme] || CHART_PALETTES.dark;
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="mt-12 scroll-mt-16" data-testid={`public-${id}-notice`}>
      <p className={`text-xs font-bold uppercase tracking-[0.16em] ${k.kicker}`}>{kicker}</p>
      <h2 id={`${id}-heading`} className={`mt-1 text-2xl font-bold ${k.title}`}>{title}</h2>
      <div className={`mt-2 max-w-3xl text-sm leading-6 ${k.body}`}>{children}</div>
      <p className="mt-3 inline-block rounded-lg px-3 py-2 text-xs" style={{ background: c.field, border: `1px solid ${c.fieldBorder}`, color: c.muted }} role="status">
        {loading ? 'Loading…' : 'Live figures for this section are not switched on yet. Check back soon.'}
      </p>
    </section>
  );
};

export default PublicSectionNotice;

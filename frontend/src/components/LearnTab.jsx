import React, { useState } from 'react';
import { HelpCircle, ChevronDown } from 'lucide-react';

// ONE collapsed "How it works" tab per screen, like the Learn section of the public /icaneracoin page: every explanation
// (how prices work, the risks, what a token is) lives behind it as short question-and-answer rows, and the screen itself
// stays about the money and the chart. `items` are { q, a } where `a` is text or any element.
export default function LearnTab({ label = 'How it works & risks', items }) {
  const [open, setOpen] = useState(false);
  const list = (items || []).filter(Boolean);
  if (!list.length) return null;
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/60" aria-label={label}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="flex min-h-[44px] w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm font-semibold text-slate-200">
        <span className="inline-flex items-center gap-2"><HelpCircle className="h-4 w-4 text-amber-300" aria-hidden="true" />{label}</span>
        <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <div className="divide-y divide-slate-800 border-t border-slate-800">
          {list.map((item) => (
            <details key={item.q} className="group px-4">
              <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-3 py-2 text-sm font-semibold text-slate-200 marker:hidden">
                {item.q}
                <span aria-hidden="true" className="shrink-0 text-xs text-slate-400 transition-transform group-open:rotate-180">▾</span>
              </summary>
              <div className="pb-3 text-sm leading-6 text-slate-400">{item.a}</div>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}

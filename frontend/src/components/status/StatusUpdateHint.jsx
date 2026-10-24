import React, { useEffect, useRef, useState } from 'react';
import { MessageCircle, Tag, Eye, Clock, X } from 'lucide-react';
import { HINT_VISIBLE_MS } from '../../utils/statusUpdateHints';

const ICONS = { comments: MessageCircle, badge: Tag, views: Eye, ending: Clock };
const OUT_MS = 450;

const CSS = `
@keyframes suh-in  { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
@keyframes suh-out { from { opacity: 1; transform: translateY(0); }    to { opacity: 0; transform: translateY(12px); } }
.suh-in  { animation: suh-in 380ms ease-out both; }
.suh-out { animation: suh-out ${OUT_MS}ms ease-in both; }
@media (prefers-reduced-motion: reduce) { .suh-in, .suh-out { animation-duration: 1ms; } }
`;

/**
 * A quiet note on one of the owner's own status cards: what just happened, and that it can be tapped to open before it slides away.
 * Fades in, waits `visibleMs` (longer while a finger or pointer is on it), then slides away by itself and tells the parent (onDone), which makes
 * sure the same news is not announced again. It never takes focus and never blocks the card underneath: only the note itself takes a tap.
 *
 *   hint     { statusId, kind, text, open } from useStatusUpdateHints
 *   onOpen   the note was tapped: open the status (hint.open says where: 'comments' | 'badges' | 'status')
 *   onDone   the note has slid away, or was dismissed with the small ×
 */
export default function StatusUpdateHint({ hint, onOpen, onDone, visibleMs = HINT_VISIBLE_MS, className = '' }) {
  const [phase, setPhase] = useState('in'); // 'in' | 'out'
  const [paused, setPaused] = useState(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const Icon = ICONS[hint.kind] || MessageCircle;

  useEffect(() => { setPhase('in'); }, [hint.statusId, hint.kind, hint.text]);

  useEffect(() => {
    if (phase !== 'in' || paused) return undefined;
    const timer = setTimeout(() => setPhase('out'), visibleMs);
    return () => clearTimeout(timer);
  }, [phase, paused, visibleMs, hint.statusId, hint.text]);

  useEffect(() => {
    if (phase !== 'out') return undefined;
    const timer = setTimeout(() => doneRef.current(hint), OUT_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  return (
    <div role="status" aria-live="polite" className={`pointer-events-none absolute left-3 right-3 bottom-12 z-20 ${className}`}>
      <style>{CSS}</style>
      <div
        className={`suh-${phase} pointer-events-auto flex items-center gap-1 rounded-xl bg-black/75 backdrop-blur-md border border-white/15 shadow-lg`}
        onPointerEnter={() => setPaused(true)}
        onPointerLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
      >
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpen(hint); }}
          aria-label={`${hint.text}. Open this update`}
          className="flex-1 min-w-0 flex items-center gap-2.5 text-left pl-2.5 pr-1 py-2"
        >
          <span className="w-7 h-7 rounded-full bg-white/15 flex items-center justify-center flex-shrink-0"><Icon className="w-3.5 h-3.5 text-white" /></span>
          <span className="min-w-0">
            <span className="block text-xs font-semibold text-white leading-tight">{hint.text}</span>
            <span className="block text-[10px] text-white/60 leading-tight mt-0.5">Tap to open</span>
          </span>
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setPhase('out'); }}
          aria-label="Dismiss"
          className="p-2 text-white/50 hover:text-white flex-shrink-0"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

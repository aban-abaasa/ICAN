import React from 'react';
import { Square } from 'lucide-react';
import { stopDictation } from '../../services/dictationService';
import { useDictation } from './VoiceDictateButton';

/**
 * Floating "recording" pill. Mounted once in the app shell so that, wherever the person has
 * navigated to, they can see the microphone is on and stop it.
 */
export default function DictationIndicator() {
  const { listening, starting, title, label, words } = useDictation();
  if (!listening && !starting) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed left-3 z-[9999] flex items-center gap-2 rounded-full border border-red-400/50 bg-black/85 text-white pl-3 pr-1.5 py-1.5 shadow-lg backdrop-blur"
      style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 76px)' }}
    >
      <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" aria-hidden="true" />
      <span className="text-xs font-semibold max-w-[11rem] truncate">{starting ? 'Starting mic…' : `Listening: ${title || label || 'note'}`}</span>
      {words > 0 && <span className="text-[11px] opacity-70">{words} words</span>}
      <button
        type="button"
        onClick={stopDictation}
        aria-label="Stop listening"
        className="inline-flex items-center gap-1 min-h-[32px] px-2.5 rounded-full bg-red-600 hover:bg-red-500 text-xs font-bold"
      >
        <Square className="w-3 h-3 fill-current" aria-hidden="true" /> Stop
      </button>
    </div>
  );
}

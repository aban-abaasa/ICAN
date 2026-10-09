import React, { useEffect, useSyncExternalStore } from 'react';
import { Mic, Square } from 'lucide-react';
import { startDictation, stopDictation, subscribeDictation, getDictationSnapshot } from '../../services/dictationService';

export function useDictation() {
  return useSyncExternalStore(subscribeDictation, getDictationSnapshot);
}

/**
 * Mic button that types what the person says into a field.
 *
 * @param label            stable id for this field; the button knows its own session by it
 * @param title            optional name shown on the recording pill (defaults to label)
 * @param onText           (phrase) => void, called with each finished phrase
 * @param keepRunningOnLeave  true for screens whose text is saved outside React (the notebook),
 *                         so dictation carries on after the screen is closed
 */
export default function VoiceDictateButton({ label, title, onText, keepRunningOnLeave = false, className = '', idleText = 'Dictate', theme = 'light' }) {
  const dictation = useDictation();
  const active = dictation.listening && dictation.label === label;
  const starting = dictation.starting && dictation.label === label;

  useEffect(() => () => {
    if (!keepRunningOnLeave && getDictationSnapshot().label === label) stopDictation();
  }, [label, keepRunningOnLeave]);

  if (!dictation.supported) return null;

  const palette = theme === 'dark'
    ? (active ? 'bg-red-500/20 text-red-300 border-red-400/60' : 'bg-white/5 text-[#e6c980] border-[#e6c980]/40 hover:bg-white/10')
    : (active ? 'bg-red-50 text-red-700 border-red-300' : 'bg-white text-blue-700 border-blue-300 hover:bg-blue-50');

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        aria-pressed={active}
        aria-label={active ? `Stop dictating ${label}` : `Dictate ${label}`}
        onClick={() => (active || starting ? stopDictation() : startDictation({ label, title, onText }))}
        className={`inline-flex items-center gap-1.5 min-h-[40px] px-3 rounded-lg border text-sm font-semibold transition-colors ${palette} ${className}`}
      >
        {active || starting ? <Square className="w-4 h-4 fill-current" aria-hidden="true" /> : <Mic className="w-4 h-4" aria-hidden="true" />}
        {active ? 'Listening… tap to stop' : starting ? 'Starting…' : idleText}
        {active && <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" aria-hidden="true" />}
      </button>
      {dictation.label === label && dictation.error && <span role="alert" className="text-xs text-red-500">{dictation.error}</span>}
      {active && dictation.interim && <span className="text-xs italic opacity-70 max-w-xs" aria-live="polite">{dictation.interim}</span>}
    </span>
  );
}

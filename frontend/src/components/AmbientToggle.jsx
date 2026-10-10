import React from 'react';
import { Gem } from 'lucide-react';
import { useAmbientPrefs } from '../lib/ambientPrefs';

/**
 * One-tap switch for the blockchain background: a gem icon, lit when the background is on and struck through when it
 * is off. It flips the same saved setting as Settings > Appearance (lib/ambientPrefs), so every page, the chart's own
 * diamond backdrop and any other open tab follow at once. Fine-tuning (style, strength, motion) stays in Settings.
 *
 *   className     the button's classes (so it can sit in any header and match its neighbours)
 *   iconClass     classes for the icon while the background is on
 *   offIconClass  classes for the icon while it is off
 */
export default function AmbientToggle({ className = '', iconClass = '', offIconClass = '' }) {
  const [prefs, update] = useAmbientPrefs();
  const on = prefs.enabled;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="Blockchain background"
      title={`Blockchain background is ${on ? 'on' : 'off'}. Tap to turn it ${on ? 'off' : 'on'}.`}
      onClick={() => update({ enabled: !on })}
      className={className}
    >
      <span className="relative inline-flex">
        <Gem className={`h-5 w-5 transition-opacity ${on ? iconClass : `${offIconClass || iconClass} opacity-60`}`} aria-hidden="true" />
        {!on && <span aria-hidden="true" className="absolute left-[-2px] right-[-2px] top-1/2 h-[2px] -translate-y-1/2 -rotate-45 rounded bg-current" />}
      </span>
    </button>
  );
}

import React from 'react';
import IcanDiamond from './IcanDiamond';

/**
 * The loading indicator for Pitchin and Status (feed buffering, recording,
 * watermarking, upload) — the same turning diamond as the IcanEra opening.
 * See IcanDiamond.jsx; the cut and palette live in diamondArt.js.
 *
 * Pitchin and Status sit on dark video / ebony surfaces whatever the app
 * theme is, so the stone is dressed for a dark ground by default.
 *
 * @param {number} size - pixel size of the stone's box
 * @param {string} label - optional caption shown under the stone
 * @param {number|null} progress - optional 0-100, shown as "NN%" under it
 * @param {'dark'|'light'} tone - override the dark-ground default
 */
const DiamondLoader = ({ size = 56, label = '', progress = null, className = '', tone = 'dark' }) => (
  <div className={`flex flex-col items-center justify-center gap-3 select-none ${className}`} role="status" aria-live="polite">
    <IcanDiamond size={size} tone={tone} />
    {(label || progress !== null) && (
      <div className="text-center">
        {label && <p className="text-sm text-white/80 font-medium tracking-wide">{label}</p>}
        {progress !== null && (
          <p className="text-xs text-white/50 font-mono mt-0.5">{Math.round(progress)}%</p>
        )}
      </div>
    )}
  </div>
);

export default DiamondLoader;

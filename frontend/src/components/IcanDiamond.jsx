import React, { forwardRef } from 'react';
import {
  FACETS, FIRE_IDS, SILHOUETTE, VIEW_W, VIEW_H, TABLE_GLINT_POINTS,
  facetPoints, facetGradientId, installDiamondStyles,
} from './diamondArt';
import './diamond.css';

/**
 * The IcanEra diamond.
 *
 * <IcanDiamond size={148} />   the opening: a stone that turns, floats and
 *                              throws fire, with a glow, glints and a floor
 *                              shadow that narrows as it turns edge-on.
 * <DiamondSpinner size={16} /> the same stone as a drop-in for lucide's
 *                              Loader / Loader2 (see src/lib/lucide-react.js).
 *
 * Every stone is two cuts set at 90° so that whenever one turns edge-on the
 * other faces the viewer — it always reads as a solid, never a sliver.
 *
 * Colours live in diamond.css / diamondArt.js (not Tailwind), because the
 * app-wide theme override repaints Tailwind colour utilities.
 */

const SPARKLE = 'M12 0 L14 10 L24 12 L14 14 L12 24 L10 14 L0 12 L10 10 Z';
const SPARKLES = [
  { cls: 'ican-gem__spark--a', style: { top: '-3%', left: '6%', width: '12%' } },
  { cls: 'ican-gem__spark--b', style: { top: '14%', right: '-6%', width: '9%' } },
  { cls: 'ican-gem__spark--c', style: { bottom: '22%', left: '-7%', width: '8%' } },
];

const Face = ({ mirrored = false }) => (
  <svg
    className={`ican-gem__face${mirrored ? ' ican-gem__face--back' : ''}`}
    viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
    aria-hidden="true"
    focusable="false"
  >
    {FACETS.map((f) => (
      <polygon
        key={f.id}
        points={facetPoints(f.pts)}
        fill={`url(#${facetGradientId(f.id)})`}
        className="ican-gem__facet"
      />
    ))}
    {/* spectral fire sweeping across the prismatic facets */}
    <g clipPath="url(#icg-clip-fire)">
      <rect className="ican-gem__fire" x="-150" y="0" width="420" height={VIEW_H} fill="url(#icg-fire)" />
    </g>
    {/* a glint gliding over the polished surface */}
    <g clipPath="url(#icg-clip-sil)">
      <g className="ican-gem__glint">
        <rect x="-30" y="-8" width="22" height="124" fill="url(#icg-glint)" transform="skewX(-22)" />
      </g>
    </g>
    <polygon points={TABLE_GLINT_POINTS} fill="#fff" opacity="0.9" />
  </svg>
);

const Sparkle = ({ cls, style }) => (
  <svg className={`ican-gem__spark ${cls}`} style={style} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d={SPARKLE} />
  </svg>
);

/**
 * @param {number} size     box size in px
 * @param {'dark'|'light'}  tone  force the edition for a known background;
 *                          default follows the active theme
 * @param {'stage'|'medium'|'mini'} variant  default chosen from size
 */
export const IcanDiamond = ({ size = 56, tone, variant, className = '', style }) => {
  installDiamondStyles();
  const v = variant || (size < 40 ? 'mini' : size < 96 ? 'medium' : 'stage');

  if (v === 'mini') {
    return <DiamondSpinner size={size} spin tone={tone} className={className} style={style} />;
  }

  return (
    <div
      className={`ican-gem ican-gem--${v} ${className}`}
      data-tone={tone}
      style={{ '--gem-s': `${size}px`, ...style }}
      role="img"
      aria-label="Loading"
    >
      <span className="ican-gem__halo" aria-hidden="true" />
      {SPARKLES.slice(0, v === 'stage' ? 3 : 2).map((s) => <Sparkle key={s.cls} {...s} />)}
      <div className="ican-gem__persp">
        <div className="ican-gem__spin">
          {[0, 90].map((angle) => (
            <div key={angle} className="ican-gem__stone" style={{ transform: `rotateY(${angle}deg)`, '--gem-phase': angle ? '-1.4s' : '0s' }}>
              <Face />
              <Face mirrored />
            </div>
          ))}
        </div>
      </div>
      <span className="ican-gem__shadow" aria-hidden="true" />
    </div>
  );
};

/**
 * Drop-in for lucide's Loader / Loader2: same props, same sizing rules
 * (a Tailwind w-4 h-4 wins over `size`). It turns only when asked to the way
 * lucide spinners are — via an `animate-spin` class — so a static Loader icon
 * stays still. `color` / `strokeWidth` are accepted and ignored: a diamond
 * keeps its own colour.
 */
export const DiamondSpinner = forwardRef(function DiamondSpinner(
  { size = 24, className = '', style, spin, tone, color, strokeWidth, absoluteStrokeWidth, ...rest },
  ref
) {
  installDiamondStyles();
  const tokens = String(className || '').split(/\s+/).filter(Boolean);
  const spins = spin ?? tokens.includes('animate-spin');
  const cls = tokens.filter((t) => t !== 'animate-spin').join(' ');
  return (
    <span
      ref={ref}
      aria-hidden="true"
      data-tone={tone}
      data-spin={spins ? 'on' : 'off'}
      className={`ican-gem-mini${cls ? ` ${cls}` : ''}`}
      style={{ '--gem-s': `${size}px`, '--gem-p': `${Math.max(64, size * 6)}px`, ...style }}
      {...rest}
    />
  );
});

export default IcanDiamond;

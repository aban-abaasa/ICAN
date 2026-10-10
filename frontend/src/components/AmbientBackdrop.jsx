import React, { useId, useMemo } from 'react';
import { isDarkFamilyTheme, useOptionalTheme } from '../context/ThemeContext';
import { useAmbientPrefs } from '../lib/ambientPrefs';
import { CHAINS, MINED, VIEW, latticePattern, rhombus } from './BlockchainBackdrop';
import './blockchain.css';
import './ambient.css';

/**
 * The ambient "blockchain" background for the app and the website.
 *
 * The loading pages' lattice of interlocking diamonds, turned down to a whisper
 * and laid over every page: two interlocked lattices that breathe in turn, and
 * (in the "chain" style) chains of blocks that light up one after another with
 * data packets running along the links. It sits over the page rather than behind
 * it because the theme paints an opaque background on almost every screen; it is
 * faint, ignores the pointer, fades toward the middle where the content is, and
 * stays under dialogs (z-index 40, below the z-50 modals).
 *
 * Settings > Appearance > "Blockchain background" switches it off or tunes it.
 *
 * Cost: the lattices are two static SVG layers whose breathing is a plain
 * opacity animation (composited, no repaint); the chain layer is a handful of
 * small shapes. All of it stops with motion off or prefers-reduced-motion.
 */

const COLOURS = {
  // diamond-ice with a little violet on the dark themes; a soft violet on the light ones
  dark: { line: '#a7b4ff', accent: '#b9c6ff', packet: '#f0eeff' },
  light: { line: '#6a5bc0', accent: '#6a5bc0', packet: '#3f3590' },
};
const STRENGTH = { subtle: 0.55, balanced: 1, vivid: 1.7 };

const CHAIN_COUNT = 4;
const MINED_COUNT = 5;

/** The layers themselves: fixed over the page by default, or `contained` inside a parent (the Settings preview). */
export const AmbientLayers = ({ tone = 'dark', style = 'chain', intensity = 'balanced', motion = true, contained = false }) => {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const c = COLOURS[tone] || COLOURS.dark;
  const ids = useMemo(() => ({ a: `am-a-${uid}`, b: `am-b-${uid}` }), [uid]);
  const showChains = style === 'chain';

  return (
    <div
      className={`am-root${contained ? ' am-root--contained' : ''}`}
      data-motion={motion ? 'on' : 'off'}
      style={{ '--am-k': STRENGTH[intensity] ?? 1 }}
      aria-hidden="true"
    >
      <div className="am-mask">
        <svg className="am-lat am-lat--a" viewBox={`0 0 ${VIEW} ${VIEW}`} preserveAspectRatio="xMidYMid slice" focusable="false">
          <defs>{latticePattern(ids.a, c.line, 0.3, c.line, 0.07, true, 'A')}</defs>
          <rect width={VIEW} height={VIEW} fill={`url(#${ids.a})`} />
        </svg>
        <svg className="am-lat am-lat--b" viewBox={`0 0 ${VIEW} ${VIEW}`} preserveAspectRatio="xMidYMid slice" focusable="false">
          <defs>{latticePattern(ids.b, c.line, 0.3, c.line, 0.07, true, 'B')}</defs>
          <rect width={VIEW} height={VIEW} fill={`url(#${ids.b})`} />
        </svg>

        {showChains && (
          <svg className="am-chains" viewBox={`0 0 ${VIEW} ${VIEW}`} preserveAspectRatio="xMidYMid slice" focusable="false">
            {MINED.slice(0, MINED_COUNT).map(([x, y], i) => (
              <g key={`m${x}-${y}`}>
                <path className="bc-pulse" style={{ '--d': (i * 1.3) % 6 }} d={rhombus(x, y)} fill={c.accent} fillOpacity="0.16" stroke={c.accent} strokeWidth="1.4" strokeLinejoin="round" />
                <path className="bc-packet" pathLength="100" style={{ '--d': (i * 0.7) % 4 }} d={rhombus(x, y)} stroke={c.accent} strokeWidth="2" strokeLinejoin="round" />
              </g>
            ))}
            {CHAINS.slice(0, CHAIN_COUNT).map((chain, ci) => {
              const d = chain.nodes.map((n, i) => `${i ? 'L' : 'M'}${n.x} ${n.y}`).join('');
              return (
                <g key={`ch${ci}`}>
                  <path className="bc-link" d={d} stroke={c.accent} strokeWidth="1.2" strokeDasharray="3 5" />
                  <path className="bc-packet bc-packet--long" pathLength="100" style={{ '--d': ci * 0.9 }} d={d} stroke={c.packet} strokeWidth="2" />
                  {chain.nodes.map((n, i) => (
                    <path
                      key={i}
                      className="bc-node"
                      style={{ '--i': i + ci * 2 }}
                      d={rhombus(n.x, n.y, 11)}
                      fill={c.accent}
                      stroke={c.accent}
                      strokeWidth="1.5"
                      strokeLinejoin="round"
                    />
                  ))}
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </div>
  );
};

/**
 * Mounted once for every page that uses the app theme (the website's landing and sign-in pages, pricing, share pages
 * and the signed-in app): reads the visitor's setting and the active theme. Business-owned pages (notice boards,
 * stores) keep their own look and do not get it.
 */
export default function AmbientBackdrop() {
  const { actualTheme } = useOptionalTheme();
  const [prefs] = useAmbientPrefs();

  if (!prefs.enabled) return null;
  return (
    <AmbientLayers
      tone={isDarkFamilyTheme(actualTheme) ? 'dark' : 'light'}
      style={prefs.style}
      intensity={prefs.intensity}
      motion={prefs.motion}
    />
  );
}

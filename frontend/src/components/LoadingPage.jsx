import React from 'react';
import IcanDiamond from './IcanDiamond';
import {
  BlockchainBackdrop, BlockChainProgress, BACKDROP_PALETTES, useIsDarkTheme,
} from './BlockchainBackdrop';
import BlockLedger from './BlockLedger';

/**
 * The full-page loading state for the app's standalone and gated pages: the
 * IcanEra diamond over a lattice of interlocking blockchain diamonds, with a
 * live hash chain of woven diamond blocks (see BlockLedger.jsx) in front.
 *
 * The opening splash (SplashScreen.jsx) is the editorial edition of the same
 * artwork; this is the plain one for everything else.
 *
 * @param {string} label      main line under the stone
 * @param {string} sublabel   optional smaller line
 * @param {number|null} progress  optional 0-100; the chain fills instead of cycling
 * @param {'light'|'dark'|'ice'} tone  default follows the active theme (light /
 *        dark); pass 'ice' for the dark slate standalone pages
 * @param {string} bg         optional 6-digit hex ground, to match a page's own
 * @param {boolean} fixed     cover the viewport (position: fixed) instead of
 *                            sitting in the flow
 * @param {string} minHeight  height of the in-flow page (default a full screen;
 *                            pass e.g. '60vh' for a panel)
 * @param {boolean} compact   a smaller stone, for panels
 */
const LoadingPage = ({
  label = 'Loading…', sublabel = '', progress = null, tone, bg, fixed = false, minHeight = '100vh', compact = false, className = '', style,
}) => {
  const isDark = useIsDarkTheme();
  const resolved = tone || (isDark ? 'dark' : 'light');
  const p = BACKDROP_PALETTES[resolved] || BACKDROP_PALETTES.light;
  const ground = bg || p.bg;

  const frame = fixed
    ? { position: 'fixed', inset: 0, zIndex: 9000 }
    : { position: 'relative', width: '100%', minHeight };

  return (
    <div
      className={`ican-loading-page ${className}`}
      role="status"
      aria-live="polite"
      aria-busy="true"
      style={{
        ...frame,
        display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
        background: ground, color: p.ink,
        fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        ...style,
      }}
    >
      <BlockchainBackdrop tone={resolved} bg={ground} />

      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.1rem', padding: '1.5rem', textAlign: 'center' }}>
        <IcanDiamond size={compact ? 84 : 116} tone={resolved === 'light' ? 'light' : 'dark'} />

        <div>
          <p style={{ margin: 0, fontSize: '1rem', fontWeight: 600, letterSpacing: '0.02em', color: p.ink }}>{label}</p>
          {sublabel && <p style={{ margin: '0.3rem 0 0', fontSize: '0.8rem', color: p.muted }}>{sublabel}</p>}
        </div>

        {/* a real hash chain: each block commits to the one before it */}
        <BlockLedger tone={resolved} bg={ground} count={compact ? 3 : 4} />
        {progress !== null && (
          <>
            <BlockChainProgress progress={progress} tone={resolved} />
            <p style={{ margin: '-0.4rem 0 0', fontSize: '0.75rem', fontVariantNumeric: 'tabular-nums', color: p.muted }}>{Math.round(progress)}%</p>
          </>
        )}
      </div>
    </div>
  );
};

export default LoadingPage;

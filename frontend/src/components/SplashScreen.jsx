import React, { useEffect, useRef, useState } from 'react';
import IcanDiamond from './IcanDiamond';
import { BlockchainBackdrop, useIsDarkTheme as useIsDark } from './BlockchainBackdrop';
import BlockLedger from './BlockLedger';

/**
 * Splash / loading screen -- classic edition with a rotating diamond.
 *
 * Used two ways:
 *  - <SplashScreen show duration onHide/> : the timed overlay shown during
 *    app transitions (auto-hides after `duration`).
 *  - <ClassicLoadingScreen/> : the same artwork as an in-flow, full-screen
 *    loading state (App.jsx's "checking your session" screen).
 *
 * Behind it all sits the blockchain lattice -- interlocking diamonds with
 * chains of blocks lighting up and data packets running (BlockchainBackdrop),
 * and in front a live hash chain of woven diamond blocks (BlockLedger).
 *
 * Colours are inline on purpose: the global theme override sheet repaints
 * Tailwind gradient/slate classes, which is what washed the old splash out to
 * a white page in light themes. The look follows the active theme family --
 * ivory paper by day, warm ink and amber by night -- matching the landing page.
 */

const PALETTES = {
  light: {
    bg: '#f6f1e4',
    ink: '#1f1a12',
    muted: '#6b5f49',
    accent: '#14532d',
    brass: '#8a6a1f',
    rule: 'rgba(31, 26, 18, 0.45)',
  },
  dark: {
    bg: '#0f0d0a',
    ink: '#f6f1e4',
    muted: '#bfb49a',
    accent: '#fcd34d',
    brass: '#fcd34d',
    rule: 'rgba(252, 211, 77, 0.5)',
  },
};

const SplashArt = () => {
  const isDark = useIsDark();
  const c = isDark ? PALETTES.dark : PALETTES.light;
  const year = new Date().getFullYear();

  return (
    <div
      className="ican-splash-root"
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: c.bg,
        color: c.ink,
        fontFamily: "Georgia, 'Iowan Old Style', 'Palatino Linotype', 'Times New Roman', serif",
        overflow: 'hidden',
      }}
    >
      <style>{`
        @keyframes icanFade { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
        .ican-splash-in { animation: icanFade .8s cubic-bezier(.22,1,.36,1) both; }
        @media (prefers-reduced-motion: reduce) {
          .ican-splash-in { animation: none !important; }
        }
      `}</style>

      <BlockchainBackdrop tone={isDark ? 'dark' : 'light'} />

      <div style={{ position: 'relative', zIndex: 1, width: 'min(92vw, 30rem)', textAlign: 'center', padding: '1.5rem' }}>
        {/* masthead rule */}
        <div
          className="ican-splash-in"
          style={{
            display: 'flex', justifyContent: 'space-between', gap: '0.75rem',
            borderTop: `3px double ${c.rule}`, borderBottom: `3px double ${c.rule}`,
            padding: '0.4rem 0', fontSize: '0.68rem', fontWeight: 600, letterSpacing: '0.2em',
            textTransform: 'uppercase', color: c.brass,
          }}
        >
          <span>Vol. I</span>
          <span>Est. on the blockchain</span>
        </div>

        {/* the IcanEra diamond — the same stone every loader in the app uses */}
        <div style={{ display: 'flex', justifyContent: 'center', margin: '2.25rem auto 1.25rem' }}>
          <IcanDiamond size={148} tone={isDark ? 'dark' : 'light'} />
        </div>

        <h1
          className="ican-splash-in"
          style={{
            margin: 0, fontFamily: "'Playfair Display', Georgia, 'Times New Roman', serif",
            fontSize: 'clamp(2.4rem, 9vw, 3.4rem)', fontWeight: 700, fontStyle: 'italic',
            letterSpacing: '-0.01em', color: c.accent, animationDelay: '0.1s',
          }}
        >
          IcanEra
        </h1>
        <p
          className="ican-splash-in"
          style={{
            margin: '0.5rem auto 0', width: 'fit-content', borderTop: `1px solid ${c.rule}`, paddingTop: '0.4rem',
            fontSize: '0.72rem', fontWeight: 600, letterSpacing: '0.22em', textTransform: 'uppercase',
            color: c.muted, animationDelay: '0.2s',
          }}
        >
          Business Management Platform
        </p>

        {/* a real hash chain: each block commits to the one before it */}
        <div style={{ margin: '1.75rem auto 0' }}>
          <BlockLedger tone={isDark ? 'dark' : 'light'} />
        </div>
        <p style={{ margin: '0.9rem 0 0', fontSize: '0.9rem', fontStyle: 'italic', color: c.muted }}>
          Loading your financial universe…
        </p>

        <p style={{ margin: '2rem 0 0', fontSize: '0.68rem', letterSpacing: '0.12em', color: c.muted, opacity: 0.8 }}>
          © {year} IcanEra · Global money &amp; business
        </p>
      </div>
    </div>
  );
};

// If the full-screen loader is still up after this long, something is stalled
// (usually a slow connection); offer a way out instead of an endless wait.
const STALLED_AFTER_MS = 12000;

/** Full-screen, in-flow loading state. Offers a reload if it stays up too long. */
export function ClassicLoadingScreen() {
  const [stalled, setStalled] = useState(false);
  const isDark = useIsDark();

  useEffect(() => {
    const timer = setTimeout(() => setStalled(true), STALLED_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);

  const c = isDark ? PALETTES.dark : PALETTES.light;

  return (
    <div style={{ minHeight: '100vh', position: 'relative' }}>
      <SplashArt />
      {stalled && (
        <div
          role="status"
          style={{
            position: 'absolute', left: 0, right: 0, bottom: '2.5rem', zIndex: 2, textAlign: 'center',
            fontFamily: "Georgia, 'Times New Roman', serif", color: c.muted, fontSize: '0.85rem',
          }}
        >
          Still loading… slow connection?{' '}
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: c.accent,
              fontFamily: 'inherit', fontSize: 'inherit', fontWeight: 700, textDecoration: 'underline',
            }}
          >
            Reload
          </button>
        </div>
      )}
    </div>
  );
}

export function SplashScreen({ duration = 2000, show = true, onHide }) {
  const [visible, setVisible] = useState(show);
  // App passes a fresh inline onHide on every render; keeping it in a ref stops
  // each re-render from restarting the timer, which could leave this overlay
  // covering the sign-in / landing page indefinitely.
  const onHideRef = useRef(onHide);
  onHideRef.current = onHide;

  useEffect(() => {
    if (!show) {
      setVisible(false);
      return undefined;
    }

    setVisible(true);
    const timer = setTimeout(() => {
      setVisible(false);
      onHideRef.current?.();
    }, duration);

    return () => clearTimeout(timer);
  }, [show, duration]);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[9999]" role="status" aria-live="polite">
      <SplashArt />
    </div>
  );
}

export default SplashScreen;

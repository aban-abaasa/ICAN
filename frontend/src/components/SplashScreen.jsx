import React, { useEffect, useRef, useState } from 'react';
import IcanDiamond from './IcanDiamond';

/**
 * Splash / loading screen -- classic edition with a rotating diamond.
 *
 * Used two ways:
 *  - <SplashScreen show duration onHide/> : the timed overlay shown during
 *    app transitions (auto-hides after `duration`).
 *  - <ClassicLoadingScreen/> : the same artwork as an in-flow, full-screen
 *    loading state (App.jsx's "checking your session" screen).
 *
 * Colours are inline on purpose: the global theme override sheet repaints
 * Tailwind gradient/slate classes, which is what washed the old splash out to
 * a white page in light themes. The look follows the active theme family --
 * ivory paper by day, warm ink and amber by night -- matching the landing page.
 */

const DARK_THEMES = ['dark', 'purple', 'green', 'ocean', 'sienna'];

// Read from <html data-theme> (set by ThemeContext) so this works even when
// rendered outside the ThemeProvider.
const useIsDark = () => {
  const read = () => {
    try {
      const attr = document.documentElement.getAttribute('data-theme');
      if (attr) return DARK_THEMES.includes(attr);
      return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
    } catch {
      return false;
    }
  };
  const [isDark, setIsDark] = useState(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setIsDark(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  return isDark;
};

const PALETTES = {
  light: {
    bg: '#f6f1e4',
    ink: '#1f1a12',
    muted: '#6b5f49',
    accent: '#14532d',
    brass: '#8a6a1f',
    rule: 'rgba(31, 26, 18, 0.45)',
    track: 'rgba(31, 26, 18, 0.12)',
    dots: '#3b2f1e',
  },
  dark: {
    bg: '#0f0d0a',
    ink: '#f6f1e4',
    muted: '#bfb49a',
    accent: '#fcd34d',
    brass: '#fcd34d',
    rule: 'rgba(252, 211, 77, 0.5)',
    track: 'rgba(252, 211, 77, 0.15)',
    dots: '#fcd34d',
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
        .ican-splash-root::before {
          content: ''; position: absolute; inset: 0; pointer-events: none; opacity: 0.07;
          background-image: radial-gradient(${c.dots} 0.6px, transparent 0.6px); background-size: 14px 14px;
        }
        @keyframes icanBar { 0% { transform: translateX(-100%); } 100% { transform: translateX(260%); } }
        @keyframes icanFade { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
        .ican-splash-in { animation: icanFade .8s cubic-bezier(.22,1,.36,1) both; }
        @media (prefers-reduced-motion: reduce) {
          .ican-splash-bar, .ican-splash-in { animation: none !important; }
        }
      `}</style>

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

        {/* ruled progress track */}
        <div
          role="progressbar"
          aria-label="Loading"
          style={{ position: 'relative', overflow: 'hidden', height: 4, margin: '2rem auto 0', width: 'min(70%, 15rem)', background: c.track }}
        >
          <div
            className="ican-splash-bar"
            style={{ position: 'absolute', top: 0, left: 0, height: '100%', width: '38%', background: c.accent, animation: 'icanBar 1.6s ease-in-out infinite' }}
          />
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

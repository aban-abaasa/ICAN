import React, { useEffect, useRef, useState } from 'react';

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
    gem: ['#ffffff', '#dff1f7', '#b9dcec', '#8fc3dc', '#5ea3c4', '#3b7ea3'],
    gemEdge: '#1f1a12',
    glow: 'rgba(20, 83, 45, 0.22)',
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
    gem: ['#ffffff', '#eaf6fb', '#c5e4f2', '#93c9e3', '#5fa8cc', '#3d83ab'],
    gemEdge: '#fcd34d',
    glow: 'rgba(252, 211, 77, 0.25)',
  },
};

// Facet shapes of a brilliant-cut stone, viewed from the side.
const FACETS = [
  { points: '30,10 90,10 78,36 42,36', tone: 0 }, // table
  { points: '30,10 6,36 42,36', tone: 2 }, // crown left
  { points: '90,10 114,36 78,36', tone: 3 }, // crown right
  { points: '6,36 42,36 60,92', tone: 3 }, // pavilion left
  { points: '42,36 78,36 60,92', tone: 1 }, // pavilion centre
  { points: '78,36 114,36 60,92', tone: 4 }, // pavilion right
];

const Gem = ({ colors, edge, mirrored = false }) => (
  <svg
    viewBox="0 0 120 100"
    width="100%"
    height="100%"
    style={{
      position: 'absolute',
      inset: 0,
      backfaceVisibility: 'hidden',
      WebkitBackfaceVisibility: 'hidden',
      transform: mirrored ? 'rotateY(180deg)' : 'none',
    }}
    aria-hidden="true"
  >
    {FACETS.map((f, i) => (
      <polygon key={i} points={f.points} fill={colors[f.tone]} stroke={edge} strokeWidth="1.6" strokeLinejoin="round" />
    ))}
    {/* highlight glint on the table */}
    <polygon points="36,14 56,14 50,30 40,30" fill="#ffffff" opacity="0.7" />
  </svg>
);

const Sparkle = ({ style, color }) => (
  <svg className="ican-splash-sparkle" viewBox="0 0 24 24" width="18" height="18" style={style} aria-hidden="true">
    <path d="M12 0 L14 10 L24 12 L14 14 L12 24 L10 14 L0 12 L10 10 Z" fill={color} />
  </svg>
);

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
        @keyframes icanGemSpin { from { transform: rotateY(0deg); } to { transform: rotateY(360deg); } }
        @keyframes icanGemFlash { 0%, 100% { filter: brightness(1); } 25%, 75% { filter: brightness(1.18); } 50% { filter: brightness(0.92); } }
        @keyframes icanGemShadow { 0%, 100% { transform: scaleX(1); opacity: .35; } 25%, 75% { transform: scaleX(.22); opacity: .18; } 50% { transform: scaleX(1); opacity: .35; } }
        @keyframes icanGemFloat { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
        @keyframes icanSparkle { 0%, 100% { opacity: 0; transform: scale(.3) rotate(0deg); } 50% { opacity: 1; transform: scale(1) rotate(45deg); } }
        @keyframes icanBar { 0% { transform: translateX(-100%); } 100% { transform: translateX(260%); } }
        @keyframes icanFade { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
        .ican-splash-gem { animation: icanGemSpin 3.6s linear infinite; transform-style: preserve-3d; }
        .ican-splash-persp { animation: icanGemFloat 3.6s ease-in-out infinite, icanGemFlash 3.6s ease-in-out infinite; }
        .ican-splash-sparkle { position: absolute; animation: icanSparkle 2.4s ease-in-out infinite; }
        .ican-splash-in { animation: icanFade .8s cubic-bezier(.22,1,.36,1) both; }
        @media (prefers-reduced-motion: reduce) {
          .ican-splash-gem, .ican-splash-persp, .ican-splash-sparkle, .ican-splash-bar, .ican-splash-in { animation: none !important; }
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

        {/* rotating diamond */}
        <div style={{ position: 'relative', margin: '2.25rem auto 0.5rem', width: 148, height: 148 }}>
          <div
            aria-hidden="true"
            style={{
              position: 'absolute', inset: '-18px', borderRadius: '50%',
              background: `radial-gradient(circle, ${c.glow} 0%, transparent 68%)`,
            }}
          />
          <Sparkle color={c.brass} style={{ top: -6, left: 8, animationDelay: '0s' }} />
          <Sparkle color={c.accent} style={{ top: 18, right: -10, animationDelay: '0.8s', width: 14, height: 14 }} />
          <Sparkle color={c.brass} style={{ bottom: 30, left: -12, animationDelay: '1.5s', width: 12, height: 12 }} />
          <div className="ican-splash-persp" style={{ perspective: 700, width: '100%', height: '100%' }}>
            <div className="ican-splash-gem" style={{ position: 'relative', width: '100%', height: '100%' }}>
              {/* two stones set at 90 degrees: when one turns edge-on the other
                  faces the viewer, so the diamond always reads as solid */}
              {[0, 90].map((angle) => (
                <div key={angle} style={{ position: 'absolute', inset: 0, transformStyle: 'preserve-3d', transform: `rotateY(${angle}deg)` }}>
                  <Gem colors={c.gem} edge={c.gemEdge} />
                  <Gem colors={c.gem} edge={c.gemEdge} mirrored />
                </div>
              ))}
            </div>
          </div>
        </div>
        {/* floor shadow that narrows when the stone turns edge-on */}
        <div
          aria-hidden="true"
          style={{
            width: 96, height: 10, margin: '0 auto 1.5rem', borderRadius: '50%',
            background: c.ink, filter: 'blur(5px)', animation: 'icanGemShadow 3.6s ease-in-out infinite',
          }}
        />

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

/** Full-screen, in-flow loading state (no timer). */
export function ClassicLoadingScreen() {
  return (
    <div style={{ minHeight: '100vh' }}>
      <SplashArt />
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

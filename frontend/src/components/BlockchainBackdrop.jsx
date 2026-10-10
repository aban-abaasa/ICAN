import React, { useEffect, useId, useMemo, useState } from 'react';
import './blockchain.css';

/**
 * Blockchain backdrop for every loading page: a lattice of interlocking
 * diamonds.
 *
 * Each diamond ("block") is larger than the grid step, so it overlaps its
 * neighbours the way links overlap in chain mail; a second lattice offset by
 * half a step is woven through the first. On top of that mesh:
 *   - a band of light sweeps through the diamonds,
 *   - chains of blocks light up one after another, with a data packet running
 *     along the link between them,
 *   - a few blocks are "mined" (glow, then settle) and send a packet round
 *     their edge,
 *   - hashes drift up through the lattice.
 *
 * It is decoration only (aria-hidden) and fills its positioned parent.
 * Colours are CSS variables set inline, not Tailwind classes, because the
 * app-wide theme override repaints those. See blockchain.css for the motion.
 *
 * `bg` overrides the palette's ground colour and must be a 6-digit hex.
 */

const VIEW = 1200;   // square viewBox, scaled with "slice" so it always covers
const STEP = 72;     // lattice step
const HALF = STEP / 2;
const R = 50;        // block half-diagonal; R > STEP/2 is what makes them interlock

export const BACKDROP_PALETTES = {
  // ivory paper and forest green, with the diamond's violet in the lines — the editorial splash by day
  light: {
    bg: '#f6f1e4', ink: '#1f1a12', muted: '#6b5f49', accent: '#14532d', brass: '#6a5bc0',
    line: '#6a5bc0', lineAlpha: 0.22, fillAlpha: 0.04,
  },
  // diamond: cool ice-white with a little violet, on violet-tinged ink — the same splash by night
  dark: {
    bg: '#0b0a14', ink: '#f0eeff', muted: '#aeaad0', accent: '#b9c6ff', brass: '#c9b6ff',
    line: '#a7b4ff', lineAlpha: 0.22, fillAlpha: 0.035,
  },
  // cool ice on slate — for the dark standalone pages (payments, public links)
  ice: {
    bg: '#050914', ink: '#e8eefc', muted: '#8fa3c7', accent: '#7dd3fc', brass: '#a5b4fc',
    line: '#7aa2ff', lineAlpha: 0.22, fillAlpha: 0.03,
  },
};

const DARK_THEMES = ['dark', 'purple', 'green', 'ocean', 'sienna'];

/**
 * Whether the app is currently in a dark theme. Reads <html data-theme> (set by
 * ThemeContext) so it works outside the ThemeProvider too.
 */
export const useIsDarkTheme = () => {
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

const rhombus = (cx, cy, r = R) => `M${cx} ${cy - r}L${cx + r} ${cy}L${cx} ${cy + r}L${cx - r} ${cy}Z`;

// Chains of linked blocks: a start point on the lattice and a zig-zag of
// half-steps, so consecutive blocks sit on alternating (interlocked) lattices.
const CHAINS = [
  { x: 144, y: 216, dir: 1, n: 8 },
  { x: 936, y: 288, dir: -1, n: 7 },
  { x: 288, y: 936, dir: 1, n: 7 },
  { x: 1008, y: 936, dir: -1, n: 8 },
  { x: 576, y: 72, dir: 1, n: 5 },
  { x: 648, y: 1152, dir: -1, n: 5 },
].map((c) => ({
  ...c,
  // zig-zag: even nodes on one row, odd nodes half a step below it
  nodes: Array.from({ length: c.n }, (_, i) => ({ x: c.x + c.dir * HALF * i, y: c.y + (i % 2 ? HALF : 0) })),
}));

// Blocks that get "mined" — glow and send a packet round their edge.
const MINED = [
  [216, 576], [1008, 576], [504, 360], [720, 792], [72, 1008], [1152, 144], [432, 1080], [864, 72],
];

const HASHES = [
  ['0x9f3a…c41e', 8, 14], ['0x00c7…a9b2', 70, 22], ['0x5e1d…07f8', 16, 70], ['0xb42c…e611', 78, 78],
  ['0x7a90…3d5b', 40, 8], ['0x01ef…88a4', 52, 90], ['0xd6b3…2c9f', 4, 44], ['0x3c58…f10d', 90, 46],
  ['0xa17e…6b03', 28, 32], ['0x8d42…bb7a', 62, 62],
];

// `sets`: 'A' / 'B' draw one of the two interlocked lattices, 'both' the weave.
const latticePattern = (id, stroke, strokeOpacity, fill, fillOpacity, withNodes, sets = 'both') => {
  const A = [0, STEP];
  const B = [-HALF, HALF, STEP + HALF];
  const shapes = [];
  if (sets !== 'B') A.forEach((x) => A.forEach((y) => shapes.push(<path key={`a${x}-${y}`} d={rhombus(x, y)} />)));
  if (sets !== 'A') B.forEach((x) => B.forEach((y) => shapes.push(<path key={`b${x}-${y}`} d={rhombus(x, y)} />)));
  return (
    <pattern id={id} width={STEP} height={STEP} patternUnits="userSpaceOnUse">
      <g fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeOpacity={strokeOpacity} strokeWidth="1" strokeLinejoin="round">
        {shapes}
      </g>
      {withNodes && (
        <g fill={stroke} fillOpacity={strokeOpacity * 2.2}>
          {sets !== 'B' && A.map((x) => A.map((y) => <path key={`n${x}-${y}`} d={rhombus(x, y, 3.4)} />))}
          {sets !== 'A' && B.map((x) => B.map((y) => <circle key={`c${x}-${y}`} cx={x} cy={y} r="1.5" />))}
        </g>
      )}
    </pattern>
  );
};

export const BlockchainBackdrop = ({ tone = 'light', bg, className = '' }) => {
  const p = BACKDROP_PALETTES[tone] || BACKDROP_PALETTES.light;
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const ids = useMemo(() => ({
    baseA: `bc-base-a-${uid}`, baseB: `bc-base-b-${uid}`, lit: `bc-lit-${uid}`, grad: `bc-grad-${uid}`, mask: `bc-mask-${uid}`,
  }), [uid]);
  const ground = bg || p.bg;

  const vars = {
    '--bc-bg': ground,
    '--bc-bg-soft': `${ground}d9`,
    '--bc-accent': p.accent,
    '--bc-ink': p.ink,
    '--bc-muted': p.muted,
  };

  return (
    <div className={`bc-backdrop ${className}`} style={vars} aria-hidden="true">
      <svg className="bc-backdrop__svg" viewBox={`0 0 ${VIEW} ${VIEW}`} preserveAspectRatio="xMidYMid slice" focusable="false">
        <defs>
          {latticePattern(ids.baseA, p.line, p.lineAlpha * 1.5, p.line, p.fillAlpha, true, 'A')}
          {latticePattern(ids.baseB, p.line, p.lineAlpha * 1.5, p.line, p.fillAlpha, true, 'B')}
          {latticePattern(ids.lit, p.accent, 0.95, p.accent, 0.1, false)}
          <linearGradient id={ids.grad} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#fff" stopOpacity="0" />
            <stop offset="0.5" stopColor="#fff" stopOpacity="1" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <mask id={ids.mask} maskUnits="userSpaceOnUse" x="0" y="0" width={VIEW} height={VIEW}>
            {/* a slanted band of light; slides across the whole mesh */}
            <g transform={`skewX(-24)`}>
              <rect className="bc-sweep" x="-300" y="-200" width="520" height={VIEW + 400} fill={`url(#${ids.grad})`} />
            </g>
          </mask>
        </defs>

        {/* the two interlocked lattices: they take turns fading in and out, so
            the weave never sits still */}
        <rect className="bc-breathe" x="0" y="0" width={VIEW} height={VIEW} fill={`url(#${ids.baseA})`} />
        <rect className="bc-breathe bc-breathe--b" x="0" y="0" width={VIEW} height={VIEW} fill={`url(#${ids.baseB})`} />
        {/* …lit up where the band of light passes */}
        <rect x="0" y="0" width={VIEW} height={VIEW} fill={`url(#${ids.lit})`} mask={`url(#${ids.mask})`} />

        {/* mined blocks */}
        {MINED.map(([x, y], i) => (
          <g key={`m${x}-${y}`}>
            <path className="bc-pulse" style={{ '--d': (i * 0.9) % 6 }} d={rhombus(x, y)} fill={p.accent} fillOpacity="0.16" stroke={p.accent} strokeWidth="1.4" strokeLinejoin="round" />
            <path className="bc-packet" pathLength="100" style={{ '--d': (i * 0.55) % 4 }} d={rhombus(x, y)} stroke={p.accent} strokeWidth="2.2" strokeLinejoin="round" />
          </g>
        ))}

        {/* chains of linked blocks */}
        {CHAINS.map((chain, ci) => {
          const d = chain.nodes.map((n, i) => `${i ? 'L' : 'M'}${n.x} ${n.y}`).join('');
          return (
            <g key={`ch${ci}`}>
              <path className="bc-link" d={d} stroke={p.accent} strokeWidth="1.2" strokeDasharray="3 5" />
              <path className="bc-packet bc-packet--long" pathLength="100" style={{ '--d': ci * 0.8 }} d={d} stroke={p.ink} strokeWidth="2" />
              {chain.nodes.map((n, i) => (
                <path
                  key={i}
                  className="bc-node"
                  style={{ '--i': i + ci * 2 }}
                  d={rhombus(n.x, n.y, 11)}
                  fill={p.accent}
                  stroke={p.accent}
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
              ))}
            </g>
          );
        })}
      </svg>

      {HASHES.map(([text, left, top], i) => (
        <span key={text} className="bc-hash" style={{ left: `${left}%`, top: `${top}%`, '--d': i * 0.9 }}>{text}</span>
      ))}

      <div className="bc-backdrop__veil" />
    </div>
  );
};

/**
 * A chain of blocks as a progress indicator. Without `progress` the blocks
 * light up one after another, forever; with a 0–100 `progress` they fill in.
 */
export const BlockChainProgress = ({ progress = null, count = 7, tone = 'light', className = '' }) => {
  const p = BACKDROP_PALETTES[tone] || BACKDROP_PALETTES.light;
  const lit = progress === null ? 0 : Math.round((Math.max(0, Math.min(100, progress)) / 100) * count);
  const items = [];
  for (let i = 0; i < count; i += 1) {
    if (i) items.push(<span key={`l${i}`} className="bc-chain__link" style={{ '--i': i }} data-lit={progress !== null && i < lit} />);
    items.push(
      <svg key={`b${i}`} className="bc-chain__block" viewBox="0 0 24 24" style={{ '--i': i }} data-lit={progress !== null && i < lit} aria-hidden="true" focusable="false">
        <path d="M12 2L22 12L12 22L2 12Z" />
      </svg>
    );
  }
  return (
    <div
      className={`bc-chain${progress === null ? ' bc-chain--auto' : ''} ${className}`}
      style={{ '--bc-accent': p.accent, '--bc-ink': p.ink }}
      role="progressbar"
      aria-label="Loading"
      aria-valuemin={progress === null ? undefined : 0}
      aria-valuemax={progress === null ? undefined : 100}
      aria-valuenow={progress === null ? undefined : Math.round(progress)}
    >
      {items}
    </div>
  );
};

export default BlockchainBackdrop;

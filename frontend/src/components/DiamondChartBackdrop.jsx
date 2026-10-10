import React, { useId } from 'react';
import { FACETS, FIRE_IDS, SILHOUETTE, VIEW_W, VIEW_H } from './diamondArt';

// The backdrop behind the icaneracoin trading chart: the IcanEra diamond (same cut and facets as the app's
// loader, see diamondArt.js) glowing behind the candles, with a blockchain of small diamond nodes joined by
// chain links, little "transactions" travelling along them, and drifting hash fragments. It is deliberately
// dim -- the candles and trend lines must always out-shine it -- and static for people who prefer reduced motion.

const pts = (list) => list.map((p) => p.join(',')).join(' ');

// Node positions in a 1000 x 600 canvas (the diamond sits in the middle, so nodes ring it).
const NODES = [
  [70, 80], [230, 40], [420, 90], [610, 40], [800, 85], [940, 40],
  [40, 280], [190, 210], [820, 220], [955, 300],
  [80, 500], [250, 560], [430, 520], [600, 565], [790, 510], [935, 545],
];
const EDGES = [
  [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [0, 7], [7, 6], [6, 10], [10, 11], [11, 12], [12, 13], [13, 14], [14, 15],
  [5, 9], [9, 15], [4, 8], [8, 9], [2, 7], [12, 14], [1, 7],
];
const PULSES = [
  { edge: [0, 1], dur: 5.2, delay: 0 },
  { edge: [3, 4], dur: 6.4, delay: 1.3 },
  { edge: [10, 11], dur: 5.8, delay: 2.1 },
  { edge: [13, 14], dur: 7, delay: 0.6 },
  { edge: [8, 9], dur: 4.8, delay: 3 },
  { edge: [6, 10], dur: 6, delay: 1.9 },
];
const HASHES = [
  [60, 150, '0x9f3a…c41e'], [700, 150, 'blk #482,917'], [120, 440, '0x7be2…09d5'],
  [770, 455, 'tx 0xa1c4…77f0'], [455, 40, 'nonce 31337'], [380, 585, '0x2d8c…e6b1'],
];
const FIRE = { c1: '#ff8fd0', c3: '#7fdcff', c5: '#ffd978', c6: '#a98cff', p2: '#8cffcb', p4: '#ff8fd0' };

const PALETTES = {
  dark: {
    bg: ['#10224a', '#07112b', '#020617'], halo: ['#7aa7ff', 0.26, '#4f6fe0'], link: '#7f9bd6', linkOp: 0.16,
    pulse: '#9fd0ff', nodeFill: '#bcd2f5', nodeFillOp: 0.16, nodeStroke: '#cfe0fb', nodeStrokeOp: 0.4,
    hash: '#8aa6dc', hashOp: 0.28, stoneOp: 0.11, stoneEdge: '#d4e2fb', fireMax: 0.15, shade: '#020617', shadeOp: 0.28,
  },
  light: {
    bg: ['#ffffff', '#f1f5fd', '#e2eaf8'], halo: ['#6f8fe8', 0.22, '#7c9ae8'], link: '#5b6f98', linkOp: 0.22,
    pulse: '#3b6fd8', nodeFill: '#7d93c4', nodeFillOp: 0.2, nodeStroke: '#5b6f98', nodeStrokeOp: 0.45,
    hash: '#475569', hashOp: 0.3, stoneOp: 0.2, stoneEdge: '#5b6f98', fireMax: 0.2, shade: '#ffffff', shadeOp: 0.12,
  },
};

const DiamondChartBackdrop = ({ theme = 'dark' }) => {
  const k = PALETTES[theme] || PALETTES.dark;
  const uid = useId().replace(/:/g, '');
  const id = (name) => `icbd-${name}-${uid}`;

  return (
    <div className="icbd pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <style>{`
        @keyframes icbd-fire { 0%,100% { opacity: .02 } 50% { opacity: ${k.fireMax} } }
        @keyframes icbd-breathe { 0%,100% { opacity: .85 } 50% { opacity: 1 } }
        @keyframes icbd-drift { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-5px) } }
        .icbd-fire { opacity: .02; animation: icbd-fire 6s ease-in-out infinite both }
        .icbd-glow { animation: icbd-breathe 7s ease-in-out infinite }
        .icbd-hash { animation: icbd-drift 9s ease-in-out infinite }
        @media (prefers-reduced-motion: reduce) {
          .icbd-fire, .icbd-glow, .icbd-hash { animation: none }
          .icbd-fire { opacity: .06 }
          .icbd-pulse { display: none }
        }
      `}</style>
      <svg viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid slice" className="h-full w-full">
        <defs>
          <radialGradient id={id('bg')} cx="50%" cy="46%" r="75%">
            <stop offset="0" stopColor={k.bg[0]} />
            <stop offset="0.55" stopColor={k.bg[1]} />
            <stop offset="1" stopColor={k.bg[2]} />
          </radialGradient>
          <radialGradient id={id('halo')} cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor={k.halo[0]} stopOpacity={k.halo[1]} />
            <stop offset="0.6" stopColor={k.halo[2]} stopOpacity="0.10" />
            <stop offset="1" stopColor={k.halo[2]} stopOpacity="0" />
          </radialGradient>
          {FACETS.map((f) => (
            <linearGradient key={f.id} id={id(f.id)} x1="0.2" y1="0" x2="0.55" y2="1">
              <stop offset="0" stopColor={f.light} />
              <stop offset="1" stopColor={f.base} />
            </linearGradient>
          ))}
          <polygon id={id('mini')} points={pts(SILHOUETTE)} />
        </defs>

        <rect width="1000" height="600" fill={`url(#${id('bg')})`} />

        {/* chain links between the nodes */}
        <g stroke={k.link} strokeOpacity={k.linkOp} strokeWidth="1" strokeDasharray="2 5">
          {EDGES.map(([a, b]) => (
            <line key={`${a}-${b}`} x1={NODES[a][0]} y1={NODES[a][1]} x2={NODES[b][0]} y2={NODES[b][1]} />
          ))}
        </g>

        {/* transactions travelling the chain */}
        <g className="icbd-pulse">
          {PULSES.map(({ edge: [a, b], dur, delay }) => (
            <circle key={`${a}-${b}`} r="2.4" fill={k.pulse} opacity="0.8">
              <animateMotion
                dur={`${dur}s`}
                begin={`${delay}s`}
                repeatCount="indefinite"
                path={`M${NODES[a][0]},${NODES[a][1]} L${NODES[b][0]},${NODES[b][1]}`}
              />
            </circle>
          ))}
        </g>

        {/* the nodes: little IcanEra diamonds */}
        <g>
          {NODES.map(([x, y], i) => (
            <use
              key={i}
              href={`#${id('mini')}`}
              transform={`translate(${x - 8} ${y - 7}) scale(${i % 3 === 0 ? 0.14 : 0.11})`}
              fill={k.nodeFill}
              fillOpacity={k.nodeFillOp}
              stroke={k.nodeStroke}
              strokeOpacity={k.nodeStrokeOp}
              strokeWidth="6"
            />
          ))}
        </g>

        {/* drifting hashes */}
        <g fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="11" fill={k.hash} fillOpacity={k.hashOp}>
          {HASHES.map(([x, y, text], i) => (
            <text key={text} x={x} y={y} className="icbd-hash" style={{ animationDelay: `${i * 1.1}s` }}>{text}</text>
          ))}
        </g>

        {/* the stone */}
        <g className="icbd-glow" transform="translate(500 300)">
          <circle r="330" fill={`url(#${id('halo')})`} />
          <g transform={`scale(4.5) translate(${-VIEW_W / 2} ${-VIEW_H / 2})`}>
            <g opacity={k.stoneOp}>
              {FACETS.map((f) => (
                <polygon key={f.id} points={pts(f.pts)} fill={`url(#${id(f.id)})`} stroke={k.stoneEdge} strokeOpacity="0.9" strokeWidth="0.35" strokeLinejoin="round" />
              ))}
            </g>
            {FIRE_IDS.map((fid, i) => (
              <polygon
                key={fid}
                points={pts(FACETS.find((f) => f.id === fid).pts)}
                fill={FIRE[fid]}
                className="icbd-fire"
                style={{ animationDelay: `${i * 0.9}s` }}
              />
            ))}
          </g>
        </g>

        {/* vignette keeps the axes and legend readable */}
        <rect width="1000" height="600" fill={k.shade} opacity={k.shadeOp} />
      </svg>
    </div>
  );
};

export default DiamondChartBackdrop;

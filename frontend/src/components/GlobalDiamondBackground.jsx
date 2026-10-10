import React, { useId } from 'react';
import { FACETS, FIRE_IDS, SILHOUETTE, VIEW_W, VIEW_H } from './diamondArt';
import { useDiamondLevel } from '../lib/diamondBackground';

// A faint blockchain-diamond watermark behind every ICAN page, to give the whole product a feeling of value.
// It is line-art only (no fills) so it reads on light and dark pages alike, sits over page backgrounds but under
// menus, sheets and dialogs, never takes a click, and stands still for people who prefer reduced motion.
//   subtle  the default: one large stone in the corner and a thin chain of diamonds
//   rich    a stronger stone with its spectral "fire", more links, travelling transactions and a glint
// Turned off, nothing is rendered at all. Switch it in Settings > Appearance.

const pts = (list) => list.map((p) => p.join(',')).join(' ');

const NODES = [
  [60, 90], [210, 40], [380, 110], [560, 50], [740, 100], [920, 45],
  [30, 300], [170, 230], [840, 240], [965, 330],
  [70, 520], [230, 575], [420, 540], [610, 580], [800, 530], [945, 565],
];
const EDGES = [
  [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [0, 7], [7, 6], [6, 10], [10, 11], [11, 12], [12, 13], [13, 14], [14, 15],
  [5, 9], [9, 15], [4, 8], [8, 9], [2, 7], [12, 14], [1, 7],
];
const PULSES = [
  { edge: [0, 1], dur: 7, delay: 0 }, { edge: [3, 4], dur: 8.5, delay: 1.6 }, { edge: [10, 11], dur: 7.5, delay: 2.4 },
  { edge: [13, 14], dur: 9, delay: 0.8 }, { edge: [8, 9], dur: 6.5, delay: 3.4 }, { edge: [6, 10], dur: 8, delay: 2 },
];
const FIRE = { c1: '#ff8fd0', c3: '#7fdcff', c5: '#ffd978', c6: '#a98cff', p2: '#8cffcb', p4: '#ff8fd0' };

const LEVELS = {
  subtle: { ink: 0.14, nodes: 0.18, fire: 0, glint: false, pulses: false, nodeCount: 10 },
  rich: { ink: 0.26, nodes: 0.3, fire: 0.1, glint: true, pulses: true, nodeCount: 16 },
};

const GlobalDiamondBackground = () => {
  const level = useDiamondLevel();
  const uid = useId().replace(/:/g, '');
  if (level === 'off') return null;
  const k = LEVELS[level] || LEVELS.subtle;
  const id = (n) => `gdb-${n}-${uid}`;
  const edges = EDGES.filter(([a, b]) => a < k.nodeCount && b < k.nodeCount);

  return (
    <div className="gdb" aria-hidden="true" data-level={level}>
      <style>{`
        .gdb { position: fixed; inset: 0; z-index: 5; pointer-events: none; overflow: hidden; }
        .gdb svg { width: 100%; height: 100%; display: block; }
        @keyframes gdb-fire { 0%,100% { opacity: .15 } 50% { opacity: 1 } }
        @keyframes gdb-glint { 0%, 78% { transform: translateX(-60px); opacity: 0 } 82% { opacity: 1 } 92% { transform: translateX(150px); opacity: 0 } 100% { opacity: 0 } }
        @keyframes gdb-float { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-7px) } }
        .gdb-fire { animation: gdb-fire 8s ease-in-out infinite both; opacity: .15 }
        .gdb-glint { animation: gdb-glint 14s ease-in-out infinite; opacity: 0 }
        .gdb-stone { animation: gdb-float 18s ease-in-out infinite }
        @media (prefers-reduced-motion: reduce) {
          .gdb-fire, .gdb-glint, .gdb-stone { animation: none }
          .gdb-glint, .gdb-pulse { display: none }
        }
      `}</style>
      <svg viewBox="0 0 1000 600" preserveAspectRatio="xMaxYMax slice">
        <defs>
          <clipPath id={id('sil')}><polygon points={pts(SILHOUETTE)} /></clipPath>
          <linearGradient id={id('sheen')} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#fff" stopOpacity="0" />
            <stop offset="0.5" stopColor="#fff" stopOpacity="0.9" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <polygon id={id('mini')} points={pts(SILHOUETTE)} />
        </defs>

        {/* chain links */}
        <g stroke="#6d8fe0" strokeOpacity={k.nodes * 0.8} strokeWidth="1" strokeDasharray="2 6" fill="none">
          {edges.map(([a, b]) => (
            <line key={`${a}-${b}`} x1={NODES[a][0]} y1={NODES[a][1]} x2={NODES[b][0]} y2={NODES[b][1]} />
          ))}
        </g>

        {k.pulses && (
          <g className="gdb-pulse">
            {PULSES.map(({ edge: [a, b], dur, delay }) => (
              <circle key={`${a}-${b}`} r="2.4" fill="#6d8fe0" opacity="0.7">
                <animateMotion dur={`${dur}s`} begin={`${delay}s`} repeatCount="indefinite" path={`M${NODES[a][0]},${NODES[a][1]} L${NODES[b][0]},${NODES[b][1]}`} />
              </circle>
            ))}
          </g>
        )}

        {/* diamond nodes */}
        <g fill="none" stroke="#6d8fe0" strokeOpacity={k.nodes} strokeWidth="6">
          {NODES.slice(0, k.nodeCount).map(([x, y], i) => (
            <use key={i} href={`#${id('mini')}`} transform={`translate(${x - 8} ${y - 7}) scale(${i % 3 === 0 ? 0.14 : 0.11})`} />
          ))}
        </g>

        {/* the stone, large and cropped by the corner like a watermark */}
        <g transform="translate(790 410)">
        {/* positioned by the outer group: a CSS transform on the SVG element itself would replace this one */}
        <g className="gdb-stone">
        <g transform={`scale(4.2) translate(${-VIEW_W / 2} ${-VIEW_H / 2})`}>
          <g fill="none" stroke="#6d8fe0" strokeOpacity={k.ink} strokeWidth="0.55" strokeLinejoin="round">
            {FACETS.map((f) => <polygon key={f.id} points={pts(f.pts)} />)}
          </g>
          {k.fire > 0 && FIRE_IDS.map((fid, i) => (
            <polygon
              key={fid}
              points={pts(FACETS.find((f) => f.id === fid).pts)}
              fill={FIRE[fid]}
              fillOpacity={k.fire}
              className="gdb-fire"
              style={{ animationDelay: `${i * 1.1}s` }}
            />
          ))}
          {k.glint && (
            <g clipPath={`url(#${id('sil')})`}>
              <rect className="gdb-glint" x="0" y="0" width="34" height={VIEW_H} fill={`url(#${id('sheen')})`} transform="skewX(-18)" opacity="0.55" />
            </g>
          )}
        </g>
        </g>
        </g>
      </svg>
    </div>
  );
};

export default GlobalDiamondBackground;

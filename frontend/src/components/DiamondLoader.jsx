import React from 'react';

// The one loading icon used everywhere a video is buffering, uploading, or
// being watermarked/processed across Pitchin and Status.
//
// This is a REAL 3D solid, not a fan of flat cards spun around one axis —
// that earlier approach ("blades" all sharing one rotation axis) went
// perfectly edge-on and vanished to a sliver twice per spin, which is why
// it read as flat. A true bipyramid never does that: it's built from two
// rings of triangular facets, each hinged outward from a shared apex point
// (crown facets from the top point, pavilion facets from the bottom point)
// via rotateX *before* rotateY sweeps it to its position around the ring —
// the standard CSS technique for a cone/pyramid. Because every facet has
// real outward slope (not just azimuthal placement), the silhouette keeps
// volume from every viewing angle.
let stylesInjected = false;
const injectStyles = () => {
  if (stylesInjected || typeof document === 'undefined') return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.setAttribute('data-diamond-loader', 'true');
  style.textContent = `
    @keyframes diamond-loader-spin {
      0%   { transform: rotateY(0deg) rotateX(-16deg); }
      100% { transform: rotateY(360deg) rotateX(-16deg); }
    }
    @keyframes diamond-loader-bob {
      0%, 100% { transform: translateY(0) scale(1); }
      50%      { transform: translateY(-6%) scale(1.015); }
    }
    @keyframes diamond-loader-sparkle {
      0%, 100% { opacity: 0; transform: scale(0.3) rotate(0deg); }
      50%      { opacity: 1; transform: scale(1) rotate(45deg); }
    }
    @keyframes diamond-loader-halo-pulse {
      0%, 100% { opacity: 0.35; transform: scale(0.85); }
      50%      { opacity: 0.9;  transform: scale(1.15); }
    }
    @keyframes diamond-loader-rays-spin {
      0%   { transform: rotate(0deg); }
      100% { transform: rotate(-360deg); }
    }
    @keyframes diamond-loader-rays-flash {
      0%, 100% { opacity: 0.25; }
      25%      { opacity: 0.9; }
      50%      { opacity: 0.35; }
      75%      { opacity: 0.75; }
    }
    .diamond-loader-scene {
      perspective: var(--diamond-perspective, 400px);
    }
    .diamond-loader-bob {
      animation: diamond-loader-bob 2.1s ease-in-out infinite;
    }
    .diamond-loader-halo {
      position: absolute;
      inset: -70%;
      border-radius: 999px;
      background: radial-gradient(circle, rgba(255,255,255,0.9) 0%, rgba(190,215,255,0.5) 30%, rgba(160,140,255,0.18) 55%, transparent 72%);
      mix-blend-mode: screen;
      pointer-events: none;
      animation: diamond-loader-halo-pulse 2.6s ease-in-out infinite;
    }
    .diamond-loader-rays {
      position: absolute;
      inset: -90%;
      pointer-events: none;
      mix-blend-mode: screen;
      animation: diamond-loader-rays-spin 3s linear infinite, diamond-loader-rays-flash 1.4s ease-in-out infinite;
    }
    .diamond-loader-ray {
      position: absolute;
      left: 50%;
      top: 50%;
      width: 2px;
      height: 46%;
      background: linear-gradient(to bottom, rgba(255,255,255,0.95), transparent);
      transform-origin: 50% 0%;
    }
    .diamond-loader-rig {
      width: 100%;
      height: 100%;
      position: relative;
      transform-style: preserve-3d;
      animation: diamond-loader-spin 1s linear infinite;
      filter: drop-shadow(0 0 10px rgba(210,225,255,0.6));
    }
    .diamond-loader-facet {
      position: absolute;
      left: 50%;
      backface-visibility: hidden;
    }
    .diamond-loader-table {
      position: absolute;
      left: 50%;
      top: 0;
      backface-visibility: hidden;
    }
    .diamond-loader-shine-wrap {
      position: absolute;
      inset: 8%;
      overflow: hidden;
      border-radius: 999px;
      pointer-events: none;
    }
    .diamond-loader-shine {
      position: absolute;
      top: -20%;
      left: 50%;
      width: 35%;
      height: 220%;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,0.85), transparent);
      filter: blur(1.5px);
      opacity: 0.75;
      animation: diamond-loader-shine 2.2s ease-in-out infinite alternate;
    }
    @keyframes diamond-loader-shine {
      0%   { transform: translate(-60%, -60%) rotate(25deg); }
      100% { transform: translate(60%, 60%) rotate(25deg); }
    }
    .diamond-loader-sparkle {
      animation: diamond-loader-sparkle 1.9s ease-in-out infinite;
      mix-blend-mode: screen;
    }
  `;
  document.head.appendChild(style);
};

const RING_COUNT = 9; // facets per ring (crown / pavilion) — enough to always keep visible volume
const CROWN_TILT = 40; // degrees the crown facets hinge outward from the top apex
const PAVILION_TILT = 46; // pavilion facets hinge a little steeper, like a real cut

const CROWN_PALETTE = [
  'linear-gradient(200deg,#ffffff 0%,#cfe4ff 60%,#9db8ea 100%)',
  'linear-gradient(200deg,#f3f8ff 0%,#bcd6ff 60%,#8aa6de 100%)',
  'linear-gradient(200deg,#ffffff 0%,#e3d3ff 60%,#b79bea 100%)',
  'linear-gradient(200deg,#fff3fb 0%,#f0c9ea 60%,#d492cf 100%)',
];
const PAVILION_PALETTE = [
  'linear-gradient(340deg,#c9def7 0%,#6f8fce 65%,#4a63a8 100%)',
  'linear-gradient(340deg,#b9d4f5 0%,#5f83c8 65%,#3e57a0 100%)',
  'linear-gradient(340deg,#d9c8f2 0%,#8a6fc8 65%,#5f4aa0 100%)',
  'linear-gradient(340deg,#f2c9e6 0%,#c86fae 65%,#a0468a 100%)',
];

const SPARKLES = [
  { top: '10%', left: '20%', size: 0.16, delay: '0s', rainbow: false },
  { top: '60%', left: '76%', size: 0.11, delay: '0.7s', rainbow: false },
  { top: '34%', left: '66%', size: 0.13, delay: '1.3s', rainbow: true },
];
const RAY_ANGLES = Array.from({ length: 12 }, (_, i) => i * 30);

/**
 * A real 3D gem — a two-ring bipyramid of triangular facets (not a flat
 * fan), with a glow halo, rotating light rays, a shine sweep, and twinkling
 * flare glints. The loading indicator for every video operation (feed
 * buffering, recording, watermarking, upload).
 * @param {number} size - pixel size of the gem itself
 * @param {string} label - optional caption shown under the gem
 * @param {number|null} progress - optional 0-100, shown as "NN%" under the gem
 */
const DiamondLoader = ({ size = 56, label = '', progress = null, className = '' }) => {
  injectStyles();

  const angleStep = 360 / RING_COUNT;
  // Facet slant length (H) and hinge angle set the resulting girdle radius
  // (H * sin(tilt)) and apex-to-girdle drop (H * cos(tilt)). Facet width is
  // the chord between two adjacent girdle vertices at that radius, with a
  // small overlap so neighboring facets don't leave visible seams.
  const crownH = size * 0.62;
  const pavilionH = size * 0.66;
  const girdleRadius = crownH * Math.sin((CROWN_TILT * Math.PI) / 180);
  const facetWidth = 2 * girdleRadius * Math.tan((angleStep * Math.PI) / 360) * 1.1;
  const tableSize = size * 0.3;

  return (
    <div className={`flex flex-col items-center justify-center gap-3 select-none ${className}`}>
      <div className="diamond-loader-bob relative" style={{ width: size, height: size }}>
        {/* Soft glow pulsing outward, as if the gem is emitting light */}
        <div className="diamond-loader-halo" />

        {/* Thin light rays spinning slowly around the gem, flashing brighter in bursts */}
        <div className="diamond-loader-rays">
          {RAY_ANGLES.map((angle) => (
            <div key={angle} className="diamond-loader-ray" style={{ transform: `translateX(-50%) rotate(${angle}deg)` }} />
          ))}
        </div>

        <div className="diamond-loader-scene" style={{ width: size, height: size, '--diamond-perspective': `${size * 4}px` }}>
          <div className="diamond-loader-rig">
            {/* Crown ring — hinges outward from the top apex */}
            {Array.from({ length: RING_COUNT }, (_, i) => (
              <div
                key={`c${i}`}
                className="diamond-loader-facet"
                style={{
                  top: 0,
                  width: facetWidth,
                  height: crownH,
                  marginLeft: -facetWidth / 2,
                  transformOrigin: '50% 0%',
                  transform: `rotateY(${i * angleStep}deg) rotateX(${CROWN_TILT}deg)`,
                  clipPath: 'polygon(50% 0%, 100% 100%, 0% 100%)',
                  background: CROWN_PALETTE[i % CROWN_PALETTE.length],
                  boxShadow: 'inset 0 0 6px rgba(255,255,255,0.6)',
                }}
              />
            ))}
            {/* Pavilion ring — hinges outward from the bottom apex */}
            {Array.from({ length: RING_COUNT }, (_, i) => (
              <div
                key={`p${i}`}
                className="diamond-loader-facet"
                style={{
                  bottom: 0,
                  width: facetWidth,
                  height: pavilionH,
                  marginLeft: -facetWidth / 2,
                  transformOrigin: '50% 100%',
                  transform: `rotateY(${i * angleStep + angleStep / 2}deg) rotateX(${-PAVILION_TILT}deg)`,
                  clipPath: 'polygon(50% 100%, 100% 0%, 0% 0%)',
                  background: PAVILION_PALETTE[i % PAVILION_PALETTE.length],
                  boxShadow: 'inset 0 0 6px rgba(255,255,255,0.35)',
                }}
              />
            ))}
            {/* Flat table facet at the very top, catching the brightest highlight */}
            <div
              className="diamond-loader-table"
              style={{
                width: tableSize,
                height: tableSize,
                marginLeft: -tableSize / 2,
                borderRadius: '30%',
                transform: `rotateX(90deg) translateZ(${size * 0.03}px)`,
                background: 'radial-gradient(circle at 38% 30%, #ffffff, #d7e9ff 75%)',
                boxShadow: '0 0 8px rgba(255,255,255,0.9)',
              }}
            />
          </div>
        </div>
        {/* Diagonal shine sweeping across the gem, like light gliding over a cut surface */}
        <div className="diamond-loader-shine-wrap">
          <div className="diamond-loader-shine" />
        </div>
        {/* Twinkling four-point flare glints — one carrying a faint rainbow "fire" */}
        {SPARKLES.map((s, i) => (
          <div
            key={i}
            className="diamond-loader-sparkle absolute"
            style={{
              width: size * s.size,
              height: size * s.size,
              top: s.top,
              left: s.left,
              animationDelay: s.delay,
              background: s.rainbow
                ? 'conic-gradient(from 0deg, #ff9ad6, #9ad6ff, #c9ff9a, #fff29a, #ff9ad6)'
                : 'radial-gradient(circle, #ffffff 0%, transparent 70%)',
              clipPath: 'polygon(50% 0%, 62% 38%, 100% 50%, 62% 62%, 50% 100%, 38% 62%, 0% 50%, 38% 38%)',
              filter: 'blur(0.2px)',
            }}
          />
        ))}
      </div>
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
};

export default DiamondLoader;

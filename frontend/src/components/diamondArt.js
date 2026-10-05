/**
 * The IcanEra diamond — one cut, one palette, used by every loader.
 *
 * A brilliant-cut stone seen from the side: table band, six crown facets, a
 * girdle, four pavilion facets down to the culet. Colourless "D-colour" look:
 * bright white and ice facets set against cooler, deeper ones (a real stone
 * reads by contrast between facets that return light and facets that don't),
 * plus prismatic "fire" — the spectral flashes a cut stone throws as it turns.
 *
 * Two renderings share this file:
 *  - flat   : a self-contained SVG image (CSS variable --ican-gem-img) used by
 *             the small spinners, which spin it as two planes set at 90°.
 *  - sprite : gradients and clip paths shared by the full inline-SVG stone in
 *             IcanDiamond.jsx (the opening / stage version).
 */

export const VIEW_W = 120;
export const VIEW_H = 104;

const P = {
  T1: [36, 2], T2: [84, 2],
  A: [30, 8], B: [60, 8], C: [90, 8],
  G0: [3, 36], G1: [32, 36], G2: [60, 36], G3: [88, 36], G4: [117, 36],
  H0: [7, 41], H1: [33, 41], H2: [60, 41], H3: [87, 41], H4: [113, 41],
  K: [60, 100],
};

// light = top of the facet, base = bottom. Alternating bright / deep facets.
export const FACETS = [
  { id: 'table', pts: [P.T1, P.T2, P.C, P.A], light: '#ffffff', base: '#e6f0fd' },
  { id: 'c1', pts: [P.A, P.G0, P.G1], light: '#d9e6f8', base: '#a9bddf' },
  { id: 'c2', pts: [P.A, P.B, P.G1], light: '#ffffff', base: '#eef5fe' },
  { id: 'c3', pts: [P.B, P.G1, P.G2], light: '#edf4fd', base: '#bfd0ea' },
  { id: 'c4', pts: [P.B, P.G2, P.G3], light: '#ffffff', base: '#dde9f9' },
  { id: 'c5', pts: [P.B, P.C, P.G3], light: '#f6faff', base: '#c8d9f0' },
  { id: 'c6', pts: [P.C, P.G3, P.G4], light: '#d3e1f5', base: '#9fb5d9' },
  { id: 'g', pts: [P.G0, P.G4, P.H4, P.H0], light: '#c4d2e8', base: '#869bc2' },
  { id: 'p1', pts: [P.H0, P.H1, P.K], light: '#a4b6d6', base: '#667ca6' },
  { id: 'p2', pts: [P.H1, P.H2, P.K], light: '#e6effb', base: '#b4c6e4' },
  { id: 'p3', pts: [P.H2, P.H3, P.K], light: '#c0d0ea', base: '#8aa0c8' },
  { id: 'p4', pts: [P.H3, P.H4, P.K], light: '#98abcd', base: '#5d729d' },
];

// Facets that carry the spectral fire.
export const FIRE_IDS = ['c1', 'c3', 'c5', 'c6', 'p2', 'p4'];
// Static tint per fire facet for the flat rendering (the stage one animates).
const FLAT_FIRE = { c1: '#ff8fd0', c3: '#7fdcff', c5: '#ffd978', c6: '#a98cff', p2: '#8cffcb', p4: '#ff8fd0' };

export const SILHOUETTE = [P.T1, P.T2, P.C, P.G4, P.H4, P.K, P.H0, P.G0, P.A];

const pts = (list) => list.map((p) => p.join(',')).join(' ');
const gid = (id) => `icg-f-${id}`;

const facetGradients = () => FACETS.map((f) =>
  `<linearGradient id='${gid(f.id)}' x1='0.2' y1='0' x2='0.55' y2='1'>` +
  `<stop offset='0' stop-color='${f.light}'/><stop offset='1' stop-color='${f.base}'/></linearGradient>`
).join('');

// A white flash on the table, like the highlight on a polished stone.
const TABLE_GLINT = '40,3.2 58,3.2 53,7 38,7';

const flatGemSvg = (edge) => {
  const polys = FACETS.map((f) =>
    `<polygon points='${pts(f.pts)}' fill='url(#${gid(f.id)})' stroke='${edge}' stroke-width='1.3' stroke-linejoin='round'/>`
  ).join('');
  const fire = FIRE_IDS.map((id) => {
    const f = FACETS.find((x) => x.id === id);
    return `<polygon points='${pts(f.pts)}' fill='${FLAT_FIRE[id]}' opacity='0.34'/>`;
  }).join('');
  return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${VIEW_W} ${VIEW_H}'>` +
    `<defs>${facetGradients()}</defs>${polys}${fire}` +
    `<polygon points='${TABLE_GLINT}' fill='#ffffff' opacity='0.9'/></svg>`;
};

const toCssUrl = (svg) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

// Shared defs for the inline (stage) stone: facet gradients, the spectral fire
// gradient, a glint, and the two clip paths. Appended to <body> once.
const spriteMarkup = () => {
  const fireClip = FIRE_IDS.map((id) => `<polygon points='${pts(FACETS.find((f) => f.id === id).pts)}'/>`).join('');
  return `<svg id='ican-gem-sprite' xmlns='http://www.w3.org/2000/svg' width='0' height='0' aria-hidden='true' focusable='false' style='position:absolute;width:0;height:0;overflow:hidden'>` +
    `<defs>${facetGradients()}` +
    `<linearGradient id='icg-fire' gradientUnits='userSpaceOnUse' x1='0' y1='0' x2='150' y2='0' spreadMethod='repeat'>` +
    `<stop offset='0' stop-color='#ff6fc8' stop-opacity='0'/>` +
    `<stop offset='0.16' stop-color='#ff6fc8'/><stop offset='0.30' stop-color='#ffc862'/>` +
    `<stop offset='0.44' stop-color='#6dffc0'/><stop offset='0.58' stop-color='#5cd0ff'/>` +
    `<stop offset='0.72' stop-color='#9b7dff'/><stop offset='0.86' stop-color='#9b7dff' stop-opacity='0'/>` +
    `<stop offset='1' stop-color='#9b7dff' stop-opacity='0'/></linearGradient>` +
    `<linearGradient id='icg-glint' x1='0' y1='0' x2='1' y2='0'>` +
    `<stop offset='0' stop-color='#fff' stop-opacity='0'/><stop offset='0.5' stop-color='#fff' stop-opacity='0.95'/><stop offset='1' stop-color='#fff' stop-opacity='0'/></linearGradient>` +
    `<clipPath id='icg-clip-fire'>${fireClip}</clipPath>` +
    `<clipPath id='icg-clip-sil'><polygon points='${pts(SILHOUETTE)}'/></clipPath>` +
    `</defs></svg>`;
};

let installed = false;

/** Idempotent. Call once at start-up and from any component that draws a gem. */
export const installDiamondStyles = () => {
  if (installed || typeof document === 'undefined') return;
  installed = true;

  const style = document.createElement('style');
  style.setAttribute('data-ican-diamond', 'true');
  style.textContent =
    `:root{--ican-gem-img-light:${toCssUrl(flatGemSvg('#5b6f98'))};` +
    `--ican-gem-img-dark:${toCssUrl(flatGemSvg('#b9cbea'))}}`;
  document.head.appendChild(style);

  const mount = () => {
    if (document.getElementById('ican-gem-sprite')) return;
    const holder = document.createElement('div');
    holder.innerHTML = spriteMarkup();
    document.body.appendChild(holder.firstChild);
  };
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount, { once: true });
};

export const TABLE_GLINT_POINTS = TABLE_GLINT;
export const facetPoints = (list) => pts(list);
export const facetGradientId = gid;

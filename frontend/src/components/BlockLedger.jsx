import React, { useEffect, useId, useState } from 'react';
import { sha256 } from 'js-sha256';
import { BACKDROP_PALETTES } from './BlockchainBackdrop';
import './blockchain.css';

/**
 * A real (miniature) blockchain, drawn as interlocking diamonds.
 *
 * Every block here is genuine: it carries a height, the hash of the block
 * before it, and a nonce, and its own hash is SHA-256 over those. A block is
 * only sealed once a nonce is found that makes its hash start with "00"
 * (proof of work, ~256 tries, instant). New blocks keep being sealed onto the
 * end while the page loads, and the whole chain is re-verified on every tick:
 * each block's hash is recomputed, and each block's `prev` must equal the hash
 * of the block before it.
 *
 * It is a loading animation, not the ICAN ledger -- nothing here is stored or
 * sent anywhere.
 *
 * Drawn as links of a chain: each diamond overlaps the next, and the overlap is
 * woven -- block n passes over block n+1 at the top crossing and under it at
 * the bottom, the way chain links do.
 */

const DIFFICULTY_PREFIX = '00';
const GENESIS_PREV = '0'.repeat(64);

const mineBlock = (height, prevHash) => {
  for (let nonce = 0; ; nonce += 1) {
    const hash = sha256(`${height}|${prevHash}|${nonce}`);
    if (hash.startsWith(DIFFICULTY_PREFIX)) return { height, prevHash, nonce, hash };
  }
};

const verifyChain = (blocks) => blocks.every((b, i) => (
  sha256(`${b.height}|${b.prevHash}|${b.nonce}`) === b.hash
  && b.hash.startsWith(DIFFICULTY_PREFIX)
  && (i === 0 || b.prevHash === blocks[i - 1].hash)
));

/** The last `size` blocks of a chain that keeps growing every `everyMs`. */
export const useBlockchain = (size = 5, everyMs = 1300) => {
  const [blocks, setBlocks] = useState(() => {
    const first = mineBlock(1024000 + Math.floor(Math.random() * 9000), GENESIS_PREV);
    const chain = [first];
    while (chain.length < size) {
      const prev = chain[chain.length - 1];
      chain.push(mineBlock(prev.height + 1, prev.hash));
    }
    return chain;
  });

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    const timer = setInterval(() => {
      setBlocks((chain) => {
        const tip = chain[chain.length - 1];
        return [...chain.slice(1), mineBlock(tip.height + 1, tip.hash)];
      });
    }, everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);

  return { blocks, valid: verifyChain(blocks) };
};

const R = 58;                 // block half-diagonal
const SPACING = 86;           // centre-to-centre; < 2R so the blocks overlap
const CY = R + 4;
const rhombus = `M0 ${-R}L${R} 0L0 ${R}L${-R} 0Z`;
const short = (hash, n = 8) => hash.slice(0, n);

/**
 * @param {number} count  blocks shown (one more is kept off-stage so the oldest
 *                        can slide out)
 */
export const BlockLedger = ({ count = 4, tone = 'light', bg, className = '' }) => {
  const p = BACKDROP_PALETTES[tone] || BACKDROP_PALETTES.light;
  const ground = bg || p.bg;
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const { blocks, valid } = useBlockchain(count + 1);
  const tip = blocks[blocks.length - 1];
  const width = (count - 1) * SPACING + 2 * R;
  const height = 2 * CY;
  const clipId = `bcl-clip-${uid}`;

  // overlap with the next block, in a block's own coordinates (centre = 0)
  const overlapX = SPACING - R - 2;
  const overlapW = R - (SPACING - R) + 4;

  const place = (i) => `translate(${R + (i - 1) * SPACING}px, ${CY}px)`;

  return (
    <div className={`bc-ledger-wrap ${className}`}>
    <svg
      className="bc-ledger"
      viewBox={`0 0 ${width} ${height}`}
      style={{ '--bc-accent': p.accent, '--bc-ink': p.ink, '--bc-muted': p.muted }}
      role="img"
      aria-label="A chain of linked blocks being sealed"
    >
      <defs>
        <clipPath id={clipId}>
          {/* the top half of the overlap: where block n passes over block n+1 */}
          <rect x={overlapX} y={-R} width={overlapW} height={R} />
        </clipPath>
      </defs>

      {/* pass 1: every block, whole */}
      {blocks.map((b, i) => {
        const newest = i === blocks.length - 1;
        return (
          <g key={b.hash} className={`bc-ledger__slot${i === 0 ? ' is-leaving' : ''}`} style={{ transform: place(i) }}>
            <g className={newest ? 'bc-ledger__new' : undefined}>
              <path d={rhombus} fill={ground} />
              <path d={rhombus} fill={p.accent} fillOpacity={newest ? 0.3 : 0.12} stroke={p.accent} strokeWidth="2" strokeLinejoin="round" />
              <text className="bc-ledger__h" y="-11" textAnchor="middle" fill={p.ink}>#{b.height}</text>
              <text className="bc-ledger__m" y="4" textAnchor="middle" fill={p.accent}>{short(b.hash, 6)}</text>
              <text className="bc-ledger__s" y="17" textAnchor="middle" fill={p.muted}>←{short(b.prevHash, 4)}·n{b.nonce}</text>
            </g>
          </g>
        );
      })}

      {/* pass 2: re-draw the top half of each overlap so the links weave */}
      {blocks.slice(0, -1).map((b, i) => (
        <g key={`w${b.hash}`} className={`bc-ledger__slot${i === 0 ? ' is-leaving' : ''}`} style={{ transform: place(i) }}>
          <g clipPath={`url(#${clipId})`}>
            <path d={rhombus} fill={ground} />
            <path d={rhombus} fill={p.accent} fillOpacity="0.12" stroke={p.accent} strokeWidth="2" strokeLinejoin="round" />
          </g>
          {/* the link itself: this block's hash, pinned into the next one's `prev` */}
          <circle cx={SPACING / 2} cy="0" r="3.6" fill={p.accent} className="bc-ledger__pin" />
        </g>
      ))}
    </svg>
    <p className="bc-ticker" style={{ '--bc-muted': p.muted, margin: '0.5rem 0 0' }} aria-hidden="true">
      Block #{tip.height.toLocaleString('en-US')} sealed · nonce {tip.nonce} · {valid ? 'verified ✓' : 'verifying…'}
    </p>
    </div>
  );
};

export default BlockLedger;

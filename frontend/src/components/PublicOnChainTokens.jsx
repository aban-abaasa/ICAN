import React, { useCallback, useEffect, useRef, useState } from 'react';
import { HelpCircle } from 'lucide-react';
import { CHART_PALETTES } from './chartPalettes';
import { useInView } from './PublicSectorMarkets';
import PublicSectionNotice from './PublicSectionNotice';
import { communityContract, getChainConfig, publicProvider } from '../services/chainService';
import { explorerLink, formatUnits, shortAddress } from '../utils/chainMath';

// icaneracoin on the blockchain, on the public /icaneracoin page: the community form and the facts anyone can check without an account.
//   ICEC-C  a receipt for ledger icaneracoin; it follows the coin's price and cannot be traded on an exchange
// (ICEC-S, the stable form, no longer lives on a blockchain: it is inside IcanEra, see PublicStableCoin.) Everything shown is read from
// the chain through a public node or from the database's public config. Moving coins onto the chain happens in the visitor's own wallet
// inside IcanEra, never on this page. Until the chain is set up this renders NOTHING (the stable coin above has its own section).
// Colours are the page's palettes as inline styles, for the same reason as the Sector Markets section.

const POLL_MS = 30_000;

const PublicOnChainTokens = ({ theme = 'dark', skin: k, priceUgx = null, onAvailability, onLearn }) => {
  const c = CHART_PALETTES[theme] || CHART_PALETTES.dark;
  const rootRef = useRef(null);
  const inView = useInView(rootRef);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);   // (set again on mount: React strict mode mounts twice)

  const [cfg, setCfg] = useState(undefined);        // undefined: loading; null: not installed or nothing configured
  const [reads, setReads] = useState(null);         // { community } or { failed: true } / { noNode: true }

  useEffect(() => {
    let live = true;
    getChainConfig()
      .then((r) => { if (live) setCfg(r && !r.missing && r.chain_id && r.icec_community_address ? r : null); })
      .catch(() => { if (live) setCfg(null); });
    return () => { live = false; };
  }, []);

  const shown = !!cfg;
  useEffect(() => { onAvailability?.(shown); }, [shown, onAvailability]);

  const load = useCallback(async () => {
    if (!cfg) return;
    const provider = publicProvider(cfg);
    if (!provider) { setReads({ noNode: true }); return; }
    try {
      const out = { community: await communityContract(provider, cfg).totalSupply() };
      if (alive.current) setReads(out);
    } catch {
      if (alive.current) setReads({ failed: true });
    } finally {
      provider.destroy?.();
    }
  }, [cfg]);

  useEffect(() => {
    if (!cfg || !inView) return undefined;
    load();
    const t = setInterval(() => { if (document.visibilityState !== 'hidden') load(); }, POLL_MS);
    return () => clearInterval(t);
  }, [cfg, inView, load]);

  // The wrapper is always rendered, so the on-screen check has something to watch before the config has arrived.
  if (!cfg) return <div ref={rootRef} />;

  const card = { background: c.card, border: `1px solid ${c.cardBorder}`, color: c.fg };
  const sub = { color: c.muted };
  const explorer = (v) => explorerLink(cfg.explorer_url, 'address', v);
  const addr = (v) => (explorer(v)
    ? <a href={explorer(v)} target="_blank" rel="noreferrer" className="font-mono underline" style={{ color: c.strong }}>{shortAddress(v)}</a>
    : <span className="font-mono" style={{ color: c.strong }}>{shortAddress(v)}</span>);

  return (
    <div ref={rootRef}>
    <section id="tokens" aria-labelledby="tokens-heading" className="mt-10 scroll-mt-16" data-testid="public-onchain">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className={`text-xs font-bold uppercase tracking-[0.16em] ${k.kicker}`}>On the blockchain</p>
          <h2 id="tokens-heading" className={`mt-1 text-xl font-bold sm:text-2xl ${k.title}`}>ICEC-C</h2>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs" style={sub}>{cfg.chain_name || `Chain ${cfg.chain_id}`}{cfg.is_testnet ? ' · test network' : ''}</span>
          {onLearn && (
            <button type="button" onClick={onLearn} aria-label="How ICEC-C works" title="How ICEC-C works" className="-m-2 rounded-md p-2" style={{ color: c.soft }}>
              <HelpCircle className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
      {cfg.is_testnet && (
        <p className="mt-2 text-xs" style={{ color: c.warnText }}>Test network: test tokens have no real value.</p>
      )}

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {cfg.icec_community_address && (
          <div className="rounded-xl p-4" style={card} data-testid="onchain-community">
            <div className="flex items-baseline justify-between">
              <h3 className="text-lg font-bold" style={{ color: c.strong }}>ICEC-C <span className="text-sm font-normal" style={sub}>· the community form</span></h3>
              {priceUgx != null && <span className="text-xs tabular-nums" style={sub}>1 ICEC-C = 1 icaneracoin ≈ UGX {Number(priceUgx).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>}
            </div>
            <p className="mt-1 text-sm" style={{ color: c.fg }}>Follows the icaneracoin price.</p>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg p-3 text-sm" style={{ background: c.field, border: `1px solid ${c.fieldBorder}` }}>
              <dt style={sub}>ICEC-C in existence</dt>
              <dd className="text-right tabular-nums" style={{ color: c.strong }}>{reads?.community != null ? formatUnits(reads.community, 8, 2) : '—'}</dd>
              <dt style={sub}>Where it can go</dt><dd className="text-right" style={{ color: c.strong }}>Your own wallet only</dd>
            </dl>
            <details className="mt-2">
              <summary className="min-h-[36px] cursor-pointer list-none py-2 text-xs font-semibold marker:hidden" style={sub}>Contract address ▾</summary>
              <p className="pb-1 text-xs" style={sub}>{addr(cfg.icec_community_address)}</p>
            </details>
          </div>
        )}
      </div>

      <div className="mt-3">
        <a href="/" className={`inline-flex min-h-[44px] items-center gap-2 rounded-md px-5 py-2.5 text-sm font-semibold ${k.cta}`}>Open my IcanEra wallet</a>
      </div>
    </section>
    </div>
  );
};

export default PublicOnChainTokens;

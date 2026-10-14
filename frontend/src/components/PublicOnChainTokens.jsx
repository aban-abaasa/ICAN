import React, { useCallback, useEffect, useRef, useState } from 'react';
import { HelpCircle } from 'lucide-react';
import { CHART_PALETTES } from './chartPalettes';
import { useInView } from './PublicSectorMarkets';
import PublicSectionNotice from './PublicSectionNotice';
import { communityContract, getChainConfig, getFxRate, publicProvider, resolveStableContracts, stableContracts } from '../services/chainService';
import { explorerLink, formatUnits, localValue, proofOfReserve, shortAddress } from '../utils/chainMath';

// icaneracoin on the blockchain, on the public /icaneracoin page: the two forms and the facts anyone can check without an account.
//   ICEC-S  the stable form: a US-dollar token, each one backed 1:1 by a dollar stablecoin held in a public vault
//   ICEC-C  the community form: a receipt for ledger icaneracoin; it follows the coin's price above and cannot be traded on an exchange
// Everything shown is read from the chain (through a public node) or from the database's public config: the vault's reserve against what
// it has issued, the supply of each token, and where the contracts are. Using them (deposit, redeem, move coins onto the chain) happens
// in the visitor's own wallet inside IcanEra, never on this page.
//
// Until the on-chain SQL is installed and a contract is configured it shows an explanatory notice in its place (so the page
// navigation can always load it), and it only reads the chain while it is on screen.
// Colours are the page's palettes as inline styles, for the same reason as the Sector Markets section.

const POLL_MS = 30_000;

const PublicOnChainTokens = ({ theme = 'dark', skin: k, priceUgx = null, onAvailability, onLearn }) => {
  const c = CHART_PALETTES[theme] || CHART_PALETTES.dark;
  const rootRef = useRef(null);
  const inView = useInView(rootRef);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);   // (set again on mount: React strict mode mounts twice)

  const [cfg, setCfg] = useState(undefined);        // undefined: loading; null: not installed or nothing configured
  const [fx, setFx] = useState(null);
  const [reads, setReads] = useState(null);         // { decimals, symbol, held, supply, community } or { failed: true }

  useEffect(() => {
    let live = true;
    getChainConfig()
      .then((r) => { if (live) setCfg(r && !r.missing && r.chain_id && (r.stable_vault_address || r.icec_community_address) ? r : null); })
      .catch(() => { if (live) setCfg(null); });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (!cfg) return;
    getFxRate('USD/UGX').then((r) => { if (alive.current) setFx(r); }).catch(() => { if (alive.current) setFx({ available: false }); });
  }, [cfg]);

  const shown = !!cfg;
  useEffect(() => { onAvailability?.(shown); }, [shown, onAvailability]);

  const load = useCallback(async () => {
    if (!cfg) return;
    const provider = publicProvider(cfg);
    if (!provider) { setReads({ noNode: true }); return; }
    try {
      const out = {};
      if (cfg.stable_vault_address) {
        const resolved = await resolveStableContracts(provider, cfg);
        const ct = stableContracts(provider, cfg, resolved);
        const [dec, sym, col] = await Promise.all([ct.reserve.decimals(), ct.reserve.symbol(), ct.vault.collateralization()]);
        Object.assign(out, { decimals: Number(dec), symbol: sym, held: col[0], supply: col[1] });
      }
      if (cfg.icec_community_address) out.community = await communityContract(provider, cfg).totalSupply();
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
  if (!cfg) {
    return (
      <div ref={rootRef}>
        <PublicSectionNotice id="tokens" theme={theme} skin={k} kicker="On the blockchain" title="Stable coins" loading={cfg === undefined} onLearn={onLearn}>
          icaneracoin as tokens in your own crypto wallet.
        </PublicSectionNotice>
      </div>
    );
  }

  const card = { background: c.card, border: `1px solid ${c.cardBorder}`, color: c.fg };
  const sub = { color: c.muted };
  const explorer = (v) => explorerLink(cfg.explorer_url, 'address', v);
  const addr = (v) => (explorer(v)
    ? <a href={explorer(v)} target="_blank" rel="noreferrer" className="font-mono underline" style={{ color: c.strong }}>{shortAddress(v)}</a>
    : <span className="font-mono" style={{ color: c.strong }}>{shortAddress(v)}</span>);

  const por = reads?.held != null ? proofOfReserve({ reserve: reads.held, supply: reads.supply }) : null;
  const dec = reads?.decimals ?? 6;
  const oneInShillings = fx?.available ? localValue(10n ** BigInt(dec), dec, fx.rate) : null;

  return (
    <div ref={rootRef}>
    <section id="tokens" aria-labelledby="tokens-heading" className="mt-10 scroll-mt-16" data-testid="public-onchain">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className={`text-xs font-bold uppercase tracking-[0.16em] ${k.kicker}`}>On the blockchain</p>
          <h2 id="tokens-heading" className={`mt-1 text-xl font-bold sm:text-2xl ${k.title}`}>Stable coins</h2>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs" style={sub}>{cfg.chain_name || `Chain ${cfg.chain_id}`}{cfg.is_testnet ? ' · test network' : ''}</span>
          {onLearn && (
            <button type="button" onClick={onLearn} aria-label="How stable coins work" title="How stable coins work" className="-m-2 rounded-md p-2" style={{ color: c.soft }}>
              <HelpCircle className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
      {cfg.is_testnet && (
        <p className="mt-2 text-xs" style={{ color: c.warnText }}>Test network: test tokens have no real value.</p>
      )}

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {cfg.stable_vault_address && (
          <div className="rounded-xl p-4" style={card} data-testid="onchain-stable">
            <div className="flex items-baseline justify-between">
              <h3 className="text-lg font-bold" style={{ color: c.strong }}>ICEC-S <span className="text-sm font-normal" style={sub}>· the stable form</span></h3>
              {oneInShillings != null && <span className="text-xs tabular-nums" style={sub}>1 ICEC-S ≈ UGX {oneInShillings.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>}
            </div>
            <p className="mt-1 text-sm" style={{ color: c.fg }}>Steady US-dollar value, backed 1:1.</p>

            <div className="mt-3 rounded-lg p-3" style={{ background: c.field, border: `1px solid ${c.fieldBorder}` }}>
              <p className="text-xs font-semibold uppercase tracking-wide" style={sub}>Proof of reserve</p>
              {por ? (
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  <dt style={sub}>Held in the vault</dt><dd className="text-right tabular-nums" style={{ color: c.strong }}>{formatUnits(reads.held, dec, 2)} {reads.symbol}</dd>
                  <dt style={sub}>ICEC-S in existence</dt><dd className="text-right tabular-nums" style={{ color: c.strong }}>{formatUnits(reads.supply, dec, 2)}</dd>
                  <dt style={sub}>Backing</dt>
                  <dd className="text-right font-semibold" style={{ color: por.backed ? c.pos : c.neg }}>
                    {por.backed ? `${(Number(por.coverageBps) / 100).toFixed(2)}% (every ICEC-S is covered)` : `SHORT by ${formatUnits(por.shortfall, dec, 2)}`}
                  </dd>
                </dl>
              ) : (
                <p className="mt-2 text-sm" style={sub}>
                  {reads?.noNode ? 'Check the reserve on the block explorer (see Contract addresses).'
                    : reads?.failed ? 'Could not read the vault just now. Retrying…' : 'Reading the vault…'}
                </p>
              )}
            </div>
            <details className="mt-2">
              <summary className="min-h-[36px] cursor-pointer list-none py-2 text-xs font-semibold marker:hidden" style={sub}>Contract addresses ▾</summary>
              <p className="pb-1 text-xs leading-6" style={sub}>
                Vault {addr(cfg.stable_vault_address)}
                {cfg.stable_token_address && <> · token {addr(cfg.stable_token_address)}</>}
                {cfg.reserve_token_address && <> · reserve {cfg.reserve_token_symbol ? `${cfg.reserve_token_symbol} ` : ''}{addr(cfg.reserve_token_address)}</>}
              </p>
            </details>
          </div>
        )}

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

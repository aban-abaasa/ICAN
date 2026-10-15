import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HelpCircle } from 'lucide-react';
import IcanTradingChart from './IcanTradingChart';
import PublicSectionNotice from './PublicSectionNotice';
import { useInView } from './PublicSectorMarkets';
import { CHART_PALETTES } from './chartPalettes';
import { CountryService } from '../services/countryService';
import { getQuote, getHistory } from '../services/stableUnitService';
import { trim, fmtMoney, historyToRows, rateAge } from '../utils/stableUnitRules';

// ICEC-S, the stable form of icaneracoin, on the public /icaneracoin page. It lives INSIDE IcanEra (no blockchain, no gas): one
// ICEC-S is a US dollar at the live rates icaneracoin itself is priced from, never below its start value grown by inflation, held
// in a shared pool as dollars. Anyone can see its value in their own currency, how it is protected, what it costs and the same
// analysis chart as the coin, with no account. Buying and cashing out happen in the signed-in wallet (Trade -> ICEC-S & C).
//
// Reads only the public database functions ican_stable_quote / ican_stable_history, and only while it is on screen.
// Colours are the page's palettes as inline styles, like the other public sections.

const POLL_MS = 60_000;
const COMMON = ['UGX', 'USD', 'GBP', 'EUR', 'KES', 'JPY'];

// The currency of the visitor's own country, from their browser's language (en-GB -> GBP); null when it cannot tell.
const guessCurrency = () => {
  try {
    const region = String(navigator.language || '').split('-')[1];
    const code = region ? CountryService.getCurrencyCode(region.toUpperCase()) : null;
    return /^[A-Z]{3}$/.test(code || '') ? code : null;
  } catch {
    return null;
  }
};

const PublicStableCoin = ({ theme = 'dark', skin: k, onAvailability, onLearn }) => {
  const c = CHART_PALETTES[theme] || CHART_PALETTES.dark;
  const rootRef = useRef(null);
  const inView = useInView(rootRef);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const [quote, setQuote] = useState(undefined);      // undefined: loading; { missing } / { available: false }: not there yet
  const [history, setHistory] = useState([]);
  const [currency, setCurrency] = useState(() => guessCurrency() || 'UGX');

  const load = useCallback(async () => {
    try {
      const [q, h] = await Promise.all([getQuote(), getHistory(500)]);
      if (!alive.current) return;
      setQuote(q); setHistory(h);
    } catch {
      if (alive.current) setQuote((cur) => (cur === undefined ? { available: false } : cur));
    }
  }, []);

  useEffect(() => {
    if (!inView) return undefined;
    load();
    const t = setInterval(() => { if (document.visibilityState !== 'hidden') load(); }, POLL_MS);
    return () => clearInterval(t);
  }, [inView, load]);

  const shown = !!quote?.available;
  useEffect(() => { onAvailability?.(shown); }, [shown, onAvailability]);

  const rows = useMemo(() => historyToRows(history), [history]);

  if (!quote?.available) {
    return (
      <div ref={rootRef}>
        <PublicSectionNotice id="stable" theme={theme} skin={k} kicker="Stable coin" title="ICEC-S" loading={quote === undefined} onLearn={onLearn}>
          icaneracoin with a steady US-dollar value, inside your IcanEra wallet.
        </PublicSectionNotice>
      </div>
    );
  }

  const card = { background: c.card, border: `1px solid ${c.cardBorder}`, color: c.fg };
  const field = { background: c.field, border: `1px solid ${c.fieldBorder}` };
  const sub = { color: c.muted };
  const chips = [...new Set([currency, ...COMMON])].filter((x) => quote.currencies?.[x] != null);
  const local = quote.currencies?.[currency];
  const live = !quote.rates_stale;
  const recipient = quote.fee_recipient;

  return (
    <section id="stable" ref={rootRef} aria-labelledby="stable-heading" className="mt-10 scroll-mt-16" data-testid="public-stable">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className={`text-xs font-bold uppercase tracking-[0.16em] ${k.kicker}`}>Stable coin</p>
          <h2 id="stable-heading" className={`mt-1 text-xl font-bold sm:text-2xl ${k.title}`}>ICEC-S <span className="text-sm font-normal" style={sub}>· a dollar, inside IcanEra</span></h2>
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-2 text-xs" style={sub} aria-live="polite">
            <span className="h-2 w-2 rounded-full" style={{ background: live ? c.live : c.book }} />{live ? 'Live rates' : 'Rates updating'} · {rateAge(quote.rates_updated_at)}
          </span>
          {onLearn && (
            <button type="button" onClick={onLearn} aria-label="How ICEC-S works" title="How ICEC-S works" className="-m-2 rounded-md p-2" style={{ color: c.soft }}>
              <HelpCircle className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-5">
        <div className="space-y-3 rounded-xl p-4 lg:col-span-2" style={card}>
          <div>
            <p className="text-xs uppercase tracking-wide" style={sub}>1 ICEC-S =</p>
            <p className="break-words text-3xl font-bold leading-tight tabular-nums" style={{ color: c.strong }}>{fmtMoney(local, currency, { precise: true })}</p>
            <p className="text-sm" style={sub}>{quote.pool_short ? 'the pool’s share of its full value' : '1 US dollar'}{currency !== 'UGX' ? ` · UGX ${trim(quote.unit_ugx, 2)}` : ''}</p>
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show the value in">
            {chips.map((x) => (
              <button key={x} type="button" onClick={() => setCurrency(x)} aria-pressed={x === currency}
                className="min-h-[32px] rounded-full px-3 text-xs font-semibold"
                style={x === currency ? { background: c.accent, color: c.accentText } : { ...field, color: c.soft }}>{x}</button>
            ))}
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg p-3 text-sm" style={field}>
            <dt style={sub}>To buy</dt><dd className="text-right font-semibold" style={{ color: c.pos }}>No fee</dd>
            <dt style={sub}>To cash out</dt><dd className="text-right tabular-nums" style={{ color: c.strong }}>{trim(quote.sell_fee_bps / 100, 2)}%</dd>
            <dt style={sub}>Inflation floor</dt>
            <dd className="text-right tabular-nums" style={{ color: quote.protected ? c.pos : c.strong }}>UGX {trim(quote.floor_ugx, 0)}{quote.protected ? ' · holding' : ''}</dd>
            <dt style={sub}>Pool per ICEC-S</dt>
            <dd className="text-right tabular-nums" style={{ color: quote.pool_short ? c.warnText : c.strong }}>{quote.pool_per_unit_usd == null ? 'no one holds any yet' : `US$${trim(quote.pool_per_unit_usd, 4)}`}</dd>
          </dl>
          {quote.pool_short && (
            <p className="rounded-lg p-2.5 text-xs" style={{ background: c.warnBg, border: `1px solid ${c.warnBorder}`, color: c.warnText }} role="status">
              The pool holds a little less than the full inflation-protected value, so everyone shares the pool{'’'}s value until it catches up.
            </p>
          )}
          <p className="text-xs leading-relaxed" style={sub}>
            Your money is converted at the live rate and held in a shared pool as US dollars, so a falling local currency cannot shrink it. Nobody can promise it beats inflation, and it is not a bank deposit.
            {recipient ? ` The cash-out fee goes to ${recipient}.` : ''}
          </p>
          <a href="/" className={`inline-flex min-h-[44px] w-full items-center justify-center rounded-md px-5 py-2.5 text-sm font-semibold ${k.cta}`}>Open my IcanEra wallet</a>
        </div>

        <div className="overflow-hidden rounded-xl lg:col-span-3" style={card}>
          <p className="px-4 pt-3 text-sm" style={sub}>Value &amp; analysis</p>
          <div className="mt-2 h-[24rem] w-full lg:h-[28rem]">
            <IcanTradingChart rows={rows} loading={false} theme={theme} wheelZoom={false} feedState={live ? 'live' : 'delayed'}
              symbol="ICEC-S / UGX" initialTimeframe="1h" emptyNote="The value is recorded every minute from the live rates. Nothing here is simulated." />
          </div>
        </div>
      </div>
    </section>
  );
};

export default PublicStableCoin;

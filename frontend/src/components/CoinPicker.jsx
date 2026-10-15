import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { CHART_PALETTES } from './chartPalettes';
import { changeTone, formatLevel, formatPct, sectorState } from '../utils/sectorTradeRules';

// One collapsed control that chooses which coin the page's single chart shows: icaneracoin itself first, then the ten
// sector coins, each with its live level, 24h move and state. Closed it is one line, so the page stops spending a screen
// on a grid of cards; open it is a listbox (arrow keys, Home / End, Enter, Escape, tap outside to close).
//
// Colours are the page's own palette as inline styles, like PublicSectorMarkets (index.css remaps stock Tailwind colour
// classes onto theme variables these standalone pages lack).

export const ICAN_COIN = 'ICAN';

const CoinPicker = ({ theme = 'dark', skin: k, value, onChange, sectors, tradingEnabled, ican }) => {
  const c = CHART_PALETTES[theme] || CHART_PALETTES.dark;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const listRef = useRef(null);

  const tone = { up: c.pos, down: c.neg, flat: c.soft };
  const dot = { live: c.live, warming: c.book, paused: c.muted };

  // the highest 24h gain among sectors that can be traded gets a small tag, so the dropdown also answers "what is moving"
  const topMover = useMemo(() => {
    let best = null;
    sectors.forEach((s) => {
      const pct = Number(s.change_24h_pct);
      if (sectorState(s, tradingEnabled).kind === 'live' && Number.isFinite(pct) && pct > 0 && (!best || pct > best.pct)) best = { ticker: s.ticker, pct };
    });
    return best?.ticker || null;
  }, [sectors, tradingEnabled]);

  const options = useMemo(() => [
    {
      id: ICAN_COIN,
      ticker: ICAN_COIN,
      name: 'icaneracoin',
      level: ican?.price != null ? `UGX ${Number(ican.price).toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '—',
      pct: ican?.changePct ?? null,
      kind: 'live',
      label: 'Main coin',
    },
    ...sectors.map((s) => {
      const st = sectorState(s, tradingEnabled);
      return { id: s.ticker, ticker: s.ticker, name: s.name, level: formatLevel(s.level), pct: s.level != null ? s.change_24h_pct : null, kind: st.kind, label: st.label };
    }),
  ], [sectors, tradingEnabled, ican?.price, ican?.changePct]);

  const current = options.find((o) => o.id === value) || options[0];

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };
  const choose = (id) => { onChange(id); close(); };

  const toggle = () => {
    if (!open) setActive(Math.max(0, options.findIndex((o) => o.id === value)));
    setOpen((o) => !o);
  };

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown, { passive: true });
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('touchstart', onDown); };
  }, [open]);

  // keep the highlighted row visible while arrowing through a long list
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [open, active]);

  const onKeyDown = (e) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); toggle(); }
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(options.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(options.length - 1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(options[active].id); }
    else if (e.key === 'Tab') setOpen(false);
  };

  const row = (o, extra = {}) => (
    <>
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: dot[o.kind] }} aria-hidden="true" />
      <span className="min-w-0 flex-1 text-left">
        <span className="flex items-center gap-2">
          <span className={`font-mono font-bold ${k.kicker}`}>{o.ticker}</span>
          {extra.tag && <span className="rounded px-1.5 text-[10px] font-bold uppercase tracking-wide" style={{ background: c.okBg, color: c.okText }}>{extra.tag}</span>}
        </span>
        <span className="block truncate text-xs" style={{ color: c.muted }}>{o.name}</span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-sm font-semibold tabular-nums" style={{ color: c.strong }}>{o.level}</span>
        <span className="block text-xs tabular-nums" style={{ color: tone[changeTone(o.pct)] }}>{o.pct != null ? formatPct(o.pct) : o.kind === 'warming' ? 'Soon' : ' '}</span>
      </span>
    </>
  );

  return (
    <div ref={rootRef} className="relative mt-3" onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Choose a coin. Showing ${current.name}`}
        className="flex min-h-[56px] w-full items-center gap-3 rounded-xl px-3 py-2 transition"
        style={{ background: c.card, border: `1px solid ${open ? c.accent : c.cardBorder}`, color: c.fg }}
        data-testid="coin-picker"
      >
        {row(current)}
        <ChevronDown className="h-5 w-5 shrink-0 transition-transform" style={{ color: c.soft, transform: open ? 'rotate(180deg)' : 'none' }} aria-hidden="true" />
      </button>

      {open && (
        <ul
          ref={listRef}
          role="listbox"
          aria-label="Coins"
          aria-activedescendant={`coin-opt-${options[active].id}`}
          className="absolute left-0 right-0 z-20 mt-2 max-h-[60vh] overflow-y-auto rounded-xl p-1 shadow-2xl"
          style={{ background: c.sheet || c.card, border: `1px solid ${c.cardBorder}` }}
        >
          {options.map((o, i) => {
            const selected = o.id === current.id;
            return (
              <React.Fragment key={o.id}>
                {i === 1 && <li role="presentation" className="px-3 pb-1 pt-3 text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: c.muted }}>Sector coins · follow business sales</li>}
                <li
                  id={`coin-opt-${o.id}`}
                  role="option"
                  aria-selected={selected}
                  data-active={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(o.id)}
                  className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2"
                  style={{ background: i === active ? c.field : 'transparent' }}
                >
                  {row(o, { tag: o.id === topMover ? 'Top mover' : null })}
                  <Check className="h-4 w-4 shrink-0" style={{ color: c.accent, opacity: selected ? 1 : 0 }} aria-hidden="true" />
                </li>
              </React.Fragment>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default CoinPicker;

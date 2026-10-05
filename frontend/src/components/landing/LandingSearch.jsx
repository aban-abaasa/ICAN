import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Search, X, CornerDownLeft, ArrowUpRight } from 'lucide-react';

// Order the result groups appear in, both for an empty query (quick links)
// and for matches.
const GROUP_ORDER = ['Jump to', 'Developers', 'Account', 'About & info', 'Contact'];

const normalize = (value) => String(value || '').toLowerCase();

// Every typed word has to appear somewhere in the item; label hits rank
// above keyword/description hits so "pricing" finds Pricing first.
const scoreItem = (item, tokens) => {
  const label = normalize(item.label);
  const rest = normalize(`${item.description || ''} ${(item.keywords || []).join(' ')} ${item.group}`);
  let score = 0;
  for (const token of tokens) {
    if (label.startsWith(token)) score += 6;
    else if (label.includes(token)) score += 4;
    else if (rest.includes(token)) score += 1;
    else return 0;
  }
  return score;
};

/**
 * Landing-page search: a command-palette style dialog that jumps to a page
 * section, opens a link, or runs an action (sign in, open a footer panel...).
 *
 * `items` are built by the parent because they need its handlers:
 *   { id, group, label, description?, keywords?, href?, external?, onSelect? }
 * An item with `href` navigates; otherwise `onSelect` runs. The dialog closes
 * after either.
 */
const LandingSearch = ({ items, isDarkTheme, onClose }) => {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    // Stop the page behind the dialog scrolling while it is open.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  const results = useMemo(() => {
    const tokens = normalize(query).split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return items;
    return items
      .map((item) => ({ item, score: scoreItem(item, tokens) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.item);
  }, [items, query]);

  // Group in a stable order; the flat list drives keyboard navigation so the
  // arrow keys follow what is on screen.
  const { groups, flat } = useMemo(() => {
    const searching = query.trim().length > 0;
    const byGroup = new Map();
    results.forEach((item) => {
      if (!byGroup.has(item.group)) byGroup.set(item.group, []);
      byGroup.get(item.group).push(item);
    });
    const ordered = searching
      ? [{ name: 'Results', entries: results }]
      : GROUP_ORDER.filter((name) => byGroup.has(name)).map((name) => ({ name, entries: byGroup.get(name) }));
    return { groups: ordered, flat: ordered.flatMap((group) => group.entries) };
  }, [results, query]);

  useEffect(() => { setActive(0); }, [query]);

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, flat]);

  const choose = (item) => {
    if (!item) return;
    onClose();
    if (item.href) {
      if (item.external) window.open(item.href, '_blank', 'noopener,noreferrer');
      else window.location.assign(item.href);
      return;
    }
    // Let the dialog unmount (and the body scroll lock lift) before scrolling.
    setTimeout(() => item.onSelect?.(), 0);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (flat.length ? (i + 1) % flat.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (flat.length ? (i - 1 + flat.length) % flat.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(flat[active]);
    }
  };

  const ink = isDarkTheme ? 'text-slate-100' : 'text-[#1f1a12]';
  const muted = isDarkTheme ? 'text-slate-400' : 'text-[#6b5f49]';
  const rule = isDarkTheme ? 'border-slate-700' : 'border-[#1f1a12]/20';

  let rowIndex = -1;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-slate-950/70 px-3 pt-[8vh] backdrop-blur-sm sm:pt-[12vh]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search IcanEra"
        className={`flex max-h-[78vh] w-full max-w-xl flex-col overflow-hidden border-2 shadow-2xl ${isDarkTheme ? 'border-amber-300/50 bg-slate-900' : 'border-[#1f1a12] bg-[#fffdf6]'}`}
        onKeyDown={handleKeyDown}
      >
        <div className={`flex items-center gap-3 border-b px-4 py-3 ${rule}`}>
          <Search className={`h-5 w-5 shrink-0 ${isDarkTheme ? 'text-amber-300' : 'text-emerald-900'}`} aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pages, developers, pricing…"
            aria-label="Search IcanEra"
            role="combobox"
            aria-expanded="true"
            aria-controls="landing-search-results"
            aria-activedescendant={flat[active] ? `landing-search-${flat[active].id}` : undefined}
            autoComplete="off"
            spellCheck={false}
            className={`ican-search-input min-w-0 flex-1 bg-transparent text-base outline-none placeholder:opacity-60 ${ink}`}
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close search"
            className={`ican-search-btn inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${muted}`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div ref={listRef} id="landing-search-results" role="listbox" className="flex-1 overflow-y-auto overscroll-contain py-1">
          {flat.length === 0 && (
            <div className={`px-5 py-10 text-center text-sm ${muted}`}>
              Nothing found for <span className={`font-semibold ${ink}`}>“{query.trim()}”</span>. Try “developers”, “pricing” or “contact”.
            </div>
          )}
          {groups.map((group) => (
            <div key={group.name} role="group" aria-label={group.name}>
              <div className={`px-5 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.2em] ${muted}`}>{group.name}</div>
              {group.entries.map((item) => {
                rowIndex += 1;
                const isActive = rowIndex === active;
                const index = rowIndex;
                return (
                  <div
                    key={item.id}
                    id={`landing-search-${item.id}`}
                    role="option"
                    aria-selected={isActive}
                    data-active={isActive}
                    onClick={() => choose(item)}
                    onMouseMove={() => { if (active !== index) setActive(index); }}
                    className={`mx-2 flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 ${isActive ? (isDarkTheme ? 'bg-amber-300/15' : 'bg-emerald-900/10') : ''}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className={`truncate text-sm font-semibold ${ink}`}>{item.label}</div>
                      {item.description && <div className={`truncate text-xs ${muted}`}>{item.description}</div>}
                    </div>
                    {item.href && <ArrowUpRight className={`h-4 w-4 shrink-0 ${muted}`} aria-hidden="true" />}
                    {isActive && !item.href && <CornerDownLeft className={`h-4 w-4 shrink-0 ${muted}`} aria-hidden="true" />}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <div className={`hidden items-center justify-between border-t px-4 py-2 text-[11px] sm:flex ${rule} ${muted}`}>
          <span>↑ ↓ to move · Enter to open · Esc to close</span>
          <span>Press / or Ctrl K anytime</span>
        </div>
      </div>
    </div>
  );
};

export default LandingSearch;

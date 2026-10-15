import React, { useMemo, useRef, useState } from 'react';
import { Check, Loader2, Minus, Plus, Trash2 } from 'lucide-react';
import { createBillFromPayCode } from '../services/publicTransactionService';

/**
 * "Pay any amount": the customer types what they are paying for and the price — one amount, or a list of
 * items — and their name. Continues to /r/<bill> where they choose cash / IcanEra wallet / Mobile Money /
 * card / bank and keep the receipt.
 *
 * Shared by the business's own website (the "Pay" tab of /notices/<company>, skin "nb" = that site's palette)
 * and the standalone /p/<code> page (skin "ptx" = the classic receipt look).
 *
 * Picking many items is quick: when the business has products, tap them in the "Quick add" strip (each tap
 * adds one, with the count on the chip), type a few letters of a name to get its price filled in, or paste a
 * whole list ("Eggs 5,000 x2", one per line) and it is split into items. The same item twice becomes one
 * line with the quantity added up.
 */

const SKINS = {
  ptx: {
    wrap: 'ptx-stack', item: 'ptx-item', input: 'ptx-input', row: 'ptx-field-row', primary: 'ptx-btn ptx-primary',
    ghost: 'ptx-ghost', total: 'ptx-total', totalLabel: '', totalValue: '', err: 'ptx-err', note: 'ptx-note',
    rule: 'ptx-rule', iconbtn: 'ptx-iconbtn', tight: 'ptx-stack-tight',
    picks: 'ptx-picks', pick: 'ptx-pick', pickOn: 'ptx-pick ptx-pick-on', suggest: 'ptx-suggest', suggestItem: 'ptx-suggest-item',
    stepper: 'ptx-stepper', sub: 'ptx-note', label: 'ptx-note', ok: 'ptx-note',
  },
  nb: {
    wrap: 'space-y-3', item: 'nb-surface-alt border nb-border rounded-xl p-3 space-y-2',
    input: 'nb-input w-full rounded-xl px-3.5 py-3 text-base min-h-[48px]',
    row: 'flex gap-2 items-center',
    primary: 'w-full min-h-[48px] py-3 rounded-xl nb-btn-primary font-semibold flex items-center justify-center gap-2 disabled:opacity-50 transition',
    ghost: 'nb-link text-sm font-semibold inline-flex items-center gap-1 min-h-[44px]',
    total: 'flex justify-between items-baseline pt-3 border-t nb-border-strong', totalLabel: 'font-semibold nb-text',
    totalValue: 'text-2xl font-extrabold nb-text', err: 'nb-error-text text-sm', note: 'text-xs nb-text-faint text-center leading-relaxed',
    rule: 'border-t nb-border', iconbtn: 'nb-text-faint min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg', tight: 'space-y-2',
    picks: 'flex gap-2 overflow-x-auto pb-1 -mx-1 px-1',
    pick: 'nb-option flex-none rounded-full px-3.5 min-h-[40px] text-sm font-semibold whitespace-nowrap inline-flex items-center gap-1.5 transition',
    pickOn: 'nb-option-selected flex-none rounded-full px-3.5 min-h-[40px] text-sm font-semibold whitespace-nowrap inline-flex items-center gap-1.5 transition',
    suggest: 'nb-surface border nb-border-strong rounded-xl overflow-hidden shadow-sm',
    suggestItem: 'w-full min-h-[44px] px-3.5 flex justify-between items-center gap-3 text-left text-sm nb-text border-b nb-border last:border-b-0',
    stepper: 'nb-surface border nb-border-strong rounded-xl inline-flex items-center flex-none',
    sub: 'text-xs nb-text-faint', label: 'text-xs font-semibold nb-text-muted', ok: 'text-xs nb-text-muted',
  },
};

const MAX_ROWS = 20;
const formatMoney = (amount) => `UGX ${Number(amount || 0).toLocaleString('en-UG', { maximumFractionDigits: 0 })}`;
const digits = (value) => String(value || '').replace(/[^0-9]/g, '');
const norm = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
const qtyOf = (r) => Math.max(1, Number(digits(r.qty)) || 1);
const priceOf = (r) => Number(digits(r.price)) || 0;
const isBlank = (r) => !r.name.trim() && !priceOf(r);

let rowSeq = 0;
const blankRow = () => ({ id: `r${++rowSeq}`, name: '', price: '', qty: '1', pid: null });
const makeRow = ({ name = '', price = 0, qty = 1, pid = null }) => ({
  id: `r${++rowSeq}`,
  name: String(name || '').slice(0, 80),
  price: String(Math.round(Number(price) || 0) || ''),
  qty: String(Math.min(99999, Math.max(1, Math.round(Number(qty)) || 1))),
  pid: pid == null ? null : String(pid),
});

/** Same item at the same price twice -> one line, quantities added. Lines with no name are never merged. */
const mergeRows = (rows) => {
  const out = [];
  rows.forEach((r) => {
    const twin = r.name.trim() ? out.find((o) => norm(o.name) === norm(r.name) && priceOf(o) === priceOf(r)) : null;
    if (twin) twin.qty = String(Math.min(99999, qtyOf(twin) + qtyOf(r)));
    else out.push({ ...r });
  });
  return out;
};

const findInCatalog = (catalog, name) => {
  const n = norm(name);
  if (!n) return null;
  return catalog.find((c) => norm(c.name) === n) || null;
};

/** "2.5k" -> 2500, "2,500" -> 2500, "2.500" -> 2500 (dot as thousands), "1500" -> 1500. */
const parseAmount = (raw, kilo) => {
  let s = String(raw).replace(/,/g, '');
  if (!kilo && /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return 0;
  return Math.round(kilo ? n * 1000 : n);
};

/** One typed/pasted line -> { name, price, qty } (price 0 when none was given). */
const parseLine = (line, catalog) => {
  let text = line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim();
  let qty = 1;
  const trailingQty = text.match(/(?:^|\s)[x×]\s?(\d{1,4})(?=\s|$)/i) || text.match(/(?:^|\s)(\d{1,4})\s?[x×](?=\s|$)/i);
  if (trailingQty) {
    qty = Number(trailingQty[1]) || 1;
    text = text.replace(trailingQty[0], ' ').trim();
  }
  let price = 0;
  const priceMatch = text.match(/(\d[\d,.]*)\s?(k)?\s*(?:ugx|ush|shs?|\/=|=)?\s*$/i);
  if (priceMatch && (priceMatch.index === 0 ? true : /\s|[:@=-]/.test(text[priceMatch.index - 1] || ' '))) {
    price = parseAmount(priceMatch[1], Boolean(priceMatch[2]));
    text = text.slice(0, priceMatch.index);
  }
  let name = text.replace(/\bugx\b|\bshs?\b/gi, '').replace(/[\s:@=\-–—]+$/g, '').trim();
  if (!trailingQty) {
    // "3 Samosas 500": a leading count in front of a name.
    const lead = name.match(/^(\d{1,3})\s+(?=\D)/);
    if (lead && price > 0) { qty = Number(lead[1]) || 1; name = name.slice(lead[0].length).trim(); }
  }
  let pid = null;
  const hit = findInCatalog(catalog, name);
  if (hit) { pid = hit.id; if (!price) price = hit.price; name = hit.name; }
  return { name: name.slice(0, 80), price, qty, pid };
};

const parseList = (text, catalog) => String(text || '')
  .split(/\r?\n|;|•|,\s+(?=\D)/)
  .map((l) => l.trim())
  .filter(Boolean)
  .map((l) => parseLine(l, catalog))
  .filter((it) => it.name || it.price > 0);

export default function PayAnyAmountForm({ code, info, skin = 'ptx', initialItems = null, catalog = [], onBillCreated = null }) {
  const k = SKINS[skin] || SKINS.ptx;
  // initialItems ([{ name, price, qty, product_id }]) pre-fills the list, e.g. products ticked on the Market tab.
  const [rows, setRows] = useState(() => (initialItems?.length
    ? mergeRows(initialItems.map((it) => makeRow({ name: it.name, price: it.price, qty: it.qty, pid: it.product_id })))
    : [blankRow()]));
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');
  const [focusId, setFocusId] = useState(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const lastNameRef = useRef(null);

  const total = useMemo(() => rows.reduce((sum, r) => sum + priceOf(r) * qtyOf(r), 0), [rows]);
  const itemCount = useMemo(() => rows.reduce((sum, r) => sum + (priceOf(r) > 0 ? qtyOf(r) : 0), 0), [rows]);
  const multi = rows.length > 1;
  const tooMuch = Boolean(info?.max_amount_ugx && total > Number(info.max_amount_ugx));
  const qtyInRows = useMemo(() => {
    const map = {};
    rows.forEach((r) => { if (r.pid) map[r.pid] = (map[r.pid] || 0) + qtyOf(r); });
    return map;
  }, [rows]);

  const setRow = (i, patch) => setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRow = () => {
    setRows((prev) => [...prev, blankRow()]);
    setTimeout(() => lastNameRef.current?.focus(), 30);
  };

  // Adds parsed/picked entries: they fill the empty row first, an item already listed gets its quantity raised.
  const addEntries = (entries) => {
    setRows((prev) => {
      const base = prev.length === 1 && isBlank(prev[0]) ? [] : prev.filter((r) => !isBlank(r));
      return mergeRows([...base, ...entries.map(makeRow)]).slice(0, MAX_ROWS);
    });
  };
  const addFromCatalog = (item) => {
    setHint('');
    setRows((prev) => {
      const same = prev.find((r) => r.pid === item.id);
      if (same) return prev.map((r) => (r === same ? { ...r, qty: String(Math.min(99999, qtyOf(r) + 1)) } : r));
      const base = prev.length === 1 && isBlank(prev[0]) ? [] : prev.filter((r) => !isBlank(r));
      if (base.length >= MAX_ROWS) return prev;
      return [...base, makeRow({ name: item.name, price: item.price, qty: 1, pid: item.id })];
    });
  };
  const bumpQty = (i, delta) => setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, qty: String(Math.min(99999, Math.max(1, qtyOf(r) + delta))) } : r)));

  const suggestionsFor = (row) => {
    if (!catalog.length) return [];
    const q = norm(row.name);
    return catalog
      .filter((c) => (!q || norm(c.name).includes(q)) && norm(c.name) !== q)
      .slice(0, 5);
  };
  const pickSuggestion = (i, item) => {
    setRow(i, { name: item.name, price: String(item.price || ''), pid: item.id });
    setFocusId(null);
  };
  // Typed a product's exact name and no price yet -> fill the price in when leaving the field.
  const settleName = (i, row) => {
    setFocusId((cur) => (cur === row.id ? null : cur));
    const hit = findInCatalog(catalog, row.name);
    if (hit && !priceOf(row)) setRow(i, { name: hit.name, price: String(hit.price || ''), pid: hit.id });
  };

  const handlePaste = (event) => {
    const text = event.clipboardData?.getData('text') || '';
    if (!/\r?\n|;|,\s+\D/.test(text)) return; // a single value: let it paste normally
    const entries = parseList(text, catalog);
    if (entries.length < 2) return;
    event.preventDefault();
    addEntries(entries);
    setHint(`Added ${entries.length} items from your list — check the prices.`);
  };
  const addBulk = () => {
    const entries = parseList(bulkText, catalog);
    if (entries.length === 0) { setHint('Write one item per line, like: Eggs 5000 x2'); return; }
    addEntries(entries);
    setHint(`Added ${entries.length} item${entries.length === 1 ? '' : 's'} — check the prices.`);
    setBulkText('');
    setBulkOpen(false);
  };

  const submit = async (event) => {
    event?.preventDefault();
    setError('');
    const items = mergeRows(rows)
      .map((r) => ({ name: r.name.trim(), price: priceOf(r), qty: qtyOf(r) }))
      .filter((r) => r.price > 0 || r.name);
    if (items.length === 0 || items.some((r) => r.price <= 0)) { setError('Enter the price for everything you list.'); return; }
    if (tooMuch) { setError(`The most this business accepts at once is ${formatMoney(info.max_amount_ugx)}.`); return; }
    if (name.trim().length < 2) { setError('Enter your name so your receipt carries it.'); return; }
    setBusy(true);
    try {
      const bill = await createBillFromPayCode({ code, items, name: name.trim() });
      const params = new URLSearchParams({ n: name.trim() });
      if (digits(phone).length >= 9) params.set('p', phone.trim());
      try { onBillCreated?.(bill); } catch { /* the bill exists either way */ }
      window.location.assign(`/r/${bill.code}?${params.toString()}`);
    } catch (err) {
      setError(err.message || 'Could not start this payment. Please try again.');
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className={k.wrap}>
      {catalog.length > 0 && (
        <div className={k.tight}>
          <p className={k.label} style={{ fontWeight: 700 }}>Quick add — tap each thing you are paying for</p>
          <div className={k.picks}>
            {catalog.map((c) => {
              const n = qtyInRows[c.id] || 0;
              return (
                <button key={c.id} type="button" className={n ? k.pickOn : k.pick} onClick={() => addFromCatalog(c)} aria-pressed={n > 0}>
                  {n > 0 ? <Check width={14} height={14} /> : <Plus width={14} height={14} />}
                  <span>{c.name}</span>
                  <span style={{ opacity: 0.75, fontWeight: 600 }}>{n > 0 ? `×${n}` : Number(c.price).toLocaleString('en-UG')}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {rows.map((row, i) => {
        const showQty = multi || Boolean(row.pid) || qtyOf(row) > 1;
        const sugg = focusId === row.id ? suggestionsFor(row) : [];
        const line = priceOf(row) * qtyOf(row);
        return (
          <div key={row.id} className={k.item}>
            <input
              ref={i === rows.length - 1 ? lastNameRef : null}
              className={k.input}
              placeholder={multi ? `Item ${i + 1} — e.g. Haircut` : 'What is it for? (optional)'}
              value={row.name}
              maxLength={80}
              onChange={(e) => setRow(i, { name: e.target.value, pid: null })}
              onFocus={() => setFocusId(row.id)}
              onBlur={() => settleName(i, row)}
              onPaste={handlePaste}
              autoComplete="off"
              aria-label={multi ? `Item ${i + 1} name` : 'What it is for'}
            />
            {sugg.length > 0 && (
              <div className={k.suggest} role="listbox" aria-label="Matching products">
                {sugg.map((c) => (
                  <button
                    key={c.id} type="button" role="option" className={k.suggestItem}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickSuggestion(i, c)}
                  >
                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                    <strong style={{ flex: 'none' }}>{formatMoney(c.price)}</strong>
                  </button>
                ))}
              </div>
            )}
            <div className={k.row}>
              <input
                className={k.input}
                style={{ flex: 1, minWidth: 0 }}
                placeholder={multi ? 'Price (UGX)' : 'Amount (UGX)'}
                inputMode="numeric"
                value={row.price ? Number(digits(row.price)).toLocaleString('en-UG') : ''}
                onChange={(e) => setRow(i, { price: digits(e.target.value) })}
                aria-label={multi ? `Item ${i + 1} price` : 'Amount'}
              />
              {showQty && (
                <div className={k.stepper}>
                  <button type="button" onClick={() => bumpQty(i, -1)} disabled={qtyOf(row) <= 1} aria-label={`Fewer of item ${i + 1}`}
                    className={skin === 'nb' ? 'w-11 min-h-[46px] flex items-center justify-center nb-text disabled:opacity-30' : undefined}>
                    <Minus width={16} height={16} />
                  </button>
                  <input
                    inputMode="numeric"
                    value={row.qty}
                    onChange={(e) => setRow(i, { qty: digits(e.target.value).slice(0, 5) })}
                    onBlur={() => setRow(i, { qty: String(qtyOf(row)) })}
                    aria-label={`Item ${i + 1} quantity`}
                    className={skin === 'nb' ? 'w-9 text-center bg-transparent border-0 nb-text font-bold text-base p-0 focus:outline-none' : undefined}
                  />
                  <button type="button" onClick={() => bumpQty(i, 1)} aria-label={`More of item ${i + 1}`}
                    className={skin === 'nb' ? 'w-11 min-h-[46px] flex items-center justify-center nb-text' : undefined}>
                    <Plus width={16} height={16} />
                  </button>
                </div>
              )}
              {multi && (
                <button type="button" className={k.iconbtn} onClick={() => setRows((prev) => prev.filter((_, idx) => idx !== i))} aria-label={`Remove item ${i + 1}`}>
                  <Trash2 width={18} height={18} />
                </button>
              )}
            </div>
            {line > 0 && qtyOf(row) > 1 && (
              <p className={k.sub} style={{ textAlign: 'right' }}>{qtyOf(row)} × {formatMoney(priceOf(row))} = <strong>{formatMoney(line)}</strong></p>
            )}
          </div>
        );
      })}

      {hint && <p className={k.ok} role="status">{hint}</p>}

      {bulkOpen && (
        <div className={k.tight}>
          <textarea
            className={k.input}
            rows={5}
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            placeholder={'One item per line, e.g.\nEggs 5000 x2\nMilk 3,500\n3 Samosas 500'}
            aria-label="Paste your list"
            style={{ minHeight: 120, resize: 'vertical' }}
          />
          <div className={k.row}>
            <button type="button" className={k.ghost} onClick={addBulk}><Plus width={16} height={16} /> Add these items</button>
            <button type="button" className={k.ghost} onClick={() => { setBulkOpen(false); setBulkText(''); }}>Cancel</button>
          </div>
        </div>
      )}

      <div className={k.row} style={{ flexWrap: 'wrap', justifyContent: 'space-between' }}>
        {rows.length < MAX_ROWS && (
          <button type="button" className={k.ghost} onClick={addRow}>
            <Plus width={16} height={16} /> {multi ? 'Add another item' : 'List several items instead'}
          </button>
        )}
        {!bulkOpen && rows.length < MAX_ROWS && (
          <button type="button" className={k.ghost} onClick={() => setBulkOpen(true)}>Paste a list</button>
        )}
        {multi && (
          <button type="button" className={k.ghost} onClick={() => { setRows([blankRow()]); setHint(''); }}>Clear all</button>
        )}
      </div>

      <div className={k.total}>
        <span className={k.totalLabel} style={{ fontWeight: 700 }}>Total{itemCount > 1 ? ` · ${itemCount} items` : ''}</span>
        <strong className={k.totalValue}>{formatMoney(total)}</strong>
      </div>
      {tooMuch && <p className={k.err}>The most this business accepts at once is {formatMoney(info.max_amount_ugx)}.</p>}

      <hr className={k.rule} />

      <div className={k.tight}>
        <input className={k.input} placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80} aria-label="Your name" />
        <input className={k.input} placeholder="Your phone — for Mobile Money (optional)" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" aria-label="Your phone" />
      </div>

      {error && <p className={k.err} role="alert">{error}</p>}

      <button type="submit" className={k.primary} disabled={busy || total <= 0 || tooMuch}>
        {busy ? <Loader2 className="animate-spin" width={18} height={18} /> : null}
        {total > 0 ? `Continue — pay ${formatMoney(total)}` : 'Continue'}
      </button>
      <p className={k.note} style={{ textAlign: 'center' }}>
        Next: cash, IcanEra wallet, Mobile Money, card or bank. {info?.issuer_name || 'The seller'} confirms your payment{info?.approval_required === false ? ' instantly' : ''} and your receipt stays on this phone.
      </p>
    </form>
  );
}

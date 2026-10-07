import React, { useMemo, useRef, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { createBillFromPayCode } from '../services/publicTransactionService';

/**
 * "Pay any amount": the customer types what they are paying for and the price — one amount, or a list of
 * items — and their name. Continues to /r/<bill> where they choose cash / IcanEra wallet / Mobile Money /
 * card / bank and keep the receipt.
 *
 * Shared by the business's own website (the "Pay" tab of /notices/<company>, skin "nb" = that site's palette)
 * and the standalone /p/<code> page (skin "ptx" = the classic receipt look).
 */

const SKINS = {
  ptx: {
    wrap: 'ptx-stack', item: 'ptx-item', input: 'ptx-input', row: 'ptx-field-row', primary: 'ptx-btn ptx-primary',
    ghost: 'ptx-ghost', total: 'ptx-total', totalLabel: '', totalValue: '', err: 'ptx-err', note: 'ptx-note',
    rule: 'ptx-rule', iconbtn: 'ptx-iconbtn', tight: 'ptx-stack-tight',
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
  },
};

const formatMoney = (amount) => `UGX ${Number(amount || 0).toLocaleString('en-UG', { maximumFractionDigits: 0 })}`;
const digits = (value) => String(value || '').replace(/[^0-9]/g, '');
const blankRow = () => ({ name: '', price: '', qty: '1' });

export default function PayAnyAmountForm({ code, info, skin = 'ptx' }) {
  const k = SKINS[skin] || SKINS.ptx;
  const [rows, setRows] = useState([blankRow()]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lastNameRef = useRef(null);

  const total = useMemo(
    () => rows.reduce((sum, r) => sum + (Number(digits(r.price)) || 0) * Math.max(1, Number(digits(r.qty)) || 1), 0),
    [rows],
  );
  const multi = rows.length > 1;
  const tooMuch = Boolean(info?.max_amount_ugx && total > Number(info.max_amount_ugx));
  const setRow = (i, patch) => setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRow = () => {
    setRows((prev) => [...prev, blankRow()]);
    setTimeout(() => lastNameRef.current?.focus(), 30);
  };

  const submit = async (event) => {
    event?.preventDefault();
    setError('');
    const items = rows
      .map((r) => ({ name: r.name.trim(), price: Number(digits(r.price)) || 0, qty: Math.max(1, Number(digits(r.qty)) || 1) }))
      .filter((r) => r.price > 0 || r.name);
    if (items.length === 0 || items.some((r) => r.price <= 0)) { setError('Enter the price for everything you list.'); return; }
    if (tooMuch) { setError(`The most this business accepts at once is ${formatMoney(info.max_amount_ugx)}.`); return; }
    if (name.trim().length < 2) { setError('Enter your name so your receipt carries it.'); return; }
    setBusy(true);
    try {
      const bill = await createBillFromPayCode({ code, items, name: name.trim() });
      const params = new URLSearchParams({ n: name.trim() });
      if (digits(phone).length >= 9) params.set('p', phone.trim());
      window.location.assign(`/r/${bill.code}?${params.toString()}`);
    } catch (err) {
      setError(err.message || 'Could not start this payment. Please try again.');
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className={k.wrap}>
      {rows.map((row, i) => (
        <div key={i} className={k.item}>
          <input
            ref={i === rows.length - 1 ? lastNameRef : null}
            className={k.input}
            placeholder={multi ? `Item ${i + 1} — e.g. Haircut` : 'What is it for? (optional)'}
            value={row.name}
            maxLength={80}
            onChange={(e) => setRow(i, { name: e.target.value })}
            aria-label={multi ? `Item ${i + 1} name` : 'What it is for'}
          />
          <div className={k.row}>
            <input
              className={k.input}
              style={{ flex: 1 }}
              placeholder={multi ? 'Price (UGX)' : 'Amount (UGX)'}
              inputMode="numeric"
              value={row.price ? Number(digits(row.price)).toLocaleString('en-UG') : ''}
              onChange={(e) => setRow(i, { price: digits(e.target.value) })}
              aria-label={multi ? `Item ${i + 1} price` : 'Amount'}
            />
            {multi && (
              <input
                className={k.input}
                style={{ width: 74, flex: 'none' }}
                placeholder="Qty"
                inputMode="numeric"
                value={row.qty}
                onChange={(e) => setRow(i, { qty: digits(e.target.value).slice(0, 5) })}
                aria-label={`Item ${i + 1} quantity`}
              />
            )}
            {multi && (
              <button type="button" className={k.iconbtn} onClick={() => setRows((prev) => prev.filter((_, idx) => idx !== i))} aria-label={`Remove item ${i + 1}`}>
                <Trash2 width={18} height={18} />
              </button>
            )}
          </div>
        </div>
      ))}

      {rows.length < 20 && (
        <button type="button" className={k.ghost} onClick={addRow}>
          <Plus width={16} height={16} /> {multi ? 'Add another item' : 'List several items instead'}
        </button>
      )}

      <div className={k.total}>
        <span className={k.totalLabel} style={{ fontWeight: 700 }}>Total</span>
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

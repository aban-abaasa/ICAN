import React, { useCallback, useEffect, useState } from 'react';
import { Loader, Wallet, Plus } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getBalance } from '../services/icanWalletService';
import { topUpIcanWallet, ICAN_TO_UGX } from '../services/walletTopUpService';
import { TOPUP_CURRENCIES, decimalsFor, formatMoney, getTopUpQuote, minTopUp, niceCeil } from '../services/topUpCurrency';

const SKINS = {
  slate: {
    wrap: 'rounded-xl border border-slate-700 bg-slate-900/60 p-3 space-y-2',
    short: 'rounded-xl border border-amber-500/50 bg-amber-500/10 p-3 space-y-2',
    head: 'text-white', body: 'text-slate-400', ok: 'text-emerald-400', warn: 'text-amber-300', err: 'text-xs text-red-400',
    input: 'w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500',
    chip: 'px-2.5 py-1 rounded-full border border-slate-700 text-[11px] text-slate-300 hover:border-indigo-400 hover:text-white',
    btn: 'w-full min-h-[44px] py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-semibold transition flex items-center justify-center gap-2',
    link: 'text-xs text-indigo-300 underline hover:text-white',
  },
  nb: {
    wrap: 'rounded-xl border nb-border nb-surface-alt p-3 space-y-2',
    short: 'rounded-xl border nb-border-strong nb-surface-alt p-3 space-y-2',
    head: 'nb-text', body: 'nb-text-muted', ok: 'nb-text', warn: 'nb-text', err: 'nb-error-text text-xs',
    input: 'w-full px-3 py-2 rounded-xl nb-input text-sm',
    chip: 'px-2.5 py-1 rounded-full border nb-border text-[11px] nb-text-muted',
    btn: 'w-full min-h-[44px] py-2.5 rounded-xl nb-btn-primary disabled:opacity-50 text-sm font-semibold transition flex items-center justify-center gap-2',
    link: 'text-xs nb-link underline',
  },
};

/**
 * "Your wallet has X ICAN" at checkout, with a top-up that works in place. When the balance can't cover the
 * order the panel opens by itself with the shortfall filled in; otherwise it stays a one-line balance with a
 * "Top up" link. Payment is a normal Flutterwave checkout (card, Mobile Money or bank) verified on the server,
 * which then credits the same ICAN wallet checkout spends from -- see walletTopUpService.
 *
 *   neededUgx   what this order costs in UGX (shown to the customer in their own currency)
 *   forceOpen   true after the server reported an insufficient balance
 */
export default function WalletTopUpInline({ skin = 'slate', neededUgx = 0, forceOpen = false, customerName = '', customerPhone = '' }) {
  const k = SKINS[skin] || SKINS.slate;
  const { user } = useAuth();
  const [balanceIcan, setBalanceIcan] = useState(null);
  const [quote, setQuote] = useState(null); // { currency, price }: the LIVE price of one coin in the customer's own currency
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const refresh = useCallback(async () => {
    if (!user?.id) return null;
    try {
      const b = await getBalance(user.id);
      setBalanceIcan(b.ican);
      return b.ican;
    } catch {
      setBalanceIcan(null);
      return null;
    }
  }, [user?.id]);

  useEffect(() => { refresh(); }, [refresh]);

  // The live price, kept fresh while this panel is on screen.
  useEffect(() => {
    if (!user?.id) return undefined;
    let cancelled = false;
    const load = () => getTopUpQuote().then((q) => { if (!cancelled) setQuote(q); }).catch(() => {});
    load();
    const timer = setInterval(load, 60 * 1000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [user?.id]);

  const cur = quote?.currency || 'UGX';
  const price = quote?.price || 0;
  const money = (ican) => formatMoney(ican * price, cur);
  const min = price ? minTopUp(cur, price) : 0;
  // Checkout spends coins at ICAN_TO_UGX per coin, so that is what the order needs in coins.
  const neededIcan = neededUgx / ICAN_TO_UGX;
  const shortIcan = balanceIcan == null ? 0 : Math.max(0, neededIcan - balanceIcan);
  const isShort = shortIcan > 1e-6;
  const suggested = price ? Math.max(min, niceCeil(Math.max(shortIcan, 0.0001) * price * 1.01)) : 0;

  // Open by itself, with the shortfall filled in, whenever the wallet can't cover the order.
  useEffect(() => {
    if (!quote) return;
    if (isShort || forceOpen) {
      setOpen(true);
      setAmount((prev) => prev || String(suggested));
    }
  }, [isShort, forceOpen, quote?.currency]); // eslint-disable-line react-hooks/exhaustive-deps

  const pay = async () => {
    setError('');
    setDone('');
    setBusy(true);
    try {
      const res = await topUpIcanWallet({
        amount: Number(amount),
        customerEmail: user?.email,
        customerName: customerName || user?.user_metadata?.full_name,
        customerPhone,
      });
      if (res.success) {
        const now = await refresh();
        setDone(`Added ${res.icanAmount.toFixed(4)} ICAN for ${formatMoney(res.local, res.currency)} (live price ${formatMoney(res.price, res.currency)} per coin).`);
        setAmount('');
        if (now != null && now + 1e-6 >= neededIcan) setOpen(false);
      } else if (!res.cancelled) {
        setError(res.error || 'Top-up failed. Please try again.');
        if (res.paid) refresh();
      }
    } catch (err) {
      setError(err?.message || 'Top-up failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (balanceIcan == null && !open) return null; // balance unreadable: stay out of the way

  const presets = price
    ? [...new Set([isShort ? suggested : null, ...[0.5, 1, 2].map((n) => Math.max(min, niceCeil(price * n)))].filter(Boolean))].slice(0, 4)
    : [];
  const decimals = decimalsFor(cur);
  const coinsForAmount = price && Number(amount) > 0 ? Number(amount) / price : 0;

  return (
    <div className={isShort ? k.short : k.wrap} data-testid="wallet-topup">
      <div className="flex items-center justify-between gap-2">
        <p className={`text-xs flex items-center gap-1.5 ${k.head}`}>
          <Wallet className="w-3.5 h-3.5" />
          Wallet: <b>{(balanceIcan ?? 0).toFixed(4)} ICAN</b> {price > 0 && <span className={k.body}>(≈ {money(balanceIcan ?? 0)})</span>}
        </p>
        {!open && <button type="button" onClick={() => setOpen(true)} className={`${k.link} flex items-center gap-1`}><Plus className="w-3 h-3" />Top up</button>}
      </div>
      {isShort && <p className={`text-xs ${k.warn}`}>This order needs {neededIcan.toFixed(4)} ICAN — add at least {shortIcan.toFixed(4)} ICAN{price > 0 ? ` (≈ ${money(shortIcan)})` : ''} to pay with your wallet.</p>}
      {done && <p className={`text-xs ${k.ok}`}>{done}</p>}

      {open && (
        <div className="space-y-2">
          {price > 0 ? (
            <>
              <p className={`text-[11px] flex items-center gap-1.5 ${k.body}`}>
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Live price: 1 ICAN = <b>{formatMoney(price, cur)}</b> — you pay in {cur}, your country's currency.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {presets.map((p) => <button key={p} type="button" onClick={() => setAmount(String(p))} className={k.chip}>{formatMoney(p, cur)}</button>)}
              </div>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(decimals ? /[^\d.]/g : /[^\d]/g, ''))}
                inputMode={decimals ? 'decimal' : 'numeric'}
                placeholder={`Amount in ${cur} (min ${formatMoney(min, cur)})`}
                aria-label={`Top-up amount in ${cur}`}
                className={k.input}
              />
              <button type="button" onClick={pay} disabled={busy || !(Number(amount) >= min)} className={k.btn}>
                {busy ? <Loader className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                {busy ? 'Waiting for payment…' : `Top up ${formatMoney(Number(amount) || 0, cur)} with ${TOPUP_CURRENCIES[cur].label}`}
              </button>
              {coinsForAmount > 0 && <p className={`text-[11px] ${k.body}`}>≈ {coinsForAmount.toFixed(4)} ICAN at the live price. The price is re-checked the moment you pay, and your coins arrive as soon as the payment is confirmed.</p>}
            </>
          ) : (
            <p className={`text-xs ${k.body}`}><Loader className="w-3 h-3 animate-spin inline mr-1" />Getting the live coin price…</p>
          )}
          {!isShort && <p className="text-center"><button type="button" onClick={() => { setOpen(false); setError(''); }} className={k.link}>Close</button></p>}
        </div>
      )}
      {error && <p className={k.err} role="alert">{error}</p>}
    </div>
  );
}

import React, { useCallback, useEffect, useState } from 'react';
import { Loader, Wallet, Plus } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getBalance } from '../services/icanWalletService';
import { topUpIcanWallet, MIN_TOPUP_UGX, ICAN_TO_UGX } from '../services/walletTopUpService';

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

const fmt = (n) => Math.round(Number(n) || 0).toLocaleString();
const roundUp = (n, step = 1000) => Math.ceil(n / step) * step;

/**
 * "Your wallet has X ICAN" at checkout, with a top-up that works in place. When the balance can't cover the
 * order the panel opens by itself with the shortfall filled in; otherwise it stays a one-line balance with a
 * "Top up" link. Payment is a normal Flutterwave checkout (card, Mobile Money or bank) verified on the server,
 * which then credits the same ICAN wallet checkout spends from -- see walletTopUpService.
 *
 *   neededUgx   what this order costs in UGX
 *   forceOpen   true after the server reported an insufficient balance
 */
export default function WalletTopUpInline({ skin = 'slate', neededUgx = 0, forceOpen = false, customerName = '', customerPhone = '' }) {
  const k = SKINS[skin] || SKINS.slate;
  const { user } = useAuth();
  const [balanceUgx, setBalanceUgx] = useState(null);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const refresh = useCallback(async () => {
    if (!user?.id) return null;
    try {
      const b = await getBalance(user.id);
      setBalanceUgx(b.ican * ICAN_TO_UGX);
      return b.ican * ICAN_TO_UGX;
    } catch {
      setBalanceUgx(null);
      return null;
    }
  }, [user?.id]);

  useEffect(() => { refresh(); }, [refresh]);

  const shortfall = balanceUgx == null ? 0 : Math.max(0, neededUgx - balanceUgx);
  const isShort = shortfall > 0.5;

  // Open by itself, with the shortfall filled in, whenever the wallet can't cover the order.
  useEffect(() => {
    if (isShort || forceOpen) {
      setOpen(true);
      setAmount((prev) => prev || String(Math.max(MIN_TOPUP_UGX, roundUp(shortfall || neededUgx))));
    }
  }, [isShort, forceOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const pay = async () => {
    setError('');
    setDone('');
    setBusy(true);
    try {
      const res = await topUpIcanWallet({
        ugx: Number(amount),
        customerEmail: user?.email,
        customerName: customerName || user?.user_metadata?.full_name,
        customerPhone,
      });
      if (res.success) {
        const now = await refresh();
        setDone(`Added ${res.icanAmount.toFixed(4)} ICAN (UGX ${fmt(res.ugx)}) to your wallet.`);
        setAmount('');
        if (now != null && now + 0.5 >= neededUgx) setOpen(false);
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

  if (balanceUgx == null && !open) return null; // balance unreadable: stay out of the way

  const presets = [...new Set([isShort ? Math.max(MIN_TOPUP_UGX, roundUp(shortfall)) : null, 10000, 20000, 50000].filter(Boolean))].slice(0, 4);

  return (
    <div className={isShort ? k.short : k.wrap} data-testid="wallet-topup">
      <div className="flex items-center justify-between gap-2">
        <p className={`text-xs flex items-center gap-1.5 ${k.head}`}>
          <Wallet className="w-3.5 h-3.5" />
          Wallet: <b>{(balanceUgx / ICAN_TO_UGX).toFixed(4)} ICAN</b> <span className={k.body}>(≈ UGX {fmt(balanceUgx)})</span>
        </p>
        {!open && <button type="button" onClick={() => setOpen(true)} className={`${k.link} flex items-center gap-1`}><Plus className="w-3 h-3" />Top up</button>}
      </div>
      {isShort && <p className={`text-xs ${k.warn}`}>This order needs UGX {fmt(neededUgx)} — add at least UGX {fmt(roundUp(shortfall, 1))} to your wallet to pay with it.</p>}
      {done && <p className={`text-xs ${k.ok}`}>{done}</p>}

      {open && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {presets.map((p) => <button key={p} type="button" onClick={() => setAmount(String(p))} className={k.chip}>UGX {fmt(p)}</button>)}
          </div>
          <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" placeholder={`Amount in UGX (min ${fmt(MIN_TOPUP_UGX)})`} aria-label="Top-up amount in UGX" className={k.input} />
          <button type="button" onClick={pay} disabled={busy || Number(amount) < MIN_TOPUP_UGX} className={k.btn}>
            {busy ? <Loader className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {busy ? 'Waiting for payment…' : `Top up UGX ${fmt(amount)} with Mobile Money, card or bank`}
          </button>
          <p className={`text-[11px] ${k.body}`}>1 ICAN = UGX {fmt(ICAN_TO_UGX)} at checkout. Your coins arrive the moment the payment is confirmed.</p>
          {!isShort && <p className="text-center"><button type="button" onClick={() => { setOpen(false); setError(''); }} className={k.link}>Close</button></p>}
        </div>
      )}
      {error && <p className={k.err} role="alert">{error}</p>}
    </div>
  );
}

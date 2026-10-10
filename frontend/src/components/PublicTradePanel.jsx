import React, { useEffect, useMemo, useState } from 'react';
import { CHART_PALETTES } from './chartPalettes';
import { CountryService } from '../services/countryService';
import { formatMoney, minTopUp } from '../services/topUpCurrency';
import { coinsForMoney, distanceFromMarketPct, quickTopUpAmounts, validateWalletBuy } from '../utils/tradeRules';

// The trade panel on the public /icaneracoin page. Signed out it offers "Continue with Google" (an IcanEra wallet
// is created for the visitor on the spot). Signed in it shows their wallet and three actions:
//   Buy   pay with Mobile Money / card / bank on Flutterwave's checkout; coins are credited once the server verifies it
//   Sell  sell coins at the live price
//   Book  queue a buy or sell at the price you pick (tap the chart to choose it), then fill it now or cancel it
// All the money movement is in usePublicTrading, which only calls the app's existing, server-verified services.

const GoogleMark = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.3 5.7c4.3-4 6.8-9.9 6.8-17.1z" />
    <path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 010-9.4l-7.9-6.1a24 24 0 000 21.6l7.9-6.1z" />
    <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.3-5.7c-2 1.4-4.7 2.3-8.6 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
  </svg>
);

const fmtCoins = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 6 });
const fmtUgx = (n) => `UGX ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

const PublicTradePanel = ({ trading, theme = 'dark', priceUgx, tab, setTab, draft, setDraft, placement, setPlacement, onClose }) => {
  const c = CHART_PALETTES[theme] || CHART_PALETTES.dark;
  const {
    user, signedIn, signOut, continueWithGoogle, wallet, quote, quoteError, country, orders, orderErrors, busy, notice,
    clearNotice, cash, buyCoins, buyWithWallet, sellCoins, bookOrder, cancelOrder, fillOrderNow,
  } = trading;

  const [buyAmount, setBuyAmount] = useState('');
  // Where the money for a purchase comes from: the IcanEra wallet's cash (no checkout, no fee) or a fresh payment.
  const [source, setSource] = useState('wallet');
  const [sourceTouched, setSourceTouched] = useState(false);
  const [sellAmount, setSellAmount] = useState('');
  const [confirmSell, setConfirmSell] = useState(false);

  // Switching tab (or leaving Book) drops the chart's "pick a price" mode and any pending confirmation.
  useEffect(() => { if (tab !== 'book') setPlacement(false); setConfirmSell(false); clearNotice(); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const field = { background: c.field, border: `1px solid ${c.fieldBorder}`, color: c.strong };
  const card = { background: c.card, border: `1px solid ${c.cardBorder}`, color: c.fg };
  const sub = { color: c.muted };
  const noticeStyle = (kind) => (kind === 'err' ? { background: c.errBg, color: c.errText } : kind === 'info' ? { background: c.warnBg, color: c.warnText } : { background: c.okBg, color: c.okText });

  const currency = quote?.currency || 'UGX';
  const price = quote?.price || 0;
  const min = price ? minTopUp(currency, price) : 0;
  const buyNumber = Number(buyAmount);
  const coinsOut = coinsForMoney(buyNumber, price);
  const buyTooSmall = buyNumber > 0 && buyNumber < min;
  const cashBalance = cash ? cash.balance : 0;
  const hasCash = !!cash && cash.balance > 0;
  // Start on the wallet when it holds cash and on a fresh payment when it does not, until the visitor chooses.
  useEffect(() => { if (!sourceTouched && cash !== undefined) setSource(hasCash ? 'wallet' : 'pay'); }, [cash, hasCash, sourceTouched]);
  const walletBuyNumber = Number(buyAmount);
  const walletCoinsOut = walletBuyNumber > 0 && priceUgx ? CountryService.localToIcan(walletBuyNumber, country, priceUgx) : 0;
  const walletBuyCheck = validateWalletBuy(buyAmount, cash ? cash.balance : NaN);
  const walletCurrency = cash?.currency || CountryService.getCurrencyCode(country);
  const walletValueUgx = wallet && priceUgx ? wallet.ican * priceUgx : null;
  const walletValueLocal = wallet && price ? wallet.ican * price : null;

  const sellNumber = Number(sellAmount);
  const countryCurrency = CountryService.getCurrencyCode(country);
  const sellLocal = sellNumber > 0 && priceUgx ? CountryService.icanToLocal(sellNumber, country, priceUgx) : 0;

  const draftPrice = draft.price;
  const draftDistance = distanceFromMarketPct(draftPrice, priceUgx);
  const sides = useMemo(() => ({ buy: { bg: c.buy, fg: c.buyText }, sell: { bg: c.sell, fg: c.sellText } }), [c]);

  const submitBuy = async (e) => {
    e.preventDefault();
    const result = source === 'wallet' ? await buyWithWallet(buyNumber) : await buyCoins(buyNumber);
    if (result?.success) setBuyAmount('');
  };

  const submitSell = async () => {
    const result = await sellCoins(sellNumber);
    setConfirmSell(false);
    if (result?.success) setSellAmount('');
  };

  const submitBook = async (e) => {
    e.preventDefault();
    const result = await bookOrder({ side: draft.side, amount: draft.amount, price: draft.price });
    if (result?.success) { setDraft((d) => ({ ...d, amount: '', price: '' })); setPlacement(false); }
  };

  /* ───────────── signed out ───────────── */
  if (!signedIn) {
    return (
      <div className="space-y-4 p-4" style={{ color: c.fg }}>
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em]" style={{ color: c.liveText }}>Trade icaneracoin</p>
          <h2 className="mt-1 text-xl font-bold" style={{ color: c.strong }}>Buy, sell and book orders</h2>
          {priceUgx ? <p className="mt-1 text-sm tabular-nums" style={sub}>Live price <b style={{ color: c.strong }}>{fmtUgx(priceUgx)}</b></p> : null}
        </div>
        <ul className="space-y-2 text-sm">
          {[
            ['Your IcanEra wallet is created for you', 'No forms. One tap with Google.'],
            ['Top up with Mobile Money, card or bank', 'Coins arrive once the payment is verified.'],
            ['Book a buy or sell at your own price', 'Tap the chart to choose it. See it as a line on the chart.'],
          ].map(([t, d]) => (
            <li key={t} className="flex gap-2.5">
              <span aria-hidden="true" style={{ color: c.live }}>✓</span>
              <span><span className="block font-semibold" style={{ color: c.strong }}>{t}</span><span className="block text-xs" style={sub}>{d}</span></span>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={continueWithGoogle}
          className="flex min-h-[48px] w-full items-center justify-center gap-3 rounded-lg border text-sm font-semibold"
          style={{ background: '#ffffff', color: '#1f2937', borderColor: '#d1d5db' }}
        >
          <GoogleMark /> Continue with Google
        </button>
        {notice && <p className="rounded-md px-3 py-2 text-xs" role="alert" style={{ background: c.errBg, color: c.errText }}>{notice.text}</p>}
        <p className="text-center text-xs" style={sub}>
          Prefer email? <a href="/?auth=signup" className="font-semibold underline" style={{ color: c.strong }}>Create an account</a>
        </p>
        <p className="text-[11px] leading-5" style={sub}>
          Trading involves risk and prices move. Only buy what you are comfortable holding. Prices on this chart are in UGX.
        </p>
      </div>
    );
  }

  /* ───────────── signed in ───────────── */
  const tabBtn = (id, label) => (
    <button
      key={id}
      type="button"
      role="tab"
      aria-selected={tab === id}
      onClick={() => setTab(id)}
      className="flex-1 rounded-md px-3 py-2 text-sm font-semibold"
      style={tab === id ? { background: c.tabOnBg, color: c.tabOnText } : { color: c.soft }}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-3 p-4">
      <div className="rounded-xl p-3" style={card}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wide" style={sub}>Your IcanEra wallet</p>
            <p className="truncate text-xs" style={sub}>{user?.email}</p>
          </div>
          <button type="button" onClick={signOut} className="shrink-0 text-xs font-semibold underline" style={{ color: c.soft }}>Sign out</button>
        </div>
        <p className="mt-2 text-2xl font-black tabular-nums" style={{ color: c.strong }}>
          {wallet ? fmtCoins(wallet.ican) : '…'} <span className="text-sm font-bold" style={sub}>ICAN</span>
        </p>
        <p className="text-xs tabular-nums" style={sub}>
          {walletValueUgx != null ? `≈ ${fmtUgx(walletValueUgx)}` : ''}
          {walletValueLocal != null && currency !== 'UGX' ? ` · ${formatMoney(walletValueLocal, currency)}` : ''}
        </p>
      </div>

      <div className="flex gap-1 rounded-lg p-1" role="tablist" aria-label="Trade" style={{ background: c.tabsBg }}>
        {tabBtn('buy', 'Buy')}{tabBtn('sell', 'Sell')}{tabBtn('book', 'Book')}
      </div>

      {notice && (
        <p className="rounded-md px-3 py-2 text-xs" role={notice.kind === 'err' ? 'alert' : 'status'} style={noticeStyle(notice.kind)}>
          {notice.text}
        </p>
      )}

      {tab === 'buy' && (
        <form onSubmit={submitBuy} className="space-y-3 rounded-xl p-3" style={card}>
          <div className="flex gap-1 rounded-lg p-1" role="radiogroup" aria-label="Pay with" style={{ background: c.tabsBg }}>
            {[
              ['wallet', 'My IcanEra wallet'],
              ['pay', 'Card / Mobile Money'],
            ].map(([id, label]) => (
              <button
                key={id} type="button" role="radio" aria-checked={source === id}
                onClick={() => { setSource(id); setSourceTouched(true); clearNotice(); }}
                className="min-h-[40px] flex-1 rounded-md px-2 text-xs font-semibold"
                style={source === id ? { background: c.tabOnBg, color: c.tabOnText } : { color: c.soft }}
              >
                {label}
              </button>
            ))}
          </div>

          {source === 'wallet' ? (
            <>
              <div className="flex items-baseline justify-between gap-2 rounded-lg px-3 py-2" style={{ background: c.field, border: `1px solid ${c.fieldBorder}` }}>
                <span className="text-xs font-semibold" style={sub}>Wallet cash</span>
                <span className="text-sm font-bold tabular-nums" style={{ color: c.strong }}>
                  {cash === undefined ? '…' : formatMoney(cashBalance, walletCurrency)}
                </span>
              </div>
              <label className="block text-xs font-semibold" style={sub} htmlFor="ptp-buy">Amount to spend ({walletCurrency})</label>
              <div className="flex gap-2">
                <input
                  id="ptp-buy" type="number" inputMode="decimal" min="0" step="any" value={buyAmount}
                  onChange={(e) => setBuyAmount(e.target.value)} placeholder="Amount"
                  disabled={busy || !hasCash} className="min-w-0 flex-1 rounded-lg px-3 py-3 text-base tabular-nums" style={field}
                />
                <button type="button" disabled={busy || !hasCash} onClick={() => setBuyAmount(String(Math.floor(cashBalance * 100) / 100))} className="shrink-0 rounded-lg px-3 text-xs font-bold disabled:opacity-50" style={{ border: `1px solid ${c.fieldBorder}`, color: c.fg }}>Max</button>
              </div>
              {walletCoinsOut > 0 && (
                <p className="text-xs tabular-nums" style={sub}>
                  At {fmtUgx(priceUgx)} per coin you get <b style={{ color: c.strong }}>{fmtCoins(walletCoinsOut)} ICAN</b>.
                </p>
              )}
              {cash !== undefined && !hasCash && (
                <p className="rounded-md px-3 py-2 text-xs" style={{ background: c.warnBg, color: c.warnText }}>
                  {cash === null ? 'No cash wallet yet.' : 'Your wallet has no cash.'} Add money in your{' '}
                  <a href="/" className="font-semibold underline">IcanEra wallet</a>, or pay with card or Mobile Money.
                </p>
              )}
              {buyAmount !== '' && walletBuyNumber > 0 && !walletBuyCheck.ok && hasCash && (
                <p className="text-xs" style={{ color: c.errText }}>{walletBuyCheck.error}</p>
              )}
              <button
                type="submit" disabled={busy || !hasCash || !walletBuyCheck.ok || !priceUgx}
                className="min-h-[48px] w-full rounded-lg text-sm font-bold disabled:opacity-50" style={{ background: c.buy, color: c.buyText }}
              >
                {busy ? 'Buying…' : 'Buy with wallet cash'}
              </button>
              <p className="text-[11px] leading-5" style={sub}>
                Paid from the money already in your IcanEra wallet: no checkout and no payment fee. Coins arrive straight away.
              </p>
            </>
          ) : (
            <>
              <label className="block text-xs font-semibold" style={sub} htmlFor="ptp-buy">Amount to pay ({currency})</label>
              <input
                id="ptp-buy" type="number" inputMode="decimal" min="0" step="any" value={buyAmount}
                onChange={(e) => setBuyAmount(e.target.value)} placeholder={min ? `At least ${Math.ceil(min).toLocaleString()}` : 'Amount'}
                disabled={busy || !price} className="w-full rounded-lg px-3 py-3 text-base tabular-nums" style={field}
              />
              <div className="flex flex-wrap gap-1.5">
                {quickTopUpAmounts(min).map((a) => (
                  <button key={a} type="button" onClick={() => setBuyAmount(String(a))} className="rounded-full px-3 py-1.5 text-xs font-semibold" style={{ border: `1px solid ${c.fieldBorder}`, color: c.fg }}>
                    {Number(a).toLocaleString()}
                  </button>
                ))}
              </div>
              {price > 0 && (
                <p className="text-xs tabular-nums" style={sub}>
                  1 ICAN = {formatMoney(price, currency)}.
                  {coinsOut > 0 && <> You get <b style={{ color: c.strong }}>{fmtCoins(coinsOut)} ICAN</b>.</>}
                </p>
              )}
              {buyTooSmall && <p className="text-xs" style={{ color: c.errText }}>The smallest purchase is {formatMoney(min, currency)}.</p>}
              {quoteError && !quote && <p className="text-xs" style={{ color: c.errText }}>{quoteError}</p>}
              <button
                type="submit" disabled={busy || !price || !(buyNumber >= min)}
                className="min-h-[48px] w-full rounded-lg text-sm font-bold disabled:opacity-50" style={{ background: c.buy, color: c.buyText }}
              >
                {busy ? 'Opening checkout…' : 'Pay & buy coins'}
              </button>
              <p className="text-[11px] leading-5" style={sub}>
                You pay on a secure checkout (Mobile Money, card or bank). Coins are added to your wallet once the payment is verified.
              </p>
            </>
          )}
        </form>
      )}

      {tab === 'sell' && (
        <div className="space-y-3 rounded-xl p-3" style={card}>
          <label className="block text-xs font-semibold" style={sub} htmlFor="ptp-sell">Coins to sell</label>
          <div className="flex gap-2">
            <input
              id="ptp-sell" type="number" inputMode="decimal" min="0" step="any" value={sellAmount}
              onChange={(e) => { setSellAmount(e.target.value); setConfirmSell(false); }} placeholder="0.00"
              disabled={busy} className="min-w-0 flex-1 rounded-lg px-3 py-3 text-base tabular-nums" style={field}
            />
            <button type="button" onClick={() => { setSellAmount(String(wallet?.ican || 0)); setConfirmSell(false); }} className="shrink-0 rounded-lg px-3 text-xs font-bold" style={{ border: `1px solid ${c.fieldBorder}`, color: c.fg }}>Max</button>
          </div>
          {sellNumber > 0 && priceUgx > 0 && (
            <p className="text-xs tabular-nums" style={sub}>
              At {fmtUgx(priceUgx)} per coin you receive about <b style={{ color: c.strong }}>{countryCurrency} {Number(sellLocal).toLocaleString(undefined, { maximumFractionDigits: 2 })}</b>.
            </p>
          )}
          {!confirmSell ? (
            <button type="button" disabled={busy || !(sellNumber > 0)} onClick={() => setConfirmSell(true)} className="min-h-[48px] w-full rounded-lg text-sm font-bold disabled:opacity-50" style={{ background: c.sell, color: c.sellText }}>
              Review sale
            </button>
          ) : (
            <div className="space-y-2 rounded-lg p-3" style={{ background: c.warnBg, border: `1px solid ${c.warnBorder}` }}>
              <p className="text-xs font-semibold" style={{ color: c.warnText }}>Sell {fmtCoins(sellNumber)} ICAN at the live price? This cannot be undone.</p>
              <div className="flex gap-2">
                <button type="button" disabled={busy} onClick={submitSell} className="min-h-[44px] flex-1 rounded-lg text-sm font-bold disabled:opacity-50" style={{ background: c.sell, color: c.sellText }}>{busy ? 'Selling…' : 'Confirm sell'}</button>
                <button type="button" disabled={busy} onClick={() => setConfirmSell(false)} className="min-h-[44px] rounded-lg px-4 text-sm font-semibold" style={{ border: `1px solid ${c.fieldBorder}`, color: c.fg }}>Back</button>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'book' && (
        <>
          <form onSubmit={submitBook} className="space-y-3 rounded-xl p-3" style={card}>
            <div className="flex gap-1.5" role="group" aria-label="Order side">
              {['buy', 'sell'].map((side) => (
                <button
                  key={side} type="button" aria-pressed={draft.side === side} onClick={() => setDraft((d) => ({ ...d, side }))}
                  className="min-h-[44px] flex-1 rounded-lg text-sm font-bold"
                  style={draft.side === side ? { background: sides[side].bg, color: sides[side].fg } : { border: `1px solid ${c.fieldBorder}`, color: c.soft }}
                >
                  {side === 'buy' ? 'Buy' : 'Sell'}
                </button>
              ))}
            </div>
            <div>
              <label className="block text-xs font-semibold" style={sub} htmlFor="ptp-book-amt">Coins</label>
              <input id="ptp-book-amt" type="number" inputMode="decimal" min="0" step="any" value={draft.amount} onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value }))} placeholder="0.00" disabled={busy} className="mt-1 w-full rounded-lg px-3 py-3 text-base tabular-nums" style={field} />
            </div>
            <div>
              <label className="block text-xs font-semibold" style={sub} htmlFor="ptp-book-price">Your price (UGX per coin)</label>
              <div className="mt-1 flex gap-2">
                <input id="ptp-book-price" type="number" inputMode="decimal" min="0" step="any" value={draft.price} onChange={(e) => setDraft((d) => ({ ...d, price: e.target.value }))} placeholder={priceUgx ? String(Math.round(priceUgx)) : 'Price'} disabled={busy} className="min-w-0 flex-1 rounded-lg px-3 py-3 text-base tabular-nums" style={field} />
                <button
                  type="button" aria-pressed={placement}
                  onClick={() => { setPlacement((v) => !v); onClose?.('chart'); }}
                  className="shrink-0 rounded-lg px-3 text-xs font-bold"
                  style={placement ? { background: c.tabOnBg, color: c.tabOnText } : { border: `1px solid ${c.fieldBorder}`, color: c.fg }}
                >
                  {placement ? 'Tap chart…' : 'Pick on chart'}
                </button>
              </div>
              {draftDistance != null && (
                <p className="mt-1 text-[11px] tabular-nums" style={sub}>
                  {Math.abs(draftDistance).toFixed(2)}% {draftDistance >= 0 ? 'above' : 'below'} the live price.
                  {draft.side === 'buy' && draftDistance > 0 && ' A buy above the market fills at once.'}
                  {draft.side === 'sell' && draftDistance < 0 && ' A sell below the market fills at once.'}
                </p>
              )}
            </div>
            <button type="submit" disabled={busy || !(Number(draft.amount) > 0) || !(Number(draft.price) > 0)} className="min-h-[48px] w-full rounded-lg text-sm font-bold disabled:opacity-50" style={{ background: c.book, color: c.bookText }}>
              {busy ? 'Booking…' : `Book ${draft.side === 'buy' ? 'buy' : 'sell'} order`}
            </button>
            <p className="text-[11px] leading-5" style={{ color: c.warnText }}>
              Booked orders are filled at the live price once it reaches yours, while IcanEra is open on your device.
            </p>
          </form>

          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wide" style={sub}>Your booked orders</p>
            {orders.length === 0 && <p className="text-xs" style={sub}>None yet. Orders you book appear here and as lines on the chart.</p>}
            {orders.map((o) => {
              const dist = distanceFromMarketPct(o.target_price_ugx, priceUgx);
              return (
                <div key={o.id} className="rounded-xl p-3" style={card}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-bold tabular-nums" style={{ color: o.order_type === 'buy' ? c.pos : c.neg }}>
                      {o.order_type === 'buy' ? 'Buy' : 'Sell'} {fmtCoins(o.ican_amount)} ICAN
                    </p>
                    <p className="text-xs tabular-nums" style={sub}>@ {Number(o.target_price_ugx).toLocaleString()}</p>
                  </div>
                  {dist != null && <p className="text-[11px] tabular-nums" style={sub}>{Math.abs(dist).toFixed(2)}% {dist >= 0 ? 'above' : 'below'} the live price</p>}
                  {orderErrors[o.id] && <p className="mt-1 text-[11px]" style={{ color: c.errText }}>Could not fill yet: {orderErrors[o.id]}</p>}
                  <div className="mt-2 flex gap-2">
                    <button type="button" disabled={busy} onClick={() => fillOrderNow(o)} className="min-h-[40px] flex-1 rounded-lg text-xs font-bold disabled:opacity-50" style={{ background: c.tabOnBg, color: c.tabOnText }}>Fill now</button>
                    <button type="button" disabled={busy} onClick={() => cancelOrder(o.id)} className="min-h-[40px] rounded-lg px-4 text-xs font-semibold disabled:opacity-50" style={{ border: `1px solid ${c.fieldBorder}`, color: c.fg }}>Cancel</button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <p className="text-[11px] leading-5" style={sub}>
        Open <a href="/" className="font-semibold underline" style={{ color: c.strong }}>your full IcanEra wallet</a> to send coins, set a PIN and see all your activity.
        Trading involves risk; prices move.
      </p>
    </div>
  );
};

export default PublicTradePanel;

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle, Banknote, CheckCircle2, Clock, Copy, Globe, Loader2, Printer, ShieldCheck, Share2, Smartphone, Wallet, X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { AuthPage } from './auth';
import { CLASSIC_PAY_CSS } from './publicPayTheme';
import {
  buildPublicReceiptLink,
  claimCashPayment,
  getPublicReceipt,
  getPublicReceiveInfo,
  payPublicReceipt,
  payPublicReceiptWithWallet,
  receivePublicReceiptWithWallet,
  resumePendingPublicPayment,
} from '../services/publicTransactionService';

/**
 * /r/<code> — a receipt, and (when it is still unpaid) the place to pay it.
 *
 * Opened from the QR on a printed receipt, or after a customer lists what they owe on a standing pay QR
 * (/p/<code>). No account needed: anyone can read, print or save the receipt. An unpaid bill offers three
 * ways to pay — IcanEra wallet (no extra fee), Mobile Money / card / bank, or cash — and once paid the
 * same page is the receipt, listing the customer's items. The seller approves each payment from a
 * notification; this page waits and turns into the paid receipt by itself.
 *
 * A money-OUT receipt works the other way: when the business switched "let the client receive this by
 * scanning" on, the client signs in here and takes the money from the business wallet into their own
 * IcanEra wallet (once).
 */

const formatMoney = (amount, currency = 'UGX') =>
  `${currency} ${Number(amount || 0).toLocaleString('en-UG', { maximumFractionDigits: 2 })}`;

const formatDate = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-UG', { dateStyle: 'medium', timeStyle: 'short' });
};

const Row = ({ label, children }) => (
  <div className="ptx-row"><span>{label}</span><span>{children}</span></div>
);

const METHODS = [
  { id: 'wallet', label: 'IcanEra wallet', Icon: Wallet },
  { id: 'guest', label: 'Mobile · Card · Bank', Icon: Smartphone },
  { id: 'cash', label: 'Cash', Icon: Banknote },
];

const PublicTransactionPage = ({ code }) => {
  const { user, loading: authLoading } = useAuth();
  const [receipt, setReceipt] = useState(null);
  const [receive, setReceive] = useState(null); // { receivable, received, amount_ugx, expires_at }
  const [justReceived, setJustReceived] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  // Name / phone typed on the standing pay QR come along in the URL — keep them off the address bar after reading.
  const [name, setName] = useState(() => new URLSearchParams(window.location.search).get('n') || '');
  const [phone, setPhone] = useState(() => new URLSearchParams(window.location.search).get('p') || '');
  const [method, setMethod] = useState(null);
  const [busy, setBusy] = useState(null);
  const [payError, setPayError] = useState('');
  const [justPaid, setJustPaid] = useState(null);
  const [showAuth, setShowAuth] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (window.location.search) window.history.replaceState(null, '', window.location.pathname);
  }, []);

  const load = useCallback(async () => {
    try {
      const [data, recv] = await Promise.all([getPublicReceipt(code), getPublicReceiveInfo(code)]);
      setReceipt(data?.found ? data : null);
      setReceive(recv?.found ? recv : null);
      setLoadError('');
    } catch (err) {
      setLoadError(err.message || 'Could not load this receipt');
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Paid on a previous visit but the tab closed before it was confirmed? Finish that first.
      const resumed = await resumePendingPublicPayment(code);
      if (resumed && !cancelled) setJustPaid({ via: 'guest', charged: resumed.charged_ugx, fee: resumed.processing_fee_ugx, pending: !!resumed.pending_approval });
      if (!cancelled) await load();
    })();
    return () => { cancelled = true; };
  }, [code, load]);

  // A bill that is still open / waiting for approval: the seller may act at any moment, so keep it fresh.
  const waiting = Boolean(receipt && (receipt.payable || receipt.pending_approval) && !receipt.paid);
  useEffect(() => {
    if (!waiting) return undefined;
    const timer = setInterval(() => { if (!document.hidden && !busy) load(); }, 6000);
    return () => clearInterval(timer);
  }, [waiting, busy, load]);

  useEffect(() => {
    if (receipt) document.title = `Receipt ${receipt.receipt_number} · ${receipt.issuer_name}`;
  }, [receipt]);

  const available = useMemo(() => {
    if (!receipt?.payable) return [];
    return METHODS.filter((m) => (m.id === 'guest' ? receipt.guest_ok !== false : m.id === 'cash' ? receipt.cash_allowed : true));
  }, [receipt]);

  // Sensible default: the wallet for someone already signed in, otherwise the method that needs no account.
  useEffect(() => {
    if (!available.length || (method && available.some((m) => m.id === method))) return;
    const pick = (user && 'wallet') || (available.some((m) => m.id === 'guest') && 'guest') || (available.some((m) => m.id === 'cash') && 'cash') || available[0].id;
    setMethod(pick);
  }, [available, method, user]);

  const link = buildPublicReceiptLink(code);

  const handleGuestPay = async () => {
    setPayError('');
    if (name.trim().length < 2) { setPayError('Enter your name'); return; }
    if (phone.replace(/[^0-9]/g, '').length < 9) { setPayError('Enter the phone number you will pay with'); return; }
    setBusy('guest');
    try {
      const result = await payPublicReceipt({
        code, name: name.trim(), phone: phone.trim(), issuerName: receipt.issuer_name, expectedCharge: receipt.charge_ugx,
      });
      setJustPaid({ via: 'guest', charged: result.charged_ugx, fee: result.processing_fee_ugx, pending: !!result.pending_approval });
      await load();
    } catch (err) {
      setPayError(err.message || 'Payment failed. Please try again.');
      if (err.priceChanged) await load();
    } finally {
      setBusy(null);
    }
  };

  const handleWalletPay = async () => {
    if (!user) { setShowAuth(true); return; }
    setPayError('');
    setBusy('wallet');
    try {
      const result = await payPublicReceiptWithWallet(code);
      setJustPaid({ via: 'wallet', charged: receipt.amount_ugx, fee: 0, pending: !!result.pending_approval });
      await load();
    } catch (err) {
      setPayError(err.message || 'Payment failed. Please try again.');
    } finally {
      setBusy(null);
    }
  };

  // Money-out receipt the business switched on: take it from the business wallet into the client's wallet.
  const handleReceive = async () => {
    if (!user) { setShowAuth(true); return; }
    setPayError('');
    setBusy('receive');
    try {
      const result = await receivePublicReceiptWithWallet(code);
      setJustReceived(result);
      await load();
    } catch (err) {
      setPayError(err.message || 'Could not receive this money. Please try again.');
    } finally {
      setBusy(null);
    }
  };

  // "I paid cash": nothing is recorded; the seller (or an authorised person) is notified to confirm it.
  const handleClaimCash = async () => {
    setPayError('');
    if (name.trim().length < 2) { setPayError('Enter your name'); return; }
    setBusy('cash');
    try {
      await claimCashPayment(code, name.trim(), phone.trim() || null);
      setJustPaid({ via: 'cash', pending: true });
      await load();
    } catch (err) {
      setPayError(err.message || 'Could not send this. Please try again.');
    } finally {
      setBusy(null);
    }
  };

  const share = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: `Receipt ${receipt.receipt_number}`, text: `${receipt.issuer_name} · ${formatMoney(receipt.amount, receipt.currency)}`, url: link });
        return;
      }
      await navigator.clipboard?.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* dismissed */ }
  };

  const shell = (children) => (
    <div className="ptx">
      <style>{CLASSIC_PAY_CSS}</style>
      <div className="ptx-wrap">{children}</div>
    </div>
  );

  const message = (title, text, action) => shell(
    <div className="ptx-card" style={{ marginTop: 40 }}>
      <div className="ptx-body" style={{ textAlign: 'center', paddingTop: 28, paddingBottom: 28 }}>
        <AlertCircle className="ptx-faint" style={{ width: 40, height: 40, margin: '0 auto 10px' }} />
        <h1 className="ptx-h2">{title}</h1>
        <p className="ptx-muted" style={{ fontSize: 14, marginTop: 6, lineHeight: 1.5 }}>{text}</p>
        {action}
      </div>
    </div>,
  );

  if (loading) {
    return shell(<div style={{ display: 'flex', justifyContent: 'center', padding: '96px 0' }}><Loader2 className="animate-spin ptx-faint" style={{ width: 28, height: 28 }} /></div>);
  }
  if (!receipt) {
    return message(
      loadError ? 'Could not load this receipt' : 'Receipt not found',
      loadError || 'This link is not valid, or the receipt was removed by its owner.',
      loadError && <button className="ptx-btn ptx-secondary" style={{ marginTop: 16 }} onClick={() => { setLoading(true); load(); }}>Try again</button>,
    );
  }
  if (receipt.cancelled) {
    return message('This payment request was cancelled', `${receipt.issuer_name} cancelled this QR. Ask them for a new one if you still need to pay.`);
  }

  const isIncome = receipt.direction === 'income';
  const paid = receipt.paid;
  const items = Array.isArray(receipt.items) ? receipt.items : [];
  const showForm = receipt.payable && !paid;

  return shell(
    <>
      <div className="ptx-card">
        <div className="ptx-head">
          <p className="ptx-eyebrow">{receipt.request && !paid ? 'Payment bill' : 'IcanEra receipt'}</p>
          <h1 className="ptx-title">{receipt.issuer_name}</h1>
          <p className="ptx-amount">{formatMoney(receipt.amount, receipt.currency)}</p>
          <div style={{ marginTop: 12 }}>
            {paid ? (
              <span className="ptx-chip ptx-chip-green"><CheckCircle2 width={14} height={14} /> Paid{receipt.paid_at ? ` · ${formatDate(receipt.paid_at)}` : ''}</span>
            ) : receipt.pending_approval ? (
              <span className="ptx-chip ptx-chip-amber"><Clock width={14} height={14} /> Waiting for approval</span>
            ) : receipt.payable ? (
              <span className="ptx-chip ptx-chip-amber">Awaiting payment</span>
            ) : (
              <span className="ptx-chip ptx-chip-neutral"><ShieldCheck width={14} height={14} /> Recorded on the IcanEra ledger</span>
            )}
          </div>
        </div>

        <div className="ptx-body">
          {items.length > 0 && (
            <div style={{ padding: '12px 0 4px' }}>
              <p className="ptx-eyebrow" style={{ color: 'var(--gold-ink)', marginBottom: 4 }}>Items</p>
              {items.map((it, i) => (
                <div className="ptx-row" key={i}>
                  <span style={{ color: 'var(--text)', fontWeight: 500 }}>{it.name}{Number(it.qty) > 1 ? ` × ${it.qty}` : ''}</span>
                  <span>{formatMoney(Number(it.price) * Number(it.qty || 1), receipt.currency)}</span>
                </div>
              ))}
            </div>
          )}
          <Row label={receipt.request && !paid ? 'Bill no.' : 'Receipt no.'}>{receipt.receipt_number}</Row>
          <Row label={isIncome ? 'Received by' : 'Paid by'}>{receipt.issuer_name}</Row>
          {items.length === 0 && <Row label="For">{receipt.description || 'Payment'}</Row>}
          {receipt.item && items.length === 0 && <Row label="Item">{receipt.item}</Row>}
          {receipt.quantity && items.length === 0 ? <Row label="Quantity">{String(receipt.quantity)}</Row> : null}
          {receipt.unit_price && items.length === 0 ? <Row label="Unit price">{formatMoney(receipt.unit_price, receipt.currency)}</Row> : null}
          {receipt.category && <Row label="Category">{String(receipt.category).replace(/[_-]+/g, ' ')}</Row>}
          <Row label="Date">{formatDate(receipt.recorded_at)}</Row>
          {receipt.receipt_ref && <Row label="Reference">{receipt.receipt_ref}</Row>}
          {(receipt.customer_name || (paid && receipt.payer_first_name)) && (
            <Row label="Customer">{receipt.customer_name || receipt.payer_first_name}</Row>
          )}
          {paid && <Row label="Method">{receipt.paid_via === 'wallet' ? 'IcanEra wallet' : receipt.paid_via === 'cash' ? 'Cash' : 'Mobile Money, card or bank'}</Row>}
        </div>

        {receipt.company_id && (
          <a href={`/notices/${receipt.company_id}`} className="ptx-noprint ptx-link ptx-alt"
             style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '14px 18px', fontSize: 14, borderTop: '1px solid var(--border)', minHeight: 48 }}>
            <Globe width={16} height={16} /> Visit {receipt.issuer_name}'s website
          </a>
        )}
      </div>

      {receipt.pending_approval && !paid && (
        <div className="ptx-section ptx-callout ptx-callout-wait" style={{ textAlign: 'center' }}>
          <Clock style={{ width: 32, height: 32, margin: '0 auto 8px', color: 'var(--amber-ink)' }} />
          <h2 className="ptx-h2">Payment sent — waiting for {receipt.issuer_name}</h2>
          <p className="ptx-muted" style={{ fontSize: 14, marginTop: 6, lineHeight: 1.5 }}>
            {receipt.pending_via === 'cash'
              ? 'They have been notified to confirm they received your cash.'
              : receipt.pending_via === 'wallet'
                ? 'Your coins are held safely and go to them once they approve. If they do not approve, they are returned to your wallet.'
                : 'Your payment is held safely and goes to them once they approve. If they do not approve, it is refunded to you.'}
          </p>
          <p className="ptx-note" style={{ marginTop: 8 }}>Keep this page open — it turns into your paid receipt the moment they approve.</p>
        </div>
      )}

      {justPaid && paid && (
        <div className="ptx-section ptx-callout ptx-callout-ok" style={{ textAlign: 'center' }}>
          <CheckCircle2 style={{ width: 34, height: 34, margin: '0 auto 8px', color: 'var(--green)' }} />
          <h2 className="ptx-h2">Payment approved — thank you!</h2>
          <p className="ptx-muted" style={{ fontSize: 14, marginTop: 6 }}>
            {justPaid.via === 'cash' ? 'Paid in cash.' : justPaid.via === 'wallet' ? 'Paid with your IcanEra wallet.' : 'Paid with Mobile Money, card or bank.'}
            {justPaid.charged ? ` Total charged ${formatMoney(justPaid.charged)}` : ''}
            {justPaid.fee > 0 ? ` (includes a ${formatMoney(justPaid.fee)} processing fee).` : justPaid.charged ? '.' : ''}
          </p>
          <p className="ptx-note" style={{ marginTop: 6 }}>Keep this page — print it or save it as your receipt.</p>
        </div>
      )}

      {justReceived && (
        <div className="ptx-section ptx-callout ptx-callout-ok" style={{ textAlign: 'center' }}>
          <CheckCircle2 style={{ width: 34, height: 34, margin: '0 auto 8px', color: 'var(--green)' }} />
          <h2 className="ptx-h2">Money received — it's in your IcanEra wallet</h2>
          <p className="ptx-muted" style={{ fontSize: 14, marginTop: 6 }}>
            {formatMoney(justReceived.amount_ugx)} from {receipt.issuer_name} ({Number(justReceived.ican_received).toLocaleString('en-UG', { maximumFractionDigits: 4 })} ICAN at today's price).
          </p>
          <p className="ptx-note" style={{ marginTop: 6 }}>Keep this page — print it or save it as your receipt.</p>
        </div>
      )}

      {receive?.receivable && !receive.received && (
        <div className="ptx-section ptx-noprint">
          <h2 className="ptx-h2">Receive this money</h2>
          <p className="ptx-muted" style={{ fontSize: 14, marginTop: 4, lineHeight: 1.5 }}>
            {receipt.issuer_name} has paid {formatMoney(receive.amount_ugx)} to you through this receipt. Collect it into your IcanEra wallet — it can only be collected once.
            {!user && ' Sign in or create a free account first.'}
          </p>
          <div className="ptx-stack-tight" style={{ marginTop: 12 }}>
            <button className="ptx-btn ptx-primary" onClick={handleReceive} disabled={!!busy || authLoading}>
              {busy === 'receive' ? <Loader2 className="animate-spin" width={18} height={18} /> : <Wallet width={18} height={18} />}
              {user ? `Receive ${formatMoney(receive.amount_ugx)}` : 'Sign in to receive'}
            </button>
            {receive.expires_at && <p className="ptx-note">Available until {formatDate(receive.expires_at)}.</p>}
          </div>
          {payError && <p className="ptx-err" style={{ marginTop: 12 }}>{payError}</p>}
        </div>
      )}

      {receive?.received && !justReceived && (
        <p className="ptx-note" style={{ textAlign: 'center', marginTop: 12 }}>
          <CheckCircle2 width={14} height={14} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 4 }} />
          This money was received{receive.received_at ? ` on ${formatDate(receive.received_at)}` : ''}.
        </p>
      )}

      {receipt.payable && receipt.last_reject_note && (
        <div className="ptx-section ptx-callout ptx-callout-bad ptx-noprint">
          <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--red)' }}>Your last payment was not approved</p>
          <p className="ptx-muted" style={{ fontSize: 13, marginTop: 4, lineHeight: 1.5 }}>
            {receipt.last_reject_note}. Anything you paid has been returned — wallet coins straight away, Mobile Money or card within a few days. You can try again below.
          </p>
        </div>
      )}

      {showForm && (
        <div className="ptx-section ptx-noprint">
          <h2 className="ptx-h2">How would you like to pay?</h2>
          <p className="ptx-muted" style={{ fontSize: 14, marginTop: 4 }}>No account needed. Pick one:</p>

          {available.length > 1 && (
            <div role="tablist" aria-label="Payment method" style={{ display: 'grid', gridTemplateColumns: `repeat(${available.length}, 1fr)`, gap: 8, margin: '14px 0' }}>
              {available.map(({ id, label, Icon }) => {
                const on = method === id;
                return (
                  <button
                    key={id} type="button" role="tab" aria-selected={on}
                    onClick={() => { setMethod(id); setPayError(''); }}
                    style={{
                      minHeight: 64, borderRadius: 12, padding: '8px 6px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
                      fontSize: 12, fontWeight: 700, lineHeight: 1.2,
                      border: `1.5px solid ${on ? 'var(--gold)' : 'var(--border)'}`,
                      background: on ? 'var(--alt)' : 'var(--surface)',
                      color: on ? 'var(--text)' : 'var(--muted)',
                      boxShadow: on ? 'inset 0 -3px 0 var(--gold)' : 'none',
                    }}
                  >
                    <Icon width={20} height={20} />
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>
          )}

          {method === 'wallet' && (
            <div className="ptx-stack-tight">
              <div className="ptx-callout ptx-alt" style={{ fontSize: 13, lineHeight: 1.5 }}>
                <b>Recommended.</b> Pays {formatMoney(receipt.amount_ugx)} straight from your IcanEra wallet — no processing fee.
                {!user && ' Sign in or create a free account first.'}
              </div>
              <button className="ptx-btn ptx-primary" onClick={handleWalletPay} disabled={!!busy || authLoading}>
                {busy === 'wallet' ? <Loader2 className="animate-spin" width={18} height={18} /> : <Wallet width={18} height={18} />}
                {user ? `Pay ${formatMoney(receipt.amount_ugx)}` : 'Sign in to pay'}
              </button>
            </div>
          )}

          {method === 'guest' && (
            <div className="ptx-stack-tight">
              <input className="ptx-input" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
              <input className="ptx-input" placeholder="Phone you will pay with (e.g. 0772…)" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" />
              <button className="ptx-btn ptx-primary" onClick={handleGuestPay} disabled={!!busy}>
                {busy === 'guest' ? <Loader2 className="animate-spin" width={18} height={18} /> : <Smartphone width={18} height={18} />}
                Pay {formatMoney(receipt.charge_ugx)}
              </button>
              <p className="ptx-note">
                Includes a {formatMoney(receipt.processing_fee_ugx)} payment-processing fee. Pay with your IcanEra wallet to skip it and pay {formatMoney(receipt.amount_ugx)}.
              </p>
            </div>
          )}

          {method === 'cash' && (
            <div className="ptx-stack-tight">
              {receipt.cash_claim_allowed ? (
                <>
                  <div className="ptx-callout ptx-alt" style={{ fontSize: 13, lineHeight: 1.5 }}>
                    Hand the cash to {receipt.issuer_name}, then tell them here. They are notified to confirm it, and this page turns into your paid receipt — keep it open.
                  </div>
                  <input className="ptx-input" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
                  <input className="ptx-input" placeholder="Your phone (optional)" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" />
                  <button className="ptx-btn ptx-primary" onClick={handleClaimCash} disabled={!!busy}>
                    {busy === 'cash' ? <Loader2 className="animate-spin" width={18} height={18} /> : <CheckCircle2 width={18} height={18} />}
                    I have paid cash
                  </button>
                </>
              ) : (
                <div className="ptx-callout ptx-alt" style={{ fontSize: 13, lineHeight: 1.5 }}>
                  Hand the cash to {receipt.issuer_name}. When they confirm it, this page turns into your paid receipt — keep it open.
                </div>
              )}
            </div>
          )}

          {payError && <p className="ptx-err" style={{ marginTop: 12 }}>{payError}</p>}
          {receipt.guest_ok === false && (
            <p className="ptx-note" style={{ marginTop: 12 }}>Mobile Money, card and bank start at UGX 500 — this one is smaller, so use your IcanEra wallet{receipt.cash_allowed ? ' or pay cash' : ''}.</p>
          )}
        </div>
      )}

      {!paid && !receipt.payable && receipt.pay_status === 'open' && receipt.pay_blocker && (
        <p className="ptx-note ptx-noprint" style={{ textAlign: 'center', marginTop: 12 }}>{receipt.pay_blocker}</p>
      )}

      <div className="ptx-actions ptx-noprint" style={{ marginTop: 14 }}>
        <button className="ptx-btn ptx-secondary" onClick={() => window.print()}><Printer width={16} height={16} /> Print / save PDF</button>
        <button className="ptx-btn ptx-secondary" onClick={share}>
          {copied ? <Copy width={16} height={16} /> : <Share2 width={16} height={16} />} {copied ? 'Link copied' : 'Share'}
        </button>
      </div>

      <p className="ptx-footer">Digitally recorded on the IcanEra ledger · icanera.space</p>

      {showAuth && (
        <div className="ptx ptx-noprint" style={{ position: 'fixed', inset: 0, zIndex: 60, overflowY: 'auto' }}>
          <button onClick={() => setShowAuth(false)} className="ptx-iconbtn ptx-alt" style={{ position: 'fixed', top: 12, right: 12, zIndex: 61 }} aria-label="Close">
            <X width={20} height={20} />
          </button>
          <AuthPage initialView="signup" onAuthSuccess={() => setShowAuth(false)} />
        </div>
      )}
    </>,
  );
};

export default PublicTransactionPage;

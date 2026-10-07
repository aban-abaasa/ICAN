import React, { useEffect, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { CLASSIC_PAY_CSS } from './publicPayTheme';
import PayAnyAmountForm from './PayAnyAmountForm';
import { getPayCodeInfo } from '../services/publicTransactionService';

/**
 * /p/<code> — the standing pay QR for a business that has NO public website page of its own.
 *
 * A business with a website (/notices/<company>) never shows this: the page hands the customer straight to
 * that website's Pay tab, so a QR printed from an older link still lands on the business's own page. Without
 * a website it is a small classic page: type what you are paying for, continue, choose how to pay.
 */
export default function PublicPayCodePage({ code }) {
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let cancelled = false;
    getPayCodeInfo(code)
      .then((data) => {
        if (cancelled) return;
        if (data?.found && data.active && data.company_id) {
          window.location.replace(`/notices/${data.company_id}?pay=1`);
          return;
        }
        setInfo(data?.found ? data : null);
        setLoading(false);
      })
      .catch((err) => { if (!cancelled) { setLoadError(err.message || 'Could not load this pay link'); setLoading(false); } });
    return () => { cancelled = true; };
  }, [code]);

  useEffect(() => {
    if (info?.issuer_name) document.title = `Pay ${info.issuer_name}`;
  }, [info]);

  const shell = (children) => (
    <div className="ptx">
      <style>{CLASSIC_PAY_CSS}</style>
      <div className="ptx-wrap">{children}</div>
    </div>
  );

  const message = (title, text) => shell(
    <div className="ptx-card" style={{ marginTop: 40 }}>
      <div className="ptx-body" style={{ textAlign: 'center', paddingTop: 28, paddingBottom: 28 }}>
        <AlertCircle className="ptx-faint" style={{ width: 40, height: 40, margin: '0 auto 10px' }} />
        <h1 className="ptx-h2">{title}</h1>
        <p className="ptx-muted" style={{ fontSize: 14, marginTop: 6, lineHeight: 1.5 }}>{text}</p>
      </div>
    </div>,
  );

  if (loading) return shell(<div style={{ display: 'flex', justifyContent: 'center', padding: '96px 0' }}><Loader2 className="animate-spin ptx-faint" style={{ width: 28, height: 28 }} /></div>);
  if (!info) return message(loadError ? 'Could not load this pay link' : 'Pay link not found', loadError || 'This QR is not valid. Ask the seller for their current QR.');
  if (!info.active) return message(`${info.issuer_name} is not taking QR payments right now`, 'Please pay another way, or ask them to switch their QR back on.');

  return shell(
    <>
      <div className="ptx-card">
        <div className="ptx-head">
          <p className="ptx-eyebrow">Pay with IcanEra</p>
          <h1 className="ptx-title">{info.issuer_name}</h1>
          <p className="ptx-sub">Type what you are paying for and its price. You choose how to pay next, and you get a receipt.</p>
        </div>
        <div className="ptx-body" style={{ paddingTop: 18 }}>
          <PayAnyAmountForm code={code} info={info} skin="ptx" />
        </div>
      </div>
      <p className="ptx-footer">Secured by IcanEra · icanera.space</p>
    </>,
  );
}

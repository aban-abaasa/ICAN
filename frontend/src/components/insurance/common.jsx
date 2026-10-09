import React, { useEffect, useRef, useState } from 'react';
import { X, AlertTriangle, Check } from 'lucide-react';
import { getLocalRate } from '../../services/insuranceService';
import { formatIcan, POLICY_STATE } from '../../utils/insuranceCatalog';
import '../profile/growth/growth.css';
import './insurance.css';

const TONE_CLASS = { ok: 'gr-chip--ok', warn: 'gr-chip--warn', bad: 'gr-chip--bad', muted: '' };

export function Chip({ tone = 'muted', children, title }) {
  return <span className={`gr-chip ${TONE_CLASS[tone] || ''}`} title={title}>{children}</span>;
}

export function StatePill({ state }) {
  const meta = POLICY_STATE[state] || POLICY_STATE.cancelled;
  return <Chip tone={meta.tone}>{meta.label}</Chip>;
}

export function Alert({ tone = 'info', children }) {
  const cls = tone === 'bad' ? 'gr-alert gr-alert--err' : tone === 'warn' ? 'gr-alert gr-alert--warn' : tone === 'ok' ? 'gr-alert gr-alert--ok' : 'gr-alert';
  const Icon = tone === 'ok' ? Check : AlertTriangle;
  return (
    <div className={cls} role={tone === 'bad' || tone === 'warn' ? 'alert' : 'status'}>
      <Icon aria-hidden="true" style={{ width: 16, height: 16, flex: 'none', marginTop: 2 }} />
      <span>{children}</span>
    </div>
  );
}

/** Live ICAN price in the signed-in person's own currency; null (and quietly hidden) if unreachable. */
export function useLocalRate(userId) {
  const [rate, setRate] = useState(null);
  useEffect(() => {
    if (!userId) return undefined;
    let cancelled = false;
    getLocalRate(userId).then((r) => { if (!cancelled) setRate(r); });
    return () => { cancelled = true; };
  }, [userId]);
  return rate;
}

/** "12.5 ICAN  ≈ UGX 62,500" */
export function Money({ ican, rate, suffix = '' }) {
  const local = rate && ican !== null && ican !== undefined ? `≈ ${rate.currency} ${Math.round(Number(ican) * rate.priceLocal).toLocaleString()}` : '';
  return (
    <span className="ins-money">
      <b>{formatIcan(ican)} ICAN</b>
      {suffix && <span> {suffix}</span>}
      {local && <small>{local}</small>}
    </span>
  );
}

/** A sheet on a phone, a centred dialog on a desktop. Escape closes it. */
export function Modal({ title, eyebrow, onClose, children }) {
  const closeRef = useRef(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = previous; };
  }, [onClose]);
  return (
    <div className="gr-modal" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="gr-modal__sheet" onClick={(e) => e.stopPropagation()}>
        <div className="gr-modal__head">
          <div style={{ minWidth: 0 }}>
            {eyebrow && <p className="gr-eyebrow">{eyebrow}</p>}
            <h3 className="gr-title gr-h">{title}</h3>
          </div>
          <button ref={closeRef} type="button" className="gr-icon-btn" onClick={onClose} aria-label="Close"><X aria-hidden="true" /></button>
        </div>
        <div className="gr-modal__body"><div className="gr-form">{children}</div></div>
      </div>
    </div>
  );
}

/** A labelled switch row with help text. */
export function ScopeSwitch({ checked, onChange, label, help, disabled }) {
  return (
    <label className="gr-switch ins-scope">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <i aria-hidden="true" />
      <span><b>{label}</b>{help && <small>{help}</small>}</span>
    </label>
  );
}

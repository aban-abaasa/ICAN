import React, { useEffect, useState } from 'react';
import { readPendingReferral, savePendingReferral, clearPendingReferral } from '../../services/referralCapture';
import { checkReferralCode } from '../../services/referralService';

const MESSAGES = {
  checking: { text: 'Checking…', tone: 'muted' },
  valid: { text: '✓ Code accepted — it will be linked to your account when you sign in, with Google too.', tone: 'ok' },
  unverified: { text: "We'll check this code when you sign in.", tone: 'muted' },
  paused: { text: 'Referral rewards are paused right now, but we\'ll keep your code.', tone: 'warn' },
  invalid: { text: "That code isn't valid — check the spelling.", tone: 'bad' },
  wrong_app: { text: 'That code belongs to a different app.', tone: 'bad' },
};
const TONE = { ok: '#34d399', bad: '#f87171', warn: '#fbbf24' };

/**
 * Optional "Have a referral code?" field for the sign-in / sign-up screens.
 * The code is saved in the browser as soon as it checks out, so it is redeemed
 * after sign-in whichever way the person continues — email and password, or
 * "Continue with Google" (which leaves the page and comes back). A code that
 * arrived through a shared ?ref= link is pre-filled here too.
 * Deliberately outside any validation the form does: it is never required.
 */
export default function ReferralCodeField({ palette }) {
  // Same look as the screens' own inputs, built from the palette they already pass around.
  const inputClassName = `w-full px-4 py-3 border rounded-xl focus:outline-none focus:ring-2 focus:border-transparent transition-all ${palette.inputPlaceholder}`;
  const inputStyle = {
    backgroundColor: palette.inputBg,
    borderColor: palette.inputBorder,
    color: palette.inputText,
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
  };
  const initial = readPendingReferral()?.code || '';
  const [open, setOpen] = useState(!!initial);
  const [value, setValue] = useState(initial);
  const [status, setStatus] = useState('idle');

  useEffect(() => {
    const code = value.trim().toUpperCase();
    if (!code) { clearPendingReferral(); setStatus('idle'); return undefined; }
    if (code.length < 4) { setStatus('idle'); return undefined; } // still typing — don't store half a code

    let cancelled = false;
    setStatus('checking');
    const t = setTimeout(async () => {
      try {
        const res = await checkReferralCode(code);
        if (cancelled) return;
        if (res.valid) { savePendingReferral(code); setStatus(res.paused ? 'paused' : 'valid'); }
        else { clearPendingReferral(); setStatus(res.reason === 'wrong_app' ? 'wrong_app' : 'invalid'); }
      } catch {
        // Offline / server hiccup: keep it, the server checks again at redeem time.
        if (!cancelled) { savePendingReferral(code); setStatus('unverified'); }
      }
    }, 500);
    return () => { cancelled = true; clearTimeout(t); };
  }, [value]);

  const msg = MESSAGES[status];

  return (
    <div>
      {!open ? (
        <button type="button" onClick={() => setOpen(true)}
          className="text-sm font-medium hover:underline" style={{ color: palette.link }}>
          Have a referral code?
        </button>
      ) : (
        <div>
          <label htmlFor="referral-code" className="block text-sm font-medium mb-2" style={{ color: palette.label }}>
            Referral code <span style={{ color: palette.muted }}>(optional — works with email or Google)</span>
          </label>
          <input
            id="referral-code"
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20))}
            className={inputClassName}
            style={{ ...inputStyle, letterSpacing: '0.12em', fontFamily: 'ui-monospace, monospace' }}
            placeholder="e.g. ABANI4821"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
          />
          {msg && (
            <p className="text-xs mt-1.5" style={{ color: TONE[msg.tone] || palette.muted }}>{msg.text}</p>
          )}
        </div>
      )}
    </div>
  );
}

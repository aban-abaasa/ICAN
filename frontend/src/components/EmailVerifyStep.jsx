import React, { useEffect, useRef, useState } from 'react';

const RESEND_SECONDS = 30;

const maskEmail = (email = '') => {
  const [user = '', domain = ''] = String(email).split('@');
  if (!domain) return email;
  return `${user.slice(0, 1)}•••@${domain}`;
};

/**
 * Body of an "email a 6-digit code" step: send, enter code, verify, resend.
 * The parent supplies the heading and the otp state ({ sent, verified, code,
 * loading, error }) plus the send/verify handlers, so the same step serves
 * personal sign-up, business sign-up and changing an email address.
 *
 * Colours come only from theme variables / the classic kit in index.css (the
 * `.acct-*` and `cmms-classic-*` classes), never from fixed Tailwind colours,
 * so it stays readable in every colour mode.
 */
const EmailVerifyStep = ({
  email,
  state,
  setState,
  onSend,
  onVerify,
  onChangeEmail,
  purpose = "We'll email a 6-digit code to confirm this address before you can set a PIN.",
  compact = false,
}) => {
  const [cooldown, setCooldown] = useState(0);
  const codeRef = useRef(null);

  // Start the resend countdown whenever a code has just been sent.
  useEffect(() => {
    if (state.sent && !state.verified) setCooldown(RESEND_SECONDS);
  }, [state.sent, state.verified]);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  useEffect(() => {
    if (state.sent && !state.verified) codeRef.current?.focus();
  }, [state.sent, state.verified]);

  const text = compact ? 'text-xs' : 'text-sm';
  const button = `cmms-classic-btn-primary px-4 py-2.5 ${text} disabled:cursor-not-allowed`;

  if (state.verified) {
    return (
      <div className="acct-classic">
        <div className={`acct-alert is-ok flex items-center gap-3 ${text}`}>
          <span className="acct-step is-done" aria-hidden="true">✓</span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Email verified</p>
            <p className="cmms-classic-muted truncate">{email}</p>
          </div>
          {onChangeEmail && (
            <button type="button" onClick={onChangeEmail} className="acct-link icon-btn-transparent flex-none">
              Change
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="acct-classic">
      <p className={`cmms-classic-muted mb-3 ${text}`}>{purpose}</p>

      {state.error && (
        <div role="alert" className="acct-alert is-error mb-3">
          {state.error}
        </div>
      )}

      {!state.sent ? (
        <button
          type="button"
          disabled={state.loading || !email}
          onClick={onSend}
          className={`w-full ${button}`}
        >
          {state.loading ? 'Sending code…' : 'Send verification code'}
        </button>
      ) : (
        <div>
          <p className={`mb-2 ${text}`}>
            Code sent to <span className="font-semibold">{maskEmail(email)}</span>. It expires in 10 minutes.
          </p>
          <div className="flex gap-2">
            <input
              ref={codeRef}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              aria-label="6-digit verification code"
              value={state.code}
              onChange={(e) => setState((prev) => ({ ...prev, code: e.target.value.replace(/\D/g, '').slice(0, 6) }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (state.code.length === 6 && !state.loading) onVerify();
                }
              }}
              placeholder="——————"
              className="acct-input min-w-0 flex-1 rounded-lg border px-3 py-2.5 text-center font-mono text-lg tracking-[0.45em]"
            />
            <button
              type="button"
              disabled={state.loading || state.code.length !== 6}
              onClick={onVerify}
              className={`flex-none ${button}`}
            >
              {state.loading ? 'Checking…' : 'Verify'}
            </button>
          </div>
          <div className={`cmms-classic-muted mt-2 flex items-center justify-between gap-3 ${text}`}>
            <span>Didn't get it? Check your spam folder.</span>
            <button
              type="button"
              disabled={state.loading || cooldown > 0}
              onClick={() => { setCooldown(RESEND_SECONDS); onSend(); }}
              className="acct-link icon-btn-transparent flex-none"
            >
              {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default EmailVerifyStep;

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, LogOut, ShieldAlert, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { getWalletPhoneAlertsStatus } from '../../services/walletPushService';
import {
  getPasswordChangedAt, getTotpFactors, isSecurityBackendMissing, listActivity, listSessions,
} from '../../services/securityService';
import { daysSinceNewest, securityPosture } from '../../utils/securityHelpers';
import ActivityCard from './security/ActivityCard';
import DevicesCard from './security/DevicesCard';
import PasswordCard from './security/PasswordCard';
import TwoStepCard from './security/TwoStepCard';
import { ScoreRing } from './growth/parts';
import './growth/growth.css';

const EMPTY_FACTORS = { verified: [], pending: [] };

/**
 * My Profile > Security. Everything here is real: sessions and history come from
 * Supabase Auth's own tables, two-step verification is Supabase MFA, and the score is
 * computed from the account's actual state.
 */
export default function SecurityPanel() {
  const { user, profile, signOutEverywhere } = useAuth();
  const [data, setData] = useState({ sessions: [], activity: [], factors: EMPTY_FACTORS, passwordChangedAt: null });
  const [loading, setLoading] = useState(true);
  const [historyMissing, setHistoryMissing] = useState(false);
  const [mfaNote, setMfaNote] = useState('');
  const [pushEnabled, setPushEnabled] = useState(false);
  const [confirmGlobal, setConfirmGlobal] = useState(false);
  const [globalBusy, setGlobalBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const [sessions, activity, factors, changedAt, push] = await Promise.allSettled([
      listSessions(), listActivity(40), getTotpFactors(), getPasswordChangedAt(), getWalletPhoneAlertsStatus(),
    ]);
    setHistoryMissing([sessions, activity].some((r) => r.status === 'rejected' && isSecurityBackendMissing(r.reason)));
    const real = [sessions, activity].find((r) => r.status === 'rejected' && !isSecurityBackendMissing(r.reason));
    if (real) setError(real.reason.message);
    setMfaNote(factors.status === 'rejected' ? factors.reason.message : '');
    setPushEnabled(push.status === 'fulfilled' && Boolean(push.value?.enabled));
    setData({
      sessions: sessions.status === 'fulfilled' ? sessions.value : [],
      activity: activity.status === 'fulfilled' ? activity.value : [],
      factors: factors.status === 'fulfilled' ? factors.value : EMPTY_FACTORS,
      passwordChangedAt: changedAt.status === 'fulfilled' ? changedAt.value : null,
    });
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const posture = useMemo(() => securityPosture({
    emailVerified: Boolean(user?.email_confirmed_at),
    mfaEnabled: data.factors.verified.length > 0,
    pushEnabled,
    passwordAgeDays: daysSinceNewest([data.passwordChangedAt, user?.created_at]),
    // When the device list is unavailable, do not mark the account down for it.
    sessionCount: historyMissing ? 1 : data.sessions.length,
    hasPhone: Boolean(profile?.phone),
  }), [user, profile, data, pushEnabled, historyMissing]);

  const weakest = posture.checks.filter((c) => !c.ok).sort((a, b) => b.weight - a.weight)[0];

  const doGlobal = async () => {
    setGlobalBusy(true);
    setError('');
    try { await signOutEverywhere(); } catch (err) { setError(err.message); setGlobalBusy(false); }
  };

  return (
    <section className="gr" aria-label="Security">
      <header className="gr-card gr-hero">
        <div className="gr-hero__top">
          <ScoreRing value={posture.score} label="Account protection" />
          <div className="gr-hero__copy">
            <p className="gr-eyebrow">Account protection</p>
            <h2 className="gr-title">{posture.level}</h2>
            <p className="gr-nudge">
              {weakest ? <><b>Next best step:</b> {weakest.bad}</> : 'Everything on the checklist is in place. Review your devices now and then.'}
            </p>
          </div>
        </div>
        <div className="gr-checks" aria-label="Protection checklist">
          {posture.checks.map((c) => (
            <div key={c.key} className={`gr-check ${c.ok ? 'is-ok' : ''}`}>
              <span className="gr-check__icon">{c.ok ? <Check aria-hidden="true" /> : <ShieldAlert aria-hidden="true" />}</span>
              <div>
                <p className="gr-check__t">{c.title}</p>
                <p className="gr-check__d">{c.ok ? c.good : c.bad}</p>
              </div>
              <span className="gr-small">{c.ok ? `+${c.weight}` : `0/${c.weight}`}</span>
            </div>
          ))}
        </div>
      </header>

      {historyMissing && (
        <div className="gr-alert gr-alert--warn" role="status">
          <AlertTriangle aria-hidden="true" />
          <span>Device and sign-in history are not switched on for this server yet. An administrator needs to apply the security center migration. Password and two-step verification work now.</span>
        </div>
      )}
      {error && (
        <div className="gr-alert gr-alert--err" role="alert">
          <AlertTriangle aria-hidden="true" /><span>{error}</span>
          <button type="button" className="gr-icon-btn gr-alert__x" style={{ width: 32, height: 32 }} onClick={() => setError('')} aria-label="Dismiss"><X aria-hidden="true" /></button>
        </div>
      )}
      {mfaNote && <div className="gr-alert gr-alert--warn" role="status"><AlertTriangle aria-hidden="true" /><span>Two-step verification is unavailable right now: {mfaNote}</span></div>}

      {loading ? (
        <><div className="gr-skel" /><div className="gr-skel" /></>
      ) : (
        <>
          {!mfaNote && <TwoStepCard factors={data.factors} onChanged={load} />}
          <PasswordCard email={user?.email} personal={[user?.email?.split('@')[0], profile?.full_name]} mfaFactorId={data.factors.verified[0]?.id} onChanged={load} />
          {!historyMissing && <DevicesCard sessions={data.sessions} onChanged={load} />}
          {!historyMissing && <ActivityCard activity={data.activity} />}
        </>
      )}

      <section className="gr-card gr-form" aria-label="Sign out everywhere">
        <div className="gr-status">
          <LogOut aria-hidden="true" />
          <div className="gr-status__body">
            <h3 className="gr-title gr-h">Sign out everywhere</h3>
            <p className="gr-sub">Ends every session on every device, including this one. Use it if a phone is lost or you think someone else has your password.</p>
          </div>
        </div>
        {!confirmGlobal ? (
          <button type="button" className="gr-btn gr-btn--danger" onClick={() => setConfirmGlobal(true)}><LogOut aria-hidden="true" />Sign out of all devices</button>
        ) : (
          <div className="gr-grid2">
            <button type="button" className="gr-btn gr-btn--ghost" onClick={() => setConfirmGlobal(false)} disabled={globalBusy}>Stay signed in</button>
            <button type="button" className="gr-btn gr-btn--danger" onClick={doGlobal} disabled={globalBusy}>Yes, sign out everywhere</button>
          </div>
        )}
      </section>
    </section>
  );
}

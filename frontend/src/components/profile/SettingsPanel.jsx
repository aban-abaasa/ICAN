import React, { useEffect, useState } from 'react';
import {
  AlertTriangle, Bell, BellRing, Check, Loader2, LogOut, Palette, Trash2, User, Target, ShieldAlert,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { THEMES, useTheme } from '../../context/ThemeContext';
import usePhoneAlerts from '../../hooks/usePhoneAlerts';
import { loadGrowthProfile } from '../../services/growthScheduleService';
import { loadSettings as loadReadinessSettings } from '../../services/readinessService';
import { getTotpFactors, verifyTotpCode } from '../../services/securityService';
import { Field } from './growth/parts';
import './growth/growth.css';

/**
 * My Profile > Settings. `bridge` carries the dashboard's saved-profile and
 * delete-account logic (kept where it already lived); without it the panel still offers
 * notifications, appearance and pillars.
 *   bridge = { config, danger, onOpenGrowth, onOpenReadiness }
 */
export default function SettingsPanel({ bridge }) {
  const sections = [
    ...(bridge?.config ? [{ id: 'profile', label: 'Profile' }] : []),
    { id: 'notifications', label: 'Notifications' },
    { id: 'appearance', label: 'Appearance' },
    { id: 'pillars', label: 'Pillars' },
    ...(bridge?.danger ? [{ id: 'danger', label: 'Danger zone', danger: true }] : []),
  ];
  const [active, setActive] = useState(sections[0].id);

  return (
    <section className="gr" aria-label="Settings">
      <div className="gr-subnav" role="group" aria-label="Settings sections">
        {sections.map((s) => (
          <button key={s.id} type="button" aria-pressed={active === s.id} className={s.danger ? 'is-danger' : ''} onClick={() => setActive(s.id)}>{s.label}</button>
        ))}
      </div>
      {active === 'profile' && bridge?.config && <ProfileSection config={bridge.config} />}
      {active === 'notifications' && <NotificationsSection onOpenGrowth={bridge?.onOpenGrowth} />}
      {active === 'appearance' && <AppearanceSection />}
      {active === 'pillars' && <PillarsSection onOpenGrowth={bridge?.onOpenGrowth} onOpenReadiness={bridge?.onOpenReadiness} />}
      {active === 'danger' && bridge?.danger && <DangerSection danger={bridge.danger} />}
    </section>
  );
}

function Feedback({ error, success }) {
  return (
    <>
      {error && <div className="gr-alert gr-alert--err" role="alert"><AlertTriangle aria-hidden="true" /><span>{error}</span></div>}
      {success && <div className="gr-alert gr-alert--ok" role="status"><Check aria-hidden="true" /><span>{success}</span></div>}
    </>
  );
}

function ProfileSection({ config }) {
  const { form } = config;
  return (
    <>
      <section className="gr-card gr-form" aria-label="Your details">
        <div className="gr-status"><User aria-hidden="true" /><div className="gr-status__body"><h3 className="gr-title gr-h">Your details</h3><p className="gr-sub">The name and email on your account.</p></div></div>
        <Field label="Full name" htmlFor="gr-set-name">
          <input id="gr-set-name" className="gr-input" autoComplete="name" value={form.fullName} onChange={(e) => config.onChange('fullName', e.target.value)} />
        </Field>
        <Field label="Email" htmlFor="gr-set-email">
          <input id="gr-set-email" className="gr-input" type="email" autoComplete="email" value={form.email} onChange={(e) => config.onChange('email', e.target.value)} />
        </Field>
        <button type="button" className="gr-btn gr-btn--primary" disabled={config.saving} onClick={() => config.onSave('full')}>
          {config.saving ? <Loader2 className="gr-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}Save details
        </button>
      </section>

      <section className="gr-card gr-form" aria-label="Wealth target">
        <div className="gr-status"><Target aria-hidden="true" /><div className="gr-status__body"><h3 className="gr-title gr-h">Wealth target</h3><p className="gr-sub">What you are building towards, and by when. Your dashboard measures progress against it.</p></div></div>
        <div className="gr-grid2">
          <Field label="Target net worth (UGX)" htmlFor="gr-set-target">
            <input id="gr-set-target" className="gr-input" inputMode="numeric" value={form.targetNetWorth}
              onChange={(e) => config.onChange('targetNetWorth', config.normalizeTarget(e.target.value))} />
          </Field>
          <Field label="Timeline (years)" htmlFor="gr-set-years">
            <input id="gr-set-years" className="gr-input" inputMode="numeric" value={form.timelineYears}
              onChange={(e) => config.onChange('timelineYears', e.target.value.replace(/[^\d]/g, ''))} />
          </Field>
        </div>
        <button type="button" className="gr-btn gr-btn--primary" disabled={config.saving} onClick={() => config.onSave('target')}>
          {config.saving ? <Loader2 className="gr-spin" aria-hidden="true" /> : <Target aria-hidden="true" />}Save target
        </button>
        <Feedback error={config.error} success={config.success} />
      </section>
    </>
  );
}

function NotificationsSection({ onOpenGrowth }) {
  const phone = usePhoneAlerts();
  return (
    <section className="gr-card gr-form" aria-label="Notifications">
      <div className="gr-status"><Bell aria-hidden="true" /><div className="gr-status__body"><h3 className="gr-title gr-h">Notifications</h3><p className="gr-sub">Choose how ICAN reaches you on this device.</p></div></div>
      <div className="gr-row">
        <div><p className="gr-row__t">Phone alerts</p><p className="gr-row__d">Wallet, CMMS and reminder alerts even when the app is closed.</p></div>
        <label className="gr-switch" style={{ minHeight: 44 }}>
          <input type="checkbox" checked={phone.enabled} disabled={phone.busy || !phone.supported || phone.permission === 'denied'} onChange={phone.toggle} aria-label="Phone alerts" />
          <i aria-hidden="true" />
        </label>
      </div>
      {phone.checked && !phone.supported && <div className="gr-alert" role="note">This browser cannot receive background alerts. In-app alerts still work.</div>}
      {phone.permission === 'denied' && <div className="gr-alert gr-alert--err" role="note"><ShieldAlert aria-hidden="true" /><span>Notifications are blocked for this site. Allow them in your browser or phone settings.</span></div>}
      {phone.message && <div className={`gr-alert gr-alert--${phone.message.kind === 'ok' ? 'ok' : 'err'}`} role="status">{phone.message.text}</div>}
      {onOpenGrowth && (
        <div className="gr-row">
          <div><p className="gr-row__t">Schedule reminders</p><p className="gr-row__d">Set per block in Growth, with the lead time you prefer.</p></div>
          <button type="button" className="gr-btn gr-btn--ghost gr-btn--sm" onClick={onOpenGrowth}><BellRing aria-hidden="true" />Open Growth</button>
        </div>
      )}
    </section>
  );
}

function AppearanceSection() {
  const { theme, changeTheme } = useTheme();
  return (
    <section className="gr-card gr-form" aria-label="Appearance">
      <div className="gr-status"><Palette aria-hidden="true" /><div className="gr-status__body"><h3 className="gr-title gr-h">Appearance</h3><p className="gr-sub">Pick the look you like. It applies everywhere, on every page.</p></div></div>
      <div className="gr-list" role="radiogroup" aria-label="Theme">
        {Object.values(THEMES).map((t) => (
          <button key={t.id} type="button" role="radio" aria-checked={theme === t.id} onClick={() => changeTheme(t.id)} className="gr-device"
            style={{ textAlign: 'left', cursor: 'pointer', borderColor: theme === t.id ? 'var(--gr-gold-hi)' : undefined, background: theme === t.id ? 'var(--gr-tint)' : 'transparent' }}>
            <span className="gr-device__icon" aria-hidden="true" style={{ fontSize: '1.2rem' }}>{t.icon}</span>
            <span><span className="gr-device__t" style={{ display: 'block' }}>{t.name}</span><span className="gr-device__m">{t.description}</span></span>
            {theme === t.id ? <span className="gr-chip gr-chip--ok"><Check aria-hidden="true" />On</span> : <span />}
          </button>
        ))}
      </div>
    </section>
  );
}

function PillarsSection({ onOpenGrowth, onOpenReadiness }) {
  const [values, setValues] = useState({ human: undefined, regulatory: undefined });
  useEffect(() => {
    let off = false;
    Promise.allSettled([loadGrowthProfile(), loadReadinessSettings()]).then(([growth, readiness]) => {
      if (off) return;
      setValues({
        human: growth.status === 'fulfilled' && growth.value?.score != null ? Math.round(growth.value.score) : null,
        regulatory: readiness.status === 'fulfilled' && readiness.value?.compliance_percent != null ? Math.round(Number(readiness.value.compliance_percent)) : null,
      });
    });
    return () => { off = true; };
  }, []);

  const rows = [
    { key: 'financial', name: 'Financial capital', desc: 'Transform volatility into secured wealth', value: null, hint: 'Measured from your wallet and records' },
    { key: 'legal', name: 'Legal resilience', desc: 'Contracts and obligations reviewed', value: null, hint: 'Not measured yet' },
    { key: 'regulatory', name: 'Regulatory compliance', desc: 'Your Readiness checklist', value: values.regulatory, action: onOpenReadiness, actionLabel: 'Open Readiness', color: 'recovery' },
    { key: 'human', name: 'Human capital', desc: 'Your Prosperity Architect score', value: values.human, action: onOpenGrowth, actionLabel: 'Open Growth', color: 'spiritual' },
  ];
  return (
    <section className="gr-card gr-form" aria-label="Readiness pillars">
      <div className="gr-status"><Target aria-hidden="true" /><div className="gr-status__body"><h3 className="gr-title gr-h">Readiness pillars</h3><p className="gr-sub">Only measured values are shown. Nothing here is a guess.</p></div></div>
      <div className="gr-list">
        {rows.map((r) => (
          <div key={r.key} className="gr-block" data-pillar={r.color || 'none'}>
            <div className="gr-block__head">
              <h4 className="gr-block__title"><span>{r.name}</span></h4>
              <span className="gr-chip">{r.value === undefined ? '…' : r.value === null ? 'Not measured' : `${r.value}%`}</span>
            </div>
            <p className="gr-block__why">{r.desc}</p>
            {typeof r.value === 'number' && <div className="gr-bar" role="presentation"><i style={{ width: `${r.value}%` }} /></div>}
            {r.action && <button type="button" className="gr-btn gr-btn--ghost gr-btn--sm" style={{ justifySelf: 'start' }} onClick={r.action}>{r.actionLabel}</button>}
          </div>
        ))}
      </div>
    </section>
  );
}

function DangerSection({ danger }) {
  const { signOut } = useAuth();
  const [factorId, setFactorId] = useState(null);
  const [code, setCode] = useState('');
  const [stepError, setStepError] = useState('');
  const [stepBusy, setStepBusy] = useState(false);
  const [outBusy, setOutBusy] = useState(false);

  useEffect(() => {
    let off = false;
    getTotpFactors().then((f) => { if (!off) setFactorId(f.verified[0]?.id || null); }).catch(() => {});
    return () => { off = true; };
  }, []);

  const remove = async () => {
    setStepError('');
    if (factorId) {
      // Step-up: with an authenticator app set up, deleting the account needs a fresh code.
      setStepBusy(true);
      try { await verifyTotpCode({ factorId, code }); } catch (err) { setStepError(err.message); setStepBusy(false); return; }
      setStepBusy(false);
    }
    danger.onDelete();
  };

  return (
    <>
      <section className="gr-card gr-form" aria-label="Sign out">
        <div className="gr-status"><LogOut aria-hidden="true" /><div className="gr-status__body"><h3 className="gr-title gr-h">Sign out</h3><p className="gr-sub">End your session on this device. Use Security to sign out other devices.</p></div></div>
        <button type="button" className="gr-btn gr-btn--ghost" disabled={outBusy} onClick={async () => { setOutBusy(true); try { await signOut(); } catch { setOutBusy(false); } }}>
          {outBusy ? <Loader2 className="gr-spin" aria-hidden="true" /> : <LogOut aria-hidden="true" />}Sign out
        </button>
      </section>

      <section className="gr-card gr-form" aria-label="Delete account" style={{ borderColor: 'color-mix(in srgb, var(--gr-err) 60%, transparent)' }}>
        <div className="gr-status"><Trash2 aria-hidden="true" style={{ color: 'var(--gr-err)' }} /><div className="gr-status__body"><h3 className="gr-title gr-h">Delete your account</h3></div></div>
        <div className="gr-alert gr-alert--err" role="note">
          <AlertTriangle aria-hidden="true" />
          <span><b>You will lose everything.</b> Deleting your account permanently erases your profile, wallets, balances, coin and trust transactions, business data and every other record linked to you. This cannot be undone.</span>
        </div>
        <Field label="Confirm your email" htmlFor="gr-del-email">
          <input id="gr-del-email" className="gr-input" type="email" autoComplete="email" placeholder="Enter your email address" value={danger.email} onChange={(e) => danger.setEmail(e.target.value)} />
        </Field>
        {danger.hasPassword ? (
          <Field label="Your password" htmlFor="gr-del-pw">
            <input id="gr-del-pw" className="gr-input" type="password" autoComplete="current-password" value={danger.password} onChange={(e) => danger.setPassword(e.target.value)} />
          </Field>
        ) : (
          <Field label="Type delete to confirm" htmlFor="gr-del-phrase" hint="This account signs in with Google, so there is no password to enter.">
            <input id="gr-del-phrase" className="gr-input" autoComplete="off" placeholder="delete" value={danger.phrase} onChange={(e) => danger.setPhrase(e.target.value)} />
          </Field>
        )}
        {factorId && (
          <Field label="Authenticator code" htmlFor="gr-del-totp" hint="Open your authenticator app and enter the current code.">
            <input id="gr-del-totp" className="gr-input gr-code" inputMode="numeric" autoComplete="one-time-code" placeholder="000000" value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
          </Field>
        )}
        <Feedback error={stepError || danger.error} success={danger.success} />
        <button type="button" className="gr-btn gr-btn--danger" disabled={danger.busy || stepBusy || (Boolean(factorId) && code.length !== 6)} onClick={remove}>
          {danger.busy || stepBusy ? <Loader2 className="gr-spin" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}Delete my account
        </button>
      </section>
    </>
  );
}

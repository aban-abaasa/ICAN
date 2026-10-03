import React, { useCallback, useEffect, useState } from 'react';
import {
  Smartphone, Bell, BellRing, Send, Check, Trash2, CheckCheck, Loader2, ShieldAlert, Info,
} from 'lucide-react';
import {
  disableWalletPhoneAlerts, enableWalletPhoneAlerts, getWalletPhoneAlertsStatus,
} from '../../../services/walletPushService';
import { browserPermission } from '../../../services/growthScheduleService';
import { formatTimeAgo } from '../../../services/universalNotificationsService';

const isIos = () => typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = () => typeof window !== 'undefined'
  && (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true);

const reminderTime = (item) => {
  const at = new Date(new Date(item.next_start_at).getTime() - item.remind_before_minutes * 60000);
  return at.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
};

export default function AlertsTab({
  items, notifications, loading, backendReady, onMarkRead, onMarkAllRead, onDelete, onClear, onTest,
}) {
  const [device, setDevice] = useState({ checked: false, supported: false, enabled: false });
  const [deviceBusy, setDeviceBusy] = useState(false);
  const [deviceMsg, setDeviceMsg] = useState(null); // { kind: 'ok' | 'err', text }
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState(null);
  const permission = browserPermission();

  const refreshDevice = useCallback(async () => {
    try {
      const status = await getWalletPhoneAlertsStatus();
      setDevice({ checked: true, ...status });
    } catch {
      setDevice({ checked: true, supported: false, enabled: false });
    }
  }, []);
  useEffect(() => { refreshDevice(); }, [refreshDevice]);

  const toggleDevice = async () => {
    setDeviceBusy(true);
    setDeviceMsg(null);
    try {
      if (device.enabled) {
        await disableWalletPhoneAlerts();
        setDeviceMsg({ kind: 'ok', text: 'Phone alerts are off on this device.' });
      } else {
        await enableWalletPhoneAlerts();
        setDeviceMsg({ kind: 'ok', text: 'Phone alerts are on. Reminders will reach you even when the app is closed.' });
      }
      await refreshDevice();
    } catch (err) {
      setDeviceMsg({ kind: 'err', text: err.message || 'Could not change phone alerts.' });
    }
    setDeviceBusy(false);
  };

  const sendTest = async () => {
    setTesting(true);
    setTestMsg(null);
    try {
      await onTest();
      setTestMsg({ kind: 'ok', text: 'Sent. It should appear below in a moment.' });
    } catch (err) {
      setTestMsg({ kind: 'err', text: err.message });
    }
    setTesting(false);
  };

  const upcoming = items
    .filter((i) => i.is_active && i.reminders_enabled && i.next_start_at)
    .sort((a, b) => new Date(a.next_start_at) - new Date(b.next_start_at))
    .slice(0, 3);
  const unread = notifications.filter((n) => !n.is_read).length;
  const needsInstall = isIos() && !isStandalone();

  return (
    <div className="gr-form" role="tabpanel" aria-label="Alerts">
      <section className="gr-card">
        <div className="gr-status">
          <Smartphone aria-hidden="true" />
          <div className="gr-status__body">
            <div className="gr-sectionhead">
              <h3 className="gr-title gr-h">Phone alerts</h3>
              {device.checked && (device.enabled
                ? <span className="gr-chip gr-chip--ok"><Check aria-hidden="true" />On</span>
                : <span className="gr-chip">Off</span>)}
            </div>
            <p className="gr-sub">
              Reminders always appear here while the app is open. Turn on phone alerts to receive them on this device
              when the app is closed, a little like an alarm for your priorities.
            </p>

            {needsInstall && (
              <div className="gr-alert gr-alert--warn" role="note">
                <Info aria-hidden="true" />
                <span>On iPhone and iPad, first add ICAN to your Home Screen (Share, then Add to Home Screen), then open it from there.</span>
              </div>
            )}
            {device.checked && !device.supported && !needsInstall && (
              <div className="gr-alert" role="note"><Info aria-hidden="true" /><span>This browser cannot receive background alerts. In-app reminders still work.</span></div>
            )}
            {permission === 'denied' && (
              <div className="gr-alert gr-alert--err" role="note">
                <ShieldAlert aria-hidden="true" />
                <span>Notifications are blocked for this site. Allow them in your browser or phone settings, then come back.</span>
              </div>
            )}
            {deviceMsg && <div className={`gr-alert gr-alert--${deviceMsg.kind === 'ok' ? 'ok' : 'err'}`} role="status">{deviceMsg.text}</div>}

            <div className="gr-row-actions">
              <button type="button" className={`gr-btn ${device.enabled ? 'gr-btn--ghost' : 'gr-btn--primary'}`}
                disabled={deviceBusy || !device.supported || permission === 'denied'} onClick={toggleDevice}>
                {deviceBusy ? <Loader2 className="gr-spin" aria-hidden="true" /> : <BellRing aria-hidden="true" />}
                {device.enabled ? 'Turn off on this device' : 'Turn on phone alerts'}
              </button>
              <button type="button" className="gr-btn gr-btn--ghost" disabled={testing || !backendReady} onClick={sendTest}>
                {testing ? <Loader2 className="gr-spin" aria-hidden="true" /> : <Send aria-hidden="true" />}
                Send a test alert
              </button>
            </div>
            {testMsg && <div className={`gr-alert gr-alert--${testMsg.kind === 'ok' ? 'ok' : 'err'}`} role="status">{testMsg.text}</div>}
          </div>
        </div>
      </section>

      {upcoming.length > 0 && (
        <section className="gr-card" aria-label="Coming up">
          <p className="gr-eyebrow">Coming up</p>
          <div className="gr-list" style={{ marginTop: 8 }}>
            {upcoming.map((i) => (
              <div key={i.id} className="gr-block__meta" style={{ justifyContent: 'space-between' }}>
                <span><Bell aria-hidden="true" />{i.title}</span>
                <span>Reminder {reminderTime(i)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="gr-form" aria-label="Reminder inbox">
        <div className="gr-sectionhead">
          <div>
            <p className="gr-eyebrow">Inbox</p>
            <h3 className="gr-title gr-h">Recent reminders {unread > 0 && <span className="gr-badge">{unread}</span>}</h3>
          </div>
          {notifications.length > 0 && (
            <div className="gr-block__actions">
              {unread > 0 && (
                <button type="button" className="gr-btn gr-btn--ghost gr-btn--sm" onClick={onMarkAllRead}><CheckCheck aria-hidden="true" />Mark all read</button>
              )}
              <button type="button" className="gr-btn gr-btn--ghost gr-btn--sm" onClick={onClear}><Trash2 aria-hidden="true" />Clear</button>
            </div>
          )}
        </div>

        {loading ? (
          <div className="gr-skel" />
        ) : notifications.length === 0 ? (
          <div className="gr-card gr-empty">
            <Bell aria-hidden="true" />
            <h4 className="gr-title">No reminders yet</h4>
            <p className="gr-sub">When a scheduled block is about to start, its reminder will appear here.</p>
          </div>
        ) : (
          <div className="gr-list">
            {notifications.map((n) => (
              <div key={n.id} className={`gr-notif ${n.is_read ? '' : 'is-unread'}`}>
                <span className="gr-notif__dot" aria-hidden="true" />
                <div>
                  <p className="gr-notif__t">{n.title}</p>
                  <p className="gr-notif__m">{n.message}</p>
                  <p className="gr-notif__when">{formatTimeAgo(n.created_at)}{n.is_read ? '' : ' · New'}</p>
                </div>
                <div className="gr-notif__acts">
                  {!n.is_read && (
                    <button type="button" className="gr-icon-btn" onClick={() => onMarkRead(n.id)} aria-label="Mark as read" title="Mark as read"><Check aria-hidden="true" /></button>
                  )}
                  <button type="button" className="gr-icon-btn gr-icon-btn--danger" onClick={() => onDelete(n.id)} aria-label="Delete reminder" title="Delete"><Trash2 aria-hidden="true" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

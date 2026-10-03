import { useCallback, useEffect, useState } from 'react';
import {
  disableWalletPhoneAlerts, enableWalletPhoneAlerts, getWalletPhoneAlertsStatus,
} from '../services/walletPushService';

/** Phone (push) alerts for this device: current status plus a toggle with plain-English errors. */
export default function usePhoneAlerts() {
  const [status, setStatus] = useState({ checked: false, supported: false, enabled: false });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null); // { kind: 'ok' | 'err', text }

  const refresh = useCallback(async () => {
    try {
      setStatus({ checked: true, ...(await getWalletPhoneAlertsStatus()) });
    } catch {
      setStatus({ checked: true, supported: false, enabled: false });
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const toggle = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      if (status.enabled) {
        await disableWalletPhoneAlerts();
        setMessage({ kind: 'ok', text: 'Phone alerts are off on this device.' });
      } else {
        await enableWalletPhoneAlerts();
        setMessage({ kind: 'ok', text: 'Phone alerts are on.' });
      }
      await refresh();
    } catch (err) {
      setMessage({ kind: 'err', text: err.message || 'Could not change phone alerts.' });
    }
    setBusy(false);
  }, [status.enabled, refresh]);

  const permission = typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported';
  return { ...status, busy, message, toggle, permission };
}

import { supabase } from '../lib/supabase/client';

// Real-world VAPID keys are frequently copy/pasted into a hosting provider's
// env var UI, which can silently add a trailing newline/space or wrapping
// quotes -- atob() then throws "The string to be decoded is not correctly
// encoded" instead of a useful error. Strip anything that cannot appear in a
// base64url string before decoding, and fail with a clear message instead.
const base64UrlToUint8Array = (value) => {
  const cleaned = String(value || '').trim().replace(/^["']|["']$/g, '');
  if (!/^[A-Za-z0-9_-]+$/.test(cleaned)) {
    throw new Error('Phone alerts are misconfigured for this app (invalid push key).');
  }
  const padding = '='.repeat((4 - (cleaned.length % 4)) % 4);
  const base64 = (cleaned + padding).replace(/-/g, '+').replace(/_/g, '/');
  try {
    return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  } catch {
    throw new Error('Phone alerts are misconfigured for this app (invalid push key).');
  }
};

const supportsWalletPush = () =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export async function getWalletPhoneAlertsStatus() {
  if (!supportsWalletPush()) {
    return { supported: false, enabled: false };
  }
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = registration ? await registration.pushManager.getSubscription() : null;
  return {
    supported: true,
    enabled: Notification.permission === 'granted' && Boolean(subscription),
  };
}

export async function enableWalletPhoneAlerts() {
  if (!supportsWalletPush()) {
    throw new Error('This browser does not support installed-app notifications.');
  }
  const vapidKey = import.meta.env.VITE_WEB_PUSH_VAPID_PUBLIC_KEY;
  if (!vapidKey) throw new Error('Phone alerts are not configured for this app.');
  const permission = Notification.permission === 'granted'
    ? 'granted'
    : await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted.');
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(vapidKey),
    });
  }
  const { error } = await supabase.rpc('ican_register_wallet_push_subscription', {
    p_subscription: subscription.toJSON(),
  });
  if (error) throw error;
  return subscription;
}

export async function disableWalletPhoneAlerts() {
  if (!supportsWalletPush()) return false;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = registration ? await registration.pushManager.getSubscription() : null;
  if (!subscription) return false;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  await supabase.from('ican_wallet_push_subscriptions').update({ is_active: false }).eq('endpoint', endpoint);
  return true;
}

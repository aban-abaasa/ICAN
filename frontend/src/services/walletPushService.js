import { supabase } from '../lib/supabase/client';

const base64UrlToUint8Array = (value) => {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
};

export async function enableWalletPhoneAlerts() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
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

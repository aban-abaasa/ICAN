// Supabase Edge Function: deliver a shared ICANera Wallet notification.
// Configure this as a Database Webhook for INSERT on
// public.ican_wallet_inbox_notifications. The webhook body is the inserted row.
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const webhookSecret = Deno.env.get('ICAN_WALLET_PUSH_WEBHOOK_SECRET');
const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')!;
const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')!;
const vapidSubject = Deno.env.get('VAPID_SUBJECT') || 'mailto:security@icanera.com';

webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
const admin = createClient(supabaseUrl, serviceRoleKey);

Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (webhookSecret && request.headers.get('x-ican-wallet-webhook-secret') !== webhookSecret) {
    return new Response('Unauthorized', { status: 401 });
  }

  const event = await request.json();
  // Supabase Database Webhooks send the row in "record". Accept a direct
  // record too so the endpoint can be exercised safely in development.
  const notification = event.record || event;
  if (!notification?.recipient_user_id || !notification?.id) {
    return new Response('Missing wallet notification record', { status: 400 });
  }

  const { data: subscriptions, error } = await admin
    .from('ican_wallet_push_subscriptions')
    .select('id, endpoint, subscription')
    .eq('user_id', notification.recipient_user_id)
    .eq('is_active', true);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const payload = JSON.stringify({
    title: notification.title || 'ICANera Wallet',
    body: notification.message || 'You have a new wallet notification.',
    tag: `ican-wallet-${notification.id}`,
    url: '/wallet',
  });

  const deliveries = await Promise.all((subscriptions || []).map(async (device) => {
    try {
      await webpush.sendNotification(device.subscription, payload, { TTL: 60 * 60 * 12 });
      return { id: device.id, delivered: true };
    } catch (pushError) {
      const statusCode = (pushError as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await admin.from('ican_wallet_push_subscriptions').update({ is_active: false }).eq('id', device.id);
      }
      return { id: device.id, delivered: false, statusCode };
    }
  }));

  return Response.json({ notificationId: notification.id, deliveries });
});

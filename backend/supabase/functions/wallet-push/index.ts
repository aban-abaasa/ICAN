// Supabase Edge Function: deliver an ICAN push notification.
// Configured as the HTTP target for two Postgres triggers (pg_net) plus one
// direct RPC call:
//   - ican_dispatch_wallet_push_webhook on public.ican_wallet_inbox_notifications
//     (see ICAN_SHARED_WALLET_PUSH_SETUP.sql)
//   - ican_dispatch_cmms_push_webhook on public.cmms_notifications
//     (see ICAN_CMMS_PUSH_NOTIFICATIONS.sql)
//   - ican_notify_community_live(), called directly (no inbox table -
//     nothing reads a "went live" alert back later) when a Community
//     broadcast starts (see ICAN_COMMUNITY_LIVE_PUSH_SETUP.sql)
// All three share this one relay and the one ican_wallet_push_subscriptions
// table of registered devices - a signed-in user who has enabled phone
// alerts gets push for any source without a separate opt-in. The first two
// are aimed at one recipient_user_id; community_live has none - it's a
// broadcast to every active device except the one that went live.
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

const SOURCE_DEFAULTS: Record<string, { title: string; url: string }> = {
  wallet: { title: 'ICANera Wallet', url: '/wallet' },
  cmms: { title: 'ICAN CMMS', url: '/cmms' },
  community_live: { title: 'ICAN Community', url: '/?join=community-live' },
};

Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (webhookSecret && request.headers.get('x-ican-wallet-webhook-secret') !== webhookSecret) {
    return new Response('Unauthorized', { status: 401 });
  }

  const event = await request.json();
  // Supabase Database Webhooks send the row in "record". The pg_net
  // triggers/RPCs in this project post the record (or a hand-built object)
  // directly - accept both shapes.
  const notification = event.record || event;
  const source = notification.source || 'wallet';
  const isBroadcast = source === 'community_live';
  if (!notification?.id || (!isBroadcast && !notification?.recipient_user_id)) {
    return new Response('Missing notification record', { status: 400 });
  }

  const defaults = SOURCE_DEFAULTS[source] || SOURCE_DEFAULTS.wallet;

  // A broadcast (e.g. "someone went live") has no single recipient - push
  // to every active device except the broadcaster's own.
  let subscriptionsQuery = admin
    .from('ican_wallet_push_subscriptions')
    .select('id, endpoint, subscription')
    .eq('is_active', true);
  subscriptionsQuery = isBroadcast
    ? (notification.broadcaster_id ? subscriptionsQuery.neq('user_id', notification.broadcaster_id) : subscriptionsQuery)
    : subscriptionsQuery.eq('user_id', notification.recipient_user_id);

  const { data: subscriptions, error } = await subscriptionsQuery;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const payload = JSON.stringify({
    title: notification.title || defaults.title,
    body: notification.message || 'You have a new notification.',
    tag: `ican-${source}-${notification.id}`,
    url: defaults.url,
    data: {
      source,
      actionTab: notification.action_tab || null,
      relatedTaskId: notification.related_task_id || null,
    },
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

  return Response.json({ notificationId: notification.id, source, deliveries });
});

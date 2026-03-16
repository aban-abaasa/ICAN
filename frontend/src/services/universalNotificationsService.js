import { getSupabase } from './pitchingService';

const SOURCE = {
  INVESTMENT: 'investment_notifications',
  SHAREHOLDER: 'shareholder_notifications',
  CMMS: 'cmms_notifications',
  LEGACY: 'notifications'
};

const resolveReadState = (row) => {
  if (typeof row?.is_read === 'boolean') return row.is_read;
  if (typeof row?.status === 'string') return row.status.toLowerCase() === 'read';
  return Boolean(row?.read_at);
};

const normalizePriority = (priority) => {
  const value = String(priority || 'normal').toLowerCase();
  if (value === 'low' || value === 'normal' || value === 'high' || value === 'urgent') {
    return value;
  }
  return 'normal';
};

const normalizeNotifications = ({ rows, source }) => {
  return (rows || []).map((row) => {
    let metadata = row.metadata;
    if (typeof metadata === 'string') {
      try {
        metadata = JSON.parse(metadata);
      } catch {
        metadata = null;
      }
    }

    const title =
      row.title ||
      row.notification_title ||
      row.subject ||
      'Notification';

    const message =
      row.message ||
      row.notification_message ||
      row.body ||
      '';

    const createdAt =
      row.created_at ||
      row.requested_at ||
      row.updated_at ||
      new Date().toISOString();

    const type =
      row.notification_type ||
      row.edit_type ||
      row.type ||
      source;

    const actionTab =
      row.action_tab ||
      (source === SOURCE.CMMS ? 'cmms' : source === SOURCE.LEGACY ? 'wallet' : 'pitchin');

    const sourceLabel =
      source === SOURCE.CMMS
        ? 'CMMS'
        : source === SOURCE.LEGACY
        ? 'Wallet/Trust'
        : source === SOURCE.SHAREHOLDER
        ? 'Pitchin Trust'
        : 'Pitchin';

    return {
      id: `${source}:${row.id}`,
      source,
      source_id: row.id,
      source_label: sourceLabel,
      notification_type: type,
      title,
      message,
      priority: normalizePriority(row.priority),
      action_url: row.action_url || row.action_link || null,
      action_label: row.action_label || null,
      action_tab: actionTab,
      group_id: metadata?.group_id || metadata?.groupId || row.group_id || row.groupId || null,
      created_at: createdAt,
      read_at: row.read_at || null,
      is_read: resolveReadState(row),
      raw: row
    };
  });
};

const safeFetch = async (queryFn) => {
  try {
    const { data, error } = await queryFn();
    if (error) {
      return [];
    }
    return data || [];
  } catch {
    return [];
  }
};

const updateWithFallback = async (sb, tableName, id, payloads) => {
  for (const payload of payloads) {
    const { error } = await sb.from(tableName).update(payload).eq('id', id);
    if (!error) {
      return { success: true };
    }
  }
  return { success: false };
};

export const getUserNotifications = async (userId, { unreadOnly = false, limit = 50 } = {}) => {
  const sb = getSupabase();
  if (!sb || !userId) {
    return { success: false, data: [] };
  }

  let authEmail = null;
  try {
    const { data: authData } = await sb.auth.getUser();
    authEmail = authData?.user?.email || null;
  } catch {
    authEmail = null;
  }

  const [investmentRows, shareholderRows, cmmsRows, legacyRows] = await Promise.all([
    safeFetch(() =>
      sb
        .from(SOURCE.INVESTMENT)
        .select('*')
        .eq('recipient_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit)
    ),
    safeFetch(() => {
      let query = sb
        .from(SOURCE.SHAREHOLDER)
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (authEmail) {
        query = query.or(`shareholder_id.eq.${userId},shareholder_email.ilike.${authEmail}`);
      } else {
        query = query.eq('shareholder_id', userId);
      }

      return query;
    }),
    safeFetch(() =>
      sb
        .from(SOURCE.CMMS)
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit)
    ),
    safeFetch(() =>
      sb
        .from(SOURCE.LEGACY)
        .select('*')
        .eq('recipient_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit)
    )
  ]);

  let merged = [
    ...normalizeNotifications({ rows: investmentRows, source: SOURCE.INVESTMENT }),
    ...normalizeNotifications({ rows: shareholderRows, source: SOURCE.SHAREHOLDER }),
    ...normalizeNotifications({ rows: cmmsRows, source: SOURCE.CMMS }),
    ...normalizeNotifications({ rows: legacyRows, source: SOURCE.LEGACY })
  ];

  if (unreadOnly) {
    merged = merged.filter((n) => !n.is_read);
  }

  merged.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return { success: true, data: merged.slice(0, limit) };
};

export const getUnreadNotificationCount = async (userId) => {
  const { data } = await getUserNotifications(userId, { unreadOnly: true, limit: 200 });
  return { success: true, count: (data || []).length };
};

export const markNotificationAsRead = async (notificationOrId) => {
  const sb = getSupabase();
  if (!sb) {
    return { success: false, error: 'Supabase not available' };
  }

  if (notificationOrId && typeof notificationOrId === 'object' && notificationOrId.source && notificationOrId.source_id) {
    const source = notificationOrId.source;
    const sourceId = notificationOrId.source_id;

    if (source === SOURCE.INVESTMENT) {
      return updateWithFallback(sb, SOURCE.INVESTMENT, sourceId, [
        { is_read: true, read_at: new Date().toISOString() },
        { read_at: new Date().toISOString() }
      ]);
    }

    if (source === SOURCE.CMMS) {
      return updateWithFallback(sb, SOURCE.CMMS, sourceId, [
        { is_read: true, read_at: new Date().toISOString() },
        { read_at: new Date().toISOString() }
      ]);
    }

    if (source === SOURCE.SHAREHOLDER) {
      return updateWithFallback(sb, SOURCE.SHAREHOLDER, sourceId, [
        { read_at: new Date().toISOString() },
        { is_read: true, read_at: new Date().toISOString() }
      ]);
    }

    if (source === SOURCE.LEGACY) {
      return updateWithFallback(sb, SOURCE.LEGACY, sourceId, [
        { status: 'read', read_at: new Date().toISOString() },
        { is_read: true, read_at: new Date().toISOString() },
        { status: 'read' }
      ]);
    }
  }

  const notificationId = String(notificationOrId || '');
  if (!notificationId) return { success: false };

  for (const tableName of [SOURCE.INVESTMENT, SOURCE.CMMS, SOURCE.SHAREHOLDER, SOURCE.LEGACY]) {
    const result = await updateWithFallback(sb, tableName, notificationId, [
      { is_read: true, read_at: new Date().toISOString() },
      { read_at: new Date().toISOString() },
      { status: 'read' }
    ]);
    if (result.success) return result;
  }

  return { success: false };
};

export const markAllNotificationsAsRead = async (userId, notifications = []) => {
  let targetNotifications = notifications;

  if (!targetNotifications.length) {
    const { data } = await getUserNotifications(userId, { unreadOnly: true, limit: 300 });
    targetNotifications = data || [];
  }

  const unread = targetNotifications.filter((n) => !n.is_read);
  if (!unread.length) {
    return { success: true, count: 0 };
  }

  await Promise.allSettled(unread.map((n) => markNotificationAsRead(n)));
  return { success: true, count: unread.length };
};

export const subscribeToUserNotifications = (userId, callback) => {
  const sb = getSupabase();
  if (!sb || !userId) {
    return () => {};
  }

  const channels = [];

  const investmentChannel = sb
    .channel(`universal-investment:${userId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: SOURCE.INVESTMENT,
        filter: `recipient_id=eq.${userId}`
      },
      (payload) => {
        const [normalized] = normalizeNotifications({ rows: [payload.new], source: SOURCE.INVESTMENT });
        if (normalized) callback(normalized);
      }
    )
    .subscribe();

  const shareholderChannel = sb
    .channel(`universal-shareholder:${userId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: SOURCE.SHAREHOLDER,
        filter: `shareholder_id=eq.${userId}`
      },
      (payload) => {
        const [normalized] = normalizeNotifications({ rows: [payload.new], source: SOURCE.SHAREHOLDER });
        if (normalized) callback(normalized);
      }
    )
    .subscribe();

  const legacyChannel = sb
    .channel(`universal-legacy:${userId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: SOURCE.LEGACY,
        filter: `recipient_id=eq.${userId}`
      },
      (payload) => {
        const [normalized] = normalizeNotifications({ rows: [payload.new], source: SOURCE.LEGACY });
        if (normalized) callback(normalized);
      }
    )
    .subscribe();

  channels.push(investmentChannel, shareholderChannel, legacyChannel);

  return () => {
    channels.forEach((channel) => sb.removeChannel(channel));
  };
};

export const getNotificationIcon = (type, source) => {
  const key = String(type || '').toLowerCase();

  if (source === SOURCE.CMMS) return '🛠️';
  if (source === SOURCE.LEGACY) return '💳';
  if (source === SOURCE.SHAREHOLDER) return '🤝';

  const icons = {
    new_investment: '💰',
    signature_request: '✍️',
    signature_completed: '✅',
    agreement_sealed: '🎉',
    document_review: '📄',
    escrow_released: '🔓',
    shareholder_added: '👥'
  };

  return icons[key] || '🔔';
};

export const getNotificationColor = (priority) => {
  const value = normalizePriority(priority);
  const colors = {
    low: 'text-gray-400 bg-gray-500/10 border-gray-500/30',
    normal: 'text-blue-400 bg-blue-500/10 border-blue-500/30',
    high: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30',
    urgent: 'text-red-400 bg-red-500/10 border-red-500/30'
  };
  return colors[value] || colors.normal;
};

export const formatTimeAgo = (timestamp) => {
  const now = new Date();
  const then = new Date(timestamp);
  const seconds = Math.floor((now - then) / 1000);

  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return then.toLocaleDateString();
};

export default {
  getUserNotifications,
  getUnreadNotificationCount,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  subscribeToUserNotifications,
  getNotificationIcon,
  getNotificationColor,
  formatTimeAgo
};

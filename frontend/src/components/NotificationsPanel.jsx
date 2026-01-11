import React, { useState, useEffect } from 'react';
import { Bell, X, CheckCircle2, ExternalLink } from 'lucide-react';
import { supabase } from '../lib/supabase/client';

const NotificationsPanel = ({ userId, companyId, onActionClick }) => {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showPanel, setShowPanel] = useState(false);
  const [loading, setLoading] = useState(true);

  // Load notifications on mount
  useEffect(() => {
    loadNotifications();
    
    // Set up real-time subscription
    const subscription = supabase
      .channel('cmms_notifications')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'cmms_notifications' },
        (payload) => {
          console.log('📬 New notification:', payload);
          loadNotifications();
        }
      )
      .subscribe();

    return () => subscription.unsubscribe();
  }, [userId, companyId]);

  const loadNotifications = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('cmms_notifications')
        .select('*')
        .eq('cmms_user_id', userId)
        .eq('cmms_company_id', companyId)
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) throw error;

      setNotifications(data || []);
      const unread = data?.filter(n => !n.is_read).length || 0;
      setUnreadCount(unread);
      console.log(`📬 Loaded ${data?.length || 0} notifications (${unread} unread)`);
    } catch (err) {
      console.error('Error loading notifications:', err);
    } finally {
      setLoading(false);
    }
  };

  const markAsRead = async (notificationId) => {
    try {
      const { error } = await supabase
        .from('cmms_notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('id', notificationId);

      if (error) throw error;

      setNotifications(prev =>
        prev.map(n => n.id === notificationId ? { ...n, is_read: true } : n)
      );
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (err) {
      console.error('Error marking notification as read:', err);
    }
  };

  const deleteNotification = async (notificationId) => {
    try {
      const { error } = await supabase
        .from('cmms_notifications')
        .delete()
        .eq('id', notificationId);

      if (error) throw error;

      setNotifications(prev => prev.filter(n => n.id !== notificationId));
    } catch (err) {
      console.error('Error deleting notification:', err);
    }
  };

  const handleActionClick = (notification) => {
    console.log(`🔗 Notification action clicked:`, notification);
    
    // Mark as read when clicked
    if (!notification.is_read) {
      markAsRead(notification.id);
    }

    // Call parent handler with tab info to navigate
    if (onActionClick && notification.action_tab) {
      console.log(`🔗 Navigating to tab: ${notification.action_tab}`);
      onActionClick(notification.action_tab);
      setShowPanel(false);
    }
  };

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    
    return date.toLocaleDateString();
  };

  return (
    <div className="relative">
      {/* Notification Bell Icon */}
      <button
        onClick={() => setShowPanel(!showPanel)}
        className="relative p-2 text-gray-300 hover:text-white transition-colors"
        title={`${unreadCount} unread notifications`}
      >
        <Bell className="w-6 h-6" />
        {unreadCount > 0 && (
          <span className="absolute top-0 right-0 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center font-bold">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Notifications Panel */}
      {showPanel && (
        <div className="absolute right-0 mt-2 w-96 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-50 max-h-96 overflow-y-auto">
          {/* Header */}
          <div className="sticky top-0 bg-slate-900 p-4 border-b border-slate-700 flex items-center justify-between">
            <h3 className="text-white font-bold flex items-center gap-2">
              <Bell className="w-5 h-5 text-blue-400" />
              Notifications
              {unreadCount > 0 && (
                <span className="ml-auto bg-red-500 text-white text-xs px-2 py-1 rounded-full">
                  {unreadCount} new
                </span>
              )}
            </h3>
            <button
              onClick={() => setShowPanel(false)}
              className="text-gray-400 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Notifications List */}
          {loading ? (
            <div className="p-8 text-center text-gray-400">
              Loading notifications...
            </div>
          ) : notifications.length === 0 ? (
            <div className="p-8 text-center text-gray-400">
              No notifications yet
            </div>
          ) : (
            <div className="divide-y divide-slate-700">
              {notifications.map(notification => (
                <div
                  key={notification.id}
                  className={`p-4 hover:bg-slate-700/50 transition-colors ${
                    !notification.is_read ? 'bg-blue-900/20 border-l-4 border-blue-500' : ''
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {/* Icon */}
                    <div className="text-2xl flex-shrink-0">
                      {notification.icon}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <h4 className="text-white font-semibold text-sm">
                            {notification.title}
                          </h4>
                          <p className="text-gray-300 text-sm mt-1 line-clamp-2">
                            {notification.message}
                          </p>
                          <div className="text-xs text-gray-500 mt-2">
                            {formatTime(notification.created_at)}
                          </div>

                          {/* Action Button */}
                          {notification.action_tab && (
                            <button
                              onClick={() => handleActionClick(notification)}
                              className="mt-3 px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white text-xs rounded font-semibold flex items-center gap-1.5 transition-colors"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              {notification.action_label || 'View'}
                            </button>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {!notification.is_read && (
                            <button
                              onClick={() => markAsRead(notification.id)}
                              className="p-1 text-green-400 hover:bg-green-500/20 rounded transition-colors"
                              title="Mark as read"
                            >
                              <CheckCircle2 className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            onClick={() => deleteNotification(notification.id)}
                            className="p-1 text-gray-400 hover:text-red-400 hover:bg-red-500/20 rounded transition-colors"
                            title="Delete"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Footer */}
          {notifications.length > 0 && (
            <div className="p-3 border-t border-slate-700 text-center">
              <button
                onClick={() => {
                  notifications.forEach(n => {
                    if (!n.is_read) markAsRead(n.id);
                  });
                }}
                className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
              >
                Mark all as read
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default NotificationsPanel;

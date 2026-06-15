import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Bell, X, CheckCheck } from 'lucide-react';
import { supabase } from '../lib/supabase/client';

/**
 * NotificationsPanel Component
 * Fetches and displays CMMS notifications from Supabase cmms_notifications table
 */
const NotificationsPanel = ({ 
  userId, 
  companyId, 
  onActionClick = () => {} 
}) => {
  const [showDropdown, setShowDropdown] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState({});
  const bellRef = useRef(null);
  const dropdownRef = useRef(null);

  const loadNotifications = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('cmms_notifications')
        .select('*')
        .eq('cmms_company_id', companyId)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) {
        console.error('Error fetching CMMS notifications:', error);
        return;
      }

      setNotifications(data || []);
      setUnreadCount((data || []).filter(n => !n.is_read).length);
    } catch (error) {
      console.error('Error loading CMMS notifications:', error);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  // Fetch on mount and when companyId changes
  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  // Real-time subscription for new notifications
  useEffect(() => {
    if (!companyId) return;

    const channel = supabase
      .channel(`cmms_notifications_${companyId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'cmms_notifications',
        filter: `cmms_company_id=eq.${companyId}`
      }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setNotifications(prev => [payload.new, ...prev]);
          if (!payload.new.is_read) {
            setUnreadCount(prev => prev + 1);
          }
        } else if (payload.eventType === 'UPDATE') {
          setNotifications(prev =>
            prev.map(n => n.id === payload.new.id ? payload.new : n)
          );
          // Recalculate unread
          setNotifications(prev => {
            setUnreadCount(prev.filter(n => !n.is_read).length);
            return prev;
          });
        } else if (payload.eventType === 'DELETE') {
          setNotifications(prev => prev.filter(n => n.id !== payload.old.id));
          setNotifications(prev => {
            setUnreadCount(prev.filter(n => !n.is_read).length);
            return prev;
          });
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [companyId]);

  // Position dropdown within viewport
  useEffect(() => {
    if (showDropdown && bellRef.current) {
      const rect = bellRef.current.getBoundingClientRect();
      const dropdownWidth = Math.min(320, window.innerWidth - 16);
      let left = rect.right - dropdownWidth;
      if (left < 8) left = 8;
      setDropdownStyle({
        position: 'fixed',
        top: rect.bottom + 8,
        left,
        width: dropdownWidth,
      });
    }
  }, [showDropdown]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    };
    if (showDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showDropdown]);

  const markAsRead = async (notificationId) => {
    try {
      const { error } = await supabase
        .from('cmms_notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('id', notificationId);

      if (!error) {
        setNotifications(prev =>
          prev.map(n => n.id === notificationId ? { ...n, is_read: true, read_at: new Date().toISOString() } : n)
        );
        setUnreadCount(prev => Math.max(0, prev - 1));
      }
    } catch (err) {
      console.error('Error marking notification as read:', err);
    }
  };

  const markAllAsRead = async () => {
    const unreadIds = notifications.filter(n => !n.is_read).map(n => n.id);
    if (unreadIds.length === 0) return;

    try {
      const { error } = await supabase
        .from('cmms_notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .in('id', unreadIds);

      if (!error) {
        setNotifications(prev => prev.map(n => ({ ...n, is_read: true, read_at: new Date().toISOString() })));
        setUnreadCount(0);
      }
    } catch (err) {
      console.error('Error marking all notifications as read:', err);
    }
  };

  const handleNotificationClick = async (notification) => {
    if (!notification.is_read) {
      await markAsRead(notification.id);
    }
    if (notification.action_tab) {
      onActionClick(notification.action_tab);
      setShowDropdown(false);
    }
  };

  const formatTime = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell Icon */}
      <button
        ref={bellRef}
        onClick={() => setShowDropdown(!showDropdown)}
        className="relative p-2 text-slate-400 hover:text-white transition"
        title="Notifications"
      >
        <Bell className="w-6 h-6" />
        {unreadCount > 0 && (
          <span className="absolute top-0 right-0 bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown Menu */}
      {showDropdown && (
        <div style={dropdownStyle} className="bg-slate-800 rounded-lg shadow-2xl border border-slate-700 z-[9999]">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-slate-700">
            <h3 className="font-semibold text-white">Notifications</h3>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  onClick={markAllAsRead}
                  className="text-purple-400 hover:text-purple-300 text-xs flex items-center gap-1 transition-colors"
                  title="Mark all as read"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                onClick={() => setShowDropdown(false)}
                className="text-slate-400 hover:text-white p-1 rounded transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="max-h-96 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : notifications.length === 0 ? (
              <div className="p-6 text-center">
                <Bell className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                <p className="text-slate-400 text-sm">No notifications yet</p>
                <p className="text-slate-500 text-xs mt-1">You'll see CMMS updates here</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-700">
                {notifications.map((notification) => (
                  <div
                    key={notification.id}
                    className={`p-4 hover:bg-slate-700/50 transition cursor-pointer ${
                      !notification.is_read ? 'bg-purple-500/5 border-l-2 border-l-purple-500' : ''
                    }`}
                    onClick={() => handleNotificationClick(notification)}
                  >
                    <div className="flex items-start gap-3">
                      <span className="text-lg flex-shrink-0">{notification.icon || '📬'}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className={`text-sm font-semibold ${!notification.is_read ? 'text-white' : 'text-white/70'}`}>
                            {notification.title}
                          </p>
                          {!notification.is_read && (
                            <div className="flex-shrink-0 w-2 h-2 bg-blue-500 rounded-full mt-1" />
                          )}
                        </div>
                        <p className="text-xs text-slate-400 mt-1 line-clamp-2">
                          {notification.message}
                        </p>
                        <div className="flex items-center justify-between mt-2">
                          <span className="text-xs text-slate-500">{formatTime(notification.created_at)}</span>
                          {notification.action_label && notification.action_tab && (
                            <span className="text-xs text-purple-400">{notification.action_label}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationsPanel;

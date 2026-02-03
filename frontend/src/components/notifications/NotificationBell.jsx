/**
 * NotificationBell Component
 * Displays bell icon with unread count badge and notification dropdown
 * Integrates with investment notifications system
 */

import React, { useState, useEffect, useRef } from 'react';
import { Bell, X, Check, CheckCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  getUserNotifications,
  getUnreadNotificationCount,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  subscribeToUserNotifications,
  getNotificationIcon,
  getNotificationColor,
  formatTimeAgo
} from '../../services/investmentNotificationsService';
import { getSupabase } from '../../services/pitchingService';

const NotificationBell = ({ userId, className = '' }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef(null);
  const navigate = useNavigate();

  // ==============================================
  // LOAD NOTIFICATIONS
  // ==============================================

  const loadNotifications = async () => {
    if (!userId) return;
    setLoading(true);

    try {
      const { data } = await getUserNotifications(userId, { limit: 20 });
      setNotifications(data || []);

      const { count } = await getUnreadNotificationCount(userId);
      setUnreadCount(count || 0);
    } catch (error) {
      console.error('Error loading notifications:', error);
    } finally {
      setLoading(false);
    }
  };

  // ==============================================
  // HANDLE NOTIFICATION CLICK
  // ==============================================

  const handleNotificationClick = async (notification) => {
    // Mark as read
    if (!notification.is_read) {
      await markNotificationAsRead(notification.id);
      setUnreadCount(prev => Math.max(0, prev - 1));
      setNotifications(prev =>
        prev.map(n =>
          n.id === notification.id
            ? { ...n, is_read: true, read_at: new Date().toISOString() }
            : n
        )
      );
    }

    // Navigate to action URL
    if (notification.action_url) {
      navigate(notification.action_url);
      setIsOpen(false);
    } else if (notification.agreement_id) {
      navigate(`/investments/${notification.agreement_id}`);
      setIsOpen(false);
    } else if (notification.pitch_id) {
      navigate(`/pitch/${notification.pitch_id}`);
      setIsOpen(false);
    }
  };

  // ==============================================
  // MARK ALL AS READ
  // ==============================================

  const handleMarkAllRead = async () => {
    if (!userId) return;

    const result = await markAllNotificationsAsRead(userId);
    if (result.success) {
      setUnreadCount(0);
      setNotifications(prev =>
        prev.map(n => ({
          ...n,
          is_read: true,
          read_at: new Date().toISOString()
        }))
      );
    }
  };

  // ==============================================
  // CLOSE DROPDOWN ON OUTSIDE CLICK
  // ==============================================

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // ==============================================
  // INITIAL LOAD
  // ==============================================

  useEffect(() => {
    if (userId) {
      loadNotifications();
    }
  }, [userId]);

  // ==============================================
  // REAL-TIME SUBSCRIPTION
  // ==============================================

  useEffect(() => {
    if (!userId) return;

    const unsubscribe = subscribeToUserNotifications(userId, (newNotification) => {
      // Add new notification to top of list
      setNotifications(prev => [newNotification, ...prev]);
      setUnreadCount(prev => prev + 1);

      // Show browser notification (if permitted)
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(newNotification.title, {
          body: newNotification.message,
          icon: '/ican-logo.png',
          badge: '/ican-logo.png',
          tag: `notification-${newNotification.id}`,
          requireInteraction: newNotification.priority === 'urgent'
        });
      }

      // Play notification sound (optional)
      const audio = new Audio('/notification-sound.mp3');
      audio.play().catch(() => console.log('Could not play notification sound'));
    });

    return () => {
      unsubscribe();
    };
  }, [userId]);

  // ==============================================
  // REQUEST BROWSER NOTIFICATION PERMISSION
  // ==============================================

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // ==============================================
  // RENDER
  // ==============================================

  if (!userId) return null;

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      {/* Bell Icon with Badge */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-sm border border-white/20 transition-all duration-200"
        aria-label="Notifications"
      >
        <Bell className="w-5 h-5 text-white" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[20px] h-5 flex items-center justify-center px-1.5 bg-gradient-to-r from-red-500 to-pink-500 text-white text-[10px] font-bold rounded-full border-2 border-gray-900 animate-pulse">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 md:w-96 max-h-[500px] bg-gray-900 border border-white/20 rounded-2xl shadow-2xl overflow-hidden z-50 animate-slideDown">
          {/* Header */}
          <div className="sticky top-0 bg-gradient-to-r from-purple-600 to-pink-600 px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-white" />
              <h3 className="text-white font-semibold text-sm">
                Notifications
              </h3>
              {unreadCount > 0 && (
                <span className="px-2 py-0.5 bg-white/20 text-white text-xs rounded-full">
                  {unreadCount}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  className="text-white/80 hover:text-white text-xs flex items-center gap-1 transition-colors"
                  title="Mark all as read"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  <span>Read all</span>
                </button>
              )}
              <button
                onClick={() => setIsOpen(false)}
                className="text-white/80 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Notifications List */}
          <div className="overflow-y-auto max-h-[420px] custom-scrollbar">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-8 h-8 border-3 border-purple-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mb-3">
                  <Bell className="w-8 h-8 text-white/30" />
                </div>
                <p className="text-white/50 text-sm">No notifications yet</p>
                <p className="text-white/30 text-xs mt-1">
                  You'll see investment updates here
                </p>
              </div>
            ) : (
              <div className="divide-y divide-white/10">
                {notifications.map((notification) => (
                  <div
                    key={notification.id}
                    onClick={() => handleNotificationClick(notification)}
                    className={`
                      px-4 py-3 cursor-pointer transition-all duration-200
                      hover:bg-white/5
                      ${!notification.is_read ? 'bg-purple-500/10' : 'bg-transparent'}
                    `}
                  >
                    <div className="flex items-start gap-3">
                      {/* Icon */}
                      <div
                        className={`
                          flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center
                          ${getNotificationColor(notification.priority)}
                          border
                        `}
                      >
                        <span className="text-lg">
                          {getNotificationIcon(notification.notification_type)}
                        </span>
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <h4 className={`
                            text-sm font-medium line-clamp-1
                            ${!notification.is_read ? 'text-white' : 'text-white/70'}
                          `}>
                            {notification.title}
                          </h4>
                          {!notification.is_read && (
                            <div className="flex-shrink-0 w-2 h-2 bg-blue-500 rounded-full" />
                          )}
                        </div>

                        <p className="text-white/50 text-xs mt-1 line-clamp-2">
                          {notification.message}
                        </p>

                        <div className="flex items-center justify-between mt-2">
                          <span className="text-white/30 text-[10px]">
                            {formatTimeAgo(notification.created_at)}
                          </span>

                          {notification.action_label && (
                            <span className="text-purple-400 text-[10px] font-medium">
                              {notification.action_label} →
                            </span>
                          )}
                        </div>

                        {/* Priority Badge */}
                        {notification.priority === 'urgent' && (
                          <div className="mt-2 inline-flex items-center gap-1 px-2 py-0.5 bg-red-500/20 border border-red-500/30 rounded-full">
                            <span className="text-red-400 text-[10px] font-semibold">
                              URGENT
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          {notifications.length > 0 && (
            <div className="sticky bottom-0 bg-gray-900 border-t border-white/10 px-4 py-2">
              <button
                onClick={() => {
                  navigate('/notifications');
                  setIsOpen(false);
                }}
                className="w-full text-center text-purple-400 hover:text-purple-300 text-xs font-medium transition-colors"
              >
                View All Notifications
              </button>
            </div>
          )}
        </div>
      )}

      {/* Custom Scrollbar Styles */}
      <style>{`
        @keyframes slideDown {
          from {
            opacity: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .animate-slideDown {
          animation: slideDown 0.2s ease-out;
        }

        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }

        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.05);
        }

        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.2);
          border-radius: 3px;
        }

        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.3);
        }
      `}</style>
    </div>
  );
};

export default NotificationBell;

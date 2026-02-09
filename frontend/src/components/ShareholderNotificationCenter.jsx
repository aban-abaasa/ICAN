import React, { useState, useEffect } from 'react';
import { 
  Bell, 
  CheckCircle2, 
  DollarSign, 
  Users, 
  TrendingUp, 
  X, 
  Loader,
  AlertCircle
} from 'lucide-react';
import { shareholderNotificationService } from '../services/shareholderNotificationService';

const ShareholderNotificationCenter = ({ shareholderId }) => {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const [filterType, setFilterType] = useState('all');
  const [stats, setStats] = useState(null);

  // Load notifications on mount
  useEffect(() => {
    loadNotifications();
    
    // Set up real-time subscription
    const unsubscribe = shareholderNotificationService.subscribeToNotifications(
      shareholderId,
      (newNotification) => {
        console.log('New notification received:', newNotification);
        setNotifications(prev => [newNotification, ...prev]);
        setUnreadCount(prev => prev + 1);
      }
    );

    return () => unsubscribe?.();
  }, [shareholderId]);

  const loadNotifications = async () => {
    setLoading(true);
    try {
      // Fetch notifications
      const data = await shareholderNotificationService.getShareholderNotifications(shareholderId);
      setNotifications(data);

      // Get unread count
      const count = await shareholderNotificationService.getUnreadCount(shareholderId);
      setUnreadCount(count);
    } catch (error) {
      console.error('Error loading notifications:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleMarkAsRead = async (notificationId) => {
    const result = await shareholderNotificationService.markAsRead(notificationId);
    if (result.success) {
      setNotifications(prev =>
        prev.map(n =>
          n.notification_id === notificationId ? { ...n, is_read: true } : n
        )
      );
      setUnreadCount(prev => Math.max(0, prev - 1));
    }
  };

  const handleDeleteNotification = async (notificationId) => {
    const result = await shareholderNotificationService.deleteNotification(notificationId);
    if (result.success) {
      setNotifications(prev => prev.filter(n => n.notification_id !== notificationId));
    }
  };

  const getNotificationIcon = (type) => {
    switch (type) {
      case 'share_purchase':
        return <TrendingUp className="w-5 h-5 text-blue-400" />;
      case 'partner_investment':
        return <Users className="w-5 h-5 text-purple-400" />;
      case 'support_contribution':
        return <DollarSign className="w-5 h-5 text-green-400" />;
      case 'investment_signed':
        return <CheckCircle2 className="w-5 h-5 text-emerald-400" />;
      default:
        return <Bell className="w-5 h-5 text-slate-400" />;
    }
  };

  const getNotificationColor = (type) => {
    switch (type) {
      case 'share_purchase':
        return 'border-l-4 border-blue-500 bg-blue-900/10';
      case 'partner_investment':
        return 'border-l-4 border-purple-500 bg-purple-900/10';
      case 'support_contribution':
        return 'border-l-4 border-green-500 bg-green-900/10';
      case 'investment_signed':
        return 'border-l-4 border-emerald-500 bg-emerald-900/10';
      default:
        return 'border-l-4 border-slate-500 bg-slate-900/10';
    }
  };

  const filteredNotifications = notifications.filter(n => {
    if (filterType === 'all') return true;
    return n.notification_type === filterType;
  });

  const unreadNotifications = filteredNotifications.filter(n => !n.is_read);

  return (
    <div className="w-full max-w-4xl mx-auto">
      {/* Header Section */}
      <div className="bg-gradient-to-r from-blue-900/30 to-cyan-900/30 border border-blue-500/30 rounded-lg p-6 mb-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="bg-blue-500/20 rounded-full p-3">
              <Bell className="w-8 h-8 text-blue-400" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white">Notifications</h2>
              <p className="text-slate-300 text-sm">
                Stay updated on share purchases, partnerships, and investments
              </p>
            </div>
          </div>
          {unreadCount > 0 && (
            <div className="bg-red-500/20 border border-red-500/50 rounded-full px-3 py-1">
              <p className="text-red-300 font-semibold text-sm">{unreadCount} Unread</p>
            </div>
          )}
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
        {[
          { key: 'all', label: 'All Notifications' },
          { key: 'share_purchase', label: '📈 Share Purchases' },
          { key: 'partner_investment', label: '👥 Partners' },
          { key: 'support_contribution', label: '💰 Support' },
          { key: 'investment_signed', label: '✅ Signed Agreements' }
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setFilterType(tab.key)}
            className={`px-4 py-2 rounded-lg font-semibold whitespace-nowrap transition ${
              filterType === tab.key
                ? 'bg-gradient-to-r from-blue-600 to-cyan-600 text-white'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Loading State */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader className="w-8 h-8 animate-spin text-blue-400" />
          <p className="ml-3 text-slate-300">Loading notifications...</p>
        </div>
      )}

      {/* Empty State */}
      {!loading && filteredNotifications.length === 0 && (
        <div className="bg-slate-700/50 border border-slate-600 rounded-lg p-8 text-center">
          <Bell className="w-12 h-12 text-slate-400 mx-auto mb-3 opacity-50" />
          <p className="text-slate-400 font-semibold mb-1">No notifications</p>
          <p className="text-slate-500 text-sm">
            {filterType === 'all'
              ? 'You\'ll see notifications when investors buy shares, partnerships are formed, or support is received'
              : 'No notifications of this type yet'}
          </p>
        </div>
      )}

      {/* Notifications List */}
      {!loading && filteredNotifications.length > 0 && (
        <div className="space-y-3">
          {filteredNotifications.map(notification => (
            <div
              key={notification.notification_id}
              className={`p-4 rounded-lg transition ${getNotificationColor(
                notification.notification_type
              )} ${!notification.is_read ? 'ring-2 ring-blue-500/50' : ''}`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3 flex-1">
                  <div className="mt-1">{getNotificationIcon(notification.notification_type)}</div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-semibold text-white text-sm md:text-base break-words">
                        {notification.notification_title}
                      </h3>
                      {!notification.is_read && (
                        <span className="flex-shrink-0 inline-block w-2 h-2 bg-blue-500 rounded-full mt-1 ml-2" />
                      )}
                    </div>

                    <p className="text-slate-300 text-sm mt-1 break-words">
                      {notification.notification_message}
                    </p>

                    {notification.investment_amount && (
                      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <p className="text-slate-400">Amount</p>
                          <p className="text-cyan-400 font-semibold">
                            {notification.investment_amount || 0} {notification.investment_currency || 'UGX'}
                          </p>
                        </div>
                        {notification.investor_name && (
                          <div>
                            <p className="text-slate-400">By</p>
                            <p className="text-cyan-400 font-semibold truncate">{notification.investor_name}</p>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-600/50">
                      <p className="text-slate-400 text-xs">
                        {new Date(notification.created_at).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </p>

                      <div className="flex gap-2">
                        {!notification.is_read && (
                          <button
                            onClick={() => handleMarkAsRead(notification.notification_id)}
                            className="px-2 py-1 text-xs bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 rounded transition"
                          >
                            Mark Read
                          </button>
                        )}
                        <button
                          onClick={() => handleDeleteNotification(notification.notification_id)}
                          className="px-2 py-1 text-xs bg-red-600/20 hover:bg-red-600/30 text-red-300 rounded transition"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Mark All as Read */}
      {!loading && unreadNotifications.length > 0 && (
        <div className="mt-6 flex justify-center">
          <button
            onClick={async () => {
              for (const notif of unreadNotifications) {
                await handleMarkAsRead(notif.notification_id);
              }
            }}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition text-sm"
          >
            Mark All as Read
          </button>
        </div>
      )}
    </div>
  );
};

export default ShareholderNotificationCenter;

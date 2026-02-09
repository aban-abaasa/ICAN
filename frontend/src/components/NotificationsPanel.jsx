import React, { useState, useEffect } from 'react';
import { Bell, X } from 'lucide-react';

/**
 * NotificationsPanel Component
 * Displays a notification bell icon with dropdown menu
 * Used in CMSSModule for company/business notifications
 */
const NotificationsPanel = ({ 
  userId, 
  companyId, 
  onActionClick = () => {} 
}) => {
  const [showDropdown, setShowDropdown] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    // Initialize notifications - can be expanded to fetch from database
    loadNotifications();
  }, [userId, companyId]);

  const loadNotifications = async () => {
    try {
      // Placeholder for loading notifications
      // This can be connected to a service call later
      setNotifications([]);
      setUnreadCount(0);
    } catch (error) {
      console.error('Error loading notifications:', error);
    }
  };

  const handleActionClick = (tab) => {
    onActionClick(tab);
    setShowDropdown(false);
  };

  return (
    <div className="relative">
      {/* Bell Icon */}
      <button
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
        <div className="absolute right-0 mt-2 w-80 bg-slate-800 rounded-lg shadow-2xl border border-slate-700 z-40">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-slate-700">
            <h3 className="font-semibold text-white">Notifications</h3>
            <button
              onClick={() => setShowDropdown(false)}
              className="text-slate-400 hover:text-white p-1 rounded transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Content */}
          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="p-6 text-center">
                <p className="text-slate-400 text-sm">No notifications</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-700">
                {notifications.map((notification) => (
                  <div
                    key={notification.id}
                    className="p-4 hover:bg-slate-700/50 transition cursor-pointer"
                    onClick={() => handleActionClick(notification.action)}
                  >
                    <p className="text-sm font-semibold text-white">
                      {notification.title}
                    </p>
                    <p className="text-xs text-slate-400 mt-1">
                      {notification.message}
                    </p>
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

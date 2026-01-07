/**
 * StatusRing Component
 * Shows a colorful ring around avatar if user has active statuses
 * Click to view status feed (WhatsApp style)
 */

import React, { useState, useEffect } from 'react';
import { getUserStatuses } from '../../services/statusService';

export const StatusRing = ({ userId, userAvatar, userName, onClick, size = 'lg' }) => {
  const [hasStatus, setHasStatus] = useState(false);
  const [statusCount, setStatusCount] = useState(0);

  useEffect(() => {
    if (!userId) return;

    const checkStatuses = async () => {
      try {
        const { statuses } = await getUserStatuses(userId);
        const activeCount = statuses?.length || 0;
        setStatusCount(activeCount);
        setHasStatus(activeCount > 0);
      } catch (error) {
        console.error('Error checking statuses:', error);
      }
    };

    checkStatuses();

    // Check every 30 seconds
    const interval = setInterval(checkStatuses, 30000);
    return () => clearInterval(interval);
  }, [userId]);

  const sizeClasses = {
    sm: 'w-8 h-8',
    md: 'w-12 h-12',
    lg: 'w-16 h-16',
    xl: 'w-20 h-20'
  };

  const ringClasses = {
    sm: 'ring-2',
    md: 'ring-2',
    lg: 'ring-4',
    xl: 'ring-4'
  };

  return (
    <div
      className="relative cursor-pointer group"
      onClick={onClick}
      title={hasStatus ? `${statusCount} active ${statusCount === 1 ? 'story' : 'stories'}` : 'No active stories'}
    >
      {/* Avatar */}
      <div
        className={`
          ${sizeClasses[size]}
          rounded-full
          ${hasStatus ? ringClasses[size] + ' ring-gradient-purple' : 'ring-2 ring-gray-600'}
          transition-all duration-300
          ${hasStatus ? 'group-hover:ring-pink-500' : ''}
          overflow-hidden
          flex items-center justify-center
          bg-gradient-to-br from-purple-400 to-pink-400
          text-white font-bold
          flex-shrink-0
        `}
      >
        {userAvatar ? (
          <img src={userAvatar} alt={userName} className="w-full h-full object-cover" />
        ) : (
          <span>{userName?.slice(0, 1).toUpperCase()}</span>
        )}
      </div>

      {/* Status indicator dot */}
      {hasStatus && (
        <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full border-2 border-white flex items-center justify-center text-xs text-white font-bold animate-pulse">
          {statusCount > 9 ? '9+' : statusCount}
        </div>
      )}

      {/* Glow effect when has status */}
      {hasStatus && (
        <div className="absolute inset-0 rounded-full bg-gradient-to-br from-purple-500/20 to-pink-500/20 blur-lg group-hover:blur opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
      )}
    </div>
  );
};

export default StatusRing;

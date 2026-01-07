/**
 * MyStatusSummary Component
 * Shows a quick summary/preview of user's active statuses
 * Can be embedded in a sidebar or dashboard
 */

import React, { useState, useEffect } from 'react';
import { getUserStatuses } from '../../services/statusService';
import { Eye, MoreVertical, Trash2 } from 'lucide-react';
import { deleteStatus } from '../../services/statusService';

export const MyStatusSummary = ({ userId, onStatusClick }) => {
  const [statuses, setStatuses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showMenu, setShowMenu] = useState(null);

  useEffect(() => {
    loadStatuses();
    const interval = setInterval(loadStatuses, 30000);
    return () => clearInterval(interval);
  }, [userId]);

  const loadStatuses = async () => {
    try {
      const { statuses: data } = await getUserStatuses(userId);
      setStatuses(data || []);
    } catch (error) {
      console.error('Error loading statuses:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (statusId) => {
    if (!confirm('Delete this status?')) return;
    try {
      await deleteStatus(statusId);
      setStatuses(statuses.filter(s => s.id !== statusId));
      setShowMenu(null);
    } catch (error) {
      console.error('Error deleting status:', error);
    }
  };

  const getTimeLeft = (expiresAt) => {
    const now = new Date();
    const expires = new Date(expiresAt);
    const diffMs = expires - now;
    const diffHours = Math.ceil(diffMs / (1000 * 60 * 60));

    if (diffHours <= 0) return 'Expired';
    if (diffHours === 1) return '1h left';
    return `${diffHours}h left`;
  };

  if (loading) {
    return (
      <div className="bg-slate-800 rounded-lg p-4">
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-slate-700 rounded w-1/2"></div>
          <div className="grid grid-cols-3 gap-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="aspect-[9/16] bg-slate-700 rounded-lg"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (statuses.length === 0) {
    return (
      <div className="bg-gradient-to-br from-purple-900/30 to-pink-900/30 border border-purple-500/30 rounded-lg p-6 text-center">
        <p className="text-gray-300 text-sm font-medium mb-3">No active statuses</p>
        <p className="text-gray-400 text-xs">Share your first status to see it here!</p>
      </div>
    );
  }

  return (
    <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700 rounded-lg p-4">
      <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
        <div className="w-1 h-4 bg-gradient-to-b from-purple-500 to-pink-500 rounded"></div>
        My Statuses ({statuses.length})
      </h3>

      <div className="grid grid-cols-2 gap-2">
        {statuses.map(status => (
          <div
            key={status.id}
            className="relative group rounded-lg overflow-hidden cursor-pointer"
            onClick={() => onStatusClick?.(status)}
          >
            {/* Thumbnail */}
            <div className="relative aspect-[9/16] bg-black rounded-lg overflow-hidden">
              {status.media_type === 'image' ? (
                <img
                  src={status.media_url}
                  alt="Status"
                  className="w-full h-full object-cover group-hover:brightness-75 transition-all"
                />
              ) : status.media_type === 'video' ? (
                <video
                  src={status.media_url}
                  className="w-full h-full object-cover group-hover:brightness-75 transition-all"
                />
              ) : (
                <div
                  style={{ backgroundColor: status.background_color }}
                  className="w-full h-full flex items-center justify-center p-2"
                >
                  <p className="text-white text-xs text-center line-clamp-3 font-medium">
                    {status.caption}
                  </p>
                </div>
              )}

              {/* Overlay */}
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex items-center justify-center">
                <Eye className="w-4 h-4 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>

              {/* Stats */}
              <div className="absolute bottom-1 left-1 right-1 flex items-center justify-between text-xs">
                <span className="bg-black/60 text-white/80 px-1.5 py-0.5 rounded">
                  {status.view_count} views
                </span>
                <span className="bg-black/60 text-white/80 px-1.5 py-0.5 rounded text-xs">
                  {getTimeLeft(status.expires_at)}
                </span>
              </div>

              {/* Menu button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowMenu(showMenu === status.id ? null : status.id);
                }}
                className="absolute top-1 right-1 p-1 rounded bg-black/40 text-white/80 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <MoreVertical className="w-3 h-3" />
              </button>

              {/* Menu */}
              {showMenu === status.id && (
                <div className="absolute top-8 right-0 bg-slate-900 border border-slate-700 rounded shadow-lg z-10">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(status.id);
                    }}
                    className="w-full px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 flex items-center gap-2 transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                    Delete
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default MyStatusSummary;

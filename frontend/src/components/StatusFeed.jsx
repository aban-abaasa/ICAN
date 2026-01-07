/**
 * StatusFeed Component
 * WhatsApp-style status feed showing user's own statuses and others
 */

import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { getActiveStatuses, getUserStatuses, deleteStatus } from '../services/statusService';
import { Eye, Trash2, Share2, MoreVertical } from 'lucide-react';
import { FullscreenStatusViewer } from './status/FullscreenStatusViewer';

export const StatusFeed = () => {
  const { user, profile } = useAuth();
  const [myStatuses, setMyStatuses] = useState([]);
  const [otherStatuses, setOtherStatuses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedStatus, setSelectedStatus] = useState(null);
  const [showMenu, setShowMenu] = useState(null);

  useEffect(() => {
    loadStatuses();
    // Refresh every 30 seconds
    const interval = setInterval(loadStatuses, 30000);
    return () => clearInterval(interval);
  }, [user?.id]);

  const loadStatuses = async () => {
    try {
      setLoading(true);
      
      // Get user's own statuses
      const { statuses: myStats } = await getUserStatuses(user.id);
      setMyStatuses(myStats || []);

      // Get all active statuses (including others)
      const { statuses: allStats } = await getActiveStatuses();
      const othersStats = allStats?.filter(s => s.user_id !== user.id) || [];
      setOtherStatuses(othersStats);
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
      setMyStatuses(myStatuses.filter(s => s.id !== statusId));
      setShowMenu(null);
    } catch (error) {
      console.error('Error deleting status:', error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-purple-500"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-gradient-to-r from-purple-600 to-blue-600 backdrop-blur-sm border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <h1 className="text-3xl font-bold text-white">Status</h1>
          <p className="text-purple-100 text-sm mt-1">Your stories expire in 24 hours</p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* My Statuses Section */}
        {myStatuses.length > 0 && (
          <div className="mb-12">
            <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
              <div className="w-1 h-6 bg-gradient-to-b from-purple-500 to-pink-500 rounded"></div>
              My Statuses
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {myStatuses.map(status => (
                <div
                  key={status.id}
                  className="group relative rounded-2xl overflow-hidden cursor-pointer transform transition-all duration-300 hover:scale-105"
                >
                  {/* Thumbnail */}
                  <div
                    onClick={() => setSelectedStatus(status)}
                    className="relative w-full aspect-[9/16] bg-black rounded-2xl overflow-hidden"
                  >
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
                        className="w-full h-full flex items-center justify-center p-4"
                      >
                        <p className="text-white text-center text-lg font-medium">
                          {status.caption}
                        </p>
                      </div>
                    )}

                    {/* Overlay with actions */}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex items-center justify-center gap-4 opacity-0 group-hover:opacity-100">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedStatus(status);
                        }}
                        className="bg-white/20 hover:bg-white/30 text-white rounded-full p-3 backdrop-blur-sm transition-all"
                        title="View"
                      >
                        <Eye className="w-5 h-5" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowMenu(showMenu === status.id ? null : status.id);
                        }}
                        className="bg-white/20 hover:bg-white/30 text-white rounded-full p-3 backdrop-blur-sm transition-all"
                        title="More"
                      >
                        <MoreVertical className="w-5 h-5" />
                      </button>
                    </div>

                    {/* Status Duration Badge */}
                    <div className="absolute top-3 right-3 bg-black/60 backdrop-blur-sm px-3 py-1 rounded-full text-xs text-white font-medium">
                      {Math.ceil((new Date(status.expires_at) - new Date()) / (1000 * 60 * 60))}h left
                    </div>
                  </div>

                  {/* Menu */}
                  {showMenu === status.id && (
                    <div className="absolute bottom-0 left-0 right-0 bg-slate-900 border-t border-slate-700 rounded-t-2xl p-3 space-y-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigator.share?.({
                            title: 'Check my status',
                            text: status.caption,
                            url: window.location.href
                          }).catch(() => {});
                          setShowMenu(null);
                        }}
                        className="w-full flex items-center gap-2 text-white hover:bg-white/10 px-3 py-2 rounded-lg transition-colors"
                      >
                        <Share2 className="w-4 h-4" />
                        Share
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(status.id);
                        }}
                        className="w-full flex items-center gap-2 text-red-400 hover:bg-red-500/10 px-3 py-2 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                        Delete
                      </button>
                    </div>
                  )}

                  {/* Stats */}
                  <div className="absolute bottom-3 left-3 text-xs text-white/80 bg-black/40 backdrop-blur-sm px-2 py-1 rounded">
                    {status.view_count} {status.view_count === 1 ? 'view' : 'views'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Others Statuses Section */}
        {otherStatuses.length > 0 && (
          <div>
            <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
              <div className="w-1 h-6 bg-gradient-to-b from-blue-500 to-cyan-500 rounded"></div>
              Latest Stories
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {otherStatuses.map(status => (
                <div
                  key={status.id}
                  onClick={() => setSelectedStatus(status)}
                  className="group relative rounded-2xl overflow-hidden cursor-pointer transform transition-all duration-300 hover:scale-105"
                >
                  {/* Thumbnail */}
                  <div className="relative w-full aspect-[9/16] bg-black rounded-2xl overflow-hidden">
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
                        className="w-full h-full flex items-center justify-center p-4"
                      >
                        <p className="text-white text-center text-lg font-medium">
                          {status.caption}
                        </p>
                      </div>
                    )}

                    {/* User badge */}
                    <div className="absolute top-3 left-3 bg-black/60 backdrop-blur-sm px-3 py-1 rounded-full flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-gradient-to-br from-purple-400 to-pink-400 flex items-center justify-center text-xs font-bold text-white">
                        {status.user_id.slice(0, 1).toUpperCase()}
                      </div>
                      <span className="text-xs text-white font-medium">@User</span>
                    </div>
                  </div>

                  {/* Hover overlay */}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all"></div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty State */}
        {myStatuses.length === 0 && otherStatuses.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="text-center">
              <div className="w-20 h-20 bg-gradient-to-br from-purple-500/20 to-pink-500/20 rounded-full mx-auto mb-4 flex items-center justify-center">
                <Eye className="w-10 h-10 text-purple-400" />
              </div>
              <h3 className="text-2xl font-bold text-white mb-2">No Statuses Yet</h3>
              <p className="text-gray-400">Be the first to share a status! Tap your avatar to get started.</p>
            </div>
          </div>
        )}
      </div>

      {/* Status Viewer Modal */}
      {selectedStatus && (
        <FullscreenStatusViewer
          statuses={selectedStatus.user_id === user.id ? myStatuses : otherStatuses}
          initialIndex={
            selectedStatus.user_id === user.id
              ? myStatuses.findIndex(s => s.id === selectedStatus.id)
              : otherStatuses.findIndex(s => s.id === selectedStatus.id)
          }
          onClose={() => setSelectedStatus(null)}
        />
      )}
    </div>
  );
};

export default StatusFeed;

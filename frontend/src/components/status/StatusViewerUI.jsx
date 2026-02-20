/**
 * StatusViewerUI Component  
 * Displays profile picture, edit button, add status, and status carousel
 * Positioned in header top-right like WhatsApp
 */

import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Plus, Edit2, Upload, ChevronLeft, ChevronRight, Eye } from 'lucide-react';
import { getActiveStatuses, recordStatusView } from '../../services/statusService';
import FullscreenStatusViewer from './FullscreenStatusViewer';

export const StatusViewerUI = ({ onOpenStatusUploader = null, onOpenProfileEdit = null, refreshTrigger = 0 }) => {
  const { profile, getAvatarUrl, getDisplayName, uploadAvatar: uploadAvatarAuth, loadProfile, user } = useAuth();
  const [imageError, setImageError] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [refreshTriggerLocal, setRefreshTriggerLocal] = useState(0);
  const [statuses, setStatuses] = useState([]);
  const [currentStatusIndex, setCurrentStatusIndex] = useState(0);
  const [showStatusViewer, setShowStatusViewer] = useState(false);
  const fileInputRef = React.useRef(null);

  const avatarUrl = getAvatarUrl();

  // Load statuses on mount and when refreshTrigger changes
  useEffect(() => {
    loadStatuses();
    const interval = setInterval(loadStatuses, 30000);
    return () => clearInterval(interval);
  }, [user?.id, refreshTrigger]);

  const loadStatuses = async () => {
    try {
      const { statuses: activeStatuses = [], error } = await getActiveStatuses();
      if (error) {
        console.warn('StatusViewerUI - getActiveStatuses warning:', error.message || error);
      }
      console.log('Loaded statuses:', activeStatuses.length);
      setStatuses(activeStatuses);
      setCurrentStatusIndex((prev) => (activeStatuses.length === 0 ? 0 : Math.min(prev, activeStatuses.length - 1)));
    } catch (error) {
      console.error('Failed to load statuses:', error);
      setStatuses([]);
    }
  };

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleAvatarUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingAvatar(true);
    try {
      await uploadAvatarAuth(file);
      setImageError(false);
      // Reload profile to refresh avatar URL
      if (user?.id) {
        await loadProfile(user.id);
      }
    } catch (error) {
      console.error('Avatar upload failed:', error);
    } finally {
      setIsUploadingAvatar(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleViewStatus = async (status) => {
    if (status?.id && user?.id) {
      try {
        await recordStatusView(status.id, user.id);
      } catch (error) {
        console.error('Failed to record view:', error);
      }
    }
    setShowStatusViewer(true);
  };

  const handlePrevStatus = () => {
    setCurrentStatusIndex(prev => (prev === 0 ? statuses.length - 1 : prev - 1));
  };

  const handleNextStatus = () => {
    setCurrentStatusIndex(prev => (prev === statuses.length - 1 ? 0 : prev + 1));
  };

  const currentStatus = statuses.length > 0 ? statuses[currentStatusIndex] : null;

  return (
    <div className="flex items-center gap-3 px-4 py-2">
      {/* Status Carousel - Show if statuses exist */}
      {statuses.length > 0 && (
        <div 
          className="flex items-center gap-2 px-3 py-1.5 bg-white bg-opacity-10 border border-white border-opacity-20 rounded-lg hover:bg-opacity-20 transition-all cursor-pointer group animate-fadeIn"
          onClick={() => handleViewStatus(currentStatus)}
        >
          {/* View Icon */}
          <Eye className="w-4 h-4 text-purple-400 group-hover:text-purple-300 transition-colors flex-shrink-0" />

          {/* Status Thumbnail with WhatsApp-style ring */}
          <div className="relative w-9 h-9 rounded-full overflow-hidden flex-shrink-0">
            {currentStatus?.thumbnail_url ? (
              <img
                src={currentStatus.thumbnail_url}
                alt="Status"
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white text-xs font-bold">
                {currentStatus?.created_by?.charAt(0) || 'S'}
              </div>
            )}
            {/* WhatsApp-style gradient ring for unviewed status */}
            <div className="absolute inset-0 ring-1.5 ring-gradient from-purple-400 to-pink-400 rounded-full group-hover:ring-2 transition-all"></div>
          </div>

          {/* Status Info */}
          <div className="hidden sm:flex flex-col gap-0.5 min-w-0">
            <span className="text-xs font-medium text-white truncate">
              {currentStatus?.created_by || 'Status'}
            </span>
            <span className="text-xs text-gray-400">
              {currentStatus?.view_count || 0} views
            </span>
          </div>

          {/* Navigation - Show if multiple statuses */}
          {statuses.length > 1 && (
            <div className="flex items-center gap-1 ml-1 pl-1 border-l border-white border-opacity-20">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handlePrevStatus();
                }}
                className="p-0.5 hover:bg-white hover:bg-opacity-10 rounded transition-colors"
                title="Previous status"
              >
                <ChevronLeft className="w-3 h-3 text-gray-300 hover:text-white" />
              </button>
              <span className="text-xs text-gray-400 px-1">
                {currentStatusIndex + 1}/{statuses.length}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleNextStatus();
                }}
                className="p-0.5 hover:bg-white hover:bg-opacity-10 rounded transition-colors"
                title="Next status"
              >
                <ChevronRight className="w-3 h-3 text-gray-300 hover:text-white" />
              </button>
            </div>
          )}

          {/* View Status Label */}
          <span className="hidden lg:block text-xs font-semibold text-purple-300 ml-1 px-2 py-0.5 bg-purple-900 bg-opacity-30 rounded">
            TAP TO VIEW
          </span>
        </div>
      )}

      {/* Profile Picture with Edit & Status Buttons */}
      <div className="relative group">
        {/* Avatar */}
        <div
          onClick={handleAvatarClick}
          className="relative w-12 h-12 rounded-full overflow-hidden ring-2 ring-white ring-opacity-30 cursor-pointer hover:ring-opacity-50 transition-all flex-shrink-0"
        >
          {avatarUrl && !imageError ? (
            <img
              src={avatarUrl}
              alt={getDisplayName()}
              className="w-full h-full object-cover"
              onError={() => setImageError(true)}
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-blue-400 to-purple-600 flex items-center justify-center text-white font-bold">
              {profile?.first_name?.charAt(0) || 'U'}
            </div>
          )}

          {/* Edit Avatar Icon (on hover) */}
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-full">
            <Upload className="w-5 h-5 text-white" />
          </div>
        </div>

        {/* Add Status Button - Bottom Right of Avatar */}
        <button
          onClick={onOpenStatusUploader}
          className="absolute -bottom-1 -right-1 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 rounded-full p-1.5 shadow-lg transition-all"
          title="Add status"
        >
          <Plus className="w-3 h-3 text-white" />
        </button>

        {/* Edit Profile Button - Top Right of Avatar */}
        <button
          onClick={onOpenProfileEdit}
          className="absolute -top-1 -right-1 bg-blue-500 hover:bg-blue-600 rounded-full p-1.5 shadow-lg transition-all hidden group-hover:flex"
          title="Edit profile"
        >
          <Edit2 className="w-3 h-3 text-white" />
        </button>
      </div>

      {/* Profile Info */}
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-sm font-medium text-white truncate">
          {getDisplayName()}
        </span>
        <span className="text-xs text-gray-400">
          Account
        </span>
      </div>

      {/* Hidden file input for avatar upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleAvatarUpload}
        disabled={isUploadingAvatar}
        className="hidden"
      />

      {/* Fullscreen Status Viewer Modal */}
      {showStatusViewer && statuses.length > 0 && (
        <FullscreenStatusViewer
          statuses={statuses}
          initialIndex={currentStatusIndex}
          onClose={() => setShowStatusViewer(false)}
        />
      )}

      <style>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: scale(0.95);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }

        .animate-fadeIn {
          animation: fadeIn 0.3s ease-in-out;
        }

        /* WhatsApp-style gradient ring */
        .ring-gradient {
          background: linear-gradient(135deg, #a78bfa, #ec4899);
        }
      `}</style>
    </div>
  );
};

export default StatusViewerUI;

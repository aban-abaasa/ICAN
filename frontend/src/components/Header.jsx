/**
 * Header Component
 * Top navigation bar with user profile icon for status and avatar uploads
 * Integrates StatusViewerUI and ProfilePage functionality
 * Mobile-optimized profile menu with user information
 */

import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Plus, Settings, LogOut, ChevronDown, Lock, Eye, Wallet, Menu, X, Mail, Phone, TrendingUp, Shield, Upload, Edit2, ChevronLeft, ChevronRight } from 'lucide-react';
import { StatusUploader } from './status/StatusUploader';
import { getActiveStatuses, recordStatusView } from '../services/statusService';
import FullscreenStatusViewer from './status/FullscreenStatusViewer';

export const Header = ({ onOpenProfileEdit = null, statusRefreshTrigger = 0 }) => {
  const { user, profile, getDisplayName, getAvatarUrl, signOut, uploadAvatar, loadProfile } = useAuth();
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [showStatusUploader, setShowStatusUploader] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [statuses, setStatuses] = useState([]);
  const [currentStatusIndex, setCurrentStatusIndex] = useState(0);
  const [showStatusViewer, setShowStatusViewer] = useState(false);
  
  const fileInputRef = useRef(null);
  const dropdownRef = useRef(null);
  const mobileMenuRef = useRef(null);

  const avatarUrl = getAvatarUrl();

  // Load statuses on mount and when refreshTrigger changes
  useEffect(() => {
    if (!user?.id) {
      setStatuses([]);
      return;
    }
    
    loadStatuses();
    const interval = setInterval(loadStatuses, 60000); // Increased to 60 seconds to reduce API calls
    return () => clearInterval(interval);
  }, [user?.id, statusRefreshTrigger]);

  const loadStatuses = async () => {
    if (!user?.id) return; // Don't query if no user
    try {
      const activeStatuses = await getActiveStatuses(user.id); // Pass userId to avoid querying all users
      setStatuses(activeStatuses || []);
    } catch (error) {
      console.error('Failed to load statuses:', error);
      // Don't crash on status load failure
    }
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && dropdownRef.current.contains(e.target)) {
        return;
      }
      if (mobileMenuRef.current && mobileMenuRef.current.contains(e.target)) {
        return;
      }
      setShowMobileMenu(false);
    };
    
    if (showMobileMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showMobileMenu]);

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleAvatarUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingAvatar(true);
    try {
      await uploadAvatar(file);
      setImageError(false);
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

  // Get user initials for profile icon
  const getInitials = () => {
    const name = getDisplayName() || 'User';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  const displayName = getDisplayName() || 'User Account';

  return (
    <>
      {/* Main Header Bar */}
      <div className="w-full bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 border-b border-blue-500/30 px-4 py-3 sticky top-0 z-40 flex items-center justify-between">
        {/* Logo/Brand - Left side */}
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <span className="hidden sm:block text-white font-bold text-lg">ICAN</span>
        </div>

        {/* Profile Icon - Right side (visible on all screen sizes) */}
        <div className="relative">
          <button
            ref={dropdownRef}
            onClick={() => setShowMobileMenu(!showMobileMenu)}
            className="relative w-10 h-10 rounded-full overflow-hidden ring-2 ring-white ring-opacity-30 hover:ring-opacity-50 transition-all flex-shrink-0 group"
            title="Open Profile Menu"
          >
            {avatarUrl && !imageError ? (
              <img
                src={avatarUrl}
                alt={getDisplayName()}
                className="w-full h-full object-cover"
                onError={() => setImageError(true)}
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm">
                {getInitials()}
              </div>
            )}

            {/* Edit Avatar Icon (on hover) */}
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-full cursor-pointer" onClick={handleAvatarClick}>
              <Upload className="w-4 h-4 text-white" />
            </div>

            {/* Add Status Button - Bottom Right */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowStatusUploader(true);
              }}
              className="absolute -bottom-1 -right-1 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 rounded-full p-1 shadow-lg transition-all"
              title="Add status"
            >
              <Plus className="w-3 h-3 text-white" />
            </button>
          </button>

          {/* Profile Dropdown Menu */}
          {showMobileMenu && (
            <div 
              ref={mobileMenuRef}
              className="absolute top-full right-0 mt-2 w-80 bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 text-white rounded-lg shadow-2xl border border-blue-500/20 z-50"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Profile Header */}
              <div className="bg-gradient-to-r from-blue-600/20 to-purple-600/20 p-4 border-b border-blue-500/20">
                <div className="flex items-center gap-3 mb-3">
                  <div className="relative">
                    <div className="w-12 h-12 rounded-full overflow-hidden bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center border-2 border-blue-400 flex-shrink-0">
                      {avatarUrl && !imageError ? (
                        <img
                          src={avatarUrl}
                          alt={getDisplayName()}
                          className="w-full h-full object-cover"
                          onError={() => setImageError(true)}
                        />
                      ) : (
                        <span className="text-lg font-bold text-white">{getInitials()}</span>
                      )}
                    </div>
                    <button
                      onClick={handleAvatarClick}
                      className="absolute -bottom-1 -right-1 bg-purple-600 hover:bg-purple-700 rounded-full p-1.5 transition-colors"
                    >
                      <Upload className="w-3 h-3 text-white" />
                    </button>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-white truncate">{displayName}</h3>
                    <p className="text-xs text-gray-300 truncate">{user?.email || 'No email'}</p>
                  </div>
                  <button
                    onClick={() => setShowMobileMenu(false)}
                    className="p-1 hover:bg-white/10 rounded transition-all flex-shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Profile Information */}
              <div className="p-4 space-y-3 max-h-96 overflow-y-auto">
                
                {/* Email Section */}
                <div className="bg-slate-700/50 rounded-lg p-3 border border-blue-500/10">
                  <div className="flex items-center gap-2 mb-1">
                    <Mail className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
                    <p className="text-xs font-semibold text-gray-400 uppercase">Email</p>
                  </div>
                  <p className="text-white font-medium text-sm truncate">{user?.email || 'Not provided'}</p>
                </div>

                {/* Phone Section */}
                <div className="bg-slate-700/50 rounded-lg p-3 border border-cyan-500/10">
                  <div className="flex items-center gap-2 mb-1">
                    <Phone className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" />
                    <p className="text-xs font-semibold text-gray-400 uppercase">Phone</p>
                  </div>
                  <p className="text-white font-medium text-sm">{profile?.phone || 'Not provided'}</p>
                </div>

                {/* Income Level Section */}
                <div className="bg-slate-700/50 rounded-lg p-3 border border-green-500/10">
                  <div className="flex items-center gap-2 mb-1">
                    <TrendingUp className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
                    <p className="text-xs font-semibold text-gray-400 uppercase">Income Level</p>
                  </div>
                  <p className="text-white font-medium text-sm">{profile?.income_level || 'Not provided'}</p>
                </div>

                {/* Primary Financial Goal Section */}
                <div className="bg-slate-700/50 rounded-lg p-3 border border-yellow-500/10">
                  <div className="flex items-center gap-2 mb-1">
                    <Wallet className="w-3.5 h-3.5 text-yellow-400 flex-shrink-0" />
                    <p className="text-xs font-semibold text-gray-400 uppercase">Primary Goal</p>
                  </div>
                  <p className="text-white font-medium text-sm">{profile?.financial_goal || 'Not provided'}</p>
                </div>

                {/* Risk Tolerance Section */}
                <div className="bg-slate-700/50 rounded-lg p-3 border border-purple-500/10">
                  <div className="flex items-center gap-2 mb-1">
                    <Shield className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" />
                    <p className="text-xs font-semibold text-gray-400 uppercase">Risk Tolerance</p>
                  </div>
                  <p className="text-white font-medium text-sm capitalize">{profile?.risk_tolerance || 'Not provided'}</p>
                </div>

                {/* Account ID & Member Since */}
                <div className="bg-slate-700/30 rounded-lg p-3 border border-gray-500/20 text-center text-xs">
                  <p className="text-gray-400 mb-1">Account ID</p>
                  <p className="text-gray-300 font-mono text-xs mb-2 break-all">{user?.id?.slice(0, 12)}...</p>
                  <p className="text-gray-400">
                    Member since {user?.created_at ? new Date(user.created_at).toLocaleDateString() : '1/1/2026'}
                  </p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="border-t border-blue-500/20 p-3 space-y-2">
                  <button
                    onClick={() => {
                      setShowMobileMenu(false);
                      onOpenProfileEdit?.();
                    }}
                    className="w-full py-2 px-3 bg-blue-600/30 hover:bg-blue-600/50 border border-blue-500/50 text-blue-300 rounded-lg font-medium transition-all flex items-center justify-center gap-2 text-sm"
                  >
                    <Edit2 className="w-4 h-4" />
                    Edit Profile
                  </button>
                <button
                  onClick={() => {
                    handleLogout();
                    setShowMobileMenu(false);
                  }}
                  className="w-full py-2 px-3 bg-red-600/30 hover:bg-red-600/50 border border-red-500/50 text-red-300 rounded-lg font-medium transition-all flex items-center justify-center gap-2 text-sm"
                >
                  <LogOut className="w-4 h-4" />
                  Sign Out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Status Uploader Modal */}
      {showStatusUploader && (
        <StatusUploader
          onClose={() => setShowStatusUploader(false)}
          onStatusUploaded={() => {
            setShowStatusUploader(false);
            loadStatuses();
          }}
        />
      )}

      {/* Fullscreen Status Viewer Modal */}
      {showStatusViewer && currentStatus && (
        <FullscreenStatusViewer
          status={currentStatus}
          allStatuses={statuses}
          currentIndex={currentStatusIndex}
          onClose={() => setShowStatusViewer(false)}
          onPrevious={handlePrevStatus}
          onNext={handleNextStatus}
        />
      )}

      {/* Hidden File Input for Avatar Upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleAvatarUpload}
      />
    </>
  );
};

export default Header;

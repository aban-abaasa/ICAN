/**
 * Header Component
 * Top navigation bar with user profile icon for status and avatar uploads
 */

import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Plus, Settings, LogOut, ChevronDown, Lock, Eye, Wallet } from 'lucide-react';
import { StatusUploader } from './status/StatusUploader';
import { StatusCarousel } from './status/StatusCarousel';
import { uploadAvatar } from '../services/avatarService';
import { createPortal } from 'react-dom';

export const Header = () => {
  const { user, profile, getDisplayName, getAvatarUrl, signOut } = useAuth();
  const [showDropdown, setShowDropdown] = useState(false);
  const [showStatusUploader, setShowStatusUploader] = useState(false);
  const [showAvatarUpload, setShowAvatarUpload] = useState(false);
  const fileInputRef = useRef(null);
  const dropdownRef = useRef(null);
  const dropdownMenuRef = useRef(null);
  const avatarRef = useRef(null);

  const avatarUrl = getAvatarUrl();

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      // Check if click was on avatar OR dropdown menu - if so, don't close
      if (dropdownRef.current && dropdownRef.current.contains(e.target)) {
        return;
      }
      if (dropdownMenuRef.current && dropdownMenuRef.current.contains(e.target)) {
        return;
      }
      // Click was outside both, so close dropdown
      setShowDropdown(false);
    };
    
    if (showDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showDropdown]);

  const handleAvatarUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      await uploadAvatar(user.id, file);
      setShowAvatarUpload(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (error) {
      console.error('Avatar upload failed:', error);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut();
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  return (
    <>
      <header className="sticky top-0 z-40 bg-gradient-to-r from-purple-600 to-blue-600 backdrop-blur-sm border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between gap-4">
          {/* Left side - Mode/Region */}
          <div className="text-white font-semibold text-lg">
            SE Mode | Uganda
          </div>

          {/* Middle - Status Carousel */}
          <div className="flex-1 hidden md:flex justify-center">
            <StatusCarousel 
              onStatusClick={() => window.dispatchEvent(new CustomEvent('navigate-status-feed'))}
            />
          </div>

          {/* Right side - Profile */}
          <div className="relative" ref={dropdownRef}>
            <div
              onClick={() => setShowDropdown(!showDropdown)}
              className="flex items-center gap-2 px-3 py-2 hover:bg-white/10 rounded-lg transition-colors group cursor-pointer"
            >
              {/* Avatar with Plus Button */}
              <div className="relative group/avatar">
                <div
                  ref={avatarRef}
                  className="relative w-10 h-10 rounded-full flex items-center justify-center font-bold text-white cursor-pointer overflow-hidden bg-gradient-to-br from-orange-400 to-orange-600 hover:from-orange-500 hover:to-orange-700 transition-all ring-2 ring-white/30 group-hover:ring-white/50"
                >
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt={getDisplayName()}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <>
                      {profile?.first_name?.charAt(0) || ''}
                      {profile?.last_name?.charAt(0) || 'U'}
                    </>
                  )}
                </div>

                {/* Plus icon for status upload - appears on hover */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowStatusUploader(true);
                    setShowDropdown(false);
                  }}
                  className="absolute bottom-0 right-0 bg-purple-600 hover:bg-purple-700 rounded-full p-1.5 opacity-0 group-hover/avatar:opacity-100 transition-opacity shadow-lg"
                  title="Add status"
                >
                  <Plus className="w-3 h-3 text-white" />
                </button>

                {/* Lock icon when dropdown is open */}
                {showDropdown && (
                  <div className="absolute -bottom-1 -right-1 bg-green-500 rounded-full p-1 animate-pulse">
                    <Lock className="w-2.5 h-2.5 text-white" />
                  </div>
                )}
              </div>

              <div className="hidden sm:flex flex-col items-start">
                <span className="text-xs text-gray-300">Logged in</span>
                <span className="text-sm font-semibold text-white">{getDisplayName()}</span>
              </div>

              <ChevronDown className={`w-4 h-4 text-white transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
            </div>

            {/* Dropdown Menu */}
            {showDropdown && createPortal(
              <div
                ref={dropdownMenuRef}
                className="fixed bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden"
                style={{
                  top: `${avatarRef.current?.getBoundingClientRect().bottom + 8}px`,
                  right: '16px',
                  width: '280px',
                  zIndex: 9999
                }}
              >
                {/* Profile Header */}
                <div className="px-4 py-3 border-b border-slate-700">
                  <p className="text-sm text-gray-400">Logged in as</p>
                  <p className="text-white font-semibold">{getDisplayName()}</p>
                  <p className="text-xs text-gray-500">{user?.email}</p>
                </div>

                {/* Menu Items */}
                <div className="py-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowStatusUploader(true);
                      setShowDropdown(false);
                    }}
                    className="w-full px-4 py-2.5 text-left text-white hover:bg-white/10 flex items-center gap-3 transition-colors"
                  >
                    <Plus className="w-4 h-4 text-purple-400" />
                    <span>Add Status</span>
                  </button>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      window.dispatchEvent(new CustomEvent('navigate-status-feed'));
                      setShowDropdown(false);
                    }}
                    className="w-full px-4 py-2.5 text-left text-white hover:bg-white/10 flex items-center gap-3 transition-colors"
                  >
                    <Eye className="w-4 h-4 text-cyan-400" />
                    <span>View Stories</span>
                  </button>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowDropdown(false);
                      setTimeout(() => fileInputRef.current?.click(), 100);
                    }}
                    className="w-full px-4 py-2.5 text-left text-white hover:bg-white/10 flex items-center gap-3 transition-colors"
                  >
                    <Settings className="w-4 h-4 text-blue-400" />
                    <span>Change Avatar</span>
                  </button>

                  <div className="border-t border-slate-700 my-2"></div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowDropdown(false);
                      setTimeout(() => handleLogout(), 100);
                    }}
                    className="w-full px-4 py-2.5 text-left text-red-400 hover:bg-red-600/20 flex items-center gap-3 transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Sign Out</span>
                  </button>
                </div>
              </div>,
              document.body
            )}

            {/* Hidden file input for avatar upload */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleAvatarUpload}
              className="hidden"
            />
          </div>
        </div>
      </header>

      {/* Status Uploader Modal */}
      {showStatusUploader && (
        <StatusUploader
          onClose={() => setShowStatusUploader(false)}
          onStatusCreated={() => {
            setShowStatusUploader(false);
            // Optional: Show success notification
          }}
        />
      )}
    </>
  );
};

export default Header;

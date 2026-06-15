/**
 * Header Component
 * Top navigation bar with user profile icon for status and avatar uploads
 */

import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Plus, Settings, LogOut, ChevronDown, Lock, Eye, Wallet, MoreVertical, Bell, CheckCircle, TrendingUp, Heart, Mail, Phone, Eye as PrivacyEye, Download, Moon, AlertTriangle, X } from 'lucide-react';
import { StatusUploader } from './status/StatusUploader';
import { StatusCarousel } from './status/StatusCarousel';
import { uploadAvatar } from '../services/avatarService';
import { createPortal } from 'react-dom';

export const Header = ({ onSettingsMenuClick = null }) => {
  const { user, profile, getDisplayName, getAvatarUrl, signOut } = useAuth();
  const [showDropdown, setShowDropdown] = useState(false);
  const [showStatusUploader, setShowStatusUploader] = useState(false);
  const [showAvatarUpload, setShowAvatarUpload] = useState(false);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [darkMode, setDarkMode] = useState(true);
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [smsAlerts, setSmsAlerts] = useState(true);
  const [pushNotifications, setPushNotifications] = useState(true);
  const fileInputRef = useRef(null);
  const dropdownRef = useRef(null);
  const settingsRef = useRef(null);

  const avatarUrl = getAvatarUrl();

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (settingsRef.current && settingsRef.current.contains(e.target)) {
        return;
      }
      if (dropdownRef.current && dropdownRef.current.contains(e.target)) {
        return;
      }
      setShowSettingsPanel(false);
    };
    
    if (showSettingsPanel) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showSettingsPanel]);

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
      {showStatusUploader && (
        <StatusUploader
          onClose={() => setShowStatusUploader(false)}
          onStatusCreated={() => {
            setShowStatusUploader(false);
          }}
          autoOpenFilePicker={true}
        />
      )}

      {/* Settings Panel - Slide Out */}
      {showSettingsPanel && (
        <div 
          ref={settingsRef}
          className="fixed top-0 right-0 h-full w-full sm:w-96 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border-l border-purple-500/30 shadow-2xl z-50 overflow-y-auto"
        >
          {/* Header */}
          <div className="sticky top-0 bg-slate-900/95 backdrop-blur-md border-b border-purple-500/30 p-4 flex items-center justify-between">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Settings className="w-5 h-5 text-purple-400" />
              Settings
            </h2>
            <button
              onClick={() => setShowSettingsPanel(false)}
              className="p-1.5 hover:bg-purple-500/20 rounded-lg transition"
            >
              <X className="w-5 h-5 text-gray-400 hover:text-white" />
            </button>
          </div>

          {/* Settings Content */}
          <div className="p-4 space-y-6">
            {/* Account Section */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-purple-300 uppercase tracking-wide">Account</h3>
              <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-3 space-y-3">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Email Address</label>
                  <p className="text-sm text-white">{user?.email || 'abanabaasa2@gmail.com'}</p>
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Phone Number</label>
                  <p className="text-sm text-white">{profile?.phone || '+256770381864'}</p>
                </div>
              </div>
            </div>

            {/* Notifications Section */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-purple-300 uppercase tracking-wide">Notifications</h3>
              <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm text-gray-300 flex items-center gap-2">
                    <Mail className="w-4 h-4 text-blue-400" />
                    Email Notifications
                  </label>
                  <button
                    onClick={() => setEmailNotifications(!emailNotifications)}
                    className={`px-3 py-1 rounded text-xs font-medium transition ${
                      emailNotifications
                        ? 'bg-green-500/20 text-green-300'
                        : 'bg-gray-500/20 text-gray-400'
                    }`}
                  >
                    {emailNotifications ? '✓ On' : 'Off'}
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <label className="text-sm text-gray-300 flex items-center gap-2">
                    <Phone className="w-4 h-4 text-purple-400" />
                    SMS Alerts
                  </label>
                  <button
                    onClick={() => setSmsAlerts(!smsAlerts)}
                    className={`px-3 py-1 rounded text-xs font-medium transition ${
                      smsAlerts
                        ? 'bg-green-500/20 text-green-300'
                        : 'bg-gray-500/20 text-gray-400'
                    }`}
                  >
                    {smsAlerts ? '✓ On' : 'Off'}
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <label className="text-sm text-gray-300 flex items-center gap-2">
                    <Bell className="w-4 h-4 text-orange-400" />
                    Push Notifications
                  </label>
                  <button
                    onClick={() => setPushNotifications(!pushNotifications)}
                    className={`px-3 py-1 rounded text-xs font-medium transition ${
                      pushNotifications
                        ? 'bg-green-500/20 text-green-300'
                        : 'bg-gray-500/20 text-gray-400'
                    }`}
                  >
                    {pushNotifications ? '✓ On' : 'Off'}
                  </button>
                </div>
              </div>
            </div>

            {/* Privacy Section */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-purple-300 uppercase tracking-wide">Privacy</h3>
              <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-3 space-y-2">
                <button className="w-full text-left px-3 py-2 hover:bg-purple-500/10 rounded transition text-sm text-gray-300 hover:text-purple-300 flex items-center gap-2">
                  <PrivacyEye className="w-4 h-4" />
                  View Privacy Policy
                </button>
                <button className="w-full text-left px-3 py-2 hover:bg-purple-500/10 rounded transition text-sm text-gray-300 hover:text-purple-300 flex items-center gap-2">
                  <Download className="w-4 h-4" />
                  Data Export
                </button>
              </div>
            </div>

            {/* Appearance Section */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-purple-300 uppercase tracking-wide">Appearance</h3>
              <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm text-gray-300 flex items-center gap-2">
                    <Moon className="w-4 h-4 text-indigo-400" />
                    Dark Mode
                  </label>
                  <button
                    onClick={() => setDarkMode(!darkMode)}
                    className={`px-3 py-1 rounded text-xs font-medium transition ${
                      darkMode
                        ? 'bg-green-500/20 text-green-300'
                        : 'bg-gray-500/20 text-gray-400'
                    }`}
                  >
                    {darkMode ? '✓ Always On' : 'Off'}
                  </button>
                </div>
              </div>
            </div>

            {/* Danger Zone */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-red-400 uppercase tracking-wide flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                Danger Zone
              </h3>
              <div className="bg-red-950/30 border border-red-500/30 rounded-lg p-3 space-y-2">
                <button
                  onClick={handleLogout}
                  className="w-full px-4 py-2 bg-red-600/20 hover:bg-red-600/40 border border-red-500/50 hover:border-red-400/70 rounded transition text-red-300 hover:text-red-200 text-sm font-medium flex items-center justify-center gap-2"
                >
                  <LogOut className="w-4 h-4" />
                  Logout
                </button>
                <button className="w-full px-4 py-2 bg-red-700 hover:bg-red-800 rounded transition text-white text-sm font-medium">
                  Delete Account
                </button>
              </div>
            </div>

            {/* Save & Close */}
            <div className="space-y-2 pb-4">
              <button
                onClick={() => setShowSettingsPanel(false)}
                className="w-full px-4 py-2.5 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white rounded-lg transition font-medium"
              >
                Save & Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings Button - 3 Dots */}
      <div className="relative" ref={dropdownRef}>
        <button 
          onClick={() => setShowSettingsPanel(!showSettingsPanel)}
          className="p-1.5 sm:p-2 hover:bg-purple-500/30 rounded-lg transition active:scale-95 flex-shrink-0"
          title="Settings"
        >
          <MoreVertical className="w-5 sm:w-6 h-5 sm:h-6 text-purple-300 hover:text-white" />
        </button>
      </div>
    </>
  );
};

export default Header;

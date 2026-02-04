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

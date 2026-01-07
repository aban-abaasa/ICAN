/**
 * ProfileIcon Component
 * Displays user avatar with fallback to initials
 * Privacy-first design with blockchain verification badge
 */

import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../../context/AuthContext';
import { User, Shield, LogOut, Settings, ChevronDown, X } from 'lucide-react';

// Avatar sizes
const sizes = {
  xs: 'w-6 h-6 text-xs',
  sm: 'w-8 h-8 text-sm',
  md: 'w-10 h-10 text-base',
  lg: 'w-12 h-12 text-lg',
  xl: 'w-16 h-16 text-xl',
  '2xl': 'w-20 h-20 text-2xl',
};

// Gradient backgrounds for initials
const gradients = [
  'from-purple-500 to-pink-500',
  'from-blue-500 to-cyan-500',
  'from-green-500 to-emerald-500',
  'from-orange-500 to-yellow-500',
  'from-red-500 to-pink-500',
  'from-indigo-500 to-purple-500',
  'from-teal-500 to-green-500',
];

// Get consistent gradient based on user ID or email
const getGradient = (identifier) => {
  if (!identifier) return gradients[0];
  let hash = 0;
  for (let i = 0; i < identifier.length; i++) {
    hash = identifier.charCodeAt(i) + ((hash << 5) - hash);
  }
  return gradients[Math.abs(hash) % gradients.length];
};

/**
 * ProfileAvatar - Just the avatar image/initials
 */
export const ProfileAvatar = ({ 
  size = 'md', 
  showBadge = false,
  onClick = null,
  className = ''
}) => {
  const { user, profile, getInitials, getDisplayName, getAvatarUrl } = useAuth();
  const [imageError, setImageError] = useState(false);
  
  const avatarUrl = getAvatarUrl();
  const initials = getInitials(getDisplayName());
  const gradient = getGradient(user?.id || user?.email);
  
  const sizeClasses = sizes[size] || sizes.md;
  
  return (
    <div 
      className={`relative inline-flex ${onClick ? 'cursor-pointer' : ''} ${className}`}
      onClick={onClick}
    >
      {avatarUrl && !imageError ? (
        <img
          src={avatarUrl}
          alt={getDisplayName()}
          className={`${sizeClasses} rounded-full object-cover ring-2 ring-white/20`}
          onError={() => setImageError(true)}
        />
      ) : (
        <div 
          className={`${sizeClasses} rounded-full bg-gradient-to-br ${gradient} flex items-center justify-center font-semibold text-white ring-2 ring-white/20`}
        >
          {initials}
        </div>
      )}
      
      {/* Blockchain verified badge */}
      {showBadge && profile?.blockchain_verified && (
        <div className="absolute -bottom-1 -right-1 bg-green-500 rounded-full p-0.5">
          <Shield className="w-3 h-3 text-white" />
        </div>
      )}
    </div>
  );
};

/**
 * ProfileIcon - Avatar with dropdown menu
 */
const ProfileIcon = ({ 
  size = 'md',
  showDropdown = true,
  onProfileClick = null,
  onSettingsClick = null,
  onLogoutClick = null,
}) => {
  const { user, profile, signOut, getDisplayName } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const buttonRef = useRef(null);

  // Close dropdown when clicking outside or pressing Escape
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await signOut();
      if (onLogoutClick) onLogoutClick();
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      setLoggingOut(false);
      setIsOpen(false);
    }
  };

  if (!user) return null;

  // Dropdown content rendered via Portal
  const dropdownContent = isOpen && createPortal(
    <>
      {/* Full screen backdrop */}
      <div 
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        style={{ zIndex: 99998 }}
        onClick={() => setIsOpen(false)} 
      />
      
      {/* Dropdown Menu - centered for mobile, positioned for desktop */}
      <div 
        className="fixed right-4 top-20 w-80 max-w-[calc(100vw-32px)] bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200"
        style={{ zIndex: 99999 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={() => setIsOpen(false)}
          className="absolute top-3 right-3 p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-full transition-colors z-10"
        >
          <X className="w-5 h-5" />
        </button>

        {/* User Info Header */}
        <div className="p-6 bg-gradient-to-br from-purple-600/30 via-blue-600/20 to-pink-600/30 border-b border-slate-700">
          <div className="flex items-center gap-4">
            <ProfileAvatar size="xl" showBadge />
            <div className="flex-1 min-w-0 pr-8">
              <p className="font-bold text-xl text-white truncate">
                {getDisplayName()}
              </p>
              <p className="text-sm text-gray-300 truncate mt-1">
                {user.email}
              </p>
              {profile?.blockchain_verified && (
                <div className="flex items-center gap-1 mt-2 text-xs text-green-400">
                  <Shield className="w-3 h-3" />
                  <span>Blockchain Verified</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Menu Items */}
        <div className="p-3">
          <button
            onClick={() => {
              setIsOpen(false);
              onProfileClick?.();
            }}
            className="w-full flex items-center gap-3 px-4 py-3 text-gray-300 hover:bg-white/10 rounded-xl transition-colors"
          >
            <User className="w-5 h-5" />
            <span className="font-medium">View Profile</span>
          </button>
          
          <button
            onClick={() => {
              setIsOpen(false);
              onSettingsClick?.();
            }}
            className="w-full flex items-center gap-3 px-4 py-3 text-gray-300 hover:bg-white/10 rounded-xl transition-colors"
          >
            <Settings className="w-5 h-5" />
            <span className="font-medium">Settings</span>
          </button>

          <hr className="my-2 border-slate-700" />

          <button
            onClick={handleLogout}
            disabled={loggingOut}
            className="w-full flex items-center gap-3 px-4 py-3 text-red-400 hover:bg-red-500/20 rounded-xl transition-colors disabled:opacity-50"
          >
            <LogOut className="w-5 h-5" />
            <span className="font-medium">{loggingOut ? 'Signing out...' : 'Sign Out'}</span>
          </button>
        </div>
      </div>
    </>,
    document.body
  );

  return (
    <>
      {/* Avatar Button */}
      <button
        ref={buttonRef}
        onClick={() => showDropdown ? setIsOpen(!isOpen) : onProfileClick?.()}
        className="flex items-center gap-2 p-1 rounded-full hover:bg-white/10 transition-colors"
      >
        <ProfileAvatar size={size} showBadge />
        {showDropdown && (
          <ChevronDown 
            className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} 
          />
        )}
      </button>

      {/* Dropdown rendered via Portal */}
      {dropdownContent}
    </>
  );
};

/**
 * ProfileCard - Full profile card display
 */
export const ProfileCard = ({ onEdit = null }) => {
  const { user, profile, getDisplayName, getAvatarUrl } = useAuth();

  if (!user) return null;

  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
      <div className="flex items-start gap-4">
        <ProfileAvatar size="xl" showBadge />
        
        <div className="flex-1">
          <h3 className="text-xl font-bold text-white">{getDisplayName()}</h3>
          <p className="text-gray-400">{user.email}</p>
          
          {profile && (
            <div className="mt-3 space-y-1 text-sm text-gray-400">
              {profile.phone && (
                <p>📱 {profile.phone}</p>
              )}
              {profile.income_level && (
                <p>💰 Income Level: {profile.income_level}</p>
              )}
              {profile.financial_goal && (
                <p>🎯 Goal: {profile.financial_goal}</p>
              )}
              {profile.risk_tolerance && (
                <p>📊 Risk: {profile.risk_tolerance}</p>
              )}
            </div>
          )}

          {profile?.blockchain_verified && (
            <div className="mt-3 inline-flex items-center gap-2 px-3 py-1 bg-green-500/20 text-green-400 rounded-full text-sm">
              <Shield className="w-4 h-4" />
              <span>Blockchain Verified</span>
            </div>
          )}
        </div>

        {onEdit && (
          <button
            onClick={onEdit}
            className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
          >
            <Settings className="w-5 h-5" />
          </button>
        )}
      </div>
    </div>
  );
};

export default ProfileIcon;

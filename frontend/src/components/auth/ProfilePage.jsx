/**
 * ProfilePage Component
 * Full user profile view with editing capabilities
 * Privacy-first design with blockchain verification
 */

import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { User, Mail, Phone, Edit2, Save, X, Upload, Shield, Wallet, Key, LogOut, Plus, Camera, Trash2, Clock, Bell } from 'lucide-react';
import { StatusUploader } from '../status/StatusUploader';
import ShareholderApprovalsCenter from '../ShareholderApprovalsCenter';

export const ProfilePage = ({ onClose = null, onLogout = null }) => {
  const { 
    user, 
    profile, 
    getDisplayName, 
    getAvatarUrl,
    updateProfile,
    uploadAvatar,
    loadProfile,
    signOut
  } = useAuth();

  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [imageError, setImageError] = useState(false);
  const [showStatusUploader, setShowStatusUploader] = useState(false);
  const [showAvatarModal, setShowAvatarModal] = useState(false);
  const [showAvatarView, setShowAvatarView] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState(0);
  const [showApprovalsModal, setShowApprovalsModal] = useState(false);
  const fileInputRef = useRef(null);

  // Form state
  const [formData, setFormData] = useState({
    full_name: profile?.full_name || '',
    phone: profile?.phone || '',
    income_level: profile?.income_level || '',
    financial_goal: profile?.financial_goal || '',
    risk_tolerance: profile?.risk_tolerance || 'moderate',
  });

  // Sync form data when profile changes
  useEffect(() => {
    if (profile) {
      setFormData({
        full_name: profile.full_name || '',
        phone: profile.phone || '',
        income_level: profile.income_level || '',
        financial_goal: profile.financial_goal || '',
        risk_tolerance: profile.risk_tolerance || 'moderate',
      });
    }
  }, [profile]);

  // Load pending approvals count
  useEffect(() => {
    if (user?.id) {
      loadPendingApprovalsCount();
    }
  }, [user?.id]);

  const loadPendingApprovalsCount = async () => {
    try {
      const { getSupabase } = await import('../../services/pitchingService');
      const supabase = getSupabase();

      // Get pending shareholder investment approvals (where read_at is null)
      const { data: pendingApprovals, error } = await supabase
        .from('shareholder_notifications')
        .select('id', { count: 'exact' })
        .is('read_at', null);

      if (!error && pendingApprovals) {
        setPendingApprovalsCount(pendingApprovals.length);
        console.log(`📊 Pending approvals: ${pendingApprovals.length}`);
      }
    } catch (error) {
      console.error('Error loading pending approvals:', error);
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleAvatarClick = () => {
    if (isEditing) {
      // Directly open file picker while editing profile
      triggerFileInput();
    } else {
      setShowAvatarView(true);
    }
  };

  const handleAvatarUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingAvatar(true);
    setError(null);

    // Create preview immediately and wait for it to complete
    await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        console.log('🖼️ Preview ready:', reader.result?.substring(0, 50));
        setPreviewUrl(reader.result);
        resolve();
      };
      reader.readAsDataURL(file);
    });

    try {
      console.log('📤 Starting upload...');
      const uploadedUrl = await uploadAvatar(file);
      console.log('✅ Upload complete, showing success message');
      setSuccess('Avatar updated successfully! ✅');
      setImageError(false);
      
      // Refresh profile to show new avatar
      if (user?.id) {
        console.log('🔄 Refreshing profile...');
        await loadProfile(user.id);
      }
      
      // Keep preview visible for 3 seconds showing the uploaded result
      setTimeout(() => {
        console.log('⏱️ Closing modal...');
        setShowAvatarModal(false);
        setPreviewUrl(null);
        setSuccess(null);
      }, 3000);
    } catch (err) {
      console.error('❌ Upload failed:', err);
      setError('Failed to upload avatar: ' + err.message);
      setPreviewUrl(null);
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    try {
      await updateProfile(formData);
      setSuccess('Profile updated successfully!');
      setIsEditing(false);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError('Failed to update profile: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await signOut();
      onLogout?.();
    } catch (err) {
      setError('Logout failed: ' + err.message);
    } finally {
      setIsLoggingOut(false);
    }
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  const avatarUrl = getAvatarUrl();

  // Log and reset imageError whenever profile changes
  useEffect(() => {
    console.log('📸 Avatar URL updated:', avatarUrl);
    if (avatarUrl) {
      console.log('✅ Avatar URL exists, resetting imageError');
      setImageError(false);
    }
  }, [avatarUrl]);

  const toTitleCase = (value = '') =>
    String(value)
      .replace(/_/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, (match) => match.toUpperCase());

  const profileCompletionCount = [formData.phone, formData.income_level, formData.financial_goal, formData.risk_tolerance]
    .filter((value) => String(value || '').trim().length > 0)
    .length;
  const profileCompletionPercent = Math.round((profileCompletionCount / 4) * 100);
  const normalizedRiskTolerance = String(formData.risk_tolerance || '').toLowerCase();
  const riskToneClass = normalizedRiskTolerance === 'high'
    ? 'bg-red-500/20 text-red-300 border-red-400/40'
    : normalizedRiskTolerance === 'medium' || normalizedRiskTolerance === 'moderate'
      ? 'bg-yellow-500/20 text-yellow-200 border-yellow-400/40'
      : 'bg-emerald-500/20 text-emerald-300 border-emerald-400/40';

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 p-3 sm:p-4 md:p-8 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
      <div className="max-w-5xl mx-auto w-full">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 sm:mb-8">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white">My Profile</h1>
            <p className="text-sm text-slate-300 mt-1">Manage your account, settings, and financial profile.</p>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 sm:p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 sm:w-6 sm:h-6" />
            </button>
          )}
        </div>

        {/* Alerts */}
        {error && (
          <div className="mb-4 sm:mb-6 p-3 sm:p-4 bg-red-500/20 border border-red-500/50 rounded-lg text-red-200 text-sm sm:text-base">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-4 sm:mb-6 p-3 sm:p-4 bg-green-500/20 border border-green-500/50 rounded-lg text-green-200 text-sm sm:text-base">
            {success}
          </div>
        )}

        {/* Main Profile Card */}
        <div className="bg-slate-800/60 border border-slate-700/80 rounded-xl sm:rounded-2xl overflow-hidden mb-4 sm:mb-6 shadow-[0_12px_38px_rgba(8,12,32,0.45)]">
          {/* Profile Header Background */}
          <div className="h-24 sm:h-32 bg-gradient-to-r from-purple-600/35 via-blue-600/25 to-pink-600/35"></div>

          {/* Profile Content */}
          <div className="relative px-4 sm:px-6 pb-5 sm:pb-6 pt-0">
            {/* Avatar */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between mb-5 sm:mb-6 -mt-12 sm:-mt-16">
              <div className="flex items-end gap-3 sm:gap-4">
                <div className="relative">
                  <div
                    onClick={handleAvatarClick}
                    className={`relative ${isEditing ? 'cursor-pointer' : ''}`}
                  >
                    {avatarUrl && !imageError ? (
                      <img
                        src={avatarUrl}
                        alt={getDisplayName()}
                        className="w-24 h-24 sm:w-32 sm:h-32 rounded-full object-cover ring-4 ring-slate-800 hover:ring-purple-500/50 transition-all"
                        onError={(e) => {
                          console.error('❌ Image failed to load:', avatarUrl, e);
                          setImageError(true);
                        }}
                        onLoad={() => console.log('✅ Image loaded successfully:', avatarUrl)}
                      />
                    ) : (
                      <div className="w-24 h-24 sm:w-32 sm:h-32 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center ring-4 ring-slate-800 text-white text-3xl sm:text-4xl font-bold">
                        {profile?.first_name?.charAt(0) || ''}
                        {profile?.last_name?.charAt(0) || 'U'}
                      </div>
                    )}
                    {isEditing && (
                      <div className="absolute bottom-0 right-0 bg-purple-600 rounded-full p-1.5 sm:p-2 hover:bg-purple-700 transition-colors">
                        <Upload className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
                      </div>
                    )}
                  </div>
                  
                  {/* Status Upload Button */}
                  <button
                    onClick={() => setShowStatusUploader(true)}
                    className="absolute -bottom-2 -right-2 bg-gradient-to-r from-purple-600 to-pink-600 rounded-full p-2 sm:p-2.5 hover:from-purple-700 hover:to-pink-700 transition-all shadow-lg text-white"
                    title="Add status"
                  >
                    <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  </button>
                </div>

                <div className="min-w-0">
                  {isEditing ? (
                    <input
                      type="text"
                      name="full_name"
                      placeholder="Full name"
                      value={formData.full_name}
                      onChange={handleInputChange}
                      className="w-full px-3 py-1.5 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-gray-400 text-sm sm:text-base"
                    />
                  ) : (
                    <div>
                      <h2 className="text-xl sm:text-2xl font-bold text-white break-words">{getDisplayName()}</h2>
                      <p className="text-gray-400 text-xs sm:text-sm break-all">{user?.email}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Button Group - Approval, Notifications, Wallet, Edit */}
              <div className="grid grid-cols-2 gap-2 w-full sm:w-auto sm:min-w-[360px]">
                {/* Approval Tab Button */}
                <button
                  onClick={() => setShowApprovalsModal(true)}
                  className="relative px-2.5 sm:px-3 py-2 bg-yellow-500/25 hover:bg-yellow-500/35 border border-yellow-400/40 text-white transition rounded-lg font-semibold"
                  title="Pending Approvals"
                >
                  <Clock className="w-4 h-4" />
                  <span className="text-xs sm:text-sm">Approve</span>
                  <span className="hidden sm:block text-[10px] text-yellow-100/85 ml-auto">Pending requests</span>
                  {pendingApprovalsCount > 0 && (
                    <span className="absolute -top-2 -right-2 bg-red-600 text-white text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center">
                      {pendingApprovalsCount > 9 ? '9+' : pendingApprovalsCount}
                    </span>
                  )}
                </button>

                {/* Notification Settings Icon */}
                <div
                  className="bg-blue-500/25 border border-blue-400/40 text-white p-2 rounded-lg transition relative flex flex-col items-start justify-start"
                  title="Notification Settings"
                >
                  <Bell className="w-4 h-4 text-blue-200" />
                  <span className="text-xs sm:text-sm font-semibold mt-1">Profile Settings</span>
                  <span className="text-[10px] sm:text-[11px] text-blue-100/85">Account notifications</span>
                  {/* Notification Settings Tooltip */}
                  <div className="hidden">
                    <p className="font-semibold mb-2 text-blue-300">📢 Profile Settings</p>
                    <div className="space-y-1 text-slate-300">
                      <div className="flex items-center gap-2">
                        <span>Account notifications</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Wallet Icon Button */}
                <button
                  className="bg-green-500/25 border border-green-400/40 text-white p-2 rounded-lg transition relative flex flex-col items-start justify-start"
                  title="My Wallet"
                >
                  <Wallet className="w-4 h-4 text-green-200" />
                  <span className="text-xs sm:text-sm font-semibold mt-1">My Wallet</span>
                  <span className="text-[10px] sm:text-[11px] text-green-100/85">View wallet and transactions</span>
                  {/* Wallet Tooltip */}
                  <div className="hidden">
                    <p className="font-semibold text-green-300 mb-1">💰 My Wallet</p>
                    <p className="text-slate-400">View wallet and transaction history</p>
                  </div>
                </button>

                {/* Edit/Save Button */}
                <button
                  onClick={() => {
                    if (isEditing) {
                      handleSave();
                    } else {
                      setIsEditing(true);
                    }
                  }}
                  disabled={isSaving}
                  className="flex flex-col items-start justify-start gap-1 px-3 sm:px-4 py-2 bg-purple-500/25 hover:bg-purple-500/35 border border-purple-400/40 disabled:bg-purple-600/40 text-white rounded-lg font-medium transition-colors"
                >
                  {isEditing ? (
                    <>
                      <Save className="w-4 h-4" />
                      <span className="text-xs sm:text-sm">{isSaving ? 'Saving...' : 'Save'}</span>
                      <span className="text-[10px] sm:text-[11px] text-purple-100/85">Save profile changes</span>
                    </>
                  ) : (
                    <>
                      <Edit2 className="w-4 h-4" />
                      <span className="text-xs sm:text-sm">Edit</span>
                      <span className="text-[10px] sm:text-[11px] text-purple-100/85">Update your information</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Verification + Completion */}
            <div className="flex flex-wrap items-center gap-2 mb-6">
              {profile?.blockchain_verified && (
                <div className="flex items-center gap-2 px-3 py-2 bg-green-500/20 text-green-400 rounded-lg inline-flex w-fit">
                  <Shield className="w-4 h-4" />
                  <span className="text-sm font-medium">Blockchain Verified</span>
                </div>
              )}
              <div className="flex items-center gap-2 px-3 py-2 bg-indigo-500/20 text-indigo-200 rounded-lg border border-indigo-400/30">
                <User className="w-4 h-4" />
                <span className="text-sm font-medium">Profile completion: {profileCompletionPercent}%</span>
              </div>
            </div>

            {/* Profile Details */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Email */}
              <div className="flex items-center gap-3 p-2.5 sm:p-3 bg-slate-700/50 rounded-lg">
                <Mail className="w-5 h-5 text-purple-400" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-400">Email</p>
                  <p className="text-white text-sm sm:text-base break-all">{user?.email}</p>
                </div>
              </div>

              {/* Phone */}
              <div className="flex items-center gap-3 p-2.5 sm:p-3 bg-slate-700/50 rounded-lg">
                <Phone className="w-5 h-5 text-blue-400" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-400">Phone</p>
                  {isEditing ? (
                    <input
                      type="tel"
                      name="phone"
                      placeholder="Add phone number"
                      value={formData.phone}
                      onChange={handleInputChange}
                      className="w-full px-2 py-1 bg-slate-600 border border-slate-500 rounded text-white placeholder-gray-400"
                    />
                  ) : (
                    <p className="text-white text-sm sm:text-base">{formData.phone || 'Not provided'}</p>
                  )}
                </div>
              </div>

              {/* Income Level */}
              <div className="flex items-center gap-3 p-2.5 sm:p-3 bg-slate-700/50 rounded-lg">
                <Wallet className="w-5 h-5 text-green-400" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-400">Income Level</p>
                  {isEditing ? (
                    <select
                      name="income_level"
                      value={formData.income_level}
                      onChange={handleInputChange}
                      className="w-full px-2 py-1 bg-slate-600 border border-slate-500 rounded text-white"
                    >
                      <option value="">Select income level</option>
                      <option value="low">Low ({"<"} 500k UGX/month)</option>
                      <option value="medium">Medium (500k - 2M UGX/month)</option>
                      <option value="high">High (2M - 5M UGX/month)</option>
                      <option value="very_high">Very High ({">"} 5M UGX/month)</option>
                    </select>
                  ) : (
                    <p className="text-white text-sm sm:text-base">{formData.income_level ? toTitleCase(formData.income_level) : 'Not provided'}</p>
                  )}
                </div>
              </div>

              {/* Financial Goal */}
              <div className="flex items-start gap-3 p-2.5 sm:p-3 bg-slate-700/50 rounded-lg">
                <Key className="w-5 h-5 text-orange-400 mt-1" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-400">Primary Financial Goal</p>
                  {isEditing ? (
                    <select
                      name="financial_goal"
                      value={formData.financial_goal}
                      onChange={handleInputChange}
                      className="w-full px-2 py-1 bg-slate-600 border border-slate-500 rounded text-white"
                    >
                      <option value="">Select a goal</option>
                      <option value="save_emergency_fund">Save Emergency Fund</option>
                      <option value="pay_off_debt">Pay Off Debt</option>
                      <option value="grow_business">Grow Business</option>
                      <option value="invest_wisely">Invest Wisely</option>
                      <option value="plan_retirement">Plan for Retirement</option>
                      <option value="give_back">Give Back to Community</option>
                      <option value="build_wealth">Build Long-term Wealth</option>
                    </select>
                  ) : (
                    <p className="text-white text-sm sm:text-base">{formData.financial_goal ? toTitleCase(formData.financial_goal) : 'Not provided'}</p>
                  )}
                </div>
              </div>

              {/* Risk Tolerance */}
              <div className="flex items-center gap-3 p-2.5 sm:p-3 bg-slate-700/50 rounded-lg">
                <Shield className="w-5 h-5 text-cyan-400" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-400">Risk Tolerance</p>
                  {isEditing ? (
                    <select
                      name="risk_tolerance"
                      value={formData.risk_tolerance}
                      onChange={handleInputChange}
                      className="w-full px-2 py-1 bg-slate-600 border border-slate-500 rounded text-white"
                    >
                      <option value="low">Conservative (Low Risk)</option>
                      <option value="medium">Moderate (Medium Risk)</option>
                      <option value="high">Aggressive (High Risk)</option>
                    </select>
                  ) : (
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full border text-sm ${riskToneClass}`}>
                      {toTitleCase(formData.risk_tolerance || 'Not specified')}
                    </span>
                  )}
                </div>
              </div>
            </div>

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

        {/* Account Info + Actions */}
        <div className="mt-5 sm:mt-6 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-stretch">
          <div className="p-3 sm:p-4 bg-slate-800/50 border border-slate-700 rounded-lg text-left">
            <p className="text-xs sm:text-sm text-gray-400">
              Account ID: <span className="font-mono text-gray-300 break-all">{user?.id}</span>
            </p>
            <p className="text-xs text-gray-500 mt-2">
              Member since {new Date(user?.created_at).toLocaleDateString()}
            </p>
          </div>
          <button
            onClick={handleLogout}
            disabled={isLoggingOut}
            className="w-full md:w-auto flex items-center justify-center gap-2 px-5 py-3 bg-red-600/20 hover:bg-red-600/30 border border-red-600/50 text-red-400 rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            <LogOut className="w-5 h-5" />
            <span>{isLoggingOut ? 'Signing out...' : 'Sign Out'}</span>
          </button>
        </div>

        {/* Avatar Change Modal */}
        {showAvatarModal && (
          <div className="fixed inset-0 bg-black/50 flex items-end z-50">
            <div className="w-full bg-gradient-to-t from-slate-900 via-slate-850 to-slate-800 rounded-t-2xl p-4 sm:p-6 max-h-[85vh] sm:max-h-96 overflow-y-auto animate-in slide-in-from-bottom">
              {/* Header */}
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl sm:text-2xl font-bold text-white">Change Profile Picture</h2>
                <button
                  onClick={() => setShowAvatarModal(false)}
                  className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              {/* Preview Section */}
              <div className="mb-6">
                {previewUrl ? (
                  <div>
                    <p className="text-xs text-gray-400 text-center mb-2">Preview</p>
                    <div className="flex justify-center">
                      <img
                        src={previewUrl}
                        alt="Preview"
                        className="w-24 h-24 sm:w-32 sm:h-32 rounded-full object-cover ring-4 ring-green-500/50"
                      />
                    </div>
                  </div>
                ) : (
                  <div>
                    <p className="text-xs text-gray-400 text-center mb-2">Current Avatar</p>
                    <div className="flex justify-center">
                      <div className="relative">
                        {avatarUrl && !imageError ? (
                          <img
                            src={avatarUrl}
                            alt={getDisplayName()}
                            className="w-24 h-24 rounded-full object-cover ring-4 ring-purple-500/50"
                          />
                        ) : (
                          <div className="w-24 h-24 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center ring-4 ring-purple-500/50 text-white text-3xl font-bold">
                            {profile?.first_name?.charAt(0) || ''}
                            {profile?.last_name?.charAt(0) || 'U'}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Upload Options */}
              <div className="space-y-3">
                {/* Upload Photo Button */}
                <button
                  onClick={triggerFileInput}
                  disabled={isUploadingAvatar}
                  className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:from-purple-600/50 disabled:to-pink-600/50 text-white rounded-lg font-medium transition-all"
                >
                  <Upload className="w-5 h-5" />
                  <span>{isUploadingAvatar ? 'Uploading...' : 'Upload Photo'}</span>
                </button>

                {/* Take Photo Button (Placeholder) */}
                <button
                  className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-slate-700/50 hover:bg-slate-700 border border-slate-600 text-white rounded-lg font-medium transition-all"
                >
                  <Camera className="w-5 h-5" />
                  <span>Take Photo</span>
                </button>

                {/* Remove Photo Button */}
                <button
                  className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-red-600/20 hover:bg-red-600/30 border border-red-600/50 text-red-400 rounded-lg font-medium transition-all"
                >
                  <Trash2 className="w-5 h-5" />
                  <span>Remove Photo</span>
                </button>

                {/* Info Text */}
                <p className="text-xs text-gray-400 text-center mt-4">
                  Recommended: Square image, at least 400x400 pixels, JPG or PNG format
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Avatar View Modal */}
        {showAvatarView && (
          <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4">
            <div className="relative max-w-2xl w-full animate-in fade-in zoom-in-95">
              {/* Close Button */}
              <button
                onClick={() => setShowAvatarView(false)}
                className="absolute -top-10 sm:-top-12 right-0 p-2 text-gray-400 hover:text-white transition-colors"
              >
                <X className="w-7 h-7 sm:w-8 sm:h-8" />
              </button>

              {/* Avatar Container */}
              <div className="flex flex-col items-center gap-4">
                {/* Main Avatar Display */}
                <div className="rounded-2xl overflow-hidden shadow-2xl">
                  {avatarUrl && !imageError ? (
                    <img
                      src={avatarUrl}
                      alt={getDisplayName()}
                      className="w-72 h-72 sm:w-96 sm:h-96 object-cover"
                    />
                  ) : (
                    <div className="w-72 h-72 sm:w-96 sm:h-96 bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white text-5xl sm:text-7xl font-bold">
                      {profile?.first_name?.charAt(0) || ''}
                      {profile?.last_name?.charAt(0) || 'U'}
                    </div>
                  )}
                </div>

                {/* Name Below Avatar */}
                <div className="text-center">
                  <h2 className="text-2xl sm:text-3xl font-bold text-white break-words">{getDisplayName()}</h2>
                  <p className="text-gray-400 text-xs sm:text-sm mt-2 break-all">{user?.email}</p>
                </div>

                {/* Action Buttons */}
                <div className="flex flex-col sm:flex-row gap-3 mt-4 w-full sm:w-auto">
                  <button
                    onClick={() => {
                      setShowAvatarView(false);
                      setIsEditing(true);
                    }}
                    className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors"
                  >
                    <Edit2 className="w-4 h-4" />
                    Edit Profile
                  </button>
                  <button
                    onClick={() => setShowAvatarView(false)}
                    className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition-colors"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Status Uploader Modal */}
        {showStatusUploader && (
          <StatusUploader
            onClose={() => setShowStatusUploader(false)}
            onStatusCreated={() => {
              setShowStatusUploader(false);
              // Optionally refresh statuses or show notification
            }}
            autoOpenFilePicker={true}
          />
        )}

        {/* Pending Approvals - Investment & Member */}
        {showApprovalsModal && (
          <ShareholderApprovalsCenter 
            businessProfileId={user?.id}
            currentUserId={user?.id}
            currentUserEmail={user?.email}
            onClose={() => setShowApprovalsModal(false)}
          />
        )}
      </div>
    </div>
  );
};

export default ProfilePage;


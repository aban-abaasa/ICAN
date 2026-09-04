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
import ReadinessPanel from '../profile/ReadinessPanel';
import GrowthPanel from '../profile/GrowthPanel';
import PortfolioTab from '../profile/PortfolioTab';

export const ProfilePage = ({ onClose = null, onLogout = null, initialTab = 'overview', readinessProps = {}, growthProps = {} }) => {
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

  const [activeTab, setActiveTab] = useState(initialTab);
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
    ? 'bg-red-100 text-red-700 border-red-200'
    : normalizedRiskTolerance === 'medium' || normalizedRiskTolerance === 'moderate'
      ? 'bg-yellow-100 text-yellow-700 border-yellow-200'
      : 'bg-emerald-100 text-emerald-700 border-emerald-200';

  const TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'readiness', label: 'Readiness' },
    { id: 'growth', label: 'Growth' },
    { id: 'resume', label: 'My Resume' },
  ];

  return (
    <div className="min-h-[100dvh] bg-gradient-to-b from-slate-950 via-purple-950 to-slate-950">
      <div className="p-3 sm:p-3 md:p-8 pb-[calc(7.5rem+env(safe-area-inset-bottom))] sm:pb-3 md:pb-8 pt-[calc(0.75rem+env(safe-area-inset-top))]">
        <div className="max-w-5xl mx-auto w-full">
          {/* Header - Mobile Optimized */}
          <div className="flex items-center justify-between mb-3 sm:mb-4">
            <div className="min-w-0 flex-1">
              <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-white truncate">My Profile</h1>
              <p className="text-xs sm:text-sm text-slate-600 mt-0.5 sm:mt-1 truncate">Manage your account, settings, and financial profile.</p>
            </div>
            {onClose && (
              <button
                onClick={onClose}
                className="p-1.5 sm:p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-200/50 rounded-lg transition-colors flex-shrink-0 ml-2"
              >
                <X className="w-5 h-5 sm:w-6 sm:h-6" />
              </button>
            )}
          </div>

          {/* Tab Bar */}
          <div className="flex gap-1.5 mb-3 sm:mb-4 md:mb-8 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-shrink-0 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'bg-gradient-to-r from-amber-700 to-purple-600 text-white shadow-md'
                    : 'bg-slate-800/60 text-gray-300 hover:bg-slate-800'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

        {activeTab === 'readiness' && <ReadinessPanel {...readinessProps} />}
        {activeTab === 'growth' && <GrowthPanel {...growthProps} />}
        {activeTab === 'resume' && <PortfolioTab />}

        {activeTab === 'overview' && (
        <>
        {/* Alerts - Compact on Mobile */}
        {error && (
          <div className="mb-3 sm:mb-4 md:mb-6 p-2.5 sm:p-3 md:p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs sm:text-sm md:text-base">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-3 sm:mb-4 md:mb-6 p-2.5 sm:p-3 md:p-4 bg-green-50 border border-green-200 rounded-lg text-green-700 text-xs sm:text-sm md:text-base">
            {success}
          </div>
        )}

        {/* Main Profile Card - Mobile Optimized */}
        <div className="bg-white border border-slate-700 rounded-xl sm:rounded-2xl overflow-hidden mb-3 sm:mb-4 md:mb-6 shadow-lg">
          {/* Profile Header Background - Responsive Height */}
          <div className="h-20 sm:h-24 md:h-32 bg-gradient-to-r from-amber-700 via-orange-700 to-purple-700"></div>

          {/* Profile Content - Better Mobile Padding */}
          <div className="relative px-3 sm:px-4 md:px-6 pb-4 sm:pb-5 md:pb-6 pt-0">
            {/* Avatar - Responsive Size */}
            <div className="flex flex-col gap-3 sm:gap-4 sm:flex-row sm:items-end sm:justify-between mb-4 sm:mb-5 md:mb-6 -mt-10 sm:-mt-12 md:-mt-16">
              <div className="flex items-end gap-2 sm:gap-3 md:gap-4">
                <div className="relative flex-shrink-0">
                  <div
                    onClick={handleAvatarClick}
                    className={`relative ${isEditing ? 'cursor-pointer' : ''}`}
                  >
                    {avatarUrl && !imageError ? (
                      <img
                        src={avatarUrl}
                        alt={getDisplayName()}
                        className="w-20 h-20 sm:w-24 sm:h-24 md:w-32 md:h-32 rounded-full object-cover ring-4 ring-slate-800 hover:ring-purple-500/50 transition-all"
                        onError={(e) => {
                          console.error('❌ Image failed to load:', avatarUrl, e);
                          setImageError(true);
                        }}
                        onLoad={() => console.log('✅ Image loaded successfully:', avatarUrl)}
                      />
                    ) : (
                      <div className="w-20 h-20 sm:w-24 sm:h-24 md:w-32 md:h-32 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center ring-4 ring-slate-800 text-white text-2xl sm:text-3xl md:text-4xl font-bold">
                        {profile?.first_name?.charAt(0) || ''}
                        {profile?.last_name?.charAt(0) || 'U'}
                      </div>
                    )}
                    {isEditing && (
                      <div className="absolute bottom-0 right-0 bg-purple-600 rounded-full p-1 sm:p-1.5 md:p-2 hover:bg-purple-700 transition-colors">
                        <Upload className="w-3.5 h-3.5 sm:w-4 sm:h-4 md:w-5 md:h-5 text-white" />
                      </div>
                    )}
                  </div>
                  
                  {/* Status Upload Button - Responsive Size */}
                  <button
                    onClick={() => setShowStatusUploader(true)}
                    className="absolute -bottom-1 -right-1 sm:-bottom-2 sm:-right-2 bg-gradient-to-r from-purple-600 to-pink-600 rounded-full p-1.5 sm:p-2 md:p-2.5 hover:from-purple-700 hover:to-pink-700 transition-all shadow-lg text-white"
                    title="Add status"
                  >
                    <Plus className="w-3 h-3 sm:w-3.5 sm:h-3.5 md:w-4 md:h-4" />
                  </button>
                </div>

                <div className="min-w-0 flex-1">
                  {isEditing ? (
                    <input
                      type="text"
                      name="full_name"
                      placeholder="Full name"
                      value={formData.full_name}
                      onChange={handleInputChange}
                      className="w-full px-2 sm:px-3 py-1 sm:py-1.5 bg-white border border-slate-300 rounded-lg text-white placeholder-slate-400 text-sm sm:text-base"
                    />
                  ) : (
                    <div>
                      <h2 className="text-lg sm:text-xl md:text-2xl font-bold text-white break-words">{getDisplayName()}</h2>
                      <p className="text-slate-500 text-xs sm:text-sm break-all">{user?.email}</p>
                    </div>
                  )}
                </div>
              </div>

              <div />
            </div>

            {/* Verification + Completion - Mobile Responsive */}
            <div className="flex flex-wrap items-center gap-2 mb-4 sm:mb-5 md:mb-6">
              {profile?.blockchain_verified && (
                <div className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 sm:py-2 bg-green-100 text-green-700 rounded-lg inline-flex w-fit">
                  <Shield className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  <span className="text-xs sm:text-sm font-medium">Blockchain Verified</span>
                </div>
              )}
              <div className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 sm:py-2 bg-indigo-100 text-indigo-700 rounded-lg border border-indigo-200">
                <User className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                <span className="text-xs sm:text-sm font-medium">Profile completion: {profileCompletionPercent}%</span>
              </div>
            </div>

            {/* Profile Details Grid - Mobile Optimized */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              {/* Email */}
              <div className="flex items-center gap-2 sm:gap-3 p-2 sm:p-2.5 md:p-3 bg-slate-800 rounded-lg border border-slate-700">
                <Mail className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] sm:text-xs text-slate-600">Email</p>
                  <p className="text-white text-xs sm:text-sm md:text-base break-all">{user?.email}</p>
                </div>
              </div>

              {/* Phone */}
              <div className="flex items-center gap-2 sm:gap-3 p-2 sm:p-2.5 md:p-3 bg-slate-800 rounded-lg border border-slate-700">
                <Phone className="w-4 h-4 sm:w-5 sm:h-5 text-indigo-600 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] sm:text-xs text-slate-600">Phone</p>
                  {isEditing ? (
                    <input
                      type="tel"
                      name="phone"
                      placeholder="Add phone number"
                      value={formData.phone}
                      onChange={handleInputChange}
                      className="w-full px-2 py-1 bg-white border border-slate-300 rounded text-white placeholder-slate-400 text-xs sm:text-sm"
                    />
                  ) : (
                    <p className="text-white text-xs sm:text-sm md:text-base">{formData.phone || 'Not provided'}</p>
                  )}
                </div>
              </div>

              {/* Income Level */}
              <div className="flex items-center gap-2 sm:gap-3 p-2 sm:p-2.5 md:p-3 bg-slate-800 rounded-lg border border-slate-700">
                <Wallet className="w-4 h-4 sm:w-5 sm:h-5 text-green-600 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] sm:text-xs text-slate-600">Income Level</p>
                  {isEditing ? (
                    <select
                      name="income_level"
                      value={formData.income_level}
                      onChange={handleInputChange}
                      className="w-full px-2 py-1 bg-white border border-slate-300 rounded text-white text-xs sm:text-sm"
                    >
                      <option value="">Select income level</option>
                      <option value="low">Low (&lt; 500k UGX/month)</option>
                      <option value="medium">Medium (500k - 2M UGX/month)</option>
                      <option value="high">High (2M - 5M UGX/month)</option>
                      <option value="very_high">Very High (&gt; 5M UGX/month)</option>
                    </select>
                  ) : (
                    <p className="text-white text-xs sm:text-sm md:text-base">{formData.income_level ? toTitleCase(formData.income_level) : 'Not provided'}</p>
                  )}
                </div>
              </div>

              {/* Financial Goal */}
              <div className="flex items-start gap-2 sm:gap-3 p-2 sm:p-2.5 md:p-3 bg-slate-800 rounded-lg border border-slate-700">
                <Key className="w-4 h-4 sm:w-5 sm:h-5 text-orange-600 mt-0.5 sm:mt-1 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] sm:text-xs text-slate-600">Primary Financial Goal</p>
                  {isEditing ? (
                    <select
                      name="financial_goal"
                      value={formData.financial_goal}
                      onChange={handleInputChange}
                      className="w-full px-2 py-1 bg-white border border-slate-300 rounded text-white text-xs sm:text-sm"
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
                    <p className="text-white text-xs sm:text-sm md:text-base">{formData.financial_goal ? toTitleCase(formData.financial_goal) : 'Not provided'}</p>
                  )}
                </div>
              </div>

              {/* Risk Tolerance */}
              <div className="flex items-center gap-2 sm:gap-3 p-2 sm:p-2.5 md:p-3 bg-slate-800 rounded-lg border border-slate-700 sm:col-span-2">
                <Shield className="w-4 h-4 sm:w-5 sm:h-5 text-indigo-600 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] sm:text-xs text-slate-600">Risk Tolerance</p>
                  {isEditing ? (
                    <select
                      name="risk_tolerance"
                      value={formData.risk_tolerance}
                      onChange={handleInputChange}
                      className="w-full px-2 py-1 bg-white border border-slate-300 rounded text-white text-xs sm:text-sm"
                    >
                      <option value="low">Conservative (Low Risk)</option>
                      <option value="medium">Moderate (Medium Risk)</option>
                      <option value="high">Aggressive (High Risk)</option>
                    </select>
                  ) : (
                    <span className={`inline-flex items-center px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-full border text-xs sm:text-sm ${riskToneClass}`}>
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

        {/* Account Info + Actions - Mobile Optimized */}
        <div className="mt-4 sm:mt-5 md:mt-6 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 sm:gap-3 items-stretch">
          <div className="p-2.5 sm:p-3 md:p-4 bg-white border border-slate-700 rounded-lg text-left">
            <p className="text-[10px] sm:text-xs md:text-sm text-slate-600">
              Account ID: <span className="font-mono text-slate-700 break-all text-[10px] sm:text-xs">{user?.id}</span>
            </p>
            <p className="text-[10px] sm:text-xs text-slate-500 mt-1 sm:mt-2">
              Member since {new Date(user?.created_at).toLocaleDateString()}
            </p>
          </div>
          
          {/* Edit/Save Buttons - Mobile First */}
          <div className="flex gap-2">
            {!isEditing ? (
              <button
                onClick={() => setIsEditing(true)}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 sm:px-5 py-2.5 sm:py-3 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 border border-purple-600 text-white rounded-lg font-medium transition-colors text-sm sm:text-base"
              >
                <Edit2 className="w-4 h-4 sm:w-5 sm:h-5" />
                <span>Edit Profile</span>
              </button>
            ) : (
              <>
                <button
                  onClick={() => setIsEditing(false)}
                  className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-3 sm:px-4 py-2.5 sm:py-3 bg-slate-200 hover:bg-slate-300 border border-slate-300 text-slate-700 rounded-lg font-medium transition-colors text-sm sm:text-base"
                >
                  <X className="w-4 h-4 sm:w-5 sm:h-5" />
                  <span>Cancel</span>
                </button>
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-3 sm:px-4 py-2.5 sm:py-3 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 border border-green-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50 text-sm sm:text-base"
                >
                  <Save className="w-4 h-4 sm:w-5 sm:h-5" />
                  <span>{isSaving ? 'Saving...' : 'Save'}</span>
                </button>
              </>
            )}
          </div>
          
          {/* Logout Button - Full Width on Mobile */}
          <button
            onClick={handleLogout}
            disabled={isLoggingOut}
            className="sm:col-span-2 w-full flex items-center justify-center gap-2 px-4 sm:px-5 py-2.5 sm:py-3 bg-red-600 hover:bg-red-700 border border-red-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50 text-sm sm:text-base"
          >
            <LogOut className="w-4 h-4 sm:w-5 sm:h-5" />
            <span>{isLoggingOut ? 'Signing out...' : 'Sign Out'}</span>
          </button>
        </div>

        {/* Avatar Change Modal - Mobile Optimized */}
        {showAvatarModal && (
          <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
            <div className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl p-4 sm:p-6 max-h-[85vh] overflow-y-auto animate-in slide-in-from-bottom sm:slide-in-from-bottom-0">
              {/* Header */}
              <div className="flex items-center justify-between mb-4 sm:mb-6">
                <h2 className="text-lg sm:text-xl md:text-2xl font-bold text-white">Change Profile Picture</h2>
                <button
                  onClick={() => setShowAvatarModal(false)}
                  className="p-1.5 sm:p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-800 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5 sm:w-6 sm:h-6" />
                </button>
              </div>

              {/* Preview Section - Responsive */}
              <div className="mb-4 sm:mb-6">
                {previewUrl ? (
                  <div>
                    <p className="text-xs text-slate-600 text-center mb-2">Preview</p>
                    <div className="flex justify-center">
                      <img
                        src={previewUrl}
                        alt="Preview"
                        className="w-20 h-20 sm:w-24 sm:h-24 md:w-32 md:h-32 rounded-full object-cover ring-4 ring-green-500/50"
                      />
                    </div>
                  </div>
                ) : (
                  <div>
                    <p className="text-xs text-slate-600 text-center mb-2">Current Avatar</p>
                    <div className="flex justify-center">
                      <div className="relative">
                        {avatarUrl && !imageError ? (
                          <img
                            src={avatarUrl}
                            alt={getDisplayName()}
                            className="w-20 h-20 sm:w-24 sm:h-24 rounded-full object-cover ring-4 ring-purple-500/50"
                          />
                        ) : (
                          <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center ring-4 ring-purple-500/50 text-white text-2xl sm:text-3xl font-bold">
                            {profile?.first_name?.charAt(0) || ''}
                            {profile?.last_name?.charAt(0) || 'U'}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Upload Options - Mobile Friendly */}
              <div className="space-y-2 sm:space-y-3">
                {/* Upload Photo Button */}
                <button
                  onClick={triggerFileInput}
                  disabled={isUploadingAvatar}
                  className="w-full flex items-center justify-center gap-2 sm:gap-3 px-4 py-2.5 sm:py-3 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:from-purple-600/50 disabled:to-pink-600/50 text-white rounded-lg font-medium transition-all text-sm sm:text-base"
                >
                  <Upload className="w-4 h-4 sm:w-5 sm:h-5" />
                  <span>{isUploadingAvatar ? 'Uploading...' : 'Upload Photo'}</span>
                </button>

                {/* Take Photo Button (Placeholder) */}
                <button
                  className="w-full flex items-center justify-center gap-2 sm:gap-3 px-4 py-2.5 sm:py-3 bg-slate-800 hover:bg-slate-200 border border-slate-300 text-slate-700 rounded-lg font-medium transition-all text-sm sm:text-base"
                >
                  <Camera className="w-4 h-4 sm:w-5 sm:h-5" />
                  <span>Take Photo</span>
                </button>

                {/* Remove Photo Button */}
                <button
                  className="w-full flex items-center justify-center gap-2 sm:gap-3 px-4 py-2.5 sm:py-3 bg-red-50 hover:bg-red-100 border border-red-200 text-red-600 rounded-lg font-medium transition-all text-sm sm:text-base"
                >
                  <Trash2 className="w-4 h-4 sm:w-5 sm:h-5" />
                  <span>Remove Photo</span>
                </button>

                {/* Info Text */}
                <p className="text-[10px] sm:text-xs text-slate-600 text-center mt-3 sm:mt-4 px-2">
                  Recommended: Square image, at least 400x400 pixels, JPG or PNG format
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Avatar View Modal - Mobile Optimized */}
        {showAvatarView && (
          <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-3 sm:p-4">
            <div className="relative max-w-2xl w-full animate-in fade-in zoom-in-95">
              {/* Close Button */}
              <button
                onClick={() => setShowAvatarView(false)}
                className="absolute -top-8 sm:-top-10 md:-top-12 right-0 p-2 text-white hover:text-slate-200 transition-colors"
              >
                <X className="w-6 h-6 sm:w-7 sm:h-7 md:w-8 md:h-8" />
              </button>

              {/* Avatar Container */}
              <div className="flex flex-col items-center gap-3 sm:gap-4">
                {/* Main Avatar Display - Responsive */}
                <div className="rounded-2xl overflow-hidden shadow-2xl">
                  {avatarUrl && !imageError ? (
                    <img
                      src={avatarUrl}
                      alt={getDisplayName()}
                      className="w-64 h-64 sm:w-72 sm:h-72 md:w-96 md:h-96 object-cover"
                    />
                  ) : (
                    <div className="w-64 h-64 sm:w-72 sm:h-72 md:w-96 md:h-96 bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white text-5xl sm:text-6xl md:text-7xl font-bold">
                      {profile?.first_name?.charAt(0) || ''}
                      {profile?.last_name?.charAt(0) || 'U'}
                    </div>
                  )}
                </div>

                {/* Name Below Avatar */}
                <div className="text-center px-4">
                  <h2 className="text-xl sm:text-2xl md:text-3xl font-bold text-white break-words">{getDisplayName()}</h2>
                  <p className="text-slate-300 text-xs sm:text-sm mt-1 sm:mt-2 break-all">{user?.email}</p>
                </div>

                {/* Action Buttons - Stack on Small Mobile */}
                <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 mt-3 sm:mt-4 w-full sm:w-auto px-4 sm:px-0">
                  <button
                    onClick={() => {
                      setShowAvatarView(false);
                      setIsEditing(true);
                    }}
                    className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 sm:px-6 py-2.5 sm:py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors text-sm sm:text-base"
                  >
                    <Edit2 className="w-4 h-4" />
                    Edit Profile
                  </button>
                  <button
                    onClick={() => setShowAvatarView(false)}
                    className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 sm:px-6 py-2.5 sm:py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition-colors text-sm sm:text-base"
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
        </>
        )}
        </div>
      </div>
    </div>
  );
};

export default ProfilePage;


/**
 * ProfilePage Component
 * Full user profile view with editing capabilities
 * Privacy-first design with blockchain verification
 */

import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { User, Mail, Phone, Edit2, Save, X, Upload, Shield, Wallet, Key, LogOut, Plus } from 'lucide-react';
import { StatusUploader } from '../status/StatusUploader';

export const ProfilePage = ({ onClose = null, onLogout = null }) => {
  const { 
    user, 
    profile, 
    getDisplayName, 
    getAvatarUrl,
    updateProfile,
    uploadAvatar,
    signOut
  } = useAuth();

  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [imageError, setImageError] = useState(false);
  const [showStatusUploader, setShowStatusUploader] = useState(false);
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

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleAvatarClick = () => {
    if (isEditing) {
      fileInputRef.current?.click();
    }
  };

  const handleAvatarUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    try {
      await uploadAvatar(file);
      setSuccess('Avatar updated successfully!');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError('Failed to upload avatar: ' + err.message);
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

  const avatarUrl = getAvatarUrl();

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 p-4 md:p-8">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold text-white">My Profile</h1>
          {onClose && (
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
          )}
        </div>

        {/* Alerts */}
        {error && (
          <div className="mb-6 p-4 bg-red-500/20 border border-red-500/50 rounded-lg text-red-200">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-6 p-4 bg-green-500/20 border border-green-500/50 rounded-lg text-green-200">
            {success}
          </div>
        )}

        {/* Main Profile Card */}
        <div className="bg-slate-800/50 border border-slate-700 rounded-2xl overflow-hidden mb-6">
          {/* Profile Header Background */}
          <div className="h-32 bg-gradient-to-r from-purple-600/30 via-blue-600/20 to-pink-600/30"></div>

          {/* Profile Content */}
          <div className="relative px-6 pb-6 pt-0">
            {/* Avatar */}
            <div className="flex items-end justify-between mb-6 -mt-16">
              <div className="flex items-end gap-4">
                <div className="relative">
                  <div
                    onClick={handleAvatarClick}
                    className={`relative ${isEditing ? 'cursor-pointer' : ''}`}
                  >
                    {avatarUrl && !imageError ? (
                      <img
                        src={avatarUrl}
                        alt={getDisplayName()}
                        className="w-32 h-32 rounded-full object-cover ring-4 ring-slate-800 hover:ring-purple-500/50 transition-all"
                        onError={() => setImageError(true)}
                      />
                    ) : (
                      <div className="w-32 h-32 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center ring-4 ring-slate-800 text-white text-4xl font-bold">
                        {profile?.first_name?.charAt(0) || ''}
                        {profile?.last_name?.charAt(0) || 'U'}
                      </div>
                    )}
                    {isEditing && (
                      <div className="absolute bottom-0 right-0 bg-purple-600 rounded-full p-2 hover:bg-purple-700 transition-colors">
                        <Upload className="w-5 h-5 text-white" />
                      </div>
                    )}
                  </div>
                  
                  {/* Status Upload Button */}
                  <button
                    onClick={() => setShowStatusUploader(true)}
                    className="absolute -bottom-2 -right-2 bg-gradient-to-r from-purple-600 to-pink-600 rounded-full p-2.5 hover:from-purple-700 hover:to-pink-700 transition-all shadow-lg text-white"
                    title="Add status"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>

                <div>
                  {isEditing ? (
                    <input
                      type="text"
                      name="full_name"
                      placeholder="Full name"
                      value={formData.full_name}
                      onChange={handleInputChange}
                      className="w-full px-3 py-1 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-gray-400"
                    />
                  ) : (
                    <div>
                      <h2 className="text-2xl font-bold text-white">{getDisplayName()}</h2>
                      <p className="text-gray-400 text-sm">{user?.email}</p>
                    </div>
                  )}
                </div>
              </div>

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
                className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-600/50 text-white rounded-lg font-medium transition-colors"
              >
                {isEditing ? (
                  <>
                    <Save className="w-4 h-4" />
                    <span>{isSaving ? 'Saving...' : 'Save'}</span>
                  </>
                ) : (
                  <>
                    <Edit2 className="w-4 h-4" />
                    <span>Edit</span>
                  </>
                )}
              </button>
            </div>

            {/* Verification Status */}
            {profile?.blockchain_verified && (
              <div className="flex items-center gap-2 px-3 py-2 bg-green-500/20 text-green-400 rounded-lg inline-flex w-fit mb-6">
                <Shield className="w-4 h-4" />
                <span className="text-sm font-medium">Blockchain Verified</span>
              </div>
            )}

            {/* Profile Details */}
            <div className="space-y-4">
              {/* Email */}
              <div className="flex items-center gap-3 p-3 bg-slate-700/50 rounded-lg">
                <Mail className="w-5 h-5 text-purple-400" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-400">Email</p>
                  <p className="text-white truncate">{user?.email}</p>
                </div>
              </div>

              {/* Phone */}
              <div className="flex items-center gap-3 p-3 bg-slate-700/50 rounded-lg">
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
                    <p className="text-white">{formData.phone || 'Not provided'}</p>
                  )}
                </div>
              </div>

              {/* Income Level */}
              <div className="flex items-center gap-3 p-3 bg-slate-700/50 rounded-lg">
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
                    <p className="text-white">{formData.income_level || 'Not provided'}</p>
                  )}
                </div>
              </div>

              {/* Financial Goal */}
              <div className="flex items-start gap-3 p-3 bg-slate-700/50 rounded-lg">
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
                    <p className="text-white">{formData.financial_goal || 'Not provided'}</p>
                  )}
                </div>
              </div>

              {/* Risk Tolerance */}
              <div className="flex items-center gap-3 p-3 bg-slate-700/50 rounded-lg">
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
                    <p className="text-white capitalize">{formData.risk_tolerance || 'Not specified'}</p>
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

        {/* Account Actions */}
        <div className="space-y-3">
          <button
            onClick={handleLogout}
            disabled={isLoggingOut}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-red-600/20 hover:bg-red-600/30 border border-red-600/50 text-red-400 rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            <LogOut className="w-5 h-5" />
            <span>{isLoggingOut ? 'Signing out...' : 'Sign Out'}</span>
          </button>
        </div>

        {/* Additional Info */}
        <div className="mt-8 p-4 bg-slate-800/50 border border-slate-700 rounded-lg text-center">
          <p className="text-sm text-gray-400">
            Account ID: <span className="font-mono text-gray-300 break-all">{user?.id}</span>
          </p>
          <p className="text-xs text-gray-500 mt-2">
            Member since {new Date(user?.created_at).toLocaleDateString()}
          </p>
        </div>

        {/* Status Uploader Modal */}
        {showStatusUploader && (
          <StatusUploader
            onClose={() => setShowStatusUploader(false)}
            onStatusCreated={() => {
              setShowStatusUploader(false);
              // Optionally refresh statuses or show notification
            }}
          />
        )}
      </div>
    </div>
  );
};

export default ProfilePage;

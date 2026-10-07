/**
 * ProfilePage Component
 * Full user profile view with editing capabilities
 * Privacy-first design with blockchain verification
 */

import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import useResumeAndBusiness from '../../hooks/useResumeAndBusiness';
import { User, Mail, Phone, Edit2, Save, X, Upload, Shield, Wallet, Key, LogOut, Plus, Camera, Trash2, Clock, Bell, Settings as SettingsIcon, Briefcase, FileText, MapPin } from 'lucide-react';
import { StatusUploader } from '../status/StatusUploader';
import ShareholderApprovalsCenter from '../ShareholderApprovalsCenter';
import '../profile/growth/growth.css';

const SECTION_TABS = [
  { id: 'profile', label: 'Profile', Icon: User },
  { id: 'security', label: 'Security', Icon: Shield },
  { id: 'settings', label: 'Settings', Icon: SettingsIcon },
];

/**
 * `extraSections` ({ security: node, settings: node }) and `onSectionChange` turn the page into
 * Profile / Security / Settings tabs. Without them it renders exactly as before.
 */
export const ProfilePage = ({ onClose = null, onLogout = null, section = 'profile', onSectionChange = null, extraSections = null, onOpenResume = null }) => {
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
  const { resume, resumeLoaded, businesses, businessLoaded } = useResumeAndBusiness(user?.id);
  const [businessId, setBusinessId] = useState(null);
  const business = businesses.find((b) => b.id === businessId) || businesses[0] || null;

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

  return (
    <div className="icn-pg">
      <div className="p-3 sm:p-3 md:p-8 pb-[calc(7.5rem+env(safe-area-inset-bottom))] sm:pb-3 md:pb-8 pt-[calc(0.75rem+env(safe-area-inset-top))]">
        <div className="max-w-5xl mx-auto w-full">
          {/* Header - Mobile Optimized */}
          <div className="flex items-center justify-between mb-3 sm:mb-4">
            <div className="min-w-0 flex-1">
              <p className="icn-pg-eyebrow">Account</p>
              <h1 className="icn-pg-title text-2xl sm:text-3xl truncate">My Profile</h1>
              <p className="icn-pg-sub text-xs sm:text-sm mt-0.5 sm:mt-1 truncate">Manage your account, settings, and financial profile.</p>
            </div>
            {onClose && (
              <button
                onClick={onClose}
                className="icn-pg-closebtn p-1.5 sm:p-2 rounded-lg transition-colors flex-shrink-0 ml-2"
              >
                <X className="w-5 h-5 sm:w-6 sm:h-6" />
              </button>
            )}
          </div>

        {/* Alerts - Compact on Mobile */}
        {error && (
          <div className="icn-pg-alert-err mb-3 sm:mb-4 md:mb-6 p-3 text-sm">
            {error}
          </div>
        )}
        {success && (
          <div className="icn-pg-alert-ok mb-3 sm:mb-4 md:mb-6 p-3 text-sm">
            {success}
          </div>
        )}

        {/* Profile / Security / Settings */}
        {extraSections && onSectionChange && (
          <div className="gr" style={{ marginBottom: 12, padding: 0 }}>
            <div className="gr-tabs" role="tablist" aria-label="My profile sections"
              onKeyDown={(e) => {
                const i = SECTION_TABS.findIndex((t) => t.id === section);
                const next = e.key === 'ArrowRight' ? SECTION_TABS[(i + 1) % SECTION_TABS.length]
                  : e.key === 'ArrowLeft' ? SECTION_TABS[(i + SECTION_TABS.length - 1) % SECTION_TABS.length] : null;
                if (next) { e.preventDefault(); onSectionChange(next.id); document.getElementById(`pf-tab-${next.id}`)?.focus(); }
              }}>
              {SECTION_TABS.map(({ id, label, Icon }) => (
                <button key={id} id={`pf-tab-${id}`} type="button" role="tab" className="gr-tab" aria-selected={section === id}
                  tabIndex={section === id ? 0 : -1} onClick={() => onSectionChange(id)}>
                  <Icon aria-hidden="true" />{label}
                </button>
              ))}
            </div>
          </div>
        )}

        {extraSections && section !== 'profile' && extraSections[section]}

        {(section === 'profile' || !extraSections) && (<>
        {/* Identity: sits directly on the page, no banner card */}
        <div className="flex items-center gap-4 mb-2">
          <div className="relative flex-shrink-0">
            <div onClick={handleAvatarClick} className={`relative ${isEditing ? 'cursor-pointer' : ''}`}>
              {avatarUrl && !imageError ? (
                <img
                  src={avatarUrl}
                  alt={getDisplayName()}
                  className="w-20 h-20 sm:w-24 sm:h-24 rounded-full object-cover icn-pg-avatar"
                  onError={() => setImageError(true)}
                />
              ) : (
                <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full icn-pg-monogram flex items-center justify-center icn-pg-avatar text-2xl sm:text-3xl font-bold">
                  {profile?.first_name?.charAt(0) || ''}
                  {profile?.last_name?.charAt(0) || 'U'}
                </div>
              )}
              {isEditing && (
                <div className="absolute bottom-0 right-0 icn-pg-btn-primary rounded-full p-1.5">
                  <Upload className="w-3.5 h-3.5 text-white" />
                </div>
              )}
            </div>
            <button
              onClick={() => setShowStatusUploader(true)}
              className="absolute -bottom-1 -right-1 icn-pg-btn-primary rounded-full p-1.5"
              title="Add status"
            >
              <Plus className="w-3.5 h-3.5" />
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
                className="icn-pg-input w-full px-3 py-2 text-sm sm:text-base"
              />
            ) : (
              <>
                <h2 className="icn-pg-title text-xl sm:text-2xl break-words">{getDisplayName()}</h2>
                <p className="icn-pg-sub text-xs sm:text-sm break-all">{user?.email}</p>
                {resume?.headline && <p className="icn-pg-value text-sm mt-0.5">{resume.headline}</p>}
              </>
            )}
            <div className="flex flex-wrap items-center gap-2 mt-2">
              {profile?.blockchain_verified && (
                <span className="icn-pg-chip icn-pg-chip-ok px-2.5 py-1 text-xs font-medium"><Shield className="w-3.5 h-3.5" />Verified</span>
              )}
              <span className="icn-pg-chip px-2.5 py-1 text-xs font-medium">{profileCompletionPercent}% complete</span>
            </div>
          </div>
          {!isEditing && (
            <button onClick={() => setIsEditing(true)} className="icn-pg-btn icn-pg-btn-ghost px-3 py-2 text-sm self-start" title="Edit profile">
              <Edit2 className="w-4 h-4" /><span className="hidden sm:inline">Edit</span>
            </button>
          )}
        </div>

        {isEditing && (
          <div className="flex gap-2 justify-end mb-2">
            <button onClick={() => setIsEditing(false)} className="icn-pg-btn icn-pg-btn-ghost px-4 py-2 text-sm"><X className="w-4 h-4" />Cancel</button>
            <button onClick={handleSave} disabled={isSaving} className="icn-pg-btn icn-pg-btn-primary px-4 py-2 text-sm"><Save className="w-4 h-4" />{isSaving ? 'Saving...' : 'Save'}</button>
          </div>
        )}

        {/* Personal: ICAN profile fields, with a one-tap fill from the resume */}
        <details className="icn-pg-sec" open>
          <summary><User className="w-4 h-4 icn-pg-icon" />Personal{resume && <span className="icn-pg-sec-note">linked to your resume</span>}</summary>
          <div className="icn-pg-sec-body">
            <div className="icn-pg-line">
              <Mail className="w-4 h-4 icn-pg-icon mt-1 flex-shrink-0" />
              <div className="min-w-0 flex-1"><p className="icn-pg-label">Email</p><p className="icn-pg-value text-sm break-all">{user?.email}</p></div>
            </div>
            <div className="icn-pg-line">
              <Phone className="w-4 h-4 icn-pg-icon mt-1 flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="icn-pg-label">Phone</p>
                {isEditing ? (
                  <div className="flex gap-2 items-center">
                    <input type="tel" name="phone" placeholder="Add phone number" value={formData.phone} onChange={handleInputChange} className="icn-pg-input w-full px-2.5 py-1.5 text-sm" />
                    {resume?.phone && resume.phone !== formData.phone && (
                      <button type="button" className="icn-pg-link whitespace-nowrap" onClick={() => setFormData((p) => ({ ...p, phone: resume.phone }))}>Use resume</button>
                    )}
                  </div>
                ) : (
                  <p className="icn-pg-value text-sm">{formData.phone || resume?.phone || 'Not provided'}</p>
                )}
              </div>
            </div>
            {resume?.location && (
              <div className="icn-pg-line">
                <MapPin className="w-4 h-4 icn-pg-icon mt-1 flex-shrink-0" />
                <div className="min-w-0 flex-1"><p className="icn-pg-label">Location</p><p className="icn-pg-value text-sm">{resume.location}</p></div>
              </div>
            )}
            <div className="icn-pg-line">
              <Wallet className="w-4 h-4 icn-pg-icon mt-1 flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="icn-pg-label">Income level</p>
                {isEditing ? (
                  <select name="income_level" value={formData.income_level} onChange={handleInputChange} className="icn-pg-input w-full px-2.5 py-1.5 text-sm">
                    <option value="">Select income level</option>
                    <option value="low">Low (&lt; 500k UGX/month)</option>
                    <option value="medium">Medium (500k - 2M UGX/month)</option>
                    <option value="high">High (2M - 5M UGX/month)</option>
                    <option value="very_high">Very High (&gt; 5M UGX/month)</option>
                  </select>
                ) : (
                  <p className="icn-pg-value text-sm">{formData.income_level ? toTitleCase(formData.income_level) : 'Not provided'}</p>
                )}
              </div>
            </div>
            <div className="icn-pg-line">
              <Key className="w-4 h-4 icn-pg-icon mt-1 flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="icn-pg-label">Primary financial goal</p>
                {isEditing ? (
                  <select name="financial_goal" value={formData.financial_goal} onChange={handleInputChange} className="icn-pg-input w-full px-2.5 py-1.5 text-sm">
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
                  <p className="icn-pg-value text-sm">{formData.financial_goal ? toTitleCase(formData.financial_goal) : 'Not provided'}</p>
                )}
              </div>
            </div>
            <div className="icn-pg-line">
              <Shield className="w-4 h-4 icn-pg-icon mt-1 flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="icn-pg-label">Risk tolerance</p>
                {isEditing ? (
                  <select name="risk_tolerance" value={formData.risk_tolerance} onChange={handleInputChange} className="icn-pg-input w-full px-2.5 py-1.5 text-sm">
                    <option value="low">Conservative (Low Risk)</option>
                    <option value="medium">Moderate (Medium Risk)</option>
                    <option value="high">Aggressive (High Risk)</option>
                  </select>
                ) : (
                  <p className="icn-pg-value text-sm">{toTitleCase(formData.risk_tolerance || 'Not specified')}</p>
                )}
              </div>
            </div>
          </div>
        </details>

        {/* Resume summary, read from My Resume */}
        <details className="icn-pg-sec" open={!!(resume?.summary || resume?.skills?.length)}>
          <summary><FileText className="w-4 h-4 icn-pg-icon" />My resume{resume && <span className="icn-pg-sec-note">{resume.skills?.length || 0} skills</span>}</summary>
          <div className="icn-pg-sec-body">
            {!resumeLoaded ? (
              <p className="icn-pg-sub text-sm">Loading…</p>
            ) : resume ? (
              <>
                {resume.headline && <p className="icn-pg-value text-sm font-semibold">{resume.headline}</p>}
                {resume.summary && <p className="icn-pg-sub text-sm mt-1 whitespace-pre-line">{resume.summary}</p>}
                {resume.skills?.length > 0 && <div className="mt-3">{resume.skills.map((s) => <span key={s} className="icn-pg-skill">{s}</span>)}</div>}
              </>
            ) : (
              <p className="icn-pg-sub text-sm">No resume yet. Add one and your details appear here.</p>
            )}
            {onOpenResume && <button type="button" className="icn-pg-link mt-2" onClick={onOpenResume}>{resume ? 'Edit my resume' : 'Create my resume'}</button>}
          </div>
        </details>

        {/* Business, read from the Pitchin business profile */}
        <details className="icn-pg-sec" open={businesses.length > 0}>
          <summary><Briefcase className="w-4 h-4 icn-pg-icon" />Business{businesses.length > 0 && <span className="icn-pg-sec-note">from Pitchin</span>}</summary>
          <div className="icn-pg-sec-body">
            {!businessLoaded ? (
              <p className="icn-pg-sub text-sm">Loading…</p>
            ) : business ? (
              <>
                {businesses.length > 1 && (
                  <select value={business.id} onChange={(e) => setBusinessId(e.target.value)} className="icn-pg-input w-full px-2.5 py-1.5 text-sm mb-2">
                    {businesses.map((b) => <option key={b.id} value={b.id}>{b.business_name}</option>)}
                  </select>
                )}
                {[
                  ['Business', business.business_name],
                  ['Type', business.business_type && toTitleCase(business.business_type)],
                  ['Address', [business.business_address, business.country].filter(Boolean).join(', ')],
                  ['Website', business.website],
                  ['Registration no.', business.registration_number],
                  ['Founded', business.founded_year],
                  ['Status', business.verification_status && toTitleCase(business.verification_status)],
                ].filter(([, v]) => v).map(([label, v]) => (
                  <div key={label} className="icn-pg-line">
                    <div className="min-w-0 flex-1"><p className="icn-pg-label">{label}</p><p className="icn-pg-value text-sm break-words">{v}</p></div>
                  </div>
                ))}
                {business.description && <p className="icn-pg-sub text-sm mt-1 whitespace-pre-line">{business.description}</p>}
              </>
            ) : (
              <p className="icn-pg-sub text-sm">No business profile yet. Create one in Pitchin and it shows up here.</p>
            )}
          </div>
        </details>

        {/* Account: rarely needed, collapsed */}
        <details className="icn-pg-sec">
          <summary><Shield className="w-4 h-4 icn-pg-icon" />Account</summary>
          <div className="icn-pg-sec-body">
            <p className="icn-pg-label" style={{ textTransform: 'none', letterSpacing: 'normal' }}>
              Account ID: <span className="icn-pg-value font-mono break-all text-[11px]">{user?.id}</span>
            </p>
            <p className="icn-pg-sub text-xs mt-1">Member since {new Date(user?.created_at).toLocaleDateString()}</p>
            <button onClick={handleLogout} disabled={isLoggingOut} className="icn-pg-btn icn-pg-btn-danger px-0 py-2 text-sm mt-2">
              <LogOut className="w-4 h-4" /><span>{isLoggingOut ? 'Signing out...' : 'Sign out'}</span>
            </button>
          </div>
        </details>

        <input ref={fileInputRef} type="file" accept="image/*" onChange={handleAvatarUpload} className="hidden" />
        </>)}

        {/* Avatar Change Modal - Mobile Optimized */}
        {showAvatarModal && (
          <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
            <div className="icn-pg-sheet w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-4 sm:p-6 max-h-[85vh] overflow-y-auto animate-in slide-in-from-bottom sm:slide-in-from-bottom-0">
              {/* Header */}
              <div className="flex items-center justify-between mb-4 sm:mb-6">
                <h2 className="icn-pg-title text-xl">Change Profile Picture</h2>
                <button
                  onClick={() => setShowAvatarModal(false)}
                  className="icn-pg-closebtn p-1.5 sm:p-2 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5 sm:w-6 sm:h-6" />
                </button>
              </div>

              {/* Preview Section - Responsive */}
              <div className="mb-4 sm:mb-6">
                {previewUrl ? (
                  <div>
                    <p className="icn-pg-label text-center mb-2">Preview</p>
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
                    <p className="icn-pg-label text-center mb-2">Current Avatar</p>
                    <div className="flex justify-center">
                      <div className="relative">
                        {avatarUrl && !imageError ? (
                          <img
                            src={avatarUrl}
                            alt={getDisplayName()}
                            className="w-20 h-20 sm:w-24 sm:h-24 rounded-full object-cover icn-pg-avatar"
                          />
                        ) : (
                          <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full icn-pg-monogram flex items-center justify-center icn-pg-avatar text-2xl sm:text-3xl font-bold">
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
                  className="icn-pg-btn icn-pg-btn-primary w-full px-4 py-3 text-sm sm:text-base"
                >
                  <Upload className="w-4 h-4 sm:w-5 sm:h-5" />
                  <span>{isUploadingAvatar ? 'Uploading...' : 'Upload Photo'}</span>
                </button>

                {/* Take Photo Button (Placeholder) */}
                <button
                  className="icn-pg-btn icn-pg-btn-ghost w-full px-4 py-3 text-sm sm:text-base"
                >
                  <Camera className="w-4 h-4 sm:w-5 sm:h-5" />
                  <span>Take Photo</span>
                </button>

                {/* Remove Photo Button */}
                <button
                  className="icn-pg-btn icn-pg-btn-danger w-full px-4 py-3 text-sm sm:text-base"
                >
                  <Trash2 className="w-4 h-4 sm:w-5 sm:h-5" />
                  <span>Remove Photo</span>
                </button>

                {/* Info Text */}
                <p className="icn-pg-sub text-[11px] text-center mt-3 sm:mt-4 px-2">
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
                    className="icn-pg-btn icn-pg-btn-primary w-full sm:w-auto px-6 py-3 text-sm sm:text-base"
                  >
                    <Edit2 className="w-4 h-4" />
                    Edit Profile
                  </button>
                  <button
                    onClick={() => setShowAvatarView(false)}
                    className="icn-pg-btn w-full sm:w-auto px-6 py-3 text-sm sm:text-base text-white" style={{ border: "1px solid rgba(255,255,255,0.4)" }}
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
    </div>
  );
};

export default ProfilePage;


import React, { useState, useEffect } from 'react';
import { Building2, Users, Plus, X, Check, Edit2, Lock, Crown, UserCheck, Wallet, Clock, Trash2 } from 'lucide-react';
import ShareholderApprovalsCenter from './ShareholderApprovalsCenter';

const BusinessProfileSelector = ({ profiles, currentProfile, onSelectProfile, onCreateNew, onEdit, onDelete, currentUserId, currentUserEmail, onWalletClick }) => {
  const [showForm, setShowForm] = useState(false);
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState(0);
  const [showApprovalsModal, setShowApprovalsModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [profileToDelete, setProfileToDelete] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Load pending approvals count on component mount
  useEffect(() => {
    loadPendingApprovalsCount();
  }, []);

  const loadPendingApprovalsCount = async () => {
    try {
      const { getSupabase } = await import('../services/pitchingService');
      const supabase = getSupabase();

      // Get pending shareholder investment approvals (where read_at is null)
      const { data: pendingApprovals, error } = await supabase
        .from('shareholder_notifications')
        .select('id', { count: 'exact' })
        .is('read_at', null);

      if (!error && pendingApprovals) {
        setPendingApprovalsCount(pendingApprovals.length);
        console.log(`📊 Total pending approvals: ${pendingApprovals.length}`);
      }
    } catch (error) {
      console.error('Error loading pending approvals:', error);
    }
  };

  // Helper to check if user is the creator
  const isCreator = (profile) => profile.user_id === currentUserId;
  
  // Helper to check if user is a co-owner
  const isCoOwner = (profile, userEmail) => {
    const coOwners = profile.business_co_owners || profile.coOwners || [];
    return coOwners.some(co => (co.owner_email || co.email) === userEmail);
  };
  
  // Helper to check if user can view and access
  const canAccess = (profile, userEmail) => {
    return isCreator(profile) || isCoOwner(profile, userEmail);
  };
  
  // Helper to check if user can edit
  const canEdit = (profile, userEmail) => {
    return isCreator(profile) || profile.isCoOwned === false || isCoOwner(profile, userEmail);
  };

  // Handle profile selection with access control
  const handleSelectProfileWithAccessCheck = (profile) => {
    if (!canAccess(profile, currentUserEmail)) {
      alert('❌ Access Denied\n\nOnly business shareholders can view this profile.\n\nYou are not listed as a shareholder of ' + profile.business_name);
      console.warn('🔐 Access denied - user is not a shareholder or creator of:', profile.business_name);
      return;
    }
    // User has access - allow selection
    onSelectProfile(profile);
  };

  // Handle profile editing with access control
  const handleEditProfileWithAccessCheck = (profile) => {
    if (!canEdit(profile, currentUserEmail)) {
      alert('❌ Edit Denied\n\nOnly the profile creator or shareholders can edit this profile.');
      console.warn('🔐 Edit access denied for:', profile.business_name);
      return;
    }
    // User has edit permission - allow edit
    onEdit?.(profile);
  };

  const handleDeleteProfile = async () => {
    if (!profileToDelete) return;
    
    try {
      setIsDeleting(true);
      const { deleteBusinessProfile } = await import('../services/pitchingService');
      
      const result = await deleteBusinessProfile(profileToDelete.id);
      
      if (result.success) {
        console.log(`✅ Business profile "${profileToDelete.business_name}" deleted successfully`);
        alert(`✅ Business profile "${profileToDelete.business_name}" has been deleted successfully`);
        setShowDeleteConfirm(false);
        setProfileToDelete(null);
        
        // Refresh the page to reload profiles
        window.location.reload();
      } else {
        alert(`❌ Failed to delete profile: ${result.error}`);
      }
    } catch (error) {
      console.error('Error deleting business profile:', error);
      alert(`❌ Error: ${error.message}`);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-slate-700">
        {/* Header */}
        <div className="sticky top-0 bg-slate-900 border-b border-slate-700 p-6 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-white flex items-center gap-3">
            <Building2 className="w-6 h-6 text-blue-400" />
            Business Profiles
          </h2>
          <button
            onClick={onCreateNew}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition flex items-center gap-2 font-semibold"
          >
            <Plus className="w-5 h-5" />
            New Profile
          </button>
        </div>

        <div className="p-6">
          {profiles && profiles.length > 0 ? (
            <div className="space-y-4">
              {profiles.map((profile) => (
                <div
                  key={profile.id}
                  onClick={() => handleSelectProfileWithAccessCheck(profile)}
                  className={`p-6 rounded-lg border-2 cursor-pointer transition ${
                    currentProfile?.id === profile.id
                      ? 'bg-blue-900/30 border-blue-500 shadow-lg shadow-blue-500/20'
                      : 'bg-slate-700/50 border-slate-600 hover:bg-slate-700 hover:border-slate-500'
                  }`}
                  title={canAccess(profile, currentUserEmail) ? 'Click to open profile' : '❌ Not authorized - shareholders only'}
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="text-xl font-bold text-white">{profile.business_name || profile.businessName}</h3>
                        {currentProfile?.id === profile.id && (
                          <Check className="w-5 h-5 text-green-400" />
                        )}
                        {/* Show ownership status badge */}
                        {isCreator(profile) ? (
                          <span className="bg-yellow-600/30 text-yellow-400 px-2 py-0.5 rounded text-xs flex items-center gap-1">
                            <Crown className="w-3 h-3" /> Creator
                          </span>
                        ) : canAccess(profile, currentUserEmail) ? (
                          <span className="bg-purple-600/30 text-purple-400 px-2 py-0.5 rounded text-xs flex items-center gap-1">
                            <UserCheck className="w-3 h-3" /> Shareholder
                          </span>
                        ) : (
                          <span className="bg-red-600/30 text-red-400 px-2 py-0.5 rounded text-xs flex items-center gap-1">
                            <Lock className="w-3 h-3" /> Locked
                          </span>
                        )}
                      </div>
                      <p className="text-slate-400 text-sm">{profile.business_type || profile.businessType}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {/* Approval Tab Button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowApprovalsModal(true);
                        }}
                        className="relative flex items-center gap-2 px-3 py-2 bg-yellow-500 hover:bg-yellow-600 text-white transition rounded-lg font-semibold hover:shadow-lg shadow-yellow-500/20"
                        title="⏳ Pending Approvals - Shareholder votes"
                      >
                        <Clock className="w-4 h-4" />
                        <span className="text-sm">Approve</span>
                        {pendingApprovalsCount > 0 && (
                          <span className="absolute -top-2 -right-2 bg-red-600 text-white text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center">
                            {pendingApprovalsCount > 9 ? '9+' : pendingApprovalsCount}
                          </span>
                        )}
                      </button>

                      {/* Edit Button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEditProfileWithAccessCheck(profile);
                        }}
                        disabled={!canEdit(profile, currentUserEmail)}
                        className={`transition p-2 ${
                          canEdit(profile, currentUserEmail)
                            ? 'text-blue-400 hover:text-blue-300 cursor-pointer'
                            : 'text-slate-600 cursor-not-allowed'
                        }`}
                        title={isCreator(profile) ? "Edit profile" : canEdit(profile, currentUserEmail) ? "Edit as shareholder" : "❌ Not authorized to edit"}
                      >
                        <Edit2 className="w-5 h-5" />
                      </button>
                      
                      {/* Wallet Button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onWalletClick?.({ profileId: profile.id, profileName: profile.business_name || profile.businessName });
                        }}
                        className="text-emerald-400 hover:text-emerald-300 transition p-2"
                        title="View business wallet account"
                      >
                        <Wallet className="w-5 h-5" />
                      </button>

                      {/* Delete Button - Only for creator */}
                      {isCreator(profile) && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setProfileToDelete(profile);
                            setShowDeleteConfirm(true);
                          }}
                          className="text-red-400 hover:text-red-300 transition p-2"
                          title="Delete profile permanently"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 text-sm mb-4">
                    <div>
                      <p className="text-slate-400">Founded</p>
                      <p className="text-white font-semibold">{profile.founded_year || profile.foundedYear || 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-slate-400">Total Capital</p>
                      <p className="text-white font-semibold">${profile.total_capital || profile.totalCapital || 'N/A'}</p>
                    </div>
                  </div>

                  <div>
                    <p className="text-slate-400 text-sm mb-2 flex items-center gap-2">
                      <Users className="w-4 h-4" />
                      Shareholders ({(profile.business_co_owners || profile.coOwners)?.length || 0})
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {(profile.business_co_owners || profile.coOwners)?.slice(0, 3).map((owner, idx) => (
                        <div key={idx} className="bg-slate-800 px-3 py-1 rounded-full text-xs">
                          <span className="text-slate-300">{owner.owner_name || owner.name}</span>
                          <span className="text-blue-400 ml-1 font-semibold">{owner.ownership_share || owner.ownershipShare}%</span>
                        </div>
                      ))}
                      {(profile.business_co_owners || profile.coOwners)?.length > 3 && (
                        <div className="bg-slate-800 px-3 py-1 rounded-full text-xs text-slate-400">
                          +{(profile.business_co_owners || profile.coOwners).length - 3} more
                        </div>
                      )}
                    </div>
                  </div>

                  {profile.website && (
                    <p className="text-blue-400 text-xs mt-3 truncate">🔗 {profile.website}</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <Building2 className="w-16 h-16 text-slate-600 mx-auto mb-4" />
              <p className="text-slate-400 text-lg mb-4">No business profiles yet</p>
              <button
                onClick={onCreateNew}
                className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg transition flex items-center gap-2 font-semibold mx-auto"
              >
                <Plus className="w-5 h-5" />
                Create Your First Profile
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Pending Approvals - Investment & Member */}
      {showApprovalsModal && (
        <ShareholderApprovalsCenter
          businessProfileId={currentProfile?.id}
          currentUserId={currentUserId}
          currentUserEmail={currentUserEmail}
          onClose={() => setShowApprovalsModal(false)}
        />
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && profileToDelete && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur flex items-center justify-center z-[60] p-4">
          <div className="bg-slate-900 border border-red-600 rounded-xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <Trash2 className="w-6 h-6 text-red-500" />
              <h3 className="text-xl font-bold text-white">Delete Business Profile?</h3>
            </div>
            
            <p className="text-slate-300 mb-2">
              Are you sure you want to permanently delete <span className="font-semibold text-white">"{profileToDelete.business_name || profileToDelete.businessName}"</span>?
            </p>
            
            <div className="bg-red-900/20 border border-red-700 rounded-lg p-3 mb-6">
              <p className="text-red-300 text-sm">
                ⚠️ <strong>Warning:</strong> This action cannot be undone. All associated data will be deleted.
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setProfileToDelete(null);
                }}
                disabled={isDeleting}
                className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <X className="w-4 h-4 inline mr-2" />
                Cancel
              </button>
              <button
                onClick={handleDeleteProfile}
                disabled={isDeleting}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
              >
                {isDeleting ? (
                  <>
                    <span className="animate-spin inline-block mr-2">⏳</span>
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4 inline mr-2" />
                    Delete Permanently
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BusinessProfileSelector;

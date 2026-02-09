import React, { useState, useEffect } from 'react';
import { Building2, Edit2, Users, DollarSign, Globe, MapPin, Calendar, Wallet, AlertCircle, Bell, Clock, Trash2, X } from 'lucide-react';
import ApprovalNotificationCenter from './ApprovalNotificationCenter';
import ShareholderApprovalsCenter from './ShareholderApprovalsCenter';

const BusinessProfileCard = ({ profile, onEdit, onSelect, onNotification, currentUserId, currentUserEmail, isMember = false }) => {
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState(0);
  const [showApprovalsModal, setShowApprovalsModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  if (!profile) return null;

  console.log('BusinessProfileCard rendered with isMember:', isMember, 'currentUserId:', currentUserId, 'profileId:', profile.id);
  console.log('🔐 Owner check - profile.user_id:', profile.user_id, 'currentUserId:', currentUserId);
  console.log('🔐 Email check - profile.owner_email:', profile.owner_email, 'currentUserEmail:', currentUserEmail);

  const coOwnersCount = profile.business_co_owners?.length || 0;
  
  // Check if current user is the profile owner (by user_id or email)
  const isOwner = profile.user_id === currentUserId || profile.owner_email === currentUserEmail;
  console.log('🔐 Is Owner?', isOwner);

  // Check if current user is a shareholder (co-owner)
  const isShareholder = profile.business_co_owners?.some(
    co => (co.owner_id === currentUserId || co.owner_email === currentUserEmail || co.email === currentUserEmail)
  ) || isOwner;
  console.log('🔐 Is Shareholder?', isShareholder, 'Business:', profile.business_name, 'Current email:', currentUserEmail);

  // Handle access control for opening the profile
  const handleSelectWithAccessCheck = () => {
    if (!isShareholder && !isOwner) {
      // Not a shareholder - deny access
      alert('❌ Access Denied\n\nOnly business shareholders can view this profile.\n\nYou are not listed as a shareholder of ' + profile.business_name);
      console.warn('🔐 Access denied - user is not a shareholder or owner');
      return;
    }
    // User is a shareholder or owner - allow access
    if (onSelect) {
      onSelect();
    }
  };

  // Load pending approvals count on component mount
  useEffect(() => {
    if (isMember && profile.id) {
      loadPendingApprovalsCount();
    }
  }, [profile.id, isMember]);

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
        console.log(`📊 Pending approvals for ${profile.business_name}: ${pendingApprovals.length}`);
      }
    } catch (error) {
      console.error('Error loading pending approvals:', error);
    }
  };

  const handleDeleteProfile = async () => {
    try {
      setIsDeleting(true);
      const { deleteBusinessProfile } = await import('../services/pitchingService');
      
      const result = await deleteBusinessProfile(profile.id);
      
      if (result.success) {
        console.log(`✅ Business profile "${profile.business_name}" deleted successfully`);
        alert(`✅ Business profile "${profile.business_name}" has been deleted successfully`);
        
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
      setShowDeleteConfirm(false);
    }
  };

  return (
    <div className={`bg-gradient-to-br from-slate-800 to-slate-900 border-2 rounded-xl p-5 transition cursor-pointer group relative ${
      isShareholder || isOwner 
        ? 'border-slate-700 hover:border-blue-500' 
        : 'border-red-700/50 hover:border-red-600 opacity-75'
    }`} 
      onClick={handleSelectWithAccessCheck}
      title={isShareholder || isOwner ? 'Click to open profile' : '❌ Not authorized - shareholders only'}
    >
      {/* Access locked overlay */}
      {!(isShareholder || isOwner) && (
        <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-red-900/20 to-transparent pointer-events-none flex items-center justify-center">
          <div className="bg-red-600/30 border border-red-500/50 rounded px-3 py-1 text-xs text-red-300 font-semibold flex items-center gap-2">
            <Lock className="w-3 h-3" /> Shareholders Only
          </div>
        </div>
      )}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-start gap-3 flex-1">
          <div className="bg-gradient-to-br from-blue-500 to-cyan-500 p-3 rounded-lg">
            <Building2 className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1">
            <h3 className="text-white font-bold text-lg group-hover:text-blue-400 transition">{profile.business_name}</h3>
            <p className="text-slate-400 text-sm">{profile.business_type}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Approval Tab Button - Always show for members */}
          {isMember && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowApprovalsModal(true);
              }}
              className="relative flex items-center gap-2 px-3 py-2 bg-yellow-500 hover:bg-yellow-600 text-white transition rounded-lg font-semibold hover:shadow-lg shadow-yellow-500/20 flex-shrink-0"
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
          )}

          {/* Notification Settings Icon */}
          {isMember && (
            <div
              className="bg-blue-600 hover:bg-blue-700 text-white p-2 rounded-lg transition cursor-help group/notif relative flex-shrink-0"
              title="🔔 Notification Settings"
            >
              <Bell className="w-5 h-5" />
              {/* Notification Settings Tooltip */}
              <div className="hidden group-hover/notif:block absolute right-0 top-full mt-2 bg-slate-900 border border-slate-700 rounded-lg p-3 w-56 z-50 text-xs text-white shadow-lg">
                <p className="font-semibold mb-2 text-blue-300">📢 Notification Settings</p>
                <div className="space-y-1 text-slate-300">
                  <div className="flex items-center gap-2">
                    <span>{profile.notify_on_share_purchase ? '✓' : '✗'}</span>
                    <span>Share Purchases</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span>{profile.notify_on_partner_investment ? '✓' : '✗'}</span>
                    <span>Partner Investments</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span>{profile.notify_on_support ? '✓' : '✗'}</span>
                    <span>Support Contributions</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span>{profile.notify_on_investment_signed ? '✓' : '✗'}</span>
                    <span>Investment Signed</span>
                  </div>
                  <div className="border-t border-slate-700 pt-1 mt-1">
                    <p className="text-slate-500 text-xs font-semibold mb-1">Notification Level:</p>
                    <p className="text-blue-300">{profile.shareholder_notification_level?.toUpperCase() || 'ALL'}</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Edit Button - Available to all members */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEdit?.();
            }}
            className="bg-slate-700 hover:bg-slate-600 text-white p-2 rounded-lg transition relative group/edit"
            title="Edit Profile"
          >
            <Edit2 className="w-5 h-5" />
            {/* Tooltip for edit access */}
            <div className="hidden group-hover/edit:block absolute right-0 top-full mt-2 bg-slate-900 border border-slate-700 rounded-lg p-2 w-48 z-50 text-xs text-white shadow-lg">
              <p className="font-semibold text-slate-300 mb-1">📝 Edit Profile</p>
              <p className="text-slate-400">Changes require shareholder approval</p>
            </div>
          </button>

          {/* Delete Button - Available to owner only */}
          {isOwner && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowDeleteConfirm(true);
              }}
              className="bg-red-600 hover:bg-red-700 text-white p-2 rounded-lg transition relative group/delete"
              title="Delete Profile"
            >
              <Trash2 className="w-5 h-5" />
              {/* Tooltip */}
              <div className="hidden group-hover/delete:block absolute right-0 top-full mt-2 bg-slate-900 border border-slate-700 rounded-lg p-2 w-48 z-50 text-xs text-white shadow-lg">
                <p className="font-semibold text-red-300 mb-1">🗑️ Delete Profile</p>
                <p className="text-slate-400">Permanently delete this business profile</p>
              </div>
            </button>
          )}

          {/* Wallet Icon */}
          <button
            onClick={(e) => {
              e.stopPropagation();
            }}
            className="bg-green-600 hover:bg-green-700 text-white p-2 rounded-lg transition relative group/wallet"
            title="Business Wallet"
          >
            <Wallet className="w-5 h-5" />
            {/* Tooltip */}
            <div className="hidden group-hover/wallet:block absolute right-0 top-full mt-2 bg-slate-900 border border-slate-700 rounded-lg p-2 w-48 z-50 text-xs text-white shadow-lg">
              <p className="font-semibold text-green-300 mb-1">💳 Business Wallet</p>
              <p className="text-slate-400">View wallet account details</p>
            </div>
          </button>
        </div>
      </div>

      {profile.description && (
        <p className="text-slate-300 text-sm mb-4 line-clamp-2">{profile.description}</p>
      )}

      <div className="space-y-2 mb-4">
        {/* Top Row: Founded & Total Capital */}
        <div className="grid grid-cols-2 gap-3">
          {profile.founded_year && (
            <div className="flex items-center gap-2 text-slate-400 text-sm">
              <Calendar className="w-4 h-4 text-blue-400 flex-shrink-0" />
              <span className="min-w-0">Founded {profile.founded_year}</span>
            </div>
          )}
          
          {profile.total_capital && (
            <div className="flex items-center gap-2 text-slate-400 text-sm">
              <DollarSign className="w-4 h-4 text-green-400 flex-shrink-0" />
              <span className="min-w-0 font-semibold text-green-300">${(profile.total_capital || 0).toLocaleString()}</span>
            </div>
          )}
        </div>

        {/* Bottom Row: Shareholders & Address */}
        <div className="grid grid-cols-2 gap-3">
          {coOwnersCount > 0 && (
            <div className="flex items-center gap-2 text-slate-400 text-sm">
              <Users className="w-4 h-4 text-blue-400 flex-shrink-0" />
              <span className="min-w-0">{coOwnersCount} shareholder{coOwnersCount !== 1 ? 's' : ''}</span>
            </div>
          )}

          {profile.business_address && (
            <div className="flex items-center gap-2 text-slate-400 text-sm">
              <MapPin className="w-4 h-4 text-red-400 flex-shrink-0" />
              <span className="min-w-0 truncate">{profile.business_address}</span>
            </div>
          )}
        </div>
      </div>

      {profile.website && (
        <div className="flex items-center gap-2 text-blue-400 text-sm mb-4">
          <Globe className="w-4 h-4" />
          <a 
            href={profile.website} 
            target="_blank" 
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="hover:underline truncate"
          >
            {profile.website}
          </a>
        </div>
      )}

      {profile.business_co_owners && profile.business_co_owners.length > 0 && (
        <div className="pt-4 border-t border-slate-700">
          <p className="text-slate-400 text-xs font-semibold mb-2">SHAREHOLDERS</p>
          <div className="space-y-2">
            {profile.business_co_owners.slice(0, 3).map((owner, idx) => (
              <div key={idx} className="flex items-center justify-between text-sm">
                <div>
                  <p className="text-white font-medium">{owner.owner_name}</p>
                  <p className="text-slate-500 text-xs">{owner.role}</p>
                </div>
                <span className="text-blue-400 font-semibold">{owner.ownership_share}%</span>
              </div>
            ))}
            {profile.business_co_owners.length > 3 && (
              <p className="text-slate-500 text-xs mt-2">+{profile.business_co_owners.length - 3} more</p>
            )}
          </div>
        </div>
      )}

      {/* 💳 Wallet Account Section */}
      <div className="pt-4 border-t border-slate-700">
        {profile.wallet_account ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 mb-2">
              <Wallet className="w-4 h-4 text-green-400" />
              <p className="text-slate-400 text-xs font-semibold">BUSINESS WALLET</p>
              <span className="ml-auto text-xs bg-green-900/50 text-green-300 px-2 py-1 rounded">✓ Active</span>
            </div>
            
            <div className="bg-slate-700/30 p-3 rounded-lg space-y-2">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-slate-500 text-xs">Account Number</p>
                  <p className="text-white font-mono font-semibold text-sm">{profile.wallet_account.account_number}</p>
                </div>
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    navigator.clipboard.writeText(profile.wallet_account.account_number);
                  }}
                  className="text-slate-400 hover:text-blue-400 text-xs"
                  title="Copy account number"
                >
                  📋
                </button>
              </div>

              {profile.wallet_account.preferred_currency && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400 text-xs">Currency</span>
                  <span className="text-white font-semibold">{profile.wallet_account.preferred_currency}</span>
                </div>
              )}

              {(profile.wallet_account.usd_balance !== undefined || 
                profile.wallet_account.ugx_balance !== undefined ||
                profile.wallet_account.kes_balance !== undefined) && (
                <div className="pt-2 border-t border-slate-600">
                  <p className="text-slate-400 text-xs mb-2 font-semibold">Balances</p>
                  <div className="space-y-1 text-xs">
                    {profile.wallet_account.usd_balance !== undefined && (
                      <div className="flex justify-between">
                        <span className="text-slate-400">USD</span>
                        <span className="text-green-400 font-semibold">${(profile.wallet_account.usd_balance || 0).toFixed(2)}</span>
                      </div>
                    )}
                    {profile.wallet_account.ugx_balance !== undefined && (
                      <div className="flex justify-between">
                        <span className="text-slate-400">UGX</span>
                        <span className="text-green-400 font-semibold">{(profile.wallet_account.ugx_balance || 0).toLocaleString()}</span>
                      </div>
                    )}
                    {profile.wallet_account.kes_balance !== undefined && (
                      <div className="flex justify-between">
                        <span className="text-slate-400">KES</span>
                        <span className="text-green-400 font-semibold">{(profile.wallet_account.kes_balance || 0).toLocaleString()}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="bg-yellow-900/20 border border-yellow-700 rounded-lg p-3 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-yellow-300 text-xs font-semibold">No Wallet Account</p>
              <p className="text-yellow-200/70 text-xs">Business wallet not yet created. Create one to enable payments and transactions.</p>
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center gap-2">
        <div className="flex-1 h-1 bg-slate-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-blue-500 to-cyan-500"
            style={{
              width: profile.verification_status === 'verified' ? '100%' : '60%'
            }}
          ></div>
        </div>
        <span className={`text-xs font-semibold px-2 py-1 rounded ${
          profile.verification_status === 'verified'
            ? 'bg-green-900/50 text-green-300'
            : 'bg-yellow-900/50 text-yellow-300'
        }`}>
          {profile.verification_status === 'verified' ? '✓ Verified' : '⏳ Pending'}
        </span>
      </div>

      {/* Pending Approvals - Investment & Member */}
      {showApprovalsModal && (
        <ShareholderApprovalsCenter
          businessProfileId={profile.id}
          currentUserId={currentUserId}
          currentUserEmail={currentUserEmail}
          onClose={() => setShowApprovalsModal(false)}
        />
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-red-600 rounded-xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <Trash2 className="w-6 h-6 text-red-500" />
              <h3 className="text-xl font-bold text-white">Delete Business Profile?</h3>
            </div>
            
            <p className="text-slate-300 mb-2">
              Are you sure you want to permanently delete <span className="font-semibold text-white">"{profile.business_name}"</span>?
            </p>
            
            <div className="bg-red-900/20 border border-red-700 rounded-lg p-3 mb-6">
              <p className="text-red-300 text-sm">
                ⚠️ <strong>Warning:</strong> This action cannot be undone. All associated data will be deleted.
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
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

export default BusinessProfileCard;

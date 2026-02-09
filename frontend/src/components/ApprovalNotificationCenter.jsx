import React, { useState, useEffect } from 'react';
import {
  Bell,
  X,
  Clock,
  CheckCircle2,
  AlertCircle,
  Loader,
  Users,
  ChevronRight
} from 'lucide-react';
import { memberApprovalService } from '../services/memberApprovalService';
import PendingApprovalsModal from './PendingApprovalsModal';

const ApprovalNotificationCenter = ({ businessProfileId, currentUserId, currentUserEmail }) => {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Only load if we have businessProfileId
    if (!businessProfileId) {
      console.log('⚠️ No businessProfileId provided to ApprovalNotificationCenter');
      return;
    }
    
    // Load notifications even if currentUserId is not ready yet
    if (currentUserId) {
      console.log('📌 Loading approvals for user:', currentUserId);
      loadApprovalNotifications();
    }
    
    // Note: Real-time subscriptions would be added once subscribeToApprovalUpdates 
    // is refactored to work with businessProfileId instead of pendingEditId
    
  }, [businessProfileId, currentUserId]);

  const loadApprovalNotifications = async () => {
    if (!currentUserId) {
      console.log('⚠️ No currentUserId provided to ApprovalNotificationCenter');
      return;
    }
    
    if (!businessProfileId) {
      console.log('⚠️ No businessProfileId provided to ApprovalNotificationCenter');
      return;
    }
    
    try {
      console.log('📋 Loading pending edits for business:', businessProfileId);
      // Get pending edits for this business profile
      const pendingEdits = await memberApprovalService.getPendingEdits(businessProfileId);
      console.log('📋 Pending edits loaded:', pendingEdits?.length || 0, pendingEdits);
      
      // Also load shareholder investment approvals
      const { getSupabase } = await import('../services/pitchingService');
      const supabase = getSupabase();
      
      const { data: pendingInvestmentApprovals, error: apprError } = await supabase
        .from('shareholder_notifications')
        .select('*')
        .is('read_at', null)
        .order('created_at', { ascending: false });

      if (apprError) console.error('Error loading investment approvals:', apprError);
      console.log('💰 Pending investment approvals:', pendingInvestmentApprovals?.length || 0);

      // Combine both types of notifications
      const allNotifications = [
        ...(pendingEdits || []),
        ...(pendingInvestmentApprovals || [])
      ];
      
      setNotifications(allNotifications);

      // Count all pending
      const memberPending = (pendingEdits || []).filter(edit => {
        const memberApprovals = edit.member_approvals || [];
        const totalMembers = memberApprovals.length;
        const approvedCount = memberApprovals.filter(m => m.status === 'approved').length;
        return approvedCount < totalMembers;
      }).length;
      
      const investmentPending = (pendingInvestmentApprovals || []).length;
      const totalPending = memberPending + investmentPending;
      
      console.log('📋 Approval count - Members:', memberPending, 'Investments:', investmentPending, 'Total:', totalPending);
      setUnreadCount(totalPending);
    } catch (error) {
      console.error('Error loading approval notifications:', error);
      setNotifications([]);
      setUnreadCount(0);
    }
  };

  const handleApprovalUpdate = (updatedEdits) => {
    setNotifications(updatedEdits || []);
    const pending = (updatedEdits || []).filter(edit => {
      const memberApprovals = edit.member_approvals || [];
      const totalMembers = memberApprovals.length;
      const approvedCount = memberApprovals.filter(m => m.approval_status === 'approved').length;
      return approvedCount < totalMembers;
    }).length;
    setUnreadCount(pending);
  };

  const openModal = () => {
    setShowDropdown(false);
    setShowModal(true);
  };

  const getNotificationMessage = (notification) => {
    switch (notification.edit_type) {
      case 'add_member':
        return `${notification.proposed_by_name} wants to add ${notification.description} as a shareholder`;
      case 'remove_member':
        return `${notification.proposed_by_name} wants to remove ${notification.description} from shareholders`;
      case 'update_member':
        return `${notification.proposed_by_name} wants to update ${notification.description}'s details`;
      case 'investment_signed':
        return `💰 Investment from ${notification.proposed_by_name}: ${notification.description}`;
      default:
        return `${notification.proposed_by_name} proposed a change: ${notification.description}`;
    }
  };

  return (
    <>
      {/* Bell Icon with Badge */}
      <div className="relative">
        {console.log('🔔 ApprovalNotificationCenter: businessProfileId=', businessProfileId, 'unreadCount=', unreadCount)}
        <button
          onClick={() => setShowDropdown(!showDropdown)}
          className="relative p-2 bg-yellow-600 hover:bg-yellow-700 text-white transition rounded-lg"
          title="Approval Notifications"
          aria-label="Approval notifications"
        >
          <Clock className="w-4 h-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>

        {/* Dropdown Menu */}
        {showDropdown && (
          <div className="absolute right-0 mt-2 w-80 bg-slate-800 rounded-lg shadow-2xl border border-slate-700 z-40">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-slate-700">
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-yellow-400" />
                <h3 className="font-semibold text-white">Pending Approvals</h3>
              </div>
              <button
                onClick={() => setShowDropdown(false)}
                className="text-slate-400 hover:text-white p-1 rounded transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="max-h-96 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="p-6 text-center">
                  <CheckCircle2 className="w-8 h-8 text-green-400 mx-auto mb-2" />
                  <p className="text-slate-400 text-sm">No pending approvals</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-700">
                  {notifications.map((notification) => {
                    const memberApprovals = notification.member_approvals || [];
                    const approvedCount = memberApprovals.filter(m => m.status === 'approved').length;
                    const isPending = approvedCount < memberApprovals.length;
                    
                    return (
                      <div
                        key={notification.id}
                        className={`p-3 hover:bg-slate-700/50 transition cursor-pointer ${
                          isPending ? 'bg-yellow-900/10' : ''
                        }`}
                        onClick={openModal}
                      >
                        <div className="flex items-start gap-3">
                          <div className="flex-1">
                            <p className="text-sm font-semibold text-white mb-1">
                              {getNotificationMessage(notification)}
                            </p>
                            <p className="text-xs text-slate-500">
                              {new Date(notification.created_at).toLocaleDateString()}
                            </p>
                          </div>
                          <div className="flex-shrink-0">
                            {isPending && (
                              <Clock className="w-4 h-4 text-yellow-400" />
                            )}
                            {!isPending && (
                              <CheckCircle2 className="w-4 h-4 text-green-400" />
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer with View All Button */}
            {notifications.length > 0 && (
              <div className="border-t border-slate-700 p-3">
                <button
                  onClick={openModal}
                  className="w-full text-center text-blue-400 hover:text-blue-300 text-sm font-semibold py-2 hover:bg-slate-700/50 rounded transition flex items-center justify-center gap-2"
                >
                  View All Approvals
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Info Icon - Shows approval requirement */}
      <div className="group relative inline-block ml-2">
        <AlertCircle className="w-5 h-5 text-blue-400 cursor-help" />
        <div className="absolute bottom-full right-0 mb-2 w-48 bg-slate-900 border border-slate-700 rounded-lg p-3 opacity-0 group-hover:opacity-100 transition pointer-events-none group-hover:pointer-events-auto z-50">
          <p className="text-xs text-slate-300">
            All shareholders must approve changes to the member roster. Unanimous approval required.
          </p>
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <PendingApprovalsModal
          businessProfileId={businessProfileId}
          currentUserId={currentUserId}
          onClose={() => {
            setShowModal(false);
            loadApprovalNotifications();
          }}
        />
      )}
    </>
  );
};

export default ApprovalNotificationCenter;

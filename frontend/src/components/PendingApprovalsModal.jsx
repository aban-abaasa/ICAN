import React, { useState, useEffect } from 'react';
import {
  X,
  CheckCircle2,
  XCircle,
  Clock,
  Users,
  AlertCircle,
  Loader,
  MessageCircle
} from 'lucide-react';
import { memberApprovalService } from '../services/memberApprovalService';

const PendingApprovalsModal = ({ businessProfileId, currentUserId, onClose }) => {
  const [pendingEdits, setPendingEdits] = useState([]);
  const [approvals, setApprovals] = useState({});
  const [loading, setLoading] = useState(true);
  const [responding, setResponding] = useState(null);
  const [responseComment, setResponseComment] = useState('');

  useEffect(() => {
    console.log('🔔 PendingApprovalsModal mounted with businessProfileId:', businessProfileId);
    loadPendingEdits();
  }, [businessProfileId]);

  const loadPendingEdits = async () => {
    setLoading(true);
    try {
      console.log('🔍 loadPendingEdits - calling service with:', { businessProfileId });
      
      if (!businessProfileId) {
        console.warn('⚠️  businessProfileId is undefined/null, cannot fetch edits');
        setPendingEdits([]);
        setLoading(false);
        return;
      }

      const allEdits = await memberApprovalService.getPendingEdits(businessProfileId);
      console.log('📋 Loaded all edits:', allEdits);
      
      // Filter to show only actual pending edits (status = 'pending')
      const pending = allEdits.filter(edit => edit.status === 'pending');
      console.log('📋 Filtered to pending edits:', pending);
      
      setPendingEdits(pending);

      // Member approvals are already included in the edit object as edit.member_approvals
      // No need to fetch them separately
      setApprovals({}); // Clear approvals since they're embedded in edits
    } catch (error) {
      console.error('Error loading pending edits:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (approvalId, editId) => {
    setResponding(approvalId);
    const result = await memberApprovalService.approveEdit(approvalId, currentUserId, responseComment);
    if (result.success) {
      setResponseComment('');
      loadPendingEdits();
    } else {
      alert('❌ Error approving: ' + result.error);
    }
    setResponding(null);
  };

  const handleReject = async (approvalId, editId) => {
    if (!responseComment.trim()) {
      alert('⚠️ Please provide a reason for rejection');
      return;
    }
    setResponding(approvalId);
    const result = await memberApprovalService.rejectEdit(approvalId, currentUserId, responseComment);
    if (result.success) {
      setResponseComment('');
      loadPendingEdits();
    } else {
      alert('❌ Error rejecting: ' + result.error);
    }
    setResponding(null);
  };

  const getEditTypeLabel = (type) => {
    switch (type) {
      case 'add_member':
        return '➕ Add Member';
      case 'remove_member':
        return '➖ Remove Member';
      case 'update_member':
        return '✏️ Update Member';
      case 'investment_signed':
        return '💰 Investment Signed';
      case 'other':
        return '📝 Change';
      default:
        return '📝 Change';
    }
  };

  const getApprovalPercentage = (edit) => {
    const editApprovals = edit.member_approvals || [];
    const approved = editApprovals.filter(a => a.status === 'approved').length;
    const total = editApprovals.length;
    return total > 0 ? Math.round((approved / total) * 100) : 0;
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-700">
          <div className="flex items-center gap-3">
            <Clock className="w-6 h-6 text-yellow-400" />
            <h2 className="text-2xl font-bold text-white">Pending Approvals</h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-700 transition"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader className="w-8 h-8 animate-spin text-blue-400" />
              <p className="ml-3 text-slate-300">Loading pending approvals...</p>
            </div>
          )}

          {!loading && pendingEdits.length === 0 && (
            <div className="text-center py-12">
              <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto mb-3" />
              <p className="text-slate-300 font-semibold">No pending approvals</p>
              <p className="text-slate-500 text-sm">All changes have been approved</p>
            </div>
          )}

          {!loading && pendingEdits.length > 0 && (
            <div className="space-y-4">
              {pendingEdits.map((edit) => {
                const editApprovals = edit.member_approvals || [];
                const approvalPercentage = getApprovalPercentage(edit);
                const userApproval = editApprovals.find(a => a.member_id === currentUserId);
                const isApproved = edit.status === 'approved';
                const isRejected = edit.status === 'rejected';

                return (
                  <div
                    key={edit.id}
                    className={`p-4 rounded-lg border transition ${
                      isApproved
                        ? 'bg-green-900/20 border-green-500/50'
                        : isRejected
                        ? 'bg-red-900/20 border-red-500/50'
                        : 'bg-slate-700/50 border-slate-600'
                    }`}
                  >
                    {/* Edit Header */}
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <p className="font-semibold text-white text-lg">{getEditTypeLabel(edit.edit_type)}</p>
                        <p className="text-slate-300 text-sm mt-1">{edit.description}</p>
                        <p className="text-slate-500 text-xs mt-1">Proposed by: {edit.proposed_by_name}</p>
                      </div>
                      <div className="text-right">
                        {isApproved && (
                          <span className="inline-block bg-green-500/20 text-green-300 px-3 py-1 rounded-full text-xs font-semibold">
                            ✓ APPROVED
                          </span>
                        )}
                        {isRejected && (
                          <span className="inline-block bg-red-500/20 text-red-300 px-3 py-1 rounded-full text-xs font-semibold">
                            ✗ REJECTED
                          </span>
                        )}
                        {!isApproved && !isRejected && (
                          <span className="inline-block bg-yellow-500/20 text-yellow-300 px-3 py-1 rounded-full text-xs font-semibold">
                            ⏳ PENDING
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Approval Progress */}
                    <div className="mb-4">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-slate-400 text-sm flex items-center gap-2">
                          <Users className="w-4 h-4" />
                          Approvals: {editApprovals.filter(a => a.status === 'approved').length}/
                          {editApprovals.length}
                        </p>
                        <p className="text-slate-300 font-semibold text-sm">{approvalPercentage}%</p>
                      </div>
                      <div className="w-full bg-slate-600 rounded-full h-2">
                        <div
                          className="bg-gradient-to-r from-blue-500 to-cyan-500 h-2 rounded-full transition-all"
                          style={{ width: `${approvalPercentage}%` }}
                        ></div>
                      </div>
                    </div>

                    {/* Members Approval Status */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-4">
                      {editApprovals.map((approval) => (
                        <div key={approval.id} className="flex items-center gap-2 text-sm">
                          {approval.status === 'approved' && (
                            <>
                              <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />
                              <span className="text-slate-300">
                                {approval.member_email}
                                {approval.member_id === currentUserId && ' (You)'}
                              </span>
                            </>
                          )}
                          {approval.status === 'rejected' && (
                            <>
                              <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                              <span className="text-slate-300">
                                {approval.member_email}
                                {approval.member_id === currentUserId && ' (You)'}
                              </span>
                            </>
                          )}
                          {approval.status === 'pending' && (
                            <>
                              <Clock className="w-4 h-4 text-yellow-400 flex-shrink-0" />
                              <span className="text-slate-300">
                                {approval.member_email} - <span className="text-slate-500">Pending</span>
                              </span>
                            </>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Action Buttons - Only if user hasn't responded yet and edit is pending */}
                    {!isApproved && !isRejected && userApproval?.status === 'pending' && (
                      <div className="border-t border-slate-600 pt-4">
                        <div className="mb-3">
                          <label className="text-slate-400 text-sm block mb-2">Comment (optional for approval, required for rejection):</label>
                          <textarea
                            value={responseComment}
                            onChange={(e) => setResponseComment(e.target.value)}
                            placeholder="Add a comment..."
                            className="w-full bg-slate-700 text-white rounded-lg px-3 py-2 border border-slate-600 focus:border-blue-500 focus:outline-none text-sm"
                            rows="2"
                          />
                        </div>

                        <div className="flex gap-2">
                          <button
                            onClick={() => handleApprove(userApproval.id, edit.id)}
                            disabled={responding}
                            className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-slate-600 text-white py-2 rounded-lg font-semibold transition flex items-center justify-center gap-2"
                          >
                            {responding === userApproval.id ? (
                              <>
                                <Loader className="w-4 h-4 animate-spin" />
                                Approving...
                              </>
                            ) : (
                              <>
                                <CheckCircle2 className="w-4 h-4" />
                                Approve
                              </>
                            )}
                          </button>
                          <button
                            onClick={() => handleReject(userApproval.id, edit.id)}
                            disabled={responding || !responseComment.trim()}
                            className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white py-2 rounded-lg font-semibold transition flex items-center justify-center gap-2"
                          >
                            {responding === userApproval.id ? (
                              <>
                                <Loader className="w-4 h-4 animate-spin" />
                                Rejecting...
                              </>
                            ) : (
                              <>
                                <XCircle className="w-4 h-4" />
                                Reject
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Show rejection reason if edit was rejected */}
                    {isRejected && (
                      <div className="border-t border-red-600 pt-3 mt-3">
                        <p className="text-red-300 text-sm font-semibold mb-2">Reason for rejection:</p>
                        <div className="bg-red-900/20 border border-red-500/30 rounded p-2">
                          <p className="text-red-200 text-sm">
                            {editApprovals.find(a => a.status === 'rejected')?.comment || 'No reason provided'}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Info Banner */}
        {!loading && pendingEdits.length > 0 && (
          <div className="border-t border-slate-700 bg-blue-900/20 border-l-4 border-blue-500 p-4 m-4 rounded">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
              <p className="text-blue-300 text-sm">
                <strong>Note:</strong> All members must approve changes to the shareholder roster. You will be notified once the approval is complete or rejected.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PendingApprovalsModal;

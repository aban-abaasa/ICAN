/**
 * AdminApprovalPanel Component
 * Handles REQUIRED admin approval of requisitions
 * Only admins can approve, approval is mandatory before execution
 */

import React, { useState, useEffect } from 'react';
import { Shield, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import cmmsRequisitionConfirmationService from '../../lib/supabase/services/cmmsRequisitionConfirmationService';

const AdminApprovalPanel = ({
  requisitionId,
  requisition,
  currentUserId,
  currentUserRole,
  onApprovalSubmitted,
  isLoading = false
}) => {
  const [approvalStatus, setApprovalStatus] = useState(null);
  const [approvalNotes, setApprovalNotes] = useState('');
  const [submittingApproval, setSubmittingApproval] = useState(false);
  const [selectedAction, setSelectedAction] = useState(null);
  const [workflow, setWorkflow] = useState(null);
  const [loadingWorkflow, setLoadingWorkflow] = useState(true);
  const [error, setError] = useState(null);

  // Load workflow on mount
  useEffect(() => {
    if (!requisitionId) return;
    loadWorkflow();
  }, [requisitionId]);

  const loadWorkflow = async () => {
    try {
      setLoadingWorkflow(true);
      setError(null);
      const result = await cmmsRequisitionConfirmationService.getRequisitionApprovalWorkflow(requisitionId);

      if (result.success) {
        setWorkflow(result.workflow);
        const adminStep = result.workflow.workflow_steps[0];
        setApprovalStatus(adminStep?.status || 'pending');
      } else {
        setError(result.error || 'Failed to load workflow');
      }
    } catch (error) {
      console.error('Error loading workflow:', error);
      setError(error.message);
    } finally {
      setLoadingWorkflow(false);
    }
  };

  const handleApprove = async () => {
    setSubmittingApproval(true);

    try {
      const result = await cmmsRequisitionConfirmationService.approveRequisitionAsAdmin(
        requisitionId,
        currentUserId,
        'approved',
        approvalNotes || null
      );

      if (result.success) {
        alert('✅ Requisition approved successfully!');
        setApprovalNotes('');
        setSelectedAction(null);
        setApprovalStatus('approved');
        await loadWorkflow();
        onApprovalSubmitted?.('approved');
      } else {
        alert(`❌ Error: ${result.error}`);
        setError(result.error);
      }
    } catch (error) {
      console.error('Error approving requisition:', error);
      alert('Error approving requisition');
      setError(error.message);
    } finally {
      setSubmittingApproval(false);
    }
  };

  const handleReject = async () => {
    if (!approvalNotes.trim()) {
      alert('Please provide a reason for rejection');
      return;
    }

    setSubmittingApproval(true);

    try {
      const result = await cmmsRequisitionConfirmationService.approveRequisitionAsAdmin(
        requisitionId,
        currentUserId,
        'rejected',
        approvalNotes
      );

      if (result.success) {
        alert('❌ Requisition rejected. Requester will be notified.');
        setApprovalNotes('');
        setSelectedAction(null);
        setApprovalStatus('rejected');
        await loadWorkflow();
        onApprovalSubmitted?.('rejected');
      } else {
        alert(`Error: ${result.error}`);
        setError(result.error);
      }
    } catch (error) {
      console.error('Error rejecting requisition:', error);
      alert('Error rejecting requisition');
      setError(error.message);
    } finally {
      setSubmittingApproval(false);
    }
  };

  // Check admin permission
  const isAdmin = currentUserRole === 'admin';

  if (!isAdmin) {
    return (
      <div className="glass-card p-6 bg-red-500/10 border border-red-500/30">
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-6 h-6 text-red-400" />
          <div>
            <p className="text-red-300 font-semibold">🔒 Admin Access Required</p>
            <p className="text-gray-400 text-sm mt-1">Only administrators can approve requisitions. Your role: <span className="text-blue-300 font-bold uppercase">{currentUserRole}</span></p>
          </div>
        </div>
      </div>
    );
  }

  if (loadingWorkflow) {
    return (
      <div className="glass-card p-6 bg-blue-500/10 border border-blue-500/30">
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-10 w-10 border border-blue-400 border-t-transparent mx-auto mb-3"></div>
          <p className="text-gray-400 text-sm">Loading approval workflow...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass-card p-6 bg-red-500/10 border border-red-500/30">
        <p className="text-red-300 text-sm">Error: {error}</p>
        <button
          onClick={loadWorkflow}
          className="mt-4 px-3 py-2 bg-red-500/20 border border-red-400 text-red-300 rounded-lg text-sm hover:bg-red-500/40 transition-all"
        >
          Retry
        </button>
      </div>
    );
  }

  const adminStep = workflow?.workflow_steps[0];
  const isApproved = approvalStatus === 'approved';
  const isRejected = approvalStatus === 'rejected';
  const isPending = approvalStatus === 'pending';

  return (
    <div className="glass-card p-6 bg-gradient-to-br from-red-500/5 to-orange-500/5 border border-red-500/20">
      <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
        <Shield className="w-6 h-6 text-red-400" />
        Admin Approval (REQUIRED)
      </h3>

      {/* Status Indicator */}
      <div className={`mb-6 p-4 rounded-lg border ${
        isApproved
          ? 'bg-green-500/10 border-green-400 text-green-300'
          : isRejected
          ? 'bg-red-500/10 border-red-400 text-red-300'
          : 'bg-yellow-500/10 border-yellow-400 text-yellow-300'
      }`}>
        <div className="flex items-center gap-2 mb-2">
          {isApproved && <CheckCircle2 className="w-5 h-5" />}
          {isRejected && <XCircle className="w-5 h-5" />}
          {isPending && <AlertTriangle className="w-5 h-5" />}
          <span className="font-bold text-sm uppercase">
            {isApproved && '✅ Approved'}
            {isRejected && '❌ Rejected'}
            {isPending && '⏳ Pending Admin Approval'}
          </span>
        </div>
        
        <div className="text-xs ml-7">
          <p className="mb-1">
            This requisition requires your approval before proceeding.
          </p>
          {isApproved && (
            <p className="text-xs text-gray-300">
              Approved by admin. Coordinator and supervisor confirmations are optional.
            </p>
          )}
          {isRejected && (
            <p className="text-xs text-gray-300">
              This requisition has been rejected. The requester will need to submit a new one.
            </p>
          )}
        </div>
      </div>

      {/* Requisition Summary */}
      {requisition && (
        <div className="mb-6 p-4 bg-white/5 border border-white/10 rounded-lg">
          <h4 className="text-sm font-bold text-gray-300 mb-3">📋 Requisition Details</h4>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-400">Title:</span>
              <span className="text-white font-semibold">{requisition.purpose || 'N/A'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Requested By:</span>
              <span className="text-white font-semibold">{requisition.requested_by_name || 'Unknown'}</span>
            </div>
            {requisition.total_estimated_cost && (
              <div className="flex justify-between">
                <span className="text-gray-400">Total Estimated Cost:</span>
                <span className="text-amber-300 font-bold">UGX {requisition.total_estimated_cost.toLocaleString()}</span>
              </div>
            )}
            {requisition.urgency_level && (
              <div className="flex justify-between">
                <span className="text-gray-400">Urgency:</span>
                <span className="text-white font-semibold uppercase">{requisition.urgency_level}</span>
              </div>
            )}
            {requisition.justification && (
              <div className="border-t border-white/10 pt-2 mt-2">
                <span className="text-gray-400 block mb-1">Justification:</span>
                <p className="text-gray-300 text-xs italic">{requisition.justification}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Approval Form */}
      {isPending && !selectedAction && (
        <div className="space-y-4 mb-6">
          <div className="p-4 bg-orange-500/10 border border-orange-400 rounded-lg">
            <p className="text-orange-300 text-sm font-semibold mb-3">
              ⚠️ Review this requisition carefully before approving
            </p>
            <p className="text-gray-400 text-xs mb-4">
              Your approval is mandatory. Coordinator and supervisor confirmations are optional and can be collected in parallel.
            </p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setSelectedAction('approve')}
              className="flex-1 px-4 py-3 bg-green-500/20 border border-green-400 text-green-300 rounded-lg font-bold hover:bg-green-500/40 transition-all"
            >
              ✅ Approve
            </button>
            <button
              onClick={() => setSelectedAction('reject')}
              className="flex-1 px-4 py-3 bg-red-500/20 border border-red-400 text-red-300 rounded-lg font-bold hover:bg-red-500/40 transition-all"
            >
              ❌ Reject
            </button>
          </div>
        </div>
      )}

      {/* Approval Action Form */}
      {selectedAction && !isApproved && !isRejected && (
        <div className="mb-6 p-4 bg-white/5 border border-white/10 rounded-lg">
          <h4 className="text-sm font-bold text-white mb-3">
            {selectedAction === 'approve' ? '✅ Approve Requisition' : '❌ Reject Requisition'}
          </h4>

          <textarea
            placeholder={
              selectedAction === 'approve'
                ? 'Add any approval notes (optional)'
                : 'Please explain why you are rejecting this requisition (required)'
            }
            value={approvalNotes}
            onChange={(e) => setApprovalNotes(e.target.value)}
            className="w-full px-3 py-2 mb-3 bg-white bg-opacity-10 border border-white border-opacity-20 rounded-lg text-white placeholder-gray-400 focus:border-blue-400 transition-all text-sm"
            rows="4"
          />

          <div className="flex gap-2">
            <button
              onClick={() => {
                if (selectedAction === 'approve') {
                  handleApprove();
                } else {
                  handleReject();
                }
              }}
              disabled={
                submittingApproval ||
                (selectedAction === 'reject' && !approvalNotes.trim())
              }
              className={`flex-1 px-4 py-2 rounded-lg font-bold transition-all ${
                selectedAction === 'approve'
                  ? 'bg-green-500/30 border border-green-400 text-green-300 hover:bg-green-500/50 disabled:opacity-50'
                  : 'bg-red-500/30 border border-red-400 text-red-300 hover:bg-red-500/50 disabled:opacity-50'
              }`}
            >
              {submittingApproval
                ? '⏳ Submitting...'
                : selectedAction === 'approve'
                ? '✅ Confirm Approval'
                : '❌ Confirm Rejection'}
            </button>
            <button
              onClick={() => {
                setSelectedAction(null);
                setApprovalNotes('');
              }}
              disabled={submittingApproval}
              className="flex-1 px-4 py-2 bg-gray-500/20 border border-gray-400 text-gray-300 rounded-lg font-bold hover:bg-gray-500/40 transition-all disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Approved Message */}
      {isApproved && (
        <div className="p-4 bg-green-500/20 border border-green-400 rounded-lg mb-4">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 className="w-5 h-5 text-green-400" />
            <p className="text-green-300 font-bold">✅ Requisition Approved</p>
          </div>
          <p className="text-gray-400 text-sm">
            This requisition has been approved. Coordinator and supervisor confirmations are optional and can be submitted independently.
          </p>
        </div>
      )}

      {/* Rejected Message */}
      {isRejected && (
        <div className="p-4 bg-red-500/20 border border-red-400 rounded-lg mb-4">
          <div className="flex items-center gap-2 mb-2">
            <XCircle className="w-5 h-5 text-red-400" />
            <p className="text-red-300 font-bold">❌ Requisition Rejected</p>
          </div>
          {approvalNotes && (
            <p className="text-gray-300 text-sm mt-2 italic">
              Reason: {approvalNotes}
            </p>
          )}
        </div>
      )}

      {/* Info Box */}
      <div className="p-4 bg-blue-500/10 border border-blue-400/30 rounded-lg text-xs text-blue-300">
        <p className="font-semibold mb-2">ℹ️ About Admin Approval</p>
        <ul className="space-y-1 text-gray-300">
          <li>• <span className="font-semibold">REQUIRED:</span> Admin approval is mandatory before this requisition can proceed</li>
          <li>• <span className="font-semibold">OPTIONAL:</span> Coordinator and supervisor confirmations are collected in parallel</li>
          <li>• <span className="font-semibold">FINANCIAL:</span> Financial officers have read-only access for review</li>
        </ul>
      </div>
    </div>
  );
};

export default AdminApprovalPanel;

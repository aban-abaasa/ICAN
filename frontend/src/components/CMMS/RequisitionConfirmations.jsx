/**
 * RequisitionConfirmations Component
 * Handles coordinator and supervisor confirmations
 * Separate from admin approval (which is mandatory)
 */

import React, { useState, useEffect } from 'react';
import { CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import cmmsRequisitionConfirmationService from '../../lib/supabase/services/cmmsRequisitionConfirmationService';

const RequisitionConfirmations = ({
  requisitionId,
  requisition,
  currentUserId,
  currentUserRole,
  onConfirmationSubmitted,
  isLoading = false
}) => {
  const [confirmations, setConfirmations] = useState([]);
  const [workflow, setWorkflow] = useState(null);
  const [submittingConfirmation, setSubmittingConfirmation] = useState(false);
  const [confirmationNotes, setConfirmationNotes] = useState('');
  const [selectedConfirmationType, setSelectedConfirmationType] = useState(null);
  const [loadingWorkflow, setLoadingWorkflow] = useState(true);

  // Load workflow on mount
  useEffect(() => {
    if (!requisitionId) return;
    loadWorkflow();
  }, [requisitionId]);

  const loadWorkflow = async () => {
    try {
      setLoadingWorkflow(true);
      const result = await cmmsRequisitionConfirmationService.getRequisitionApprovalWorkflow(requisitionId);

      if (result.success) {
        setWorkflow(result.workflow);
        // Load existing confirmations
        const confirmationsData = await cmmsRequisitionConfirmationService.getRequisitionConfirmations(requisitionId);
        setConfirmations(confirmationsData);
      }
    } catch (error) {
      console.error('Error loading workflow:', error);
    } finally {
      setLoadingWorkflow(false);
    }
  };

  const handleSubmitConfirmation = async (confirmationType, status) => {
    if (!confirmationType) {
      alert('Please select confirmation type');
      return;
    }

    setSubmittingConfirmation(true);

    try {
      const result = await cmmsRequisitionConfirmationService.submitRequisitionConfirmation(
        requisitionId,
        currentUserId,
        confirmationType,
        status,
        confirmationNotes || null
      );

      if (result.success) {
        alert(`✅ ${status.charAt(0).toUpperCase() + status.slice(1)} confirmation submitted`);
        setConfirmationNotes('');
        setSelectedConfirmationType(null);
        await loadWorkflow();
        onConfirmationSubmitted?.();
      } else {
        alert(`❌ Error: ${result.error}`);
      }
    } catch (error) {
      console.error('Error submitting confirmation:', error);
      alert('Error submitting confirmation');
    } finally {
      setSubmittingConfirmation(false);
    }
  };

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

  if (!workflow) {
    return (
      <div className="glass-card p-6 bg-red-500/10 border border-red-500/30">
        <p className="text-red-300 text-sm">Error loading workflow information</p>
      </div>
    );
  }

  // Check user permissions
  const canConfirm =
    currentUserRole === 'coordinator' ||
    currentUserRole === 'supervisor' ||
    currentUserRole === 'admin';

  const canApprove = currentUserRole === 'admin';

  // Get current user's confirmation (if exists)
  const userConfirmation = confirmations.find(
    (c) => c.confirmed_by_email === currentUserId
  );

  return (
    <div className="glass-card p-6 bg-gradient-to-br from-blue-500/5 to-purple-500/5 border border-blue-500/20">
      <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
        <CheckCircle2 className="w-6 h-6 text-blue-400" />
        Requisition Approval Workflow
      </h3>

      {/* Workflow Steps */}
      <div className="space-y-4 mb-6">
        {workflow.workflow_steps.map((step, idx) => {
          const stepConfirmations = step.confirmations || [];
          const stepStatus = step.status || (stepConfirmations.length > 0 ? 'completed' : 'pending');

          return (
            <div
              key={step.step}
              className={`border rounded-lg p-4 transition-all ${
                step.required
                  ? 'bg-orange-500/10 border-orange-400'
                  : 'bg-white/5 border-white/20'
              }`}
            >
              {/* Step Header */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-2xl">
                      {step.type === 'admin_approval' && stepStatus === 'approved' ? '✅' : ''}
                      {step.type === 'admin_approval' && stepStatus === 'rejected' ? '❌' : ''}
                      {step.type === 'admin_approval' && stepStatus === 'pending' ? '⏳' : ''}
                      {step.type === 'coordinator_confirmation' && stepConfirmations.length > 0 ? '✓' : '◯'}
                      {step.type === 'supervisor_confirmation' && stepConfirmations.length > 0 ? '✓' : '◯'}
                      {step.type === 'financial_review' ? '👁️' : ''}
                    </span>
                    <div>
                      <h4 className="text-white font-bold">{step.role}</h4>
                      <p className="text-xs text-gray-400">{step.description}</p>
                    </div>
                  </div>
                  {step.required && (
                    <span className="inline-block text-xs bg-orange-500/30 text-orange-300 px-2 py-1 rounded">
                      REQUIRED
                    </span>
                  )}
                </div>

                {/* Status Badge */}
                <div className="text-right ml-4">
                  {step.type === 'admin_approval' && (
                    <div
                      className={`text-xs font-bold px-2 py-1 rounded ${
                        stepStatus === 'approved'
                          ? 'bg-green-500/30 text-green-300'
                          : stepStatus === 'rejected'
                          ? 'bg-red-500/30 text-red-300'
                          : 'bg-yellow-500/30 text-yellow-300'
                      }`}
                    >
                      {stepStatus === 'approved' && '✅ Approved'}
                      {stepStatus === 'rejected' && '❌ Rejected'}
                      {stepStatus === 'pending' && '⏳ Pending'}
                    </div>
                  )}
                  {step.type === 'coordinator_confirmation' && (
                    <div className="text-xs font-bold px-2 py-1 rounded bg-blue-500/30 text-blue-300">
                      {step.count || 0} confirmations
                    </div>
                  )}
                  {step.type === 'supervisor_confirmation' && (
                    <div className="text-xs font-bold px-2 py-1 rounded bg-purple-500/30 text-purple-300">
                      {step.count || 0} confirmations
                    </div>
                  )}
                  {step.type === 'financial_review' && (
                    <div className="text-xs font-bold px-2 py-1 rounded bg-gray-500/30 text-gray-300">
                      View Only
                    </div>
                  )}
                </div>
              </div>

              {/* Existing Confirmations */}
              {stepConfirmations.length > 0 && (
                <div className="mb-4 pl-6 space-y-2 border-l-2 border-white/10">
                  {stepConfirmations.map((conf) => (
                    <div key={conf.id} className="text-sm">
                      <div className="flex items-center gap-2">
                        {conf.confirmation_status === 'confirmed' && (
                          <CheckCircle2 className="w-4 h-4 text-green-400" />
                        )}
                        {conf.confirmation_status === 'rejected' && (
                          <XCircle className="w-4 h-4 text-red-400" />
                        )}
                        {conf.confirmation_status === 'pending' && (
                          <AlertCircle className="w-4 h-4 text-yellow-400" />
                        )}
                        <span className="text-white font-semibold">{conf.confirmed_by_name}</span>
                        <span className="text-xs text-gray-400">({conf.confirmed_by_role})</span>
                      </div>
                      <div className="text-xs text-gray-400 ml-6">
                        {conf.confirmation_status === 'confirmed' && '✓ Confirmed'}
                        {conf.confirmation_status === 'rejected' && '✗ Rejected'}
                        {conf.confirmation_status === 'pending' && '⏳ Pending'}
                        {conf.confirmed_at && ` on ${new Date(conf.confirmed_at).toLocaleDateString()}`}
                      </div>
                      {conf.confirmation_notes && (
                        <div className="text-xs text-gray-300 italic ml-6 mt-1">
                          "{conf.confirmation_notes}"
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Confirmation Form (For current user if applicable) */}
              {!['financial_review', ...stepConfirmations.filter(c => c.confirmed_by_name === currentUserRole).map(c => c.type)].includes(step.type) &&
                canConfirm &&
                (step.type === 'coordinator_confirmation' || step.type === 'supervisor_confirmation') && (
                  <div className="mt-4 pt-4 border-t border-white/10">
                    <p className="text-xs text-gray-400 mb-3">
                      {currentUserRole === 'coordinator' && step.type === 'coordinator_confirmation'
                        ? '✓ You can submit a confirmation'
                        : currentUserRole === 'supervisor' && step.type === 'supervisor_confirmation'
                        ? '✓ You can submit a confirmation'
                        : ''}
                    </p>

                    {currentUserRole === 'coordinator' && step.type === 'coordinator_confirmation' && (
                      <div className="space-y-3">
                        <textarea
                          placeholder="Add any notes for this confirmation (optional)"
                          value={confirmationNotes}
                          onChange={(e) => setConfirmationNotes(e.target.value)}
                          className="w-full px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded-lg text-white placeholder-gray-400 focus:border-blue-400 transition-all text-sm"
                          rows="3"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleSubmitConfirmation('coordinator_confirmation', 'confirmed')}
                            disabled={submittingConfirmation}
                            className="flex-1 px-3 py-2 bg-green-500/20 border border-green-400 text-green-300 rounded-lg text-sm font-semibold hover:bg-green-500/40 transition-all disabled:opacity-50"
                          >
                            {submittingConfirmation ? '⏳ Submitting...' : '✓ Confirm'}
                          </button>
                          <button
                            onClick={() => handleSubmitConfirmation('coordinator_confirmation', 'rejected')}
                            disabled={submittingConfirmation}
                            className="flex-1 px-3 py-2 bg-red-500/20 border border-red-400 text-red-300 rounded-lg text-sm font-semibold hover:bg-red-500/40 transition-all disabled:opacity-50"
                          >
                            ✗ Reject
                          </button>
                        </div>
                      </div>
                    )}

                    {currentUserRole === 'supervisor' && step.type === 'supervisor_confirmation' && (
                      <div className="space-y-3">
                        <textarea
                          placeholder="Add any notes for this confirmation (optional)"
                          value={confirmationNotes}
                          onChange={(e) => setConfirmationNotes(e.target.value)}
                          className="w-full px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded-lg text-white placeholder-gray-400 focus:border-blue-400 transition-all text-sm"
                          rows="3"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleSubmitConfirmation('supervisor_confirmation', 'confirmed')}
                            disabled={submittingConfirmation}
                            className="flex-1 px-3 py-2 bg-green-500/20 border border-green-400 text-green-300 rounded-lg text-sm font-semibold hover:bg-green-500/40 transition-all disabled:opacity-50"
                          >
                            {submittingConfirmation ? '⏳ Submitting...' : '✓ Confirm'}
                          </button>
                          <button
                            onClick={() => handleSubmitConfirmation('supervisor_confirmation', 'rejected')}
                            disabled={submittingConfirmation}
                            className="flex-1 px-3 py-2 bg-red-500/20 border border-red-400 text-red-300 rounded-lg text-sm font-semibold hover:bg-red-500/40 transition-all disabled:opacity-50"
                          >
                            ✗ Reject
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
            </div>
          );
        })}
      </div>

      {/* Workflow Summary */}
      <div className="p-4 bg-white/5 border border-white/10 rounded-lg">
        <h4 className="text-sm font-bold text-gray-300 mb-2">📊 Workflow Summary</h4>
        <div className="space-y-1 text-xs text-gray-400">
          <p>
            Overall Status:{' '}
            <span className="text-white font-bold uppercase">{workflow.overall_status}</span>
          </p>
          <p>
            Admin Approval:{' '}
            <span
              className={`font-bold ${
                workflow.workflow_steps[0].status === 'approved'
                  ? 'text-green-300'
                  : workflow.workflow_steps[0].status === 'rejected'
                  ? 'text-red-300'
                  : 'text-yellow-300'
              }`}
            >
              {workflow.workflow_steps[0].status || 'Pending'}
            </span>
          </p>
          {requisition?.total_estimated_cost && (
            <p>
              Estimated Cost:{' '}
              <span className="text-amber-300 font-bold">
                UGX {requisition.total_estimated_cost.toLocaleString()}
              </span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default RequisitionConfirmations;

/**
 * RequisitionList Component
 * Displays all requisitions with status tracking
 * Shows different views based on user role
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Clipboard, RefreshCw } from 'lucide-react';

const RequisitionList = ({
  requisitions = [],
  isLoading = false,
  onRefresh,
  userRole,
  onSelectRequisition,
  onApproveRequisition,
  onConfirmRequisition
}) => {
  const [selectedRequisition, setSelectedRequisition] = useState(null);

  const priorityConfig = {
    low: { icon: '🟢', color: 'green', label: 'Low' },
    normal: { icon: '🟡', color: 'yellow', label: 'Normal' },
    urgent: { icon: '🔴', color: 'red', label: 'Urgent' },
    emergency: { icon: '🚨', color: 'red', label: 'Emergency' }
  };

  const statusConfig = {
    pending_confirmations: { icon: '🔄', label: 'Pending Confirmations', color: 'yellow' },
    pending_department_head: { icon: '⏳', label: 'Pending Department Approval', color: 'yellow' },
    pending_finance: { icon: '💰', label: 'Pending Finance Review', color: 'blue' },
    approved_by_admin: { icon: '✅', label: 'Approved by Admin', color: 'green' },
    rejected_by_admin: { icon: '❌', label: 'Rejected by Admin', color: 'red' },
    approved: { icon: '✅', label: 'Approved & Ordered', color: 'green' },
    completed: { icon: '🏁', label: 'Completed', color: 'green' }
  };

  const handleSelectRequisition = (req) => {
    setSelectedRequisition(selectedRequisition?.id === req.id ? null : req);
    if (onSelectRequisition) {
      onSelectRequisition(req);
    }
  };

  const getApproachableRequisitions = () => {
    if (userRole === 'admin') {
      return requisitions.filter(r => r.status === 'pending_confirmations' || r.status === 'pending_department_head');
    }
    if (userRole === 'coordinator' || userRole === 'supervisor') {
      return requisitions.filter(r => r.status === 'pending_confirmations');
    }
    if (userRole === 'financial_officer') {
      return requisitions.filter(r => r.status === 'pending_finance');
    }
    return [];
  };

  const actionableRequisitions = getApproachableRequisitions();

  return (
    <div className="glass-card p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-xl font-bold text-white flex items-center gap-3">
          <Clipboard className="w-6 h-6 text-cyan-400" />
          Maintenance Requisitions
          <span className="ml-2 px-3 py-1 bg-cyan-500 bg-opacity-30 rounded-full text-sm text-cyan-300">
            {requisitions.length}
          </span>
          {actionableRequisitions.length > 0 && (
            <span className="ml-2 px-3 py-1 bg-orange-500 bg-opacity-30 rounded-full text-sm text-orange-300">
              {actionableRequisitions.length} awaiting action
            </span>
          )}
        </h3>
        <button
          onClick={onRefresh}
          disabled={isLoading}
          className="px-3 py-2 text-xs bg-cyan-500/20 border border-cyan-400 text-cyan-300 rounded-lg hover:bg-cyan-500/40 transition-all disabled:opacity-50 flex items-center gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Action Items Alert */}
      {actionableRequisitions.length > 0 && (
        <div className="mb-6 p-4 bg-orange-500/10 border border-orange-400/50 rounded-lg">
          <p className="text-orange-300 font-semibold text-sm">
            ⚠️ You have <span className="text-lg font-bold">{actionableRequisitions.length}</span> requisition(s) awaiting your action
          </p>
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-12">
          <div className="inline-block">
            <div className="animate-spin rounded-full h-12 w-12 border border-cyan-400 border-t-transparent mx-auto mb-3"></div>
          </div>
          <p className="text-gray-400">Loading your maintenance requisitions...</p>
          <p className="text-gray-500 text-xs mt-2">This usually takes a few seconds</p>
        </div>
      ) : requisitions.length === 0 ? (
        <div className="text-center py-12">
          <Clipboard className="w-12 h-12 text-gray-600 mx-auto mb-3 opacity-50" />
          <p className="text-gray-400 text-lg">No requisitions yet</p>
          <p className="text-gray-500 text-sm mt-1">Create your first maintenance requisition to get started</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Actionable Requisitions First */}
          {actionableRequisitions.length > 0 && (
            <div className="mb-6">
              <h4 className="text-sm font-bold text-orange-300 mb-3 uppercase">⚡ Requires Your Action</h4>
              {actionableRequisitions.map(req => renderRequisitionCard(req, true))}
            </div>
          )}

          {/* All Other Requisitions */}
          <div>
            {actionableRequisitions.length > 0 && (
              <h4 className="text-sm font-bold text-gray-400 mb-3 uppercase">📋 Other Requisitions</h4>
            )}
            {requisitions
              .filter(req => !actionableRequisitions.find(a => a.id === req.id))
              .map(req => renderRequisitionCard(req, false))}
          </div>
        </div>
      )}
    </div>
  );

  function renderRequisitionCard(req, isActionable) {
    const pConfig = priorityConfig[req.priority] || priorityConfig.normal;
    const sConfig = statusConfig[req.status] || statusConfig.pending_department_head;
    const isExpanded = selectedRequisition?.id === req.id;

    return (
      <div 
        key={req.id} 
        onClick={() => handleSelectRequisition(req)}
        className={`border rounded-lg p-4 transition-all cursor-pointer ${
          isActionable
            ? 'bg-orange-500/10 border-orange-400 hover:bg-orange-500/20'
            : 'border-white/20 bg-white/5 hover:bg-white/10'
        } ${isExpanded ? 'ring-2 ring-blue-400' : ''}`}
      >
        {/* Header */}
        <div className="flex justify-between items-start mb-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h4 className="text-white font-bold text-lg">{req.title}</h4>
              <span className="text-xs bg-gray-700 text-gray-300 px-2 py-1 rounded">
                {req.requisitionNumber || `REQ-${req.id.slice(0, 8)}`}
              </span>
            </div>
            <p className="text-gray-400 text-sm line-clamp-2">{req.description}</p>
          </div>
          <div className="text-right ml-4">
            <div className="text-3xl mb-1">{sConfig.icon}</div>
            <div className={`text-xs font-bold text-${sConfig.color}-300 text-right`}>{sConfig.label}</div>
          </div>
        </div>

        {/* Details Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 pb-4 border-b border-white/10">
          <div className="bg-white/5 p-2 rounded">
            <div className="text-xs text-gray-400">Priority</div>
            <div className="text-white font-semibold text-sm">{pConfig.icon} {pConfig.label}</div>
          </div>
          <div className="bg-white/5 p-2 rounded">
            <div className="text-xs text-gray-400">Estimated Cost</div>
            <div className="text-white font-semibold text-sm">UGX {req.estimatedCost?.toLocaleString() || '0'}</div>
          </div>
          <div className="bg-white/5 p-2 rounded">
            <div className="text-xs text-gray-400">Requested By</div>
            <div className="text-white font-semibold text-sm">{req.createdByName || 'Unknown'}</div>
          </div>
          <div className="bg-white/5 p-2 rounded">
            <div className="text-xs text-gray-400">Date Created</div>
            <div className="text-white font-semibold text-sm">
              {req.createdAt ? new Date(req.createdAt).toLocaleDateString() : 'N/A'}
            </div>
          </div>
        </div>

        {/* Items List */}
        {req.items && req.items.length > 0 && (
          <div className="mb-4 pb-4 border-b border-white/10">
            <div className="text-xs text-gray-400 mb-2">📦 Items to Service/Purchase:</div>
            <div className="space-y-1">
              {req.items.map((item) => (
                <div key={item.id} className="text-xs text-gray-300 pl-2">
                  • <span className="text-white font-medium">{item.equipment}</span> × {item.quantity} @ UGX {item.costPerUnit?.toLocaleString() || 0} = <span className="text-amber-300 font-bold">UGX {item.totalCost?.toLocaleString() || 0}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Approval Status */}
        <div className="mb-4 pb-4 border-b border-white/10">
          <div className="text-xs text-gray-400 mb-2">Approval Chain:</div>
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <div className={`px-3 py-1 rounded bg-${req.approvals?.supervisor ? 'green' : 'gray'}-500 bg-opacity-30 text-${req.approvals?.supervisor ? 'green' : 'gray'}-300`}>
              👔 Dept Head {req.approvals?.supervisor ? '✓' : '⏳'}
            </div>
            <span className="text-gray-600">→</span>
            <div className={`px-3 py-1 rounded bg-${req.approvals?.coordinator ? 'green' : 'gray'}-500 bg-opacity-30 text-${req.approvals?.coordinator ? 'green' : 'gray'}-300`}>
              💼 Finance {req.approvals?.coordinator ? '✓' : '⏳'}
            </div>
            <span className="text-gray-600">→</span>
            <div className={`px-3 py-1 rounded ${req.status === 'approved' || req.status === 'completed' ? 'bg-green-500 bg-opacity-30 text-green-300' : 'bg-gray-500 bg-opacity-30 text-gray-300'}`}>
              🎯 Execute {req.status === 'approved' || req.status === 'completed' ? '✓' : '⏳'}
            </div>
          </div>
        </div>

        {/* Budget Status */}
        {req.budgetSufficient !== undefined && (
          <div className={`text-xs px-3 py-2 rounded mb-3 ${req.budgetSufficient ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'}`}>
            {req.budgetSufficient ? '✅ Budget Available' : '❌ Budget Insufficient - May require additional approval'}
          </div>
        )}

        {/* Action Buttons (Expanded View) */}
        {isExpanded && (
          <div className="border-t border-white/10 pt-4 mt-4 space-y-2">
            {/* Admin Approval Button */}
            {userRole === 'admin' && (req.status === 'pending_confirmations' || req.status === 'pending_department_head') && (
              <div className="flex gap-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onApproveRequisition?.(req.id, 'approved');
                  }}
                  className="flex-1 px-3 py-2 bg-green-500/20 border border-green-400 text-green-300 rounded-lg text-sm font-semibold hover:bg-green-500/40 transition-all"
                >
                  ✅ Approve
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onApproveRequisition?.(req.id, 'rejected');
                  }}
                  className="flex-1 px-3 py-2 bg-red-500/20 border border-red-400 text-red-300 rounded-lg text-sm font-semibold hover:bg-red-500/40 transition-all"
                >
                  ❌ Reject
                </button>
              </div>
            )}

            {/* Coordinator/Supervisor Confirmation */}
            {(userRole === 'coordinator' || userRole === 'supervisor') && req.status === 'pending_confirmations' && (
              <div className="flex gap-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onConfirmRequisition?.(req.id, 'confirmed');
                  }}
                  className="flex-1 px-3 py-2 bg-blue-500/20 border border-blue-400 text-blue-300 rounded-lg text-sm font-semibold hover:bg-blue-500/40 transition-all"
                >
                  ✓ Confirm
                </button>
              </div>
            )}

            {/* Financial Officer View Only */}
            {userRole === 'financial_officer' && (
              <div className="text-xs text-blue-300 bg-blue-500/10 border border-blue-400/30 p-2 rounded">
                👁️ View-only - Financial review in progress
              </div>
            )}
          </div>
        )}
      </div>
    );
  }
};

export default RequisitionList;

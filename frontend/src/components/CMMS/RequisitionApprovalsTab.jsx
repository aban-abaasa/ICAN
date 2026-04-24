import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle, Clipboard, Loader, X } from 'lucide-react';
import cmmsService from '../../lib/supabase/services/cmmsService';

const APPROVAL_TAB_ROLES = ['admin', 'coordinator', 'supervisor', 'finance', 'service-provider'];
const DEPARTMENT_STAGE_ROLES = ['admin', 'coordinator', 'supervisor', 'service-provider'];
const FINANCE_STAGE_ROLES = ['admin', 'finance'];

const STATUS_META = {
  pending_department_head: {
    label: 'Awaiting Department Decision',
    chipClass: 'bg-amber-100 text-amber-800 border-amber-300'
  },
  pending_finance: {
    label: 'Awaiting Finance Decision',
    chipClass: 'bg-blue-100 text-blue-800 border-blue-300'
  },
  approved: {
    label: 'Approved',
    chipClass: 'bg-emerald-100 text-emerald-800 border-emerald-300'
  },
  completed: {
    label: 'Completed',
    chipClass: 'bg-emerald-200 text-emerald-900 border-emerald-400'
  },
  rejected_by_department_head: {
    label: 'Rejected by Department',
    chipClass: 'bg-rose-100 text-rose-800 border-rose-300'
  },
  rejected_by_finance: {
    label: 'Rejected by Finance',
    chipClass: 'bg-rose-200 text-rose-900 border-rose-400'
  }
};

const formatUgx = (value) => `UGX ${Number(value || 0).toLocaleString()}`;

const normalizeLineItem = (item = {}) => {
  const quantity = Number(item.quantity ?? item.requested_quantity ?? 0);
  const costPerUnit = Number(item.costPerUnit ?? item.unit_price ?? item.unit_cost ?? 0);
  const totalCost = Number(item.totalCost ?? item.line_total ?? quantity * costPerUnit);
  const equipment = item.equipment || item.item_name || item.item || 'Inventory item';

  return {
    ...item,
    id: item.id || `${equipment}-${quantity}-${costPerUnit}`,
    equipment,
    quantity: Number.isFinite(quantity) ? quantity : 0,
    costPerUnit: Number.isFinite(costPerUnit) ? costPerUnit : 0,
    totalCost: Number.isFinite(totalCost) ? totalCost : 0,
    condition: item.condition || item.item_condition || item.item_description || ''
  };
};

const mapRequisitionFromDb = (req) => ({
  id: req.id,
  title: req.purpose || 'Maintenance Request',
  description: req.justification || '',
  createdByName: req.requested_by_name || 'Unknown',
  createdAt: req.requisition_date ? new Date(req.requisition_date) : new Date(),
  status: req.status || 'pending_department_head',
  priority: req.urgency_level || 'normal',
  estimatedCost: Number(req.total_estimated_cost || 0),
  requisitionNumber: req.requisition_number || '',
  financePaymentMethod: req.finance_payment_method || null,
  items: Array.isArray(req.items) ? req.items.map(normalizeLineItem) : []
});

const RequisitionApprovalsTab = ({ userRole, companyId, cmmsData, setCmmsData }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [decisionTargetId, setDecisionTargetId] = useState(null);
  const [notesById, setNotesById] = useState({});
  const [myCashProofs, setMyCashProofs] = useState([]);
  const [isLoadingCashProofs, setIsLoadingCashProofs] = useState(false);
  const [confirmingCashProofId, setConfirmingCashProofId] = useState(null);
  const [payingRequisitionId, setPayingRequisitionId] = useState(null);
  const [payoutRecipientById, setPayoutRecipientById] = useState({});
  const [expandedProcessedId, setExpandedProcessedId] = useState(null);
  const [financeCashoutMethod, setFinanceCashoutMethod] = useState('cash');
  const hasLoaded = useRef(false);

  const canUseApprovalsTab = APPROVAL_TAB_ROLES.includes(userRole);
  const canHandleDepartmentStage = DEPARTMENT_STAGE_ROLES.includes(userRole);
  const isFinanceOfficer = userRole === 'finance';
  const canHandleFinanceStage = isFinanceOfficer;

  const loadRequisitions = useCallback(
    async (force = false) => {
      if (!companyId || !canUseApprovalsTab) return;
      if (hasLoaded.current && !force) return;

      hasLoaded.current = true;
      setIsLoading(true);
      try {
        const { data, error } = await cmmsService.getCompanyRequisitions(companyId);
        if (error) {
          console.error('Failed to load requisitions for approvals:', error);
          return;
        }

        setCmmsData((prev) => ({
          ...prev,
          requisitions: (data || []).map(mapRequisitionFromDb)
        }));
      } catch (error) {
        console.error('Error loading approvals requisitions:', error);
      } finally {
        setIsLoading(false);
      }
    },
    [canUseApprovalsTab, companyId, setCmmsData]
  );

  const loadMyCashProofs = useCallback(async () => {
    if (!companyId || !canUseApprovalsTab) return;

    setIsLoadingCashProofs(true);
    try {
      const { data, error } = await cmmsService.getMyCashoutProofRequests();
      if (error) {
        console.error('Failed to load recipient cash proof requests:', error);
        return;
      }
      setMyCashProofs(data || []);
    } catch (error) {
      console.error('Error loading recipient cash proof requests:', error);
    } finally {
      setIsLoadingCashProofs(false);
    }
  }, [canUseApprovalsTab, companyId]);

  useEffect(() => {
    hasLoaded.current = false;
    loadRequisitions(false);
  }, [companyId, loadRequisitions]);

  useEffect(() => {
    loadMyCashProofs();
  }, [loadMyCashProofs]);

  const queue = useMemo(() => {
    const requisitions = cmmsData.requisitions || [];
    return requisitions.filter((req) => {
      if (!['pending_department_head', 'pending_finance'].includes(req.status)) return false;
      // Finance-only users see only finance-stage items
      if (userRole === 'finance' && req.status !== 'pending_finance') return false;
      return true;
    });
  }, [cmmsData.requisitions, userRole]);

  const processed = useMemo(() => {
    const requisitions = cmmsData.requisitions || [];
    return requisitions.filter((req) => !['pending_department_head', 'pending_finance'].includes(req.status));
  }, [cmmsData.requisitions]);

  const approvedForPayout = useMemo(() => {
    return (processed || []).filter((req) => req.status === 'approved');
  }, [processed]);

  const pendingProofs = useMemo(() => {
    return (myCashProofs || []).filter((proof) => proof.status !== 'confirmed');
  }, [myCashProofs]);

  const proofByRequisitionId = useMemo(() => {
    const map = {};
    for (const proof of myCashProofs || []) {
      if (!proof?.requisition_id) continue;
      if (!map[proof.requisition_id]) {
        map[proof.requisition_id] = proof;
      }
    }
    return map;
  }, [myCashProofs]);

  const decide = async (req, approved) => {
    let nextStatus = '';
    let approverRole = '';

    if (req.status === 'pending_department_head') {
      if (!canHandleDepartmentStage) {
        alert('Your role cannot handle department-stage decisions.');
        return;
      }
      nextStatus = approved ? 'pending_finance' : 'rejected_by_department_head';
      approverRole = 'department_head';
    } else if (req.status === 'pending_finance') {
      if (!canHandleFinanceStage) {
        alert('Only finance/admin roles can handle finance-stage decisions.');
        return;
      }
      nextStatus = approved ? 'approved' : 'rejected_by_finance';
      approverRole = 'finance';
    } else {
      return;
    }

    setDecisionTargetId(req.id);
    try {
      const decisionNotes = notesById[req.id] || '';

      const { error } = await cmmsService.updateRequisitionStatus(
        req.id,
        nextStatus,
        decisionNotes,
        approverRole
      );

      if (error) {
        console.error('Failed to update requisition status:', error);
        alert('Failed to submit approval decision.');
        return;
      }

      hasLoaded.current = false;
      await loadRequisitions(true);
      await loadMyCashProofs();
      setNotesById((prev) => ({ ...prev, [req.id]: '' }));
    } catch (error) {
      console.error('Error submitting approval decision:', error);
      alert('An unexpected error occurred while saving the decision.');
    } finally {
      setDecisionTargetId(null);
    }
  };

  const handleConfirmCashProof = async (requestId) => {
    setConfirmingCashProofId(requestId);
    try {
      const confirmationPayload = {
        confirmed_from: 'cmms_approvals_tab',
        confirmed_at: new Date().toISOString(),
        confirmation_device: 'mobile_phone'
      };

      const { data, error } = await cmmsService.confirmCashoutProof(requestId, confirmationPayload);
      if (error || !data?.success) {
        console.error('Failed to confirm cash proof request:', error || data);
        alert(data?.message || error?.message || 'Failed to confirm cash proof request.');
        return;
      }

      hasLoaded.current = false;
      await loadRequisitions(true);
      await loadMyCashProofs();
      alert('Cash proof confirmed. Blockchain payout evidence recorded.');
    } catch (error) {
      console.error('Error confirming cash proof request:', error);
      alert('An unexpected error occurred while confirming cash proof request.');
    } finally {
      setConfirmingCashProofId(null);
    }
  };

  const handlePayApprovedRequisition = async (req) => {
    if (!isFinanceOfficer || req.status !== 'approved') return;

    setPayingRequisitionId(req.id);
    try {
      if (financeCashoutMethod === 'cash') {
        const recipientLookup = String(payoutRecipientById[req.id] || '').trim();
        if (!recipientLookup) {
          alert('Enter recipient surname or email to initiate cash payout proof.');
          return;
        }

        const { data, error } = await cmmsService.initiateCashoutProof(
          req.id,
          recipientLookup,
          Number(req.estimatedCost || 0),
          'UGX',
          'Cash payout initiated after requisition approval'
        );

        if (error || !data?.success) {
          console.error('Failed to initiate approved requisition cash payout:', error || data);
          const serverMessage = data?.message || error?.message || '';
          if (String(serverMessage).toLowerCase().includes('pending cash payout confirmation already exists')) {
            await loadMyCashProofs();
            alert('A payout request is already pending for this requisition. Check the messages section below.');
            return;
          }
          alert(data?.message || error?.message || 'Failed to initiate cash payout proof request.');
          return;
        }

        alert('Cash payout request sent. Recipient must confirm on phone to complete payment.');
      } else {
        const { error } = await cmmsService.updateRequisitionStatus(
          req.id,
          'completed',
          'ICAN wallet payout completed after approval',
          'finance'
        );

        if (error) {
          console.error('Failed to mark approved requisition as completed after wallet payout:', error);
          alert('Failed to complete ICAN wallet payout.');
          return;
        }

        alert('ICAN wallet payout completed. Requisition marked as completed.');
      }

      hasLoaded.current = false;
      await loadRequisitions(true);
      await loadMyCashProofs();
    } catch (error) {
      console.error('Error while paying approved requisition:', error);
      alert('An unexpected error occurred while processing payout.');
    } finally {
      setPayingRequisitionId(null);
    }
  };

  if (!canUseApprovalsTab) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-5 text-amber-800 text-sm flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
        Your current role does not have access to the approvals tab.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-gradient-to-br from-blue-50 via-indigo-50 to-emerald-50 p-5">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h3 className="text-lg md:text-xl font-bold text-slate-800 flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-emerald-600" />
              Approval Queue
            </h3>
            <p className="text-xs text-slate-600 mt-1">
              Dedicated approvals workflow (including service-provider role access).
            </p>
          </div>
          <button
            onClick={() => {
              hasLoaded.current = false;
              loadRequisitions(true);
              loadMyCashProofs();
            }}
            disabled={isLoading}
            className="px-3 py-2 rounded-lg border border-emerald-300 bg-emerald-100 text-sm font-semibold text-emerald-700 hover:bg-emerald-200 disabled:opacity-60"
          >
            Refresh Queue
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <div className="text-[11px] uppercase tracking-wide text-amber-700">Department Stage</div>
            <div className="mt-1 text-xl font-bold text-slate-800">
              {queue.filter((item) => item.status === 'pending_department_head').length}
            </div>
          </div>
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-3">
            <div className="text-[11px] uppercase tracking-wide text-blue-700">Finance Stage</div>
            <div className="mt-1 text-xl font-bold text-slate-800">
              {queue.filter((item) => item.status === 'pending_finance').length}
            </div>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
            <div className="text-[11px] uppercase tracking-wide text-emerald-700">Approved</div>
            <div className="mt-1 text-xl font-bold text-slate-800">
              {processed.filter((item) => item.status === 'approved').length}
            </div>
          </div>
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
            <div className="text-[11px] uppercase tracking-wide text-rose-700">Rejected</div>
            <div className="mt-1 text-xl font-bold text-slate-800">
              {processed.filter((item) => String(item.status).startsWith('rejected')).length}
            </div>
          </div>
        </div>

        {isFinanceOfficer && (
          <div className="mt-4 rounded-xl border border-cyan-200 bg-cyan-50 p-3">
            <p className="text-xs text-cyan-800 uppercase tracking-wide mb-2">Cashout Method Tabs (Finance)</p>
            <div className="inline-flex rounded-lg border border-slate-300 bg-white p-1 gap-1">
              <button
                type="button"
                onClick={() => setFinanceCashoutMethod('cash')}
                className={`px-3 py-1.5 rounded-md text-xs md:text-sm font-semibold transition-all ${
                  financeCashoutMethod === 'cash'
                    ? 'bg-amber-200 text-amber-900 border border-amber-300'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                By Cash
              </button>
              <button
                type="button"
                onClick={() => setFinanceCashoutMethod('ican_wallet')}
                className={`px-3 py-1.5 rounded-md text-xs md:text-sm font-semibold transition-all ${
                  financeCashoutMethod === 'ican_wallet'
                    ? 'bg-cyan-200 text-cyan-900 border border-cyan-300'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                ICAN Wallet
              </button>
            </div>
            <p className="text-xs text-slate-700 mt-2">
              {financeCashoutMethod === 'cash'
                ? 'Cash mode: after approval, recipient must confirm on phone to complete payout.'
                : 'ICAN Wallet mode: after approval, finance can complete payout instantly.'}
            </p>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-blue-50 p-5">
        <h4 className="text-lg font-semibold text-slate-800 flex items-center gap-2 mb-3">
          <Clipboard className="w-5 h-5 text-blue-600" />
          Pending Decisions
        </h4>

        {isLoading ? (
          <div className="py-10 text-center">
            <Loader className="w-8 h-8 text-blue-600 mx-auto animate-spin" />
            <p className="text-sm text-slate-600 mt-3">Loading approval queue...</p>
          </div>
        ) : queue.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 px-4 py-10 text-center text-slate-600">
            No pending approval decisions.
          </div>
        ) : (
          <div className="space-y-3">
            {queue.map((req) => {
              const status = STATUS_META[req.status] || STATUS_META.pending_department_head;
              const isDepartmentStage = req.status === 'pending_department_head';
              const canActOnThis = isDepartmentStage ? canHandleDepartmentStage : canHandleFinanceStage;

              return (
                <article
                  key={req.id}
                  className="rounded-xl border border-slate-200 bg-white p-4"
                >
                  <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                    <div>
                      <div className="flex items-center flex-wrap gap-2 mb-1">
                        <h5 className="text-base font-semibold text-slate-800">{req.title}</h5>
                        <span className={`rounded-md border px-2 py-0.5 text-xs ${status.chipClass}`}>
                          {status.label}
                        </span>
                        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                          {req.requisitionNumber || req.id}
                        </span>
                      </div>
                      <p className="text-sm text-slate-600">{req.description}</p>
                    </div>
                    <div className="text-left md:text-right">
                      <p className="text-xs text-slate-600">Requested By</p>
                      <p className="text-sm text-slate-800">{req.createdByName}</p>
                      <p className="text-xs text-slate-600 mt-2">Estimated Cost</p>
                      <p className="text-sm font-semibold text-amber-700">
                        {formatUgx(req.estimatedCost)}
                      </p>
                    </div>
                  </div>

                  {Array.isArray(req.items) && req.items.length > 0 && (
                    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                      <p className="text-[11px] uppercase tracking-wide text-slate-600 mb-2">Line Items</p>
                      <div className="space-y-2">
                        {req.items.map((item, index) => (
                          <div key={item.id || `${req.id}-approval-item-${index}`} className="rounded-md border border-slate-200 bg-white p-2">
                            <p className="text-sm text-slate-800 truncate">{item.equipment}</p>
                            <div className="mt-1.5 grid grid-cols-2 sm:grid-cols-4 gap-2">
                              <div>
                                <p className="text-[10px] uppercase tracking-wide text-slate-600">Required Qty</p>
                                <p className="text-sm text-slate-800">{item.quantity}</p>
                              </div>
                              <div>
                                <p className="text-[10px] uppercase tracking-wide text-slate-600">Unit Cost</p>
                                <p className="text-sm text-slate-800">{formatUgx(item.costPerUnit)}</p>
                              </div>
                              <div>
                                <p className="text-[10px] uppercase tracking-wide text-slate-600">Condition</p>
                                <p className="text-sm text-slate-800">{item.condition || 'Not specified'}</p>
                              </div>
                              <div className="text-right">
                                <p className="text-[10px] uppercase tracking-wide text-slate-600">Required Amount</p>
                                <p className="text-sm font-semibold text-amber-700">{formatUgx(item.totalCost)}</p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="mt-3">
                    <textarea
                      value={notesById[req.id] || ''}
                      onChange={(e) =>
                        setNotesById((prev) => ({
                          ...prev,
                          [req.id]: e.target.value
                        }))
                      }
                      rows={2}
                      placeholder="Decision notes (optional)"
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/60"
                    />
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {canActOnThis ? (
                      <>
                        <button
                          onClick={() => decide(req, true)}
                          disabled={decisionTargetId === req.id}
                          className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                        >
                          {decisionTargetId === req.id ? 'Saving...' : 'Approve'}
                        </button>
                        <button
                          onClick={() => decide(req, false)}
                          disabled={decisionTargetId === req.id}
                          className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-60 flex items-center gap-1"
                        >
                          <X className="w-4 h-4" />
                          {decisionTargetId === req.id ? 'Saving...' : 'Reject'}
                        </button>
                      </>
                    ) : (
                      <div className="text-xs text-amber-800 bg-amber-100 border border-amber-300 rounded-lg px-3 py-2">
                        {userRole === 'finance' && isDepartmentStage
                          ? 'Waiting for admin/coordinator approval before finance can act.'
                          : 'Your role can view this stage but cannot submit this decision.'}
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {isFinanceOfficer && approvedForPayout.length > 0 && (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
          <h4 className="text-base font-semibold text-slate-800 mb-3">Approved Requisitions Ready For Payment</h4>
          <div className="space-y-3">
            {approvedForPayout.map((req) => (
              <article
                key={`payout-${req.id}`}
                className="rounded-lg border border-slate-200 bg-white p-3"
              >
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{req.title}</p>
                    <p className="text-xs text-slate-600">{req.requisitionNumber || req.id}</p>
                    <p className="text-sm font-bold text-emerald-700 mt-1">Amount: {formatUgx(req.estimatedCost)}</p>
                  </div>

                  <div className="w-full md:w-auto md:min-w-[320px]">
                    {financeCashoutMethod === 'cash' && (
                      <input
                        type="text"
                        value={payoutRecipientById[req.id] || ''}
                        onChange={(e) =>
                          setPayoutRecipientById((prev) => ({
                            ...prev,
                            [req.id]: e.target.value
                          }))
                        }
                        placeholder="Recipient surname or email"
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/60"
                      />
                    )}

                    <button
                      onClick={() => handlePayApprovedRequisition(req)}
                      disabled={payingRequisitionId === req.id}
                      className="mt-2 w-full rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                    >
                      {payingRequisitionId === req.id
                        ? 'Processing Payment...'
                        : financeCashoutMethod === 'cash'
                          ? 'Initiate Cash Payout'
                          : 'Complete Wallet Payout'}
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {pendingProofs.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <h4 className="text-base font-semibold text-slate-800 mb-3">Pending Payout Confirmations</h4>

          {isLoadingCashProofs ? (
            <div className="py-8 text-center">
              <Loader className="w-6 h-6 text-blue-600 mx-auto animate-spin" />
              <p className="text-sm text-slate-500 mt-2">Loading phone confirmations...</p>
            </div>
          ) : (
            <div className="space-y-1">
              {pendingProofs.map((proof) => (
                <article key={proof.id} className="rounded-md border border-cyan-500/25 bg-cyan-500/5 px-2.5 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-slate-200 truncate">• {proof.requisition_number || proof.requisition_id} - Pending - {formatUgx(proof.amount)}</p>
                    {proof.can_confirm ? (
                      <button
                        onClick={() => handleConfirmCashProof(proof.id)}
                        disabled={confirmingCashProofId === proof.id}
                        className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
                      >
                        {confirmingCashProofId === proof.id ? '...' : 'Confirm'}
                      </button>
                    ) : (
                      <span className="text-[11px] text-cyan-200">Waiting</span>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {processed.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <h4 className="text-base font-semibold text-slate-800 mb-3">Recently Processed</h4>
          <div className="space-y-1">
            {processed.slice(0, 8).map((req) => {
              const status = STATUS_META[req.status] || STATUS_META.approved;
              const relatedProof = proofByRequisitionId[req.id];
              return (
                <article key={req.id} className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2">
                  <button
                    type="button"
                    onClick={() => setExpandedProcessedId((prev) => (prev === req.id ? null : req.id))}
                    className="w-full text-left flex items-center justify-between gap-2"
                  >
                    <p className="text-xs text-slate-700 truncate">• {req.title} - {req.requisitionNumber || req.id}</p>
                    <span className={`rounded-md border px-2 py-0.5 text-[10px] whitespace-nowrap ${status.chipClass}`}>
                      {status.label}
                    </span>
                  </button>

                  {expandedProcessedId === req.id && (
                    <div className="mt-2 pl-3 border-l border-slate-300 space-y-1">
                      <p className="text-xs text-slate-700">Amount: {formatUgx(req.estimatedCost)}</p>
                      <p className="text-xs text-slate-700">
                        Method: {req.financePaymentMethod === 'cash'
                          ? 'By Cash'
                          : req.financePaymentMethod === 'ican_wallet'
                            ? 'ICAN Wallet'
                            : 'Not captured'}
                      </p>
                      <p className="text-xs text-slate-700">
                        By: {relatedProof?.requested_by_name || relatedProof?.requested_by_email || 'Finance'}
                      </p>
                      {relatedProof?.recipient_confirmed_at && (
                        <p className="text-xs text-slate-700">Confirmed at: {new Date(relatedProof.recipient_confirmed_at).toLocaleString()}</p>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
};

export default RequisitionApprovalsTab;

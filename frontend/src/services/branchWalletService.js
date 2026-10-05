/**
 * Branch wallets under a mother account, with assigned approvers.
 *
 * Backed by backend/BRANCH_WALLETS_APPROVERS.sql. Each branch is a business
 * profile with its own business wallet; the ownership tree says which wallets
 * the mother may view or govern. Money still moves only through the existing
 * business-wallet request/execute flow; this layer decides who may approve,
 * how much, and what is allowed at all.
 *
 * Amounts are ICAN coin. Every function resolves to { data, error }.
 */

import { supabase } from '../lib/supabase/client';

const call = async (fn, args = {}) => {
  try {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error(`❌ ${fn} failed:`, error?.message || error);
    return { data: null, error };
  }
};

export const APPROVER_LEVELS = [
  { value: 'branch', label: 'Branch approver', hint: 'Signs off payments up to the branch limit.' },
  { value: 'mother', label: 'Mother approver', hint: 'Must also sign off payments above the branch limit. Must own a business that governs this branch.' }
];

export const OPERATION_LABELS = {
  branch_funding: 'Funding from mother account',
  branch_sweep: 'Surplus swept to mother account',
  transfer: 'Payment'
};

export const formatIcan = (value) => {
  const n = Number(value) || 0;
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 4 })} ICAN`;
};

// The mother's view: the starting wallet plus every branch wallet beneath it that allows at least a view
export const getWalletOverview = (businessId) => call('fn_bwp_wallet_overview', { p_business: businessId });
export const getWalletEvents = (businessId) => call('fn_bwp_events', { p_business: businessId });

export const setWalletPolicy = (businessId, policy) => call('fn_bwp_set_policy', { p_business: businessId, p_policy: policy });
export const setWalletStatus = (businessId, status, reason = null) =>
  call('fn_bwp_set_wallet_status', { p_business: businessId, p_status: status, p_reason: reason });

export const listApprovers = (businessId) => call('fn_bwp_list_approvers', { p_business: businessId });
export const assignApprover = (businessId, email, level, maxAmount = null) =>
  call('fn_bwp_assign_approver', { p_business: businessId, p_email: email, p_level: level, p_max_amount: maxAmount });
export const removeApprover = (businessId, approverRowId) =>
  call('fn_bwp_remove_approver', { p_business: businessId, p_approver_row: approverRowId });

// Moving money between mother and branch (creates a pending request)
export const proposeFunding = (motherId, branchId, amount, note = null) =>
  call('fn_bwp_propose_transfer', { p_source: motherId, p_target: branchId, p_kind: 'funding', p_amount: amount, p_note: note });
export const proposeSweep = (branchId, motherId, amount, note = null) =>
  call('fn_bwp_propose_transfer', { p_source: branchId, p_target: motherId, p_kind: 'sweep', p_amount: amount, p_note: note });

export const setAllowance = (branchId, config) => call('fn_bwp_set_allowance', { p_child: branchId, p_config: config });
export const runDueAllowances = () => call('fn_bwp_run_due_allowances');

// My approvals: PIN, inbox, decisions
export const getMyPinStatus = () => call('fn_bwp_my_pin_status');
export const setMyApprovalPin = (pin, currentPin = null) => call('fn_bwp_set_my_pin', { p_pin: pin, p_current_pin: currentPin });
export const getMyPendingApprovals = () => call('fn_bwp_pending_for_me');

/** Resolves { data: { success, status, stage, error? } }. A wrong PIN is success:false, not a thrown error. */
export const decideRequest = (transactionId, decision, pin, comment = null) =>
  call('fn_bwp_decide', { p_tx: transactionId, p_decision: decision, p_pin: pin, p_comment: comment });

export default {
  APPROVER_LEVELS, OPERATION_LABELS, formatIcan,
  getWalletOverview, getWalletEvents, setWalletPolicy, setWalletStatus,
  listApprovers, assignApprover, removeApprover, proposeFunding, proposeSweep,
  setAllowance, runDueAllowances, getMyPinStatus, setMyApprovalPin, getMyPendingApprovals, decideRequest
};

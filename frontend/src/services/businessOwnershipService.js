/**
 * Pitchin business profile: branches and the tree of ownership.
 *
 * Backed by backend/BUSINESS_OWNERSHIP_TREE_CMMS_FEED.sql. Each branch is a
 * business profile of its own; a link records who owns whom, the ownership
 * percentage, and how much of the branch's CMMS it shares with its parent
 * ('none' | 'summary' | 'full'). Linked CMMS companies feed the parent's
 * consolidated CMMS view automatically.
 *
 * Every function resolves to { data, error } and never throws.
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

export const RELATIONSHIPS = [
  { value: 'branch', label: 'Branch', hint: 'Part of the same business, run from another location.' },
  { value: 'subsidiary', label: 'Subsidiary', hint: 'A separate company you own a share of.' },
  { value: 'franchise', label: 'Franchise', hint: 'Operates under your brand on its own books.' },
  { value: 'joint_venture', label: 'Joint venture', hint: 'Co-owned with other partners.' }
];

export const CMMS_ACCESS_LEVELS = [
  { value: 'none', label: 'Not shared', hint: 'In the tree, but its CMMS stays private.' },
  { value: 'summary', label: 'Totals only', hint: 'Branch totals appear in the parent’s consolidated report.' },
  { value: 'full', label: 'Full', hint: 'The parent’s admins can also read this branch’s asset register and ledger.' }
];

export const WALLET_CONTROL_LEVELS = [
  { value: 'none', label: 'Private', hint: 'The parent cannot see this branch’s wallet.' },
  { value: 'view', label: 'View', hint: 'The parent sees its balance and activity.' },
  { value: 'govern', label: 'Govern', hint: 'The parent also sets limits, assigns approvers, freezes, funds and sweeps the wallet.' }
];

export const accessRank = (level) => ({ full: 2, summary: 1 }[level] || 0);
export const walletRank = (level) => ({ govern: 2, view: 1 }[level] || 0);

/** The subtree below a business (itself at depth 0), flat and ordered by depth. */
export const getBranchTree = (businessId) => call('fn_business_branch_tree', { p_business_id: businessId });

/** Who owns this business, nearest owner first, up to the root. */
export const getOwnershipChain = (businessId) => call('fn_business_ownership_chain', { p_business_id: businessId });

export const getOwnershipHistory = (businessId) => call('fn_business_ownership_history', { p_business_id: businessId });

/** Proposals waiting on me (direction 'incoming') or on others ('outgoing'). */
export const getMyBranchRequests = () => call('fn_business_my_branch_requests');

/** My own businesses that are not part of a tree yet. */
export const getMyUnlinkedBusinesses = () => call('fn_business_my_unlinked_businesses');

export const searchBusinessesForBranch = (query) => call('fn_business_search_for_branch', { p_query: query });

export const proposeBranch = (parentId, childId, { relationship = 'branch', ownershipPercent = 100, cmmsAccess = 'summary', walletControl = 'none', notes = null } = {}) =>
  call('fn_business_propose_branch', {
    p_parent: parentId,
    p_child: childId,
    p_relationship: relationship,
    p_ownership_percent: ownershipPercent,
    p_cmms_access: cmmsAccess,
    p_wallet_control: walletControl,
    p_notes: notes
  });

export const respondToBranchRequest = (linkId, accept, cmmsAccess = null, walletControl = null) =>
  call('fn_business_respond_branch_link', { p_link_id: linkId, p_accept: accept, p_cmms_access: cmmsAccess, p_wallet_control: walletControl });

export const updateBranchArrangement = (linkId, { ownershipPercent = null, relationship = null, cmmsAccess = null, walletControl = null } = {}) =>
  call('fn_business_update_branch_link', {
    p_link_id: linkId,
    p_ownership_percent: ownershipPercent,
    p_relationship: relationship,
    p_cmms_access: cmmsAccess,
    p_wallet_control: walletControl
  });

export const endBranchLink = (linkId, reason = null) =>
  call('fn_business_end_branch_link', { p_link_id: linkId, p_reason: reason });

export default {
  RELATIONSHIPS, CMMS_ACCESS_LEVELS, WALLET_CONTROL_LEVELS, accessRank, walletRank,
  getBranchTree, getOwnershipChain, getOwnershipHistory, getMyBranchRequests, getMyUnlinkedBusinesses,
  searchBusinessesForBranch, proposeBranch, respondToBranchRequest, updateBranchArrangement, endBranchLink
};

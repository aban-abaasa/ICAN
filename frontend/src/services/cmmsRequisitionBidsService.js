/**
 * CMMS Requisition -> Supplier Bids (buyer side).
 *
 * An approved requisition can be opened to supplier businesses as an itemised
 * request for quotation. Suppliers price every item from the Supplier Portal;
 * the buyer compares the bids here and awards one, which raises the supplier
 * order and its business-wallet payment request. See
 * backend/CMMS_REQUISITION_SUPPLIER_BIDS.sql for the whole flow and its rules.
 *
 * Everything that changes state goes through an RPC (publish/award/cancel are
 * multi-table and must be atomic); reads use plain RLS-protected selects.
 */

import { supabase } from '../lib/supabase/client';

/** Turns a `YYYY-MM-DD` date input into the end of that day, local time. */
export const endOfDayIso = (dateString) => {
  if (!dateString) return null;
  const date = new Date(`${dateString}T23:59:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

export const publishRequisitionForBids = async (requisitionId, { deadline, notes, deliveryLocation }) => {
  const { data, error } = await supabase.rpc('cmms_publish_requisition_for_bids', {
    p_requisition_id: requisitionId,
    p_deadline: deadline,
    p_notes: notes?.trim() || null,
    p_delivery_location: deliveryLocation?.trim() || null,
  });
  if (error) return { success: false, error: error.message };
  return { success: true, data };
};

/** Every supply request (open or decided) raised from the given requisitions,
 * with the items asked for. Newest first, so the first match per requisition
 * is its current/latest tender. */
export const getTendersForRequisitions = async (requisitionIds) => {
  if (!requisitionIds?.length) return { success: true, data: [] };
  const { data, error } = await supabase
    .from('cmms_business_opportunities')
    .select('id, cmms_requisition_id, title, description, deadline, status, delivery_location, created_at, cmms_opportunity_items(id, item_name, description, quantity, unit, sort_order)')
    .in('cmms_requisition_id', requisitionIds)
    .eq('opportunity_kind', 'supply')
    .order('created_at', { ascending: false });
  if (error) return { success: false, error: error.message, data: [] };
  return { success: true, data: data || [] };
};

/** Bids on one supply request with each supplier's per-item prices. RLS limits
 * this to staff allowed to see the bids, so an empty list can also mean "not
 * permitted". */
export const getTenderBids = async (opportunityId) => {
  const { data, error } = await supabase
    .from('cmms_business_opportunity_bids')
    .select('id, bidder_name, bidder_contact, amount, proposal, status, lead_time_days, supplier_order_id, created_at, updated_at, cmms_opportunity_bid_items(opportunity_item_id, unit_price, notes)')
    .eq('opportunity_id', opportunityId)
    .eq('bidder_type', 'supplier')
    .order('amount', { ascending: true });
  if (error) return { success: false, error: error.message, data: [] };
  return { success: true, data: data || [] };
};

export const awardBid = async (bidId, deliveryDetails = {}) => {
  const { data, error } = await supabase.rpc('cmms_award_requisition_bid', {
    p_bid_id: bidId,
    p_delivery_details: deliveryDetails,
  });
  if (error) return { success: false, error: error.message };
  return { success: true, data };
};

export const cancelTender = async (opportunityId) => {
  const { error } = await supabase.rpc('cmms_cancel_requisition_tender', { p_opportunity_id: opportunityId });
  if (error) return { success: false, error: error.message };
  return { success: true };
};

/** The company's supplier orders (order number, payment state) -- same RPC
 * CMSSupplierPurchasePanel uses, since buyers cannot read the table directly. */
export const getCompanySupplierOrders = async (companyId) => {
  const { data, error } = await supabase.rpc('cmms_get_supplier_orders', { p_cmms_company_id: companyId });
  if (error) return { success: false, error: error.message, data: [] };
  return { success: true, data: data || [] };
};

export default {
  endOfDayIso,
  publishRequisitionForBids,
  getTendersForRequisitions,
  getTenderBids,
  awardBid,
  cancelTender,
  getCompanySupplierOrders,
};

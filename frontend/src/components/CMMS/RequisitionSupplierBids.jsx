import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Award, CheckCircle, Loader, Store } from 'lucide-react';
import cmmsRequisitionBidsService from '../../services/cmmsRequisitionBidsService';

const formatUgx = (value) => `UGX ${Number(value || 0).toLocaleString()}`;

const TENDER_STATUS = {
  open: { label: 'Open for bids', className: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' },
  awarded: { label: 'Awarded', className: 'bg-sky-500/20 text-sky-300 border-sky-500/40' },
  cancelled: { label: 'Cancelled', className: 'bg-slate-500/20 text-slate-300 border-slate-500/40' },
  closed: { label: 'Closed', className: 'bg-slate-500/20 text-slate-300 border-slate-500/40' },
};

const BID_STATUS_CLASS = {
  submitted: 'text-slate-300',
  under_review: 'text-amber-300',
  shortlisted: 'text-sky-300',
  selected: 'text-emerald-300',
  rejected: 'text-rose-300',
  withdrawn: 'text-slate-500',
};

const PAYMENT_LABEL = {
  not_requested: 'Payment not requested',
  pending_approval: 'Awaiting wallet approval (Approvals tab)',
  paid: 'Paid',
  rejected: 'Payment rejected',
  cancelled: 'Payment cancelled',
};

const inputClass = 'mt-1 w-full rounded-lg border border-white/15 bg-slate-950/45 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/60';

/**
 * The supplier-bidding side of one requisition (rendered inside its expanded
 * card in RequisitionWorkspace). Three states:
 *  - approved, no request yet  -> "Request supplier bids" (needs canSource)
 *  - request open / decided    -> the items asked for, the bids side by side,
 *                                 and (canSource) award / cancel
 *  - anything else             -> nothing, except a hint for purchasers
 *
 * Bids are private -- RLS only returns them to the buyer's purchasing staff --
 * so an empty list for a non-purchaser is expected, not an error.
 */
const RequisitionSupplierBids = ({ requisition, tender, companyId, canSource, canViewBids, onChanged }) => {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ deadline: '', deliveryLocation: '', notes: '' });
  const [bids, setBids] = useState([]);
  const [bidsLoading, setBidsLoading] = useState(false);
  const [orders, setOrders] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const tenderId = tender?.id;
  const tenderStatus = tender?.status;
  const items = useMemo(
    () => [...(tender?.cmms_opportunity_items || [])].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)),
    [tender]
  );
  const estimate = Number(requisition.estimatedCost || 0);

  const loadBids = useCallback(async () => {
    if (!tenderId || !canViewBids) return;
    setBidsLoading(true);
    const result = await cmmsRequisitionBidsService.getTenderBids(tenderId);
    setBids(result.data || []);
    setBidsLoading(false);
  }, [tenderId, canViewBids]);

  useEffect(() => { loadBids(); }, [loadBids]);

  useEffect(() => {
    if (tenderStatus !== 'awarded' || !companyId) return;
    cmmsRequisitionBidsService.getCompanySupplierOrders(companyId).then((result) => setOrders(result.data || []));
  }, [tenderStatus, companyId]);

  const cheapestId = useMemo(() => {
    const live = bids.filter((bid) => !['withdrawn', 'rejected'].includes(bid.status) && Number(bid.amount) > 0);
    if (live.length === 0) return null;
    return live.reduce((best, bid) => (Number(bid.amount) < Number(best.amount) ? bid : best)).id;
  }, [bids]);

  const minDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const handlePublish = async () => {
    const deadline = cmmsRequisitionBidsService.endOfDayIso(form.deadline);
    if (!deadline || new Date(deadline) <= new Date()) {
      setError('Choose a bid deadline in the future.');
      return;
    }
    setBusy(true);
    setError('');
    const result = await cmmsRequisitionBidsService.publishRequisitionForBids(requisition.id, {
      deadline,
      notes: form.notes,
      deliveryLocation: form.deliveryLocation,
    });
    setBusy(false);
    if (!result.success) { setError(result.error); return; }
    setShowForm(false);
    setForm({ deadline: '', deliveryLocation: '', notes: '' });
    onChanged?.();
  };

  const handleAward = async (bid) => {
    const total = formatUgx(bid.amount);
    if (!window.confirm(
      `Award this request to ${bid.bidder_name} for ${total}?\n\n` +
      'Every other bid will be rejected, a supplier order will be created, and a payment request will be sent to your wallet administrator for PIN approval. Funds move only when they approve.'
    )) return;
    setBusy(true);
    setError('');
    const result = await cmmsRequisitionBidsService.awardBid(bid.id);
    setBusy(false);
    if (!result.success) { setError(result.error); return; }
    onChanged?.();
  };

  const handleCancel = async () => {
    if (!window.confirm('Cancel this supplier bid request? Suppliers will no longer be able to bid, and the requisition returns to Approved.')) return;
    setBusy(true);
    setError('');
    const result = await cmmsRequisitionBidsService.cancelTender(tender.id);
    setBusy(false);
    if (!result.success) { setError(result.error); return; }
    onChanged?.();
  };

  const stop = (event) => event.stopPropagation();

  // ---- No request yet ----
  if (!tender) {
    if (requisition.status !== 'approved') {
      if (!canSource || !['pending_department_head', 'pending_finance'].includes(requisition.status)) return null;
      return (
        <div onClick={stop} className="mt-3 rounded-lg border border-dashed border-white/15 px-3 py-2 text-xs text-slate-400 flex items-center gap-2">
          <Store className="w-3.5 h-3.5 shrink-0" />
          Once this requisition is approved you can open it to suppliers and compare their bids.
        </div>
      );
    }
    if (!canSource) return null;
    return (
      <div onClick={stop} className="mt-3 rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-cyan-100 flex items-center gap-1.5"><Store className="w-4 h-4" /> Get supplier bids</p>
            <p className="text-xs text-slate-300 mt-1">
              Publish the items above as a bid opportunity. Suppliers see the items and quantities (not your estimate) and quote a price per item. You compare the bids and award one.
            </p>
          </div>
          {!showForm && (
            <button onClick={() => setShowForm(true)} className="shrink-0 rounded-lg bg-cyan-600 hover:bg-cyan-500 px-3 py-2 text-xs font-semibold text-white">
              Request supplier bids
            </button>
          )}
        </div>
        {showForm && (
          <div className="mt-3 grid sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] uppercase tracking-wide text-slate-300">Bids close on</label>
              <input type="date" min={minDate} value={form.deadline} onChange={(e) => setForm((f) => ({ ...f, deadline: e.target.value }))} className={inputClass} />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wide text-slate-300">Deliver to</label>
              <input type="text" value={form.deliveryLocation} onChange={(e) => setForm((f) => ({ ...f, deliveryLocation: e.target.value }))} placeholder="Address or site (optional)" className={inputClass} />
            </div>
            <div className="sm:col-span-2">
              <label className="text-[11px] uppercase tracking-wide text-slate-300">Notes for suppliers</label>
              <textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Brand, quality, warranty or delivery expectations (optional)" className={inputClass} />
            </div>
            <div className="sm:col-span-2 flex justify-end gap-2">
              <button onClick={() => { setShowForm(false); setError(''); }} className="px-3 py-2 text-xs text-slate-300 hover:text-white">Cancel</button>
              <button disabled={busy || !form.deadline} onClick={handlePublish} className="rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 px-4 py-2 text-xs font-semibold text-white">
                {busy ? 'Publishing…' : 'Publish for bids'}
              </button>
            </div>
          </div>
        )}
        {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
      </div>
    );
  }

  // ---- A request exists ----
  const status = TENDER_STATUS[tender.status] || TENDER_STATUS.closed;
  const deadlinePassed = tender.deadline && new Date(tender.deadline) <= new Date();
  const awardedBid = bids.find((bid) => bid.status === 'selected');
  const awardedOrder = awardedBid?.supplier_order_id ? orders.find((order) => order.id === awardedBid.supplier_order_id) : null;

  return (
    <div onClick={stop} className="mt-3 rounded-xl border border-cyan-500/30 bg-slate-950/40 p-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-cyan-100 flex items-center gap-1.5"><Store className="w-4 h-4" /> Supplier bids</p>
        <div className="flex items-center gap-2">
          <span className={`rounded-md border px-2 py-0.5 text-xs ${status.className}`}>{status.label}</span>
          {canSource && tender.status === 'open' && (
            <button disabled={busy} onClick={handleCancel} className="text-xs text-rose-300 hover:text-rose-200 disabled:opacity-50">Cancel request</button>
          )}
        </div>
      </div>

      <p className="text-xs text-slate-400">
        {tender.deadline ? `${deadlinePassed ? 'Closed' : 'Closes'} ${new Date(tender.deadline).toLocaleDateString()}` : 'No deadline'}
        {tender.delivery_location ? ` · Deliver to ${tender.delivery_location}` : ''}
        {tender.status === 'open' && deadlinePassed ? ' · Bidding has ended — choose a winner.' : ''}
      </p>

      {items.length > 0 && (
        <div className="rounded-lg border border-white/10 bg-slate-900/50 p-2">
          <p className="text-[11px] uppercase tracking-wide text-slate-400 mb-1">Items requested</p>
          <ul className="text-xs text-slate-200 space-y-0.5">
            {items.map((item) => (
              <li key={item.id}>{Number(item.quantity)} {item.unit} × {item.item_name}</li>
            ))}
          </ul>
        </div>
      )}

      {canViewBids ? (
        bidsLoading ? (
          <div className="flex items-center gap-2 text-xs text-slate-400"><Loader className="w-4 h-4 animate-spin" /> Loading bids…</div>
        ) : bids.length === 0 ? (
          <p className="text-xs text-slate-400">No bids yet. Suppliers see this request in their Supplier Portal.</p>
        ) : (
          <div className="space-y-2">
            {bids.map((bid) => {
              const priceByItem = new Map((bid.cmms_opportunity_bid_items || []).map((row) => [row.opportunity_item_id, row]));
              const overEstimate = estimate > 0 && Number(bid.amount) > estimate;
              const canAward = canSource && tender.status === 'open' && !['selected', 'rejected', 'withdrawn'].includes(bid.status);
              return (
                <div key={bid.id} className={`rounded-lg border p-2.5 ${bid.status === 'selected' ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-white/10 bg-slate-900/60'}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm text-white font-semibold">
                        {bid.bidder_name}
                        {bid.id === cheapestId && <span className="ml-2 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">Lowest</span>}
                      </p>
                      <p className="text-xs text-slate-400">
                        {bid.lead_time_days != null ? `Delivers in ${bid.lead_time_days} day${bid.lead_time_days === 1 ? '' : 's'}` : 'Delivery time not stated'}
                        {bid.bidder_contact ? ` · ${bid.bidder_contact}` : ''}
                      </p>
                      <p className={`text-xs mt-0.5 ${BID_STATUS_CLASS[bid.status] || 'text-slate-300'}`}>{bid.status.replace('_', ' ')}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-base font-bold text-amber-300">{formatUgx(bid.amount)}</p>
                      {estimate > 0 && (
                        <p className={`text-[11px] ${overEstimate ? 'text-rose-300' : 'text-emerald-300'}`}>
                          {overEstimate ? 'Over' : 'Under'} estimate by {formatUgx(Math.abs(Number(bid.amount) - estimate))}
                        </p>
                      )}
                    </div>
                  </div>

                  <table className="mt-2 w-full text-xs text-slate-300">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-wide text-slate-500">
                        <th className="text-left font-medium py-0.5">Item</th>
                        <th className="text-right font-medium py-0.5">Qty</th>
                        <th className="text-right font-medium py-0.5">Unit price</th>
                        <th className="text-right font-medium py-0.5">Line total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => {
                        const price = priceByItem.get(item.id);
                        return (
                          <tr key={item.id} className="border-t border-white/5">
                            <td className="py-0.5 pr-2">
                              {item.item_name}
                              {price?.notes && <span className="block text-[10px] text-slate-500">{price.notes}</span>}
                            </td>
                            <td className="py-0.5 text-right">{Number(item.quantity)} {item.unit}</td>
                            <td className="py-0.5 text-right">{price ? formatUgx(price.unit_price) : '—'}</td>
                            <td className="py-0.5 text-right">{price ? formatUgx(Number(item.quantity) * Number(price.unit_price)) : '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  {bid.proposal && bid.proposal !== 'Itemised quotation' && <p className="mt-2 text-xs text-slate-400">{bid.proposal}</p>}

                  {canAward && (
                    <div className="mt-2 flex justify-end">
                      <button disabled={busy} onClick={() => handleAward(bid)} className="flex items-center gap-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-3 py-1.5 text-xs font-semibold text-white">
                        <Award className="w-3.5 h-3.5" /> Award this bid
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      ) : (
        <p className="text-xs text-slate-400">Bids are private to purchasing and approving staff.</p>
      )}

      {tender.status === 'awarded' && awardedBid && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200 flex items-start gap-2">
          <CheckCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            Awarded to {awardedBid.bidder_name}.
            {awardedOrder ? ` Order ${awardedOrder.order_number} · ${PAYMENT_LABEL[awardedOrder.payment_status] || awardedOrder.payment_status}.` : ''}
          </span>
        </div>
      )}

      {error && <p className="text-xs text-rose-300">{error}</p>}
    </div>
  );
};

export default RequisitionSupplierBids;

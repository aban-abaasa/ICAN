import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle, Loader, ShoppingCart } from 'lucide-react';
import { supabase } from '../lib/supabase/client';

export default function CMSSupplierPurchasePanel({ companyId, requisitionId = null, canOrder = false }) {
  const [catalog, setCatalog] = useState([]);
  const [orders, setOrders] = useState([]);
  const [supplierId, setSupplierId] = useState('');
  const [itemId, setItemId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const suppliers = useMemo(() => [...new Map(catalog.map(item => [item.supplier_business_profile_id, item])).values()], [catalog]);
  const supplierItems = catalog.filter(item => item.supplier_business_profile_id === supplierId);
  const selectedItem = catalog.find(item => item.catalog_item_id === itemId);

  const load = async () => {
    if (!companyId) return;
    setLoading(true);
    const [catalogResult, ordersResult] = await Promise.all([
      supabase.rpc('cmms_get_supplier_catalog', { p_cmms_company_id: companyId }),
      supabase.rpc('cmms_get_supplier_orders', { p_cmms_company_id: companyId })
    ]);
    if (catalogResult.error) {
      setCatalog([]);
      setError(`Unable to load real suppliers: ${catalogResult.error.message}`);
    } else {
      setCatalog(catalogResult.data || []);
      setError('');
    }
    if (!ordersResult.error) setOrders(ordersResult.data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [companyId]);

  const placeOrder = async event => {
    event.preventDefault();
    if (!supplierId || !itemId || Number(quantity) <= 0) return;
    setSaving(true); setError(''); setMessage('');
    const { data, error: orderError } = await supabase.rpc('cmms_create_supplier_purchase_order', {
      p_cmms_company_id: companyId,
      p_supplier_business_profile_id: supplierId,
      p_catalog_item_id: itemId,
      p_quantity: Number(quantity),
      p_delivery_details: { address: deliveryAddress || null },
      p_cmms_requisition_id: requisitionId
    });
    if (orderError) setError(orderError.message);
    else {
      setOrders(previous => [data, ...previous]);
      setMessage(`Supplier order ${data.order_number} submitted.`);
      setQuantity('1'); setDeliveryAddress('');
    }
    setSaving(false);
  };

  return <div className="mb-6 rounded-xl border border-cyan-400/30 bg-cyan-500/10 p-4">
    <div className="flex items-center gap-2 mb-3"><ShoppingCart className="w-5 h-5 text-cyan-300" /><h3 className="font-bold text-white">Order from supplier</h3></div>
    <p className="text-xs text-gray-300 mb-3">Create a supplier marketplace purchase order from CMMS inventory or a requisition.</p>
    {loading ? <div className="flex items-center gap-2 text-gray-300"><Loader className="w-4 h-4 animate-spin" /> Loading supplier catalogs…</div> : <>
      {canOrder ? <form onSubmit={placeOrder} className="grid md:grid-cols-4 gap-2">
        <select value={supplierId} onChange={e => { setSupplierId(e.target.value); setItemId(''); }} className="rounded bg-slate-900 border border-white/20 px-2 py-2 text-white"><option value="">Select supplier</option>{suppliers.map(item => <option key={item.supplier_business_profile_id} value={item.supplier_business_profile_id}>{item.supplier_business_name}</option>)}</select>
        <select required value={itemId} onChange={e => setItemId(e.target.value)} className="rounded bg-slate-900 border border-white/20 px-2 py-2 text-white"><option value="">Select catalog item</option>{supplierItems.map(item => <option key={item.catalog_item_id} value={item.catalog_item_id}>{item.item_name} · {item.price_tag || `${item.currency || 'UGX'} ${Number(item.price_per_unit || 0).toLocaleString()} / ${item.unit || 'unit'}`}</option>)}</select>
        <input type="number" min={selectedItem?.min_order_qty || 1} step="any" value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="Quantity" className="rounded bg-slate-900 border border-white/20 px-2 py-2 text-white" />
        <input value={deliveryAddress} onChange={e => setDeliveryAddress(e.target.value)} placeholder="Delivery address" className="rounded bg-slate-900 border border-white/20 px-2 py-2 text-white" />
        <button disabled={saving || !supplierId || !itemId} className="md:col-span-4 justify-center rounded bg-cyan-600 hover:bg-cyan-500 px-3 py-2 font-semibold text-white flex items-center gap-2">{saving ? <Loader className="w-4 h-4 animate-spin" /> : <ShoppingCart className="w-4 h-4" />} Submit supplier order</button>
        {selectedItem && <div className="md:col-span-4 flex items-center gap-3 rounded-lg bg-black/20 p-2 text-xs text-gray-200">
          {selectedItem.image_url ? <img src={selectedItem.image_url} alt={selectedItem.item_name} className="h-12 w-12 rounded object-cover" /> : <div className="h-12 w-12 rounded bg-white/10 flex items-center justify-center text-gray-500">No image</div>}
          <div><div className="font-semibold text-white">{selectedItem.item_name}</div><div>{selectedItem.price_tag || `${selectedItem.currency || 'UGX'} ${Number(selectedItem.price_per_unit || 0).toLocaleString()} / ${selectedItem.unit || 'unit'}`}</div></div>
        </div>}
      </form> : <p className="text-xs text-amber-200">Your role can view supplier orders but cannot create them.</p>}
      {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
      {message && <p className="mt-2 text-sm text-emerald-300 flex items-center gap-1"><CheckCircle className="w-4 h-4" />{message}</p>}
      {orders.length > 0 && <div className="mt-4 space-y-1"><p className="text-xs uppercase text-gray-400">Recent supplier orders</p>{orders.slice(0, 5).map(order => <div key={order.id} className="flex justify-between rounded bg-black/20 px-2 py-1 text-xs text-gray-200"><span>{order.order_number}</span><span>{order.status} · {order.quantity} {order.currency}</span></div>)}</div>}
    </>}
  </div>;
}

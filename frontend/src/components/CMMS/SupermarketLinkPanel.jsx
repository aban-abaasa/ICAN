import React, { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Loader, Store } from 'lucide-react';
import {
  SUPERMARKET_URL,
  getLinkedSupermarket,
  getSupermarketStockLink,
  linkItemToProduct,
  linkSupermarket,
  listMySupermarkets,
  searchSupermarketProducts,
  transferStockToSupermarket,
  unlinkSupermarket
} from '../../services/cmmsAssetLedgerService';

const field = 'rounded border border-white border-opacity-20 bg-white bg-opacity-10 px-3 py-2 text-sm text-white';

// Store room (CMMS consumables) <-> shop floor (supermartkera.icanera.space).
// Items are mapped to supermarket products; stock moves between the two in one
// transaction, and the CMMS side lands in the ledger as a signed transfer.
export default function SupermarketLinkPanel({ companyId, items = [], canAdmin, canEdit, onChanged }) {
  const [linked, setLinked] = useState(null);
  const [mine, setMine] = useState([]);
  const [pick, setPick] = useState('');
  const [stock, setStock] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [mapItemId, setMapItemId] = useState('');
  const [productQuery, setProductQuery] = useState('');
  const [products, setProducts] = useState([]);
  const [move, setMove] = useState({});

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    const { data: sm } = await getLinkedSupermarket(companyId);
    setLinked(sm || null);
    if (sm) {
      const { data } = await getSupermarketStockLink(companyId);
      setStock(data || []);
    } else {
      setStock([]);
      const { data } = await listMySupermarkets();
      setMine(data || []);
    }
    setLoading(false);
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const act = async (fn, success) => {
    setBusy(true); setError(''); setNotice('');
    const { error: actionError } = await fn();
    setBusy(false);
    if (actionError) { setError(actionError.message); return false; }
    if (success) setNotice(success);
    await load();
    onChanged?.();
    return true;
  };

  const searchProducts = async (value) => {
    setProductQuery(value);
    const { data } = await searchSupermarketProducts(companyId, value);
    setProducts(data || []);
  };

  const consumables = items.filter((item) => (item.item_kind || 'consumable') === 'consumable' && !item.linked_product_id);

  if (loading) return <p className="flex items-center gap-2 text-sm text-gray-400"><Loader className="h-4 w-4 animate-spin" /> Checking the supermarket link…</p>;

  if (!linked) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-gray-300">
          Link this branch to its supermarket on <a className="text-amber-300 underline" href={SUPERMARKET_URL} target="_blank" rel="noopener noreferrer">supermartkera.icanera.space</a> to
          move stock between the store room and the shop floor with a signed record on both sides.
        </p>
        {error && <p className="text-xs text-red-300">{error}</p>}
        {!canAdmin ? <p className="text-xs text-gray-400">Only the branch administrator can link a supermarket.</p>
          : mine.length === 0 ? <p className="text-xs text-gray-400">You do not own or manage a supermarket yet. Create one on the supermarket platform first.</p>
          : (
            <div className="flex flex-wrap items-center gap-2">
              <select value={pick} onChange={(event) => setPick(event.target.value)} className={field} aria-label="Supermarket">
                <option value="">Choose your supermarket…</option>
                {mine.map((store) => <option key={store.id} value={store.id}>{store.name}{store.city ? ` · ${store.city}` : ''}</option>)}
              </select>
              <button disabled={!pick || busy} onClick={() => act(() => linkSupermarket(companyId, pick), 'Supermarket linked.')} className="cmms-classic-btn-primary px-3 py-2 text-xs disabled:opacity-40">Link</button>
            </div>
          )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Store className="h-4 w-4 text-amber-300" />
        <span className="font-semibold text-white">{linked.name}</span>
        <span className="text-xs text-gray-400">{[linked.city, linked.country].filter(Boolean).join(', ')}</span>
        <a href={SUPERMARKET_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-amber-300 hover:text-amber-200">Open <ExternalLink className="h-3 w-3" /></a>
        {canAdmin && <button type="button" onClick={() => window.confirm('Unlink the supermarket? Item mappings are cleared; the ledger keeps its history.') && act(() => unlinkSupermarket(companyId), 'Unlinked.')} className="ml-auto text-xs text-red-300 hover:text-red-200">Unlink</button>}
      </div>

      {error && <p className="rounded border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-200">{error}</p>}
      {notice && <p className="rounded border border-emerald-500/40 bg-emerald-500/10 p-2 text-xs text-emerald-200">{notice}</p>}

      {canEdit && (
        <div className="space-y-2 rounded-lg border border-white border-opacity-10 bg-white bg-opacity-5 p-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-300">Map a consumable to a shop product</p>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <select value={mapItemId} onChange={(event) => setMapItemId(event.target.value)} className={field} aria-label="Consumable">
              <option value="">Store-room item…</option>
              {consumables.map((item) => <option key={item.id} value={item.id}>{item.item_name}</option>)}
            </select>
            <input value={productQuery} onChange={(event) => searchProducts(event.target.value)} onFocus={() => !products.length && searchProducts('')} placeholder="Search shop products" className={field} />
          </div>
          {products.length > 0 && mapItemId && (
            <ul className="max-h-40 space-y-1 overflow-y-auto">
              {products.map((product) => (
                <li key={product.product_id}>
                  <button type="button" disabled={busy} onClick={() => act(() => linkItemToProduct(mapItemId, product.product_id), 'Mapped.').then((ok) => ok && setMapItemId(''))}
                    className="flex w-full items-center justify-between rounded bg-white bg-opacity-10 px-3 py-2 text-left text-sm text-white hover:bg-opacity-20">
                    <span>{product.name}<span className="ml-2 text-xs text-gray-400">{product.sku}</span></span>
                    <span className="text-xs text-gray-300">{Number(product.current_stock)} on the floor</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {stock.length === 0 ? <p className="text-sm text-gray-400">No items are mapped to shop products yet.</p> : (
        <ul className="divide-y divide-white divide-opacity-10">
          {stock.map((row) => (
            <li key={row.item_id} className="space-y-2 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold text-white">{row.item_name} <span className="font-normal text-gray-400">→ {row.product_name}</span></span>
                <span className="text-xs text-gray-300">Store room <strong className="text-white">{Number(row.store_quantity)}</strong> · Shop floor <strong className="text-white">{Number(row.shop_quantity)}</strong></span>
              </div>
              {canEdit && (
                <div className="flex flex-wrap items-center gap-2">
                  <input type="number" min="1" value={move[row.item_id] ?? ''} placeholder="Qty" onChange={(event) => setMove((previous) => ({ ...previous, [row.item_id]: event.target.value }))}
                    className={`${field} w-24`} aria-label="Quantity to move" />
                  <button type="button" disabled={busy || !Number(move[row.item_id])}
                    onClick={() => act(() => transferStockToSupermarket(row.item_id, Number(move[row.item_id]), 'to_shop'), 'Sent to the shop floor.')}
                    className="cmms-classic-btn-primary px-3 py-2 text-xs disabled:opacity-40">Send to shop →</button>
                  <button type="button" disabled={busy || !Number(move[row.item_id])}
                    onClick={() => act(() => transferStockToSupermarket(row.item_id, Number(move[row.item_id]), 'to_store'), 'Returned to the store room.')}
                    className="cmms-classic-btn-secondary px-3 py-2 text-xs disabled:opacity-40">← Back to store</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

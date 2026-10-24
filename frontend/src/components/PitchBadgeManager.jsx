import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Clock, Loader, Pencil, Plus, Sparkles, Tag, Trash2, X } from 'lucide-react';
import PitchProductBadgeOverlay from './PitchProductBadgeOverlay';
import {
  listBadgesToManage, listStatusBadgesToManage, listBadgeProducts, saveBadge, saveStatusBadge, deleteBadge, publishBadge,
} from '../services/pitchBadgeService';
import {
  POSITIONS, BADGE_MAX_PER_VIDEO, BADGE_MAX_PER_STATUS, DEFAULT_SHOW_SECONDS, autoPlaceBadges, formatBadgePrice, formatClock, badgeStatus, canRenew,
  publishLabel, badgeFormToArgs, statusBadgeFormToArgs, badgeFormProblem,
} from '../utils/pitchBadges';

/**
 * Product badges for ONE pitch video or ONE status update: add the products you sell, choose the seconds they appear, and publish them. Used in
 * PitchIn (the pitch owner's "Product badges" button), in CMMS > Announcements > Video badges (staff who may edit the public board), and on the
 * owner's own status. The database decides who may do what (supabase/migrations/20261119100000_video_product_badges.sql); this screen only mirrors it:
 *   * a badge linked to a store product reads its name, photo, price and stock live, so it never shows a stale price
 *   * a pitch badge runs 30 days once published; a status badge lasts as long as the status (24 hours). The prices (Free to start) are set in the developer panel
 *   * only the business owner can pay for a badge; staff can prepare pitch drafts and publish while it is free
 *
 *   kind               'pitch' (default) or 'status'
 *   pitch              { id, title, video_url, video_duration_seconds? }           (kind 'pitch')
 *   status             { id, media_type, media_url }                                 (kind 'status': the signed-in user's own status)
 *   businessProfileId  the business that owns the pitch (whose store products can be badged); a status lets the owner choose among their businesses
 */

const inputClass = 'w-full rounded bg-slate-900 border border-white/20 px-3 py-2 text-white text-sm';
const labelClass = 'block text-xs text-slate-300 mb-1';
const TONE_CLASSES = {
  draft: 'bg-slate-500/20 text-slate-300 border-slate-400/30',
  live: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30',
  warn: 'bg-amber-500/15 text-amber-300 border-amber-400/30',
  ended: 'bg-red-500/15 text-red-300 border-red-400/30',
};

const emptyForm = (startsAt = 0) => ({ source: 'store', productId: '', label: '', price: '', currency: 'UGX', imageUrl: '', startsAt, duration: DEFAULT_SHOW_SECONDS, position: 'bottom-left' });

const formFromBadge = (b) => ({
  source: b.linked ? 'store' : 'typed',
  productId: b.product_id || '',
  label: b.linked ? '' : b.name || '',
  price: b.linked ? '' : String(b.price ?? ''),
  currency: b.currency || 'UGX',
  imageUrl: b.linked ? '' : b.image_url || '',
  startsAt: b.starts_at_sec,
  duration: b.duration_sec,
  position: b.position,
});

export default function PitchBadgeManager({ kind = 'pitch', pitch = null, status = null, businessProfileId = '', className = '' }) {
  const isStatus = kind === 'status';
  const target = isStatus ? status : pitch;
  const videoWrapRef = useRef(null);
  const [state, setState] = useState({ loading: true, error: '', missing: false, data: null });
  const [products, setProducts] = useState(null); // null = not loaded yet
  const [chosenBusiness, setChosenBusiness] = useState(''); // a status: which of the owner's businesses is advertised
  const [form, setForm] = useState(null);         // null = closed; otherwise the add / edit form
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState(null);   // { kind: 'ok' | 'error', text }

  const load = useCallback(async () => {
    const res = await (isStatus ? listStatusBadgesToManage(target.id) : listBadgesToManage(target.id));
    if (!res.ok) { setState({ loading: false, error: res.error, missing: !!res.missing, data: null }); return; }
    setState({ loading: false, error: '', missing: false, data: res.data });
    if (isStatus) {
      const owned = res.data.businesses || [];
      setChosenBusiness((current) => res.data.business_profile_id || (owned.some((b) => b.id === current) ? current : (owned.length === 1 ? owned[0].id : '')));
    }
  }, [target.id, isStatus]);

  useEffect(() => {
    setState({ loading: true, error: '', missing: false, data: null });
    setForm(null); setEditingId(null); setMessage(null);
    load();
  }, [load]);

  const data = state.data;
  const badges = useMemo(() => data?.badges || [], [data]);
  const videoSeconds = isStatus ? 0 : (Number(data?.video_duration_seconds) || Number(pitch.video_duration_seconds) || 0);
  const timed = !isStatus || data?.always_on === false;           // a photo or text status has no timeline
  const businessId = isStatus ? chosenBusiness : businessProfileId;
  const maxBadges = isStatus ? BADGE_MAX_PER_STATUS : BADGE_MAX_PER_VIDEO;
  const previewVideo = isStatus ? (status.media_type === 'video' ? status.media_url : null) : pitch.video_url;
  const previewImage = isStatus && status.media_type === 'image' ? status.media_url : null;
  const price = data?.price || { price_ic: 0, charged: false, days: 30 };
  const canPay = !!data?.can_pay;

  const openForm = (badge = null) => {
    setMessage(null);
    setEditingId(badge ? badge.id : null);
    setForm(badge ? formFromBadge(badge) : emptyForm(Math.floor(videoWrapRef.current?.querySelector('video')?.currentTime || 0)));
  };
  // the products to pick from: loaded when the form opens, and again if a status owner picks a different business
  useEffect(() => { setProducts(null); }, [businessId]);
  useEffect(() => {
    if (!form || products !== null || !businessId) return;
    listBadgeProducts(businessId).then((res) => setProducts(res.ok && Array.isArray(res.data) ? res.data : []));
  }, [form, products, businessId]);
  const closeForm = () => { setForm(null); setEditingId(null); };

  const update = (patch) => setForm((f) => ({ ...f, ...patch }));
  const useCurrentTime = () => {
    const t = videoWrapRef.current?.querySelector('video')?.currentTime;
    if (Number.isFinite(t)) update({ startsAt: Math.floor(t) });
  };

  const submit = async (e) => {
    e.preventDefault();
    const problem = badgeFormProblem(form, videoSeconds, { timed });
    if (problem) { setMessage({ kind: 'error', text: problem }); return; }
    if (isStatus && !businessId) { setMessage({ kind: 'error', text: 'Choose which of your businesses you are advertising.' }); return; }
    setBusy('save'); setMessage(null);
    const res = await (isStatus
      ? saveStatusBadge(statusBadgeFormToArgs(target.id, businessId, form, editingId))
      : saveBadge(badgeFormToArgs(target.id, form, editingId)));
    setBusy('');
    if (!res.ok) { setMessage({ kind: 'error', text: res.error }); return; }
    closeForm();
    setMessage({ kind: 'ok', text: editingId ? 'Badge updated.' : 'Badge added as a draft. Publish it to show it in the video.' });
    load();
  };

  const remove = async (badge) => {
    if (!window.confirm(`Remove the “${badge.name}” badge?${badge.is_live ? ' It is paid for until its end date and will not be refunded.' : ''}`)) return;
    setBusy(`delete:${badge.id}`); setMessage(null);
    const res = await deleteBadge(badge.id, target.id);
    setBusy('');
    if (!res.ok) { setMessage({ kind: 'error', text: res.error }); return; }
    load();
  };

  const publish = async (badge) => {
    setBusy(`publish:${badge.id}`); setMessage(null);
    const res = await publishBadge(badge.id, target.id);
    setBusy('');
    if (!res.ok) { setMessage({ kind: 'error', text: res.error }); return; }
    if (!res.data?.success) { setMessage({ kind: 'error', text: res.data?.error || 'That did not work.' }); return; }
    const paid = Number(res.data.paid_ic) || 0;
    setMessage({ kind: 'ok', text: paid > 0 ? `Published. ${paid} IC was taken from the business wallet.` : 'Published. It is free right now.' });
    load();
  };

  // Spread every badge evenly over the video, in the order they are now.
  const autoPlace = async () => {
    if (badges.length === 0) return;
    if (!window.confirm('Spread all the badges evenly across the video? You can still change any of them afterwards.')) return;
    setBusy('auto'); setMessage(null);
    const slots = autoPlaceBadges(badges.length, videoSeconds);
    for (let i = 0; i < badges.length; i += 1) {
      const b = badges[i];
      const res = await saveBadge(badgeFormToArgs(target.id, { ...formFromBadge(b), startsAt: slots[i].starts_at_sec, duration: slots[i].duration_sec }, b.id));
      if (!res.ok) { setBusy(''); setMessage({ kind: 'error', text: res.error }); load(); return; }
    }
    setBusy('');
    setMessage({ kind: 'ok', text: 'Badges placed across the video.' });
    load();
  };

  if (state.loading) return <div className="flex justify-center py-8"><Loader className="w-6 h-6 animate-spin text-slate-400" /></div>;
  if (state.missing) return <p className="text-sm text-slate-300 py-4">Product badges are not switched on yet. The platform team turns them on from the database.</p>;
  if (state.error) return <p role="alert" className="text-sm text-red-300 py-4 flex items-start gap-2"><AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />{state.error}</p>;

  const atLimit = badges.length >= maxBadges;
  const owned = data?.businesses || [];
  const businessLocked = isStatus && !!data?.business_profile_id;
  const noBusiness = isStatus && owned.length === 0;
  const previewBadges = badges.filter((b) => !b.problem);
  const selectedProduct = products?.find((p) => p.product_id === form?.productId);

  return (
    <div className={`space-y-4 ${className}`}>
      <div className="rounded-xl border border-white/10 bg-slate-800/60 p-3 text-sm text-slate-200 flex items-start gap-2.5">
        <Tag className="w-4 h-4 mt-0.5 text-amber-300 flex-shrink-0" />
        <p>
          {isStatus
            ? <>Show a product&apos;s name and price over your status. Viewers tap the badge to shop. It stays up for as long as the status does.</>
            : <>Show a product&apos;s name and price over this video at the moment you talk about it. Viewers tap the badge to shop.</>}
          {' '}<strong className="text-white">{Number(price.price_ic) > 0
            ? (isStatus ? `Each badge costs ${Number(price.price_ic)} IC per status.` : `Each badge costs ${Number(price.price_ic)} IC for ${price.days} days.`)
            : (isStatus ? 'Free right now.' : `Free right now: each badge runs ${price.days} days.`)}</strong>
          {Number(price.price_ic) > 0 && !canPay && !isStatus && ' Only the business owner can pay; you can prepare drafts for them.'}
        </p>
      </div>

      {previewVideo && (
        <div ref={videoWrapRef} className="relative rounded-xl overflow-hidden bg-black max-h-72">
          <video src={previewVideo} controls playsInline preload="metadata" className="w-full max-h-72 object-contain bg-black" />
          <PitchProductBadgeOverlay badges={previewBadges} className="!z-10" />
        </div>
      )}
      {previewImage && (
        <div className="relative rounded-xl overflow-hidden bg-black max-h-72">
          <img src={previewImage} alt="Your status" className="w-full max-h-72 object-contain bg-black" />
          <PitchProductBadgeOverlay badges={previewBadges} alwaysOn className="!z-10" />
        </div>
      )}
      {(previewVideo || previewImage) && <p className="text-[11px] text-slate-400 -mt-2">This preview shows your drafts too, so you can check how it looks before publishing.</p>}

      {isStatus && !noBusiness && (
        <div>
          <label className={labelClass} htmlFor="pbm-business">Business you are advertising</label>
          {businessLocked || owned.length === 1
            ? <p className="text-sm text-white">{owned.find((b) => b.id === businessId)?.name || owned[0]?.name}</p>
            : (
              <select id="pbm-business" value={chosenBusiness} onChange={(e) => setChosenBusiness(e.target.value)} className={inputClass}>
                <option value="">Choose a business…</option>
                {owned.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            )}
          {!businessLocked && owned.length > 1 && <p className="text-[11px] text-slate-400 mt-1">All the badges on one status must be from the same business.</p>}
        </div>
      )}
      {noBusiness && <p className="text-sm text-amber-300">You need a business with a store to advertise its products. Create one in PitchIn first.</p>}
      {isStatus && data?.ended && <p className="text-sm text-amber-300">This status has ended, so it can no longer take badges.</p>}

      {message && (
        <p role="status" className={`text-sm flex items-start gap-2 ${message.kind === 'error' ? 'text-red-300' : 'text-emerald-300'}`}>
          {message.kind === 'error' ? <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> : <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />}{message.text}
        </p>
      )}

      {badges.length === 0 && !form && (
        <p className="text-sm text-slate-300 text-center py-3">{isStatus ? 'No badges on this status yet.' : 'No badges on this video yet.'}</p>
      )}

      <ul className="space-y-2">
        {badges.map((b) => {
          const status = badgeStatus(b);
          const renewable = !isStatus && canRenew(b);
          const publishable = !(isStatus && data?.ended) && (b.status !== 'live' || renewable);
          return (
            <li key={b.id} className="rounded-xl border border-white/10 bg-slate-800/60 p-3">
              <div className="flex items-start gap-3">
                {b.image_url
                  ? <img src={b.image_url} alt="" className="w-12 h-12 rounded-lg object-cover bg-slate-700 flex-shrink-0" />
                  : <span className="w-12 h-12 rounded-lg bg-slate-700 flex items-center justify-center flex-shrink-0"><Tag className="w-5 h-5 text-slate-400" /></span>}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-white truncate">{b.name || 'Product'}</p>
                  <p className="text-sm text-amber-300 font-bold">{b.price != null ? formatBadgePrice(b.price, b.currency) : 'Unavailable'}{b.linked && <span className="ml-2 text-[10px] font-normal text-slate-400">live from your store</span>}</p>
                  <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5"><Clock className="w-3 h-3" />at {formatClock(b.starts_at_sec)} for {b.duration_sec}s · {POSITIONS.find((p) => p.id === b.position)?.label}</p>
                  <span className={`inline-block mt-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full border ${TONE_CLASSES[status.tone]}`}>{status.text}</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                {publishable && (
                  <button type="button" onClick={() => publish(b)} disabled={!!busy} className="min-h-[40px] px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold disabled:opacity-50 inline-flex items-center gap-1.5">
                    {busy === `publish:${b.id}` && <Loader className="w-3.5 h-3.5 animate-spin" />}{publishLabel(b, price, isStatus)}
                  </button>
                )}
                <button type="button" onClick={() => openForm(b)} disabled={!!busy} className="min-h-[40px] px-3 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-xs font-semibold disabled:opacity-50 inline-flex items-center gap-1.5"><Pencil className="w-3.5 h-3.5" />Edit</button>
                <button type="button" onClick={() => remove(b)} disabled={!!busy} className="min-h-[40px] px-3 rounded-lg bg-slate-700 hover:bg-red-600 text-white text-xs font-semibold disabled:opacity-50 inline-flex items-center gap-1.5"><Trash2 className="w-3.5 h-3.5" />Remove</button>
              </div>
            </li>
          );
        })}
      </ul>

      {!form && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => openForm()} disabled={atLimit || !!busy || noBusiness || (isStatus && (!businessId || data?.ended))} className="min-h-[44px] px-4 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold disabled:opacity-50 inline-flex items-center gap-2"><Plus className="w-4 h-4" />Add a product badge</button>
          {!isStatus && badges.length > 1 && (
            <button type="button" onClick={autoPlace} disabled={!!busy} className="min-h-[44px] px-4 rounded-xl bg-slate-700 hover:bg-slate-600 text-white text-sm font-semibold disabled:opacity-50 inline-flex items-center gap-2">
              {busy === 'auto' ? <Loader className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}Spread them across the video
            </button>
          )}
          {atLimit && <p className="text-xs text-slate-400 self-center">{isStatus ? 'A status' : 'A video'} can carry up to {maxBadges} badges.</p>}
        </div>
      )}

      {form && (
        <form onSubmit={submit} className="rounded-xl border border-purple-400/30 bg-slate-800/80 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-white">{editingId ? 'Edit badge' : 'New badge'}</p>
            <button type="button" onClick={closeForm} aria-label="Close" className="p-1 text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
          </div>

          <div className="flex gap-2" role="radiogroup" aria-label="Where the product comes from">
            {[['store', 'From my store'], ['typed', 'Type it']].map(([id, text]) => (
              <button key={id} type="button" role="radio" aria-checked={form.source === id}
                onClick={() => update({ source: id, productId: id === 'typed' ? '' : form.productId })}
                className={`flex-1 min-h-[40px] rounded-lg text-xs font-semibold border ${form.source === id ? 'bg-purple-600 border-purple-400 text-white' : 'bg-slate-900 border-white/20 text-slate-300'}`}>{text}</button>
            ))}
          </div>

          {form.source === 'store' ? (
            <div>
              <label className={labelClass} htmlFor="pbm-product">Product</label>
              {products === null ? <p className="text-xs text-slate-400">Loading your products…</p>
                : products.length === 0 ? <p className="text-xs text-amber-300">No products found in your store. Use “Type it” instead, or add products to your store first.</p>
                : (
                  <select id="pbm-product" value={form.productId} onChange={(e) => update({ productId: e.target.value })} className={inputClass}>
                    <option value="">Choose a product…</option>
                    {products.map((p) => <option key={p.product_id} value={p.product_id}>{p.name} · {formatBadgePrice(p.price, p.currency)}</option>)}
                  </select>
                )}
              {selectedProduct && <p className="text-[11px] text-slate-400 mt-1">The badge always shows this product&apos;s current price and hides itself when it sells out.</p>}
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className={labelClass} htmlFor="pbm-name">Name</label>
                <input id="pbm-name" value={form.label} maxLength={80} onChange={(e) => update({ label: e.target.value })} className={inputClass} placeholder="e.g. Gift box" />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className={labelClass} htmlFor="pbm-price">Price</label>
                  <input id="pbm-price" value={form.price} inputMode="decimal" onChange={(e) => update({ price: e.target.value.replace(/[^0-9.]/g, '') })} className={inputClass} placeholder="25000" />
                </div>
                <div>
                  <label className={labelClass} htmlFor="pbm-cur">Currency</label>
                  <input id="pbm-cur" value={form.currency} maxLength={3} onChange={(e) => update({ currency: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') })} className={inputClass} />
                </div>
              </div>
              <div>
                <label className={labelClass} htmlFor="pbm-img">Photo link (optional)</label>
                <input id="pbm-img" value={form.imageUrl} onChange={(e) => update({ imageUrl: e.target.value })} className={inputClass} placeholder="https://…" />
              </div>
            </div>
          )}

          {timed && <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelClass} htmlFor="pbm-start">Appears at (seconds)</label>
              <div className="flex gap-1.5">
                <input id="pbm-start" type="number" min="0" value={form.startsAt} onChange={(e) => update({ startsAt: e.target.value })} className={inputClass} />
                {previewVideo && <button type="button" onClick={useCurrentTime} title="Use the preview's current time" className="px-2 rounded bg-slate-700 hover:bg-slate-600 text-white text-[11px] font-semibold whitespace-nowrap">Now</button>}
              </div>
              <p className="text-[11px] text-slate-400 mt-1">{formatClock(form.startsAt)}{videoSeconds > 0 ? ` of ${formatClock(videoSeconds)}` : ''}</p>
            </div>
            <div>
              <label className={labelClass} htmlFor="pbm-dur">Shows for (seconds)</label>
              <input id="pbm-dur" type="number" min="2" max="60" value={form.duration} onChange={(e) => update({ duration: e.target.value })} className={inputClass} />
            </div>
          </div>}
          {!timed && <p className="text-[11px] text-slate-400">This status is a photo or text, so the badge stays on screen the whole time.</p>}
          <div>
            <label className={labelClass} htmlFor="pbm-pos">{isStatus ? 'Where on the status' : 'Where on the video'}</label>
            <select id="pbm-pos" value={form.position} onChange={(e) => update({ position: e.target.value })} className={inputClass}>
              {POSITIONS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>

          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={busy === 'save'} className="min-h-[44px] px-4 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold disabled:opacity-50 inline-flex items-center gap-2">
              {busy === 'save' && <Loader className="w-4 h-4 animate-spin" />}{editingId ? 'Save changes' : 'Add badge'}
            </button>
            <button type="button" onClick={closeForm} className="min-h-[44px] px-4 rounded-xl bg-slate-700 hover:bg-slate-600 text-white text-sm font-semibold">Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ShoppingBag } from 'lucide-react';
import { getPitchBadges, getStatusBadges } from '../services/pitchBadgeService';
import { badgesAt, badgeShopHref, formatBadgePrice, POSITION_CLASSES, BOTTOM_OFFSET_PX } from '../utils/pitchBadges';

/**
 * Product badges over a PitchIn video or a status update: at the seconds the business chose, a small card with the product's photo, name and price slides
 * in, and tapping it opens the business's Market (supabase/migrations/20261119100000_video_product_badges.sql).
 *
 * Put it INSIDE the element that wraps the <video> (that element must be `relative`). It finds the video itself and follows its clock,
 * so it works with the feed, the full-screen player and the shared-link viewer without touching their playback code.
 *
 *   pitchId      whose badges to show (fetched once the video is on screen; nothing is requested for a card that is scrolled past)
 *   statusId     the same for a status update, instead of pitchId. A photo or text status has no timeline, so its badges stay on screen throughout
 *   badges       optional: show exactly these instead (the owner's preview, which includes drafts); no network call is made
 *   alwaysOn     with `badges`: keep them all on screen (a photo or text status)
 *   siteCompanyId  with `badges`: where a tap goes
 *   bottomOffset   pixels between the bottom badges and the bottom edge; raise it where the player shows its own text there
 *
 * Renders nothing when the pitch has no live badges, when the SQL is not installed, or when the video cannot be found, and never
 * blocks the video's own taps (only the badge itself takes a tap).
 */
export default function PitchProductBadgeOverlay({ pitchId, statusId, badges: given = null, siteCompanyId: givenSite = null, alwaysOn: givenAlwaysOn = false, bottomOffset = BOTTOM_OFFSET_PX, className = '' }) {
  const wrapRef = useRef(null);
  const [visible, setVisible] = useState(false);
  const [loaded, setLoaded] = useState({ badges: [], siteCompanyId: null, alwaysOn: false });
  const [time, setTime] = useState(0);

  const badges = given || loaded.badges;
  const siteCompanyId = given ? givenSite : loaded.siteCompanyId;
  const alwaysOn = given ? givenAlwaysOn : loaded.alwaysOn;
  const targetId = statusId || pitchId;

  // Ask for the badges only once this video is actually on screen.
  useEffect(() => {
    if (given) return undefined;
    const el = wrapRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setVisible(true); return undefined; }
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) setVisible(true); }, { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, [given, targetId]);

  useEffect(() => {
    if (given || !visible || !targetId) return undefined;
    let cancelled = false;
    (statusId ? getStatusBadges(statusId) : getPitchBadges(pitchId)).then((result) => { if (!cancelled) setLoaded({ alwaysOn: false, ...result }); });
    return () => { cancelled = true; };
  }, [given, visible, targetId, statusId, pitchId]);

  // Follow the video's clock (looping feeds jump back to 0, scrubbing jumps anywhere: both are just a new time).
  useEffect(() => {
    if (badges.length === 0 || alwaysOn) return undefined;
    const video = wrapRef.current?.parentElement?.querySelector('video');
    if (!video) return undefined;
    const sync = () => setTime(video.currentTime || 0);
    sync();
    ['timeupdate', 'seeked', 'play', 'loadedmetadata'].forEach((name) => video.addEventListener(name, sync));
    return () => ['timeupdate', 'seeked', 'play', 'loadedmetadata'].forEach((name) => video.removeEventListener(name, sync));
  }, [badges.length, alwaysOn, targetId]);

  const showing = useMemo(() => badgesAt(badges, time, alwaysOn), [badges, time, alwaysOn]);
  const href = badgeShopHref(siteCompanyId);

  // One stack per corner, so two badges that overlap in time never sit on top of each other.
  const byCorner = useMemo(() => {
    const groups = {};
    showing.forEach((b) => { (groups[b.position] = groups[b.position] || []).push(b); });
    return groups;
  }, [showing]);

  return (
    <div ref={wrapRef} className={`absolute inset-0 z-20 pointer-events-none ${className}`} aria-live="polite">
      {Object.entries(byCorner).map(([corner, items]) => (
        <div
          key={corner}
          style={corner.startsWith('bottom') ? { bottom: bottomOffset } : undefined}
          className={`absolute ${POSITION_CLASSES[corner] || POSITION_CLASSES['bottom-left']} flex flex-col gap-2 max-w-[72%] ${corner.endsWith('right') ? 'items-end' : 'items-start'}`}
        >
          {items.map((b) => {
            const body = (
              <>
                {b.image_url ? (
                  <img src={b.image_url} alt="" loading="lazy" className="w-10 h-10 rounded-lg object-cover bg-white/10 flex-shrink-0" />
                ) : (
                  <span className="w-10 h-10 rounded-lg bg-white/15 flex items-center justify-center flex-shrink-0"><ShoppingBag className="w-5 h-5 text-white/80" /></span>
                )}
                <span className="min-w-0 text-left">
                  <span className="block text-[13px] font-semibold leading-tight text-white truncate">{b.name}</span>
                  <span className="block text-sm font-bold leading-tight text-amber-300">{formatBadgePrice(b.price, b.currency)}</span>
                </span>
                {href && <span className="text-[11px] font-semibold text-white/90 bg-white/20 rounded-full px-2 py-0.5 flex-shrink-0">Shop</span>}
              </>
            );
            const cls = 'pointer-events-auto flex items-center gap-2.5 rounded-2xl bg-black/65 backdrop-blur-md border border-white/20 shadow-lg px-2.5 py-2 animate-fadeInUp';
            return href ? (
              <a key={b.id} href={href} onClick={(e) => e.stopPropagation()} className={cls} aria-label={`${b.name}, ${formatBadgePrice(b.price, b.currency)}. Open the shop`}>{body}</a>
            ) : (
              <div key={b.id} onClick={(e) => e.stopPropagation()} className={cls}>{body}</div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

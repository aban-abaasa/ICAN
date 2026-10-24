import React, { useCallback, useEffect, useState } from 'react';
import { Star, Bell, BellRing, Loader, ChevronDown, ChevronUp } from 'lucide-react';
import ContinueWithGoogle from './ContinueWithGoogle';
import {
  getBusinessSiteStats, getBusinessSiteReviews, rateBusiness, clearBusinessRating, subscribeToBusiness, unsubscribeFromBusiness,
} from '../services/businessEngagementService';
import { formatRating, formatFollowers, filledStars } from '../utils/businessEngagement';

// Five stars, filled up to `value`. Interactive when onPick is given (the "Rate this business" row).
const Stars = ({ value, onPick = null, size = 'w-5 h-5', label }) => (
  <div className="flex items-center gap-0.5" role={onPick ? 'radiogroup' : 'img'} aria-label={label}>
    {[1, 2, 3, 4, 5].map((n) => {
      const icon = <Star className={`${size} ${n <= value ? 'fill-amber-400 text-amber-400' : 'nb-icon-muted'}`} />;
      return onPick ? (
        <button key={n} type="button" role="radio" aria-checked={n === value} aria-label={`${n} star${n === 1 ? '' : 's'}`} onClick={() => onPick(n)} className="p-1 -m-0.5 rounded hover:scale-110 transition">
          {icon}
        </button>
      ) : <span key={n}>{icon}</span>;
    })}
  </div>
);

/**
 * Rating and subscription for one business, on its public website. Customers' ratings and subscriptions are what
 * put a business's products first in IcanEra, SupermarketEra and BodaGoEra. Anyone can read; rating and subscribing
 * need a free IcanEra account (the card offers Google sign-in right here). Shows nothing until the database
 * functions are installed, and nothing at all to a business with no id to attach to.
 */
export default function BusinessEngagementCard({ company, user, authLoading, pendingSection = 'home', className = '' }) {
  const businessId = company?.business_profile_id || null;
  const [state, setState] = useState({ loaded: false, available: false, stats: null });
  const [reviews, setReviews] = useState([]);
  const [showReviews, setShowReviews] = useState(false);
  const [draft, setDraft] = useState({ rating: 0, comment: '' });
  const [editing, setEditing] = useState(false);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [busy, setBusy] = useState(null); // 'subscribe' | 'rate' | 'clear'
  const [message, setMessage] = useState(null); // { kind: 'ok' | 'error', text }

  const load = useCallback(async () => {
    const [{ available, stats }, recent] = await Promise.all([getBusinessSiteStats(businessId), getBusinessSiteReviews(businessId, 8)]);
    setState({ loaded: true, available, stats });
    setReviews(recent);
    setDraft({ rating: stats.myRating || 0, comment: stats.myComment || '' });
  }, [businessId]);

  // Reload when the visitor signs in or out: "my rating" and "subscribed" belong to the signed-in customer.
  useEffect(() => {
    if (!businessId || authLoading) return;
    setNeedsSignIn(false);
    setMessage(null);
    load();
  }, [businessId, authLoading, user?.id, load]);

  if (!businessId || !state.loaded || !state.available) return null;
  const stats = state.stats;

  const guard = () => {
    if (user) return true;
    setNeedsSignIn(true);
    return false;
  };
  const finish = (result, okText) => {
    setBusy(null);
    if (!result.ok) { setMessage({ kind: 'error', text: result.error }); return false; }
    setState((s) => ({ ...s, stats: result.stats }));
    setMessage(okText ? { kind: 'ok', text: okText } : null);
    return true;
  };

  const toggleSubscribe = async () => {
    if (!guard()) return;
    setBusy('subscribe');
    const result = await (stats.subscribed ? unsubscribeFromBusiness(businessId) : subscribeToBusiness(businessId));
    finish(result, stats.subscribed ? null : `You'll see ${company.company_name}'s products first.`);
  };
  const submitRating = async () => {
    if (!guard()) return;
    if (!draft.rating) { setMessage({ kind: 'error', text: 'Tap the stars to choose a rating.' }); return; }
    setBusy('rate');
    const result = await rateBusiness(businessId, draft.rating, draft.comment.trim());
    if (finish(result, 'Thanks for rating!')) {
      setEditing(false);
      getBusinessSiteReviews(businessId, 8).then(setReviews);
    }
  };
  const withdrawRating = async () => {
    setBusy('clear');
    const result = await clearBusinessRating(businessId);
    if (finish(result, null)) {
      setDraft({ rating: 0, comment: '' });
      setEditing(false);
      getBusinessSiteReviews(businessId, 8).then(setReviews);
    }
  };

  const avgText = formatRating(stats.ratingAvg);
  const showRatingForm = !stats.isOwner && (editing || !stats.myRating);

  return (
    <section className={`nb-card rounded-2xl p-4 sm:p-5 ${className}`} aria-label={`Ratings and subscription for ${company.company_name}`}>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <div className="flex items-center gap-3 min-w-0">
          <p className="text-3xl font-bold nb-text leading-none">{avgText || '–'}</p>
          <div>
            <Stars value={filledStars(stats.ratingAvg)} size="w-4 h-4" label={avgText ? `${avgText} out of 5 stars` : 'Not rated yet'} />
            <p className="text-xs nb-text-muted mt-1">
              {stats.ratingCount > 0 ? `${stats.ratingCount} rating${stats.ratingCount === 1 ? '' : 's'}` : 'No ratings yet'} · {formatFollowers(stats.subscriberCount)}
            </p>
          </div>
        </div>

        {!stats.isOwner && (
          <button
            type="button"
            onClick={toggleSubscribe}
            disabled={busy === 'subscribe'}
            aria-pressed={stats.subscribed}
            className={`ml-auto min-h-[44px] px-4 rounded-xl font-semibold text-sm transition flex items-center gap-2 disabled:opacity-50 ${stats.subscribed ? 'nb-btn-secondary' : 'nb-btn-primary'}`}
          >
            {busy === 'subscribe' ? <Loader className="w-4 h-4 animate-spin" /> : stats.subscribed ? <BellRing className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
            {stats.subscribed ? 'Subscribed' : 'Subscribe'}
          </button>
        )}
      </div>

      {!stats.isOwner && !stats.subscribed && (
        <p className="text-xs nb-text-faint mt-2">Subscribe to see {company.company_name}'s products first in IcanEra, SupermarketEra and BodaGoEra.</p>
      )}
      {stats.isOwner && <p className="text-xs nb-text-faint mt-2">This is your business. Customers' ratings and subscriptions help it show first.</p>}

      {showRatingForm && (
        <div className="mt-4 pt-4 border-t nb-border space-y-2">
          <p className="text-sm font-semibold nb-text">{stats.myRating ? 'Update your rating' : 'Rate this business'}</p>
          <Stars value={draft.rating} onPick={(n) => setDraft((d) => ({ ...d, rating: n }))} size="w-7 h-7" label="Your rating" />
          <textarea
            value={draft.comment}
            onChange={(e) => setDraft((d) => ({ ...d, comment: e.target.value.slice(0, 500) }))}
            rows={2}
            maxLength={500}
            placeholder="Say a few words about your experience (optional)"
            aria-label="Your review"
            className="w-full rounded-xl nb-surface-alt border nb-border px-3 py-2 text-sm nb-text focus:outline-none focus:ring-2 focus:ring-emerald-400/60"
          />
          <div className="flex items-center gap-2">
            <button type="button" onClick={submitRating} disabled={busy === 'rate'} className="min-h-[44px] px-4 rounded-xl nb-btn-primary font-semibold text-sm transition disabled:opacity-50 flex items-center gap-2">
              {busy === 'rate' && <Loader className="w-4 h-4 animate-spin" />}{stats.myRating ? 'Save rating' : 'Submit rating'}
            </button>
            {stats.myRating && (
              <button type="button" onClick={() => { setEditing(false); setDraft({ rating: stats.myRating, comment: stats.myComment }); }} className="min-h-[44px] px-3 rounded-xl nb-btn-secondary text-sm font-semibold transition">Cancel</button>
            )}
          </div>
        </div>
      )}

      {!stats.isOwner && stats.myRating && !editing && (
        <div className="mt-4 pt-4 border-t nb-border flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="nb-text-muted">Your rating</span>
          <Stars value={stats.myRating} size="w-4 h-4" label={`You rated ${stats.myRating} out of 5`} />
          <button type="button" onClick={() => setEditing(true)} className="nb-link font-semibold underline-offset-2 hover:underline">Change</button>
          <button type="button" onClick={withdrawRating} disabled={busy === 'clear'} className="nb-text-faint underline-offset-2 hover:underline disabled:opacity-50">Remove</button>
        </div>
      )}

      {needsSignIn && !user && (
        <div className="mt-4 pt-4 border-t nb-border space-y-2">
          <p className="text-sm nb-text">Sign in to rate or subscribe. It's free and takes one tap.</p>
          <ContinueWithGoogle skin="nb" compact pendingSection={pendingSection} />
        </div>
      )}

      {message && (
        <p role="status" className={`mt-3 text-sm ${message.kind === 'error' ? 'text-red-500' : 'nb-text-muted'}`}>{message.text}</p>
      )}

      {reviews.length > 0 && (
        <div className="mt-4 pt-3 border-t nb-border">
          <button type="button" onClick={() => setShowReviews((v) => !v)} aria-expanded={showReviews} className="flex items-center gap-1.5 text-sm font-semibold nb-text">
            What customers say {showReviews ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {showReviews && (
            <ul className="mt-3 space-y-3">
              {reviews.map((r, i) => (
                <li key={`${r.createdAt}-${i}`} className="nb-surface-alt border nb-border rounded-xl p-3">
                  <div className="flex items-center justify-between gap-2">
                    <Stars value={r.rating} size="w-3.5 h-3.5" label={`${r.rating} out of 5`} />
                    <span className="text-[11px] nb-text-faint">{r.createdAt ? new Date(r.createdAt).toLocaleDateString() : ''}</span>
                  </div>
                  <p className="text-sm nb-text mt-1.5 break-words">{r.comment}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

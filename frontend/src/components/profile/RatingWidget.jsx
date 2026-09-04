import React, { useEffect, useState } from 'react';
import { Star, Loader2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { getMyRatingFor, rateProfessional } from '../../services/portfolioService';

/**
 * Star rating + optional written recommendation, shown on a public
 * portfolio page. Any logged-in IcanEra visitor (other than the profile
 * owner) can leave one — re-submitting edits their existing rating.
 */
export default function RatingWidget({ rateeUserId, ratingSummary, ratings, onRated }) {
  const { user } = useAuth();
  const [myRating, setMyRating] = useState(0);
  const [myText, setMyText] = useState('');
  const [hoverRating, setHoverRating] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  const isOwnProfile = user?.id === rateeUserId;

  useEffect(() => {
    if (!user?.id || isOwnProfile) return;
    getMyRatingFor(user.id, rateeUserId)
      .then((existing) => {
        if (existing) {
          setMyRating(existing.rating);
          setMyText(existing.recommendation_text || '');
        }
      })
      .catch(() => {});
  }, [user?.id, rateeUserId, isOwnProfile]);

  const submitRating = async () => {
    if (!myRating) {
      setError('Pick a star rating first.');
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await rateProfessional(user.id, rateeUserId, { rating: myRating, recommendationText: myText });
      setSuccess(true);
      onRated?.();
      setTimeout(() => setSuccess(false), 2500);
    } catch (err) {
      setError(err.message || 'Could not save your rating.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="bg-slate-900/50 border border-purple-700/30 rounded-xl p-4 sm:p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-white font-semibold">Trust Rating &amp; Recommendations</h3>
        <div className="flex items-center gap-1.5">
          <Star className="w-4 h-4 text-yellow-400 fill-yellow-400" />
          <span className="text-white font-bold">{Number(ratingSummary?.avg_rating || 0).toFixed(1)}</span>
          <span className="text-gray-400 text-sm">({ratingSummary?.ratings_count || 0})</span>
        </div>
      </div>

      {!isOwnProfile && user?.id && (
        <div className="mb-5 p-3 bg-slate-950/40 border border-amber-700/20 rounded-lg">
          <p className="text-xs text-amber-100/70 mb-2">Rate &amp; recommend this professional</p>
          <div className="flex items-center gap-1 mb-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setMyRating(n)}
                onMouseEnter={() => setHoverRating(n)}
                onMouseLeave={() => setHoverRating(0)}
              >
                <Star
                  className={`w-6 h-6 ${
                    n <= (hoverRating || myRating) ? 'text-yellow-400 fill-yellow-400' : 'text-gray-600'
                  }`}
                />
              </button>
            ))}
          </div>
          <textarea
            value={myText}
            onChange={(e) => setMyText(e.target.value)}
            placeholder="Write a short recommendation (optional)..."
            rows={2}
            className="w-full px-3 py-2 bg-slate-800/60 border border-slate-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40 resize-none"
          />
          {error && <p className="text-xs text-red-400 mt-1.5">{error}</p>}
          {success && <p className="text-xs text-emerald-400 mt-1.5">Thanks — your rating was saved!</p>}
          <button
            onClick={submitRating}
            disabled={isSaving}
            className="mt-2 flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-amber-700 to-purple-600 hover:from-amber-600 hover:to-purple-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60"
          >
            {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
            Save Rating
          </button>
        </div>
      )}
      {!user?.id && (
        <p className="text-xs text-gray-400 mb-4">Sign in to IcanEra to rate and recommend this professional.</p>
      )}

      <div className="space-y-3 max-h-72 overflow-y-auto">
        {(ratings || []).length === 0 && <p className="text-sm text-gray-500">No recommendations yet.</p>}
        {(ratings || []).map((r) => (
          <div key={r.id} className="flex gap-3 p-2.5 bg-slate-950/30 rounded-lg">
            {r.rater?.avatar_url ? (
              <img src={r.rater.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-purple-800 flex items-center justify-center text-xs text-white flex-shrink-0">
                {(r.rater?.full_name || 'U').charAt(0)}
              </div>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm text-white font-medium truncate">{r.rater?.full_name || 'IcanEra member'}</p>
                <div className="flex">
                  {Array.from({ length: r.rating }).map((_, i) => (
                    <Star key={i} className="w-3 h-3 text-yellow-400 fill-yellow-400" />
                  ))}
                </div>
              </div>
              {r.recommendation_text && <p className="text-xs text-gray-300 mt-0.5">{r.recommendation_text}</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

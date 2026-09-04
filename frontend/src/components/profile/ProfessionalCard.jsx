import React from 'react';
import { Star, ShieldCheck } from 'lucide-react';

/**
 * Shared card for a public professional — used by the dashboard
 * "Professionals" directory grid and the LandingPage auto-scrolling carousel.
 */
export default function ProfessionalCard({ professional, onOpen, compact = false }) {
  const {
    handle,
    full_name: fullName,
    avatar_url: avatarUrl,
    headline,
    is_verified: isVerified,
    avg_rating: avgRating,
    ratings_count: ratingsCount,
  } = professional;

  const initials = (fullName || 'U')
    .split(' ')
    .map((p) => p.charAt(0))
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <button
      onClick={() => onOpen?.(handle)}
      className={`text-left flex-shrink-0 ${compact ? 'w-56' : 'w-full'} bg-slate-900/60 border border-amber-700/30 hover:border-purple-500/50 rounded-xl p-4 transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-purple-900/30`}
    >
      <div className="flex items-center gap-3 mb-3">
        {avatarUrl ? (
          <img src={avatarUrl} alt={fullName} className="w-12 h-12 rounded-full object-cover ring-2 ring-amber-700/40" />
        ) : (
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-amber-700 to-purple-600 flex items-center justify-center text-white font-bold ring-2 ring-amber-700/40">
            {initials}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="text-white font-semibold truncate">{fullName}</p>
            {isVerified && <ShieldCheck className="w-4 h-4 text-emerald-400 flex-shrink-0" title="Verified" />}
          </div>
          <p className="text-xs text-amber-200/70 truncate">@{handle}</p>
        </div>
      </div>

      {headline && <p className="text-sm text-gray-300 line-clamp-2 mb-3">{headline}</p>}

      <div className="flex items-center gap-1.5 text-xs">
        <Star className="w-3.5 h-3.5 text-yellow-400 fill-yellow-400" />
        <span className="text-white font-medium">{Number(avgRating || 0).toFixed(1)}</span>
        <span className="text-gray-400">({ratingsCount || 0})</span>
      </div>
    </button>
  );
}

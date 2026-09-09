import React from 'react';
import { Eye, Radio } from 'lucide-react';

/**
 * "Someone is live" card(s) at the bottom of the Community feed — same
 * position a new message would land in, oldest-to-newest like the rest of
 * the feed (see groupedCommunityFeed/liveStreams ordering), so a fresh
 * broadcast surfaces exactly where a fresh message would and the feed's
 * existing scroll-to-bottom behavior already reveals it.
 *
 * Any number of people can be live at once, so this renders one card per
 * stream rather than assuming a single broadcaster — tapping a card watches
 * that specific stream; it's the picker for "which live" when there's more
 * than one, and the auto-join in ChatWidget.jsx only fires by itself when
 * there's exactly one, leaving the choice to the visitor otherwise.
 *
 * Hidden once the visitor is already broadcasting/watching (CommunityLiveStage
 * takes over the whole widget at that point).
 */
const CommunityLiveBanner = ({ live, dark = false }) => {
  if (live.liveStreams.length === 0 || live.role !== 'idle') return null;

  return (
    <div className="space-y-1.5">
      {live.liveStreams.map((stream) => (
        <button
          key={stream.streamId}
          onClick={() => live.watch(stream.streamId)}
          disabled={!live.canWatch}
          className={`flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition ${
            dark ? 'border-red-500/30 bg-red-500/10 hover:bg-red-500/20' : 'border-red-200 bg-red-50 hover:bg-red-100'
          }`}
        >
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-red-500 to-orange-500 text-white">
            <Radio className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide ${dark ? 'text-red-400' : 'text-red-600'}`}>
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" /> Live now
            </span>
            <span className={`block truncate text-sm font-medium ${dark ? 'text-slate-100' : 'text-slate-800'}`}>
              {stream.broadcasterName || 'Someone'} is live
            </span>
          </span>
          <span className={`flex flex-shrink-0 items-center gap-1 text-xs ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
            <Eye className="h-3.5 w-3.5" /> {stream.viewerCount}
          </span>
        </button>
      ))}
    </div>
  );
};

export default CommunityLiveBanner;

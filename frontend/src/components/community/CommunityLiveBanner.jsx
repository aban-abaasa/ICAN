import React from 'react';
import { Eye, Radio } from 'lucide-react';

/**
 * Compact "someone is live" card shown atop the Community thread list —
 * hidden once the viewer is already broadcasting/watching (CommunityLiveStage
 * takes over the whole widget at that point).
 */
const CommunityLiveBanner = ({ live, dark = false }) => {
  if (!live.liveInfo || live.role !== 'idle') return null;
  const name = live.liveInfo.broadcasterName || 'Someone';

  return (
    <button
      onClick={live.watch}
      disabled={!live.canWatch}
      className={`mb-2 flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition ${
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
        <span className={`block truncate text-sm font-medium ${dark ? 'text-slate-100' : 'text-slate-800'}`}>{name} is live</span>
      </span>
      <span className={`flex flex-shrink-0 items-center gap-1 text-xs ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
        <Eye className="h-3.5 w-3.5" /> {live.viewerCount}
      </span>
    </button>
  );
};

export default CommunityLiveBanner;

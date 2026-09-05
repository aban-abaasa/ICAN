import React from 'react';
import { Users, Video } from 'lucide-react';

/**
 * Compact "there's a live call happening" card for CMMS/Trust — the
 * boardroom equivalent of CommunityLiveBanner, driven by
 * useBoardroomPresence instead of the one-to-many broadcast hook, since a
 * boardroom call is a full mesh (everyone's camera, no single
 * "broadcaster") rather than a stream with one source. Tapping it opens
 * LiveBoardroom with `autoStart`, so joining is instant — no ring/accept
 * screen.
 */
const BoardroomLiveBanner = ({ participantCount, onJoin, dark = false }) => {
  if (!participantCount) return null;

  return (
    <button
      onClick={onJoin}
      className={`mb-2 flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition ${
        dark ? 'border-red-500/30 bg-red-500/10 hover:bg-red-500/20' : 'border-red-200 bg-red-50 hover:bg-red-100'
      }`}
    >
      <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-red-500 to-orange-500 text-white">
        <Video className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide ${dark ? 'text-red-400' : 'text-red-600'}`}>
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" /> Live now
        </span>
        <span className={`block truncate text-sm font-medium ${dark ? 'text-slate-100' : 'text-slate-800'}`}>
          {participantCount} {participantCount === 1 ? 'person is' : 'people are'} on a call — tap to join
        </span>
      </span>
      <span className={`flex flex-shrink-0 items-center gap-1 text-xs ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
        <Users className="h-3.5 w-3.5" /> {participantCount}
      </span>
    </button>
  );
};

export default BoardroomLiveBanner;

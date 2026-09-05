import { useEffect, useRef, useState } from 'react';
import { getSupabaseClient } from '../lib/supabase/client';

const supabase = getSupabaseClient();

/**
 * Lightweight "is anyone on this boardroom call right now" indicator — joins
 * the exact same `boardroom-presence:<groupId>` channel LiveBoardroom itself
 * tracks presence on once a meeting is underway (see its setupPresence
 * effect), but only *observes* (never calls `.track()`), so it costs nothing
 * beyond a realtime subscription. This is what drives ChatWidget's "N people
 * are live now" banner and the pulsing tab dot for CMMS/Trust — every
 * member of that company/group can see a call is happening and join it
 * (LiveBoardroom is opened with `autoStart`, so joining is instant, no
 * ring/accept screen) without having needed to be on it from the start.
 */
export const useBoardroomPresence = (groupId) => {
  const [participantCount, setParticipantCount] = useState(0);

  useEffect(() => {
    if (!groupId) { setParticipantCount(0); return undefined; }

    const channel = supabase.channel(`boardroom-presence:${groupId}`);
    channel
      .on('presence', { event: 'sync' }, () => {
        setParticipantCount(Object.keys(channel.presenceState()).length);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [groupId]);

  return { participantCount, isActive: participantCount > 0 };
};

export default useBoardroomPresence;

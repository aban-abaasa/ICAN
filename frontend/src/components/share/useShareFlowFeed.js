import { useEffect, useState } from 'react';
import { getPitchFlowFeed } from '../../services/pitchingService';
import { getStatusFlowFeed } from '../../services/statusService';

// What a visitor can keep going through after the pitch/update they were sent
// (see PublicShareFlow). Deliberately starts a beat after mount so the shared
// item's own request goes out first -- the visitor came for that one, and the
// feed is only needed once they swipe on or open Explore.
const FEED_DELAY_MS = 400;

export const useShareFlowFeed = () => {
  const [feed, setFeed] = useState({ pitches: [], statuses: [], loading: true });

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      // Both fetchers swallow their own errors and resolve to [].
      const [pitches, statuses] = await Promise.all([getPitchFlowFeed(20), getStatusFlowFeed(30)]);
      if (!cancelled) setFeed({ pitches, statuses, loading: false });
    }, FEED_DELAY_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);

  return feed;
};

export default useShareFlowFeed;

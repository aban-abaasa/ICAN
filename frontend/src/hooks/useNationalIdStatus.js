import { useCallback, useEffect, useState } from 'react';
import { getNationalIdStatus } from '../services/nationalIdService';

/**
 * Loads the signed-in user's national-ID status (see nationalIdService.getNationalIdStatus).
 * `status` is null until the first answer arrives. `refresh()` re-reads it, e.g. after saving.
 */
export default function useNationalIdStatus(enabled = true) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(!!enabled);

  const refresh = useCallback(async () => {
    const next = await getNationalIdStatus();
    setStatus(next);
    setLoading(false);
    return next;
  }, []);

  useEffect(() => {
    if (!enabled) { setLoading(false); return undefined; }
    let cancelled = false;
    getNationalIdStatus().then((next) => {
      if (cancelled) return;
      setStatus(next);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [enabled]);

  return { status, loading, refresh };
}

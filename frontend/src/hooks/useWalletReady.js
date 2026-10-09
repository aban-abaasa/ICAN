import { useCallback, useEffect, useState } from 'react';
import { walletAccountService } from '../services/walletAccountService';

/**
 * Does the signed-in user have a usable IcanEra wallet (a wallet account WITH a PIN)?
 * 'unknown' while checking (and for signed-out visitors), 'ready', or 'missing'.
 * Paying from the wallet needs the PIN, so checkout uses this to send a brand-new
 * user (e.g. one who just came in with Google) to wallet creation instead of a PIN
 * prompt that can't succeed. Re-checks whenever the tab regains focus -- the PIN is
 * usually set from an emailed link opened in another tab or the installed app.
 */
export default function useWalletReady(userId) {
  const [state, setState] = useState('unknown');

  const recheck = useCallback(async () => {
    if (!userId) { setState('unknown'); return 'unknown'; }
    const account = await walletAccountService.checkUserAccount(userId);
    const next = account?.pin_hash ? 'ready' : 'missing';
    setState(next);
    return next;
  }, [userId]);

  useEffect(() => { recheck(); }, [recheck]);

  useEffect(() => {
    if (!userId || state === 'ready') return undefined;
    const onFocus = () => { if (document.visibilityState !== 'hidden') recheck(); };
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);
    return () => { document.removeEventListener('visibilitychange', onFocus); window.removeEventListener('focus', onFocus); };
  }, [userId, state, recheck]);

  return { walletState: state, recheckWallet: recheck };
}

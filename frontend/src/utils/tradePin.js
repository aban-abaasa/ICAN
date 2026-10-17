// Pure rules for the PIN every buy and sell asks for. The PIN itself is checked by the wallet (walletAccountService.verifyUserPIN, with
// its 3-wrong-tries lock); this only fixes what the person is asked and makes the answer FAIL CLOSED: anything other than a clear
// "ok" (a cancel, a wrong PIN, no PIN set, a crash while checking) stops the trade, so no money moves on a doubtful answer.

export const TRADE_PIN_TITLE = 'Confirm with your PIN';

// `check` takes { title, message } and resolves { ok, cancelled?, error? } (confirmWalletPin does). Never throws, and resolves
// { ok: true } or { ok: false, cancelled, error } where `error` is a sentence the screen can show as it is.
export const runPinCheck = async (check, message) => {
  try {
    const res = await check({ title: TRADE_PIN_TITLE, message });
    if (res?.ok === true) return { ok: true };
    return { ok: false, cancelled: res?.cancelled === true, error: res?.error || 'Your PIN was not confirmed. Nothing was traded.' };
  } catch {
    return { ok: false, cancelled: false, error: 'Could not check your PIN. Nothing was traded. Please try again.' };
  }
};

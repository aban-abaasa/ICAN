// Tells a genuine connectivity failure apart from a rejected sign-in.
//
// Why it matters: AuthContext.signIn() falls back to the device's cached session when
// the online sign-in fails. That is right when the network is down, and wrong when
// Supabase has answered "invalid login credentials": a wrong password must never
// open an account just because it was used on this device before.
export function isNetworkAuthError(error) {
  if (!error) return false;
  if (error.name === 'AuthRetryableFetchError') return true;
  // fetch() rejects with a TypeError ("Failed to fetch") when the request cannot be made at all.
  if (error instanceof TypeError) return true;
  if (error.status === 0) return true;
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed/i.test(String(error.message || ''));
}

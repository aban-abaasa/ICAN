/**
 * An Edge Function call that failed: what went wrong, and did the SERVER ANSWER?
 *
 * It matters for money that leaves the app (mobile-money and bank sends). When the function answers with its own
 * {error: "..."} it has decided, and a refusal is final: anything it had debited it refunded before answering. When
 * nothing answered - the connection dropped, a gateway timed out - the request may or may not have been carried out, and
 * the person must check their balance before trying again instead of being told it failed. Pure (tests/functionErrors.test.js).
 *
 * @param {{message?: string, context?: {clone?: Function, json?: Function}}} error what supabase.functions.invoke returned in `error`
 * @param {string} fallback
 * @returns {Promise<{message: string, answered: boolean}>}
 */
export async function describeFunctionFailure(error, fallback) {
  const response = error?.context;
  if (response && typeof response.json === 'function') {
    try {
      const parsed = await (typeof response.clone === 'function' ? response.clone() : response).json();
      if (parsed?.error) return { message: String(parsed.error), answered: true };
    } catch {
      // The reply was not JSON (e.g. an HTML gateway error page): nothing of ours answered.
    }
  }
  return { message: error?.message || fallback, answered: false };
}

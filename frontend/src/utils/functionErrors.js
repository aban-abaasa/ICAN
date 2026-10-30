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

// When a mobile-money or bank payout is refused (the money was refunded), the cheapest way forward is IcanEra itself:
// sending to any IcanEra wallet is instant, free and never touches the payment provider. Every send-out failure that
// the server definitely answered carries this recommendation, so every screen that shows error.message passes it on.
export const ICANERA_WALLET_URL = 'https://icanera.space/#wallet';
export const ICANERA_FALLBACK_HINT = 'You can still send IcanEra to any IcanEra wallet instantly, with no fee.';
// Problems the person fixes themselves (balance, PIN, a typo): another way of paying would not help.
const NOT_A_PAYOUT_FAULT = /insufficient|not enough|own (registered )?phone number|\bpin\b|\bvalid\b|required|enter |choose |too small/i;

/**
 * An Error for a refused payout that recommends sending to an IcanEra wallet instead.
 * `rawMessage` is the server's own wording (for records that must not carry the advice); `suggestIcanEra` and
 * `icanEraWalletUrl` let a screen offer an "Open IcanEra Wallet" button.
 */
export function icanEraFallbackError(message) {
  const text = String(message || '').trim();
  if (!text || NOT_A_PAYOUT_FAULT.test(text)) return Object.assign(new Error(text || 'Transfer failed'), { rawMessage: text });
  const sentence = /[.!?]$/.test(text) ? text : `${text}.`;
  return Object.assign(new Error(`${sentence} ${ICANERA_FALLBACK_HINT}`), {
    rawMessage: text,
    suggestIcanEra: true,
    icanEraWalletUrl: ICANERA_WALLET_URL,
  });
}

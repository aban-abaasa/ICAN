/**
 * The server's wrong-PIN message carries its own count ("❌ Invalid PIN. Attempts
 * remaining: 2"). Split it so the PIN sheet can show the message and the count once,
 * from the same source, instead of the text saying one number and a separate line
 * saying another. Pure (tests/pinAttempts.test.js).
 *
 * @param {string|null|undefined} message
 * @returns {{text: string, attempts: number|null}} `attempts` is null when the message has no count (e.g. "Insufficient balance"), and never below 0.
 */
export function splitAttemptsMessage(message) {
  const raw = String(message ?? '');
  const match = raw.match(/Attempts remaining:\s*(-?\d+)/i);
  return {
    text: raw.replace(/\s*Attempts remaining:\s*-?\d+/i, '').trim(),
    attempts: match ? Math.max(0, parseInt(match[1], 10)) : null,
  };
}

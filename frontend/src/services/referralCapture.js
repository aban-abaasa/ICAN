/**
 * Referral link capture — deliberately has NO Supabase import.
 *
 * main.jsx runs this before React mounts on every page, including the tiny
 * public/QR pages that are kept out of the main bundle on purpose, so it must
 * stay dependency-free. The redeeming half lives in referralService.js.
 */

export const REFERRAL_SOURCE_APP = 'ican';
const PENDING_REF_KEY = 'ican_pending_referral_code';
export const PENDING_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Remembers ?ref=CODE from a shared link until someone is signed in to redeem
// it. Best-effort — never throws.
export function captureReferralFromUrl() {
  try {
    const ref = new URLSearchParams(window.location.search).get('ref');
    if (!ref) return;
    const code = ref.trim().toUpperCase();
    if (!code) return;
    localStorage.setItem(PENDING_REF_KEY, JSON.stringify({ code, savedAt: Date.now() }));
  } catch {
    // Storage unavailable (private mode, etc.) — referral capture is best-effort.
  }
}

// Stores a code typed by hand on the sign-in / sign-up screens — same slot a
// ?ref= link fills, so the redeem step after sign-in needs no special case.
export function savePendingReferral(code) {
  try {
    const clean = String(code || '').trim().toUpperCase();
    if (!clean) return;
    localStorage.setItem(PENDING_REF_KEY, JSON.stringify({ code: clean, savedAt: Date.now() }));
  } catch {
    // Storage unavailable — best-effort.
  }
}

export function readPendingReferral() {
  try {
    const raw = localStorage.getItem(PENDING_REF_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && parsed.code ? parsed : null;
  } catch {
    return null;
  }
}

export function clearPendingReferral() {
  try { localStorage.removeItem(PENDING_REF_KEY); } catch { /* ignore */ }
}

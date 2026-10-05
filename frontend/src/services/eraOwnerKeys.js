/**
 * Business-owner side of the Era API: mint, list and revoke the scoped keys a business gives to its own software.
 * Every rule is enforced again by the database (supabase/migrations/20261006100000_era_api_business.sql); the checks
 * here only give the owner an answer before the round trip.
 */
export const KEY_SCOPES = [
  { id: 'payments:request', label: 'Create payment requests', help: 'Ask a customer to pay. The customer approves in their app with their own PIN. Nothing is ever taken by the API.', money: true },
  { id: 'payments:read', label: 'Read payment requests', help: 'See whether a request was paid, expired or cancelled.' },
  { id: 'inventory:read', label: 'Read inventory and expiry dates', help: 'Stock, value at cost, expiry bands and clearance suggestions.' },
  { id: 'cmms:read', label: 'Read maintenance (CMMS) data', help: 'Assets, reorder alerts, requisitions and work assignments.' },
  { id: 'bookings:request', label: 'Request rides and deliveries', help: 'Creates a booking request with a confirm link. The customer books it themselves.' },
  { id: 'bookings:read', label: 'Track booking requests', help: 'See the state of the requests this business made.' },
];
export const EXPIRY_CHOICES = [30, 90, 180, 365];
export const MAX_REQUEST_UGX = 10000000;
export const MAX_DAILY_UGX = 50000000;

const num = (v) => (v === '' || v == null ? null : Number(v));

/** Returns { ok, error, args } where args are the RPC arguments for era_api_owner_create_key. */
export function validateKeyRequest({ businessId, label = '', scopes = [], expiresDays = 90, test = false, maxAmount = '', dailyCap = '' }) {
  if (!businessId) return { ok: false, error: 'Pick a business first.' };
  const known = new Set(KEY_SCOPES.map((s) => s.id));
  const picked = [...new Set(scopes)].filter((s) => known.has(s));
  if (!picked.length) return { ok: false, error: 'Pick at least one thing the key may do.' };
  if (!EXPIRY_CHOICES.includes(Number(expiresDays))) return { ok: false, error: 'Choose how long the key lasts.' };
  const args = {
    p_business_id: businessId, p_label: String(label).trim().slice(0, 60) || null, p_scopes: picked,
    p_expires_days: Number(expiresDays), p_test: !!test, p_max_amount_ugx: null, p_daily_cap_ugx: null,
  };
  if (picked.includes('payments:request')) {
    const max = num(maxAmount); const daily = num(dailyCap);
    if (max != null && (!(max > 0) || max > MAX_REQUEST_UGX)) return { ok: false, error: `The per-request cap must be between 1 and ${MAX_REQUEST_UGX.toLocaleString()} UGX.` };
    if (daily != null && (!(daily > 0) || daily > MAX_DAILY_UGX)) return { ok: false, error: `The daily cap must be at most ${MAX_DAILY_UGX.toLocaleString()} UGX.` };
    if (max != null && daily != null && daily < max) return { ok: false, error: 'The daily cap cannot be below the per-request cap.' };
    args.p_max_amount_ugx = max; args.p_daily_cap_ugx = daily;
  }
  return { ok: true, args };
}

/** A friendly line for a key row: 'active', 'expired', 'revoked' (+ test). */
export function keyStatus(k) {
  if (k.revoked_at) return 'revoked';
  if (k.expired || (k.expires_at && new Date(k.expires_at) <= new Date())) return 'expired';
  return 'active';
}

const unwrap = ({ data, error }) => { if (error) throw new Error(error.message || 'Request failed'); return data; };

export const eraOwnerApi = (sb) => ({
  businesses: async () => unwrap(await sb.rpc('era_api_owner_businesses')),
  createKey: async (args) => unwrap(await sb.rpc('era_api_owner_create_key', args)),
  listKeys: async (businessId) => unwrap(await sb.rpc('era_api_owner_list_keys', { p_business_id: businessId })),
  revokeKey: async (keyId) => unwrap(await sb.rpc('era_api_owner_revoke_key', { p_key_id: keyId })),
  activity: async (businessId, limit = 30) => unwrap(await sb.rpc('era_api_owner_activity', { p_business_id: businessId, p_limit: limit })),
});

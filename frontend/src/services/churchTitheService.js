/**
 * churchTitheService.js
 * Give tithe to a church registered on IcanEra: search churches, then give by
 * IcanEra wallet (PIN required), mobile money / card (Flutterwave) or cash.
 * The SQL lives in supabase/migrations/20261014100000_church_tithe_giving.sql and the
 * Flutterwave settlement in backend/supabase/functions/verify-tithe-payment.
 */
import { getSupabaseClient } from '../lib/supabase/client';
import { walletAccountService } from './walletAccountService';
import { payWithFlutterwave, generateTxRef } from './flutterwaveClient';

export const MIN_GIFT_UGX = 500;
const MAX_PIN_TRIES = 3; // the wallet locks the account after 3 wrong PINs

export const GIVING_TYPES = [
  { id: 'tithe', label: 'Tithe', icon: '🙏', hint: '10% of increase' },
  { id: 'offering', label: 'Offering', icon: '🎁', hint: 'Freewill gift' },
  { id: 'building_fund', label: 'Building', icon: '🏗️', hint: 'Sanctuary & projects' },
  { id: 'mission', label: 'Missions', icon: '🌍', hint: 'Reach the unreached' },
  { id: 'charity', label: 'Charity', icon: '🤲', hint: 'Help the needy' },
  { id: 'alms', label: 'Alms / Zakat', icon: '🕊️', hint: 'Give to the poor' },
];

const client = () => getSupabaseClient();

async function currentUser() {
  const { data: { user }, error } = await client().auth.getUser();
  if (error || !user) throw new Error('Please sign in to give');
  return user;
}

/** Registered churches (or, with includeAll, every registered business) matching `query`. */
export async function searchChurches({ query = '', includeAll = false, limit = 30 } = {}) {
  const { data, error } = await client().rpc('fn_search_tithe_recipients', {
    p_query: query || null, p_include_all: includeAll, p_limit: limit,
  });
  if (error) throw new Error(error.message || 'Could not load churches');
  return (data || []).map((r) => ({
    id: r.business_id, name: r.business_name, type: r.business_type,
    country: r.country, isChurch: r.is_church, isMine: r.is_mine,
  }));
}

/**
 * Ask for the IcanEra wallet PIN and check it, letting the giver retry a wrong PIN.
 * `askPin` is the function from usePinPrompt(). Resolves { ok: true } or { ok: false, error, cancelled }.
 */
export async function confirmWalletPin(askPin, { title, message }) {
  const user = await currentUser();
  let error = '';
  for (let attempt = 0; attempt < MAX_PIN_TRIES; attempt += 1) {
    const pin = await askPin({ title, message, error });
    if (pin === null) return { ok: false, cancelled: true, error: 'Cancelled — nothing was charged.' };
    const check = await walletAccountService.verifyUserPIN(user.id, pin);
    if (check?.success) return { ok: true };
    error = check?.error || 'Incorrect PIN';
    if (/locked|not set up|not found/i.test(error)) return { ok: false, error };
  }
  return { ok: false, error: error || 'Too many wrong PIN attempts' };
}

/** Wallet or cash. Wallet callers must have passed confirmWalletPin first. */
export async function giveToChurch({ churchId, amount, givingType = 'tithe', method, isAnonymous = false, message = '', titheType = 'personal' }) {
  const { data, error } = await client().rpc('fn_give_tithe_to_church', {
    p_business_id: churchId, p_amount: amount, p_giving_type: givingType, p_payment_method: method,
    p_is_anonymous: isAnonymous, p_message: message || null, p_tithe_type: titheType,
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.success) throw new Error(row?.message || 'Could not send the tithe');
  return { titheId: row.tithe_record_id, balance: row.new_wallet_balance, churchName: row.church_name, message: row.message };
}

/** Mobile money / card / bank through Flutterwave; settled only after the server re-checks the charge. */
export async function giveToChurchWithFlutterwave({ church, amount, givingType = 'tithe', isAnonymous = false, message = '', titheType = 'personal', phone = '' }) {
  const user = await currentUser();
  const txRef = generateTxRef('IcanEra-TITHE');
  const payment = await payWithFlutterwave({
    amount, currency: 'UGX', txRef,
    customerEmail: user.email, customerName: user.user_metadata?.full_name || user.user_metadata?.name, customerPhone: phone,
    title: `Give to ${church.name}`, description: `${givingType.replace('_', ' ')} to ${church.name}`,
  });
  if (payment.status === 'cancelled') return { cancelled: true };
  if (payment.status !== 'successful' || !payment.transaction_id) throw new Error('The payment was not completed — you were not charged.');

  const { data, error } = await client().functions.invoke('verify-tithe-payment', {
    body: {
      transaction_id: payment.transaction_id, tx_ref: txRef, business_id: church.id, amount,
      giving_type: givingType, is_anonymous: isAnonymous, message, tithe_type: titheType,
    },
  });
  if (error || !data?.success) {
    // Charged but not recorded: surface the reference so nobody pays twice.
    throw new Error((data?.error || 'Your payment went through but we could not confirm it yet.') + ` Reference: ${txRef}`);
  }
  return { titheId: data.tithe_record_id, churchName: data.church_name || church.name, txRef };
}

/** Churches (businesses) the signed-in user owns, so they can see what their church received. */
export async function getMyChurches() {
  const user = await currentUser();
  const { data, error } = await client().from('business_profiles')
    .select('id, business_name, business_type, metadata, status').eq('user_id', user.id).order('created_at');
  if (error) throw new Error(error.message);
  return (data || []).filter((b) => (b.status || 'active') === 'active').map((b) => ({
    id: b.id, name: b.business_name, type: b.business_type, acceptsTithe: b.metadata?.accepts_tithe === true,
  }));
}

export async function getReceivedTithes(churchId, limit = 50) {
  const { data, error } = await client().rpc('fn_church_received_tithes', { p_business_id: churchId, p_limit: limit });
  if (error) throw new Error(error.message);
  return (data || []).map((r) => ({
    id: r.tithe_id, date: r.giving_date, amount: Number(r.amount) || 0, givingType: r.giving_type,
    method: r.payment_method, giver: r.giver_name, message: r.giver_message, confirmed: r.confirmed,
  }));
}

export async function confirmCashReceived(titheId) {
  const { data, error } = await client().rpc('fn_confirm_church_cash_tithe', { p_tithe_id: titheId });
  if (error) throw new Error(error.message);
  return !!data;
}

export async function setAcceptsTithe(businessId, accepts) {
  const { data, error } = await client().rpc('fn_set_business_accepts_tithe', { p_business_id: businessId, p_accepts: accepts });
  if (error) throw new Error(error.message);
  return !!data;
}

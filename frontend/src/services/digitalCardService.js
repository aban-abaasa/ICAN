import { getSupabaseClient } from '../lib/supabase/client';

const supabase = getSupabaseClient();

export const cardQrUrl = (token) => `${window.location.origin}/card-pay/${token}`;

export async function getMyDigitalCard() {
  const { data, error } = await supabase.rpc('get_or_create_my_digital_card');
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export async function rotateMyCardQr() {
  const { data, error } = await supabase.rpc('rotate_my_card_qr');
  if (error) throw error;
  return data;
}

export async function setMyCardQrEnabled(enabled) {
  const { error } = await supabase.rpc('set_my_card_qr_enabled', { p_enabled: enabled });
  if (error) throw error;
}

export async function setMyCardPinPayEnabled(enabled) {
  const { error } = await supabase.rpc('set_my_card_pin_pay_enabled', { p_enabled: enabled });
  if (error) throw error;
}

// Public (no sign-in): the card owner types their PIN on the scanning device.
// The Edge Function verifies the PIN server-side before any money moves.
// destType: 'momo' (phone + network) | 'icanera' (phone = 16-digit account) | 'bank' (phone = account no.)
export async function payWithCardPin({ token, pin, phone, network, amount, note, destType = 'momo', bankCode, beneficiaryName }) {
  const { data, error } = await supabase.functions.invoke('card-pay-with-pin', {
    body: {
      token, pin, phone, network, amount, note: note || null,
      dest_type: destType, bank_code: bankCode || null, beneficiary_name: beneficiaryName || null,
    },
  });
  // Non-2xx responses carry the server's message in the response body.
  if (error) {
    let msg = error.message;
    try { msg = (await error.context.json())?.error || msg; } catch { /* keep default */ }
    throw new Error(msg);
  }
  if (!data?.success) throw new Error(data?.error || 'Payment failed');
  return data;
}

// Public: masked holder name ("Mary K.") for an IcanEra account number.
export async function getCardQrAccountName(token, accountNumber) {
  const { data, error } = await supabase.rpc('get_card_qr_account_name', { p_token: token, p_account_number: accountNumber });
  if (error) throw error;
  return data || null;
}

// Public: Uganda banks for the bank picker.
export async function listUgandaBanks() {
  const { data, error } = await supabase.functions.invoke('flutterwave-banks', { method: 'GET' });
  if (error || !data?.success) throw new Error('Could not load banks');
  // Flutterwave tags the mobile money networks as "bank" too; they have their own tab.
  return (data.banks || []).filter((b) => !/^(MTN|AIRTEL)\b/i.test(b.name || ''));
}

export async function listCardQrRequests(limit = 20) {
  const { data, error } = await supabase.from('ican_card_qr_requests')
    .select('*').order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data || [];
}

export async function declineCardQrRequest(id) {
  const { error } = await supabase.rpc('decline_card_qr_request', { p_request_id: id });
  if (error) throw error;
}

export const claimCardQrRequest = async (id) => {
  const { data, error } = await supabase.rpc('claim_card_qr_request', { p_request_id: id });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
};

export async function finishCardQrRequest(id, ok, reference, reason) {
  const { error } = await supabase.rpc('finish_card_qr_request', {
    p_request_id: id, p_ok: ok, p_reference: reference || null, p_reason: reason || null,
  });
  if (error) throw error;
}

// Public (no sign-in) — used by the scan page.
export async function getCardQrInfo(token) {
  const { data, error } = await supabase.rpc('get_card_qr_info', { p_token: token });
  if (error) throw error;
  return (Array.isArray(data) ? data[0] : data) || null;
}

export async function submitCardQrRequest({ token, name, phone, network, amount, note }) {
  const { data, error } = await supabase.rpc('submit_card_qr_request', {
    p_token: token, p_name: name, p_phone: phone, p_network: network, p_amount: amount, p_note: note || null,
  });
  if (error) throw error;
  return data;
}

// ─── Business cards ─────────────────────────────────────────────────────────
// Same card as a personal wallet's, one per business profile. Scans only ever
// leave a request; nothing is paid out. Approving needs the business-wallet PIN,
// which the database checks (5 wrong tries lock it for 15 minutes).

export async function getBusinessDigitalCard(businessProfileId) {
  const { data, error } = await supabase.rpc('get_or_create_business_digital_card', { p_business_profile_id: businessProfileId });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export async function rotateBusinessCardQr(businessProfileId) {
  const { data, error } = await supabase.rpc('rotate_business_card_qr', { p_business_profile_id: businessProfileId });
  if (error) throw error;
  return data;
}

export async function setBusinessCardQrEnabled(businessProfileId, enabled) {
  const { error } = await supabase.rpc('set_business_card_qr_enabled', { p_business_profile_id: businessProfileId, p_enabled: enabled });
  if (error) throw error;
}

export async function listBusinessCardQrRequests(businessProfileId, limit = 20) {
  const { data, error } = await supabase.from('ican_business_card_qr_requests')
    .select('*').eq('business_profile_id', businessProfileId).order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data || [];
}

export async function approveBusinessCardQrRequest(id, pin) {
  const { data, error } = await supabase.rpc('approve_business_card_qr_request', { p_request_id: id, p_pin: pin });
  if (error) throw error;
  if (!data?.success) throw new Error(data?.message || 'Could not approve this request');
  return data;
}

export async function declineBusinessCardQrRequest(id) {
  const { error } = await supabase.rpc('decline_business_card_qr_request', { p_request_id: id });
  if (error) throw error;
}

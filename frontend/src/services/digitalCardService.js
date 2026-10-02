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

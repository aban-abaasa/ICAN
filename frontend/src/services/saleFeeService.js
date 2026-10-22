/**
 * The dev panel's way to read and change ICANera's two sale fees (dropship 2%, store 1%). Talks only to
 * ican_dev_get_sale_fees / ican_dev_set_sale_fee (supabase/migrations/20261109100000_sale_fees_dev_panel.sql), which need the panel's
 * dev token AND the signed-in operator account. A function that is not installed yet comes back as { missing: true }.
 *
 *   get(token)                 -> { data: { fees: [{ key, rate, default_rate, in_table, updated_at }], changes: [...] } }
 *   set(token, key, rate)      -> { data: { success, changed, old_rate, rate } } or { data: { success: false, error } }; rate is a fraction
 */
import { supabase } from '../lib/supabase/client';
import { isMissingFunction } from '../utils/feedPolling';

const rpc = async (name, args) => {
  const { data, error } = await supabase.rpc(name, args);
  if (error) {
    if (isMissingFunction(error)) return { missing: true };
    throw error;
  }
  return { data };
};

export const devSaleFees = {
  get: (token) => rpc('ican_dev_get_sale_fees', { dev_token: token }),
  set: (token, key, rate) => rpc('ican_dev_set_sale_fee', { dev_token: token, p_key: key, p_rate: rate }),
};

export default { devSaleFees };

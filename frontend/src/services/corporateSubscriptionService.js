/**
 * Corporate subscription / billing / contract-request RPCs — see
 * backend/CORPORATE_SUBSCRIPTION_TRIAL_AND_ICAN_BILLING.sql and
 * backend/CORPORATE_BILLING_CONTRACTS_AND_DEV_PANEL.sql.
 */

import { getSupabaseClient } from '../lib/supabase/client';

const supabase = getSupabaseClient();

export const getMyCorporateSubscription = async (businessProfileId) => {
  const { data, error } = await supabase.rpc('fn_get_my_corporate_subscription', {
    p_business_profile_id: businessProfileId,
  });
  if (error) throw error;
  return data?.[0] || null;
};

export const getMyCorporateSubscriptionCharges = async (businessProfileId, limit = 50) => {
  const { data, error } = await supabase.rpc('fn_get_my_corporate_subscription_charges', {
    p_business_profile_id: businessProfileId,
    p_limit: limit,
  });
  if (error) throw error;
  return data || [];
};

export const startCorporateTrial = async (businessProfileId, employeeCount) => {
  const { data, error } = await supabase.rpc('fn_start_corporate_trial', {
    p_business_profile_id: businessProfileId,
    p_employee_count: employeeCount,
  });
  if (error) throw error;
  return data?.[0] || null;
};

export const requestCorporateContract = async ({ companyName, contactName, contactEmail, contactPhone, employeeCount, message }) => {
  const { data, error } = await supabase.rpc('fn_request_corporate_contract', {
    p_company_name: companyName,
    p_contact_name: contactName,
    p_contact_email: contactEmail,
    p_contact_phone: contactPhone || null,
    p_employee_count: employeeCount,
    p_message: message || null,
  });
  if (error) throw error;
  return data?.[0] || null;
};

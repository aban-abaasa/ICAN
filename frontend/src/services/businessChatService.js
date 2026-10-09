import { supabase } from '../lib/supabase/client';
import { getBackendUrl } from '../lib/backendUrl';

/**
 * The "Ask us" chat on a business's public website: the AI assistant (api/business-chat.js, nothing stored),
 * and -- when a visitor wants a person -- a real two-way thread with the business's staff
 * (20261015100000_business_site_inquiries.sql). Visitors need no account: they hold a private token in their
 * browser, the way a job applicant keeps a reference code.
 */

const rpcResult = (data, error, fallbackMessage) => {
  if (error) throw new Error(error.message || fallbackMessage);
  if (!data?.success) throw new Error(data?.error || fallbackMessage);
  return data;
};

/** messages: [{ role: 'user' | 'assistant', text }], the last one the visitor's. */
export const askAssistant = async (companyId, messages) => {
  let response;
  try {
    response = await fetch(`${getBackendUrl()}/api/business-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyId, messages }),
    });
  } catch {
    throw new Error('Could not reach the assistant. Check your connection.');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.reply) throw new Error(data?.error || 'The assistant is unavailable right now.');
  return {
    reply: data.reply,
    needsHuman: data.needsHuman === true,
    suggestions: Array.isArray(data.suggestions) ? data.suggestions : [],
    actions: Array.isArray(data.actions) ? data.actions : [],
  };
};

/** Hand the conversation to the team. Resolves the visitor's private access token. */
export const startInquiry = async ({ companyId, name, contact, message, transcript = [] }) => {
  const { data, error } = await supabase.rpc('fn_public_inquiry_start', {
    p_company_id: companyId, p_name: name, p_contact: contact, p_message: message, p_transcript: transcript,
  });
  return rpcResult(data, error, 'Could not send your message').token;
};

export const sendInquiryMessage = async (token, message) => {
  const { data, error } = await supabase.rpc('fn_public_inquiry_send', { p_token: token, p_message: message });
  rpcResult(data, error, 'Could not send your message');
};

/** { status, visitor_name, visitor_contact, messages: [{ id, sender, body, created_at }] } */
export const getInquiry = async (token) => {
  const { data, error } = await supabase.rpc('fn_public_inquiry_get', { p_token: token });
  return rpcResult(data, error, 'Could not load this conversation');
};

// ---- staff side (CMMS > Posts & Jobs > Inquiries) -------------------------------------------

export const listInquiries = async (companyId) => {
  const { data, error } = await supabase.rpc('fn_cmms_inquiry_list', { p_company_id: companyId });
  if (error) return { success: false, error: error.message, data: [] };
  return { success: true, data: data || [] };
};

export const getInquiryThread = async (threadId) => {
  const { data, error } = await supabase.rpc('fn_cmms_inquiry_thread', { p_thread_id: threadId });
  if (error) return { success: false, error: error.message, data: null };
  return { success: true, data };
};

export const replyToInquiry = async (threadId, body) => {
  const { error } = await supabase.rpc('fn_cmms_inquiry_reply', { p_thread_id: threadId, p_body: body });
  return error ? { success: false, error: error.message } : { success: true };
};

export const setInquiryStatus = async (threadId, status) => {
  const { error } = await supabase.rpc('fn_cmms_inquiry_set_status', { p_thread_id: threadId, p_status: status });
  return error ? { success: false, error: error.message } : { success: true };
};

export default {
  askAssistant, startInquiry, sendInquiryMessage, getInquiry,
  listInquiries, getInquiryThread, replyToInquiry, setInquiryStatus,
};

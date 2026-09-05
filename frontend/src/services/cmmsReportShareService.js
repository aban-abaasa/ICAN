/**
 * CMMS Report Share Service
 * Secure shareable links for individual CMMS reports (public / password /
 * restricted-to-emails). Admin-management calls go through Supabase RPCs
 * the same way cmmsReportAccessService.js does; the anonymous viewer calls
 * (getReportShareAccess / verifyReportSharePassword / verifyReportShareOtp)
 * use the same anon Supabase client and work with no ICAN session, since a
 * share link's whole point is that the visitor never logs in. Only sending
 * the OTP email needs the trusted Node backend (Resend needs a server-side
 * key) — see backend/routes/reportShareRoutes.js.
 */

import { supabase } from '../lib/supabase/client';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

// ============================================================
// ADMIN: CREATE / LIST / REVOKE
// ============================================================

export const createReportShare = async (reportId, { visibility, password, allowedEmails, expiresAt }) => {
  try {
    const { data, error } = await supabase.rpc('fn_create_report_share', {
      p_report_id: reportId,
      p_visibility: visibility,
      p_password: password || null,
      p_allowed_emails: allowedEmails && allowedEmails.length ? allowedEmails : null,
      p_expires_at: expiresAt || null
    });

    if (error) return { success: false, error: error.message };
    return { success: true, data: data?.[0] || null };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

export const listReportShares = async (reportId) => {
  try {
    const { data, error } = await supabase.rpc('fn_list_report_shares', { p_report_id: reportId });
    if (error) return { success: false, error: error.message };
    return { success: true, data: data || [] };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

export const revokeReportShare = async (shareId) => {
  try {
    const { error } = await supabase.rpc('fn_revoke_report_share', { p_share_id: shareId });
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

// ============================================================
// VIEWER: ANONYMOUS ACCESS (no ICAN account required)
// ============================================================

export const getReportShareAccess = async (token) => {
  try {
    const { data, error } = await supabase.rpc('fn_get_report_share_access', { p_token: token });
    if (error) return { success: false, error: error.message };
    return { success: true, data: data?.[0] || null };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

export const verifyReportSharePassword = async (token, password) => {
  try {
    const { data, error } = await supabase.rpc('fn_verify_report_share_password', {
      p_token: token,
      p_password: password
    });
    if (error) return { success: false, error: error.message };
    return { success: true, data: data?.[0] || null };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

export const requestReportShareOtp = async (token, email) => {
  try {
    const response = await fetch(`${API_BASE_URL}/report-shares/request-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, email })
    });
    const data = await response.json();
    return { success: !!data.success, message: data.message };
  } catch (error) {
    return { success: false, message: 'Could not reach the server. Please try again.' };
  }
};

export const verifyReportShareOtp = async (token, email, code) => {
  try {
    const { data, error } = await supabase.rpc('fn_verify_report_share_otp', {
      p_token: token,
      p_email: email,
      p_code: code
    });
    if (error) return { success: false, error: error.message };
    return { success: true, data: data?.[0] || null };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

// ============================================================
// ADMIN: DEPARTMENT-SCOPED "WRITTEN REPORTS" EXPORT SHARES
// Shares the same grouped Department -> Employee -> Reports set the
// "Export Reports" panel's Download/Print buttons produce (see
// ReportsManager's reportDepartmentFilter/reportScopeLabel in
// CMSSModule.jsx), instead of a single report.
// ============================================================

export const createReportExportShare = async (
  companyId,
  { departmentFilter = 'all', reporterFilter = 'all', visibility, password, allowedEmails, expiresAt }
) => {
  try {
    const { data, error } = await supabase.rpc('fn_create_report_export_share', {
      p_company_id: companyId,
      p_department_filter: departmentFilter,
      p_reporter_filter: reporterFilter,
      p_visibility: visibility,
      p_password: password || null,
      p_allowed_emails: allowedEmails && allowedEmails.length ? allowedEmails : null,
      p_expires_at: expiresAt || null
    });

    if (error) return { success: false, error: error.message };
    return { success: true, data: data?.[0] || null };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

export const listReportExportShares = async (companyId) => {
  try {
    const { data, error } = await supabase.rpc('fn_list_report_export_shares', { p_company_id: companyId });
    if (error) return { success: false, error: error.message };
    return { success: true, data: data || [] };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

export const revokeReportExportShare = async (shareId) => {
  try {
    const { error } = await supabase.rpc('fn_revoke_report_export_share', { p_share_id: shareId });
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

export const getReportExportShareAccess = async (token) => {
  try {
    const { data, error } = await supabase.rpc('fn_get_report_export_share_access', { p_token: token });
    if (error) return { success: false, error: error.message };
    return { success: true, data: data?.[0] || null };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

export const verifyReportExportSharePassword = async (token, password) => {
  try {
    const { data, error } = await supabase.rpc('fn_verify_report_export_share_password', {
      p_token: token,
      p_password: password
    });
    if (error) return { success: false, error: error.message };
    return { success: true, data: data?.[0] || null };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

export const requestReportExportShareOtp = async (token, email) => {
  try {
    const response = await fetch(`${API_BASE_URL}/report-shares/request-export-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, email })
    });
    const data = await response.json();
    return { success: !!data.success, message: data.message };
  } catch (error) {
    return { success: false, message: 'Could not reach the server. Please try again.' };
  }
};

export const verifyReportExportShareOtp = async (token, email, code) => {
  try {
    const { data, error } = await supabase.rpc('fn_verify_report_export_share_otp', {
      p_token: token,
      p_email: email,
      p_code: code
    });
    if (error) return { success: false, error: error.message };
    return { success: true, data: data?.[0] || null };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

export default {
  createReportShare,
  listReportShares,
  revokeReportShare,
  getReportShareAccess,
  verifyReportSharePassword,
  requestReportShareOtp,
  verifyReportShareOtp,
  createReportExportShare,
  listReportExportShares,
  revokeReportExportShare,
  getReportExportShareAccess,
  verifyReportExportSharePassword,
  requestReportExportShareOtp,
  verifyReportExportShareOtp
};

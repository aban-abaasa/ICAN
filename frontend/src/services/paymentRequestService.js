/**
 * Payment Request Service
 * Handles creation, retrieval, and management of payment requests with QR codes
 */

import { getSupabaseClient } from '../lib/supabase/client';

const PAYMENT_REQUESTS_TABLE = 'payment_requests';
const PAYMENT_REQUESTS_SETUP_MESSAGE =
  'Payment requests are not configured in Supabase. Run backend/CREATE_PAYMENT_REQUESTS_TABLE.sql in Supabase SQL Editor, then refresh the app.';

function generatePaymentCode() {
  const baseId = (globalThis.crypto?.randomUUID?.() || `${Date.now()}${Math.random()}`)
    .replace(/-/g, '')
    .toUpperCase();
  return `PAY_${baseId.substring(0, 12)}`;
}

function getRequiredSupabaseClient() {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error(
      'Supabase client is not initialized. Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'
    );
  }
  return supabase;
}

async function getAuthenticatedUserId(supabase, requestedUserId = null) {
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    throw new Error('Unable to verify your session. Please sign in again.');
  }

  const authUserId = data?.user?.id;
  if (!authUserId) {
    throw new Error('Please sign in to create and manage payment requests.');
  }

  if (requestedUserId && requestedUserId !== authUserId) {
    console.warn('Payment requests user mismatch. Using authenticated user id instead.', {
      requestedUserId,
      authUserId
    });
  }

  return authUserId;
}

function inspectError(error) {
  const visited = new Set();
  const queue = [error];
  const statuses = [];
  const codes = [];
  const textParts = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current == null || visited.has(current)) continue;
    visited.add(current);

    if (typeof current === 'string') {
      textParts.push(current);
      continue;
    }

    if (typeof current !== 'object') continue;

    const statusValue = current.status ?? current.statusCode ?? current.httpStatus;
    if (statusValue != null) statuses.push(String(statusValue));

    const codeValue = current.code;
    if (codeValue != null) codes.push(String(codeValue).toUpperCase());

    const body = current.body;
    if (typeof body === 'string') textParts.push(body);
    if (body && typeof body === 'object') queue.push(body);

    const response = current.response;
    if (response && typeof response === 'object') queue.push(response);

    const nested = [current.error, current.cause, current.originalError, current.data, current.details];
    nested.forEach((item) => {
      if (item && typeof item === 'object') queue.push(item);
      if (typeof item === 'string') textParts.push(item);
    });

    const messageFields = [
      current.message,
      current.hint,
      current.error_description,
      current.statusText,
      current.url
    ];
    messageFields.forEach((item) => {
      if (typeof item === 'string') textParts.push(item);
    });
  }

  return {
    statuses,
    codes,
    combined: textParts.join(' ').toLowerCase()
  };
}

function isMissingPaymentRequestsTableError(error) {
  if (!error) return false;

  const { statuses, codes, combined } = inspectError(error);

  return (
    statuses.includes('404') ||
    codes.includes('PGRST205') ||
    codes.includes('42P01') ||
    combined.includes('/rest/v1/payment_requests') ||
    combined.includes('public.payment_requests') ||
    (combined.includes('payment_requests') &&
      (combined.includes('not found') ||
        combined.includes('does not exist') ||
        combined.includes('schema cache')))
  );
}

function normalizePaymentRequestError(error, action) {
  if (isMissingPaymentRequestsTableError(error)) {
    return new Error(PAYMENT_REQUESTS_SETUP_MESSAGE);
  }

  const { combined } = inspectError(error);
  if (
    combined.includes('row-level security') ||
    combined.includes('violates row-level security') ||
    combined.includes('new row violates')
  ) {
    return new Error('Permission denied by Supabase RLS. Please sign out and sign in again, then retry.');
  }

  if (error instanceof Error && error.message) {
    return error;
  }

  if (combined) {
    const rawMessage = combined.trim();
    if (rawMessage) {
      return new Error(rawMessage);
    }
  }

  if (action.toLowerCase().includes('payment request')) {
    return new Error(PAYMENT_REQUESTS_SETUP_MESSAGE);
  }

  return new Error(`${action} failed. Please try again.`);
}

function throwIfPostgrestError(error, action) {
  if (error) {
    throw normalizePaymentRequestError(error, action);
  }
}

class PaymentRequestService {
  /**
   * Create a new payment request with unique code
   */
  async createPaymentRequest(userId, amount, currency, description = '') {
    try {
      const supabase = getRequiredSupabaseClient();
      const ownerUserId = await getAuthenticatedUserId(supabase, userId);
      const parsedAmount = Number.parseFloat(amount);

      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        throw new Error('Please enter a valid amount greater than zero.');
      }

      const paymentCode = generatePaymentCode();

      const { data, error } = await supabase
        .from(PAYMENT_REQUESTS_TABLE)
        .insert([
          {
            user_id: ownerUserId,
            payment_code: paymentCode,
            amount: parsedAmount,
            currency,
            description,
            status: 'pending',
            created_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
          }
        ])
        .select()
        .single();

      throwIfPostgrestError(error, 'Creating payment request');

      return {
        success: true,
        data,
        paymentCode,
        paymentLink: `${window.location.origin}/pay/${paymentCode}`
      };
    } catch (error) {
      const normalizedError = normalizePaymentRequestError(error, 'Creating payment request');
      console.error('Payment request creation failed:', normalizedError);
      throw normalizedError;
    }
  }

  /**
   * Get payment request details by code
   */
  async getPaymentRequest(paymentCode) {
    try {
      const supabase = getRequiredSupabaseClient();

      const { data, error } = await supabase
        .from(PAYMENT_REQUESTS_TABLE)
        .select('*')
        .eq('payment_code', paymentCode)
        .single();

      throwIfPostgrestError(error, 'Fetching payment request');

      if (data && new Date(data.expires_at) < new Date()) {
        await this.updatePaymentRequestStatus(paymentCode, 'expired');
        return {
          success: false,
          message: 'Payment request has expired',
          data
        };
      }

      return {
        success: true,
        data
      };
    } catch (error) {
      const normalizedError = normalizePaymentRequestError(error, 'Fetching payment request');
      console.error('Error fetching payment request:', normalizedError);
      throw normalizedError;
    }
  }

  /**
   * Update payment request status
   */
  async updatePaymentRequestStatus(paymentCode, status) {
    try {
      const supabase = getRequiredSupabaseClient();

      const { data, error } = await supabase
        .from(PAYMENT_REQUESTS_TABLE)
        .update({ status, updated_at: new Date().toISOString() })
        .eq('payment_code', paymentCode)
        .select()
        .single();

      throwIfPostgrestError(error, 'Updating payment request status');

      return {
        success: true,
        data
      };
    } catch (error) {
      const normalizedError = normalizePaymentRequestError(error, 'Updating payment request status');
      console.error('Error updating payment request status:', normalizedError);
      throw normalizedError;
    }
  }

  /**
   * Get all payment requests for a user
   */
  async getUserPaymentRequests(userId, limit = 20) {
    try {
      const supabase = getRequiredSupabaseClient();
      const ownerUserId = await getAuthenticatedUserId(supabase, userId);

      const { data, error } = await supabase
        .from(PAYMENT_REQUESTS_TABLE)
        .select('*')
        .eq('user_id', ownerUserId)
        .order('created_at', { ascending: false })
        .limit(limit);

      throwIfPostgrestError(error, 'Fetching user payment requests');

      return {
        success: true,
        data: data || []
      };
    } catch (error) {
      const normalizedError = normalizePaymentRequestError(error, 'Fetching user payment requests');
      console.error('Error fetching user payment requests:', normalizedError);
      throw normalizedError;
    }
  }

  /**
   * Complete a payment request
   */
  async completePaymentRequest(paymentCode, payerUserId, transactionId) {
    try {
      const supabase = getRequiredSupabaseClient();

      const { data, error } = await supabase
        .from(PAYMENT_REQUESTS_TABLE)
        .update({
          status: 'completed',
          payer_user_id: payerUserId,
          transaction_id: transactionId,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('payment_code', paymentCode)
        .select()
        .single();

      throwIfPostgrestError(error, 'Completing payment request');

      return {
        success: true,
        data
      };
    } catch (error) {
      const normalizedError = normalizePaymentRequestError(error, 'Completing payment request');
      console.error('Error completing payment request:', normalizedError);
      throw normalizedError;
    }
  }

  /**
   * Delete a payment request
   */
  async deletePaymentRequest(paymentCode) {
    try {
      const supabase = getRequiredSupabaseClient();

      const { error } = await supabase
        .from(PAYMENT_REQUESTS_TABLE)
        .delete()
        .eq('payment_code', paymentCode);

      throwIfPostgrestError(error, 'Deleting payment request');

      return {
        success: true,
        message: 'Payment request deleted'
      };
    } catch (error) {
      const normalizedError = normalizePaymentRequestError(error, 'Deleting payment request');
      console.error('Error deleting payment request:', normalizedError);
      throw normalizedError;
    }
  }

  /**
   * Get active payment requests (not expired)
   */
  async getActivePaymentRequests(userId) {
    try {
      const supabase = getRequiredSupabaseClient();
      const ownerUserId = await getAuthenticatedUserId(supabase, userId);

      const { data, error } = await supabase
        .from(PAYMENT_REQUESTS_TABLE)
        .select('*')
        .eq('user_id', ownerUserId)
        .eq('status', 'pending')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false });

      throwIfPostgrestError(error, 'Fetching active payment requests');

      return {
        success: true,
        data: data || []
      };
    } catch (error) {
      const normalizedError = normalizePaymentRequestError(error, 'Fetching active payment requests');
      console.error('Error fetching active payment requests:', normalizedError);
      throw normalizedError;
    }
  }
}

export default new PaymentRequestService();

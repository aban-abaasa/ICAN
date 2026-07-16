/**
 * Flutterwave inline checkout — public key only, safe for the browser.
 * Payment is verified server-side by a Supabase Edge Function before any
 * wallet credit happens. Separate from flutterwaveService.js (which uses an
 * older redirect-to-backend verification flow still used elsewhere) — this
 * one resolves in-page via a callback, matching the edge-function-based
 * verification path used for ICAN coin buys and wallet top-ups.
 */

const PUBLIC_KEY = import.meta.env.VITE_FLUTTERWAVE_PUBLIC_KEY;

export function generateTxRef(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
}

/**
 * @param {{amount:number, currency?:string, customerEmail?:string, customerName?:string,
 *   customerPhone?:string, title?:string, description?:string, txRef:string}} params
 * @returns {Promise<{status:'successful'|'cancelled'|'failed', transaction_id?:string, tx_ref:string}>}
 */
export function payWithFlutterwave(params) {
  return new Promise((resolve, reject) => {
    if (!window.FlutterwaveCheckout) {
      reject(new Error('Flutterwave checkout is not available. Please refresh and try again.'));
      return;
    }
    if (!PUBLIC_KEY) {
      reject(new Error('Flutterwave is not configured for this app.'));
      return;
    }

    window.FlutterwaveCheckout({
      public_key: PUBLIC_KEY,
      tx_ref: params.txRef,
      amount: params.amount,
      currency: params.currency || 'UGX',
      // Uganda-supported channels only — 'card' covers Visa/Mastercard,
      // 'mobilemoneyuganda' covers both MTN and Airtel Uganda mobile money,
      // 'account' is bank-account/direct-debit.
      payment_options: 'card,mobilemoneyuganda,account',
      customer: {
        email: params.customerEmail || 'customer@ican.io',
        phone_number: params.customerPhone || '',
        name: params.customerName || 'ICAN Customer',
      },
      customizations: {
        title: params.title || 'ICAN Wallet',
        description: params.description || 'ICAN Wallet Top-Up',
      },
      callback: (response) => {
        resolve({
          status: response.status === 'successful' ? 'successful' : 'failed',
          transaction_id: response.transaction_id ? String(response.transaction_id) : undefined,
          tx_ref: params.txRef,
        });
      },
      onclose: () => {
        resolve({ status: 'cancelled', tx_ref: params.txRef });
      },
    });
  });
}

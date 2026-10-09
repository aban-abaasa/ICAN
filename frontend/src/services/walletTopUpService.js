import { supabase } from '../lib/supabase/client';
import { payWithFlutterwave, generateTxRef } from './flutterwaveClient';
import { ICAN_TO_UGX, SOURCE_APP, ugxToICAN } from './icanWalletService';

export const MIN_TOPUP_UGX = 1000;

// Same contract as icanWalletService's own comment on buyICAN: the customer
// pays through Flutterwave's checkout (card, Mobile Money or bank), and ONLY
// the verify-flutterwave-payment Edge Function -- which re-checks the charge
// with Flutterwave using the secret key -- credits the ICAN wallet. Nothing
// here can credit coins by itself, and the amount credited can never exceed
// what was actually paid (the function enforces ican_amount x 5,000 UGX).
// This is the ICAN balance dropship checkout spends from.
export async function topUpIcanWallet({ ugx, customerEmail, customerName, customerPhone }) {
  const amount = Math.floor(Number(ugx) || 0);
  if (amount < MIN_TOPUP_UGX) return { success: false, error: `The smallest top-up is UGX ${MIN_TOPUP_UGX.toLocaleString()}` };

  const icanAmount = ugxToICAN(amount);
  const txRef = generateTxRef('IcanEra-TOPUP');
  const payment = await payWithFlutterwave({
    amount,
    currency: 'UGX',
    customerEmail,
    customerName,
    customerPhone,
    title: 'Top up your IcanEra wallet',
    description: `Add ${icanAmount.toFixed(4)} ICAN to your IcanEra wallet`,
    txRef,
  });

  if (payment.status === 'cancelled') return { success: false, cancelled: true };
  if (payment.status !== 'successful' || !payment.transaction_id) return { success: false, error: 'The payment was not completed' };

  const { data, error } = await supabase.functions.invoke('verify-flutterwave-payment', {
    body: { transaction_id: payment.transaction_id, tx_ref: txRef, ican_amount: icanAmount, source_app: SOURCE_APP },
  });
  if (error || !data?.success) {
    // The charge went through but crediting did not confirm -- say so plainly so nobody pays twice.
    return { success: false, paid: true, error: data?.error || 'Your payment went through but we could not confirm the credit yet. Check your wallet in a minute, or contact support with reference ' + txRef };
  }
  return { success: true, icanAmount, ugx: amount, txRef, alreadyProcessed: !!data.already_processed };
}

export { ICAN_TO_UGX };

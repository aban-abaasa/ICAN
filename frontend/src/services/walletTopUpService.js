import { supabase } from '../lib/supabase/client';
import { payWithFlutterwave, generateTxRef } from './flutterwaveClient';
import { ICAN_TO_UGX, SOURCE_APP } from './icanWalletService';
import { TOPUP_CURRENCIES, decimalsFor, formatMoney, getTopUpQuote, minTopUp } from './topUpCurrency';

// The customer pays through Flutterwave's checkout (card, Mobile Money or bank) in their own
// currency, and ONLY the verify-flutterwave-payment Edge Function -- which re-checks the charge
// with Flutterwave using the secret key AND against the live coin price -- credits the ICAN
// wallet. Nothing here can credit coins by itself, and the coins credited can never exceed what
// was paid for at the live price. This is the ICAN balance dropship checkout spends from.
export async function topUpIcanWallet({ amount, customerEmail, customerName, customerPhone }) {
  // A fresh live quote at the moment of paying -- never the one the panel showed a minute ago.
  const { currency, price } = await getTopUpQuote();
  const cfg = TOPUP_CURRENCIES[currency];
  const local = decimalsFor(currency) ? Math.round(Number(amount) * 100) / 100 : Math.floor(Number(amount) || 0);
  if (!(local >= minTopUp(currency, price))) return { success: false, error: `The smallest top-up is ${formatMoney(minTopUp(currency, price), currency)}` };

  const icanAmount = Math.floor((local / price) * 1e8) / 1e8;
  const txRef = generateTxRef('IcanEra-TOPUP');
  const payment = await payWithFlutterwave({
    amount: local,
    currency,
    paymentOptions: cfg.options,
    customerEmail,
    customerName,
    customerPhone,
    title: 'Top up your IcanEra wallet',
    description: `Add ${icanAmount.toFixed(4)} ICAN to your IcanEra wallet at ${formatMoney(price, currency)} per coin`,
    txRef,
  });

  if (payment.status === 'cancelled') return { success: false, cancelled: true };
  if (payment.status !== 'successful' || !payment.transaction_id) return { success: false, error: 'The payment was not completed' };

  const { data, error } = await supabase.functions.invoke('verify-flutterwave-payment', {
    body: { transaction_id: payment.transaction_id, tx_ref: txRef, ican_amount: icanAmount, source_app: SOURCE_APP, currency },
  });
  if (error || !data?.success) {
    // The charge went through but crediting did not confirm -- say so plainly so nobody pays twice.
    return { success: false, paid: true, error: data?.error || 'Your payment went through but we could not confirm the credit yet. Check your wallet in a minute, or contact support with reference ' + txRef };
  }
  return { success: true, icanAmount, local, currency, price, txRef, alreadyProcessed: !!data.already_processed };
}

export { ICAN_TO_UGX };

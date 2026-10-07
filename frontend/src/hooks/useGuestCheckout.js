import { useCallback, useEffect, useRef, useState } from 'react';
import { quoteGuestCheckout, payAsGuest, resumePendingGuestCheckout } from '../services/guestCheckoutService';

/**
 * State for the "pay with Mobile Money / card / bank, no wallet needed" option
 * shared by the public dropship storefront and the business website shop.
 * Only active for signed-out visitors (`enabled`); signed-in customers keep
 * paying from their IcanEra wallet.
 *
 * quote  — server price for the cart as it stands: items, delivery,
 *          processing fee and the total the guest would be charged.
 * payNow — validates name/phone, then opens Flutterwave and places the order;
 *          calls onPaid(receipt) once the server has confirmed it.
 */
export default function useGuestCheckout({
  enabled,
  businessProfileId,
  cartItems,
  customerName,
  customerPhone,
  deliveryAddress,
  deliveryCoords,
  maxDeliveryHours,
  vehicleType,
  storeName,
  onPaid,
}) {
  const [quote, setQuote] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState(null);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState(null);
  const onPaidRef = useRef(onPaid);
  onPaidRef.current = onPaid;

  const cart = cartItems.map((row) => ({ product_id: row.listing.product_id, quantity: row.qty }));
  const cartKey = JSON.stringify(cart);
  const vehicleTypes = vehicleType ? [vehicleType] : null;

  const params = () => ({
    businessProfileId,
    cart,
    customerName: customerName.trim(),
    customerPhone: customerPhone.trim(),
    deliveryAddress: deliveryAddress.trim(),
    deliveryLat: deliveryCoords?.lat,
    deliveryLng: deliveryCoords?.lng,
    maxDeliveryHours,
    vehicleTypes,
  });

  // Live server quote whenever the cart, delivery point, window or vehicle changes.
  useEffect(() => {
    setQuote(null);
    setQuoteError(null);
    if (!enabled || !businessProfileId || cart.length === 0 || !deliveryCoords) return undefined;
    let cancelled = false;
    setQuoting(true);
    const timer = setTimeout(() => {
      quoteGuestCheckout(params())
        .then((q) => { if (!cancelled) setQuote(q); })
        .catch((err) => { if (!cancelled) setQuoteError(err.message); })
        .finally(() => { if (!cancelled) setQuoting(false); });
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, businessProfileId, cartKey, deliveryCoords?.lat, deliveryCoords?.lng, maxDeliveryHours, vehicleType]);

  // Paid but closed the tab last time? Finish that order now.
  useEffect(() => {
    if (!enabled || !businessProfileId) return;
    resumePendingGuestCheckout(businessProfileId).then((result) => {
      if (result) onPaidRef.current?.(result);
    });
  }, [enabled, businessProfileId]);

  const payNow = useCallback(async () => {
    setPayError(null);
    if (!customerName.trim()) { setPayError('Enter your name first'); return; }
    if (customerPhone.replace(/[^0-9]/g, '').length < 9) { setPayError('Enter the phone number you will pay with'); return; }
    if (!deliveryCoords) { setPayError('Share your delivery location first — a real rider is booked for this order'); return; }
    if (!quote) { setPayError(quoteError || 'Still pricing your order — one moment'); return; }

    setPaying(true);
    try {
      const out = await payAsGuest(params(), { expectedCharge: quote.charge_ugx, storeName });
      if (out.priceChanged) {
        setQuote(out.quote);
        setPayError('The delivery price just changed — please check the new total and tap Pay again. You have not been charged.');
      } else {
        onPaidRef.current?.(out.result);
      }
    } catch (err) {
      setPayError(err.message || 'Payment failed. Please try again.');
    } finally {
      setPaying(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerName, customerPhone, deliveryAddress, deliveryCoords, maxDeliveryHours, vehicleType, quote, quoteError, cartKey, businessProfileId, storeName]);

  return { quote, quoting, quoteError, paying, payError, payNow };
}

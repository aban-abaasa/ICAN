import { useEffect, useState } from 'react';

/**
 * A cart ({ listing_id: quantity }) that survives leaving the page. Signing up with Google sends the visitor
 * to Google and back, which reloads the page and would otherwise empty their basket mid-payment. Kept in
 * sessionStorage (this tab only) and cleared as soon as the cart is empty, so it never outlives the order.
 */
export default function usePersistedCart(key) {
  const [cart, setCart] = useState(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) || '{}');
      return saved && typeof saved === 'object' ? saved : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    try {
      if (Object.values(cart).some((qty) => qty > 0)) sessionStorage.setItem(key, JSON.stringify(cart));
      else sessionStorage.removeItem(key);
    } catch { /* private mode — the cart just won't survive a reload */ }
  }, [cart, key]);

  return [cart, setCart];
}

const openKey = (key) => `${key}:open`;

/** Remember that the cart panel was open, so it can be reopened after a Google round-trip. */
export const markCartOpen = (key) => { try { sessionStorage.setItem(openKey(key), '1'); } catch { /* ignore */ } };

/** True once, if the cart panel was open when the page was left. */
export const consumeCartOpen = (key) => {
  try {
    const was = sessionStorage.getItem(openKey(key)) === '1';
    if (was) sessionStorage.removeItem(openKey(key));
    return was;
  } catch {
    return false;
  }
};

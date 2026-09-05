// Shared anonymous-visitor identity for the public /portfolio/<handle> page —
// used by both the guest call feature (useDirectCall room id) and the direct
// chat feature (portfolio_conversations.guest_id), so a signed-out visitor
// is recognized as "the same guest" across both without needing an account.
const GUEST_ID_KEY = 'ican_portfolio_guest_id';

export function getOrCreatePortfolioGuestId() {
  try {
    let id = window.localStorage.getItem(GUEST_ID_KEY);
    if (!id) {
      id = `guest-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      window.localStorage.setItem(GUEST_ID_KEY, id);
    }
    return id;
  } catch (_) {
    return `guest-${Math.random().toString(36).slice(2)}`;
  }
}

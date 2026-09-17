/**
 * Shared ICE server list for every WebRTC hook (useCommunityLive.js,
 * useDirectCall.js, LiveBoardroom.jsx) — same underlying reason each of
 * them needs TURN, so one place to configure it.
 *
 * STUN alone frequently can't punch a direct peer-to-peer path through
 * carrier-grade NAT on mobile data (and plenty of corporate/hotel wifi) —
 * that's the #1 cause of a far-away viewer getting a broken/degraded feed
 * (or a broadcaster never connecting to them at all) while a nearby viewer
 * on a friendlier network connects instantly. TURN relays the media through
 * a server instead of relying on a direct path, at the cost of that
 * relay's own bandwidth/location becoming part of the path.
 *
 * By default this falls back to openrelay.metered.ca, a free, intentionally
 * -public demo relay — it works, but it's shared by every app that ever
 * copy-pasted their sample credentials, is rate-limited, and has no SLA or
 * guaranteed region near your users. Get your own free TURN credentials
 * (metered.ca's free tier, Cloudflare Calls' free tier, etc. — no payment
 * required, just a signup) and set VITE_TURN_URLS / VITE_TURN_USERNAME /
 * VITE_TURN_CREDENTIAL (see .env) to use them instead — no code change
 * needed after that.
 */
const FALLBACK_TURN_SERVERS = [
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
];

const STUN_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

const buildTurnServers = () => {
  const urls = (import.meta.env.VITE_TURN_URLS || '').split(',').map((u) => u.trim()).filter(Boolean);
  const username = import.meta.env.VITE_TURN_USERNAME;
  const credential = import.meta.env.VITE_TURN_CREDENTIAL;

  if (urls.length === 0 || !username || !credential) {
    return FALLBACK_TURN_SERVERS;
  }
  return urls.map((turnUrl) => ({ urls: turnUrl, username, credential }));
};

export const ICE_SERVERS = [...STUN_SERVERS, ...buildTurnServers()];

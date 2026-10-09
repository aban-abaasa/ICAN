import { useEffect, useState } from 'react';
import icanCoinBlockchainService from '../../services/icanCoinBlockchainService';

// Live IcanEra Coin value (UGX per 1 ICAN), from the same USD-anchored engine
// that drives the wallet and the landing "Live Market" ticker
// (ican_get_market_snapshot, readable by anon). One shared fetch for every
// product tile on the page, refreshed every minute while the page is open.
const REFRESH_MS = 60 * 1000;
let cached = null;      // { priceUGX, change24h, at }
let inflight = null;
const listeners = new Set();

const refresh = () => {
  if (inflight) return inflight;
  inflight = icanCoinBlockchainService.getCurrentPrice()
    .then((p) => {
      // 'default' means the engine was unreachable -- don't present a made-up
      // number as a live value.
      cached = p?.source && p.source !== 'default' && Number(p.priceUGX) > 0
        ? { priceUGX: Number(p.priceUGX), change24h: Number(p.percentageChange24h) || 0, at: Date.now() }
        : null;
      listeners.forEach((fn) => fn(cached));
    })
    .catch(() => {})
    .finally(() => { inflight = null; });
  return inflight;
};

export const useIcanCoinPrice = () => {
  const [coin, setCoin] = useState(cached);
  useEffect(() => {
    listeners.add(setCoin);
    if (!cached || Date.now() - cached.at > REFRESH_MS) refresh(); else setCoin(cached);
    const timer = setInterval(refresh, REFRESH_MS);
    return () => { listeners.delete(setCoin); clearInterval(timer); };
  }, []);
  return coin; // null until (or unless) a live price is available
};

// 0.5 -> "0.50", 12.3456 -> "12.35", 0.00042 -> "0.00042"
export const formatIcan = (ugx, coin) => {
  if (!coin || !(coin.priceUGX > 0)) return null;
  const value = Number(ugx || 0) / coin.priceUGX;
  const digits = value >= 1 ? 2 : value >= 0.01 ? 3 : 5;
  return value.toLocaleString(undefined, { minimumFractionDigits: Math.min(2, digits), maximumFractionDigits: digits });
};

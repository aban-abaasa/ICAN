/**
 * Prices of paid IcanEra services that a developer sets from the dev panel (supabase/migrations/20261119100000_video_product_badges.sql).
 * A service has a price in IcanEra coin (IC) and a Free / Charged switch that remembers the price, so it can be alternated at any time.
 */

export const SERVICES = [
  {
    key: 'pitch_product_badge',
    title: 'PitchIn product badge',
    what: 'A badge with a product and its price shown over a PitchIn video for 30 days.',
    paidBy: 'the business, from its wallet (the owner pays; staff can publish while it is free)',
    unit: 'per badge, per 30 days',
  },
  {
    key: 'status_product_badge',
    title: 'Status product badge',
    what: 'A badge with a product and its price shown over a status update for as long as the status lasts (24 hours). Up to 3 per status.',
    paidBy: 'the business, from its wallet (only the owner can pay)',
    unit: 'per badge, per status',
  },
];

/** Reads the price box: '', '5', '2.5' -> { ok, price }. IC to up to 8 decimals, 0 to 1,000,000. */
export const parsePriceIc = (text) => {
  const t = String(text ?? '').trim();
  if (!/^\d+(\.\d{1,8})?$/.test(t)) return { ok: false, error: 'Type an amount of IC, for example 5 or 2.5.' };
  const price = Number(t);
  if (price > 1000000) return { ok: false, error: 'The most a service can cost is 1,000,000 IC.' };
  return { ok: true, price };
};

/** "Free" or "5 IC". */
export const describePrice = (charged, priceIc) => (charged && Number(priceIc) > 0 ? `${Number(priceIc)} IC` : 'Free');

/**
 * What saving would do, in words, for the confirmation box. `changed` is false when nothing differs.
 * `big` asks for a second confirmation: switching a free service on, or a price that more than doubles.
 */
export const describeServiceChange = (service, current, next) => {
  const was = describePrice(current.charged, current.price_ic);
  const will = describePrice(next.charged, next.price);
  const changed = current.charged !== next.charged || Number(current.price_ic) !== Number(next.price);
  const big = changed && next.charged && (!current.charged || Number(next.price) > Number(current.price_ic) * 2);
  let message;
  if (!changed) message = `${service.title} stays ${was}.`;
  else if (!next.charged) message = `Switch ${service.title} to FREE? Businesses will publish and renew it at no cost from now on. The price (${Number(next.price)} IC) is remembered for when you switch it back on. Badges already running keep running.`;
  else message = `Charge ${will} ${service.unit} for ${service.title}? It was ${was}. It applies to the next publish or renewal; badges already running are not charged again until they are renewed.`;
  return { changed, big, message, was, will };
};

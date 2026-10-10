// Pure helpers behind the Dashboard transaction ledger: which business a record
// belongs to, scoping / filtering a period's records, and grouping them by day.
// Kept free of React so the rules can be unit-tested.

/** Bucket for business records that cannot be tied to a business the user can open. */
export const OTHER_BUSINESS = '__other';

const rowDate = (tx) => tx?.created_at || tx?.date || tx?.timestamp || tx?.transaction_date || null;
const rowTime = (tx) => {
  const t = new Date(rowDate(tx)).getTime();
  return Number.isNaN(t) ? 0 : t;
};

export const isBusinessTx = (tx) => (tx?.record_category || tx?.metadata?.record_category || 'personal') === 'business';
export const isIncomeTx = (tx) => tx?.transaction_type === 'income';
export const businessIdOf = (tx) => tx?.business_profile_id || tx?.metadata?.business_profile_id || null;

/**
 * Exact name of the business a record belongs to, or null.
 * `names` is a Map of business_profile_id -> business_name for the businesses the
 * user can access. A business record with no business tag is only attributed when
 * the user has exactly one business, where it is unambiguous.
 */
export const businessNameOf = (tx, names) => {
  if (!names || !tx) return null;
  const id = businessIdOf(tx);
  if (id) return names.get(id) || null;
  if (isBusinessTx(tx) && names.size === 1) return [...names.values()][0];
  return null;
};

/** Filter key of a business record: its business id, or OTHER_BUSINESS when it has no usable one. */
export const businessKeyOf = (tx, names) => {
  const id = businessIdOf(tx);
  if (id && names?.has(id)) return id;
  if (!id && names?.size === 1) return [...names.keys()][0];
  return OTHER_BUSINESS;
};

/** In / out / net for a set of records. Everything that is not income counts as money out. */
export const summarize = (rows) => {
  let income = 0;
  let expense = 0;
  rows.forEach((tx) => {
    const amount = Number(tx?.amount) || 0;
    if (isIncomeTx(tx)) income += amount;
    else expense += amount;
  });
  return { income, expense, net: income - expense, count: rows.length };
};

/** Per-business counts and totals for the business records in `rows`, busiest first. */
export const businessBreakdown = (rows, names) => {
  const groups = new Map();
  rows.filter(isBusinessTx).forEach((tx) => {
    const key = businessKeyOf(tx, names);
    const group = groups.get(key) || {
      key,
      name: key === OTHER_BUSINESS ? 'Other business' : names.get(key),
      count: 0,
      amount: 0,
    };
    group.count += 1;
    group.amount += Math.abs(Number(tx.amount) || 0);
    groups.set(key, group);
  });
  return [...groups.values()].sort((a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name)));
};

/** Narrow to personal / business, and to one business when `businessKey` is given. */
export const filterByAccount = (rows, account, businessKey, names) => {
  if (account === 'personal') return rows.filter((tx) => !isBusinessTx(tx));
  if (account !== 'business') return rows;
  const business = rows.filter(isBusinessTx);
  return businessKey ? business.filter((tx) => businessKeyOf(tx, names) === businessKey) : business;
};

export const filterByDirection = (rows, direction) => {
  if (direction === 'in') return rows.filter(isIncomeTx);
  if (direction === 'out') return rows.filter((tx) => !isIncomeTx(tx));
  return rows;
};

export const sortNewestFirst = (rows) => [...rows].sort((a, b) => rowTime(b) - rowTime(a));

const dayKey = (date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

/** "Today", "Yesterday", or e.g. "Monday, 6 Oct" (with the year when it is not this one). */
export const dayLabel = (date, now = new Date()) => {
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (dayKey(date) === dayKey(now)) return 'Today';
  if (dayKey(date) === dayKey(yesterday)) return 'Yesterday';
  const opts = { weekday: 'long', day: 'numeric', month: 'short' };
  if (date.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return date.toLocaleDateString([], opts);
};

/**
 * Group the first `limit` of `rows` (newest first) by calendar day. Each group's
 * `net` covers every row of that day in `rows`, not only the ones shown, so a day
 * cut off by "Show more" still reports its true total.
 */
export const groupByDay = (rows, limit = rows.length, now = new Date()) => {
  const nets = new Map();
  rows.forEach((tx) => {
    const key = dayKey(new Date(rowTime(tx)));
    nets.set(key, (nets.get(key) || 0) + (isIncomeTx(tx) ? 1 : -1) * (Number(tx?.amount) || 0));
  });
  const groups = [];
  rows.slice(0, limit).forEach((tx) => {
    const date = new Date(rowTime(tx));
    const key = dayKey(date);
    let group = groups[groups.length - 1];
    if (!group || group.key !== key) {
      group = { key, label: dayLabel(date, now), net: nets.get(key) || 0, rows: [] };
      groups.push(group);
    }
    group.rows.push(tx);
  });
  return groups;
};

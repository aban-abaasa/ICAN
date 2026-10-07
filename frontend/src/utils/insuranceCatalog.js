// IcanEra Cover (insurance): the words and small rules every insurance screen shares, so the
// customer's tab, the insurer's desk and the compliance checklist can never disagree.
// The data behind it: backend/ADD_INSURANCE_PLATFORM.sql.

export const COVER_TYPES = {
  accident:         { label: 'Accident',         blurb: 'Injury or death from an accident' },
  third_party:      { label: 'Third-party',      blurb: 'Harm you cause to others; the legal minimum for a vehicle' },
  comprehensive:    { label: 'Comprehensive',    blurb: 'Your vehicle and third parties' },
  medical:          { label: 'Medical',          blurb: 'Hospital and treatment costs' },
  life:             { label: 'Life',             blurb: 'A payout to your family' },
  goods_in_transit: { label: 'Goods in transit', blurb: 'Parcels and cargo you carry' },
  property:         { label: 'Property',         blurb: 'Stock, premises and equipment' },
  liability:        { label: 'Liability',        blurb: 'Claims against your business, including staff injury' },
  fleet:            { label: 'Fleet',            blurb: 'All your vehicles under one policy' },
};
export const COVER_TYPE_IDS = Object.keys(COVER_TYPES);
export const coverTypeLabel = (type) => COVER_TYPES[type]?.label || String(type || '').replace(/_/g, ' ');

export const AUDIENCES = {
  person:   { label: 'People',     blurb: 'Individuals' },
  rider:    { label: 'Riders',     blurb: 'BodaGoEra riders and drivers, shown on their live rider card' },
  business: { label: 'Businesses', blurb: 'Companies, their staff and fleets' },
};

export const VEHICLE_TYPES = ['motorcycle', 'bicycle', 'tuktuk', 'car', 'van', 'truck'];

export const PERIODS = [
  { days: 7, label: 'Weekly', unit: 'week' },
  { days: 30, label: 'Monthly', unit: 'month' },
  { days: 90, label: 'Quarterly', unit: '3 months' },
  { days: 365, label: 'Yearly', unit: 'year' },
];
// Renewing opens in the last half of a period (30 days at most), the same rule the database enforces,
// so a double tap or an over-eager renewal can never charge twice for cover that is already paid for.
export const renewWindowDays = (periodDays) => Math.min(periodDays / 2, 30);

export const periodLabel = (days) => PERIODS.find((p) => p.days === days)?.unit || `${days} days`;

export const POLICY_STATE = {
  active:    { label: 'Active',      tone: 'ok' },
  grace:     { label: 'Renew now',   tone: 'warn' },
  waiting:   { label: 'Starts soon', tone: 'warn' },
  expired:   { label: 'Expired',     tone: 'bad' },
  cancelled: { label: 'Cancelled',   tone: 'muted' },
};
export const isLiveState = (state) => state === 'active' || state === 'waiting' || state === 'grace';

/** The live policy (if any) that satisfies a readiness item, from the covers the person and their businesses hold. */
export const coveredBy = (item, covers) =>
  (item && item.covers && covers ? covers.find((c) => isLiveState(c.state) && item.covers.includes(c.cover_type)) : null) || null;

export const CLAIM_STATUS = {
  submitted:   { label: 'Submitted',        tone: 'muted' },
  in_review:   { label: 'Under review',     tone: 'warn' },
  info_needed: { label: 'More info needed', tone: 'warn' },
  approved:    { label: 'Approved',         tone: 'ok' },
  rejected:    { label: 'Rejected',         tone: 'bad' },
  paid:        { label: 'Paid',             tone: 'ok' },
  closed:      { label: 'Closed',           tone: 'muted' },
};
export const CLAIM_OPEN = ['submitted', 'in_review', 'info_needed', 'approved'];

export const INSURER_STATUS = {
  pending:   { label: 'Awaiting verification', tone: 'warn' },
  verified:  { label: 'Verified',              tone: 'ok' },
  suspended: { label: 'Suspended',             tone: 'bad' },
  rejected:  { label: 'Not approved',          tone: 'bad' },
};

export const SHARE_SCOPES = [
  { id: 'identity',   label: 'Who I am',          help: 'Your email and your vehicle details. Your licence number stays hidden.' },
  { id: 'activity',   label: 'My ride record',    help: 'Rides finished and cancelled, your rating, how long you have ridden.' },
  { id: 'compliance', label: 'My standing',       help: 'Driving permit status, ID card and any commission you owe.' },
  { id: 'finances',   label: 'My money, monthly', help: 'Monthly totals of ICAN in and out for six months. Never individual transactions.' },
];
export const BUSINESS_SHARE_SCOPES = [
  { id: 'business_activity', label: 'Fleet activity',  help: 'How many drivers you have and the rides they finish and cancel.' },
  { id: 'business_finances', label: 'Business wallet', help: 'Monthly totals of ICAN in and out of the business wallet. Never individual transactions.' },
];
export const scopeLabel = (id) =>
  [...SHARE_SCOPES, ...BUSINESS_SHARE_SCOPES].find((s) => s.id === id)?.label || id;

// How a scope reads inside a sentence ("shares ride record and standing"), from anyone's point of view.
const SCOPE_SHORT = {
  identity: 'identity and vehicle', activity: 'ride record', compliance: 'permit and standing', finances: 'monthly money totals',
  business_activity: 'fleet activity', business_finances: 'business wallet totals',
};
export const scopeShort = (id) => SCOPE_SHORT[id] || id;

export const formatIcan = (n) =>
  n === null || n === undefined || n === '' ? '—' : Number(n).toLocaleString(undefined, { maximumFractionDigits: 4 });

export const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export const fmtDateTime = (iso) =>
  iso ? new Date(iso).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

// The wallet's own wording is "Insufficient ICAN. Have: 0.45, Need: 2".
export function friendlyPayError(message) {
  const m = String(message || '').match(/Insufficient ICAN\. Have: ([\d.]+), Need: ([\d.]+)/i);
  if (!m) return message || 'Payment failed';
  return `Not enough IcanEra in the wallet: it has ${formatIcan(Number(m[1]))}, this needs ${formatIcan(Number(m[2]))}.`;
}

// "The database function isn't there": the insurance SQL has not been run for this project yet.
export const looksNotSetUp = (message) =>
  !!message && /could not find the function|schema cache|does not exist|PGRST202|42883|not switched on yet/i.test(message);

// Spreadsheet-safe CSV: quotes are doubled and a leading = + - @ is neutralised so a name cannot run as a formula.
const csvCell = (value) => {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};
export function toCsv(rows, columns) {
  const head = columns.map((c) => csvCell(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => csvCell(typeof c.value === 'function' ? c.value(r) : r[c.value])).join(','));
  return [head, ...body].join('\r\n');
}
export function downloadCsv(filename, csv) {
  const url = URL.createObjectURL(new Blob([String.fromCharCode(0xFEFF), csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Built-in readiness checklist (Global Navigator): what a salaried person (SE) or a business
// owner (BO) is generally expected to have in order in each country, and who to ask.
//
// This is guidance, not legal advice: requirements and thresholds change, so every item points
// at the authority to confirm with. A published Google Sheet can add or localise items
// (see googleLinks.rowsToRequirements); sheet items are merged after these.

export const COUNTRIES = ['Uganda', 'Kenya', 'Tanzania', 'Rwanda', 'Other'];

export const MODES = {
  SE: { label: 'Salaried employee', short: 'Salaried' },
  BO: { label: 'Business owner', short: 'Business owner' },
};

export const CATEGORY_LABELS = {
  identity: 'Identity',
  tax: 'Tax',
  social: 'Social security',
  legal: 'Legal & registration',
  health: 'Health cover',
  finance: 'Financial safety',
  other: 'Other',
};
export const CATEGORY_ORDER = ['identity', 'legal', 'tax', 'social', 'health', 'finance', 'other'];

const item = (key, category, title, authority, link, why, required = true) =>
  ({ key, category, title, authority, link, why, required, source: 'builtin' });

const EMERGENCY = (p) => item(`${p}-se-emergency`, 'finance', 'Build an emergency fund of 3 to 6 months of expenses', 'You', '',
  'Keeps one bad month from becoming a debt. Start small and automate it on payday.', false);
const PAYSLIPS = (p, who) => item(`${p}-se-payslips`, 'tax', 'Keep a year of payslips and tax records', who, '',
  'Proof of income for loans, visas and tax queries, and the way to spot a wrong deduction.', false);
const BANK = (p) => item(`${p}-bo-bank`, 'finance', 'Keep business money in a separate bank or mobile money account', 'Your bank', '',
  'Mixed money makes tax, loans and investor conversations painful. One clean account fixes most of it.');
const BOOKS = (p, who) => item(`${p}-bo-returns`, 'legal', 'Keep books and file your annual returns on time', who, '',
  'Late or missing returns bring penalties and can block licence renewals and tax clearance.');

const UG = {
  SE: [
    item('ug-se-nin', 'identity', 'Hold a valid National ID (NIN)', 'NIRA', 'https://www.nira.go.ug', 'Banks, SIM registration, tax and pension services all ask for it.'),
    item('ug-se-tin', 'tax', 'Register for a Taxpayer Identification Number (TIN)', 'URA', 'https://www.ura.go.ug', 'Your employer deducts PAYE against your TIN. You need it to file returns and prove your income.'),
    item('ug-se-nssf', 'social', 'Confirm your NSSF membership and contributions', 'NSSF Uganda', 'https://www.nssfug.org', 'Check that your employer is remitting your contributions and that your statement matches your payslips.'),
    PAYSLIPS('ug', 'URA / your employer'),
    item('ug-se-health', 'health', 'Have health insurance or a medical cover plan', 'Insurance Regulatory Authority', 'https://www.ira.go.ug', 'One hospital stay can erase a year of savings.', false),
    EMERGENCY('ug'),
  ],
  BO: [
    item('ug-bo-register', 'legal', 'Register your business', 'URSB', 'https://ursb.go.ug', 'A registered business can open accounts, sign contracts, win tenders and raise money.'),
    item('ug-bo-tin', 'tax', 'Get a business TIN', 'URA', 'https://www.ura.go.ug', 'Needed for tax filing, receipts, and almost every formal customer.'),
    item('ug-bo-licence', 'legal', 'Obtain a trading licence from your local authority', 'KCCA or your district', 'https://www.kcca.go.ug', 'Trading without a licence risks fines and closure.'),
    item('ug-bo-nssf', 'social', 'Register as an employer with NSSF', 'NSSF Uganda', 'https://www.nssfug.org', 'Required once you employ staff that meet the legal conditions.', false),
    item('ug-bo-vat', 'tax', 'Register for VAT when your turnover passes the legal threshold', 'URA', 'https://www.ura.go.ug', 'Check the current threshold with URA; registering late is costly.', false),
    BANK('ug'),
    BOOKS('ug', 'URSB and URA'),
    item('ug-bo-clearance', 'tax', 'Obtain a tax clearance certificate when you need one', 'URA', 'https://www.ura.go.ug', 'Often asked for by tenders, banks and licence renewals.', false),
  ],
};

const KE = {
  SE: [
    item('ke-se-id', 'identity', 'Hold a valid National ID', 'Immigration and Citizen Services', 'https://www.immigration.go.ke', 'The base document for KRA, banks, SHA and NSSF.'),
    item('ke-se-pin', 'tax', 'Register for a KRA PIN', 'KRA', 'https://www.kra.go.ke', 'Needed to file your annual return and for any formal financial service.'),
    item('ke-se-nssf', 'social', 'Confirm your NSSF membership and contributions', 'NSSF Kenya', 'https://www.nssf.go.ke', 'Check your employer is remitting and your statement matches your payslips.'),
    item('ke-se-sha', 'health', 'Register with the Social Health Authority (SHA)', 'SHA', 'https://sha.go.ke', 'Your statutory health cover. Keep your contributions up to date.'),
    PAYSLIPS('ke', 'KRA / your employer'),
    EMERGENCY('ke'),
  ],
  BO: [
    item('ke-bo-register', 'legal', 'Register your business', 'Business Registration Service (BRS)', 'https://brs.go.ke', 'A registered business can open accounts, sign contracts and raise money.'),
    item('ke-bo-pin', 'tax', 'Get a KRA PIN for the business', 'KRA', 'https://www.kra.go.ke', 'Needed for tax filing and formal customers.'),
    item('ke-bo-permit', 'legal', 'Obtain your county single business permit', 'Your county government', '', 'Operating without it risks fines and closure.'),
    item('ke-bo-nssf', 'social', 'Register as an employer with NSSF and SHA', 'NSSF Kenya / SHA', 'https://www.nssf.go.ke', 'Required once you employ staff.', false),
    item('ke-bo-vat', 'tax', 'Register for VAT when your turnover passes the legal threshold', 'KRA', 'https://www.kra.go.ke', 'Confirm the current threshold with KRA.', false),
    BANK('ke'),
    BOOKS('ke', 'BRS and KRA'),
  ],
};

const TZ = {
  SE: [
    item('tz-se-nida', 'identity', 'Hold a valid National ID (NIDA)', 'NIDA', 'https://www.nida.go.tz', 'The base document for TRA, banks and social security.'),
    item('tz-se-tin', 'tax', 'Register for a TIN', 'TRA', 'https://www.tra.go.tz', 'Needed to file returns and prove income.'),
    item('tz-se-nssf', 'social', 'Confirm your NSSF or PSSSF membership and contributions', 'NSSF / PSSSF', 'https://www.nssf.go.tz', 'Check your employer is remitting and your statement matches your payslips.'),
    item('tz-se-health', 'health', 'Have health insurance cover', 'NHIF', 'https://www.nhif.or.tz', 'Protects your savings from medical bills.', false),
    PAYSLIPS('tz', 'TRA / your employer'),
    EMERGENCY('tz'),
  ],
  BO: [
    item('tz-bo-register', 'legal', 'Register your business', 'BRELA', 'https://www.brela.go.tz', 'A registered business can open accounts, sign contracts and raise money.'),
    item('tz-bo-tin', 'tax', 'Get a business TIN', 'TRA', 'https://www.tra.go.tz', 'Needed for tax filing and formal customers.'),
    item('tz-bo-licence', 'legal', 'Obtain a business licence from your local authority', 'Local government authority', '', 'Operating without a licence risks fines and closure.'),
    item('tz-bo-nssf', 'social', 'Register as an employer with NSSF', 'NSSF', 'https://www.nssf.go.tz', 'Required once you employ staff.', false),
    item('tz-bo-vat', 'tax', 'Register for VAT when your turnover passes the legal threshold', 'TRA', 'https://www.tra.go.tz', 'Confirm the current threshold with TRA.', false),
    BANK('tz'),
    BOOKS('tz', 'BRELA and TRA'),
  ],
};

const RW = {
  SE: [
    item('rw-se-id', 'identity', 'Hold a valid National ID', 'NIDA Rwanda', 'https://www.nida.gov.rw', 'The base document for RRA, banks and social security.'),
    item('rw-se-tin', 'tax', 'Register for a TIN', 'RRA', 'https://www.rra.gov.rw', 'Needed to file returns and prove income.'),
    item('rw-se-rssb', 'social', 'Confirm your RSSB pension and contributions', 'RSSB', 'https://www.rssb.rw', 'Check your employer is remitting and your statement matches your payslips.'),
    item('rw-se-health', 'health', 'Have health insurance cover (CBHI or RAMA)', 'RSSB', 'https://www.rssb.rw', 'Protects your savings from medical bills.', false),
    PAYSLIPS('rw', 'RRA / your employer'),
    EMERGENCY('rw'),
  ],
  BO: [
    item('rw-bo-register', 'legal', 'Register your business', 'RDB', 'https://www.rdb.rw', 'A registered business can open accounts, sign contracts and raise money.'),
    item('rw-bo-tin', 'tax', 'Get a business TIN', 'RRA', 'https://www.rra.gov.rw', 'Needed for tax filing and formal customers.'),
    item('rw-bo-licence', 'legal', 'Obtain a trading licence from your district', 'Your district', '', 'Operating without a licence risks fines and closure.'),
    item('rw-bo-rssb', 'social', 'Register as an employer with RSSB', 'RSSB', 'https://www.rssb.rw', 'Required once you employ staff.', false),
    item('rw-bo-vat', 'tax', 'Register for VAT when your turnover passes the legal threshold', 'RRA', 'https://www.rra.gov.rw', 'Confirm the current threshold with RRA.', false),
    BANK('rw'),
    BOOKS('rw', 'RDB and RRA'),
  ],
};

const GENERIC = {
  SE: [
    item('xx-se-id', 'identity', 'Hold a valid national ID', 'Your national ID authority', '', 'The base document for tax, banking and social security.'),
    item('xx-se-tax', 'tax', 'Register for a taxpayer number', 'Your revenue authority', '', 'Needed to file returns and prove your income.'),
    item('xx-se-social', 'social', 'Confirm your social security membership', 'Your social security fund', '', 'Check contributions are being paid and match your payslips.'),
    PAYSLIPS('xx', 'Your employer'),
    EMERGENCY('xx'),
  ],
  BO: [
    item('xx-bo-register', 'legal', 'Register your business', 'Your business registry', '', 'A registered business can open accounts, sign contracts and raise money.'),
    item('xx-bo-tax', 'tax', 'Get a business taxpayer number', 'Your revenue authority', '', 'Needed for tax filing and formal customers.'),
    item('xx-bo-licence', 'legal', 'Obtain a trading licence', 'Your local authority', '', 'Operating without a licence risks fines and closure.'),
    BANK('xx'),
    BOOKS('xx', 'Your registry and revenue authority'),
  ],
};

const CATALOG = { Uganda: UG, Kenya: KE, Tanzania: TZ, Rwanda: RW, Other: GENERIC };

export const getBuiltInItems = (country, mode) =>
  (CATALOG[country] || GENERIC)[mode === 'BO' ? 'BO' : 'SE'].map((i) => ({ ...i }));

/** Built-in items first, then public-sheet items (a sheet can never overwrite a built-in key). */
export function mergeItems(builtIn, sheetItems = []) {
  const keys = new Set(builtIn.map((i) => i.key));
  return [...builtIn, ...sheetItems.filter((i) => !keys.has(i.key))];
}

export const groupByCategory = (items) =>
  CATEGORY_ORDER
    .map((category) => ({ category, label: CATEGORY_LABELS[category], items: items.filter((i) => (CATEGORY_LABELS[i.category] ? i.category : 'other') === category) }))
    .filter((g) => g.items.length);

/**
 * Compliance percentage. Required items count double, optional ones once.
 * `progress` maps item key -> status ('todo' | 'in_progress' | 'done').
 */
export function computeCompliance(items, progress = {}) {
  let earned = 0;
  let total = 0;
  let done = 0;
  for (const i of items) {
    const weight = i.required ? 2 : 1;
    total += weight;
    const status = progress[i.key] || 'todo';
    if (status === 'done') { earned += weight; done += 1; } else if (status === 'in_progress') earned += weight * 0.4;
  }
  return { percent: total ? Math.round((earned / total) * 100) : 0, done, total: items.length, requiredLeft: items.filter((i) => i.required && progress[i.key] !== 'done').length };
}

/** The legacy shape the dashboards store as `complianceData`. */
export const toComplianceData = (items, progress) => ({
  compliancePercentage: computeCompliance(items, progress).percent,
  checklist: items.map((i) => ({ item: i.title, status: progress[i.key] === 'done' ? 'completed' : 'pending', required: i.required })),
});

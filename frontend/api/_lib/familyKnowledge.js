import { TOPICS as COMPANY_TOPICS } from './knowledge/company.js';
import { TOPICS as ICANERA_MONEY_TOPICS } from './knowledge/icanera-money.js';
import { TOPICS as ICANERA_BUSINESS_TOPICS } from './knowledge/icanera-business.js';
import { TOPICS as SUPERMARTKERA_TOPICS } from './knowledge/supermartkera.js';
import { TOPICS as BODAGOERA_TOPICS } from './knowledge/bodagoera.js';
import { TOPICS as AGRIBONE_TOPICS } from './knowledge/agribone.js';

/**
 * What the GODMINDERA ORGANISATION (U) LTD "Ask us" assistant knows about the IcanEra family of apps.
 *
 * Plain data, curated from the apps' own code and copy (each claim has to be something a customer could verify in the app).
 * The machinery that uses it is familySupport.js. Rules for editing this file:
 *   - APPS / LINKS: addresses are checked by tests/familySupport.test.js (https only, no duplicates). The assistant can only
 *     ever send a visitor to a LINKS address; it names a link by id and the server fills in the URL.
 *   - TOPICS (one file per area under knowledge/): `answer` is what a customer should be told (short, customer-ready: it is also the rule-based fallback's reply when
 *     no AI key is set); `facts` is optional extra detail for the AI only. Never put a PIN, password, key or placeholder
 *     contact detail here. If you are not sure something is true, leave it out: the assistant then hands the question to the team.
 *   - `keywords` are lower-case; a keyword with a space is a phrase. Avoid words shorter than 3 characters.
 *   - `core: true` topics are always shown to the model (the essentials of each app).
 *   - `links` are ids from LINKS; `handoff: true` means the fallback also offers the team; `followUps` are tappable next questions.
 *   - Do not write numbers that the platform can change (the BodaGoEra platform charge is read live). Fees that are fixed in the
 *     database (the 3% cash-out / selling fee) were checked against the live database.
 */

/** The GODMINDERA site's business-site address (icanera.space/<this>), guaranteed by the site-address migration. */
export const PLATFORM_SLUG = 'godmindera-organisation-u-ltd';

export const APPS = [
  {
    id: 'icanera',
    name: 'IcanEra',
    names: ['icanera', 'ican era', 'icaneracoin', 'ican wallet', 'icec'],
    url: 'https://icanera.space',
    summary: 'The main platform: the IcanEra wallet and coin, business tools (staff, payroll, inventory, reports), business websites, Pitchin for investors, and more.',
  },
  {
    id: 'supermartkera',
    name: 'SupermartKera',
    names: ['supermartkera', 'supermart kera', 'supermart', 'supermarket'],
    url: 'https://supermartkera.icanera.space',
    summary: 'Shopping and retail: discover stores, shop products and run supermarket operations.',
  },
  {
    id: 'bodagoera',
    name: 'BodaGoEra',
    names: ['bodagoera', 'boda go era', 'bodago', 'boda boda', 'boda'],
    url: 'https://bodagoera.icanera.space',
    summary: 'Transport and delivery: everyday rides and deliveries, and end-to-end journeys by road, air and sea.',
  },
  {
    id: 'agribone',
    name: 'AgriBone',
    names: ['agribone', 'agri bone', 'agri-tech', 'agritech', 'farm', 'farmer'],
    url: null, // production address not confirmed yet: it is added here once it is, never guessed
    summary: 'Agriculture: a platform for Ugandan farmers, with farmers, suppliers and farm specialists working together.',
  },
];

/**
 * The only pages the assistant may link to. Keys are what the model writes; values are what the visitor gets.
 * (An app with no confirmed address has no entry.)
 */
export const LINKS = {
  icanera: { label: 'Open IcanEra', url: 'https://icanera.space' },
  coin: { label: 'IcanEra coin price', url: 'https://icanera.space/icaneracoin' },
  'coin-learn': { label: 'Learn about the coin', url: 'https://icanera.space/icaneracoin/learn' },
  'coin-stable': { label: 'ICEC-S stable coin', url: 'https://icanera.space/icaneracoin/stable' },
  'reset-pin': { label: 'Reset my PIN', url: 'https://icanera.space/reset-pin' },
  plans: { label: 'My instalment plans', url: 'https://icanera.space/plans' },
  developers: { label: 'Developer portal', url: 'https://icanera.space/developers' },
  shop: { label: 'IcanEra shop', url: 'https://icanera.space/shop' },
  supermartkera: { label: 'Open SupermartKera', url: 'https://supermartkera.icanera.space' },
  bodagoera: { label: 'Open BodaGoEra', url: 'https://bodagoera.icanera.space' },
};

/** Curated answers per question area, from the apps' own code and copy (see knowledge/). */
export const TOPICS = [
  ...COMPANY_TOPICS,
  ...ICANERA_MONEY_TOPICS,
  ...ICANERA_BUSINESS_TOPICS,
  ...SUPERMARTKERA_TOPICS,
  ...BODAGOERA_TOPICS,
  ...AGRIBONE_TOPICS,
];

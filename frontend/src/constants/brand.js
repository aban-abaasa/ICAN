import { buildBusinessSiteUrl } from '../utils/businessSiteUrl.js';

// Legal owner of the IcanEra product. Used in footers, splash screen and documents.
export const PRODUCT_OWNER = 'GODMINDERA ORGANISATION (U) LTD';
export const PRODUCT_OF = `A product of ${PRODUCT_OWNER}`;

// The owner is a business on IcanEra like any other, so its website has the same address format: icanera.space/<business-name>.
// (Its address is guaranteed by the site-address migration: the platform fee business is always first in line for the plain name.)
export const PRODUCT_OWNER_SLUG = 'godmindera-organisation-u-ltd';
export const PRODUCT_OWNER_URL = buildBusinessSiteUrl({ slug: PRODUCT_OWNER_SLUG });

// The same credit for places that build HTML by hand (emails, printable pages): the company name is a link to its website.
export const PRODUCT_OF_HTML = `A product of <a href="${PRODUCT_OWNER_URL}" style="color:inherit">${PRODUCT_OWNER}</a>`;

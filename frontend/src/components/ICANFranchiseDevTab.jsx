import React from 'react';
import FranchiseAdminPanel from './franchise/FranchiseAdminPanel';

/**
 * Franchise tab of the ICAN developer panel: requests from the landing page, partners and
 * company verification, countries and the rate card, payouts and health. See
 * supabase/migrations/20261004100000_franchise_layer.sql and FRANCHISE_LAYER_DEPLOY.md.
 * Unlike the other tabs it does not use the panel's dev token: it needs a real admin account.
 */
export default function ICANFranchiseDevTab() {
  return <FranchiseAdminPanel />;
}

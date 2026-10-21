import { useEffect, useState } from 'react';
import { fetchSiteSlug, getCachedSiteSlug, rememberSiteSlug, subscribeToSiteSlugs } from '../services/businessSiteLinkService';

/**
 * The icanera.space/<address> of a business, or null until it is known (callers then fall back to the always-valid /notices/<id>
 * link through buildBusinessSiteLink). Pass `knownSlug` when the row in hand already carries it (cmms_company_profiles.site_slug).
 * Also keeps the shared cache warm, so click handlers that call buildBusinessSiteLink(companyId) find the address.
 */
export default function useBusinessSiteSlug(companyId, knownSlug = null) {
  const [slug, setSlug] = useState(() => knownSlug || getCachedSiteSlug(companyId));

  useEffect(() => {
    if (knownSlug) rememberSiteSlug(companyId, knownSlug);
    setSlug(knownSlug || getCachedSiteSlug(companyId));
    if (!companyId) return undefined;

    let cancelled = false;
    const refresh = () => { if (!cancelled) setSlug(getCachedSiteSlug(companyId) || knownSlug || null); };
    const unsubscribe = subscribeToSiteSlugs(refresh);
    if (!knownSlug && !getCachedSiteSlug(companyId)) fetchSiteSlug(companyId).then(refresh);
    return () => { cancelled = true; unsubscribe(); };
  }, [companyId, knownSlug]);

  return slug;
}

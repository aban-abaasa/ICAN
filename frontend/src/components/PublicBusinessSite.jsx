import React, { Suspense, lazy, useEffect, useState } from 'react';
import { AuthProvider } from '../context/AuthContext';
import { ClassicLoadingScreen } from './SplashScreen';
import { resolveSiteSlug } from '../services/businessSiteLinkService';

// The notice board is a big bundle: only fetched once an address is known to belong to a business.
const PublicCompanyNoticeBoard = lazy(() => import('./PublicCompanyNoticeBoard'));

/**
 * icanera.space/<business-name> -- a business's public website.
 *
 * Looks the address up (public.fn_resolve_public_site_slug) and opens that business's site, the same page /notices/<company-id> has
 * always shown. An address that was retired still opens the business (the board then moves the address bar to the current one). A
 * path that is not a business address at all (a typo, or a page this app does not have) goes on to `renderFallback`, so every other
 * URL behaves exactly as it did before addresses existed.
 *
 * Rendered by main.jsx outside ThemeProvider, with AuthProvider only, like the /notices/<id> board it wraps: a visitor may sign in
 * in place, and the page brings its own palette.
 */
export default function PublicBusinessSite({ slug, renderFallback }) {
  const [state, setState] = useState({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    resolveSiteSlug(slug)
      .then((site) => { if (!cancelled) setState(site ? { status: 'found', ...site } : { status: 'missing' }); })
      .catch(() => { if (!cancelled) setState({ status: 'missing' }); }); // lookup unavailable (e.g. migration not applied): behave like any other URL
    return () => { cancelled = true; };
  }, [slug]);

  if (state.status === 'loading') return <ClassicLoadingScreen />;
  if (state.status === 'missing') return renderFallback();
  return (
    <AuthProvider>
      <Suspense fallback={<ClassicLoadingScreen />}>
        <PublicCompanyNoticeBoard companyId={state.companyId} slug={state.slug} />
      </Suspense>
    </AuthProvider>
  );
}

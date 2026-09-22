import React, { useEffect, useMemo, useState } from 'react';
import {
  Megaphone, Briefcase, MapPin, Calendar, Users, FileText, X, Loader,
  AlertCircle, CheckCircle2, Search, Building2, ArrowLeft, Upload, Share2,
  Check, ChevronRight, Clock, ShoppingBag, ShoppingCart, Plus, Minus,
  Trash2, Truck, Store, Award, Phone, Mail, Navigation, MessageCircle,
  Facebook, Instagram, Twitter, Linkedin, Music2, BadgeCheck, Globe,
  Video, Play, Eye, Heart
} from 'lucide-react';
import { supabase } from '../lib/supabase/client';
import cmmsAnnouncementsService from '../services/cmmsAnnouncementsService';
import cmmsBusinessOpportunitiesService from '../services/cmmsBusinessOpportunitiesService';
import { getDropshipStorefront, dropshipCheckout } from '../services/dropshipService';
import { getPitchesByBusinessProfileId } from '../services/pitchingService';
import { useAuth } from '../context/AuthContext';
import { AuthPage } from './auth';

const formatUGX = (amount) => `UGX ${Number(amount || 0).toLocaleString('en-UG', { maximumFractionDigits: 0 })}`;

// Contact-bar link builders -- every one degrades to `null` (and is simply
// not rendered) when the business hasn't filled that field in, rather than
// ever producing a dead/blank link.
const buildTelLink = (phone) => (phone?.trim() ? `tel:${phone.replace(/[^\d+]/g, '')}` : null);
const buildMailLink = (email) => (email?.trim() ? `mailto:${email.trim()}` : null);
const buildWhatsAppLink = (whatsapp) => {
  const digits = whatsapp?.replace(/[^\d]/g, '');
  return digits ? `https://wa.me/${digits}` : null;
};
const buildDirectionsLink = (location, companyName) => {
  const query = [companyName, location].filter(Boolean).join(', ');
  return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : null;
};
// Businesses type their website as "example.com" as often as
// "https://example.com" -- a bare domain as an <a href> just reloads the
// current page instead of navigating out, so this normalizes it once here
// rather than trusting every admin to type the scheme.
const normalizeExternalUrl = (url) => {
  const trimmed = url?.trim();
  if (!trimmed) return null;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
};

const SOCIAL_LINKS = [
  { key: 'facebook_url', label: 'Facebook', icon: Facebook },
  { key: 'instagram_url', label: 'Instagram', icon: Instagram },
  { key: 'twitter_url', label: 'X (Twitter)', icon: Twitter },
  { key: 'linkedin_url', label: 'LinkedIn', icon: Linkedin },
  { key: 'tiktok_url', label: 'TikTok', icon: Music2 },
];

// Sets this specific business's title/meta/canonical/Open Graph tags and a
// schema.org LocalBusiness JSON-LD block on the shared <head> -- the page
// (index.html) ships generic "IcanEra" tags for the whole SPA, so without
// this every business's page would look identical to Google/AI crawlers
// that execute JS. (The initial HTML payload for crawlers that DON'T
// execute JS -- most link-unfurlers and several AI crawlers -- is instead
// patched server-side per business by api/share-preview.js; this effect is
// the client-side half of the same "let this business actually be found"
// goal, and keeps the tab title correct for a human visitor too.)
const useBusinessSeo = (company, companyId) => {
  useEffect(() => {
    if (!company) return;
    const previousTitle = document.title;
    const siteName = 'IcanEra';
    const title = company.tagline
      ? `${company.company_name} — ${company.tagline} | ${siteName}`
      : `${company.company_name}${company.industry ? ` — ${company.industry}` : ''} | ${siteName}`;
    document.title = title;

    const canonicalUrl = `${window.location.origin}/notices/${companyId}`;
    const description = (
      company.about?.trim()
      || company.tagline?.trim()
      || `${company.company_name} on IcanEra — announcements, careers, products and contact details.`
    ).slice(0, 300);
    const image = company.cover_image_url || company.logo_url || `${window.location.origin}/icons/icon-512x512.png`;

    const createdNodes = [];
    const upsertMeta = (selector, build) => {
      let el = document.head.querySelector(selector);
      if (!el) {
        el = build();
        document.head.appendChild(el);
        createdNodes.push(el);
      }
      return el;
    };

    upsertMeta('meta[name="description"]', () => {
      const el = document.createElement('meta');
      el.setAttribute('name', 'description');
      return el;
    }).setAttribute('content', description);

    upsertMeta('link[rel="canonical"]', () => {
      const el = document.createElement('link');
      el.setAttribute('rel', 'canonical');
      return el;
    }).setAttribute('href', canonicalUrl);

    const ogTags = {
      'og:type': 'business.business',
      'og:site_name': siteName,
      'og:url': canonicalUrl,
      'og:title': title,
      'og:description': description,
      'og:image': image,
      'twitter:card': 'summary_large_image',
      'twitter:title': title,
      'twitter:description': description,
      'twitter:image': image,
    };
    Object.entries(ogTags).forEach(([property, content]) => {
      const isTwitter = property.startsWith('twitter:');
      const attr = isTwitter ? 'name' : 'property';
      upsertMeta(`meta[${attr}="${property}"]`, () => {
        const el = document.createElement('meta');
        el.setAttribute(attr, property);
        return el;
      }).setAttribute('content', content);
    });

    // Structured data -- this is what lets Google show a real business
    // card (and lets AI answer engines cite real facts: name, phone,
    // address, socials) instead of treating the page as an anonymous blob
    // of text.
    const sameAs = [company.website, ...SOCIAL_LINKS.map((s) => company[s.key])]
      .map(normalizeExternalUrl)
      .filter(Boolean);
    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'LocalBusiness',
      name: company.company_name,
      description,
      image,
      url: canonicalUrl,
      ...(company.logo_url && { logo: company.logo_url }),
      ...(company.phone && { telephone: company.phone }),
      ...(company.email && { email: company.email }),
      ...(company.location && { address: { '@type': 'PostalAddress', addressLocality: company.location } }),
      ...(company.hours_text && { openingHours: company.hours_text }),
      ...(company.industry && { knowsAbout: company.industry }),
      ...(sameAs.length > 0 && { sameAs }),
    };
    let script = document.getElementById('icanera-business-ld-json');
    let createdScript = false;
    if (!script) {
      script = document.createElement('script');
      script.type = 'application/ld+json';
      script.id = 'icanera-business-ld-json';
      document.head.appendChild(script);
      createdScript = true;
    }
    script.textContent = JSON.stringify(jsonLd);

    return () => {
      document.title = previousTitle;
      createdNodes.forEach((node) => node.remove());
      if (createdScript) script.remove();
    };
  }, [company, companyId]);
};

const EMPLOYMENT_LABELS = {
  full_time: 'Full-time',
  part_time: 'Part-time',
  contract: 'Contract',
  internship: 'Internship',
  temporary: 'Temporary',
  volunteer: 'Volunteer',
};

// Status chips read off the "how far along" scale rather than fixed colors
// per status, so the palette stays inside the green/maroon/neutral brand
// instead of the old ad-hoc slate/amber/blue/violet/red mix.
const PENDING_APPLICATION_LINK_KEY = 'ican_notice_board_pending_application_link';
// Which tab to restore after a full-page redirect round-trip (Google
// sign-in) -- section is plain component state, not reflected in the URL
// like ?post=<id> is, so it would otherwise silently reset to "Notices".
const PENDING_SECTION_KEY = 'ican_notice_board_pending_section';

const STATUS_STYLES = {
  submitted: 'nb-chip-neutral',
  under_review: 'nb-chip-amber',
  shortlisted: 'nb-chip-teal',
  written_test: 'nb-chip-amber',
  interview: 'nb-chip-green',
  hired: 'nb-chip-green-solid',
  rejected: 'nb-chip-maroon',
  withdrawn: 'nb-chip-neutral nb-chip-faded',
};

// Scoped CSS variables (light by default, swapped under prefers-color-scheme)
// so this page renders identically whether an applicant's device is in light
// or dark mode -- and, crucially, so it never gets caught by the app-wide
// dynamic theme override in ThemeContext.jsx, which repaints any element
// using stock Tailwind slate/indigo/violet classes. None of the classnames
// below are stock Tailwind color utilities, so that override can't touch
// them; this file owns its own light/dark palette instead.
const NB_STYLES = `
.icanera-nb {
  --nb-bg: #f6f9f7;
  --nb-surface: #ffffff;
  --nb-surface-alt: #eef3f0;
  --nb-surface-alt-hover: #e2ebe4;
  --nb-text: #16211b;
  --nb-text-muted: #56675d;
  --nb-text-faint: #8a9a90;
  --nb-border: #dbe6de;
  --nb-border-strong: #c3d3c8;
  --nb-green: #166534;
  --nb-green-hover: #114f28;
  --nb-green-soft-bg: #e3f3e8;
  --nb-green-soft-text: #166534;
  --nb-green-solid-text: #ffffff;
  --nb-teal-soft-bg: #e1f2ef;
  --nb-teal-soft-text: #0f5c52;
  --nb-maroon: #7a1f2b;
  --nb-maroon-hover: #5f1721;
  --nb-maroon-soft-bg: #f5e6e7;
  --nb-maroon-soft-text: #7a1f2b;
  --nb-amber-soft-bg: #faf1da;
  --nb-amber-soft-text: #8a5a12;
  --nb-backdrop: rgba(15, 23, 18, 0.55);
}
@media (prefers-color-scheme: dark) {
  .icanera-nb {
    --nb-bg: #0f1613;
    --nb-surface: #17211c;
    --nb-surface-alt: #202b24;
    --nb-surface-alt-hover: #2a362e;
    --nb-text: #eef4f0;
    --nb-text-muted: #a9baaf;
    --nb-text-faint: #7c8d82;
    --nb-border: #2b3830;
    --nb-border-strong: #3a4a40;
    --nb-green: #4ade80;
    --nb-green-hover: #22c55e;
    --nb-green-soft-bg: #163524;
    --nb-green-soft-text: #86efac;
    --nb-green-solid-text: #0f1613;
    --nb-teal-soft-bg: #123330;
    --nb-teal-soft-text: #7dd3c0;
    --nb-maroon: #e5828d;
    --nb-maroon-hover: #f0a1a9;
    --nb-maroon-soft-bg: #3a1a1e;
    --nb-maroon-soft-text: #f3a9b0;
    --nb-amber-soft-bg: #3a2f13;
    --nb-amber-soft-text: #f4c86a;
    --nb-backdrop: rgba(0, 0, 0, 0.65);
  }
}
.icanera-nb { background: var(--nb-bg); color: var(--nb-text); }
.nb-surface { background: var(--nb-surface); }
.nb-surface-alt { background: var(--nb-surface-alt); }
.nb-text { color: var(--nb-text); }
.nb-text-muted { color: var(--nb-text-muted); }
.nb-text-faint { color: var(--nb-text-faint); }
.nb-border { border-color: var(--nb-border); }
.nb-border-strong { border-color: var(--nb-border-strong); }
.nb-header { background: color-mix(in srgb, var(--nb-surface) 92%, transparent); border-color: var(--nb-border); }
.nb-header-elevated { box-shadow: 0 2px 12px rgba(15, 23, 18, 0.08); }
/* Fades the tab row's trailing edge where it overflows into horizontal
   scroll on mobile -- a plain hard-cropped edge reads as "the page is
   broken", a soft fade reads as "there's more, swipe" the same way iOS
   scroll views and app tab bars signal overflow. Only the trailing edge
   fades (the leading edge is always real, visible content at rest). */
.nb-tab-nav { -webkit-mask-image: linear-gradient(90deg, #000 0, #000 calc(100% - 24px), transparent 100%); mask-image: linear-gradient(90deg, #000 0, #000 calc(100% - 24px), transparent 100%); }
.nb-card { background: var(--nb-surface); border: 1px solid var(--nb-border); }
.nb-card:hover { border-color: var(--nb-green); }
.nb-tab { color: var(--nb-text-muted); border-color: transparent; }
.nb-tab:hover { color: var(--nb-text); }
.nb-tab-active { color: var(--nb-green); border-color: var(--nb-green); }
.nb-icon-box { background: var(--nb-surface-alt); }
.nb-icon-muted { color: var(--nb-text-faint); }
.nb-btn-primary { background: var(--nb-green); color: #ffffff; }
.nb-btn-primary:hover { background: var(--nb-green-hover); }
.nb-btn-secondary { background: var(--nb-surface-alt); color: var(--nb-text); }
.nb-btn-secondary:hover { background: var(--nb-surface-alt-hover); }
.nb-link { color: var(--nb-green); }
.nb-link:hover { color: var(--nb-green-hover); }
.nb-input { background: var(--nb-surface); color: var(--nb-text); border: 1px solid var(--nb-border-strong); }
.nb-input::placeholder { color: var(--nb-text-faint); }
.nb-input:focus { outline: none; border-color: var(--nb-green); box-shadow: 0 0 0 4px var(--nb-green-soft-bg); }
.nb-modal-backdrop { background: var(--nb-backdrop); }
.nb-chip-neutral { background: var(--nb-surface-alt); color: var(--nb-text-muted); }
.nb-chip-faded { opacity: 0.75; }
.nb-chip-green { background: var(--nb-green-soft-bg); color: var(--nb-green-soft-text); }
.nb-chip-green-solid { background: var(--nb-green); color: var(--nb-green-solid-text); }
.nb-chip-teal { background: var(--nb-teal-soft-bg); color: var(--nb-teal-soft-text); }
.nb-chip-maroon { background: var(--nb-maroon-soft-bg); color: var(--nb-maroon-soft-text); }
.nb-chip-amber { background: var(--nb-amber-soft-bg); color: var(--nb-amber-soft-text); }
.nb-accent-top { background: linear-gradient(90deg, var(--nb-green), var(--nb-maroon)); }
.nb-wordmark-a { color: var(--nb-text-muted); }
.nb-wordmark-b { color: var(--nb-green); }
.nb-copied { background: var(--nb-green-soft-bg); color: var(--nb-green-soft-text); }
.nb-share-btn { background: var(--nb-surface-alt); color: var(--nb-text-muted); }
.nb-share-btn:hover { background: var(--nb-surface-alt-hover); }
.nb-closed-banner { background: var(--nb-amber-soft-bg); color: var(--nb-amber-soft-text); }
.nb-error-text { color: var(--nb-maroon); }
.nb-empty-icon { background: var(--nb-surface-alt); color: var(--nb-text-faint); }
.nb-badge-count { background: var(--nb-maroon); color: #ffffff; }
.nb-qty-pill { background: var(--nb-surface-alt); }
.nb-price { color: var(--nb-green); }
.nb-out-of-stock { color: var(--nb-maroon); }
.nb-hero-cover { background: linear-gradient(135deg, var(--nb-green) 0%, var(--nb-maroon) 100%); }
.nb-hero-overlay { background: linear-gradient(180deg, rgba(0,0,0,0) 30%, rgba(0,0,0,0.62) 100%); }
/* Fixed white ring (not theme-linked) so the logo always pops off both the
   cover photo behind it and the page background beneath it, in light or
   dark mode -- the same "always-white" avatar ring real business/creator
   pages (Facebook Pages, Instagram) use regardless of the page's own theme.
   A faint dark contour (the first box-shadow layer) keeps that white ring
   readable even against a light/cream cover photo, where a pure white ring
   on a pure white-ish background would otherwise nearly disappear.
   Kept background-free on purpose -- see nb-hero-avatar-photo below for why
   the white fill isn't part of this class. */
.nb-hero-avatar { border: 4px solid #ffffff; box-shadow: 0 0 0 1px rgba(0,0,0,0.08), 0 6px 20px rgba(0,0,0,0.32); }
/* The white "matte" behind an actual logo image (so a transparent-background
   PNG logo doesn't show the cover photo through it) -- applied ONLY to the
   <img>, never to the letter-fallback div, which needs to keep its own
   nb-btn-primary brand-green fill. Both used to share one .nb-hero-avatar
   class with background:#ffffff baked in, which silently painted the
   fallback's white initial onto a white square (invisible) whenever a
   business had no logo set. */
.nb-hero-avatar-photo { background: #ffffff; }
.nb-verified-mark { background: #ffffff; color: var(--nb-green); border: 2px solid #ffffff; box-shadow: 0 0 0 1px rgba(0,0,0,0.08), 0 1px 6px rgba(0,0,0,0.25); }
.nb-action-btn { background: var(--nb-surface); color: var(--nb-text); border: 1px solid var(--nb-border-strong); }
.nb-action-btn:hover { border-color: var(--nb-green); color: var(--nb-green); }
.nb-social-btn { background: var(--nb-surface-alt); color: var(--nb-text-muted); }
.nb-social-btn:hover { background: var(--nb-green-soft-bg); color: var(--nb-green-soft-text); }
.nb-verified-badge { background: var(--nb-green-soft-bg); color: var(--nb-green-soft-text); }
.nb-strip { background: var(--nb-surface); border-bottom: 1px solid var(--nb-border); }
.nb-info-row:hover { background: var(--nb-surface-alt); }
`;

/**
 * The company's public notice board -- no ICAN account required. Rendered
 * from main.jsx for /notices/:companyId, same "share link needs no login"
 * pattern as PublicPitchViewer/PublicDropshipStorefront. It uses its own
 * scoped light/dark palette (see NB_STYLES above, keyed to the visitor's OS
 * color scheme) rather than the app's ThemeContext -- a careers/notice board
 * needs to read as a trustworthy business page in whatever mode the visitor
 * already has set, not swap between ICAN's in-app theme choices. Job
 * applications are submitted here directly (not gated behind a sign-in
 * prompt) since the whole point is that applicants never need an account.
 */
const PublicCompanyNoticeBoard = ({ companyId }) => {
  const { user, loading: authLoading } = useAuth();

  // Set from ApplyForm's / TrackApplication's post-submit "create a free
  // account" recommendation -- { referenceCode, contact, prefill } while
  // pending, or { done: true, message } once linking finishes, so we can
  // show a plain confirmation before returning to the board.
  const [accountPrompt, setAccountPrompt] = useState(null);

  // Google sign-up is a full-page redirect away and back (see
  // AuthContext.signInWithGoogle) -- any in-memory accountPrompt state is
  // gone by the time the visitor returns, so the pending link survives in
  // sessionStorage instead. The email/password path (no redirect) also goes
  // through this same key, so both paths funnel through one place.
  // payload.type distinguishes which reference code this is -- 'job' (the
  // default, for backward compat with callers that don't pass one) or
  // 'bid', so the link-up below calls the matching RPC.
  const requestAccountCreation = (payload) => {
    try {
      sessionStorage.setItem(PENDING_APPLICATION_LINK_KEY, JSON.stringify({ type: payload.type || 'job', referenceCode: payload.referenceCode, contact: payload.contact }));
    } catch { /* sessionStorage unavailable (e.g. private browsing) -- link falls back to fn_get_my_job_applications'/fn_get_my_opportunity_bids' self-healing match on the matching "Track" tab instead */ }
    setAccountPrompt(payload);
  };

  // Fires once the visitor is actually signed in -- whether that happened
  // instantly (email/password, no confirmation required) or after a full
  // redirect round-trip to Google and back to this exact page.
  useEffect(() => {
    if (!user) return;
    let pending = null;
    try { pending = JSON.parse(sessionStorage.getItem(PENDING_APPLICATION_LINK_KEY) || 'null'); } catch { /* ignore */ }
    if (!pending) return;
    try { sessionStorage.removeItem(PENDING_APPLICATION_LINK_KEY); } catch { /* ignore */ }
    const isBid = pending.type === 'bid';
    const linkFn = isBid ? cmmsBusinessOpportunitiesService.linkIcanAccountToOpportunityBid : cmmsAnnouncementsService.linkIcanAccountToApplication;
    const trackTabLabel = isBid ? 'Track my bid' : 'Track my application';
    linkFn(pending.referenceCode, pending.contact).then((linkResult) => {
      setAccountPrompt({
        done: true,
        message: linkResult.success && linkResult.linked
          ? `Your account is linked. You can check this ${isBid ? 'bid' : 'application'} anytime from "${trackTabLabel}" while signed in -- no code needed.`
          : `Your account is ready. Open "${trackTabLabel}" while signed in and it'll match this ${isBid ? 'bid' : 'application'} automatically.`,
      });
    });
  }, [user]);

  const [company, setCompany] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState(() => {
    try {
      const pending = sessionStorage.getItem(PENDING_SECTION_KEY);
      if (pending) { sessionStorage.removeItem(PENDING_SECTION_KEY); return pending; }
    } catch { /* ignore */ }
    return 'notices';
  });
  const [notices, setNotices] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [opportunities, setOpportunities] = useState([]);
  const [selectedJob, setSelectedJob] = useState(null);
  const [selectedNotice, setSelectedNotice] = useState(null);
  const [selectedOpportunity, setSelectedOpportunity] = useState(null);

  // The company's Dropship storefront, when it has linked one (see "Board
  // profile" in CMMSAnnouncementsPanel.jsx / fn_set_cmms_company_business_
  // profile). Loaded separately from notices/jobs since it depends on
  // company.business_profile_id, only known once the header result lands.
  const [products, setProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [cart, setCart] = useState({}); // { [listing_id]: quantity }

  // Same "linked business_profile" as Products & Services above, just
  // surfacing that business's Pitchin videos instead of its storefront --
  // a visitor who lands on the board from a shared pitch, or vice versa,
  // should be able to find the rest of what this business has put up in
  // either place.
  const [pitches, setPitches] = useState([]);
  const [pitchesLoading, setPitchesLoading] = useState(false);

  // Drives two scroll-linked header touches: `scrolled` lifts the sticky
  // header off the page with a faint shadow once there's actually content
  // behind it (rather than always/never), and `heroPassed` is what fixes the
  // "two logos on screen at once" bug -- on the Notices tab BusinessHero's
  // big avatar already covers the identity, so the header's compact
  // logo+name only fades in once that hero has scrolled out of view (the
  // "small brand anchor while scrolling" the comment below always intended,
  // just never actually wired to scroll position before).
  const [scrollState, setScrollState] = useState({ scrolled: false, heroPassed: false });
  useEffect(() => {
    const HERO_PASSED_Y = 220; // just past BusinessHero's cover + avatar overlap
    const onScroll = () => {
      const y = window.scrollY;
      setScrollState((prev) => (prev.scrolled === y > 4 && prev.heroPassed === y > HERO_PASSED_Y)
        ? prev
        : { scrolled: y > 4, heroPassed: y > HERO_PASSED_Y });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const [headerResult, noticesResult, jobsResult, opportunitiesResult] = await Promise.all([
        cmmsAnnouncementsService.getPublicCompanyHeader(companyId),
        cmmsAnnouncementsService.getPublicNotices(companyId, 'announcement'),
        cmmsAnnouncementsService.getPublicNotices(companyId, 'job'),
        cmmsBusinessOpportunitiesService.getPublicCompanyOpportunities(companyId),
      ]);
      if (cancelled) return;
      if (!headerResult.success || !headerResult.data) {
        setNotFound(true);
      } else {
        setCompany(headerResult.data);
        setNotices(noticesResult.data || []);
        setJobs(jobsResult.data || []);
        setOpportunities(opportunitiesResult.data || []);
      }
      setLoading(false);
    };
    if (companyId) load();
    return () => { cancelled = true; };
  }, [companyId]);

  useBusinessSeo(company, companyId);

  useEffect(() => {
    let cancelled = false;
    if (!company?.business_profile_id) { setProducts([]); return; }
    setProductsLoading(true);
    getDropshipStorefront(company.business_profile_id).then(({ data }) => {
      if (cancelled) return;
      setProducts(data || []);
      setProductsLoading(false);
    });
    return () => { cancelled = true; };
  }, [company?.business_profile_id]);

  useEffect(() => {
    let cancelled = false;
    if (!company?.business_profile_id) { setPitches([]); return; }
    setPitchesLoading(true);
    getPitchesByBusinessProfileId(company.business_profile_id).then((data) => {
      if (cancelled) return;
      setPitches(data || []);
      setPitchesLoading(false);
    });
    return () => { cancelled = true; };
  }, [company?.business_profile_id]);

  // A shared post link (?post=<id>) should open straight to that specific
  // announcement/job, not just the board's front page -- the whole point
  // of "Share" below is that the recipient lands exactly where the sharer
  // was looking, the same way a shared Pitchin link opens that one video.
  useEffect(() => {
    if (loading || notFound) return;
    const params = new URLSearchParams(window.location.search);
    const postId = params.get('post');
    const opportunityId = params.get('opp');
    if (postId) {
      cmmsAnnouncementsService.getPublicNotice(postId).then((result) => {
        if (!result.success || !result.data) return;
        if (result.data.post_type === 'job') {
          setSection('careers');
          setSelectedJob(result.data);
        } else {
          setSection('notices');
          setSelectedNotice(result.data);
        }
      });
    } else if (opportunityId) {
      cmmsBusinessOpportunitiesService.getPublicOpportunity(opportunityId).then((result) => {
        if (!result.success || !result.data) return;
        setSection('opportunities');
        setSelectedOpportunity(result.data);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, notFound]);

  const goToApp = () => {
    window.history.replaceState({}, '', '/');
    window.location.href = '/';
  };

  // The list RPC (fn_get_public_cmms_notices) doesn't compute is_open (it
  // depends on "now", not just the row) or count a view -- open the modal
  // immediately with the list's data for a snappy UI, then swap in the
  // single-notice RPC's fresher copy (which does both) once it lands. This
  // matters most for jobs: without it, a job whose deadline has passed
  // would still show "Apply now" until this refresh corrects it.
  const openDetail = (item, setSelected) => {
    setSelected(item);
    cmmsAnnouncementsService.getPublicNotice(item.id).then((result) => {
      if (result.success && result.data) {
        setSelected((current) => (current?.id === item.id ? result.data : current));
      }
    });
  };

  const openOpportunityDetail = (opportunity) => {
    setSelectedOpportunity(opportunity);
    cmmsBusinessOpportunitiesService.getPublicOpportunity(opportunity.id).then((result) => {
      if (result.success && result.data) {
        setSelectedOpportunity((current) => (current?.id === opportunity.id ? result.data : current));
      }
    });
  };

  // Hands the specific post off to whatever apps the visitor's own device
  // offers to share through (WhatsApp, email, SMS, etc.) via the Web Share
  // API, falling back to a clipboard copy where that API isn't available
  // (most desktop browsers) -- same pattern as PublicPitchViewer's Share.
  const handleShare = async (item, onCopied, linkBuilder = cmmsAnnouncementsService.buildPublicNoticeLink) => {
    const link = linkBuilder(companyId, item.id);
    const shareData = { title: item.title, text: item.summary || item.title, url: link };
    try {
      if (navigator.share && (!navigator.canShare || navigator.canShare(shareData))) {
        await navigator.share(shareData);
        return;
      }
    } catch (err) {
      if (err?.name === 'AbortError') return;
    }
    try {
      await navigator.clipboard.writeText(link);
      onCopied?.();
    } catch {
      window.prompt('Copy this link:', link);
    }
  };

  if (loading) {
    return (
      <div className="icanera-nb min-h-screen flex items-center justify-center">
        <style>{NB_STYLES}</style>
        <Loader className="w-8 h-8 nb-link animate-spin" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="icanera-nb min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center animate-fadeIn">
        <style>{NB_STYLES}</style>
        <div className="w-16 h-16 rounded-2xl nb-icon-box flex items-center justify-center">
          <AlertCircle className="w-8 h-8 nb-icon-muted" />
        </div>
        <p className="nb-text text-lg font-semibold">This notice board isn't available</p>
        <button
          onClick={goToApp}
          className="px-5 py-2.5 nb-btn-primary rounded-xl font-semibold transition-all hover:scale-[1.02] active:scale-[0.98] shadow-sm"
        >
          Open IcanEra
        </button>
      </div>
    );
  }

  if (accountPrompt && !accountPrompt.done) {
    // No onAuthSuccess here -- linking (and leaving this screen) is driven
    // entirely by the `user`-keyed effect above, which is what makes both
    // the instant email/password path AND the full-redirect Google path
    // (see SignUp.jsx's "Continue with Google") work the same way.
    return <AuthPage initialView="signup" prefill={accountPrompt.prefill} />;
  }

  if (accountPrompt?.done) {
    return (
      <div className="icanera-nb min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
        <style>{NB_STYLES}</style>
        <div className="w-16 h-16 rounded-2xl nb-chip-green flex items-center justify-center">
          <CheckCircle2 className="w-8 h-8" />
        </div>
        <p className="nb-text text-lg font-semibold max-w-sm">{accountPrompt.message}</p>
        <button onClick={() => setAccountPrompt(null)} className="px-5 py-2.5 nb-btn-primary rounded-xl font-semibold transition-all hover:scale-[1.02] active:scale-[0.98] shadow-sm">
          Back to notice board
        </button>
      </div>
    );
  }

  return (
    <div className="icanera-nb min-h-screen">
      <style>{NB_STYLES}</style>
      <header className={`border-b nb-header backdrop-blur sticky top-0 z-20 animate-fadeInDown transition-shadow duration-300 ${scrollState.scrolled ? 'nb-header-elevated' : ''}`}>
        <div className="h-1 nb-accent-top" />
        {/* On the front page (Notices), BusinessHero right below already
            shows the logo/name/tagline in full -- showing this compact row
            too, always, used to put two logos on screen at once. It now
            only fades in once heroPassed is true, i.e. once that big avatar
            has actually scrolled out of view, so it reads as one identity
            handing off to the other rather than a duplicate. Every other
            tab has no hero, so it expands to the full version unconditionally. */}
        {section === 'notices' ? (
          scrollState.heroPassed && (
            <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-2.5 pb-1.5 flex items-center gap-2 animate-fadeInDown" style={{ animationDuration: '0.25s' }}>
              {company.logo_url ? (
                <img src={company.logo_url} alt="" className="w-6 h-6 rounded-md object-cover flex-shrink-0" />
              ) : (
                <div className="w-6 h-6 rounded-md nb-btn-primary flex items-center justify-center font-bold text-[11px] flex-shrink-0">
                  {company.company_name?.charAt(0)?.toUpperCase() || <Building2 className="w-3.5 h-3.5" />}
                </div>
              )}
              <span className="text-sm font-bold nb-text truncate">{company.company_name}</span>
              <span className="text-[11px] nb-text-faint ml-auto hidden sm:block flex-shrink-0">
                via <IcanEraWordmark />
              </span>
            </div>
          )
        ) : (
          <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-4 pb-2 flex items-center gap-3.5">
            {company.logo_url ? (
              <img src={company.logo_url} alt={company.company_name} className="w-12 h-12 rounded-xl object-cover border nb-border shadow-sm flex-shrink-0" />
            ) : (
              <div className="w-12 h-12 rounded-xl nb-btn-primary flex items-center justify-center font-bold text-lg shadow-sm flex-shrink-0">
                {company.company_name?.charAt(0)?.toUpperCase() || <Building2 className="w-6 h-6" />}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h1 className="text-lg font-extrabold tracking-tight nb-text truncate">{company.company_name}</h1>
              <p className="text-xs nb-text-faint truncate">
                {[company.industry, company.location].filter(Boolean).join(' · ') || 'Notice board'}
              </p>
            </div>
            <span className="text-[11px] nb-text-faint nb-surface-alt px-2.5 py-1 rounded-full hidden sm:block flex-shrink-0">
              via <IcanEraWordmark />
            </span>
          </div>
        )}
        <nav className="nb-tab-nav max-w-5xl mx-auto px-4 sm:px-6 flex flex-nowrap gap-1 overflow-x-auto">
          {[
            { id: 'notices', label: 'Notices', icon: Megaphone },
            ...(products.length > 0 ? [{ id: 'shop', label: 'Products & Services', icon: ShoppingBag }] : []),
            ...(pitches.length > 0 ? [{ id: 'pitchin', label: 'Pitches', icon: Video }] : []),
            { id: 'careers', label: 'Careers', icon: Briefcase },
            ...(opportunities.length > 0 ? [{ id: 'opportunities', label: 'Opportunities', icon: Award }] : []),
            { id: 'track', label: 'Track my application', icon: Search },
            ...(opportunities.length > 0 ? [{ id: 'track-bid', label: 'Track my bid', icon: Search }] : []),
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSection(tab.id)}
              className={`flex-shrink-0 px-3.5 sm:px-4 py-2.5 text-sm font-semibold flex items-center gap-1.5 border-b-2 whitespace-nowrap transition-colors ${section === tab.id ? 'nb-tab-active' : 'nb-tab'}`}
            >
              <tab.icon className="w-4 h-4" /> {tab.label}
            </button>
          ))}
        </nav>
      </header>

      {/* jobs/notices here are the list RPC's rows, which (unlike the
          single-notice detail fetch) don't compute is_open -- fine for a
          rough "there's activity here" count, not meant as an exact "still
          accepting applications" figure. */}
      {section === 'notices'
        ? <BusinessHero company={company} noticeCount={notices.length} jobCount={jobs.length} pitchCount={pitches.length} />
        : <ContactStrip company={company} />}

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-7">
        <div key={section} className="animate-fadeInUp" style={{ animationDuration: '0.35s' }}>
          {section === 'notices' && (
            // A wide screen leaves a single centered column mostly empty on
            // either side -- give it a real second column (Google Business/
            // Yelp-style info panel) instead. Sidebar is lg+ only; on
            // mobile/tablet everything in it is already reachable from the
            // hero's own action buttons above.
            <div className="lg:grid lg:grid-cols-[1fr_300px] lg:gap-6 lg:items-start">
              <div className="min-w-0">
                {company.about && <AboutCard company={company} />}
                <NoticeList notices={notices} onSelect={(notice) => openDetail(notice, setSelectedNotice)} />
              </div>
              <BusinessInfoSidebar company={company} className="hidden lg:block" />
            </div>
          )}
          {section === 'shop' && (
            <ShopSection
              products={products}
              loading={productsLoading}
              cart={cart}
              setCart={setCart}
              businessProfileId={company.business_profile_id}
              user={user}
              authLoading={authLoading}
            />
          )}
          {section === 'pitchin' && (
            <PitchinSection pitches={pitches} loading={pitchesLoading} />
          )}
          {section === 'careers' && (
            <JobList jobs={jobs} onSelect={(job) => openDetail(job, setSelectedJob)} />
          )}
          {section === 'opportunities' && (
            <OpportunityList opportunities={opportunities} onSelect={openOpportunityDetail} />
          )}
          {section === 'track' && <TrackApplication companyId={companyId} viewerUser={user} onWantAccount={requestAccountCreation} />}
          {section === 'track-bid' && <TrackOpportunityBid viewerUser={user} onWantAccount={requestAccountCreation} />}
        </div>
      </main>

      <footer className="text-center text-xs nb-text-faint pb-8 pt-6">
        <SocialRow company={company} className="justify-center mb-4" />
        <p>
          {company.company_name} · Powered by{' '}
          <button onClick={goToApp} className="align-middle hover:opacity-80 transition-opacity">
            <IcanEraWordmark />
          </button>
        </p>
      </footer>

      {selectedNotice && <NoticeDetailModal notice={selectedNotice} onClose={() => setSelectedNotice(null)} onShare={handleShare} />}
      {selectedJob && <JobDetailModal job={selectedJob} onClose={() => setSelectedJob(null)} onShare={handleShare} viewerUser={user} onWantAccount={requestAccountCreation} />}
      {selectedOpportunity && (
        <OpportunityDetailModal
          opportunity={selectedOpportunity}
          onClose={() => setSelectedOpportunity(null)}
          onShare={(item, onCopied) => handleShare(item, onCopied, cmmsBusinessOpportunitiesService.buildPublicOpportunityLink)}
          viewerUser={user}
          onWantAccount={requestAccountCreation}
        />
      )}
    </div>
  );
};

// The brand name is "IcanEra" (capital I/E, lowercase elsewhere) everywhere
// else in the app -- LandingPage.jsx, MainNavigation's logo alt text, etc.
// A two-tone treatment (rather than plain gray text) reads as a proper
// wordmark instead of an afterthought footer credit.
const IcanEraWordmark = () => (
  <span className="font-bold tracking-tight">
    <span className="nb-wordmark-a">Ican</span><span className="nb-wordmark-b">Era</span>
  </span>
);

// One row of circular icon links out to whichever social profiles this
// business filled in (CMMSAnnouncementsPanel's "Website & contact" card) --
// renders nothing at all when none are set, rather than a row of dead icons.
const SocialRow = ({ company, className = '' }) => {
  const links = SOCIAL_LINKS
    .map((social) => ({ ...social, href: normalizeExternalUrl(company[social.key]) }))
    .filter((social) => social.href);
  if (links.length === 0) return null;
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {links.map((social) => (
        <a
          key={social.key}
          href={social.href}
          target="_blank"
          rel="noreferrer"
          aria-label={social.label}
          title={social.label}
          className="nb-social-btn w-9 h-9 rounded-full flex items-center justify-center transition-colors"
        >
          <social.icon className="w-4 h-4" />
        </a>
      ))}
    </div>
  );
};

// The row of "actually do something" buttons -- call, WhatsApp, email,
// directions, visit their real website, share this page -- built from
// whatever contact fields the business filled in. This, more than the
// notices feed itself, is what makes the page read as the business's own
// site rather than a job board bolted onto ICANEra.
// Call/WhatsApp (whichever exists) leads as a filled, brand-colored button --
// the one action most visitors actually came to take -- everything else
// (Email, Directions, Website) trails as a lighter outline pill, the same
// primary/secondary hierarchy a real landing page's CTA row uses instead of
// a flat row of identical buttons.
const ContactActions = ({ company, onShare, size = 'default' }) => {
  const actions = [
    company.whatsapp && { key: 'whatsapp', label: 'WhatsApp', icon: MessageCircle, href: buildWhatsAppLink(company.whatsapp), primary: true },
    !company.whatsapp && company.phone && { key: 'call', label: 'Call', icon: Phone, href: buildTelLink(company.phone), primary: true },
    company.whatsapp && company.phone && { key: 'call', label: 'Call', icon: Phone, href: buildTelLink(company.phone) },
    company.email && { key: 'email', label: 'Email', icon: Mail, href: buildMailLink(company.email) },
    company.location && { key: 'directions', label: 'Directions', icon: Navigation, href: buildDirectionsLink(company.location, company.company_name) },
    company.website && { key: 'website', label: 'Website', icon: Globe, href: normalizeExternalUrl(company.website) },
  ].filter(Boolean);

  const pad = size === 'compact' ? 'px-3 py-1.5 text-xs' : 'px-3.5 py-2 text-sm';
  return (
    <div className="flex flex-wrap items-center gap-2">
      {actions.map((action) => (
        <a
          key={action.key}
          href={action.href}
          target={action.key === 'website' ? '_blank' : undefined}
          rel={action.key === 'website' ? 'noreferrer' : undefined}
          className={`rounded-full font-semibold flex items-center gap-1.5 transition-all hover:scale-[1.03] active:scale-[0.98] shadow-sm ${pad} ${action.primary ? 'nb-btn-primary' : 'nb-action-btn'}`}
        >
          <action.icon className="w-3.5 h-3.5" /> {action.label}
        </a>
      ))}
      {onShare && (
        <button onClick={onShare} className={`nb-btn-secondary rounded-full font-semibold flex items-center gap-1.5 transition-all hover:scale-[1.03] active:scale-[0.98] ${pad}`}>
          <Share2 className="w-3.5 h-3.5" /> Share
        </button>
      )}
    </div>
  );
};

// A short "what this business does" line for the hero when no tagline has
// been set -- the first sentence of About, so the hero never sits with a
// dead gap between the name and the industry/location chips.
const deriveHeroSubtitle = (company) => {
  if (company.tagline?.trim()) return company.tagline.trim();
  const about = company.about?.trim();
  if (!about) return null;
  const firstSentence = about.split(/(?<=[.!?])\s/)[0] || about;
  return firstSentence.length > 140 ? `${firstSentence.slice(0, 137)}…` : firstSentence;
};

// Small social-proof pills ("6 open jobs", "12 updates") -- real numbers
// from a real, active business read as more trustworthy than the tagline
// alone, the same "this place is actually alive" signal a Google Business
// listing's review count gives at a glance.
const HeroStats = ({ noticeCount, jobCount, pitchCount = 0 }) => {
  const stats = [
    jobCount > 0 && { label: `${jobCount} open job${jobCount === 1 ? '' : 's'}` },
    noticeCount > 0 && { label: `${noticeCount} update${noticeCount === 1 ? '' : 's'}` },
    pitchCount > 0 && { label: `${pitchCount} pitch video${pitchCount === 1 ? '' : 's'}` },
  ].filter(Boolean);
  if (stats.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 mt-2.5">
      {stats.map((stat) => (
        <span key={stat.label} className="nb-chip-green text-[11px] font-bold px-2.5 py-1 rounded-full">{stat.label}</span>
      ))}
    </div>
  );
};

// The homepage hero -- shown only on the "Notices" (front page) tab, same
// place a real business's own website would put its cover photo, logo and
// tagline above the fold.
const BusinessHero = ({ company, noticeCount = 0, jobCount = 0, pitchCount = 0 }) => {
  const [linkCopied, setLinkCopied] = useState(false);
  const shareBoard = async () => {
    const link = window.location.href.split('?')[0];
    try {
      if (navigator.share) {
        await navigator.share({ title: company.company_name, text: company.tagline || company.about || company.company_name, url: link });
        return;
      }
    } catch (err) {
      if (err?.name === 'AbortError') return;
    }
    try {
      await navigator.clipboard.writeText(link);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      window.prompt('Copy this link:', link);
    }
  };
  const subtitle = deriveHeroSubtitle(company);

  return (
    <div className="animate-fadeInDown">
      <div className="relative h-40 sm:h-64 w-full overflow-hidden">
        {company.cover_image_url ? (
          <img src={company.cover_image_url} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full nb-hero-cover" />
        )}
        <div className="absolute inset-0 nb-hero-overlay" />
      </div>
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <div className="flex items-end gap-4 -mt-12 sm:-mt-14 relative z-10">
          <div className="relative flex-shrink-0">
            {company.logo_url ? (
              <img src={company.logo_url} alt={company.company_name} className="w-24 h-24 sm:w-28 sm:h-28 rounded-2xl object-cover nb-hero-avatar nb-hero-avatar-photo" />
            ) : (
              <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-2xl nb-btn-primary nb-hero-avatar flex items-center justify-center font-bold text-3xl sm:text-4xl">
                {company.company_name?.charAt(0)?.toUpperCase() || <Building2 className="w-9 h-9" />}
              </div>
            )}
            <span className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full nb-verified-mark flex items-center justify-center" title="Verified IcanEra business" aria-label="Verified IcanEra business">
              <BadgeCheck className="w-[18px] h-[18px]" />
            </span>
          </div>
          <div className="flex-1 min-w-0 pb-1 sm:pb-2">
            <h1 className="text-xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight nb-text drop-shadow-sm truncate">
              {company.company_name}
            </h1>
          </div>
        </div>

        <div className="mt-4 sm:mt-5">
          {subtitle && <p className="nb-text font-medium leading-snug max-w-2xl">{subtitle}</p>}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs nb-text-faint">
            {company.industry && <span className="inline-flex items-center gap-1"><Building2 className="w-3.5 h-3.5" /> {company.industry}</span>}
            {company.location && <span className="inline-flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> {company.location}</span>}
            {company.hours_text && <span className="inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {company.hours_text}</span>}
          </div>
          <HeroStats noticeCount={noticeCount} jobCount={jobCount} pitchCount={pitchCount} />

          <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
            <ContactActions company={company} onShare={shareBoard} />
            <SocialRow company={company} />
          </div>
          {linkCopied && <p className="nb-copied inline-block text-xs font-semibold px-2.5 py-1 rounded-full mt-2">Link copied</p>}
        </div>
      </div>
    </div>
  );
};

// One vertical "business info" row -- icon, label, and either plain text or
// a link -- shared by every row in BusinessInfoSidebar below so they read
// as one consistent list instead of several different hand-built rows.
const InfoRow = ({ icon: Icon, label, value, href, external }) => {
  if (!value) return null;
  const content = (
    <>
      <Icon className="w-4 h-4 nb-icon-muted flex-shrink-0 mt-0.5" />
      <span className="min-w-0">
        <span className="block text-[11px] uppercase tracking-wide nb-text-faint">{label}</span>
        <span className="block text-sm nb-text break-words">{value}</span>
      </span>
    </>
  );
  if (!href) return <div className="flex items-start gap-2.5 py-2">{content}</div>;
  return (
    <a href={href} target={external ? '_blank' : undefined} rel={external ? 'noreferrer' : undefined} className="nb-info-row flex items-start gap-2.5 py-2 -mx-2 px-2 rounded-lg transition-colors">
      {content}
    </a>
  );
};

// The desktop-only sidebar (a real business page's "Info" panel -- think
// Google Business/Yelp) that turns the wide, mostly-empty right margin a
// single centered column leaves on a large screen into somewhere useful.
// Deliberately not shown on mobile: everything here is already reachable
// from the hero's action buttons, and duplicating a full info card below
// the fold on a phone would just be scroll-padding, not value.
const BusinessInfoSidebar = ({ company, className = '' }) => {
  const hasAnyInfo = company.location || company.hours_text || company.phone || company.whatsapp || company.email || company.website;
  if (!hasAnyInfo) return null;
  return (
    <aside className={`nb-card rounded-2xl shadow-sm p-5 lg:sticky lg:top-24 ${className}`}>
      <h2 className="text-sm font-bold nb-text uppercase tracking-wide mb-1">Business info</h2>
      <div className="divide-y nb-border">
        <InfoRow icon={MapPin} label="Location" value={company.location} href={buildDirectionsLink(company.location, company.company_name)} external />
        <InfoRow icon={Clock} label="Hours" value={company.hours_text} />
        <InfoRow icon={Phone} label="Phone" value={company.phone} href={buildTelLink(company.phone)} />
        <InfoRow icon={MessageCircle} label="WhatsApp" value={company.whatsapp} href={buildWhatsAppLink(company.whatsapp)} external />
        <InfoRow icon={Mail} label="Email" value={company.email} href={buildMailLink(company.email)} />
        <InfoRow icon={Globe} label="Website" value={company.website} href={normalizeExternalUrl(company.website)} external />
      </div>
      <SocialRow company={company} className="mt-3 pt-3 border-t nb-border" />
    </aside>
  );
};

// A compact, single-line version of the same contact info, kept visible on
// every other tab (Careers, Products & Services, ...) so a visitor doesn't
// have to hop back to "Notices" just to find a phone number.
const ContactStrip = ({ company }) => {
  const hasContact = company.phone || company.whatsapp || company.email || company.location || company.website;
  if (!hasContact) return null;
  return (
    <div className="nb-strip animate-fadeInDown">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-2.5 overflow-x-auto">
        <ContactActions company={company} size="compact" />
      </div>
    </div>
  );
};

const EmptyState = ({ icon: Icon, text }) => (
  <div className="text-center py-20 animate-fadeIn">
    <div className="w-14 h-14 rounded-2xl nb-empty-icon flex items-center justify-center mx-auto mb-4">
      <Icon className="w-7 h-7" />
    </div>
    <p className="nb-text-muted text-sm">{text}</p>
  </div>
);

// A real "what this business does" section, in the owner's own words (set
// from CMMSAnnouncementsPanel's "Board profile" tab) -- this is what makes
// the board read as the business's own site rather than just a job/notice
// feed bolted onto ICANEra.
const AboutCard = ({ company }) => (
  <div className="nb-card rounded-2xl shadow-sm p-5 lg:p-6 mb-5 animate-fadeInUp">
    <h2 className="text-sm font-bold nb-text uppercase tracking-wide mb-2">About {company.company_name}</h2>
    <p className="nb-text-muted whitespace-pre-wrap leading-relaxed text-sm lg:text-[15px]">{company.about}</p>
  </div>
);

const NoticeList = ({ notices, onSelect }) => {
  if (notices.length === 0) {
    return <EmptyState icon={Megaphone} text="No public notices right now. Check back later." />;
  }
  // xl (not lg) for the 3rd column -- on the Notices tab this grid shares
  // its row with BusinessInfoSidebar from lg upward, so 3 columns would
  // otherwise start cramping right where the sidebar appears.
  return (
    <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-5">
      {notices.map((notice, i) => (
        <button
          key={notice.id}
          onClick={() => onSelect(notice)}
          style={{ animationDelay: `${Math.min(i, 8) * 60}ms`, animationFillMode: 'backwards' }}
          className="group text-left nb-card rounded-2xl shadow-sm overflow-hidden transition-all duration-300 hover:shadow-lg hover:-translate-y-1 animate-fadeInUp"
        >
          <div className="aspect-video w-full overflow-hidden nb-surface-alt">
            {notice.poster_url ? (
              <img src={notice.poster_url} alt="" className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Megaphone className="w-8 h-8 nb-icon-muted" />
              </div>
            )}
          </div>
          <div className="p-4">
            <h3 className="font-bold nb-text line-clamp-2">{notice.title}</h3>
            {notice.summary && <p className="text-sm nb-text-muted mt-1 line-clamp-2">{notice.summary}</p>}
            <p className="text-xs nb-text-faint mt-3 flex items-center gap-1">
              <Clock className="w-3 h-3" /> {notice.published_at ? new Date(notice.published_at).toLocaleDateString() : ''}
            </p>
          </div>
        </button>
      ))}
    </div>
  );
};

// One Pitchin video card -- same rounded-card/aspect-video idiom as
// NoticeList's cards, so the Pitches tab reads as this same page rather than
// an embedded widget from a different app. Links out to the pitch's own
// public /pitchin/:id view (PublicPitchViewer, already a no-login shared-link
// route) for the full watch/like/comment experience instead of reimplementing
// it here; a plain <a> is deliberate -- this page's own "back to app" action
// (goToApp, above) already does a hard navigation rather than a client-side
// route push, so cross-page links here follow the same pattern.
const PitchCard = ({ pitch, index = 0 }) => (
  <a
    href={`/pitchin/${pitch.id}`}
    style={{ animationDelay: `${Math.min(index, 8) * 60}ms`, animationFillMode: 'backwards' }}
    className="group block nb-card rounded-2xl shadow-sm overflow-hidden transition-all duration-300 hover:shadow-lg hover:-translate-y-1 animate-fadeInUp"
  >
    <div className="relative aspect-video w-full overflow-hidden nb-surface-alt">
      {pitch.video_url ? (
        <video
          src={pitch.video_url}
          poster={pitch.thumbnail_url || undefined}
          muted
          loop
          playsInline
          preload="metadata"
          className="w-full h-full object-cover"
          onMouseEnter={(e) => e.currentTarget.play().catch(() => {})}
          onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <Video className="w-8 h-8 nb-icon-muted" />
        </div>
      )}
      <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/10 transition-colors">
        <span className="w-11 h-11 rounded-full bg-white/90 flex items-center justify-center shadow-md scale-90 group-hover:scale-100 transition-transform">
          <Play className="w-5 h-5 text-black ml-0.5" fill="currentColor" />
        </span>
      </div>
    </div>
    <div className="p-4">
      <h3 className="font-bold nb-text line-clamp-2">{pitch.title}</h3>
      {pitch.category && <p className="text-xs nb-text-faint mt-1">{pitch.category}</p>}
      {pitch.description && <p className="text-sm nb-text-muted mt-1.5 line-clamp-2">{pitch.description}</p>}
      <div className="flex items-center gap-3 mt-3 text-xs nb-text-faint">
        <span className="inline-flex items-center gap-1"><Eye className="w-3.5 h-3.5" /> {pitch.views_count || 0}</span>
        <span className="inline-flex items-center gap-1"><Heart className="w-3.5 h-3.5" /> {pitch.likes_count || 0}</span>
      </div>
    </div>
  </a>
);

const PitchinSection = ({ pitches, loading }) => {
  if (loading && pitches.length === 0) {
    return (
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-5">
        {[0, 1, 2].map((i) => (
          <div key={i} className="nb-card rounded-2xl overflow-hidden animate-pulse">
            <div className="aspect-video nb-surface-alt" />
            <div className="p-4 space-y-2">
              <div className="h-4 w-3/4 rounded nb-surface-alt" />
              <div className="h-3 w-1/2 rounded nb-surface-alt" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (pitches.length === 0) {
    return <EmptyState icon={Video} text="No pitch videos yet." />;
  }
  return (
    <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-5">
      {pitches.map((pitch, i) => <PitchCard key={pitch.id} pitch={pitch} index={i} />)}
    </div>
  );
};

const JobList = ({ jobs, onSelect }) => {
  if (jobs.length === 0) {
    return <EmptyState icon={Briefcase} text="No open positions right now. Check back later." />;
  }
  return (
    <div className="space-y-3">
      {jobs.map((job, i) => (
        <button
          key={job.id}
          onClick={() => onSelect(job)}
          style={{ animationDelay: `${Math.min(i, 8) * 60}ms`, animationFillMode: 'backwards' }}
          className="group w-full text-left nb-card rounded-2xl shadow-sm transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5 flex items-center gap-4 p-4 animate-fadeInUp"
        >
          {job.poster_url ? (
            <img src={job.poster_url} alt="" className="w-16 h-16 sm:w-20 sm:h-20 object-cover rounded-xl flex-shrink-0" />
          ) : (
            <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl nb-chip-green flex items-center justify-center flex-shrink-0">
              <Briefcase className="w-7 h-7" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h3 className="font-bold nb-text line-clamp-1">{job.title}</h3>
            {job.summary && <p className="text-sm nb-text-muted line-clamp-1">{job.summary}</p>}
            <div className="flex flex-wrap gap-2 mt-2">
              {job.employment_type && (
                <span className="inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-full nb-chip-green">
                  {EMPLOYMENT_LABELS[job.employment_type] || job.employment_type}
                </span>
              )}
              {job.location && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full nb-chip-neutral">
                  <MapPin className="w-3 h-3" /> {job.location}
                </span>
              )}
              {job.application_deadline && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full nb-chip-amber">
                  <Calendar className="w-3 h-3" /> Apply by {job.application_deadline}
                </span>
              )}
            </div>
          </div>
          <ChevronRight className="w-5 h-5 nb-icon-muted flex-shrink-0 transition-transform duration-300 group-hover:translate-x-1" />
        </button>
      ))}
    </div>
  );
};

const OpportunityList = ({ opportunities, onSelect }) => {
  if (opportunities.length === 0) {
    return <EmptyState icon={Award} text="No open opportunities right now. Check back later." />;
  }
  return (
    <div className="space-y-3">
      {opportunities.map((o, i) => (
        <button
          key={o.id}
          onClick={() => onSelect(o)}
          style={{ animationDelay: `${Math.min(i, 8) * 60}ms`, animationFillMode: 'backwards' }}
          className="group w-full text-left nb-card rounded-2xl shadow-sm transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5 flex items-center gap-4 p-4 animate-fadeInUp"
        >
          {o.poster_url ? (
            <img src={o.poster_url} alt="" className="w-16 h-16 sm:w-20 sm:h-20 object-cover rounded-xl flex-shrink-0" />
          ) : (
            <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl nb-chip-green flex items-center justify-center flex-shrink-0">
              <Award className="w-7 h-7" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h3 className="font-bold nb-text line-clamp-1">{o.title}</h3>
            {o.description && <p className="text-sm nb-text-muted line-clamp-1">{o.description}</p>}
            <div className="flex flex-wrap gap-2 mt-2">
              {o.budget_hint && (
                <span className="inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-full nb-chip-green">
                  {o.budget_hint}
                </span>
              )}
              {o.deadline && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full nb-chip-amber">
                  <Calendar className="w-3 h-3" /> Closes {new Date(o.deadline).toLocaleDateString()}
                </span>
              )}
            </div>
          </div>
          <ChevronRight className="w-5 h-5 nb-icon-muted flex-shrink-0 transition-transform duration-300 group-hover:translate-x-1" />
        </button>
      ))}
    </div>
  );
};

// Browsing is free for anyone; paying is a real ICANEra wallet transfer, so
// it needs an account. An anonymous visitor who hits "Pay" gets the signup
// form right here (no navigating away, cart stays intact) -- once they have
// an account, the exact same button pays instantly, same as anywhere else
// in ICANEra. This is the whole "click a product -> get an ICANEra wallet,
// or transact seamlessly if you already have one" flow.
const ShopSection = ({ products, loading, cart, setCart, businessProfileId, user, authLoading }) => {
  const [showCart, setShowCart] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [deliveryFee, setDeliveryFee] = useState('');
  const [placing, setPlacing] = useState(false);
  const [checkoutError, setCheckoutError] = useState(null);
  const [receipt, setReceipt] = useState(null);

  const cartItems = useMemo(
    () => Object.entries(cart)
      .map(([listingId, qty]) => ({ listing: products.find((p) => p.listing_id === listingId), qty }))
      .filter((row) => row.listing && row.qty > 0),
    [cart, products]
  );
  const cartTotal = cartItems.reduce((sum, row) => sum + row.listing.listed_price * row.qty, 0);
  const cartCount = cartItems.reduce((sum, row) => sum + row.qty, 0);
  const allFreeDelivery = cartItems.length > 0 && cartItems.every((row) => row.listing.free_delivery);
  const deliveryFeeAmount = allFreeDelivery ? 0 : (Number(deliveryFee) || 0);
  const orderTotal = cartTotal + deliveryFeeAmount;

  const changeQty = (listingId, delta, maxStock) => {
    setCart((prev) => {
      const next = Math.max(0, Math.min(maxStock ?? Infinity, (prev[listingId] || 0) + delta));
      return { ...prev, [listingId]: next };
    });
  };

  const handleCheckout = async () => {
    if (authLoading) return;
    if (!user) { setShowAuthModal(true); return; }
    if (cartItems.length === 0) return;

    setPlacing(true);
    setCheckoutError(null);
    try {
      const cartPayload = cartItems.map((row) => ({ product_id: row.listing.product_id, quantity: row.qty }));
      const { data, error } = await dropshipCheckout(businessProfileId, cartPayload, {
        customerName: customerName.trim() || undefined,
        customerPhone: customerPhone.trim() || undefined,
        deliveryAddress: deliveryAddress.trim() || undefined,
        deliveryFee: deliveryFeeAmount,
      });
      if (error || !data?.success) {
        throw new Error(error?.message || data?.error || 'Checkout failed');
      }
      setReceipt(data);
      setCart({});
    } catch (err) {
      setCheckoutError(err.message || 'Checkout failed. Please try again.');
    } finally {
      setPlacing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader className="w-7 h-7 nb-link animate-spin" />
      </div>
    );
  }

  if (receipt) {
    return (
      <div className="max-w-md mx-auto text-center py-4 animate-fadeIn">
        <div className="w-16 h-16 rounded-full nb-chip-green flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 className="w-9 h-9" />
        </div>
        <h3 className="text-lg font-bold nb-text mb-1">Order placed!</h3>
        <p className="nb-text-muted text-sm mb-4">Paid with your ICANEra wallet.</p>
        <div className="nb-card rounded-2xl p-4 text-left space-y-2">
          <div className="flex justify-between text-sm"><span className="nb-text-faint">Receipt number</span><span className="nb-text font-mono">{receipt.customer_receipt_number}</span></div>
          <div className="flex justify-between text-sm"><span className="nb-text-faint">Items</span><span className="nb-text">{receipt.items_count}</span></div>
          {receipt.delivery_fee > 0 && (
            <div className="flex justify-between text-sm"><span className="nb-text-faint">Delivery fee</span><span className="nb-text">{formatUGX(receipt.delivery_fee)}</span></div>
          )}
          <div className="flex justify-between text-base font-semibold border-t nb-border pt-2 mt-2"><span className="nb-text">Total paid</span><span className="nb-text">{formatUGX(receipt.customer_paid_total)}</span></div>
          {receipt.delivery_address && (
            <div className="flex justify-between text-sm"><span className="nb-text-faint">Delivery to</span><span className="nb-text text-right">{receipt.delivery_address}</span></div>
          )}
        </div>
        <button onClick={() => setReceipt(null)} className="mt-6 px-5 py-2.5 rounded-xl nb-btn-secondary font-semibold transition">Keep browsing</button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm nb-text-muted">Browse for free. Pay with your ICANEra wallet when you're ready to order.</p>
        <button onClick={() => setShowCart(true)} className="relative p-2.5 rounded-full nb-share-btn flex-shrink-0">
          <ShoppingCart className="w-4 h-4" />
          {cartCount > 0 && (
            <span className="absolute -top-1 -right-1 nb-badge-count text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">{cartCount}</span>
          )}
        </button>
      </div>

      {products.length === 0 ? (
        <EmptyState icon={ShoppingBag} text="Nothing listed right now. Check back later." />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
          {products.map((listing) => {
            const qty = cart[listing.listing_id] || 0;
            return (
              <div key={listing.listing_id} className="nb-card rounded-2xl overflow-hidden flex flex-col">
                <div className="aspect-square nb-surface-alt flex items-center justify-center overflow-hidden">
                  {listing.images?.[0] ? (
                    <img src={listing.images[0]} alt={listing.name} className="w-full h-full object-cover" />
                  ) : (
                    <Store className="w-8 h-8 nb-icon-muted" />
                  )}
                </div>
                <div className="p-2.5 flex-1 flex flex-col">
                  <p className="text-sm nb-text font-medium line-clamp-2 min-h-[2.5rem]">{listing.name}</p>
                  <p className="nb-price font-bold mt-1">{formatUGX(listing.listed_price)}</p>
                  {listing.free_delivery && (
                    <p className="mt-0.5 flex items-center gap-1 text-[11px] nb-text-muted"><Truck className="w-3 h-3" />Free delivery</p>
                  )}
                  {!listing.in_stock ? (
                    <p className="mt-2 text-xs nb-out-of-stock font-semibold">Out of stock</p>
                  ) : qty === 0 ? (
                    <button onClick={() => changeQty(listing.listing_id, 1, listing.available_stock)} className="mt-2 w-full py-1.5 rounded-lg nb-btn-primary text-xs font-semibold transition">
                      Add to cart
                    </button>
                  ) : (
                    <div className="mt-2 flex items-center justify-between rounded-lg nb-qty-pill">
                      <button onClick={() => changeQty(listing.listing_id, -1, listing.available_stock)} className="p-1.5 nb-text"><Minus className="w-3.5 h-3.5" /></button>
                      <span className="nb-text text-sm font-semibold">{qty}</span>
                      <button onClick={() => changeQty(listing.listing_id, 1, listing.available_stock)} className="p-1.5 nb-text"><Plus className="w-3.5 h-3.5" /></button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showCart && (
        <Modal onClose={() => setShowCart(false)}>
          <h2 className="text-lg font-bold nb-text mb-4">Your cart</h2>
          {cartItems.length === 0 ? (
            <p className="text-sm nb-text-faint text-center py-8">Your cart is empty</p>
          ) : (
            <div className="space-y-3">
              {cartItems.map((row) => (
                <div key={row.listing.listing_id} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm nb-text truncate">{row.listing.name}</p>
                    <p className="text-xs nb-text-faint">{formatUGX(row.listing.listed_price)} × {row.qty}</p>
                  </div>
                  <button onClick={() => setCart((prev) => ({ ...prev, [row.listing.listing_id]: 0 }))} className="p-1.5 nb-text-faint hover:opacity-70"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
              <div className="space-y-2 pt-2 border-t nb-border">
                <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Your name" className="w-full px-3 py-2 rounded-xl nb-input text-sm" />
                <input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="Phone number" className="w-full px-3 py-2 rounded-xl nb-input text-sm" />
                <input value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} placeholder="Delivery address" className="w-full px-3 py-2 rounded-xl nb-input text-sm" />
                {allFreeDelivery ? (
                  <p className="flex items-center gap-1.5 text-xs nb-text-muted"><Truck className="w-3.5 h-3.5" />Free delivery on this order</p>
                ) : (
                  <div>
                    <label className="flex items-center gap-1.5 text-xs nb-text-faint mb-1"><Truck className="w-3.5 h-3.5" />Delivery fee</label>
                    <input type="number" min="0" value={deliveryFee} onChange={(e) => setDeliveryFee(e.target.value)} placeholder="0" className="w-full px-3 py-2 rounded-xl nb-input text-sm" />
                  </div>
                )}
              </div>
              <div className="border-t nb-border pt-3 space-y-1">
                <div className="flex justify-between text-sm nb-text-faint"><span>Items</span><span>{formatUGX(cartTotal)}</span></div>
                {deliveryFeeAmount > 0 && (
                  <div className="flex justify-between text-sm nb-text-faint"><span>Delivery</span><span>{formatUGX(deliveryFeeAmount)}</span></div>
                )}
                <div className="flex justify-between nb-text font-semibold"><span>Total</span><span>{formatUGX(orderTotal)}</span></div>
              </div>
              {checkoutError && <p className="nb-error-text text-xs">{checkoutError}</p>}
              <button
                onClick={handleCheckout}
                disabled={placing}
                className="w-full py-2.5 rounded-xl nb-btn-primary disabled:opacity-50 text-sm font-semibold transition flex items-center justify-center gap-2"
              >
                {placing ? <Loader className="w-4 h-4 animate-spin" /> : null}
                {user ? `Pay ${formatUGX(orderTotal)} with ICANEra` : 'Sign up free to pay with ICANEra'}
              </button>
            </div>
          )}
        </Modal>
      )}

      {showAuthModal && (
        <div className="icanera-nb fixed inset-0 z-[60] overflow-y-auto nb-surface">
          <button onClick={() => setShowAuthModal(false)} className="fixed top-4 right-4 nb-share-btn p-2 rounded-full z-10">
            <X className="w-5 h-5" />
          </button>
          <AuthPage initialView="signup" onAuthSuccess={() => setShowAuthModal(false)} />
        </div>
      )}
    </div>
  );
};

const NoticeDetailModal = ({ notice, onClose, onShare }) => {
  const [copied, setCopied] = useState(false);
  return (
    <Modal onClose={onClose}>
      {notice.poster_url && <img src={notice.poster_url} alt="" className="w-full max-h-72 object-cover rounded-xl mb-4" />}
      <div className="flex items-start justify-between gap-3 mb-2">
        <h2 className="text-xl font-bold nb-text">{notice.title}</h2>
        <ShareButton copied={copied} onClick={() => onShare(notice, () => { setCopied(true); setTimeout(() => setCopied(false), 2000); })} />
      </div>
      <p className="text-xs nb-text-faint mb-4 flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {notice.published_at ? new Date(notice.published_at).toLocaleString() : ''}</p>
      <p className="nb-text-muted whitespace-pre-wrap leading-relaxed">{notice.body}</p>
      {notice.document_url && (
        <a href={notice.document_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 mt-5 nb-link text-sm font-semibold">
          <FileText className="w-4 h-4" /> View attached document (PDF)
        </a>
      )}
    </Modal>
  );
};

const ShareButton = ({ copied, onClick }) => (
  <button
    onClick={onClick}
    className={`flex-shrink-0 flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full transition-all ${copied ? 'nb-copied' : 'nb-share-btn'}`}
    title="Share"
  >
    {copied ? <><Check className="w-3.5 h-3.5" /> Copied</> : <><Share2 className="w-3.5 h-3.5" /> Share</>}
  </button>
);

const JobDetailModal = ({ job, onClose, onShare, viewerUser, onWantAccount }) => {
  const [showApply, setShowApply] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <Modal onClose={onClose}>
      {!showApply ? (
        <>
          {job.poster_url && <img src={job.poster_url} alt="" className="w-full max-h-64 object-cover rounded-xl mb-4" />}
          <div className="flex items-start justify-between gap-3 mb-1">
            <h2 className="text-xl font-bold nb-text">{job.title}</h2>
            <ShareButton copied={copied} onClick={() => onShare(job, () => { setCopied(true); setTimeout(() => setCopied(false), 2000); })} />
          </div>
          <div className="flex flex-wrap gap-2 mb-4 mt-2">
            {job.location && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full nb-chip-neutral">
                <MapPin className="w-3 h-3" /> {job.location}
              </span>
            )}
            {job.employment_type && (
              <span className="inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-full nb-chip-green">
                {EMPLOYMENT_LABELS[job.employment_type] || job.employment_type}
              </span>
            )}
            {job.positions_available && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full nb-chip-neutral">
                <Users className="w-3 h-3" /> {job.positions_available} position{job.positions_available === 1 ? '' : 's'}
              </span>
            )}
            {job.salary_range && (
              <span className="inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-full nb-chip-green">
                {job.salary_range}
              </span>
            )}
            {job.application_deadline && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full nb-chip-amber">
                <Calendar className="w-3 h-3" /> Apply by {job.application_deadline}
              </span>
            )}
          </div>
          <p className="nb-text-muted whitespace-pre-wrap leading-relaxed">{job.body}</p>
          {job.application_instructions && (
            <div className="mt-4 p-3.5 rounded-xl nb-surface-alt border nb-border text-sm nb-text-muted">
              <p className="font-semibold nb-text mb-1">How to apply</p>
              {job.application_instructions}
            </div>
          )}
          {job.document_url && (
            <a href={job.document_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 mt-4 nb-link text-sm font-semibold">
              <FileText className="w-4 h-4" /> Full job description (PDF)
            </a>
          )}
          {job.is_open === false ? (
            <p className="mt-6 nb-closed-banner rounded-lg px-4 py-2.5 text-sm font-semibold text-center">Applications are closed for this posting.</p>
          ) : (
            <button
              onClick={() => setShowApply(true)}
              className="mt-6 w-full py-3 rounded-xl nb-btn-primary font-semibold transition-all hover:scale-[1.01] active:scale-[0.99] shadow-sm"
            >
              Apply now — no account needed
            </button>
          )}
        </>
      ) : (
        <ApplyForm job={job} onBack={() => setShowApply(false)} onClose={onClose} viewerUser={viewerUser} onWantAccount={onWantAccount} />
      )}
    </Modal>
  );
};

// Bidding needs no account, exactly like a job application -- a signed-out
// visitor gets a reference code to track status later
// (backend/CMMS_OPPORTUNITY_ANONYMOUS_BID.sql); a visitor who happens to
// already be signed in bids as themselves immediately, same as the in-app
// "Browse & Bid" tab.
const OpportunityDetailModal = ({ opportunity, onClose, onShare, viewerUser, onWantAccount }) => {
  const [showBidForm, setShowBidForm] = useState(false);
  const [copied, setCopied] = useState(false);

  return (
    <Modal onClose={onClose}>
      {!showBidForm ? (
        <>
          {opportunity.poster_url && <img src={opportunity.poster_url} alt="" className="w-full max-h-64 object-cover rounded-xl mb-4" />}
          <div className="flex items-start justify-between gap-3 mb-1">
            <h2 className="text-xl font-bold nb-text">{opportunity.title}</h2>
            <ShareButton copied={copied} onClick={() => onShare(opportunity, () => { setCopied(true); setTimeout(() => setCopied(false), 2000); })} />
          </div>
          {opportunity.company_name && <p className="text-sm nb-text-faint mb-2">{opportunity.company_name}</p>}
          <div className="flex flex-wrap gap-2 mb-4">
            {opportunity.budget_hint && (
              <span className="inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-full nb-chip-green">{opportunity.budget_hint}</span>
            )}
            {opportunity.deadline && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full nb-chip-amber">
                <Calendar className="w-3 h-3" /> Closes {new Date(opportunity.deadline).toLocaleDateString()}
              </span>
            )}
          </div>
          <p className="nb-text-muted whitespace-pre-wrap leading-relaxed">{opportunity.description}</p>
          {opportunity.document_url && (
            <a href={opportunity.document_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 mt-4 nb-link text-sm font-semibold">
              <FileText className="w-4 h-4" /> Full details (PDF)
            </a>
          )}
          {opportunity.is_open === false ? (
            <p className="mt-6 nb-closed-banner rounded-lg px-4 py-2.5 text-sm font-semibold text-center">This opportunity is no longer open for bids.</p>
          ) : (
            <button
              onClick={() => setShowBidForm(true)}
              className="mt-6 w-full py-3 rounded-xl nb-btn-primary font-semibold transition-all hover:scale-[1.01] active:scale-[0.99] shadow-sm"
            >
              Bid on this opportunity — no account needed
            </button>
          )}
        </>
      ) : (
        <OpportunityBidForm opportunity={opportunity} viewerUser={viewerUser} onBack={() => setShowBidForm(false)} onClose={onClose} onWantAccount={onWantAccount} />
      )}
    </Modal>
  );
};

const OpportunityBidForm = ({ opportunity, viewerUser, onBack, onClose, onWantAccount }) => {
  const [bidderName, setBidderName] = useState('');
  const [bidderEmail, setBidderEmail] = useState(viewerUser?.email || '');
  const [bidderPhone, setBidderPhone] = useState('');
  const [amount, setAmount] = useState('');
  const [proposal, setProposal] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [referenceCode, setReferenceCode] = useState('');

  useEffect(() => {
    if (!viewerUser?.id) return;
    supabase.from('profiles').select('full_name, phone').eq('id', viewerUser.id).maybeSingle().then(({ data }) => {
      if (data?.full_name) setBidderName((current) => current || data.full_name);
      if (data?.phone) setBidderPhone((current) => current || data.phone);
    });
  }, [viewerUser?.id]);

  const inputClass = 'w-full px-3.5 py-2.5 rounded-xl nb-input transition';

  const submit = async () => {
    if (!bidderName.trim() || !bidderEmail.trim() || !proposal.trim()) {
      setError('Please provide your name, email, and a proposal.');
      return;
    }
    setSubmitting(true);
    setError('');
    const result = await cmmsBusinessOpportunitiesService.submitPublicOpportunityBid(opportunity.id, {
      bidderName: bidderName.trim(),
      bidderEmail: bidderEmail.trim(),
      bidderPhone: bidderPhone.trim() || null,
      amount: amount ? Number(amount) : null,
      proposal: proposal.trim(),
    });
    setSubmitting(false);
    if (!result.success) { setError(result.error || 'Failed to submit your bid. Please try again.'); return; }
    setReferenceCode(result.referenceCode);
  };

  if (referenceCode) {
    return (
      <div className="text-center py-4 animate-fadeIn">
        <div className="w-16 h-16 rounded-full nb-chip-green flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 className="w-9 h-9" />
        </div>
        <h3 className="text-lg font-bold nb-text mb-2">Bid submitted!</h3>
        <p className="nb-text-muted text-sm mb-4">This code is the only way to check your status in "Track my bid."</p>
        <p className="text-2xl font-mono font-bold nb-link tracking-wider nb-chip-green rounded-xl py-3 px-4 inline-block">{referenceCode}</p>
        <p className="nb-error-text text-xs font-semibold mt-3">⚠ If you lose this code, this bid cannot be recovered -- there is no other way to look it up.</p>

        {!viewerUser && (
          <div className="mt-5 p-4 rounded-xl nb-surface-alt border nb-border text-left">
            <p className="nb-text font-semibold text-sm mb-1">✅ The safe way: create a free ICAN account</p>
            <p className="nb-text-muted text-xs mb-3">
              No code to lose -- this bid (and any future ones) is always right there when you sign in.
            </p>
            <button
              onClick={() => onWantAccount?.({ type: 'bid', referenceCode, contact: bidderEmail.trim(), prefill: { email: bidderEmail.trim(), fullName: bidderName.trim(), phone: bidderPhone.trim() } })}
              className="w-full py-2.5 rounded-lg nb-btn-primary font-semibold text-sm transition-all hover:scale-[1.01] active:scale-[0.99]"
            >
              Create my free account (or continue with Google)
            </button>
          </div>
        )}

        <button onClick={onClose} className="block mx-auto mt-6 px-5 py-2.5 rounded-xl nb-btn-secondary font-semibold transition">Close</button>
      </div>
    );
  }

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-1 text-sm nb-text-muted hover:opacity-80 mb-4 transition-colors"><ArrowLeft className="w-4 h-4" /> Back</button>
      <h3 className="text-lg font-bold nb-text mb-1">Bid on {opportunity.title}</h3>
      <p className="text-sm nb-text-muted mb-4">No account required. You'll receive a reference code to track your bid.</p>
      <div className="space-y-3">
        <input value={bidderName} onChange={(e) => setBidderName(e.target.value)} placeholder="Your name (or business name)" className={inputClass} />
        <div className="grid sm:grid-cols-2 gap-3">
          <input type="email" value={bidderEmail} onChange={(e) => setBidderEmail(e.target.value)} placeholder="Email address" className={inputClass} />
          <input value={bidderPhone} onChange={(e) => setBidderPhone(e.target.value)} placeholder="Phone number (optional)" className={inputClass} />
        </div>
        <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Bid amount (optional)" className={inputClass} />
        <textarea value={proposal} onChange={(e) => setProposal(e.target.value)} placeholder="Your proposal" rows={4} className={inputClass} />
        {error && <p className="nb-error-text text-sm">{error}</p>}
        <button
          disabled={submitting}
          onClick={submit}
          className="w-full py-3 rounded-xl nb-btn-primary disabled:opacity-50 font-semibold transition-all hover:scale-[1.01] active:scale-[0.99] shadow-sm"
        >
          {submitting ? 'Submitting…' : 'Submit bid'}
        </button>
      </div>
    </div>
  );
};

const ApplyForm = ({ job, onBack, onClose, viewerUser, onWantAccount }) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [coverNote, setCoverNote] = useState('');
  const [resumeFile, setResumeFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [referenceCode, setReferenceCode] = useState('');
  // If the visitor is already signed into their own ICAN account and has
  // built a Portfolio (a real, structured resume at /portfolio/<handle> --
  // see PortfolioTab.jsx), recommend reusing it instead of uploading a
  // fresh PDF: it's free, already built, and stays current -- an easier and
  // cheaper path than redoing a resume for every application.
  const [myPortfolio, setMyPortfolio] = useState(null);
  const [usePortfolio, setUsePortfolio] = useState(false);

  useEffect(() => {
    if (!viewerUser?.id) return;
    supabase.from('profiles').select('handle, full_name, phone').eq('id', viewerUser.id).maybeSingle().then(({ data }) => {
      if (data?.handle) {
        setMyPortfolio(data);
        setUsePortfolio(true);
        setName((current) => current || data.full_name || '');
        setEmail((current) => current || viewerUser.email || '');
        setPhone((current) => current || data.phone || '');
      }
    });
  }, [viewerUser?.id, viewerUser?.email]);

  const inputClass = 'w-full px-3.5 py-2.5 rounded-xl nb-input transition';

  const handleResumeSelect = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.type !== 'application/pdf') {
      setError('Please attach your resume/CV as a PDF file.');
      return;
    }
    setError('');
    setResumeFile(file);
  };

  const submit = async () => {
    if (!name.trim() || !email.trim()) {
      setError('Please provide your name and email.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      let resumeUrl = null;
      let resumePath = null;
      if (resumeFile && !(usePortfolio && myPortfolio)) {
        const uploaded = await cmmsAnnouncementsService.uploadPublicResume(resumeFile);
        if (!uploaded.success) throw new Error(uploaded.error);
        resumeUrl = uploaded.url;
        resumePath = uploaded.key;
      }

      const result = await cmmsAnnouncementsService.submitPublicJobApplication({
        jobPostingId: job.id,
        applicantName: name.trim(),
        applicantEmail: email.trim(),
        applicantPhone: phone.trim() || null,
        coverNote: coverNote.trim() || null,
        resumeUrl,
        resumePath,
        portfolioHandle: usePortfolio && myPortfolio ? myPortfolio.handle : null,
      });
      if (!result.success) throw new Error(result.error);
      setReferenceCode(result.referenceCode);
    } catch (err) {
      setError(err.message || 'Failed to submit your application. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (referenceCode) {
    return (
      <div className="text-center py-4 animate-fadeIn">
        <div className="w-16 h-16 rounded-full nb-chip-green flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 className="w-9 h-9" />
        </div>
        <h3 className="text-lg font-bold nb-text mb-2">Application submitted!</h3>
        <p className="nb-text-muted text-sm mb-4">This code is the only way to check your status in "Track my application."</p>
        <p className="text-2xl font-mono font-bold nb-link tracking-wider nb-chip-green rounded-xl py-3 px-4 inline-block">{referenceCode}</p>
        <p className="nb-error-text text-xs font-semibold mt-3">⚠ If you lose this code, this application cannot be recovered -- there is no other way to look it up.</p>

        {!viewerUser && (
          <div className="mt-5 p-4 rounded-xl nb-surface-alt border nb-border text-left">
            <p className="nb-text font-semibold text-sm mb-1">✅ The safe way: create a free ICAN account</p>
            <p className="nb-text-muted text-xs mb-3">
              No code to lose -- this application (and any future ones, including getting to interview) is always right there when you sign in.
            </p>
            <button
              onClick={() => onWantAccount?.({ type: 'job', referenceCode, contact: email.trim(), prefill: { email: email.trim(), fullName: name.trim(), phone: phone.trim() } })}
              className="w-full py-2.5 rounded-lg nb-btn-primary font-semibold text-sm transition-all hover:scale-[1.01] active:scale-[0.99]"
            >
              Create my free account (or continue with Google)
            </button>
          </div>
        )}

        <button onClick={onClose} className="block mx-auto mt-6 px-5 py-2.5 rounded-xl nb-btn-secondary font-semibold transition">Close</button>
      </div>
    );
  }

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-1 text-sm nb-text-muted hover:opacity-80 mb-4 transition-colors"><ArrowLeft className="w-4 h-4" /> Back</button>
      <h3 className="text-lg font-bold nb-text mb-1">Apply for {job.title}</h3>
      <p className="text-sm nb-text-muted mb-4">No account required. You'll receive a reference code to track your application.</p>
      <div className="space-y-3">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" className={inputClass} />
        <div className="grid sm:grid-cols-2 gap-3">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address" className={inputClass} />
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone number (optional)" className={inputClass} />
        </div>
        <textarea value={coverNote} onChange={(e) => setCoverNote(e.target.value)} placeholder="Short cover note (optional)" rows={3} className={inputClass} />
        {myPortfolio && (
          <label className="flex items-center gap-2 p-3 rounded-xl nb-surface-alt border nb-border text-sm cursor-pointer">
            <input type="checkbox" checked={usePortfolio} onChange={(e) => setUsePortfolio(e.target.checked)} />
            <span className="nb-text">Use my ICAN Portfolio as my resume <span className="nb-text-muted">(already built, no need to upload one)</span></span>
          </label>
        )}
        {!(usePortfolio && myPortfolio) && (
          <label className="flex items-center justify-center gap-2 border-2 border-dashed nb-border-strong rounded-xl p-4 text-center cursor-pointer transition hover:border-current">
            <Upload className="w-4 h-4 nb-text-muted" />
            <span className="text-sm nb-text-muted">{resumeFile ? resumeFile.name : 'Attach resume/CV (PDF)'}</span>
            <input type="file" accept="application/pdf" onChange={handleResumeSelect} className="hidden" />
          </label>
        )}
        {error && <p className="nb-error-text text-sm">{error}</p>}
        <button
          disabled={submitting}
          onClick={submit}
          className="w-full py-3 rounded-xl nb-btn-primary disabled:opacity-50 font-semibold transition-all hover:scale-[1.01] active:scale-[0.99] shadow-sm"
        >
          {submitting ? 'Submitting…' : 'Submit application'}
        </button>
      </div>
    </div>
  );
};

const StatusCard = ({
  jobTitle, companyName, submittedAt, status, statusNote,
  testAccessToken, interviewScheduleId, interviewScheduledAt, documentId, documentStatus,
}) => (
  <div className="nb-card rounded-2xl shadow-sm p-4 animate-fadeInUp">
    <p className="nb-text font-semibold">{jobTitle}</p>
    <p className="text-xs nb-text-faint mb-3">{companyName ? `${companyName} · ` : ''}Applied {new Date(submittedAt).toLocaleDateString()}</p>
    <span className={`inline-block px-3 py-1 rounded-full text-sm font-bold capitalize ${STATUS_STYLES[status] || STATUS_STYLES.submitted}`}>
      {status.replace('_', ' ')}
    </span>
    {statusNote && <p className="text-sm nb-text-muted mt-3">{statusNote}</p>}
    {testAccessToken && (
      <a
        href={`/candidate-test?token=${testAccessToken}`}
        className="mt-3 w-full py-2 rounded-lg nb-btn-primary font-semibold text-sm text-center transition-all hover:scale-[1.01] active:scale-[0.99] flex items-center justify-center gap-2"
      >
        Take your written test
      </a>
    )}
    {interviewScheduleId && (
      <a
        href={`/candidate-interview?scheduleId=${interviewScheduleId}`}
        className="mt-3 w-full py-2 rounded-lg nb-btn-primary font-semibold text-sm text-center transition-all hover:scale-[1.01] active:scale-[0.99] flex items-center justify-center gap-2"
      >
        Join your video interview{interviewScheduledAt ? ` · ${new Date(interviewScheduledAt).toLocaleString()}` : ''}
      </a>
    )}
    {documentId && (
      <a
        href={`/candidate-document?documentId=${documentId}`}
        className="mt-3 w-full py-2 rounded-lg nb-btn-primary font-semibold text-sm text-center transition-all hover:scale-[1.01] active:scale-[0.99] flex items-center justify-center gap-2"
      >
        {documentStatus === 'signed' ? 'View your appointment letter' : 'View & sign your appointment letter'}
      </a>
    )}
  </div>
);

const TrackApplication = ({ companyId, viewerUser, onWantAccount }) => {
  const { signInWithGoogle } = useAuth();
  const [referenceCode, setReferenceCode] = useState('');
  const [contact, setContact] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const continueWithGoogle = async () => {
    setGoogleLoading(true);
    try { sessionStorage.setItem(PENDING_SECTION_KEY, 'track'); } catch { /* ignore */ }
    try {
      await signInWithGoogle();
    } catch (err) {
      setError(err.message || 'Failed to continue with Google');
      setGoogleLoading(false);
    }
  };

  const [myApplications, setMyApplications] = useState(null);
  const [myApplicationsLoading, setMyApplicationsLoading] = useState(false);

  const inputClass = 'w-full px-3.5 py-2.5 rounded-xl nb-input transition';

  // Signed-in visitors never need the code at all -- see the self-healing
  // fn_get_my_job_applications (also auto-links any of their past
  // applications submitted with the same email, even if they signed up
  // after applying and the explicit link never got a chance to run).
  useEffect(() => {
    if (!viewerUser?.id || !companyId) { setMyApplications(null); return; }
    let cancelled = false;
    setMyApplicationsLoading(true);
    cmmsAnnouncementsService.getMyJobApplications(companyId).then((response) => {
      if (cancelled) return;
      setMyApplications(response.success ? response.data : []);
      setMyApplicationsLoading(false);
    });
    return () => { cancelled = true; };
  }, [viewerUser?.id, companyId]);

  const search = async () => {
    if (!referenceCode.trim() || !contact.trim()) {
      setError('Enter your reference code and the email or phone you applied with.');
      return;
    }
    setLoading(true);
    setError('');
    setSearched(true);
    const response = await cmmsAnnouncementsService.trackPublicJobApplication(referenceCode.trim(), contact.trim());
    if (!response.success) setError(response.error || 'Something went wrong. Please try again.');
    setResult(response.data || null);
    setLoading(false);
  };

  if (viewerUser) {
    return (
      <div className="max-w-md mx-auto">
        <h2 className="text-xl font-bold nb-text mb-1">Track my application</h2>
        <p className="text-sm nb-text-muted mb-5">Signed in as {viewerUser.email} -- no reference code needed.</p>
        {myApplicationsLoading ? (
          <div className="flex justify-center py-8"><Loader className="w-6 h-6 nb-link animate-spin" /></div>
        ) : !myApplications || myApplications.length === 0 ? (
          <p className="text-center nb-text-faint text-sm">No applications found for this email at this company yet.</p>
        ) : (
          <div className="space-y-3">
            {myApplications.map((app) => (
              <StatusCard
                key={app.reference_code}
                jobTitle={app.job_title}
                submittedAt={app.submitted_at}
                status={app.status}
                statusNote={app.status_note}
                testAccessToken={app.test_access_token}
                interviewScheduleId={app.interview_schedule_id}
                interviewScheduledAt={app.interview_scheduled_at}
                documentId={app.document_id}
                documentStatus={app.document_status}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto">
      <h2 className="text-xl font-bold nb-text mb-1">Track my application</h2>
      <p className="text-sm nb-text-muted mb-5">Enter the reference code you received, plus the email or phone you applied with.</p>
      <div className="space-y-3">
        <input value={referenceCode} onChange={(e) => setReferenceCode(e.target.value)} placeholder="Reference code (e.g. JOB-A1B2C3D4)" className={`${inputClass} font-mono`} />
        <input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Email or phone used to apply" className={inputClass} />
        {error && <p className="nb-error-text text-sm">{error}</p>}
        <button
          disabled={loading}
          onClick={search}
          className="w-full py-3 rounded-xl nb-btn-primary disabled:opacity-50 font-semibold transition-all hover:scale-[1.01] active:scale-[0.99] shadow-sm flex items-center justify-center gap-2"
        >
          {loading ? <Loader className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} {loading ? 'Searching…' : 'Check status'}
        </button>
      </div>

      <div className="relative my-5">
        <div className="absolute inset-0 flex items-center"><div className="w-full border-t nb-border"></div></div>
        <div className="relative flex justify-center text-xs"><span className="px-3 nb-surface nb-text-faint">Or, no code needed</span></div>
      </div>
      <button
        disabled={googleLoading}
        onClick={continueWithGoogle}
        className="w-full py-2.5 rounded-xl nb-btn-secondary disabled:opacity-50 font-semibold text-sm transition-all hover:scale-[1.01] active:scale-[0.99] flex items-center justify-center gap-2"
      >
        {googleLoading ? (
          <Loader className="w-4 h-4 animate-spin" />
        ) : (
          <svg className="w-4 h-4" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
        )}
        Continue with Google
      </button>
      <p className="text-center nb-text-faint text-xs mt-2">If you already have (or create) an ICAN account with the email you applied with, your applications show up automatically.</p>

      {searched && !loading && (
        result ? (
          <>
            <div className="mt-5">
              <StatusCard
                jobTitle={result.job_title}
                companyName={result.company_name}
                submittedAt={result.submitted_at}
                status={result.status}
                statusNote={result.status_note}
                testAccessToken={result.test_access_token}
                interviewScheduleId={result.interview_schedule_id}
                interviewScheduledAt={result.interview_scheduled_at}
                documentId={result.document_id}
                documentStatus={result.document_status}
              />
            </div>
            <div className="mt-4 p-4 rounded-xl nb-surface-alt border nb-border text-left">
              <p className="nb-text font-semibold text-sm mb-1">💡 Never type that code again</p>
              <p className="nb-text-muted text-xs mb-3">Create a free ICAN account with this same contact and every application you've made here (and any future ones) shows up automatically when you sign in.</p>
              <button
                onClick={() => onWantAccount?.({ type: 'job', referenceCode: referenceCode.trim(), contact: contact.trim(), prefill: contact.includes('@') ? { email: contact.trim() } : { phone: contact.trim() } })}
                className="w-full py-2.5 rounded-lg nb-btn-primary font-semibold text-sm transition-all hover:scale-[1.01] active:scale-[0.99]"
              >
                Create my free account
              </button>
            </div>
          </>
        ) : (
          <p className="mt-5 text-center nb-text-faint text-sm animate-fadeIn">No application found for that reference code and contact. Double-check for typos.</p>
        )
      )}
    </div>
  );
};

const BID_STATUS_STYLES = {
  submitted: 'nb-chip-neutral',
  under_review: 'nb-chip-amber',
  shortlisted: 'nb-chip-teal',
  interview: 'nb-chip-green',
  selected: 'nb-chip-green-solid',
  rejected: 'nb-chip-maroon',
  withdrawn: 'nb-chip-neutral nb-chip-faded',
};

const BidStatusCard = ({ opportunityTitle, companyName, submittedAt, status, statusNote }) => (
  <div className="nb-card rounded-2xl shadow-sm p-4 animate-fadeInUp">
    <p className="nb-text font-semibold">{opportunityTitle}</p>
    <p className="text-xs nb-text-faint mb-3">{companyName ? `${companyName} · ` : ''}Bid {new Date(submittedAt).toLocaleDateString()}</p>
    <span className={`inline-block px-3 py-1 rounded-full text-sm font-bold capitalize ${BID_STATUS_STYLES[status] || BID_STATUS_STYLES.submitted}`}>
      {status.replace('_', ' ')}
    </span>
    {statusNote && <p className="text-sm nb-text-muted mt-3">{statusNote}</p>}
  </div>
);

// Mirrors TrackApplication exactly, one level down (opportunity bids instead
// of job applications) -- same reference-code-or-signed-in-account duality,
// same self-healing "my bids" lookup once signed in.
const TrackOpportunityBid = ({ viewerUser, onWantAccount }) => {
  const { signInWithGoogle } = useAuth();
  const [referenceCode, setReferenceCode] = useState('');
  const [contact, setContact] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const continueWithGoogle = async () => {
    setGoogleLoading(true);
    try { sessionStorage.setItem(PENDING_SECTION_KEY, 'track-bid'); } catch { /* ignore */ }
    try {
      await signInWithGoogle();
    } catch (err) {
      setError(err.message || 'Failed to continue with Google');
      setGoogleLoading(false);
    }
  };

  const [myBids, setMyBids] = useState(null);
  const [myBidsLoading, setMyBidsLoading] = useState(false);

  const inputClass = 'w-full px-3.5 py-2.5 rounded-xl nb-input transition';

  useEffect(() => {
    if (!viewerUser?.id) { setMyBids(null); return; }
    let cancelled = false;
    setMyBidsLoading(true);
    cmmsBusinessOpportunitiesService.getMyOpportunityBids().then((response) => {
      if (cancelled) return;
      setMyBids(response.success ? response.data : []);
      setMyBidsLoading(false);
    });
    return () => { cancelled = true; };
  }, [viewerUser?.id]);

  const search = async () => {
    if (!referenceCode.trim() || !contact.trim()) {
      setError('Enter your reference code and the email or phone you bid with.');
      return;
    }
    setLoading(true);
    setError('');
    setSearched(true);
    const response = await cmmsBusinessOpportunitiesService.trackPublicOpportunityBid(referenceCode.trim(), contact.trim());
    if (!response.success) setError(response.error || 'Something went wrong. Please try again.');
    setResult(response.data || null);
    setLoading(false);
  };

  if (viewerUser) {
    return (
      <div className="max-w-md mx-auto">
        <h2 className="text-xl font-bold nb-text mb-1">Track my bid</h2>
        <p className="text-sm nb-text-muted mb-5">Signed in as {viewerUser.email} -- no reference code needed.</p>
        {myBidsLoading ? (
          <div className="flex justify-center py-8"><Loader className="w-6 h-6 nb-link animate-spin" /></div>
        ) : !myBids || myBids.length === 0 ? (
          <p className="text-center nb-text-faint text-sm">No bids found for this email yet.</p>
        ) : (
          <div className="space-y-3">
            {myBids.map((bid) => (
              <BidStatusCard
                key={bid.id}
                opportunityTitle={bid.opportunity_title}
                companyName={bid.company_name}
                submittedAt={bid.created_at}
                status={bid.status}
                statusNote={bid.status_note}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto">
      <h2 className="text-xl font-bold nb-text mb-1">Track my bid</h2>
      <p className="text-sm nb-text-muted mb-5">Enter the reference code you received, plus the email or phone you bid with.</p>
      <div className="space-y-3">
        <input value={referenceCode} onChange={(e) => setReferenceCode(e.target.value)} placeholder="Reference code (e.g. BID-A1B2C3D4)" className={`${inputClass} font-mono`} />
        <input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Email or phone used to bid" className={inputClass} />
        {error && <p className="nb-error-text text-sm">{error}</p>}
        <button
          disabled={loading}
          onClick={search}
          className="w-full py-3 rounded-xl nb-btn-primary disabled:opacity-50 font-semibold transition-all hover:scale-[1.01] active:scale-[0.99] shadow-sm flex items-center justify-center gap-2"
        >
          {loading ? <Loader className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} {loading ? 'Searching…' : 'Check status'}
        </button>
      </div>

      <div className="relative my-5">
        <div className="absolute inset-0 flex items-center"><div className="w-full border-t nb-border"></div></div>
        <div className="relative flex justify-center text-xs"><span className="px-3 nb-surface nb-text-faint">Or, no code needed</span></div>
      </div>
      <button
        disabled={googleLoading}
        onClick={continueWithGoogle}
        className="w-full py-2.5 rounded-xl nb-btn-secondary disabled:opacity-50 font-semibold text-sm transition-all hover:scale-[1.01] active:scale-[0.99] flex items-center justify-center gap-2"
      >
        {googleLoading ? (
          <Loader className="w-4 h-4 animate-spin" />
        ) : (
          <svg className="w-4 h-4" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
        )}
        Continue with Google
      </button>
      <p className="text-center nb-text-faint text-xs mt-2">If you already have (or create) an ICAN account with the email or phone you bid with, your bids show up automatically.</p>

      {searched && !loading && (
        result ? (
          <>
            <div className="mt-5">
              <BidStatusCard
                opportunityTitle={result.opportunity_title}
                companyName={result.company_name}
                submittedAt={result.submitted_at}
                status={result.status}
                statusNote={result.status_note}
              />
            </div>
            <div className="mt-4 p-4 rounded-xl nb-surface-alt border nb-border text-left">
              <p className="nb-text font-semibold text-sm mb-1">💡 Never type that code again</p>
              <p className="nb-text-muted text-xs mb-3">Create a free ICAN account with this same contact and every bid you've placed (and any future ones) shows up automatically when you sign in.</p>
              <button
                onClick={() => onWantAccount?.({ type: 'bid', referenceCode: referenceCode.trim(), contact: contact.trim(), prefill: contact.includes('@') ? { email: contact.trim() } : { phone: contact.trim() } })}
                className="w-full py-2.5 rounded-lg nb-btn-primary font-semibold text-sm transition-all hover:scale-[1.01] active:scale-[0.99]"
              >
                Create my free account
              </button>
            </div>
          </>
        ) : (
          <p className="mt-5 text-center nb-text-faint text-sm animate-fadeIn">No bid found for that reference code and contact. Double-check for typos.</p>
        )
      )}
    </div>
  );
};

// Fades the backdrop in immediately but scales+fades the panel itself in a
// beat later via a mount-triggered class flip -- purely CSS transitions, no
// animation library, matching the rest of this component.
const Modal = ({ onClose, children }) => {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div className={`icanera-nb fixed inset-0 nb-modal-backdrop backdrop-blur-sm z-50 overflow-y-auto transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0'}`}>
      <div
        className="min-h-screen flex items-start justify-center p-4"
        style={{ paddingBottom: 'max(4rem, calc(env(safe-area-inset-bottom) + 2rem))' }}
      >
        <div
          className={`nb-surface w-full max-w-lg p-6 my-8 rounded-2xl shadow-2xl border nb-border relative transition-all duration-200 ${visible ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 translate-y-2'}`}
        >
          <button onClick={onClose} className="absolute top-4 right-4 nb-text-faint hover:opacity-80 transition-colors p-1 rounded-full nb-share-btn">
            <X className="w-5 h-5" />
          </button>
          {children}
        </div>
      </div>
    </div>
  );
};

export default PublicCompanyNoticeBoard;

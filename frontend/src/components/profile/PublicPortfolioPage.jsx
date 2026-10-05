import React, { useEffect, useMemo, useState } from 'react';
import {
  X, ShieldCheck, Briefcase, Award, GraduationCap, FolderKanban, Rocket,
  FlaskConical, Presentation, Loader2, Sparkles, MapPin, Phone, Mail,
  Users, PhoneCall, Video, MessageCircle, ExternalLink, ArrowRight, MessageSquare, FileText, Printer,
} from 'lucide-react';
import { fmtRelativeTime } from '../landing/relativeTime';
import { getOrCreatePortfolioGuestId } from '../../utils/portfolioGuestId';
import PortfolioChatPanel from './PortfolioChatPanel';
import PortfolioMessagesInbox from './PortfolioMessagesInbox';
import CertificateRequestModal from './CertificateRequestModal';
import { getPublicPortfolio } from '../../services/portfolioService';
import { useAuth } from '../../context/AuthContext';
import { useDirectCall } from '../../hooks/useDirectCall';
import CallDock from '../calls/CallDock';
import RatingWidget from './RatingWidget';
import ImageLightbox from '../common/ImageLightbox';

const ITEM_ICONS = {
  experience: Briefcase,
  entrepreneurship: Rocket,
  research: FlaskConical,
  achievement: Award,
  education: GraduationCap,
  project: FolderKanban,
  presentation: Presentation,
};

// Resume-style sections, in display order. Each pulls its rows from `items`
// by item_type; `achievement`/`project` share one catch-all section so older
// data (created before entrepreneurship/research/presentation existed)
// still has somewhere to land.
const SECTIONS = [
  { key: 'work', title: 'Technical Experience & Entrepreneurship', types: ['experience', 'entrepreneurship'] },
  { key: 'research', title: 'Research & Innovation', types: ['research'] },
  { key: 'education', title: 'Education', types: ['education'] },
  { key: 'achievements', title: 'Achievements & Projects', types: ['achievement', 'project'] },
  { key: 'presentations', title: 'Presentations & Competitions', types: ['presentation'] },
];

function formatMonthYear(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

function formatDateRange(item) {
  const start = formatMonthYear(item.start_date);
  if (!start) return '';
  const end = item.end_date ? formatMonthYear(item.end_date) : 'Present';
  return `${start} – ${end}`;
}

function DescriptionBlock({ text }) {
  if (!text) return null;
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length > 1) {
    return (
      <ul className="mt-2 space-y-1.5 text-sm text-slate-400 leading-relaxed">
        {lines.map((line, i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-[0.55rem] w-1 h-1 rounded-full bg-[#c4a052] flex-shrink-0" aria-hidden="true" />
            <span className="min-w-0 break-words">{line}</span>
          </li>
        ))}
      </ul>
    );
  }
  return <p className="text-sm text-slate-400 mt-2 leading-relaxed break-words">{text}</p>;
}

// One read-only "Update" card on the public resume page — the owner's own
// active (non-expired, public-visibility) status posts only. Tapping an
// image opens it fullscreen via ImageLightbox (see onOpenImage); video
// keeps its own native controls instead.
function StatusCard({ status, onOpenImage }) {
  const hasMedia = Boolean(status.media_url && String(status.media_url).trim());
  const kind = !hasMedia ? 'text' : status.media_type === 'video' ? 'video' : 'image';

  return (
    <div className="relative w-32 h-56 shrink-0 snap-start rounded-xl overflow-hidden border border-[#c4a052]/30 bg-slate-900">
      {kind === 'video' && (
        <video src={status.media_url} className="w-full h-full object-cover" muted playsInline preload="none" controls />
      )}
      {kind === 'image' && (
        <img
          src={status.media_url}
          alt={status.caption || 'Update'}
          className="w-full h-full object-cover cursor-pointer"
          loading="lazy"
          onClick={() => onOpenImage?.(status.media_url, status.caption || 'Update')}
        />
      )}
      {kind === 'text' && (
        <div
          style={{ backgroundColor: status.background_color || '#6366f1' }}
          className="w-full h-full flex items-center justify-center p-4"
        >
          {status.caption ? (
            <p className="text-white text-center text-sm font-medium line-clamp-4">{status.caption}</p>
          ) : (
            <MessageSquare className="w-6 h-6 text-white/70" />
          )}
        </div>
      )}
      <div className="absolute inset-x-0 top-0 flex items-center gap-1.5 p-2 bg-gradient-to-b from-black/60 to-transparent pointer-events-none">
        <span className="text-[10px] text-white/90 font-semibold">{fmtRelativeTime(status.created_at)}</span>
      </div>
      {kind !== 'text' && status.caption && (
        <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/70 to-transparent pointer-events-none">
          <p className="text-[11px] text-white line-clamp-2">{status.caption}</p>
        </div>
      )}
    </div>
  );
}

function SectionHeading({ children }) {
  return <div className="rz-section-title"><h2 className="rz-serif text-lg font-bold text-white">{children}</h2></div>;
}

function ContactPill({ icon: Icon, href, children }) {
  const cls = 'inline-flex items-center gap-2 min-h-[40px] max-w-full px-3.5 py-1.5 rounded-full border border-[#c4a052]/30 bg-[#c4a052]/[0.06] text-sm text-slate-300 break-all';
  const inner = (<><Icon className="w-4 h-4 text-[#c4a052] flex-shrink-0" /><span className="min-w-0">{children}</span></>);
  return href
    ? <a href={href} className={`${cls} hover:border-[#c4a052]/70 hover:text-white transition-colors`}>{inner}</a>
    : <span className={cls}>{inner}</span>;
}

/**
 * Read-only public resume/portfolio page.
 * - As a real unauthenticated URL: App.jsx renders this when the path is
 *   /portfolio/<handle>, reading the handle from window.location.
 * - In-app: rendered as an overlay with a `handle` prop + `onClose`, e.g.
 *   from the Professionals directory or the "Preview" button in the My
 *   Resume tab.
 */
export default function PublicPortfolioPage({ handle: handleProp, onClose }) {
  const { user, profile: viewerProfile, signInWithGoogle } = useAuth();
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [guestName, setGuestName] = useState('');
  const [lightbox, setLightbox] = useState(null);

  const handle = handleProp || window.location.pathname.replace(/^\/portfolio\//, '').replace(/\/$/, '');

  const load = async () => {
    setIsLoading(true);
    setNotFound(false);
    try {
      const result = await getPublicPortfolio(handle);
      if (!result) {
        setNotFound(true);
      } else {
        setData(result);
      }
    } catch (err) {
      console.error('Error loading public portfolio:', err);
      setNotFound(true);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle]);

  // Lets a visitor ring the professional straight from their public page,
  // reusing the same `community:<authId>` room convention ChatWidget's
  // Community tab already dials into for 1:1 calls — the professional
  // answers on whatever device already has the app open.
  const guestId = useMemo(() => getOrCreatePortfolioGuestId(), []);
  const viewerId = user?.id || guestId;
  const viewerName = viewerProfile?.full_name || guestName.trim() || 'A visitor from your portfolio';
  const call = useDirectCall({ roomId: `portfolio-visitor:${viewerId}`, selfId: viewerId, selfName: viewerName });
  const [showChat, setShowChat] = useState(false);
  const [showCertificateRequest, setShowCertificateRequest] = useState(false);

  const isOwnProfile = Boolean(user?.id && data?.profile?.id && user.id === data.profile.id);

  // "Create your own IcanEra portfolio" — signed-in visitors jump straight to
  // their own My Resume tab (instantly if the app shell is already mounted
  // around us, e.g. the overlay usage; otherwise via a one-time flag the
  // main app's mount effect picks up after the page reloads). Signed-out
  // visitors go straight to Google -- the fastest path for a casual "I want
  // one too" click, no form to fill in first -- and land on My Resume the
  // same way once their account exists via the same flag, which survives
  // the OAuth redirect round-trip in sessionStorage. Falls back to the
  // plain sign-up form only if Google sign-in couldn't even be started.
  const startOwnPortfolio = async () => {
    try { window.sessionStorage.setItem('ican_pending_start_tab', 'resume'); } catch (_) { /* storage unavailable */ }
    if (!user) {
      try {
        await signInWithGoogle();
      } catch (_) {
        window.location.href = '/?auth=signup';
      }
      return;
    }
    if (onClose) {
      onClose();
      window.dispatchEvent(new CustomEvent('ican-open-resume-tab'));
    } else {
      window.location.href = '/';
    }
  };

  // Overlay chrome (close button, fixed positioning) only applies when a
  // caller gives us a way to close — the in-app preview/directory usages.
  // The real /portfolio/<handle> route (main.jsx) passes `handle` with no
  // `onClose` and should render as a plain full page.
  const isOverlay = Boolean(onClose);

  const itemsByType = useMemo(() => {
    const map = {};
    for (const item of data?.items || []) {
      (map[item.item_type] = map[item.item_type] || []).push(item);
    }
    return map;
  }, [data?.items]);

  const contactLine = data?.portfolio
    ? [data.portfolio.location, data.portfolio.phone, data.portfolio.contact_email].filter(Boolean)
    : [];

  const links = useMemo(() => {
    const raw = data?.portfolio?.links;
    if (!raw || typeof raw !== 'object') return [];
    return Object.entries(raw)
      .filter(([, url]) => typeof url === 'string' && url.trim())
      .map(([label, url]) => {
        const trimmed = url.trim();
        return { label, url: /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}` };
      });
  }, [data?.portfolio?.links]);

  const firstName = data?.profile?.full_name?.split(' ')[0] || 'them';

  const content = (
    <div className="rz pp-page relative min-h-[100dvh] text-slate-200 overflow-hidden">
      {/* Overlay chrome — slim sticky bar so the close button is always reachable */}
      {isOverlay && (
        <div className="pp-noprint sticky top-0 z-30 flex items-center justify-between gap-3 px-4 pb-2.5 pt-[calc(0.65rem+env(safe-area-inset-top))] pp-bar">
          <p className="rz-eyebrow">IcanEra · Resume</p>
          <button onClick={onClose} className="icn-page-close" aria-label="Close resume"><X /></button>
        </div>
      )}

      <div className="relative max-w-3xl mx-auto px-4 pt-5 pb-10 sm:pt-10 sm:pb-14">
        {isLoading && (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
            <Loader2 className="w-6 h-6 animate-spin text-[#c4a052]" />
            <p className="rz-serif text-[#e6c980]">Loading resume…</p>
          </div>
        )}

        {!isLoading && notFound && (
          <div className="text-center py-24 animate-fadeIn">
            <Users className="w-10 h-10 mx-auto mb-4 text-[#c4a052]/70" />
            <p className="rz-serif text-2xl font-bold mb-2 text-white">Profile not found</p>
            <p className="text-slate-400 text-sm">This IcanEra resume link isn't available or was made private.</p>
          </div>
        )}

        {!isLoading && data && (
          <>
            {/* Masthead */}
            <header className="rz-card animate-fadeInDown">
              <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 sm:gap-6 text-center sm:text-left">
                <div className="flex-shrink-0">
                  {data.profile.avatar_url ? (
                    <img
                      src={data.profile.avatar_url}
                      alt={data.profile.full_name}
                      className="w-28 h-28 sm:w-32 sm:h-32 rounded-full object-cover border-2 border-[#c4a052]/70 shadow-xl cursor-pointer"
                      onClick={() => setLightbox({ src: data.profile.avatar_url, alt: data.profile.full_name })}
                    />
                  ) : (
                    <div className="rz-serif w-28 h-28 sm:w-32 sm:h-32 rounded-full flex items-center justify-center text-4xl font-bold text-[#1c1408] bg-gradient-to-br from-[#e6c980] to-[#a17c28] shadow-xl">
                      {(data.profile.full_name || 'U').charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="rz-eyebrow">Curriculum Vitae</p>
                  <h1 className="rz-serif text-3xl sm:text-4xl font-bold text-white leading-tight break-words mt-0.5">
                    {data.profile.full_name}
                  </h1>
                  <div className="mt-2 flex flex-wrap items-center justify-center sm:justify-start gap-2">
                    <span className="text-sm font-medium text-[#c4a052]">@{data.profile.handle}</span>
                    {data.profile.is_verified ? (
                      <span className="rz-badge text-emerald-300 bg-emerald-500/10 border border-emerald-500/30">
                        <ShieldCheck className="w-3.5 h-3.5" /> Verified
                      </span>
                    ) : (
                      <span className="rz-badge text-slate-400 bg-slate-500/10 border border-slate-500/25">
                        <ShieldCheck className="w-3.5 h-3.5" /> Not yet verified
                      </span>
                    )}
                  </div>
                  {data.portfolio?.headline && (
                    <p className="mt-3 text-base text-slate-300 leading-relaxed break-words">{data.portfolio.headline}</p>
                  )}
                </div>
              </div>

              {(contactLine.length > 0 || links.length > 0) && <div className="rz-rule" />}

              {contactLine.length > 0 && (
                <div className="flex flex-wrap justify-center sm:justify-start gap-2">
                  {data.portfolio.location && <ContactPill icon={MapPin}>{data.portfolio.location}</ContactPill>}
                  {data.portfolio.phone && <ContactPill icon={Phone} href={`tel:${data.portfolio.phone.replace(/\s+/g, '')}`}>{data.portfolio.phone}</ContactPill>}
                  {data.portfolio.contact_email && <ContactPill icon={Mail} href={`mailto:${data.portfolio.contact_email}`}>{data.portfolio.contact_email}</ContactPill>}
                </div>
              )}

              {/* Links — LinkedIn, personal site, GitHub, anything the owner added */}
              {links.length > 0 && (
                <div className={`flex flex-wrap justify-center sm:justify-start gap-2 ${contactLine.length > 0 ? 'mt-2' : ''}`}>
                  {links.map((link) => (
                    <a
                      key={link.label}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rz-btn rz-btn-ghost rz-btn-sm"
                    >
                      <ExternalLink className="w-3.5 h-3.5" /> {link.label}
                    </a>
                  ))}
                </div>
              )}

              <div className="pp-noprint mt-4 flex justify-center sm:justify-end">
                <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-[#e6c980] transition-colors min-h-[36px] px-2">
                  <Printer className="w-3.5 h-3.5" /> Save as PDF / print
                </button>
              </div>
            </header>

            <div className="mt-6 space-y-8">

            {/* Owner's own live Updates (24h status posts) — scoped server-side
                to this profile's user_id, and RLS further restricts a
                non-owner viewer to visibility='public' rows only, so this can
                only ever show updates that belong to this profile's owner.
                When the owner is looking at their own page, their direct-
                message inbox (PortfolioMessagesInbox — same component used
                in the dashboard's My Resume tab) sits alongside it in the
                same row, so they don't have to leave this page to see
                messages visitors have sent them here. */}
            {(data.statuses?.length > 0 || isOwnProfile) && (
              <section
                className={`pp-noprint animate-fadeInUp ${isOwnProfile ? 'grid grid-cols-1 sm:grid-cols-2 gap-4 items-start' : ''}`}
                style={{ animationDelay: '0.07s', animationFillMode: 'backwards' }}
              >
                {data.statuses?.length > 0 && (
                  <div>
                    <SectionHeading>Recent Updates</SectionHeading>
                    <div className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory">
                      {data.statuses.map((status) => (
                        <StatusCard key={status.id} status={status} onOpenImage={(src, alt) => setLightbox({ src, alt })} />
                      ))}
                    </div>
                  </div>
                )}
                {isOwnProfile && <div className="rz-dark"><PortfolioMessagesInbox userId={data.profile.id} /></div>}
              </section>
            )}

            {/* Get in touch — call / message / certificate request. Lets a
                client reach this professional directly from their resume page. */}
            {!isOwnProfile && (
              <section
                className="pp-noprint rz-card animate-fadeIn"
                style={{ animationDelay: '0.08s', animationFillMode: 'backwards' }}
              >
                {call.callState === 'idle' ? (
                  <>
                    <div className="rz-section-title !mb-3"><h2 className="rz-serif text-lg font-bold text-white">Get in touch</h2></div>
                    {!user && (
                      <div className="mb-3">
                        <label className="rz-label" htmlFor="pp-guest-name">Your name</label>
                        <input
                          id="pp-guest-name"
                          value={guestName}
                          onChange={(e) => setGuestName(e.target.value)}
                          placeholder="So they know who is calling or writing"
                          className="rz-input"
                        />
                      </div>
                    )}
                    <button onClick={() => setShowChat(true)} className="rz-btn rz-btn-primary w-full">
                      <MessageCircle className="w-4 h-4" /> Message {firstName}
                    </button>
                    <div className="grid grid-cols-3 gap-2 mt-2">
                      <button onClick={() => call.startCall(false, viewerName, `community:${data.profile.id}`)} className="rz-btn rz-btn-ghost rz-btn-sm !flex-col !gap-1 !py-2 !h-auto">
                        <PhoneCall className="w-4 h-4" /> <span>Call</span>
                      </button>
                      <button onClick={() => call.startCall(true, viewerName, `community:${data.profile.id}`)} className="rz-btn rz-btn-ghost rz-btn-sm !flex-col !gap-1 !py-2 !h-auto">
                        <Video className="w-4 h-4" /> <span>Video</span>
                      </button>
                      <button onClick={() => setShowCertificateRequest(true)} className="rz-btn rz-btn-ghost rz-btn-sm !flex-col !gap-1 !py-2 !h-auto">
                        <FileText className="w-4 h-4" /> <span>Certificate</span>
                      </button>
                    </div>
                    <p className="rz-hint mt-3">
                      Calls connect only while {firstName === 'them' ? 'they have' : `${firstName} has`} IcanEra open — if there's no answer, send a message instead.
                    </p>
                  </>
                ) : (
                  <div className="rz-dark"><CallDock call={call} dark tint="indigo" /></div>
                )}
              </section>
            )}

            {showChat && !isOwnProfile && (
              <PortfolioChatPanel
                ownerUserId={data.profile.id}
                ownerName={data.profile.full_name}
                guestId={guestId}
                guestName={guestName}
                onGuestNameChange={setGuestName}
                onClose={() => setShowChat(false)}
              />
            )}

            {showCertificateRequest && !isOwnProfile && (
              <CertificateRequestModal
                ownerUserId={data.profile.id}
                ownerName={data.profile.full_name}
                guestId={guestId}
                guestName={guestName}
                onGuestNameChange={setGuestName}
                onClose={() => setShowCertificateRequest(false)}
              />
            )}

            {data.portfolio?.summary && (
              <section className="animate-fadeInUp" style={{ animationDelay: '0.1s', animationFillMode: 'backwards' }}>
                <SectionHeading>Professional Summary</SectionHeading>
                <p className="text-slate-300 leading-relaxed whitespace-pre-wrap break-words">{data.portfolio.summary}</p>
              </section>
            )}

            {data.portfolio?.skills?.length > 0 && (
              <section className="animate-fadeInUp" style={{ animationDelay: '0.2s', animationFillMode: 'backwards' }}>
                <SectionHeading>Core Competencies &amp; Technical Skills</SectionHeading>
                <div className="flex flex-wrap gap-2">
                  {data.portfolio.skills.map((skill) => (
                    <span key={skill} className="rz-chip">{skill}</span>
                  ))}
                </div>
              </section>
            )}

            {data.items.length === 0 && !data.portfolio?.summary && !data.portfolio?.skills?.length && (
              <div className="rz-card rz-empty animate-fadeIn">
                <FileText className="w-8 h-8 mx-auto text-[#c4a052]/70" />
                <p className="rz-serif">Resume coming soon</p>
                <p className="text-sm">{data.profile.full_name} hasn't added their resume details yet — check back soon.</p>
              </div>
            )}

            {SECTIONS.map((section, sIdx) => {
              const sectionItems = section.types.flatMap((t) => itemsByType[t] || []);
              if (sectionItems.length === 0) return null;
              return (
                <section
                  key={section.key}
                  className="animate-fadeInUp"
                  style={{ animationDelay: `${0.3 + sIdx * 0.05}s`, animationFillMode: 'backwards' }}
                >
                  <SectionHeading>{section.title}</SectionHeading>
                  <ol className="rz-timeline">
                    {sectionItems.map((item) => {
                      const dateRange = formatDateRange(item);
                      return (
                        <li key={item.id} className="pp-avoid-break">
                          {dateRange && <p className="text-[0.7rem] font-semibold tracking-wider uppercase text-[#e6c980]">{dateRange}</p>}
                          <h3 className="rz-serif text-lg font-bold text-white leading-snug break-words">{item.title}</h3>
                          {item.org_name && <p className="text-sm text-slate-300 break-words">{item.org_name}</p>}
                          {item.source === 'cmms' && (
                            <span className="rz-badge mt-1.5 text-blue-300 bg-blue-500/10 border border-blue-500/30">Auto · CMMS</span>
                          )}
                          <DescriptionBlock text={item.description} />
                        </li>
                      );
                    })}
                  </ol>
                </section>
              );
            })}

            {data.references?.length > 0 && (
              <section className="animate-fadeInUp" style={{ animationDelay: '0.55s', animationFillMode: 'backwards' }}>
                <SectionHeading>References</SectionHeading>
                <div className="grid sm:grid-cols-2 gap-3">
                  {data.references.map((ref) => (
                    <div key={ref.id} className="pp-avoid-break p-4 rounded-xl bg-[#c4a052]/[0.05] border border-[#c4a052]/25">
                      <h3 className="rz-serif text-base font-bold text-white leading-snug break-words">{ref.name}</h3>
                      {(ref.title || ref.organization) && (
                        <p className="text-sm text-[#e6c980]/90 mt-0.5 break-words">{[ref.title, ref.organization].filter(Boolean).join(' — ')}</p>
                      )}
                      <div className="mt-2 space-y-1 text-sm text-slate-400">
                        {ref.email && <a href={`mailto:${ref.email}`} className="flex items-center gap-1.5 hover:text-white break-all"><Mail className="w-3.5 h-3.5 text-[#c4a052] flex-shrink-0" />{ref.email}</a>}
                        {ref.phone && <a href={`tel:${ref.phone.replace(/\s+/g, '')}`} className="flex items-center gap-1.5 hover:text-white"><Phone className="w-3.5 h-3.5 text-[#c4a052] flex-shrink-0" />{ref.phone}</a>}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <div className="pp-noprint rz-dark animate-fadeInUp" style={{ animationDelay: '0.6s', animationFillMode: 'backwards' }}>
              <RatingWidget
                rateeUserId={data.profile.id}
                ratingSummary={data.ratingSummary}
                ratings={data.ratings}
                onRated={load}
              />
            </div>

            {/* Recommend IcanEra — invite the visitor to build the same page */}
            {!isOwnProfile && (
              <section
                className="pp-noprint rz-card text-center animate-fadeIn"
                style={{ animationDelay: '0.65s', animationFillMode: 'backwards' }}
              >
                <p className="rz-eyebrow">IcanEra</p>
                <p className="rz-serif text-xl font-bold text-white mt-1">Build a resume like this one</p>
                <p className="text-sm text-slate-400 mt-1 mb-4">Free, shareable, and ready in minutes.</p>
                <button onClick={startOwnPortfolio} className="rz-btn rz-btn-primary">
                  Create your own <ArrowRight className="w-4 h-4" />
                </button>
              </section>
            )}
            </div>

            <footer className="mt-10 text-center">
              <div className="rz-rule" />
              <p className="text-xs text-slate-500">Powered by <span className="rz-serif font-bold text-[#e6c980]">IcanEra</span></p>
            </footer>
          </>
        )}
      </div>
      {lightbox && <ImageLightbox src={lightbox.src} alt={lightbox.alt} onClose={() => setLightbox(null)} />}
    </div>
  );

  if (!isOverlay) return content;

  return <div className="fixed inset-0 z-50 overflow-y-auto">{content}</div>;
}

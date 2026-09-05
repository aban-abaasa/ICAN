import React, { useEffect, useMemo, useState } from 'react';
import {
  X, ShieldCheck, Briefcase, Award, GraduationCap, FolderKanban, Rocket,
  FlaskConical, Presentation, Loader2, Sparkles, MapPin, Phone, Mail,
  Users, PhoneCall, Video, MessageCircle, ExternalLink, ArrowRight, MessageSquare,
} from 'lucide-react';
import { fmtRelativeTime } from '../landing/relativeTime';
import { getOrCreatePortfolioGuestId } from '../../utils/portfolioGuestId';
import PortfolioChatPanel from './PortfolioChatPanel';
import { getPublicPortfolio } from '../../services/portfolioService';
import { useAuth } from '../../context/AuthContext';
import { useDirectCall } from '../../hooks/useDirectCall';
import CallDock from '../calls/CallDock';
import RatingWidget from './RatingWidget';

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
      <ul className="mt-1.5 space-y-1 list-disc list-inside text-sm text-slate-400">
        {lines.map((line, i) => <li key={i}>{line}</li>)}
      </ul>
    );
  }
  return <p className="text-sm text-slate-400 mt-1.5">{text}</p>;
}

// One read-only "Update" card on the public resume page — the owner's own
// active (non-expired, public-visibility) status posts only. Never
// interactive/click-to-open here; visitors just see what's currently live.
function StatusCard({ status }) {
  const hasMedia = Boolean(status.media_url && String(status.media_url).trim());
  const kind = !hasMedia ? 'text' : status.media_type === 'video' ? 'video' : 'image';

  return (
    <div className="relative w-32 h-56 shrink-0 snap-start rounded-xl overflow-hidden border border-slate-800 bg-slate-900">
      {kind === 'video' && (
        <video src={status.media_url} className="w-full h-full object-cover" muted playsInline preload="none" controls />
      )}
      {kind === 'image' && (
        <img src={status.media_url} alt={status.caption || 'Update'} className="w-full h-full object-cover" loading="lazy" />
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
  return (
    <h2 className="text-base font-semibold text-slate-100 mb-3 pb-2 border-b border-slate-800 flex items-center gap-2">
      <span className="w-1 h-4 rounded-full bg-indigo-500" />
      {children}
    </h2>
  );
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
  const { user, profile: viewerProfile } = useAuth();
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [guestName, setGuestName] = useState('');

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

  const isOwnProfile = Boolean(user?.id && data?.profile?.id && user.id === data.profile.id);

  // "Create your own IcanEra portfolio" — signed-in visitors jump straight to
  // their own My Resume tab (instantly if the app shell is already mounted
  // around us, e.g. the overlay usage; otherwise via a one-time flag the
  // main app's mount effect picks up after the page reloads). Signed-out
  // visitors go to sign-up first; the same flag carries through so they land
  // on My Resume the moment their account exists, not on the dashboard.
  const startOwnPortfolio = () => {
    try { window.sessionStorage.setItem('ican_pending_start_tab', 'resume'); } catch (_) { /* storage unavailable */ }
    if (!user) {
      window.location.href = '/?auth=signup';
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

  const content = (
    <div className="relative min-h-[100dvh] bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-200 overflow-hidden">
      {/* Subtle ambient glow — restrained, professional accent rather than a busy gradient */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-24 -left-24 w-72 h-72 bg-indigo-600/10 rounded-full blur-3xl" />
        <div className="absolute top-1/3 -right-24 w-80 h-80 bg-teal-500/10 rounded-full blur-3xl" />
      </div>

      <div className="relative max-w-3xl mx-auto px-4 py-8 sm:py-12">
        {isOverlay && (
          <button onClick={onClose} className="mb-4 p-2 rounded-lg hover:bg-white/5 transition-colors">
            <X className="w-5 h-5" />
          </button>
        )}

        {isLoading && (
          <div className="flex items-center justify-center py-24 text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading portfolio...
          </div>
        )}

        {!isLoading && notFound && (
          <div className="text-center py-24 animate-fadeIn">
            <p className="text-xl font-semibold mb-2 text-slate-100">Profile not found</p>
            <p className="text-slate-400 text-sm">This IcanEra portfolio link isn't available or was made private.</p>
          </div>
        )}

        {!isLoading && data && (
          <>
            <div className="flex items-center gap-4 mb-3 animate-fadeInDown">
              <div className="relative flex-shrink-0">
                {data.profile.avatar_url ? (
                  <img
                    src={data.profile.avatar_url}
                    alt={data.profile.full_name}
                    className="w-24 h-24 rounded-full object-cover ring-2 ring-slate-700"
                  />
                ) : (
                  <div className="w-24 h-24 rounded-full bg-gradient-to-br from-slate-700 to-indigo-700 flex items-center justify-center text-3xl font-bold text-white ring-2 ring-slate-700">
                    {(data.profile.full_name || 'U').charAt(0)}
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-2xl font-bold text-white truncate">
                    {data.profile.full_name}
                  </h1>
                  {data.profile.is_verified ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-medium">
                      <ShieldCheck className="w-3.5 h-3.5" /> Verified
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-800/60 border border-slate-700 text-slate-400 text-xs font-medium">
                      <ShieldCheck className="w-3.5 h-3.5" /> Not yet verified
                    </span>
                  )}
                </div>
                <p className="text-indigo-300/80 text-sm">@{data.profile.handle}</p>
                {data.portfolio?.headline && (
                  <p className="text-slate-300 mt-1 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />
                    {data.portfolio.headline}
                  </p>
                )}
              </div>
            </div>

            {/* Resume-style contact line */}
            {contactLine.length > 0 && (
              <div
                className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-3 text-xs text-slate-400 animate-fadeIn"
                style={{ animationDelay: '0.05s', animationFillMode: 'backwards' }}
              >
                {data.portfolio.location && (
                  <span className="inline-flex items-center gap-1"><MapPin className="w-3.5 h-3.5 text-indigo-400" /> {data.portfolio.location}</span>
                )}
                {data.portfolio.phone && (
                  <span className="inline-flex items-center gap-1"><Phone className="w-3.5 h-3.5 text-indigo-400" /> {data.portfolio.phone}</span>
                )}
                {data.portfolio.contact_email && (
                  <span className="inline-flex items-center gap-1"><Mail className="w-3.5 h-3.5 text-indigo-400" /> {data.portfolio.contact_email}</span>
                )}
              </div>
            )}

            {/* Links — LinkedIn, personal site, GitHub, anything the owner added */}
            {links.length > 0 && (
              <div
                className="flex flex-wrap items-center gap-2 mb-6 animate-fadeIn"
                style={{ animationDelay: '0.06s', animationFillMode: 'backwards' }}
              >
                {links.map((link) => (
                  <a
                    key={link.label}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-800/60 border border-slate-700 text-xs text-slate-300 hover:border-indigo-400/60 hover:text-white transition-colors"
                  >
                    <ExternalLink className="w-3 h-3" /> {link.label}
                  </a>
                ))}
              </div>
            )}
            {links.length === 0 && contactLine.length === 0 && <div className="mb-6" />}

            {/* Owner's own live Updates (24h status posts) — scoped server-side
                to this profile's user_id, and RLS further restricts a
                non-owner viewer to visibility='public' rows only, so this can
                only ever show updates that belong to this profile's owner. */}
            {data.statuses?.length > 0 && (
              <div
                className="mb-8 animate-fadeInUp"
                style={{ animationDelay: '0.07s', animationFillMode: 'backwards' }}
              >
                <SectionHeading>Recent Updates</SectionHeading>
                <div className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory">
                  {data.statuses.map((status) => (
                    <StatusCard key={status.id} status={status} />
                  ))}
                </div>
              </div>
            )}

            {/* Call / community-chat action bar — lets a client reach this
                professional directly from their resume page. */}
            {!isOwnProfile && (
              <div
                className="mb-6 p-3 rounded-xl bg-slate-900/70 border border-slate-800 animate-fadeIn"
                style={{ animationDelay: '0.08s', animationFillMode: 'backwards' }}
              >
                {call.callState === 'idle' ? (
                  <div className="flex flex-wrap items-center gap-2">
                    {!user && (
                      <input
                        value={guestName}
                        onChange={(e) => setGuestName(e.target.value)}
                        placeholder="Your name (for calls & messages)"
                        className="min-w-0 flex-1 px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-white placeholder-slate-500 text-xs focus:outline-none focus:border-indigo-500/60"
                      />
                    )}
                    <button
                      onClick={() => call.startCall(false, viewerName, `community:${data.profile.id}`)}
                      className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg transition-colors"
                    >
                      <PhoneCall className="w-3.5 h-3.5" /> Call {data.profile.full_name?.split(' ')[0] || 'them'}
                    </button>
                    <button
                      onClick={() => call.startCall(true, viewerName, `community:${data.profile.id}`)}
                      className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white text-xs font-medium rounded-lg transition-colors"
                    >
                      <Video className="w-3.5 h-3.5" /> Video Call
                    </button>
                    <button
                      onClick={() => setShowChat(true)}
                      className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white text-xs font-medium rounded-lg transition-colors"
                    >
                      <MessageCircle className="w-3.5 h-3.5" /> Message {data.profile.full_name?.split(' ')[0] || 'them'}
                    </button>
                  </div>
                ) : (
                  <CallDock call={call} dark tint="indigo" />
                )}
                {call.callState === 'idle' && (
                  <p className="text-[11px] text-slate-500 mt-2">
                    Calls connect only while {data.profile.full_name?.split(' ')[0] || 'they'} has IcanEra open — if there's no answer, send a message instead.
                  </p>
                )}
              </div>
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

            {data.portfolio?.summary && (
              <div
                className="mb-6 animate-fadeInUp"
                style={{ animationDelay: '0.1s', animationFillMode: 'backwards' }}
              >
                <SectionHeading>Professional Summary</SectionHeading>
                <p className="text-slate-300 leading-relaxed whitespace-pre-wrap">{data.portfolio.summary}</p>
              </div>
            )}

            {data.portfolio?.skills?.length > 0 && (
              <div
                className="mb-8 animate-fadeInUp"
                style={{ animationDelay: '0.2s', animationFillMode: 'backwards' }}
              >
                <SectionHeading>Core Competencies &amp; Technical Skills</SectionHeading>
                <div className="flex flex-wrap gap-2">
                  {data.portfolio.skills.map((skill) => (
                    <span
                      key={skill}
                      className="px-3 py-1 bg-slate-800/70 border border-slate-700 rounded-full text-xs text-slate-200 hover:border-indigo-400/60 hover:text-white transition-colors cursor-default"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {data.items.length === 0 && !data.portfolio?.summary && !data.portfolio?.skills?.length && (
              <div
                className="mb-8 p-5 rounded-xl border border-dashed border-slate-700 bg-slate-900/40 text-center text-sm text-slate-400 animate-fadeIn"
                style={{ animationDelay: '0.15s', animationFillMode: 'backwards' }}
              >
                {data.profile.full_name} hasn't added their resume details yet — check back soon.
              </div>
            )}

            {SECTIONS.map((section, sIdx) => {
              const sectionItems = section.types.flatMap((t) => itemsByType[t] || []);
              if (sectionItems.length === 0) return null;
              return (
                <div
                  key={section.key}
                  className="mb-8 animate-fadeInUp"
                  style={{ animationDelay: `${0.3 + sIdx * 0.05}s`, animationFillMode: 'backwards' }}
                >
                  <SectionHeading>{section.title}</SectionHeading>
                  <div className="space-y-3">
                    {sectionItems.map((item) => {
                      const Icon = ITEM_ICONS[item.item_type] || Briefcase;
                      const dateRange = formatDateRange(item);
                      return (
                        <div
                          key={item.id}
                          className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 hover:border-indigo-500/40 transition-colors duration-300"
                        >
                          <div className="flex items-start gap-3">
                            <div className="p-1.5 rounded-lg bg-slate-800 flex-shrink-0 mt-0.5">
                              <Icon className="w-4 h-4 text-indigo-400" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="font-medium text-white leading-snug">
                                {item.title}
                                {item.org_name && <span className="font-normal text-indigo-300/80"> | {item.org_name}</span>}
                                {dateRange && <span className="font-normal text-slate-500"> ({dateRange})</span>}
                              </p>
                              {item.source === 'cmms' && (
                                <span className="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/30">
                                  Auto · CMMS
                                </span>
                              )}
                              <DescriptionBlock text={item.description} />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {data.references?.length > 0 && (
              <div
                className="mb-8 animate-fadeInUp"
                style={{ animationDelay: '0.55s', animationFillMode: 'backwards' }}
              >
                <SectionHeading>References</SectionHeading>
                <div className="grid sm:grid-cols-2 gap-3">
                  {data.references.map((ref) => (
                    <div key={ref.id} className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 flex items-start gap-3">
                      <Users className="w-4 h-4 text-indigo-400 flex-shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className="font-medium text-white leading-snug">{ref.name}</p>
                        {(ref.title || ref.organization) && (
                          <p className="text-sm text-indigo-300/80">{[ref.title, ref.organization].filter(Boolean).join(' — ')}</p>
                        )}
                        {(ref.email || ref.phone) && (
                          <p className="text-xs text-slate-400 mt-1">{[ref.email, ref.phone].filter(Boolean).join(' · ')}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div
              className="animate-fadeInUp"
              style={{ animationDelay: '0.6s', animationFillMode: 'backwards' }}
            >
              <RatingWidget
                rateeUserId={data.profile.id}
                ratingSummary={data.ratingSummary}
                ratings={data.ratings}
                onRated={load}
              />
            </div>

            {/* Recommend IcanEra — invite the visitor to build the same page */}
            {!isOwnProfile && (
              <div
                className="mt-8 p-5 rounded-xl border border-indigo-500/20 text-center animate-fadeIn"
                style={{ animationDelay: '0.65s', animationFillMode: 'backwards' }}
              >
                <button
                  onClick={startOwnPortfolio}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  Create Your Own on IcanEra <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            )}

            <div className="mt-10 text-center text-xs text-slate-600">
              Powered by <span className="font-semibold text-indigo-400">IcanEra</span>
            </div>
          </>
        )}
      </div>
    </div>
  );

  if (!isOverlay) return content;

  return <div className="fixed inset-0 z-50 overflow-y-auto">{content}</div>;
}

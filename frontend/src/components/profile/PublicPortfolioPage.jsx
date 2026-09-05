import React, { useEffect, useMemo, useState } from 'react';
import {
  X, ShieldCheck, Briefcase, Award, GraduationCap, FolderKanban, Rocket,
  FlaskConical, Presentation, Loader2, Sparkles, MapPin, Phone, Mail,
  Users, PhoneCall, Video, MessageCircle,
} from 'lucide-react';
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

const GUEST_ID_KEY = 'ican_portfolio_guest_id';

function getOrCreateGuestId() {
  try {
    let id = window.localStorage.getItem(GUEST_ID_KEY);
    if (!id) {
      id = `guest-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      window.localStorage.setItem(GUEST_ID_KEY, id);
    }
    return id;
  } catch (_) {
    return `guest-${Math.random().toString(36).slice(2)}`;
  }
}

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
      <ul className="mt-1.5 space-y-1 list-disc list-inside text-sm text-gray-400">
        {lines.map((line, i) => <li key={i}>{line}</li>)}
      </ul>
    );
  }
  return <p className="text-sm text-gray-400 mt-1.5">{text}</p>;
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
  const guestId = useMemo(() => getOrCreateGuestId(), []);
  const viewerId = user?.id || guestId;
  const viewerName = viewerProfile?.full_name || guestName.trim() || 'A visitor from your portfolio';
  const call = useDirectCall({ roomId: `portfolio-visitor:${viewerId}`, selfId: viewerId, selfName: viewerName });

  const isOwnProfile = Boolean(user?.id && data?.profile?.id && user.id === data.profile.id);

  const openCommunityChat = () => {
    if (onClose) {
      // Already inside the app shell (overlay usage) — ChatWidget is mounted
      // and listens for this exact event to jump straight to its Community tab.
      window.dispatchEvent(new CustomEvent('ican-open-community-live'));
    } else {
      // Standalone /portfolio/<handle> route has no ChatWidget mounted —
      // send the visitor into the main app, which opens it on load.
      window.location.href = '/?join=community-live';
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

  const content = (
    <div className="relative min-h-[100dvh] bg-gradient-to-b from-[#241511] via-[#3a2418] to-[#241511] text-white overflow-hidden">
      {/* Ambient background glow */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-24 -left-24 w-72 h-72 bg-purple-600/20 rounded-full blur-3xl animate-blob" />
        <div className="absolute top-1/3 -right-24 w-80 h-80 bg-amber-500/20 rounded-full blur-3xl animate-blob animation-delay-2000" />
        <div className="absolute bottom-0 left-1/4 w-72 h-72 bg-purple-500/10 rounded-full blur-3xl animate-blob animation-delay-4000" />
      </div>

      <div className="relative max-w-3xl mx-auto px-4 py-8 sm:py-12">
        {isOverlay && (
          <button onClick={onClose} className="mb-4 p-2 rounded-lg hover:bg-white/10 transition-colors">
            <X className="w-5 h-5" />
          </button>
        )}

        {isLoading && (
          <div className="flex items-center justify-center py-24 text-amber-200/70">
            <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading portfolio...
          </div>
        )}

        {!isLoading && notFound && (
          <div className="text-center py-24 animate-fadeIn">
            <p className="text-xl font-semibold mb-2">Profile not found</p>
            <p className="text-gray-400 text-sm">This IcanEra portfolio link isn't available or was made private.</p>
          </div>
        )}

        {!isLoading && data && (
          <>
            <div className="flex items-center gap-4 mb-3 animate-fadeInDown">
              <div className="relative flex-shrink-0">
                <div className="absolute inset-0 rounded-full bg-gradient-to-br from-amber-400 to-purple-500 blur-md opacity-60 animate-pulse-slow" />
                {data.profile.avatar_url ? (
                  <img
                    src={data.profile.avatar_url}
                    alt={data.profile.full_name}
                    className="relative w-24 h-24 rounded-full object-cover ring-4 ring-purple-600/50"
                  />
                ) : (
                  <div className="relative w-24 h-24 rounded-full bg-gradient-to-br from-amber-700 to-purple-600 flex items-center justify-center text-3xl font-bold ring-4 ring-purple-600/50">
                    {(data.profile.full_name || 'U').charAt(0)}
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-2xl font-bold truncate bg-gradient-to-r from-amber-200 via-white to-purple-200 bg-clip-text text-transparent">
                    {data.profile.full_name}
                  </h1>
                  {data.profile.is_verified ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-medium">
                      <ShieldCheck className="w-3.5 h-3.5" /> Verified
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-700/40 border border-slate-500/30 text-gray-400 text-xs font-medium">
                      <ShieldCheck className="w-3.5 h-3.5" /> Not yet verified
                    </span>
                  )}
                </div>
                <p className="text-amber-200/70 text-sm">@{data.profile.handle}</p>
                {data.portfolio?.headline && (
                  <p className="text-gray-200 mt-1 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-amber-300 flex-shrink-0" />
                    {data.portfolio.headline}
                  </p>
                )}
              </div>
            </div>

            {/* Resume-style contact line */}
            {contactLine.length > 0 && (
              <div
                className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-6 text-xs text-gray-400 animate-fadeIn"
                style={{ animationDelay: '0.05s', animationFillMode: 'backwards' }}
              >
                {data.portfolio.location && (
                  <span className="inline-flex items-center gap-1"><MapPin className="w-3.5 h-3.5 text-amber-400" /> {data.portfolio.location}</span>
                )}
                {data.portfolio.phone && (
                  <span className="inline-flex items-center gap-1"><Phone className="w-3.5 h-3.5 text-amber-400" /> {data.portfolio.phone}</span>
                )}
                {data.portfolio.contact_email && (
                  <span className="inline-flex items-center gap-1"><Mail className="w-3.5 h-3.5 text-amber-400" /> {data.portfolio.contact_email}</span>
                )}
              </div>
            )}

            {/* Call / community-chat action bar — lets a client reach this
                professional directly from their resume page. */}
            {!isOwnProfile && (
              <div
                className="mb-6 p-3 rounded-xl bg-slate-900/50 border border-amber-700/20 animate-fadeIn"
                style={{ animationDelay: '0.08s', animationFillMode: 'backwards' }}
              >
                {call.callState === 'idle' ? (
                  <div className="flex flex-wrap items-center gap-2">
                    {!user && (
                      <input
                        value={guestName}
                        onChange={(e) => setGuestName(e.target.value)}
                        placeholder="Your name (for the call)"
                        className="min-w-0 flex-1 px-3 py-2 bg-slate-950/50 border border-slate-700 rounded-lg text-white placeholder-gray-500 text-xs"
                      />
                    )}
                    <button
                      onClick={() => call.startCall(false, viewerName, `community:${data.profile.id}`)}
                      className="flex items-center gap-1.5 px-3 py-2 bg-gradient-to-r from-amber-700 to-purple-600 hover:from-amber-600 hover:to-purple-500 text-white text-xs font-medium rounded-lg"
                    >
                      <PhoneCall className="w-3.5 h-3.5" /> Call {data.profile.full_name?.split(' ')[0] || 'them'}
                    </button>
                    <button
                      onClick={() => call.startCall(true, viewerName, `community:${data.profile.id}`)}
                      className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-medium rounded-lg"
                    >
                      <Video className="w-3.5 h-3.5" /> Video Call
                    </button>
                    <button
                      onClick={openCommunityChat}
                      className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-medium rounded-lg"
                    >
                      <MessageCircle className="w-3.5 h-3.5" /> Community Chat
                    </button>
                  </div>
                ) : (
                  <CallDock call={call} dark tint="amber" />
                )}
                {call.callState === 'idle' && (
                  <p className="text-[11px] text-gray-500 mt-2">
                    Calls connect only while {data.profile.full_name?.split(' ')[0] || 'they'} has IcanEra open — if there's no answer, try Community Chat instead.
                  </p>
                )}
              </div>
            )}

            {data.portfolio?.summary && (
              <div
                className="mb-6 animate-fadeInUp"
                style={{ animationDelay: '0.1s', animationFillMode: 'backwards' }}
              >
                <h2 className="text-lg font-semibold mb-2">Professional Summary</h2>
                <p className="text-gray-300 leading-relaxed whitespace-pre-wrap">{data.portfolio.summary}</p>
              </div>
            )}

            {data.portfolio?.skills?.length > 0 && (
              <div
                className="mb-8 animate-fadeInUp"
                style={{ animationDelay: '0.2s', animationFillMode: 'backwards' }}
              >
                <h2 className="text-lg font-semibold mb-2">Core Competencies &amp; Technical Skills</h2>
                <div className="flex flex-wrap gap-2">
                  {data.portfolio.skills.map((skill, i) => (
                    <span
                      key={skill}
                      className="px-3 py-1 bg-purple-900/40 border border-purple-600/30 rounded-full text-xs text-purple-200 transition-all hover:scale-110 hover:bg-purple-800/60 hover:border-purple-400/60 hover:text-white cursor-default animate-fadeIn"
                      style={{ animationDelay: `${0.25 + i * 0.05}s`, animationFillMode: 'backwards' }}
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {data.items.length === 0 && !data.portfolio?.summary && !data.portfolio?.skills?.length && (
              <div
                className="mb-8 p-5 rounded-xl border border-dashed border-amber-700/30 bg-slate-950/30 text-center text-sm text-gray-400 animate-fadeIn"
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
                  <h2 className="text-lg font-semibold mb-3">{section.title}</h2>
                  <div className="space-y-3">
                    {sectionItems.map((item) => {
                      const Icon = ITEM_ICONS[item.item_type] || Briefcase;
                      const dateRange = formatDateRange(item);
                      return (
                        <div
                          key={item.id}
                          className="p-4 rounded-xl bg-slate-900/50 border border-amber-700/20 hover:border-purple-500/50 transition-colors duration-300"
                        >
                          <div className="flex items-start gap-3">
                            <div className="p-1.5 rounded-lg bg-gradient-to-br from-amber-700/30 to-purple-700/30 flex-shrink-0 mt-0.5">
                              <Icon className="w-4 h-4 text-amber-300" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="font-medium text-white leading-snug">
                                {item.title}
                                {item.org_name && <span className="font-normal text-amber-200/70"> | {item.org_name}</span>}
                                {dateRange && <span className="font-normal text-gray-400"> ({dateRange})</span>}
                              </p>
                              {item.source === 'cmms' && (
                                <span className="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">
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
                <h2 className="text-lg font-semibold mb-3">References</h2>
                <div className="grid sm:grid-cols-2 gap-3">
                  {data.references.map((ref) => (
                    <div key={ref.id} className="p-4 rounded-xl bg-slate-900/50 border border-amber-700/20 flex items-start gap-3">
                      <Users className="w-4 h-4 text-purple-300 flex-shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className="font-medium text-white leading-snug">{ref.name}</p>
                        {(ref.title || ref.organization) && (
                          <p className="text-sm text-amber-200/70">{[ref.title, ref.organization].filter(Boolean).join(' — ')}</p>
                        )}
                        {(ref.email || ref.phone) && (
                          <p className="text-xs text-gray-400 mt-1">{[ref.email, ref.phone].filter(Boolean).join(' · ')}</p>
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

            <div className="mt-10 text-center text-xs text-amber-200/50">
              Powered by <span className="font-semibold text-amber-300">IcanEra</span>
            </div>
          </>
        )}
      </div>
    </div>
  );

  if (!isOverlay) return content;

  return <div className="fixed inset-0 z-50 overflow-y-auto">{content}</div>;
}

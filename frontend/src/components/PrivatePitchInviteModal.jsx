import React, { useEffect, useState } from 'react';
import { Lock, X, Copy, Check, Clock, Loader, AlertCircle, Eye, EyeOff, Trash2, Sparkles, Send } from 'lucide-react';
import {
  createPrivatePitchInvite,
  listPrivatePitchInvites,
  revokePrivatePitchInvite,
} from '../services/privatePitchInviteService';

const EXPIRY_CHOICES = [
  { id: '24h', label: '24 hours', hours: 24 },
  { id: '3d', label: '3 days', hours: 72 },
  { id: '7d', label: '7 days', hours: 168 },
  { id: '30d', label: '30 days', hours: 720 },
];

const generateRandomPin = () => String(Math.floor(Math.random() * 10000)).padStart(4, '0');

const formatCountdown = (expiresAt) => {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'Expired';
  const mins = Math.floor(ms / 60000);
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const remMins = mins % 60;
  if (days > 0) return `${days}d ${hours}h left`;
  if (hours > 0) return `${hours}h ${remMins}m left`;
  return `${remMins}m left`;
};

const inviteStatus = (invite) => {
  if (invite.revoked_at) return { label: 'Revoked', className: 'bg-gray-500/20 text-gray-300 border-gray-400/30' };
  if (invite.locked_at) return { label: 'Locked out', className: 'bg-red-500/20 text-red-300 border-red-400/30' };
  if (new Date(invite.expires_at) <= new Date()) return { label: 'Expired', className: 'bg-gray-500/20 text-gray-300 border-gray-400/30' };
  return { label: 'Active', className: 'bg-green-500/20 text-green-300 border-green-400/30' };
};

// Split-channel security tip made actionable, not just text -- two separate
// WhatsApp share buttons so sending the link and the PIN through different
// messages/contacts is one tap each, not something the business has to
// remember to do manually.
const buildWhatsAppShareUrl = (text) => `https://wa.me/?text=${encodeURIComponent(text)}`;

const CopyButton = ({ value, label }) => {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try { await navigator.clipboard.writeText(value); } catch { /* clipboard unavailable */ }
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
        copied ? 'bg-green-500/30 text-green-300' : 'bg-slate-700 hover:bg-slate-600 text-slate-200'
      }`}
    >
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? 'Copied' : label}
    </button>
  );
};

/**
 * Opened from a pitch card's "Invite investor" action (Pitchin.jsx). Lets a
 * business owner hand-craft a PIN-locked, time-limited invite for one named
 * investor (Create), and manage the ones they've already sent (Manage).
 * Creation/PIN-verification all happen server-side via
 * services/privatePitchInviteService.js -- this component never sees a
 * pin_hash and never talks to `pitches`/ShareSigningFlow directly.
 */
const PrivatePitchInviteModal = ({ pitch, onClose }) => {
  const businessProfileId = pitch?.business_profile_id;
  const [view, setView] = useState('create'); // 'create' | 'created' | 'manage'
  const [investorName, setInvestorName] = useState('');
  const [investorContact, setInvestorContact] = useState('');
  const [customMessage, setCustomMessage] = useState('');
  const [title, setTitle] = useState(pitch?.title || '');
  const [description, setDescription] = useState(pitch?.description || '');
  const [includeVideo, setIncludeVideo] = useState(Boolean(pitch?.video_url));
  const [includeDeck, setIncludeDeck] = useState(Boolean(pitch?.deck_url));
  const [expiryChoice, setExpiryChoice] = useState('3d');
  const [pin, setPin] = useState(generateRandomPin());
  const [pinMode, setPinMode] = useState('auto');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [created, setCreated] = useState(null); // { link, pin }

  const [invites, setInvites] = useState([]);
  const [invitesLoading, setInvitesLoading] = useState(false);

  const loadInvites = async () => {
    if (!businessProfileId) return;
    setInvitesLoading(true);
    const result = await listPrivatePitchInvites(businessProfileId);
    setInvites(result.data || []);
    setInvitesLoading(false);
  };

  useEffect(() => {
    if (view === 'manage') loadInvites();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const handleCreate = async () => {
    setError(null);
    if (!/^[0-9]{4}$/.test(pin)) {
      setError('PIN must be exactly 4 digits.');
      return;
    }
    setSubmitting(true);
    const hours = EXPIRY_CHOICES.find((c) => c.id === expiryChoice)?.hours || 72;
    const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);
    const result = await createPrivatePitchInvite({
      businessProfileId,
      pin,
      expiresAt,
      investorName: investorName.trim() || null,
      investorContact: investorContact.trim() || null,
      customMessage: customMessage.trim() || null,
      title: title.trim() || null,
      description: description.trim() || null,
      videoUrl: includeVideo ? (pitch?.video_url || null) : null,
      thumbnailUrl: includeVideo ? (pitch?.thumbnail_url || null) : null,
      pitchType: pitch?.pitch_type || null,
      category: pitch?.category || null,
      deckUrl: includeDeck ? (pitch?.deck_url || null) : null,
      deckPath: includeDeck ? (pitch?.deck_path || null) : null,
    });
    setSubmitting(false);
    if (!result.success) {
      setError(result.error || 'Could not create this invite. Please try again.');
      return;
    }
    setCreated({ link: result.data.link, pin });
    setView('created');
  };

  const handleRevoke = async (inviteId) => {
    await revokePrivatePitchInvite(inviteId);
    loadInvites();
  };

  const resetForNewInvite = () => {
    setInvestorName('');
    setInvestorContact('');
    setCustomMessage('');
    setIncludeVideo(Boolean(pitch?.video_url));
    setIncludeDeck(Boolean(pitch?.deck_url));
    setPin(generateRandomPin());
    setPinMode('auto');
    setCreated(null);
    setError(null);
    setView('create');
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-2xl w-full max-w-md max-h-[88vh] flex flex-col border border-amber-500/20">
        <div className="flex items-center justify-between p-4 border-b border-slate-700">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Lock className="w-5 h-5 text-amber-400" /> Private Investor Invite
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        {view !== 'created' && (
          <div className="flex gap-2 px-4 pt-3">
            <button
              onClick={() => setView('create')}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition ${view === 'create' ? 'bg-amber-500/20 text-amber-300 border border-amber-400/30' : 'bg-slate-700/50 text-slate-300'}`}
            >
              Create invite
            </button>
            <button
              onClick={() => setView('manage')}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition ${view === 'manage' ? 'bg-amber-500/20 text-amber-300 border border-amber-400/30' : 'bg-slate-700/50 text-slate-300'}`}
            >
              Manage sent invites
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {view === 'create' && (
            <>
              <p className="text-xs text-slate-400">
                A private link + PIN for one investor, on your terms and your timeline -- it never appears in the public PitchIn feed or your board.
              </p>

              <div>
                <label className="text-xs font-semibold text-slate-300 mb-1 block">Investor's name (optional)</label>
                <input
                  value={investorName}
                  onChange={(e) => setInvestorName(e.target.value)}
                  placeholder="e.g. Jane Doe"
                  className="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 mb-1 block">A personal message (optional)</label>
                <textarea
                  value={customMessage}
                  onChange={(e) => setCustomMessage(e.target.value)}
                  rows={2}
                  placeholder="e.g. Thanks for the conversation last week -- here's the detail I promised."
                  className="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 mb-1 block">Headline</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 mb-1 block">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none"
                />
              </div>

              {pitch?.video_url && (
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input type="checkbox" checked={includeVideo} onChange={(e) => setIncludeVideo(e.target.checked)} className="rounded" />
                  Include this pitch's video
                </label>
              )}

              {pitch?.deck_url && (
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input type="checkbox" checked={includeDeck} onChange={(e) => setIncludeDeck(e.target.checked)} className="rounded" />
                  Include this pitch's deck
                </label>
              )}

              <div>
                <label className="text-xs font-semibold text-slate-300 mb-1.5 block flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" /> Expires in
                </label>
                <div className="flex gap-2 flex-wrap">
                  {EXPIRY_CHOICES.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setExpiryChoice(c.id)}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold transition ${
                        expiryChoice === c.id ? 'bg-amber-500 text-black' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                      }`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 mb-1.5 block">4-digit PIN</label>
                <div className="flex items-center gap-2">
                  <input
                    value={pin}
                    onChange={(e) => { setPinMode('manual'); setPin(e.target.value.replace(/\D/g, '').slice(0, 4)); }}
                    inputMode="numeric"
                    className="w-24 bg-slate-700 text-white text-center text-lg font-mono font-bold rounded-lg px-3 py-2 tracking-widest focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                  <button
                    onClick={() => { setPin(generateRandomPin()); setPinMode('auto'); }}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-slate-700 hover:bg-slate-600 text-slate-200"
                  >
                    <Sparkles className="w-3.5 h-3.5" /> Generate
                  </button>
                  {pinMode === 'auto' && <span className="text-[11px] text-slate-500">Auto-generated</span>}
                </div>
                <p className="text-[11px] text-amber-400/80 mt-1.5">
                  Share the link and this PIN through two different channels (e.g. link by email, PIN by WhatsApp) -- it's shown only once.
                </p>
              </div>

              {error && (
                <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" /> {error}
                </p>
              )}

              <button
                onClick={handleCreate}
                disabled={submitting}
                className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-bold transition flex items-center justify-center gap-2"
              >
                {submitting ? <Loader className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                Create private invite
              </button>
            </>
          )}

          {view === 'created' && created && (
            <div className="space-y-4">
              <div className="text-center">
                <div className="w-14 h-14 rounded-full bg-amber-500/20 flex items-center justify-center mx-auto mb-3">
                  <Check className="w-7 h-7 text-amber-400" />
                </div>
                <p className="text-white font-bold">Invite created</p>
                <p className="text-xs text-slate-400 mt-1">This PIN won't be shown again -- copy it now.</p>
              </div>

              <div>
                <p className="text-xs font-semibold text-slate-300 mb-1">Private link</p>
                <div className="flex items-center gap-2 bg-slate-900/60 rounded-lg px-3 py-2">
                  <p className="text-xs text-slate-300 truncate flex-1">{created.link}</p>
                  <CopyButton value={created.link} label="Copy link" />
                </div>
                <a
                  href={buildWhatsAppShareUrl(`Here's an exclusive investment opportunity: ${created.link}`)}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-green-400 hover:text-green-300"
                >
                  <Send className="w-3.5 h-3.5" /> Share link via WhatsApp
                </a>
              </div>

              <div>
                <p className="text-xs font-semibold text-slate-300 mb-1">PIN</p>
                <div className="flex items-center gap-2 bg-slate-900/60 rounded-lg px-3 py-2">
                  <p className="text-2xl font-mono font-bold text-amber-400 tracking-widest flex-1 text-center">{created.pin}</p>
                  <CopyButton value={created.pin} label="Copy PIN" />
                </div>
                <a
                  href={buildWhatsAppShareUrl(`Your access PIN is ${created.pin} -- keep it separate from the link I sent.`)}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-green-400 hover:text-green-300"
                >
                  <Send className="w-3.5 h-3.5" /> Share PIN via WhatsApp (send separately!)
                </a>
              </div>

              <div className="flex gap-2 pt-2">
                <button onClick={resetForNewInvite} className="flex-1 py-2.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-sm font-semibold transition">
                  Create another
                </button>
                <button onClick={() => setView('manage')} className="flex-1 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-black text-sm font-semibold transition">
                  View all invites
                </button>
              </div>
            </div>
          )}

          {view === 'manage' && (
            <>
              {invitesLoading ? (
                <div className="flex justify-center py-8"><Loader className="w-6 h-6 text-slate-400 animate-spin" /></div>
              ) : invites.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-8">No private invites yet for this business.</p>
              ) : (
                invites.map((invite) => {
                  const status = inviteStatus(invite);
                  const isActive = status.label === 'Active';
                  return (
                    <div key={invite.id} className="bg-slate-900/50 rounded-xl p-3 border border-slate-700/50">
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <p className="text-sm font-semibold text-white">{invite.investor_name || 'Unnamed investor'}</p>
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${status.className}`}>{status.label}</span>
                      </div>
                      <p className="text-xs text-slate-400 mb-2">{invite.title}</p>
                      <div className="flex items-center gap-3 text-[11px] text-slate-400">
                        <span className="inline-flex items-center gap-1">
                          {invite.viewed_count > 0 ? <Eye className="w-3.5 h-3.5 text-green-400" /> : <EyeOff className="w-3.5 h-3.5" />}
                          {invite.viewed_count > 0 ? `Viewed ${invite.viewed_count}x` : 'Not yet viewed'}
                        </span>
                        {isActive && <span className="inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {formatCountdown(invite.expires_at)}</span>}
                        {invite.materialized_pitch_id && <span className="text-amber-400">Invested</span>}
                      </div>
                      {isActive && (
                        <button
                          onClick={() => handleRevoke(invite.id)}
                          className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold text-red-300 hover:text-red-200"
                        >
                          <Trash2 className="w-3.5 h-3.5" /> Revoke
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default PrivatePitchInviteModal;

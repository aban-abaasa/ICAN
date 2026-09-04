import React, { useRef } from 'react';
import { Phone, PhoneOff, Video, Music } from 'lucide-react';

const initialFor = (name) => (String(name || '?').trim().slice(0, 1) || '?').toUpperCase();

/**
 * WhatsApp-style full-screen incoming call takeover. Renders above
 * *everything* (widget open or not, whatever tab/stage is showing)
 * whenever `call.callState === 'ringing-in'` — a call is meant to be
 * impossible to miss, not a bubble you might not be looking at.
 *
 * `onPickRingtone` is optional: when provided, a small "Choose ringtone"
 * affordance opens the device's file picker so the caller ID sound can be
 * personalized, same idea as choosing a ringtone on a phone's contact card.
 *
 * `onAccept`/`onDecline` default to `call.acceptCall`/`call.declineCall` but
 * can be overridden (e.g. to also open the containing chat widget so the
 * active-call UI underneath isn't invisible the moment this overlay closes).
 */
const IncomingCallOverlay = ({ call, onPickRingtone, ringtoneName, onAccept, onDecline }) => {
  const fileInputRef = useRef(null);

  if (call.callState !== 'ringing-in') return null;

  const handleFileChange = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file && onPickRingtone) onPickRingtone(file);
  };

  return (
    <div className="fixed inset-0 z-[2000] flex flex-col items-center justify-between overflow-hidden bg-gradient-to-b from-indigo-700 via-purple-800 to-slate-900 px-6 py-10 text-white">
      <div className="flex flex-col items-center gap-1 pt-6">
        <span className="text-sm font-medium text-white/70">{call.isVideo ? 'Incoming video call' : 'Incoming call'}</span>
      </div>

      <div className="flex flex-col items-center gap-5">
        <div className="relative flex h-32 w-32 items-center justify-center">
          <span className="absolute inset-0 animate-ping rounded-full bg-white/20" />
          <span className="absolute inset-0 animate-pulse rounded-full bg-white/10" style={{ animationDelay: '0.4s' }} />
          <span className="relative flex h-28 w-28 items-center justify-center rounded-full bg-gradient-to-br from-white/25 to-white/10 text-4xl font-bold shadow-2xl ring-4 ring-white/30">
            {initialFor(call.peerName)}
          </span>
        </div>
        <div className="text-center">
          <p className="text-2xl font-semibold">{call.peerName || 'Someone'}</p>
          <p className="mt-1 text-sm text-white/70">{call.isVideo ? 'Video call' : 'Audio call'}</p>
        </div>
      </div>

      <div className="flex w-full max-w-xs flex-col items-center gap-6">
        {onPickRingtone && (
          <>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white/80 transition hover:bg-white/20"
              title="Choose an audio file from your device as your ringtone"
            >
              <Music className="h-3.5 w-3.5" /> {ringtoneName ? `Ringtone: ${ringtoneName}` : 'Choose ringtone'}
            </button>
            <input ref={fileInputRef} type="file" accept="audio/*" className="hidden" onChange={handleFileChange} />
          </>
        )}

        <div className="flex w-full items-center justify-between">
          <div className="flex flex-col items-center gap-2">
            <button
              onClick={onDecline || call.declineCall}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500 shadow-2xl transition hover:scale-105 hover:bg-red-600"
              title="Decline"
            >
              <PhoneOff className="h-7 w-7" />
            </button>
            <span className="text-xs font-medium text-white/70">Decline</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <button
              onClick={onAccept || call.acceptCall}
              className="flex h-16 w-16 animate-bounce items-center justify-center rounded-full bg-emerald-500 shadow-2xl transition hover:scale-105 hover:bg-emerald-600"
              title="Accept"
            >
              {call.isVideo ? <Video className="h-7 w-7" /> : <Phone className="h-7 w-7" />}
            </button>
            <span className="text-xs font-medium text-white/70">Accept</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default IncomingCallOverlay;

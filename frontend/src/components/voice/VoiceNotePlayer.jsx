import React, { useEffect, useRef, useState } from 'react';
import { Play, Pause, Mic, Loader2 } from 'lucide-react';
import { isR2Key, resolveMediaValue } from '../../services/r2StorageService';
import { isSupabaseVoiceKey, resolveVoiceNoteUrl } from '../../services/voiceNoteService';

const formatTime = (seconds) => {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

/**
 * Compact pill-shaped playback control for a recorded voice note. Accepts
 * a raw playable URL, a legacy r2://key marker (older notes, resolved via
 * r2StorageService), or a supabase-voice://path marker (current notes,
 * resolved to a signed Supabase Storage URL) — the latter resolves to
 * null once the note has been auto-deleted by the retention prompt.
 */
export default function VoiceNotePlayer({ url, tint = 'cyan', className = '' }) {
  const [resolvedUrl, setResolvedUrl] = useState(null);
  const [resolving, setResolving] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const audioRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setResolving(true);
    const resolve = isR2Key(url) ? resolveMediaValue(url)
      : isSupabaseVoiceKey(url) ? resolveVoiceNoteUrl(url)
      : Promise.resolve(url);
    resolve.then((resolved) => {
      if (!cancelled) {
        setResolvedUrl(resolved);
        setResolving(false);
      }
    });
    return () => { cancelled = true; };
  }, [url]);

  if (!url) return null;

  if (!resolving && !resolvedUrl) {
    return (
      <div className={`inline-flex items-center gap-2 py-1 text-[11px] italic opacity-60 ${className}`}>
        <Mic className="w-3 h-3" />
        Voice note removed
      </div>
    );
  }

  const togglePlayback = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
  };

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const tintClasses = tint === 'white'
    ? { icon: 'bg-white/25', iconText: 'text-white', btn: 'bg-white hover:bg-white/90', btnIcon: 'text-indigo-600', track: 'bg-white/25', fill: 'bg-white', time: 'text-white/80' }
    : { icon: 'bg-cyan-500/20', iconText: 'text-cyan-300', btn: 'bg-cyan-500 hover:bg-cyan-400', btnIcon: 'text-white', track: 'bg-white/10', fill: 'bg-cyan-400', time: 'text-gray-400' };

  return (
    <div className={`inline-flex items-center gap-2 py-1 ${className}`}>
      <div className={`p-1.5 rounded-full ${tintClasses.icon} flex-shrink-0`}>
        <Mic className={`w-3 h-3 ${tintClasses.iconText}`} />
      </div>

      {resolving ? (
        <Loader2 className={`w-3.5 h-3.5 animate-spin ${tintClasses.iconText}`} />
      ) : (
        <>
          <audio
            ref={audioRef}
            src={resolvedUrl}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onEnded={() => setIsPlaying(false)}
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
            onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime || 0)}
          />
          <button
            type="button"
            onClick={togglePlayback}
            className={`p-1.5 rounded-full transition-colors flex-shrink-0 ${tintClasses.btn}`}
          >
            {isPlaying ? <Pause className={`w-3 h-3 ${tintClasses.btnIcon}`} fill="currentColor" /> : <Play className={`w-3 h-3 ${tintClasses.btnIcon} ml-0.5`} fill="currentColor" />}
          </button>
          <div className={`w-20 h-1 rounded-full overflow-hidden ${tintClasses.track}`}>
            <div className={`h-full transition-all ${tintClasses.fill}`} style={{ width: `${progressPct}%` }} />
          </div>
          <span className={`text-[10px] tabular-nums w-8 ${tintClasses.time}`}>
            {formatTime(isPlaying || currentTime > 0 ? currentTime : duration)}
          </span>
        </>
      )}
    </div>
  );
}

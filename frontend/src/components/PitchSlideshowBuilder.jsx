import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Trash2, Plus, Music, Mic, Play, Pause, Square, X } from 'lucide-react';
import './pitch-camera-stage.css';
import {
  isImageFile,
  isAudioFile,
  probeAudio,
  pickAudioFormat,
  formatDuration,
  formatBytes,
} from '../utils/videoFormat';
import {
  SLIDE_W,
  SLIDE_H,
  MAX_SLIDESHOW_SECONDS,
  loadSlideImage,
  paintSlideshowFrame,
  renderSlideshow,
} from '../utils/slideshowRender';

// "Photo pitch": many pictures plus audio (a music/narration file, or a voice-over recorded here) turned into a
// pitch video. The pictures can be reordered or removed, shown whole ("Fit") or filling the screen ("Fill"), and
// shown for a fixed time each or spread across the audio. Building runs in real time on a canvas (see
// utils/slideshowRender.js) and the finished video goes to the same preview as a recorded one.

const MAX_PHOTOS = 20;
const MAX_AUDIO_MB = 40;

let nextId = 1;

export default function PitchSlideshowBuilder({ initialFiles = [], onCancel, onDone }) {
  const canvasRef = useRef(null);
  const abortRef = useRef(null);
  const wakeRef = useRef(null);
  const voiceRef = useRef(null);      // { recorder, stream, startedAt, timer }
  const audioElRef = useRef(null);
  const itemsRef = useRef([]);

  const [items, setItems] = useState([]); // { id, file, url, image }
  const [sel, setSel] = useState(0);
  const [mode, setMode] = useState('fit');
  const [per, setPer] = useState('auto');
  const [audio, setAudio] = useState(null); // { blob, name, durationSec, kind: 'file' | 'voice' }
  const [audioUrl, setAudioUrl] = useState(null);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [voiceSecs, setVoiceSecs] = useState(null); // null = not recording
  const [phase, setPhase] = useState('edit');      // edit | building
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');

  itemsRef.current = items;

  // ---------- pictures ----------
  const addPhotos = useCallback((files) => {
    const pics = files.filter(isImageFile);
    if (pics.length < files.length) setError('Some files were skipped because they are not pictures.');
    if (!pics.length) return;
    setItems((prev) => {
      const room = Math.max(0, MAX_PHOTOS - prev.length);
      if (pics.length > room) setError(`A photo pitch holds up to ${MAX_PHOTOS} pictures.`);
      const added = pics.slice(0, room).map((file) => ({ id: nextId++, file, url: URL.createObjectURL(file), image: null }));
      added.forEach((item) => {
        loadSlideImage(item.file)
          .then((image) => setItems((cur) => cur.map((i) => (i.id === item.id ? { ...i, image } : i))))
          .catch(() => {
            const heic = /\.(heic|heif)$/i.test(item.file.name) || /hei[cf]/i.test(item.file.type);
            setError(heic
              ? `${item.file.name} is in HEIC format, which this browser can't open. Please choose a JPG or PNG.`
              : `${item.file.name} could not be read.`);
            URL.revokeObjectURL(item.url);
            setItems((cur) => cur.filter((i) => i.id !== item.id));
          });
      });
      return [...prev, ...added];
    });
  }, []);

  useEffect(() => { addPhotos(initialFiles); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  useEffect(() => () => {
    itemsRef.current.forEach((i) => { URL.revokeObjectURL(i.url); i.image?.close?.(); });
  }, []);

  const move = (dir) => {
    setItems((prev) => {
      const to = sel + dir;
      if (to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      [next[sel], next[to]] = [next[to], next[sel]];
      return next;
    });
    setSel((s) => Math.max(0, Math.min(items.length - 1, s + dir)));
  };

  const removeSelected = () => {
    const gone = items[sel];
    if (!gone) return;
    URL.revokeObjectURL(gone.url);
    gone.image?.close?.();
    setItems((prev) => prev.filter((i) => i.id !== gone.id));
    setSel((s) => Math.max(0, Math.min(s, items.length - 2)));
  };

  // ---------- audio ----------
  useEffect(() => {
    if (!audio) { setAudioUrl(null); return undefined; }
    const url = URL.createObjectURL(audio.blob);
    setAudioUrl(url);
    setAudioPlaying(false);
    return () => URL.revokeObjectURL(url);
  }, [audio]);

  const handleAudioFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError('');
    if (!isAudioFile(file)) { setError('That file is not audio. Please choose an MP3, M4A, WAV or similar file.'); return; }
    if (file.size / 1024 / 1024 > MAX_AUDIO_MB) { setError(`That audio file is larger than ${MAX_AUDIO_MB} MB.`); return; }
    const durationSec = await probeAudio(file);
    if (!durationSec) { setError("This audio couldn't be read. Try an MP3 or M4A file."); return; }
    setAudio({ blob: file, name: file.name, durationSec, kind: 'file' });
  };

  const stopVoice = useCallback(() => {
    const v = voiceRef.current;
    if (v?.recorder && v.recorder.state !== 'inactive') v.recorder.stop();
  }, []);

  const startVoice = async () => {
    setError('');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError("This browser can't record sound. Choose an audio file instead.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const fmt = pickAudioFormat();
      const recorder = new MediaRecorder(stream, fmt ? { mimeType: fmt } : undefined);
      const chunks = [];
      const startedAt = Date.now();
      recorder.ondataavailable = (e) => { if (e.data?.size > 0) chunks.push(e.data); };
      recorder.onstop = () => {
        clearInterval(voiceRef.current?.timer);
        stream.getTracks().forEach((t) => t.stop());
        const type = (recorder.mimeType || fmt || 'audio/webm').split(';')[0];
        const blob = new Blob(chunks, { type });
        voiceRef.current = null;
        setVoiceSecs(null);
        if (blob.size > 0) setAudio({ blob, name: 'Voice-over', durationSec: (Date.now() - startedAt) / 1000, kind: 'voice' });
      };
      const timer = setInterval(() => {
        const secs = (Date.now() - startedAt) / 1000;
        setVoiceSecs(secs);
        if (secs >= MAX_SLIDESHOW_SECONDS) recorder.stop();
      }, 250);
      voiceRef.current = { recorder, stream, startedAt, timer };
      recorder.start();
      setVoiceSecs(0);
    } catch (err) {
      setError(err?.name === 'NotAllowedError' ? 'Microphone access is blocked. Allow it in your browser settings.' : "The microphone couldn't start.");
    }
  };

  useEffect(() => () => {
    const v = voiceRef.current;
    if (v) { clearInterval(v.timer); v.recorder.onstop = null; try { v.recorder.stop(); } catch { /* noop */ } v.stream.getTracks().forEach((t) => t.stop()); }
  }, []);

  const toggleAudioPlay = () => {
    const el = audioElRef.current;
    if (!el) return;
    if (el.paused) el.play().catch(() => {}); else el.pause();
  };

  // ---------- timing ----------
  const loaded = useMemo(() => items.filter((i) => i.image), [items]);
  const n = loaded.length;
  const audioSec = audio ? Math.min(audio.durationSec || 0, MAX_SLIDESHOW_SECONDS) : 0;
  let perSec = per === 'auto' ? (audioSec > 0 && n ? audioSec / n : 4) : per;
  perSec = Math.max(1, perSec);
  const totalSec = Math.min(MAX_SLIDESHOW_SECONDS, Math.max(1, n) * perSec);
  perSec = n ? totalSec / n : perSec;

  // ---------- preview of the selected picture ----------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || phase !== 'edit') return;
    canvas.width = SLIDE_W;
    canvas.height = SLIDE_H;
    const item = items[sel];
    const ctx = canvas.getContext('2d');
    if (item?.image) paintSlideshowFrame(ctx, [item.image], mode, 1, 4);
    else { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, SLIDE_W, SLIDE_H); }
  }, [items, sel, mode, phase]);

  // ---------- build ----------
  const releaseAwake = () => { try { wakeRef.current?.release(); } catch { /* released */ } wakeRef.current = null; };

  const cancelBuild = useCallback(() => abortRef.current?.abort(), []);

  const create = async () => {
    if (!n || phase === 'building') return;
    audioElRef.current?.pause();
    setError('');
    setProgress(0);
    setPhase('building');
    const controller = new AbortController();
    abortRef.current = controller;
    try { wakeRef.current = (await navigator.wakeLock?.request('screen')) || null; } catch { /* optional */ }
    try {
      const blob = await renderSlideshow({
        canvas: canvasRef.current,
        images: loaded.map((i) => i.image),
        mode,
        perSec,
        totalSec,
        audio: audio?.blob || null,
        onProgress: setProgress,
        signal: controller.signal,
      });
      releaseAwake();
      onDone({ blob, durationSec: totalSec, width: SLIDE_W, height: SLIDE_H });
    } catch (err) {
      releaseAwake();
      if (err?.name !== 'AbortError') setError(err?.message || 'The video could not be created. Please try again.');
      setPhase('edit');
    }
  };

  // The picture is drawn live while building, so the page has to stay in front.
  useEffect(() => {
    if (phase !== 'building') return undefined;
    const onHide = () => {
      if (!document.hidden) return;
      abortRef.current?.abort();
      setError("The screen was switched away, so the video wasn't finished. Keep this screen open while it is being created.");
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [phase]);

  useEffect(() => () => { abortRef.current?.abort(); releaseAwake(); }, []);

  const building = phase === 'building';
  const recordingVoice = voiceSecs !== null;

  return (
    <div className="pcs pcsb">
      <div className="pcsb-head">
        {building ? (
          <button type="button" className="pcs-ico" onClick={cancelBuild} aria-label="Cancel"><X /></button>
        ) : (
          <button type="button" className="pcs-ico" onClick={onCancel} aria-label="Back"><ArrowLeft /></button>
        )}
        <div className="grow">
          <h2 className="pcs-title">Photo Pitch</h2>
          <span className="pcs-sub">{n} {n === 1 ? 'photo' : 'photos'}</span>
        </div>
        <button type="button" className="pcs-pill primary" onClick={create} disabled={!n || building || recordingVoice}>
          Create
        </button>
      </div>

      <div className="pcsb-stage">
        <div className="pcsb-frame">
          <canvas ref={canvasRef} width={SLIDE_W} height={SLIDE_H} />
          {building && (
            <div className="pcsb-progress" aria-live="polite">
              Creating your video · {formatDuration(progress * totalSec)} / {formatDuration(totalSec)}
              <div className="bar"><i style={{ width: `${(progress * 100).toFixed(1)}%` }} /></div>
            </div>
          )}
        </div>
      </div>

      {!building && (
        <div className="pcsb-panel">
          {error && <p className="pcs-error" role="alert">{error}</p>}

          <div className="pcsb-strip" role="list">
            {items.map((item, i) => (
              <button
                key={item.id}
                type="button"
                role="listitem"
                className={`pcsb-thumb ${i === sel ? 'is-sel' : ''}`}
                onClick={() => setSel(i)}
                aria-label={`Photo ${i + 1}`}
              >
                <img src={item.url} alt="" />
                <span className="num">{i + 1}</span>
              </button>
            ))}
            {items.length < MAX_PHOTOS && (
              <label className="pcsb-add" aria-label="Add more photos">
                <Plus size={20} />
                <input type="file" accept="image/*,.jpg,.jpeg,.png,.webp" multiple className="hidden" style={{ display: 'none' }}
                  onChange={(e) => { addPhotos(Array.from(e.target.files || [])); e.target.value = ''; }} />
              </label>
            )}
          </div>

          <div className="pcsb-tools">
            <button type="button" className="pcs-ico ico-sm" onClick={() => move(-1)} disabled={sel <= 0} aria-label="Move earlier"><ChevronLeft /></button>
            <button type="button" className="pcs-ico ico-sm" onClick={() => move(1)} disabled={sel >= items.length - 1} aria-label="Move later"><ChevronRight /></button>
            <button type="button" className="pcs-ico ico-sm" onClick={removeSelected} disabled={!items.length} aria-label="Remove this photo"><Trash2 /></button>
          </div>

          <div className="pcsb-opts">
            <div className="pcsb-chips" role="group" aria-label="Show each photo">
              <label>Photo</label>
              {[['fit', 'Fit'], ['fill', 'Fill']].map(([value, label]) => (
                <button key={value} type="button" className={`pcsb-chip ${mode === value ? 'is-on' : ''}`} aria-pressed={mode === value} onClick={() => setMode(value)}>{label}</button>
              ))}
            </div>
            <div className="pcsb-chips" role="group" aria-label="Time per photo">
              <label>Time</label>
              {[['auto', 'Auto'], [3, '3s'], [5, '5s'], [8, '8s']].map(([value, label]) => (
                <button key={value} type="button" className={`pcsb-chip ${per === value ? 'is-on' : ''}`} aria-pressed={per === value} onClick={() => setPer(value)}>{label}</button>
              ))}
            </div>
          </div>

          <div className={`pcsb-audio ${recordingVoice ? 'is-recording' : ''}`}>
            {recordingVoice ? (
              <>
                <span className="name"><small>Recording voice-over</small>{formatDuration(voiceSecs)} / {formatDuration(MAX_SLIDESHOW_SECONDS)}</span>
                <button type="button" className="pcs-ico ico-sm" onClick={stopVoice} aria-label="Stop voice recording"><Square fill="currentColor" /></button>
              </>
            ) : audio ? (
              <>
                <button type="button" className="pcs-ico ico-sm" onClick={toggleAudioPlay} aria-label={audioPlaying ? 'Pause audio' : 'Play audio'}>
                  {audioPlaying ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
                </button>
                <span className="name">
                  <small>{audio.kind === 'voice' ? 'Voice-over' : 'Audio'} · {formatDuration(audio.durationSec)} · {formatBytes(audio.blob.size)}</small>
                  {audio.name}
                </span>
                <button type="button" className="pcs-ico ico-sm" onClick={() => setAudio(null)} aria-label="Remove audio"><X /></button>
                <audio ref={audioElRef} src={audioUrl || undefined} onPlay={() => setAudioPlaying(true)} onPause={() => setAudioPlaying(false)} onEnded={() => setAudioPlaying(false)} />
              </>
            ) : (
              <>
                <span className="empty">Add music or your voice</span>
                <label className="pcs-ico ico-sm" aria-label="Choose an audio file">
                  <Music />
                  <input type="file" accept="audio/*,.mp3,.m4a,.aac,.wav,.ogg" className="hidden" style={{ display: 'none' }} onChange={handleAudioFile} />
                </label>
                <button type="button" className="pcs-ico ico-sm" onClick={startVoice} aria-label="Record a voice-over"><Mic /></button>
              </>
            )}
          </div>

          <p className="pcsb-summary">
            {n ? `${n} ${n === 1 ? 'photo' : 'photos'} · ${formatDuration(totalSec)}${audio ? ' · with audio' : ''}` : 'Add at least one photo'}
            {audio && audio.durationSec > MAX_SLIDESHOW_SECONDS ? ` · audio trimmed to ${formatDuration(MAX_SLIDESHOW_SECONDS)}` : ''}
          </p>
        </div>
      )}
    </div>
  );
}

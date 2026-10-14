import React, { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle, AlertTriangle, Loader2, RotateCcw, X, UploadCloud } from 'lucide-react';
import {
  subscribePitchUploads,
  getPitchUploads,
  retryPitchUpload,
  cancelPitchUpload,
  dismissPitchUpload,
} from '../services/pitchUploadStore';
import { formatBytes } from '../utils/videoFormat';

// A small card above the bottom navigation that shows a pitch video publishing in the background.
// It reads the upload store, so it keeps going (and stays visible) while the person moves around the app.

const statusLine = (job) => {
  const pct = Math.round(job.progress * 100);
  switch (job.status) {
    case 'preparing': return `Getting your video ready… ${pct}%`;
    case 'uploading': {
      const sent = job.sizeBytes ? ` · ${formatBytes(job.sizeBytes * job.progress)} of ${formatBytes(job.sizeBytes)}` : '';
      return `Uploading ${pct}%${sent}`;
    }
    case 'saving': return 'Publishing…';
    case 'done': return 'Published. Your pitch is live.';
    case 'error': return job.error || 'Upload failed';
    default: return '';
  }
};

function TrayCard({ job, onOpenPitchin }) {
  const active = job.status === 'preparing' || job.status === 'uploading' || job.status === 'saving';
  const tone = job.status === 'error' ? 'border-red-500/50' : job.status === 'done' ? 'border-emerald-500/60' : 'border-slate-600';
  const barTone = job.status === 'error' ? 'bg-red-500' : 'bg-emerald-500';
  const Icon = job.status === 'done' ? CheckCircle : job.status === 'error' ? AlertTriangle : active ? Loader2 : UploadCloud;
  const iconTone = job.status === 'done' ? 'text-emerald-400' : job.status === 'error' ? 'text-red-400' : 'text-sky-300';

  return (
    <div className={`pointer-events-auto rounded-xl border ${tone} bg-slate-900/95 px-3 py-2.5 shadow-xl backdrop-blur`} role="status">
      <div className="flex items-start gap-2.5">
        <Icon className={`mt-0.5 h-5 w-5 flex-shrink-0 ${iconTone} ${active ? 'animate-spin' : ''}`} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">{job.title}</p>
          <p className="break-words text-xs leading-snug text-slate-300">{statusLine(job)}</p>
        </div>

        {job.status === 'error' && (
          <button
            type="button"
            onClick={() => retryPitchUpload(job.id)}
            className="flex min-h-[40px] flex-shrink-0 items-center gap-1 rounded-lg bg-emerald-600 px-3 text-xs font-bold text-white active:bg-emerald-700"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Retry
          </button>
        )}
        {job.status === 'done' && onOpenPitchin && (
          <button
            type="button"
            onClick={() => { onOpenPitchin(); dismissPitchUpload(job.id); }}
            className="min-h-[40px] flex-shrink-0 rounded-lg bg-emerald-600 px-3 text-xs font-bold text-white active:bg-emerald-700"
          >
            View
          </button>
        )}
        {(job.status === 'preparing' || job.status === 'uploading' || job.status === 'error' || job.status === 'done') && (
          <button
            type="button"
            onClick={() => (job.status === 'done' ? dismissPitchUpload(job.id) : cancelPitchUpload(job.id))}
            aria-label={job.status === 'done' ? 'Dismiss' : job.status === 'error' ? 'Discard upload' : 'Cancel upload'}
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg text-slate-400 active:bg-white/10"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>

      {job.status !== 'done' && (
        <div
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-700"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(job.progress * 100)}
        >
          <div className={`h-full ${barTone} transition-[width] duration-200`} style={{ width: `${Math.max(job.status === 'saving' ? 100 : 3, job.progress * 100)}%` }} />
        </div>
      )}
    </div>
  );
}

export default function PitchUploadTray({ onOpenPitchin }) {
  const jobs = useSyncExternalStore(subscribePitchUploads, getPitchUploads, getPitchUploads);
  const visible = jobs.filter((j) => !j.hidden);
  if (visible.length === 0 || typeof document === 'undefined') return null;

  // Rendered on <body>, above the bottom bar (and its safe-area), below full-screen dialogs.
  return createPortal(
    <div
      className="pointer-events-none fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))] z-[250] mx-auto flex max-w-md flex-col gap-2 md:bottom-4"
      aria-live="polite"
    >
      {visible.map((job) => <TrayCard key={job.id} job={job} onOpenPitchin={onOpenPitchin} />)}
    </div>,
    document.body
  );
}

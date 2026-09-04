import React, { useEffect, useState } from 'react';
import { Mic, Trash2 } from 'lucide-react';
import { sweepVoiceNoteRetention, keepVoiceNote, deleteVoiceNoteNow } from '../../services/voiceNoteService';

/**
 * Daily "keep or delete" prompt for the signed-in owner's voice notes.
 * Runs a retention sweep whenever `ownerId` becomes available (auto-
 * deleting any note whose prompt went unanswered on an earlier day), then
 * shows one modal at a time for whatever's due today. See
 * voiceNoteService.sweepVoiceNoteRetention for the day-boundary rules.
 */
export default function VoiceNoteRetentionPrompt({ ownerId }) {
  const [queue, setQueue] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!ownerId) { setQueue([]); return; }
    let cancelled = false;
    sweepVoiceNoteRetention(ownerId).then((rows) => {
      if (!cancelled) setQueue(rows);
    });
    return () => { cancelled = true; };
  }, [ownerId]);

  if (queue.length === 0) return null;
  const current = queue[0];
  const advance = () => setQueue((q) => q.slice(1));

  const handleKeep = async () => {
    setBusy(true);
    await keepVoiceNote(current.id);
    setBusy(false);
    advance();
  };

  const handleDelete = async () => {
    setBusy(true);
    await deleteVoiceNoteNow(current.id, current.storage_path);
    setBusy(false);
    advance();
  };

  const recordedOn = new Date(current.created_at).toLocaleDateString();

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-slate-900 border border-white/10 p-5 shadow-2xl text-white">
        <div className="flex items-center gap-2 mb-3">
          <div className="p-2 rounded-full bg-cyan-500/20">
            <Mic className="w-4 h-4 text-cyan-300" />
          </div>
          <h3 className="text-sm font-semibold">Keep this voice note?</h3>
        </div>
        <p className="text-xs text-gray-400 mb-5">
          Recorded on {recordedOn}. Voice notes are asked about daily — if a day's prompt
          is left unanswered the note is deleted automatically.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={handleDelete}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/10 py-2 text-xs font-medium text-red-300 hover:bg-red-500/10 disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={handleKeep}
            className="flex-1 rounded-lg bg-cyan-500 py-2 text-xs font-medium text-white hover:bg-cyan-400 disabled:opacity-50"
          >
            Keep
          </button>
        </div>
        {queue.length > 1 && (
          <p className="mt-3 text-center text-[10px] text-gray-500">{queue.length - 1} more after this</p>
        )}
      </div>
    </div>
  );
}

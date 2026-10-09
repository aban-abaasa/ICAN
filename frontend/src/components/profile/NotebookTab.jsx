import React, { useMemo, useState, useSyncExternalStore } from 'react';
import { Plus, Trash2, Copy, Download, ArrowLeft, ClipboardList, BookOpen, Check } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { getNotes, subscribeNotes, createNote, updateNote, deleteNote, appendToNote } from '../../services/notebookService';
import { wordCount } from '../../utils/dictationText';
import VoiceDictateButton from '../common/VoiceDictateButton';

const fmtWhen = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

/**
 * Notebook: type or dictate notes and meeting minutes. Voice keeps writing into the open note
 * when the person leaves this screen, until they press Stop (the recording pill stays on show).
 */
export default function NotebookTab() {
  const { user } = useAuth();
  const userId = user?.id;
  const notes = useSyncExternalStore(subscribeNotes, () => getNotes(userId));
  const [openId, setOpenId] = useState(null);
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const note = useMemo(() => notes.find((n) => n.id === openId) || null, [notes, openId]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${note.title}\n\n${note.body}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard blocked */ }
  };

  const download = () => {
    const blob = new Blob([`${note.title}\n${fmtWhen(note.createdAt)}\n\n${note.body}\n`], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${note.title.replace(/[^\w\- ]+/g, '').trim() || 'note'}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (note) {
    return (
      <section className="rz-card space-y-3">
        <div className="flex items-center gap-2">
          <button type="button" className="rz-btn rz-btn-ghost rz-btn-sm" onClick={() => { setOpenId(null); setConfirmDelete(false); }} aria-label="Back to all notes">
            <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Notes
          </button>
          <span className="ml-auto text-xs text-slate-400">{wordCount(note.body)} words · saved {fmtWhen(note.updatedAt)}</span>
        </div>

        <div>
          <label className="rz-label" htmlFor="nb-title">Title</label>
          <input id="nb-title" className="rz-input" value={note.title} onChange={(e) => updateNote(userId, note.id, { title: e.target.value })} />
        </div>

        <div>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
            <label className="rz-label !mb-0" htmlFor="nb-body">{note.kind === 'minutes' ? 'Minutes' : 'Note'}</label>
            <VoiceDictateButton
              theme="dark"
              label={`notebook:${note.id}`}
              title={note.title || 'Notebook'}
              keepRunningOnLeave
              idleText="Dictate"
              onText={(heard) => appendToNote(userId, note.id, heard)}
            />
          </div>
          <textarea
            id="nb-body"
            className="rz-input"
            rows={14}
            value={note.body}
            placeholder="Type here, or tap Dictate and speak."
            onChange={(e) => updateNote(userId, note.id, { body: e.target.value })}
          />
          <p className="mt-2 text-xs text-slate-400">
            Say “comma”, “full stop”, “question mark”, “new line” or “new paragraph” for punctuation, and “stop dictation” to finish.
            Dictation keeps going if you open another screen in ICAN, until you press Stop. Your browser pauses it if you switch to another app or lock the phone.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="button" className="rz-btn rz-btn-ghost rz-btn-sm" onClick={copy}>
            {copied ? <Check className="w-4 h-4" aria-hidden="true" /> : <Copy className="w-4 h-4" aria-hidden="true" />} {copied ? 'Copied' : 'Copy'}
          </button>
          <button type="button" className="rz-btn rz-btn-ghost rz-btn-sm" onClick={download}>
            <Download className="w-4 h-4" aria-hidden="true" /> Download
          </button>
          {confirmDelete ? (
            <>
              <button type="button" className="rz-btn rz-btn-sm !bg-red-600 !text-white" onClick={() => { deleteNote(userId, note.id); setOpenId(null); setConfirmDelete(false); }}>
                Delete this note
              </button>
              <button type="button" className="rz-btn rz-btn-ghost rz-btn-sm" onClick={() => setConfirmDelete(false)}>Keep</button>
            </>
          ) : (
            <button type="button" className="rz-btn rz-btn-ghost rz-btn-sm" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="w-4 h-4" aria-hidden="true" /> Delete
            </button>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="rz-card space-y-3">
      <div className="rz-section-title">
        <h3>Notebook</h3>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="rz-btn rz-btn-primary rz-btn-sm" onClick={() => setOpenId(createNote(userId).id)}>
          <Plus className="w-4 h-4" aria-hidden="true" /> New note
        </button>
        <button type="button" className="rz-btn rz-btn-ghost rz-btn-sm" onClick={() => setOpenId(createNote(userId, { kind: 'minutes' }).id)}>
          <ClipboardList className="w-4 h-4" aria-hidden="true" /> Take minutes
        </button>
      </div>

      {notes.length === 0 ? (
        <div className="text-center py-8 text-slate-400">
          <BookOpen className="w-8 h-8 mx-auto mb-2 opacity-60" aria-hidden="true" />
          <p className="text-sm">No notes yet. Start one and type or speak.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {notes.map((n) => (
            <li key={n.id}>
              <button type="button" onClick={() => setOpenId(n.id)} className="w-full text-left rounded-lg border border-[rgba(196,160,82,0.28)] bg-white/5 hover:bg-white/10 px-3 py-2.5 transition-colors">
                <span className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-sm truncate">{n.title || 'Untitled note'}</span>
                  <span className="text-[11px] text-slate-400 whitespace-nowrap">{fmtWhen(n.updatedAt)}</span>
                </span>
                <span className="block text-xs text-slate-400 truncate mt-0.5">{n.body.replace(/\s+/g, ' ').trim() || 'Empty'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-slate-500">Notes are saved on this device.</p>
    </section>
  );
}

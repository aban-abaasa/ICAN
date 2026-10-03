import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, Check, FileUp, Loader2, Mic, MicOff, Sparkles, X } from 'lucide-react';
import { cleanConversation, limitConversation, MAX_CONVERSATION_CHARS } from '../../utils/conversationText';
import { readConversation } from '../../services/conversationProfileService';
import {
  buildBusinessReview, buildResumeReview, businessPayload, resumePayload,
} from '../../utils/conversationReview';
import './conversation-import.css';

const COPY = {
  resume: {
    title: 'Build your resume from a conversation',
    intro: 'Tell it the way you would tell a friend: where you have worked or studied, what you do well, what you are proud of. Or paste a chat where you talked about yourself.',
    placeholder: 'e.g. I studied accounting at Makerere, graduated in 2018. Since 2019 I have been a stock controller at Nile Breweries, where I cut wastage by 12%. I also run a small poultry farm with 400 birds…',
    subjectLabel: 'Which of these is you?',
    apply: 'Add to my resume',
  },
  business: {
    title: 'Build your pitch profile from your idea',
    intro: 'Describe the business the way you would to an investor: what you sell, who buys it, how you make money, what you have achieved so far and what you need. Or paste a chat where you explained it.',
    placeholder: 'e.g. We buy maize from 300 farmers around Masindi and sell clean, dried grain to millers in Kampala. Customers pay on delivery, margin is about 14%. Started in 2022, sold 80 tonnes last season. We are looking for UGX 60 million to buy a dryer…',
    subjectLabel: 'Which of these is the founder?',
    apply: 'Add to my pitch profile',
  },
};

const SpeechRecognition = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;

/**
 * Reads a personal conversation and proposes resume or Pitchin profile details.
 * The person reviews every proposed change before the host applies it.
 *
 * @param target     'resume' | 'business'
 * @param current    what the host form already holds (see conversationProfileService review builders)
 * @param countries  [{ code, name }] (business only)
 * @param onApply    async (payload) => string, applies the ticked changes and returns a short summary
 */
export default function ConversationImportModal({ target, current, countries, onApply, onClose }) {
  const copy = COPY[target];
  const [stage, setStage] = useState('input'); // input | reading | review | done
  const [text, setText] = useState('');
  const [subject, setSubject] = useState('');
  const [error, setError] = useState('');
  const [rows, setRows] = useState([]);
  const [missing, setMissing] = useState([]);
  const [checked, setChecked] = useState(() => new Set());
  const [applying, setApplying] = useState(false);
  const [doneMessage, setDoneMessage] = useState('');
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef(null);
  const closeRef = useRef(null);

  const cleaned = useMemo(() => cleanConversation(text), [text]);
  const limited = useMemo(() => limitConversation(cleaned.text), [cleaned.text]);
  const enough = limited.text.length >= 40;

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape' && !applying) onClose(); };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
      recognitionRef.current?.stop();
    };
  }, [onClose, applying]);

  // Keep the chosen speaker valid when the text changes.
  useEffect(() => {
    if (!cleaned.speakers.some((s) => s.name === subject)) setSubject('');
  }, [cleaned.speakers, subject]);

  const toggleListening = () => {
    if (listening) { recognitionRef.current?.stop(); return; }
    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = navigator.language || 'en-US';
    rec.onresult = (event) => {
      let heard = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        if (event.results[i].isFinal) heard += event.results[i][0].transcript;
      }
      if (heard.trim()) setText((t) => `${t}${t && !/\s$/.test(t) ? ' ' : ''}${heard.trim()}`);
    };
    rec.onerror = (event) => {
      setError(event.error === 'not-allowed' ? 'Microphone access was blocked. Allow it in your browser, or type instead.' : 'Voice typing stopped. You can keep typing.');
    };
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    setError('');
    try { rec.start(); setListening(true); } catch { setListening(false); }
  };

  const loadFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { setError('That file is too large. Export the chat without media, or paste part of it.'); return; }
    try {
      setError('');
      setText(await file.text());
    } catch {
      setError('That file could not be read. Paste the text instead.');
    }
  };

  const read = async () => {
    setError('');
    setStage('reading');
    try {
      const result = await readConversation({ target, text: limited.text, subject });
      const built = target === 'resume' ? buildResumeReview(result, current) : buildBusinessReview(result, current, countries);
      setRows(built);
      setMissing(result.missing || []);
      setChecked(new Set(built.filter((r) => r.checked).map((r) => r.id)));
      setStage('review');
    } catch (err) {
      setError(err.message);
      setStage('input');
    }
  };

  const toggle = (id) => setChecked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const apply = async () => {
    setApplying(true);
    setError('');
    try {
      const payload = target === 'resume' ? resumePayload(rows, checked) : businessPayload(rows, checked);
      setDoneMessage((await onApply(payload)) || 'Done.');
      setStage('done');
    } catch (err) {
      setError(err.message || 'Could not apply those changes. Please try again.');
    }
    setApplying(false);
  };

  const groups = useMemo(() => {
    const byGroup = new Map();
    rows.forEach((r) => byGroup.set(r.group, [...(byGroup.get(r.group) || []), r]));
    return [...byGroup.entries()];
  }, [rows]);

  return createPortal(
    <div className="ci-backdrop" role="dialog" aria-modal="true" aria-label={copy.title} onClick={() => { if (!applying) onClose(); }}>
      <div className="ci-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="ci-head">
          <div className="ci-head__title"><Sparkles aria-hidden="true" /><h2>{copy.title}</h2></div>
          <button ref={closeRef} type="button" className="ci-icon" onClick={onClose} disabled={applying} aria-label="Close"><X aria-hidden="true" /></button>
        </div>

        <div className="ci-body">
          {(stage === 'input' || stage === 'reading') && (
            <>
              <p className="ci-intro">{copy.intro}</p>
              <label className="ci-label" htmlFor="ci-text">Your words</label>
              <textarea id="ci-text" className="ci-text" rows={9} value={text} placeholder={copy.placeholder}
                onChange={(e) => setText(e.target.value)} disabled={stage === 'reading'} />
              <div className="ci-tools">
                {SpeechRecognition && (
                  <button type="button" className={`ci-btn ci-btn--ghost ${listening ? 'is-live' : ''}`} onClick={toggleListening} disabled={stage === 'reading'} aria-pressed={listening}>
                    {listening ? <MicOff aria-hidden="true" /> : <Mic aria-hidden="true" />}{listening ? 'Stop listening' : 'Speak instead'}
                  </button>
                )}
                <label className={`ci-btn ci-btn--ghost ${stage === 'reading' ? 'is-disabled' : ''}`}>
                  <FileUp aria-hidden="true" />Upload a chat (.txt)
                  <input type="file" accept=".txt,text/plain" className="ci-file" onChange={loadFile} disabled={stage === 'reading'} />
                </label>
                <span className="ci-count" aria-live="polite">{Math.min(limited.text.length, MAX_CONVERSATION_CHARS).toLocaleString()} / {MAX_CONVERSATION_CHARS.toLocaleString()}</span>
              </div>

              {cleaned.isChat && (
                <p className="ci-note" role="status">
                  Chat export recognised: {cleaned.speakers.reduce((n, s) => n + s.count, 0)} messages. Times and system lines were removed.
                </p>
              )}
              {cleaned.speakers.length > 1 && (
                <div className="ci-field">
                  <label className="ci-label" htmlFor="ci-subject">{copy.subjectLabel}</label>
                  <select id="ci-subject" className="ci-select" value={subject} onChange={(e) => setSubject(e.target.value)} disabled={stage === 'reading'}>
                    <option value="">The person talking about themselves</option>
                    {cleaned.speakers.map((s) => <option key={s.name} value={s.name}>{s.name} ({s.count} messages)</option>)}
                  </select>
                </div>
              )}
              {limited.truncated && <p className="ci-note ci-note--warn" role="status">That is long, so only the first {MAX_CONVERSATION_CHARS.toLocaleString()} characters will be read.</p>}

              <p className="ci-privacy">
                Only the words above are sent to our AI reader, once, to find details. They are not saved or shared.
                You see everything it found and choose what to keep before anything changes.
              </p>
            </>
          )}

          {stage === 'review' && (
            <>
              <p className="ci-intro">Here is what was found. Untick anything you do not want. Nothing changes until you confirm.</p>
              {groups.length === 0 && <p className="ci-note">Everything it found is already in your profile.</p>}
              {groups.map(([group, groupRows]) => (
                <section key={group} className="ci-group" aria-label={group}>
                  <h3 className="ci-group__t">{group}</h3>
                  {groupRows.map((r) => (
                    <label key={r.id} className={`ci-row ${checked.has(r.id) ? 'is-on' : ''}`}>
                      <input type="checkbox" checked={checked.has(r.id)} onChange={() => toggle(r.id)} />
                      <span className="ci-row__box" aria-hidden="true"><Check /></span>
                      <span className="ci-row__main">
                        <span className="ci-row__label">{r.label}</span>
                        {r.proposed && <span className="ci-row__val">{r.proposed}</span>}
                        {r.current && <span className="ci-row__was">Now: {r.current}</span>}
                        {r.note && <span className="ci-row__note">{r.note}</span>}
                      </span>
                    </label>
                  ))}
                </section>
              ))}
              {missing.length > 0 && (
                <section className="ci-group" aria-label="Still worth adding">
                  <h3 className="ci-group__t">Still worth adding</h3>
                  <ul className="ci-missing">{missing.map((m) => <li key={m}>{m}</li>)}</ul>
                </section>
              )}
            </>
          )}

          {stage === 'done' && (
            <div className="ci-done" role="status">
              <span className="ci-done__tick"><Check aria-hidden="true" /></span>
              <p>{doneMessage}</p>
            </div>
          )}

          {error && <div className="ci-alert" role="alert"><AlertCircle aria-hidden="true" /><span>{error}</span></div>}
        </div>

        <div className="ci-foot">
          {stage === 'input' && (
            <>
              <button type="button" className="ci-btn ci-btn--ghost" onClick={onClose}>Cancel</button>
              <button type="button" className="ci-btn ci-btn--primary" onClick={read} disabled={!enough}>
                <Sparkles aria-hidden="true" />Read it
              </button>
            </>
          )}
          {stage === 'reading' && (
            <button type="button" className="ci-btn ci-btn--primary ci-btn--wide" disabled>
              <Loader2 className="ci-spin" aria-hidden="true" />Reading…
            </button>
          )}
          {stage === 'review' && (
            <>
              <button type="button" className="ci-btn ci-btn--ghost" onClick={() => { setStage('input'); setError(''); }} disabled={applying}>Back</button>
              <button type="button" className="ci-btn ci-btn--primary" onClick={apply} disabled={applying || checked.size === 0}>
                {applying ? <Loader2 className="ci-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}
                {checked.size ? `${copy.apply} (${checked.size})` : 'Nothing selected'}
              </button>
            </>
          )}
          {stage === 'done' && <button type="button" className="ci-btn ci-btn--primary ci-btn--wide" onClick={onClose}>Close</button>}
        </div>
      </div>
    </div>,
    document.body,
  );
}

import React, { useEffect, useState } from 'react';
import { X, Plus, Trash2, Save, Loader, Sparkles } from 'lucide-react';
import cmmsWrittenTestService from '../services/cmmsWrittenTestService';
import openaiService from '../services/openaiService';

// multiple_choice/yes_no are graded automatically (an exact correct_option_id
// match, same mechanism for both -- yes_no is really just a 2-option MCQ);
// short_text/long_text have no answer to check against, so they're queued
// for a human to award points to after the candidate submits (see
// TestGradingPanel in CMMSAnnouncementsPanel.jsx).
const QUESTION_TYPES = [
  { id: 'multiple_choice', label: 'Multiple choice', hint: 'Auto-graded' },
  { id: 'yes_no', label: 'Yes / No', hint: 'Auto-graded' },
  { id: 'short_text', label: 'Short answer', hint: 'Graded by you' },
  { id: 'long_text', label: 'Long answer', hint: 'Graded by you' },
];
const isChoiceType = (type) => type === 'multiple_choice' || type === 'yes_no';

const optionsForType = (type) => {
  if (type === 'multiple_choice') return [{ id: 'a', text: '' }, { id: 'b', text: '' }, { id: 'c', text: '' }, { id: 'd', text: '' }];
  if (type === 'yes_no') return [{ id: 'yes', text: 'Yes' }, { id: 'no', text: 'No' }];
  return [];
};

const emptyQuestion = () => ({
  key: `q_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
  questionType: 'multiple_choice',
  questionText: '',
  options: optionsForType('multiple_choice'),
  correctOptionId: 'a',
  sampleAnswer: '',
  points: 1,
});

// A deliberate, self-contained dark/purple palette instead of the usual
// bg-white/10 + text-white + border-purple-400 combo -- the app's
// ThemeContext.jsx repaints every one of those stock Tailwind color classes
// (with !important) to match whatever light/dark theme is active elsewhere
// in the app, which is exactly why this modal was rendering flat/washed-out
// white instead of the intended dark card. None of the wtb- classnames
// below are stock Tailwind utilities, so that override can't reach them --
// same fix PublicCompanyNoticeBoard's NB_STYLES already uses.
const WTB_STYLES = `
.wtb-root {
  --wtb-bg: #150f28;
  --wtb-bg2: #221a40;
  --wtb-surface: rgba(255, 255, 255, 0.05);
  --wtb-surface-hover: rgba(255, 255, 255, 0.09);
  --wtb-border: rgba(255, 255, 255, 0.12);
  --wtb-border-strong: rgba(255, 255, 255, 0.22);
  --wtb-text: #f5f3ff;
  --wtb-text-muted: #b3a6d9;
  --wtb-text-faint: #8b7fb0;
  --wtb-purple: #a855f7;
  --wtb-purple-strong: #9333ea;
  --wtb-purple-soft-text: #d8b4fe;
  --wtb-indigo: #818cf8;
  --wtb-indigo-bg: rgba(99, 102, 241, 0.14);
  --wtb-indigo-border: rgba(129, 140, 248, 0.35);
  --wtb-emerald-bg: rgba(16, 185, 129, 0.16);
  --wtb-emerald-text: #6ee7b7;
  --wtb-amber-bg: rgba(245, 158, 11, 0.16);
  --wtb-amber-text: #fcd34d;
  --wtb-red: #f87171;
  --wtb-red-hover: #fca5a5;
}
.wtb-backdrop { background: rgba(5, 2, 15, 0.8); }
.wtb-card { background: linear-gradient(165deg, var(--wtb-bg2) 0%, var(--wtb-bg) 100%); border-color: rgba(168, 85, 247, 0.28); }
.wtb-header, .wtb-footer { border-color: var(--wtb-border); }
.wtb-title { color: var(--wtb-text); }
.wtb-close { color: var(--wtb-text-faint); }
.wtb-close:hover { color: var(--wtb-text); background: var(--wtb-surface); }
.wtb-input { background: var(--wtb-surface); border: 1px solid var(--wtb-border); color: var(--wtb-text); }
.wtb-input::placeholder { color: var(--wtb-text-faint); }
.wtb-input:focus { outline: none; border-color: var(--wtb-purple); box-shadow: 0 0 0 3px rgba(168, 85, 247, 0.18); }
.wtb-hint { color: var(--wtb-text-faint); }
.wtb-ai-box { background: var(--wtb-indigo-bg); border: 1px solid var(--wtb-indigo-border); }
.wtb-ai-icon { color: var(--wtb-indigo); }
.wtb-ai-btn { background: #6366f1; color: #ffffff; }
.wtb-ai-btn:hover { background: #4f46e5; }
.wtb-qcard { background: var(--wtb-surface); border: 1px solid var(--wtb-border); }
.wtb-qnum { color: var(--wtb-text); }
.wtb-select { background: var(--wtb-bg); border: 1px solid var(--wtb-border-strong); color: var(--wtb-text); }
.wtb-badge-auto { background: var(--wtb-emerald-bg); color: var(--wtb-emerald-text); }
.wtb-badge-manual { background: var(--wtb-amber-bg); color: var(--wtb-amber-text); }
.wtb-remove { color: var(--wtb-red); }
.wtb-remove:hover { color: var(--wtb-red-hover); background: var(--wtb-surface); }
.wtb-radio-label { color: var(--wtb-text-muted); }
.wtb-radio { accent-color: var(--wtb-purple); }
.wtb-option-fixed { background: var(--wtb-surface); border: 1px solid var(--wtb-border); color: var(--wtb-text); }
.wtb-add-btn { color: var(--wtb-purple-soft-text); }
.wtb-add-btn:hover { color: #ecd9ff; }
.wtb-error { color: var(--wtb-red); }
.wtb-btn-cancel { color: var(--wtb-text-muted); }
.wtb-btn-cancel:hover { color: var(--wtb-text); }
.wtb-btn-secondary { background: var(--wtb-surface); color: var(--wtb-text); }
.wtb-btn-secondary:hover { background: var(--wtb-surface-hover); }
.wtb-btn-primary { background: linear-gradient(135deg, var(--wtb-purple), var(--wtb-purple-strong)); color: #ffffff; }
.wtb-btn-primary:hover { filter: brightness(1.08); }
.wtb-btn-primary:disabled, .wtb-btn-secondary:disabled, .wtb-ai-btn:disabled { opacity: 0.5; }
`;

/**
 * Admin builder for a job posting's multiple-choice written test. One test
 * per job posting is the common case, so this loads/creates the job's most
 * recent test rather than presenting a separate "manage tests" list.
 */
const CMMSWrittenTestBuilder = ({ companyId, jobPostingId, jobTitle, jobDepartment, jobDescription, currentCmmsUserId, onClose }) => {
  const [test, setTest] = useState(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [timeLimitMinutes, setTimeLimitMinutes] = useState('20');
  const [passingScore, setPassingScore] = useState('60');
  const [questions, setQuestions] = useState([emptyQuestion()]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generateCount, setGenerateCount] = useState('5');

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const result = await cmmsWrittenTestService.getTestsForJob(jobPostingId);
      if (result.success && result.data.length > 0) {
        const existing = result.data[0];
        setTest(existing);
        setTitle(existing.title || '');
        setDescription(existing.description || '');
        setTimeLimitMinutes(existing.time_limit_minutes ? String(existing.time_limit_minutes) : '');
        setPassingScore(existing.passing_score ? String(existing.passing_score) : '');
        const questionsResult = await cmmsWrittenTestService.getQuestions(existing.id);
        if (questionsResult.success && questionsResult.data.length > 0) {
          setQuestions(questionsResult.data.map((q) => ({
            key: q.id,
            id: q.id,
            questionType: q.question_type || 'multiple_choice',
            questionText: q.question_text,
            options: q.options || optionsForType(q.question_type || 'multiple_choice'),
            correctOptionId: q.correct_option_id,
            sampleAnswer: q.sample_answer || '',
            points: q.points,
          })));
        }
      } else {
        setTitle(`${jobTitle || 'Job'} — Written Test`);
      }
      setLoading(false);
    };
    load();
  }, [jobPostingId]);

  const addQuestion = () => setQuestions((qs) => [...qs, emptyQuestion()]);
  const removeQuestion = (key) => setQuestions((qs) => qs.filter((q) => q.key !== key));
  const updateQuestion = (key, patch) => setQuestions((qs) => qs.map((q) => (q.key === key ? { ...q, ...patch } : q)));
  const updateOption = (key, optionId, text) => setQuestions((qs) => qs.map((q) => (
    q.key === key ? { ...q, options: q.options.map((o) => (o.id === optionId ? { ...o, text } : o)) } : q
  )));
  // Switching type resets options/correct-answer to that type's shape --
  // e.g. going from multiple_choice to short_text drops the now-meaningless
  // 4-option grid rather than silently keeping stale, hidden option text.
  const updateQuestionType = (key, questionType) => setQuestions((qs) => qs.map((q) => (
    q.key === key
      ? { ...q, questionType, options: optionsForType(questionType), correctOptionId: questionType === 'yes_no' ? 'yes' : questionType === 'multiple_choice' ? 'a' : null }
      : q
  )));

  // Drafts questions from the job's own title/department/description so the
  // admin starts from a full test to edit/trim rather than a blank page.
  // Appended after any questions already written by hand; only replaces the
  // single still-untouched starter question left over from opening the form.
  const generateWithAI = async () => {
    setGenerating(true);
    setError('');
    const result = await openaiService.generateTestQuestions(
      { title: jobTitle, department: jobDepartment, description: jobDescription },
      Math.max(1, Math.min(20, Number(generateCount) || 5))
    );
    setGenerating(false);
    if (!result.success) { alert(`❌ Could not generate questions: ${result.error}`); return; }

    // AI generation is multiple_choice-only (that's what the prompt asks
    // for) -- an admin who wants short/long/yes-no questions adds those by
    // hand alongside the generated ones.
    const generated = result.data.map((q) => ({
      key: `q_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      questionType: 'multiple_choice',
      questionText: q.questionText || '',
      options: (q.options?.length === 4 ? q.options : optionsForType('multiple_choice')).map((o, i) => ({
        id: o.id || ['a', 'b', 'c', 'd'][i],
        text: o.text || '',
      })),
      correctOptionId: q.correctOptionId || 'a',
      sampleAnswer: '',
      points: Number(q.points) || 1,
    }));

    setQuestions((qs) => {
      const isUntouchedStarter = qs.length === 1 && !qs[0].questionText.trim() && qs[0].options.every((o) => !o.text.trim());
      return isUntouchedStarter ? generated : [...qs, ...generated];
    });
  };

  const questionIsValid = (q) => {
    if (!q.questionText.trim()) return false;
    if (isChoiceType(q.questionType)) return !!q.correctOptionId && q.options.every((o) => o.text.trim());
    return true;
  };
  const valid = title.trim() && questions.length > 0 && questions.every(questionIsValid);

  const save = async (status) => {
    if (!valid) { alert('Please give the test a title, and fill in every question (plus every option and a correct answer for multiple-choice/yes-no questions).'); return; }
    setSaving(true); setError('');
    try {
      let testId = test?.id;
      const fields = { title, description, timeLimitMinutes, passingScore, status };
      if (testId) {
        const result = await cmmsWrittenTestService.updateTest(testId, {
          title: fields.title.trim(), description: fields.description?.trim() || null,
          time_limit_minutes: fields.timeLimitMinutes ? Number(fields.timeLimitMinutes) : null,
          passing_score: fields.passingScore ? Number(fields.passingScore) : null,
          status: fields.status,
        });
        if (!result.success) throw new Error(result.error);
      } else {
        const result = await cmmsWrittenTestService.createTest(companyId, jobPostingId, currentCmmsUserId, fields);
        if (!result.success) throw new Error(result.error);
        testId = result.data.id;
        setTest(result.data);
      }

      const questionsResult = await cmmsWrittenTestService.saveQuestions(testId, questions);
      if (!questionsResult.success) throw new Error(questionsResult.error);

      onClose(true);
    } catch (err) {
      setError(err.message || 'Failed to save test');
    } finally {
      setSaving(false);
    }
  };

  return (
    // Full-bleed on a phone (no rounded card floating in a padded backdrop --
    // that outer frame was just wasted margin around a form that already
    // has plenty of its own fields to fit) with its own fixed header/footer
    // and independently scrolling middle, same as PublicCompanyNoticeBoard's
    // Modal; reverts to a conventional centered, rounded dialog from sm up.
    <div className="wtb-root fixed inset-0 wtb-backdrop backdrop-blur-sm z-[60] flex sm:items-center sm:justify-center sm:p-4">
      <style>{WTB_STYLES}</style>
      <div className="wtb-card w-full h-full sm:h-auto sm:max-h-[90vh] sm:max-w-3xl rounded-none sm:rounded-2xl border-0 sm:border flex flex-col">
        <div className="wtb-header flex items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b flex-shrink-0">
          <h3 className="wtb-title text-base sm:text-lg font-bold truncate min-w-0 flex-1" title={`Written test — ${jobTitle}`}>Written test — {jobTitle}</h3>
          <button onClick={() => onClose(false)} className="wtb-close flex-shrink-0 p-1.5 rounded-lg transition-colors"><X className="w-5 h-5" /></button>
        </div>

        {loading ? (
          <div className="flex-1 flex justify-center items-center py-10"><Loader className="w-6 h-6 animate-spin" style={{ color: 'var(--wtb-purple)' }} /></div>
        ) : (
          <>
            <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-4 space-y-4">
              <div className="grid sm:grid-cols-2 gap-3">
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Test title" className="wtb-input px-3 py-2.5 rounded-lg sm:col-span-2" />
                <input type="number" min="1" value={timeLimitMinutes} onChange={(e) => setTimeLimitMinutes(e.target.value)} placeholder="Time limit (minutes)" className="wtb-input px-3 py-2.5 rounded-lg" />
                <input type="number" min="0" max="100" value={passingScore} onChange={(e) => setPassingScore(e.target.value)} placeholder="Passing score (%)" className="wtb-input px-3 py-2.5 rounded-lg" />
              </div>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Instructions shown to the candidate before they start (optional)" rows={2} className="wtb-input w-full px-3 py-2.5 rounded-lg" />

              <div className="wtb-ai-box flex flex-col sm:flex-row sm:items-center gap-2 rounded-lg p-3">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <Sparkles className="wtb-ai-icon w-4 h-4 flex-shrink-0" />
                  <span className="wtb-hint text-xs">Generate multiple-choice questions from this job's title, department, and description</span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <input
                    type="number" min="1" max="20" value={generateCount}
                    onChange={(e) => setGenerateCount(e.target.value)}
                    className="wtb-input w-14 px-2 py-1.5 rounded-lg text-sm text-center"
                  />
                  <button
                    disabled={generating}
                    onClick={generateWithAI}
                    className="wtb-ai-btn px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 flex-shrink-0"
                  >
                    {generating ? <><Loader className="w-3.5 h-3.5 animate-spin" /> Generating…</> : <><Sparkles className="w-3.5 h-3.5" /> Generate with AI</>}
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                {questions.map((q, index) => (
                  <div key={q.key} className="wtb-qcard rounded-xl p-3 sm:p-4 space-y-3">
                    {/* Number + auto/manual badge on their own row, type
                        picker full-width below it -- cramming a dropdown
                        that spells out "Long answer — Graded by you" into a
                        shared row with the question number and delete
                        button is what was colliding/overflowing on a phone. */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="wtb-qnum text-sm font-bold flex-shrink-0">Q{index + 1}</span>
                        <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full flex-shrink-0 ${isChoiceType(q.questionType) ? 'wtb-badge-auto' : 'wtb-badge-manual'}`}>
                          {isChoiceType(q.questionType) ? 'Auto-graded' : 'Graded by you'}
                        </span>
                      </div>
                      {questions.length > 1 && (
                        <button onClick={() => removeQuestion(q.key)} className="wtb-remove flex-shrink-0 p-1.5 rounded-lg transition-colors" title="Remove question"><Trash2 className="w-4 h-4" /></button>
                      )}
                    </div>
                    <select
                      value={q.questionType}
                      onChange={(e) => updateQuestionType(q.key, e.target.value)}
                      className="wtb-select w-full text-sm rounded-lg px-3 py-2"
                    >
                      {QUESTION_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </select>
                    <textarea value={q.questionText} onChange={(e) => updateQuestion(q.key, { questionText: e.target.value })} placeholder="Question text" rows={2} className="wtb-input w-full px-3 py-2.5 rounded-lg text-sm" />

                    {isChoiceType(q.questionType) ? (
                      <>
                        <div className="grid sm:grid-cols-2 gap-2">
                          {q.options.map((option) => (
                            <label key={option.id} className="wtb-radio-label flex items-center gap-2 text-xs">
                              <input type="radio" name={`correct_${q.key}`} checked={q.correctOptionId === option.id} onChange={() => updateQuestion(q.key, { correctOptionId: option.id })} title="Mark as correct answer" className="wtb-radio flex-shrink-0" />
                              {q.questionType === 'yes_no' ? (
                                <span className="wtb-option-fixed flex-1 px-2.5 py-2 rounded-lg">{option.text}</span>
                              ) : (
                                <input value={option.text} onChange={(e) => updateOption(q.key, option.id, e.target.value)} placeholder={`Option ${option.id.toUpperCase()}`} className="wtb-input flex-1 px-2.5 py-2 rounded-lg" />
                              )}
                            </label>
                          ))}
                        </div>
                        <p className="wtb-hint text-xs">Select the radio button next to the correct option. Auto-graded the instant the candidate submits.</p>
                      </>
                    ) : (
                      <>
                        <textarea
                          value={q.sampleAnswer}
                          onChange={(e) => updateQuestion(q.key, { sampleAnswer: e.target.value })}
                          placeholder="Sample/ideal answer (optional -- for your own reference when grading, never shown to the candidate)"
                          rows={q.questionType === 'long_text' ? 3 : 2}
                          className="wtb-input w-full px-3 py-2.5 rounded-lg text-sm"
                        />
                        <p className="wtb-hint text-xs">No correct answer to check -- you'll read the candidate's {q.questionType === 'long_text' ? 'paragraph' : 'short'} answer and award points yourself after they submit.</p>
                      </>
                    )}

                    <div className="flex items-center gap-2 text-xs">
                      <span className="wtb-hint">Points:</span>
                      <input type="number" min="1" value={q.points} onChange={(e) => updateQuestion(q.key, { points: e.target.value })} className="wtb-input w-16 px-2 py-1.5 rounded-lg" />
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={addQuestion} className="wtb-add-btn text-sm font-semibold flex items-center gap-1.5 transition-colors"><Plus className="w-4 h-4" /> Add question</button>
              {error && <p className="wtb-error text-sm">{error}</p>}
            </div>

            {/* Sticky, not scrolled-past -- Publish/Save stay one thumb-reach
                away no matter how many questions are above them, same reason
                the notice board's job-apply CTA got the same treatment. */}
            <div
              className="wtb-footer flex flex-wrap justify-end gap-2 px-4 sm:px-6 py-3 border-t flex-shrink-0"
              style={{ paddingBottom: 'max(0.75rem, calc(env(safe-area-inset-bottom) + 0.5rem))' }}
            >
              <button onClick={() => onClose(false)} className="wtb-btn-cancel px-4 py-2 rounded-lg font-semibold transition-colors">Cancel</button>
              <button disabled={saving} onClick={() => save('draft')} className="wtb-btn-secondary px-4 py-2 rounded-lg font-semibold transition-colors">{saving ? 'Saving…' : 'Save as draft'}</button>
              <button disabled={saving} onClick={() => save('published')} className="wtb-btn-primary px-4 py-2 rounded-lg font-semibold flex items-center gap-2 transition-all"><Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Publish test'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default CMMSWrittenTestBuilder;

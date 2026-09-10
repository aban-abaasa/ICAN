import React, { useEffect, useState } from 'react';
import { X, Plus, Trash2, Save, Loader, Sparkles } from 'lucide-react';
import cmmsWrittenTestService from '../services/cmmsWrittenTestService';
import openaiService from '../services/openaiService';

const emptyQuestion = () => ({
  key: `q_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
  questionText: '',
  options: [{ id: 'a', text: '' }, { id: 'b', text: '' }, { id: 'c', text: '' }, { id: 'd', text: '' }],
  correctOptionId: 'a',
  points: 1,
});

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
            questionText: q.question_text,
            options: q.options,
            correctOptionId: q.correct_option_id,
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

    const generated = result.data.map((q) => ({
      key: `q_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      questionText: q.questionText || '',
      options: (q.options?.length === 4 ? q.options : emptyQuestion().options).map((o, i) => ({
        id: o.id || ['a', 'b', 'c', 'd'][i],
        text: o.text || '',
      })),
      correctOptionId: q.correctOptionId || 'a',
      points: Number(q.points) || 1,
    }));

    setQuestions((qs) => {
      const isUntouchedStarter = qs.length === 1 && !qs[0].questionText.trim() && qs[0].options.every((o) => !o.text.trim());
      return isUntouchedStarter ? generated : [...qs, ...generated];
    });
  };

  const valid = title.trim() && questions.length > 0 && questions.every((q) => q.questionText.trim() && q.options.every((o) => o.text.trim()));

  const save = async (status) => {
    if (!valid) { alert('Please give the test a title and fill in every question and option.'); return; }
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
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[60] overflow-y-auto">
      <div className="min-h-screen flex items-start justify-center p-4 pb-16">
        <div className="glass-card w-full max-w-3xl p-6 my-8 border border-purple-400/30">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-white">Written test — {jobTitle}</h3>
            <button onClick={() => onClose(false)} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
          </div>

          {loading ? (
            <div className="flex justify-center py-10"><Loader className="w-6 h-6 text-purple-400 animate-spin" /></div>
          ) : (
            <div className="space-y-4">
              <div className="grid md:grid-cols-3 gap-3">
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Test title" className="px-3 py-2 rounded bg-white/10 text-white border border-white/20 md:col-span-3" />
                <input type="number" min="1" value={timeLimitMinutes} onChange={(e) => setTimeLimitMinutes(e.target.value)} placeholder="Time limit (minutes)" className="px-3 py-2 rounded bg-white/10 text-white border border-white/20" />
                <input type="number" min="0" max="100" value={passingScore} onChange={(e) => setPassingScore(e.target.value)} placeholder="Passing score (%)" className="px-3 py-2 rounded bg-white/10 text-white border border-white/20" />
              </div>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Instructions shown to the candidate before they start (optional)" rows={2} className="w-full px-3 py-2 rounded bg-white/10 text-white border border-white/20" />

              <div className="flex flex-wrap items-center gap-2 rounded border border-indigo-400/30 bg-indigo-500/10 p-3">
                <Sparkles className="w-4 h-4 text-indigo-300 flex-shrink-0" />
                <span className="text-xs text-gray-300">Generate questions from this job's title, department, and description</span>
                <input
                  type="number" min="1" max="20" value={generateCount}
                  onChange={(e) => setGenerateCount(e.target.value)}
                  className="w-16 px-2 py-1 rounded bg-white/10 text-white border border-white/20 text-sm"
                />
                <button
                  disabled={generating}
                  onClick={generateWithAI}
                  className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1.5"
                >
                  {generating ? <><Loader className="w-3.5 h-3.5 animate-spin" /> Generating…</> : <><Sparkles className="w-3.5 h-3.5" /> Generate with AI</>}
                </button>
              </div>

              <div className="space-y-4">
                {questions.map((q, index) => (
                  <div key={q.key} className="rounded border border-white/10 bg-white/5 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-white">Question {index + 1}</p>
                      {questions.length > 1 && <button onClick={() => removeQuestion(q.key)} className="text-red-300 hover:text-white"><Trash2 className="w-4 h-4" /></button>}
                    </div>
                    <textarea value={q.questionText} onChange={(e) => updateQuestion(q.key, { questionText: e.target.value })} placeholder="Question text" rows={2} className="w-full px-3 py-2 rounded bg-white/10 text-white border border-white/20 text-sm" />
                    <div className="grid md:grid-cols-2 gap-2">
                      {q.options.map((option) => (
                        <label key={option.id} className="flex items-center gap-2 text-xs text-gray-300">
                          <input type="radio" name={`correct_${q.key}`} checked={q.correctOptionId === option.id} onChange={() => updateQuestion(q.key, { correctOptionId: option.id })} title="Mark as correct answer" />
                          <input value={option.text} onChange={(e) => updateOption(q.key, option.id, e.target.value)} placeholder={`Option ${option.id.toUpperCase()}`} className="flex-1 px-2 py-1.5 rounded bg-white/10 text-white border border-white/20" />
                        </label>
                      ))}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      Points:
                      <input type="number" min="1" value={q.points} onChange={(e) => updateQuestion(q.key, { points: e.target.value })} className="w-16 px-2 py-1 rounded bg-white/10 text-white border border-white/20" />
                      <span className="text-gray-500">Select the radio button next to the correct option.</span>
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={addQuestion} className="text-sm text-purple-300 hover:text-purple-200 flex items-center gap-1"><Plus className="w-4 h-4" /> Add question</button>

              {error && <p className="text-red-300 text-sm">{error}</p>}
              <div className="flex flex-wrap justify-end gap-2 pt-2">
                <button onClick={() => onClose(false)} className="px-4 py-2 rounded text-gray-300 hover:text-white">Cancel</button>
                <button disabled={saving} onClick={() => save('draft')} className="px-4 py-2 rounded bg-white/10 hover:bg-white/20 text-white font-semibold">{saving ? 'Saving…' : 'Save as draft'}</button>
                <button disabled={saving} onClick={() => save('published')} className="px-4 py-2 rounded bg-purple-600 hover:bg-purple-500 text-white font-semibold flex items-center gap-2"><Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Publish test'}</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CMMSWrittenTestBuilder;

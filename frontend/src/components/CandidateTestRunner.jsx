import React, { useEffect, useState } from 'react';
import { CheckCircle2, Clock, Loader2, ShieldCheck, X, XCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import AuthPage from './auth/AuthPage';
import cmmsWrittenTestService from '../services/cmmsWrittenTestService';

/**
 * Standalone page at /candidate-test?token=<access_token> (see main.jsx).
 * A candidate must hold a lightweight ICAN account to take a test -- if
 * they arrive signed out, this shows AuthPage pre-filled from their
 * application (name/email/phone), then links the new account to their
 * application once they're in, then runs the timed MCQ test.
 */
const CandidateTestRunner = () => {
  const { user, loading: authLoading, signOut } = useAuth();
  const token = new URLSearchParams(window.location.search).get('token') || '';

  const [prefill, setPrefill] = useState(null);
  const [phase, setPhase] = useState('loading'); // loading | auth | linking | link-error | intro | in-progress | submitted | error
  const [error, setError] = useState('');
  const [assignment, setAssignment] = useState(null);
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(null);

  useEffect(() => {
    if (!token) { setPhase('error'); setError('This test link is missing its access code.'); return; }
    if (authLoading) return;

    if (!user) {
      cmmsWrittenTestService.getTestPrefillContact(token).then((result) => {
        if (!result.success) { setPhase('error'); setError('This test link is invalid or has expired.'); return; }
        setPrefill({ email: result.data.applicant_email, fullName: result.data.applicant_name, phone: result.data.applicant_phone });
        setPhase('auth');
      });
      return;
    }

    const linkAndLoad = async () => {
      setPhase('linking');
      const linkResult = await cmmsWrittenTestService.linkIcanAccountViaTestToken(token);
      if (!linkResult.success) { setError(linkResult.error); setPhase('link-error'); return; }

      const assignmentResult = await cmmsWrittenTestService.getTestAssignmentByToken(token);
      if (!assignmentResult.success) { setError(assignmentResult.error); setPhase('error'); return; }
      setAssignment(assignmentResult.data);

      if (assignmentResult.data.status === 'completed') {
        setResult({ score: assignmentResult.data.score, maxScore: assignmentResult.data.maxScore });
        setPhase('submitted');
      } else if (assignmentResult.data.status === 'in_progress') {
        setPhase('in-progress');
      } else {
        setPhase('intro');
      }
    };
    linkAndLoad();
  }, [user, authLoading, token]);

  useEffect(() => {
    if (phase !== 'in-progress' || !assignment?.expiresAt) { setRemainingSeconds(null); return; }
    const tick = () => {
      const seconds = Math.max(0, Math.round((new Date(assignment.expiresAt).getTime() - Date.now()) / 1000));
      setRemainingSeconds(seconds);
      if (seconds === 0) submit();
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, assignment?.expiresAt]);

  const startTest = async () => {
    const startResult = await cmmsWrittenTestService.startTestAssignment(token);
    if (!startResult.success) { setError(startResult.error); setPhase('error'); return; }
    setAssignment((current) => ({ ...current, startedAt: startResult.data.started_at, expiresAt: startResult.data.expires_at }));
    setPhase('in-progress');
  };

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    const payload = Object.entries(answers).map(([questionId, selectedOptionId]) => ({ question_id: questionId, selected_option_id: selectedOptionId }));
    const submitResult = await cmmsWrittenTestService.submitTestAssignment(token, payload);
    setSubmitting(false);
    if (!submitResult.success) { setError(submitResult.error); setPhase('error'); return; }
    setResult({ score: submitResult.data.score, maxScore: submitResult.data.max_score });
    setPhase('submitted');
  };

  const formatClock = (seconds) => {
    if (seconds === null) return '';
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  if (phase === 'loading' || phase === 'linking' || authLoading) {
    return <main className="min-h-screen flex items-center justify-center bg-slate-950 text-white"><Loader2 className="w-8 h-8 animate-spin" /></main>;
  }

  if (phase === 'auth') {
    return <AuthPage initialView="signup" prefill={prefill} onAuthSuccess={() => {}} />;
  }

  if (phase === 'link-error') {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-950 px-4 text-white">
        <div className="max-w-md w-full rounded-2xl border border-white/10 bg-slate-900/80 p-6 text-center">
          <XCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
          <p className="mb-4">{error}</p>
          <button onClick={() => signOut()} className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-semibold">Sign in with a different account</button>
        </div>
      </main>
    );
  }

  if (phase === 'error') {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-950 px-4 text-white text-center">
        <div><XCircle className="w-10 h-10 text-red-400 mx-auto mb-3" /><p>{error}</p></div>
      </main>
    );
  }

  if (phase === 'submitted') {
    const passed = result?.maxScore ? (result.score / result.maxScore) * 100 : 0;
    // A same-tab link (e.g. the "Take your written test" button on the
    // public tracking page) can't be closed via window.close() -- browsers
    // silently refuse to close a tab a script didn't open. Try anyway (it
    // works for the email-link/new-tab case), then fall back to sending the
    // candidate back to the public site instead of leaving them stranded.
    const closePage = () => {
      window.close();
      setTimeout(() => { window.location.href = '/'; }, 200);
    };
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-950 px-4 text-white">
        <div className="max-w-md w-full relative rounded-2xl border border-white/10 bg-slate-900/80 p-8 text-center">
          <button
            onClick={closePage}
            aria-label="Close"
            className="absolute top-3 right-3 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10"
          >
            <X className="w-5 h-5" />
          </button>
          <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
          <h1 className="text-xl font-bold mb-1">Test submitted</h1>
          <p className="text-slate-300 mb-4">Your score: <span className="font-bold">{result?.score} / {result?.maxScore}</span> ({passed.toFixed(0)}%)</p>
          <p className="text-sm text-slate-500 mb-5">The hiring team has been notified. You can close this page now.</p>
          <button onClick={closePage} className="w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 font-semibold text-sm">Close</button>
        </div>
      </main>
    );
  }

  if (phase === 'intro') {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-950 px-4 text-white">
        <div className="max-w-lg w-full rounded-2xl border border-white/10 bg-slate-900/80 p-8">
          <div className="flex items-center gap-3 mb-4"><ShieldCheck className="w-8 h-8 text-indigo-300" /><div><p className="text-sm text-slate-400">{assignment.companyName}</p><h1 className="text-xl font-bold">{assignment.testTitle}</h1></div></div>
          {assignment.testDescription && <p className="text-slate-300 mb-4">{assignment.testDescription}</p>}
          <ul className="text-sm text-slate-400 space-y-1 mb-6">
            <li>• {assignment.questions.length} question{assignment.questions.length === 1 ? '' : 's'}</li>
            {assignment.timeLimitMinutes && <li>• Time limit: {assignment.timeLimitMinutes} minutes, once you start</li>}
            <li>• You can only take this test once</li>
          </ul>
          <button onClick={startTest} className="w-full py-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 font-semibold">Start test</button>
        </div>
      </main>
    );
  }

  // in-progress
  const answeredCount = Object.keys(answers).length;
  return (
    <main className="min-h-screen bg-slate-950 text-white px-4 py-8">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6 sticky top-0 bg-slate-950/95 backdrop-blur py-3">
          <h1 className="text-lg font-bold">{assignment.testTitle}</h1>
          {remainingSeconds !== null && (
            <span className={`flex items-center gap-1 text-sm font-mono ${remainingSeconds < 60 ? 'text-red-400' : 'text-slate-300'}`}>
              <Clock className="w-4 h-4" /> {formatClock(remainingSeconds)}
            </span>
          )}
        </div>
        <div className="space-y-5">
          {assignment.questions.map((q, index) => (
            <div key={q.id} className="rounded-xl border border-white/10 bg-slate-900/70 p-4">
              <p className="font-semibold mb-3">{index + 1}. {q.text}</p>
              <div className="space-y-2">
                {q.options.map((option) => (
                  <label key={option.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer ${answers[q.id] === option.id ? 'border-indigo-400 bg-indigo-500/10' : 'border-white/10 hover:border-white/20'}`}>
                    <input type="radio" name={`q_${q.id}`} checked={answers[q.id] === option.id} onChange={() => setAnswers((prev) => ({ ...prev, [q.id]: option.id }))} />
                    <span className="text-sm">{option.text}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-6 flex items-center justify-between">
          <p className="text-sm text-slate-400">{answeredCount} / {assignment.questions.length} answered</p>
          <button disabled={submitting} onClick={submit} className="px-6 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 font-semibold disabled:opacity-50">{submitting ? 'Submitting…' : 'Submit test'}</button>
        </div>
      </div>
    </main>
  );
};

export default CandidateTestRunner;

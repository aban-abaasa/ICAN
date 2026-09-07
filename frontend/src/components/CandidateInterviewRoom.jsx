import React, { useEffect, useState } from 'react';
import { Loader2, ShieldCheck, XCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import AuthPage from './auth/AuthPage';
import LiveBoardroom from './LiveBoardroom';
import cmmsInterviewService from '../services/cmmsInterviewService';

/**
 * Standalone page at /candidate-interview?scheduleId=<id> (see main.jsx).
 * Same account-linking flow as CandidateTestRunner, then drops straight
 * into the existing full-mesh LiveBoardroom call once fn_can_join_interview
 * confirms the signed-in user is either the linked candidate or one of the
 * named interviewers.
 */
const CandidateInterviewRoom = () => {
  const { user, loading: authLoading, signOut } = useAuth();
  const scheduleId = new URLSearchParams(window.location.search).get('scheduleId') || '';

  const [prefill, setPrefill] = useState(null);
  const [phase, setPhase] = useState('loading'); // loading | auth | linking | link-error | room | error
  const [error, setError] = useState('');
  const [access, setAccess] = useState(null);

  useEffect(() => {
    if (!scheduleId) { setPhase('error'); setError('This interview link is missing its schedule id.'); return; }
    if (authLoading) return;

    if (!user) {
      cmmsInterviewService.getInterviewPrefillContact(scheduleId).then((result) => {
        if (!result.success) { setPhase('error'); setError('This interview link is invalid.'); return; }
        setPrefill({ email: result.data.applicant_email, fullName: result.data.applicant_name, phone: result.data.applicant_phone });
        setPhase('auth');
      });
      return;
    }

    const linkAndCheck = async () => {
      setPhase('linking');
      // A staff interviewer already has an ICAN account and reaches this
      // page from inside the app rather than a fresh signup, so linking is
      // only attempted (and only matters) for the candidate side -- an
      // email mismatch here just means "not the candidate", which
      // fn_can_join_interview below will also correctly refuse for anyone
      // who isn't a named interviewer either.
      await cmmsInterviewService.linkIcanAccountViaInterviewSchedule(scheduleId).catch(() => null);

      const result = await cmmsInterviewService.canJoinInterview(scheduleId);
      if (!result.success) { setError(result.error); setPhase('error'); return; }
      if (!result.data?.can_join) {
        setError(result.data?.status === 'cancelled' ? 'This interview has been cancelled.' : 'You are not authorized to join this interview.');
        setPhase('link-error');
        return;
      }
      setAccess(result.data);
      setPhase('room');
    };
    linkAndCheck();
  }, [user, authLoading, scheduleId]);

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

  if (phase !== 'room' || !access) {
    return <main className="min-h-screen flex items-center justify-center bg-slate-950 text-white"><ShieldCheck className="w-8 h-8" /></main>;
  }

  const members = access.is_interviewer
    ? [{ id: access.candidate_ican_user_id, email: access.candidate_name }]
    : (access.members || []);

  return (
    <div className="fixed inset-0 bg-black">
      <LiveBoardroom
        groupId={access.room_id}
        groupName={`Interview — ${access.candidate_name}`}
        members={members}
        creatorId={null}
        context="cmms-interview"
        onClose={() => { window.location.href = '/'; }}
        autoStart
      />
    </div>
  );
};

export default CandidateInterviewRoom;

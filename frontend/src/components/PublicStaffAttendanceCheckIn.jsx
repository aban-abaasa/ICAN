import React, { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, MapPin, ShieldCheck } from 'lucide-react';
import { supabase } from '../lib/supabase/client';

const PublicStaffAttendanceCheckIn = () => {
  const token = new URLSearchParams(window.location.search).get('token') || '';
  const [qr, setQr] = useState(null);
  const [session, setSession] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [position, setPosition] = useState(null);
  const [status, setStatus] = useState('loading');
  const [message, setMessage] = useState('Verifying attendance QR code...');

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      if (!token) return setStatus('error');
      const [{ data: qrData, error }, { data: sessionData }] = await Promise.all([
        supabase.rpc('resolve_cmms_attendance_qr', { p_token: token }), supabase.auth.getSession()
      ]);
      if (!mounted) return;
      if (error || !qrData?.[0]) { setStatus('error'); setMessage('This QR code is invalid or has been deactivated.'); return; }
      setQr(qrData[0]); setSession(sessionData.session); setStatus('ready');
      setMessage(sessionData.session ? 'Choose your attendance action.' : 'Sign in with your staff account to continue.');
    };
    load();
    navigator.geolocation?.getCurrentPosition(({ coords }) => setPosition({ latitude: coords.latitude, longitude: coords.longitude }), () => undefined, { enableHighAccuracy: true, timeout: 10000 });
    return () => { mounted = false; };
  }, [token]);

  const signIn = async (event) => {
    event.preventDefault(); setStatus('working');
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) { setStatus('ready'); setMessage(error.message); return; }
    setSession(data.session); setPassword(''); setStatus('ready'); setMessage('Staff account verified. Choose your attendance action.');
  };

  const recordAttendance = async (action) => {
    setStatus('working'); setMessage(`Recording your check-${action}...`);
    const { data, error } = await supabase.rpc(action === 'in' ? 'staff_check_in_with_qr' : 'staff_check_out_with_qr', {
      p_token: token, p_latitude: position?.latitude ?? null, p_longitude: position?.longitude ?? null
    });
    if (error) { setStatus('ready'); setMessage(error.message); return; }
    setStatus('complete'); setMessage(data?.message || `Check-${action} recorded.`);
  };

  return <main className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-950 px-4 py-10 text-white"><section className="mx-auto w-full max-w-md rounded-3xl border border-white/10 bg-slate-900/80 p-7 shadow-2xl backdrop-blur"><div className="mb-6 flex items-center gap-3"><div className="rounded-2xl bg-indigo-500/20 p-3"><ShieldCheck className="h-7 w-7 text-indigo-300" /></div><div><p className="text-xs font-semibold uppercase tracking-widest text-indigo-300">ICAN CMMS</p><h1 className="text-xl font-bold">Staff attendance</h1></div></div>{qr && <div className="mb-6 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4"><p className="font-semibold">{qr.company_name}</p><p className="mt-1 flex items-center gap-1 text-sm text-emerald-100"><MapPin className="h-4 w-4" /> {qr.location_name}</p></div>}{['loading', 'working'].includes(status) && <div className="flex items-center gap-3 text-slate-300"><Loader2 className="h-5 w-5 animate-spin" /> {message}</div>}{status === 'error' && <p className="rounded-xl bg-red-500/15 p-4 text-sm text-red-100">{message}</p>}{status === 'complete' && <div className="rounded-2xl bg-emerald-500/15 p-5 text-center"><CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-emerald-300" /><p className="font-semibold">{message}</p></div>}{status === 'ready' && qr && !session && <form onSubmit={signIn} className="space-y-4"><p className="text-sm text-slate-300">{message}</p><input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Staff email" className="w-full rounded-xl border border-white/15 bg-white/5 p-3" /><input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" className="w-full rounded-xl border border-white/15 bg-white/5 p-3" /><button className="w-full rounded-xl bg-indigo-600 px-4 py-3 font-semibold">Verify staff account</button></form>}{status === 'ready' && qr && session && <div className="space-y-4"><p className="text-sm text-slate-300">{message}</p><div className="grid grid-cols-2 gap-3"><button onClick={() => recordAttendance('in')} className="rounded-xl bg-emerald-600 px-4 py-3 font-semibold">Check in</button><button onClick={() => recordAttendance('out')} className="rounded-xl bg-rose-600 px-4 py-3 font-semibold">Check out</button></div></div>}</section></main>;
};

export default PublicStaffAttendanceCheckIn;

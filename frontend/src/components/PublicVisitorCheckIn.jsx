import React, { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, MapPin, Users } from 'lucide-react';
import { supabase } from '../lib/supabase/client';

const PublicVisitorCheckIn = () => {
  const token = new URLSearchParams(window.location.search).get('token') || '';
  const [qr, setQr] = useState(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '', origin: '', host: '', purpose: '' });
  const [position, setPosition] = useState(null);
  const [state, setState] = useState({ status: 'loading', message: 'Opening visitor check-in…' });

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!token) return setState({ status: 'error', message: 'This visitor link is missing its QR token. Please scan the code again.' });
      const { data, error } = await supabase.rpc('resolve_cmms_visitor_qr', { p_token: token });
      if (!active) return;
      const details = Array.isArray(data) ? data[0] : data;
      if (error || !details) return setState({ status: 'error', message: 'This visitor QR code is invalid or has been deactivated.' });
      setQr(details);
      setForm((current) => ({ ...current, host: details.host_email || '', purpose: details.purpose || '' }));
      setState({ status: 'ready', message: '' });
    };
    load();
    navigator.geolocation?.getCurrentPosition(
      ({ coords }) => setPosition({ latitude: coords.latitude, longitude: coords.longitude }),
      () => undefined,
      { enableHighAccuracy: true, timeout: 10000 }
    );
    return () => { active = false; };
  }, [token]);

  const update = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  const submit = async (event) => {
    event.preventDefault();
    setState({ status: 'working', message: 'Recording your arrival…' });
    const { data, error } = await supabase.rpc('visitor_check_in_with_qr', {
      p_token: token,
      p_visitor_name: form.name.trim(),
      p_visitor_email: form.email.trim() || null,
      p_visitor_phone: form.phone.trim() || null,
      p_visitor_origin: form.origin.trim() || null,
      p_host_contact: form.host.trim() || null,
      p_purpose: form.purpose.trim() || null,
      p_latitude: position?.latitude ?? null,
      p_longitude: position?.longitude ?? null
    });
    if (error) return setState({ status: 'ready', message: error.message || 'Could not complete check-in.' });
    setState({ status: 'complete', message: data?.message || 'You are checked in. Please wait for your host.' });
  };

  return <main className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-950 px-4 py-10 text-white"><section className="mx-auto w-full max-w-md rounded-3xl border border-white/10 bg-slate-900/80 p-7 shadow-2xl backdrop-blur"><div className="mb-6 flex items-center gap-3"><div className="rounded-2xl bg-indigo-500/20 p-3"><Users className="h-7 w-7 text-indigo-300" /></div><div><p className="text-xs font-semibold uppercase tracking-widest text-indigo-300">ICAN CMMS</p><h1 className="text-xl font-bold">Visitor check-in</h1></div></div>{qr && <div className="mb-6 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4"><p className="font-semibold">{qr.company_name}</p><p className="mt-1 flex items-center gap-1 text-sm text-emerald-100"><MapPin className="h-4 w-4" /> {qr.location_name}</p></div>}{['loading', 'working'].includes(state.status) && <div className="flex items-center gap-3 text-slate-300"><Loader2 className="h-5 w-5 animate-spin" /> {state.message}</div>}{state.status === 'error' && <p className="rounded-xl bg-red-500/15 p-4 text-sm text-red-100">{state.message}</p>}{state.status === 'complete' && <div className="rounded-2xl bg-emerald-500/15 p-5 text-center"><CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-emerald-300" /><p className="font-semibold">{state.message}</p></div>}{state.status === 'ready' && qr && <form onSubmit={submit} className="space-y-3"><input required value={form.name} onChange={update('name')} placeholder="Your full name *" className="w-full rounded-xl border border-white/15 bg-white/5 p-3 outline-none focus:border-indigo-400" /><input type="email" value={form.email} onChange={update('email')} placeholder="Email address" className="w-full rounded-xl border border-white/15 bg-white/5 p-3 outline-none focus:border-indigo-400" /><input required value={form.phone} onChange={update('phone')} placeholder="Phone number *" className="w-full rounded-xl border border-white/15 bg-white/5 p-3 outline-none focus:border-indigo-400" /><input required value={form.origin} onChange={update('origin')} placeholder="Where are you coming from? *" className="w-full rounded-xl border border-white/15 bg-white/5 p-3 outline-none focus:border-indigo-400" /><input required value={form.host} onChange={update('host')} placeholder="Who are you visiting? *" className="w-full rounded-xl border border-white/15 bg-white/5 p-3 outline-none focus:border-indigo-400" /><input value={form.purpose} onChange={update('purpose')} placeholder="Purpose of visit" className="w-full rounded-xl border border-white/15 bg-white/5 p-3 outline-none focus:border-indigo-400" />{state.message && <p className="text-sm text-red-200">{state.message}</p>}<button className="w-full rounded-xl bg-indigo-600 px-4 py-3 font-semibold hover:bg-indigo-500">Check in</button></form>}</section></main>;
};

export default PublicVisitorCheckIn;

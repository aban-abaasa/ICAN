import React, { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, MapPin, Star, Users } from 'lucide-react';
import { supabase } from '../lib/supabase/client';

const Stars = ({ value, onChange }) => (
  <div className="flex gap-1">
    {[1, 2, 3, 4, 5].map((n) => (
      <button key={n} type="button" onClick={() => onChange(n)} aria-label={`${n} star`}>
        <Star className={`h-7 w-7 ${value >= n ? 'fill-amber-400 text-amber-400' : 'text-slate-500'}`} />
      </button>
    ))}
  </div>
);

const PublicVisitorCheckIn = () => {
  const token = new URLSearchParams(window.location.search).get('token') || '';
  const [qr, setQr] = useState(null); const [action, setAction] = useState('in');
  const [form, setForm] = useState({ name: '', email: '', phone: '', origin: '', host: '', purpose: '', vehicle: '' });
  const [position, setPosition] = useState(null); const [state, setState] = useState({ status: 'loading', message: 'Opening visitor QR code...' });
  // Only set on check-out (from visitor_check_out_with_qr's response) — this
  // is what lets the rating, left below optionally, be tied back to this
  // specific visit without the visitor ever signing in.
  const [checkedOutVisitorId, setCheckedOutVisitorId] = useState(null);
  const [rating, setRating] = useState({ staff: 0, department: 0, comment: '' });
  const [ratingState, setRatingState] = useState('idle'); // idle, saving, done, skipped
  const [ratingError, setRatingError] = useState('');
  useEffect(() => { let active = true; const load = async () => { if (!token) return setState({ status: 'error', message: 'This visitor link is missing its QR token.' }); const { data, error } = await supabase.rpc('resolve_cmms_visitor_qr', { p_token: token }); const details = Array.isArray(data) ? data[0] : data; if (!active) return; if (error || !details) return setState({ status: 'error', message: 'This visitor QR code is invalid or has been deactivated.' }); setQr(details); document.title = `${details.company_name} | IcanEra Visitor Check-In`; setForm((current) => ({ ...current, host: details.host_email || '', purpose: details.purpose || '' })); setState({ status: 'ready', message: '' }); }; load(); navigator.geolocation?.getCurrentPosition(({ coords }) => setPosition({ latitude: coords.latitude, longitude: coords.longitude }), () => undefined); return () => { active = false; }; }, [token]);
  const update = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  const submit = async (event) => { event.preventDefault(); setState({ status: 'working', message: `Recording check-${action}...` }); const args = action === 'in' ? { p_token: token, p_visitor_name: form.name.trim(), p_visitor_email: form.email.trim() || null, p_visitor_phone: form.phone.trim(), p_visitor_origin: form.origin.trim() || null, p_host_contact: form.host.trim(), p_purpose: form.purpose.trim() || null, p_latitude: position?.latitude ?? null, p_longitude: position?.longitude ?? null, p_vehicle_number: form.vehicle.trim() || null } : { p_token: token, p_visitor_name: form.name.trim(), p_visitor_phone: form.phone.trim(), p_latitude: position?.latitude ?? null, p_longitude: position?.longitude ?? null }; const { data, error } = await supabase.rpc(action === 'in' ? 'visitor_check_in_with_qr' : 'visitor_check_out_with_qr', args); if (error) return setState({ status: 'ready', message: error.message }); if (action === 'out' && data?.visitor_id) setCheckedOutVisitorId(data.visitor_id); setState({ status: 'complete', message: data?.message || `Check-${action} recorded.` }); };
  const submitRating = async (event) => {
    event.preventDefault();
    if (!checkedOutVisitorId) return;
    setRatingState('saving');
    setRatingError('');
    const { error } = await supabase.rpc('submit_visitor_rating', {
      p_visitor_id: checkedOutVisitorId,
      p_staff_rating: rating.staff > 0 ? rating.staff : null,
      p_department_rating: rating.department > 0 ? rating.department : null,
      p_comment: rating.comment.trim() || null
    });
    if (error) {
      setRatingState('idle');
      setRatingError(error.message || 'Could not save your rating. Please try again.');
    } else {
      setRatingState('done');
    }
  };
  return <main className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-950 px-4 py-10 text-white"><section className="mx-auto w-full max-w-md rounded-3xl border border-white/10 bg-slate-900/80 p-7 shadow-2xl"><div className="mb-6 flex items-center gap-3"><div className="rounded-2xl bg-indigo-500/20 p-3"><Users className="h-7 w-7 text-indigo-300" /></div><div><p className="text-xs font-semibold uppercase tracking-widest text-indigo-300">IcanEra</p><h1 className="text-xl font-bold">{qr?.company_name || 'Visitor attendance'}</h1><p className="text-sm text-slate-400">Visitor attendance</p></div></div>{qr && <div className="mb-6 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4"><p className="text-xs font-semibold uppercase tracking-widest text-emerald-200">Check-in location</p><p className="mt-1 flex items-center gap-1 text-sm text-emerald-100"><MapPin className="h-4 w-4" /> {qr.location_name}</p></div>}{['loading', 'working'].includes(state.status) && <div className="flex items-center gap-3 text-slate-300"><Loader2 className="h-5 w-5 animate-spin" /> {state.message}</div>}{state.status === 'error' && <p className="rounded-xl bg-red-500/15 p-4">{state.message}</p>}{state.status === 'complete' && <div className="space-y-4"><div className="rounded-2xl bg-emerald-500/15 p-5 text-center"><CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-emerald-300" /><p className="font-semibold">{state.message}</p></div>{checkedOutVisitorId && ratingState !== 'skipped' && (ratingState === 'done' ? <div className="rounded-2xl border border-white/10 bg-white/5 p-5 text-center text-sm text-slate-300">Thanks for the feedback!</div> : <form onSubmit={submitRating} className="space-y-4 rounded-2xl border border-white/10 bg-white/5 p-5"><p className="text-sm font-semibold text-white">How was your visit? <span className="font-normal text-slate-400">(optional)</span></p><div><p className="mb-1 text-xs text-slate-400">Rate the staff member who hosted you</p><Stars value={rating.staff} onChange={(n) => setRating((v) => ({ ...v, staff: n }))} /></div><div><p className="mb-1 text-xs text-slate-400">Rate their department</p><Stars value={rating.department} onChange={(n) => setRating((v) => ({ ...v, department: n }))} /></div><textarea value={rating.comment} onChange={(e) => setRating((v) => ({ ...v, comment: e.target.value }))} placeholder="Anything you'd like to add (optional)" rows={2} className="w-full rounded-xl border border-white/15 bg-white/5 p-3 text-sm" />{ratingError && <p className="text-sm text-red-300">{ratingError}</p>}<div className="flex gap-2"><button type="button" onClick={() => setRatingState('skipped')} className="flex-1 rounded-xl border border-white/15 p-3 text-sm font-semibold text-slate-300 hover:bg-white/5">Skip</button><button type="submit" disabled={ratingState === 'saving' || (!rating.staff && !rating.department)} className="flex-1 rounded-xl bg-amber-500 p-3 text-sm font-semibold text-slate-950 disabled:opacity-40">{ratingState === 'saving' ? 'Sending…' : 'Submit rating'}</button></div></form>)}</div>}{state.status === 'ready' && qr && <form onSubmit={submit} className="space-y-3"><div className="grid grid-cols-2 gap-3"><button type="button" onClick={() => setAction('in')} className={`rounded-xl p-3 font-semibold ${action === 'in' ? 'bg-indigo-600' : 'bg-white/10'}`}>Check in</button><button type="button" onClick={() => setAction('out')} className={`rounded-xl p-3 font-semibold ${action === 'out' ? 'bg-rose-600' : 'bg-white/10'}`}>Check out</button></div><input required value={form.name} onChange={update('name')} placeholder="Your full name *" className="w-full rounded-xl border border-white/15 bg-white/5 p-3" /><input required value={form.phone} onChange={update('phone')} placeholder="Phone number *" className="w-full rounded-xl border border-white/15 bg-white/5 p-3" />{action === 'in' && <><input type="email" value={form.email} onChange={update('email')} placeholder="Email address" className="w-full rounded-xl border border-white/15 bg-white/5 p-3" /><input required value={form.origin} onChange={update('origin')} placeholder="Where are you coming from? *" className="w-full rounded-xl border border-white/15 bg-white/5 p-3" /><input required value={form.host} onChange={update('host')} placeholder="Who are you visiting? *" className="w-full rounded-xl border border-white/15 bg-white/5 p-3" /><input value={form.purpose} onChange={update('purpose')} placeholder="Purpose of visit" className="w-full rounded-xl border border-white/15 bg-white/5 p-3" /><input value={form.vehicle} onChange={update('vehicle')} placeholder="Vehicle number plate (if driving)" className="w-full rounded-xl border border-white/15 bg-white/5 p-3" /></>}{state.message && <p className="text-sm text-red-200">{state.message}</p>}<button className={`w-full rounded-xl p-3 font-semibold ${action === 'in' ? 'bg-indigo-600' : 'bg-rose-600'}`}>Check {action}</button></form>}</section></main>;
};
export default PublicVisitorCheckIn;

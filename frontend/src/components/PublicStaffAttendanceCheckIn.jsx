import React, { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, MapPin, ShieldCheck } from 'lucide-react';
import { supabase } from '../lib/supabase/client';
import { getCheckoutPayStatusByQr, findWalletPaymentForCheckoutByQr } from '../services/businessManagementService';

const PublicStaffAttendanceCheckIn = () => {
  const token = new URLSearchParams(window.location.search).get('token') || '';
  const [qr, setQr] = useState(null);
  const [session, setSession] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [position, setPosition] = useState(null);
  const [status, setStatus] = useState('loading');
  const [message, setMessage] = useState('Verifying attendance QR code...');
  // Daily-paid staff answer this every check-out; monthly/weekly/hourly/
  // contract staff only once their check-outs this month reach the agreed
  // number of days — cmms_checkout_pay_status_by_qr decides which, and
  // staff_check_out_with_qr refuses to check out until it is answered.
  const [payStatus, setPayStatus] = useState(null);
  const [payAnswer, setPayAnswer] = useState({ paid: null, method: 'cash' });
  // There is no wallet PIN on this self check-out page — an "IcanEra wallet"
  // pay answer can only be confirmed if the business already sent a matching
  // completed wallet payment. 'idle' | 'checking' | 'found' | 'missing'.
  const [walletLookup, setWalletLookup] = useState({ state: 'idle', transactionId: null });

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      if (!token) return setStatus('error');
      const [{ data: qrData, error }, { data: sessionData }] = await Promise.all([
        supabase.rpc('resolve_cmms_attendance_qr', { p_token: token }), supabase.auth.getSession()
      ]);
      if (!mounted) return;
      if (error || !qrData?.[0]) { setStatus('error'); setMessage('This QR code is invalid or has been deactivated.'); return; }
      setQr(qrData[0]); document.title = `${qrData[0].company_name} | IcanEra Attendance`; setSession(sessionData.session); setStatus('ready');
      setMessage(sessionData.session ? 'Choose your attendance action.' : 'Sign in with your staff account to continue.');
    };
    load();
    navigator.geolocation?.getCurrentPosition(({ coords }) => setPosition({ latitude: coords.latitude, longitude: coords.longitude }), () => undefined, { enableHighAccuracy: true, timeout: 10000 });
    return () => { mounted = false; };
  }, [token]);

  useEffect(() => {
    if (!session || !token) return;
    let mounted = true;
    // This is only a preview shown while the staff member is deciding what to
    // do (e.g. so the "confirm your pay" panel doesn't pop in unannounced).
    // It is NOT re-fetched again after this, so a payroll change made later
    // in the same signed-in session (e.g. an admin switching this employee
    // from monthly to daily pay) would go unnoticed here — recordAttendance
    // below re-checks fresh, right before check-out, and is what actually
    // gates the request.
    getCheckoutPayStatusByQr(token).then(({ data }) => { if (mounted) setPayStatus(data || { required: false }); });
    return () => { mounted = false; };
  }, [session, token]);

  useEffect(() => {
    if (payAnswer.paid !== true || payAnswer.method !== 'ican') {
      setWalletLookup({ state: 'idle', transactionId: null });
      return;
    }
    let mounted = true;
    setWalletLookup({ state: 'checking', transactionId: null });
    findWalletPaymentForCheckoutByQr(token).then(({ data }) => {
      if (!mounted) return;
      setWalletLookup(data ? { state: 'found', transactionId: data } : { state: 'missing', transactionId: null });
    });
    return () => { mounted = false; };
  }, [payAnswer.paid, payAnswer.method, token]);

  const signIn = async (event) => {
    event.preventDefault(); setStatus('working');
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) { setStatus('ready'); setMessage(error.message); return; }
    setSession(data.session); setPassword(''); setStatus('ready'); setMessage('Staff account verified. Choose your attendance action.');
  };

  const recordAttendance = async (action) => {
    setStatus('working'); setMessage(`Recording your check-${action}...`);
    let walletTransactionId = null;
    if (action === 'out') {
      // Re-check pay status right now rather than trusting whatever was
      // fetched at sign-in — a payroll change (e.g. monthly -> daily) made
      // since then must not be missed just because this tab stayed open.
      const { data: freshStatus } = await getCheckoutPayStatusByQr(token);
      const status = freshStatus || { required: false };
      setPayStatus(status);
      const decided = !status.required || payAnswer.paid === false || (payAnswer.paid === true && payAnswer.method);
      if (!decided) { setStatus('ready'); setMessage('Confirm your pay below before checking out.'); return; }
      if (status.required && payAnswer.paid === true && payAnswer.method === 'ican') {
        // Re-check right now too — there is no wallet PIN on this page, so
        // "paid via wallet" can only be confirmed against a real, already-
        // completed business-wallet payment, never just trusted from state.
        const { data: freshWalletTx } = await findWalletPaymentForCheckoutByQr(token);
        walletTransactionId = freshWalletTx || null;
        setWalletLookup(walletTransactionId ? { state: 'found', transactionId: walletTransactionId } : { state: 'missing', transactionId: null });
        if (!walletTransactionId) { setStatus('ready'); setMessage('No completed IcanEra wallet payment found yet for this period — ask to be paid via wallet first, or choose cash.'); return; }
      }
    }
    const params = { p_token: token, p_latitude: position?.latitude ?? null, p_longitude: position?.longitude ?? null };
    if (action === 'out') {
      params.p_paid = payAnswer.paid;
      params.p_payment_method = payAnswer.paid ? payAnswer.method : null;
      params.p_wallet_transaction_id = payAnswer.paid && payAnswer.method === 'ican' ? walletTransactionId : null;
    }
    const { data, error } = await supabase.rpc(action === 'in' ? 'staff_check_in_with_qr' : 'staff_check_out_with_qr', params);
    if (error) { setStatus('ready'); setMessage(error.message); return; }
    setStatus('complete'); setMessage(data?.message || `Check-${action} recorded.`);
  };

  const payDecided = !payStatus?.required || payAnswer.paid === false
    || (payAnswer.paid === true && payAnswer.method === 'cash')
    || (payAnswer.paid === true && payAnswer.method === 'ican' && walletLookup.state === 'found');

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-950 px-4 py-10 text-white">
      <section className="mx-auto w-full max-w-md rounded-3xl border border-white/10 bg-slate-900/80 p-7 shadow-2xl backdrop-blur">
        <div className="mb-6 flex items-center gap-3">
          <div className="rounded-2xl bg-indigo-500/20 p-3"><ShieldCheck className="h-7 w-7 text-indigo-300" /></div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-indigo-300">IcanEra</p>
            <h1 className="text-xl font-bold">{qr?.company_name || 'Staff attendance'}</h1>
            <p className="text-sm text-slate-400">Staff attendance</p>
          </div>
        </div>

        {qr && (
          <div className="mb-6 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-200">Attendance location</p>
            <p className="mt-1 flex items-center gap-1 text-sm text-emerald-100"><MapPin className="h-4 w-4" /> {qr.location_name}</p>
          </div>
        )}

        {['loading', 'working'].includes(status) && (
          <div className="flex items-center gap-3 text-slate-300"><Loader2 className="h-5 w-5 animate-spin" /> {message}</div>
        )}

        {status === 'error' && <p className="rounded-xl bg-red-500/15 p-4 text-sm text-red-100">{message}</p>}

        {status === 'complete' && (
          <div className="rounded-2xl bg-emerald-500/15 p-5 text-center">
            <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-emerald-300" />
            <p className="font-semibold">{message}</p>
          </div>
        )}

        {status === 'ready' && qr && !session && (
          <form onSubmit={signIn} className="space-y-4">
            <p className="text-sm text-slate-300">{message}</p>
            <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Staff email" className="w-full rounded-xl border border-white/15 bg-white/5 p-3" />
            <input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" className="w-full rounded-xl border border-white/15 bg-white/5 p-3" />
            <button className="w-full rounded-xl bg-indigo-600 px-4 py-3 font-semibold">Verify staff account</button>
          </form>
        )}

        {status === 'ready' && qr && session && (
          <div className="space-y-4">
            <p className="text-sm text-slate-300">{message}</p>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => recordAttendance('in')} className="rounded-xl bg-emerald-600 px-4 py-3 font-semibold">Check in</button>
              {!payStatus?.required && (
                <button onClick={() => recordAttendance('out')} className="rounded-xl bg-rose-600 px-4 py-3 font-semibold">Check out</button>
              )}
            </div>

            {payStatus === null && <p className="text-xs text-slate-500">Checking today's pay status…</p>}

            {payStatus?.required && (
              <div className="space-y-3 rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4">
                <p className="text-sm font-semibold text-amber-100">
                  Before you check out — {payStatus.pay_frequency === 'daily' ? "confirm today's pay" : 'confirm your pay for this period'}: {' '}
                  {payStatus.currency} {Number(payStatus.amount || 0).toLocaleString()}
                </p>
                <p className="text-xs text-amber-200/80">Have you received this?</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPayAnswer({ paid: true, method: payAnswer.method || 'cash' })}
                    className={`rounded-lg border px-3 py-2 text-sm font-medium ${payAnswer.paid === true ? 'border-emerald-400 bg-emerald-500/20 text-emerald-100' : 'border-white/15 text-slate-200 hover:bg-white/5'}`}
                  >
                    Yes, received
                  </button>
                  <button
                    type="button"
                    onClick={() => setPayAnswer({ paid: false, method: null })}
                    className={`rounded-lg border px-3 py-2 text-sm font-medium ${payAnswer.paid === false ? 'border-rose-400 bg-rose-500/20 text-rose-100' : 'border-white/15 text-slate-200 hover:bg-white/5'}`}
                  >
                    Not yet
                  </button>
                </div>

                {payAnswer.paid === true && (
                  <>
                    <p className="text-xs text-amber-200/80">How was it paid?</p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setPayAnswer((prev) => ({ ...prev, method: 'cash' }))}
                        className={`rounded-lg border px-3 py-2 text-sm font-medium ${payAnswer.method === 'cash' ? 'border-sky-400 bg-sky-500/20 text-sky-100' : 'border-white/15 text-slate-200 hover:bg-white/5'}`}
                      >
                        Cash
                      </button>
                      <button
                        type="button"
                        onClick={() => setPayAnswer((prev) => ({ ...prev, method: 'ican' }))}
                        className={`rounded-lg border px-3 py-2 text-sm font-medium ${payAnswer.method === 'ican' ? 'border-sky-400 bg-sky-500/20 text-sky-100' : 'border-white/15 text-slate-200 hover:bg-white/5'}`}
                      >
                        IcanEra wallet
                      </button>
                    </div>
                    {payAnswer.method === 'ican' && (
                      <p className={`text-xs ${walletLookup.state === 'found' ? 'text-emerald-300' : walletLookup.state === 'missing' ? 'text-rose-300' : 'text-slate-400'}`}>
                        {walletLookup.state === 'checking' && 'Checking for a completed wallet payment…'}
                        {walletLookup.state === 'found' && 'Matching wallet payment found — ready to check out.'}
                        {walletLookup.state === 'missing' && "No completed IcanEra wallet payment found yet for this period. Ask your employer to pay via wallet, or choose cash."}
                      </p>
                    )}
                  </>
                )}

                <button
                  type="button"
                  disabled={!payDecided}
                  onClick={() => recordAttendance('out')}
                  className="w-full rounded-xl bg-rose-600 px-4 py-3 font-semibold disabled:opacity-40"
                >
                  Confirm and check out
                </button>
              </div>
            )}
          </div>
        )}
      </section>
    </main>
  );
};

export default PublicStaffAttendanceCheckIn;

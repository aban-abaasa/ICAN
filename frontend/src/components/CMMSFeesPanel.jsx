import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase/client';
import { useAuth } from '../context/AuthContext';

const emptyForm = { class_name: '', term: '', amount: '', due_date: '' };

export default function CMMSFeesPanel({ companyId, businessProfileId, cmmsUsers = [], studentView = false }) {
  const { user, profile, updateProfile } = useAuth();
  const [fees, setFees] = useState([]);
  const [students, setStudents] = useState([]);
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [identityName, setIdentityName] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [directPaymentAmount, setDirectPaymentAmount] = useState('');
  const [directPaymentNote, setDirectPaymentNote] = useState('School fees payment');
  const [editingFeeId, setEditingFeeId] = useState(null);
  const [feeDetails, setFeeDetails] = useState({ student_name: '', class_name: '', term: '' });

  const load = async () => {
    if (!companyId) return;
    setLoading(true);

    const feeQuery = supabase
      .from('cmms_school_fees')
      .select('*')
      .eq('cmms_company_id', companyId)
      .order('created_at', { ascending: false });

    const studentQuery = !studentView && businessProfileId
      ? supabase
        .from('business_member_roles')
        .select('auth_user_id, department_id, business_roles!inner(role_key, display_name)')
        .eq('business_profile_id', businessProfileId)
        .eq('status', 'active')
        .eq('business_roles.role_key', 'student')
      : Promise.resolve({ data: [], error: null });

    const [{ data, error: feeError }, { data: studentRows, error: studentError }] = await Promise.all([feeQuery, studentQuery]);
    const cmmsStudents = !studentView
      ? cmmsUsers.filter((member) => /student/i.test(String(member.role || '')))
      : [];
    const studentIds = [...new Set([
      ...(studentRows || []).map(row => row.auth_user_id),
      ...cmmsStudents.map(member => member.authUserId),
    ].filter(Boolean))];
    const studentEmails = [...new Set(cmmsStudents.map(member => member.email).filter(Boolean))];
    const [{ data: userRowsById }, { data: userRowsByEmail }, { data: profileRowsById }] = await Promise.all([
      studentIds.length
        ? supabase.from('all_users').select('user_id, email, full_name').in('user_id', studentIds)
        : Promise.resolve({ data: [] }),
      studentEmails.length
        ? supabase.from('all_users').select('user_id, email, full_name').in('email', studentEmails)
        : Promise.resolve({ data: [] }),
      studentIds.length
        ? supabase.from('profiles').select('id, email, full_name').in('id', studentIds)
        : Promise.resolve({ data: [] }),
    ]);
    const profileRows = (profileRowsById || []).map(row => ({
      user_id: row.id,
      email: row.email,
      full_name: row.full_name,
    }));
    const mergedUsers = new Map();
    [...(userRowsById || []), ...(userRowsByEmail || []), ...profileRows].forEach(row => {
      if (!row?.user_id) return;
      const existing = mergedUsers.get(row.user_id) || {};
      mergedUsers.set(row.user_id, {
        ...existing,
        ...row,
        email: row.email || existing.email,
        full_name: row.full_name || existing.full_name,
      });
    });
    const userRows = [...mergedUsers.values()];
    const usersById = new Map(userRows.map(row => [row.user_id, row]));
    const usersByEmail = new Map((userRows || []).map(row => [String(row.email || '').toLowerCase(), row]));
    const businessStudents = (studentRows || []).map(row => {
      const account = usersById.get(row.auth_user_id);
      const fallbackName = account?.email?.split('@')[0] || `Student ${row.auth_user_id.slice(0, 8)}`;
      return { ...row, user: account, display_name: account?.full_name || fallbackName };
    });
    const cmmsOnlyStudents = cmmsStudents.map(member => {
      const account = usersById.get(member.authUserId) || usersByEmail.get(String(member.email || '').toLowerCase());
      const authUserId = member.authUserId || account?.user_id;
      if (!authUserId) return null;
      return {
        auth_user_id: authUserId,
        department_id: member.department_id || null,
        cmms_user_id: member.id,
        user: account || { email: member.email, full_name: member.name },
        display_name: account?.full_name || member.name || member.email?.split('@')[0] || 'Student',
      };
    }).filter(Boolean);
    const enrichedStudents = [...new Map([...businessStudents, ...cmmsOnlyStudents].map(student => [student.auth_user_id, student])).values()];

    setFees(data || []);
    setStudents(enrichedStudents);
    setSelectedStudentId(current => current || enrichedStudents[0]?.auth_user_id || '');
    setError(feeError?.message || studentError?.message || '');
    setLoading(false);
  };

  useEffect(() => { load(); }, [companyId, businessProfileId, cmmsUsers, studentView]);
  useEffect(() => {
    setIdentityName(profile?.full_name || user?.user_metadata?.full_name || '');
  }, [profile?.full_name, user?.user_metadata?.full_name]);

  const currentStudent = useMemo(
    () => students.find(student => student.auth_user_id === user?.id),
    [students, user?.id]
  );

  const selectedStudent = useMemo(
    () => students.find(student => student.auth_user_id === selectedStudentId),
    [students, selectedStudentId]
  );

  const save = async (event) => {
    event.preventDefault();
    setError('');
    setNotice('');

    if (!selectedStudent) {
      setError('Assign at least one student to the school Student role first.');
      return;
    }

    if (selectedStudent.cmms_user_id) {
      const { error: syncError } = await supabase.rpc('sync_cmms_student_business_membership', {
        p_company_id: companyId,
        p_cmms_user_id: selectedStudent.cmms_user_id,
      });
      if (syncError) {
        setError(`Could not link this CMMS Student to the school account: ${syncError.message}`);
        return;
      }
    }

    const { data, error: saveError } = await supabase
      .from('cmms_school_fees')
      .insert({
        cmms_company_id: companyId,
        business_profile_id: businessProfileId,
        student_user_id: selectedStudent.auth_user_id,
        // CMMS and business departments use different UUIDs. The student-role
        // sync maps a matching department server-side; never store a CMMS ID
        // in this business_departments foreign-key column.
        student_department_id: null,
        student_name: selectedStudent.display_name,
        class_name: form.class_name,
        term: form.term,
        amount: Number(form.amount),
        status: 'unpaid',
        due_date: form.due_date || null,
      })
      .select()
      .single();

    if (saveError) {
      setError(saveError.message);
      return;
    }

    setFees(previous => [data, ...previous]);
    setForm(emptyForm);
  };

  const saveIdentity = async (event) => {
    event.preventDefault();
    setError('');
    setNotice('');

    const nextName = identityName.trim();
    if (!studentView && !currentStudent) {
      setError('Your account must be assigned the Student role first.');
      return;
    }
    if (!nextName) {
      setError('Enter your real student name.');
      return;
    }

    try {
      const { error: identityError } = await supabase.rpc('update_school_student_identity', {
        p_business_profile_id: businessProfileId,
        p_full_name: nextName,
      });
      if (identityError) throw identityError;

      try {
        await updateProfile({ full_name: nextName });
      } catch (profileError) {
        console.warn('Profile cache refresh failed after student identity update:', profileError);
      }

      setStudents(previous => previous.map(student => (
        student.auth_user_id === user.id
          ? { ...student, display_name: nextName, user: { ...(student.user || {}), full_name: nextName } }
          : student
      )));
      setFees(previous => previous.map(fee => (
        fee.student_user_id === user.id ? { ...fee, student_name: nextName } : fee
      )));
      setNotice('Your real name was updated for school records.');
      await load();
    } catch (identityError) {
      setError(identityError.message || 'Could not update student name.');
    }
  };

  const payFee = async (fee) => {
    setError('');
    setNotice('');
    if (!window.confirm(`Pay UGX ${Number(fee.amount).toLocaleString()} for ${fee.term} using your ICAN wallet?`)) return;

    try {
      const { data, error: paymentError } = await supabase.rpc('pay_own_school_fee', {
        p_fee_id: fee.id,
      });
      if (paymentError) throw paymentError;
      if (!data?.success) throw new Error(data?.error || 'Payment could not be completed.');

      setFees(previous => previous.map(item => (
        item.id === fee.id ? { ...item, status: 'paid' } : item
      )));
      setNotice(`School fee paid successfully. Transaction: ${data.transaction_id || 'confirmed'}.`);
    } catch (paymentError) {
      setError(paymentError.message || 'Could not pay this school fee.');
    }
  };

  const paySchoolDirectly = async (event) => {
    event.preventDefault();
    setError('');
    setNotice('');
    const amount = Number(directPaymentAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Enter a school payment amount greater than zero.');
      return;
    }
    if (!window.confirm(`Send UGX ${amount.toLocaleString()} to the school ICAN wallet?`)) return;

    try {
      const { data, error: paymentError } = await supabase.rpc('pay_school_fee_to_school_wallet', {
        p_business_profile_id: businessProfileId,
        p_amount_ugx: amount,
        p_note: directPaymentNote,
      });
      if (paymentError) throw paymentError;
      if (!data?.success) throw new Error(data?.error || 'Payment could not be completed.');
      setDirectPaymentAmount('');
      setNotice(`Payment sent to the school wallet. Transaction: ${data.transaction_id || 'confirmed'}.`);
    } catch (paymentError) {
      setError(paymentError.message || 'Could not send the school payment.');
    }
  };

  const saveFeeDetails = async (event) => {
    event.preventDefault();
    setError('');
    setNotice('');
    try {
      const { data, error: updateError } = await supabase.rpc('update_own_school_fee_details', {
        p_fee_id: editingFeeId,
        p_student_name: feeDetails.student_name,
        p_class_name: feeDetails.class_name,
        p_term: feeDetails.term,
      });
      if (updateError) throw updateError;
      setFees(previous => previous.map(fee => fee.id === editingFeeId ? { ...fee, ...data } : fee));
      setEditingFeeId(null);
      setNotice('Your school details were updated.');
    } catch (updateError) {
      setError(updateError.message || 'Could not update your school details.');
    }
  };

  if (studentView) {
    return (
      <div className="space-y-5">
        <div>
          <h2 className="text-2xl font-bold text-white">My School Fees</h2>
          <p className="text-sm text-slate-400">Review only the fee obligations assigned to your student account and pay with your ICAN wallet.</p>
        </div>

        {error && <p className="rounded-lg bg-red-900/30 p-3 text-sm text-red-300">{error}</p>}
        {notice && <p className="rounded-lg bg-emerald-900/30 p-3 text-sm text-emerald-200">{notice}</p>}

        <form onSubmit={saveIdentity} className="grid gap-3 rounded-xl border border-sky-400/20 bg-sky-500/10 p-4 md:grid-cols-[1fr_auto]">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-sky-200">Your real student name</label>
            <input required value={identityName} onChange={event => setIdentityName(event.target.value)} placeholder="Enter your full name" className="mt-2 w-full rounded-lg bg-slate-950 px-3 py-2 text-white" />
            <p className="mt-1 text-xs text-slate-400">This name is shown to the school administrator and updates your assigned fee records.</p>
          </div>
          <button className="self-end rounded-lg bg-sky-600 px-4 py-2 font-semibold text-white hover:bg-sky-500">Save my name</button>
        </form>

        <form onSubmit={paySchoolDirectly} className="grid gap-3 rounded-xl border border-emerald-400/20 bg-emerald-500/10 p-4 md:grid-cols-[1fr_2fr_auto]">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-emerald-200">Amount (UGX)</label>
            <input required type="number" min="1" step="0.01" value={directPaymentAmount} onChange={event => setDirectPaymentAmount(event.target.value)} placeholder="e.g. 50000" className="mt-2 w-full rounded-lg bg-slate-950 px-3 py-2 text-white" />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-emerald-200">Payment note</label>
            <input value={directPaymentNote} onChange={event => setDirectPaymentNote(event.target.value)} placeholder="School fees payment" className="mt-2 w-full rounded-lg bg-slate-950 px-3 py-2 text-white" />
          </div>
          <button className="self-end rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-500">Pay School</button>
        </form>

        {loading ? (
          <p className="text-slate-400">Loading your fees...</p>
        ) : fees.length ? (
          <div className="space-y-3">
            {fees.map(fee => {
              const payable = fee.status === 'unpaid' || fee.status === 'partial';
              return (
                <article key={fee.id} className="rounded-xl border border-white/10 bg-white/5 p-4 text-white">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-semibold">{fee.class_name} · {fee.term}</p>
                      <p className="mt-1 text-sm text-slate-400">Due: {fee.due_date ? new Date(`${fee.due_date}T00:00:00`).toLocaleDateString() : 'Not specified'}</p>
                      <p className="mt-2 text-lg font-bold text-emerald-300">UGX {Number(fee.amount).toLocaleString()}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase ${payable ? 'bg-amber-400/15 text-amber-200' : 'bg-emerald-400/15 text-emerald-200'}`}>{fee.status}</span>
                      <button type="button" onClick={() => { setEditingFeeId(fee.id); setFeeDetails({ student_name: fee.student_name || '', class_name: fee.class_name || '', term: fee.term || '' }); }} className="rounded-lg border border-white/20 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-white/10">Edit details</button>
                      {payable && <button type="button" onClick={() => payFee(fee)} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500">Pay with ICAN</button>}
                    </div>
                  </div>
                  {editingFeeId === fee.id && (
                    <form onSubmit={saveFeeDetails} className="mt-4 grid gap-3 border-t border-white/10 pt-4 md:grid-cols-4">
                      <input required value={feeDetails.student_name} onChange={event => setFeeDetails({ ...feeDetails, student_name: event.target.value })} placeholder="Student name" className="rounded-lg bg-slate-950 px-3 py-2 text-white" />
                      <input required value={feeDetails.class_name} onChange={event => setFeeDetails({ ...feeDetails, class_name: event.target.value })} placeholder="Class name" className="rounded-lg bg-slate-950 px-3 py-2 text-white" />
                      <input required value={feeDetails.term} onChange={event => setFeeDetails({ ...feeDetails, term: event.target.value })} placeholder="Term" className="rounded-lg bg-slate-950 px-3 py-2 text-white" />
                      <button className="rounded-lg bg-violet-600 px-3 py-2 font-semibold text-white">Save details</button>
                    </form>
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-white/10 bg-white/5 p-5 text-sm text-slate-400">No school-fee obligations have been assigned to your account.</div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-white">School Fees</h2>
        <p className="text-sm text-slate-400">Students are automatically loaded from users assigned the Student role.</p>
      </div>

      {currentStudent && (
        <form onSubmit={saveIdentity} className="grid gap-3 rounded-xl border border-emerald-400/20 bg-emerald-500/10 p-4 md:grid-cols-[1fr_auto]">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-emerald-200">Official student name</label>
            <input required value={identityName} onChange={event => setIdentityName(event.target.value)} placeholder="Your real name" className="mt-2 w-full rounded-lg bg-slate-950 px-3 py-2 text-white" />
          </div>
          <button className="self-end rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white">Update name</button>
        </form>
      )}

      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Assigned students</p>
        {students.length ? (
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {students.map(student => (
              <button
                key={`${student.auth_user_id}-${student.department_id || 'none'}`}
                type="button"
                onClick={() => setSelectedStudentId(student.auth_user_id)}
                className={`rounded-lg border px-3 py-3 text-left transition ${selectedStudentId === student.auth_user_id ? 'border-violet-400 bg-violet-500/20 text-white' : 'border-white/10 bg-slate-950/70 text-slate-300 hover:border-white/30'}`}
              >
                <span className="block font-semibold">{student.display_name}</span>
                <span className="block text-xs text-slate-500">{student.user?.email || student.auth_user_id}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">No students assigned yet.</p>
        )}
      </div>

      <form onSubmit={save} className="grid gap-3 rounded-xl border border-white/10 bg-white/5 p-4 md:grid-cols-5">
        <div className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-slate-300">
          <span className="block text-xs text-slate-500">Fee for</span>
          <span className="font-semibold text-white">{selectedStudent?.display_name || 'No assigned student'}</span>
        </div>
        {['class_name', 'term'].map(field => (
          <input key={field} required value={form[field]} onChange={event => setForm({ ...form, [field]: event.target.value })} placeholder={field.replace('_', ' ')} className="rounded-lg bg-slate-900 px-3 py-2 text-white" />
        ))}
        <input required type="number" min="0" value={form.amount} onChange={event => setForm({ ...form, amount: event.target.value })} placeholder="amount" className="rounded-lg bg-slate-900 px-3 py-2 text-white" />
        <input type="date" value={form.due_date} onChange={event => setForm({ ...form, due_date: event.target.value })} className="rounded-lg bg-slate-900 px-3 py-2 text-white" />
        <button disabled={!selectedStudent} className="rounded-lg bg-violet-600 px-3 py-2 font-semibold text-white disabled:opacity-50 md:col-span-5">Add fee obligation</button>
      </form>

      {error && <p className="rounded-lg bg-red-900/30 p-3 text-sm text-red-300">{error}</p>}
      {notice && <p className="rounded-lg bg-emerald-900/30 p-3 text-sm text-emerald-200">{notice}</p>}

      {loading ? (
        <p className="text-slate-400">Loading fees...</p>
      ) : (
        <div className="rounded-xl border border-white/10 p-4 text-white">
          {fees.length ? fees.map(fee => (
            <div key={fee.id} className="flex justify-between border-b border-white/10 py-3">
              <span>{fee.student_name} · {fee.class_name} · {fee.term}</span>
              <span>UGX {Number(fee.amount).toLocaleString()} · {fee.status}</span>
            </div>
          )) : 'No fee records yet.'}
        </div>
      )}
    </div>
  );
}

import React, { useState, useEffect } from 'react';
import { Calendar, Clock, Download, Users, QrCode, MapPin, CheckCircle, XCircle } from 'lucide-react';
import { supabase } from '../lib/supabase/client';
import { getPublicAppUrl } from '../utils/publicAppUrl';

const CMSSAttendancePanel = ({ companyProfile, currentUser, cmmsUsers, userRole, isCreator }) => {
  const [attendanceRecords, setAttendanceRecords] = useState([]);
  const [qrCodes, setQrCodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('records');
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);

  const canManage = userRole === 'admin' || isCreator;

  useEffect(() => {
    loadData();
  }, [companyProfile, selectedDate]);

  const loadData = async () => {
    if (!companyProfile?.id) return;
    setLoading(true);

    const [recordsRes, qrRes] = await Promise.all([
      supabase
        .from('cmms_staff_attendance')
        .select(`
          *,
          staff:user_id (id, full_name, email, avatar_url)
        `)
        .eq('company_id', companyProfile.id)
        .gte('check_in_time', `${selectedDate}T00:00:00`)
        .lte('check_in_time', `${selectedDate}T23:59:59`)
        .order('check_in_time', { ascending: false }),
      
      canManage ? supabase
        .from('cmms_attendance_qr_codes')
        .select('*')
        .eq('company_id', companyProfile.id)
        .order('created_at', { ascending: false }) : { data: [], error: null }
    ]);

    if (recordsRes.data) setAttendanceRecords(recordsRes.data);
    if (qrRes.data) setQrCodes(qrRes.data);
    setLoading(false);
  };

  const generateQRCode = async () => {
    if (!companyProfile?.id) return;

    const locationName = prompt('Enter location name for this attendance QR code:');
    if (!locationName) return;

    const { data, error } = await supabase.rpc('generate_cmms_attendance_qr', {
      p_company_id: companyProfile.id,
      p_location_name: locationName.trim()
    });

    if (error) {
      alert('Failed to generate QR code: ' + error.message);
      return;
    }

    alert('QR code generated successfully!');
    loadData();
  };

  const toggleQRCode = async (qrId, currentStatus) => {
    const { error } = await supabase
      .from('cmms_attendance_qr_codes')
      .update({ is_active: !currentStatus })
      .eq('id', qrId);

    if (error) {
      alert('Failed to update QR code: ' + error.message);
      return;
    }

    loadData();
  };

  const downloadQRCode = (token, locationName) => {
    const url = getPublicAppUrl(`/staff-attendance?token=${token}`);
    
    // Generate a simple text file with the URL
    const content = `ICAN CMMS Staff Attendance\n\nLocation: ${locationName}\nScan URL: ${url}\n\nShare this QR code with staff for attendance tracking.`;
    const blob = new Blob([content], { type: 'text/plain' });
    const downloadUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `attendance-qr-${locationName.replace(/\s+/g, '-')}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(downloadUrl);
  };

  const exportAttendance = () => {
    if (attendanceRecords.length === 0) {
      alert('No attendance records to export');
      return;
    }

    const csv = [
      ['Date', 'Staff Name', 'Email', 'Check In', 'Check Out', 'Location', 'Status'].join(','),
      ...attendanceRecords.map(record => [
        new Date(record.check_in_time).toLocaleDateString(),
        record.staff?.full_name || 'Unknown',
        record.staff?.email || '',
        new Date(record.check_in_time).toLocaleTimeString(),
        record.check_out_time ? new Date(record.check_out_time).toLocaleTimeString() : 'Not checked out',
        record.location_name || '',
        record.check_out_time ? 'Complete' : 'Active'
      ].join(','))
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `attendance-${selectedDate}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const formatDuration = (checkIn, checkOut) => {
    if (!checkOut) return 'Active';
    const duration = new Date(checkOut) - new Date(checkIn);
    const hours = Math.floor(duration / 3600000);
    const minutes = Math.floor((duration % 3600000) / 60000);
    return `${hours}h ${minutes}m`;
  };

  if (loading) {
    return <div className="p-6 text-center">Loading attendance data...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Clock className="h-6 w-6" />
            Staff Attendance
          </h2>
          <p className="text-sm text-slate-400 mt-1">Track and manage staff attendance</p>
        </div>
        {canManage && (
          <button
            onClick={generateQRCode}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded-lg flex items-center gap-2"
          >
            <QrCode className="h-4 w-4" />
            Generate QR Code
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-slate-700">
        <button
          onClick={() => setActiveTab('records')}
          className={`px-4 py-2 font-semibold ${
            activeTab === 'records'
              ? 'border-b-2 border-indigo-500 text-indigo-400'
              : 'text-slate-400 hover:text-slate-300'
          }`}
        >
          Attendance Records
        </button>
        {canManage && (
          <button
            onClick={() => setActiveTab('qr-codes')}
            className={`px-4 py-2 font-semibold ${
              activeTab === 'qr-codes'
                ? 'border-b-2 border-indigo-500 text-indigo-400'
                : 'text-slate-400 hover:text-slate-300'
            }`}
          >
            QR Codes
          </button>
        )}
      </div>

      {/* Attendance Records Tab */}
      {activeTab === 'records' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Calendar className="h-5 w-5 text-slate-400" />
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg"
              />
            </div>
            <button
              onClick={exportAttendance}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg flex items-center gap-2"
            >
              <Download className="h-4 w-4" />
              Export CSV
            </button>
          </div>

          {attendanceRecords.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <Users className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No attendance records for this date</p>
            </div>
          ) : (
            <div className="space-y-3">
              {attendanceRecords.map((record) => (
                <div
                  key={record.id}
                  className="p-4 bg-slate-800 border border-slate-700 rounded-lg hover:border-slate-600 transition"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      {record.staff?.avatar_url ? (
                        <img
                          src={record.staff.avatar_url}
                          alt={record.staff.full_name}
                          className="h-10 w-10 rounded-full"
                        />
                      ) : (
                        <div className="h-10 w-10 rounded-full bg-slate-700 flex items-center justify-center">
                          <Users className="h-5 w-5 text-slate-400" />
                        </div>
                      )}
                      <div>
                        <p className="font-semibold">{record.staff?.full_name || 'Unknown Staff'}</p>
                        <p className="text-sm text-slate-400">{record.staff?.email}</p>
                        {record.location_name && (
                          <p className="text-xs text-slate-500 flex items-center gap-1 mt-1">
                            <MapPin className="h-3 w-3" />
                            {record.location_name}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="flex items-center gap-2 justify-end mb-1">
                        {record.check_out_time ? (
                          <CheckCircle className="h-4 w-4 text-emerald-400" />
                        ) : (
                          <Clock className="h-4 w-4 text-amber-400 animate-pulse" />
                        )}
                        <span className="text-sm font-semibold">
                          {formatDuration(record.check_in_time, record.check_out_time)}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400">
                        In: {new Date(record.check_in_time).toLocaleTimeString()}
                      </p>
                      {record.check_out_time && (
                        <p className="text-xs text-slate-400">
                          Out: {new Date(record.check_out_time).toLocaleTimeString()}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* QR Codes Tab */}
      {activeTab === 'qr-codes' && canManage && (
        <div className="space-y-4">
          {qrCodes.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <QrCode className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No QR codes generated yet</p>
              <button
                onClick={generateQRCode}
                className="mt-4 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded-lg"
              >
                Generate Your First QR Code
              </button>
            </div>
          ) : (
            <div className="grid gap-4">
              {qrCodes.map((qr) => (
                <div
                  key={qr.id}
                  className={`p-4 border rounded-lg ${
                    qr.is_active
                      ? 'bg-emerald-900/20 border-emerald-700'
                      : 'bg-slate-800 border-slate-700'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-semibold">{qr.location_name}</p>
                        {qr.is_active ? (
                          <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 text-xs rounded-full">
                            Active
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 bg-slate-700 text-slate-400 text-xs rounded-full">
                            Inactive
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 mb-2">
                        Created: {new Date(qr.created_at).toLocaleDateString()}
                      </p>
                      <p className="text-xs font-mono text-slate-500 break-all">
                        Token: {qr.token}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => downloadQRCode(qr.token, qr.location_name)}
                        className="p-2 bg-slate-700 hover:bg-slate-600 rounded-lg"
                        title="Download QR Code"
                      >
                        <Download className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => toggleQRCode(qr.id, qr.is_active)}
                        className={`p-2 rounded-lg ${
                          qr.is_active
                            ? 'bg-rose-600 hover:bg-rose-700'
                            : 'bg-emerald-600 hover:bg-emerald-700'
                        }`}
                        title={qr.is_active ? 'Deactivate' : 'Activate'}
                      >
                        {qr.is_active ? (
                          <XCircle className="h-4 w-4" />
                        ) : (
                          <CheckCircle className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default CMSSAttendancePanel;

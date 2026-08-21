import React, { useState, useEffect } from 'react';
import { Calendar, Clock, Download, Users, QrCode, MapPin, CheckCircle, XCircle, Copy, Eye, Search, Filter, Trash2 } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { supabase } from '../lib/supabase/client';
import { getPublicAppUrl } from '../utils/publicAppUrl';
import { downloadCmmsQrPdf } from '../utils/downloadCmmsQrPdf';
import { downloadCmmsRecordsExcel, downloadCmmsRecordsPdf } from '../utils/cmmsRecordExports';

const CMSSAttendancePanel = ({ companyProfile, currentUser, cmmsUsers, userRole, isCreator }) => {
  const [attendanceRecords, setAttendanceRecords] = useState([]);
  const [qrCodes, setQrCodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('records');
  const today = new Date().toISOString().split('T')[0];
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStaffId, setSelectedStaffId] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const canManage = userRole === 'admin' || isCreator;

  useEffect(() => {
    loadData();
  }, [companyProfile, startDate, endDate, selectedStaffId]);

  const loadData = async () => {
    if (!companyProfile?.id) return;
    setLoading(true);

    try {
      const [recordsRes, qrRes] = await Promise.all([
        supabase.rpc('get_attendance_records', {
          p_cmms_company_id: companyProfile.id,
          p_start_date: startDate || null,
          p_end_date: endDate || null,
          p_user_id: canManage && selectedStaffId ? selectedStaffId : null
        }),
        
        canManage ? supabase
          .from('cmms_attendance_qr_locations')
          .select('*')
          .eq('cmms_company_id', companyProfile.id)
          .order('created_at', { ascending: false }) : { data: [], error: null }
      ]);

      // Log errors for debugging
      if (recordsRes.error) {
        console.error('Attendance records error:', recordsRes.error);
      }
      if (qrRes.error) {
        console.error('QR codes error:', qrRes.error);
      }

      // The records RPC includes staff details and works with the attendance RLS policy.
      if (recordsRes.data && recordsRes.data.length > 0) {
        recordsRes.data = recordsRes.data.map(record => ({
          ...record,
          staff: { id: record.cmms_user_id, full_name: record.user_name, email: record.user_email, avatar_url: null }
        }));
      }

      // Set data even if there are errors (empty arrays)
      setAttendanceRecords(recordsRes.data || []);
      setQrCodes(qrRes.data || []);
    } catch (error) {
      console.error('Load data error:', error);
      setAttendanceRecords([]);
      setQrCodes([]);
    } finally {
      setLoading(false);
    }
  };

  const generateQRCode = async () => {
    if (!companyProfile?.id) return;

    const getCurrentPosition = () => new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('This device does not support location services.'));
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0
      });
    });

    let locationName;
    try {
      const { coords } = await getCurrentPosition();
      // Coordinates are reliable even when an address lookup is unavailable.
      locationName = `GPS: ${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)}`;

      // Use a readable address when the public reverse-geocoding service responds.
      try {
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${coords.latitude}&lon=${coords.longitude}`);
        const location = await response.json();
        if (location?.display_name) locationName = location.display_name;
      } catch {
        // Keep the precise GPS fallback.
      }
    } catch (locationError) {
      alert(`Unable to get your current location. Allow location access, then try again. (${locationError.message})`);
      return;
    }

    setLoading(true);
    const { data, error } = await supabase.rpc('create_cmms_attendance_qr_location', {
      p_cmms_company_id: companyProfile.id,
      p_location_name: locationName
    });

    if (error) {
      console.error('QR code generation error:', error);
      alert('Failed to generate QR code: ' + error.message);
      setLoading(false);
      return;
    }

    console.log('QR code generated:', data);

    // If RPC returns data, add it to the state immediately
    if (data && Array.isArray(data) && data.length > 0) {
      const newQR = {
        ...data[0],
        is_active: true,
        created_at: new Date().toISOString(),
        cmms_company_id: companyProfile.id
      };
      setQrCodes(prev => [newQR, ...prev]);
    } else if (data && typeof data === 'object') {
      // Single object response
      const newQR = {
        ...data,
        is_active: true,
        created_at: new Date().toISOString(),
        cmms_company_id: companyProfile.id
      };
      setQrCodes(prev => [newQR, ...prev]);
    }

    // The RPC response contains the new token. Do not immediately replace it
    // with a list query: a restrictive/stale RLS policy can return an empty
    // list even though the code was successfully created.
    setActiveTab('qr-codes');
    alert('QR code generated successfully!');
    setLoading(false);
  };

  const toggleQRCode = async (qrId, currentStatus) => {
    const { error } = await supabase
      .from('cmms_attendance_qr_locations')
      .update({ is_active: !currentStatus })
      .eq('id', qrId);

    if (error) {
      alert('Failed to update QR code: ' + error.message);
      return;
    }

    loadData();
  };

  const deleteQRCode = async (qr) => {
    if (!window.confirm(`Delete the QR code for ${qr.location_name}? Existing staff attendance records will be kept, but this QR code will stop working immediately.`)) return;
    const { error } = await supabase.rpc('delete_cmms_attendance_qr_location', { p_qr_id: qr.id });
    if (error) {
      alert('Failed to delete QR code: ' + error.message);
      return;
    }
    setQrCodes((current) => current.filter((item) => item.id !== qr.id));
  };

  const downloadQRCode = async (token, locationName) => {
    const url = getPublicAppUrl(`/staff-attendance?token=${token}`);
    try {
      await downloadCmmsQrPdf({
        type: 'staff',
        url,
        location: locationName,
        companyName: companyProfile?.company_name
      });
    } catch (error) {
      console.error('QR PDF download error:', error);
      alert('Unable to download the QR code. Please try again.');
    }
  };

  const attendanceColumns = [
    { label: 'Date', value: (record) => new Date(record.check_in_time).toLocaleDateString() },
    { label: 'Staff Name', value: (record) => record.staff?.full_name || 'Unknown' },
    { label: 'Email', value: (record) => record.staff?.email || '' },
    { label: 'Check In', value: (record) => new Date(record.check_in_time).toLocaleTimeString() },
    { label: 'Check Out', value: (record) => record.check_out_time ? new Date(record.check_out_time).toLocaleTimeString() : 'Not checked out' },
    { label: 'Location', value: (record) => record.check_in_location || '' },
    { label: 'Status', value: (record) => record.check_out_time ? 'Complete' : 'Active' }
  ];

  const visibleAttendanceRecords = attendanceRecords.filter((record) => {
    const query = searchTerm.trim().toLowerCase();
    const matchesSearch = !query || [record.staff?.full_name, record.staff?.email, record.check_in_location, record.check_out_location]
      .some((value) => value?.toLowerCase().includes(query));
    const recordStatus = record.check_out_time ? 'complete' : 'active';
    return matchesSearch && (statusFilter === 'all' || statusFilter === recordStatus);
  });

  const staffOptions = cmmsUsers?.filter((user) => user?.is_active !== false)
    .map((user) => ({ id: user.id, label: user.full_name || user.user_name || user.email || 'Unnamed staff' })) || [];
  const payrollReadyCount = visibleAttendanceRecords.filter((record) => Boolean(record.check_out_time)).length;
  const payrollFollowUpCount = visibleAttendanceRecords.length - payrollReadyCount;

  const setDatePreset = (days) => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - (days - 1));
    setStartDate(start.toISOString().split('T')[0]);
    setEndDate(end.toISOString().split('T')[0]);
  };

  const ensureAttendanceRecords = () => {
    if (visibleAttendanceRecords.length === 0) {
      alert('No attendance records to export');
      return false;
    }
    return true;
  };

  const exportAttendanceExcel = async () => {
    if (!ensureAttendanceRecords()) return;
    await downloadCmmsRecordsExcel({ filename: `attendance-${startDate}-to-${endDate}`, sheetName: 'Attendance', columns: attendanceColumns, rows: visibleAttendanceRecords });
  };

  const exportAttendancePdf = async () => {
    if (!ensureAttendanceRecords()) return;
    await downloadCmmsRecordsPdf({ filename: `attendance-${startDate}-to-${endDate}`, title: 'Staff Attendance Report', subtitle: `${companyProfile?.company_name || 'CMMS'} attendance: ${startDate} to ${endDate}`, columns: attendanceColumns, rows: visibleAttendanceRecords });
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
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <Calendar className="h-5 w-5 text-slate-400" />
              <input
                type="date"
                value={startDate}
                max={endDate || undefined}
                onChange={(e) => setStartDate(e.target.value)}
                className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg"
                aria-label="Attendance start date"
              />
              <span className="text-sm text-slate-400">to</span>
              <input type="date" value={endDate} min={startDate || undefined} max={today} onChange={(e) => setEndDate(e.target.value)} className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg" aria-label="Attendance end date" />
              <button onClick={() => setDatePreset(1)} className="px-3 py-2 text-xs bg-slate-700 hover:bg-slate-600 rounded-lg">Today</button>
              <button onClick={() => setDatePreset(7)} className="px-3 py-2 text-xs bg-slate-700 hover:bg-slate-600 rounded-lg">7 days</button>
              <button onClick={() => setDatePreset(30)} className="px-3 py-2 text-xs bg-slate-700 hover:bg-slate-600 rounded-lg">30 days</button>
            </div>
            <div className="flex flex-wrap gap-2">
            <button
              onClick={exportAttendanceExcel}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg flex items-center gap-2"
            >
              <Download className="h-4 w-4" />
              Excel
            </button>
            <button onClick={exportAttendancePdf} className="px-4 py-2 bg-rose-700 hover:bg-rose-600 rounded-lg flex items-center gap-2">
              <Download className="h-4 w-4" /> PDF
            </button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="relative block"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Search staff, email or location" className="w-full rounded-lg border border-slate-700 bg-slate-800 py-2 pl-9 pr-3 text-sm" /></label>
            {canManage && <select value={selectedStaffId} onChange={(e) => setSelectedStaffId(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm"><option value="">All staff</option>{staffOptions.map((staff) => <option key={staff.id} value={staff.id}>{staff.label}</option>)}</select>}
            <label className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm"><Filter className="h-4 w-4 text-slate-400" /><select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-full bg-transparent outline-none"><option value="all">All statuses</option><option value="active">Checked in</option><option value="complete">Checked out</option></select></label>
            <div className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-300">{visibleAttendanceRecords.length} record{visibleAttendanceRecords.length === 1 ? '' : 's'} shown</div>
          </div>

          <div className="flex flex-wrap gap-3 text-sm">
            <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-emerald-300">Payroll review ready: {payrollReadyCount}</span>
            {payrollFollowUpCount > 0 && <span className="rounded-full bg-amber-500/15 px-3 py-1 text-amber-300">Follow up - staff still checked in: {payrollFollowUpCount}</span>}
          </div>

          {visibleAttendanceRecords.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <Users className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No attendance records match these filters</p>
            </div>
          ) : (
            <div className="space-y-3">
              {visibleAttendanceRecords.map((record) => (
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
                        {record.check_in_location && (
                          <p className="text-xs text-slate-500 flex items-center gap-1 mt-1">
                            <MapPin className="h-3 w-3" />
                            {record.check_in_location}
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
                       <p className={`mt-2 text-xs ${record.check_out_time ? 'text-emerald-300' : 'text-amber-300'}`}>
                         {record.check_out_time ? 'Payroll follow-up: ready for payroll review' : 'Payroll follow-up: employee must check out'}
                       </p>
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
              {qrCodes.map((qr) => {
                const qrUrl = getPublicAppUrl(`/staff-attendance?token=${qr.token}`);
                return (
                  <div
                    key={qr.id}
                    className={`p-6 border rounded-lg ${
                      qr.is_active
                        ? 'bg-emerald-900/20 border-emerald-700'
                        : 'bg-slate-800 border-slate-700'
                    }`}
                  >
                    <div className="flex flex-col lg:flex-row gap-6">
                      {/* QR Code Visual */}
                      <div className="flex flex-col items-center gap-3">
                        <div className="p-3 bg-white rounded-lg">
                          <QRCodeSVG 
                            value={qrUrl} 
                            size={180}
                            level="H"
                            includeMargin={true}
                          />
                        </div>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(qrUrl);
                            alert('QR URL copied to clipboard!');
                          }}
                          className="flex items-center gap-2 px-3 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded-lg"
                          title="Copy URL"
                        >
                          <Copy className="h-3 w-3" />
                          Copy URL
                        </button>
                      </div>

                      {/* QR Details */}
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-3">
                          <p className="font-semibold text-lg">{qr.location_name}</p>
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
                        
                        <div className="space-y-2 mb-4">
                          <p className="text-xs text-slate-400">
                            Created: {new Date(qr.created_at).toLocaleDateString()} at {new Date(qr.created_at).toLocaleTimeString()}
                          </p>
                          {qr.last_used_at && (
                            <p className="text-xs text-slate-400">
                              Last Used: {new Date(qr.last_used_at).toLocaleDateString()} at {new Date(qr.last_used_at).toLocaleTimeString()}
                            </p>
                          )}
                          <p className="text-xs text-slate-500 break-all font-mono">
                            Token: {qr.token}
                          </p>
                          <p className="text-xs text-slate-500 break-all font-mono">
                            <a href={qrUrl} target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:text-indigo-300 underline">
                              {qrUrl}
                            </a>
                          </p>
                        </div>

                        <div className="flex gap-2">
                          <button
                            onClick={() => downloadQRCode(qr.token, qr.location_name)}
                            className="flex items-center gap-2 px-3 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 rounded-lg"
                            title="Download QR Code"
                          >
                            <Download className="h-4 w-4" />
                            Download PDF
                          </button>
                          <button
                            onClick={() => toggleQRCode(qr.id, qr.is_active)}
                            className={`flex items-center gap-2 px-3 py-2 text-sm rounded-lg ${
                              qr.is_active
                                ? 'bg-rose-600 hover:bg-rose-700'
                                : 'bg-emerald-600 hover:bg-emerald-700'
                            }`}
                            title={qr.is_active ? 'Deactivate' : 'Activate'}
                          >
                            {qr.is_active ? (
                              <>
                                <XCircle className="h-4 w-4" />
                                Deactivate
                              </>
                            ) : (
                              <>
                                <CheckCircle className="h-4 w-4" />
                                Activate
                              </>
                            )}
                          </button>
                          <button onClick={() => deleteQRCode(qr)} className="flex items-center gap-2 px-3 py-2 text-sm bg-slate-700 hover:bg-red-700 rounded-lg" title="Delete QR code">
                            <Trash2 className="h-4 w-4" /> Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default CMSSAttendancePanel;

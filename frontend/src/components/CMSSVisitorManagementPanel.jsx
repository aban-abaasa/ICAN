import React, { useState, useEffect, useRef } from 'react';
import { QrCode, Users, MapPin, AlertTriangle, CheckCircle, LogOut, RefreshCw, AlertCircle, Mail, Download, Car, ChevronDown, ChevronUp } from 'lucide-react';
import jsQR from 'jsqr';
import { QRCodeSVG } from 'qrcode.react';
import { supabase } from '../lib/supabase/client';
import { publicAppUrl } from '../utils/publicAppUrl';
import { downloadCmmsQrPdf } from '../utils/downloadCmmsQrPdf';
import { downloadCmmsRecordsExcel, downloadCmmsRecordsPdf } from '../utils/cmmsRecordExports';

const CMSSVisitorManagementPanel = ({ companyProfile, currentUser, cmmsUsers, userRole, isCreator }) => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  const [activeSubTab, setActiveSubTab] = useState('visitor-checkin'); // visitor-checkin, visitor-records, visitor-edit
  const [visitorName, setVisitorName] = useState('');
  const [visitorEmail, setVisitorEmail] = useState('');
  const [visitorPhone, setVisitorPhone] = useState('');
  const [checkInLocation, setCheckInLocation] = useState('');
  const [hostEmail, setHostEmail] = useState('');
  const [purpose, setPurpose] = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [userLocation, setUserLocation] = useState(null);
  const [visitorRecords, setVisitorRecords] = useState([]);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [filterStatus, setFilterStatus] = useState('');
  const [showScanner, setShowScanner] = useState(false);
  const [scanMode, setScanMode] = useState('location'); // location, email
  const [scannedVisitor, setScannedVisitor] = useState(null);
  const [visitorQrCode, setVisitorQrCode] = useState('');
  const [editingVisitor, setEditingVisitor] = useState(null);
  const [adminNotes, setAdminNotes] = useState('');
  const [flagReason, setFlagReason] = useState('');
  const [expandedVisitorIds, setExpandedVisitorIds] = useState(() => new Set());
  const toggleVisitorExpanded = (id) => {
    setExpandedVisitorIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const streamRef = useRef(null);
  // Visitor identity/contact records are manager-only in the database. Keep
  // the UI in step with that policy: users with this tool can register a
  // visitor, while only company managers can open the records/review tabs.
  const canViewVisitorRecords = userRole === 'admin' || isCreator;

  const getRpcErrorMessage = (rpcError, action) => {
    const message = rpcError?.message || '';
    if (rpcError?.code === 'PGRST202' || /could not find the function|schema cache/i.test(message)) {
      return `The ${action} service has not been deployed to Supabase yet. Run backend/CMMS_STAFF_ATTENDANCE_VISITOR_MANAGEMENT.sql in the Supabase SQL Editor, then retry.`;
    }
    return message || `${action} failed`;
  };

  // Get user's location
  useEffect(() => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy
          });
        },
        (error) => {
          console.warn('Geolocation error:', error);
        }
      );
    }
  }, []);

  // Most visitor QR codes are posted at the company's configured entrance.
  // Prefill it so an admin can generate a code without first copying the
  // location into this form. Never replace a location the receptionist chose.
  useEffect(() => {
    if (!checkInLocation.trim() && companyProfile?.location?.trim()) {
      setCheckInLocation(companyProfile.location.trim());
    }
  }, [companyProfile?.id, companyProfile?.location]);

  // Load visitor records
  useEffect(() => {
    if (canViewVisitorRecords) loadVisitorRecords();
  }, [selectedDate, filterStatus, canViewVisitorRecords]);

  useEffect(() => {
    if (!canViewVisitorRecords && activeSubTab !== 'visitor-checkin') {
      setActiveSubTab('visitor-checkin');
    }
  }, [activeSubTab, canViewVisitorRecords]);

  const loadVisitorRecords = async () => {
    if (!companyProfile) return;

    try {
      const { data, error: recordsError } = await supabase.rpc('get_visitor_records', {
        p_cmms_company_id: companyProfile.id,
        p_start_date: selectedDate,
        p_end_date: selectedDate,
        p_status: filterStatus || null
      });

      if (recordsError) throw recordsError;
      setVisitorRecords(data || []);
    } catch (err) {
      console.error('Error loading visitor records:', err);
      setError('Failed to load visitor records');
    }
  };

  const handleVisitorCheckIn = async () => {
    if (!visitorName.trim()) {
      setError('Visitor name is required');
      return;
    }
    if (!checkInLocation.trim()) {
      setError('Check-in location is required');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const { data: result, error: checkInError } = await supabase.rpc('visitor_check_in', {
        p_cmms_company_id: companyProfile.id,
        p_visitor_name: visitorName,
        p_visitor_email: visitorEmail || null,
        p_visitor_phone: visitorPhone || null,
        p_check_in_location: checkInLocation,
        p_latitude: userLocation?.latitude || null,
        p_longitude: userLocation?.longitude || null,
        p_host_email: hostEmail || null,
        p_purpose: purpose || null,
        p_vehicle_number: vehicleNumber || null
      });

      if (checkInError) throw checkInError;

      setSuccess(`✅ Visitor ${visitorName} registered successfully`);
      setScannedVisitor(result);

      // Reset form
      setVisitorName('');
      setVisitorEmail('');
      setVisitorPhone('');
      setCheckInLocation('');
      setHostEmail('');
      setPurpose('');
      setVehicleNumber('');

      // Reload records
      await loadVisitorRecords();
    } catch (err) {
      setError(getRpcErrorMessage(err, 'visitor check-in'));
    } finally {
      setLoading(false);
    }
  };

  const handleVisitorCheckOut = async (visitorId) => {
    setLoading(true);
    setError('');

    try {
      const { error: checkOutError } = await supabase.rpc('visitor_check_out', {
        p_visitor_id: visitorId,
        p_location: checkInLocation || null
      });

      if (checkOutError) throw checkOutError;

      setSuccess('✅ Visitor checked out');
      setCheckInLocation('');
      await loadVisitorRecords();
    } catch (err) {
      setError(err.message || 'Check-out failed');
    } finally {
      setLoading(false);
    }
  };

  const handleFlagVisitor = async (visitorId) => {
    if (!flagReason.trim()) {
      setError('Please provide a reason for flagging');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const { error: flagError } = await supabase.rpc('flag_visitor_record', {
        p_visitor_id: visitorId,
        p_reason: flagReason
      });

      if (flagError) throw flagError;

      setSuccess('✅ Visitor flagged for review');
      setFlagReason('');
      setEditingVisitor(null);
      await loadVisitorRecords();
    } catch (err) {
      setError(err.message || 'Flag operation failed');
    } finally {
      setLoading(false);
    }
  };

  const startQRScanner = async (mode) => {
    setScanMode(mode);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        scanQRCode(mode);
      }
    } catch (err) {
      setError('Camera access denied');
    }
  };

  const stopQRScanner = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  };

  const parseVisitorQrPayload = (rawValue) => {
    const value = rawValue?.trim();
    if (!value) return null;

    try {
      const parsed = JSON.parse(value);
      if (parsed?.type === 'cmms_visitor_checkin') {
        return {
          location: parsed.location || '',
          hostEmail: parsed.hostEmail || '',
          purpose: parsed.purpose || ''
        };
      }
    } catch (error) {
      // Not JSON; try pipe-delimited format.
    }

    if (value.startsWith('CMMS_VISITOR|')) {
      const parts = value.split('|');
      return {
        location: parts[1] || '',
        hostEmail: parts[2] || '',
        purpose: parts[3] || ''
      };
    }

    return null;
  };

  const generateVisitorQr = async () => {
    const location = checkInLocation.trim() || companyProfile?.location?.trim() || '';
    if (!location) {
      setError('Set the company location or enter the visitor check-in location before generating the QR code.');
      return;
    }

    if (location !== checkInLocation) setCheckInLocation(location);

    setLoading(true);
    setError('');
    const { data, error: qrError } = await supabase.rpc('create_cmms_visitor_qr_location', {
      p_cmms_company_id: companyProfile.id,
      p_location_name: location,
      p_host_email: hostEmail.trim() || null,
      p_purpose: purpose.trim() || null
    });
    setLoading(false);
    if (qrError) {
      setError(getRpcErrorMessage(qrError, 'visitor QR generator'));
      return;
    }
    const record = Array.isArray(data) ? data[0] : data;
    if (!record?.token) {
      setError('The visitor QR generator did not return a secure QR token.');
      return;
    }
    setVisitorQrCode(`${publicAppUrl()}/visitor-check-in?token=${encodeURIComponent(record.token)}`);
    setSuccess('✅ Visitor QR payload generated');
  };

  const visitorColumns = [
    { label: 'Date', value: (record) => new Date(record.check_in_time).toLocaleDateString() },
    { label: 'Visitor Name', value: (record) => record.visitor_name },
    { label: 'Email', value: (record) => record.visitor_email },
    { label: 'Phone', value: (record) => record.visitor_phone },
    { label: 'Host', value: (record) => record.host_name || record.host_email },
    { label: 'Purpose', value: (record) => record.purpose },
    { label: 'Vehicle No.', value: (record) => record.vehicle_number },
    { label: 'Check In', value: (record) => new Date(record.check_in_time).toLocaleTimeString() },
    { label: 'Check Out', value: (record) => record.check_out_time ? new Date(record.check_out_time).toLocaleTimeString() : 'Not checked out' },
    { label: 'Location', value: (record) => record.check_in_location },
    { label: 'Status', value: (record) => record.status }
  ];

  const exportVisitors = async (format) => {
    if (!visitorRecords.length) return setError('No visitor records to export');
    const filename = `visitor-records-${selectedDate}`;
    try {
      if (format === 'excel') await downloadCmmsRecordsExcel({ filename, sheetName: 'Visitors', columns: visitorColumns, rows: visitorRecords });
      else await downloadCmmsRecordsPdf({ filename, title: 'Visitor Records Report', subtitle: `${companyProfile?.company_name || 'CMMS'} • ${selectedDate}`, columns: visitorColumns, rows: visitorRecords });
    } catch (exportError) {
      console.error('Visitor export error:', exportError);
      setError(`Unable to download ${format.toUpperCase()}. Please try again.`);
    }
  };

  const downloadVisitorQrPdf = async () => {
    if (!visitorQrCode) return;
    try {
      await downloadCmmsQrPdf({
        type: 'visitor',
        url: visitorQrCode,
        location: checkInLocation || companyProfile?.location,
        companyName: companyProfile?.company_name
      });
    } catch (err) {
      console.error('Unable to create visitor QR PDF:', err);
      setError('Unable to create the visitor QR PDF. Please try again.');
    }
  };

  const scanQRCode = (mode) => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');

      const scanInterval = setInterval(() => {
        if (video.readyState === video.HAVE_ENOUGH_DATA) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0);

          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 2
          });

          if (code) {
            clearInterval(scanInterval);
            stopQRScanner();

            const payload = parseVisitorQrPayload(code.data);
            if (payload) {
              if (payload.location) setCheckInLocation(payload.location);
              if (payload.hostEmail) setHostEmail(payload.hostEmail);
              if (payload.purpose) setPurpose(payload.purpose);
            } else if (mode === 'location') {
              setCheckInLocation(code.data);
            } else if (mode === 'email') {
              setHostEmail(code.data);
            }

            setShowScanner(false);
            setSuccess('✅ QR code scanned');
          }
        }
      }, 100);

      return () => clearInterval(scanInterval);
    }
  };

  return (
    <div className="space-y-6">
      {/* Visitor Management Sub-Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-white/20 pb-4">
        <button
          onClick={() => setActiveSubTab('visitor-checkin')}
          className={`px-4 py-2 rounded-lg font-semibold transition-all ${
            activeSubTab === 'visitor-checkin'
              ? 'bg-blue-600 text-white'
              : 'bg-white/10 text-gray-300 hover:bg-white/20'
          }`}
        >
          <Users className="inline w-4 h-4 mr-2" />
          Register Visitor
        </button>
        {canViewVisitorRecords && (
          <button
            onClick={() => setActiveSubTab('visitor-records')}
            className={`px-4 py-2 rounded-lg font-semibold transition-all ${
              activeSubTab === 'visitor-records'
                ? 'bg-indigo-600 text-white'
                : 'bg-white/10 text-gray-300 hover:bg-white/20'
            }`}
          >
            <Users className="inline w-4 h-4 mr-2" />
            Visitor Records
          </button>
        )}
        {canViewVisitorRecords && (
          <button
            onClick={() => setActiveSubTab('visitor-edit')}
            className={`px-4 py-2 rounded-lg font-semibold transition-all ${
              activeSubTab === 'visitor-edit'
                ? 'bg-amber-600 text-white'
                : 'bg-white/10 text-gray-300 hover:bg-white/20'
            }`}
          >
            <AlertTriangle className="inline w-4 h-4 mr-2" />
            Review Suspicious
          </button>
        )}
      </div>

      {/* Error/Success Messages */}
      {error && (
        <div className="bg-red-500/20 border border-red-500/50 text-red-200 p-4 rounded-lg flex gap-3">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="bg-emerald-500/20 border border-emerald-500/50 text-emerald-200 p-4 rounded-lg flex gap-3">
          <CheckCircle className="w-5 h-5 flex-shrink-0" />
          <span>{success}</span>
        </div>
      )}

      {/* Visitor Check-In Form */}
      {activeSubTab === 'visitor-checkin' && (
        <div className="glass-card p-6 space-y-4">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-400" />
            Register New Visitor
          </h3>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-300 mb-2">Visitor Name *</label>
              <input
                type="text"
                value={visitorName}
                onChange={(e) => setVisitorName(e.target.value)}
                placeholder="Full name"
                className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-500 focus:border-blue-400 transition-all"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-300 mb-2">Email Address</label>
              <input
                type="email"
                value={visitorEmail}
                onChange={(e) => setVisitorEmail(e.target.value)}
                placeholder="visitor@example.com"
                className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-500 focus:border-blue-400 transition-all"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-300 mb-2">Phone Number</label>
              <input
                type="tel"
                value={visitorPhone}
                onChange={(e) => setVisitorPhone(e.target.value)}
                placeholder="+256 (0) 123-456-789"
                className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-500 focus:border-blue-400 transition-all"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-300 mb-2">Check-In Location *</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={checkInLocation}
                  onChange={(e) => setCheckInLocation(e.target.value)}
                  placeholder="Company location"
                  className="flex-1 px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-500 focus:border-blue-400 transition-all"
                />
                <button
                  onClick={() => startQRScanner('location')}
                  className="px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-all"
                  title="Scan location QR code"
                >
                  <QrCode className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm text-gray-300 mb-2">Host Email (Staff Member)</label>
              <div className="flex gap-2">
                <select
                  value={hostEmail}
                  onChange={(e) => setHostEmail(e.target.value)}
                  className="flex-1 px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white"
                >
                  <option value="">Select host</option>
                  {cmmsUsers.map(user => (
                    <option key={user.id} value={user.email}>{user.email}</option>
                  ))}
                </select>
                <button
                  onClick={() => startQRScanner('email')}
                  className="px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-all"
                  title="Scan host email QR code"
                >
                  <QrCode className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm text-gray-300 mb-2">Purpose of Visit</label>
              <input
                type="text"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder="Meeting, delivery, maintenance, etc."
                className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-500 focus:border-blue-400 transition-all"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-300 mb-2">Vehicle Number</label>
              <div className="flex gap-2">
                <span className="flex items-center px-3 bg-white/10 border border-white/20 rounded-lg text-gray-400">
                  <Car className="w-4 h-4" />
                </span>
                <input
                  type="text"
                  value={vehicleNumber}
                  onChange={(e) => setVehicleNumber(e.target.value.toUpperCase())}
                  placeholder="e.g. UBA 123X"
                  className="flex-1 px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-500 focus:border-blue-400 transition-all"
                />
              </div>
            </div>
          </div>

          {/* QR Scanner Modal */}
          {showScanner && (
            <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
              <div className="bg-slate-900 rounded-lg p-6 max-w-md w-full">
                <h4 className="text-white font-bold mb-4">
                  Scan {scanMode === 'location' ? 'Location' : 'Host Email'} QR Code
                </h4>
                <div className="mb-4">
                  <video ref={videoRef} className="w-full rounded-lg" autoPlay playsInline />
                  <canvas ref={canvasRef} style={{ display: 'none' }} />
                </div>
                <button
                  onClick={() => {
                    stopQRScanner();
                    setShowScanner(false);
                  }}
                  className="w-full px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold"
                >
                  Close Scanner
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              onClick={generateVisitorQr}
              className="flex-1 px-4 py-3 bg-violet-600 hover:bg-violet-700 text-white rounded-lg font-semibold flex items-center justify-center gap-2 transition-all"
            >
              <QrCode className="w-4 h-4" />
              Generate Visitor QR
            </button>
            <button
              onClick={handleVisitorCheckIn}
              disabled={loading || !visitorName.trim() || !checkInLocation.trim()}
              className="flex-1 px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white rounded-lg font-semibold flex items-center justify-center gap-2 transition-all"
            >
              {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              {loading ? 'Registering...' : 'Register Visitor'}
            </button>
          </div>

          {visitorQrCode && (
            <div className="rounded-xl bg-white/10 p-5 text-center">
              <p className="mb-3 font-semibold text-white">Visitor check-in QR</p>
              <div className="inline-block rounded-lg bg-white p-3">
                <QRCodeSVG value={visitorQrCode} size={180} />
              </div>
              <p className="mt-3 break-all text-xs text-gray-400">{visitorQrCode}</p>
              <button onClick={downloadVisitorQrPdf} className="mx-auto mt-4 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-700"><Download className="h-4 w-4" />Download PDF</button>
              <p className="mt-2 text-xs text-emerald-300">Scan this at the entrance to prefill the location and host fields.</p>
            </div>
          )}

          {scannedVisitor && (
            <div className="bg-emerald-500/20 border border-emerald-500/50 p-4 rounded-lg">
              <p className="text-emerald-200 font-semibold">
                ✅ QR Code: {scannedVisitor.qr_token}
              </p>
              <p className="text-emerald-200 text-sm mt-2">
                Share this code with the visitor or print it for their badge
              </p>
            </div>
          )}
        </div>
      )}

      {/* Visitor Records */}
      {activeSubTab === 'visitor-records' && (
        <div className="glass-card p-6 space-y-4">
          <h3 className="text-lg font-bold text-white">Visitor Records</h3>

          <div className="flex flex-wrap gap-4">
            <div>
              <label className="block text-sm text-gray-300 mb-2">Date</label>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-300 mb-2">Status Filter</label>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white"
              >
                <option value="">All Visitors</option>
                <option value="checked_in">Checked In</option>
                <option value="checked_out">Checked Out</option>
                <option value="flagged_for_review">Flagged</option>
              </select>
            </div>
            <div className="flex items-end">
              <button
                onClick={loadVisitorRecords}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold flex items-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                Refresh
              </button>
            </div>
            <div className="flex items-end gap-2">
              <button onClick={() => exportVisitors('excel')} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold flex items-center gap-2"><Download className="w-4 h-4" /> Excel</button>
              <button onClick={() => exportVisitors('pdf')} className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-semibold flex items-center gap-2"><Download className="w-4 h-4" /> PDF</button>
            </div>
          </div>

          <div className="space-y-2">
            {visitorRecords.map(record => {
              const isExpanded = expandedVisitorIds.has(record.id);
              return (
                <div key={record.id} className="rounded-lg border border-white/10 bg-white/5 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => toggleVisitorExpanded(record.id)}
                    className="w-full flex flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-white/5 transition-all"
                  >
                    {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />}
                    <span className="font-semibold text-white">{record.visitor_name}</span>
                    <span className={`px-2 py-1 rounded text-xs font-semibold ${
                      record.status === 'flagged_for_review'
                        ? 'bg-red-500/30 text-red-200'
                        : record.status === 'checked_out'
                        ? 'bg-gray-500/30 text-gray-200'
                        : 'bg-emerald-500/30 text-emerald-200'
                    }`}>
                      {record.status === 'flagged_for_review' ? '🚩 Flagged' : record.status === 'checked_out' ? '✓ Out' : '✓ In'}
                    </span>
                    <span className="text-xs text-gray-400">{new Date(record.check_in_time).toLocaleTimeString()}</span>
                    {record.vehicle_number && (
                      <span className="flex items-center gap-1 text-xs text-gray-400">
                        <Car className="w-3 h-3" /> {record.vehicle_number}
                      </span>
                    )}
                    <span className="ml-auto flex items-center gap-2">
                      {record.status === 'checked_in' && (
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => { e.stopPropagation(); handleVisitorCheckOut(record.id); }}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); handleVisitorCheckOut(record.id); } }}
                          className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white text-xs rounded inline-flex items-center"
                        >
                          <LogOut className="inline w-3 h-3 mr-1" />
                          Check Out
                        </span>
                      )}
                    </span>
                  </button>

                  {isExpanded && (
                    <div className="px-4 pb-4 pt-1 grid sm:grid-cols-2 lg:grid-cols-3 gap-3 border-t border-white/10 bg-black/10">
                      <div>
                        <p className="text-gray-400 text-xs mt-3">Email</p>
                        <p className="text-gray-200 text-sm">{record.visitor_email || '-'}</p>
                      </div>
                      <div>
                        <p className="text-gray-400 text-xs mt-3">Phone</p>
                        <p className="text-gray-200 text-sm">{record.visitor_phone || '-'}</p>
                      </div>
                      <div>
                        <p className="text-gray-400 text-xs mt-3">Vehicle Number</p>
                        <p className="text-gray-200 text-sm">{record.vehicle_number || '-'}</p>
                      </div>
                      <div>
                        <p className="text-gray-400 text-xs mt-3">Host</p>
                        <p className="text-gray-200 text-sm">{record.host_name || record.host_email || '-'}</p>
                      </div>
                      <div>
                        <p className="text-gray-400 text-xs mt-3">Purpose</p>
                        <p className="text-gray-200 text-sm">{record.purpose || '-'}</p>
                      </div>
                      <div>
                        <p className="text-gray-400 text-xs mt-3">Location</p>
                        <p className="text-gray-200 text-sm">{record.check_in_location || '-'}</p>
                      </div>
                      <div>
                        <p className="text-gray-400 text-xs mt-3">Check-In</p>
                        <p className="text-gray-200 text-sm">{new Date(record.check_in_time).toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-gray-400 text-xs mt-3">Check-Out</p>
                        <p className="text-gray-200 text-sm">{record.check_out_time ? new Date(record.check_out_time).toLocaleString() : 'Not checked out'}</p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {visitorRecords.length === 0 && (
              <div className="text-center py-6 text-gray-400">No visitor records found</div>
            )}
          </div>
        </div>
      )}

      {/* Admin: Review Suspicious Visitors */}
      {activeSubTab === 'visitor-edit' && (userRole === 'admin' || isCreator) && (
        <div className="glass-card p-6 space-y-4">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-400" />
            Review Suspicious Visitor Records
          </h3>

          <div className="space-y-4">
            {visitorRecords.length === 0 ? (
              <div className="text-center py-6 text-gray-400">No suspicious visitor records found</div>
            ) : (
              visitorRecords.map(record => (
                <div key={record.id} className="bg-slate-800/60 border border-white/20 p-4 rounded-lg">
                  <div className="grid md:grid-cols-3 gap-4">
                    <div>
                      <p className="text-gray-400 text-sm">Visitor Name</p>
                      <p className="text-white font-semibold">{record.visitor_name}</p>
                    </div>
                    <div>
                      <p className="text-gray-400 text-sm">Email</p>
                      <p className="text-white font-semibold">{record.visitor_email || '-'}</p>
                    </div>
                    <div>
                      <p className="text-gray-400 text-sm">Check-In Time</p>
                      <p className="text-white font-semibold">
                        {new Date(record.check_in_time).toLocaleString()}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 pt-4 border-t border-white/10">
                    <label className="block text-sm text-gray-300 mb-2">Admin Notes</label>
                    <textarea
                      value={adminNotes}
                      onChange={(e) => setAdminNotes(e.target.value)}
                      placeholder="Add your review notes..."
                      rows={2}
                      className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-500 focus:border-blue-400 transition-all"
                    />
                  </div>

                  <div className="mt-4">
                    <label className="block text-sm text-gray-300 mb-2">Flag Reason</label>
                    <input
                      type="text"
                      value={flagReason}
                      onChange={(e) => setFlagReason(e.target.value)}
                      placeholder="e.g., Location mismatch, unrecognized visitor, security concern"
                      className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-500 focus:border-blue-400 transition-all"
                    />
                  </div>

                  <div className="mt-4 flex gap-2">
                    <button
                      onClick={() => handleFlagVisitor(record.id)}
                      disabled={loading}
                      className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-600 text-white rounded-lg font-semibold flex items-center justify-center gap-2"
                    >
                      {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <AlertTriangle className="w-4 h-4" />}
                      {loading ? 'Flagging...' : 'Flag for Review'}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default CMSSVisitorManagementPanel;

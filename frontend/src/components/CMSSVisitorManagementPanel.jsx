import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Calendar, Info, Maximize2, Search, QrCode, Users, MapPin, AlertTriangle, CheckCircle, LogOut, RefreshCw, AlertCircle, Mail, Download, Car, ChevronDown, ChevronUp, Star, Camera, X } from 'lucide-react';
import jsQR from 'jsqr';
import { QRCodeSVG } from 'qrcode.react';
import { supabase } from '../lib/supabase/client';
import { publicAppUrl } from '../utils/publicAppUrl';
import { downloadCmmsQrPdf } from '../utils/downloadCmmsQrPdf';
import { downloadCmmsRecordsExcel, downloadCmmsRecordsPdf } from '../utils/cmmsRecordExports';
import { getDepartmentVisitorRatings, getStaffVisitorRatings } from '../services/businessManagementService';
import { getVisitorVehicleApprovals, purgeVehiclePhotos, uploadVehiclePhoto } from '../services/cmmsVisitorVehicleService';
import CMMSVisitorVehicleApprovals, { VehiclePhoto } from './CMMSVisitorVehicleApprovals';

// 16px text stops iOS zooming into the field; 44px height is a comfortable tap target on small phones.
const VISITOR_FIELD = 'w-full h-11 px-3 text-base bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-500 focus:border-blue-400 transition-all';
const VISITOR_TAB_ACCENTS = { 'visitor-checkin': 'gold', 'visitor-records': 'navy', 'visitor-edit': 'burgundy', 'visitor-ratings': 'plum', 'visitor-approvals': 'teal' };
const STATUS_LABELS = {
  '': 'All visitors', checked_in: 'Checked in', checked_out: 'Checked out', flagged_for_review: 'Flagged',
  pending_check_in_approval: 'Entry pending', pending_check_out_approval: 'Exit pending', check_in_rejected: 'Declined'
};
// A visitor still counts as on site while their exit waits for approval.
const isOnSite = (record) => record.status === 'checked_in' || record.status === 'pending_check_out_approval';
const VISIT_TONES = {
  flagged_for_review: { bg: 'rgba(239,68,68,0.13)', color: '#dc2626', label: '🚩 Flagged' },
  checked_out: { bg: 'rgba(16,185,129,0.15)', color: '#047857', label: '✓ Out' },
  pending_check_in_approval: { bg: 'rgba(59,130,246,0.13)', color: '#1d4ed8', label: '⏳ Entry pending' },
  pending_check_out_approval: { bg: 'rgba(59,130,246,0.13)', color: '#1d4ed8', label: '⏳ Exit pending' },
  check_in_rejected: { bg: 'rgba(239,68,68,0.13)', color: '#dc2626', label: '✕ Declined' }
};
const ON_SITE_TONE = { bg: 'rgba(245,158,11,0.15)', color: '#b45309', label: 'On site' };

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
  const [vehiclePhoto, setVehiclePhoto] = useState(null); // { file, previewUrl }
  const [approvalBadge, setApprovalBadge] = useState(0); // pending approvals assigned to me
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [userLocation, setUserLocation] = useState(null);
  const [visitorRecords, setVisitorRecords] = useState([]);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [filterStatus, setFilterStatus] = useState('');
  const [fullPage, setFullPage] = useState(false);
  const [headerInfo, setHeaderInfo] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [scanMode, setScanMode] = useState('location'); // location, email
  const [scannedVisitor, setScannedVisitor] = useState(null);
  const [visitorQrCode, setVisitorQrCode] = useState('');
  const [editingVisitor, setEditingVisitor] = useState(null);
  const [adminNotes, setAdminNotes] = useState('');
  const [flagReason, setFlagReason] = useState('');
  const [expandedVisitorIds, setExpandedVisitorIds] = useState(() => new Set());
  const [staffRatings, setStaffRatings] = useState([]);
  const [departmentRatings, setDepartmentRatings] = useState([]);
  const [ratingsLoading, setRatingsLoading] = useState(false);
  const [ratingsError, setRatingsError] = useState('');
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

  const getRpcErrorMessage = (rpcError, action, sqlFile = 'CMMS_STAFF_ATTENDANCE_VISITOR_MANAGEMENT.sql') => {
    const message = rpcError?.message || '';
    if (rpcError?.code === 'PGRST202' || /could not find the function|schema cache/i.test(message)) {
      return `The ${action} service has not been deployed to Supabase yet. Run backend/${sqlFile} in the Supabase SQL Editor, then retry.`;
    }
    return message || `${action} failed`;
  };

  // Previews of the chosen vehicle photo are object URLs; free each one when it is replaced or the panel closes.
  useEffect(() => () => { if (vehiclePhoto?.previewUrl) URL.revokeObjectURL(vehiclePhoto.previewUrl); }, [vehiclePhoto]);

  const chooseVehiclePhoto = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please choose a photo.');
      return;
    }
    setError('');
    setVehiclePhoto({ file, previewUrl: URL.createObjectURL(file) });
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

  // A QR scan can fill host/purpose; never leave those hidden in a folded section.
  useEffect(() => {
    if (hostEmail || purpose || vehicleNumber || visitorEmail || vehiclePhoto) setMoreOpen(true);
  }, [hostEmail, purpose, vehicleNumber, visitorEmail, vehiclePhoto]);

  // Load visitor records
  useEffect(() => {
    if (canViewVisitorRecords) loadVisitorRecords();
  }, [selectedDate, endDate, filterStatus, canViewVisitorRecords]);

  // Ratings a visitor optionally left at check-out (backend/
  // CMMS_VISITOR_RATINGS_AND_STAFF_POINTS.sql) — a positive staff rating
  // already feeds CMMS reward points on its own; this is just the read-only
  // summary so admins can actually see what came in.
  const loadVisitorRatings = async () => {
    if (!companyProfile?.id) return;
    setRatingsLoading(true);
    setRatingsError('');
    const [staffRes, deptRes] = await Promise.all([
      getStaffVisitorRatings(companyProfile.id),
      getDepartmentVisitorRatings(companyProfile.id)
    ]);
    if (staffRes.error || deptRes.error) {
      setRatingsError(getRpcErrorMessage(staffRes.error || deptRes.error, 'visitor ratings').replace('CMMS_STAFF_ATTENDANCE_VISITOR_MANAGEMENT.sql', 'CMMS_VISITOR_RATINGS_AND_STAFF_POINTS.sql'));
    }
    setStaffRatings(staffRes.data || []);
    setDepartmentRatings(deptRes.data || []);
    setRatingsLoading(false);
  };

  useEffect(() => {
    if (canViewVisitorRecords && activeSubTab === 'visitor-ratings') loadVisitorRatings();
  }, [canViewVisitorRecords, activeSubTab, companyProfile?.id]);

  useEffect(() => {
    if (!canViewVisitorRecords && activeSubTab !== 'visitor-checkin' && activeSubTab !== 'visitor-approvals') {
      setActiveSubTab('visitor-checkin');
    }
  }, [activeSubTab, canViewVisitorRecords]);

  // Approvals assigned to me drive the tab badge. The same pass also removes
  // vehicle photos of visits that are over, so leftovers never pile up in Storage.
  const refreshApprovalBadge = async () => {
    if (!companyProfile?.id) return false;
    const { data, error: badgeError } = await getVisitorVehicleApprovals(companyProfile.id, 'pending');
    setApprovalBadge(data.filter((row) => row.assigned_to_me).length);
    return !badgeError;
  };

  useEffect(() => {
    if (!companyProfile?.id) return undefined;
    // Stops polling after a failure (e.g. the approvals SQL is not deployed yet) instead of failing every minute.
    const tick = async () => { if (!(await refreshApprovalBadge())) clearInterval(timer); };
    const timer = setInterval(tick, 60000);
    tick();
    purgeVehiclePhotos(companyProfile.id);
    return () => clearInterval(timer);
  }, [companyProfile?.id]);

  const loadVisitorRecords = async () => {
    if (!companyProfile) return;

    try {
      const { data, error: recordsError } = await supabase.rpc('get_visitor_records', {
        p_cmms_company_id: companyProfile.id,
        p_start_date: selectedDate,
        p_end_date: endDate || selectedDate,
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
      // The photo goes up first; its path is then attached to the visit. It is
      // deleted from Storage again once the visitor has checked out.
      const vehiclePhotoPath = vehiclePhoto ? await uploadVehiclePhoto(companyProfile.id, vehiclePhoto.file) : null;

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
        p_vehicle_number: vehicleNumber || null,
        // Only sent with a photo, so registering keeps working before the photo SQL is deployed.
        ...(vehiclePhotoPath ? { p_vehicle_photo_path: vehiclePhotoPath } : {})
      });

      if (checkInError) throw checkInError;

      setSuccess(result?.approval_required
        ? `⏳ Visitor ${visitorName} registered — entry is waiting for approval${result.approver_name ? ` from ${result.approver_name}` : ''}`
        : `✅ Visitor ${visitorName} registered successfully`);
      setScannedVisitor(result);

      // Reset form
      setVisitorName('');
      setVisitorEmail('');
      setVisitorPhone('');
      setCheckInLocation('');
      setHostEmail('');
      setPurpose('');
      setVehicleNumber('');
      setVehiclePhoto(null);

      // Reload records
      await loadVisitorRecords();
    } catch (err) {
      setError(getRpcErrorMessage(err, 'visitor check-in', vehiclePhoto ? 'CMMS_VISITOR_VEHICLE_APPROVAL.sql' : undefined));
    } finally {
      setLoading(false);
    }
  };

  const handleVisitorCheckOut = async (visitorId) => {
    setLoading(true);
    setError('');

    try {
      const { data: result, error: checkOutError } = await supabase.rpc('visitor_check_out', {
        p_visitor_id: visitorId,
        p_location: checkInLocation || null
      });

      if (checkOutError) throw checkOutError;

      if (result?.pending_approval) {
        // A vehicle visit leaves only once the next approver on rotation says so.
        setSuccess(`⏳ Exit sent${result.approver_name ? ` to ${result.approver_name}` : ''} for approval`);
      } else {
        setSuccess('✅ Visitor checked out');
        await purgeVehiclePhotos(companyProfile.id);
      }
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
    if (!shownVisitors.length) return setError('No visitor records to export');
    const filename = `visitor-records-${selectedDate}${endDate !== selectedDate ? `-to-${endDate}` : ''}`;
    try {
      if (format === 'excel') await downloadCmmsRecordsExcel({ filename, sheetName: 'Visitors', columns: visitorColumns, rows: shownVisitors });
      else await downloadCmmsRecordsPdf({ filename, title: 'Visitor Records Report', subtitle: `${companyProfile?.company_name || 'CMMS'} • ${selectedDate}${endDate !== selectedDate ? ` to ${endDate}` : ''}`, columns: visitorColumns, rows: shownVisitors });
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

  const todayIso = new Date().toISOString().split('T')[0];
  const fmtDay = (iso) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  const setRangeDays = (days) => {
    const start = new Date();
    start.setDate(start.getDate() - (days - 1));
    setSelectedDate(start.toISOString().split('T')[0]);
    setEndDate(todayIso);
  };

  // Smart search: name, email, phone, host, purpose, vehicle, location, and
  // any date/time text of the visit (e.g. "2026-09-15", "15 sep", "monday",
  // "08:1").
  const searchQuery = searchTerm.trim().toLowerCase();
  const visitSearchText = (record) => {
    const d = new Date(record.check_in_time);
    const out = record.check_out_time ? new Date(record.check_out_time) : null;
    return [
      record.visitor_name, record.visitor_email, record.visitor_phone, record.host_name, record.host_email,
      record.purpose, record.vehicle_number, record.check_in_location,
      record.check_in_time?.slice(0, 10), d.toLocaleDateString(), d.toLocaleTimeString(),
      d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
      d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
      out ? out.toLocaleTimeString() : ''
    ].filter(Boolean).join(' ').toLowerCase();
  };
  const shownVisitors = visitorRecords
    .filter((record) => !searchQuery || visitSearchText(record).includes(searchQuery))
    .slice()
    .sort((a, b) => new Date(b.check_in_time) - new Date(a.check_in_time));

  return (
    <div className={fullPage ? 'cmms-fullpage space-y-5 fixed inset-0 z-50 overflow-y-auto p-4 md:p-8' : 'space-y-5 cmms-classic-card p-4 md:p-6'}>
      {/* Header: slim row, (i) for the explanation, pill tabs like Payroll */}
      <div className="cmms-accent-gold space-y-2.5">
        <div className="flex items-center gap-3">
          <span className="cmms-medallion"><Users className="h-4 w-4" aria-hidden="true" /></span>
          <div className="min-w-0 flex-1">
            <h2 className="cmms-classic-heading text-lg leading-tight">Visitor Management</h2>
            {companyProfile?.company_name && <p className="truncate text-xs cmms-classic-muted">{companyProfile.company_name}</p>}
          </div>
          <button type="button" onClick={() => setHeaderInfo(v => !v)} aria-expanded={headerInfo} aria-label="About this page" title="What is this page?" className="cmms-info-btn">
            <Info className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          {fullPage
            ? <button type="button" onClick={() => setFullPage(false)} className="cmms-classic-btn-secondary inline-flex !h-auto !min-h-0 flex-shrink-0 items-center gap-1.5 !px-3 !py-1.5 text-xs"><ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Back</button>
            : <button type="button" onClick={() => setFullPage(true)} className="cmms-info-btn" title="Open this tab as a full page" aria-label="Open full page"><Maximize2 className="h-3.5 w-3.5" aria-hidden="true" /></button>}
        </div>
        {visitorRecords.some(isOnSite) && canViewVisitorRecords && (
          <div className="flex flex-wrap gap-1.5">
            <span className="cmms-classic-chip" style={{ animation: 'cmms-rise .45s ease both' }}>{visitorRecords.filter(isOnSite).length} visitors on site</span>
          </div>
        )}
        {headerInfo && <div className="cmms-info cmms-classic-muted"><p>Register visitors, review who came and when, flag suspicious visits, and see the ratings visitors left.</p></div>}
        <div className="cmms-ornament" aria-hidden="true" />

        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [&>button]:flex-shrink-0 [&>button]:whitespace-nowrap" role="tablist" aria-label="Visitor sections" style={{ scrollbarWidth: 'none' }}>
          {[
            { id: 'visitor-checkin', label: 'Register Visitor' },
            { id: 'visitor-approvals', label: approvalBadge ? `Approvals (${approvalBadge})` : 'Approvals' },
            canViewVisitorRecords && { id: 'visitor-records', label: 'Visitor Records' },
            canViewVisitorRecords && { id: 'visitor-edit', label: 'Review Suspicious' },
            canViewVisitorRecords && { id: 'visitor-ratings', label: 'Ratings' }
          ].filter(Boolean).map(tab => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeSubTab === tab.id}
              onClick={() => { setActiveSubTab(tab.id); setFullPage(true); }}
              className={`cmms-ptab cmms-accent-${VISITOR_TAB_ACCENTS[tab.id] || 'gold'} ${activeSubTab === tab.id ? 'is-active' : ''}`}
            >
              {tab.label}
            </button>
          ))}
        </div>
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
        <div className="space-y-4">
          {/* Who is visiting: the two things reception must always capture come first */}
          <section className="cmms-sec cmms-accent-emerald" data-open="true">
            <div className="flex items-center gap-3">
              <span className="cmms-medallion"><Users className="h-4 w-4" aria-hidden="true" /></span>
              <h3 className="cmms-classic-heading cmms-sec-title min-w-0">Register new visitor</h3>
            </div>
            <div className="mt-4 space-y-3.5">
              <label className="block min-w-0">
                <span className="mb-1.5 block text-sm font-semibold">Visitor name <span className="text-red-500" aria-hidden="true">*</span></span>
                <input
                  type="text"
                  value={visitorName}
                  onChange={(e) => setVisitorName(e.target.value)}
                  placeholder="Full name"
                  autoComplete="off"
                  autoCapitalize="words"
                  enterKeyHint="next"
                  required
                  className={VISITOR_FIELD}
                />
              </label>

              <label className="block min-w-0">
                <span className="mb-1.5 block text-sm font-semibold">Phone number</span>
                <input
                  type="tel"
                  inputMode="tel"
                  autoComplete="off"
                  value={visitorPhone}
                  onChange={(e) => setVisitorPhone(e.target.value)}
                  placeholder="+256 7XX XXX XXX"
                  className={VISITOR_FIELD}
                />
              </label>

              <div className="min-w-0">
                <label htmlFor="visitor-location" className="mb-1.5 block text-sm font-semibold">Check-in location <span className="text-red-500" aria-hidden="true">*</span></label>
                <div className="flex min-w-0 gap-2">
                  <input
                    id="visitor-location"
                    type="text"
                    value={checkInLocation}
                    onChange={(e) => setCheckInLocation(e.target.value)}
                    placeholder="Company location"
                    autoComplete="off"
                    required
                    className={`${VISITOR_FIELD} min-w-0 flex-1`}
                  />
                  <button
                    type="button"
                    onClick={() => startQRScanner('location')}
                    className="grid h-11 w-11 flex-shrink-0 place-items-center rounded-lg bg-purple-600 text-white transition-all hover:bg-purple-700"
                    title="Scan location QR code"
                    aria-label="Scan location QR code"
                  >
                    <QrCode className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* Optional details stay folded away so a small screen shows only what is needed */}
          <section className="cmms-sec cmms-accent-navy" data-open={moreOpen}>
            <button type="button" onClick={() => setMoreOpen(o => !o)} aria-expanded={moreOpen}
              className="flex w-full items-center gap-3 text-left !bg-transparent" style={{ background: 'transparent', border: 0, padding: 0, boxShadow: 'none' }}>
              <span className="cmms-medallion"><Car className="h-4 w-4" aria-hidden="true" /></span>
              <span className="min-w-0 flex-1">
                <span className="cmms-classic-heading cmms-sec-title block">Visit details</span>
                <span className="block truncate text-xs cmms-classic-muted">
                  {[hostEmail && `Host: ${hostEmail}`, purpose, vehicleNumber, vehiclePhoto && 'Photo attached', visitorEmail].filter(Boolean).join(' · ') || 'Optional: email, host, purpose, vehicle'}
                </span>
              </span>
              <ChevronDown className={`h-4 w-4 flex-shrink-0 cmms-classic-muted transition-transform duration-300 ${moreOpen ? 'rotate-180' : ''}`} />
            </button>
            {moreOpen && (
              <div className="cmms-sec-body mt-4 space-y-3.5">
                <label className="block min-w-0">
                  <span className="mb-1.5 block text-sm font-semibold">Email address</span>
                  <input
                    type="email"
                    inputMode="email"
                    autoComplete="off"
                    autoCapitalize="none"
                    value={visitorEmail}
                    onChange={(e) => setVisitorEmail(e.target.value)}
                    placeholder="visitor@example.com"
                    className={VISITOR_FIELD}
                  />
                </label>

                <div className="min-w-0">
                  <label htmlFor="visitor-host" className="mb-1.5 block text-sm font-semibold">Host (staff member)</label>
                  <div className="flex min-w-0 gap-2">
                    <select
                      id="visitor-host"
                      value={hostEmail}
                      onChange={(e) => setHostEmail(e.target.value)}
                      className={`${VISITOR_FIELD} min-w-0 flex-1 truncate`}
                    >
                      <option value="">Select host</option>
                      {cmmsUsers.map(user => (
                        <option key={user.id} value={user.email}>{user.email}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => startQRScanner('email')}
                      className="grid h-11 w-11 flex-shrink-0 place-items-center rounded-lg bg-purple-600 text-white transition-all hover:bg-purple-700"
                      title="Scan host email QR code"
                      aria-label="Scan host email QR code"
                    >
                      <QrCode className="h-5 w-5" />
                    </button>
                  </div>
                </div>

                <label className="block min-w-0">
                  <span className="mb-1.5 block text-sm font-semibold">Purpose of visit</span>
                  <input
                    type="text"
                    value={purpose}
                    onChange={(e) => setPurpose(e.target.value)}
                    placeholder="Meeting, delivery, maintenance…"
                    autoComplete="off"
                    className={VISITOR_FIELD}
                  />
                </label>
                <div className="-mt-1 flex flex-wrap gap-1.5" aria-label="Quick purposes">
                  {['Meeting', 'Delivery', 'Interview', 'Maintenance'].map(label => (
                    <button key={label} type="button" onClick={() => setPurpose(label)} className="cmms-classic-chip !normal-case">{label}</button>
                  ))}
                </div>

                <label className="block min-w-0">
                  <span className="mb-1.5 block text-sm font-semibold">Vehicle number</span>
                  <div className="relative">
                    <Car className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
                    <input
                      type="text"
                      value={vehicleNumber}
                      onChange={(e) => setVehicleNumber(e.target.value.toUpperCase())}
                      placeholder="e.g. UBA 123X"
                      autoComplete="off"
                      autoCapitalize="characters"
                      className={`${VISITOR_FIELD} !pl-10`}
                    />
                  </div>
                </label>

                <div className="min-w-0">
                  <span className="mb-1.5 block text-sm font-semibold">Vehicle photo</span>
                  {vehiclePhoto ? (
                    <div className="flex items-center gap-3">
                      <img src={vehiclePhoto.previewUrl} alt="Vehicle preview" className="h-20 w-28 rounded-lg border border-white/20 object-cover" />
                      <button type="button" onClick={() => setVehiclePhoto(null)} className="!h-auto !min-h-0 !px-3 !py-1.5 text-xs cmms-classic-btn-secondary inline-flex items-center gap-1.5">
                        <X className="h-3.5 w-3.5" /> Remove
                      </button>
                    </div>
                  ) : (
                    <label className="cmms-classic-btn-secondary flex min-h-[2.75rem] cursor-pointer items-center justify-center gap-2 px-4 py-2">
                      <Camera className="h-4 w-4" aria-hidden="true" /> Take or attach photo
                      <input type="file" accept="image/*" onChange={chooseVehiclePhoto} className="sr-only" />
                    </label>
                  )}
                  <p className="mt-1 text-xs cmms-classic-muted">Optional. With a vehicle number or photo, entry and exit need approval from the next approver on rotation. The photo is deleted automatically once the visitor has checked out.</p>
                </div>
              </div>
            )}
          </section>

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

          {/* Main action first and full width; the QR helper sits under it */}
          <div className="flex flex-col gap-2.5 sm:flex-row-reverse">
            <button
              onClick={handleVisitorCheckIn}
              disabled={loading || !visitorName.trim() || !checkInLocation.trim()}
              className="cmms-classic-btn-primary flex min-h-[3rem] flex-1 items-center justify-center gap-2 px-4 py-3 disabled:opacity-50"
            >
              {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              {loading ? 'Registering...' : 'Register visitor'}
            </button>
            <button
              onClick={generateVisitorQr}
              className="cmms-classic-btn-secondary flex min-h-[3rem] flex-1 items-center justify-center gap-2 px-4 py-3"
            >
              <QrCode className="w-4 h-4" />
              Generate visitor QR
            </button>
          </div>
          {(!visitorName.trim() || !checkInLocation.trim()) && (
            <p className="text-center text-xs cmms-classic-muted">Enter the visitor's name and the check-in location to register.</p>
          )}

          {visitorQrCode && (
            <div className="cmms-classic-divider text-center">
              <p className="cmms-classic-heading mb-3 font-semibold">Visitor check-in QR</p>
              <div className="inline-block rounded-lg bg-white p-3">
                <QRCodeSVG value={visitorQrCode} size={180} />
              </div>
              <p className="cmms-classic-muted mt-3 break-all text-xs">{visitorQrCode}</p>
              <button onClick={downloadVisitorQrPdf} className="cmms-classic-btn-primary mx-auto mt-4 inline-flex items-center gap-2 px-4 py-2"><Download className="h-4 w-4" />Download PDF</button>
              <p className="mt-2 text-xs text-emerald-400">Scan this at the entrance to prefill the location and host fields.</p>
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
        <div className="space-y-4">
          {/* Collapsible filters: closed it is one slim row showing the range and status */}
          <section className="cmms-sec cmms-accent-gold" data-open={filtersOpen}>
            <button type="button" onClick={() => setFiltersOpen(o => !o)} aria-expanded={filtersOpen}
              className="flex w-full items-center gap-3 text-left !bg-transparent" style={{ background: 'transparent', border: 0, padding: 0, boxShadow: 'none' }}>
              <span className="cmms-medallion"><Calendar className="h-4 w-4" aria-hidden="true" /></span>
              <span className="min-w-0 flex-1">
                <span className="cmms-classic-heading cmms-sec-title block">Date range &amp; filters</span>
                <span className="block truncate text-xs cmms-classic-muted">
                  {fmtDay(selectedDate)}{endDate !== selectedDate ? ` → ${fmtDay(endDate)}` : ''} · {STATUS_LABELS[filterStatus] || 'All visitors'}
                </span>
              </span>
              <ChevronDown className={`h-4 w-4 flex-shrink-0 cmms-classic-muted transition-transform duration-300 ${filtersOpen ? 'rotate-180' : ''}`} />
            </button>
            {filtersOpen && (
              <div className="cmms-sec-body mt-4 space-y-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="text-xs font-semibold cmms-classic-muted">From
                    <input type="date" value={selectedDate} max={endDate || undefined} onChange={(e) => setSelectedDate(e.target.value)} className="mt-1 w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg" />
                  </label>
                  <label className="text-xs font-semibold cmms-classic-muted">To
                    <input type="date" value={endDate} min={selectedDate || undefined} max={todayIso} onChange={(e) => setEndDate(e.target.value)} className="mt-1 w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg" />
                  </label>
                </div>
                <div className="flex flex-wrap gap-2">
                  {[[1, 'Today'], [7, '7 days'], [30, '30 days']].map(([days, label]) => (
                    <button key={days} type="button" onClick={() => setRangeDays(days)} className="!h-auto !min-h-0 !px-3 !py-1.5 text-xs cmms-classic-btn-secondary">{label}</button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2" role="group" aria-label="Status filter">
                  {Object.entries(STATUS_LABELS).map(([value, label]) => (
                    <button key={value || 'all'} type="button" onClick={() => setFilterStatus(value)} aria-pressed={filterStatus === value}
                      className={`cmms-ptab cmms-accent-teal !px-3 !py-1 !text-xs ${filterStatus === value ? 'is-active' : ''}`}>{label}</button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2 border-t border-[rgba(196,160,82,0.3)] pt-3">
                  <button onClick={loadVisitorRecords} className="!h-auto !min-h-0 !px-3 !py-1.5 text-xs cmms-classic-btn-secondary flex items-center gap-1.5"><RefreshCw className="w-3.5 h-3.5" /> Refresh</button>
                  <button onClick={() => exportVisitors('excel')} className="!h-auto !min-h-0 !px-3 !py-1.5 text-xs cmms-classic-btn-secondary flex items-center gap-1.5"><Download className="w-3.5 h-3.5" /> Excel</button>
                  <button onClick={() => exportVisitors('pdf')} className="!h-auto !min-h-0 !px-3 !py-1.5 text-xs cmms-classic-btn-primary flex items-center gap-1.5"><Download className="w-3.5 h-3.5" /> PDF</button>
                </div>
              </div>
            )}
          </section>

          <label className="relative block">
            <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Search visitor, host, vehicle, purpose, date (15 sep) or time" className="w-full rounded-lg border border-white/20 bg-white/10 py-2 pl-9 pr-3 text-sm" />
          </label>
          <p className="text-xs cmms-classic-muted">
            {shownVisitors.length} visitor{shownVisitors.length === 1 ? '' : 's'}{searchQuery ? ' match' : ''} · tap a visitor for the exact date, time in and time out
          </p>

          {shownVisitors.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <Users className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>{searchQuery ? 'No visitors match your search' : 'No visitor records found'}</p>
            </div>
          ) : (
            <ul className="grid gap-2.5 lg:grid-cols-2">
              {shownVisitors.map((record, i) => {
                const isExpanded = expandedVisitorIds.has(record.id);
                const initials = (record.visitor_name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
                const checkIn = new Date(record.check_in_time);
                const tone = VISIT_TONES[record.status] || ON_SITE_TONE;
                return (
                  <li key={record.id} className="cmms-staff-card" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
                    <button type="button" onClick={() => toggleVisitorExpanded(record.id)} aria-expanded={isExpanded}
                      className="flex w-full items-center gap-3 text-left !bg-transparent" style={{ background: 'transparent', border: 0, padding: 0, boxShadow: 'none' }}>
                      <span className="cmms-monogram">{initials || '?'}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{record.visitor_name}</span>
                        <span className="block truncate text-xs cmms-classic-muted">
                          {checkIn.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} · {checkIn.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          {record.check_out_time ? ` → ${new Date(record.check_out_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-1.5">
                          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: tone.bg, color: tone.color }}>{tone.label}</span>
                          {record.host_name || record.host_email ? <span className="cmms-classic-chip !normal-case">Host: {record.host_name || record.host_email}</span> : null}
                          {record.vehicle_number && <span className="cmms-classic-chip !normal-case inline-flex items-center gap-1"><Car className="w-3 h-3" /> {record.vehicle_number}</span>}
                        </span>
                      </span>
                      <ChevronDown className={`h-4 w-4 flex-shrink-0 cmms-classic-muted transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
                    </button>
                    {record.status === 'checked_in' && (
                      <button type="button" onClick={() => handleVisitorCheckOut(record.id)} className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700">
                        <LogOut className="h-3.5 w-3.5" /> Check Out
                      </button>
                    )}
                    {isExpanded && (
                      <dl className="cmms-field-list cmms-sec-body mt-3 border-t border-[rgba(196,160,82,0.3)] pt-2">
                        <div className="cmms-field-row"><dt>Email</dt><dd>{record.visitor_email || '-'}</dd></div>
                        <div className="cmms-field-row"><dt>Phone</dt><dd>{record.visitor_phone || '-'}</dd></div>
                        <div className="cmms-field-row"><dt>Vehicle Number</dt><dd>{record.vehicle_number || '-'}</dd></div>
                        {record.vehicle_photo_path && <div className="cmms-field-row"><dt>Vehicle Photo</dt><dd><VehiclePhoto path={record.vehicle_photo_path} alt={`Vehicle of ${record.visitor_name}`} /></dd></div>}
                        {record.pending_approval_stage && (
                          <div className="cmms-field-row"><dt>Approval</dt><dd>{record.pending_approval_stage === 'check_in' ? 'Entry' : 'Exit'} waiting{record.pending_approver_name ? ` for ${record.pending_approver_name}` : ''}</dd></div>
                        )}
                        <div className="cmms-field-row"><dt>Host</dt><dd>{record.host_name || record.host_email || '-'}</dd></div>
                        <div className="cmms-field-row"><dt>Purpose</dt><dd>{record.purpose || '-'}</dd></div>
                        <div className="cmms-field-row"><dt>Location</dt><dd>{record.check_in_location || '-'}</dd></div>
                        <div className="cmms-field-row"><dt>Check-In</dt><dd>{checkIn.toLocaleString()}</dd></div>
                        <div className="cmms-field-row"><dt>Check-Out</dt><dd>{record.check_out_time ? new Date(record.check_out_time).toLocaleString() : 'Not checked out'}</dd></div>
                        <div className="cmms-field-row"><dt>Time on site</dt><dd>{record.check_out_time ? `${Math.floor((new Date(record.check_out_time) - checkIn) / 3600000)}h ${Math.floor(((new Date(record.check_out_time) - checkIn) % 3600000) / 60000)}m` : 'Still on site'}</dd></div>
                      </dl>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* Vehicle approvals: the next approver on rotation decides entry and exit;
          admins also choose who is in the approver pool. */}
      {activeSubTab === 'visitor-approvals' && (
        <CMMSVisitorVehicleApprovals
          companyId={companyProfile?.id}
          canManageApprovers={canViewVisitorRecords}
          onPendingChange={setApprovalBadge}
          onDecided={() => { if (canViewVisitorRecords) loadVisitorRecords(); }}
        />
      )}

      {/* Admin: Review Suspicious Visitors */}
      {activeSubTab === 'visitor-edit' && (userRole === 'admin' || isCreator) && (
        <div className="cmms-classic-card p-4 md:p-6 space-y-4">
          <h3 className="cmms-classic-heading text-lg flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-400" />
            Review Suspicious Visitor Records
          </h3>

          <div className="space-y-4">
            {visitorRecords.length === 0 ? (
              <div className="cmms-classic-muted text-center py-6">No suspicious visitor records found</div>
            ) : (
              visitorRecords.map(record => (
                <div key={record.id} className="cmms-classic-divider">
                  <dl className="cmms-field-list">
                    <div className="cmms-field-row">
                      <dt>Visitor Name</dt>
                      <dd>{record.visitor_name}</dd>
                    </div>
                    <div className="cmms-field-row">
                      <dt>Email</dt>
                      <dd>{record.visitor_email || '-'}</dd>
                    </div>
                    <div className="cmms-field-row">
                      <dt>Check-In Time</dt>
                      <dd>{new Date(record.check_in_time).toLocaleString()}</dd>
                    </div>
                  </dl>

                  <div className="mt-4">
                    <label className="block text-sm cmms-classic-muted mb-2">Admin Notes</label>
                    <textarea
                      value={adminNotes}
                      onChange={(e) => setAdminNotes(e.target.value)}
                      placeholder="Add your review notes..."
                      rows={2}
                      className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-500 focus:border-blue-400 transition-all"
                    />
                  </div>

                  <div className="mt-4">
                    <label className="block text-sm cmms-classic-muted mb-2">Flag Reason</label>
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

      {/* Admin: Visitor ratings — optional feedback visitors leave at
          check-out (backend/CMMS_VISITOR_RATINGS_AND_STAFF_POINTS.sql). A
          genuinely positive staff rating already feeds CMMS reward points
          on its own; this is just the read-only summary. */}
      {activeSubTab === 'visitor-ratings' && canViewVisitorRecords && (
        <div className="space-y-6">
          {ratingsError && <div className="rounded-lg border border-red-500/50 bg-red-500/20 p-4 text-red-200">{ratingsError}</div>}
          {ratingsLoading && <p className="text-sm text-gray-400">Loading ratings…</p>}

          <div className="cmms-classic-card p-4 md:p-6">
            <h3 className="cmms-classic-heading mb-3 text-lg">Staff ratings</h3>
            {staffRatings.filter((r) => r.rating_count > 0).length === 0 ? (
              <p className="cmms-classic-muted text-sm">No visitor ratings for staff yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-white/10 text-xs uppercase text-gray-500">
                    <tr><th className="p-2">Staff</th><th className="p-2 text-center">Average</th><th className="p-2 text-center">Ratings</th></tr>
                  </thead>
                  <tbody>
                    {staffRatings.filter((r) => r.rating_count > 0).map((row) => (
                      <tr key={row.cmms_user_id} className="border-b border-white/5">
                        <td className="p-2 text-gray-200">{row.user_name}</td>
                        <td className="p-2 text-center"><span className="inline-flex items-center gap-1 font-semibold text-amber-300">{row.average_rating} <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" /></span></td>
                        <td className="p-2 text-center text-gray-400">{row.rating_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="cmms-classic-card p-4 md:p-6">
            <h3 className="cmms-classic-heading mb-3 text-lg">Department ratings</h3>
            {departmentRatings.filter((r) => r.rating_count > 0).length === 0 ? (
              <p className="cmms-classic-muted text-sm">No visitor ratings for departments yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-white/10 text-xs uppercase text-gray-500">
                    <tr><th className="p-2">Department</th><th className="p-2 text-center">Average</th><th className="p-2 text-center">Ratings</th></tr>
                  </thead>
                  <tbody>
                    {departmentRatings.filter((r) => r.rating_count > 0).map((row) => (
                      <tr key={row.department_id} className="border-b border-white/5">
                        <td className="p-2 text-gray-200">{row.department_name}</td>
                        <td className="p-2 text-center"><span className="inline-flex items-center gap-1 font-semibold text-amber-300">{row.average_rating} <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" /></span></td>
                        <td className="p-2 text-center text-gray-400">{row.rating_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default CMSSVisitorManagementPanel;

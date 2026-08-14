import React, { useState, useEffect, useRef } from 'react';
import { QrCode, MapPin, Clock, CheckCircle, AlertCircle, LogOut, RefreshCw, AlertTriangle, Users } from 'lucide-react';
import jsQR from 'jsqr';
import { QRCodeSVG } from 'qrcode.react';
import { supabase } from '../lib/supabase/client';
import { publicAppUrl } from '../utils/publicAppUrl';

const CMSSAttendancePanel = ({ companyProfile, currentUser, cmmsUsers, userRole, isCreator }) => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  
  const [activeSubTab, setActiveSubTab] = useState('my-attendance'); // my-attendance, all-attendance, qr-scanner
  const [myAttendance, setMyAttendance] = useState(null);
  const [allAttendance, setAllAttendance] = useState([]);
  const [showScanner, setShowScanner] = useState(false);
  const [scannerMode, setScannerMode] = useState('check-in'); // check-in, check-out
  const [location, setLocation] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [userLocation, setUserLocation] = useState(null);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [selectedUser, setSelectedUser] = useState('');
  const [qrLocationName, setQrLocationName] = useState('');
  const [generatedQr, setGeneratedQr] = useState(null);
  const streamRef = useRef(null);

  // Get user's current location
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
          setError('Could not retrieve device location. Location validation will be limited.');
        }
      );
    }
  }, []);

  // Load my attendance record
  useEffect(() => {
    loadMyAttendance();
  }, [currentUser, selectedDate]);

  // Load all attendance records (for admins)
  useEffect(() => {
    if (userRole === 'admin' || isCreator) {
      loadAllAttendance();
    }
  }, [selectedDate, userRole, isCreator]);

  // Default the QR to the business location so staff do not need to retype it.
  // The field stays editable for a separate entrance, branch, or worksite.
  useEffect(() => {
    if (!qrLocationName.trim() && companyProfile?.location?.trim()) {
      setQrLocationName(companyProfile.location.trim());
    }
  }, [companyProfile?.id, companyProfile?.location]);

  const loadMyAttendance = async () => {
    if (!currentUser || !companyProfile) return;
    
    try {
      const { data: cmmsUser } = await supabase
        .from('cmms_users')
        .select('id')
        .eq('cmms_company_id', companyProfile.id)
        .eq('email', currentUser.email)
        .maybeSingle();

      if (!cmmsUser) return;

      const { data: todayAttendance } = await supabase
        .from('cmms_staff_attendance')
        .select('*')
        .eq('cmms_user_id', cmmsUser.id)
        .eq('cmms_company_id', companyProfile.id)
        .gte('check_in_time', `${selectedDate}T00:00:00`)
        .lt('check_in_time', `${selectedDate}T23:59:59`)
        .order('check_in_time', { ascending: false })
        .limit(1)
        .maybeSingle();

      setMyAttendance(todayAttendance);
    } catch (err) {
      console.error('Error loading attendance:', err);
    }
  };

  const loadAllAttendance = async () => {
    if (!companyProfile) return;

    try {
      const { data } = await supabase.rpc('get_attendance_records', {
        p_cmms_company_id: companyProfile.id,
        p_start_date: selectedDate,
        p_end_date: selectedDate,
        p_user_id: selectedUser || null
      });

      setAllAttendance(data || []);
    } catch (err) {
      console.error('Error loading all attendance:', err);
    }
  };

  const handleCheckIn = async () => {
    if (!location.trim()) {
      setError('Please enter your current location');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const { data: cmmsUser } = await supabase
        .from('cmms_users')
        .select('id')
        .eq('cmms_company_id', companyProfile.id)
        .eq('email', currentUser.email)
        .single();

      const { data: result, error: checkInError } = await supabase.rpc('staff_check_in', {
        p_cmms_user_id: cmmsUser.id,
        p_cmms_company_id: companyProfile.id,
        p_location: location,
        p_latitude: userLocation?.latitude || null,
        p_longitude: userLocation?.longitude || null
      });

      if (checkInError) throw checkInError;

      setSuccess(`✅ Checked in at ${location}`);
      setLocation('');
      setShowScanner(false);
      loadMyAttendance();
    } catch (err) {
      setError(err.message || 'Check-in failed');
    } finally {
      setLoading(false);
    }
  };

  const handleCheckOut = async () => {
    if (!myAttendance) {
      setError('No active check-in found');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const { error: checkOutError } = await supabase.rpc('staff_check_out', {
        p_attendance_id: myAttendance.id,
        p_location: location || myAttendance.check_in_location,
        p_latitude: userLocation?.latitude || null,
        p_longitude: userLocation?.longitude || null
      });

      if (checkOutError) throw checkOutError;

      setSuccess('✅ Checked out successfully');
      setLocation('');
      setShowScanner(false);
      loadMyAttendance();
    } catch (err) {
      setError(err.message || 'Check-out failed');
    } finally {
      setLoading(false);
    }
  };

  const startQRScanner = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        scanQRCode();
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

  const scanQRCode = () => {
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
            setLocation(code.data);
            setShowScanner(false);
            setSuccess('✅ Location scanned from QR code');
          }
        }
      }, 100);

      return () => clearInterval(scanInterval);
    }
  };

  const createLocationQr = async () => {
    const locationName = qrLocationName.trim() || companyProfile?.location?.trim() || '';
    if (!locationName || !companyProfile?.id) {
      setError('Set the business location before generating the staff QR code.');
      return;
    }
    if (locationName !== qrLocationName) setQrLocationName(locationName);
    setLoading(true);
    setError('');
    const { data, error: createError } = await supabase.rpc('create_cmms_attendance_qr_location', {
      p_cmms_company_id: companyProfile.id,
      p_location_name: locationName
    });
    setLoading(false);
    if (createError) {
      setError(createError.message);
      return;
    }
    const record = Array.isArray(data) ? data[0] : data;
    setGeneratedQr(record ? { ...record, url: `${publicAppUrl()}/staff-attendance?token=${encodeURIComponent(record.token)}` } : null);
  };

  return (
    <div className="space-y-6">
      {/* Attendance Sub-Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-white/20 pb-4">
        <button
          onClick={() => setActiveSubTab('my-attendance')}
          className={`px-4 py-2 rounded-lg font-semibold transition-all ${
            activeSubTab === 'my-attendance'
              ? 'bg-emerald-600 text-white'
              : 'bg-white/10 text-gray-300 hover:bg-white/20'
          }`}
        >
          <Clock className="inline w-4 h-4 mr-2" />
          My Attendance
        </button>
        {(userRole === 'admin' || isCreator) && (
          <>
            <button
              onClick={() => setActiveSubTab('all-attendance')}
              className={`px-4 py-2 rounded-lg font-semibold transition-all ${
                activeSubTab === 'all-attendance'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white/10 text-gray-300 hover:bg-white/20'
              }`}
            >
              <Users className="inline w-4 h-4 mr-2" />
              All Staff Attendance
            </button>
            <button
              onClick={() => setActiveSubTab('qr-scanner')}
              className={`px-4 py-2 rounded-lg font-semibold transition-all ${
                activeSubTab === 'qr-scanner'
                  ? 'bg-purple-600 text-white'
                  : 'bg-white/10 text-gray-300 hover:bg-white/20'
              }`}
            >
              <QrCode className="inline w-4 h-4 mr-2" />
              QR Scanner
            </button>
          </>
        )}
      </div>

      {/* My Attendance Section */}
      {activeSubTab === 'my-attendance' && (
        <div className="glass-card p-6 space-y-6">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Clock className="w-5 h-5 text-emerald-400" />
            Your Attendance Today
          </h3>

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

          {myAttendance ? (
            <div className="bg-slate-800/60 border border-emerald-500/40 p-6 rounded-lg space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-gray-300">Status:</span>
                <span className={`px-3 py-1 rounded-full font-semibold text-sm ${
                  myAttendance.status === 'checked_in' 
                    ? 'bg-emerald-500/30 text-emerald-200' 
                    : 'bg-gray-500/30 text-gray-200'
                }`}>
                  {myAttendance.status === 'checked_in' ? '✅ Checked In' : '✅ Checked Out'}
                </span>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <span className="text-gray-400 text-sm">Check-In Time:</span>
                  <p className="text-white font-semibold">
                    {new Date(myAttendance.check_in_time).toLocaleTimeString()}
                  </p>
                </div>
                {myAttendance.check_out_time && (
                  <div>
                    <span className="text-gray-400 text-sm">Check-Out Time:</span>
                    <p className="text-white font-semibold">
                      {new Date(myAttendance.check_out_time).toLocaleTimeString()}
                    </p>
                  </div>
                )}
              </div>

              <div>
                <span className="text-gray-400 text-sm flex items-center gap-2">
                  <MapPin className="w-4 h-4" />
                  Location:
                </span>
                <p className="text-white font-semibold">{myAttendance.check_in_location}</p>
                {!myAttendance.location_validated && (
                  <p className="text-yellow-300 text-xs mt-1 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    Location does not match company location
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-slate-800/60 p-6 rounded-lg text-center">
              <p className="text-gray-300 mb-4">You haven't checked in yet today</p>
            </div>
          )}

          {/* Check-In/Check-Out Controls */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-300 mb-2">Your Location</label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Enter your current location"
                className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-500 focus:border-blue-400 transition-all"
              />
              <div className="mt-2 flex gap-2">
                <button
                  onClick={startQRScanner}
                  className="flex-1 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-semibold flex items-center justify-center gap-2 transition-all"
                >
                  <QrCode className="w-4 h-4" />
                  Scan QR Code
                </button>
              </div>
            </div>

            {/* QR Scanner Modal */}
            {showScanner && (
              <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
                <div className="bg-slate-900 rounded-lg p-6 max-w-md w-full">
                  <h4 className="text-white font-bold mb-4">Scan Location QR Code</h4>
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

            <div className="flex gap-3">
              {!myAttendance ? (
                <button
                  onClick={handleCheckIn}
                  disabled={loading}
                  className="flex-1 px-4 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-600 text-white rounded-lg font-semibold flex items-center justify-center gap-2 transition-all"
                >
                  {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                  {loading ? 'Checking In...' : 'Check In'}
                </button>
              ) : (
                <button
                  onClick={handleCheckOut}
                  disabled={loading}
                  className="flex-1 px-4 py-3 bg-red-600 hover:bg-red-700 disabled:bg-gray-600 text-white rounded-lg font-semibold flex items-center justify-center gap-2 transition-all"
                >
                  {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
                  {loading ? 'Checking Out...' : 'Check Out'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* All Attendance Section (Admin Only) */}
      {activeSubTab === 'all-attendance' && (userRole === 'admin' || isCreator) && (
        <div className="glass-card p-6 space-y-4">
          <h3 className="text-lg font-bold text-white">Staff Attendance Records</h3>

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
              <label className="block text-sm text-gray-300 mb-2">Filter by Staff</label>
              <select
                value={selectedUser}
                onChange={(e) => setSelectedUser(e.target.value)}
                className="px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white"
              >
                <option value="">All Staff</option>
                {cmmsUsers.map(user => (
                  <option key={user.id} value={user.id}>{user.email}</option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <button
                onClick={loadAllAttendance}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold flex items-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                Refresh
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-white/10 border-b border-white/20">
                <tr>
                  <th className="px-4 py-2 text-left text-gray-300">Staff Email</th>
                  <th className="px-4 py-2 text-left text-gray-300">Check-In</th>
                  <th className="px-4 py-2 text-left text-gray-300">Check-Out</th>
                  <th className="px-4 py-2 text-left text-gray-300">Location</th>
                  <th className="px-4 py-2 text-left text-gray-300">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {allAttendance.map(record => (
                  <tr key={record.id} className="hover:bg-white/5">
                    <td className="px-4 py-2 text-gray-300">{record.user_email}</td>
                    <td className="px-4 py-2 text-gray-300">{new Date(record.check_in_time).toLocaleTimeString()}</td>
                    <td className="px-4 py-2 text-gray-300">
                      {record.check_out_time ? new Date(record.check_out_time).toLocaleTimeString() : '-'}
                    </td>
                    <td className="px-4 py-2 text-gray-300">{record.check_in_location}</td>
                    <td className="px-4 py-2">
                      <span className={`px-2 py-1 rounded text-xs font-semibold ${
                        record.location_validated 
                          ? 'bg-emerald-500/30 text-emerald-200' 
                          : 'bg-yellow-500/30 text-yellow-200'
                      }`}>
                        {record.location_validated ? '✓ Valid' : '⚠ Invalid'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {allAttendance.length === 0 && (
              <div className="text-center py-6 text-gray-400">No attendance records found</div>
            )}
          </div>
        </div>
      )}

      {/* QR Scanner Section (Admin Only) */}
      {activeSubTab === 'qr-scanner' && (userRole === 'admin' || isCreator) && (
        <div className="glass-card p-6 space-y-4">
          <h3 className="text-lg font-bold text-white">Generate QR Codes for Staff</h3>
          <p className="text-gray-400 text-sm">Create one QR code per physical check-in point. Scanning it opens a standalone staff-verification page, not the ICAN dashboard.</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input value={qrLocationName} onChange={(event) => setQrLocationName(event.target.value)} placeholder="Location, e.g. Main entrance" className="flex-1 rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white" />
            <button onClick={createLocationQr} disabled={loading} className="rounded-lg bg-indigo-600 px-4 py-2 font-semibold text-white disabled:opacity-60">Create secure QR</button>
          </div>
          {generatedQr && <div className="rounded-xl bg-white/10 p-5 text-center"><p className="mb-3 font-semibold text-white">{generatedQr.location_name}</p><div className="inline-block rounded-lg bg-white p-3"><QRCodeSVG value={generatedQr.url} size={180} /></div><p className="mt-3 break-all text-xs text-gray-400">{generatedQr.url}</p><p className="mt-2 text-xs text-emerald-300">Only signed-in active staff for this business can check in with this code.</p></div>}
        </div>
      )}
    </div>
  );
};

export default CMSSAttendancePanel;

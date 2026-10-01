import React, { useState, useEffect } from 'react';
import { ArrowLeft, Calendar, ChevronDown, Clock, Download, Info, Maximize2, Users, QrCode, MapPin, CheckCircle, XCircle, Copy, Eye, Search, Filter, Trash2, LogIn, LogOut, RefreshCw } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { supabase } from '../lib/supabase/client';
import { getPublicAppUrl } from '../utils/publicAppUrl';
import { downloadCmmsQrPdf } from '../utils/downloadCmmsQrPdf';
import { downloadCmmsRecordsExcel, downloadCmmsRecordsPdf } from '../utils/cmmsRecordExports';
import {
  getCheckoutPayStatus, getRewardsSettings, saveRewardsSettings, getEmployeeRewardPoints,
  getRewardPointsHistory, getPendingRewardRedemptions, requestRewardRedemption,
  cancelRewardRedemption, payRewardRedemption
} from '../services/businessManagementService';
import { ICAN_TO_UGX, transferFromBusinessWallet } from '../services/icanWalletService';
import CMMSWelfareAdminPanel from './CMMSWelfareAdminPanel.jsx';
import CMMSItemCustodyPanel from './CMMSItemCustodyPanel.jsx';
import CMMSEmployeeWelfare from './CMMSEmployeeWelfare.jsx';

// Tab accents match the payroll page's pill tabs (see CMMSPayrollPanel).
const ATTENDANCE_TAB_ACCENTS = { summary: 'gold', records: 'navy', manual: 'teal', 'qr-codes': 'burgundy', rewards: 'plum', welfare: 'emerald', items: 'gold' };

const CMSSAttendancePanel = ({ companyProfile, currentUser, cmmsUsers, userRole, isCreator, hasToolAction }) => {
  const [fullPage, setFullPage] = useState(false);
  const [headerInfo, setHeaderInfo] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [logFiltersOpen, setLogFiltersOpen] = useState(false);
  const [expandedRecordId, setExpandedRecordId] = useState(null);
  const [copiedQrId, setCopiedQrId] = useState(null);
  const [expandedStaffId, setExpandedStaffId] = useState(null);
  const [attendanceRecords, setAttendanceRecords] = useState([]);
  const [attendanceSummary, setAttendanceSummary] = useState([]);
  const [activeCheckIns, setActiveCheckIns] = useState([]);
  const [qrCodes, setQrCodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('summary');
  const [welfareView, setWelfareView] = useState('decide');
  const today = new Date().toISOString().split('T')[0];
  const defaultSummaryStart = new Date();
  defaultSummaryStart.setDate(defaultSummaryStart.getDate() - 29);
  // Default to a 30-day window, not just today: a check-in COUNT is only
  // meaningful across multiple days — "today only" would show 1 for everyone.
  const [startDate, setStartDate] = useState(defaultSummaryStart.toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(today);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStaffId, setSelectedStaffId] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [manualStaffId, setManualStaffId] = useState('');
  const [manualLocation, setManualLocation] = useState('');
  const [manualLoading, setManualLoading] = useState(false);
  const [manualError, setManualError] = useState('');
  const [manualSuccess, setManualSuccess] = useState('');
  const [summaryLoadError, setSummaryLoadError] = useState('');
  const [dayAdjustments, setDayAdjustments] = useState([]);
  const [addDaysStaffId, setAddDaysStaffId] = useState('');
  const [addDaysCount, setAddDaysCount] = useState('');
  const [addDaysReason, setAddDaysReason] = useState('');
  const [addDaysLoading, setAddDaysLoading] = useState(false);
  const [payPrompt, setPayPrompt] = useState(null); // { attendanceId, staffName, status, paid, method, pin, busy, error }
  const [rewardsSettings, setRewardsSettings] = useState(null);
  const [rewardsForm, setRewardsForm] = useState(null);
  const [rewardBalances, setRewardBalances] = useState([]);
  const [rewardHistory, setRewardHistory] = useState([]);
  const [pendingRedemptions, setPendingRedemptions] = useState([]);
  const [rewardsLoading, setRewardsLoading] = useState(false);
  const [rewardsNotice, setRewardsNotice] = useState('');
  const [rewardsError, setRewardsError] = useState('');
  const [rewardsSaving, setRewardsSaving] = useState(false);
  const [redeemPrompt, setRedeemPrompt] = useState(null); // { redemptionId, staffName, icanAmount, method, pin, busy, error }

  // Company admins/creators always retain every attendance power. Beyond
  // that, access is per-action and role-configurable (Role and tool
  // configuration → Staff attendance & QR check-in) via hasToolAction —
  // mirrors backend/CMMS_ATTENDANCE_ROLE_BASED_PERMISSIONS.sql exactly, so
  // a role can be granted just manual check-in/out, just adding days, or
  // just exporting, without full admin rights.
  const isFullAdmin = userRole === 'admin' || isCreator;
  const canViewAll = isFullAdmin || Boolean(hasToolAction?.('attendance', 'view'));
  const canManualCheckInOut = isFullAdmin || Boolean(hasToolAction?.('attendance', 'manual'));
  const canAddDays = isFullAdmin || Boolean(hasToolAction?.('attendance', 'days'));
  const canExport = isFullAdmin || Boolean(hasToolAction?.('attendance', 'print'));
  // QR code generation/administration is unchanged — still admin/creator-only.
  const canManage = isFullAdmin;
  // Leave/probation/welfare decisions are their own admin-picked permission
  // (Role and tool configuration → Staff attendance & QR check-in →
  // "Welfare" checkbox) — deliberately not tied to Manual/Add-days, so
  // granting one doesn't silently grant the other. Mirrors
  // cmms_can_manage_welfare() in backend/CMMS_EMPLOYEE_WELFARE_SYSTEM.sql,
  // which checks the identical "welfare" action server-side.
  const canManageWelfare = isFullAdmin || Boolean(hasToolAction?.('attendance', 'welfare'))
    || Boolean(hasToolAction?.('leave-welfare', 'approve'));
  // A role granted only "Welfare" (no "View") should still see the Leave &
  // Welfare sub-tab -- it doesn't need staff-wide attendance visibility to
  // decide HR requests.
  const canSeeWelfareTab = canViewAll || canManageWelfare || Boolean(hasToolAction?.('leave-welfare', 'see_all'));
  // Items taken/returned is its own admin-picked permission (Role and tool
  // configuration -> "Item requests & custody": request / see all / manage),
  // enforced server-side; the panel itself asks the server what this person
  // may do, so this only decides whether the tab is offered.
  const canSeeItemsTab = isFullAdmin || userRole === 'storeman'
    || ['request', 'see_all', 'manage'].some((action) => Boolean(hasToolAction?.('item-custody', action)));

  useEffect(() => {
    loadData();
  }, [companyProfile, startDate, endDate, selectedStaffId]);

  // Someone who can decide leave/welfare but can't see other staff's
  // attendance (a dedicated "Leave & welfare approvals" role) lands on the
  // tab they actually work from instead of an empty summary.
  useEffect(() => {
    if (!canViewAll && canSeeWelfareTab) setActiveTab((tab) => (tab === 'summary' ? 'welfare' : tab));
  }, [canViewAll, canSeeWelfareTab]);

  useEffect(() => {
    // A regular staff member only ever gets their own single row back from
    // get_employee_reward_points (it self-restricts server-side), so it's
    // safe to also warm this up on the Records tab and show it alongside
    // their own attendance — no other employee's data is ever exposed here.
    if (activeTab === 'rewards' || (activeTab === 'records' && !canViewAll)) loadRewards();
  }, [activeTab, companyProfile, canViewAll]);

  useEffect(() => {
    if (!manualLocation.trim() && companyProfile?.location?.trim()) {
      setManualLocation(companyProfile.location.trim());
    }
  }, [companyProfile?.id, companyProfile?.location]);

  const loadData = async () => {
    if (!companyProfile?.id) return;
    setLoading(true);

    try {
      const [recordsRes, summaryRes, activeRes, qrRes, adjustmentsRes] = await Promise.all([
        supabase.rpc('get_attendance_records', {
          p_cmms_company_id: companyProfile.id,
          p_start_date: startDate || null,
          p_end_date: endDate || null,
          p_user_id: canViewAll && selectedStaffId ? selectedStaffId : null
        }),

        supabase.rpc('get_attendance_summary', {
          p_cmms_company_id: companyProfile.id,
          p_start_date: startDate || null,
          p_end_date: endDate || null,
          p_user_id: canViewAll && selectedStaffId ? selectedStaffId : null
        }),

        canManualCheckInOut ? supabase.rpc('get_active_staff_check_ins', {
          p_cmms_company_id: companyProfile.id
        }) : { data: [], error: null },

        canManage ? supabase
          .from('cmms_attendance_qr_locations')
          .select('*')
          .eq('cmms_company_id', companyProfile.id)
          .order('created_at', { ascending: false }) : { data: [], error: null },

        canAddDays ? supabase.rpc('get_attendance_day_adjustments', {
          p_cmms_company_id: companyProfile.id
        }) : { data: [], error: null }
      ]);

      // Log errors for debugging
      if (recordsRes.error) {
        console.error('Attendance records error:', recordsRes.error);
      }
      if (summaryRes.error) {
        console.error('Attendance summary error:', summaryRes.error);
        const message = summaryRes.error?.message || '';
        setSummaryLoadError(
          summaryRes.error?.code === 'PGRST202' || /could not find the function|schema cache/i.test(message)
            ? 'The check-in summary service has not been deployed to Supabase yet. Run backend/CMMS_ATTENDANCE_SUMMARY_AND_MANUAL_CHECKIN.sql in the Supabase SQL Editor, then refresh.'
            : (message || 'Failed to load the check-in summary')
        );
      } else {
        setSummaryLoadError('');
      }
      if (activeRes.error) {
        console.error('Active check-ins error:', activeRes.error);
      }
      if (qrRes.error) {
        console.error('QR codes error:', qrRes.error);
      }
      if (adjustmentsRes.error) {
        console.error('Attendance day adjustments error:', adjustmentsRes.error);
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
      setAttendanceSummary(summaryRes.data || []);
      setActiveCheckIns(activeRes.data || []);
      setQrCodes(qrRes.data || []);
      setDayAdjustments(adjustmentsRes.data || []);
    } catch (error) {
      console.error('Load data error:', error);
      setAttendanceRecords([]);
      setAttendanceSummary([]);
      setActiveCheckIns([]);
      setQrCodes([]);
      setDayAdjustments([]);
    } finally {
      setLoading(false);
    }
  };

  // Points are earned automatically by database triggers on check-in, a
  // filed report, a sent message, and a completed task — this only reads
  // balances/history back. An employee's own RPC calls are self-restricted
  // server-side (get_employee_reward_points / get_reward_points_history),
  // so a non-admin viewing this tab simply gets back their own single row.
  const loadRewards = async () => {
    if (!companyProfile?.id) return;
    setRewardsLoading(true);
    setRewardsError('');
    try {
      const [settingsRes, balancesRes, historyRes, pendingRes] = await Promise.all([
        isFullAdmin ? getRewardsSettings(companyProfile.id) : { data: null, error: null },
        getEmployeeRewardPoints(companyProfile.id),
        isFullAdmin ? { data: [], error: null } : getRewardPointsHistory(companyProfile.id),
        isFullAdmin ? getPendingRewardRedemptions(companyProfile.id) : { data: [], error: null }
      ]);
      if (settingsRes.error) console.error('Rewards settings error:', settingsRes.error);
      if (balancesRes.error) console.error('Reward balances error:', balancesRes.error);
      if (historyRes.error) console.error('Reward history error:', historyRes.error);
      if (pendingRes.error) console.error('Pending redemptions error:', pendingRes.error);
      const anyError = settingsRes.error || balancesRes.error || historyRes.error || pendingRes.error;
      if (anyError) {
        const message = anyError.message || '';
        setRewardsError(
          anyError.code === 'PGRST202' || /could not find the function|schema cache/i.test(message)
            ? 'The rewards service has not been deployed to Supabase yet. Run backend/CMMS_EMPLOYEE_REWARDS_POINTS.sql in the Supabase SQL Editor, then refresh.'
            : (message || 'Failed to load rewards')
        );
      }
      setRewardsSettings(settingsRes.data);
      setRewardsForm(settingsRes.data || {
        enabled: false, points_per_checkin: 1, points_per_early_checkin: 2, early_checkin_minutes: 10,
        points_per_report: 3, points_per_task_completed: 5, points_per_message: 0, message_daily_cap: 5,
        points_per_positive_visitor_rating: 5, visitor_rating_positive_threshold: 4,
        ican_coins_per_point: 0, auto_redeem_enabled: false, auto_redeem_threshold_points: 100
      });
      setRewardBalances(balancesRes.data || []);
      setRewardHistory(historyRes.data || []);
      setPendingRedemptions(pendingRes.data || []);
    } catch (error) {
      console.error('Load rewards error:', error);
    } finally {
      setRewardsLoading(false);
    }
  };

  const saveRewards = async (e) => {
    e.preventDefault();
    if (!isFullAdmin || !rewardsForm) return;
    setRewardsSaving(true);
    setRewardsError('');
    setRewardsNotice('');
    const result = await saveRewardsSettings(companyProfile.id, rewardsForm);
    if (result.success) {
      setRewardsNotice('Rewards settings saved.');
      await loadRewards();
    } else {
      setRewardsError(result.error || 'Could not save rewards settings.');
    }
    setRewardsSaving(false);
  };

  const handleRedeemNow = async (cmmsUserId) => {
    setRewardsError('');
    setRewardsNotice('');
    const result = await requestRewardRedemption(companyProfile.id, cmmsUserId);
    if (result.success) {
      setRewardsNotice('Redemption queued — pay it from Pending redemptions below.');
      await loadRewards();
    } else {
      setRewardsError(result.error || 'Could not queue this redemption.');
    }
  };

  const handleCancelRedemption = async (redemptionId) => {
    setRewardsError('');
    setRewardsNotice('');
    const result = await cancelRewardRedemption(redemptionId);
    if (result.success) {
      setRewardsNotice('Redemption cancelled — points returned to the employee.');
      await loadRewards();
    } else {
      setRewardsError(result.error || 'Could not cancel this redemption.');
    }
  };

  const submitRedeemPrompt = async () => {
    if (!redeemPrompt) return;
    if (redeemPrompt.method === 'ican' && !redeemPrompt.pin) {
      setRedeemPrompt((prev) => ({ ...prev, error: 'Enter the business-wallet PIN.' }));
      return;
    }
    setRedeemPrompt((prev) => ({ ...prev, busy: true, error: '' }));
    try {
      let walletTransactionId = null;
      if (redeemPrompt.method === 'ican') {
        const transfer = await transferFromBusinessWallet({
          businessProfileId: companyProfile.pichin_business_profile_id,
          recipientUserId: redeemPrompt.employeeUserId,
          amount: Number(redeemPrompt.icanAmount),
          note: `Reward points redeemed (${redeemPrompt.staffName})`,
          referenceId: redeemPrompt.redemptionId,
          pin: redeemPrompt.pin
        });
        walletTransactionId = transfer.transaction_id || transfer.id || null;
      }
      const result = await payRewardRedemption({ redemptionId: redeemPrompt.redemptionId, paymentMethod: redeemPrompt.method, walletTransactionId });
      if (!result.success) throw new Error(result.error);
      setRewardsNotice(redeemPrompt.method === 'ican' ? 'Reward points paid through the IcanEra business wallet.' : 'Reward points recorded as paid in cash.');
      setRedeemPrompt(null);
      await loadRewards();
    } catch (error) {
      setRedeemPrompt((prev) => ({ ...prev, busy: false, error: error.message || 'Could not record this payment.' }));
    }
  };

  const handleManualCheckIn = async () => {
    if (!manualStaffId) {
      setManualError('Select a staff member to check in');
      return;
    }
    if (!manualLocation.trim()) {
      setManualError('Location is required');
      return;
    }

    setManualLoading(true);
    setManualError('');
    setManualSuccess('');

    try {
      const { error } = await supabase.rpc('staff_check_in', {
        p_cmms_user_id: manualStaffId,
        p_cmms_company_id: companyProfile.id,
        p_location: manualLocation.trim()
      });
      if (error) throw error;

      const staff = staffOptions.find((option) => option.id === manualStaffId);
      setManualSuccess(`✅ ${staff?.label || 'Staff member'} checked in`);
      setManualStaffId('');
      await loadData();
    } catch (error) {
      setManualError(error.message || 'Manual check-in failed');
    } finally {
      setManualLoading(false);
    }
  };

  const handleManualCheckOut = async (attendanceId) => {
    setManualError('');
    setManualSuccess('');

    // A daily-paid staff member settles every day at check-out; a monthly/
    // weekly/hourly/contract staff member only once their check-outs this
    // month reach the agreed monthly_work_days. Either way, check-out is
    // blocked until this is answered — so ask first, before touching
    // staff_check_out at all.
    const entry = activeCheckIns.find((item) => item.id === attendanceId);
    const { data: status } = await getCheckoutPayStatus({ cmmsUserId: entry?.cmms_user_id, cmmsCompanyId: companyProfile.id, attendanceId });
    if (status?.required) {
      setPayPrompt({ attendanceId, staffName: entry?.user_name || 'this staff member', status, paid: null, method: 'cash', pin: '', busy: false, error: '' });
      return;
    }

    setManualLoading(true);
    try {
      await finalizeCheckOut(attendanceId);
      setManualSuccess('✅ Staff member checked out');
    } catch (error) {
      setManualError(error.message || 'Manual check-out failed');
    } finally {
      setManualLoading(false);
    }
  };

  // Completes the actual check-out RPC. paid/method/walletTransactionId are
  // only meaningful when a pay decision was due; staff_check_out settles the
  // payroll entry (cash or wallet) in the same call, before marking the
  // attendance record checked out.
  const finalizeCheckOut = async (attendanceId, paid = null, method = null, walletTransactionId = null) => {
    const { error } = await supabase.rpc('staff_check_out', {
      p_attendance_id: attendanceId,
      p_location: manualLocation.trim() || null,
      p_paid: paid,
      p_payment_method: method,
      p_wallet_transaction_id: walletTransactionId
    });
    if (error) throw error;
    await loadData();
  };

  const submitPayPrompt = async () => {
    if (!payPrompt) return;
    if (payPrompt.paid === null) {
      setPayPrompt((prev) => ({ ...prev, error: 'Choose whether pay has been received.' }));
      return;
    }
    if (payPrompt.paid && !payPrompt.method) {
      setPayPrompt((prev) => ({ ...prev, error: 'Choose cash or wallet.' }));
      return;
    }
    setPayPrompt((prev) => ({ ...prev, busy: true, error: '' }));
    try {
      let walletTransactionId = null;
      if (payPrompt.paid && payPrompt.method === 'ican') {
        if ((payPrompt.status.currency || 'UGX') !== 'UGX') throw new Error('The IcanEra wallet currently supports UGX pay only. Choose cash for another currency.');
        if (!payPrompt.pin) throw new Error('Enter the business-wallet PIN.');
        const transfer = await transferFromBusinessWallet({
          businessProfileId: companyProfile.pichin_business_profile_id,
          recipientUserId: payPrompt.status.employee_user_id,
          amount: Number(payPrompt.status.amount) / ICAN_TO_UGX,
          note: `Attendance pay ${payPrompt.status.period_start} - ${payPrompt.status.period_end}`,
          referenceId: payPrompt.attendanceId,
          pin: payPrompt.pin
        });
        walletTransactionId = transfer.transaction_id || transfer.id || null;
      }
      await finalizeCheckOut(payPrompt.attendanceId, payPrompt.paid, payPrompt.paid ? payPrompt.method : null, walletTransactionId);
      setManualSuccess(payPrompt.paid ? `✅ Checked out and pay recorded (${payPrompt.method === 'ican' ? 'IcanEra wallet' : 'cash'}).` : '✅ Checked out. Pay marked not yet received — follow up in Payroll.');
      setPayPrompt(null);
    } catch (error) {
      setPayPrompt((prev) => ({ ...prev, busy: false, error: error.message || 'Could not record this payment.' }));
    }
  };

  const handleAddDays = async () => {
    const days = parseInt(addDaysCount, 10);

    if (!addDaysStaffId) {
      setManualError('Select a staff member to credit days to');
      return;
    }
    if (!Number.isInteger(days) || days <= 0) {
      setManualError('Days to add must be a positive whole number. Days present cannot be reduced.');
      return;
    }

    setAddDaysLoading(true);
    setManualError('');
    setManualSuccess('');

    try {
      const { error } = await supabase.rpc('admin_add_attendance_days', {
        p_cmms_company_id: companyProfile.id,
        p_cmms_user_id: addDaysStaffId,
        p_days: days,
        p_reason: addDaysReason.trim() || null
      });
      if (error) throw error;

      const staff = staffOptions.find((option) => option.id === addDaysStaffId);
      setManualSuccess(`✅ Added ${days} day${days === 1 ? '' : 's'} to ${staff?.label || 'staff member'}`);
      setAddDaysStaffId('');
      setAddDaysCount('');
      setAddDaysReason('');
      await loadData();
    } catch (error) {
      setManualError(error.message || 'Adding attendance days failed');
    } finally {
      setAddDaysLoading(false);
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

  // Smart search: a staff member matches by name or email, and also by any
  // date/time text of their check-ins (e.g. "2026-09-15", "15 sep", "monday",
  // "08:1"). When only dates match, just the matching check-ins are shown.
  const checkInSearchText = (record) => {
    const d = new Date(record.check_in_time);
    const out = record.check_out_time ? new Date(record.check_out_time) : null;
    return [
      record.check_in_time?.slice(0, 10), d.toLocaleDateString(), d.toLocaleTimeString(),
      d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
      d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
      out ? out.toLocaleTimeString() : '', record.check_in_location || ''
    ].join(' ').toLowerCase();
  };
  const searchQuery = searchTerm.trim().toLowerCase();
  const visibleAttendanceRecords = attendanceRecords.filter((record) => {
    const query = searchTerm.trim().toLowerCase();
    const matchesSearch = !query || [record.staff?.full_name, record.staff?.email, record.check_in_location, record.check_out_location]
      .some((value) => value?.toLowerCase().includes(query)) || checkInSearchText(record).includes(query);
    const recordStatus = record.check_out_time ? 'complete' : 'active';
    return matchesSearch && (statusFilter === 'all' || statusFilter === recordStatus);
  });

  const recordsByStaff = attendanceRecords.reduce((map, record) => {
    (map[record.cmms_user_id] ||= []).push(record);
    return map;
  }, {});
  const staffRows = attendanceSummary.map((entry) => {
    const all = (recordsByStaff[entry.cmms_user_id] || []).slice().sort((a, b) => new Date(b.check_in_time) - new Date(a.check_in_time));
    const nameMatch = !searchQuery || [entry.user_name, entry.user_email].some((value) => value?.toLowerCase().includes(searchQuery));
    const checkIns = nameMatch ? all : all.filter((record) => checkInSearchText(record).includes(searchQuery));
    return { entry, checkIns, nameMatch };
  }).filter((row) => row.nameMatch || row.checkIns.length > 0);
  const visibleAttendanceSummary = staffRows.map((row) => row.entry);

  const summaryColumns = [
    { label: 'Staff Name', value: (entry) => entry.user_name || 'Unknown' },
    { label: 'Email', value: (entry) => entry.user_email || '' },
    { label: 'Check-Ins', value: (entry) => entry.check_in_count },
    { label: 'Days Present', value: (entry) => entry.days_present },
    { label: 'Manual Days Added', value: (entry) => entry.manual_days_added || 0 },
    { label: 'First Check In', value: (entry) => entry.first_check_in_time ? new Date(entry.first_check_in_time).toLocaleDateString() : '' },
    { label: 'Last Check In', value: (entry) => entry.last_check_in_time ? new Date(entry.last_check_in_time).toLocaleString() : '' },
    { label: 'Currently Checked In', value: (entry) => entry.currently_checked_in ? 'Yes' : 'No' }
  ];

  const ensureAttendanceSummary = () => {
    if (visibleAttendanceSummary.length === 0) {
      alert('No attendance summary to export');
      return false;
    }
    return true;
  };

  const exportSummaryExcel = async () => {
    if (!ensureAttendanceSummary()) return;
    await downloadCmmsRecordsExcel({ filename: `attendance-summary-${startDate}-to-${endDate}`, sheetName: 'Attendance Summary', columns: summaryColumns, rows: visibleAttendanceSummary });
  };

  const exportSummaryPdf = async () => {
    if (!ensureAttendanceSummary()) return;
    await downloadCmmsRecordsPdf({ filename: `attendance-summary-${startDate}-to-${endDate}`, title: 'Staff Attendance Summary', subtitle: `${companyProfile?.company_name || 'CMMS'} check-in counts: ${startDate} to ${endDate}`, columns: summaryColumns, rows: visibleAttendanceSummary });
  };

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

  const setAllTimeRange = () => {
    setStartDate('2000-01-01');
    setEndDate(today);
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
    <div className={fullPage ? 'cmms-fullpage space-y-5 fixed inset-0 z-50 overflow-y-auto p-4 md:p-8' : 'space-y-5 cmms-classic-card p-4 md:p-6'}>
      {/* Header: slim row (medallion, title, company, actions), live chips, (i) for the explanation */}
      <div className="cmms-accent-gold space-y-2.5">
        <div className="flex items-center gap-3">
          <span className="cmms-medallion"><Clock className="h-4 w-4" aria-hidden="true" /></span>
          <div className="min-w-0 flex-1">
            <h2 className="cmms-classic-heading text-lg leading-tight">Staff Attendance</h2>
            {companyProfile?.company_name && <p className="truncate text-xs cmms-classic-muted">{companyProfile.company_name}</p>}
          </div>
          <button type="button" onClick={() => setHeaderInfo(v => !v)} aria-expanded={headerInfo} aria-label="About this page" title="What is this page?" className="cmms-info-btn">
            <Info className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          {canManage && (
            <button type="button" onClick={generateQRCode} aria-label="Generate QR Code" title="Generate QR Code" className="cmms-classic-btn-primary inline-flex !h-auto !min-h-0 flex-shrink-0 items-center gap-1.5 !px-3 !py-1.5 text-xs">
              <QrCode className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Generate QR Code</span>
            </button>
          )}
          {fullPage
            ? <button type="button" onClick={() => setFullPage(false)} className="cmms-classic-btn-secondary inline-flex !h-auto !min-h-0 flex-shrink-0 items-center gap-1.5 !px-3 !py-1.5 text-xs"><ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Back</button>
            : <button type="button" onClick={() => setFullPage(true)} className="cmms-info-btn" title="Open this tab as a full page" aria-label="Open full page"><Maximize2 className="h-3.5 w-3.5" aria-hidden="true" /></button>}
        </div>
        {activeCheckIns.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <span className="cmms-classic-chip" style={{ animation: 'cmms-rise .45s ease both' }}>{activeCheckIns.length} checked in now</span>
          </div>
        )}
        {headerInfo && <div className="cmms-info cmms-classic-muted"><p>Track and manage staff attendance: check-in counts, the detailed log, manual check-ins, QR codes, rewards, leave and items taken.</p></div>}
        <div className="cmms-ornament" aria-hidden="true" />

        {/* Tabs: pill tabs like Payroll; choosing one opens it as a full page */}
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [&>button]:flex-shrink-0 [&>button]:whitespace-nowrap" role="tablist" aria-label="Attendance sections" style={{ scrollbarWidth: 'none' }}>
          {[
            { id: 'summary', label: 'Check-In Summary' },
            { id: 'records', label: 'Detailed Log' },
            (canManualCheckInOut || canAddDays) && { id: 'manual', label: 'Manual Check-In/Out' },
            canManage && { id: 'qr-codes', label: 'QR Codes' },
            { id: 'rewards', label: 'Rewards' },
            { id: 'welfare', label: 'Leave & Welfare' },
            canSeeItemsTab && { id: 'items', label: 'Items Taken/Returned' }
          ].filter(Boolean).map(tab => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => { setActiveTab(tab.id); setFullPage(true); }}
              className={`cmms-ptab cmms-accent-${ATTENDANCE_TAB_ACCENTS[tab.id] || 'gold'} ${activeTab === tab.id ? 'is-active' : ''}`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Check-In Summary Tab: one row per staff member (count), not one row per day */}
      {activeTab === 'summary' && (
        <div className="space-y-4">
          {summaryLoadError && (
            <div className="bg-red-500/20 border border-red-500/50 text-red-200 p-4 rounded-lg">{summaryLoadError}</div>
          )}

          {/* Collapsible date range + export: closed it is one slim row showing the range */}
          <section className="cmms-sec cmms-accent-gold" data-open={filtersOpen}>
            <button type="button" onClick={() => setFiltersOpen(o => !o)} aria-expanded={filtersOpen}
              className="flex w-full items-center gap-3 text-left !bg-transparent" style={{ background: 'transparent', border: 0, padding: 0, boxShadow: 'none' }}>
              <span className="cmms-medallion"><Calendar className="h-4 w-4" aria-hidden="true" /></span>
              <span className="min-w-0 flex-1">
                <span className="cmms-classic-heading cmms-sec-title block">Date range</span>
                <span className="block truncate text-xs cmms-classic-muted">
                  {startDate ? new Date(`${startDate}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'Start'} → {endDate ? new Date(`${endDate}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'Today'}
                </span>
              </span>
              <ChevronDown className={`h-4 w-4 flex-shrink-0 cmms-classic-muted transition-transform duration-300 ${filtersOpen ? 'rotate-180' : ''}`} />
            </button>
            {filtersOpen && (
              <div className="cmms-sec-body mt-4 space-y-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="text-xs font-semibold cmms-classic-muted">From
                    <input type="date" value={startDate} max={endDate || undefined} onChange={(e) => setStartDate(e.target.value)} className="mt-1 w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg" aria-label="Summary start date" />
                  </label>
                  <label className="text-xs font-semibold cmms-classic-muted">To
                    <input type="date" value={endDate} min={startDate || undefined} max={today} onChange={(e) => setEndDate(e.target.value)} className="mt-1 w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg" aria-label="Summary end date" />
                  </label>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => setDatePreset(1)} className="!h-auto !min-h-0 !px-3 !py-1.5 text-xs cmms-classic-btn-secondary">Today</button>
                  <button onClick={() => setDatePreset(7)} className="!h-auto !min-h-0 !px-3 !py-1.5 text-xs cmms-classic-btn-secondary">7 days</button>
                  <button onClick={() => setDatePreset(30)} className="!h-auto !min-h-0 !px-3 !py-1.5 text-xs cmms-classic-btn-secondary">30 days</button>
                  <button onClick={setAllTimeRange} className="!h-auto !min-h-0 !px-3 !py-1.5 text-xs cmms-classic-btn-secondary">All time</button>
                </div>
                {canExport && (
                  <div className="flex flex-wrap gap-2 border-t border-[rgba(196,160,82,0.3)] pt-3">
                    <button onClick={exportSummaryExcel} className="!h-auto !min-h-0 !px-3 !py-1.5 text-xs cmms-classic-btn-secondary flex items-center gap-1.5">
                      <Download className="h-3.5 w-3.5" /> Excel
                    </button>
                    <button onClick={exportSummaryPdf} className="!h-auto !min-h-0 !px-3 !py-1.5 text-xs cmms-classic-btn-primary flex items-center gap-1.5">
                      <Download className="h-3.5 w-3.5" /> PDF
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>

          <label className="relative block">
            <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Search name, email, date (15 sep, 2026-09-15) or time" className="w-full rounded-lg border border-slate-700 bg-slate-800 py-2 pl-9 pr-3 text-sm" />
          </label>
          <p className="text-xs cmms-classic-muted">
            {staffRows.length} staff{searchQuery ? ' match' : ''} · tap a person to see the exact date and time of every check-in
          </p>

          {staffRows.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <Users className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>{searchQuery ? 'No staff or check-ins match your search' : 'No check-ins in this date range'}</p>
            </div>
          ) : (
            <ul className="grid gap-2.5 lg:grid-cols-2">
              {staffRows.map(({ entry, checkIns, nameMatch }, i) => {
                const name = entry.user_name || 'Unknown';
                const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
                const open = expandedStaffId === entry.cmms_user_id || (!!searchQuery && !nameMatch);
                const last = entry.last_check_in_time ? new Date(entry.last_check_in_time) : null;
                return (
                  <li key={entry.cmms_user_id} className="cmms-staff-card" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
                    <button type="button" onClick={() => setExpandedStaffId(expandedStaffId === entry.cmms_user_id ? null : entry.cmms_user_id)} aria-expanded={open}
                      className="flex w-full items-center gap-3 text-left !bg-transparent" style={{ background: 'transparent', border: 0, padding: 0, boxShadow: 'none' }}>
                      <span className="cmms-monogram">{initials || '?'}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{name}</span>
                        <span className="block truncate text-xs cmms-classic-muted">{entry.user_email}</span>
                        <span className="mt-1 flex flex-wrap items-center gap-1.5">
                          <span className="cmms-classic-chip !normal-case">{entry.check_in_count} check-ins</span>
                          <span className="cmms-classic-chip !normal-case">
                            {entry.days_present} days{entry.manual_days_added > 0 && <span title="Includes admin-added days"> (+{entry.manual_days_added})</span>}
                          </span>
                          {entry.currently_checked_in
                            ? <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: 'rgba(245,158,11,0.15)', color: '#b45309' }}><Clock className="h-3 w-3" />In now</span>
                            : <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: 'rgba(16,185,129,0.15)', color: '#047857' }}><CheckCircle className="h-3 w-3" />Out</span>}
                        </span>
                        <span className="mt-1 block text-xs cmms-classic-muted">
                          Last in: {last ? `${last.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} · ${last.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '—'}
                        </span>
                      </span>
                      <ChevronDown className={`h-4 w-4 flex-shrink-0 cmms-classic-muted transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
                    </button>
                    {open && (
                      <div className="cmms-sec-body mt-3 border-t border-[rgba(196,160,82,0.3)] pt-3">
                        {checkIns.length === 0 ? (
                          <p className="text-xs cmms-classic-muted">No individual check-ins recorded in this range{entry.manual_days_added > 0 ? ' (days were added by an admin)' : ''}.</p>
                        ) : (
                          <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                            {checkIns.map((record) => (
                              <li key={record.id || record.check_in_time} className="cmms-doc-row !py-2">
                                <span className="min-w-0">
                                  <span className="block text-sm font-semibold">{new Date(record.check_in_time).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span>
                                  <span className="block text-xs cmms-classic-muted">
                                    In {new Date(record.check_in_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    {' → '}
                                    {record.check_out_time ? `Out ${new Date(record.check_out_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'not out yet'}
                                    {record.check_in_location ? ` · ${record.check_in_location}` : ''}
                                  </span>
                                </span>
                                <span className="cmms-classic-chip !normal-case">{formatDuration(record.check_in_time, record.check_out_time)}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* Manual Check-In/Out Tab — each section is gated by its own role-configurable power */}
      {activeTab === 'manual' && (canManualCheckInOut || canAddDays) && (
        <div className="space-y-6">
          {manualError && (
            <div className="bg-red-500/20 border border-red-500/50 text-red-200 p-4 rounded-lg">{manualError}</div>
          )}
          {manualSuccess && (
            <div className="bg-emerald-500/20 border border-emerald-500/50 text-emerald-200 p-4 rounded-lg">{manualSuccess}</div>
          )}

          {canManualCheckInOut && (
          <div className="cmms-classic-card p-4 space-y-3">
            <h3 className="text-lg font-bold flex items-center gap-2"><LogIn className="h-5 w-5 text-indigo-400" />Manually check in a staff member</h3>
            <div className="grid gap-3 md:grid-cols-3">
              <select value={manualStaffId} onChange={(e) => setManualStaffId(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm">
                <option value="">Select staff member</option>
                {staffOptions.map((staff) => <option key={staff.id} value={staff.id}>{staff.label}</option>)}
              </select>
              <input
                type="text"
                value={manualLocation}
                onChange={(e) => setManualLocation(e.target.value)}
                placeholder="Location"
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
              />
              <button
                onClick={handleManualCheckIn}
                disabled={manualLoading || !manualStaffId || !manualLocation.trim()}
                className="px-4 py-2 cmms-classic-btn-primary disabled:opacity-50 rounded-lg flex items-center justify-center gap-2"
              >
                {manualLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
                Check In
              </button>
            </div>
          </div>
          )}

          {canManualCheckInOut && (
          <div className="cmms-classic-card p-4 space-y-3">
            <h3 className="text-lg font-bold flex items-center gap-2"><LogOut className="h-5 w-5 text-amber-400" />Currently checked in</h3>
            {activeCheckIns.length === 0 ? (
              <p className="text-sm text-slate-400">No staff are currently checked in.</p>
            ) : (
              <div className="space-y-2">
                {activeCheckIns.map((entry) => (
                  <div key={entry.id} className="flex items-center justify-between gap-3 p-3 bg-slate-900 border border-slate-700 rounded-lg">
                    <div>
                      <p className="font-semibold">{entry.user_name}</p>
                      <p className="text-xs text-slate-400">{entry.user_email} • In since {new Date(entry.check_in_time).toLocaleString()}</p>
                      {entry.check_in_location && <p className="text-xs text-slate-500 flex items-center gap-1"><MapPin className="h-3 w-3" />{entry.check_in_location}</p>}
                    </div>
                    <button
                      onClick={() => handleManualCheckOut(entry.id)}
                      disabled={manualLoading}
                      className="px-3 py-2 text-sm bg-rose-600 hover:bg-rose-700 disabled:opacity-50 rounded-lg flex items-center gap-2"
                    >
                      <LogOut className="h-4 w-4" />
                      Check Out
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          )}

          {canAddDays && (
          <div className="cmms-classic-card p-4 space-y-3">
            <div>
              <h3 className="text-lg font-bold flex items-center gap-2"><Calendar className="h-5 w-5 text-emerald-400" />Add attendance days</h3>
              <p className="text-xs text-slate-400 mt-1">Credit extra days present (e.g. approved field work, an outage that stopped QR check-in). This can only add days — it can never reduce a staff member's recorded attendance.</p>
            </div>
            <div className="grid gap-3 md:grid-cols-4">
              <select value={addDaysStaffId} onChange={(e) => setAddDaysStaffId(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm">
                <option value="">Select staff member</option>
                {staffOptions.map((staff) => <option key={staff.id} value={staff.id}>{staff.label}</option>)}
              </select>
              <input
                type="number"
                min="1"
                step="1"
                value={addDaysCount}
                onChange={(e) => setAddDaysCount(e.target.value)}
                placeholder="Days to add"
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
              />
              <input
                type="text"
                value={addDaysReason}
                onChange={(e) => setAddDaysReason(e.target.value)}
                placeholder="Reason (optional)"
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
              />
              <button
                onClick={handleAddDays}
                disabled={addDaysLoading || !addDaysStaffId || !addDaysCount}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-lg flex items-center justify-center gap-2"
              >
                {addDaysLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                Add Days
              </button>
            </div>

            {dayAdjustments.length > 0 && (
              <div className="pt-2">
                <p className="text-xs font-semibold text-slate-400 mb-2">Adjustment history</p>
                <div className="space-y-1 max-h-56 overflow-y-auto">
                  {dayAdjustments.map((entry) => (
                    <div key={entry.id} className="flex items-center justify-between gap-3 text-xs text-slate-400 px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg">
                      <span>
                        <span className="text-slate-200 font-semibold">{entry.user_name}</span>
                        {' '}+{entry.days_added} day{entry.days_added === 1 ? '' : 's'}
                        {entry.reason && <> — {entry.reason}</>}
                      </span>
                      <span className="whitespace-nowrap">{new Date(entry.created_at).toLocaleDateString()} by {entry.added_by_name || 'admin'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          )}
        </div>
      )}

      {/* Attendance Records Tab */}
      {activeTab === 'records' && (
        <div className="space-y-4">
          {!canViewAll && rewardBalances[0] && (
            <div className="cmms-classic-callout flex flex-wrap items-center gap-3 !p-3 text-sm">
              <span className="cmms-classic-heading">My reward points:</span>
              <span className="cmms-classic-chip !text-sm !normal-case">{rewardBalances[0].balance_points} balance</span>
              <span className="cmms-classic-muted">{rewardBalances[0].lifetime_earned_points} earned all-time{rewardBalances[0].pending_redemption_points > 0 ? ` · ${rewardBalances[0].pending_redemption_points} pending payout` : ''}</span>
            </div>
          )}

          {/* Collapsible date range + filters + export */}
          <section className="cmms-sec cmms-accent-navy" data-open={logFiltersOpen}>
            <button type="button" onClick={() => setLogFiltersOpen(o => !o)} aria-expanded={logFiltersOpen}
              className="flex w-full items-center gap-3 text-left !bg-transparent" style={{ background: 'transparent', border: 0, padding: 0, boxShadow: 'none' }}>
              <span className="cmms-medallion"><Calendar className="h-4 w-4" aria-hidden="true" /></span>
              <span className="min-w-0 flex-1">
                <span className="cmms-classic-heading cmms-sec-title block">Date range &amp; filters</span>
                <span className="block truncate text-xs cmms-classic-muted">
                  {startDate ? new Date(`${startDate}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'Start'} → {endDate ? new Date(`${endDate}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'Today'} · {statusFilter === 'all' ? 'All statuses' : statusFilter === 'active' ? 'Checked in' : 'Checked out'}
                </span>
              </span>
              <ChevronDown className={`h-4 w-4 flex-shrink-0 cmms-classic-muted transition-transform duration-300 ${logFiltersOpen ? 'rotate-180' : ''}`} />
            </button>
            {logFiltersOpen && (
              <div className="cmms-sec-body mt-4 space-y-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="text-xs font-semibold cmms-classic-muted">From
                    <input type="date" value={startDate} max={endDate || undefined} onChange={(e) => setStartDate(e.target.value)} className="mt-1 w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg" aria-label="Attendance start date" />
                  </label>
                  <label className="text-xs font-semibold cmms-classic-muted">To
                    <input type="date" value={endDate} min={startDate || undefined} max={today} onChange={(e) => setEndDate(e.target.value)} className="mt-1 w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg" aria-label="Attendance end date" />
                  </label>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => setDatePreset(1)} className="!h-auto !min-h-0 !px-3 !py-1.5 text-xs cmms-classic-btn-secondary">Today</button>
                  <button onClick={() => setDatePreset(7)} className="!h-auto !min-h-0 !px-3 !py-1.5 text-xs cmms-classic-btn-secondary">7 days</button>
                  <button onClick={() => setDatePreset(30)} className="!h-auto !min-h-0 !px-3 !py-1.5 text-xs cmms-classic-btn-secondary">30 days</button>
                </div>
                {canViewAll && (
                  <label className="block text-xs font-semibold cmms-classic-muted">Staff member
                    <select value={selectedStaffId} onChange={(e) => setSelectedStaffId(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm">
                      <option value="">All staff</option>
                      {staffOptions.map((staff) => <option key={staff.id} value={staff.id}>{staff.label}</option>)}
                    </select>
                  </label>
                )}
                <div className="flex flex-wrap gap-2" role="group" aria-label="Status filter">
                  {[['all', 'All statuses'], ['active', 'Checked in'], ['complete', 'Checked out']].map(([value, label]) => (
                    <button key={value} type="button" onClick={() => setStatusFilter(value)} aria-pressed={statusFilter === value}
                      className={`cmms-ptab cmms-accent-teal !px-3 !py-1 !text-xs ${statusFilter === value ? 'is-active' : ''}`}>{label}</button>
                  ))}
                </div>
                {canExport && (
                  <div className="flex flex-wrap gap-2 border-t border-[rgba(196,160,82,0.3)] pt-3">
                    <button onClick={exportAttendanceExcel} className="!h-auto !min-h-0 !px-3 !py-1.5 text-xs cmms-classic-btn-secondary flex items-center gap-1.5"><Download className="h-3.5 w-3.5" /> Excel</button>
                    <button onClick={exportAttendancePdf} className="!h-auto !min-h-0 !px-3 !py-1.5 text-xs cmms-classic-btn-primary flex items-center gap-1.5"><Download className="h-3.5 w-3.5" /> PDF</button>
                  </div>
                )}
              </div>
            )}
          </section>

          <label className="relative block">
            <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Search name, email, location, date (15 sep) or time" className="w-full rounded-lg border border-slate-700 bg-slate-800 py-2 pl-9 pr-3 text-sm" />
          </label>

          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="cmms-classic-muted">{visibleAttendanceRecords.length} record{visibleAttendanceRecords.length === 1 ? '' : 's'}{searchQuery ? ' match' : ''}</span>
            <span className="cmms-classic-chip !normal-case" style={{ color: '#047857' }}>Payroll ready: {payrollReadyCount}</span>
            {payrollFollowUpCount > 0 && <span className="cmms-classic-chip !normal-case" style={{ color: '#b45309' }}>Still checked in: {payrollFollowUpCount}</span>}
          </div>

          {visibleAttendanceRecords.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <Users className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No attendance records match these filters</p>
            </div>
          ) : (
            <ul className="grid gap-2.5 lg:grid-cols-2">
              {visibleAttendanceRecords.map((record, i) => {
                const name = record.staff?.full_name || 'Unknown Staff';
                const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
                const inAt = new Date(record.check_in_time);
                const open = expandedRecordId === record.id;
                const hhmm = { hour: '2-digit', minute: '2-digit' };
                return (
                  <li key={record.id} className="cmms-staff-card" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
                    <button type="button" onClick={() => setExpandedRecordId(open ? null : record.id)} aria-expanded={open}
                      className="flex w-full items-center gap-3 text-left !bg-transparent" style={{ background: 'transparent', border: 0, padding: 0, boxShadow: 'none' }}>
                      <span className="cmms-monogram">{initials || '?'}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{name}</span>
                        <span className="block text-xs cmms-classic-muted">
                          {inAt.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} · In {inAt.toLocaleTimeString([], hhmm)}
                          {record.check_out_time ? ` → Out ${new Date(record.check_out_time).toLocaleTimeString([], hhmm)}` : ''}
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-1.5">
                          {record.check_out_time
                            ? <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: 'rgba(16,185,129,0.15)', color: '#047857' }}><CheckCircle className="h-3 w-3" />Out</span>
                            : <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: 'rgba(245,158,11,0.15)', color: '#b45309' }}><Clock className="h-3 w-3" />In now</span>}
                          <span className="cmms-classic-chip !normal-case">{formatDuration(record.check_in_time, record.check_out_time)}</span>
                        </span>
                      </span>
                      <ChevronDown className={`h-4 w-4 flex-shrink-0 cmms-classic-muted transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
                    </button>
                    {open && (
                      <dl className="cmms-field-list cmms-sec-body mt-3 border-t border-[rgba(196,160,82,0.3)] pt-2">
                        <div className="cmms-field-row"><dt>Email</dt><dd className="break-all">{record.staff?.email || '-'}</dd></div>
                        <div className="cmms-field-row"><dt>Check-in</dt><dd>{inAt.toLocaleString()}</dd></div>
                        <div className="cmms-field-row"><dt>Check-out</dt><dd>{record.check_out_time ? new Date(record.check_out_time).toLocaleString() : 'Not checked out'}</dd></div>
                        <div className="cmms-field-row"><dt>Location</dt><dd>{record.check_in_location || '-'}</dd></div>
                        <div className="cmms-field-row"><dt>Payroll</dt><dd>{record.check_out_time ? 'Ready for payroll review' : 'Employee must check out'}</dd></div>
                      </dl>
                    )}
                  </li>
                );
              })}
            </ul>
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
                className="mt-4 px-4 py-2 cmms-classic-btn-primary rounded-lg"
              >
                Generate Your First QR Code
              </button>
            </div>
          ) : (
            <ul className="grid gap-3 lg:grid-cols-2">
              {qrCodes.map((qr, i) => {
                const qrUrl = getPublicAppUrl(`/staff-attendance?token=${qr.token}`);
                const stamp = (value) => `${new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })} · ${new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
                return (
                  <li key={qr.id} className="cmms-staff-card !p-4" style={{ '--ac': qr.is_active ? '#1f7a5a' : '#64748b', animationDelay: `${Math.min(i, 8) * 40}ms` }}>
                    {/* Where it is + whether it works */}
                    <div className="flex items-start gap-2">
                      <h3 className="cmms-classic-heading min-w-0 flex-1 text-base leading-snug">{qr.location_name}</h3>
                      <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold"
                        style={qr.is_active ? { background: 'rgba(16,185,129,0.15)', color: '#047857' } : { background: 'rgba(100,116,139,0.18)', color: '#475569' }}>
                        {qr.is_active ? <CheckCircle className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                        {qr.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <span className="cmms-classic-chip !normal-case">Created {stamp(qr.created_at)}</span>
                      <span className="cmms-classic-chip !normal-case">{qr.last_used_at ? `Last used ${stamp(qr.last_used_at)}` : 'Never used'}</span>
                    </div>

                    {/* QR visual, sized to the screen */}
                    <div className="mt-3 flex justify-center">
                      <div className={`rounded-xl bg-white p-2.5 shadow-sm ${qr.is_active ? '' : 'opacity-50'}`}>
                        <QRCodeSVG value={qrUrl} size={176} level="H" includeMargin={true} style={{ width: 'min(176px, 55vw)', height: 'auto' }} />
                      </div>
                    </div>

                    {/* Main action full width, the rest in a tidy row */}
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <button
                        onClick={() => downloadQRCode(qr.token, qr.location_name)}
                        className="cmms-classic-btn-primary col-span-3 flex min-h-[2.75rem] items-center justify-center gap-2 px-3 py-2 text-sm"
                        title="Download QR Code"
                      >
                        <Download className="h-4 w-4" /> Download PDF
                      </button>
                      <button
                        onClick={() => {
                          Promise.resolve(navigator.clipboard?.writeText(qrUrl)).catch(() => {});
                          setCopiedQrId(qr.id);
                          setTimeout(() => setCopiedQrId(id => (id === qr.id ? null : id)), 2000);
                        }}
                        className="cmms-classic-btn-secondary flex min-h-[2.5rem] items-center justify-center gap-1.5 !px-2 !py-2 text-xs"
                        title="Copy URL"
                      >
                        {copiedQrId === qr.id ? <><CheckCircle className="h-3.5 w-3.5" /> Copied</> : <><Copy className="h-3.5 w-3.5" /> Copy URL</>}
                      </button>
                      <button
                        onClick={() => toggleQRCode(qr.id, qr.is_active)}
                        className="cmms-classic-btn-secondary flex min-h-[2.5rem] items-center justify-center gap-1.5 !px-2 !py-2 text-xs"
                        style={{ color: qr.is_active ? '#b45309' : '#047857' }}
                        title={qr.is_active ? 'Deactivate' : 'Activate'}
                      >
                        {qr.is_active ? <><XCircle className="h-3.5 w-3.5" /> Turn off</> : <><CheckCircle className="h-3.5 w-3.5" /> Turn on</>}
                      </button>
                      <button
                        onClick={() => deleteQRCode(qr)}
                        className="cmms-classic-btn-secondary flex min-h-[2.5rem] items-center justify-center gap-1.5 !px-2 !py-2 text-xs"
                        style={{ color: '#dc2626' }}
                        title="Delete QR code"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Delete
                      </button>
                    </div>

                    {/* Long technical strings stay folded away so they cannot overflow a small screen */}
                    <details className="mt-3 text-xs">
                      <summary className="cursor-pointer cmms-classic-muted">Link &amp; token</summary>
                      <div className="mt-2 space-y-1.5">
                        <p className="break-all font-mono cmms-classic-muted">Token: {qr.token}</p>
                        <p className="break-all font-mono">
                          <a href={qrUrl} target="_blank" rel="noopener noreferrer" className="text-indigo-500 underline">{qrUrl}</a>
                        </p>
                      </div>
                    </details>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* Rewards Tab — points for check-ins/early arrival, filed reports,
          messages, and completed tasks. Admins configure the point values
          and the ICAN-coins-per-point rate and settle redemptions here; a
          regular employee just sees their own balance and history (the
          backing RPCs already self-restrict a non-admin to their own row). */}
      {activeTab === 'rewards' && (
        <div className="space-y-6">
          {rewardsError && <div className="bg-red-500/20 border border-red-500/50 text-red-200 p-4 rounded-lg">{rewardsError}</div>}
          {rewardsNotice && <div className="bg-emerald-500/20 border border-emerald-500/50 text-emerald-200 p-4 rounded-lg">{rewardsNotice}</div>}
          {rewardsLoading && <p className="text-sm text-slate-400">Loading rewards…</p>}

          {isFullAdmin && rewardsForm && (
            <form onSubmit={saveRewards} className="grid gap-3 cmms-classic-card p-4 md:grid-cols-3">
              <h3 className="font-semibold text-white md:col-span-3">Rewards settings</h3>
              <label className="flex items-center gap-2 text-sm text-slate-200 md:col-span-3">
                <input type="checkbox" checked={Boolean(rewardsForm.enabled)} onChange={(e) => setRewardsForm((v) => ({ ...v, enabled: e.target.checked }))} />
                Enable staff reward points
              </label>
              <label className="text-sm text-slate-300">Points per check-in
                <input type="number" min="0" value={rewardsForm.points_per_checkin} onChange={(e) => setRewardsForm((v) => ({ ...v, points_per_checkin: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white" />
              </label>
              <label className="text-sm text-slate-300">Bonus points for early arrival
                <input type="number" min="0" value={rewardsForm.points_per_early_checkin} onChange={(e) => setRewardsForm((v) => ({ ...v, points_per_early_checkin: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white" />
              </label>
              <label className="text-sm text-slate-300">Minutes early to count as "early"
                <input type="number" min="0" value={rewardsForm.early_checkin_minutes} onChange={(e) => setRewardsForm((v) => ({ ...v, early_checkin_minutes: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white" />
              </label>
              <label className="text-sm text-slate-300">Points per report filed
                <input type="number" min="0" value={rewardsForm.points_per_report} onChange={(e) => setRewardsForm((v) => ({ ...v, points_per_report: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white" />
              </label>
              <label className="text-sm text-slate-300">Points per task completed
                <input type="number" min="0" value={rewardsForm.points_per_task_completed} onChange={(e) => setRewardsForm((v) => ({ ...v, points_per_task_completed: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white" />
              </label>
              <label className="text-sm text-slate-300">Points per message sent
                <input type="number" min="0" value={rewardsForm.points_per_message} onChange={(e) => setRewardsForm((v) => ({ ...v, points_per_message: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white" />
              </label>
              <label className="text-sm text-slate-300">Max messages counted per day
                <input type="number" min="0" value={rewardsForm.message_daily_cap} onChange={(e) => setRewardsForm((v) => ({ ...v, message_daily_cap: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white" />
              </label>
              <label className="text-sm text-slate-300">Points per positive visitor rating
                <input type="number" min="0" value={rewardsForm.points_per_positive_visitor_rating} onChange={(e) => setRewardsForm((v) => ({ ...v, points_per_positive_visitor_rating: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white" />
              </label>
              <label className="text-sm text-slate-300">Minimum star rating counted as "positive" (1-5)
                <input type="number" min="1" max="5" value={rewardsForm.visitor_rating_positive_threshold} onChange={(e) => setRewardsForm((v) => ({ ...v, visitor_rating_positive_threshold: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white" />
              </label>
              <label className="text-sm text-slate-300">IcanEra coins per point
                <input type="number" min="0" step="0.00000001" value={rewardsForm.ican_coins_per_point} onChange={(e) => setRewardsForm((v) => ({ ...v, ican_coins_per_point: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white" />
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-200">
                <input type="checkbox" checked={Boolean(rewardsForm.auto_redeem_enabled)} onChange={(e) => setRewardsForm((v) => ({ ...v, auto_redeem_enabled: e.target.checked }))} />
                Auto-queue redemption once threshold is reached
              </label>
              <label className="text-sm text-slate-300">Auto-redeem threshold (points)
                <input type="number" min="1" value={rewardsForm.auto_redeem_threshold_points} onChange={(e) => setRewardsForm((v) => ({ ...v, auto_redeem_threshold_points: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white" />
              </label>
              <p className="text-xs text-slate-500 md:col-span-3">
                Crossing the threshold only queues a redemption for you to pay — moving real IcanEra coins always needs the business-wallet PIN, the same as every other payroll payment.
              </p>
              <button disabled={rewardsSaving} className="rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white disabled:opacity-50 md:col-span-3">
                {rewardsSaving ? 'Saving…' : 'Save rewards settings'}
              </button>
            </form>
          )}

          {isFullAdmin && (
            <section className="cmms-classic-card p-4">
              <h3 className="mb-3 font-semibold text-white">Pending redemptions</h3>
              {pendingRedemptions.length === 0 ? (
                <p className="text-sm text-slate-400">Nothing queued for payout right now.</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-slate-700">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-800">
                      <tr>
                        <th className="px-4 py-2 text-left text-slate-300">Staff</th>
                        <th className="px-4 py-2 text-center text-slate-300">Points</th>
                        <th className="px-4 py-2 text-center text-slate-300">Amount</th>
                        <th className="px-4 py-2 text-center text-slate-300">Queued</th>
                        <th className="px-4 py-2 text-right text-slate-300"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {pendingRedemptions.map((row) => (
                        <tr key={row.id} className="hover:bg-slate-800/60">
                          <td className="px-4 py-2 font-semibold">{row.user_name}</td>
                          <td className="px-4 py-2 text-center">{row.points_redeemed}</td>
                          <td className="px-4 py-2 text-center text-emerald-300 font-semibold">{Number(row.ican_amount).toLocaleString(undefined, { maximumFractionDigits: 4 })} ICAN</td>
                          <td className="px-4 py-2 text-center text-xs text-slate-400 capitalize">{row.triggered_by}</td>
                          <td className="px-4 py-2 text-right">
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => setRedeemPrompt({ redemptionId: row.id, staffName: row.user_name, employeeUserId: row.employee_user_id, icanAmount: row.ican_amount, method: 'cash', pin: '', busy: false, error: '' })}
                                className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                              >
                                Pay now
                              </button>
                              <button
                                type="button"
                                onClick={() => handleCancelRedemption(row.id)}
                                className="rounded-lg border border-slate-600 px-3 py-1 text-xs font-medium text-slate-200 hover:bg-slate-800"
                              >
                                Cancel
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          <section className="cmms-classic-card p-4">
            <h3 className="mb-3 font-semibold text-white">{isFullAdmin ? 'Staff point balances' : 'Your points'}</h3>
            {rewardBalances.length === 0 ? (
              <p className="text-sm text-slate-400">No reward points earned yet.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-slate-700">
                <table className="w-full text-sm">
                  <thead className="bg-slate-800">
                    <tr>
                      <th className="px-4 py-2 text-left text-slate-300">Staff</th>
                      <th className="px-4 py-2 text-center text-slate-300">Balance</th>
                      <th className="px-4 py-2 text-center text-slate-300">Pending redemption</th>
                      <th className="px-4 py-2 text-center text-slate-300">Lifetime earned</th>
                      {isFullAdmin && <th className="px-4 py-2 text-right text-slate-300"></th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {rewardBalances.map((row) => (
                      <tr key={row.cmms_user_id} className="hover:bg-slate-800/60">
                        <td className="px-4 py-2 font-semibold">{row.user_name}</td>
                        <td className="px-4 py-2 text-center"><span className="cmms-classic-chip !text-sm !normal-case">{row.balance_points}</span></td>
                        <td className="px-4 py-2 text-center text-slate-400">{row.pending_redemption_points}</td>
                        <td className="px-4 py-2 text-center text-slate-400">{row.lifetime_earned_points}</td>
                        {isFullAdmin && (
                          <td className="px-4 py-2 text-right">
                            <button
                              type="button"
                              disabled={row.balance_points <= 0}
                              onClick={() => handleRedeemNow(row.cmms_user_id)}
                              className="rounded-lg border border-slate-600 px-3 py-1 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-40"
                            >
                              Redeem now
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {!isFullAdmin && (
            <section className="cmms-classic-card p-4">
              <h3 className="mb-3 font-semibold text-white">History</h3>
              {rewardHistory.length === 0 ? (
                <p className="text-sm text-slate-400">No points earned yet.</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-slate-700">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-800">
                      <tr>
                        <th className="px-4 py-2 text-left text-slate-300">When</th>
                        <th className="px-4 py-2 text-left text-slate-300">Reason</th>
                        <th className="px-4 py-2 text-center text-slate-300">Points</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {rewardHistory.map((row) => (
                        <tr key={row.id} className="hover:bg-slate-800/60">
                          <td className="px-4 py-2 text-slate-400">{new Date(row.created_at).toLocaleString()}</td>
                          <td className="px-4 py-2">{row.reason || row.source_type}</td>
                          <td className={`px-4 py-2 text-center font-semibold ${row.points > 0 ? 'text-emerald-300' : 'text-amber-300'}`}>{row.points > 0 ? `+${row.points}` : row.points}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {payPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
            <h3 className="text-lg font-semibold text-white">Confirm pay before check-out</h3>
            <p className="mt-1 text-sm text-slate-400">
              {payPrompt.staffName} — {payPrompt.status.pay_frequency === 'daily' ? "today's pay" : `pay for ${payPrompt.status.period_start} to ${payPrompt.status.period_end}`}: {' '}
              <span className="font-semibold text-emerald-300">{payPrompt.status.currency} {Number(payPrompt.status.amount || 0).toLocaleString()}</span>
            </p>

            {payPrompt.error && <p className="mt-3 rounded-lg border border-red-800/50 bg-red-900/20 p-2 text-sm text-red-300">{payPrompt.error}</p>}

            <div className="mt-4 space-y-3">
              <p className="text-sm font-medium text-slate-200">Has this been paid?</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPayPrompt((prev) => ({ ...prev, paid: true, error: '' }))}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium ${payPrompt.paid === true ? 'border-emerald-500 bg-emerald-600/20 text-emerald-200' : 'border-slate-700 text-slate-300 hover:bg-slate-800'}`}
                >
                  Yes, paid
                </button>
                <button
                  type="button"
                  onClick={() => setPayPrompt((prev) => ({ ...prev, paid: false, error: '' }))}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium ${payPrompt.paid === false ? 'border-amber-500 bg-amber-600/20 text-amber-200' : 'border-slate-700 text-slate-300 hover:bg-slate-800'}`}
                >
                  Not yet
                </button>
              </div>

              {payPrompt.paid === true && (
                <>
                  <p className="text-sm font-medium text-slate-200">Approve payment method</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setPayPrompt((prev) => ({ ...prev, method: 'cash' }))}
                      className={`rounded-lg border px-3 py-2 text-sm font-medium ${payPrompt.method === 'cash' ? 'border-sky-500 bg-sky-600/20 text-sky-200' : 'border-slate-700 text-slate-300 hover:bg-slate-800'}`}
                    >
                      Cash
                    </button>
                    <button
                      type="button"
                      onClick={() => setPayPrompt((prev) => ({ ...prev, method: 'ican' }))}
                      className={`rounded-lg border px-3 py-2 text-sm font-medium ${payPrompt.method === 'ican' ? 'border-sky-500 bg-sky-600/20 text-sky-200' : 'border-slate-700 text-slate-300 hover:bg-slate-800'}`}
                    >
                      IcanEra wallet
                    </button>
                  </div>
                  {payPrompt.method === 'ican' && (
                    <input
                      type="password"
                      required
                      value={payPrompt.pin}
                      onChange={(e) => setPayPrompt((prev) => ({ ...prev, pin: e.target.value }))}
                      placeholder="Business-wallet PIN"
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
                    />
                  )}
                </>
              )}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button type="button" disabled={payPrompt.busy} onClick={() => setPayPrompt(null)} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50">
                Cancel
              </button>
              <button type="button" disabled={payPrompt.busy} onClick={submitPayPrompt} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                {payPrompt.busy ? 'Saving…' : 'Confirm and check out'}
              </button>
            </div>
          </div>
        </div>
      )}

      {redeemPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
            <h3 className="text-lg font-semibold text-white">Pay reward redemption</h3>
            <p className="mt-1 text-sm text-slate-400">
              {redeemPrompt.staffName} — <span className="font-semibold text-emerald-300">{Number(redeemPrompt.icanAmount).toLocaleString(undefined, { maximumFractionDigits: 4 })} ICAN</span>
            </p>

            {redeemPrompt.error && <p className="mt-3 rounded-lg border border-red-800/50 bg-red-900/20 p-2 text-sm text-red-300">{redeemPrompt.error}</p>}

            <div className="mt-4 space-y-3">
              <p className="text-sm font-medium text-slate-200">Payment method</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setRedeemPrompt((prev) => ({ ...prev, method: 'cash', error: '' }))}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium ${redeemPrompt.method === 'cash' ? 'border-sky-500 bg-sky-600/20 text-sky-200' : 'border-slate-700 text-slate-300 hover:bg-slate-800'}`}
                >
                  Cash
                </button>
                <button
                  type="button"
                  onClick={() => setRedeemPrompt((prev) => ({ ...prev, method: 'ican', error: '' }))}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium ${redeemPrompt.method === 'ican' ? 'border-sky-500 bg-sky-600/20 text-sky-200' : 'border-slate-700 text-slate-300 hover:bg-slate-800'}`}
                >
                  IcanEra wallet
                </button>
              </div>
              {redeemPrompt.method === 'ican' && (
                <input
                  type="password"
                  required
                  value={redeemPrompt.pin}
                  onChange={(e) => setRedeemPrompt((prev) => ({ ...prev, pin: e.target.value }))}
                  placeholder="Business-wallet PIN"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
                />
              )}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button type="button" disabled={redeemPrompt.busy} onClick={() => setRedeemPrompt(null)} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50">
                Cancel
              </button>
              <button type="button" disabled={redeemPrompt.busy} onClick={submitRedeemPrompt} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                {redeemPrompt.busy ? 'Saving…' : 'Confirm payment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'welfare' && (
        <div className="space-y-4">
          {canSeeWelfareTab && (
            <div className="flex flex-wrap gap-2">
              {[['decide', 'Requests to decide'], ['mine', 'Request leave / HR help / items']].map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setWelfareView(id)}
                  className={`rounded-full px-4 py-1.5 text-sm font-semibold ${
                    welfareView === id ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-bgSecondary)] text-[var(--color-textSecondary)] hover:text-[var(--color-text)] border border-[var(--color-border)]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {canSeeWelfareTab && welfareView === 'decide' ? (
            <CMMSWelfareAdminPanel companyProfile={companyProfile} cmmsUsers={cmmsUsers} canManage={canManageWelfare} />
          ) : (
            <>
              <CMMSEmployeeWelfare companyProfile={companyProfile} />
              <CMMSItemCustodyPanel companyProfile={companyProfile} cmmsUsers={cmmsUsers} embedded />
            </>
          )}
        </div>
      )}

      {activeTab === 'items' && canSeeItemsTab && (
        <CMMSItemCustodyPanel companyProfile={companyProfile} cmmsUsers={cmmsUsers} />
      )}
    </div>
  );
};

export default CMSSAttendancePanel;

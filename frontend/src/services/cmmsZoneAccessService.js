import { supabase } from '../lib/supabase/client';

// Restricted-zone access for CMMS > Transport. Every call is a database function
// (supabase/migrations/20261110100000_restricted_zone_access.sql): the tables are closed to the
// API, and the database decides who may do what from the caller's CMMS role, so a hidden button
// is never the only protection. Each call resolves to { data, error } -- data is the function's
// JSON, error a sentence for the screen.

export const ZONE_SQL_FILE = 'RESTRICTED_ZONE_ACCESS_PASTE_INTO_SUPABASE.sql';

const notInstalled = (message = '', code = '') =>
  code === 'PGRST202' || code === '42883' || /could not find the function|schema cache|does not exist/i.test(message);

async function call(fn, args) {
  try {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) {
      return {
        data: null,
        error: notInstalled(error.message, error.code)
          ? `Restricted zones are not installed yet. Run ${ZONE_SQL_FILE} in the Supabase SQL editor, then reload.`
          : error.message || 'Something went wrong',
      };
    }
    if (data && typeof data === 'object' && data.success === false) return { data, error: data.error || 'Something went wrong' };
    return { data, error: null };
  } catch (err) {
    return { data: null, error: err?.message || 'Something went wrong' };
  }
}

export const cmmsZoneAccessService = {
  list: (businessProfileId) => call('mbg_zone_list', { p_business_profile_id: businessProfileId }),

  saveZone: (businessProfileId, zone) =>
    call('mbg_zone_upsert', {
      p_business_profile_id: businessProfileId,
      p_zone_id: zone.id || null,
      p_name: zone.name,
      p_kind: zone.kind,
      p_location: zone.location || null,
      p_status: zone.status,
      p_entry_mode: zone.entry_mode,
      p_fee_basis: zone.fee_basis,
      p_accept_cash: !!zone.accept_cash,
      p_require_valid_permit: !!zone.require_valid_permit,
      p_max_stay_minutes: zone.max_stay_minutes ? Number(zone.max_stay_minutes) : null,
      p_overstay_fee_per_hour: zone.overstay_fee_ugx_per_hour ? Number(zone.overstay_fee_ugx_per_hour) : 0,
      p_payment_window_minutes: zone.payment_window_minutes ? Number(zone.payment_window_minutes) : 10,
      p_timezone: zone.timezone || 'Africa/Kampala',
      p_fees: zone.entry_mode === 'paid_entry' ? zone.fees : {},
      // where the zone is on the map: what lets customers be warned about the fee when they book a trip to or from it
      p_latitude: zone.latitude === '' || zone.latitude == null ? null : Number(zone.latitude),
      p_longitude: zone.longitude === '' || zone.longitude == null ? null : Number(zone.longitude),
      p_radius_m: zone.latitude === '' || zone.latitude == null ? null : Number(zone.radius_m || 200),
    }),

  members: (zoneId) => call('mbg_zone_members', { p_zone_id: zoneId }),

  searchRiders: (businessProfileId, zoneId, query) =>
    call('mbg_zone_search_riders', { p_business_profile_id: businessProfileId, p_zone_id: zoneId, p_query: query }),

  addMember: (zoneId, riderId, { kind = 'staff', validUntil = null, dailyStart = null, dailyEnd = null, note = '' } = {}) =>
    call('mbg_zone_member_add', {
      p_zone_id: zoneId,
      p_rider_id: riderId,
      p_kind: kind,
      p_valid_until: validUntil ? new Date(`${validUntil}T23:59:59`).toISOString() : null,
      p_daily_start: dailyStart || null,
      p_daily_end: dailyEnd || null,
      p_note: note || null,
    }),

  setMemberStatus: (memberId, status) => call('mbg_zone_member_set_status', { p_member_id: memberId, p_status: status }),

  // direction: 'in' | 'out' | 'auto' (auto checks a vehicle that is inside OUT, any other IN)
  scan: (zoneId, code, direction = 'auto', gate = '', plateSeen = '') =>
    call('mbg_zone_gate_scan', {
      p_zone_id: zoneId,
      p_code: code,
      p_direction: direction,
      p_gate: gate || null,
      p_plate_seen: plateSeen || null,
    }),

  collectCash: (visitId) => call('mbg_zone_gate_collect_cash', { p_visit_id: visitId }),
  cancelRequest: (visitId) => call('mbg_zone_gate_cancel', { p_visit_id: visitId }),
  visitStatus: (visitId) => call('mbg_zone_visit_status', { p_visit_id: visitId }),
  visits: (zoneId, scope = 'inside', limit = 100) => call('mbg_zone_visits', { p_zone_id: zoneId, p_scope: scope, p_limit: limit }),
  report: (zoneId, days = 30) => call('mbg_zone_report', { p_zone_id: zoneId, p_days: days }),
  settleOwed: (businessProfileId) => call('mbg_zone_settle_owed', { p_business_profile_id: businessProfileId }),
};

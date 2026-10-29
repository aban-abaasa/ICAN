/**
 * Pure helpers for booking a service right on a business's website (the Market tab): dates, the one-line summary,
 * the "add to calendar" link and the required-answer check. The bookings themselves, their time slots, tickets, rooms
 * and the business's own intake form all come from the shared booking system (digital-city-era's service bookings:
 * fn_get_available_slots, fn_create_service_booking, service_booking_forms). See services/siteBookingService.js.
 */

// ---- dates (always the visitor's LOCAL calendar day: toISOString() would give yesterday after midnight in East Africa) ----

const pad = (n) => String(n).padStart(2, '0');

export const localISODate = (date = new Date()) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** `count` consecutive days starting today, as Date objects. */
export const nextDays = (count, from = new Date()) => Array.from({ length: count }, (_, i) => {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  d.setDate(d.getDate() + i);
  return d;
});

export const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return localISODate(d);
};

export const nightsBetween = (checkin, checkout) => Math.round((new Date(`${checkout}T00:00:00`) - new Date(`${checkin}T00:00:00`)) / 86400000);

/** '13:30:00' -> '1:30 PM' */
export const formatSlotTime = (time) => {
  if (!time) return '';
  const [h, m] = String(time).split(':');
  const hour = parseInt(h, 10);
  if (Number.isNaN(hour)) return '';
  return `${((hour + 11) % 12) + 1}:${m || '00'} ${hour >= 12 ? 'PM' : 'AM'}`;
};

export const formatShortDate = (iso) => (iso
  ? new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
  : '');

// ---- what the visitor has picked ----

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The visitor's pick in one line: shown above the button. `selected` comes from the pickers. */
export const bookingSummary = (bookingType, selected) => {
  if (!selected) return '';
  if (bookingType === 'room') return `${formatShortDate(selected.checkin)} → ${formatShortDate(selected.checkout)} · ${plural(selected.quantity, 'room')}`;
  if (bookingType === 'ticket') return `${formatShortDate(selected.date)} · ${plural(selected.quantity, 'ticket')}`;
  return `${formatShortDate(selected.date)} at ${formatSlotTime(selected.slotStart)}`;
};

export const confirmLabel = (bookingType, selected) => {
  if (!selected) return bookingType === 'room' ? 'Pick your dates' : bookingType === 'ticket' ? 'Pick a date' : 'Pick a time';
  if (bookingType === 'room') return `Request ${plural(selected.quantity, 'room')}`;
  if (bookingType === 'ticket') return `Request ${plural(selected.quantity, 'ticket')}`;
  return `Request ${formatSlotTime(selected.slotStart)}`;
};

/** Google Calendar "add event" link for the request: no API needed. */
export const calendarLink = (title, booking, bookingType) => {
  const ymd = (iso) => String(iso).replace(/-/g, '');
  let dates;
  if (bookingType === 'room' && booking.checkout_date) {
    dates = `${ymd(booking.booking_date)}/${ymd(booking.checkout_date)}`;
  } else if (bookingType === 'ticket' || !booking.slot_start) {
    dates = `${ymd(booking.booking_date)}/${ymd(addDays(booking.booking_date, 1))}`;
  } else {
    const start = new Date(`${booking.booking_date}T${String(booking.slot_start).slice(0, 5)}:00`);
    const end = new Date(start.getTime() + 30 * 60000);
    const stamp = (d) => `${ymd(localISODate(d))}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
    dates = `${stamp(start)}/${stamp(end)}`;
  }
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${dates}`;
};

// ---- the business's own intake form ----

/**
 * The first required question that has no answer yet, or undefined. The database re-checks this (the RPC is the trust
 * boundary); this is just for a friendly message before sending. A file answer is its uploaded URL, so a file still
 * uploading counts as missing; a multiselect needs at least one option; a checkbox must be ticked.
 */
export const findMissingRequiredField = (fields, values) => (fields || []).find((f) => {
  if (!f.is_required) return false;
  const v = values?.[f.field_key];
  if (f.field_type === 'checkbox') return v !== true && v !== 'true';
  if (f.field_type === 'multiselect') return !Array.isArray(v) || v.length === 0;
  return v === undefined || v === null || String(v).trim() === '';
});

/** Answers worth sending: drops blanks, so an untouched optional question is not stored. */
export const cleanFormResponses = (fields, values) => {
  const out = {};
  (fields || []).forEach((f) => {
    const v = values?.[f.field_key];
    if (Array.isArray(v)) { if (v.length) out[f.field_key] = v; return; }
    if (v === true || v === 'true') { out[f.field_key] = true; return; }
    if (v !== undefined && v !== null && v !== false && String(v).trim() !== '') out[f.field_key] = typeof v === 'string' ? v.trim() : v;
  });
  return out;
};

// Server refusals that mean what is on screen is stale: reload the slots and drop the pick.
export const STALE_PICK_CODES = ['slot_unavailable', 'slot_passed', 'closed_day', 'date_in_past'];

/** What a service offers on the website, from the booking fields of the site-products RPC. */
export const bookingTypeOf = (item) => (['slot', 'ticket', 'room'].includes(item?.booking_type) ? item.booking_type : 'slot');
export const isBookable = (item) => item?.is_bookable === true;

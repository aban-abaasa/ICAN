import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, bookingSummary, bookingTypeOf, calendarLink, cleanFormResponses, confirmLabel, findMissingRequiredField, formatSlotTime,
  isBookable, localISODate, nextDays, nightsBetween,
} from '../src/utils/siteBooking.js';

// Booking a service from a business website uses the shared booking system. These tests guard the page's own logic: dates
// (the visitor's local day, never UTC), what is shown and sent, and the business's required questions.

describe('dates are the visitor\'s local calendar day', () => {
  test('a time just after local midnight is still today (toISOString() would say yesterday in East Africa)', () => {
    const justAfterMidnight = new Date(2026, 9, 21, 0, 30); // 21 Oct 2026, 00:30 local
    assert.equal(localISODate(justAfterMidnight), '2026-10-21');
  });
  test('nextDays starts today and counts forward across month ends', () => {
    const days = nextDays(4, new Date(2026, 9, 30, 15, 0)).map(localISODate);
    assert.deepEqual(days, ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  });
  test('addDays and nightsBetween agree, including across a month', () => {
    assert.equal(addDays('2026-10-31', 1), '2026-11-01');
    assert.equal(addDays('2026-03-01', -1), '2026-02-28');
    assert.equal(nightsBetween('2026-10-30', '2026-11-02'), 3);
    assert.equal(nightsBetween('2026-10-30', '2026-10-30'), 0);
  });
  test('times read as a clock', () => {
    assert.equal(formatSlotTime('00:00:00'), '12:00 AM');
    assert.equal(formatSlotTime('09:05:00'), '9:05 AM');
    assert.equal(formatSlotTime('12:30:00'), '12:30 PM');
    assert.equal(formatSlotTime('17:45:00'), '5:45 PM');
    assert.equal(formatSlotTime(''), '');
    assert.equal(formatSlotTime('nonsense'), '');
  });
});

describe('what the visitor picked', () => {
  test('summary and button wording follow the booking type', () => {
    assert.match(bookingSummary('slot', { date: '2026-10-21', slotStart: '14:30:00' }), /2:30 PM/);
    assert.match(bookingSummary('ticket', { date: '2026-10-21', quantity: 1 }), /1 ticket$/);
    assert.match(bookingSummary('ticket', { date: '2026-10-21', quantity: 3 }), /3 tickets$/);
    assert.match(bookingSummary('room', { checkin: '2026-10-21', checkout: '2026-10-23', quantity: 2 }), /2 rooms$/);
    assert.equal(bookingSummary('slot', null), '');
    assert.equal(confirmLabel('slot', null), 'Pick a time');
    assert.equal(confirmLabel('ticket', null), 'Pick a date');
    assert.equal(confirmLabel('room', null), 'Pick your dates');
    assert.equal(confirmLabel('slot', { slotStart: '09:00:00' }), 'Request 9:00 AM');
    assert.equal(confirmLabel('room', { quantity: 1 }), 'Request 1 room');
  });

  test('the calendar link covers a stay, a ticket day and a timed slot', () => {
    const room = calendarLink('Stay', { booking_date: '2026-10-21', checkout_date: '2026-10-23' }, 'room');
    assert.match(room, /dates=20261021\/20261023$/);
    const ticket = calendarLink('Concert', { booking_date: '2026-10-31' }, 'ticket');
    assert.match(ticket, /dates=20261031\/20261101$/);
    const slot = calendarLink('Haircut & Style', { booking_date: '2026-10-21', slot_start: '14:30:00' }, 'slot');
    assert.match(slot, /dates=20261021T143000\/20261021T150000$/);
    assert.match(slot, /text=Haircut%20%26%20Style/);
  });
});

describe('the business\'s own questions', () => {
  const fields = [
    { field_key: 'stylist', field_type: 'select', label: 'Stylist', is_required: true },
    { field_key: 'consent', field_type: 'checkbox', label: 'I agree', is_required: true },
    { field_key: 'extras', field_type: 'multiselect', label: 'Extras', is_required: true },
    { field_key: 'photo', field_type: 'file', label: 'Photo', is_required: false },
    { field_key: 'note', field_type: 'text', label: 'Note', is_required: false },
  ];

  test('the first unanswered required question is reported, in order', () => {
    assert.equal(findMissingRequiredField(fields, {}).field_key, 'stylist');
    assert.equal(findMissingRequiredField(fields, { stylist: 'Amina' }).field_key, 'consent');
    assert.equal(findMissingRequiredField(fields, { stylist: 'Amina', consent: false }).field_key, 'consent');
    assert.equal(findMissingRequiredField(fields, { stylist: 'Amina', consent: true, extras: [] }).field_key, 'extras');
    assert.equal(findMissingRequiredField(fields, { stylist: '   ', consent: true, extras: ['Wash'] }).field_key, 'stylist');
  });

  test('optional questions never block, and a complete form passes', () => {
    assert.equal(findMissingRequiredField(fields, { stylist: 'Amina', consent: true, extras: ['Wash'] }), undefined);
    assert.equal(findMissingRequiredField([], {}), undefined);
    assert.equal(findMissingRequiredField(undefined, undefined), undefined);
  });

  test('only real answers are sent', () => {
    const sent = cleanFormResponses(fields, { stylist: ' Amina ', consent: true, extras: [], photo: '', note: '   ', unknown: 'ignored' });
    assert.deepEqual(sent, { stylist: 'Amina', consent: true });
    assert.deepEqual(cleanFormResponses(fields, { extras: ['Wash', 'Braids'] }), { extras: ['Wash', 'Braids'] });
    assert.deepEqual(cleanFormResponses(fields, { consent: false }), {});
  });
});

describe('what a service offers', () => {
  test('only an explicitly bookable item shows the booking form', () => {
    assert.equal(isBookable({ is_bookable: true }), true);
    assert.equal(isBookable({ is_bookable: false }), false);
    assert.equal(isBookable({}), false);
    assert.equal(isBookable({ is_bookable: 'true' }), false);
    assert.equal(isBookable(null), false);
  });
  test('an unknown booking type is treated as a timed slot', () => {
    assert.equal(bookingTypeOf({ booking_type: 'room' }), 'room');
    assert.equal(bookingTypeOf({ booking_type: 'ticket' }), 'ticket');
    assert.equal(bookingTypeOf({ booking_type: 'banquet' }), 'slot');
    assert.equal(bookingTypeOf({}), 'slot');
  });
});

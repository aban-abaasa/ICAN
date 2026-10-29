import React, { useEffect, useRef, useState } from 'react';
import { CalendarPlus, CheckCircle2, Clock, Loader, MessageCircle, Phone, X } from 'lucide-react';
import { RoomPicker, SlotPicker, TicketPicker } from './SiteBookingPickers';
import SiteBookingFields from './SiteBookingFields';
import { createBooking, getBookingFormFields, newIdempotencyKey } from '../../services/siteBookingService';
import {
  STALE_PICK_CODES, bookingSummary, bookingTypeOf, calendarLink, cleanFormResponses, confirmLabel, findMissingRequiredField,
} from '../../utils/siteBooking';

/**
 * Booking a service right where it is listed: the service card opens into this panel (no pop-up, no leaving the page).
 * The visitor picks a time (or date, or dates), answers whatever questions the business asked for this service, and sends the
 * request; the business confirms it by chat. "Ask us" stays an option for anyone who would rather talk first.
 *
 *   service      - a store product from get_cmms_site_products (product_id, name, booking_type, ...)
 *   user         - the signed-in visitor, or null. Seeing times and questions needs no account; sending the request does.
 *   onNeedAuth   - open the page's sign-in (the panel keeps everything typed so far)
 *   onAskUs      - optional: open the Ask us chat about this service
 */
export default function SiteBookingPanel({ service, businessName, user, phone = '', onNeedAuth, onAskUs, onClose }) {
  const bookingType = bookingTypeOf(service);
  const productId = service.product_id;
  const meta = user?.user_metadata || {};
  const [selected, setSelected] = useState(null);
  const [name, setName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [fields, setFields] = useState([]);
  const [answers, setAnswers] = useState({});
  const [refreshKey, setRefreshKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  // one key per attempt: tapping twice, or a network retry, returns the same booking instead of a second one
  const idempotencyKey = useRef(newIdempotencyKey());
  const rootRef = useRef(null);

  useEffect(() => { getBookingFormFields(productId).then(setFields).catch(() => setFields([])); }, [productId]);

  // Fill in what we already know about the signed-in visitor, without overwriting anything they typed.
  useEffect(() => {
    if (!user) return;
    setName((n) => n || meta.full_name || meta.name || '');
    setContactPhone((p) => p || user.phone || meta.phone || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // bring the opened panel into view
  useEffect(() => { rootRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' }); }, []);

  // typing or answering clears the message about what was missing
  const edit = (setter) => (value) => { setError(''); setter(value); };

  const submit = async () => {
    setError('');
    if (!selected) { setError(bookingType === 'room' ? 'Pick your dates first.' : 'Pick a date and time first.'); return; }
    if (!name.trim()) { setError('Enter your name.'); return; }
    const missing = findMissingRequiredField(fields, answers);
    if (missing) { setError(`"${missing.label}" is required.`); return; }
    if (!user) { onNeedAuth?.(); return; }
    setSubmitting(true);
    try {
      const data = await createBooking({
        productId,
        bookingDate: bookingType === 'room' ? selected.checkin : selected.date,
        slotStart: bookingType === 'slot' ? selected.slotStart : undefined,
        checkoutDate: bookingType === 'room' ? selected.checkout : undefined,
        quantity: bookingType === 'slot' ? 1 : selected.quantity,
        customerName: name.trim(),
        customerPhone: contactPhone.trim(),
        customerEmail: user.email,
        notes: notes.trim(),
        formResponses: cleanFormResponses(fields, answers),
        idempotencyKey: idempotencyKey.current,
      });
      setResult(data);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setError(err.message || 'Could not send your request. Availability may have just changed.');
      if (STALE_PICK_CODES.includes(err.code)) setSelected(null); // what was on screen is stale: pick again
      setRefreshKey((k) => k + 1);
    } finally {
      setSubmitting(false);
    }
  };

  const bookAnother = () => { setResult(null); setSelected(null); setAnswers({}); setNotes(''); idempotencyKey.current = newIdempotencyKey(); };
  const picker = { productId, refreshKey, onSelect: setSelected, selected };
  const callHref = phone ? `tel:${String(phone).replace(/[^\d+]/g, '')}` : null;

  return (
    <div ref={rootRef} className="p-4 sm:p-5 min-w-0" onClick={(e) => e.stopPropagation()} role="region" aria-label={`Book ${service.name}`}>
      <div className="flex items-start gap-3 mb-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-extrabold nb-text leading-tight">Book {service.name}</h3>
          <p className="text-xs nb-text-muted mt-0.5">Pick a time and send your request{businessName ? `. ${businessName} confirms it by chat.` : '. The business confirms it by chat.'}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close the booking form" className="nb-share-btn p-2 rounded-full flex-shrink-0"><X className="w-4 h-4" /></button>
      </div>

      {result?.success ? (
        <div className="space-y-3">
          <div className="rounded-xl nb-option-selected border p-3.5 text-sm">
            <div className="flex flex-wrap items-center gap-2 mb-1.5">
              <CheckCircle2 className="w-4 h-4" />
              <span className="font-bold">Request sent</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-900"><Clock className="w-2.5 h-2.5" />Pending approval</span>
            </div>
            <p>{bookingSummary(bookingType, selected) || 'Your request is with the business'}. The business has been notified and will confirm shortly. You can message them from your account.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={calendarLink(`${service.name}${businessName ? ` - ${businessName}` : ''}`, result.booking, bookingType)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-3 min-h-[40px] rounded-xl nb-btn-secondary text-sm font-semibold"><CalendarPlus className="w-4 h-4" />Add to my calendar</a>
            {onAskUs && <button type="button" onClick={() => onAskUs(`I just requested "${service.name}". Is there anything I should prepare?`)} className="inline-flex items-center gap-1.5 px-3 min-h-[40px] rounded-xl nb-btn-secondary text-sm font-semibold"><MessageCircle className="w-4 h-4" />Ask us</button>}
            {callHref && <a href={callHref} className="inline-flex items-center gap-1.5 px-3 min-h-[40px] rounded-xl nb-btn-secondary text-sm font-semibold"><Phone className="w-4 h-4" />Call</a>}
            <button type="button" onClick={bookAnother} className="px-3 min-h-[40px] rounded-xl text-sm font-semibold nb-link">Book another time</button>
            <button type="button" onClick={onClose} className="px-3 min-h-[40px] rounded-xl nb-btn-primary text-sm font-bold">Done</button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wide nb-text-faint mb-2">1. When</p>
            {bookingType === 'room' ? <RoomPicker {...picker} /> : bookingType === 'ticket' ? <TicketPicker {...picker} /> : <SlotPicker {...picker} />}
          </div>

          <div className="space-y-2.5 min-w-0">
            <p className="text-xs font-bold uppercase tracking-wide nb-text-faint">2. Your details</p>
            <input value={name} onChange={(e) => edit(setName)(e.target.value)} placeholder="Your name" autoComplete="name" aria-label="Your name" className="w-full rounded-lg nb-input px-3 py-2 text-sm" />
            <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="Phone (optional)" type="tel" autoComplete="tel" aria-label="Phone" className="w-full rounded-lg nb-input px-3 py-2 text-sm" />
            <SiteBookingFields fields={fields} values={answers} onChange={edit(setAnswers)} productId={productId} canUpload={Boolean(user)} onNeedSignIn={onNeedAuth} />
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything the business should know? (optional)" aria-label="Notes" rows={2} className="w-full rounded-lg nb-input px-3 py-2 text-sm resize-none" />

            {selected && <p className="rounded-lg nb-surface-alt border nb-border px-3 py-2 text-sm font-semibold nb-text">{bookingSummary(bookingType, selected)}</p>}
            {error && <p role="alert" className="rounded-lg bg-rose-500/10 border border-rose-400/40 px-3 py-2 text-sm text-rose-500">{error}</p>}

            <button type="button" onClick={submit} disabled={submitting} className="w-full min-h-[48px] rounded-xl nb-btn-primary text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50">
              {submitting && <Loader className="w-4 h-4 animate-spin" />}
              {submitting ? 'Sending…' : !user && selected ? 'Sign in to send your request' : confirmLabel(bookingType, selected)}
            </button>
            {!user && <p className="text-[11px] nb-text-faint text-center">Browsing times is free. A free IcanEra account lets the business confirm with you and keeps your request in one place.</p>}
            {onAskUs && (
              <button type="button" onClick={() => onAskUs(`I'd like to book "${service.name}" but have a question first.`)} className="w-full text-center text-xs font-semibold nb-link inline-flex items-center justify-center gap-1.5 py-1">
                <MessageCircle className="w-3.5 h-3.5" /> Rather talk first? Ask us
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

import { supabase } from '../lib/supabase/client';
import { compressImageFile } from '../utils/imageCompression';

/**
 * Booking a service from a business's website (Market tab). This talks to the shared service-booking system that
 * digital-city-era built on the same database: bookable products (products.is_bookable, booking_type 'slot' | 'ticket' |
 * 'room'), live availability (fn_get_available_slots), the business's own intake questions (service_booking_forms) and the
 * booking itself (fn_create_service_booking), which also opens a booking chat thread with the business.
 *
 * Seeing the times and the questions needs no account (public reads). Sending the request does: the database function
 * refuses anyone who is not signed in, and file uploads are for signed-in users too.
 */

const ORIGIN_APP = 'ican';
const UPLOAD_BUCKET = 'booking-uploads';

// Server refusals carry a machine-readable `code` next to the friendly message, so the page can react to it.
const bookingError = (data, fallback) => {
  const err = new Error(data?.error || fallback);
  err.code = data?.code;
  return err;
};

/** Open times for one product on one day (YYYY-MM-DD): [{ slot_start, slot_end, spots_left }]. A full slot stays listed with 0 left. */
export const getAvailableSlots = async (productId, date) => {
  const { data, error } = await supabase.rpc('fn_get_available_slots', { p_product_id: productId, p_date: date });
  if (error) throw new Error(error.message || 'Could not load availability');
  return data || [];
};

/**
 * The questions the business asks when this service is booked, in display order; [] when it has no form (then only the
 * name, phone and notes are collected) or the forms tables are not installed.
 */
export const getBookingFormFields = async (productId) => {
  try {
    const { data: link, error } = await supabase.from('service_booking_form_services').select('form_id').eq('product_id', productId).maybeSingle();
    if (error || !link?.form_id) return [];
    const { data: fields, error: fieldsError } = await supabase.from('service_booking_form_fields').select('*').eq('form_id', link.form_id).order('sort_order');
    return fieldsError ? [] : fields || [];
  } catch {
    return [];
  }
};

/** A fresh random key per booking attempt: tapping twice, or an automatic retry, never creates a second booking. */
export const newIdempotencyKey = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/**
 * Send the booking request. Resolves { success, booking, conversationId }; rejects with an Error carrying the server's `code`.
 * The database may predate the idempotency parameter: then the same call is made without it.
 */
export const createBooking = async ({
  productId, bookingDate, slotStart, checkoutDate, quantity, customerName, customerPhone, customerEmail, notes, formResponses, idempotencyKey,
}) => {
  const args = {
    p_product_id: productId,
    p_booking_date: bookingDate,
    p_slot_start: slotStart || null,
    p_customer_name: customerName,
    p_customer_phone: customerPhone || null,
    p_customer_email: customerEmail || null,
    p_notes: notes || null,
    p_origin_app: ORIGIN_APP,
    p_quantity: quantity || 1,
    p_checkout_date: checkoutDate || null,
    p_form_responses: formResponses && Object.keys(formResponses).length ? formResponses : null,
  };
  let { data, error } = await supabase.rpc('fn_create_service_booking', { ...args, p_idempotency_key: idempotencyKey || null });
  if (error && (error.code === 'PGRST202' || /could not find the function/i.test(error.message || ''))) {
    ({ data, error } = await supabase.rpc('fn_create_service_booking', args));
  }
  if (error) throw new Error(error.message || 'Could not send your booking request');
  if (!data?.success) throw bookingError(data, 'Could not send your booking request');
  return data;
};

/** Upload a file a form question asked for (a photo or PDF); resolves its public URL, the answer to store. Signed-in only. */
export const uploadBookingAttachment = async (productId, file) => {
  const prepared = await compressImageFile(file, 1600, 0.8); // leaves PDFs and other non-images alone
  const ext = (prepared.name || file.name || '').split('.').pop() || 'bin';
  const path = `${productId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await supabase.storage.from(UPLOAD_BUCKET).upload(path, prepared, { upsert: false, cacheControl: '31536000' });
  if (error) throw new Error(error.message || 'Upload failed');
  return supabase.storage.from(UPLOAD_BUCKET).getPublicUrl(path).data.publicUrl;
};

export default { getAvailableSlots, getBookingFormFields, createBooking, uploadBookingAttachment, newIdempotencyKey };

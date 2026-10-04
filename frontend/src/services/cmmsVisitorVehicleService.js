// Vehicle visitors: approvals on check-in/out, the rotating approver pool and the
// vehicle photo that is deleted from Supabase Storage once the visit is over
// (backend/CMMS_VISITOR_VEHICLE_APPROVAL.sql). Same { data, error } shape as the
// visitor-rating calls in businessManagementService.js.
import { supabase } from '../lib/supabase/client';
import { compressImageFile } from '../utils/imageCompression';

export const VEHICLE_PHOTO_BUCKET = 'cmms-visitor-vehicle-photos';

const PHOTO_EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_PHOTO_MB = 8; // before compression; stored photos end up a few hundred KB

// Storage object names must be <folder>/<lowercase uuid>.<ext> — the bucket
// policy rejects anything else, so the name is always generated here.
const randomId = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

// folder: the company id when staff upload, or the visitor-QR token on the public page.
export const uploadVehiclePhoto = async (folder, file) => {
  if (!PHOTO_EXTENSIONS[file.type]) throw new Error('Please choose a JPG, PNG or WEBP photo.');
  if (file.size > MAX_PHOTO_MB * 1024 * 1024) throw new Error(`The photo must be under ${MAX_PHOTO_MB}MB.`);

  const photo = await compressImageFile(file, 1280, 0.7);
  const path = `${folder}/${randomId()}.${PHOTO_EXTENSIONS[photo.type] || 'jpg'}`;
  const { error } = await supabase.storage
    .from(VEHICLE_PHOTO_BUCKET)
    .upload(path, photo, { upsert: false, contentType: photo.type, cacheControl: '60' });
  if (error) {
    const message = error.message || '';
    if (/bucket not found/i.test(message)) {
      throw new Error('Vehicle photos have not been set up yet. Run backend/CMMS_VISITOR_VEHICLE_APPROVAL.sql in the Supabase SQL Editor, then retry.');
    }
    throw new Error(/exceeded|too large|size/i.test(message)
      ? 'That photo is too large. Please take a smaller one.'
      : (message || 'The photo could not be uploaded.'));
  }
  return path;
};

// The bucket is private: a photo is only ever shown through a short-lived signed URL.
export const getVehiclePhotoUrl = async (path) => {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(VEHICLE_PHOTO_BUCKET).createSignedUrl(path, 300);
  return error ? null : data?.signedUrl || null;
};

// Deletes the photos of visits that are over (checked out / entry declined) and
// of uploads that never got attached to a visit. Deleting goes through the
// Storage API; the database path is only cleared once the file is really gone,
// so anything interrupted is simply retried by the next call. Never throws —
// this is housekeeping and must not get in the way of the screen using it.
export const purgeVehiclePhotos = async (companyId) => {
  if (!companyId) return 0;
  try {
    const { data: rows, error } = await supabase.rpc('get_visitor_photos_to_purge', { p_cmms_company_id: companyId });
    if (error || !rows?.length) return 0;
    const paths = rows.map((row) => row.storage_path);
    const { error: removeError } = await supabase.storage.from(VEHICLE_PHOTO_BUCKET).remove(paths);
    if (removeError) return 0;
    await supabase.rpc('confirm_visitor_photos_purged', { p_paths: paths });
    return paths.length;
  } catch (err) {
    console.warn('Vehicle photo clean-up skipped:', err);
    return 0;
  }
};

export const getVisitorApprovers = async (companyId) => {
  if (!companyId) return { data: [], error: null };
  const { data, error } = await supabase.rpc('get_visitor_approvers', { p_cmms_company_id: companyId });
  return { data: data || [], error };
};

export const setVisitorApprover = async (companyId, cmmsUserId, isApprover) => {
  const { data, error } = await supabase.rpc('set_visitor_approver', {
    p_cmms_company_id: companyId,
    p_cmms_user_id: cmmsUserId,
    p_is_approver: isApprover
  });
  return { data, error };
};

// view: 'pending' (default) or 'decided' (recent history)
export const getVisitorVehicleApprovals = async (companyId, view = 'pending') => {
  if (!companyId) return { data: [], error: null };
  const { data, error } = await supabase.rpc('get_visitor_vehicle_approvals', { p_cmms_company_id: companyId, p_view: view });
  return { data: data || [], error };
};

export const decideVisitorVehicleApproval = async (approvalId, approve, note = null) => {
  const { data, error } = await supabase.rpc('decide_visitor_vehicle_approval', {
    p_approval_id: approvalId,
    p_approve: approve,
    p_note: note
  });
  return { data, error };
};

// What the visitor sees while they wait (public page, no login).
export const getVisitorVisitStatus = async (visitorId) => {
  const { data, error } = await supabase.rpc('get_visitor_visit_status', { p_visitor_id: visitorId });
  return { data, error };
};

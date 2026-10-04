// Vehicle visitors: approvals on check-in/out, the rotating approver pool and the
// vehicle photo that is deleted once the visit is over
// (backend/CMMS_VISITOR_VEHICLE_APPROVAL.sql). Same { data, error } shape as the
// visitor-rating calls in businessManagementService.js.
//
// The photo uses the app's existing R2 storage (r2StorageService.js and the
// /api/storage routes), so this adds no serverless function. The DB stores the
// plain R2 key; it is turned into an r2:// value only to resolve a viewing URL.
import { supabase } from '../lib/supabase/client';
import { getBackendUrl } from '../lib/backendUrl';
import { compressImageFile } from '../utils/imageCompression';
import { deleteFromR2, isR2Key, resolveMediaValue, toR2Value, uploadToR2 } from './r2StorageService';

const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_PHOTO_MB = 8; // before compression; stored photos end up a few hundred KB

const currentToken = async () => (await supabase.auth.getSession())?.data?.session?.access_token || null;

// Visitor on the public QR page: no account, so this goes through the existing anonymous,
// rate-limited image route (presign-upload-chat) with purpose 'visitor-vehicle'.
const uploadAsGuest = async (photo) => {
  const contentType = photo.type;
  const presignRes = await fetch(`${getBackendUrl()}/api/storage/presign-upload-chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: photo.name || 'vehicle.jpg', contentType, purpose: 'visitor-vehicle' })
  });
  const presign = await presignRes.json().catch(() => null);
  if (!presignRes.ok || !presign?.success) throw new Error(presign?.error || 'The photo could not be uploaded.');
  const putRes = await fetch(presign.uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: photo });
  if (!putRes.ok) throw new Error('The photo could not be uploaded. Please try again.');
  return presign.key;
};

// Returns the R2 key to store on the visit. guest: true for the public page.
export const uploadVehiclePhoto = async (file, { guest = false } = {}) => {
  if (!PHOTO_TYPES.includes(file.type)) throw new Error('Please choose a JPG, PNG or WEBP photo.');
  if (file.size > MAX_PHOTO_MB * 1024 * 1024) throw new Error(`The photo must be under ${MAX_PHOTO_MB}MB.`);

  const photo = await compressImageFile(file, 1280, 0.7);
  if (guest) return uploadAsGuest(photo);

  const result = await uploadToR2({ file: photo, folder: 'cmms-visitor-vehicles', accessToken: await currentToken() });
  if (!result.success) throw new Error(result.error || 'The photo could not be uploaded.');
  return result.key;
};

// Short-lived viewing URL for a stored photo, or null if it cannot be resolved.
export const getVehiclePhotoUrl = async (path) => {
  if (!path) return null;
  const resolved = await resolveMediaValue(toR2Value(path));
  return isR2Key(resolved) ? null : resolved;
};

// Deletes the photos of visits that are over (checked out / entry declined). The
// server only lets this through once the database says the visit is over, and the
// stored path is cleared only for files that were really deleted, so anything that
// fails is simply retried by the next call. Never throws — this is housekeeping and
// must not get in the way of the screen using it.
export const purgeVehiclePhotos = async (companyId) => {
  if (!companyId) return 0;
  try {
    const { data: rows, error } = await supabase.rpc('get_visitor_photos_to_purge', { p_cmms_company_id: companyId });
    if (error || !rows?.length) return 0;
    const accessToken = await currentToken();
    const deleted = [];
    for (const { storage_path: key } of rows) {
      const result = await deleteFromR2({ key, accessToken });
      if (result.success) deleted.push(key);
    }
    if (deleted.length) await supabase.rpc('confirm_visitor_photos_purged', { p_paths: deleted });
    return deleted.length;
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

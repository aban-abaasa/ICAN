import { supabase } from '../lib/supabase';

const BUCKET = 'chat-attachments';
const MAX_SIZE_MB = 8;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

// A public Storage bucket, uploaded to straight from the browser — unlike
// this app's other uploads (uploadToR2 in r2StorageService.js), which go
// through the backend's presigned R2 routes. Deliberately not R2 here: used
// by the support ChatWidget (chat_messages) and the Community board/live
// chat (landing_messages), both shared across ICAN, digital-city-era,
// mybodaguy and FARM-AGENT (see ADD_CHAT_IMAGE_ATTACHMENTS.sql) — an r2://
// key needs this app's own resolveMediaValue() to become viewable, which
// the other 3 apps don't have, so a plain public Storage URL is what lets
// every app render an attachment with a bare <img src>, no matter which app
// it was posted from.
export const uploadChatImage = async (file) => {
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error('Please choose a JPG, PNG, WEBP, or GIF image.');
  }
  if (file.size > MAX_SIZE_MB * 1024 * 1024) {
    throw new Error(`Image must be under ${MAX_SIZE_MB}MB.`);
  }

  const ext = file.name.split('.').pop() || 'jpg';
  const path = `ican/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { upsert: false, cacheControl: '3600', contentType: file.type });
  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, type: 'image', name: file.name };
};

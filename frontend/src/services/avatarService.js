/**
 * Avatar Upload Service for ICAN
 * Handles user avatar uploads to Supabase Storage
 * Adapted from FARM-AGENT with blockchain integration support
 */

import { supabase } from '../lib/supabase';

/**
 * Validate file before upload
 */
export const validateAvatarFile = (file, options = {}) => {
  const {
    maxSizeMB = 2,
    allowedTypes = ['image/jpeg', 'image/png', 'image/webp']
  } = options;

  // Check file size
  if (file.size > maxSizeMB * 1024 * 1024) {
    return { valid: false, error: `File size exceeds ${maxSizeMB}MB` };
  }

  // Check file type
  if (allowedTypes && !allowedTypes.includes(file.type)) {
    return { 
      valid: false, 
      error: `Invalid file type. Allowed: ${allowedTypes.map(t => t.split('/')[1]).join(', ')}`
    };
  }

  return { valid: true, error: null };
};

/**
 * Generate unique filename for avatar
 */
export const generateAvatarFilename = (userId) => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${userId}-${timestamp}-${random}.jpg`;
};

/**
 * Upload avatar to Supabase Storage
 * @param {string} userId - User ID
 * @param {File} file - Avatar image file
 * @returns {Promise<{url: string, error: Object|null}>}
 */
export const uploadAvatarToStorage = async (userId, file) => {
  try {
    // Validate file
    const validation = validateAvatarFile(file);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    // Generate filename
    const filename = generateAvatarFilename(userId);
    const filePath = `avatars/${filename}`;

    // Upload to Supabase Storage
    const { data, error: uploadError } = await supabase.storage
      .from('user-content')
      .upload(filePath, file, { upsert: true });

    if (uploadError) throw uploadError;

    // Get public URL
    const { data: publicData } = supabase.storage
      .from('user-content')
      .getPublicUrl(filePath);

    return { 
      url: publicData?.publicUrl, 
      path: filePath,
      error: null 
    };
  } catch (error) {
    console.error('Avatar upload error:', error);
    return { url: null, path: null, error };
  }
};

/**
 * Update user profile with avatar URL
 * @param {string} userId - User ID
 * @param {string} avatarUrl - Avatar public URL
 * @returns {Promise<{profile: Object, error: Object|null}>}
 */
export const updateProfileAvatar = async (userId, avatarUrl) => {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .update({ 
        avatar_url: avatarUrl,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId)
      .select()
      .single();

    if (error) throw error;

    return { profile: data, error: null };
  } catch (error) {
    console.error('Profile update error:', error);
    return { profile: null, error };
  }
};

/**
 * Complete avatar upload workflow
 * @param {string} userId - User ID
 * @param {File} file - Avatar file
 * @returns {Promise<{avatarUrl: string, error: Object|null}>}
 */
export const uploadAvatar = async (userId, file) => {
  try {
    // Upload to storage
    const { url, error: uploadError } = await uploadAvatarToStorage(userId, file);
    if (uploadError) throw uploadError;

    // Update profile with new avatar URL
    const { profile, error: updateError } = await updateProfileAvatar(userId, url);
    if (updateError) throw updateError;

    return { avatarUrl: url, profile, error: null };
  } catch (error) {
    console.error('Complete avatar upload error:', error);
    return { avatarUrl: null, profile: null, error };
  }
};

export default {
  uploadAvatar,
  uploadAvatarToStorage,
  updateProfileAvatar,
  validateAvatarFile,
  generateAvatarFilename
};

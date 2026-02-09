import { createClient } from '@supabase/supabase-js';
import { getSupabaseClient } from '../lib/supabase/client';

// Use the shared singleton client from client.js with lazy initialization
let supabaseInstance = null;

const initSupabase = () => {
  if (!supabaseInstance) {
    supabaseInstance = getSupabaseClient();
  }
  return supabaseInstance;
};

export const getSupabase = () => {
  return initSupabase();
};

/**
 * User Verification Service - Verify ICAN user accounts
 */

export const verifyICANUser = async (email) => {
  try {
    const sb = getSupabase();
    if (!sb) {
      console.log('Demo mode: cannot verify users');
      return { exists: true, user: { email } }; // Allow in demo
    }

    const emailLower = email.toLowerCase();

    // Priority 1: Check all_users table (consolidated)
    try {
      console.log('Verifying user in all_users:', email);
      const { data, error } = await sb
        .from('all_users')
        .select('user_id, id, email, full_name, source_table')
        .ilike('email', emailLower)
        .single();

      if (!error && data) {
        console.log('User verified in all_users:', data);
        return {
          exists: true,
          user: {
            id: data.user_id || data.id,
            email: data.email,
            name: data.full_name,
            source: data.source_table
          }
        };
      }
    } catch (err) {
      console.log('all_users table not available, checking source tables...');
    }

    // Fallback 1: Check ican_user_profiles
    try {
      console.log('Verifying user in ican_user_profiles:', email);
      const { data, error } = await sb
        .from('ican_user_profiles')
        .select('id, email, full_name')
        .ilike('email', emailLower)
        .single();

      if (!error && data) {
        console.log('User verified in ican_user_profiles:', data);
        return {
          exists: true,
          user: {
            id: data.id,
            email: data.email,
            name: data.full_name,
            source: 'ican_user_profiles'
          }
        };
      }
    } catch (err) {
      console.log('Not found in ican_user_profiles');
    }

    // Fallback 2: Check profiles table
    try {
      console.log('Verifying user in profiles:', email);
      const { data, error } = await sb
        .from('profiles')
        .select('id, email, full_name')
        .ilike('email', emailLower)
        .single();

      if (!error && data) {
        console.log('User verified in profiles:', data);
        return {
          exists: true,
          user: {
            id: data.id,
            email: data.email,
            name: data.full_name,
            source: 'profiles'
          }
        };
      }
    } catch (err) {
      console.log('Not found in profiles');
    }

    // Fallback 3: Check business_co_owners
    try {
      console.log('Verifying user in business_co_owners:', email);
      const { data, error } = await sb
        .from('business_co_owners')
        .select('id, owner_email, owner_name')
        .ilike('owner_email', emailLower)
        .single();

      if (!error && data) {
        console.log('User verified in business_co_owners:', data);
        return {
          exists: true,
          user: {
            id: data.id,
            email: data.owner_email,
            name: data.owner_name,
            source: 'business_co_owners'
          }
        };
      }
    } catch (err) {
      console.log('Not found in business_co_owners');
    }

    // No user found in any table
    console.log('User not found in any source table:', email);
    return {
      exists: false,
      error: `No ICAN account found for ${email}. They must sign up first.`
    };
  } catch (error) {
    console.error('Error verifying user:', error);
    return {
      exists: false,
      error: 'Error verifying user account'
    };
  }
};

export const searchICANUsers = async (searchTerm) => {
  try {
    const sb = getSupabase();
    if (!sb) {
      console.log('Demo mode: using demo users');
      return [
        { id: '1', email: 'user1@ican.com', name: 'User One' },
        { id: '2', email: 'user2@ican.com', name: 'User Two' }
      ];
    }

    // Priority 1: Search all_users table (consolidated view)
    try {
      console.log('Searching all_users for:', searchTerm);
      const { data, error } = await sb
        .from('all_users')
        .select('id, user_id, email, full_name')
        .or(`email.ilike.%${searchTerm}%,full_name.ilike.%${searchTerm}%`)
        .limit(10);

      if (!error && data && data.length > 0) {
        console.log('Found users in all_users:', data);
        return data.map(profile => ({
          id: profile.user_id || profile.id,
          email: profile.email,
          name: profile.full_name || profile.email?.split('@')[0] || 'Unknown'
        }));
      }
    } catch (allUsersError) {
      console.log('all_users table not found, trying source tables...');
    }

    // Fallback 1: Search ican_user_profiles table
    try {
      console.log('Searching ican_user_profiles for:', searchTerm);
      const { data, error } = await sb
        .from('ican_user_profiles')
        .select('id, email, full_name')
        .or(`email.ilike.%${searchTerm}%,full_name.ilike.%${searchTerm}%`)
        .limit(10);

      if (!error && data && data.length > 0) {
        console.log('Found users in ican_user_profiles:', data);
        return data.map(profile => ({
          id: profile.id,
          email: profile.email,
          name: profile.full_name || profile.email?.split('@')[0] || 'Unknown'
        }));
      }
    } catch (err) {
      console.log('ican_user_profiles search failed');
    }

    // Fallback 2: Search profiles table
    try {
      console.log('Searching profiles table for:', searchTerm);
      const { data, error } = await sb
        .from('profiles')
        .select('id, email, full_name')
        .or(`email.ilike.%${searchTerm}%,full_name.ilike.%${searchTerm}%`)
        .limit(10);

      if (!error && data && data.length > 0) {
        console.log('Found users in profiles:', data);
        return data.map(profile => ({
          id: profile.id,
          email: profile.email,
          name: profile.full_name || profile.email?.split('@')[0] || 'Unknown'
        }));
      }
    } catch (err) {
      console.log('profiles search failed');
    }

    // Fallback 3: Search auth.users directly (for users not yet in profiles table)
    try {
      console.log('Searching auth.users for:', searchTerm);
      // Note: This requires service_role key or proper RLS policies
      const { data, error } = await sb
        .from('all_users') // Try all_users first which should have auth.users data
        .select('user_id, email, full_name')
        .eq('source_table', 'auth.users')
        .or(`email.ilike.%${searchTerm}%,full_name.ilike.%${searchTerm}%`)
        .limit(10);

      if (!error && data && data.length > 0) {
        console.log('Found auth.users in all_users:', data);
        return data.map(profile => ({
          id: profile.user_id,
          email: profile.email,
          name: profile.full_name || profile.email?.split('@')[0] || 'Unknown'
        }));
      }
    } catch (err) {
      console.log('auth.users search failed:', err.message);
    }

    // Fallback 4: Email-only search in ican_user_profiles
    try {
      console.log('Trying email-only search in ican_user_profiles');
      const { data: emailData, error: emailError } = await sb
        .from('ican_user_profiles')
        .select('id, email, full_name')
        .ilike('email', `%${searchTerm}%`)
        .limit(10);

      if (!emailError && emailData && emailData.length > 0) {
        console.log('Found by email in ican_user_profiles:', emailData);
        return emailData.map(profile => ({
          id: profile.id,
          email: profile.email,
          name: profile.full_name || profile.email?.split('@')[0] || 'Unknown'
        }));
      }
    } catch (err) {
      console.log('Email-only search failed');
    }

    // No results found
    console.log('No users found matching:', searchTerm);
    return [];
  } catch (error) {
    console.error('Critical error in searchICANUsers:', error);
    return [];
  }
};

/**
 * Fetch any users from Supabase
 */
export const fetchAnyUsers = async (limit = 20) => {
  try {
    const sb = getSupabase();
    if (!sb) {
      console.log('Demo mode: no Supabase connection');
      return [];
    }

    // Try to fetch from ican_user_profiles
    console.log('Fetching users from ican_user_profiles...');
    const { data: icanUsers, error: icanError } = await sb
      .from('ican_user_profiles')
      .select('id, email, full_name')
      .limit(limit);

    if (!icanError && icanUsers && icanUsers.length > 0) {
      console.log(`Found ${icanUsers.length} users in ican_user_profiles:`, icanUsers);
      return icanUsers.map(user => ({
        id: user.id,
        email: user.email,
        name: user.full_name || user.email?.split('@')[0] || 'Unknown'
      }));
    }

    // Fallback: try profiles table
    console.log('No users found in ican_user_profiles, trying profiles table...');
    const { data: profileUsers, error: profileError } = await sb
      .from('profiles')
      .select('id, email, full_name')
      .limit(limit);

    if (!profileError && profileUsers && profileUsers.length > 0) {
      console.log(`Found ${profileUsers.length} users in profiles:`, profileUsers);
      return profileUsers.map(user => ({
        id: user.id,
        email: user.email,
        name: user.full_name || user.email?.split('@')[0] || 'Unknown'
      }));
    }

    console.log('No users found in any table');
    return [];
  } catch (error) {
    console.error('Error fetching users:', error);
    return [];
  }
};

/**
 * Pitch Service - All Supabase operations for pitches
 */

// Fetch all published pitches
export const getAllPitches = async (limit = 20, offset = 0) => {
  try {
    const sb = getSupabase();
    if (!sb) {
      console.log('Supabase not configured, returning demo pitches');
      return getDemoPitches();
    }

    console.log(`📥 Fetching pitches (limit: ${limit}, offset: ${offset})...`);
    const startTime = performance.now();

    // First, let's see ALL pitches in the database (no filters)
    const { data: allPitchesDebug, error: debugError } = await sb
      .from('pitches')
      .select('id, title, video_url, status, business_profile_id, created_at')
      .order('created_at', { ascending: false });
    
    console.log('🔍 DEBUG: All pitches in database:', allPitchesDebug?.length || 0);
    if (debugError) {
      console.error('🔍 DEBUG: Error fetching all pitches:', debugError);
    }
    if (allPitchesDebug && allPitchesDebug.length > 0) {
      console.log('🔍 DEBUG: Listing all pitches:');
      allPitchesDebug.forEach((pitch, index) => {
        const hasVideo = pitch.video_url && pitch.video_url.length > 0;
        const isValidUrl = pitch.video_url?.startsWith('https://');
        console.log(`  ${index + 1}. ID: ${pitch.id?.substring(0, 8)}...`);
        console.log(`     Title: "${pitch.title}"`);
        console.log(`     Status: ${pitch.status}`);
        console.log(`     Business Profile: ${pitch.business_profile_id || 'NONE'}`);
        console.log(`     Video URL: ${hasVideo ? (isValidUrl ? '✅ Valid HTTPS' : '⚠️ Invalid format') : '❌ MISSING'}`);
        if (pitch.video_url) {
          console.log(`     URL Preview: ${pitch.video_url.substring(0, 80)}...`);
        }
      });
    } else {
      console.log('🔍 DEBUG: No pitches found in database at all!');
    }

    const { data, error } = await sb
      .from('pitches')
      .select(`
        id,
        title,
        description,
        pitch_type,
        category,
        video_url,
        target_funding,
        raised_amount,
        equity_offering,
        has_ip,
        status,
        views_count,
        likes_count,
        comments_count,
        shares_count,
        created_at,
        business_profile_id,
        business_profiles(
          id,
          user_id,
          business_name,
          description,
          business_type,
          founded_year,
          total_capital
        )
      `, { count: 'exact' })
      .not('video_url', 'is', null)  // Only show pitches with videos
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    const fetchTime = (performance.now() - startTime).toFixed(0);
    
    if (error) {
      console.warn('Error fetching pitches:', error);
      return getDemoPitches();
    }
    
    // 🔍 DEBUG: Check what business_profiles data is actually returned
    if (data && data.length > 0) {
      console.log(`🔍 CRITICAL: Checking business_profiles in ${data.length} returned pitches...`);
      data.slice(0, 3).forEach((pitch, i) => {
        console.log(`\n   Pitch ${i + 1}: "${pitch.title}"`);
        console.log(`   - business_profile_id: ${pitch.business_profile_id || 'NULL'}`);
        console.log(`   - business_profiles object: ${pitch.business_profiles ? 'EXISTS' : 'MISSING'}`);
        if (pitch.business_profiles) {
          console.log(`     └─ business_name: ${pitch.business_profiles.business_name || 'NULL'}`);
          console.log(`     └─ user_id: ${pitch.business_profiles.user_id || 'NULL'}`);
          console.log(`     └─ business_type: ${pitch.business_profiles.business_type || 'NULL'}`);
        }
      });
    }
    
    // 🎥 Filter and validate video URLs
    if (data && data.length > 0) {
      console.log(`🔍 DEBUG: Query returned ${data.length} pitches, now validating...`);
      
      const validPitches = data.filter((pitch, index) => {
        console.log(`  Validating ${index + 1}. "${pitch.title}"`);
        
        if (!pitch.video_url) {
          console.log(`    ❌ No video URL`);
          return false;
        }

        // ❌ Reject blob URLs (temporary, not playable)
        if (pitch.video_url.startsWith('blob:')) {
          console.log(`    ❌ Blob URL: ${pitch.video_url.substring(0, 50)}...`);
          return false;
        }

        // ✅ Accept all valid URLs (Supabase, HTTPS, etc)
        if (pitch.video_url.startsWith('https://') || pitch.video_url.includes('supabase')) {
          console.log(`    ✅ Valid URL: ${pitch.video_url.substring(0, 50)}...`);
          return true;
        }

        // ❌ Reject other invalid URL formats
        console.log(`    ❌ Invalid URL format: ${pitch.video_url.substring(0, 50)}...`);
        return false;
      });

      console.log(`✅ Loaded ${validPitches.length}/${data.length} pitches with valid videos in ${fetchTime}ms`);
      
      // Add status indicators to pitches for UI
      const enrichedPitches = validPitches.map(pitch => ({
        ...pitch,
        isPublished: pitch.status === 'published',
        isDraft: pitch.status === 'draft',
        isPending: pitch.status === 'pending'
      }));
      
      return enrichedPitches;
    }
    
    console.log(`✅ No pitches found (${fetchTime}ms)`);
    return data || [];
  } catch (error) {
    console.error('Error fetching pitches:', error);
    return getDemoPitches();
  }
};

// Fetch user's pitches
export const getUserPitches = async (userId) => {
  try {
    const sb = getSupabase();
    if (!sb) return [];
    
    // Fetch pitches and filter on client side to ensure accuracy
    const { data: pitches, error } = await sb
      .from('pitches')
      .select(`
        id,
        title,
        description,
        pitch_type,
        category,
        video_url,
        target_funding,
        raised_amount,
        equity_offering,
        status,
        created_at,
        business_profile_id,
        business_profiles(
          id,
          business_name,
          user_id
        )
      `)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching pitches:', error);
      return [];
    }

    // Filter pitches to only those belonging to the current user
    const userPitches = (pitches || []).filter(pitch => {
      return pitch.business_profiles && pitch.business_profiles.user_id === userId;
    });

    console.log(`📌 Total pitches: ${pitches?.length}, User pitches: ${userPitches.length}`);
    
    return userPitches;
  } catch (error) {
    console.error('Error fetching user pitches:', error);
    return [];
  }
};

// Create new pitch
export const createPitch = async (pitchData) => {
  try {
    const sb = getSupabase();
    if (!sb) return { success: false, error: 'Supabase not configured' };
    
    // VALIDATION: Reject blob URLs - they won't persist after page reload
    if (pitchData.video_url && pitchData.video_url.startsWith('blob:')) {
      const errorMsg = '❌ ERROR: Cannot save blob URLs to database. Videos must be uploaded to Supabase first using uploadVideo().';
      console.error(errorMsg);
      console.error('Received blob URL:', pitchData.video_url);
      return { success: false, error: errorMsg };
    }

    // VALIDATION: Ensure video_url is from Supabase if provided
    if (pitchData.video_url && !pitchData.video_url.startsWith('http')) {
      const errorMsg = '❌ ERROR: Invalid video URL. Must be a complete Supabase URL starting with https://';
      console.error(errorMsg);
      console.error('Received URL:', pitchData.video_url);
      return { success: false, error: errorMsg };
    }
    
    const { data, error } = await sb
      .from('pitches')
      .insert([pitchData])
      .select();

    if (error) throw error;
    return { success: true, data: data[0] };
  } catch (error) {
    console.error('Error creating pitch:', error);
    return { success: false, error: error.message };
  }
};

// Update pitch
export const updatePitch = async (pitchId, updates) => {
  try {
    const sb = getSupabase();
    if (!sb) return { success: false, error: 'Supabase not configured' };
    
    console.log('🔄 updatePitch called with:');
    console.log('  Pitch ID:', pitchId);
    console.log('  Updates:', JSON.stringify(updates, null, 2));
    
    // Specifically log if we're updating video_url
    if (updates.video_url) {
      console.log('📹 Updating video_url to:', updates.video_url.substring(0, 100) + '...');
    }
    
    const { data, error } = await sb
      .from('pitches')
      .update(updates)
      .eq('id', pitchId)
      .select();

    if (error) {
      console.error('❌ updatePitch ERROR:', error);
      throw error;
    }
    
    console.log('✅ updatePitch SUCCESS:', data);
    if (data && data[0] && data[0].video_url) {
      console.log('📹 Video URL after update:', data[0].video_url ? '✅ Saved' : '❌ Missing');
    }
    
    return { success: true, data: data[0] };
  } catch (error) {
    console.error('Error updating pitch:', error);
    return { success: false, error: error.message };
  }
};

// Delete pitch - ONLY creator can delete
export const deletePitch = async (pitchId, userId = null) => {
  try {
    const sb = getSupabase();
    if (!sb) return { success: false, error: 'Supabase not configured' };
    
    // Verify user is authenticated
    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
      return { success: false, error: 'Must be signed in to delete pitch' };
    }

    console.log(`🗑️  Starting deletion process for pitch ${pitchId}...`);
    
    // Fetch the pitch with business profile to get creator info
    const { data: pitch, error: fetchError } = await sb
      .from('pitches')
      .select(`
        id,
        title,
        video_url,
        thumbnail_url,
        business_profile_id,
        business_profiles!inner(
          id,
          user_id
        )
      `)
      .eq('id', pitchId)
      .single();

    if (fetchError) {
      console.warn('Fetch error details:', fetchError);
      return { success: false, error: `Failed to fetch pitch: ${fetchError.message}` };
    }

    if (!pitch) {
      console.warn(`Pitch not found with ID: ${pitchId}`);
      return { success: false, error: 'Pitch not found' };
    }

    const pitchData = pitch;
    
    // Get creator user_id from business profile
    const creatorUserId = pitchData.business_profiles?.user_id;
    
    if (!creatorUserId) {
      return { success: false, error: 'Could not verify pitch creator' };
    }

    // SECURITY: Verify user is the creator
    if (creatorUserId !== session.user.id && creatorUserId !== userId) {
      console.warn(`⚠️  Unauthorized deletion attempt: User ${session.user.id} tried to delete pitch by ${creatorUserId}`);
      return { success: false, error: 'You can only delete your own pitches' };
    }

    console.log(`📌 Pitch "${pitchData.title}" belongs to creator. Proceeding with deletion...`);

    let storageDeletedCount = 0;

    // Delete video file from storage if it exists (and is not a blob URL)
    if (pitchData?.video_url && !pitchData.video_url.startsWith('blob:')) {
      try {
        // Extract file path from Supabase URL
        // URL formats:
        // - Signed: https://xyz.supabase.co/storage/v1/object/sign/pitches/UUID/timestamp_filename?token=...
        // - Public: https://xyz.supabase.co/storage/v1/object/public/pitches/UUID/timestamp_filename
        
        let filePath = null;

        // Try to extract from signed URL (with token)
        if (pitchData.video_url.includes('?token=')) {
          const urlWithoutToken = pitchData.video_url.split('?')[0];
          const match = urlWithoutToken.match(/pitches\/(.+)$/);
          if (match) {
            filePath = match[1];
          }
        } 
        // Try to extract from public URL
        else if (pitchData.video_url.includes('/pitches/')) {
          const match = pitchData.video_url.match(/\/pitches\/(.+)$/);
          if (match) {
            filePath = match[1];
          }
        }

        if (filePath) {
          console.log(`   🎥 Video file path: pitches/${filePath}`);
          const { error: storageError } = await sb.storage
            .from('pitches')
            .remove([filePath]);

          if (storageError) {
            console.warn(`   ⚠️  Could not delete video from storage:`, storageError.message);
            // Continue with database deletion even if storage deletion fails
          } else {
            console.log(`   ✅ Video file deleted from Supabase storage`);
            storageDeletedCount++;
          }
        } else {
          console.warn(`   ⚠️  Could not extract file path from URL: ${pitchData.video_url}`);
        }
      } catch (storageErr) {
        console.warn('⚠️  Error parsing video URL or deleting from storage:', storageErr.message);
        // Continue with database deletion
      }
    } else if (pitchData?.video_url?.startsWith('blob:')) {
      console.log(`   ℹ️  Video is a blob URL (not saved to Supabase) - skipping storage deletion`);
    }

    // Delete thumbnail from storage if it exists
    if (pitchData?.thumbnail_url && !pitchData.thumbnail_url.startsWith('blob:')) {
      try {
        let thumbPath = null;

        if (pitchData.thumbnail_url.includes('?token=')) {
          const urlWithoutToken = pitchData.thumbnail_url.split('?')[0];
          const match = urlWithoutToken.match(/pitches\/(.+)$/);
          if (match) {
            thumbPath = match[1];
          }
        } else if (pitchData.thumbnail_url.includes('/pitches/')) {
          const match = pitchData.thumbnail_url.match(/\/pitches\/(.+)$/);
          if (match) {
            thumbPath = match[1];
          }
        }

        if (thumbPath) {
          console.log(`   🖼️  Thumbnail file path: pitches/${thumbPath}`);
          const { error: thumbError } = await sb.storage
            .from('pitches')
            .remove([thumbPath]);

          if (thumbError) {
            console.warn(`   ⚠️  Could not delete thumbnail from storage:`, thumbError.message);
          } else {
            console.log(`   ✅ Thumbnail deleted from Supabase storage`);
            storageDeletedCount++;
          }
        }
      } catch (thumbErr) {
        console.warn('⚠️  Error deleting thumbnail:', thumbErr.message);
      }
    } else if (pitchData?.thumbnail_url?.startsWith('blob:')) {
      console.log(`   ℹ️  Thumbnail is a blob URL (not saved to Supabase) - skipping storage deletion`);
    }

    // Delete pitch record from database
    console.log(`🗄️  Deleting pitch record from database...`);
    const { error: dbError } = await sb
      .from('pitches')
      .delete()
      .match({ id: pitchId });

    if (dbError) {
      return { success: false, error: `Failed to delete pitch: ${dbError.message}` };
    }

    console.log(`✅ Pitch "${pitchData.title}" fully deleted`);
    console.log(`   - Storage files deleted: ${storageDeletedCount}`);
    console.log(`   - Database record deleted: ✅`);
    
    return { 
      success: true, 
      message: `Pitch deleted successfully (${storageDeletedCount} file(s) removed from storage)`
    };
  } catch (error) {
    console.error('❌ Error deleting pitch:', error);
    return { success: false, error: error.message || 'Failed to delete pitch' };
  }
};

// Increment likes
export const likePitch = async (pitchId) => {
  try {
    const sb = getSupabase();
    if (!sb) return { success: false, error: 'Supabase not configured' };
    
    const { data: pitch, error: fetchError } = await sb
      .from('pitches')
      .select('likes_count')
      .eq('id', pitchId)
      .single();

    if (fetchError) throw fetchError;

    const { data, error } = await sb
      .from('pitches')
      .update({ likes_count: (pitch.likes_count || 0) + 1 })
      .eq('id', pitchId)
      .select();

    if (error) throw error;
    return { success: true, data: data[0] };
  } catch (error) {
    console.error('Error liking pitch:', error);
    return { success: false, error: error.message };
  }
};

// Increment shares
export const sharePitch = async (pitchId) => {
  try {
    const sb = getSupabase();
    if (!sb) return { success: false, error: 'Supabase not configured' };
    
    const { data: pitch, error: fetchError } = await sb
      .from('pitches')
      .select('shares_count')
      .eq('id', pitchId)
      .single();

    if (fetchError) throw fetchError;

    const { data, error } = await sb
      .from('pitches')
      .update({ shares_count: (pitch.shares_count || 0) + 1 })
      .eq('id', pitchId)
      .select();

    if (error) throw error;
    return { success: true, data: data[0] };
  } catch (error) {
    console.error('Error sharing pitch:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Business Profile Service
 */

// Fetch user's business profiles
export const getUserBusinessProfiles = async (userId) => {
  try {
    const sb = getSupabase();
    if (!sb) return [];
    
    const { data, error } = await sb
      .from('business_profiles')
      .select(`
        id,
        user_id,
        business_name,
        business_type,
        registration_number,
        tax_id,
        description,
        website,
        business_address,
        founded_year,
        total_capital,
        status,
        verification_status,
        created_at,
        business_co_owners(
          id,
          owner_name,
          owner_email,
          owner_phone,
          ownership_share,
          role,
          user_id
        )
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching business profiles:', error);
    return [];
  }
};

// Create business profile
export const createBusinessProfile = async (userId, profileData) => {
  try {
    const sb = getSupabase();
    if (!sb) return { success: false, error: 'Supabase not configured' };
    
    // Get authenticated user from session to ensure RLS passes
    const { data: { user: authUser } } = await sb.auth.getUser();
    if (!authUser) return { success: false, error: 'User not authenticated' };
    
    // Always use the authenticated user's ID for RLS compliance
    const { data, error } = await sb
      .from('business_profiles')
      .insert([{ user_id: authUser.id, ...profileData }])
      .select();

    if (error) throw error;
    return { success: true, data: data[0] };
  } catch (error) {
    console.error('Error creating business profile:', error);
    return { success: false, error: error.message };
  }
};

// Update business profile
export const updateBusinessProfile = async (profileId, profileData) => {
  try {
    const sb = getSupabase();
    if (!sb) return { success: false, error: 'Supabase not configured' };
    
    const { data, error } = await sb
      .from('business_profiles')
      .update(profileData)
      .eq('id', profileId)
      .select();

    if (error) throw error;
    console.log('✅ Business profile updated successfully');
    return { success: true, data: data[0] };
  } catch (error) {
    console.error('Error updating business profile:', error);
    return { success: false, error: error.message };
  }
};

// Save co-owners for a business profile
export const saveBusinessCoOwners = async (businessProfileId, coOwners) => {
  try {
    const sb = getSupabase();
    if (!sb) return { success: false, error: 'Supabase not configured' };

    // First, delete existing co-owners for this profile
    const { error: deleteError } = await sb
      .from('business_co_owners')
      .delete()
      .eq('business_profile_id', businessProfileId);

    if (deleteError) throw deleteError;

    // If no co-owners to add, return success
    if (!coOwners || coOwners.length === 0) {
      return { success: true };
    }

    // Look up user_ids for each co-owner by their email
    const emails = coOwners.map(o => o.email).filter(Boolean);
    let emailToUserId = {};
    
    if (emails.length > 0) {
      const { data: profiles, error: profilesError } = await sb
        .from('profiles')
        .select('id, email')
        .in('email', emails);
      
      if (!profilesError && profiles) {
        profiles.forEach(p => {
          emailToUserId[p.email] = p.id;
        });
      }
    }

    // Prepare co-owner data with user_id
    const coOwnersData = coOwners.map(owner => ({
      business_profile_id: businessProfileId,
      owner_name: owner.name,
      owner_email: owner.email,
      owner_phone: owner.phone || null,
      ownership_share: owner.ownershipShare,
      role: owner.role,
      status: 'active',
      verification_status: owner.verified ? 'verified' : 'pending',
      user_id: emailToUserId[owner.email] || null  // Link to user account
    }));

    // Insert new co-owners
    const { data, error } = await sb
      .from('business_co_owners')
      .insert(coOwnersData)
      .select();

    if (error) throw error;
    
    console.log(`✅ Saved ${coOwners.length} co-owners successfully`);
    console.log(`📧 Linked user IDs:`, emailToUserId);
    return { success: true, data };
  } catch (error) {
    console.error('Error saving co-owners:', error);
    return { success: false, error: error.message };
  }
};

// Delete business profile
export const deleteBusinessProfile = async (profileId) => {
  try {
    const sb = getSupabase();
    if (!sb) return { success: false, error: 'Supabase not configured' };
    
    const { error } = await sb
      .from('business_profiles')
      .delete()
      .eq('id', profileId);

    if (error) throw error;
    return { success: true };
  } catch (error) {
    console.error('Error deleting business profile:', error);
    return { success: false, error: error.message };
  }
};

// Get all business profiles where user is a co-owner (by user_id or email)
export const getCoOwnedBusinessProfiles = async (userEmail, userId) => {
  try {
    const sb = getSupabase();
    if (!sb) return [];
    
    // First, get all business profile IDs where user is a co-owner
    // Search by BOTH user_id (RLS) and email (fallback)
    let coOwnerData = [];
    
    // Try by user_id first (if RLS allows it)
    if (userId) {
      const { data: byUserId, error: userIdError } = await sb
        .from('business_co_owners')
        .select('business_profile_id')
        .eq('user_id', userId);
      
      if (!userIdError && byUserId) {
        coOwnerData = [...byUserId];
      }
    }
    
    // Also try by email (for co-owners where user_id wasn't linked yet)
    const { data: byEmail, error: emailError } = await sb
      .from('business_co_owners')
      .select('business_profile_id')
      .eq('owner_email', userEmail);
    
    if (!emailError && byEmail) {
      // Merge results, avoiding duplicates
      for (const record of byEmail) {
        if (!coOwnerData.find(c => c.business_profile_id === record.business_profile_id)) {
          coOwnerData.push(record);
        }
      }
    }

    if (coOwnerData.length === 0) return [];

    // Get unique profile IDs
    const profileIds = [...new Set(coOwnerData.map(co => co.business_profile_id))];

    // Fetch the business profiles
    const { data: profiles, error: profileError } = await sb
      .from('business_profiles')
      .select(`
        id,
        user_id,
        business_name,
        business_type,
        registration_number,
        tax_id,
        description,
        website,
        business_address,
        founded_year,
        total_capital,
        status,
        verification_status,
        created_at,
        business_co_owners(
          id,
          owner_name,
          owner_email,
          owner_phone,
          ownership_share,
          role,
          user_id
        )
      `)
      .in('id', profileIds)
      .order('created_at', { ascending: false });

    if (profileError) throw profileError;
    return profiles || [];
  } catch (error) {
    console.error('Error fetching co-owned business profiles:', error);
    return [];
  }
};

// Get all business profiles accessible to user (owned OR co-owned)
export const getAllAccessibleBusinessProfiles = async (userId, userEmail) => {
  try {
    const sb = getSupabase();
    if (!sb) return [];
    
    // Get profiles user created
    const ownedProfiles = await getUserBusinessProfiles(userId);
    
    // Get profiles user is a co-owner of (by user_id or email)
    const coOwnedProfiles = await getCoOwnedBusinessProfiles(userEmail, userId);
    
    // Merge and deduplicate by ID
    const allProfiles = [...ownedProfiles];
    for (const coOwned of coOwnedProfiles) {
      if (!allProfiles.find(p => p.id === coOwned.id)) {
        // Mark as co-owned profile
        allProfiles.push({ ...coOwned, isCoOwned: true });
      }
    }
    
    return allProfiles;
  } catch (error) {
    console.error('Error fetching accessible business profiles:', error);
    return [];
  }
};

// Check if user can edit a business profile
// Returns: { canEdit: boolean, reason: string }
export const checkBusinessProfileEditPermission = async (profileId, userId, userEmail) => {
  try {
    const sb = getSupabase();
    if (!sb) return { canEdit: false, canAccess: false, reason: 'Supabase not configured' };
    
    // Fetch the profile with co-owners
    const { data: profile, error } = await sb
      .from('business_profiles')
      .select(`
        id,
        user_id,
        business_co_owners(
          owner_email,
          ownership_share
        )
      `)
      .eq('id', profileId)
      .single();

    if (error) throw error;
    if (!profile) return { canEdit: false, canAccess: false, reason: 'Profile not found' };

    // Check if user is the creator
    if (profile.user_id === userId) {
      return { 
        canEdit: true, 
        canAccess: true,
        reason: 'You are the creator of this profile' 
      };
    }

    // Check if user is a co-owner
    const coOwners = profile.business_co_owners || [];
    const userCoOwner = coOwners.find(co => co.owner_email === userEmail);
    
    if (!userCoOwner) {
      return { 
        canEdit: false, 
        canAccess: false,
        reason: 'You are not a shareholder of this profile' 
      };
    }

    // If user is a shareholder, allow both access and edit
    return { 
      canEdit: true, 
      canAccess: true,
      reason: `You are a shareholder with ${userCoOwner.ownership_share}% equity share`,
      ownership_share: userCoOwner.ownership_share
    };
  } catch (error) {
    console.error('Error checking edit permission:', error);
    return { canEdit: false, canAccess: false, reason: error.message };
  }
};

/**
 * Smart Contract Service
 */

// Fetch smart contracts for a pitch
export const getPitchSmartContracts = async (pitchId) => {
  try {
    const sb = getSupabase();
    if (!sb) return [];
    
    const { data, error } = await sb
      .from('smart_contracts')
      .select(`
        id,
        contract_type,
        status,
        shares_offered,
        total_investment,
        mou_content,
        digital_signatures(
          id,
          signer_name,
          auth_method,
          signature_timestamp
        )
      `)
      .eq('pitch_id', pitchId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching smart contracts:', error);
    return [];
  }
};

// Create smart contract
export const createSmartContract = async (contractData) => {
  try {
    const sb = getSupabase();
    if (!sb) return { success: false, error: 'Supabase not configured' };
    
    const { data, error } = await sb
      .from('smart_contracts')
      .insert([contractData])
      .select();

    if (error) throw error;
    return { success: true, data: data[0] };
  } catch (error) {
    console.error('Error creating smart contract:', error);
    return { success: false, error: error.message };
  }
};

// Create digital signature
export const createDigitalSignature = async (signatureData) => {
  try {
    const sb = getSupabase();
    if (!sb) return { success: false, error: 'Supabase not configured' };
    
    const { data, error } = await sb
      .from('digital_signatures')
      .insert([signatureData])
      .select();

    if (error) throw error;

    // Create notification for contract signings
    if (signatureData.smart_contract_id) {
      await createNotification({
        recipient_id: signatureData.signer_id,
        notification_type: 'signature',
        title: 'Agreement Signed',
        message: `${signatureData.signer_name} signed an agreement`,
        digital_signature_id: data[0].id,
        smart_contract_id: signatureData.smart_contract_id
      });
    }

    return { success: true, data: data[0] };
  } catch (error) {
    console.error('Error creating digital signature:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Notification Service
 */

// Create notification
/**
 * Create notification for investment agreements
 * Writes to investment_notifications table
 * Works for any recipient (not just current user)
 */
export const createInvestmentNotification = async (notificationData) => {
  try {
    const sb = getSupabase();
    if (!sb) {
      console.log('📱 Demo mode: investment notification created (local only)', notificationData.title);
      return { success: true, data: { id: 'demo-' + Date.now(), ...notificationData } };
    }

    // Get current user for sender_id
    const { data: { user }, error: userError } = await sb.auth.getUser();
    if (userError) {
      console.warn('⚠️  Could not get current user for sender_id:', userError.message);
    }

    // Validate required fields
    if (!notificationData.recipient_id) {
      console.warn('❌ Missing recipient_id in investment notification');
      return { success: false, error: 'Missing recipient_id' };
    }

    if (!notificationData.notification_type) {
      console.warn('❌ Missing notification_type in investment notification');
      return { success: false, error: 'Missing notification_type' };
    }

    const { data, error } = await sb
      .from('investment_notifications')
      .insert([{
        recipient_id: notificationData.recipient_id,
        sender_id: user?.id || null,
        notification_type: notificationData.notification_type,
        title: notificationData.title || '',
        message: notificationData.message || '',
        agreement_id: notificationData.agreement_id || null,
        pitch_id: notificationData.pitch_id || null,
        business_profile_id: notificationData.business_profile_id || null,
        priority: notificationData.priority || 'normal',
        action_url: notificationData.action_url || null,
        action_label: notificationData.action_label || null,
        metadata: notificationData.metadata || {}
      }])
      .select();

    if (error) {
      console.warn(`⚠️  Could not create investment notification: ${error.message}`);
      return { success: false, error: error.message };
    }

    const notif = data?.[0];
    if (notif) {
      console.log(`✅ Investment notification sent to ${notificationData.recipient_id.substring(0, 8)}... - ${notificationData.title}`);
    }
    return { success: true, data: notif };
  } catch (error) {
    console.error('❌ Error creating investment notification:', error);
    return { success: false, error: error.message };
  }
};

// Legacy notification function - keeps existing behavior
export const createNotification = async (notificationData) => {
  try {
    const sb = getSupabase();
    if (!sb) {
      console.log('Demo mode: notification created (local only)');
      return { success: true, data: { id: 'demo-' + Date.now(), ...notificationData } };
    }

    // Get current user
    const { data: { user }, error: userError } = await sb.auth.getUser();
    if (userError || !user) {
      console.warn('Could not get current user for notification');
      return { success: true }; // Don't fail if can't create notification
    }

    // Only create notification if recipient is the current user (RLS requirement)
    // For now, skip notifications that aren't for the current user
    if (notificationData.recipient_id && notificationData.recipient_id !== user.id) {
      console.log('Skipping notification - recipient is not current user');
      return { success: true }; // Don't fail - just skip
    }

    const { data, error } = await sb
      .from('notifications')
      .insert([{
        ...notificationData,
        recipient_id: user.id // Ensure recipient_id is current user
      }])
      .select();

    if (error) {
      // Log but don't fail - RLS or auth issue is expected in some cases
      console.warn('Could not create notification (RLS or auth issue):', error.message);
      return { success: true }; // Don't fail if notification can't be created
    }
    return { success: true, data: data[0] };
  } catch (error) {
    console.error('Error creating notification:', error);
    return { success: true }; // Don't fail if notification can't be created
  }
};

// Fetch user notifications
export const getUserNotifications = async (userId) => {
  try {
    const sb = getSupabase();
    if (!sb) return [];
    
    const { data, error } = await sb
      .from('notifications')
      .select('*')
      .eq('recipient_id', userId)
      .eq('status', 'unread')
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching notifications:', error);
    return [];
  }
};

/**
 * Upload Service
 */

// Upload video to storage
export const uploadVideo = async (file, pitchId) => {
  try {
    const sb = getSupabase();
    if (!sb) {
      const errorMsg = '❌ CRITICAL: Supabase not configured - videos CANNOT be saved. Configure .env.local with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY';
      console.error(errorMsg);
      return { success: false, error: errorMsg, url: null, isDemoMode: false };
    }

    // Check authentication status
    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
      const errorMsg = '❌ CRITICAL: Not authenticated - cannot upload videos to Supabase. Please sign in first.';
      console.error(errorMsg);
      return { success: false, error: errorMsg, url: null, isDemoMode: false };
    }

    console.log(`📹 Uploading video for pitch ${pitchId}...`);
    
    // Generate filename if file doesn't have one (Blob objects don't have .name property)
    const videoFileName = file.name || `pitch-video-${Date.now()}.webm`;
    const fileSizeMB = (file.size / 1024 / 1024).toFixed(2);
    
    console.log(`   File: ${videoFileName} (${fileSizeMB}MB)`);
    console.log(`   User: ${session.user.email}`);
    
    // Warn if file is large (should be < 50MB for fast playback)
    if (file.size > 50 * 1024 * 1024) {
      console.warn(`⚠️  Video is ${fileSizeMB}MB - consider compressing to < 50MB for faster playback`);
      console.warn('   💡 Tip: Use HandBrake or FFmpeg to compress: ffmpeg -i input.webm -c:v libvp8 -crf 30 output.webm');
    }

    const timestamp = Date.now();
    const fileName = `${pitchId}/${timestamp}_${videoFileName}`;
    
    console.log(`   Uploading to: pitches/${fileName}`);

    // Upload the video with retry logic
    let uploadError = null;
    let uploadData = null;
    
    for (let attempt = 1; attempt <= 3; attempt++) {
      console.log(`   Attempt ${attempt}/3...`);
      
      const { data, error } = await sb.storage
        .from('pitches')
        .upload(fileName, file, {
          cacheControl: '3600',
          upsert: false
        });

      if (!error) {
        uploadData = data;
        break;
      }
      
      uploadError = error;
      console.warn(`   ⚠️  Attempt ${attempt} failed:`, error.message);
      
      // Don't retry on auth errors
      if (error.message?.includes('Unauthorized') || error.message?.includes('JWT')) {
        break;
      }
      
      // Wait before retry (exponential backoff)
      if (attempt < 3) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }

    if (uploadError) {
      console.error('❌ Storage upload FAILED - VIDEO NOT SAVED');
      console.error('   Error:', uploadError.message);
      console.error('   ');
      console.error('   ⚠️  VIDEO WILL NOT PERSIST AFTER REFRESH');
      console.error('   ');
      console.error('   Detailed error analysis:');
      
      // Detailed error analysis
      if (uploadError.message?.includes('row violates') || uploadError.message?.includes('RLS')) {
        console.error('🔐 RLS POLICY ERROR');
        console.error('   The bucket policies are not configured correctly');
        console.error('   Fix:');
        console.error('   1. Go to Supabase Dashboard');
        console.error('   2. Storage → pitches → Policies tab');
        console.error('   3. Check all 4 policies are enabled');
        console.error('   4. If missing, run fix_pitches_storage_policies.sql again');
      } else if (uploadError.message?.includes('Bucket not found')) {
        console.error('🪣 BUCKET NOT FOUND');
        console.error('   The "pitches" bucket does not exist');
        console.error('   Create it: Supabase Storage → Create Bucket (name: pitches)');
      } else if (uploadError.message?.includes('Unauthorized') || uploadError.message?.includes('403')) {
        console.error('🔑 PERMISSION DENIED');
        console.error('   Your user does not have upload permissions');
        console.error('   Check: RLS policies and authentication');
      } else if (uploadError.message?.includes('network') || uploadError.message?.includes('ERR')) {
        console.error('🌐 NETWORK ERROR');
        console.error('   Check your internet connection');
      }
      
      // REJECT the upload instead of silently falling back
      console.error('');
      console.error('❌ REJECTING UPLOAD - Please fix the error above and try again');
      return { success: false, error: uploadError.message || 'Upload failed', url: null };
    }

    if (!uploadData) {
      console.error('❌ Upload returned no data - VIDEO NOT SAVED');
      return { success: false, error: 'Upload returned no data', url: null };
    }

    console.log(`✅ Upload successful!`);
    console.log(`   Path: ${uploadData.path}`);

    // Get public URL (works with RLS policies allowing public SELECT)
    const { data: urlData } = sb.storage
      .from('pitches')
      .getPublicUrl(fileName);

    if (!urlData || !urlData.publicUrl) {
      console.error('❌ Could not generate public URL - VIDEO NOT ACCESSIBLE');
      return { success: false, error: 'Could not generate public URL', url: null };
    }

    let videoUrl = urlData.publicUrl;

    // Also generate a signed URL as fallback (valid for 1 year)
    // This bypasses RLS policies and works even if public access is blocked
    try {
      const oneDayInSeconds = 365 * 24 * 60 * 60; // 1 year
      const { data: signedData, error: signError } = await sb.storage
        .from('pitches')
        .createSignedUrl(fileName, oneDayInSeconds);

      if (signError) {
        console.warn('⚠️  Could not create signed URL:', signError.message);
      } else if (signedData?.signedUrl) {
        console.log(`🔐 Signed URL: ${signedData.signedUrl.substring(0, 80)}...`);
        // Use signed URL instead - it has better compatibility
        videoUrl = signedData.signedUrl;
      }
    } catch (signErr) {
      console.warn('⚠️  Error creating signed URL:', signErr.message);
    }

    // Log full URL details for debugging
    console.log(`🔗 Video URL: ${videoUrl.substring(0, 80)}...`);
    console.log(`   Format: ${videoUrl.includes('sign=') ? 'Signed URL' : 'Public URL'}`);
    console.log(`   Bucket: pitches`);
    console.log(`   Path: ${fileName}`);
    
    return { success: true, url: videoUrl, path: uploadData.path, isDemoMode: false };
  } catch (error) {
    console.error('❌ Unexpected error uploading video:', error);
    console.error('   VIDEO NOT SAVED - Please try again');
    return { success: false, error: error.message || 'Unexpected upload error', url: null };
  }
};

// Upload thumbnail
export const uploadThumbnail = async (file, pitchId) => {
  try {
    const sb = getSupabase();
    if (!sb) {
      console.log('🖼️  Demo mode: Using local blob URL for thumbnail');
      return { success: true, url: URL.createObjectURL(file), path: 'demo', isDemoMode: true };
    }

    // Check authentication status
    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
      console.warn('⚠️  Not authenticated - falling back to local blob URL');
      return { success: true, url: URL.createObjectURL(file), path: 'local', isDemoMode: true };
    }

    console.log(`🖼️  Uploading thumbnail for pitch ${pitchId}...`);

    // Generate filename if file doesn't have one
    const thumbFileName = file.name || `thumbnail-${Date.now()}.jpg`;
    const fileName = `thumbnails/${pitchId}/${Date.now()}_${thumbFileName}`;
    
    const { data, error } = await sb.storage
      .from('pitches')
      .upload(fileName, file, {
        cacheControl: '3600',
        upsert: false
      });

    if (error) {
      console.error('❌ Thumbnail upload error:', error);
      console.log('   Falling back to local blob URL...');
      return { success: true, url: URL.createObjectURL(file), path: 'local', isDemoMode: true };
    }

    const { data: urlData } = sb.storage
      .from('pitches')
      .getPublicUrl(fileName);

    if (!urlData || !urlData.publicUrl) {
      console.warn('⚠️  Could not generate public URL for thumbnail');
      return { success: true, url: URL.createObjectURL(file), path: 'local', isDemoMode: true };
    }

    return { success: true, url: urlData.publicUrl, path: data.path, isDemoMode: false };
  } catch (error) {
    console.error('❌ Error uploading thumbnail:', error);
    console.log('   Falling back to local blob URL');
    return { success: true, url: URL.createObjectURL(file), path: 'local', isDemoMode: true };
  }
};

/**
 * Demo Data - Fallback when Supabase not configured
 */
const getDemoPitches = () => {
  return [
    {
      id: '1',
      title: 'AI-Powered Supply Chain Platform',
      description: 'Revolutionary blockchain supply chain tracking system. Seeking $500K for 15% equity.',
      pitch_type: 'Equity',
      category: 'Technology',
      video_url: '/placeholder-pitch.mp4',
      target_funding: 500000,
      raised_amount: 250000,
      equity_offering: 15,
      has_ip: true,
      status: 'published',
      views_count: 342,
      likes_count: 342,
      comments_count: 28,
      shares_count: 15,
      created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      business_profiles: {
        id: '1',
        business_name: 'Sarah Tech Solutions',
        description: 'Tech innovation company',
        business_co_owners: [
          { owner_name: 'Sarah' },
          { owner_name: 'John' },
          { owner_name: 'Mike' }
        ]
      }
    },
    {
      id: '2',
      title: 'Sustainable Fashion E-commerce Platform',
      description: 'Eco-friendly fashion marketplace connecting sustainable brands with conscious consumers.',
      pitch_type: 'Equity',
      category: 'E-commerce',
      video_url: '/placeholder-pitch.mp4',
      target_funding: 300000,
      raised_amount: 120000,
      equity_offering: 12,
      has_ip: true,
      status: 'published',
      views_count: 215,
      likes_count: 215,
      comments_count: 18,
      shares_count: 12,
      created_at: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
      business_profiles: {
        id: '2',
        business_name: 'EcoStyle Ventures',
        description: 'Sustainable fashion startup',
        business_co_owners: [
          { owner_name: 'Emma' },
          { owner_name: 'Lisa' }
        ]
      }
    }
  ];
};

// =============================================
// INVESTMENT AGREEMENT SERVICES
// =============================================

/**
 * Create or update investment agreement for a pitch
 */
export const saveInvestmentAgreement = async (agreementData) => {
  try {
    const sb = getSupabase();
    if (!sb) return { success: false, error: 'Supabase not configured' };

    const data = {
      business_profile_id: agreementData.businessProfileId,
      pitch_id: agreementData.pitchId,
      created_by: agreementData.createdBy,
      funding_goal: agreementData.fundingGoal || null,
      equity_offered: agreementData.equityOffered || null,
      min_investment: agreementData.minInvestment || null,
      max_investment: agreementData.maxInvestment || null,
      price_per_share: agreementData.pricePerShare || null,
      total_shares: agreementData.totalShares || null,
      accepts_partners: agreementData.acceptsPartners ?? true,
      accepts_grants: agreementData.acceptsGrants ?? false,
      partner_roles: agreementData.partnerRoles || [],
      vesting_period: agreementData.vestingPeriod || '12 months',
      lockup_period: agreementData.lockupPeriod || '6 months',
      dividend_policy: agreementData.dividendPolicy || null,
      voting_rights: agreementData.votingRights || null,
      exit_strategy: agreementData.exitStrategy || null,
      custom_terms: agreementData.customTerms || null,
      status: agreementData.status || 'draft',
      updated_at: new Date().toISOString()
    };

    // Check if agreement already exists for this pitch
    if (agreementData.pitchId) {
      const { data: existing } = await sb
        .from('investment_agreements')
        .select('id')
        .eq('pitch_id', agreementData.pitchId)
        .single();

      if (existing) {
        // Update existing
        const { data: updated, error } = await sb
          .from('investment_agreements')
          .update(data)
          .eq('id', existing.id)
          .select()
          .single();

        if (error) throw error;
        return { success: true, data: updated };
      }
    }

    // Create new
    const { data: created, error } = await sb
      .from('investment_agreements')
      .insert([{ ...data, created_at: new Date().toISOString() }])
      .select()
      .single();

    if (error) throw error;
    return { success: true, data: created };

  } catch (error) {
    console.error('Error saving investment agreement:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get investment agreement for a pitch
 */
export const getInvestmentAgreement = async (pitchId) => {
  try {
    const sb = getSupabase();
    if (!sb) return null;

    const { data, error } = await sb
      .from('investment_agreements')
      .select('*')
      .eq('pitch_id', pitchId)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data;

  } catch (error) {
    console.error('Error fetching investment agreement:', error);
    return null;
  }
};

/**
 * Submit investment signature
 */
export const submitInvestmentSignature = async (signatureData) => {
  try {
    const sb = getSupabase();
    if (!sb) return { success: false, error: 'Supabase not configured' };

    const contractId = `ICAN-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
    const contractHash = btoa(contractId + JSON.stringify(signatureData)).substring(0, 64);

    const data = {
      agreement_id: signatureData.agreementId,
      user_id: signatureData.userId,
      investor_name: signatureData.investorName,
      investor_email: signatureData.investorEmail,
      investor_phone: signatureData.investorPhone || null,
      investment_type: signatureData.investmentType,
      investment_amount: signatureData.investmentAmount,
      equity_percentage: signatureData.equityPercentage || null,
      partner_role: signatureData.partnerRole || null,
      signature_method: signatureData.signatureMethod,
      signed_at: signatureData.signedAt || new Date().toISOString(),
      location_lat: signatureData.location?.lat || null,
      location_lng: signatureData.location?.lng || null,
      location_accuracy: signatureData.location?.accuracy || null,
      location_name: signatureData.location?.name || null,
      device_platform: signatureData.deviceInfo?.platform || null,
      device_user_agent: signatureData.deviceInfo?.userAgent || null,
      contract_id: contractId,
      contract_hash: contractHash,
      qr_code_data: JSON.stringify(signatureData.qrData || {}),
      status: 'pending',
      investor_message: signatureData.message || null,
      created_at: new Date().toISOString()
    };

    const { data: created, error } = await sb
      .from('agreement_signatures')
      .insert([data])
      .select()
      .single();

    if (error) throw error;
    return { success: true, data: created, contractId };

  } catch (error) {
    console.error('Error submitting signature:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get all signatures for an agreement (for owners)
 */
export const getAgreementSignatures = async (agreementId) => {
  try {
    const sb = getSupabase();
    if (!sb) return [];

    const { data, error } = await sb
      .from('agreement_signatures')
      .select('*')
      .eq('agreement_id', agreementId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];

  } catch (error) {
    console.error('Error fetching signatures:', error);
    return [];
  }
};

/**
 * Approve investor signature (owner action)
 */
export const approveInvestorSignature = async (signatureId) => {
  try {
    const sb = getSupabase();
    if (!sb) return { success: false, error: 'Supabase not configured' };

    const { data, error } = await sb
      .from('agreement_signatures')
      .update({
        owner_approved: true,
        owner_approved_at: new Date().toISOString(),
        status: 'completed',
        updated_at: new Date().toISOString()
      })
      .eq('id', signatureId)
      .select()
      .single();

    if (error) throw error;
    return { success: true, data };

  } catch (error) {
    console.error('Error approving signature:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Reject investor signature (owner action)
 */
export const rejectInvestorSignature = async (signatureId, reason) => {
  try {
    const sb = getSupabase();
    if (!sb) return { success: false, error: 'Supabase not configured' };

    const { data, error } = await sb
      .from('agreement_signatures')
      .update({
        status: 'rejected',
        investor_message: reason || 'Rejected by owner',
        updated_at: new Date().toISOString()
      })
      .eq('id', signatureId)
      .select()
      .single();

    if (error) throw error;
    return { success: true, data };

  } catch (error) {
    console.error('Error rejecting signature:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get user's investment history
 */
export const getUserInvestments = async (userId) => {
  try {
    const sb = getSupabase();
    if (!sb) return [];

    const { data, error } = await sb
      .from('agreement_signatures')
      .select(`
        *,
        investment_agreements(
          id,
          funding_goal,
          equity_offered,
          status,
          business_profile_id,
          pitch_id
        )
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];

  } catch (error) {
    console.error('Error fetching user investments:', error);
    return [];
  }
};

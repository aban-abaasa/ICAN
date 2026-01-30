import React, { createContext, useContext, useState, useEffect } from 'react';
import { getSupabaseClient } from '../lib/supabase/client';

const AuthContext = createContext({});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  // Get supabase client safely
  const getSupabase = () => {
    const client = getSupabaseClient();
    if (!client) {
      console.error('❌ Supabase client not initialized. Check your environment variables.');
      return null;
    }
    return client;
  };

  // Load user profile from database
  const loadProfile = async (userId) => {
    if (!userId) {
      setProfile(null);
      return null;
    }

    const supabase = getSupabase();
    if (!supabase) {
      setProfile(null);
      return null;
    }

    try {
      // Try profiles table (standard Supabase table)
      let { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      // If not found in profiles, fallback silently
      if (error && error.code === 'PGRST116') {
        setProfile(null);
        return null;
      } else if (error) {
        console.error('Error fetching profile:', error);
        setProfile(null);
        return null;
      }

      if (data) {
        setProfile(data);
        return data;
      }

      // If no profile exists, create one from auth user metadata
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (authUser) {
        const newProfile = {
          id: authUser.id,
          email: authUser.email,
          full_name: authUser.user_metadata?.full_name || authUser.user_metadata?.name || '',
          avatar_url: authUser.user_metadata?.avatar_url || authUser.user_metadata?.picture || null,
        };

        // Try to insert into profiles table
        const { data: createdProfile, error: createError } = await supabase
          .from('profiles')
          .upsert(newProfile)
          .select()
          .single();

        if (!createError && createdProfile) {
          setProfile(createdProfile);
          return createdProfile;
        }

        // Fall back to using auth metadata as profile
        setProfile(newProfile);
        return newProfile;
      }

      return null;
    } catch (err) {
      console.warn('Error loading profile:', err);
      // Use auth user metadata as fallback
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (authUser) {
        const fallbackProfile = {
          id: authUser.id,
          email: authUser.email,
          full_name: authUser.user_metadata?.full_name || authUser.user_metadata?.name || '',
          avatar_url: authUser.user_metadata?.avatar_url || authUser.user_metadata?.picture || null,
        };
        setProfile(fallbackProfile);
        return fallbackProfile;
      }
      return null;
    }
  };

  // Update user profile
  const updateProfile = async (updates) => {
    if (!user) throw new Error('Not authenticated');
    
    const supabase = getSupabase();
    if (!supabase) throw new Error('Supabase not initialized');

    const { data, error } = await supabase
      .from('profiles')
      .upsert({
        id: user.id,
        email: user.email,
        ...updates,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'id'
      })
      .select()
      .single();

    if (error) {
      console.error('Profile update error:', error);
      throw error;
    }
    setProfile(data);
    return data;
  };

  // Upload avatar
  const uploadAvatar = async (file) => {
    if (!user) throw new Error('Not authenticated');
    
    const supabase = getSupabase();
    if (!supabase) throw new Error('Supabase not initialized');

    const fileExt = file.name.split('.').pop();
    const fileName = `${user.id}-${Date.now()}.${fileExt}`;
    const filePath = `avatars/${fileName}`;

    console.log('🚀 Starting avatar upload:', { filePath, fileName, fileSize: file.size });

    // Upload to Supabase Storage
    const { data, error: uploadError } = await supabase.storage
      .from('user-content')
      .upload(filePath, file, { upsert: true });

    if (uploadError) {
      console.error('❌ Upload error:', uploadError);
      throw uploadError;
    }

    console.log('✅ File uploaded successfully:', data);

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('user-content')
      .getPublicUrl(filePath);

    console.log('🔗 Public URL:', publicUrl);

    // Update profile with new avatar URL
    await updateProfile({ avatar_url: publicUrl });

    console.log('💾 Profile updated with avatar URL');

    return publicUrl;
  };

  // Get initials for avatar fallback
  const getInitials = (name) => {
    if (!name) return '?';
    const parts = name.trim().split(' ').filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0][0].toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  // Get display name
  const getDisplayName = () => {
    if (profile?.full_name) return profile.full_name;
    if (user?.user_metadata?.full_name) return user.user_metadata.full_name;
    if (user?.user_metadata?.name) return user.user_metadata.name;
    if (user?.email) return user.email.split('@')[0];
    return 'User';
  };

  // Get avatar URL
  const getAvatarUrl = () => {
    return profile?.avatar_url || 
           user?.user_metadata?.avatar_url || 
           user?.user_metadata?.picture || 
           null;
  };

  useEffect(() => {
    const supabase = getSupabase();
    
    if (!supabase) {
      console.warn('⚠️ Supabase not initialized. Setting loading to false.');
      setLoading(false);
      return;
    }

    let isMounted = true;

    const initializeAuth = async () => {
      try {
        // Add small delay to let Supabase settle
        await new Promise(resolve => setTimeout(resolve, 50));

        if (!isMounted) return;

        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (!isMounted) return;

        if (error && error.message !== 'signal is aborted') {
          console.error('Auth initialization error:', error);
        }

        setUser(session?.user ?? null);
        if (session?.user) {
          await loadProfile(session.user.id);
        }
        setLoading(false);
        
        // Clear hash after Supabase has processed it
        if (window.location.hash && isMounted) {
          window.history.replaceState(null, '', window.location.pathname);
        }
      } catch (err) {
        // Silently ignore abort errors and only log other errors
        if (isMounted && err.name !== 'AbortError' && !err.message?.includes('aborted')) {
          console.error('Error getting session:', err);
        }
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    initializeAuth();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!isMounted) return;
        setUser(session?.user ?? null);
        if (session?.user) {
          loadProfile(session.user.id);
        } else {
          setProfile(null);
        }
        setLoading(false);
      }
    );

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // Sign up - exactly like FARM-AGENT
  const signUp = async (email, password, fullName) => {
    const supabase = getSupabase();
    if (!supabase) throw new Error('Supabase not initialized');
    
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
        }
      }
    });

    if (error) throw error;

    // Check if user already exists
    if (data.user && data.user.identities && data.user.identities.length === 0) {
      throw new Error('An account with this email already exists. Please sign in instead.');
    }

    return { ...data, needsEmailConfirmation: data.user && !data.session };
  };

  // Sign in - exactly like FARM-AGENT
  const signIn = async (email, password) => {
    const supabase = getSupabase();
    if (!supabase) throw new Error('Supabase not initialized');
    
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw error;
    return data;
  };

  // Sign out
  const signOut = async () => {
    const supabase = getSupabase();
    if (!supabase) throw new Error('Supabase not initialized');
    
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  // Reset password
  const resetPassword = async (email) => {
    const supabase = getSupabase();
    if (!supabase) throw new Error('Supabase not initialized');
    
    const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    if (error) throw error;
    return data;
  };

  // Sign in with Google - with automatic country check
  const signInWithGoogle = async () => {
    const supabase = getSupabase();
    if (!supabase) throw new Error('Supabase not initialized');
    
    // Redirect to root - Supabase will handle the token from URL hash
    const redirectTo = window.location.hostname === 'localhost' 
      ? `http://localhost:${window.location.port}`
      : window.location.origin;
    
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        queryParams: {
          access_type: 'offline',
          prompt: 'consent'
        }
      }
    });
    
    if (error) throw error;
    
    // Note: After OAuth redirect and auth state updates, CountryCheckMiddleware 
    // will automatically verify if user has country_code set in user_accounts
    // If not set, it will force CountrySetup modal before app proceeds
    return data;
  };
  
  // Helper: Check if user has country set in user_accounts
  const checkUserCountry = async (userId) => {
    const supabase = getSupabase();
    if (!supabase) return false;
    
    try {
      const { data, error } = await supabase
        .from('user_accounts')
        .select('country_code')
        .eq('user_id', userId)
        .single();
      
      if (error) return false;
      return data?.country_code !== null && data?.country_code !== undefined;
    } catch (error) {
      console.error('Error checking country:', error);
      return false;
    }
  };

  const value = {
    user,
    profile,
    loading,
    signUp,
    signIn,
    signOut,
    resetPassword,
    signInWithGoogle,
    checkUserCountry,
    loadProfile,
    updateProfile,
    uploadAvatar,
    getInitials,
    getDisplayName,
    getAvatarUrl,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export default AuthContext;

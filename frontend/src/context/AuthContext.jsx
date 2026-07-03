import React, { createContext, useContext, useState, useEffect } from 'react';
import { getSupabaseClient } from '../lib/supabase/client';
import { offlineAuthManager } from '../lib/offlineAuthManager';
import { syncManager } from '../lib/syncManager';

const AuthContext = createContext({});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [isRecoveryMode, setIsRecoveryMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isOfflineMode, setIsOfflineMode] = useState(!navigator.onLine);
  const [syncStatus, setSyncStatus] = useState({ status: 'idle', message: '' });

  // Initialize offline managers
  useEffect(() => {
    const initializeOfflineManagers = async () => {
      try {
        await offlineAuthManager.init();
        await syncManager.init();
        console.log('[AuthContext] Offline managers initialized');
      } catch (error) {
        console.error('[AuthContext] Failed to initialize offline managers:', error);
      }
    };

    initializeOfflineManagers();

    // Listen for online/offline changes
    const handleOnline = () => setIsOfflineMode(false);
    const handleOffline = () => setIsOfflineMode(true);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Subscribe to sync status changes
    const unsubscribeSyncStatus = syncManager.onSyncStateChange((state) => {
      setSyncStatus(state);
    });

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      unsubscribeSyncStatus();
    };
  }, []);

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

      // If profile exists, use it
      if (data) {
        setProfile(data);
        return data;
      }

      // Profile doesn't exist - create one from auth user metadata
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (authUser) {
        const newProfile = {
          id: authUser.id,
          email: authUser.email,
          full_name: authUser.user_metadata?.full_name || authUser.user_metadata?.name || '',
          avatar_url: authUser.user_metadata?.avatar_url || authUser.user_metadata?.picture || null,
        };

        console.log('📋 Profile not found for', authUser.email, '- Creating new profile...');

        // Try to insert into profiles table
        const { data: createdProfile, error: createError } = await supabase
          .from('profiles')
          .upsert(newProfile)
          .select()
          .single();

        if (!createError && createdProfile) {
          console.log('✅ Profile created successfully for', authUser.email);
          setProfile(createdProfile);
          return createdProfile;
        } else if (createError) {
          console.warn('⚠️ Could not create profile in database:', createError?.message);
        }

        // Fall back to using auth metadata as profile if database creation fails
        setProfile(newProfile);
        return newProfile;
      }

      return null;
    } catch (err) {
      console.warn('Error loading/creating profile:', err);
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

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('user-content')
      .upload(filePath, file, { upsert: true });

    if (uploadError) throw uploadError;

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('user-content')
      .getPublicUrl(filePath);

    // Update profile with new avatar URL
    await updateProfile({ avatar_url: publicUrl });

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

    // Get initial session - Supabase will automatically process OAuth tokens from URL
    supabase.auth.getSession().then(({ data: { session } }) => {
      const hashParams = new URLSearchParams((window.location.hash || '').replace(/^#/, ''));
      const isRecoveryFromUrl = hashParams.get('type') === 'recovery' || window.location.pathname === '/reset-password';

      setIsRecoveryMode(isRecoveryFromUrl);
      setUser(session?.user ?? null);
      if (session?.user) {
        loadProfile(session.user.id);
      }
      setLoading(false);
      
      // Clear hash after Supabase has processed it
      if (window.location.hash) {
        window.history.replaceState(null, '', window.location.pathname);
      }
    }).catch((err) => {
      console.error('Error getting session:', err);
      setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === 'PASSWORD_RECOVERY') {
          setIsRecoveryMode(true);
        }

        if (event === 'SIGNED_OUT') {
          setIsRecoveryMode(false);
        }

        setUser(session?.user ?? null);
        if (session?.user) {
          loadProfile(session.user.id);
        } else {
          setProfile(null);
        }
        setLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  // Sign up - exactly like FARM-AGENT
  const signUp = async (email, password, fullName, countryCode = 'US') => {
    const supabase = getSupabase();
    if (!supabase) throw new Error('Supabase not initialized');
    
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          country_code: countryCode,  // NEW: Pass country code to metadata
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

  // Sign in with offline support (check cache first)
  const signIn = async (email, password) => {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    
    // Try online Supabase auth first
    if (navigator.onLine) {
      const supabase = getSupabase();
      if (!supabase) throw new Error('Supabase not initialized');

      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        });

        if (error) throw error;

        // Cache the session for offline access
        await offlineAuthManager.cacheSession({
          email: normalizedEmail,
          userId: data.user.id,
          userMetadata: data.user.user_metadata || {},
          profile: profile,
          accessToken: data.session?.access_token
        });

        return data;
      } catch (error) {
        // If online login fails, fall back to offline cached session
        console.warn('[AuthContext] Online auth failed, trying offline cache:', error.message);
        return await offlineSignIn(normalizedEmail);
      }
    } else {
      // Offline - try cached session
      return await offlineSignIn(normalizedEmail);
    }
  };

  // Sign in with offline cache
  const offlineSignIn = async (email) => {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    console.log('[AuthContext] 📴 Attempting offline login for:', normalizedEmail);

    const cachedSession = await offlineAuthManager.getOfflineSession(normalizedEmail);

    if (!cachedSession) {
      throw new Error('No cached session found. Please sign in while online first.');
    }

    console.log('[AuthContext] ✅ Using offline cached session for:', normalizedEmail);

    // Set user from cache
    setUser({
      id: cachedSession.userId,
      email: cachedSession.email,
      user_metadata: cachedSession.userMetadata
    });

    // Load profile
    if (cachedSession.profile) {
      setProfile(cachedSession.profile);
    } else {
      await loadProfile(cachedSession.userId);
    }

    return {
      user: {
        id: cachedSession.userId,
        email: cachedSession.email,
        user_metadata: cachedSession.userMetadata
      },
      offlineMode: true,
      message: 'Logged in offline mode. Changes will sync when online.'
    };
  };

  // Queue an action for sync (WhatsApp-like)
  const queueAction = async (actionType, actionData) => {
    try {
      const queuedAction = await offlineAuthManager.queueOfflineAction(actionType, {
        ...actionData,
        userEmail: user?.email
      });

      console.log('[AuthContext] 📤 Action queued:', actionType);

      // If online, trigger immediate sync
      if (navigator.onLine && !syncManager.isSyncing) {
        setTimeout(() => syncManager.performSync(), 500);
      }

      return queuedAction;
    } catch (error) {
      console.error('[AuthContext] Failed to queue action:', error);
      throw error;
    }
  };

  // Get cached sessions for "recent logins" feature
  const getCachedSessions = async () => {
    try {
      const sessions = await offlineAuthManager.getAllCachedSessions();
      return sessions;
    } catch (error) {
      console.error('[AuthContext] Failed to get cached sessions:', error);
      return [];
    }
  };

  // Get sync status
  const getSyncStatus = async () => {
    return await syncManager.getSyncStatus();
  };

  // Manual sync trigger
  const manualSync = async () => {
    return await syncManager.manualSync();
  };

  // Sign out (clear offline session too)
  const signOut = async () => {
    const supabase = getSupabase();
    if (!supabase) throw new Error('Supabase not initialized');
    
    const { error } = await supabase.auth.signOut();
    
    // Clear offline session
    if (user?.email) {
      await offlineAuthManager.removeSession(user.email);
    }

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

  // Update password after recovery link session is established
  const updatePassword = async (newPassword) => {
    const supabase = getSupabase();
    if (!supabase) throw new Error('Supabase not initialized');

    const { data, error } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (error) throw error;
    setIsRecoveryMode(false);
    return data;
  };

  const clearRecoveryMode = () => {
    setIsRecoveryMode(false);
  };

  // Sign in with Google - exactly like FARM-AGENT
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
    return data;
  };

  const value = {
    user,
    profile,
    isRecoveryMode,
    loading,
    // Offline support
    isOfflineMode,
    syncStatus,
    queueAction,
    getCachedSessions,
    getSyncStatus,
    manualSync,
    offlineSignIn,
    // Auth methods
    signUp,
    signIn,
    signOut,
    resetPassword,
    updatePassword,
    clearRecoveryMode,
    signInWithGoogle,
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

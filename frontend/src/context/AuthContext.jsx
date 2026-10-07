import React, { createContext, useCallback, useContext, useState, useEffect } from 'react';
import { getSupabaseClient } from '../lib/supabase/client';
import { offlineAuthManager } from '../lib/offlineAuthManager';
import { syncManager } from '../lib/syncManager';
import { isNetworkAuthError } from '../lib/authErrors';
import { uploadToR2, resolveMediaValue } from '../services/r2StorageService';

const AuthContext = createContext({});

// Read the recovery-link markers synchronously at module load — supabase-js
// strips the #type=recovery hash while processing the link, so by the time
// getSession() resolves it is already gone and the app would land signed-in.
const openedFromRecoveryLink = (() => {
  if (typeof window === 'undefined') return false;
  try {
    const hash = new URLSearchParams((window.location.hash || '').replace(/^#/, ''));
    const query = new URLSearchParams(window.location.search || '');
    return hash.get('type') === 'recovery'
      || query.get('type') === 'recovery'
      || window.location.pathname === '/reset-password'
      || window.location.pathname === '/reset-pin'
      || query.get('flow') === 'pin';
  } catch (_) {
    return false;
  }
})();

export const useAuth = () => useContext(AuthContext);

// How long startup may wait on the network before the app stops showing the loading
// screen. getSession() waits for a token refresh when the stored access token has
// expired, and on a slow mobile connection that call can retry for a long time.
const SESSION_CHECK_TIMEOUT_MS = 4000;
const MFA_CHECK_TIMEOUT_MS = 5000;

const withTimeout = (promise, ms, label) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  Promise.resolve(promise).then(
    (value) => { clearTimeout(timer); resolve(value); },
    (error) => { clearTimeout(timer); reject(error); },
  );
});

// The session supabase-js persisted on this device, read without any network or lock.
// Only used to get past the loading screen when getSession() is slow: the real session
// (or a sign-out) still arrives through onAuthStateChange and replaces it.
const readStoredSessionUser = () => {
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && /^sb-.+-auth-token$/.test(key)) {
        const stored = JSON.parse(localStorage.getItem(key));
        if (stored?.user?.id) return stored.user;
      }
    }
  } catch (_) { /* storage unavailable or unreadable */ }
  return null;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [isRecoveryMode, setIsRecoveryMode] = useState(openedFromRecoveryLink);
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

      // If profile exists, use it (resolving an R2-backed avatar to a live URL)
      if (data) {
        const resolvedAvatarUrl = await resolveMediaValue(data.avatar_url);
        const resolvedData = resolvedAvatarUrl === data.avatar_url ? data : { ...data, avatar_url: resolvedAvatarUrl };
        setProfile(resolvedData);
        return resolvedData;
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

    const resolvedAvatarUrl = await resolveMediaValue(data.avatar_url);
    const resolvedData = resolvedAvatarUrl === data.avatar_url ? data : { ...data, avatar_url: resolvedAvatarUrl };
    setProfile(resolvedData);
    return resolvedData;
  };

  // Upload avatar
  const uploadAvatar = async (file) => {
    if (!user) throw new Error('Not authenticated');

    const supabase = getSupabase();
    if (!supabase) throw new Error('Supabase not initialized');

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Not authenticated');

    const result = await uploadToR2({ file, folder: 'avatars', accessToken: session.access_token });
    if (!result.success) throw new Error(result.error || 'Failed to upload avatar');

    // updateProfile stores the r2:// marker and resolves it to a live URL for the returned/state profile
    const updated = await updateProfile({ avatar_url: result.url });
    return updated.avatar_url;
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

  // Two-step verification. When the account has a verified authenticator factor but this
  // session has not proven it yet (assurance level aal1, next level aal2), the app shows
  // a code screen instead of the dashboard. status: 'unknown' while the check runs,
  // 'required' until the code is accepted, otherwise 'clear'.
  const [mfa, setMfa] = useState({ userId: null, status: 'unknown', factorId: null });

  const evaluateMfa = useCallback(async (forUserId) => {
    const client = getSupabaseClient();
    try {
      if (!client) throw new Error('Supabase not initialized');
      const { data, error } = await withTimeout(
        client.auth.mfa.getAuthenticatorAssuranceLevel(), MFA_CHECK_TIMEOUT_MS, 'Two-step level check');
      if (error) throw error;
      if (data?.currentLevel === 'aal1' && data?.nextLevel === 'aal2') {
        // The session already says a second step is owed. If looking up the factor is
        // slow, still require the code (verifyMfa finds the factor itself) rather than
        // leaving the app on the loading screen or letting the account through.
        let verified = null;
        try {
          const { data: factors } = await withTimeout(
            client.auth.mfa.listFactors(), MFA_CHECK_TIMEOUT_MS, 'Two-step factor lookup');
          verified = (factors?.totp || [])[0]; // `totp` lists verified factors only
        } catch (lookupErr) {
          console.warn('[AuthContext] Two-step factor lookup slow, requiring code anyway:', lookupErr?.message || lookupErr);
          setMfa({ userId: forUserId, status: 'required', factorId: null });
          return;
        }
        if (verified) {
          setMfa({ userId: forUserId, status: 'required', factorId: verified.id });
          return;
        }
      }
      setMfa({ userId: forUserId, status: 'clear', factorId: null });
    } catch (err) {
      // A check that merely timed out on a slow network is not "no second step": if the
      // session stored on this device lists a verified factor, still ask for the code.
      const storedFactors = readStoredSessionUser()?.factors;
      if (/timed out/.test(err?.message || '') && storedFactors?.some((f) => f.status === 'verified')) {
        console.warn('[AuthContext] Two-step check slow, requiring code:', err.message);
        setMfa({ userId: forUserId, status: 'required', factorId: null });
        return;
      }
      // Fail open: a device-cached (offline) user has no Supabase session to check, and a
      // broken check must not lock every account out of the app.
      console.warn('[AuthContext] Two-step check skipped:', err?.message || err);
      setMfa({ userId: forUserId, status: 'clear', factorId: null });
    }
  }, []);

  useEffect(() => {
    if (user?.id) evaluateMfa(user.id);
  }, [user?.id, evaluateMfa]);

  const mfaStatus = !user ? 'clear' : mfa.userId === user.id ? mfa.status : 'unknown';

  const verifyMfa = async (code) => {
    const client = getSupabase();
    let factorId = mfa.factorId;
    if (client && !factorId) {
      const { data: factors } = await client.auth.mfa.listFactors();
      factorId = (factors?.totp || [])[0]?.id || null;
    }
    if (!client || !factorId) throw new Error('No verification method is set up for this account.');
    const { error } = await client.auth.mfa.challengeAndVerify({
      factorId,
      code: String(code || '').replace(/\D/g, ''),
    });
    if (error) throw error;
    await evaluateMfa(user.id);
  };

  useEffect(() => {
    const supabase = getSupabase();
    
    if (!supabase) {
      console.warn('⚠️ Supabase not initialized. Setting loading to false.');
      setLoading(false);
      return;
    }

    // Get initial session - Supabase will automatically process OAuth tokens from URL.
    // Bounded: if it is still waiting on a token refresh after a few seconds, carry on
    // with the session stored on this device instead of holding the loading screen.
    // onAuthStateChange below delivers the real result (or a sign-out) when it lands.
    // Not while an OAuth / magic-link sign-in is being completed from the URL: no stored
    // session exists yet, so cutting the wait short would flash the landing page.
    const completingSignInFromUrl = /[#&?](access_token|code|error_description)=/.test(
      `${window.location.hash}${window.location.search}`);
    const sessionCheck = supabase.auth.getSession();
    (completingSignInFromUrl ? sessionCheck : withTimeout(sessionCheck, SESSION_CHECK_TIMEOUT_MS, 'Session check')).then(({ data: { session } }) => {
      // Never downgrade: PASSWORD_RECOVERY may already have fired.
      if (openedFromRecoveryLink) setIsRecoveryMode(true);
      setUser(session?.user ?? null);
      if (session?.user) {
        loadProfile(session.user.id);
      }
      setLoading(false);
      
      // Clear hash after Supabase has processed it
      if (window.location.hash) {
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
      }
    }).catch((err) => {
      console.warn('Session check slow or failed:', err?.message || err);
      const storedUser = readStoredSessionUser();
      if (storedUser) {
        if (openedFromRecoveryLink) setIsRecoveryMode(true);
        // Keep a user the listener has already set; otherwise use the stored one.
        setUser((current) => current ?? storedUser);
        loadProfile(storedUser.id);
      }
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

        if (session?.user && ['TOKEN_REFRESHED', 'USER_UPDATED', 'MFA_CHALLENGE_VERIFIED'].includes(event)) {
          const uid = session.user.id;
          setTimeout(() => evaluateMfa(uid), 0); // deferred: supabase-js must not be re-entered from this callback
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
        // Fall back to the cached session only when the network itself failed. A rejected
        // password (or any answer from Supabase) must never open the account. The explicit
        // "Quick Login" tap calls offlineSignIn() directly instead.
        if (!isNetworkAuthError(error)) throw error;
        console.warn('[AuthContext] Network unavailable, trying offline cache:', error.message);
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

  // Sign out on every device (Supabase revokes all of this account's sessions)
  const signOutEverywhere = async () => {
    const client = getSupabase();
    if (!client) throw new Error('Supabase not initialized');

    const { error } = await client.auth.signOut({ scope: 'global' });

    if (user?.email) {
      await offlineAuthManager.removeSession(user.email);
    }

    if (error) throw error;
  };

  // Reset password
  const resetPassword = async (email) => {
    const supabase = getSupabase();
    if (!supabase) throw new Error('Supabase not initialized');

    // Same as mybodaguy: Supabase's own Auth mailer sends the recovery email.
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

  // Sign in with a wallet account number (or phone) + PIN — verified
  // server-side by the wallet-login edge function (service role, never
  // exposes pin_hash), which hands back a magic-link token_hash we redeem
  // into a real session here. onAuthStateChange picks the session up from
  // there, same as every other sign-in method.
  const signInWithWallet = async (identifier, pin) => {
    const supabase = getSupabase();
    if (!supabase) throw new Error('Supabase not initialized');

    const { data, error } = await supabase.functions.invoke('wallet-login', {
      body: { identifier: String(identifier || '').trim(), pin: String(pin || '').trim() },
    });

    if (error) {
      // supabase-js only gives a generic "Edge Function returned a non-2xx
      // status code" here — the actual { success: false, error } body the
      // function sent lives on error.context (the raw Response object).
      const detail = await error.context?.json?.().catch(() => null);
      throw new Error(detail?.error || error.message);
    }
    if (!data?.success) throw new Error(data?.error || 'Wallet sign-in failed');

    const { data: otpData, error: otpError } = await supabase.auth.verifyOtp({
      token_hash: data.token_hash,
      type: 'email',
    });

    if (otpError) throw otpError;
    return otpData;
  };

  // Sign in with Google - exactly like FARM-AGENT
  const signInWithGoogle = async () => {
    const supabase = getSupabase();
    if (!supabase) throw new Error('Supabase not initialized');
    
    // Return to the exact page (path + query) the sign-in was started from,
    // not just the site root -- Supabase appends the token as a URL hash on
    // top of whatever we pass here, so this still lets the main app handle
    // that hash normally at "/", while a standalone public page (e.g. a
    // candidate's /candidate-test?token=... or /candidate-interview?scheduleId=...
    // link, see main.jsx's pathname-based routing) comes right back to
    // itself instead of stranding the visitor at the app root having lost
    // which test/interview/share link they were on.
    const redirectTo = window.location.hostname === 'localhost'
      ? `http://localhost:${window.location.port}${window.location.pathname}${window.location.search}`
      : `${window.location.origin}${window.location.pathname}${window.location.search}`;
    
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
    signInWithWallet,
    signOut,
    signOutEverywhere,
    mfaStatus,
    verifyMfa,
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

import React, { createContext, useState, useContext, useEffect, useRef } from 'react';
import { supabase } from '@/api/supabaseClient';

const AuthContext = createContext();

const PROFILE_CACHE_KEY = 'homi_profile';

// Nothing in the Supabase client times out on its own. When the backend stops
// answering, the profile request never settles — `isLoadingAuth` stays true and
// the app sits on its spinner forever with no way out but force-closing it.
const PROFILE_TIMEOUT_MS = 12000;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

// Cold-start fast path: hydrate from the cached profile so the app renders
// immediately, then revalidate against the DB in the background. Skipped when
// the user opted out of persistent sessions on a fresh browser start (that
// path signs out below).
function readCachedProfile() {
  try {
    const remember = localStorage.getItem('homi_remember') !== '0';
    const tabWasActive = sessionStorage.getItem('homi_tab_active');
    if (!remember && !tabWasActive) return null;
    return JSON.parse(localStorage.getItem(PROFILE_CACHE_KEY));
  } catch {
    return null;
  }
}

export const AuthProvider = ({ children }) => {
  const cachedProfile = readCachedProfile();
  const [user, setUser] = useState(cachedProfile || null);
  const [isAuthenticated, setIsAuthenticated] = useState(!!cachedProfile);
  const [isLoadingAuth, setIsLoadingAuth] = useState(!cachedProfile);

  // The profile for a given user is fetched once per app session. Both the
  // auth listener (INITIAL_SESSION) and getSession() fire on every launch, and
  // the listener fires again on each hourly token refresh — each of those used
  // to be its own profile request, landing on the database exactly while the
  // page's own queries were loading. A failed attempt is not remembered, so the
  // next event retries it.
  const profileRef = useRef({ userId: null, promise: null });
  const loadProfile = (userId) => {
    if (profileRef.current.userId === userId && profileRef.current.promise) {
      return profileRef.current.promise;
    }
    const promise = fetchProfile(userId).then((ok) => {
      if (!ok && profileRef.current.promise === promise) {
        profileRef.current = { userId: null, promise: null };
      }
    });
    profileRef.current = { userId, promise };
    return promise;
  };
  const forgetProfile = () => { profileRef.current = { userId: null, promise: null }; };

  useEffect(() => {
    // Capture BEFORE setting the flag — null means fresh browser start
    const tabWasActive = sessionStorage.getItem('homi_tab_active');
    sessionStorage.setItem('homi_tab_active', '1');

    // Listen for auth state changes (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        loadProfile(session.user.id);
      } else {
        forgetProfile();
        try { localStorage.removeItem(PROFILE_CACHE_KEY); } catch { /* ignore */ }
        setUser(null);
        setIsAuthenticated(false);
        setIsLoadingAuth(false);
      }
    });

    // Check current session on mount
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        const remember = localStorage.getItem('homi_remember') !== '0'; // default true
        if (!remember && !tabWasActive) {
          // Fresh browser start + user opted out of persistent session
          await supabase.auth.signOut();
          // onAuthStateChange will clean up state
        } else {
          loadProfile(session.user.id);
        }
      } else {
        forgetProfile();
        try { localStorage.removeItem(PROFILE_CACHE_KEY); } catch { /* ignore */ }
        setUser(null);
        setIsAuthenticated(false);
        setIsLoadingAuth(false);
      }
    });

    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchProfile = async (userId) => {
    let profile = null;
    let error = null;
    try {
      ({ data: profile, error } = await withTimeout(
        supabase
          .from('profiles')
          .select('id, role, linked_name, full_name')
          .eq('id', userId)
          .single(),
        PROFILE_TIMEOUT_MS,
      ));
    } catch (err) {
      error = err;
    }

    if (error || !profile) {
      console.error('Failed to fetch profile:', error);
      // A transient network failure shouldn't log out a user we already
      // hydrated from cache — only drop auth when we have nothing to show.
      setUser((current) => {
        if (!current) setIsAuthenticated(false);
        return current;
      });
      setIsLoadingAuth(false);
      return false;
    }
    try { localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(profile)); } catch { /* ignore */ }
    setUser(profile);
    setIsAuthenticated(true);
    setIsLoadingAuth(false);
    return true;
  };

  const logout = async () => {
    forgetProfile();
    await supabase.auth.signOut();
    try { localStorage.removeItem(PROFILE_CACHE_KEY); } catch { /* ignore */ }
    setUser(null);
    setIsAuthenticated(false);
  };

  // Update the current user's profile row and refresh local state.
  const updateProfile = async (fields) => {
    if (!user?.id) return { error: new Error('no-user') };
    const { data, error } = await supabase
      .from('profiles')
      .update(fields)
      .eq('id', user.id)
      .select('id, role, linked_name, full_name')
      .single();
    if (!error && data) {
      try { localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(data)); } catch { /* ignore */ }
      setUser(data);
    }
    return { data, error };
  };

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated,
      isLoadingAuth,
      logout,
      updateProfile,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

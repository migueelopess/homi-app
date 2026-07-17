import React, { createContext, useState, useContext, useEffect } from 'react';
import { supabase } from '@/api/supabaseClient';

const AuthContext = createContext();

const PROFILE_CACHE_KEY = 'homi_profile';

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

  useEffect(() => {
    // Capture BEFORE setting the flag — null means fresh browser start
    const tabWasActive = sessionStorage.getItem('homi_tab_active');
    sessionStorage.setItem('homi_tab_active', '1');

    // Listen for auth state changes (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        fetchProfile(session.user.id);
      } else {
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
          fetchProfile(session.user.id);
        }
      } else {
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
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('id, role, linked_name, full_name')
      .eq('id', userId)
      .single();

    if (error || !profile) {
      console.error('Failed to fetch profile:', error);
      // A transient network failure shouldn't log out a user we already
      // hydrated from cache — only drop auth when we have nothing to show.
      setUser((current) => {
        if (!current) setIsAuthenticated(false);
        return current;
      });
    } else {
      try { localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(profile)); } catch { /* ignore */ }
      setUser(profile);
      setIsAuthenticated(true);
    }
    setIsLoadingAuth(false);
  };

  const logout = async () => {
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

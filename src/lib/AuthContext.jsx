import React, { createContext, useState, useContext, useEffect } from 'react';
import { supabase } from '@/api/supabaseClient';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);

  useEffect(() => {
    // Capture BEFORE setting the flag — null means fresh browser start
    const tabWasActive = sessionStorage.getItem('homi_tab_active');
    sessionStorage.setItem('homi_tab_active', '1');

    // Listen for auth state changes (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        fetchProfile(session.user.id);
      } else {
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
        setIsLoadingAuth(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const fetchProfile = async (userId) => {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('id, role, linked_name, full_name')
      .eq('id', userId)
      .single();

    if (error || !profile) {
      console.error('Failed to fetch profile:', error);
      setUser(null);
      setIsAuthenticated(false);
    } else {
      setUser(profile);
      setIsAuthenticated(true);
    }
    setIsLoadingAuth(false);
  };

  const logout = async () => {
    await supabase.auth.signOut();
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
    if (!error && data) setUser(data);
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

/**
 * Qavora Android — Dedicated Authentication Context (Phase 1B)
 *
 * Provides reactive authentication state (`user`, `isAuthenticated`, `isLoading`,
 * `login`, `register`, `logout`, `restoreSession`) without modifying WorkspaceContext.
 *
 * Protects authenticated application functionality from being treated as available
 * before `restoreSession()` finishes on application startup.
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from 'react';
import { onUnauthorizedResponse } from '../services/apiClient.js';
import {
  registerUser,
  loginUser,
  logoutUser,
  restoreAuthenticatedSession,
  fetchCurrentUser,
  formatAuthErrorMessage,
} from '../services/authService.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRestoringSession, setIsRestoringSession] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [authNotice, setAuthNotice] = useState(null);

  const clearAuthFeedback = useCallback(() => {
    setAuthError(null);
    setAuthNotice(null);
  }, []);

  /**
   * Restores session on app startup or manual re-verification using `GET /api/auth/me`.
   */
  const restoreSession = useCallback(async (options = {}) => {
    setIsLoading(true);
    setAuthError(null);

    try {
      const result = await restoreAuthenticatedSession(options);

      if (result.ok && result.user) {
        setUser(result.user);
        return result;
      }

      setUser(null);
      if (result.isExpired) {
        setAuthNotice(
          formatAuthErrorMessage(
            { status: 401, error: result.error },
            'session'
          )
        );
      }
      return result;
    } finally {
      setIsRestoringSession(false);
      setIsLoading(false);
    }
  }, []);

  // Automatically restore session when the application starts
  useEffect(() => {
    let mounted = true;
    (async () => {
      await restoreSession();
      if (!mounted) return;
    })();
    return () => {
      mounted = false;
    };
  }, [restoreSession]);

  // Listen for 401 Unauthorized responses from any protected API request
  useEffect(() => {
    const unsubscribe = onUnauthorizedResponse((info) => {
      setUser(null);
      setIsLoading(false);
      setIsRestoringSession(false);
      setAuthNotice(
        formatAuthErrorMessage(
          { status: 401, message: info && info.message },
          'session'
        )
      );
    });
    return unsubscribe;
  }, []);

  /**
   * Authenticates user via `POST /api/auth/login`.
   */
  const login = useCallback(async (credentialsOrEmail, optionalPassword) => {
    setIsLoading(true);
    setAuthError(null);
    setAuthNotice(null);

    try {
      const result = await loginUser(credentialsOrEmail, optionalPassword);
      if (result.ok && result.user) {
        setUser(result.user);
        return result;
      }
      setUser(null);
      setAuthError(formatAuthErrorMessage(result, 'login'));
      return result;
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Registers a new user via `POST /api/auth/register`.
   */
  const register = useCallback(
    async (payloadOrName, optionalEmail, optionalPassword, optionalRole) => {
      setIsLoading(true);
      setAuthError(null);
      setAuthNotice(null);

      try {
        const result = await registerUser(
          payloadOrName,
          optionalEmail,
          optionalPassword,
          optionalRole
        );
        if (result.ok && result.user) {
          setUser(result.user);
          return result;
        }
        setUser(null);
        setAuthError(formatAuthErrorMessage(result, 'register'));
        return result;
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  /**
   * Logs out the current user via CSRF-protected `POST /api/auth/logout`.
   */
  const logout = useCallback(async () => {
    setIsLoading(true);
    setAuthError(null);

    try {
      const result = await logoutUser();
      setUser(null);
      setAuthNotice('You have been signed out.');
      return result;
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Explicitly refreshes current user profile via `GET /api/auth/me`.
   */
  const refreshCurrentUser = useCallback(async () => {
    const result = await fetchCurrentUser();
    if (result.ok && result.user) {
      setUser(result.user);
    } else if (result.isExpired) {
      setUser(null);
      setAuthNotice(
        result.error || 'Your session has expired. Please sign in again.'
      );
    }
    return result;
  }, []);

  const isAuthenticated = Boolean(!isRestoringSession && user && user.userId);

  const value = useMemo(
    () => ({
      user,
      isAuthenticated,
      isLoading,
      isRestoringSession,
      authError,
      authNotice,
      login,
      register,
      logout,
      restoreSession,
      refreshCurrentUser,
      clearAuthFeedback,
    }),
    [
      user,
      isAuthenticated,
      isLoading,
      isRestoringSession,
      authError,
      authNotice,
      login,
      register,
      logout,
      restoreSession,
      refreshCurrentUser,
      clearAuthFeedback,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export default AuthContext;

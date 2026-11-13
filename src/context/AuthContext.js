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
  useRef,
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
  const [authNoticeType, setAuthNoticeType] = useState(null); // 'logout' | 'session_expired' | null
  const isLoggingOutRef = useRef(false);

  const clearAuthFeedback = useCallback(() => {
    setAuthError(null);
    setAuthNotice(null);
    setAuthNoticeType(null);
  }, []);

  /**
   * Restores session on app startup or manual re-verification using `GET /api/auth/me`.
   */
  const restoreSession = useCallback(async (options = {}) => {
    setIsLoading(true);
    setAuthError(null);
    setAuthNotice(null);
    setAuthNoticeType(null);

    try {
      const result = await restoreAuthenticatedSession(options);

      if (result.ok && result.user) {
        setUser(result.user);
        setAuthError(null);
        setAuthNotice(null);
        setAuthNoticeType(null);
        return result;
      }

      setUser(null);
      if (result.isExpired) {
        setAuthNoticeType('session_expired');
        setAuthNotice(
          formatAuthErrorMessage(
            { status: 401, error: result.error },
            'session'
          )
        );
      } else if (
        result.reason === 'UNCONFIGURED_BASE_URL' ||
        result.code === 'INVALID_BASE_URL' ||
        result.code === 'INSECURE_PRODUCTION_URL'
      ) {
        setAuthError(
          result.error ||
            formatAuthErrorMessage(
              { code: result.code || 'INVALID_BASE_URL' },
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
      if (isLoggingOutRef.current) {
        return;
      }
      setUser(null);
      setIsLoading(false);
      setIsRestoringSession(false);
      setAuthError(null);
      setAuthNoticeType('session_expired');
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
    setAuthNoticeType(null);

    try {
      const result = await loginUser(credentialsOrEmail, optionalPassword);
      if (result.ok && result.user) {
        setUser(result.user);
        setAuthError(null);
        setAuthNotice(null);
        setAuthNoticeType(null);
        return result;
      }
      setUser(null);
      setAuthNotice(null);
      setAuthNoticeType(null);
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
      setAuthNoticeType(null);

      try {
        const result = await registerUser(
          payloadOrName,
          optionalEmail,
          optionalPassword,
          optionalRole
        );
        if (result.ok && result.user) {
          setUser(result.user);
          setAuthError(null);
          setAuthNotice(null);
          setAuthNoticeType(null);
          return result;
        }
        setUser(null);
        setAuthNotice(null);
        setAuthNoticeType(null);
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
    isLoggingOutRef.current = true;
    setIsLoading(true);
    setAuthError(null);
    setAuthNotice(null);
    setAuthNoticeType(null);

    try {
      const result = await logoutUser();
      setUser(null);
      setAuthError(null);
      setAuthNoticeType('logout');
      setAuthNotice('You have been signed out.');
      return result;
    } finally {
      isLoggingOutRef.current = false;
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
      setAuthError(null);
      setAuthNoticeType('session_expired');
      setAuthNotice(
        formatAuthErrorMessage(
          { status: 401, error: result.error },
          'session'
        )
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
      authNoticeType,
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
      authNoticeType,
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

/**
 * Qavora Android — Authentication Service (Phase 1B)
 *
 * Implements the exact authentication contracts of the Qavora Web
 * Express 5 + MongoDB 7 backend (`server.ts` & `authController.js`):
 * - `POST /api/auth/register`
 * - `POST /api/auth/login`
 * - `POST /api/auth/logout`
 * - `GET /api/auth/csrf`
 * - `GET /api/auth/me`
 *
 * Security Rules:
 * - Never stores passwords or exposes HttpOnly authentication tokens.
 * - Relies on persistent cookie + CSRF management (`cookieManager` & `apiClient`).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  apiClient,
  apiGet,
  apiPost,
  getApiBaseUrl,
  ApiClientError,
} from './apiClient.js';
import {
  cookieManager,
  ensureCookieJarHydrated,
  hasAuthCookie,
  getCsrfToken,
  clearAllCookies,
} from './cookieManager.js';

export const AUTH_USER_STORAGE_KEY = '@qavora_auth_user_v1';
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let customUserStorageAdapter = null;

function getStorage() {
  if (customUserStorageAdapter) {
    return customUserStorageAdapter;
  }
  return AsyncStorage;
}

/**
 * Allows injecting a storage adapter for deterministic Node verification tests.
 */
export function setAuthUserStorageAdapter(adapter) {
  customUserStorageAdapter = adapter;
}

/**
 * Sanitizes a user profile object so only safe, non-sensitive fields matching
 * `SafeUserProfile` in `server.ts` are retained.
 *
 * @param {any} rawUser
 * @returns {object | null}
 */
export function sanitizeUserProfile(rawUser) {
  if (!rawUser || typeof rawUser !== 'object') {
    return null;
  }

  const userId = rawUser.userId ? String(rawUser.userId).trim() : '';
  const email = rawUser.email ? String(rawUser.email).trim().toLowerCase() : '';
  const name = rawUser.name ? String(rawUser.name).trim() : '';

  if (!userId || !email || !name) {
    return null;
  }

  const parts = name.split(/\s+/).filter(Boolean);
  const fallbackInitials =
    parts.length === 1
      ? parts[0].slice(0, 2).toUpperCase()
      : `${parts[0][0] || 'Q'}${parts[parts.length - 1][0] || 'A'}`.toUpperCase();

  return {
    userId,
    email,
    name,
    role: rawUser.role ? String(rawUser.role).trim() : 'QA Tester',
    avatarInitials: rawUser.avatarInitials
      ? String(rawUser.avatarInitials).trim()
      : fallbackInitials,
    createdAt: rawUser.createdAt ? String(rawUser.createdAt) : '',
    updatedAt: rawUser.updatedAt ? String(rawUser.updatedAt) : '',
    lastLoginAt: rawUser.lastLoginAt ? String(rawUser.lastLoginAt) : '',
    preferences:
      rawUser.preferences && typeof rawUser.preferences === 'object'
        ? rawUser.preferences
        : {},
  };
}

/**
 * Saves safe user metadata to AsyncStorage.
 *
 * @param {object} user
 */
export async function saveCachedUserProfile(user) {
  const safeUser = sanitizeUserProfile(user);
  if (!safeUser) {
    return null;
  }
  try {
    const storage = getStorage();
    if (storage && typeof storage.setItem === 'function') {
      await storage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(safeUser));
    }
  } catch {
    // Ignore storage persistence errors
  }
  return safeUser;
}

/**
 * Reads cached safe user metadata from AsyncStorage.
 *
 * @returns {Promise<object | null>}
 */
export async function loadCachedUserProfile() {
  try {
    const storage = getStorage();
    if (storage && typeof storage.getItem === 'function') {
      const raw = await storage.getItem(AUTH_USER_STORAGE_KEY);
      if (raw) {
        return sanitizeUserProfile(JSON.parse(raw));
      }
    }
  } catch {
    // Ignore corrupted cache
  }
  return null;
}

/**
 * Removes cached user metadata from AsyncStorage.
 */
export async function clearCachedUserProfile() {
  try {
    const storage = getStorage();
    if (storage && typeof storage.removeItem === 'function') {
      await storage.removeItem(AUTH_USER_STORAGE_KEY);
    }
  } catch {
    // Ignore storage removal errors
  }
}

/**
 * Fetches or refreshes a session-bound CSRF token via `GET /api/auth/csrf`.
 *
 * @param {object} [options]
 * @returns {Promise<{ ok: boolean, status: number | null, csrfToken: string | null, error?: string }>}
 */
export async function fetchCsrfToken(options = {}) {
  try {
    const response = await apiGet('/api/auth/csrf', {
      ...options,
      _skipCsrfRefresh: true,
    });
    const csrfToken =
      (response.data && typeof response.data.csrfToken === 'string' && response.data.csrfToken) ||
      getCsrfToken();

    return {
      ok: Boolean(csrfToken),
      status: response.status,
      csrfToken: csrfToken || null,
    };
  } catch (err) {
    const isApiErr = err instanceof ApiClientError;
    return {
      ok: false,
      status: isApiErr ? err.status : null,
      csrfToken: null,
      error: (err && err.message) || 'Failed to issue CSRF token.',
    };
  }
}

/**
 * Registers a new user account via `POST /api/auth/register`.
 * Supports `registerUser({ name, email, password, role })` or positional args.
 *
 * @param {object | string} payloadOrName
 * @param {string} [optionalEmail]
 * @param {string} [optionalPassword]
 * @param {string} [optionalRole]
 * @param {object} [requestOptions]
 */
export async function registerUser(
  payloadOrName,
  optionalEmail,
  optionalPassword,
  optionalRole,
  requestOptions = {}
) {
  let name = '';
  let email = '';
  let password = '';
  let role = 'QA Tester';
  let options = requestOptions;

  if (payloadOrName && typeof payloadOrName === 'object') {
    name = payloadOrName.name || '';
    email = payloadOrName.email || '';
    password = payloadOrName.password || '';
    role = payloadOrName.role || 'QA Tester';
    if (optionalEmail && typeof optionalEmail === 'object') {
      options = optionalEmail;
    }
  } else {
    name = payloadOrName || '';
    email = optionalEmail || '';
    password = optionalPassword || '';
    role = optionalRole || 'QA Tester';
  }

  const trimmedName = typeof name === 'string' ? name.trim() : '';
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  const cleanRole =
    typeof role === 'string' && role.trim() ? role.trim() : 'QA Tester';

  if (!trimmedName) {
    return {
      ok: false,
      status: 400,
      user: null,
      error: 'Full name is required and must be a non-empty string.',
    };
  }

  if (!normalizedEmail || !EMAIL_REGEX.test(normalizedEmail)) {
    return {
      ok: false,
      status: 400,
      user: null,
      error: 'A valid email address is required.',
    };
  }

  if (typeof password !== 'string' || password.length < 8) {
    return {
      ok: false,
      status: 400,
      user: null,
      error: 'Password must be at least 8 characters long.',
    };
  }

  try {
    const response = await apiPost(
      '/api/auth/register',
      {
        name: trimmedName,
        email: normalizedEmail,
        password,
        role: cleanRole,
      },
      options
    );

    const safeUser = sanitizeUserProfile(response.data && response.data.user);
    if (!safeUser) {
      return {
        ok: false,
        status: response.status,
        user: null,
        error: 'Registration response did not include a valid user profile.',
      };
    }

    // Ensure CSRF token is available in cookie jar for subsequent mutations
    if (!getCsrfToken() && hasAuthCookie()) {
      await fetchCsrfToken(options);
    }

    await saveCachedUserProfile(safeUser);

    return {
      ok: true,
      status: response.status,
      user: safeUser,
      error: null,
    };
  } catch (err) {
    const isApiErr = err instanceof ApiClientError;
    return {
      ok: false,
      status: isApiErr ? err.status : 0,
      user: null,
      error: (err && err.message) || 'Failed to register user.',
      code: isApiErr ? err.code : 'REGISTER_ERROR',
      isNetworkError: isApiErr ? err.isNetworkError : false,
    };
  }
}

/**
 * Logs in an existing user via `POST /api/auth/login`.
 * Supports `loginUser({ email, password })` or `loginUser(email, password)`.
 *
 * @param {object | string} credentialsOrEmail
 * @param {string | object} [optionalPassword]
 * @param {object} [requestOptions]
 */
export async function loginUser(
  credentialsOrEmail,
  optionalPassword,
  requestOptions = {}
) {
  let email = '';
  let password = '';
  let options = requestOptions;

  if (credentialsOrEmail && typeof credentialsOrEmail === 'object') {
    email = credentialsOrEmail.email || '';
    password = credentialsOrEmail.password || '';
    if (optionalPassword && typeof optionalPassword === 'object') {
      options = optionalPassword;
    }
  } else {
    email = credentialsOrEmail || '';
    password = typeof optionalPassword === 'string' ? optionalPassword : '';
  }

  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

  if (!normalizedEmail || typeof password !== 'string' || password === '') {
    return {
      ok: false,
      status: 400,
      user: null,
      error: 'Email and password are required.',
    };
  }

  try {
    const response = await apiPost(
      '/api/auth/login',
      {
        email: normalizedEmail,
        password,
      },
      options
    );

    const safeUser = sanitizeUserProfile(response.data && response.data.user);
    if (!safeUser) {
      return {
        ok: false,
        status: response.status,
        user: null,
        error: 'Login response did not include a valid user profile.',
      };
    }

    // Ensure CSRF cookie/token is available for subsequent mutations
    if (!getCsrfToken() && hasAuthCookie()) {
      await fetchCsrfToken(options);
    }

    await saveCachedUserProfile(safeUser);

    return {
      ok: true,
      status: response.status,
      user: safeUser,
      error: null,
    };
  } catch (err) {
    await clearAllCookies();
    await clearCachedUserProfile();
    const isApiErr = err instanceof ApiClientError;
    return {
      ok: false,
      status: isApiErr ? err.status : 0,
      user: null,
      error: (err && err.message) || 'Invalid email or password.',
      code: isApiErr ? err.code : 'LOGIN_ERROR',
      isNetworkError: isApiErr ? err.isNetworkError : false,
    };
  }
}

/**
 * Retrieves the currently authenticated user profile from `GET /api/auth/me`.
 *
 * @param {object} [options]
 */
export async function fetchCurrentUser(options = {}) {
  try {
    const response = await apiGet('/api/auth/me', options);
    const safeUser = sanitizeUserProfile(response.data && response.data.user);
    if (!safeUser) {
      return {
        ok: false,
        status: response.status,
        user: null,
        error: 'Invalid user profile returned from /api/auth/me.',
      };
    }

    await saveCachedUserProfile(safeUser);

    return {
      ok: true,
      status: response.status,
      user: safeUser,
      error: null,
    };
  } catch (err) {
    const isApiErr = err instanceof ApiClientError;
    const status = isApiErr ? err.status : 0;

    if (status === 401) {
      await clearAllCookies();
      await clearCachedUserProfile();
    }

    return {
      ok: false,
      status,
      user: null,
      isExpired: status === 401,
      isNetworkError: isApiErr ? err.isNetworkError : false,
      error: (err && err.message) || 'Failed to verify session.',
    };
  }
}

/**
 * Restores an existing session on application startup by hydrating persistent
 * cookies and verifying the session against `GET /api/auth/me`.
 *
 * @param {object} [options]
 */
export async function restoreAuthenticatedSession(options = {}) {
  await ensureCookieJarHydrated();
  const cachedUser = await loadCachedUserProfile();
  const baseUrl = getApiBaseUrl(options.baseUrl);

  // If no backend base URL is configured, cannot verify remote session
  if (!baseUrl) {
    return {
      ok: false,
      status: null,
      user: null,
      isExpired: false,
      reason: 'UNCONFIGURED_BASE_URL',
    };
  }

  const isBrowserDom =
    typeof window !== 'undefined' && typeof document !== 'undefined';

  // In React Native / non-DOM environments, if no auth cookie is stored, skip network call
  if (!isBrowserDom && !hasAuthCookie()) {
    if (cachedUser) {
      await clearCachedUserProfile();
    }
    return {
      ok: false,
      status: null,
      user: null,
      isExpired: false,
      reason: 'NO_STORED_SESSION',
    };
  }

  const meResult = await fetchCurrentUser({
    ...options,
    suppressUnauthorizedEvent: true,
  });

  if (meResult.ok && meResult.user) {
    // Ensure a valid CSRF token is present for mutations in the restored session
    if (!getCsrfToken()) {
      await fetchCsrfToken({
        ...options,
        suppressUnauthorizedEvent: true,
      });
    }
    return {
      ok: true,
      status: meResult.status,
      user: meResult.user,
      isExpired: false,
      error: null,
    };
  }

  if (meResult.status === 401) {
    await clearAllCookies();
    await clearCachedUserProfile();
    return {
      ok: false,
      status: 401,
      user: null,
      isExpired: true,
      error:
        meResult.error ||
        'Your session has expired or been revoked. Please sign in again.',
    };
  }

  // Offline-first fallback: if the device is offline or the backend is unreachable
  // (network error, not 401) and both a valid auth cookie and cached user profile exist,
  // restore the cached user profile so offline project data and sync queues remain accessible.
  if (
    cachedUser &&
    hasAuthCookie() &&
    (meResult.isNetworkError || meResult.status === 0)
  ) {
    return {
      ok: true,
      status: 0,
      user: cachedUser,
      isExpired: false,
      offlineRestored: true,
      isNetworkError: true,
      error: null,
    };
  }

  return {
    ok: false,
    status: meResult.status,
    user: null,
    isExpired: false,
    isNetworkError: Boolean(meResult.isNetworkError),
    error: meResult.error || 'Unable to verify session with server.',
  };
}

/**
 * Logs out the current user via CSRF-protected `POST /api/auth/logout` and clears
 * all local authentication cookies and cached user metadata.
 *
 * @param {object} [options]
 */
export async function logoutUser(options = {}) {
  await ensureCookieJarHydrated();

  let serverStatus = null;
  let serverError = null;

  try {
    if (hasAuthCookie() && !getCsrfToken()) {
      await fetchCsrfToken({
        ...options,
        suppressUnauthorizedEvent: true,
      });
    }

    const response = await apiPost(
      '/api/auth/logout',
      {},
      {
        ...options,
        suppressUnauthorizedEvent: true,
      }
    );
    serverStatus = response.status;
  } catch (err) {
    const isApiErr = err instanceof ApiClientError;
    serverStatus = isApiErr ? err.status : 0;
    serverError = (err && err.message) || 'Logout request failed.';
  } finally {
    await clearAllCookies();
    await clearCachedUserProfile();
  }

  return {
    ok: true,
    status: serverStatus,
    serverError,
  };
}

export const authService = {
  register: registerUser,
  login: loginUser,
  logout: logoutUser,
  fetchCurrentUser,
  fetchCsrfToken,
  restoreSession: restoreAuthenticatedSession,
  loadCachedUserProfile,
  clearCachedUserProfile,
  cookieManager,
  apiClient,
};

export default authService;

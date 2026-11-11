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

  const resolvedId = rawUser.userId || rawUser.id || rawUser._id;
  const userId = resolvedId ? String(resolvedId).trim() : '';
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
    id: userId,
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

let lastAuthDebugDiagnostic = null;

/**
 * Redacts sensitive tokens, cookies, JWTs, CSRF tokens, passwords, database URIs,
 * internal file paths, and stack frames from any diagnostic or error string.
 *
 * Guarantees that JWTs, session cookies, CSRF tokens, MongoDB connection strings,
 * and internal stack traces never appear in user-facing messages or debug logs.
 *
 * @param {string} rawText
 * @returns {string}
 */
export function sanitizeSensitiveDiagnosticText(rawText) {
  if (typeof rawText !== 'string' || !rawText) {
    return '';
  }

  let sanitized = rawText;

  // 1. Strip stack trace lines
  sanitized = sanitized.replace(/\r?\n\s*at\s+[^\r\n]+/g, '');
  sanitized = sanitized.replace(/\b(?:at\s+)[A-Za-z0-9_$.<>]+\s*\([^)]*\)/g, '');

  // 2. Redact JWTs (header.payload.signature)
  sanitized = sanitized.replace(
    /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g,
    '[REDACTED_JWT]'
  );

  // 3. Redact Bearer tokens
  sanitized = sanitized.replace(
    /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,
    'Bearer [REDACTED]'
  );

  // 4. Redact Qavora session and CSRF cookies or generic Set-Cookie values
  sanitized = sanitized.replace(
    /(__Host-)?qavora_(session|csrf|token|auth)\s*=\s*[^;\s"'&,]+/gi,
    '[REDACTED_COOKIE]'
  );
  sanitized = sanitized.replace(
    /\b(set-cookie|cookie|x-csrf-token|csrf-token|csrftoken|authorization|password| passwordHash|secret|jwt)\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;}\]]+)/gi,
    '$1=[REDACTED]'
  );

  // 5. Redact hex/base64-like long tokens following token/key labels
  sanitized = sanitized.replace(
    /\b(token|csrf|session|signature|key)\s*[:=]\s*[A-Za-z0-9._-]{16,}/gi,
    '$1=[REDACTED]'
  );

  // 6. Redact database connection strings (mongodb://, mongodb+srv://, postgres://, redis://)
  sanitized = sanitized.replace(
    /\b(mongodb(?:\+srv)?|postgres(?:ql)?|redis):\/\/[^\s"'<>]+/gi,
    '[REDACTED_DB_URI]'
  );

  // 7. Redact internal server file paths
  sanitized = sanitized.replace(
    /(?:\/var\/task\/|\/app\/|\/Users\/|\/home\/|\/opt\/|[A-Z]:\\)[^\s:)"',]+/g,
    '[INTERNAL_PATH]'
  );

  // 8. Redact raw MongoDB collection/index duplicate key internals
  sanitized = sanitized.replace(
    /E11000 duplicate key error[^\r\n]*/gi,
    'Duplicate account record'
  );

  return sanitized.trim();
}

/**
 * Builds and records a sanitized development diagnostic entry without exposing
 * sensitive tokens, cookies, passwords, database details, or stack traces.
 *
 * @param {any} errOrResult
 * @param {string} [context='auth']
 * @returns {object}
 */
export function buildSafeDebugDiagnostics(errOrResult, context = 'auth') {
  const isObj = Boolean(errOrResult && typeof errOrResult === 'object');
  const status = isObj && typeof errOrResult.status === 'number' ? errOrResult.status : null;
  const code =
    (isObj && typeof errOrResult.code === 'string' && errOrResult.code) ||
    (status ? `HTTP_${status}` : 'AUTH_ERROR');
  const isNetworkError = Boolean(isObj && errOrResult.isNetworkError);
  const isTimeout = Boolean(isObj && errOrResult.isTimeout);

  const rawMsg =
    typeof errOrResult === 'string'
      ? errOrResult
      : isObj
      ? errOrResult.error || errOrResult.message || ''
      : '';

  const sanitizedSummary = sanitizeSensitiveDiagnosticText(String(rawMsg || '')).slice(
    0,
    240
  );

  const diagnostic = {
    context,
    status,
    code,
    isNetworkError,
    isTimeout,
    sanitizedSummary,
    timestamp: new Date().toISOString(),
  };

  lastAuthDebugDiagnostic = diagnostic;
  return diagnostic;
}

/**
 * Returns the most recent sanitized authentication diagnostic for development debugging.
 *
 * @returns {object | null}
 */
export function getLastAuthDebugDiagnostic() {
  return lastAuthDebugDiagnostic;
}

/**
 * Maps raw API errors, HTTP statuses, network/timeout failures, and backend
 * responses into safe, clear, actionable user-facing messages.
 *
 * Preserves meaningful HTTP status handling (400, 401, 403, 409, 429, 5xx) and
 * field-level validation feedback while never exposing JWTs, cookies, CSRF tokens,
 * internal URLs, stack traces, or database/server implementation details.
 *
 * @param {any} errOrResult
 * @param {'login' | 'register' | 'session' | 'health' | 'logout'} [context='login']
 * @returns {string}
 */
export function formatAuthErrorMessage(errOrResult, context = 'login') {
  const isObj = Boolean(errOrResult && typeof errOrResult === 'object');
  const status =
    isObj && typeof errOrResult.status === 'number' ? errOrResult.status : null;
  const code =
    isObj && typeof errOrResult.code === 'string'
      ? errOrResult.code.trim().toUpperCase()
      : '';
  const isTimeout = Boolean(
    (isObj && errOrResult.isTimeout) ||
      code === 'REQUEST_TIMEOUT' ||
      status === 408 ||
      status === 504
  );
  const isNetworkError = Boolean(
    (isObj && errOrResult.isNetworkError) ||
      code === 'NETWORK_ERROR' ||
      status === 0
  );

  const rawMessage =
    typeof errOrResult === 'string'
      ? errOrResult
      : isObj
      ? String(
          errOrResult.userMessage ||
            errOrResult.error ||
            errOrResult.message ||
            ''
        )
      : '';

  const sanitized = sanitizeSensitiveDiagnosticText(rawMessage);
  const lower = sanitized.toLowerCase();

  // 1. Timeout handling
  if (isTimeout || /\btimed?\s*out\b/i.test(lower)) {
    if (context === 'health') {
      return 'Server connection timed out. Tap Check to retry.';
    }
    return 'The server took too long to respond. Please check your internet connection and try again.';
  }

  // 2. Network / offline connectivity handling (only when no HTTP status >= 400 was returned)
  if (
    isNetworkError ||
    ((status === null || status === 0) &&
      /\b(network request failed|fetch failed|failed to fetch|network error|econnrefused|enotfound|ehostunreach|econnreset|socket hang up|offline|unable to resolve host)\b/i.test(
        lower
      ))
  ) {
    if (context === 'health') {
      return 'Unable to reach the Qavora server. Check your internet connection.';
    }
    return 'Unable to connect to the Qavora server. Please check your internet connection and try again.';
  }

  // 3. Configuration errors
  if (
    code === 'INVALID_BASE_URL' ||
    code === 'INSECURE_PRODUCTION_URL' ||
    code === 'UNCONFIGURED_BASE_URL' ||
    /\b(expo_public_api_base_url|invalid api base url|insecure_production_url)\b/i.test(
      lower
    )
  ) {
    if (context === 'health') {
      return 'Server connection URL is not configured properly.';
    }
    return 'The Qavora server connection is not configured properly. Please check the application environment settings.';
  }

  // 4. HTTP 429 Rate Limit
  if (
    status === 429 ||
    code === 'HTTP_429' ||
    code === 'RATE_LIMITED' ||
    code === 'TOO_MANY_REQUESTS' ||
    /\b(too many requests|too many.*attempts|rate limit|slow down)\b/i.test(lower)
  ) {
    return 'Too many authentication attempts. Please wait a moment before trying again.';
  }

  // 5. HTTP 409 Conflict / Duplicate Account
  if (
    status === 409 ||
    code === 'HTTP_409' ||
    code === 'DUPLICATE_EMAIL' ||
    code === 'USER_ALREADY_EXISTS' ||
    /\b(already exists|already registered|already in use|email.*taken|duplicate account record|e11000)\b/i.test(
      lower
    )
  ) {
    return 'An account with this email address already exists. Please sign in or use a different email address.';
  }

  // 6. HTTP 401 Unauthorized / Invalid Credentials / Session Expired
  if (
    status === 401 ||
    code === 'HTTP_401' ||
    /\b(invalid email or password|invalid credentials|incorrect password|wrong password|authentication failed)\b/i.test(
      lower
    )
  ) {
    if (context === 'session') {
      return 'Your session has expired or is no longer valid. Please sign in again.';
    }
    if (context === 'register') {
      return 'Authentication failed while creating your account. Please verify your details and try again.';
    }
    return 'Invalid email or password. Please check your credentials and try again.';
  }

  if (
    context === 'session' &&
    /\b(session.*expired|session.*revoked|unauthorized|not authenticated|sign in again)\b/i.test(
      lower
    )
  ) {
    return 'Your session has expired or is no longer valid. Please sign in again.';
  }

  // 7. HTTP 403 Forbidden (Trusted Origin / CSRF / Security Policy)
  if (
    status === 403 ||
    code === 'HTTP_403' ||
    /\b(forbidden|cross-origin request rejected|origin header required|csrf)\b/i.test(
      lower
    )
  ) {
    if (/\bcsrf\b/i.test(lower)) {
      return 'Your security verification token expired (HTTP 403). Please try submitting again.';
    }
    if (/\b(cross-origin|origin)\b/i.test(lower)) {
      return 'Request origin was rejected by the server (HTTP 403). Please verify your application configuration and try again.';
    }
    return 'Access was denied by the server security policy (HTTP 403). Please try again.';
  }

  // 8. Server / Database / Malformed Payload Errors (5xx or technical driver messages)
  const hasTechnicalLeakIndicators =
    /\b(mongo|mongoose|bson|collection:|index:|dup key|prisma|postgres|sql|syntaxerror|typeerror|referenceerror|unexpected token|expected valid json|non-json|function_invocation_failed|internal server error|bad gateway|service unavailable|gateway timeout|stack|\[redacted_|\[internal_path\])\b/i.test(
      lower
    ) ||
    /https?:\/\/[^\s]+/i.test(sanitized) ||
    /<\/?[a-z][\s\S]*>/i.test(sanitized);

  if (
    (status !== null && status >= 500) ||
    code === 'INVALID_JSON_RESPONSE' ||
    code === 'BACKEND_UNHEALTHY' ||
    code === 'INVALID_HEALTH_PAYLOAD' ||
    hasTechnicalLeakIndicators
  ) {
    if (context === 'health') {
      return 'The Qavora server is temporarily unavailable. Tap Check to retry.';
    }
    return 'The Qavora server is temporarily unavailable. Please try again in a few moments.';
  }

  // 9. Preserve clean field-level validation messages (400 / 422 or client validation)
  if (
    sanitized &&
    sanitized.length <= 180 &&
    !/request failed with http/i.test(sanitized)
  ) {
    return sanitized;
  }

  // 10. Context-specific safe fallbacks
  if (context === 'register') {
    return 'Unable to create your account right now. Please check your details and try again.';
  }
  if (context === 'session') {
    return 'Unable to verify your session right now. Please sign in again.';
  }
  if (context === 'health') {
    return 'Unable to reach the Qavora server. Tap Check to retry.';
  }
  return 'Unable to sign in right now. Please check your credentials and try again.';
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
    const debugDiagnostic = buildSafeDebugDiagnostics(err, 'csrf');
    return {
      ok: false,
      status: isApiErr ? err.status : null,
      csrfToken: null,
      error: formatAuthErrorMessage(err, 'session'),
      debugDiagnostic,
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
      field: 'name',
      error: 'Full name is required.',
    };
  }

  if (!normalizedEmail || !EMAIL_REGEX.test(normalizedEmail)) {
    return {
      ok: false,
      status: 400,
      user: null,
      field: 'email',
      error: 'Please enter a valid email address.',
    };
  }

  if (typeof password !== 'string' || password.length < 8) {
    return {
      ok: false,
      status: 400,
      user: null,
      field: 'password',
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
      const debugDiagnostic = buildSafeDebugDiagnostics(
        {
          status: response.status,
          code: 'INVALID_USER_PROFILE',
          message: 'Registration response did not include a valid user profile.',
        },
        'register'
      );
      return {
        ok: false,
        status: response.status,
        user: null,
        error:
          'Unable to complete account registration right now. Please try again.',
        debugDiagnostic,
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
    const status = isApiErr && typeof err.status === 'number' ? err.status : 0;
    const debugDiagnostic = buildSafeDebugDiagnostics(err, 'register');
    const safeErrorMessage = formatAuthErrorMessage(err, 'register');

    return {
      ok: false,
      status,
      user: null,
      error: safeErrorMessage,
      code: isApiErr ? err.code : 'REGISTER_ERROR',
      isNetworkError: isApiErr ? Boolean(err.isNetworkError) : false,
      isTimeout: isApiErr ? Boolean(err.isTimeout) : false,
      field: status === 409 ? 'email' : undefined,
      debugDiagnostic,
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

  if (!normalizedEmail || !EMAIL_REGEX.test(normalizedEmail)) {
    return {
      ok: false,
      status: 400,
      user: null,
      field: 'email',
      error: 'Please enter a valid email address.',
    };
  }

  if (typeof password !== 'string' || password === '') {
    return {
      ok: false,
      status: 400,
      user: null,
      field: 'password',
      error: 'Please enter your password.',
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
      const debugDiagnostic = buildSafeDebugDiagnostics(
        {
          status: response.status,
          code: 'INVALID_USER_PROFILE',
          message: 'Login response did not include a valid user profile.',
        },
        'login'
      );
      return {
        ok: false,
        status: response.status,
        user: null,
        error: 'Unable to sign in right now. Please try again.',
        debugDiagnostic,
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
    const status = isApiErr && typeof err.status === 'number' ? err.status : 0;
    const debugDiagnostic = buildSafeDebugDiagnostics(err, 'login');
    const safeErrorMessage = formatAuthErrorMessage(err, 'login');

    return {
      ok: false,
      status,
      user: null,
      error: safeErrorMessage,
      code: isApiErr ? err.code : 'LOGIN_ERROR',
      isNetworkError: isApiErr ? Boolean(err.isNetworkError) : false,
      isTimeout: isApiErr ? Boolean(err.isTimeout) : false,
      debugDiagnostic,
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
        error: 'Unable to verify your session right now. Please sign in again.',
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
    const status = isApiErr && typeof err.status === 'number' ? err.status : 0;
    const debugDiagnostic = buildSafeDebugDiagnostics(err, 'session');

    if (status === 401) {
      await clearAllCookies();
      await clearCachedUserProfile();
    }

    return {
      ok: false,
      status,
      user: null,
      isExpired: status === 401,
      isNetworkError: isApiErr ? Boolean(err.isNetworkError) : false,
      isTimeout: isApiErr ? Boolean(err.isTimeout) : false,
      error: formatAuthErrorMessage(err, 'session'),
      debugDiagnostic,
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
      error: formatAuthErrorMessage(
        { status: 401, error: meResult.error },
        'session'
      ),
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
    error: formatAuthErrorMessage(meResult, 'session'),
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
    buildSafeDebugDiagnostics(err, 'logout');
    serverError = formatAuthErrorMessage(err, 'logout');
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
  sanitizeSensitiveDiagnosticText,
  buildSafeDebugDiagnostics,
  getLastAuthDebugDiagnostic,
  formatAuthErrorMessage,
  cookieManager,
  apiClient,
};

export default authService;

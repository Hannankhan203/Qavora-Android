/**
 * Qavora Android — Central API Foundation & Secure Cookie/CSRF Transport (Phase 1A + 1B)
 *
 * Provides a centralized HTTP client for communicating with the Qavora Web
 * Express 5 + MongoDB 7 backend.
 *
 * Security Corrections Applied:
 * 1. Native Cookie Forwarding: Uses `credentials: 'omit'` on native Android/iOS so
 *    OkHttp (`ForwardingCookieHandler`) and `NSHTTPCookieStorage` do not duplicate
 *    or conflict with cookies managed by `cookieManager.js`, while preserving
 *    `credentials: 'include'` in browser DOM environments.
 * 2. Encrypted Cookie Persistence: Delegates cookie storage to `cookieManager.js`
 *    backed by `expo-secure-store` (`qavora.auth.cookie_jar.v1`).
 * 3. Production HTTPS & `__Host-` Compatibility: Enforces `https://` in production
 *    or when `__Host-` Secure cookies are active, and preserves explicit trusted
 *    `Origin` configuration (`EXPO_PUBLIC_TRUSTED_ORIGIN`).
 */

import {
  cookieManager,
  ensureCookieJarHydrated,
  storeCookiesFromResponse,
  setCsrfTokenCookie,
  getCsrfToken,
  hasAuthCookie,
  hasHostPrefixedCookies,
  getCookieHeader,
  clearAllCookies,
} from './cookieManager.js';

const DEFAULT_TIMEOUT_MS = 15000;
const HEALTH_ENDPOINT_PATH = '/api/health';
const CSRF_ENDPOINT_PATH = '/api/auth/csrf';

const unauthorizedListeners = new Set();

/**
 * Registers a listener invoked whenever an authenticated API call receives HTTP 401.
 * Returns an unsubscribe function.
 *
 * @param {(info: { url: string, status: number, message: string }) => void} listener
 * @returns {() => void}
 */
export function onUnauthorizedResponse(listener) {
  if (typeof listener !== 'function') {
    return () => {};
  }
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
  };
}

function notifyUnauthorizedListeners(info) {
  unauthorizedListeners.forEach((listener) => {
    try {
      listener(info);
    } catch {
      // Ignore listener errors
    }
  });
}

/**
 * Structured API error representing HTTP errors, network failures, timeouts,
 * invalid JSON payloads, or configuration errors.
 */
export class ApiClientError extends Error {
  constructor({
    message,
    code = 'API_ERROR',
    status = null,
    url = null,
    method = 'GET',
    data = null,
    isNetworkError = false,
    isTimeout = false,
    cause = null,
  }) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
    this.status = status;
    this.url = url;
    this.method = method;
    this.data = data;
    this.isNetworkError = Boolean(isNetworkError);
    this.isTimeout = Boolean(isTimeout);
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

/**
 * Determines whether the runtime is a standard web browser DOM where `Cookie`
 * and `Origin` request headers are managed directly by the browser engine.
 */
export function isBrowserDomEnvironment() {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

/**
 * Determines whether the application is configured for production mode.
 */
export function isProductionEnvironment() {
  if (typeof process === 'undefined' || !process.env) {
    return false;
  }
  return (
    process.env.EXPO_PUBLIC_ENV === 'production' ||
    process.env.NODE_ENV === 'production'
  );
}

/**
 * Normalizes a base URL string by trimming whitespace and stripping trailing slashes.
 *
 * @param {string | undefined | null} rawUrl
 * @returns {string}
 */
export function normalizeBaseUrl(rawUrl) {
  if (typeof rawUrl !== 'string') {
    return '';
  }
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return '';
  }
  return trimmed.replace(/\/+$/, '');
}

/**
 * Resolves the configured backend API base URL from Expo environment variables
 * or an explicit override. Does not hardcode any production URL.
 *
 * Reads `process.env.EXPO_PUBLIC_API_BASE_URL` (primary) and
 * `process.env.EXPO_PUBLIC_API_URL` (fallback).
 *
 * @param {string} [overrideBaseUrl]
 * @returns {string}
 */
export function getApiBaseUrl(overrideBaseUrl) {
  if (typeof overrideBaseUrl === 'string' && overrideBaseUrl.trim() !== '') {
    return normalizeBaseUrl(overrideBaseUrl);
  }

  const envBaseUrl =
    (typeof process !== 'undefined' &&
      process.env &&
      (process.env.EXPO_PUBLIC_API_BASE_URL || process.env.EXPO_PUBLIC_API_URL)) ||
    '';

  return normalizeBaseUrl(envBaseUrl);
}

/**
 * Resolves the trusted Origin header expected by the Qavora Web backend's
 * `isOriginTrusted(origin)` check.
 *
 * Reads `process.env.EXPO_PUBLIC_TRUSTED_ORIGIN` or `process.env.EXPO_PUBLIC_APP_ORIGIN`
 * if explicitly provided; otherwise derives the origin (`protocol//host`) from the
 * configured backend base URL.
 *
 * @param {string} [overrideBaseUrl]
 * @returns {string}
 */
export function getTrustedOrigin(overrideBaseUrl) {
  const configuredOrigin =
    (typeof process !== 'undefined' &&
      process.env &&
      (process.env.EXPO_PUBLIC_TRUSTED_ORIGIN || process.env.EXPO_PUBLIC_APP_ORIGIN)) ||
    '';

  if (configuredOrigin && configuredOrigin.trim()) {
    try {
      const parsed = new URL(configuredOrigin.trim());
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.origin;
      }
    } catch {
      // Fall through to baseUrl origin
    }
  }

  const baseUrl = getApiBaseUrl(overrideBaseUrl);
  if (!baseUrl) {
    return '';
  }

  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.origin;
    }
  } catch {
    // Ignore invalid URL
  }
  return '';
}

/**
 * Validates that a base URL uses http:// or https://, has a valid host, and uses
 * HTTPS when running in production or when `__Host-` Secure cookies are active.
 *
 * @param {string} baseUrl
 * @param {object} [options]
 * @param {boolean} [options.requireHttps]
 * @returns {{ valid: boolean, code?: string, reason?: string }}
 */
export function validateBaseUrl(baseUrl, options = {}) {
  if (!baseUrl) {
    return {
      valid: false,
      code: 'INVALID_BASE_URL',
      reason:
        'Backend API base URL is not configured. Set EXPO_PUBLIC_API_BASE_URL in your environment.',
    };
  }

  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return {
        valid: false,
        code: 'INVALID_BASE_URL',
        reason: `Unsupported protocol "${parsed.protocol}". Expected "http:" or "https:".`,
      };
    }
    if (!parsed.host) {
      return {
        valid: false,
        code: 'INVALID_BASE_URL',
        reason: 'Base URL is missing a valid hostname.',
      };
    }

    const mustUseHttps =
      Boolean(options.requireHttps) ||
      isProductionEnvironment() ||
      hasHostPrefixedCookies();

    if (mustUseHttps && parsed.protocol !== 'https:') {
      return {
        valid: false,
        code: 'INSECURE_PRODUCTION_URL',
        reason:
          'Production authentication and __Host- Secure cookies require an HTTPS (https://) backend URL.',
      };
    }

    return { valid: true };
  } catch {
    return {
      valid: false,
      code: 'INVALID_BASE_URL',
      reason: `Invalid API base URL format: "${baseUrl}".`,
    };
  }
}

/**
 * Builds a complete request URL from a base URL, endpoint path, and optional query params.
 *
 * @param {string} path
 * @param {object} [options]
 * @param {string} [options.baseUrl]
 * @param {boolean} [options.requireHttps]
 * @param {Record<string, string | number | boolean | null | undefined>} [options.params]
 * @returns {string}
 */
export function buildRequestUrl(path, options = {}) {
  const baseUrl = getApiBaseUrl(options.baseUrl);
  const validation = validateBaseUrl(baseUrl, {
    requireHttps: options.requireHttps,
  });

  if (!validation.valid) {
    throw new ApiClientError({
      message: validation.reason,
      code: validation.code || 'INVALID_BASE_URL',
      status: null,
      url: baseUrl || null,
      method: options.method || 'GET',
    });
  }

  const normalizedPath =
    typeof path === 'string' && path.trim() !== ''
      ? path.startsWith('/')
        ? path.trim()
        : `/${path.trim()}`
      : '/';

  const url = new URL(`${baseUrl}${normalizedPath}`);

  if (options.params && typeof options.params === 'object') {
    Object.entries(options.params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.append(key, String(value));
      }
    });
  }

  return url.toString();
}

/**
 * Safely parses an HTTP Response body as JSON and detects malformed or unexpected payloads.
 *
 * @param {Response} response
 * @returns {Promise<{ data: any, rawText: string, isJson: boolean, parseError: Error | null }>}
 */
async function parseResponseBody(response) {
  const contentType = (response.headers && response.headers.get('content-type')) || '';
  const expectsJson = contentType.toLowerCase().includes('application/json');

  let rawText = '';
  try {
    rawText = await response.text();
  } catch (readError) {
    return {
      data: null,
      rawText: '',
      isJson: false,
      parseError: readError,
    };
  }

  const trimmed = rawText.trim();
  if (!trimmed) {
    return {
      data: null,
      rawText: '',
      isJson: expectsJson,
      parseError: null,
    };
  }

  try {
    const parsed = JSON.parse(trimmed);
    return {
      data: parsed,
      rawText,
      isJson: true,
      parseError: null,
    };
  } catch (parseError) {
    return {
      data: null,
      rawText,
      isJson: false,
      parseError,
    };
  }
}

/**
 * Extracts a human-readable error message from a parsed backend response payload.
 *
 * @param {any} data
 * @param {number} status
 * @param {string} statusText
 * @returns {string}
 */
function extractErrorMessage(data, status, statusText) {
  if (data && typeof data === 'object') {
    if (typeof data.error === 'string' && data.error.trim()) {
      return data.error.trim();
    }
    if (data.error && typeof data.error.message === 'string' && data.error.message.trim()) {
      return data.error.message.trim();
    }
    if (typeof data.message === 'string' && data.message.trim()) {
      return data.message.trim();
    }
  }
  return statusText
    ? `Request failed with HTTP ${status} (${statusText}).`
    : `Request failed with HTTP ${status}.`;
}

/**
 * Normalizes an endpoint path for route matching (e.g. `/api/auth/login`).
 */
function normalizeEndpointPath(path) {
  if (typeof path !== 'string' || !path.trim()) {
    return '/';
  }
  const clean = path.trim().split('?')[0];
  return clean.startsWith('/') ? clean : `/${clean}`;
}

/**
 * Resolves the appropriate `credentials` mode for `fetch`:
 * - On Web browser DOM (`isBrowserDomEnvironment() === true`): `'include'`
 *   so the browser's native cookie store handles `HttpOnly` cookies.
 * - On React Native Android/iOS (`!isBrowserDomEnvironment()`): `'omit'`
 *   so native `ForwardingCookieHandler` / `NSHTTPCookieStorage` is disabled
 *   (`CookieJar.NO_COOKIES`) and never duplicates cookies managed by `cookieManager.js`.
 */
export function resolveDefaultCredentialsMode(explicitCredentials) {
  if (explicitCredentials) {
    return explicitCredentials;
  }
  return isBrowserDomEnvironment() ? 'include' : 'omit';
}

/**
 * Creates a configurable API client instance.
 *
 * @param {object} [clientConfig]
 * @param {string} [clientConfig.baseUrl]
 * @param {number} [clientConfig.timeoutMs=15000]
 * @param {RequestCredentials} [clientConfig.credentials]
 * @param {Record<string, string>} [clientConfig.defaultHeaders]
 * @param {typeof fetch} [clientConfig.fetchImpl]
 */
export function createApiClient(clientConfig = {}) {
  const defaultTimeoutMs =
    typeof clientConfig.timeoutMs === 'number' && clientConfig.timeoutMs > 0
      ? clientConfig.timeoutMs
      : DEFAULT_TIMEOUT_MS;
  const baseHeaders = {
    Accept: 'application/json',
    ...(clientConfig.defaultHeaders || {}),
  };

  /**
   * Fetches a fresh session-bound CSRF token from `GET /api/auth/csrf` and stores it
   * in the persistent secure cookie jar.
   */
  async function refreshCsrfToken(options = {}) {
    const response = await request('GET', CSRF_ENDPOINT_PATH, {
      ...options,
      _skipCsrfRefresh: true,
    });
    if (
      response.data &&
      typeof response.data.csrfToken === 'string' &&
      response.data.csrfToken.trim()
    ) {
      await setCsrfTokenCookie(response.data.csrfToken.trim(), response.url);
      return response.data.csrfToken.trim();
    }
    return getCsrfToken();
  }

  /**
   * Core HTTP request executor.
   *
   * @param {string} method
   * @param {string} path
   * @param {object} [options]
   * @returns {Promise<{ ok: true, status: number, data: any, headers: Headers, url: string }>}
   */
  async function request(method, path, options = {}) {
    await ensureCookieJarHydrated();

    const normalizedMethod = String(method || 'GET').toUpperCase();
    const cleanPath = normalizeEndpointPath(path);
    const isStateChanging =
      normalizedMethod !== 'GET' &&
      normalizedMethod !== 'HEAD' &&
      normalizedMethod !== 'OPTIONS';
    const isSessionEstablishingAuthRoute =
      cleanPath === '/api/auth/login' || cleanPath === '/api/auth/register';

    const effectiveBaseUrl = options.baseUrl ?? clientConfig.baseUrl;
    const url = buildRequestUrl(path, {
      baseUrl: effectiveBaseUrl,
      params: options.params,
      method: normalizedMethod,
      requireHttps: options.requireHttps,
    });

    const timeoutMs =
      typeof options.timeoutMs === 'number' && options.timeoutMs > 0
        ? options.timeoutMs
        : defaultTimeoutMs;

    const headers = {
      ...baseHeaders,
      ...(options.headers || {}),
    };

    // On protected mutations, ensure a session-bound CSRF token is available and attached
    if (isStateChanging && !isSessionEstablishingAuthRoute && !options._skipCsrfRefresh) {
      let csrfToken = getCsrfToken();
      if (!csrfToken && hasAuthCookie()) {
        try {
          csrfToken = await refreshCsrfToken({
            baseUrl: effectiveBaseUrl,
            timeoutMs,
            fetchImpl: options.fetchImpl,
          });
        } catch {
          // Proceed and allow backend response handling to report the exact status
        }
      }
      if (csrfToken && !headers['X-CSRF-Token'] && !headers['x-csrf-token']) {
        headers['X-CSRF-Token'] = csrfToken;
      }
    }

    // Attach persistent Cookie and trusted Origin headers in React Native / non-DOM runtimes
    if (!isBrowserDomEnvironment()) {
      const cookieHeaderValue = getCookieHeader(url);
      if (cookieHeaderValue && !headers.Cookie && !headers.cookie) {
        headers.Cookie = cookieHeaderValue;
      }

      if (isStateChanging && !headers.Origin && !headers.origin) {
        const trustedOrigin = getTrustedOrigin(effectiveBaseUrl);
        if (trustedOrigin) {
          headers.Origin = trustedOrigin;
        }
      }
    }

    let requestBody;
    if (options.body !== undefined && options.body !== null && normalizedMethod !== 'GET') {
      if (typeof options.body === 'string') {
        requestBody = options.body;
        if (!headers['Content-Type'] && !headers['content-type']) {
          headers['Content-Type'] = 'application/json';
        }
      } else {
        try {
          requestBody = JSON.stringify(options.body);
        } catch (serializeError) {
          throw new ApiClientError({
            message: 'Failed to serialize request body to JSON.',
            code: 'INVALID_REQUEST_BODY',
            status: null,
            url,
            method: normalizedMethod,
            cause: serializeError,
          });
        }
        if (!headers['Content-Type'] && !headers['content-type']) {
          headers['Content-Type'] = 'application/json';
        }
      }
    }

    const controller = new AbortController();
    let didTimeout = false;
    const timeoutId = setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, timeoutMs);

    const fetchFn = clientConfig.fetchImpl || options.fetchImpl || globalThis.fetch;
    if (typeof fetchFn !== 'function') {
      clearTimeout(timeoutId);
      throw new ApiClientError({
        message: 'Global fetch API is unavailable in this runtime.',
        code: 'FETCH_UNAVAILABLE',
        status: null,
        url,
        method: normalizedMethod,
      });
    }

    const requestCredentials = resolveDefaultCredentialsMode(
      options.credentials ?? clientConfig.credentials
    );

    let response;
    try {
      response = await fetchFn(url, {
        method: normalizedMethod,
        headers,
        body: requestBody,
        credentials: requestCredentials,
        signal: controller.signal,
      });
    } catch (networkError) {
      clearTimeout(timeoutId);

      if (didTimeout || (networkError && networkError.name === 'AbortError')) {
        throw new ApiClientError({
          message: `Request to ${url} timed out after ${timeoutMs}ms.`,
          code: 'REQUEST_TIMEOUT',
          status: null,
          url,
          method: normalizedMethod,
          isNetworkError: true,
          isTimeout: true,
          cause: networkError,
        });
      }

      throw new ApiClientError({
        message:
          (networkError && networkError.message) ||
          `Network error while connecting to ${url}.`,
        code: 'NETWORK_ERROR',
        status: null,
        url,
        method: normalizedMethod,
        isNetworkError: true,
        isTimeout: false,
        cause: networkError,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    // Persist any Set-Cookie headers sent by the server into SecureStore
    await storeCookiesFromResponse(response, url);

    const { data, rawText, isJson, parseError } = await parseResponseBody(response);

    // If GET /api/auth/csrf returned a csrfToken in JSON, sync it with the cookie jar
    if (
      response.ok &&
      cleanPath === CSRF_ENDPOINT_PATH &&
      data &&
      typeof data.csrfToken === 'string' &&
      data.csrfToken.trim()
    ) {
      await setCsrfTokenCookie(data.csrfToken.trim(), url);
    }

    // Handle HTTP error statuses (4xx / 5xx)
    if (!response.ok) {
      const errorMessage = extractErrorMessage(data, response.status, response.statusText);
      const errorCode =
        (data && typeof data === 'object' && (data.code || data.errorCode)) ||
        `HTTP_${response.status}`;

      // Automatic single retry if a mutation failed due to missing/stale CSRF cookie while authenticated
      if (
        response.status === 403 &&
        isStateChanging &&
        !isSessionEstablishingAuthRoute &&
        !options._csrfRetried &&
        hasAuthCookie() &&
        errorMessage.toLowerCase().includes('csrf')
      ) {
        try {
          const refreshedCsrf = await refreshCsrfToken({
            baseUrl: effectiveBaseUrl,
            timeoutMs,
            fetchImpl: options.fetchImpl,
          });
          if (refreshedCsrf) {
            const retryHeaders = { ...(options.headers || {}) };
            delete retryHeaders['X-CSRF-Token'];
            delete retryHeaders['x-csrf-token'];
            return await request(method, path, {
              ...options,
              headers: retryHeaders,
              _csrfRetried: true,
            });
          }
        } catch {
          // Fall through to throw the original 403 error
        }
      }

      // If an authenticated endpoint returned 401 Unauthorized, clear invalid cookies and notify listeners
      if (response.status === 401 && !isSessionEstablishingAuthRoute) {
        await clearAllCookies();
        if (!options.suppressUnauthorizedEvent) {
          notifyUnauthorizedListeners({
            url,
            status: 401,
            message: errorMessage,
          });
        }
      }

      throw new ApiClientError({
        message: errorMessage,
        code: String(errorCode),
        status: response.status,
        url,
        method: normalizedMethod,
        data: data ?? (rawText ? { rawText: rawText.slice(0, 500) } : null),
      });
    }

    // Handle malformed / non-JSON responses when JSON is expected
    if (parseError || (!isJson && rawText !== '')) {
      throw new ApiClientError({
        message: `Expected valid JSON response from ${url}, but received non-JSON or malformed content.`,
        code: 'INVALID_JSON_RESPONSE',
        status: response.status,
        url,
        method: normalizedMethod,
        data: { rawText: rawText.slice(0, 500) },
        cause: parseError,
      });
    }

    // Handle logical unsuccessful responses from the API (e.g., { ok: false } or { success: false })
    if (
      data &&
      typeof data === 'object' &&
      (data.ok === false || data.success === false || data.status === 'error')
    ) {
      const errorMessage = extractErrorMessage(data, response.status, response.statusText);
      const errorCode = data.code || data.errorCode || 'UNSUCCESSFUL_RESPONSE';

      throw new ApiClientError({
        message: errorMessage,
        code: String(errorCode),
        status: response.status,
        url,
        method: normalizedMethod,
        data,
      });
    }

    return {
      ok: true,
      status: response.status,
      data,
      headers: response.headers,
      url,
    };
  }

  /**
   * Executes a GET request against the configured backend.
   *
   * @param {string} path
   * @param {object} [options]
   */
  function get(path, options = {}) {
    return request('GET', path, options);
  }

  /**
   * Executes a POST request against the configured backend.
   *
   * @param {string} path
   * @param {any} [body]
   * @param {object} [options]
   */
  function post(path, body = undefined, options = {}) {
    return request('POST', path, {
      ...options,
      body,
    });
  }

  /**
   * Executes a PUT request against the configured backend.
   *
   * @param {string} path
   * @param {any} [body]
   * @param {object} [options]
   */
  function put(path, body = undefined, options = {}) {
    return request('PUT', path, {
      ...options,
      body,
    });
  }

  /**
   * Executes a PATCH request against the configured backend.
   *
   * @param {string} path
   * @param {any} [body]
   * @param {object} [options]
   */
  function patch(path, body = undefined, options = {}) {
    return request('PATCH', path, {
      ...options,
      body,
    });
  }

  /**
   * Executes a DELETE request against the configured backend.
   *
   * @param {string} path
   * @param {object} [options]
   */
  function del(path, options = {}) {
    return request('DELETE', path, options);
  }

  /**
   * Connects to the public `GET /api/health` endpoint and returns a structured,
   * non-throwing health check result indicating backend reachability and validity.
   *
   * @param {object} [options]
   * @param {string} [options.baseUrl]
   * @param {number} [options.timeoutMs]
   * @param {typeof fetch} [options.fetchImpl]
   */
  async function checkHealth(options = {}) {
    const startTime = Date.now();
    const timestamp = new Date().toISOString();

    try {
      const response = await get(HEALTH_ENDPOINT_PATH, options);
      const latencyMs = Date.now() - startTime;
      const payload = response.data;

      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return {
          ok: false,
          status: response.status,
          url: response.url,
          latencyMs,
          data: null,
          error: {
            code: 'INVALID_HEALTH_PAYLOAD',
            message: 'Health endpoint returned an empty or non-object JSON payload.',
            status: response.status,
            isNetworkError: false,
            isTimeout: false,
          },
          timestamp,
        };
      }

      const normalizedStatus =
        typeof payload.status === 'string' ? payload.status.toLowerCase() : null;
      const isHealthyStatus =
        normalizedStatus === null ||
        normalizedStatus === 'ok' ||
        normalizedStatus === 'healthy' ||
        normalizedStatus === 'up';

      if (!isHealthyStatus) {
        return {
          ok: false,
          status: response.status,
          url: response.url,
          latencyMs,
          data: payload,
          error: {
            code: 'BACKEND_UNHEALTHY',
            message: `Health endpoint reported status "${payload.status}".`,
            status: response.status,
            isNetworkError: false,
            isTimeout: false,
          },
          timestamp,
        };
      }

      return {
        ok: true,
        status: response.status,
        url: response.url,
        latencyMs,
        data: payload,
        error: null,
        timestamp,
      };
    } catch (err) {
      const latencyMs = Date.now() - startTime;
      const isApiErr = err instanceof ApiClientError;

      return {
        ok: false,
        status: isApiErr ? err.status : null,
        url: isApiErr ? err.url : null,
        latencyMs,
        data: isApiErr ? err.data : null,
        error: {
          code: isApiErr ? err.code : 'UNKNOWN_ERROR',
          message:
            (err && err.message) || 'Unexpected error while checking backend health.',
          status: isApiErr ? err.status : null,
          isNetworkError: isApiErr ? err.isNetworkError : false,
          isTimeout: isApiErr ? err.isTimeout : false,
        },
        timestamp,
      };
    }
  }

  return {
    request,
    get,
    post,
    put,
    patch,
    delete: del,
    refreshCsrfToken,
    checkHealth,
    getBaseUrl: () => getApiBaseUrl(clientConfig.baseUrl),
    getTrustedOrigin: () => getTrustedOrigin(clientConfig.baseUrl),
    cookieManager,
  };
}

/**
 * Default singleton API client configured from `process.env.EXPO_PUBLIC_API_BASE_URL`.
 */
export const apiClient = createApiClient();

/**
 * Reusable GET request helper bound to the default API client.
 */
export const apiGet = apiClient.get;

/**
 * Reusable POST request helper bound to the default API client.
 */
export const apiPost = apiClient.post;

/**
 * Reusable PUT request helper bound to the default API client.
 */
export const apiPut = apiClient.put;

/**
 * Reusable PATCH request helper bound to the default API client.
 */
export const apiPatch = apiClient.patch;

/**
 * Reusable DELETE request helper bound to the default API client.
 */
export const apiDelete = apiClient.delete;

/**
 * Reusable health-check function for `GET /api/health`.
 */
export const checkBackendHealth = apiClient.checkHealth;

export default apiClient;

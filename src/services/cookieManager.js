/**
 * Qavora Android — Secure Persistent Cookie & CSRF Manager (Phase 1B Security Corrections)
 *
 * Stores authentication (`qavora_auth_token` / `__Host-qavora_auth_token`) and
 * CSRF (`qavora_csrf_token` / `__Host-qavora_csrf_token`) cookies in hardware-backed
 * encrypted storage via `expo-secure-store` (Android Keystore / iOS Keychain)
 * instead of plaintext AsyncStorage.
 *
 * Security & Production Rules:
 * - Uses SecureStore key `qavora.auth.cookie_jar.v1` (alphanumeric, `.`, `-`, `_` compliant).
 * - Never writes authentication or CSRF cookies to plaintext AsyncStorage.
 * - Enforces `Secure` and `Path=/` attributes for `__Host-` prefixed production cookies.
 * - Never transmits `Secure` or `__Host-` cookies over non-HTTPS (`http:`) URLs.
 * - Enforces strict deduplication across `__Host-` and standard cookies so the backend
 *   never receives duplicate or conflicting cookies.
 * - Never logs or exposes HttpOnly authentication cookie values to UI components.
 */

import * as SecureStore from 'expo-secure-store';

export const COOKIE_JAR_SECURE_STORE_KEY = 'qavora.auth.cookie_jar.v1';
// Legacy alias preserved for external imports
export const COOKIE_JAR_STORAGE_KEY = COOKIE_JAR_SECURE_STORE_KEY;

export const AUTH_COOKIE_NAMES = [
  '__Host-qavora_auth_token',
  'qavora_auth_token',
];

export const CSRF_COOKIE_NAMES = [
  '__Host-qavora_csrf_token',
  'qavora_csrf_token',
];

const AVAILABILITY_RETRY_DELAYS_MS = [35, 85];
const OPERATION_RETRY_DELAYS_MS = [35, 85];

let memoryCookieJar = {};
let isHydrated = false;
let hydrationPromise = null;
let customStorageAdapter = null;
let secureStoreImpl = SecureStore;
let secureStoreAvailability = null;
let availabilityCheckPromise = null;
let lastPersistenceError = null;

/**
 * Structured error distinguishing temporary availability errors, unavailable storage,
 * and genuine SecureStore read/write/delete persistence failures.
 */
export class CookiePersistenceError extends Error {
  constructor({
    message,
    code = 'SECURE_STORE_WRITE_FAILED',
    category = 'persistence_failure',
    operation = 'write',
    isTransient = false,
    cause = null,
  }) {
    super(message);
    this.name = 'CookiePersistenceError';
    this.code = code;
    this.category = category;
    this.operation = operation;
    this.isTransient = Boolean(isTransient);
    if (cause !== undefined && cause !== null) {
      this.cause = cause;
    }
  }
}

function isBrowserDomEnvironment() {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function waitMs(ms) {
  if (!ms || ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function recordRedactedPersistenceError(err) {
  if (!err) {
    lastPersistenceError = null;
    return;
  }
  lastPersistenceError = {
    code: typeof err.code === 'string' ? err.code : 'SECURE_STORE_ERROR',
    category:
      typeof err.category === 'string' ? err.category : 'persistence_failure',
    operation: typeof err.operation === 'string' ? err.operation : 'unknown',
    isTransient: Boolean(err.isTransient),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Checks whether native Expo SecureStore is available in the current runtime.
 *
 * - Caches `true` when confirmed available on native.
 * - Caches `false` only on confirmed Web DOM runtimes where SecureStore is unsupported
 *   and browser cookies handle persistence (`unavailable_web`).
 * - Never permanently caches `false` when `SecureStore.isAvailableAsync()` throws a
 *   transient error or temporarily reports unavailable on native; instead retries
 *   within strict bounds and distinguishes temporary errors from unavailability.
 *
 * @returns {Promise<{ available: boolean, status: 'available' | 'unavailable' | 'unavailable_web' | 'temporary_error', reason?: string, error?: CookiePersistenceError }>}
 */
export async function checkSecureStoreAvailability() {
  if (secureStoreAvailability === true) {
    return { available: true, status: 'available' };
  }
  if (isBrowserDomEnvironment() && secureStoreAvailability === false) {
    return {
      available: false,
      status: 'unavailable_web',
      reason: 'SecureStore is not supported in browser DOM runtimes.',
    };
  }

  if (availabilityCheckPromise) {
    return availabilityCheckPromise;
  }

  availabilityCheckPromise = (async () => {
    const store = secureStoreImpl;
    if (!store || typeof store.isAvailableAsync !== 'function') {
      if (isBrowserDomEnvironment()) {
        secureStoreAvailability = false;
        return {
          available: false,
          status: 'unavailable_web',
          reason: 'SecureStore is not supported in browser DOM runtimes.',
        };
      }
      const err = new CookiePersistenceError({
        message: 'Secure device storage is unavailable on this device.',
        code: 'SECURE_STORE_UNAVAILABLE',
        category: 'unavailable',
        operation: 'availability',
        isTransient: false,
      });
      recordRedactedPersistenceError(err);
      return {
        available: false,
        status: 'unavailable',
        reason: err.message,
        error: err,
      };
    }

    let lastErr = null;
    const maxAttempts = AVAILABILITY_RETRY_DELAYS_MS.length + 1;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const available = Boolean(await store.isAvailableAsync());
        if (available) {
          secureStoreAvailability = true;
          if (
            lastPersistenceError &&
            lastPersistenceError.operation === 'availability'
          ) {
            lastPersistenceError = null;
          }
          return { available: true, status: 'available' };
        }

        if (isBrowserDomEnvironment()) {
          secureStoreAvailability = false;
          return {
            available: false,
            status: 'unavailable_web',
            reason: 'SecureStore is not supported in browser DOM runtimes.',
          };
        }

        // Native returned false cleanly: do NOT cache false permanently in case
        // secure storage becomes ready later (e.g., device unlock), and report unavailable.
        const unavailableErr = new CookiePersistenceError({
          message: 'Secure device storage is unavailable on this device.',
          code: 'SECURE_STORE_UNAVAILABLE',
          category: 'unavailable',
          operation: 'availability',
          isTransient: false,
        });
        recordRedactedPersistenceError(unavailableErr);
        return {
          available: false,
          status: 'unavailable',
          reason: unavailableErr.message,
          error: unavailableErr,
        };
      } catch (err) {
        lastErr = err;
        if (attempt < AVAILABILITY_RETRY_DELAYS_MS.length) {
          await waitMs(AVAILABILITY_RETRY_DELAYS_MS[attempt]);
        }
      }
    }

    // Transient availability failure exhausted retries: never cache `false` permanently.
    const tempErr = new CookiePersistenceError({
      message:
        'Secure device storage is temporarily unavailable. Please try again.',
      code: 'SECURE_STORE_TEMP_ERROR',
      category: 'temporary_error',
      operation: 'availability',
      isTransient: true,
      cause: lastErr,
    });
    recordRedactedPersistenceError(tempErr);
    return {
      available: false,
      status: 'temporary_error',
      reason: tempErr.message,
      error: tempErr,
    };
  })();

  try {
    return await availabilityCheckPromise;
  } finally {
    availabilityCheckPromise = null;
  }
}

async function runWithBoundedRetries(fn) {
  let lastErr = null;
  const maxAttempts = OPERATION_RETRY_DELAYS_MS.length + 1;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < OPERATION_RETRY_DELAYS_MS.length) {
        await waitMs(OPERATION_RETRY_DELAYS_MS[attempt]);
      }
    }
  }
  throw lastErr;
}

/**
 * Default adapter wrapping `expo-secure-store` (`getItemAsync`, `setItemAsync`, `deleteItemAsync`).
 * Never falls back to plaintext AsyncStorage.
 */
const expoSecureStoreAdapter = {
  async getItem(key) {
    const availability = await checkSecureStoreAvailability();
    if (availability.status === 'unavailable_web') {
      return null;
    }
    if (!availability.available) {
      throw (
        availability.error ||
        new CookiePersistenceError({
          message: 'Secure device storage is unavailable on this device.',
          code: 'SECURE_STORE_UNAVAILABLE',
          category: 'unavailable',
          operation: 'read',
          isTransient: false,
        })
      );
    }

    try {
      const value = await runWithBoundedRetries(() =>
        secureStoreImpl.getItemAsync(key)
      );
      if (lastPersistenceError && lastPersistenceError.operation === 'read') {
        lastPersistenceError = null;
      }
      return value;
    } catch (err) {
      const persistenceErr = new CookiePersistenceError({
        message: 'Unable to read authentication session from secure storage.',
        code: 'SECURE_STORE_READ_FAILED',
        category: 'persistence_failure',
        operation: 'read',
        isTransient: false,
        cause: err,
      });
      recordRedactedPersistenceError(persistenceErr);
      throw persistenceErr;
    }
  },
  async setItem(key, value) {
    const availability = await checkSecureStoreAvailability();
    if (availability.status === 'unavailable_web') {
      return { persisted: false, status: 'unavailable_web' };
    }
    if (!availability.available) {
      throw (
        availability.error ||
        new CookiePersistenceError({
          message: 'Secure device storage is unavailable on this device.',
          code: 'SECURE_STORE_UNAVAILABLE',
          category: 'unavailable',
          operation: 'write',
          isTransient: false,
        })
      );
    }

    const keychainAccessible =
      (secureStoreImpl && secureStoreImpl.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY) ??
      SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY;

    try {
      await runWithBoundedRetries(() =>
        secureStoreImpl.setItemAsync(key, value, {
          keychainAccessible,
        })
      );
      lastPersistenceError = null;
      return { persisted: true, status: 'persisted' };
    } catch (err) {
      const persistenceErr = new CookiePersistenceError({
        message:
          'Unable to securely store your authentication session on this device.',
        code: 'SECURE_STORE_WRITE_FAILED',
        category: 'persistence_failure',
        operation: 'write',
        isTransient: false,
        cause: err,
      });
      recordRedactedPersistenceError(persistenceErr);
      throw persistenceErr;
    }
  },
  async removeItem(key) {
    const availability = await checkSecureStoreAvailability();
    if (availability.status === 'unavailable_web') {
      return { removed: false, status: 'unavailable_web' };
    }
    if (!availability.available) {
      throw (
        availability.error ||
        new CookiePersistenceError({
          message: 'Secure device storage is unavailable on this device.',
          code: 'SECURE_STORE_UNAVAILABLE',
          category: 'unavailable',
          operation: 'delete',
          isTransient: false,
        })
      );
    }

    try {
      await runWithBoundedRetries(() => secureStoreImpl.deleteItemAsync(key));
      if (lastPersistenceError && lastPersistenceError.operation === 'delete') {
        lastPersistenceError = null;
      }
      return { removed: true, status: 'deleted' };
    } catch (err) {
      const persistenceErr = new CookiePersistenceError({
        message:
          'Unable to remove authentication session from secure device storage.',
        code: 'SECURE_STORE_DELETE_FAILED',
        category: 'persistence_failure',
        operation: 'delete',
        isTransient: false,
        cause: err,
      });
      recordRedactedPersistenceError(persistenceErr);
      throw persistenceErr;
    }
  },
};

/**
 * Resolves the active secure storage adapter.
 */
function getStorage() {
  if (customStorageAdapter) {
    return customStorageAdapter;
  }
  return expoSecureStoreAdapter;
}

/**
 * Allows injecting a custom secure storage adapter for deterministic verification tests.
 *
 * @param {{ getItem: Function, setItem: Function, removeItem: Function } | null} adapter
 */
export function setCookieStorageAdapter(adapter) {
  customStorageAdapter = adapter;
}

/**
 * Allows injecting a mock `expo-secure-store` module for deterministic verification tests.
 *
 * @param {object | null} mockStore
 */
export function setSecureStoreImplementation(mockStore) {
  secureStoreImpl = mockStore || SecureStore;
  secureStoreAvailability = null;
  availabilityCheckPromise = null;
}

/**
 * Splits a combined `Set-Cookie` header string into individual cookie strings
 * without splitting on commas inside `Expires=Wed, 21 Oct 2026 07:28:00 GMT`.
 *
 * @param {string} rawSetCookieHeader
 * @returns {string[]}
 */
export function splitSetCookieHeader(rawSetCookieHeader) {
  if (!rawSetCookieHeader || typeof rawSetCookieHeader !== 'string') {
    return [];
  }

  const results = [];
  let current = '';
  let index = 0;
  const len = rawSetCookieHeader.length;

  while (index < len) {
    const ch = rawSetCookieHeader[index];
    if (ch === ',') {
      const rest = rawSetCookieHeader.slice(index + 1);
      const nextTokenMatch = rest.match(/^\s*([^;,\s=]+)=/);
      if (nextTokenMatch) {
        const candidateName = nextTokenMatch[1].trim().toLowerCase();
        if (
          candidateName !== 'expires' &&
          candidateName !== 'max-age' &&
          candidateName !== 'path' &&
          candidateName !== 'domain' &&
          candidateName !== 'samesite'
        ) {
          if (current.trim()) {
            results.push(current.trim());
          }
          current = '';
          index += 1;
          while (index < len && rawSetCookieHeader[index] === ' ') {
            index += 1;
          }
          continue;
        }
      }
    }
    current += ch;
    index += 1;
  }

  if (current.trim()) {
    results.push(current.trim());
  }

  return results;
}

/**
 * Parses a single `Set-Cookie` header string into a structured cookie record.
 * Enforces RFC 6265bis `__Host-` and `__Secure-` prefix invariants (`secure: true`, `path: '/'`).
 *
 * @param {string} setCookieStr
 * @param {number} [nowMs]
 * @returns {{
 *   name: string,
 *   value: string,
 *   path: string,
 *   httpOnly: boolean,
 *   secure: boolean,
 *   sameSite: string,
 *   expiresAt: number | null,
 *   shouldDelete: boolean
 * } | null}
 */
export function parseSetCookieString(setCookieStr, nowMs = Date.now()) {
  if (!setCookieStr || typeof setCookieStr !== 'string') {
    return null;
  }

  const segments = setCookieStr
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean);

  if (segments.length === 0) {
    return null;
  }

  const nameValueSegment = segments[0];
  const eqIdx = nameValueSegment.indexOf('=');
  if (eqIdx <= 0) {
    return null;
  }

  const name = nameValueSegment.slice(0, eqIdx).trim();
  const rawValue = nameValueSegment.slice(eqIdx + 1).trim();

  if (!name) {
    return null;
  }

  let value = rawValue;
  try {
    value = decodeURIComponent(rawValue);
  } catch {
    value = rawValue;
  }

  const isHostPrefixed = name.startsWith('__Host-');
  const isSecurePrefixed = isHostPrefixed || name.startsWith('__Secure-');

  let path = '/';
  let httpOnly = false;
  let secure = isSecurePrefixed;
  let sameSite = 'lax';
  let maxAgeSec = null;
  let expiresTimeMs = null;
  let hasDomainAttr = false;

  for (let i = 1; i < segments.length; i += 1) {
    const attr = segments[i];
    const attrEq = attr.indexOf('=');
    const attrKey = (attrEq >= 0 ? attr.slice(0, attrEq) : attr).trim().toLowerCase();
    const attrVal = attrEq >= 0 ? attr.slice(attrEq + 1).trim() : '';

    if (attrKey === 'path' && attrVal) {
      path = attrVal;
    } else if (attrKey === 'domain' && attrVal) {
      hasDomainAttr = true;
    } else if (attrKey === 'httponly') {
      httpOnly = true;
    } else if (attrKey === 'secure') {
      secure = true;
    } else if (attrKey === 'samesite' && attrVal) {
      sameSite = attrVal.toLowerCase();
    } else if (attrKey === 'max-age' && attrVal !== '') {
      const parsedMaxAge = Number(attrVal);
      if (Number.isFinite(parsedMaxAge)) {
        maxAgeSec = parsedMaxAge;
      }
    } else if (attrKey === 'expires' && attrVal) {
      const parsedDate = Date.parse(attrVal);
      if (!Number.isNaN(parsedDate)) {
        expiresTimeMs = parsedDate;
      }
    }
  }

  // RFC 6265bis: `__Host-` cookies must have Path=/, no Domain attribute, and Secure
  if (isHostPrefixed && (hasDomainAttr || path !== '/')) {
    return null;
  }

  let expiresAt = null;
  let shouldDelete = value === '';

  if (maxAgeSec !== null) {
    if (maxAgeSec <= 0) {
      shouldDelete = true;
    } else {
      expiresAt = nowMs + maxAgeSec * 1000;
    }
  } else if (expiresTimeMs !== null) {
    if (expiresTimeMs <= nowMs) {
      shouldDelete = true;
    } else {
      expiresAt = expiresTimeMs;
    }
  }

  return {
    name,
    value,
    path,
    httpOnly,
    secure,
    sameSite,
    expiresAt,
    shouldDelete,
  };
}

/**
 * Extracts all raw `Set-Cookie` header strings from a Fetch `Response` or `Headers` object.
 *
 * @param {Response | { headers?: any } | null | undefined} response
 * @returns {string[]}
 */
export function extractSetCookieHeaders(response) {
  if (!response || !response.headers) {
    return [];
  }

  const headers = response.headers;

  if (typeof headers.getSetCookie === 'function') {
    const list = headers.getSetCookie();
    if (Array.isArray(list) && list.length > 0) {
      const flattened = [];
      list.forEach((entry) => {
        splitSetCookieHeader(entry).forEach((single) => flattened.push(single));
      });
      return flattened;
    }
  }

  if (typeof headers.get === 'function') {
    const combined = headers.get('set-cookie') || headers.get('Set-Cookie');
    if (combined) {
      return splitSetCookieHeader(combined);
    }
  }

  return [];
}

/**
 * Removes expired cookies from the in-memory jar.
 *
 * @param {number} [nowMs]
 * @returns {boolean}
 */
function pruneExpiredCookies(nowMs = Date.now()) {
  let mutated = false;
  Object.keys(memoryCookieJar).forEach((name) => {
    const record = memoryCookieJar[name];
    if (
      !record ||
      !record.value ||
      (typeof record.expiresAt === 'number' && record.expiresAt <= nowMs)
    ) {
      delete memoryCookieJar[name];
      mutated = true;
    }
  });
  return mutated;
}

/**
 * Persists the current in-memory cookie jar to SecureStore.
 * Throws `CookiePersistenceError` if SecureStore is unavailable on native or
 * if writing fails after bounded retries.
 */
async function persistCookieJar() {
  pruneExpiredCookies();
  const storage = getStorage();
  if (!storage || typeof storage.setItem !== 'function') {
    if (isBrowserDomEnvironment()) {
      return { persisted: false, status: 'unavailable_web' };
    }
    const unavailableErr = new CookiePersistenceError({
      message: 'Secure device storage is unavailable on this device.',
      code: 'SECURE_STORE_UNAVAILABLE',
      category: 'unavailable',
      operation: 'write',
      isTransient: false,
    });
    recordRedactedPersistenceError(unavailableErr);
    throw unavailableErr;
  }

  try {
    const result = await storage.setItem(
      COOKIE_JAR_SECURE_STORE_KEY,
      JSON.stringify(memoryCookieJar)
    );
    if (result && result.persisted === false && result.status !== 'unavailable_web') {
      const writeErr = new CookiePersistenceError({
        message:
          'Unable to securely store your authentication session on this device.',
        code: 'SECURE_STORE_WRITE_FAILED',
        category: 'persistence_failure',
        operation: 'write',
        isTransient: false,
      });
      recordRedactedPersistenceError(writeErr);
      throw writeErr;
    }
    return result || { persisted: true, status: 'persisted' };
  } catch (err) {
    const persistenceErr =
      err instanceof CookiePersistenceError
        ? err
        : new CookiePersistenceError({
            message:
              'Unable to securely store your authentication session on this device.',
            code: 'SECURE_STORE_WRITE_FAILED',
            category: 'persistence_failure',
            operation: 'write',
            isTransient: false,
            cause: err,
          });
    recordRedactedPersistenceError(persistenceErr);
    throw persistenceErr;
  }
}

/**
 * Ensures the cookie jar has been hydrated from SecureStore before making requests.
 *
 * - Bounded availability/read retries prevent temporary failures from blocking startup.
 * - On transient availability/read failures, leaves `isHydrated = false` so subsequent
 *   operations can retry once SecureStore recovers, without crashing startup.
 */
export async function ensureCookieJarHydrated() {
  if (isHydrated) {
    pruneExpiredCookies();
    return;
  }

  if (hydrationPromise) {
    await hydrationPromise;
    return;
  }

  hydrationPromise = (async () => {
    let hydratedSuccessfully = false;
    try {
      const storage = getStorage();
      if (storage && typeof storage.getItem === 'function') {
        const raw = await storage.getItem(COOKIE_JAR_SECURE_STORE_KEY);
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              memoryCookieJar = {
                ...parsed,
                ...memoryCookieJar,
              };
            }
          } catch {
            // Corrupted JSON entry in storage: fall back to empty jar
          }
        }
        hydratedSuccessfully = true;
      } else if (isBrowserDomEnvironment()) {
        hydratedSuccessfully = true;
      }
    } catch (err) {
      const persistenceErr =
        err instanceof CookiePersistenceError
          ? err
          : new CookiePersistenceError({
              message: 'Unable to read authentication session from secure storage.',
              code: 'SECURE_STORE_READ_FAILED',
              category: 'persistence_failure',
              operation: 'read',
              isTransient: false,
              cause: err,
            });
      recordRedactedPersistenceError(persistenceErr);
      // Allow subsequent calls to re-attempt hydration after transient/unavailable errors
      hydratedSuccessfully = false;
    } finally {
      isHydrated = hydratedSuccessfully;
      hydrationPromise = null;
      pruneExpiredCookies();
    }
  })();

  await hydrationPromise;
}

/**
 * Applies a parsed cookie record to the in-memory jar while enforcing the Qavora
 * backend's strict single-cookie rule (preventing simultaneous `__Host-` and
 * non-`__Host-` auth or CSRF cookies).
 *
 * @param {ReturnType<typeof parseSetCookieString>} parsed
 * @param {number} [nowMs]
 * @param {string} [responseUrl]
 */
function applyParsedCookieToJar(parsed, nowMs = Date.now(), responseUrl = '') {
  if (!parsed || !parsed.name) {
    return;
  }

  if (parsed.shouldDelete) {
    delete memoryCookieJar[parsed.name];
    if (AUTH_COOKIE_NAMES.includes(parsed.name)) {
      AUTH_COOKIE_NAMES.forEach((name) => delete memoryCookieJar[name]);
    }
    if (CSRF_COOKIE_NAMES.includes(parsed.name)) {
      CSRF_COOKIE_NAMES.forEach((name) => delete memoryCookieJar[name]);
    }
    return;
  }

  // RFC 6265bis: Do not accept `Secure` or `__Host-` cookies from a plain `http:` response URL
  if (
    (parsed.secure || parsed.name.startsWith('__Host-')) &&
    typeof responseUrl === 'string' &&
    responseUrl.trim() !== ''
  ) {
    try {
      const parsedUrl = new URL(responseUrl);
      if (parsedUrl.protocol !== 'https:') {
        return;
      }
    } catch {
      // If responseUrl is not a full URL, proceed with attribute check
    }
  }

  if (AUTH_COOKIE_NAMES.includes(parsed.name)) {
    AUTH_COOKIE_NAMES.forEach((name) => {
      if (name !== parsed.name) {
        delete memoryCookieJar[name];
      }
    });
  } else if (CSRF_COOKIE_NAMES.includes(parsed.name)) {
    CSRF_COOKIE_NAMES.forEach((name) => {
      if (name !== parsed.name) {
        delete memoryCookieJar[name];
      }
    });
  }

  memoryCookieJar[parsed.name] = {
    name: parsed.name,
    value: parsed.value,
    path: parsed.path || '/',
    httpOnly: Boolean(parsed.httpOnly),
    secure: Boolean(parsed.secure || parsed.name.startsWith('__Host-')),
    sameSite: parsed.sameSite || 'lax',
    expiresAt: parsed.expiresAt ?? null,
    updatedAt: nowMs,
  };
}

/**
 * Captures and securely persists all `Set-Cookie` headers from a Fetch response.
 *
 * @param {Response} response
 * @param {string} [requestUrl]
 * @returns {Promise<void>}
 */
export async function storeCookiesFromResponse(response, requestUrl = '') {
  await ensureCookieJarHydrated();
  const setCookieHeaders = extractSetCookieHeaders(response);
  if (setCookieHeaders.length === 0) {
    return;
  }

  const effectiveUrl =
    (response && typeof response.url === 'string' && response.url) || requestUrl || '';
  const nowMs = Date.now();
  const previousJarSnapshot = { ...memoryCookieJar };

  setCookieHeaders.forEach((rawCookie) => {
    const parsed = parseSetCookieString(rawCookie, nowMs);
    if (parsed) {
      applyParsedCookieToJar(parsed, nowMs, effectiveUrl);
    }
  });

  try {
    await persistCookieJar();
  } catch (err) {
    memoryCookieJar = previousJarSnapshot;
    throw err;
  }
}

/**
 * Synchronizes the CSRF token in the cookie jar when `GET /api/auth/csrf` returns
 * `{ success: true, csrfToken }` in the response body.
 *
 * @param {string} csrfToken
 * @param {string} [requestUrl]
 */
export async function setCsrfTokenCookie(csrfToken, requestUrl = '') {
  if (!csrfToken || typeof csrfToken !== 'string' || !csrfToken.trim()) {
    return;
  }

  await ensureCookieJarHydrated();
  const previousJarSnapshot = { ...memoryCookieJar };

  const usesHostPrefix =
    Boolean(memoryCookieJar['__Host-qavora_auth_token']) ||
    Boolean(memoryCookieJar['__Host-qavora_csrf_token']);

  const cookieName = usesHostPrefix
    ? '__Host-qavora_csrf_token'
    : 'qavora_csrf_token';

  applyParsedCookieToJar(
    {
      name: cookieName,
      value: csrfToken.trim(),
      path: '/',
      httpOnly: false,
      secure: usesHostPrefix,
      sameSite: 'lax',
      expiresAt: null,
      shouldDelete: false,
    },
    Date.now(),
    requestUrl
  );

  try {
    await persistCookieJar();
  } catch (err) {
    memoryCookieJar = previousJarSnapshot;
    throw err;
  }
}

/**
 * Reads a CSRF token from a browser `document.cookie` string if running on Web.
 *
 * @returns {string | null}
 */
function getBrowserDocumentCsrfCookie() {
  try {
    if (
      typeof document !== 'undefined' &&
      typeof document.cookie === 'string' &&
      document.cookie
    ) {
      const pairs = document.cookie.split(';');
      let hostToken = null;
      let standardToken = null;

      for (const pair of pairs) {
        const idx = pair.indexOf('=');
        if (idx > 0) {
          const key = pair.slice(0, idx).trim();
          const val = pair.slice(idx + 1).trim();
          if (key === '__Host-qavora_csrf_token') {
            hostToken = decodeURIComponent(val);
          } else if (key === 'qavora_csrf_token') {
            standardToken = decodeURIComponent(val);
          }
        }
      }
      return hostToken || standardToken || null;
    }
  } catch {
    // Ignore DOM access errors
  }
  return null;
}

/**
 * Returns the active CSRF token for the `X-CSRF-Token` request header.
 *
 * @returns {string | null}
 */
export function getCsrfToken() {
  pruneExpiredCookies();

  for (const name of CSRF_COOKIE_NAMES) {
    const entry = memoryCookieJar[name];
    if (entry && typeof entry.value === 'string' && entry.value.trim()) {
      return entry.value.trim();
    }
  }

  return getBrowserDocumentCsrfCookie();
}

/**
 * Returns true if an unexpired authentication cookie is present in the jar.
 * Never returns or exposes the raw HttpOnly token string.
 *
 * @returns {boolean}
 */
export function hasAuthCookie() {
  pruneExpiredCookies();
  return AUTH_COOKIE_NAMES.some((name) => {
    const entry = memoryCookieJar[name];
    return Boolean(entry && typeof entry.value === 'string' && entry.value.trim());
  });
}

/**
 * Returns true if the active cookie jar holds production `__Host-` Secure cookies.
 *
 * @returns {boolean}
 */
export function hasHostPrefixedCookies() {
  pruneExpiredCookies();
  return Boolean(
    memoryCookieJar['__Host-qavora_auth_token'] ||
      memoryCookieJar['__Host-qavora_csrf_token']
  );
}

/**
 * Serializes all active, non-expired cookies into a single `Cookie` request header value.
 * Guarantees no duplicate cookie names and never sends `Secure` / `__Host-` cookies
 * over non-HTTPS (`http:`) URLs.
 *
 * @param {string} [requestUrl]
 * @returns {string}
 */
export function getCookieHeader(requestUrl = '') {
  pruneExpiredCookies();
  const entries = Object.values(memoryCookieJar);
  if (entries.length === 0) {
    return '';
  }

  let isHttpsRequest = null;
  if (typeof requestUrl === 'string' && requestUrl.trim() !== '') {
    try {
      const parsedUrl = new URL(requestUrl);
      isHttpsRequest = parsedUrl.protocol === 'https:';
    } catch {
      isHttpsRequest = null;
    }
  }

  const seenNames = new Set();

  return entries
    .filter((entry) => {
      if (
        !entry ||
        !entry.name ||
        typeof entry.value !== 'string' ||
        entry.value === ''
      ) {
        return false;
      }
      if (seenNames.has(entry.name)) {
        return false;
      }
      // Never transmit Secure or __Host- cookies over a plain http: URL
      if (
        (entry.secure || entry.name.startsWith('__Host-')) &&
        isHttpsRequest === false
      ) {
        return false;
      }
      seenNames.add(entry.name);
      return true;
    })
    .map((entry) => `${entry.name}=${encodeURIComponent(entry.value)}`)
    .join('; ');
}

/**
 * Clears all stored authentication and CSRF cookies from memory and SecureStore.
 */
export async function clearAllCookies() {
  memoryCookieJar = {};
  isHydrated = true;
  try {
    const storage = getStorage();
    if (storage && typeof storage.removeItem === 'function') {
      const res = await storage.removeItem(COOKIE_JAR_SECURE_STORE_KEY);
      return {
        ok: true,
        removed: Boolean(res ? res.removed !== false : true),
        error: null,
      };
    }
    return { ok: true, removed: false, error: null };
  } catch (err) {
    const persistenceErr =
      err instanceof CookiePersistenceError
        ? err
        : new CookiePersistenceError({
            message:
              'Unable to remove authentication session from secure device storage.',
            code: 'SECURE_STORE_DELETE_FAILED',
            category: 'persistence_failure',
            operation: 'delete',
            isTransient: false,
            cause: err,
          });
    recordRedactedPersistenceError(persistenceErr);
    return {
      ok: false,
      removed: false,
      error: persistenceErr,
    };
  }
}

/**
 * Resets in-memory hydration state so a cold application restart can be simulated in tests.
 */
export function resetCookieMemoryStateForRestart() {
  memoryCookieJar = {};
  isHydrated = false;
  hydrationPromise = null;
  secureStoreAvailability = null;
  availabilityCheckPromise = null;
  lastPersistenceError = null;
}

/**
 * Returns redacted diagnostic metadata (boolean flags only, never exposing secret token values).
 */
export function getRedactedCookieStatus() {
  pruneExpiredCookies();
  return {
    storageBackend: 'expo-secure-store',
    storageKey: COOKIE_JAR_SECURE_STORE_KEY,
    isHydrated,
    secureStoreAvailability:
      secureStoreAvailability === true
        ? 'available'
        : secureStoreAvailability === false
        ? 'unavailable_web'
        : 'unconfirmed',
    hasAuthCookie: hasAuthCookie(),
    hasCsrfCookie: Boolean(getCsrfToken()),
    usesHostPrefix: hasHostPrefixedCookies(),
    cookieNames: Object.keys(memoryCookieJar),
    lastPersistenceError,
  };
}

export const cookieManager = {
  CookiePersistenceError,
  checkSecureStoreAvailability,
  ensureHydrated: ensureCookieJarHydrated,
  storeCookiesFromResponse,
  setCsrfTokenCookie,
  getCsrfToken,
  hasAuthCookie,
  hasHostPrefixedCookies,
  getCookieHeader,
  clearAllCookies,
  resetCookieMemoryStateForRestart,
  getRedactedCookieStatus,
  setCookieStorageAdapter,
  setSecureStoreImplementation,
};

export default cookieManager;

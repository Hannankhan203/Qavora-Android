import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  memoryAsyncStorage,
  secureStoreMap,
  secureStoreController,
  mockSecureStoreModule,
  createRenderHarness,
  runWithNativeRuntime,
} from './helpers/testEnv.js';

const React = await import('react');
const { ThemeProvider } = await import('../src/theme/theme.js');
const {
  sanitizeSensitiveDiagnosticText,
  buildSafeDebugDiagnostics,
  getLastAuthDebugDiagnostic,
  formatAuthErrorMessage,
  setAuthUserStorageAdapter,
  loginUser,
  registerUser,
  restoreAuthenticatedSession,
} = await import('../src/services/authService.js');
const { AuthProvider, useAuth } = await import('../src/context/AuthContext.js');
const AuthScreen = (await import('../src/components/AuthScreen.js')).default;
const {
  onUnauthorizedResponse,
  ApiClientError,
  validateBaseUrl,
  isLocalMockBackendActive,
  apiClient,
  checkBackendHealth,
} = await import('../src/services/apiClient.js');
const {
  localMockFetch,
  hasActiveLocalMockSession,
  setLocalMockStorageAdapter,
  resetLocalMockMemoryForTests,
} = await import('../src/services/localMockBackend.js');
const {
  COOKIE_JAR_SECURE_STORE_KEY,
  CookiePersistenceError,
  checkSecureStoreAvailability,
  ensureCookieJarHydrated,
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
} = await import('../src/services/cookieManager.js');
const { ProjectProvider, useProjects, setProjectStorageAdapter } = await import(
  '../src/context/ProjectContext.js'
);
const {
  setActiveSyncUser,
  getActiveSyncUser,
  setOfflineSyncStorageAdapter,
  connectivityMonitorState,
} = await import('../src/services/offlineSync/syncState.js');
const { cacheProjectOffline, getCachedProjectsForUser } = await import(
  '../src/services/offlineSyncService.js'
);
const {
  cacheChecklistOffline,
  getCachedChecklistsForUser,
  setChecklistStorageAdapter,
} = await import('../src/services/checklists/checklistCache.js');

// =============================================================================
// 1. HIGH-04 — Intentional Sign-out vs Session Expired Notice
// =============================================================================
describe('HIGH-04 — Intentional Sign-out vs Session Expired Notice', () => {
  const originalFetch = globalThis.fetch;
  const originalApiUrl = process.env.EXPO_PUBLIC_API_BASE_URL;
  let harness;

  beforeEach(async () => {
    memoryAsyncStorage._map.clear();
    secureStoreController.reset();
    setCookieStorageAdapter(null);
    setSecureStoreImplementation(mockSecureStoreModule);
    setAuthUserStorageAdapter(memoryAsyncStorage);
    await clearAllCookies();
    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://qavora.example.test';
    harness = await createRenderHarness();
  });

  afterEach(async () => {
    await harness.cleanup();
    globalThis.fetch = originalFetch;
    if (originalApiUrl === undefined) {
      delete process.env.EXPO_PUBLIC_API_BASE_URL;
    } else {
      process.env.EXPO_PUBLIC_API_BASE_URL = originalApiUrl;
    }
    await clearAllCookies();
  });

  it('maps logout context without session-expired or invalid-credentials fallback', () => {
    expect(formatAuthErrorMessage('You have been signed out.', 'logout')).toBe(
      'You have been signed out.'
    );
    expect(
      formatAuthErrorMessage({ status: 401, message: 'Unauthorized' }, 'logout')
    ).toBe('You have been signed out.');
    expect(
      formatAuthErrorMessage({ status: 401, message: 'Unauthorized' }, 'session')
    ).toBe('Your session has expired or is no longer valid. Please sign in again.');
  });

  it('intentional logout displays sign-out notice even alongside concurrent 401, and preserves real session expiry notices', async () => {
    let authRef = null;
    let meMode = 'none';
    let logoutHook = null;

    globalThis.fetch = async (url, init = {}) => {
      const target = String(url);
      if (target.endsWith('/api/auth/me')) {
        if (meMode === 'expired') {
          return new Response(JSON.stringify({ error: 'Session expired' }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          });
        }
        if (meMode === 'none') {
          return new Response(JSON.stringify({ user: null }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(
          JSON.stringify({
            user: {
              userId: 'user-1',
              email: 'qa@example.com',
              name: 'QA Tester',
              role: 'QA Tester',
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (target.endsWith('/api/auth/login')) {
        const body = JSON.parse(init.body || '{}');
        if (body.password === 'wrong') {
          return new Response(
            JSON.stringify({ error: 'Invalid email or password' }),
            { status: 401, headers: { 'content-type': 'application/json' } }
          );
        }
        return new Response(
          JSON.stringify({
            user: {
              userId: 'user-1',
              email: body.email,
              name: 'QA Tester',
              role: 'QA Tester',
            },
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json',
              'set-cookie':
                'qavora_auth_token=tok_abc; Path=/; HttpOnly, qavora_csrf_token=csrf_abc; Path=/',
            },
          }
        );
      }
      if (target.endsWith('/api/auth/csrf')) {
        return new Response(JSON.stringify({ csrfToken: 'csrf_abc' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (target.endsWith('/api/auth/logout')) {
        if (typeof logoutHook === 'function') {
          await logoutHook();
        }
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (target.endsWith('/api/projects')) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('{}', { status: 404 });
    };

    function Harness() {
      const auth = useAuth();
      authRef = auth;
      if (!auth.isAuthenticated && !auth.isRestoringSession) {
        return React.createElement(AuthScreen);
      }
      return React.createElement('div', null, `Signed in: ${auth.user?.email || ''}`);
    }

    await harness.render(
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(AuthProvider, null, React.createElement(Harness))
      )
    );

    expect(authRef.isAuthenticated).toBe(false);
    expect(authRef.authNotice).toBeNull();
    expect(harness.container.textContent).not.toContain('session has expired');

    // Failed login produces authError, no authNotice
    await React.act(async () => {
      await authRef.login('qa@example.com', 'wrong');
    });
    expect(authRef.isAuthenticated).toBe(false);
    expect(authRef.authError).toContain('Invalid email or password');
    expect(authRef.authNotice).toBeNull();

    // Subsequent valid login clears authError
    await React.act(async () => {
      await authRef.login('qa@example.com', 'correct-pass');
    });
    expect(authRef.isAuthenticated).toBe(true);
    expect(authRef.authError).toBeNull();
    expect(authRef.authNotice).toBeNull();
    expect(authRef.authNoticeType).toBeNull();

    // Intentional logout with concurrent protected 401
    logoutHook = async () => {
      meMode = 'expired';
      const { apiGet } = await import('../src/services/apiClient.js');
      try {
        await apiGet('/api/projects');
      } catch {
        // expected concurrent 401
      }
    };

    await React.act(async () => {
      await authRef.logout();
    });
    logoutHook = null;

    expect(authRef.isAuthenticated).toBe(false);
    expect(authRef.authError).toBeNull();
    expect(authRef.authNotice).toBe('You have been signed out.');
    expect(authRef.authNoticeType).toBe('logout');
    expect(harness.container.textContent).toContain('You have been signed out.');
    expect(harness.container.textContent.toLowerCase()).not.toContain(
      'session has expired'
    );

    // Genuine 401 while authenticated shows session-expired notice
    meMode = 'valid';
    await React.act(async () => {
      await authRef.login('qa@example.com', 'correct-pass');
    });
    expect(authRef.isAuthenticated).toBe(true);

    await React.act(async () => {
      const { apiGet } = await import('../src/services/apiClient.js');
      try {
        await apiGet('/api/projects');
      } catch {
        // expected 401 triggers unauthorized listener
      }
    });

    expect(authRef.isAuthenticated).toBe(false);
    expect(authRef.authNoticeType).toBe('session_expired');
    expect(authRef.authNotice).toBe(
      'Your session has expired or is no longer valid. Please sign in again.'
    );
    expect(harness.container.textContent).toContain(
      'Your session has expired or is no longer valid. Please sign in again.'
    );

    // Expired session during restoreSession also displays session-expired notice
    await React.act(async () => {
      await authRef.login('qa@example.com', 'correct-pass');
    });
    await setCsrfTokenCookie('csrf_abc');
    meMode = 'expired';

    await React.act(async () => {
      await authRef.restoreSession();
    });
    expect(authRef.isAuthenticated).toBe(false);
    expect(authRef.authNoticeType).toBe('session_expired');

    // Subsequent login clears notices cleanly
    meMode = 'valid';
    await React.act(async () => {
      await authRef.login('qa@example.com', 'correct-pass');
    });
    expect(authRef.isAuthenticated).toBe(true);
    expect(authRef.authNotice).toBeNull();
    expect(authRef.authNoticeType).toBeNull();
    expect(authRef.authError).toBeNull();

    const unsub = onUnauthorizedResponse(() => {});
    unsub();
  });
});

// =============================================================================
// 2. Authentication Error & Diagnostic Sanitization
// =============================================================================
describe('Authentication Error & Diagnostic Sanitization', () => {
  it('redacts JWTs, Bearer tokens, cookies, MongoDB URIs, paths, stack frames, and E11000 internals', () => {
    const raw = [
      'Auth failed with Bearer super_secret_bearer_token_12345',
      'Token was eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyMSJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
      'qavora_session=rawSessionValue999; __Host-qavora_csrf=csrfVal123',
      'Failed connecting to mongodb+srv://admin:secretpass@cluster0.mongodb.net/qavora?retryWrites=true',
      'Read /Users/dev/qavora/server.ts failed: E11000 duplicate key error collection: qavora.users index: email_1',
      '\n    at AuthController.login (/var/task/controllers/authController.js:42:11)',
    ].join('\n');

    const sanitized = sanitizeSensitiveDiagnosticText(raw);

    expect(sanitized).not.toContain('super_secret_bearer_token_12345');
    expect(sanitized).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(sanitized).not.toContain('rawSessionValue999');
    expect(sanitized).not.toContain('csrfVal123');
    expect(sanitized).not.toContain('mongodb+srv://');
    expect(sanitized).not.toContain('secretpass');
    expect(sanitized).not.toContain('/Users/dev/qavora');
    expect(sanitized).not.toContain('/var/task/controllers');
    expect(sanitized).not.toContain('E11000');

    expect(sanitized).toContain('Bearer [REDACTED]');
    expect(sanitized).toContain('[REDACTED_JWT]');
    expect(sanitized).toContain('[REDACTED_COOKIE]');
    expect(sanitized).toContain('[REDACTED_DB_URI]');
    expect(sanitized).toContain('[INTERNAL_PATH]');
    expect(sanitized).toContain('Duplicate account record');
  });

  it('maps HTTP statuses, timeouts, network errors, CSRF, and DB leaks into safe user strings and records safe diagnostics', () => {
    expect(formatAuthErrorMessage({ isTimeout: true }, 'login')).toContain(
      'took too long to respond'
    );
    expect(formatAuthErrorMessage({ isTimeout: true }, 'health')).toContain(
      'connection timed out'
    );
    expect(formatAuthErrorMessage({ isNetworkError: true }, 'login')).toContain(
      'Unable to connect to the Qavora server'
    );
    expect(
      formatAuthErrorMessage({ status: 429, message: 'Rate limit exceeded' })
    ).toContain('Too many authentication attempts');
    expect(
      formatAuthErrorMessage({
        status: 409,
        message: 'E11000 duplicate key error collection: users',
      })
    ).toContain('An account with this email address already exists');
    expect(
      formatAuthErrorMessage({ status: 403, message: 'Invalid CSRF token' })
    ).toContain('security verification token expired (HTTP 403)');
    expect(
      formatAuthErrorMessage({
        status: 403,
        message: 'Cross-origin request rejected',
      })
    ).toContain('Request origin was rejected');
    expect(
      formatAuthErrorMessage({
        status: 500,
        message:
          'MongooseError connecting to mongodb://prod-db:27017/qavora <script>alert(1)</script>',
      })
    ).toBe(
      'The Qavora server is temporarily unavailable. Please try again in a few moments.'
    );

    const fieldMsg = formatAuthErrorMessage({
      status: 400,
      error: 'Password must be at least 8 characters.',
    });
    expect(fieldMsg).toBe('Password must be at least 8 characters.');

    const diag = buildSafeDebugDiagnostics(
      {
        status: 500,
        code: 'DB_ERR',
        message:
          'Failed with token=secret_abcdef1234567890 at /var/task/auth.js:12',
      },
      'login'
    );
    expect(diag.code).toBe('DB_ERR');
    expect(diag.sanitizedSummary).not.toContain('secret_abcdef1234567890');
    expect(diag.sanitizedSummary).not.toContain('/var/task/auth.js');
    expect(getLastAuthDebugDiagnostic()).toEqual(diag);
  });
});

// =============================================================================
// 3. MED-02 — Native Cookie Persistence & Security (SecureStore)
// =============================================================================
describe('MED-02 — Native Cookie Persistence & Security Behavior', () => {
  beforeEach(() => {
    secureStoreController.reset();
    memoryAsyncStorage._map.clear();
    setCookieStorageAdapter(null);
    setSecureStoreImplementation(mockSecureStoreModule);
    resetCookieMemoryStateForRestart();
  });

  afterEach(async () => {
    secureStoreController.reset();
    resetCookieMemoryStateForRestart();
    await clearAllCookies();
  });

  it('persists cookies to SecureStore with AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY and survives simulated cold restart', async () => {
    await runWithNativeRuntime(async () => {
      const response = new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          'set-cookie':
            '__Host-qavora_auth_token=tok_prod_123; Path=/; HttpOnly; Secure; SameSite=Strict',
        },
      });
      await storeCookiesFromResponse(response, 'https://api.qavora.app/api/auth/login');
      await setCsrfTokenCookie('csrf_prod_456', 'https://api.qavora.app/api/auth/csrf');

      expect(secureStoreMap.has(COOKIE_JAR_SECURE_STORE_KEY)).toBe(true);
      expect(secureStoreController.setCalls.length).toBeGreaterThanOrEqual(2);
      expect(
        secureStoreController.setCalls.every(
          (c) =>
            c.key === COOKIE_JAR_SECURE_STORE_KEY &&
            c.options?.keychainAccessible ===
              mockSecureStoreModule.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY
        )
      ).toBe(true);

      // Nothing written to plaintext AsyncStorage
      expect(memoryAsyncStorage._map.size).toBe(0);

      // Simulate cold app restart
      resetCookieMemoryStateForRestart();
      expect(hasAuthCookie()).toBe(false);

      await ensureCookieJarHydrated();
      expect(hasAuthCookie()).toBe(true);
      expect(hasHostPrefixedCookies()).toBe(true);
      expect(getCsrfToken()).toBe('csrf_prod_456');

      const httpsHeader = getCookieHeader('https://api.qavora.app/api/projects');
      expect(httpsHeader).toContain('__Host-qavora_auth_token=tok_prod_123');
      expect(httpsHeader).toContain('__Host-qavora_csrf_token=csrf_prod_456');

      // Status redacts secret values
      const status = getRedactedCookieStatus();
      expect(status.storageBackend).toBe('expo-secure-store');
      expect(status.hasAuthCookie).toBe(true);
      expect(JSON.stringify(status)).not.toContain('tok_prod_123');
      expect(JSON.stringify(status)).not.toContain('csrf_prod_456');
    });
  });

  it('retries transient SecureStore availability errors without permanently caching unavailable', async () => {
    await runWithNativeRuntime(async () => {
      secureStoreController.availableQueue = [
        new Error('Transient keystore warm-up'),
        new Error('Transient keystore warm-up 2'),
        true,
      ];

      const availability = await checkSecureStoreAvailability();
      expect(availability.available).toBe(true);
      expect(availability.status).toBe('available');
      expect(secureStoreController.availableQueue.length).toBe(0);

      // If all availability retries fail cleanly (returns false), must NOT permanently lock as unavailable
      resetCookieMemoryStateForRestart();
      secureStoreController.available = false;
      const unavailableRes = await checkSecureStoreAvailability();
      expect(unavailableRes.available).toBe(false);
      expect(unavailableRes.status).toBe('unavailable');
      expect(unavailableRes.error).toBeInstanceOf(CookiePersistenceError);

      // Once device unlocks and returns true later, recovery succeeds
      secureStoreController.available = true;
      const recoveredRes = await checkSecureStoreAvailability();
      expect(recoveredRes.available).toBe(true);
    });
  });

  it('throws CookiePersistenceError and rolls back memory jar when SecureStore write fails on native', async () => {
    await runWithNativeRuntime(async () => {
      // Seed one good cookie first
      const goodRes = new Response('{}', {
        status: 200,
        headers: {
          'set-cookie': 'qavora_auth_token=initial_tok; Path=/; HttpOnly',
        },
      });
      await storeCookiesFromResponse(goodRes, 'https://api.qavora.app/api/auth/login');
      expect(getCookieHeader('https://api.qavora.app/api/projects')).toContain(
        'qavora_auth_token=initial_tok'
      );

      // Next write fails in native SecureStore
      secureStoreController.failSet = new Error('Keychain locked');
      const nextRes = new Response('{}', {
        status: 200,
        headers: {
          'set-cookie': 'qavora_auth_token=new_tok; Path=/; HttpOnly',
        },
      });

      let caught = null;
      try {
        await storeCookiesFromResponse(nextRes, 'https://api.qavora.app/api/auth/login');
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(CookiePersistenceError);
      expect(caught.code).toBe('SECURE_STORE_WRITE_FAILED');
      // In-memory jar rolled back to initial_tok
      expect(getCookieHeader('https://api.qavora.app/api/projects')).toContain(
        'qavora_auth_token=initial_tok'
      );
      expect(getCookieHeader('https://api.qavora.app/api/projects')).not.toContain(
        'new_tok'
      );
    });
  });

  it('enforces RFC 6265bis __Host- rules, HTTPS transmission boundary, and single-cookie deduplication', async () => {
    await runWithNativeRuntime(async () => {
      // 1. Reject invalid __Host- with Domain attribute or non-root Path
      const invalidHostRes = new Response('{}', {
        status: 200,
        headers: {
          'set-cookie':
            '__Host-qavora_auth_token=bad_host; Path=/api; Secure; HttpOnly',
        },
      });
      await storeCookiesFromResponse(invalidHostRes, 'https://api.qavora.app/api/auth/login');
      expect(hasAuthCookie()).toBe(false);

      const invalidHostWithDomain = new Response('{}', {
        status: 200,
        headers: {
          'set-cookie':
            '__Host-qavora_auth_token=bad_domain; Path=/; Domain=qavora.app; Secure',
        },
      });
      await storeCookiesFromResponse(
        invalidHostWithDomain,
        'https://api.qavora.app/api/auth/login'
      );
      expect(hasAuthCookie()).toBe(false);

      // 2. Refuse Secure / __Host- cookies arriving from plain http:// URL
      const httpSourceRes = new Response('{}', {
        status: 200,
        headers: {
          'set-cookie':
            '__Host-qavora_auth_token=from_http; Path=/; Secure; HttpOnly',
        },
      });
      await storeCookiesFromResponse(httpSourceRes, 'http://api.qavora.app/api/auth/login');
      expect(hasAuthCookie()).toBe(false);

      // 3. Accept standard non-host cookie first, then overwrite cleanly when __Host- arrives (deduplication)
      const stdRes = new Response('{}', {
        status: 200,
        headers: {
          'set-cookie': 'qavora_auth_token=dev_tok; Path=/; HttpOnly',
        },
      });
      await storeCookiesFromResponse(stdRes, 'https://api.qavora.app/api/auth/login');

      const prodRes = new Response('{}', {
        status: 200,
        headers: {
          'set-cookie':
            '__Host-qavora_auth_token=prod_tok; Path=/; Secure; HttpOnly',
        },
      });
      await storeCookiesFromResponse(prodRes, 'https://api.qavora.app/api/auth/login');

      const httpsHeader = getCookieHeader('https://api.qavora.app/api/projects');
      expect(httpsHeader).toBe('__Host-qavora_auth_token=prod_tok');
      // Plain http: request URL must NOT receive Secure / __Host- cookies
      expect(getCookieHeader('http://api.qavora.app/api/projects')).toBe('');

      const clearRes = await clearAllCookies();
      expect(clearRes.ok).toBe(true);
      expect(hasAuthCookie()).toBe(false);
      expect(secureStoreMap.has(COOKIE_JAR_SECURE_STORE_KEY)).toBe(false);
    });
  });
});

// =============================================================================
// 4. HIGH-06 — ProjectContext Render Purity & User Isolation
// =============================================================================
describe('HIGH-06 — ProjectContext Render Purity & User Isolation', () => {
  const originalFetch = globalThis.fetch;
  const originalApiUrl = process.env.EXPO_PUBLIC_API_BASE_URL;
  let harness;

  beforeEach(async () => {
    memoryAsyncStorage._map.clear();
    secureStoreController.reset();
    setCookieStorageAdapter(null);
    setSecureStoreImplementation(mockSecureStoreModule);
    setAuthUserStorageAdapter(memoryAsyncStorage);
    setProjectStorageAdapter(memoryAsyncStorage);
    setOfflineSyncStorageAdapter(memoryAsyncStorage);
    setChecklistStorageAdapter(memoryAsyncStorage);
    setActiveSyncUser(null);
    await clearAllCookies();
    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://qavora.example.test';
    harness = await createRenderHarness();
  });

  afterEach(async () => {
    await harness.cleanup();
    setActiveSyncUser(null);
    globalThis.fetch = originalFetch;
    if (originalApiUrl === undefined) {
      delete process.env.EXPO_PUBLIC_API_BASE_URL;
    } else {
      process.env.EXPO_PUBLIC_API_BASE_URL = originalApiUrl;
    }
    await clearAllCookies();
  });

  it('isolates cached projects and checklists per user without cross-user leakage', async () => {
    await cacheProjectOffline(
      { id: 'proj-A1', name: 'Alpha Private Project', userId: 'user-A', status: 'Active' },
      'user-A'
    );
    await cacheProjectOffline(
      { id: 'proj-B1', name: 'Beta Private Project', userId: 'user-B', status: 'Active' },
      'user-B'
    );
    await cacheChecklistOffline(
      { id: 'chk-A1', title: 'Alpha Release Gate', userId: 'user-A', items: [] },
      'user-A'
    );
    await cacheChecklistOffline(
      { id: 'chk-B1', title: 'Beta Security Gate', userId: 'user-B', items: [] },
      'user-B'
    );

    const aProjects = await getCachedProjectsForUser('user-A');
    const bProjects = await getCachedProjectsForUser('user-B');
    const aChecklists = await getCachedChecklistsForUser('user-A');
    const bChecklists = await getCachedChecklistsForUser('user-B');

    expect(aProjects.map((p) => p.id)).toEqual(['proj-A1']);
    expect(bProjects.map((p) => p.id)).toEqual(['proj-B1']);
    expect(aChecklists.map((c) => c.id)).toEqual(['chk-A1']);
    expect(bChecklists.map((c) => c.id)).toEqual(['chk-B1']);
  });

  it('preserves StrictMode render purity, transitions activeSyncUser A -> B safely, and cleans up on logout', async () => {
    await cacheProjectOffline(
      { id: 'proj-A1', name: 'Alpha Private Project', userId: 'user-A', status: 'Active' },
      'user-A'
    );
    await cacheProjectOffline(
      { id: 'proj-B1', name: 'Beta Private Project', userId: 'user-B', status: 'Active' },
      'user-B'
    );

    let currentServerUser = {
      userId: 'user-A',
      email: 'a@example.com',
      name: 'User Alpha',
      role: 'QA Tester',
    };

    globalThis.fetch = async (url) => {
      const target = String(url);
      if (target.endsWith('/api/auth/me')) {
        return new Response(JSON.stringify({ user: currentServerUser }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (target.endsWith('/api/auth/csrf')) {
        return new Response(JSON.stringify({ csrfToken: 'csrf_test' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (target.endsWith('/api/auth/logout')) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (target.includes('/api/projects')) {
        const list =
          getActiveSyncUser() === 'user-A'
            ? [
                {
                  id: 'proj-A1',
                  name: 'Alpha Private Project',
                  userId: 'user-A',
                  status: 'Active',
                },
              ]
            : getActiveSyncUser() === 'user-B'
            ? [
                {
                  id: 'proj-B1',
                  name: 'Beta Private Project',
                  userId: 'user-B',
                  status: 'Active',
                },
              ]
            : [];
        return new Response(JSON.stringify(list), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    await storeCookiesFromResponse(
      new Response('{}', {
        status: 200,
        headers: { 'set-cookie': 'qavora_auth_token=tok_a; Path=/; HttpOnly' },
      }),
      'https://qavora.example.test/api/auth/login'
    );

    const syncUserSeenDuringRender = [];
    let latestProjectsCtx = null;
    let authControl = null;

    function Observer() {
      syncUserSeenDuringRender.push({
        activeSyncUserAtRender: getActiveSyncUser(),
      });
      latestProjectsCtx = useProjects();
      return React.createElement(
        'div',
        null,
        `Projects: ${latestProjectsCtx.projects.length}`
      );
    }

    function RootGate() {
      const auth = useAuth();
      authControl = auth;
      if (!auth.isAuthenticated) {
        return React.createElement('div', null, 'Unauthenticated');
      }
      return React.createElement(ProjectProvider, null, React.createElement(Observer));
    }

    await harness.render(
      React.createElement(
        React.StrictMode,
        null,
        React.createElement(AuthProvider, null, React.createElement(RootGate))
      )
    );
    await harness.flush(40);

    expect(syncUserSeenDuringRender[0].activeSyncUserAtRender).toBeNull();
    expect(getActiveSyncUser()).toBe('user-A');
    expect(latestProjectsCtx.projects.map((p) => p.id)).toEqual(['proj-A1']);

    // Switch A -> B
    syncUserSeenDuringRender.length = 0;
    currentServerUser = {
      userId: 'user-B',
      email: 'b@example.com',
      name: 'User Beta',
      role: 'QA Tester',
    };
    await React.act(async () => {
      await authControl.refreshCurrentUser();
    });
    await harness.flush(40);

    expect(syncUserSeenDuringRender[0].activeSyncUserAtRender).toBe('user-A');
    expect(getActiveSyncUser()).toBe('user-B');
    expect(latestProjectsCtx.projects.map((p) => p.id)).toEqual(['proj-B1']);

    // Pending reconnect timer cleared on logout / unmount
    connectivityMonitorState.pendingReconnectUserId = 'user-B';
    connectivityMonitorState.pendingReconnectTimer = setTimeout(() => {}, 5000);

    await React.act(async () => {
      await authControl.logout();
    });

    expect(getActiveSyncUser()).toBeNull();
    expect(connectivityMonitorState.pendingReconnectTimer).toBeNull();
    expect(connectivityMonitorState.pendingReconnectUserId).toBeNull();

    // Restore session as User B mounts cleanly
    await storeCookiesFromResponse(
      new Response('{}', {
        status: 200,
        headers: { 'set-cookie': 'qavora_auth_token=tok_b; Path=/; HttpOnly' },
      }),
      'https://qavora.example.test/api/auth/login'
    );
    syncUserSeenDuringRender.length = 0;
    await React.act(async () => {
      await authControl.restoreSession();
    });
    await harness.flush(40);

    expect(syncUserSeenDuringRender[0].activeSyncUserAtRender).toBeNull();
    expect(getActiveSyncUser()).toBe('user-B');
    expect(latestProjectsCtx.projects.map((p) => p.id)).toEqual(['proj-B1']);
  });
});

// =============================================================================
// 6. HIGH-01 — Mock Backend Security Hardening
// =============================================================================
describe('HIGH-01 — Mock Backend Security Hardening', () => {
  const originalFetch = globalThis.fetch;
  const originalApiUrl = process.env.EXPO_PUBLIC_API_BASE_URL;
  const originalApiUrlFallback = process.env.EXPO_PUBLIC_API_URL;
  const originalAllowMock = process.env.EXPO_PUBLIC_ALLOW_LOCAL_MOCK;
  const originalExpoEnv = process.env.EXPO_PUBLIC_ENV;
  const originalNodeEnv = process.env.NODE_ENV;
  let harness;

  beforeEach(async () => {
    memoryAsyncStorage._map.clear();
    secureStoreController.reset();
    setCookieStorageAdapter(null);
    setSecureStoreImplementation(mockSecureStoreModule);
    setAuthUserStorageAdapter(memoryAsyncStorage);
    setLocalMockStorageAdapter(memoryAsyncStorage);
    resetLocalMockMemoryForTests();
    await clearAllCookies();
    delete process.env.EXPO_PUBLIC_API_BASE_URL;
    delete process.env.EXPO_PUBLIC_API_URL;
    delete process.env.EXPO_PUBLIC_ALLOW_LOCAL_MOCK;
    delete process.env.EXPO_PUBLIC_ENV;
    process.env.NODE_ENV = 'test';
    harness = await createRenderHarness();
  });

  afterEach(async () => {
    await harness.cleanup();
    globalThis.fetch = originalFetch;
    setLocalMockStorageAdapter(null);
    resetLocalMockMemoryForTests();

    if (originalApiUrl === undefined) {
      delete process.env.EXPO_PUBLIC_API_BASE_URL;
    } else {
      process.env.EXPO_PUBLIC_API_BASE_URL = originalApiUrl;
    }
    if (originalApiUrlFallback === undefined) {
      delete process.env.EXPO_PUBLIC_API_URL;
    } else {
      process.env.EXPO_PUBLIC_API_URL = originalApiUrlFallback;
    }
    if (originalAllowMock === undefined) {
      delete process.env.EXPO_PUBLIC_ALLOW_LOCAL_MOCK;
    } else {
      process.env.EXPO_PUBLIC_ALLOW_LOCAL_MOCK = originalAllowMock;
    }
    if (originalExpoEnv === undefined) {
      delete process.env.EXPO_PUBLIC_ENV;
    } else {
      process.env.EXPO_PUBLIC_ENV = originalExpoEnv;
    }
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    await clearAllCookies();
  });

  it('1. missing API URL in production fails closed even if EXPO_PUBLIC_ALLOW_LOCAL_MOCK=true', async () => {
    process.env.EXPO_PUBLIC_ENV = 'production';
    process.env.NODE_ENV = 'production';
    process.env.EXPO_PUBLIC_ALLOW_LOCAL_MOCK = 'true';

    expect(isLocalMockBackendActive()).toBe(false);
    expect(validateBaseUrl('')).toEqual({
      valid: false,
      code: 'INVALID_BASE_URL',
      reason: expect.stringContaining('not configured for production'),
    });

    let prodErr = null;
    try {
      await apiClient.get('/api/projects');
    } catch (err) {
      prodErr = err;
    }
    expect(prodErr).toBeInstanceOf(ApiClientError);
    expect(prodErr?.code).toBe('INVALID_BASE_URL');

    const directMockRes = await localMockFetch('http://localhost:3000/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'prod@example.com', password: 'Password123!' }),
    });
    expect(directMockRes.status).toBe(403);
    expect(await hasActiveLocalMockSession()).toBe(false);
  });

  it('2. missing API URL in development/test does NOT silently activate mock mode', async () => {
    delete process.env.EXPO_PUBLIC_ALLOW_LOCAL_MOCK;
    expect(isLocalMockBackendActive()).toBe(false);

    const healthRes = await checkBackendHealth();
    expect(healthRes.ok).toBe(false);
    expect(healthRes.error?.code).toBe('INVALID_BASE_URL');

    const loginRes = await loginUser({
      email: 'silent@example.com',
      password: 'Password123!',
    });
    expect(loginRes.ok).toBe(false);
    expect(loginRes.user).toBeNull();
    expect(loginRes.error).toContain('not configured properly');

    const registerRes = await registerUser({
      name: 'Silent Tester',
      email: 'silent@example.com',
      password: 'Password123!',
    });
    expect(registerRes.ok).toBe(false);
    expect(registerRes.user).toBeNull();

    const restoreRes = await restoreAuthenticatedSession();
    expect(restoreRes.ok).toBe(false);
    expect(restoreRes.code).toBe('INVALID_BASE_URL');
    expect(restoreRes.reason).toBe('UNCONFIGURED_BASE_URL');

    expect(memoryAsyncStorage._map.get('@qavora_local_mock_backend_v1')).toBeUndefined();
  });

  it('3. explicit EXPO_PUBLIC_ALLOW_LOCAL_MOCK=true activates demo mode and shows LOCAL DEMO BACKEND indicator', async () => {
    process.env.EXPO_PUBLIC_ALLOW_LOCAL_MOCK = 'true';
    expect(isLocalMockBackendActive()).toBe(true);

    const healthRes = await checkBackendHealth();
    expect(healthRes.ok).toBe(true);
    expect(healthRes.data?.mode).toBe('local-mock');

    globalThis.fetch = async () => {
      throw new Error('Network fetch must not be called in explicit local mock mode');
    };

    await harness.render(
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(AuthProvider, null, React.createElement(AuthScreen))
      )
    );
    await harness.flush(30);

    const indicators = harness.findByAttr(
      'data-testid',
      'local-demo-backend-indicator'
    );
    expect(indicators.length).toBe(1);
    expect(indicators[0].textContent).toContain('LOCAL DEMO BACKEND');
  });

  it('4 & 5. unknown email login fails with 401 and does NOT auto-create accounts', async () => {
    process.env.EXPO_PUBLIC_ALLOW_LOCAL_MOCK = 'true';

    const attempt = await loginUser({
      email: 'unknown.tester@example.com',
      password: 'Password123!',
    });

    expect(attempt.ok).toBe(false);
    expect(attempt.status).toBe(401);
    expect(attempt.user).toBeNull();
    expect(await hasActiveLocalMockSession()).toBe(false);

    const persistedRaw = memoryAsyncStorage._map.get('@qavora_local_mock_backend_v1');
    if (persistedRaw) {
      const persisted = JSON.parse(persistedRaw);
      expect(Object.keys(persisted.users || {})).toHaveLength(0);
    }
  });

  it('6. registration avoids persisting any password/secret to AsyncStorage while authenticating non-persistently in RAM', async () => {
    process.env.EXPO_PUBLIC_ALLOW_LOCAL_MOCK = 'true';

    const regRes = await registerUser({
      name: 'Demo Tester',
      email: 'demo.tester@example.com',
      password: 'SuperSecretDemoPassword!99',
      role: 'QA Tester',
    });

    expect(regRes.ok).toBe(true);
    expect(regRes.user?.email).toBe('demo.tester@example.com');

    const persistedRaw = memoryAsyncStorage._map.get('@qavora_local_mock_backend_v1');
    expect(typeof persistedRaw).toBe('string');
    expect(persistedRaw).not.toContain('SuperSecretDemoPassword!99');
    expect(persistedRaw).not.toContain('"password"');
    expect(persistedRaw).not.toContain('"passwordHash"');

    const persisted = JSON.parse(persistedRaw);
    const savedUsers = Object.values(persisted.users || {});
    expect(savedUsers).toHaveLength(1);
    expect(savedUsers[0].password).toBeUndefined();
    expect(savedUsers[0].passwordHash).toBeUndefined();
    expect(savedUsers[0].salt).toBeUndefined();

    // Wrong password fails 401
    const wrongLogin = await loginUser({
      email: 'demo.tester@example.com',
      password: 'WrongPassword!11',
    });
    expect(wrongLogin.ok).toBe(false);
    expect(wrongLogin.status).toBe(401);

    // Correct password succeeds in the same active runtime
    const goodLogin = await loginUser({
      email: 'demo.tester@example.com',
      password: 'SuperSecretDemoPassword!99',
    });
    expect(goodLogin.ok).toBe(true);
    expect(goodLogin.status).toBe(200);

    // Simulating cold restart clears ephemeral RAM credential map; password is NOT persisted on disk
    resetLocalMockMemoryForTests();
    const afterRestartLogin = await loginUser({
      email: 'demo.tester@example.com',
      password: 'SuperSecretDemoPassword!99',
    });
    expect(afterRestartLogin.ok).toBe(false);
    expect(afterRestartLogin.status).toBe(401);
  });

  it('7. scrubs legacy persisted plaintext passwords from existing stored mock records on load', async () => {
    process.env.EXPO_PUBLIC_ALLOW_LOCAL_MOCK = 'true';

    await memoryAsyncStorage.setItem(
      '@qavora_local_mock_backend_v1',
      JSON.stringify({
        users: {
          user_legacy_1: {
            userId: 'user_legacy_1',
            email: 'legacy@example.com',
            name: 'Legacy User',
            role: 'QA Tester',
            password: 'ExposedLegacyPlaintextPassword!',
            passwordHash: 'stale_hash',
            token: 'stale_token',
          },
        },
        activeUserId: null,
        csrfToken: 'mock_csrf_legacy',
        projectsByUser: {},
        checklistsByUser: {},
        snapshotsByUser: {},
      })
    );

    const loginRes = await loginUser({
      email: 'legacy@example.com',
      password: 'ExposedLegacyPlaintextPassword!',
    });
    expect(loginRes.ok).toBe(false);
    expect(loginRes.status).toBe(401);

    const migratedRaw = memoryAsyncStorage._map.get('@qavora_local_mock_backend_v1');
    expect(migratedRaw).not.toContain('ExposedLegacyPlaintextPassword!');
    expect(migratedRaw).not.toContain('stale_hash');
    expect(migratedRaw).not.toContain('stale_token');

    const migrated = JSON.parse(migratedRaw);
    expect(migrated.users.user_legacy_1.email).toBe('legacy@example.com');
    expect(migrated.users.user_legacy_1.password).toBeUndefined();
    expect(migrated.users.user_legacy_1.passwordHash).toBeUndefined();
    expect(migrated.users.user_legacy_1.token).toBeUndefined();
  });

  it('8. real backend configuration overrides EXPO_PUBLIC_ALLOW_LOCAL_MOCK and hides LOCAL DEMO BACKEND indicator', async () => {
    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://qavora.example.test';
    process.env.EXPO_PUBLIC_ALLOW_LOCAL_MOCK = 'true';
    expect(isLocalMockBackendActive()).toBe(false);

    let capturedLoginUrl = null;
    globalThis.fetch = async (url) => {
      const target = String(url);
      if (target.endsWith('/api/auth/me')) {
        return new Response(JSON.stringify({ user: null }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (target.endsWith('/api/auth/csrf')) {
        return new Response(JSON.stringify({ csrfToken: 'real_csrf_tok' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (target.endsWith('/api/auth/login')) {
        capturedLoginUrl = target;
        return new Response(
          JSON.stringify({
            user: {
              userId: 'real_u1',
              email: 'real@qavora.app',
              name: 'Real QA',
              role: 'QA Engineer',
            },
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json',
              'set-cookie': '__Host-qavora_auth_token=real_tok; Path=/; Secure; HttpOnly',
            },
          }
        );
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    const loginRes = await loginUser({
      email: 'real@qavora.app',
      password: 'RealPassword123!',
    });
    expect(loginRes.ok).toBe(true);
    expect(capturedLoginUrl).toBe('https://qavora.example.test/api/auth/login');
    expect(memoryAsyncStorage._map.get('@qavora_local_mock_backend_v1')).toBeUndefined();

    await harness.render(
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(AuthProvider, null, React.createElement(AuthScreen))
      )
    );
    await harness.flush(30);

    expect(
      harness.findByAttr('data-testid', 'local-demo-backend-indicator')
    ).toHaveLength(0);
    expect(harness.container.textContent).toContain('QAVORA CLOUD WORKSPACE');
  });

  it('9. preserves CSRF header injection, SecureStore cookie persistence, and HTTPS enforcement in production', async () => {
    process.env.EXPO_PUBLIC_ENV = 'production';
    process.env.NODE_ENV = 'production';
    process.env.EXPO_PUBLIC_API_BASE_URL = 'http://insecure.qavora.app';

    expect(validateBaseUrl('http://insecure.qavora.app')).toMatchObject({
      valid: false,
      code: 'INSECURE_PRODUCTION_URL',
    });
    let insecureErr = null;
    try {
      await apiClient.get('/api/projects');
    } catch (err) {
      insecureErr = err;
    }
    expect(insecureErr).toBeInstanceOf(ApiClientError);
    expect(insecureErr?.code).toBe('INSECURE_PRODUCTION_URL');

    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://qavora.example.test';
    let capturedPostHeaders = null;

    await runWithNativeRuntime(async () => {
      globalThis.fetch = async (url, init = {}) => {
        const target = String(url);
        if (target.endsWith('/api/auth/csrf')) {
          return new Response(JSON.stringify({ csrfToken: 'csrf_prod_789' }), {
            status: 200,
            headers: {
              'content-type': 'application/json',
              'set-cookie': 'qavora_csrf_token=csrf_prod_789; Path=/; Secure',
            },
          });
        }
        if (target.endsWith('/api/projects')) {
          capturedPostHeaders = Object.fromEntries(new Headers(init.headers).entries());
          return new Response(JSON.stringify({ id: 'p_prod', name: 'Prod Proj' }), {
            status: 201,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      };

      await storeCookiesFromResponse(
        new Response('{}', {
          status: 200,
          headers: {
            'set-cookie': '__Host-qavora_auth_token=tok_prod; Path=/; Secure; HttpOnly',
          },
        }),
        'https://qavora.example.test/api/auth/login'
      );

      const postRes = await apiClient.post('/api/projects', { name: 'Prod Proj' });
      expect(postRes.status).toBe(201);
      expect(capturedPostHeaders['x-csrf-token']).toBe('csrf_prod_789');
      expect(capturedPostHeaders['cookie']).toContain('__Host-qavora_auth_token=tok_prod');
      expect(secureStoreMap.get(COOKIE_JAR_SECURE_STORE_KEY)).toBeDefined();
    });
  });

  it('10. preview environment configures Vercel HTTPS backend + trusted Origin, forbids local mock, and never mistakes config or HTTP errors for internet connectivity failures', async () => {
    const origTrustedOrigin = process.env.EXPO_PUBLIC_TRUSTED_ORIGIN;

    try {
      // A. Missing URL in preview fails closed with configuration error (NOT internet connectivity error)
      process.env.EXPO_PUBLIC_ENV = 'preview';
      process.env.EXPO_PUBLIC_ALLOW_LOCAL_MOCK = 'false';
      delete process.env.EXPO_PUBLIC_API_BASE_URL;
      delete process.env.EXPO_PUBLIC_TRUSTED_ORIGIN;

      expect(isLocalMockBackendActive()).toBe(false);
      expect(validateBaseUrl('')).toMatchObject({
        valid: false,
        code: 'INVALID_BASE_URL',
      });

      const unconfiguredLogin = await loginUser({
        email: 'preview@qavora.app',
        password: 'Password123!',
      });
      expect(unconfiguredLogin.ok).toBe(false);
      expect(unconfiguredLogin.code).toBe('INVALID_BASE_URL');
      expect(unconfiguredLogin.isNetworkError).toBe(false);
      expect(unconfiguredLogin.error).toBe(
        'The Qavora server connection is not configured properly. Please check the application environment settings.'
      );
      // Re-formatting through AuthContext must preserve the config error, never overwrite with internet error
      expect(formatAuthErrorMessage(unconfiguredLogin, 'login')).toBe(
        'The Qavora server connection is not configured properly. Please check the application environment settings.'
      );

      // B. Non-network HTTP / SecureStore errors must NOT be misclassified as internet connectivity errors
      expect(
        formatAuthErrorMessage(
          { status: 404, code: 'HTTP_404', message: 'Request failed with HTTP 404 (Not Found).' },
          'login'
        )
      ).toContain('HTTP 404');
      expect(
        formatAuthErrorMessage(
          { status: null, code: 'SECURE_STORE_WRITE_FAILED', isNetworkError: false, message: 'Unable to securely store your authentication session on this device.' },
          'login'
        )
      ).toBe('Unable to securely store your authentication session on this device.');

      // C. Valid preview configuration targets https://qavora-mongo-db-integrated.vercel.app with matching Origin
      process.env.EXPO_PUBLIC_ENV = 'preview';
      process.env.EXPO_PUBLIC_ALLOW_LOCAL_MOCK = 'false';
      process.env.EXPO_PUBLIC_API_BASE_URL = 'https://qavora-mongo-db-integrated.vercel.app';
      process.env.EXPO_PUBLIC_TRUSTED_ORIGIN = 'https://qavora-mongo-db-integrated.vercel.app';

      expect(apiClient.getBaseUrl()).toBe('https://qavora-mongo-db-integrated.vercel.app');
      expect(apiClient.getTrustedOrigin()).toBe('https://qavora-mongo-db-integrated.vercel.app');
      expect(isLocalMockBackendActive()).toBe(false);

      let capturedLoginUrl = null;
      let capturedLoginHeaders = null;

      await runWithNativeRuntime(async () => {
        globalThis.fetch = async (url, init = {}) => {
          const target = String(url);
          if (target.endsWith('/api/auth/csrf')) {
            return new Response(JSON.stringify({ csrfToken: 'csrf_preview_1' }), {
              status: 200,
              headers: {
                'content-type': 'application/json',
                'set-cookie': '__Host-qavora_csrf_token=csrf_preview_1; Path=/; Secure',
              },
            });
          }
          if (target.endsWith('/api/auth/login')) {
            capturedLoginUrl = target;
            capturedLoginHeaders = Object.fromEntries(new Headers(init.headers).entries());
          }
          return new Response(
            JSON.stringify({
              user: {
                userId: 'preview-u1',
                email: 'preview@qavora.app',
                name: 'Preview Tester',
                role: 'QA Tester',
              },
            }),
            {
              status: 200,
              headers: {
                'content-type': 'application/json',
                'set-cookie': '__Host-qavora_auth_token=tok_preview; Path=/; Secure; HttpOnly',
              },
            }
          );
        };

        const previewLogin = await loginUser({
          email: 'preview@qavora.app',
          password: 'PreviewPassword123!',
        });
        expect(previewLogin.ok).toBe(true);
        expect(capturedLoginUrl).toBe('https://qavora-mongo-db-integrated.vercel.app/api/auth/login');
        expect(capturedLoginHeaders.origin).toBe('https://qavora-mongo-db-integrated.vercel.app');
      });
    } finally {
      if (origTrustedOrigin === undefined) {
        delete process.env.EXPO_PUBLIC_TRUSTED_ORIGIN;
      } else {
        process.env.EXPO_PUBLIC_TRUSTED_ORIGIN = origTrustedOrigin;
      }
    }
  });
});


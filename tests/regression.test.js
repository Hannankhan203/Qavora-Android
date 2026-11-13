import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';

globalThis.__DEV__ = false;

// --- Minimal DOM & Native Module Shims for React 19 + RN Components in Bun ---
function createFakeDom() {
  class FakeNode {
    constructor(nodeType, nodeName) {
      this.nodeType = nodeType;
      this.nodeName = nodeName;
      this.childNodes = [];
      this.parentNode = null;
      this.style = {};
      this.attributes = new Map();
      this.eventListeners = new Map();
    }
    get firstChild() {
      return this.childNodes[0] || null;
    }
    get lastChild() {
      return this.childNodes[this.childNodes.length - 1] || null;
    }
    get nextSibling() {
      if (!this.parentNode) return null;
      const idx = this.parentNode.childNodes.indexOf(this);
      return idx >= 0 && idx + 1 < this.parentNode.childNodes.length
        ? this.parentNode.childNodes[idx + 1]
        : null;
    }
    get ownerDocument() {
      return doc;
    }
    appendChild(child) {
      if (child.parentNode) child.parentNode.removeChild(child);
      child.parentNode = this;
      this.childNodes.push(child);
      return child;
    }
    insertBefore(newChild, refChild) {
      if (!refChild) return this.appendChild(newChild);
      if (newChild.parentNode) newChild.parentNode.removeChild(newChild);
      const idx = this.childNodes.indexOf(refChild);
      newChild.parentNode = this;
      if (idx === -1) this.childNodes.push(newChild);
      else this.childNodes.splice(idx, 0, newChild);
      return newChild;
    }
    removeChild(child) {
      const idx = this.childNodes.indexOf(child);
      if (idx >= 0) {
        this.childNodes.splice(idx, 1);
        child.parentNode = null;
      }
      return child;
    }
    contains(target) {
      let cur = target;
      while (cur) {
        if (cur === this) return true;
        cur = cur.parentNode;
      }
      return false;
    }
    addEventListener(type, fn) {
      if (!this.eventListeners.has(type)) this.eventListeners.set(type, new Set());
      this.eventListeners.get(type).add(fn);
    }
    removeEventListener(type, fn) {
      const set = this.eventListeners.get(type);
      if (set) set.delete(fn);
    }
    get textContent() {
      if (this.nodeType === 3) return this.nodeValue || '';
      return this.childNodes.map((c) => c.textContent).join('');
    }
    set textContent(val) {
      this.childNodes = [];
      if (val !== '' && val !== null && val !== undefined) {
        this.appendChild(doc.createTextNode(String(val)));
      }
    }
  }

  class FakeElement extends FakeNode {
    constructor(tagName) {
      super(1, String(tagName).toUpperCase());
      this.tagName = this.nodeName;
      this.namespaceURI = 'http://www.w3.org/1999/xhtml';
    }
    setAttribute(k, v) {
      this.attributes.set(k, String(v));
      if (k === 'id') this.id = String(v);
    }
    getAttribute(k) {
      return this.attributes.has(k) ? this.attributes.get(k) : null;
    }
    removeAttribute(k) {
      this.attributes.delete(k);
    }
    hasAttribute(k) {
      return this.attributes.has(k);
    }
    focus() {}
    blur() {}
  }

  class FakeText extends FakeNode {
    constructor(text) {
      super(3, '#text');
      this.nodeValue = String(text ?? '');
    }
    get data() {
      return this.nodeValue;
    }
    set data(v) {
      this.nodeValue = String(v ?? '');
    }
  }

  class FakeComment extends FakeNode {
    constructor(text) {
      super(8, '#comment');
      this.nodeValue = String(text ?? '');
    }
  }

  const doc = {
    nodeType: 9,
    nodeName: '#document',
    documentElement: new FakeElement('html'),
    body: new FakeElement('body'),
    head: new FakeElement('head'),
    defaultView: null,
    createElement: (tag) => new FakeElement(tag),
    createElementNS: (_ns, tag) => new FakeElement(tag),
    createTextNode: (text) => new FakeText(text),
    createComment: (text) => new FakeComment(text),
    addEventListener: () => {},
    removeEventListener: () => {},
    get activeElement() {
      return doc.body;
    },
  };
  doc.documentElement.appendChild(doc.head);
  doc.documentElement.appendChild(doc.body);

  return {
    document: doc,
    Node: FakeNode,
    Element: FakeElement,
    HTMLElement: FakeElement,
    HTMLIFrameElement: FakeElement,
    Text: FakeText,
  };
}

const dom = createFakeDom();
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.document = dom.document;
globalThis.Node = dom.Node;
globalThis.Element = dom.Element;
globalThis.HTMLElement = dom.HTMLElement;
globalThis.HTMLIFrameElement = dom.HTMLIFrameElement;
globalThis.Text = dom.Text;
if (typeof globalThis.window === 'undefined') {
  globalThis.window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    location: { origin: 'https://qavora.example.test' },
    HTMLIFrameElement: dom.HTMLIFrameElement,
  };
} else {
  globalThis.window.HTMLIFrameElement = dom.HTMLIFrameElement;
}
dom.document.defaultView = globalThis.window;
if (!globalThis.navigator) {
  globalThis.navigator = { onLine: true, product: 'Gecko' };
}

function createMemoryAsyncStorage() {
  const map = new Map();
  return {
    _map: map,
    async getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    async setItem(key, val) {
      map.set(key, String(val));
    },
    async removeItem(key) {
      map.delete(key);
    },
    async clear() {
      map.clear();
    },
  };
}

const memoryAsyncStorage = createMemoryAsyncStorage();
const secureStoreMap = new Map();

mock.module('@react-native-async-storage/async-storage', () => ({
  default: memoryAsyncStorage,
}));

mock.module('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 0,
  isAvailableAsync: async () => true,
  getItemAsync: async (key) => (secureStoreMap.has(key) ? secureStoreMap.get(key) : null),
  setItemAsync: async (key, val) => {
    secureStoreMap.set(key, String(val));
  },
  deleteItemAsync: async (key) => {
    secureStoreMap.delete(key);
  },
}));

mock.module('@react-native-community/netinfo', () => ({
  default: {
    fetch: async () => ({
      type: 'wifi',
      isConnected: true,
      isInternetReachable: true,
      details: {},
    }),
    addEventListener: () => () => {},
    refresh: async () => ({
      type: 'wifi',
      isConnected: true,
      isInternetReachable: true,
      details: {},
    }),
  },
}));

mock.module('expo', () => ({
  requireNativeModule: () => ({}),
  EventEmitter: class EventEmitter {},
}));
mock.module('expo-modules-core', () => ({
  EventEmitter: class EventEmitter {},
  NativeModulesProxy: {},
  requireNativeModule: () => ({}),
}));

mock.module('expo-file-system', () => ({
  File: class FakeExpoFile {
    constructor(...parts) {
      this.uri = parts.join('/');
    }
    create() {}
    write() {}
    text() {
      return Promise.resolve('');
    }
  },
  Paths: { cache: '/tmp/', document: '/tmp/' },
  documentDirectory: '/tmp/',
  cacheDirectory: '/tmp/',
  writeAsStringAsync: async () => {},
  readAsStringAsync: async () => '',
  getInfoAsync: async () => ({ exists: false }),
}));

mock.module('expo-document-picker', () => ({
  getDocumentAsync: async () => ({ canceled: true }),
}));

mock.module('expo-sharing', () => ({
  isAvailableAsync: async () => false,
  shareAsync: async () => {},
}));

mock.module('expo-status-bar', () => ({
  StatusBar: () => null,
}));

mock.module('react-native-safe-area-context', () => {
  const React = require('react');
  return {
    SafeAreaProvider: ({ children }) => React.createElement('div', null, children),
    SafeAreaView: ({ children }) => React.createElement('div', null, children),
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

mock.module('react-native', () => {
  const React = require('react');
  const Host = (tag) =>
    React.forwardRef(({ children, style: _style, ...props }, ref) =>
      React.createElement(tag, { ...props, ref }, children)
    );
  return {
    Platform: { OS: 'android', select: (obj) => obj.android ?? obj.default },
    useColorScheme: () => 'light',
    StyleSheet: {
      create: (styles) => styles,
      flatten: (s) => (Array.isArray(s) ? Object.assign({}, ...s.filter(Boolean)) : s || {}),
    },
    AppState: {
      currentState: 'active',
      addEventListener: () => ({ remove: () => {} }),
    },
    Keyboard: {
      addListener: () => ({ remove: () => {} }),
      dismiss: () => {},
      isVisible: () => false,
    },
    BackHandler: {
      addEventListener: () => ({ remove: () => {} }),
    },
    Share: {
      share: async () => ({ action: 'sharedAction' }),
    },
    View: Host('rn-view'),
    Text: Host('rn-text'),
    TextInput: Host('rn-textinput'),
    Pressable: Host('rn-pressable'),
    ScrollView: Host('rn-scrollview'),
    KeyboardAvoidingView: Host('rn-kav'),
    ActivityIndicator: Host('rn-spinner'),
  };
});

const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { act } = React;

const { ThemeProvider } = await import('../src/theme/theme.js');
const { formatAuthErrorMessage, setAuthUserStorageAdapter } = await import(
  '../src/services/authService.js'
);
const { AuthProvider, useAuth } = await import('../src/context/AuthContext.js');
const AuthScreen = (await import('../src/components/AuthScreen.js')).default;
const { onUnauthorizedResponse } = await import('../src/services/apiClient.js');
const { clearAllCookies, setCsrfTokenCookie } = await import(
  '../src/services/cookieManager.js'
);
const { ProjectProvider, useProjects, setProjectStorageAdapter } = await import(
  '../src/context/ProjectContext.js'
);
const {
  setActiveSyncUser,
  getActiveSyncUser,
  setOfflineSyncStorageAdapter,
  connectivityMonitorState,
} = await import('../src/services/offlineSync/syncState.js');
const { cacheProjectOffline } = await import(
  '../src/services/offlineSyncService.js'
);
const {
  parseQavoraDate,
  isWithinDateRange,
  generateProjectReport,
} = await import('../src/services/reportService.js');

// =============================================================================
// HIGH-04: Intentional Sign-out vs Session Expiration
// =============================================================================
describe('HIGH-04 — Intentional Sign-out vs Session Expired Notice', () => {
  const originalFetch = globalThis.fetch;
  const originalApiUrl = process.env.EXPO_PUBLIC_API_BASE_URL;
  let container;
  let root;

  beforeEach(async () => {
    memoryAsyncStorage._map.clear();
    secureStoreMap.clear();
    setAuthUserStorageAdapter(memoryAsyncStorage);
    await clearAllCookies();
    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://qavora.example.test';
    container = dom.document.createElement('div');
    dom.document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.parentNode?.removeChild(container);
    globalThis.fetch = originalFetch;
    if (originalApiUrl === undefined) {
      delete process.env.EXPO_PUBLIC_API_BASE_URL;
    } else {
      process.env.EXPO_PUBLIC_API_BASE_URL = originalApiUrl;
    }
    await clearAllCookies();
  });

  it('formatAuthErrorMessage handles logout context without session-expired or invalid-credentials fallback', () => {
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

  it('intentional logout displays sign-out notice and never "session has expired", and subsequent login clears notices', async () => {
    let authRef = null;
    let meMode = 'none'; // 'none' | 'valid' | 'expired'
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

    await act(async () => {
      root.render(
        React.createElement(
          ThemeProvider,
          null,
          React.createElement(AuthProvider, null, React.createElement(Harness))
        )
      );
    });

    // 1. Initial mount with no cookie -> unauthenticated, no notice
    expect(authRef.isAuthenticated).toBe(false);
    expect(authRef.authNotice).toBeNull();
    expect(container.textContent).not.toContain('session has expired');

    // 2. Failed login produces authError, no authNotice
    await act(async () => {
      await authRef.login('qa@example.com', 'wrong');
    });
    expect(authRef.isAuthenticated).toBe(false);
    expect(authRef.authError).toContain('Invalid email or password');
    expect(authRef.authNotice).toBeNull();

    // 3. Subsequent valid login clears authError and signs in
    await act(async () => {
      await authRef.login('qa@example.com', 'correct-pass');
    });
    expect(authRef.isAuthenticated).toBe(true);
    expect(authRef.authError).toBeNull();
    expect(authRef.authNotice).toBeNull();
    expect(authRef.authNoticeType).toBeNull();

    // 4. Intentional logout (even if an unrelated 401 happens concurrently)
    logoutHook = async () => {
      // Simulate a concurrent protected call returning 401 while logout is in flight
      meMode = 'expired';
      await fetchProtected401();
    };
    async function fetchProtected401() {
      const { apiGet } = await import('../src/services/apiClient.js');
      try {
        await apiGet('/api/projects');
      } catch {
        // expected 401
      }
    }
    const baseFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if (String(url).endsWith('/api/projects')) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        });
      }
      return baseFetch(url, init);
    };

    await act(async () => {
      await authRef.logout();
    });
    logoutHook = null;

    expect(authRef.isAuthenticated).toBe(false);
    expect(authRef.authError).toBeNull();
    expect(authRef.authNotice).toBe('You have been signed out.');
    expect(authRef.authNoticeType).toBe('logout');
    expect(container.textContent).toContain('You have been signed out.');
    expect(container.textContent.toLowerCase()).not.toContain('session has expired');

    // 5. Genuine HTTP 401 while authenticated DOES show session-expired notice
    meMode = 'valid';
    await act(async () => {
      await authRef.login('qa@example.com', 'correct-pass');
    });
    expect(authRef.isAuthenticated).toBe(true);
    expect(authRef.authNotice).toBeNull();

    await act(async () => {
      const { apiGet } = await import('../src/services/apiClient.js');
      try {
        await apiGet('/api/projects');
      } catch {
        // triggers onUnauthorizedResponse
      }
    });

    expect(authRef.isAuthenticated).toBe(false);
    expect(authRef.authNoticeType).toBe('session_expired');
    expect(authRef.authNotice).toBe(
      'Your session has expired or is no longer valid. Please sign in again.'
    );
    expect(container.textContent).toContain(
      'Your session has expired or is no longer valid. Please sign in again.'
    );

    // 6. Expired session during restoreSession DOES show session-expired notice
    // Inject an auth cookie in cookieManager by logging in then forcing /api/auth/me -> 401
    await act(async () => {
      await authRef.login('qa@example.com', 'correct-pass');
    });
    await setCsrfTokenCookie('csrf_abc');
    meMode = 'expired';

    await act(async () => {
      await authRef.restoreSession();
    });
    expect(authRef.isAuthenticated).toBe(false);
    expect(authRef.authNoticeType).toBe('session_expired');
    expect(container.textContent).toContain(
      'Your session has expired or is no longer valid. Please sign in again.'
    );

    // 7. Logging back in clears the session-expired notice completely
    meMode = 'valid';
    await act(async () => {
      await authRef.login('qa@example.com', 'correct-pass');
    });
    expect(authRef.isAuthenticated).toBe(true);
    expect(authRef.authNotice).toBeNull();
    expect(authRef.authNoticeType).toBeNull();
    expect(authRef.authError).toBeNull();

    // Unrelated unsubscribe sanity
    const unsub = onUnauthorizedResponse(() => {});
    unsub();
  });
});

// =============================================================================
// HIGH-05: Custom Report Date Range Timezone Boundary Error
// =============================================================================
describe('HIGH-05 — Custom Report Date Range Timezone Boundaries', () => {
  it('enforces exact UTC day boundaries [00:00:00.000Z, 23:59:59.999Z] in the current process TZ', () => {
    // Same-day range: 2026-05-10 to 2026-05-10
    expect(
      isWithinDateRange('2026-05-09T23:59:59.999Z', 'CUSTOM', '2026-05-10', '2026-05-10')
    ).toBe(false);
    expect(
      isWithinDateRange('2026-05-10T00:00:00.000Z', 'CUSTOM', '2026-05-10', '2026-05-10')
    ).toBe(true);
    expect(
      isWithinDateRange('2026-05-10', 'CUSTOM', '2026-05-10', '2026-05-10')
    ).toBe(true);
    expect(
      isWithinDateRange('2026-05-10T12:00:00.000Z', 'CUSTOM', '2026-05-10', '2026-05-10')
    ).toBe(true);
    expect(
      isWithinDateRange('2026-05-10T23:59:59.999Z', 'CUSTOM', '2026-05-10', '2026-05-10')
    ).toBe(true);
    expect(
      isWithinDateRange('2026-05-11T00:00:00.000Z', 'CUSTOM', '2026-05-10', '2026-05-10')
    ).toBe(false);

    // Offset timestamps normalize to UTC correctly
    expect(
      isWithinDateRange('2026-05-10T01:00:00+05:00', 'CUSTOM', '2026-05-10', '2026-05-10')
    ).toBe(false); // 2026-05-09T20:00:00Z
    expect(
      isWithinDateRange('2026-05-09T18:00:00-07:00', 'CUSTOM', '2026-05-10', '2026-05-10')
    ).toBe(true); // 2026-05-10T01:00:00Z
    expect(
      isWithinDateRange('2026-05-10T18:00:00-07:00', 'CUSTOM', '2026-05-10', '2026-05-10')
    ).toBe(false); // 2026-05-11T01:00:00Z

    // Month boundaries
    expect(
      isWithinDateRange('2026-02-28T23:59:59.999Z', 'CUSTOM', '2026-03-01', '2026-03-01')
    ).toBe(false);
    expect(
      isWithinDateRange('2026-03-01T00:00:00.000Z', 'CUSTOM', '2026-02-28', '2026-03-01')
    ).toBe(true);
    expect(
      isWithinDateRange('2026-04-30T23:59:59.999Z', 'CUSTOM', '2026-04-30', '2026-05-01')
    ).toBe(true);
    expect(
      isWithinDateRange('2026-05-02T00:00:00.000Z', 'CUSTOM', '2026-04-30', '2026-05-01')
    ).toBe(false);

    // Year boundary
    expect(
      isWithinDateRange('2025-12-31T23:59:59.999Z', 'CUSTOM', '2025-12-31', '2026-01-01')
    ).toBe(true);
    expect(
      isWithinDateRange('2026-01-01T23:59:59.999Z', 'CUSTOM', '2025-12-31', '2026-01-01')
    ).toBe(true);
    expect(
      isWithinDateRange('2026-01-02T00:00:00.000Z', 'CUSTOM', '2025-12-31', '2026-01-01')
    ).toBe(false);

    // Reject invalid calendar dates instead of silent rollover
    expect(parseQavoraDate('2026-02-30')).toBeNull();
    expect(parseQavoraDate('2026-04-31')).toBeNull();

    // Preserve explicit date-time custom bounds
    expect(
      isWithinDateRange(
        '2026-05-10T11:59:59.999Z',
        'CUSTOM',
        '2026-05-10T12:00:00.000Z',
        '2026-05-10T18:00:00.000Z'
      )
    ).toBe(false);
    expect(
      isWithinDateRange(
        '2026-05-10T15:00:00.000Z',
        'CUSTOM',
        '2026-05-10T12:00:00.000Z',
        '2026-05-10T18:00:00.000Z'
      )
    ).toBe(true);
    expect(
      isWithinDateRange(
        '2026-05-10T18:00:00.001Z',
        'CUSTOM',
        '2026-05-10T12:00:00.000Z',
        '2026-05-10T18:00:00.000Z'
      )
    ).toBe(false);
  });

  it('produces identical generateProjectReport custom-range results across UTC, America/Los_Angeles, and Asia/Karachi', () => {
    const sampleProject = {
      id: 'proj-tz-1',
      name: 'Timezone Audit Project',
      testSuites: [{ id: 's1', name: 'Core Suite', testCases: [{ id: 'tc1', title: 'Case 1', lastStatus: 'Passed' }] }],
      executions: [
        { id: 'ex-before', testCaseId: 'tc1', status: 'PASSED', executedAt: '2026-05-09T23:59:59.999Z' },
        { id: 'ex-start', testCaseId: 'tc1', status: 'PASSED', executedAt: '2026-05-10T00:00:00.000Z' },
        { id: 'ex-mid', testCaseId: 'tc1', status: 'FAILED', executedAt: '2026-05-10T17:30:00.000Z' },
        { id: 'ex-end', testCaseId: 'tc1', status: 'PASSED', executedAt: '2026-05-10T23:59:59.999Z' },
        { id: 'ex-after', testCaseId: 'tc1', status: 'FAILED', executedAt: '2026-05-11T00:00:00.000Z' },
      ],
      executionRuns: [
        { id: 'run-in', name: 'In Window', status: 'Completed', startedAt: '2026-05-10T22:00:00.000Z', results: [] },
        { id: 'run-out', name: 'Out Window', status: 'Completed', startedAt: '2026-05-09T22:00:00.000Z', results: [] },
      ],
      defects: [
        { id: 'def-in', title: 'In Defect', severity: 'High', status: 'Open', createdAt: '2026-05-10T01:00:00.000Z' },
        { id: 'def-out', title: 'Out Defect', severity: 'Critical', status: 'Open', createdAt: '2026-05-11T00:00:00.000Z' },
      ],
    };

    const report = generateProjectReport(sampleProject, {
      reportType: 'project_summary',
      dateFilter: 'CUSTOM',
      customStart: '2026-05-10',
      customEnd: '2026-05-10',
    });

    expect(report.executions.map((e) => e.id).sort()).toEqual(['ex-end', 'ex-mid', 'ex-start']);
    expect(report.testRuns.map((r) => r.id)).toEqual(['run-in']);
    expect(report.defects.map((d) => d.id)).toEqual(['def-in']);
    expect(report.kpis.totalExecutions).toBe(3);
    expect(report.kpis.execPassedCount).toBe(2);
    expect(report.kpis.execFailedCount).toBe(1);
  });
});

// =============================================================================
// HIGH-06: ProjectContext React Render Purity & User Isolation
// =============================================================================
describe('HIGH-06 — ProjectContext Render Purity & User Isolation', () => {
  const originalFetch = globalThis.fetch;
  const originalApiUrl = process.env.EXPO_PUBLIC_API_BASE_URL;
  let container;
  let root;

  beforeEach(async () => {
    memoryAsyncStorage._map.clear();
    secureStoreMap.clear();
    setAuthUserStorageAdapter(memoryAsyncStorage);
    setProjectStorageAdapter(memoryAsyncStorage);
    setOfflineSyncStorageAdapter(memoryAsyncStorage);
    setActiveSyncUser(null);
    await clearAllCookies();
    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://qavora.example.test';
    container = dom.document.createElement('div');
    dom.document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    setActiveSyncUser(null);
    container.parentNode?.removeChild(container);
    globalThis.fetch = originalFetch;
    if (originalApiUrl === undefined) {
      delete process.env.EXPO_PUBLIC_API_BASE_URL;
    } else {
      process.env.EXPO_PUBLIC_API_BASE_URL = originalApiUrl;
    }
    await clearAllCookies();
  });

  it('does not mutate activeSyncUser during render (including StrictMode), clears on unmount/logout, and isolates User A vs User B', async () => {
    // Seed offline cached projects for User A and User B
    await cacheProjectOffline(
      { id: 'proj-A1', name: 'Alpha Private Project', userId: 'user-A', status: 'Active' },
      'user-A'
    );
    await cacheProjectOffline(
      { id: 'proj-B1', name: 'Beta Private Project', userId: 'user-B', status: 'Active' },
      'user-B'
    );

    // Mock backend returning user-scoped project arrays
    globalThis.fetch = async (url) => {
      const target = String(url);
      if (target.includes('/api/projects')) {
        const list =
          getActiveSyncUser() === 'user-A'
            ? [{ id: 'proj-A1', name: 'Alpha Private Project', userId: 'user-A', status: 'Active' }]
            : getActiveSyncUser() === 'user-B'
            ? [{ id: 'proj-B1', name: 'Beta Private Project', userId: 'user-B', status: 'Active' }]
            : [];
        return new Response(JSON.stringify(list), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    const syncUserSeenDuringRender = [];
    let latestProjectsCtx = null;

    // Minimal AuthContext look-alike? Use real AuthProvider by mocking /api/auth/me?
    // Even better: wrap real AuthProvider so ProjectProvider calls real useAuth()!
    let currentServerUser = {
      userId: 'user-A',
      email: 'a@example.com',
      name: 'User Alpha',
      role: 'QA Tester',
    };
    const baseFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
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
      return baseFetch(url, init);
    };

    // Set auth cookie so native non-DOM restoreAuthenticatedSession restores currentServerUser
    const { storeCookiesFromResponse } = await import('../src/services/cookieManager.js');
    storeCookiesFromResponse('qavora_auth_token=tok_a; Path=/; HttpOnly');

    let authControl = null;

    function Observer() {
      // Read module state synchronously DURING render to verify ProjectProvider did NOT mutate it during render
      syncUserSeenDuringRender.push({
        activeSyncUserAtRender: getActiveSyncUser(),
      });
      latestProjectsCtx = useProjects();
      return React.createElement('div', null, `Projects: ${latestProjectsCtx.projects.length}`);
    }

    function RootGate() {
      const auth = useAuth();
      authControl = auth;
      if (!auth.isAuthenticated) {
        return React.createElement('div', null, 'Unauthenticated');
      }
      return React.createElement(ProjectProvider, null, React.createElement(Observer));
    }

    await act(async () => {
      root.render(
        React.createElement(
          React.StrictMode,
          null,
          React.createElement(AuthProvider, null, React.createElement(RootGate))
        )
      );
    });

    // Give initial mount effects a microtask turn to settle
    await act(async () => {
      await new Promise((r) => setTimeout(r, 40));
    });

    // On initial StrictMode mount renders (before ProjectProvider's useEffect ran),
    // getActiveSyncUser() must have started as null during initial render!
    expect(syncUserSeenDuringRender[0].activeSyncUserAtRender).toBeNull();
    // After commit, activeSyncUser must be 'user-A'
    expect(getActiveSyncUser()).toBe('user-A');
    expect(latestProjectsCtx.projects.map((p) => p.id)).toEqual(['proj-A1']);

    // Switch User A -> User B via refreshCurrentUser / restoreSession
    syncUserSeenDuringRender.length = 0;
    currentServerUser = {
      userId: 'user-B',
      email: 'b@example.com',
      name: 'User Beta',
      role: 'QA Tester',
    };
    await act(async () => {
      await authControl.refreshCurrentUser();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 40));
    });

    // During the first render with user-B, ProjectProvider MUST NOT have mutated activeSyncUser yet!
    expect(syncUserSeenDuringRender[0].activeSyncUserAtRender).toBe('user-A');
    // After commit, activeSyncUser is 'user-B' and projects only show User B's data
    expect(getActiveSyncUser()).toBe('user-B');
    expect(latestProjectsCtx.projects.map((p) => p.id)).toEqual(['proj-B1']);

    // Simulate a pending reconnect timer for user-B, then logout (unmounts ProjectProvider)
    connectivityMonitorState.pendingReconnectUserId = 'user-B';
    connectivityMonitorState.pendingReconnectTimer = setTimeout(() => {}, 5000);

    await act(async () => {
      await authControl.logout();
    });

    expect(getActiveSyncUser()).toBeNull();
    expect(connectivityMonitorState.pendingReconnectTimer).toBeNull();
    expect(connectivityMonitorState.pendingReconnectUserId).toBeNull();

    // Log back in -> ProjectProvider mounts cleanly again and registers user-B
    storeCookiesFromResponse('qavora_auth_token=tok_b; Path=/; HttpOnly');
    syncUserSeenDuringRender.length = 0;
    await act(async () => {
      await authControl.restoreSession();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 40));
    });

    expect(syncUserSeenDuringRender[0].activeSyncUserAtRender).toBeNull();
    expect(getActiveSyncUser()).toBe('user-B');
    expect(latestProjectsCtx.projects.map((p) => p.id)).toEqual(['proj-B1']);
  });
});

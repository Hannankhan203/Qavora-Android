import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  memoryAsyncStorage,
  secureStoreController,
  mockSecureStoreModule,
  createRenderHarness,
} from './helpers/testEnv.js';

const React = await import('react');
const { ThemeProvider, useTheme } = await import('../src/theme/theme.js');
const { setAuthUserStorageAdapter } = await import('../src/services/authService.js');
const { AuthProvider } = await import('../src/context/AuthContext.js');
const { ProjectProvider, useProjects, setProjectStorageAdapter } = await import(
  '../src/context/ProjectContext.js'
);
const { WorkspaceProvider, useWorkspace } = await import(
  '../src/context/WorkspaceContext.js'
);
const {
  computeRunMetrics,
  normalizeTestStep,
} = await import('../src/context/workspace/workspaceConstants.js');
const { buildBackendTestSuitesPayload } = await import(
  '../src/context/workspace/workspacePayloads.js'
);
const DashboardScreen = (await import('../src/components/DashboardScreen.js')).default;
const DataManagementSection = (
  await import('../src/components/DataManagementSection.js')
).default;
const TestRunExecutionModal = (
  await import('../src/components/testRuns/TestRunExecutionModal.js')
).default;
const {
  clearAllCookies,
  storeCookiesFromResponse,
  setCookieStorageAdapter,
  setSecureStoreImplementation,
} = await import('../src/services/cookieManager.js');
const {
  setActiveSyncUser,
  setOfflineSyncStorageAdapter,
} = await import('../src/services/offlineSync/syncState.js');

// =============================================================================
// 1. HIGH-01 — Dashboard Run Metrics (computeRunMetrics & DashboardScreen)
// =============================================================================
describe('HIGH-01 — Dashboard Run Metrics Accuracy', () => {
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

  it('computes passedCases, failedCases, blockedCases, notRunCases, completionPct, and passRate accurately', () => {
    const empty = computeRunMetrics([]);
    expect(empty).toEqual({
      totalCases: 0,
      passedCases: 0,
      failedCases: 0,
      blockedCases: 0,
      skippedCases: 0,
      notRunCases: 0,
      executedCount: 0,
      passRate: 0,
      completionPct: 0,
    });

    const mixed = computeRunMetrics([
      { testCaseId: 'TC-1', status: 'Passed' },
      { testCaseId: 'TC-2', outcome: 'Pass' },
      { testCaseId: 'TC-3', status: 'Failed' },
      { testCaseId: 'TC-4', status: 'Blocked' },
      { testCaseId: 'TC-5', status: 'Untested' },
    ]);
    expect(mixed.totalCases).toBe(5);
    expect(mixed.passedCases).toBe(2);
    expect(mixed.failedCases).toBe(1);
    expect(mixed.blockedCases).toBe(1);
    expect(mixed.notRunCases).toBe(1);
    expect(mixed.executedCount).toBe(4);
    expect(mixed.passRate).toBe(50);
    expect(mixed.completionPct).toBe(80);
  });

  it('renders accurate run pass/fail/blocked counts in DashboardScreen Recent Test Runs', async () => {
    const projectWithRun = {
      id: 'proj-dash-1',
      userId: 'user-dash-1',
      name: 'Dashboard Metrics Project',
      status: 'Active',
      testSuites: [
        {
          id: 'suite-1',
          name: 'Auth',
          cases: [
            { id: 'TC-1', title: 'Login', lastStatus: 'Passed' },
            { id: 'TC-2', title: 'Signup', lastStatus: 'Failed' },
            { id: 'TC-3', title: 'Logout', lastStatus: 'Blocked' },
            { id: 'TC-4', title: 'Reset', lastStatus: 'Passed' },
          ],
        },
      ],
      executionRuns: [
        {
          id: 'RUN-77',
          name: 'Release Candidate Smoke',
          status: 'In Progress',
          buildVersion: '2.4.0',
          deviceInfo: 'Pixel 8',
          results: [
            { testCaseId: 'TC-1', status: 'Passed' },
            { testCaseId: 'TC-2', status: 'Failed' },
            { testCaseId: 'TC-3', status: 'Blocked' },
            { testCaseId: 'TC-4', outcome: 'Pass' },
          ],
        },
      ],
      executions: [],
      defects: [],
    };

    globalThis.fetch = async (url) => {
      const target = String(url);
      if (target.endsWith('/api/auth/me')) {
        return new Response(
          JSON.stringify({
            user: {
              userId: 'user-dash-1',
              email: 'dash@example.com',
              name: 'Dash QA',
              role: 'QA Tester',
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (target.endsWith('/api/auth/csrf')) {
        return new Response(JSON.stringify({ csrfToken: 'csrf_dash' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (target.endsWith('/api/projects')) {
        return new Response(JSON.stringify([projectWithRun]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    await storeCookiesFromResponse(
      new Response('{}', {
        status: 200,
        headers: { 'set-cookie': 'qavora_auth_token=tok_dash; Path=/; HttpOnly' },
      }),
      'https://qavora.example.test/api/auth/login'
    );

    let projectsRef = null;
    function DashboardHarness() {
      projectsRef = useProjects();
      return React.createElement(DashboardScreen);
    }

    await harness.render(
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(
          AuthProvider,
          null,
          React.createElement(
            ProjectProvider,
            null,
            React.createElement(
              WorkspaceProvider,
              null,
              React.createElement(DashboardHarness)
            )
          )
        )
      )
    );
    await harness.flush(50);

    await React.act(async () => {
      await projectsRef.selectProject('proj-dash-1');
    });
    await harness.flush(50);

    const renderedText = harness.container.textContent;
    expect(renderedText).toContain('RUN-77');
    expect(renderedText).toContain('Release Candidate Smoke');
    expect(renderedText).toContain('Pixel 8 · 2P / 1F / 1B (50% Pass)');
  });
});

// =============================================================================
// 2. HIGH-02 — Test-Step `expectedResult` Canonicalization & Legacy Compatibility
// =============================================================================
describe('HIGH-02 — Test-Step expectedResult Compatibility', () => {
  let harness;

  beforeEach(async () => {
    harness = await createRenderHarness();
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  it('normalizes canonical `expectedResult` fields and string steps cleanly, and preserves `expectedResult` across backend payloads', () => {
    const fromCanonical = normalizeTestStep(
      { action: 'Tap Logout', expectedResult: 'Returns to Login' },
      1
    );
    expect(fromCanonical).toEqual({
      id: 'step-2',
      stepNumber: 2,
      action: 'Tap Logout',
      testData: '',
      expectedResult: 'Returns to Login',
    });

    const fromString = normalizeTestStep('Open Settings', 2);
    expect(fromString).toEqual({
      id: 'step-3',
      stepNumber: 3,
      action: 'Open Settings',
      testData: '',
      expectedResult: '',
    });

    const payload = buildBackendTestSuitesPayload(
      [{ id: 'suite-1', name: 'Smoke Suite', description: '', cases: [] }],
      [
        {
          id: 'TC-10',
          suiteId: 'suite-1',
          title: 'Canonical step case',
          steps: [
            { action: 'Step A', expectedResult: 'Canonical Result A' },
            'Step B',
          ],
          lastStatus: 'Untested',
        },
      ]
    );
    const serializedSteps = payload.testSuites[0].cases[0].steps;
    expect(serializedSteps[0].expectedResult).toBe('Canonical Result A');
    expect(serializedSteps[0].stepNumber).toBe(1);
    expect(serializedSteps[1].action).toBe('Step B');
    expect(serializedSteps[1].expectedResult).toBe('');
  });

  it('renders both modern `expectedResult` and legacy `expected` steps in TestRunExecutionModal', async () => {
    function ModalHarness() {
      const { colors } = useTheme();
      const scrollRef = React.useRef(null);
      return React.createElement(TestRunExecutionModal, {
        theme: colors,
        executingCase: {
          id: 'TC-STEP-1',
          title: 'Checkout Step Verification',
          priority: 'P1',
          lastStatus: 'Untested',
          steps: [
            {
              stepNumber: 1,
              action: 'Add item to cart',
              expectedResult: 'Cart badge increments to 1',
            },
            {
              stepNumber: 2,
              step: 'Submit payment',
              expected: 'Confirmation screen shown',
            },
          ],
        },
        setExecutingCaseId: () => {},
        activeRun: { id: 'RUN-1', name: 'Checkout Run' },
        execRunnerScrollRef: scrollRef,
        execActualResultRef: scrollRef,
        execNotesRef: scrollRef,
        execTesterRef: scrollRef,
        execEnvironmentRef: scrollRef,
        scrollRunModalTo: () => {},
        stepStatuses: { 0: 'Passed', 1: 'Untested' },
        markAllStepsPassed: () => {},
        toggleStepStatus: () => {},
        execActualResult: '',
        setExecActualResult: () => {},
        execNotes: '',
        setExecNotes: () => {},
        execTester: 'QA Tester',
        setExecTester: () => {},
        execEnvironment: 'Staging',
        setExecEnvironment: () => {},
        isSubmittingExec: false,
        handleSaveExecution: () => {},
      });
    }

    await harness.render(
      React.createElement(ThemeProvider, null, React.createElement(ModalHarness))
    );

    const text = harness.container.textContent;
    expect(text).toContain('Add item to cart');
    expect(text).toContain('Expected: Cart badge increments to 1');
    expect(text).toContain('Submit payment');
    expect(text).toContain('Expected: Confirmation screen shown');
  });
});

// =============================================================================
// 3. HIGH-03 — Sample Dataset Preview Counts & Zero-Value Rendering
// =============================================================================
describe('HIGH-03 — Sample Dataset Preview Counts & Zero-Value Handling', () => {
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

  it('returns real zero count for sample executions and renders "0" instead of "—" in DataManagementSection & confirmation modal', async () => {
    globalThis.fetch = async (url) => {
      const target = String(url);
      if (target.endsWith('/api/auth/me')) {
        return new Response(
          JSON.stringify({
            user: {
              userId: 'user-h3-1',
              email: 'h3@example.com',
              name: 'H3 QA',
              role: 'QA Tester',
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (target.endsWith('/api/auth/csrf')) {
        return new Response(JSON.stringify({ csrfToken: 'csrf_h3' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (target.endsWith('/api/projects')) {
        return new Response(
          JSON.stringify([
            {
              id: 'proj-h3',
              userId: 'user-h3-1',
              name: 'Zero Preview App',
              testSuites: [],
            },
          ]),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    await storeCookiesFromResponse(
      new Response('{}', {
        status: 200,
        headers: { 'set-cookie': 'qavora_auth_token=tok_h3; Path=/; HttpOnly' },
      }),
      'https://qavora.example.test/api/auth/login'
    );

    let previewRef = null;
    function PreviewObserver() {
      const ws = useWorkspace();
      previewRef = ws.getSampleRestorePreview();
      return React.createElement(DataManagementSection);
    }

    await harness.render(
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(
          AuthProvider,
          null,
          React.createElement(
            ProjectProvider,
            null,
            React.createElement(
              WorkspaceProvider,
              null,
              React.createElement(PreviewObserver)
            )
          )
        )
      )
    );
    await harness.flush(50);

    expect(previewRef.sampleCounts).toEqual({
      suites: 4,
      testCases: 6,
      testRuns: 2,
      executions: 0,
      defects: 2,
    });

    // Zero must be displayed explicitly as "0" next to "Executions" (not replaced with "—")
    expect(harness.container.textContent).toContain('0Executions');
    expect(harness.container.textContent).not.toContain('—Executions');
    expect(harness.container.textContent).not.toContain(
      'Sample dataset preview counts are currently unavailable.'
    );

    // Open confirmation modal and verify zero count is formatted inside the description
    const restoreButtons = harness.findByAttr(
      'aria-label',
      'Restore Sample QA Dataset'
    );
    expect(restoreButtons.length).toBe(1);
    await harness.press(restoreButtons[0]);

    expect(harness.container.textContent).toContain('Restore Sample QA Dataset?');
    expect(harness.container.textContent).toContain(
      '(4 suites, 6 test cases, 2 test runs, 0 executions, 2 defects)'
    );
  });
});

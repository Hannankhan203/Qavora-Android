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
const {
  buildBackendTestSuitesPayload,
  buildBackendDefectsPayload,
  buildProjectWorkspaceState,
} = await import('../src/context/workspace/workspacePayloads.js');
const {
  allocateNextDefectIds,
  normalizeDefectsWithUniqueIds,
  findDefectById,
  setDefectIdStorageAdapter,
} = await import('../src/context/workspace/defectIdUtils.js');
const {
  parseAndValidateImportPayload,
  importWorkspaceOffline,
  setDataManagementStorageAdapter,
} = await import('../src/services/dataManagementService.js');
const {
  setSimulatedOfflineMode,
  processProjectSyncQueue,
  getPendingProjectOperations,
  resolveProjectConflict,
} = await import('../src/services/offlineSyncService.js');
const DashboardScreen = (await import('../src/components/DashboardScreen.js')).default;
const DefectsScreen = (await import('../src/components/DefectsScreen.js')).default;
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

// =============================================================================
// 4. Phase 3 (HIGH-03) — Defect ID Collision After Deletion & Exact Targeting
// =============================================================================
describe('HIGH-03 (Phase 3) — Defect ID Collision Resistance & Exact CRUD Targeting', () => {
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
    setDataManagementStorageAdapter(memoryAsyncStorage);
    setDefectIdStorageAdapter(memoryAsyncStorage);
    setActiveSyncUser(null);
    setSimulatedOfflineMode(false, { skipAutoReconnect: true });
    await clearAllCookies();
    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://qavora.example.test';
    harness = await createRenderHarness();
  });

  afterEach(async () => {
    await harness.cleanup();
    setSimulatedOfflineMode(false, { skipAutoReconnect: true });
    setActiveSyncUser(null);
    globalThis.fetch = originalFetch;
    if (originalApiUrl === undefined) {
      delete process.env.EXPO_PUBLIC_API_BASE_URL;
    } else {
      process.env.EXPO_PUBLIC_API_BASE_URL = originalApiUrl;
    }
    await clearAllCookies();
  });

  it('unit: normalizes legacy/missing/duplicate defect IDs and allocates collision-free IDs across tombstones and links', () => {
    // 1. Legacy array containing missing ID, colliding display ID, and duplicate primary BUG ID
    const repaired = normalizeDefectsWithUniqueIds([
      { id: 'BUG-301', defectId: 'DEF-001', title: 'First BUG-301' },
      { id: 'BUG-301', defectId: 'DEF-002', title: 'Second pre-fix colliding BUG-301' },
      { title: 'Legacy defect without IDs' },
      { id: 'DEF-004', defectId: 'DEF-004', title: 'Later existing DEF-004' },
      { id: 'BUG-305', defectId: 'DEF-002', title: 'Colliding display DEF-002' },
    ]);

    const primaryIds = repaired.map((d) => d.id);
    const displayIds = repaired.map((d) => d.defectId);
    expect(new Set(primaryIds).size).toBe(repaired.length);
    expect(new Set(displayIds).size).toBe(repaired.length);
    expect(repaired[0]).toMatchObject({ id: 'BUG-301', defectId: 'DEF-001' });
    expect(repaired[1].id).not.toBe('BUG-301');
    expect(repaired[1].defectId).toBe('DEF-002');
    expect(repaired[2].id).not.toBe('DEF-004');
    expect(repaired[3]).toMatchObject({ id: 'DEF-004', defectId: 'DEF-004' });
    expect(repaired[4].defectId).not.toBe('DEF-002');

    // 2. Allocator skips active defects, linked run references, and deletion tombstones
    const alloc = allocateNextDefectIds({
      defects: [{ id: 'BUG-301', defectId: 'DEF-001' }],
      testRuns: [
        { id: 'RUN-1', results: [{ testCaseId: 'TC-1', linkedDefectId: 'DEF-002' }] },
      ],
      executions: [{ id: 'ex-1', linkedDefectId: 'BUG-303' }],
      tombstoneIds: ['DEF-003', 'BUG-304'],
    });
    expect(alloc.defectId).toBe('DEF-004');
    expect(alloc.id).toBe('BUG-305');

    // 3. findDefectById prioritizes exact primary id over fallback display defectId
    const ambiguityList = [
      { id: 'BUG-901', defectId: 'DEF-010', title: 'Display match' },
      { id: 'DEF-010', defectId: 'DEF-099', title: 'Primary ID match' },
    ];
    expect(findDefectById(ambiguityList, 'DEF-010').defect.title).toBe(
      'Primary ID match'
    );
    expect(findDefectById(ambiguityList, 'BUG-901').defect.title).toBe(
      'Display match'
    );
  });

  it('generates strictly unique IDs on repeated creation and never reuses deleted earlier or highest defect IDs across reloads', async () => {
    const userId = 'user-h3-lifecycle';
    const serverProject = {
      id: 'proj-h3-1',
      userId,
      name: 'Defect ID Lifecycle Project',
      version: '1.0.0',
      updatedAt: '2026-07-01T00:00:00.000Z',
      testSuites: [
        {
          id: 'suite-1',
          name: 'Core',
          cases: [{ id: 'TC-101', title: 'Login', lastStatus: 'Failed' }],
        },
      ],
      executionRuns: [],
      executions: [],
      defects: [],
    };

    globalThis.fetch = async (url, init = {}) => {
      const target = String(url);
      const method = String(init.method || 'GET').toUpperCase();
      const body = init.body ? JSON.parse(init.body) : {};
      if (target.endsWith('/api/auth/me')) {
        return new Response(
          JSON.stringify({
            user: { userId, email: 'h3@example.com', name: 'H3 QA', role: 'QA Lead' },
          }),
          { status: 200 }
        );
      }
      if (target.endsWith('/api/auth/csrf')) {
        return new Response(JSON.stringify({ csrfToken: 'csrf_h3' }), { status: 200 });
      }
      if (target.endsWith('/api/projects') && method === 'GET') {
        return new Response(JSON.stringify([serverProject]), { status: 200 });
      }
      if (target.endsWith('/api/projects/proj-h3-1') && method === 'GET') {
        return new Response(JSON.stringify({ project: serverProject }), { status: 200 });
      }
      if (target.endsWith('/api/projects/proj-h3-1/data') && method === 'PATCH') {
        serverProject.defects = Array.isArray(body.defects)
          ? body.defects
          : serverProject.defects;
        serverProject.updatedAt = new Date(
          Date.parse(serverProject.updatedAt) + 1000
        ).toISOString();
        return new Response(JSON.stringify({ project: serverProject }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    await storeCookiesFromResponse(
      new Response('{}', {
        status: 200,
        headers: { 'set-cookie': 'qavora_auth_token=tok_h3; Path=/; HttpOnly' },
      }),
      'https://qavora.example.test/api/auth/login'
    );

    let wsRef = null;
    let projRef = null;
    function Harness() {
      wsRef = useWorkspace();
      projRef = useProjects();
      return React.createElement('div', null, `Defects:${wsRef.defects.length}`);
    }

    const mountTree = () =>
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(
          AuthProvider,
          null,
          React.createElement(
            ProjectProvider,
            null,
            React.createElement(WorkspaceProvider, null, React.createElement(Harness))
          )
        )
      );

    await harness.render(mountTree());
    await harness.flush(60);
    await React.act(async () => {
      await projRef.selectProject('proj-h3-1');
    });
    await harness.flush(50);

    // 1. Repeated creation on empty list: must produce distinct primary + display IDs (no BUG-301 collision!)
    const created = [];
    for (let i = 1; i <= 4; i += 1) {
      let res;
      await React.act(async () => {
        res = await wsRef.createDefect({
          title: `Bug #${i}`,
          reproductionSteps: `Step ${i}`,
          actualResult: `Failure ${i}`,
        });
      });
      expect(res.ok).toBe(true);
      created.push(res.defect);
    }

    const allIds1 = created.map((d) => d.id);
    const allDisplayIds1 = created.map((d) => d.defectId);
    expect(new Set(allIds1).size).toBe(4);
    expect(new Set(allDisplayIds1).size).toBe(4);
    expect(allDisplayIds1).toEqual(['DEF-001', 'DEF-002', 'DEF-003', 'DEF-004']);

    // 2. Delete an earlier defect (DEF-002) and create another -> must advance to DEF-005 (NOT DEF-004!)
    const defect2 = created[1];
    await React.act(async () => {
      const delRes = await wsRef.deleteDefect(defect2.id);
      expect(delRes.ok).toBe(true);
    });
    expect(wsRef.defects.map((d) => d.defectId).sort()).toEqual([
      'DEF-001',
      'DEF-003',
      'DEF-004',
    ]);

    let d5Res;
    await React.act(async () => {
      d5Res = await wsRef.createDefect({
        title: 'Bug #5 after middle delete',
        reproductionSteps: 'Step 5',
        actualResult: 'Failure 5',
      });
    });
    expect(d5Res.ok).toBe(true);
    expect(d5Res.defect.defectId).toBe('DEF-005');
    expect(allIds1).not.toContain(d5Res.defect.id);

    // 3. Delete the HIGHEST defect (DEF-005), simulate full cold reload (unmount + remount), then create Bug #6 -> must NOT reuse DEF-005 or BUG-305!
    const deletedHighest = d5Res.defect;
    await React.act(async () => {
      const delRes = await wsRef.deleteDefect(deletedHighest.id);
      expect(delRes.ok).toBe(true);
    });

    await harness.cleanup();
    harness = await createRenderHarness();
    await harness.render(mountTree());
    await harness.flush(60);
    await React.act(async () => {
      await projRef.selectProject('proj-h3-1');
    });
    await harness.flush(50);

    let d6Res;
    await React.act(async () => {
      d6Res = await wsRef.createDefect({
        title: 'Bug #6 after highest delete and reload',
        reproductionSteps: 'Step 6',
        actualResult: 'Failure 6',
      });
    });
    expect(d6Res.ok).toBe(true);
    expect(d6Res.defect.defectId).not.toBe(deletedHighest.defectId);
    expect(d6Res.defect.defectId).toBe('DEF-006');
    expect(d6Res.defect.id).not.toBe(deletedHighest.id);

    // 4. Update & Delete target exact defect and leave sibling defects untouched
    const targetToUpdate = wsRef.defects.find((d) => d.defectId === 'DEF-003');
    expect(targetToUpdate).toBeTruthy();
    await React.act(async () => {
      const upd = await wsRef.updateDefect(targetToUpdate.id, {
        title: 'Updated Bug #3 Title',
        id: 'BUG-HIJACK',
        defectId: 'DEF-001',
      });
      expect(upd.ok).toBe(true);
      expect(upd.defect.id).toBe(targetToUpdate.id);
      expect(upd.defect.defectId).toBe('DEF-003');
    });
    expect(
      wsRef.defects.find((d) => d.defectId === 'DEF-001').title
    ).toBe('Bug #1');
    expect(
      wsRef.defects.find((d) => d.defectId === 'DEF-003').title
    ).toBe('Updated Bug #3 Title');
  });

  it('prevents offline-deleted defect ID reuse during HTTP 409 conflict sync so newly created defects are never dropped by tombstones', async () => {
    const userId = 'user-h3-offline';
    const serverProject = {
      id: 'proj-h3-off',
      userId,
      name: 'Offline H3 Project',
      updatedAt: '2026-07-02T00:00:00.000Z',
      testSuites: [],
      executionRuns: [],
      executions: [],
      defects: [
        { id: 'BUG-301', defectId: 'DEF-001', title: 'Initial Server Bug 1', status: 'Open', severity: 'High' },
        { id: 'BUG-302', defectId: 'DEF-002', title: 'Initial Server Bug 2', status: 'Open', severity: 'High' },
      ],
    };
    let sendConflictOnce = true;

    globalThis.fetch = async (url, init = {}) => {
      const target = String(url);
      const method = String(init.method || 'GET').toUpperCase();
      const body = init.body ? JSON.parse(init.body) : {};
      if (target.endsWith('/api/auth/me')) {
        return new Response(
          JSON.stringify({ user: { userId, email: 'h3off@example.com', name: 'H3 Off', role: 'QA' } }),
          { status: 200 }
        );
      }
      if (target.endsWith('/api/auth/csrf')) {
        return new Response(JSON.stringify({ csrfToken: 'csrf_h3o' }), { status: 200 });
      }
      if (target.endsWith('/api/projects') && method === 'GET') {
        return new Response(JSON.stringify([serverProject]), { status: 200 });
      }
      if (target.endsWith('/api/projects/proj-h3-off') && method === 'GET') {
        return new Response(JSON.stringify({ project: serverProject }), { status: 200 });
      }
      if (target.endsWith('/api/projects/proj-h3-off/data') && method === 'PATCH') {
        if (sendConflictOnce) {
          sendConflictOnce = false;
          // Another session updated the project concurrently
          serverProject.updatedAt = '2026-07-02T01:00:00.000Z';
          serverProject.defects.push({
            id: 'BUG-310',
            defectId: 'DEF-010',
            title: 'Remote Concurrent Defect',
            status: 'Open',
            severity: 'Medium',
          });
          return new Response(
            JSON.stringify({
              error: 'Conflict',
              code: 'CONFLICT',
              currentUpdatedAt: serverProject.updatedAt,
            }),
            { status: 409 }
          );
        }
        serverProject.defects = body.defects;
        serverProject.updatedAt = '2026-07-02T02:00:00.000Z';
        return new Response(JSON.stringify({ project: serverProject }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    await storeCookiesFromResponse(
      new Response('{}', {
        status: 200,
        headers: { 'set-cookie': 'qavora_auth_token=tok_h3o; Path=/; HttpOnly' },
      }),
      'https://qavora.example.test/api/auth/login'
    );

    let wsRef = null;
    let projRef = null;
    function Harness() {
      wsRef = useWorkspace();
      projRef = useProjects();
      return React.createElement('div', null, `Defects:${wsRef.defects.length}`);
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
            React.createElement(WorkspaceProvider, null, React.createElement(Harness))
          )
        )
      )
    );
    await harness.flush(60);
    await React.act(async () => {
      await projRef.selectProject('proj-h3-off');
    });
    await harness.flush(50);

    // Go offline, delete DEF-002 (BUG-302), and create a new defect
    await React.act(async () => {
      setSimulatedOfflineMode(true, { skipAutoReconnect: true });
      const delRes = await wsRef.deleteDefect('BUG-302');
      expect(delRes.ok).toBe(true);
      const createRes = await wsRef.createDefect({
        title: 'Created offline after deleting DEF-002',
        reproductionSteps: 'Repro offline',
        actualResult: 'Observe offline',
      });
      expect(createRes.ok).toBe(true);
      expect(createRes.defect.defectId).toBe('DEF-003');
      expect(createRes.defect.id).toBe('BUG-303');
    });

    // Reconnect -> HTTP 409 captured -> resolve with 'merge' -> DEF-002 stays deleted, DEF-003 survives, DEF-010 kept!
    let syncRes;
    await React.act(async () => {
      setSimulatedOfflineMode(false, { skipAutoReconnect: true });
      syncRes = await processProjectSyncQueue(userId, { ignoreBackoff: true });
    });
    expect(syncRes.conflicts).toBe(1);
    expect(syncRes.failed).toBe(0);

    const pendingOps = await getPendingProjectOperations(userId);
    const conflictOp = pendingOps.find((op) => op.status === 'conflict');
    expect(conflictOp).toBeTruthy();

    let mergeRes;
    await React.act(async () => {
      mergeRes = await resolveProjectConflict(conflictOp.id, 'merge', userId);
    });
    expect(mergeRes.ok).toBe(true);
    expect(mergeRes.syncResult?.failed).toBe(0);
    expect(mergeRes.syncResult?.synced).toBe(1);

    const finalDefectIds = serverProject.defects.map((d) => d.defectId).sort();
    expect(finalDefectIds).toEqual(['DEF-001', 'DEF-003', 'DEF-010']);
  });

  it('handles imported defect IDs cleanly across MERGE/REPLACE and avoids colliding with imported DEF/BUG numbers', async () => {
    const userId = 'user-h3-import';
    setActiveSyncUser(userId);
    setSimulatedOfflineMode(true, { skipAutoReconnect: true });

    const backupPayload = {
      application: 'Qavora',
      backupVersion: 1,
      schemaVersion: 1,
      projects: [
        {
          id: 'proj-h3-imp',
          name: 'Imported H3 Project',
          testSuites: [],
          executionRuns: [],
          executions: [],
          defects: [
            { id: 'BUG-410', defectId: 'DEF-012', title: 'Imported High Water' },
            { id: 'BUG-410', defectId: 'DEF-012', title: 'Duplicate Imported Record' },
            { title: 'Legacy Missing ID Imported Record' },
          ],
        },
      ],
      checklists: [],
    };

    const parsed = parseAndValidateImportPayload(JSON.stringify(backupPayload));
    expect(parsed.ok).toBe(true);
    const importedDefects = parsed.projects[0].defects;
    expect(new Set(importedDefects.map((d) => d.id)).size).toBe(3);
    expect(new Set(importedDefects.map((d) => d.defectId)).size).toBe(3);
    expect(
      parsed.warnings.some((w) => w.includes('Duplicate defect'))
    ).toBe(true);

    const offImp = await importWorkspaceOffline({
      userId,
      mode: 'replace',
      projects: parsed.projects,
      checklists: [],
    });
    expect(offImp.ok).toBe(true);

    // Hydrate imported project in WorkspaceProvider and create a new defect
    globalThis.fetch = async (url) => {
      const target = String(url);
      if (target.endsWith('/api/auth/me')) {
        return new Response(
          JSON.stringify({ user: { userId, email: 'h3imp@example.com', name: 'Imp', role: 'QA' } }),
          { status: 200 }
        );
      }
      if (target.endsWith('/api/auth/csrf')) {
        return new Response(JSON.stringify({ csrfToken: 'csrf_h3imp' }), { status: 200 });
      }
      if (target.endsWith('/api/projects')) {
        return new Response(JSON.stringify(offImp.projects), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    await storeCookiesFromResponse(
      new Response('{}', {
        status: 200,
        headers: { 'set-cookie': 'qavora_auth_token=tok_h3imp; Path=/; HttpOnly' },
      }),
      'https://qavora.example.test/api/auth/login'
    );

    let wsRef = null;
    let projRef = null;
    function Harness() {
      wsRef = useWorkspace();
      projRef = useProjects();
      return React.createElement(DefectsScreen);
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
            React.createElement(WorkspaceProvider, null, React.createElement(Harness))
          )
        )
      )
    );
    await harness.flush(60);
    await React.act(async () => {
      await projRef.selectProject('proj-h3-imp');
    });
    await harness.flush(50);

    const existingIds = new Set(wsRef.defects.map((d) => d.id));
    const existingDisplayIds = new Set(wsRef.defects.map((d) => d.defectId));

    let nextRes;
    await React.act(async () => {
      nextRes = await wsRef.createDefect({
        title: 'Post-import defect',
        reproductionSteps: '1. Import',
        actualResult: 'Works',
      });
    });
    expect(nextRes.ok).toBe(true);
    expect(existingIds.has(nextRes.defect.id)).toBe(false);
    expect(existingDisplayIds.has(nextRes.defect.defectId)).toBe(false);

    // Also test buildProjectWorkspaceState and buildBackendDefectsPayload deduplicate malformed input
    const hydrated = buildProjectWorkspaceState({
      id: 'proj-legacy',
      name: 'Legacy',
      defects: [
        { id: 'DEF-001', title: 'Legacy A' },
        { id: 'DEF-001', title: 'Legacy B' },
      ],
    });
    expect(new Set(hydrated.defects.map((d) => d.id)).size).toBe(2);
    const serialized = buildBackendDefectsPayload(hydrated.defects);
    expect(new Set(serialized.defects.map((d) => d.id)).size).toBe(2);
  });
});

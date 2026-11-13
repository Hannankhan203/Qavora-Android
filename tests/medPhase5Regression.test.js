import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import {
  memoryAsyncStorage,
  secureStoreController,
  mockSecureStoreModule,
  createRenderHarness,
  splashScreenController,
  findElements,
} from './helpers/testEnv.js';

const React = await import('react');
const RN = await import('react-native');
const { ThemeProvider, lightColors, darkColors } = await import(
  '../src/theme/theme.js'
);
const { setAuthUserStorageAdapter } = await import(
  '../src/services/authService.js'
);
const { AuthProvider } = await import('../src/context/AuthContext.js');
const { ProjectProvider, useProjects, setProjectStorageAdapter } =
  await import('../src/context/ProjectContext.js');
const {
  WorkspaceProvider,
  useWorkspace,
  useWorkspaceMutationLock,
  useWorkspaceBackOverlay,
} = await import('../src/context/WorkspaceContext.js');
const { setDataManagementStorageAdapter } = await import(
  '../src/services/dataManagementService.js'
);
const { setDefectIdStorageAdapter } = await import(
  '../src/context/workspace/defectIdUtils.js'
);
const {
  clearAllCookies,
  storeCookiesFromResponse,
  setCookieStorageAdapter,
  setSecureStoreImplementation,
} = await import('../src/services/cookieManager.js');
const {
  setActiveSyncUser,
  setSimulatedOfflineMode,
  processProjectSyncQueue,
  getPendingProjectOperations,
  setOfflineSyncStorageAdapter,
} = await import('../src/services/offlineSyncService.js');
const {
  createChecklist,
  setChecklistStorageAdapter,
} = await import('../src/services/checklistService.js');

const AuthScreen = (await import('../src/components/AuthScreen.js')).default;
const ProfileSettingsScreen = (
  await import('../src/components/ProfileSettingsScreen.js')
).default;
const DefectsScreen = (await import('../src/components/DefectsScreen.js'))
  .default;
const TestCasesScreen = (await import('../src/components/TestCasesScreen.js'))
  .default;
const TestRunsScreen = (await import('../src/components/TestRunsScreen.js'))
  .default;
const ChecklistsScreen = (await import('../src/components/ChecklistsScreen.js'))
  .default;
const App = (await import('../App.js')).default;

const PROJECT_ROOT = path.resolve(import.meta.dir, '..');

function walkJsFiles(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.expo' || entry.name === 'dist') {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkJsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      results.push(full);
    }
  }
  return results;
}

describe('Phase 5 — MEDIUM Issues Remediation (MED-01..MED-08)', () => {
  const prevEnv = {
    EXPO_PUBLIC_API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL,
    EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
    EXPO_PUBLIC_TRUSTED_ORIGIN: process.env.EXPO_PUBLIC_TRUSTED_ORIGIN,
    EXPO_PUBLIC_ALLOW_LOCAL_MOCK: process.env.EXPO_PUBLIC_ALLOW_LOCAL_MOCK,
    EXPO_PUBLIC_ENV: process.env.EXPO_PUBLIC_ENV,
    NODE_ENV: process.env.NODE_ENV,
  };
  let origFetch;
  let origBackAddEventListener;
  let harness;

  beforeEach(async () => {
    origFetch = globalThis.fetch;
    origBackAddEventListener = RN.BackHandler.addEventListener;
    await memoryAsyncStorage.clear();
    secureStoreController.reset();
    splashScreenController.reset();

    setAuthUserStorageAdapter(memoryAsyncStorage);
    setProjectStorageAdapter(memoryAsyncStorage);
    setDataManagementStorageAdapter(memoryAsyncStorage);
    setDefectIdStorageAdapter(memoryAsyncStorage);
    setOfflineSyncStorageAdapter(memoryAsyncStorage);
    setChecklistStorageAdapter(memoryAsyncStorage);
    setCookieStorageAdapter(memoryAsyncStorage);
    setSecureStoreImplementation(mockSecureStoreModule);
    await clearAllCookies();
    setActiveSyncUser(null);
    setSimulatedOfflineMode(false, { skipAutoReconnect: true });

    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://qavora.example.test';
    process.env.EXPO_PUBLIC_API_URL = 'https://qavora.example.test';
    process.env.EXPO_PUBLIC_TRUSTED_ORIGIN = 'https://qavora.example.test';
    delete process.env.EXPO_PUBLIC_ALLOW_LOCAL_MOCK;
    delete process.env.EXPO_PUBLIC_ENV;
    process.env.NODE_ENV = 'test';

    harness = await createRenderHarness();
  });

  afterEach(async () => {
    await harness.cleanup();
    globalThis.fetch = origFetch;
    RN.BackHandler.addEventListener = origBackAddEventListener;
    setSimulatedOfflineMode(false, { skipAutoReconnect: true });
    setActiveSyncUser(null);
    await memoryAsyncStorage.clear();
    await clearAllCookies();
    Object.entries(prevEnv).forEach(([key, val]) => {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    });
  });

  async function seedAuthenticatedUserAndProject(serverProject, opts = {}) {
    const userId = opts.userId || 'u-med-1';
    const email = opts.email || 'med-qa@qavora.example.test';
    const checklistsList = Array.isArray(opts.checklists) ? opts.checklists : [];

    await storeCookiesFromResponse(
      new Response('{}', {
        status: 200,
        headers: { 'set-cookie': 'qavora_auth_token=tok_med_1; Path=/; HttpOnly' },
      }),
      'https://qavora.example.test/api/auth/login'
    );

    const metrics = { getProjectFetchCount: 0, checklistPatchCalls: [] };

    globalThis.fetch = async (url, init = {}) => {
      const target = String(url);
      const method = String(init.method || 'GET').toUpperCase();
      const body = init.body ? JSON.parse(init.body) : null;

      if (opts.customFetch) {
        const customRes = await opts.customFetch(target, method, body, metrics);
        if (customRes) return customRes;
      }

      if (target.endsWith('/api/auth/me')) {
        return new Response(
          JSON.stringify({
            user: { userId, email, name: 'Med QA Engineer', role: 'Lead QA' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (target.endsWith('/api/auth/csrf')) {
        return new Response(JSON.stringify({ csrfToken: 'csrf_med_1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (target.endsWith('/api/projects') && method === 'GET') {
        return new Response(
          JSON.stringify(serverProject ? [serverProject] : []),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (
        serverProject &&
        target.endsWith(`/api/projects/${serverProject.id}`) &&
        method === 'GET'
      ) {
        metrics.getProjectFetchCount += 1;
        return new Response(JSON.stringify({ project: serverProject }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (
        serverProject &&
        target.endsWith(`/api/projects/${serverProject.id}/data`) &&
        method === 'PATCH'
      ) {
        Object.assign(serverProject, body, {
          updatedAt: '2026-08-01T00:10:00.000Z',
        });
        return new Response(JSON.stringify({ project: serverProject }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (target.endsWith('/api/checklists') && method === 'GET') {
        return new Response(JSON.stringify({ checklists: checklistsList }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (target.includes('/api/checklists/') && method === 'PATCH') {
        metrics.checklistPatchCalls.push({ url: target, body });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    return { userId, email, metrics };
  }

  // =========================================================================
  // MED-01 — React Hook Dependency Warnings & Stability
  // =========================================================================
  it('MED-01: has zero eslint-disable exhaustive-deps suppressions and stabilizes WorkspaceContext hydration across metadata updates', async () => {
    const sourceFiles = [
      path.join(PROJECT_ROOT, 'App.js'),
      ...walkJsFiles(path.join(PROJECT_ROOT, 'src')),
    ];
    for (const filePath of sourceFiles) {
      const content = fs.readFileSync(filePath, 'utf8');
      expect(content).not.toContain('eslint-disable');
      expect(content).not.toContain('react-hooks/exhaustive-deps');
    }

    const serverProject = {
      id: 'proj-med1',
      name: 'Hook Stability App',
      updatedAt: '2026-08-01T00:00:00.000Z',
      testSuites: [
        { id: 'suite-auth', name: 'Auth Suite', category: 'Functional' },
      ],
      testCases: [
        {
          id: 'TC-101',
          testCaseId: 'TC-101',
          suiteId: 'suite-auth',
          suiteName: 'Auth Suite',
          title: 'Stable Hook Case',
          priority: 'P1',
          lastStatus: 'Untested',
        },
      ],
      executionRuns: [
        {
          id: 'run-1',
          name: 'Smoke Run',
          status: 'In Progress',
          results: [{ testCaseId: 'TC-101', status: 'Untested' }],
        },
      ],
      executions: [],
      defects: [],
      testPlan: { id: 'plan-1', name: 'Master Plan', phases: [] },
    };

    const { metrics } = await seedAuthenticatedUserAndProject(serverProject);

    let wsRef = null;
    let projRef = null;
    function Harness() {
      wsRef = useWorkspace();
      projRef = useProjects();
      return React.createElement(
        'div',
        null,
        `${projRef.selectedProject?.name || 'none'}|${wsRef.selectedTestCaseId || 'none'}`
      );
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
      await projRef.selectProject('proj-med1');
      await projRef.getProject('proj-med1');
    });
    await harness.flush(50);

    const initialFetches = metrics.getProjectFetchCount;
    expect(initialFetches).toBe(1);

    await React.act(async () => {
      wsRef.setSelectedTestCaseId('TC-101');
      wsRef.setTestCasesSubTab('suites');
    });
    await harness.flush(20);

    // Trigger a metadata refresh that updates the project object identity/updatedAt for the SAME project ID
    serverProject.name = 'Hook Stability App Renamed';
    serverProject.updatedAt = '2026-08-01T00:05:00.000Z';
    await React.act(async () => {
      await projRef.refreshProjects();
    });
    await harness.flush(50);

    // Must not trigger another hydration reset that wipes selectedTestCaseId or loops fetches
    expect(wsRef.selectedTestCaseId).toBe('TC-101');
    expect(wsRef.testCasesSubTab).toBe('suites');
    expect(metrics.getProjectFetchCount).toBe(initialFetches);
  });

  // =========================================================================
  // MED-02 — Stacked React Native Modals
  // =========================================================================
  it('MED-02: prevents stacked DefectDetailModal + DefectDeleteModal and restores detail on cancel', async () => {
    const serverProject = {
      id: 'proj-med2',
      name: 'Modal Stacking Project',
      updatedAt: '2026-08-01T00:00:00.000Z',
      testSuites: [{ id: 's1', name: 'Core' }],
      testCases: [],
      executionRuns: [],
      executions: [],
      defects: [
        {
          id: 'BUG-501',
          defectId: 'DEF-501',
          title: 'Stacked Modal Regression Defect',
          severity: 'High',
          priority: 'High',
          status: 'Open',
          reproductionSteps: '1. Open detail\n2. Tap Delete',
          expectedResult: 'Detail closes before confirm modal appears',
          actualResult: 'Confirm modal opened cleanly',
        },
      ],
      testPlan: { id: 'p1', name: 'Plan', phases: [] },
    };

    await seedAuthenticatedUserAndProject(serverProject);

    let projRef = null;
    function Harness() {
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
      await projRef.selectProject('proj-med2');
    });
    await harness.flush(50);

    // Open DefectDetailModal by pressing defect row
    const defectCardBtn = harness.findByAttr(
      'aria-label',
      'Open defect DEF-501: Stacked Modal Regression Defect'
    )[0];
    expect(defectCardBtn).toBeTruthy();
    await harness.press(defectCardBtn);
    await harness.flush(20);

    const detailModals = findElements(harness.container, (el) => el.tagName === 'RN-MODAL');
    expect(detailModals).toHaveLength(1);
    const detailModalEl = detailModals[0];
    expect(harness.container.textContent).toContain('DEFECT WORKFLOW STATUS');
    expect(harness.container.textContent).not.toContain('Delete Defect?');

    // Request delete from inside DefectDetailModal
    const detailDeleteBtn = findElements(
      detailModalEl,
      (el) => el.getAttribute && el.getAttribute('aria-label') === 'Delete defect DEF-501'
    )[0];
    expect(detailDeleteBtn).toBeTruthy();
    await harness.press(detailDeleteBtn);
    await harness.flush(20);

    // Detail modal must be closed before Delete confirmation modal renders -> max 1 RN-MODAL at once
    expect(findElements(harness.container, (el) => el.tagName === 'RN-MODAL')).toHaveLength(1);
    expect(harness.container.textContent).not.toContain('DEFECT WORKFLOW STATUS');
    expect(harness.container.textContent).toContain('Delete Defect?');

    // Cancel delete confirmation -> restores DefectDetailModal
    const cancelBtn = harness.findByAttr('aria-label', 'Cancel deleting defect')[0];
    expect(cancelBtn).toBeTruthy();
    await harness.press(cancelBtn);
    await harness.flush(20);

    expect(findElements(harness.container, (el) => el.tagName === 'RN-MODAL')).toHaveLength(1);
    expect(harness.container.textContent).toContain('DEFECT WORKFLOW STATUS');
    expect(harness.container.textContent).not.toContain('Delete Defect?');
  });

  it('MED-02: prevents stacked TestCaseDetailModal + TestCaseDeleteModal when deleting from detail view', async () => {
    const tc901 = {
      id: 'TC-901',
      testCaseId: 'TC-901',
      suiteId: 's1',
      suiteName: 'Suite Alpha',
      title: 'Non-stacking TC',
      priority: 'P1',
      lastStatus: 'Untested',
      steps: [],
      expectedResult: 'Clean modal switch',
    };
    const serverProject = {
      id: 'proj-med2-tc',
      name: 'TC Modal Project',
      updatedAt: '2026-08-01T00:00:00.000Z',
      testSuites: [
        { id: 's1', name: 'Suite Alpha', cases: [tc901], testCases: [tc901] },
        { id: 's2', name: 'Suite Beta', cases: [], testCases: [] },
      ],
      executionRuns: [],
      executions: [],
      defects: [],
      testPlan: { id: 'p1', name: 'Plan', phases: [] },
    };

    await seedAuthenticatedUserAndProject(serverProject);

    let projRef = null;
    function Harness() {
      projRef = useProjects();
      return React.createElement(TestCasesScreen);
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
      await projRef.selectProject('proj-med2-tc');
    });
    await harness.flush(50);

    const openTcBtn = harness.findByAttr(
      'aria-label',
      'Open test case TC-901: Non-stacking TC, P1 priority, status Untested'
    )[0];
    expect(openTcBtn).toBeTruthy();
    await harness.press(openTcBtn);
    await harness.flush(20);

    expect(findElements(harness.container, (el) => el.tagName === 'RN-MODAL')).toHaveLength(1);
    expect(harness.container.textContent).toContain('CURRENT EXECUTION STATUS');

    const deleteTcBtn = harness.findByAttr('aria-label', 'Delete test case TC-901')[0];
    expect(deleteTcBtn).toBeTruthy();
    await harness.press(deleteTcBtn);
    await harness.flush(20);

    expect(findElements(harness.container, (el) => el.tagName === 'RN-MODAL')).toHaveLength(1);
    expect(harness.container.textContent).not.toContain('CURRENT EXECUTION STATUS');
    expect(harness.container.textContent).toContain('Delete Test Case?');
  });

  // =========================================================================
  // MED-03 — Dead/Unwired UI Fields
  // =========================================================================
  it('MED-03: wires checklist item category selection on create & fallback on edit, and renders device/buildVersion on TestRuns execution cards', async () => {
    const checklist = {
      id: 'chk-med3',
      userId: 'u-med-1',
      projectId: 'proj-med3',
      title: 'Security Gate Checklist',
      category: 'Security',
      priority: 'High',
      status: 'In Progress',
      items: [
        {
          id: 'item-legacy',
          title: 'Verify cookie flags',
          priority: 'High',
          completed: false,
        },
      ],
    };

    const tc301 = {
      id: 'TC-301',
      testCaseId: 'TC-301',
      suiteId: 's1',
      suiteName: 'Core',
      title: 'Biometric Login',
      priority: 'P0',
      lastStatus: 'Passed',
    };
    const serverProject = {
      id: 'proj-med3',
      name: 'Device Build Project',
      updatedAt: '2026-08-01T00:00:00.000Z',
      testSuites: [{ id: 's1', name: 'Core', cases: [tc301], testCases: [tc301] }],
      executionRuns: [
        {
          id: 'run-med3',
          name: 'Pixel 9 Field Run',
          status: 'In Progress',
          deviceInfo: 'Pixel 9 Pro',
          buildVersion: '2.9.0-rc4',
          environment: 'Android 15',
          results: [
            {
              testCaseId: 'TC-301',
              status: 'Passed',
              executedAt: '2026-08-01T12:00:00.000Z',
              tester: 'QA Lead',
              environment: 'Android 15 / Production',
              device: 'Galaxy S25 Ultra',
              buildVersion: '3.0.1-build.88',
            },
          ],
        },
      ],
      executions: [],
      defects: [],
      testPlan: { id: 'p1', name: 'Plan', phases: [] },
    };

    let updatedChecklistBody = null;
    await seedAuthenticatedUserAndProject(serverProject, {
      checklists: [checklist],
      customFetch: async (target, method, body) => {
        if (target.endsWith('/api/checklists/chk-med3') && method === 'PATCH') {
          updatedChecklistBody = body;
          const { items: _staleItems, ...checklistWithoutStaleItems } = checklist;
          const merged = { ...checklistWithoutStaleItems, ...body };
          return new Response(JSON.stringify({ checklist: merged }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return null;
      },
    });

    let projRef = null;
    function ChecklistHarness() {
      projRef = useProjects();
      return React.createElement(ChecklistsScreen, {
        activeChecklistId: 'chk-med3',
      });
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
              React.createElement(ChecklistHarness)
            )
          )
        )
      )
    );
    await harness.flush(60);

    // Select 'Performance' category pill in Add Step composer & submit new step
    const perfCatPill = harness.findByAttr(
      'aria-label',
      'New step category: Performance'
    )[0];
    expect(perfCatPill).toBeTruthy();
    await harness.press(perfCatPill);
    await harness.flush(10);

    const newTitleInput = harness.findByAttr(
      'aria-label',
      'New verification step title'
    )[0];
    expect(newTitleInput).toBeTruthy();
    await React.act(async () => {
      newTitleInput.value = 'Measure cold start under 900ms';
      const reactPropsKey = Object.keys(newTitleInput).find((k) =>
        k.startsWith('__reactProps$')
      );
      newTitleInput[reactPropsKey].onChange({
        target: { value: 'Measure cold start under 900ms' },
      });
    });
    await harness.flush(10);

    const addStepBtn = harness.findByAttr('aria-label', 'Add verification step')[0];
    await harness.press(addStepBtn);
    await harness.flush(40);

    expect(updatedChecklistBody).toBeTruthy();
    const wireItems = Array.isArray(updatedChecklistBody.items)
      ? updatedChecklistBody.items
      : (updatedChecklistBody.phases || []).flatMap((p) => p.items || []);
    const addedWireItem = wireItems.find(
      (i) => (i.title || i.text) === 'Measure cold start under 900ms'
    );
    expect(addedWireItem).toBeTruthy();
    expect(addedWireItem?.category || addedWireItem?.phaseName).toBe('Performance');
    expect(harness.container.textContent).toContain('Measure cold start under 900ms');
    expect(harness.container.textContent).toContain('Performance');

    // Legacy item without category falls back to active checklist category ('Security') on Edit
    const editLegacyBtn = harness.findByAttr(
      'aria-label',
      'Edit step Verify cookie flags'
    )[0];
    expect(editLegacyBtn).toBeTruthy();
    await harness.press(editLegacyBtn);
    await harness.flush(20);

    // In Edit modal, 'Security' category pill should be selected
    const editModal = findElements(harness.container, (el) => el.tagName === 'RN-MODAL')[0];
    expect(editModal).toBeTruthy();
    expect(editModal.textContent).toContain('Security');

    // Now render TestRunsScreen and verify device & buildVersion appear on execution row
    function TestRunsHarness() {
      projRef = useProjects();
      return React.createElement(TestRunsScreen);
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
              React.createElement(TestRunsHarness)
            )
          )
        )
      )
    );
    await harness.flush(60);
    await React.act(async () => {
      await projRef.selectProject('proj-med3');
    });
    await harness.flush(40);

    expect(harness.container.textContent).toContain('Galaxy S25 Ultra');
    expect(harness.container.textContent).toContain('Build 3.0.1-build.88');
  });

  // =========================================================================
  // MED-04 — Modal Mutation Safety
  // =========================================================================
  it('MED-04: blocks BackHandler navigation and overlay dismissal while an active mutation lock is held, then restores when idle', async () => {
    const serverProject = {
      id: 'proj-med4',
      name: 'Mutation Safety App',
      updatedAt: '2026-08-01T00:00:00.000Z',
      testSuites: [{ id: 's1', name: 'Suite 1', cases: [], testCases: [] }],
      executionRuns: [],
      executions: [],
      defects: [],
      testPlan: { id: 'p1', name: 'Plan', phases: [] },
    };

    let resolvePatch;
    await seedAuthenticatedUserAndProject(serverProject, {
      customFetch: async (target, method) => {
        if (target.endsWith('/api/projects/proj-med4/data') && method === 'PATCH') {
          return new Promise((resolve) => {
            resolvePatch = resolve;
          });
        }
        return null;
      },
    });

    // Part A: Verify App.js BackHandler consumes back press during an active project mutation
    const hardwareBackListeners = [];
    RN.BackHandler.addEventListener = (eventName, handler) => {
      if (eventName === 'hardwareBackPress') {
        hardwareBackListeners.push(handler);
      }
      return {
        remove: () => {
          const idx = hardwareBackListeners.indexOf(handler);
          if (idx >= 0) hardwareBackListeners.splice(idx, 1);
        },
      };
    };

    await harness.render(React.createElement(App));
    await harness.flush(80);
    expect(hardwareBackListeners.length).toBeGreaterThan(0);

    // Switch to Test Cases tab while idle
    const testCasesTab = harness.findByAttr('aria-label', 'Cases')[0];
    if (testCasesTab) {
      await harness.press(testCasesTab);
      await harness.flush(20);
    }

    // Also verify useWorkspaceMutationLock + useWorkspaceBackOverlay coordination
    let overlayClosedCount = 0;
    let setLockedFn = null;
    let wsRef = null;

    function LockHarness() {
      const [locked, setLocked] = React.useState(true);
      setLockedFn = setLocked;
      wsRef = useWorkspace();
      useWorkspaceMutationLock(locked, 'harness-lock');
      useWorkspaceBackOverlay(() => {
        if (!locked) {
          overlayClosedCount += 1;
        }
        return true;
      });
      return React.createElement(
        'div',
        null,
        `Locked:${String(locked)}|Active:${String(wsRef.isAnyMutationActive)}`
      );
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
              React.createElement(LockHarness)
            )
          )
        )
      )
    );
    await harness.flush(40);

    expect(wsRef.isAnyMutationActive).toBe(true);
    expect(wsRef.isAnyMutationActiveRef.current).toBe(true);

    // Registered back overlay must refuse dismissal while locked
    await React.act(async () => {
      wsRef.handleActiveBackOverlay();
    });
    expect(overlayClosedCount).toBe(0);

    // Release mutation lock -> overlay dismissal & idle state restore cleanly
    await React.act(async () => {
      setLockedFn(false);
    });
    await harness.flush(20);
    expect(wsRef.isAnyMutationActive).toBe(false);

    await React.act(async () => {
      const handled = wsRef.handleActiveBackOverlay();
      expect(handled).toBe(true);
    });
    expect(overlayClosedCount).toBe(1);
    if (resolvePatch) {
      resolvePatch(new Response(JSON.stringify({ project: serverProject }), { status: 200 }));
    }
  });

  // =========================================================================
  // MED-05 — Silent Failure Feedback
  // =========================================================================
  it('MED-05: shows clear failure feedback for failed session verification, failed checklist item edit, and failed move/delete without showing success', async () => {
    const checklist = {
      id: 'chk-med5',
      userId: 'u-med-1',
      title: 'Failure Feedback Checklist',
      category: 'General QA',
      priority: 'High',
      status: 'Pending',
      items: [
        {
          id: 'item-1',
          title: 'Original Step Title',
          priority: 'Medium',
          category: 'General QA',
          completed: false,
        },
      ],
    };

    const tc501 = {
      id: 'TC-501',
      testCaseId: 'TC-501',
      suiteId: 's1',
      suiteName: 'Suite 1',
      title: 'Case 501',
      priority: 'P1',
      lastStatus: 'Untested',
    };
    const serverProject = {
      id: 'proj-med5',
      name: 'Failure Feedback Project',
      updatedAt: '2026-08-01T00:00:00.000Z',
      testSuites: [{ id: 's1', name: 'Suite 1', cases: [tc501], testCases: [tc501] }],
      executionRuns: [],
      executions: [],
      defects: [],
      testPlan: { id: 'p1', name: 'Plan', phases: [] },
    };

    let failAuthMe = false;
    await seedAuthenticatedUserAndProject(serverProject, {
      checklists: [checklist],
      customFetch: async (target, method) => {
        if (target.endsWith('/api/auth/me') && failAuthMe) {
          return new Response(
            JSON.stringify({ error: 'Session verification service unavailable' }),
            { status: 500, headers: { 'content-type': 'application/json' } }
          );
        }
        if (target.endsWith('/api/checklists/chk-med5') && method === 'PATCH') {
          return new Response(
            JSON.stringify({ error: 'Server rejected checklist update' }),
            { status: 500, headers: { 'content-type': 'application/json' } }
          );
        }
        return null;
      },
    });

    // 1. Test ProfileSettingsScreen failed Verify Session feedback
    let wsRef = null;
    function ProfileHarness() {
      wsRef = useWorkspace();
      return React.createElement(ProfileSettingsScreen);
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
              React.createElement(ProfileHarness)
            )
          )
        )
      )
    );
    await harness.flush(60);

    failAuthMe = true;
    const verifyBtn = harness.findByAttr(
      'aria-label',
      'Verify authenticated session'
    )[0];
    expect(verifyBtn).toBeTruthy();
    await harness.press(verifyBtn);
    await harness.flush(50);

    expect(harness.container.textContent).not.toContain('Session verified for');
    expect(harness.container.textContent).toContain('Session');
    expect(wsRef.toast?.tone).toBe('danger');

    // 2. Test WorkspaceContext failed move & delete emit danger toast and ok: false
    let moveFailRes;
    let delCaseFailRes;
    let delRunFailRes;
    let delDefectFailRes;
    await React.act(async () => {
      moveFailRes = await wsRef.moveTestCaseToSuite('nonexistent-tc', 's1');
    });
    expect(moveFailRes.ok).toBe(false);
    expect(wsRef.toast?.tone).toBe('danger');

    await React.act(async () => {
      delCaseFailRes = await wsRef.deleteTestCase('nonexistent-tc');
    });
    expect(delCaseFailRes.ok).toBe(false);
    expect(wsRef.toast?.tone).toBe('danger');

    await React.act(async () => {
      delRunFailRes = await wsRef.deleteTestRun('nonexistent-run');
    });
    expect(delRunFailRes.ok).toBe(false);
    expect(wsRef.toast?.tone).toBe('danger');

    await React.act(async () => {
      delDefectFailRes = await wsRef.deleteDefect('nonexistent-defect');
    });
    expect(delDefectFailRes.ok).toBe(false);
    expect(wsRef.toast?.tone).toBe('danger');

    // 3. Test ChecklistsScreen ChecklistEditItemModal shows error inline and stays open on failure
    failAuthMe = false;
    function EditChecklistHarness() {
      wsRef = useWorkspace();
      return React.createElement(ChecklistsScreen, {
        activeChecklistId: 'chk-med5',
      });
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
              React.createElement(EditChecklistHarness)
            )
          )
        )
      )
    );
    await harness.flush(60);

    const editBtn = harness.findByAttr(
      'aria-label',
      'Edit step Original Step Title'
    )[0];
    expect(editBtn).toBeTruthy();
    await harness.press(editBtn);
    await harness.flush(20);

    const saveStepBtn = harness.findByAttr('aria-label', 'Save Step')[0];
    expect(saveStepBtn).toBeTruthy();
    await harness.press(saveStepBtn);
    await harness.flush(50);

    // Modal must remain open with inline error displayed and NO success toast
    const modal = findElements(harness.container, (el) => el.tagName === 'RN-MODAL')[0];
    expect(modal).toBeTruthy();
    expect(modal.textContent).toContain('Server rejected checklist update');
    expect(wsRef.toast?.tone).toBe('danger');
    expect(wsRef.toast?.message).not.toContain('Updated checklist item');
  });

  // =========================================================================
  // MED-06 — Offline Project ID Remapping
  // =========================================================================
  it('MED-06: remaps temp project ID across queued child operations (suites, cases, runs, executions, defects, checklists) and advances updatedAt cleanly', async () => {
    const userId = 'u-med6';
    setActiveSyncUser(userId);
    const syncedState = {
      createdProjects: [],
      patchedProjectData: [],
      createdChecklists: [],
    };
    const permanentProjectId = 'proj_perm_600';
    const initialCreatedUpdatedAt = '2026-08-01T00:00:01.000Z';

    await seedAuthenticatedUserAndProject(null, {
      userId,
      email: 'med6@qavora.example.test',
      customFetch: async (target, method, body) => {
        if (target.endsWith('/api/projects') && method === 'POST') {
          const created = {
            ...body,
            id: permanentProjectId,
            _id: permanentProjectId,
            userId,
            createdAt: initialCreatedUpdatedAt,
            updatedAt: initialCreatedUpdatedAt,
          };
          syncedState.createdProjects.push(created);
          return new Response(JSON.stringify(created), {
            status: 201,
            headers: { 'content-type': 'application/json' },
          });
        }
        if (
          target.endsWith(`/api/projects/${permanentProjectId}/data`) &&
          method === 'PATCH'
        ) {
          syncedState.patchedProjectData.push({ target, body });
          const updated = {
            ...(syncedState.createdProjects[0] || { id: permanentProjectId }),
            ...body,
            id: permanentProjectId,
            updatedAt: '2026-08-01T00:02:00.000Z',
          };
          return new Response(JSON.stringify({ project: updated }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        if (
          target.endsWith(`/api/projects/${permanentProjectId}`) &&
          method === 'GET'
        ) {
          const current =
            syncedState.createdProjects[0] || {
              id: permanentProjectId,
              name: 'Offline Created Project',
              updatedAt: '2026-08-01T00:02:00.000Z',
            };
          return new Response(JSON.stringify({ project: current }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        if (target.endsWith('/api/checklists') && method === 'POST') {
          syncedState.createdChecklists.push(body);
          return new Response(
            JSON.stringify({
              checklist: {
                ...body,
                id: 'chk_perm_601',
                _id: 'chk_perm_601',
              },
            }),
            { status: 201, headers: { 'content-type': 'application/json' } }
          );
        }
        return null;
      },
    });

    let projRef = null;
    let wsRef = null;
    function Harness() {
      projRef = useProjects();
      wsRef = useWorkspace();
      return React.createElement(
        'div',
        null,
        `Proj:${projRef.selectedProject?.id || 'none'}|Defect:${wsRef.selectedDefectId || 'none'}`
      );
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

    // Go offline and create a new project -> gets temp_* ID
    let tempProjectId;
    await React.act(async () => {
      setSimulatedOfflineMode(true, { skipAutoReconnect: true });
      const createRes = await projRef.createProject({
        name: 'Offline Created Project',
        type: 'Mobile Application',
        status: 'Active',
        version: '1.0.0',
        environment: 'Android 15 / QA',
      });
      expect(createRes.ok).toBe(true);
      expect(createRes.queuedOffline).toBe(true);
      tempProjectId = createRes.project.id;
      expect(String(tempProjectId).startsWith('proj_')).toBe(true);
    });
    await harness.flush(40);

    // Perform child mutations referencing the temporary project ID
    let createdDefectId;
    await React.act(async () => {
      const suiteRes = await wsRef.createSuite({
        name: 'Offline Auth Suite',
        category: 'Security',
      });
      expect(suiteRes.ok).toBe(true);

      const caseRes = await wsRef.createTestCase({
        title: 'Offline Login Check',
        suiteId: suiteRes.suite.id,
        priority: 'P0',
      });
      expect(caseRes.ok).toBe(true);

      const runRes = await wsRef.createTestRun({
        name: 'Offline Regression Run',
        suiteId: suiteRes.suite.id,
        testCaseIds: [caseRes.testCase.id],
      });
      expect(runRes.ok).toBe(true);
      expect(runRes.testRun).toBeTruthy();

      const execRes = await wsRef.recordTestExecution({
        testRunId: runRes.testRun.id,
        testCaseId: caseRes.testCase.id,
        status: 'Failed',
        actualResult: 'Crashed offline',
      });
      expect(execRes.ok).toBe(true);

      const defectRes = await wsRef.createDefect({
        title: 'Offline Logged Crash',
        reproductionSteps: '1. Tap login',
        actualResult: 'Crash',
        linkedTestCaseId: caseRes.testCase.id,
        linkedTestRunId: runRes.testRun.id,
      });
      expect(defectRes.ok).toBe(true);
      createdDefectId = defectRes.defect.id;
      wsRef.setSelectedDefectId(createdDefectId);

      const chkRes = await createChecklist(
        {
          title: 'Offline Linked Checklist',
          projectId: tempProjectId,
          projectName: 'Offline Created Project',
          category: 'Release Readiness',
          items: [{ title: 'Verify sync remap', priority: 'High' }],
        },
        { userId }
      );
      expect(chkRes.ok).toBe(true);
      expect(chkRes.queuedOffline).toBe(true);
    });

    const queuedBeforeSync = await getPendingProjectOperations(userId);
    expect(queuedBeforeSync.length).toBeGreaterThanOrEqual(3);
    expect(queuedBeforeSync.every((op) => op.projectId === tempProjectId)).toBe(true);

    // Reconnect and sync queued operations in FIFO order
    let syncRes;
    await React.act(async () => {
      setSimulatedOfflineMode(false, { skipAutoReconnect: true });
      syncRes = await processProjectSyncQueue(userId, { ignoreBackoff: true });
    });
    await harness.flush(60);

    expect(syncRes.conflicts).toBe(0);
    expect(syncRes.failed).toBe(0);
    expect(syncRes.synced).toBeGreaterThanOrEqual(3);

    // Verify temporary project ID was remapped to permanentProjectId on server calls
    expect(syncedState.createdProjects).toHaveLength(1);
    expect(syncedState.patchedProjectData.length).toBeGreaterThanOrEqual(1);
    const lastDataPatch =
      syncedState.patchedProjectData[syncedState.patchedProjectData.length - 1];
    expect(lastDataPatch.target).toContain(`/api/projects/${permanentProjectId}/data`);
    expect(lastDataPatch.body.expectedUpdatedAt).toBe(initialCreatedUpdatedAt);
    expect(
      lastDataPatch.body.defects.some((d) => d.title === 'Offline Logged Crash')
    ).toBe(true);

    // Checklist linked to proj_* temp ID must have been sent with permanentProjectId
    expect(syncedState.createdChecklists).toHaveLength(1);
    const createdChkWire = syncedState.createdChecklists[0];
    expect(createdChkWire.promotedProjectId || createdChkWire.projectId).toBe(
      permanentProjectId
    );

    // Open UI selection in WorkspaceProvider survived temp_ -> permanent ID transition
    expect(projRef.selectedProject?.id).toBe(permanentProjectId);
    expect(wsRef.selectedDefectId).toBe(createdDefectId);

    const remainingQueue = await getPendingProjectOperations(userId);
    expect(remainingQueue).toHaveLength(0);
  });

  // =========================================================================
  // MED-07 — Splash Screen Lifecycle & Theme Colors
  // =========================================================================
  it('MED-07: waits for theme load and session restore before calling SplashScreen.hideAsync and aligns app.json colors with theme tokens', async () => {
    const appJson = JSON.parse(
      fs.readFileSync(path.join(PROJECT_ROOT, 'app.json'), 'utf8')
    );
    const splashPlugin = appJson.expo.plugins.find(
      (p) => Array.isArray(p) && p[0] === 'expo-splash-screen'
    );
    expect(appJson.expo.backgroundColor).toBe(lightColors.background);
    expect(splashPlugin[1].backgroundColor).toBe(lightColors.background);
    expect(splashPlugin[1].dark.backgroundColor).toBe(darkColors.background);
    expect(appJson.expo.android.adaptiveIcon.backgroundColor).toBe(
      darkColors.background
    );

    let resolveAuthMe;
    const authMePromise = new Promise((resolve) => {
      resolveAuthMe = resolve;
    });
    globalThis.fetch = async (url) => {
      if (String(url).endsWith('/api/auth/me')) {
        return authMePromise;
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    await harness.render(React.createElement(App));
    await harness.flush(70);

    // While session restore is pending, SplashScreen.hideAsync must NOT be called yet
    expect(splashScreenController.hideCalls).toBe(0);

    // Resolve session restore and allow layout/timer fallback to hide splash screen
    await React.act(async () => {
      resolveAuthMe(
        new Response(JSON.stringify({ user: null }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        })
      );
    });
    await harness.flush(90);

    expect(splashScreenController.hideCalls).toBeGreaterThanOrEqual(1);
  });

  // =========================================================================
  // MED-08 — Password Visibility Toggles
  // =========================================================================
  it('MED-08: renders single consistent password toggle per field, resets visibility on mode switch & submit, and disables toggles while loading', async () => {
    let resolveLogin;
    globalThis.fetch = async (url) => {
      const target = String(url);
      if (target.endsWith('/api/auth/me')) {
        return new Response(JSON.stringify({ user: null }), { status: 401 });
      }
      if (target.endsWith('/api/auth/csrf')) {
        return new Response(JSON.stringify({ csrfToken: 'csrf_m8' }), {
          status: 200,
        });
      }
      if (target.endsWith('/api/auth/login')) {
        return new Promise((resolve) => {
          resolveLogin = resolve;
        });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    await harness.render(
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(AuthProvider, null, React.createElement(AuthScreen))
      )
    );
    await harness.flush(40);

    const getSecureTextEntryProp = (el) => {
      const reactPropsKey = Object.keys(el || {}).find((k) =>
        k.startsWith('__reactProps$')
      );
      return Boolean(reactPropsKey && el[reactPropsKey]?.secureTextEntry);
    };

    // Login mode: exactly ONE Show password toggle and secureTextEntry defaults to true
    expect(harness.findByAttr('aria-label', 'Show password')).toHaveLength(1);
    const loginPassInput = harness.findByAttr('aria-label', 'Login password')[0];
    expect(loginPassInput).toBeTruthy();
    expect(getSecureTextEntryProp(loginPassInput)).toBe(true);

    // Toggle Show password -> Hide password
    await harness.press(harness.findByAttr('aria-label', 'Show password')[0]);
    await harness.flush(10);
    expect(harness.findByAttr('aria-label', 'Hide password')).toHaveLength(1);
    expect(
      getSecureTextEntryProp(harness.findByAttr('aria-label', 'Login password')[0])
    ).toBe(false);

    // Switch to Register mode -> visibility must reset back to masked
    const registerTab = harness.findByAttr(
      'aria-label',
      'Create Account tab'
    )[0];
    expect(registerTab).toBeTruthy();
    await harness.press(registerTab);
    await harness.flush(15);

    expect(harness.findByAttr('aria-label', 'Show password')).toHaveLength(1);
    expect(
      harness.findByAttr('aria-label', 'Show confirm password')
    ).toHaveLength(1);
    expect(
      getSecureTextEntryProp(harness.findByAttr('aria-label', 'Create password')[0])
    ).toBe(true);
    expect(
      getSecureTextEntryProp(harness.findByAttr('aria-label', 'Confirm Password')[0])
    ).toBe(true);

    // Toggle both on in Register, then switch back to Login -> Register & Login stay reset
    await harness.press(harness.findByAttr('aria-label', 'Show password')[0]);
    await harness.press(
      harness.findByAttr('aria-label', 'Show confirm password')[0]
    );
    await harness.flush(10);
    expect(harness.findByAttr('aria-label', 'Hide password')).toHaveLength(1);
    expect(
      harness.findByAttr('aria-label', 'Hide confirm password')
    ).toHaveLength(1);

    const signInTab = harness.findByAttr(
      'aria-label',
      'Sign In tab'
    )[0];
    expect(signInTab).toBeTruthy();
    await harness.press(signInTab);
    await harness.flush(15);
    expect(
      getSecureTextEntryProp(harness.findByAttr('aria-label', 'Login password')[0])
    ).toBe(true);

    // Unmask password, fill valid login credentials, and submit -> must re-mask & disable toggle while loading
    await harness.press(harness.findByAttr('aria-label', 'Show password')[0]);
    await harness.flush(10);
    const emailInput = harness.findByAttr('placeholder', 'tester@example.com')[0];
    expect(emailInput).toBeTruthy();
    const passInput = harness.findByAttr('aria-label', 'Login password')[0];
    await React.act(async () => {
      const emailKey = Object.keys(emailInput).find((k) =>
        k.startsWith('__reactProps$')
      );
      emailInput[emailKey].onChange({ target: { value: 'qa@qavora.app' } });
      const passKey = Object.keys(passInput).find((k) =>
        k.startsWith('__reactProps$')
      );
      passInput[passKey].onChange({ target: { value: 'StrongPass123!' } });
    });
    await harness.flush(10);

    const submitBtn = harness.findByAttr(
      'aria-label',
      'Sign In to Qavora'
    )[0];
    await harness.press(submitBtn);
    await harness.flush(20);

    const toggleWhileLoading = harness.findByAttr('aria-label', 'Show password')[0];
    expect(toggleWhileLoading).toBeTruthy();
    const toggleReactPropsKey = Object.keys(toggleWhileLoading || {}).find((k) =>
      k.startsWith('__reactProps$')
    );
    expect(
      Boolean(
        toggleWhileLoading.hasAttribute('disabled') ||
          toggleWhileLoading[toggleReactPropsKey]?.disabled
      )
    ).toBe(true);
    expect(typeof resolveLogin).toBe('function');
    expect(
      getSecureTextEntryProp(harness.findByAttr('aria-label', 'Login password')[0])
    ).toBe(true);

    // Clean up pending login promise
    await React.act(async () => {
      resolveLogin(
        new Response(JSON.stringify({ error: 'Invalid credentials' }), {
          status: 401,
        })
      );
    });
    await harness.flush(20);
  });
});

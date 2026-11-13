import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  dom,
  memoryAsyncStorage,
  secureStoreController,
  mockSecureStoreModule,
  createRenderHarness,
} from './helpers/testEnv.js';

const React = await import('react');
const { ThemeProvider } = await import('../src/theme/theme.js');
const { setAuthUserStorageAdapter } = await import('../src/services/authService.js');
const { AuthProvider, useAuth } = await import('../src/context/AuthContext.js');
const { ProjectProvider, useProjects, setProjectStorageAdapter } = await import(
  '../src/context/ProjectContext.js'
);
const { WorkspaceProvider, useWorkspace } = await import(
  '../src/context/WorkspaceContext.js'
);
const DataManagementSection = (
  await import('../src/components/DataManagementSection.js')
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
const {
  cacheProjectOffline,
  cacheProjectsListOffline,
  getCachedProjectsForUser,
} = await import('../src/services/offlineSync/offlineProjectCache.js');
const {
  setSimulatedOfflineMode,
  getPendingProjectOperations,
  processProjectSyncQueue,
  resolveProjectConflict,
  retryProjectOperation,
  discardProjectOperation,
  queueProjectMutation,
  queueChecklistMutation,
  getProjectDeletionTombstones,
  getCachedProjectById,
} = await import('../src/services/offlineSyncService.js');
const {
  cacheChecklistOffline,
  cacheChecklistsForUser,
  getCachedChecklistsForUser,
  setChecklistStorageAdapter,
} = await import('../src/services/checklists/checklistCache.js');
const { buildChecklistPromotionPreview } = await import(
  '../src/services/checklists/checklistPromotion.js'
);
const {
  fetchChecklists,
  promoteChecklistToProject,
} = await import('../src/services/checklistService.js');
const {
  localMockFetch,
  setLocalMockStorageAdapter,
  resetLocalMockMemoryForTests,
} = await import('../src/services/localMockBackend.js');
const {
  createFullBackupPayload,
  parseAndValidateImportPayload,
  exportTestCasesCSV,
  exportExecutionsCSV,
  exportDefectsCSV,
  fetchRecoverySnapshot,
  executeRollback,
  importWorkspaceData,
  importWorkspaceOffline,
  getLocalRecoverySnapshots,
  createLocalRecoverySnapshot,
  restoreLocalRecoverySnapshot,
  getLocalSnapshotsStorageKey,
  setDataManagementStorageAdapter,
} = await import('../src/services/dataManagementService.js');

// =============================================================================
// 1. MED-04 — Hybrid Import Suite Merging & Security Sanitization
// =============================================================================
describe('MED-04 — Hybrid Import Suite Merging & Security Validation', () => {
  it('merges testSuites with legacy nested testPlan.phases[*].suites[*], inherits phaseId, deduplicates cases, and warns on duplicate case IDs', () => {
    const hybridBackup = {
      backupVersion: 1,
      schemaVersion: 1,
      projects: [
        {
          id: 'proj-hybrid',
          name: 'Hybrid Import App',
          testPlan: {
            name: 'Master Plan',
            phases: [
              {
                id: 'phase-smoke',
                name: 'Smoke Phase',
                suites: [
                  {
                    id: 'suite-auth',
                    name: 'Auth Suite',
                    tags: ['smoke', 'auth'],
                    cases: [
                      { id: 'TC-1', title: 'Login valid user', lastStatus: 'Passed' },
                      { id: 'TC-2', title: 'Login invalid password', lastStatus: 'Failed' },
                    ],
                  },
                  {
                    id: 'suite-legacy-only',
                    name: 'Legacy Only Suite',
                    testCases: [
                      { id: 'TC-3', title: 'Legacy billing flow', lastStatus: 'Passed' },
                    ],
                  },
                ],
              },
            ],
          },
          testSuites: [
            {
              id: 'suite-auth',
              tags: ['critical', 'auth'],
              description: 'Modern Auth Suite Description',
              testCases: [
                { id: 'TC-1', title: 'Login valid user', lastStatus: 'Passed' },
                { id: 'TC-4', title: 'Password reset token', lastStatus: 'Untested' },
              ],
            },
            {
              id: 'suite-duplicate-case',
              name: 'Other Suite',
              testCases: [
                // Duplicate TC-4 across suites triggers deterministic reassignment + warning
                { id: 'TC-4', title: 'Duplicate ID Case', lastStatus: 'Untested' },
              ],
            },
          ],
        },
      ],
      checklists: [],
    };

    const result = parseAndValidateImportPayload(JSON.stringify(hybridBackup));
    expect(result.ok).toBe(true);
    expect(result.projects.length).toBe(1);

    const importedProj = result.projects[0];
    expect(importedProj.testSuites.length).toBe(3);

    const mergedAuthSuite = importedProj.testSuites.find(
      (s) => s.id === 'suite-auth'
    );
    expect(mergedAuthSuite).toBeDefined();
    expect(mergedAuthSuite.phaseId).toBe('phase-smoke');
    expect(mergedAuthSuite.name).toBe('Auth Suite');
    expect(mergedAuthSuite.description).toBe('Modern Auth Suite Description');
    expect(mergedAuthSuite.tags.sort()).toEqual(['auth', 'critical', 'smoke']);
    // Deduplicated TC-1 + unique TC-2 + TC-4 = 3 cases
    expect(mergedAuthSuite.cases.map((c) => c.id).sort()).toEqual([
      'TC-1',
      'TC-2',
      'TC-4',
    ]);

    const legacySuite = importedProj.testSuites.find(
      (s) => s.id === 'suite-legacy-only'
    );
    expect(legacySuite.phaseId).toBe('phase-smoke');
    expect(legacySuite.cases.map((c) => c.id)).toEqual(['TC-3']);

    // Duplicate TC-4 in suite-duplicate-case was reassigned with warning
    const dupSuite = importedProj.testSuites.find(
      (s) => s.id === 'suite-duplicate-case'
    );
    expect(dupSuite.cases[0].id).not.toBe('TC-4');
    expect(
      result.warnings.some((w) => w.includes('Duplicate test case ID "TC-4"'))
    ).toBe(true);
  });

  it('rejects NoSQL operators ($where), dotted keys, prototype pollution (__proto__), and oversized/incompatible backups', () => {
    const withNoSql =
      '{"backupVersion":1,"projects":[{"id":"p1","name":"Bad","testSuites":[],"$where":"1==1"}]}';
    expect(parseAndValidateImportPayload(withNoSql).ok).toBe(false);

    const withDottedKey =
      '{"backupVersion":1,"projects":[{"id":"p1","name":"Bad","user.role":"admin"}]}';
    expect(parseAndValidateImportPayload(withDottedKey).ok).toBe(false);

    const withProto =
      '{"backupVersion":1,"projects":[{"id":"p1","name":"Bad","__proto__":{"polluted":true}}]}';
    expect(parseAndValidateImportPayload(withProto).ok).toBe(false);

    const badVersion = JSON.stringify({
      backupVersion: 99,
      projects: [{ id: 'p1', name: 'Future Format' }],
    });
    expect(parseAndValidateImportPayload(badVersion).ok).toBe(false);

    const emptyRes = parseAndValidateImportPayload('   ');
    expect(emptyRes.ok).toBe(false);
  });
});

// =============================================================================
// 2. CRIT-01 — Checklist Promotion & Offline Cache Argument Ordering
// =============================================================================
describe('CRIT-01 — Checklist Promotion & Offline Cache Argument Ordering', () => {
  const originalFetch = globalThis.fetch;
  const originalApiUrl = process.env.EXPO_PUBLIC_API_BASE_URL;

  beforeEach(async () => {
    memoryAsyncStorage._map.clear();
    secureStoreController.reset();
    setCookieStorageAdapter(null);
    setSecureStoreImplementation(mockSecureStoreModule);
    setOfflineSyncStorageAdapter(memoryAsyncStorage);
    setChecklistStorageAdapter(memoryAsyncStorage);
    setActiveSyncUser('user-crit01');
    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://qavora.example.test';
    await clearAllCookies();
  });

  afterEach(async () => {
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

  it('enforces (record, userId) argument order in cacheChecklistOffline, cacheChecklistsForUser, and cacheProjectOffline', async () => {
    const validChecklist = await cacheChecklistOffline(
      { id: 'chk-1', title: 'Smoke Checklist', items: [] },
      'user-crit01'
    );
    expect(validChecklist).not.toBeNull();
    expect(validChecklist.id).toBe('chk-1');

    // Swapped arguments (userId first, checklist second) must NOT poison cache
    const swappedChecklist = await cacheChecklistOffline(
      'user-crit01',
      { id: 'chk-bad', title: 'Bad Order' }
    );
    expect(swappedChecklist).toBeNull();

    const listRes = await cacheChecklistsForUser(
      [{ id: 'chk-2', title: 'Batch Checklist', items: [] }],
      'user-crit01'
    );
    expect(listRes).toBe(true);

    const cachedProj = await cacheProjectOffline(
      { id: 'proj-1', name: 'Valid Project', status: 'Active' },
      'user-crit01'
    );
    expect(cachedProj).not.toBeNull();
    expect(cachedProj.id).toBe('proj-1');

    // Swapped project cache args return null safely without writing corrupted records
    const swappedProj = await cacheProjectOffline(
      'user-crit01',
      { id: 'proj-bad', name: 'Bad' }
    );
    expect(swappedProj).toBeNull();

    const storedProjects = await getCachedProjectsForUser('user-crit01');
    expect(storedProjects.map((p) => p.id)).toEqual(['proj-1']);
    const storedChecklists = await getCachedChecklistsForUser('user-crit01');
    expect(storedChecklists.map((c) => c.id)).toEqual(['chk-2']);
  });

  it('builds deterministic promotion preview, executes online promotion via updateProjectDataFn, and enforces 409 idempotency', async () => {
    const checklist = {
      id: 'chk-rel-1',
      title: 'Release Gate v2.0',
      description: 'Final release checklist',
      category: 'Security',
      priority: 'Critical',
      environment: 'Production',
      targetRelease: 'v2.0.0',
      phases: [
        {
          id: 'cph-1',
          title: 'Pre-Flight Checks',
          category: 'Security',
          items: [
            {
              id: 'item-1',
              title: 'Verify TLS certificate pinning',
              completed: true,
              notes: 'Verified with Charles proxy',
              category: 'Security',
            },
            {
              id: 'item-2',
              title: 'Verify session expiry enforcement',
              completed: false,
              category: 'Auth',
            },
          ],
        },
      ],
      items: [
        {
          id: 'item-1',
          title: 'Verify TLS certificate pinning',
          completed: true,
          notes: 'Verified with Charles proxy',
          category: 'Security',
          phaseId: 'cph-1',
          phaseTitle: 'Pre-Flight Checks',
        },
        {
          id: 'item-2',
          title: 'Verify session expiry enforcement',
          completed: false,
          category: 'Auth',
          phaseId: 'cph-1',
          phaseTitle: 'Pre-Flight Checks',
        },
      ],
    };

    const targetProject = {
      id: 'proj-dest-1',
      name: 'Mobile Client',
      version: '2.0.0',
      testPlan: { name: 'Master', phases: [] },
      testSuites: [],
      updatedAt: '2026-05-01T00:00:00.000Z',
    };

    const preview = buildChecklistPromotionPreview(checklist, targetProject);
    expect(preview.valid).toBe(true);
    expect(preview.alreadyFullyPromoted).toBe(false);
    expect(preview.stats.createdCaseCount).toBe(2);
    expect(preview.stats.passedCaseCount).toBe(1);
    expect(preview.stats.untestedCaseCount).toBe(1);
    expect(preview.casesToCreate[0].sourceChecklistId).toBe('chk-rel-1');
    expect(preview.casesToCreate[0].sourceChecklistItemId).toBe('item-1');
    expect(preview.casesToCreate[0].lastStatus).toBe('Passed');
    expect(preview.casesToCreate[1].lastStatus).toBe('Untested');

    // Promotion through ProjectContext updateProjectDataFn contract
    let currentServerProject = { ...targetProject };
    globalThis.fetch = async (url) => {
      if (String(url).includes('/api/projects/proj-dest-1')) {
        return new Response(JSON.stringify({ project: currentServerProject }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ checklist }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const promoteRes = await promoteChecklistToProject(checklist, targetProject, {
      userId: 'user-crit01',
      updateProjectDataFn: async (projectId, patchData) => {
        expect(projectId).toBe('proj-dest-1');
        currentServerProject = {
          ...currentServerProject,
          ...patchData,
        };
        await cacheProjectOffline(currentServerProject, 'user-crit01');
        return { ok: true, status: 200, project: currentServerProject };
      },
    });

    expect(promoteRes.ok).toBe(true);
    expect(promoteRes.summary.createdCaseCount).toBe(2);
    const cachedAfter = await getCachedProjectsForUser('user-crit01');
    expect(cachedAfter[0].testSuites.length).toBe(2);

    // Re-promoting the same checklist to the updated project is blocked idempotently with 409
    const duplicateRes = await promoteChecklistToProject(
      checklist,
      currentServerProject,
      {
        userId: 'user-crit01',
        updateProjectDataFn: async () => ({ ok: true }),
      }
    );
    expect(duplicateRes.ok).toBe(false);
    expect(duplicateRes.status).toBe(409);
    expect(duplicateRes.alreadyPromoted).toBe(true);
  });

  it('queues offline promotion as entityType=data UPDATE targeting PATCH /api/projects/:id/data, preserves user isolation, and handles retries/idempotency', async () => {
    const checklist = {
      id: 'chk-off-1',
      title: 'Offline Gate Checklist',
      phases: [
        {
          id: 'ph-1',
          title: 'Core Checks',
          category: 'Functional',
          items: [
            { id: 'it-1', title: 'Check offline queue', completed: true },
            { id: 'it-2', title: 'Check replay endpoint', completed: false },
          ],
        },
      ],
      items: [
        {
          id: 'it-1',
          title: 'Check offline queue',
          completed: true,
          phaseId: 'ph-1',
          phaseTitle: 'Core Checks',
        },
        {
          id: 'it-2',
          title: 'Check replay endpoint',
          completed: false,
          phaseId: 'ph-1',
          phaseTitle: 'Core Checks',
        },
      ],
    };

    const targetProject = {
      id: 'proj-off-dest',
      userId: 'user-a',
      name: 'Offline Destination App',
      version: '1.0.0',
      updatedAt: '2026-05-01T00:00:00.000Z',
      testPlan: { name: 'Master', phases: [] },
      testSuites: [],
    };

    setActiveSyncUser('user-a');
    setSimulatedOfflineMode(true, { skipAutoReconnect: true });
    await cacheProjectOffline(targetProject, 'user-a');

    const offlinePromoteRes = await promoteChecklistToProject(
      checklist,
      targetProject,
      {
        userId: 'user-a',
        isOffline: true,
      }
    );

    expect(offlinePromoteRes.ok).toBe(true);
    expect(offlinePromoteRes.queuedOffline).toBe(true);
    expect(offlinePromoteRes.operation).toBeDefined();
    expect(offlinePromoteRes.operation.entityType).toBe('data');
    expect(offlinePromoteRes.operation.operationType).toBe('UPDATE');
    expect(offlinePromoteRes.operation.expectedUpdatedAt).toBe(
      '2026-05-01T00:00:00.000Z'
    );

    // Verify per-user cache isolation (User A has promoted project; User B sees none)
    const userACache = await getCachedProjectsForUser('user-a', true);
    const userBCache = await getCachedProjectsForUser('user-b', true);
    expect(userACache.length).toBe(1);
    expect(userACache[0].id).toBe('proj-off-dest');
    expect(userACache[0].testSuites.length).toBeGreaterThan(0);
    expect(userACache[0]._pendingSync).toBe(true);
    expect(userBCache.length).toBe(0);

    const pendingUserA = await getPendingProjectOperations('user-a');
    expect(pendingUserA.length).toBe(1);
    expect(pendingUserA[0].entityType).toBe('data');
    expect(pendingUserA[0].operationType).toBe('UPDATE');
    expect(pendingUserA[0].idempotencyKey).toBe(
      'proj_user-a_proj-off-dest_data_workspace_data_UPDATE'
    );

    // Also test network failure fallback while nominally online
    setSimulatedOfflineMode(false, { skipAutoReconnect: true });
    const targetProject2 = {
      id: 'proj-net-fallback',
      userId: 'user-a',
      name: 'Network Fallback App',
      updatedAt: '2026-05-01T01:00:00.000Z',
      testSuites: [],
    };
    await cacheProjectOffline(targetProject2, 'user-a');
    globalThis.fetch = async () => {
      throw new TypeError('Network request failed');
    };
    const netFallbackRes = await promoteChecklistToProject(
      checklist,
      targetProject2,
      {
        userId: 'user-a',
      }
    );
    expect(netFallbackRes.ok).toBe(true);
    expect(netFallbackRes.queuedOffline).toBe(true);
    expect(netFallbackRes.operation.entityType).toBe('data');
    expect(netFallbackRes.operation.operationType).toBe('UPDATE');

    // Replay queue: verify calls target PATCH /api/projects/:id/data (NEVER bare /api/projects/:id)
    // First attempt simulates transient 500 on proj-off-dest to validate retry bookkeeping
    const patchUrls = [];
    let failFirstPatch = true;
    globalThis.fetch = async (url, init = {}) => {
      const targetUrl = String(url);
      if (targetUrl.endsWith('/api/auth/csrf')) {
        return new Response(JSON.stringify({ csrfToken: 'csrf_crit01' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (init.method === 'PATCH') {
        patchUrls.push(targetUrl);
        if (
          failFirstPatch &&
          targetUrl.includes('/api/projects/proj-off-dest/data')
        ) {
          failFirstPatch = false;
          return new Response(
            JSON.stringify({ error: 'Transient server error' }),
            { status: 500, headers: { 'content-type': 'application/json' } }
          );
        }
        const idMatch = targetUrl.match(/\/api\/projects\/([^/]+)\/data$/);
        const pid = idMatch ? idMatch[1] : 'unknown';
        const parsedBody = JSON.parse(init.body || '{}');
        return new Response(
          JSON.stringify({
            project: {
              id: pid,
              userId: 'user-a',
              name: pid,
              ...parsedBody,
              updatedAt: '2026-05-02T00:00:00.000Z',
            },
          }),
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
        headers: { 'set-cookie': 'qavora_auth_token=tok_c1; Path=/; HttpOnly' },
      }),
      'https://qavora.example.test/api/auth/login'
    );

    const firstSync = await processProjectSyncQueue('user-a');
    expect(firstSync.failed).toBe(1);
    expect(firstSync.synced).toBe(1);

    // Failed op stays queued with status='pending', retryCount = 1, and backoff timestamp
    const afterFirstSync = await getPendingProjectOperations('user-a');
    expect(afterFirstSync.length).toBe(1);
    expect(afterFirstSync[0].projectId).toBe('proj-off-dest');
    expect(afterFirstSync[0].status).toBe('pending');
    expect(afterFirstSync[0].retryCount).toBe(1);
    expect(afterFirstSync[0].nextRetryAt).toBeTruthy();

    // Retry explicit operation -> hits /api/projects/proj-off-dest/data and clears queue
    const retryRes = await retryProjectOperation(afterFirstSync[0].id, 'user-a');
    expect(retryRes.ok).toBe(true);
    expect((await getPendingProjectOperations('user-a')).length).toBe(0);

    // Every single PATCH URL must end in /data, never bare /api/projects/:id
    expect(patchUrls.length).toBe(3);
    patchUrls.forEach((u) => {
      expect(u.endsWith('/data')).toBe(true);
    });
  });
});

// =============================================================================
// 3. CRIT-02 — Sample Dataset Restoration Confirmation & Error Handling
// =============================================================================
describe('CRIT-02 — Sample Dataset Restoration Confirmation & Error Handling', () => {
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

  it('requires explicit confirmation before resetting data and surfaces backend persistence failures without claiming success', async () => {
    let failBackendPatch = true;
    const customProject = {
      id: 'proj-sample-test',
      userId: 'user-sample-1',
      name: 'Sample Guard Project',
      version: '1.2.0',
      updatedAt: '2026-05-01T00:00:00.000Z',
      testSuites: [
        {
          id: 'custom-suite-1',
          name: 'Custom Suite',
          cases: [{ id: 'CUST-1', title: 'Custom Case', lastStatus: 'Passed' }],
        },
      ],
      executionRuns: [],
      executions: [],
      defects: [],
    };

    globalThis.fetch = async (url, init = {}) => {
      const target = String(url);
      if (target.endsWith('/api/auth/me')) {
        return new Response(
          JSON.stringify({
            user: {
              userId: 'user-sample-1',
              email: 'sample@example.com',
              name: 'Sample Tester',
              role: 'QA Tester',
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (target.endsWith('/api/auth/csrf')) {
        return new Response(JSON.stringify({ csrfToken: 'csrf_sample' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (target.endsWith('/api/projects')) {
        return new Response(JSON.stringify([customProject]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (
        target.includes('/api/projects/proj-sample-test/data') &&
        init.method === 'PATCH'
      ) {
        if (failBackendPatch) {
          return new Response(
            JSON.stringify({ error: 'Database write rejected' }),
            { status: 500, headers: { 'content-type': 'application/json' } }
          );
        }
        return new Response(
          JSON.stringify({
            project: {
              ...customProject,
              ...JSON.parse(init.body || '{}'),
              updatedAt: '2026-05-02T00:00:00.000Z',
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      return new Response('{}', { status: 200 });
    };

    await storeCookiesFromResponse(
      new Response('{}', {
        status: 200,
        headers: { 'set-cookie': 'qavora_auth_token=tok_sample; Path=/; HttpOnly' },
      }),
      'https://qavora.example.test/api/auth/login'
    );

    let wsRef = null;
    let projectsRef = null;
    function Harness() {
      projectsRef = useProjects();
      wsRef = useWorkspace();
      return React.createElement('div', null, `Suites: ${wsRef.suites.length}`);
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
              React.createElement(Harness)
            )
          )
        )
      )
    );
    await harness.flush(50);

    await React.act(async () => {
      await projectsRef.selectProject('proj-sample-test');
    });
    await harness.flush(50);

    expect(wsRef.suites.map((s) => s.id)).toEqual(['custom-suite-1']);

    // 1. Calling resetToSampleData() without confirmation must cancel and preserve custom data
    let unconfirmedRes;
    await React.act(async () => {
      unconfirmedRes = await wsRef.resetToSampleData();
    });
    expect(unconfirmedRes.ok).toBe(false);
    expect(unconfirmedRes.canceled).toBe(true);
    expect(unconfirmedRes.code).toBe('CONFIRMATION_REQUIRED');
    expect(wsRef.suites.map((s) => s.id)).toEqual(['custom-suite-1']);
    expect(wsRef.testCases.map((tc) => tc.id)).toEqual(['CUST-1']);

    // 2. Confirmed call while backend fails -> surfaces error instead of claiming success
    let failedRes;
    await React.act(async () => {
      failedRes = await wsRef.resetToSampleData({ confirmed: true });
    });
    expect(failedRes.ok).toBe(false);
    expect(failedRes.status).toBe(500);
    expect(failedRes.error).toContain('Database write rejected');

    // 3. Confirmed call while backend succeeds -> restores full sample dataset
    failBackendPatch = false;
    let successRes;
    await React.act(async () => {
      successRes = await wsRef.resetToSampleData({ confirmed: true });
    });
    expect(successRes.ok).toBe(true);
    expect(successRes.restoredCounts).toEqual({
      suites: 4,
      testCases: 6,
      testRuns: 2,
      executions: 0,
      defects: 2,
    });
    expect(wsRef.suites.length).toBe(4);
    expect(wsRef.testCases.length).toBe(6);
  });

  it('requires confirmation and recovers loading/modal state + surfaces backend errors in DataManagementSection UI for both Restore and Clear Dataset actions', async () => {
    let failBackendPatch = true;
    const customProject = {
      id: 'proj-dm-crit02',
      userId: 'user-dm-c2',
      name: 'Dataset UI Guard',
      version: '2.0.0',
      updatedAt: '2026-05-01T00:00:00.000Z',
      testSuites: [
        {
          id: 'custom-s1',
          name: 'Custom Suite UI',
          cases: [{ id: 'CUST-10', title: 'Keep Me Safe', lastStatus: 'Passed' }],
        },
      ],
      executionRuns: [
        {
          id: 'RUN-C1',
          name: 'Custom Run',
          status: 'Active',
          results: [{ testCaseId: 'CUST-10', status: 'Passed' }],
        },
      ],
      executions: [],
      defects: [
        { id: 'DEF-C1', defectId: 'DEF-C1', title: 'Custom Bug', status: 'Open', severity: 'High' },
      ],
    };

    const patchPayloads = [];
    globalThis.fetch = async (url, init = {}) => {
      const target = String(url);
      if (target.endsWith('/api/auth/me')) {
        return new Response(
          JSON.stringify({
            user: {
              userId: 'user-dm-c2',
              email: 'c2ui@example.com',
              name: 'UI Tester',
              role: 'QA Engineer',
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (target.endsWith('/api/auth/csrf')) {
        return new Response(JSON.stringify({ csrfToken: 'csrf_c2' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (target.endsWith('/api/projects')) {
        return new Response(JSON.stringify([customProject]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (target.endsWith('/api/data/recovery-snapshot')) {
        return new Response(JSON.stringify({ snapshot: null }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (
        target.includes('/api/projects/proj-dm-crit02/data') &&
        init.method === 'PATCH'
      ) {
        const body = JSON.parse(init.body || '{}');
        patchPayloads.push(body);
        if (failBackendPatch) {
          return new Response(
            JSON.stringify({ error: 'Backend persistence denied' }),
            { status: 500, headers: { 'content-type': 'application/json' } }
          );
        }
        return new Response(
          JSON.stringify({
            project: {
              ...customProject,
              ...body,
              updatedAt: `2026-05-02T00:00:0${patchPayloads.length}.000Z`,
            },
          }),
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
        headers: { 'set-cookie': 'qavora_auth_token=tok_c2; Path=/; HttpOnly' },
      }),
      'https://qavora.example.test/api/auth/login'
    );

    let wsRef = null;
    let projectsRef = null;
    function HarnessScreen() {
      projectsRef = useProjects();
      wsRef = useWorkspace();
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
              React.createElement(HarnessScreen)
            )
          )
        )
      )
    );
    await harness.flush(60);

    await React.act(async () => {
      await projectsRef.selectProject('proj-dm-crit02');
    });
    await harness.flush(50);

    // Preview metrics must render sampleCounts including 0 Executions
    expect(harness.container.textContent).toContain('4Suites');
    expect(harness.container.textContent).toContain('6Test Cases');
    expect(harness.container.textContent).toContain('2Test Runs');
    expect(harness.container.textContent).toContain('0Executions');
    expect(harness.container.textContent).toContain('2Defects');

    // clearAllWorkspaceData without confirmation must be rejected cleanly
    let unconfirmedClear;
    await React.act(async () => {
      unconfirmedClear = await wsRef.clearAllWorkspaceData();
    });
    expect(unconfirmedClear.ok).toBe(false);
    expect(unconfirmedClear.code).toBe('CONFIRMATION_REQUIRED');
    expect(wsRef.suites.map((s) => s.id)).toEqual(['custom-s1']);
    expect(wsRef.testCases.map((c) => c.id)).toEqual(['CUST-10']);

    // 1. Open "Clear Active Project Dataset" modal -> confirm while backend fails ->
    //    verify error displays inside modal, data is rolled back, loading recovers
    const clearBtns = harness.findByAttr(
      'aria-label',
      'Clear Active Project Dataset'
    );
    expect(clearBtns.length).toBe(1);
    await harness.press(clearBtns[0]);
    expect(harness.container.textContent).toContain(
      'Clear Active Project Dataset?'
    );

    const confirmBtn1 = harness.findByAttr('aria-label', 'Confirm and Proceed');
    expect(confirmBtn1.length).toBe(1);
    await harness.press(confirmBtn1[0]);
    await harness.flush(40);

    expect(harness.container.textContent).toContain('Backend persistence denied');
    expect(harness.container.textContent).toContain('Confirm & Proceed');
    expect(harness.container.textContent).not.toContain('Processing...');
    // Custom workspace state rolled back intact!
    expect(wsRef.suites.map((s) => s.id)).toEqual(['custom-s1']);
    expect(wsRef.testCases.map((c) => c.id)).toEqual(['CUST-10']);
    expect(wsRef.defects.map((d) => d.id)).toEqual(['DEF-C1']);

    // Close modal via Cancel button to verify modal dismissal recovers after error
    const cancelBtn1 = harness.findByAttr('aria-label', 'Cancel operation');
    expect(cancelBtn1.length).toBe(1);
    await harness.press(cancelBtn1[0]);
    expect(harness.container.textContent).not.toContain(
      'Clear Active Project Dataset?'
    );

    // 2. Open "Restore Sample QA Dataset" modal -> confirm when backend recovers -> succeeds & closes modal
    failBackendPatch = false;
    const restoreBtns = harness.findByAttr(
      'aria-label',
      'Restore Sample QA Dataset'
    );
    await harness.press(restoreBtns[0]);
    expect(harness.container.textContent).toContain(
      'Restore Sample QA Dataset?'
    );
    const confirmBtn2 = harness.findByAttr('aria-label', 'Confirm and Proceed');
    await harness.press(confirmBtn2[0]);
    await harness.flush(40);

    expect(harness.container.textContent).not.toContain(
      'Restore Sample QA Dataset?'
    );
    expect(wsRef.suites.length).toBe(4);
    expect(wsRef.testCases.length).toBe(6);

    // 3. Re-open "Clear Active Project Dataset" modal -> confirm when backend succeeds -> clears dataset & closes modal
    const clearBtns2 = harness.findByAttr(
      'aria-label',
      'Clear Active Project Dataset'
    );
    await harness.press(clearBtns2[0]);
    const confirmBtn3 = harness.findByAttr('aria-label', 'Confirm and Proceed');
    await harness.press(confirmBtn3[0]);
    await harness.flush(40);

    expect(harness.container.textContent).not.toContain(
      'Clear Active Project Dataset?'
    );
    expect(wsRef.suites.map((s) => s.id)).toEqual(['suite-default']);
    expect(wsRef.testCases.length).toBe(0);
    expect(wsRef.testRuns.length).toBe(0);
    expect(wsRef.defects.length).toBe(0);
  });
});

// =============================================================================
// 4. CRIT-04 — Recovery Snapshot & Backup Checklist Preservation
// =============================================================================
describe('CRIT-04 — Recovery Snapshot & Backup Checklist Preservation', () => {
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
    setChecklistStorageAdapter(memoryAsyncStorage);
    setSimulatedOfflineMode(false, { skipAutoReconnect: true });
    setActiveSyncUser(null);
    await clearAllCookies();
    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://qavora.example.test';
    harness = await createRenderHarness();
  });

  afterEach(async () => {
    await harness.cleanup();
    setSimulatedOfflineMode(false, { skipAutoReconnect: true });
    setActiveSyncUser(null);
    setDataManagementStorageAdapter(null);
    setChecklistStorageAdapter(null);
    globalThis.fetch = originalFetch;
    if (originalApiUrl === undefined) {
      delete process.env.EXPO_PUBLIC_API_BASE_URL;
    } else {
      process.env.EXPO_PUBLIC_API_BASE_URL = originalApiUrl;
    }
    await clearAllCookies();
  });

  it('preserves checklists across backup creation, import validation, workspace replace import, and recovery snapshot rollback', async () => {
    const sampleChecklists = [
      { id: 'chk-101', title: 'Android Release Checklist', items: [{ id: 'i1', title: 'Check APK signing' }] },
      { id: 'chk-102', title: 'Regression Checklist', items: [{ id: 'i2', title: 'Run smoke tests' }] },
    ];
    const sampleProjects = [{ id: 'p-1', name: 'Workspace Alpha', testSuites: [] }];

    const backup = createFullBackupPayload(sampleProjects, sampleChecklists, {
      userId: 'u-1',
      email: 'qa@example.com',
    });
    expect(backup.checklists.length).toBe(2);
    expect(backup.metadata.totalChecklists).toBe(2);

    const validated = parseAndValidateImportPayload(JSON.stringify(backup));
    expect(validated.ok).toBe(true);
    expect(validated.checklistsCount).toBe(2);
    expect(validated.checklists.map((c) => c.id)).toEqual(['chk-101', 'chk-102']);

    let capturedImportBody = null;
    globalThis.fetch = async (url, init = {}) => {
      const target = String(url);
      if (target.endsWith('/api/data/import')) {
        capturedImportBody = JSON.parse(init.body || '{}');
        return new Response(
          JSON.stringify({
            mode: 'replace',
            imported: {
              projects: capturedImportBody.projects.length,
              checklists: capturedImportBody.checklists.length,
            },
            snapshotCreated: true,
            snapshotId: 'snap-server-1',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (target.endsWith('/api/data/recovery-snapshot')) {
        return new Response(
          JSON.stringify({
            snapshot: {
              snapshotId: 'snap-server-1',
              createdAt: '2026-05-10T10:00:00.000Z',
              projectsCount: 1,
              checklistsCount: 2,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (target.endsWith('/api/data/rollback')) {
        return new Response(
          JSON.stringify({
            restored: { projects: 1, checklists: 2 },
            message: 'Restored cleanly',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      return new Response('{}', { status: 200 });
    };

    const importRes = await importWorkspaceData({
      mode: 'replace',
      projects: validated.projects,
      checklists: validated.checklists,
    });
    expect(importRes.ok).toBe(true);
    expect(capturedImportBody.checklists.length).toBe(2);
    expect(importRes.imported.checklists).toBe(2);

    const snapRes = await fetchRecoverySnapshot();
    expect(snapRes.ok).toBe(true);
    expect(snapRes.snapshot.checklistsCount).toBe(2);

    const rollbackRes = await executeRollback();
    expect(rollbackRes.ok).toBe(true);
    expect(rollbackRes.restored.checklists).toBe(2);
  });

  it('displays server recovery snapshot checklist count inside DataManagementSection', async () => {
    globalThis.fetch = async (url) => {
      const target = String(url);
      if (target.endsWith('/api/auth/me')) {
        return new Response(
          JSON.stringify({
            user: {
              userId: 'user-snap-1',
              email: 'snap@example.com',
              name: 'Snap QA',
              role: 'QA Tester',
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (target.endsWith('/api/auth/csrf')) {
        return new Response(JSON.stringify({ csrfToken: 'csrf_snap' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (target.endsWith('/api/projects')) {
        return new Response(
          JSON.stringify([{ id: 'p-snap', userId: 'user-snap-1', name: 'Snap Proj', testSuites: [] }]),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (target.endsWith('/api/data/recovery-snapshot')) {
        return new Response(
          JSON.stringify({
            snapshot: {
              snapshotId: 'snap-ui-1',
              createdAt: '2026-05-10T10:00:00.000Z',
              projectsCount: 3,
              checklistsCount: 5,
            },
          }),
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
        headers: { 'set-cookie': 'qavora_auth_token=tok_snap; Path=/; HttpOnly' },
      }),
      'https://qavora.example.test/api/auth/login'
    );

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
              React.createElement(DataManagementSection)
            )
          )
        )
      )
    );
    await harness.flush(50);

    expect(harness.container.textContent).toContain('3 projects · 5 checklists');
  });

  it('captures complete workspace + checklists in local recovery snapshots, preserves backward compatibility with legacy snapshots, and restores locally without deleting existing checklists', async () => {
    const userId = 'user-snap-local-1';
    const richProject = {
      id: 'proj-snap-full',
      userId,
      name: 'Complete Snapshot Project',
      version: '2.1.0',
      updatedAt: '2026-06-01T10:00:00.000Z',
      testPlan: {
        id: 'plan-1',
        name: 'Master Plan',
        phases: [{ id: 'ph-1', name: 'Smoke Phase' }],
      },
      testSuites: [
        {
          id: 'suite-1',
          name: 'Auth Suite',
          phaseId: 'ph-1',
          cases: [
            { id: 'TC-1', title: 'Login Test', lastStatus: 'Passed' },
            { id: 'TC-2', title: 'Logout Test', lastStatus: 'Untested' },
          ],
        },
      ],
      executionRuns: [
        {
          id: 'RUN-1',
          name: 'RC1 Smoke',
          status: 'Completed',
          results: [{ testCaseId: 'TC-1', status: 'Passed' }],
        },
      ],
      executions: [
        { id: 'EX-1', testCaseId: 'TC-1', status: 'PASSED', executedAt: '2026-06-01T09:00:00.000Z' },
      ],
      defects: [
        { id: 'DEF-1', defectId: 'DEF-1', title: 'Session Timeout Bug', severity: 'High', status: 'Open' },
      ],
    };

    const richChecklists = [
      {
        id: 'chk-snap-1',
        userId,
        projectId: 'proj-snap-full',
        title: 'Release Checklist',
        category: 'Release Readiness',
        priority: 'Critical',
        tags: ['android', 'release'],
        updatedAt: '2026-06-01T10:00:00.000Z',
        items: [
          { id: 'ci-1', title: 'Verify APK signing', completed: true },
          { id: 'ci-2', title: 'Verify ProGuard mapping', completed: false },
        ],
        documentNotes: [{ id: 'note-1', text: 'Reviewed by QA Lead' }],
      },
    ];

    const snapResult = await createLocalRecoverySnapshot({
      userId,
      projects: [richProject],
      checklists: richChecklists,
      label: 'Full Release Checkpoint',
      reason: 'manual',
    });

    expect(snapResult.ok).toBe(true);
    expect(snapResult.snapshot.backupVersion).toBe(1);
    expect(snapResult.snapshot.schemaVersion).toBe(1);
    expect(snapResult.snapshot.projectsCount).toBe(1);
    expect(snapResult.snapshot.checklistsCount).toBe(1);
    expect(snapResult.snapshot.metadata.totalChecklists).toBe(1);
    expect(snapResult.snapshot.metadata.totalTestCases).toBe(2);
    expect(snapResult.snapshot.metadata.totalDefects).toBe(1);

    // Round-trip serialization/deserialization via storage preserves all project & checklist records
    const loadedSnapshots = await getLocalRecoverySnapshots(userId);
    expect(loadedSnapshots.length).toBe(1);
    const deserialized = loadedSnapshots[0];
    expect(deserialized.projects[0].testPlan.phases[0].id).toBe('ph-1');
    expect(deserialized.projects[0].executionRuns[0].id).toBe('RUN-1');
    expect(deserialized.projects[0].executions[0].id).toBe('EX-1');
    expect(deserialized.projects[0].defects[0].id).toBe('DEF-1');
    expect(deserialized.checklists.length).toBe(1);
    expect(deserialized.checklists[0].id).toBe('chk-snap-1');
    expect(deserialized.checklists[0].projectId).toBe('proj-snap-full');
    expect(deserialized.checklists[0].tags).toEqual(['android', 'release']);
    expect(deserialized.checklists[0].items.length).toBe(2);
    expect(deserialized.checklists[0].items[0].completed).toBe(true);
    expect(deserialized.checklists[0].documentNotes.some((n) => n.id === 'note-1')).toBe(true);

    // Existing extra checklist on device/backend must NOT be deleted upon snapshot restore
    await cacheChecklistsForUser(
      [
        {
          id: 'chk-existing-keep',
          userId,
          title: 'Existing Checklist Created Later',
          updatedAt: '2026-06-02T10:00:00.000Z',
          items: [{ id: 'k-1', title: 'Keep me alive', completed: false }],
        },
      ],
      userId
    );

    const restoreOfflineRes = await restoreLocalRecoverySnapshot(
      deserialized.snapshotId,
      userId,
      { mode: 'replace', offlineOnly: true }
    );
    expect(restoreOfflineRes.ok).toBe(true);
    expect(restoreOfflineRes.source).toBe('offline_cache');
    expect(restoreOfflineRes.restoredChecklists.map((c) => c.id)).toEqual(['chk-snap-1']);

    const localChecklistsAfter = await getCachedChecklistsForUser(userId);
    expect(localChecklistsAfter.map((c) => c.id)).toContain('chk-snap-1');
    expect(localChecklistsAfter.map((c) => c.id)).toContain('chk-existing-keep');

    const queuedOps = await getPendingProjectOperations(userId);
    expect(queuedOps.some((op) => op.entityType === 'checklist' && op.operationType === 'DELETE')).toBe(false);

    // Older legacy snapshot without `checklists` / `checklistsCount` fields restores cleanly
    const legacySnapshot = {
      snapshotId: 'lsnap_legacy_v0',
      userId,
      label: 'Legacy Snapshot Without Checklists',
      reason: 'manual',
      createdAt: '2026-01-01T00:00:00.000Z',
      projectsCount: 1,
      metadata: { totalProjects: 1, totalTestCases: 1, totalDefects: 0 },
      projects: [
        {
          id: 'proj-legacy-1',
          userId,
          name: 'Legacy Project',
          testSuites: [{ id: 's-leg', name: 'Legacy Suite', cases: [{ id: 'TC-L1', title: 'Legacy Case' }] }],
        },
      ],
    };
    await memoryAsyncStorage.setItem(
      getLocalSnapshotsStorageKey(userId),
      JSON.stringify([legacySnapshot, deserialized])
    );

    const legacyRestoreRes = await restoreLocalRecoverySnapshot(
      'lsnap_legacy_v0',
      userId,
      { mode: 'merge', offlineOnly: true }
    );
    expect(legacyRestoreRes.ok).toBe(true);
    expect(legacyRestoreRes.restoredProjects[0].id).toBe('proj-legacy-1');
    expect(legacyRestoreRes.restoredChecklists).toEqual([]);
    const checklistsAfterLegacy = await getCachedChecklistsForUser(userId);
    expect(checklistsAfterLegacy.map((c) => c.id)).toContain('chk-snap-1');
    expect(checklistsAfterLegacy.map((c) => c.id)).toContain('chk-existing-keep');
  });

  it('queues idempotent sync operations on offline snapshot restore, deduplicates retries, retains failed ops, syncs when back online, and enforces user isolation', async () => {
    const userA = 'user-snap-sync-a';
    const userB = 'user-snap-sync-b';

    const baselineProject = {
      id: 'proj-sync-1',
      userId: userA,
      name: 'Synced Project V1',
      updatedAt: '2026-06-01T10:00:00.000Z',
      testSuites: [
        {
          id: 'suite-sync-1',
          name: 'Core',
          cases: [{ id: 'TC-S1', title: 'Restored Case', lastStatus: 'Passed' }],
        },
      ],
      executionRuns: [],
      executions: [],
      defects: [],
    };
    const baselineChecklist = {
      id: 'chk-sync-1',
      userId: userA,
      projectId: 'proj-sync-1',
      title: 'Restored Checklist V1',
      updatedAt: '2026-06-01T10:00:00.000Z',
      items: [{ id: 'item-1', title: 'Check build', completed: true }],
    };
    const offlineNewChecklist = {
      id: 'chk-sync-new',
      userId: userA,
      title: 'Offline Created Checklist',
      _pendingCreation: true,
      items: [{ id: 'item-n1', title: 'Offline Task', completed: false }],
    };

    // Seed existing synced baselines in User A cache
    await cacheProjectOffline(baselineProject, userA, {
      pendingSync: false,
      pendingCreation: false,
    });
    await cacheChecklistOffline(baselineChecklist, userA, {
      pendingSync: false,
      pendingCreation: false,
      serverUpdatedAt: '2026-06-01T10:00:00.000Z',
    });

    const createdSnap = await createLocalRecoverySnapshot({
      userId: userA,
      projects: [baselineProject],
      checklists: [baselineChecklist, offlineNewChecklist],
      label: 'Sync Test Snapshot',
    });
    expect(createdSnap.ok).toBe(true);
    const snapId = createdSnap.snapshot.snapshotId;

    // Simulate offline restore and retry repeatedly -> must coalesce without duplicate queue ops
    setSimulatedOfflineMode(true, { skipAutoReconnect: true });
    const restoreAttempt1 = await restoreLocalRecoverySnapshot(snapId, userA, {
      mode: 'replace',
    });
    expect(restoreAttempt1.ok).toBe(true);
    expect(restoreAttempt1.source).toBe('offline_cache');
    expect(restoreAttempt1.queuedOperationsCount).toBeGreaterThan(0);

    const opsAfterFirstRestore = await getPendingProjectOperations(userA);
    const keysAfterFirst = opsAfterFirstRestore.map((op) => op.idempotencyKey).sort();
    expect(keysAfterFirst).toEqual([
      `chk_${userA}_chk-sync-1_checklist_UPDATE`,
      `chk_${userA}_chk-sync-new_checklist_CREATE`,
      `proj_${userA}_proj-sync-1_data_workspace_data_UPDATE`,
      `proj_${userA}_proj-sync-1_project_root_UPDATE`,
    ]);

    // Retry restoration twice more -> operation count and idempotency keys remain identical
    await restoreLocalRecoverySnapshot(snapId, userA, { mode: 'replace' });
    await restoreLocalRecoverySnapshot(snapId, userA, { mode: 'replace' });
    const opsAfterRepeatedRestore = await getPendingProjectOperations(userA);
    expect(opsAfterRepeatedRestore.length).toBe(opsAfterFirstRestore.length);
    expect(opsAfterRepeatedRestore.map((op) => op.idempotencyKey).sort()).toEqual(keysAfterFirst);

    // User B isolation check: User B sees zero snapshots, zero cached checklists, zero pending ops from User A
    expect(await getLocalRecoverySnapshots(userB)).toEqual([]);
    expect(await getCachedChecklistsForUser(userB)).toEqual([]);
    expect(await getPendingProjectOperations(userB)).toEqual([]);
    const crossUserRestore = await restoreLocalRecoverySnapshot(snapId, userB, {
      offlineOnly: true,
    });
    expect(crossUserRestore.ok).toBe(false);

    // Reconnect with temporary 500 failure -> pending ops MUST be retained with retry metadata
    await storeCookiesFromResponse(
      new Response('{}', {
        status: 200,
        headers: { 'set-cookie': 'qavora_auth_token=tok_snap_a; Path=/; HttpOnly' },
      }),
      'https://qavora.example.test/api/auth/login'
    );
    setActiveSyncUser(userA);
    setSimulatedOfflineMode(false, { skipAutoReconnect: true });

    let shouldFailBackend = true;
    const syncedRequests = [];
    globalThis.fetch = async (url, init = {}) => {
      const target = String(url);
      if (target.endsWith('/api/auth/csrf')) {
        return new Response(JSON.stringify({ csrfToken: 'csrf_snap_sync' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (shouldFailBackend) {
        return new Response(JSON.stringify({ error: 'Temporary outage' }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        });
      }
      syncedRequests.push({ method: init.method || 'GET', target, body: JSON.parse(init.body || '{}') });
      if (target.endsWith('/api/projects/proj-sync-1') && init.method === 'PATCH') {
        return new Response(
          JSON.stringify({ ...baselineProject, updatedAt: '2026-06-02T01:00:00.000Z' }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (target.endsWith('/api/projects/proj-sync-1/data') && init.method === 'PATCH') {
        return new Response(
          JSON.stringify({ project: { ...baselineProject, updatedAt: '2026-06-02T01:00:01.000Z' } }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (target.endsWith('/api/checklists/chk-sync-1') && init.method === 'PATCH') {
        return new Response(
          JSON.stringify({ checklist: { ...baselineChecklist, updatedAt: '2026-06-02T01:00:02.000Z' } }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (target.endsWith('/api/checklists') && init.method === 'POST') {
        return new Response(
          JSON.stringify({ checklist: { ...offlineNewChecklist, id: 'chk-sync-new', updatedAt: '2026-06-02T01:00:03.000Z' } }),
          { status: 201, headers: { 'content-type': 'application/json' } }
        );
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    };

    const failedSync = await processProjectSyncQueue(userA);
    // project UPDATE + 2 checklists fail (3), while dependent data UPDATE stays halted in queue (4 total retained)
    expect(failedSync.failed).toBe(3);
    expect(failedSync.synced).toBe(0);
    const retainedOps = await getPendingProjectOperations(userA);
    expect(retainedOps.length).toBe(4);
    expect(retainedOps.filter((op) => op.retryCount === 1).length).toBe(3);

    // Recover network and retry -> all 4 operations (2 project + 2 checklist) sync and dequeue cleanly
    shouldFailBackend = false;
    const recoveredSync = await processProjectSyncQueue(userA, { ignoreBackoff: true });
    expect(recoveredSync.synced).toBe(4);
    expect(recoveredSync.failed).toBe(0);
    expect(await getPendingProjectOperations(userA)).toEqual([]);
    expect(syncedRequests.some((r) => r.method === 'POST' && r.target.endsWith('/api/checklists'))).toBe(true);
    expect(syncedRequests.some((r) => r.method === 'PATCH' && r.target.endsWith('/api/checklists/chk-sync-1'))).toBe(true);
    expect(syncedRequests.some((r) => r.method === 'PATCH' && r.target.endsWith('/api/projects/proj-sync-1/data'))).toBe(true);
    expect(syncedRequests.some((r) => r.method === 'DELETE')).toBe(false);
  });
});

// =============================================================================
// 5. CRIT-05 — CSV Formula-Injection Protection
// =============================================================================
describe('CRIT-05 — CSV Formula-Injection Protection', () => {
  it('prefixes formula trigger characters (=, +, -, @, tab, CR) with single quote across all CSV exports', async () => {
    const hostileProject = {
      id: 'proj-csv',
      name: '=HYPERLINK("http://evil.example","Click")',
      environment: '+cmd|"/C calc"!A0',
      testSuites: [
        {
          id: 'suite-1',
          name: '@SUM(1+1)*cmd',
          cases: [
            {
              id: 'TC-1',
              title: '-2+3+cmd|" /C calc"!A0',
              priority: 'P0',
              category: 'Security',
              preconditions: '\t=1+1',
              expectedResult: '=IMPORTXML("http://evil.test","//a")',
              steps: [{ action: '=1+1', expectedResult: '+2+2' }],
              lastStatus: 'Passed',
            },
          ],
        },
      ],
      executions: [
        {
          id: 'EX-1',
          testCaseId: 'TC-1',
          caseTitle: '=cmd|" /C calc"!A0',
          suiteName: '@suite',
          status: 'PASSED',
          tester: '+attacker',
          notes: '-malicious\nwith "quotes"',
          executedAt: '2026-05-10T10:00:00.000Z',
        },
      ],
      defects: [
        {
          id: 'DEF-1',
          title: '@SUM(A1:A2)',
          severity: 'Critical',
          priority: 'P0',
          status: 'Open',
          stepsToReproduce: '=2+5',
          expectedResult: '+ok',
          actualResult: '-fail',
          createdAt: '2026-05-10T10:00:00.000Z',
        },
      ],
    };

    const tcExport = await exportTestCasesCSV(hostileProject, {
      skipPlatformShare: true,
    });
    expect(tcExport.ok).toBe(true);
    expect(tcExport.content).toContain(`"'=HYPERLINK(""http://evil.example"",""Click"")"`);
    expect(tcExport.content).toContain(`"'@SUM(1+1)*cmd"`);
    expect(tcExport.content).toContain(`"'-2+3+cmd|"" /C calc""!A0"`);
    expect(tcExport.content).toContain(`"'\t=1+1"`);
    expect(tcExport.content).toContain(`"'=IMPORTXML(""http://evil.test"",""//a"")"`);

    const exExport = await exportExecutionsCSV(hostileProject, {
      skipPlatformShare: true,
    });
    expect(exExport.ok).toBe(true);
    expect(exExport.content).toContain(`"'=cmd|"" /C calc""!A0"`);
    expect(exExport.content).toContain(`"'+attacker"`);
    expect(exExport.content).toContain(`"'-malicious with ""quotes"""`);

    const defExport = await exportDefectsCSV(hostileProject, {
      skipPlatformShare: true,
    });
    expect(defExport.ok).toBe(true);
    expect(defExport.content).toContain(`"'@SUM(A1:A2)"`);
    expect(defExport.content).toContain(`"'=2+5"`);
    expect(defExport.content).toContain(`"'+ok"`);
    expect(defExport.content).toContain(`"'-fail"`);
  });
});

// =============================================================================
// 6. CRIT-03 — Offline Conflict Resolution, Deletion Tombstones & Dirty State
// =============================================================================
describe('CRIT-03 — Offline Conflict Resolution, Deletion Tombstones & Dirty State', () => {
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
    setSimulatedOfflineMode(false, { skipAutoReconnect: true });
    setActiveSyncUser(null);
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

  it('prevents deleted suites, cases, runs, executions, and defects from resurrecting during HTTP 409 merge while keeping remote additions and clearing tombstones only after safe sync', async () => {
    const userId = 'user-crit03-svc';
    setActiveSyncUser(userId);

    const remoteServerProject = {
      id: 'proj-c3-merge',
      userId,
      name: 'Conflict Safe Project',
      updatedAt: '2026-06-02T12:00:00.000Z',
      testSuites: [
        {
          id: 'suite-deleted',
          name: 'Suite To Delete',
          cases: [{ id: 'TC-IN-DEL-SUITE', title: 'Deleted Suite Case', lastStatus: 'Untested' }],
        },
        {
          id: 'suite-keep',
          name: 'Kept Suite',
          cases: [
            { id: 'TC-KEEP', title: 'Kept Case Local', lastStatus: 'Passed' },
            { id: 'TC-DELETED', title: 'Deleted Case', lastStatus: 'Untested' },
            { id: 'TC-REMOTE-ADD', title: 'Remote Added Case', lastStatus: 'Untested' },
          ],
        },
        {
          id: 'suite-remote-add',
          name: 'Remote Added Suite',
          cases: [{ id: 'TC-REM-2', title: 'Remote Suite Case', lastStatus: 'Failed' }],
        },
      ],
      executionRuns: [
        {
          id: 'RUN-DELETED',
          name: 'Deleted Run',
          status: 'Active',
          results: [{ testCaseId: 'TC-KEEP', status: 'Passed' }],
        },
        {
          id: 'RUN-REMOTE-ADD',
          name: 'Remote Run',
          status: 'Active',
          results: [
            { testCaseId: 'TC-KEEP', status: 'Passed', linkedDefectId: 'DEF-DELETED' },
            { testCaseId: 'TC-DELETED', status: 'Failed' },
          ],
        },
      ],
      executions: [
        {
          id: 'EX-DELETED',
          testCaseId: 'TC-KEEP',
          status: 'PASSED',
        },
        {
          id: 'EX-REMOTE-ADD',
          testCaseId: 'TC-REM-2',
          status: 'FAILED',
          linkedDefectId: 'DEF-DELETED',
        },
      ],
      defects: [
        { id: 'DEF-DELETED', defectId: 'DEF-DELETED', title: 'Deleted Defect', status: 'Open', severity: 'High' },
        { id: 'DEF-REMOTE-ADD', defectId: 'DEF-REMOTE-ADD', title: 'Remote Added Defect', status: 'Open', severity: 'Critical' },
      ],
    };

    const cachedBase = {
      id: 'proj-c3-merge',
      userId,
      name: 'Conflict Safe Project',
      updatedAt: '2026-06-01T10:00:00.000Z',
      testSuites: [
        {
          id: 'suite-keep',
          name: 'Kept Suite',
          cases: [
            { id: 'TC-KEEP', title: 'Edited Case Title', lastStatus: 'Passed' },
            { id: 'TC-LOCAL-ADD', title: 'Locally Added Case', lastStatus: 'Untested' },
          ],
        },
      ],
      executionRuns: [],
      executions: [],
      defects: [],
    };
    await cacheProjectOffline(cachedBase, userId, { pendingSync: true });

    const queuedOp = await queueProjectMutation({
      userId,
      projectId: 'proj-c3-merge',
      entityType: 'data',
      operationType: 'UPDATE',
      expectedUpdatedAt: '2026-06-01T10:00:00.000Z',
      payload: {
        testSuites: cachedBase.testSuites,
        executionRuns: [],
        activeRun: null,
        executions: [],
        defects: [],
        testCaseCount: 2,
      },
      deletionTombstones: {
        suites: ['suite-deleted'],
        testCases: ['TC-DELETED', 'TC-IN-DEL-SUITE'],
        testRuns: ['RUN-DELETED'],
        executions: ['EX-DELETED'],
        defects: ['DEF-DELETED'],
      },
      description: 'Offline deletes + local addition',
    });

    expect(queuedOp).not.toBeNull();
    expect(queuedOp.deletionTombstones.suites).toEqual(['suite-deleted']);
    expect(queuedOp.deletionTombstones.defects).toEqual(['DEF-DELETED']);

    const storedBeforeSync = await getProjectDeletionTombstones(userId, 'proj-c3-merge');
    expect(storedBeforeSync.testRuns).toEqual(['RUN-DELETED']);
    expect(storedBeforeSync.executions).toEqual(['EX-DELETED']);

    await storeCookiesFromResponse(
      new Response('{}', {
        status: 200,
        headers: { 'set-cookie': 'qavora_auth_token=tok_c3; Path=/; HttpOnly' },
      }),
      'https://qavora.example.test/api/auth/login'
    );

    let patchAttempt = 0;
    let capturedMergedPatch = null;
    globalThis.fetch = async (url, init = {}) => {
      const target = String(url);
      if (target.endsWith('/api/auth/csrf')) {
        return new Response(JSON.stringify({ csrfToken: 'csrf_c3' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (
        target.includes('/api/projects/proj-c3-merge/data') &&
        init.method === 'PATCH'
      ) {
        patchAttempt += 1;
        const parsed = JSON.parse(init.body || '{}');
        // Never leak internal tombstone property to backend
        expect(parsed.deletionTombstones).toBeUndefined();
        if (patchAttempt === 1) {
          return new Response(
            JSON.stringify({
              error: 'Version conflict',
              currentUpdatedAt: remoteServerProject.updatedAt,
            }),
            { status: 409, headers: { 'content-type': 'application/json' } }
          );
        }
        if (patchAttempt === 2) {
          // Transient 500 during merge retry -> tombstones must survive
          return new Response(
            JSON.stringify({ error: 'Temporary outage during merge save' }),
            { status: 500, headers: { 'content-type': 'application/json' } }
          );
        }
        capturedMergedPatch = parsed;
        return new Response(
          JSON.stringify({
            project: {
              ...remoteServerProject,
              ...parsed,
              updatedAt: '2026-06-03T00:00:00.000Z',
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (target.includes('/api/projects/proj-c3-merge')) {
        return new Response(JSON.stringify({ project: remoteServerProject }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('{}', { status: 200 });
    };

    // Attempt 1 hits 409 -> op becomes conflict, tombstones remain intact
    const syncRes = await processProjectSyncQueue(userId);
    expect(syncRes.conflicts).toBe(1);
    const conflictOps = await getPendingProjectOperations(userId);
    expect(conflictOps[0].status).toBe('conflict');
    expect(
      (await getProjectDeletionTombstones(userId, 'proj-c3-merge')).defects
    ).toEqual(['DEF-DELETED']);

    // Attempt 2: merge hits transient 500 -> sync fails & op stays failed, tombstones MUST STILL SURVIVE
    const failedMerge = await resolveProjectConflict(
      conflictOps[0].id,
      'merge',
      userId
    );
    expect(failedMerge.ok).toBe(true);
    expect(failedMerge.syncResult).toBeDefined();
    expect(failedMerge.syncResult.failed).toBe(1);
    expect(failedMerge.syncResult.synced).toBe(0);
    const tombstonesAfter500 = await getProjectDeletionTombstones(
      userId,
      'proj-c3-merge'
    );
    expect(tombstonesAfter500.suites).toEqual(['suite-deleted']);
    expect(tombstonesAfter500.testCases).toEqual(['TC-DELETED', 'TC-IN-DEL-SUITE']);
    expect(tombstonesAfter500.testRuns).toEqual(['RUN-DELETED']);
    expect(tombstonesAfter500.executions).toEqual(['EX-DELETED']);
    expect(tombstonesAfter500.defects).toEqual(['DEF-DELETED']);

    // Attempt 3: retry backoff-scheduled op -> succeeds, tombstoned entities remain excluded, remote & local additions survive, tombstones clear cleanly
    const opsAfter500 = await getPendingProjectOperations(userId);
    expect(opsAfter500.length).toBe(1);
    expect(opsAfter500[0].status).toBe('pending');
    expect(opsAfter500[0].retryCount).toBe(1);
    expect(opsAfter500[0].deletionTombstones.defects).toEqual(['DEF-DELETED']);
    const resolvedMerge = await retryProjectOperation(opsAfter500[0].id, userId);
    expect(resolvedMerge.ok).toBe(true);
    expect(capturedMergedPatch).not.toBeNull();

    const mergedSuiteIds = capturedMergedPatch.testSuites.map((s) => s.id);
    expect(mergedSuiteIds).not.toContain('suite-deleted');
    expect(mergedSuiteIds).toContain('suite-keep');
    expect(mergedSuiteIds).toContain('suite-remote-add');

    const keptSuite = capturedMergedPatch.testSuites.find(
      (s) => s.id === 'suite-keep'
    );
    const keptCaseIds = keptSuite.cases.map((c) => c.id);
    expect(keptCaseIds).not.toContain('TC-DELETED');
    expect(keptCaseIds).not.toContain('TC-IN-DEL-SUITE');
    expect(keptCaseIds).toContain('TC-KEEP');
    expect(keptCaseIds).toContain('TC-LOCAL-ADD');
    expect(keptCaseIds).toContain('TC-REMOTE-ADD');
    expect(
      keptSuite.cases.find((c) => c.id === 'TC-KEEP').title
    ).toBe('Edited Case Title');

    const mergedRunIds = capturedMergedPatch.executionRuns.map((r) => r.id);
    expect(mergedRunIds).toEqual(['RUN-REMOTE-ADD']);
    const remoteRun = capturedMergedPatch.executionRuns[0];
    expect(remoteRun.results.map((r) => r.testCaseId)).toEqual(['TC-KEEP']);
    expect(remoteRun.results[0].linkedDefectId).toBeNull();

    expect(capturedMergedPatch.executions.map((e) => e.id)).toEqual([
      'EX-REMOTE-ADD',
    ]);
    expect(capturedMergedPatch.executions[0].linkedDefectId).toBeNull();
    expect(capturedMergedPatch.defects.map((d) => d.id)).toEqual([
      'DEF-REMOTE-ADD',
    ]);

    // Tombstones and queue are cleared after confirmed merge persistence
    const tombstonesAfterMerge = await getProjectDeletionTombstones(
      userId,
      'proj-c3-merge'
    );
    expect(tombstonesAfterMerge.suites).toEqual([]);
    expect(tombstonesAfterMerge.testCases).toEqual([]);
    expect(tombstonesAfterMerge.testRuns).toEqual([]);
    expect(tombstonesAfterMerge.executions).toEqual([]);
    expect(tombstonesAfterMerge.defects).toEqual([]);
    expect((await getPendingProjectOperations(userId)).length).toBe(0);

    // Discard path cleanup check
    await queueProjectMutation({
      userId,
      projectId: 'proj-c3-discard',
      entityType: 'data',
      operationType: 'UPDATE',
      payload: { testSuites: [] },
      deletionTombstones: { defects: ['DEF-DISC-1'] },
    });
    const discardOps = await getPendingProjectOperations(userId);
    expect(
      (await getProjectDeletionTombstones(userId, 'proj-c3-discard')).defects
    ).toEqual(['DEF-DISC-1']);
    await discardProjectOperation(discardOps[0].id, userId);
    expect(
      (await getProjectDeletionTombstones(userId, 'proj-c3-discard')).defects
    ).toEqual([]);
  });

  it('guards dirty local WorkspaceContext state against stale metadata/background sync and isolates users on logout & account switch', async () => {
    let activeSessionUser = 'user-a';
    let serverProjectsByUser = {
      'user-a': [
        {
          id: 'proj-shared-a',
          userId: 'user-a',
          name: 'User A App',
          version: '1.0.0',
          environment: 'Staging',
          updatedAt: '2026-06-01T10:00:00.000Z',
          testSuites: [
            {
              id: 'suite-a1',
              name: 'Auth Suite',
              cases: [
                { id: 'TC-A1', title: 'Login Flow', lastStatus: 'Passed' },
                { id: 'TC-A2', title: 'Delete Target', lastStatus: 'Untested' },
              ],
            },
          ],
          executionRuns: [
            {
              id: 'RUN-A1',
              name: 'Smoke Run',
              status: 'Active',
              results: [{ testCaseId: 'TC-A1', status: 'Passed' }],
            },
          ],
          executions: [],
          defects: [
            {
              id: 'DEF-A1',
              defectId: 'DEF-A1',
              title: 'Bug A1',
              status: 'Open',
              severity: 'High',
            },
          ],
        },
      ],
      'user-b': [
        {
          id: 'proj-b-only',
          userId: 'user-b',
          name: 'User B App',
          version: '3.0.0',
          updatedAt: '2026-06-01T10:00:00.000Z',
          testSuites: [
            {
              id: 'suite-b1',
              name: 'Billing Suite',
              cases: [{ id: 'TC-B1', title: 'Invoice Check', lastStatus: 'Passed' }],
            },
          ],
          executionRuns: [],
          executions: [],
          defects: [],
        },
      ],
    };

    const userProfiles = {
      'user-a': {
        userId: 'user-a',
        email: 'usera@example.com',
        name: 'User Alpha',
        role: 'QA Lead',
      },
      'user-b': {
        userId: 'user-b',
        email: 'userb@example.com',
        name: 'User Beta',
        role: 'QA Tester',
      },
    };

    globalThis.fetch = async (url, init = {}) => {
      const target = String(url);
      if (target.endsWith('/api/auth/me')) {
        if (!activeSessionUser) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(
          JSON.stringify({ user: userProfiles[activeSessionUser] }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (target.endsWith('/api/auth/login') && init.method === 'POST') {
        const body = JSON.parse(init.body || '{}');
        activeSessionUser =
          body.email === 'userb@example.com' ? 'user-b' : 'user-a';
        return new Response(
          JSON.stringify({ user: userProfiles[activeSessionUser] }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json',
              'set-cookie': `qavora_auth_token=tok_${activeSessionUser}; Path=/; HttpOnly`,
            },
          }
        );
      }
      if (target.endsWith('/api/auth/logout') && init.method === 'POST') {
        activeSessionUser = null;
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (target.endsWith('/api/auth/csrf')) {
        return new Response(JSON.stringify({ csrfToken: 'csrf_iso' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (target.endsWith('/api/projects') && (!init.method || init.method === 'GET')) {
        const list = serverProjectsByUser[activeSessionUser] || [];
        return new Response(JSON.stringify(list), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    await storeCookiesFromResponse(
      new Response('{}', {
        status: 200,
        headers: { 'set-cookie': 'qavora_auth_token=tok_user-a; Path=/; HttpOnly' },
      }),
      'https://qavora.example.test/api/auth/login'
    );

    let authRef = null;
    let projRef = null;
    let wsRef = null;
    function IsolationHarness() {
      authRef = useAuth();
      projRef = useProjects();
      wsRef = useWorkspace();
      return React.createElement(
        'div',
        null,
        `${authRef.user?.userId || 'anon'}:${wsRef.testCases.length}`
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
              React.createElement(IsolationHarness)
            )
          )
        )
      )
    );
    await harness.flush(60);

    await React.act(async () => {
      await projRef.selectProject('proj-shared-a');
    });
    await harness.flush(50);

    expect(wsRef.testCases.map((c) => c.id)).toEqual(['TC-A1', 'TC-A2']);

    // Go offline as User A and perform deletions -> queues offline mutation + tombstones
    setSimulatedOfflineMode(true, { skipAutoReconnect: true });
    await React.act(async () => {
      await wsRef.deleteTestCase('TC-A2');
      await wsRef.deleteDefect('DEF-A1');
    });
    await harness.flush(30);

    expect(wsRef.testCases.map((c) => c.id)).toEqual(['TC-A1']);
    expect(wsRef.defects.length).toBe(0);
    const userATombstones = await getProjectDeletionTombstones(
      'user-a',
      'proj-shared-a'
    );
    expect(userATombstones.testCases).toContain('TC-A2');
    expect(userATombstones.defects).toContain('DEF-A1');

    // Simulate stale server metadata refresh while User A has dirty/queued state
    setSimulatedOfflineMode(false, { skipAutoReconnect: true });
    serverProjectsByUser['user-a'] = [
      {
        ...serverProjectsByUser['user-a'][0],
        name: 'User A App Renamed',
        version: '1.1.0',
        updatedAt: '2026-06-01T10:00:00.000Z',
        testSuites: [
          {
            id: 'suite-a1',
            name: 'Auth Suite',
            cases: [
              { id: 'TC-A1', title: 'Login Flow', lastStatus: 'Passed' },
              { id: 'TC-A2', title: 'Stale Resurrected Case', lastStatus: 'Untested' },
            ],
          },
        ],
      },
    ];
    await React.act(async () => {
      await projRef.refreshProjects({ silent: true });
    });
    await harness.flush(40);

    // Dirty local state survives server refresh: TC-A2 and DEF-A1 remain deleted!
    expect(wsRef.testCases.map((c) => c.id)).toEqual(['TC-A1']);
    expect(wsRef.defects.length).toBe(0);

    // Log out User A and sign in as User B -> strict zero cross-contamination
    await React.act(async () => {
      await authRef.logout();
    });
    await harness.flush(40);

    await React.act(async () => {
      await authRef.login('userb@example.com', 'password123');
    });
    await harness.flush(60);

    await React.act(async () => {
      await projRef.selectProject('proj-b-only');
    });
    await harness.flush(50);

    expect(authRef.user.userId).toBe('user-b');
    expect(wsRef.suites.map((s) => s.id)).toEqual(['suite-b1']);
    expect(wsRef.testCases.map((c) => c.id)).toEqual(['TC-B1']);
    expect(wsRef.testCases.map((c) => c.id)).not.toContain('TC-A1');
    expect(await getPendingProjectOperations('user-b')).toEqual([]);
    expect(
      (await getProjectDeletionTombstones('user-b', 'proj-shared-a')).testCases
    ).toEqual([]);
    expect(await getCachedProjectById('proj-shared-a', 'user-b', true)).toBeNull();

    // Switch back to User A (stay offline so queued mutation has not yet synced) ->
    // User A's dirty workspace state, pending ops & tombstones remain isolated and intact
    await React.act(async () => {
      await authRef.logout();
    });
    await harness.flush(40);
    setSimulatedOfflineMode(true, { skipAutoReconnect: true });
    await React.act(async () => {
      await authRef.login('usera@example.com', 'password123');
    });
    await harness.flush(60);

    await React.act(async () => {
      await projRef.selectProject('proj-shared-a');
    });
    await harness.flush(50);

    expect(wsRef.testCases.map((c) => c.id)).toEqual(['TC-A1']);
    expect(wsRef.defects.length).toBe(0);
    expect((await getPendingProjectOperations('user-a')).length).toBe(1);
    expect(
      (await getProjectDeletionTombstones('user-a', 'proj-shared-a')).testCases
    ).toContain('TC-A2');
  });
});

// =============================================================================
// 8. HIGH-02 — Offline Workspace Import Data Integrity & Online Import Refresh
// =============================================================================
describe('HIGH-02 — Offline Workspace Import Data Integrity', () => {
  const originalFetch = globalThis.fetch;
  const originalApiUrl = process.env.EXPO_PUBLIC_API_BASE_URL;
  let harness;

  beforeEach(async () => {
    memoryAsyncStorage._map.clear();
    secureStoreController.reset();
    resetLocalMockMemoryForTests();
    setCookieStorageAdapter(null);
    setSecureStoreImplementation(mockSecureStoreModule);
    setOfflineSyncStorageAdapter(memoryAsyncStorage);
    setProjectStorageAdapter(memoryAsyncStorage);
    setChecklistStorageAdapter(memoryAsyncStorage);
    setDataManagementStorageAdapter(memoryAsyncStorage);
    setAuthUserStorageAdapter(memoryAsyncStorage);
    setLocalMockStorageAdapter(memoryAsyncStorage);
    setActiveSyncUser(null);
    setSimulatedOfflineMode(false, { skipAutoReconnect: true });
    await clearAllCookies();
    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://qavora.example.test';
    harness = await createRenderHarness();
  });

  afterEach(async () => {
    if (harness) {
      await harness.cleanup();
    }
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

  it('1, 4 & 11. Offline import of new and existing projects in MERGE mode queues CREATE + data ops, preserves existing data, remaps checklist project links, and survives reconnection', async () => {
    const userId = 'user-h2-merge';
    setActiveSyncUser(userId);
    setSimulatedOfflineMode(true, { skipAutoReconnect: true });

    const existingProject = {
      id: 'proj-existing',
      userId,
      name: 'Existing Alpha',
      version: '1.0.0',
      updatedAt: '2026-06-01T10:00:00.000Z',
      _serverUpdatedAt: '2026-06-01T10:00:00.000Z',
      testSuites: [
        {
          id: 'suite-alpha',
          name: 'Original Alpha Suite',
          cases: [{ id: 'TC-ALPHA-1', title: 'Original case', lastStatus: 'Passed' }],
        },
      ],
      defects: [{ id: 'DEF-ALPHA-1', title: 'Original bug', severity: 'High', status: 'Open' }],
    };
    const existingChecklist = {
      id: 'chk-existing',
      userId,
      title: 'Existing Alpha Checklist',
      projectId: 'proj-existing',
      items: [{ id: 'ci-existing', title: 'Original check', completed: true }],
      updatedAt: '2026-06-01T10:00:00.000Z',
      _serverUpdatedAt: '2026-06-01T10:00:00.000Z',
    };

    await cacheProjectOffline(existingProject, userId, {
      pendingSync: false,
      pendingCreation: false,
    });
    await cacheChecklistsForUser([existingChecklist], userId, {
      preservePending: false,
    });

    const serverProjects = [JSON.parse(JSON.stringify(existingProject))];
    const serverChecklists = [JSON.parse(JSON.stringify(existingChecklist))];
    const incomingBackup = {
      backupVersion: 1,
      schemaVersion: 1,
      application: 'Qavora',
      projects: [
        {
          id: 'proj-existing',
          name: 'Existing Alpha',
          version: '2.0.0',
          testSuites: [
            {
              id: 'suite-col',
              name: 'Collided Imported Suite',
              cases: [{ id: 'TC-COL-1', title: 'Collided case', lastStatus: 'Untested' }],
            },
          ],
        },
        {
          id: 'proj-new-offline',
          name: 'New Offline Project',
          version: '1.0.0',
          testSuites: [
            {
              id: 'suite-new',
              name: 'New Suite',
              cases: [{ id: 'TC-NEW-1', title: 'New case', lastStatus: 'Passed' }],
            },
          ],
        },
      ],
      checklists: [
        {
          id: 'chk-existing',
          title: 'Collided Release Checklist',
          projectId: 'proj-existing',
          priority: 'Critical',
          items: [
            {
              id: 'ci-new-1',
              title: 'Verify collided checklist copy',
              completed: false,
              priority: 'High',
              notes: 'Must stay separate from existing checklist',
            },
          ],
        },
        {
          id: 'chk-new-offline',
          title: 'Brand New Offline Checklist',
          projectId: 'proj-new-offline',
          items: [{ id: 'ci-brand-1', title: 'Verify new project launch', completed: true }],
        },
      ],
    };

    const validated = parseAndValidateImportPayload(JSON.stringify(incomingBackup), {
      existingProjects: [existingProject],
      existingChecklists: [existingChecklist],
    });
    expect(validated.ok).toBe(true);
    expect(validated.duplicateProjectIds).toEqual(['proj-existing']);
    expect(validated.duplicateChecklistIds).toEqual(['chk-existing']);

    const offlineRes = await importWorkspaceOffline({
      userId,
      mode: 'merge',
      projects: validated.projects,
      checklists: validated.checklists,
      existingProjects: [existingProject],
      existingChecklists: [existingChecklist],
    });
    expect(offlineRes.ok).toBe(true);
    expect(offlineRes.importedProjectsCount).toBe(2);
    expect(offlineRes.importedChecklistsCount).toBe(2);

    // Existing project and checklist remain completely un-overwritten in MERGE mode
    const cachedAfter = await getCachedProjectsForUser(userId, true);
    const originalCachedProj = cachedAfter.find((p) => p.id === 'proj-existing');
    const copiedProj = cachedAfter.find((p) => p.id !== 'proj-existing' && p.id !== 'proj-new-offline');
    const newProj = cachedAfter.find((p) => p.id === 'proj-new-offline');

    expect(originalCachedProj.name).toBe('Existing Alpha');
    expect(originalCachedProj.testSuites[0].cases[0].id).toBe('TC-ALPHA-1');
    expect(originalCachedProj.defects[0].id).toBe('DEF-ALPHA-1');
    expect(copiedProj).toBeTruthy();
    expect(copiedProj.name).toBe('Existing Alpha (Imported)');
    expect(copiedProj._pendingCreation).toBe(true);
    expect(copiedProj._pendingSync).toBe(true);
    expect(newProj._pendingCreation).toBe(true);
    expect(newProj._pendingSync).toBe(true);

    const cachedChksAfter = await getCachedChecklistsForUser(userId);
    const originalCachedChk = cachedChksAfter.find((c) => c.id === 'chk-existing');
    const copiedChk = cachedChksAfter.find((c) => c.id !== 'chk-existing' && c.id !== 'chk-new-offline');
    const newChk = cachedChksAfter.find((c) => c.id === 'chk-new-offline');

    expect(originalCachedChk.title).toBe('Existing Alpha Checklist');
    expect(originalCachedChk.items[0].id).toBe('ci-existing');
    expect(copiedChk.title).toBe('Collided Release Checklist (Imported)');
    expect(copiedChk.projectId).toBe(copiedProj.id);
    expect(copiedChk.promotedProjectId).toBe(copiedProj.id);
    expect(copiedChk.projectName).toBe('Existing Alpha (Imported)');
    expect(newChk.projectId).toBe('proj-new-offline');
    expect(newChk._pendingCreation).toBe(true);

    const ops = await getPendingProjectOperations(userId);
    expect(ops.filter((o) => o.entityType === 'project' && o.operationType === 'CREATE').length).toBe(2);
    expect(ops.filter((o) => o.entityType === 'data' && o.operationType === 'UPDATE').length).toBe(2);
    expect(ops.filter((o) => o.entityType === 'checklist' && o.operationType === 'CREATE').length).toBe(2);

    // Even if server reconciliation runs BEFORE the queue drains, pending imported items survive
    const preSyncReconciled = await cacheProjectsListOffline(serverProjects, userId);
    expect(preSyncReconciled.some((p) => p.id === copiedProj.id)).toBe(true);
    expect(preSyncReconciled.some((p) => p.id === 'proj-new-offline')).toBe(true);

    // Reconnect and process queue against server
    await storeCookiesFromResponse(
      new Response('{}', {
        status: 200,
        headers: { 'set-cookie': 'qavora_auth_token=tok_h2m; Path=/; HttpOnly' },
      }),
      'https://qavora.example.test/api/auth/login'
    );
    globalThis.fetch = async (url, init = {}) => {
      const target = String(url);
      const method = String(init.method || 'GET').toUpperCase();
      const body = init.body ? JSON.parse(init.body) : {};
      if (target.endsWith('/api/auth/csrf')) {
        return new Response(JSON.stringify({ csrfToken: 'csrf_h2m' }), { status: 200 });
      }
      if (target.endsWith('/api/projects') && method === 'POST') {
        if (serverProjects.some((p) => p.id === body.id)) {
          return new Response(JSON.stringify({ error: 'Duplicate ID', code: 'CONFLICT' }), { status: 409 });
        }
        const created = { ...body, userId, updatedAt: '2026-06-05T10:00:00.000Z' };
        serverProjects.push(created);
        return new Response(JSON.stringify(created), { status: 201 });
      }
      const dataMatch = target.match(/\/api\/projects\/([^/]+)\/data$/);
      if (dataMatch && method === 'PATCH') {
        const pid = decodeURIComponent(dataMatch[1]);
        const idx = serverProjects.findIndex((p) => p.id === pid);
        serverProjects[idx] = {
          ...serverProjects[idx],
          ...body,
          updatedAt: '2026-06-05T10:01:00.000Z',
        };
        return new Response(JSON.stringify(serverProjects[idx]), { status: 200 });
      }
      if (target.endsWith('/api/projects') && method === 'GET') {
        return new Response(JSON.stringify(serverProjects), { status: 200 });
      }
      if (target.endsWith('/api/checklists') && method === 'POST') {
        if (serverChecklists.some((c) => c.id === body.id)) {
          return new Response(JSON.stringify({ error: 'Duplicate ID', code: 'CONFLICT' }), { status: 409 });
        }
        const created = { ...body, userId, updatedAt: '2026-06-05T10:02:00.000Z' };
        serverChecklists.push(created);
        return new Response(JSON.stringify({ checklist: created }), { status: 201 });
      }
      if (target.endsWith('/api/checklists') && method === 'GET') {
        return new Response(JSON.stringify({ checklists: serverChecklists }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    };

    setSimulatedOfflineMode(false, { skipAutoReconnect: true });
    const syncRes = await processProjectSyncQueue(userId, { ignoreBackoff: true });
    expect(syncRes.failed).toBe(0);
    expect(syncRes.conflicts).toBe(0);
    expect(syncRes.synced).toBe(6);
    expect((await getPendingProjectOperations(userId)).length).toBe(0);
    expect(serverProjects.length).toBe(3);
    expect(serverChecklists.length).toBe(3);

    const refreshedChecklists = await fetchChecklists({ userId });
    expect(refreshedChecklists.ok).toBe(true);
    expect(refreshedChecklists.checklists.map((c) => c.id).sort()).toEqual(
      ['chk-existing', copiedChk.id, 'chk-new-offline'].sort()
    );
  });

  it('2, 3, 5 & 6. Offline REPLACE import deletes old server records, cancels unsynced local creates, strips stale DELETE ops on re-import, preserves rich checklist metadata, and rejects malformed checklists', async () => {
    const userId = 'user-h2-replace';
    setActiveSyncUser(userId);
    setSimulatedOfflineMode(true, { skipAutoReconnect: true });

    // Seed: 1 server-backed project & checklist to be replaced (deleted), 1 unsynced offline project & checklist to be cancelled,
    // 1 server-backed project & checklist updated in-place by ID, plus 1 stale queued DELETE for a re-imported checklist ID.
    const oldServerProj = {
      id: 'proj-old-srv',
      userId,
      name: 'Old Server Proj',
      updatedAt: '2026-06-01T08:00:00.000Z',
      _serverUpdatedAt: '2026-06-01T08:00:00.000Z',
    };
    const oldOfflineProj = {
      id: 'proj-old-local',
      userId,
      name: 'Old Local Unsynced Proj',
      _pendingCreation: true,
      _pendingSync: true,
    };
    const sharedProj = {
      id: 'proj-shared',
      userId,
      name: 'Shared Before Replace',
      updatedAt: '2026-06-01T09:00:00.000Z',
      _serverUpdatedAt: '2026-06-01T09:00:00.000Z',
      testSuites: [
        {
          id: 'suite-stale',
          name: 'Stale Suite',
          cases: [{ id: 'TC-STALE', title: 'Should tombstone' }],
        },
      ],
    };

    await cacheProjectOffline(oldServerProj, userId, { pendingSync: false, pendingCreation: false });
    await queueProjectMutation({
      userId,
      projectId: 'proj-old-local',
      entityType: 'project',
      operationType: 'CREATE',
      payload: oldOfflineProj,
    });
    await cacheProjectOffline(sharedProj, userId, { pendingSync: false, pendingCreation: false });
    await memoryAsyncStorage.setItem(
      `@qavora_qa_workspace_v2:project:${userId}:proj-shared`,
      JSON.stringify({ isDirty: true, testCases: [{ id: 'TC-DIRTY' }] })
    );

    const oldServerChk = {
      id: 'chk-old-srv',
      userId,
      title: 'Old Server Checklist',
      items: [{ id: 'i-old', title: 'Old item' }],
      updatedAt: '2026-06-01T08:00:00.000Z',
      _serverUpdatedAt: '2026-06-01T08:00:00.000Z',
    };
    await cacheChecklistOffline(oldServerChk, userId, {
      pendingSync: false,
      pendingCreation: false,
      serverUpdatedAt: '2026-06-01T08:00:00.000Z',
    });
    await queueChecklistMutation({
      userId,
      checklistId: 'chk-old-local',
      operationType: 'CREATE',
      payload: { id: 'chk-old-local', title: 'Old Local Unsynced Checklist', items: [{ id: 'il-1', title: 'Temp' }] },
    });
    // Previously deleted checklist offline that gets re-imported by same ID during REPLACE
    await queueChecklistMutation({
      userId,
      checklistId: 'chk-reimported',
      operationType: 'DELETE',
      payload: {},
    });

    // Reject malformed / unsupported checklist payloads explicitly instead of silent discard
    const badChecklistValidation = parseAndValidateImportPayload(
      JSON.stringify({
        application: 'Qavora',
        backupVersion: 1,
        schemaVersion: 1,
        projects: [],
        checklists: [
          {
            id: 'chk-bad',
            title: 'Broken Checklist',
            items: [{ priority: 'High', notes: 'missing title/text/label' }],
          },
        ],
      })
    );
    expect(badChecklistValidation.ok).toBe(false);
    expect(badChecklistValidation.error).toContain('malformed item');

    const richReplacePayload = {
      projects: [
        {
          id: 'proj-shared',
          name: 'Shared After Replace',
          testSuites: [
            {
              id: 'suite-fresh',
              name: 'Fresh Replaced Suite',
              cases: [{ id: 'TC-FRESH-1', title: 'Fresh case', lastStatus: 'Passed' }],
            },
          ],
        },
        {
          id: 'proj-brand-new',
          name: 'Brand New Replace Target',
          testSuites: [],
        },
      ],
      checklists: [
        {
          id: 'chk-reimported',
          title: 'Rich Metadata Reimported Checklist',
          description: 'Full phase & item metadata test',
          category: 'Security & Auth',
          priority: 'Critical',
          status: 'In Progress',
          projectId: 'proj-shared',
          environment: 'Production',
          targetRelease: 'v4.2.0',
          tags: ['offline-import', 'high-02'],
          phases: [
            {
              id: 'ph-sec',
              title: 'Security Checks',
              items: [
                {
                  id: 'itm-sec-1',
                  title: 'Verify CSRF enforcement',
                  completed: true,
                  priority: 'Critical',
                  notes: 'Confirmed header X-CSRF-Token sent',
                  description: 'Check every mutating request',
                  preconditions: 'Logged in',
                  expectedResult: '403 without token',
                  assignee: 'QA Lead',
                },
                {
                  id: 'itm-sec-2',
                  title: 'Verify audit logs',
                  completed: false,
                  priority: 'Low',
                  notes: 'Pending check',
                },
              ],
            },
          ],
        },
      ],
    };

    const replaceRes = await importWorkspaceOffline({
      userId,
      mode: 'replace',
      projects: richReplacePayload.projects,
      checklists: richReplacePayload.checklists,
    });
    expect(replaceRes.ok).toBe(true);
    expect(replaceRes.deletedProjectsCount).toBe(2);
    expect(replaceRes.deletedChecklistsCount).toBe(2);

    // Stale workspace AsyncStorage key for replaced project cleared
    expect(
      await memoryAsyncStorage.getItem(`@qavora_qa_workspace_v2:project:${userId}:proj-shared`)
    ).toBeNull();

    const opsAfterReplace = await getPendingProjectOperations(userId);
    // Unsynced local creates were cancelled cleanly (NO server DELETE for proj-old-local or chk-old-local)
    expect(
      opsAfterReplace.some((o) => o.projectId === 'proj-old-local' && o.operationType === 'DELETE')
    ).toBe(false);
    expect(
      opsAfterReplace.some((o) => o.checklistId === 'chk-old-local' && o.operationType === 'DELETE')
    ).toBe(false);
    // Old server-backed project & checklist ARE queued for DELETE
    expect(
      opsAfterReplace.some(
        (o) => o.entityType === 'project' && o.projectId === 'proj-old-srv' && o.operationType === 'DELETE'
      )
    ).toBe(true);
    expect(
      opsAfterReplace.some(
        (o) => o.entityType === 'checklist' && o.checklistId === 'chk-old-srv' && o.operationType === 'DELETE'
      )
    ).toBe(true);
    // Re-imported checklist had its stale DELETE stripped and replaced cleanly by UPDATE (since previously server-backed via DELETE op)
    expect(
      opsAfterReplace.some(
        (o) => o.entityType === 'checklist' && o.checklistId === 'chk-reimported' && o.operationType === 'DELETE'
      )
    ).toBe(false);

    // Deletion tombstones captured for replaced server project
    const tombstones = await getProjectDeletionTombstones(userId, 'proj-shared');
    expect(tombstones.suites).toContain('suite-stale');
    expect(tombstones.testCases).toContain('TC-STALE');

    // Sync against mock backend server state where old-srv, shared, and chk-reimported exist
    const deletedProjectIds = [];
    const deletedChecklistIds = [];
    const serverProjects = [
      { ...oldServerProj },
      { ...sharedProj },
    ];
    const serverChecklists = [
      { ...oldServerChk },
      {
        id: 'chk-reimported',
        userId,
        title: 'Pre-Delete Server Version',
        items: [{ id: 'itm-stale-only', title: 'Old server item' }],
        updatedAt: '2026-05-01T00:00:00.000Z',
      },
    ];

    await storeCookiesFromResponse(
      new Response('{}', {
        status: 200,
        headers: { 'set-cookie': 'qavora_auth_token=tok_h2r; Path=/; HttpOnly' },
      }),
      'https://qavora.example.test/api/auth/login'
    );

    globalThis.fetch = async (url, init = {}) => {
      const target = String(url);
      const method = String(init.method || 'GET').toUpperCase();
      const body = init.body ? JSON.parse(init.body) : {};
      if (target.endsWith('/api/auth/csrf')) {
        return new Response(JSON.stringify({ csrfToken: 'csrf_h2r' }), { status: 200 });
      }
      if (target.endsWith('/api/projects') && method === 'POST') {
        const created = { ...body, userId, updatedAt: '2026-06-05T11:00:00.000Z' };
        serverProjects.push(created);
        return new Response(JSON.stringify(created), { status: 201 });
      }
      const projMatch = target.match(/\/api\/projects\/([^/]+?)(?:\/(data))?$/);
      if (projMatch) {
        const pid = decodeURIComponent(projMatch[1]);
        const isData = projMatch[2] === 'data';
        const idx = serverProjects.findIndex((p) => p.id === pid);
        if (method === 'DELETE' && !isData) {
          deletedProjectIds.push(pid);
          if (idx >= 0) serverProjects.splice(idx, 1);
          return new Response(JSON.stringify({ deletedId: pid }), { status: 200 });
        }
        if (method === 'PATCH') {
          serverProjects[idx] = {
            ...serverProjects[idx],
            ...body,
            updatedAt: '2026-06-05T11:01:00.000Z',
          };
          return new Response(JSON.stringify(serverProjects[idx]), { status: 200 });
        }
      }
      const chkMatch = target.match(/\/api\/checklists\/([^/]+)$/);
      if (chkMatch) {
        const cid = decodeURIComponent(chkMatch[1]);
        const idx = serverChecklists.findIndex((c) => c.id === cid);
        if (method === 'DELETE') {
          deletedChecklistIds.push(cid);
          if (idx >= 0) serverChecklists.splice(idx, 1);
          return new Response(JSON.stringify({ deletedId: cid }), { status: 200 });
        }
        if (method === 'PATCH' || method === 'PUT') {
          serverChecklists[idx] = {
            ...serverChecklists[idx],
            ...body,
            updatedAt: '2026-06-05T11:02:00.000Z',
          };
          delete serverChecklists[idx].items;
          return new Response(JSON.stringify({ checklist: serverChecklists[idx] }), { status: 200 });
        }
      }
      if (target.endsWith('/api/checklists') && method === 'GET') {
        return new Response(JSON.stringify({ checklists: serverChecklists }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    };

    setSimulatedOfflineMode(false, { skipAutoReconnect: true });
    const syncRes = await processProjectSyncQueue(userId, { ignoreBackoff: true });
    expect(syncRes.failed).toBe(0);
    expect(syncRes.conflicts).toBe(0);
    expect((await getPendingProjectOperations(userId)).length).toBe(0);
    expect(deletedProjectIds).toEqual(['proj-old-srv']);
    expect(deletedChecklistIds).toEqual(['chk-old-srv']);
    expect(serverProjects.map((p) => p.id).sort()).toEqual(['proj-brand-new', 'proj-shared']);

    // Verify full checklist metadata and items survived round-trip cleanly
    const fetchedAfter = await fetchChecklists({ userId });
    expect(fetchedAfter.ok).toBe(true);
    expect(fetchedAfter.checklists.length).toBe(1);
    const reimported = fetchedAfter.checklists[0];
    expect(reimported.id).toBe('chk-reimported');
    expect(reimported.priority).toBe('Critical');
    expect(reimported.category).toBe('Security & Auth');
    expect(reimported.environment).toBe('Production');
    expect(reimported.targetRelease).toBe('v4.2.0');
    expect(reimported.tags).toEqual(['offline-import', 'high-02']);
    expect(reimported.projectId).toBe('proj-shared');
    expect(reimported.completedItems).toBe(1);
    expect(reimported.totalItems).toBe(2);
    expect(reimported.items[0]).toMatchObject({
      id: 'itm-sec-1',
      title: 'Verify CSRF enforcement',
      completed: true,
      priority: 'Critical',
      notes: 'Confirmed header X-CSRF-Token sent',
      description: 'Check every mutating request',
      preconditions: 'Logged in',
      expectedResult: '403 without token',
      assignee: 'QA Lead',
      phaseId: 'ph-sec',
    });
    expect(reimported.items[1]).toMatchObject({
      id: 'itm-sec-2',
      completed: false,
      priority: 'Low',
      notes: 'Pending check',
    });
  });

  it('7, 8, 9 & 12. Prevents duplicates via HTTP 409 idempotent retries, handles partial sync failures without data loss, and preserves 409 mock backend behavior', async () => {
    const userId = 'user-h2-retry';
    setActiveSyncUser(userId);

    // Part A: Verify localMockBackend enforces 409 CONFLICT on duplicate explicit project/checklist IDs
    await resetLocalMockMemoryForTests();
    const regResp = await localMockFetch('https://local.qavora/api/auth/register', {
      method: 'POST',
      body: { email: 'h2retry@example.com', password: 'Password123!', name: 'H2 Retry QA' },
    });
    expect(regResp.status).toBe(201);

    const dupProj1 = await localMockFetch('https://local.qavora/api/projects', {
      method: 'POST',
      body: { id: 'mock-proj-dup', name: 'First Mock Proj' },
    });
    expect(dupProj1.status).toBe(201);
    const dupProj2 = await localMockFetch('https://local.qavora/api/projects', {
      method: 'POST',
      body: { id: 'mock-proj-dup', name: 'Duplicate Mock Proj' },
    });
    expect(dupProj2.status).toBe(409);

    const dupChk1 = await localMockFetch('https://local.qavora/api/checklists', {
      method: 'POST',
      body: { id: 'mock-chk-dup', title: 'First Mock Checklist', items: [] },
    });
    expect(dupChk1.status).toBe(201);
    const dupChk2 = await localMockFetch('https://local.qavora/api/checklists', {
      method: 'POST',
      body: { id: 'mock-chk-dup', title: 'Duplicate Mock Checklist', items: [] },
    });
    expect(dupChk2.status).toBe(409);

    // Part B: Partial sync failures + interrupted 409 duplicate recovery for imported projects & checklists
    setSimulatedOfflineMode(true, { skipAutoReconnect: true });
    const impRes = await importWorkspaceOffline({
      userId,
      mode: 'merge',
      projects: [
        { id: 'proj-p1', name: 'Project One', testSuites: [] },
        { id: 'proj-p2', name: 'Project Two (Transient Fail)', testSuites: [] },
      ],
      checklists: [
        { id: 'chk-c1', title: 'Checklist One', items: [{ id: 'i1', title: 'Item 1' }] },
        { id: 'chk-c2', title: 'Checklist Two (Transient Fail)', items: [{ id: 'i2', title: 'Item 2' }] },
      ],
    });
    expect(impRes.ok).toBe(true);

    // Suppose proj-p1 & chk-c1 already succeeded on an interrupted prior network attempt
    // (server returns 409 CONFLICT on retry CREATE), while proj-p2 & chk-c2 fail 500 on first pass.
    const serverProjects = [
      { id: 'proj-p1', userId, name: 'Project One', testSuites: [], updatedAt: '2026-06-05T12:00:00.000Z' },
    ];
    const serverChecklists = [
      {
        id: 'chk-c1',
        userId,
        title: 'Checklist One',
        phases: [{ id: 'phase_main', title: 'General QA', items: [{ id: 'i1', title: 'Item 1' }] }],
        updatedAt: '2026-06-05T12:00:00.000Z',
      },
    ];
    let passCount = 1;

    await storeCookiesFromResponse(
      new Response('{}', {
        status: 200,
        headers: { 'set-cookie': 'qavora_auth_token=tok_h2p; Path=/; HttpOnly' },
      }),
      'https://qavora.example.test/api/auth/login'
    );

    globalThis.fetch = async (url, init = {}) => {
      const target = String(url);
      const method = String(init.method || 'GET').toUpperCase();
      const body = init.body ? JSON.parse(init.body) : {};
      if (target.endsWith('/api/auth/csrf')) {
        return new Response(JSON.stringify({ csrfToken: 'csrf_h2p' }), { status: 200 });
      }
      if (target.endsWith('/api/projects') && method === 'POST') {
        if (serverProjects.some((p) => p.id === body.id)) {
          return new Response(JSON.stringify({ error: 'Already exists', code: 'CONFLICT' }), { status: 409 });
        }
        if (body.id === 'proj-p2' && passCount === 1) {
          return new Response(JSON.stringify({ error: 'Temporary 500' }), { status: 500 });
        }
        const created = { ...body, userId, updatedAt: '2026-06-05T12:05:00.000Z' };
        serverProjects.push(created);
        return new Response(JSON.stringify(created), { status: 201 });
      }
      if (target.endsWith('/api/projects/proj-p1') && method === 'GET') {
        return new Response(JSON.stringify({ project: serverProjects[0] }), { status: 200 });
      }
      if (target.match(/\/api\/projects\/[^/]+\/data$/) && method === 'PATCH') {
        const pid = target.split('/').slice(-2, -1)[0];
        const idx = serverProjects.findIndex((p) => p.id === pid);
        serverProjects[idx] = { ...serverProjects[idx], ...body, updatedAt: '2026-06-05T12:06:00.000Z' };
        return new Response(JSON.stringify(serverProjects[idx]), { status: 200 });
      }
      if (target.endsWith('/api/checklists') && method === 'POST') {
        if (serverChecklists.some((c) => c.id === body.id)) {
          return new Response(JSON.stringify({ error: 'Already exists', code: 'CONFLICT' }), { status: 409 });
        }
        if (body.id === 'chk-c2' && passCount === 1) {
          return new Response(JSON.stringify({ error: 'Temporary 500' }), { status: 500 });
        }
        const created = { ...body, userId, updatedAt: '2026-06-05T12:07:00.000Z' };
        serverChecklists.push(created);
        return new Response(JSON.stringify({ checklist: created }), { status: 201 });
      }
      if (target.endsWith('/api/checklists/chk-c1') && method === 'GET') {
        return new Response(JSON.stringify({ checklist: serverChecklists[0] }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    };

    setSimulatedOfflineMode(false, { skipAutoReconnect: true });
    const firstPass = await processProjectSyncQueue(userId, { ignoreBackoff: true });
    // proj-p1 CREATE (409->idempotent fetch) + data UPDATE + chk-c1 CREATE (409->idempotent fetch) = 3 synced; proj-p2 + chk-c2 = 2 failed
    expect(firstPass.synced).toBe(3);
    expect(firstPass.failed).toBe(2);

    const remainingAfterFirstPass = await getPendingProjectOperations(userId);
    expect(remainingAfterFirstPass.some((o) => o.projectId === 'proj-p2')).toBe(true);
    expect(remainingAfterFirstPass.some((o) => o.checklistId === 'chk-c2')).toBe(true);
    // proj-p2 and chk-c2 still safely cached offline
    const midProjCache = await getCachedProjectsForUser(userId, true);
    const midChkCache = await getCachedChecklistsForUser(userId);
    expect(midProjCache.some((p) => p.id === 'proj-p2')).toBe(true);
    expect(midChkCache.some((c) => c.id === 'chk-c2')).toBe(true);

    // Retry pass succeeds cleanly without creating duplicate p1 or c1
    passCount = 2;
    const secondPass = await processProjectSyncQueue(userId, {
      ignoreBackoff: true,
      retryFailed: true,
    });
    expect(secondPass.failed).toBe(0);
    expect(secondPass.conflicts).toBe(0);
    expect((await getPendingProjectOperations(userId)).length).toBe(0);
    // Third sync run is a pure no-op — zero duplicates
    const thirdPass = await processProjectSyncQueue(userId, { ignoreBackoff: true });
    expect(thirdPass.synced).toBe(0);
    expect(serverProjects.map((p) => p.id).sort()).toEqual(['proj-p1', 'proj-p2']);
    expect(serverChecklists.map((c) => c.id).sort()).toEqual(['chk-c1', 'chk-c2']);
  });

  it('10. Online import in DataManagementSection immediately refreshes projects AND checklists without duplicate requests', async () => {
    const userId = 'user-h2-online';
    let checklistGetCount = 0;
    let projectGetCount = 0;

    let serverProjects = [
      { id: 'proj-init', userId, name: 'Initial Project', testSuites: [], updatedAt: '2026-06-01T00:00:00.000Z' },
    ];
    let serverChecklists = [
      { id: 'chk-init', userId, title: 'Initial Checklist', items: [], updatedAt: '2026-06-01T00:00:00.000Z' },
    ];

    globalThis.fetch = async (url, init = {}) => {
      const target = String(url);
      const method = String(init.method || 'GET').toUpperCase();
      const body = init.body ? JSON.parse(init.body) : {};
      if (target.endsWith('/api/auth/me')) {
        return new Response(
          JSON.stringify({ user: { userId, email: 'online@example.com', name: 'Online QA', role: 'QA Tester' } }),
          { status: 200 }
        );
      }
      if (target.endsWith('/api/auth/csrf')) {
        return new Response(JSON.stringify({ csrfToken: 'csrf_h2o' }), { status: 200 });
      }
      if (target.endsWith('/api/projects') && method === 'GET') {
        projectGetCount += 1;
        return new Response(JSON.stringify(serverProjects), { status: 200 });
      }
      if (target.endsWith('/api/checklists') && method === 'GET') {
        checklistGetCount += 1;
        return new Response(JSON.stringify({ checklists: serverChecklists }), { status: 200 });
      }
      if (target.endsWith('/api/data/import') && method === 'POST') {
        serverProjects = [...body.projects.map((p) => ({ ...p, userId })), ...serverProjects];
        serverChecklists = [...body.checklists.map((c) => ({ ...c, userId })), ...serverChecklists];
        return new Response(
          JSON.stringify({
            mode: body.mode || 'merge',
            message: 'Imported workspace and checklists cleanly',
            imported: { projects: body.projects.length, checklists: body.checklists.length },
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    await storeCookiesFromResponse(
      new Response('{}', {
        status: 200,
        headers: { 'set-cookie': 'qavora_auth_token=tok_h2o; Path=/; HttpOnly' },
      }),
      'https://qavora.example.test/api/auth/login'
    );

    let wsCtx = null;
    let projCtx = null;
    function Observer() {
      wsCtx = useWorkspace();
      projCtx = useProjects();
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
            React.createElement(WorkspaceProvider, null, React.createElement(Observer))
          )
        )
      )
    );
    await harness.flush(60);

    expect(projCtx.projects.map((p) => p.id)).toEqual(['proj-init']);
    expect(wsCtx.checklists.map((c) => c.id)).toEqual(['chk-init']);

    const baselineChecklistGets = checklistGetCount;
    const baselineProjectGets = projectGetCount;

    const onlineImportJson = JSON.stringify({
      application: 'Qavora',
      backupVersion: 1,
      schemaVersion: 1,
      projects: [{ id: 'proj-imported-online', name: 'Imported Online Proj', testSuites: [] }],
      checklists: [
        {
          id: 'chk-imported-online',
          title: 'Imported Online Checklist',
          priority: 'High',
          items: [{ id: 'i-on-1', title: 'Verify online import refresh', completed: false }],
        },
      ],
    });

    const inputNodes = harness.findByAttr('aria-label', 'Backup JSON payload input');
    expect(inputNodes.length).toBe(1);
    const inputNode = inputNodes[0];
    inputNode.value = onlineImportJson;
    const reactPropsKey = Object.keys(inputNode).find((k) =>
      k.startsWith('__reactProps$')
    );
    await React.act(async () => {
      if (reactPropsKey && typeof inputNode[reactPropsKey]?.onChange === 'function') {
        inputNode[reactPropsKey].onChange({ target: inputNode });
      } else {
        inputNode.dispatchEvent(
          new dom.Event('change', { bubbles: true, target: inputNode })
        );
      }
    });
    await harness.flush(20);

    const previewBtns = harness.findByAttr(
      'aria-label',
      'Validate and preview JSON import'
    );
    expect(previewBtns.length).toBe(1);
    await harness.press(previewBtns[0]);
    await harness.flush(20);

    // Import preview shows both projects and checklists count cleanly
    expect(harness.container.textContent).toContain('Checklists');

    const confirmBtns = harness.findByAttr('aria-label', 'Execute Safe Merge');
    expect(confirmBtns.length).toBe(1);
    await harness.press(confirmBtns[0]);
    await harness.flush(60);

    // Both projects AND checklists updated immediately in context with exactly one GET each
    expect(projCtx.projects.map((p) => p.id)).toEqual(['proj-imported-online', 'proj-init']);
    expect(wsCtx.checklists.map((c) => c.id).sort()).toEqual(['chk-imported-online', 'chk-init']);
    expect(checklistGetCount - baselineChecklistGets).toBe(1);
    expect(projectGetCount - baselineProjectGets).toBe(1);
  });

  it('10b. Offline import via DataManagementSection UI persists projects and checklists, updates WorkspaceContext immediately, and syncs on reconnect', async () => {
    const userId = 'user-h2-ui-offline';
    const serverProjects = [
      { id: 'proj-ui-base', userId, name: 'UI Base Project', testSuites: [], updatedAt: '2026-06-01T00:00:00.000Z' },
    ];
    const serverChecklists = [
      { id: 'chk-ui-base', userId, title: 'UI Base Checklist', items: [], updatedAt: '2026-06-01T00:00:00.000Z' },
    ];

    globalThis.fetch = async (url, init = {}) => {
      const target = String(url);
      const method = String(init.method || 'GET').toUpperCase();
      const body = init.body ? JSON.parse(init.body) : {};
      if (target.endsWith('/api/auth/me')) {
        return new Response(
          JSON.stringify({ user: { userId, email: 'uioffline@example.com', name: 'Offline UI QA', role: 'QA Tester' } }),
          { status: 200 }
        );
      }
      if (target.endsWith('/api/auth/csrf')) {
        return new Response(JSON.stringify({ csrfToken: 'csrf_uioff' }), { status: 200 });
      }
      if (target.endsWith('/api/projects') && method === 'GET') {
        return new Response(JSON.stringify(serverProjects), { status: 200 });
      }
      if (target.endsWith('/api/projects') && method === 'POST') {
        const created = { ...body, userId, updatedAt: '2026-06-06T00:00:00.000Z' };
        serverProjects.push(created);
        return new Response(JSON.stringify(created), { status: 201 });
      }
      if (target.match(/\/api\/projects\/[^/]+\/data$/) && method === 'PATCH') {
        const pid = target.split('/').slice(-2, -1)[0];
        const idx = serverProjects.findIndex((p) => p.id === pid);
        if (idx >= 0) {
          serverProjects[idx] = { ...serverProjects[idx], ...body, updatedAt: '2026-06-06T00:01:00.000Z' };
        }
        return new Response(JSON.stringify(serverProjects[idx] || {}), { status: 200 });
      }
      if (target.endsWith('/api/checklists') && method === 'GET') {
        return new Response(JSON.stringify({ checklists: serverChecklists }), { status: 200 });
      }
      if (target.endsWith('/api/checklists') && method === 'POST') {
        const created = { ...body, userId, updatedAt: '2026-06-06T00:02:00.000Z' };
        serverChecklists.push(created);
        return new Response(JSON.stringify({ checklist: created }), { status: 201 });
      }
      if (target.endsWith('/api/data/import')) {
        throw new Error('Must NOT call /api/data/import while offline');
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    await storeCookiesFromResponse(
      new Response('{}', {
        status: 200,
        headers: { 'set-cookie': 'qavora_auth_token=tok_uioff; Path=/; HttpOnly' },
      }),
      'https://qavora.example.test/api/auth/login'
    );

    let wsCtx = null;
    let projCtx = null;
    function Observer() {
      wsCtx = useWorkspace();
      projCtx = useProjects();
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
            React.createElement(WorkspaceProvider, null, React.createElement(Observer))
          )
        )
      )
    );
    await harness.flush(60);

    // Go offline after initial load
    await React.act(async () => {
      setSimulatedOfflineMode(true, { skipAutoReconnect: true });
    });
    await harness.flush(30);

    const offlineBackupJson = JSON.stringify({
      application: 'Qavora',
      backupVersion: 1,
      schemaVersion: 1,
      projects: [{ id: 'proj-ui-offline-new', name: 'Offline UI Imported', testSuites: [] }],
      checklists: [
        {
          id: 'chk-ui-offline-new',
          title: 'Offline UI Checklist',
          priority: 'Critical',
          projectId: 'proj-ui-offline-new',
          items: [{ id: 'iuo-1', title: 'Offline UI check', completed: true }],
        },
      ],
    });

    const inputNodes = harness.findByAttr('aria-label', 'Backup JSON payload input');
    const inputNode = inputNodes[0];
    inputNode.value = offlineBackupJson;
    const reactPropsKey = Object.keys(inputNode).find((k) =>
      k.startsWith('__reactProps$')
    );
    await React.act(async () => {
      if (reactPropsKey && typeof inputNode[reactPropsKey]?.onChange === 'function') {
        inputNode[reactPropsKey].onChange({ target: inputNode });
      } else {
        inputNode.dispatchEvent(
          new dom.Event('change', { bubbles: true, target: inputNode })
        );
      }
    });
    await harness.flush(20);

    await harness.press(
      harness.findByAttr('aria-label', 'Validate and preview JSON import')[0]
    );
    await harness.flush(20);

    await harness.press(harness.findByAttr('aria-label', 'Execute Safe Merge')[0]);
    await harness.flush(60);

    expect(projCtx.projects.some((p) => p.id === 'proj-ui-offline-new')).toBe(true);
    expect(wsCtx.checklists.some((c) => c.id === 'chk-ui-offline-new')).toBe(true);

    // Reconnect and process queued ops -> both imported records land on server
    let syncRes;
    await React.act(async () => {
      setSimulatedOfflineMode(false, { skipAutoReconnect: true });
      syncRes = await processProjectSyncQueue(userId, { ignoreBackoff: true });
    });
    await harness.flush(30);
    expect(syncRes.failed).toBe(0);
    expect(serverProjects.some((p) => p.id === 'proj-ui-offline-new')).toBe(true);
    expect(serverChecklists.some((c) => c.id === 'chk-ui-offline-new')).toBe(true);
  });
});



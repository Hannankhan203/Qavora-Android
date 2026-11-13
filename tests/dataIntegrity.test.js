import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
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
const { promoteChecklistToProject } = await import(
  '../src/services/checklistService.js'
);
const {
  createFullBackupPayload,
  parseAndValidateImportPayload,
  exportTestCasesCSV,
  exportExecutionsCSV,
  exportDefectsCSV,
  fetchRecoverySnapshot,
  executeRollback,
  importWorkspaceData,
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


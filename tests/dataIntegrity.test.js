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
const { AuthProvider } = await import('../src/context/AuthContext.js');
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

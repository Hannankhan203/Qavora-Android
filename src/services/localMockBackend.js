/**
 * Qavora Local Workspace Demo Backend Stub
 *
 * Activated ONLY when `EXPO_PUBLIC_ALLOW_LOCAL_MOCK=true` is explicitly set
 * outside production/release builds and no `EXPO_PUBLIC_API_BASE_URL` /
 * `EXPO_PUBLIC_API_URL`, `baseUrl`, or `fetchImpl` is configured.
 *
 * Security Invariants:
 * - Never persists passwords or secrets to AsyncStorage.
 * - Scrubs any legacy plaintext credential fields on load.
 * - Never auto-provisions accounts during `POST /api/auth/login`.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  INITIAL_SUITES,
  INITIAL_TEST_CASES,
  INITIAL_TEST_RUNS,
  INITIAL_DEFECTS,
} from '../data/initialData.js';

const MOCK_STORE_STORAGE_KEY = '@qavora_local_mock_backend_v1';

let stateCache = null;
let loadPromise = null;
let writeChain = Promise.resolve();
let customMockStorageAdapter = null;
// Ephemeral, non-persistent RAM-only credential map for the active demo runtime.
// Never written to AsyncStorage and never exposed outside this module.
const ephemeralDemoPasswords = new Map();

function getMockStorage() {
  return customMockStorageAdapter || AsyncStorage;
}

export function setLocalMockStorageAdapter(adapter) {
  customMockStorageAdapter = adapter || null;
}

export function resetLocalMockMemoryForTests() {
  stateCache = null;
  loadPromise = null;
  ephemeralDemoPasswords.clear();
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function createEmptyState() {
  return {
    users: {},
    activeUserId: null,
    csrfToken: `mock_csrf_${Date.now().toString(36)}`,
    projectsByUser: {},
    checklistsByUser: {},
    snapshotsByUser: {},
  };
}

function buildInitialSampleProject(userId, nowIso) {
  const projectId = `proj_demo_${userId}`;

  const suitesWithCases = INITIAL_SUITES.map((suite) => {
    const suiteCases = INITIAL_TEST_CASES.filter(
      (tc) => tc.suiteId === suite.id
    ).map((tc) => ({
      ...cloneJson(tc),
      testCaseId: tc.id,
      category: tc.testType || 'Functional',
      status:
        tc.lastStatus === 'Passed'
          ? 'Passed'
          : tc.lastStatus === 'Failed'
          ? 'Failed'
          : tc.lastStatus === 'Blocked'
          ? 'Blocked'
          : 'Not Run',
    }));
    return {
      ...cloneJson(suite),
      category: 'Functional',
      tags: ['mobile', 'smoke'],
      createdAt: nowIso,
      updatedAt: nowIso,
      cases: suiteCases,
      testCases: cloneJson(suiteCases),
    };
  });

  const executionRuns = cloneJson(INITIAL_TEST_RUNS);
  const executions = [];
  executionRuns.forEach((run) => {
    (run.results || []).forEach((res, idx) => {
      if (res.status && res.status !== 'Untested') {
        executions.push({
          id: `exec_${run.id}_${res.testCaseId}_${idx}`,
          runId: run.id,
          runName: run.name,
          caseId: res.testCaseId,
          testCaseId: res.testCaseId,
          suiteId: '',
          suiteName: run.suiteName || 'All Suites',
          status:
            res.status === 'Passed'
              ? 'Pass'
              : res.status === 'Failed'
              ? 'Fail'
              : res.status === 'Blocked'
              ? 'Blocked'
              : 'Not Run',
          outcome:
            res.status === 'Passed'
              ? 'Pass'
              : res.status === 'Failed'
              ? 'Fail'
              : res.status === 'Blocked'
              ? 'Blocked'
              : 'Not Run',
          normalizedStatus: res.status,
          actualResult: res.actualResult || '',
          notes: res.notes || '',
          environment: run.environment || '',
          device: run.deviceInfo || '',
          buildVersion: run.buildVersion || '',
          linkedDefectId: res.linkedDefectId || null,
          executedAt: res.executedAt || nowIso,
        });
      }
    });
  });

  const defects = cloneJson(INITIAL_DEFECTS).map((d) => ({
    ...d,
    defectId: d.id,
    priority: d.severity === 'High' ? 'High' : 'Medium',
    steps: d.reproductionSteps || '',
  }));

  const totalCases = INITIAL_TEST_CASES.length;
  const passedTests = INITIAL_TEST_CASES.filter(
    (c) => c.lastStatus === 'Passed'
  ).length;
  const failedTests = INITIAL_TEST_CASES.filter(
    (c) => c.lastStatus === 'Failed'
  ).length;
  const blockedTests = INITIAL_TEST_CASES.filter(
    (c) => c.lastStatus === 'Blocked'
  ).length;
  const executedTests = passedTests + failedTests + blockedTests;
  const notRunTests = Math.max(0, totalCases - executedTests);
  const passRate =
    executedTests > 0 ? Math.round((passedTests / executedTests) * 100) : 0;

  return {
    id: projectId,
    _id: projectId,
    userId,
    name: 'Qavora Mobile App',
    type: 'Mobile Application',
    projectType: 'Mobile Application',
    version: '1.0.0',
    description:
      'Sample QA project preloaded with suites, test cases, regression runs, and linked defects.',
    status: 'Active',
    environment: 'Staging',
    baseUrl: 'https://staging.qavora.app',
    tags: ['android', 'regression', 'offline-sync'],
    testPlan: {
      id: `plan_${projectId}`,
      name: 'Qavora Mobile v1.0 Master Test Plan',
      description:
        'End-to-end functional, layout, execution runner, and offline persistence coverage.',
      objective:
        'Validate core authentication, test execution, defect triage, and offline resilience.',
      scope: 'Mobile navigation, QA workflows, offline storage, and reporting.',
      outOfScope: 'Third-party CI webhook integrations.',
      strategy: 'Smoke + full regression across Android and Web viewports.',
      environment: 'Android 15 · Pixel 8 / Web Preview',
      entryCriteria: 'Build compiles and passes lint checks.',
      exitCriteria: '100% P0 pass rate and zero open Critical defects.',
      deliverables: 'Test summary report, defect log, release sign-off checklist.',
      risks: 'Intermittent connectivity during field testing.',
      tools: 'Qavora QA Manager, Expo',
      schedule: 'Sprint 14 Release Cycle',
      approvals: 'Lead QA Engineer',
      notes: '',
      testTypes: ['Functional', 'Regression', 'Smoke', 'UI/UX'],
      phases: [
        {
          id: 'phase_1',
          name: 'Smoke & Sanity',
          status: 'Completed',
          progress: 100,
          description: 'Core build verification',
        },
        {
          id: 'phase_2',
          name: 'Functional & Regression',
          status: 'In Progress',
          progress: 65,
          description: 'Full suite execution and defect verification',
        },
      ],
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    testSuites: suitesWithCases,
    executionRuns,
    activeRun: executionRuns[0] || null,
    executions,
    defects,
    testCaseCount: totalCases,
    executedTests,
    passedTests,
    failedTests,
    blockedTests,
    skippedTests: 0,
    notRunTests,
    passRate,
    totalDefects: defects.length,
    openDefects: defects.filter((d) => d.status === 'Open').length,
    inProgressDefects: defects.filter((d) => d.status === 'In Progress').length,
    resolvedDefects: 0,
    closedDefects: 0,
    criticalDefects: 0,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

function buildInitialSampleChecklist(userId, projectId, nowIso) {
  const checklistId = `chk_demo_${userId}`;
  return {
    id: checklistId,
    _id: checklistId,
    userId,
    title: 'Release Readiness Sign-Off',
    name: 'Release Readiness Sign-Off',
    description:
      'Pre-release verification checklist covering regression pass rate, open defects, and environment readiness.',
    category: 'Release Readiness',
    priority: 'Critical',
    status: 'In Progress',
    projectId,
    projectName: 'Qavora Mobile App',
    environment: 'Staging',
    targetRelease: 'v1.0.0',
    tags: ['release', 'sign-off'],
    items: [
      {
        id: 'chk_item_1',
        title: 'All P0/Critical test suites executed with 100% pass rate',
        text: 'All P0/Critical test suites executed with 100% pass rate',
        completed: true,
        checked: true,
        status: 'Completed',
        category: 'Release Readiness',
        priority: 'Critical',
        notes: 'Verified in RUN-202',
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      {
        id: 'chk_item_2',
        title: 'Zero open Critical severity defects in release scope',
        text: 'Zero open Critical severity defects in release scope',
        completed: true,
        checked: true,
        status: 'Completed',
        category: 'Release Readiness',
        priority: 'Critical',
        notes: '',
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      {
        id: 'chk_item_3',
        title: 'Offline backup export and recovery snapshot verified',
        text: 'Offline backup export and recovery snapshot verified',
        completed: false,
        checked: false,
        status: 'Pending',
        category: 'Mobile Android',
        priority: 'High',
        notes: '',
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      {
        id: 'chk_item_4',
        title: 'Light and Dark themes verified across all screens',
        text: 'Light and Dark themes verified across all screens',
        completed: false,
        checked: false,
        status: 'Pending',
        category: 'Accessibility & UI',
        priority: 'Medium',
        notes: '',
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    ],
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

function seedWorkspaceForUser(state, userId) {
  const nowIso = new Date().toISOString();
  if (!Array.isArray(state.projectsByUser[userId])) {
    const sampleProject = buildInitialSampleProject(userId, nowIso);
    state.projectsByUser[userId] = [sampleProject];
    if (!Array.isArray(state.checklistsByUser[userId])) {
      state.checklistsByUser[userId] = [
        buildInitialSampleChecklist(userId, sampleProject.id, nowIso),
      ];
    }
  } else if (!Array.isArray(state.checklistsByUser[userId])) {
    state.checklistsByUser[userId] = [];
  }
}

const SENSITIVE_USER_KEYS = [
  'password',
  'passwordHash',
  'salt',
  'secret',
  'token',
  'csrfToken',
  'refreshToken',
];

function stripSensitiveUserFields(userRecord) {
  if (!userRecord || typeof userRecord !== 'object') {
    return { cleaned: null, hadSensitiveFields: false };
  }
  const hadSensitiveFields = SENSITIVE_USER_KEYS.some((key) =>
    Object.prototype.hasOwnProperty.call(userRecord, key)
  );
  const cleaned = {
    userId: userRecord.userId || userRecord.id || '',
    email: userRecord.email || '',
    name: userRecord.name || '',
    role: userRecord.role || 'QA Tester',
    avatarInitials:
      userRecord.avatarInitials || buildAvatarInitials(userRecord.name),
    createdAt: userRecord.createdAt || '',
    updatedAt: userRecord.updatedAt || '',
    lastLoginAt: userRecord.lastLoginAt || '',
    preferences:
      userRecord.preferences && typeof userRecord.preferences === 'object'
        ? userRecord.preferences
        : {},
  };
  return { cleaned, hadSensitiveFields };
}

function scrubMockState(rawState) {
  const base = {
    ...createEmptyState(),
    ...(rawState && typeof rawState === 'object' ? rawState : {}),
  };
  const nextUsers = {};
  let migrated = false;

  if (base.users && typeof base.users === 'object') {
    Object.entries(base.users).forEach(([key, record]) => {
      const { cleaned, hadSensitiveFields } = stripSensitiveUserFields(record);
      if (hadSensitiveFields) {
        migrated = true;
      }
      if (cleaned && cleaned.userId) {
        nextUsers[key] = cleaned;
      } else if (record !== null && record !== undefined) {
        migrated = true;
      }
    });
  }

  base.users = nextUsers;
  return { state: base, migrated };
}

async function loadState() {
  if (stateCache) {
    return stateCache;
  }
  if (loadPromise) {
    return loadPromise;
  }
  loadPromise = (async () => {
    try {
      const storage = getMockStorage();
      const raw = await storage.getItem(MOCK_STORE_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          const { state: scrubbed, migrated } = scrubMockState(parsed);
          stateCache = scrubbed;
          if (migrated) {
            await saveState(scrubbed);
          }
          return stateCache;
        }
      }
    } catch {
      // Ignore corrupted local mock state
    }
    stateCache = createEmptyState();
    return stateCache;
  })();

  try {
    return await loadPromise;
  } finally {
    loadPromise = null;
  }
}

async function saveState(state) {
  const { state: scrubbed } = scrubMockState(state);
  stateCache = scrubbed;
  const storage = getMockStorage();
  writeChain = writeChain
    .then(() =>
      storage.setItem(MOCK_STORE_STORAGE_KEY, JSON.stringify(scrubbed))
    )
    .catch(() => {});
  await writeChain;
}

function jsonResponse(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
  });
}

function sanitizeSafeUser(userRecord) {
  if (!userRecord) return null;
  return {
    id: userRecord.userId,
    userId: userRecord.userId,
    email: userRecord.email,
    name: userRecord.name,
    role: userRecord.role || 'QA Tester',
    avatarInitials: userRecord.avatarInitials,
    createdAt: userRecord.createdAt,
    updatedAt: userRecord.updatedAt,
    lastLoginAt: userRecord.lastLoginAt,
    preferences: userRecord.preferences || {},
  };
}

function buildAvatarInitials(name) {
  const parts = String(name || 'QA')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return 'QA';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || 'Q'}${parts[parts.length - 1][0] || 'A'}`.toUpperCase();
}

function parseJsonBody(rawBody) {
  if (!rawBody) return {};
  if (typeof rawBody === 'object') return rawBody;
  try {
    return JSON.parse(String(rawBody));
  } catch {
    return {};
  }
}

function isMockExecutionBlockedInEnvironment() {
  if (typeof process === 'undefined' || !process.env) {
    return false;
  }
  return (
    process.env.EXPO_PUBLIC_ENV === 'production' ||
    process.env.NODE_ENV === 'production'
  );
}

export async function hasActiveLocalMockSession() {
  if (isMockExecutionBlockedInEnvironment()) {
    return false;
  }
  const state = await loadState();
  return Boolean(state.activeUserId && state.users[state.activeUserId]);
}

export async function localMockFetch(urlString, init = {}) {
  if (isMockExecutionBlockedInEnvironment()) {
    return jsonResponse(
      { error: 'Local mock backend is disabled in production builds.' },
      403
    );
  }
  const state = await loadState();
  const parsedUrl = new URL(urlString);
  const path = parsedUrl.pathname.replace(/\/+$/, '') || '/';
  const method = String(init.method || 'GET').toUpperCase();
  const body = parseJsonBody(init.body);
  const nowIso = new Date().toISOString();

  // 1. Public health & CSRF routes
  if (method === 'GET' && path === '/api/health') {
    return jsonResponse({
      status: 'ok',
      mode: 'local-mock',
      timestamp: nowIso,
    });
  }

  if (method === 'GET' && path === '/api/auth/csrf') {
    if (!state.csrfToken) {
      state.csrfToken = `mock_csrf_${Date.now().toString(36)}`;
      await saveState(state);
    }
    return jsonResponse(
      { success: true, csrfToken: state.csrfToken },
      200,
      { 'Set-Cookie': `qavora_csrf_token=${state.csrfToken}; Path=/; SameSite=Lax` }
    );
  }

  // 2. Auth routes
  if (method === 'POST' && path === '/api/auth/register') {
    const email = String(body.email || '').trim().toLowerCase();
    const name = String(body.name || '').trim();
    const password = typeof body.password === 'string' ? body.password : '';
    const role = String(body.role || 'QA Tester').trim() || 'QA Tester';

    if (!name || !email || password.length < 8) {
      return jsonResponse(
        { error: 'Valid name, email, and 8+ character password are required.' },
        400
      );
    }

    const existing = Object.values(state.users).find(
      (u) => u.email === email
    );
    if (existing) {
      return jsonResponse(
        { error: 'An account with this email already exists.' },
        409
      );
    }

    const userId = `user_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 6)}`;
    const newUser = {
      userId,
      email,
      name,
      role,
      avatarInitials: buildAvatarInitials(name),
      createdAt: nowIso,
      updatedAt: nowIso,
      lastLoginAt: nowIso,
      preferences: {},
    };

    ephemeralDemoPasswords.set(userId, password);
    state.users[userId] = newUser;
    state.activeUserId = userId;
    state.csrfToken = `mock_csrf_${Date.now().toString(36)}`;
    seedWorkspaceForUser(state, userId);
    await saveState(state);

    return jsonResponse(
      { user: sanitizeSafeUser(newUser) },
      201,
      {
        'Set-Cookie': `qavora_auth_token=mock_session_${userId}; Path=/; HttpOnly; SameSite=Lax, qavora_csrf_token=${state.csrfToken}; Path=/; SameSite=Lax`,
      }
    );
  }

  if (method === 'POST' && path === '/api/auth/login') {
    const email = String(body.email || '').trim().toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';

    if (!email || !password) {
      return jsonResponse({ error: 'Email and password are required.' }, 400);
    }

    const userRecord = Object.values(state.users).find(
      (u) => u.email === email
    );

    if (!userRecord) {
      return jsonResponse({ error: 'Invalid email or password.' }, 401);
    }

    const expectedPassword = ephemeralDemoPasswords.get(userRecord.userId);
    if (typeof expectedPassword !== 'string' || expectedPassword !== password) {
      return jsonResponse({ error: 'Invalid email or password.' }, 401);
    }

    userRecord.lastLoginAt = nowIso;
    userRecord.updatedAt = nowIso;

    state.activeUserId = userRecord.userId;
    state.csrfToken = `mock_csrf_${Date.now().toString(36)}`;
    seedWorkspaceForUser(state, userRecord.userId);
    await saveState(state);

    return jsonResponse(
      { user: sanitizeSafeUser(userRecord) },
      200,
      {
        'Set-Cookie': `qavora_auth_token=mock_session_${userRecord.userId}; Path=/; HttpOnly; SameSite=Lax, qavora_csrf_token=${state.csrfToken}; Path=/; SameSite=Lax`,
      }
    );
  }

  if (method === 'POST' && path === '/api/auth/logout') {
    state.activeUserId = null;
    await saveState(state);
    return jsonResponse({ success: true });
  }

  if (method === 'GET' && path === '/api/auth/me') {
    const activeUser = state.activeUserId
      ? state.users[state.activeUserId]
      : null;
    if (!activeUser) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }
    return jsonResponse({ user: sanitizeSafeUser(activeUser) });
  }

  // Require authenticated user for all workspace routes
  const activeUser = state.activeUserId
    ? state.users[state.activeUserId]
    : null;
  if (!activeUser) {
    return jsonResponse({ error: 'Authentication required.' }, 401);
  }
  const userId = activeUser.userId;
  seedWorkspaceForUser(state, userId);
  const userProjects = state.projectsByUser[userId];
  const userChecklists = state.checklistsByUser[userId];

  // 3. Project routes
  if (method === 'GET' && path === '/api/projects') {
    const statusFilter = parsedUrl.searchParams.get('status');
    const list = statusFilter
      ? userProjects.filter((p) => p.status === statusFilter)
      : userProjects;
    return jsonResponse(cloneJson(list));
  }

  if (method === 'POST' && path === '/api/projects') {
    const requestedId =
      typeof body.id === 'string' && body.id.trim() ? body.id.trim() : '';
    if (
      requestedId &&
      userProjects.some((p) => p.id === requestedId || p._id === requestedId)
    ) {
      return jsonResponse(
        {
          error: 'A project with this ID already exists.',
          code: 'CONFLICT',
        },
        409
      );
    }
    const id =
      requestedId ||
      `proj_${Date.now().toString(36)}_${Math.random()
        .toString(36)
        .slice(2, 6)}`;
    const name = String(body.name || '').trim();
    if (!name) {
      return jsonResponse({ error: "Field 'name' is required." }, 400);
    }
    const newProject = {
      ...cloneJson(body),
      id,
      _id: id,
      userId,
      name,
      type: body.type || 'Web Application',
      version: body.version || '1.0.0',
      description: body.description || '',
      status: body.status || 'Active',
      environment: body.environment || 'Staging',
      tags: Array.isArray(body.tags) ? body.tags : [],
      testPlan: body.testPlan || {
        id: `plan_${id}`,
        name: `${name} Master Test Plan`,
        phases: [],
        testTypes: [],
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      testSuites: Array.isArray(body.testSuites) ? body.testSuites : [],
      executionRuns: Array.isArray(body.executionRuns)
        ? body.executionRuns
        : [],
      executions: Array.isArray(body.executions) ? body.executions : [],
      defects: Array.isArray(body.defects) ? body.defects : [],
      createdAt: body.createdAt || nowIso,
      updatedAt: nowIso,
    };
    userProjects.unshift(newProject);
    await saveState(state);
    return jsonResponse(cloneJson(newProject), 201);
  }

  const projectMatch = path.match(/^\/api\/projects\/([^/]+)(?:\/(status|data))?$/);
  if (projectMatch) {
    const projectId = decodeURIComponent(projectMatch[1]);
    const subRoute = projectMatch[2] || '';
    const idx = userProjects.findIndex(
      (p) => p.id === projectId || p._id === projectId
    );
    if (idx === -1) {
      return jsonResponse({ error: 'Project not found.' }, 404);
    }
    const existing = userProjects[idx];

    if (method === 'GET' && !subRoute) {
      return jsonResponse({ project: cloneJson(existing) });
    }

    if (method === 'DELETE' && !subRoute) {
      userProjects.splice(idx, 1);
      await saveState(state);
      return jsonResponse({ message: 'Project deleted successfully.' });
    }

    if (
      (method === 'PUT' || method === 'PATCH') &&
      (!subRoute || subRoute === 'status' || subRoute === 'data')
    ) {
      if (
        method === 'PATCH' &&
        body.expectedUpdatedAt &&
        existing.updatedAt &&
        body.expectedUpdatedAt !== existing.updatedAt
      ) {
        return jsonResponse(
          {
            error: 'Project was modified concurrently.',
            code: 'CONFLICT',
            currentUpdatedAt: existing.updatedAt,
            serverProject: cloneJson(existing),
          },
          409
        );
      }

      const { expectedUpdatedAt: _ignored, ...updates } = body;
      const updated = {
        ...existing,
        ...cloneJson(updates),
        id: existing.id,
        _id: existing._id || existing.id,
        userId,
        updatedAt: nowIso,
      };
      userProjects[idx] = updated;
      await saveState(state);
      return jsonResponse(cloneJson(updated));
    }
  }

  // 4. Checklist routes
  if (method === 'GET' && path === '/api/checklists') {
    const projectId = parsedUrl.searchParams.get('projectId');
    const status = parsedUrl.searchParams.get('status');
    const category = parsedUrl.searchParams.get('category');

    let filtered = [...userChecklists];
    if (projectId) {
      filtered = filtered.filter((c) => c.projectId === projectId);
    }
    if (status && status !== 'All') {
      filtered = filtered.filter((c) => c.status === status);
    }
    if (category && category !== 'All') {
      filtered = filtered.filter((c) => c.category === category);
    }
    return jsonResponse({ checklists: cloneJson(filtered) });
  }

  if (method === 'POST' && path === '/api/checklists') {
    const requestedId =
      typeof body.id === 'string' && body.id.trim() ? body.id.trim() : '';
    if (
      requestedId &&
      userChecklists.some(
        (c) => c.id === requestedId || c._id === requestedId
      )
    ) {
      return jsonResponse(
        {
          error: 'A checklist with this ID already exists.',
          code: 'CONFLICT',
        },
        409
      );
    }
    const id =
      requestedId ||
      `chk_${Date.now().toString(36)}_${Math.random()
        .toString(36)
        .slice(2, 6)}`;
    const newChecklist = {
      ...cloneJson(body),
      id,
      _id: id,
      userId,
      createdAt: body.createdAt || nowIso,
      updatedAt: nowIso,
    };
    userChecklists.unshift(newChecklist);
    await saveState(state);
    return jsonResponse({ checklist: cloneJson(newChecklist) }, 201);
  }

  const checklistMatch = path.match(/^\/api\/checklists\/([^/]+)$/);
  if (checklistMatch) {
    const checklistId = decodeURIComponent(checklistMatch[1]);
    const idx = userChecklists.findIndex(
      (c) => c.id === checklistId || c._id === checklistId
    );
    if (idx === -1) {
      return jsonResponse({ error: 'Checklist not found.' }, 404);
    }
    const existing = userChecklists[idx];

    if (method === 'GET') {
      return jsonResponse({ checklist: cloneJson(existing) });
    }

    if (method === 'DELETE') {
      userChecklists.splice(idx, 1);
      await saveState(state);
      return jsonResponse({ deletedId: checklistId });
    }

    if (method === 'PATCH' || method === 'PUT') {
      if (
        method === 'PATCH' &&
        body.expectedUpdatedAt &&
        existing.updatedAt &&
        body.expectedUpdatedAt !== existing.updatedAt
      ) {
        return jsonResponse(
          {
            error: 'Checklist was modified concurrently.',
            code: 'CONFLICT',
            currentUpdatedAt: existing.updatedAt,
            serverChecklist: cloneJson(existing),
          },
          409
        );
      }

      const { expectedUpdatedAt: _ignored, ...updates } = body;
      const updated = {
        ...existing,
        ...cloneJson(updates),
        id: existing.id,
        _id: existing._id || existing.id,
        userId,
        updatedAt: nowIso,
      };
      if (Array.isArray(updates.phases) && updates.items === undefined) {
        delete updated.items;
      }
      userChecklists[idx] = updated;
      await saveState(state);
      return jsonResponse({ checklist: cloneJson(updated) });
    }
  }

  // 5. Data Management routes
  if (method === 'GET' && path === '/api/data/storage-usage') {
    const projectsBytes = JSON.stringify(userProjects).length;
    const checklistsBytes = JSON.stringify(userChecklists).length;
    const totalBytes = projectsBytes + checklistsBytes;
    return jsonResponse({
      storage: {
        totalBytes,
        totalKb: Number((totalBytes / 1024).toFixed(2)),
        projectsBytes,
        checklistsBytes,
      },
      metrics: {
        projectsCount: userProjects.length,
        checklistsCount: userChecklists.length,
      },
      metadata: {
        mode: 'local-mock',
        updatedAt: nowIso,
      },
    });
  }

  if (method === 'GET' && path === '/api/data/recovery-snapshot') {
    return jsonResponse({
      snapshot: state.snapshotsByUser[userId]
        ? cloneJson(state.snapshotsByUser[userId])
        : null,
    });
  }

  if (method === 'DELETE' && path === '/api/data/recovery-snapshot') {
    const hadSnapshot = Boolean(state.snapshotsByUser[userId]);
    delete state.snapshotsByUser[userId];
    await saveState(state);
    return jsonResponse({
      deletedCount: hadSnapshot ? 1 : 0,
      message: 'Recovery snapshot cleared.',
    });
  }

  if (method === 'POST' && path === '/api/data/import') {
    const mode = body.mode === 'replace' ? 'replace' : 'merge';
    const incomingProjects = Array.isArray(body.projects) ? body.projects : [];
    const incomingChecklists = Array.isArray(body.checklists)
      ? body.checklists
      : [];

    let snapshotCreated = false;
    let snapshotId = null;

    if (mode === 'replace') {
      snapshotId = `snap_${Date.now().toString(36)}`;
      state.snapshotsByUser[userId] = {
        id: snapshotId,
        createdAt: nowIso,
        projectsCount: userProjects.length,
        checklistsCount: userChecklists.length,
        projects: cloneJson(userProjects),
        checklists: cloneJson(userChecklists),
      };
      snapshotCreated = true;

      state.projectsByUser[userId] = incomingProjects.map((p, idx) => ({
        ...cloneJson(p),
        id: p.id || `proj_imp_${idx}_${Date.now().toString(36)}`,
        _id: p.id || `proj_imp_${idx}_${Date.now().toString(36)}`,
        userId,
        updatedAt: nowIso,
      }));
      state.checklistsByUser[userId] = incomingChecklists.map((c, idx) => ({
        ...cloneJson(c),
        id: c.id || `chk_imp_${idx}_${Date.now().toString(36)}`,
        _id: c.id || `chk_imp_${idx}_${Date.now().toString(36)}`,
        userId,
        updatedAt: nowIso,
      }));
    } else {
      incomingProjects.forEach((p, idx) => {
        const pid = p.id || `proj_imp_${idx}_${Date.now().toString(36)}`;
        const existingIdx = userProjects.findIndex((ep) => ep.id === pid);
        const record = {
          ...cloneJson(p),
          id: pid,
          _id: pid,
          userId,
          updatedAt: nowIso,
        };
        if (existingIdx >= 0) {
          userProjects[existingIdx] = record;
        } else {
          userProjects.unshift(record);
        }
      });

      incomingChecklists.forEach((c, idx) => {
        const cid = c.id || `chk_imp_${idx}_${Date.now().toString(36)}`;
        const existingIdx = userChecklists.findIndex((ec) => ec.id === cid);
        const record = {
          ...cloneJson(c),
          id: cid,
          _id: cid,
          userId,
          updatedAt: nowIso,
        };
        if (existingIdx >= 0) {
          userChecklists[existingIdx] = record;
        } else {
          userChecklists.unshift(record);
        }
      });
    }

    await saveState(state);
    return jsonResponse({
      mode,
      message:
        mode === 'replace'
          ? 'Workspace replaced and pre-import recovery snapshot saved.'
          : 'Imported items merged into workspace.',
      imported: {
        projects: incomingProjects.length,
        checklists: incomingChecklists.length,
      },
      snapshotCreated,
      snapshotId,
    });
  }

  if (method === 'POST' && path === '/api/data/rollback') {
    const snap = state.snapshotsByUser[userId];
    if (!snap) {
      return jsonResponse({ error: 'No recovery snapshot available.' }, 404);
    }
    state.projectsByUser[userId] = cloneJson(snap.projects || []).map((p) => ({
      ...p,
      userId,
    }));
    state.checklistsByUser[userId] = cloneJson(snap.checklists || []).map(
      (c) => ({
        ...c,
        userId,
      })
    );
    await saveState(state);
    return jsonResponse({
      message: 'Workspace rolled back to recovery snapshot.',
      restored: {
        projects: state.projectsByUser[userId].length,
        checklists: state.checklistsByUser[userId].length,
      },
    });
  }

  if (method === 'POST' && path === '/api/data/reset') {
    const deletedProjects = userProjects.length;
    const deletedChecklists = userChecklists.length;
    state.projectsByUser[userId] = [];
    state.checklistsByUser[userId] = [];
    await saveState(state);
    return jsonResponse({
      message: 'All workspace test data has been reset.',
      deleted: {
        projects: deletedProjects,
        artifacts: 0,
        checklists: deletedChecklists,
      },
    });
  }

  return jsonResponse({ error: `Unknown local mock endpoint: ${method} ${path}` }, 404);
}

/**
 * Qavora Android — Multi-Project Service Layer (Phase 2A)
 *
 * Implements the exact project management contracts of the Qavora Web
 * Express 5 + MongoDB 7 backend (`server.ts:2679–3550`):
 *
 * 1. `GET /api/projects`              — Fetch all projects owned by authenticated user
 * 2. `GET /api/projects/:id`          — Fetch a single user-owned project by ID
 * 3. `POST /api/projects`             — Create a new user-owned project document
 * 4. `PUT /api/projects/:id`          — Update project metadata (`$set`, whitelisted PUT fields)
 * 5. `PATCH /api/projects/:id`        — Partial project metadata update with `expectedUpdatedAt` optimistic concurrency
 * 6. `PATCH /api/projects/:id/status` — Update project status (`Active` | `Completed` | `Archived`)
 * 7. `DELETE /api/projects/:id`       — Delete a project and all associated `project_artifacts`
 *
 * Reuses the Phase 1A `apiClient` and Phase 1B cookie/CSRF authentication transport.
 */

import {
  apiGet,
  apiPost,
  apiPut,
  apiPatch,
  apiDelete,
  ApiClientError,
} from './apiClient.js';

export const PROJECT_STATUSES = ['Active', 'Completed', 'Archived'];

export const ALLOWED_PROJECT_CREATE_FIELDS = new Set([
  'id',
  'name',
  'type',
  'projectType',
  'version',
  'description',
  'status',
  'environment',
  'environments',
  'baseUrl',
  'tags',
  'createdAt',
  'updatedAt',
  'testPlan',
  'testSuites',
  'phases',
  'executions',
  'executionRuns',
  'activeRun',
  'defects',
  'team',
  'automation',
  'testData',
  'sourceChecklistId',
  'promotedFromChecklistTitle',
  'promotedAt',
  'testCaseCount',
  'executedTests',
  'passedTests',
  'failedTests',
  'blockedTests',
  'skippedTests',
  'notRunTests',
  'passRate',
  'totalDefects',
  'openDefects',
  'inProgressDefects',
  'resolvedDefects',
  'closedDefects',
  'criticalDefects',
]);

export const ALLOWED_PROJECT_PUT_FIELDS = new Set([
  'name',
  'type',
  'version',
  'description',
  'status',
  'environment',
  'baseUrl',
  'tags',
]);

export const ALLOWED_PROJECT_PATCH_FIELDS = new Set([
  'name',
  'type',
  'version',
  'description',
  'status',
  'environment',
  'baseUrl',
  'tags',
  'expectedUpdatedAt',
]);

export const ALLOWED_PROJECT_DATA_PATCH_FIELDS = new Set([
  'name',
  'type',
  'projectType',
  'version',
  'description',
  'status',
  'environment',
  'environments',
  'baseUrl',
  'tags',
  'testPlan',
  'testSuites',
  'phases',
  'executions',
  'executionRuns',
  'activeRun',
  'defects',
  'team',
  'automation',
  'testData',
  'sourceChecklistId',
  'promotedFromChecklistTitle',
  'promotedAt',
  'testCaseCount',
  'executedTests',
  'passedTests',
  'failedTests',
  'blockedTests',
  'skippedTests',
  'notRunTests',
  'passRate',
  'totalDefects',
  'openDefects',
  'inProgressDefects',
  'resolvedDefects',
  'closedDefects',
  'criticalDefects',
  'expectedUpdatedAt',
]);

/**
 * Checks recursively whether an object contains prohibited keys
 * (MongoDB `$` operators, dotted paths, or prototype pollution keys),
 * matching `containsProhibitedKeys` in Qavora Web `server.ts`.
 *
 * @param {any} value
 * @returns {boolean}
 */
export function containsProhibitedKeys(value) {
  if (!value || typeof value !== 'object') {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((item) => containsProhibitedKeys(item));
  }
  const keys = Object.keys(value);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    if (
      key.startsWith('$') ||
      key.includes('.') ||
      key === '__proto__' ||
      key === 'constructor' ||
      key === 'prototype'
    ) {
      return true;
    }
    if (containsProhibitedKeys(value[key])) {
      return true;
    }
  }
  return false;
}

/**
 * Builds a normalized default `testPlan` object matching Qavora Web's
 * `POST /api/projects` and `ensureProjectTestPlan` contract while preserving
 * any existing fields on the plan.
 *
 * @param {object} [rawProject]
 * @returns {object}
 */
export function buildDefaultTestPlan(rawProject = {}) {
  const projectId =
    (typeof rawProject.id === 'string' && rawProject.id.trim()) ||
    (rawProject._id ? String(rawProject._id).trim() : 'project');
  const projectName =
    typeof rawProject.name === 'string' && rawProject.name.trim()
      ? rawProject.name.trim()
      : 'Project';
  const now = new Date().toISOString();
  const rawPlan =
    rawProject.testPlan &&
    typeof rawProject.testPlan === 'object' &&
    !Array.isArray(rawProject.testPlan)
      ? rawProject.testPlan
      : {};

  return {
    id:
      typeof rawPlan.id === 'string' && rawPlan.id.trim()
        ? rawPlan.id.trim()
        : `plan_${projectId}`,
    name:
      typeof rawPlan.name === 'string' && rawPlan.name.trim()
        ? rawPlan.name.trim()
        : `${projectName} Master Test Plan`,
    description:
      typeof rawPlan.description === 'string' ? rawPlan.description : '',
    objective: typeof rawPlan.objective === 'string' ? rawPlan.objective : '',
    scope: typeof rawPlan.scope === 'string' ? rawPlan.scope : '',
    outOfScope:
      typeof rawPlan.outOfScope === 'string' ? rawPlan.outOfScope : '',
    strategy: typeof rawPlan.strategy === 'string' ? rawPlan.strategy : '',
    environment:
      typeof rawPlan.environment === 'string' ? rawPlan.environment : '',
    entryCriteria:
      typeof rawPlan.entryCriteria === 'string' ? rawPlan.entryCriteria : '',
    exitCriteria:
      typeof rawPlan.exitCriteria === 'string' ? rawPlan.exitCriteria : '',
    deliverables:
      typeof rawPlan.deliverables === 'string' ? rawPlan.deliverables : '',
    risks: typeof rawPlan.risks === 'string' ? rawPlan.risks : '',
    tools: typeof rawPlan.tools === 'string' ? rawPlan.tools : '',
    schedule: typeof rawPlan.schedule === 'string' ? rawPlan.schedule : '',
    approvals: typeof rawPlan.approvals === 'string' ? rawPlan.approvals : '',
    notes: typeof rawPlan.notes === 'string' ? rawPlan.notes : '',
    testTypes: Array.isArray(rawPlan.testTypes) ? rawPlan.testTypes : [],
    phases: Array.isArray(rawPlan.phases) ? rawPlan.phases : [],
    createdAt:
      rawPlan.createdAt || rawProject.createdAt
        ? String(rawPlan.createdAt || rawProject.createdAt)
        : now,
    updatedAt:
      rawPlan.updatedAt || rawProject.updatedAt
        ? String(rawPlan.updatedAt || rawProject.updatedAt)
        : now,
    ...rawPlan,
  };
}

/**
 * Normalizes a backend project document into a consistent structure while
 * preserving all backend fields (`_id`, `id`, `userId`, `updatedAt`, nested QA arrays, etc.).
 *
 * @param {any} rawProject
 * @returns {object | null}
 */
export function normalizeProject(rawProject) {
  if (!rawProject || typeof rawProject !== 'object' || Array.isArray(rawProject)) {
    return null;
  }

  const id =
    (typeof rawProject.id === 'string' && rawProject.id.trim()) ||
    (rawProject._id ? String(rawProject._id).trim() : '');
  const name =
    typeof rawProject.name === 'string' ? rawProject.name.trim() : '';

  if (!id || !name) {
    return null;
  }

  const status = PROJECT_STATUSES.includes(rawProject.status)
    ? rawProject.status
    : 'Active';

  const type =
    (typeof rawProject.type === 'string' && rawProject.type.trim()) ||
    (typeof rawProject.projectType === 'string' && rawProject.projectType.trim()) ||
    'Web Application';

  return {
    ...rawProject,
    id,
    name,
    type,
    status,
    version:
      typeof rawProject.version === 'string'
        ? rawProject.version.trim()
        : rawProject.version !== undefined && rawProject.version !== null
        ? String(rawProject.version)
        : '',
    description:
      typeof rawProject.description === 'string'
        ? rawProject.description.trim()
        : '',
    environment:
      typeof rawProject.environment === 'string'
        ? rawProject.environment.trim()
        : '',
    baseUrl:
      typeof rawProject.baseUrl === 'string' ? rawProject.baseUrl.trim() : '',
    tags: Array.isArray(rawProject.tags)
      ? rawProject.tags.filter((t) => typeof t === 'string').map((t) => t.trim())
      : [],
    createdAt: rawProject.createdAt ? String(rawProject.createdAt) : '',
    updatedAt: rawProject.updatedAt ? String(rawProject.updatedAt) : '',
    testPlan: buildDefaultTestPlan({ ...rawProject, id, name }),
    testSuites: Array.isArray(rawProject.testSuites) ? rawProject.testSuites : [],
    executions: Array.isArray(rawProject.executions) ? rawProject.executions : [],
    executionRuns: Array.isArray(rawProject.executionRuns)
      ? rawProject.executionRuns
      : [],
    activeRun:
      rawProject.activeRun && typeof rawProject.activeRun === 'object'
        ? rawProject.activeRun
        : null,
    defects: Array.isArray(rawProject.defects) ? rawProject.defects : [],
  };
}

export const normalizeProjectRecord = normalizeProject;

/**
 * Formats an error thrown by `apiClient` into a structured service response,
 * including HTTP 409 optimistic concurrency conflict metadata (`currentUpdatedAt`, `expectedUpdatedAt`).
 *
 * @param {any} err
 * @param {string} fallbackMessage
 */
function buildProjectErrorResult(err, fallbackMessage) {
  const isApiErr = err instanceof ApiClientError;
  const status = isApiErr ? err.status : 0;
  const data = isApiErr && err.data && typeof err.data === 'object' ? err.data : null;
  const isConflict = status === 409;

  return {
    ok: false,
    status,
    project: null,
    projects: null,
    isConflict,
    currentUpdatedAt: data && data.currentUpdatedAt ? data.currentUpdatedAt : null,
    expectedUpdatedAt: data && data.expectedUpdatedAt ? data.expectedUpdatedAt : null,
    isNetworkError: isApiErr ? err.isNetworkError : false,
    code: isApiErr ? err.code : 'PROJECT_API_ERROR',
    error: (err && err.message) || fallbackMessage,
  };
}

/**
 * 1. `GET /api/projects`
 * Fetches all projects belonging to the authenticated user, with optional status filter.
 *
 * @param {object} [options]
 * @param {'Active' | 'Completed' | 'Archived'} [options.status]
 */
export async function fetchProjects(options = {}) {
  const { status, ...requestOptions } = options || {};
  const params = {};

  if (typeof status === 'string' && status.trim() && status !== 'All') {
    params.status = status.trim();
  }

  try {
    const response = await apiGet('/api/projects', {
      ...requestOptions,
      params: Object.keys(params).length > 0 ? params : undefined,
    });

    const rawList = Array.isArray(response.data) ? response.data : [];
    const projects = rawList.map(normalizeProject).filter(Boolean);

    return {
      ok: true,
      status: response.status,
      projects,
      error: null,
    };
  } catch (err) {
    return buildProjectErrorResult(err, 'Failed to fetch projects.');
  }
}

/**
 * 2. `GET /api/projects/:id`
 * Fetches an individual project owned by the authenticated user.
 *
 * @param {string} projectId
 * @param {object} [options]
 */
export async function fetchProjectById(projectId, options = {}) {
  const cleanId = typeof projectId === 'string' ? projectId.trim() : '';
  if (!cleanId) {
    return {
      ok: false,
      status: 400,
      project: null,
      isConflict: false,
      error: 'Project ID is required.',
    };
  }

  try {
    const response = await apiGet(
      `/api/projects/${encodeURIComponent(cleanId)}`,
      options
    );
    const project = normalizeProject(response.data);
    if (!project) {
      return {
        ok: false,
        status: response.status,
        project: null,
        isConflict: false,
        error: 'Invalid project payload returned from server.',
      };
    }

    return {
      ok: true,
      status: response.status,
      project,
      isConflict: false,
      error: null,
    };
  } catch (err) {
    return buildProjectErrorResult(err, 'Failed to fetch project.');
  }
}

/**
 * 3. `POST /api/projects`
 * Creates a new user-owned project document.
 * Strictly whitelists fields against `ALLOWED_PROJECT_CREATE_FIELDS`.
 *
 * @param {object} projectInput
 * @param {object} [options]
 */
export async function createProject(projectInput, options = {}) {
  if (!projectInput || typeof projectInput !== 'object' || Array.isArray(projectInput)) {
    return {
      ok: false,
      status: 400,
      project: null,
      isConflict: false,
      error: 'Request body must be a valid JSON object.',
    };
  }

  const trimmedName =
    typeof projectInput.name === 'string' ? projectInput.name.trim() : '';
  if (!trimmedName) {
    return {
      ok: false,
      status: 400,
      project: null,
      isConflict: false,
      error: "Field 'name' is required and must be a non-empty string.",
    };
  }
  if (trimmedName.length > 120) {
    return {
      ok: false,
      status: 400,
      project: null,
      isConflict: false,
      error: "Field 'name' cannot exceed 120 characters.",
    };
  }

  if (
    projectInput.status !== undefined &&
    !PROJECT_STATUSES.includes(projectInput.status)
  ) {
    return {
      ok: false,
      status: 400,
      project: null,
      isConflict: false,
      error: "Invalid status. Must be 'Active', 'Completed', or 'Archived'.",
    };
  }

  const payload = {};
  Object.keys(projectInput).forEach((key) => {
    if (ALLOWED_PROJECT_CREATE_FIELDS.has(key) && projectInput[key] !== undefined) {
      payload[key] = projectInput[key];
    }
  });
  payload.name = trimmedName;

  if (typeof payload.type === 'string') {
    payload.type = payload.type.trim() || 'Web Application';
  }
  if (typeof payload.version === 'string') {
    payload.version = payload.version.trim();
  }
  if (typeof payload.description === 'string') {
    payload.description = payload.description.trim();
  }
  if (typeof payload.environment === 'string') {
    payload.environment = payload.environment.trim();
  }
  if (typeof payload.baseUrl === 'string') {
    payload.baseUrl = payload.baseUrl.trim();
  }
  if (Array.isArray(payload.tags)) {
    payload.tags = payload.tags
      .filter((t) => typeof t === 'string')
      .map((t) => t.trim());
  }

  try {
    const response = await apiPost('/api/projects', payload, options);
    const project = normalizeProject(response.data);
    if (!project) {
      return {
        ok: false,
        status: response.status,
        project: null,
        isConflict: false,
        error: 'Invalid project payload returned from server.',
      };
    }

    return {
      ok: true,
      status: response.status,
      project,
      isConflict: false,
      error: null,
    };
  } catch (err) {
    return buildProjectErrorResult(err, 'Failed to create project.');
  }
}

/**
 * Builds and validates a metadata update object for `PUT /api/projects/:id` or `PATCH /api/projects/:id`.
 *
 * @param {object} updates
 * @param {Set<string>} allowedSet
 */
function buildWhitelistedMetadataPayload(updates, allowedSet) {
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    return { valid: false, error: 'Request body must be a valid JSON object.' };
  }

  const payload = {};
  Object.keys(updates).forEach((key) => {
    if (allowedSet.has(key) && updates[key] !== undefined) {
      payload[key] = updates[key];
    }
  });

  if (payload.name !== undefined) {
    if (typeof payload.name !== 'string' || payload.name.trim() === '') {
      return {
        valid: false,
        error: "Field 'name' must be a non-empty string.",
      };
    }
    if (payload.name.trim().length > 120) {
      return {
        valid: false,
        error: "Field 'name' cannot exceed 120 characters.",
      };
    }
    payload.name = payload.name.trim();
  }

  if (payload.type !== undefined) {
    if (typeof payload.type !== 'string' || payload.type.trim() === '') {
      return {
        valid: false,
        error: "Field 'type' must be a non-empty string.",
      };
    }
    payload.type = payload.type.trim();
  }

  if (payload.version !== undefined) {
    payload.version =
      typeof payload.version === 'string'
        ? payload.version.trim()
        : String(payload.version);
  }

  if (payload.description !== undefined) {
    payload.description =
      typeof payload.description === 'string' ? payload.description.trim() : '';
  }

  if (payload.status !== undefined) {
    if (!PROJECT_STATUSES.includes(payload.status)) {
      return {
        valid: false,
        error: "Invalid status. Must be 'Active', 'Completed', or 'Archived'.",
      };
    }
  }

  if (payload.environment !== undefined) {
    if (typeof payload.environment !== 'string') {
      return {
        valid: false,
        error: "Field 'environment' must be a string.",
      };
    }
    payload.environment = payload.environment.trim();
  }

  if (payload.baseUrl !== undefined) {
    if (typeof payload.baseUrl !== 'string') {
      return {
        valid: false,
        error: "Field 'baseUrl' must be a string.",
      };
    }
    payload.baseUrl = payload.baseUrl.trim();
  }

  if (payload.tags !== undefined) {
    if (
      !Array.isArray(payload.tags) ||
      !payload.tags.every((t) => typeof t === 'string')
    ) {
      return {
        valid: false,
        error: "Field 'tags' must be an array of strings.",
      };
    }
    payload.tags = payload.tags.map((t) => t.trim());
  }

  if (payload.expectedUpdatedAt !== undefined) {
    if (
      typeof payload.expectedUpdatedAt !== 'string' ||
      payload.expectedUpdatedAt.trim() === ''
    ) {
      return {
        valid: false,
        error:
          "Field 'expectedUpdatedAt' must be a non-empty string when provided.",
      };
    }
    payload.expectedUpdatedAt = payload.expectedUpdatedAt.trim();
  }

  return { valid: true, payload };
}

/**
 * 4. `PUT /api/projects/:id`
 * Updates project metadata using `PUT` (`ALLOWED_PROJECT_PUT_FIELDS`).
 * Note: The backend's `PUT` endpoint does not accept `expectedUpdatedAt`.
 *
 * @param {string} projectId
 * @param {object} updates
 * @param {object} [options]
 */
export async function updateProjectPut(projectId, updates, options = {}) {
  const cleanId = typeof projectId === 'string' ? projectId.trim() : '';
  if (!cleanId) {
    return {
      ok: false,
      status: 400,
      project: null,
      isConflict: false,
      error: 'Project ID is required.',
    };
  }

  const built = buildWhitelistedMetadataPayload(
    updates,
    ALLOWED_PROJECT_PUT_FIELDS
  );
  if (!built.valid) {
    return {
      ok: false,
      status: 400,
      project: null,
      isConflict: false,
      error: built.error,
    };
  }

  if (Object.keys(built.payload).length === 0) {
    return {
      ok: false,
      status: 400,
      project: null,
      isConflict: false,
      error: 'Update payload cannot be empty.',
    };
  }

  try {
    const response = await apiPut(
      `/api/projects/${encodeURIComponent(cleanId)}`,
      built.payload,
      options
    );
    const project = normalizeProject(response.data);
    return {
      ok: true,
      status: response.status,
      project,
      isConflict: false,
      error: null,
    };
  } catch (err) {
    return buildProjectErrorResult(err, 'Failed to update project.');
  }
}

/**
 * 5. `PATCH /api/projects/:id`
 * Updates project metadata using `PATCH` (`ALLOWED_PROJECT_PATCH_FIELDS`),
 * supporting `expectedUpdatedAt` optimistic concurrency control and HTTP 409 conflict detection.
 *
 * @param {string} projectId
 * @param {object} updates
 * @param {object} [options]
 * @param {string} [options.expectedUpdatedAt]
 */
export async function updateProjectMetadata(projectId, updates, options = {}) {
  const cleanId = typeof projectId === 'string' ? projectId.trim() : '';
  if (!cleanId) {
    return {
      ok: false,
      status: 400,
      project: null,
      isConflict: false,
      error: 'Project ID is required.',
    };
  }

  const mergedUpdates = {
    ...(updates && typeof updates === 'object' ? updates : {}),
    ...(options && options.expectedUpdatedAt !== undefined
      ? { expectedUpdatedAt: options.expectedUpdatedAt }
      : {}),
  };

  const built = buildWhitelistedMetadataPayload(
    mergedUpdates,
    ALLOWED_PROJECT_PATCH_FIELDS
  );
  if (!built.valid) {
    return {
      ok: false,
      status: 400,
      project: null,
      isConflict: false,
      error: built.error,
    };
  }

  const dataFieldKeys = Object.keys(built.payload).filter(
    (k) => k !== 'expectedUpdatedAt'
  );
  if (dataFieldKeys.length === 0) {
    return {
      ok: false,
      status: 400,
      project: null,
      isConflict: false,
      error: 'Request body must contain at least one field to update.',
    };
  }

  const { expectedUpdatedAt: _ignored, ...requestOptions } = options || {};

  try {
    const response = await apiPatch(
      `/api/projects/${encodeURIComponent(cleanId)}`,
      built.payload,
      requestOptions
    );
    const project = normalizeProject(response.data);
    return {
      ok: true,
      status: response.status,
      project,
      isConflict: false,
      error: null,
    };
  } catch (err) {
    return buildProjectErrorResult(err, 'Failed to update project.');
  }
}

/**
 * 6. `PATCH /api/projects/:id/status`
 * Updates a project's lifecycle status (`Active` | `Completed` | `Archived`).
 *
 * @param {string} projectId
 * @param {'Active' | 'Completed' | 'Archived'} status
 * @param {object} [options]
 */
export async function updateProjectStatus(projectId, status, options = {}) {
  const cleanId = typeof projectId === 'string' ? projectId.trim() : '';
  if (!cleanId) {
    return {
      ok: false,
      status: 400,
      project: null,
      isConflict: false,
      error: 'Project ID is required.',
    };
  }

  if (!status || !PROJECT_STATUSES.includes(status)) {
    return {
      ok: false,
      status: 400,
      project: null,
      isConflict: false,
      error: "Invalid status. Must be 'Active', 'Completed', or 'Archived'.",
    };
  }

  try {
    const response = await apiPatch(
      `/api/projects/${encodeURIComponent(cleanId)}/status`,
      { status },
      options
    );
    const project = normalizeProject(response.data);
    return {
      ok: true,
      status: response.status,
      project,
      isConflict: false,
      error: null,
    };
  } catch (err) {
    return buildProjectErrorResult(err, 'Failed to update project status.');
  }
}

/**
 * 7. `DELETE /api/projects/:id`
 * Deletes a user-owned project and all associated artifacts on the backend.
 *
 * @param {string} projectId
 * @param {object} [options]
 */
export async function deleteProject(projectId, options = {}) {
  const cleanId = typeof projectId === 'string' ? projectId.trim() : '';
  if (!cleanId) {
    return {
      ok: false,
      status: 400,
      deletedId: null,
      projectId: null,
      error: 'Project ID is required.',
    };
  }

  try {
    const response = await apiDelete(
      `/api/projects/${encodeURIComponent(cleanId)}`,
      options
    );
    return {
      ok: true,
      status: response.status,
      deletedId: cleanId,
      projectId: cleanId,
      message:
        (response.data && response.data.message) ||
        'Project deleted successfully.',
      error: null,
    };
  } catch (err) {
    const baseErr = buildProjectErrorResult(err, 'Failed to delete project.');
    return {
      ...baseErr,
      deletedId: null,
      projectId: cleanId,
    };
  }
}

/**
 * 8. `PATCH /api/projects/:id/data` (Phase 2C)
 * Full project and nested QA data update (`testPlan`, `testSuites`, summary counts, etc.)
 * with `expectedUpdatedAt` optimistic concurrency control and strict field validation
 * matching `server.ts:3288–3492`.
 *
 * @param {string} projectId
 * @param {object} dataUpdates
 * @param {object} [options]
 * @param {string} [options.expectedUpdatedAt]
 */
export async function updateProjectData(projectId, dataUpdates, options = {}) {
  const cleanId = typeof projectId === 'string' ? projectId.trim() : '';
  if (!cleanId) {
    return {
      ok: false,
      status: 400,
      project: null,
      isConflict: false,
      error: 'Project ID parameter is required and must be a non-empty string.',
    };
  }

  if (!dataUpdates || typeof dataUpdates !== 'object' || Array.isArray(dataUpdates)) {
    return {
      ok: false,
      status: 400,
      project: null,
      isConflict: false,
      error: 'Request body must be a JSON object containing project update data.',
    };
  }

  const mergedInput = {
    ...dataUpdates,
    ...(options && options.expectedUpdatedAt !== undefined
      ? { expectedUpdatedAt: options.expectedUpdatedAt }
      : {}),
  };

  if (containsProhibitedKeys(mergedInput)) {
    return {
      ok: false,
      status: 400,
      project: null,
      isConflict: false,
      error:
        'Request body contains prohibited keys (NoSQL operators, dotted paths, or prototype pollution keys are not allowed).',
    };
  }

  const inputKeys = Object.keys(mergedInput);
  const disallowedKeys = inputKeys.filter(
    (k) => !ALLOWED_PROJECT_DATA_PATCH_FIELDS.has(k)
  );
  if (disallowedKeys.length > 0) {
    return {
      ok: false,
      status: 400,
      project: null,
      isConflict: false,
      error: `Disallowed field(s) in project data update payload: ${disallowedKeys.join(', ')}.`,
    };
  }

  const payload = {};
  inputKeys.forEach((key) => {
    if (mergedInput[key] !== undefined) {
      payload[key] = mergedInput[key];
    }
  });

  if (payload.expectedUpdatedAt !== undefined) {
    if (
      typeof payload.expectedUpdatedAt !== 'string' ||
      payload.expectedUpdatedAt.trim() === ''
    ) {
      return {
        ok: false,
        status: 400,
        project: null,
        isConflict: false,
        error:
          "Field 'expectedUpdatedAt' must be a non-empty string when provided.",
      };
    }
    payload.expectedUpdatedAt = payload.expectedUpdatedAt.trim();
  }

  const dataFieldKeys = Object.keys(payload).filter(
    (k) => k !== 'expectedUpdatedAt'
  );
  if (dataFieldKeys.length === 0) {
    return {
      ok: false,
      status: 400,
      project: null,
      isConflict: false,
      error: 'Request body must contain at least one field to update.',
    };
  }

  if (payload.testPlan !== undefined) {
    if (
      typeof payload.testPlan !== 'object' ||
      payload.testPlan === null ||
      Array.isArray(payload.testPlan)
    ) {
      return {
        ok: false,
        status: 400,
        project: null,
        isConflict: false,
        error: "Field 'testPlan' must be an object.",
      };
    }
  }

  if (payload.testSuites !== undefined && !Array.isArray(payload.testSuites)) {
    return {
      ok: false,
      status: 400,
      project: null,
      isConflict: false,
      error: "Field 'testSuites' must be an array.",
    };
  }

  if (payload.executions !== undefined && !Array.isArray(payload.executions)) {
    return {
      ok: false,
      status: 400,
      project: null,
      isConflict: false,
      error: "Field 'executions' must be an array.",
    };
  }

  if (
    payload.executionRuns !== undefined &&
    !Array.isArray(payload.executionRuns)
  ) {
    return {
      ok: false,
      status: 400,
      project: null,
      isConflict: false,
      error: "Field 'executionRuns' must be an array.",
    };
  }

  if (payload.defects !== undefined && !Array.isArray(payload.defects)) {
    return {
      ok: false,
      status: 400,
      project: null,
      isConflict: false,
      error: "Field 'defects' must be an array.",
    };
  }

  const { expectedUpdatedAt: _ignored, ...requestOptions } = options || {};

  try {
    const response = await apiPatch(
      `/api/projects/${encodeURIComponent(cleanId)}/data`,
      payload,
      requestOptions
    );
    const project = normalizeProject(response.data);
    return {
      ok: true,
      status: response.status,
      project,
      isConflict: false,
      error: null,
    };
  } catch (err) {
    return buildProjectErrorResult(err, 'Failed to save project data.');
  }
}

/**
 * Safely extracts and deduplicates test cases from a suite object that may
 * store cases in `suite.cases`, `suite.testCases`, or both.
 *
 * - Supports suites with only `suite.cases`
 * - Supports suites with only `suite.testCases`
 * - Supports suites where one array is empty (`[]`) and the other is populated
 * - Deduplicates when both `suite.cases` and `suite.testCases` are populated
 *   so that identical cases present in both arrays are never double-counted
 *
 * @param {any} suite
 * @returns {Array<object>}
 */
export function extractSuiteTestCases(suite) {
  if (!suite || typeof suite !== 'object' || Array.isArray(suite)) {
    return [];
  }

  const hasCases = Array.isArray(suite.cases) && suite.cases.length > 0;
  const hasTestCases =
    Array.isArray(suite.testCases) && suite.testCases.length > 0;

  if (!hasCases && !hasTestCases) {
    return [];
  }

  if (hasCases && hasTestCases && suite.cases === suite.testCases) {
    return suite.cases.filter(
      (tc) => tc && typeof tc === 'object' && !Array.isArray(tc)
    );
  }

  const combined = [
    ...(hasCases ? suite.cases : []),
    ...(hasTestCases ? suite.testCases : []),
  ];

  const result = [];
  const seenObjectRefs = new Set();
  const seenKeys = new Set();

  for (let i = 0; i < combined.length; i += 1) {
    const tc = combined[i];
    if (!tc || typeof tc !== 'object' || Array.isArray(tc)) {
      continue;
    }

    if (seenObjectRefs.has(tc)) {
      continue;
    }
    seenObjectRefs.add(tc);

    const rawId =
      (typeof tc.id === 'string' && tc.id.trim()) ||
      (typeof tc.testCaseId === 'string' && tc.testCaseId.trim()) ||
      (tc._id ? String(tc._id).trim() : '');

    const titleKey =
      typeof tc.title === 'string' && tc.title.trim()
        ? `title:${tc.title.trim().toLowerCase()}`
        : typeof tc.name === 'string' && tc.name.trim()
        ? `title:${tc.name.trim().toLowerCase()}`
        : null;

    const dedupeKey = rawId ? `id:${rawId}` : titleKey;
    if (dedupeKey) {
      if (seenKeys.has(dedupeKey)) {
        continue;
      }
      seenKeys.add(dedupeKey);
    }

    result.push(tc);
  }

  return result;
}

/**
 * Safely counts unique test cases in a suite across `suite.cases` and `suite.testCases`.
 *
 * @param {any} suite
 * @returns {number}
 */
export function countSuiteTestCases(suite) {
  return extractSuiteTestCases(suite).length;
}

/**
 * Computes the accurate total test case count for a project across all suites
 * (`suite.cases` and `suite.testCases` with deduplication), falling back to
 * `project.testCaseCount` when suites are not populated.
 *
 * @param {any} project
 * @returns {number | null}
 */
export function computeProjectTestCaseCount(project) {
  if (!project || typeof project !== 'object') {
    return null;
  }

  const suites = Array.isArray(project.testSuites) ? project.testSuites : null;
  const derivedSuiteCaseCount = suites
    ? suites.reduce((sum, s) => sum + countSuiteTestCases(s), 0)
    : null;

  if (derivedSuiteCaseCount !== null && derivedSuiteCaseCount > 0) {
    return derivedSuiteCaseCount;
  }

  if (typeof project.testCaseCount === 'number') {
    return project.testCaseCount;
  }

  if (derivedSuiteCaseCount !== null) {
    return derivedSuiteCaseCount;
  }

  return null;
}

/**
 * Coordinates profile editor updates with authoritative active project persistence
 * (`PATCH /api/projects/:id`).
 *
 * - Validates `projectName` (non-empty, max 120 characters, no prohibited keys)
 * - Persists `name` (and `version` when `targetVersion` changes) to the backend
 *   when an active project is selected
 * - Properly handles validation errors (HTTP 400), authentication expiry (HTTP 401),
 *   network failures (offline queue 202 fallback), and HTTP 409 optimistic
 *   concurrency conflicts
 * - Keeps the returned `profile` state synchronized with authoritative server data
 *
 * @param {object} params
 * @param {object} params.updates
 * @param {object} [params.currentProfile]
 * @param {object | null} [params.selectedProject]
 * @param {string | null} [params.selectedProjectId]
 * @param {Function} [params.updateProjectFn]
 * @param {Function} [params.getProjectFn]
 * @param {object} [params.apiOptions]
 */
export async function persistProfileProjectChanges({
  updates,
  currentProfile = {},
  selectedProject = null,
  selectedProjectId = null,
  updateProjectFn = null,
  getProjectFn = null,
  apiOptions = {},
} = {}) {
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_PAYLOAD',
      profile: { ...currentProfile },
      project: selectedProject,
      persistedToBackend: false,
      error: 'Profile update payload must be a valid object.',
    };
  }

  if (containsProhibitedKeys(updates)) {
    return {
      ok: false,
      status: 400,
      code: 'PROHIBITED_KEYS',
      profile: { ...currentProfile },
      project: selectedProject,
      persistedToBackend: false,
      error: 'Profile update contains prohibited object keys.',
    };
  }

  const activeId =
    (typeof selectedProjectId === 'string' && selectedProjectId.trim()) ||
    (selectedProject &&
      typeof selectedProject.id === 'string' &&
      selectedProject.id.trim()) ||
    (selectedProject && selectedProject._id
      ? String(selectedProject._id).trim()
      : '');

  const hasProjectNameField = Object.prototype.hasOwnProperty.call(
    updates,
    'projectName'
  );
  const hasTargetVersionField = Object.prototype.hasOwnProperty.call(
    updates,
    'targetVersion'
  );

  const rawProjectName = hasProjectNameField
    ? typeof updates.projectName === 'string'
      ? updates.projectName.trim()
      : ''
    : selectedProject && typeof selectedProject.name === 'string'
    ? selectedProject.name.trim()
    : typeof currentProfile.projectName === 'string'
    ? currentProfile.projectName.trim()
    : '';

  if (hasProjectNameField) {
    if (!rawProjectName) {
      return {
        ok: false,
        status: 400,
        code: 'VALIDATION_ERROR',
        profile: {
          ...currentProfile,
          projectName:
            (selectedProject && selectedProject.name) ||
            currentProfile.projectName ||
            '',
        },
        project: selectedProject,
        persistedToBackend: false,
        error: 'Project name is required and cannot be empty.',
      };
    }

    if (rawProjectName.length > 120) {
      return {
        ok: false,
        status: 400,
        code: 'VALIDATION_ERROR',
        profile: {
          ...currentProfile,
          projectName:
            (selectedProject && selectedProject.name) ||
            currentProfile.projectName ||
            '',
        },
        project: selectedProject,
        persistedToBackend: false,
        error: 'Project name cannot exceed 120 characters.',
      };
    }
  }

  const nextLocalPrefs = {
    ...currentProfile,
    testerName:
      typeof updates.testerName === 'string' && updates.testerName.trim()
        ? updates.testerName.trim()
        : currentProfile.testerName || 'QA Engineer',
    role:
      typeof updates.role === 'string' && updates.role.trim()
        ? updates.role.trim()
        : currentProfile.role || 'QA Analyst',
    defaultDevice:
      typeof updates.defaultDevice === 'string' && updates.defaultDevice.trim()
        ? updates.defaultDevice.trim()
        : currentProfile.defaultDevice || 'Android Device',
    defaultBuild:
      typeof updates.defaultBuild === 'string' && updates.defaultBuild.trim()
        ? updates.defaultBuild.trim()
        : currentProfile.defaultBuild || '1.0.0',
  };

  if (typeof updates.defaultEnvironment === 'string' && updates.defaultEnvironment.trim()) {
    nextLocalPrefs.defaultEnvironment = updates.defaultEnvironment.trim();
  }

  const nextTargetVersion = hasTargetVersionField
    ? typeof updates.targetVersion === 'string' && updates.targetVersion.trim()
      ? updates.targetVersion.trim()
      : (selectedProject && selectedProject.version) ||
        currentProfile.targetVersion ||
        'v1.0.0'
    : (selectedProject && selectedProject.version) ||
      currentProfile.targetVersion ||
      'v1.0.0';

  // If no active project is selected, update local profile preferences only
  if (!activeId) {
    const localOnlyProfile = {
      ...nextLocalPrefs,
      projectName: rawProjectName || currentProfile.projectName || 'No Project Selected',
      targetVersion: nextTargetVersion,
    };
    return {
      ok: true,
      status: 200,
      persistedToBackend: false,
      queuedOffline: false,
      isConflict: false,
      profile: localOnlyProfile,
      project: null,
      error: null,
    };
  }

  const currentServerName =
    selectedProject && typeof selectedProject.name === 'string'
      ? selectedProject.name.trim()
      : '';
  const currentServerVersion =
    selectedProject && typeof selectedProject.version === 'string'
      ? selectedProject.version.trim()
      : '';

  const metadataPatch = {};
  if (
    hasProjectNameField &&
    rawProjectName &&
    rawProjectName !== currentServerName
  ) {
    metadataPatch.name = rawProjectName;
  }
  if (
    hasTargetVersionField &&
    nextTargetVersion &&
    nextTargetVersion !== currentServerVersion
  ) {
    metadataPatch.version = nextTargetVersion;
  }

  // If project metadata did not change (only local tester/device preferences changed)
  if (Object.keys(metadataPatch).length === 0) {
    const syncedProfile = {
      ...nextLocalPrefs,
      projectName: currentServerName || rawProjectName,
      targetVersion: currentServerVersion || nextTargetVersion,
    };
    return {
      ok: true,
      status: 200,
      persistedToBackend: false,
      queuedOffline: false,
      isConflict: false,
      profile: syncedProfile,
      project: selectedProject,
      error: null,
    };
  }

  const effectiveUpdateFn =
    typeof updateProjectFn === 'function'
      ? updateProjectFn
      : (projId, patchPayload, opts) =>
          updateProjectMetadata(projId, patchPayload, opts);

  const baselineUpdatedAt =
    (selectedProject &&
      (selectedProject._serverUpdatedAt || selectedProject.updatedAt)) ||
    undefined;

  const patchResult = await effectiveUpdateFn(activeId, metadataPatch, {
    ...apiOptions,
    ...(baselineUpdatedAt ? { expectedUpdatedAt: baselineUpdatedAt } : {}),
  });

  if (patchResult && patchResult.ok) {
    const updatedProj = patchResult.project || {
      ...(selectedProject || {}),
      id: activeId,
      ...metadataPatch,
    };
    const authoritativeProfile = {
      ...nextLocalPrefs,
      projectName: updatedProj.name || rawProjectName,
      targetVersion: updatedProj.version || nextTargetVersion,
    };

    return {
      ok: true,
      status: patchResult.status || 200,
      persistedToBackend: !patchResult.queuedOffline,
      queuedOffline: Boolean(patchResult.queuedOffline),
      isConflict: false,
      profile: authoritativeProfile,
      project: updatedProj,
      operation: patchResult.operation || null,
      error: null,
    };
  }

  const status = (patchResult && patchResult.status) || 0;
  const isConflict = Boolean(
    (patchResult && patchResult.isConflict) || status === 409
  );
  const isAuthExpired = status === 401;
  const isNetworkError = Boolean(
    (patchResult && patchResult.isNetworkError) || status === 0
  );

  // On HTTP 409 conflict, fetch or use the authoritative server project so local UI stays in sync
  let authoritativeServerProject = selectedProject;
  if (isConflict && typeof getProjectFn === 'function') {
    try {
      const refreshed = await getProjectFn(activeId);
      if (refreshed && refreshed.ok && refreshed.project) {
        authoritativeServerProject = refreshed.project;
      }
    } catch {
      // Preserve existing selectedProject if secondary refresh fails
    }
  }

  const revertedProfile = {
    ...nextLocalPrefs,
    projectName:
      (authoritativeServerProject && authoritativeServerProject.name) ||
      currentServerName ||
      currentProfile.projectName ||
      '',
    targetVersion:
      (authoritativeServerProject && authoritativeServerProject.version) ||
      currentServerVersion ||
      currentProfile.targetVersion ||
      'v1.0.0',
  };

  return {
    ok: false,
    status,
    code: isConflict
      ? 'CONFLICT'
      : isAuthExpired
      ? 'AUTH_EXPIRED'
      : isNetworkError
      ? 'NETWORK_ERROR'
      : 'UPDATE_FAILED',
    persistedToBackend: false,
    queuedOffline: false,
    isConflict,
    isAuthExpired,
    isNetworkError,
    currentUpdatedAt: (patchResult && patchResult.currentUpdatedAt) || null,
    expectedUpdatedAt:
      (patchResult && patchResult.expectedUpdatedAt) ||
      baselineUpdatedAt ||
      null,
    profile: revertedProfile,
    project: authoritativeServerProject,
    error:
      (patchResult && patchResult.error) ||
      (isConflict
        ? 'Conflict detected: This project was modified on the server. Reloaded latest server project state.'
        : isAuthExpired
        ? 'Your session has expired. Please sign in again to save project changes.'
        : 'Failed to persist project settings to the server.'),
  };
}

export const projectService = {
  fetchProjects,
  fetchProjectById,
  createProject,
  updateProjectPut,
  updateProjectMetadata,
  updateProjectStatus,
  updateProjectData,
  deleteProject,
  normalizeProject,
  buildDefaultTestPlan,
  containsProhibitedKeys,
  extractSuiteTestCases,
  countSuiteTestCases,
  computeProjectTestCaseCount,
  persistProfileProjectChanges,
  PROJECT_STATUSES,
};

export default projectService;


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
    testSuites: Array.isArray(rawProject.testSuites) ? rawProject.testSuites : [],
    executions: Array.isArray(rawProject.executions) ? rawProject.executions : [],
    defects: Array.isArray(rawProject.defects) ? rawProject.defects : [],
  };
}

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

export const projectService = {
  fetchProjects,
  fetchProjectById,
  createProject,
  updateProjectPut,
  updateProjectMetadata,
  updateProjectStatus,
  deleteProject,
  normalizeProject,
  PROJECT_STATUSES,
};

export default projectService;

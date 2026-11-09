/**
 * Qavora Android — Standalone QA Checklists Service (Phase 3C)
 *
 * Connects the Qavora Android application to the Qavora Web Express + MongoDB
 * `/api/checklists` endpoints while reusing `apiClient.js` (cookie jar, CSRF
 * protection, trusted Origin headers, and 401 session-expiry listeners).
 *
 * Verified Backend Endpoints:
 * - `GET /api/checklists`        : Fetch all checklists owned by the authenticated user
 * - `GET /api/checklists/:id`    : Fetch a single user-owned checklist by ID
 * - `POST /api/checklists`       : Create a new checklist
 * - `PATCH /api/checklists/:id`  : Partially update checklist metadata or items
 * - `PUT /api/checklists/:id`    : Replace/update checklist document
 * - `DELETE /api/checklists/:id` : Delete a user-owned checklist
 *
 * Security & Ownership Guarantees:
 * - Strict payload key sanitization rejecting `$`-prefixed MongoDB operators,
 *   dotted keys, and prototype-pollution keys (`__proto__`, `constructor`, `prototype`).
 * - Strict per-user ownership isolation (`userId` verification) and project
 *   association filtering (`projectId` / `sourceChecklistId`).
 * - Per-user offline cache (`@qavora_offline_checklists_cache_v1:<userId>`) so User A's
 *   checklists are never visible to User B.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  apiGet,
  apiPost,
  apiPut,
  apiPatch,
  apiDelete,
  ApiClientError,
} from './apiClient.js';
import { containsProhibitedKeys } from './projectService.js';

export const CHECKLISTS_ENDPOINT = '/api/checklists';
export const OFFLINE_CHECKLISTS_CACHE_PREFIX =
  '@qavora_offline_checklists_cache_v1:';

export const CHECKLIST_CATEGORIES = [
  'Release Readiness',
  'Smoke & Sanity',
  'Regression',
  'Security & Auth',
  'API & Integration',
  'Mobile Android',
  'Accessibility & UI',
  'Performance',
  'General QA',
];

export const CHECKLIST_PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];

export const CHECKLIST_STATUSES = [
  'Not Started',
  'In Progress',
  'Completed',
  'Archived',
];

export const CHECKLIST_STARTER_TEMPLATES = [
  {
    id: 'tpl_release_readiness',
    name: 'Release Readiness Sign-Off',
    category: 'Release Readiness',
    priority: 'Critical',
    description:
      'Pre-release verification checklist covering build integrity, regression pass rate, critical defects, and rollback readiness.',
    items: [
      {
        title: 'All P0/Critical test suites executed with 100% pass rate',
        category: 'Release Readiness',
        priority: 'Critical',
      },
      {
        title: 'Zero open Critical or High severity defects in release scope',
        category: 'Release Readiness',
        priority: 'Critical',
      },
      {
        title: 'Database migration scripts and recovery snapshot verified',
        category: 'Release Readiness',
        priority: 'High',
      },
      {
        title: 'API backward compatibility and CSRF/session headers validated',
        category: 'Security & Auth',
        priority: 'High',
      },
      {
        title: 'Release notes, build version, and rollback runbook approved',
        category: 'Release Readiness',
        priority: 'Medium',
      },
    ],
  },
  {
    id: 'tpl_mobile_android_smoke',
    name: 'Android Build Smoke & Sanity',
    category: 'Mobile Android',
    priority: 'High',
    description:
      'Essential native Android verification for authentication, offline reconnection sync, file export/import, and theme rendering.',
    items: [
      {
        title: 'Cold start launches cleanly into authenticated workspace or sign-in',
        category: 'Mobile Android',
        priority: 'Critical',
      },
      {
        title: 'Session cookie and CSRF token persist across app restarts',
        category: 'Security & Auth',
        priority: 'Critical',
      },
      {
        title: 'Offline mutations queue locally and auto-sync when Wi-Fi/cellular returns',
        category: 'Mobile Android',
        priority: 'High',
      },
      {
        title: 'Native JSON backup export and .json document picker import succeed',
        category: 'Mobile Android',
        priority: 'High',
      },
      {
        title: 'Light and Dark themes maintain contrast across all screens and modals',
        category: 'Accessibility & UI',
        priority: 'Medium',
      },
    ],
  },
  {
    id: 'tpl_security_auth_audit',
    name: 'Security, Auth & User Isolation Audit',
    category: 'Security & Auth',
    priority: 'Critical',
    description:
      'Security verification checklist for authentication cookies, CSRF validation, NoSQL injection prevention, and tenant isolation.',
    items: [
      {
        title: 'State-changing POST/PUT/PATCH/DELETE requests enforce X-CSRF-Token',
        category: 'Security & Auth',
        priority: 'Critical',
      },
      {
        title: 'Cross-user resource access returns 404/403 with zero data leakage',
        category: 'Security & Auth',
        priority: 'Critical',
      },
      {
        title: 'Payloads containing $ operators or __proto__ keys are rejected with HTTP 400',
        category: 'Security & Auth',
        priority: 'High',
      },
      {
        title: 'HTTP 401 response clears cookies and transitions immediately to Auth screen',
        category: 'Security & Auth',
        priority: 'High',
      },
    ],
  },
];

const ALLOWED_CHECKLIST_CREATE_FIELDS = new Set([
  'id',
  'title',
  'description',
  'category',
  'priority',
  'status',
  'projectId',
  'projectName',
  'environment',
  'targetRelease',
  'tags',
  'items',
  'sourceTemplateId',
  'createdAt',
  'updatedAt',
]);

const ALLOWED_CHECKLIST_UPDATE_FIELDS = new Set([
  'title',
  'description',
  'category',
  'priority',
  'status',
  'projectId',
  'projectName',
  'environment',
  'targetRelease',
  'tags',
  'items',
  'promotedProjectId',
  'promotedAt',
  'updatedAt',
  'expectedUpdatedAt',
]);

let customStorageAdapter = null;

/**
 * Allows tests to inject a custom storage adapter while using AsyncStorage by default.
 *
 * @param {object | null} adapter
 */
export function setChecklistStorageAdapter(adapter) {
  customStorageAdapter = adapter;
}

function getStorage() {
  return customStorageAdapter || AsyncStorage;
}

/**
 * Returns the per-user AsyncStorage key for cached checklists.
 *
 * @param {string} userId
 * @returns {string | null}
 */
export function getChecklistCacheKey(userId) {
  const cleanUser = userId ? String(userId).trim() : '';
  if (!cleanUser) {
    return null;
  }
  return `${OFFLINE_CHECKLISTS_CACHE_PREFIX}${cleanUser}`;
}

/**
 * Validates and encodes a checklist ID for URL path interpolation.
 *
 * @param {string} checklistId
 * @returns {string}
 */
export function buildChecklistResourcePath(checklistId) {
  const cleanId = typeof checklistId === 'string' ? checklistId.trim() : '';
  if (!cleanId) {
    throw new ApiClientError({
      message: 'A valid checklist ID is required.',
      code: 'INVALID_CHECKLIST_ID',
      status: 400,
    });
  }
  if (cleanId.includes('/') || cleanId.includes('\\') || cleanId.includes('..')) {
    throw new ApiClientError({
      message: 'Checklist ID contains invalid path characters.',
      code: 'INVALID_CHECKLIST_ID',
      status: 400,
    });
  }
  return `${CHECKLISTS_ENDPOINT}/${encodeURIComponent(cleanId)}`;
}

/**
 * Normalizes a single checklist item record.
 * Supports `title` / `text` / `label` and `completed` / `checked` / `done` / `status`
 * so items created on either Qavora Web or Qavora Android work identically.
 *
 * @param {any} rawItem
 * @param {number} [index=0]
 * @returns {object | null}
 */
export function normalizeChecklistItem(rawItem, index = 0) {
  if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) {
    return null;
  }

  const rawTitle =
    typeof rawItem.title === 'string' && rawItem.title.trim()
      ? rawItem.title.trim()
      : typeof rawItem.text === 'string' && rawItem.text.trim()
      ? rawItem.text.trim()
      : typeof rawItem.label === 'string' && rawItem.label.trim()
      ? rawItem.label.trim()
      : '';

  if (!rawTitle) {
    return null;
  }

  const rawId =
    rawItem.id !== undefined && rawItem.id !== null && String(rawItem.id).trim() !== ''
      ? String(rawItem.id).trim()
      : rawItem._id !== undefined &&
        rawItem._id !== null &&
        String(rawItem._id).trim() !== ''
      ? String(rawItem._id).trim()
      : `chk_item_${index + 1}`;

  const isCompleted =
    typeof rawItem.completed === 'boolean'
      ? rawItem.completed
      : typeof rawItem.checked === 'boolean'
      ? rawItem.checked
      : typeof rawItem.done === 'boolean'
      ? rawItem.done
      : String(rawItem.status || '').toLowerCase() === 'completed' ||
        String(rawItem.status || '').toLowerCase() === 'done' ||
        String(rawItem.status || '').toLowerCase() === 'passed';

  const nowIso = new Date().toISOString();
  const normalizedStatus = isCompleted
    ? 'Completed'
    : rawItem.status === 'Skipped' || rawItem.status === 'Blocked'
    ? rawItem.status
    : 'Pending';

  return {
    id: rawId,
    title: rawTitle,
    text: rawTitle,
    completed: Boolean(isCompleted),
    checked: Boolean(isCompleted),
    status: normalizedStatus,
    category:
      typeof rawItem.category === 'string' && rawItem.category.trim()
        ? rawItem.category.trim()
        : 'General QA',
    priority: CHECKLIST_PRIORITIES.includes(rawItem.priority)
      ? rawItem.priority
      : 'Medium',
    notes: typeof rawItem.notes === 'string' ? rawItem.notes.trim() : '',
    assignee:
      typeof rawItem.assignee === 'string' ? rawItem.assignee.trim() : '',
    completedAt: isCompleted
      ? rawItem.completedAt || rawItem.updatedAt || nowIso
      : null,
    updatedAt:
      typeof rawItem.updatedAt === 'string' && rawItem.updatedAt.trim()
        ? rawItem.updatedAt.trim()
        : nowIso,
  };
}

/**
 * Computes checklist item completion and progress metrics from an items array.
 *
 * @param {Array<object>} items
 * @returns {{
 *   totalItems: number,
 *   completedItems: number,
 *   pendingItems: number,
 *   completionRate: number,
 *   derivedStatus: 'Not Started' | 'In Progress' | 'Completed'
 * }}
 */
export function computeChecklistProgress(items = []) {
  const safeItems = Array.isArray(items)
    ? items.map((it, idx) => normalizeChecklistItem(it, idx)).filter(Boolean)
    : [];

  const totalItems = safeItems.length;
  const completedItems = safeItems.filter((it) => it.completed).length;
  const pendingItems = Math.max(0, totalItems - completedItems);
  const completionRate =
    totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;

  let derivedStatus = 'Not Started';
  if (totalItems > 0 && completedItems === totalItems) {
    derivedStatus = 'Completed';
  } else if (completedItems > 0) {
    derivedStatus = 'In Progress';
  }

  return {
    totalItems,
    completedItems,
    pendingItems,
    completionRate,
    derivedStatus,
  };
}

/**
 * Normalizes a checklist document from the backend or local cache into a
 * consistent Qavora checklist record with accurate derived progress metrics.
 *
 * @param {any} raw
 * @returns {object | null}
 */
export function normalizeChecklistRecord(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const rawId =
    raw.id !== undefined && raw.id !== null && String(raw.id).trim() !== ''
      ? String(raw.id).trim()
      : raw._id !== undefined && raw._id !== null && String(raw._id).trim() !== ''
      ? String(raw._id).trim()
      : '';

  const rawTitle =
    typeof raw.title === 'string' && raw.title.trim()
      ? raw.title.trim()
      : typeof raw.name === 'string' && raw.name.trim()
      ? raw.name.trim()
      : '';

  if (!rawId && !rawTitle) {
    return null;
  }

  const id = rawId || `chk_${Date.now()}`;
  const title = rawTitle || 'Untitled Checklist';

  const rawItems = Array.isArray(raw.items)
    ? raw.items
    : Array.isArray(raw.checklistItems)
    ? raw.checklistItems
    : Array.isArray(raw.tasks)
    ? raw.tasks
    : [];

  const seenItemIds = new Set();
  const normalizedItems = rawItems
    .map((item, idx) => normalizeChecklistItem(item, idx))
    .filter(Boolean)
    .map((item, idx) => {
      let itemId = item.id;
      if (seenItemIds.has(itemId)) {
        itemId = `${itemId}_${idx + 1}`;
      }
      seenItemIds.add(itemId);
      return {
        ...item,
        id: itemId,
      };
    });

  const progress = computeChecklistProgress(normalizedItems);

  let status =
    typeof raw.status === 'string' && CHECKLIST_STATUSES.includes(raw.status.trim())
      ? raw.status.trim()
      : progress.derivedStatus;

  // Keep status synchronized with item completion unless explicitly Archived
  if (status !== 'Archived') {
    if (progress.totalItems > 0 && progress.completedItems === progress.totalItems) {
      status = 'Completed';
    } else if (progress.completedItems > 0 && status === 'Not Started') {
      status = 'In Progress';
    } else if (
      progress.totalItems > 0 &&
      progress.completedItems === 0 &&
      status === 'Completed'
    ) {
      status = 'Not Started';
    }
  }

  const rawTags = Array.isArray(raw.tags)
    ? raw.tags
        .filter((t) => typeof t === 'string' && t.trim())
        .map((t) => t.trim())
    : [];

  const projectId =
    raw.projectId !== undefined &&
    raw.projectId !== null &&
    String(raw.projectId).trim() !== ''
      ? String(raw.projectId).trim()
      : null;

  return {
    id,
    userId:
      raw.userId !== undefined && raw.userId !== null
        ? String(raw.userId).trim()
        : null,
    projectId,
    projectName:
      typeof raw.projectName === 'string' ? raw.projectName.trim() : '',
    title,
    description:
      typeof raw.description === 'string' ? raw.description.trim() : '',
    category:
      typeof raw.category === 'string' && raw.category.trim()
        ? raw.category.trim()
        : 'General QA',
    priority: CHECKLIST_PRIORITIES.includes(raw.priority)
      ? raw.priority
      : 'Medium',
    status,
    environment:
      typeof raw.environment === 'string' && raw.environment.trim()
        ? raw.environment.trim()
        : 'Staging',
    targetRelease:
      typeof raw.targetRelease === 'string' ? raw.targetRelease.trim() : '',
    tags: rawTags,
    items: normalizedItems,
    totalItems: progress.totalItems,
    completedItems: progress.completedItems,
    pendingItems: progress.pendingItems,
    completionRate: progress.completionRate,
    promotedProjectId:
      raw.promotedProjectId !== undefined && raw.promotedProjectId !== null
        ? String(raw.promotedProjectId)
        : null,
    promotedAt: raw.promotedAt || null,
    createdAt: raw.createdAt || null,
    updatedAt: raw.updatedAt || raw.createdAt || null,
  };
}

/**
 * Extracts a list of normalized checklists from a backend API response payload.
 * Handles `{ checklists: [...] }`, `{ data: [...] }`, or a top-level array `[...]`.
 *
 * @param {any} payload
 * @returns {Array<object>}
 */
export function extractChecklistsList(payload) {
  let rawList = [];
  if (Array.isArray(payload)) {
    rawList = payload;
  } else if (payload && typeof payload === 'object') {
    if (Array.isArray(payload.checklists)) {
      rawList = payload.checklists;
    } else if (Array.isArray(payload.data)) {
      rawList = payload.data;
    } else if (Array.isArray(payload.items) && !payload.title) {
      rawList = payload.items;
    }
  }
  return rawList.map(normalizeChecklistRecord).filter(Boolean);
}

/**
 * Extracts a single normalized checklist from a backend API response payload.
 *
 * @param {any} payload
 * @returns {object | null}
 */
export function extractSingleChecklist(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  if (payload.checklist && typeof payload.checklist === 'object') {
    return normalizeChecklistRecord(payload.checklist);
  }
  if (
    payload.data &&
    typeof payload.data === 'object' &&
    !Array.isArray(payload.data)
  ) {
    return normalizeChecklistRecord(payload.data);
  }
  return normalizeChecklistRecord(payload);
}

/**
 * Strictly filters a list of checklists to only those owned by `currentUserId`
 * (or records without an explicit `userId` returned by an authenticated session
 * endpoint, which are then stamped with `currentUserId`). Rejects any checklist
 * whose `userId` belongs to a different user.
 *
 * @param {Array<object>} checklists
 * @param {string | null | undefined} currentUserId
 * @returns {Array<object>}
 */
export function filterChecklistsForUser(checklists, currentUserId) {
  const safeList = Array.isArray(checklists) ? checklists : [];
  const cleanUserId = currentUserId ? String(currentUserId).trim() : '';

  if (!cleanUserId) {
    return safeList;
  }

  return safeList
    .filter((chk) => {
      if (!chk || typeof chk !== 'object') return false;
      if (chk.userId && String(chk.userId).trim() !== cleanUserId) {
        return false;
      }
      return true;
    })
    .map((chk) => ({
      ...chk,
      userId: chk.userId || cleanUserId,
    }));
}

/**
 * Filters checklists by project scope (`projectId` or project's `sourceChecklistId`).
 * Prevents cross-project data leakage when viewing project-scoped checklists.
 *
 * @param {Array<object>} checklists
 * @param {object} [filterOptions]
 * @param {string | null} [filterOptions.projectId]
 * @param {string | null} [filterOptions.sourceChecklistId]
 * @param {boolean} [filterOptions.includeUnassigned=false]
 * @returns {Array<object>}
 */
export function filterChecklistsByProject(
  checklists,
  {
    projectId = null,
    sourceChecklistId = null,
    includeUnassigned = false,
  } = {}
) {
  const safeList = Array.isArray(checklists) ? checklists : [];
  const cleanProjectId = projectId ? String(projectId).trim() : '';
  const cleanSourceId = sourceChecklistId ? String(sourceChecklistId).trim() : '';

  if (!cleanProjectId && !cleanSourceId) {
    return safeList;
  }

  return safeList.filter((chk) => {
    if (!chk || typeof chk !== 'object') return false;
    const chkProjId = chk.projectId ? String(chk.projectId).trim() : '';
    const chkPromotedProjId = chk.promotedProjectId
      ? String(chk.promotedProjectId).trim()
      : '';

    if (cleanProjectId && (chkProjId === cleanProjectId || chkPromotedProjId === cleanProjectId)) {
      return true;
    }
    if (cleanSourceId && String(chk.id) === cleanSourceId) {
      return true;
    }
    if (includeUnassigned && !chkProjId) {
      return true;
    }
    return false;
  });
}

/**
 * Validates and sanitizes a checklist creation payload before sending to `POST /api/checklists`.
 *
 * @param {object} input
 * @returns {object}
 */
export function buildCreateChecklistPayload(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ApiClientError({
      message: 'Checklist payload must be a valid JSON object.',
      code: 'VALIDATION_ERROR',
      status: 400,
    });
  }

  if (containsProhibitedKeys(input)) {
    throw new ApiClientError({
      message: 'Checklist payload contains prohibited operator or prototype keys.',
      code: 'PROHIBITED_KEY',
      status: 400,
    });
  }

  const rawTitle =
    typeof input.title === 'string'
      ? input.title.trim()
      : typeof input.name === 'string'
      ? input.name.trim()
      : '';

  if (!rawTitle) {
    throw new ApiClientError({
      message: 'Checklist title is required.',
      code: 'VALIDATION_ERROR',
      status: 400,
    });
  }

  if (rawTitle.length > 200) {
    throw new ApiClientError({
      message: 'Checklist title cannot exceed 200 characters.',
      code: 'VALIDATION_ERROR',
      status: 400,
    });
  }

  const sanitized = {};
  Object.keys(input).forEach((key) => {
    if (ALLOWED_CHECKLIST_CREATE_FIELDS.has(key) && input[key] !== undefined) {
      sanitized[key] = input[key];
    }
  });

  const nowIso = new Date().toISOString();
  const normalizedItems = (Array.isArray(input.items) ? input.items : [])
    .map((item, idx) => normalizeChecklistItem(item, idx))
    .filter(Boolean);

  const progress = computeChecklistProgress(normalizedItems);

  sanitized.id =
    typeof sanitized.id === 'string' && sanitized.id.trim()
      ? sanitized.id.trim()
      : `chk_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  sanitized.title = rawTitle;
  sanitized.description =
    typeof sanitized.description === 'string'
      ? sanitized.description.trim()
      : '';
  sanitized.category =
    typeof sanitized.category === 'string' && sanitized.category.trim()
      ? sanitized.category.trim()
      : 'General QA';
  sanitized.priority = CHECKLIST_PRIORITIES.includes(sanitized.priority)
    ? sanitized.priority
    : 'Medium';
  sanitized.environment =
    typeof sanitized.environment === 'string' && sanitized.environment.trim()
      ? sanitized.environment.trim()
      : 'Staging';
  sanitized.targetRelease =
    typeof sanitized.targetRelease === 'string'
      ? sanitized.targetRelease.trim()
      : '';
  sanitized.projectId =
    sanitized.projectId !== undefined &&
    sanitized.projectId !== null &&
    String(sanitized.projectId).trim() !== ''
      ? String(sanitized.projectId).trim()
      : null;
  sanitized.projectName =
    typeof sanitized.projectName === 'string'
      ? sanitized.projectName.trim()
      : '';
  sanitized.tags = Array.isArray(sanitized.tags)
    ? sanitized.tags
        .filter((t) => typeof t === 'string' && t.trim())
        .map((t) => t.trim())
    : [];
  sanitized.items = normalizedItems;
  sanitized.status =
    typeof sanitized.status === 'string' &&
    CHECKLIST_STATUSES.includes(sanitized.status)
      ? sanitized.status
      : progress.derivedStatus;
  sanitized.totalItems = progress.totalItems;
  sanitized.completedItems = progress.completedItems;
  sanitized.pendingItems = progress.pendingItems;
  sanitized.completionRate = progress.completionRate;
  sanitized.createdAt = sanitized.createdAt || nowIso;
  sanitized.updatedAt = nowIso;

  return sanitized;
}

/**
 * Validates and sanitizes a checklist update payload before sending to
 * `PATCH /api/checklists/:id` or `PUT /api/checklists/:id`.
 *
 * @param {object} updates
 * @returns {object}
 */
export function buildUpdateChecklistPayload(updates) {
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    throw new ApiClientError({
      message: 'Checklist update payload must be a valid JSON object.',
      code: 'VALIDATION_ERROR',
      status: 400,
    });
  }

  if (containsProhibitedKeys(updates)) {
    throw new ApiClientError({
      message: 'Checklist update payload contains prohibited operator or prototype keys.',
      code: 'PROHIBITED_KEY',
      status: 400,
    });
  }

  if (updates.title !== undefined) {
    const cleanTitle =
      typeof updates.title === 'string' ? updates.title.trim() : '';
    if (!cleanTitle) {
      throw new ApiClientError({
        message: 'Checklist title cannot be empty.',
        code: 'VALIDATION_ERROR',
        status: 400,
      });
    }
    if (cleanTitle.length > 200) {
      throw new ApiClientError({
        message: 'Checklist title cannot exceed 200 characters.',
        code: 'VALIDATION_ERROR',
        status: 400,
      });
    }
  }

  const sanitized = {};
  Object.keys(updates).forEach((key) => {
    if (ALLOWED_CHECKLIST_UPDATE_FIELDS.has(key) && updates[key] !== undefined) {
      sanitized[key] = updates[key];
    }
  });

  if (typeof sanitized.title === 'string') {
    sanitized.title = sanitized.title.trim();
  }
  if (typeof sanitized.description === 'string') {
    sanitized.description = sanitized.description.trim();
  }
  if (typeof sanitized.category === 'string') {
    sanitized.category = sanitized.category.trim() || 'General QA';
  }
  if (
    sanitized.priority !== undefined &&
    !CHECKLIST_PRIORITIES.includes(sanitized.priority)
  ) {
    sanitized.priority = 'Medium';
  }

  if (Array.isArray(sanitized.items)) {
    const normalizedItems = sanitized.items
      .map((item, idx) => normalizeChecklistItem(item, idx))
      .filter(Boolean);
    const progress = computeChecklistProgress(normalizedItems);
    sanitized.items = normalizedItems;
    sanitized.totalItems = progress.totalItems;
    sanitized.completedItems = progress.completedItems;
    sanitized.pendingItems = progress.pendingItems;
    sanitized.completionRate = progress.completionRate;

    if (sanitized.status !== 'Archived') {
      sanitized.status = progress.derivedStatus;
    }
  }

  sanitized.updatedAt = new Date().toISOString();

  if (Object.keys(sanitized).length === 0) {
    throw new ApiClientError({
      message: 'Checklist update payload must include at least one valid field.',
      code: 'VALIDATION_ERROR',
      status: 400,
    });
  }

  return sanitized;
}

// ============================================================================
// PER-USER OFFLINE CHECKLIST CACHE
// ============================================================================

/**
 * Reads cached checklists for `userId` from AsyncStorage.
 * Strictly verifies `userId` ownership on every cached record.
 *
 * @param {string} userId
 * @returns {Promise<Array<object>>}
 */
export async function getCachedChecklistsForUser(userId) {
  const cleanUser = userId ? String(userId).trim() : '';
  if (!cleanUser) {
    return [];
  }

  const key = getChecklistCacheKey(cleanUser);
  if (!key) {
    return [];
  }

  try {
    const storage = getStorage();
    if (!storage || typeof storage.getItem !== 'function') {
      return [];
    }
    const raw = await storage.getItem(key);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    const records = Array.isArray(parsed)
      ? parsed
      : parsed && Array.isArray(parsed.checklists)
      ? parsed.checklists
      : [];
    const normalized = records.map(normalizeChecklistRecord).filter(Boolean);
    return filterChecklistsForUser(normalized, cleanUser);
  } catch {
    return [];
  }
}

/**
 * Persists a user's normalized checklists list to AsyncStorage under their
 * isolated per-user cache key.
 *
 * @param {Array<object>} checklists
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
export async function cacheChecklistsForUser(checklists, userId) {
  const cleanUser = userId ? String(userId).trim() : '';
  if (!cleanUser) {
    return false;
  }

  const key = getChecklistCacheKey(cleanUser);
  if (!key) {
    return false;
  }

  const owned = filterChecklistsForUser(
    (Array.isArray(checklists) ? checklists : [])
      .map(normalizeChecklistRecord)
      .filter(Boolean),
    cleanUser
  );

  try {
    const storage = getStorage();
    if (storage && typeof storage.setItem === 'function') {
      await storage.setItem(
        key,
        JSON.stringify({
          userId: cleanUser,
          updatedAt: new Date().toISOString(),
          checklists: owned,
        })
      );
      return true;
    }
  } catch {
    // Ignore storage write errors
  }
  return false;
}

/**
 * Clears the cached checklists for `userId`.
 *
 * @param {string} userId
 * @returns {Promise<void>}
 */
export async function clearChecklistCacheForUser(userId) {
  const cleanUser = userId ? String(userId).trim() : '';
  if (!cleanUser) return;
  const key = getChecklistCacheKey(cleanUser);
  if (!key) return;
  try {
    const storage = getStorage();
    if (storage && typeof storage.removeItem === 'function') {
      await storage.removeItem(key);
    }
  } catch {
    // Ignore storage removal errors
  }
}

// ============================================================================
// BACKEND /api/checklists CRUD OPERATIONS
// ============================================================================

/**
 * Fetches all checklists owned by the authenticated user via `GET /api/checklists`.
 *
 * @param {object} [options]
 * @param {string} [options.userId]
 * @param {string} [options.projectId]
 * @param {string} [options.status]
 * @param {string} [options.category]
 * @returns {Promise<{
 *   ok: boolean,
 *   status: number,
 *   checklists: Array<object>,
 *   fromCache?: boolean,
 *   isNetworkError?: boolean,
 *   isUnauthorized?: boolean,
 *   error: string | null
 * }>}
 */
export async function fetchChecklists(options = {}) {
  const { userId, projectId, status, category, ...requestOptions } = options;

  const queryParams = { ...(requestOptions.params || {}) };
  if (projectId) queryParams.projectId = String(projectId).trim();
  if (status && status !== 'All') queryParams.status = String(status).trim();
  if (category && category !== 'All') queryParams.category = String(category).trim();

  try {
    const response = await apiGet(CHECKLISTS_ENDPOINT, {
      ...requestOptions,
      params: Object.keys(queryParams).length > 0 ? queryParams : undefined,
    });

    const extracted = extractChecklistsList(response.data);
    const owned = filterChecklistsForUser(extracted, userId);
    const scoped = projectId
      ? filterChecklistsByProject(owned, { projectId })
      : owned;

    if (userId && !projectId && (!status || status === 'All') && (!category || category === 'All')) {
      await cacheChecklistsForUser(owned, userId);
    }

    return {
      ok: true,
      status: response.status,
      checklists: scoped,
      fromCache: false,
      error: null,
    };
  } catch (err) {
    const isApiErr = err instanceof ApiClientError;
    const httpStatus = isApiErr ? err.status : 0;

    return {
      ok: false,
      status: httpStatus,
      checklists: [],
      fromCache: false,
      isNetworkError: isApiErr ? Boolean(err.isNetworkError) : false,
      isUnauthorized: httpStatus === 401,
      error: (err && err.message) || 'Failed to load checklists.',
    };
  }
}

/**
 * Fetches a single user-owned checklist by ID via `GET /api/checklists/:id`.
 *
 * @param {string} checklistId
 * @param {object} [options]
 * @param {string} [options.userId]
 */
export async function fetchChecklistById(checklistId, options = {}) {
  const { userId, ...requestOptions } = options;

  try {
    const path = buildChecklistResourcePath(checklistId);
    const response = await apiGet(path, requestOptions);
    const checklist = extractSingleChecklist(response.data);

    if (!checklist) {
      return {
        ok: false,
        status: 404,
        checklist: null,
        error: 'Checklist not found or returned an empty response.',
      };
    }

    // Strict user ownership verification
    if (
      userId &&
      checklist.userId &&
      String(checklist.userId).trim() !== String(userId).trim()
    ) {
      return {
        ok: false,
        status: 403,
        checklist: null,
        error: 'Access denied: checklist belongs to another user.',
      };
    }

    return {
      ok: true,
      status: response.status,
      checklist: userId
        ? { ...checklist, userId: checklist.userId || String(userId).trim() }
        : checklist,
      error: null,
    };
  } catch (err) {
    const isApiErr = err instanceof ApiClientError;
    const httpStatus = isApiErr ? err.status : 0;
    return {
      ok: false,
      status: httpStatus,
      checklist: null,
      isNetworkError: isApiErr ? Boolean(err.isNetworkError) : false,
      isUnauthorized: httpStatus === 401,
      error: (err && err.message) || 'Failed to fetch checklist details.',
    };
  }
}

/**
 * Creates a new checklist via `POST /api/checklists`.
 *
 * @param {object} checklistData
 * @param {object} [options]
 * @param {string} [options.userId]
 */
export async function createChecklist(checklistData, options = {}) {
  const { userId, ...requestOptions } = options;

  try {
    const payload = buildCreateChecklistPayload(checklistData);
    const response = await apiPost(CHECKLISTS_ENDPOINT, payload, requestOptions);
    const created =
      extractSingleChecklist(response.data) ||
      normalizeChecklistRecord({
        ...payload,
        userId: userId || null,
      });

    if (
      userId &&
      created.userId &&
      String(created.userId).trim() !== String(userId).trim()
    ) {
      return {
        ok: false,
        status: 403,
        checklist: null,
        error: 'Ownership mismatch in created checklist response.',
      };
    }

    const normalizedCreated = userId
      ? { ...created, userId: created.userId || String(userId).trim() }
      : created;

    return {
      ok: true,
      status: response.status,
      checklist: normalizedCreated,
      error: null,
    };
  } catch (err) {
    const isApiErr = err instanceof ApiClientError;
    const httpStatus = isApiErr ? err.status : 0;
    return {
      ok: false,
      status: httpStatus,
      checklist: null,
      isNetworkError: isApiErr ? Boolean(err.isNetworkError) : false,
      isUnauthorized: httpStatus === 401,
      error: (err && err.message) || 'Failed to create checklist.',
    };
  }
}

/**
 * Updates an existing user-owned checklist via `PATCH /api/checklists/:id`
 * (or `PUT /api/checklists/:id` when `options.method === 'PUT'`).
 *
 * Supports optimistic concurrency via `expectedUpdatedAt` and surfaces HTTP 409
 * conflict responses cleanly.
 *
 * @param {string} checklistId
 * @param {object} updates
 * @param {object} [options]
 * @param {string} [options.userId]
 * @param {'PATCH' | 'PUT'} [options.method='PATCH']
 */
export async function updateChecklist(checklistId, updates, options = {}) {
  const { userId, method = 'PATCH', ...requestOptions } = options;

  try {
    const path = buildChecklistResourcePath(checklistId);
    const payload = buildUpdateChecklistPayload(updates);
    const requestFn = String(method).toUpperCase() === 'PUT' ? apiPut : apiPatch;
    const response = await requestFn(path, payload, requestOptions);

    const updated =
      extractSingleChecklist(response.data) ||
      normalizeChecklistRecord({
        id: String(checklistId).trim(),
        ...payload,
        userId: userId || null,
      });

    if (
      userId &&
      updated.userId &&
      String(updated.userId).trim() !== String(userId).trim()
    ) {
      return {
        ok: false,
        status: 403,
        checklist: null,
        error: 'Access denied: cannot modify another user’s checklist.',
      };
    }

    return {
      ok: true,
      status: response.status,
      checklist: userId
        ? { ...updated, userId: updated.userId || String(userId).trim() }
        : updated,
      error: null,
    };
  } catch (err) {
    const isApiErr = err instanceof ApiClientError;
    const httpStatus = isApiErr ? err.status : 0;
    const isConflict =
      httpStatus === 409 || (isApiErr && err.code === 'CONFLICT');
    const serverChecklist =
      isConflict && err.data
        ? extractSingleChecklist(
            err.data.serverChecklist ||
              err.data.serverRecord ||
              err.data.checklist ||
              null
          )
        : null;

    return {
      ok: false,
      status: httpStatus,
      isConflict,
      serverChecklist,
      checklist: null,
      isNetworkError: isApiErr ? Boolean(err.isNetworkError) : false,
      isUnauthorized: httpStatus === 401,
      error: (err && err.message) || 'Failed to update checklist.',
    };
  }
}

/**
 * Deletes an existing user-owned checklist via `DELETE /api/checklists/:id`.
 *
 * @param {string} checklistId
 * @param {object} [options]
 */
export async function deleteChecklist(checklistId, options = {}) {
  try {
    const path = buildChecklistResourcePath(checklistId);
    const response = await apiDelete(path, options);
    return {
      ok: true,
      status: response.status,
      deletedId: String(checklistId).trim(),
      error: null,
    };
  } catch (err) {
    const isApiErr = err instanceof ApiClientError;
    const httpStatus = isApiErr ? err.status : 0;
    return {
      ok: false,
      status: httpStatus,
      deletedId: null,
      isNetworkError: isApiErr ? Boolean(err.isNetworkError) : false,
      isUnauthorized: httpStatus === 401,
      error: (err && err.message) || 'Failed to delete checklist.',
    };
  }
}

// ============================================================================
// CHECKLIST ITEM MUTATION HELPERS (ADD, TOGGLE, UPDATE, DELETE, BULK TOGGLE)
// ============================================================================

/**
 * Toggles or sets the completion state of a specific checklist item within a
 * checklist and persists the updated checklist via `updateChecklist`.
 *
 * @param {object} checklist
 * @param {string} itemId
 * @param {boolean} [explicitCompleted]
 * @param {object} [options]
 */
export async function toggleChecklistItemCompletion(
  checklist,
  itemId,
  explicitCompleted = undefined,
  options = {}
) {
  const normalized = normalizeChecklistRecord(checklist);
  if (!normalized) {
    return {
      ok: false,
      status: 400,
      checklist: null,
      error: 'A valid checklist is required.',
    };
  }

  const cleanItemId = typeof itemId === 'string' ? itemId.trim() : '';
  if (!cleanItemId) {
    return {
      ok: false,
      status: 400,
      checklist: null,
      error: 'A valid checklist item ID is required.',
    };
  }

  const existingIndex = normalized.items.findIndex((it) => it.id === cleanItemId);
  if (existingIndex === -1) {
    return {
      ok: false,
      status: 404,
      checklist: null,
      error: `Checklist item "${cleanItemId}" not found.`,
    };
  }

  const nowIso = new Date().toISOString();
  const nextItems = normalized.items.map((it) => {
    if (it.id !== cleanItemId) return it;
    const nextCompleted =
      typeof explicitCompleted === 'boolean' ? explicitCompleted : !it.completed;
    return normalizeChecklistItem(
      {
        ...it,
        completed: nextCompleted,
        checked: nextCompleted,
        status: nextCompleted ? 'Completed' : 'Pending',
        completedAt: nextCompleted ? nowIso : null,
        updatedAt: nowIso,
      },
      existingIndex
    );
  });

  const progress = computeChecklistProgress(nextItems);
  const nextStatus =
    normalized.status === 'Archived'
      ? 'Archived'
      : progress.derivedStatus;

  return updateChecklist(
    normalized.id,
    {
      items: nextItems,
      status: nextStatus,
      expectedUpdatedAt: normalized.updatedAt || undefined,
    },
    options
  );
}

/**
 * Adds a new item to a checklist and persists the change to the backend.
 *
 * @param {object} checklist
 * @param {object} newItemInput
 * @param {object} [options]
 */
export async function addChecklistItem(checklist, newItemInput, options = {}) {
  const normalized = normalizeChecklistRecord(checklist);
  if (!normalized) {
    return {
      ok: false,
      status: 400,
      checklist: null,
      error: 'A valid checklist is required.',
    };
  }

  if (!newItemInput || typeof newItemInput !== 'object') {
    return {
      ok: false,
      status: 400,
      checklist: null,
      error: 'Checklist item details are required.',
    };
  }

  if (containsProhibitedKeys(newItemInput)) {
    return {
      ok: false,
      status: 400,
      checklist: null,
      error: 'Checklist item contains prohibited operator or prototype keys.',
    };
  }

  const itemTitle =
    typeof newItemInput.title === 'string'
      ? newItemInput.title.trim()
      : typeof newItemInput.text === 'string'
      ? newItemInput.text.trim()
      : '';

  if (!itemTitle) {
    return {
      ok: false,
      status: 400,
      checklist: null,
      error: 'Checklist item title is required.',
    };
  }

  const nextItem = normalizeChecklistItem(
    {
      ...newItemInput,
      id:
        newItemInput.id ||
        `chk_item_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      title: itemTitle,
      completed: Boolean(newItemInput.completed),
      category: newItemInput.category || normalized.category || 'General QA',
      priority: newItemInput.priority || normalized.priority || 'Medium',
      updatedAt: new Date().toISOString(),
    },
    normalized.items.length
  );

  const nextItems = [...normalized.items, nextItem];
  const progress = computeChecklistProgress(nextItems);
  const nextStatus =
    normalized.status === 'Archived' ? 'Archived' : progress.derivedStatus;

  return updateChecklist(
    normalized.id,
    {
      items: nextItems,
      status: nextStatus,
      expectedUpdatedAt: normalized.updatedAt || undefined,
    },
    options
  );
}

/**
 * Updates an existing checklist item's text, priority, category, or notes and persists.
 *
 * @param {object} checklist
 * @param {string} itemId
 * @param {object} itemUpdates
 * @param {object} [options]
 */
export async function updateChecklistItem(
  checklist,
  itemId,
  itemUpdates,
  options = {}
) {
  const normalized = normalizeChecklistRecord(checklist);
  if (!normalized) {
    return {
      ok: false,
      status: 400,
      checklist: null,
      error: 'A valid checklist is required.',
    };
  }

  const cleanItemId = typeof itemId === 'string' ? itemId.trim() : '';
  const targetIdx = normalized.items.findIndex((it) => it.id === cleanItemId);
  if (targetIdx === -1) {
    return {
      ok: false,
      status: 404,
      checklist: null,
      error: `Checklist item "${cleanItemId}" not found.`,
    };
  }

  if (!itemUpdates || typeof itemUpdates !== 'object') {
    return {
      ok: false,
      status: 400,
      checklist: null,
      error: 'Item update payload must be an object.',
    };
  }

  if (containsProhibitedKeys(itemUpdates)) {
    return {
      ok: false,
      status: 400,
      checklist: null,
      error: 'Checklist item update contains prohibited operator or prototype keys.',
    };
  }

  const currentItem = normalized.items[targetIdx];
  const nextTitle =
    itemUpdates.title !== undefined
      ? String(itemUpdates.title).trim()
      : itemUpdates.text !== undefined
      ? String(itemUpdates.text).trim()
      : currentItem.title;

  if (!nextTitle) {
    return {
      ok: false,
      status: 400,
      checklist: null,
      error: 'Checklist item title cannot be empty.',
    };
  }

  const updatedItem = normalizeChecklistItem(
    {
      ...currentItem,
      ...itemUpdates,
      id: currentItem.id,
      title: nextTitle,
      text: nextTitle,
      updatedAt: new Date().toISOString(),
    },
    targetIdx
  );

  const nextItems = normalized.items.map((it, idx) =>
    idx === targetIdx ? updatedItem : it
  );
  const progress = computeChecklistProgress(nextItems);
  const nextStatus =
    normalized.status === 'Archived' ? 'Archived' : progress.derivedStatus;

  return updateChecklist(
    normalized.id,
    {
      items: nextItems,
      status: nextStatus,
      expectedUpdatedAt: normalized.updatedAt || undefined,
    },
    options
  );
}

/**
 * Deletes an item from a checklist and persists the updated checklist.
 *
 * @param {object} checklist
 * @param {string} itemId
 * @param {object} [options]
 */
export async function deleteChecklistItem(checklist, itemId, options = {}) {
  const normalized = normalizeChecklistRecord(checklist);
  if (!normalized) {
    return {
      ok: false,
      status: 400,
      checklist: null,
      error: 'A valid checklist is required.',
    };
  }

  const cleanItemId = typeof itemId === 'string' ? itemId.trim() : '';
  const exists = normalized.items.some((it) => it.id === cleanItemId);
  if (!exists) {
    return {
      ok: false,
      status: 404,
      checklist: null,
      error: `Checklist item "${cleanItemId}" not found.`,
    };
  }

  const nextItems = normalized.items.filter((it) => it.id !== cleanItemId);
  const progress = computeChecklistProgress(nextItems);
  const nextStatus =
    normalized.status === 'Archived' ? 'Archived' : progress.derivedStatus;

  return updateChecklist(
    normalized.id,
    {
      items: nextItems,
      status: nextStatus,
      expectedUpdatedAt: normalized.updatedAt || undefined,
    },
    options
  );
}

/**
 * Marks all items in a checklist as completed or uncompleted in one operation.
 *
 * @param {object} checklist
 * @param {boolean} completed
 * @param {object} [options]
 */
export async function markAllChecklistItems(
  checklist,
  completed = true,
  options = {}
) {
  const normalized = normalizeChecklistRecord(checklist);
  if (!normalized) {
    return {
      ok: false,
      status: 400,
      checklist: null,
      error: 'A valid checklist is required.',
    };
  }

  const nowIso = new Date().toISOString();
  const nextCompleted = Boolean(completed);
  const nextItems = normalized.items.map((it, idx) =>
    normalizeChecklistItem(
      {
        ...it,
        completed: nextCompleted,
        checked: nextCompleted,
        status: nextCompleted ? 'Completed' : 'Pending',
        completedAt: nextCompleted ? nowIso : null,
        updatedAt: nowIso,
      },
      idx
    )
  );

  const progress = computeChecklistProgress(nextItems);
  const nextStatus =
    normalized.status === 'Archived' ? 'Archived' : progress.derivedStatus;

  return updateChecklist(
    normalized.id,
    {
      items: nextItems,
      status: nextStatus,
      expectedUpdatedAt: normalized.updatedAt || undefined,
    },
    options
  );
}

/**
 * Computes aggregate summary statistics across a collection of checklists.
 *
 * @param {Array<object>} checklists
 */
export function computeChecklistsSummaryMetrics(checklists = []) {
  const safeList = (Array.isArray(checklists) ? checklists : [])
    .map(normalizeChecklistRecord)
    .filter(Boolean);

  let totalChecklists = safeList.length;
  let completedChecklists = 0;
  let inProgressChecklists = 0;
  let notStartedChecklists = 0;
  let totalItems = 0;
  let completedItems = 0;

  safeList.forEach((chk) => {
    totalItems += chk.totalItems || 0;
    completedItems += chk.completedItems || 0;

    if (chk.status === 'Completed' || (chk.totalItems > 0 && chk.completedItems === chk.totalItems)) {
      completedChecklists += 1;
    } else if (chk.status === 'In Progress' || chk.completedItems > 0) {
      inProgressChecklists += 1;
    } else {
      notStartedChecklists += 1;
    }
  });

  const pendingItems = Math.max(0, totalItems - completedItems);
  const overallCompletionRate =
    totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;

  return {
    totalChecklists,
    completedChecklists,
    inProgressChecklists,
    notStartedChecklists,
    totalItems,
    completedItems,
    pendingItems,
    overallCompletionRate,
  };
}

export const checklistService = {
  CHECKLISTS_ENDPOINT,
  CHECKLIST_CATEGORIES,
  CHECKLIST_PRIORITIES,
  CHECKLIST_STATUSES,
  CHECKLIST_STARTER_TEMPLATES,
  setChecklistStorageAdapter,
  getChecklistCacheKey,
  buildChecklistResourcePath,
  normalizeChecklistItem,
  computeChecklistProgress,
  normalizeChecklistRecord,
  extractChecklistsList,
  extractSingleChecklist,
  filterChecklistsForUser,
  filterChecklistsByProject,
  buildCreateChecklistPayload,
  buildUpdateChecklistPayload,
  getCachedChecklistsForUser,
  cacheChecklistsForUser,
  clearChecklistCacheForUser,
  fetchChecklists,
  fetchChecklistById,
  createChecklist,
  updateChecklist,
  deleteChecklist,
  toggleChecklistItemCompletion,
  addChecklistItem,
  updateChecklistItem,
  deleteChecklistItem,
  markAllChecklistItems,
  computeChecklistsSummaryMetrics,
};

export default checklistService;

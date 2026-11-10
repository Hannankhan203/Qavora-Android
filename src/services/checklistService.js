/**
 * Qavora Android — Standalone QA Checklists Service (Phase 3C & MEDIUM-1 Offline Queueing)
 *
 * Connects the Qavora Android application to the Qavora Web Express + MongoDB
 * `/api/checklists` endpoints while reusing `apiClient.js` (cookie jar, CSRF
 * protection, trusted Origin headers, and 401 session-expiry listeners) and
 * `offlineSyncService.js` (durable per-user offline mutation queue, coalescing,
 * reconnect synchronization, retry with backoff, and HTTP 409 conflict resolution).
 *
 * Verified Backend Endpoints:
 * - `GET /api/checklists`        : Fetch all checklists owned by the authenticated user
 * - `GET /api/checklists/:id`    : Fetch a single user-owned checklist by ID
 * - `POST /api/checklists`       : Create a new checklist
 * - `PATCH /api/checklists/:id`  : Partially update checklist metadata or items (with `expectedUpdatedAt`)
 * - `DELETE /api/checklists/:id` : Delete a user-owned checklist
 *
 * Security & Ownership Guarantees:
 * - Strict payload key sanitization rejecting `$`-prefixed MongoDB operators,
 *   dotted keys, and prototype-pollution keys (`__proto__`, `constructor`, `prototype`).
 * - Strict per-user ownership isolation (`userId` verification) and project
 *   association filtering (`projectId` / `sourceChecklistId`).
 * - Per-user offline cache (`@qavora_offline_checklists_cache_v1:<userId>`) and
 *   per-user offline mutation queue (`@qavora_pending_project_ops_v1:<userId>`)
 *   so User A's checklists and pending changes are never visible to User B.
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
import {
  containsProhibitedKeys,
  fetchProjectById,
  updateProjectData,
  buildDefaultTestPlan,
  extractSuiteTestCases,
  normalizeProject,
} from './projectService.js';
import {
  isClientOffline,
  getActiveSyncUser,
  getOfflineSyncStorageAdapter,
  getPendingChecklistOperations,
  queueChecklistMutation,
  queueProjectMutation,
  cacheProjectOffline,
  getCachedProjectsForUser,
} from './offlineSyncService.js';

export const CHECKLISTS_ENDPOINT = '/api/checklists';
export const OFFLINE_CHECKLISTS_CACHE_PREFIX =
  '@qavora_offline_checklists_cache_v1:';
export const CHECKLIST_META_NOTE_ID = '__qavora_checklist_meta__';

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

const ALLOWED_CHECKLIST_CREATE_INPUT_FIELDS = new Set([
  'id',
  'title',
  'name',
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
  'phases',
  'documentNotes',
  'promotedProjectId',
  'promotedAt',
  'completedAt',
  'completedBy',
  'originalPrompt',
  'schemaVersion',
  'sourceTemplateId',
  'createdAt',
  'updatedAt',
]);

const ALLOWED_CHECKLIST_UPDATE_INPUT_FIELDS = new Set([
  'title',
  'name',
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
  'phases',
  'documentNotes',
  'promotedProjectId',
  'promotedAt',
  'completedAt',
  'completedBy',
  'originalPrompt',
  'schemaVersion',
  'updatedAt',
  'expectedUpdatedAt',
  'snapshot',
  'deletedItemIds',
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
  if (customStorageAdapter) {
    return customStorageAdapter;
  }
  const syncAdapter =
    typeof getOfflineSyncStorageAdapter === 'function'
      ? getOfflineSyncStorageAdapter()
      : null;
  if (syncAdapter) {
    return syncAdapter;
  }
  return AsyncStorage;
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
    description:
      typeof rawItem.description === 'string' ? rawItem.description.trim() : '',
    preconditions:
      typeof rawItem.preconditions === 'string'
        ? rawItem.preconditions.trim()
        : '',
    expectedResult:
      typeof rawItem.expectedResult === 'string'
        ? rawItem.expectedResult.trim()
        : '',
    phaseId:
      typeof rawItem.phaseId === 'string' && rawItem.phaseId.trim()
        ? rawItem.phaseId.trim()
        : null,
    phaseTitle:
      typeof rawItem.phaseTitle === 'string' && rawItem.phaseTitle.trim()
        ? rawItem.phaseTitle.trim()
        : null,
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
 * Extracts embedded checklist metadata stored in `documentNotes` (`__qavora_checklist_meta__`).
 *
 * @param {Array<any>} documentNotes
 * @returns {object}
 */
function extractChecklistMetaFromNotes(documentNotes) {
  if (!Array.isArray(documentNotes)) {
    return {};
  }
  const found = documentNotes.find(
    (note) =>
      note &&
      typeof note === 'object' &&
      (note.id === CHECKLIST_META_NOTE_ID || note.type === 'checklist_meta')
  );
  return found && typeof found === 'object' ? found : {};
}

/**
 * Extracts checklist items from either top-level `items` or backend `phases` array.
 *
 * @param {object} raw
 * @returns {Array<object>}
 */
function extractRawChecklistItems(raw) {
  if (!raw || typeof raw !== 'object') {
    return [];
  }

  const phaseMetaByItemId = new Map();
  if (Array.isArray(raw.phases) && raw.phases.length > 0) {
    raw.phases.forEach((phase, pIdx) => {
      if (!phase || typeof phase !== 'object') return;
      const resolvedPhaseId =
        typeof phase.id === 'string' && phase.id.trim()
          ? phase.id.trim()
          : `phase_${pIdx + 1}`;
      const resolvedPhaseTitle =
        typeof phase.title === 'string' && phase.title.trim()
          ? phase.title.trim()
          : typeof phase.name === 'string' && phase.name.trim()
          ? phase.name.trim()
          : `Phase ${pIdx + 1}`;
      const phaseItems = Array.isArray(phase.items)
        ? phase.items
        : Array.isArray(phase.tasks)
        ? phase.tasks
        : Array.isArray(phase.checks)
        ? phase.checks
        : [];
      phaseItems.forEach((item) => {
        if (item && typeof item === 'object' && item.id) {
          phaseMetaByItemId.set(String(item.id).trim(), {
            phaseId: item.phaseId || resolvedPhaseId,
            phaseTitle: item.phaseTitle || resolvedPhaseTitle,
            category:
              item.category ||
              phase.category ||
              phase.title ||
              phase.name ||
              'General QA',
          });
        }
      });
    });
  }

  if (
    Array.isArray(raw.items) &&
    (raw.items.length > 0 || !Array.isArray(raw.phases) || raw.phases.length === 0)
  ) {
    return raw.items.map((item) => {
      if (!item || typeof item !== 'object') return item;
      const meta = item.id ? phaseMetaByItemId.get(String(item.id).trim()) : null;
      if (!meta) return item;
      return {
        ...item,
        phaseId: item.phaseId || meta.phaseId,
        phaseTitle: item.phaseTitle || meta.phaseTitle,
        category: item.category || meta.category,
      };
    });
  }
  if (Array.isArray(raw.checklistItems) && raw.checklistItems.length > 0) {
    return raw.checklistItems;
  }
  if (Array.isArray(raw.tasks) && raw.tasks.length > 0) {
    return raw.tasks;
  }
  if (Array.isArray(raw.phases) && raw.phases.length > 0) {
    const flattened = [];
    raw.phases.forEach((phase, pIdx) => {
      if (!phase || typeof phase !== 'object') return;
      const resolvedPhaseId =
        typeof phase.id === 'string' && phase.id.trim()
          ? phase.id.trim()
          : `phase_${pIdx + 1}`;
      const resolvedPhaseTitle =
        typeof phase.title === 'string' && phase.title.trim()
          ? phase.title.trim()
          : typeof phase.name === 'string' && phase.name.trim()
          ? phase.name.trim()
          : `Phase ${pIdx + 1}`;
      const phaseItems = Array.isArray(phase.items)
        ? phase.items
        : Array.isArray(phase.tasks)
        ? phase.tasks
        : Array.isArray(phase.checks)
        ? phase.checks
        : [];
      phaseItems.forEach((item) => {
        if (item && typeof item === 'object') {
          flattened.push({
            ...item,
            phaseId: item.phaseId || resolvedPhaseId,
            phaseTitle: item.phaseTitle || resolvedPhaseTitle,
            category:
              item.category ||
              phase.category ||
              phase.title ||
              phase.name ||
              'General QA',
          });
        }
      });
    });
    return flattened;
  }
  return [];
}

/**
 * Normalizes a checklist document from the backend (`phases` + `documentNotes`)
 * or local cache into a consistent Qavora checklist record with accurate derived
 * progress metrics and offline sync indicators.
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
  const metaNote = extractChecklistMetaFromNotes(raw.documentNotes);
  const rawItems = extractRawChecklistItems(raw);

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

  const candidateStatus =
    typeof raw.status === 'string' && CHECKLIST_STATUSES.includes(raw.status.trim())
      ? raw.status.trim()
      : typeof metaNote.status === 'string' &&
        CHECKLIST_STATUSES.includes(metaNote.status.trim())
      ? metaNote.status.trim()
      : raw.completedAt
      ? 'Completed'
      : progress.derivedStatus;

  let status = candidateStatus;

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

  const sourceTags = Array.isArray(raw.tags)
    ? raw.tags
    : Array.isArray(metaNote.tags)
    ? metaNote.tags
    : [];
  const rawTags = sourceTags
    .filter((t) => typeof t === 'string' && t.trim())
    .map((t) => t.trim());

  const resolvedProjectIdSource =
    raw.projectId !== undefined
      ? raw.projectId
      : metaNote.projectId !== undefined
      ? metaNote.projectId
      : raw.promotedProjectId;

  const projectId =
    resolvedProjectIdSource !== undefined &&
    resolvedProjectIdSource !== null &&
    String(resolvedProjectIdSource).trim() !== ''
      ? String(resolvedProjectIdSource).trim()
      : null;

  const description =
    typeof raw.description === 'string'
      ? raw.description.trim()
      : typeof metaNote.description === 'string'
      ? metaNote.description.trim()
      : '';

  const category =
    typeof raw.category === 'string' && raw.category.trim()
      ? raw.category.trim()
      : typeof metaNote.category === 'string' && metaNote.category.trim()
      ? metaNote.category.trim()
      : 'General QA';

  const priority = CHECKLIST_PRIORITIES.includes(raw.priority)
    ? raw.priority
    : CHECKLIST_PRIORITIES.includes(metaNote.priority)
    ? metaNote.priority
    : 'Medium';

  const environment =
    typeof raw.environment === 'string' && raw.environment.trim()
      ? raw.environment.trim()
      : typeof metaNote.environment === 'string' && metaNote.environment.trim()
      ? metaNote.environment.trim()
      : 'Staging';

  const targetRelease =
    typeof raw.targetRelease === 'string'
      ? raw.targetRelease.trim()
      : typeof metaNote.targetRelease === 'string'
      ? metaNote.targetRelease.trim()
      : '';

  const projectName =
    typeof raw.projectName === 'string'
      ? raw.projectName.trim()
      : typeof metaNote.projectName === 'string'
      ? metaNote.projectName.trim()
      : '';

  const otherNotes = Array.isArray(raw.documentNotes)
    ? raw.documentNotes.filter(
        (n) =>
          n &&
          typeof n === 'object' &&
          n.id !== CHECKLIST_META_NOTE_ID &&
          n.type !== 'checklist_meta'
      )
    : [];

  const nextMetaNote = {
    id: CHECKLIST_META_NOTE_ID,
    type: 'checklist_meta',
    description,
    category,
    priority,
    status,
    projectId,
    projectName,
    environment,
    targetRelease,
    tags: rawTags,
  };

  const hasExplicitPhases =
    Array.isArray(raw.phases) &&
    raw.phases.length > 0 &&
    (raw.phases.length > 1 ||
      (raw.phases[0] &&
        typeof raw.phases[0] === 'object' &&
        raw.phases[0].id !== 'phase_main') ||
      normalizedItems.some(
        (it) =>
          (it.phaseId && it.phaseId !== 'phase_main') ||
          (it.phaseTitle &&
            it.phaseTitle !== (category || 'Checklist Items'))
      ));

  let phases;
  if (hasExplicitPhases) {
    const phaseMap = new Map();
    if (Array.isArray(raw.phases)) {
      raw.phases.forEach((rawPhase, pIdx) => {
        if (!rawPhase || typeof rawPhase !== 'object') return;
        const pId =
          typeof rawPhase.id === 'string' && rawPhase.id.trim()
            ? rawPhase.id.trim()
            : `phase_${pIdx + 1}`;
        const pTitle =
          typeof rawPhase.title === 'string' && rawPhase.title.trim()
            ? rawPhase.title.trim()
            : typeof rawPhase.name === 'string' && rawPhase.name.trim()
            ? rawPhase.name.trim()
            : `Phase ${pIdx + 1}`;
        phaseMap.set(pId, {
          id: pId,
          title: pTitle,
          description:
            typeof rawPhase.description === 'string'
              ? rawPhase.description.trim()
              : '',
          category:
            typeof rawPhase.category === 'string' && rawPhase.category.trim()
              ? rawPhase.category.trim()
              : category || 'General QA',
          items: [],
        });
      });
    }

    normalizedItems.forEach((item) => {
      const targetPhaseId = item.phaseId || null;
      const targetPhaseTitle = item.phaseTitle || null;
      let matchedEntry = targetPhaseId ? phaseMap.get(targetPhaseId) : null;
      if (!matchedEntry && targetPhaseTitle) {
        for (const entry of phaseMap.values()) {
          if (entry.title.toLowerCase() === targetPhaseTitle.toLowerCase()) {
            matchedEntry = entry;
            break;
          }
        }
      }
      if (!matchedEntry) {
        if (phaseMap.size === 1) {
          matchedEntry = Array.from(phaseMap.values())[0];
        } else {
          const fallbackId = targetPhaseId || 'phase_main';
          const fallbackTitle =
            targetPhaseTitle || category || 'Checklist Items';
          if (!phaseMap.has(fallbackId)) {
            phaseMap.set(fallbackId, {
              id: fallbackId,
              title: fallbackTitle,
              description: '',
              category: item.category || category || 'General QA',
              items: [],
            });
          }
          matchedEntry = phaseMap.get(fallbackId);
        }
      }
      matchedEntry.items.push({
        ...item,
        phaseId: matchedEntry.id,
        phaseTitle: matchedEntry.title,
      });
    });

    phases = Array.from(phaseMap.values());
  } else {
    phases = [
      {
        id: 'phase_main',
        title: category || 'Checklist Items',
        items: normalizedItems,
      },
    ];
  }

  const pendingSync = Boolean(raw._pendingSync);
  const pendingCreation = Boolean(raw._pendingCreation);
  const syncStatus =
    typeof raw._syncStatus === 'string' && raw._syncStatus
      ? raw._syncStatus
      : pendingSync
      ? 'pending'
      : 'synced';

  return {
    id,
    userId:
      raw.userId !== undefined && raw.userId !== null && String(raw.userId).trim() !== ''
        ? String(raw.userId).trim()
        : null,
    schemaVersion:
      typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 1,
    projectId,
    projectName,
    title,
    description,
    category,
    priority,
    status,
    environment,
    targetRelease,
    tags: rawTags,
    items: normalizedItems,
    phases,
    documentNotes: [nextMetaNote, ...otherNotes],
    totalItems: progress.totalItems,
    completedItems: progress.completedItems,
    pendingItems: progress.pendingItems,
    completionRate: progress.completionRate,
    promotedProjectId:
      raw.promotedProjectId !== undefined && raw.promotedProjectId !== null
        ? String(raw.promotedProjectId)
        : projectId,
    promotedAt: raw.promotedAt || null,
    completedAt:
      status === 'Completed'
        ? raw.completedAt || raw.updatedAt || null
        : null,
    completedBy: raw.completedBy || null,
    originalPrompt:
      typeof raw.originalPrompt === 'string' ? raw.originalPrompt : '',
    createdAt: raw.createdAt || null,
    updatedAt: raw.updatedAt || raw.createdAt || null,
    _serverUpdatedAt: raw._serverUpdatedAt || raw.updatedAt || null,
    _pendingSync: pendingSync,
    _pendingCreation: pendingCreation,
    _syncStatus: syncStatus,
    _syncOpId: raw._syncOpId || null,
    _syncError: raw._syncError || null,
    _conflictDetails: raw._conflictDetails || null,
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

    if (
      cleanProjectId &&
      (chkProjId === cleanProjectId || chkPromotedProjId === cleanProjectId)
    ) {
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
 * Validates and builds a backend-compatible checklist creation payload for `POST /api/checklists`.
 * Serializes rich checklist fields (`description`, `category`, `priority`, `status`,
 * `projectId`, `projectName`, `environment`, `targetRelease`, `tags`, `items`) into
 * the backend's whitelisted `phases`, `documentNotes`, `promotedProjectId`, and `completedAt`
 * properties so `POST /api/checklists` succeeds on the live MongoDB backend without
 * rejecting unrecognized fields.
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

  const normalized = normalizeChecklistRecord({
    ...input,
    id:
      typeof input.id === 'string' && input.id.trim()
        ? input.id.trim()
        : `chk_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    title: rawTitle,
  });

  const nowIso = new Date().toISOString();

  return {
    id: normalized.id,
    title: normalized.title,
    schemaVersion: normalized.schemaVersion || 1,
    documentNotes: normalized.documentNotes,
    phases: normalized.phases,
    promotedProjectId: normalized.projectId || normalized.promotedProjectId || null,
    promotedAt: normalized.promotedAt || null,
    completedAt:
      normalized.status === 'Completed'
        ? normalized.completedAt || nowIso
        : null,
    completedBy: normalized.completedBy || null,
    originalPrompt: normalized.originalPrompt || '',
  };
}

/**
 * Validates and builds a backend-compatible checklist update payload for
 * `PATCH /api/checklists/:id` (with optional `expectedUpdatedAt` optimistic concurrency).
 *
 * @param {object} updates
 * @param {object | null} [existingChecklist=null]
 * @returns {object}
 */
export function buildUpdateChecklistPayload(updates, existingChecklist = null) {
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

  const sourceUpdates =
    updates.snapshot && typeof updates.snapshot === 'object'
      ? { ...updates.snapshot, ...updates }
      : updates;

  if (sourceUpdates.title !== undefined) {
    const cleanTitle =
      typeof sourceUpdates.title === 'string' ? sourceUpdates.title.trim() : '';
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

  const recognizedInputKeys = Object.keys(sourceUpdates).filter(
    (key) =>
      ALLOWED_CHECKLIST_UPDATE_INPUT_FIELDS.has(key) &&
      key !== 'updatedAt' &&
      key !== 'expectedUpdatedAt' &&
      key !== 'snapshot' &&
      key !== 'deletedItemIds' &&
      sourceUpdates[key] !== undefined
  );

  if (recognizedInputKeys.length === 0) {
    throw new ApiClientError({
      message: 'Checklist update payload must include at least one valid field.',
      code: 'VALIDATION_ERROR',
      status: 400,
    });
  }

  const baseRecord =
    existingChecklist && typeof existingChecklist === 'object'
      ? normalizeChecklistRecord(existingChecklist)
      : null;

  const mergedRecord = normalizeChecklistRecord({
    ...(baseRecord || {
      id: sourceUpdates.id || 'chk_update',
      title: sourceUpdates.title || 'Checklist',
    }),
    ...sourceUpdates,
    title:
      sourceUpdates.title !== undefined
        ? String(sourceUpdates.title).trim()
        : (baseRecord && baseRecord.title) || 'Checklist',
  });

  const patchPayload = {};

  if (sourceUpdates.title !== undefined || (baseRecord && baseRecord.title)) {
    patchPayload.title = mergedRecord.title;
  }

  patchPayload.schemaVersion = mergedRecord.schemaVersion || 1;
  patchPayload.documentNotes = mergedRecord.documentNotes;

  if (
    sourceUpdates.items !== undefined ||
    sourceUpdates.phases !== undefined ||
    baseRecord
  ) {
    patchPayload.phases = mergedRecord.phases;
  }

  if (
    sourceUpdates.projectId !== undefined ||
    sourceUpdates.promotedProjectId !== undefined ||
    baseRecord
  ) {
    patchPayload.promotedProjectId =
      mergedRecord.projectId || mergedRecord.promotedProjectId || null;
  }

  if (sourceUpdates.promotedAt !== undefined) {
    patchPayload.promotedAt = sourceUpdates.promotedAt || null;
  }

  if (
    sourceUpdates.status !== undefined ||
    sourceUpdates.items !== undefined ||
    sourceUpdates.completedAt !== undefined
  ) {
    patchPayload.completedAt =
      mergedRecord.status === 'Completed'
        ? mergedRecord.completedAt || new Date().toISOString()
        : null;
  }

  if (sourceUpdates.completedBy !== undefined) {
    patchPayload.completedBy = sourceUpdates.completedBy || null;
  }

  if (sourceUpdates.originalPrompt !== undefined) {
    patchPayload.originalPrompt = String(sourceUpdates.originalPrompt || '');
  }

  const cleanExpectedUpdatedAt =
    typeof updates.expectedUpdatedAt === 'string' &&
    updates.expectedUpdatedAt.trim() !== ''
      ? updates.expectedUpdatedAt.trim()
      : null;

  if (cleanExpectedUpdatedAt) {
    patchPayload.expectedUpdatedAt = cleanExpectedUpdatedAt;
  }

  return patchPayload;
}

// ============================================================================
// PER-USER OFFLINE CHECKLIST CACHE & PENDING QUEUE MERGE
// ============================================================================

/**
 * Merges a list of checklists with any pending/syncing/failed/conflicted checklist
 * mutations in the user's offline sync queue (`@qavora_pending_project_ops_v1:<userId>`),
 * ensuring that:
 * 1. Offline-deleted checklists never reappear before their `DELETE` operation syncs.
 * 2. Offline-created checklists remain visible with their pending sync metadata.
 * 3. Offline-updated checklists and item completions are never overwritten by stale
 *    server refreshes before synchronization completes (or while a conflict is unresolved).
 *
 * @param {Array<object>} baseChecklists
 * @param {Array<object>} cachedChecklists
 * @param {Array<object>} pendingChecklistOps
 * @param {string} userId
 * @returns {Array<object>}
 */
export function mergeChecklistsWithPendingOps(
  baseChecklists = [],
  cachedChecklists = [],
  pendingChecklistOps = [],
  userId = ''
) {
  const cleanUser = userId ? String(userId).trim() : '';
  const safeBase = filterChecklistsForUser(
    (Array.isArray(baseChecklists) ? baseChecklists : [])
      .map(normalizeChecklistRecord)
      .filter(Boolean),
    cleanUser
  );
  const safeCached = filterChecklistsForUser(
    (Array.isArray(cachedChecklists) ? cachedChecklists : [])
      .map(normalizeChecklistRecord)
      .filter(Boolean),
    cleanUser
  );
  const safeOps = Array.isArray(pendingChecklistOps)
    ? pendingChecklistOps.filter(
        (op) =>
          op &&
          op.entityType === 'checklist' &&
          (!cleanUser || String(op.userId) === cleanUser)
      )
    : [];

  const pendingDeleteIds = new Set();
  const pendingOpByChecklistId = new Map();

  safeOps.forEach((op) => {
    const cid = String(op.checklistId || op.entityId || '').trim();
    if (!cid) return;
    if (op.operationType === 'DELETE') {
      pendingDeleteIds.add(cid);
      pendingOpByChecklistId.set(cid, op);
    } else {
      pendingOpByChecklistId.set(cid, op);
    }
  });

  const cachedById = new Map();
  safeCached.forEach((c) => {
    if (c && c.id && !pendingDeleteIds.has(c.id)) {
      cachedById.set(c.id, c);
    }
  });

  const mergedMap = new Map();

  // 1. Seed any offline-created or queued checklists from cache/ops
  safeOps.forEach((op) => {
    const cid = String(op.checklistId || op.entityId || '').trim();
    if (!cid || pendingDeleteIds.has(cid)) return;

    const cachedEntry = cachedById.get(cid);
    const opSnapshot =
      op.payload && typeof op.payload === 'object'
        ? op.payload.snapshot || op.payload
        : null;

    if (op.operationType === 'CREATE' || cachedEntry) {
      const mergedLocal = normalizeChecklistRecord({
        ...(cachedEntry || {}),
        ...(opSnapshot && typeof opSnapshot === 'object' ? opSnapshot : {}),
        id: cid,
        userId: cleanUser || (cachedEntry && cachedEntry.userId) || op.userId,
        _serverUpdatedAt:
          op.expectedUpdatedAt ||
          (cachedEntry && cachedEntry._serverUpdatedAt) ||
          null,
        _pendingSync: true,
        _pendingCreation:
          op.operationType === 'CREATE' ||
          Boolean(cachedEntry && cachedEntry._pendingCreation),
        _syncStatus:
          op.status === 'conflict'
            ? 'conflict'
            : op.status === 'failed' || (op.retryCount > 0 && op.lastError)
            ? 'failed'
            : op.status === 'syncing'
            ? 'syncing'
            : 'pending',
        _syncOpId: op.id,
        _syncError: op.lastError || null,
        _conflictDetails: op.conflictDetails || null,
      });

      if (mergedLocal) {
        mergedMap.set(cid, mergedLocal);
      }
    }
  });

  // Also preserve any cached checklist flagged with _pendingCreation if not deleted
  safeCached.forEach((cachedChk) => {
    if (
      cachedChk &&
      cachedChk.id &&
      !pendingDeleteIds.has(cachedChk.id) &&
      !mergedMap.has(cachedChk.id) &&
      cachedChk._pendingCreation &&
      pendingOpByChecklistId.has(cachedChk.id)
    ) {
      mergedMap.set(cachedChk.id, cachedChk);
    }
  });

  // 2. Merge incoming server/base checklists without overwriting pending local edits
  safeBase.forEach((serverChk) => {
    if (!serverChk || !serverChk.id) return;
    if (pendingDeleteIds.has(serverChk.id)) {
      return;
    }

    const pendingOp = pendingOpByChecklistId.get(serverChk.id);
    if (pendingOp) {
      const existingLocal =
        mergedMap.get(serverChk.id) || cachedById.get(serverChk.id) || {};
      const opSnapshot =
        pendingOp.payload && typeof pendingOp.payload === 'object'
          ? pendingOp.payload.snapshot || pendingOp.payload
          : {};

      const preserved = normalizeChecklistRecord({
        ...serverChk,
        ...existingLocal,
        ...(opSnapshot && typeof opSnapshot === 'object' ? opSnapshot : {}),
        id: serverChk.id,
        userId: cleanUser || serverChk.userId,
        _serverUpdatedAt:
          pendingOp.expectedUpdatedAt ||
          serverChk.updatedAt ||
          existingLocal._serverUpdatedAt ||
          null,
        _pendingSync: true,
        _pendingCreation: false,
        _syncStatus:
          pendingOp.status === 'conflict'
            ? 'conflict'
            : pendingOp.status === 'failed' ||
              (pendingOp.retryCount > 0 && pendingOp.lastError)
            ? 'failed'
            : pendingOp.status === 'syncing'
            ? 'syncing'
            : 'pending',
        _syncOpId: pendingOp.id,
        _syncError: pendingOp.lastError || null,
        _conflictDetails: pendingOp.conflictDetails || null,
      });

      if (preserved) {
        mergedMap.set(serverChk.id, preserved);
      }
      return;
    }

    mergedMap.set(
      serverChk.id,
      normalizeChecklistRecord({
        ...serverChk,
        userId: cleanUser || serverChk.userId,
        _serverUpdatedAt: serverChk.updatedAt || null,
        _pendingSync: false,
        _pendingCreation: false,
        _syncStatus: 'synced',
        _syncOpId: null,
        _syncError: null,
        _conflictDetails: null,
      })
    );
  });

  return Array.from(mergedMap.values()).sort((a, b) =>
    String(b.updatedAt || b.createdAt || '').localeCompare(
      String(a.updatedAt || a.createdAt || '')
    )
  );
}

/**
 * Reads cached checklists for `userId` from AsyncStorage and overlays any
 * pending/failed/conflicted operations from the user's offline sync queue.
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
    let normalized = [];
    if (raw) {
      const parsed = JSON.parse(raw);
      const records = Array.isArray(parsed)
        ? parsed
        : parsed && Array.isArray(parsed.checklists)
        ? parsed.checklists
        : [];
      normalized = filterChecklistsForUser(
        records.map(normalizeChecklistRecord).filter(Boolean),
        cleanUser
      );
    }

    const pendingOps =
      typeof getPendingChecklistOperations === 'function'
        ? await getPendingChecklistOperations(cleanUser)
        : [];

    if (pendingOps.length > 0) {
      return mergeChecklistsWithPendingOps(
        normalized,
        normalized,
        pendingOps,
        cleanUser
      );
    }

    return normalized;
  } catch {
    return [];
  }
}

/**
 * Retrieves a single cached checklist by ID for `userId`.
 *
 * @param {string} checklistId
 * @param {string} userId
 * @returns {Promise<object | null>}
 */
export async function getCachedChecklistById(checklistId, userId) {
  const cleanId = checklistId ? String(checklistId).trim() : '';
  const cleanUser = userId ? String(userId).trim() : '';
  if (!cleanId || !cleanUser) {
    return null;
  }
  const list = await getCachedChecklistsForUser(cleanUser);
  return list.find((item) => item && item.id === cleanId) || null;
}

/**
 * Persists a user's normalized checklists list to AsyncStorage under their
 * isolated per-user cache key while preserving any pending offline mutations.
 *
 * @param {Array<object>} checklists
 * @param {string} userId
 * @param {object} [options]
 * @param {boolean} [options.preservePending=true]
 * @returns {Promise<boolean>}
 */
export async function cacheChecklistsForUser(
  checklists,
  userId,
  options = {}
) {
  const cleanUser = userId ? String(userId).trim() : '';
  if (!cleanUser) {
    return false;
  }

  const key = getChecklistCacheKey(cleanUser);
  if (!key) {
    return false;
  }

  const preservePending = options.preservePending !== false;

  try {
    const storage = getStorage();
    if (!storage || typeof storage.setItem !== 'function') {
      return false;
    }

    let existingCached = [];
    if (preservePending && typeof storage.getItem === 'function') {
      try {
        const rawExisting = await storage.getItem(key);
        if (rawExisting) {
          const parsedExisting = JSON.parse(rawExisting);
          const rawList = Array.isArray(parsedExisting)
            ? parsedExisting
            : parsedExisting && Array.isArray(parsedExisting.checklists)
            ? parsedExisting.checklists
            : [];
          existingCached = rawList.map(normalizeChecklistRecord).filter(Boolean);
        }
      } catch {
        existingCached = [];
      }
    }

    const pendingOps =
      preservePending && typeof getPendingChecklistOperations === 'function'
        ? await getPendingChecklistOperations(cleanUser)
        : [];

    const finalChecklists =
      preservePending && pendingOps.length > 0
        ? mergeChecklistsWithPendingOps(
            checklists,
            existingCached,
            pendingOps,
            cleanUser
          )
        : filterChecklistsForUser(
            (Array.isArray(checklists) ? checklists : [])
              .map(normalizeChecklistRecord)
              .filter(Boolean),
            cleanUser
          );

    await storage.setItem(
      key,
      JSON.stringify({
        userId: cleanUser,
        updatedAt: new Date().toISOString(),
        checklists: finalChecklists,
      })
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Upserts a single checklist record into the user's offline checklist cache.
 *
 * @param {object} checklist
 * @param {string} userId
 * @param {object} [meta]
 * @returns {Promise<object | null>}
 */
export async function cacheChecklistOffline(checklist, userId, meta = {}) {
  const cleanUser = String(
    userId || (checklist && checklist.userId) || ''
  ).trim();
  if (!cleanUser || !checklist || typeof checklist !== 'object') {
    return null;
  }

  const key = getChecklistCacheKey(cleanUser);
  if (!key) return null;

  const storage = getStorage();
  if (!storage || typeof storage.getItem !== 'function') {
    return null;
  }

  let existingList = [];
  try {
    const raw = await storage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      const records = Array.isArray(parsed)
        ? parsed
        : parsed && Array.isArray(parsed.checklists)
        ? parsed.checklists
        : [];
      existingList = records.map(normalizeChecklistRecord).filter(Boolean);
    }
  } catch {
    existingList = [];
  }

  const prevRecord = existingList.find((c) => c.id === checklist.id) || null;
  const normalized = normalizeChecklistRecord({
    ...(prevRecord || {}),
    ...checklist,
    userId: cleanUser,
    _serverUpdatedAt:
      meta.serverUpdatedAt !== undefined
        ? meta.serverUpdatedAt
        : checklist._serverUpdatedAt ||
          (prevRecord && prevRecord._serverUpdatedAt) ||
          checklist.updatedAt ||
          null,
    _pendingSync:
      meta.pendingSync !== undefined
        ? Boolean(meta.pendingSync)
        : Boolean(checklist._pendingSync),
    _pendingCreation:
      meta.pendingCreation !== undefined
        ? Boolean(meta.pendingCreation)
        : Boolean(checklist._pendingCreation),
    _syncStatus:
      meta.syncStatus ||
      checklist._syncStatus ||
      (meta.pendingSync ? 'pending' : 'synced'),
    _syncOpId:
      meta.syncOpId !== undefined ? meta.syncOpId : checklist._syncOpId || null,
    _syncError:
      meta.syncError !== undefined
        ? meta.syncError
        : checklist._syncError || null,
    _conflictDetails:
      meta.conflictDetails !== undefined
        ? meta.conflictDetails
        : checklist._conflictDetails || null,
  });

  if (!normalized) return null;

  const nextList = [
    normalized,
    ...existingList.filter((c) => c && c.id !== normalized.id),
  ];

  try {
    await storage.setItem(
      key,
      JSON.stringify({
        userId: cleanUser,
        updatedAt: new Date().toISOString(),
        checklists: nextList,
      })
    );
  } catch {
    // Ignore storage write errors
  }

  return normalized;
}

/**
 * Removes a single checklist by ID from the user's offline checklist cache.
 *
 * @param {string} checklistId
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
export async function removeCachedChecklistOffline(checklistId, userId) {
  const cleanId = checklistId ? String(checklistId).trim() : '';
  const cleanUser = userId ? String(userId).trim() : '';
  if (!cleanId || !cleanUser) return false;

  const key = getChecklistCacheKey(cleanUser);
  if (!key) return false;

  try {
    const storage = getStorage();
    if (!storage || typeof storage.getItem !== 'function') {
      return false;
    }
    const raw = await storage.getItem(key);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    const records = Array.isArray(parsed)
      ? parsed
      : parsed && Array.isArray(parsed.checklists)
      ? parsed.checklists
      : [];
    const nextList = records
      .map(normalizeChecklistRecord)
      .filter((c) => c && c.id !== cleanId);

    await storage.setItem(
      key,
      JSON.stringify({
        userId: cleanUser,
        updatedAt: new Date().toISOString(),
        checklists: nextList,
      })
    );
    return true;
  } catch {
    return false;
  }
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
// BACKEND /api/checklists CRUD OPERATIONS WITH OFFLINE QUEUEING
// ============================================================================

function applyLocalFiltersToChecklists(list, { projectId, status, category } = {}) {
  let result = Array.isArray(list) ? list : [];
  if (projectId) {
    result = filterChecklistsByProject(result, { projectId });
  }
  if (status && status !== 'All') {
    result = result.filter((c) => c.status === String(status).trim());
  }
  if (category && category !== 'All') {
    result = result.filter((c) => c.category === String(category).trim());
  }
  return result;
}

/**
 * Fetches all checklists owned by the authenticated user via `GET /api/checklists`,
 * preserving any unsynchronized offline checklist creations, updates, item changes,
 * or deletions in the user's offline queue.
 *
 * @param {object} [options]
 * @param {string} [options.userId]
 * @param {string} [options.projectId]
 * @param {string} [options.status]
 * @param {string} [options.category]
 * @param {boolean} [options.skipOfflineCache=false]
 */
export async function fetchChecklists(options = {}) {
  const {
    userId,
    projectId,
    status,
    category,
    skipOfflineCache = false,
    ...requestOptions
  } = options;

  const resolvedUserId = String(userId || getActiveSyncUser() || '').trim();

  // If client is offline, serve directly from the user's merged offline cache + queue
  if (!skipOfflineCache && resolvedUserId && isClientOffline()) {
    const cachedMerged = await getCachedChecklistsForUser(resolvedUserId);
    const filtered = applyLocalFiltersToChecklists(cachedMerged, {
      projectId,
      status,
      category,
    });
    return {
      ok: true,
      status: 200,
      checklists: filtered,
      fromCache: true,
      offlineFallback: true,
      error: null,
    };
  }

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
    const owned = filterChecklistsForUser(extracted, resolvedUserId);

    let mergedList = owned;
    if (resolvedUserId && !skipOfflineCache) {
      const existingCached = await getCachedChecklistsForUser(resolvedUserId);
      const pendingOps =
        typeof getPendingChecklistOperations === 'function'
          ? await getPendingChecklistOperations(resolvedUserId)
          : [];

      mergedList = mergeChecklistsWithPendingOps(
        owned,
        existingCached,
        pendingOps,
        resolvedUserId
      );

      if (
        !projectId &&
        (!status || status === 'All') &&
        (!category || category === 'All')
      ) {
        await cacheChecklistsForUser(mergedList, resolvedUserId, {
          preservePending: false,
        });
      }
    }

    const scoped = applyLocalFiltersToChecklists(mergedList, {
      projectId,
      status,
      category,
    });

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
    const isNetErr = isApiErr ? Boolean(err.isNetworkError) : false;

    if (
      !skipOfflineCache &&
      resolvedUserId &&
      (isNetErr || httpStatus === 0 || isClientOffline())
    ) {
      const cachedMerged = await getCachedChecklistsForUser(resolvedUserId);
      const filtered = applyLocalFiltersToChecklists(cachedMerged, {
        projectId,
        status,
        category,
      });
      return {
        ok: true,
        status: 200,
        checklists: filtered,
        fromCache: true,
        offlineFallback: true,
        isNetworkError: true,
        error: null,
      };
    }

    return {
      ok: false,
      status: httpStatus,
      checklists: [],
      fromCache: false,
      isNetworkError: isNetErr,
      isUnauthorized: httpStatus === 401,
      error: (err && err.message) || 'Failed to load checklists.',
    };
  }
}

/**
 * Fetches a single user-owned checklist by ID via `GET /api/checklists/:id`.
 * Preserves any pending local changes in the queue unless `options.ignorePendingLocal` is true.
 *
 * @param {string} checklistId
 * @param {object} [options]
 * @param {string} [options.userId]
 * @param {boolean} [options.ignorePendingLocal=false]
 */
export async function fetchChecklistById(checklistId, options = {}) {
  const { userId, ignorePendingLocal = false, ...requestOptions } = options;
  const resolvedUserId = String(userId || getActiveSyncUser() || '').trim();
  const cleanId = typeof checklistId === 'string' ? checklistId.trim() : '';

  if (!ignorePendingLocal && resolvedUserId && cleanId) {
    const pendingOps =
      typeof getPendingChecklistOperations === 'function'
        ? await getPendingChecklistOperations(resolvedUserId)
        : [];
    const pendingOp = pendingOps.find((op) => op.checklistId === cleanId);

    if (pendingOp && pendingOp.operationType === 'DELETE') {
      return {
        ok: false,
        status: 404,
        checklist: null,
        error: 'Checklist is queued for deletion.',
      };
    }

    if (isClientOffline()) {
      const cached = await getCachedChecklistById(cleanId, resolvedUserId);
      if (cached) {
        return {
          ok: true,
          status: 200,
          checklist: cached,
          fromCache: true,
          offlineFallback: true,
          error: null,
        };
      }
    }
  }

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
      resolvedUserId &&
      checklist.userId &&
      String(checklist.userId).trim() !== resolvedUserId
    ) {
      return {
        ok: false,
        status: 403,
        checklist: null,
        error: 'Access denied: checklist belongs to another user.',
      };
    }

    const stampedServerChecklist = resolvedUserId
      ? { ...checklist, userId: checklist.userId || resolvedUserId }
      : checklist;

    // If this checklist has pending/failed/conflicted local mutations, preserve local state
    if (!ignorePendingLocal && resolvedUserId) {
      const pendingOps =
        typeof getPendingChecklistOperations === 'function'
          ? await getPendingChecklistOperations(resolvedUserId)
          : [];
      const matchingOp = pendingOps.find(
        (op) => op.checklistId === stampedServerChecklist.id
      );
      if (matchingOp) {
        const cachedLocal = await getCachedChecklistById(
          stampedServerChecklist.id,
          resolvedUserId
        );
        const merged = mergeChecklistsWithPendingOps(
          [stampedServerChecklist],
          cachedLocal ? [cachedLocal] : [],
          [matchingOp],
          resolvedUserId
        );
        if (merged.length > 0) {
          await cacheChecklistOffline(merged[0], resolvedUserId, {
            pendingSync: true,
            syncStatus: merged[0]._syncStatus,
            syncOpId: matchingOp.id,
            serverUpdatedAt:
              matchingOp.expectedUpdatedAt || stampedServerChecklist.updatedAt,
          });
          return {
            ok: true,
            status: response.status,
            checklist: merged[0],
            preservedLocalPending: true,
            error: null,
          };
        }
      }

      await cacheChecklistOffline(stampedServerChecklist, resolvedUserId, {
        pendingSync: false,
        pendingCreation: false,
        syncStatus: 'synced',
        syncOpId: null,
        syncError: null,
        conflictDetails: null,
      });
    }

    return {
      ok: true,
      status: response.status,
      checklist: stampedServerChecklist,
      error: null,
    };
  } catch (err) {
    const isApiErr = err instanceof ApiClientError;
    const httpStatus = isApiErr ? err.status : 0;
    const isNetErr = isApiErr ? Boolean(err.isNetworkError) : false;

    if (
      !ignorePendingLocal &&
      resolvedUserId &&
      cleanId &&
      (isNetErr || httpStatus === 0 || isClientOffline())
    ) {
      const cached = await getCachedChecklistById(cleanId, resolvedUserId);
      if (cached) {
        return {
          ok: true,
          status: 200,
          checklist: cached,
          fromCache: true,
          offlineFallback: true,
          isNetworkError: true,
          error: null,
        };
      }
    }

    return {
      ok: false,
      status: httpStatus,
      checklist: null,
      isNetworkError: isNetErr,
      isUnauthorized: httpStatus === 401,
      error: (err && err.message) || 'Failed to fetch checklist details.',
    };
  }
}

/**
 * Creates a new checklist via `POST /api/checklists`.
 * When offline or when a network error occurs (and `skipOfflineQueue` is not set),
 * queues a durable `CREATE` checklist mutation in `@qavora_pending_project_ops_v1:<userId>`
 * and persists the checklist in the user's offline checklist cache.
 *
 * @param {object} checklistData
 * @param {object} [options]
 * @param {string} [options.userId]
 * @param {boolean} [options.skipOfflineQueue=false]
 */
export async function createChecklist(checklistData, options = {}) {
  const { userId, skipOfflineQueue = false, ...requestOptions } = options;
  const resolvedUserId = String(userId || getActiveSyncUser() || '').trim();

  let wirePayload;
  try {
    wirePayload = buildCreateChecklistPayload(checklistData);
  } catch (validationErr) {
    const isApiErr = validationErr instanceof ApiClientError;
    return {
      ok: false,
      status: isApiErr ? validationErr.status : 400,
      checklist: null,
      isNetworkError: false,
      isUnauthorized: false,
      error:
        (validationErr && validationErr.message) ||
        'Invalid checklist payload.',
    };
  }

  const nowIso = new Date().toISOString();
  const optimisticChecklist = normalizeChecklistRecord({
    ...checklistData,
    id: wirePayload.id,
    title: wirePayload.title,
    userId: resolvedUserId || null,
    createdAt: (checklistData && checklistData.createdAt) || nowIso,
    updatedAt: (checklistData && checklistData.updatedAt) || nowIso,
    _serverUpdatedAt: null,
    _pendingSync: true,
    _pendingCreation: true,
    _syncStatus: 'pending',
  });

  const enqueueOfflineCreate = async () => {
    const queuedOp = await queueChecklistMutation({
      userId: resolvedUserId,
      checklistId: optimisticChecklist.id,
      projectId: optimisticChecklist.projectId || null,
      operationType: 'CREATE',
      mutationSubType: 'CREATE',
      payload: {
        ...optimisticChecklist,
        snapshot: optimisticChecklist,
      },
      expectedUpdatedAt: null,
      description: `Create checklist "${optimisticChecklist.title}"`,
    });

    const cachedRecord = await cacheChecklistOffline(
      {
        ...optimisticChecklist,
        _pendingSync: true,
        _pendingCreation: true,
        _syncStatus: 'pending',
        _syncOpId: queuedOp.id,
      },
      resolvedUserId,
      {
        pendingSync: true,
        pendingCreation: true,
        syncStatus: 'pending',
        syncOpId: queuedOp.id,
      }
    );

    return {
      ok: true,
      status: 202,
      queuedOffline: true,
      checklist: cachedRecord || optimisticChecklist,
      operation: queuedOp,
      error: null,
    };
  };

  if (!skipOfflineQueue && resolvedUserId && isClientOffline()) {
    return enqueueOfflineCreate();
  }

  try {
    const response = await apiPost(
      CHECKLISTS_ENDPOINT,
      wirePayload,
      requestOptions
    );
    const extracted = extractSingleChecklist(response.data);
    const created = normalizeChecklistRecord({
      ...optimisticChecklist,
      ...(extracted || {}),
      id: (extracted && extracted.id) || wirePayload.id,
      userId:
        (extracted && extracted.userId) || resolvedUserId || null,
      _serverUpdatedAt:
        (extracted && extracted.updatedAt) || nowIso,
      _pendingSync: false,
      _pendingCreation: false,
      _syncStatus: 'synced',
      _syncOpId: null,
      _syncError: null,
      _conflictDetails: null,
    });

    if (
      resolvedUserId &&
      created.userId &&
      String(created.userId).trim() !== resolvedUserId
    ) {
      return {
        ok: false,
        status: 403,
        checklist: null,
        error: 'Ownership mismatch in created checklist response.',
      };
    }

    if (resolvedUserId && !skipOfflineQueue) {
      await cacheChecklistOffline(created, resolvedUserId, {
        pendingSync: false,
        pendingCreation: false,
        syncStatus: 'synced',
        syncOpId: null,
        serverUpdatedAt: created.updatedAt,
      });
    }

    return {
      ok: true,
      status: response.status,
      queuedOffline: false,
      checklist: created,
      error: null,
    };
  } catch (err) {
    const isApiErr = err instanceof ApiClientError;
    const httpStatus = isApiErr ? err.status : 0;
    const isNetErr = isApiErr ? Boolean(err.isNetworkError) : false;

    if (
      !skipOfflineQueue &&
      resolvedUserId &&
      (isNetErr || httpStatus === 0 || isClientOffline())
    ) {
      return enqueueOfflineCreate();
    }

    return {
      ok: false,
      status: httpStatus,
       isConflict: httpStatus === 409 || (isApiErr && err.code === 'CONFLICT'),
      checklist: null,
      isNetworkError: isNetErr,
      isUnauthorized: httpStatus === 401,
      error: (err && err.message) || 'Failed to create checklist.',
    };
  }
}

/**
 * Updates an existing user-owned checklist via `PATCH /api/checklists/:id`
 * (or `PUT /api/checklists/:id` when `options.method === 'PUT'`).
 *
 * Supports optimistic concurrency via `expectedUpdatedAt`, surfaces HTTP 409
 * conflict responses cleanly, and routes offline mutations into the durable
 * per-user offline queue (`@qavora_pending_project_ops_v1:<userId>`).
 *
 * @param {string} checklistId
 * @param {object} updates
 * @param {object} [options]
 * @param {string} [options.userId]
 * @param {object} [options.existingChecklist]
 * @param {string} [options.mutationSubType]
 * @param {string} [options.description]
 * @param {Array<string>} [options.deletedItemIds]
 * @param {boolean} [options.skipOfflineQueue=false]
 * @param {'PATCH' | 'PUT'} [options.method='PATCH']
 */
export async function updateChecklist(checklistId, updates, options = {}) {
  const {
    userId,
    existingChecklist: passedExisting = null,
    mutationSubType = 'UPDATE_METADATA',
    description = '',
    deletedItemIds = [],
    skipOfflineQueue = false,
    method = 'PATCH',
    ...requestOptions
  } = options;

  const resolvedUserId = String(userId || getActiveSyncUser() || '').trim();
  let path;
  try {
    path = buildChecklistResourcePath(checklistId);
  } catch (pathErr) {
    return {
      ok: false,
      status: 400,
      checklist: null,
      error: pathErr.message || 'A valid checklist ID is required.',
    };
  }

  const cleanId = String(checklistId).trim();
  const cachedExisting =
    passedExisting ||
    (resolvedUserId
      ? await getCachedChecklistById(cleanId, resolvedUserId)
      : null);

  let wirePayload;
  try {
    wirePayload = buildUpdateChecklistPayload(updates, cachedExisting);
  } catch (validationErr) {
    const isApiErr = validationErr instanceof ApiClientError;
    return {
      ok: false,
      status: isApiErr ? validationErr.status : 400,
      checklist: null,
      isNetworkError: false,
      isUnauthorized: false,
      error:
        (validationErr && validationErr.message) ||
        'Invalid checklist update payload.',
    };
  }

  const baselineUpdatedAt =
    (typeof updates.expectedUpdatedAt === 'string' &&
      updates.expectedUpdatedAt.trim()) ||
    (cachedExisting &&
      (cachedExisting._serverUpdatedAt || cachedExisting.updatedAt)) ||
    null;

  if (baselineUpdatedAt && !wirePayload.expectedUpdatedAt) {
    wirePayload.expectedUpdatedAt = baselineUpdatedAt;
  }

  // If this checklist was created offline and hasn't synced to the server yet,
  // never send expectedUpdatedAt for the initial creation
  const isPendingCreation = Boolean(
    cachedExisting && cachedExisting._pendingCreation
  );
  if (isPendingCreation) {
    delete wirePayload.expectedUpdatedAt;
  }

  const nowIso = new Date().toISOString();
  const sourceUpdates =
    updates && updates.snapshot && typeof updates.snapshot === 'object'
      ? { ...updates.snapshot, ...updates }
      : updates;

  const optimisticChecklist = normalizeChecklistRecord({
    ...(cachedExisting || { id: cleanId, title: 'Checklist' }),
    ...sourceUpdates,
    id: cleanId,
    userId:
      resolvedUserId || (cachedExisting && cachedExisting.userId) || null,
    updatedAt: nowIso,
    _serverUpdatedAt: isPendingCreation ? null : baselineUpdatedAt,
    _pendingSync: true,
    _pendingCreation: isPendingCreation,
    _syncStatus: 'pending',
  });

  const enqueueOfflineUpdate = async () => {
    const cleanUpdatesForQueue = { ...sourceUpdates };
    delete cleanUpdatesForQueue.expectedUpdatedAt;
    delete cleanUpdatesForQueue.snapshot;

    const queuedOp = await queueChecklistMutation({
      userId: resolvedUserId,
      checklistId: cleanId,
      projectId: optimisticChecklist.projectId || null,
      operationType: 'UPDATE',
      mutationSubType,
      payload: {
        ...cleanUpdatesForQueue,
        ...(Array.isArray(deletedItemIds) && deletedItemIds.length > 0
          ? { deletedItemIds }
          : {}),
        snapshot: optimisticChecklist,
      },
      expectedUpdatedAt: isPendingCreation ? null : baselineUpdatedAt,
      description:
        description ||
        `Update checklist "${optimisticChecklist.title}"`,
    });

    const cachedRecord = await cacheChecklistOffline(
      {
        ...optimisticChecklist,
        _pendingSync: true,
        _pendingCreation:
          queuedOp.operationType === 'CREATE' || isPendingCreation,
        _syncStatus: 'pending',
        _syncOpId: queuedOp.id,
      },
      resolvedUserId,
      {
        pendingSync: true,
        pendingCreation:
          queuedOp.operationType === 'CREATE' || isPendingCreation,
        syncStatus: 'pending',
        syncOpId: queuedOp.id,
        serverUpdatedAt: isPendingCreation ? null : baselineUpdatedAt,
      }
    );

    return {
      ok: true,
      status: 202,
      queuedOffline: true,
      checklist: cachedRecord || optimisticChecklist,
      operation: queuedOp,
      error: null,
    };
  };

  // If offline (or if the checklist is still an unsynced offline-created checklist),
  // coalesce directly in the offline queue
  if (
    !skipOfflineQueue &&
    resolvedUserId &&
    (isClientOffline() || isPendingCreation)
  ) {
    return enqueueOfflineUpdate();
  }

  try {
    const requestFn = String(method).toUpperCase() === 'PUT' ? apiPut : apiPatch;
    const response = await requestFn(path, wirePayload, requestOptions);

    const extracted = extractSingleChecklist(response.data);
    const updated = normalizeChecklistRecord({
      ...optimisticChecklist,
      ...(extracted || {}),
      id: cleanId,
      userId:
        (extracted && extracted.userId) ||
        resolvedUserId ||
        optimisticChecklist.userId ||
        null,
      updatedAt: (extracted && extracted.updatedAt) || nowIso,
      _serverUpdatedAt: (extracted && extracted.updatedAt) || nowIso,
      _pendingSync: false,
      _pendingCreation: false,
      _syncStatus: 'synced',
      _syncOpId: null,
      _syncError: null,
      _conflictDetails: null,
    });

    if (
      resolvedUserId &&
      updated.userId &&
      String(updated.userId).trim() !== resolvedUserId
    ) {
      return {
        ok: false,
        status: 403,
        checklist: null,
        error: 'Access denied: cannot modify another user’s checklist.',
      };
    }

    if (resolvedUserId && !skipOfflineQueue) {
      await cacheChecklistOffline(updated, resolvedUserId, {
        pendingSync: false,
        pendingCreation: false,
        syncStatus: 'synced',
        syncOpId: null,
        serverUpdatedAt: updated.updatedAt,
      });
    }

    return {
      ok: true,
      status: response.status,
      queuedOffline: false,
      checklist: updated,
      error: null,
    };
  } catch (err) {
    const isApiErr = err instanceof ApiClientError;
    const httpStatus = isApiErr ? err.status : 0;
    const isNetErr = isApiErr ? Boolean(err.isNetworkError) : false;

    if (
      !skipOfflineQueue &&
      resolvedUserId &&
      (isNetErr || httpStatus === 0 || isClientOffline())
    ) {
      return enqueueOfflineUpdate();
    }

    const isConflict =
      httpStatus === 409 || (isApiErr && err.code === 'CONFLICT');
    let serverChecklist =
      isConflict && err.data
        ? extractSingleChecklist(
            err.data.serverChecklist ||
              err.data.serverRecord ||
              err.data.checklist ||
              null
          )
        : null;

    if (isConflict && !serverChecklist) {
      try {
        const latestRes = await fetchChecklistById(cleanId, {
          ...requestOptions,
          userId: resolvedUserId || undefined,
          ignorePendingLocal: true,
        });
        if (latestRes.ok && latestRes.checklist) {
          serverChecklist = latestRes.checklist;
        }
      } catch {
        // Ignore secondary fetch error
      }
    }

    const currentUpdatedAt =
      (isConflict && err.data && err.data.currentUpdatedAt) ||
      (serverChecklist && serverChecklist.updatedAt) ||
      null;

    return {
      ok: false,
      status: httpStatus,
      isConflict,
      currentUpdatedAt,
      expectedUpdatedAt: wirePayload.expectedUpdatedAt || null,
      serverChecklist,
      checklist: null,
      isNetworkError: isNetErr,
      isUnauthorized: httpStatus === 401,
      error: (err && err.message) || 'Failed to update checklist.',
    };
  }
}

/**
 * Deletes an existing user-owned checklist via `DELETE /api/checklists/:id`.
 * When offline or when a network error occurs, queues a durable `DELETE`
 * operation (or cancels out an unsynced offline `CREATE`) in `@qavora_pending_project_ops_v1:<userId>`.
 *
 * @param {string} checklistId
 * @param {object} [options]
 * @param {string} [options.userId]
 * @param {boolean} [options.skipOfflineQueue=false]
 */
export async function deleteChecklist(checklistId, options = {}) {
  const { userId, skipOfflineQueue = false, ...requestOptions } = options;
  const resolvedUserId = String(userId || getActiveSyncUser() || '').trim();

  let path;
  try {
    path = buildChecklistResourcePath(checklistId);
  } catch (pathErr) {
    return {
      ok: false,
      status: 400,
      deletedId: null,
      error: pathErr.message || 'A valid checklist ID is required.',
    };
  }

  const cleanId = String(checklistId).trim();
  const cachedExisting = resolvedUserId
    ? await getCachedChecklistById(cleanId, resolvedUserId)
    : null;
  const isPendingCreation = Boolean(
    cachedExisting && cachedExisting._pendingCreation
  );

  const enqueueOfflineDelete = async () => {
    const queuedOp = await queueChecklistMutation({
      userId: resolvedUserId,
      checklistId: cleanId,
      projectId: (cachedExisting && cachedExisting.projectId) || null,
      operationType: 'DELETE',
      mutationSubType: 'DELETE',
      payload: { id: cleanId },
      expectedUpdatedAt: null,
      description: `Delete checklist "${
        (cachedExisting && cachedExisting.title) || cleanId
      }"`,
    });

    await removeCachedChecklistOffline(cleanId, resolvedUserId);

    return {
      ok: true,
      status: 202,
      queuedOffline: true,
      cancelledOut: Boolean(queuedOp && queuedOp.cancelledOut),
      deletedId: cleanId,
      operation: queuedOp,
      error: null,
    };
  };

  if (
    !skipOfflineQueue &&
    resolvedUserId &&
    (isClientOffline() || isPendingCreation)
  ) {
    return enqueueOfflineDelete();
  }

  try {
    const response = await apiDelete(path, requestOptions);
    if (resolvedUserId) {
      await removeCachedChecklistOffline(cleanId, resolvedUserId);
    }
    return {
      ok: true,
      status: response.status,
      queuedOffline: false,
      deletedId: cleanId,
      error: null,
    };
  } catch (err) {
    const isApiErr = err instanceof ApiClientError;
    const httpStatus = isApiErr ? err.status : 0;
    const isNetErr = isApiErr ? Boolean(err.isNetworkError) : false;

    if (
      !skipOfflineQueue &&
      resolvedUserId &&
      (isNetErr || httpStatus === 0 || isClientOffline())
    ) {
      return enqueueOfflineDelete();
    }

    return {
      ok: false,
      status: httpStatus,
      deletedId: null,
      isNetworkError: isNetErr,
      isUnauthorized: httpStatus === 401,
      error: (err && err.message) || 'Failed to delete checklist.',
    };
  }
}

// ============================================================================
// CHECKLIST ITEM MUTATION HELPERS (ADD, TOGGLE, UPDATE, DELETE, BULK TOGGLE)
// ============================================================================

async function resolveTargetChecklist(checklistOrId, options = {}) {
  if (checklistOrId && typeof checklistOrId === 'object') {
    return normalizeChecklistRecord(checklistOrId);
  }
  if (typeof checklistOrId === 'string' && checklistOrId.trim()) {
    const cleanId = checklistOrId.trim();
    const resolvedUserId = String(
      (options && options.userId) || getActiveSyncUser() || ''
    ).trim();
    if (resolvedUserId) {
      const cached = await getCachedChecklistById(cleanId, resolvedUserId);
      if (cached) {
        return cached;
      }
    }
    const fetched = await fetchChecklistById(cleanId, options);
    if (fetched && fetched.ok && fetched.checklist) {
      return fetched.checklist;
    }
  }
  return null;
}

/**
 * Toggles or sets the completion state of a specific checklist item within a
 * checklist and persists the updated checklist via `updateChecklist` (online or queued offline).
 *
 * @param {object | string} checklist
 * @param {string} itemId
 * @param {boolean | object} [explicitCompleted]
 * @param {object} [options]
 */
export async function toggleChecklistItemCompletion(
  checklist,
  itemId,
  explicitCompleted = undefined,
  options = {}
) {
  let effectiveExplicitCompleted = explicitCompleted;
  let effectiveOptions = options;
  if (
    explicitCompleted &&
    typeof explicitCompleted === 'object' &&
    !Array.isArray(explicitCompleted)
  ) {
    effectiveOptions = explicitCompleted;
    effectiveExplicitCompleted = undefined;
  }

  const normalized = await resolveTargetChecklist(checklist, effectiveOptions);
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
  const targetItem = normalized.items[existingIndex];
  const resolvedCompleted =
    typeof effectiveExplicitCompleted === 'boolean'
      ? effectiveExplicitCompleted
      : !targetItem.completed;

  const nextItems = normalized.items.map((it) => {
    if (it.id !== cleanItemId) return it;
    return normalizeChecklistItem(
      {
        ...it,
        completed: resolvedCompleted,
        checked: resolvedCompleted,
        status: resolvedCompleted ? 'Completed' : 'Pending',
        completedAt: resolvedCompleted ? nowIso : null,
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
      expectedUpdatedAt:
        normalized._serverUpdatedAt || normalized.updatedAt || undefined,
    },
    {
      ...effectiveOptions,
      existingChecklist: normalized,
      mutationSubType: 'ITEM_TOGGLE',
      description: `${
        resolvedCompleted ? 'Complete' : 'Reopen'
      } item "${targetItem.title}" in "${normalized.title}"`,
    }
  );
}

/**
 * Adds a new item to a checklist and persists the change to the backend or offline queue.
 *
 * @param {object | string} checklist
 * @param {object} newItemInput
 * @param {object} [options]
 */
export async function addChecklistItem(checklist, newItemInput, options = {}) {
  const normalized = await resolveTargetChecklist(checklist, options);
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
      expectedUpdatedAt:
        normalized._serverUpdatedAt || normalized.updatedAt || undefined,
    },
    {
      ...options,
      existingChecklist: normalized,
      mutationSubType: 'ITEM_ADD',
      description: `Add item "${nextItem.title}" to "${normalized.title}"`,
    }
  );
}

/**
 * Updates an existing checklist item's text, priority, category, or notes and persists.
 *
 * @param {object | string} checklist
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
  const normalized = await resolveTargetChecklist(checklist, options);
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
      expectedUpdatedAt:
        normalized._serverUpdatedAt || normalized.updatedAt || undefined,
    },
    {
      ...options,
      existingChecklist: normalized,
      mutationSubType: 'ITEM_UPDATE',
      description: `Update item "${updatedItem.title}" in "${normalized.title}"`,
    }
  );
}

/**
 * Deletes an item from a checklist and persists the updated checklist.
 *
 * @param {object | string} checklist
 * @param {string} itemId
 * @param {object} [options]
 */
export async function deleteChecklistItem(checklist, itemId, options = {}) {
  const normalized = await resolveTargetChecklist(checklist, options);
  if (!normalized) {
    return {
      ok: false,
      status: 400,
      checklist: null,
      error: 'A valid checklist is required.',
    };
  }

  const cleanItemId = typeof itemId === 'string' ? itemId.trim() : '';
  const targetItem = normalized.items.find((it) => it.id === cleanItemId);
  if (!targetItem) {
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
      expectedUpdatedAt:
        normalized._serverUpdatedAt || normalized.updatedAt || undefined,
    },
    {
      ...options,
      existingChecklist: normalized,
      mutationSubType: 'ITEM_DELETE',
      deletedItemIds: [cleanItemId],
      description: `Remove item "${targetItem.title}" from "${normalized.title}"`,
    }
  );
}

/**
 * Marks all items in a checklist as completed or uncompleted in one operation.
 *
 * @param {object | string} checklist
 * @param {boolean} completed
 * @param {object} [options]
 */
export async function markAllChecklistItems(
  checklist,
  completed = true,
  options = {}
) {
  const normalized = await resolveTargetChecklist(checklist, options);
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
      expectedUpdatedAt:
        normalized._serverUpdatedAt || normalized.updatedAt || undefined,
    },
    {
      ...options,
      existingChecklist: normalized,
      mutationSubType: 'ITEMS_BULK_STATUS',
      description: `${
        nextCompleted ? 'Mark all items complete' : 'Reset all items to pending'
      } in "${normalized.title}"`,
    }
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

  const totalChecklists = safeList.length;
  let completedChecklists = 0;
  let inProgressChecklists = 0;
  let notStartedChecklists = 0;
  let totalItems = 0;
  let completedItems = 0;
  let pendingSyncChecklists = 0;
  let conflictChecklists = 0;
  let failedSyncChecklists = 0;

  safeList.forEach((chk) => {
    totalItems += chk.totalItems || 0;
    completedItems += chk.completedItems || 0;

    if (
      chk.status === 'Completed' ||
      (chk.totalItems > 0 && chk.completedItems === chk.totalItems)
    ) {
      completedChecklists += 1;
    } else if (chk.status === 'In Progress' || chk.completedItems > 0) {
      inProgressChecklists += 1;
    } else {
      notStartedChecklists += 1;
    }

    if (chk._syncStatus === 'conflict') {
      conflictChecklists += 1;
    } else if (chk._syncStatus === 'failed') {
      failedSyncChecklists += 1;
    } else if (chk._pendingSync || chk._syncStatus === 'pending' || chk._syncStatus === 'syncing') {
      pendingSyncChecklists += 1;
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
    pendingSyncChecklists,
    conflictChecklists,
    failedSyncChecklists,
  };
}

/**
 * In-memory lock tracking active checklist-to-project promotion requests
 * keyed by `${checklistId}:${targetProjectId}` to prevent accidental duplicate
 * rapid/concurrent submissions.
 */
const inFlightPromotions = new Map();

/**
 * Maps a checklist priority (`Critical`, `High`, `Medium`, `Low`, or `P0`–`P3`)
 * to the Qavora project test case priority format (`P0`–`P3`).
 *
 * @param {string} priority
 * @returns {'P0' | 'P1' | 'P2' | 'P3'}
 */
export function mapChecklistPriorityToCasePriority(priority) {
  const normalized = String(priority || '')
    .trim()
    .toLowerCase();
  if (normalized === 'critical' || normalized === 'p0') return 'P0';
  if (normalized === 'high' || normalized === 'p1') return 'P1';
  if (normalized === 'low' || normalized === 'p3') return 'P3';
  return 'P2';
}

/**
 * Normalizes a checklist category or suite name into a clean suite category string.
 *
 * @param {string} category
 * @returns {string}
 */
export function mapChecklistCategoryToSuiteCategory(category) {
  if (typeof category === 'string' && category.trim()) {
    return category.trim();
  }
  return 'General QA';
}

/**
 * Extracts structured phases from a normalized or raw checklist record so that:
 * - Multi-phase checklists preserve every defined phase and its items.
 * - Single-phase or flat checklists map cleanly to a phase named after the checklist
 *   title (or explicit phase title when different from generic `'phase_main'`).
 * - Empty checklists still produce their phase and category structure for promotion.
 *
 * @param {object} checklist
 * @returns {Array<{
 *   sourcePhaseId: string,
 *   title: string,
 *   description: string,
 *   category: string,
 *   items: Array<object>
 * }>}
 */
function extractStructuredChecklistPhases(checklist) {
  const normalized = normalizeChecklistRecord(checklist) || checklist || {};
  const checklistTitle =
    typeof normalized.title === 'string' && normalized.title.trim()
      ? normalized.title.trim()
      : 'Promoted Checklist';
  const checklistDescription =
    typeof normalized.description === 'string' && normalized.description.trim()
      ? normalized.description.trim()
      : `Promoted from QA Checklist "${checklistTitle}".`;
  const checklistCategory = mapChecklistCategoryToSuiteCategory(
    normalized.category
  );

  const rawPhases = Array.isArray(checklist && checklist.phases)
    ? checklist.phases
    : Array.isArray(normalized.phases)
    ? normalized.phases
    : [];

  const flatItems = Array.isArray(normalized.items) ? normalized.items : [];
  const itemLookup = new Map();
  flatItems.forEach((it) => {
    if (it && it.id) {
      itemLookup.set(String(it.id).trim(), it);
    }
  });

  const hasMultipleOrCustomPhases =
    rawPhases.length > 1 ||
    (rawPhases.length === 1 &&
      rawPhases[0] &&
      typeof rawPhases[0] === 'object' &&
      rawPhases[0].id &&
      rawPhases[0].id !== 'phase_main') ||
    flatItems.some(
      (it) =>
        (it.phaseId && it.phaseId !== 'phase_main') ||
        (it.phaseTitle &&
          it.phaseTitle !== checklistCategory &&
          it.phaseTitle !== 'Checklist Items')
    );

  if (hasMultipleOrCustomPhases) {
    const phaseGroups = new Map();

    rawPhases.forEach((rawPhase, idx) => {
      if (!rawPhase || typeof rawPhase !== 'object') return;
      const pId =
        typeof rawPhase.id === 'string' && rawPhase.id.trim()
          ? rawPhase.id.trim()
          : `phase_${idx + 1}`;
      const rawPhaseTitle =
        typeof rawPhase.title === 'string' && rawPhase.title.trim()
          ? rawPhase.title.trim()
          : typeof rawPhase.name === 'string' && rawPhase.name.trim()
          ? rawPhase.name.trim()
          : `Phase ${idx + 1}`;
      const pTitle =
        pId === 'phase_main' &&
        (rawPhaseTitle === checklistCategory ||
          rawPhaseTitle === 'Checklist Items')
          ? `Checklist: ${checklistTitle}`
          : rawPhaseTitle;
      const pDesc =
        typeof rawPhase.description === 'string' && rawPhase.description.trim()
          ? rawPhase.description.trim()
          : checklistDescription;
      const pCategory = mapChecklistCategoryToSuiteCategory(
        rawPhase.category || checklistCategory
      );

      if (!phaseGroups.has(pId)) {
        phaseGroups.set(pId, {
          sourcePhaseId: pId,
          title: pTitle,
          description: pDesc,
          category: pCategory,
          items: [],
        });
      }

      const phaseItems = Array.isArray(rawPhase.items)
        ? rawPhase.items
        : Array.isArray(rawPhase.tasks)
        ? rawPhase.tasks
        : [];

      phaseItems.forEach((rawIt, itIdx) => {
        const normIt =
          (rawIt && rawIt.id && itemLookup.get(String(rawIt.id).trim())) ||
          normalizeChecklistItem(rawIt, itIdx);
        if (!normIt) return;
        const group = phaseGroups.get(pId);
        if (!group.items.some((existing) => existing.id === normIt.id)) {
          group.items.push({
            ...normIt,
            phaseId: pId,
            phaseTitle: pTitle,
            category: mapChecklistCategoryToSuiteCategory(
              rawIt.category || normIt.category || pCategory
            ),
          });
        }
      });
    });

    // Also include any flat items that were not already placed into a phase group
    const placedIds = new Set();
    for (const grp of phaseGroups.values()) {
      grp.items.forEach((it) => placedIds.add(it.id));
    }

    flatItems.forEach((item) => {
      if (!item || placedIds.has(item.id)) return;
      const pId = item.phaseId || 'phase_main';
      const pTitle =
        item.phaseTitle &&
        item.phaseTitle !== checklistCategory &&
        item.phaseTitle !== 'Checklist Items'
          ? item.phaseTitle
          : `Checklist: ${checklistTitle}`;
      if (!phaseGroups.has(pId)) {
        phaseGroups.set(pId, {
          sourcePhaseId: pId,
          title: pTitle,
          description: checklistDescription,
          category: mapChecklistCategoryToSuiteCategory(
            item.category || checklistCategory
          ),
          items: [],
        });
      }
      phaseGroups.get(pId).items.push({
        ...item,
        phaseId: pId,
        phaseTitle: phaseGroups.get(pId).title,
      });
      placedIds.add(item.id);
    });

    if (phaseGroups.size > 0) {
      return Array.from(phaseGroups.values());
    }
  }

  return [
    {
      sourcePhaseId: 'phase_main',
      title: `Checklist: ${checklistTitle}`,
      description: checklistDescription,
      category: checklistCategory,
      items: flatItems.map((it) => ({
        ...it,
        phaseId: 'phase_main',
        phaseTitle: `Checklist: ${checklistTitle}`,
        category: mapChecklistCategoryToSuiteCategory(
          it.category || checklistCategory
        ),
      })),
    },
  ];
}

/**
 * Builds a deterministic, side-effect-free preview of promoting `checklist` into
 * `targetProject`. Used both by the confirmation modal in `ChecklistsScreen` and
 * by `promoteChecklistToProject()` to compute the exact phases, test suites,
 * test cases, and summary statistics while preventing duplicate entity creation.
 *
 * Mapping Rules:
 * - Checklist phases -> Project testing phases (`testPlan.phases` & `phases`)
 * - Checklist categories -> Project test suites (`testSuites`, with both `cases` & `testCases`)
 * - Checklist items -> Project test cases (`TC-XXX`), preserving title, description/notes,
 *   preconditions/environment, priority (`Critical->P0`, `High->P1`, `Medium->P2`, `Low->P3`),
 *   and completion status (`completed: true -> Passed`, `pending -> Untested`/`Not Run`).
 *
 * @param {object} checklist
 * @param {object} targetProject
 * @returns {object}
 */
export function buildChecklistPromotionPreview(checklist, targetProject) {
  const normChecklist = normalizeChecklistRecord(checklist);
  if (!normChecklist) {
    return {
      valid: false,
      error: 'A valid checklist is required for promotion.',
    };
  }

  const normProject =
    targetProject && typeof targetProject === 'object'
      ? normalizeProject(targetProject) || targetProject
      : null;

  if (!normProject || !normProject.id) {
    return {
      valid: false,
      error: 'Please select a valid destination project.',
    };
  }

  const checklistId = String(normChecklist.id).trim();
  const checklistTitle = normChecklist.title || 'Untitled Checklist';
  const checklistDescription =
    normChecklist.description ||
    `Promoted from QA Checklist "${checklistTitle}".`;
  const checklistCategory = mapChecklistCategoryToSuiteCategory(
    normChecklist.category
  );
  const checklistPriority = normChecklist.priority || 'Medium';
  const checklistEnvironment =
    normChecklist.environment || normProject.environment || 'Staging';
  const checklistTargetRelease =
    normChecklist.targetRelease || normProject.version || '';

  const structuredPhases = extractStructuredChecklistPhases(checklist);

  const existingTestPlan = buildDefaultTestPlan(normProject);
  const existingPhases = Array.isArray(existingTestPlan.phases)
    ? existingTestPlan.phases.map((p) => ({ ...p }))
    : [];
  const existingSuites = Array.isArray(normProject.testSuites)
    ? normProject.testSuites.map((s) => {
        const cases = extractSuiteTestCases(s).map((c) => ({ ...c }));
        return {
          ...s,
          cases,
          testCases: cases,
        };
      })
    : [];

  // Track all existing promoted item IDs and existing TC numbers
  const existingItemKeys = new Set();
  let maxCaseNum = 0;

  existingSuites.forEach((suite) => {
    const suiteCases = extractSuiteTestCases(suite);
    suiteCases.forEach((tc) => {
      if (!tc || typeof tc !== 'object') return;
      const match = String(tc.id || '').match(/^TC-(\d+)$/i);
      if (match) {
        const parsed = parseInt(match[1], 10);
        if (parsed > maxCaseNum) maxCaseNum = parsed;
      }
      if (
        tc.sourceChecklistId &&
        String(tc.sourceChecklistId) === checklistId &&
        tc.sourceChecklistItemId
      ) {
        existingItemKeys.add(
          `${checklistId}:${String(tc.sourceChecklistItemId)}`
        );
      }
    });
  });

  let nextCaseNum = Math.max(maxCaseNum, existingSuites.reduce(
    (sum, s) => sum + extractSuiteTestCases(s).length,
    0
  ));

  const nextPhases = existingPhases.map((p) => ({ ...p }));
  const nextSuites = existingSuites.map((s) => {
    const clonedCases = extractSuiteTestCases(s).map((c) => ({ ...c }));
    return {
      ...s,
      cases: clonedCases,
      testCases: clonedCases,
    };
  });

  const phasesSummary = [];
  const suitesSummaryMap = new Map();
  const casesToCreate = [];
  const skippedDuplicateItems = [];

  structuredPhases.forEach((srcPhase, phaseIdx) => {
    const phaseTitle = srcPhase.title || `Checklist: ${checklistTitle}`;
    const phaseKey = `${checklistId}:${srcPhase.sourcePhaseId}`;

    // Check if this phase already exists in targetProject
    let targetPhase = nextPhases.find(
      (p) =>
        (p.sourceChecklistId === checklistId &&
          p.sourceChecklistPhaseId === srcPhase.sourcePhaseId) ||
        (p.sourceChecklistId === checklistId &&
          structuredPhases.length === 1) ||
        String(p.name || p.title || '')
          .trim()
          .toLowerCase() === phaseTitle.trim().toLowerCase()
    );

    let phaseAction = 'reused';
    if (!targetPhase) {
      phaseAction = 'created';
      const newPhaseId = `ph_chk_${checklistId.replace(/[^a-zA-Z0-9]/g, '').slice(-8)}_${
        phaseIdx + 1
      }`;
      const phaseItemsTotal = srcPhase.items.length;
      const phaseItemsDone = srcPhase.items.filter((it) => it.completed).length;
      const phaseStatus =
        phaseItemsTotal > 0 && phaseItemsDone === phaseItemsTotal
          ? 'Completed'
          : phaseItemsDone > 0
          ? 'In Progress'
          : 'Planned';

      targetPhase = {
        id: newPhaseId,
        name: phaseTitle,
        title: phaseTitle,
        description:
          srcPhase.description ||
          checklistDescription ||
          `Promoted from checklist "${checklistTitle}"`,
        entryCriteria: `Checklist "${checklistTitle}" promoted to project (${checklistEnvironment}${
          checklistTargetRelease ? ` • ${checklistTargetRelease}` : ''
        }).`,
        exitCriteria:
          'All promoted checklist verification cases executed and passed.',
        status: phaseStatus,
        sourceChecklistId: checklistId,
        sourceChecklistPhaseId: srcPhase.sourcePhaseId,
        sourceChecklistTitle: checklistTitle,
      };
      nextPhases.push(targetPhase);
    }

    phasesSummary.push({
      id: targetPhase.id,
      name: targetPhase.name || targetPhase.title,
      description: targetPhase.description,
      action: phaseAction,
      itemCount: srcPhase.items.length,
      phaseKey,
    });

    // Group items in this phase by category -> testSuites
    const categoriesInPhase = new Map();
    if (srcPhase.items.length === 0) {
      // Empty checklist / empty phase still ensures a category suite exists
      const emptyCat = mapChecklistCategoryToSuiteCategory(
        srcPhase.category || checklistCategory
      );
      categoriesInPhase.set(emptyCat, []);
    } else {
      srcPhase.items.forEach((item) => {
        const cat = mapChecklistCategoryToSuiteCategory(
          item.category || srcPhase.category || checklistCategory
        );
        if (!categoriesInPhase.has(cat)) {
          categoriesInPhase.set(cat, []);
        }
        categoriesInPhase.get(cat).push(item);
      });
    }

    for (const [catName, catItems] of categoriesInPhase.entries()) {
      const desiredSuiteName =
        structuredPhases.length > 1
          ? `${phaseTitle} — ${catName}`
          : `${checklistTitle} — ${catName}`;

      let targetSuite = nextSuites.find(
        (s) =>
          (s.sourceChecklistId === checklistId &&
            String(s.category || '').toLowerCase() === catName.toLowerCase() &&
            (!s.phaseId || s.phaseId === targetPhase.id)) ||
          String(s.name || s.title || '')
            .trim()
            .toLowerCase() === desiredSuiteName.trim().toLowerCase()
      );

      let suiteAction = 'reused';
      if (!targetSuite) {
        suiteAction = 'created';
        const newSuiteId = `suite_chk_${checklistId
          .replace(/[^a-zA-Z0-9]/g, '')
          .slice(-8)}_${nextSuites.length + 1}`;
        targetSuite = {
          id: newSuiteId,
          phaseId: targetPhase.id,
          name: desiredSuiteName,
          title: desiredSuiteName,
          category: catName,
          priority: mapChecklistPriorityToCasePriority(checklistPriority),
          description:
            checklistDescription ||
            `Test suite promoted from checklist "${checklistTitle}" (${catName}).`,
          sourceChecklistId: checklistId,
          sourceChecklistTitle: checklistTitle,
          environment: checklistEnvironment,
          targetRelease: checklistTargetRelease,
          cases: [],
          testCases: [],
        };
        nextSuites.push(targetSuite);
      }

      const addedCasesForSuite = [];

      catItems.forEach((item, itemIdx) => {
        const itemKey = `${checklistId}:${String(item.id)}`;
        const alreadyInSuite = targetSuite.cases.some(
          (tc) =>
            (tc.sourceChecklistId === checklistId &&
              String(tc.sourceChecklistItemId) === String(item.id)) ||
            String(tc.title || '')
              .trim()
              .toLowerCase() ===
              String(item.title || item.text || '')
                .trim()
                .toLowerCase()
        );

        if (existingItemKeys.has(itemKey) || alreadyInSuite) {
          skippedDuplicateItems.push({
            id: item.id,
            title: item.title || item.text,
            category: catName,
            phaseName: targetPhase.name,
          });
          return;
        }

        existingItemKeys.add(itemKey);
        nextCaseNum += 1;
        const caseId = `TC-${String(nextCaseNum).padStart(3, '0')}`;
        const isCompleted = Boolean(item.completed || item.checked);
        const mappedPriority = mapChecklistPriorityToCasePriority(
          item.priority || checklistPriority
        );
        const itemTitle =
          typeof item.title === 'string' && item.title.trim()
            ? item.title.trim()
            : typeof item.text === 'string' && item.text.trim()
            ? item.text.trim()
            : `Checklist Verification #${itemIdx + 1}`;
        const itemNotes =
          typeof item.notes === 'string' && item.notes.trim()
            ? item.notes.trim()
            : '';
        const itemDescription =
          typeof item.description === 'string' && item.description.trim()
            ? item.description.trim()
            : itemNotes
            ? `${itemNotes} (Promoted from checklist "${checklistTitle}")`
            : checklistDescription
            ? `${itemTitle} — ${checklistDescription}`
            : `Promoted from checklist "${checklistTitle}" (${catName}).`;
        const itemPreconditions =
          typeof item.preconditions === 'string' && item.preconditions.trim()
            ? item.preconditions.trim()
            : `Environment: ${checklistEnvironment}${
                checklistTargetRelease
                  ? ` | Target Release: ${checklistTargetRelease}`
                  : ''
              }`;
        const itemExpectedResult =
          typeof item.expectedResult === 'string' && item.expectedResult.trim()
            ? item.expectedResult.trim()
            : `Verification item "${itemTitle}" passes all acceptance criteria.`;

        const newTestCase = {
          id: caseId,
          suiteId: targetSuite.id,
          phaseId: targetPhase.id,
          title: itemTitle,
          description: itemDescription,
          module: catName,
          category: catName,
          priority: mappedPriority,
          severity:
            mappedPriority === 'P0'
              ? 'Critical'
              : mappedPriority === 'P1'
              ? 'Major'
              : mappedPriority === 'P3'
              ? 'Low'
              : 'Medium',
          type: 'Functional',
          automationStatus: 'Manual',
          preconditions: itemPreconditions,
          expectedResult: itemExpectedResult,
          steps: [
            {
              stepNumber: 1,
              action: itemTitle,
              expectedResult:
                itemNotes ||
                `Checklist item "${itemTitle}" verified successfully.`,
            },
          ],
          assignee: item.assignee || 'QA Team',
          environment: checklistEnvironment,
          version: checklistTargetRelease || normProject.version || 'v1.0.0',
          lastStatus: isCompleted ? 'Passed' : 'Untested',
          status: isCompleted ? 'Passed' : 'Not Run',
          notes: itemNotes,
          sourceChecklistId: checklistId,
          sourceChecklistTitle: checklistTitle,
          sourceChecklistItemId: String(item.id),
          sourceChecklistPhaseId: srcPhase.sourcePhaseId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        targetSuite.cases.push(newTestCase);
        targetSuite.testCases = [...targetSuite.cases];
        addedCasesForSuite.push(newTestCase);
        casesToCreate.push(newTestCase);
      });

      const existingSummary = suitesSummaryMap.get(targetSuite.id);
      if (existingSummary) {
        existingSummary.addedCaseCount += addedCasesForSuite.length;
        existingSummary.totalCaseCount = targetSuite.cases.length;
      } else {
        suitesSummaryMap.set(targetSuite.id, {
          id: targetSuite.id,
          name: targetSuite.name || targetSuite.title,
          category: targetSuite.category || catName,
          phaseId: targetSuite.phaseId,
          phaseName: targetPhase.name || targetPhase.title,
          action: suiteAction,
          addedCaseCount: addedCasesForSuite.length,
          totalCaseCount: targetSuite.cases.length,
        });
      }
    }
  });

  // Compute updated project-wide test metrics across all suites
  let totalCases = 0;
  let passedTests = 0;
  let failedTests = 0;
  let blockedTests = 0;
  let skippedTests = 0;
  let notRunTests = 0;

  nextSuites.forEach((suite) => {
    const suiteCases = extractSuiteTestCases(suite);
    suiteCases.forEach((tc) => {
      totalCases += 1;
      const st = String(tc.lastStatus || tc.status || 'Untested')
        .trim()
        .toLowerCase();
      if (st === 'passed' || st === 'pass' || st === 'completed') {
        passedTests += 1;
      } else if (st === 'failed' || st === 'fail') {
        failedTests += 1;
      } else if (st === 'blocked') {
        blockedTests += 1;
      } else if (st === 'skipped') {
        skippedTests += 1;
      } else {
        notRunTests += 1;
      }
    });
  });

  const executedTests = passedTests + failedTests + blockedTests + skippedTests;
  const passRate =
    executedTests > 0 ? Math.round((passedTests / executedTests) * 100) : 0;

  const suitesSummary = Array.from(suitesSummaryMap.values());
  const createdPhaseCount = phasesSummary.filter(
    (p) => p.action === 'created'
  ).length;
  const reusedPhaseCount = phasesSummary.filter(
    (p) => p.action === 'reused'
  ).length;
  const createdSuiteCount = suitesSummary.filter(
    (s) => s.action === 'created'
  ).length;
  const reusedSuiteCount = suitesSummary.filter(
    (s) => s.action === 'reused'
  ).length;

  const totalChecklistItems = Array.isArray(normChecklist.items)
    ? normChecklist.items.length
    : 0;
  const isEmptyChecklist = totalChecklistItems === 0;

  // Determine if this checklist was already completely promoted into this project
  const alreadyFullyPromoted =
    (!isEmptyChecklist &&
      casesToCreate.length === 0 &&
      skippedDuplicateItems.length > 0) ||
    (isEmptyChecklist &&
      createdPhaseCount === 0 &&
      createdSuiteCount === 0 &&
      (String(normProject.sourceChecklistId || '') === checklistId ||
        existingPhases.some((p) => p.sourceChecklistId === checklistId) ||
        existingSuites.some((s) => s.sourceChecklistId === checklistId)));

  const promotedAt = new Date().toISOString();
  const nextTestPlan = {
    ...existingTestPlan,
    objective:
      existingTestPlan.objective ||
      checklistDescription ||
      `Validate functional, regression, and release readiness coverage for ${normProject.name}.`,
    scope:
      existingTestPlan.scope ||
      `Core workflows, promoted checklist suites (${checklistTitle}), and defect verification.`,
    phases: nextPhases,
  };

  const patchData = {
    testPlan: nextTestPlan,
    phases: nextPhases,
    testSuites: nextSuites,
    sourceChecklistId: checklistId,
    promotedFromChecklistTitle: checklistTitle,
    promotedAt,
    testCaseCount: totalCases,
    executedTests,
    passedTests,
    failedTests,
    blockedTests,
    skippedTests,
    notRunTests,
    passRate,
  };

  return {
    valid: true,
    checklistId,
    checklistTitle,
    checklistCategory,
    checklistPriority,
    checklistEnvironment,
    checklistTargetRelease,
    targetProjectId: String(normProject.id),
    targetProjectName: normProject.name || 'Selected Project',
    isEmptyChecklist,
    alreadyFullyPromoted,
    totalChecklistItems,
    phasesSummary,
    suitesSummary,
    casesToCreate,
    skippedDuplicateItems,
    stats: {
      createdPhaseCount,
      reusedPhaseCount,
      totalPhaseCount: phasesSummary.length,
      createdSuiteCount,
      reusedSuiteCount,
      totalSuiteCount: suitesSummary.length,
      createdCaseCount: casesToCreate.length,
      passedCaseCount: casesToCreate.filter(
        (c) => c.lastStatus === 'Passed'
      ).length,
      untestedCaseCount: casesToCreate.filter(
        (c) => c.lastStatus !== 'Passed'
      ).length,
      skippedDuplicateCount: skippedDuplicateItems.length,
      projectTotalCasesBefore: existingSuites.reduce(
        (sum, s) => sum + extractSuiteTestCases(s).length,
        0
      ),
      projectTotalCasesAfter: totalCases,
      projectPassRateAfter: passRate,
    },
    patchData,
  };
}

/**
 * Promotes a QA checklist into an existing Qavora project without deleting or
 * modifying the original checklist.
 *
 * Preserves the Qavora checklist-to-project mapping:
 * - Checklist phases -> Project testing phases (`testPlan.phases` & `phases`)
 * - Checklist categories -> Project test suites (`testSuites`)
 * - Checklist items -> Project test cases (`TC-XXX`, preserving title, description,
 *   notes, priority, environment, and completion status)
 *
 * Prevents both rapid concurrent duplicate submissions (`429 DUPLICATE_SUBMISSION`)
 * and repeated duplicate entity creation (`409 ALREADY_PROMOTED`).
 *
 * @param {object | string} checklistOrId
 * @param {object | string} targetProjectOrId
 * @param {object} [options]
 * @param {string} [options.userId]
 * @param {Function} [options.updateProjectDataFn] - Optional `ProjectContext.updateProjectData` wrapper
 * @param {Function} [options.onProgress] - Optional callback `(stage: string) => void`
 * @returns {Promise<{
 *   ok: boolean,
 *   status: number,
 *   project: object | null,
 *   checklist: object | null,
 *   preview: object | null,
 *   summary: object | null,
 *   queuedOffline?: boolean,
 *   isDuplicatePromotion?: boolean,
 *   isDuplicateSubmission?: boolean,
 *   alreadyPromoted?: boolean,
 *   error: string | null
 * }>}
 */
export async function promoteChecklistToProject(
  checklistOrId,
  targetProjectOrId,
  options = {}
) {
  const userId = String(
    (options && options.userId) || getActiveSyncUser() || ''
  ).trim();
  const onProgress =
    typeof options.onProgress === 'function' ? options.onProgress : null;

  // 1. Resolve source checklist (read-only; never modifies or deletes the checklist)
  const resolvedChecklist = await resolveTargetChecklist(checklistOrId, {
    ...options,
    userId,
  });
  if (!resolvedChecklist || !resolvedChecklist.id) {
    return {
      ok: false,
      status: 400,
      project: null,
      checklist: null,
      preview: null,
      summary: null,
      error: 'Unable to locate the selected checklist for promotion.',
    };
  }

  // Keep raw phases if passed on input object
  const sourceChecklist =
    checklistOrId &&
    typeof checklistOrId === 'object' &&
    Array.isArray(checklistOrId.phases) &&
    checklistOrId.phases.length > 1
      ? {
          ...resolvedChecklist,
          phases: checklistOrId.phases,
        }
      : resolvedChecklist;

  // 2. Resolve destination project
  const rawProjectId =
    targetProjectOrId && typeof targetProjectOrId === 'object'
      ? targetProjectOrId.id || targetProjectOrId._id
      : targetProjectOrId;
  const cleanProjectId =
    rawProjectId !== undefined && rawProjectId !== null
      ? String(rawProjectId).trim()
      : '';

  if (!cleanProjectId) {
    return {
      ok: false,
      status: 400,
      project: null,
      checklist: sourceChecklist,
      preview: null,
      summary: null,
      error: 'Please select a destination project to promote this checklist.',
    };
  }

  const lockKey = `${String(sourceChecklist.id).trim()}:${cleanProjectId}`;
  if (inFlightPromotions.has(lockKey)) {
    return {
      ok: false,
      status: 429,
      project: null,
      checklist: sourceChecklist,
      preview: null,
      summary: null,
      isDuplicateSubmission: true,
      error:
        'Promotion of this checklist to the selected project is already in progress.',
    };
  }

  inFlightPromotions.set(lockKey, Date.now());

  try {
    if (onProgress) {
      onProgress('Preparing destination project and mapping checklist items...');
    }

    let targetProject =
      targetProjectOrId &&
      typeof targetProjectOrId === 'object' &&
      (Array.isArray(targetProjectOrId.testSuites) ||
        (targetProjectOrId.testPlan &&
          Array.isArray(targetProjectOrId.testPlan.phases)))
        ? normalizeProject(targetProjectOrId) || targetProjectOrId
        : null;

    // Fetch latest destination project state when online or if full suites/phases aren't loaded
    if (!isClientOffline()) {
      const fetchedRes = await fetchProjectById(cleanProjectId, {
        currentUserId: userId,
      });
      if (fetchedRes.ok && fetchedRes.project) {
        targetProject = fetchedRes.project;
      } else if (!targetProject) {
        return {
          ok: false,
          status: fetchedRes.status || 404,
          project: null,
          checklist: sourceChecklist,
          preview: null,
          summary: null,
          error:
            fetchedRes.error ||
            'Destination project could not be loaded from the server.',
        };
      }
    } else if (!targetProject && userId) {
      const cachedProjects = await getCachedProjectsForUser(userId);
      const foundCached = cachedProjects.find(
        (p) => p && String(p.id) === cleanProjectId
      );
      if (foundCached) {
        targetProject = normalizeProject(foundCached) || foundCached;
      }
    }

    if (!targetProject || !targetProject.id) {
      return {
        ok: false,
        status: 404,
        project: null,
        checklist: sourceChecklist,
        preview: null,
        summary: null,
        error: 'Destination project not found.',
      };
    }

    // 3. Build deterministic promotion preview and verify idempotency
    const preview = buildChecklistPromotionPreview(
      sourceChecklist,
      targetProject
    );

    if (!preview.valid) {
      return {
        ok: false,
        status: 400,
        project: targetProject,
        checklist: sourceChecklist,
        preview,
        summary: null,
        error: preview.error || 'Checklist promotion validation failed.',
      };
    }

    if (preview.alreadyFullyPromoted) {
      return {
        ok: false,
        status: 409,
        project: targetProject,
        checklist: sourceChecklist,
        preview,
        summary: preview.stats,
        isDuplicatePromotion: true,
        alreadyPromoted: true,
        error: `Checklist "${sourceChecklist.title}" has already been promoted to "${targetProject.name}". All ${preview.totalChecklistItems} checklist item(s) already exist in the project.`,
      };
    }

    if (onProgress) {
      onProgress(
        `Promoting ${preview.stats.createdCaseCount} test case(s) across ${preview.stats.totalSuiteCount} suite(s) to "${targetProject.name}"...`
      );
    }

    // 4. Persist updated project data via ProjectContext wrapper or projectService
    if (typeof options.updateProjectDataFn === 'function') {
      const ctxResult = await options.updateProjectDataFn(
        cleanProjectId,
        preview.patchData,
        {
          expectedUpdatedAt:
            targetProject._serverUpdatedAt || targetProject.updatedAt,
        }
      );

      if (!ctxResult || !ctxResult.ok) {
        return {
          ok: false,
          status: (ctxResult && ctxResult.status) || 500,
          project: (ctxResult && ctxResult.project) || targetProject,
          checklist: sourceChecklist,
          preview,
          summary: null,
          error:
            (ctxResult && ctxResult.error) ||
            'Failed to save promoted checklist entities to the project.',
        };
      }

      return {
        ok: true,
        status: ctxResult.status || 200,
        project: ctxResult.project,
        checklist: sourceChecklist,
        preview,
        summary: preview.stats,
        queuedOffline: Boolean(ctxResult.queuedOffline),
        error: null,
      };
    }

    // Direct service call (supports both online backend persistence and offline queueing)
    if (isClientOffline()) {
      const optimisticProject = normalizeProject({
        ...targetProject,
        ...preview.patchData,
        updatedAt: new Date().toISOString(),
        _pendingSync: true,
        _syncStatus: 'pending',
      });

      if (userId) {
        await queueProjectMutation({
          userId,
          projectId: cleanProjectId,
          action: 'UPDATE_PROJECT_DATA',
          endpoint: `/api/projects/${encodeURIComponent(cleanProjectId)}/data`,
          method: 'PATCH',
          payload: preview.patchData,
          expectedUpdatedAt:
            targetProject._serverUpdatedAt || targetProject.updatedAt || null,
        });
        await cacheProjectOffline(userId, optimisticProject);
      }

      return {
        ok: true,
        status: 202,
        project: optimisticProject,
        checklist: sourceChecklist,
        preview,
        summary: preview.stats,
        queuedOffline: true,
        error: null,
      };
    }

    const updateRes = await updateProjectData(
      cleanProjectId,
      preview.patchData,
      {
        currentUserId: userId,
        expectedUpdatedAt:
          targetProject._serverUpdatedAt || targetProject.updatedAt || undefined,
      }
    );

    if (!updateRes.ok) {
      // If network failed mid-request, queue offline if userId is available
      if (
        (updateRes.status === 0 || updateRes.code === 'NETWORK_ERROR') &&
        userId
      ) {
        const optimisticProject = normalizeProject({
          ...targetProject,
          ...preview.patchData,
          updatedAt: new Date().toISOString(),
          _pendingSync: true,
          _syncStatus: 'pending',
        });

        await queueProjectMutation({
          userId,
          projectId: cleanProjectId,
          action: 'UPDATE_PROJECT_DATA',
          endpoint: `/api/projects/${encodeURIComponent(cleanProjectId)}/data`,
          method: 'PATCH',
          payload: preview.patchData,
          expectedUpdatedAt:
            targetProject._serverUpdatedAt || targetProject.updatedAt || null,
        });
        await cacheProjectOffline(userId, optimisticProject);

        return {
          ok: true,
          status: 202,
          project: optimisticProject,
          checklist: sourceChecklist,
          preview,
          summary: preview.stats,
          queuedOffline: true,
          error: null,
        };
      }

      return {
        ok: false,
        status: updateRes.status || 500,
        project: targetProject,
        checklist: sourceChecklist,
        preview,
        summary: null,
        error:
          updateRes.error ||
          'Failed to promote checklist to the destination project.',
      };
    }

    if (userId && updateRes.project) {
      await cacheProjectOffline(userId, updateRes.project);
    }

    return {
      ok: true,
      status: updateRes.status || 200,
      project: updateRes.project,
      checklist: sourceChecklist,
      preview,
      summary: preview.stats,
      queuedOffline: false,
      error: null,
    };
  } finally {
    inFlightPromotions.delete(lockKey);
  }
}

export const checklistService = {
  CHECKLISTS_ENDPOINT,
  OFFLINE_CHECKLISTS_CACHE_PREFIX,
  CHECKLIST_META_NOTE_ID,
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
  mergeChecklistsWithPendingOps,
  getCachedChecklistsForUser,
  getCachedChecklistById,
  cacheChecklistsForUser,
  cacheChecklistOffline,
  removeCachedChecklistOffline,
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
  mapChecklistPriorityToCasePriority,
  mapChecklistCategoryToSuiteCategory,
  buildChecklistPromotionPreview,
  promoteChecklistToProject,
};

export default checklistService;

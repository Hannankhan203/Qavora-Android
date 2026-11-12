/**
 * Qavora Android — Checklist Constants, Normalization & Payload Builders
 *
 * Pure normalization, validation, filtering, summary metrics, and backend
 * payload serialization utilities for standalone QA Checklists.
 */

import { ApiClientError } from '../apiClient.js';
import { containsProhibitedKeys } from '../projectService.js';

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
      ALLOWED_CHECKLIST_CREATE_INPUT_FIELDS.has(key) ||
      ALLOWED_CHECKLIST_UPDATE_INPUT_FIELDS.has(key)
  ).filter(
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
    } else if (
      chk._pendingSync ||
      chk._syncStatus === 'pending' ||
      chk._syncStatus === 'syncing'
    ) {
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

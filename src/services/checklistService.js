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
  normalizeProject,
} from './projectService.js';
import {
  isClientOffline,
  getActiveSyncUser,
} from './offlineSync/syncState.js';
import { getPendingChecklistOperations } from './offlineSync/pendingQueueRead.js';
import {
  queueChecklistMutation,
  queueProjectMutation,
} from './offlineSync/pendingQueueMutations.js';
import {
  cacheProjectOffline,
  getCachedProjectsForUser,
} from './offlineSync/offlineProjectCache.js';
import {
  CHECKLISTS_ENDPOINT,
  OFFLINE_CHECKLISTS_CACHE_PREFIX,
  CHECKLIST_META_NOTE_ID,
  CHECKLIST_CATEGORIES,
  CHECKLIST_PRIORITIES,
  CHECKLIST_STATUSES,
  CHECKLIST_STARTER_TEMPLATES,
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
  computeChecklistsSummaryMetrics,
} from './checklists/checklistNormalization.js';
import {
  setChecklistStorageAdapter,
  mergeChecklistsWithPendingOps,
  getCachedChecklistsForUser,
  getCachedChecklistById,
  cacheChecklistsForUser,
  cacheChecklistOffline,
  removeCachedChecklistOffline,
  clearChecklistCacheForUser,
} from './checklists/checklistCache.js';
import {
  mapChecklistPriorityToCasePriority,
  mapChecklistCategoryToSuiteCategory,
  buildChecklistPromotionPreview,
} from './checklists/checklistPromotion.js';

export {
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
  computeChecklistsSummaryMetrics,
  mapChecklistPriorityToCasePriority,
  mapChecklistCategoryToSuiteCategory,
  buildChecklistPromotionPreview,
};

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
 * In-memory lock tracking active checklist-to-project promotion requests
 * keyed by `${checklistId}:${targetProjectId}` to prevent accidental duplicate
 * rapid/concurrent submissions.
 */
const inFlightPromotions = new Map();

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
      } else if (!targetProject && userId && (fetchedRes.isNetworkError || fetchedRes.status === 0)) {
        const cachedProjects = await getCachedProjectsForUser(userId);
        const foundCached = cachedProjects.find(
          (p) => p && String(p.id) === cleanProjectId
        );
        if (foundCached) {
          targetProject = normalizeProject(foundCached) || foundCached;
        }
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

    const baselineUpdatedAt =
      targetProject._serverUpdatedAt || targetProject.updatedAt || null;

    // Direct service call (supports both online backend persistence and offline queueing)
    if (isClientOffline()) {
      const optimisticProject = normalizeProject({
        ...targetProject,
        ...preview.patchData,
        userId: userId || targetProject.userId,
        _serverUpdatedAt: baselineUpdatedAt,
        updatedAt: baselineUpdatedAt || new Date().toISOString(),
        _pendingSync: true,
        _syncStatus: 'pending',
      });

      let queuedOp = null;
      if (userId) {
        queuedOp = await queueProjectMutation({
          userId,
          projectId: cleanProjectId,
          entityType: 'data',
          operationType: 'UPDATE',
          payload: preview.patchData,
          expectedUpdatedAt: baselineUpdatedAt,
          description: `Promote checklist "${sourceChecklist.title}"`,
        });
        await cacheProjectOffline(optimisticProject, userId, {
          pendingSync: true,
          pendingCreation: Boolean(targetProject._pendingCreation),
        });
      }

      return {
        ok: true,
        status: 202,
        project: optimisticProject,
        checklist: sourceChecklist,
        preview,
        summary: preview.stats,
        queuedOffline: true,
        operation: queuedOp,
        error: null,
      };
    }

    const updateRes = await updateProjectData(
      cleanProjectId,
      preview.patchData,
      {
        currentUserId: userId,
        expectedUpdatedAt: baselineUpdatedAt || undefined,
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
          userId: userId || targetProject.userId,
          _serverUpdatedAt: baselineUpdatedAt,
          updatedAt: baselineUpdatedAt || new Date().toISOString(),
          _pendingSync: true,
          _syncStatus: 'pending',
        });

        const queuedOp = await queueProjectMutation({
          userId,
          projectId: cleanProjectId,
          entityType: 'data',
          operationType: 'UPDATE',
          payload: preview.patchData,
          expectedUpdatedAt: baselineUpdatedAt,
          description: `Promote checklist "${sourceChecklist.title}"`,
        });
        await cacheProjectOffline(optimisticProject, userId, {
          pendingSync: true,
          pendingCreation: Boolean(targetProject._pendingCreation),
        });

        return {
          ok: true,
          status: 202,
          project: optimisticProject,
          checklist: sourceChecklist,
          preview,
          summary: preview.stats,
          queuedOffline: true,
          operation: queuedOp,
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
      await cacheProjectOffline(updateRes.project, userId, {
        pendingSync: false,
        pendingCreation: false,
      });
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

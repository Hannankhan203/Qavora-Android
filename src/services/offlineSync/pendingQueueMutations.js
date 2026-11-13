/**
 * Qavora Android — Offline Mutation Queueing, Coalescing & Optimistic Cache Updates
 *
 * Manages durable queueing (`@qavora_pending_project_ops_v1:<userId>`) and optimistic
 * local cache updates for both project and checklist offline mutations.
 */

import { normalizeProjectRecord } from '../projectService.js';
import { normalizeChecklistRecord } from '../checklists/checklistNormalization.js';
import {
  cacheChecklistOffline,
  removeCachedChecklistOffline,
  getCachedChecklistById,
} from '../checklists/checklistCache.js';
import {
  BASE_BACKOFF_MS,
  DEFAULT_MAX_RETRIES,
  nextMonotonicSeq,
  notifySyncListeners,
} from './syncState.js';
import {
  buildOperationIdempotencyKey,
  buildChecklistOperationIdempotencyKey,
  sortProjectOperations,
  getPendingProjectOperations,
  savePendingProjectOperations,
} from './pendingQueueRead.js';
import {
  cacheProjectOffline,
  removeCachedProjectOffline,
  getCachedProjectById,
} from './offlineProjectCache.js';
import {
  createEmptyDeletionTombstones,
  extractActiveIdsFromProjectDataPayload,
  getProjectDeletionTombstones,
  hasAnyDeletionTombstones,
  mergeDeletionTombstones,
  saveProjectDeletionTombstones,
  subtractDeletionTombstones,
  clearProjectDeletionTombstones,
} from './deletionTombstones.js';

/**
 * Applies a queued mutation optimistically to the user's offline project cache
 * so offline edits are immediately reflected across app restarts.
 */
export async function applyMutationToOfflineCache(userId, mutation) {
  const { projectId, entityType, operationType, payload } = mutation;
  if (!userId || !projectId) return null;

  if (entityType === 'project' && operationType === 'DELETE') {
    await removeCachedProjectOffline(projectId, userId);
    return null;
  }

  const existing = await getCachedProjectById(projectId, userId, true);
  const nowIso = new Date().toISOString();

  if (entityType === 'project' && operationType === 'CREATE') {
    const createdRecord = normalizeProjectRecord({
      ...(existing || {}),
      ...(payload || {}),
      id: projectId,
      userId,
      createdAt: (payload && payload.createdAt) || nowIso,
      updatedAt: (payload && payload.updatedAt) || nowIso,
    });
    return cacheProjectOffline(createdRecord, userId, {
      pendingSync: true,
      pendingCreation: true,
    });
  }

  if (!existing && (!payload || typeof payload !== 'object')) {
    return null;
  }

  const mergedRecord = normalizeProjectRecord({
    ...(existing || { id: projectId, name: 'Offline Project' }),
    ...(payload || {}),
    id: projectId,
    userId,
    updatedAt:
      (existing && existing.updatedAt) ||
      mutation.expectedUpdatedAt ||
      nowIso,
  });

  return cacheProjectOffline(mergedRecord, userId, {
    pendingSync: true,
    pendingCreation: Boolean(existing && existing._pendingCreation),
  });
}

/**
 * Applies a queued checklist mutation optimistically to the user's offline checklist cache
 * so offline checklist creations, edits, item toggles, and deletions persist across restarts.
 */
export async function applyChecklistMutationToOfflineCache(userId, mutation) {
  const {
    checklistId,
    operationType,
    payload,
    expectedUpdatedAt,
    id: opId,
    status: opStatus,
  } = mutation;
  if (!userId || !checklistId) return null;

  if (operationType === 'DELETE') {
    await removeCachedChecklistOffline(checklistId, userId);
    return null;
  }

  const existing = await getCachedChecklistById(checklistId, userId, true);
  const nowIso = new Date().toISOString();

  if (operationType === 'CREATE') {
    const createdRecord = normalizeChecklistRecord({
      ...(existing || {}),
      ...(payload || {}),
      id: checklistId,
      userId,
      createdAt:
        (payload && payload.createdAt) ||
        (existing && existing.createdAt) ||
        nowIso,
      updatedAt:
        (payload && payload.updatedAt) ||
        (existing && existing.updatedAt) ||
        nowIso,
      _pendingSync: true,
      _pendingCreation: true,
      _syncStatus: opStatus || 'pending',
      _syncOpId: opId || null,
      _syncError: null,
      _conflictDetails: null,
    });
    return cacheChecklistOffline(createdRecord, userId, {
      pendingSync: true,
      pendingCreation: true,
      syncStatus: opStatus || 'pending',
      syncOpId: opId || null,
      syncError: null,
      conflictDetails: null,
    });
  }

  if (!existing && (!payload || typeof payload !== 'object')) {
    return null;
  }

  const baselineUpdatedAt =
    (existing && (existing._serverUpdatedAt || existing.updatedAt)) ||
    expectedUpdatedAt ||
    null;

  const mergedRecord = normalizeChecklistRecord({
    ...(existing || { id: checklistId, title: 'Offline Checklist' }),
    ...(payload || {}),
    id: checklistId,
    userId,
    updatedAt: baselineUpdatedAt || nowIso,
    _serverUpdatedAt: baselineUpdatedAt,
    _pendingSync: true,
    _pendingCreation: Boolean(existing && existing._pendingCreation),
    _syncStatus: opStatus || 'pending',
    _syncOpId: opId || (existing && existing._syncOpId) || null,
    _syncError: null,
    _conflictDetails: null,
  });

  return cacheChecklistOffline(mergedRecord, userId, {
    pendingSync: true,
    pendingCreation: Boolean(existing && existing._pendingCreation),
    syncStatus: opStatus || 'pending',
    syncOpId: opId || (existing && existing._syncOpId) || null,
    serverUpdatedAt: baselineUpdatedAt,
    syncError: null,
    conflictDetails: null,
  });
}

/**
 * Queues a checklist mutation (`CREATE`, `UPDATE`, `DELETE`, or item mutations)
 * into the existing persistent per-user offline queue (`@qavora_pending_project_ops_v1:<userId>`)
 * with coalescing and dependency ordering.
 *
 * @param {object} mutation
 * @returns {Promise<object>}
 */
export async function queueChecklistMutation({
  userId,
  checklistId,
  projectId = null,
  operationType = 'UPDATE',
  mutationSubType = null,
  payload = {},
  expectedUpdatedAt = null,
  description = '',
} = {}) {
  const targetUserId = String(userId || '').trim();
  const cleanChecklistId = String(checklistId || '').trim();

  if (!targetUserId) {
    throw new Error('userId is required to queue an offline checklist mutation.');
  }
  if (!cleanChecklistId) {
    throw new Error('checklistId is required to queue an offline checklist mutation.');
  }

  const nowIso = new Date().toISOString();
  const idempotencyKey = buildChecklistOperationIdempotencyKey({
    userId: targetUserId,
    checklistId: cleanChecklistId,
    operationType,
  });

  const existingOps = await getPendingProjectOperations(targetUserId);

  const pendingCreateIdx = existingOps.findIndex(
    (op) =>
      op.entityType === 'checklist' &&
      (op.checklistId === cleanChecklistId || op.entityId === cleanChecklistId) &&
      op.operationType === 'CREATE' &&
      (op.status === 'pending' || op.status === 'failed')
  );

  if (pendingCreateIdx !== -1) {
    const pendingCreateOp = existingOps[pendingCreateIdx];

    if (operationType === 'DELETE') {
      const remainingOps = existingOps.filter(
        (op) =>
          !(
            op.entityType === 'checklist' &&
            (op.checklistId === cleanChecklistId ||
              op.entityId === cleanChecklistId)
          )
      );
      await savePendingProjectOperations(targetUserId, remainingOps);
      await removeCachedChecklistOffline(cleanChecklistId, targetUserId);
      notifySyncListeners({
        type: 'checklist_mutation_cancelled_out',
        entityType: 'checklist',
        userId: targetUserId,
        checklistId: cleanChecklistId,
      });
      return {
        cancelledOut: true,
        dequeuedId: pendingCreateOp.id,
        checklistId: cleanChecklistId,
      };
    }

    if (operationType === 'UPDATE') {
      const mergedPayload = {
        ...(pendingCreateOp.payload || {}),
        ...(payload || {}),
        id: cleanChecklistId,
      };
      delete mergedPayload.deletedItemIds;
      delete mergedPayload.expectedUpdatedAt;

      const mergedCreateOp = {
        ...pendingCreateOp,
        projectId:
          mergedPayload.projectId !== undefined
            ? mergedPayload.projectId
            : pendingCreateOp.projectId || projectId || null,
        payload: mergedPayload,
        updatedAt: nowIso,
        status: 'pending',
        retryCount: 0,
        nextRetryAt: null,
        lastError: null,
      };

      const updatedList = [...existingOps];
      updatedList[pendingCreateIdx] = mergedCreateOp;
      await savePendingProjectOperations(targetUserId, updatedList);
      await applyChecklistMutationToOfflineCache(targetUserId, {
        checklistId: cleanChecklistId,
        operationType: 'CREATE',
        payload: mergedCreateOp.payload,
        id: mergedCreateOp.id,
        status: 'pending',
      });
      notifySyncListeners({
        type: 'checklist_mutation_coalesced',
        entityType: 'checklist',
        userId: targetUserId,
        checklistId: cleanChecklistId,
        operation: mergedCreateOp,
      });
      return mergedCreateOp;
    }
  }

  const matchingIdx = existingOps.findIndex(
    (op) =>
      op.idempotencyKey === idempotencyKey &&
      (op.status === 'pending' || op.status === 'failed')
  );

  if (matchingIdx !== -1) {
    const existingOp = existingOps[matchingIdx];
    const prevDeletedIds = Array.isArray(existingOp.payload?.deletedItemIds)
      ? existingOp.payload.deletedItemIds
      : [];
    const nextDeletedIds = Array.isArray(payload?.deletedItemIds)
      ? payload.deletedItemIds
      : [];
    const combinedDeletedIds = Array.from(
      new Set([...prevDeletedIds, ...nextDeletedIds])
    );

    const mergedPayload =
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? {
            ...(existingOp.payload || {}),
            ...payload,
            ...(combinedDeletedIds.length > 0
              ? { deletedItemIds: combinedDeletedIds }
              : {}),
          }
        : payload;

    const coalescedOp = {
      ...existingOp,
      entityType: 'checklist',
      checklistId: cleanChecklistId,
      entityId: cleanChecklistId,
      projectId:
        mergedPayload && mergedPayload.projectId !== undefined
          ? mergedPayload.projectId
          : existingOp.projectId || projectId || null,
      mutationSubType:
        mutationSubType || existingOp.mutationSubType || operationType.toLowerCase(),
      payload: mergedPayload,
      expectedUpdatedAt: existingOp.expectedUpdatedAt || expectedUpdatedAt || null,
      description: description || existingOp.description || '',
      updatedAt: nowIso,
      status: 'pending',
      retryCount: 0,
      nextRetryAt: null,
      lastError: null,
    };

    const nextOps = [...existingOps];
    nextOps[matchingIdx] = coalescedOp;
    await savePendingProjectOperations(targetUserId, nextOps);
    await applyChecklistMutationToOfflineCache(targetUserId, coalescedOp);

    notifySyncListeners({
      type: 'checklist_mutation_coalesced',
      entityType: 'checklist',
      userId: targetUserId,
      checklistId: cleanChecklistId,
      operation: coalescedOp,
    });
    return coalescedOp;
  }

  let filteredOps = existingOps;
  if (operationType === 'DELETE') {
    filteredOps = existingOps.filter(
      (op) =>
        !(
          op.entityType === 'checklist' &&
          (op.checklistId === cleanChecklistId ||
            op.entityId === cleanChecklistId) &&
          op.status !== 'syncing'
        )
    );
  }

  const seq = nextMonotonicSeq();
  const record = {
    id: `cop_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    idempotencyKey,
    seq,
    userId: targetUserId,
    projectId:
      projectId ||
      (payload && payload.projectId ? String(payload.projectId) : null),
    checklistId: cleanChecklistId,
    entityType: 'checklist',
    entityId: cleanChecklistId,
    operationType,
    mutationSubType: mutationSubType || operationType.toLowerCase(),
    payload: payload || {},
    expectedUpdatedAt: expectedUpdatedAt || null,
    description:
      description ||
      `${operationType} checklist (${cleanChecklistId})`,
    createdAt: nowIso,
    updatedAt: nowIso,
    retryCount: 0,
    maxRetries: DEFAULT_MAX_RETRIES,
    backoffDelayMs: BASE_BACKOFF_MS,
    nextRetryAt: null,
    status: 'pending',
    requiresManualResolution: false,
    conflictDetails: null,
    lastError: null,
  };

  const nextOps = sortProjectOperations([...filteredOps, record]);
  await savePendingProjectOperations(targetUserId, nextOps);
  await applyChecklistMutationToOfflineCache(targetUserId, record);

  notifySyncListeners({
    type: 'checklist_mutation_queued',
    entityType: 'checklist',
    userId: targetUserId,
    checklistId: cleanChecklistId,
    operation: record,
  });

  return record;
}

/**
 * Queues a project or project-data mutation for background synchronization,
 * with automatic deduplication and coalescing matching Qavora Web's
 * `queueProjectMutation` (`qaChecklistSyncQueue.js:116–205`).
 *
 * @param {object} mutation
 * @returns {Promise<object>}
 */
export async function queueProjectMutation({
  userId,
  projectId,
  entityType = 'project',
  entityId = null,
  operationType = 'UPDATE',
  payload = {},
  expectedUpdatedAt = null,
  description = '',
  deletionTombstones = null,
} = {}) {
  const targetUserId = String(userId || '').trim();
  const cleanProjectId = String(projectId || '').trim();

  if (!targetUserId) {
    throw new Error('userId is required to queue an offline project mutation.');
  }
  if (!cleanProjectId) {
    throw new Error('projectId is required to queue an offline project mutation.');
  }

  const nowIso = new Date().toISOString();
  const normalizedEntityType =
    entityType === 'project' ? 'project' : entityType || 'data';
  const effectiveEntityKey =
    normalizedEntityType === 'project' ? 'project' : 'data';

  const cleanPayload =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? { ...payload }
      : payload || {};
  if (
    cleanPayload &&
    typeof cleanPayload === 'object' &&
    !Array.isArray(cleanPayload) &&
    'deletionTombstones' in cleanPayload
  ) {
    delete cleanPayload.deletionTombstones;
  }

  const idempotencyKey = buildOperationIdempotencyKey({
    userId: targetUserId,
    projectId: cleanProjectId,
    entityType: effectiveEntityKey,
    entityId: normalizedEntityType === 'project' ? entityId : 'workspace_data',
    operationType,
  });

  const existingOps = await getPendingProjectOperations(targetUserId);

  const pendingCreateIdx = existingOps.findIndex(
    (op) =>
      op.projectId === cleanProjectId &&
      op.entityType === 'project' &&
      op.operationType === 'CREATE' &&
      (op.status === 'pending' || op.status === 'failed')
  );

  if (pendingCreateIdx !== -1) {
    const pendingCreateOp = existingOps[pendingCreateIdx];

    if (normalizedEntityType === 'project' && operationType === 'DELETE') {
      const remainingOps = existingOps.filter(
        (op) => op.projectId !== cleanProjectId || op.entityType === 'checklist'
      );
      await savePendingProjectOperations(targetUserId, remainingOps);
      await clearProjectDeletionTombstones(targetUserId, cleanProjectId);
      await removeCachedProjectOffline(cleanProjectId, targetUserId);
      notifySyncListeners({
        type: 'mutation_cancelled_out',
        userId: targetUserId,
        projectId: cleanProjectId,
      });
      return {
        cancelledOut: true,
        dequeuedId: pendingCreateOp.id,
        projectId: cleanProjectId,
      };
    }

    if (
      normalizedEntityType === 'project' &&
      (operationType === 'UPDATE' || operationType === 'STATUS_CHANGE')
    ) {
      const mergedCreateOp = {
        ...pendingCreateOp,
        payload: {
          ...(pendingCreateOp.payload || {}),
          ...(cleanPayload || {}),
        },
        updatedAt: nowIso,
        status: 'pending',
        retryCount: 0,
        nextRetryAt: null,
        lastError: null,
      };
      const updatedList = [...existingOps];
      updatedList[pendingCreateIdx] = mergedCreateOp;
      await savePendingProjectOperations(targetUserId, updatedList);
      await applyMutationToOfflineCache(targetUserId, {
        projectId: cleanProjectId,
        entityType: 'project',
        operationType: 'CREATE',
        payload: mergedCreateOp.payload,
      });
      notifySyncListeners({
        type: 'mutation_coalesced',
        userId: targetUserId,
        projectId: cleanProjectId,
        operation: mergedCreateOp,
      });
      return mergedCreateOp;
    }
  }

  const matchingIdx = existingOps.findIndex(
    (op) =>
      op.idempotencyKey === idempotencyKey &&
      (op.status === 'pending' || op.status === 'failed')
  );

  const computeEffectiveTombstones = async (existingOpTombstones = null) => {
    if (normalizedEntityType === 'project') {
      return createEmptyDeletionTombstones();
    }
    const stored = await getProjectDeletionTombstones(
      targetUserId,
      cleanProjectId
    );
    const combined = mergeDeletionTombstones(
      mergeDeletionTombstones(stored, existingOpTombstones),
      deletionTombstones
    );
    const reAdded = extractActiveIdsFromProjectDataPayload(cleanPayload);
    const nextTombstones = subtractDeletionTombstones(combined, reAdded);
    await saveProjectDeletionTombstones(
      targetUserId,
      cleanProjectId,
      nextTombstones
    );
    return nextTombstones;
  };

  if (matchingIdx !== -1) {
    const existingOp = existingOps[matchingIdx];
    const nextTombstones = await computeEffectiveTombstones(
      existingOp.deletionTombstones
    );
    const coalescedOp = {
      ...existingOp,
      entityType: normalizedEntityType,
      payload:
        cleanPayload &&
        typeof cleanPayload === 'object' &&
        !Array.isArray(cleanPayload)
          ? { ...(existingOp.payload || {}), ...cleanPayload }
          : cleanPayload,
      expectedUpdatedAt: existingOp.expectedUpdatedAt || expectedUpdatedAt || null,
      description: description || existingOp.description || '',
      updatedAt: nowIso,
      status: 'pending',
      retryCount: 0,
      nextRetryAt: null,
      lastError: null,
    };
    if (hasAnyDeletionTombstones(nextTombstones)) {
      coalescedOp.deletionTombstones = nextTombstones;
    } else {
      delete coalescedOp.deletionTombstones;
    }

    const nextOps = [...existingOps];
    nextOps[matchingIdx] = coalescedOp;
    await savePendingProjectOperations(targetUserId, nextOps);
    await applyMutationToOfflineCache(targetUserId, coalescedOp);

    notifySyncListeners({
      type: 'mutation_coalesced',
      userId: targetUserId,
      projectId: cleanProjectId,
      operation: coalescedOp,
    });
    return coalescedOp;
  }

  let filteredOps = existingOps;
  if (normalizedEntityType === 'project' && operationType === 'DELETE') {
    filteredOps = existingOps.filter(
      (op) =>
        op.entityType === 'checklist' ||
        op.projectId !== cleanProjectId ||
        op.status === 'syncing'
    );
    await clearProjectDeletionTombstones(targetUserId, cleanProjectId);
  }

  const nextTombstones = await computeEffectiveTombstones(null);
  const seq = nextMonotonicSeq();
  const record = {
    id: `pop_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    idempotencyKey,
    seq,
    userId: targetUserId,
    projectId: cleanProjectId,
    entityType: normalizedEntityType,
    entityId: entityId || null,
    operationType,
    payload: cleanPayload || {},
    expectedUpdatedAt: expectedUpdatedAt || null,
    description:
      description ||
      `${operationType} ${normalizedEntityType} (${cleanProjectId})`,
    createdAt: nowIso,
    updatedAt: nowIso,
    retryCount: 0,
    maxRetries: DEFAULT_MAX_RETRIES,
    backoffDelayMs: BASE_BACKOFF_MS,
    nextRetryAt: null,
    status: 'pending',
    requiresManualResolution: false,
    conflictDetails: null,
    lastError: null,
    ...(hasAnyDeletionTombstones(nextTombstones)
      ? { deletionTombstones: nextTombstones }
      : {}),
  };

  const nextOps = sortProjectOperations([...filteredOps, record]);
  await savePendingProjectOperations(targetUserId, nextOps);
  await applyMutationToOfflineCache(targetUserId, record);

  notifySyncListeners({
    type: 'mutation_queued',
    userId: targetUserId,
    projectId: cleanProjectId,
    operation: record,
  });

  return record;
}

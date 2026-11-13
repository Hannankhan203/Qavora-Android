/**
 * Qavora Android — Offline-First Cache & Synchronization Engine (Phases 2F & 3A)
 *
 * Implements parity with Qavora Web's `src/modules/qaChecklistSyncQueue.js`
 * for React Native / Expo using per-user AsyncStorage persistence and native
 * Android / iOS / Web network monitoring (`@react-native-community/netinfo`):
 * 1. Per-User Offline Project Cache (`@qavora_offline_projects_cache_v1:<userId>`)
 * 2. Durable Per-User Offline Mutation Queue (`@qavora_pending_project_ops_v1:<userId>`)
 * 3. Idempotent Operation Coalescing & Dependency Ordering
 * 4. In-Memory + Persistent TTL Sync Lock (`@qavora_sync_locks_v1:<userId>`) with
 *    Generation Ownership Verification (`dequeueProjectOperationIfLockValid`)
 * 5. Chained `expectedUpdatedAt` Advancement Across Same-Project Operations
 * 6. Safe HTTP 409 Conflict Capture & Explicit Resolution (`merge` / `keep_local`
 *    vs `keep_server` / `discard_local`)
 * 7. Strict Multi-User Isolation & Logout Preservation
 * 8. Native Android (`@react-native-community/netinfo`) + Web (`window` online/offline)
 *    + `AppState` Connectivity Monitoring with Offline-to-Online Transition Deduplication
 */

import {
  fetchProjectById,
  createProject as createProjectApi,
  updateProjectMetadata as updateProjectMetadataApi,
  updateProjectStatus as updateProjectStatusApi,
  updateProjectData as updateProjectDataApi,
  deleteProject as deleteProjectApi,
  extractSuiteTestCases,
} from './projectService.js';
import {
  fetchChecklistById as fetchChecklistByIdApi,
  createChecklist as createChecklistApi,
  updateChecklist as updateChecklistApi,
  deleteChecklist as deleteChecklistApi,
} from './checklistService.js';
import {
  cacheChecklistOffline,
  removeCachedChecklistOffline,
  getCachedChecklistById,
} from './checklists/checklistCache.js';
import {
  OFFLINE_PROJECTS_CACHE_PREFIX,
  PENDING_PROJECT_OPS_PREFIX,
  SYNC_LOCK_STORAGE_PREFIX,
  BASE_BACKOFF_MS,
  MAX_BACKOFF_MS,
  DEFAULT_MAX_RETRIES,
  activeMemoryLocks,
  getOfflineSyncStorageAdapter,
  setOfflineSyncStorageAdapter,
  setNetInfoAdapterForTesting,
  setAppStateAdapterForTesting,
  setReconnectDebounceMsForTesting,
  setActiveSyncUser,
  getActiveSyncUser,
  isSimulatedOfflineMode,
  getRawNetworkConnectivityState,
  getNetworkConnectivityState,
  isClientOffline,
  subscribeToSyncEvents,
  notifySyncListeners,
} from './offlineSync/syncState.js';
import {
  registerProcessQueueRunner,
  evaluateNetInfoState,
  subscribeToReconnectSyncResults,
  triggerReconnectSyncForUser,
  handleConnectivityStateChange,
  checkInitialConnectivity,
  startConnectivityMonitoring,
  stopAllConnectivityMonitoring,
  resetConnectivityStateForTesting,
  setSimulatedOfflineMode,
  setOfflineModeForTesting,
} from './offlineSync/syncConnectivity.js';
import {
  cacheProjectOffline,
  cacheProjectsListOffline,
  removeCachedProjectOffline,
  getCachedProjectsForUser,
  getCachedProjectById,
} from './offlineSync/offlineProjectCache.js';
import {
  acquireSyncLock,
  verifySyncLockOwnership,
  releaseSyncLock,
} from './offlineSync/syncLocks.js';
import {
  buildOperationIdempotencyKey,
  buildChecklistOperationIdempotencyKey,
  sortProjectOperations,
  getPendingProjectOperations,
  getPendingChecklistOperations,
  savePendingProjectOperations,
  dequeueProjectOperation,
  dequeueProjectOperationIfLockValid,
} from './offlineSync/pendingQueueRead.js';
import {
  applyChecklistMutationToOfflineCache,
  queueChecklistMutation,
  queueProjectMutation,
} from './offlineSync/pendingQueueMutations.js';

export {
  OFFLINE_PROJECTS_CACHE_PREFIX,
  PENDING_PROJECT_OPS_PREFIX,
  SYNC_LOCK_STORAGE_PREFIX,
  getOfflineSyncStorageAdapter,
  setOfflineSyncStorageAdapter,
  setNetInfoAdapterForTesting,
  setAppStateAdapterForTesting,
  setReconnectDebounceMsForTesting,
  resetConnectivityStateForTesting,
  setActiveSyncUser,
  getActiveSyncUser,
  getNetworkConnectivityState,
  evaluateNetInfoState,
  subscribeToReconnectSyncResults,
  triggerReconnectSyncForUser,
  handleConnectivityStateChange,
  checkInitialConnectivity,
  startConnectivityMonitoring,
  stopAllConnectivityMonitoring,
  setSimulatedOfflineMode,
  setOfflineModeForTesting,
  isClientOffline,
  subscribeToSyncEvents,
  cacheProjectOffline,
  cacheProjectsListOffline,
  removeCachedProjectOffline,
  getCachedProjectsForUser,
  getCachedProjectById,
  buildOperationIdempotencyKey,
  buildChecklistOperationIdempotencyKey,
  sortProjectOperations,
  getPendingProjectOperations,
  getPendingChecklistOperations,
  queueChecklistMutation,
  queueProjectMutation,
  dequeueProjectOperation,
  acquireSyncLock,
  verifySyncLockOwnership,
  releaseSyncLock,
  dequeueProjectOperationIfLockValid,
};

// ============================================================================
// 4. SYNC STATUS & QUEUE PROCESSING ENGINE
// ============================================================================

/**
 * Computes the current offline synchronization summary for a user,
 * including both project operations and checklist operations.
 *
 * @param {string} userId
 * @returns {Promise<object>}
 */
export async function getProjectSyncStatus(userId) {
  const targetUserId = String(userId || '').trim();
  const online = !isClientOffline();
  const simulatedOfflineMode = isSimulatedOfflineMode();
  const networkConnectivityState = getRawNetworkConnectivityState();

  if (!targetUserId) {
    return {
      online,
      simulatedOffline: simulatedOfflineMode,
      connectionType: networkConnectivityState.type,
      isConnected: networkConnectivityState.isConnected,
      isInternetReachable: networkConnectivityState.isInternetReachable,
      connectivityReason: simulatedOfflineMode
        ? 'simulated_offline'
        : networkConnectivityState.reason,
      isSyncing: false,
      totalQueued: 0,
      pendingCount: 0,
      syncingCount: 0,
      conflictCount: 0,
      failedCount: 0,
      operations: [],
      checklistOperations: [],
      totalChecklistQueued: 0,
      checklistPendingCount: 0,
      checklistSyncingCount: 0,
      checklistConflictCount: 0,
      checklistFailedCount: 0,
    };
  }

  const ops = await getPendingProjectOperations(targetUserId);
  const memLock = activeMemoryLocks.get(targetUserId);
  const isSyncing = Boolean(memLock && memLock.expiresAt > Date.now());

  const pendingCount = ops.filter((o) => o.status === 'pending').length;
  const syncingCount = ops.filter((o) => o.status === 'syncing').length;
  const conflictCount = ops.filter((o) => o.status === 'conflict').length;
  const failedCount = ops.filter((o) => o.status === 'failed').length;

  const checklistOps = ops.filter((o) => o.entityType === 'checklist');
  const checklistPendingCount = checklistOps.filter(
    (o) => o.status === 'pending'
  ).length;
  const checklistSyncingCount = checklistOps.filter(
    (o) => o.status === 'syncing'
  ).length;
  const checklistConflictCount = checklistOps.filter(
    (o) => o.status === 'conflict'
  ).length;
  const checklistFailedCount = checklistOps.filter(
    (o) => o.status === 'failed'
  ).length;

  return {
    online,
    simulatedOffline: simulatedOfflineMode,
    connectionType: networkConnectivityState.type,
    isConnected: networkConnectivityState.isConnected,
    isInternetReachable: networkConnectivityState.isInternetReachable,
    connectivityReason: simulatedOfflineMode
      ? 'simulated_offline'
      : networkConnectivityState.reason,
    isSyncing: isSyncing || syncingCount > 0,
    totalQueued: ops.length,
    pendingCount,
    syncingCount,
    conflictCount,
    failedCount,
    operations: ops,
    checklistOperations: checklistOps,
    totalChecklistQueued: checklistOps.length,
    checklistPendingCount,
    checklistSyncingCount,
    checklistConflictCount,
    checklistFailedCount,
  };
}

/**
 * Executes a single queued project or checklist operation against the backend API.
 */
async function executeQueuedOperationAgainstBackend(op, options = {}) {
  const {
    projectId,
    checklistId,
    entityId,
    entityType,
    operationType,
    payload,
    expectedUpdatedAt,
    userId,
  } = op;

  if (entityType === 'checklist') {
    const targetChecklistId = String(checklistId || entityId || '').trim();
    const checklistOptions = {
      ...options,
      skipOfflineQueue: true,
      userId,
    };

    if (operationType === 'CREATE') {
      const createPayload = {
        ...(payload || {}),
        id: targetChecklistId,
      };
      return createChecklistApi(createPayload, checklistOptions);
    }

    if (operationType === 'UPDATE') {
      const updatePayload = {
        ...(payload || {}),
        ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
      };
      return updateChecklistApi(
        targetChecklistId,
        updatePayload,
        checklistOptions
      );
    }

    if (operationType === 'DELETE') {
      return deleteChecklistApi(targetChecklistId, checklistOptions);
    }
  }

  if (entityType === 'project' && operationType === 'CREATE') {
    const createPayload = {
      ...(payload || {}),
      id: projectId,
    };
    return createProjectApi(createPayload, options);
  }

  if (entityType === 'project' && operationType === 'STATUS_CHANGE') {
    const nextStatus = (payload && payload.status) || 'Active';
    return updateProjectStatusApi(projectId, nextStatus, options);
  }

  if (entityType === 'project' && operationType === 'UPDATE') {
    return updateProjectMetadataApi(projectId, payload || {}, {
      ...options,
      ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
    });
  }

  if (entityType === 'project' && operationType === 'DELETE') {
    return deleteProjectApi(projectId, options);
  }

  // Child QA data update (`PATCH /api/projects/:id/data`)
  return updateProjectDataApi(projectId, payload || {}, {
    ...options,
    ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
  });
}

/**
 * Processes all pending project and checklist operations for `userId` in dependency order.
 *
 * Guarantees:
 * - Exclusive per-user sync lock prevents concurrent duplicate executions
 * - Chained `expectedUpdatedAt` advancement across operations on the same project or checklist
 * - HTTP 409 conflicts are captured (`status: 'conflict'`, `requiresManualResolution: true`)
 *   and never silently overwrite server data
 * - Network/5xx errors retain operations in the queue with backoff retry metadata
 *
 * @param {string} userId
 * @param {object} [options]
 * @returns {Promise<{ synced: number, failed: number, conflicts: number, skipped?: boolean, reason?: string, updatedProjects: Array<object>, updatedChecklists: Array<object> }>}
 */
export async function processProjectSyncQueue(userId, options = {}) {
  const targetUserId = String(userId || '').trim();
  if (!targetUserId) {
    return {
      synced: 0,
      failed: 0,
      conflicts: 0,
      skipped: true,
      reason: 'missing_user_id',
      updatedProjects: [],
      updatedChecklists: [],
    };
  }

  // Enforce strict user isolation: never sync User A's queue while User B is authenticated
  const currentActiveUser = getActiveSyncUser();
  if (
    !options.allowInactiveUser &&
    currentActiveUser !== null &&
    targetUserId !== currentActiveUser
  ) {
    return {
      synced: 0,
      failed: 0,
      conflicts: 0,
      skipped: true,
      reason: 'user_mismatch',
      updatedProjects: [],
      updatedChecklists: [],
    };
  }

  if (isClientOffline() && !options.ignoreOfflineCheck) {
    return {
      synced: 0,
      failed: 0,
      conflicts: 0,
      skipped: true,
      reason: 'offline',
      updatedProjects: [],
      updatedChecklists: [],
    };
  }

  const lock = await acquireSyncLock(targetUserId);
  if (!lock) {
    return {
      synced: 0,
      failed: 0,
      conflicts: 0,
      skipped: true,
      reason: 'already_syncing',
      updatedProjects: [],
      updatedChecklists: [],
    };
  }

  let synced = 0;
  let failed = 0;
  let conflicts = 0;
  const updatedProjectsMap = new Map();
  const updatedChecklistsMap = new Map();

  notifySyncListeners({
    type: 'sync_started',
    userId: targetUserId,
  });

  try {
    const allOps = await getPendingProjectOperations(targetUserId);
    const now = Date.now();

    const eligibleOps = allOps.filter((op) => {
      if (op.status === 'conflict' || op.requiresManualResolution) {
        return false;
      }
      if (op.status === 'failed' && !options.retryFailed) {
        return false;
      }
      if (
        !options.ignoreBackoff &&
        op.nextRetryAt &&
        new Date(op.nextRetryAt).getTime() > now
      ) {
        return false;
      }
      return true;
    });

    if (eligibleOps.length === 0) {
      return {
        synced: 0,
        failed: 0,
        conflicts: 0,
        updatedProjects: [],
        updatedChecklists: [],
      };
    }

    // Track projects and checklists that encountered a failure or conflict during this pass
    // so dependent operations on the same entity don't execute out of order
    const haltedProjectIds = new Set();
    const haltedChecklistIds = new Set();
    allOps.forEach((op) => {
      if (op.status === 'conflict' || op.requiresManualResolution) {
        if (op.entityType === 'checklist') {
          haltedChecklistIds.add(String(op.checklistId || op.entityId || ''));
        } else if (op.projectId) {
          haltedProjectIds.add(op.projectId);
        }
      }
    });

    // Track chained updatedAt advancement per project and per checklist within this sync pass
    const latestUpdatedAtByProject = new Map();
    const latestUpdatedAtByChecklist = new Map();

    for (const op of eligibleOps) {
      if (isClientOffline() && !options.ignoreOfflineCheck) {
        break;
      }

      const loopActiveUser = getActiveSyncUser();
      if (
        !options.allowInactiveUser &&
        loopActiveUser !== null &&
        targetUserId !== loopActiveUser
      ) {
        break;
      }

      const stillOwnsLock = await verifySyncLockOwnership(targetUserId, lock);
      if (!stillOwnsLock) {
        break;
      }

      const isChecklistOp = op.entityType === 'checklist';
      const targetChecklistId = isChecklistOp
        ? String(op.checklistId || op.entityId || '').trim()
        : '';

      if (isChecklistOp) {
        if (haltedChecklistIds.has(targetChecklistId)) {
          continue;
        }
      } else if (haltedProjectIds.has(op.projectId)) {
        continue;
      }

      // Advance expectedUpdatedAt if a preceding operation in this pass updated the same entity
      const effectiveOp = {
        ...op,
        expectedUpdatedAt: isChecklistOp
          ? latestUpdatedAtByChecklist.get(targetChecklistId) ||
            op.expectedUpdatedAt ||
            null
          : latestUpdatedAtByProject.get(op.projectId) ||
            op.expectedUpdatedAt ||
            null,
      };

      const result = await executeQueuedOperationAgainstBackend(
        effectiveOp,
        options.apiOptions || {}
      );

      // Verify lock ownership and active user isolation again after async network request
      const lockValidAfterCall = await verifySyncLockOwnership(
        targetUserId,
        lock
      );
      if (!lockValidAfterCall) {
        break;
      }

      const postCallActiveUser = getActiveSyncUser();
      if (
        !options.allowInactiveUser &&
        postCallActiveUser !== null &&
        targetUserId !== postCallActiveUser
      ) {
        break;
      }

      // ======================================================================
      // A. CHECKLIST OPERATION RESULT HANDLING
      // ======================================================================
      if (isChecklistOp) {
        if (result.ok) {
          await dequeueProjectOperationIfLockValid(op.id, targetUserId, lock);
          synced += 1;

          if (op.operationType === 'DELETE') {
            await removeCachedChecklistOffline(targetChecklistId, targetUserId);
            latestUpdatedAtByChecklist.delete(targetChecklistId);
          } else if (result.checklist) {
            const syncedChecklist = result.checklist;
            if (syncedChecklist.updatedAt) {
              latestUpdatedAtByChecklist.set(
                targetChecklistId,
                syncedChecklist.updatedAt
              );
            }
            const cachedClean = await cacheChecklistOffline(
              syncedChecklist,
              targetUserId,
              {
                pendingSync: false,
                pendingCreation: false,
                syncStatus: 'synced',
                syncOpId: null,
                syncError: null,
                conflictDetails: null,
                serverUpdatedAt: syncedChecklist.updatedAt || null,
              }
            );
            updatedChecklistsMap.set(
              syncedChecklist.id,
              cachedClean || syncedChecklist
            );
          }
          continue;
        }

        // If DELETE returns 404, the checklist is already gone on the server; treat as synced
        if (op.operationType === 'DELETE' && result.status === 404) {
          await dequeueProjectOperationIfLockValid(op.id, targetUserId, lock);
          await removeCachedChecklistOffline(targetChecklistId, targetUserId);
          latestUpdatedAtByChecklist.delete(targetChecklistId);
          synced += 1;
          continue;
        }

        // If CREATE returns 409 (already created by an earlier interrupted request), fetch latest & dequeue
        if (
          op.operationType === 'CREATE' &&
          (result.status === 409 || result.isConflict)
        ) {
          const fetched = await fetchChecklistByIdApi(targetChecklistId, {
            ...(options.apiOptions || {}),
            userId: targetUserId,
            ignorePendingLocal: true,
          });
          if (fetched.ok && fetched.checklist) {
            await dequeueProjectOperationIfLockValid(op.id, targetUserId, lock);
            const cachedClean = await cacheChecklistOffline(
              fetched.checklist,
              targetUserId,
              {
                pendingSync: false,
                pendingCreation: false,
                syncStatus: 'synced',
                syncOpId: null,
                syncError: null,
                conflictDetails: null,
                serverUpdatedAt: fetched.checklist.updatedAt || null,
              }
            );
            if (fetched.checklist.updatedAt) {
              latestUpdatedAtByChecklist.set(
                targetChecklistId,
                fetched.checklist.updatedAt
              );
            }
            updatedChecklistsMap.set(
              fetched.checklist.id,
              cachedClean || fetched.checklist
            );
            synced += 1;
            continue;
          }
        }

        // Handle HTTP 409 Optimistic Concurrency Conflict safely (never overwrite server data)
        if (result.status === 409 || result.isConflict) {
          let serverChecklist = result.serverChecklist || null;
          if (!serverChecklist) {
            try {
              const latestRes = await fetchChecklistByIdApi(targetChecklistId, {
                ...(options.apiOptions || {}),
                userId: targetUserId,
                ignorePendingLocal: true,
              });
              if (latestRes.ok && latestRes.checklist) {
                serverChecklist = latestRes.checklist;
              }
            } catch {
              // Ignore secondary fetch error
            }
          }

          const conflictMessage =
            result.error ||
            'Conflict: Checklist was modified on the server since your offline edits began.';
          const conflictDetails = {
            detectedAt: new Date().toISOString(),
            expectedUpdatedAt: effectiveOp.expectedUpdatedAt || null,
            currentUpdatedAt:
              result.currentUpdatedAt ||
              (serverChecklist && serverChecklist.updatedAt) ||
              null,
            serverChecklist,
            localPayload: op.payload,
            message: conflictMessage,
          };

          const currentOps = await getPendingProjectOperations(targetUserId);
          const updatedOps = currentOps.map((item) => {
            if (item.id !== op.id) return item;
            return {
              ...item,
              status: 'conflict',
              requiresManualResolution: true,
              updatedAt: new Date().toISOString(),
              lastError: conflictMessage,
              conflictDetails,
            };
          });
          await savePendingProjectOperations(targetUserId, updatedOps);

          const cachedLocal = await getCachedChecklistById(
            targetChecklistId,
            targetUserId,
            true
          );
          if (cachedLocal) {
            await cacheChecklistOffline(cachedLocal, targetUserId, {
              pendingSync: true,
              pendingCreation: Boolean(cachedLocal._pendingCreation),
              syncStatus: 'conflict',
              syncOpId: op.id,
              syncError: conflictMessage,
              conflictDetails,
            });
          }

          haltedChecklistIds.add(targetChecklistId);
          conflicts += 1;
          continue;
        }

        // Handle HTTP 401 Unauthorized: halt sync pass without losing pending operations
        if (result.status === 401) {
          break;
        }

        // Handle Network / 5xx / 4xx error: keep in queue with retry count and backoff
        const currentOps = await getPendingProjectOperations(targetUserId);
        const nextRetryCount = (op.retryCount || 0) + 1;
        const maxRetries = op.maxRetries || DEFAULT_MAX_RETRIES;
        const delayMs = Math.min(
          BASE_BACKOFF_MS * Math.pow(2, Math.max(0, nextRetryCount - 1)),
          MAX_BACKOFF_MS
        );
        const reachedMax =
          nextRetryCount >= maxRetries ||
          (result.status >= 400 &&
            result.status < 500 &&
            result.status !== 408 &&
            result.status !== 429);
        const lastErrorMsg =
          result.error || 'Temporary network or server synchronization error.';

        const updatedOps = currentOps.map((item) => {
          if (item.id !== op.id) return item;
          return {
            ...item,
            retryCount: nextRetryCount,
            backoffDelayMs: delayMs,
            nextRetryAt: new Date(Date.now() + delayMs).toISOString(),
            status: reachedMax ? 'failed' : 'pending',
            updatedAt: new Date().toISOString(),
            lastError: lastErrorMsg,
          };
        });

        await savePendingProjectOperations(targetUserId, updatedOps);

        const cachedLocal = await getCachedChecklistById(
          targetChecklistId,
          targetUserId,
          true
        );
        if (cachedLocal) {
          await cacheChecklistOffline(cachedLocal, targetUserId, {
            pendingSync: true,
            pendingCreation: Boolean(cachedLocal._pendingCreation),
            syncStatus: reachedMax ? 'failed' : 'pending',
            syncOpId: op.id,
            syncError: lastErrorMsg,
          });
        }

        haltedChecklistIds.add(targetChecklistId);
        failed += 1;
        continue;
      }

      // ======================================================================
      // B. PROJECT OPERATION RESULT HANDLING
      // ======================================================================
      if (result.ok) {
        await dequeueProjectOperationIfLockValid(op.id, targetUserId, lock);
        synced += 1;

        if (op.entityType === 'project' && op.operationType === 'DELETE') {
          await removeCachedProjectOffline(op.projectId, targetUserId);
          latestUpdatedAtByProject.delete(op.projectId);
        } else if (result.project) {
          const syncedProject = result.project;
          if (syncedProject.updatedAt) {
            latestUpdatedAtByProject.set(op.projectId, syncedProject.updatedAt);
          }
          await cacheProjectOffline(syncedProject, targetUserId, {
            pendingSync: false,
            pendingCreation: false,
          });
          updatedProjectsMap.set(syncedProject.id, syncedProject);
        }
        continue;
      }

      // If DELETE returns 404, the project is already gone on the server; treat as synced
      if (
        op.entityType === 'project' &&
        op.operationType === 'DELETE' &&
        result.status === 404
      ) {
        await dequeueProjectOperationIfLockValid(op.id, targetUserId, lock);
        await removeCachedProjectOffline(op.projectId, targetUserId);
        synced += 1;
        continue;
      }

      // If CREATE returns 409 (already created by an earlier interrupted request), treat as synced or fetch latest
      if (
        op.entityType === 'project' &&
        op.operationType === 'CREATE' &&
        result.isConflict
      ) {
        const fetched = await fetchProjectById(
          op.projectId,
          options.apiOptions || {}
        );
        if (fetched.ok && fetched.project) {
          await dequeueProjectOperationIfLockValid(op.id, targetUserId, lock);
          await cacheProjectOffline(fetched.project, targetUserId, {
            pendingSync: false,
            pendingCreation: false,
          });
          if (fetched.project.updatedAt) {
            latestUpdatedAtByProject.set(
              op.projectId,
              fetched.project.updatedAt
            );
          }
          updatedProjectsMap.set(fetched.project.id, fetched.project);
          synced += 1;
          continue;
        }
      }

      // Handle HTTP 409 Optimistic Concurrency Conflict safely (never overwrite server data)
      if (result.status === 409 || result.isConflict) {
        let serverProject = null;
        try {
          const latestRes = await fetchProjectById(
            op.projectId,
            options.apiOptions || {}
          );
          if (latestRes.ok && latestRes.project) {
            serverProject = latestRes.project;
          }
        } catch {
          // Ignore secondary fetch error
        }

        const currentOps = await getPendingProjectOperations(targetUserId);
        const updatedOps = currentOps.map((item) => {
          if (item.id !== op.id) return item;
          return {
            ...item,
            status: 'conflict',
            requiresManualResolution: true,
            updatedAt: new Date().toISOString(),
            lastError:
              result.error ||
              'Conflict: Project was modified on the server since your offline edits began.',
            conflictDetails: {
              detectedAt: new Date().toISOString(),
              expectedUpdatedAt: effectiveOp.expectedUpdatedAt || null,
              currentUpdatedAt:
                result.currentUpdatedAt ||
                (serverProject && serverProject.updatedAt) ||
                null,
              serverProject,
              localPayload: op.payload,
              message:
                result.error ||
                'Conflict detected between offline edits and newer server state.',
            },
          };
        });
        await savePendingProjectOperations(targetUserId, updatedOps);
        haltedProjectIds.add(op.projectId);
        conflicts += 1;
        continue;
      }

      // Handle HTTP 401 Unauthorized: halt sync pass without losing pending operations
      if (result.status === 401) {
        break;
      }

      // Handle Network / 5xx / 4xx error: keep in queue with retry count and backoff
      const currentOps = await getPendingProjectOperations(targetUserId);
      const nextRetryCount = (op.retryCount || 0) + 1;
      const maxRetries = op.maxRetries || DEFAULT_MAX_RETRIES;
      const delayMs = Math.min(
        BASE_BACKOFF_MS * Math.pow(2, Math.max(0, nextRetryCount - 1)),
        MAX_BACKOFF_MS
      );
      const reachedMax =
        nextRetryCount >= maxRetries ||
        (result.status >= 400 &&
          result.status < 500 &&
          result.status !== 408 &&
          result.status !== 429);

      const updatedOps = currentOps.map((item) => {
        if (item.id !== op.id) return item;
        return {
          ...item,
          retryCount: nextRetryCount,
          backoffDelayMs: delayMs,
          nextRetryAt: new Date(Date.now() + delayMs).toISOString(),
          status: reachedMax ? 'failed' : 'pending',
          updatedAt: new Date().toISOString(),
          lastError:
            result.error || 'Temporary network or server synchronization error.',
        };
      });

      await savePendingProjectOperations(targetUserId, updatedOps);
      haltedProjectIds.add(op.projectId);
      failed += 1;
    }

    return {
      synced,
      failed,
      conflicts,
      updatedProjects: Array.from(updatedProjectsMap.values()),
      updatedChecklists: Array.from(updatedChecklistsMap.values()),
    };
  } finally {
    await releaseSyncLock(targetUserId, lock);
    notifySyncListeners({
      type: 'sync_completed',
      userId: targetUserId,
      synced,
      failed,
      conflicts,
    });
  }
}

// ============================================================================
// 5. CONFLICT RESOLUTION, RETRY & MANUAL QUEUE CONTROLS
// ============================================================================

/**
 * Merges a user's queued local checklist payload onto the latest authoritative
 * server checklist without losing newly added server checklist items or the
 * user's offline item edits / completions / deletions.
 */
function buildMergedChecklistPayloadForConflict(serverChecklist, op) {
  const localPayload = (op && op.payload) || {};
  if (!serverChecklist || typeof serverChecklist !== 'object') {
    return localPayload;
  }

  const deletedIdsSet = new Set(
    (Array.isArray(localPayload.deletedItemIds)
      ? localPayload.deletedItemIds
      : []
    ).map((id) => String(id))
  );

  const merged = {
    ...serverChecklist,
    ...localPayload,
  };
  delete merged.deletedItemIds;
  delete merged.expectedUpdatedAt;

  if (Array.isArray(localPayload.items)) {
    const serverItems = Array.isArray(serverChecklist.items)
      ? serverChecklist.items
      : [];
    const itemMap = new Map();

    serverItems.forEach((item) => {
      if (!item || !item.id) return;
      const itemId = String(item.id);
      if (deletedIdsSet.has(itemId)) return;
      itemMap.set(itemId, item);
    });

    localPayload.items.forEach((localItem) => {
      if (!localItem || !localItem.id) return;
      const itemId = String(localItem.id);
      if (deletedIdsSet.has(itemId)) return;
      const existingServerItem = itemMap.get(itemId);
      if (existingServerItem) {
        itemMap.set(itemId, {
          ...existingServerItem,
          ...localItem,
        });
      } else {
        itemMap.set(itemId, localItem);
      }
    });

    const mergedItems = Array.from(itemMap.values());
    merged.items = mergedItems;

    if (localPayload.status !== 'Archived') {
      const total = mergedItems.length;
      const completedCount = mergedItems.filter((it) => Boolean(it.completed))
        .length;
      merged.status =
        total > 0 && completedCount === total
          ? 'Completed'
          : completedCount > 0
          ? 'In Progress'
          : 'Draft';
    }
  }

  return merged;
}

/**
 * Merges a user's queued local payload onto the latest authoritative server
 * project without losing newly added server records or the user's offline changes.
 */
function buildMergedPayloadForConflict(serverProject, op) {
  const localPayload = (op && op.payload) || {};
  if (!serverProject || typeof serverProject !== 'object') {
    return localPayload;
  }

  if (op.entityType === 'project') {
    return {
      ...localPayload,
    };
  }

  // For child data (`PATCH /api/projects/:id/data`), merge arrays by item `id`
  // where local items take precedence for edited IDs and server-only IDs are preserved
  const merged = { ...localPayload };

  const mergeArrayById = (serverArr, localArr, getItemId = (it) => it && it.id) => {
    if (!Array.isArray(localArr)) return undefined;
    if (!Array.isArray(serverArr) || serverArr.length === 0) return localArr;
    const map = new Map();
    serverArr.forEach((item) => {
      const id = getItemId(item);
      if (id) map.set(String(id), item);
    });
    localArr.forEach((item) => {
      const id = getItemId(item);
      if (id) map.set(String(id), item);
    });
    return Array.from(map.values());
  };

  if (Array.isArray(localPayload.testSuites)) {
    const serverSuites = Array.isArray(serverProject.testSuites)
      ? serverProject.testSuites
      : [];
    if (serverSuites.length === 0) {
      merged.testSuites = localPayload.testSuites;
    } else {
      const suiteMap = new Map();
      serverSuites.forEach((s) => {
        if (s && s.id) suiteMap.set(String(s.id), s);
      });
      localPayload.testSuites.forEach((localSuite) => {
        if (!localSuite || !localSuite.id) return;
        const suiteId = String(localSuite.id);
        const existingServerSuite = suiteMap.get(suiteId);
        if (!existingServerSuite) {
          suiteMap.set(suiteId, localSuite);
          return;
        }
        const serverCases = extractSuiteTestCases(existingServerSuite);
        const localCases = extractSuiteTestCases(localSuite);
        const mergedCases =
          mergeArrayById(
            serverCases,
            localCases,
            (tc) => tc && (tc.id || tc.testCaseId)
          ) || localCases;
        suiteMap.set(suiteId, {
          ...existingServerSuite,
          ...localSuite,
          cases: mergedCases,
          testCases: mergedCases,
        });
      });
      merged.testSuites = Array.from(suiteMap.values());
    }
  }
  if (Array.isArray(localPayload.executionRuns)) {
    merged.executionRuns = mergeArrayById(
      serverProject.executionRuns,
      localPayload.executionRuns
    );
  }
  if (Array.isArray(localPayload.executions)) {
    merged.executions = mergeArrayById(
      serverProject.executions,
      localPayload.executions
    );
  }
  if (Array.isArray(localPayload.defects)) {
    merged.defects = mergeArrayById(
      serverProject.defects,
      localPayload.defects,
      (d) => d && (d.id || d.defectId)
    );
  }
  if (localPayload.testPlan && typeof localPayload.testPlan === 'object') {
    const serverPlan =
      serverProject.testPlan && typeof serverProject.testPlan === 'object'
        ? serverProject.testPlan
        : {};
    const mergedPhases = Array.isArray(localPayload.testPlan.phases)
      ? mergeArrayById(serverPlan.phases, localPayload.testPlan.phases)
      : serverPlan.phases;
    merged.testPlan = {
      ...serverPlan,
      ...localPayload.testPlan,
      ...(Array.isArray(mergedPhases) ? { phases: mergedPhases } : {}),
    };
  }

  return merged;
}

/**
 * Resolves an HTTP 409 synchronization conflict on a queued project or checklist operation.
 *
 * Supported `resolution` modes:
 * - `'keep_server'` / `'discard_local'`: Discards the conflicted local mutation
 *   and refreshes the local cache with the authoritative server record.
 * - `'merge'` / `'keep_local'`: Fetches the latest server record (`updatedAt`),
 *   rebases/merges the user's offline changes onto the latest `expectedUpdatedAt`,
 *   and immediately synchronizes with the backend.
 *
 * @param {string} opId
 * @param {'keep_server' | 'discard_local' | 'merge' | 'keep_local'} resolution
 * @param {string} userId
 * @param {object} [options]
 */
export async function resolveProjectConflict(
  opId,
  resolution,
  userId,
  options = {}
) {
  const targetUserId = String(userId || '').trim();
  const cleanOpId = String(opId || '').trim();
  if (!targetUserId || !cleanOpId) {
    return {
      ok: false,
      error: 'Operation ID and user ID are required to resolve a conflict.',
    };
  }

  const existingOps = await getPendingProjectOperations(targetUserId);
  const targetOp = existingOps.find((op) => op.id === cleanOpId);
  if (!targetOp) {
    return {
      ok: false,
      error: 'Conflicted operation not found in sync queue.',
    };
  }

  const normalizedRes = String(resolution || '').toLowerCase();

  // ==========================================================================
  // CHECKLIST CONFLICT RESOLUTION
  // ==========================================================================
  if (targetOp.entityType === 'checklist') {
    const targetChecklistId = String(
      targetOp.checklistId || targetOp.entityId || ''
    ).trim();

    if (normalizedRes === 'keep_server' || normalizedRes === 'discard_local') {
      await dequeueProjectOperation(cleanOpId, targetUserId);

      let authoritativeChecklist =
        targetOp.conflictDetails && targetOp.conflictDetails.serverChecklist
          ? targetOp.conflictDetails.serverChecklist
          : null;

      if (!isClientOffline()) {
        const fetched = await fetchChecklistByIdApi(targetChecklistId, {
          ...(options.apiOptions || {}),
          userId: targetUserId,
          ignorePendingLocal: true,
        });
        if (fetched.ok && fetched.checklist) {
          authoritativeChecklist = fetched.checklist;
        }
      }

      if (authoritativeChecklist) {
        authoritativeChecklist = await cacheChecklistOffline(
          authoritativeChecklist,
          targetUserId,
          {
            pendingSync: false,
            pendingCreation: false,
            syncStatus: 'synced',
            syncOpId: null,
            syncError: null,
            conflictDetails: null,
            serverUpdatedAt: authoritativeChecklist.updatedAt || null,
          }
        );
      }

      notifySyncListeners({
        type: 'conflict_resolved',
        entityType: 'checklist',
        resolution: 'keep_server',
        userId: targetUserId,
        checklistId: targetChecklistId,
      });

      return {
        ok: true,
        resolution: 'keep_server',
        checklistId: targetChecklistId,
        checklist: authoritativeChecklist,
      };
    }

    if (normalizedRes === 'merge' || normalizedRes === 'keep_local') {
      let latestServerChecklist =
        targetOp.conflictDetails && targetOp.conflictDetails.serverChecklist
          ? targetOp.conflictDetails.serverChecklist
          : null;

      if (!isClientOffline()) {
        const fetched = await fetchChecklistByIdApi(targetChecklistId, {
          ...(options.apiOptions || {}),
          userId: targetUserId,
          ignorePendingLocal: true,
        });
        if (fetched.ok && fetched.checklist) {
          latestServerChecklist = fetched.checklist;
        }
      }

      const latestServerUpdatedAt =
        (latestServerChecklist && latestServerChecklist.updatedAt) ||
        (targetOp.conflictDetails &&
          targetOp.conflictDetails.currentUpdatedAt) ||
        null;

      const nextPayload =
        normalizedRes === 'merge' && latestServerChecklist
          ? buildMergedChecklistPayloadForConflict(
              latestServerChecklist,
              targetOp
            )
          : { ...(targetOp.payload || {}) };
      delete nextPayload.deletedItemIds;
      delete nextPayload.expectedUpdatedAt;

      const updatedOps = existingOps.map((item) => {
        if (item.id !== cleanOpId) return item;
        return {
          ...item,
          payload: nextPayload,
          expectedUpdatedAt: latestServerUpdatedAt,
          status: 'pending',
          requiresManualResolution: false,
          conflictDetails: null,
          retryCount: 0,
          nextRetryAt: null,
          lastError: null,
          updatedAt: new Date().toISOString(),
        };
      });

      await savePendingProjectOperations(targetUserId, updatedOps);
      await applyChecklistMutationToOfflineCache(targetUserId, {
        checklistId: targetChecklistId,
        operationType: targetOp.operationType,
        payload: nextPayload,
        expectedUpdatedAt: latestServerUpdatedAt,
        id: cleanOpId,
        status: 'pending',
      });

      let syncResult = null;
      if (!isClientOffline()) {
        syncResult = await processProjectSyncQueue(targetUserId, {
          ...options,
          ignoreBackoff: true,
        });
      }

      const refreshedChecklist = await getCachedChecklistById(
        targetChecklistId,
        targetUserId,
        true
      );

      notifySyncListeners({
        type: 'conflict_resolved',
        entityType: 'checklist',
        resolution: normalizedRes,
        userId: targetUserId,
        checklistId: targetChecklistId,
      });

      return {
        ok: true,
        resolution: normalizedRes,
        checklistId: targetChecklistId,
        checklist: refreshedChecklist,
        syncResult,
      };
    }

    return {
      ok: false,
      error: `Unsupported conflict resolution strategy: "${resolution}".`,
    };
  }

  // ==========================================================================
  // PROJECT CONFLICT RESOLUTION
  // ==========================================================================
  // Option A: Accept Server Version / Discard Local Conflicting Operation
  if (normalizedRes === 'keep_server' || normalizedRes === 'discard_local') {
    await dequeueProjectOperation(cleanOpId, targetUserId);

    let authoritativeProject =
      targetOp.conflictDetails && targetOp.conflictDetails.serverProject
        ? targetOp.conflictDetails.serverProject
        : null;

    if (!isClientOffline()) {
      const fetched = await fetchProjectById(
        targetOp.projectId,
        options.apiOptions || {}
      );
      if (fetched.ok && fetched.project) {
        authoritativeProject = fetched.project;
      }
    }

    if (authoritativeProject) {
      await cacheProjectOffline(authoritativeProject, targetUserId, {
        pendingSync: false,
        pendingCreation: false,
      });
    }

    notifySyncListeners({
      type: 'conflict_resolved',
      resolution: 'keep_server',
      userId: targetUserId,
      projectId: targetOp.projectId,
    });

    return {
      ok: true,
      resolution: 'keep_server',
      projectId: targetOp.projectId,
      project: authoritativeProject,
    };
  }

  // Option B: Merge / Keep Local Changes on top of latest server updatedAt
  if (normalizedRes === 'merge' || normalizedRes === 'keep_local') {
    let latestServerProject =
      targetOp.conflictDetails && targetOp.conflictDetails.serverProject
        ? targetOp.conflictDetails.serverProject
        : null;

    if (!isClientOffline()) {
      const fetched = await fetchProjectById(
        targetOp.projectId,
        options.apiOptions || {}
      );
      if (fetched.ok && fetched.project) {
        latestServerProject = fetched.project;
      }
    }

    const latestServerUpdatedAt =
      (latestServerProject && latestServerProject.updatedAt) ||
      (targetOp.conflictDetails && targetOp.conflictDetails.currentUpdatedAt) ||
      null;

    const nextPayload =
      normalizedRes === 'merge' && latestServerProject
        ? buildMergedPayloadForConflict(latestServerProject, targetOp)
        : targetOp.payload;

    const updatedOps = existingOps.map((item) => {
      if (item.id !== cleanOpId) return item;
      return {
        ...item,
        payload: nextPayload,
        expectedUpdatedAt: latestServerUpdatedAt,
        status: 'pending',
        requiresManualResolution: false,
        conflictDetails: null,
        retryCount: 0,
        nextRetryAt: null,
        lastError: null,
        updatedAt: new Date().toISOString(),
      };
    });

    await savePendingProjectOperations(targetUserId, updatedOps);

    let syncResult = null;
    if (!isClientOffline()) {
      syncResult = await processProjectSyncQueue(targetUserId, {
        ...options,
        ignoreBackoff: true,
      });
    }

    const refreshedProject = await getCachedProjectById(
      targetOp.projectId,
      targetUserId,
      true
    );

    notifySyncListeners({
      type: 'conflict_resolved',
      resolution: normalizedRes,
      userId: targetUserId,
      projectId: targetOp.projectId,
    });

    return {
      ok: true,
      resolution: normalizedRes,
      projectId: targetOp.projectId,
      project: refreshedProject,
      syncResult,
    };
  }

  return {
    ok: false,
    error: `Unsupported conflict resolution strategy: "${resolution}".`,
  };
}

/**
 * Alias for resolving checklist conflicts via the shared queue conflict resolver.
 */
export const resolveChecklistConflict = resolveProjectConflict;

/**
 * Resets a failed or backoff-delayed operation to `'pending'` and triggers a sync pass.
 *
 * @param {string} opId
 * @param {string} userId
 * @param {object} [options]
 */
export async function retryProjectOperation(opId, userId, options = {}) {
  const targetUserId = String(userId || '').trim();
  const cleanOpId = String(opId || '').trim();
  if (!targetUserId || !cleanOpId) {
    return { ok: false, error: 'Operation ID and user ID are required.' };
  }

  const existingOps = await getPendingProjectOperations(targetUserId);
  const targetOp = existingOps.find((op) => op.id === cleanOpId);
  if (!targetOp) {
    return { ok: false, error: 'Operation not found in queue.' };
  }

  const updatedOps = existingOps.map((op) =>
    op.id === cleanOpId
      ? {
          ...op,
          status: 'pending',
          retryCount: 0,
          nextRetryAt: null,
          lastError: null,
          updatedAt: new Date().toISOString(),
        }
      : op
  );

  await savePendingProjectOperations(targetUserId, updatedOps);

  if (targetOp.entityType === 'checklist') {
    const targetChecklistId = String(
      targetOp.checklistId || targetOp.entityId || ''
    ).trim();
    const cachedChk = await getCachedChecklistById(
      targetChecklistId,
      targetUserId,
      true
    );
    if (cachedChk) {
      await cacheChecklistOffline(cachedChk, targetUserId, {
        pendingSync: true,
        pendingCreation: Boolean(cachedChk._pendingCreation),
        syncStatus: 'pending',
        syncOpId: cleanOpId,
        syncError: null,
      });
    }
  }

  if (!isClientOffline()) {
    const syncRes = await processProjectSyncQueue(targetUserId, {
      ...options,
      ignoreBackoff: true,
      retryFailed: true,
    });
    return { ok: true, syncResult: syncRes };
  }

  notifySyncListeners({
    type: 'operation_retry_scheduled',
    userId: targetUserId,
    operationId: cleanOpId,
  });
  return { ok: true, queuedOffline: true };
}

/**
 * Resets all `'failed'` operations for a user to `'pending'` and runs a sync pass.
 *
 * @param {string} userId
 * @param {object} [options]
 */
export async function retryFailedProjectOperations(userId, options = {}) {
  const targetUserId = String(userId || '').trim();
  if (!targetUserId) {
    return { ok: false, error: 'User ID is required.' };
  }

  const existingOps = await getPendingProjectOperations(targetUserId);
  const updatedOps = existingOps.map((op) =>
    op.status === 'failed' || op.status === 'pending'
      ? {
          ...op,
          status: 'pending',
          retryCount: 0,
          nextRetryAt: null,
          lastError: null,
          updatedAt: new Date().toISOString(),
        }
      : op
  );

  await savePendingProjectOperations(targetUserId, updatedOps);
  if (!isClientOffline()) {
    const syncResult = await processProjectSyncQueue(targetUserId, {
      ...options,
      ignoreBackoff: true,
      retryFailed: true,
    });
    return { ok: true, syncResult };
  }
  return { ok: true, queuedOffline: true };
}

/**
 * Explicitly discards a queued operation by user action.
 *
 * @param {string} opId
 * @param {string} userId
 */
export async function discardProjectOperation(opId, userId) {
  const targetUserId = String(userId || '').trim();
  const cleanOpId = String(opId || '').trim();
  if (!targetUserId || !cleanOpId) {
    return { ok: false };
  }

  const existingOps = await getPendingProjectOperations(targetUserId);
  const targetOp = existingOps.find((op) => op.id === cleanOpId);
  const removed = await dequeueProjectOperation(cleanOpId, targetUserId);

  if (removed && targetOp && targetOp.entityType === 'checklist') {
    const targetChecklistId = String(
      targetOp.checklistId || targetOp.entityId || ''
    ).trim();
    if (targetOp.operationType === 'CREATE') {
      await removeCachedChecklistOffline(targetChecklistId, targetUserId);
    } else {
      const cachedChk = await getCachedChecklistById(
        targetChecklistId,
        targetUserId,
        true
      );
      if (cachedChk) {
        await cacheChecklistOffline(cachedChk, targetUserId, {
          pendingSync: false,
          pendingCreation: false,
          syncStatus: 'synced',
          syncOpId: null,
          syncError: null,
          conflictDetails: null,
        });
      }
    }
  }

  if (removed) {
    notifySyncListeners({
      type: 'operation_discarded',
      userId: targetUserId,
      operationId: cleanOpId,
    });
  }
  return { ok: removed };
}

export const offlineSyncService = {
  setOfflineSyncStorageAdapter,
  getOfflineSyncStorageAdapter,
  setNetInfoAdapterForTesting,
  setAppStateAdapterForTesting,
  setReconnectDebounceMsForTesting,
  resetConnectivityStateForTesting,
  setActiveSyncUser,
  getActiveSyncUser,
  getNetworkConnectivityState,
  evaluateNetInfoState,
  handleConnectivityStateChange,
  checkInitialConnectivity,
  startConnectivityMonitoring,
  stopAllConnectivityMonitoring,
  triggerReconnectSyncForUser,
  subscribeToReconnectSyncResults,
  setSimulatedOfflineMode,
  setOfflineModeForTesting,
  isClientOffline,
  subscribeToSyncEvents,
  cacheProjectOffline,
  cacheProjectsListOffline,
  removeCachedProjectOffline,
  getCachedProjectsForUser,
  getCachedProjectById,
  queueProjectMutation,
  queueChecklistMutation,
  getPendingProjectOperations,
  getPendingChecklistOperations,
  dequeueProjectOperation,
  dequeueProjectOperationIfLockValid,
  acquireSyncLock,
  verifySyncLockOwnership,
  releaseSyncLock,
  getProjectSyncStatus,
  processProjectSyncQueue,
  resolveProjectConflict,
  resolveChecklistConflict,
  retryProjectOperation,
  retryFailedProjectOperations,
  discardProjectOperation,
};

registerProcessQueueRunner(processProjectSyncQueue);

export default offlineSyncService;

/**
 * Qavora Android — Per-User Offline Project Cache
 *
 * Maintains isolated AsyncStorage project snapshots (`@qavora_offline_projects_cache_v1:<userId>`)
 * while preserving pending offline creations and mutations.
 */

import { normalizeProjectRecord } from '../projectService.js';
import {
  getOfflineProjectsCacheKey,
  readJsonFromStorage,
  writeJsonToStorage,
} from './syncState.js';
import { getPendingProjectOperations } from './pendingQueueRead.js';

/**
 * Caches a single project record in the user's isolated offline project cache.
 *
 * @param {object} project
 * @param {string} userId
 * @param {object} [options]
 */
export async function cacheProjectOffline(project, userId, options = {}) {
  const targetUserId = String(
    userId || (project && project.userId) || ''
  ).trim();
  if (!targetUserId || !project || typeof project !== 'object') {
    return null;
  }

  const normalized = normalizeProjectRecord({
    ...project,
    userId: targetUserId,
  });
  if (!normalized || !normalized.id) {
    return null;
  }

  const cacheKey = getOfflineProjectsCacheKey(targetUserId);
  const existingMap = await readJsonFromStorage(cacheKey, {});
  const safeMap =
    existingMap && typeof existingMap === 'object' && !Array.isArray(existingMap)
      ? { ...existingMap }
      : {};

  const prevEntry = safeMap[normalized.id] || {};
  const recordToCache = {
    ...prevEntry,
    ...normalized,
    id: normalized.id,
    userId: targetUserId,
    _cachedAt: new Date().toISOString(),
    _pendingSync:
      options.pendingSync !== undefined
        ? Boolean(options.pendingSync)
        : Boolean(project._pendingSync),
    _pendingCreation:
      options.pendingCreation !== undefined
        ? Boolean(options.pendingCreation)
        : Boolean(project._pendingCreation),
  };

  safeMap[normalized.id] = recordToCache;
  await writeJsonToStorage(cacheKey, safeMap);
  return recordToCache;
}

/**
 * Replaces or merges the authenticated user's offline project list cache while
 * preserving any unsynchronized offline-created or pending-sync projects.
 *
 * @param {Array<object>} projectsList
 * @param {string} userId
 */
export async function cacheProjectsListOffline(projectsList = [], userId) {
  const targetUserId = String(userId || '').trim();
  if (!targetUserId) return [];

  const cacheKey = getOfflineProjectsCacheKey(targetUserId);
  const existingMap = await readJsonFromStorage(cacheKey, {});
  const pendingOps = await getPendingProjectOperations(targetUserId);

  const pendingDeleteIds = new Set(
    pendingOps
      .filter(
        (op) => op.entityType === 'project' && op.operationType === 'DELETE'
      )
      .map((op) => op.projectId)
  );
  const pendingProjectIds = new Set(pendingOps.map((op) => op.projectId));

  const nextMap = {};

  // Keep any locally created projects that haven't synced to the server yet
  if (existingMap && typeof existingMap === 'object') {
    Object.values(existingMap).forEach((cachedProj) => {
      if (
        cachedProj &&
        cachedProj.id &&
        String(cachedProj.userId) === targetUserId &&
        !pendingDeleteIds.has(cachedProj.id) &&
        (cachedProj._pendingCreation || pendingProjectIds.has(cachedProj.id))
      ) {
        nextMap[cachedProj.id] = cachedProj;
      }
    });
  }

  const safeList = Array.isArray(projectsList) ? projectsList : [];
  safeList.forEach((rawProj) => {
    const normalized = normalizeProjectRecord({
      ...rawProj,
      userId: targetUserId,
    });
    if (!normalized || !normalized.id) return;
    if (pendingDeleteIds.has(normalized.id)) return;

    // If this project has pending local mutations in the queue, preserve the local optimistic state
    const existingLocal = nextMap[normalized.id];
    if (existingLocal && pendingProjectIds.has(normalized.id)) {
      nextMap[normalized.id] = {
        ...normalized,
        ...existingLocal,
        // Keep the server's latest updatedAt reference if no baseline was recorded
        _serverUpdatedAt: normalized.updatedAt,
        _pendingSync: true,
      };
    } else {
      nextMap[normalized.id] = {
        ...normalized,
        userId: targetUserId,
        _cachedAt: new Date().toISOString(),
        _pendingSync: false,
        _pendingCreation: false,
      };
    }
  });

  await writeJsonToStorage(cacheKey, nextMap);
  return Object.values(nextMap).sort((a, b) =>
    String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
  );
}

/**
 * Removes a single project from the user's offline project cache.
 *
 * @param {string} projectId
 * @param {string} userId
 */
export async function removeCachedProjectOffline(projectId, userId) {
  const targetUserId = String(userId || '').trim();
  const cleanId = String(projectId || '').trim();
  if (!targetUserId || !cleanId) return false;

  const cacheKey = getOfflineProjectsCacheKey(targetUserId);
  const existingMap = await readJsonFromStorage(cacheKey, {});
  if (!existingMap || typeof existingMap !== 'object' || !existingMap[cleanId]) {
    return false;
  }

  const nextMap = { ...existingMap };
  delete nextMap[cleanId];
  await writeJsonToStorage(cacheKey, nextMap);
  return true;
}

/**
 * Retrieves all cached projects for a specific authenticated user.
 * Strictly enforces `userId` ownership isolation.
 *
 * @param {string} userId
 * @param {boolean} [allowPendingCreation=true]
 * @returns {Promise<Array<object>>}
 */
export async function getCachedProjectsForUser(
  userId,
  allowPendingCreation = true
) {
  const targetUserId = String(userId || '').trim();
  if (!targetUserId) return [];

  const cacheKey = getOfflineProjectsCacheKey(targetUserId);
  const existingMap = await readJsonFromStorage(cacheKey, {});
  if (!existingMap || typeof existingMap !== 'object') {
    return [];
  }

  return Object.values(existingMap)
    .filter((proj) => {
      if (!proj || typeof proj !== 'object' || !proj.id) return false;
      if (String(proj.userId) !== targetUserId) return false;
      if (!allowPendingCreation && proj._pendingCreation) return false;
      return true;
    })
    .sort((a, b) =>
      String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
    );
}

/**
 * Retrieves a single cached project by ID for a specific authenticated user.
 *
 * @param {string} projectId
 * @param {string} userId
 * @param {boolean} [allowPendingCreation=true]
 * @returns {Promise<object | null>}
 */
export async function getCachedProjectById(
  projectId,
  userId,
  allowPendingCreation = true
) {
  const targetUserId = String(userId || '').trim();
  const cleanId = String(projectId || '').trim();
  if (!targetUserId || !cleanId) return null;

  const cacheKey = getOfflineProjectsCacheKey(targetUserId);
  const existingMap = await readJsonFromStorage(cacheKey, {});
  if (!existingMap || typeof existingMap !== 'object') {
    return null;
  }

  const record = existingMap[cleanId];
  if (!record || String(record.userId) !== targetUserId) {
    return null;
  }
  if (!allowPendingCreation && record._pendingCreation) {
    return null;
  }
  return record;
}

/**
 * Qavora Android — Per-User Offline Checklist Cache & Pending Queue Merge
 *
 * Persists isolated per-user checklist snapshots (`@qavora_offline_checklists_cache_v1:<userId>`)
 * and merges server lists cleanly with pending offline checklist operations.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getOfflineSyncStorageAdapter } from '../offlineSync/syncState.js';
import { getPendingChecklistOperations } from '../offlineSync/pendingQueueRead.js';
import {
  getChecklistCacheKey,
  normalizeChecklistRecord,
  filterChecklistsForUser,
} from './checklistNormalization.js';

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

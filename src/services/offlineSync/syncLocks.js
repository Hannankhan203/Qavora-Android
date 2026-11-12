/**
 * Qavora Android — Offline Sync Concurrent Lock Manager
 *
 * Manages in-memory + persistent TTL sync locks (`@qavora_sync_locks_v1:<userId>`)
 * with monotonic generation ownership verification.
 */

import {
  SYNC_LOCK_TTL_MS,
  activeMemoryLocks,
  getSyncLockKey,
  readJsonFromStorage,
  writeJsonToStorage,
  removeKeyFromStorage,
} from './syncState.js';

/**
 * Attempts to acquire an exclusive per-user synchronization lock.
 * Combines an in-memory lock and a persistent AsyncStorage lock with TTL (`45000ms`)
 * and monotonic `generation` counter matching Qavora Web's `acquireSyncLock`.
 *
 * @param {string} userId
 * @returns {Promise<object | null>}
 */
export async function acquireSyncLock(userId) {
  const targetUserId = String(userId || '').trim();
  if (!targetUserId) return null;

  const now = Date.now();
  const memLock = activeMemoryLocks.get(targetUserId);
  if (memLock && memLock.expiresAt > now) {
    return null;
  }

  const lockKey = getSyncLockKey(targetUserId);
  const ownerId = `sync_${now}_${Math.random().toString(36).slice(2, 8)}`;
  const initialGeneration =
    memLock && typeof memLock.generation === 'number'
      ? memLock.generation + 1
      : 1;

  const lockRecord = {
    lockKey,
    userId: targetUserId,
    ownerId,
    generation: initialGeneration,
    acquiredAt: now,
    expiresAt: now + SYNC_LOCK_TTL_MS,
  };

  // Reserve in-memory lock synchronously before any await so concurrent callers
  // invoked via Promise.all immediately observe the active lock
  activeMemoryLocks.set(targetUserId, lockRecord);

  const existingStoredLock = await readJsonFromStorage(lockKey, null);
  if (
    existingStoredLock &&
    existingStoredLock.ownerId !== ownerId &&
    typeof existingStoredLock.expiresAt === 'number' &&
    existingStoredLock.expiresAt > now
  ) {
    if (activeMemoryLocks.get(targetUserId)?.ownerId === ownerId) {
      activeMemoryLocks.set(targetUserId, existingStoredLock);
    }
    return null;
  }

  const nextGeneration =
    existingStoredLock && typeof existingStoredLock.generation === 'number'
      ? Math.max(initialGeneration, existingStoredLock.generation + 1)
      : initialGeneration;

  lockRecord.generation = nextGeneration;
  activeMemoryLocks.set(targetUserId, lockRecord);
  await writeJsonToStorage(lockKey, lockRecord);
  return lockRecord;
}

/**
 * Verifies that the caller still holds the active sync lock and its generation
 * has not been superseded.
 *
 * @param {string} userId
 * @param {object} lockRecord
 * @returns {Promise<boolean>}
 */
export async function verifySyncLockOwnership(userId, lockRecord) {
  const targetUserId = String(userId || '').trim();
  if (!targetUserId || !lockRecord || !lockRecord.ownerId) {
    return false;
  }

  const now = Date.now();
  if (lockRecord.expiresAt <= now) {
    return false;
  }

  const memLock = activeMemoryLocks.get(targetUserId);
  if (
    memLock &&
    (memLock.ownerId !== lockRecord.ownerId ||
      memLock.generation !== lockRecord.generation)
  ) {
    return false;
  }

  const lockKey = getSyncLockKey(targetUserId);
  const storedLock = await readJsonFromStorage(lockKey, null);
  if (!storedLock) {
    return false;
  }

  return (
    storedLock.ownerId === lockRecord.ownerId &&
    storedLock.generation === lockRecord.generation &&
    storedLock.expiresAt > now
  );
}

/**
 * Releases the per-user synchronization lock if still owned by `lockRecord`.
 *
 * @param {string} userId
 * @param {object} lockRecord
 */
export async function releaseSyncLock(userId, lockRecord) {
  const targetUserId = String(userId || '').trim();
  if (!targetUserId || !lockRecord) return;

  const memLock = activeMemoryLocks.get(targetUserId);
  if (memLock && memLock.ownerId === lockRecord.ownerId) {
    activeMemoryLocks.delete(targetUserId);
  }

  const lockKey = getSyncLockKey(targetUserId);
  const storedLock = await readJsonFromStorage(lockKey, null);
  if (storedLock && storedLock.ownerId === lockRecord.ownerId) {
    await removeKeyFromStorage(lockKey);
  }
}

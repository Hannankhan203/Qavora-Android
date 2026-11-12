/**
 * Qavora Android — Offline Queue Read, Idempotency Keys, Sorting & Dequeue Helpers
 *
 * Leaf-level queue operations with zero dependency on checklistCache or checklistService.
 */

import {
  getPendingProjectOpsKey,
  readJsonFromStorage,
  writeJsonToStorage,
} from './syncState.js';
import { verifySyncLockOwnership } from './syncLocks.js';

/**
 * Computes a deterministic idempotency key for a project mutation.
 */
export function buildOperationIdempotencyKey({
  userId,
  projectId,
  entityType = 'project',
  entityId = null,
  operationType = 'UPDATE',
}) {
  return `proj_${userId}_${projectId}_${entityType}_${
    entityId || 'root'
  }_${operationType}`;
}

/**
 * Computes a deterministic idempotency key for a checklist mutation.
 */
export function buildChecklistOperationIdempotencyKey({
  userId,
  checklistId,
  operationType = 'UPDATE',
}) {
  return `chk_${userId}_${checklistId}_checklist_${operationType}`;
}

/**
 * Sorts queued operations by dependency rank and monotonic sequence number:
 * 1. Project / Checklist CREATE
 * 2. Project / Checklist UPDATE / STATUS_CHANGE
 * 3. Child data updates (`data`, `testPlan`, `testSuites`, `testCases`, `testRuns`, `executions`, `defects`)
 * 4. Project / Checklist DELETE
 *
 * @param {Array<object>} ops
 * @returns {Array<object>}
 */
export function sortProjectOperations(ops = []) {
  const getRank = (op) => {
    if (!op) return 99;
    if (op.entityType === 'project' && op.operationType === 'CREATE') return 1;
    if (op.entityType === 'checklist' && op.operationType === 'CREATE') return 1;
    if (
      op.entityType === 'project' &&
      (op.operationType === 'UPDATE' || op.operationType === 'STATUS_CHANGE')
    ) {
      return 2;
    }
    if (op.entityType === 'checklist' && op.operationType === 'UPDATE') {
      return 2;
    }
    if (op.entityType === 'project' && op.operationType === 'DELETE') return 4;
    if (op.entityType === 'checklist' && op.operationType === 'DELETE') return 4;
    return 3;
  };

  return [...(Array.isArray(ops) ? ops : [])].sort((a, b) => {
    const rankDiff = getRank(a) - getRank(b);
    if (rankDiff !== 0) return rankDiff;
    const seqA =
      typeof a.seq === 'number'
        ? a.seq
        : new Date(a.createdAt || 0).getTime();
    const seqB =
      typeof b.seq === 'number'
        ? b.seq
        : new Date(b.createdAt || 0).getTime();
    return seqA - seqB;
  });
}

/**
 * Reads all pending/queued operations for a specific user.
 *
 * @param {string} userId
 * @returns {Promise<Array<object>>}
 */
export async function getPendingProjectOperations(userId) {
  const targetUserId = String(userId || '').trim();
  if (!targetUserId) return [];

  const opsKey = getPendingProjectOpsKey(targetUserId);
  const rawList = await readJsonFromStorage(opsKey, []);
  const safeList = Array.isArray(rawList)
    ? rawList.filter(
        (op) => op && typeof op === 'object' && String(op.userId) === targetUserId
      )
    : [];

  return sortProjectOperations(safeList);
}

/**
 * Reads all pending/queued checklist operations (`entityType === 'checklist'`) for a specific user.
 *
 * @param {string} userId
 * @returns {Promise<Array<object>>}
 */
export async function getPendingChecklistOperations(userId) {
  const allOps = await getPendingProjectOperations(userId);
  return allOps.filter((op) => op && op.entityType === 'checklist');
}

export async function savePendingProjectOperations(userId, operations) {
  const targetUserId = String(userId || '').trim();
  if (!targetUserId) return false;
  const opsKey = getPendingProjectOpsKey(targetUserId);
  const safeOps = (Array.isArray(operations) ? operations : []).filter(
    (op) => op && typeof op === 'object' && String(op.userId) === targetUserId
  );
  return writeJsonToStorage(opsKey, safeOps);
}

/**
 * Removes a single operation from the user's queue by ID.
 *
 * @param {string} opId
 * @param {string} userId
 */
export async function dequeueProjectOperation(opId, userId) {
  const targetUserId = String(userId || '').trim();
  const cleanOpId = String(opId || '').trim();
  if (!targetUserId || !cleanOpId) return false;

  const existingOps = await getPendingProjectOperations(targetUserId);
  const nextOps = existingOps.filter((op) => op.id !== cleanOpId);
  await savePendingProjectOperations(targetUserId, nextOps);
  return existingOps.length !== nextOps.length;
}

/**
 * Dequeues a completed operation only if the caller's sync lock is still valid.
 *
 * @param {string} opId
 * @param {string} userId
 * @param {object} lockRecord
 * @returns {Promise<boolean>}
 */
export async function dequeueProjectOperationIfLockValid(
  opId,
  userId,
  lockRecord
) {
  const isValid = await verifySyncLockOwnership(userId, lockRecord);
  if (!isValid) {
    return false;
  }
  return dequeueProjectOperation(opId, userId);
}

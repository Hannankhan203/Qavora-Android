/**
 * Qavora Android — Per-User Project Deletion Tombstones
 *
 * Durably tracks locally deleted suites, test cases, test runs, executions,
 * defects, and test plan phases per `(userId, projectId)` so HTTP 409 conflict
 * merges never resurrect deleted entities while keeping offline mutations
 * strictly isolated per authenticated user.
 */

import {
  getDeletionTombstonesKey,
  readJsonFromStorage,
  writeJsonToStorage,
} from './syncState.js';

export const TOMBSTONE_ENTITY_KEYS = [
  'suites',
  'testCases',
  'testRuns',
  'executions',
  'defects',
  'phases',
];

function normalizeIdList(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (let i = 0; i < list.length; i += 1) {
    const val = list[i];
    if (val === undefined || val === null) continue;
    const clean = String(val).trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

export function createEmptyDeletionTombstones() {
  return {
    suites: [],
    testCases: [],
    testRuns: [],
    executions: [],
    defects: [],
    phases: [],
  };
}

export function normalizeDeletionTombstones(raw) {
  const base = createEmptyDeletionTombstones();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return base;
  }
  TOMBSTONE_ENTITY_KEYS.forEach((key) => {
    base[key] = normalizeIdList(raw[key]);
  });
  return base;
}

export function hasAnyDeletionTombstones(tombstones) {
  if (!tombstones || typeof tombstones !== 'object') return false;
  return TOMBSTONE_ENTITY_KEYS.some(
    (key) => Array.isArray(tombstones[key]) && tombstones[key].length > 0
  );
}

export function mergeDeletionTombstones(first, second) {
  const a = normalizeDeletionTombstones(first);
  const b = normalizeDeletionTombstones(second);
  const merged = createEmptyDeletionTombstones();
  TOMBSTONE_ENTITY_KEYS.forEach((key) => {
    merged[key] = normalizeIdList([...a[key], ...b[key]]);
  });
  return merged;
}

export function subtractDeletionTombstones(base, idsToRemove) {
  const normalizedBase = normalizeDeletionTombstones(base);
  const removal = normalizeDeletionTombstones(idsToRemove);
  const result = createEmptyDeletionTombstones();
  TOMBSTONE_ENTITY_KEYS.forEach((key) => {
    const removeSet = new Set(removal[key]);
    result[key] = normalizedBase[key].filter((id) => !removeSet.has(id));
  });
  return result;
}

/**
 * Extracts IDs that are actively present in a project-data PATCH payload so if a
 * previously deleted ID is intentionally recreated, its tombstone is cleared.
 */
export function extractActiveIdsFromProjectDataPayload(payload) {
  const active = createEmptyDeletionTombstones();
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return active;
  }

  if (Array.isArray(payload.testSuites)) {
    const suiteIds = [];
    const caseIds = [];
    payload.testSuites.forEach((suite) => {
      if (!suite || typeof suite !== 'object') return;
      if (suite.id) suiteIds.push(String(suite.id).trim());
      const cases = Array.isArray(suite.cases)
        ? suite.cases
        : Array.isArray(suite.testCases)
        ? suite.testCases
        : [];
      cases.forEach((tc) => {
        if (!tc || typeof tc !== 'object') return;
        const tcId = tc.id || tc.testCaseId;
        if (tcId) caseIds.push(String(tcId).trim());
      });
    });
    active.suites = normalizeIdList(suiteIds);
    active.testCases = normalizeIdList(caseIds);
  }

  if (Array.isArray(payload.executionRuns)) {
    active.testRuns = normalizeIdList(
      payload.executionRuns.map((run) => run && run.id)
    );
  }

  if (Array.isArray(payload.executions)) {
    active.executions = normalizeIdList(
      payload.executions.map((ex) => ex && ex.id)
    );
  }

  if (Array.isArray(payload.defects)) {
    const defectIds = [];
    payload.defects.forEach((d) => {
      if (!d || typeof d !== 'object') return;
      if (d.id) defectIds.push(String(d.id).trim());
      if (d.defectId) defectIds.push(String(d.defectId).trim());
    });
    active.defects = normalizeIdList(defectIds);
  }

  const phasesList =
    payload.testPlan && Array.isArray(payload.testPlan.phases)
      ? payload.testPlan.phases
      : Array.isArray(payload.phases)
      ? payload.phases
      : null;
  if (phasesList) {
    active.phases = normalizeIdList(phasesList.map((p) => p && p.id));
  }

  return active;
}

export async function getAllDeletionTombstonesForUser(userId) {
  const targetUserId = String(userId || '').trim();
  if (!targetUserId) return {};
  const key = getDeletionTombstonesKey(targetUserId);
  const raw = await readJsonFromStorage(key, {});
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  return raw;
}

export async function getProjectDeletionTombstones(userId, projectId) {
  const cleanProjectId = String(projectId || '').trim();
  if (!cleanProjectId) return createEmptyDeletionTombstones();
  const map = await getAllDeletionTombstonesForUser(userId);
  const entry = map[cleanProjectId];
  if (!entry || typeof entry !== 'object') {
    return createEmptyDeletionTombstones();
  }
  if (entry.userId && String(entry.userId).trim() !== String(userId).trim()) {
    return createEmptyDeletionTombstones();
  }
  return normalizeDeletionTombstones(entry);
}

export async function saveProjectDeletionTombstones(
  userId,
  projectId,
  tombstones
) {
  const targetUserId = String(userId || '').trim();
  const cleanProjectId = String(projectId || '').trim();
  if (!targetUserId || !cleanProjectId) return createEmptyDeletionTombstones();

  const key = getDeletionTombstonesKey(targetUserId);
  const map = await getAllDeletionTombstonesForUser(targetUserId);
  const normalized = normalizeDeletionTombstones(tombstones);

  const nextMap = { ...map };
  if (hasAnyDeletionTombstones(normalized)) {
    nextMap[cleanProjectId] = {
      ...normalized,
      userId: targetUserId,
      projectId: cleanProjectId,
      updatedAt: new Date().toISOString(),
    };
  } else {
    delete nextMap[cleanProjectId];
  }

  await writeJsonToStorage(key, nextMap);
  return normalized;
}

export async function recordProjectDeletionTombstones(
  userId,
  projectId,
  tombstones
) {
  const existing = await getProjectDeletionTombstones(userId, projectId);
  const merged = mergeDeletionTombstones(existing, tombstones);
  return saveProjectDeletionTombstones(userId, projectId, merged);
}

export async function removeProjectDeletionTombstones(
  userId,
  projectId,
  idsToRemove
) {
  const existing = await getProjectDeletionTombstones(userId, projectId);
  if (!hasAnyDeletionTombstones(existing)) return existing;
  const remaining = subtractDeletionTombstones(existing, idsToRemove);
  return saveProjectDeletionTombstones(userId, projectId, remaining);
}

export async function clearProjectDeletionTombstones(userId, projectId) {
  const targetUserId = String(userId || '').trim();
  const cleanProjectId = String(projectId || '').trim();
  if (!targetUserId || !cleanProjectId) return false;
  const key = getDeletionTombstonesKey(targetUserId);
  const map = await getAllDeletionTombstonesForUser(targetUserId);
  if (!map[cleanProjectId]) return true;
  const nextMap = { ...map };
  delete nextMap[cleanProjectId];
  return writeJsonToStorage(key, nextMap);
}

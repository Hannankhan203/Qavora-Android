/**
 * Qavora Android — Collision-Resistant Defect ID Utilities
 *
 * Guarantees unique, monotonically advancing `id` (`BUG-xxx`) and display
 * `defectId` (`DEF-xxx`) identifiers across:
 * - Defect deletion followed by new creation
 * - Repeated/rapid defect creation
 * - App reloads & project switches (persisted per-user, per-project high-water sequence)
 * - Workspace backup imports & recovery snapshot restores
 * - Offline deletion tombstones & linked test run / execution references
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export const DEFECT_SEQUENCE_STORAGE_PREFIX = '@qavora_qa_workspace_v2:defect_seq:';
const MAX_REASONABLE_SEQUENCE_NUM = 1000000;

let customDefectIdStorageAdapter = null;

export function setDefectIdStorageAdapter(adapter) {
  customDefectIdStorageAdapter = adapter || null;
}

function getStorage() {
  return customDefectIdStorageAdapter || AsyncStorage;
}

export function getDefectSequenceStorageKey(projectId, userId = null) {
  const cleanProjectId = projectId ? String(projectId).trim() : '';
  const userScope =
    userId && String(userId).trim() ? `${String(userId).trim()}:` : '';
  return `${DEFECT_SEQUENCE_STORAGE_PREFIX}${userScope}${cleanProjectId}`;
}

function normalizeIdString(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value).trim();
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  return '';
}

function parseDefNumber(rawId) {
  const clean = normalizeIdString(rawId);
  if (!clean) return 0;
  const match = clean.match(/DEF-(\d+)/i);
  if (!match) return 0;
  const parsed = parseInt(match[1], 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > MAX_REASONABLE_SEQUENCE_NUM) {
    return 0;
  }
  return parsed;
}

function parseBugNumber(rawId) {
  const clean = normalizeIdString(rawId);
  if (!clean) return 0;
  const match = clean.match(/BUG-(\d+)/i);
  if (!match) return 0;
  const parsed = parseInt(match[1], 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > MAX_REASONABLE_SEQUENCE_NUM) {
    return 0;
  }
  return parsed;
}

export function formatDefectDisplayId(num) {
  const safeNum = Math.max(1, Number.isFinite(num) ? Math.floor(num) : 1);
  return `DEF-${String(safeNum).padStart(3, '0')}`;
}

export function formatDefectPrimaryId(num) {
  const safeNum = Math.max(1, Number.isFinite(num) ? Math.floor(num) : 1);
  return `BUG-${safeNum}`;
}

/**
 * Collects every defect ID referenced across active defects, test runs,
 * execution records, and deletion tombstones so new IDs never collide with them.
 */
export function extractDefectIdsFromSources({
  defects = [],
  testRuns = [],
  executions = [],
  tombstoneIds = [],
  extraIds = [],
} = {}) {
  const out = [];
  const seen = new Set();
  const pushId = (raw) => {
    const clean = normalizeIdString(raw);
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    out.push(clean);
  };

  if (Array.isArray(defects)) {
    for (let i = 0; i < defects.length; i += 1) {
      const d = defects[i];
      if (!d || typeof d !== 'object') continue;
      pushId(d.id);
      pushId(d.defectId);
    }
  }

  if (Array.isArray(testRuns)) {
    for (let i = 0; i < testRuns.length; i += 1) {
      const run = testRuns[i];
      if (!run || !Array.isArray(run.results)) continue;
      for (let j = 0; j < run.results.length; j += 1) {
        const res = run.results[j];
        if (res && res.linkedDefectId) {
          pushId(res.linkedDefectId);
        }
      }
    }
  }

  if (Array.isArray(executions)) {
    for (let i = 0; i < executions.length; i += 1) {
      const ex = executions[i];
      if (ex && ex.linkedDefectId) {
        pushId(ex.linkedDefectId);
      }
    }
  }

  if (Array.isArray(tombstoneIds)) {
    for (let i = 0; i < tombstoneIds.length; i += 1) {
      pushId(tombstoneIds[i]);
    }
  }

  if (Array.isArray(extraIds)) {
    for (let i = 0; i < extraIds.length; i += 1) {
      pushId(extraIds[i]);
    }
  }

  return out;
}

export function normalizeSequenceState(raw) {
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const defSeq =
    typeof obj.defSeq === 'number' && Number.isFinite(obj.defSeq) && obj.defSeq >= 0
      ? Math.floor(obj.defSeq)
      : 0;
  const bugSeq =
    typeof obj.bugSeq === 'number' && Number.isFinite(obj.bugSeq) && obj.bugSeq >= 300
      ? Math.floor(obj.bugSeq)
      : 300;
  const reservedIds = Array.isArray(obj.reservedIds)
    ? extractDefectIdsFromSources({ extraIds: obj.reservedIds })
    : [];
  return { defSeq, bugSeq, reservedIds };
}

/**
 * Computes the updated monotonic high-water sequence state from any existing
 * persisted state plus all currently observed defect/link/tombstone IDs.
 */
export function computeHighWaterSequences({
  defects = [],
  testRuns = [],
  executions = [],
  tombstoneIds = [],
  extraIds = [],
  previousState = null,
} = {}) {
  const prev = normalizeSequenceState(previousState);
  const currentIds = extractDefectIdsFromSources({
    defects,
    testRuns,
    executions,
    tombstoneIds,
    extraIds,
  });

  const combinedReserved = extractDefectIdsFromSources({
    extraIds: [...prev.reservedIds, ...currentIds],
  });

  let defSeq = prev.defSeq;
  let bugSeq = prev.bugSeq;

  for (let i = 0; i < combinedReserved.length; i += 1) {
    const id = combinedReserved[i];
    const dNum = parseDefNumber(id);
    if (dNum > defSeq) defSeq = dNum;
    const bNum = parseBugNumber(id);
    if (bNum > bugSeq) bugSeq = bNum;
  }

  return {
    defSeq,
    bugSeq,
    reservedIds: combinedReserved,
  };
}

/**
 * Allocates the next guaranteed-unique `{ id, defectId }` pair for a new defect,
 * returning both IDs and the updated `nextSequenceState` to persist.
 */
export function allocateNextDefectIds({
  defects = [],
  testRuns = [],
  executions = [],
  tombstoneIds = [],
  extraIds = [],
  sequenceState = null,
} = {}) {
  const highWater = computeHighWaterSequences({
    defects,
    testRuns,
    executions,
    tombstoneIds,
    extraIds,
    previousState: sequenceState,
  });

  const reservedLower = new Set(
    highWater.reservedIds.map((id) => id.toLowerCase())
  );

  let nextDefNum = highWater.defSeq + 1;
  let defectId = formatDefectDisplayId(nextDefNum);
  while (
    reservedLower.has(defectId.toLowerCase()) ||
    reservedLower.has(`def-${nextDefNum}`)
  ) {
    nextDefNum += 1;
    defectId = formatDefectDisplayId(nextDefNum);
  }
  reservedLower.add(defectId.toLowerCase());

  let nextBugNum = highWater.bugSeq + 1;
  let id = formatDefectPrimaryId(nextBugNum);
  while (reservedLower.has(id.toLowerCase())) {
    nextBugNum += 1;
    id = formatDefectPrimaryId(nextBugNum);
  }
  reservedLower.add(id.toLowerCase());

  return {
    id,
    defectId,
    nextSequenceState: {
      defSeq: nextDefNum,
      bugSeq: nextBugNum,
      reservedIds: extractDefectIdsFromSources({
        extraIds: [...highWater.reservedIds, id, defectId],
      }),
    },
  };
}

/**
 * Normalizes a list of defect objects (from backend, AsyncStorage snapshot,
 * or imported backup) so every defect has non-empty, unique `id` and `defectId`
 * values without altering valid non-colliding legacy or custom IDs.
 */
export function normalizeDefectsWithUniqueIds(
  rawDefects = [],
  { warnings = null, reserveAdditionalIds = [] } = {}
) {
  if (!Array.isArray(rawDefects)) return [];

  const validRawDefects = rawDefects.filter(
    (d) => d && typeof d === 'object' && !Array.isArray(d)
  );

  // Pre-seed reserved set with every existing non-empty ID in the input array
  // so repairing an earlier missing/duplicate entry never collides with a later entry.
  const reservedLower = new Set();
  let maxDefNum = 0;
  let maxBugNum = 300;

  const observeId = (raw) => {
    const clean = normalizeIdString(raw);
    if (!clean) return;
    reservedLower.add(clean.toLowerCase());
    const dNum = parseDefNumber(clean);
    if (dNum > maxDefNum) maxDefNum = dNum;
    const bNum = parseBugNumber(clean);
    if (bNum > maxBugNum) maxBugNum = bNum;
  };

  if (Array.isArray(reserveAdditionalIds)) {
    reserveAdditionalIds.forEach(observeId);
  }
  validRawDefects.forEach((d) => {
    observeId(d.id);
    observeId(d.defectId);
  });

  const claimedLower = new Set();

  const allocateUniqueDef = () => {
    maxDefNum += 1;
    let candidate = formatDefectDisplayId(maxDefNum);
    while (
      reservedLower.has(candidate.toLowerCase()) ||
      reservedLower.has(`def-${maxDefNum}`) ||
      claimedLower.has(candidate.toLowerCase()) ||
      claimedLower.has(`def-${maxDefNum}`)
    ) {
      maxDefNum += 1;
      candidate = formatDefectDisplayId(maxDefNum);
    }
    reservedLower.add(candidate.toLowerCase());
    return candidate;
  };

  const allocateUniqueBug = () => {
    maxBugNum += 1;
    let candidate = formatDefectPrimaryId(maxBugNum);
    while (
      reservedLower.has(candidate.toLowerCase()) ||
      claimedLower.has(candidate.toLowerCase())
    ) {
      maxBugNum += 1;
      candidate = formatDefectPrimaryId(maxBugNum);
    }
    reservedLower.add(candidate.toLowerCase());
    return candidate;
  };

  return validRawDefects.map((d) => {
    const rawPrimary = normalizeIdString(d.id);
    const rawDisplay = normalizeIdString(d.defectId);

    let resolvedId = rawPrimary;
    if (!resolvedId) {
      if (rawDisplay && !claimedLower.has(rawDisplay.toLowerCase())) {
        resolvedId = rawDisplay;
      } else {
        resolvedId = allocateUniqueDef();
      }
    } else if (claimedLower.has(resolvedId.toLowerCase())) {
      const replacement = /^BUG-/i.test(resolvedId)
        ? allocateUniqueBug()
        : allocateUniqueDef();
      if (Array.isArray(warnings)) {
        warnings.push(
          `Duplicate defect ID "${resolvedId}" was reassigned to "${replacement}".`
        );
      }
      resolvedId = replacement;
    }

    claimedLower.add(resolvedId.toLowerCase());
    reservedLower.add(resolvedId.toLowerCase());

    let resolvedDisplayId = rawDisplay;
    if (!resolvedDisplayId) {
      resolvedDisplayId = resolvedId;
    } else if (
      resolvedDisplayId.toLowerCase() !== resolvedId.toLowerCase() &&
      claimedLower.has(resolvedDisplayId.toLowerCase())
    ) {
      const replacementDisplay = allocateUniqueDef();
      if (Array.isArray(warnings)) {
        warnings.push(
          `Duplicate defect display ID "${resolvedDisplayId}" was reassigned to "${replacementDisplay}".`
        );
      }
      resolvedDisplayId = replacementDisplay;
    }

    claimedLower.add(resolvedDisplayId.toLowerCase());
    reservedLower.add(resolvedDisplayId.toLowerCase());

    if (d.id === resolvedId && d.defectId === resolvedDisplayId) {
      return d;
    }
    return {
      ...d,
      id: resolvedId,
      defectId: resolvedDisplayId,
    };
  });
}

/**
 * Resolves a defect from an array matching exact primary `id` first, then
 * falling back to display `defectId` only if no exact primary match exists.
 */
export function findDefectById(defects = [], rawTargetId) {
  const cleanId = normalizeIdString(rawTargetId);
  if (!cleanId || !Array.isArray(defects)) return { defect: null, index: -1 };

  const primaryIdx = defects.findIndex((b) => b && normalizeIdString(b.id) === cleanId);
  if (primaryIdx !== -1) {
    return { defect: defects[primaryIdx], index: primaryIdx };
  }

  const displayIdx = defects.findIndex(
    (b) => b && normalizeIdString(b.defectId) === cleanId
  );
  if (displayIdx !== -1) {
    return { defect: defects[displayIdx], index: displayIdx };
  }

  return { defect: null, index: -1 };
}

export async function loadDefectSequenceState(projectId, userId = null) {
  const cleanProjectId = normalizeIdString(projectId);
  if (!cleanProjectId) return normalizeSequenceState(null);
  try {
    const raw = await getStorage().getItem(
      getDefectSequenceStorageKey(cleanProjectId, userId)
    );
    if (!raw) return normalizeSequenceState(null);
    return normalizeSequenceState(JSON.parse(raw));
  } catch {
    return normalizeSequenceState(null);
  }
}

export async function saveDefectSequenceState(
  projectId,
  userId = null,
  sequenceState = null
) {
  const cleanProjectId = normalizeIdString(projectId);
  if (!cleanProjectId) return normalizeSequenceState(null);
  const normalized = normalizeSequenceState(sequenceState);
  try {
    await getStorage().setItem(
      getDefectSequenceStorageKey(cleanProjectId, userId),
      JSON.stringify(normalized)
    );
  } catch {
    // Non-fatal storage failure
  }
  return normalized;
}

export async function recordObservedDefectSequence(
  projectId,
  userId = null,
  { defects = [], testRuns = [], executions = [], tombstoneIds = [], extraIds = [] } = {}
) {
  const cleanProjectId = normalizeIdString(projectId);
  if (!cleanProjectId) return normalizeSequenceState(null);
  const existing = await loadDefectSequenceState(cleanProjectId, userId);
  const updated = computeHighWaterSequences({
    defects,
    testRuns,
    executions,
    tombstoneIds,
    extraIds,
    previousState: existing,
  });
  if (
    updated.defSeq !== existing.defSeq ||
    updated.bugSeq !== existing.bugSeq ||
    updated.reservedIds.length !== existing.reservedIds.length
  ) {
    await saveDefectSequenceState(cleanProjectId, userId, updated);
  }
  return updated;
}

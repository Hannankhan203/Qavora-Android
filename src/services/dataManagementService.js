/**
 * Qavora Android — Data Management, Backup, Restore & Recovery Snapshot Service (Phase 2F)
 *
 * Implements full parity with Qavora Web's `src/modules/dataManager.js` and
 * the Express 5 + MongoDB 7 backend routes in `server.ts`:
 * - `GET /api/data/storage-usage`
 * - `GET /api/data/recovery-snapshot`
 * - `DELETE /api/data/recovery-snapshot`
 * - `POST /api/data/rollback`
 * - `POST /api/data/import` (`mode: 'merge' | 'replace'`)
 * - `POST /api/data/reset`
 *
 * Also provides:
 * - Export generators for Individual Project JSON, Full Workspace Backup JSON,
 *   Test Cases CSV, Executions CSV, and Defects CSV
 * - Strict import validation (`parseAndValidateImportPayload`) rejecting
 *   malformed JSON, prohibited NoSQL/prototype keys (`$*`, dotted keys,
 *   `__proto__`, `constructor`, `prototype`), and unsupported backup/schema
 *   versions (`> 1`), while normalizing legacy nested structures and sanitizing
 *   duplicate IDs and broken cross-references
 * - Local per-user point-in-time recovery snapshots in AsyncStorage so users
 *   can create and restore snapshots even when offline
 */

import { Platform, Share } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { File as ExpoFile, Paths as ExpoPaths } from 'expo-file-system';
import * as ExpoSharing from 'expo-sharing';
import * as ExpoDocumentPicker from 'expo-document-picker';
import {
  apiGet,
  apiPost,
  apiDelete,
  ApiClientError,
} from './apiClient.js';
import {
  normalizeProjectRecord,
  buildDefaultTestPlan,
  extractSuiteTestCases,
  containsProhibitedKeys,
  ALLOWED_PROJECT_CREATE_FIELDS,
  ALLOWED_PROJECT_PATCH_FIELDS,
  ALLOWED_PROJECT_DATA_PATCH_FIELDS,
} from './projectService.js';
import {
  getCachedProjectsForUser,
  getPendingProjectOperations,
  cacheProjectOffline,
  cacheProjectsListOffline,
  removeCachedProjectOffline,
  queueProjectMutation,
  queueChecklistMutation,
  isClientOffline,
  getOfflineSyncStorageAdapter,
} from './offlineSyncService.js';
import {
  getOfflineProjectsCacheKey,
  getPendingProjectOpsKey,
  notifySyncListeners,
} from './offlineSync/syncState.js';
import {
  extractActiveIdsFromProjectDataPayload,
  subtractDeletionTombstones,
  hasAnyDeletionTombstones,
} from './offlineSync/deletionTombstones.js';
import {
  getChecklistCacheKey,
  normalizeChecklistRecord,
  normalizeChecklistItem,
  filterChecklistsForUser,
} from './checklists/checklistNormalization.js';
import {
  getCachedChecklistsForUser,
  cacheChecklistsForUser,
  cacheChecklistOffline,
  removeCachedChecklistOffline,
} from './checklists/checklistCache.js';
import { getProjectWorkspaceStorageKey } from '../context/workspace/workspaceConstants.js';
import {
  normalizeDefectsWithUniqueIds,
  recordObservedDefectSequence,
} from '../context/workspace/defectIdUtils.js';

export const SUPPORTED_BACKUP_VERSION = 1;
export const SUPPORTED_SCHEMA_VERSION = 1;
export const MAX_IMPORT_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB

export const LOCAL_SNAPSHOTS_STORAGE_PREFIX =
  '@qavora_local_recovery_snapshots_v1:';
export const MAX_LOCAL_SNAPSHOTS_PER_USER = 10;

const PROHIBITED_OBJECT_KEYS = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

const ALLOWED_JSON_MIME_TYPES = new Set([
  '',
  'application/json',
  'text/json',
  'application/x-json',
  'text/plain',
  'application/octet-stream',
]);

let customDataStorageAdapter = null;
let customNativeFileAdapters = null;

function getStorage() {
  if (customDataStorageAdapter) {
    return customDataStorageAdapter;
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
 * Allows injecting a custom storage adapter for deterministic Node tests.
 *
 * @param {object | null} adapter
 */
export function setDataManagementStorageAdapter(adapter) {
  customDataStorageAdapter = adapter;
}

/**
 * Allows injecting custom platform/file-system/sharing/document-picker adapters
 * for deterministic automated testing of native Android and Web workflows.
 *
 * @param {object | null} adapters
 */
export function setNativeFileAdaptersForTesting(adapters = null) {
  customNativeFileAdapters = adapters;
}

export function resetNativeFileAdaptersForTesting() {
  customNativeFileAdapters = null;
}

function getEffectivePlatformOS() {
  if (
    customNativeFileAdapters &&
    typeof customNativeFileAdapters.platformOS === 'string'
  ) {
    return customNativeFileAdapters.platformOS;
  }
  return Platform && Platform.OS ? Platform.OS : 'android';
}

function getSharingAdapter() {
  if (customNativeFileAdapters && customNativeFileAdapters.sharing) {
    return customNativeFileAdapters.sharing;
  }
  return ExpoSharing;
}

function getDocumentPickerAdapter() {
  if (customNativeFileAdapters && customNativeFileAdapters.documentPicker) {
    return customNativeFileAdapters.documentPicker;
  }
  return ExpoDocumentPicker;
}

function getRnShareAdapter() {
  if (customNativeFileAdapters && customNativeFileAdapters.rnShare) {
    return customNativeFileAdapters.rnShare;
  }
  return Share;
}

export function getLocalSnapshotsStorageKey(userId) {
  const cleanUser = userId ? String(userId).trim() : '';
  if (!cleanUser) return null;
  return `${LOCAL_SNAPSHOTS_STORAGE_PREFIX}${cleanUser}`;
}

export function computeUtf8ByteLength(input) {
  const str = typeof input === 'string' ? input : String(input ?? '');
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(str).byteLength;
  }
  if (typeof Blob !== 'undefined') {
    return new Blob([str]).size;
  }
  if (typeof Buffer !== 'undefined') {
    return Buffer.byteLength(str, 'utf8');
  }
  return str.length;
}

function escapeCSVCell(val) {
  if (val === null || val === undefined) return '""';
  let str = String(val);
  // Prevent CSV formula injection matching Qavora Web `dataManager.js:1194`
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  return `"${str.replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
}

function sanitizeFilenameSegment(raw) {
  const cleaned = String(raw || 'Project')
    .replace(/[^a-z0-9_-]/gi, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return cleaned || 'Project';
}

function sanitizeExportFilename(rawFilename, fallback = 'Qavora_Export.json') {
  const base = String(rawFilename || fallback)
    .trim()
    .replace(/[/\\?%*:|"<>]/g, '_')
    .replace(/\.\.+/g, '_');
  return base || fallback;
}

export function normalizeShareMimeType(mimeType = 'application/json', filename = '') {
  const rawMime = String(mimeType || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  const lowerName = String(filename || '').trim().toLowerCase();

  if (lowerName.endsWith('.json') || rawMime === 'application/json' || rawMime === 'text/json') {
    return 'application/json';
  }
  if (lowerName.endsWith('.csv') || rawMime === 'text/csv') {
    return 'text/csv';
  }
  if (
    lowerName.endsWith('.md') ||
    lowerName.endsWith('.markdown') ||
    rawMime === 'text/markdown'
  ) {
    return 'text/markdown';
  }
  return rawMime || 'application/octet-stream';
}

export function resolveShareUTI(cleanMimeType = 'application/json', filename = '') {
  const mime = normalizeShareMimeType(cleanMimeType, filename);
  if (mime === 'application/json') return 'public.json';
  if (mime === 'text/csv') return 'public.comma-separated-values-text';
  if (mime === 'text/markdown') return 'net.daringfireball.markdown';
  return 'public.data';
}

function dateStamp(now = new Date()) {
  return now.toISOString().split('T')[0];
}

function fullTimestamp(now = new Date()) {
  return now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

/**
 * Generates and writes an export or backup file into native device cache/document
 * storage using Expo SDK 58 `expo-file-system` (`File`, `Paths.cache`), returning
 * a `file://` URI ready for native Android system share-sheet sharing.
 *
 * @param {object} params
 * @param {string} params.filename
 * @param {string} params.content
 * @param {string} [params.mimeType='application/json']
 */
export async function writeExportFileToNativeStorage({
  filename,
  content = '',
  mimeType = 'application/json',
} = {}) {
  const safeFilename = sanitizeExportFilename(filename, 'Qavora_Export.json');
  const stringContent = typeof content === 'string' ? content : String(content ?? '');
  const cleanMimeType = normalizeShareMimeType(mimeType, safeFilename);
  const sizeBytes = computeUtf8ByteLength(stringContent);

  const fsOverride =
    customNativeFileAdapters && customNativeFileAdapters.fileSystem
      ? customNativeFileAdapters.fileSystem
      : null;

  if (fsOverride && typeof fsOverride.writeFile === 'function') {
    const written = await fsOverride.writeFile({
      filename: safeFilename,
      content: stringContent,
      mimeType: cleanMimeType,
      sizeBytes,
    });
    const fileUri =
      written && typeof written.uri === 'string'
        ? written.uri
        : `file:///cache/${safeFilename}`;
    return {
      ok: true,
      fileUri,
      filename: safeFilename,
      mimeType: cleanMimeType,
      sizeBytes,
    };
  }

  const baseDir =
    fsOverride && fsOverride.cacheDirectory
      ? fsOverride.cacheDirectory
      : ExpoPaths.cache || ExpoPaths.document;

  const FileCtor =
    fsOverride && fsOverride.File ? fsOverride.File : ExpoFile;

  const fileHandle = new FileCtor(baseDir, safeFilename);
  if (typeof fileHandle.create === 'function') {
    fileHandle.create({ overwrite: true, intermediates: true });
  }
  if (typeof fileHandle.write === 'function') {
    await fileHandle.write(stringContent);
  }

  const fileUri =
    fileHandle && typeof fileHandle.uri === 'string' && fileHandle.uri
      ? fileHandle.uri
      : `file:///cache/${safeFilename}`;

  return {
    ok: true,
    fileUri,
    filename: safeFilename,
    mimeType: cleanMimeType,
    sizeBytes,
  };
}

/**
 * Triggers a cross-platform download (Web Blob) or native file generation +
 * Android/iOS system share sheet (`expo-sharing` with file URI) and returns
 * the generated file metadata, content, and `fileUri`.
 */
export async function shareOrDownloadFile({
  filename,
  mimeType = 'application/json',
  content = '',
  title = 'Qavora Data Export',
  skipPlatformShare = false,
  existingFileUri = null,
} = {}) {
  const safeFilename = sanitizeExportFilename(filename, 'Qavora_Export.json');
  const stringContent = typeof content === 'string' ? content : String(content ?? '');
  const cleanMimeType = normalizeShareMimeType(mimeType, safeFilename);
  const uti = resolveShareUTI(cleanMimeType, safeFilename);
  const sizeBytes = computeUtf8ByteLength(stringContent);
  const platformOS = getEffectivePlatformOS();

  let fileUri = existingFileUri || null;
  let shared = false;
  let shareMethod = null;
  let shareError = null;

  if (platformOS === 'web') {
    if (!skipPlatformShare) {
      try {
        const webDom =
          customNativeFileAdapters && customNativeFileAdapters.webDom
            ? customNativeFileAdapters.webDom
            : typeof document !== 'undefined' &&
              typeof Blob !== 'undefined' &&
              typeof URL !== 'undefined' &&
              typeof URL.createObjectURL === 'function'
            ? { document, Blob, URL }
            : null;

        if (webDom) {
          const blobMime =
            String(mimeType || '').includes('charset')
              ? mimeType
              : `${cleanMimeType};charset=utf-8;`;
          const blob = new webDom.Blob([stringContent], { type: blobMime });
          const url = webDom.URL.createObjectURL(blob);
          const anchor = webDom.document.createElement('a');
          anchor.href = url;
          anchor.download = safeFilename;
          if (typeof anchor.setAttribute === 'function') {
            anchor.setAttribute('download', safeFilename);
          }
          webDom.document.body.appendChild(anchor);
          anchor.click();
          webDom.document.body.removeChild(anchor);
          webDom.URL.revokeObjectURL(url);
          shared = true;
          shareMethod = 'web_download';
        }
      } catch (err) {
        shared = false;
        shareError = (err && err.message) || 'Browser download failed.';
      }
    }

    return {
      ok: true,
      filename: safeFilename,
      mimeType: cleanMimeType,
      content: stringContent,
      sizeBytes,
      fileUri: null,
      shared,
      shareMethod,
      error: shareError,
    };
  }

  // Native Android / iOS: always write the actual file to native cache/document storage first
  if (!fileUri) {
    try {
      const writeRes = await writeExportFileToNativeStorage({
        filename: safeFilename,
        content: stringContent,
        mimeType: cleanMimeType,
      });
      if (writeRes && writeRes.ok && writeRes.fileUri) {
        fileUri = writeRes.fileUri;
      }
    } catch (writeErr) {
      return {
        ok: false,
        filename: safeFilename,
        mimeType: cleanMimeType,
        content: stringContent,
        sizeBytes,
        fileUri: null,
        shared: false,
        shareMethod: null,
        error:
          (writeErr && writeErr.message) ||
          'Failed to write export file to device storage.',
      };
    }
  }

  if (!skipPlatformShare) {
    try {
      const sharing = getSharingAdapter();
      const canUseNativeSharing =
        sharing &&
        typeof sharing.isAvailableAsync === 'function' &&
        typeof sharing.shareAsync === 'function'
          ? await sharing.isAvailableAsync()
          : false;

      if (canUseNativeSharing && fileUri) {
        await sharing.shareAsync(fileUri, {
          mimeType: cleanMimeType,
          dialogTitle: title,
          UTI: uti,
        });
        shared = true;
        shareMethod = 'expo_sharing';
      } else {
        const rnShare = getRnShareAdapter();
        if (rnShare && typeof rnShare.share === 'function') {
          await rnShare.share({
            title: `${title} (${safeFilename})`,
            url: fileUri || undefined,
            message: stringContent,
          });
          shared = true;
          shareMethod = 'rn_share_fallback';
        }
      }
    } catch (err) {
      shared = false;
      shareError = (err && err.message) || 'Share sheet was dismissed or unavailable.';
    }
  }

  return {
    ok: true,
    filename: safeFilename,
    mimeType: cleanMimeType,
    content: stringContent,
    sizeBytes,
    fileUri,
    shared,
    shareMethod,
    error: shareError,
  };
}

// ============================================================================
// 1. EXPORT & BACKUP GENERATORS (QAVORA WEB `dataManager.js` PARITY)
// ============================================================================

/**
 * Normalizes a project object so all nested QA structures (`testPlan`,
 * `testSuites` with both `cases` and `testCases`, `executionRuns`, `executions`,
 * `defects`, and summary counters) match Qavora Web's export schema.
 *
 * @param {object} project
 * @returns {object}
 */
export function buildStandardizedProjectExportObject(project) {
  if (!project || typeof project !== 'object') {
    throw new Error('A valid project object is required for export.');
  }

  const normalized = normalizeProjectRecord(project);
  const nowIso = new Date().toISOString();
  const testPlan = buildDefaultTestPlan(normalized);

  const testSuites = (
    Array.isArray(normalized.testSuites) ? normalized.testSuites : []
  ).map((suite, sIdx) => {
    const rawCases = extractSuiteTestCases(suite);
    const cases = rawCases.map((tc, cIdx) => ({
      ...tc,
      id: String((tc && (tc.id || tc.testCaseId)) || `TC-${sIdx + 1}${cIdx + 1}`),
      testCaseId: String(
        (tc && (tc.testCaseId || tc.id)) || `TC-${sIdx + 1}${cIdx + 1}`
      ),
      suiteId: String((suite && suite.id) || `suite-${sIdx + 1}`),
      suiteName: (suite && suite.name) || `Suite ${sIdx + 1}`,
      title: (tc && tc.title) || 'Untitled Test Case',
      priority: (tc && tc.priority) || 'P1',
      category: (tc && (tc.category || tc.testType)) || 'Functional',
      testType: (tc && (tc.testType || tc.category)) || 'Functional',
      preconditions: (tc && tc.preconditions) || 'Standard application state.',
      steps: Array.isArray(tc && tc.steps) ? tc.steps : [],
      expectedResult:
        (tc && tc.expectedResult) || 'All test steps pass without error.',
      status: (tc && tc.status) || 'Not Run',
    }));

    return {
      ...suite,
      id: String((suite && suite.id) || `suite-${sIdx + 1}`),
      name: (suite && suite.name) || `Suite ${sIdx + 1}`,
      category: (suite && suite.category) || 'Functional',
      description: (suite && suite.description) || '',
      cases,
      testCases: cases,
    };
  });

  return {
    ...normalized,
    testPlan,
    testSuites,
    executionRuns: Array.isArray(normalized.executionRuns)
      ? normalized.executionRuns
      : [],
    activeRun: normalized.activeRun || null,
    executions: Array.isArray(normalized.executions)
      ? normalized.executions
      : [],
    defects: Array.isArray(normalized.defects) ? normalized.defects : [],
    updatedAt: normalized.updatedAt || nowIso,
  };
}

/**
 * Exports a single project as standardized JSON matching Qavora Web's
 * `exportProjectAsJSON` (`Qavora_Project_<Name>_<Date>.json`).
 *
 * @param {object} project
 * @param {object} [options]
 */
export async function exportProjectAsJSON(project, options = {}) {
  if (!project || typeof project !== 'object') {
    return {
      ok: false,
      error: 'Select a valid project to export.',
    };
  }

  const standardized = buildStandardizedProjectExportObject(project);
  const safeName = sanitizeFilenameSegment(standardized.name);
  const filename = `Qavora_Project_${safeName}_${dateStamp()}.json`;
  const content = JSON.stringify(standardized, null, 2);

  const fileRes = await shareOrDownloadFile({
    filename,
    mimeType: 'application/json',
    content,
    title: `Qavora Project Export - ${standardized.name}`,
    skipPlatformShare: Boolean(options.skipPlatformShare),
  });

  return {
    ...fileRes,
    format: 'project_json',
    project: standardized,
  };
}

/**
 * Builds the Full Application Backup payload matching Qavora Web's
 * `exportFullBackup` (`dataManager.js:244–292`).
 *
 * @param {Array<object>} projects
 * @param {Array<object>} [checklists=[]]
 * @param {object | null} [user=null]
 */
export function createFullBackupPayload(
  projects = [],
  checklists = [],
  user = null
) {
  const safeProjects = (Array.isArray(projects) ? projects : []).map((p) =>
    buildStandardizedProjectExportObject(p)
  );
  const safeChecklists = Array.isArray(checklists) ? checklists : [];

  let totalPlans = 0;
  let totalSuites = 0;
  let totalTestCases = 0;
  let totalExecutions = 0;
  let totalDefects = 0;

  safeProjects.forEach((p) => {
    if (p.testPlan && typeof p.testPlan === 'object') totalPlans += 1;
    const suites = Array.isArray(p.testSuites) ? p.testSuites : [];
    totalSuites += suites.length;
    suites.forEach((s) => {
      const cases = extractSuiteTestCases(s);
      totalTestCases += cases.length;
    });
    if (Array.isArray(p.executions)) totalExecutions += p.executions.length;
    if (Array.isArray(p.defects)) totalDefects += p.defects.length;
  });

  return {
    application: 'Qavora',
    backupVersion: SUPPORTED_BACKUP_VERSION,
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    metadata: {
      totalProjects: safeProjects.length,
      totalPlans,
      totalSuites,
      totalTestCases,
      totalExecutions,
      totalDefects,
      totalChecklists: safeChecklists.length,
      exportedBy:
        user && user.email
          ? {
              userId: user.userId,
              email: user.email,
              name: user.name,
            }
          : null,
    },
    projects: safeProjects,
    checklists: safeChecklists,
  };
}

/**
 * Generates and downloads/shares a Full Application Backup JSON file
 * (`Qavora_Full_Backup_<Timestamp>.json`).
 *
 * @param {Array<object>} projects
 * @param {Array<object>} [checklists=[]]
 * @param {object} [options={}]
 */
export async function exportFullBackup(
  projects = [],
  checklists = [],
  options = {}
) {
  const payload = createFullBackupPayload(
    projects,
    checklists,
    options.user || null
  );
  const filename = `Qavora_Full_Backup_${fullTimestamp()}.json`;
  const content = JSON.stringify(payload, null, 2);

  const fileRes = await shareOrDownloadFile({
    filename,
    mimeType: 'application/json',
    content,
    title: 'Qavora Full Workspace Backup',
    skipPlatformShare: Boolean(options.skipPlatformShare),
  });

  return {
    ...fileRes,
    format: 'full_backup_json',
    backup: payload,
  };
}

/**
 * Exports Test Cases to CSV matching Qavora Web's `exportTestCasesCSV`
 * (`dataManager.js:304–342`).
 *
 * Columns:
 * Project ID, Project Name, Suite ID, Suite Name, Test Case ID, Title,
 * Priority, Category, Preconditions, Test Steps, Expected Result, Current Status
 *
 * @param {Array<object> | object} projectsOrProject
 * @param {object} [options]
 */
export async function exportTestCasesCSV(projectsOrProject, options = {}) {
  const projects = Array.isArray(projectsOrProject)
    ? projectsOrProject
    : projectsOrProject
    ? [projectsOrProject]
    : [];

  const rows = [
    [
      'Project ID',
      'Project Name',
      'Suite ID',
      'Suite Name',
      'Test Case ID',
      'Title',
      'Priority',
      'Category',
      'Preconditions',
      'Test Steps',
      'Expected Result',
      'Current Status',
    ],
  ];

  let exportedCount = 0;

  projects.forEach((rawProj) => {
    if (!rawProj || typeof rawProj !== 'object') return;
    const p = buildStandardizedProjectExportObject(rawProj);
    const suites = Array.isArray(p.testSuites) ? p.testSuites : [];
    suites.forEach((s) => {
      const cases = Array.isArray(s.cases)
        ? s.cases
        : Array.isArray(s.testCases)
        ? s.testCases
        : [];
      cases.forEach((tc) => {
        const stepsStr = Array.isArray(tc.steps)
          ? tc.steps
              .map(
                (st, i) =>
                  `${st.stepNumber || i + 1}. ${
                    typeof st === 'string' ? st : st.action || ''
                  }`
              )
              .join(' | ')
          : String(tc.steps || '');

        rows.push([
          p.id,
          p.name,
          s.id || '',
          s.name || 'Default Suite',
          tc.id || tc.testCaseId || '',
          tc.title || '',
          tc.priority || 'Medium',
          tc.category || tc.testType || 'Functional',
          tc.preconditions || '',
          stepsStr,
          tc.expectedResult || '',
          tc.status || tc.lastStatus || 'Not Run',
        ]);
        exportedCount += 1;
      });
    });
  });

  const csvContent = rows
    .map((r) => r.map((cell) => escapeCSVCell(cell)).join(','))
    .join('\n');
  const filename = `Qavora_TestCases_${dateStamp()}.csv`;

  const fileRes = await shareOrDownloadFile({
    filename,
    mimeType: 'text/csv;charset=utf-8;',
    content: csvContent,
    title: 'Qavora Test Cases CSV Export',
    skipPlatformShare: Boolean(options.skipPlatformShare),
  });

  return {
    ...fileRes,
    format: 'testcases_csv',
    rowCount: exportedCount,
  };
}

/**
 * Exports Test Executions to CSV matching Qavora Web's `exportExecutionsCSV`
 * (`dataManager.js:344–364`).
 *
 * Columns:
 * Project ID, Project Name, Execution ID, Test Case ID, Case Title, Suite Name,
 * Status, Executed By, Environment, Executed At, Notes / Actual Result, Linked Defect ID
 *
 * @param {Array<object> | object} projectsOrProject
 * @param {object} [options]
 */
export async function exportExecutionsCSV(projectsOrProject, options = {}) {
  const projects = Array.isArray(projectsOrProject)
    ? projectsOrProject
    : projectsOrProject
    ? [projectsOrProject]
    : [];

  const rows = [
    [
      'Project ID',
      'Project Name',
      'Execution ID',
      'Test Case ID',
      'Case Title',
      'Suite Name',
      'Status',
      'Executed By',
      'Environment',
      'Executed At',
      'Notes / Actual Result',
      'Linked Defect ID',
    ],
  ];

  let exportedCount = 0;

  projects.forEach((rawProj) => {
    if (!rawProj || typeof rawProj !== 'object') return;
    const p = buildStandardizedProjectExportObject(rawProj);
    const executions = Array.isArray(p.executions) ? p.executions : [];

    if (executions.length > 0) {
      executions.forEach((ex) => {
        rows.push([
          p.id,
          p.name,
          ex.id || '',
          ex.testCaseId || ex.caseId || '',
          ex.caseTitle || '',
          ex.suiteName || '',
          ex.status || ex.outcome || '',
          ex.tester || ex.executedBy || 'QA Engineer',
          ex.environment || p.environment || '',
          ex.executedAt || ex.timestamp || '',
          ex.notes || ex.actualResult || '',
          ex.linkedDefectId || '',
        ]);
        exportedCount += 1;
      });
    } else if (Array.isArray(p.executionRuns)) {
      // Fallback: include executed results from executionRuns if `executions` array was empty
      p.executionRuns.forEach((run) => {
        const results = Array.isArray(run.results) ? run.results : [];
        results.forEach((res, idx) => {
          if (!res || (!res.executedAt && res.status === 'Untested')) return;
          rows.push([
            p.id,
            p.name,
            `${run.id || 'RUN'}_${idx + 1}`,
            res.testCaseId || res.caseId || '',
            res.caseTitle || '',
            res.suiteName || run.suiteName || '',
            res.outcome || res.status || '',
            res.tester || run.tester || 'QA Engineer',
            res.environment || run.environment || p.environment || '',
            res.executedAt || run.updatedAt || '',
            res.notes || res.actualResult || '',
            res.linkedDefectId || '',
          ]);
          exportedCount += 1;
        });
      });
    }
  });

  const csvContent = rows
    .map((r) => r.map((cell) => escapeCSVCell(cell)).join(','))
    .join('\n');
  const filename = `Qavora_Executions_${dateStamp()}.csv`;

  const fileRes = await shareOrDownloadFile({
    filename,
    mimeType: 'text/csv;charset=utf-8;',
    content: csvContent,
    title: 'Qavora Executions CSV Export',
    skipPlatformShare: Boolean(options.skipPlatformShare),
  });

  return {
    ...fileRes,
    format: 'executions_csv',
    rowCount: exportedCount,
  };
}

/**
 * Exports Defects to CSV matching Qavora Web's `exportDefectsCSV`
 * (`dataManager.js:366–387`).
 *
 * Columns:
 * Project ID, Project Name, Defect ID, Title, Severity, Priority, Status,
 * Environment, Linked Test Case ID, Steps to Reproduce, Expected Result,
 * Actual Result, Created At, Updated At
 *
 * @param {Array<object> | object} projectsOrProject
 * @param {object} [options]
 */
export async function exportDefectsCSV(projectsOrProject, options = {}) {
  const projects = Array.isArray(projectsOrProject)
    ? projectsOrProject
    : projectsOrProject
    ? [projectsOrProject]
    : [];

  const rows = [
    [
      'Project ID',
      'Project Name',
      'Defect ID',
      'Title',
      'Severity',
      'Priority',
      'Status',
      'Environment',
      'Linked Test Case ID',
      'Steps to Reproduce',
      'Expected Result',
      'Actual Result',
      'Created At',
      'Updated At',
    ],
  ];

  let exportedCount = 0;

  projects.forEach((rawProj) => {
    if (!rawProj || typeof rawProj !== 'object') return;
    const p = buildStandardizedProjectExportObject(rawProj);
    const defects = Array.isArray(p.defects) ? p.defects : [];

    defects.forEach((d) => {
      rows.push([
        p.id,
        p.name,
        d.id || d.defectId || '',
        d.title || '',
        d.severity || '',
        d.priority || '',
        d.status || '',
        d.environment || p.environment || '',
        d.linkedTestCaseId || d.testCaseId || '',
        d.stepsToReproduce || d.reproductionSteps || d.steps || '',
        d.expectedResult || '',
        d.actualResult || '',
        d.createdAt || '',
        d.updatedAt || '',
      ]);
      exportedCount += 1;
    });
  });

  const csvContent = rows
    .map((r) => r.map((cell) => escapeCSVCell(cell)).join(','))
    .join('\n');
  const filename = `Qavora_Defects_${dateStamp()}.csv`;

  const fileRes = await shareOrDownloadFile({
    filename,
    mimeType: 'text/csv;charset=utf-8;',
    content: csvContent,
    title: 'Qavora Defects CSV Export',
    skipPlatformShare: Boolean(options.skipPlatformShare),
  });

  return {
    ...fileRes,
    format: 'defects_csv',
    rowCount: exportedCount,
  };
}

// ============================================================================
// 2. STRICT IMPORT VALIDATION & SANITIZATION (`dataManager.js:489–670` PARITY)
// ============================================================================

/**
 * Recursively inspects a parsed JSON object for prohibited NoSQL operator keys
 * (`$where`, `$gt`, etc.), dotted path keys (`a.b`), or prototype-pollution keys
 * (`__proto__`, `constructor`, `prototype`).
 *
 * @param {any} value
 * @param {string} [path='root']
 */
export function assertSafeImportObjectKeys(value, path = 'root') {
  if (!value || typeof value !== 'object') {
    return;
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      assertSafeImportObjectKeys(value[i], `${path}[${i}]`);
    }
    return;
  }

  // Use Object.getOwnPropertyNames to also catch literal "__proto__" keys from JSON.parse
  const ownKeys = Object.getOwnPropertyNames(value);
  for (const key of ownKeys) {
    if (PROHIBITED_OBJECT_KEYS.has(key)) {
      throw new Error(
        `Security validation failed: Prohibited prototype key "${key}" found at ${path}.`
      );
    }
    if (key.startsWith('$')) {
      throw new Error(
        `Security validation failed: Prohibited query operator key "${key}" found at ${path}.`
      );
    }
    if (key.includes('.')) {
      throw new Error(
        `Security validation failed: Prohibited dotted field key "${key}" found at ${path}.`
      );
    }
    assertSafeImportObjectKeys(value[key], `${path}.${key}`);
  }
}

/**
 * Validates, normalizes, and sanitizes an imported JSON backup or project file
 * matching Qavora Web's `parseAndValidateImportPayload` (`dataManager.js:489–670`).
 *
 * Rejects:
 * - Empty or non-JSON input
 * - Files exceeding 15 MB
 * - Payloads containing `$` operator keys, dotted keys, or `__proto__`
 * - Incompatible `backupVersion > 1` or `schemaVersion > 1`
 * - Unrecognized JSON structures or projects missing valid `name`
 *
 * Sanitizes:
 * - Legacy nested `testPlan.phases[].suites[].testCases[]` into `project.testSuites[]`
 * - Duplicate suite IDs, test case IDs, execution IDs, and defect IDs within a project
 * - Broken cross-references (`linkedTestCaseId`, `linkedTestRunId`, `phaseId`)
 * - Computes accurate summary metrics (`testCaseCount`, `passedTests`, `failedTests`,
 *   `blockedTests`, `notRunTests`, `passRate`, `totalDefects`, `openDefects`, etc.)
 *
 * @param {string | object} jsonInput
 * @param {object} [options]
 * @param {string} [options.fileName='backup.json']
 * @param {number} [options.fileSize=0]
 * @param {Array<object>} [options.existingProjects=[]]
 */
export function validateAndNormalizeImportedChecklists(
  rawChecklists,
  warnings = []
) {
  if (rawChecklists === undefined || rawChecklists === null) {
    return { ok: true, checklists: [] };
  }
  if (!Array.isArray(rawChecklists)) {
    return {
      ok: false,
      error: 'Field "checklists" must be an array.',
    };
  }

  const normalizedList = [];
  const seenIds = new Set();

  for (let i = 0; i < rawChecklists.length; i += 1) {
    const rawChk = rawChecklists[i];
    if (!rawChk || typeof rawChk !== 'object' || Array.isArray(rawChk)) {
      return {
        ok: false,
        error: `Checklist at index ${i} is not a valid object.`,
      };
    }

    const rawId =
      rawChk.id !== undefined &&
      rawChk.id !== null &&
      String(rawChk.id).trim() !== ''
        ? String(rawChk.id).trim()
        : rawChk._id !== undefined &&
          rawChk._id !== null &&
          String(rawChk._id).trim() !== ''
        ? String(rawChk._id).trim()
        : '';

    if (
      rawId &&
      (rawId.includes('/') || rawId.includes('\\') || rawId.includes('..'))
    ) {
      return {
        ok: false,
        error: `Checklist ID "${rawId}" at index ${i} contains invalid path characters.`,
      };
    }

    const rawTitle =
      typeof rawChk.title === 'string' && rawChk.title.trim()
        ? rawChk.title.trim()
        : typeof rawChk.name === 'string' && rawChk.name.trim()
        ? rawChk.name.trim()
        : '';

    if (!rawId && !rawTitle) {
      return {
        ok: false,
        error: `Checklist at index ${i} is missing a required "title" or "id".`,
      };
    }

    if (rawChk.items !== undefined && !Array.isArray(rawChk.items)) {
      return {
        ok: false,
        error: `Checklist "${rawTitle || rawId}" has an invalid "items" field (expected an array).`,
      };
    }
    if (rawChk.phases !== undefined && !Array.isArray(rawChk.phases)) {
      return {
        ok: false,
        error: `Checklist "${rawTitle || rawId}" has an invalid "phases" field (expected an array).`,
      };
    }

    const directItemLists = [
      { label: 'items', list: rawChk.items },
      { label: 'checklistItems', list: rawChk.checklistItems },
      { label: 'tasks', list: rawChk.tasks },
    ];
    for (let lIdx = 0; lIdx < directItemLists.length; lIdx += 1) {
      const entry = directItemLists[lIdx];
      if (Array.isArray(entry.list)) {
        for (let itemIdx = 0; itemIdx < entry.list.length; itemIdx += 1) {
          if (!normalizeChecklistItem(entry.list[itemIdx], itemIdx)) {
            return {
              ok: false,
              error: `Checklist "${rawTitle || rawId}" contains an unsupported or malformed item in "${entry.label}" at index ${itemIdx}.`,
            };
          }
        }
      }
    }

    if (Array.isArray(rawChk.phases)) {
      for (let pIdx = 0; pIdx < rawChk.phases.length; pIdx += 1) {
        const ph = rawChk.phases[pIdx];
        if (!ph || typeof ph !== 'object' || Array.isArray(ph)) {
          return {
            ok: false,
            error: `Checklist "${rawTitle || rawId}" contains an invalid phase at index ${pIdx}.`,
          };
        }
        const phItems = Array.isArray(ph.items)
          ? ph.items
          : Array.isArray(ph.tasks)
          ? ph.tasks
          : Array.isArray(ph.checks)
          ? ph.checks
          : null;
        if (phItems) {
          for (let itemIdx = 0; itemIdx < phItems.length; itemIdx += 1) {
            if (!normalizeChecklistItem(phItems[itemIdx], itemIdx)) {
              return {
                ok: false,
                error: `Checklist "${rawTitle || rawId}" phase ${pIdx + 1} contains an unsupported or malformed item at index ${itemIdx}.`,
              };
            }
          }
        }
      }
    }

    const baseId = rawId || `chk_imp_${Date.now()}_${i + 1}`;
    let assignedId = baseId;
    if (seenIds.has(assignedId)) {
      let dupCounter = i + 1;
      assignedId = `${baseId}_dup_${dupCounter}`;
      while (seenIds.has(assignedId)) {
        dupCounter += 1;
        assignedId = `${baseId}_dup_${dupCounter}`;
      }
      if (Array.isArray(warnings)) {
        warnings.push(
          `Duplicate checklist ID "${baseId}" in import file was reassigned to "${assignedId}".`
        );
      }
    }
    seenIds.add(assignedId);

    const normalized = normalizeChecklistRecord({
      ...rawChk,
      id: assignedId,
      ...(rawTitle ? { title: rawTitle } : {}),
    });
    if (!normalized) {
      return {
        ok: false,
        error: `Checklist at index ${i} could not be normalized.`,
      };
    }

    normalizedList.push(normalized);
  }

  return {
    ok: true,
    checklists: normalizedList,
  };
}

export function parseAndValidateImportPayload(jsonInput, options = {}) {
  const {
    fileName = 'backup.json',
    fileSize = 0,
    existingProjects = [],
    existingChecklists = [],
  } = options || {};

  if (fileSize > MAX_IMPORT_SIZE_BYTES) {
    return {
      ok: false,
      error: 'Import file exceeds the maximum allowed size of 15 MB.',
    };
  }

  let raw = null;
  if (typeof jsonInput === 'string') {
    const trimmed = jsonInput.trim();
    if (!trimmed) {
      return {
        ok: false,
        error: 'Import payload is empty. Provide a valid Qavora JSON backup.',
      };
    }
    const payloadBytes = computeUtf8ByteLength(trimmed);
    if (payloadBytes > MAX_IMPORT_SIZE_BYTES || trimmed.length > MAX_IMPORT_SIZE_BYTES) {
      return {
        ok: false,
        error: 'Import payload exceeds the maximum allowed size of 15 MB.',
      };
    }
    try {
      raw = JSON.parse(trimmed);
    } catch {
      return {
        ok: false,
        error: 'Invalid JSON format. Ensure the backup file is not corrupted.',
      };
    }
  } else if (
    jsonInput &&
    typeof jsonInput === 'object' &&
    !Array.isArray(jsonInput)
  ) {
    raw = jsonInput;
  } else if (Array.isArray(jsonInput)) {
    raw = jsonInput;
  } else {
    return {
      ok: false,
      error: 'Root payload must be a valid JSON object or array.',
    };
  }

  if (!raw || typeof raw !== 'object') {
    return {
      ok: false,
      error: 'Root payload must be a JSON object or array.',
    };
  }

  // Security validation against NoSQL operator / prototype pollution keys
  try {
    assertSafeImportObjectKeys(raw);
  } catch (secErr) {
    return {
      ok: false,
      error: secErr.message || 'Security validation failed on imported JSON.',
    };
  }

  let formatType = 'Unknown';
  let incomingProjects = [];
  let incomingChecklists = [];
  const warnings = [];

  if (!Array.isArray(raw)) {
    if (
      raw.backupVersion !== undefined &&
      (typeof raw.backupVersion !== 'number' ||
        raw.backupVersion < 1 ||
        raw.backupVersion > SUPPORTED_BACKUP_VERSION)
    ) {
      return {
        ok: false,
        error: `Incompatible backupVersion (${raw.backupVersion}). Supported version is ${SUPPORTED_BACKUP_VERSION}.`,
      };
    }

    if (
      raw.schemaVersion !== undefined &&
      (typeof raw.schemaVersion !== 'number' ||
        raw.schemaVersion < 1 ||
        raw.schemaVersion > SUPPORTED_SCHEMA_VERSION)
    ) {
      return {
        ok: false,
        error: `Incompatible schemaVersion (${raw.schemaVersion}). Supported version is ${SUPPORTED_SCHEMA_VERSION}.`,
      };
    }
  }

  if (!Array.isArray(raw) && raw.projects !== undefined && !Array.isArray(raw.projects)) {
    return {
      ok: false,
      error: 'Field "projects" must be an array.',
    };
  }
  if (!Array.isArray(raw) && raw.checklists !== undefined && !Array.isArray(raw.checklists)) {
    return {
      ok: false,
      error: 'Field "checklists" must be an array.',
    };
  }

  if (
    !Array.isArray(raw) &&
    raw.application === 'Qavora' &&
    (Array.isArray(raw.projects) || Array.isArray(raw.checklists))
  ) {
    formatType = 'Full Application Backup';
    incomingProjects = Array.isArray(raw.projects) ? raw.projects : [];
    incomingChecklists = Array.isArray(raw.checklists) ? raw.checklists : [];
  } else if (!Array.isArray(raw) && Array.isArray(raw.projects)) {
    formatType = 'Multi-Project Archive';
    incomingProjects = raw.projects;
    if (Array.isArray(raw.checklists)) {
      incomingChecklists = raw.checklists;
    }
  } else if (!Array.isArray(raw) && Array.isArray(raw.checklists)) {
    formatType = 'Checklists Backup';
    incomingProjects = [];
    incomingChecklists = raw.checklists;
  } else if (
    !Array.isArray(raw) &&
    typeof raw.name === 'string' &&
    raw.name.trim()
  ) {
    formatType = 'Individual Project Export';
    incomingProjects = [raw];
  } else if (
    Array.isArray(raw) &&
    raw.length > 0 &&
    raw.every((item) => item && typeof item === 'object' && typeof item.name === 'string')
  ) {
    formatType = 'Projects List';
    incomingProjects = raw;
  } else {
    return {
      ok: false,
      error:
        'Unrecognized backup structure. Expected a Qavora Full Backup or Project JSON export.',
    };
  }

  if (incomingProjects.length === 0 && incomingChecklists.length === 0) {
    return {
      ok: false,
      error: 'The selected backup file contains no projects or checklists to import.',
    };
  }

  const sanitizedProjects = [];
  const seenProjectIdsInBatch = new Set();

  let plansCount = 0;
  let suitesCount = 0;
  let casesCount = 0;
  let executionsCount = 0;
  let defectsCount = 0;

  for (let i = 0; i < incomingProjects.length; i += 1) {
    const p = incomingProjects[i];
    if (!p || typeof p !== 'object' || Array.isArray(p)) {
      return {
        ok: false,
        error: `Project at index ${i} is not a valid object.`,
      };
    }
    if (typeof p.name !== 'string' || !p.name.trim()) {
      return {
        ok: false,
        error: `Project at index ${i} is missing a required project "name".`,
      };
    }

    const nowIso = new Date().toISOString();
    let projectId = String(
      p.id || p._id || `proj_${Date.now()}_${i}`
    ).trim();
    if (seenProjectIdsInBatch.has(projectId)) {
      const deduplicatedId = `${projectId}_dup_${i + 1}`;
      warnings.push(
        `Duplicate project ID "${projectId}" in import file was reassigned to "${deduplicatedId}".`
      );
      projectId = deduplicatedId;
    }
    seenProjectIdsInBatch.add(projectId);

    // Merge modern `testSuites` with legacy nested `testPlan.phases[].suites[].testCases[]`,
    // deduplicating by stable suite ID while preserving phase links and all valid records.
    const modernSuites = Array.isArray(p.testSuites) ? p.testSuites : [];
    const legacySuites = [];
    const rawPlan =
      p.testPlan && typeof p.testPlan === 'object' && !Array.isArray(p.testPlan)
        ? { ...p.testPlan }
        : null;

    if (rawPlan) {
      plansCount += 1;
      if (Array.isArray(rawPlan.phases)) {
        rawPlan.phases = rawPlan.phases
          .filter((ph) => ph && typeof ph === 'object')
          .map((ph, phIdx) => {
            const phaseId = String(ph.id || `ph_${i}_${phIdx + 1}`).trim();
            if (Array.isArray(ph.suites) && ph.suites.length > 0) {
              ph.suites.forEach((legacySuite) => {
                if (
                  legacySuite &&
                  typeof legacySuite === 'object' &&
                  !Array.isArray(legacySuite)
                ) {
                  const explicitPhaseId =
                    typeof legacySuite.phaseId === 'string' &&
                    legacySuite.phaseId.trim()
                      ? legacySuite.phaseId.trim()
                      : '';
                  legacySuites.push({
                    ...legacySuite,
                    phaseId: explicitPhaseId || phaseId,
                  });
                }
              });
            }
            return {
              id: phaseId,
              name:
                typeof ph.name === 'string' && ph.name.trim()
                  ? ph.name.trim()
                  : `Phase ${phIdx + 1}`,
              description:
                typeof ph.description === 'string' ? ph.description.trim() : '',
              order: typeof ph.order === 'number' ? ph.order : phIdx + 1,
              status: ph.status || 'Active',
            };
          });
      }
    }

    const validPhaseIds = new Set(
      rawPlan && Array.isArray(rawPlan.phases)
        ? rawPlan.phases.map((ph) => ph.id)
        : []
    );

    const resolveStableSuiteId = (s) => {
      if (typeof s.id === 'string' && s.id.trim()) return s.id.trim();
      if (typeof s.suiteId === 'string' && s.suiteId.trim()) {
        return s.suiteId.trim();
      }
      if (s._id !== undefined && s._id !== null && String(s._id).trim()) {
        return String(s._id).trim();
      }
      return '';
    };

    const mergedSuitesById = new Map();
    const combinedRawSuites = [...modernSuites, ...legacySuites];
    let fallbackSuiteCounter = 0;

    combinedRawSuites.forEach((s) => {
      if (!s || typeof s !== 'object' || Array.isArray(s)) {
        return;
      }

      const explicitId = resolveStableSuiteId(s);
      let suiteKey = explicitId;
      if (!suiteKey) {
        fallbackSuiteCounter += 1;
        suiteKey = `suite_${i}_${fallbackSuiteCounter}`;
        while (mergedSuitesById.has(suiteKey)) {
          fallbackSuiteCounter += 1;
          suiteKey = `suite_${i}_${fallbackSuiteCounter}`;
        }
      }

      const incomingCases = extractSuiteTestCases(s);
      const existing = mergedSuitesById.get(suiteKey);

      if (!existing) {
        mergedSuitesById.set(suiteKey, {
          ...s,
          id: suiteKey,
          cases: incomingCases,
          testCases: incomingCases,
        });
        return;
      }

      const existingCases = extractSuiteTestCases(existing);
      const combinedCases = extractSuiteTestCases({
        cases: existingCases,
        testCases: incomingCases,
      });

      const existingPhaseId =
        typeof existing.phaseId === 'string' && existing.phaseId.trim()
          ? existing.phaseId.trim()
          : '';
      const incomingPhaseId =
        typeof s.phaseId === 'string' && s.phaseId.trim()
          ? s.phaseId.trim()
          : '';
      const resolvedPhaseId =
        (existingPhaseId && validPhaseIds.has(existingPhaseId)
          ? existingPhaseId
          : '') ||
        (incomingPhaseId && validPhaseIds.has(incomingPhaseId)
          ? incomingPhaseId
          : '') ||
        existingPhaseId ||
        incomingPhaseId ||
        null;

      const mergedTags = Array.from(
        new Set(
          [
            ...(Array.isArray(existing.tags) ? existing.tags : []),
            ...(Array.isArray(s.tags) ? s.tags : []),
          ]
            .filter((t) => typeof t === 'string' && t.trim())
            .map((t) => t.trim())
        )
      );

      mergedSuitesById.set(suiteKey, {
        ...s,
        ...existing,
        id: suiteKey,
        phaseId: resolvedPhaseId,
        name:
          (typeof existing.name === 'string' && existing.name.trim()) ||
          (typeof s.name === 'string' && s.name.trim()) ||
          '',
        category:
          (typeof existing.category === 'string' && existing.category.trim()) ||
          (typeof s.category === 'string' && s.category.trim()) ||
          'Functional',
        description:
          (typeof existing.description === 'string' &&
            existing.description.trim()) ||
          (typeof s.description === 'string' && s.description.trim()) ||
          '',
        ...(mergedTags.length > 0 ? { tags: mergedTags } : {}),
        cases: combinedCases,
        testCases: combinedCases,
      });
    });

    const seenCaseIds = new Set();

    const sanitizedSuites = Array.from(mergedSuitesById.values()).map(
      (s, sIdx) => {
        const suiteId = s.id;

        const suiteName =
          typeof s.name === 'string' && s.name.trim()
            ? s.name.trim()
            : `Suite ${sIdx + 1}`;

        const rawCases = extractSuiteTestCases(s);

        const cleanCases = rawCases
          .filter((tc) => tc && typeof tc === 'object' && !Array.isArray(tc))
          .map((tc, cIdx) => {
            let caseId = String(
              tc.id || tc.testCaseId || `TC-${101 + casesCount + cIdx}`
            ).trim();
            if (seenCaseIds.has(caseId)) {
              const nextCaseId = `${caseId}_dup_${cIdx + 1}`;
              warnings.push(
                `Duplicate test case ID "${caseId}" in project "${p.name}" was reassigned to "${nextCaseId}".`
              );
              caseId = nextCaseId;
            }
            seenCaseIds.add(caseId);

            return {
              ...tc,
              id: caseId,
              testCaseId: String(tc.testCaseId || caseId),
              suiteId,
              suiteName,
              title:
                typeof tc.title === 'string' && tc.title.trim()
                  ? tc.title.trim()
                  : 'Untitled Test Case',
              description:
                typeof tc.description === 'string' ? tc.description : '',
              preconditions:
                typeof tc.preconditions === 'string'
                  ? tc.preconditions
                  : 'Standard application state.',
              priority: tc.priority || 'P1',
              category: tc.category || tc.testType || 'Functional',
              testType: tc.testType || tc.category || 'Functional',
              steps: Array.isArray(tc.steps) ? tc.steps : [],
              expectedResult:
                typeof tc.expectedResult === 'string'
                  ? tc.expectedResult
                  : 'All test steps pass without error.',
              status: tc.status || 'Not Run',
            };
          });

        casesCount += cleanCases.length;

        const normalizedPhaseId =
          typeof s.phaseId === 'string' ? s.phaseId.trim() : '';
        const linkedPhaseId =
          normalizedPhaseId && validPhaseIds.has(normalizedPhaseId)
            ? normalizedPhaseId
            : null;

        return {
          ...s,
          id: suiteId,
          phaseId: linkedPhaseId,
          name: suiteName,
          category: s.category || 'Functional',
          description: typeof s.description === 'string' ? s.description : '',
          cases: cleanCases,
          testCases: cleanCases,
        };
      }
    );

    suitesCount += sanitizedSuites.length;

    // Sanitize executionRuns
    const rawRuns = Array.isArray(p.executionRuns) ? p.executionRuns : [];
    const seenRunIds = new Set();
    const sanitizedRuns = rawRuns
      .filter((r) => r && typeof r === 'object' && !Array.isArray(r))
      .map((r, rIdx) => {
        let runId = String(r.id || `RUN-${201 + rIdx}`).trim();
        if (seenRunIds.has(runId)) {
          runId = `${runId}_${rIdx + 1}`;
        }
        seenRunIds.add(runId);
        return {
          ...r,
          id: runId,
          name:
            typeof r.name === 'string' && r.name.trim()
              ? r.name.trim()
              : `Test Run ${rIdx + 1}`,
          results: Array.isArray(r.results) ? r.results : [],
        };
      });

    // Sanitize executions
    const rawExecs = Array.isArray(p.executions) ? p.executions : [];
    const seenExecIds = new Set();
    const sanitizedExecs = rawExecs
      .filter((ex) => ex && typeof ex === 'object' && !Array.isArray(ex))
      .map((ex, exIdx) => {
        let execId = String(ex.id || `exec_${Date.now()}_${exIdx}`).trim();
        if (seenExecIds.has(execId)) {
          execId = `${execId}_${exIdx + 1}`;
        }
        seenExecIds.add(execId);
        const refCaseId = String(ex.testCaseId || ex.caseId || '').trim();
        return {
          ...ex,
          id: execId,
          caseId: refCaseId,
          testCaseId: refCaseId,
          status: ex.status || ex.outcome || 'Not Run',
          outcome: ex.outcome || ex.status || 'Not Run',
        };
      });
    executionsCount += sanitizedExecs.length;

    // Sanitize defects, enforce unique IDs, and validate cross-references (`linkedTestCaseId`, `linkedTestRunId`)
    const rawDefects = Array.isArray(p.defects) ? p.defects : [];
    const normalizedUniqueDefects = normalizeDefectsWithUniqueIds(rawDefects, {
      warnings,
    });
    const sanitizedDefects = normalizedUniqueDefects.map((d) => {
      const defectId = String(d.id);
      let linkedCaseId = d.linkedTestCaseId || d.testCaseId || null;
      if (linkedCaseId && !seenCaseIds.has(String(linkedCaseId))) {
        warnings.push(
          `Defect "${defectId}" referenced non-existent test case "${linkedCaseId}"; reference was safely unlinked.`
        );
        linkedCaseId = null;
      }

      let linkedRunId = d.linkedTestRunId || null;
      if (linkedRunId && !seenRunIds.has(String(linkedRunId))) {
        linkedRunId = null;
      }

      return {
        ...d,
        id: defectId,
        defectId: String(d.defectId || defectId),
        title:
          typeof d.title === 'string' && d.title.trim()
            ? d.title.trim()
            : 'Untitled Defect',
        severity: d.severity || 'High',
        priority: d.priority || d.severity || 'High',
        status: d.status || 'Open',
        linkedTestCaseId: linkedCaseId,
        linkedTestRunId: linkedRunId,
        createdAt: d.createdAt || nowIso,
        updatedAt: d.updatedAt || nowIso,
      };
    });
    defectsCount += sanitizedDefects.length;

    // Recompute accurate summary counters for the project
    let projTotalCases = 0;
    let projPassed = 0;
    let projFailed = 0;
    let projBlocked = 0;

    sanitizedSuites.forEach((s) => {
      s.cases.forEach((tc) => {
        projTotalCases += 1;
        const st = String(tc.status || tc.lastStatus || '').toLowerCase();
        if (st === 'passed' || st === 'pass') projPassed += 1;
        else if (st === 'failed' || st === 'fail') projFailed += 1;
        else if (st === 'blocked') projBlocked += 1;
      });
    });

    const projExecuted = projPassed + projFailed + projBlocked;
    const projNotRun = Math.max(0, projTotalCases - projExecuted);
    const projPassRate =
      projExecuted > 0 ? Math.round((projPassed / projExecuted) * 100) : 0;

    let openDefects = 0;
    let inProgressDefects = 0;
    let resolvedDefects = 0;
    let closedDefects = 0;
    let criticalDefects = 0;

    sanitizedDefects.forEach((d) => {
      const st = String(d.status || '').toLowerCase();
      const sev = String(d.severity || '').toLowerCase();
      if (st === 'open' || st === 'reopened') openDefects += 1;
      else if (st === 'in progress' || st === 'ready for retest') {
        inProgressDefects += 1;
      } else if (st === 'resolved') resolvedDefects += 1;
      else if (st === 'closed') closedDefects += 1;
      if (sev === 'critical' && st !== 'closed') criticalDefects += 1;
    });

    const normalizedProj = normalizeProjectRecord({
      ...p,
      id: projectId,
      name: p.name.trim(),
      description: typeof p.description === 'string' ? p.description.trim() : '',
      version:
        typeof p.version === 'string' && p.version.trim()
          ? p.version.trim()
          : '1.0.0',
      type:
        typeof p.type === 'string' && p.type.trim()
          ? p.type.trim()
          : 'Web Application',
      environment:
        typeof p.environment === 'string' && p.environment.trim()
          ? p.environment.trim()
          : 'Staging',
      status:
        p.status === 'Completed' || p.status === 'Archived'
          ? p.status
          : 'Active',
      testPlan: buildDefaultTestPlan({
        ...p,
        id: projectId,
        testPlan: rawPlan,
      }),
      testSuites: sanitizedSuites,
      executionRuns: sanitizedRuns,
      activeRun: p.activeRun || null,
      executions: sanitizedExecs,
      defects: sanitizedDefects,
      testCaseCount: projTotalCases,
      executedTests: projExecuted,
      passedTests: projPassed,
      failedTests: projFailed,
      blockedTests: projBlocked,
      notRunTests: projNotRun,
      passRate: projPassRate,
      totalDefects: sanitizedDefects.length,
      openDefects,
      inProgressDefects,
      resolvedDefects,
      closedDefects,
      criticalDefects,
      createdAt: p.createdAt || nowIso,
      updatedAt: p.updatedAt || nowIso,
    });

    sanitizedProjects.push(normalizedProj);
  }

  const existingIdsSet = new Set(
    (Array.isArray(existingProjects) ? existingProjects : []).map(
      (ep) => ep && (ep.id || ep._id)
    )
  );
  const duplicateProjectIds = sanitizedProjects
    .filter((sp) => existingIdsSet.has(sp.id))
    .map((sp) => sp.id);

  if (duplicateProjectIds.length > 0) {
    warnings.push(
      `${duplicateProjectIds.length} project(s) share an ID with an existing project in your workspace. In Safe Merge mode, they will be imported as new copies with "(Imported)" appended.`
    );
  }

  const checklistValidation = validateAndNormalizeImportedChecklists(
    incomingChecklists,
    warnings
  );
  if (!checklistValidation.ok) {
    return {
      ok: false,
      error: checklistValidation.error,
    };
  }
  const sanitizedChecklists = checklistValidation.checklists;

  const existingChecklistIdsSet = new Set(
    (Array.isArray(existingChecklists) ? existingChecklists : [])
      .filter((ec) => ec && (ec.id || ec._id))
      .map((ec) => String(ec.id || ec._id).trim())
  );
  const duplicateChecklistIds = sanitizedChecklists
    .filter((sc) => existingChecklistIdsSet.has(sc.id))
    .map((sc) => sc.id);

  if (duplicateChecklistIds.length > 0) {
    warnings.push(
      `${duplicateChecklistIds.length} checklist(s) share an ID with an existing checklist in your workspace. In Safe Merge mode, they will be imported as new copies with "(Imported)" appended.`
    );
  }

  return {
    ok: true,
    fileName,
    fileSize,
    formatType,
    backupVersion: raw.backupVersion || SUPPORTED_BACKUP_VERSION,
    schemaVersion: raw.schemaVersion || SUPPORTED_SCHEMA_VERSION,
    exportedAt: raw.exportedAt || null,
    projectsCount: sanitizedProjects.length,
    plansCount,
    suitesCount,
    casesCount,
    executionsCount,
    defectsCount,
    checklistsCount: sanitizedChecklists.length,
    duplicateProjectIds,
    duplicateChecklistIds,
    warnings,
    projects: sanitizedProjects,
    checklists: sanitizedChecklists,
  };
}

/**
 * Validates the file metadata (name/extension, MIME type, and pre-read byte size)
 * of a selected backup file before reading its full content.
 *
 * @param {object} meta
 * @param {string} [meta.fileName]
 * @param {string} [meta.mimeType]
 * @param {number | null} [meta.fileSize]
 */
export function validateBackupFileMetadata({
  fileName = '',
  mimeType = '',
  fileSize = null,
} = {}) {
  const cleanName = String(fileName || '').trim();
  const cleanMime = String(mimeType || '')
    .split(';')[0]
    .trim()
    .toLowerCase();

  if (!cleanName) {
    return {
      ok: false,
      code: 'INVALID_FILE',
      error: 'Selected file has no valid filename. Please choose a .json Qavora backup file.',
    };
  }

  if (!/\.json$/i.test(cleanName)) {
    return {
      ok: false,
      code: 'UNSUPPORTED_FILE_EXTENSION',
      error: `Unsupported file extension in "${cleanName}". Please select a valid .json Qavora backup file.`,
    };
  }

  if (
    cleanMime &&
    !ALLOWED_JSON_MIME_TYPES.has(cleanMime) &&
    !cleanMime.endsWith('+json')
  ) {
    return {
      ok: false,
      code: 'UNSUPPORTED_MIME_TYPE',
      error: `Unsupported file MIME type "${cleanMime}". Please select a valid JSON backup file (.json).`,
    };
  }

  if (typeof fileSize === 'number' && Number.isFinite(fileSize)) {
    if (fileSize <= 0) {
      return {
        ok: false,
        code: 'EMPTY_FILE',
        error: 'The selected backup file is empty (0 bytes).',
      };
    }
    if (fileSize > MAX_IMPORT_SIZE_BYTES) {
      return {
        ok: false,
        code: 'FILE_TOO_LARGE',
        error: 'Import file exceeds the maximum allowed size of 15 MB.',
      };
    }
  }

  return {
    ok: true,
    fileName: cleanName,
    mimeType: cleanMime || 'application/json',
    fileSize:
      typeof fileSize === 'number' && Number.isFinite(fileSize) ? fileSize : null,
  };
}

/**
 * Opens the system document picker (`expo-document-picker`) to select a `.json`
 * backup file, validates extension/MIME/size (enforcing the 15 MB limit before
 * and after reading), reads the complete UTF-8 file contents without silent
 * truncation, and passes the content through `parseAndValidateImportPayload`
 * for the Import Preview & Confirmation workflow.
 *
 * Never automatically imports or mutates workspace data.
 *
 * @param {object} [options]
 * @param {Array<object>} [options.existingProjects=[]]
 */
export async function pickAndValidateBackupFile({
  existingProjects = [],
  existingChecklists = [],
} = {}) {
  const picker = getDocumentPickerAdapter();
  if (!picker || typeof picker.getDocumentAsync !== 'function') {
    return {
      ok: false,
      canceled: false,
      code: 'PICKER_UNAVAILABLE',
      error: 'Document picker is not available in this environment.',
    };
  }

  let pickResult;
  try {
    pickResult = await picker.getDocumentAsync({
      type: ['application/json', 'text/json', '*/*'],
      copyToCacheDirectory: true,
      multiple: false,
      base64: false,
    });
  } catch (pickerErr) {
    return {
      ok: false,
      canceled: false,
      code: 'PICKER_ERROR',
      error:
        (pickerErr && pickerErr.message) ||
        'Failed to open system document picker.',
    };
  }

  if (
    !pickResult ||
    pickResult.canceled === true ||
    !Array.isArray(pickResult.assets) ||
    pickResult.assets.length === 0
  ) {
    return {
      ok: false,
      canceled: true,
      code: 'CANCELED',
      error: null,
    };
  }

  const asset = pickResult.assets[0];
  if (!asset || typeof asset !== 'object') {
    return {
      ok: false,
      canceled: false,
      code: 'INVALID_ASSET',
      error: 'No valid file was returned by the document picker.',
    };
  }

  const fileName = String(asset.name || '').trim();
  const mimeType = String(asset.mimeType || '').trim();
  const uri = typeof asset.uri === 'string' ? asset.uri.trim() : '';
  const reportedSize =
    typeof asset.size === 'number' && Number.isFinite(asset.size)
      ? asset.size
      : asset.file &&
        typeof asset.file.size === 'number' &&
        Number.isFinite(asset.file.size)
      ? asset.file.size
      : null;

  // 1. Validate filename extension (.json), MIME type, and pre-read reported size (15 MB limit)
  const metaCheck = validateBackupFileMetadata({
    fileName,
    mimeType,
    fileSize: reportedSize,
  });

  if (!metaCheck.ok) {
    return {
      ok: false,
      canceled: false,
      code: metaCheck.code,
      fileName: fileName || null,
      fileSize: reportedSize,
      fileUri: uri || null,
      error: metaCheck.error,
    };
  }

  // 2. Read complete UTF-8 file contents (checking native file size before reading where available)
  const platformOS = getEffectivePlatformOS();
  const fsOverride =
    customNativeFileAdapters && customNativeFileAdapters.fileSystem
      ? customNativeFileAdapters.fileSystem
      : null;

  let rawContent = null;
  let detectedSizeBytes = reportedSize;

  try {
    if (fsOverride && typeof fsOverride.readFile === 'function') {
      if (typeof fsOverride.getFileSize === 'function') {
        const preReadBytes = await fsOverride.getFileSize(uri, asset);
        if (typeof preReadBytes === 'number' && Number.isFinite(preReadBytes)) {
          detectedSizeBytes = preReadBytes;
          if (preReadBytes <= 0) {
            return {
              ok: false,
              canceled: false,
              code: 'EMPTY_FILE',
              fileName,
              fileSize: 0,
              fileUri: uri || null,
              error: 'The selected backup file is empty (0 bytes).',
            };
          }
          if (preReadBytes > MAX_IMPORT_SIZE_BYTES) {
            return {
              ok: false,
              canceled: false,
              code: 'FILE_TOO_LARGE',
              fileName,
              fileSize: preReadBytes,
              fileUri: uri || null,
              error: 'Import file exceeds the maximum allowed size of 15 MB.',
            };
          }
        }
      }
      rawContent = await fsOverride.readFile(uri, asset);
    } else if (platformOS === 'web') {
      if (asset.file && typeof asset.file.text === 'function') {
        rawContent = await asset.file.text();
      } else if (uri && typeof fetch === 'function') {
        const res = await fetch(uri);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} while reading selected file.`);
        }
        rawContent = await res.text();
      } else {
        throw new Error('Selected browser file could not be read.');
      }
    } else {
      if (!uri) {
        return {
          ok: false,
          canceled: false,
          code: 'MISSING_URI',
          fileName,
          fileSize: reportedSize,
          fileUri: null,
          error: 'Selected backup file does not provide a readable file URI.',
        };
      }

      const FileCtor =
        fsOverride && fsOverride.File ? fsOverride.File : ExpoFile;
      const nativeFile = new FileCtor(uri);

      if (nativeFile.exists === false) {
        return {
          ok: false,
          canceled: false,
          code: 'FILE_NOT_FOUND',
          fileName,
          fileSize: reportedSize,
          fileUri: uri,
          error: 'Selected backup file could not be found in device storage.',
        };
      }

      const nativeFileSize =
        typeof nativeFile.size === 'number' && Number.isFinite(nativeFile.size) && nativeFile.size >= 0
          ? nativeFile.size
          : typeof nativeFile.info === 'function'
          ? nativeFile.info()?.size
          : null;

      if (typeof nativeFileSize === 'number' && Number.isFinite(nativeFileSize)) {
        detectedSizeBytes = nativeFileSize;
        if (nativeFileSize === 0) {
          return {
            ok: false,
            canceled: false,
            code: 'EMPTY_FILE',
            fileName,
            fileSize: 0,
            fileUri: uri,
            error: 'The selected backup file is empty (0 bytes).',
          };
        }
        if (nativeFileSize > MAX_IMPORT_SIZE_BYTES) {
          return {
            ok: false,
            canceled: false,
            code: 'FILE_TOO_LARGE',
            fileName,
            fileSize: nativeFileSize,
            fileUri: uri,
            error: 'Import file exceeds the maximum allowed size of 15 MB.',
          };
        }
      }

      rawContent = await nativeFile.text();
    }
  } catch {
    // Avoid logging backup contents or sensitive paths; return clean user-facing error
    return {
      ok: false,
      canceled: false,
      code: 'FILE_READ_ERROR',
      fileName,
      fileSize: detectedSizeBytes,
      fileUri: uri || null,
      error:
        'Failed to read the selected backup file. Ensure the file is accessible and not corrupted.',
    };
  }

  if (typeof rawContent !== 'string') {
    return {
      ok: false,
      canceled: false,
      code: 'FILE_READ_ERROR',
      fileName,
      fileSize: detectedSizeBytes,
      fileUri: uri || null,
      error: 'Selected backup file did not return valid UTF-8 text content.',
    };
  }

  const actualByteSize = computeUtf8ByteLength(rawContent);
  const effectiveFileSize =
    actualByteSize > 0 ? actualByteSize : detectedSizeBytes || 0;

  if (effectiveFileSize > MAX_IMPORT_SIZE_BYTES) {
    return {
      ok: false,
      canceled: false,
      code: 'FILE_TOO_LARGE',
      fileName,
      fileSize: effectiveFileSize,
      fileUri: uri || null,
      error: 'Import file exceeds the maximum allowed size of 15 MB.',
    };
  }

  const validation = parseAndValidateImportPayload(rawContent, {
    fileName,
    fileSize: effectiveFileSize,
    existingProjects,
    existingChecklists,
  });

  if (!validation.ok) {
    return {
      ...validation,
      canceled: false,
      code: 'VALIDATION_FAILED',
      fileName,
      fileSize: effectiveFileSize,
      fileUri: uri || null,
    };
  }

  return {
    ...validation,
    canceled: false,
    code: 'VALIDATED',
    fileUri: uri || null,
    mimeType: metaCheck.mimeType,
    rawContent,
  };
}

// ============================================================================
// 3. BACKEND DATA MANAGEMENT, IMPORT, SNAPSHOT, ROLLBACK & RESET APIS
// ============================================================================

/**
 * Fetches MongoDB storage usage metrics via `GET /api/data/storage-usage`
 * and combines them with local AsyncStorage footprint metrics for the user.
 *
 * @param {string} [userId]
 * @param {object} [options]
 */
export async function fetchStorageUsage(userId = null, options = {}) {
  const localStats = await getLocalStorageFootprint(userId);

  try {
    const response = await apiGet('/api/data/storage-usage', options);
    const data = response.data || {};
    return {
      ok: true,
      status: response.status,
      storage: data.storage || null,
      metrics: data.metrics || null,
      metadata: data.metadata || null,
      local: localStats,
      error: null,
    };
  } catch (err) {
    const isApiErr = err instanceof ApiClientError;
    return {
      ok: false,
      status: isApiErr ? err.status : 0,
      storage: null,
      metrics: null,
      metadata: null,
      local: localStats,
      isNetworkError: isApiErr ? err.isNetworkError : false,
      error: (err && err.message) || 'Failed to fetch database storage usage.',
    };
  }
}

/**
 * Computes the local AsyncStorage cache, pending sync queue, and local snapshot
 * footprint for the authenticated user.
 *
 * @param {string} [userId]
 */
export async function getLocalStorageFootprint(userId) {
  const cleanUser = userId ? String(userId).trim() : '';
  if (!cleanUser) {
    return {
      cachedProjectsCount: 0,
      pendingOperationsCount: 0,
      localSnapshotsCount: 0,
      estimatedLocalBytes: 0,
      estimatedLocalKb: 0,
    };
  }

  const cachedProjects = await getCachedProjectsForUser(cleanUser, true);
  const pendingOps = await getPendingProjectOperations(cleanUser);
  const localSnapshots = await getLocalRecoverySnapshots(cleanUser);

  const serializedSize =
    JSON.stringify(cachedProjects).length +
    JSON.stringify(pendingOps).length +
    JSON.stringify(localSnapshots).length;

  return {
    cachedProjectsCount: cachedProjects.length,
    pendingOperationsCount: pendingOps.length,
    localSnapshotsCount: localSnapshots.length,
    estimatedLocalBytes: serializedSize,
    estimatedLocalKb: Number((serializedSize / 1024).toFixed(2)),
  };
}

/**
 * Fetches the latest backend recovery snapshot metadata via
 * `GET /api/data/recovery-snapshot`.
 *
 * @param {object} [options]
 */
export async function fetchRecoverySnapshot(options = {}) {
  try {
    const response = await apiGet('/api/data/recovery-snapshot', options);
    const data = response.data || {};
    return {
      ok: true,
      status: response.status,
      snapshot: data.snapshot || null,
      error: null,
    };
  } catch (err) {
    const isApiErr = err instanceof ApiClientError;
    return {
      ok: false,
      status: isApiErr ? err.status : 0,
      snapshot: null,
      isNetworkError: isApiErr ? err.isNetworkError : false,
      error:
        (err && err.message) || 'Failed to fetch recovery snapshot metadata.',
    };
  }
}

/**
 * Deletes the user's server-side recovery snapshot via
 * `DELETE /api/data/recovery-snapshot`.
 *
 * @param {object} [options]
 */
export async function clearRecoverySnapshot(options = {}) {
  try {
    const response = await apiDelete('/api/data/recovery-snapshot', options);
    const data = response.data || {};
    return {
      ok: true,
      status: response.status,
      deletedCount:
        typeof data.deletedCount === 'number' ? data.deletedCount : 0,
      message: data.message || 'Recovery snapshot cleared.',
      error: null,
    };
  } catch (err) {
    const isApiErr = err instanceof ApiClientError;
    return {
      ok: false,
      status: isApiErr ? err.status : 0,
      deletedCount: 0,
      error: (err && err.message) || 'Failed to clear recovery snapshot.',
    };
  }
}

/**
 * Rolls back the authenticated user's workspace to the latest durable backend
 * recovery snapshot via `POST /api/data/rollback`.
 *
 * @param {object} [options]
 */
export async function executeRollback(options = {}) {
  try {
    const response = await apiPost('/api/data/rollback', {}, options);
    const data = response.data || {};
    return {
      ok: true,
      status: response.status,
      message: data.message || 'Workspace restored from recovery snapshot.',
      restored: data.restored || { projects: 0, checklists: 0 },
      error: null,
    };
  } catch (err) {
    const isApiErr = err instanceof ApiClientError;
    return {
      ok: false,
      status: isApiErr ? err.status : 0,
      restored: null,
      error:
        (err && err.message) ||
        'Failed to roll back workspace from recovery snapshot.',
    };
  }
}

/**
 * Imports validated projects and checklists via `POST /api/data/import`
 * using `'merge'` (Safe Merge) or `'replace'` (Destructive Replace, which
 * automatically creates a durable `recovery_snapshots` point on the server).
 *
 * @param {object} params
 * @param {'merge' | 'replace'} params.mode
 * @param {Array<object>} params.projects
 * @param {Array<object>} [params.checklists=[]]
 * @param {object} [options]
 */
export async function importWorkspaceData(
  { mode = 'merge', projects = [], checklists = [] } = {},
  options = {}
) {
  if (mode !== 'merge' && mode !== 'replace') {
    return {
      ok: false,
      status: 400,
      error: 'Import mode must be either "merge" or "replace".',
    };
  }

  const safeProjects = Array.isArray(projects) ? projects : [];
  const safeChecklists = Array.isArray(checklists) ? checklists : [];

  if (safeProjects.length === 0 && safeChecklists.length === 0) {
    return {
      ok: false,
      status: 400,
      error: 'No valid projects or checklists provided for import.',
    };
  }

  for (let i = 0; i < safeProjects.length; i += 1) {
    const p = safeProjects[i];
    if (!p || typeof p.name !== 'string' || !p.name.trim()) {
      return {
        ok: false,
        status: 400,
        error: `Project at index ${i} is missing a valid name.`,
      };
    }
  }

  try {
    const response = await apiPost(
      '/api/data/import',
      {
        mode,
        projects: safeProjects,
        checklists: safeChecklists,
      },
      options
    );
    const data = response.data || {};
    return {
      ok: true,
      status: response.status,
      mode: data.mode || mode,
      message: data.message || 'Import completed.',
      imported: data.imported || {
        projects: safeProjects.length,
        checklists: safeChecklists.length,
      },
      snapshotCreated: Boolean(data.snapshotCreated),
      snapshotId: data.snapshotId || null,
      error: null,
    };
  } catch (err) {
    const isApiErr = err instanceof ApiClientError;
    return {
      ok: false,
      status: isApiErr ? err.status : 0,
      isNetworkError: isApiErr ? err.isNetworkError : false,
      error: (err && err.message) || 'Failed to import workspace data.',
    };
  }
}

/**
 * Executes a durable offline workspace import (`merge` or `replace`) for both
 * projects and checklists using the existing offline cache and synchronization
 * queue architecture so imported records survive app restarts and server
 * reconnection reconciliation.
 *
 * @param {object} params
 * @param {string} params.userId
 * @param {'merge' | 'replace'} [params.mode='merge']
 * @param {Array<object>} [params.projects=[]]
 * @param {Array<object>} [params.checklists=[]]
 * @param {Array<object> | null} [params.existingProjects=null]
 * @param {Array<object> | null} [params.existingChecklists=null]
 * @returns {Promise<object>}
 */
export async function importWorkspaceOffline({
  userId,
  mode = 'merge',
  projects = [],
  checklists = [],
  existingProjects = null,
  existingChecklists = null,
} = {}) {
  const cleanUser = userId ? String(userId).trim() : '';
  if (!cleanUser) {
    return {
      ok: false,
      error: 'Authenticated userId is required for offline import.',
    };
  }

  if (mode !== 'merge' && mode !== 'replace') {
    return {
      ok: false,
      error: 'Import mode must be either "merge" or "replace".',
    };
  }

  const rawProjects = Array.isArray(projects) ? projects : [];
  const rawChecklists = Array.isArray(checklists) ? checklists : [];

  if (rawProjects.length === 0 && rawChecklists.length === 0) {
    return {
      ok: false,
      error: 'No valid projects or checklists provided for import.',
    };
  }

  if (
    containsProhibitedKeys(rawProjects) ||
    containsProhibitedKeys(rawChecklists)
  ) {
    return {
      ok: false,
      error:
        'Security validation failed: Import payload contains prohibited operator or prototype keys.',
    };
  }

  const warnings = [];
  const validatedProjects = [];
  const seenBatchProjIds = new Set();
  const nowIso = new Date().toISOString();

  for (let i = 0; i < rawProjects.length; i += 1) {
    const rawProj = rawProjects[i];
    if (!rawProj || typeof rawProj !== 'object' || Array.isArray(rawProj)) {
      return {
        ok: false,
        error: `Project at index ${i} is not a valid object.`,
      };
    }
    const rawName =
      typeof rawProj.name === 'string' ? rawProj.name.trim() : '';
    if (!rawName) {
      return {
        ok: false,
        error: `Project at index ${i} is missing a required "name".`,
      };
    }
    let projId = String(
      rawProj.id || rawProj._id || `proj_imp_${Date.now()}_${i + 1}`
    ).trim();
    if (seenBatchProjIds.has(projId)) {
      let suffix = i + 1;
      let nextProjId = `${projId}_dup_${suffix}`;
      while (seenBatchProjIds.has(nextProjId)) {
        suffix += 1;
        nextProjId = `${projId}_dup_${suffix}`;
      }
      warnings.push(
        `Duplicate project ID "${projId}" in import batch was reassigned to "${nextProjId}".`
      );
      projId = nextProjId;
    }
    seenBatchProjIds.add(projId);

    const normalizedProj = normalizeProjectRecord({
      ...rawProj,
      id: projId,
      name: rawName,
      userId: cleanUser,
      createdAt: rawProj.createdAt || nowIso,
      updatedAt: rawProj.updatedAt || nowIso,
    });
    if (!normalizedProj) {
      return {
        ok: false,
        error: `Project "${rawName}" could not be normalized for offline import.`,
      };
    }
    validatedProjects.push(normalizedProj);
  }

  const checklistValidation = validateAndNormalizeImportedChecklists(
    rawChecklists,
    warnings
  );
  if (!checklistValidation.ok) {
    return {
      ok: false,
      error: checklistValidation.error,
    };
  }
  const validatedChecklists = checklistValidation.checklists;

  const storage = getStorage();
  const projectsCacheKey = getOfflineProjectsCacheKey(cleanUser);
  const checklistsCacheKey = getChecklistCacheKey(cleanUser);
  const pendingOpsKey = getPendingProjectOpsKey(cleanUser);

  const snapshotKeys = [projectsCacheKey, checklistsCacheKey, pendingOpsKey].filter(
    Boolean
  );
  const preImportBackup = new Map();
  if (storage && typeof storage.getItem === 'function') {
    for (const k of snapshotKeys) {
      try {
        preImportBackup.set(k, await storage.getItem(k));
      } catch {
        preImportBackup.set(k, null);
      }
    }
  }

  const restorePreImportStorage = async () => {
    if (!storage) return;
    for (const [k, prevVal] of preImportBackup.entries()) {
      try {
        if (prevVal === null || prevVal === undefined) {
          if (typeof storage.removeItem === 'function') {
            await storage.removeItem(k);
          }
        } else if (typeof storage.setItem === 'function') {
          await storage.setItem(k, prevVal);
        }
      } catch {
        // Ignore rollback write errors
      }
    }
  };

  try {
    const cachedProjects = await getCachedProjectsForUser(cleanUser, true);
    const cachedChecklists = await getCachedChecklistsForUser(cleanUser);
    const pendingOps = await getPendingProjectOperations(cleanUser);

    const knownProjectsById = new Map();
    (Array.isArray(existingProjects) ? existingProjects : []).forEach((p) => {
      if (p && (p.id || p._id)) {
        const pid = String(p.id || p._id).trim();
        if (pid) knownProjectsById.set(pid, p);
      }
    });
    cachedProjects.forEach((p) => {
      if (p && p.id) knownProjectsById.set(p.id, p);
    });

    const knownChecklistsById = new Map();
    (Array.isArray(existingChecklists) ? existingChecklists : []).forEach(
      (c) => {
        if (c && (c.id || c._id)) {
          const cid = String(c.id || c._id).trim();
          if (cid) knownChecklistsById.set(cid, c);
        }
      }
    );
    cachedChecklists.forEach((c) => {
      if (c && c.id) knownChecklistsById.set(c.id, c);
    });

    const queuedOperations = [];
    let deletedProjectsCount = 0;
    let deletedChecklistsCount = 0;
    let importedProjectsCount = 0;
    let importedChecklistsCount = 0;

    if (mode === 'merge') {
      const usedProjectIds = new Set(knownProjectsById.keys());
      pendingOps.forEach((op) => {
        if (op && op.entityType !== 'checklist' && op.projectId) {
          usedProjectIds.add(String(op.projectId).trim());
        }
      });

      const projectIdMap = new Map();
      const finalProjectNameById = new Map();
      const importedProjectsToCreate = [];

      for (let i = 0; i < validatedProjects.length; i += 1) {
        const proj = validatedProjects[i];
        const origId = proj.id;
        let finalId = origId;
        let finalName = proj.name;

        if (usedProjectIds.has(finalId)) {
          let attempt = 1;
          const stamp = Date.now().toString(36);
          finalId = `${origId}_imported_${stamp}_${i + 1}`;
          while (usedProjectIds.has(finalId)) {
            attempt += 1;
            finalId = `${origId}_imported_${stamp}_${i + 1}_${attempt}`;
          }
          finalName = proj.name.endsWith(' (Imported)')
            ? proj.name
            : `${proj.name} (Imported)`;
          warnings.push(
            `Project "${proj.name}" shared ID "${origId}" and was merged as new copy "${finalName}" (${finalId}).`
          );
        }

        usedProjectIds.add(finalId);
        projectIdMap.set(origId, finalId);
        finalProjectNameById.set(finalId, finalName);

        const nextTestPlan =
          proj.testPlan && typeof proj.testPlan === 'object'
            ? {
                ...proj.testPlan,
                id:
                  finalId !== origId &&
                  (!proj.testPlan.id || proj.testPlan.id === `plan_${origId}`)
                    ? `plan_${finalId}`
                    : proj.testPlan.id,
                name:
                  finalName !== proj.name &&
                  proj.testPlan.name === `${proj.name} Master Test Plan`
                    ? `${finalName} Master Test Plan`
                    : proj.testPlan.name,
              }
            : proj.testPlan;

        const preparedProj = normalizeProjectRecord({
          ...proj,
          id: finalId,
          _id: finalId,
          name: finalName,
          userId: cleanUser,
          testPlan: nextTestPlan,
          createdAt: nowIso,
          updatedAt: nowIso,
          _serverUpdatedAt: null,
          _pendingSync: true,
          _pendingCreation: true,
        });
        importedProjectsToCreate.push(preparedProj);
      }

      for (let i = 0; i < importedProjectsToCreate.length; i += 1) {
        const proj = importedProjectsToCreate[i];
        await cacheProjectOffline(
          { ...proj, _serverUpdatedAt: null },
          cleanUser,
          { pendingSync: true, pendingCreation: true }
        );

        const createPayload = pickWhitelistedFields(
          proj,
          ALLOWED_PROJECT_CREATE_FIELDS
        );
        const createOp = await queueProjectMutation({
          userId: cleanUser,
          projectId: proj.id,
          entityType: 'project',
          operationType: 'CREATE',
          payload: createPayload,
          expectedUpdatedAt: null,
          description: `Import project "${proj.name}" offline (merge)`,
        });
        queuedOperations.push(createOp);

        const dataPayload = pickWhitelistedFields(
          proj,
          ALLOWED_PROJECT_DATA_PATCH_FIELDS,
          ['expectedUpdatedAt']
        );
        if (Object.keys(dataPayload).length > 0) {
          const dataOp = await queueProjectMutation({
            userId: cleanUser,
            projectId: proj.id,
            entityType: 'data',
            operationType: 'UPDATE',
            payload: dataPayload,
            expectedUpdatedAt: null,
            description: `Import QA workspace data for "${proj.name}" offline (merge)`,
          });
          queuedOperations.push(dataOp);
        }
        importedProjectsCount += 1;
      }

      const usedChecklistIds = new Set(knownChecklistsById.keys());
      pendingOps.forEach((op) => {
        if (op && op.entityType === 'checklist') {
          const cid = String(op.checklistId || op.entityId || '').trim();
          if (cid) usedChecklistIds.add(cid);
        }
      });

      for (let i = 0; i < validatedChecklists.length; i += 1) {
        const chk = validatedChecklists[i];
        const origChkId = chk.id;
        let finalChkId = origChkId;
        let finalTitle = chk.title;

        if (usedChecklistIds.has(finalChkId)) {
          let attempt = 1;
          const stamp = Date.now().toString(36);
          finalChkId = `${origChkId}_imported_${stamp}_${i + 1}`;
          while (usedChecklistIds.has(finalChkId)) {
            attempt += 1;
            finalChkId = `${origChkId}_imported_${stamp}_${i + 1}_${attempt}`;
          }
          finalTitle = chk.title.endsWith(' (Imported)')
            ? chk.title
            : `${chk.title} (Imported)`;
          warnings.push(
            `Checklist "${chk.title}" shared ID "${origChkId}" and was merged as new copy "${finalTitle}" (${finalChkId}).`
          );
        }
        usedChecklistIds.add(finalChkId);

        const rawLinkedProjectId = chk.projectId || chk.promotedProjectId || null;
        const resolvedLinkedProjectId =
          rawLinkedProjectId && projectIdMap.has(rawLinkedProjectId)
            ? projectIdMap.get(rawLinkedProjectId)
            : rawLinkedProjectId;
        const resolvedLinkedProjectName =
          resolvedLinkedProjectId &&
          finalProjectNameById.has(resolvedLinkedProjectId)
            ? finalProjectNameById.get(resolvedLinkedProjectId)
            : chk.projectName || '';

        const preparedChk = normalizeChecklistRecord({
          ...chk,
          id: finalChkId,
          title: finalTitle,
          userId: cleanUser,
          projectId: resolvedLinkedProjectId,
          promotedProjectId: resolvedLinkedProjectId,
          projectName: resolvedLinkedProjectName,
          createdAt: nowIso,
          updatedAt: nowIso,
          _serverUpdatedAt: null,
          _pendingSync: true,
          _pendingCreation: true,
          _syncStatus: 'pending',
        });

        const chkOp = await queueChecklistMutation({
          userId: cleanUser,
          checklistId: preparedChk.id,
          projectId: preparedChk.projectId || null,
          operationType: 'CREATE',
          mutationSubType: 'offline_import',
          payload: buildChecklistQueuePayload(preparedChk, true),
          expectedUpdatedAt: null,
          description: `Import checklist "${preparedChk.title}" offline (merge)`,
        });
        queuedOperations.push(chkOp);
        importedChecklistsCount += 1;
      }
    } else {
      // REPLACE mode
      const incomingProjectIds = new Set(validatedProjects.map((p) => p.id));
      const incomingChecklistIds = new Set(validatedChecklists.map((c) => c.id));

      // Clear stale per-project workspace snapshots for all known or incoming projects
      const allProjectIdsToClean = new Set([
        ...knownProjectsById.keys(),
        ...incomingProjectIds,
      ]);
      if (storage && typeof storage.removeItem === 'function') {
        for (const pid of allProjectIdsToClean) {
          const wsKey = getProjectWorkspaceStorageKey(pid, cleanUser);
          if (wsKey) {
            await storage.removeItem(wsKey).catch(() => {});
          }
        }
      }

      // 1. Delete existing projects NOT present in imported set
      for (const oldProj of knownProjectsById.values()) {
        if (!oldProj || !oldProj.id || incomingProjectIds.has(oldProj.id)) {
          continue;
        }
        const hasPendingCreate = pendingOps.some(
          (op) =>
            op.entityType === 'project' &&
            op.operationType === 'CREATE' &&
            op.projectId === oldProj.id &&
            (op.status === 'pending' || op.status === 'failed')
        );
        const isOfflineOnlyWithoutCreate =
          Boolean(oldProj._pendingCreation) && !hasPendingCreate;

        if (isOfflineOnlyWithoutCreate) {
          await removeCachedProjectOffline(oldProj.id, cleanUser);
        } else {
          const delOp = await queueProjectMutation({
            userId: cleanUser,
            projectId: oldProj.id,
            entityType: 'project',
            operationType: 'DELETE',
            payload: {},
            description: `Delete replaced project "${oldProj.name || oldProj.id}" offline (replace)`,
          });
          queuedOperations.push(delOp);
        }
        deletedProjectsCount += 1;
      }

      // 2. Delete existing checklists NOT present in imported set
      for (const oldChk of knownChecklistsById.values()) {
        if (!oldChk || !oldChk.id || incomingChecklistIds.has(oldChk.id)) {
          continue;
        }
        const hasPendingCreate = pendingOps.some(
          (op) =>
            op.entityType === 'checklist' &&
            op.operationType === 'CREATE' &&
            (op.checklistId === oldChk.id || op.entityId === oldChk.id) &&
            (op.status === 'pending' || op.status === 'failed')
        );
        const isOfflineOnlyWithoutCreate =
          Boolean(oldChk._pendingCreation) && !hasPendingCreate;

        if (isOfflineOnlyWithoutCreate) {
          await removeCachedChecklistOffline(oldChk.id, cleanUser);
        } else {
          const delOp = await queueChecklistMutation({
            userId: cleanUser,
            checklistId: oldChk.id,
            projectId: oldChk.projectId || null,
            operationType: 'DELETE',
            mutationSubType: 'offline_import_replace',
            payload: {},
            description: `Delete replaced checklist "${oldChk.title || oldChk.id}" offline (replace)`,
          });
          queuedOperations.push(delOp);
        }
        deletedChecklistsCount += 1;
      }

      // 3. Upsert imported projects (CREATE new / UPDATE existing server-backed)
      for (let i = 0; i < validatedProjects.length; i += 1) {
        const proj = validatedProjects[i];
        const existingProj = knownProjectsById.get(proj.id) || null;
        const hasPendingCreate = pendingOps.some(
          (op) =>
            op.entityType === 'project' &&
            op.operationType === 'CREATE' &&
            op.projectId === proj.id &&
            (op.status === 'pending' || op.status === 'failed')
        );
        const hadPendingDelete = pendingOps.some(
          (op) =>
            op.entityType === 'project' &&
            op.operationType === 'DELETE' &&
            op.projectId === proj.id &&
            op.status !== 'syncing'
        );

        const isServerBackedExisting = Boolean(
          (existingProj &&
            !existingProj._pendingCreation &&
            !hasPendingCreate) ||
            (!existingProj && hadPendingDelete)
        );
        const shouldCreate = !isServerBackedExisting;

        if (shouldCreate) {
          const preparedProj = normalizeProjectRecord({
            ...proj,
            userId: cleanUser,
            updatedAt: nowIso,
            _serverUpdatedAt: null,
            _pendingSync: true,
            _pendingCreation: true,
          });
          await cacheProjectOffline(
            { ...preparedProj, _serverUpdatedAt: null },
            cleanUser,
            { pendingSync: true, pendingCreation: true }
          );
          const createPayload = pickWhitelistedFields(
            preparedProj,
            ALLOWED_PROJECT_CREATE_FIELDS
          );
          const createOp = await queueProjectMutation({
            userId: cleanUser,
            projectId: preparedProj.id,
            entityType: 'project',
            operationType: 'CREATE',
            payload: createPayload,
            expectedUpdatedAt: null,
            description: `Import project "${preparedProj.name}" offline (replace)`,
          });
          queuedOperations.push(createOp);

          const dataPayload = pickWhitelistedFields(
            preparedProj,
            ALLOWED_PROJECT_DATA_PATCH_FIELDS,
            ['expectedUpdatedAt']
          );
          if (Object.keys(dataPayload).length > 0) {
            const dataOp = await queueProjectMutation({
              userId: cleanUser,
              projectId: preparedProj.id,
              entityType: 'data',
              operationType: 'UPDATE',
              payload: dataPayload,
              expectedUpdatedAt: null,
              description: `Import QA workspace data for "${preparedProj.name}" offline (replace)`,
            });
            queuedOperations.push(dataOp);
          }
        } else {
          const baselineUpdatedAt =
            (existingProj &&
              (existingProj._serverUpdatedAt || existingProj.updatedAt)) ||
            null;
          const prevActive = extractActiveIdsFromProjectDataPayload(
            existingProj || {}
          );
          const nextActive = extractActiveIdsFromProjectDataPayload(proj);
          const replaceTombstones = subtractDeletionTombstones(
            prevActive,
            nextActive
          );

          const preparedProj = normalizeProjectRecord({
            ...proj,
            userId: cleanUser,
            updatedAt: baselineUpdatedAt || nowIso,
            _serverUpdatedAt: baselineUpdatedAt,
            _pendingSync: true,
            _pendingCreation: false,
          });
          await cacheProjectOffline(
            { ...preparedProj, _serverUpdatedAt: baselineUpdatedAt },
            cleanUser,
            { pendingSync: true, pendingCreation: false }
          );

          const metaPayload = pickWhitelistedFields(
            preparedProj,
            ALLOWED_PROJECT_PATCH_FIELDS,
            ['expectedUpdatedAt']
          );
          if (Object.keys(metaPayload).length > 0) {
            const metaOp = await queueProjectMutation({
              userId: cleanUser,
              projectId: preparedProj.id,
              entityType: 'project',
              operationType: 'UPDATE',
              payload: metaPayload,
              expectedUpdatedAt: baselineUpdatedAt,
              description: `Replace project "${preparedProj.name}" metadata offline`,
            });
            queuedOperations.push(metaOp);
          }

          const dataPayload = pickWhitelistedFields(
            preparedProj,
            ALLOWED_PROJECT_DATA_PATCH_FIELDS,
            ['expectedUpdatedAt']
          );
          if (Object.keys(dataPayload).length > 0) {
            const dataOp = await queueProjectMutation({
              userId: cleanUser,
              projectId: preparedProj.id,
              entityType: 'data',
              operationType: 'UPDATE',
              payload: dataPayload,
              expectedUpdatedAt: baselineUpdatedAt,
              deletionTombstones: hasAnyDeletionTombstones(replaceTombstones)
                ? replaceTombstones
                : null,
              description: `Replace QA workspace data for "${preparedProj.name}" offline`,
            });
            queuedOperations.push(dataOp);
          }
        }
        importedProjectsCount += 1;
      }

      // 4. Upsert imported checklists (CREATE new / UPDATE existing server-backed)
      for (let i = 0; i < validatedChecklists.length; i += 1) {
        const chk = validatedChecklists[i];
        const existingChk = knownChecklistsById.get(chk.id) || null;
        const hasPendingCreate = pendingOps.some(
          (op) =>
            op.entityType === 'checklist' &&
            op.operationType === 'CREATE' &&
            (op.checklistId === chk.id || op.entityId === chk.id) &&
            (op.status === 'pending' || op.status === 'failed')
        );
        const hadPendingDelete = pendingOps.some(
          (op) =>
            op.entityType === 'checklist' &&
            op.operationType === 'DELETE' &&
            (op.checklistId === chk.id || op.entityId === chk.id) &&
            op.status !== 'syncing'
        );

        const isServerBackedExisting = Boolean(
          (existingChk &&
            !existingChk._pendingCreation &&
            !hasPendingCreate) ||
            (!existingChk && hadPendingDelete)
        );
        const shouldCreate = !isServerBackedExisting;

        const baselineUpdatedAt = shouldCreate
          ? null
          : (existingChk &&
              !existingChk._pendingCreation &&
              (existingChk._serverUpdatedAt || existingChk.updatedAt)) ||
            null;

        const incomingItemIds = new Set(
          (Array.isArray(chk.items) ? chk.items : []).map((it) => it && it.id)
        );
        const deletedItemIds =
          !shouldCreate && existingChk && Array.isArray(existingChk.items)
            ? existingChk.items
                .filter((it) => it && it.id && !incomingItemIds.has(it.id))
                .map((it) => it.id)
            : [];

        const preparedChk = normalizeChecklistRecord({
          ...chk,
          userId: cleanUser,
          updatedAt: shouldCreate ? nowIso : baselineUpdatedAt || nowIso,
          _serverUpdatedAt: baselineUpdatedAt,
          _pendingSync: true,
          _pendingCreation: shouldCreate,
          _syncStatus: 'pending',
        });

        await cacheChecklistOffline(preparedChk, cleanUser, {
          pendingSync: true,
          pendingCreation: shouldCreate,
          syncStatus: 'pending',
          serverUpdatedAt: baselineUpdatedAt,
          syncError: null,
          conflictDetails: null,
        });

        const chkPayload = buildChecklistQueuePayload(
          preparedChk,
          shouldCreate
        );
        if (!shouldCreate && deletedItemIds.length > 0) {
          chkPayload.deletedItemIds = deletedItemIds;
        }

        const chkOp = await queueChecklistMutation({
          userId: cleanUser,
          checklistId: preparedChk.id,
          projectId: preparedChk.projectId || null,
          operationType: shouldCreate ? 'CREATE' : 'UPDATE',
          mutationSubType: 'offline_import_replace',
          payload: chkPayload,
          expectedUpdatedAt: baselineUpdatedAt,
          description: `${
            shouldCreate ? 'Import' : 'Replace'
          } checklist "${preparedChk.title}" offline`,
        });
        queuedOperations.push(chkOp);
        importedChecklistsCount += 1;
      }
    }

    const finalProjects = await getCachedProjectsForUser(cleanUser, true);
    const finalChecklists = await getCachedChecklistsForUser(cleanUser);

    for (let i = 0; i < finalProjects.length; i += 1) {
      const fp = finalProjects[i];
      if (!fp || !fp.id) continue;
      await recordObservedDefectSequence(fp.id, cleanUser, {
        defects: fp.defects,
        testRuns: fp.executionRuns,
        executions: fp.executions,
      });
    }

    notifySyncListeners({
      type: 'offline_import_completed',
      mode,
      userId: cleanUser,
      importedProjectsCount,
      importedChecklistsCount,
      deletedProjectsCount,
      deletedChecklistsCount,
    });

    return {
      ok: true,
      source: 'offline_cache',
      mode,
      projects: finalProjects,
      checklists: finalChecklists,
      importedProjectsCount,
      importedChecklistsCount,
      deletedProjectsCount,
      deletedChecklistsCount,
      queuedOperationsCount: queuedOperations.length,
      queuedOperations,
      warnings,
      message: `Imported ${importedProjectsCount} project(s) and ${importedChecklistsCount} checklist(s) into offline workspace (${mode.toUpperCase()}). Pending sync queued for reconnection.`,
    };
  } catch (err) {
    await restorePreImportStorage();
    return {
      ok: false,
      error:
        (err && err.message) ||
        'Failed to persist offline workspace import safely. Previous workspace data was restored.',
    };
  }
}

/**
 * Resets all user-owned projects, artifacts, and checklists on the backend
 * via `POST /api/data/reset`.
 *
 * @param {object} [options]
 */
export async function resetWorkspaceData(options = {}) {
  try {
    const response = await apiPost('/api/data/reset', {}, options);
    const data = response.data || {};
    return {
      ok: true,
      status: response.status,
      message:
        data.message || 'All workspace test data has been reset.',
      deleted: data.deleted || { projects: 0, artifacts: 0, checklists: 0 },
      error: null,
    };
  } catch (err) {
    const isApiErr = err instanceof ApiClientError;
    return {
      ok: false,
      status: isApiErr ? err.status : 0,
      error: (err && err.message) || 'Failed to reset workspace data.',
    };
  }
}

// ============================================================================
// 4. LOCAL POINT-IN-TIME RECOVERY SNAPSHOTS (PER-USER ASYNCSTORAGE)
// ============================================================================

function pickWhitelistedFields(source, allowedSet, excludedKeys = []) {
  const result = {};
  if (!source || typeof source !== 'object') {
    return result;
  }
  const excluded = new Set(excludedKeys);
  Object.keys(source).forEach((key) => {
    if (allowedSet.has(key) && !excluded.has(key) && source[key] !== undefined) {
      result[key] = source[key];
    }
  });
  return result;
}

function sanitizeSnapshotProject(rawProject, cleanUser) {
  if (!rawProject || typeof rawProject !== 'object') {
    return null;
  }
  const normalized = normalizeProjectRecord({
    ...rawProject,
    userId: cleanUser,
  });
  if (!normalized) {
    return null;
  }
  const serverUpdatedAt = rawProject._pendingCreation
    ? null
    : rawProject._serverUpdatedAt || rawProject.updatedAt || null;

  return {
    ...normalized,
    userId: cleanUser,
    _serverUpdatedAt: serverUpdatedAt,
    _pendingSync: false,
    _pendingCreation: false,
  };
}

function sanitizeSnapshotChecklist(rawChecklist, cleanUser) {
  if (!rawChecklist || typeof rawChecklist !== 'object') {
    return null;
  }
  const normalized = normalizeChecklistRecord({
    ...rawChecklist,
    userId: cleanUser,
  });
  if (!normalized) {
    return null;
  }
  const serverUpdatedAt = rawChecklist._pendingCreation
    ? null
    : rawChecklist._serverUpdatedAt || rawChecklist.updatedAt || null;

  return {
    ...normalized,
    userId: cleanUser,
    _serverUpdatedAt: serverUpdatedAt,
    _pendingSync: false,
    _pendingCreation: false,
    _syncStatus: 'synced',
    _syncOpId: null,
    _syncError: null,
    _conflictDetails: null,
  };
}

function buildChecklistQueuePayload(checklist, includeId = false) {
  const payload = {
    title: checklist.title,
    description: checklist.description || '',
    category: checklist.category || 'General QA',
    priority: checklist.priority || 'Medium',
    status: checklist.status || 'Not Started',
    projectId: checklist.projectId || null,
    projectName: checklist.projectName || '',
    environment: checklist.environment || 'Staging',
    targetRelease: checklist.targetRelease || '',
    tags: Array.isArray(checklist.tags) ? checklist.tags : [],
    items: Array.isArray(checklist.items) ? checklist.items : [],
    phases: Array.isArray(checklist.phases) ? checklist.phases : [],
    documentNotes: Array.isArray(checklist.documentNotes)
      ? checklist.documentNotes
      : [],
    promotedProjectId:
      checklist.promotedProjectId || checklist.projectId || null,
    promotedAt: checklist.promotedAt || null,
    completedAt: checklist.completedAt || null,
    completedBy: checklist.completedBy || null,
    originalPrompt: checklist.originalPrompt || '',
    schemaVersion: checklist.schemaVersion || 1,
  };
  if (includeId && checklist.id) {
    payload.id = checklist.id;
  }
  return payload;
}

/**
 * Retrieves all local point-in-time recovery snapshots belonging to `userId`.
 *
 * @param {string} userId
 * @returns {Promise<Array<object>>}
 */
export async function getLocalRecoverySnapshots(userId) {
  const cleanUser = userId ? String(userId).trim() : '';
  if (!cleanUser) return [];

  const key = getLocalSnapshotsStorageKey(cleanUser);
  if (!key) return [];

  try {
    const storage = getStorage();
    if (!storage || typeof storage.getItem !== 'function') return [];
    const raw = await storage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((s) => s && typeof s === 'object' && String(s.userId) === cleanUser)
      .sort((a, b) =>
        String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
      );
  } catch {
    return [];
  }
}

/**
 * Creates a durable local point-in-time recovery snapshot for `userId` in
 * AsyncStorage (`@qavora_local_recovery_snapshots_v1:<userId>`), capturing
 * the full supported workspace dataset (projects, plans, phases, suites,
 * test cases, test runs, executions, defects, and checklists).
 *
 * @param {object} params
 * @param {string} params.userId
 * @param {Array<object>} [params.projects=[]]
 * @param {Array<object>} [params.checklists]
 * @param {string} [params.label='Manual Recovery Snapshot']
 * @param {string} [params.reason='manual']
 */
export async function createLocalRecoverySnapshot({
  userId,
  projects = [],
  checklists = undefined,
  label = 'Manual Recovery Snapshot',
  reason = 'manual',
} = {}) {
  const cleanUser = userId ? String(userId).trim() : '';
  if (!cleanUser) {
    return {
      ok: false,
      error: 'Authenticated userId is required to create a recovery snapshot.',
    };
  }

  const scopedProjects = (Array.isArray(projects) ? projects : [])
    .filter(
      (p) =>
        p &&
        typeof p === 'object' &&
        (!p.userId || String(p.userId).trim() === cleanUser)
    )
    .map((p) => sanitizeSnapshotProject(p, cleanUser))
    .filter(Boolean);

  const sourceChecklists = Array.isArray(checklists)
    ? checklists
    : await getCachedChecklistsForUser(cleanUser);

  const scopedChecklists = filterChecklistsForUser(
    sourceChecklists
      .map((c) => sanitizeSnapshotChecklist(c, cleanUser))
      .filter(Boolean),
    cleanUser
  );

  const backupPayload = createFullBackupPayload(scopedProjects, scopedChecklists);
  const standardizedProjects = backupPayload.projects.map((stdProj, idx) => ({
    ...stdProj,
    userId: cleanUser,
    _serverUpdatedAt:
      (scopedProjects[idx] && scopedProjects[idx]._serverUpdatedAt) || null,
    _pendingSync: false,
    _pendingCreation: false,
  }));

  const nowIso = new Date().toISOString();
  const snapshotRecord = {
    snapshotId: `lsnap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    userId: cleanUser,
    backupVersion: backupPayload.backupVersion,
    schemaVersion: backupPayload.schemaVersion,
    label: String(label || 'Recovery Snapshot').trim(),
    reason: String(reason || 'manual'),
    createdAt: nowIso,
    timestamp: nowIso,
    projectsCount: standardizedProjects.length,
    checklistsCount: backupPayload.checklists.length,
    metadata: backupPayload.metadata,
    projects: standardizedProjects,
    checklists: backupPayload.checklists,
  };

  const existing = await getLocalRecoverySnapshots(cleanUser);
  const nextList = [snapshotRecord, ...existing].slice(
    0,
    MAX_LOCAL_SNAPSHOTS_PER_USER
  );

  const key = getLocalSnapshotsStorageKey(cleanUser);
  try {
    const storage = getStorage();
    if (storage && typeof storage.setItem === 'function') {
      await storage.setItem(key, JSON.stringify(nextList));
    }
  } catch {
    return {
      ok: false,
      error: 'Failed to persist local recovery snapshot to device storage.',
    };
  }

  return {
    ok: true,
    snapshot: snapshotRecord,
  };
}

/**
 * Restores a local recovery snapshot by `snapshotId` for `userId`.
 * Preserves full backward compatibility with older snapshots lacking `checklists`
 * fields, persists restored projects and checklists into local caches without
 * accidentally deleting existing checklists, and queues idempotent offline sync
 * operations for backend persistence when offline or when network fallback occurs.
 *
 * @param {string} snapshotId
 * @param {string} userId
 * @param {object} [options]
 * @param {'replace' | 'merge'} [options.mode='replace']
 */
export async function restoreLocalRecoverySnapshot(
  snapshotId,
  userId,
  options = {}
) {
  const cleanUser = userId ? String(userId).trim() : '';
  const cleanSnapId = snapshotId ? String(snapshotId).trim() : '';
  if (!cleanUser || !cleanSnapId) {
    return {
      ok: false,
      error: 'Snapshot ID and user ID are required.',
    };
  }

  const snapshots = await getLocalRecoverySnapshots(cleanUser);
  const target = snapshots.find((s) => s.snapshotId === cleanSnapId);
  if (!target) {
    return {
      ok: false,
      error: 'Recovery snapshot not found for this user.',
    };
  }

  const mode = options.mode === 'merge' ? 'merge' : 'replace';
  const rawProjects = Array.isArray(target.projects) ? target.projects : [];
  const snapshotProjects = rawProjects
    .map((p) => {
      if (!p || typeof p !== 'object') return null;
      const norm = normalizeProjectRecord({ ...p, userId: cleanUser });
      if (!norm) return null;
      const normalizedDefects = normalizeDefectsWithUniqueIds(
        Array.isArray(p.defects) ? p.defects : norm.defects
      );
      return {
        ...p,
        ...norm,
        defects: normalizedDefects,
        userId: cleanUser,
        _serverUpdatedAt:
          p._serverUpdatedAt ||
          (!p._pendingCreation && p.updatedAt ? p.updatedAt : null),
      };
    })
    .filter(Boolean);

  const hasChecklistsField = Array.isArray(target.checklists);
  const rawChecklists = hasChecklistsField ? target.checklists : [];
  const snapshotChecklists = filterChecklistsForUser(
    rawChecklists
      .map((c) => {
        if (!c || typeof c !== 'object') return null;
        const norm = normalizeChecklistRecord({ ...c, userId: cleanUser });
        if (!norm) return null;
        const rawHadServerTimestamp = Boolean(
          c._serverUpdatedAt || (!c._pendingCreation && c.updatedAt)
        );
        return {
          ...norm,
          userId: cleanUser,
          _serverUpdatedAt: rawHadServerTimestamp
            ? c._serverUpdatedAt || c.updatedAt || null
            : null,
        };
      })
      .filter(Boolean),
    cleanUser
  );

  const existingCachedProjects = await getCachedProjectsForUser(cleanUser, true);
  const existingCachedChecklists = await getCachedChecklistsForUser(cleanUser);
  const existingPendingOps = await getPendingProjectOperations(cleanUser);

  const persistRestoredChecklistsLocally = async (
    pendingSyncFlag,
    pendingCreationById = new Map()
  ) => {
    if (snapshotChecklists.length === 0) {
      return existingCachedChecklists;
    }

    const restoredById = new Map();
    snapshotChecklists.forEach((chk) => {
      const isPendingCreate = Boolean(pendingCreationById.get(chk.id));
      restoredById.set(chk.id, {
        ...chk,
        userId: cleanUser,
        _pendingSync: pendingSyncFlag,
        _pendingCreation: isPendingCreate,
        _syncStatus: pendingSyncFlag ? 'pending' : 'synced',
        _syncError: null,
        _conflictDetails: null,
      });
    });

    // Never accidentally delete existing checklists not present in the snapshot
    const preservedExisting = existingCachedChecklists.filter(
      (chk) => chk && chk.id && !restoredById.has(chk.id)
    );
    const mergedChecklists = [...restoredById.values(), ...preservedExisting];
    await cacheChecklistsForUser(mergedChecklists, cleanUser, {
      preservePending: pendingSyncFlag,
    });
    return mergedChecklists;
  };

  const mergeOrReplaceLocalProjects = async () => {
    for (let i = 0; i < snapshotProjects.length; i += 1) {
      const sp = snapshotProjects[i];
      if (!sp || !sp.id) continue;
      await recordObservedDefectSequence(sp.id, cleanUser, {
        defects: sp.defects,
        testRuns: sp.executionRuns,
        executions: sp.executions,
      });
    }
    if (mode === 'merge') {
      const snapshotProjectIds = new Set(snapshotProjects.map((p) => p.id));
      const preservedProjects = existingCachedProjects.filter(
        (p) => p && p.id && !snapshotProjectIds.has(p.id)
      );
      return cacheProjectsListOffline(
        [...snapshotProjects, ...preservedProjects],
        cleanUser
      );
    }
    return cacheProjectsListOffline(snapshotProjects, cleanUser);
  };

  const shouldTryOnline = !options.offlineOnly && !isClientOffline();

  // Attempt backend import if online and not explicitly offline-only
  if (shouldTryOnline) {
    // If replacing workspace from an older snapshot that did not track checklists,
    // pass existing cached checklists (when known) so backend replace does not wipe them.
    const importChecklists = hasChecklistsField
      ? snapshotChecklists
      : mode === 'replace' && existingCachedChecklists.length > 0
      ? existingCachedChecklists
      : [];

    const apiRes = await importWorkspaceData(
      {
        mode,
        projects: snapshotProjects,
        checklists: importChecklists,
      },
      options.apiOptions || {}
    );

    if (apiRes.ok) {
      await mergeOrReplaceLocalProjects();
      await persistRestoredChecklistsLocally(false);
      return {
        ok: true,
        source: 'backend',
        mode,
        snapshot: target,
        restoredProjects: snapshotProjects,
        restoredChecklists: snapshotChecklists,
        apiResult: apiRes,
      };
    }

    if (!apiRes.isNetworkError && apiRes.status !== 0) {
      return apiRes;
    }
  }

  // Offline / fallback restoration: persist locally AND queue idempotent sync operations
  await mergeOrReplaceLocalProjects();

  const queuedOperations = [];

  for (let i = 0; i < snapshotProjects.length; i += 1) {
    const proj = snapshotProjects[i];
    const existingProj = existingCachedProjects.find((p) => p.id === proj.id);
    const hasPendingCreate = existingPendingOps.some(
      (op) =>
        op.entityType === 'project' &&
        op.operationType === 'CREATE' &&
        op.projectId === proj.id &&
        (op.status === 'pending' || op.status === 'failed')
    );

    const shouldCreate =
      hasPendingCreate ||
      (existingProj ? Boolean(existingProj._pendingCreation) : !proj._serverUpdatedAt);

    if (shouldCreate) {
      const createPayload = pickWhitelistedFields(
        proj,
        ALLOWED_PROJECT_CREATE_FIELDS
      );
      const createOp = await queueProjectMutation({
        userId: cleanUser,
        projectId: proj.id,
        entityType: 'project',
        operationType: 'CREATE',
        payload: createPayload,
        expectedUpdatedAt: null,
        description: `Restore project "${proj.name}" from snapshot "${target.label}"`,
      });
      queuedOperations.push(createOp);

      const dataPayload = pickWhitelistedFields(
        proj,
        ALLOWED_PROJECT_DATA_PATCH_FIELDS,
        ['expectedUpdatedAt']
      );
      if (Object.keys(dataPayload).length > 0) {
        const dataOp = await queueProjectMutation({
          userId: cleanUser,
          projectId: proj.id,
          entityType: 'data',
          operationType: 'UPDATE',
          payload: dataPayload,
          expectedUpdatedAt: null,
          description: `Restore QA workspace data for "${proj.name}" from snapshot`,
        });
        queuedOperations.push(dataOp);
      }
    } else {
      const baselineUpdatedAt =
        (existingProj &&
          (existingProj._serverUpdatedAt || existingProj.updatedAt)) ||
        proj._serverUpdatedAt ||
        proj.updatedAt ||
        null;

      const metaPayload = pickWhitelistedFields(
        proj,
        ALLOWED_PROJECT_PATCH_FIELDS,
        ['expectedUpdatedAt']
      );
      if (Object.keys(metaPayload).length > 0) {
        const metaOp = await queueProjectMutation({
          userId: cleanUser,
          projectId: proj.id,
          entityType: 'project',
          operationType: 'UPDATE',
          payload: metaPayload,
          expectedUpdatedAt: baselineUpdatedAt,
          description: `Restore project "${proj.name}" metadata from snapshot "${target.label}"`,
        });
        queuedOperations.push(metaOp);
      }

      const dataPayload = pickWhitelistedFields(
        proj,
        ALLOWED_PROJECT_DATA_PATCH_FIELDS,
        ['expectedUpdatedAt']
      );
      if (Object.keys(dataPayload).length > 0) {
        const dataOp = await queueProjectMutation({
          userId: cleanUser,
          projectId: proj.id,
          entityType: 'data',
          operationType: 'UPDATE',
          payload: dataPayload,
          expectedUpdatedAt: baselineUpdatedAt,
          description: `Restore QA workspace data for "${proj.name}" from snapshot`,
        });
        queuedOperations.push(dataOp);
      }
    }
  }

  const checklistPendingCreationById = new Map();
  const checklistQueueSpecs = snapshotChecklists.map((chk) => {
    const existingChk = existingCachedChecklists.find((c) => c.id === chk.id);
    const hasPendingCreate = existingPendingOps.some(
      (op) =>
        op.entityType === 'checklist' &&
        op.operationType === 'CREATE' &&
        (op.checklistId === chk.id || op.entityId === chk.id) &&
        (op.status === 'pending' || op.status === 'failed')
    );
    const baselineUpdatedAt =
      (existingChk &&
        !existingChk._pendingCreation &&
        (existingChk._serverUpdatedAt || existingChk.updatedAt)) ||
      chk._serverUpdatedAt ||
      null;

    const shouldCreate =
      hasPendingCreate ||
      (existingChk ? Boolean(existingChk._pendingCreation) : !baselineUpdatedAt);

    checklistPendingCreationById.set(chk.id, shouldCreate);
    return {
      chk,
      shouldCreate,
      baselineUpdatedAt,
    };
  });

  await persistRestoredChecklistsLocally(true, checklistPendingCreationById);

  for (let i = 0; i < checklistQueueSpecs.length; i += 1) {
    const { chk, shouldCreate, baselineUpdatedAt } = checklistQueueSpecs[i];
    const operationType = shouldCreate ? 'CREATE' : 'UPDATE';
    const chkOp = await queueChecklistMutation({
      userId: cleanUser,
      checklistId: chk.id,
      projectId: chk.projectId || null,
      operationType,
      mutationSubType: 'snapshot_restore',
      payload: buildChecklistQueuePayload(chk, operationType === 'CREATE'),
      expectedUpdatedAt: operationType === 'UPDATE' ? baselineUpdatedAt : null,
      description: `Restore checklist "${chk.title}" from snapshot "${target.label}"`,
    });
    queuedOperations.push(chkOp);
  }

  return {
    ok: true,
    source: 'offline_cache',
    mode,
    snapshot: target,
    restoredProjects: snapshotProjects,
    restoredChecklists: snapshotChecklists,
    queuedOperationsCount: queuedOperations.length,
    queuedOperations,
  };
}

/**
 * Deletes a local recovery snapshot by `snapshotId` for `userId`.
 *
 * @param {string} snapshotId
 * @param {string} userId
 */
export async function deleteLocalRecoverySnapshot(snapshotId, userId) {
  const cleanUser = userId ? String(userId).trim() : '';
  const cleanSnapId = snapshotId ? String(snapshotId).trim() : '';
  if (!cleanUser || !cleanSnapId) {
    return { ok: false, error: 'Snapshot ID and user ID are required.' };
  }

  const existing = await getLocalRecoverySnapshots(cleanUser);
  const nextList = existing.filter((s) => s.snapshotId !== cleanSnapId);
  const key = getLocalSnapshotsStorageKey(cleanUser);

  try {
    const storage = getStorage();
    if (storage && typeof storage.setItem === 'function') {
      await storage.setItem(key, JSON.stringify(nextList));
    }
  } catch {
    return { ok: false, error: 'Failed to update local snapshots.' };
  }

  return {
    ok: existing.length !== nextList.length,
    remainingCount: nextList.length,
  };
}

export const dataManagementService = {
  SUPPORTED_BACKUP_VERSION,
  SUPPORTED_SCHEMA_VERSION,
  MAX_IMPORT_SIZE_BYTES,
  setDataManagementStorageAdapter,
  buildStandardizedProjectExportObject,
  exportProjectAsJSON,
  createFullBackupPayload,
  exportFullBackup,
  exportTestCasesCSV,
  exportExecutionsCSV,
  exportDefectsCSV,
  assertSafeImportObjectKeys,
  parseAndValidateImportPayload,
  fetchStorageUsage,
  getLocalStorageFootprint,
  fetchRecoverySnapshot,
  clearRecoverySnapshot,
  executeRollback,
  importWorkspaceData,
  importWorkspaceOffline,
  resetWorkspaceData,
  getLocalRecoverySnapshots,
  createLocalRecoverySnapshot,
  restoreLocalRecoverySnapshot,
  deleteLocalRecoverySnapshot,
};

export default dataManagementService;

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
import {
  apiGet,
  apiPost,
  apiDelete,
  ApiClientError,
} from './apiClient.js';
import {
  normalizeProjectRecord,
  buildDefaultTestPlan,
} from './projectService.js';
import {
  getCachedProjectsForUser,
  getPendingProjectOperations,
  cacheProjectsListOffline,
} from './offlineSyncService.js';

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

let customDataStorageAdapter = null;

function getStorage() {
  if (customDataStorageAdapter) {
    return customDataStorageAdapter;
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

export function getLocalSnapshotsStorageKey(userId) {
  const cleanUser = userId ? String(userId).trim() : '';
  if (!cleanUser) return null;
  return `${LOCAL_SNAPSHOTS_STORAGE_PREFIX}${cleanUser}`;
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

function dateStamp(now = new Date()) {
  return now.toISOString().split('T')[0];
}

function fullTimestamp(now = new Date()) {
  return now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

/**
 * Triggers a cross-platform download (Web Blob) or native share sheet (Android/iOS)
 * and always returns the generated file content and metadata.
 */
export async function shareOrDownloadFile({
  filename,
  mimeType = 'application/json',
  content = '',
  title = 'Qavora Data Export',
  skipPlatformShare = false,
} = {}) {
  const sizeBytes =
    typeof Blob !== 'undefined'
      ? new Blob([content]).size
      : Buffer.byteLength(String(content || ''), 'utf8');

  let shared = false;
  if (!skipPlatformShare) {
    try {
      if (
        Platform.OS === 'web' &&
        typeof document !== 'undefined' &&
        typeof Blob !== 'undefined' &&
        typeof URL !== 'undefined' &&
        typeof URL.createObjectURL === 'function'
      ) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
        shared = true;
      } else if (
        Platform.OS !== 'web' &&
        Share &&
        typeof Share.share === 'function'
      ) {
        await Share.share({
          title: `${title} (${filename})`,
          message: content,
        });
        shared = true;
      }
    } catch {
      shared = false;
    }
  }

  return {
    ok: true,
    filename,
    mimeType,
    content,
    sizeBytes,
    shared,
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
    const rawCases = Array.isArray(suite.cases)
      ? suite.cases
      : Array.isArray(suite.testCases)
      ? suite.testCases
      : [];
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
      const cases = Array.isArray(s.cases)
        ? s.cases
        : Array.isArray(s.testCases)
        ? s.testCases
        : [];
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
export function parseAndValidateImportPayload(jsonInput, options = {}) {
  const {
    fileName = 'backup.json',
    fileSize = 0,
    existingProjects = [],
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
    if (trimmed.length > MAX_IMPORT_SIZE_BYTES) {
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

  if (
    !Array.isArray(raw) &&
    raw.application === 'Qavora' &&
    Array.isArray(raw.projects)
  ) {
    formatType = 'Full Application Backup';
    incomingProjects = raw.projects;
    if (Array.isArray(raw.checklists)) {
      incomingChecklists = raw.checklists;
    }
  } else if (!Array.isArray(raw) && Array.isArray(raw.projects)) {
    formatType = 'Multi-Project Archive';
    incomingProjects = raw.projects;
    if (Array.isArray(raw.checklists)) {
      incomingChecklists = raw.checklists;
    }
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

    // Normalize legacy nested `testPlan.phases[].suites[].testCases[]` into `testSuites`
    let rawSuites = Array.isArray(p.testSuites) ? [...p.testSuites] : [];
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
            const phaseId = String(ph.id || `ph_${i}_${phIdx + 1}`);
            if (Array.isArray(ph.suites) && ph.suites.length > 0 && rawSuites.length === 0) {
              ph.suites.forEach((legacySuite) => {
                if (legacySuite && typeof legacySuite === 'object') {
                  rawSuites.push({
                    ...legacySuite,
                    phaseId: legacySuite.phaseId || phaseId,
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

    const seenSuiteIds = new Set();
    const seenCaseIds = new Set();

    const sanitizedSuites = rawSuites
      .filter((s) => s && typeof s === 'object' && !Array.isArray(s))
      .map((s, sIdx) => {
        let suiteId = String(s.id || s._id || `suite_${i}_${sIdx + 1}`).trim();
        if (seenSuiteIds.has(suiteId)) {
          suiteId = `${suiteId}_${sIdx + 1}`;
        }
        seenSuiteIds.add(suiteId);

        const suiteName =
          typeof s.name === 'string' && s.name.trim()
            ? s.name.trim()
            : `Suite ${sIdx + 1}`;

        const rawCases = Array.isArray(s.cases)
          ? s.cases
          : Array.isArray(s.testCases)
          ? s.testCases
          : [];

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

        const linkedPhaseId =
          s.phaseId && validPhaseIds.has(s.phaseId) ? s.phaseId : null;

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
      });

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

    // Sanitize defects and validate cross-references (`linkedTestCaseId`, `linkedTestRunId`)
    const rawDefects = Array.isArray(p.defects) ? p.defects : [];
    const seenDefectIds = new Set();
    const sanitizedDefects = rawDefects
      .filter((d) => d && typeof d === 'object' && !Array.isArray(d))
      .map((d, dIdx) => {
        let defectId = String(
          d.id || d.defectId || `DEF-${String(dIdx + 1).padStart(3, '0')}`
        ).trim();
        if (seenDefectIds.has(defectId)) {
          defectId = `${defectId}_${dIdx + 1}`;
        }
        seenDefectIds.add(defectId);

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

  const sanitizedChecklists = (
    Array.isArray(incomingChecklists) ? incomingChecklists : []
  ).filter(
    (c) =>
      c &&
      typeof c === 'object' &&
      !Array.isArray(c) &&
      (typeof c.id === 'string' || typeof c.title === 'string')
  );

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
    warnings,
    projects: sanitizedProjects,
    checklists: sanitizedChecklists,
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
 * AsyncStorage (`@qavora_local_recovery_snapshots_v1:<userId>`).
 *
 * @param {object} params
 * @param {string} params.userId
 * @param {Array<object>} params.projects
 * @param {string} [params.label='Manual Recovery Snapshot']
 * @param {string} [params.reason='manual']
 */
export async function createLocalRecoverySnapshot({
  userId,
  projects = [],
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

  const backupPayload = createFullBackupPayload(projects, []);
  const nowIso = new Date().toISOString();
  const snapshotRecord = {
    snapshotId: `lsnap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    userId: cleanUser,
    label: String(label || 'Recovery Snapshot').trim(),
    reason: String(reason || 'manual'),
    createdAt: nowIso,
    timestamp: nowIso,
    projectsCount: backupPayload.projects.length,
    metadata: backupPayload.metadata,
    projects: backupPayload.projects,
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
 * If online, synchronizes the restored projects to the backend via
 * `POST /api/data/import` (`mode: 'replace'` or `'merge'`); if offline, updates
 * the user's offline project cache directly.
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
  const snapshotProjects = Array.isArray(target.projects)
    ? target.projects.map((p) => ({ ...p, userId: cleanUser }))
    : [];

  // Attempt backend import if not explicitly offline-only
  if (!options.offlineOnly) {
    const apiRes = await importWorkspaceData(
      {
        mode,
        projects: snapshotProjects,
        checklists: [],
      },
      options.apiOptions || {}
    );

    if (apiRes.ok) {
      await cacheProjectsListOffline(snapshotProjects, cleanUser);
      return {
        ok: true,
        source: 'backend',
        mode,
        snapshot: target,
        restoredProjects: snapshotProjects,
        apiResult: apiRes,
      };
    }

    if (!apiRes.isNetworkError) {
      return apiRes;
    }
  }

  // Offline restoration fallback: update user's offline cache
  await cacheProjectsListOffline(snapshotProjects, cleanUser);
  return {
    ok: true,
    source: 'offline_cache',
    mode,
    snapshot: target,
    restoredProjects: snapshotProjects,
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
  resetWorkspaceData,
  getLocalRecoverySnapshots,
  createLocalRecoverySnapshot,
  restoreLocalRecoverySnapshot,
  deleteLocalRecoverySnapshot,
};

export default dataManagementService;

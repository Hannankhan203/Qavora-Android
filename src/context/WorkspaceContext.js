import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from './AuthContext.js';
import { useProjects } from './ProjectContext.js';
import { buildDefaultTestPlan } from '../services/projectService.js';
import {
  REPORT_TYPES,
  DATE_RANGE_FILTERS,
  EXPORT_FORMATS,
  computeProjectDashboardMetrics,
  generateProjectReport,
  exportGeneratedReport,
} from '../services/reportService.js';
import {
  INITIAL_SUITES,
  INITIAL_TEST_CASES,
  INITIAL_TEST_RUNS,
  INITIAL_DEFECTS,
  INITIAL_ACTIVITY,
  INITIAL_PROFILE,
  PRIORITIES,
  TEST_TYPES,
  EXECUTION_STATUSES,
  WEB_EXECUTION_OUTCOMES,
  DEFECT_SEVERITIES,
  DEFECT_PRIORITIES,
  DEFECT_STATUSES,
} from '../data/initialData.js';

export const WORKSPACE_STORAGE_PREFIX = '@qavora_qa_workspace_v2:project:';

export const SUITE_CATEGORIES = [
  'Functional',
  'UI/UX',
  'Security',
  'Performance',
  'Compatibility',
  'Integration',
  'Regression',
  'Accessibility',
  'API',
];

const WorkspaceContext = createContext(null);

function formatTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
    now.getDate()
  )} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

export function getProjectWorkspaceStorageKey(projectId) {
  return `${WORKSPACE_STORAGE_PREFIX}${projectId}`;
}

/**
 * Maps Qavora Web status (`Not Run`, `Pass`, `Passed`, `Fail`, `Failed`, `Blocked`, `Skipped`)
 * to Android workspace `lastStatus` (`Untested`, `Passed`, `Failed`, `Blocked`).
 */
export function normalizeCaseLastStatus(rawStatus) {
  if (!rawStatus || typeof rawStatus !== 'string') return 'Untested';
  const lowered = rawStatus.trim().toLowerCase();
  if (lowered === 'passed' || lowered === 'pass') return 'Passed';
  if (lowered === 'failed' || lowered === 'fail') return 'Failed';
  if (lowered === 'blocked') return 'Blocked';
  return 'Untested';
}

/**
 * Maps Android workspace `lastStatus` back to Qavora Web `testCase.status` field (`Passed`, `Failed`, `Blocked`, `Not Run`).
 */
export function toBackendCaseStatus(lastStatus) {
  if (!lastStatus || typeof lastStatus !== 'string') return 'Not Run';
  const lowered = lastStatus.trim().toLowerCase();
  if (lowered === 'passed' || lowered === 'pass') return 'Passed';
  if (lowered === 'failed' || lowered === 'fail') return 'Failed';
  if (lowered === 'blocked') return 'Blocked';
  return 'Not Run';
}

/**
 * Maps an execution status to Qavora Web's `executionManager.js` outcome (`Pass`, `Fail`, `Blocked`, `Not Run`).
 */
export function toWebExecutionOutcome(status) {
  if (!status || typeof status !== 'string') return 'Not Run';
  const lowered = status.trim().toLowerCase();
  if (lowered === 'passed' || lowered === 'pass') return 'Pass';
  if (lowered === 'failed' || lowered === 'fail') return 'Fail';
  if (lowered === 'blocked') return 'Blocked';
  return 'Not Run';
}

/**
 * Computes accurate run metrics matching Qavora Web's `executionManager.js:111–119`.
 *
 * @param {Array} results
 */
export function computeRunMetrics(results = []) {
  const safeResults = Array.isArray(results) ? results : [];
  const totalCases = safeResults.length;
  let passedCases = 0;
  let failedCases = 0;
  let blockedCases = 0;
  let skippedCases = 0;

  safeResults.forEach((r) => {
    const norm = normalizeCaseLastStatus(r && (r.status || r.outcome));
    if (norm === 'Passed') passedCases += 1;
    else if (norm === 'Failed') failedCases += 1;
    else if (norm === 'Blocked') blockedCases += 1;
  });

  const executedCount = passedCases + failedCases + blockedCases + skippedCases;
  const notRunCases = Math.max(0, totalCases - executedCount);
  const passRate =
    executedCount > 0 ? Math.round((passedCases / executedCount) * 100) : 0;
  const completionPct =
    totalCases > 0 ? Math.round((executedCount / totalCases) * 100) : 0;

  return {
    totalCases,
    executedCount,
    passedCases,
    failedCases,
    blockedCases,
    skippedCases,
    notRunCases,
    passRate,
    completionPct,
  };
}

/**
 * Normalizes a single test step from either Qavora Web or Android format.
 */
export function normalizeTestStep(rawStep, index = 0) {
  if (typeof rawStep === 'string') {
    return {
      id: `step-${index + 1}`,
      stepNumber: index + 1,
      action: rawStep.trim(),
      testData: '',
      expectedResult: '',
    };
  }
  if (!rawStep || typeof rawStep !== 'object') {
    return {
      id: `step-${index + 1}`,
      stepNumber: index + 1,
      action: '',
      testData: '',
      expectedResult: '',
    };
  }
  return {
    id: rawStep.id ? String(rawStep.id) : `step-${index + 1}`,
    stepNumber:
      typeof rawStep.stepNumber === 'number' && rawStep.stepNumber > 0
        ? rawStep.stepNumber
        : index + 1,
    action: typeof rawStep.action === 'string' ? rawStep.action.trim() : '',
    testData:
      typeof rawStep.testData === 'string' ? rawStep.testData.trim() : '',
    expectedResult:
      typeof rawStep.expectedResult === 'string'
        ? rawStep.expectedResult.trim()
        : '',
  };
}

/**
 * Serializes workspace `suites` and `testCases` into the nested `testSuites`
 * array and summary counters expected by Qavora Web (`PATCH /api/projects/:id/data`).
 *
 * Each suite stores both `cases` (Qavora Web `testPlanManager.js` primary key)
 * and `testCases` so both web and mobile readers stay 100% synchronized.
 *
 * @param {Array} suites
 * @param {Array} testCases
 * @returns {{ testSuites: Array, summaryCounts: object }}
 */
export function buildBackendTestSuitesPayload(suites = [], testCases = []) {
  const nowIso = new Date().toISOString();
  const safeSuites = Array.isArray(suites) ? suites : [];
  const safeCases = Array.isArray(testCases) ? testCases : [];

  const suiteMap = new Map();
  safeSuites.forEach((s, idx) => {
    if (!s || typeof s !== 'object') return;
    const id = String(s.id || s._id || `suite-${idx + 1}`);
    suiteMap.set(id, {
      id,
      phaseId: s.phaseId || null,
      name:
        typeof s.name === 'string' && s.name.trim()
          ? s.name.trim()
          : `Suite ${idx + 1}`,
      category:
        typeof s.category === 'string' && s.category.trim()
          ? s.category.trim()
          : 'Functional',
      tags: Array.isArray(s.tags)
        ? s.tags.filter((t) => typeof t === 'string').map((t) => t.trim())
        : [],
      description:
        typeof s.description === 'string' ? s.description.trim() : '',
      createdAt: s.createdAt || nowIso,
      updatedAt: s.updatedAt || nowIso,
      cases: [],
      testCases: [],
    });
  });

  const orderedCases = [...safeCases];
  orderedCases.forEach((tc, tcIdx) => {
    if (!tc || typeof tc !== 'object') return;
    const targetSuiteId = String(tc.suiteId || 'suite-general');
    if (!suiteMap.has(targetSuiteId)) {
      suiteMap.set(targetSuiteId, {
        id: targetSuiteId,
        phaseId: null,
        name:
          typeof tc.suiteName === 'string' && tc.suiteName.trim()
            ? tc.suiteName.trim()
            : 'General Test Suite',
        category: 'Functional',
        tags: [],
        description: '',
        createdAt: nowIso,
        updatedAt: nowIso,
        cases: [],
        testCases: [],
      });
    }

    const parentSuite = suiteMap.get(targetSuiteId);
    const normalizedLastStatus = normalizeCaseLastStatus(
      tc.lastStatus || tc.status
    );
    const backendStatus = toBackendCaseStatus(normalizedLastStatus);
    const formattedSteps = (Array.isArray(tc.steps) ? tc.steps : [])
      .map((st, idx) => normalizeTestStep(st, idx))
      .filter((st) => st.action);

    const caseId = String(tc.id || tc.testCaseId || `TC-${101 + tcIdx}`);
    const testCaseCode = String(tc.testCaseId || tc.id || caseId);
    const resolvedCategory =
      (typeof tc.testType === 'string' && tc.testType.trim()) ||
      (typeof tc.category === 'string' && tc.category.trim()) ||
      'Functional';

    const serializedCase = {
      id: caseId,
      testCaseId: testCaseCode,
      suiteId: parentSuite.id,
      suiteName: parentSuite.name,
      title:
        typeof tc.title === 'string' && tc.title.trim()
          ? tc.title.trim()
          : 'Untitled Test Case',
      description:
        typeof tc.description === 'string' ? tc.description.trim() : '',
      preconditions:
        typeof tc.preconditions === 'string' && tc.preconditions.trim()
          ? tc.preconditions.trim()
          : 'Standard application state.',
      priority: tc.priority || 'P1',
      category: resolvedCategory,
      testType: resolvedCategory,
      tags: Array.isArray(tc.tags)
        ? tc.tags.filter((t) => typeof t === 'string').map((t) => t.trim())
        : [],
      steps: formattedSteps,
      expectedResult:
        typeof tc.expectedResult === 'string' && tc.expectedResult.trim()
          ? tc.expectedResult.trim()
          : 'All test steps pass without error.',
      status: backendStatus,
      lastStatus: normalizedLastStatus,
      ...(tc.lastExecution && typeof tc.lastExecution === 'object'
        ? { lastExecution: tc.lastExecution }
        : {}),
      createdAt: tc.createdAt || nowIso,
      updatedAt: tc.updatedAt || nowIso,
    };

    parentSuite.cases.push(serializedCase);
    parentSuite.testCases.push(serializedCase);
  });

  const testSuites = Array.from(suiteMap.values());

  const totalTestCases = safeCases.length;
  const passedTests = safeCases.filter(
    (tc) => normalizeCaseLastStatus(tc.lastStatus || tc.status) === 'Passed'
  ).length;
  const failedTests = safeCases.filter(
    (tc) => normalizeCaseLastStatus(tc.lastStatus || tc.status) === 'Failed'
  ).length;
  const blockedTests = safeCases.filter(
    (tc) => normalizeCaseLastStatus(tc.lastStatus || tc.status) === 'Blocked'
  ).length;
  const notRunTests = Math.max(
    0,
    totalTestCases - passedTests - failedTests - blockedTests
  );
  const executedTests = passedTests + failedTests + blockedTests;
  const passRate =
    executedTests > 0 ? Math.round((passedTests / executedTests) * 100) : 0;

  return {
    testSuites,
    summaryCounts: {
      testCaseCount: totalTestCases,
      executedTests,
      passedTests,
      failedTests,
      blockedTests,
      skippedTests: 0,
      notRunTests,
      passRate,
    },
  };
}

/**
 * Serializes `testRuns` and `executions` into Qavora Web's `executionRuns`,
 * `activeRun`, and `executions` fields for `PATCH /api/projects/:id/data`.
 *
 * @param {Array} testRuns
 * @param {Array} executions
 */
export function buildBackendExecutionsAndRunsPayload(
  testRuns = [],
  executions = []
) {
  const nowIso = new Date().toISOString();
  const safeRuns = Array.isArray(testRuns) ? testRuns : [];
  const safeExecs = Array.isArray(executions) ? executions : [];

  const executionRuns = safeRuns.map((run, idx) => {
    const results = (Array.isArray(run.results) ? run.results : []).map((r) => {
      const normStatus = normalizeCaseLastStatus(r.status || r.outcome);
      return {
        testCaseId: String(r.testCaseId || r.caseId || ''),
        caseId: String(r.caseId || r.testCaseId || ''),
        caseTitle: r.caseTitle || '',
        suiteId: r.suiteId || '',
        suiteName: r.suiteName || run.suiteName || 'All Suites',
        status: normStatus,
        outcome: toWebExecutionOutcome(normStatus),
        actualResult: typeof r.actualResult === 'string' ? r.actualResult : '',
        notes: typeof r.notes === 'string' ? r.notes : '',
        tester: typeof r.tester === 'string' ? r.tester : run.tester || '',
        environment:
          typeof r.environment === 'string'
            ? r.environment
            : run.environment || '',
        device:
          typeof r.device === 'string' ? r.device : run.deviceInfo || '',
        buildVersion:
          typeof r.buildVersion === 'string'
            ? r.buildVersion
            : run.buildVersion || '',
        stepStatuses:
          r.stepStatuses && typeof r.stepStatuses === 'object'
            ? r.stepStatuses
            : {},
        executedAt: r.executedAt || null,
        linkedDefectId: r.linkedDefectId || null,
      };
    });

    const metrics = computeRunMetrics(results);
    const status =
      run.status === 'Completed' ? 'Completed' : 'In Progress';

    return {
      id: String(run.id || `RUN-${201 + idx}`),
      name:
        typeof run.name === 'string' && run.name.trim()
          ? run.name.trim()
          : `Test Run ${idx + 1}`,
      suiteId: run.suiteId || 'all',
      suiteName: run.suiteName || 'All Suites',
      buildVersion: run.buildVersion || '1.0.0',
      deviceInfo: run.deviceInfo || '',
      environment: run.environment || 'Staging',
      tester: run.tester || '',
      notes: run.notes || '',
      status,
      startedAt: run.startedAt || run.createdAt || nowIso,
      completedAt:
        status === 'Completed'
          ? run.completedAt || run.updatedAt || nowIso
          : null,
      createdAt: run.createdAt || formatTimestamp(),
      updatedAt: run.updatedAt || formatTimestamp(),
      metrics,
      results,
    };
  });

  const activeRunObj =
    executionRuns.find((r) => r.status === 'In Progress') || null;
  const activeRun = activeRunObj
    ? {
        id: activeRunObj.id,
        name: activeRunObj.name,
        environment: activeRunObj.environment,
        buildVersion: activeRunObj.buildVersion,
        deviceInfo: activeRunObj.deviceInfo,
        notes: activeRunObj.notes,
        startedAt: activeRunObj.startedAt,
        status: 'In Progress',
      }
    : null;

  const serializedExecutions = safeExecs.map((ex, idx) => {
    const outcome = toWebExecutionOutcome(ex.status || ex.outcome);
    const normStatus = normalizeCaseLastStatus(ex.status || ex.outcome);
    return {
      id: String(ex.id || `exec_${Date.now()}_${idx}`),
      runId: ex.runId || null,
      runName: ex.runName || '',
      caseId: String(ex.caseId || ex.testCaseId || ''),
      testCaseId: String(ex.testCaseId || ex.caseId || ''),
      caseTitle: ex.caseTitle || '',
      suiteId: ex.suiteId || '',
      suiteName: ex.suiteName || '',
      status: outcome,
      outcome,
      normalizedStatus: normStatus,
      actualResult: typeof ex.actualResult === 'string' ? ex.actualResult : '',
      notes: typeof ex.notes === 'string' ? ex.notes : '',
      tester: typeof ex.tester === 'string' ? ex.tester : '',
      environment: typeof ex.environment === 'string' ? ex.environment : '',
      device: typeof ex.device === 'string' ? ex.device : '',
      buildVersion:
        typeof ex.buildVersion === 'string' ? ex.buildVersion : '',
      stepStatuses:
        ex.stepStatuses && typeof ex.stepStatuses === 'object'
          ? ex.stepStatuses
          : {},
      linkedDefectId: ex.linkedDefectId || null,
      executedAt: ex.executedAt || nowIso,
    };
  });

  return {
    executionRuns,
    activeRun,
    executions: serializedExecutions,
  };
}

/**
 * Serializes `defects` into Qavora Web's `defects` array and computes the
 * project-level defect summary counters (`totalDefects`, `openDefects`,
 * `inProgressDefects`, `resolvedDefects`, `closedDefects`, `criticalDefects`).
 *
 * @param {Array} defects
 */
export function buildBackendDefectsPayload(defects = []) {
  const nowIso = new Date().toISOString();
  const safeDefects = Array.isArray(defects) ? defects : [];

  const serializedDefects = safeDefects.map((d, idx) => {
    const id = String(d.id || d.defectId || `DEF-${String(idx + 1).padStart(3, '0')}`);
    const defectId = String(d.defectId || d.id || id);
    const stepsText =
      (typeof d.reproductionSteps === 'string' && d.reproductionSteps.trim()) ||
      (typeof d.steps === 'string' && d.steps.trim()) ||
      (typeof d.stepsToReproduce === 'string' && d.stepsToReproduce.trim()) ||
      '';
    const severity = DEFECT_SEVERITIES.includes(d.severity)
      ? d.severity
      : 'High';
    const priority = DEFECT_PRIORITIES.includes(d.priority)
      ? d.priority
      : severity;
    const status = DEFECT_STATUSES.includes(d.status) ? d.status : 'Open';

    return {
      id,
      defectId,
      title:
        typeof d.title === 'string' && d.title.trim()
          ? d.title.trim()
          : 'Untitled Defect',
      description: typeof d.description === 'string' ? d.description.trim() : '',
      severity,
      priority,
      status,
      steps: stepsText,
      reproductionSteps: stepsText,
      expectedResult:
        typeof d.expectedResult === 'string' ? d.expectedResult.trim() : '',
      actualResult:
        typeof d.actualResult === 'string' ? d.actualResult.trim() : '',
      environment:
        typeof d.environment === 'string' ? d.environment.trim() : '',
      externalUrl:
        typeof d.externalUrl === 'string' ? d.externalUrl.trim() : '',
      linkedTestCaseId: d.linkedTestCaseId || d.testCaseId || null,
      linkedCaseTitle:
        typeof d.linkedCaseTitle === 'string' ? d.linkedCaseTitle : '',
      linkedTestRunId: d.linkedTestRunId || null,
      linkedExecutionId: d.linkedExecutionId || null,
      createdAt: d.createdAt || nowIso,
      updatedAt: d.updatedAt || nowIso,
    };
  });

  let totalDefects = 0;
  let openDefects = 0;
  let inProgressDefects = 0;
  let resolvedDefects = 0;
  let closedDefects = 0;
  let criticalDefects = 0;

  serializedDefects.forEach((d) => {
    totalDefects += 1;
    const st = (d.status || '').toLowerCase();
    const sev = (d.severity || '').toLowerCase();

    if (st === 'open' || st === 'reopened') {
      openDefects += 1;
    } else if (st === 'in progress' || st === 'ready for retest') {
      inProgressDefects += 1;
    } else if (st === 'resolved') {
      resolvedDefects += 1;
    } else if (st === 'closed') {
      closedDefects += 1;
    }

    if (sev === 'critical' && st !== 'closed') {
      criticalDefects += 1;
    }
  });

  return {
    defects: serializedDefects,
    defectSummaryCounts: {
      totalDefects,
      openDefects,
      inProgressDefects,
      resolvedDefects,
      closedDefects,
      criticalDefects,
    },
  };
}

/**
 * Extracts and normalizes workspace state for a specific selected project,
 * ensuring zero stale data leaks between projects.
 *
 * @param {object | null} selectedProject
 * @param {object | null} [persistedSnapshot]
 * @param {object | null} [currentUser]
 */
export function buildProjectWorkspaceState(
  selectedProject,
  persistedSnapshot = null,
  currentUser = null
) {
  const baseTesterName =
    (currentUser && currentUser.name) || INITIAL_PROFILE.testerName;
  const baseRole = (currentUser && currentUser.role) || INITIAL_PROFILE.role;

  if (!selectedProject || typeof selectedProject !== 'object') {
    return {
      projectId: null,
      profile: {
        ...INITIAL_PROFILE,
        testerName: baseTesterName,
        role: baseRole,
        projectName: 'No Project Selected',
        targetVersion: '',
      },
      testPlan: buildDefaultTestPlan({ id: 'none', name: 'No Project' }),
      suites: [],
      testCases: [],
      testRuns: [],
      executions: [],
      defects: [],
      activityLog: [],
    };
  }

  const projectId = String(selectedProject.id || selectedProject._id || '');
  const backendTestPlan = buildDefaultTestPlan(selectedProject);

  // 1. Map backend suites & nested test cases (`cases` or `testCases`)
  const rawSuites = Array.isArray(selectedProject.testSuites)
    ? selectedProject.testSuites
    : [];
  const backendSuites = rawSuites.map((s, idx) => ({
    id: String((s && (s.id || s._id)) || `suite-${idx + 1}`),
    phaseId: (s && s.phaseId) || null,
    name: (s && s.name) || `Suite ${idx + 1}`,
    category: (s && s.category) || 'Functional',
    tags: Array.isArray(s && s.tags)
      ? s.tags.filter((t) => typeof t === 'string').map((t) => t.trim())
      : [],
    description: (s && s.description) || '',
    createdAt:
      (s && s.createdAt) || selectedProject.createdAt || formatTimestamp(),
    updatedAt:
      (s && s.updatedAt) || selectedProject.updatedAt || formatTimestamp(),
  }));

  const backendTestCases = [];
  rawSuites.forEach((s, suiteIdx) => {
    const suiteId = String((s && (s.id || s._id)) || `suite-${suiteIdx + 1}`);
    const suiteName = (s && s.name) || `Suite ${suiteIdx + 1}`;
    const rawCases =
      s && Array.isArray(s.cases)
        ? s.cases
        : s && Array.isArray(s.testCases)
        ? s.testCases
        : [];
    rawCases.forEach((tc, tcIdx) => {
      if (!tc || typeof tc !== 'object') return;
      const caseId = String(
        tc.id || tc.testCaseId || `TC-${suiteIdx + 1}${tcIdx + 1}`
      );
      const resolvedType =
        tc.testType || tc.category || tc.type || 'Functional';
      backendTestCases.push({
        id: caseId,
        testCaseId: String(tc.testCaseId || caseId),
        suiteId,
        suiteName,
        title: tc.title || tc.name || 'Untitled Test Case',
        description: tc.description || '',
        preconditions: tc.preconditions || 'Standard application state.',
        priority: tc.priority || 'P1',
        category: resolvedType,
        testType: resolvedType,
        tags: Array.isArray(tc.tags)
          ? tc.tags.filter((t) => typeof t === 'string').map((t) => t.trim())
          : [],
        steps: Array.isArray(tc.steps)
          ? tc.steps.map((st, idx) => normalizeTestStep(st, idx))
          : [],
        expectedResult:
          tc.expectedResult || 'All test steps pass without error.',
        status: toBackendCaseStatus(tc.lastStatus || tc.status),
        lastStatus: normalizeCaseLastStatus(tc.lastStatus || tc.status),
        lastExecution:
          tc.lastExecution && typeof tc.lastExecution === 'object'
            ? tc.lastExecution
            : null,
        createdAt: tc.createdAt || formatTimestamp(),
        updatedAt: tc.updatedAt || formatTimestamp(),
      });
    });
  });

  // 2. Map backend executions (chronological execution records)
  const rawExecutions = Array.isArray(selectedProject.executions)
    ? selectedProject.executions
    : [];

  const backendExecutions = rawExecutions
    .filter((ex) => ex && typeof ex === 'object' && !Array.isArray(ex.results))
    .map((ex, idx) => {
      const caseId = String(ex.testCaseId || ex.caseId || '');
      const matchedCase = backendTestCases.find(
        (c) => c.id === caseId || c.testCaseId === caseId
      );
      const outcome = toWebExecutionOutcome(
        ex.status || ex.outcome || ex.normalizedStatus
      );
      const normStatus = normalizeCaseLastStatus(
        ex.normalizedStatus || ex.status || ex.outcome
      );
      return {
        id: String(ex.id || `exec-${idx + 1}`),
        runId: ex.runId || null,
        runName: ex.runName || '',
        caseId: caseId || (matchedCase ? matchedCase.id : `TC-${idx + 1}`),
        testCaseId: caseId || (matchedCase ? matchedCase.id : `TC-${idx + 1}`),
        caseTitle:
          ex.caseTitle || (matchedCase ? matchedCase.title : 'Test Case'),
        suiteId: ex.suiteId || (matchedCase ? matchedCase.suiteId : ''),
        suiteName:
          ex.suiteName || (matchedCase ? matchedCase.suiteName : 'All Suites'),
        status: outcome,
        outcome,
        normalizedStatus: normStatus,
        actualResult: ex.actualResult || '',
        notes: ex.notes || '',
        tester: ex.tester || baseTesterName,
        environment:
          ex.environment || selectedProject.environment || 'Staging',
        device: ex.device || INITIAL_PROFILE.defaultDevice,
        buildVersion: ex.buildVersion || selectedProject.version || '1.0.0',
        stepStatuses:
          ex.stepStatuses && typeof ex.stepStatuses === 'object'
            ? ex.stepStatuses
            : {},
        linkedDefectId: ex.linkedDefectId || null,
        executedAt: ex.executedAt || formatTimestamp(),
      };
    });

  // 3. Map backend test runs (`executionRuns` + `activeRun` + any legacy run objects in `executions`)
  const rawRunList = [];
  if (
    selectedProject.activeRun &&
    typeof selectedProject.activeRun === 'object'
  ) {
    rawRunList.push(selectedProject.activeRun);
  }
  if (Array.isArray(selectedProject.executionRuns)) {
    selectedProject.executionRuns.forEach((r) => {
      if (!r || typeof r !== 'object') return;
      if (!rawRunList.some((existing) => existing.id === r.id)) {
        rawRunList.push(r);
      }
    });
  }
  rawExecutions.forEach((r) => {
    if (r && typeof r === 'object' && Array.isArray(r.results)) {
      if (!rawRunList.some((existing) => existing.id === r.id)) {
        rawRunList.push(r);
      }
    }
  });

  const backendTestRuns = rawRunList.map((run, idx) => {
    const runId = String(run.id || `RUN-${201 + idx}`);
    let results = [];
    if (Array.isArray(run.results) && run.results.length > 0) {
      results = run.results.map((r) => {
        const tcId = String(r.testCaseId || r.caseId || '');
        const matchedTc = backendTestCases.find(
          (c) => c.id === tcId || c.testCaseId === tcId
        );
        const normStatus = normalizeCaseLastStatus(r.status || r.outcome);
        return {
          testCaseId: tcId,
          caseId: tcId,
          caseTitle:
            r.caseTitle || (matchedTc ? matchedTc.title : `Test Case ${tcId}`),
          suiteId: r.suiteId || (matchedTc ? matchedTc.suiteId : ''),
          suiteName:
            r.suiteName ||
            (matchedTc ? matchedTc.suiteName : run.suiteName || 'All Suites'),
          status: normStatus,
          outcome: toWebExecutionOutcome(normStatus),
          actualResult: r.actualResult || '',
          notes: r.notes || '',
          tester: r.tester || run.tester || baseTesterName,
          environment:
            r.environment ||
            run.environment ||
            selectedProject.environment ||
            'Staging',
          device:
            r.device || run.deviceInfo || INITIAL_PROFILE.defaultDevice,
          buildVersion:
            r.buildVersion ||
            run.buildVersion ||
            selectedProject.version ||
            '1.0.0',
          stepStatuses:
            r.stepStatuses && typeof r.stepStatuses === 'object'
              ? r.stepStatuses
              : {},
          executedAt: r.executedAt || null,
          linkedDefectId: r.linkedDefectId || null,
        };
      });
    } else {
      // Hydrate results for a Qavora Web run (`activeRun` or `executionRuns` item without `results`)
      results = backendTestCases.map((tc) => {
        const matchingExec = backendExecutions.find(
          (ex) =>
            (ex.runId === runId || !ex.runId) &&
            (ex.testCaseId === tc.id || ex.caseId === tc.id)
        );
        const normStatus = matchingExec
          ? matchingExec.normalizedStatus
          : tc.lastStatus || 'Untested';
        return {
          testCaseId: tc.id,
          caseId: tc.id,
          caseTitle: tc.title,
          suiteId: tc.suiteId,
          suiteName: tc.suiteName,
          status: normStatus,
          outcome: toWebExecutionOutcome(normStatus),
          actualResult: matchingExec
            ? matchingExec.actualResult
            : (tc.lastExecution && tc.lastExecution.actualResult) || '',
          notes: matchingExec ? matchingExec.notes : '',
          tester: matchingExec ? matchingExec.tester : baseTesterName,
          environment:
            run.environment || selectedProject.environment || 'Staging',
          device: run.deviceInfo || INITIAL_PROFILE.defaultDevice,
          buildVersion:
            run.buildVersion || selectedProject.version || '1.0.0',
          stepStatuses: matchingExec ? matchingExec.stepStatuses || {} : {},
          executedAt: matchingExec
            ? matchingExec.executedAt
            : (tc.lastExecution && tc.lastExecution.executedAt) || null,
          linkedDefectId: matchingExec ? matchingExec.linkedDefectId : null,
        };
      });
    }

    const metrics = computeRunMetrics(results);

    return {
      id: runId,
      name: run.name || `Test Run ${idx + 1}`,
      suiteId: run.suiteId || 'all',
      suiteName: run.suiteName || 'All Suites',
      buildVersion: run.buildVersion || selectedProject.version || '1.0.0',
      deviceInfo: run.deviceInfo || INITIAL_PROFILE.defaultDevice,
      environment:
        run.environment || selectedProject.environment || 'Staging',
      tester: run.tester || baseTesterName,
      notes: run.notes || '',
      status: run.status === 'Completed' ? 'Completed' : 'In Progress',
      startedAt: run.startedAt || run.createdAt || formatTimestamp(),
      completedAt: run.completedAt || null,
      createdAt: run.createdAt || run.startedAt || formatTimestamp(),
      updatedAt:
        run.updatedAt ||
        run.completedAt ||
        run.startedAt ||
        formatTimestamp(),
      metrics: run.metrics || metrics,
      results,
    };
  });

  // 4. Map backend defects
  const rawDefects = Array.isArray(selectedProject.defects)
    ? selectedProject.defects
    : [];
  const backendDefects = rawDefects.map((bug, idx) => {
    const id = String(
      bug.id || bug.defectId || `DEF-${String(idx + 1).padStart(3, '0')}`
    );
    const defectId = String(bug.defectId || bug.id || id);
    const linkedTcId = bug.linkedTestCaseId || bug.testCaseId || null;
    const matchedTc = linkedTcId
      ? backendTestCases.find(
          (c) => c.id === linkedTcId || c.testCaseId === linkedTcId
        )
      : null;
    const stepsText =
      bug.reproductionSteps || bug.steps || bug.stepsToReproduce || '';
    const severity = DEFECT_SEVERITIES.includes(bug.severity)
      ? bug.severity
      : 'High';
    const priority = DEFECT_PRIORITIES.includes(bug.priority)
      ? bug.priority
      : severity;
    const status = DEFECT_STATUSES.includes(bug.status)
      ? bug.status
      : 'Open';

    return {
      id,
      defectId,
      title: bug.title || 'Untitled Defect',
      description: bug.description || '',
      severity,
      priority,
      status,
      steps: stepsText,
      reproductionSteps: stepsText,
      expectedResult: bug.expectedResult || '',
      actualResult: bug.actualResult || '',
      environment:
        bug.environment || selectedProject.environment || 'Staging',
      externalUrl: bug.externalUrl || '',
      linkedTestCaseId: linkedTcId,
      linkedCaseTitle:
        bug.linkedCaseTitle || (matchedTc ? matchedTc.title : ''),
      linkedTestRunId: bug.linkedTestRunId || null,
      linkedExecutionId: bug.linkedExecutionId || null,
      createdAt: bug.createdAt || formatTimestamp(),
      updatedAt: bug.updatedAt || formatTimestamp(),
    };
  });

  const hasValidSnapshot =
    persistedSnapshot &&
    typeof persistedSnapshot === 'object' &&
    persistedSnapshot.projectId === projectId;

  // Authoritative backend data takes precedence whenever `selectedProject.updatedAt` is present
  const useLocalFallbackOnly =
    hasValidSnapshot && !selectedProject.updatedAt;

  const syncedProfile = {
    ...(hasValidSnapshot && persistedSnapshot.profile
      ? persistedSnapshot.profile
      : INITIAL_PROFILE),
    testerName:
      (hasValidSnapshot &&
        persistedSnapshot.profile &&
        persistedSnapshot.profile.testerName) ||
      baseTesterName,
    role:
      (hasValidSnapshot &&
        persistedSnapshot.profile &&
        persistedSnapshot.profile.role) ||
      baseRole,
    projectName: selectedProject.name || 'Untitled Project',
    targetVersion:
      selectedProject.version ||
      (hasValidSnapshot &&
        persistedSnapshot.profile &&
        persistedSnapshot.profile.targetVersion) ||
      'v1.0.0',
    defaultEnvironment:
      selectedProject.environment ||
      (hasValidSnapshot &&
        persistedSnapshot.profile &&
        persistedSnapshot.profile.defaultEnvironment) ||
      'Staging',
  };

  const defaultActivity = [
    {
      id: `act-init-${projectId}`,
      category: 'project',
      title: `Loaded project "${selectedProject.name}"`,
      detail: `Status: ${selectedProject.status || 'Active'} · Type: ${
        selectedProject.type || 'Web Application'
      }`,
      timestamp: formatTimestamp(),
    },
  ];

  return {
    projectId,
    profile: syncedProfile,
    testPlan:
      useLocalFallbackOnly && persistedSnapshot.testPlan
        ? buildDefaultTestPlan({
            ...selectedProject,
            testPlan: persistedSnapshot.testPlan,
          })
        : backendTestPlan,
    suites:
      useLocalFallbackOnly && Array.isArray(persistedSnapshot.suites)
        ? persistedSnapshot.suites
        : backendSuites,
    testCases:
      useLocalFallbackOnly && Array.isArray(persistedSnapshot.testCases)
        ? persistedSnapshot.testCases
        : backendTestCases,
    testRuns:
      useLocalFallbackOnly && Array.isArray(persistedSnapshot.testRuns)
        ? persistedSnapshot.testRuns
        : backendTestRuns,
    executions:
      useLocalFallbackOnly && Array.isArray(persistedSnapshot.executions)
        ? persistedSnapshot.executions
        : backendExecutions,
    defects:
      useLocalFallbackOnly && Array.isArray(persistedSnapshot.defects)
        ? persistedSnapshot.defects
        : backendDefects,
    activityLog:
      hasValidSnapshot &&
      Array.isArray(persistedSnapshot.activityLog) &&
      persistedSnapshot.activityLog.length > 0
        ? persistedSnapshot.activityLog
        : defaultActivity,
  };
}

export function WorkspaceProvider({ children }) {
  const { user } = useAuth();
  const {
    selectedProject,
    selectedProjectId,
    updateProjectData,
    getProject,
  } = useProjects();

  const [hydratedProjectId, setHydratedProjectId] = useState(null);
  const [isStorageHydrated, setIsStorageHydrated] = useState(false);
  const [lastPersistedAt, setLastPersistedAt] = useState(null);

  // Backend Synchronization State for Phase 2C & 2D
  const [isSyncingProjectData, setIsSyncingProjectData] = useState(false);
  const [projectDataError, setProjectDataError] = useState(null);
  const [projectDataConflict, setProjectDataConflict] = useState(null);
  const syncLockRef = useRef(false);

  const initialWorkspace = useMemo(
    () => buildProjectWorkspaceState(selectedProject, null, user),
    []
  );

  const [profile, setProfile] = useState(initialWorkspace.profile);
  const [testPlan, setTestPlan] = useState(initialWorkspace.testPlan);
  const [suites, setSuites] = useState(initialWorkspace.suites);
  const [testCases, setTestCases] = useState(initialWorkspace.testCases);
  const [testRuns, setTestRuns] = useState(initialWorkspace.testRuns);
  const [executions, setExecutions] = useState(initialWorkspace.executions);
  const [defects, setDefects] = useState(initialWorkspace.defects);
  const [activityLog, setActivityLog] = useState(initialWorkspace.activityLog);

  const testPlanRef = useRef(testPlan);
  testPlanRef.current = testPlan;

  const suitesRef = useRef(suites);
  suitesRef.current = suites;

  const testCasesRef = useRef(testCases);
  testCasesRef.current = testCases;

  const testRunsRef = useRef(testRuns);
  testRunsRef.current = testRuns;

  const executionsRef = useRef(executions);
  executionsRef.current = executions;

  const defectsRef = useRef(defects);
  defectsRef.current = defects;

  // Navigation & Active Selection State
  const [activeTab, setActiveTab] = useState('dashboard'); // 'dashboard' | 'testcases' | 'testruns' | 'defects' | 'profile'
  const [dashboardSubTab, setDashboardSubTab] = useState('overview'); // 'overview' | 'reports'
  const [projectViewMode, setProjectViewMode] = useState('workspace'); // 'workspace' | 'selection' | 'details'
  const [selectedTestCaseId, setSelectedTestCaseId] = useState(null);
  const [selectedTestRunId, setSelectedTestRunId] = useState(null);
  const [selectedDefectId, setSelectedDefectId] = useState(null);

  // Cross-module prefill state for creating a defect directly from a failed test case execution
  const [draftDefectFromExecution, setDraftDefectFromExecution] = useState(null);

  // Toast feedback
  const [toast, setToast] = useState(null);

  const showToast = useCallback((message, tone = 'info') => {
    setToast({ id: Date.now(), message, tone });
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(timer);
  }, [toast]);

  const clearProjectDataError = useCallback(() => {
    setProjectDataError(null);
    setProjectDataConflict(null);
  }, []);

  const openProjectSelection = useCallback(() => {
    setProjectViewMode('selection');
  }, []);

  const openProjectDetails = useCallback(() => {
    setProjectViewMode('details');
  }, []);

  const openWorkspace = useCallback(() => {
    setProjectViewMode('workspace');
  }, []);

  const openDashboardOverview = useCallback(() => {
    setProjectViewMode('workspace');
    setActiveTab('dashboard');
    setDashboardSubTab('overview');
  }, []);

  const openReportsView = useCallback(() => {
    setProjectViewMode('workspace');
    setActiveTab('dashboard');
    setDashboardSubTab('reports');
  }, []);

  // Switch workspace data cleanly whenever the selected project changes
  useEffect(() => {
    let mounted = true;

    setSelectedTestCaseId(null);
    setSelectedTestRunId(null);
    setSelectedDefectId(null);
    setDraftDefectFromExecution(null);
    setProjectDataError(null);
    setProjectDataConflict(null);

    if (!selectedProjectId || !selectedProject) {
      const emptyState = buildProjectWorkspaceState(null, null, user);
      setProfile(emptyState.profile);
      setTestPlan(emptyState.testPlan);
      setSuites(emptyState.suites);
      setTestCases(emptyState.testCases);
      setTestRuns(emptyState.testRuns);
      setExecutions(emptyState.executions);
      setDefects(emptyState.defects);
      setActivityLog(emptyState.activityLog);
      setHydratedProjectId(null);
      setLastPersistedAt(null);
      setIsStorageHydrated(true);
      setProjectViewMode('selection');
      return () => {
        mounted = false;
      };
    }

    setIsStorageHydrated(false);
    setHydratedProjectId(null);
    const immediateState = buildProjectWorkspaceState(
      selectedProject,
      null,
      user
    );
    setProfile(immediateState.profile);
    setTestPlan(immediateState.testPlan);
    setSuites(immediateState.suites);
    setTestCases(immediateState.testCases);
    setTestRuns(immediateState.testRuns);
    setExecutions(immediateState.executions);
    setDefects(immediateState.defects);
    setActivityLog(immediateState.activityLog);

    const storageKey = getProjectWorkspaceStorageKey(selectedProjectId);
    AsyncStorage.getItem(storageKey)
      .then((raw) => {
        if (!mounted) return;
        let snapshot = null;
        if (raw) {
          try {
            snapshot = JSON.parse(raw);
          } catch {
            snapshot = null;
          }
        }
        const resolved = buildProjectWorkspaceState(
          selectedProject,
          snapshot,
          user
        );
        setProfile(resolved.profile);
        setTestPlan(resolved.testPlan);
        setSuites(resolved.suites);
        setTestCases(resolved.testCases);
        setTestRuns(resolved.testRuns);
        setExecutions(resolved.executions);
        setDefects(resolved.defects);
        setActivityLog(resolved.activityLog);
        setLastPersistedAt(
          (snapshot && snapshot.savedAt) || formatTimestamp()
        );
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) {
          setHydratedProjectId(selectedProjectId);
          setIsStorageHydrated(true);
        }
      });

    return () => {
      mounted = false;
    };
  }, [selectedProjectId]);

  // Synchronize workspace state whenever selectedProject is refreshed from the server
  useEffect(() => {
    if (!selectedProject || !selectedProjectId) return;
    const synced = buildProjectWorkspaceState(selectedProject, null, user);
    setTestPlan(synced.testPlan);
    setSuites(synced.suites);
    setTestCases(synced.testCases);
    setTestRuns(synced.testRuns);
    setExecutions(synced.executions);
    setDefects(synced.defects);
    setProfile((prev) => ({
      ...prev,
      projectName: selectedProject.name || prev.projectName,
      targetVersion: selectedProject.version || prev.targetVersion || 'v1.0.0',
      defaultEnvironment:
        selectedProject.environment || prev.defaultEnvironment || 'Staging',
    }));
  }, [
    selectedProjectId,
    selectedProject && selectedProject.updatedAt,
    selectedProject && selectedProject.name,
    selectedProject && selectedProject.version,
    selectedProject && selectedProject.environment,
  ]);

  // Persist project-scoped workspace data to AsyncStorage
  useEffect(() => {
    if (
      !isStorageHydrated ||
      !selectedProjectId ||
      hydratedProjectId !== selectedProjectId
    ) {
      return;
    }
    const savedAt = formatTimestamp();
    const payload = JSON.stringify({
      projectId: selectedProjectId,
      serverUpdatedAt: (selectedProject && selectedProject.updatedAt) || null,
      profile,
      testPlan,
      suites,
      testCases,
      testRuns,
      executions,
      defects,
      activityLog,
      savedAt,
    });
    AsyncStorage.setItem(
      getProjectWorkspaceStorageKey(selectedProjectId),
      payload
    )
      .then(() => {
        setLastPersistedAt(savedAt);
      })
      .catch(() => {});
  }, [
    isStorageHydrated,
    selectedProjectId,
    hydratedProjectId,
    selectedProject && selectedProject.updatedAt,
    profile,
    testPlan,
    suites,
    testCases,
    testRuns,
    executions,
    defects,
    activityLog,
  ]);

  const appendActivity = useCallback((category, title, detail) => {
    const entry = {
      id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      category,
      title,
      detail,
      timestamp: formatTimestamp(),
    };
    setActivityLog((prev) => [entry, ...prev.slice(0, 29)]);
  }, []);

  /**
   * Reloads the active project's latest data from the backend (`GET /api/projects/:id`),
   * clearing any HTTP 409 conflict state.
   */
  const reloadProjectDataFromBackend = useCallback(async () => {
    if (!selectedProjectId) {
      return { ok: false, error: 'No active project selected.' };
    }
    setIsSyncingProjectData(true);
    setProjectDataError(null);
    setProjectDataConflict(null);
    try {
      const result = await getProject(selectedProjectId);
      if (result.ok && result.project) {
        const refreshed = buildProjectWorkspaceState(
          result.project,
          null,
          user
        );
        setTestPlan(refreshed.testPlan);
        setSuites(refreshed.suites);
        setTestCases(refreshed.testCases);
        setTestRuns(refreshed.testRuns);
        setExecutions(refreshed.executions);
        setDefects(refreshed.defects);
        showToast('Reloaded latest project data from server', 'info');
      } else if (!result.ok) {
        setProjectDataError(result.error || 'Failed to reload project data.');
      }
      return result;
    } finally {
      setIsSyncingProjectData(false);
    }
  }, [selectedProjectId, getProject, user, showToast]);

  /**
   * Internal helper to persist `dataUpdates` via `PATCH /api/projects/:id/data`
   * with duplicate-submission protection and HTTP 409 conflict handling.
   */
  const persistProjectDataToBackend = useCallback(
    async (dataUpdates, options = {}) => {
      if (!selectedProjectId) {
        return {
          ok: false,
          status: 400,
          isConflict: false,
          error: 'No active project selected.',
        };
      }

      if (syncLockRef.current && !options.allowConcurrent) {
        return {
          ok: false,
          status: 429,
          isConflict: false,
          isDuplicateSubmission: true,
          error: 'Another save operation is already in progress.',
        };
      }

      syncLockRef.current = true;
      setIsSyncingProjectData(true);
      setProjectDataError(null);
      setProjectDataConflict(null);

      try {
        const result = await updateProjectData(
          selectedProjectId,
          dataUpdates,
          options
        );

        if (!result.ok) {
          if (result.isConflict) {
            setProjectDataConflict({
              isConflict: true,
              projectId: selectedProjectId,
              currentUpdatedAt: result.currentUpdatedAt || null,
              expectedUpdatedAt: result.expectedUpdatedAt || null,
              message:
                result.error ||
                'Conflict: This project was modified in another session. Reload to get the latest changes.',
            });
          }
          setProjectDataError(
            result.error || 'Failed to save changes to server.'
          );
          return result;
        }

        return result;
      } finally {
        syncLockRef.current = false;
        setIsSyncingProjectData(false);
      }
    },
    [selectedProjectId, updateProjectData]
  );

  // =========================================================================
  // 1. TEST PLAN MANAGEMENT (Phase 2C)
  // =========================================================================

  const saveTestPlan = useCallback(
    async (planUpdates = {}, options = {}) => {
      if (!selectedProjectId || !selectedProject) {
        return { ok: false, status: 400, error: 'No active project selected.' };
      }

      if (
        !planUpdates ||
        typeof planUpdates !== 'object' ||
        Array.isArray(planUpdates)
      ) {
        return {
          ok: false,
          status: 400,
          error: 'Test plan updates must be a valid object.',
        };
      }

      const currentPlan = buildDefaultTestPlan({
        ...selectedProject,
        testPlan: testPlanRef.current,
      });

      if (planUpdates.name !== undefined) {
        if (
          typeof planUpdates.name !== 'string' ||
          planUpdates.name.trim() === ''
        ) {
          const errMsg = 'Test plan name is required and cannot be empty.';
          setProjectDataError(errMsg);
          return { ok: false, status: 400, error: errMsg };
        }
      }

      const nowIso = new Date().toISOString();
      const sanitizedUpdates = {};
      Object.keys(planUpdates).forEach((key) => {
        const val = planUpdates[key];
        if (val === undefined) return;
        if (typeof val === 'string') {
          sanitizedUpdates[key] = val.trim();
        } else {
          sanitizedUpdates[key] = val;
        }
      });

      const nextPlan = {
        ...currentPlan,
        ...sanitizedUpdates,
        id:
          sanitizedUpdates.id ||
          currentPlan.id ||
          `plan_${selectedProjectId}`,
        name:
          sanitizedUpdates.name !== undefined
            ? sanitizedUpdates.name
            : currentPlan.name || `${selectedProject.name} Master Test Plan`,
        phases: Array.isArray(sanitizedUpdates.phases)
          ? sanitizedUpdates.phases
          : Array.isArray(currentPlan.phases)
          ? currentPlan.phases
          : [],
        updatedAt: nowIso,
      };

      const previousPlan = testPlanRef.current;
      testPlanRef.current = nextPlan;
      setTestPlan(nextPlan);

      const result = await persistProjectDataToBackend(
        { testPlan: nextPlan },
        options
      );

      if (!result.ok) {
        testPlanRef.current = previousPlan;
        setTestPlan(previousPlan);
        showToast(result.error || 'Failed to save test plan', 'danger');
        return result;
      }

      const persistedPlan =
        (result.project && result.project.testPlan) || nextPlan;
      testPlanRef.current = persistedPlan;
      setTestPlan(persistedPlan);

      appendActivity(
        'testplan',
        `Updated Test Plan "${persistedPlan.name}"`,
        persistedPlan.objective || 'Test plan details saved to server.'
      );
      if (!options.silentToast) {
        showToast('Test Plan saved', 'success');
      }

      return {
        ...result,
        testPlan: persistedPlan,
      };
    },
    [
      selectedProjectId,
      selectedProject,
      persistProjectDataToBackend,
      appendActivity,
      showToast,
    ]
  );

  const addTestPlanPhase = useCallback(
    async ({ name, description } = {}, options = {}) => {
      const trimmedName = typeof name === 'string' ? name.trim() : '';
      if (!trimmedName) {
        const errMsg = 'Phase name is required.';
        setProjectDataError(errMsg);
        return { ok: false, status: 400, error: errMsg };
      }

      const currentPlan = buildDefaultTestPlan({
        ...(selectedProject || {}),
        testPlan: testPlanRef.current,
      });
      const existingPhases = Array.isArray(currentPlan.phases)
        ? [...currentPlan.phases]
        : [];
      const nowIso = new Date().toISOString();
      const newPhase = {
        id: `ph_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: trimmedName,
        description: typeof description === 'string' ? description.trim() : '',
        order: existingPhases.length + 1,
        status: 'Active',
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      const nextPhases = [...existingPhases, newPhase];
      const res = await saveTestPlan(
        { phases: nextPhases },
        { ...options, silentToast: true }
      );
      if (res.ok) {
        showToast(`Added phase "${newPhase.name}"`, 'success');
      }
      return { ...res, phase: res.ok ? newPhase : null };
    },
    [selectedProject, saveTestPlan, showToast]
  );

  const updateTestPlanPhase = useCallback(
    async (phaseId, updates = {}, options = {}) => {
      const cleanPhaseId = typeof phaseId === 'string' ? phaseId.trim() : '';
      if (!cleanPhaseId) {
        return { ok: false, status: 400, error: 'Phase ID is required.' };
      }
      if (
        updates.name !== undefined &&
        (typeof updates.name !== 'string' || !updates.name.trim())
      ) {
        const errMsg = 'Phase name cannot be empty.';
        setProjectDataError(errMsg);
        return { ok: false, status: 400, error: errMsg };
      }

      const currentPlan = buildDefaultTestPlan({
        ...(selectedProject || {}),
        testPlan: testPlanRef.current,
      });
      const existingPhases = Array.isArray(currentPlan.phases)
        ? [...currentPlan.phases]
        : [];
      const idx = existingPhases.findIndex((p) => p.id === cleanPhaseId);
      if (idx === -1) {
        return { ok: false, status: 404, error: 'Testing phase not found.' };
      }

      const nowIso = new Date().toISOString();
      const updatedPhase = {
        ...existingPhases[idx],
        name:
          updates.name !== undefined
            ? updates.name.trim()
            : existingPhases[idx].name,
        description:
          updates.description !== undefined
            ? String(updates.description || '').trim()
            : existingPhases[idx].description,
        status: updates.status || existingPhases[idx].status || 'Active',
        updatedAt: nowIso,
      };
      existingPhases[idx] = updatedPhase;

      const res = await saveTestPlan(
        { phases: existingPhases },
        { ...options, silentToast: true }
      );
      if (res.ok) {
        showToast(`Updated phase "${updatedPhase.name}"`, 'success');
      }
      return { ...res, phase: res.ok ? updatedPhase : null };
    },
    [selectedProject, saveTestPlan, showToast]
  );

  const deleteTestPlanPhase = useCallback(
    async (phaseId, options = {}) => {
      const cleanPhaseId = typeof phaseId === 'string' ? phaseId.trim() : '';
      if (!cleanPhaseId) {
        return { ok: false, status: 400, error: 'Phase ID is required.' };
      }

      const currentPlan = buildDefaultTestPlan({
        ...(selectedProject || {}),
        testPlan: testPlanRef.current,
      });
      const existingPhases = Array.isArray(currentPlan.phases)
        ? currentPlan.phases
        : [];
      const targetPhase = existingPhases.find((p) => p.id === cleanPhaseId);
      if (!targetPhase) {
        return { ok: false, status: 404, error: 'Testing phase not found.' };
      }

      const nowIso = new Date().toISOString();
      const nextPhases = existingPhases
        .filter((p) => p.id !== cleanPhaseId)
        .map((p, idx) => ({ ...p, order: idx + 1 }));
      const nextPlan = {
        ...currentPlan,
        phases: nextPhases,
        updatedAt: nowIso,
      };

      const prevPlan = testPlanRef.current;
      const prevSuites = suitesRef.current;
      const nextSuites = prevSuites.map((s) =>
        s.phaseId === cleanPhaseId
          ? { ...s, phaseId: null, updatedAt: nowIso }
          : s
      );

      testPlanRef.current = nextPlan;
      suitesRef.current = nextSuites;
      setTestPlan(nextPlan);
      setSuites(nextSuites);

      const { testSuites, summaryCounts } = buildBackendTestSuitesPayload(
        nextSuites,
        testCasesRef.current
      );

      const result = await persistProjectDataToBackend(
        {
          testPlan: nextPlan,
          testSuites,
          ...summaryCounts,
        },
        options
      );

      if (!result.ok) {
        testPlanRef.current = prevPlan;
        suitesRef.current = prevSuites;
        setTestPlan(prevPlan);
        setSuites(prevSuites);
        showToast(result.error || 'Failed to delete phase', 'danger');
        return result;
      }

      showToast(`Deleted phase "${targetPhase.name}"`, 'info');
      return result;
    },
    [selectedProject, persistProjectDataToBackend, showToast]
  );

  // =========================================================================
  // 2. TEST SUITE MANAGEMENT (Phase 2C)
  // =========================================================================

  const createSuite = useCallback(
    async (
      { name, description, category, phaseId, tags } = {},
      options = {}
    ) => {
      const trimmedName = typeof name === 'string' ? name.trim() : '';
      if (!trimmedName) {
        const errMsg = 'Test suite name is required.';
        setProjectDataError(errMsg);
        return { ok: false, status: 400, suite: null, error: errMsg };
      }

      const nowIso = new Date().toISOString();
      const newSuite = {
        id: `suite-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        phaseId: phaseId || null,
        name: trimmedName,
        category:
          typeof category === 'string' && category.trim()
            ? category.trim()
            : 'Functional',
        tags: Array.isArray(tags)
          ? tags.filter((t) => typeof t === 'string').map((t) => t.trim())
          : [],
        description: typeof description === 'string' ? description.trim() : '',
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      const prevSuites = suitesRef.current;
      const nextSuites = [...prevSuites, newSuite];
      suitesRef.current = nextSuites;
      setSuites(nextSuites);

      const { testSuites, summaryCounts } = buildBackendTestSuitesPayload(
        nextSuites,
        testCasesRef.current
      );

      const result = await persistProjectDataToBackend(
        {
          testSuites,
          ...summaryCounts,
        },
        options
      );

      if (!result.ok) {
        suitesRef.current = prevSuites;
        setSuites(prevSuites);
        showToast(result.error || 'Failed to create suite', 'danger');
        return { ...result, suite: null };
      }

      appendActivity(
        'suite',
        `Created suite "${newSuite.name}"`,
        newSuite.description || `Category: ${newSuite.category}`
      );
      showToast(`Test Suite "${newSuite.name}" created`, 'success');
      return { ...result, suite: newSuite };
    },
    [persistProjectDataToBackend, appendActivity, showToast]
  );

  const updateSuite = useCallback(
    async (suiteId, updates = {}, options = {}) => {
      const cleanId = typeof suiteId === 'string' ? suiteId.trim() : '';
      if (!cleanId) {
        return {
          ok: false,
          status: 400,
          suite: null,
          error: 'Suite ID is required.',
        };
      }

      const prevSuites = suitesRef.current;
      const existingSuite = prevSuites.find((s) => s.id === cleanId);
      if (!existingSuite) {
        return {
          ok: false,
          status: 404,
          suite: null,
          error: 'Test suite not found.',
        };
      }

      if (
        updates.name !== undefined &&
        (typeof updates.name !== 'string' || !updates.name.trim())
      ) {
        const errMsg = 'Test suite name cannot be empty.';
        setProjectDataError(errMsg);
        return { ok: false, status: 400, suite: null, error: errMsg };
      }

      const nowIso = new Date().toISOString();
      const updatedSuite = {
        ...existingSuite,
        name:
          updates.name !== undefined
            ? updates.name.trim()
            : existingSuite.name,
        description:
          updates.description !== undefined
            ? String(updates.description || '').trim()
            : existingSuite.description,
        category:
          updates.category !== undefined && String(updates.category).trim()
            ? String(updates.category).trim()
            : existingSuite.category || 'Functional',
        phaseId:
          updates.phaseId !== undefined
            ? updates.phaseId || null
            : existingSuite.phaseId || null,
        tags: Array.isArray(updates.tags)
          ? updates.tags
              .filter((t) => typeof t === 'string')
              .map((t) => t.trim())
          : existingSuite.tags || [],
        updatedAt: nowIso,
      };

      const nextSuites = prevSuites.map((s) =>
        s.id === cleanId ? updatedSuite : s
      );
      const prevCases = testCasesRef.current;
      const nextCases = prevCases.map((tc) =>
        tc.suiteId === cleanId
          ? { ...tc, suiteName: updatedSuite.name, updatedAt: formatTimestamp() }
          : tc
      );

      suitesRef.current = nextSuites;
      testCasesRef.current = nextCases;
      setSuites(nextSuites);
      setTestCases(nextCases);

      const { testSuites, summaryCounts } = buildBackendTestSuitesPayload(
        nextSuites,
        nextCases
      );

      const result = await persistProjectDataToBackend(
        {
          testSuites,
          ...summaryCounts,
        },
        options
      );

      if (!result.ok) {
        suitesRef.current = prevSuites;
        testCasesRef.current = prevCases;
        setSuites(prevSuites);
        setTestCases(prevCases);
        showToast(result.error || 'Failed to update suite', 'danger');
        return { ...result, suite: null };
      }

      appendActivity(
        'suite',
        `Updated suite "${updatedSuite.name}"`,
        updatedSuite.description || `Category: ${updatedSuite.category}`
      );
      showToast(`Updated suite "${updatedSuite.name}"`, 'success');
      return { ...result, suite: updatedSuite };
    },
    [persistProjectDataToBackend, appendActivity, showToast]
  );

  const deleteSuite = useCallback(
    async (suiteId, options = {}) => {
      const cleanId = typeof suiteId === 'string' ? suiteId.trim() : '';
      const prevSuites = suitesRef.current;
      const target = prevSuites.find((s) => s.id === cleanId);
      if (!target) {
        return { ok: false, status: 404, error: 'Test suite not found.' };
      }

      const { moveCasesToSuiteId, ...requestOptions } = options || {};
      const nextSuites = prevSuites.filter((s) => s.id !== cleanId);
      const prevCases = testCasesRef.current;
      const prevRuns = testRunsRef.current;
      const prevDefects = defectsRef.current;

      let nextCases;
      let nextRuns = prevRuns;
      let nextDefects = prevDefects;
      let destinationSuite = null;
      if (moveCasesToSuiteId && moveCasesToSuiteId !== cleanId) {
        destinationSuite = nextSuites.find((s) => s.id === moveCasesToSuiteId);
      }

      if (destinationSuite) {
        const now = formatTimestamp();
        nextCases = prevCases.map((tc) =>
          tc.suiteId === cleanId
            ? {
                ...tc,
                suiteId: destinationSuite.id,
                suiteName: destinationSuite.name,
                updatedAt: now,
              }
            : tc
        );
      } else {
        const removedCaseIds = new Set(
          prevCases.filter((tc) => tc.suiteId === cleanId).map((tc) => tc.id)
        );
        nextCases = prevCases.filter((tc) => tc.suiteId !== cleanId);
        if (removedCaseIds.size > 0) {
          nextRuns = prevRuns.map((run) => {
            const filteredResults = run.results.filter(
              (r) => !removedCaseIds.has(r.testCaseId)
            );
            return {
              ...run,
              results: filteredResults,
              metrics: computeRunMetrics(filteredResults),
            };
          });
          nextDefects = prevDefects.map((bug) =>
            removedCaseIds.has(bug.linkedTestCaseId)
              ? { ...bug, linkedTestCaseId: null }
              : bug
          );
          if (selectedTestCaseId && removedCaseIds.has(selectedTestCaseId)) {
            setSelectedTestCaseId(null);
          }
        }
      }

      suitesRef.current = nextSuites;
      testCasesRef.current = nextCases;
      testRunsRef.current = nextRuns;
      defectsRef.current = nextDefects;
      setSuites(nextSuites);
      setTestCases(nextCases);
      setTestRuns(nextRuns);
      setDefects(nextDefects);

      const { testSuites, summaryCounts } = buildBackendTestSuitesPayload(
        nextSuites,
        nextCases
      );
      const { executionRuns, activeRun } = buildBackendExecutionsAndRunsPayload(
        nextRuns,
        executionsRef.current
      );
      const { defects: serializedDefects, defectSummaryCounts } =
        buildBackendDefectsPayload(nextDefects);

      const result = await persistProjectDataToBackend(
        {
          testSuites,
          executionRuns,
          activeRun,
          defects: serializedDefects,
          ...summaryCounts,
          ...defectSummaryCounts,
        },
        requestOptions
      );

      if (!result.ok) {
        suitesRef.current = prevSuites;
        testCasesRef.current = prevCases;
        testRunsRef.current = prevRuns;
        defectsRef.current = prevDefects;
        setSuites(prevSuites);
        setTestCases(prevCases);
        setTestRuns(prevRuns);
        setDefects(prevDefects);
        showToast(result.error || 'Failed to delete suite', 'danger');
        return result;
      }

      appendActivity(
        'suite',
        `Deleted suite "${target.name}"`,
        destinationSuite
          ? `Moved cases to "${destinationSuite.name}".`
          : 'Suite removed from project workspace.'
      );
      showToast(`Deleted suite "${target.name}"`, 'info');
      return result;
    },
    [
      selectedTestCaseId,
      persistProjectDataToBackend,
      appendActivity,
      showToast,
    ]
  );

  // =========================================================================
  // 3. TEST CASE MANAGEMENT (Phase 2C)
  // =========================================================================

  const createTestCase = useCallback(
    async (
      {
        suiteId,
        title,
        description,
        preconditions,
        priority,
        testType,
        category,
        tags,
        steps,
        expectedResult,
        status,
        lastStatus,
      } = {},
      options = {}
    ) => {
      const trimmedTitle = typeof title === 'string' ? title.trim() : '';
      if (!trimmedTitle) {
        const errMsg = 'Test case title is required.';
        setProjectDataError(errMsg);
        return { ok: false, status: 400, testCase: null, error: errMsg };
      }

      const prevSuites = suitesRef.current;
      const prevCases = testCasesRef.current;

      const maxNum = prevCases.reduce((max, tc) => {
        const m = String(tc.id || tc.testCaseId || '').match(/TC-(\d+)/i);
        return m ? Math.max(max, parseInt(m[1], 10)) : max;
      }, 100);
      const newId = `TC-${maxNum + 1}`;
      const now = formatTimestamp();
      const nowIso = new Date().toISOString();

      let nextSuites = prevSuites;
      let suiteObj =
        prevSuites.find((s) => s.id === suiteId) || prevSuites[0] || null;

      if (!suiteObj) {
        suiteObj = {
          id: suiteId || `suite-${Date.now()}`,
          phaseId: null,
          name: 'General QA Suite',
          category: 'Functional',
          tags: [],
          description: 'Default test suite',
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        nextSuites = [suiteObj];
      }

      const formattedSteps = (Array.isArray(steps) ? steps : [])
        .map((st, idx) => normalizeTestStep(st, idx))
        .filter((st) => st.action);

      const resolvedType =
        (typeof testType === 'string' && testType.trim()) ||
        (typeof category === 'string' && category.trim()) ||
        'Functional';

      const resolvedLastStatus = normalizeCaseLastStatus(lastStatus || status);

      const newCase = {
        id: newId,
        testCaseId: newId,
        suiteId: suiteObj.id,
        suiteName: suiteObj.name,
        title: trimmedTitle,
        description: typeof description === 'string' ? description.trim() : '',
        preconditions:
          typeof preconditions === 'string' && preconditions.trim()
            ? preconditions.trim()
            : 'Standard application state.',
        priority: priority || 'P1',
        category: resolvedType,
        testType: resolvedType,
        tags: Array.isArray(tags)
          ? tags.filter((t) => typeof t === 'string').map((t) => t.trim())
          : [],
        steps:
          formattedSteps.length > 0
            ? formattedSteps
            : [
                {
                  id: `step-${Date.now()}-0`,
                  stepNumber: 1,
                  action: 'Execute feature workflow as described.',
                  testData: '',
                  expectedResult:
                    typeof expectedResult === 'string' && expectedResult.trim()
                      ? expectedResult.trim()
                      : 'Expected behavior verified.',
                },
              ],
        expectedResult:
          typeof expectedResult === 'string' && expectedResult.trim()
            ? expectedResult.trim()
            : 'All test steps pass without error.',
        status: toBackendCaseStatus(resolvedLastStatus),
        lastStatus: resolvedLastStatus,
        lastExecution: null,
        createdAt: now,
        updatedAt: now,
      };

      const nextCases = [newCase, ...prevCases];
      suitesRef.current = nextSuites;
      testCasesRef.current = nextCases;
      setSuites(nextSuites);
      setTestCases(nextCases);

      const { testSuites, summaryCounts } = buildBackendTestSuitesPayload(
        nextSuites,
        nextCases
      );

      const result = await persistProjectDataToBackend(
        {
          testSuites,
          ...summaryCounts,
        },
        options
      );

      if (!result.ok) {
        suitesRef.current = prevSuites;
        testCasesRef.current = prevCases;
        setSuites(prevSuites);
        setTestCases(prevCases);
        showToast(result.error || 'Failed to create test case', 'danger');
        return { ...result, testCase: null };
      }

      appendActivity(
        'testcase',
        `Created ${newId}: ${newCase.title}`,
        `Suite: ${newCase.suiteName} · Priority: ${newCase.priority}`
      );
      showToast(`Created test case ${newId}`, 'success');
      return { ...result, testCase: newCase };
    },
    [persistProjectDataToBackend, appendActivity, showToast]
  );

  const updateTestCase = useCallback(
    async (testCaseId, updates = {}, options = {}) => {
      const cleanCaseId =
        typeof testCaseId === 'string' ? testCaseId.trim() : '';
      const prevCases = testCasesRef.current;
      const existingCase = prevCases.find((tc) => tc.id === cleanCaseId);
      if (!existingCase) {
        return {
          ok: false,
          status: 404,
          testCase: null,
          error: 'Test case not found.',
        };
      }

      if (
        updates.title !== undefined &&
        (typeof updates.title !== 'string' || !updates.title.trim())
      ) {
        const errMsg = 'Test case title cannot be empty.';
        setProjectDataError(errMsg);
        return { ok: false, status: 400, testCase: null, error: errMsg };
      }

      const now = formatTimestamp();
      const currentSuites = suitesRef.current;
      const suiteObj = updates.suiteId
        ? currentSuites.find((s) => s.id === updates.suiteId)
        : currentSuites.find((s) => s.id === existingCase.suiteId);

      const nextSteps = Array.isArray(updates.steps)
        ? updates.steps
            .map((st, idx) => normalizeTestStep(st, idx))
            .filter((st) => st.action)
        : existingCase.steps;

      const resolvedType =
        (typeof updates.testType === 'string' && updates.testType.trim()) ||
        (typeof updates.category === 'string' && updates.category.trim()) ||
        existingCase.testType ||
        existingCase.category ||
        'Functional';

      const resolvedLastStatus =
        updates.lastStatus !== undefined || updates.status !== undefined
          ? normalizeCaseLastStatus(updates.lastStatus || updates.status)
          : existingCase.lastStatus;

      const updatedCase = {
        ...existingCase,
        ...updates,
        title:
          updates.title !== undefined
            ? updates.title.trim()
            : existingCase.title,
        description:
          updates.description !== undefined
            ? String(updates.description || '').trim()
            : existingCase.description,
        preconditions:
          updates.preconditions !== undefined
            ? String(updates.preconditions || '').trim() ||
              'Standard application state.'
            : existingCase.preconditions,
        expectedResult:
          updates.expectedResult !== undefined
            ? String(updates.expectedResult || '').trim() ||
              'All test steps pass without error.'
            : existingCase.expectedResult,
        suiteId: suiteObj
          ? suiteObj.id
          : updates.suiteId || existingCase.suiteId,
        suiteName: suiteObj
          ? suiteObj.name
          : updates.suiteName || existingCase.suiteName,
        category: resolvedType,
        testType: resolvedType,
        tags: Array.isArray(updates.tags)
          ? updates.tags
              .filter((t) => typeof t === 'string')
              .map((t) => t.trim())
          : existingCase.tags || [],
        steps: nextSteps.length > 0 ? nextSteps : existingCase.steps,
        status: toBackendCaseStatus(resolvedLastStatus),
        lastStatus: resolvedLastStatus,
        updatedAt: now,
      };

      const nextCases = prevCases.map((tc) =>
        tc.id === cleanCaseId ? updatedCase : tc
      );
      testCasesRef.current = nextCases;
      setTestCases(nextCases);

      const { testSuites, summaryCounts } = buildBackendTestSuitesPayload(
        currentSuites,
        nextCases
      );

      const result = await persistProjectDataToBackend(
        {
          testSuites,
          ...summaryCounts,
        },
        options
      );

      if (!result.ok) {
        testCasesRef.current = prevCases;
        setTestCases(prevCases);
        showToast(result.error || 'Failed to update test case', 'danger');
        return { ...result, testCase: null };
      }

      appendActivity(
        'testcase',
        `Updated test case ${cleanCaseId}`,
        updatedCase.title || 'Test case details modified.'
      );
      if (!options.silentToast) {
        showToast(`Updated ${cleanCaseId}`, 'success');
      }
      return { ...result, testCase: updatedCase };
    },
    [persistProjectDataToBackend, appendActivity, showToast]
  );

  const moveTestCaseToSuite = useCallback(
    async (testCaseId, targetSuiteId, options = {}) => {
      const cleanCaseId =
        typeof testCaseId === 'string' ? testCaseId.trim() : '';
      const cleanSuiteId =
        typeof targetSuiteId === 'string' ? targetSuiteId.trim() : '';

      const targetSuite = suitesRef.current.find((s) => s.id === cleanSuiteId);
      if (!targetSuite) {
        const errMsg = 'Target test suite not found.';
        setProjectDataError(errMsg);
        return { ok: false, status: 404, testCase: null, error: errMsg };
      }

      const res = await updateTestCase(
        cleanCaseId,
        {
          suiteId: targetSuite.id,
          suiteName: targetSuite.name,
        },
        { ...options, silentToast: true }
      );

      if (res.ok) {
        showToast(`Moved ${cleanCaseId} to "${targetSuite.name}"`, 'success');
      }
      return res;
    },
    [updateTestCase, showToast]
  );

  const deleteTestCase = useCallback(
    async (testCaseId, options = {}) => {
      const cleanCaseId =
        typeof testCaseId === 'string' ? testCaseId.trim() : '';
      const prevCases = testCasesRef.current;
      const target = prevCases.find((tc) => tc.id === cleanCaseId);
      if (!target) {
        return { ok: false, status: 404, error: 'Test case not found.' };
      }

      const prevRuns = testRunsRef.current;
      const prevDefects = defectsRef.current;

      const nextCases = prevCases.filter((tc) => tc.id !== cleanCaseId);
      const nextRuns = prevRuns.map((run) => {
        const nextResults = run.results.filter(
          (r) => r.testCaseId !== cleanCaseId && r.caseId !== cleanCaseId
        );
        return {
          ...run,
          results: nextResults,
          metrics: computeRunMetrics(nextResults),
        };
      });
      const nextDefects = prevDefects.map((bug) =>
        bug.linkedTestCaseId === cleanCaseId
          ? { ...bug, linkedTestCaseId: null }
          : bug
      );

      testCasesRef.current = nextCases;
      testRunsRef.current = nextRuns;
      defectsRef.current = nextDefects;
      setTestCases(nextCases);
      setTestRuns(nextRuns);
      setDefects(nextDefects);

      if (selectedTestCaseId === cleanCaseId) {
        setSelectedTestCaseId(null);
      }

      const { testSuites, summaryCounts } = buildBackendTestSuitesPayload(
        suitesRef.current,
        nextCases
      );
      const { executionRuns, activeRun } = buildBackendExecutionsAndRunsPayload(
        nextRuns,
        executionsRef.current
      );
      const { defects: serializedDefects, defectSummaryCounts } =
        buildBackendDefectsPayload(nextDefects);

      const result = await persistProjectDataToBackend(
        {
          testSuites,
          executionRuns,
          activeRun,
          defects: serializedDefects,
          ...summaryCounts,
          ...defectSummaryCounts,
        },
        options
      );

      if (!result.ok) {
        testCasesRef.current = prevCases;
        testRunsRef.current = prevRuns;
        defectsRef.current = prevDefects;
        setTestCases(prevCases);
        setTestRuns(prevRuns);
        setDefects(prevDefects);
        showToast(result.error || 'Failed to delete test case', 'danger');
        return result;
      }

      appendActivity(
        'testcase',
        `Deleted test case ${cleanCaseId}`,
        target.title || 'Removed from repository.'
      );
      showToast(`Deleted ${cleanCaseId}`, 'info');
      return result;
    },
    [
      selectedTestCaseId,
      persistProjectDataToBackend,
      appendActivity,
      showToast,
    ]
  );

  // =========================================================================
  // 4. TEST RUNS & EXECUTION MANAGEMENT (Phase 2D)
  // =========================================================================

  /**
   * Creates a new Test Run with selected test cases and persists via `PATCH /api/projects/:id/data`.
   */
  const createTestRun = useCallback(
    async (
      {
        name,
        suiteId,
        buildVersion,
        deviceInfo,
        environment,
        tester,
        notes,
        testCaseIds,
      } = {},
      options = {}
    ) => {
      const trimmedName = typeof name === 'string' ? name.trim() : '';
      if (!trimmedName) {
        const errMsg = 'Test Run name is required.';
        setProjectDataError(errMsg);
        return { ok: false, status: 400, testRun: null, error: errMsg };
      }

      const prevRuns = testRunsRef.current;
      const currentCases = testCasesRef.current;
      const currentSuites = suitesRef.current;

      let includedCases = currentCases;
      let suiteLabel = 'All Suites';
      const resolvedSuiteId = suiteId || 'all';

      if (resolvedSuiteId && resolvedSuiteId !== 'all') {
        const suiteObj = currentSuites.find((s) => s.id === resolvedSuiteId);
        if (suiteObj) {
          suiteLabel = suiteObj.name;
          includedCases = currentCases.filter(
            (tc) => tc.suiteId === resolvedSuiteId
          );
        }
      }
      if (Array.isArray(testCaseIds) && testCaseIds.length > 0) {
        const idSet = new Set(testCaseIds);
        includedCases = currentCases.filter((tc) => idSet.has(tc.id));
      }

      if (includedCases.length === 0) {
        const errMsg =
          'Select at least one test case to include in the Test Run.';
        setProjectDataError(errMsg);
        return { ok: false, status: 400, testRun: null, error: errMsg };
      }

      const maxNum = prevRuns.reduce((max, r) => {
        const m = String(r.id || '').match(/RUN-(\d+)/i);
        return m ? Math.max(max, parseInt(m[1], 10)) : max;
      }, 200);
      const newId = `RUN-${maxNum + 1}`;
      const now = formatTimestamp();
      const nowIso = new Date().toISOString();

      const resolvedBuild = (
        buildVersion ||
        (selectedProject && selectedProject.version) ||
        profile.defaultBuild ||
        '1.0.0'
      ).trim();
      const resolvedDevice = (
        deviceInfo ||
        profile.defaultDevice ||
        'Android Device'
      ).trim();
      const resolvedEnv = (
        environment ||
        (selectedProject && selectedProject.environment) ||
        'Staging'
      ).trim();
      const resolvedTester = (
        tester ||
        (user && user.name) ||
        profile.testerName ||
        'QA Engineer'
      ).trim();

      const results = includedCases.map((tc) => ({
        testCaseId: tc.id,
        caseId: tc.id,
        caseTitle: tc.title,
        suiteId: tc.suiteId,
        suiteName: tc.suiteName,
        status: 'Untested',
        outcome: 'Not Run',
        actualResult: '',
        notes: '',
        tester: resolvedTester,
        environment: resolvedEnv,
        device: resolvedDevice,
        buildVersion: resolvedBuild,
        stepStatuses: {},
        executedAt: null,
        linkedDefectId: null,
      }));

      const newRun = {
        id: newId,
        name: trimmedName,
        suiteId: resolvedSuiteId,
        suiteName: suiteLabel,
        buildVersion: resolvedBuild,
        deviceInfo: resolvedDevice,
        environment: resolvedEnv,
        tester: resolvedTester,
        notes: typeof notes === 'string' ? notes.trim() : '',
        status: 'In Progress',
        startedAt: nowIso,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
        metrics: computeRunMetrics(results),
        results,
      };

      const nextRuns = [newRun, ...prevRuns];
      testRunsRef.current = nextRuns;
      setTestRuns(nextRuns);
      setSelectedTestRunId(newRun.id);

      const { executionRuns, activeRun, executions: serializedExecs } =
        buildBackendExecutionsAndRunsPayload(nextRuns, executionsRef.current);

      const result = await persistProjectDataToBackend(
        {
          executionRuns,
          activeRun,
          executions: serializedExecs,
        },
        options
      );

      if (!result.ok) {
        testRunsRef.current = prevRuns;
        setTestRuns(prevRuns);
        showToast(result.error || 'Failed to create test run', 'danger');
        return { ...result, testRun: null };
      }

      appendActivity(
        'execution',
        `Created Test Run ${newId}: ${newRun.name}`,
        `${results.length} test cases queued on ${newRun.deviceInfo}`
      );
      showToast(`Created ${newId} with ${results.length} test cases`, 'success');
      return { ...result, testRun: newRun };
    },
    [
      selectedProject,
      profile,
      user,
      persistProjectDataToBackend,
      appendActivity,
      showToast,
    ]
  );

  /**
   * Updates an existing Test Run's metadata or status (`In Progress` | `Completed`)
   * and persists via `PATCH /api/projects/:id/data`.
   */
  const updateTestRun = useCallback(
    async (testRunId, updates = {}, options = {}) => {
      const cleanRunId =
        typeof testRunId === 'string' ? testRunId.trim() : '';
      const prevRuns = testRunsRef.current;
      const existingRun = prevRuns.find((r) => r.id === cleanRunId);
      if (!existingRun) {
        return {
          ok: false,
          status: 404,
          testRun: null,
          error: 'Test run not found.',
        };
      }

      if (
        updates.name !== undefined &&
        (typeof updates.name !== 'string' || !updates.name.trim())
      ) {
        const errMsg = 'Test Run name cannot be empty.';
        setProjectDataError(errMsg);
        return { ok: false, status: 400, testRun: null, error: errMsg };
      }

      const now = formatTimestamp();
      const nowIso = new Date().toISOString();
      const nextStatus =
        updates.status === 'Completed'
          ? 'Completed'
          : updates.status === 'In Progress'
          ? 'In Progress'
          : existingRun.status;

      const currentSuites = suitesRef.current;
      const currentCases = testCasesRef.current;
      const nextSuiteId =
        updates.suiteId !== undefined ? updates.suiteId : existingRun.suiteId;
      let nextSuiteName = existingRun.suiteName || 'All Suites';
      if (nextSuiteId && nextSuiteId !== 'all' && nextSuiteId !== 'ALL') {
        const matchedSuite = currentSuites.find((s) => s.id === nextSuiteId);
        if (matchedSuite) nextSuiteName = matchedSuite.name;
      } else {
        nextSuiteName = 'All Suites';
      }

      let nextResults = existingRun.results || [];
      if (Array.isArray(updates.testCaseIds) && updates.testCaseIds.length > 0) {
        const existingMap = new Map(
          nextResults.map((r) => [r.testCaseId || r.caseId, r])
        );
        const idSet = new Set(updates.testCaseIds);
        const selectedCases = currentCases.filter((tc) => idSet.has(tc.id));
        nextResults = selectedCases.map((tc) => {
          const prevRes = existingMap.get(tc.id);
          if (prevRes) {
            return {
              ...prevRes,
              caseTitle: tc.title,
              suiteId: tc.suiteId,
              suiteName: tc.suiteName,
            };
          }
          return {
            testCaseId: tc.id,
            caseId: tc.id,
            caseTitle: tc.title,
            suiteId: tc.suiteId,
            suiteName: tc.suiteName,
            status: 'Untested',
            outcome: 'Not Run',
            actualResult: '',
            notes: '',
            tester: existingRun.tester || 'QA Engineer',
            environment: existingRun.environment || 'Staging',
            device: existingRun.deviceInfo || 'Android Device',
            buildVersion: existingRun.buildVersion || '1.0.0',
            stepStatuses: {},
            executedAt: null,
            linkedDefectId: null,
          };
        });
      }

      const updatedRun = {
        ...existingRun,
        name:
          updates.name !== undefined ? updates.name.trim() : existingRun.name,
        suiteId: nextSuiteId,
        suiteName: nextSuiteName,
        buildVersion:
          updates.buildVersion !== undefined
            ? String(updates.buildVersion || '').trim()
            : existingRun.buildVersion,
        deviceInfo:
          updates.deviceInfo !== undefined
            ? String(updates.deviceInfo || '').trim()
            : existingRun.deviceInfo,
        environment:
          updates.environment !== undefined
            ? String(updates.environment || '').trim()
            : existingRun.environment,
        tester:
          updates.tester !== undefined
            ? String(updates.tester || '').trim()
            : existingRun.tester,
        notes:
          updates.notes !== undefined
            ? String(updates.notes || '').trim()
            : existingRun.notes,
        status: nextStatus,
        completedAt:
          nextStatus === 'Completed'
            ? existingRun.completedAt || nowIso
            : null,
        updatedAt: now,
        results: nextResults,
        metrics: computeRunMetrics(nextResults),
      };

      const nextRuns = prevRuns.map((r) =>
        r.id === cleanRunId ? updatedRun : r
      );
      testRunsRef.current = nextRuns;
      setTestRuns(nextRuns);

      const { executionRuns, activeRun, executions: serializedExecs } =
        buildBackendExecutionsAndRunsPayload(nextRuns, executionsRef.current);

      const result = await persistProjectDataToBackend(
        {
          executionRuns,
          activeRun,
          executions: serializedExecs,
        },
        options
      );

      if (!result.ok) {
        testRunsRef.current = prevRuns;
        setTestRuns(prevRuns);
        showToast(result.error || 'Failed to update test run', 'danger');
        return { ...result, testRun: null };
      }

      appendActivity(
        'execution',
        `Updated Test Run ${cleanRunId}`,
        `Status: ${updatedRun.status} · ${updatedRun.name}`
      );
      showToast(`Updated ${cleanRunId}`, 'success');
      return { ...result, testRun: updatedRun };
    },
    [persistProjectDataToBackend, appendActivity, showToast]
  );

  /**
   * Completes a Test Run (`status: 'Completed'`), matching `completeExecutionRun` in Qavora Web.
   */
  const completeTestRun = useCallback(
    async (testRunId, options = {}) => {
      return updateTestRun(testRunId, { status: 'Completed' }, options);
    },
    [updateTestRun]
  );

  /**
   * Reopens a completed Test Run (`status: 'In Progress'`).
   */
  const reopenTestRun = useCallback(
    async (testRunId, options = {}) => {
      return updateTestRun(testRunId, { status: 'In Progress' }, options);
    },
    [updateTestRun]
  );

  /**
   * Records or updates a Test Case execution result inside a Test Run (or standalone),
   * appends/updates `executions` history, updates `testCase.lastStatus` & `lastExecution`,
   * and persists atomically via `PATCH /api/projects/:id/data`.
   */
  const recordTestExecution = useCallback(
    async (
      {
        testRunId,
        testCaseId,
        status,
        actualResult,
        notes,
        tester,
        environment,
        device,
        buildVersion,
        stepStatuses,
        linkedDefectId,
      } = {},
      options = {}
    ) => {
      const cleanCaseId =
        typeof testCaseId === 'string' ? testCaseId.trim() : '';
      if (!cleanCaseId) {
        return {
          ok: false,
          status: 400,
          error: 'Test case ID is required to record execution.',
        };
      }

      const normStatus = normalizeCaseLastStatus(status);
      const webOutcome = toWebExecutionOutcome(normStatus);
      const now = formatTimestamp();
      const nowIso = new Date().toISOString();

      const prevRuns = testRunsRef.current;
      const prevCases = testCasesRef.current;
      const prevExecs = executionsRef.current;

      const targetRun = testRunId
        ? prevRuns.find((r) => r.id === testRunId)
        : prevRuns[0] || null;
      const targetCase = prevCases.find((tc) => tc.id === cleanCaseId);

      const resolvedTester =
        (typeof tester === 'string' && tester.trim()) ||
        (targetRun && targetRun.tester) ||
        (user && user.name) ||
        profile.testerName ||
        'QA Engineer';
      const resolvedEnv =
        (typeof environment === 'string' && environment.trim()) ||
        (targetRun && targetRun.environment) ||
        (selectedProject && selectedProject.environment) ||
        'Staging';
      const resolvedDevice =
        (typeof device === 'string' && device.trim()) ||
        (targetRun && targetRun.deviceInfo) ||
        profile.defaultDevice ||
        'Android Device';
      const resolvedBuild =
        (typeof buildVersion === 'string' && buildVersion.trim()) ||
        (targetRun && targetRun.buildVersion) ||
        (selectedProject && selectedProject.version) ||
        profile.defaultBuild ||
        '1.0.0';

      const resolvedActualResult =
        actualResult !== undefined
          ? String(actualResult).trim()
          : normStatus === 'Passed'
          ? 'Expected result verified.'
          : normStatus === 'Untested'
          ? ''
          : `Status recorded as ${webOutcome}.`;

      // 1. Update target Test Run results & metrics
      const nextRuns = prevRuns.map((run) => {
        if (!targetRun || run.id !== targetRun.id) return run;
        const caseExistsInRun = run.results.some(
          (res) => res.testCaseId === cleanCaseId || res.caseId === cleanCaseId
        );
        let updatedResults;
        if (caseExistsInRun) {
          updatedResults = run.results.map((res) => {
            if (res.testCaseId !== cleanCaseId && res.caseId !== cleanCaseId) {
              return res;
            }
            return {
              ...res,
              status: normStatus,
              outcome: webOutcome,
              actualResult:
                actualResult !== undefined
                  ? resolvedActualResult
                  : res.actualResult,
              notes:
                notes !== undefined ? String(notes).trim() : res.notes || '',
              tester: resolvedTester,
              environment: resolvedEnv,
              device: resolvedDevice,
              buildVersion: resolvedBuild,
              stepStatuses:
                stepStatuses && typeof stepStatuses === 'object'
                  ? stepStatuses
                  : res.stepStatuses || {},
              executedAt: normStatus === 'Untested' ? null : now,
              linkedDefectId:
                linkedDefectId !== undefined
                  ? linkedDefectId
                  : res.linkedDefectId,
            };
          });
        } else {
          updatedResults = [
            ...run.results,
            {
              testCaseId: cleanCaseId,
              caseId: cleanCaseId,
              caseTitle: targetCase ? targetCase.title : cleanCaseId,
              suiteId: targetCase ? targetCase.suiteId : '',
              suiteName: targetCase ? targetCase.suiteName : run.suiteName,
              status: normStatus,
              outcome: webOutcome,
              actualResult: resolvedActualResult,
              notes: notes ? String(notes).trim() : '',
              tester: resolvedTester,
              environment: resolvedEnv,
              device: resolvedDevice,
              buildVersion: resolvedBuild,
              stepStatuses:
                stepStatuses && typeof stepStatuses === 'object'
                  ? stepStatuses
                  : {},
              executedAt: normStatus === 'Untested' ? null : now,
              linkedDefectId: linkedDefectId || null,
            },
          ];
        }

        const allTested =
          updatedResults.length > 0 &&
          updatedResults.every(
            (r) => normalizeCaseLastStatus(r.status) !== 'Untested'
          );

        return {
          ...run,
          status: allTested ? 'Completed' : 'In Progress',
          completedAt: allTested ? run.completedAt || nowIso : null,
          updatedAt: now,
          metrics: computeRunMetrics(updatedResults),
          results: updatedResults,
        };
      });

      // 2. Append execution record to `executions` history
      const execRecord = {
        id: `exec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        runId: targetRun ? targetRun.id : null,
        runName: targetRun ? targetRun.name : 'Standalone Execution',
        caseId: cleanCaseId,
        testCaseId: cleanCaseId,
        caseTitle: targetCase ? targetCase.title : cleanCaseId,
        suiteId: targetCase ? targetCase.suiteId : '',
        suiteName: targetCase ? targetCase.suiteName : 'All Suites',
        status: webOutcome,
        outcome: webOutcome,
        normalizedStatus: normStatus,
        actualResult: resolvedActualResult,
        notes: notes ? String(notes).trim() : '',
        tester: resolvedTester,
        environment: resolvedEnv,
        device: resolvedDevice,
        buildVersion: resolvedBuild,
        stepStatuses:
          stepStatuses && typeof stepStatuses === 'object' ? stepStatuses : {},
        linkedDefectId: linkedDefectId || null,
        executedAt: nowIso,
      };
      const nextExecs = [execRecord, ...prevExecs];

      // 3. Sync `lastStatus`, `status`, and `lastExecution` on the corresponding TestCase
      const nextCases = prevCases.map((tc) =>
        tc.id === cleanCaseId
          ? {
              ...tc,
              status: toBackendCaseStatus(normStatus),
              lastStatus: normStatus,
              lastExecution: {
                status: webOutcome,
                actualResult: resolvedActualResult,
                executedAt: nowIso,
                tester: resolvedTester,
                runId: targetRun ? targetRun.id : null,
              },
              updatedAt: now,
            }
          : tc
      );

      testRunsRef.current = nextRuns;
      executionsRef.current = nextExecs;
      testCasesRef.current = nextCases;
      setTestRuns(nextRuns);
      setExecutions(nextExecs);
      setTestCases(nextCases);

      const { testSuites, summaryCounts } = buildBackendTestSuitesPayload(
        suitesRef.current,
        nextCases
      );
      const {
        executionRuns,
        activeRun,
        executions: serializedExecs,
      } = buildBackendExecutionsAndRunsPayload(nextRuns, nextExecs);

      const result = await persistProjectDataToBackend(
        {
          testSuites,
          executionRuns,
          activeRun,
          executions: serializedExecs,
          ...summaryCounts,
        },
        options
      );

      if (!result.ok) {
        testRunsRef.current = prevRuns;
        executionsRef.current = prevExecs;
        testCasesRef.current = prevCases;
        setTestRuns(prevRuns);
        setExecutions(prevExecs);
        setTestCases(prevCases);
        showToast(result.error || 'Failed to save execution result', 'danger');
        return { ...result, execution: null };
      }

      appendActivity(
        'execution',
        `Executed ${cleanCaseId}${targetRun ? ` in ${targetRun.id}` : ''} → ${normStatus}`,
        resolvedActualResult || `Marked as ${normStatus}`
      );
      if (!options.silentToast) {
        showToast(
          `${cleanCaseId} marked as ${normStatus}`,
          normStatus === 'Failed' ? 'danger' : 'success'
        );
      }

      return {
        ...result,
        execution: execRecord,
      };
    },
    [
      user,
      profile,
      selectedProject,
      persistProjectDataToBackend,
      appendActivity,
      showToast,
    ]
  );

  /**
   * Deletes a Test Run, unlinks any `linkedTestRunId` on defects, and persists via `PATCH /api/projects/:id/data`.
   */
  const deleteTestRun = useCallback(
    async (testRunId, options = {}) => {
      const cleanRunId =
        typeof testRunId === 'string' ? testRunId.trim() : '';
      const prevRuns = testRunsRef.current;
      const target = prevRuns.find((r) => r.id === cleanRunId);
      if (!target) {
        return { ok: false, status: 404, error: 'Test run not found.' };
      }

      const prevDefects = defectsRef.current;
      const nextRuns = prevRuns.filter((r) => r.id !== cleanRunId);
      const nextDefects = prevDefects.map((bug) =>
        bug.linkedTestRunId === cleanRunId
          ? { ...bug, linkedTestRunId: null }
          : bug
      );

      testRunsRef.current = nextRuns;
      defectsRef.current = nextDefects;
      setTestRuns(nextRuns);
      setDefects(nextDefects);

      if (selectedTestRunId === cleanRunId) {
        setSelectedTestRunId(nextRuns[0]?.id || null);
      }

      const { executionRuns, activeRun, executions: serializedExecs } =
        buildBackendExecutionsAndRunsPayload(nextRuns, executionsRef.current);
      const { defects: serializedDefects, defectSummaryCounts } =
        buildBackendDefectsPayload(nextDefects);

      const result = await persistProjectDataToBackend(
        {
          executionRuns,
          activeRun,
          executions: serializedExecs,
          defects: serializedDefects,
          ...defectSummaryCounts,
        },
        options
      );

      if (!result.ok) {
        testRunsRef.current = prevRuns;
        defectsRef.current = prevDefects;
        setTestRuns(prevRuns);
        setDefects(prevDefects);
        showToast(result.error || 'Failed to delete test run', 'danger');
        return result;
      }

      appendActivity(
        'execution',
        `Deleted Test Run ${cleanRunId}`,
        target.name || 'Removed test run.'
      );
      showToast(`Deleted ${cleanRunId}`, 'info');
      return result;
    },
    [
      selectedTestRunId,
      persistProjectDataToBackend,
      appendActivity,
      showToast,
    ]
  );

  // =========================================================================
  // 5. DEFECT MANAGEMENT (Phase 2D)
  // =========================================================================

  /**
   * Creates a new Defect report, links it to any specified `linkedTestCaseId`
   * and `linkedTestRunId`, and persists via `PATCH /api/projects/:id/data`.
   */
  const createDefect = useCallback(
    async (
      {
        title,
        description,
        severity,
        priority,
        status,
        steps,
        reproductionSteps,
        expectedResult,
        actualResult,
        environment,
        externalUrl,
        linkedTestCaseId,
        linkedTestRunId,
        linkedExecutionId,
      } = {},
      options = {}
    ) => {
      const trimmedTitle = typeof title === 'string' ? title.trim() : '';
      if (!trimmedTitle) {
        const errMsg = 'Defect title is required.';
        setProjectDataError(errMsg);
        return { ok: false, status: 400, defect: null, error: errMsg };
      }

      const stepsText = (
        (typeof reproductionSteps === 'string' && reproductionSteps.trim()) ||
        (typeof steps === 'string' && steps.trim()) ||
        ''
      ).trim();

      const actualText =
        typeof actualResult === 'string' ? actualResult.trim() : '';

      const prevDefects = defectsRef.current;
      const prevRuns = testRunsRef.current;
      const prevExecs = executionsRef.current;
      const currentCases = testCasesRef.current;

      const maxNum = prevDefects.reduce((max, bug) => {
        const m = String(bug.defectId || bug.id || '').match(
          /(?:DEF|BUG)-(\d+)/i
        );
        return m ? Math.max(max, parseInt(m[1], 10)) : max;
      }, 300);
      const newId = `BUG-${maxNum + 1}`;
      const defectDisplayId = `DEF-${String(prevDefects.length + 1).padStart(
        3,
        '0'
      )}`;
      const now = formatTimestamp();

      const matchedTc = linkedTestCaseId
        ? currentCases.find(
            (c) =>
              c.id === linkedTestCaseId || c.testCaseId === linkedTestCaseId
          )
        : null;

      const resolvedSeverity = DEFECT_SEVERITIES.includes(severity)
        ? severity
        : 'High';
      const resolvedPriority = DEFECT_PRIORITIES.includes(priority)
        ? priority
        : resolvedSeverity;
      const resolvedStatus = DEFECT_STATUSES.includes(status)
        ? status
        : 'Open';

      const newDefect = {
        id: newId,
        defectId: defectDisplayId,
        title: trimmedTitle,
        description:
          typeof description === 'string' ? description.trim() : '',
        severity: resolvedSeverity,
        priority: resolvedPriority,
        status: resolvedStatus,
        steps: stepsText,
        reproductionSteps: stepsText,
        expectedResult:
          typeof expectedResult === 'string' ? expectedResult.trim() : '',
        actualResult: actualText,
        environment:
          (typeof environment === 'string' && environment.trim()) ||
          (selectedProject && selectedProject.environment) ||
          `${profile.defaultDevice} · Build ${profile.defaultBuild}`,
        externalUrl:
          typeof externalUrl === 'string' ? externalUrl.trim() : '',
        linkedTestCaseId: linkedTestCaseId || null,
        linkedCaseTitle: matchedTc ? matchedTc.title : '',
        linkedTestRunId: linkedTestRunId || null,
        linkedExecutionId: linkedExecutionId || null,
        createdAt: now,
        updatedAt: now,
      };

      const nextDefects = [newDefect, ...prevDefects];
      let nextRuns = prevRuns;
      let nextExecs = prevExecs;

      if (linkedTestCaseId) {
        nextRuns = prevRuns.map((run) => {
          if (linkedTestRunId && run.id !== linkedTestRunId) return run;
          const hasCase = run.results.some(
            (r) =>
              r.testCaseId === linkedTestCaseId ||
              r.caseId === linkedTestCaseId
          );
          if (!hasCase) return run;
          return {
            ...run,
            results: run.results.map((r) =>
              r.testCaseId === linkedTestCaseId ||
              r.caseId === linkedTestCaseId
                ? { ...r, linkedDefectId: newId }
                : r
            ),
          };
        });

        nextExecs = prevExecs.map((ex) => {
          if (
            (ex.testCaseId === linkedTestCaseId ||
              ex.caseId === linkedTestCaseId) &&
            (!linkedTestRunId || ex.runId === linkedTestRunId)
          ) {
            return { ...ex, linkedDefectId: newId };
          }
          return ex;
        });
      }

      defectsRef.current = nextDefects;
      testRunsRef.current = nextRuns;
      executionsRef.current = nextExecs;
      setDefects(nextDefects);
      setTestRuns(nextRuns);
      setExecutions(nextExecs);

      const { defects: serializedDefects, defectSummaryCounts } =
        buildBackendDefectsPayload(nextDefects);
      const {
        executionRuns,
        activeRun,
        executions: serializedExecs,
      } = buildBackendExecutionsAndRunsPayload(nextRuns, nextExecs);

      const result = await persistProjectDataToBackend(
        {
          defects: serializedDefects,
          executionRuns,
          activeRun,
          executions: serializedExecs,
          ...defectSummaryCounts,
        },
        options
      );

      if (!result.ok) {
        defectsRef.current = prevDefects;
        testRunsRef.current = prevRuns;
        executionsRef.current = prevExecs;
        setDefects(prevDefects);
        setTestRuns(prevRuns);
        setExecutions(prevExecs);
        showToast(result.error || 'Failed to create defect', 'danger');
        return { ...result, defect: null };
      }

      appendActivity(
        'defect',
        `Logged ${newId} (${newDefect.severity}): ${newDefect.title}`,
        linkedTestCaseId
          ? `Linked to ${linkedTestCaseId}${
              linkedTestRunId ? ` in ${linkedTestRunId}` : ''
            }`
          : 'Standalone defect report'
      );
      showToast(`Created defect ${newId}`, 'success');
      return { ...result, defect: newDefect };
    },
    [
      selectedProject,
      profile,
      persistProjectDataToBackend,
      appendActivity,
      showToast,
    ]
  );

  /**
   * Updates an existing Defect report and persists via `PATCH /api/projects/:id/data`.
   */
  const updateDefect = useCallback(
    async (defectId, updates = {}, options = {}) => {
      const cleanId = typeof defectId === 'string' ? defectId.trim() : '';
      const prevDefects = defectsRef.current;
      const existingDefect = prevDefects.find(
        (b) => b.id === cleanId || b.defectId === cleanId
      );
      if (!existingDefect) {
        return {
          ok: false,
          status: 404,
          defect: null,
          error: 'Defect not found.',
        };
      }

      if (
        updates.title !== undefined &&
        (typeof updates.title !== 'string' || !updates.title.trim())
      ) {
        const errMsg = 'Defect title cannot be empty.';
        setProjectDataError(errMsg);
        return { ok: false, status: 400, defect: null, error: errMsg };
      }

      const now = formatTimestamp();
      const currentCases = testCasesRef.current;
      const nextLinkedCaseId =
        updates.linkedTestCaseId !== undefined
          ? updates.linkedTestCaseId || null
          : existingDefect.linkedTestCaseId;
      const matchedTc = nextLinkedCaseId
        ? currentCases.find(
            (c) =>
              c.id === nextLinkedCaseId || c.testCaseId === nextLinkedCaseId
          )
        : null;

      const nextStepsText =
        updates.reproductionSteps !== undefined
          ? String(updates.reproductionSteps || '').trim()
          : updates.steps !== undefined
          ? String(updates.steps || '').trim()
          : existingDefect.reproductionSteps || existingDefect.steps || '';

      const updatedDefect = {
        ...existingDefect,
        ...updates,
        title:
          updates.title !== undefined
            ? updates.title.trim()
            : existingDefect.title,
        description:
          updates.description !== undefined
            ? String(updates.description || '').trim()
            : existingDefect.description,
        severity:
          updates.severity && DEFECT_SEVERITIES.includes(updates.severity)
            ? updates.severity
            : existingDefect.severity,
        priority:
          updates.priority && DEFECT_PRIORITIES.includes(updates.priority)
            ? updates.priority
            : existingDefect.priority || existingDefect.severity,
        status:
          updates.status && DEFECT_STATUSES.includes(updates.status)
            ? updates.status
            : existingDefect.status,
        steps: nextStepsText,
        reproductionSteps: nextStepsText,
        expectedResult:
          updates.expectedResult !== undefined
            ? String(updates.expectedResult || '').trim()
            : existingDefect.expectedResult,
        actualResult:
          updates.actualResult !== undefined
            ? String(updates.actualResult || '').trim()
            : existingDefect.actualResult,
        environment:
          updates.environment !== undefined
            ? String(updates.environment || '').trim()
            : existingDefect.environment,
        externalUrl:
          updates.externalUrl !== undefined
            ? String(updates.externalUrl || '').trim()
            : existingDefect.externalUrl || '',
        linkedTestCaseId: nextLinkedCaseId,
        linkedCaseTitle: matchedTc ? matchedTc.title : '',
        linkedTestRunId:
          updates.linkedTestRunId !== undefined
            ? updates.linkedTestRunId || null
            : existingDefect.linkedTestRunId,
        updatedAt: now,
      };

      const nextDefects = prevDefects.map((bug) =>
        bug.id === existingDefect.id ? updatedDefect : bug
      );

      // Sync linkedDefectId on run results if linkedTestCaseId changed
      const prevRuns = testRunsRef.current;
      const nextRuns = prevRuns.map((run) => ({
        ...run,
        results: run.results.map((r) => {
          if (
            nextLinkedCaseId &&
            (r.testCaseId === nextLinkedCaseId || r.caseId === nextLinkedCaseId) &&
            (!updatedDefect.linkedTestRunId ||
              run.id === updatedDefect.linkedTestRunId)
          ) {
            return { ...r, linkedDefectId: existingDefect.id };
          }
          if (
            r.linkedDefectId === existingDefect.id &&
            r.testCaseId !== nextLinkedCaseId
          ) {
            return { ...r, linkedDefectId: null };
          }
          return r;
        }),
      }));

      defectsRef.current = nextDefects;
      testRunsRef.current = nextRuns;
      setDefects(nextDefects);
      setTestRuns(nextRuns);

      const { defects: serializedDefects, defectSummaryCounts } =
        buildBackendDefectsPayload(nextDefects);
      const {
        executionRuns,
        activeRun,
        executions: serializedExecs,
      } = buildBackendExecutionsAndRunsPayload(
        nextRuns,
        executionsRef.current
      );

      const result = await persistProjectDataToBackend(
        {
          defects: serializedDefects,
          executionRuns,
          activeRun,
          executions: serializedExecs,
          ...defectSummaryCounts,
        },
        options
      );

      if (!result.ok) {
        defectsRef.current = prevDefects;
        testRunsRef.current = prevRuns;
        setDefects(prevDefects);
        setTestRuns(prevRuns);
        showToast(result.error || 'Failed to update defect', 'danger');
        return { ...result, defect: null };
      }

      appendActivity(
        'defect',
        `Updated ${existingDefect.id}`,
        updates.status
          ? `Status: ${updates.status}`
          : 'Defect details updated.'
      );
      showToast(`Updated ${existingDefect.id}`, 'success');
      return { ...result, defect: updatedDefect };
    },
    [persistProjectDataToBackend, appendActivity, showToast]
  );

  /**
   * Deletes a Defect report, unlinks `linkedDefectId` from all test runs and
   * execution history records, and persists via `PATCH /api/projects/:id/data`.
   */
  const deleteDefect = useCallback(
    async (defectId, options = {}) => {
      const cleanId = typeof defectId === 'string' ? defectId.trim() : '';
      const prevDefects = defectsRef.current;
      const target = prevDefects.find(
        (b) => b.id === cleanId || b.defectId === cleanId
      );
      if (!target) {
        return { ok: false, status: 404, error: 'Defect not found.' };
      }

      const prevRuns = testRunsRef.current;
      const prevExecs = executionsRef.current;

      const nextDefects = prevDefects.filter((b) => b.id !== target.id);
      const nextRuns = prevRuns.map((run) => ({
        ...run,
        results: run.results.map((r) =>
          r.linkedDefectId === target.id ||
          r.linkedDefectId === target.defectId
            ? { ...r, linkedDefectId: null }
            : r
        ),
      }));
      const nextExecs = prevExecs.map((ex) =>
        ex.linkedDefectId === target.id ||
        ex.linkedDefectId === target.defectId
          ? { ...ex, linkedDefectId: null }
          : ex
      );

      defectsRef.current = nextDefects;
      testRunsRef.current = nextRuns;
      executionsRef.current = nextExecs;
      setDefects(nextDefects);
      setTestRuns(nextRuns);
      setExecutions(nextExecs);

      if (
        selectedDefectId === target.id ||
        selectedDefectId === target.defectId
      ) {
        setSelectedDefectId(null);
      }

      const { defects: serializedDefects, defectSummaryCounts } =
        buildBackendDefectsPayload(nextDefects);
      const {
        executionRuns,
        activeRun,
        executions: serializedExecs,
      } = buildBackendExecutionsAndRunsPayload(nextRuns, nextExecs);

      const result = await persistProjectDataToBackend(
        {
          defects: serializedDefects,
          executionRuns,
          activeRun,
          executions: serializedExecs,
          ...defectSummaryCounts,
        },
        options
      );

      if (!result.ok) {
        defectsRef.current = prevDefects;
        testRunsRef.current = prevRuns;
        executionsRef.current = prevExecs;
        setDefects(prevDefects);
        setTestRuns(prevRuns);
        setExecutions(prevExecs);
        showToast(result.error || 'Failed to delete defect', 'danger');
        return result;
      }

      appendActivity(
        'defect',
        `Deleted defect ${target.id}`,
        target.title || ''
      );
      showToast(`Deleted ${target.id}`, 'info');
      return result;
    },
    [
      selectedDefectId,
      persistProjectDataToBackend,
      appendActivity,
      showToast,
    ]
  );

  // Cross-module shortcut: Jump from failed test execution to Defects tab with pre-filled defect modal
  const startDefectFromFailedTest = useCallback(
    ({ testRun, testCase, actualResult, notes, executionId }) => {
      const stepsText = (testCase.steps || [])
        .map((s, idx) => `${s.stepNumber || idx + 1}. ${s.action}`)
        .join('\n');

      const defaultSeverity =
        testCase.priority === 'P0' || testCase.priority === 'Critical'
          ? 'Critical'
          : 'High';

      setDraftDefectFromExecution({
        title: `[${testCase.testCaseId || testCase.id}] Failure: ${
          testCase.title
        }`,
        description: notes || testCase.description || '',
        severity: defaultSeverity,
        priority: defaultSeverity,
        status: 'Open',
        reproductionSteps:
          stepsText || 'Execute steps defined in linked test case.',
        expectedResult: testCase.expectedResult || '',
        actualResult: actualResult || 'Test execution failed.',
        environment: testRun
          ? `${testRun.deviceInfo} · Build ${testRun.buildVersion}`
          : `${profile.defaultDevice} · Build ${profile.defaultBuild}`,
        linkedTestCaseId: testCase.id,
        linkedCaseTitle: testCase.title,
        linkedTestRunId: testRun ? testRun.id : null,
        linkedExecutionId: executionId || null,
      });
      setProjectViewMode('workspace');
      setActiveTab('defects');
    },
    [profile]
  );

  // Profile & Storage Management
  const updateProfile = (updates) => {
    setProfile((prev) => ({ ...prev, ...updates }));
    appendActivity(
      'settings',
      'Updated local QA profile & project settings',
      updates.projectName || ''
    );
    showToast('Saved local QA settings', 'success');
  };

  const resetToSampleData = async () => {
    setProfile((prev) => ({
      ...INITIAL_PROFILE,
      projectName:
        (selectedProject && selectedProject.name) ||
        prev.projectName ||
        INITIAL_PROFILE.projectName,
      targetVersion:
        (selectedProject && selectedProject.version) ||
        prev.targetVersion ||
        INITIAL_PROFILE.targetVersion,
    }));
    setSuites(INITIAL_SUITES);
    setTestCases(INITIAL_TEST_CASES);
    setTestRuns(INITIAL_TEST_RUNS);
    setExecutions([]);
    setDefects(INITIAL_DEFECTS);
    setActivityLog(INITIAL_ACTIVITY);
    setSelectedTestCaseId(null);
    setSelectedTestRunId(null);
    setSelectedDefectId(null);

    if (selectedProjectId) {
      const { testSuites, summaryCounts } = buildBackendTestSuitesPayload(
        INITIAL_SUITES,
        INITIAL_TEST_CASES
      );
      const { executionRuns, activeRun, executions: serializedExecs } =
        buildBackendExecutionsAndRunsPayload(INITIAL_TEST_RUNS, []);
      const { defects: serializedDefects, defectSummaryCounts } =
        buildBackendDefectsPayload(INITIAL_DEFECTS);

      await persistProjectDataToBackend({
        testSuites,
        executionRuns,
        activeRun,
        executions: serializedExecs,
        defects: serializedDefects,
        ...summaryCounts,
        ...defectSummaryCounts,
      });
    }
    showToast('Restored sample QA dataset for active project', 'info');
  };

  const clearAllWorkspaceData = async () => {
    const defaultSuites = [
      {
        id: 'suite-default',
        name: 'General Suite',
        category: 'Functional',
        tags: [],
        description: 'Default test suite',
      },
    ];
    setSuites(defaultSuites);
    setTestCases([]);
    setTestRuns([]);
    setExecutions([]);
    setDefects([]);
    setActivityLog([
      {
        id: `act-${Date.now()}`,
        category: 'settings',
        title: 'Cleared project local QA data',
        detail: 'Project workspace reset to empty state.',
        timestamp: formatTimestamp(),
      },
    ]);
    setSelectedTestCaseId(null);
    setSelectedTestRunId(null);
    setSelectedDefectId(null);

    if (selectedProjectId) {
      const { testSuites, summaryCounts } = buildBackendTestSuitesPayload(
        defaultSuites,
        []
      );
      const { defects: serializedDefects, defectSummaryCounts } =
        buildBackendDefectsPayload([]);
      await persistProjectDataToBackend({
        testSuites,
        executionRuns: [],
        activeRun: null,
        executions: [],
        defects: serializedDefects,
        ...summaryCounts,
        ...defectSummaryCounts,
      });
    }
    showToast('Cleared test cases, runs, and defects for this project', 'info');
  };

  // --- Genuine Dynamic QA Metrics (Phase 2E parity with Qavora Web) ---
  const metrics = useMemo(() => {
    return computeProjectDashboardMetrics({
      project: selectedProject,
      testPlan,
      suites,
      testCases,
      testRuns,
      executions,
      defects,
    });
  }, [selectedProject, testPlan, suites, testCases, testRuns, executions, defects]);

  // --- Read-Only Project Report Generation & Export (Phase 2E) ---
  const generateReport = useCallback(
    (filters = {}) => {
      return generateProjectReport(
        {
          project: selectedProject,
          testPlan: testPlanRef.current,
          suites: suitesRef.current,
          testCases: testCasesRef.current,
          testRuns: testRunsRef.current,
          executions: executionsRef.current,
          defects: defectsRef.current,
        },
        filters
      );
    },
    [selectedProject]
  );

  const exportReport = useCallback(
    async (filters = {}, format = 'json', options = {}) => {
      const report =
        filters && filters.generatedAt && filters.kpis
          ? filters
          : generateReport(filters);
      const res = await exportGeneratedReport(report, format, options);
      if (res.ok && !options.silentToast) {
        showToast(
          `Exported ${res.formatLabel} (${res.filename})`,
          'success'
        );
      } else if (!res.ok && !options.silentToast) {
        showToast(res.error || 'Failed to export report', 'danger');
      }
      return { ...res, report };
    },
    [generateReport, showToast]
  );

  const value = {
    activeProject: selectedProject,
    activeProjectId: selectedProjectId,
    isStorageHydrated,
    lastPersistedAt,
    isSyncingProjectData,
    projectDataError,
    projectDataConflict,
    clearProjectDataError,
    reloadProjectDataFromBackend,
    profile,
    testPlan,
    suites,
    suiteCategories: SUITE_CATEGORIES,
    testCases,
    testRuns,
    executions,
    defects,
    activityLog,
    metrics,
    reportTypes: REPORT_TYPES,
    dateRangeFilters: DATE_RANGE_FILTERS,
    exportFormats: EXPORT_FORMATS,
    generateReport,
    exportReport,
    priorities: PRIORITIES,
    testTypes: TEST_TYPES,
    executionStatuses: EXECUTION_STATUSES,
    webExecutionOutcomes: WEB_EXECUTION_OUTCOMES,
    defectSeverities: DEFECT_SEVERITIES,
    defectPriorities: DEFECT_PRIORITIES,
    defectStatuses: DEFECT_STATUSES,
    activeTab,
    setActiveTab,
    dashboardSubTab,
    setDashboardSubTab,
    projectViewMode,
    setProjectViewMode,
    openProjectSelection,
    openProjectDetails,
    openWorkspace,
    openDashboardOverview,
    openReportsView,
    selectedTestCaseId,
    setSelectedTestCaseId,
    selectedTestRunId,
    setSelectedTestRunId,
    selectedDefectId,
    setSelectedDefectId,
    draftDefectFromExecution,
    setDraftDefectFromExecution,
    saveTestPlan,
    addTestPlanPhase,
    updateTestPlanPhase,
    deleteTestPlanPhase,
    createSuite,
    updateSuite,
    deleteSuite,
    createTestCase,
    updateTestCase,
    moveTestCaseToSuite,
    deleteTestCase,
    createTestRun,
    updateTestRun,
    completeTestRun,
    reopenTestRun,
    recordTestExecution,
    deleteTestRun,
    createDefect,
    updateDefect,
    deleteDefect,
    startDefectFromFailedTest,
    updateProfile,
    resetToSampleData,
    clearAllWorkspaceData,
    toast,
    showToast,
    dismissToast: () => setToast(null),
  };

  return React.createElement(
    WorkspaceContext.Provider,
    { value },
    children
  );
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider');
  }
  return context;
}

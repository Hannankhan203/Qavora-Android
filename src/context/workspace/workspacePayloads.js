import {
  buildDefaultTestPlan,
  extractSuiteTestCases,
} from '../../services/projectService.js';
import {
  INITIAL_PROFILE,
  DEFECT_SEVERITIES,
  DEFECT_PRIORITIES,
  DEFECT_STATUSES,
} from '../../data/initialData.js';
import {
  formatTimestamp,
  normalizeCaseLastStatus,
  toBackendCaseStatus,
  toWebExecutionOutcome,
  computeRunMetrics,
  normalizeTestStep,
} from './workspaceConstants.js';

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
 * @param {object | null} [options]
 */
export function buildProjectWorkspaceState(
  selectedProject,
  persistedSnapshot = null,
  currentUser = null,
  options = {}
) {
  const { preferSnapshot = false } = options || {};
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
  const seenBackendCaseIds = new Set();
  rawSuites.forEach((s, suiteIdx) => {
    const suiteId = String((s && (s.id || s._id)) || `suite-${suiteIdx + 1}`);
    const suiteName = (s && s.name) || `Suite ${suiteIdx + 1}`;
    const rawCases = extractSuiteTestCases(s);
    rawCases.forEach((tc, tcIdx) => {
      if (!tc || typeof tc !== 'object') return;
      const caseId = String(
        tc.id || tc.testCaseId || `TC-${suiteIdx + 1}${tcIdx + 1}`
      );
      if (seenBackendCaseIds.has(caseId)) return;
      seenBackendCaseIds.add(caseId);
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

  // Authoritative backend data takes precedence whenever `selectedProject.updatedAt`
  // is present UNLESS the persisted local snapshot holds unsaved/dirty edits or is
  // explicitly preferred (e.g., queued offline mutations awaiting sync).
  const useLocalFallbackOnly =
    hasValidSnapshot &&
    (!selectedProject.updatedAt ||
      Boolean(persistedSnapshot.isDirty) ||
      Boolean(preferSnapshot));

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

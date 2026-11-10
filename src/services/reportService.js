import { shareOrDownloadFile } from './dataManagementService.js';
import { extractSuiteTestCases } from './projectService.js';

/**
 * Supported Report Types in Qavora Android Phase 2E,
 * aligned with Qavora Web's `src/modules/reportsManager.js` and `dashboardManager.js`.
 */
export const REPORT_TYPES = [
  {
    id: 'project_summary',
    label: 'Project QA Summary',
    shortLabel: 'QA Summary',
    description:
      'Executive QA overview with health status, KPIs, coverage insights, phase progress, and defect triage.',
  },
  {
    id: 'execution_summary',
    label: 'Test Execution Summary',
    shortLabel: 'Executions',
    description:
      'Execution verdict breakdown (Passed, Failed, Blocked, Skipped, Not Run), daily timeline, and chronological log.',
  },
  {
    id: 'case_status',
    label: 'Test Case & Suite Coverage',
    shortLabel: 'Cases & Suites',
    description:
      'Test case status distribution, priority breakdown, test plan phase coverage, and suite quality metrics.',
  },
  {
    id: 'test_runs',
    label: 'Test Run Cycles Report',
    shortLabel: 'Test Runs',
    description:
      'Test run execution cycles (In Progress & Completed) with build, device, environment, and pass rate breakdown.',
  },
  {
    id: 'defect_summary',
    label: 'Defect Summary & Triage',
    shortLabel: 'Defects',
    description:
      'Defect distribution by severity and workflow status, resolution rate, and detailed defect log.',
  },
];

/**
 * Supported Date Range Filters in Qavora Web (`reportsManager.js`).
 */
export const DATE_RANGE_FILTERS = [
  { id: 'ALL', label: 'All Time' },
  { id: '7D', label: 'Last 7 Days' },
  { id: '30D', label: 'Last 30 Days' },
  { id: '90D', label: 'Last 90 Days' },
  { id: 'CUSTOM', label: 'Custom Range' },
];

/**
 * Supported Export Formats for Phase 2E.
 */
export const EXPORT_FORMATS = [
  {
    id: 'json',
    label: 'JSON Data',
    extension: 'json',
    mimeType: 'application/json',
  },
  {
    id: 'csv',
    label: 'CSV Spreadsheet',
    extension: 'csv',
    mimeType: 'text/csv',
  },
  {
    id: 'markdown',
    label: 'QA Report Summary (MD/Text)',
    extension: 'md',
    mimeType: 'text/markdown',
  },
];

/**
 * Parses a date string from Qavora Web or Android (`ISO-8601` or `YYYY-MM-DD HH:mm`) into a Date instance.
 */
export function parseQavoraDate(dateString) {
  if (!dateString || typeof dateString !== 'string') return null;
  const trimmed = dateString.trim();
  if (!trimmed) return null;

  // Normalize "YYYY-MM-DD HH:mm" to "YYYY-MM-DDTHH:mm:00" for consistent parsing across JS engines
  const normalized = /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}$/.test(trimmed)
    ? `${trimmed.replace(/\s+/, 'T')}:00`
    : trimmed;

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    const fallback = new Date(trimmed);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }
  return parsed;
}

/**
 * Checks whether a timestamp falls within the selected date range filter,
 * matching Qavora Web's `isWithinDateRange(dateString, filterType, customStart, customEnd)`.
 */
export function isWithinDateRange(
  dateString,
  filterType = 'ALL',
  customStart = '',
  customEnd = '',
  referenceNow = null
) {
  if (!filterType || filterType === 'ALL') return true;
  const d = parseQavoraDate(dateString);
  if (!d) return true; // Keep records without timestamps unless explicitly out of range

  const now = referenceNow instanceof Date ? referenceNow : new Date();

  if (filterType === '7D') {
    const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return d >= cutoff && d <= now;
  }
  if (filterType === '30D') {
    const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    return d >= cutoff && d <= now;
  }
  if (filterType === '90D') {
    const cutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    return d >= cutoff && d <= now;
  }
  if (filterType === 'CUSTOM') {
    if (customStart && typeof customStart === 'string' && customStart.trim()) {
      const start = parseQavoraDate(customStart.trim());
      if (start) {
        start.setHours(0, 0, 0, 0);
        if (d < start) return false;
      }
    }
    if (customEnd && typeof customEnd === 'string' && customEnd.trim()) {
      const end = parseQavoraDate(customEnd.trim());
      if (end) {
        end.setHours(23, 59, 59, 999);
        if (d > end) return false;
      }
    }
    return true;
  }

  return true;
}

/**
 * Normalizes a test case status into canonical UI verdict (`Passed`, `Failed`, `Blocked`, `Untested`).
 */
export function normalizeCaseVerdict(tc) {
  if (!tc || typeof tc !== 'object') return 'Untested';
  const raw = String(tc.lastStatus || tc.status || '')
    .trim()
    .toUpperCase();
  if (raw === 'PASSED' || raw === 'PASS') return 'Passed';
  if (raw === 'FAILED' || raw === 'FAIL') return 'Failed';
  if (raw === 'BLOCKED') return 'Blocked';
  return 'Untested';
}

/**
 * Normalizes an execution log entry's status into canonical Qavora Web verdict
 * (`PASSED`, `FAILED`, `BLOCKED`, `SKIPPED`, `NOT_RUN`).
 */
export function normalizeExecutionVerdict(ex) {
  if (!ex || typeof ex !== 'object') return 'NOT_RUN';
  const raw = String(ex.status || ex.outcome || '')
    .trim()
    .toUpperCase();
  if (raw === 'PASSED' || raw === 'PASS') return 'PASSED';
  if (raw === 'FAILED' || raw === 'FAIL') return 'FAILED';
  if (raw === 'BLOCKED') return 'BLOCKED';
  if (raw === 'SKIPPED') return 'SKIPPED';
  return 'NOT_RUN';
}

/**
 * Normalizes test case priority into Qavora Web priority buckets (`Critical`, `High`, `Medium`, `Low`).
 */
export function normalizeCasePriorityLabel(priority) {
  const raw = String(priority || '')
    .trim()
    .toUpperCase();
  if (raw === 'P0' || raw === 'CRITICAL') return 'Critical';
  if (raw === 'P1' || raw === 'HIGH') return 'High';
  if (raw === 'P2' || raw === 'MEDIUM') return 'Medium';
  if (raw === 'P3' || raw === 'LOW') return 'Low';
  return 'Medium';
}

/**
 * Extracts normalized workspace arrays from either explicit workspace state or a raw backend project document.
 */
export function resolveWorkspaceCollections(source = {}) {
  const project =
    source.project ||
    source.activeProject ||
    (source &&
    typeof source === 'object' &&
    (Array.isArray(source.testSuites) || Array.isArray(source.suites))
      ? source
      : null);

  const testPlan =
    source.testPlan ||
    (project && project.testPlan && typeof project.testPlan === 'object'
      ? project.testPlan
      : { name: '', phases: [] });

  const phases = Array.isArray(testPlan.phases)
    ? testPlan.phases
    : Array.isArray(project && project.phases)
    ? project.phases
    : [];

  const getPhaseName = (phaseId, fallbackName) => {
    if (fallbackName && typeof fallbackName === 'string' && fallbackName.trim()) {
      return fallbackName.trim();
    }
    if (!phaseId) return 'General';
    const found = phases.find((p) => p && p.id === phaseId);
    return found ? found.name || found.title || 'General' : 'General';
  };

  const rawSuitesSource = Array.isArray(source.suites)
    ? source.suites
    : Array.isArray(source.testSuites)
    ? source.testSuites
    : project && Array.isArray(project.testSuites)
    ? project.testSuites
    : project && Array.isArray(project.suites)
    ? project.suites
    : [];

  const suites = rawSuitesSource.map((s) => ({
    ...s,
    id: s.id,
    name: s.name || s.title || 'Untitled Suite',
    title: s.title || s.name || 'Untitled Suite',
    category: s.category || s.module || 'Functional',
    phaseId: s.phaseId || null,
    phaseName: getPhaseName(s.phaseId, s.phaseName),
    cases: extractSuiteTestCases(s),
  }));

  let testCases = [];
  if (Array.isArray(source.testCases)) {
    testCases = source.testCases.map((tc) => {
      const suiteObj = suites.find((s) => s.id === tc.suiteId);
      return {
        ...tc,
        id: tc.id || tc.testCaseId,
        testCaseId: tc.testCaseId || tc.id,
        title: tc.title || tc.name || 'Untitled Test Case',
        suiteName:
          tc.suiteName ||
          (suiteObj ? suiteObj.name : 'General Suite'),
        phaseName:
          tc.phaseName ||
          (suiteObj ? suiteObj.phaseName : 'General'),
        lastStatus: normalizeCaseVerdict(tc),
      };
    });
  } else if (suites.length > 0) {
    const seenIds = new Set();
    suites.forEach((su) => {
      if (!su) return;
      const suiteName = su.name || su.title || 'Untitled Suite';
      const phaseName = getPhaseName(su.phaseId, su.phaseName);
      const rawCases = extractSuiteTestCases(su);
      rawCases.forEach((tc, idx) => {
        if (!tc) return;
        const caseId = tc.id || tc.testCaseId || `TC-${idx + 1}`;
        if (seenIds.has(caseId)) return;
        seenIds.add(caseId);
        testCases.push({
          ...tc,
          id: caseId,
          testCaseId: caseId,
          suiteId: su.id,
          suiteName,
          phaseId: su.phaseId || null,
          phaseName,
          title: tc.title || tc.name || 'Untitled Test Case',
          lastStatus: normalizeCaseVerdict(tc),
        });
      });
    });
  }

  const testRuns = Array.isArray(source.testRuns)
    ? source.testRuns
    : project && Array.isArray(project.executionRuns)
    ? project.executionRuns
    : [];

  const executions = Array.isArray(source.executions)
    ? source.executions
    : project && Array.isArray(project.executions)
    ? project.executions
    : [];

  const defects = Array.isArray(source.defects)
    ? source.defects
    : project && Array.isArray(project.defects)
    ? project.defects
    : [];

  return {
    project,
    testPlan,
    phases,
    suites,
    testCases,
    testRuns,
    executions,
    defects,
  };
}

/**
 * Computes comprehensive project-scoped Dashboard metrics matching both
 * Qavora Web's `dashboardManager.js` and `reportsManager.js` and Android Phase 2E requirements.
 */
export function computeProjectDashboardMetrics(source = {}) {
  const {
    project,
    testPlan,
    phases,
    suites,
    testCases,
    testRuns,
    executions,
    defects,
  } = resolveWorkspaceCollections(source);

  // 1. Test Case Status Breakdown
  const totalTestCases = testCases.length;
  let passedCases = 0;
  let failedCases = 0;
  let blockedCases = 0;
  let untestedCases = 0;

  const casePriorityCounts = {
    Critical: 0,
    High: 0,
    Medium: 0,
    Low: 0,
  };

  testCases.forEach((tc) => {
    const verdict = normalizeCaseVerdict(tc);
    if (verdict === 'Passed') passedCases++;
    else if (verdict === 'Failed') failedCases++;
    else if (verdict === 'Blocked') blockedCases++;
    else untestedCases++;

    const prioBucket = normalizeCasePriorityLabel(tc.priority);
    casePriorityCounts[prioBucket] = (casePriorityCounts[prioBucket] || 0) + 1;
  });

  const notRunCases = untestedCases;
  const executedCases = totalTestCases - untestedCases;
  const casePassRate =
    executedCases > 0 ? Math.round((passedCases / executedCases) * 100) : 0;
  const coverageRate =
    totalTestCases > 0 ? Math.round((executedCases / totalTestCases) * 100) : 0;

  // 2. Execution History & Verdict Metrics (Qavora Web `dashboardManager.js` & `reportsManager.js` parity)
  let execPassCount = 0;
  let execFailCount = 0;
  let execBlockedCount = 0;
  let execSkippedCount = 0;
  const uniqueExecutedCaseIds = new Set();

  testCases.forEach((tc) => {
    const verdict = normalizeCaseVerdict(tc);
    if (verdict !== 'Untested') {
      uniqueExecutedCaseIds.add(String(tc.id));
    }
  });

  executions.forEach((ex) => {
    const verdict = normalizeExecutionVerdict(ex);
    if (verdict === 'PASSED') execPassCount++;
    else if (verdict === 'FAILED') execFailCount++;
    else if (verdict === 'BLOCKED') execBlockedCount++;
    else if (verdict === 'SKIPPED') execSkippedCount++;

    const cId = ex.testCaseId || ex.caseId;
    if (cId) {
      uniqueExecutedCaseIds.add(String(cId));
    }
  });

  const totalExecutions = executions.length;
  // Fallback when no execution log records exist yet but test cases have verdicts
  const effectiveExecPass =
    totalExecutions > 0 ? execPassCount : passedCases;
  const effectiveExecFail =
    totalExecutions > 0 ? execFailCount : failedCases;
  const effectiveExecBlocked =
    totalExecutions > 0 ? execBlockedCount : blockedCases;
  const effectiveExecTotal =
    effectiveExecPass + effectiveExecFail + effectiveExecBlocked + execSkippedCount;

  const executionPassRate =
    effectiveExecTotal > 0
      ? Math.round((effectiveExecPass / effectiveExecTotal) * 100)
      : 0;
  const executionFailRate =
    effectiveExecTotal > 0
      ? Math.round((effectiveExecFail / effectiveExecTotal) * 100)
      : 0;

  // Primary passRate reflects executed test cases (and matches executionPassRate when cases are executed)
  const passRate = executedCases > 0 ? casePassRate : executionPassRate;

  // 3. Test Runs Breakdown (`In Progress` vs `Completed`)
  const totalRuns = testRuns.length;
  const activeRuns = testRuns.filter((r) => r.status === 'In Progress').length;
  const completedRuns = testRuns.filter((r) => r.status === 'Completed').length;

  // 4. Defects Breakdown (By Status & Severity/Priority)
  const totalDefects = defects.length;
  const defectStatusBreakdown = {
    Open: 0,
    'In Progress': 0,
    'Ready for Retest': 0,
    Resolved: 0,
    Closed: 0,
    Reopened: 0,
  };
  const defectSeverityBreakdown = {
    Critical: 0,
    High: 0,
    Medium: 0,
    Low: 0,
  };
  const activeDefectSeverityBreakdown = {
    Critical: 0,
    High: 0,
    Medium: 0,
    Low: 0,
  };

  let openDefects = 0; // All non-Resolved, non-Closed defects (active defects)
  let inProgressDefects = 0;
  let resolvedDefects = 0;
  let criticalDefects = 0; // Active Critical or High defects
  let criticalOnlyActiveDefects = 0;
  let highOnlyActiveDefects = 0;
  let retestDefects = 0;

  defects.forEach((d) => {
    const st = d.status || 'Open';
    if (defectStatusBreakdown[st] !== undefined) {
      defectStatusBreakdown[st]++;
    } else {
      defectStatusBreakdown.Open++;
    }

    const sev = d.severity || 'Medium';
    if (defectSeverityBreakdown[sev] !== undefined) {
      defectSeverityBreakdown[sev]++;
    } else {
      defectSeverityBreakdown.Medium++;
    }

    const isResolvedOrClosed = st === 'Resolved' || st === 'Closed';
    if (!isResolvedOrClosed) {
      openDefects++;
      if (activeDefectSeverityBreakdown[sev] !== undefined) {
        activeDefectSeverityBreakdown[sev]++;
      }
      if (sev === 'Critical') {
        criticalOnlyActiveDefects++;
        criticalDefects++;
      } else if (sev === 'High') {
        highOnlyActiveDefects++;
        criticalDefects++;
      }
    } else {
      resolvedDefects++;
    }

    if (st === 'In Progress' || st === 'Ready for Retest') {
      inProgressDefects++;
    }
    if (st === 'Ready for Retest') {
      retestDefects++;
    }
  });

  const defectResolutionRate =
    totalDefects > 0 ? Math.round((resolvedDefects / totalDefects) * 100) : 0;

  // 5. Suite Progress Breakdown
  const suiteProgress = suites.map((su) => {
    const suiteCases = testCases.filter((tc) => tc.suiteId === su.id);
    const total = suiteCases.length;
    const passed = suiteCases.filter(
      (tc) => normalizeCaseVerdict(tc) === 'Passed'
    ).length;
    const failed = suiteCases.filter(
      (tc) => normalizeCaseVerdict(tc) === 'Failed'
    ).length;
    const blocked = suiteCases.filter(
      (tc) => normalizeCaseVerdict(tc) === 'Blocked'
    ).length;
    const untested = Math.max(0, total - passed - failed - blocked);
    const executed = total - untested;
    const suiteCaseIds = new Set(suiteCases.map((tc) => tc.id));
    const suiteExecs = executions.filter((ex) =>
      suiteCaseIds.has(ex.testCaseId || ex.caseId)
    );
    const suiteDefects = defects.filter((d) =>
      suiteCaseIds.has(d.linkedTestCaseId || d.testCaseId)
    );

    return {
      id: su.id,
      name: su.name || su.title || 'Untitled Suite',
      phaseId: su.phaseId || null,
      phaseName: su.phaseName || 'General',
      category: su.category || 'Functional',
      totalCases: total,
      executedCases: executed,
      passedCases: passed,
      failedCases: failed,
      blockedCases: blocked,
      untestedCases: untested,
      coveragePct: total > 0 ? Math.round((executed / total) * 100) : 0,
      passRate: executed > 0 ? Math.round((passed / executed) * 100) : 0,
      executionsCount: suiteExecs.length,
      defectsCount: suiteDefects.length,
    };
  });

  // 6. Test Plan Phase Progress Breakdown (Qavora Web `renderPhaseCoverageTable` parity)
  const phaseMap = new Map();
  phases.forEach((ph) => {
    if (!ph) return;
    const name = ph.name || ph.title || 'General';
    if (!phaseMap.has(name)) {
      phaseMap.set(name, {
        id: ph.id || name,
        name,
        description: ph.description || '',
        status: ph.status || 'Active',
        suiteCount: 0,
        caseCount: 0,
        executedCount: 0,
        passedCount: 0,
        failedCount: 0,
        blockedCount: 0,
      });
    }
  });

  suiteProgress.forEach((sp) => {
    const phaseName = sp.phaseName || 'General';
    if (!phaseMap.has(phaseName)) {
      phaseMap.set(phaseName, {
        id: sp.phaseId || phaseName,
        name: phaseName,
        description: '',
        status: 'Active',
        suiteCount: 0,
        caseCount: 0,
        executedCount: 0,
        passedCount: 0,
        failedCount: 0,
        blockedCount: 0,
      });
    }
    const entry = phaseMap.get(phaseName);
    entry.suiteCount += 1;
    entry.caseCount += sp.totalCases;
    entry.executedCount += sp.executedCases;
    entry.passedCount += sp.passedCases;
    entry.failedCount += sp.failedCases;
    entry.blockedCount += sp.blockedCases;
  });

  const phaseProgress = Array.from(phaseMap.values()).map((p) => ({
    ...p,
    coveragePct:
      p.caseCount > 0 ? Math.round((p.executedCount / p.caseCount) * 100) : 0,
    passRate:
      p.executedCount > 0
        ? Math.round((p.passedCount / p.executedCount) * 100)
        : 0,
  }));

  // 7. Health Status Assessment (matches Qavora Web `reportsManager.js` lines 360-385)
  let healthStatus = 'NO DATA';
  let healthTone = 'neutral';
  if (totalTestCases > 0 || totalExecutions > 0 || totalDefects > 0) {
    if (criticalOnlyActiveDefects > 0 || passRate < 60) {
      healthStatus = 'CRITICAL';
      healthTone = 'danger';
    } else if (highOnlyActiveDefects > 0 || passRate < 80) {
      healthStatus = 'AT RISK';
      healthTone = 'warning';
    } else {
      healthStatus = 'HEALTHY';
      healthTone = 'success';
    }
  }

  return {
    projectId: project ? project.id : null,
    projectName: project ? project.name : 'Unselected Project',
    hasTestPlan: Boolean(
      testPlan && (testPlan.name || (Array.isArray(phases) && phases.length > 0))
    ),
    totalPhases: phases.length,
    totalSuites: suites.length,
    totalTestCases,
    passedCases,
    failedCases,
    blockedCases,
    untestedCases,
    notRunCases,
    executedCases,
    passRate,
    casePassRate,
    coverageRate,
    totalRuns,
    activeRuns,
    completedRuns,
    totalExecutions,
    execPassCount: effectiveExecPass,
    execFailCount: effectiveExecFail,
    execBlockedCount: effectiveExecBlocked,
    execSkippedCount,
    executionPassRate,
    executionFailRate,
    totalDefects,
    openDefects,
    inProgressDefects,
    resolvedDefects,
    criticalDefects,
    criticalOnlyActiveDefects,
    highOnlyActiveDefects,
    retestDefects,
    defectResolutionRate,
    defectStatusBreakdown,
    defectSeverityBreakdown,
    activeDefectSeverityBreakdown,
    casePriorityCounts,
    suiteProgress,
    phaseProgress,
    healthStatus,
    healthTone,
  };
}

/**
 * Generates a complete, filtered, project-scoped QA Report matching Qavora Web's `reportsManager.js`.
 * Never mutates project data or calls non-existent `/api/reports` endpoints.
 */
export function generateProjectReport(source = {}, filters = {}) {
  const {
    project,
    testPlan,
    phases,
    suites,
    testCases,
    testRuns,
    executions,
    defects,
  } = resolveWorkspaceCollections(source);

  const reportType = REPORT_TYPES.some((t) => t.id === filters.reportType)
    ? filters.reportType
    : 'project_summary';
  const dateFilter = DATE_RANGE_FILTERS.some((d) => d.id === filters.dateFilter)
    ? filters.dateFilter
    : 'ALL';
  const customStart =
    typeof filters.customStart === 'string' ? filters.customStart.trim() : '';
  const customEnd =
    typeof filters.customEnd === 'string' ? filters.customEnd.trim() : '';
  const suiteIdFilter =
    typeof filters.suiteId === 'string' && filters.suiteId.trim()
      ? filters.suiteId.trim()
      : 'ALL';
  const statusFilter =
    typeof filters.statusFilter === 'string' && filters.statusFilter.trim()
      ? filters.statusFilter.trim()
      : 'ALL';
  const severityFilter =
    typeof filters.severityFilter === 'string' && filters.severityFilter.trim()
      ? filters.severityFilter.trim()
      : 'ALL';
  const referenceNow =
    filters.referenceNow instanceof Date ? filters.referenceNow : new Date();

  // 1. Filter Suites & Test Cases by Suite Filter
  const filteredSuites =
    suiteIdFilter === 'ALL'
      ? suites
      : suites.filter((s) => s.id === suiteIdFilter);

  const allowedSuiteIds =
    suiteIdFilter === 'ALL'
      ? null
      : new Set(filteredSuites.map((s) => s.id));

  let scopedCases = allowedSuiteIds
    ? testCases.filter((tc) => allowedSuiteIds.has(tc.suiteId))
    : [...testCases];

  // Apply case status filter if reportType is case_status and statusFilter !== 'ALL'
  if (reportType === 'case_status' && statusFilter !== 'ALL') {
    scopedCases = scopedCases.filter(
      (tc) =>
        normalizeCaseVerdict(tc).toUpperCase() === statusFilter.toUpperCase() ||
        (statusFilter.toUpperCase() === 'NOT RUN' &&
          normalizeCaseVerdict(tc) === 'Untested')
    );
  }

  const scopedCaseIds = new Set(scopedCases.map((tc) => tc.id));

  // 2. Filter Executions by Date Range, Suite, and Status Filter
  let filteredExecutions = executions.filter((ex) => {
    const dt = ex.executedAt || ex.timestamp || ex.createdAt || '';
    if (!isWithinDateRange(dt, dateFilter, customStart, customEnd, referenceNow)) {
      return false;
    }
    if (allowedSuiteIds) {
      const cId = ex.testCaseId || ex.caseId;
      if (cId && !scopedCaseIds.has(cId)) {
        return false;
      }
    }
    if (reportType === 'execution_summary' && statusFilter !== 'ALL') {
      const verdict = normalizeExecutionVerdict(ex);
      if (verdict !== statusFilter.toUpperCase()) {
        return false;
      }
    }
    return true;
  });

  // 3. Filter Test Runs by Date Range, Suite, and Status Filter
  let filteredTestRuns = testRuns.filter((run) => {
    const dt = run.startedAt || run.createdAt || run.updatedAt || '';
    if (!isWithinDateRange(dt, dateFilter, customStart, customEnd, referenceNow)) {
      return false;
    }
    if (allowedSuiteIds) {
      const runMatchesSuite =
        run.suiteId === suiteIdFilter ||
        (Array.isArray(run.results) &&
          run.results.some((r) =>
            scopedCaseIds.has(r.testCaseId || r.caseId)
          ));
      if (!runMatchesSuite) return false;
    }
    if (reportType === 'test_runs' && statusFilter !== 'ALL') {
      if (String(run.status || '').toUpperCase() !== statusFilter.toUpperCase()) {
        return false;
      }
    }
    return true;
  });

  // 4. Filter Defects by Date Range, Suite, Status, and Severity
  let filteredDefects = defects.filter((d) => {
    const dt = d.createdAt || d.updatedAt || '';
    if (!isWithinDateRange(dt, dateFilter, customStart, customEnd, referenceNow)) {
      return false;
    }
    if (allowedSuiteIds) {
      const linkedCaseId = d.linkedTestCaseId || d.testCaseId;
      if (linkedCaseId && !scopedCaseIds.has(linkedCaseId)) {
        return false;
      }
    }
    if (severityFilter !== 'ALL') {
      if (
        String(d.severity || 'Medium').toUpperCase() !==
        severityFilter.toUpperCase()
      ) {
        return false;
      }
    }
    if (reportType === 'defect_summary' && statusFilter !== 'ALL') {
      if (
        String(d.status || 'Open').toUpperCase() !== statusFilter.toUpperCase()
      ) {
        return false;
      }
    }
    return true;
  });

  // 5. Compute Filtered KPIs matching Qavora Web `reportsManager.js`
  const totalCases = scopedCases.length;
  const passedCasesCount = scopedCases.filter(
    (tc) => normalizeCaseVerdict(tc) === 'Passed'
  ).length;
  const failedCasesCount = scopedCases.filter(
    (tc) => normalizeCaseVerdict(tc) === 'Failed'
  ).length;
  const blockedCasesCount = scopedCases.filter(
    (tc) => normalizeCaseVerdict(tc) === 'Blocked'
  ).length;
  const notRunCasesCount = Math.max(
    0,
    totalCases - passedCasesCount - failedCasesCount - blockedCasesCount
  );

  const totalExecs = filteredExecutions.length;
  const executedCaseIdSet = new Set();
  filteredExecutions.forEach((ex) => {
    const cId = ex.testCaseId || ex.caseId;
    if (cId) executedCaseIdSet.add(String(cId));
  });
  scopedCases.forEach((tc) => {
    if (normalizeCaseVerdict(tc) !== 'Untested' && dateFilter === 'ALL') {
      executedCaseIdSet.add(String(tc.id));
    }
  });

  const executedCasesCount = Math.min(totalCases, executedCaseIdSet.size);
  const coveragePct =
    totalCases > 0 ? Math.round((executedCasesCount / totalCases) * 100) : 0;

  let execPassedCount = filteredExecutions.filter(
    (ex) => normalizeExecutionVerdict(ex) === 'PASSED'
  ).length;
  let execFailedCount = filteredExecutions.filter(
    (ex) => normalizeExecutionVerdict(ex) === 'FAILED'
  ).length;
  let execBlockedCount = filteredExecutions.filter(
    (ex) => normalizeExecutionVerdict(ex) === 'BLOCKED'
  ).length;
  let execSkippedCount = filteredExecutions.filter(
    (ex) => normalizeExecutionVerdict(ex) === 'SKIPPED'
  ).length;

  // Fallback to case-level counts when dateFilter === 'ALL' and no execution history items exist yet
  const effectiveTotalExecs =
    totalExecs > 0
      ? totalExecs
      : dateFilter === 'ALL'
      ? passedCasesCount + failedCasesCount + blockedCasesCount
      : 0;

  if (totalExecs === 0 && dateFilter === 'ALL' && effectiveTotalExecs > 0) {
    execPassedCount = passedCasesCount;
    execFailedCount = failedCasesCount;
    execBlockedCount = blockedCasesCount;
  }

  const passRate =
    effectiveTotalExecs > 0
      ? Math.round((execPassedCount / effectiveTotalExecs) * 100)
      : 0;
  const failRate =
    effectiveTotalExecs > 0
      ? Math.round((execFailedCount / effectiveTotalExecs) * 100)
      : 0;

  // 6. Execution Timeline Grouping by Date (Qavora Web `renderVelocityTrendChart` / timeline table)
  const timelineMap = new Map();
  filteredExecutions.forEach((ex) => {
    const rawDt = ex.executedAt || ex.timestamp || ex.createdAt || '';
    const dateKey = String(rawDt).slice(0, 10) || 'Unspecified';
    if (!timelineMap.has(dateKey)) {
      timelineMap.set(dateKey, {
        date: dateKey,
        totalRuns: 0,
        passed: 0,
        failed: 0,
        blocked: 0,
        skipped: 0,
      });
    }
    const row = timelineMap.get(dateKey);
    row.totalRuns += 1;
    const v = normalizeExecutionVerdict(ex);
    if (v === 'PASSED') row.passed += 1;
    else if (v === 'FAILED') row.failed += 1;
    else if (v === 'BLOCKED') row.blocked += 1;
    else if (v === 'SKIPPED') row.skipped += 1;
  });

  const executionTimeline = Array.from(timelineMap.values())
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .map((row) => ({
      ...row,
      passRate:
        row.totalRuns > 0 ? Math.round((row.passed / row.totalRuns) * 100) : 0,
    }));

  // 7. Suites Quality Table (Qavora Web `renderSuitesQualityTable`)
  const suitesQuality = filteredSuites.map((su) => {
    const suCases = scopedCases.filter((tc) => tc.suiteId === su.id);
    const suCaseIds = new Set(suCases.map((tc) => tc.id));
    const suExecs = filteredExecutions.filter((ex) =>
      suCaseIds.has(ex.testCaseId || ex.caseId)
    );
    const suPassedCases = suCases.filter(
      (tc) => normalizeCaseVerdict(tc) === 'Passed'
    ).length;
    const suFailedCases = suCases.filter(
      (tc) => normalizeCaseVerdict(tc) === 'Failed'
    ).length;
    const suBlockedCases = suCases.filter(
      (tc) => normalizeCaseVerdict(tc) === 'Blocked'
    ).length;
    const suNotRunCases = Math.max(
      0,
      suCases.length - suPassedCases - suFailedCases - suBlockedCases
    );

    const execPassed =
      suExecs.length > 0
        ? suExecs.filter((ex) => normalizeExecutionVerdict(ex) === 'PASSED')
            .length
        : suPassedCases;
    const execFailed =
      suExecs.length > 0
        ? suExecs.filter((ex) => normalizeExecutionVerdict(ex) === 'FAILED')
            .length
        : suFailedCases;
    const execCount =
      suExecs.length > 0
        ? suExecs.length
        : suPassedCases + suFailedCases + suBlockedCases;
    const suitePassRate =
      execCount > 0 ? Math.round((execPassed / execCount) * 100) : 0;
    const executedCasesInSuite = suCases.length - suNotRunCases;
    const suiteCoveragePct =
      suCases.length > 0
        ? Math.round((executedCasesInSuite / suCases.length) * 100)
        : 0;

    return {
      id: su.id,
      title: su.name || su.title || 'Untitled Suite',
      phaseName: su.phaseName || 'General',
      category: su.category || 'Functional',
      totalCases: suCases.length,
      executedCases: executedCasesInSuite,
      passedCases: suPassedCases,
      failedCases: suFailedCases,
      blockedCases: suBlockedCases,
      notRunCases: suNotRunCases,
      executionsCount: suExecs.length,
      passedExecutions: execPassed,
      failedExecutions: execFailed,
      passRate: suitePassRate,
      coveragePct: suiteCoveragePct,
    };
  });

  // 8. Phase Coverage Table (Qavora Web `renderPhaseCoverageTable`)
  const phaseMap = new Map();
  phases.forEach((ph) => {
    if (!ph) return;
    const name = ph.name || ph.title || 'General';
    if (!phaseMap.has(name)) {
      phaseMap.set(name, {
        phaseName: name,
        suiteCount: 0,
        caseCount: 0,
        executedCount: 0,
      });
    }
  });
  suitesQuality.forEach((sq) => {
    const name = sq.phaseName || 'General';
    if (!phaseMap.has(name)) {
      phaseMap.set(name, {
        phaseName: name,
        suiteCount: 0,
        caseCount: 0,
        executedCount: 0,
      });
    }
    const entry = phaseMap.get(name);
    entry.suiteCount += 1;
    entry.caseCount += sq.totalCases;
    entry.executedCount += sq.executedCases;
  });
  const phaseCoverage = Array.from(phaseMap.values()).map((p) => ({
    ...p,
    coveragePct:
      p.caseCount > 0 ? Math.round((p.executedCount / p.caseCount) * 100) : 0,
  }));

  // 9. Priority Breakdown (Qavora Web `renderPriorityBreakdown`)
  const priorityCounts = { Critical: 0, High: 0, Medium: 0, Low: 0 };
  scopedCases.forEach((tc) => {
    const bucket = normalizeCasePriorityLabel(tc.priority);
    priorityCounts[bucket] = (priorityCounts[bucket] || 0) + 1;
  });
  const priorityBreakdown = ['Critical', 'High', 'Medium', 'Low'].map(
    (label) => ({
      label,
      count: priorityCounts[label] || 0,
      percentage:
        totalCases > 0
          ? Math.round(((priorityCounts[label] || 0) / totalCases) * 100)
          : 0,
    })
  );

  // 10. Test Run Cycle Summaries
  const testRunSummaries = filteredTestRuns.map((run) => {
    const results = Array.isArray(run.results) ? run.results : [];
    const total = results.length;
    const passed = results.filter(
      (r) => r.status === 'Passed' || r.outcome === 'Pass'
    ).length;
    const failed = results.filter(
      (r) => r.status === 'Failed' || r.outcome === 'Fail'
    ).length;
    const blocked = results.filter(
      (r) => r.status === 'Blocked' || r.outcome === 'Blocked'
    ).length;
    const untested = Math.max(0, total - passed - failed - blocked);
    const executed = total - untested;
    const runPassRate =
      executed > 0 ? Math.round((passed / executed) * 100) : 0;
    const runCoverage =
      total > 0 ? Math.round((executed / total) * 100) : 0;

    return {
      id: run.id,
      name: run.name || 'Untitled Test Run',
      suiteName: run.suiteName || 'All Suites',
      status: run.status || 'In Progress',
      buildVersion: run.buildVersion || '1.0.0',
      deviceInfo: run.deviceInfo || 'Android Device',
      environment: run.environment || 'Staging',
      tester: run.tester || 'QA Engineer',
      startedAt: run.startedAt || run.createdAt || '',
      completedAt: run.completedAt || null,
      totalCases: total,
      executedCases: executed,
      passedCases: passed,
      failedCases: failed,
      blockedCases: blocked,
      untestedCases: untested,
      passRate: runPassRate,
      coveragePct: runCoverage,
    };
  });

  // 11. Defects Breakdown & Table (Qavora Web `renderDefectsBreakdown` + `renderRecentDefectsTable`)
  const defectSeverityCounts = { Critical: 0, High: 0, Medium: 0, Low: 0 };
  const defectStatusCounts = {
    Open: 0,
    'In Progress': 0,
    'Ready for Retest': 0,
    Resolved: 0,
    Closed: 0,
    Reopened: 0,
  };
  let openDefectsCount = 0;
  let resolvedDefectsCount = 0;
  let criticalOpenDefectsCount = 0;

  filteredDefects.forEach((d) => {
    const sev = d.severity || 'Medium';
    if (defectSeverityCounts[sev] !== undefined) defectSeverityCounts[sev]++;
    else defectSeverityCounts.Medium++;

    const st = d.status || 'Open';
    if (defectStatusCounts[st] !== undefined) defectStatusCounts[st]++;
    else defectStatusCounts.Open++;

    if (st === 'Resolved' || st === 'Closed') {
      resolvedDefectsCount++;
    } else {
      openDefectsCount++;
      if (sev === 'Critical') {
        criticalOpenDefectsCount++;
      }
    }
  });

  const defectResolutionRate =
    filteredDefects.length > 0
      ? Math.round((resolvedDefectsCount / filteredDefects.length) * 100)
      : 0;

  // Health Badge & Executive Insights (Qavora Web `renderHealthAndInsights`)
  let healthStatus = 'NO DATA';
  let healthTone = 'neutral';
  if (totalCases > 0 || effectiveTotalExecs > 0 || filteredDefects.length > 0) {
    if (criticalOpenDefectsCount > 0 || (effectiveTotalExecs > 0 && passRate < 60)) {
      healthStatus = 'CRITICAL';
      healthTone = 'danger';
    } else if (
      defectSeverityCounts.High > 0 ||
      (effectiveTotalExecs > 0 && passRate < 80)
    ) {
      healthStatus = 'AT RISK';
      healthTone = 'warning';
    } else {
      healthStatus = 'HEALTHY';
      healthTone = 'success';
    }
  }

  const insights = [
    {
      tag: 'Test Coverage',
      score: `${coveragePct}%`,
      tone: coveragePct >= 80 ? 'success' : coveragePct >= 50 ? 'warning' : 'danger',
      description:
        coveragePct >= 80
          ? 'High test execution coverage across configured test suites.'
          : 'Further execution needed to reach 80% coverage threshold.',
    },
    {
      tag: 'Pass Velocity',
      score: `${passRate}%`,
      tone: passRate >= 80 ? 'success' : passRate >= 60 ? 'warning' : 'danger',
      description:
        passRate >= 80
          ? 'Passing criteria comfortably met across execution attempts.'
          : 'Test failures require regression triage and re-execution.',
    },
    {
      tag: 'Defect Triage',
      score:
        criticalOpenDefectsCount > 0
          ? `${criticalOpenDefectsCount} Critical`
          : '0 Critical',
      tone: criticalOpenDefectsCount > 0 ? 'danger' : 'success',
      description:
        criticalOpenDefectsCount > 0
          ? 'Critical blockers currently open preventing sign-off.'
          : 'No open critical severity issues recorded.',
    },
  ];

  // Determine whether the generated report has any matching records
  const isEmptyByType = {
    project_summary:
      totalCases === 0 &&
      filteredExecutions.length === 0 &&
      filteredTestRuns.length === 0 &&
      filteredDefects.length === 0,
    execution_summary:
      filteredExecutions.length === 0 && effectiveTotalExecs === 0,
    case_status: totalCases === 0 && filteredSuites.length === 0,
    test_runs: filteredTestRuns.length === 0,
    defect_summary: filteredDefects.length === 0,
  };

  const reportTypeMeta =
    REPORT_TYPES.find((t) => t.id === reportType) || REPORT_TYPES[0];
  const dateFilterMeta =
    DATE_RANGE_FILTERS.find((d) => d.id === dateFilter) || DATE_RANGE_FILTERS[0];

  return {
    generatedAt: new Date().toISOString(),
    reportType,
    reportTitle: reportTypeMeta.label,
    reportDescription: reportTypeMeta.description,
    project: {
      id: project ? project.id : null,
      name: project ? project.name : 'Unselected Project',
      status: project ? project.status || 'Active' : 'Active',
      type: project ? project.type || 'Mobile App' : 'Mobile App',
      version: project ? project.version || '' : '',
      environment: project ? project.environment || '' : '',
    },
    filters: {
      reportType,
      dateFilter,
      dateFilterLabel: dateFilterMeta.label,
      customStart,
      customEnd,
      suiteId: suiteIdFilter,
      statusFilter,
      severityFilter,
    },
    isEmpty: Boolean(isEmptyByType[reportType]),
    healthStatus,
    healthTone,
    insights,
    kpis: {
      totalTestCases: totalCases,
      passedCases: passedCasesCount,
      failedCases: failedCasesCount,
      blockedCases: blockedCasesCount,
      notRunCases: notRunCasesCount,
      executedCases: executedCasesCount,
      coveragePct,
      totalExecutions: totalExecs,
      effectiveTotalExecutions: effectiveTotalExecs,
      execPassedCount,
      execFailedCount,
      execBlockedCount,
      execSkippedCount,
      passRate,
      failRate,
      totalTestRuns: testRunSummaries.length,
      inProgressTestRuns: testRunSummaries.filter(
        (r) => r.status === 'In Progress'
      ).length,
      completedTestRuns: testRunSummaries.filter(
        (r) => r.status === 'Completed'
      ).length,
      totalDefects: filteredDefects.length,
      openDefects: openDefectsCount,
      resolvedDefects: resolvedDefectsCount,
      criticalOpenDefects: criticalOpenDefectsCount,
      defectResolutionRate,
    },
    verdictDistribution: [
      {
        label: 'Passed',
        count: execPassedCount,
        percentage:
          effectiveTotalExecs > 0
            ? Math.round((execPassedCount / effectiveTotalExecs) * 100)
            : 0,
      },
      {
        label: 'Failed',
        count: execFailedCount,
        percentage:
          effectiveTotalExecs > 0
            ? Math.round((execFailedCount / effectiveTotalExecs) * 100)
            : 0,
      },
      {
        label: 'Blocked',
        count: execBlockedCount,
        percentage:
          effectiveTotalExecs > 0
            ? Math.round((execBlockedCount / effectiveTotalExecs) * 100)
            : 0,
      },
      {
        label: 'Skipped',
        count: execSkippedCount,
        percentage:
          effectiveTotalExecs > 0
            ? Math.round((execSkippedCount / effectiveTotalExecs) * 100)
            : 0,
      },
      {
        label: 'Not Run',
        count: notRunCasesCount,
        percentage:
          totalCases > 0
            ? Math.round((notRunCasesCount / totalCases) * 100)
            : 0,
      },
    ],
    executionTimeline,
    phaseCoverage,
    priorityBreakdown,
    suitesQuality,
    testCases: scopedCases.map((tc) => ({
      id: tc.id,
      title: tc.title,
      suiteId: tc.suiteId,
      suiteName: tc.suiteName || 'General Suite',
      phaseName: tc.phaseName || 'General',
      priority: tc.priority || 'P1',
      priorityLabel: normalizeCasePriorityLabel(tc.priority),
      testType: tc.testType || tc.category || 'Functional',
      status: normalizeCaseVerdict(tc),
      updatedAt: tc.updatedAt || tc.createdAt || '',
    })),
    testRuns: testRunSummaries,
    executions: [...filteredExecutions]
      .sort((a, b) => {
        const dtA = a.executedAt || a.timestamp || a.createdAt || '';
        const dtB = b.executedAt || b.timestamp || b.createdAt || '';
        return dtA < dtB ? 1 : -1;
      })
      .map((ex) => ({
        id: ex.id,
        testCaseId: ex.testCaseId || ex.caseId || '',
        testCaseTitle: ex.testCaseTitle || ex.caseTitle || ex.title || 'Execution Run',
        suiteName: ex.suiteName || 'General Suite',
        testRunId: ex.testRunId || null,
        verdict: normalizeExecutionVerdict(ex),
        outcome: ex.outcome || normalizeExecutionVerdict(ex),
        tester: ex.testerName || ex.tester || 'QA Tester',
        environment: ex.environment || 'Staging',
        device: ex.device || 'Android Device',
        buildVersion: ex.buildVersion || '1.0.0',
        actualResult: ex.actualResult || ex.notes || '',
        linkedDefectId: ex.linkedDefectId || null,
        executedAt: ex.executedAt || ex.timestamp || ex.createdAt || '',
      })),
    defectsBreakdown: {
      bySeverity: defectSeverityCounts,
      byStatus: defectStatusCounts,
    },
    defects: [...filteredDefects]
      .sort((a, b) => {
        const dtA = a.updatedAt || a.createdAt || '';
        const dtB = b.updatedAt || b.createdAt || '';
        return dtA < dtB ? 1 : -1;
      })
      .map((d) => ({
        id: d.defectId || d.id,
        title: d.title || 'Untitled Defect',
        severity: d.severity || 'Medium',
        priority: d.priority || d.severity || 'Medium',
        status: d.status || 'Open',
        assignee: d.assignee || 'Unassigned',
        linkedTestCaseId: d.linkedTestCaseId || d.testCaseId || null,
        linkedTestRunId: d.linkedTestRunId || d.testRunId || null,
        environment: d.environment || '',
        createdAt: d.createdAt || '',
        updatedAt: d.updatedAt || '',
      })),
  };
}

/**
 * Escapes a value for RFC-4180 CSV output.
 */
function escapeCsvCell(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildCsvRow(cells) {
  return cells.map(escapeCsvCell).join(',');
}

/**
 * Formats a generated report object as structured JSON.
 */
export function formatReportAsJSON(report) {
  if (!report || typeof report !== 'object') {
    throw new Error('Invalid report object provided for JSON export.');
  }
  return JSON.stringify(report, null, 2);
}

/**
 * Formats a generated report object as structured CSV rows tailored to the active report type.
 */
export function formatReportAsCSV(report) {
  if (!report || typeof report !== 'object') {
    throw new Error('Invalid report object provided for CSV export.');
  }

  const lines = [];
  const p = report.project || {};
  const k = report.kpis || {};
  const f = report.filters || {};

  // Metadata Header Section
  lines.push(buildCsvRow(['QAVORA QA REPORT EXPORT']));
  lines.push(buildCsvRow(['Report Type', report.reportTitle || report.reportType]));
  lines.push(buildCsvRow(['Project Name', p.name || 'Unselected Project']));
  lines.push(buildCsvRow(['Project Status', p.status || 'Active']));
  lines.push(buildCsvRow(['Date Range Filter', f.dateFilterLabel || f.dateFilter || 'All Time']));
  lines.push(buildCsvRow(['Generated At', report.generatedAt || new Date().toISOString()]));
  lines.push(buildCsvRow(['Health Status', report.healthStatus || 'NO DATA']));
  lines.push('');

  // Core KPI Summary Section (always included for clarity)
  lines.push(buildCsvRow(['KPI Metric', 'Value']));
  lines.push(buildCsvRow(['Total Test Cases', k.totalTestCases ?? 0]));
  lines.push(buildCsvRow(['Executed Test Cases', k.executedCases ?? 0]));
  lines.push(buildCsvRow(['Passed Test Cases', k.passedCases ?? 0]));
  lines.push(buildCsvRow(['Failed Test Cases', k.failedCases ?? 0]));
  lines.push(buildCsvRow(['Blocked Test Cases', k.blockedCases ?? 0]));
  lines.push(buildCsvRow(['Not Run Test Cases', k.notRunCases ?? 0]));
  lines.push(buildCsvRow(['Execution Coverage (%)', `${k.coveragePct ?? 0}%`]));
  lines.push(buildCsvRow(['Total Executions', k.totalExecutions ?? 0]));
  lines.push(buildCsvRow(['Execution Pass Rate (%)', `${k.passRate ?? 0}%`]));
  lines.push(buildCsvRow(['Execution Fail Rate (%)', `${k.failRate ?? 0}%`]));
  lines.push(buildCsvRow(['Total Test Runs', k.totalTestRuns ?? 0]));
  lines.push(buildCsvRow(['In Progress Test Runs', k.inProgressTestRuns ?? 0]));
  lines.push(buildCsvRow(['Completed Test Runs', k.completedTestRuns ?? 0]));
  lines.push(buildCsvRow(['Total Defects', k.totalDefects ?? 0]));
  lines.push(buildCsvRow(['Open Defects', k.openDefects ?? 0]));
  lines.push(buildCsvRow(['Resolved/Closed Defects', k.resolvedDefects ?? 0]));
  lines.push(buildCsvRow(['Critical Open Defects', k.criticalOpenDefects ?? 0]));
  lines.push(buildCsvRow(['Defect Resolution Rate (%)', `${k.defectResolutionRate ?? 0}%`]));
  lines.push('');

  // Section-Specific Tables
  if (
    report.reportType === 'project_summary' ||
    report.reportType === 'case_status'
  ) {
    lines.push(buildCsvRow(['TEST SUITES QUALITY & COVERAGE']));
    lines.push(
      buildCsvRow([
        'Suite Title',
        'Phase',
        'Category',
        'Total Cases',
        'Executed Cases',
        'Passed',
        'Failed',
        'Blocked',
        'Not Run',
        'Coverage (%)',
        'Pass Rate (%)',
      ])
    );
    (report.suitesQuality || []).forEach((sq) => {
      lines.push(
        buildCsvRow([
          sq.title,
          sq.phaseName,
          sq.category,
          sq.totalCases,
          sq.executedCases,
          sq.passedCases,
          sq.failedCases,
          sq.blockedCases,
          sq.notRunCases,
          `${sq.coveragePct}%`,
          `${sq.passRate}%`,
        ])
      );
    });
    lines.push('');
  }

  if (report.reportType === 'case_status') {
    lines.push(buildCsvRow(['TEST CASES STATUS LOG']));
    lines.push(
      buildCsvRow([
        'Case ID',
        'Title',
        'Suite',
        'Phase',
        'Priority',
        'Type',
        'Status',
        'Updated At',
      ])
    );
    (report.testCases || []).forEach((tc) => {
      lines.push(
        buildCsvRow([
          tc.id,
          tc.title,
          tc.suiteName,
          tc.phaseName,
          tc.priority,
          tc.testType,
          tc.status,
          tc.updatedAt,
        ])
      );
    });
    lines.push('');
  }

  if (
    report.reportType === 'project_summary' ||
    report.reportType === 'execution_summary'
  ) {
    lines.push(buildCsvRow(['RECENT TEST EXECUTIONS LOG']));
    lines.push(
      buildCsvRow([
        'Case ID',
        'Test Case Title',
        'Suite',
        'Verdict',
        'Tester',
        'Environment',
        'Build',
        'Linked Defect',
        'Timestamp',
      ])
    );
    (report.executions || []).forEach((ex) => {
      lines.push(
        buildCsvRow([
          ex.testCaseId,
          ex.testCaseTitle,
          ex.suiteName,
          ex.verdict,
          ex.tester,
          ex.environment,
          ex.buildVersion,
          ex.linkedDefectId || '',
          ex.executedAt,
        ])
      );
    });
    lines.push('');
  }

  if (
    report.reportType === 'project_summary' ||
    report.reportType === 'test_runs'
  ) {
    lines.push(buildCsvRow(['TEST RUN CYCLES']));
    lines.push(
      buildCsvRow([
        'Run ID',
        'Run Name',
        'Suite Scope',
        'Status',
        'Build Version',
        'Device',
        'Environment',
        'Tester',
        'Total Cases',
        'Executed',
        'Passed',
        'Failed',
        'Blocked',
        'Untested',
        'Pass Rate (%)',
      ])
    );
    (report.testRuns || []).forEach((run) => {
      lines.push(
        buildCsvRow([
          run.id,
          run.name,
          run.suiteName,
          run.status,
          run.buildVersion,
          run.deviceInfo,
          run.environment,
          run.tester,
          run.totalCases,
          run.executedCases,
          run.passedCases,
          run.failedCases,
          run.blockedCases,
          run.untestedCases,
          `${run.passRate}%`,
        ])
      );
    });
    lines.push('');
  }

  if (
    report.reportType === 'project_summary' ||
    report.reportType === 'defect_summary'
  ) {
    lines.push(buildCsvRow(['DEFECTS LOG']));
    lines.push(
      buildCsvRow([
        'Defect ID',
        'Title',
        'Severity',
        'Priority',
        'Status',
        'Assignee',
        'Linked Case',
        'Linked Run',
        'Updated At',
      ])
    );
    (report.defects || []).forEach((d) => {
      lines.push(
        buildCsvRow([
          d.id,
          d.title,
          d.severity,
          d.priority,
          d.status,
          d.assignee,
          d.linkedTestCaseId || '',
          d.linkedTestRunId || '',
          d.updatedAt,
        ])
      );
    });
  }

  return lines.join('\n');
}

/**
 * Formats a generated report object as a clean, printable/shareable Markdown QA summary.
 */
export function formatReportAsMarkdown(report) {
  if (!report || typeof report !== 'object') {
    throw new Error('Invalid report object provided for Markdown export.');
  }

  const p = report.project || {};
  const k = report.kpis || {};
  const f = report.filters || {};
  const lines = [];

  lines.push(`# Qavora QA Report — ${report.reportTitle || 'Project QA Summary'}`);
  lines.push('');
  lines.push(`- **Project**: ${p.name || 'Unselected Project'} (${p.status || 'Active'})`);
  lines.push(`- **Type / Environment**: ${p.type || 'Mobile App'}${p.environment ? ` · ${p.environment}` : ''}${p.version ? ` · v${p.version}` : ''}`);
  lines.push(`- **Date Range**: ${f.dateFilterLabel || f.dateFilter || 'All Time'}${f.dateFilter === 'CUSTOM' ? ` (${f.customStart || '...'} to ${f.customEnd || '...'})` : ''}`);
  lines.push(`- **Health Status**: **${report.healthStatus || 'NO DATA'}**`);
  lines.push(`- **Generated At**: ${report.generatedAt || new Date().toISOString()}`);
  lines.push('');

  lines.push('## 1. Executive KPI Summary');
  lines.push(`- **Total Test Cases**: ${k.totalTestCases ?? 0} (${k.executedCases ?? 0} executed · ${k.coveragePct ?? 0}% coverage)`);
  lines.push(`- **Test Case Statuses**: ${k.passedCases ?? 0} Passed · ${k.failedCases ?? 0} Failed · ${k.blockedCases ?? 0} Blocked · ${k.notRunCases ?? 0} Not Run`);
  lines.push(`- **Total Executions**: ${k.totalExecutions ?? 0} (Pass Rate: **${k.passRate ?? 0}%** · Fail Rate: **${k.failRate ?? 0}%**)`);
  lines.push(`- **Test Runs**: ${k.totalTestRuns ?? 0} total (${k.inProgressTestRuns ?? 0} In Progress · ${k.completedTestRuns ?? 0} Completed)`);
  lines.push(`- **Defects**: ${k.totalDefects ?? 0} total (${k.openDefects ?? 0} Open · ${k.resolvedDefects ?? 0} Resolved/Closed · ${k.criticalOpenDefects ?? 0} Critical Open · ${k.defectResolutionRate ?? 0}% Resolution Rate)`);
  lines.push('');

  if (Array.isArray(report.insights) && report.insights.length > 0) {
    lines.push('## 2. QA Insights');
    report.insights.forEach((ins) => {
      lines.push(`- **${ins.tag} (${ins.score})**: ${ins.description}`);
    });
    lines.push('');
  }

  if (Array.isArray(report.suitesQuality) && report.suitesQuality.length > 0) {
    lines.push('## 3. Test Suites Coverage & Pass Rate');
    report.suitesQuality.forEach((sq) => {
      lines.push(
        `- **${sq.title}** (${sq.phaseName}): ${sq.totalCases} cases · ${sq.passedCases} Passed / ${sq.failedCases} Failed / ${sq.blockedCases} Blocked / ${sq.notRunCases} Not Run · Coverage ${sq.coveragePct}% · Pass Rate ${sq.passRate}%`
      );
    });
    lines.push('');
  }

  if (Array.isArray(report.testRuns) && report.testRuns.length > 0) {
    lines.push('## 4. Test Run Cycles');
    report.testRuns.forEach((run) => {
      lines.push(
        `- **${run.id} — ${run.name}** [${run.status}]: ${run.executedCases}/${run.totalCases} executed (${run.passedCases} Pass, ${run.failedCases} Fail, ${run.blockedCases} Blocked) · ${run.passRate}% Pass Rate · ${run.deviceInfo} (Build ${run.buildVersion})`
      );
    });
    lines.push('');
  }

  if (Array.isArray(report.defects) && report.defects.length > 0) {
    lines.push('## 5. Defects Breakdown & Log');
    const bySev = (report.defectsBreakdown && report.defectsBreakdown.bySeverity) || {};
    const bySt = (report.defectsBreakdown && report.defectsBreakdown.byStatus) || {};
    lines.push(
      `- **By Severity**: Critical: ${bySev.Critical ?? 0} · High: ${bySev.High ?? 0} · Medium: ${bySev.Medium ?? 0} · Low: ${bySev.Low ?? 0}`
    );
    lines.push(
      `- **By Status**: Open: ${bySt.Open ?? 0} · In Progress: ${bySt['In Progress'] ?? 0} · Ready for Retest: ${bySt['Ready for Retest'] ?? 0} · Resolved: ${bySt.Resolved ?? 0} · Closed: ${bySt.Closed ?? 0} · Reopened: ${bySt.Reopened ?? 0}`
    );
    report.defects.slice(0, 15).forEach((d) => {
      lines.push(
        `  - \`${d.id}\` [${d.severity} / ${d.status}] ${d.title}${d.linkedTestCaseId ? ` (Case: ${d.linkedTestCaseId})` : ''}`
      );
    });
    lines.push('');
  }

  if (Array.isArray(report.executions) && report.executions.length > 0) {
    lines.push('## 6. Recent Executions Log');
    report.executions.slice(0, 15).forEach((ex) => {
      lines.push(
        `- \`${ex.testCaseId}\` **${ex.verdict}** — ${ex.testCaseTitle} (${ex.tester} · ${ex.executedAt || 'Recent'})`
      );
    });
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Generates and exports a report in the requested format (`json`, `csv`, or `markdown`).
 * Uses `shareOrDownloadFile` so native Android/iOS generates actual `.json`, `.csv`, or `.md`
 * files and shares their `file://` URI via the system share sheet (`expo-sharing`), while Web
 * preserves browser Blob downloads.
 */
export async function exportGeneratedReport(report, format = 'json', options = {}) {
  try {
    if (!report || typeof report !== 'object') {
      return {
        ok: false,
        error: 'Cannot export report: No report data available.',
      };
    }

    if (!report.project || !report.project.id) {
      return {
        ok: false,
        error: 'Cannot export report: No active project selected.',
      };
    }

    const cleanFormat = String(format || 'json').toLowerCase();
    const formatMeta =
      EXPORT_FORMATS.find((f) => f.id === cleanFormat) || EXPORT_FORMATS[0];

    let content = '';
    if (formatMeta.id === 'csv') {
      content = formatReportAsCSV(report);
    } else if (formatMeta.id === 'markdown') {
      content = formatReportAsMarkdown(report);
    } else {
      content = formatReportAsJSON(report);
    }

    const safeProjectSlug = String(report.project.name || 'qavora-project')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    const dateStamp = String(report.generatedAt || new Date().toISOString()).slice(
      0,
      10
    );
    const filename = `${safeProjectSlug}-${report.reportType || 'report'}-${dateStamp}.${formatMeta.extension}`;

    const fileRes = await shareOrDownloadFile({
      filename,
      mimeType: formatMeta.mimeType,
      content,
      title: `${report.project.name} — ${report.reportTitle}`,
      skipPlatformShare: Boolean(options.skipPlatformShare),
      existingFileUri: options.existingFileUri || null,
    });

    if (!fileRes || !fileRes.ok) {
      return {
        ok: false,
        format: formatMeta.id,
        filename,
        content,
        fileUri: null,
        shared: false,
        error:
          (fileRes && fileRes.error) ||
          'Failed to generate or save report export file.',
      };
    }

    return {
      ok: true,
      format: formatMeta.id,
      formatLabel: formatMeta.label,
      filename: fileRes.filename || filename,
      mimeType: fileRes.mimeType || formatMeta.mimeType,
      content,
      sizeBytes: fileRes.sizeBytes,
      fileUri: fileRes.fileUri || null,
      shared: Boolean(fileRes.shared),
      shareMethod: fileRes.shareMethod || null,
      isEmpty: Boolean(report.isEmpty),
      error: null,
    };
  } catch (err) {
    return {
      ok: false,
      format: String(format || 'json'),
      filename: null,
      content: '',
      fileUri: null,
      shared: false,
      error:
        (err && err.message) || 'Failed to generate or export QA report.',
    };
  }
}

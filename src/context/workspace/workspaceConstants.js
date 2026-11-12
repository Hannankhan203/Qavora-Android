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

export const NAVIGATION_DESTINATIONS = {
  CREATE_CHECKLIST: 'create_checklist',
  MY_CHECKLISTS: 'my_checklists',
  QA_TEST_RUNNER: 'qa_test_runner',
  DASHBOARD: 'dashboard',
  MY_PROJECTS: 'my_projects',
  PROJECT_DETAILS: 'project_details',
  TEST_PLANS: 'test_plans',
  TEST_CASES: 'test_cases',
  TEST_SUITES: 'test_suites',
  TEST_EXECUTION: 'test_execution',
  DEFECTS: 'defects',
  REPORTS: 'reports',
  DATA_MANAGEMENT: 'data_management',
  SETTINGS: 'settings',
};

export function formatTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
    now.getDate()
  )} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

export function getProjectWorkspaceStorageKey(projectId, userId = null) {
  const userScope =
    userId && String(userId).trim() ? `${String(userId).trim()}:` : '';
  return `${WORKSPACE_STORAGE_PREFIX}${userScope}${projectId}`;
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

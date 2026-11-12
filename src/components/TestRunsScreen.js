import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Keyboard,
} from 'react-native';
import VectorIcon from './VectorIcon';
import { useTheme, monoFontFamily } from '../theme/theme';
import {
  useWorkspace,
  computeRunMetrics,
  toWebExecutionOutcome,
} from '../context/WorkspaceContext';
import {
  RUN_RESULT_FILTERS,
  HISTORY_OUTCOME_FILTERS,
  formatShortTimestamp,
} from './testRuns/testRunsHelpers';
import styles from './testRuns/testRunsStyles';
import TestRunExecutionModal from './testRuns/TestRunExecutionModal';
import TestRunFormModal from './testRuns/TestRunFormModal';
import TestRunDeleteModal from './testRuns/TestRunDeleteModal';

export default function TestRunsScreen({
  viewMode: controlledViewMode,
  onChangeViewMode,
  executingCaseId: controlledExecutingCaseId,
  onChangeExecutingCaseId,
}) {
  const { colors: theme } = useTheme();
  const {
    activeProject: currentProject,
    profile,
    suites,
    testCases,
    testRuns,
    executions,
    defects,
    selectedTestRunId,
    setSelectedTestRunId,
    setSelectedDefectId,
    setActiveTab,
    openProjectSelection,
    testRunsViewMode: contextViewMode,
    setTestRunsViewMode: setContextViewMode,
    executingTestCaseId: contextExecutingCaseId,
    setExecutingTestCaseId: setContextExecutingCaseId,
    recordTestExecution,
    createTestRun,
    updateTestRun,
    completeTestRun,
    reopenTestRun,
    deleteTestRun,
    startDefectFromFailedTest,
    isSyncingProjectData: isSyncingWorkspace,
    projectDataError: workspaceError,
    projectDataConflict: workspaceConflict,
    clearProjectDataError: clearWorkspaceError,
    reloadProjectDataFromBackend: reloadCurrentProject,
  } = useWorkspace();

  // Top-level mode: 'runs' | 'history' (Synchronized with centralized navigation state)
  const [localViewMode, setLocalViewMode] = useState(
    controlledViewMode || contextViewMode || 'runs'
  );
  const activeViewMode =
    controlledViewMode !== undefined
      ? controlledViewMode
      : contextViewMode !== undefined
      ? contextViewMode
      : localViewMode;

  const setActiveViewMode = (nextMode) => {
    const cleanMode = nextMode === 'history' ? 'history' : 'runs';
    setLocalViewMode(cleanMode);
    if (typeof onChangeViewMode === 'function') {
      onChangeViewMode(cleanMode);
    }
    if (typeof setContextViewMode === 'function') {
      setContextViewMode(cleanMode);
    }
  };

  // Filters for active run cases
  const [resultFilter, setResultFilter] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');

  // Filters for chronological execution history
  const [historyOutcomeFilter, setHistoryOutcomeFilter] = useState('All');
  const [historySearchQuery, setHistorySearchQuery] = useState('');

  // Feedback banner
  const [feedbackBanner, setFeedbackBanner] = useState(null);

  // Step-by-step Execution Runner modal state (Synchronized with centralized navigation state)
  const [localExecutingCaseId, setLocalExecutingCaseId] = useState(
    controlledExecutingCaseId !== undefined
      ? controlledExecutingCaseId
      : contextExecutingCaseId || null
  );
  const executingCaseId =
    controlledExecutingCaseId !== undefined
      ? controlledExecutingCaseId
      : contextExecutingCaseId !== undefined
      ? contextExecutingCaseId
      : localExecutingCaseId;

  const setExecutingCaseId = (nextCaseId) => {
    setLocalExecutingCaseId(nextCaseId);
    if (typeof onChangeExecutingCaseId === 'function') {
      onChangeExecutingCaseId(nextCaseId);
    }
    if (typeof setContextExecutingCaseId === 'function') {
      setContextExecutingCaseId(nextCaseId);
    }
  };
  const [execNotes, setExecNotes] = useState('');
  const [execActualResult, setExecActualResult] = useState('');
  const [execTester, setExecTester] = useState('');
  const [execEnvironment, setExecEnvironment] = useState('');
  const [execDevice, setExecDevice] = useState('');
  const [execBuildVersion, setExecBuildVersion] = useState('');
  const [stepStatuses, setStepStatuses] = useState({});
  const [isSubmittingExec, setIsSubmittingExec] = useState(false);

  // Create / Edit Test Run modal state
  const [runModalVisible, setRunModalVisible] = useState(false);
  const [editingRunId, setEditingRunId] = useState(null);
  const [runName, setRunName] = useState('');
  const [runSuiteId, setRunSuiteId] = useState('all');
  const [selectedCaseIds, setSelectedCaseIds] = useState([]);
  const [runDevice, setRunDevice] = useState('Pixel 8 Pro • Android 14 (API 34)');
  const [runBuild, setRunBuild] = useState('2.4.0-rc3 (Build 418)');
  const [runEnvironment, setRunEnvironment] = useState('Android 14 / Staging');
  const [runTester, setRunTester] = useState('');
  const [runNotes, setRunNotes] = useState('');
  const [runFormError, setRunFormError] = useState('');
  const [isSubmittingRun, setIsSubmittingRun] = useState(false);

  // Delete Run confirmation modal state
  const [runPendingDelete, setRunPendingDelete] = useState(null);
  const [isDeletingRun, setIsDeletingRun] = useState(false);

  // Run status mutation state
  const [isTogglingRunStatus, setIsTogglingRunStatus] = useState(false);

  // Refs for form keyboard UX & auto-scroll
  const execRunnerScrollRef = useRef(null);
  const execActualResultRef = useRef(null);
  const execNotesRef = useRef(null);
  const execTesterRef = useRef(null);
  const execEnvironmentRef = useRef(null);

  const runFormScrollRef = useRef(null);
  const runNameRef = useRef(null);
  const runEnvironmentRef = useRef(null);
  const runDeviceRef = useRef(null);
  const runBuildRef = useRef(null);
  const runTesterRef = useRef(null);
  const runNotesRef = useRef(null);

  const scrollRunModalTo = useCallback((scrollRef, yOffset) => {
    setTimeout(() => {
      if (
        scrollRef.current &&
        typeof scrollRef.current.scrollTo === 'function'
      ) {
        scrollRef.current.scrollTo({
          y: Math.max(0, yOffset),
          animated: true,
        });
      }
    }, 120);
  }, []);

  const showFeedback = (type, message) => {
    setFeedbackBanner({ type, message });
  };

  useEffect(() => {
    if (!feedbackBanner) return undefined;
    const timer = setTimeout(() => {
      setFeedbackBanner(null);
    }, 4000);
    return () => clearTimeout(timer);
  }, [feedbackBanner]);

  const activeRun = useMemo(() => {
    return (
      testRuns.find((r) => r.id === selectedTestRunId) || testRuns[0] || null
    );
  }, [testRuns, selectedTestRunId]);

  const activeRunMetrics = useMemo(() => {
    if (!activeRun) {
      return {
        totalCases: 0,
        executedCount: 0,
        passedCases: 0,
        failedCases: 0,
        blockedCases: 0,
        skippedCases: 0,
        notRunCases: 0,
        passRate: 0,
      };
    }
    return computeRunMetrics(activeRun.results);
  }, [activeRun]);

  const runCasesWithResults = useMemo(() => {
    if (!activeRun) return [];
    const resultsList = Array.isArray(activeRun.results)
      ? activeRun.results
      : [];
    return resultsList
      .map((res) => {
        const tcId = res.testCaseId || res.caseId;
        const tc = testCases.find((c) => c.id === tcId);
        if (!tc) {
          return {
            id: tcId,
            title: res.caseTitle || tcId,
            suiteId: res.suiteId || activeRun.suiteId || 'all',
            priority: 'P1',
            preconditions: '',
            expectedResult: '',
            steps: [],
            runResult: res,
          };
        }
        return {
          ...tc,
          runResult: res,
        };
      })
      .filter(Boolean);
  }, [activeRun, testCases]);

  const filteredRunCases = useMemo(() => {
    return runCasesWithResults.filter((item) => {
      const status = item.runResult?.status || 'Untested';
      const matchesFilter = resultFilter === 'All' || status === resultFilter;
      const q = searchQuery.trim().toLowerCase();
      const matchesSearch =
        !q ||
        String(item.title || '').toLowerCase().includes(q) ||
        String(item.id || '').toLowerCase().includes(q) ||
        String(item.runResult?.notes || '').toLowerCase().includes(q) ||
        String(item.runResult?.actualResult || '').toLowerCase().includes(q);
      return matchesFilter && matchesSearch;
    });
  }, [runCasesWithResults, resultFilter, searchQuery]);

  // Applicable test cases for the Create/Edit Run modal based on suite scope
  const candidateCasesForModal = useMemo(() => {
    if (!runSuiteId || runSuiteId === 'all' || runSuiteId === 'ALL') {
      return testCases;
    }
    return testCases.filter((tc) => tc.suiteId === runSuiteId);
  }, [testCases, runSuiteId]);

  // Filtered chronological execution history
  const filteredExecutions = useMemo(() => {
    const list = Array.isArray(executions) ? executions : [];
    return list.filter((exec) => {
      const webOutcome = toWebExecutionOutcome(exec.status);
      const matchesOutcome =
        historyOutcomeFilter === 'All' || webOutcome === historyOutcomeFilter;
      const q = historySearchQuery.trim().toLowerCase();
      const matchesQuery =
        !q ||
        String(exec.caseId || exec.testCaseId || '')
          .toLowerCase()
          .includes(q) ||
        String(exec.caseTitle || '').toLowerCase().includes(q) ||
        String(exec.runId || '').toLowerCase().includes(q) ||
        String(exec.tester || '').toLowerCase().includes(q) ||
        String(exec.actualResult || '').toLowerCase().includes(q) ||
        String(exec.notes || '').toLowerCase().includes(q) ||
        String(exec.environment || '').toLowerCase().includes(q);
      return matchesOutcome && matchesQuery;
    });
  }, [executions, historyOutcomeFilter, historySearchQuery]);

  const executingCase = useMemo(() => {
    if (!executingCaseId) return null;
    return runCasesWithResults.find((c) => c.id === executingCaseId) || null;
  }, [executingCaseId, runCasesWithResults]);

  const openExecutionModal = (caseItem) => {
    setExecutingCaseId(caseItem.id);
    setExecNotes(caseItem.runResult?.notes || '');
    setExecActualResult(caseItem.runResult?.actualResult || '');
    setExecTester(
      caseItem.runResult?.tester ||
        activeRun?.tester ||
        profile?.testerName ||
        'QA Engineer'
    );
    setExecEnvironment(
      caseItem.runResult?.environment ||
        activeRun?.environment ||
        currentProject?.environment ||
        'Android 14 / Staging'
    );
    setExecDevice(
      caseItem.runResult?.device ||
        activeRun?.deviceInfo ||
        profile?.defaultDevice ||
        'Pixel 8 Pro • Android 14'
    );
    setExecBuildVersion(
      caseItem.runResult?.buildVersion ||
        activeRun?.buildVersion ||
        currentProject?.version ||
        profile?.defaultBuild ||
        '2.4.0-rc3'
    );
    const existingSteps = caseItem.runResult?.stepStatuses || {};
    const initialSteps = {};
    (caseItem.steps || []).forEach((_, idx) => {
      initialSteps[idx] = existingSteps[idx] || 'Untested';
    });
    setStepStatuses(initialSteps);
  };

  const toggleStepStatus = (idx, nextStatus) => {
    setStepStatuses((prev) => ({
      ...prev,
      [idx]: prev[idx] === nextStatus ? 'Untested' : nextStatus,
    }));
  };

  const markAllStepsPassed = () => {
    if (!executingCase) return;
    const next = {};
    (executingCase.steps || []).forEach((_, idx) => {
      next[idx] = 'Passed';
    });
    setStepStatuses(next);
  };

  const handleSaveExecution = async (finalStatus, andCreateDefect = false) => {
    if (!activeRun || !executingCase || isSubmittingExec) return;
    Keyboard.dismiss();
    setIsSubmittingExec(true);
    try {
      const resolvedActual =
        execActualResult.trim() ||
        (finalStatus === 'Passed' || finalStatus === 'Pass'
          ? executingCase.expectedResult || 'Verified expected behavior.'
          : '');
      const res = await recordTestExecution({
        testRunId: activeRun.id,
        testCaseId: executingCase.id,
        status: finalStatus,
        notes: execNotes.trim(),
        actualResult: resolvedActual,
        tester: execTester.trim(),
        environment: execEnvironment.trim(),
        device: execDevice.trim(),
        buildVersion: execBuildVersion.trim(),
        stepStatuses,
      });

      if (!res?.ok) {
        showFeedback('error', res?.error || 'Failed to save test execution.');
        return;
      }

      const targetCase = executingCase;
      const recordedActual =
        resolvedActual ||
        execNotes.trim() ||
        'Observed failure during test execution.';
      const recordedNotes = execNotes.trim();
      const recordedExecId = res.execution?.id || null;

      setExecutingCaseId(null);
      showFeedback(
        'success',
        `Recorded "${toWebExecutionOutcome(finalStatus)}" for ${targetCase.id}.`
      );

      if (andCreateDefect) {
        startDefectFromFailedTest({
          testRun: activeRun,
          testCase: targetCase,
          actualResult: recordedActual,
          notes: recordedNotes,
          executionId: recordedExecId,
        });
      }
    } finally {
      setIsSubmittingExec(false);
    }
  };

  const handleQuickOutcome = async (caseItem, status) => {
    if (!activeRun || isSubmittingExec) return;
    setIsSubmittingExec(true);
    try {
      const res = await recordTestExecution({
        testRunId: activeRun.id,
        testCaseId: caseItem.id,
        status,
        notes: caseItem.runResult?.notes || '',
        actualResult:
          caseItem.runResult?.actualResult ||
          (status === 'Passed'
            ? caseItem.expectedResult || 'Verified expected behavior.'
            : ''),
        tester:
          caseItem.runResult?.tester ||
          activeRun.tester ||
          profile?.testerName ||
          'QA Engineer',
        environment:
          caseItem.runResult?.environment ||
          activeRun.environment ||
          'Android 14 / Staging',
        device: caseItem.runResult?.device || activeRun.deviceInfo || '',
        buildVersion:
          caseItem.runResult?.buildVersion || activeRun.buildVersion || '',
        stepStatuses: caseItem.runResult?.stepStatuses || {},
      });
      if (!res?.ok) {
        showFeedback(
          'error',
          res?.error || 'Failed to update execution result.'
        );
      } else {
        showFeedback(
          'success',
          `${caseItem.id} marked as ${toWebExecutionOutcome(status)}.`
        );
      }
    } finally {
      setIsSubmittingExec(false);
    }
  };

  const openCreateRunModal = () => {
    setEditingRunId(null);
    setRunName('');
    setRunSuiteId('all');
    setSelectedCaseIds(testCases.map((tc) => tc.id));
    setRunDevice(
      profile?.defaultDevice || 'Pixel 8 Pro • Android 14 (API 34)'
    );
    setRunBuild(
      currentProject?.version || profile?.defaultBuild || '2.4.0-rc3'
    );
    setRunEnvironment(
      currentProject?.environment || 'Android 14 / Staging'
    );
    setRunTester(profile?.testerName || 'QA Engineer');
    setRunNotes('');
    setRunFormError('');
    setRunModalVisible(true);
  };

  const openEditRunModal = (run) => {
    if (!run) return;
    setEditingRunId(run.id);
    setRunName(run.name || '');
    setRunSuiteId(run.suiteId || 'all');
    const existingCaseIds = (run.results || [])
      .map((r) => r.testCaseId || r.caseId)
      .filter(Boolean);
    setSelectedCaseIds(
      existingCaseIds.length > 0
        ? existingCaseIds
        : testCases.map((tc) => tc.id)
    );
    setRunDevice(run.deviceInfo || 'Pixel 8 Pro • Android 14 (API 34)');
    setRunBuild(run.buildVersion || '2.4.0-rc3');
    setRunEnvironment(run.environment || 'Android 14 / Staging');
    setRunTester(run.tester || profile?.testerName || 'QA Engineer');
    setRunNotes(run.notes || '');
    setRunFormError('');
    setRunModalVisible(true);
  };

  const handleChangeRunSuiteScope = (nextSuiteId) => {
    setRunSuiteId(nextSuiteId);
    const matching =
      nextSuiteId === 'all' || nextSuiteId === 'ALL'
        ? testCases
        : testCases.filter((tc) => tc.suiteId === nextSuiteId);
    setSelectedCaseIds(matching.map((tc) => tc.id));
  };

  const toggleCandidateCaseSelection = (caseId) => {
    setSelectedCaseIds((prev) =>
      prev.includes(caseId)
        ? prev.filter((id) => id !== caseId)
        : [...prev, caseId]
    );
  };

  const handleSaveRunModal = async () => {
    if (isSubmittingRun) return;
    if (!runName.trim()) {
      setRunFormError('Run name is required.');
      return;
    }
    if (testCases.length > 0 && selectedCaseIds.length === 0) {
      setRunFormError('Select at least one applicable test case for this run.');
      return;
    }

    Keyboard.dismiss();
    setRunFormError('');
    setIsSubmittingRun(true);
    try {
      const payload = {
        name: runName.trim(),
        suiteId: runSuiteId,
        testCaseIds: selectedCaseIds,
        deviceInfo: runDevice.trim(),
        buildVersion: runBuild.trim(),
        environment: runEnvironment.trim(),
        tester: runTester.trim(),
        notes: runNotes.trim(),
      };

      const res = editingRunId
        ? await updateTestRun(editingRunId, payload)
        : await createTestRun(payload);

      if (!res?.ok) {
        setRunFormError(res?.error || 'Failed to save test run.');
        return;
      }

      setRunModalVisible(false);
      showFeedback(
        'success',
        editingRunId
          ? `Updated test run "${runName.trim()}".`
          : `Created test run "${runName.trim()}".`
      );
    } finally {
      setIsSubmittingRun(false);
    }
  };

  const handleToggleRunCompletion = async () => {
    if (!activeRun || isTogglingRunStatus) return;
    setIsTogglingRunStatus(true);
    try {
      const isCompleted = activeRun.status === 'Completed';
      const res = isCompleted
        ? await reopenTestRun(activeRun.id)
        : await completeTestRun(activeRun.id);

      if (!res?.ok) {
        showFeedback('error', res?.error || 'Failed to update run status.');
      } else {
        showFeedback(
          'success',
          isCompleted
            ? `Reopened "${activeRun.name}".`
            : `Marked "${activeRun.name}" as Completed.`
        );
      }
    } finally {
      setIsTogglingRunStatus(false);
    }
  };

  const handleConfirmDeleteRun = async () => {
    if (!runPendingDelete || isDeletingRun) return;
    setIsDeletingRun(true);
    try {
      const targetName = runPendingDelete.name;
      const res = await deleteTestRun(runPendingDelete.id);
      if (!res?.ok) {
        showFeedback('error', res?.error || 'Failed to delete test run.');
      } else {
        setRunPendingDelete(null);
        showFeedback('success', `Deleted test run "${targetName}".`);
      }
    } finally {
      setIsDeletingRun(false);
    }
  };

  const getStatusMeta = (status) => {
    if (status === 'Passed' || status === 'Pass') {
      return {
        color: theme.success,
        bg: theme.successSoft,
        icon: 'check',
        label: status === 'Pass' ? 'Pass' : 'Passed',
        webOutcome: 'Pass',
      };
    }
    if (status === 'Failed' || status === 'Fail') {
      return {
        color: theme.danger,
        bg: theme.dangerSoft,
        icon: 'close',
        label: status === 'Fail' ? 'Fail' : 'Failed',
        webOutcome: 'Fail',
      };
    }
    if (status === 'Blocked') {
      return {
        color: theme.warning,
        bg: theme.warningSoft,
        icon: 'alert',
        label: 'Blocked',
        webOutcome: 'Blocked',
      };
    }
    return {
      color: theme.textMuted,
      bg: theme.surfaceMuted,
      icon: 'info',
      label: status === 'Not Run' ? 'Not Run' : 'Untested',
      webOutcome: 'Not Run',
    };
  };

  const getSuiteName = (suiteId) => {
    if (!suiteId || suiteId === 'all' || suiteId === 'ALL') return 'All Suites';
    return suites.find((s) => s.id === suiteId)?.name || suiteId;
  };

  if (!currentProject) {
    return (
      <View
        style={[
          styles.emptyWorkspaceWrap,
          { backgroundColor: theme.background },
        ]}
      >
        <View
          style={[
            styles.emptyWorkspaceCard,
            { backgroundColor: theme.surface, borderColor: theme.border },
          ]}
        >
          <VectorIcon name="folder" size={32} color={theme.primary} />
          <Text style={[styles.emptyWorkspaceTitle, { color: theme.text }]}>
            No Active Project Selected
          </Text>
          <Text
            style={[
              styles.emptyWorkspaceSub,
              { color: theme.textSecondary },
            ]}
          >
            Select or create a project first to manage test runs and record execution results.
          </Text>
          <TouchableOpacity
            style={[
              styles.primaryActionBtn,
              { backgroundColor: theme.primary },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Select Project"
            onPress={openProjectSelection}
          >
            <VectorIcon name="folder" size={15} color="#FFFFFF" />
            <Text style={styles.primaryActionBtnText}>Select Project</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Top Project Context & Sync Status Strip */}
      <View
        style={[
          styles.projectStrip,
          {
            backgroundColor: theme.surface,
            borderBottomColor: theme.border,
          },
        ]}
      >
        <View style={styles.projectStripLeft}>
          <View
            style={[styles.projectDot, { backgroundColor: theme.primary }]}
          />
          <Text
            style={[styles.projectStripName, { color: theme.text }]}
            numberOfLines={1}
          >
            {currentProject.name}
          </Text>
          <View
            style={[
              styles.projectStatusBadge,
              { backgroundColor: theme.primarySoft },
            ]}
          >
            <Text
              style={[styles.projectStatusBadgeText, { color: theme.primary }]}
            >
              {currentProject.status || 'active'}
            </Text>
          </View>
        </View>

        <View style={styles.projectStripRight}>
          {isSyncingWorkspace && (
            <View style={styles.syncIndicator}>
              <ActivityIndicator size="small" color={theme.primary} />
              <Text
                style={[styles.syncIndicatorText, { color: theme.primary }]}
              >
                Saving...
              </Text>
            </View>
          )}
          <TouchableOpacity
            style={[
              styles.iconRefreshBtn,
              {
                backgroundColor: theme.surfaceElevated,
                borderColor: theme.border,
              },
            ]}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityState={{ disabled: Boolean(isSyncingWorkspace) }}
            accessibilityLabel="Refresh test runs"
            onPress={() => reloadCurrentProject()}
            disabled={isSyncingWorkspace}
          >
            <VectorIcon name="refresh" size={13} color={theme.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Workspace Conflict / API Error Banner */}
      {workspaceError ? (
        <View
          style={[
            styles.alertBanner,
            {
              backgroundColor: theme.dangerSoft,
              borderColor: theme.danger,
            },
          ]}
        >
          <View style={styles.alertBannerTop}>
            <VectorIcon name="alert" size={16} color={theme.danger} />
            <Text style={[styles.alertBannerText, { color: theme.danger }]}>
              {workspaceError}
            </Text>
          </View>
          <View style={styles.alertBannerActions}>
            {workspaceConflict && (
              <TouchableOpacity
                style={[
                  styles.alertBannerBtn,
                  { backgroundColor: theme.danger },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Reload Latest Project Data"
                onPress={() => reloadCurrentProject()}
              >
                <VectorIcon name="refresh" size={12} color="#FFFFFF" />
                <Text style={styles.alertBannerBtnText}>
                  Reload Latest Project Data
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[
                styles.alertBannerDismiss,
                { borderColor: theme.danger },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Dismiss workspace error"
              onPress={clearWorkspaceError}
            >
              <Text
                style={[styles.alertBannerDismissText, { color: theme.danger }]}
              >
                Dismiss
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {/* Transient Feedback Banner */}
      {feedbackBanner ? (
        <View
          style={[
            styles.feedbackBanner,
            {
              backgroundColor:
                feedbackBanner.type === 'error'
                  ? theme.dangerSoft
                  : theme.successSoft,
              borderColor:
                feedbackBanner.type === 'error' ? theme.danger : theme.success,
            },
          ]}
        >
          <VectorIcon
            name={feedbackBanner.type === 'error' ? 'alert' : 'check'}
            size={15}
            color={
              feedbackBanner.type === 'error' ? theme.danger : theme.success
            }
          />
          <Text
            style={[
              styles.feedbackBannerText,
              {
                color:
                  feedbackBanner.type === 'error'
                    ? theme.danger
                    : theme.success,
              },
            ]}
          >
            {feedbackBanner.message}
          </Text>
        </View>
      ) : null}

      {/* Mode Switcher: Test Runs vs Execution History */}
      <View
        style={[
          styles.modeSwitcherWrap,
          {
            backgroundColor: theme.surface,
            borderBottomColor: theme.border,
          },
        ]}
      >
        <View
          accessibilityRole="tablist"
          style={[
            styles.modeSwitcherTrack,
            {
              backgroundColor: theme.surfaceMuted,
              borderColor: theme.border,
            },
          ]}
        >
          <TouchableOpacity
            style={[
              styles.modeTab,
              activeViewMode === 'runs' && {
                backgroundColor: theme.primary,
              },
            ]}
            hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeViewMode === 'runs' }}
            accessibilityLabel={`Test Runs (${testRuns.length})`}
            onPress={() => setActiveViewMode('runs')}
          >
            <VectorIcon
              name="layers"
              size={14}
              color={
                activeViewMode === 'runs' ? '#FFFFFF' : theme.textSecondary
              }
            />
            <Text
              style={[
                styles.modeTabText,
                {
                  color:
                    activeViewMode === 'runs' ? '#FFFFFF' : theme.textSecondary,
                },
              ]}
            >
              Test Runs ({testRuns.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.modeTab,
              activeViewMode === 'history' && {
                backgroundColor: theme.primary,
              },
            ]}
            hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeViewMode === 'history' }}
            accessibilityLabel={`Execution History (${
              executions?.length || 0
            })`}
            onPress={() => setActiveViewMode('history')}
          >
            <VectorIcon
              name="calendar"
              size={14}
              color={
                activeViewMode === 'history' ? '#FFFFFF' : theme.textSecondary
              }
            />
            <Text
              style={[
                styles.modeTabText,
                {
                  color:
                    activeViewMode === 'history'
                      ? '#FFFFFF'
                      : theme.textSecondary,
                },
              ]}
            >
              Execution History ({executions?.length || 0})
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.newRunTopBtn, { backgroundColor: theme.primary }]}
          hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
          accessibilityRole="button"
          accessibilityLabel="Create New Test Run"
          onPress={openCreateRunModal}
        >
          <VectorIcon name="plus" size={14} color="#FFFFFF" />
          <Text style={styles.newRunTopBtnText}>New Run</Text>
        </TouchableOpacity>
      </View>

      {activeViewMode === 'runs' ? (
        <>
          {/* Horizontal Run Selector Bar */}
          <View
            style={[
              styles.runSelectorBar,
              {
                backgroundColor: theme.surface,
                borderBottomColor: theme.border,
              },
            ]}
          >
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.runListScroll}
            >
              {testRuns.map((run) => {
                const isSelected = activeRun?.id === run.id;
                const metrics = computeRunMetrics(run.results);
                const completionPct =
                  metrics.totalCases > 0
                    ? Math.round(
                        (metrics.executedCount / metrics.totalCases) * 100
                      )
                    : 0;

                return (
                  <TouchableOpacity
                    key={run.id}
                    onPress={() => setSelectedTestRunId(run.id)}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: isSelected }}
                    accessibilityLabel={`Select test run ${run.id} ${run.name}, status ${run.status}`}
                    style={[
                      styles.runTabCard,
                      {
                        backgroundColor: isSelected
                          ? theme.primarySoft
                          : theme.surfaceElevated,
                        borderColor: isSelected ? theme.primary : theme.border,
                      },
                    ]}
                  >
                    <View style={styles.runTabTop}>
                      <Text
                        style={[
                          styles.runTabId,
                          {
                            color: isSelected
                              ? theme.primary
                              : theme.textMuted,
                            fontFamily: monoFontFamily,
                          },
                        ]}
                      >
                        {run.id}
                      </Text>
                      <View
                        style={[
                          styles.runStatusPill,
                          {
                            backgroundColor:
                              run.status === 'Completed'
                                ? theme.successSoft
                                : theme.warningSoft,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.runStatusText,
                            {
                              color:
                                run.status === 'Completed'
                                  ? theme.success
                                  : theme.warning,
                            },
                          ]}
                        >
                          {run.status}
                        </Text>
                      </View>
                    </View>
                    <Text
                      style={[styles.runTabName, { color: theme.text }]}
                      numberOfLines={1}
                    >
                      {run.name}
                    </Text>
                    <View style={styles.runMiniProgress}>
                      <View
                        style={[
                          styles.runMiniTrack,
                          { backgroundColor: theme.border },
                        ]}
                      >
                        <View
                          style={[
                            styles.runMiniFill,
                            {
                              width: `${completionPct}%`,
                              backgroundColor:
                                metrics.failedCases > 0
                                  ? theme.danger
                                  : theme.success,
                            },
                          ]}
                        />
                      </View>
                      <Text
                        style={[
                          styles.runMiniPct,
                          { color: theme.textSecondary },
                        ]}
                      >
                        {metrics.passedCases}P • {metrics.failedCases}F •{' '}
                        {completionPct}%
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>

          {activeRun ? (
            <ScrollView
              style={styles.container}
              contentContainerStyle={styles.contentContainer}
              showsVerticalScrollIndicator={false}
            >
              {/* Active Run Summary & Metadata Card */}
              <View
                style={[
                  styles.summaryCard,
                  {
                    backgroundColor: theme.surface,
                    borderColor: theme.border,
                  },
                ]}
              >
                <View style={styles.summaryTopRow}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.summaryTitleRow}>
                      <Text
                        style={[
                          styles.summaryRunId,
                          {
                            color: theme.primary,
                            fontFamily: monoFontFamily,
                          },
                        ]}
                      >
                        {activeRun.id}
                      </Text>
                      <View
                        style={[
                          styles.runStatusPill,
                          {
                            backgroundColor:
                              activeRun.status === 'Completed'
                                ? theme.successSoft
                                : theme.warningSoft,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.runStatusText,
                            {
                              color:
                                activeRun.status === 'Completed'
                                  ? theme.success
                                  : theme.warning,
                            },
                          ]}
                        >
                          {activeRun.status}
                        </Text>
                      </View>
                    </View>
                    <Text
                      style={[styles.summaryRunTitle, { color: theme.text }]}
                    >
                      {activeRun.name}
                    </Text>
                    <Text
                      style={[
                        styles.summaryMeta,
                        { color: theme.textSecondary },
                      ]}
                    >
                      Scope: {getSuiteName(activeRun.suiteId)} •{' '}
                      {activeRun.deviceInfo || 'Android Device'} • Build:{' '}
                      {activeRun.buildVersion || 'N/A'}
                    </Text>
                    <Text
                      style={[
                        styles.summarySubMeta,
                        { color: theme.textMuted },
                      ]}
                    >
                      Env: {activeRun.environment || 'Android 14 / Staging'} •
                      Tester: {activeRun.tester || 'QA Engineer'} • Started{' '}
                      {formatShortTimestamp(
                        activeRun.startedAt || activeRun.createdAt
                      )}
                      {activeRun.completedAt
                        ? ` • Completed ${formatShortTimestamp(
                            activeRun.completedAt
                          )}`
                        : ''}
                    </Text>
                    {activeRun.notes ? (
                      <Text
                        style={[
                          styles.summaryRunNotes,
                          { color: theme.textSecondary },
                        ]}
                      >
                        Note: {activeRun.notes}
                      </Text>
                    ) : null}
                  </View>
                </View>

                {/* Run Action Controls */}
                <View style={styles.runManagementRow}>
                  <TouchableOpacity
                    style={[
                      styles.completeRunBtn,
                      {
                        backgroundColor:
                          activeRun.status === 'Completed'
                            ? theme.surfaceElevated
                            : theme.successSoft,
                        borderColor:
                          activeRun.status === 'Completed'
                            ? theme.border
                            : theme.success,
                      },
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{
                      disabled: Boolean(isTogglingRunStatus),
                    }}
                    accessibilityLabel={
                      activeRun.status === 'Completed'
                        ? 'Reopen test run'
                        : 'Complete test run'
                    }
                    onPress={handleToggleRunCompletion}
                    disabled={isTogglingRunStatus}
                  >
                    <VectorIcon
                      name={
                        activeRun.status === 'Completed' ? 'refresh' : 'check'
                      }
                      size={14}
                      color={
                        activeRun.status === 'Completed'
                          ? theme.textSecondary
                          : theme.success
                      }
                    />
                    <Text
                      style={[
                        styles.completeRunBtnText,
                        {
                          color:
                            activeRun.status === 'Completed'
                              ? theme.textSecondary
                              : theme.success,
                        },
                      ]}
                    >
                      {activeRun.status === 'Completed'
                        ? 'Reopen Run'
                        : 'Complete Run'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.secondaryRunBtn,
                      {
                        backgroundColor: theme.surfaceElevated,
                        borderColor: theme.border,
                      },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`Edit test run ${activeRun.name}`}
                    onPress={() => openEditRunModal(activeRun)}
                  >
                    <VectorIcon
                      name="edit"
                      size={13}
                      color={theme.textSecondary}
                    />
                    <Text
                      style={[
                        styles.secondaryRunBtnText,
                        { color: theme.textSecondary },
                      ]}
                    >
                      Edit Run
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.secondaryRunBtn,
                      {
                        backgroundColor: theme.dangerSoft,
                        borderColor: theme.danger,
                      },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete test run ${activeRun.name}`}
                    onPress={() => setRunPendingDelete(activeRun)}
                  >
                    <VectorIcon name="trash" size={13} color={theme.danger} />
                    <Text
                      style={[
                        styles.secondaryRunBtnText,
                        { color: theme.danger },
                      ]}
                    >
                      Delete
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Run Progress Bar & Metrics */}
                <View style={styles.progressSection}>
                  <View style={styles.progressHeader}>
                    <Text
                      style={[
                        styles.progressLabel,
                        { color: theme.textSecondary },
                      ]}
                    >
                      Execution Progress ({activeRunMetrics.executedCount} of{' '}
                      {activeRunMetrics.totalCases} executed)
                    </Text>
                    <Text
                      style={[styles.progressPct, { color: theme.primary }]}
                    >
                      Pass Rate: {activeRunMetrics.passRate}%
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.progressTrack,
                      { backgroundColor: theme.surfaceMuted },
                    ]}
                  >
                    <View
                      style={[
                        styles.progressFill,
                        {
                          width: `${
                            activeRunMetrics.totalCases > 0
                              ? Math.round(
                                  (activeRunMetrics.executedCount /
                                    activeRunMetrics.totalCases) *
                                    100
                                )
                              : 0
                          }%`,
                          backgroundColor: theme.primary,
                        },
                      ]}
                    />
                  </View>
                </View>

                <View style={styles.counterRow}>
                  {[
                    {
                      label: 'Pass',
                      filterKey: 'Passed',
                      val: activeRunMetrics.passedCases,
                      color: theme.success,
                      bg: theme.successSoft,
                    },
                    {
                      label: 'Fail',
                      filterKey: 'Failed',
                      val: activeRunMetrics.failedCases,
                      color: theme.danger,
                      bg: theme.dangerSoft,
                    },
                    {
                      label: 'Blocked',
                      filterKey: 'Blocked',
                      val: activeRunMetrics.blockedCases,
                      color: theme.warning,
                      bg: theme.warningSoft,
                    },
                    {
                      label: 'Not Run',
                      filterKey: 'Untested',
                      val: activeRunMetrics.notRunCases,
                      color: theme.textSecondary,
                      bg: theme.surfaceMuted,
                    },
                  ].map((item) => (
                    <TouchableOpacity
                      key={item.label}
                      accessibilityRole="tab"
                      accessibilityState={{
                        selected: resultFilter === item.filterKey,
                      }}
                      accessibilityLabel={`Filter run by ${item.label}: ${item.val} cases`}
                      style={[
                        styles.counterChip,
                        {
                          backgroundColor: item.bg,
                          borderColor:
                            resultFilter === item.filterKey
                              ? item.color
                              : 'transparent',
                        },
                      ]}
                      onPress={() =>
                        setResultFilter(
                          resultFilter === item.filterKey
                            ? 'All'
                            : item.filterKey
                        )
                      }
                    >
                      <Text
                        style={[styles.counterVal, { color: item.color }]}
                      >
                        {item.val}
                      </Text>
                      <Text
                        style={[styles.counterLabel, { color: item.color }]}
                      >
                        {item.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Search & Filter Row */}
              <View style={styles.filterControls}>
                <View
                  style={[
                    styles.searchBox,
                    {
                      backgroundColor: theme.surface,
                      borderColor: theme.border,
                    },
                  ]}
                >
                  <VectorIcon name="search" size={16} color={theme.textMuted} />
                  <TextInput
                    style={[styles.searchInput, { color: theme.text }]}
                    placeholder="Filter run test cases by ID, title, or notes..."
                    placeholderTextColor={theme.textMuted}
                    accessibilityLabel="Filter run test cases by ID, title, or notes"
                    returnKeyType="search"
                    onSubmitEditing={() => Keyboard.dismiss()}
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                  />
                  {searchQuery.length > 0 && (
                    <TouchableOpacity
                      onPress={() => setSearchQuery('')}
                      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                      accessibilityRole="button"
                      accessibilityLabel="Clear test run search"
                    >
                      <VectorIcon
                        name="close"
                        size={14}
                        color={theme.textMuted}
                      />
                    </TouchableOpacity>
                  )}
                </View>

                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.filterTabsScroll}
                >
                  {RUN_RESULT_FILTERS.map((f) => {
                    const active = resultFilter === f;
                    return (
                      <TouchableOpacity
                        key={f}
                        onPress={() => setResultFilter(f)}
                        hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                        accessibilityRole="tab"
                        accessibilityState={{ selected: active }}
                        accessibilityLabel={`Filter run results: ${
                          f === 'Untested' ? 'Not Run or Untested' : f
                        }`}
                        style={[
                          styles.filterPill,
                          {
                            backgroundColor: active
                              ? theme.primary
                              : theme.surface,
                            borderColor: active ? theme.primary : theme.border,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.filterPillText,
                            {
                              color: active ? '#FFFFFF' : theme.textSecondary,
                            },
                          ]}
                        >
                          {f === 'Untested' ? 'Not Run / Untested' : f}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>

              {/* Test Case Execution List */}
              {filteredRunCases.map((tc) => {
                const status = tc.runResult?.status || 'Untested';
                const sMeta = getStatusMeta(status);
                const linkedDefect = defects.find(
                  (d) =>
                    d.id === tc.runResult?.linkedDefectId ||
                    d.defectId === tc.runResult?.linkedDefectId ||
                    (d.linkedTestCaseId === tc.id &&
                      d.linkedTestRunId === activeRun.id)
                );

                return (
                  <View
                    key={tc.id}
                    style={[
                      styles.execCaseCard,
                      {
                        backgroundColor: theme.surface,
                        borderColor: theme.border,
                      },
                    ]}
                  >
                    <TouchableOpacity
                      activeOpacity={0.85}
                      accessibilityRole="button"
                      accessibilityLabel={`Execute test case ${tc.id}: ${tc.title}, status ${sMeta.webOutcome}`}
                      onPress={() => openExecutionModal(tc)}
                    >
                      <View style={styles.execCardTop}>
                        <View style={styles.execIdWrap}>
                          <Text
                            style={[
                              styles.execId,
                              {
                                color: theme.primary,
                                fontFamily: monoFontFamily,
                              },
                            ]}
                          >
                            {tc.id}
                          </Text>
                          <View
                            style={[
                              styles.execBadge,
                              { backgroundColor: sMeta.bg },
                            ]}
                          >
                            <VectorIcon
                              name={sMeta.icon}
                              size={11}
                              color={sMeta.color}
                            />
                            <Text
                              style={[
                                styles.execBadgeText,
                                { color: sMeta.color },
                              ]}
                            >
                              {sMeta.webOutcome} ({sMeta.label})
                            </Text>
                          </View>
                        </View>
                        <Text
                          style={[
                            styles.execStepsCount,
                            { color: theme.textMuted },
                          ]}
                        >
                          {tc.steps?.length || 0} steps
                        </Text>
                      </View>

                      <Text style={[styles.execTitle, { color: theme.text }]}>
                        {tc.title}
                      </Text>

                      {tc.runResult?.actualResult ? (
                        <View
                          style={[
                            styles.execNotesBox,
                            {
                              backgroundColor: theme.surfaceMuted,
                              borderColor: theme.border,
                            },
                          ]}
                        >
                          <VectorIcon
                            name="check"
                            size={12}
                            color={theme.primary}
                          />
                          <Text
                            style={[
                              styles.execNotesText,
                              { color: theme.textSecondary },
                            ]}
                          >
                            Actual: {tc.runResult.actualResult}
                          </Text>
                        </View>
                      ) : null}

                      {tc.runResult?.notes ? (
                        <View
                          style={[
                            styles.execNotesBox,
                            {
                              backgroundColor: theme.surfaceMuted,
                              borderColor: theme.border,
                            },
                          ]}
                        >
                          <VectorIcon
                            name="info"
                            size={12}
                            color={theme.textSecondary}
                          />
                          <Text
                            style={[
                              styles.execNotesText,
                              { color: theme.textSecondary },
                            ]}
                          >
                            Notes: {tc.runResult.notes}
                          </Text>
                        </View>
                      ) : null}

                      {tc.runResult?.executedAt ? (
                        <Text
                          style={[
                            styles.execTimestampText,
                            { color: theme.textMuted },
                          ]}
                        >
                          Executed{' '}
                          {formatShortTimestamp(tc.runResult.executedAt)} by{' '}
                          {tc.runResult.tester || 'QA Engineer'} •{' '}
                          {tc.runResult.environment ||
                            activeRun.environment ||
                            'Staging'}
                        </Text>
                      ) : null}

                      {linkedDefect && (
                        <TouchableOpacity
                          style={[
                            styles.linkedBugChip,
                            {
                              backgroundColor: theme.dangerSoft,
                              borderColor: theme.danger,
                            },
                          ]}
                          accessibilityRole="button"
                          accessibilityLabel={`Open linked defect ${
                            linkedDefect.defectId || linkedDefect.id
                          }, ${linkedDefect.status}`}
                          onPress={() => {
                            setSelectedDefectId(linkedDefect.id);
                            setActiveTab('defects');
                          }}
                        >
                          <VectorIcon
                            name="alert"
                            size={12}
                            color={theme.danger}
                          />
                          <Text
                            style={[
                              styles.linkedBugText,
                              { color: theme.danger },
                            ]}
                          >
                            Linked Defect:{' '}
                            {linkedDefect.defectId || linkedDefect.id} (
                            {linkedDefect.status})
                          </Text>
                        </TouchableOpacity>
                      )}
                    </TouchableOpacity>

                    {/* Quick Outcome Controls + Step Runner */}
                    <View
                      style={[
                        styles.quickActionRow,
                        { borderTopColor: theme.border },
                      ]}
                    >
                      <View style={styles.quickStatusGroup}>
                        <TouchableOpacity
                          style={[
                            styles.quickBtn,
                            {
                              backgroundColor:
                                status === 'Passed'
                                  ? theme.success
                                  : theme.successSoft,
                            },
                          ]}
                          accessibilityRole="button"
                          accessibilityState={{
                            selected: status === 'Passed',
                            disabled: Boolean(isSubmittingExec),
                          }}
                          accessibilityLabel={`Mark ${tc.id} passed`}
                          onPress={() => handleQuickOutcome(tc, 'Passed')}
                          disabled={isSubmittingExec}
                        >
                          <VectorIcon
                            name="check"
                            size={12}
                            color={
                              status === 'Passed' ? '#FFFFFF' : theme.success
                            }
                          />
                          <Text
                            style={[
                              styles.quickBtnText,
                              {
                                color:
                                  status === 'Passed'
                                    ? '#FFFFFF'
                                    : theme.success,
                              },
                            ]}
                          >
                            Pass
                          </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[
                            styles.quickBtn,
                            {
                              backgroundColor:
                                status === 'Failed'
                                  ? theme.danger
                                  : theme.dangerSoft,
                            },
                          ]}
                          accessibilityRole="button"
                          accessibilityState={{
                            selected: status === 'Failed',
                            disabled: Boolean(isSubmittingExec),
                          }}
                          accessibilityLabel={`Mark ${tc.id} failed`}
                          onPress={() => handleQuickOutcome(tc, 'Failed')}
                          disabled={isSubmittingExec}
                        >
                          <VectorIcon
                            name="close"
                            size={12}
                            color={
                              status === 'Failed' ? '#FFFFFF' : theme.danger
                            }
                          />
                          <Text
                            style={[
                              styles.quickBtnText,
                              {
                                color:
                                  status === 'Failed'
                                    ? '#FFFFFF'
                                    : theme.danger,
                              },
                            ]}
                          >
                            Fail
                          </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[
                            styles.quickBtn,
                            {
                              backgroundColor:
                                status === 'Blocked'
                                  ? theme.warning
                                  : theme.warningSoft,
                            },
                          ]}
                          accessibilityRole="button"
                          accessibilityState={{
                            selected: status === 'Blocked',
                            disabled: Boolean(isSubmittingExec),
                          }}
                          accessibilityLabel={`Mark ${tc.id} blocked`}
                          onPress={() => handleQuickOutcome(tc, 'Blocked')}
                          disabled={isSubmittingExec}
                        >
                          <VectorIcon
                            name="alert"
                            size={12}
                            color={
                              status === 'Blocked' ? '#FFFFFF' : theme.warning
                            }
                          />
                          <Text
                            style={[
                              styles.quickBtnText,
                              {
                                color:
                                  status === 'Blocked'
                                    ? '#FFFFFF'
                                    : theme.warning,
                              },
                            ]}
                          >
                            Block
                          </Text>
                        </TouchableOpacity>

                        {status !== 'Untested' && (
                          <TouchableOpacity
                            style={[
                              styles.quickBtn,
                              {
                                backgroundColor: theme.surfaceMuted,
                              },
                            ]}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            accessibilityRole="button"
                            accessibilityLabel={`Reset ${tc.id} to untested`}
                            onPress={() => handleQuickOutcome(tc, 'Untested')}
                            disabled={isSubmittingExec}
                          >
                            <VectorIcon
                              name="refresh"
                              size={12}
                              color={theme.textSecondary}
                            />
                          </TouchableOpacity>
                        )}
                      </View>

                      <View style={styles.quickRightGroup}>
                        <TouchableOpacity
                          style={[
                            styles.logBugInlineBtn,
                            {
                              backgroundColor: theme.dangerSoft,
                              borderColor: theme.danger,
                            },
                          ]}
                          accessibilityRole="button"
                          accessibilityLabel={`Log defect for ${tc.id}`}
                          onPress={() => {
                            startDefectFromFailedTest({
                              testRun: activeRun,
                              testCase: tc,
                              actualResult:
                                tc.runResult?.actualResult ||
                                tc.runResult?.notes ||
                                'Test failed during run execution.',
                              notes: tc.runResult?.notes || '',
                            });
                          }}
                        >
                          <VectorIcon
                            name="alert"
                            size={12}
                            color={theme.danger}
                          />
                          <Text
                            style={[
                              styles.logBugInlineText,
                              { color: theme.danger },
                            ]}
                          >
                            Defect
                          </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[
                            styles.stepRunnerBtn,
                            {
                              backgroundColor: theme.primarySoft,
                              borderColor: theme.primary,
                            },
                          ]}
                          accessibilityRole="button"
                          accessibilityLabel={`Execute steps for ${tc.id}`}
                          onPress={() => openExecutionModal(tc)}
                        >
                          <VectorIcon
                            name="chevron-right"
                            size={12}
                            color={theme.primary}
                          />
                          <Text
                            style={[
                              styles.stepRunnerBtnText,
                              { color: theme.primary },
                            ]}
                          >
                            Execute
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                );
              })}

              {filteredRunCases.length === 0 && (
                <View
                  style={[
                    styles.emptyBox,
                    {
                      backgroundColor: theme.surface,
                      borderColor: theme.border,
                    },
                  ]}
                >
                  <VectorIcon name="check" size={28} color={theme.textMuted} />
                  <Text style={[styles.emptyTitle, { color: theme.text }]}>
                    No Matching Test Cases in Run
                  </Text>
                  <Text
                    style={[styles.emptySub, { color: theme.textSecondary }]}
                  >
                    Adjust your outcome filter or edit this run to include additional test cases.
                  </Text>
                </View>
              )}

              <View style={{ height: 32 }} />
            </ScrollView>
          ) : (
            <View style={styles.emptyRunFallback}>
              <View
                style={[
                  styles.emptyBox,
                  {
                    backgroundColor: theme.surface,
                    borderColor: theme.border,
                  },
                ]}
              >
                <VectorIcon name="layers" size={32} color={theme.primary} />
                <Text style={[styles.emptyTitle, { color: theme.text }]}>
                  No Test Runs Yet
                </Text>
                <Text
                  style={[styles.emptySub, { color: theme.textSecondary }]}
                >
                  Create a test run to select applicable test cases and record execution outcomes.
                </Text>
                <TouchableOpacity
                  style={[
                    styles.primaryActionBtn,
                    { backgroundColor: theme.primary, marginTop: 10 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Create First Test Run"
                  onPress={openCreateRunModal}
                >
                  <VectorIcon name="plus" size={15} color="#FFFFFF" />
                  <Text style={styles.primaryActionBtnText}>
                    Create First Test Run
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </>
      ) : (
        /* Chronological Execution History View */
        <ScrollView
          style={styles.container}
          contentContainerStyle={styles.contentContainer}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.filterControls}>
            <View
              style={[
                styles.searchBox,
                {
                  backgroundColor: theme.surface,
                  borderColor: theme.border,
                },
              ]}
            >
              <VectorIcon name="search" size={16} color={theme.textMuted} />
              <TextInput
                style={[styles.searchInput, { color: theme.text }]}
                placeholder="Search execution history by case, run, tester, or notes..."
                placeholderTextColor={theme.textMuted}
                accessibilityLabel="Search execution history by case, run, tester, or notes"
                returnKeyType="search"
                onSubmitEditing={() => Keyboard.dismiss()}
                value={historySearchQuery}
                onChangeText={setHistorySearchQuery}
              />
              {historySearchQuery.length > 0 && (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Clear execution history search"
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  onPress={() => setHistorySearchQuery('')}
                >
                  <VectorIcon
                    name="close"
                    size={14}
                    color={theme.textMuted}
                  />
                </TouchableOpacity>
              )}
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterTabsScroll}
            >
              {HISTORY_OUTCOME_FILTERS.map((outcome) => {
                const active = historyOutcomeFilter === outcome;
                return (
                  <TouchableOpacity
                    key={outcome}
                    onPress={() => setHistoryOutcomeFilter(outcome)}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`Filter execution history: ${outcome}`}
                    style={[
                      styles.filterPill,
                      {
                        backgroundColor: active
                          ? theme.primary
                          : theme.surface,
                        borderColor: active ? theme.primary : theme.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.filterPillText,
                        {
                          color: active ? '#FFFFFF' : theme.textSecondary,
                        },
                      ]}
                    >
                      {outcome}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>

          {filteredExecutions.map((exec) => {
            const sMeta = getStatusMeta(exec.status);
            const runObj = testRuns.find((r) => r.id === exec.runId);
            const linkedDefect = defects.find(
              (d) =>
                d.id === exec.linkedDefectId ||
                d.defectId === exec.linkedDefectId ||
                d.linkedExecutionId === exec.id
            );

            return (
              <View
                key={exec.id}
                style={[
                  styles.execCaseCard,
                  {
                    backgroundColor: theme.surface,
                    borderColor: theme.border,
                  },
                ]}
              >
                <View style={styles.execCardTop}>
                  <View style={styles.execIdWrap}>
                    <Text
                      style={[
                        styles.execId,
                        { color: theme.primary, fontFamily: monoFontFamily },
                      ]}
                    >
                      {exec.caseId || exec.testCaseId}
                    </Text>
                    <View
                      style={[
                        styles.execBadge,
                        { backgroundColor: sMeta.bg },
                      ]}
                    >
                      <VectorIcon
                        name={sMeta.icon}
                        size={11}
                        color={sMeta.color}
                      />
                      <Text
                        style={[
                          styles.execBadgeText,
                          { color: sMeta.color },
                        ]}
                      >
                        {sMeta.webOutcome}
                      </Text>
                    </View>
                    {exec.runId ? (
                      <TouchableOpacity
                        style={[
                          styles.historyRunBadge,
                          {
                            backgroundColor: theme.surfaceMuted,
                            borderColor: theme.border,
                          },
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel={`Open test run ${
                          runObj ? `${runObj.id} ${runObj.name}` : exec.runId
                        }`}
                        onPress={() => {
                          setSelectedTestRunId(exec.runId);
                          setActiveViewMode('runs');
                        }}
                      >
                        <Text
                          style={[
                            styles.historyRunBadgeText,
                            { color: theme.textSecondary },
                          ]}
                        >
                          {runObj ? `${runObj.id} • ${runObj.name}` : exec.runId}
                        </Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                  <Text
                    style={[
                      styles.execStepsCount,
                      { color: theme.textMuted },
                    ]}
                  >
                    {formatShortTimestamp(exec.executedAt)}
                  </Text>
                </View>

                <Text style={[styles.execTitle, { color: theme.text }]}>
                  {exec.caseTitle || exec.caseId || exec.testCaseId}
                </Text>

                {exec.actualResult ? (
                  <View
                    style={[
                      styles.execNotesBox,
                      {
                        backgroundColor: theme.surfaceMuted,
                        borderColor: theme.border,
                      },
                    ]}
                  >
                    <VectorIcon name="check" size={12} color={theme.primary} />
                    <Text
                      style={[
                        styles.execNotesText,
                        { color: theme.textSecondary },
                      ]}
                    >
                      Actual: {exec.actualResult}
                    </Text>
                  </View>
                ) : null}

                {exec.notes ? (
                  <View
                    style={[
                      styles.execNotesBox,
                      {
                        backgroundColor: theme.surfaceMuted,
                        borderColor: theme.border,
                      },
                    ]}
                  >
                    <VectorIcon
                      name="info"
                      size={12}
                      color={theme.textSecondary}
                    />
                    <Text
                      style={[
                        styles.execNotesText,
                        { color: theme.textSecondary },
                      ]}
                    >
                      Notes: {exec.notes}
                    </Text>
                  </View>
                ) : null}

                <Text
                  style={[
                    styles.execTimestampText,
                    { color: theme.textMuted },
                  ]}
                >
                  Tester: {exec.tester || 'QA Engineer'} • Env:{' '}
                  {exec.environment || 'Staging'}
                  {exec.device ? ` • ${exec.device}` : ''}
                  {exec.buildVersion ? ` • Build ${exec.buildVersion}` : ''}
                </Text>

                {linkedDefect && (
                  <TouchableOpacity
                    style={[
                      styles.linkedBugChip,
                      {
                        backgroundColor: theme.dangerSoft,
                        borderColor: theme.danger,
                      },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`Open linked defect ${
                      linkedDefect.defectId || linkedDefect.id
                    }`}
                    onPress={() => {
                      setSelectedDefectId(linkedDefect.id);
                      setActiveTab('defects');
                    }}
                  >
                    <VectorIcon name="alert" size={12} color={theme.danger} />
                    <Text
                      style={[styles.linkedBugText, { color: theme.danger }]}
                    >
                      Linked Defect: {linkedDefect.defectId || linkedDefect.id}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })}

          {filteredExecutions.length === 0 && (
            <View
              style={[
                styles.emptyBox,
                {
                  backgroundColor: theme.surface,
                  borderColor: theme.border,
                },
              ]}
            >
              <VectorIcon name="calendar" size={28} color={theme.textMuted} />
              <Text style={[styles.emptyTitle, { color: theme.text }]}>
                No Execution Records Found
              </Text>
              <Text style={[styles.emptySub, { color: theme.textSecondary }]}>
                Execute test cases inside a Test Run to populate the project execution log.
              </Text>
            </View>
          )}
        </ScrollView>
      )}

      <TestRunExecutionModal
        theme={theme}
        executingCase={executingCase}
        setExecutingCaseId={setExecutingCaseId}
        activeRun={activeRun}
        execRunnerScrollRef={execRunnerScrollRef}
        execActualResultRef={execActualResultRef}
        execNotesRef={execNotesRef}
        execTesterRef={execTesterRef}
        execEnvironmentRef={execEnvironmentRef}
        scrollRunModalTo={scrollRunModalTo}
        stepStatuses={stepStatuses}
        markAllStepsPassed={markAllStepsPassed}
        toggleStepStatus={toggleStepStatus}
        execActualResult={execActualResult}
        setExecActualResult={setExecActualResult}
        execNotes={execNotes}
        setExecNotes={setExecNotes}
        execTester={execTester}
        setExecTester={setExecTester}
        execEnvironment={execEnvironment}
        setExecEnvironment={setExecEnvironment}
        isSubmittingExec={isSubmittingExec}
        handleSaveExecution={handleSaveExecution}
      />

      <TestRunFormModal
        theme={theme}
        runModalVisible={runModalVisible}
        setRunModalVisible={setRunModalVisible}
        editingRunId={editingRunId}
        runFormScrollRef={runFormScrollRef}
        runNameRef={runNameRef}
        runEnvironmentRef={runEnvironmentRef}
        runDeviceRef={runDeviceRef}
        runBuildRef={runBuildRef}
        runTesterRef={runTesterRef}
        runNotesRef={runNotesRef}
        scrollRunModalTo={scrollRunModalTo}
        runFormError={runFormError}
        runName={runName}
        setRunName={setRunName}
        runSuiteId={runSuiteId}
        handleChangeRunSuiteScope={handleChangeRunSuiteScope}
        testCases={testCases}
        suites={suites}
        selectedCaseIds={selectedCaseIds}
        setSelectedCaseIds={setSelectedCaseIds}
        candidateCasesForModal={candidateCasesForModal}
        toggleCandidateCaseSelection={toggleCandidateCaseSelection}
        runEnvironment={runEnvironment}
        setRunEnvironment={setRunEnvironment}
        runDevice={runDevice}
        setRunDevice={setRunDevice}
        runBuild={runBuild}
        setRunBuild={setRunBuild}
        runTester={runTester}
        setRunTester={setRunTester}
        runNotes={runNotes}
        setRunNotes={setRunNotes}
        isSubmittingRun={isSubmittingRun}
        handleSaveRunModal={handleSaveRunModal}
      />

      <TestRunDeleteModal
        theme={theme}
        runPendingDelete={runPendingDelete}
        setRunPendingDelete={setRunPendingDelete}
        isDeletingRun={isDeletingRun}
        handleConfirmDeleteRun={handleConfirmDeleteRun}
      />
    </View>
  );
}

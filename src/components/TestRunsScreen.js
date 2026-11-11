import React, { useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import VectorIcon from './VectorIcon';
import { useTheme, monoFontFamily } from '../theme/theme';
import {
  useWorkspace,
  computeRunMetrics,
  toWebExecutionOutcome,
} from '../context/WorkspaceContext';

const RUN_RESULT_FILTERS = ['All', 'Passed', 'Failed', 'Blocked', 'Untested'];
const HISTORY_OUTCOME_FILTERS = ['All', 'Pass', 'Fail', 'Blocked', 'Not Run'];

function formatShortTimestamp(value) {
  if (!value) return '—';
  const raw = String(value);
  if (raw.includes('T')) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) {
      return d.toISOString().replace('T', ' ').slice(0, 16);
    }
  }
  return raw;
}

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
                value={historySearchQuery}
                onChangeText={setHistorySearchQuery}
              />
              {historySearchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setHistorySearchQuery('')}>
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

      {/* STEP-BY-STEP EXECUTION RUNNER MODAL */}
      <Modal
        visible={!!executingCase}
        animationType="slide"
        transparent
        onRequestClose={() => setExecutingCaseId(null)}
      >
        <View
          style={[styles.modalOverlay, { backgroundColor: theme.overlay }]}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={[
              styles.modalSheet,
              {
                backgroundColor: theme.surface,
                borderColor: theme.border,
              },
            ]}
          >
            {executingCase && (
              <>
                <View
                  style={[
                    styles.modalHeader,
                    { borderBottomColor: theme.border },
                  ]}
                >
                  <View style={{ flex: 1, paddingRight: 10 }}>
                    <Text
                      style={[
                        styles.modalCaseId,
                        { color: theme.primary, fontFamily: monoFontFamily },
                      ]}
                    >
                      {executingCase.id} • {activeRun?.id} ({activeRun?.name})
                    </Text>
                    <Text
                      accessibilityRole="header"
                      style={[styles.modalTitle, { color: theme.text }]}
                      numberOfLines={2}
                    >
                      {executingCase.title}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => setExecutingCaseId(null)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel="Close execution runner"
                    style={[
                      styles.closeBtn,
                      { backgroundColor: theme.surfaceMuted },
                    ]}
                  >
                    <VectorIcon
                      name="close"
                      size={16}
                      color={theme.textSecondary}
                    />
                  </TouchableOpacity>
                </View>

                <ScrollView
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={styles.modalBody}
                >
                  {executingCase.preconditions ? (
                    <View
                      style={[
                        styles.precondBanner,
                        {
                          backgroundColor: theme.infoSoft,
                          borderColor: theme.info,
                        },
                      ]}
                    >
                      <VectorIcon name="info" size={14} color={theme.info} />
                      <Text
                        style={[styles.precondText, { color: theme.text }]}
                      >
                        <Text style={{ fontWeight: '800' }}>
                          Precondition:{' '}
                        </Text>
                        {executingCase.preconditions}
                      </Text>
                    </View>
                  ) : null}

                  <View style={styles.stepSectionHeaderRow}>
                    <Text
                      style={[
                        styles.sectionHeaderLabel,
                        { color: theme.textSecondary, marginBottom: 0 },
                      ]}
                    >
                      INTERACTIVE STEP VERIFICATION (
                      {
                        Object.values(stepStatuses).filter(
                          (s) => s === 'Passed'
                        ).length
                      }
                      /{(executingCase.steps || []).length} PASSED)
                    </Text>
                    {(executingCase.steps || []).length > 0 && (
                      <TouchableOpacity
                        style={[
                          styles.passAllStepsBtn,
                          { backgroundColor: theme.successSoft },
                        ]}
                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                        accessibilityRole="button"
                        accessibilityLabel="Pass all steps"
                        onPress={markAllStepsPassed}
                      >
                        <VectorIcon
                          name="check"
                          size={12}
                          color={theme.success}
                        />
                        <Text
                          style={[
                            styles.passAllStepsBtnText,
                            { color: theme.success },
                          ]}
                        >
                          Pass All Steps
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  {(executingCase.steps || []).map((step, idx) => {
                    const stepText =
                      typeof step === 'string'
                        ? step
                        : step?.action || step?.step || '';
                    const stepExpected =
                      typeof step === 'object' ? step?.expected || '' : '';
                    const st = stepStatuses[idx] || 'Untested';
                    return (
                      <View
                        key={idx}
                        style={[
                          styles.stepRunnerRow,
                          {
                            backgroundColor: theme.surfaceMuted,
                            borderColor:
                              st === 'Passed'
                                ? theme.success
                                : st === 'Failed'
                                ? theme.danger
                                : theme.border,
                          },
                        ]}
                      >
                        <View style={styles.stepInfo}>
                          <Text
                            style={[
                              styles.stepNumLabel,
                              { color: theme.primary },
                            ]}
                          >
                            Step {idx + 1}
                          </Text>
                          <Text
                            style={[
                              styles.stepDescText,
                              { color: theme.text },
                            ]}
                          >
                            {stepText}
                          </Text>
                          {stepExpected ? (
                            <Text
                              style={[
                                styles.stepExpectedSub,
                                { color: theme.textSecondary },
                              ]}
                            >
                              Expected: {stepExpected}
                            </Text>
                          ) : null}
                        </View>
                        <View style={styles.stepToggles}>
                          <TouchableOpacity
                            onPress={() => toggleStepStatus(idx, 'Passed')}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            accessibilityRole="button"
                            accessibilityState={{ selected: st === 'Passed' }}
                            accessibilityLabel={`Mark step ${idx + 1} passed`}
                            style={[
                              styles.stepToggleBtn,
                              {
                                backgroundColor:
                                  st === 'Passed'
                                    ? theme.success
                                    : theme.surface,
                                borderColor: theme.success,
                              },
                            ]}
                          >
                            <VectorIcon
                              name="check"
                              size={14}
                              color={
                                st === 'Passed' ? '#FFFFFF' : theme.success
                              }
                            />
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => toggleStepStatus(idx, 'Failed')}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            accessibilityRole="button"
                            accessibilityState={{ selected: st === 'Failed' }}
                            accessibilityLabel={`Mark step ${idx + 1} failed`}
                            style={[
                              styles.stepToggleBtn,
                              {
                                backgroundColor:
                                  st === 'Failed'
                                    ? theme.danger
                                    : theme.surface,
                                borderColor: theme.danger,
                              },
                            ]}
                          >
                            <VectorIcon
                              name="close"
                              size={14}
                              color={
                                st === 'Failed' ? '#FFFFFF' : theme.danger
                              }
                            />
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  })}

                  <View
                    style={[
                      styles.expectedBox,
                      {
                        backgroundColor: theme.successSoft,
                        borderColor: theme.success,
                      },
                    ]}
                  >
                    <Text
                      style={[styles.expectedLabel, { color: theme.success }]}
                    >
                      EXPECTED OUTCOME
                    </Text>
                    <Text style={[styles.expectedVal, { color: theme.text }]}>
                      {executingCase.expectedResult ||
                        'Verify expected behavior across all steps.'}
                    </Text>
                  </View>

                  <Text
                    style={[
                      styles.sectionHeaderLabel,
                      { color: theme.textSecondary, marginTop: 14 },
                    ]}
                  >
                    ACTUAL RESULT / OBSERVED OUTCOME
                  </Text>
                  <TextInput
                    style={[
                      styles.notesArea,
                      {
                        backgroundColor: theme.surfaceMuted,
                        borderColor: theme.border,
                        color: theme.text,
                      },
                    ]}
                    placeholder="Record actual result observed during execution..."
                    placeholderTextColor={theme.textMuted}
                    multiline
                    value={execActualResult}
                    onChangeText={setExecActualResult}
                  />

                  <Text
                    style={[
                      styles.sectionHeaderLabel,
                      { color: theme.textSecondary, marginTop: 14 },
                    ]}
                  >
                    EXECUTION NOTES & LOGS
                  </Text>
                  <TextInput
                    style={[
                      styles.notesArea,
                      {
                        backgroundColor: theme.surfaceMuted,
                        borderColor: theme.border,
                        color: theme.text,
                      },
                    ]}
                    placeholder="Add logcat snippets, latency metrics, or environment notes..."
                    placeholderTextColor={theme.textMuted}
                    multiline
                    value={execNotes}
                    onChangeText={setExecNotes}
                  />

                  <View style={styles.execMetaInputsGrid}>
                    <View style={styles.execMetaInputCol}>
                      <Text
                        style={[
                          styles.inputLabel,
                          { color: theme.textSecondary, marginTop: 10 },
                        ]}
                      >
                        Tester
                      </Text>
                      <TextInput
                        style={[
                          styles.inputField,
                          {
                            backgroundColor: theme.surfaceMuted,
                            borderColor: theme.border,
                            color: theme.text,
                          },
                        ]}
                        value={execTester}
                        onChangeText={setExecTester}
                        placeholder="Tester name"
                        placeholderTextColor={theme.textMuted}
                      />
                    </View>
                    <View style={styles.execMetaInputCol}>
                      <Text
                        style={[
                          styles.inputLabel,
                          { color: theme.textSecondary, marginTop: 10 },
                        ]}
                      >
                        Environment
                      </Text>
                      <TextInput
                        style={[
                          styles.inputField,
                          {
                            backgroundColor: theme.surfaceMuted,
                            borderColor: theme.border,
                            color: theme.text,
                          },
                        ]}
                        value={execEnvironment}
                        onChangeText={setExecEnvironment}
                        placeholder="Android 14 / Staging"
                        placeholderTextColor={theme.textMuted}
                      />
                    </View>
                  </View>
                </ScrollView>

                <View
                  style={[
                    styles.runnerFooter,
                    { borderTopColor: theme.border },
                  ]}
                >
                  <Text
                    style={[
                      styles.runnerFooterTitle,
                      { color: theme.textSecondary },
                    ]}
                  >
                    RECORD FINAL TEST RESULT:
                  </Text>
                  <View style={styles.runnerOutcomeButtons}>
                    <TouchableOpacity
                      style={[
                        styles.outcomeBtn,
                        { backgroundColor: theme.success },
                      ]}
                      onPress={() => handleSaveExecution('Passed', false)}
                      disabled={isSubmittingExec}
                    >
                      <VectorIcon name="check" size={14} color="#FFFFFF" />
                      <Text style={styles.outcomeBtnText}>Pass</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.outcomeBtn,
                        { backgroundColor: theme.danger },
                      ]}
                      onPress={() => handleSaveExecution('Failed', false)}
                      disabled={isSubmittingExec}
                    >
                      <VectorIcon name="close" size={14} color="#FFFFFF" />
                      <Text style={styles.outcomeBtnText}>Fail</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.outcomeBtn,
                        { backgroundColor: theme.warning },
                      ]}
                      onPress={() => handleSaveExecution('Blocked', false)}
                      disabled={isSubmittingExec}
                    >
                      <VectorIcon name="alert" size={14} color="#FFFFFF" />
                      <Text style={styles.outcomeBtnText}>Blocked</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.outcomeBtn,
                        {
                          backgroundColor: theme.surfaceMuted,
                          borderWidth: 1,
                          borderColor: theme.border,
                        },
                      ]}
                      onPress={() => handleSaveExecution('Untested', false)}
                      disabled={isSubmittingExec}
                    >
                      <VectorIcon
                        name="refresh"
                        size={14}
                        color={theme.textSecondary}
                      />
                      <Text
                        style={[
                          styles.outcomeBtnText,
                          { color: theme.textSecondary },
                        ]}
                      >
                        Not Run
                      </Text>
                    </TouchableOpacity>
                  </View>

                  <TouchableOpacity
                    style={[
                      styles.failAndBugBtn,
                      {
                        backgroundColor: theme.dangerSoft,
                        borderColor: theme.danger,
                      },
                    ]}
                    onPress={() => handleSaveExecution('Failed', true)}
                    disabled={isSubmittingExec}
                  >
                    <VectorIcon name="alert" size={15} color={theme.danger} />
                    <Text
                      style={[
                        styles.failAndBugBtnText,
                        { color: theme.danger },
                      ]}
                    >
                      Mark Failed & Create Linked Defect
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* CREATE / EDIT TEST RUN MODAL */}
      <Modal
        visible={runModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setRunModalVisible(false)}
      >
        <View
          style={[styles.modalOverlay, { backgroundColor: theme.overlay }]}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={[
              styles.modalSheet,
              {
                backgroundColor: theme.surface,
                borderColor: theme.border,
              },
            ]}
          >
            <View
              style={[
                styles.modalHeader,
                { borderBottomColor: theme.border },
              ]}
            >
              <Text style={[styles.modalTitle, { color: theme.text }]}>
                {editingRunId
                  ? `Edit Test Run (${editingRunId})`
                  : 'Create New Test Run'}
              </Text>
              <TouchableOpacity
                onPress={() => setRunModalVisible(false)}
                style={[
                  styles.closeBtn,
                  { backgroundColor: theme.surfaceMuted },
                ]}
              >
                <VectorIcon
                  name="close"
                  size={16}
                  color={theme.textSecondary}
                />
              </TouchableOpacity>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.modalBody}
            >
              {runFormError ? (
                <View
                  style={[
                    styles.formErrorBox,
                    {
                      backgroundColor: theme.dangerSoft,
                      borderColor: theme.danger,
                    },
                  ]}
                >
                  <VectorIcon name="alert" size={14} color={theme.danger} />
                  <Text
                    style={[styles.formErrorText, { color: theme.danger }]}
                  >
                    {runFormError}
                  </Text>
                </View>
              ) : null}

              <Text
                style={[styles.inputLabel, { color: theme.textSecondary }]}
              >
                Run Name *
              </Text>
              <TextInput
                style={[
                  styles.inputField,
                  {
                    backgroundColor: theme.surfaceMuted,
                    borderColor: theme.border,
                    color: theme.text,
                  },
                ]}
                placeholder="e.g., Release v2.4 Smoke Verification"
                placeholderTextColor={theme.textMuted}
                value={runName}
                onChangeText={setRunName}
              />

              <Text
                style={[styles.inputLabel, { color: theme.textSecondary }]}
              >
                Target Suite Scope
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ marginVertical: 6 }}
              >
                <TouchableOpacity
                  onPress={() => handleChangeRunSuiteScope('all')}
                  style={[
                    styles.optionPill,
                    {
                      backgroundColor:
                        runSuiteId === 'all' || runSuiteId === 'ALL'
                          ? theme.primarySoft
                          : theme.surfaceMuted,
                      borderColor:
                        runSuiteId === 'all' || runSuiteId === 'ALL'
                          ? theme.primary
                          : theme.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.optionPillText,
                      {
                        color:
                          runSuiteId === 'all' || runSuiteId === 'ALL'
                            ? theme.primary
                            : theme.textSecondary,
                      },
                    ]}
                  >
                    All Suites ({testCases.length} cases)
                  </Text>
                </TouchableOpacity>
                {suites.map((s) => {
                  const active = runSuiteId === s.id;
                  const count = testCases.filter(
                    (tc) => tc.suiteId === s.id
                  ).length;
                  return (
                    <TouchableOpacity
                      key={s.id}
                      onPress={() => handleChangeRunSuiteScope(s.id)}
                      style={[
                        styles.optionPill,
                        {
                          backgroundColor: active
                            ? theme.primarySoft
                            : theme.surfaceMuted,
                          borderColor: active ? theme.primary : theme.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.optionPillText,
                          {
                            color: active
                              ? theme.primary
                              : theme.textSecondary,
                          },
                        ]}
                      >
                        {s.name} ({count})
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {/* Applicable Test Cases Selection */}
              <View style={styles.caseSelectionHeader}>
                <Text
                  style={[
                    styles.inputLabel,
                    { color: theme.textSecondary, marginTop: 4 },
                  ]}
                >
                  Select Applicable Test Cases ({selectedCaseIds.length} of{' '}
                  {candidateCasesForModal.length} selected)
                </Text>
                <View style={styles.caseSelectionQuickBtns}>
                  <TouchableOpacity
                    onPress={() =>
                      setSelectedCaseIds(
                        candidateCasesForModal.map((tc) => tc.id)
                      )
                    }
                  >
                    <Text
                      style={[styles.selectAllLink, { color: theme.primary }]}
                    >
                      Select All
                    </Text>
                  </TouchableOpacity>
                  <Text style={{ color: theme.textMuted }}>•</Text>
                  <TouchableOpacity onPress={() => setSelectedCaseIds([])}>
                    <Text
                      style={[
                        styles.selectAllLink,
                        { color: theme.textSecondary },
                      ]}
                    >
                      Clear
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View
                style={[
                  styles.casePickerBox,
                  {
                    backgroundColor: theme.surfaceMuted,
                    borderColor: theme.border,
                  },
                ]}
              >
                {candidateCasesForModal.length === 0 ? (
                  <Text
                    style={[
                      styles.emptyPickerText,
                      { color: theme.textMuted },
                    ]}
                  >
                    No test cases available in this suite scope.
                  </Text>
                ) : (
                  candidateCasesForModal.map((tc) => {
                    const checked = selectedCaseIds.includes(tc.id);
                    return (
                      <TouchableOpacity
                        key={tc.id}
                        style={[
                          styles.casePickerRow,
                          {
                            borderBottomColor: theme.border,
                            backgroundColor: checked
                              ? theme.primarySoft
                              : 'transparent',
                          },
                        ]}
                        onPress={() => toggleCandidateCaseSelection(tc.id)}
                      >
                        <VectorIcon
                          name={checked ? 'check' : 'plus'}
                          size={14}
                          color={checked ? theme.primary : theme.textMuted}
                        />
                        <View style={{ flex: 1 }}>
                          <Text
                            style={[
                              styles.casePickerTitle,
                              { color: theme.text },
                            ]}
                            numberOfLines={1}
                          >
                            <Text
                              style={{
                                color: theme.primary,
                                fontWeight: '800',
                              }}
                            >
                              {tc.id}
                            </Text>{' '}
                            • {tc.title}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })
                )}
              </View>

              <Text
                style={[styles.inputLabel, { color: theme.textSecondary }]}
              >
                Environment
              </Text>
              <TextInput
                style={[
                  styles.inputField,
                  {
                    backgroundColor: theme.surfaceMuted,
                    borderColor: theme.border,
                    color: theme.text,
                  },
                ]}
                placeholder="e.g., Android 14 / Staging"
                placeholderTextColor={theme.textMuted}
                value={runEnvironment}
                onChangeText={setRunEnvironment}
              />

              <Text
                style={[styles.inputLabel, { color: theme.textSecondary }]}
              >
                Target Device & Android OS
              </Text>
              <TextInput
                style={[
                  styles.inputField,
                  {
                    backgroundColor: theme.surfaceMuted,
                    borderColor: theme.border,
                    color: theme.text,
                  },
                ]}
                placeholder="e.g., Pixel 8 Pro • Android 14"
                placeholderTextColor={theme.textMuted}
                value={runDevice}
                onChangeText={setRunDevice}
              />

              <Text
                style={[styles.inputLabel, { color: theme.textSecondary }]}
              >
                Build Version
              </Text>
              <TextInput
                style={[
                  styles.inputField,
                  {
                    backgroundColor: theme.surfaceMuted,
                    borderColor: theme.border,
                    color: theme.text,
                  },
                ]}
                placeholder="e.g., 2.4.0-rc3 (Build 418)"
                placeholderTextColor={theme.textMuted}
                value={runBuild}
                onChangeText={setRunBuild}
              />

              <Text
                style={[styles.inputLabel, { color: theme.textSecondary }]}
              >
                Assigned Tester
              </Text>
              <TextInput
                style={[
                  styles.inputField,
                  {
                    backgroundColor: theme.surfaceMuted,
                    borderColor: theme.border,
                    color: theme.text,
                  },
                ]}
                placeholder="e.g., QA Lead"
                placeholderTextColor={theme.textMuted}
                value={runTester}
                onChangeText={setRunTester}
              />

              <Text
                style={[styles.inputLabel, { color: theme.textSecondary }]}
              >
                Run Notes / Cycle Scope
              </Text>
              <TextInput
                style={[
                  styles.notesArea,
                  {
                    backgroundColor: theme.surfaceMuted,
                    borderColor: theme.border,
                    color: theme.text,
                    marginTop: 6,
                  },
                ]}
                placeholder="Optional cycle notes or release criteria..."
                placeholderTextColor={theme.textMuted}
                multiline
                value={runNotes}
                onChangeText={setRunNotes}
              />
            </ScrollView>

            <View
              style={[
                styles.modalFooter,
                { borderTopColor: theme.border },
              ]}
            >
              <TouchableOpacity
                style={[
                  styles.cancelBtn,
                  {
                    backgroundColor: theme.surfaceMuted,
                    borderColor: theme.border,
                  },
                ]}
                onPress={() => setRunModalVisible(false)}
                disabled={isSubmittingRun}
              >
                <Text
                  style={[
                    styles.cancelBtnText,
                    { color: theme.textSecondary },
                  ]}
                >
                  Cancel
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.saveBtn,
                  {
                    backgroundColor: theme.primary,
                    opacity: isSubmittingRun ? 0.7 : 1,
                  },
                ]}
                onPress={handleSaveRunModal}
                disabled={isSubmittingRun}
              >
                {isSubmittingRun ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <VectorIcon name="check" size={15} color="#FFFFFF" />
                )}
                <Text style={styles.saveBtnText}>
                  {editingRunId ? 'Save Run Changes' : 'Launch Test Run'}
                </Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* DELETE TEST RUN CONFIRMATION MODAL */}
      <Modal
        visible={!!runPendingDelete}
        animationType="fade"
        transparent
        onRequestClose={() => setRunPendingDelete(null)}
      >
        <View
          style={[
            styles.confirmOverlay,
            { backgroundColor: theme.overlay },
          ]}
        >
          <View
            style={[
              styles.confirmCard,
              {
                backgroundColor: theme.surface,
                borderColor: theme.border,
              },
            ]}
          >
            <View
              style={[
                styles.confirmIconCircle,
                { backgroundColor: theme.dangerSoft },
              ]}
            >
              <VectorIcon name="trash" size={22} color={theme.danger} />
            </View>
            <Text style={[styles.confirmTitle, { color: theme.text }]}>
              Delete Test Run?
            </Text>
            <Text
              style={[
                styles.confirmDesc,
                { color: theme.textSecondary },
              ]}
            >
              Are you sure you want to delete{' '}
              <Text style={{ fontWeight: '800', color: theme.text }}>
                {runPendingDelete?.name} ({runPendingDelete?.id})
              </Text>
              ? Its execution history will be removed and any linked defects will be safely unlinked.
            </Text>

            <View style={styles.confirmBtnRow}>
              <TouchableOpacity
                style={[
                  styles.confirmCancelBtn,
                  {
                    backgroundColor: theme.surfaceMuted,
                    borderColor: theme.border,
                  },
                ]}
                onPress={() => setRunPendingDelete(null)}
                disabled={isDeletingRun}
              >
                <Text
                  style={[
                    styles.confirmCancelText,
                    { color: theme.textSecondary },
                  ]}
                >
                  Cancel
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.confirmDeleteBtn,
                  {
                    backgroundColor: theme.danger,
                    opacity: isDeletingRun ? 0.7 : 1,
                  },
                ]}
                onPress={handleConfirmDeleteRun}
                disabled={isDeletingRun}
              >
                {isDeletingRun ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <VectorIcon name="trash" size={14} color="#FFFFFF" />
                )}
                <Text style={styles.confirmDeleteText}>Delete Run</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  emptyWorkspaceWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  emptyWorkspaceCard: {
    width: '100%',
    borderRadius: 16,
    borderWidth: 1,
    padding: 24,
    alignItems: 'center',
    gap: 10,
  },
  emptyWorkspaceTitle: {
    fontSize: 17,
    fontWeight: '800',
  },
  emptyWorkspaceSub: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
  primaryActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  primaryActionBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  projectStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: 1,
    columnGap: 8,
    rowGap: 4,
  },
  projectStripLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    flexShrink: 1,
    minWidth: 140,
  },
  projectDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  projectStripName: {
    fontSize: 13,
    fontWeight: '800',
    flexShrink: 1,
  },
  projectStatusBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  projectStatusBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  projectStripRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  syncIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  syncIndicatorText: {
    fontSize: 11,
    fontWeight: '700',
  },
  iconRefreshBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertBanner: {
    marginHorizontal: 16,
    marginTop: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
  },
  alertBannerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  alertBannerText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17,
  },
  alertBannerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
  },
  alertBannerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  alertBannerBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  alertBannerDismiss: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
  },
  alertBannerDismissText: {
    fontSize: 11,
    fontWeight: '700',
  },
  feedbackBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
  },
  feedbackBannerText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
  },
  modeSwitcherWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    gap: 8,
  },
  modeSwitcherTrack: {
    flex: 1,
    minWidth: 215,
    flexDirection: 'row',
    borderRadius: 10,
    borderWidth: 1,
    padding: 3,
  },
  modeTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 7,
    paddingHorizontal: 6,
    borderRadius: 8,
  },
  modeTabText: {
    fontSize: 11.5,
    fontWeight: '800',
    flexShrink: 1,
  },
  newRunTopBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 9,
    borderRadius: 10,
  },
  newRunTopBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  runSelectorBar: {
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  runListScroll: {
    paddingHorizontal: 16,
    gap: 10,
    alignItems: 'center',
  },
  runTabCard: {
    width: 196,
    padding: 11,
    borderRadius: 12,
    borderWidth: 1,
  },
  runTabTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  runTabId: {
    fontSize: 11,
    fontWeight: '800',
  },
  runStatusPill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  runStatusText: {
    fontSize: 10,
    fontWeight: '800',
  },
  runTabName: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 7,
  },
  runMiniProgress: {
    gap: 4,
  },
  runMiniTrack: {
    height: 5,
    borderRadius: 3,
    overflow: 'hidden',
  },
  runMiniFill: {
    height: '100%',
    borderRadius: 3,
  },
  runMiniPct: {
    fontSize: 10,
    fontWeight: '600',
  },
  contentContainer: {
    padding: 16,
  },
  summaryCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 15,
    marginBottom: 14,
  },
  summaryTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 10,
  },
  summaryTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  summaryRunId: {
    fontSize: 12,
    fontWeight: '800',
  },
  summaryRunTitle: {
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 3,
  },
  summaryMeta: {
    fontSize: 12,
    fontWeight: '600',
  },
  summarySubMeta: {
    fontSize: 11,
    fontWeight: '500',
    marginTop: 2,
  },
  summaryRunNotes: {
    fontSize: 12,
    fontStyle: 'italic',
    marginTop: 5,
  },
  runManagementRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  completeRunBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
  },
  completeRunBtnText: {
    fontSize: 12,
    fontWeight: '800',
  },
  secondaryRunBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
  },
  secondaryRunBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  progressSection: {
    marginBottom: 12,
  },
  progressHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    columnGap: 8,
    rowGap: 4,
    marginBottom: 6,
  },
  progressLabel: {
    fontSize: 12,
    fontWeight: '600',
    flexShrink: 1,
  },
  progressPct: {
    fontSize: 12,
    fontWeight: '800',
  },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  },
  counterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  counterChip: {
    flex: 1,
    minWidth: 54,
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 10,
    borderWidth: 1.5,
  },
  counterVal: {
    fontSize: 16,
    fontWeight: '800',
  },
  counterLabel: {
    fontSize: 10,
    fontWeight: '700',
  },
  filterControls: {
    marginBottom: 12,
    gap: 10,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 42,
    borderRadius: 11,
    borderWidth: 1,
    paddingHorizontal: 12,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    height: '100%',
  },
  filterTabsScroll: {
    gap: 8,
  },
  filterPill: {
    paddingHorizontal: 13,
    paddingVertical: 6,
    borderRadius: 18,
    borderWidth: 1,
  },
  filterPillText: {
    fontSize: 12,
    fontWeight: '700',
  },
  execCaseCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 10,
  },
  execCardTop: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  execIdWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  execId: {
    fontSize: 12,
    fontWeight: '800',
  },
  execBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  execBadgeText: {
    fontSize: 11,
    fontWeight: '800',
  },
  historyRunBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  historyRunBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  execStepsCount: {
    fontSize: 11,
    fontWeight: '600',
  },
  execTitle: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
    marginBottom: 8,
  },
  execNotesBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 6,
  },
  execNotesText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
  },
  execTimestampText: {
    fontSize: 11,
    fontWeight: '500',
    marginBottom: 6,
  },
  linkedBugChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    marginBottom: 8,
  },
  linkedBugText: {
    fontSize: 11,
    fontWeight: '800',
  },
  quickActionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 10,
    marginTop: 4,
    borderTopWidth: 1,
    flexWrap: 'wrap',
    gap: 8,
  },
  quickStatusGroup: {
    flexDirection: 'row',
    gap: 6,
  },
  quickRightGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  quickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  quickBtnText: {
    fontSize: 11,
    fontWeight: '800',
  },
  logBugInlineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  logBugInlineText: {
    fontSize: 11,
    fontWeight: '800',
  },
  stepRunnerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  stepRunnerBtnText: {
    fontSize: 11,
    fontWeight: '800',
  },
  emptyRunFallback: {
    padding: 16,
  },
  emptyBox: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 28,
    alignItems: 'center',
    gap: 6,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '800',
  },
  emptySub: {
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalSheet: {
    maxHeight: '92%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
  },
  modalCaseId: {
    fontSize: 11,
    fontWeight: '800',
    marginBottom: 2,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBody: {
    padding: 16,
  },
  precondBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 14,
  },
  precondText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
  },
  stepSectionHeaderRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    marginBottom: 8,
  },
  passAllStepsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  passAllStepsBtnText: {
    fontSize: 11,
    fontWeight: '800',
  },
  sectionHeaderLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  stepRunnerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 8,
    gap: 10,
  },
  stepInfo: {
    flex: 1,
  },
  stepNumLabel: {
    fontSize: 11,
    fontWeight: '800',
    marginBottom: 2,
  },
  stepDescText: {
    fontSize: 13,
    lineHeight: 18,
  },
  stepExpectedSub: {
    fontSize: 11,
    marginTop: 2,
  },
  stepToggles: {
    flexDirection: 'row',
    gap: 6,
  },
  stepToggleBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  expectedBox: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 4,
  },
  expectedLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  expectedVal: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  notesArea: {
    minHeight: 74,
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
    fontSize: 13,
    textAlignVertical: 'top',
  },
  execMetaInputsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  execMetaInputCol: {
    flex: 1,
    minWidth: 130,
  },
  runnerFooter: {
    padding: 16,
    borderTopWidth: 1,
    gap: 10,
  },
  runnerFooterTitle: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  runnerOutcomeButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  outcomeBtn: {
    flex: 1,
    minWidth: 68,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    height: 40,
    paddingHorizontal: 6,
    borderRadius: 10,
  },
  outcomeBtnText: {
    color: '#FFFFFF',
    fontSize: 11.5,
    fontWeight: '800',
  },
  failAndBugBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 42,
    borderRadius: 10,
    borderWidth: 1,
  },
  failAndBugBtnText: {
    fontSize: 13,
    fontWeight: '800',
  },
  formErrorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 8,
  },
  formErrorText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 10,
    marginBottom: 6,
  },
  inputField: {
    height: 42,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 13,
  },
  optionPill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    marginRight: 8,
  },
  optionPillText: {
    fontSize: 12,
    fontWeight: '700',
  },
  caseSelectionHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    marginBottom: 6,
  },
  caseSelectionQuickBtns: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  selectAllLink: {
    fontSize: 12,
    fontWeight: '800',
  },
  casePickerBox: {
    maxHeight: 165,
    borderRadius: 10,
    borderWidth: 1,
    overflow: 'hidden',
  },
  emptyPickerText: {
    padding: 12,
    fontSize: 12,
    textAlign: 'center',
  },
  casePickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  casePickerTitle: {
    fontSize: 12,
    fontWeight: '600',
  },
  modalFooter: {
    flexDirection: 'row',
    gap: 10,
    padding: 16,
    borderTopWidth: 1,
  },
  cancelBtn: {
    flex: 1,
    height: 44,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  saveBtn: {
    flex: 2,
    flexDirection: 'row',
    height: 44,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  confirmOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  confirmCard: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 18,
    borderWidth: 1,
    padding: 20,
    alignItems: 'center',
  },
  confirmIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  confirmTitle: {
    fontSize: 17,
    fontWeight: '800',
    marginBottom: 6,
  },
  confirmDesc: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 18,
  },
  confirmBtnRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },
  confirmCancelBtn: {
    flex: 1,
    height: 42,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmCancelText: {
    fontSize: 13,
    fontWeight: '700',
  },
  confirmDeleteBtn: {
    flex: 1,
    flexDirection: 'row',
    height: 42,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  confirmDeleteText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
});

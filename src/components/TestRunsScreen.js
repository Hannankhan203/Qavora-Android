import React, { useState, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useTheme, monoFontFamily } from '../theme/theme';
import { useWorkspace } from '../context/WorkspaceContext';

export default function TestRunsScreen() {
  const { colors } = useTheme();
  const {
    profile,
    suites,
    testCases,
    testRuns,
    executionStatuses,
    selectedTestRunId,
    setSelectedTestRunId,
    createTestRun,
    recordTestExecution,
    deleteTestRun,
    startDefectFromFailedTest,
    setSelectedDefectId,
    setActiveTab,
  } = useWorkspace();

  const activeRunId = selectedTestRunId || testRuns[0]?.id || null;
  const activeRun = useMemo(
    () => testRuns.find((r) => r.id === activeRunId) || null,
    [testRuns, activeRunId]
  );

  // Create New Run Modal State
  const [isCreateRunOpen, setIsCreateRunOpen] = useState(false);
  const [runName, setRunName] = useState('');
  const [runSuiteId, setRunSuiteId] = useState('all');
  const [runBuild, setRunBuild] = useState(profile.defaultBuild || '1.0.0-build.104');
  const [runDevice, setRunDevice] = useState(
    profile.defaultDevice || 'Android 15 · Pixel 8'
  );
  const [runEnv, setRunEnv] = useState('Local QA Build');
  const [runError, setRunError] = useState('');

  // Execute Single Test Case Modal State
  const [executingEntry, setExecutingEntry] = useState(null); // { run, result, testCase }
  const [execStatus, setExecStatus] = useState('Passed');
  const [execActualResult, setExecActualResult] = useState('');
  const [execNotes, setExecNotes] = useState('');

  // Filter inside active run
  const [runResultFilter, setRunResultFilter] = useState('all');

  const openCreateRunModal = () => {
    setRunName(`v1.0.0 QA Cycle (${new Date().toLocaleDateString()})`);
    setRunSuiteId('all');
    setRunBuild(profile.defaultBuild || '1.0.0-build.104');
    setRunDevice(profile.defaultDevice || 'Android 15 · Pixel 8');
    setRunEnv('Local QA Build');
    setRunError('');
    setIsCreateRunOpen(true);
  };

  const handleCreateRun = () => {
    setRunError('');
    if (!runName.trim()) {
      setRunError('Please enter a name for the Test Run.');
      return;
    }
    if (testCases.length === 0) {
      setRunError('Create at least one Test Case before starting a Test Run.');
      return;
    }
    const created = createTestRun({
      name: runName,
      suiteId: runSuiteId,
      buildVersion: runBuild,
      deviceInfo: runDevice,
      environment: runEnv,
    });
    if (created) {
      setSelectedTestRunId(created.id);
      setIsCreateRunOpen(false);
    }
  };

  const openExecutionModal = (run, res, tc) => {
    setExecutingEntry({ run, result: res, testCase: tc });
    setExecStatus(res.status === 'Untested' ? 'Passed' : res.status);
    setExecActualResult(res.actualResult || '');
    setExecNotes(res.notes || '');
  };

  const handleSaveExecution = (andCreateDefect = false) => {
    if (!executingEntry) return;
    const { run, testCase } = executingEntry;
    const finalStatus = andCreateDefect ? 'Failed' : execStatus;

    recordTestExecution({
      testRunId: run.id,
      testCaseId: testCase.id,
      status: finalStatus,
      actualResult:
        execActualResult.trim() ||
        (finalStatus === 'Passed'
          ? 'Expected result verified on device.'
          : 'Execution result recorded.'),
      notes: execNotes.trim(),
    });

    setExecutingEntry(null);

    if (andCreateDefect) {
      startDefectFromFailedTest({
        testRun: run,
        testCase,
        actualResult: execActualResult.trim() || 'Step verification failed during test run.',
        notes: execNotes.trim(),
      });
    }
  };

  const getStatusColor = (status) => {
    if (status === 'Passed') return colors.success;
    if (status === 'Failed') return colors.danger;
    if (status === 'Blocked') return colors.warning;
    return colors.textMuted;
  };

  const runStats = useMemo(() => {
    if (!activeRun) {
      return { total: 0, passed: 0, failed: 0, blocked: 0, untested: 0, pct: 0 };
    }
    const total = activeRun.results.length;
    const passed = activeRun.results.filter((r) => r.status === 'Passed').length;
    const failed = activeRun.results.filter((r) => r.status === 'Failed').length;
    const blocked = activeRun.results.filter((r) => r.status === 'Blocked').length;
    const untested = activeRun.results.filter((r) => r.status === 'Untested').length;
    const executed = total - untested;
    const pct = total > 0 ? Math.round((executed / total) * 100) : 0;
    return { total, passed, failed, blocked, untested, pct };
  }, [activeRun]);

  const filteredRunResults = useMemo(() => {
    if (!activeRun) return [];
    return activeRun.results.filter((res) => {
      if (runResultFilter !== 'all' && res.status !== runResultFilter) return false;
      return true;
    });
  }, [activeRun, runResultFilter]);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.headerRow}>
          <View style={styles.headerTextCol}>
            <Text
              style={[
                styles.kicker,
                { color: colors.primary, fontFamily: monoFontFamily },
              ]}
            >
              TEST EXECUTION RUNNER · {testRuns.length} RUNS
            </Text>
            <Text style={[styles.title, { color: colors.text }]}>
              Test Runs & Execution
            </Text>
          </View>
          <Pressable
            onPress={openCreateRunModal}
            style={[styles.createBtn, { backgroundColor: colors.primary }]}
          >
            <Text style={[styles.createBtnText, { color: colors.textOnPrimary }]}>
              + New Test Run
            </Text>
          </Pressable>
        </View>

        {/* Horizontal Run Selector */}
        {testRuns.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.runTabs}
          >
            {testRuns.map((run) => {
              const selected = activeRun && activeRun.id === run.id;
              return (
                <Pressable
                  key={run.id}
                  onPress={() => setSelectedTestRunId(run.id)}
                  style={[
                    styles.runTabCard,
                    {
                      backgroundColor: selected ? colors.surfaceAccent : colors.surface,
                      borderColor: selected ? colors.primary : colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.runTabCode,
                      { color: colors.primary, fontFamily: monoFontFamily },
                    ]}
                  >
                    {run.id} · {run.status}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[styles.runTabTitle, { color: colors.text }]}
                  >
                    {run.name}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[styles.runTabMeta, { color: colors.textMuted }]}
                  >
                    {run.buildVersion} · {run.results.length} cases
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        {/* Active Test Run Workspace */}
        {!activeRun ? (
          <View
            style={[
              styles.emptyCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.emptyTitle, { color: colors.text }]}>
              No Test Runs available
            </Text>
            <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>
              Create a new Test Run to execute test cases and record Pass, Fail, or Blocked results.
            </Text>
            <Pressable
              onPress={openCreateRunModal}
              style={[styles.createBtn, { backgroundColor: colors.primary }]}
            >
              <Text style={[styles.createBtnText, { color: colors.textOnPrimary }]}>
                + Start First Test Run
              </Text>
            </Pressable>
          </View>
        ) : (
          <>
            {/* Active Run Metadata & Progress Card */}
            <View
              style={[
                styles.runDetailCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <View style={styles.runDetailTop}>
                <View style={styles.runDetailTitleCol}>
                  <Text
                    style={[
                      styles.runIdBadge,
                      { color: colors.primary, fontFamily: monoFontFamily },
                    ]}
                  >
                    {activeRun.id} · {activeRun.status.toUpperCase()} · {activeRun.suiteName}
                  </Text>
                  <Text style={[styles.runDetailName, { color: colors.text }]}>
                    {activeRun.name}
                  </Text>
                  <Text
                    style={[
                      styles.runDeviceText,
                      { color: colors.textSecondary, fontFamily: monoFontFamily },
                    ]}
                  >
                    Device: {activeRun.deviceInfo} · Build: {activeRun.buildVersion} · {activeRun.environment}
                  </Text>
                </View>

                <Pressable
                  onPress={() => deleteTestRun(activeRun.id)}
                  style={[
                    styles.deleteRunBtn,
                    { backgroundColor: colors.dangerSoft, borderColor: colors.danger },
                  ]}
                >
                  <Text style={[styles.deleteRunText, { color: colors.danger }]}>
                    Delete Run
                  </Text>
                </Pressable>
              </View>

              {/* Progress Bar */}
              <View style={styles.progressWrap}>
                <View style={styles.progressHeader}>
                  <Text style={[styles.progressLabel, { color: colors.textSecondary }]}>
                    Execution Progress
                  </Text>
                  <Text
                    style={[
                      styles.progressPct,
                      { color: colors.text, fontFamily: monoFontFamily },
                    ]}
                  >
                    {runStats.total - runStats.untested}/{runStats.total} executed ({runStats.pct}%)
                  </Text>
                </View>
                <View style={[styles.progressTrack, { backgroundColor: colors.surfaceMuted }]}>
                  <View
                    style={[
                      styles.progressFill,
                      {
                        backgroundColor: colors.primary,
                        width: `${Math.min(100, Math.max(4, runStats.pct))}%`,
                      },
                    ]}
                  />
                </View>
              </View>

              {/* Status Filter Pills inside Run */}
              <View style={styles.runCountersRow}>
                {[
                  { id: 'all', label: `All (${runStats.total})`, color: colors.text },
                  { id: 'Passed', label: `Passed (${runStats.passed})`, color: colors.success },
                  { id: 'Failed', label: `Failed (${runStats.failed})`, color: colors.danger },
                  { id: 'Blocked', label: `Blocked (${runStats.blocked})`, color: colors.warning },
                  { id: 'Untested', label: `Untested (${runStats.untested})`, color: colors.textMuted },
                ].map((st) => {
                  const active = runResultFilter === st.id;
                  return (
                    <Pressable
                      key={st.id}
                      onPress={() => setRunResultFilter(st.id)}
                      style={[
                        styles.counterChip,
                        {
                          backgroundColor: active ? colors.surfaceAccent : colors.background,
                          borderColor: active ? colors.primary : colors.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.counterChipText,
                          { color: active ? colors.primary : st.color },
                        ]}
                      >
                        {st.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Test Cases Execution Queue */}
            <View style={styles.queueList}>
              {filteredRunResults.map((res) => {
                const tc = testCases.find((c) => c.id === res.testCaseId) || {
                  id: res.testCaseId,
                  title: `Test Case ${res.testCaseId}`,
                  suiteName: activeRun.suiteName,
                  priority: 'P1',
                  steps: [],
                  expectedResult: '',
                };

                return (
                  <View
                    key={res.testCaseId}
                    style={[
                      styles.execCard,
                      { backgroundColor: colors.surface, borderColor: colors.border },
                    ]}
                  >
                    <Pressable
                      onPress={() => openExecutionModal(activeRun, res, tc)}
                      style={styles.execCardTop}
                    >
                      <View style={styles.execMetaRow}>
                        <Text
                          style={[
                            styles.execCaseId,
                            { color: colors.primary, fontFamily: monoFontFamily },
                          ]}
                        >
                          {tc.id}
                        </Text>
                        <Text style={[styles.dot, { color: colors.textMuted }]}>·</Text>
                        <Text
                          style={[
                            styles.execPriority,
                            { color: colors.textSecondary, fontFamily: monoFontFamily },
                          ]}
                        >
                          {tc.priority}
                        </Text>
                        <Text style={[styles.dot, { color: colors.textMuted }]}>·</Text>
                        <Text
                          style={[
                            styles.execStatusText,
                            {
                              color: getStatusColor(res.status),
                              fontFamily: monoFontFamily,
                            },
                          ]}
                        >
                          {res.status.toUpperCase()}
                        </Text>
                        {res.executedAt ? (
                          <>
                            <Text style={[styles.dot, { color: colors.textMuted }]}>·</Text>
                            <Text
                              style={[
                                styles.execTime,
                                { color: colors.textMuted, fontFamily: monoFontFamily },
                              ]}
                            >
                              {res.executedAt}
                            </Text>
                          </>
                        ) : null}
                      </View>

                      <Text style={[styles.execTitle, { color: colors.text }]}>
                        {tc.title}
                      </Text>

                      {res.actualResult ? (
                        <Text style={[styles.actualResultText, { color: colors.textSecondary }]}>
                          Actual: {res.actualResult}
                        </Text>
                      ) : (
                        <Text style={[styles.expectedPreviewText, { color: colors.textMuted }]}>
                          Expected: {tc.expectedResult}
                        </Text>
                      )}

                      {res.notes ? (
                        <Text style={[styles.notesPreviewText, { color: colors.textMuted }]}>
                          Notes: {res.notes}
                        </Text>
                      ) : null}
                    </Pressable>

                    {/* Quick Status Buttons & Linked Defect Trigger */}
                    <View style={[styles.execActionsBar, { borderTopColor: colors.border }]}>
                      <View style={styles.quickStatusGroup}>
                        {executionStatuses.map((statusOption) => {
                          const isCurrent = res.status === statusOption;
                          return (
                            <Pressable
                              key={statusOption}
                              onPress={() =>
                                recordTestExecution({
                                  testRunId: activeRun.id,
                                  testCaseId: tc.id,
                                  status: statusOption,
                                  actualResult:
                                    res.actualResult ||
                                    (statusOption === 'Passed'
                                      ? 'Verified expected behavior.'
                                      : `Marked as ${statusOption}.`),
                                })
                              }
                              style={[
                                styles.quickStatusBtn,
                                {
                                  backgroundColor: isCurrent
                                    ? colors.surfaceAccent
                                    : colors.background,
                                  borderColor: isCurrent
                                    ? getStatusColor(statusOption)
                                    : colors.border,
                                },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.quickStatusText,
                                  {
                                    color: isCurrent
                                      ? getStatusColor(statusOption)
                                      : colors.textSecondary,
                                  },
                                ]}
                              >
                                {statusOption}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>

                      <View style={styles.execRightBtns}>
                        <Pressable
                          onPress={() => openExecutionModal(activeRun, res, tc)}
                          style={[
                            styles.recordNotesBtn,
                            { backgroundColor: colors.surfaceMuted, borderColor: colors.border },
                          ]}
                        >
                          <Text style={[styles.recordNotesText, { color: colors.text }]}>
                            Record Details
                          </Text>
                        </Pressable>

                        {res.linkedDefectId ? (
                          <Pressable
                            onPress={() => {
                              setSelectedDefectId(res.linkedDefectId);
                              setActiveTab('defects');
                            }}
                            style={[
                              styles.linkedDefectBtn,
                              { backgroundColor: colors.dangerSoft, borderColor: colors.danger },
                            ]}
                          >
                            <Text
                              style={[
                                styles.linkedDefectBtnText,
                                { color: colors.danger, fontFamily: monoFontFamily },
                              ]}
                            >
                              {res.linkedDefectId} →
                            </Text>
                          </Pressable>
                        ) : res.status === 'Failed' || res.status === 'Blocked' ? (
                          <Pressable
                            onPress={() =>
                              startDefectFromFailedTest({
                                testRun: activeRun,
                                testCase: tc,
                                actualResult: res.actualResult,
                                notes: res.notes,
                              })
                            }
                            style={[
                              styles.linkedDefectBtn,
                              { backgroundColor: colors.dangerSoft, borderColor: colors.danger },
                            ]}
                          >
                            <Text style={[styles.linkedDefectBtnText, { color: colors.danger }]}>
                              + Log Defect
                            </Text>
                          </Pressable>
                        ) : null}
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          </>
        )}
      </ScrollView>

      {/* Execute Test Case Detail & Actual Result Modal */}
      <Modal
        visible={Boolean(executingEntry)}
        transparent
        animationType="slide"
        onRequestClose={() => setExecutingEntry(null)}
      >
        {executingEntry ? (
          <KeyboardAvoidingView
            style={[styles.modalBackdrop, { backgroundColor: colors.overlay }]}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
            <View
              style={[
                styles.modalSheet,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <View style={[styles.handleBar, { backgroundColor: colors.borderStrong }]} />

              <View style={[styles.modalTopBar, { borderBottomColor: colors.border }]}>
                <View style={styles.modalTitleCol}>
                  <Text
                    style={[
                      styles.modalCode,
                      { color: colors.primary, fontFamily: monoFontFamily },
                    ]}
                  >
                    {executingEntry.run.id} · EXECUTE {executingEntry.testCase.id}
                  </Text>
                  <Text style={[styles.modalSub, { color: colors.textMuted }]}>
                    {executingEntry.run.deviceInfo} · Build {executingEntry.run.buildVersion}
                  </Text>
                </View>
                <Pressable
                  onPress={() => setExecutingEntry(null)}
                  style={[
                    styles.closeBtn,
                    { backgroundColor: colors.surfaceMuted, borderColor: colors.border },
                  ]}
                >
                  <Text style={[styles.closeBtnText, { color: colors.text }]}>
                    Close
                  </Text>
                </Pressable>
              </View>

              <ScrollView
                contentContainerStyle={styles.modalBody}
                keyboardShouldPersistTaps="handled"
              >
                <Text style={[styles.detailTitle, { color: colors.text }]}>
                  {executingEntry.testCase.title}
                </Text>

                {/* Steps Reference */}
                <Text style={[styles.sectionHeader, { color: colors.text }]}>
                  Test Steps to Verify ({executingEntry.testCase.steps?.length || 0})
                </Text>
                {(executingEntry.testCase.steps || []).map((st, idx) => (
                  <View
                    key={st.id || idx}
                    style={[
                      styles.stepRefBox,
                      { backgroundColor: colors.background, borderColor: colors.border },
                    ]}
                  >
                    <Text
                      style={[
                        styles.stepRefNum,
                        { color: colors.primary, fontFamily: monoFontFamily },
                      ]}
                    >
                      STEP {idx + 1}: {st.action}
                    </Text>
                    {st.expectedResult ? (
                      <Text style={[styles.stepRefExp, { color: colors.textSecondary }]}>
                        Expected: {st.expectedResult}
                      </Text>
                    ) : null}
                  </View>
                ))}

                {/* Execution Status Selector */}
                <Text style={[styles.sectionHeader, { color: colors.text }]}>
                  Select Execution Status
                </Text>
                <View style={styles.statusSelectGrid}>
                  {executionStatuses.map((st) => {
                    const active = execStatus === st;
                    return (
                      <Pressable
                        key={st}
                        onPress={() => setExecStatus(st)}
                        style={[
                          styles.statusOptionBtn,
                          {
                            backgroundColor: active
                              ? colors.surfaceAccent
                              : colors.background,
                            borderColor: active ? getStatusColor(st) : colors.border,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.statusOptionText,
                            {
                              color: active ? getStatusColor(st) : colors.textSecondary,
                            },
                          ]}
                        >
                          {st}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
                  Actual Result Observed
                </Text>
                <TextInput
                  value={execActualResult}
                  onChangeText={setExecActualResult}
                  multiline
                  placeholder="Describe the actual behavior observed during execution..."
                  placeholderTextColor={colors.textMuted}
                  style={[
                    styles.textArea,
                    {
                      backgroundColor: colors.background,
                      borderColor: colors.border,
                      color: colors.text,
                    },
                  ]}
                />

                <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
                  Execution Notes / Device Observations
                </Text>
                <TextInput
                  value={execNotes}
                  onChangeText={setExecNotes}
                  multiline
                  placeholder="Optional logs, latency notes, or environment details..."
                  placeholderTextColor={colors.textMuted}
                  style={[
                    styles.textArea,
                    {
                      backgroundColor: colors.background,
                      borderColor: colors.border,
                      color: colors.text,
                    },
                  ]}
                />

                <View style={styles.execModalActions}>
                  <Pressable
                    onPress={() => handleSaveExecution(false)}
                    style={[styles.saveExecBtn, { backgroundColor: colors.primary }]}
                  >
                    <Text style={[styles.saveExecBtnText, { color: colors.textOnPrimary }]}>
                      Save Execution Result
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={() => handleSaveExecution(true)}
                    style={[
                      styles.failAndBugBtn,
                      { backgroundColor: colors.dangerSoft, borderColor: colors.danger },
                    ]}
                  >
                    <Text style={[styles.failAndBugBtnText, { color: colors.danger }]}>
                      Mark Failed & Create Defect
                    </Text>
                  </Pressable>
                </View>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        ) : null}
      </Modal>

      {/* Create New Test Run Modal */}
      <Modal
        visible={isCreateRunOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setIsCreateRunOpen(false)}
      >
        <KeyboardAvoidingView
          style={[styles.modalBackdrop, { backgroundColor: colors.overlay }]}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View
            style={[
              styles.modalSheet,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={[styles.handleBar, { backgroundColor: colors.borderStrong }]} />

            <View style={[styles.modalTopBar, { borderBottomColor: colors.border }]}>
              <Text style={[styles.detailTitle, { color: colors.text, marginBottom: 0 }]}>
                Create New Test Run
              </Text>
              <Pressable
                onPress={() => setIsCreateRunOpen(false)}
                style={[
                  styles.closeBtn,
                  { backgroundColor: colors.surfaceMuted, borderColor: colors.border },
                ]}
              >
                <Text style={[styles.closeBtnText, { color: colors.text }]}>Cancel</Text>
              </Pressable>
            </View>

            <ScrollView
              contentContainerStyle={styles.modalBody}
              keyboardShouldPersistTaps="handled"
            >
              {runError ? (
                <View
                  style={[
                    styles.errorBanner,
                    { backgroundColor: colors.dangerSoft, borderColor: colors.danger },
                  ]}
                >
                  <Text style={[styles.errorBannerText, { color: colors.danger }]}>
                    {runError}
                  </Text>
                </View>
              ) : null}

              <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
                Test Run Name *
              </Text>
              <TextInput
                value={runName}
                onChangeText={setRunName}
                placeholder="v1.0.0 Release Candidate Regression"
                placeholderTextColor={colors.textMuted}
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                    color: colors.text,
                  },
                ]}
              />

              <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
                Test Suite Scope
              </Text>
              <View style={styles.statusSelectGrid}>
                <Pressable
                  onPress={() => setRunSuiteId('all')}
                  style={[
                    styles.statusOptionBtn,
                    {
                      backgroundColor:
                        runSuiteId === 'all' ? colors.primary : colors.background,
                      borderColor:
                        runSuiteId === 'all' ? colors.primary : colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.statusOptionText,
                      {
                        color:
                          runSuiteId === 'all' ? colors.textOnPrimary : colors.text,
                      },
                    ]}
                  >
                    All Suites ({testCases.length})
                  </Text>
                </Pressable>

                {suites.map((sq) => {
                  const active = runSuiteId === sq.id;
                  const count = testCases.filter((c) => c.suiteId === sq.id).length;
                  return (
                    <Pressable
                      key={sq.id}
                      onPress={() => setRunSuiteId(sq.id)}
                      style={[
                        styles.statusOptionBtn,
                        {
                          backgroundColor: active ? colors.primary : colors.background,
                          borderColor: active ? colors.primary : colors.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.statusOptionText,
                          { color: active ? colors.textOnPrimary : colors.text },
                        ]}
                      >
                        {sq.name} ({count})
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
                Build Version
              </Text>
              <TextInput
                value={runBuild}
                onChangeText={setRunBuild}
                placeholder="1.0.0-build.104"
                placeholderTextColor={colors.textMuted}
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                    color: colors.text,
                    fontFamily: monoFontFamily,
                  },
                ]}
              />

              <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
                Target Device / OS
              </Text>
              <TextInput
                value={runDevice}
                onChangeText={setRunDevice}
                placeholder="Pixel 8 · Android 15"
                placeholderTextColor={colors.textMuted}
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                    color: colors.text,
                  },
                ]}
              />

              <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
                Test Environment
              </Text>
              <TextInput
                value={runEnv}
                onChangeText={setRunEnv}
                placeholder="Staging APK / Expo Go"
                placeholderTextColor={colors.textMuted}
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                    color: colors.text,
                  },
                ]}
              />

              <Pressable
                onPress={handleCreateRun}
                style={[styles.saveExecBtn, { backgroundColor: colors.primary }]}
              >
                <Text style={[styles.saveExecBtnText, { color: colors.textOnPrimary }]}>
                  Start Test Run
                </Text>
              </Pressable>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 96,
    maxWidth: 920,
    width: '100%',
    alignSelf: 'center',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 12,
  },
  headerTextCol: {
    flex: 1,
    minWidth: 180,
  },
  kicker: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
  },
  createBtn: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  runTabs: {
    flexDirection: 'row',
    gap: 10,
    paddingBottom: 12,
  },
  runTabCard: {
    width: 210,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  runTabCode: {
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 2,
  },
  runTabTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
  },
  runTabMeta: {
    fontSize: 11,
  },
  runDetailCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 14,
  },
  runDetailTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 12,
  },
  runDetailTitleCol: {
    flex: 1,
    minWidth: 190,
  },
  runIdBadge: {
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 3,
  },
  runDetailName: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
  },
  runDeviceText: {
    fontSize: 12,
    lineHeight: 17,
  },
  deleteRunBtn: {
    minHeight: 38,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteRunText: {
    fontSize: 12,
    fontWeight: '700',
  },
  progressWrap: {
    marginBottom: 12,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  progressLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  progressPct: {
    fontSize: 12,
    fontWeight: '700',
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
  runCountersRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  counterChip: {
    minHeight: 36,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  counterChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  queueList: {
    gap: 10,
  },
  execCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
  },
  execCardTop: {
    marginBottom: 10,
  },
  execMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 4,
  },
  execCaseId: {
    fontSize: 12,
    fontWeight: '700',
  },
  dot: {
    fontSize: 12,
  },
  execPriority: {
    fontSize: 12,
    fontWeight: '600',
  },
  execStatusText: {
    fontSize: 11,
    fontWeight: '700',
  },
  execTime: {
    fontSize: 11,
  },
  execTitle: {
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 21,
    marginBottom: 4,
  },
  actualResultText: {
    fontSize: 13,
    lineHeight: 18,
  },
  expectedPreviewText: {
    fontSize: 13,
    lineHeight: 18,
  },
  notesPreviewText: {
    fontSize: 12,
    marginTop: 3,
  },
  execActionsBar: {
    borderTopWidth: 1,
    paddingTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  quickStatusGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  quickStatusBtn: {
    minHeight: 36,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickStatusText: {
    fontSize: 12,
    fontWeight: '700',
  },
  execRightBtns: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
  },
  recordNotesBtn: {
    minHeight: 36,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordNotesText: {
    fontSize: 12,
    fontWeight: '600',
  },
  linkedDefectBtn: {
    minHeight: 36,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkedDefectBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  emptyCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 24,
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
  },
  emptyBody: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginBottom: 14,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalSheet: {
    maxHeight: '92%',
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    paddingBottom: 20,
  },
  handleBar: {
    width: 40,
    height: 5,
    borderRadius: 3,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 6,
  },
  modalTopBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    gap: 10,
  },
  modalTitleCol: {
    flex: 1,
  },
  modalCode: {
    fontSize: 12,
    fontWeight: '700',
  },
  modalSub: {
    fontSize: 11,
  },
  closeBtn: {
    minHeight: 40,
    paddingHorizontal: 12,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  modalBody: {
    padding: 16,
  },
  detailTitle: {
    fontSize: 17,
    fontWeight: '700',
    lineHeight: 23,
    marginBottom: 10,
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
    marginTop: 4,
  },
  stepRefBox: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
    marginBottom: 6,
  },
  stepRefNum: {
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 2,
  },
  stepRefExp: {
    fontSize: 12,
  },
  statusSelectGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  statusOptionBtn: {
    minHeight: 40,
    paddingHorizontal: 12,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusOptionText: {
    fontSize: 12,
    fontWeight: '700',
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
  },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 14,
    marginBottom: 12,
  },
  textArea: {
    minHeight: 74,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    textAlignVertical: 'top',
    marginBottom: 12,
  },
  execModalActions: {
    gap: 10,
    marginTop: 4,
  },
  saveExecBtn: {
    minHeight: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveExecBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
  failAndBugBtn: {
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  failAndBugBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  errorBanner: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
    marginBottom: 12,
  },
  errorBannerText: {
    fontSize: 13,
    fontWeight: '600',
  },
});

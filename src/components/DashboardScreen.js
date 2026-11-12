import React from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  Pressable,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useTheme, monoFontFamily } from '../theme/theme';
import { useProjects } from '../context/ProjectContext';
import { useWorkspace } from '../context/WorkspaceContext';
import VectorIcon from './VectorIcon';
import ReportsView from './ReportsView';

export default function DashboardScreen({ onNavigateToDestination }) {
  const { colors } = useTheme();
  const {
    selectedProject,
    projects,
    isRefreshing,
    refreshSelectedProject,
  } = useProjects();
  const {
    profile,
    testPlan,
    metrics,
    testRuns,
    executions,
    defects,
    activityLog,
    dashboardSubTab,
    setDashboardSubTab,
    openChecklistsView,
    reloadProjectDataFromBackend,
    isSyncingProjectData,
    setActiveTab,
    openProjectSelection,
    openProjectDetails,
    openTestSuitesView,
    openTestPlansView,
    setSelectedTestCaseId,
    setSelectedTestRunId,
    setSelectedDefectId,
    showToast,
  } = useWorkspace();

  const handleOpenChecklists = () => {
    if (typeof openChecklistsView === 'function') {
      openChecklistsView({ keepRunner: false });
    } else if (typeof onNavigateToDestination === 'function') {
      onNavigateToDestination('my_checklists');
    }
  };

  const isRefreshingAny = isRefreshing || isSyncingProjectData;

  const handleRefreshDashboard = async () => {
    const res = await reloadProjectDataFromBackend();
    if (!res || !res.ok) {
      await refreshSelectedProject();
    } else {
      showToast('Refreshed project dashboard from server', 'success');
    }
  };

  const totalCases = Math.max(metrics.totalTestCases, 1);
  const passFlex = metrics.passedCases / totalCases;
  const failFlex = metrics.failedCases / totalCases;
  const blockedFlex = metrics.blockedCases / totalCases;
  const untestedFlex = metrics.untestedCases / totalCases;

  const recentRuns = testRuns.slice(0, 3);
  const recentExecutions = [...executions]
    .sort((a, b) => {
      const dtA = a.executedAt || a.timestamp || a.createdAt || '';
      const dtB = b.executedAt || b.timestamp || b.createdAt || '';
      return dtA < dtB ? 1 : -1;
    })
    .slice(0, 5);
  const recentDefects = [...defects]
    .sort((a, b) => {
      const dtA = a.updatedAt || a.createdAt || '';
      const dtB = b.updatedAt || b.createdAt || '';
      return dtA < dtB ? 1 : -1;
    })
    .slice(0, 4);
  const recentActivities = activityLog.slice(0, 5);

  const projectStatus = (selectedProject && selectedProject.status) || 'Active';
  const statusPalette =
    projectStatus === 'Active'
      ? { bg: colors.successSoft, fg: colors.success }
      : projectStatus === 'Completed'
      ? { bg: colors.infoSoft, fg: colors.info }
      : { bg: colors.warningSoft, fg: colors.warning };

  const healthPalette =
    metrics.healthTone === 'success'
      ? { bg: colors.successSoft, fg: colors.success }
      : metrics.healthTone === 'warning'
      ? { bg: colors.warningSoft, fg: colors.warning }
      : metrics.healthTone === 'danger'
      ? { bg: colors.dangerSoft, fg: colors.danger }
      : { bg: colors.surfaceMuted, fg: colors.textSecondary };

  const defectStatusCounts = metrics.defectStatusBreakdown || {
    Open: 0,
    'In Progress': 0,
    'Ready for Retest': 0,
    Resolved: 0,
    Closed: 0,
    Reopened: 0,
  };

  const defectSeverityCounts = metrics.defectSeverityBreakdown || {
    Critical: 0,
    High: 0,
    Medium: 0,
    Low: 0,
  };

  const suiteProgressList = Array.isArray(metrics.suiteProgress)
    ? metrics.suiteProgress
    : [];
  const phaseProgressList = Array.isArray(metrics.phaseProgress)
    ? metrics.phaseProgress
    : [];

  return (
    <ScrollView
      style={[styles.scrollRoot, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={isRefreshingAny}
          onRefresh={handleRefreshDashboard}
          tintColor={colors.primary}
          colors={[colors.primary]}
        />
      }
    >
      <View style={styles.container}>
        {/* Top Segmented Mode Toggle: QA Overview | Reports & Analytics */}
        <View
          accessibilityRole="tablist"
          style={[
            styles.modeToggleContainer,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Pressable
            onPress={() => setDashboardSubTab('overview')}
            hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            accessibilityRole="tab"
            accessibilityState={{ selected: dashboardSubTab === 'overview' }}
            accessibilityLabel="QA Dashboard overview"
            style={[
              styles.modeToggleBtn,
              {
                backgroundColor:
                  dashboardSubTab === 'overview'
                    ? colors.primary
                    : 'transparent',
              },
            ]}
          >
            <VectorIcon
              name="layers"
              size={14}
              color={
                dashboardSubTab === 'overview'
                  ? colors.textOnPrimary
                  : colors.textSecondary
              }
            />
            <Text
              style={[
                styles.modeToggleBtnText,
                {
                  color:
                    dashboardSubTab === 'overview'
                      ? colors.textOnPrimary
                      : colors.textSecondary,
                  fontWeight: dashboardSubTab === 'overview' ? '700' : '600',
                },
              ]}
            >
              QA Dashboard
            </Text>
          </Pressable>

          <Pressable
            onPress={handleOpenChecklists}
            hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            accessibilityRole="tab"
            accessibilityState={{ selected: false }}
            accessibilityLabel="QA Checklists"
            style={[
              styles.modeToggleBtn,
              {
                backgroundColor: 'transparent',
              },
            ]}
          >
            <VectorIcon
              name="clipboard"
              size={14}
              color={colors.textSecondary}
            />
            <Text
              style={[
                styles.modeToggleBtnText,
                {
                  color: colors.textSecondary,
                  fontWeight: '600',
                },
              ]}
            >
              QA Checklists
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setDashboardSubTab('reports')}
            hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            accessibilityRole="tab"
            accessibilityState={{ selected: dashboardSubTab === 'reports' }}
            accessibilityLabel="Reports and Analytics"
            style={[
              styles.modeToggleBtn,
              {
                backgroundColor:
                  dashboardSubTab === 'reports'
                    ? colors.primary
                    : 'transparent',
              },
            ]}
          >
            <VectorIcon
              name="file-text"
              size={14}
              color={
                dashboardSubTab === 'reports'
                  ? colors.textOnPrimary
                  : colors.textSecondary
              }
            />
            <Text
              style={[
                styles.modeToggleBtnText,
                {
                  color:
                    dashboardSubTab === 'reports'
                      ? colors.textOnPrimary
                      : colors.textSecondary,
                  fontWeight: dashboardSubTab === 'reports' ? '700' : '600',
                },
              ]}
            >
              Reports & Analytics
            </Text>
          </Pressable>
        </View>

        {dashboardSubTab === 'reports' ? (
          <ReportsView />
        ) : (
          <>
            {/* 1. Active Project Overview Card */}
            <View
              style={[
                styles.bannerCard,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                },
              ]}
            >
              <View style={styles.bannerTopRow}>
                <View style={styles.bannerTextCol}>
                  <View style={styles.projectStatusRow}>
                    <View
                      style={[
                        styles.statusBadge,
                        { backgroundColor: statusPalette.bg },
                      ]}
                    >
                      <Text
                        style={[
                          styles.statusBadgeText,
                          {
                            color: statusPalette.fg,
                            fontFamily: monoFontFamily,
                          },
                        ]}
                      >
                        {projectStatus.toUpperCase()}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.statusBadge,
                        { backgroundColor: healthPalette.bg },
                      ]}
                    >
                      <Text
                        style={[
                          styles.statusBadgeText,
                          {
                            color: healthPalette.fg,
                            fontFamily: monoFontFamily,
                          },
                        ]}
                      >
                        HEALTH: {metrics.healthStatus || 'NO DATA'}
                      </Text>
                    </View>
                    {selectedProject && selectedProject.type ? (
                      <Text
                        style={[
                          styles.bannerOverline,
                          {
                            color: colors.primary,
                            fontFamily: monoFontFamily,
                          },
                        ]}
                      >
                        {selectedProject.type.toUpperCase()}
                        {selectedProject.version
                          ? ` · v${selectedProject.version}`
                          : ''}
                      </Text>
                    ) : null}
                  </View>

                  <Text style={[styles.bannerTitle, { color: colors.text }]}>
                    {(selectedProject && selectedProject.name) ||
                      profile.projectName}
                  </Text>
                  <Text
                    style={[
                      styles.bannerSub,
                      { color: colors.textSecondary },
                    ]}
                  >
                    {(selectedProject && selectedProject.description) ||
                      `Environment: ${
                        (selectedProject && selectedProject.environment) ||
                        'Android QA'
                      } · Lead: ${profile.testerName}`}
                  </Text>
                </View>

                <View style={styles.coverageRingBox}>
                  <Text
                    style={[
                      styles.coverageBigVal,
                      { color: colors.primary, fontFamily: monoFontFamily },
                    ]}
                  >
                    {metrics.coverageRate}%
                  </Text>
                  <Text
                    style={[styles.coverageLabel, { color: colors.textMuted }]}
                  >
                    Coverage
                  </Text>
                </View>
              </View>

              {/* Project Management & Refresh Actions */}
              <View
                style={[
                  styles.projectActionRow,
                  { borderTopColor: colors.border },
                ]}
              >
                <Pressable
                  onPress={handleRefreshDashboard}
                  disabled={isRefreshingAny}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: Boolean(isRefreshingAny) }}
                  accessibilityLabel={
                    isRefreshingAny
                      ? 'Syncing project dashboard'
                      : 'Refresh project dashboard'
                  }
                  style={[
                    styles.projectActionBtn,
                    {
                      backgroundColor: colors.surfaceElevated,
                      borderColor: colors.border,
                      opacity: isRefreshingAny ? 0.6 : 1,
                    },
                  ]}
                >
                  {isRefreshingAny ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <VectorIcon
                      name="refresh"
                      size={14}
                      color={colors.primary}
                    />
                  )}
                  <Text
                    style={[styles.projectActionText, { color: colors.text }]}
                  >
                    {isRefreshingAny ? 'Syncing...' : 'Refresh'}
                  </Text>
                </Pressable>

                <Pressable
                  onPress={handleOpenChecklists}
                  accessibilityRole="button"
                  accessibilityLabel="Open QA Checklists"
                  style={[
                    styles.projectActionBtn,
                    {
                      backgroundColor: colors.surfaceAccent,
                      borderColor: colors.primary,
                    },
                  ]}
                >
                  <VectorIcon
                    name="clipboard"
                    size={14}
                    color={colors.primary}
                  />
                  <Text
                    style={[
                      styles.projectActionText,
                      { color: colors.primary },
                    ]}
                  >
                    QA Checklists
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => setDashboardSubTab('reports')}
                  accessibilityRole="button"
                  accessibilityLabel="Open Reports and Export"
                  style={[
                    styles.projectActionBtn,
                    {
                      backgroundColor: colors.surfaceAccent,
                      borderColor: colors.primary,
                    },
                  ]}
                >
                  <VectorIcon
                    name="file-text"
                    size={14}
                    color={colors.primary}
                  />
                  <Text
                    style={[
                      styles.projectActionText,
                      { color: colors.primary },
                    ]}
                  >
                    Reports & Export
                  </Text>
                </Pressable>

                <Pressable
                  onPress={openProjectDetails}
                  accessibilityRole="button"
                  accessibilityLabel="Open Project Details"
                  style={[
                    styles.projectActionBtn,
                    {
                      backgroundColor: colors.surfaceElevated,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <VectorIcon name="info" size={14} color={colors.primary} />
                  <Text
                    style={[styles.projectActionText, { color: colors.text }]}
                  >
                    Details
                  </Text>
                </Pressable>

                <Pressable
                  onPress={openProjectSelection}
                  accessibilityRole="button"
                  accessibilityLabel={`Switch project, ${projects.length} total`}
                  style={[
                    styles.projectActionBtn,
                    {
                      backgroundColor: colors.surfaceElevated,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <VectorIcon name="folder" size={14} color={colors.primary} />
                  <Text
                    style={[styles.projectActionText, { color: colors.text }]}
                  >
                    Projects ({projects.length})
                  </Text>
                </Pressable>
              </View>

              {/* Quick Navigation Shortcuts */}
              <View style={styles.quickActionRow}>
                <Pressable
                  onPress={() => setActiveTab('testcases')}
                  accessibilityRole="button"
                  accessibilityLabel="Go to Test Cases to add a test case"
                  style={[
                    styles.quickActionBtn,
                    {
                      backgroundColor: colors.surfaceAccent,
                      borderColor: colors.primary,
                    },
                  ]}
                >
                  <Text
                    style={[styles.quickActionText, { color: colors.primary }]}
                  >
                    + Test Case
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => setActiveTab('testruns')}
                  accessibilityRole="button"
                  accessibilityLabel="Go to Test Runs to execute a run"
                  style={[
                    styles.quickActionBtn,
                    {
                      backgroundColor: colors.primary,
                      borderColor: colors.primary,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.quickActionText,
                      { color: colors.textOnPrimary },
                    ]}
                  >
                    Execute Run
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => setActiveTab('defects')}
                  accessibilityRole="button"
                  accessibilityLabel="Go to Defects to log a defect"
                  style={[
                    styles.quickActionBtn,
                    {
                      backgroundColor: colors.dangerSoft,
                      borderColor: colors.danger,
                    },
                  ]}
                >
                  <Text
                    style={[styles.quickActionText, { color: colors.danger }]}
                  >
                    Log Defect
                  </Text>
                </Pressable>
              </View>
            </View>

            {/* 2. Primary 4-KPI Grid (Qavora Web Dashboard Parity) */}
            <View style={styles.kpiGrid}>
              <Pressable
                onPress={() => setActiveTab('testcases')}
                accessibilityRole="button"
                accessibilityLabel={`Total Test Cases: ${metrics.totalTestCases}, ${metrics.totalSuites} suites, ${metrics.totalPhases} phases. Open Test Cases`}
                style={[
                  styles.kpiCard,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.kpiLabel,
                    { color: colors.textMuted, fontFamily: monoFontFamily },
                  ]}
                >
                  TOTAL TEST CASES
                </Text>
                <Text style={[styles.kpiValue, { color: colors.primary }]}>
                  {metrics.totalTestCases}
                </Text>
                <Text style={[styles.kpiSub, { color: colors.textSecondary }]}>
                  {metrics.totalSuites} suites · {metrics.totalPhases} phases
                </Text>
              </Pressable>

              <Pressable
                onPress={() => setActiveTab('testruns')}
                accessibilityRole="button"
                accessibilityLabel={`Pass Rate: ${metrics.passRate}%, ${metrics.executedCases} of ${metrics.totalTestCases} executed. Open Test Runs`}
                style={[
                  styles.kpiCard,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.kpiLabel,
                    { color: colors.textMuted, fontFamily: monoFontFamily },
                  ]}
                >
                  PASS RATE & PROGRESS
                </Text>
                <Text style={[styles.kpiValue, { color: colors.success }]}>
                  {metrics.passRate}%
                </Text>
                <Text style={[styles.kpiSub, { color: colors.textSecondary }]}>
                  {metrics.executedCases} of {metrics.totalTestCases} executed
                </Text>
              </Pressable>

              <Pressable
                onPress={() => setActiveTab('testruns')}
                accessibilityRole="button"
                accessibilityLabel={`Test Runs: ${metrics.totalRuns}, ${metrics.activeRuns} active, ${metrics.completedRuns} done. Open Test Runs`}
                style={[
                  styles.kpiCard,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.kpiLabel,
                    { color: colors.textMuted, fontFamily: monoFontFamily },
                  ]}
                >
                  TEST RUNS & EXECS
                </Text>
                <Text style={[styles.kpiValue, { color: colors.info }]}>
                  {metrics.totalRuns}
                </Text>
                <Text style={[styles.kpiSub, { color: colors.textSecondary }]}>
                  {metrics.activeRuns} active · {metrics.completedRuns} done ·{' '}
                  {metrics.totalExecutions} execs
                </Text>
              </Pressable>

              <Pressable
                onPress={() => setActiveTab('defects')}
                accessibilityRole="button"
                accessibilityLabel={`Active Defects: ${metrics.openDefects}, ${metrics.criticalOnlyActiveDefects} Critical, ${metrics.highOnlyActiveDefects} High. Open Defects`}
                style={[
                  styles.kpiCard,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.kpiLabel,
                    { color: colors.textMuted, fontFamily: monoFontFamily },
                  ]}
                >
                  ACTIVE DEFECTS
                </Text>
                <Text
                  style={[
                    styles.kpiValue,
                    {
                      color:
                        metrics.openDefects > 0
                          ? colors.danger
                          : colors.success,
                    },
                  ]}
                >
                  {metrics.openDefects}
                </Text>
                <Text style={[styles.kpiSub, { color: colors.textSecondary }]}>
                  {metrics.criticalOnlyActiveDefects} Critical ·{' '}
                  {metrics.highOnlyActiveDefects} High ({metrics.totalDefects}{' '}
                  total)
                </Text>
              </Pressable>
            </View>

            {/* 3. Test Case Execution Status Breakdown Card */}
            <View
              style={[
                styles.sectionCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <View style={styles.sectionHeader}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>
                  Test Execution Progress & Case Verdicts
                </Text>
                <Text
                  style={[
                    styles.sectionMeta,
                    { color: colors.textMuted, fontFamily: monoFontFamily },
                  ]}
                >
                  {metrics.executedCases}/{metrics.totalTestCases} Executed (
                  {metrics.coverageRate}%)
                </Text>
              </View>

              {metrics.totalTestCases === 0 ? (
                <View style={styles.emptyBlock}>
                  <Text
                    style={[styles.emptyText, { color: colors.textSecondary }]}
                  >
                    No test cases defined for this project yet. Create your
                    first test suite and test case to track execution progress.
                  </Text>
                  <Pressable
                    onPress={() => setActiveTab('testcases')}
                    accessibilityRole="button"
                    accessibilityLabel="Create first test case"
                    style={[
                      styles.emptyPrimaryBtn,
                      { backgroundColor: colors.primary },
                    ]}
                  >
                    <Text
                      style={[
                        styles.emptyPrimaryBtnText,
                        { color: colors.textOnPrimary },
                      ]}
                    >
                      + Create First Test Case
                    </Text>
                  </Pressable>
                </View>
              ) : (
                <>
                  {/* Stacked Progress Bar */}
                  <View
                    style={[
                      styles.stackedBar,
                      { backgroundColor: colors.surfaceMuted },
                    ]}
                  >
                    {passFlex > 0 && (
                      <View
                        style={[
                          styles.barSegment,
                          {
                            flex: passFlex,
                            backgroundColor: colors.success,
                          },
                        ]}
                      />
                    )}
                    {failFlex > 0 && (
                      <View
                        style={[
                          styles.barSegment,
                          {
                            flex: failFlex,
                            backgroundColor: colors.danger,
                          },
                        ]}
                      />
                    )}
                    {blockedFlex > 0 && (
                      <View
                        style={[
                          styles.barSegment,
                          {
                            flex: blockedFlex,
                            backgroundColor: colors.warning,
                          },
                        ]}
                      />
                    )}
                    {untestedFlex > 0 && (
                      <View
                        style={[
                          styles.barSegment,
                          {
                            flex: untestedFlex,
                            backgroundColor: colors.border,
                          },
                        ]}
                      />
                    )}
                  </View>

                  <View style={styles.legendGrid}>
                    <View
                      style={[
                        styles.statusStatBox,
                        {
                          backgroundColor: colors.surfaceElevated,
                          borderColor: colors.border,
                        },
                      ]}
                    >
                      <View style={styles.legendItem}>
                        <View
                          style={[
                            styles.legendDot,
                            { backgroundColor: colors.success },
                          ]}
                        />
                        <Text
                          style={[
                            styles.legendText,
                            { color: colors.textSecondary },
                          ]}
                        >
                          Passed
                        </Text>
                      </View>
                      <Text
                        style={[
                          styles.statusStatNum,
                          { color: colors.success, fontFamily: monoFontFamily },
                        ]}
                      >
                        {metrics.passedCases}
                      </Text>
                    </View>

                    <View
                      style={[
                        styles.statusStatBox,
                        {
                          backgroundColor: colors.surfaceElevated,
                          borderColor: colors.border,
                        },
                      ]}
                    >
                      <View style={styles.legendItem}>
                        <View
                          style={[
                            styles.legendDot,
                            { backgroundColor: colors.danger },
                          ]}
                        />
                        <Text
                          style={[
                            styles.legendText,
                            { color: colors.textSecondary },
                          ]}
                        >
                          Failed
                        </Text>
                      </View>
                      <Text
                        style={[
                          styles.statusStatNum,
                          { color: colors.danger, fontFamily: monoFontFamily },
                        ]}
                      >
                        {metrics.failedCases}
                      </Text>
                    </View>

                    <View
                      style={[
                        styles.statusStatBox,
                        {
                          backgroundColor: colors.surfaceElevated,
                          borderColor: colors.border,
                        },
                      ]}
                    >
                      <View style={styles.legendItem}>
                        <View
                          style={[
                            styles.legendDot,
                            { backgroundColor: colors.warning },
                          ]}
                        />
                        <Text
                          style={[
                            styles.legendText,
                            { color: colors.textSecondary },
                          ]}
                        >
                          Blocked
                        </Text>
                      </View>
                      <Text
                        style={[
                          styles.statusStatNum,
                          { color: colors.warning, fontFamily: monoFontFamily },
                        ]}
                      >
                        {metrics.blockedCases}
                      </Text>
                    </View>

                    <View
                      style={[
                        styles.statusStatBox,
                        {
                          backgroundColor: colors.surfaceElevated,
                          borderColor: colors.border,
                        },
                      ]}
                    >
                      <View style={styles.legendItem}>
                        <View
                          style={[
                            styles.legendDot,
                            { backgroundColor: colors.textMuted },
                          ]}
                        />
                        <Text
                          style={[
                            styles.legendText,
                            { color: colors.textSecondary },
                          ]}
                        >
                          Not Run
                        </Text>
                      </View>
                      <Text
                        style={[
                          styles.statusStatNum,
                          {
                            color: colors.textSecondary,
                            fontFamily: monoFontFamily,
                          },
                        ]}
                      >
                        {metrics.notRunCases}
                      </Text>
                    </View>
                  </View>
                </>
              )}
            </View>

            {/* 4. Defect Status & Priority/Severity Breakdown Card */}
            <View
              style={[
                styles.sectionCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <View style={styles.sectionHeader}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>
                  Defect Status & Priority Breakdown
                </Text>
                <Pressable
                  onPress={() => setActiveTab('defects')}
                  accessibilityRole="button"
                  accessibilityLabel={`View all ${metrics.totalDefects} defects, ${metrics.defectResolutionRate}% resolved`}
                >
                  <Text style={[styles.linkText, { color: colors.primary }]}>
                    {metrics.totalDefects} Total · {metrics.defectResolutionRate}
                    % Resolved →
                  </Text>
                </Pressable>
              </View>

              {/* Critical & High Priority Highlight Strip */}
              <View style={styles.priorityAlertRow}>
                <View
                  style={[
                    styles.priorityAlertBox,
                    {
                      backgroundColor: colors.dangerSoft,
                      borderColor: colors.danger,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.priorityAlertLabel,
                      { color: colors.danger, fontFamily: monoFontFamily },
                    ]}
                  >
                    CRITICAL ACTIVE
                  </Text>
                  <Text
                    style={[
                      styles.priorityAlertVal,
                      { color: colors.danger, fontFamily: monoFontFamily },
                    ]}
                  >
                    {metrics.criticalOnlyActiveDefects}
                  </Text>
                  <Text
                    style={[
                      styles.priorityAlertSub,
                      { color: colors.textSecondary },
                    ]}
                  >
                    {defectSeverityCounts.Critical} total critical
                  </Text>
                </View>

                <View
                  style={[
                    styles.priorityAlertBox,
                    {
                      backgroundColor: colors.warningSoft,
                      borderColor: colors.warning,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.priorityAlertLabel,
                      { color: colors.warning, fontFamily: monoFontFamily },
                    ]}
                  >
                    HIGH ACTIVE
                  </Text>
                  <Text
                    style={[
                      styles.priorityAlertVal,
                      { color: colors.warning, fontFamily: monoFontFamily },
                    ]}
                  >
                    {metrics.highOnlyActiveDefects}
                  </Text>
                  <Text
                    style={[
                      styles.priorityAlertSub,
                      { color: colors.textSecondary },
                    ]}
                  >
                    {defectSeverityCounts.High} total high
                  </Text>
                </View>
              </View>

              {/* 6-Status Breakdown Grid */}
              <View style={styles.legendGrid}>
                {[
                  {
                    label: 'Open',
                    count: defectStatusCounts.Open || 0,
                    color: colors.danger,
                  },
                  {
                    label: 'In Progress',
                    count: defectStatusCounts['In Progress'] || 0,
                    color: colors.warning,
                  },
                  {
                    label: 'Ready for Retest',
                    count: defectStatusCounts['Ready for Retest'] || 0,
                    color: colors.info,
                  },
                  {
                    label: 'Resolved',
                    count: defectStatusCounts.Resolved || 0,
                    color: colors.success,
                  },
                  {
                    label: 'Closed',
                    count: defectStatusCounts.Closed || 0,
                    color: colors.textSecondary,
                  },
                  {
                    label: 'Reopened',
                    count: defectStatusCounts.Reopened || 0,
                    color: colors.danger,
                  },
                ].map((item) => (
                  <View
                    key={item.label}
                    style={[
                      styles.statusStatBox,
                      {
                        backgroundColor: colors.surfaceElevated,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.legendText,
                        { color: colors.textSecondary },
                      ]}
                    >
                      {item.label}
                    </Text>
                    <Text
                      style={[
                        styles.statusStatNum,
                        { color: item.color, fontFamily: monoFontFamily },
                      ]}
                    >
                      {item.count}
                    </Text>
                  </View>
                ))}
              </View>
            </View>

            {/* 5. Test Plan & Test Suites Progress Card */}
            <View
              style={[
                styles.sectionCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <View style={styles.sectionHeader}>
                <Pressable
                  onPress={() => {
                    if (typeof openTestPlansView === 'function') {
                      openTestPlansView();
                    } else {
                      setActiveTab('testcases', { testCasesSubTab: 'plan' });
                    }
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Open Test Plans"
                  style={styles.sectionTitleCol}
                >
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>
                    Test Plan & Suite Progress
                  </Text>
                  {testPlan && testPlan.name ? (
                    <Text
                      style={[
                        styles.planSubtitle,
                        { color: colors.textMuted, fontFamily: monoFontFamily },
                      ]}
                    >
                      Plan: {testPlan.name} ({metrics.totalPhases} phases ·{' '}
                      {metrics.totalSuites} suites)
                    </Text>
                  ) : null}
                </Pressable>
                <Pressable
                  onPress={() => {
                    if (typeof openTestSuitesView === 'function') {
                      openTestSuitesView();
                    } else {
                      setActiveTab('testcases', { testCasesSubTab: 'suites' });
                    }
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="View Test Suites"
                >
                  <Text style={[styles.linkText, { color: colors.primary }]}>
                    View Suites →
                  </Text>
                </Pressable>
              </View>

              {suiteProgressList.length === 0 &&
              phaseProgressList.length === 0 ? (
                <Text
                  style={[styles.emptyText, { color: colors.textSecondary }]}
                >
                  No test suites or plan phases configured yet.
                </Text>
              ) : (
                <View style={styles.rowList}>
                  {suiteProgressList.map((sp) => (
                    <Pressable
                      key={sp.id}
                      onPress={() => {
                        if (typeof openTestSuitesView === 'function') {
                          openTestSuitesView();
                        } else {
                          setActiveTab('testcases', {
                            testCasesSubTab: 'suites',
                          });
                        }
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`Open suite ${sp.name}, ${sp.coveragePct}% covered, ${sp.passRate}% pass rate`}
                      style={[
                        styles.suiteProgressItem,
                        {
                          backgroundColor: colors.surfaceElevated,
                          borderColor: colors.border,
                        },
                      ]}
                    >
                      <View style={styles.rowItemTop}>
                        <Text
                          numberOfLines={1}
                          style={[styles.rowTitle, { color: colors.text }]}
                        >
                          {sp.name}
                        </Text>
                        <Text
                          style={[
                            styles.rowCode,
                            {
                              color:
                                sp.passRate >= 80
                                  ? colors.success
                                  : colors.primary,
                              fontFamily: monoFontFamily,
                            },
                          ]}
                        >
                          {sp.coveragePct}% Covered · {sp.passRate}% Pass
                        </Text>
                      </View>
                      <Text
                        style={[
                          styles.rowMeta,
                          {
                            color: colors.textSecondary,
                            fontFamily: monoFontFamily,
                          },
                        ]}
                      >
                        Phase: {sp.phaseName} · {sp.executedCases}/
                        {sp.totalCases} executed ({sp.passedCases}P /{' '}
                        {sp.failedCases}F / {sp.blockedCases}B /{' '}
                        {sp.untestedCases} Not Run)
                      </Text>
                      <View
                        style={[
                          styles.miniProgressTrack,
                          { backgroundColor: colors.surfaceMuted },
                        ]}
                      >
                        <View
                          style={[
                            styles.miniProgressFill,
                            {
                              width: `${Math.min(100, sp.coveragePct)}%`,
                              backgroundColor:
                                sp.failedCases > 0
                                  ? colors.warning
                                  : colors.success,
                            },
                          ]}
                        />
                      </View>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>

            {/* 6. Recent Test Runs & Execution Activity */}
            <View
              style={[
                styles.sectionCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <View style={styles.sectionHeader}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>
                  Recent Test Runs & Execution Activity
                </Text>
                <Pressable
                  onPress={() => setActiveTab('testruns')}
                  accessibilityRole="button"
                  accessibilityLabel={`View all ${metrics.totalRuns} test runs`}
                >
                  <Text style={[styles.linkText, { color: colors.primary }]}>
                    All Runs ({metrics.totalRuns}) →
                  </Text>
                </Pressable>
              </View>

              {recentRuns.length === 0 && recentExecutions.length === 0 ? (
                <Text
                  style={[styles.emptyText, { color: colors.textSecondary }]}
                >
                  No test runs or execution records logged yet. Start a Test Run
                  to record Pass, Fail, or Blocked verdicts.
                </Text>
              ) : (
                <View style={styles.rowList}>
                  {recentRuns.map((run) => {
                    const isCompleted = run.status === 'Completed';
                    return (
                      <Pressable
                        key={run.id}
                        onPress={() => {
                          setSelectedTestRunId(run.id);
                          setActiveTab('testruns');
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={`Open test run ${run.id}: ${run.name}`}
                        style={[
                          styles.rowItem,
                          {
                            backgroundColor: colors.surfaceElevated,
                            borderColor: colors.border,
                          },
                        ]}
                      >
                        <View style={styles.rowItemTop}>
                          <Text
                            style={[
                              styles.rowCode,
                              {
                                color: colors.primary,
                                fontFamily: monoFontFamily,
                              },
                            ]}
                          >
                            {run.id} · Build {run.buildVersion}
                          </Text>
                          <View
                            style={[
                              styles.badgePill,
                              {
                                backgroundColor: isCompleted
                                  ? colors.successSoft
                                  : colors.warningSoft,
                              },
                            ]}
                          >
                            <Text
                              style={[
                                styles.badgeText,
                                {
                                  color: isCompleted
                                    ? colors.success
                                    : colors.warning,
                                },
                              ]}
                            >
                              {run.status}
                            </Text>
                          </View>
                        </View>
                        <Text
                          numberOfLines={1}
                          style={[styles.rowTitle, { color: colors.text }]}
                        >
                          {run.name}
                        </Text>
                        <Text
                          style={[
                            styles.rowMeta,
                            {
                              color: colors.textSecondary,
                              fontFamily: monoFontFamily,
                            },
                          ]}
                        >
                          {run.deviceInfo} · {run.metrics.passed}P /{' '}
                          {run.metrics.failed}F / {run.metrics.blocked}B (
                          {run.metrics.passRate}% Pass)
                        </Text>
                      </Pressable>
                    );
                  })}

                  {/* Recent Individual Case Executions */}
                  {recentExecutions.length > 0 ? (
                    <View
                      style={[
                        styles.subListDivider,
                        { borderTopColor: colors.border },
                      ]}
                    >
                      <Text
                        style={[
                          styles.subListHeading,
                          {
                            color: colors.textMuted,
                            fontFamily: monoFontFamily,
                          },
                        ]}
                      >
                        LATEST CASE EXECUTIONS ({metrics.totalExecutions})
                      </Text>
                      {recentExecutions.map((ex, idx) => {
                        const st = String(
                          ex.status || ex.outcome || ''
                        ).toUpperCase();
                        const isPass = st === 'PASSED' || st === 'PASS';
                        const isFail = st === 'FAILED' || st === 'FAIL';
                        const pillBg = isPass
                          ? colors.successSoft
                          : isFail
                          ? colors.dangerSoft
                          : colors.warningSoft;
                        const pillFg = isPass
                          ? colors.success
                          : isFail
                          ? colors.danger
                          : colors.warning;

                        return (
                          <Pressable
                            key={ex.id || `${ex.testCaseId}-${idx}`}
                            onPress={() => {
                              const targetRunId = ex.testRunId || ex.runId;
                              const targetCaseId = ex.testCaseId || ex.caseId;
                              if (targetRunId) {
                                setSelectedTestRunId(targetRunId);
                                setActiveTab('testruns');
                              } else if (targetCaseId) {
                                setSelectedTestCaseId(targetCaseId);
                                setActiveTab('testcases');
                              }
                            }}
                            accessibilityRole="button"
                            accessibilityLabel={`Open execution record for ${
                              ex.testCaseId ||
                              ex.caseId ||
                              ex.testCaseTitle ||
                              'test execution'
                            }`}
                            style={[
                              styles.rowItem,
                              {
                                backgroundColor: colors.surfaceElevated,
                                borderColor: colors.border,
                              },
                            ]}
                          >
                            <View style={styles.rowItemTop}>
                              <Text
                                style={[
                                  styles.rowCode,
                                  {
                                    color: colors.primary,
                                    fontFamily: monoFontFamily,
                                  },
                                ]}
                              >
                                {ex.testCaseId || ex.caseId}
                              </Text>
                              <View
                                style={[
                                  styles.badgePill,
                                  { backgroundColor: pillBg },
                                ]}
                              >
                                <Text
                                  style={[styles.badgeText, { color: pillFg }]}
                                >
                                  {st || 'EXECUTED'}
                                </Text>
                              </View>
                            </View>
                            <Text
                              numberOfLines={1}
                              style={[styles.rowTitle, { color: colors.text }]}
                            >
                              {ex.testCaseTitle ||
                                ex.caseTitle ||
                                'Test Execution'}
                            </Text>
                            <Text
                              style={[
                                styles.rowMeta,
                                {
                                  color: colors.textSecondary,
                                  fontFamily: monoFontFamily,
                                },
                              ]}
                            >
                              {ex.testerName || ex.tester || 'QA Tester'} ·{' '}
                              {ex.environment || 'Staging'} ·{' '}
                              {String(ex.executedAt || '')
                                .slice(0, 16)
                                .replace('T', ' ')}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  ) : null}
                </View>
              )}
            </View>

            {/* 7. Recent Defects Card */}
            <View
              style={[
                styles.sectionCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <View style={styles.sectionHeader}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>
                  Recent Project Defects
                </Text>
                <Pressable
                  onPress={() => setActiveTab('defects')}
                  accessibilityRole="button"
                  accessibilityLabel={`View all ${metrics.totalDefects} defects`}
                >
                  <Text style={[styles.linkText, { color: colors.primary }]}>
                    All Defects ({metrics.totalDefects}) →
                  </Text>
                </Pressable>
              </View>

              {recentDefects.length === 0 ? (
                <Text
                  style={[styles.emptyText, { color: colors.textSecondary }]}
                >
                  Zero defects logged for this project.
                </Text>
              ) : (
                <View style={styles.rowList}>
                  {recentDefects.map((bug) => {
                    const isCritical =
                      bug.severity === 'Critical' || bug.severity === 'High';
                    return (
                      <Pressable
                        key={bug.id}
                        onPress={() => {
                          setSelectedDefectId(bug.id);
                          setActiveTab('defects');
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={`Open defect ${bug.id}: ${bug.title}`}
                        style={[
                          styles.rowItem,
                          {
                            backgroundColor: colors.surfaceElevated,
                            borderColor: colors.border,
                          },
                        ]}
                      >
                        <View style={styles.rowItemTop}>
                          <Text
                            style={[
                              styles.rowCode,
                              {
                                color: isCritical
                                  ? colors.danger
                                  : colors.textSecondary,
                                fontFamily: monoFontFamily,
                              },
                            ]}
                          >
                            {bug.id} · {bug.severity}
                          </Text>
                          <View
                            style={[
                              styles.badgePill,
                              {
                                backgroundColor:
                                  bug.status === 'Closed' ||
                                  bug.status === 'Resolved'
                                    ? colors.successSoft
                                    : colors.dangerSoft,
                              },
                            ]}
                          >
                            <Text
                              style={[
                                styles.badgeText,
                                {
                                  color:
                                    bug.status === 'Closed' ||
                                    bug.status === 'Resolved'
                                      ? colors.success
                                      : colors.danger,
                                },
                              ]}
                            >
                              {bug.status}
                            </Text>
                          </View>
                        </View>
                        <Text
                          numberOfLines={1}
                          style={[styles.rowTitle, { color: colors.text }]}
                        >
                          {bug.title}
                        </Text>
                        <Text
                          style={[
                            styles.rowMeta,
                            {
                              color: colors.textSecondary,
                              fontFamily: monoFontFamily,
                            },
                          ]}
                        >
                          Assignee: {bug.assignee || 'Unassigned'}
                          {bug.linkedTestCaseId
                            ? ` · Case: ${bug.linkedTestCaseId}`
                            : ''}
                          {bug.linkedTestRunId
                            ? ` · Run: ${bug.linkedTestRunId}`
                            : ''}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>

            {/* 8. Recent Workspace Activity Stream */}
            {recentActivities.length > 0 ? (
              <View
                style={[
                  styles.sectionCard,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text style={[styles.sectionTitle, { color: colors.text }]}>
                  Recent Workspace Activity
                </Text>
                <View style={styles.activityList}>
                  {recentActivities.map((act) => (
                    <View
                      key={act.id}
                      style={[
                        styles.activityRow,
                        { borderBottomColor: colors.border },
                      ]}
                    >
                      <View style={styles.activityLeft}>
                        <Text
                          style={[styles.activityTitle, { color: colors.text }]}
                        >
                          {act.title}
                        </Text>
                        {act.detail ? (
                          <Text
                            numberOfLines={1}
                            style={[
                              styles.activityDetail,
                              { color: colors.textSecondary },
                            ]}
                          >
                            {act.detail}
                          </Text>
                        ) : null}
                      </View>
                      <Text
                        style={[
                          styles.activityTime,
                          {
                            color: colors.textMuted,
                            fontFamily: monoFontFamily,
                          },
                        ]}
                      >
                        {act.timestamp.split(' ')[1] || act.timestamp}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}
          </>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollRoot: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 28,
  },
  container: {
    maxWidth: 920,
    width: '100%',
    alignSelf: 'center',
    gap: 14,
  },
  modeToggleContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderRadius: 12,
    borderWidth: 1,
    padding: 4,
    gap: 5,
  },
  modeToggleBtn: {
    flex: 1,
    minWidth: 96,
    minHeight: 44,
    borderRadius: 9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 7,
    paddingVertical: 6,
  },
  modeToggleBtnText: {
    fontSize: 12,
    textAlign: 'center',
    flexShrink: 1,
  },
  bannerCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 14,
  },
  bannerTopRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
  },
  bannerTextCol: {
    flex: 1,
    minWidth: 180,
    gap: 4,
  },
  projectStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 2,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  bannerOverline: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  bannerTitle: {
    fontSize: 19,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  bannerSub: {
    fontSize: 12,
    lineHeight: 17,
  },
  coverageRingBox: {
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  coverageBigVal: {
    fontSize: 22,
    fontWeight: '700',
  },
  coverageLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  projectActionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  projectActionBtn: {
    minHeight: 44,
    paddingHorizontal: 11,
    borderRadius: 9,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  projectActionText: {
    fontSize: 12,
    fontWeight: '700',
  },
  quickActionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  quickActionBtn: {
    flex: 1,
    minWidth: 96,
    minHeight: 48,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  quickActionText: {
    fontSize: 12,
    fontWeight: '700',
  },
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  kpiCard: {
    flex: 1,
    minWidth: 145,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 4,
  },
  kpiLabel: {
    fontSize: 10,
    fontWeight: '700',
  },
  kpiValue: {
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  kpiSub: {
    fontSize: 11,
  },
  sectionCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    columnGap: 8,
    rowGap: 4,
  },
  sectionTitleCol: {
    flex: 1,
    minWidth: 170,
    gap: 2,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    flexShrink: 1,
  },
  planSubtitle: {
    fontSize: 11,
  },
  sectionMeta: {
    fontSize: 11,
    fontWeight: '600',
  },
  linkText: {
    fontSize: 12,
    fontWeight: '700',
  },
  emptyBlock: {
    gap: 10,
    paddingVertical: 6,
  },
  emptyPrimaryBtn: {
    alignSelf: 'flex-start',
    minHeight: 38,
    paddingHorizontal: 14,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyPrimaryBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  stackedBar: {
    height: 10,
    borderRadius: 5,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  barSegment: {
    height: '100%',
  },
  legendGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  statusStatBox: {
    flex: 1,
    minWidth: 125,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  statusStatNum: {
    fontSize: 15,
    fontWeight: '700',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 12,
    fontWeight: '600',
  },
  priorityAlertRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  priorityAlertBox: {
    flex: 1,
    minWidth: 140,
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    gap: 2,
  },
  priorityAlertLabel: {
    fontSize: 10,
    fontWeight: '700',
  },
  priorityAlertVal: {
    fontSize: 20,
    fontWeight: '700',
  },
  priorityAlertSub: {
    fontSize: 11,
  },
  rowList: {
    gap: 8,
  },
  suiteProgressItem: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    gap: 6,
  },
  miniProgressTrack: {
    height: 6,
    borderRadius: 999,
    overflow: 'hidden',
  },
  miniProgressFill: {
    height: '100%',
    borderRadius: 999,
  },
  rowItem: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    gap: 4,
  },
  rowItemTop: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    columnGap: 8,
    rowGap: 4,
  },
  rowCode: {
    fontSize: 11,
    fontWeight: '700',
  },
  rowTitle: {
    fontSize: 13,
    fontWeight: '600',
    flexShrink: 1,
  },
  rowMeta: {
    fontSize: 11,
  },
  badgePill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  subListDivider: {
    borderTopWidth: 1,
    paddingTop: 10,
    marginTop: 4,
    gap: 8,
  },
  subListHeading: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  emptyText: {
    fontSize: 12,
    paddingVertical: 4,
    lineHeight: 18,
  },
  activityList: {
    gap: 8,
  },
  activityRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 8,
    borderBottomWidth: 1,
    gap: 10,
  },
  activityLeft: {
    flex: 1,
    gap: 2,
  },
  activityTitle: {
    fontSize: 12,
    fontWeight: '600',
  },
  activityDetail: {
    fontSize: 11,
  },
  activityTime: {
    fontSize: 11,
  },
});

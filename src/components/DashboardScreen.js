import React from 'react';
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  ScrollView,
} from 'react-native';
import { useTheme, monoFontFamily } from '../theme/theme';
import { useProjects } from '../context/ProjectContext';
import { useWorkspace } from '../context/WorkspaceContext';
import VectorIcon from './VectorIcon';

export default function DashboardScreen() {
  const { colors } = useTheme();
  const { selectedProject } = useProjects();
  const {
    profile,
    suites,
    testCases,
    testRuns,
    defects,
    activityLog,
    metrics,
    lastPersistedAt,
    setActiveTab,
    openProjectSelection,
    openProjectDetails,
    setSelectedTestCaseId,
    setSelectedTestRunId,
    setSelectedDefectId,
  } = useWorkspace();

  const totalForBar = Math.max(metrics.totalTestCases, 1);
  const passedFlex = metrics.passedCases / totalForBar;
  const failedFlex = metrics.failedCases / totalForBar;
  const blockedFlex = metrics.blockedCases / totalForBar;
  const untestedFlex = metrics.untestedCases / totalForBar;

  const openDefectsList = defects.filter((d) => d.status !== 'Closed').slice(0, 3);
  const recentRunsList = testRuns.slice(0, 2);

  const getSeverityTone = (severity) => {
    if (severity === 'Critical') return colors.danger;
    if (severity === 'High') return colors.warning;
    if (severity === 'Medium') return colors.primary;
    return colors.textMuted;
  };

  const activeName =
    (selectedProject && selectedProject.name) || profile.projectName;
  const activeVersion =
    (selectedProject && selectedProject.version) ||
    profile.targetVersion ||
    'v1.0.0';
  const activeStatus =
    (selectedProject && selectedProject.status) || 'Active';
  const activeType =
    (selectedProject && selectedProject.type) || 'Mobile Application';
  const activeEnv =
    (selectedProject && selectedProject.environment) || profile.defaultDevice;

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {/* Project Overview Card */}
      <View
        style={[
          styles.projectCard,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <View style={styles.projectHeader}>
          <View style={styles.projectTitleCol}>
            <Text
              style={[
                styles.kicker,
                { color: colors.primary, fontFamily: monoFontFamily },
              ]}
            >
              {activeStatus.toUpperCase()} PROJECT · {activeType.toUpperCase()} ·{' '}
              {activeVersion}
            </Text>
            <Text style={[styles.projectTitle, { color: colors.text }]}>
              {activeName}
            </Text>
            {selectedProject && selectedProject.description ? (
              <Text
                numberOfLines={2}
                style={[styles.projectSub, { color: colors.textSecondary }]}
              >
                {selectedProject.description}
              </Text>
            ) : (
              <Text style={[styles.projectSub, { color: colors.textSecondary }]}>
                Environment: {activeEnv} · Build {profile.defaultBuild}
              </Text>
            )}
          </View>
        </View>

        {/* Project Management Bar */}
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 8,
            marginBottom: 10,
          }}
        >
          <Pressable
            onPress={openProjectDetails}
            style={[
              styles.secondaryQuickBtn,
              {
                backgroundColor: colors.surfaceAccent,
                borderColor: colors.primary,
                flexDirection: 'row',
                gap: 6,
              },
            ]}
          >
            <VectorIcon name="info" size={15} color={colors.primary} />
            <Text style={[styles.secondaryQuickBtnText, { color: colors.primary }]}>
              Project Details
            </Text>
          </Pressable>

          <Pressable
            onPress={openProjectSelection}
            style={[
              styles.secondaryQuickBtn,
              {
                backgroundColor: colors.background,
                borderColor: colors.borderStrong,
                flexDirection: 'row',
                gap: 6,
              },
            ]}
          >
            <VectorIcon name="switch" size={15} color={colors.text} />
            <Text style={[styles.secondaryQuickBtnText, { color: colors.text }]}>
              Switch Project
            </Text>
          </Pressable>
        </View>

        {/* Quick Action Row */}
        <View style={styles.quickActionRow}>
          <Pressable
            onPress={() => setActiveTab('testcases')}
            style={[styles.primaryQuickBtn, { backgroundColor: colors.primary }]}
          >
            <Text style={[styles.primaryQuickBtnText, { color: colors.textOnPrimary }]}>
              + Test Case
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setActiveTab('testruns')}
            style={[
              styles.secondaryQuickBtn,
              { backgroundColor: colors.surfaceAccent, borderColor: colors.primary },
            ]}
          >
            <Text style={[styles.secondaryQuickBtnText, { color: colors.primary }]}>
              Run Tests
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setActiveTab('defects')}
            style={[
              styles.secondaryQuickBtn,
              { backgroundColor: colors.dangerSoft, borderColor: colors.danger },
            ]}
          >
            <Text style={[styles.secondaryQuickBtnText, { color: colors.danger }]}>
              + Defect
            </Text>
          </Pressable>
        </View>
      </View>

      {/* 4-Card Core QA Metrics Grid */}
      <View style={styles.kpiGrid}>
        <Pressable
          onPress={() => setActiveTab('testcases')}
          style={[
            styles.kpiCard,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.kpiLabel, { color: colors.textSecondary }]}>
            Total Test Cases
          </Text>
          <Text
            style={[
              styles.kpiValue,
              { color: colors.text, fontFamily: monoFontFamily },
            ]}
          >
            {metrics.totalTestCases}
          </Text>
          <Text style={[styles.kpiSub, { color: colors.textMuted }]}>
            Across {metrics.totalSuites} suites
          </Text>
        </Pressable>

        <Pressable
          onPress={() => setActiveTab('testruns')}
          style={[
            styles.kpiCard,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.kpiLabel, { color: colors.textSecondary }]}>
            Execution Pass Rate
          </Text>
          <Text
            style={[
              styles.kpiValue,
              { color: colors.success, fontFamily: monoFontFamily },
            ]}
          >
            {metrics.passRate}%
          </Text>
          <Text style={[styles.kpiSub, { color: colors.textMuted }]}>
            {metrics.executedCases}/{metrics.totalTestCases} executed ({metrics.coverageRate}%)
          </Text>
        </Pressable>

        <Pressable
          onPress={() => setActiveTab('testruns')}
          style={[
            styles.kpiCard,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.kpiLabel, { color: colors.textSecondary }]}>
            Test Runs
          </Text>
          <Text
            style={[
              styles.kpiValue,
              { color: colors.primary, fontFamily: monoFontFamily },
            ]}
          >
            {metrics.totalRuns}
          </Text>
          <Text style={[styles.kpiSub, { color: colors.textMuted }]}>
            {metrics.activeRuns} in progress · {metrics.completedRuns} done
          </Text>
        </Pressable>

        <Pressable
          onPress={() => setActiveTab('defects')}
          style={[
            styles.kpiCard,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.kpiLabel, { color: colors.textSecondary }]}>
            Open Defects
          </Text>
          <Text
            style={[
              styles.kpiValue,
              {
                color: metrics.openDefects > 0 ? colors.danger : colors.success,
                fontFamily: monoFontFamily,
              },
            ]}
          >
            {metrics.openDefects}
          </Text>
          <Text style={[styles.kpiSub, { color: colors.textMuted }]}>
            {metrics.criticalDefects} critical/high severity
          </Text>
        </Pressable>
      </View>

      {/* Test Execution Status Breakdown */}
      <View
        style={[
          styles.sectionCard,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <View style={styles.sectionHeaderRow}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Test Case Execution Breakdown
          </Text>
          <Text
            style={[
              styles.sectionCounter,
              { color: colors.textMuted, fontFamily: monoFontFamily },
            ]}
          >
            {metrics.coverageRate}% Coverage
          </Text>
        </View>

        {metrics.totalTestCases > 0 ? (
          <View style={[styles.stackedBar, { backgroundColor: colors.surfaceMuted }]}>
            {passedFlex > 0 && (
              <View
                style={[
                  styles.barSegment,
                  { flex: passedFlex, backgroundColor: colors.success },
                ]}
              />
            )}
            {failedFlex > 0 && (
              <View
                style={[
                  styles.barSegment,
                  { flex: failedFlex, backgroundColor: colors.danger },
                ]}
              />
            )}
            {blockedFlex > 0 && (
              <View
                style={[
                  styles.barSegment,
                  { flex: blockedFlex, backgroundColor: colors.warning },
                ]}
              />
            )}
            {untestedFlex > 0 && (
              <View
                style={[
                  styles.barSegment,
                  { flex: untestedFlex, backgroundColor: colors.borderStrong },
                ]}
              />
            )}
          </View>
        ) : null}

        <View style={styles.statusBreakdownRow}>
          <View style={styles.statusStatItem}>
            <Text
              style={[
                styles.statusStatValue,
                { color: colors.success, fontFamily: monoFontFamily },
              ]}
            >
              {metrics.passedCases}
            </Text>
            <Text style={[styles.statusStatLabel, { color: colors.textSecondary }]}>
              Passed
            </Text>
          </View>

          <View style={styles.statusStatItem}>
            <Text
              style={[
                styles.statusStatValue,
                { color: colors.danger, fontFamily: monoFontFamily },
              ]}
            >
              {metrics.failedCases}
            </Text>
            <Text style={[styles.statusStatLabel, { color: colors.textSecondary }]}>
              Failed
            </Text>
          </View>

          <View style={styles.statusStatItem}>
            <Text
              style={[
                styles.statusStatValue,
                { color: colors.warning, fontFamily: monoFontFamily },
              ]}
            >
              {metrics.blockedCases}
            </Text>
            <Text style={[styles.statusStatLabel, { color: colors.textSecondary }]}>
              Blocked
            </Text>
          </View>

          <View style={styles.statusStatItem}>
            <Text
              style={[
                styles.statusStatValue,
                { color: colors.textMuted, fontFamily: monoFontFamily },
              ]}
            >
              {metrics.untestedCases}
            </Text>
            <Text style={[styles.statusStatLabel, { color: colors.textSecondary }]}>
              Untested
            </Text>
          </View>
        </View>
      </View>

      {/* Suite Coverage Overview */}
      <View
        style={[
          styles.sectionCard,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <View style={styles.sectionHeaderRow}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Test Suites Summary ({suites.length})
          </Text>
          <Pressable
            onPress={() => setActiveTab('testcases')}
            style={[styles.linkTouch, { flexDirection: 'row', alignItems: 'center', gap: 4 }]}
          >
            <Text style={[styles.linkText, { color: colors.primary }]}>
              Manage Suites
            </Text>
            <VectorIcon name="chevron-right" size={13} color={colors.primary} />
          </Pressable>
        </View>

        {suites.map((suite) => {
          const suiteCases = testCases.filter((tc) => tc.suiteId === suite.id);
          const passed = suiteCases.filter((tc) => tc.lastStatus === 'Passed').length;
          const failed = suiteCases.filter((tc) => tc.lastStatus === 'Failed').length;

          return (
            <Pressable
              key={suite.id}
              onPress={() => setActiveTab('testcases')}
              style={[styles.suiteRow, { borderTopColor: colors.border }]}
            >
              <View style={styles.suiteInfoCol}>
                <Text style={[styles.suiteName, { color: colors.text }]}>
                  {suite.name}
                </Text>
                <Text
                  numberOfLines={1}
                  style={[styles.suiteDesc, { color: colors.textMuted }]}
                >
                  {suite.description}
                </Text>
              </View>
              <Text
                style={[
                  styles.suiteStats,
                  { color: colors.textSecondary, fontFamily: monoFontFamily },
                ]}
              >
                {suiteCases.length} cases · {passed}P / {failed}F
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Active Test Runs & Open Defects Preview */}
      <View
        style={[
          styles.sectionCard,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <View style={styles.sectionHeaderRow}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Active Test Runs
          </Text>
          <Pressable
            onPress={() => setActiveTab('testruns')}
            style={[styles.linkTouch, { flexDirection: 'row', alignItems: 'center', gap: 4 }]}
          >
            <Text style={[styles.linkText, { color: colors.primary }]}>
              All Runs
            </Text>
            <VectorIcon name="chevron-right" size={13} color={colors.primary} />
          </Pressable>
        </View>

        {recentRunsList.length === 0 ? (
          <Text style={[styles.emptyHint, { color: colors.textMuted }]}>
            No test runs created yet. Tap "Run Tests" above to start a test execution cycle.
          </Text>
        ) : (
          recentRunsList.map((run) => {
            const passedCount = run.results.filter((r) => r.status === 'Passed').length;
            const failedCount = run.results.filter((r) => r.status === 'Failed').length;
            const totalCount = run.results.length;

            return (
              <Pressable
                key={run.id}
                onPress={() => {
                  setSelectedTestRunId(run.id);
                  setActiveTab('testruns');
                }}
                style={[styles.itemRow, { borderTopColor: colors.border }]}
              >
                <View style={styles.itemRowMain}>
                  <Text
                    style={[
                      styles.itemCode,
                      { color: colors.primary, fontFamily: monoFontFamily },
                    ]}
                  >
                    {run.id} · {run.status.toUpperCase()} · {run.buildVersion}
                  </Text>
                  <Text style={[styles.itemRowTitle, { color: colors.text }]}>
                    {run.name}
                  </Text>
                  <Text style={[styles.itemRowMeta, { color: colors.textMuted }]}>
                    {run.deviceInfo} · {passedCount} Passed · {failedCount} Failed ({totalCount} total)
                  </Text>
                </View>
              </Pressable>
            );
          })
        )}
      </View>

      {/* Open Defects Snapshot */}
      <View
        style={[
          styles.sectionCard,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <View style={styles.sectionHeaderRow}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Open Defects ({metrics.openDefects})
          </Text>
          <Pressable
            onPress={() => setActiveTab('defects')}
            style={[styles.linkTouch, { flexDirection: 'row', alignItems: 'center', gap: 4 }]}
          >
            <Text style={[styles.linkText, { color: colors.primary }]}>
              All Defects
            </Text>
            <VectorIcon name="chevron-right" size={13} color={colors.primary} />
          </Pressable>
        </View>

        {openDefectsList.length === 0 ? (
          <Text style={[styles.emptyHint, { color: colors.textMuted }]}>
            Zero open defects. All reported bugs are currently resolved.
          </Text>
        ) : (
          openDefectsList.map((bug) => (
            <Pressable
              key={bug.id}
              onPress={() => {
                setSelectedDefectId(bug.id);
                setActiveTab('defects');
              }}
              style={[styles.itemRow, { borderTopColor: colors.border }]}
            >
              <View style={styles.itemRowMain}>
                <Text
                  style={[
                    styles.itemCode,
                    { color: getSeverityTone(bug.severity), fontFamily: monoFontFamily },
                  ]}
                >
                  {bug.id} · {bug.severity.toUpperCase()} · {bug.status}
                  {bug.linkedTestCaseId ? ` · Linked ${bug.linkedTestCaseId}` : ''}
                </Text>
                <Text style={[styles.itemRowTitle, { color: colors.text }]}>
                  {bug.title}
                </Text>
                <Text style={[styles.itemRowMeta, { color: colors.textMuted }]}>
                  {bug.environment}
                </Text>
              </View>
            </Pressable>
          ))
        )}
      </View>

      {/* Recent QA Activity Log */}
      <View
        style={[
          styles.sectionCard,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <View style={styles.sectionHeaderRow}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Recent QA Activity
          </Text>
          {lastPersistedAt ? (
            <Text
              style={[
                styles.savedTimestamp,
                { color: colors.textMuted, fontFamily: monoFontFamily },
              ]}
            >
              Saved {lastPersistedAt}
            </Text>
          ) : null}
        </View>

        {activityLog.slice(0, 6).map((act) => (
          <View
            key={act.id}
            style={[styles.activityRow, { borderTopColor: colors.border }]}
          >
            <View style={styles.activityHeader}>
              <Text style={[styles.activityTitle, { color: colors.text }]}>
                {act.title}
              </Text>
              <Text
                style={[
                  styles.activityTime,
                  { color: colors.textMuted, fontFamily: monoFontFamily },
                ]}
              >
                {act.timestamp}
              </Text>
            </View>
            {act.detail ? (
              <Text style={[styles.activityDetail, { color: colors.textSecondary }]}>
                {act.detail}
              </Text>
            ) : null}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 96,
    maxWidth: 920,
    width: '100%',
    alignSelf: 'center',
    gap: 14,
  },
  projectCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
  },
  projectHeader: {
    marginBottom: 14,
  },
  projectTitleCol: {
    flexShrink: 1,
  },
  kicker: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  projectTitle: {
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 26,
    marginBottom: 4,
  },
  projectSub: {
    fontSize: 13,
    lineHeight: 18,
  },
  quickActionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  primaryQuickBtn: {
    flex: 1,
    minWidth: 100,
    minHeight: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  primaryQuickBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  secondaryQuickBtn: {
    flex: 1,
    minWidth: 95,
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  secondaryQuickBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  kpiCard: {
    flexGrow: 1,
    flexBasis: '46%',
    minWidth: 148,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
  },
  kpiLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
  },
  kpiValue: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 2,
  },
  kpiSub: {
    fontSize: 11,
    lineHeight: 15,
  },
  sectionCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    flexShrink: 1,
  },
  sectionCounter: {
    fontSize: 12,
    fontWeight: '600',
  },
  stackedBar: {
    height: 10,
    borderRadius: 5,
    flexDirection: 'row',
    overflow: 'hidden',
    marginBottom: 14,
  },
  barSegment: {
    height: '100%',
  },
  statusBreakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  statusStatItem: {
    flex: 1,
    minWidth: 68,
    alignItems: 'center',
    paddingVertical: 4,
  },
  statusStatValue: {
    fontSize: 18,
    fontWeight: '700',
  },
  statusStatLabel: {
    fontSize: 12,
    marginTop: 2,
  },
  linkTouch: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  linkText: {
    fontSize: 13,
    fontWeight: '600',
  },
  suiteRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    paddingVertical: 11,
    gap: 10,
  },
  suiteInfoCol: {
    flex: 1,
    flexShrink: 1,
  },
  suiteName: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  suiteDesc: {
    fontSize: 12,
  },
  suiteStats: {
    fontSize: 12,
    fontWeight: '600',
  },
  emptyHint: {
    fontSize: 13,
    lineHeight: 19,
    paddingVertical: 6,
  },
  itemRow: {
    borderTopWidth: 1,
    paddingVertical: 12,
  },
  itemRowMain: {
    flexShrink: 1,
  },
  itemCode: {
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 3,
  },
  itemRowTitle: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
    marginBottom: 3,
  },
  itemRowMeta: {
    fontSize: 12,
  },
  savedTimestamp: {
    fontSize: 11,
  },
  activityRow: {
    borderTopWidth: 1,
    paddingVertical: 10,
  },
  activityHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 2,
  },
  activityTitle: {
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  activityTime: {
    fontSize: 11,
  },
  activityDetail: {
    fontSize: 12,
    lineHeight: 17,
  },
});

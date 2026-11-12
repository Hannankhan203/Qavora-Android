import React, { useState, useMemo, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  TextInput,
  Modal,
  ScrollView,
  ActivityIndicator,
  Keyboard,
} from 'react-native';
import { useTheme, monoFontFamily } from '../theme/theme';
import { useProjects } from '../context/ProjectContext';
import {
  useWorkspace,
  useWorkspaceBackOverlay,
} from '../context/WorkspaceContext';
import VectorIcon from './VectorIcon';

export default function ReportsView() {
  const { colors } = useTheme();
  const {
    selectedProject,
    refreshSelectedProject,
    isRefreshing: isRefreshingProject,
  } = useProjects();
  const {
    suites,
    reportTypes,
    dateRangeFilters,
    exportFormats,
    generateReport,
    exportReport,
    reloadProjectDataFromBackend,
    isSyncingProjectData,
    setActiveTab,
    openTestSuitesView,
    setSelectedTestCaseId,
    setSelectedTestRunId,
    setSelectedDefectId,
    showToast,
    notifyBlockedSwipeTouchStart,
  } = useWorkspace();

  // Filter State
  const [selectedReportType, setSelectedReportType] = useState('project_summary');
  const [dateFilter, setDateFilter] = useState('ALL');
  const [customStartInput, setCustomStartInput] = useState('');
  const [customEndInput, setCustomEndInput] = useState('');
  const [appliedCustomStart, setAppliedCustomStart] = useState('');
  const [appliedCustomEnd, setAppliedCustomEnd] = useState('');
  const [selectedSuiteId, setSelectedSuiteId] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [severityFilter, setSeverityFilter] = useState('ALL');

  // Export & Preview Modal State
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState(null);
  const [previewModalVisible, setPreviewModalVisible] = useState(false);
  const [previewPayload, setPreviewPayload] = useState(null);

  useWorkspaceBackOverlay(() => {
    if (previewModalVisible) {
      setPreviewModalVisible(false);
      return true;
    }
    return false;
  });

  const isRefreshingAny = isRefreshingProject || isSyncingProjectData;
  const customEndDateRef = useRef(null);

  const activeFilters = useMemo(
    () => ({
      reportType: selectedReportType,
      dateFilter,
      customStart: appliedCustomStart,
      customEnd: appliedCustomEnd,
      suiteId: selectedSuiteId,
      statusFilter,
      severityFilter,
    }),
    [
      selectedReportType,
      dateFilter,
      appliedCustomStart,
      appliedCustomEnd,
      selectedSuiteId,
      statusFilter,
      severityFilter,
    ]
  );

  // Pure, reactive report computation from selected project data
  const report = useMemo(() => {
    return generateReport(activeFilters);
  }, [generateReport, activeFilters]);

  const hasActiveFilters =
    dateFilter !== 'ALL' ||
    selectedSuiteId !== 'ALL' ||
    statusFilter !== 'ALL' ||
    severityFilter !== 'ALL';

  const handleResetFilters = () => {
    setDateFilter('ALL');
    setCustomStartInput('');
    setCustomEndInput('');
    setAppliedCustomStart('');
    setAppliedCustomEnd('');
    setSelectedSuiteId('ALL');
    setStatusFilter('ALL');
    setSeverityFilter('ALL');
    setExportError(null);
  };

  const handleChangeReportType = (nextType) => {
    setSelectedReportType(nextType);
    setStatusFilter('ALL');
    setSeverityFilter('ALL');
    setExportError(null);
  };

  const handleApplyCustomDates = () => {
    if (
      customStartInput.trim() &&
      !/^\d{4}-\d{2}-\d{2}$/.test(customStartInput.trim())
    ) {
      showToast('Start date must use YYYY-MM-DD format', 'danger');
      return;
    }
    if (
      customEndInput.trim() &&
      !/^\d{4}-\d{2}-\d{2}$/.test(customEndInput.trim())
    ) {
      showToast('End date must use YYYY-MM-DD format', 'danger');
      return;
    }
    Keyboard.dismiss();
    setAppliedCustomStart(customStartInput.trim());
    setAppliedCustomEnd(customEndInput.trim());
    showToast('Applied custom date range filter', 'info');
  };

  const handleRefreshAnalytics = async () => {
    setExportError(null);
    const res = await reloadProjectDataFromBackend();
    if (!res || !res.ok) {
      await refreshSelectedProject();
    } else {
      showToast('Refreshed project analytics from server', 'success');
    }
  };

  const handleExportFormat = async (formatId, openPreviewAfter = false) => {
    if (isExporting) return;
    setIsExporting(true);
    setExportError(null);
    try {
      const res = await exportReport(report, formatId, {
        skipPlatformShare: openPreviewAfter,
        silentToast: openPreviewAfter,
      });
      if (!res.ok) {
        setExportError(res.error || 'Failed to generate report export.');
      } else if (openPreviewAfter || !res.shared) {
        setPreviewPayload(res);
        setPreviewModalVisible(true);
      }
    } finally {
      setIsExporting(false);
    }
  };

  const handleShareFromPreview = async () => {
    if (!previewPayload) return;
    await exportReport(report, previewPayload.format, {
      skipPlatformShare: false,
    });
  };

  // Status filter options contextual to the active report type
  const contextualStatusOptions = useMemo(() => {
    if (selectedReportType === 'execution_summary') {
      return ['ALL', 'PASSED', 'FAILED', 'BLOCKED', 'SKIPPED'];
    }
    if (selectedReportType === 'case_status') {
      return ['ALL', 'Passed', 'Failed', 'Blocked', 'Not Run'];
    }
    if (selectedReportType === 'test_runs') {
      return ['ALL', 'In Progress', 'Completed'];
    }
    if (selectedReportType === 'defect_summary') {
      return [
        'ALL',
        'Open',
        'In Progress',
        'Ready for Retest',
        'Resolved',
        'Closed',
        'Reopened',
      ];
    }
    return [];
  }, [selectedReportType]);

  const getHealthBadgeStyle = (tone) => {
    if (tone === 'success') {
      return { bg: colors.successSoft, fg: colors.success };
    }
    if (tone === 'warning') {
      return { bg: colors.warningSoft, fg: colors.warning };
    }
    if (tone === 'danger') {
      return { bg: colors.dangerSoft, fg: colors.danger };
    }
    return { bg: colors.surfaceMuted, fg: colors.textSecondary };
  };

  const getVerdictBadgeStyle = (verdict) => {
    const v = String(verdict || '').toUpperCase();
    if (v === 'PASSED' || v === 'PASS' || v === 'RESOLVED' || v === 'CLOSED' || v === 'COMPLETED') {
      return { bg: colors.successSoft, fg: colors.success };
    }
    if (v === 'FAILED' || v === 'FAIL' || v === 'CRITICAL' || v === 'OPEN' || v === 'REOPENED') {
      return { bg: colors.dangerSoft, fg: colors.danger };
    }
    if (
      v === 'BLOCKED' ||
      v === 'HIGH' ||
      v === 'IN PROGRESS' ||
      v === 'READY FOR RETEST'
    ) {
      return { bg: colors.warningSoft, fg: colors.warning };
    }
    return { bg: colors.surfaceMuted, fg: colors.textSecondary };
  };

  const healthStyle = getHealthBadgeStyle(report.healthTone);
  const kpis = report.kpis || {};

  return (
    <View style={styles.container}>
      {/* 1. Report Header & Health Status Banner */}
      <View
        style={[
          styles.card,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <View style={styles.headerTopRow}>
          <View style={styles.headerTitleCol}>
            <View style={styles.badgeRow}>
              <View
                style={[
                  styles.healthPill,
                  { backgroundColor: healthStyle.bg },
                ]}
              >
                <Text
                  style={[
                    styles.healthPillText,
                    { color: healthStyle.fg, fontFamily: monoFontFamily },
                  ]}
                >
                  HEALTH: {report.healthStatus}
                </Text>
              </View>
              <View
                style={[
                  styles.scopePill,
                  {
                    backgroundColor: colors.surfaceAccent,
                    borderColor: colors.primary,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.scopePillText,
                    { color: colors.primary, fontFamily: monoFontFamily },
                  ]}
                >
                  {report.filters.dateFilterLabel}
                </Text>
              </View>
            </View>
            <Text style={[styles.reportMainTitle, { color: colors.text }]}>
              {report.reportTitle}
            </Text>
            <Text
              style={[styles.reportSubtitle, { color: colors.textSecondary }]}
            >
              {report.reportDescription}
            </Text>
          </View>

          <Pressable
            onPress={handleRefreshAnalytics}
            disabled={isRefreshingAny}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            accessibilityRole="button"
            accessibilityState={{ disabled: Boolean(isRefreshingAny) }}
            accessibilityLabel="Refresh QA report analytics"
            style={[
              styles.refreshBtn,
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
              <VectorIcon name="refresh" size={14} color={colors.primary} />
            )}
            <Text style={[styles.refreshBtnText, { color: colors.primary }]}>
              {isRefreshingAny ? 'Syncing...' : 'Refresh'}
            </Text>
          </Pressable>
        </View>

        {/* Report Type Selector Pills */}
        <View style={styles.filterGroupBlock}>
          <Text
            style={[
              styles.filterSectionLabel,
              { color: colors.textMuted, fontFamily: monoFontFamily },
            ]}
          >
            REPORT TYPE
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            onTouchStart={notifyBlockedSwipeTouchStart}
            contentContainerStyle={styles.horizontalPillsRow}
          >
            {reportTypes.map((rt) => {
              const active = selectedReportType === rt.id;
              return (
                <Pressable
                  key={rt.id}
                  onPress={() => handleChangeReportType(rt.id)}
                  hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`Report type: ${rt.shortLabel}`}
                  style={[
                    styles.filterPill,
                    {
                      backgroundColor: active
                        ? colors.primary
                        : colors.surfaceElevated,
                      borderColor: active ? colors.primary : colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.filterPillText,
                      {
                        color: active ? colors.textOnPrimary : colors.text,
                        fontWeight: active ? '700' : '600',
                      },
                    ]}
                  >
                    {rt.shortLabel}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {/* Date Range Filter Pills (Qavora Web parity: ALL, 7D, 30D, 90D, CUSTOM) */}
        <View style={styles.filterGroupBlock}>
          <View style={styles.filterLabelHeader}>
            <Text
              style={[
                styles.filterSectionLabel,
                { color: colors.textMuted, fontFamily: monoFontFamily },
              ]}
            >
              DATE RANGE FILTER
            </Text>
            {hasActiveFilters ? (
              <Pressable
                onPress={handleResetFilters}
                hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Reset all report filters"
              >
                <Text
                  style={[styles.resetFiltersLink, { color: colors.primary }]}
                >
                  Reset All Filters
                </Text>
              </Pressable>
            ) : null}
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            onTouchStart={notifyBlockedSwipeTouchStart}
            contentContainerStyle={styles.horizontalPillsRow}
          >
            {dateRangeFilters.map((df) => {
              const active = dateFilter === df.id;
              return (
                <Pressable
                  key={df.id}
                  onPress={() => setDateFilter(df.id)}
                  hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`Date range filter: ${df.label}`}
                  style={[
                    styles.filterPillSmall,
                    {
                      backgroundColor: active
                        ? colors.surfaceAccent
                        : colors.surfaceElevated,
                      borderColor: active ? colors.primary : colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.filterPillSmallText,
                      {
                        color: active ? colors.primary : colors.textSecondary,
                        fontWeight: active ? '700' : '500',
                      },
                    ]}
                  >
                    {df.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {dateFilter === 'CUSTOM' ? (
            <View
              style={[
                styles.customDateBox,
                {
                  backgroundColor: colors.surfaceElevated,
                  borderColor: colors.border,
                },
              ]}
            >
              <View style={styles.customDateInputsRow}>
                <View style={styles.customDateInputCol}>
                  <Text
                    style={[
                      styles.customDateLabel,
                      { color: colors.textMuted, fontFamily: monoFontFamily },
                    ]}
                  >
                    START (YYYY-MM-DD)
                  </Text>
                  <TextInput
                    value={customStartInput}
                    onChangeText={setCustomStartInput}
                    placeholder="2026-01-01"
                    placeholderTextColor={colors.textMuted}
                    accessibilityLabel="Custom report start date YYYY-MM-DD"
                    keyboardType="numbers-and-punctuation"
                    autoCapitalize="none"
                    returnKeyType="next"
                    blurOnSubmit={false}
                    onSubmitEditing={() => customEndDateRef.current?.focus()}
                    style={[
                      styles.customDateInput,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                        color: colors.text,
                        fontFamily: monoFontFamily,
                      },
                    ]}
                  />
                </View>
                <View style={styles.customDateInputCol}>
                  <Text
                    style={[
                      styles.customDateLabel,
                      { color: colors.textMuted, fontFamily: monoFontFamily },
                    ]}
                  >
                    END (YYYY-MM-DD)
                  </Text>
                  <TextInput
                    ref={customEndDateRef}
                    value={customEndInput}
                    onChangeText={setCustomEndInput}
                    placeholder="2026-12-31"
                    placeholderTextColor={colors.textMuted}
                    accessibilityLabel="Custom report end date YYYY-MM-DD"
                    keyboardType="numbers-and-punctuation"
                    autoCapitalize="none"
                    returnKeyType="done"
                    onSubmitEditing={handleApplyCustomDates}
                    style={[
                      styles.customDateInput,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                        color: colors.text,
                        fontFamily: monoFontFamily,
                      },
                    ]}
                  />
                </View>
              </View>
              <Pressable
                onPress={handleApplyCustomDates}
                accessibilityRole="button"
                accessibilityLabel="Apply custom date range"
                style={[
                  styles.applyCustomDateBtn,
                  { backgroundColor: colors.primary },
                ]}
              >
                <Text
                  style={[
                    styles.applyCustomDateBtnText,
                    { color: colors.textOnPrimary },
                  ]}
                >
                  Apply Date Range
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>

        {/* Suite Scope Filter */}
        {suites.length > 0 ? (
          <View style={styles.filterGroupBlock}>
            <Text
              style={[
                styles.filterSectionLabel,
                { color: colors.textMuted, fontFamily: monoFontFamily },
              ]}
            >
              TEST SUITE SCOPE
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              onTouchStart={notifyBlockedSwipeTouchStart}
              contentContainerStyle={styles.horizontalPillsRow}
            >
              <Pressable
                onPress={() => setSelectedSuiteId('ALL')}
                hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                accessibilityRole="tab"
                accessibilityState={{ selected: selectedSuiteId === 'ALL' }}
                accessibilityLabel={`All Suites (${suites.length})`}
                style={[
                  styles.filterPillSmall,
                  {
                    backgroundColor:
                      selectedSuiteId === 'ALL'
                        ? colors.surfaceAccent
                        : colors.surfaceElevated,
                    borderColor:
                      selectedSuiteId === 'ALL' ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.filterPillSmallText,
                    {
                      color:
                        selectedSuiteId === 'ALL'
                          ? colors.primary
                          : colors.textSecondary,
                      fontWeight: selectedSuiteId === 'ALL' ? '700' : '500',
                    },
                  ]}
                >
                  All Suites ({suites.length})
                </Text>
              </Pressable>
              {suites.map((su) => {
                const active = selectedSuiteId === su.id;
                return (
                  <Pressable
                    key={su.id}
                    onPress={() => setSelectedSuiteId(su.id)}
                    hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`Filter by suite: ${su.name}`}
                    style={[
                      styles.filterPillSmall,
                      {
                        backgroundColor: active
                          ? colors.surfaceAccent
                          : colors.surfaceElevated,
                        borderColor: active ? colors.primary : colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.filterPillSmallText,
                        {
                          color: active ? colors.primary : colors.textSecondary,
                          fontWeight: active ? '700' : '500',
                        },
                      ]}
                    >
                      {su.name}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        ) : null}

        {/* Contextual Status / Verdict Filter */}
        {contextualStatusOptions.length > 0 ? (
          <View style={styles.filterGroupBlock}>
            <Text
              style={[
                styles.filterSectionLabel,
                { color: colors.textMuted, fontFamily: monoFontFamily },
              ]}
            >
              STATUS / VERDICT FILTER
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              onTouchStart={notifyBlockedSwipeTouchStart}
              contentContainerStyle={styles.horizontalPillsRow}
            >
              {contextualStatusOptions.map((st) => {
                const active = statusFilter === st;
                return (
                  <Pressable
                    key={st}
                    onPress={() => setStatusFilter(st)}
                    hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`Status filter: ${
                      st === 'ALL' ? 'All Statuses' : st
                    }`}
                    style={[
                      styles.filterPillSmall,
                      {
                        backgroundColor: active
                          ? colors.surfaceAccent
                          : colors.surfaceElevated,
                        borderColor: active ? colors.primary : colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.filterPillSmallText,
                        {
                          color: active ? colors.primary : colors.textSecondary,
                          fontWeight: active ? '700' : '500',
                        },
                      ]}
                    >
                      {st === 'ALL' ? 'All Statuses' : st}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        ) : null}

        {/* Contextual Defect Severity Filter */}
        {selectedReportType === 'defect_summary' ? (
          <View style={styles.filterGroupBlock}>
            <Text
              style={[
                styles.filterSectionLabel,
                { color: colors.textMuted, fontFamily: monoFontFamily },
              ]}
            >
              DEFECT SEVERITY FILTER
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              onTouchStart={notifyBlockedSwipeTouchStart}
              contentContainerStyle={styles.horizontalPillsRow}
            >
              {['ALL', 'Critical', 'High', 'Medium', 'Low'].map((sev) => {
                const active = severityFilter === sev;
                return (
                  <Pressable
                    key={sev}
                    onPress={() => setSeverityFilter(sev)}
                    hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`Severity filter: ${
                      sev === 'ALL' ? 'All Severities' : sev
                    }`}
                    style={[
                      styles.filterPillSmall,
                      {
                        backgroundColor: active
                          ? colors.surfaceAccent
                          : colors.surfaceElevated,
                        borderColor: active ? colors.primary : colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.filterPillSmallText,
                        {
                          color: active ? colors.primary : colors.textSecondary,
                          fontWeight: active ? '700' : '500',
                        },
                      ]}
                    >
                      {sev === 'ALL' ? 'All Severities' : sev}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        ) : null}

        {/* Export Actions Bar */}
        <View
          style={[styles.exportSection, { borderTopColor: colors.border }]}
        >
          <View style={styles.exportHeaderRow}>
            <Text
              style={[
                styles.filterSectionLabel,
                { color: colors.textMuted, fontFamily: monoFontFamily },
              ]}
            >
              EXPORT GENERATED REPORT ({selectedProject ? selectedProject.name : 'Project'})
            </Text>
            <Pressable
              onPress={() => handleExportFormat('markdown', true)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Inspect and preview report output"
              style={styles.previewLinkBtn}
            >
              <Text style={[styles.previewLinkText, { color: colors.primary }]}>
                Inspect / Preview Output
              </Text>
            </Pressable>
          </View>

          {exportError ? (
            <View
              style={[
                styles.errorBanner,
                {
                  backgroundColor: colors.dangerSoft,
                  borderColor: colors.danger,
                },
              ]}
            >
              <Text style={[styles.errorBannerText, { color: colors.danger }]}>
                {exportError}
              </Text>
            </View>
          ) : null}

          <View style={styles.exportButtonsRow}>
            {exportFormats.map((fmt) => (
              <Pressable
                key={fmt.id}
                onPress={() => handleExportFormat(fmt.id, false)}
                disabled={isExporting}
                hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                accessibilityRole="button"
                accessibilityState={{ disabled: Boolean(isExporting) }}
                accessibilityLabel={`Export report as ${fmt.label}`}
                style={[
                  styles.exportBtn,
                  {
                    backgroundColor: colors.surfaceElevated,
                    borderColor: colors.primary,
                    opacity: isExporting ? 0.6 : 1,
                  },
                ]}
              >
                <VectorIcon name="file-text" size={13} color={colors.primary} />
                <Text style={[styles.exportBtnText, { color: colors.primary }]}>
                  {fmt.id.toUpperCase()}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>

      {/* 2. Empty Report Banner if no records match active filters */}
      {report.isEmpty ? (
        <View
          style={[
            styles.emptyReportCard,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.emptyReportTitle, { color: colors.text }]}>
            No QA Records Match Current Report Scope
          </Text>
          <Text
            style={[styles.emptyReportBody, { color: colors.textSecondary }]}
          >
            {hasActiveFilters
              ? 'No test cases, executions, runs, or defects matched the selected date range or filters. Try resetting filters or widening the date range.'
              : 'This project does not have recorded QA items for this report section yet. Add test cases, execute a test run, or log defects to populate analytics.'}
          </Text>
          {hasActiveFilters ? (
            <Pressable
              onPress={handleResetFilters}
              accessibilityRole="button"
              accessibilityLabel="Reset report filters"
              style={[
                styles.emptyActionBtn,
                { backgroundColor: colors.primary },
              ]}
            >
              <Text
                style={[
                  styles.emptyActionBtnText,
                  { color: colors.textOnPrimary },
                ]}
              >
                Reset Filters
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/* 3. Core KPI Summary Cards (Always visible across report types) */}
      <View style={styles.kpiGrid}>
        <View
          style={[
            styles.kpiCard,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Text
            style={[
              styles.kpiLabel,
              { color: colors.textMuted, fontFamily: monoFontFamily },
            ]}
          >
            TEST CASES
          </Text>
          <Text style={[styles.kpiValue, { color: colors.primary }]}>
            {kpis.totalTestCases}
          </Text>
          <Text style={[styles.kpiSub, { color: colors.textSecondary }]}>
            {kpis.executedCases} executed ({kpis.coveragePct}% coverage)
          </Text>
        </View>

        <View
          style={[
            styles.kpiCard,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Text
            style={[
              styles.kpiLabel,
              { color: colors.textMuted, fontFamily: monoFontFamily },
            ]}
          >
            PASS RATE
          </Text>
          <Text
            style={[
              styles.kpiValue,
              {
                color:
                  kpis.passRate >= 80
                    ? colors.success
                    : kpis.passRate >= 60
                    ? colors.warning
                    : colors.danger,
              },
            ]}
          >
            {kpis.passRate}%
          </Text>
          <Text style={[styles.kpiSub, { color: colors.textSecondary }]}>
            {kpis.execPassedCount} Pass · {kpis.execFailedCount} Fail ({kpis.failRate}% fail)
          </Text>
        </View>

        <View
          style={[
            styles.kpiCard,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Text
            style={[
              styles.kpiLabel,
              { color: colors.textMuted, fontFamily: monoFontFamily },
            ]}
          >
            TEST RUNS
          </Text>
          <Text style={[styles.kpiValue, { color: colors.info }]}>
            {kpis.totalTestRuns}
          </Text>
          <Text style={[styles.kpiSub, { color: colors.textSecondary }]}>
            {kpis.inProgressTestRuns} In Progress · {kpis.completedTestRuns} Completed
          </Text>
        </View>

        <View
          style={[
            styles.kpiCard,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Text
            style={[
              styles.kpiLabel,
              { color: colors.textMuted, fontFamily: monoFontFamily },
            ]}
          >
            OPEN DEFECTS
          </Text>
          <Text
            style={[
              styles.kpiValue,
              {
                color:
                  kpis.openDefects > 0 ? colors.danger : colors.success,
              },
            ]}
          >
            {kpis.openDefects}
          </Text>
          <Text style={[styles.kpiSub, { color: colors.textSecondary }]}>
            {kpis.criticalOpenDefects} Critical · {kpis.defectResolutionRate}% Resolved
          </Text>
        </View>
      </View>

      {/* 4. Executive Insights (Shown on Project QA Summary) */}
      {selectedReportType === 'project_summary' ? (
        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            QA Health & Release Readiness Insights
          </Text>
          <View style={styles.insightsList}>
            {(report.insights || []).map((ins) => {
              const badge = getHealthBadgeStyle(ins.tone);
              return (
                <View
                  key={ins.tag}
                  style={[
                    styles.insightItem,
                    {
                      backgroundColor: colors.surfaceElevated,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <View style={styles.insightHeaderRow}>
                    <Text style={[styles.insightTag, { color: colors.text }]}>
                      {ins.tag}
                    </Text>
                    <View
                      style={[
                        styles.insightScorePill,
                        { backgroundColor: badge.bg },
                      ]}
                    >
                      <Text
                        style={[
                          styles.insightScoreText,
                          { color: badge.fg, fontFamily: monoFontFamily },
                        ]}
                      >
                        {ins.score}
                      </Text>
                    </View>
                  </View>
                  <Text
                    style={[
                      styles.insightDesc,
                      { color: colors.textSecondary },
                    ]}
                  >
                    {ins.description}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      ) : null}

      {/* 5. Execution Verdict Distribution & Timeline (Project Summary & Execution Summary) */}
      {selectedReportType === 'project_summary' ||
      selectedReportType === 'execution_summary' ? (
        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <View style={styles.sectionHeaderRow}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Execution Verdict Breakdown
            </Text>
            <Text
              style={[
                styles.sectionCounter,
                { color: colors.textMuted, fontFamily: monoFontFamily },
              ]}
            >
              {kpis.totalExecutions} logged executions
            </Text>
          </View>

          <View style={styles.verdictBarsList}>
            {(report.verdictDistribution || []).map((item) => {
              const barColor =
                item.label === 'Passed'
                  ? colors.success
                  : item.label === 'Failed'
                  ? colors.danger
                  : item.label === 'Blocked'
                  ? colors.warning
                  : item.label === 'Skipped'
                  ? colors.primary
                  : colors.textMuted;
              return (
                <View key={item.label} style={styles.verdictRow}>
                  <View style={styles.verdictLabelRow}>
                    <View style={styles.verdictDotLabel}>
                      <View
                        style={[
                          styles.legendDot,
                          { backgroundColor: barColor },
                        ]}
                      />
                      <Text
                        style={[styles.verdictLabelText, { color: colors.text }]}
                      >
                        {item.label}
                      </Text>
                    </View>
                    <Text
                      style={[
                        styles.verdictCountText,
                        {
                          color: colors.textSecondary,
                          fontFamily: monoFontFamily,
                        },
                      ]}
                    >
                      {item.count} ({item.percentage}%)
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.progressTrackSmall,
                      { backgroundColor: colors.surfaceMuted },
                    ]}
                  >
                    <View
                      style={[
                        styles.progressFillSmall,
                        {
                          width: `${Math.min(100, item.percentage)}%`,
                          backgroundColor: barColor,
                        },
                      ]}
                    />
                  </View>
                </View>
              );
            })}
          </View>

          {/* Daily Execution Velocity / Timeline Table */}
          {Array.isArray(report.executionTimeline) &&
          report.executionTimeline.length > 0 ? (
            <View
              style={[
                styles.subSectionBlock,
                { borderTopColor: colors.border },
              ]}
            >
              <Text style={[styles.subSectionTitle, { color: colors.text }]}>
                Execution Velocity by Date
              </Text>
              <View style={styles.tableList}>
                {report.executionTimeline.slice(0, 10).map((day) => (
                  <View
                    key={day.date}
                    style={[
                      styles.timelineRow,
                      {
                        backgroundColor: colors.surfaceElevated,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.timelineDate,
                        { color: colors.text, fontFamily: monoFontFamily },
                      ]}
                    >
                      {day.date}
                    </Text>
                    <Text
                      style={[
                        styles.timelineCounts,
                        {
                          color: colors.textSecondary,
                          fontFamily: monoFontFamily,
                        },
                      ]}
                    >
                      {day.totalRuns} runs · {day.passed}P / {day.failed}F /{' '}
                      {day.blocked}B
                    </Text>
                    <Text
                      style={[
                        styles.timelineRate,
                        {
                          color:
                            day.passRate >= 80
                              ? colors.success
                              : colors.warning,
                          fontFamily: monoFontFamily,
                        },
                      ]}
                    >
                      {day.passRate}%
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {/* Chronological Executions Log */}
          <View
            style={[styles.subSectionBlock, { borderTopColor: colors.border }]}
          >
            <View style={styles.sectionHeaderRow}>
              <Text style={[styles.subSectionTitle, { color: colors.text }]}>
                Recent Execution Log
              </Text>
              <Pressable
                onPress={() => setActiveTab('testruns')}
                accessibilityRole="button"
                accessibilityLabel="Open Test Runs"
              >
                <Text style={[styles.linkText, { color: colors.primary }]}>
                  Open Test Runs →
                </Text>
              </Pressable>
            </View>
            {report.executions.length === 0 ? (
              <Text style={[styles.emptyInlineText, { color: colors.textMuted }]}>
                No execution logs recorded in this timeframe.
              </Text>
            ) : (
              <View style={styles.tableList}>
                {report.executions.slice(0, 12).map((ex, idx) => {
                  const badge = getVerdictBadgeStyle(ex.verdict);
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
                        ex.testCaseId || ex.testCaseTitle || 'test case'
                      }`}
                      style={[
                        styles.recordRow,
                        {
                          backgroundColor: colors.surfaceElevated,
                          borderColor: colors.border,
                        },
                      ]}
                    >
                      <View style={styles.recordTopRow}>
                        <Text
                          style={[
                            styles.monoCode,
                            { color: colors.primary, fontFamily: monoFontFamily },
                          ]}
                        >
                          {ex.testCaseId || 'EXEC'}
                        </Text>
                        <View
                          style={[
                            styles.verdictBadge,
                            { backgroundColor: badge.bg },
                          ]}
                        >
                          <Text
                            style={[
                              styles.verdictBadgeText,
                              { color: badge.fg, fontFamily: monoFontFamily },
                            ]}
                          >
                            {ex.verdict}
                          </Text>
                        </View>
                      </View>
                      <Text
                        numberOfLines={1}
                        style={[styles.recordTitle, { color: colors.text }]}
                      >
                        {ex.testCaseTitle}
                      </Text>
                      <Text
                        style={[
                          styles.recordMeta,
                          {
                            color: colors.textMuted,
                            fontFamily: monoFontFamily,
                          },
                        ]}
                      >
                        {ex.tester} · {ex.environment} ·{' '}
                        {String(ex.executedAt || '').slice(0, 16).replace('T', ' ')}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>
        </View>
      ) : null}

      {/* 6. Test Case Status, Phases & Suite Coverage (Project Summary & Case Status) */}
      {selectedReportType === 'project_summary' ||
      selectedReportType === 'case_status' ? (
        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <View style={styles.sectionHeaderRow}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Test Suites & Phase Coverage
            </Text>
            <Text
              style={[
                styles.sectionCounter,
                { color: colors.textMuted, fontFamily: monoFontFamily },
              ]}
            >
              {(report.suitesQuality || []).length} suites ·{' '}
              {(report.phaseCoverage || []).length} phases
            </Text>
          </View>

          {/* Phase Coverage Breakdown */}
          {Array.isArray(report.phaseCoverage) &&
          report.phaseCoverage.length > 0 ? (
            <View style={styles.tableList}>
              {report.phaseCoverage.map((ph) => (
                <View
                  key={ph.phaseName}
                  style={[
                    styles.suiteReportRow,
                    {
                      backgroundColor: colors.surfaceElevated,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <View style={styles.recordTopRow}>
                    <Text style={[styles.recordTitle, { color: colors.text }]}>
                      Phase: {ph.phaseName}
                    </Text>
                    <Text
                      style={[
                        styles.monoCode,
                        { color: colors.primary, fontFamily: monoFontFamily },
                      ]}
                    >
                      {ph.coveragePct}% Covered
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.recordMeta,
                      { color: colors.textSecondary, fontFamily: monoFontFamily },
                    ]}
                  >
                    {ph.suiteCount} suites · {ph.executedCount}/{ph.caseCount} cases executed
                  </Text>
                  <View
                    style={[
                      styles.progressTrackSmall,
                      { backgroundColor: colors.surfaceMuted },
                    ]}
                  >
                    <View
                      style={[
                        styles.progressFillSmall,
                        {
                          width: `${Math.min(100, ph.coveragePct)}%`,
                          backgroundColor: colors.primary,
                        },
                      ]}
                    />
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          {/* Priority Breakdown */}
          <View
            style={[styles.subSectionBlock, { borderTopColor: colors.border }]}
          >
            <Text style={[styles.subSectionTitle, { color: colors.text }]}>
              Test Case Priority Distribution
            </Text>
            <View style={styles.priorityGrid}>
              {(report.priorityBreakdown || []).map((prio) => {
                const badge = getVerdictBadgeStyle(prio.label);
                return (
                  <View
                    key={prio.label}
                    style={[
                      styles.priorityStatBox,
                      {
                        backgroundColor: colors.surfaceElevated,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.priorityStatLabel,
                        { color: badge.fg, fontFamily: monoFontFamily },
                      ]}
                    >
                      {prio.label.toUpperCase()}
                    </Text>
                    <Text
                      style={[styles.priorityStatValue, { color: colors.text }]}
                    >
                      {prio.count}
                    </Text>
                    <Text
                      style={[
                        styles.priorityStatPct,
                        { color: colors.textMuted, fontFamily: monoFontFamily },
                      ]}
                    >
                      {prio.percentage}% of cases
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>

          {/* Suites Quality Breakdown */}
          <View
            style={[styles.subSectionBlock, { borderTopColor: colors.border }]}
          >
            <View style={styles.sectionHeaderRow}>
              <Text style={[styles.subSectionTitle, { color: colors.text }]}>
                Suites Quality & Pass Rate
              </Text>
              <Pressable
                onPress={() => {
                  if (typeof openTestSuitesView === 'function') {
                    openTestSuitesView();
                  } else {
                    setActiveTab('testcases');
                  }
                }}
                accessibilityRole="button"
                accessibilityLabel="Manage Test Suites"
              >
                <Text style={[styles.linkText, { color: colors.primary }]}>
                  Manage Suites →
                </Text>
              </Pressable>
            </View>
            {(report.suitesQuality || []).length === 0 ? (
              <Text style={[styles.emptyInlineText, { color: colors.textMuted }]}>
                No test suites configured in this scope.
              </Text>
            ) : (
              <View style={styles.tableList}>
                {report.suitesQuality.map((sq) => (
                  <View
                    key={sq.id}
                    style={[
                      styles.suiteReportRow,
                      {
                        backgroundColor: colors.surfaceElevated,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <View style={styles.recordTopRow}>
                      <Text
                        numberOfLines={1}
                        style={[styles.recordTitle, { color: colors.text }]}
                      >
                        {sq.title}
                      </Text>
                      <Text
                        style={[
                          styles.monoCode,
                          {
                            color:
                              sq.passRate >= 80
                                ? colors.success
                                : colors.warning,
                            fontFamily: monoFontFamily,
                          },
                        ]}
                      >
                        {sq.passRate}% Pass
                      </Text>
                    </View>
                    <Text
                      style={[
                        styles.recordMeta,
                        {
                          color: colors.textSecondary,
                          fontFamily: monoFontFamily,
                        },
                      ]}
                    >
                      Phase: {sq.phaseName} · {sq.totalCases} cases ({sq.passedCases}P /{' '}
                      {sq.failedCases}F / {sq.blockedCases}B / {sq.notRunCases} Not Run)
                    </Text>
                    <View
                      style={[
                        styles.progressTrackSmall,
                        { backgroundColor: colors.surfaceMuted },
                      ]}
                    >
                      <View
                        style={[
                          styles.progressFillSmall,
                          {
                            width: `${Math.min(100, sq.coveragePct)}%`,
                            backgroundColor: colors.success,
                          },
                        ]}
                      />
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* Filtered Test Cases List when viewing Test Case Status Report */}
          {selectedReportType === 'case_status' ? (
            <View
              style={[styles.subSectionBlock, { borderTopColor: colors.border }]}
            >
              <Text style={[styles.subSectionTitle, { color: colors.text }]}>
                Test Cases Status Log ({report.testCases.length})
              </Text>
              {report.testCases.length === 0 ? (
                <Text
                  style={[styles.emptyInlineText, { color: colors.textMuted }]}
                >
                  No test cases match the selected filters.
                </Text>
              ) : (
                <View style={styles.tableList}>
                  {report.testCases.slice(0, 20).map((tc) => {
                    const badge = getVerdictBadgeStyle(tc.status);
                    return (
                      <Pressable
                        key={tc.id}
                        onPress={() => {
                          setSelectedTestCaseId(tc.id);
                          setActiveTab('testcases');
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={`Open test case ${tc.id}: ${tc.title}`}
                        style={[
                          styles.recordRow,
                          {
                            backgroundColor: colors.surfaceElevated,
                            borderColor: colors.border,
                          },
                        ]}
                      >
                        <View style={styles.recordTopRow}>
                          <Text
                            style={[
                              styles.monoCode,
                              {
                                color: colors.primary,
                                fontFamily: monoFontFamily,
                              },
                            ]}
                          >
                            {tc.id} · {tc.priority}
                          </Text>
                          <View
                            style={[
                              styles.verdictBadge,
                              { backgroundColor: badge.bg },
                            ]}
                          >
                            <Text
                              style={[
                                styles.verdictBadgeText,
                                { color: badge.fg, fontFamily: monoFontFamily },
                              ]}
                            >
                              {tc.status}
                            </Text>
                          </View>
                        </View>
                        <Text
                          numberOfLines={1}
                          style={[styles.recordTitle, { color: colors.text }]}
                        >
                          {tc.title}
                        </Text>
                        <Text
                          style={[
                            styles.recordMeta,
                            {
                              color: colors.textMuted,
                              fontFamily: monoFontFamily,
                            },
                          ]}
                        >
                          {tc.suiteName} · {tc.phaseName} · {tc.testType}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>
          ) : null}
        </View>
      ) : null}

      {/* 7. Test Run Cycles Report (Project Summary & Test Runs Report) */}
      {selectedReportType === 'project_summary' ||
      selectedReportType === 'test_runs' ? (
        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <View style={styles.sectionHeaderRow}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Test Run Cycles Report
            </Text>
            <Pressable
              onPress={() => setActiveTab('testruns')}
              accessibilityRole="button"
              accessibilityLabel="Open Test Runs"
            >
              <Text style={[styles.linkText, { color: colors.primary }]}>
                Open Test Runs →
              </Text>
            </Pressable>
          </View>

          {report.testRuns.length === 0 ? (
            <Text style={[styles.emptyInlineText, { color: colors.textMuted }]}>
              No test runs recorded in this filter scope.
            </Text>
          ) : (
            <View style={styles.tableList}>
              {report.testRuns.map((run) => {
                const badge = getVerdictBadgeStyle(run.status);
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
                      styles.suiteReportRow,
                      {
                        backgroundColor: colors.surfaceElevated,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <View style={styles.recordTopRow}>
                      <Text
                        style={[
                          styles.monoCode,
                          { color: colors.primary, fontFamily: monoFontFamily },
                        ]}
                      >
                        {run.id} · Build {run.buildVersion}
                      </Text>
                      <View
                        style={[
                          styles.verdictBadge,
                          { backgroundColor: badge.bg },
                        ]}
                      >
                        <Text
                          style={[
                            styles.verdictBadgeText,
                            { color: badge.fg, fontFamily: monoFontFamily },
                          ]}
                        >
                          {run.status}
                        </Text>
                      </View>
                    </View>
                    <Text
                      numberOfLines={1}
                      style={[styles.recordTitle, { color: colors.text }]}
                    >
                      {run.name}
                    </Text>
                    <Text
                      style={[
                        styles.recordMeta,
                        {
                          color: colors.textSecondary,
                          fontFamily: monoFontFamily,
                        },
                      ]}
                    >
                      {run.deviceInfo} · {run.environment} · Tester: {run.tester}
                    </Text>
                    <Text
                      style={[
                        styles.recordMeta,
                        { color: colors.textMuted, fontFamily: monoFontFamily },
                      ]}
                    >
                      {run.executedCases}/{run.totalCases} executed ·{' '}
                      {run.passedCases} Pass / {run.failedCases} Fail /{' '}
                      {run.blockedCases} Blocked · {run.passRate}% Pass Rate
                    </Text>
                    <View
                      style={[
                        styles.progressTrackSmall,
                        { backgroundColor: colors.surfaceMuted },
                      ]}
                    >
                      <View
                        style={[
                          styles.progressFillSmall,
                          {
                            width: `${Math.min(100, run.coveragePct)}%`,
                            backgroundColor:
                              run.failedCases > 0
                                ? colors.warning
                                : colors.success,
                          },
                        ]}
                      />
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>
      ) : null}

      {/* 8. Defect Summary & Breakdown (Project Summary & Defect Summary) */}
      {selectedReportType === 'project_summary' ||
      selectedReportType === 'defect_summary' ? (
        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <View style={styles.sectionHeaderRow}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Defects Breakdown & Triage
            </Text>
            <Pressable
              onPress={() => setActiveTab('defects')}
              accessibilityRole="button"
              accessibilityLabel="Open Defects"
            >
              <Text style={[styles.linkText, { color: colors.primary }]}>
                Open Defects →
              </Text>
            </Pressable>
          </View>

          {/* By Severity Grid */}
          <Text
            style={[
              styles.filterSectionLabel,
              { color: colors.textMuted, fontFamily: monoFontFamily },
            ]}
          >
            BY SEVERITY
          </Text>
          <View style={styles.priorityGrid}>
            {['Critical', 'High', 'Medium', 'Low'].map((sev) => {
              const count =
                (report.defectsBreakdown &&
                  report.defectsBreakdown.bySeverity &&
                  report.defectsBreakdown.bySeverity[sev]) ||
                0;
              const badge = getVerdictBadgeStyle(sev);
              return (
                <View
                  key={sev}
                  style={[
                    styles.priorityStatBox,
                    {
                      backgroundColor: colors.surfaceElevated,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.priorityStatLabel,
                      { color: badge.fg, fontFamily: monoFontFamily },
                    ]}
                  >
                    {sev.toUpperCase()}
                  </Text>
                  <Text
                    style={[styles.priorityStatValue, { color: colors.text }]}
                  >
                    {count}
                  </Text>
                </View>
              );
            })}
          </View>

          {/* By Status Grid */}
          <Text
            style={[
              styles.filterSectionLabel,
              {
                color: colors.textMuted,
                fontFamily: monoFontFamily,
                marginTop: 8,
              },
            ]}
          >
            BY WORKFLOW STATUS
          </Text>
          <View style={styles.priorityGrid}>
            {[
              'Open',
              'In Progress',
              'Ready for Retest',
              'Resolved',
              'Closed',
              'Reopened',
            ].map((st) => {
              const count =
                (report.defectsBreakdown &&
                  report.defectsBreakdown.byStatus &&
                  report.defectsBreakdown.byStatus[st]) ||
                0;
              const badge = getVerdictBadgeStyle(st);
              return (
                <View
                  key={st}
                  style={[
                    styles.priorityStatBox,
                    {
                      backgroundColor: colors.surfaceElevated,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.priorityStatLabel,
                      { color: badge.fg, fontFamily: monoFontFamily },
                    ]}
                  >
                    {st.toUpperCase()}
                  </Text>
                  <Text
                    style={[styles.priorityStatValue, { color: colors.text }]}
                  >
                    {count}
                  </Text>
                </View>
              );
            })}
          </View>

          {/* Defects Table */}
          <View
            style={[styles.subSectionBlock, { borderTopColor: colors.border }]}
          >
            <Text style={[styles.subSectionTitle, { color: colors.text }]}>
              Defects Log ({report.defects.length})
            </Text>
            {report.defects.length === 0 ? (
              <Text style={[styles.emptyInlineText, { color: colors.textMuted }]}>
                No defects recorded in this filter scope.
              </Text>
            ) : (
              <View style={styles.tableList}>
                {report.defects.slice(0, 15).map((d) => {
                  const sevBadge = getVerdictBadgeStyle(d.severity);
                  const stBadge = getVerdictBadgeStyle(d.status);
                  return (
                    <Pressable
                      key={d.id}
                      onPress={() => {
                        setSelectedDefectId(d.id);
                        setActiveTab('defects');
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`Open defect ${d.id}: ${d.title}`}
                      style={[
                        styles.recordRow,
                        {
                          backgroundColor: colors.surfaceElevated,
                          borderColor: colors.border,
                        },
                      ]}
                    >
                      <View style={styles.recordTopRow}>
                        <Text
                          style={[
                            styles.monoCode,
                            {
                              color: colors.primary,
                              fontFamily: monoFontFamily,
                            },
                          ]}
                        >
                          {d.id}
                        </Text>
                        <View style={styles.badgeRow}>
                          <View
                            style={[
                              styles.verdictBadge,
                              { backgroundColor: sevBadge.bg },
                            ]}
                          >
                            <Text
                              style={[
                                styles.verdictBadgeText,
                                {
                                  color: sevBadge.fg,
                                  fontFamily: monoFontFamily,
                                },
                              ]}
                            >
                              {d.severity}
                            </Text>
                          </View>
                          <View
                            style={[
                              styles.verdictBadge,
                              { backgroundColor: stBadge.bg },
                            ]}
                          >
                            <Text
                              style={[
                                styles.verdictBadgeText,
                                {
                                  color: stBadge.fg,
                                  fontFamily: monoFontFamily,
                                },
                              ]}
                            >
                              {d.status}
                            </Text>
                          </View>
                        </View>
                      </View>
                      <Text
                        numberOfLines={1}
                        style={[styles.recordTitle, { color: colors.text }]}
                      >
                        {d.title}
                      </Text>
                      <Text
                        style={[
                          styles.recordMeta,
                          {
                            color: colors.textMuted,
                            fontFamily: monoFontFamily,
                          },
                        ]}
                      >
                        Assignee: {d.assignee}
                        {d.linkedTestCaseId
                          ? ` · Case: ${d.linkedTestCaseId}`
                          : ''}
                        {d.linkedTestRunId
                          ? ` · Run: ${d.linkedTestRunId}`
                          : ''}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>
        </View>
      ) : null}

      {/* 9. Export Preview & Share Modal */}
      <Modal
        visible={previewModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setPreviewModalVisible(false)}
      >
        <View
          style={[styles.modalBackdrop, { backgroundColor: colors.overlay }]}
          accessibilityViewIsModal={true}
        >
          <View
            style={[
              styles.modalSheet,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            <View
              style={[
                styles.modalHeader,
                { borderBottomColor: colors.border },
              ]}
            >
              <View style={styles.modalTitleCol}>
                <Text
                  accessibilityRole="header"
                  style={[styles.modalTitle, { color: colors.text }]}
                >
                  Report Export Preview
                </Text>
                <Text
                  style={[
                    styles.modalSub,
                    { color: colors.textMuted, fontFamily: monoFontFamily },
                  ]}
                >
                  {previewPayload ? previewPayload.filename : ''}
                </Text>
              </View>
              <Pressable
                onPress={() => setPreviewModalVisible(false)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Close report export preview"
                style={[
                  styles.closeModalBtn,
                  { backgroundColor: colors.surfaceElevated },
                ]}
              >
                <Text style={[styles.closeModalBtnText, { color: colors.text }]}>
                  Close
                </Text>
              </Pressable>
            </View>

            {/* Switch format inside preview modal */}
            <View style={styles.modalFormatTabs} accessibilityRole="tablist">
              {exportFormats.map((fmt) => {
                const active =
                  previewPayload && previewPayload.format === fmt.id;
                return (
                  <Pressable
                    key={fmt.id}
                    onPress={() => handleExportFormat(fmt.id, true)}
                    hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: Boolean(active) }}
                    accessibilityLabel={`Preview ${fmt.label} format`}
                    style={[
                      styles.filterPillSmall,
                      {
                        backgroundColor: active
                          ? colors.primary
                          : colors.surfaceElevated,
                        borderColor: active ? colors.primary : colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.filterPillSmallText,
                        {
                          color: active
                            ? colors.textOnPrimary
                            : colors.textSecondary,
                          fontWeight: active ? '700' : '600',
                        },
                      ]}
                    >
                      {fmt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <ScrollView
              style={[
                styles.previewCodeScroll,
                {
                  backgroundColor: colors.surfaceElevated,
                  borderColor: colors.border,
                },
              ]}
              contentContainerStyle={styles.previewCodeContent}
            >
              <Text
                selectable
                style={[
                  styles.previewCodeText,
                  { color: colors.text, fontFamily: monoFontFamily },
                ]}
              >
                {previewPayload ? previewPayload.content : ''}
              </Text>
            </ScrollView>

            <View style={styles.modalFooter}>
              <Pressable
                onPress={handleShareFromPreview}
                accessibilityRole="button"
                accessibilityLabel="Share report output"
                style={[
                  styles.shareModalBtn,
                  { backgroundColor: colors.primary },
                ]}
              >
                <Text
                  style={[
                    styles.shareModalBtnText,
                    { color: colors.textOnPrimary },
                  ]}
                >
                  Share / Download {previewPayload ? previewPayload.format.toUpperCase() : 'Report'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 14,
  },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 14,
  },
  headerTopRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  headerTitleCol: {
    flex: 1,
    minWidth: 190,
    gap: 4,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  healthPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  healthPillText: {
    fontSize: 10,
    fontWeight: '700',
  },
  scopePill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  scopePillText: {
    fontSize: 10,
    fontWeight: '700',
  },
  reportMainTitle: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
    marginTop: 2,
  },
  reportSubtitle: {
    fontSize: 12,
    lineHeight: 17,
  },
  refreshBtn: {
    minHeight: 36,
    paddingHorizontal: 11,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  refreshBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  filterGroupBlock: {
    gap: 6,
  },
  filterLabelHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  filterSectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  resetFiltersLink: {
    fontSize: 11,
    fontWeight: '700',
  },
  horizontalPillsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 2,
  },
  filterPill: {
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterPillText: {
    fontSize: 12,
  },
  filterPillSmall: {
    minHeight: 32,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterPillSmallText: {
    fontSize: 11,
  },
  customDateBox: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
    gap: 8,
    marginTop: 4,
  },
  customDateInputsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  customDateInputCol: {
    flex: 1,
    minWidth: 130,
    gap: 4,
  },
  customDateLabel: {
    fontSize: 10,
    fontWeight: '700',
  },
  customDateInput: {
    minHeight: 38,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    fontSize: 12,
  },
  applyCustomDateBtn: {
    minHeight: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  applyCustomDateBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  exportSection: {
    borderTopWidth: 1,
    paddingTop: 12,
    gap: 8,
  },
  exportHeaderRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  previewLinkBtn: {
    paddingVertical: 2,
  },
  previewLinkText: {
    fontSize: 12,
    fontWeight: '700',
  },
  exportButtonsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  exportBtn: {
    flex: 1,
    minWidth: 92,
    minHeight: 38,
    borderRadius: 9,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 10,
  },
  exportBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  errorBanner: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 10,
  },
  errorBannerText: {
    fontSize: 12,
    fontWeight: '600',
  },
  emptyReportCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 18,
    alignItems: 'center',
    gap: 8,
  },
  emptyReportTitle: {
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptyReportBody: {
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  emptyActionBtn: {
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  emptyActionBtnText: {
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
    fontSize: 23,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  kpiSub: {
    fontSize: 11,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: 8,
    rowGap: 4,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    flexShrink: 1,
  },
  sectionCounter: {
    fontSize: 11,
    fontWeight: '600',
  },
  linkText: {
    fontSize: 12,
    fontWeight: '700',
  },
  insightsList: {
    gap: 8,
  },
  insightItem: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    gap: 4,
  },
  insightHeaderRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: 8,
    rowGap: 4,
  },
  insightTag: {
    fontSize: 13,
    fontWeight: '700',
    flexShrink: 1,
  },
  insightScorePill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  insightScoreText: {
    fontSize: 11,
    fontWeight: '700',
  },
  insightDesc: {
    fontSize: 12,
    lineHeight: 17,
  },
  verdictBarsList: {
    gap: 10,
  },
  verdictRow: {
    gap: 5,
  },
  verdictLabelRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4,
  },
  verdictDotLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  verdictLabelText: {
    fontSize: 12,
    fontWeight: '600',
  },
  verdictCountText: {
    fontSize: 11,
    fontWeight: '600',
  },
  progressTrackSmall: {
    height: 7,
    borderRadius: 999,
    overflow: 'hidden',
  },
  progressFillSmall: {
    height: '100%',
    borderRadius: 999,
  },
  subSectionBlock: {
    borderTopWidth: 1,
    paddingTop: 12,
    gap: 10,
  },
  subSectionTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  tableList: {
    gap: 8,
  },
  timelineRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 10,
    borderRadius: 9,
    borderWidth: 1,
    gap: 8,
  },
  timelineDate: {
    fontSize: 11,
    fontWeight: '700',
  },
  timelineCounts: {
    fontSize: 11,
    flex: 1,
    minWidth: 120,
    textAlign: 'center',
  },
  timelineRate: {
    fontSize: 12,
    fontWeight: '700',
  },
  recordRow: {
    padding: 11,
    borderRadius: 10,
    borderWidth: 1,
    gap: 4,
  },
  suiteReportRow: {
    padding: 11,
    borderRadius: 10,
    borderWidth: 1,
    gap: 6,
  },
  recordTopRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: 8,
    rowGap: 4,
  },
  monoCode: {
    fontSize: 11,
    fontWeight: '700',
  },
  verdictBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  verdictBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  recordTitle: {
    fontSize: 13,
    fontWeight: '600',
    flexShrink: 1,
  },
  recordMeta: {
    fontSize: 11,
  },
  priorityGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  priorityStatBox: {
    flex: 1,
    minWidth: 120,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    gap: 2,
  },
  priorityStatLabel: {
    fontSize: 10,
    fontWeight: '700',
  },
  priorityStatValue: {
    fontSize: 18,
    fontWeight: '700',
  },
  priorityStatPct: {
    fontSize: 10,
  },
  emptyInlineText: {
    fontSize: 12,
    paddingVertical: 6,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: 16,
  },
  modalSheet: {
    maxHeight: '88%',
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  modalHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 10,
    borderBottomWidth: 1,
    gap: 10,
  },
  modalTitleCol: {
    flex: 1,
    minWidth: 170,
    gap: 2,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  modalSub: {
    fontSize: 11,
  },
  closeModalBtn: {
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeModalBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  modalFormatTabs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  previewCodeScroll: {
    flexShrink: 1,
    maxHeight: 340,
    borderRadius: 10,
    borderWidth: 1,
  },
  previewCodeContent: {
    padding: 12,
  },
  previewCodeText: {
    fontSize: 11,
    lineHeight: 16,
  },
  modalFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  shareModalBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareModalBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
});

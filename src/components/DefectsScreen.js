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
import { useWorkspace } from '../context/WorkspaceContext';
import {
  DEFECT_SEVERITIES,
  DEFECT_PRIORITIES,
  DEFECT_STATUSES,
} from '../data/initialData';

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

export default function DefectsScreen() {
  const { colors: theme } = useTheme();
  const {
    activeProject: currentProject,
    profile,
    defects,
    testCases,
    testRuns,
    createDefect,
    updateDefect,
    deleteDefect,
    selectedDefectId,
    setSelectedDefectId,
    draftDefectFromExecution,
    setDraftDefectFromExecution,
    setSelectedTestCaseId,
    setSelectedTestRunId,
    setActiveTab,
    openProjectSelection,
    isSyncingProjectData: isSyncingWorkspace,
    projectDataError: workspaceError,
    projectDataConflict: workspaceConflict,
    clearProjectDataError: clearWorkspaceError,
    reloadProjectDataFromBackend: reloadCurrentProject,
  } = useWorkspace();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [severityFilter, setSeverityFilter] = useState('All');
  const [priorityFilter, setPriorityFilter] = useState('All');

  // Detail modal state
  const [viewingDefectId, setViewingDefectId] = useState(null);

  // Create / Edit Defect modal state
  const [formModalVisible, setFormModalVisible] = useState(false);
  const [editingDefectId, setEditingDefectId] = useState(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState('High');
  const [priority, setPriority] = useState('High');
  const [status, setStatus] = useState('Open');
  const [reproSteps, setReproSteps] = useState('');
  const [expectedResult, setExpectedResult] = useState('');
  const [actualResult, setActualResult] = useState('');
  const [environment, setEnvironment] = useState(
    'Pixel 8 Pro • Android 14 • v2.4.0-rc3'
  );
  const [externalUrl, setExternalUrl] = useState('');
  const [linkedTestCaseId, setLinkedTestCaseId] = useState('');
  const [linkedTestRunId, setLinkedTestRunId] = useState('');
  const [linkedExecutionId, setLinkedExecutionId] = useState('');
  const [formError, setFormError] = useState('');
  const [isSubmittingDefect, setIsSubmittingDefect] = useState(false);

  // Delete confirmation modal state
  const [defectPendingDelete, setDefectPendingDelete] = useState(null);
  const [isDeletingDefect, setIsDeletingDefect] = useState(false);

  // Status update in detail modal
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  // Feedback banner
  const [feedbackBanner, setFeedbackBanner] = useState(null);

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

  // Open detail modal when selectedDefectId is set externally
  useEffect(() => {
    if (selectedDefectId) {
      setViewingDefectId(selectedDefectId);
    }
  }, [selectedDefectId]);

  // Handle pre-filled defect creation when triggered from failed test execution
  useEffect(() => {
    if (draftDefectFromExecution) {
      setEditingDefectId(null);
      setTitle(draftDefectFromExecution.title || '');
      setDescription(draftDefectFromExecution.description || '');
      setSeverity(draftDefectFromExecution.severity || 'High');
      setPriority(draftDefectFromExecution.priority || 'High');
      setStatus(draftDefectFromExecution.status || 'Open');
      setReproSteps(
        draftDefectFromExecution.reproductionSteps ||
          draftDefectFromExecution.steps ||
          ''
      );
      setExpectedResult(draftDefectFromExecution.expectedResult || '');
      setActualResult(draftDefectFromExecution.actualResult || '');
      setEnvironment(
        draftDefectFromExecution.environment ||
          'Pixel 8 Pro • Android 14 • v2.4.0-rc3'
      );
      setExternalUrl(draftDefectFromExecution.externalUrl || '');
      setLinkedTestCaseId(draftDefectFromExecution.linkedTestCaseId || '');
      setLinkedTestRunId(draftDefectFromExecution.linkedTestRunId || '');
      setLinkedExecutionId(draftDefectFromExecution.linkedExecutionId || '');
      setFormError('');
      setFormModalVisible(true);
      setDraftDefectFromExecution(null);
    }
  }, [draftDefectFromExecution, setDraftDefectFromExecution]);

  // Defect KPI summary metrics
  const defectSummary = useMemo(() => {
    const total = defects.length;
    const open = defects.filter(
      (d) => d.status === 'Open' || d.status === 'Reopened'
    ).length;
    const inProgress = defects.filter(
      (d) => d.status === 'In Progress' || d.status === 'Ready for Retest'
    ).length;
    const resolvedOrClosed = defects.filter(
      (d) => d.status === 'Resolved' || d.status === 'Closed'
    ).length;
    const critical = defects.filter(
      (d) => d.severity === 'Critical' || d.severity === 'High'
    ).length;
    return { total, open, inProgress, resolvedOrClosed, critical };
  }, [defects]);

  const filteredDefects = useMemo(() => {
    return defects.filter((d) => {
      const matchesStatus =
        statusFilter === 'All' || d.status === statusFilter;
      const matchesSev =
        severityFilter === 'All' || d.severity === severityFilter;
      const matchesPri =
        priorityFilter === 'All' ||
        (d.priority || d.severity || 'High') === priorityFilter;
      const q = searchQuery.trim().toLowerCase();
      const matchesSearch =
        !q ||
        String(d.id || '').toLowerCase().includes(q) ||
        String(d.defectId || '').toLowerCase().includes(q) ||
        String(d.title || '').toLowerCase().includes(q) ||
        String(d.description || '').toLowerCase().includes(q) ||
        String(d.reproductionSteps || d.steps || '')
          .toLowerCase()
          .includes(q) ||
        String(d.actualResult || '').toLowerCase().includes(q) ||
        String(d.environment || '').toLowerCase().includes(q) ||
        String(d.linkedTestCaseId || '').toLowerCase().includes(q) ||
        String(d.linkedCaseTitle || '').toLowerCase().includes(q) ||
        String(d.linkedTestRunId || '').toLowerCase().includes(q);
      return matchesStatus && matchesSev && matchesPri && matchesSearch;
    });
  }, [defects, statusFilter, severityFilter, priorityFilter, searchQuery]);

  const viewingDefect = useMemo(() => {
    if (!viewingDefectId) return null;
    return (
      defects.find(
        (d) => d.id === viewingDefectId || d.defectId === viewingDefectId
      ) || null
    );
  }, [viewingDefectId, defects]);

  const closeDetailModal = () => {
    setViewingDefectId(null);
    setSelectedDefectId(null);
  };

  const openNewDefectForm = () => {
    setEditingDefectId(null);
    setTitle('');
    setDescription('');
    setSeverity('High');
    setPriority('High');
    setStatus('Open');
    setReproSteps('');
    setExpectedResult('');
    setActualResult('');
    setEnvironment(
      currentProject?.environment ||
        `${profile?.defaultDevice || 'Android 14'} · Build ${
          profile?.defaultBuild || '1.0.0'
        }`
    );
    setExternalUrl('');
    setLinkedTestCaseId(testCases[0]?.id || '');
    setLinkedTestRunId(testRuns[0]?.id || '');
    setLinkedExecutionId('');
    setFormError('');
    setFormModalVisible(true);
  };

  const openEditDefectForm = (defect) => {
    if (!defect) return;
    closeDetailModal();
    setEditingDefectId(defect.id);
    setTitle(defect.title || '');
    setDescription(defect.description || '');
    setSeverity(defect.severity || 'High');
    setPriority(defect.priority || defect.severity || 'High');
    setStatus(defect.status || 'Open');
    setReproSteps(defect.reproductionSteps || defect.steps || '');
    setExpectedResult(defect.expectedResult || '');
    setActualResult(defect.actualResult || '');
    setEnvironment(
      defect.environment || 'Pixel 8 Pro • Android 14 • v2.4.0-rc3'
    );
    setExternalUrl(defect.externalUrl || '');
    setLinkedTestCaseId(defect.linkedTestCaseId || '');
    setLinkedTestRunId(defect.linkedTestRunId || '');
    setLinkedExecutionId(defect.linkedExecutionId || '');
    setFormError('');
    setFormModalVisible(true);
  };

  const handleSelectLinkedCaseInForm = (caseId) => {
    setLinkedTestCaseId(caseId);
    if (!caseId) return;
    const tc = testCases.find((c) => c.id === caseId);
    if (tc) {
      if (!expectedResult.trim() && tc.expectedResult) {
        setExpectedResult(tc.expectedResult);
      }
      if (
        !reproSteps.trim() &&
        Array.isArray(tc.steps) &&
        tc.steps.length > 0
      ) {
        setReproSteps(
          tc.steps
            .map((s, idx) =>
              typeof s === 'string'
                ? `${idx + 1}. ${s}`
                : `${idx + 1}. ${s?.action || ''}`
            )
            .join('\n')
        );
      }
    }
  };

  const handleSaveDefect = async () => {
    if (isSubmittingDefect) return;
    if (!title.trim()) {
      setFormError('Defect title is required.');
      return;
    }
    if (!reproSteps.trim()) {
      setFormError('Steps to reproduce are required.');
      return;
    }
    if (!actualResult.trim()) {
      setFormError('Actual result or observed failure is required.');
      return;
    }

    setFormError('');
    setIsSubmittingDefect(true);
    try {
      const payload = {
        title: title.trim(),
        description: description.trim() || actualResult.trim(),
        severity,
        priority,
        status,
        reproductionSteps: reproSteps.trim(),
        steps: reproSteps.trim(),
        expectedResult:
          expectedResult.trim() || 'App should function without error.',
        actualResult: actualResult.trim(),
        environment: environment.trim() || 'Android Device',
        externalUrl: externalUrl.trim(),
        linkedTestCaseId: linkedTestCaseId || null,
        linkedTestRunId: linkedTestRunId || null,
        linkedExecutionId: linkedExecutionId || null,
      };

      const res = editingDefectId
        ? await updateDefect(editingDefectId, payload)
        : await createDefect(payload);

      if (!res?.ok) {
        setFormError(res?.error || 'Failed to save defect.');
        return;
      }

      setFormModalVisible(false);
      showFeedback(
        'success',
        editingDefectId
          ? `Updated defect "${title.trim()}".`
          : `Created defect "${title.trim()}".`
      );
    } finally {
      setIsSubmittingDefect(false);
    }
  };

  const handleQuickStatusChange = async (defect, nextStatus) => {
    if (!defect || defect.status === nextStatus || isUpdatingStatus) return;
    setIsUpdatingStatus(true);
    try {
      const res = await updateDefect(defect.id, { status: nextStatus });
      if (!res?.ok) {
        showFeedback('error', res?.error || 'Failed to update defect status.');
      } else {
        showFeedback(
          'success',
          `${defect.defectId || defect.id} status changed to "${nextStatus}".`
        );
      }
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handleConfirmDeleteDefect = async () => {
    if (!defectPendingDelete || isDeletingDefect) return;
    setIsDeletingDefect(true);
    try {
      const targetId = defectPendingDelete.id;
      const targetDisplay =
        defectPendingDelete.defectId || defectPendingDelete.id;
      const res = await deleteDefect(targetId);
      if (!res?.ok) {
        showFeedback('error', res?.error || 'Failed to delete defect.');
      } else {
        if (viewingDefectId === targetId) {
          closeDetailModal();
        }
        setDefectPendingDelete(null);
        showFeedback('success', `Deleted defect ${targetDisplay}.`);
      }
    } finally {
      setIsDeletingDefect(false);
    }
  };

  const getSeverityBadge = (sev) => {
    if (sev === 'Critical')
      return { color: theme.danger, bg: theme.dangerSoft };
    if (sev === 'High' || sev === 'Major')
      return { color: theme.warning, bg: theme.warningSoft };
    if (sev === 'Medium' || sev === 'Minor')
      return { color: theme.info, bg: theme.infoSoft };
    return { color: theme.textSecondary, bg: theme.surfaceMuted };
  };

  const getPriorityBadge = (pri) => {
    if (pri === 'Critical')
      return { color: theme.danger, bg: theme.dangerSoft };
    if (pri === 'High') return { color: theme.warning, bg: theme.warningSoft };
    if (pri === 'Medium') return { color: theme.info, bg: theme.infoSoft };
    return { color: theme.textSecondary, bg: theme.surfaceMuted };
  };

  const getStatusBadge = (st) => {
    if (st === 'Open' || st === 'Reopened')
      return { color: theme.danger, bg: theme.dangerSoft };
    if (st === 'In Progress')
      return { color: theme.warning, bg: theme.warningSoft };
    if (st === 'Ready for Retest')
      return { color: theme.info, bg: theme.infoSoft };
    if (st === 'Resolved')
      return { color: theme.success, bg: theme.successSoft };
    return { color: theme.textMuted, bg: theme.surfaceMuted };
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
          <VectorIcon name="alert" size={34} color={theme.primary} />
          <Text style={[styles.emptyWorkspaceTitle, { color: theme.text }]}>
            No Active Project Selected
          </Text>
          <Text
            style={[
              styles.emptyWorkspaceSub,
              { color: theme.textSecondary },
            ]}
          >
            Select or create a project first to log and track project-scoped defects.
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

      {/* Top Search, Summary Counters & Filter Controls */}
      <View
        style={[
          styles.topBar,
          { backgroundColor: theme.surface, borderBottomColor: theme.border },
        ]}
      >
        {/* Defect KPI Strip */}
        <View style={styles.kpiRow}>
          {[
            {
              label: 'Total',
              val: defectSummary.total,
              color: theme.primary,
              bg: theme.primarySoft,
              onPress: () => {
                setStatusFilter('All');
                setSeverityFilter('All');
                setPriorityFilter('All');
              },
            },
            {
              label: 'Open',
              val: defectSummary.open,
              color: theme.danger,
              bg: theme.dangerSoft,
              onPress: () =>
                setStatusFilter(statusFilter === 'Open' ? 'All' : 'Open'),
            },
            {
              label: 'In Progress',
              val: defectSummary.inProgress,
              color: theme.warning,
              bg: theme.warningSoft,
              onPress: () =>
                setStatusFilter(
                  statusFilter === 'In Progress' ? 'All' : 'In Progress'
                ),
            },
            {
              label: 'Resolved',
              val: defectSummary.resolvedOrClosed,
              color: theme.success,
              bg: theme.successSoft,
              onPress: () =>
                setStatusFilter(
                  statusFilter === 'Resolved' ? 'All' : 'Resolved'
                ),
            },
            {
              label: 'Critical',
              val: defectSummary.critical,
              color: theme.danger,
              bg: theme.dangerSoft,
              onPress: () =>
                setSeverityFilter(
                  severityFilter === 'Critical' ? 'All' : 'Critical'
                ),
            },
          ].map((item) => (
            <TouchableOpacity
              key={item.label}
              style={[styles.kpiChip, { backgroundColor: item.bg }]}
              onPress={item.onPress}
            >
              <Text style={[styles.kpiVal, { color: item.color }]}>
                {item.val}
              </Text>
              <Text style={[styles.kpiLabel, { color: item.color }]}>
                {item.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.searchRow}>
          <View
            style={[
              styles.searchBox,
              {
                backgroundColor: theme.surfaceMuted,
                borderColor: theme.border,
              },
            ]}
          >
            <VectorIcon name="search" size={16} color={theme.textMuted} />
            <TextInput
              style={[styles.searchInput, { color: theme.text }]}
              placeholder="Search ID, title, steps, case, or environment..."
              placeholderTextColor={theme.textMuted}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <VectorIcon name="close" size={14} color={theme.textMuted} />
              </TouchableOpacity>
            )}
          </View>

          <TouchableOpacity
            style={[styles.logBugBtn, { backgroundColor: theme.danger }]}
            onPress={openNewDefectForm}
          >
            <VectorIcon name="plus" size={15} color="#FFFFFF" />
            <Text style={styles.logBugBtnText}>Report</Text>
          </TouchableOpacity>
        </View>

        {/* Status Filter Row */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          {['All', ...DEFECT_STATUSES].map((st) => {
            const active = statusFilter === st;
            return (
              <TouchableOpacity
                key={st}
                onPress={() => setStatusFilter(st)}
                style={[
                  styles.filterChip,
                  {
                    backgroundColor: active
                      ? theme.primary
                      : theme.surfaceMuted,
                    borderColor: active ? theme.primary : theme.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    { color: active ? '#FFFFFF' : theme.textSecondary },
                  ]}
                >
                  {st === 'All' ? 'All Statuses' : st}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Severity & Priority Filter Row */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[styles.filterRow, { marginTop: 6 }]}
        >
          {['All', ...DEFECT_SEVERITIES].map((sev) => {
            const active = severityFilter === sev;
            return (
              <TouchableOpacity
                key={`sev-${sev}`}
                onPress={() => setSeverityFilter(sev)}
                style={[
                  styles.sevChip,
                  {
                    backgroundColor: active ? theme.primarySoft : 'transparent',
                    borderColor: active ? theme.primary : theme.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.sevChipText,
                    { color: active ? theme.primary : theme.textMuted },
                  ]}
                >
                  {sev === 'All' ? 'All Severities' : `Sev: ${sev}`}
                </Text>
              </TouchableOpacity>
            );
          })}

          {['All', ...DEFECT_PRIORITIES].map((pri) => {
            const active = priorityFilter === pri;
            return (
              <TouchableOpacity
                key={`pri-${pri}`}
                onPress={() => setPriorityFilter(pri)}
                style={[
                  styles.sevChip,
                  {
                    backgroundColor: active ? theme.infoSoft : 'transparent',
                    borderColor: active ? theme.info : theme.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.sevChipText,
                    { color: active ? theme.info : theme.textMuted },
                  ]}
                >
                  {pri === 'All' ? 'All Priorities' : `Pri: ${pri}`}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Defect List */}
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.resultsBar}>
          <Text style={[styles.resultsCount, { color: theme.textSecondary }]}>
            Showing {filteredDefects.length} of {defects.length} defects
          </Text>
        </View>

        {filteredDefects.map((bug) => {
          const sevMeta = getSeverityBadge(bug.severity);
          const priMeta = getPriorityBadge(bug.priority || bug.severity);
          const stMeta = getStatusBadge(bug.status);
          const linkedCase = testCases.find(
            (tc) => tc.id === bug.linkedTestCaseId
          );
          const linkedRun = testRuns.find((r) => r.id === bug.linkedTestRunId);

          return (
            <View
              key={bug.id}
              style={[
                styles.defectCard,
                {
                  backgroundColor: theme.surface,
                  borderColor: theme.border,
                },
              ]}
            >
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => setViewingDefectId(bug.id)}
              >
                <View style={styles.cardTopRow}>
                  <View style={styles.idAndSev}>
                    <VectorIcon name="alert" size={14} color={sevMeta.color} />
                    <Text
                      style={[
                        styles.bugId,
                        { color: theme.primary, fontFamily: monoFontFamily },
                      ]}
                    >
                      {bug.defectId || bug.id}
                    </Text>
                    <View
                      style={[styles.badge, { backgroundColor: sevMeta.bg }]}
                    >
                      <Text
                        style={[styles.badgeText, { color: sevMeta.color }]}
                      >
                        {bug.severity}
                      </Text>
                    </View>
                    <View
                      style={[styles.badge, { backgroundColor: priMeta.bg }]}
                    >
                      <Text
                        style={[styles.badgeText, { color: priMeta.color }]}
                      >
                        P: {bug.priority || bug.severity}
                      </Text>
                    </View>
                  </View>

                  <View style={[styles.badge, { backgroundColor: stMeta.bg }]}>
                    <Text style={[styles.badgeText, { color: stMeta.color }]}>
                      {bug.status}
                    </Text>
                  </View>
                </View>

                <Text style={[styles.bugTitle, { color: theme.text }]}>
                  {bug.title}
                </Text>

                {bug.description ? (
                  <Text
                    style={[
                      styles.bugDescriptionSnippet,
                      { color: theme.textSecondary },
                    ]}
                    numberOfLines={2}
                  >
                    {bug.description}
                  </Text>
                ) : null}

                <Text
                  style={[styles.envLine, { color: theme.textMuted }]}
                  numberOfLines={1}
                >
                  Env: {bug.environment || 'Android Device'}
                </Text>

                <View
                  style={[
                    styles.cardFooter,
                    { borderTopColor: theme.border },
                  ]}
                >
                  <View style={styles.linksRow}>
                    {(linkedCase || bug.linkedTestCaseId) && (
                      <View
                        style={[
                          styles.linkChip,
                          { backgroundColor: theme.primarySoft },
                        ]}
                      >
                        <VectorIcon
                          name="tag"
                          size={10}
                          color={theme.primary}
                        />
                        <Text
                          style={[
                            styles.linkChipText,
                            { color: theme.primary },
                          ]}
                        >
                          {bug.linkedTestCaseId}
                        </Text>
                      </View>
                    )}
                    {(linkedRun || bug.linkedTestRunId) && (
                      <View
                        style={[
                          styles.linkChip,
                          { backgroundColor: theme.infoSoft },
                        ]}
                      >
                        <VectorIcon
                          name="layers"
                          size={10}
                          color={theme.info}
                        />
                        <Text
                          style={[styles.linkChipText, { color: theme.info }]}
                        >
                          {bug.linkedTestRunId}
                        </Text>
                      </View>
                    )}
                  </View>

                  <View style={styles.cardBottomRightActions}>
                    <Text
                      style={[styles.dateText, { color: theme.textMuted }]}
                    >
                      {formatShortTimestamp(bug.updatedAt || bug.createdAt)}
                    </Text>
                    <TouchableOpacity
                      style={[
                        styles.cardMiniBtn,
                        {
                          backgroundColor: theme.surfaceMuted,
                          borderColor: theme.border,
                        },
                      ]}
                      onPress={() => openEditDefectForm(bug)}
                    >
                      <VectorIcon
                        name="edit"
                        size={12}
                        color={theme.textSecondary}
                      />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.cardMiniBtn,
                        {
                          backgroundColor: theme.dangerSoft,
                          borderColor: theme.danger,
                        },
                      ]}
                      onPress={() => setDefectPendingDelete(bug)}
                    >
                      <VectorIcon name="trash" size={12} color={theme.danger} />
                    </TouchableOpacity>
                  </View>
                </View>
              </TouchableOpacity>
            </View>
          );
        })}

        {filteredDefects.length === 0 && (
          <View
            style={[
              styles.emptyState,
              {
                backgroundColor: theme.surface,
                borderColor: theme.border,
              },
            ]}
          >
            <VectorIcon name="check" size={34} color={theme.success} />
            <Text style={[styles.emptyTitle, { color: theme.text }]}>
              No Matching Defects
            </Text>
            <Text style={[styles.emptySub, { color: theme.textSecondary }]}>
              Try adjusting your severity, priority, or status filters, or report a new defect.
            </Text>
          </View>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>

      {/* DEFECT DETAIL & STATUS LIFECYCLE MODAL */}
      <Modal
        visible={!!viewingDefect}
        animationType="slide"
        transparent
        onRequestClose={closeDetailModal}
      >
        <View
          style={[styles.modalOverlay, { backgroundColor: theme.overlay }]}
        >
          <View
            style={[
              styles.modalSheet,
              {
                backgroundColor: theme.surface,
                borderColor: theme.border,
              },
            ]}
          >
            {viewingDefect && (
              <>
                <View
                  style={[
                    styles.modalHeader,
                    { borderBottomColor: theme.border },
                  ]}
                >
                  <View style={{ flex: 1, paddingRight: 10 }}>
                    <View style={styles.detailHeaderTags}>
                      <Text
                        style={[
                          styles.detailBugId,
                          { color: theme.primary, fontFamily: monoFontFamily },
                        ]}
                      >
                        {viewingDefect.defectId || viewingDefect.id}
                      </Text>
                      <View
                        style={[
                          styles.badge,
                          {
                            backgroundColor: getSeverityBadge(
                              viewingDefect.severity
                            ).bg,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.badgeText,
                            {
                              color: getSeverityBadge(viewingDefect.severity)
                                .color,
                            },
                          ]}
                        >
                          Sev: {viewingDefect.severity}
                        </Text>
                      </View>
                      <View
                        style={[
                          styles.badge,
                          {
                            backgroundColor: getPriorityBadge(
                              viewingDefect.priority ||
                                viewingDefect.severity ||
                                'High'
                            ).bg,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.badgeText,
                            {
                              color: getPriorityBadge(
                                viewingDefect.priority ||
                                  viewingDefect.severity ||
                                  'High'
                              ).color,
                            },
                          ]}
                        >
                          Pri:{' '}
                          {viewingDefect.priority ||
                            viewingDefect.severity ||
                            'High'}
                        </Text>
                      </View>
                    </View>
                    <Text
                      style={[styles.modalTitle, { color: theme.text }]}
                      numberOfLines={2}
                    >
                      {viewingDefect.title}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={closeDetailModal}
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
                  <Text
                    style={[
                      styles.sectionLabel,
                      { color: theme.textSecondary },
                    ]}
                  >
                    DEFECT WORKFLOW STATUS
                  </Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={{ marginBottom: 16 }}
                  >
                    {DEFECT_STATUSES.map((st) => {
                      const active = viewingDefect.status === st;
                      const stMeta = getStatusBadge(st);
                      return (
                        <TouchableOpacity
                          key={st}
                          onPress={() =>
                            handleQuickStatusChange(viewingDefect, st)
                          }
                          disabled={isUpdatingStatus}
                          style={[
                            styles.statusStepBtn,
                            {
                              backgroundColor: active
                                ? stMeta.bg
                                : theme.surfaceMuted,
                              borderColor: active
                                ? stMeta.color
                                : theme.border,
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.statusStepText,
                              {
                                color: active
                                  ? stMeta.color
                                  : theme.textSecondary,
                              },
                            ]}
                          >
                            {st}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>

                  {viewingDefect.description ? (
                    <>
                      <Text
                        style={[
                          styles.sectionLabel,
                          { color: theme.textSecondary },
                        ]}
                      >
                        DESCRIPTION / SUMMARY
                      </Text>
                      <View
                        style={[
                          styles.detailBlock,
                          {
                            backgroundColor: theme.surfaceMuted,
                            borderColor: theme.border,
                          },
                        ]}
                      >
                        <Text
                          style={[styles.detailText, { color: theme.text }]}
                        >
                          {viewingDefect.description}
                        </Text>
                      </View>
                    </>
                  ) : null}

                  <Text
                    style={[
                      styles.sectionLabel,
                      { color: theme.textSecondary },
                    ]}
                  >
                    STEPS TO REPRODUCE
                  </Text>
                  <View
                    style={[
                      styles.detailBlock,
                      {
                        backgroundColor: theme.surfaceMuted,
                        borderColor: theme.border,
                      },
                    ]}
                  >
                    <Text style={[styles.detailText, { color: theme.text }]}>
                      {viewingDefect.reproductionSteps ||
                        viewingDefect.steps ||
                        'No reproduction steps recorded.'}
                    </Text>
                  </View>

                  <View style={styles.comparisonGrid}>
                    <View
                      style={[
                        styles.comparisonCard,
                        {
                          backgroundColor: theme.successSoft,
                          borderColor: theme.success,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.comparisonHeader,
                          { color: theme.success },
                        ]}
                      >
                        EXPECTED RESULT
                      </Text>
                      <Text
                        style={[styles.comparisonBody, { color: theme.text }]}
                      >
                        {viewingDefect.expectedResult}
                      </Text>
                    </View>

                    <View
                      style={[
                        styles.comparisonCard,
                        {
                          backgroundColor: theme.dangerSoft,
                          borderColor: theme.danger,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.comparisonHeader,
                          { color: theme.danger },
                        ]}
                      >
                        ACTUAL RESULT
                      </Text>
                      <Text
                        style={[styles.comparisonBody, { color: theme.text }]}
                      >
                        {viewingDefect.actualResult}
                      </Text>
                    </View>
                  </View>

                  <Text
                    style={[
                      styles.sectionLabel,
                      { color: theme.textSecondary, marginTop: 14 },
                    ]}
                  >
                    ENVIRONMENT & BUILD CONTEXT
                  </Text>
                  <View
                    style={[
                      styles.detailBlock,
                      {
                        backgroundColor: theme.surfaceMuted,
                        borderColor: theme.border,
                      },
                    ]}
                  >
                    <Text style={[styles.detailText, { color: theme.text }]}>
                      {viewingDefect.environment || 'Android Device'}
                    </Text>
                    {viewingDefect.externalUrl ? (
                      <Text
                        style={[
                          styles.externalUrlText,
                          { color: theme.primary },
                        ]}
                      >
                        External Issue: {viewingDefect.externalUrl}
                      </Text>
                    ) : null}
                  </View>

                  {/* Bidirectional Execution & Test Case Traceability */}
                  {(() => {
                    const linkedCase = testCases.find(
                      (c) => c.id === viewingDefect.linkedTestCaseId
                    );
                    const linkedRun = testRuns.find(
                      (r) => r.id === viewingDefect.linkedTestRunId
                    );
                    return (
                      <View
                        style={[
                          styles.traceabilityBox,
                          {
                            backgroundColor: theme.surfaceMuted,
                            borderColor: theme.border,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.sectionLabel,
                            { color: theme.textSecondary, marginBottom: 8 },
                          ]}
                        >
                          LINKED TEST CASE & EXECUTION CONTEXT
                        </Text>

                        {linkedCase || viewingDefect.linkedTestCaseId ? (
                          <TouchableOpacity
                            style={[
                              styles.traceLinkBtn,
                              {
                                backgroundColor: theme.primarySoft,
                                borderColor: theme.primary,
                              },
                            ]}
                            onPress={() => {
                              if (linkedCase) {
                                setSelectedTestCaseId(linkedCase.id);
                              }
                              closeDetailModal();
                              setActiveTab('testcases');
                            }}
                          >
                            <VectorIcon
                              name="tag"
                              size={14}
                              color={theme.primary}
                            />
                            <View style={{ flex: 1 }}>
                              <Text
                                style={[
                                  styles.traceLinkTitle,
                                  { color: theme.primary },
                                ]}
                              >
                                Test Case:{' '}
                                {linkedCase?.id ||
                                  viewingDefect.linkedTestCaseId}
                              </Text>
                              <Text
                                style={[
                                  styles.traceLinkSub,
                                  { color: theme.text },
                                ]}
                                numberOfLines={1}
                              >
                                {linkedCase?.title ||
                                  viewingDefect.linkedCaseTitle ||
                                  'View Linked Test Case'}
                              </Text>
                            </View>
                            <VectorIcon
                              name="chevron-right"
                              size={15}
                              color={theme.primary}
                            />
                          </TouchableOpacity>
                        ) : (
                          <Text
                            style={[
                              styles.unlinkedHint,
                              { color: theme.textMuted },
                            ]}
                          >
                            Not linked to a specific test case.
                          </Text>
                        )}

                        {linkedRun || viewingDefect.linkedTestRunId ? (
                          <TouchableOpacity
                            style={[
                              styles.traceLinkBtn,
                              {
                                backgroundColor: theme.infoSoft,
                                borderColor: theme.info,
                                marginTop: 8,
                              },
                            ]}
                            onPress={() => {
                              if (linkedRun) {
                                setSelectedTestRunId(linkedRun.id);
                              }
                              closeDetailModal();
                              setActiveTab('testruns');
                            }}
                          >
                            <VectorIcon
                              name="layers"
                              size={14}
                              color={theme.info}
                            />
                            <View style={{ flex: 1 }}>
                              <Text
                                style={[
                                  styles.traceLinkTitle,
                                  { color: theme.info },
                                ]}
                              >
                                Test Run:{' '}
                                {linkedRun?.id || viewingDefect.linkedTestRunId}
                              </Text>
                              <Text
                                style={[
                                  styles.traceLinkSub,
                                  { color: theme.text },
                                ]}
                                numberOfLines={1}
                              >
                                {linkedRun
                                  ? `${linkedRun.name} (${linkedRun.status})`
                                  : 'Open Test Runs'}
                              </Text>
                            </View>
                            <VectorIcon
                              name="chevron-right"
                              size={15}
                              color={theme.info}
                            />
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    );
                  })()}
                </ScrollView>

                {/* Detail Modal Footer Actions */}
                <View
                  style={[
                    styles.modalFooter,
                    { borderTopColor: theme.border },
                  ]}
                >
                  <TouchableOpacity
                    style={[
                      styles.deleteModalBtn,
                      {
                        backgroundColor: theme.dangerSoft,
                        borderColor: theme.danger,
                      },
                    ]}
                    onPress={() => setDefectPendingDelete(viewingDefect)}
                  >
                    <VectorIcon name="trash" size={15} color={theme.danger} />
                    <Text
                      style={[
                        styles.deleteModalBtnText,
                        { color: theme.danger },
                      ]}
                    >
                      Delete
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.saveBtn,
                      { backgroundColor: theme.primary },
                    ]}
                    onPress={() => openEditDefectForm(viewingDefect)}
                  >
                    <VectorIcon name="edit" size={15} color="#FFFFFF" />
                    <Text style={styles.saveBtnText}>Edit Defect Details</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* CREATE / EDIT DEFECT MODAL */}
      <Modal
        visible={formModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setFormModalVisible(false)}
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
                {editingDefectId
                  ? `Edit Defect (${editingDefectId})`
                  : 'Report New Defect'}
              </Text>
              <TouchableOpacity
                onPress={() => setFormModalVisible(false)}
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
              {formError ? (
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
                    {formError}
                  </Text>
                </View>
              ) : null}

              <Text
                style={[styles.inputLabel, { color: theme.textSecondary }]}
              >
                Defect Title *
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
                placeholder="e.g., Crash when rotating camera during QR scan"
                placeholderTextColor={theme.textMuted}
                value={title}
                onChangeText={setTitle}
              />

              <Text
                style={[styles.inputLabel, { color: theme.textSecondary }]}
              >
                Severity
              </Text>
              <View style={styles.optionRow}>
                {DEFECT_SEVERITIES.map((s) => {
                  const active = severity === s;
                  return (
                    <TouchableOpacity
                      key={s}
                      onPress={() => setSeverity(s)}
                      style={[
                        styles.optionChip,
                        {
                          backgroundColor: active
                            ? theme.dangerSoft
                            : theme.surfaceMuted,
                          borderColor: active ? theme.danger : theme.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.optionChipText,
                          {
                            color: active
                              ? theme.danger
                              : theme.textSecondary,
                          },
                        ]}
                      >
                        {s}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text
                style={[styles.inputLabel, { color: theme.textSecondary }]}
              >
                Priority
              </Text>
              <View style={styles.optionRow}>
                {DEFECT_PRIORITIES.map((p) => {
                  const active = priority === p;
                  return (
                    <TouchableOpacity
                      key={p}
                      onPress={() => setPriority(p)}
                      style={[
                        styles.optionChip,
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
                          styles.optionChipText,
                          {
                            color: active
                              ? theme.primary
                              : theme.textSecondary,
                          },
                        ]}
                      >
                        {p}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text
                style={[styles.inputLabel, { color: theme.textSecondary }]}
              >
                Workflow Status
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ marginVertical: 4 }}
              >
                {DEFECT_STATUSES.map((st) => {
                  const active = status === st;
                  return (
                    <TouchableOpacity
                      key={st}
                      onPress={() => setStatus(st)}
                      style={[
                        styles.caseSelectPill,
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
                          styles.caseSelectText,
                          {
                            color: active
                              ? theme.primary
                              : theme.textSecondary,
                          },
                        ]}
                      >
                        {st}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              <Text
                style={[styles.inputLabel, { color: theme.textSecondary }]}
              >
                Linked Test Case
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ marginVertical: 4 }}
              >
                <TouchableOpacity
                  onPress={() => setLinkedTestCaseId('')}
                  style={[
                    styles.caseSelectPill,
                    {
                      backgroundColor: !linkedTestCaseId
                        ? theme.primarySoft
                        : theme.surfaceMuted,
                      borderColor: !linkedTestCaseId
                        ? theme.primary
                        : theme.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.caseSelectText,
                      {
                        color: !linkedTestCaseId
                          ? theme.primary
                          : theme.textSecondary,
                      },
                    ]}
                  >
                    None
                  </Text>
                </TouchableOpacity>
                {testCases.map((tc) => {
                  const active = linkedTestCaseId === tc.id;
                  return (
                    <TouchableOpacity
                      key={tc.id}
                      onPress={() => handleSelectLinkedCaseInForm(tc.id)}
                      style={[
                        styles.caseSelectPill,
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
                          styles.caseSelectText,
                          {
                            color: active
                              ? theme.primary
                              : theme.textSecondary,
                          },
                        ]}
                      >
                        {tc.id}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              <Text
                style={[styles.inputLabel, { color: theme.textSecondary }]}
              >
                Linked Test Run
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ marginVertical: 4 }}
              >
                <TouchableOpacity
                  onPress={() => setLinkedTestRunId('')}
                  style={[
                    styles.caseSelectPill,
                    {
                      backgroundColor: !linkedTestRunId
                        ? theme.infoSoft
                        : theme.surfaceMuted,
                      borderColor: !linkedTestRunId ? theme.info : theme.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.caseSelectText,
                      {
                        color: !linkedTestRunId
                          ? theme.info
                          : theme.textSecondary,
                      },
                    ]}
                  >
                    None
                  </Text>
                </TouchableOpacity>
                {testRuns.map((run) => {
                  const active = linkedTestRunId === run.id;
                  return (
                    <TouchableOpacity
                      key={run.id}
                      onPress={() => setLinkedTestRunId(run.id)}
                      style={[
                        styles.caseSelectPill,
                        {
                          backgroundColor: active
                            ? theme.infoSoft
                            : theme.surfaceMuted,
                          borderColor: active ? theme.info : theme.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.caseSelectText,
                          {
                            color: active ? theme.info : theme.textSecondary,
                          },
                        ]}
                      >
                        {run.id} • {run.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              <Text
                style={[styles.inputLabel, { color: theme.textSecondary }]}
              >
                Summary / Description
              </Text>
              <TextInput
                style={[
                  styles.textArea,
                  {
                    backgroundColor: theme.surfaceMuted,
                    borderColor: theme.border,
                    color: theme.text,
                  },
                ]}
                placeholder="Brief context or root-cause hypothesis..."
                placeholderTextColor={theme.textMuted}
                multiline
                value={description}
                onChangeText={setDescription}
              />

              <Text
                style={[styles.inputLabel, { color: theme.textSecondary }]}
              >
                Steps to Reproduce *
              </Text>
              <TextInput
                style={[
                  styles.textArea,
                  {
                    backgroundColor: theme.surfaceMuted,
                    borderColor: theme.border,
                    color: theme.text,
                  },
                ]}
                placeholder="1. Open screen...\n2. Tap button..."
                placeholderTextColor={theme.textMuted}
                multiline
                value={reproSteps}
                onChangeText={setReproSteps}
              />

              <Text
                style={[styles.inputLabel, { color: theme.textSecondary }]}
              >
                Expected Result
              </Text>
              <TextInput
                style={[
                  styles.textArea,
                  {
                    backgroundColor: theme.surfaceMuted,
                    borderColor: theme.border,
                    color: theme.text,
                  },
                ]}
                placeholder="What should happen?"
                placeholderTextColor={theme.textMuted}
                multiline
                value={expectedResult}
                onChangeText={setExpectedResult}
              />

              <Text
                style={[styles.inputLabel, { color: theme.textSecondary }]}
              >
                Actual Result / Crash Log *
              </Text>
              <TextInput
                style={[
                  styles.textArea,
                  {
                    backgroundColor: theme.surfaceMuted,
                    borderColor: theme.border,
                    color: theme.text,
                  },
                ]}
                placeholder="What actually happened or stacktrace..."
                placeholderTextColor={theme.textMuted}
                multiline
                value={actualResult}
                onChangeText={setActualResult}
              />

              <Text
                style={[styles.inputLabel, { color: theme.textSecondary }]}
              >
                Device & Build Environment
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
                value={environment}
                onChangeText={setEnvironment}
              />

              <Text
                style={[styles.inputLabel, { color: theme.textSecondary }]}
              >
                External Issue URL (Optional)
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
                placeholder="https://jira.example.com/browse/QAV-102"
                placeholderTextColor={theme.textMuted}
                value={externalUrl}
                onChangeText={setExternalUrl}
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
                onPress={() => setFormModalVisible(false)}
                disabled={isSubmittingDefect}
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
                    backgroundColor: editingDefectId
                      ? theme.primary
                      : theme.danger,
                    opacity: isSubmittingDefect ? 0.7 : 1,
                  },
                ]}
                onPress={handleSaveDefect}
                disabled={isSubmittingDefect}
              >
                {isSubmittingDefect ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <VectorIcon name="check" size={15} color="#FFFFFF" />
                )}
                <Text style={styles.saveBtnText}>
                  {editingDefectId ? 'Save Changes' : 'Submit Defect'}
                </Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* DELETE DEFECT CONFIRMATION MODAL */}
      <Modal
        visible={!!defectPendingDelete}
        animationType="fade"
        transparent
        onRequestClose={() => setDefectPendingDelete(null)}
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
              Delete Defect?
            </Text>
            <Text
              style={[
                styles.confirmDesc,
                { color: theme.textSecondary },
              ]}
            >
              Are you sure you want to delete{' '}
              <Text style={{ fontWeight: '800', color: theme.text }}>
                {defectPendingDelete?.defectId || defectPendingDelete?.id}:{' '}
                {defectPendingDelete?.title}
              </Text>
              ? Any linked test execution records will be safely unlinked.
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
                onPress={() => setDefectPendingDelete(null)}
                disabled={isDeletingDefect}
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
                    opacity: isDeletingDefect ? 0.7 : 1,
                  },
                ]}
                onPress={handleConfirmDeleteDefect}
                disabled={isDeletingDefect}
              >
                {isDeletingDefect ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <VectorIcon name="trash" size={14} color="#FFFFFF" />
                )}
                <Text style={styles.confirmDeleteText}>Delete Defect</Text>
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
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  projectStripLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  projectDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  projectStripName: {
    fontSize: 13,
    fontWeight: '800',
    maxWidth: 190,
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
  topBar: {
    paddingTop: 10,
    paddingBottom: 10,
    borderBottomWidth: 1,
  },
  kpiRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 6,
    marginBottom: 10,
  },
  kpiChip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 6,
    borderRadius: 9,
  },
  kpiVal: {
    fontSize: 14,
    fontWeight: '800',
  },
  kpiLabel: {
    fontSize: 10,
    fontWeight: '700',
  },
  searchRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 8,
    marginBottom: 10,
  },
  searchBox: {
    flex: 1,
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
  logBugBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    height: 42,
    borderRadius: 11,
    gap: 5,
  },
  logBugBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  filterRow: {
    paddingHorizontal: 16,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '700',
  },
  sevChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  sevChipText: {
    fontSize: 11,
    fontWeight: '700',
  },
  contentContainer: {
    padding: 16,
  },
  resultsBar: {
    marginBottom: 10,
  },
  resultsCount: {
    fontSize: 12,
    fontWeight: '600',
  },
  defectCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 10,
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  idAndSev: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  bugId: {
    fontSize: 12,
    fontWeight: '800',
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  bugTitle: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
    marginBottom: 4,
  },
  bugDescriptionSnippet: {
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 6,
  },
  envLine: {
    fontSize: 11,
    fontWeight: '500',
    marginBottom: 10,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 10,
    borderTopWidth: 1,
  },
  linksRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  linkChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  linkChipText: {
    fontSize: 10,
    fontWeight: '800',
  },
  cardBottomRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cardMiniBtn: {
    width: 26,
    height: 26,
    borderRadius: 7,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateText: {
    fontSize: 11,
    fontWeight: '500',
  },
  emptyState: {
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
  detailHeaderTags: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  detailBugId: {
    fontSize: 12,
    fontWeight: '800',
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
  sectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  statusStepBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 9,
    borderWidth: 1,
    marginRight: 8,
  },
  statusStepText: {
    fontSize: 12,
    fontWeight: '800',
  },
  detailBlock: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 14,
  },
  detailText: {
    fontSize: 13,
    lineHeight: 20,
  },
  externalUrlText: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 6,
  },
  comparisonGrid: {
    gap: 10,
  },
  comparisonCard: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  comparisonHeader: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  comparisonBody: {
    fontSize: 13,
    lineHeight: 19,
  },
  traceabilityBox: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  traceLinkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  traceLinkTitle: {
    fontSize: 12,
    fontWeight: '800',
  },
  traceLinkSub: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  unlinkedHint: {
    fontSize: 12,
    fontStyle: 'italic',
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
  textArea: {
    minHeight: 74,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    textAlignVertical: 'top',
  },
  optionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  optionChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
  },
  optionChipText: {
    fontSize: 12,
    fontWeight: '700',
  },
  caseSelectPill: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    marginRight: 8,
  },
  caseSelectText: {
    fontSize: 12,
    fontWeight: '700',
  },
  modalFooter: {
    flexDirection: 'row',
    gap: 10,
    padding: 16,
    borderTopWidth: 1,
  },
  deleteModalBtn: {
    flex: 1,
    flexDirection: 'row',
    height: 44,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  deleteModalBtnText: {
    fontSize: 13,
    fontWeight: '800',
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

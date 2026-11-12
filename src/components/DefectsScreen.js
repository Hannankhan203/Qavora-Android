import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  FlatList,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Keyboard,
} from 'react-native';
import VectorIcon from './VectorIcon';
import { useTheme, monoFontFamily } from '../theme/theme';
import {
  useWorkspace,
  useWorkspaceBackOverlay,
} from '../context/WorkspaceContext';
import {
  DEFECT_SEVERITIES,
  DEFECT_PRIORITIES,
  DEFECT_STATUSES,
} from '../data/initialData';
import {
  validateDefectExternalUrl,
  openDefectExternalUrl,
  formatShortTimestamp,
} from './defects/defectUrlUtils';
import styles from './defects/defectsStyles';
import DefectDetailModal from './defects/DefectDetailModal';
import DefectFormModal from './defects/DefectFormModal';
import DefectDeleteModal from './defects/DefectDeleteModal';

export { validateDefectExternalUrl, openDefectExternalUrl };

export function resolveDefaultDefectEnvironment(profile, currentProject) {
  const parts = [];
  const profileDevice =
    typeof profile?.defaultDevice === 'string'
      ? profile.defaultDevice.trim()
      : '';
  const profileBuild =
    typeof profile?.defaultBuild === 'string'
      ? profile.defaultBuild.trim()
      : '';
  const projectEnv =
    typeof currentProject?.environment === 'string'
      ? currentProject.environment.trim()
      : '';

  if (profileDevice) {
    parts.push(profileDevice);
  }
  if (profileBuild) {
    parts.push(`Build ${profileBuild}`);
  }
  if (projectEnv) {
    const lowerParts = parts.join(' ').toLowerCase();
    if (!lowerParts.includes(projectEnv.toLowerCase())) {
      parts.push(projectEnv);
    }
  }
  return parts.join(' · ');
}

const DefectRowCard = React.memo(function DefectRowCard({
  bug,
  theme,
  hasLinkedCase,
  hasLinkedRun,
  sevMeta,
  priMeta,
  stMeta,
  onPressDefect,
  onOpenExternalUrl,
  onEditDefect,
  onRequestDeleteDefect,
}) {
  const displayId = bug.defectId || bug.id;
  const externalUrlValid = Boolean(
    bug.externalUrl && validateDefectExternalUrl(bug.externalUrl).isValid
  );

  return (
    <View
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
        accessibilityRole="button"
        accessibilityLabel={`Open defect ${displayId}: ${bug.title}`}
        onPress={() => onPressDefect(bug.id)}
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
              {displayId}
            </Text>
            <View style={[styles.badge, { backgroundColor: sevMeta.bg }]}>
              <Text style={[styles.badgeText, { color: sevMeta.color }]}>
                {bug.severity}
              </Text>
            </View>
            <View style={[styles.badge, { backgroundColor: priMeta.bg }]}>
              <Text style={[styles.badgeText, { color: priMeta.color }]}>
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
          Env: {bug.environment || 'Not specified'}
        </Text>

        <View style={[styles.cardFooter, { borderTopColor: theme.border }]}>
          <View style={styles.linksRow}>
            {(hasLinkedCase || bug.linkedTestCaseId) && (
              <View
                style={[
                  styles.linkChip,
                  { backgroundColor: theme.primarySoft },
                ]}
              >
                <VectorIcon name="tag" size={10} color={theme.primary} />
                <Text style={[styles.linkChipText, { color: theme.primary }]}>
                  {bug.linkedTestCaseId}
                </Text>
              </View>
            )}
            {(hasLinkedRun || bug.linkedTestRunId) && (
              <View
                style={[styles.linkChip, { backgroundColor: theme.infoSoft }]}
              >
                <VectorIcon name="layers" size={10} color={theme.info} />
                <Text style={[styles.linkChipText, { color: theme.info }]}>
                  {bug.linkedTestRunId}
                </Text>
              </View>
            )}
            {externalUrlValid ? (
              <TouchableOpacity
                activeOpacity={0.75}
                accessibilityRole="link"
                accessibilityLabel={`Open external issue link for ${displayId}`}
                accessibilityHint="Opens the external issue URL in your browser"
                onPress={() => onOpenExternalUrl(bug.externalUrl)}
                style={[
                  styles.linkChip,
                  {
                    backgroundColor: theme.primarySoft,
                    borderWidth: 1,
                    borderColor: theme.primary,
                    maxWidth: 150,
                  },
                ]}
              >
                <VectorIcon name="globe" size={10} color={theme.primary} />
                <Text
                  numberOfLines={1}
                  ellipsizeMode="tail"
                  style={[
                    styles.linkChipText,
                    {
                      color: theme.primary,
                      textDecorationLine: 'underline',
                      flexShrink: 1,
                    },
                  ]}
                >
                  External Issue
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>

          <View style={styles.cardBottomRightActions}>
            <Text style={[styles.dateText, { color: theme.textMuted }]}>
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
              hitSlop={{ top: 11, bottom: 11, left: 11, right: 11 }}
              accessibilityRole="button"
              accessibilityLabel={`Edit defect ${displayId}`}
              onPress={() => onEditDefect(bug)}
            >
              <VectorIcon name="edit" size={12} color={theme.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.cardMiniBtn,
                {
                  backgroundColor: theme.dangerSoft,
                  borderColor: theme.danger,
                },
              ]}
              hitSlop={{ top: 11, bottom: 11, left: 11, right: 11 }}
              accessibilityRole="button"
              accessibilityLabel={`Delete defect ${displayId}`}
              onPress={() => onRequestDeleteDefect(bug)}
            >
              <VectorIcon name="trash" size={12} color={theme.danger} />
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
    </View>
  );
});

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
    notifyBlockedSwipeTouchStart,
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
  const defaultDefectEnvironment = useMemo(
    () => resolveDefaultDefectEnvironment(profile, currentProject),
    [profile, currentProject]
  );

  const [environment, setEnvironment] = useState(defaultDefectEnvironment);
  const [externalUrl, setExternalUrl] = useState('');
  const [linkedTestCaseId, setLinkedTestCaseId] = useState('');
  const [linkedTestRunId, setLinkedTestRunId] = useState('');
  const [linkedExecutionId, setLinkedExecutionId] = useState('');
  const [formError, setFormError] = useState('');
  const [isSubmittingDefect, setIsSubmittingDefect] = useState(false);

  // Delete confirmation modal state
  const [defectPendingDelete, setDefectPendingDelete] = useState(null);
  const [isDeletingDefect, setIsDeletingDefect] = useState(false);

  useWorkspaceBackOverlay(() => {
    if (defectPendingDelete) {
      if (!isDeletingDefect) setDefectPendingDelete(null);
      return true;
    }
    if (formModalVisible) {
      if (!isSubmittingDefect) setFormModalVisible(false);
      return true;
    }
    return false;
  });

  // Status update in detail modal
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  // Feedback banner
  const [feedbackBanner, setFeedbackBanner] = useState(null);

  // Refs for form keyboard UX & auto-scroll
  const defectFormScrollRef = useRef(null);
  const defectTitleRef = useRef(null);
  const defectDescRef = useRef(null);
  const defectReproRef = useRef(null);
  const defectExpectedRef = useRef(null);
  const defectActualRef = useRef(null);
  const defectEnvRef = useRef(null);
  const defectUrlRef = useRef(null);

  const scrollDefectModalTo = useCallback((yOffset) => {
    setTimeout(() => {
      if (
        defectFormScrollRef.current &&
        typeof defectFormScrollRef.current.scrollTo === 'function'
      ) {
        defectFormScrollRef.current.scrollTo({
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

  // Synchronize detail modal with centralized selectedDefectId (including BackHandler clear)
  useEffect(() => {
    setViewingDefectId(selectedDefectId || null);
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
      const draftEnv =
        typeof draftDefectFromExecution.environment === 'string'
          ? draftDefectFromExecution.environment.trim()
          : '';
      setEnvironment(draftEnv || defaultDefectEnvironment);
      setExternalUrl(draftDefectFromExecution.externalUrl || '');
      setLinkedTestCaseId(draftDefectFromExecution.linkedTestCaseId || '');
      setLinkedTestRunId(draftDefectFromExecution.linkedTestRunId || '');
      setLinkedExecutionId(draftDefectFromExecution.linkedExecutionId || '');
      setFormError('');
      setFormModalVisible(true);
      setDraftDefectFromExecution(null);
    }
  }, [
    draftDefectFromExecution,
    setDraftDefectFromExecution,
    defaultDefectEnvironment,
  ]);

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
    setEnvironment(defaultDefectEnvironment);
    setExternalUrl('');
    setLinkedTestCaseId(testCases[0]?.id || '');
    setLinkedTestRunId(testRuns[0]?.id || '');
    setLinkedExecutionId('');
    setFormError('');
    setFormModalVisible(true);
  };

  const openEditDefectForm = useCallback(
    (defect) => {
      if (!defect) return;
      setViewingDefectId(null);
      setSelectedDefectId(null);
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
        typeof defect.environment === 'string' ? defect.environment.trim() : ''
      );
      setExternalUrl(defect.externalUrl || '');
      setLinkedTestCaseId(defect.linkedTestCaseId || '');
      setLinkedTestRunId(defect.linkedTestRunId || '');
      setLinkedExecutionId(defect.linkedExecutionId || '');
      setFormError('');
      setFormModalVisible(true);
    },
    [setSelectedDefectId]
  );

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

    const trimmedExternalUrl = externalUrl.trim();
    if (trimmedExternalUrl) {
      const urlValidation = validateDefectExternalUrl(trimmedExternalUrl);
      if (!urlValidation.isValid) {
        setFormError(
          'External Issue URL must be a valid http:// or https:// address.'
        );
        return;
      }
    }

    Keyboard.dismiss();
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
        environment: environment.trim(),
        externalUrl: trimmedExternalUrl,
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

  const handleOpenExternalUrl = useCallback(async (rawUrl) => {
    await openDefectExternalUrl(rawUrl, {
      onError: (msg) => showFeedback('error', msg),
    });
  }, []);

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

  const getSeverityBadge = useCallback(
    (sev) => {
      if (sev === 'Critical')
        return { color: theme.danger, bg: theme.dangerSoft };
      if (sev === 'High' || sev === 'Major')
        return { color: theme.warning, bg: theme.warningSoft };
      if (sev === 'Medium' || sev === 'Minor')
        return { color: theme.info, bg: theme.infoSoft };
      return { color: theme.textSecondary, bg: theme.surfaceMuted };
    },
    [theme]
  );

  const getPriorityBadge = useCallback(
    (pri) => {
      if (pri === 'Critical')
        return { color: theme.danger, bg: theme.dangerSoft };
      if (pri === 'High')
        return { color: theme.warning, bg: theme.warningSoft };
      if (pri === 'Medium') return { color: theme.info, bg: theme.infoSoft };
      return { color: theme.textSecondary, bg: theme.surfaceMuted };
    },
    [theme]
  );

  const getStatusBadge = useCallback(
    (st) => {
      if (st === 'Open' || st === 'Reopened')
        return { color: theme.danger, bg: theme.dangerSoft };
      if (st === 'In Progress')
        return { color: theme.warning, bg: theme.warningSoft };
      if (st === 'Ready for Retest')
        return { color: theme.info, bg: theme.infoSoft };
      if (st === 'Resolved')
        return { color: theme.success, bg: theme.successSoft };
      return { color: theme.textMuted, bg: theme.surfaceMuted };
    },
    [theme]
  );

  const testCaseIdSet = useMemo(() => {
    const set = new Set();
    for (let i = 0; i < testCases.length; i += 1) {
      if (testCases[i]?.id) set.add(testCases[i].id);
    }
    return set;
  }, [testCases]);

  const testRunIdSet = useMemo(() => {
    const set = new Set();
    for (let i = 0; i < testRuns.length; i += 1) {
      if (testRuns[i]?.id) set.add(testRuns[i].id);
    }
    return set;
  }, [testRuns]);

  const handleOpenDefectDetail = useCallback(
    (defectId) => {
      setViewingDefectId(defectId);
      setSelectedDefectId(defectId);
    },
    [setSelectedDefectId]
  );

  const defectKeyExtractor = useCallback(
    (item, index) => String(item?.id || item?.defectId || `defect_${index}`),
    []
  );

  const renderDefectItem = useCallback(
    ({ item: bug }) => (
      <DefectRowCard
        bug={bug}
        theme={theme}
        hasLinkedCase={Boolean(
          bug.linkedTestCaseId && testCaseIdSet.has(bug.linkedTestCaseId)
        )}
        hasLinkedRun={Boolean(
          bug.linkedTestRunId && testRunIdSet.has(bug.linkedTestRunId)
        )}
        sevMeta={getSeverityBadge(bug.severity)}
        priMeta={getPriorityBadge(bug.priority || bug.severity)}
        stMeta={getStatusBadge(bug.status)}
        onPressDefect={handleOpenDefectDetail}
        onOpenExternalUrl={handleOpenExternalUrl}
        onEditDefect={openEditDefectForm}
        onRequestDeleteDefect={setDefectPendingDelete}
      />
    ),
    [
      theme,
      testCaseIdSet,
      testRunIdSet,
      getSeverityBadge,
      getPriorityBadge,
      getStatusBadge,
      handleOpenDefectDetail,
      handleOpenExternalUrl,
      openEditDefectForm,
    ]
  );

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
            accessibilityRole="button"
            accessibilityLabel="Select project"
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
            accessibilityLabel="Refresh defects"
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
                accessibilityRole="button"
                accessibilityLabel="Reload latest project data"
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
              accessibilityRole="button"
              accessibilityLabel="Dismiss error banner"
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
              accessibilityRole="button"
              accessibilityLabel={`Filter defects by ${item.label}: ${item.val}`}
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
              accessibilityLabel="Search defects by ID, title, steps, case, or environment"
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
                accessibilityLabel="Clear defect search"
              >
                <VectorIcon name="close" size={14} color={theme.textMuted} />
              </TouchableOpacity>
            )}
          </View>

          <TouchableOpacity
            style={[styles.logBugBtn, { backgroundColor: theme.danger }]}
            hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            accessibilityRole="button"
            accessibilityLabel="Report New Defect"
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
          onTouchStart={notifyBlockedSwipeTouchStart}
          contentContainerStyle={styles.filterRow}
        >
          {['All', ...DEFECT_STATUSES].map((st) => {
            const active = statusFilter === st;
            return (
              <TouchableOpacity
                key={st}
                onPress={() => setStatusFilter(st)}
                hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`Filter defects by status: ${
                  st === 'All' ? 'All Statuses' : st
                }`}
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
          onTouchStart={notifyBlockedSwipeTouchStart}
          contentContainerStyle={[styles.filterRow, { marginTop: 6 }]}
        >
          {['All', ...DEFECT_SEVERITIES].map((sev) => {
            const active = severityFilter === sev;
            return (
              <TouchableOpacity
                key={`sev-${sev}`}
                onPress={() => setSeverityFilter(sev)}
                hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`Filter defects by severity: ${
                  sev === 'All' ? 'All Severities' : sev
                }`}
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
                hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`Filter defects by priority: ${
                  pri === 'All' ? 'All Priorities' : pri
                }`}
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
      <FlatList
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
        data={filteredDefects}
        keyExtractor={defectKeyExtractor}
        renderItem={renderDefectItem}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={7}
        removeClippedSubviews
        ListHeaderComponent={
          <View style={styles.resultsBar}>
            <Text style={[styles.resultsCount, { color: theme.textSecondary }]}>
              Showing {filteredDefects.length} of {defects.length} defects
            </Text>
          </View>
        }
        ListEmptyComponent={
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
        }
        ListFooterComponent={<View style={{ height: 32 }} />}
      />

      <DefectDetailModal
        theme={theme}
        viewingDefect={viewingDefect}
        closeDetailModal={closeDetailModal}
        getSeverityBadge={getSeverityBadge}
        getPriorityBadge={getPriorityBadge}
        getStatusBadge={getStatusBadge}
        isUpdatingStatus={isUpdatingStatus}
        handleQuickStatusChange={handleQuickStatusChange}
        handleOpenExternalUrl={handleOpenExternalUrl}
        testCases={testCases}
        testRuns={testRuns}
        setSelectedTestCaseId={setSelectedTestCaseId}
        setSelectedTestRunId={setSelectedTestRunId}
        setActiveTab={setActiveTab}
        setDefectPendingDelete={setDefectPendingDelete}
        openEditDefectForm={openEditDefectForm}
      />

      <DefectFormModal
        theme={theme}
        formModalVisible={formModalVisible}
        setFormModalVisible={setFormModalVisible}
        editingDefectId={editingDefectId}
        formError={formError}
        title={title}
        setTitle={setTitle}
        severity={severity}
        setSeverity={setSeverity}
        priority={priority}
        setPriority={setPriority}
        status={status}
        setStatus={setStatus}
        linkedTestCaseId={linkedTestCaseId}
        setLinkedTestCaseId={setLinkedTestCaseId}
        handleSelectLinkedCaseInForm={handleSelectLinkedCaseInForm}
        testCases={testCases}
        linkedTestRunId={linkedTestRunId}
        setLinkedTestRunId={setLinkedTestRunId}
        testRuns={testRuns}
        description={description}
        setDescription={setDescription}
        reproSteps={reproSteps}
        setReproSteps={setReproSteps}
        expectedResult={expectedResult}
        setExpectedResult={setExpectedResult}
        actualResult={actualResult}
        setActualResult={setActualResult}
        environment={environment}
        setEnvironment={setEnvironment}
        externalUrl={externalUrl}
        setExternalUrl={setExternalUrl}
        isSubmittingDefect={isSubmittingDefect}
        handleSaveDefect={handleSaveDefect}
        defectFormScrollRef={defectFormScrollRef}
        defectTitleRef={defectTitleRef}
        defectDescRef={defectDescRef}
        defectReproRef={defectReproRef}
        defectExpectedRef={defectExpectedRef}
        defectActualRef={defectActualRef}
        defectEnvRef={defectEnvRef}
        defectUrlRef={defectUrlRef}
        scrollDefectModalTo={scrollDefectModalTo}
      />

      <DefectDeleteModal
        theme={theme}
        defectPendingDelete={defectPendingDelete}
        setDefectPendingDelete={setDefectPendingDelete}
        isDeletingDefect={isDeletingDefect}
        handleConfirmDeleteDefect={handleConfirmDeleteDefect}
      />
    </View>
  );
}

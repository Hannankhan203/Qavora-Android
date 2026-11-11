/**
 * Qavora Android — Project Details Screen (Phase 2B)
 *
 * Displays the selected project's:
 * - Name, description, status, type, version, environment, baseUrl, and tags
 * - Creation (`createdAt`) and last-updated (`updatedAt`) timestamps
 * - Project-level statistics derived strictly from actual project data
 * - Actions to edit metadata, change lifecycle status (`Active` | `Completed` | `Archived`),
 *   and delete the project with explicit confirmation that clears `selectedProject`.
 */

import React, { useState, useMemo, useCallback, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  ScrollView,
  RefreshControl,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { useTheme, monoFontFamily } from '../theme/theme';
import { useProjects } from '../context/ProjectContext';
import { useWorkspace } from '../context/WorkspaceContext';
import VectorIcon from './VectorIcon';
import ProjectFormModal from './ProjectFormModal';
import { computeProjectTestCaseCount } from '../services/projectService';

function formatTimestampDetail(isoString) {
  if (!isoString || typeof isoString !== 'string') return 'Not available';
  const parsed = new Date(isoString);
  if (Number.isNaN(parsed.getTime())) return isoString;
  return parsed.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Computes project-level statistics strictly when supported by actual project data.
 */
export function deriveActualProjectStatistics(project) {
  if (!project || typeof project !== 'object') {
    return null;
  }

  const hasSuitesArray = Array.isArray(project.testSuites);
  const hasExecutionsArray = Array.isArray(project.executions);
  const hasExecutionRunsArray = Array.isArray(project.executionRuns);
  const hasDefectsArray = Array.isArray(project.defects);
  const hasNumericCounts =
    typeof project.testCaseCount === 'number' ||
    typeof project.totalDefects === 'number' ||
    typeof project.passRate === 'number';

  if (
    !hasSuitesArray &&
    !hasExecutionsArray &&
    !hasExecutionRunsArray &&
    !hasDefectsArray &&
    !hasNumericCounts
  ) {
    return null;
  }

  const suiteCount = hasSuitesArray ? project.testSuites.length : 0;
  const testCaseCount = computeProjectTestCaseCount(project);

  const executionCount = hasExecutionRunsArray
    ? project.executionRuns.length
    : hasExecutionsArray
    ? project.executions.length
    : typeof project.executedTests === 'number'
    ? project.executedTests
    : 0;

  const totalDefects =
    typeof project.totalDefects === 'number'
      ? project.totalDefects
      : hasDefectsArray
      ? project.defects.length
      : 0;

  const openDefects =
    typeof project.openDefects === 'number'
      ? project.openDefects
      : hasDefectsArray
      ? project.defects.filter(
          (d) => d && d.status && d.status !== 'Closed' && d.status !== 'Resolved'
        ).length
      : 0;

  const passRate =
    typeof project.passRate === 'number' ? project.passRate : null;

  return {
    suiteCount,
    testCaseCount: testCaseCount ?? 0,
    executionCount,
    totalDefects,
    openDefects,
    passRate,
  };
}

export default function ProjectDetailsScreen({
  onBackToWorkspace,
  onSwitchProject,
  onProjectDeleted,
}) {
  const { colors } = useTheme();
  const {
    selectedProject,
    projectStatuses,
    isLoading,
    isMutating,
    projectError,
    getProject,
    updateProjectStatus,
    deleteProject,
    clearProjectError,
  } = useProjects();
  const { showToast } = useWorkspace();

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isRefreshingDetail, setIsRefreshingDetail] = useState(false);
  const [statusUpdatingTo, setStatusUpdatingTo] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [actionError, setActionError] = useState(null);

  const mutationLockRef = useRef(false);

  const projectId = selectedProject
    ? selectedProject.id || selectedProject._id
    : null;

  const projectStats = useMemo(
    () => deriveActualProjectStatistics(selectedProject),
    [selectedProject]
  );

  const handleRefreshProject = useCallback(async () => {
    if (!projectId) return;
    setIsRefreshingDetail(true);
    setActionError(null);
    clearProjectError();
    try {
      const res = await getProject(projectId);
      if (!res.ok) {
        setActionError(res.error || 'Failed to refresh project details.');
      }
    } finally {
      setIsRefreshingDetail(false);
    }
  }, [projectId, getProject, clearProjectError]);

  const handleStatusChange = async (nextStatus) => {
    if (
      !selectedProject ||
      !projectId ||
      selectedProject.status === nextStatus ||
      mutationLockRef.current ||
      isMutating
    ) {
      return;
    }

    mutationLockRef.current = true;
    setStatusUpdatingTo(nextStatus);
    setActionError(null);
    clearProjectError();

    try {
      const result = await updateProjectStatus(projectId, nextStatus);
      if (result && result.ok) {
        if (showToast) {
          showToast(
            `Project status updated to "${nextStatus}"`,
            'success'
          );
        }
      } else {
        setActionError(
          (result && result.error) || 'Failed to update project status.'
        );
      }
    } finally {
      mutationLockRef.current = false;
      setStatusUpdatingTo(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!selectedProject || !projectId || mutationLockRef.current || isDeleting) {
      return;
    }

    const deletedName = selectedProject.name;
    mutationLockRef.current = true;
    setIsDeleting(true);
    setActionError(null);
    clearProjectError();

    try {
      const result = await deleteProject(projectId);
      if (result && result.ok) {
        setIsDeleteConfirmOpen(false);
        if (showToast) {
          showToast(`Deleted project "${deletedName}"`, 'info');
        }
        if (typeof onProjectDeleted === 'function') {
          onProjectDeleted(projectId);
        }
        return;
      }

      setActionError(
        (result && result.error) || 'Failed to delete project.'
      );
    } finally {
      mutationLockRef.current = false;
      setIsDeleting(false);
    }
  };

  if (!selectedProject) {
    return (
      <View
        style={[
          styles.emptyContainer,
          { backgroundColor: colors.background },
        ]}
      >
        <View
          style={[
            styles.emptyCard,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <VectorIcon name="folder" size={28} color={colors.primary} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            No Active Project Selected
          </Text>
          <Text style={[styles.emptySub, { color: colors.textSecondary }]}>
            Select a project from the Project Selection screen to view its details.
          </Text>
          {typeof onSwitchProject === 'function' ? (
            <Pressable
              onPress={onSwitchProject}
              style={[
                styles.primaryBtn,
                { backgroundColor: colors.primary },
              ]}
            >
              <Text
                style={[
                  styles.primaryBtnText,
                  { color: colors.textOnPrimary },
                ]}
              >
                Go to Project Selection
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  }

  const getStatusTone = (status) => {
    if (status === 'Completed') {
      return {
        bg: colors.infoSoft,
        border: colors.info,
        text: colors.info,
      };
    }
    if (status === 'Archived') {
      return {
        bg: colors.untestedSoft,
        border: colors.borderStrong,
        text: colors.textMuted,
      };
    }
    return {
      bg: colors.successSoft,
      border: colors.success,
      text: colors.success,
    };
  };

  const activeStatusStyle = getStatusTone(selectedProject.status);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshingDetail}
            onRefresh={handleRefreshProject}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {/* Top Navigation Bar */}
        <View style={styles.navRow}>
          {typeof onBackToWorkspace === 'function' ? (
            <Pressable
              onPress={onBackToWorkspace}
              style={[
                styles.navBtn,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                },
              ]}
            >
              <VectorIcon
                name="chevron-left"
                size={16}
                color={colors.text}
              />
              <Text style={[styles.navBtnText, { color: colors.text }]}>
                Workspace
              </Text>
            </Pressable>
          ) : null}

          <View style={styles.navRightGroup}>
            {typeof onSwitchProject === 'function' ? (
              <Pressable
                onPress={onSwitchProject}
                style={[
                  styles.navBtn,
                  {
                    backgroundColor: colors.surfaceAccent,
                    borderColor: colors.primary,
                  },
                ]}
              >
                <VectorIcon
                  name="switch"
                  size={15}
                  color={colors.primary}
                />
                <Text
                  style={[styles.navBtnText, { color: colors.primary }]}
                >
                  All Projects
                </Text>
              </Pressable>
            ) : null}

            <Pressable
              onPress={handleRefreshProject}
              disabled={isRefreshingDetail || isLoading}
              style={[
                styles.navBtn,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                },
              ]}
            >
              <VectorIcon
                name="refresh"
                size={15}
                color={colors.textSecondary}
              />
              <Text
                style={[
                  styles.navBtnText,
                  { color: colors.textSecondary },
                ]}
              >
                {isRefreshingDetail ? 'Syncing...' : 'Sync'}
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Error Banner */}
        {actionError || projectError ? (
          <View
            style={[
              styles.errorBanner,
              {
                backgroundColor: colors.dangerSoft,
                borderColor: colors.danger,
              },
            ]}
          >
            <VectorIcon name="alert" size={18} color={colors.danger} />
            <Text style={[styles.errorText, { color: colors.danger }]}>
              {actionError || projectError}
            </Text>
          </View>
        ) : null}

        {/* Primary Project Identity & Metadata Card */}
        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <View style={styles.identityHeaderRow}>
            <View
              style={[
                styles.statusBadge,
                {
                  backgroundColor: activeStatusStyle.bg,
                  borderColor: activeStatusStyle.border,
                },
              ]}
            >
              <Text
                style={[
                  styles.statusBadgeText,
                  {
                    color: activeStatusStyle.text,
                    fontFamily: monoFontFamily,
                  },
                ]}
              >
                {selectedProject.status || 'Active'}
              </Text>
            </View>

            <Text
              numberOfLines={1}
              style={[
                styles.projectIdCode,
                { color: colors.textMuted, fontFamily: monoFontFamily },
              ]}
            >
              ID: {projectId}
            </Text>
          </View>

          <Text style={[styles.projectTitle, { color: colors.text }]}>
            {selectedProject.name}
          </Text>

          <Text
            style={[
              styles.projectDescription,
              {
                color: selectedProject.description
                  ? colors.textSecondary
                  : colors.textMuted,
              },
            ]}
          >
            {selectedProject.description ||
              'No project description has been added yet.'}
          </Text>

          {/* Structured Metadata Grid */}
          <View
            style={[
              styles.metadataGrid,
              { borderTopColor: colors.border },
            ]}
          >
            <View style={styles.metaCell}>
              <Text style={[styles.metaLabel, { color: colors.textMuted }]}>
                Application Type
              </Text>
              <Text style={[styles.metaValue, { color: colors.text }]}>
                {selectedProject.type || 'Web Application'}
              </Text>
            </View>

            <View style={styles.metaCell}>
              <Text style={[styles.metaLabel, { color: colors.textMuted }]}>
                Target Version
              </Text>
              <Text
                style={[
                  styles.metaValue,
                  { color: colors.text, fontFamily: monoFontFamily },
                ]}
              >
                {selectedProject.version || 'Not specified'}
              </Text>
            </View>

            <View style={styles.metaCell}>
              <Text style={[styles.metaLabel, { color: colors.textMuted }]}>
                Environment
              </Text>
              <Text style={[styles.metaValue, { color: colors.text }]}>
                {selectedProject.environment || 'Not specified'}
              </Text>
            </View>

            <View style={styles.metaCell}>
              <Text style={[styles.metaLabel, { color: colors.textMuted }]}>
                Base URL
              </Text>
              <Text
                numberOfLines={1}
                style={[
                  styles.metaValue,
                  { color: colors.text, fontFamily: monoFontFamily },
                ]}
              >
                {selectedProject.baseUrl || 'Not configured'}
              </Text>
            </View>

            <View style={styles.metaCell}>
              <Text style={[styles.metaLabel, { color: colors.textMuted }]}>
                Created At
              </Text>
              <Text
                style={[
                  styles.metaValue,
                  { color: colors.textSecondary, fontFamily: monoFontFamily },
                ]}
              >
                {formatTimestampDetail(selectedProject.createdAt)}
              </Text>
            </View>

            <View style={styles.metaCell}>
              <Text style={[styles.metaLabel, { color: colors.textMuted }]}>
                Last Updated
              </Text>
              <Text
                style={[
                  styles.metaValue,
                  { color: colors.textSecondary, fontFamily: monoFontFamily },
                ]}
              >
                {formatTimestampDetail(selectedProject.updatedAt)}
              </Text>
            </View>
          </View>

          {/* Tags */}
          {Array.isArray(selectedProject.tags) &&
          selectedProject.tags.length > 0 ? (
            <View
              style={[
                styles.tagsSection,
                { borderTopColor: colors.border },
              ]}
            >
              <Text style={[styles.metaLabel, { color: colors.textMuted }]}>
                Project Tags
              </Text>
              <View style={styles.tagsRow}>
                {selectedProject.tags.map((tag) => (
                  <View
                    key={tag}
                    style={[
                      styles.tagPill,
                      { backgroundColor: colors.primarySoft },
                    ]}
                  >
                    <VectorIcon name="tag" size={12} color={colors.primary} />
                    <Text
                      style={[
                        styles.tagPillText,
                        { color: colors.primary, fontFamily: monoFontFamily },
                      ]}
                    >
                      {tag}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {/* Primary Edit Button */}
          <View style={styles.editActionRow}>
            <Pressable
              onPress={() => setIsEditModalOpen(true)}
              disabled={isMutating}
              style={[
                styles.editProjectBtn,
                { backgroundColor: colors.primary },
              ]}
            >
              <VectorIcon
                name="edit"
                size={16}
                color={colors.textOnPrimary}
              />
              <Text
                style={[
                  styles.editProjectBtnText,
                  { color: colors.textOnPrimary },
                ]}
              >
                Edit Project Metadata
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Project-Level Statistics (Shown only when supported by actual project data) */}
        {projectStats ? (
          <View
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text
              style={[
                styles.sectionKicker,
                { color: colors.primary, fontFamily: monoFontFamily },
              ]}
            >
              ACTUAL PROJECT ARTIFACT METRICS
            </Text>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Project Statistics
            </Text>
            <Text
              style={[styles.sectionSub, { color: colors.textSecondary }]}
            >
              Calculated directly from synchronized project records on the Qavora backend.
            </Text>

            <View style={styles.statsGrid}>
              <View
                style={[
                  styles.statBox,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.statNumber,
                    { color: colors.primary, fontFamily: monoFontFamily },
                  ]}
                >
                  {projectStats.suiteCount}
                </Text>
                <Text
                  style={[styles.statLabel, { color: colors.textSecondary }]}
                >
                  Test Suites
                </Text>
              </View>

              <View
                style={[
                  styles.statBox,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.statNumber,
                    { color: colors.text, fontFamily: monoFontFamily },
                  ]}
                >
                  {projectStats.testCaseCount}
                </Text>
                <Text
                  style={[styles.statLabel, { color: colors.textSecondary }]}
                >
                  Test Cases
                </Text>
              </View>

              <View
                style={[
                  styles.statBox,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.statNumber,
                    { color: colors.info, fontFamily: monoFontFamily },
                  ]}
                >
                  {projectStats.executionCount}
                </Text>
                <Text
                  style={[styles.statLabel, { color: colors.textSecondary }]}
                >
                  Executions
                </Text>
              </View>

              <View
                style={[
                  styles.statBox,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.statNumber,
                    {
                      color:
                        projectStats.openDefects > 0
                          ? colors.danger
                          : colors.success,
                      fontFamily: monoFontFamily,
                    },
                  ]}
                >
                  {projectStats.openDefects} / {projectStats.totalDefects}
                </Text>
                <Text
                  style={[styles.statLabel, { color: colors.textSecondary }]}
                >
                  Open / Total Defects
                </Text>
              </View>
            </View>
          </View>
        ) : null}

        {/* Lifecycle Status Management Card */}
        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Text
            style={[
              styles.sectionKicker,
              { color: colors.primary, fontFamily: monoFontFamily },
            ]}
          >
            PATCH /api/projects/:id/status
          </Text>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Change Project Status
          </Text>
          <Text style={[styles.sectionSub, { color: colors.textSecondary }]}>
            Update the lifecycle state of this project across your Qavora workspace.
          </Text>

          <View style={styles.statusButtonsRow} accessibilityRole="radiogroup">
            {projectStatuses.map((statusOption) => {
              const isCurrent = selectedProject.status === statusOption;
              const isUpdatingThis = statusUpdatingTo === statusOption;
              return (
                <Pressable
                  key={statusOption}
                  disabled={isCurrent || isMutating}
                  onPress={() => handleStatusChange(statusOption)}
                  hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                  accessibilityRole="radio"
                  accessibilityState={{
                    selected: isCurrent,
                    checked: isCurrent,
                    disabled: Boolean(isCurrent || isMutating),
                  }}
                  accessibilityLabel={`Set project status to ${statusOption}`}
                  style={[
                    styles.statusOptionBtn,
                    {
                      backgroundColor: isCurrent
                        ? colors.primary
                        : colors.background,
                      borderColor: isCurrent
                        ? colors.primary
                        : colors.borderStrong,
                    },
                  ]}
                >
                  {isUpdatingThis ? (
                    <ActivityIndicator
                      size="small"
                      color={isCurrent ? colors.textOnPrimary : colors.primary}
                    />
                  ) : isCurrent ? (
                    <VectorIcon
                      name="check"
                      size={14}
                      color={colors.textOnPrimary}
                    />
                  ) : null}
                  <Text
                    style={[
                      styles.statusOptionText,
                      {
                        color: isCurrent ? colors.textOnPrimary : colors.text,
                      },
                    ]}
                  >
                    {statusOption}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Danger Zone — Delete Project */}
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.surface,
              borderColor: colors.danger,
            },
          ]}
        >
          <Text
            style={[
              styles.sectionKicker,
              { color: colors.danger, fontFamily: monoFontFamily },
            ]}
          >
            DANGER ZONE · DELETE /api/projects/:id
          </Text>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Delete Project
          </Text>
          <Text style={[styles.sectionSub, { color: colors.textSecondary }]}>
            Permanently deletes "{selectedProject.name}" and all associated QA artifacts from MongoDB. This action cannot be undone.
          </Text>

          <Pressable
            onPress={() => setIsDeleteConfirmOpen(true)}
            disabled={isMutating || isDeleting}
            accessibilityRole="button"
            accessibilityState={{
              disabled: Boolean(isMutating || isDeleting),
            }}
            accessibilityLabel={`Delete project ${selectedProject.name}`}
            style={[
              styles.deleteDangerBtn,
              {
                backgroundColor: colors.dangerSoft,
                borderColor: colors.danger,
              },
            ]}
          >
            <VectorIcon name="trash" size={16} color={colors.danger} />
            <Text
              style={[styles.deleteDangerBtnText, { color: colors.danger }]}
            >
              Delete Project...
            </Text>
          </Pressable>
        </View>
      </ScrollView>

      {/* Edit Project Modal */}
      <ProjectFormModal
        visible={isEditModalOpen}
        initialProject={selectedProject}
        onClose={() => setIsEditModalOpen(false)}
        onSuccess={(updated) => {
          if (showToast && updated) {
            showToast(`Saved changes to "${updated.name}"`, 'success');
          }
        }}
      />

      {/* Explicit Delete Confirmation Modal */}
      <Modal
        visible={isDeleteConfirmOpen}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!isDeleting) setIsDeleteConfirmOpen(false);
        }}
      >
        <View
          accessibilityViewIsModal={true}
          style={[styles.confirmOverlay, { backgroundColor: colors.overlay }]}
        >
          <View
            style={[
              styles.confirmBox,
              {
                backgroundColor: colors.surface,
                borderColor: colors.danger,
              },
            ]}
          >
            <View
              style={[
                styles.confirmIconCircle,
                { backgroundColor: colors.dangerSoft },
              ]}
            >
              <VectorIcon name="trash" size={22} color={colors.danger} />
            </View>

            <Text
              accessibilityRole="header"
              style={[styles.confirmTitle, { color: colors.text }]}
            >
              Delete "{selectedProject.name}"?
            </Text>

            <Text
              style={[styles.confirmDesc, { color: colors.textSecondary }]}
            >
              Are you sure you want to permanently delete this project (ID:{' '}
              {projectId})? This will remove the project and its associated artifacts from your Qavora account and clear your current project selection.
            </Text>

            <View style={styles.confirmActionsRow}>
              <Pressable
                onPress={() => setIsDeleteConfirmOpen(false)}
                disabled={isDeleting}
                accessibilityRole="button"
                accessibilityLabel="Cancel project deletion"
                style={[
                  styles.confirmCancelBtn,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.borderStrong,
                  },
                ]}
              >
                <Text
                  style={[styles.confirmCancelText, { color: colors.text }]}
                >
                  Cancel
                </Text>
              </Pressable>

              <Pressable
                onPress={handleConfirmDelete}
                disabled={isDeleting}
                accessibilityRole="button"
                accessibilityLabel={`Confirm permanent deletion of project ${selectedProject.name}`}
                style={[
                  styles.confirmDeleteBtn,
                  { backgroundColor: colors.danger },
                ]}
              >
                {isDeleting ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <VectorIcon name="trash" size={15} color="#FFFFFF" />
                )}
                <Text style={styles.confirmDeleteText}>
                  {isDeleting ? 'Deleting...' : 'Confirm Delete'}
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
  root: {
    flex: 1,
  },
  scroll: {
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
  emptyContainer: {
    flex: 1,
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 24,
    alignItems: 'center',
    maxWidth: 420,
    width: '100%',
    gap: 10,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  emptySub: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
  primaryBtn: {
    marginTop: 6,
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  navRightGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  navBtn: {
    minHeight: 44,
    paddingHorizontal: 11,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  navBtnText: {
    fontSize: 12.5,
    fontWeight: '700',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  errorText: {
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  identityHeaderRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  projectIdCode: {
    fontSize: 11,
    flexShrink: 1,
  },
  projectTitle: {
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 28,
  },
  projectDescription: {
    fontSize: 14,
    lineHeight: 20,
  },
  metadataGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderTopWidth: 1,
    paddingTop: 12,
    gap: 12,
  },
  metaCell: {
    flexBasis: '46%',
    flexGrow: 1,
    minWidth: 140,
    gap: 2,
  },
  metaLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  metaValue: {
    fontSize: 13,
    fontWeight: '600',
  },
  tagsSection: {
    borderTopWidth: 1,
    paddingTop: 12,
    gap: 8,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  tagPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 5,
  },
  tagPillText: {
    fontSize: 11,
    fontWeight: '600',
  },
  editActionRow: {
    marginTop: 4,
  },
  editProjectBtn: {
    minHeight: 46,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  editProjectBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
  sectionKicker: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  sectionSub: {
    fontSize: 13,
    lineHeight: 18,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  statBox: {
    flexBasis: '46%',
    flexGrow: 1,
    minWidth: 135,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    gap: 4,
  },
  statNumber: {
    fontSize: 20,
    fontWeight: '700',
  },
  statLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  statusButtonsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  statusOptionBtn: {
    flex: 1,
    minWidth: 92,
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    gap: 6,
  },
  statusOptionText: {
    fontSize: 13,
    fontWeight: '700',
  },
  deleteDangerBtn: {
    minHeight: 46,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  deleteDangerBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
  confirmOverlay: {
    flex: 1,
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBox: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 18,
    borderWidth: 1.5,
    padding: 20,
    alignItems: 'center',
    gap: 12,
  },
  confirmIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmTitle: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  confirmDesc: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  confirmActionsRow: {
    flexDirection: 'row',
    width: '100%',
    gap: 10,
    marginTop: 4,
  },
  confirmCancelBtn: {
    flex: 1,
    minHeight: 44,
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
    flex: 1.3,
    minHeight: 44,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  confirmDeleteText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
});

/**
 * Qavora Android — Mobile Project Selection Screen (Phase 2B)
 *
 * Provides a responsive mobile Project Selection & Switching experience:
 * - Fetches projects through `ProjectContext`
 * - Displays project name, description, status, and relevant metadata
 * - Supports loading, empty, and error states
 * - Allows selecting and switching projects without requiring logout
 * - Provides Create Project and Edit Project actions via `ProjectFormModal`
 * - Supports pull-to-refresh (`RefreshControl`)
 * - Clearly highlights the currently selected project
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Keyboard,
} from 'react-native';
import { useTheme, monoFontFamily } from '../theme/theme';
import { useAuth } from '../context/AuthContext';
import { useProjects } from '../context/ProjectContext';
import { useWorkspace } from '../context/WorkspaceContext';
import VectorIcon from './VectorIcon';
import ProjectFormModal from './ProjectFormModal';
import { computeProjectTestCaseCount } from '../services/projectService';

function formatReadableDate(isoString) {
  if (!isoString || typeof isoString !== 'string') return null;
  const parsed = new Date(isoString);
  if (Number.isNaN(parsed.getTime())) return isoString;
  return parsed.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function computeProjectCardStats(project) {
  if (!project || typeof project !== 'object') return null;

  const suites = Array.isArray(project.testSuites) ? project.testSuites : null;
  const suiteCount = suites ? suites.length : null;

  const testCaseCount = computeProjectTestCaseCount(project);

  const defects = Array.isArray(project.defects) ? project.defects : null;
  const defectCount =
    typeof project.totalDefects === 'number'
      ? project.totalDefects
      : defects
      ? defects.length
      : null;

  if (suiteCount === null && testCaseCount === null && defectCount === null) {
    return null;
  }

  return {
    suiteCount: suiteCount ?? 0,
    testCaseCount: testCaseCount ?? 0,
    defectCount: defectCount ?? 0,
  };
}

export default function ProjectSelectionScreen({
  onOpenWorkspace,
  onOpenProjectDetails,
}) {
  const { colors } = useTheme();
  const { user, logout, isLoading: isAuthBusy } = useAuth();
  const {
    projects,
    selectedProject,
    selectedProjectId,
    projectStatuses,
    hasLoadedInitialProjects,
    isLoading,
    isRefreshing,
    projectError,
    selectProject,
    refreshProjects,
  } = useProjects();
  const { showToast, openChecklistsView, openDataManagementView } =
    useWorkspace();

  const [statusFilter, setStatusFilter] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState(null);

  const handlePullToRefresh = useCallback(async () => {
    await refreshProjects({ pullToRefresh: true });
  }, [refreshProjects]);

  const handleRetryLoad = useCallback(async () => {
    await refreshProjects();
  }, [refreshProjects]);

  const handleSelectProject = async (project, openDetails = false) => {
    const id = project.id || project._id;
    await selectProject(id);
    if (showToast) {
      showToast(`Switched active project to "${project.name}"`, 'success');
    }
    if (openDetails && typeof onOpenProjectDetails === 'function') {
      onOpenProjectDetails(project);
    } else if (typeof onOpenWorkspace === 'function') {
      onOpenWorkspace(project);
    }
  };

  const openCreateProjectModal = () => {
    setEditingProject(null);
    setIsFormModalOpen(true);
  };

  const openEditProjectModal = (project) => {
    setEditingProject(project);
    setIsFormModalOpen(true);
  };

  const handleFormSuccess = (savedProject, mode) => {
    if (showToast && savedProject) {
      showToast(
        mode === 'edit'
          ? `Updated project "${savedProject.name}"`
          : `Created project "${savedProject.name}"`,
        'success'
      );
    }
    if (mode === 'create' && typeof onOpenWorkspace === 'function') {
      onOpenWorkspace(savedProject);
    }
  };

  const filteredProjects = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return projects.filter((proj) => {
      if (statusFilter !== 'All' && proj.status !== statusFilter) {
        return false;
      }
      if (q) {
        const tagsStr = Array.isArray(proj.tags) ? proj.tags.join(' ') : '';
        const haystack = `${proj.name || ''} ${proj.description || ''} ${
          proj.type || ''
        } ${proj.version || ''} ${proj.environment || ''} ${tagsStr}`.toLowerCase();
        if (!haystack.includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [projects, statusFilter, searchQuery]);

  const getStatusBadgeStyle = (status) => {
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

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handlePullToRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {/* Top Hero / Header Card */}
        <View
          style={[
            styles.heroCard,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <View style={styles.heroTopRow}>
            <View style={styles.heroTitleCol}>
              <Text
                style={[
                  styles.kicker,
                  { color: colors.primary, fontFamily: monoFontFamily },
                ]}
              >
                QAVORA MULTI-PROJECT WORKSPACE
              </Text>
              <Text style={[styles.heroTitle, { color: colors.text }]}>
                Select a QA Project
              </Text>
              <Text style={[styles.heroSub, { color: colors.textSecondary }]}>
                Choose an active project to load its QA workspace, or create a new project synced with your Qavora account.
              </Text>
            </View>
          </View>

          {user ? (
            <View
              style={[
                styles.userStrip,
                {
                  backgroundColor: colors.background,
                  borderColor: colors.border,
                },
              ]}
            >
              <View style={styles.userStripInfo}>
                <Text
                  numberOfLines={1}
                  style={[styles.userStripName, { color: colors.text }]}
                >
                  {user.name} ({user.role || 'QA Tester'})
                </Text>
                <Text
                  numberOfLines={1}
                  style={[
                    styles.userStripEmail,
                    { color: colors.textMuted, fontFamily: monoFontFamily },
                  ]}
                >
                  {user.email} · {projects.length}{' '}
                  {projects.length === 1 ? 'project' : 'projects'}
                </Text>
              </View>

              <Pressable
                onPress={logout}
                disabled={isAuthBusy}
                style={[
                  styles.signOutMiniBtn,
                  {
                    backgroundColor: colors.dangerSoft,
                    borderColor: colors.danger,
                  },
                ]}
              >
                <Text
                  style={[styles.signOutMiniText, { color: colors.danger }]}
                >
                  {isAuthBusy ? 'Signing out...' : 'Sign Out'}
                </Text>
              </Pressable>
            </View>
          ) : null}

          <View style={styles.heroActionsRow}>
            <Pressable
              onPress={openCreateProjectModal}
              style={[
                styles.primaryActionBtn,
                { backgroundColor: colors.primary },
              ]}
            >
              <VectorIcon name="plus" size={16} color={colors.textOnPrimary} />
              <Text
                style={[
                  styles.primaryActionText,
                  { color: colors.textOnPrimary },
                ]}
              >
                New Project
              </Text>
            </Pressable>

            <Pressable
              onPress={handleRetryLoad}
              disabled={isLoading || isRefreshing}
              style={[
                styles.secondaryActionBtn,
                {
                  backgroundColor: colors.surfaceAccent,
                  borderColor: colors.primary,
                },
              ]}
            >
              <VectorIcon name="refresh" size={16} color={colors.primary} />
              <Text
                style={[styles.secondaryActionText, { color: colors.primary }]}
              >
                {isLoading || isRefreshing ? 'Refreshing...' : 'Refresh'}
              </Text>
            </Pressable>

            {typeof openChecklistsView === 'function' ? (
              <Pressable
                onPress={openChecklistsView}
                style={[
                  styles.secondaryActionBtn,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.borderStrong,
                  },
                ]}
              >
                <VectorIcon name="clipboard" size={15} color={colors.primary} />
                <Text
                  style={[styles.secondaryActionText, { color: colors.text }]}
                >
                  QA Checklists
                </Text>
              </Pressable>
            ) : null}

            {typeof openDataManagementView === 'function' ? (
              <Pressable
                onPress={openDataManagementView}
                style={[
                  styles.secondaryActionBtn,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.borderStrong,
                  },
                ]}
              >
                <VectorIcon name="layers" size={15} color={colors.primary} />
                <Text
                  style={[styles.secondaryActionText, { color: colors.text }]}
                >
                  Profile & Backup
                </Text>
              </Pressable>
            ) : null}

            {selectedProject && typeof onOpenWorkspace === 'function' ? (
              <Pressable
                onPress={() => onOpenWorkspace(selectedProject)}
                style={[
                  styles.secondaryActionBtn,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.borderStrong,
                  },
                ]}
              >
                <Text
                  style={[styles.secondaryActionText, { color: colors.text }]}
                >
                  Back to Workspace
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        {/* Currently Selected Project Banner */}
        {selectedProject ? (
          <View
            style={[
              styles.activeSelectionBanner,
              {
                backgroundColor: colors.primarySoft,
                borderColor: colors.primary,
              },
            ]}
          >
            <View style={styles.activeBannerTop}>
              <View style={styles.activeBannerBadgeRow}>
                <View
                  style={[
                    styles.activeCheckCircle,
                    { backgroundColor: colors.primary },
                  ]}
                >
                  <VectorIcon
                    name="check"
                    size={12}
                    color={colors.textOnPrimary}
                  />
                </View>
                <Text
                  style={[
                    styles.activeBannerKicker,
                    { color: colors.primary, fontFamily: monoFontFamily },
                  ]}
                >
                  CURRENTLY SELECTED PROJECT
                </Text>
              </View>

              <Text
                style={[
                  styles.activeBannerStatus,
                  { color: colors.primary, fontFamily: monoFontFamily },
                ]}
              >
                {selectedProject.status || 'Active'}
              </Text>
            </View>

            <Text style={[styles.activeBannerTitle, { color: colors.text }]}>
              {selectedProject.name}
            </Text>
            {selectedProject.description ? (
              <Text
                numberOfLines={2}
                style={[
                  styles.activeBannerDesc,
                  { color: colors.textSecondary },
                ]}
              >
                {selectedProject.description}
              </Text>
            ) : null}

            <View style={styles.activeBannerBtnRow}>
              {typeof onOpenWorkspace === 'function' ? (
                <Pressable
                  onPress={() => onOpenWorkspace(selectedProject)}
                  style={[
                    styles.activeBannerPrimaryBtn,
                    { backgroundColor: colors.primary },
                  ]}
                >
                  <Text
                    style={[
                      styles.activeBannerPrimaryText,
                      { color: colors.textOnPrimary },
                    ]}
                  >
                    Open Workspace
                  </Text>
                  <VectorIcon
                    name="chevron-right"
                    size={15}
                    color={colors.textOnPrimary}
                  />
                </Pressable>
              ) : null}

              {typeof onOpenProjectDetails === 'function' ? (
                <Pressable
                  onPress={() => onOpenProjectDetails(selectedProject)}
                  style={[
                    styles.activeBannerSecondaryBtn,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.primary,
                    },
                  ]}
                >
                  <VectorIcon name="info" size={15} color={colors.primary} />
                  <Text
                    style={[
                      styles.activeBannerSecondaryText,
                      { color: colors.primary },
                    ]}
                  >
                    Project Details
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}

        {/* Search & Status Filters */}
        {projects.length > 0 ? (
          <View
            style={[
              styles.filterCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View
              style={[
                styles.searchBox,
                {
                  backgroundColor: colors.background,
                  borderColor: colors.border,
                },
              ]}
            >
              <VectorIcon name="search" size={16} color={colors.textMuted} />
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Search projects by name, version, environment, or tag..."
                placeholderTextColor={colors.textMuted}
                accessibilityLabel="Search projects by name, version, environment, or tag"
                returnKeyType="search"
                onSubmitEditing={() => Keyboard.dismiss()}
                style={[styles.searchInput, { color: colors.text }]}
              />
              {searchQuery ? (
                <Pressable
                  onPress={() => setSearchQuery('')}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  accessibilityRole="button"
                  accessibilityLabel="Clear project search"
                  style={styles.clearSearchBtn}
                >
                  <VectorIcon name="close" size={14} color={colors.textMuted} />
                </Pressable>
              ) : null}
            </View>

            <View style={styles.statusFilterRow} accessibilityRole="tablist">
              {['All', ...projectStatuses].map((st) => {
                const active = statusFilter === st;
                return (
                  <Pressable
                    key={st}
                    onPress={() => setStatusFilter(st)}
                    hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`Filter projects by status: ${st}`}
                    style={[
                      styles.filterChip,
                      {
                        backgroundColor: active
                          ? colors.primary
                          : colors.background,
                        borderColor: active ? colors.primary : colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.filterChipText,
                        { color: active ? colors.textOnPrimary : colors.text },
                      ]}
                    >
                      {st}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}

        {/* Error State */}
        {projectError ? (
          <View
            style={[
              styles.errorCard,
              {
                backgroundColor: colors.dangerSoft,
                borderColor: colors.danger,
              },
            ]}
          >
            <View style={styles.errorHeaderRow}>
              <VectorIcon name="alert" size={18} color={colors.danger} />
              <Text style={[styles.errorTitle, { color: colors.danger }]}>
                Unable to Load Projects
              </Text>
            </View>
            <Text style={[styles.errorMessage, { color: colors.text }]}>
              {projectError}
            </Text>
            <Pressable
              onPress={handleRetryLoad}
              style={[styles.retryBtn, { backgroundColor: colors.danger }]}
            >
              <VectorIcon name="refresh" size={15} color="#FFFFFF" />
              <Text style={styles.retryBtnText}>Retry Request</Text>
            </Pressable>
          </View>
        ) : null}

        {/* Loading State */}
        {isLoading && !hasLoadedInitialProjects ? (
          <View
            style={[
              styles.stateCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={[styles.stateTitle, { color: colors.text }]}>
              Loading Your Qavora Projects...
            </Text>
            <Text
              style={[
                styles.stateSub,
                { color: colors.textMuted, fontFamily: monoFontFamily },
              ]}
            >
              Fetching from GET /api/projects
            </Text>
          </View>
        ) : null}

        {/* Empty State (No Projects Owned by User) */}
        {!isLoading && hasLoadedInitialProjects && projects.length === 0 ? (
          <View
            style={[
              styles.stateCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View
              style={[
                styles.emptyIconCircle,
                { backgroundColor: colors.primarySoft },
              ]}
            >
              <VectorIcon name="folder" size={26} color={colors.primary} />
            </View>
            <Text style={[styles.stateTitle, { color: colors.text }]}>
              No Projects Found
            </Text>
            <Text style={[styles.stateDesc, { color: colors.textSecondary }]}>
              You do not have any QA projects in your Qavora workspace yet. Create your first project, import a JSON backup, or manage account-wide QA checklists.
            </Text>
            <Pressable
              onPress={openCreateProjectModal}
              style={[
                styles.emptyCreateBtn,
                { backgroundColor: colors.primary },
              ]}
            >
              <VectorIcon name="plus" size={16} color={colors.textOnPrimary} />
              <Text
                style={[
                  styles.emptyCreateBtnText,
                  { color: colors.textOnPrimary },
                ]}
              >
                Create Your First Project
              </Text>
            </Pressable>

            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                justifyContent: 'center',
                gap: 8,
                marginTop: 6,
              }}
            >
              {typeof openDataManagementView === 'function' ? (
                <Pressable
                  onPress={openDataManagementView}
                  style={[
                    styles.secondaryActionBtn,
                    {
                      backgroundColor: colors.surfaceAccent,
                      borderColor: colors.primary,
                    },
                  ]}
                >
                  <VectorIcon name="layers" size={15} color={colors.primary} />
                  <Text
                    style={[
                      styles.secondaryActionText,
                      { color: colors.primary },
                    ]}
                  >
                    Import Backup & Data Management
                  </Text>
                </Pressable>
              ) : null}

              {typeof openChecklistsView === 'function' ? (
                <Pressable
                  onPress={openChecklistsView}
                  style={[
                    styles.secondaryActionBtn,
                    {
                      backgroundColor: colors.background,
                      borderColor: colors.borderStrong,
                    },
                  ]}
                >
                  <VectorIcon
                    name="clipboard"
                    size={15}
                    color={colors.primary}
                  />
                  <Text
                    style={[styles.secondaryActionText, { color: colors.text }]}
                  >
                    Account QA Checklists
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}

        {/* Empty Filter Result */}
        {!isLoading &&
        projects.length > 0 &&
        filteredProjects.length === 0 ? (
          <View
            style={[
              styles.stateCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.stateTitle, { color: colors.text }]}>
              No Matching Projects
            </Text>
            <Text style={[styles.stateDesc, { color: colors.textSecondary }]}>
              No projects matched your current search or status filter.
            </Text>
            <Pressable
              onPress={() => {
                setSearchQuery('');
                setStatusFilter('All');
              }}
              style={[
                styles.secondaryActionBtn,
                {
                  backgroundColor: colors.background,
                  borderColor: colors.borderStrong,
                },
              ]}
            >
              <Text style={[styles.secondaryActionText, { color: colors.text }]}>
                Reset Filters
              </Text>
            </Pressable>
          </View>
        ) : null}

        {/* Project Cards List */}
        {filteredProjects.map((project) => {
          const projectId = project.id || project._id;
          const isSelected =
            Boolean(selectedProjectId) &&
            (project.id === selectedProjectId ||
              project._id === selectedProjectId);
          const statusStyle = getStatusBadgeStyle(project.status);
          const updatedLabel = formatReadableDate(
            project.updatedAt || project.createdAt
          );
          const stats = computeProjectCardStats(project);

          return (
            <View
              key={projectId}
              style={[
                styles.projectCard,
                {
                  backgroundColor: colors.surface,
                  borderColor: isSelected ? colors.primary : colors.border,
                  borderWidth: isSelected ? 2 : 1,
                },
              ]}
            >
              {/* Card Top Metadata Row */}
              <View style={styles.cardTopRow}>
                <View style={styles.cardBadgesWrap}>
                  <View
                    style={[
                      styles.statusBadge,
                      {
                        backgroundColor: statusStyle.bg,
                        borderColor: statusStyle.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusBadgeText,
                        { color: statusStyle.text, fontFamily: monoFontFamily },
                      ]}
                    >
                      {project.status || 'Active'}
                    </Text>
                  </View>

                  {isSelected ? (
                    <View
                      style={[
                        styles.selectedBadge,
                        { backgroundColor: colors.primary },
                      ]}
                    >
                      <VectorIcon
                        name="check"
                        size={11}
                        color={colors.textOnPrimary}
                      />
                      <Text
                        style={[
                          styles.selectedBadgeText,
                          {
                            color: colors.textOnPrimary,
                            fontFamily: monoFontFamily,
                          },
                        ]}
                      >
                        SELECTED
                      </Text>
                    </View>
                  ) : null}
                </View>

                <Pressable
                  onPress={() => openEditProjectModal(project)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit project ${project.name}`}
                  style={[
                    styles.iconActionBtn,
                    {
                      backgroundColor: colors.background,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <VectorIcon
                    name="edit"
                    size={15}
                    color={colors.textSecondary}
                  />
                </Pressable>
              </View>

              {/* Project Name & Description */}
              <Pressable
                onPress={() => handleSelectProject(project, false)}
                style={styles.cardBodyTouch}
              >
                <Text style={[styles.projectName, { color: colors.text }]}>
                  {project.name}
                </Text>

                {project.description ? (
                  <Text
                    numberOfLines={2}
                    style={[
                      styles.projectDesc,
                      { color: colors.textSecondary },
                    ]}
                  >
                    {project.description}
                  </Text>
                ) : (
                  <Text
                    style={[styles.projectDescEmpty, { color: colors.textMuted }]}
                  >
                    No description provided.
                  </Text>
                )}

                {/* Metadata Chips */}
                <View style={styles.metaRow}>
                  {project.type ? (
                    <View
                      style={[
                        styles.metaPill,
                        {
                          backgroundColor: colors.background,
                          borderColor: colors.border,
                        },
                      ]}
                    >
                      <VectorIcon
                        name="layers"
                        size={12}
                        color={colors.primary}
                      />
                      <Text
                        style={[
                          styles.metaPillText,
                          { color: colors.textSecondary },
                        ]}
                      >
                        {project.type}
                      </Text>
                    </View>
                  ) : null}

                  {project.version ? (
                    <View
                      style={[
                        styles.metaPill,
                        {
                          backgroundColor: colors.background,
                          borderColor: colors.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.metaPillText,
                          {
                            color: colors.textSecondary,
                            fontFamily: monoFontFamily,
                          },
                        ]}
                      >
                        {project.version}
                      </Text>
                    </View>
                  ) : null}

                  {project.environment ? (
                    <View
                      style={[
                        styles.metaPill,
                        {
                          backgroundColor: colors.background,
                          borderColor: colors.border,
                        },
                      ]}
                    >
                      <VectorIcon
                        name="globe"
                        size={12}
                        color={colors.textMuted}
                      />
                      <Text
                        style={[
                          styles.metaPillText,
                          { color: colors.textSecondary },
                        ]}
                      >
                        {project.environment}
                      </Text>
                    </View>
                  ) : null}

                  {updatedLabel ? (
                    <View
                      style={[
                        styles.metaPill,
                        {
                          backgroundColor: colors.background,
                          borderColor: colors.border,
                        },
                      ]}
                    >
                      <VectorIcon
                        name="calendar"
                        size={12}
                        color={colors.textMuted}
                      />
                      <Text
                        style={[
                          styles.metaPillText,
                          { color: colors.textMuted },
                        ]}
                      >
                        Updated {updatedLabel}
                      </Text>
                    </View>
                  ) : null}
                </View>

                {/* Tags */}
                {Array.isArray(project.tags) && project.tags.length > 0 ? (
                  <View style={styles.tagsRow}>
                    {project.tags.slice(0, 5).map((tag) => (
                      <View
                        key={tag}
                        style={[
                          styles.tagBadge,
                          { backgroundColor: colors.primarySoft },
                        ]}
                      >
                        <Text
                          style={[
                            styles.tagText,
                            {
                              color: colors.primary,
                              fontFamily: monoFontFamily,
                            },
                          ]}
                        >
                          #{tag}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}

                {/* Project-level statistics when supported by actual data */}
                {stats ? (
                  <View
                    style={[
                      styles.statsStrip,
                      { borderTopColor: colors.border },
                    ]}
                  >
                    <Text
                      style={[
                        styles.statsItemText,
                        {
                          color: colors.textSecondary,
                          fontFamily: monoFontFamily,
                        },
                      ]}
                    >
                      {stats.suiteCount} Suites · {stats.testCaseCount} Cases ·{' '}
                      {stats.defectCount} Defects
                    </Text>
                  </View>
                ) : null}
              </Pressable>

              {/* Card Bottom Actions */}
              <View
                style={[
                  styles.cardFooterRow,
                  { borderTopColor: colors.border },
                ]}
              >
                <Pressable
                  onPress={() => handleSelectProject(project, false)}
                  style={[
                    styles.selectBtn,
                    {
                      backgroundColor: isSelected
                        ? colors.primary
                        : colors.primarySoft,
                      borderColor: colors.primary,
                    },
                  ]}
                >
                  <VectorIcon
                    name={isSelected ? 'check' : 'chevron-right'}
                    size={15}
                    color={isSelected ? colors.textOnPrimary : colors.primary}
                  />
                  <Text
                    style={[
                      styles.selectBtnText,
                      {
                        color: isSelected
                          ? colors.textOnPrimary
                          : colors.primary,
                      },
                    ]}
                  >
                    {isSelected ? 'Active Project — Open' : 'Select Project'}
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => handleSelectProject(project, true)}
                  style={[
                    styles.detailsBtn,
                    {
                      backgroundColor: colors.background,
                      borderColor: colors.borderStrong,
                    },
                  ]}
                >
                  <VectorIcon name="info" size={15} color={colors.text} />
                  <Text style={[styles.detailsBtnText, { color: colors.text }]}>
                    Details
                  </Text>
                </Pressable>
              </View>
            </View>
          );
        })}
      </ScrollView>

      {/* Create / Edit Project Modal */}
      <ProjectFormModal
        visible={isFormModalOpen}
        initialProject={editingProject}
        onClose={() => setIsFormModalOpen(false)}
        onSuccess={handleFormSuccess}
      />
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
    paddingBottom: 28,
    maxWidth: 920,
    width: '100%',
    alignSelf: 'center',
    gap: 14,
  },
  heroCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  heroTopRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  heroTitleCol: {
    flex: 1,
  },
  kicker: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.3,
    marginBottom: 4,
  },
  heroSub: {
    fontSize: 13,
    lineHeight: 19,
  },
  userStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    gap: 8,
  },
  userStripInfo: {
    flex: 1,
    minWidth: 150,
  },
  userStripName: {
    fontSize: 13,
    fontWeight: '700',
  },
  userStripEmail: {
    fontSize: 11,
    marginTop: 2,
  },
  signOutMiniBtn: {
    minHeight: 34,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signOutMiniText: {
    fontSize: 12,
    fontWeight: '700',
  },
  heroActionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  primaryActionBtn: {
    flex: 1,
    minWidth: 130,
    minHeight: 44,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    gap: 8,
  },
  primaryActionText: {
    fontSize: 14,
    fontWeight: '700',
  },
  secondaryActionBtn: {
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    gap: 6,
  },
  secondaryActionText: {
    fontSize: 13,
    fontWeight: '700',
  },
  activeSelectionBanner: {
    borderRadius: 16,
    borderWidth: 1.5,
    padding: 16,
    gap: 8,
  },
  activeBannerTop: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  activeBannerBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  activeCheckCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeBannerKicker: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  activeBannerStatus: {
    fontSize: 11,
    fontWeight: '700',
  },
  activeBannerTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  activeBannerDesc: {
    fontSize: 13,
    lineHeight: 18,
  },
  activeBannerBtnRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  activeBannerPrimaryBtn: {
    flex: 1,
    minWidth: 140,
    minHeight: 42,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    gap: 6,
  },
  activeBannerPrimaryText: {
    fontSize: 13,
    fontWeight: '700',
  },
  activeBannerSecondaryBtn: {
    minHeight: 42,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    gap: 6,
  },
  activeBannerSecondaryText: {
    fontSize: 13,
    fontWeight: '700',
  },
  filterCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    minHeight: 44,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 8,
  },
  clearSearchBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusFilterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  filterChip: {
    flex: 1,
    minWidth: 74,
    minHeight: 36,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '700',
  },
  errorCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 10,
  },
  errorHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  errorTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  errorMessage: {
    fontSize: 13,
    lineHeight: 19,
  },
  retryBtn: {
    alignSelf: 'flex-start',
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  retryBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  stateCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 24,
    alignItems: 'center',
    gap: 10,
  },
  emptyIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  stateTitle: {
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
  stateSub: {
    fontSize: 12,
    textAlign: 'center',
  },
  stateDesc: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    maxWidth: 440,
  },
  emptyCreateBtn: {
    marginTop: 6,
    minHeight: 46,
    paddingHorizontal: 18,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  emptyCreateBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
  projectCard: {
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  cardTopRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  cardBadgesWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    flex: 1,
    minWidth: 150,
  },
  statusBadge: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  selectedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 4,
  },
  selectedBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  iconActionBtn: {
    width: 36,
    height: 36,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBodyTouch: {
    gap: 8,
  },
  projectName: {
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 24,
  },
  projectDesc: {
    fontSize: 13,
    lineHeight: 19,
  },
  projectDescEmpty: {
    fontSize: 13,
    fontStyle: 'italic',
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 2,
  },
  metaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    gap: 5,
  },
  metaPillText: {
    fontSize: 11,
    fontWeight: '600',
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  tagBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  tagText: {
    fontSize: 11,
    fontWeight: '600',
  },
  statsStrip: {
    borderTopWidth: 1,
    paddingTop: 8,
    marginTop: 2,
  },
  statsItemText: {
    fontSize: 12,
    fontWeight: '600',
  },
  cardFooterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    borderTopWidth: 1,
    paddingTop: 12,
    gap: 8,
  },
  selectBtn: {
    flex: 1,
    minWidth: 145,
    minHeight: 42,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    gap: 6,
  },
  selectBtnText: {
    fontSize: 12.5,
    fontWeight: '700',
  },
  detailsBtn: {
    minHeight: 42,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  detailsBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
});

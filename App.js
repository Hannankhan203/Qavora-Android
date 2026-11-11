import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  ScrollView,
  Animated,
  useWindowDimensions,
  BackHandler,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { ThemeProvider, useTheme, monoFontFamily } from './src/theme/theme';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { ProjectProvider, useProjects } from './src/context/ProjectContext';
import {
  WorkspaceProvider,
  useWorkspace,
  NAVIGATION_DESTINATIONS,
} from './src/context/WorkspaceContext';
import AuthScreen from './src/components/AuthScreen';
import ProjectSelectionScreen from './src/components/ProjectSelectionScreen';
import ProjectDetailsScreen from './src/components/ProjectDetailsScreen';
import DashboardScreen from './src/components/DashboardScreen';
import ChecklistsScreen from './src/components/ChecklistsScreen';
import TestCasesScreen from './src/components/TestCasesScreen';
import TestRunsScreen from './src/components/TestRunsScreen';
import DefectsScreen from './src/components/DefectsScreen';
import ProfileSettingsScreen from './src/components/ProfileSettingsScreen';
import VectorIcon from './src/components/VectorIcon';
import { startConnectivityMonitoring } from './src/services/offlineSyncService';

export { NAVIGATION_DESTINATIONS };

const BOTTOM_TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'testcases', label: 'Test Cases' },
  { id: 'testruns', label: 'Test Runs' },
  { id: 'defects', label: 'Defects' },
  { id: 'profile', label: 'Profile' },
];

const SCREEN_TITLES = {
  dashboard: 'QA Overview',
  testcases: 'Test Cases',
  testruns: 'Test Runs',
  defects: 'Defects',
  profile: 'Profile & Settings',
};

const DESTINATION_LABELS = {
  [NAVIGATION_DESTINATIONS.CREATE_CHECKLIST]: 'Create QA Checklist',
  [NAVIGATION_DESTINATIONS.MY_CHECKLISTS]: 'My QA Checklist',
  [NAVIGATION_DESTINATIONS.QA_TEST_RUNNER]: 'QA Test Runner',
  [NAVIGATION_DESTINATIONS.DASHBOARD]: 'QA Overview',
  [NAVIGATION_DESTINATIONS.MY_PROJECTS]: 'My Projects',
  [NAVIGATION_DESTINATIONS.PROJECT_DETAILS]: 'Project Details',
  [NAVIGATION_DESTINATIONS.TEST_PLANS]: 'Test Plans',
  [NAVIGATION_DESTINATIONS.TEST_CASES]: 'Test Cases',
  [NAVIGATION_DESTINATIONS.TEST_SUITES]: 'Test Suites',
  [NAVIGATION_DESTINATIONS.TEST_EXECUTION]: 'Test Execution',
  [NAVIGATION_DESTINATIONS.DEFECTS]: 'Defects',
  [NAVIGATION_DESTINATIONS.REPORTS]: 'Reports & Analytics',
  [NAVIGATION_DESTINATIONS.DATA_MANAGEMENT]: 'Data Management',
  [NAVIGATION_DESTINATIONS.SETTINGS]: 'Profile & Settings',
};

function QavoraQAShell() {
  const { colors, isDark, toggleTheme } = useTheme();
  const { selectedProject, syncStatus, isOffline } = useProjects();
  const {
    activeTab,
    setActiveTab,
    dashboardSubTab,
    setDashboardSubTab,
    projectViewMode,
    setProjectViewMode,
    testCasesSubTab,
    setTestCasesSubTab,
    testRunsViewMode,
    setTestRunsViewMode,
    executingTestCaseId,
    setExecutingTestCaseId,
    activeChecklistId,
    setActiveChecklistId,
    checklistCreateModalOpen,
    setChecklistCreateModalOpen,
    checklistCreateTemplateId,
    setChecklistCreateTemplateId,
    profileSubView,
    setProfileSubView,
    checklists,
    openDashboardOverview,
    openProjectSelection,
    openProjectDetails,
    openChecklistsView,
    openCreateChecklistView,
    openChecklistRunnerView,
    openDataManagementView,
    openSettingsView,
    openReportsView,
    openTestPlansView,
    openTestCasesView,
    openTestSuitesView,
    openTestExecutionView,
    openDefectsView,
    navigateToDestination,
    metrics,
    selectedTestCaseId,
    setSelectedTestCaseId,
    selectedTestRunId,
    setSelectedTestRunId,
    selectedDefectId,
    setSelectedDefectId,
    toast,
    showToast,
    dismissToast,
  } = useWorkspace();

  const { width: viewportWidth } = useWindowDimensions();
  const drawerWidth = Math.min(
    304,
    Math.max(264, Math.round((viewportWidth || 360) * 0.82))
  );
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isDrawerRendered, setIsDrawerRendered] = useState(false);
  const drawerAnim = useRef(new Animated.Value(0)).current;

  const openDrawer = useCallback(() => {
    setIsDrawerRendered(true);
    setIsDrawerOpen(true);
    Animated.timing(drawerAnim, {
      toValue: 1,
      duration: 210,
      useNativeDriver: true,
    }).start();
  }, [drawerAnim]);

  const closeDrawer = useCallback(() => {
    setIsDrawerOpen(false);
    Animated.timing(drawerAnim, {
      toValue: 0,
      duration: 180,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setIsDrawerRendered(false);
      }
    });
  }, [drawerAnim]);

  const toggleDrawer = useCallback(() => {
    if (isDrawerOpen) {
      closeDrawer();
    } else {
      openDrawer();
    }
  }, [isDrawerOpen, closeDrawer, openDrawer]);

  // Allow account-level Checklists and Profile/Settings/Data Management even when selectedProject is null
  const canViewWithoutProject =
    projectViewMode === 'checklists' ||
    (projectViewMode === 'workspace' &&
      (activeTab === 'profile' ||
        (activeTab === 'dashboard' && dashboardSubTab === 'checklists')));

  const effectiveViewMode =
    !selectedProject && !canViewWithoutProject
      ? 'selection'
      : !selectedProject && projectViewMode === 'details'
      ? 'selection'
      : projectViewMode;

  const isChecklistsActive =
    effectiveViewMode === 'checklists' ||
    (effectiveViewMode === 'workspace' &&
      activeTab === 'dashboard' &&
      dashboardSubTab === 'checklists');

  // Centralized derivation of the active canonical destination across all 11 destinations
  const activeDestination = useMemo(() => {
    if (isChecklistsActive) {
      if (checklistCreateModalOpen) {
        return NAVIGATION_DESTINATIONS.CREATE_CHECKLIST;
      }
      if (activeChecklistId) {
        return NAVIGATION_DESTINATIONS.QA_TEST_RUNNER;
      }
      return NAVIGATION_DESTINATIONS.MY_CHECKLISTS;
    }

    if (effectiveViewMode === 'selection') {
      return NAVIGATION_DESTINATIONS.MY_PROJECTS;
    }

    if (effectiveViewMode === 'details') {
      return NAVIGATION_DESTINATIONS.PROJECT_DETAILS;
    }

    if (activeTab === 'dashboard') {
      if (dashboardSubTab === 'reports') {
        return NAVIGATION_DESTINATIONS.REPORTS;
      }
      return NAVIGATION_DESTINATIONS.DASHBOARD;
    }

    if (activeTab === 'testcases') {
      if (testCasesSubTab === 'plan') {
        return NAVIGATION_DESTINATIONS.TEST_PLANS;
      }
      if (testCasesSubTab === 'suites') {
        return NAVIGATION_DESTINATIONS.TEST_SUITES;
      }
      return NAVIGATION_DESTINATIONS.TEST_CASES;
    }

    if (activeTab === 'testruns') {
      return NAVIGATION_DESTINATIONS.TEST_EXECUTION;
    }

    if (activeTab === 'defects') {
      return NAVIGATION_DESTINATIONS.DEFECTS;
    }

    if (activeTab === 'profile') {
      if (profileSubView === 'data') {
        return NAVIGATION_DESTINATIONS.DATA_MANAGEMENT;
      }
      return NAVIGATION_DESTINATIONS.SETTINGS;
    }

    return NAVIGATION_DESTINATIONS.DASHBOARD;
  }, [
    isChecklistsActive,
    checklistCreateModalOpen,
    activeChecklistId,
    effectiveViewMode,
    activeTab,
    dashboardSubTab,
    testCasesSubTab,
    profileSubView,
  ]);

  // Consistent Android Hardware Back Navigation Flow across all top-level and nested destinations
  const handleNavigateBack = useCallback(() => {
    // 0. Open Global Navigation Drawer -> close drawer first
    if (isDrawerOpen) {
      closeDrawer();
      return true;
    }

    // 1. Nested Create Checklist Modal inside Checklists -> return to My QA Checklist / Runner
    if (isChecklistsActive && checklistCreateModalOpen) {
      setChecklistCreateModalOpen(false);
      return true;
    }

    // 2. Nested QA Test Runner (activeChecklistId) -> return to My QA Checklist library
    if (isChecklistsActive && activeChecklistId) {
      setActiveChecklistId(null);
      return true;
    }

    // 3. Top-level Checklists view -> return to Workspace Overview (if project selected) or My Projects
    if (effectiveViewMode === 'checklists') {
      if (selectedProject) {
        setProjectViewMode('workspace');
        setDashboardSubTab('overview');
      } else {
        setProjectViewMode('selection');
        setDashboardSubTab('overview');
      }
      return true;
    }

    // 4. Project Details view -> return to Workspace (if project selected) or My Projects
    if (effectiveViewMode === 'details') {
      if (selectedProject) {
        setProjectViewMode('workspace');
      } else {
        setProjectViewMode('selection');
      }
      return true;
    }

    // 5. My Projects selection view (when a project is already active) -> return to Workspace
    if (effectiveViewMode === 'selection' && selectedProject) {
      setProjectViewMode('workspace');
      return true;
    }

    // 6. Step-by-Step Test Execution Runner Modal inside Test Runs -> close modal back to Test Runs
    if (
      effectiveViewMode === 'workspace' &&
      activeTab === 'testruns' &&
      executingTestCaseId
    ) {
      setExecutingTestCaseId(null);
      return true;
    }

    // 7. Open Test Case Detail Modal -> close modal
    if (selectedTestCaseId) {
      setSelectedTestCaseId(null);
      return true;
    }

    // 8. Open Defect Detail Modal -> close modal
    if (selectedDefectId) {
      setSelectedDefectId(null);
      return true;
    }

    // 9. Workspace view without a selected project (e.g. Profile/Data Management) -> return to My Projects
    if (!selectedProject && effectiveViewMode === 'workspace') {
      setProfileSubView('all');
      setProjectViewMode('selection');
      return true;
    }

    // 10. Nested Dashboard sub-tabs (Reports or embedded Checklists) -> return to QA Dashboard Overview
    if (
      activeTab === 'dashboard' &&
      (dashboardSubTab === 'reports' || dashboardSubTab === 'checklists')
    ) {
      setDashboardSubTab('overview');
      return true;
    }

    // 11. Nested Test Cases sub-tabs (Test Plans or Test Suites) -> return to Test Cases list
    if (
      activeTab === 'testcases' &&
      (testCasesSubTab === 'plan' || testCasesSubTab === 'suites')
    ) {
      setTestCasesSubTab('cases');
      return true;
    }

    // 12. Nested Test Execution History view -> return to Test Runs view
    if (activeTab === 'testruns' && testRunsViewMode === 'history') {
      setTestRunsViewMode('runs');
      return true;
    }

    // 13. Nested Data Management section inside Profile -> return to Settings / Profile overview
    if (activeTab === 'profile' && profileSubView === 'data') {
      setProfileSubView('settings');
      return true;
    }

    // 14. Non-Dashboard primary workspace tabs -> return to Dashboard (or My Projects if no project)
    if (activeTab !== 'dashboard') {
      setProfileSubView('all');
      if (selectedProject) {
        setActiveTab('dashboard');
      } else {
        setProjectViewMode('selection');
      }
      return true;
    }

    return false;
  }, [
    isChecklistsActive,
    checklistCreateModalOpen,
    activeChecklistId,
    effectiveViewMode,
    selectedProject,
    activeTab,
    executingTestCaseId,
    selectedTestCaseId,
    selectedDefectId,
    dashboardSubTab,
    testCasesSubTab,
    testRunsViewMode,
    profileSubView,
    isDrawerOpen,
    closeDrawer,
    setChecklistCreateModalOpen,
    setActiveChecklistId,
    setProjectViewMode,
    setDashboardSubTab,
    setExecutingTestCaseId,
    setSelectedTestCaseId,
    setSelectedDefectId,
    setProfileSubView,
    setTestCasesSubTab,
    setTestRunsViewMode,
    setActiveTab,
  ]);

  // Global Navigation Drawer Sections & All 11 Canonical Destinations
  const drawerSections = useMemo(
    () => [
      {
        id: 'qa_checklists',
        title: 'QA Checklists',
        items: [
          {
            id: NAVIGATION_DESTINATIONS.CREATE_CHECKLIST,
            label: 'Create QA Checklist',
            icon: 'plus',
            isActive:
              activeDestination === NAVIGATION_DESTINATIONS.CREATE_CHECKLIST,
            nestedBadge: null,
            onSelect: () => openCreateChecklistView('none'),
          },
          {
            id: NAVIGATION_DESTINATIONS.MY_CHECKLISTS,
            label: 'My QA Checklist',
            icon: 'clipboard',
            isActive:
              activeDestination === NAVIGATION_DESTINATIONS.MY_CHECKLISTS,
            nestedBadge:
              Array.isArray(checklists) && checklists.length > 0
                ? String(checklists.length)
                : null,
            onSelect: () => openChecklistsView({ keepRunner: false }),
          },
          {
            id: NAVIGATION_DESTINATIONS.QA_TEST_RUNNER,
            label: 'QA Test Runner',
            icon: 'check-circle',
            isActive:
              activeDestination === NAVIGATION_DESTINATIONS.QA_TEST_RUNNER,
            nestedBadge:
              activeDestination === NAVIGATION_DESTINATIONS.QA_TEST_RUNNER
                ? 'Active'
                : null,
            onSelect: () => openChecklistRunnerView(),
          },
        ],
      },
      {
        id: 'project_workspace',
        title: 'Project Workspace',
        items: [
          {
            id: NAVIGATION_DESTINATIONS.DASHBOARD,
            label: 'Dashboard',
            icon: 'globe',
            isActive: activeDestination === NAVIGATION_DESTINATIONS.DASHBOARD,
            nestedBadge:
              selectedProject &&
              activeDestination === NAVIGATION_DESTINATIONS.DASHBOARD
                ? `${metrics.passRate}%`
                : null,
            onSelect: () => openDashboardOverview(),
          },
          {
            id: NAVIGATION_DESTINATIONS.MY_PROJECTS,
            label: 'My Projects',
            icon: 'folder',
            isActive:
              activeDestination === NAVIGATION_DESTINATIONS.MY_PROJECTS ||
              activeDestination === NAVIGATION_DESTINATIONS.PROJECT_DETAILS,
            nestedBadge:
              activeDestination === NAVIGATION_DESTINATIONS.PROJECT_DETAILS
                ? 'Details'
                : null,
            onSelect: () => openProjectSelection(),
          },
          {
            id: NAVIGATION_DESTINATIONS.TEST_PLANS,
            label: 'Test Plans',
            icon: 'layers',
            isActive:
              activeDestination === NAVIGATION_DESTINATIONS.TEST_PLANS ||
              activeDestination === NAVIGATION_DESTINATIONS.TEST_SUITES ||
              activeDestination === NAVIGATION_DESTINATIONS.TEST_CASES,
            nestedBadge:
              activeDestination === NAVIGATION_DESTINATIONS.TEST_SUITES
                ? 'Suites'
                : activeDestination === NAVIGATION_DESTINATIONS.TEST_CASES
                ? selectedTestCaseId
                  ? 'Case Detail'
                  : 'Cases'
                : null,
            onSelect: () => openTestPlansView(),
          },
          {
            id: NAVIGATION_DESTINATIONS.TEST_EXECUTION,
            label: 'Test Execution',
            icon: 'flag',
            isActive:
              activeDestination === NAVIGATION_DESTINATIONS.TEST_EXECUTION,
            nestedBadge:
              activeDestination === NAVIGATION_DESTINATIONS.TEST_EXECUTION
                ? executingTestCaseId
                  ? 'Runner'
                  : testRunsViewMode === 'history'
                  ? 'History'
                  : 'Runs'
                : null,
            onSelect: () => openTestExecutionView(),
          },
          {
            id: NAVIGATION_DESTINATIONS.DEFECTS,
            label: 'Defects',
            icon: 'alert',
            isActive: activeDestination === NAVIGATION_DESTINATIONS.DEFECTS,
            nestedBadge:
              activeDestination === NAVIGATION_DESTINATIONS.DEFECTS &&
              selectedDefectId
                ? 'Detail'
                : selectedProject && metrics.openDefects > 0
                ? String(metrics.openDefects)
                : null,
            onSelect: () => openDefectsView(),
          },
          {
            id: NAVIGATION_DESTINATIONS.REPORTS,
            label: 'Reports',
            icon: 'file-text',
            isActive: activeDestination === NAVIGATION_DESTINATIONS.REPORTS,
            nestedBadge: null,
            onSelect: () => openReportsView(),
          },
        ],
      },
      {
        id: 'workspace_account_utilities',
        title: 'Workspace & Account Utilities',
        items: [
          {
            id: NAVIGATION_DESTINATIONS.DATA_MANAGEMENT,
            label: 'Data Management',
            icon: 'refresh',
            isActive:
              activeDestination === NAVIGATION_DESTINATIONS.DATA_MANAGEMENT,
            nestedBadge:
              syncStatus && syncStatus.conflictCount > 0
                ? `${syncStatus.conflictCount} Conflict`
                : syncStatus && syncStatus.pendingCount > 0
                ? `${syncStatus.pendingCount} Queued`
                : null,
            onSelect: () => openDataManagementView(),
          },
          {
            id: NAVIGATION_DESTINATIONS.SETTINGS,
            label: 'Settings',
            icon: 'tag',
            isActive: activeDestination === NAVIGATION_DESTINATIONS.SETTINGS,
            nestedBadge: null,
            onSelect: () => openSettingsView(),
          },
        ],
      },
    ],
    [
      activeDestination,
      checklists,
      selectedProject,
      metrics.passRate,
      metrics.openDefects,
      selectedTestCaseId,
      executingTestCaseId,
      testRunsViewMode,
      selectedDefectId,
      syncStatus,
      openCreateChecklistView,
      openChecklistsView,
      openChecklistRunnerView,
      openDashboardOverview,
      openProjectSelection,
      openTestPlansView,
      openTestExecutionView,
      openDefectsView,
      openReportsView,
      openDataManagementView,
      openSettingsView,
    ]
  );

  const handleSelectDrawerDestination = useCallback(
    (item) => {
      if (item && typeof item.onSelect === 'function') {
        item.onSelect();
      }
      closeDrawer();
    },
    [closeDrawer]
  );

  // Android Hardware Back Navigation Handler
  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      handleNavigateBack
    );
    return () => subscription.remove();
  }, [handleNavigateBack]);

  const headerSubtitle = !selectedProject
    ? isChecklistsActive
      ? activeDestination === NAVIGATION_DESTINATIONS.CREATE_CHECKLIST
        ? 'Account-Wide · Create QA Checklist'
        : activeDestination === NAVIGATION_DESTINATIONS.QA_TEST_RUNNER
        ? 'Account-Wide · QA Test Runner'
        : 'Account-Wide QA Checklists'
      : effectiveViewMode === 'workspace' && activeTab === 'profile'
      ? profileSubView === 'data'
        ? 'Account · Data Management'
        : 'Account Settings & Data Management'
      : 'Select or Create a Project'
    : effectiveViewMode === 'selection'
    ? `Switching Project · Active: ${selectedProject.name}`
    : effectiveViewMode === 'details'
    ? `${selectedProject.name} · Project Details`
    : isChecklistsActive
    ? activeDestination === NAVIGATION_DESTINATIONS.CREATE_CHECKLIST
      ? `${selectedProject.name} · Create QA Checklist`
      : activeDestination === NAVIGATION_DESTINATIONS.QA_TEST_RUNNER
      ? `${selectedProject.name} · QA Test Runner`
      : `${selectedProject.name} · QA Checklists`
    : activeTab === 'dashboard' && dashboardSubTab === 'reports'
    ? `${selectedProject.name} · Reports & Analytics`
    : activeTab === 'testcases' && testCasesSubTab === 'plan'
    ? `${selectedProject.name} · Test Plans`
    : activeTab === 'testcases' && testCasesSubTab === 'suites'
    ? `${selectedProject.name} · Test Suites`
    : activeTab === 'testruns' && testRunsViewMode === 'history'
    ? `${selectedProject.name} · Execution History`
    : activeTab === 'profile' && profileSubView === 'data'
    ? `${selectedProject.name} · Data Management`
    : `${selectedProject.name} · ${
         DESTINATION_LABELS[activeDestination] ||
        SCREEN_TITLES[activeTab] ||
        'QA Manager'
      }`;

  return (
    <SafeAreaView
      edges={['top', 'bottom', 'left', 'right']}
      style={[styles.safeRoot, { backgroundColor: colors.background }]}
    >
      <StatusBar style={colors.statusBar} />

      {/* Contextual Mobile Top Bar */}
      <View
        style={[
          styles.topBar,
          { backgroundColor: colors.surface, borderBottomColor: colors.border },
        ]}
      >
        <View style={styles.topBarInner}>
          <Pressable
            onPress={toggleDrawer}
            accessibilityRole="button"
            accessibilityLabel={
              isDrawerOpen
                ? 'Close navigation drawer'
                : 'Open navigation drawer'
            }
            style={[
              styles.drawerMenuBtn,
              {
                backgroundColor: isDrawerOpen
                  ? colors.primary
                  : colors.surfaceAccent,
                borderColor: colors.primary,
              },
            ]}
          >
            <VectorIcon
              name={isDrawerOpen ? 'close' : 'menu'}
              size={16}
              color={isDrawerOpen ? colors.textOnPrimary : colors.primary}
            />
          </Pressable>

          <Pressable
            onPress={() => {
              if (selectedProject) {
                setProjectViewMode(
                  effectiveViewMode === 'details' ? 'workspace' : 'details'
                );
              } else {
                setProjectViewMode('selection');
              }
            }}
            style={styles.brandLockup}
          >
            <View style={[styles.brandBadge, { backgroundColor: colors.primary }]}>
              <Text style={[styles.brandBadgeText, { color: colors.textOnPrimary }]}>
                Q
              </Text>
            </View>
            <View style={styles.brandTextWrap}>
              <Text
                numberOfLines={1}
                style={[styles.brandTitle, { color: colors.text }]}
              >
                {selectedProject ? selectedProject.name : 'Qavora'}
              </Text>
              <Text
                numberOfLines={1}
                style={[
                  styles.screenSubtitle,
                  { color: colors.textMuted, fontFamily: monoFontFamily },
                ]}
              >
                {headerSubtitle}
              </Text>
            </View>
          </Pressable>

          <View style={styles.topRightUtilities}>
            <Pressable
              onPress={() => {
                if (isChecklistsActive) {
                  if (activeChecklistId || checklistCreateModalOpen) {
                    setChecklistCreateModalOpen(false);
                    setActiveChecklistId(null);
                  } else if (selectedProject) {
                    setProjectViewMode('workspace');
                    setDashboardSubTab('overview');
                  } else {
                    setProjectViewMode('selection');
                    setDashboardSubTab('overview');
                  }
                } else {
                  openChecklistsView({ keepRunner: true });
                }
              }}
              style={[
                styles.projectSwitchBtn,
                {
                  backgroundColor: isChecklistsActive
                    ? colors.primary
                    : colors.surfaceAccent,
                  borderColor: colors.primary,
                },
              ]}
            >
              <VectorIcon
                name="clipboard"
                size={14}
                color={
                  isChecklistsActive ? colors.textOnPrimary : colors.primary
                }
              />
              <Text
                style={[
                  styles.projectSwitchBtnText,
                  {
                    color: isChecklistsActive
                      ? colors.textOnPrimary
                      : colors.primary,
                  },
                ]}
              >
                Checklists
              </Text>
            </Pressable>

            <Pressable
              onPress={() => {
                if (effectiveViewMode === 'selection' && selectedProject) {
                  setProjectViewMode('workspace');
                } else {
                  setProjectViewMode('selection');
                }
              }}
              style={[
                styles.projectSwitchBtn,
                {
                  backgroundColor:
                    effectiveViewMode === 'selection'
                      ? colors.primary
                      : colors.surfaceAccent,
                  borderColor: colors.primary,
                },
              ]}
            >
              <VectorIcon
                name="folder"
                size={14}
                color={
                  effectiveViewMode === 'selection'
                    ? colors.textOnPrimary
                    : colors.primary
                }
              />
              <Text
                style={[
                  styles.projectSwitchBtnText,
                  {
                    color:
                      effectiveViewMode === 'selection'
                        ? colors.textOnPrimary
                        : colors.primary,
                  },
                ]}
              >
                Projects
              </Text>
            </Pressable>

            {selectedProject && effectiveViewMode === 'workspace' ? (
              <Text
                style={[
                  styles.passRatePill,
                  { color: colors.success, fontFamily: monoFontFamily },
                ]}
              >
                {metrics.passRate}% Pass
              </Text>
            ) : null}

            {(isOffline ||
              (syncStatus &&
                (syncStatus.totalQueued > 0 ||
                  syncStatus.conflictCount > 0 ||
                  syncStatus.isSyncing))) ? (
              <Pressable
                onPress={openDataManagementView}
                style={[
                  styles.syncPillBtn,
                  {
                    backgroundColor:
                      syncStatus && syncStatus.conflictCount > 0
                        ? colors.dangerSoft
                        : isOffline
                        ? colors.surfaceAccent
                        : colors.surfaceAccent,
                    borderColor:
                      syncStatus && syncStatus.conflictCount > 0
                        ? colors.danger
                        : isOffline
                        ? colors.warning
                        : colors.primary,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.syncPillText,
                    {
                      color:
                        syncStatus && syncStatus.conflictCount > 0
                          ? colors.danger
                          : isOffline
                          ? colors.warning
                          : colors.primary,
                      fontFamily: monoFontFamily,
                    },
                  ]}
                >
                  {syncStatus && syncStatus.conflictCount > 0
                    ? `Conflict (${syncStatus.conflictCount})`
                    : isOffline
                    ? `Offline${
                        syncStatus && syncStatus.pendingCount > 0
                          ? ` (${syncStatus.pendingCount})`
                          : ''
                      }`
                    : syncStatus && syncStatus.isSyncing
                    ? 'Syncing...'
                    : `Sync (${syncStatus.pendingCount})`}
                </Text>
              </Pressable>
            ) : null}

            <Pressable
              onPress={toggleTheme}
              style={[
                styles.themeBtn,
                {
                  backgroundColor: colors.surfaceAccent,
                  borderColor: colors.primary,
                },
              ]}
            >
              <Text style={[styles.themeBtnText, { color: colors.primary }]}>
                {isDark ? 'Light' : 'Dark'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>

      {/* Non-Blocking Feedback Toast */}
      {toast ? (
        <Pressable
          onPress={dismissToast}
          style={[
            styles.toastBanner,
            {
              backgroundColor: colors.surfaceElevated,
              borderBottomColor:
                toast.tone === 'danger'
                  ? colors.danger
                  : toast.tone === 'success'
                  ? colors.success
                  : colors.primary,
            },
          ]}
        >
          <Text
            numberOfLines={2}
            style={[
              styles.toastText,
              { color: colors.text, fontFamily: monoFontFamily },
            ]}
          >
            {toast.message}
          </Text>
          <Text style={[styles.toastClose, { color: colors.textMuted }]}>OK</Text>
        </Pressable>
      ) : null}

      {/* Active Viewport */}
      <View style={styles.mainViewport}>
        {effectiveViewMode === 'selection' ? (
          <ProjectSelectionScreen
            onOpenWorkspace={() => {
              if (selectedProject) {
                setProjectViewMode('workspace');
              } else {
                setProjectViewMode('selection');
              }
            }}
            onOpenProjectDetails={() => setProjectViewMode('details')}
          />
        ) : effectiveViewMode === 'details' && selectedProject ? (
          <ProjectDetailsScreen
            onBackToWorkspace={() => setProjectViewMode('workspace')}
            onSwitchProject={() => setProjectViewMode('selection')}
            onProjectDeleted={() => setProjectViewMode('selection')}
          />
        ) : effectiveViewMode === 'checklists' ||
          (!selectedProject &&
            effectiveViewMode === 'workspace' &&
            activeTab === 'dashboard' &&
            dashboardSubTab === 'checklists') ? (
          <ChecklistsScreen
            activeChecklistId={activeChecklistId}
            onChangeActiveChecklistId={setActiveChecklistId}
            createModalOpen={checklistCreateModalOpen}
            onChangeCreateModalOpen={setChecklistCreateModalOpen}
            initialTemplateId={checklistCreateTemplateId}
            onResetTemplateId={() => setChecklistCreateTemplateId('none')}
            onBackToOverview={() => {
              setChecklistCreateModalOpen(false);
              setActiveChecklistId(null);
              if (selectedProject) {
                setProjectViewMode('workspace');
                setDashboardSubTab('overview');
              } else {
                setProjectViewMode('selection');
                setDashboardSubTab('overview');
              }
            }}
          />
        ) : (
          <>
            {activeTab === 'dashboard' &&
              (selectedProject ? (
                <DashboardScreen
                  onNavigateToDestination={navigateToDestination}
                />
              ) : (
                <ProjectSelectionScreen
                  onOpenWorkspace={() => setProjectViewMode('workspace')}
                  onOpenProjectDetails={() => setProjectViewMode('details')}
                />
              ))}
            {activeTab === 'testcases' &&
              (selectedProject ? (
                <TestCasesScreen
                  subTab={testCasesSubTab}
                  onChangeSubTab={setTestCasesSubTab}
                />
              ) : (
                <ProjectSelectionScreen
                  onOpenWorkspace={() => setProjectViewMode('workspace')}
                  onOpenProjectDetails={() => setProjectViewMode('details')}
                />
              ))}
            {activeTab === 'testruns' &&
              (selectedProject ? (
                <TestRunsScreen
                  viewMode={testRunsViewMode}
                  onChangeViewMode={setTestRunsViewMode}
                  executingCaseId={executingTestCaseId}
                  onChangeExecutingCaseId={setExecutingTestCaseId}
                />
              ) : (
                <ProjectSelectionScreen
                  onOpenWorkspace={() => setProjectViewMode('workspace')}
                  onOpenProjectDetails={() => setProjectViewMode('details')}
                />
              ))}
            {activeTab === 'defects' &&
              (selectedProject ? (
                <DefectsScreen />
              ) : (
                <ProjectSelectionScreen
                  onOpenWorkspace={() => setProjectViewMode('workspace')}
                  onOpenProjectDetails={() => setProjectViewMode('details')}
                />
              ))}
            {activeTab === 'profile' && (
              <ProfileSettingsScreen
                activeSection={profileSubView}
                onChangeSection={setProfileSubView}
              />
            )}
          </>
        )}
      </View>

      {/* Primary Mobile Bottom Navigation Bar */}
      <View
        style={[
          styles.bottomBar,
          { backgroundColor: colors.surface, borderTopColor: colors.border },
        ]}
      >
        <View style={styles.bottomBarInner}>
          {BOTTOM_TABS.map((tab) => {
            const active =
              effectiveViewMode === 'workspace' &&
              activeTab === tab.id &&
              (tab.id === 'profile' || Boolean(selectedProject)) &&
              (tab.id !== 'dashboard' || dashboardSubTab === 'overview');
            const showOpenBugCount =
              Boolean(selectedProject) &&
              tab.id === 'defects' &&
              metrics.openDefects > 0;

            return (
              <Pressable
                key={tab.id}
                onPress={() => {
                  if (tab.id === 'profile') {
                    openSettingsView();
                    return;
                  }
                  if (!selectedProject) {
                    setProjectViewMode('selection');
                    if (showToast) {
                      showToast(
                        `Select or create a QA project first to open ${tab.label}.`,
                        'info'
                      );
                    }
                    return;
                  }
                  setProjectViewMode('workspace');
                  setActiveTab(tab.id, {
                    clearSelectedCase: true,
                    clearSelectedDefect: true,
                  });
                  if (tab.id === 'dashboard') {
                    setDashboardSubTab('overview');
                  } else if (tab.id === 'testcases') {
                    setTestCasesSubTab('cases');
                  } else if (tab.id === 'testruns') {
                    setTestRunsViewMode('runs');
                  }
                }}
                style={styles.bottomTabBtn}
              >
                <Text
                  numberOfLines={1}
                  style={[
                    styles.bottomTabLabel,
                    {
                      color: active ? colors.primary : colors.textSecondary,
                      fontWeight: active ? '700' : '500',
                    },
                  ]}
                >
                  {tab.label}
                  {showOpenBugCount ? ` (${metrics.openDefects})` : ''}
                </Text>
                {active && (
                  <View
                    style={[
                      styles.activeBarIndicator,
                      { backgroundColor: colors.primary },
                    ]}
                  />
                )}
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Global Left-Side Slide-Out Navigation Drawer */}
      {(isDrawerOpen || isDrawerRendered) && (
        <View
          style={styles.drawerOverlayRoot}
          pointerEvents={isDrawerOpen ? 'auto' : 'none'}
        >
          <Animated.View
            style={[
              styles.drawerBackdrop,
              {
                backgroundColor: colors.overlay,
                opacity: drawerAnim,
              },
            ]}
          >
            <Pressable
              onPress={closeDrawer}
              accessibilityRole="button"
              accessibilityLabel="Close navigation drawer backdrop"
              style={styles.drawerBackdropTouch}
            />
          </Animated.View>

          <Animated.View
            style={[
              styles.drawerPanel,
              {
                width: drawerWidth,
                backgroundColor: colors.surface,
                borderRightColor: colors.border,
                transform: [
                  {
                    translateX: drawerAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [-drawerWidth, 0],
                    }),
                  },
                ],
              },
            ]}
          >
            {/* Drawer Header */}
            <View
              style={[
                styles.drawerHeader,
                { borderBottomColor: colors.border },
              ]}
            >
              <View style={styles.drawerBrandRow}>
                <View
                  style={[
                    styles.brandBadge,
                    { backgroundColor: colors.primary },
                  ]}
                >
                  <Text
                    style={[
                      styles.brandBadgeText,
                      { color: colors.textOnPrimary },
                    ]}
                  >
                    Q
                  </Text>
                </View>
                <View style={styles.drawerBrandTextWrap}>
                  <Text
                    numberOfLines={1}
                    style={[styles.drawerBrandTitle, { color: colors.text }]}
                  >
                    Qavora Navigation
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.drawerBrandSubtitle,
                      { color: colors.textMuted, fontFamily: monoFontFamily },
                    ]}
                  >
                    {selectedProject
                      ? `Project: ${selectedProject.name}`
                      : 'No Active Project Selected'}
                  </Text>
                </View>
                <Pressable
                  onPress={closeDrawer}
                  accessibilityRole="button"
                  accessibilityLabel="Close navigation drawer"
                  style={[
                    styles.drawerCloseBtn,
                    {
                      backgroundColor: colors.surfaceMuted,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <VectorIcon
                    name="close"
                    size={15}
                    color={colors.textSecondary}
                  />
                </Pressable>
              </View>

              {/* Active Context Pill */}
              <View
                style={[
                  styles.drawerContextBanner,
                  {
                    backgroundColor: colors.surfaceAccent,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text
                  numberOfLines={1}
                  style={[
                    styles.drawerContextText,
                    { color: colors.primary, fontFamily: monoFontFamily },
                  ]}
                >
                  Active:{' '}
                  {DESTINATION_LABELS[activeDestination] || 'QA Overview'}
                </Text>
                {selectedProject ? (
                  <Pressable
                    onPress={() => {
                      openProjectDetails();
                      closeDrawer();
                    }}
                  >
                    <Text
                      style={[
                        styles.drawerContextLink,
                        { color: colors.primary },
                      ]}
                    >
                      Project Info →
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            </View>

            {/* Drawer Sections & 11 Canonical Destinations */}
            <ScrollView
              style={styles.drawerScroll}
              contentContainerStyle={styles.drawerScrollContent}
              showsVerticalScrollIndicator={false}
            >
              {drawerSections.map((section, sectionIdx) => (
                <View
                  key={section.id}
                  style={[
                    styles.drawerSection,
                    sectionIdx > 0 && {
                      borderTopWidth: 1,
                      borderTopColor: colors.border,
                      paddingTop: 10,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.drawerSectionTitle,
                      { color: colors.textMuted, fontFamily: monoFontFamily },
                    ]}
                  >
                    {section.title.toUpperCase()}
                  </Text>

                  <View style={styles.drawerSectionItems}>
                    {section.items.map((item) => {
                      const active = Boolean(item.isActive);
                      return (
                        <Pressable
                          key={item.id}
                          onPress={() => handleSelectDrawerDestination(item)}
                          accessibilityRole="button"
                          accessibilityState={{ selected: active }}
                          accessibilityLabel={item.label}
                          style={[
                            styles.drawerItemBtn,
                            {
                              backgroundColor: active
                                ? colors.surfaceAccent
                                : 'transparent',
                              borderColor: active
                                ? colors.primary
                                : 'transparent',
                            },
                          ]}
                        >
                          {active && (
                            <View
                              style={[
                                styles.drawerActivePillBar,
                                { backgroundColor: colors.primary },
                              ]}
                            />
                          )}
                          <View
                            style={[
                              styles.drawerItemIconBox,
                              {
                                backgroundColor: active
                                  ? colors.primary
                                  : colors.surfaceMuted,
                              },
                            ]}
                          >
                            <VectorIcon
                              name={item.icon}
                              size={14}
                              color={
                                active
                                  ? colors.textOnPrimary
                                  : colors.textSecondary
                              }
                            />
                          </View>

                          <Text
                            numberOfLines={1}
                            style={[
                              styles.drawerItemLabel,
                              {
                                color: active ? colors.primary : colors.text,
                                fontWeight: active ? '700' : '500',
                              },
                            ]}
                          >
                            {item.label}
                          </Text>

                          {item.nestedBadge ? (
                            <View
                              style={[
                                styles.drawerNestedBadge,
                                {
                                  backgroundColor: active
                                    ? colors.primary
                                    : colors.surfaceMuted,
                                },
                              ]}
                            >
                              <Text
                                numberOfLines={1}
                                style={[
                                  styles.drawerNestedBadgeText,
                                  {
                                    color: active
                                      ? colors.textOnPrimary
                                      : colors.textSecondary,
                                    fontFamily: monoFontFamily,
                                  },
                                ]}
                              >
                                {item.nestedBadge}
                              </Text>
                            </View>
                          ) : null}
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ))}
            </ScrollView>

            {/* Drawer Footer */}
            <View
              style={[
                styles.drawerFooter,
                {
                  borderTopColor: colors.border,
                  backgroundColor: colors.surfaceElevated,
                },
              ]}
            >
              <Text
                numberOfLines={1}
                style={[
                  styles.drawerFooterMeta,
                  { color: colors.textMuted, fontFamily: monoFontFamily },
                ]}
              >
                {isOffline ? 'Offline Queue Active' : 'Online · Synced'}
              </Text>
              <Pressable
                onPress={toggleTheme}
                style={[
                  styles.drawerFooterThemeBtn,
                  {
                    backgroundColor: colors.surfaceAccent,
                    borderColor: colors.primary,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.drawerFooterThemeText,
                    { color: colors.primary },
                  ]}
                >
                  {isDark ? 'Switch to Light' : 'Switch to Dark'}
                </Text>
              </Pressable>
            </View>
          </Animated.View>
        </View>
      )}
    </SafeAreaView>
  );
}

function AuthRootGate() {
  const { colors } = useTheme();
  const { isAuthenticated, isRestoringSession } = useAuth();

  if (isRestoringSession) {
    return (
      <SafeAreaView
        edges={['top', 'bottom', 'left', 'right']}
        style={[
          styles.restoringContainer,
          { backgroundColor: colors.background },
        ]}
      >
        <StatusBar style={colors.statusBar} />
        <View
          style={[
            styles.restoringCard,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={[styles.restoringTitle, { color: colors.text }]}>
            Restoring Qavora Session
          </Text>
          <Text
            style={[
              styles.restoringSubtitle,
              { color: colors.textMuted, fontFamily: monoFontFamily },
            ]}
          >
            Verifying authenticated session via /api/auth/me...
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!isAuthenticated) {
    return <AuthScreen />;
  }

  return (
    <ProjectProvider>
      <WorkspaceProvider>
        <QavoraQAShell />
      </WorkspaceProvider>
    </ProjectProvider>
  );
}

export default function App() {
  useEffect(() => {
    const stopMonitoring = startConnectivityMonitoring();
    return () => {
      stopMonitoring();
    };
  }, []);

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthProvider>
          <AuthRootGate />
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeRoot: {
    flex: 1,
  },
  restoringContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  restoringCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 24,
    alignItems: 'center',
    maxWidth: 360,
    width: '100%',
    gap: 10,
  },
  restoringTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  restoringSubtitle: {
    fontSize: 12,
    textAlign: 'center',
  },
  topBar: {
    minHeight: 54,
    borderBottomWidth: 1,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  topBarInner: {
    maxWidth: 920,
    width: '100%',
    alignSelf: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: 8,
    rowGap: 6,
  },
  brandLockup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    flexShrink: 1,
    minWidth: 145,
  },
  brandBadge: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandBadgeText: {
    fontSize: 16,
    fontWeight: '700',
  },
  brandTextWrap: {
    flex: 1,
    flexShrink: 1,
  },
  brandTitle: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  screenSubtitle: {
    fontSize: 11,
  },
  topRightUtilities: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
    flexShrink: 1,
  },
  projectSwitchBtn: {
    minHeight: 34,
    paddingHorizontal: 9,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  projectSwitchBtnText: {
    fontSize: 11.5,
    fontWeight: '700',
  },
  passRatePill: {
    fontSize: 11.5,
    fontWeight: '700',
  },
  syncPillBtn: {
    minHeight: 34,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  syncPillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  themeBtn: {
    minHeight: 34,
    minWidth: 46,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  themeBtnText: {
    fontSize: 11.5,
    fontWeight: '700',
  },
  toastBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderBottomWidth: 2,
    gap: 10,
  },
  toastText: {
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
  toastClose: {
    fontSize: 12,
    fontWeight: '700',
  },
  mainViewport: {
    flex: 1,
  },
  bottomBar: {
    minHeight: 58,
    borderTopWidth: 1,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  bottomBarInner: {
    maxWidth: 920,
    width: '100%',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  bottomTabBtn: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
    position: 'relative',
  },
  bottomTabLabel: {
    fontSize: 10.5,
    textAlign: 'center',
    flexShrink: 1,
  },
  activeBarIndicator: {
    position: 'absolute',
    bottom: 4,
    width: 22,
    height: 3,
    borderRadius: 2,
  },
  drawerMenuBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  drawerOverlayRoot: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
    elevation: 24,
    flexDirection: 'row',
  },
  drawerBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  drawerBackdropTouch: {
    flex: 1,
  },
  drawerPanel: {
    height: '100%',
    borderRightWidth: 1,
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: { width: 4, height: 0 },
    shadowOpacity: 0.22,
    shadowRadius: 12,
    elevation: 24,
  },
  drawerHeader: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    gap: 8,
  },
  drawerBrandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  drawerBrandTextWrap: {
    flex: 1,
    flexShrink: 1,
  },
  drawerBrandTitle: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  drawerBrandSubtitle: {
    fontSize: 11,
    marginTop: 1,
  },
  drawerCloseBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  drawerContextBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
  },
  drawerContextText: {
    fontSize: 11,
    fontWeight: '700',
    flex: 1,
  },
  drawerContextLink: {
    fontSize: 11,
    fontWeight: '700',
  },
  drawerScroll: {
    flex: 1,
  },
  drawerScrollContent: {
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 10,
  },
  drawerSection: {
    gap: 4,
  },
  drawerSectionTitle: {
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.6,
    paddingHorizontal: 6,
    marginBottom: 2,
  },
  drawerSectionItems: {
    gap: 3,
  },
  drawerItemBtn: {
    minHeight: 40,
    borderRadius: 9,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    position: 'relative',
  },
  drawerActivePillBar: {
    position: 'absolute',
    left: 0,
    top: 8,
    bottom: 8,
    width: 3,
    borderRadius: 2,
  },
  drawerItemIconBox: {
    width: 26,
    height: 26,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  drawerItemLabel: {
    fontSize: 13,
    flex: 1,
    flexShrink: 1,
  },
  drawerNestedBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  drawerNestedBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  drawerFooter: {
    borderTopWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  drawerFooterMeta: {
    fontSize: 10.5,
    flex: 1,
  },
  drawerFooterThemeBtn: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 7,
    borderWidth: 1,
  },
  drawerFooterThemeText: {
    fontSize: 11,
    fontWeight: '700',
  },
});

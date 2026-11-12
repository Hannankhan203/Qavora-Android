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
  Keyboard,
  Platform,
  ActivityIndicator,
  PanResponder,
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
import DataManagementSection from './src/components/DataManagementSection';
import VectorIcon from './src/components/VectorIcon';
import { startConnectivityMonitoring } from './src/services/offlineSyncService';

export { NAVIGATION_DESTINATIONS };

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

const THEME_RAY_ANGLES = ['0deg', '45deg', '90deg', '-45deg'];

function ThemeToggleIcon({ isDark, iconColor, maskColor }) {
  if (isDark) {
    // 21x21 8-ray Sun with separated outer rays and solid center disc
    return (
      <View style={styles.themeIconCanvas}>
        {THEME_RAY_ANGLES.map((angle) => (
          <View
            key={angle}
            style={[
              styles.sunRayBar,
              {
                backgroundColor: iconColor,
                transform: [{ rotate: angle }],
              },
            ]}
          />
        ))}
        <View
          style={[
            styles.sunRayGapMask,
            { backgroundColor: maskColor },
          ]}
        />
        <View
          style={[
            styles.sunCoreDisc,
            { backgroundColor: iconColor },
          ]}
        />
      </View>
    );
  }

  // 21x21 Crescent Moon silhouette with offset cutout and subtle star accents
  return (
    <View style={styles.themeIconCanvas}>
      <View style={styles.moonBodyWrap}>
        <View
          style={[
            styles.moonFullDisc,
            { backgroundColor: iconColor },
          ]}
        />
        <View
          style={[
            styles.moonCutoutDisc,
            { backgroundColor: maskColor },
          ]}
        />
      </View>
      <View
        style={[
          styles.moonStarPrimary,
          { backgroundColor: iconColor },
        ]}
      />
      <View
        style={[
          styles.moonStarSecondary,
          { backgroundColor: iconColor },
        ]}
      />
    </View>
  );
}

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
  const drawerWidth = Math.max(
    220,
    Math.round((viewportWidth || 360) * 0.8)
  );
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const drawerAnim = useRef(new Animated.Value(0)).current;
  const isKeyboardOpenRef = useRef(false);
  const isDrawerOpenRef = useRef(false);
  const drawerWidthRef = useRef(drawerWidth);
  const gestureStartOpenRef = useRef(false);
  const touchStartXRef = useRef(null);
  const touchStartYRef = useRef(null);
  const gestureLockedVerticalRef = useRef(false);
  const gestureBlockedByTargetRef = useRef(false);

  useEffect(() => {
    isDrawerOpenRef.current = isDrawerOpen;
  }, [isDrawerOpen]);

  useEffect(() => {
    drawerWidthRef.current = drawerWidth;
  }, [drawerWidth]);

  useEffect(() => {
    const showEvent =
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent =
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, () => {
      isKeyboardOpenRef.current = true;
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      isKeyboardOpenRef.current = false;
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const openDrawer = useCallback(() => {
    Keyboard.dismiss();
    isKeyboardOpenRef.current = false;
    isDrawerOpenRef.current = true;
    setIsDrawerOpen(true);
    Animated.timing(drawerAnim, {
      toValue: 1,
      duration: 210,
      useNativeDriver: true,
    }).start();
  }, [drawerAnim]);

  const closeDrawer = useCallback(() => {
    isDrawerOpenRef.current = false;
    setIsDrawerOpen(false);
    Animated.timing(drawerAnim, {
      toValue: 0,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [drawerAnim]);

  const openDrawerRef = useRef(openDrawer);
  const closeDrawerRef = useRef(closeDrawer);
  useEffect(() => {
    openDrawerRef.current = openDrawer;
    closeDrawerRef.current = closeDrawer;
  }, [openDrawer, closeDrawer]);

  // Horizontal thresholds and direction dominance for full-content-area drawer swipe gestures
  const DRAWER_SWIPE_CAPTURE_DX = 16;
  const DRAWER_SWIPE_COMMIT_DX = 56;
  const DRAWER_SWIPE_COMMIT_VX = 0.35;
  const VERTICAL_LOCK_DY = 10;

  const isTouchInsideInputOrHorizontalScroll = useCallback((evt) => {
    // 1. Check React Fiber hierarchy (works across React Native Android/iOS and Web)
    let fiber = evt && evt._targetInst;
    let fiberDepth = 0;
    while (fiber && fiberDepth < 35) {
      const props = fiber.memoizedProps;
      if (props) {
        if (props.horizontal === true) {
          return true;
        }
        if (
          typeof props.onChangeText === 'function' ||
          (typeof props.placeholder === 'string' && props.editable !== false)
        ) {
          return true;
        }
      }
      fiber = fiber.return;
      fiberDepth += 1;
    }

    // 2. Fallback check for DOM targets (React Native Web preview)
    const rawTarget =
      (evt && evt.nativeEvent && evt.nativeEvent.target) || (evt && evt.target);
    if (!rawTarget || typeof rawTarget !== 'object') {
      return false;
    }
    let node = rawTarget;
    let depth = 0;
    while (node && depth < 15) {
      const tagName =
        typeof node.tagName === 'string' ? node.tagName.toUpperCase() : '';
      if (
        tagName === 'INPUT' ||
        tagName === 'TEXTAREA' ||
        node.isContentEditable
      ) {
        return true;
      }
      if (
        typeof node.scrollWidth === 'number' &&
        typeof node.clientWidth === 'number' &&
        node.scrollWidth > node.clientWidth + 2 &&
        typeof window !== 'undefined' &&
        typeof window.getComputedStyle === 'function'
      ) {
        const style = window.getComputedStyle(node);
        if (
          style &&
          (style.overflowX === 'auto' || style.overflowX === 'scroll')
        ) {
          return true;
        }
      }
      node = node.parentElement || node.parentNode;
      depth += 1;
    }
    return false;
  }, []);

  const handleTouchStartCapture = useCallback(
    (evt) => {
      const nativeEvent = evt && evt.nativeEvent;
      touchStartXRef.current =
        nativeEvent && typeof nativeEvent.pageX === 'number'
          ? nativeEvent.pageX
          : null;
      touchStartYRef.current =
        nativeEvent && typeof nativeEvent.pageY === 'number'
          ? nativeEvent.pageY
          : null;
      gestureLockedVerticalRef.current = false;
      gestureBlockedByTargetRef.current =
        isTouchInsideInputOrHorizontalScroll(evt);
      // Never intercept touch-start so taps on buttons, cards, and inputs work normally
      return false;
    },
    [isTouchInsideInputOrHorizontalScroll]
  );

  const shouldCaptureDrawerSwipe = useCallback((evt, gestureState) => {
    if (!gestureState) return false;

    const nativeEvent = evt && evt.nativeEvent;
    const pageX =
      nativeEvent && typeof nativeEvent.pageX === 'number'
        ? nativeEvent.pageX
        : null;
    const pageY =
      nativeEvent && typeof nativeEvent.pageY === 'number'
        ? nativeEvent.pageY
        : null;

    const dx =
      pageX !== null && typeof touchStartXRef.current === 'number'
        ? pageX - touchStartXRef.current
        : gestureState.dx;
    const dy =
      pageY !== null && typeof touchStartYRef.current === 'number'
        ? pageY - touchStartYRef.current
        : gestureState.dy;

    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    // If vertical movement begins first, lock this gesture to vertical scrolling
    if (absDy > VERTICAL_LOCK_DY && absDy > absDx) {
      gestureLockedVerticalRef.current = true;
      return false;
    }

    if (gestureLockedVerticalRef.current || gestureBlockedByTargetRef.current) {
      return false;
    }

    // Require clear horizontal dominance so vertical scrolling is never interrupted
    if (absDx < DRAWER_SWIPE_CAPTURE_DX || absDx <= absDy * 1.75) {
      return false;
    }

    const startX =
      typeof touchStartXRef.current === 'number'
        ? touchStartXRef.current
        : typeof gestureState.x0 === 'number' && gestureState.x0 > 0
        ? gestureState.x0
        : pageX !== null
        ? pageX - dx
        : 0;

    if (!isDrawerOpenRef.current) {
      // Closed -> recognize intentional left-to-right swipes starting anywhere horizontally across workspaceBody
      return dx >= DRAWER_SWIPE_CAPTURE_DX && absDy < 32;
    }

    // Open -> only capture swipe-to-close when touch starts inside the drawer panel,
    // so outside taps in the uncovered right 20% area are never intercepted
    const currentDrawerWidth = drawerWidthRef.current || 288;
    return startX <= currentDrawerWidth && dx <= -DRAWER_SWIPE_CAPTURE_DX;
  }, []);

  const drawerPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onStartShouldSetPanResponderCapture: handleTouchStartCapture,
        onMoveShouldSetPanResponder: shouldCaptureDrawerSwipe,
        onMoveShouldSetPanResponderCapture: shouldCaptureDrawerSwipe,
        onPanResponderGrant: () => {
          gestureStartOpenRef.current = isDrawerOpenRef.current;
          if (!gestureStartOpenRef.current) {
            Keyboard.dismiss();
            isKeyboardOpenRef.current = false;
          }
        },
        onPanResponderMove: (evt, gestureState) => {
          const width = Math.max(drawerWidthRef.current || 280, 1);
          const nativeEvent = evt && evt.nativeEvent;
          const pageX =
            nativeEvent && typeof nativeEvent.pageX === 'number'
              ? nativeEvent.pageX
              : null;
          const dx =
            pageX !== null && typeof touchStartXRef.current === 'number'
              ? pageX - touchStartXRef.current
              : gestureState.dx;
          if (!gestureStartOpenRef.current) {
            const progress = Math.min(1, Math.max(0, dx / width));
            drawerAnim.setValue(progress);
          } else {
            const progress = Math.min(1, Math.max(0, 1 + dx / width));
            drawerAnim.setValue(progress);
          }
        },
        onPanResponderRelease: (evt, gestureState) => {
          const nativeEvent = evt && evt.nativeEvent;
          const pageX =
            nativeEvent && typeof nativeEvent.pageX === 'number'
              ? nativeEvent.pageX
              : null;
          const dx =
            pageX !== null && typeof touchStartXRef.current === 'number'
              ? pageX - touchStartXRef.current
              : gestureState.dx;
          const { vx } = gestureState;
          if (!gestureStartOpenRef.current) {
            if (
              dx >= DRAWER_SWIPE_COMMIT_DX ||
              (dx >= 28 && vx >= DRAWER_SWIPE_COMMIT_VX)
            ) {
              openDrawerRef.current();
            } else {
              closeDrawerRef.current();
            }
          } else {
            if (
              dx <= -DRAWER_SWIPE_COMMIT_DX ||
              (dx <= -28 && vx <= -DRAWER_SWIPE_COMMIT_VX)
            ) {
              closeDrawerRef.current();
            } else {
              openDrawerRef.current();
            }
          }
        },
        onPanResponderTerminate: () => {
          if (gestureStartOpenRef.current) {
            openDrawerRef.current();
          } else {
            closeDrawerRef.current();
          }
        },
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
      }),
    [drawerAnim, handleTouchStartCapture, shouldCaptureDrawerSwipe]
  );

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
    // 00. Active Software Keyboard -> dismiss keyboard first without navigating away
    if (
      isKeyboardOpenRef.current ||
      (typeof Keyboard.isVisible === 'function' && Keyboard.isVisible())
    ) {
      Keyboard.dismiss();
      isKeyboardOpenRef.current = false;
      return true;
    }

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

    // 9. Data Management dedicated screen -> return to Settings screen first (whether or not a project is active)
    if (activeTab === 'profile' && profileSubView === 'data') {
      setProfileSubView('settings');
      return true;
    }

    // 10. Workspace view without a selected project (e.g. Settings when no project is active) -> return to My Projects
    if (!selectedProject && effectiveViewMode === 'workspace') {
      setProfileSubView('all');
      setProjectViewMode('selection');
      return true;
    }

    // 11. Nested Dashboard sub-tabs (Reports or embedded Checklists) -> return to QA Dashboard Overview
    if (
      activeTab === 'dashboard' &&
      (dashboardSubTab === 'reports' || dashboardSubTab === 'checklists')
    ) {
      setDashboardSubTab('overview');
      return true;
    }

    // 12. Nested Test Cases sub-tabs (Test Plans or Test Suites) -> return to Test Cases list
    if (
      activeTab === 'testcases' &&
      (testCasesSubTab === 'plan' || testCasesSubTab === 'suites')
    ) {
      setTestCasesSubTab('cases');
      return true;
    }

    // 13. Nested Test Execution History view -> return to Test Runs view
    if (activeTab === 'testruns' && testRunsViewMode === 'history') {
      setTestRunsViewMode('runs');
      return true;
    }

    // 14. Non-Dashboard primary workspace tabs (including Settings) -> return to Dashboard (or My Projects if no project)
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
            icon: 'dashboard',
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
            icon: 'play-circle',
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
            icon: 'user',
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
      Keyboard.dismiss();
      isKeyboardOpenRef.current = false;
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

      {/* Compact 56dp Mobile Top Bar (Single-Row, 360dp Safe) */}
      <View
        style={[
          styles.topBar,
          { backgroundColor: colors.surface, borderBottomColor: colors.border },
        ]}
      >
        <View style={styles.topBarInner}>
          <Pressable
            onPress={toggleDrawer}
            hitSlop={{ top: 5, bottom: 5, left: 5, right: 5 }}
            accessibilityRole="button"
            accessibilityLabel={
              isDrawerOpen
                ? 'Close navigation drawer'
                : 'Open navigation drawer'
            }
            style={[
              styles.drawerMenuBtn,
              {
                backgroundColor: colors.surfaceAccent,
                borderColor: colors.primary,
              },
            ]}
          >
            <VectorIcon
              name="menu"
              size={16}
              color={colors.primary}
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
            hitSlop={{ top: 6, bottom: 6, left: 2, right: 2 }}
            accessibilityRole="button"
            accessibilityLabel={
              selectedProject
                ? `${selectedProject.name}, ${headerSubtitle}. Tap to toggle project details`
                : 'Qavora, Select or create a project'
            }
            style={styles.brandLockup}
          >
            <View
              style={[styles.brandBadge, { backgroundColor: colors.primary }]}
            >
              <Text
                style={[styles.brandBadgeText, { color: colors.textOnPrimary }]}
              >
                Q
              </Text>
            </View>
            <View style={styles.brandTextWrap}>
              <Text
                numberOfLines={1}
                ellipsizeMode="tail"
                style={[styles.brandTitle, { color: colors.text }]}
              >
                {selectedProject ? selectedProject.name : 'Qavora'}
              </Text>
              <Text
                numberOfLines={1}
                ellipsizeMode="tail"
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
              onPress={toggleTheme}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={
                isDark ? 'Switch to light theme' : 'Switch to dark theme'
              }
              style={({ pressed }) => [
                styles.themeBtn,
                {
                  backgroundColor: isDark
                    ? colors.surfaceElevated
                    : colors.surfaceMuted,
                  borderColor: colors.borderStrong,
                  opacity: pressed ? 0.82 : 1,
                },
              ]}
            >
              <ThemeToggleIcon
                isDark={isDark}
                iconColor={colors.primary}
                maskColor={isDark ? colors.surfaceElevated : colors.surfaceMuted}
              />
            </Pressable>
          </View>
        </View>
      </View>

      <View
        style={styles.workspaceBody}
        collapsable={false}
        {...drawerPanResponder.panHandlers}
      >
        {/* Non-Blocking Feedback Toast */}
        {toast ? (
          <Pressable
            onPress={dismissToast}
            pointerEvents={isDrawerOpen ? 'none' : 'auto'}
            accessibilityRole="button"
            accessibilityLabel={`Dismiss notification: ${toast.message}`}
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

        {/* Active Viewport (Base Layer) */}
        <View
          style={styles.mainViewport}
          collapsable={false}
          pointerEvents={isDrawerOpen ? 'none' : 'auto'}
          accessibilityElementsHidden={isDrawerOpen}
          importantForAccessibility={
            isDrawerOpen ? 'no-hide-descendants' : 'auto'
          }
        >
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
              {activeTab === 'profile' &&
                (profileSubView === 'data' ? (
                  <DataManagementSection />
                ) : (
                  <ProfileSettingsScreen
                    activeSection={profileSubView}
                    onChangeSection={setProfileSubView}
                  />
                ))}
            </>
          )}
        </View>

        {/* Full-Screen Translucent Drawer Backdrop Tint (Layer Above Active Screen) */}
        <Animated.View
          collapsable={false}
          pointerEvents="none"
          style={[
            styles.drawerBackdrop,
            {
              backgroundColor: isDark
                ? 'rgba(2, 6, 23, 0.58)'
                : 'rgba(15, 23, 42, 0.38)',
              opacity: drawerAnim,
            },
          ]}
        />

        {/* Dedicated Outside-Tap Target for Uncovered Right Area (Above Dim Tint) */}
        <Pressable
          collapsable={false}
          pointerEvents={isDrawerOpen ? 'auto' : 'none'}
          disabled={!isDrawerOpen}
          onPress={closeDrawer}
          accessibilityRole="button"
          accessibilityLabel="Close navigation drawer backdrop"
          accessibilityElementsHidden={!isDrawerOpen}
          importantForAccessibility={
            isDrawerOpen ? 'auto' : 'no-hide-descendants'
          }
          style={[styles.drawerBackdropTouch, { left: drawerWidth }]}
        />

        {/* Left-Aligned Sliding Drawer Panel (Top Layer, Covers ~80% Width) */}
        <Animated.View
          collapsable={false}
          pointerEvents={isDrawerOpen ? 'auto' : 'none'}
          accessibilityElementsHidden={!isDrawerOpen}
          importantForAccessibility={
            isDrawerOpen ? 'auto' : 'no-hide-descendants'
          }
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
                    hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel="Open Project Details"
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
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={
                  isDark ? 'Switch to light theme' : 'Switch to dark theme'
                }
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
        <View style={styles.restoringContent}>
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
    padding: 24,
  },
  restoringContent: {
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
    height: 56,
    minHeight: 56,
    maxHeight: 56,
    borderBottomWidth: 1,
    justifyContent: 'center',
    paddingHorizontal: 8,
    zIndex: 1100,
  },
  topBarInner: {
    maxWidth: 920,
    width: '100%',
    height: 56,
    alignSelf: 'center',
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  brandLockup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    height: 44,
  },
  brandBadge: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  brandBadgeText: {
    fontSize: 14,
    fontWeight: '700',
  },
  brandTextWrap: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  brandTitle: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  screenSubtitle: {
    fontSize: 10,
    marginTop: 1,
  },
  topRightUtilities: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    flexShrink: 0,
  },
  themeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  themeIconCanvas: {
    width: 21,
    height: 21,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  sunRayBar: {
    position: 'absolute',
    width: 20,
    height: 2.2,
    borderRadius: 1.1,
  },
  sunRayGapMask: {
    position: 'absolute',
    width: 13.5,
    height: 13.5,
    borderRadius: 6.75,
  },
  sunCoreDisc: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
  },
  moonBodyWrap: {
    width: 16,
    height: 16,
    position: 'relative',
    transform: [{ rotate: '-18deg' }],
  },
  moonFullDisc: {
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  moonCutoutDisc: {
    position: 'absolute',
    width: 13.5,
    height: 13.5,
    borderRadius: 6.75,
    top: -2.5,
    right: -3.5,
  },
  moonStarPrimary: {
    position: 'absolute',
    top: 3,
    right: 2.5,
    width: 2.6,
    height: 2.6,
    borderRadius: 1.3,
  },
  moonStarSecondary: {
    position: 'absolute',
    top: 7.5,
    right: 1,
    width: 1.8,
    height: 1.8,
    borderRadius: 0.9,
  },
  toastBanner: {
    minHeight: 48,
    flexDirection: 'row',
    flexWrap: 'wrap',
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
  workspaceBody: {
    flex: 1,
    position: 'relative',
  },
  mainViewport: {
    flex: 1,
    width: '100%',
    height: '100%',
    zIndex: 1,
  },
  drawerMenuBtn: {
    width: 38,
    height: 38,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  drawerBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
  },
  drawerBackdropTouch: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    zIndex: 1001,
    backgroundColor: 'rgba(0, 0, 0, 0.005)',
  },
  drawerPanel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    zIndex: 1002,
    borderRightWidth: 1,
    justifyContent: 'space-between',
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
    minHeight: 48,
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
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  drawerFooterMeta: {
    fontSize: 10.5,
    flex: 1,
  },
  drawerFooterThemeBtn: {
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 7,
    borderWidth: 1,
  },
  drawerFooterThemeText: {
    fontSize: 11,
    fontWeight: '700',
  },
});

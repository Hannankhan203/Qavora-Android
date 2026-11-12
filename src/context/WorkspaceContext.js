import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from './AuthContext.js';
import { useProjects } from './ProjectContext.js';
import {
  buildDefaultTestPlan,
  persistProfileProjectChanges,
} from '../services/projectService.js';
import {
  REPORT_TYPES,
  DATE_RANGE_FILTERS,
  EXPORT_FORMATS,
  computeProjectDashboardMetrics,
  generateProjectReport,
  exportGeneratedReport,
} from '../services/reportService.js';
import {
  getCachedChecklistsForUser,
  fetchChecklists,
} from '../services/checklistService.js';
import {
  subscribeToSyncEvents,
  subscribeToReconnectSyncResults,
} from '../services/offlineSyncService.js';
import {
  INITIAL_SUITES,
  INITIAL_TEST_CASES,
  INITIAL_TEST_RUNS,
  INITIAL_DEFECTS,
  INITIAL_ACTIVITY,
  INITIAL_PROFILE,
  PRIORITIES,
  TEST_TYPES,
  EXECUTION_STATUSES,
  WEB_EXECUTION_OUTCOMES,
  DEFECT_SEVERITIES,
  DEFECT_PRIORITIES,
  DEFECT_STATUSES,
} from '../data/initialData.js';

import {
  WORKSPACE_STORAGE_PREFIX,
  SUITE_CATEGORIES,
  NAVIGATION_DESTINATIONS,
  formatTimestamp,
  getProjectWorkspaceStorageKey,
  normalizeCaseLastStatus,
  toBackendCaseStatus,
  toWebExecutionOutcome,
  computeRunMetrics,
  normalizeTestStep,
} from './workspace/workspaceConstants.js';
import {
  buildBackendTestSuitesPayload,
  buildBackendExecutionsAndRunsPayload,
  buildBackendDefectsPayload,
  buildProjectWorkspaceState,
} from './workspace/workspacePayloads.js';

export {
  WORKSPACE_STORAGE_PREFIX,
  SUITE_CATEGORIES,
  NAVIGATION_DESTINATIONS,
  getProjectWorkspaceStorageKey,
  normalizeCaseLastStatus,
  toBackendCaseStatus,
  toWebExecutionOutcome,
  computeRunMetrics,
  normalizeTestStep,
  buildBackendTestSuitesPayload,
  buildBackendExecutionsAndRunsPayload,
  buildBackendDefectsPayload,
  buildProjectWorkspaceState,
};

const WorkspaceContext = createContext(null);

export function WorkspaceProvider({ children }) {
  const { user } = useAuth();
  const {
    selectedProject,
    selectedProjectId,
    updateProject,
    updateProjectData,
    getProject,
  } = useProjects();

  const [hydratedProjectId, setHydratedProjectId] = useState(null);
  const [isStorageHydrated, setIsStorageHydrated] = useState(false);
  const [lastPersistedAt, setLastPersistedAt] = useState(null);

  // Backend Synchronization State for Phase 2C & 2D
  const [isSyncingProjectData, setIsSyncingProjectData] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isRestoringSampleData, setIsRestoringSampleData] = useState(false);
  const [isClearingWorkspaceData, setIsClearingWorkspaceData] = useState(false);
  const [projectDataError, setProjectDataError] = useState(null);
  const [projectDataConflict, setProjectDataConflict] = useState(null);
  const syncLockRef = useRef(false);
  const profileSaveLockRef = useRef(false);
  const datasetResetLockRef = useRef(false);

  const initialWorkspace = useMemo(
    () => buildProjectWorkspaceState(selectedProject, null, user),
    []
  );

  const [profile, setProfile] = useState(initialWorkspace.profile);
  const [testPlan, setTestPlan] = useState(initialWorkspace.testPlan);
  const [suites, setSuites] = useState(initialWorkspace.suites);
  const [testCases, setTestCases] = useState(initialWorkspace.testCases);
  const [testRuns, setTestRuns] = useState(initialWorkspace.testRuns);
  const [executions, setExecutions] = useState(initialWorkspace.executions);
  const [defects, setDefects] = useState(initialWorkspace.defects);
  const [activityLog, setActivityLog] = useState(initialWorkspace.activityLog);

  const testPlanRef = useRef(testPlan);
  testPlanRef.current = testPlan;

  const suitesRef = useRef(suites);
  suitesRef.current = suites;

  const testCasesRef = useRef(testCases);
  testCasesRef.current = testCases;

  const testRunsRef = useRef(testRuns);
  testRunsRef.current = testRuns;

  const executionsRef = useRef(executions);
  executionsRef.current = executions;

  const defectsRef = useRef(defects);
  defectsRef.current = defects;

  // Navigation & Active Selection State (Centralized across all 11 destinations)
  const [activeTab, setActiveTabState] = useState('dashboard'); // 'dashboard' | 'testcases' | 'testruns' | 'defects' | 'profile'
  const [dashboardSubTab, setDashboardSubTabState] = useState('overview'); // 'overview' | 'reports' | 'checklists'
  const [projectViewMode, setProjectViewMode] = useState('workspace'); // 'workspace' | 'selection' | 'details' | 'checklists'
  const [testCasesSubTab, setTestCasesSubTabState] = useState('cases'); // 'cases' | 'suites' | 'plan'
  const [testRunsViewMode, setTestRunsViewModeState] = useState('runs'); // 'runs' | 'history'
  const [executingTestCaseId, setExecutingTestCaseId] = useState(null);
  const [activeChecklistId, setActiveChecklistId] = useState(null);
  const [checklistCreateModalOpen, setChecklistCreateModalOpen] = useState(false);
  const [checklistCreateTemplateId, setChecklistCreateTemplateId] = useState('none');
  const [profileSubView, setProfileSubViewState] = useState('all'); // 'all' | 'data' | 'settings'
  const [navigationHistory, setNavigationHistory] = useState([]);
  const [selectedTestCaseId, setSelectedTestCaseIdState] = useState(null);
  const [selectedTestRunId, setSelectedTestRunIdState] = useState(null);
  const [selectedDefectId, setSelectedDefectId] = useState(null);
  const [checklists, setChecklists] = useState([]);

  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;

  const dashboardSubTabRef = useRef(dashboardSubTab);
  dashboardSubTabRef.current = dashboardSubTab;

  const projectViewModeRef = useRef(projectViewMode);
  projectViewModeRef.current = projectViewMode;

  const testCasesSubTabRef = useRef(testCasesSubTab);
  testCasesSubTabRef.current = testCasesSubTab;

  const testRunsViewModeRef = useRef(testRunsViewMode);
  testRunsViewModeRef.current = testRunsViewMode;

  const activeChecklistIdRef = useRef(activeChecklistId);
  activeChecklistIdRef.current = activeChecklistId;

  const checklistsRef = useRef(checklists);
  checklistsRef.current = checklists;

  const profileSubViewRef = useRef(profileSubView);
  profileSubViewRef.current = profileSubView;

  const selectedProjectIdRef = useRef(selectedProjectId);
  selectedProjectIdRef.current = selectedProjectId;

  const prevSelectedProjectIdRef = useRef(selectedProjectId);

  const setDashboardSubTab = useCallback((nextSubTab) => {
    const cleanSub =
      typeof nextSubTab === 'string' && nextSubTab.trim()
        ? nextSubTab.trim()
        : 'overview';
    dashboardSubTabRef.current = cleanSub;
    setDashboardSubTabState(cleanSub);
  }, []);

  const setTestCasesSubTab = useCallback((nextSubTab) => {
    const cleanSub =
      nextSubTab === 'suites' || nextSubTab === 'plan' ? nextSubTab : 'cases';
    testCasesSubTabRef.current = cleanSub;
    setTestCasesSubTabState(cleanSub);
  }, []);

  const setTestRunsViewMode = useCallback((nextMode) => {
    const cleanMode = nextMode === 'history' ? 'history' : 'runs';
    testRunsViewModeRef.current = cleanMode;
    setTestRunsViewModeState(cleanMode);
  }, []);

  const setProfileSubView = useCallback((nextSection) => {
    const cleanSection =
      nextSection === 'data' || nextSection === 'settings'
        ? nextSection
        : 'all';
    profileSubViewRef.current = cleanSection;
    setProfileSubViewState(cleanSection);
  }, []);

  const setSelectedTestCaseId = useCallback((nextCaseId) => {
    setSelectedTestCaseIdState(nextCaseId);
    if (nextCaseId) {
      testCasesSubTabRef.current = 'cases';
      setTestCasesSubTabState('cases');
    }
  }, []);

  const setSelectedTestRunId = useCallback((nextRunId) => {
    setSelectedTestRunIdState(nextRunId);
    if (nextRunId) {
      testRunsViewModeRef.current = 'runs';
      setTestRunsViewModeState('runs');
    }
  }, []);

  const pushNavigationHistory = useCallback((snapshotOverride = null) => {
    const entry = snapshotOverride || {
      projectViewMode: projectViewModeRef.current,
      activeTab: activeTabRef.current,
      dashboardSubTab: dashboardSubTabRef.current,
      testCasesSubTab: testCasesSubTabRef.current,
      testRunsViewMode: testRunsViewModeRef.current,
      activeChecklistId: activeChecklistIdRef.current,
      profileSubView: profileSubViewRef.current,
    };
    setNavigationHistory((prev) => {
      const next = [...prev, entry];
      return next.length > 20 ? next.slice(next.length - 20) : next;
    });
  }, []);

  const clearNavigationHistory = useCallback(() => {
    setNavigationHistory([]);
  }, []);

  // Cross-module prefill state for creating a defect directly from a failed test case execution
  const [draftDefectFromExecution, setDraftDefectFromExecution] = useState(null);

  // Toast feedback
  const [toast, setToast] = useState(null);

  const showToast = useCallback((message, tone = 'info') => {
    setToast({ id: Date.now(), message, tone });
  }, []);

  const setActiveTab = useCallback(
    (nextTab, options = {}) => {
      const cleanTab =
        typeof nextTab === 'string' && nextTab.trim()
          ? nextTab.trim()
          : 'dashboard';
      activeTabRef.current = cleanTab;
      setActiveTabState(cleanTab);
      if (
        (cleanTab !== 'testcases' || options.clearSelectedCase === true) &&
        !options.preserveSelectedCase
      ) {
        setSelectedTestCaseIdState(null);
      }
      if (
        (cleanTab !== 'defects' || options.clearSelectedDefect === true) &&
        !options.preserveSelectedDefect
      ) {
        setSelectedDefectId(null);
      }
      if (!options.preserveExecutingCase) {
        setExecutingTestCaseId(null);
      }

      if (cleanTab === 'dashboard' && !options.preserveDashboardSubTab) {
        dashboardSubTabRef.current = 'overview';
        setDashboardSubTabState('overview');
      } else if (cleanTab !== 'dashboard') {
        dashboardSubTabRef.current = 'overview';
        setDashboardSubTabState('overview');
      }

      if (cleanTab === 'testcases' && options.testCasesSubTab) {
        const cleanSub =
          options.testCasesSubTab === 'suites' ||
          options.testCasesSubTab === 'plan'
            ? options.testCasesSubTab
            : 'cases';
        testCasesSubTabRef.current = cleanSub;
        setTestCasesSubTabState(cleanSub);
      }

      if (cleanTab === 'testruns' && options.testRunsViewMode) {
        const cleanMode =
          options.testRunsViewMode === 'history' ? 'history' : 'runs';
        testRunsViewModeRef.current = cleanMode;
        setTestRunsViewModeState(cleanMode);
      }

      if (cleanTab === 'profile') {
        if (options.profileSubView) {
          profileSubViewRef.current = options.profileSubView;
          setProfileSubViewState(options.profileSubView);
        }
        setProjectViewMode('workspace');
      } else {
        profileSubViewRef.current = 'all';
        setProfileSubViewState('all');
        if (selectedProjectIdRef.current) {
          setProjectViewMode('workspace');
        } else {
          setProjectViewMode('selection');
        }
      }
    },
    []
  );

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(timer);
  }, [toast]);

  const clearProjectDataError = useCallback(() => {
    setProjectDataError(null);
    setProjectDataConflict(null);
  }, []);

  const openProjectSelection = useCallback(() => {
    setChecklistCreateModalOpen(false);
    setExecutingTestCaseId(null);
    setSelectedTestCaseIdState(null);
    setSelectedDefectId(null);
    profileSubViewRef.current = 'all';
    setProfileSubViewState('all');
    setProjectViewMode('selection');
  }, []);

  const openProjectDetails = useCallback(() => {
    if (!selectedProjectIdRef.current) {
      setProjectViewMode('selection');
      showToast(
        'Select or create a project first to view project details.',
        'info'
      );
      return;
    }
    setChecklistCreateModalOpen(false);
    setExecutingTestCaseId(null);
    setSelectedTestCaseIdState(null);
    setSelectedDefectId(null);
    profileSubViewRef.current = 'all';
    setProfileSubViewState('all');
    setProjectViewMode('details');
  }, [showToast]);

  const openWorkspace = useCallback(
    (targetTab = null, options = {}) => {
      if (!selectedProjectIdRef.current && targetTab !== 'profile') {
        setProjectViewMode('selection');
        return;
      }
      setChecklistCreateModalOpen(false);
      setProjectViewMode('workspace');
      if (typeof targetTab === 'string' && targetTab.trim()) {
        setActiveTab(targetTab.trim(), options);
      }
    },
    [setActiveTab]
  );

  const openDashboardOverview = useCallback(() => {
    if (!selectedProjectIdRef.current) {
      setProjectViewMode('selection');
      return;
    }
    setChecklistCreateModalOpen(false);
    setExecutingTestCaseId(null);
    setSelectedTestCaseIdState(null);
    setSelectedDefectId(null);
    profileSubViewRef.current = 'all';
    setProfileSubViewState('all');
    setProjectViewMode('workspace');
    activeTabRef.current = 'dashboard';
    setActiveTabState('dashboard');
    dashboardSubTabRef.current = 'overview';
    setDashboardSubTabState('overview');
  }, []);

  const openReportsView = useCallback(() => {
    if (!selectedProjectIdRef.current) {
      setProjectViewMode('selection');
      showToast(
        'Select or create a project first to view project reports.',
        'info'
      );
      return;
    }
    setChecklistCreateModalOpen(false);
    setExecutingTestCaseId(null);
    setSelectedTestCaseIdState(null);
    setSelectedDefectId(null);
    profileSubViewRef.current = 'all';
    setProfileSubViewState('all');
    setProjectViewMode('workspace');
    activeTabRef.current = 'dashboard';
    setActiveTabState('dashboard');
    dashboardSubTabRef.current = 'reports';
    setDashboardSubTabState('reports');
  }, [showToast]);

  const openChecklistsView = useCallback((options = {}) => {
    if (!options || !options.keepCreateModal) {
      setChecklistCreateModalOpen(false);
    }
    if (!options || !options.keepRunner) {
      setActiveChecklistId(null);
    }
    setExecutingTestCaseId(null);
    setSelectedTestCaseIdState(null);
    setSelectedDefectId(null);
    profileSubViewRef.current = 'all';
    setProfileSubViewState('all');
    setProjectViewMode('checklists');
  }, []);

  const openCreateChecklistView = useCallback((templateId = 'none') => {
    const cleanTpl =
      typeof templateId === 'string' && templateId.trim()
        ? templateId.trim()
        : 'none';
    setActiveChecklistId(null);
    setExecutingTestCaseId(null);
    setSelectedTestCaseIdState(null);
    setSelectedDefectId(null);
    profileSubViewRef.current = 'all';
    setProfileSubViewState('all');
    setChecklistCreateTemplateId(cleanTpl);
    setChecklistCreateModalOpen(true);
    setProjectViewMode('checklists');
  }, []);

  const openChecklistRunnerView = useCallback(
    (checklistId = null) => {
      setChecklistCreateModalOpen(false);
      setExecutingTestCaseId(null);
      setSelectedTestCaseIdState(null);
      setSelectedDefectId(null);
      profileSubViewRef.current = 'all';
      setProfileSubViewState('all');
      setProjectViewMode('checklists');
      const explicitId =
        typeof checklistId === 'string' && checklistId.trim()
          ? checklistId.trim()
          : null;
      if (explicitId) {
        setActiveChecklistId(explicitId);
        return;
      }
      if (activeChecklistIdRef.current) {
        return;
      }
      const available = Array.isArray(checklistsRef.current)
        ? checklistsRef.current
        : [];
      const inProgress = available.find((c) => c && c.status === 'In Progress');
      const fallback = inProgress || available[0] || null;
      if (fallback && fallback.id) {
        setActiveChecklistId(fallback.id);
      } else {
        setActiveChecklistId(null);
      }
    },
    []
  );

  const openTestPlansView = useCallback(() => {
    if (!selectedProjectIdRef.current) {
      setProjectViewMode('selection');
      showToast(
        'Select or create a project first to view Test Plans.',
        'info'
      );
      return;
    }
    setChecklistCreateModalOpen(false);
    setExecutingTestCaseId(null);
    setSelectedTestCaseIdState(null);
    setSelectedDefectId(null);
    profileSubViewRef.current = 'all';
    setProfileSubViewState('all');
    dashboardSubTabRef.current = 'overview';
    setDashboardSubTabState('overview');
    setProjectViewMode('workspace');
    activeTabRef.current = 'testcases';
    setActiveTabState('testcases');
    testCasesSubTabRef.current = 'plan';
    setTestCasesSubTabState('plan');
  }, [showToast]);

  const openTestCasesView = useCallback(
    (subTab = 'cases', caseId = null) => {
      if (!selectedProjectIdRef.current) {
        setProjectViewMode('selection');
        showToast(
          'Select or create a project first to view Test Cases.',
          'info'
        );
        return;
      }
      const cleanSub =
        subTab === 'suites' || subTab === 'plan' ? subTab : 'cases';
      setChecklistCreateModalOpen(false);
      setExecutingTestCaseId(null);
      setSelectedDefectId(null);
      profileSubViewRef.current = 'all';
      setProfileSubViewState('all');
      dashboardSubTabRef.current = 'overview';
      setDashboardSubTabState('overview');
      setProjectViewMode('workspace');
      activeTabRef.current = 'testcases';
      setActiveTabState('testcases');
      testCasesSubTabRef.current = cleanSub;
      setTestCasesSubTabState(cleanSub);
      if (typeof caseId === 'string' && caseId.trim()) {
        setSelectedTestCaseIdState(caseId.trim());
      } else {
        setSelectedTestCaseIdState(null);
      }
    },
    [showToast]
  );

  const openTestSuitesView = useCallback(() => {
    openTestCasesView('suites');
  }, [openTestCasesView]);

  const openTestExecutionView = useCallback(
    (options = {}) => {
      if (!selectedProjectIdRef.current) {
        setProjectViewMode('selection');
        showToast(
          'Select or create a project first to open Test Execution.',
          'info'
        );
        return;
      }
      const nextMode = options && options.viewMode === 'history' ? 'history' : 'runs';
      setChecklistCreateModalOpen(false);
      setSelectedTestCaseIdState(null);
      setSelectedDefectId(null);
      profileSubViewRef.current = 'all';
      setProfileSubViewState('all');
      dashboardSubTabRef.current = 'overview';
      setDashboardSubTabState('overview');
      setProjectViewMode('workspace');
      activeTabRef.current = 'testruns';
      setActiveTabState('testruns');
      testRunsViewModeRef.current = nextMode;
      setTestRunsViewModeState(nextMode);
      if (options && options.testRunId) {
        setSelectedTestRunIdState(options.testRunId);
      }
      if (options && options.executingCaseId !== undefined) {
        setExecutingTestCaseId(options.executingCaseId);
      } else {
        setExecutingTestCaseId(null);
      }
    },
    [showToast]
  );

  const openDefectsView = useCallback(
    (defectId = null) => {
      if (!selectedProjectIdRef.current) {
        setProjectViewMode('selection');
        showToast(
          'Select or create a project first to view Defects.',
          'info'
        );
        return;
      }
      setChecklistCreateModalOpen(false);
      setExecutingTestCaseId(null);
      setSelectedTestCaseIdState(null);
      profileSubViewRef.current = 'all';
      setProfileSubViewState('all');
      dashboardSubTabRef.current = 'overview';
      setDashboardSubTabState('overview');
      setProjectViewMode('workspace');
      activeTabRef.current = 'defects';
      setActiveTabState('defects');
      if (typeof defectId === 'string' && defectId.trim()) {
        setSelectedDefectId(defectId.trim());
      } else {
        setSelectedDefectId(null);
      }
    },
    [showToast]
  );

  const openDataManagementView = useCallback(() => {
    setChecklistCreateModalOpen(false);
    setExecutingTestCaseId(null);
    setSelectedTestCaseIdState(null);
    setSelectedDefectId(null);
    dashboardSubTabRef.current = 'overview';
    setDashboardSubTabState('overview');
    setProjectViewMode('workspace');
    activeTabRef.current = 'profile';
    setActiveTabState('profile');
    profileSubViewRef.current = 'data';
    setProfileSubViewState('data');
  }, []);

  const openSettingsView = useCallback(() => {
    setChecklistCreateModalOpen(false);
    setExecutingTestCaseId(null);
    setSelectedTestCaseIdState(null);
    setSelectedDefectId(null);
    dashboardSubTabRef.current = 'overview';
    setDashboardSubTabState('overview');
    setProjectViewMode('workspace');
    activeTabRef.current = 'profile';
    setActiveTabState('profile');
    profileSubViewRef.current = 'settings';
    setProfileSubViewState('settings');
  }, []);

  const navigateToDestination = useCallback(
    (destinationId, params = {}) => {
      const cleanDest =
        typeof destinationId === 'string' ? destinationId.trim().toLowerCase() : '';
      switch (cleanDest) {
        case NAVIGATION_DESTINATIONS.CREATE_CHECKLIST:
        case 'create-checklist':
          openCreateChecklistView(params.templateId || 'none');
          return;
        case NAVIGATION_DESTINATIONS.MY_CHECKLISTS:
        case 'checklists':
          openChecklistsView({ keepRunner: false });
          return;
        case NAVIGATION_DESTINATIONS.QA_TEST_RUNNER:
        case 'checklist_runner':
          openChecklistRunnerView(params.checklistId || null);
          return;
        case NAVIGATION_DESTINATIONS.DASHBOARD:
          openDashboardOverview();
          return;
        case NAVIGATION_DESTINATIONS.MY_PROJECTS:
        case 'projects':
          openProjectSelection();
          return;
        case NAVIGATION_DESTINATIONS.PROJECT_DETAILS:
          openProjectDetails();
          return;
        case NAVIGATION_DESTINATIONS.TEST_PLANS:
        case 'testplan':
          openTestPlansView();
          return;
        case NAVIGATION_DESTINATIONS.TEST_SUITES:
        case 'suites':
          openTestSuitesView();
          return;
        case NAVIGATION_DESTINATIONS.TEST_CASES:
        case 'testcases':
          openTestCasesView(params.subTab || 'cases');
          return;
        case NAVIGATION_DESTINATIONS.TEST_EXECUTION:
        case 'testruns':
          openTestExecutionView(params);
          return;
        case NAVIGATION_DESTINATIONS.DEFECTS:
          openDefectsView(params.defectId || null);
          return;
        case NAVIGATION_DESTINATIONS.REPORTS:
          openReportsView();
          return;
        case NAVIGATION_DESTINATIONS.DATA_MANAGEMENT:
          openDataManagementView();
          return;
        case NAVIGATION_DESTINATIONS.SETTINGS:
        case 'profile':
          openSettingsView();
          return;
        default:
          openDashboardOverview();
      }
    },
    [
      openCreateChecklistView,
      openChecklistsView,
      openChecklistRunnerView,
      openDashboardOverview,
      openProjectSelection,
      openProjectDetails,
      openTestPlansView,
      openTestSuitesView,
      openTestCasesView,
      openTestExecutionView,
      openDefectsView,
      openReportsView,
      openDataManagementView,
      openSettingsView,
    ]
  );

  // Hydrate user-owned checklists on login and clear on logout/user switch
  useEffect(() => {
    let mounted = true;
    const resolvedUserId =
      user && (user.userId || user.id || user._id)
        ? String(user.userId || user.id || user._id).trim()
        : '';

    if (!resolvedUserId) {
      setChecklists([]);
      return () => {
        mounted = false;
      };
    }

    getCachedChecklistsForUser(resolvedUserId)
      .then((cached) => {
        if (mounted && Array.isArray(cached) && cached.length > 0) {
          setChecklists(cached);
        }
      })
      .catch(() => {});

    fetchChecklists({ userId: resolvedUserId })
      .then((res) => {
        if (mounted && res && res.ok && Array.isArray(res.checklists)) {
          setChecklists(res.checklists);
        }
      })
      .catch(() => {});

    const unsubSyncEvents = subscribeToSyncEvents((evt) => {
      if (!mounted) return;
      if (
        evt &&
        (evt.entityType === 'checklist' ||
          evt.type === 'sync_completed' ||
          evt.type === 'conflict_resolved' ||
          evt.type === 'operation_discarded')
      ) {
        getCachedChecklistsForUser(resolvedUserId)
          .then((cached) => {
            if (mounted && Array.isArray(cached)) {
              setChecklists(cached);
            }
          })
          .catch(() => {});
      }
    });

    const unsubReconnect = subscribeToReconnectSyncResults((payload) => {
      if (!mounted || !payload || payload.userId !== resolvedUserId) return;
      fetchChecklists({ userId: resolvedUserId })
        .then((res) => {
          if (mounted && res && res.ok && Array.isArray(res.checklists)) {
            setChecklists(res.checklists);
          }
        })
        .catch(() => {});
    });

    return () => {
      mounted = false;
      unsubSyncEvents();
      unsubReconnect();
    };
  }, [user && (user.userId || user.id || user._id)]);

  // Switch workspace data cleanly whenever the selected project changes
  useEffect(() => {
    let mounted = true;

    setSelectedTestCaseId(null);
    setSelectedTestRunId(null);
    setSelectedDefectId(null);
    setExecutingTestCaseId(null);
    setDraftDefectFromExecution(null);
    setProjectDataError(null);
    setProjectDataConflict(null);

    if (!selectedProjectId || !selectedProject) {
      prevSelectedProjectIdRef.current = null;
      const emptyState = buildProjectWorkspaceState(null, null, user);
      setProfile(emptyState.profile);
      setTestPlan(emptyState.testPlan);
      setSuites(emptyState.suites);
      setTestCases(emptyState.testCases);
      setTestRuns(emptyState.testRuns);
      setExecutions(emptyState.executions);
      setDefects(emptyState.defects);
      setActivityLog(emptyState.activityLog);
      setHydratedProjectId(null);
      setLastPersistedAt(null);
      setIsStorageHydrated(true);
      setProjectViewMode((prevMode) => {
        if (prevMode === 'checklists') return 'checklists';
        if (
          prevMode === 'workspace' &&
          (activeTabRef.current === 'profile' ||
            (activeTabRef.current === 'dashboard' &&
              dashboardSubTabRef.current === 'checklists'))
        ) {
          return 'workspace';
        }
        return 'selection';
      });
      return () => {
        mounted = false;
      };
    }

    const hadPreviousProject = Boolean(prevSelectedProjectIdRef.current);
    prevSelectedProjectIdRef.current = selectedProjectId;
    if (!hadPreviousProject) {
      setProjectViewMode((prevMode) =>
        prevMode === 'selection' ? 'workspace' : prevMode
      );
    }

    setIsStorageHydrated(false);
    setHydratedProjectId(null);
    const immediateState = buildProjectWorkspaceState(
      selectedProject,
      null,
      user
    );
    setProfile(immediateState.profile);
    setTestPlan(immediateState.testPlan);
    setSuites(immediateState.suites);
    setTestCases(immediateState.testCases);
    setTestRuns(immediateState.testRuns);
    setExecutions(immediateState.executions);
    setDefects(immediateState.defects);
    setActivityLog(immediateState.activityLog);

    const storageKey = getProjectWorkspaceStorageKey(
      selectedProjectId,
      user && user.userId
    );
    AsyncStorage.getItem(storageKey)
      .then((raw) => {
        if (!mounted) return;
        let snapshot = null;
        if (raw) {
          try {
            snapshot = JSON.parse(raw);
          } catch {
            snapshot = null;
          }
        }
        const resolved = buildProjectWorkspaceState(
          selectedProject,
          snapshot,
          user
        );
        setProfile(resolved.profile);
        setTestPlan(resolved.testPlan);
        setSuites(resolved.suites);
        setTestCases(resolved.testCases);
        setTestRuns(resolved.testRuns);
        setExecutions(resolved.executions);
        setDefects(resolved.defects);
        setActivityLog(resolved.activityLog);
        setLastPersistedAt(
          (snapshot && snapshot.savedAt) || formatTimestamp()
        );
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) {
          setHydratedProjectId(selectedProjectId);
          setIsStorageHydrated(true);
        }
      });

    return () => {
      mounted = false;
    };
  }, [selectedProjectId]);

  // Synchronize workspace state whenever selectedProject is refreshed from the server or updated via promotion
  useEffect(() => {
    if (!selectedProject || !selectedProjectId) return;
    const synced = buildProjectWorkspaceState(selectedProject, null, user);
    setTestPlan(synced.testPlan);
    setSuites(synced.suites);
    setTestCases(synced.testCases);
    setTestRuns(synced.testRuns);
    setExecutions(synced.executions);
    setDefects(synced.defects);
    setProfile((prev) => ({
      ...prev,
      projectName: selectedProject.name || prev.projectName,
      targetVersion: selectedProject.version || prev.targetVersion || 'v1.0.0',
      defaultEnvironment:
        selectedProject.environment || prev.defaultEnvironment || 'Staging',
    }));
  }, [
    selectedProjectId,
    selectedProject && selectedProject.updatedAt,
    selectedProject && selectedProject.name,
    selectedProject && selectedProject.version,
    selectedProject && selectedProject.environment,
    selectedProject && selectedProject.testCaseCount,
    selectedProject && selectedProject.promotedAt,
    selectedProject && selectedProject.sourceChecklistId,
    selectedProject &&
      Array.isArray(selectedProject.testSuites) &&
      selectedProject.testSuites.length,
  ]);

  // Persist project-scoped workspace data to AsyncStorage
  useEffect(() => {
    if (
      !isStorageHydrated ||
      !selectedProjectId ||
      hydratedProjectId !== selectedProjectId
    ) {
      return;
    }
    const savedAt = formatTimestamp();
    const payload = JSON.stringify({
      projectId: selectedProjectId,
      serverUpdatedAt: (selectedProject && selectedProject.updatedAt) || null,
      profile,
      testPlan,
      suites,
      testCases,
      testRuns,
      executions,
      defects,
      activityLog,
      savedAt,
    });
    AsyncStorage.setItem(
      getProjectWorkspaceStorageKey(selectedProjectId, user && user.userId),
      payload
    )
      .then(() => {
        setLastPersistedAt(savedAt);
      })
      .catch(() => {});
  }, [
    isStorageHydrated,
    selectedProjectId,
    hydratedProjectId,
    selectedProject && selectedProject.updatedAt,
    profile,
    testPlan,
    suites,
    testCases,
    testRuns,
    executions,
    defects,
    activityLog,
  ]);

  const appendActivity = useCallback((category, title, detail) => {
    const entry = {
      id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      category,
      title,
      detail,
      timestamp: formatTimestamp(),
    };
    setActivityLog((prev) => [entry, ...prev.slice(0, 29)]);
  }, []);

  /**
   * Reloads the active project's latest data from the backend (`GET /api/projects/:id`),
   * clearing any HTTP 409 conflict state.
   */
  const reloadProjectDataFromBackend = useCallback(async () => {
    if (!selectedProjectId) {
      return { ok: false, error: 'No active project selected.' };
    }
    setIsSyncingProjectData(true);
    setProjectDataError(null);
    setProjectDataConflict(null);
    try {
      const result = await getProject(selectedProjectId);
      if (result.ok && result.project) {
        const refreshed = buildProjectWorkspaceState(
          result.project,
          null,
          user
        );
        setTestPlan(refreshed.testPlan);
        setSuites(refreshed.suites);
        setTestCases(refreshed.testCases);
        setTestRuns(refreshed.testRuns);
        setExecutions(refreshed.executions);
        setDefects(refreshed.defects);
        showToast('Reloaded latest project data from server', 'info');
      } else if (!result.ok) {
        setProjectDataError(result.error || 'Failed to reload project data.');
      }
      return result;
    } finally {
      setIsSyncingProjectData(false);
    }
  }, [selectedProjectId, getProject, user, showToast]);

  /**
   * Internal helper to persist `dataUpdates` via `PATCH /api/projects/:id/data`
   * with duplicate-submission protection and HTTP 409 conflict handling.
   */
  const persistProjectDataToBackend = useCallback(
    async (dataUpdates, options = {}) => {
      if (!selectedProjectId) {
        return {
          ok: false,
          status: 400,
          isConflict: false,
          error: 'No active project selected.',
        };
      }

      if (syncLockRef.current && !options.allowConcurrent) {
        return {
          ok: false,
          status: 429,
          isConflict: false,
          isDuplicateSubmission: true,
          error: 'Another save operation is already in progress.',
        };
      }

      syncLockRef.current = true;
      setIsSyncingProjectData(true);
      setProjectDataError(null);
      setProjectDataConflict(null);

      try {
        const result = await updateProjectData(
          selectedProjectId,
          dataUpdates,
          options
        );

        if (!result.ok) {
          if (result.isConflict) {
            setProjectDataConflict({
              isConflict: true,
              projectId: selectedProjectId,
              currentUpdatedAt: result.currentUpdatedAt || null,
              expectedUpdatedAt: result.expectedUpdatedAt || null,
              message:
                result.error ||
                'Conflict: This project was modified in another session. Reload to get the latest changes.',
            });
          }
          setProjectDataError(
            result.error || 'Failed to save changes to server.'
          );
          return result;
        }

        return result;
      } finally {
        syncLockRef.current = false;
        setIsSyncingProjectData(false);
      }
    },
    [selectedProjectId, updateProjectData]
  );

  // =========================================================================
  // 1. TEST PLAN MANAGEMENT (Phase 2C)
  // =========================================================================

  const saveTestPlan = useCallback(
    async (planUpdates = {}, options = {}) => {
      if (!selectedProjectId || !selectedProject) {
        return { ok: false, status: 400, error: 'No active project selected.' };
      }

      if (
        !planUpdates ||
        typeof planUpdates !== 'object' ||
        Array.isArray(planUpdates)
      ) {
        return {
          ok: false,
          status: 400,
          error: 'Test plan updates must be a valid object.',
        };
      }

      const currentPlan = buildDefaultTestPlan({
        ...selectedProject,
        testPlan: testPlanRef.current,
      });

      if (planUpdates.name !== undefined) {
        if (
          typeof planUpdates.name !== 'string' ||
          planUpdates.name.trim() === ''
        ) {
          const errMsg = 'Test plan name is required and cannot be empty.';
          setProjectDataError(errMsg);
          return { ok: false, status: 400, error: errMsg };
        }
      }

      const nowIso = new Date().toISOString();
      const sanitizedUpdates = {};
      Object.keys(planUpdates).forEach((key) => {
        const val = planUpdates[key];
        if (val === undefined) return;
        if (typeof val === 'string') {
          sanitizedUpdates[key] = val.trim();
        } else {
          sanitizedUpdates[key] = val;
        }
      });

      const nextPlan = {
        ...currentPlan,
        ...sanitizedUpdates,
        id:
          sanitizedUpdates.id ||
          currentPlan.id ||
          `plan_${selectedProjectId}`,
        name:
          sanitizedUpdates.name !== undefined
            ? sanitizedUpdates.name
            : currentPlan.name || `${selectedProject.name} Master Test Plan`,
        phases: Array.isArray(sanitizedUpdates.phases)
          ? sanitizedUpdates.phases
          : Array.isArray(currentPlan.phases)
          ? currentPlan.phases
          : [],
        updatedAt: nowIso,
      };

      const previousPlan = testPlanRef.current;
      testPlanRef.current = nextPlan;
      setTestPlan(nextPlan);

      const result = await persistProjectDataToBackend(
        { testPlan: nextPlan },
        options
      );

      if (!result.ok) {
        testPlanRef.current = previousPlan;
        setTestPlan(previousPlan);
        showToast(result.error || 'Failed to save test plan', 'danger');
        return result;
      }

      const persistedPlan =
        (result.project && result.project.testPlan) || nextPlan;
      testPlanRef.current = persistedPlan;
      setTestPlan(persistedPlan);

      appendActivity(
        'testplan',
        `Updated Test Plan "${persistedPlan.name}"`,
        persistedPlan.objective || 'Test plan details saved to server.'
      );
      if (!options.silentToast) {
        showToast('Test Plan saved', 'success');
      }

      return {
        ...result,
        testPlan: persistedPlan,
      };
    },
    [
      selectedProjectId,
      selectedProject,
      persistProjectDataToBackend,
      appendActivity,
      showToast,
    ]
  );

  const addTestPlanPhase = useCallback(
    async ({ name, description } = {}, options = {}) => {
      const trimmedName = typeof name === 'string' ? name.trim() : '';
      if (!trimmedName) {
        const errMsg = 'Phase name is required.';
        setProjectDataError(errMsg);
        return { ok: false, status: 400, error: errMsg };
      }

      const currentPlan = buildDefaultTestPlan({
        ...(selectedProject || {}),
        testPlan: testPlanRef.current,
      });
      const existingPhases = Array.isArray(currentPlan.phases)
        ? [...currentPlan.phases]
        : [];
      const nowIso = new Date().toISOString();
      const newPhase = {
        id: `ph_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: trimmedName,
        description: typeof description === 'string' ? description.trim() : '',
        order: existingPhases.length + 1,
        status: 'Active',
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      const nextPhases = [...existingPhases, newPhase];
      const res = await saveTestPlan(
        { phases: nextPhases },
        { ...options, silentToast: true }
      );
      if (res.ok) {
        showToast(`Added phase "${newPhase.name}"`, 'success');
      }
      return { ...res, phase: res.ok ? newPhase : null };
    },
    [selectedProject, saveTestPlan, showToast]
  );

  const updateTestPlanPhase = useCallback(
    async (phaseId, updates = {}, options = {}) => {
      const cleanPhaseId = typeof phaseId === 'string' ? phaseId.trim() : '';
      if (!cleanPhaseId) {
        return { ok: false, status: 400, error: 'Phase ID is required.' };
      }
      if (
        updates.name !== undefined &&
        (typeof updates.name !== 'string' || !updates.name.trim())
      ) {
        const errMsg = 'Phase name cannot be empty.';
        setProjectDataError(errMsg);
        return { ok: false, status: 400, error: errMsg };
      }

      const currentPlan = buildDefaultTestPlan({
        ...(selectedProject || {}),
        testPlan: testPlanRef.current,
      });
      const existingPhases = Array.isArray(currentPlan.phases)
        ? [...currentPlan.phases]
        : [];
      const idx = existingPhases.findIndex((p) => p.id === cleanPhaseId);
      if (idx === -1) {
        return { ok: false, status: 404, error: 'Testing phase not found.' };
      }

      const nowIso = new Date().toISOString();
      const updatedPhase = {
        ...existingPhases[idx],
        name:
          updates.name !== undefined
            ? updates.name.trim()
            : existingPhases[idx].name,
        description:
          updates.description !== undefined
            ? String(updates.description || '').trim()
            : existingPhases[idx].description,
        status: updates.status || existingPhases[idx].status || 'Active',
        updatedAt: nowIso,
      };
      existingPhases[idx] = updatedPhase;

      const res = await saveTestPlan(
        { phases: existingPhases },
        { ...options, silentToast: true }
      );
      if (res.ok) {
        showToast(`Updated phase "${updatedPhase.name}"`, 'success');
      }
      return { ...res, phase: res.ok ? updatedPhase : null };
    },
    [selectedProject, saveTestPlan, showToast]
  );

  const deleteTestPlanPhase = useCallback(
    async (phaseId, options = {}) => {
      const cleanPhaseId = typeof phaseId === 'string' ? phaseId.trim() : '';
      if (!cleanPhaseId) {
        return { ok: false, status: 400, error: 'Phase ID is required.' };
      }

      const currentPlan = buildDefaultTestPlan({
        ...(selectedProject || {}),
        testPlan: testPlanRef.current,
      });
      const existingPhases = Array.isArray(currentPlan.phases)
        ? currentPlan.phases
        : [];
      const targetPhase = existingPhases.find((p) => p.id === cleanPhaseId);
      if (!targetPhase) {
        return { ok: false, status: 404, error: 'Testing phase not found.' };
      }

      const nowIso = new Date().toISOString();
      const nextPhases = existingPhases
        .filter((p) => p.id !== cleanPhaseId)
        .map((p, idx) => ({ ...p, order: idx + 1 }));
      const nextPlan = {
        ...currentPlan,
        phases: nextPhases,
        updatedAt: nowIso,
      };

      const prevPlan = testPlanRef.current;
      const prevSuites = suitesRef.current;
      const nextSuites = prevSuites.map((s) =>
        s.phaseId === cleanPhaseId
          ? { ...s, phaseId: null, updatedAt: nowIso }
          : s
      );

      testPlanRef.current = nextPlan;
      suitesRef.current = nextSuites;
      setTestPlan(nextPlan);
      setSuites(nextSuites);

      const { testSuites, summaryCounts } = buildBackendTestSuitesPayload(
        nextSuites,
        testCasesRef.current
      );

      const result = await persistProjectDataToBackend(
        {
          testPlan: nextPlan,
          testSuites,
          ...summaryCounts,
        },
        options
      );

      if (!result.ok) {
        testPlanRef.current = prevPlan;
        suitesRef.current = prevSuites;
        setTestPlan(prevPlan);
        setSuites(prevSuites);
        showToast(result.error || 'Failed to delete phase', 'danger');
        return result;
      }

      showToast(`Deleted phase "${targetPhase.name}"`, 'info');
      return result;
    },
    [selectedProject, persistProjectDataToBackend, showToast]
  );

  // =========================================================================
  // 2. TEST SUITE MANAGEMENT (Phase 2C)
  // =========================================================================

  const createSuite = useCallback(
    async (
      { name, description, category, phaseId, tags } = {},
      options = {}
    ) => {
      const trimmedName = typeof name === 'string' ? name.trim() : '';
      if (!trimmedName) {
        const errMsg = 'Test suite name is required.';
        setProjectDataError(errMsg);
        return { ok: false, status: 400, suite: null, error: errMsg };
      }

      const nowIso = new Date().toISOString();
      const newSuite = {
        id: `suite-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        phaseId: phaseId || null,
        name: trimmedName,
        category:
          typeof category === 'string' && category.trim()
            ? category.trim()
            : 'Functional',
        tags: Array.isArray(tags)
          ? tags.filter((t) => typeof t === 'string').map((t) => t.trim())
          : [],
        description: typeof description === 'string' ? description.trim() : '',
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      const prevSuites = suitesRef.current;
      const nextSuites = [...prevSuites, newSuite];
      suitesRef.current = nextSuites;
      setSuites(nextSuites);

      const { testSuites, summaryCounts } = buildBackendTestSuitesPayload(
        nextSuites,
        testCasesRef.current
      );

      const result = await persistProjectDataToBackend(
        {
          testSuites,
          ...summaryCounts,
        },
        options
      );

      if (!result.ok) {
        suitesRef.current = prevSuites;
        setSuites(prevSuites);
        showToast(result.error || 'Failed to create suite', 'danger');
        return { ...result, suite: null };
      }

      appendActivity(
        'suite',
        `Created suite "${newSuite.name}"`,
        newSuite.description || `Category: ${newSuite.category}`
      );
      showToast(`Test Suite "${newSuite.name}" created`, 'success');
      return { ...result, suite: newSuite };
    },
    [persistProjectDataToBackend, appendActivity, showToast]
  );

  const updateSuite = useCallback(
    async (suiteId, updates = {}, options = {}) => {
      const cleanId = typeof suiteId === 'string' ? suiteId.trim() : '';
      if (!cleanId) {
        return {
          ok: false,
          status: 400,
          suite: null,
          error: 'Suite ID is required.',
        };
      }

      const prevSuites = suitesRef.current;
      const existingSuite = prevSuites.find((s) => s.id === cleanId);
      if (!existingSuite) {
        return {
          ok: false,
          status: 404,
          suite: null,
          error: 'Test suite not found.',
        };
      }

      if (
        updates.name !== undefined &&
        (typeof updates.name !== 'string' || !updates.name.trim())
      ) {
        const errMsg = 'Test suite name cannot be empty.';
        setProjectDataError(errMsg);
        return { ok: false, status: 400, suite: null, error: errMsg };
      }

      const nowIso = new Date().toISOString();
      const updatedSuite = {
        ...existingSuite,
        name:
          updates.name !== undefined
            ? updates.name.trim()
            : existingSuite.name,
        description:
          updates.description !== undefined
            ? String(updates.description || '').trim()
            : existingSuite.description,
        category:
          updates.category !== undefined && String(updates.category).trim()
            ? String(updates.category).trim()
            : existingSuite.category || 'Functional',
        phaseId:
          updates.phaseId !== undefined
            ? updates.phaseId || null
            : existingSuite.phaseId || null,
        tags: Array.isArray(updates.tags)
          ? updates.tags
              .filter((t) => typeof t === 'string')
              .map((t) => t.trim())
          : existingSuite.tags || [],
        updatedAt: nowIso,
      };

      const nextSuites = prevSuites.map((s) =>
        s.id === cleanId ? updatedSuite : s
      );
      const prevCases = testCasesRef.current;
      const nextCases = prevCases.map((tc) =>
        tc.suiteId === cleanId
          ? { ...tc, suiteName: updatedSuite.name, updatedAt: formatTimestamp() }
          : tc
      );

      suitesRef.current = nextSuites;
      testCasesRef.current = nextCases;
      setSuites(nextSuites);
      setTestCases(nextCases);

      const { testSuites, summaryCounts } = buildBackendTestSuitesPayload(
        nextSuites,
        nextCases
      );

      const result = await persistProjectDataToBackend(
        {
          testSuites,
          ...summaryCounts,
        },
        options
      );

      if (!result.ok) {
        suitesRef.current = prevSuites;
        testCasesRef.current = prevCases;
        setSuites(prevSuites);
        setTestCases(prevCases);
        showToast(result.error || 'Failed to update suite', 'danger');
        return { ...result, suite: null };
      }

      appendActivity(
        'suite',
        `Updated suite "${updatedSuite.name}"`,
        updatedSuite.description || `Category: ${updatedSuite.category}`
      );
      showToast(`Updated suite "${updatedSuite.name}"`, 'success');
      return { ...result, suite: updatedSuite };
    },
    [persistProjectDataToBackend, appendActivity, showToast]
  );

  const deleteSuite = useCallback(
    async (suiteId, options = {}) => {
      const cleanId = typeof suiteId === 'string' ? suiteId.trim() : '';
      const prevSuites = suitesRef.current;
      const target = prevSuites.find((s) => s.id === cleanId);
      if (!target) {
        return { ok: false, status: 404, error: 'Test suite not found.' };
      }

      const { moveCasesToSuiteId, ...requestOptions } = options || {};
      const nextSuites = prevSuites.filter((s) => s.id !== cleanId);
      const prevCases = testCasesRef.current;
      const prevRuns = testRunsRef.current;
      const prevDefects = defectsRef.current;

      let nextCases;
      let nextRuns = prevRuns;
      let nextDefects = prevDefects;
      let destinationSuite = null;
      if (moveCasesToSuiteId && moveCasesToSuiteId !== cleanId) {
        destinationSuite = nextSuites.find((s) => s.id === moveCasesToSuiteId);
      }

      if (destinationSuite) {
        const now = formatTimestamp();
        nextCases = prevCases.map((tc) =>
          tc.suiteId === cleanId
            ? {
                ...tc,
                suiteId: destinationSuite.id,
                suiteName: destinationSuite.name,
                updatedAt: now,
              }
            : tc
        );
      } else {
        const removedCaseIds = new Set(
          prevCases.filter((tc) => tc.suiteId === cleanId).map((tc) => tc.id)
        );
        nextCases = prevCases.filter((tc) => tc.suiteId !== cleanId);
        if (removedCaseIds.size > 0) {
          nextRuns = prevRuns.map((run) => {
            const filteredResults = run.results.filter(
              (r) => !removedCaseIds.has(r.testCaseId)
            );
            return {
              ...run,
              results: filteredResults,
              metrics: computeRunMetrics(filteredResults),
            };
          });
          nextDefects = prevDefects.map((bug) =>
            removedCaseIds.has(bug.linkedTestCaseId)
              ? { ...bug, linkedTestCaseId: null }
              : bug
          );
          if (selectedTestCaseId && removedCaseIds.has(selectedTestCaseId)) {
            setSelectedTestCaseId(null);
          }
        }
      }

      suitesRef.current = nextSuites;
      testCasesRef.current = nextCases;
      testRunsRef.current = nextRuns;
      defectsRef.current = nextDefects;
      setSuites(nextSuites);
      setTestCases(nextCases);
      setTestRuns(nextRuns);
      setDefects(nextDefects);

      const { testSuites, summaryCounts } = buildBackendTestSuitesPayload(
        nextSuites,
        nextCases
      );
      const { executionRuns, activeRun } = buildBackendExecutionsAndRunsPayload(
        nextRuns,
        executionsRef.current
      );
      const { defects: serializedDefects, defectSummaryCounts } =
        buildBackendDefectsPayload(nextDefects);

      const result = await persistProjectDataToBackend(
        {
          testSuites,
          executionRuns,
          activeRun,
          defects: serializedDefects,
          ...summaryCounts,
          ...defectSummaryCounts,
        },
        requestOptions
      );

      if (!result.ok) {
        suitesRef.current = prevSuites;
        testCasesRef.current = prevCases;
        testRunsRef.current = prevRuns;
        defectsRef.current = prevDefects;
        setSuites(prevSuites);
        setTestCases(prevCases);
        setTestRuns(prevRuns);
        setDefects(prevDefects);
        showToast(result.error || 'Failed to delete suite', 'danger');
        return result;
      }

      appendActivity(
        'suite',
        `Deleted suite "${target.name}"`,
        destinationSuite
          ? `Moved cases to "${destinationSuite.name}".`
          : 'Suite removed from project workspace.'
      );
      showToast(`Deleted suite "${target.name}"`, 'info');
      return result;
    },
    [
      selectedTestCaseId,
      persistProjectDataToBackend,
      appendActivity,
      showToast,
    ]
  );

  // =========================================================================
  // 3. TEST CASE MANAGEMENT (Phase 2C)
  // =========================================================================

  const createTestCase = useCallback(
    async (
      {
        suiteId,
        title,
        description,
        preconditions,
        priority,
        testType,
        category,
        tags,
        steps,
        expectedResult,
        status,
        lastStatus,
      } = {},
      options = {}
    ) => {
      const trimmedTitle = typeof title === 'string' ? title.trim() : '';
      if (!trimmedTitle) {
        const errMsg = 'Test case title is required.';
        setProjectDataError(errMsg);
        return { ok: false, status: 400, testCase: null, error: errMsg };
      }

      const prevSuites = suitesRef.current;
      const prevCases = testCasesRef.current;

      const maxNum = prevCases.reduce((max, tc) => {
        const m = String(tc.id || tc.testCaseId || '').match(/TC-(\d+)/i);
        return m ? Math.max(max, parseInt(m[1], 10)) : max;
      }, 100);
      const newId = `TC-${maxNum + 1}`;
      const now = formatTimestamp();
      const nowIso = new Date().toISOString();

      let nextSuites = prevSuites;
      let suiteObj =
        prevSuites.find((s) => s.id === suiteId) || prevSuites[0] || null;

      if (!suiteObj) {
        suiteObj = {
          id: suiteId || `suite-${Date.now()}`,
          phaseId: null,
          name: 'General QA Suite',
          category: 'Functional',
          tags: [],
          description: 'Default test suite',
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        nextSuites = [suiteObj];
      }

      const formattedSteps = (Array.isArray(steps) ? steps : [])
        .map((st, idx) => normalizeTestStep(st, idx))
        .filter((st) => st.action);

      const resolvedType =
        (typeof testType === 'string' && testType.trim()) ||
        (typeof category === 'string' && category.trim()) ||
        'Functional';

      const resolvedLastStatus = normalizeCaseLastStatus(lastStatus || status);

      const newCase = {
        id: newId,
        testCaseId: newId,
        suiteId: suiteObj.id,
        suiteName: suiteObj.name,
        title: trimmedTitle,
        description: typeof description === 'string' ? description.trim() : '',
        preconditions:
          typeof preconditions === 'string' && preconditions.trim()
            ? preconditions.trim()
            : 'Standard application state.',
        priority: priority || 'P1',
        category: resolvedType,
        testType: resolvedType,
        tags: Array.isArray(tags)
          ? tags.filter((t) => typeof t === 'string').map((t) => t.trim())
          : [],
        steps:
          formattedSteps.length > 0
            ? formattedSteps
            : [
                {
                  id: `step-${Date.now()}-0`,
                  stepNumber: 1,
                  action: 'Execute feature workflow as described.',
                  testData: '',
                  expectedResult:
                    typeof expectedResult === 'string' && expectedResult.trim()
                      ? expectedResult.trim()
                      : 'Expected behavior verified.',
                },
              ],
        expectedResult:
          typeof expectedResult === 'string' && expectedResult.trim()
            ? expectedResult.trim()
            : 'All test steps pass without error.',
        status: toBackendCaseStatus(resolvedLastStatus),
        lastStatus: resolvedLastStatus,
        lastExecution: null,
        createdAt: now,
        updatedAt: now,
      };

      const nextCases = [newCase, ...prevCases];
      suitesRef.current = nextSuites;
      testCasesRef.current = nextCases;
      setSuites(nextSuites);
      setTestCases(nextCases);

      const { testSuites, summaryCounts } = buildBackendTestSuitesPayload(
        nextSuites,
        nextCases
      );

      const result = await persistProjectDataToBackend(
        {
          testSuites,
          ...summaryCounts,
        },
        options
      );

      if (!result.ok) {
        suitesRef.current = prevSuites;
        testCasesRef.current = prevCases;
        setSuites(prevSuites);
        setTestCases(prevCases);
        showToast(result.error || 'Failed to create test case', 'danger');
        return { ...result, testCase: null };
      }

      appendActivity(
        'testcase',
        `Created ${newId}: ${newCase.title}`,
        `Suite: ${newCase.suiteName} · Priority: ${newCase.priority}`
      );
      showToast(`Created test case ${newId}`, 'success');
      return { ...result, testCase: newCase };
    },
    [persistProjectDataToBackend, appendActivity, showToast]
  );

  const updateTestCase = useCallback(
    async (testCaseId, updates = {}, options = {}) => {
      const cleanCaseId =
        typeof testCaseId === 'string' ? testCaseId.trim() : '';
      const prevCases = testCasesRef.current;
      const existingCase = prevCases.find((tc) => tc.id === cleanCaseId);
      if (!existingCase) {
        return {
          ok: false,
          status: 404,
          testCase: null,
          error: 'Test case not found.',
        };
      }

      if (
        updates.title !== undefined &&
        (typeof updates.title !== 'string' || !updates.title.trim())
      ) {
        const errMsg = 'Test case title cannot be empty.';
        setProjectDataError(errMsg);
        return { ok: false, status: 400, testCase: null, error: errMsg };
      }

      const now = formatTimestamp();
      const currentSuites = suitesRef.current;
      const suiteObj = updates.suiteId
        ? currentSuites.find((s) => s.id === updates.suiteId)
        : currentSuites.find((s) => s.id === existingCase.suiteId);

      const nextSteps = Array.isArray(updates.steps)
        ? updates.steps
            .map((st, idx) => normalizeTestStep(st, idx))
            .filter((st) => st.action)
        : existingCase.steps;

      const resolvedType =
        (typeof updates.testType === 'string' && updates.testType.trim()) ||
        (typeof updates.category === 'string' && updates.category.trim()) ||
        existingCase.testType ||
        existingCase.category ||
        'Functional';

      const resolvedLastStatus =
        updates.lastStatus !== undefined || updates.status !== undefined
          ? normalizeCaseLastStatus(updates.lastStatus || updates.status)
          : existingCase.lastStatus;

      const updatedCase = {
        ...existingCase,
        ...updates,
        title:
          updates.title !== undefined
            ? updates.title.trim()
            : existingCase.title,
        description:
          updates.description !== undefined
            ? String(updates.description || '').trim()
            : existingCase.description,
        preconditions:
          updates.preconditions !== undefined
            ? String(updates.preconditions || '').trim() ||
              'Standard application state.'
            : existingCase.preconditions,
        expectedResult:
          updates.expectedResult !== undefined
            ? String(updates.expectedResult || '').trim() ||
              'All test steps pass without error.'
            : existingCase.expectedResult,
        suiteId: suiteObj
          ? suiteObj.id
          : updates.suiteId || existingCase.suiteId,
        suiteName: suiteObj
          ? suiteObj.name
          : updates.suiteName || existingCase.suiteName,
        category: resolvedType,
        testType: resolvedType,
        tags: Array.isArray(updates.tags)
          ? updates.tags
              .filter((t) => typeof t === 'string')
              .map((t) => t.trim())
          : existingCase.tags || [],
        steps: nextSteps.length > 0 ? nextSteps : existingCase.steps,
        status: toBackendCaseStatus(resolvedLastStatus),
        lastStatus: resolvedLastStatus,
        updatedAt: now,
      };

      const nextCases = prevCases.map((tc) =>
        tc.id === cleanCaseId ? updatedCase : tc
      );
      testCasesRef.current = nextCases;
      setTestCases(nextCases);

      const { testSuites, summaryCounts } = buildBackendTestSuitesPayload(
        currentSuites,
        nextCases
      );

      const result = await persistProjectDataToBackend(
        {
          testSuites,
          ...summaryCounts,
        },
        options
      );

      if (!result.ok) {
        testCasesRef.current = prevCases;
        setTestCases(prevCases);
        showToast(result.error || 'Failed to update test case', 'danger');
        return { ...result, testCase: null };
      }

      appendActivity(
        'testcase',
        `Updated test case ${cleanCaseId}`,
        updatedCase.title || 'Test case details modified.'
      );
      if (!options.silentToast) {
        showToast(`Updated ${cleanCaseId}`, 'success');
      }
      return { ...result, testCase: updatedCase };
    },
    [persistProjectDataToBackend, appendActivity, showToast]
  );

  const moveTestCaseToSuite = useCallback(
    async (testCaseId, targetSuiteId, options = {}) => {
      const cleanCaseId =
        typeof testCaseId === 'string' ? testCaseId.trim() : '';
      const cleanSuiteId =
        typeof targetSuiteId === 'string' ? targetSuiteId.trim() : '';

      const targetSuite = suitesRef.current.find((s) => s.id === cleanSuiteId);
      if (!targetSuite) {
        const errMsg = 'Target test suite not found.';
        setProjectDataError(errMsg);
        return { ok: false, status: 404, testCase: null, error: errMsg };
      }

      const res = await updateTestCase(
        cleanCaseId,
        {
          suiteId: targetSuite.id,
          suiteName: targetSuite.name,
        },
        { ...options, silentToast: true }
      );

      if (res.ok) {
        showToast(`Moved ${cleanCaseId} to "${targetSuite.name}"`, 'success');
      }
      return res;
    },
    [updateTestCase, showToast]
  );

  const deleteTestCase = useCallback(
    async (testCaseId, options = {}) => {
      const cleanCaseId =
        typeof testCaseId === 'string' ? testCaseId.trim() : '';
      const prevCases = testCasesRef.current;
      const target = prevCases.find((tc) => tc.id === cleanCaseId);
      if (!target) {
        return { ok: false, status: 404, error: 'Test case not found.' };
      }

      const prevRuns = testRunsRef.current;
      const prevDefects = defectsRef.current;

      const nextCases = prevCases.filter((tc) => tc.id !== cleanCaseId);
      const nextRuns = prevRuns.map((run) => {
        const nextResults = run.results.filter(
          (r) => r.testCaseId !== cleanCaseId && r.caseId !== cleanCaseId
        );
        return {
          ...run,
          results: nextResults,
          metrics: computeRunMetrics(nextResults),
        };
      });
      const nextDefects = prevDefects.map((bug) =>
        bug.linkedTestCaseId === cleanCaseId
          ? { ...bug, linkedTestCaseId: null }
          : bug
      );

      testCasesRef.current = nextCases;
      testRunsRef.current = nextRuns;
      defectsRef.current = nextDefects;
      setTestCases(nextCases);
      setTestRuns(nextRuns);
      setDefects(nextDefects);

      if (selectedTestCaseId === cleanCaseId) {
        setSelectedTestCaseId(null);
      }

      const { testSuites, summaryCounts } = buildBackendTestSuitesPayload(
        suitesRef.current,
        nextCases
      );
      const { executionRuns, activeRun } = buildBackendExecutionsAndRunsPayload(
        nextRuns,
        executionsRef.current
      );
      const { defects: serializedDefects, defectSummaryCounts } =
        buildBackendDefectsPayload(nextDefects);

      const result = await persistProjectDataToBackend(
        {
          testSuites,
          executionRuns,
          activeRun,
          defects: serializedDefects,
          ...summaryCounts,
          ...defectSummaryCounts,
        },
        options
      );

      if (!result.ok) {
        testCasesRef.current = prevCases;
        testRunsRef.current = prevRuns;
        defectsRef.current = prevDefects;
        setTestCases(prevCases);
        setTestRuns(prevRuns);
        setDefects(prevDefects);
        showToast(result.error || 'Failed to delete test case', 'danger');
        return result;
      }

      appendActivity(
        'testcase',
        `Deleted test case ${cleanCaseId}`,
        target.title || 'Removed from repository.'
      );
      showToast(`Deleted ${cleanCaseId}`, 'info');
      return result;
    },
    [
      selectedTestCaseId,
      persistProjectDataToBackend,
      appendActivity,
      showToast,
    ]
  );

  // =========================================================================
  // 4. TEST RUNS & EXECUTION MANAGEMENT (Phase 2D)
  // =========================================================================

  /**
   * Creates a new Test Run with selected test cases and persists via `PATCH /api/projects/:id/data`.
   */
  const createTestRun = useCallback(
    async (
      {
        name,
        suiteId,
        buildVersion,
        deviceInfo,
        environment,
        tester,
        notes,
        testCaseIds,
      } = {},
      options = {}
    ) => {
      const trimmedName = typeof name === 'string' ? name.trim() : '';
      if (!trimmedName) {
        const errMsg = 'Test Run name is required.';
        setProjectDataError(errMsg);
        return { ok: false, status: 400, testRun: null, error: errMsg };
      }

      const prevRuns = testRunsRef.current;
      const currentCases = testCasesRef.current;
      const currentSuites = suitesRef.current;

      let includedCases = currentCases;
      let suiteLabel = 'All Suites';
      const resolvedSuiteId = suiteId || 'all';

      if (resolvedSuiteId && resolvedSuiteId !== 'all') {
        const suiteObj = currentSuites.find((s) => s.id === resolvedSuiteId);
        if (suiteObj) {
          suiteLabel = suiteObj.name;
          includedCases = currentCases.filter(
            (tc) => tc.suiteId === resolvedSuiteId
          );
        }
      }
      if (Array.isArray(testCaseIds) && testCaseIds.length > 0) {
        const idSet = new Set(testCaseIds);
        includedCases = currentCases.filter((tc) => idSet.has(tc.id));
      }

      if (includedCases.length === 0) {
        const errMsg =
          'Select at least one test case to include in the Test Run.';
        setProjectDataError(errMsg);
        return { ok: false, status: 400, testRun: null, error: errMsg };
      }

      const maxNum = prevRuns.reduce((max, r) => {
        const m = String(r.id || '').match(/RUN-(\d+)/i);
        return m ? Math.max(max, parseInt(m[1], 10)) : max;
      }, 200);
      const newId = `RUN-${maxNum + 1}`;
      const now = formatTimestamp();
      const nowIso = new Date().toISOString();

      const resolvedBuild = (
        buildVersion ||
        (selectedProject && selectedProject.version) ||
        profile.defaultBuild ||
        '1.0.0'
      ).trim();
      const resolvedDevice = (
        deviceInfo ||
        profile.defaultDevice ||
        'Android Device'
      ).trim();
      const resolvedEnv = (
        environment ||
        (selectedProject && selectedProject.environment) ||
        'Staging'
      ).trim();
      const resolvedTester = (
        tester ||
        (user && user.name) ||
        profile.testerName ||
        'QA Engineer'
      ).trim();

      const results = includedCases.map((tc) => ({
        testCaseId: tc.id,
        caseId: tc.id,
        caseTitle: tc.title,
        suiteId: tc.suiteId,
        suiteName: tc.suiteName,
        status: 'Untested',
        outcome: 'Not Run',
        actualResult: '',
        notes: '',
        tester: resolvedTester,
        environment: resolvedEnv,
        device: resolvedDevice,
        buildVersion: resolvedBuild,
        stepStatuses: {},
        executedAt: null,
        linkedDefectId: null,
      }));

      const newRun = {
        id: newId,
        name: trimmedName,
        suiteId: resolvedSuiteId,
        suiteName: suiteLabel,
        buildVersion: resolvedBuild,
        deviceInfo: resolvedDevice,
        environment: resolvedEnv,
        tester: resolvedTester,
        notes: typeof notes === 'string' ? notes.trim() : '',
        status: 'In Progress',
        startedAt: nowIso,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
        metrics: computeRunMetrics(results),
        results,
      };

      const nextRuns = [newRun, ...prevRuns];
      testRunsRef.current = nextRuns;
      setTestRuns(nextRuns);
      setSelectedTestRunId(newRun.id);

      const { executionRuns, activeRun, executions: serializedExecs } =
        buildBackendExecutionsAndRunsPayload(nextRuns, executionsRef.current);

      const result = await persistProjectDataToBackend(
        {
          executionRuns,
          activeRun,
          executions: serializedExecs,
        },
        options
      );

      if (!result.ok) {
        testRunsRef.current = prevRuns;
        setTestRuns(prevRuns);
        showToast(result.error || 'Failed to create test run', 'danger');
        return { ...result, testRun: null };
      }

      appendActivity(
        'execution',
        `Created Test Run ${newId}: ${newRun.name}`,
        `${results.length} test cases queued on ${newRun.deviceInfo}`
      );
      showToast(`Created ${newId} with ${results.length} test cases`, 'success');
      return { ...result, testRun: newRun };
    },
    [
      selectedProject,
      profile,
      user,
      persistProjectDataToBackend,
      appendActivity,
      showToast,
    ]
  );

  /**
   * Updates an existing Test Run's metadata or status (`In Progress` | `Completed`)
   * and persists via `PATCH /api/projects/:id/data`.
   */
  const updateTestRun = useCallback(
    async (testRunId, updates = {}, options = {}) => {
      const cleanRunId =
        typeof testRunId === 'string' ? testRunId.trim() : '';
      const prevRuns = testRunsRef.current;
      const existingRun = prevRuns.find((r) => r.id === cleanRunId);
      if (!existingRun) {
        return {
          ok: false,
          status: 404,
          testRun: null,
          error: 'Test run not found.',
        };
      }

      if (
        updates.name !== undefined &&
        (typeof updates.name !== 'string' || !updates.name.trim())
      ) {
        const errMsg = 'Test Run name cannot be empty.';
        setProjectDataError(errMsg);
        return { ok: false, status: 400, testRun: null, error: errMsg };
      }

      const now = formatTimestamp();
      const nowIso = new Date().toISOString();
      const nextStatus =
        updates.status === 'Completed'
          ? 'Completed'
          : updates.status === 'In Progress'
          ? 'In Progress'
          : existingRun.status;

      const currentSuites = suitesRef.current;
      const currentCases = testCasesRef.current;
      const nextSuiteId =
        updates.suiteId !== undefined ? updates.suiteId : existingRun.suiteId;
      let nextSuiteName = existingRun.suiteName || 'All Suites';
      if (nextSuiteId && nextSuiteId !== 'all' && nextSuiteId !== 'ALL') {
        const matchedSuite = currentSuites.find((s) => s.id === nextSuiteId);
        if (matchedSuite) nextSuiteName = matchedSuite.name;
      } else {
        nextSuiteName = 'All Suites';
      }

      let nextResults = existingRun.results || [];
      if (Array.isArray(updates.testCaseIds) && updates.testCaseIds.length > 0) {
        const existingMap = new Map(
          nextResults.map((r) => [r.testCaseId || r.caseId, r])
        );
        const idSet = new Set(updates.testCaseIds);
        const selectedCases = currentCases.filter((tc) => idSet.has(tc.id));
        nextResults = selectedCases.map((tc) => {
          const prevRes = existingMap.get(tc.id);
          if (prevRes) {
            return {
              ...prevRes,
              caseTitle: tc.title,
              suiteId: tc.suiteId,
              suiteName: tc.suiteName,
            };
          }
          return {
            testCaseId: tc.id,
            caseId: tc.id,
            caseTitle: tc.title,
            suiteId: tc.suiteId,
            suiteName: tc.suiteName,
            status: 'Untested',
            outcome: 'Not Run',
            actualResult: '',
            notes: '',
            tester: existingRun.tester || 'QA Engineer',
            environment: existingRun.environment || 'Staging',
            device: existingRun.deviceInfo || 'Android Device',
            buildVersion: existingRun.buildVersion || '1.0.0',
            stepStatuses: {},
            executedAt: null,
            linkedDefectId: null,
          };
        });
      }

      const updatedRun = {
        ...existingRun,
        name:
          updates.name !== undefined ? updates.name.trim() : existingRun.name,
        suiteId: nextSuiteId,
        suiteName: nextSuiteName,
        buildVersion:
          updates.buildVersion !== undefined
            ? String(updates.buildVersion || '').trim()
            : existingRun.buildVersion,
        deviceInfo:
          updates.deviceInfo !== undefined
            ? String(updates.deviceInfo || '').trim()
            : existingRun.deviceInfo,
        environment:
          updates.environment !== undefined
            ? String(updates.environment || '').trim()
            : existingRun.environment,
        tester:
          updates.tester !== undefined
            ? String(updates.tester || '').trim()
            : existingRun.tester,
        notes:
          updates.notes !== undefined
            ? String(updates.notes || '').trim()
            : existingRun.notes,
        status: nextStatus,
        completedAt:
          nextStatus === 'Completed'
            ? existingRun.completedAt || nowIso
            : null,
        updatedAt: now,
        results: nextResults,
        metrics: computeRunMetrics(nextResults),
      };

      const nextRuns = prevRuns.map((r) =>
        r.id === cleanRunId ? updatedRun : r
      );
      testRunsRef.current = nextRuns;
      setTestRuns(nextRuns);

      const { executionRuns, activeRun, executions: serializedExecs } =
        buildBackendExecutionsAndRunsPayload(nextRuns, executionsRef.current);

      const result = await persistProjectDataToBackend(
        {
          executionRuns,
          activeRun,
          executions: serializedExecs,
        },
        options
      );

      if (!result.ok) {
        testRunsRef.current = prevRuns;
        setTestRuns(prevRuns);
        showToast(result.error || 'Failed to update test run', 'danger');
        return { ...result, testRun: null };
      }

      appendActivity(
        'execution',
        `Updated Test Run ${cleanRunId}`,
        `Status: ${updatedRun.status} · ${updatedRun.name}`
      );
      showToast(`Updated ${cleanRunId}`, 'success');
      return { ...result, testRun: updatedRun };
    },
    [persistProjectDataToBackend, appendActivity, showToast]
  );

  /**
   * Completes a Test Run (`status: 'Completed'`), matching `completeExecutionRun` in Qavora Web.
   */
  const completeTestRun = useCallback(
    async (testRunId, options = {}) => {
      return updateTestRun(testRunId, { status: 'Completed' }, options);
    },
    [updateTestRun]
  );

  /**
   * Reopens a completed Test Run (`status: 'In Progress'`).
   */
  const reopenTestRun = useCallback(
    async (testRunId, options = {}) => {
      return updateTestRun(testRunId, { status: 'In Progress' }, options);
    },
    [updateTestRun]
  );

  /**
   * Records or updates a Test Case execution result inside a Test Run (or standalone),
   * appends/updates `executions` history, updates `testCase.lastStatus` & `lastExecution`,
   * and persists atomically via `PATCH /api/projects/:id/data`.
   */
  const recordTestExecution = useCallback(
    async (
      {
        testRunId,
        testCaseId,
        status,
        actualResult,
        notes,
        tester,
        environment,
        device,
        buildVersion,
        stepStatuses,
        linkedDefectId,
      } = {},
      options = {}
    ) => {
      const cleanCaseId =
        typeof testCaseId === 'string' ? testCaseId.trim() : '';
      if (!cleanCaseId) {
        return {
          ok: false,
          status: 400,
          error: 'Test case ID is required to record execution.',
        };
      }

      const normStatus = normalizeCaseLastStatus(status);
      const webOutcome = toWebExecutionOutcome(normStatus);
      const now = formatTimestamp();
      const nowIso = new Date().toISOString();

      const prevRuns = testRunsRef.current;
      const prevCases = testCasesRef.current;
      const prevExecs = executionsRef.current;

      const targetRun = testRunId
        ? prevRuns.find((r) => r.id === testRunId)
        : prevRuns[0] || null;
      const targetCase = prevCases.find((tc) => tc.id === cleanCaseId);

      const resolvedTester =
        (typeof tester === 'string' && tester.trim()) ||
        (targetRun && targetRun.tester) ||
        (user && user.name) ||
        profile.testerName ||
        'QA Engineer';
      const resolvedEnv =
        (typeof environment === 'string' && environment.trim()) ||
        (targetRun && targetRun.environment) ||
        (selectedProject && selectedProject.environment) ||
        'Staging';
      const resolvedDevice =
        (typeof device === 'string' && device.trim()) ||
        (targetRun && targetRun.deviceInfo) ||
        profile.defaultDevice ||
        'Android Device';
      const resolvedBuild =
        (typeof buildVersion === 'string' && buildVersion.trim()) ||
        (targetRun && targetRun.buildVersion) ||
        (selectedProject && selectedProject.version) ||
        profile.defaultBuild ||
        '1.0.0';

      const resolvedActualResult =
        actualResult !== undefined
          ? String(actualResult).trim()
          : normStatus === 'Passed'
          ? 'Expected result verified.'
          : normStatus === 'Untested'
          ? ''
          : `Status recorded as ${webOutcome}.`;

      // 1. Update target Test Run results & metrics
      const nextRuns = prevRuns.map((run) => {
        if (!targetRun || run.id !== targetRun.id) return run;
        const caseExistsInRun = run.results.some(
          (res) => res.testCaseId === cleanCaseId || res.caseId === cleanCaseId
        );
        let updatedResults;
        if (caseExistsInRun) {
          updatedResults = run.results.map((res) => {
            if (res.testCaseId !== cleanCaseId && res.caseId !== cleanCaseId) {
              return res;
            }
            return {
              ...res,
              status: normStatus,
              outcome: webOutcome,
              actualResult:
                actualResult !== undefined
                  ? resolvedActualResult
                  : res.actualResult,
              notes:
                notes !== undefined ? String(notes).trim() : res.notes || '',
              tester: resolvedTester,
              environment: resolvedEnv,
              device: resolvedDevice,
              buildVersion: resolvedBuild,
              stepStatuses:
                stepStatuses && typeof stepStatuses === 'object'
                  ? stepStatuses
                  : res.stepStatuses || {},
              executedAt: normStatus === 'Untested' ? null : now,
              linkedDefectId:
                linkedDefectId !== undefined
                  ? linkedDefectId
                  : res.linkedDefectId,
            };
          });
        } else {
          updatedResults = [
            ...run.results,
            {
              testCaseId: cleanCaseId,
              caseId: cleanCaseId,
              caseTitle: targetCase ? targetCase.title : cleanCaseId,
              suiteId: targetCase ? targetCase.suiteId : '',
              suiteName: targetCase ? targetCase.suiteName : run.suiteName,
              status: normStatus,
              outcome: webOutcome,
              actualResult: resolvedActualResult,
              notes: notes ? String(notes).trim() : '',
              tester: resolvedTester,
              environment: resolvedEnv,
              device: resolvedDevice,
              buildVersion: resolvedBuild,
              stepStatuses:
                stepStatuses && typeof stepStatuses === 'object'
                  ? stepStatuses
                  : {},
              executedAt: normStatus === 'Untested' ? null : now,
              linkedDefectId: linkedDefectId || null,
            },
          ];
        }

        const allTested =
          updatedResults.length > 0 &&
          updatedResults.every(
            (r) => normalizeCaseLastStatus(r.status) !== 'Untested'
          );

        return {
          ...run,
          status: allTested ? 'Completed' : 'In Progress',
          completedAt: allTested ? run.completedAt || nowIso : null,
          updatedAt: now,
          metrics: computeRunMetrics(updatedResults),
          results: updatedResults,
        };
      });

      // 2. Append execution record to `executions` history
      const execRecord = {
        id: `exec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        runId: targetRun ? targetRun.id : null,
        runName: targetRun ? targetRun.name : 'Standalone Execution',
        caseId: cleanCaseId,
        testCaseId: cleanCaseId,
        caseTitle: targetCase ? targetCase.title : cleanCaseId,
        suiteId: targetCase ? targetCase.suiteId : '',
        suiteName: targetCase ? targetCase.suiteName : 'All Suites',
        status: webOutcome,
        outcome: webOutcome,
        normalizedStatus: normStatus,
        actualResult: resolvedActualResult,
        notes: notes ? String(notes).trim() : '',
        tester: resolvedTester,
        environment: resolvedEnv,
        device: resolvedDevice,
        buildVersion: resolvedBuild,
        stepStatuses:
          stepStatuses && typeof stepStatuses === 'object' ? stepStatuses : {},
        linkedDefectId: linkedDefectId || null,
        executedAt: nowIso,
      };
      const nextExecs = [execRecord, ...prevExecs];

      // 3. Sync `lastStatus`, `status`, and `lastExecution` on the corresponding TestCase
      const nextCases = prevCases.map((tc) =>
        tc.id === cleanCaseId
          ? {
              ...tc,
              status: toBackendCaseStatus(normStatus),
              lastStatus: normStatus,
              lastExecution: {
                status: webOutcome,
                actualResult: resolvedActualResult,
                executedAt: nowIso,
                tester: resolvedTester,
                runId: targetRun ? targetRun.id : null,
              },
              updatedAt: now,
            }
          : tc
      );

      testRunsRef.current = nextRuns;
      executionsRef.current = nextExecs;
      testCasesRef.current = nextCases;
      setTestRuns(nextRuns);
      setExecutions(nextExecs);
      setTestCases(nextCases);

      const { testSuites, summaryCounts } = buildBackendTestSuitesPayload(
        suitesRef.current,
        nextCases
      );
      const {
        executionRuns,
        activeRun,
        executions: serializedExecs,
      } = buildBackendExecutionsAndRunsPayload(nextRuns, nextExecs);

      const result = await persistProjectDataToBackend(
        {
          testSuites,
          executionRuns,
          activeRun,
          executions: serializedExecs,
          ...summaryCounts,
        },
        options
      );

      if (!result.ok) {
        testRunsRef.current = prevRuns;
        executionsRef.current = prevExecs;
        testCasesRef.current = prevCases;
        setTestRuns(prevRuns);
        setExecutions(prevExecs);
        setTestCases(prevCases);
        showToast(result.error || 'Failed to save execution result', 'danger');
        return { ...result, execution: null };
      }

      appendActivity(
        'execution',
        `Executed ${cleanCaseId}${targetRun ? ` in ${targetRun.id}` : ''} → ${normStatus}`,
        resolvedActualResult || `Marked as ${normStatus}`
      );
      if (!options.silentToast) {
        showToast(
          `${cleanCaseId} marked as ${normStatus}`,
          normStatus === 'Failed' ? 'danger' : 'success'
        );
      }

      return {
        ...result,
        execution: execRecord,
      };
    },
    [
      user,
      profile,
      selectedProject,
      persistProjectDataToBackend,
      appendActivity,
      showToast,
    ]
  );

  /**
   * Deletes a Test Run, unlinks any `linkedTestRunId` on defects, and persists via `PATCH /api/projects/:id/data`.
   */
  const deleteTestRun = useCallback(
    async (testRunId, options = {}) => {
      const cleanRunId =
        typeof testRunId === 'string' ? testRunId.trim() : '';
      const prevRuns = testRunsRef.current;
      const target = prevRuns.find((r) => r.id === cleanRunId);
      if (!target) {
        return { ok: false, status: 404, error: 'Test run not found.' };
      }

      const prevDefects = defectsRef.current;
      const nextRuns = prevRuns.filter((r) => r.id !== cleanRunId);
      const nextDefects = prevDefects.map((bug) =>
        bug.linkedTestRunId === cleanRunId
          ? { ...bug, linkedTestRunId: null }
          : bug
      );

      testRunsRef.current = nextRuns;
      defectsRef.current = nextDefects;
      setTestRuns(nextRuns);
      setDefects(nextDefects);

      if (selectedTestRunId === cleanRunId) {
        setSelectedTestRunId(nextRuns[0]?.id || null);
      }

      const { executionRuns, activeRun, executions: serializedExecs } =
        buildBackendExecutionsAndRunsPayload(nextRuns, executionsRef.current);
      const { defects: serializedDefects, defectSummaryCounts } =
        buildBackendDefectsPayload(nextDefects);

      const result = await persistProjectDataToBackend(
        {
          executionRuns,
          activeRun,
          executions: serializedExecs,
          defects: serializedDefects,
          ...defectSummaryCounts,
        },
        options
      );

      if (!result.ok) {
        testRunsRef.current = prevRuns;
        defectsRef.current = prevDefects;
        setTestRuns(prevRuns);
        setDefects(prevDefects);
        showToast(result.error || 'Failed to delete test run', 'danger');
        return result;
      }

      appendActivity(
        'execution',
        `Deleted Test Run ${cleanRunId}`,
        target.name || 'Removed test run.'
      );
      showToast(`Deleted ${cleanRunId}`, 'info');
      return result;
    },
    [
      selectedTestRunId,
      persistProjectDataToBackend,
      appendActivity,
      showToast,
    ]
  );

  // =========================================================================
  // 5. DEFECT MANAGEMENT (Phase 2D)
  // =========================================================================

  /**
   * Creates a new Defect report, links it to any specified `linkedTestCaseId`
   * and `linkedTestRunId`, and persists via `PATCH /api/projects/:id/data`.
   */
  const createDefect = useCallback(
    async (
      {
        title,
        description,
        severity,
        priority,
        status,
        steps,
        reproductionSteps,
        expectedResult,
        actualResult,
        environment,
        externalUrl,
        linkedTestCaseId,
        linkedTestRunId,
        linkedExecutionId,
      } = {},
      options = {}
    ) => {
      const trimmedTitle = typeof title === 'string' ? title.trim() : '';
      if (!trimmedTitle) {
        const errMsg = 'Defect title is required.';
        setProjectDataError(errMsg);
        return { ok: false, status: 400, defect: null, error: errMsg };
      }

      const stepsText = (
        (typeof reproductionSteps === 'string' && reproductionSteps.trim()) ||
        (typeof steps === 'string' && steps.trim()) ||
        ''
      ).trim();

      const actualText =
        typeof actualResult === 'string' ? actualResult.trim() : '';

      const prevDefects = defectsRef.current;
      const prevRuns = testRunsRef.current;
      const prevExecs = executionsRef.current;
      const currentCases = testCasesRef.current;

      const maxNum = prevDefects.reduce((max, bug) => {
        const m = String(bug.defectId || bug.id || '').match(
          /(?:DEF|BUG)-(\d+)/i
        );
        return m ? Math.max(max, parseInt(m[1], 10)) : max;
      }, 300);
      const newId = `BUG-${maxNum + 1}`;
      const defectDisplayId = `DEF-${String(prevDefects.length + 1).padStart(
        3,
        '0'
      )}`;
      const now = formatTimestamp();

      const matchedTc = linkedTestCaseId
        ? currentCases.find(
            (c) =>
              c.id === linkedTestCaseId || c.testCaseId === linkedTestCaseId
          )
        : null;

      const resolvedSeverity = DEFECT_SEVERITIES.includes(severity)
        ? severity
        : 'High';
      const resolvedPriority = DEFECT_PRIORITIES.includes(priority)
        ? priority
        : resolvedSeverity;
      const resolvedStatus = DEFECT_STATUSES.includes(status)
        ? status
        : 'Open';

      const newDefect = {
        id: newId,
        defectId: defectDisplayId,
        title: trimmedTitle,
        description:
          typeof description === 'string' ? description.trim() : '',
        severity: resolvedSeverity,
        priority: resolvedPriority,
        status: resolvedStatus,
        steps: stepsText,
        reproductionSteps: stepsText,
        expectedResult:
          typeof expectedResult === 'string' ? expectedResult.trim() : '',
        actualResult: actualText,
        environment:
          (typeof environment === 'string' && environment.trim()) ||
          (selectedProject && selectedProject.environment) ||
          `${profile.defaultDevice} · Build ${profile.defaultBuild}`,
        externalUrl:
          typeof externalUrl === 'string' ? externalUrl.trim() : '',
        linkedTestCaseId: linkedTestCaseId || null,
        linkedCaseTitle: matchedTc ? matchedTc.title : '',
        linkedTestRunId: linkedTestRunId || null,
        linkedExecutionId: linkedExecutionId || null,
        createdAt: now,
        updatedAt: now,
      };

      const nextDefects = [newDefect, ...prevDefects];
      let nextRuns = prevRuns;
      let nextExecs = prevExecs;

      if (linkedTestCaseId) {
        nextRuns = prevRuns.map((run) => {
          if (linkedTestRunId && run.id !== linkedTestRunId) return run;
          const hasCase = run.results.some(
            (r) =>
              r.testCaseId === linkedTestCaseId ||
              r.caseId === linkedTestCaseId
          );
          if (!hasCase) return run;
          return {
            ...run,
            results: run.results.map((r) =>
              r.testCaseId === linkedTestCaseId ||
              r.caseId === linkedTestCaseId
                ? { ...r, linkedDefectId: newId }
                : r
            ),
          };
        });

        nextExecs = prevExecs.map((ex) => {
          if (
            (ex.testCaseId === linkedTestCaseId ||
              ex.caseId === linkedTestCaseId) &&
            (!linkedTestRunId || ex.runId === linkedTestRunId)
          ) {
            return { ...ex, linkedDefectId: newId };
          }
          return ex;
        });
      }

      defectsRef.current = nextDefects;
      testRunsRef.current = nextRuns;
      executionsRef.current = nextExecs;
      setDefects(nextDefects);
      setTestRuns(nextRuns);
      setExecutions(nextExecs);

      const { defects: serializedDefects, defectSummaryCounts } =
        buildBackendDefectsPayload(nextDefects);
      const {
        executionRuns,
        activeRun,
        executions: serializedExecs,
      } = buildBackendExecutionsAndRunsPayload(nextRuns, nextExecs);

      const result = await persistProjectDataToBackend(
        {
          defects: serializedDefects,
          executionRuns,
          activeRun,
          executions: serializedExecs,
          ...defectSummaryCounts,
        },
        options
      );

      if (!result.ok) {
        defectsRef.current = prevDefects;
        testRunsRef.current = prevRuns;
        executionsRef.current = prevExecs;
        setDefects(prevDefects);
        setTestRuns(prevRuns);
        setExecutions(prevExecs);
        showToast(result.error || 'Failed to create defect', 'danger');
        return { ...result, defect: null };
      }

      appendActivity(
        'defect',
        `Logged ${newId} (${newDefect.severity}): ${newDefect.title}`,
        linkedTestCaseId
          ? `Linked to ${linkedTestCaseId}${
              linkedTestRunId ? ` in ${linkedTestRunId}` : ''
            }`
          : 'Standalone defect report'
      );
      showToast(`Created defect ${newId}`, 'success');
      return { ...result, defect: newDefect };
    },
    [
      selectedProject,
      profile,
      persistProjectDataToBackend,
      appendActivity,
      showToast,
    ]
  );

  /**
   * Updates an existing Defect report and persists via `PATCH /api/projects/:id/data`.
   */
  const updateDefect = useCallback(
    async (defectId, updates = {}, options = {}) => {
      const cleanId = typeof defectId === 'string' ? defectId.trim() : '';
      const prevDefects = defectsRef.current;
      const existingDefect = prevDefects.find(
        (b) => b.id === cleanId || b.defectId === cleanId
      );
      if (!existingDefect) {
        return {
          ok: false,
          status: 404,
          defect: null,
          error: 'Defect not found.',
        };
      }

      if (
        updates.title !== undefined &&
        (typeof updates.title !== 'string' || !updates.title.trim())
      ) {
        const errMsg = 'Defect title cannot be empty.';
        setProjectDataError(errMsg);
        return { ok: false, status: 400, defect: null, error: errMsg };
      }

      const now = formatTimestamp();
      const currentCases = testCasesRef.current;
      const nextLinkedCaseId =
        updates.linkedTestCaseId !== undefined
          ? updates.linkedTestCaseId || null
          : existingDefect.linkedTestCaseId;
      const matchedTc = nextLinkedCaseId
        ? currentCases.find(
            (c) =>
              c.id === nextLinkedCaseId || c.testCaseId === nextLinkedCaseId
          )
        : null;

      const nextStepsText =
        updates.reproductionSteps !== undefined
          ? String(updates.reproductionSteps || '').trim()
          : updates.steps !== undefined
          ? String(updates.steps || '').trim()
          : existingDefect.reproductionSteps || existingDefect.steps || '';

      const updatedDefect = {
        ...existingDefect,
        ...updates,
        title:
          updates.title !== undefined
            ? updates.title.trim()
            : existingDefect.title,
        description:
          updates.description !== undefined
            ? String(updates.description || '').trim()
            : existingDefect.description,
        severity:
          updates.severity && DEFECT_SEVERITIES.includes(updates.severity)
            ? updates.severity
            : existingDefect.severity,
        priority:
          updates.priority && DEFECT_PRIORITIES.includes(updates.priority)
            ? updates.priority
            : existingDefect.priority || existingDefect.severity,
        status:
          updates.status && DEFECT_STATUSES.includes(updates.status)
            ? updates.status
            : existingDefect.status,
        steps: nextStepsText,
        reproductionSteps: nextStepsText,
        expectedResult:
          updates.expectedResult !== undefined
            ? String(updates.expectedResult || '').trim()
            : existingDefect.expectedResult,
        actualResult:
          updates.actualResult !== undefined
            ? String(updates.actualResult || '').trim()
            : existingDefect.actualResult,
        environment:
          updates.environment !== undefined
            ? String(updates.environment || '').trim()
            : existingDefect.environment,
        externalUrl:
          updates.externalUrl !== undefined
            ? String(updates.externalUrl || '').trim()
            : existingDefect.externalUrl || '',
        linkedTestCaseId: nextLinkedCaseId,
        linkedCaseTitle: matchedTc ? matchedTc.title : '',
        linkedTestRunId:
          updates.linkedTestRunId !== undefined
            ? updates.linkedTestRunId || null
            : existingDefect.linkedTestRunId,
        updatedAt: now,
      };

      const nextDefects = prevDefects.map((bug) =>
        bug.id === existingDefect.id ? updatedDefect : bug
      );

      // Sync linkedDefectId on run results if linkedTestCaseId changed
      const prevRuns = testRunsRef.current;
      const nextRuns = prevRuns.map((run) => ({
        ...run,
        results: run.results.map((r) => {
          if (
            nextLinkedCaseId &&
            (r.testCaseId === nextLinkedCaseId || r.caseId === nextLinkedCaseId) &&
            (!updatedDefect.linkedTestRunId ||
              run.id === updatedDefect.linkedTestRunId)
          ) {
            return { ...r, linkedDefectId: existingDefect.id };
          }
          if (
            r.linkedDefectId === existingDefect.id &&
            r.testCaseId !== nextLinkedCaseId
          ) {
            return { ...r, linkedDefectId: null };
          }
          return r;
        }),
      }));

      defectsRef.current = nextDefects;
      testRunsRef.current = nextRuns;
      setDefects(nextDefects);
      setTestRuns(nextRuns);

      const { defects: serializedDefects, defectSummaryCounts } =
        buildBackendDefectsPayload(nextDefects);
      const {
        executionRuns,
        activeRun,
        executions: serializedExecs,
      } = buildBackendExecutionsAndRunsPayload(
        nextRuns,
        executionsRef.current
      );

      const result = await persistProjectDataToBackend(
        {
          defects: serializedDefects,
          executionRuns,
          activeRun,
          executions: serializedExecs,
          ...defectSummaryCounts,
        },
        options
      );

      if (!result.ok) {
        defectsRef.current = prevDefects;
        testRunsRef.current = prevRuns;
        setDefects(prevDefects);
        setTestRuns(prevRuns);
        showToast(result.error || 'Failed to update defect', 'danger');
        return { ...result, defect: null };
      }

      appendActivity(
        'defect',
        `Updated ${existingDefect.id}`,
        updates.status
          ? `Status: ${updates.status}`
          : 'Defect details updated.'
      );
      showToast(`Updated ${existingDefect.id}`, 'success');
      return { ...result, defect: updatedDefect };
    },
    [persistProjectDataToBackend, appendActivity, showToast]
  );

  /**
   * Deletes a Defect report, unlinks `linkedDefectId` from all test runs and
   * execution history records, and persists via `PATCH /api/projects/:id/data`.
   */
  const deleteDefect = useCallback(
    async (defectId, options = {}) => {
      const cleanId = typeof defectId === 'string' ? defectId.trim() : '';
      const prevDefects = defectsRef.current;
      const target = prevDefects.find(
        (b) => b.id === cleanId || b.defectId === cleanId
      );
      if (!target) {
        return { ok: false, status: 404, error: 'Defect not found.' };
      }

      const prevRuns = testRunsRef.current;
      const prevExecs = executionsRef.current;

      const nextDefects = prevDefects.filter((b) => b.id !== target.id);
      const nextRuns = prevRuns.map((run) => ({
        ...run,
        results: run.results.map((r) =>
          r.linkedDefectId === target.id ||
          r.linkedDefectId === target.defectId
            ? { ...r, linkedDefectId: null }
            : r
        ),
      }));
      const nextExecs = prevExecs.map((ex) =>
        ex.linkedDefectId === target.id ||
        ex.linkedDefectId === target.defectId
          ? { ...ex, linkedDefectId: null }
          : ex
      );

      defectsRef.current = nextDefects;
      testRunsRef.current = nextRuns;
      executionsRef.current = nextExecs;
      setDefects(nextDefects);
      setTestRuns(nextRuns);
      setExecutions(nextExecs);

      if (
        selectedDefectId === target.id ||
        selectedDefectId === target.defectId
      ) {
        setSelectedDefectId(null);
      }

      const { defects: serializedDefects, defectSummaryCounts } =
        buildBackendDefectsPayload(nextDefects);
      const {
        executionRuns,
        activeRun,
        executions: serializedExecs,
      } = buildBackendExecutionsAndRunsPayload(nextRuns, nextExecs);

      const result = await persistProjectDataToBackend(
        {
          defects: serializedDefects,
          executionRuns,
          activeRun,
          executions: serializedExecs,
          ...defectSummaryCounts,
        },
        options
      );

      if (!result.ok) {
        defectsRef.current = prevDefects;
        testRunsRef.current = prevRuns;
        executionsRef.current = prevExecs;
        setDefects(prevDefects);
        setTestRuns(prevRuns);
        setExecutions(prevExecs);
        showToast(result.error || 'Failed to delete defect', 'danger');
        return result;
      }

      appendActivity(
        'defect',
        `Deleted defect ${target.id}`,
        target.title || ''
      );
      showToast(`Deleted ${target.id}`, 'info');
      return result;
    },
    [
      selectedDefectId,
      persistProjectDataToBackend,
      appendActivity,
      showToast,
    ]
  );

  // Cross-module shortcut: Jump from failed test execution to Defects tab with pre-filled defect modal
  const startDefectFromFailedTest = useCallback(
    ({ testRun, testCase, actualResult, notes, executionId }) => {
      const stepsText = (testCase.steps || [])
        .map((s, idx) => `${s.stepNumber || idx + 1}. ${s.action}`)
        .join('\n');

      const defaultSeverity =
        testCase.priority === 'P0' || testCase.priority === 'Critical'
          ? 'Critical'
          : 'High';

      setDraftDefectFromExecution({
        title: `[${testCase.testCaseId || testCase.id}] Failure: ${
          testCase.title
        }`,
        description: notes || testCase.description || '',
        severity: defaultSeverity,
        priority: defaultSeverity,
        status: 'Open',
        reproductionSteps:
          stepsText || 'Execute steps defined in linked test case.',
        expectedResult: testCase.expectedResult || '',
        actualResult: actualResult || 'Test execution failed.',
        environment: testRun
          ? `${testRun.deviceInfo} · Build ${testRun.buildVersion}`
          : `${profile.defaultDevice} · Build ${profile.defaultBuild}`,
        linkedTestCaseId: testCase.id,
        linkedCaseTitle: testCase.title,
        linkedTestRunId: testRun ? testRun.id : null,
        linkedExecutionId: executionId || null,
      });
      setProjectViewMode('workspace');
      setActiveTab('defects');
    },
    [profile]
  );

  // Profile & Storage Management (Phase 3D hardened)
  const updateProfile = useCallback(
    async (updates = {}, options = {}) => {
      if (profileSaveLockRef.current) {
        return {
          ok: false,
          skipped: true,
          status: 409,
          code: 'SAVE_IN_PROGRESS',
          error: 'Profile save is already in progress.',
        };
      }

      profileSaveLockRef.current = true;
      setIsSavingProfile(true);
      setProjectDataError(null);
      setProjectDataConflict(null);

      try {
        const result = await persistProfileProjectChanges({
          updates,
          currentProfile: profile,
          selectedProject,
          selectedProjectId,
          updateProjectFn: updateProject,
          getProjectFn: getProject,
          apiOptions: options.apiOptions || {},
        });

        if (result.profile) {
          setProfile(result.profile);
        }

        if (result.ok) {
          appendActivity(
            'settings',
            result.persistedToBackend
              ? `Updated profile & persisted project "${result.profile.projectName}"`
              : result.queuedOffline
              ? `Queued offline update for project "${result.profile.projectName}"`
              : 'Updated local QA profile & device preferences',
            result.profile.projectName || ''
          );
          if (!options.silentToast) {
            if (result.queuedOffline) {
              showToast(
                'Profile saved & project update queued for offline sync',
                'info'
              );
            } else if (result.persistedToBackend) {
              showToast('Profile & active project saved to server', 'success');
            } else {
              showToast('Saved local QA settings', 'success');
            }
          }
          return result;
        }

        if (result.isConflict) {
          setProjectDataConflict({
            isConflict: true,
            projectId: selectedProjectId,
            currentUpdatedAt: result.currentUpdatedAt || null,
            expectedUpdatedAt: result.expectedUpdatedAt || null,
            message: result.error,
          });
        }
        setProjectDataError(result.error || 'Failed to save profile settings.');
        if (!options.silentToast) {
          showToast(
            result.error || 'Failed to save profile & project settings',
            'danger'
          );
        }
        return result;
      } finally {
        profileSaveLockRef.current = false;
        setIsSavingProfile(false);
      }
    },
    [
      profile,
      selectedProject,
      selectedProjectId,
      updateProject,
      getProject,
      appendActivity,
      showToast,
    ]
  );

  const getSampleRestorePreview = useCallback(() => {
    return {
      projectId: selectedProjectId || null,
      projectName:
        (selectedProject && selectedProject.name) ||
        profile.projectName ||
        'Active Project',
      willOverwriteBackend: Boolean(selectedProjectId),
      currentCounts: {
        suites: suitesRef.current.length,
        testCases: testCasesRef.current.length,
        testRuns: testRunsRef.current.length,
        executions: executionsRef.current.length,
        defects: defectsRef.current.length,
      },
      sampleCounts: {
        suites: INITIAL_SUITES.length,
        testCases: INITIAL_TEST_CASES.length,
        testRuns: INITIAL_TEST_RUNS.length,
        executions: 0,
        defects: INITIAL_DEFECTS.length,
      },
    };
  }, [selectedProjectId, selectedProject, profile.projectName]);

  const resetToSampleData = useCallback(
    async (options = {}) => {
      if (!options || options.confirmed !== true) {
        return {
          ok: false,
          canceled: true,
          status: 400,
          code: 'CONFIRMATION_REQUIRED',
          error:
            'Explicit confirmation is required before restoring the sample QA dataset.',
        };
      }

      if (datasetResetLockRef.current) {
        return {
          ok: false,
          skipped: true,
          status: 409,
          code: 'ALREADY_IN_PROGRESS',
          error: 'Sample dataset restoration is already in progress.',
        };
      }

      datasetResetLockRef.current = true;
      setIsRestoringSampleData(true);

      const replacedCounts = {
        suites: suitesRef.current.length,
        testCases: testCasesRef.current.length,
        testRuns: testRunsRef.current.length,
        executions: executionsRef.current.length,
        defects: defectsRef.current.length,
      };

      try {
        setProfile((prev) => ({
          ...INITIAL_PROFILE,
          projectName:
            (selectedProject && selectedProject.name) ||
            prev.projectName ||
            INITIAL_PROFILE.projectName,
          targetVersion:
            (selectedProject && selectedProject.version) ||
            prev.targetVersion ||
            INITIAL_PROFILE.targetVersion,
        }));
        setSuites(INITIAL_SUITES);
        setTestCases(INITIAL_TEST_CASES);
        setTestRuns(INITIAL_TEST_RUNS);
        setExecutions([]);
        setDefects(INITIAL_DEFECTS);
        setActivityLog(INITIAL_ACTIVITY);
        setSelectedTestCaseId(null);
        setSelectedTestRunId(null);
        setSelectedDefectId(null);

        let backendRes = null;
        if (selectedProjectId) {
          const { testSuites, summaryCounts } = buildBackendTestSuitesPayload(
            INITIAL_SUITES,
            INITIAL_TEST_CASES
          );
          const {
            executionRuns,
            activeRun,
            executions: serializedExecs,
          } = buildBackendExecutionsAndRunsPayload(INITIAL_TEST_RUNS, []);
          const { defects: serializedDefects, defectSummaryCounts } =
            buildBackendDefectsPayload(INITIAL_DEFECTS);

          backendRes = await persistProjectDataToBackend({
            testSuites,
            executionRuns,
            activeRun,
            executions: serializedExecs,
            defects: serializedDefects,
            ...summaryCounts,
            ...defectSummaryCounts,
          });

          if (backendRes && !backendRes.ok) {
            return {
              ok: false,
              status: backendRes.status || 0,
              isConflict: Boolean(backendRes.isConflict),
              replacedCounts,
              error:
                backendRes.error ||
                'Failed to persist sample QA dataset to active project.',
            };
          }
        }

        if (!options.silentToast) {
          showToast('Restored sample QA dataset for active project', 'info');
        }

        return {
          ok: true,
          status: (backendRes && backendRes.status) || 200,
          queuedOffline: Boolean(backendRes && backendRes.queuedOffline),
          project: (backendRes && backendRes.project) || selectedProject,
          replacedCounts,
          restoredCounts: {
            suites: INITIAL_SUITES.length,
            testCases: INITIAL_TEST_CASES.length,
            testRuns: INITIAL_TEST_RUNS.length,
            executions: 0,
            defects: INITIAL_DEFECTS.length,
          },
          error: null,
        };
      } finally {
        datasetResetLockRef.current = false;
        setIsRestoringSampleData(false);
      }
    },
    [selectedProject, selectedProjectId, persistProjectDataToBackend, showToast]
  );

  const clearAllWorkspaceData = useCallback(
    async (options = {}) => {
      if (!options || options.confirmed !== true) {
        return {
          ok: false,
          canceled: true,
          status: 400,
          code: 'CONFIRMATION_REQUIRED',
          error:
            'Explicit confirmation is required before clearing project workspace data.',
        };
      }

      if (datasetResetLockRef.current) {
        return {
          ok: false,
          skipped: true,
          status: 409,
          code: 'ALREADY_IN_PROGRESS',
          error: 'Workspace data reset is already in progress.',
        };
      }

      datasetResetLockRef.current = true;
      setIsClearingWorkspaceData(true);

      const replacedCounts = {
        suites: suitesRef.current.length,
        testCases: testCasesRef.current.length,
        testRuns: testRunsRef.current.length,
        executions: executionsRef.current.length,
        defects: defectsRef.current.length,
      };

      try {
        const defaultSuites = [
          {
            id: 'suite-default',
            name: 'General Suite',
            category: 'Functional',
            tags: [],
            description: 'Default test suite',
          },
        ];
        setSuites(defaultSuites);
        setTestCases([]);
        setTestRuns([]);
        setExecutions([]);
        setDefects([]);
        setActivityLog([
          {
            id: `act-${Date.now()}`,
            category: 'settings',
            title: 'Cleared project local QA data',
            detail: 'Project workspace reset to empty state.',
            timestamp: formatTimestamp(),
          },
        ]);
        setSelectedTestCaseId(null);
        setSelectedTestRunId(null);
        setSelectedDefectId(null);

        let backendRes = null;
        if (selectedProjectId) {
          const { testSuites, summaryCounts } = buildBackendTestSuitesPayload(
            defaultSuites,
            []
          );
          const { defects: serializedDefects, defectSummaryCounts } =
            buildBackendDefectsPayload([]);
          backendRes = await persistProjectDataToBackend({
            testSuites,
            executionRuns: [],
            activeRun: null,
            executions: [],
            defects: serializedDefects,
            ...summaryCounts,
            ...defectSummaryCounts,
          });

          if (backendRes && !backendRes.ok) {
            return {
              ok: false,
              status: backendRes.status || 0,
              isConflict: Boolean(backendRes.isConflict),
              replacedCounts,
              error:
                backendRes.error ||
                'Failed to persist cleared workspace state to active project.',
            };
          }
        }

        if (!options.silentToast) {
          showToast(
            'Cleared test cases, runs, and defects for this project',
            'info'
          );
        }

        return {
          ok: true,
          status: (backendRes && backendRes.status) || 200,
          queuedOffline: Boolean(backendRes && backendRes.queuedOffline),
          project: (backendRes && backendRes.project) || selectedProject,
          replacedCounts,
          error: null,
        };
      } finally {
        datasetResetLockRef.current = false;
        setIsClearingWorkspaceData(false);
      }
    },
    [selectedProject, selectedProjectId, persistProjectDataToBackend, showToast]
  );

  // --- Genuine Dynamic QA Metrics (Phase 2E parity with Qavora Web) ---
  const metrics = useMemo(() => {
    return computeProjectDashboardMetrics({
      project: selectedProject,
      testPlan,
      suites,
      testCases,
      testRuns,
      executions,
      defects,
    });
  }, [selectedProject, testPlan, suites, testCases, testRuns, executions, defects]);

  // --- Read-Only Project Report Generation & Export (Phase 2E) ---
  const generateReport = useCallback(
    (filters = {}) => {
      return generateProjectReport(
        {
          project: selectedProject,
          testPlan: testPlanRef.current,
          suites: suitesRef.current,
          testCases: testCasesRef.current,
          testRuns: testRunsRef.current,
          executions: executionsRef.current,
          defects: defectsRef.current,
        },
        filters
      );
    },
    [selectedProject]
  );

  const exportReport = useCallback(
    async (filters = {}, format = 'json', options = {}) => {
      const report =
        filters && filters.generatedAt && filters.kpis
          ? filters
          : generateReport(filters);
      const res = await exportGeneratedReport(report, format, options);
      if (res.ok && !options.silentToast) {
        showToast(
          `Exported ${res.formatLabel} (${res.filename})`,
          'success'
        );
      } else if (!res.ok && !options.silentToast) {
        showToast(res.error || 'Failed to export report', 'danger');
      }
      return { ...res, report };
    },
    [generateReport, showToast]
  );

  const value = {
    activeProject: selectedProject,
    activeProjectId: selectedProjectId,
    isStorageHydrated,
    lastPersistedAt,
    isSyncingProjectData,
    projectDataError,
    projectDataConflict,
    clearProjectDataError,
    reloadProjectDataFromBackend,
    profile,
    testPlan,
    suites,
    suiteCategories: SUITE_CATEGORIES,
    testCases,
    testRuns,
    executions,
    defects,
    checklists,
    setChecklists,
    activityLog,
    metrics,
    reportTypes: REPORT_TYPES,
    dateRangeFilters: DATE_RANGE_FILTERS,
    exportFormats: EXPORT_FORMATS,
    generateReport,
    exportReport,
    priorities: PRIORITIES,
    testTypes: TEST_TYPES,
    executionStatuses: EXECUTION_STATUSES,
    webExecutionOutcomes: WEB_EXECUTION_OUTCOMES,
    defectSeverities: DEFECT_SEVERITIES,
    defectPriorities: DEFECT_PRIORITIES,
    defectStatuses: DEFECT_STATUSES,
    navigationDestinations: NAVIGATION_DESTINATIONS,
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
    navigationHistory,
    pushNavigationHistory,
    clearNavigationHistory,
    openProjectSelection,
    openProjectDetails,
    openWorkspace,
    openDashboardOverview,
    openReportsView,
    openChecklistsView,
    openCreateChecklistView,
    openChecklistRunnerView,
    openTestPlansView,
    openTestCasesView,
    openTestSuitesView,
    openTestExecutionView,
    openDefectsView,
    openDataManagementView,
    openSettingsView,
    navigateToDestination,
    selectedTestCaseId,
    setSelectedTestCaseId,
    selectedTestRunId,
    setSelectedTestRunId,
    selectedDefectId,
    setSelectedDefectId,
    draftDefectFromExecution,
    setDraftDefectFromExecution,
    saveTestPlan,
    addTestPlanPhase,
    updateTestPlanPhase,
    deleteTestPlanPhase,
    createSuite,
    updateSuite,
    deleteSuite,
    createTestCase,
    updateTestCase,
    moveTestCaseToSuite,
    deleteTestCase,
    createTestRun,
    updateTestRun,
    completeTestRun,
    reopenTestRun,
    recordTestExecution,
    deleteTestRun,
    createDefect,
    updateDefect,
    deleteDefect,
    startDefectFromFailedTest,
    updateProfile,
    isSavingProfile,
    getSampleRestorePreview,
    resetToSampleData,
    isRestoringSampleData,
    clearAllWorkspaceData,
    isClearingWorkspaceData,
    toast,
    showToast,
    dismissToast: () => setToast(null),
  };

  return React.createElement(
    WorkspaceContext.Provider,
    { value },
    children
  );
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider');
  }
  return context;
}

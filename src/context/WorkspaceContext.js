import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  useCallback,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from './AuthContext';
import { useProjects } from './ProjectContext';
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
  DEFECT_SEVERITIES,
  DEFECT_STATUSES,
} from '../data/initialData';

export const WORKSPACE_STORAGE_PREFIX = '@qavora_qa_workspace_v2:project:';

const WorkspaceContext = createContext(null);

function formatTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
    now.getDate()
  )} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

export function getProjectWorkspaceStorageKey(projectId) {
  return `${WORKSPACE_STORAGE_PREFIX}${projectId}`;
}

/**
 * Extracts and normalizes workspace state for a specific selected project,
 * ensuring zero stale data leaks between projects.
 *
 * @param {object | null} selectedProject
 * @param {object | null} [persistedSnapshot]
 * @param {object | null} [currentUser]
 */
export function buildProjectWorkspaceState(
  selectedProject,
  persistedSnapshot = null,
  currentUser = null
) {
  const baseTesterName =
    (currentUser && currentUser.name) || INITIAL_PROFILE.testerName;
  const baseRole = (currentUser && currentUser.role) || INITIAL_PROFILE.role;

  if (!selectedProject || typeof selectedProject !== 'object') {
    return {
      projectId: null,
      profile: {
        ...INITIAL_PROFILE,
        testerName: baseTesterName,
        role: baseRole,
        projectName: 'No Project Selected',
        targetVersion: '',
      },
      suites: [],
      testCases: [],
      testRuns: [],
      defects: [],
      activityLog: [],
    };
  }

  const projectId = String(selectedProject.id || selectedProject._id || '');

  // Map backend suites & nested test cases if present on the project document
  const rawSuites = Array.isArray(selectedProject.testSuites)
    ? selectedProject.testSuites
    : [];
  const backendSuites = rawSuites.map((s, idx) => ({
    id: (s && (s.id || s._id)) || `suite-${idx + 1}`,
    name: (s && s.name) || `Suite ${idx + 1}`,
    description: (s && s.description) || '',
  }));

  const backendTestCases = [];
  rawSuites.forEach((s, suiteIdx) => {
    const suiteId = (s && (s.id || s._id)) || `suite-${suiteIdx + 1}`;
    const suiteName = (s && s.name) || `Suite ${suiteIdx + 1}`;
    const cases = Array.isArray(s && s.testCases) ? s.testCases : [];
    cases.forEach((tc, tcIdx) => {
      if (!tc || typeof tc !== 'object') return;
      backendTestCases.push({
        id: tc.id || `TC-${suiteIdx + 1}${tcIdx + 1}`,
        suiteId,
        suiteName,
        title: tc.title || tc.name || 'Untitled Test Case',
        description: tc.description || '',
        preconditions: tc.preconditions || 'Standard application state.',
        priority: tc.priority || 'P1',
        testType: tc.testType || tc.type || 'Functional',
        steps: Array.isArray(tc.steps) ? tc.steps : [],
        expectedResult:
          tc.expectedResult || 'All test steps pass without error.',
        lastStatus: tc.lastStatus || tc.status || 'Untested',
        createdAt: tc.createdAt || formatTimestamp(),
        updatedAt: tc.updatedAt || formatTimestamp(),
      });
    });
  });

  const rawRuns =
    Array.isArray(selectedProject.executionRuns) &&
    selectedProject.executionRuns.length > 0
      ? selectedProject.executionRuns
      : Array.isArray(selectedProject.executions)
      ? selectedProject.executions.filter(
          (r) => r && typeof r === 'object' && Array.isArray(r.results)
        )
      : [];

  const backendTestRuns = rawRuns.map((run, idx) => ({
    id: run.id || `RUN-${201 + idx}`,
    name: run.name || `Test Run ${idx + 1}`,
    suiteName: run.suiteName || 'All Suites',
    buildVersion: run.buildVersion || selectedProject.version || '1.0.0',
    deviceInfo: run.deviceInfo || INITIAL_PROFILE.defaultDevice,
    environment:
      run.environment || selectedProject.environment || 'Staging',
    status: run.status || 'In Progress',
    createdAt: run.createdAt || formatTimestamp(),
    updatedAt: run.updatedAt || formatTimestamp(),
    results: Array.isArray(run.results) ? run.results : [],
  }));

  const rawDefects = Array.isArray(selectedProject.defects)
    ? selectedProject.defects
    : [];
  const backendDefects = rawDefects.map((bug, idx) => ({
    id: bug.id || `BUG-${301 + idx}`,
    title: bug.title || 'Untitled Defect',
    description: bug.description || '',
    severity: bug.severity || 'High',
    status: bug.status || 'Open',
    reproductionSteps: bug.reproductionSteps || bug.stepsToReproduce || '',
    expectedResult: bug.expectedResult || '',
    actualResult: bug.actualResult || '',
    environment:
      bug.environment || selectedProject.environment || 'Staging',
    linkedTestCaseId: bug.linkedTestCaseId || bug.testCaseId || null,
    linkedTestRunId: bug.linkedTestRunId || null,
    createdAt: bug.createdAt || formatTimestamp(),
    updatedAt: bug.updatedAt || formatTimestamp(),
  }));

  const hasValidSnapshot =
    persistedSnapshot &&
    typeof persistedSnapshot === 'object' &&
    persistedSnapshot.projectId === projectId;

  const syncedProfile = {
    ...(hasValidSnapshot && persistedSnapshot.profile
      ? persistedSnapshot.profile
      : INITIAL_PROFILE),
    testerName:
      (hasValidSnapshot &&
        persistedSnapshot.profile &&
        persistedSnapshot.profile.testerName) ||
      baseTesterName,
    role:
      (hasValidSnapshot &&
        persistedSnapshot.profile &&
        persistedSnapshot.profile.role) ||
      baseRole,
    projectName: selectedProject.name || 'Untitled Project',
    targetVersion:
      selectedProject.version ||
      (hasValidSnapshot &&
        persistedSnapshot.profile &&
        persistedSnapshot.profile.targetVersion) ||
      'v1.0.0',
    defaultEnvironment:
      selectedProject.environment ||
      (hasValidSnapshot &&
        persistedSnapshot.profile &&
        persistedSnapshot.profile.defaultEnvironment) ||
      'Staging',
  };

  const defaultActivity = [
    {
      id: `act-init-${projectId}`,
      category: 'project',
      title: `Loaded project "${selectedProject.name}"`,
      detail: `Status: ${selectedProject.status || 'Active'} · Type: ${
        selectedProject.type || 'Web Application'
      }`,
      timestamp: formatTimestamp(),
    },
  ];

  return {
    projectId,
    profile: syncedProfile,
    suites:
      hasValidSnapshot && Array.isArray(persistedSnapshot.suites)
        ? persistedSnapshot.suites
        : backendSuites,
    testCases:
      hasValidSnapshot && Array.isArray(persistedSnapshot.testCases)
        ? persistedSnapshot.testCases
        : backendTestCases,
    testRuns:
      hasValidSnapshot && Array.isArray(persistedSnapshot.testRuns)
        ? persistedSnapshot.testRuns
        : backendTestRuns,
    defects:
      hasValidSnapshot && Array.isArray(persistedSnapshot.defects)
        ? persistedSnapshot.defects
        : backendDefects,
    activityLog:
      hasValidSnapshot &&
      Array.isArray(persistedSnapshot.activityLog) &&
      persistedSnapshot.activityLog.length > 0
        ? persistedSnapshot.activityLog
        : defaultActivity,
  };
}

export function WorkspaceProvider({ children }) {
  const { user } = useAuth();
  const { selectedProject, selectedProjectId } = useProjects();

  const [hydratedProjectId, setHydratedProjectId] = useState(null);
  const [isStorageHydrated, setIsStorageHydrated] = useState(false);
  const [lastPersistedAt, setLastPersistedAt] = useState(null);

  const initialWorkspace = useMemo(
    () => buildProjectWorkspaceState(selectedProject, null, user),
    // Only used for initial state seed
    []
  );

  const [profile, setProfile] = useState(initialWorkspace.profile);
  const [suites, setSuites] = useState(initialWorkspace.suites);
  const [testCases, setTestCases] = useState(initialWorkspace.testCases);
  const [testRuns, setTestRuns] = useState(initialWorkspace.testRuns);
  const [defects, setDefects] = useState(initialWorkspace.defects);
  const [activityLog, setActivityLog] = useState(initialWorkspace.activityLog);

  // Navigation & Active Selection State
  const [activeTab, setActiveTab] = useState('dashboard'); // 'dashboard' | 'testcases' | 'testruns' | 'defects' | 'profile'
  const [projectViewMode, setProjectViewMode] = useState('workspace'); // 'workspace' | 'selection' | 'details'
  const [selectedTestCaseId, setSelectedTestCaseId] = useState(null);
  const [selectedTestRunId, setSelectedTestRunId] = useState(null);
  const [selectedDefectId, setSelectedDefectId] = useState(null);

  // Cross-module prefill state for creating a defect directly from a failed test case execution
  const [draftDefectFromExecution, setDraftDefectFromExecution] = useState(null);

  // Toast feedback
  const [toast, setToast] = useState(null);

  const showToast = useCallback((message, tone = 'info') => {
    setToast({ id: Date.now(), message, tone });
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(timer);
  }, [toast]);

  const openProjectSelection = useCallback(() => {
    setProjectViewMode('selection');
  }, []);

  const openProjectDetails = useCallback(() => {
    setProjectViewMode('details');
  }, []);

  const openWorkspace = useCallback(() => {
    setProjectViewMode('workspace');
  }, []);

  // Switch workspace data cleanly whenever the selected project changes
  useEffect(() => {
    let mounted = true;

    // Immediately clear any stale item selections from the previous project
    setSelectedTestCaseId(null);
    setSelectedTestRunId(null);
    setSelectedDefectId(null);
    setDraftDefectFromExecution(null);

    if (!selectedProjectId || !selectedProject) {
      const emptyState = buildProjectWorkspaceState(null, null, user);
      setProfile(emptyState.profile);
      setSuites(emptyState.suites);
      setTestCases(emptyState.testCases);
      setTestRuns(emptyState.testRuns);
      setDefects(emptyState.defects);
      setActivityLog(emptyState.activityLog);
      setHydratedProjectId(null);
      setLastPersistedAt(null);
      setIsStorageHydrated(true);
      setProjectViewMode('selection');
      return () => {
        mounted = false;
      };
    }

    // Apply the new project's backend state immediately so no stale project data is ever rendered
    setIsStorageHydrated(false);
    setHydratedProjectId(null);
    const immediateState = buildProjectWorkspaceState(
      selectedProject,
      null,
      user
    );
    setProfile(immediateState.profile);
    setSuites(immediateState.suites);
    setTestCases(immediateState.testCases);
    setTestRuns(immediateState.testRuns);
    setDefects(immediateState.defects);
    setActivityLog(immediateState.activityLog);

    const storageKey = getProjectWorkspaceStorageKey(selectedProjectId);
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
        setSuites(resolved.suites);
        setTestCases(resolved.testCases);
        setTestRuns(resolved.testRuns);
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

  // Keep profile projectName and targetVersion synced when selectedProject metadata is edited
  useEffect(() => {
    if (!selectedProject || !selectedProjectId) return;
    setProfile((prev) => ({
      ...prev,
      projectName: selectedProject.name || prev.projectName,
      targetVersion: selectedProject.version || prev.targetVersion || 'v1.0.0',
      defaultEnvironment:
        selectedProject.environment || prev.defaultEnvironment || 'Staging',
    }));
  }, [
    selectedProjectId,
    selectedProject && selectedProject.name,
    selectedProject && selectedProject.version,
    selectedProject && selectedProject.environment,
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
      profile,
      suites,
      testCases,
      testRuns,
      defects,
      activityLog,
      savedAt,
    });
    AsyncStorage.setItem(
      getProjectWorkspaceStorageKey(selectedProjectId),
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
    profile,
    suites,
    testCases,
    testRuns,
    defects,
    activityLog,
  ]);

  const appendActivity = (category, title, detail) => {
    const entry = {
      id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      category,
      title,
      detail,
      timestamp: formatTimestamp(),
    };
    setActivityLog((prev) => [entry, ...prev.slice(0, 29)]);
  };

  // --- Test Suites CRUD ---
  const createSuite = ({ name, description }) => {
    if (!name || !name.trim()) return null;
    const newSuite = {
      id: `suite-${Date.now()}`,
      name: name.trim(),
      description: description ? description.trim() : '',
    };
    setSuites((prev) => [...prev, newSuite]);
    appendActivity(
      'suite',
      `Created suite "${newSuite.name}"`,
      newSuite.description || 'New test suite added.'
    );
    showToast(`Test Suite "${newSuite.name}" created`, 'success');
    return newSuite;
  };

  const deleteSuite = (suiteId) => {
    const target = suites.find((s) => s.id === suiteId);
    if (!target) return;
    setSuites((prev) => prev.filter((s) => s.id !== suiteId));
    appendActivity(
      'suite',
      `Deleted suite "${target.name}"`,
      'Suite removed from project workspace.'
    );
    showToast(`Deleted suite "${target.name}"`, 'info');
  };

  // --- Test Cases CRUD ---
  const createTestCase = ({
    suiteId,
    title,
    description,
    preconditions,
    priority,
    testType,
    steps,
    expectedResult,
  }) => {
    const maxNum = testCases.reduce((max, tc) => {
      const m = tc.id.match(/TC-(\d+)/);
      return m ? Math.max(max, parseInt(m[1], 10)) : max;
    }, 100);
    const newId = `TC-${maxNum + 1}`;
    const suiteObj = suites.find((s) => s.id === suiteId) ||
      suites[0] || {
        id: 'suite-general',
        name: 'General QA Suite',
      };
    const now = formatTimestamp();

    const formattedSteps = (steps || [])
      .map((st, idx) => ({
        id: `step-${Date.now()}-${idx}`,
        stepNumber: idx + 1,
        action: (st.action || '').trim(),
        expectedResult: (st.expectedResult || '').trim(),
      }))
      .filter((st) => st.action);

    const newCase = {
      id: newId,
      suiteId: suiteObj.id,
      suiteName: suiteObj.name,
      title: title.trim(),
      description: (description || '').trim(),
      preconditions:
        (preconditions || '').trim() || 'Standard application state.',
      priority: priority || 'P1',
      testType: testType || 'Functional',
      steps:
        formattedSteps.length > 0
          ? formattedSteps
          : [
              {
                id: `step-${Date.now()}-0`,
                stepNumber: 1,
                action: 'Execute feature workflow as described.',
                expectedResult: expectedResult
                  ? expectedResult.trim()
                  : 'Expected behavior verified.',
              },
            ],
      expectedResult:
        (expectedResult || '').trim() ||
        'All test steps pass without error.',
      lastStatus: 'Untested',
      createdAt: now,
      updatedAt: now,
    };

    setTestCases((prev) => [newCase, ...prev]);
    appendActivity(
      'testcase',
      `Created ${newId}: ${newCase.title}`,
      `Suite: ${newCase.suiteName} · Priority: ${newCase.priority}`
    );
    showToast(`Created test case ${newId}`, 'success');
    return newCase;
  };

  const updateTestCase = (testCaseId, updates) => {
    const now = formatTimestamp();
    setTestCases((prev) =>
      prev.map((tc) => {
        if (tc.id !== testCaseId) return tc;
        const suiteObj = updates.suiteId
          ? suites.find((s) => s.id === updates.suiteId)
          : null;
        const nextSteps = Array.isArray(updates.steps)
          ? updates.steps
              .map((st, idx) => ({
                id: st.id || `step-${Date.now()}-${idx}`,
                stepNumber: idx + 1,
                action: (st.action || '').trim(),
                expectedResult: (st.expectedResult || '').trim(),
              }))
              .filter((st) => st.action)
          : tc.steps;

        return {
          ...tc,
          ...updates,
          suiteName: suiteObj
            ? suiteObj.name
            : updates.suiteName || tc.suiteName,
          steps: nextSteps.length > 0 ? nextSteps : tc.steps,
          updatedAt: now,
        };
      })
    );
    appendActivity(
      'testcase',
      `Updated test case ${testCaseId}`,
      updates.title || 'Test case details modified.'
    );
    showToast(`Updated ${testCaseId}`, 'success');
  };

  const deleteTestCase = (testCaseId) => {
    const target = testCases.find((tc) => tc.id === testCaseId);
    setTestCases((prev) => prev.filter((tc) => tc.id !== testCaseId));
    setTestRuns((prev) =>
      prev.map((run) => ({
        ...run,
        results: run.results.filter((r) => r.testCaseId !== testCaseId),
      }))
    );
    if (selectedTestCaseId === testCaseId) {
      setSelectedTestCaseId(null);
    }
    appendActivity(
      'testcase',
      `Deleted test case ${testCaseId}`,
      target ? target.title : 'Removed from repository.'
    );
    showToast(`Deleted ${testCaseId}`, 'info');
  };

  // --- Test Runs & Execution CRUD ---
  const createTestRun = ({
    name,
    suiteId,
    buildVersion,
    deviceInfo,
    environment,
    testCaseIds,
  }) => {
    const maxNum = testRuns.reduce((max, r) => {
      const m = r.id.match(/RUN-(\d+)/);
      return m ? Math.max(max, parseInt(m[1], 10)) : max;
    }, 200);
    const newId = `RUN-${maxNum + 1}`;
    const now = formatTimestamp();

    let includedCases = testCases;
    let suiteLabel = 'All Suites';
    if (suiteId && suiteId !== 'all') {
      const suiteObj = suites.find((s) => s.id === suiteId);
      if (suiteObj) {
        suiteLabel = suiteObj.name;
        includedCases = testCases.filter((tc) => tc.suiteId === suiteId);
      }
    }
    if (Array.isArray(testCaseIds) && testCaseIds.length > 0) {
      includedCases = testCases.filter((tc) => testCaseIds.includes(tc.id));
    }

    const results = includedCases.map((tc) => ({
      testCaseId: tc.id,
      status: 'Untested',
      actualResult: '',
      notes: '',
      executedAt: null,
      linkedDefectId: null,
    }));

    const newRun = {
      id: newId,
      name: name.trim(),
      suiteName: suiteLabel,
      buildVersion: (
        buildVersion ||
        (selectedProject && selectedProject.version) ||
        profile.defaultBuild ||
        '1.0.0'
      ).trim(),
      deviceInfo: (
        deviceInfo ||
        profile.defaultDevice ||
        'Android Device'
      ).trim(),
      environment: (
        environment ||
        (selectedProject && selectedProject.environment) ||
        'Local QA Build'
      ).trim(),
      status: 'In Progress',
      createdAt: now,
      updatedAt: now,
      results,
    };

    setTestRuns((prev) => [newRun, ...prev]);
    appendActivity(
      'execution',
      `Created Test Run ${newId}: ${newRun.name}`,
      `${results.length} test cases queued on ${newRun.deviceInfo}`
    );
    showToast(`Created ${newId} with ${results.length} test cases`, 'success');
    return newRun;
  };

  const recordTestExecution = ({
    testRunId,
    testCaseId,
    status,
    actualResult,
    notes,
    linkedDefectId,
  }) => {
    const now = formatTimestamp();
    setTestRuns((prev) =>
      prev.map((run) => {
        if (run.id !== testRunId) return run;
        const updatedResults = run.results.map((res) => {
          if (res.testCaseId !== testCaseId) return res;
          return {
            ...res,
            status,
            actualResult:
              actualResult !== undefined ? actualResult : res.actualResult,
            notes: notes !== undefined ? notes : res.notes,
            executedAt: now,
            linkedDefectId:
              linkedDefectId !== undefined
                ? linkedDefectId
                : res.linkedDefectId,
          };
        });
        const allTested =
          updatedResults.length > 0 &&
          updatedResults.every((r) => r.status !== 'Untested');
        return {
          ...run,
          status: allTested ? 'Completed' : 'In Progress',
          updatedAt: now,
          results: updatedResults,
        };
      })
    );

    // Sync lastStatus on the corresponding TestCase
    setTestCases((prev) =>
      prev.map((tc) =>
        tc.id === testCaseId
          ? {
              ...tc,
              lastStatus: status,
              updatedAt: now,
            }
          : tc
      )
    );

    appendActivity(
      'execution',
      `Executed ${testCaseId} in ${testRunId} → ${status}`,
      actualResult ? actualResult : `Marked as ${status}`
    );
    showToast(
      `${testCaseId} marked as ${status}`,
      status === 'Failed' ? 'danger' : 'success'
    );
  };

  const deleteTestRun = (testRunId) => {
    const target = testRuns.find((r) => r.id === testRunId);
    setTestRuns((prev) => prev.filter((r) => r.id !== testRunId));
    if (selectedTestRunId === testRunId) {
      setSelectedTestRunId(null);
    }
    appendActivity(
      'execution',
      `Deleted Test Run ${testRunId}`,
      target ? target.name : 'Removed test run.'
    );
    showToast(`Deleted ${testRunId}`, 'info');
  };

  // --- Defects CRUD ---
  const createDefect = ({
    title,
    description,
    severity,
    status,
    reproductionSteps,
    expectedResult,
    actualResult,
    environment,
    linkedTestCaseId,
    linkedTestRunId,
  }) => {
    const maxNum = defects.reduce((max, bug) => {
      const m = bug.id.match(/BUG-(\d+)/);
      return m ? Math.max(max, parseInt(m[1], 10)) : max;
    }, 300);
    const newId = `BUG-${maxNum + 1}`;
    const now = formatTimestamp();

    const newDefect = {
      id: newId,
      title: title.trim(),
      description: (description || '').trim(),
      severity: severity || 'High',
      status: status || 'Open',
      reproductionSteps: (reproductionSteps || '').trim(),
      expectedResult: (expectedResult || '').trim(),
      actualResult: (actualResult || '').trim(),
      environment:
        (environment || '').trim() ||
        `${profile.defaultDevice} · Build ${profile.defaultBuild}`,
      linkedTestCaseId: linkedTestCaseId || null,
      linkedTestRunId: linkedTestRunId || null,
      createdAt: now,
      updatedAt: now,
    };

    setDefects((prev) => [newDefect, ...prev]);

    if (linkedTestRunId && linkedTestCaseId) {
      setTestRuns((prev) =>
        prev.map((run) => {
          if (run.id !== linkedTestRunId) return run;
          return {
            ...run,
            results: run.results.map((r) =>
              r.testCaseId === linkedTestCaseId
                ? { ...r, linkedDefectId: newId }
                : r
            ),
          };
        })
      );
    }

    appendActivity(
      'defect',
      `Logged ${newId} (${newDefect.severity}): ${newDefect.title}`,
      linkedTestCaseId
        ? `Linked to ${linkedTestCaseId}`
        : 'Standalone defect report'
    );
    showToast(`Created defect ${newId}`, 'success');
    return newDefect;
  };

  const updateDefect = (defectId, updates) => {
    const now = formatTimestamp();
    setDefects((prev) =>
      prev.map((bug) =>
        bug.id === defectId
          ? {
              ...bug,
              ...updates,
              updatedAt: now,
            }
          : bug
      )
    );
    appendActivity(
      'defect',
      `Updated ${defectId}`,
      updates.status ? `Status: ${updates.status}` : 'Defect details updated.'
    );
    showToast(`Updated ${defectId}`, 'success');
  };

  const deleteDefect = (defectId) => {
    const target = defects.find((b) => b.id === defectId);
    setDefects((prev) => prev.filter((b) => b.id !== defectId));
    setTestRuns((prev) =>
      prev.map((run) => ({
        ...run,
        results: run.results.map((r) =>
          r.linkedDefectId === defectId ? { ...r, linkedDefectId: null } : r
        ),
      }))
    );
    if (selectedDefectId === defectId) {
      setSelectedDefectId(null);
    }
    appendActivity(
      'defect',
      `Deleted defect ${defectId}`,
      target ? target.title : ''
    );
    showToast(`Deleted ${defectId}`, 'info');
  };

  // Cross-module shortcut: Jump from failed test execution to Defects tab with pre-filled defect modal
  const startDefectFromFailedTest = ({
    testRun,
    testCase,
    actualResult,
    notes,
  }) => {
    const stepsText = (testCase.steps || [])
      .map((s) => `${s.stepNumber}. ${s.action}`)
      .join('\n');

    setDraftDefectFromExecution({
      title: `[${testCase.id}] Failure: ${testCase.title}`,
      description: notes || testCase.description || '',
      severity: testCase.priority === 'P0' ? 'Critical' : 'High',
      status: 'Open',
      reproductionSteps:
        stepsText || 'Execute steps defined in linked test case.',
      expectedResult: testCase.expectedResult || '',
      actualResult: actualResult || 'Test execution failed.',
      environment: `${testRun.deviceInfo} · Build ${testRun.buildVersion}`,
      linkedTestCaseId: testCase.id,
      linkedTestRunId: testRun.id,
    });
    setProjectViewMode('workspace');
    setActiveTab('defects');
  };

  // Profile & Storage Management
  const updateProfile = (updates) => {
    setProfile((prev) => ({ ...prev, ...updates }));
    appendActivity(
      'settings',
      'Updated local QA profile & project settings',
      updates.projectName || ''
    );
    showToast('Saved local QA settings', 'success');
  };

  const resetToSampleData = async () => {
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
    setDefects(INITIAL_DEFECTS);
    setActivityLog(INITIAL_ACTIVITY);
    setSelectedTestCaseId(null);
    setSelectedTestRunId(null);
    setSelectedDefectId(null);
    showToast('Restored sample QA dataset for active project', 'info');
  };

  const clearAllWorkspaceData = async () => {
    setSuites([
      {
        id: 'suite-default',
        name: 'General Suite',
        description: 'Default test suite',
      },
    ]);
    setTestCases([]);
    setTestRuns([]);
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
    showToast('Cleared test cases, runs, and defects for this project', 'info');
  };

  // --- Genuine Dynamic QA Metrics ---
  const metrics = useMemo(() => {
    const totalTestCases = testCases.length;
    const passedCases = testCases.filter(
      (tc) => tc.lastStatus === 'Passed'
    ).length;
    const failedCases = testCases.filter(
      (tc) => tc.lastStatus === 'Failed'
    ).length;
    const blockedCases = testCases.filter(
      (tc) => tc.lastStatus === 'Blocked'
    ).length;
    const untestedCases = testCases.filter(
      (tc) => tc.lastStatus === 'Untested'
    ).length;
    const executedCases = totalTestCases - untestedCases;

    const passRate =
      executedCases > 0 ? Math.round((passedCases / executedCases) * 100) : 0;
    const coverageRate =
      totalTestCases > 0
        ? Math.round((executedCases / totalTestCases) * 100)
        : 0;

    const totalRuns = testRuns.length;
    const activeRuns = testRuns.filter(
      (r) => r.status === 'In Progress'
    ).length;
    const completedRuns = testRuns.filter(
      (r) => r.status === 'Completed'
    ).length;

    const totalDefects = defects.length;
    const openDefects = defects.filter((d) => d.status !== 'Closed').length;
    const criticalDefects = defects.filter(
      (d) =>
        (d.severity === 'Critical' || d.severity === 'High') &&
        d.status !== 'Closed'
    ).length;
    const retestDefects = defects.filter(
      (d) => d.status === 'Ready for Retest'
    ).length;

    return {
      totalSuites: suites.length,
      totalTestCases,
      passedCases,
      failedCases,
      blockedCases,
      untestedCases,
      executedCases,
      passRate,
      coverageRate,
      totalRuns,
      activeRuns,
      completedRuns,
      totalDefects,
      openDefects,
      criticalDefects,
      retestDefects,
    };
  }, [suites, testCases, testRuns, defects]);

  const value = {
    activeProject: selectedProject,
    activeProjectId: selectedProjectId,
    isStorageHydrated,
    lastPersistedAt,
    profile,
    suites,
    testCases,
    testRuns,
    defects,
    activityLog,
    metrics,
    priorities: PRIORITIES,
    testTypes: TEST_TYPES,
    executionStatuses: EXECUTION_STATUSES,
    defectSeverities: DEFECT_SEVERITIES,
    defectStatuses: DEFECT_STATUSES,
    activeTab,
    setActiveTab,
    projectViewMode,
    setProjectViewMode,
    openProjectSelection,
    openProjectDetails,
    openWorkspace,
    selectedTestCaseId,
    setSelectedTestCaseId,
    selectedTestRunId,
    setSelectedTestRunId,
    selectedDefectId,
    setSelectedDefectId,
    draftDefectFromExecution,
    setDraftDefectFromExecution,
    createSuite,
    deleteSuite,
    createTestCase,
    updateTestCase,
    deleteTestCase,
    createTestRun,
    recordTestExecution,
    deleteTestRun,
    createDefect,
    updateDefect,
    deleteDefect,
    startDefectFromFailedTest,
    updateProfile,
    resetToSampleData,
    clearAllWorkspaceData,
    toast,
    showToast,
    dismissToast: () => setToast(null),
  };

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider');
  }
  return context;
}
